/**
 * POST /chat/completions
 *
 * Agora Custom LLM endpoint. Receives OpenAI-compatible ChatCompletionRequest,
 * returns SSE stream in OpenAI-compatible format.
 *
 * Routes every verified session through the durable Agent Runtime → Gemini path.
 */
const express = require('express');
const router = express.Router();
const { verifyAgoraWebhook } = require('../lib/security/webhookAuth');
const { getWebhookSession } = require('../lib/calls/callSessions');
const { parse, chatSchema } = require('../lib/schema/validation');
const { createRateLimit } = require('../lib/security/rateLimit');
const { writeAuditEvent } = require('../lib/audit/eventStore');
const { EVENT_TYPES } = require('../lib/audit/eventTypes');

const agentRuntime = require('../lib/agent/agentRuntime');
const agoraRateLimit = createRateLimit({ scope: 'agora-webhook', limit: 120, windowMs: 60_000 });
router.post('/:sessionWebhookToken', verifyAgoraWebhook, agoraRateLimit, async (req, res, next) => {
  let session;
  try {
    parse(chatSchema, req.body);
    session = await getWebhookSession(req.params.sessionWebhookToken);
  } catch (error) { 
    console.error(`[chatCompletions] Error parsing request or finding session: ${error.message}`);
    return next(error); 
  }
  const { messages, stream } = req.body;
  
  const userText = agentRuntime.currentUserText(messages);
  // Do not put customer transcript text in Cloud Run logs. The durable transcript
  // is protected in Firestore; this log is only operational metadata.
  console.log(`[chatCompletions] verified request session=${session.sessionId} messages=${messages?.length || 0} hasUserText=${Boolean(userText)}`);
  await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.AGENT_WEBHOOK_RECEIVED, trigger: 'Verified Agora custom LLM webhook received', actionResult: { verified: true, hasUserText: Boolean(userText) } }).catch(error => console.error('Webhook audit write failed:', error.message));

  // Agora always sends stream: true
  if (stream !== true) {
    return res.status(400).json({ error: 'stream must be true (required by Agora)' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    await agentRuntime.handleChatCompletion(req.body, res, session);
  } catch (err) {
    console.error(`Chat completions error for verified session ${session.sessionId}:`, err.message);
    if (!res.writableEnded) agentRuntime.writeSafeFallback(res, `chatcmpl-error-${session.sessionId}`);
  }
});



module.exports = router;
