/**
 * POST /chat/completions
 *
 * Agora Custom LLM endpoint. Receives OpenAI-compatible ChatCompletionRequest,
 * returns SSE stream in OpenAI-compatible format.
 *
 * Phase 1: Hardcoded response for voice pipeline validation.
 * Phase 2+: Routes through Agent Runtime → Gemini.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { verifyAgoraWebhook } = require('../lib/security/webhookAuth');
const { getWebhookSession } = require('../lib/calls/callSessions');
const { parse, chatSchema } = require('../lib/schema/validation');
const { createRateLimit } = require('../lib/security/rateLimit');

// Phase 2+ imports (lazy-loaded after Phase 1 validation)
let agentRuntime = null;
try {
  agentRuntime = require('../lib/agent/agentRuntime');
} catch (e) {
  // Agent runtime not yet built — use hardcoded fallback
}

const agoraRateLimit = createRateLimit({ scope: 'agora-webhook', limit: 120, windowMs: 60_000 });
router.post('/:sessionWebhookToken', verifyAgoraWebhook, agoraRateLimit, async (req, res, next) => {
  let session;
  try {
    parse(chatSchema, req.body);
    session = await getWebhookSession(req.params.sessionWebhookToken);
  } catch (error) { return next(error); }
  const { messages, stream } = req.body;

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
    if (agentRuntime) {
      // Phase 2+: Route through Agent Runtime
      await agentRuntime.handleChatCompletion(req.body, res, session);
    } else {
      // Phase 1: Hardcoded response for voice pipeline validation
      await sendHardcodedResponse(res, messages);
    }
  } catch (err) {
    console.error('Chat completions error:', err);
    // Send error as SSE if connection is still open
    if (!res.writableEnded) {
      const errorChunk = {
        id: `chatcmpl-error-${uuidv4()}`,
        choices: [{ index: 0, delta: { content: 'I encountered an issue. Let me try again.' }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      res.write(`data: ${JSON.stringify({ id: errorChunk.id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

/**
 * Phase 1: Hardcoded SSE response for voice pipeline validation.
 * Proves: Agora → Cloud Run → SSE → Agora TTS → customer hears it.
 */
async function sendHardcodedResponse(res, messages) {
  const chatId = `chatcmpl-${uuidv4()}`;

  // Extract last user message for basic echo
  const lastUserMsg = messages?.filter(m => m.role === 'user').pop();
  const userText = lastUserMsg?.content || '';

  // Simple hardcoded responses for Phase 1 testing
  let responseText;
  if (!userText || userText.trim() === '') {
    responseText = "Hello! I'm DealForge, your AI sales assistant. How can I help you today?";
  } else if (userText.toLowerCase().includes('plan') || userText.toLowerCase().includes('pricing')) {
    responseText = "We offer three plans: Starter at $29 per seat per month, Pro at $79, and Enterprise at $149. Which one interests you?";
  } else if (userText.toLowerCase().includes('discount') || userText.toLowerCase().includes('off')) {
    responseText = "I understand you're looking for the best value. Let me check what I can offer for your team size.";
  } else {
    responseText = `Thanks for sharing that. To make sure I find the right solution, could you tell me about your team size and timeline?`;
  }

  // Stream word-by-word like a real LLM
  const words = responseText.split(' ');
  for (let i = 0; i < words.length; i++) {
    const content = (i === 0 ? '' : ' ') + words[i];
    const chunk = {
      id: chatId,
      choices: [{
        index: 0,
        delta: i === 0
          ? { role: 'assistant', content }
          : { content },
        finish_reason: null,
      }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);

    // Small delay to simulate streaming
    await new Promise(r => setTimeout(r, 30));
  }

  // Send finish
  res.write(`data: ${JSON.stringify({ id: chatId, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

module.exports = router;
