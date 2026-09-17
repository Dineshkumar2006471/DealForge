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
require('../tools/calculateDiscount');
require('../tools/updateDealState');
require('../tools/checkProductAvailability');
require('../tools/bookMeeting');
require('../tools/requestMeetingDetails');
require('../tools/escalateToHuman');
require('../integrations/hubspot');
async function executeCustomerTurn(
  session,
  userText,
  { res, chatId = `chatcmpl-${uuidv4()}`, turnId = null, onTextChunk = null } = {},
) {
  // Parallelize deal validation, history read, and Moss semantic retrieval
  const tMossStart = Date.now();
  const mossPromise = (async () => {
    try {
      const { retrieveRelevantContext } = require('../retrieval/mossRetriever');
      return await retrieveRelevantContext({
        organizationId: session.organizationId,
        dealId: session.dealId,
        sessionId: session.sessionId,
        userText: (userText || '').trim(),
      });
    } catch (mossErr) {
      console.warn('Moss retrieval note:', mossErr.message);
      return { results: [], latencyMs: Date.now() - tMossStart, index: 'none', cacheHit: false };
    }
  })();

  const [deal, initialHistory] = await Promise.all([
    getDeal(session.dealId, session.organizationId, session.sessionId),
    getHistory(session.sessionId),
  ]);
  if (!deal) {
    throw new Error('Bound deal not found');
  }

  let history = initialHistory;
  const context = {
    organizationId: session.organizationId,
    dealId: session.dealId,
    sessionId: session.sessionId,
    turnNumber: history.filter((m) => m?.role === 'user').length + 1,
    turnId: turnId || `turn_${Date.now()}`,
  };

  // Agora sends lifecycle and empty ASR turns around joins, TTS, and reconnects.
  // The RTC-ready Speak request owns the only greeting. An empty lifecycle turn is
  // never a customer prompt, and must never wake Gemini or create a second greeting.
  if (!userText || !userText.trim()) {
    await writeAuditEvent({
      organizationId: context.organizationId,
      dealId: context.dealId,
      sessionId: context.sessionId,
      eventType: EVENT_TYPES.AGENT_EMPTY_TURN_IGNORED,
      trigger: 'Ignored empty customer turn',
      actionResult: { verified: true },
    });
    if (res) writeNoopSseReply(res, chatId);
    return { empty: true, content: '' };
  }

  const receipt = await claimTurnReceipt(session.sessionId, userText, turnId);
  if (!receipt.claimed) {
    await writeAuditEvent({
      organizationId: context.organizationId,
      dealId: context.dealId,
      sessionId: context.sessionId,
      eventType: EVENT_TYPES.AGENT_DUPLICATE_TURN_IGNORED,
      trigger: 'Ignored replayed customer turn',
      actionResult: { verified: true, turnId },
    });
    if (res) writeNoopSseReply(res, chatId);
    if (receipt.cachedResponse) {
      return {
        duplicate: true,
        content: receipt.cachedResponse.assistantText || '',
        audioBase64: receipt.cachedResponse.audioBase64 || null,
        receiptId: receipt.receiptId,
      };
    }
    return { duplicate: true, content: '', receiptId: receipt.receiptId };
  }

  // Persist user message synchronously before model reasoning
  const tEvidenceStart = Date.now();
  await addMessage(session.sessionId, { role: 'user', content: userText.trim() });
  history.push({ role: 'user', content: userText.trim() });
  const tEvidenceEnd = Date.now();

  // Non-critical evidence extraction runs in background without blocking LLM reasoning
  setImmediate(async () => {
    try {
      const { extractAndApplyEvidence } = require('../evidence/evidenceExtractor');
      await extractAndApplyEvidence(userText, context);
    } catch (extractErr) {
      console.warn('Evidence extraction note:', extractErr.message);
    }
  });

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
    await writeAuditEvent({
      organizationId: context.organizationId,
      dealId: context.dealId,
      sessionId: context.sessionId,
      eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED,
      trigger: 'Deterministic discount-policy response completed',
      actionResult: { verified: true, requestedDiscount },
    });
    try {
      const { refreshAutonomy } = require('./autonomyService');
      await refreshAutonomy(context);
    } catch (_) {
      /* non-critical side effect */
    }
    if (res) writeSseReply(res, chatId, spoken);
    return {
      content: spoken,
      chatId,
      requestedDiscount,
      receiptId: receipt.receiptId,
      metrics: { evidenceMs: tEvidenceEnd - tEvidenceStart, reasoningMs: 0, toolsMs: 10 },
    };
  }

  const isMeeting = explicitMeetingRequest(userText);
  if (isMeeting) {
    await executeTool('request_meeting_details', { meeting_type: 'technical_review' }, context);
    const spoken = "I've opened a secure form for your contact details and available times.";
    await addMessage(session.sessionId, { role: 'assistant', content: spoken });
    await writeAuditEvent({
      organizationId: context.organizationId,
      dealId: context.dealId,
      sessionId: context.sessionId,
      eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED,
      trigger: 'Deterministic meeting request completed',
      actionResult: { verified: true, meetingType: 'technical_review' },
    });
    try {
      const { refreshAutonomy } = require('./autonomyService');
      await refreshAutonomy(context);
    } catch (_) {
      /* non-critical side effect */
    }
    if (res) writeSseReply(res, chatId, spoken);
    return {
      content: spoken,
      chatId,
      receiptId: receipt.receiptId,
      metrics: { evidenceMs: tEvidenceEnd - tEvidenceStart, reasoningMs: 0, toolsMs: 10 },
    };
  }

  for (const approval of await claimApprovedApprovals(context)) {
    const executed = await executeTool(approval.exactToolName, approval.exactValidatedArguments, {
      ...context,
      approvedReplay: {
        approvalId: approval.approvalId,
        toolName: approval.exactToolName,
        args: approval.exactValidatedArguments,
      },
    });
    if (executed.approved) {
      await completeApproval(approval.approvalId, context.organizationId);
      await addMessage(session.sessionId, {
        role: 'system',
        content: `[SYSTEM] The approved ${approval.exactToolName} operation was executed once: ${JSON.stringify(executed.result)}`,
      });
    } else {
      await releaseApproval(approval.approvalId, context.organizationId, executed.result?.error || 'Operation failed');
      await addMessage(session.sessionId, {
        role: 'system',
        content: `[SYSTEM] The approved operation could not execute and remains retryable.`,
      });
    }
  }

  // Await Moss semantic retrieval that started in parallel at turn entry
  let retrievedDocs = [];
  let mossLatencyMs = 0;
  let mossIndex = 'none';
  let mossCacheHit = false;
  try {
    const retrieval = await mossPromise;
    retrievedDocs = retrieval.results || [];
    mossLatencyMs = retrieval.latencyMs || Date.now() - tMossStart;
    mossIndex = retrieval.index || 'none';
    mossCacheHit = Boolean(retrieval.cacheHit);
  } catch (mossErr) {
    console.warn('Moss retrieval note:', mossErr.message);
  }
  context.retrievedDocs = retrievedDocs;

  const tools = getToolDefinitions();
  let content = '';
  const calls = [];
  let finishReason;
  let hasSpokenContent = false;
  let tGeminiStart = 0,
    tGeminiFirstToken = 0,
    tToolsStart = 0,
    tToolsEnd = 0;
  try {
    if (res) writeInterruptableMetadata(res, chatId, true);
    // ─── GEMINI STREAMING STATE MACHINE ─────────────────────────────────────
    // States:
    //   BUFFERING        → Collecting initial chunks, watching for tool_calls
    //   TOOL_DETECTED    → tool_calls seen; discard buffered prose, execute tools
    //   STREAMING        → No tool_calls seen AND sentence boundary reached;
    //                       forward deltas through onTextChunk immediately
    // ──────────────────────────────────────────────────────────────────────────

    const SENTENCE_BOUNDARY = /(?<=[.!?;:])\s+/;
    let streamState = 'BUFFERING'; // 'BUFFERING' | 'TOOL_DETECTED' | 'STREAMING'
    const bufferedTextDeltas = []; // Holds deltas while in BUFFERING state
    const initialTextChunks = [];
    tGeminiStart = Date.now();

    for await (const chunk of generateResponse(await currentModelMessages(context, { deal, history }), tools, context)) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      // ── Tool-call detection (highest priority) ──
      if (choice.delta?.tool_calls) {
        if (streamState === 'BUFFERING') {
          streamState = 'TOOL_DETECTED';
          // Discard any buffered text — it was provisional
          bufferedTextDeltas.length = 0;
        }
        calls.push(
          ...choice.delta.tool_calls.map((item) => ({
            id: item.id,
            type: item.type,
            function: { name: item.function.name, arguments: item.function.arguments || '{}' },
          })),
        );
      }

      // ── Content accumulation ──
      if (choice.delta?.content) {
        if (!tGeminiFirstToken) tGeminiFirstToken = Date.now();
        content += choice.delta.content;
        initialTextChunks.push(chunk);

        if (streamState === 'BUFFERING') {
          bufferedTextDeltas.push(choice.delta.content);

          // Check if we've reached a sentence boundary — safe to start streaming
          const accumulated = bufferedTextDeltas.join('');
          if (SENTENCE_BOUNDARY.test(accumulated)) {
            streamState = 'STREAMING';
            // Flush all buffered deltas through onTextChunk
            if (typeof onTextChunk === 'function') {
              for (const delta of bufferedTextDeltas) {
                try {
                  onTextChunk(delta);
                } catch (_) {
                  /* best-effort */
                }
              }
            }
            bufferedTextDeltas.length = 0;
          }
        } else if (streamState === 'STREAMING') {
          // Already confirmed text-only — forward immediately
          if (typeof onTextChunk === 'function') {
            try {
              onTextChunk(choice.delta.content);
            } catch (_) {
              /* best-effort */
            }
          }
        }
        // If TOOL_DETECTED, silently accumulate (will be discarded)
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    // ── Post-stream resolution ──
    const MAX_TOOL_ROUNDS = 3;

    if (finishReason === 'tool_calls' && calls.length) {
      // Tool-call pass confirmed — discard any remaining buffered content
      content = '';
      await addMessage(session.sessionId, { role: 'assistant', tool_calls: calls, content: null });
      tToolsStart = Date.now();
      for (const call of calls) {
        let args;
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        const { result } = await executeTool(call.function.name, args, context);
        await addMessage(session.sessionId, {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });
      }

      // Follow-up rounds: stream text through onTextChunk immediately
      // because post-tool responses are verified final text
      for (let round = 1; round < MAX_TOOL_ROUNDS; round++) {
        const followUpCalls = [];
        let followUpContent = '';
        let followUpFinish;
        for await (const chunk of generateResponse(await currentModelMessages(context), tools, context)) {
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          if (choice.delta?.tool_calls) {
            followUpCalls.push(
              ...choice.delta.tool_calls.map((item) => ({
                id: item.id,
                type: item.type,
                function: { name: item.function.name, arguments: item.function.arguments || '{}' },
              })),
            );
          }
          if (choice.delta?.content) {
            followUpContent += choice.delta.content;
            // Post-tool text is verified — stream immediately
            if (typeof onTextChunk === 'function') {
              try {
                onTextChunk(choice.delta.content);
              } catch (_) {
                /* best-effort */
              }
            }
          }
          if (choice.finish_reason) followUpFinish = choice.finish_reason;
        }
        if (followUpFinish !== 'tool_calls' || !followUpCalls.length) {
          content = followUpContent;
          if (content && res) {
            hasSpokenContent = true;
            res.write(
              `data: ${JSON.stringify({ id: chatId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`,
            );
          }
          break;
        }
        // Another tool round
        await addMessage(session.sessionId, { role: 'assistant', tool_calls: followUpCalls, content: null });
        for (const call of followUpCalls) {
          let args;
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = {};
          }
          const { result } = await executeTool(call.function.name, args, context);
          await addMessage(session.sessionId, {
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(result),
          });
        }
      }
      // Exhausted tool rounds — tools-suppressed final pass
      if (!content) {
        for await (const chunk of generateResponse(await currentModelMessages(context), [], context)) {
          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) {
            content += choice.delta.content;
            // Verified final — stream immediately
            if (typeof onTextChunk === 'function') {
              try {
                onTextChunk(choice.delta.content);
              } catch (_) {
                /* best-effort */
              }
            }
            if (res) {
              hasSpokenContent = true;
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          }
        }
      }
    } else {
      // ── Text-only response (no tool calls) ──
      // If still in BUFFERING state (no sentence boundary was reached before
      // stream ended), flush the remaining buffered deltas now.
      if (streamState === 'BUFFERING' && bufferedTextDeltas.length > 0) {
        if (typeof onTextChunk === 'function') {
          for (const delta of bufferedTextDeltas) {
            try {
              onTextChunk(delta);
            } catch (_) {
              /* best-effort */
            }
          }
        }
      }
      if (res) {
        for (const chunk of initialTextChunks) {
          hasSpokenContent = true;
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }
    }
    // Persist assistant message — must complete before return so receipt attachment works
    if (content) await addMessage(session.sessionId, { role: 'assistant', content });
    // addUserMsgPromise + evidencePromise already settled at line ~100
    // Non-critical: audit + autonomy deferred to fire-and-forget
    setImmediate(async () => {
      try {
        await writeAuditEvent({
          organizationId: context.organizationId,
          dealId: context.dealId,
          sessionId: context.sessionId,
          eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED,
          trigger: 'Response completed',
          actionResult: { verified: true, hasContent: Boolean(content) },
        });
      } catch (_) {
        /* non-critical */
      }
      try {
        const { refreshAutonomy } = require('./autonomyService');
        await refreshAutonomy(context);
      } catch (_) {
        /* non-critical */
      }
    });
    tToolsEnd = tToolsEnd || Date.now();
    const tTurnEnd = Date.now();
    const metrics = {
      evidenceMs: tEvidenceEnd - tEvidenceStart,
      geminiFirstTokenMs: tGeminiFirstToken ? tGeminiFirstToken - tGeminiStart : 0,
      geminiTotalMs: tGeminiStart ? tTurnEnd - tGeminiStart : 0,
      toolsMs: tToolsStart ? tToolsEnd - tToolsStart : 0,
      totalMs: tTurnEnd - tEvidenceStart,
      mossLatencyMs,
      mossIndex,
      mossCacheHit,
      mossResultCount: retrievedDocs.length,
    };

    // Non-blocking asynchronous Moss deal context sync (Firestore remains source of truth)
    setImmediate(async () => {
      try {
        const { syncDealContext } = require('../retrieval/mossIndexer');
        const latestDeal = await getDeal(context.dealId, context.organizationId, context.sessionId);
        if (latestDeal) {
          await syncDealContext(context.dealId, latestDeal);
        }
      } catch (_) {
        /* non-critical side effect */
      }
    });

    if (res) writeTerminalSseReply(res, chatId);
    return { content, chatId, receiptId: receipt.receiptId, metrics };
  } catch (error) {
    console.error('Agent runtime error:', error.message);
    await writeAuditEvent({
      organizationId: context.organizationId,
      dealId: context.dealId,
      sessionId: context.sessionId,
      eventType: EVENT_TYPES.AGENT_RESPONSE_FAILED,
      trigger: 'Gemini/runtime response failed',
      actionResult: { verified: false, error: String(error.message).slice(0, 200) },
    }).catch(() => {});
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
  const lastUser = Array.isArray(messages) ? messages.filter((message) => message?.role === 'user').pop() : null;
  return extractTextContent(lastUser?.content);
}

function extractTextContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
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

async function currentModelMessages(context, preloaded = {}) {
  const deal = preloaded.deal || (await getDeal(context.dealId, context.organizationId, context.sessionId));
  if (!deal) throw new Error('Bound deal not found');

  const history = preloaded.history || (await getHistory(context.sessionId));

  const approvalSnapshot = await db
    .collection('approvals')
    .where('organizationId', '==', context.organizationId)
    .where('dealId', '==', context.dealId)
    .where('sessionId', '==', context.sessionId)
    .limit(20)
    .get();
  const resolvedApprovals = approvalSnapshot.docs
    .map((doc) => doc.data())
    .filter((approval) => ['APPROVED', 'REJECTED', 'EXPIRED'].includes(approval.status));
  return [
    {
      role: 'system',
      content: buildSystemPrompt({
        deal,
        negotiationMemory: (deal.negotiationMemory || []).slice(-10),
        resolvedApprovals,
        retrievedDocs: context.retrievedDocs || [],
      }),
    },
    ...history.filter((message) => message.role !== 'system'),
  ];
}

// Agora consumes OpenAI-compatible SSE. Error responses must carry the same
// assistant role and terminal `stop` chunk as a successful streamed response;
// otherwise a TTS client may wait forever and leave the customer in silence.
function writeSafeFallback(res, chatId) {
  writeSseReply(res, chatId, "I'm having a technical issue. Could you repeat that?");
}

function writeSseReply(res, chatId, content) {
  res.write(
    `data: ${JSON.stringify({
      id: chatId,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      id: chatId,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeNoopSseReply(res, chatId) {
  writeTerminalSseReply(res, chatId);
}

function writeTerminalSseReply(res, chatId) {
  res.write(
    `data: ${JSON.stringify({
      id: chatId,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeInterruptableMetadata(res, chatId, interruptable) {
  res.write(
    `data: ${JSON.stringify({
      id: chatId,
      object: 'chat.completion.custom_metadata',
      choices: [],
      metadata: { interruptable },
    })}\n\n`,
  );
}

module.exports = {
  executeCustomerTurn,
  handleChatCompletion,
  writeSafeFallback,
  writeSseReply,
  writeNoopSseReply,
  writeInterruptableMetadata,
  currentUserText,
  extractTextContent,
  explicitDiscountRequest,
  currentModelMessages,
};
