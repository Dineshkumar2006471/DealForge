const { v4: uuidv4 } = require('uuid');
const { generateResponse } = require('../llm/adapter');
const { buildSystemPrompt } = require('../llm/systemPrompt');
const { getToolDefinitions, executeTool } = require('../tools/registry');
const { getHistory, addMessage, getTurnNumber } = require('./conversationHistory');
const { claimApprovedApprovals, completeApproval, releaseApproval } = require('../policy/approvalQueue');
const { getDeal } = require('../firebase/dealState');
const { db } = require('../firebase/admin');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');
const { claimTurnReceipt } = require('./turnReceipts');
require('../tools/calculateDiscount'); require('../tools/updateDealState'); require('../tools/checkProductAvailability'); require('../tools/bookMeeting'); require('../tools/requestMeetingDetails'); require('../tools/escalateToHuman');
require('../integrations/hubspot');

async function handleChatCompletion(requestBody, res, session) {
  const context = { organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, turnNumber: (await getTurnNumber(session.sessionId)) + 1 };
  let history = await getHistory(session.sessionId);
  if (!await getDeal(context.dealId, context.organizationId, context.sessionId)) throw new Error('Bound deal not found');
  const chatId = `chatcmpl-${uuidv4()}`;
  const userText = currentUserText(requestBody.messages);

  // Agora sends lifecycle and empty ASR turns around joins, TTS, and reconnects.
  // The RTC-ready Speak request owns the only greeting. An empty lifecycle turn is
  // never a customer prompt, and must never wake Gemini or create a second greeting.
  if (!userText) {
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_EMPTY_TURN_IGNORED, trigger: 'Ignored empty Agora lifecycle turn', actionResult: { verified: true } });
    writeNoopSseReply(res, chatId);
    return;
  }

  const receipt = await claimTurnReceipt(session.sessionId, userText);
  if (!receipt.claimed) {
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_DUPLICATE_TURN_IGNORED, trigger: 'Ignored replayed Agora customer turn', actionResult: { verified: true } });
    writeNoopSseReply(res, chatId);
    return;
  }

  await addMessage(session.sessionId, { role: 'user', content: userText });
  // A percentage discount request is a high-value policy boundary. Route it
  // deterministically instead of hoping the generative model elects to call a
  // tool. This makes the manager approval demonstration reliable and preserves
  // the same validation/policy/exact-once execution path as every other tool.
  const requestedDiscount = explicitDiscountRequest(userText);
  if (requestedDiscount !== null) {
    const executed = await executeTool('calculate_discount', { requested_pct: requestedDiscount }, context);
    const result = executed.result || {};
    const spoken = result.pending_approval
      ? 'I can take that request to my manager for review. I will update you as soon as I have their decision.'
      : result.rejected
        ? 'I cannot approve that request, but I can explore a more suitable commercial package with you.'
        : `I can confirm a ${requestedDiscount}% discount for this negotiation.`;
    await addMessage(session.sessionId, { role: 'assistant', content: spoken });
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED, trigger: 'Deterministic discount-policy response streamed to Agora', actionResult: { verified: true, requestedDiscount } });
    writeSseReply(res, chatId, spoken);
    return;
  }
  for (const approval of await claimApprovedApprovals(context)) {
    const executed = await executeTool(approval.exactToolName, approval.exactValidatedArguments, { ...context, approvedReplay: { approvalId: approval.approvalId, toolName: approval.exactToolName, args: approval.exactValidatedArguments } });
    if (executed.approved) {
      await completeApproval(approval.approvalId, context.organizationId);
      await addMessage(session.sessionId, { role: 'system', content: `[SYSTEM] The approved ${approval.exactToolName} operation was executed once: ${JSON.stringify(executed.result)}` });
    } else {
      await releaseApproval(approval.approvalId, context.organizationId, executed.result?.error || 'Operation failed');
      await addMessage(session.sessionId, { role: 'system', content: `[SYSTEM] The approved operation could not execute and remains retryable.` });
    }
  }
  const tools = getToolDefinitions(); history = await getHistory(session.sessionId);
  let content = ''; let calls = []; let finishReason; let hasSpokenContent = false;
  try {
    writeInterruptableMetadata(res, chatId, true);
    // Buffer the first model pass. A tool-using pass is provisional: speaking
    // it before verification can produce two answers for a single customer
    // turn (the provisional answer, then the verified follow-up).
    const initialTextChunks = [];
    for await (const chunk of generateResponse(await currentModelMessages(context), tools, context)) {
      const choice = chunk.choices?.[0]; if (!choice) continue;
      if (choice.delta?.content) {
        content += choice.delta.content;
        initialTextChunks.push(chunk);
      }
      if (choice.delta?.tool_calls) calls.push(...choice.delta.tool_calls.map(item => ({ id: item.id, type: item.type, function: { name: item.function.name, arguments: item.function.arguments || '{}' } })));
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    if (finishReason === 'tool_calls' && calls.length) {
      // Do not retain or speak interim prose from a tool-calling pass. It was
      // not an executed or verified answer.
      content = '';
      await addMessage(session.sessionId, { role: 'assistant', tool_calls: calls, content: null });
      for (const call of calls) {
        let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        const { result } = await executeTool(call.function.name, args, context);
        await addMessage(session.sessionId, { role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
      }
      for await (const chunk of generateResponse(await currentModelMessages(context), tools, context)) {
        const choice = chunk.choices?.[0];
        if (choice?.delta?.tool_calls) throw new Error('Unexpected follow-up tool call after verified tool execution');
        if (choice?.delta?.content) {
          content += choice.delta.content;
          hasSpokenContent = true;
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }
    } else {
      for (const chunk of initialTextChunks) {
        hasSpokenContent = true;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    }
    if (content) await addMessage(session.sessionId, { role: 'assistant', content });
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED, trigger: 'Gemini response streamed to Agora', actionResult: { verified: true, hasContent: Boolean(content) } });
    writeTerminalSseReply(res, chatId);
  } catch (error) {
    console.error('Agent runtime error:', error.message);
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_RESPONSE_FAILED, trigger: 'Gemini/runtime response failed', actionResult: { verified: false, error: String(error.message).slice(0, 200) } }).catch(() => {});
    if (!res.writableEnded) {
      // Never append a spoken apology after a customer has already received
      // part of an answer. That is the source of repeated/conflicting agent
      // speech during provider stream failures.
      if (hasSpokenContent) writeTerminalSseReply(res, chatId);
      else writeSafeFallback(res, chatId);
    }
  }
}

