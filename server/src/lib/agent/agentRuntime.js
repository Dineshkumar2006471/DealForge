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
async function executeCustomerTurn(session, userText, { res, chatId = `chatcmpl-${uuidv4()}`, turnId = null } = {}) {
  const context = { organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, turnNumber: (await getTurnNumber(session.sessionId)) + 1, turnId: turnId || `turn_${Date.now()}` };
  let history = await getHistory(session.sessionId);
  if (!await getDeal(context.dealId, context.organizationId, context.sessionId)) throw new Error('Bound deal not found');

  // Agora sends lifecycle and empty ASR turns around joins, TTS, and reconnects.
  // The RTC-ready Speak request owns the only greeting. An empty lifecycle turn is
  // never a customer prompt, and must never wake Gemini or create a second greeting.
  if (!userText || !userText.trim()) {
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_EMPTY_TURN_IGNORED, trigger: 'Ignored empty customer turn', actionResult: { verified: true } });
    if (res) writeNoopSseReply(res, chatId);
    return { empty: true, content: '' };
  }

  const receipt = await claimTurnReceipt(session.sessionId, userText, turnId);
  if (!receipt.claimed) {
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_DUPLICATE_TURN_IGNORED, trigger: 'Ignored replayed customer turn', actionResult: { verified: true, turnId } });
    if (res) writeNoopSseReply(res, chatId);
    if (receipt.cachedResponse) {
      return { duplicate: true, content: receipt.cachedResponse.assistantText || '', audioBase64: receipt.cachedResponse.audioBase64 || null, receiptId: receipt.receiptId };
    }
    return { duplicate: true, content: '', receiptId: receipt.receiptId };
  }

  await addMessage(session.sessionId, { role: 'user', content: userText.trim() });

  // Deterministic conversation evidence extraction (MEDDIC and Deal State)
  const tEvidenceStart = Date.now();
  try {
    const { extractAndApplyEvidence } = require('../evidence/evidenceExtractor');
    await extractAndApplyEvidence(userText, context);
  } catch (extractErr) {
    console.warn('Evidence extraction note:', extractErr.message);
  }
  const tEvidenceEnd = Date.now();

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
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED, trigger: 'Deterministic discount-policy response completed', actionResult: { verified: true, requestedDiscount } });
    try {
      const { refreshAutonomy } = require('./autonomyService');
      await refreshAutonomy(context);
    } catch (_) {}
    if (res) writeSseReply(res, chatId, spoken);
    return { content: spoken, chatId, requestedDiscount, receiptId: receipt.receiptId, metrics: { evidenceMs: tEvidenceEnd - tEvidenceStart, reasoningMs: 0, toolsMs: 10 } };
  }

  const isMeeting = explicitMeetingRequest(userText);
  if (isMeeting) {
    await executeTool('request_meeting_details', { meeting_type: 'technical_review' }, context);
    const spoken = "I've opened a secure form for your contact details and available times.";
    await addMessage(session.sessionId, { role: 'assistant', content: spoken });
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED, trigger: 'Deterministic meeting request completed', actionResult: { verified: true, meetingType: 'technical_review' } });
    try {
      const { refreshAutonomy } = require('./autonomyService');
      await refreshAutonomy(context);
    } catch (_) {}
    if (res) writeSseReply(res, chatId, spoken);
    return { content: spoken, chatId, receiptId: receipt.receiptId, metrics: { evidenceMs: tEvidenceEnd - tEvidenceStart, reasoningMs: 0, toolsMs: 10 } };
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
  let tGeminiStart = 0, tGeminiFirstToken = 0, tToolsStart = 0, tToolsEnd = 0;
  try {
    if (res) writeInterruptableMetadata(res, chatId, true);
    // Buffer the first model pass. A tool-using pass is provisional: speaking
    // it before verification can produce two answers for a single customer
    // turn (the provisional answer, then the verified follow-up).
    const initialTextChunks = [];
    tGeminiStart = Date.now();
    for await (const chunk of generateResponse(await currentModelMessages(context), tools, context)) {
      const choice = chunk.choices?.[0]; if (!choice) continue;
      if (choice.delta?.content) {
        if (!tGeminiFirstToken) tGeminiFirstToken = Date.now();
        content += choice.delta.content;
        initialTextChunks.push(chunk);
      }
      if (choice.delta?.tool_calls) calls.push(...choice.delta.tool_calls.map(item => ({ id: item.id, type: item.type, function: { name: item.function.name, arguments: item.function.arguments || '{}' } })));
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    const MAX_TOOL_ROUNDS = 3;
    if (finishReason === 'tool_calls' && calls.length) {
      // Do not retain or speak interim prose from a tool-calling pass. It was
      // not an executed or verified answer.
      content = '';
      await addMessage(session.sessionId, { role: 'assistant', tool_calls: calls, content: null });
      tToolsStart = Date.now();
      for (const call of calls) {
        let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        const { result } = await executeTool(call.function.name, args, context);
        await addMessage(session.sessionId, { role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
      }
      // Bounded iterative loop: allow the LLM to emit further tool calls up
      // to MAX_TOOL_ROUNDS total. Each round validates, executes, persists
      // tool results, and returns them to the model for the next pass.
      for (let round = 1; round < MAX_TOOL_ROUNDS; round++) {
        let followUpCalls = []; let followUpContent = ''; let followUpFinish;
        for await (const chunk of generateResponse(await currentModelMessages(context), tools, context)) {
          const choice = chunk.choices?.[0]; if (!choice) continue;
          if (choice.delta?.tool_calls) followUpCalls.push(...choice.delta.tool_calls.map(item => ({ id: item.id, type: item.type, function: { name: item.function.name, arguments: item.function.arguments || '{}' } })));
          if (choice.delta?.content) followUpContent += choice.delta.content;
          if (choice.finish_reason) followUpFinish = choice.finish_reason;
        }
        if (followUpFinish !== 'tool_calls' || !followUpCalls.length) {
          // Model returned final text — stream it to the customer
          content = followUpContent;
          if (content && res) {
            hasSpokenContent = true;
            res.write(`data: ${JSON.stringify({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
          }
          break;
        }
        // Another tool round — execute and persist
        await addMessage(session.sessionId, { role: 'assistant', tool_calls: followUpCalls, content: null });
        for (const call of followUpCalls) {
          let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
          const { result } = await executeTool(call.function.name, args, context);
          await addMessage(session.sessionId, { role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
        }
      }
      // If we exhausted all rounds without a final text, generate one last
      // text-only pass with tools suppressed.
      if (!content) {
        for await (const chunk of generateResponse(await currentModelMessages(context), [], context)) {
          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) {
            content += choice.delta.content;
            if (res) {
              hasSpokenContent = true;
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          }
        }
      }
    } else {
      if (res) {
        for (const chunk of initialTextChunks) {
          hasSpokenContent = true;
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }
    }
    if (content) await addMessage(session.sessionId, { role: 'assistant', content });
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED, trigger: 'Response completed', actionResult: { verified: true, hasContent: Boolean(content) } });
    try {
      const { refreshAutonomy } = require('./autonomyService');
      await refreshAutonomy(context);
    } catch (_) {}
    tToolsEnd = tToolsEnd || Date.now();
    const tTurnEnd = Date.now();
    const metrics = {
      evidenceMs: tEvidenceEnd - tEvidenceStart,
      geminiFirstTokenMs: tGeminiFirstToken ? tGeminiFirstToken - tGeminiStart : 0,
      geminiTotalMs: tGeminiStart ? tTurnEnd - tGeminiStart : 0,
      toolsMs: tToolsStart ? (tToolsEnd - tToolsStart) : 0,
      totalMs: tTurnEnd - tEvidenceStart
    };
    if (res) writeTerminalSseReply(res, chatId);
    return { content, chatId, receiptId: receipt.receiptId, metrics };
  } catch (error) {
    console.error('Agent runtime error:', error.message);
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_RESPONSE_FAILED, trigger: 'Gemini/runtime response failed', actionResult: { verified: false, error: String(error.message).slice(0, 200) } }).catch(() => {});
    if (res && !res.writableEnded) {
      // Never append a spoken apology after a customer has already received
      // part of an answer. That is the source of repeated/conflicting agent
      // speech during provider stream failures.
      if (hasSpokenContent) writeTerminalSseReply(res, chatId);
      else writeSafeFallback(res, chatId);
    }
    throw error;
  }
}

async function handleChatCompletion(requestBody, res, session) {
  const chatId = `chatcmpl-${uuidv4()}`;
  const userText = currentUserText(requestBody.messages);
  try {
    await executeCustomerTurn(session, userText, { res, chatId });
  } catch (err) {
    console.error(`Chat completions error for verified session ${session.sessionId}:`, err.message);
    if (!res.writableEnded) writeSafeFallback(res, chatId);
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

function explicitMeetingRequest(text) {
  return /(?:schedule|book|set up)\s*(?:a\s*)?(?:review|meeting|call|demo|follow-up)/i.test(String(text || ''));
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

module.exports = { executeCustomerTurn, handleChatCompletion, writeSafeFallback, writeSseReply, writeNoopSseReply, writeInterruptableMetadata, currentUserText, extractTextContent, explicitDiscountRequest, currentModelMessages };
