const { v4: uuidv4 } = require('uuid');
const { generateResponse } = require('../llm/adapter');
const { buildSystemPrompt } = require('../llm/systemPrompt');
const { getToolDefinitions, executeTool } = require('../tools/registry');
const { getHistory, addMessage, getTurnNumber } = require('./conversationHistory');
const { claimApprovedApprovals, completeApproval, releaseApproval } = require('../policy/approvalQueue');
const { getDeal } = require('../firebase/dealState');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');
require('../tools/calculateDiscount'); require('../tools/updateDealState'); require('../tools/checkProductAvailability'); require('../tools/bookMeeting'); require('../tools/escalateToHuman');

async function handleChatCompletion(requestBody, res, session) {
  const context = { organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, turnNumber: (await getTurnNumber(session.sessionId)) + 1 };
  let history = await getHistory(session.sessionId);
  if (history.length === 0) { const deal = await getDeal(context.dealId, context.organizationId); if (!deal) throw new Error('Bound deal not found'); await addMessage(session.sessionId, { role: 'system', content: buildSystemPrompt({ deal }) }); }
  const lastUser = requestBody.messages.filter(message => message.role === 'user').pop();
  if (lastUser) await addMessage(session.sessionId, { role: 'user', content: lastUser.content || '' });
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
  const chatId = `chatcmpl-${uuidv4()}`; let content = ''; let calls = []; let finishReason;
  try {
    for await (const chunk of generateResponse(history, tools, context)) {
      const choice = chunk.choices?.[0]; if (!choice) continue;
      if (choice.delta?.content) content += choice.delta.content;
      if (choice.delta?.tool_calls) calls.push(...choice.delta.tool_calls.map(item => ({ id: item.id, type: item.type, function: { name: item.function.name, arguments: item.function.arguments || '{}' } })));
      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (!choice.delta?.tool_calls) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    if (finishReason === 'tool_calls' && calls.length) {
      await addMessage(session.sessionId, { role: 'assistant', tool_calls: calls, content: content || null });
      for (const call of calls) {
        let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        const { result } = await executeTool(call.function.name, args, context);
        await addMessage(session.sessionId, { role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
      }
      for await (const chunk of generateResponse(await getHistory(session.sessionId), tools, context)) { res.write(`data: ${JSON.stringify(chunk)}\n\n`); if (chunk.choices?.[0]?.delta?.content) content += chunk.choices[0].delta.content; }
    }
    if (content) await addMessage(session.sessionId, { role: 'assistant', content });
    res.write('data: [DONE]\n\n'); res.end();
  } catch (error) {
    console.error('Agent runtime error:', error.message);
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.AGENT_RESPONSE_FAILED, trigger: 'Gemini/runtime response failed', actionResult: { verified: false, error: String(error.message).slice(0, 200) } }).catch(() => {});
    if (!res.writableEnded) writeSafeFallback(res, chatId);
  }
}

// Agora consumes OpenAI-compatible SSE. Error responses must carry the same
// assistant role and terminal `stop` chunk as a successful streamed response;
// otherwise a TTS client may wait forever and leave the customer in silence.
function writeSafeFallback(res, chatId) {
  res.write(`data: ${JSON.stringify({
    id: chatId,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: "I'm having a technical issue. Could you repeat that?" }, finish_reason: null }],
  })}\n\n`);
  res.write(`data: ${JSON.stringify({
    id: chatId,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

module.exports = { handleChatCompletion, writeSafeFallback };