function currentUserText(messages) {
  const lastUser = Array.isArray(messages) ? messages.filter(message => message?.role === 'user').pop() : null;
  return extractTextContent(lastUser?.content);
}

function extractTextContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter(part => part && typeof part.text === 'string').map(part => part.text.trim()).filter(Boolean).join('\n').trim();
}

function explicitDiscountRequest(text) {
  const match = String(text || '').match(/\b(\d{1,2}(?:\.\d+)?)\s*%\s*(?:off|discount)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

async function currentModelMessages(context) {
  const [deal, history, approvalSnapshot] = await Promise.all([
    getDeal(context.dealId, context.organizationId, context.sessionId),
    getHistory(context.sessionId),
    db.collection('approvals').where('organizationId', '==', context.organizationId).where('dealId', '==', context.dealId).where('sessionId', '==', context.sessionId).limit(20).get(),
  ]);
  if (!deal) throw new Error('Bound deal not found');
  const resolvedApprovals = approvalSnapshot.docs.map(doc => doc.data()).filter(approval => ['APPROVED', 'REJECTED', 'EXPIRED'].includes(approval.status));
  return [
    { role: 'system', content: buildSystemPrompt({ deal, negotiationMemory: (deal.negotiationMemory || []).slice(-10), resolvedApprovals }) },
    ...history.filter(message => message.role !== 'system'),
  ];
}

// Agora consumes OpenAI-compatible SSE. Error responses must carry the same
// assistant role and terminal `stop` chunk as a successful streamed response;
// otherwise a TTS client may wait forever and leave the customer in silence.
function writeSafeFallback(res, chatId) {
  writeSseReply(res, chatId, "I'm having a technical issue. Could you repeat that?");
}

function writeSseReply(res, chatId, content) {
  res.write(`data: ${JSON.stringify({
    id: chatId,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
  })}\n\n`);
  res.write(`data: ${JSON.stringify({
    id: chatId,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeNoopSseReply(res, chatId) {
  writeTerminalSseReply(res, chatId);
}

function writeTerminalSseReply(res, chatId) {
  res.write(`data: ${JSON.stringify({
    id: chatId,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeInterruptableMetadata(res, chatId, interruptable) {
  res.write(`data: ${JSON.stringify({
    id: chatId,
    object: 'chat.completion.custom_metadata',
    choices: [],
    metadata: { interruptable },
  })}\n\n`);
}

module.exports = { handleChatCompletion, writeSafeFallback, writeSseReply, writeNoopSseReply, writeInterruptableMetadata, currentUserText, extractTextContent, explicitDiscountRequest, currentModelMessages };
