const express = require('express');
const {
  redeemLink,
  consumeLink,
  restoreForRetry,
  rtcCredentials,
  webhookTokenFor,
  findSessionByHash,
  endSession,
  sessionRef,
} = require('../lib/calls/callSessions');
const { startAgent, speakAgent } = require('../lib/calls/agoraAgentService');
const {
  parse,
  sessionCredentialSchema,
  callActivitySchema,
  meetingDetailsSchema,
  meetingBookingSchema,
} = require('../lib/schema/validation');
const { writeAuditEvent } = require('../lib/audit/eventStore');
const { EVENT_TYPES } = require('../lib/audit/eventTypes');
const { HttpError } = require('../lib/security/auth');
const { createRateLimit } = require('../lib/security/rateLimit');
const { runPostCallAutopilot } = require('../lib/agent/postCallAutopilot');
const router = express.Router();
const joinRateLimit = createRateLimit({ scope: 'public-call-join', limit: 8, windowMs: 60_000 });
const { db } = require('../lib/firebase/admin');
const { getLatestMeetingRequest, findMeetingSlots, confirmMeeting } = require('../lib/meetings/meetingRequests');
const { addMessage, getHistory } = require('../lib/agent/conversationHistory');

router.post('/calls/:linkToken/join', joinRateLimit, async (req, res, next) => {
  try {
    const voiceProvider = process.env.VOICE_PROVIDER || 'openai_realtime';
    const { session, refreshToken } = await redeemLink(req.params.linkToken);
    const doc = await require('../lib/calls/callSessions').sessionRef(session.sessionId).get();
    const stored = doc.data();

    if (voiceProvider === 'openai_realtime') {
      let realtime;
      try {
        const { createRealtimeSession } = require('../lib/calls/openAiRealtimeService');
        realtime = await createRealtimeSession();
      } catch (realtimeErr) {
        await restoreForRetry(stored.sessionId).catch(() => {});
        throw realtimeErr;
      }
      await require('../lib/calls/callSessions').markActive(stored.sessionId, 'openai_realtime');
      await consumeLink(stored.sessionId);
      await writeAuditEvent({
        organizationId: stored.organizationId,
        dealId: stored.dealId,
        sessionId: stored.sessionId,
        eventType: EVENT_TYPES.CALL_STARTED,
        trigger: 'Customer joined verified call link (openai_realtime)',
      });
      return res.json({
        voiceProvider: 'openai_realtime',
        clientSecret: realtime.clientSecret,
        expiresAt: realtime.expiresAt,
        model: realtime.model,
        sessionId: stored.sessionId,
        sessionCredential: refreshToken,
      });
    }

    if (voiceProvider === 'browser_speech') {
      await require('../lib/calls/callSessions').markActive(stored.sessionId, 'browser_speech');
      await consumeLink(stored.sessionId);
      await writeAuditEvent({
        organizationId: stored.organizationId,
        dealId: stored.dealId,
        sessionId: stored.sessionId,
        eventType: EVENT_TYPES.CALL_STARTED,
        trigger: 'Customer joined verified call link (browser_speech)',
      });
      return res.json({
        voiceProvider: 'browser_speech',
        sessionId: stored.sessionId,
        sessionCredential: refreshToken,
      });
    }

    // Default to Agora provider if voiceProvider === 'agora'
    let agentId;
    try {
      agentId = await startAgent(stored, webhookTokenFor(stored.sessionId));
    } catch (startError) {
      // Agent startup failed — restore the session so the customer can retry
      // the same link. restoreForRetry only acts if hashedLinkToken is intact.
      await restoreForRetry(stored.sessionId).catch(() => {});
      throw startError;
    }
    // Agent is running and session is ACTIVE. Consume the link token so the
    // same URL cannot start a second agent.
    await consumeLink(stored.sessionId);
    const activeDoc = await require('../lib/calls/callSessions').sessionRef(stored.sessionId).get();
    const activeSession = activeDoc.data();
    const credentials = rtcCredentials(activeSession);
    await writeAuditEvent({
      organizationId: activeSession.organizationId,
      dealId: activeSession.dealId,
      sessionId: activeSession.sessionId,
      eventType: EVENT_TYPES.CALL_STARTED,
      trigger: 'Customer joined verified call link (agora)',
    });

    res.json({
      ...credentials,
      voiceProvider: 'agora',
      sessionId: activeSession.sessionId,
      agentId,
      sessionCredential: refreshToken,
    });
  } catch (error) {
    next(error);
  }
});
async function activeSessionFromCredential(req) {
  const { sessionCredential } = parse(sessionCredentialSchema, { sessionCredential: req.body?.sessionCredential });
  const { session } = await findSessionByHash('hashedRefreshToken', sessionCredential);
  if (session.status !== 'ACTIVE' || session.revokedAt || new Date(session.expiresAt) <= new Date()) {
    throw new HttpError(410, 'Call session is not active');
  }
  return session;
}
router.post('/calls/:linkToken/token', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    res.json({ ...rtcCredentials(session), sessionId: session.sessionId });
  } catch (error) {
    next(error);
  }
});
// Customer transcript reads are authenticated with the same opaque, server-issued
// session credential as the RTC flow. This fallback keeps captions available if a
// browser cannot maintain its Firestore listener; it never accepts a customer
// supplied session ID or deal ID.
router.post('/calls/:linkToken/transcript', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const messages = await getHistory(session.sessionId);
    res.json({
      sessionId: session.sessionId,
      messages: messages.filter((message) => ['user', 'assistant'].includes(message?.role)),
    });
  } catch (error) {
    next(error);
  }
});
router.post('/calls/:linkToken/meeting-requests/latest', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const request = await getLatestMeetingRequest(session.sessionId);
    res.json({ sessionId: session.sessionId, request });
  } catch (error) {
    next(error);
  }
});
router.post('/calls/:linkToken/ready', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const ref = sessionRef(session.sessionId);
    let shouldSpeak = false;
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data().status !== 'ACTIVE') {
        throw new HttpError(410, 'Call session is not active');
      }
      if (!snapshot.data().greetingRequestedAt) {
        tx.update(ref, { greetingRequestedAt: new Date().toISOString() });
        shouldSpeak = true;
      }
    });
    if (shouldSpeak) {
      const greeting =
        "Hello, I'm the DealForge sales assistant. I'm ready to help with your team, timeline, or pricing needs.";
      await addMessage(session.sessionId, { role: 'assistant', content: greeting });
      const isAgoraAgent = session.agentId && !['openai_realtime', 'browser_speech'].includes(session.agentId);
      if (isAgoraAgent) {
        await speakAgent(session, greeting, { priority: 'INTERRUPT', interruptable: false });
      }
      await writeAuditEvent({
        organizationId: session.organizationId,
        dealId: session.dealId,
        sessionId: session.sessionId,
        eventType: EVENT_TYPES.AGENT_GREETING_REQUESTED,
        trigger: 'Customer voice ready; greeting requested',
        actionResult: { accepted: true, provider: isAgoraAgent ? 'agora' : session.agentId },
      });

      let audioBase64 = null;
      if (!isAgoraAgent) {
        try {
          const { synthesizeSpeech } = require('../lib/tts/sarvamTtsService');
          const ttsResult = await synthesizeSpeech(greeting, { codec: 'wav' });
          audioBase64 = ttsResult.audioBase64;
        } catch (ttsErr) {
          console.warn('Greeting Sarvam synthesis warning:', ttsErr.message);
        }
      }
      return res.status(202).json({ status: 'GREETING_REQUESTED', greeting, audioBase64 });
    }
    res.status(202).json({ status: 'ALREADY_READY' });
  } catch (error) {
    next(error);
  }
});

router.post('/calls/:linkToken/turn', async (req, res, next) => {
  const s0 = Date.now();
  try {
    const userText = typeof req.body?.userText === 'string' ? req.body.userText.trim() : '';
    if (!userText) {
      return res.status(400).json({ error: 'userText is required' });
    }
    const session = await activeSessionFromCredential(req);
    const s1 = Date.now();
    const turnId = typeof req.body?.turnId === 'string' ? req.body.turnId.trim() : null;
    const wantsStream =
      req.headers.accept?.includes('text/event-stream') || req.body?.stream === true || req.query?.stream === 'true';

    if (wantsStream) {
      // ═══════════════════════════════════════════════════════════════════════
      // PIPELINED SSE: Open stream BEFORE executeCustomerTurn so the browser
      // receives audio as soon as the first sentence is generated — not after
      // the entire Gemini response + evidence + audit + autonomy have finished.
      // ═══════════════════════════════════════════════════════════════════════
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const s2 = Date.now();
      const { executeCustomerTurn } = require('../lib/agent/agentRuntime');
      const { streamSpeech } = require('../lib/tts/sarvamStreamingTts');

      // ─── Ordered TTS Queue ──────────────────────────────────────────────
      // Producer: onTextChunk accumulates text and enqueues complete sentences.
      // Consumer: processes sentences sequentially — one TTS at a time — so
      // audio chunks arrive in deterministic order. No overlap, no reordering.
      // ────────────────────────────────────────────────────────────────────────
      let sentenceBuffer = '';
      let fullText = '';
      let sentenceIndex = 0;
      let s12 = 0; // TTS start timestamp
      let s13 = 0; // TTS first byte timestamp
      const audioChunks = [];

      // Ordered queue state
      const sentenceQueue = []; // Pending sentences to synthesize
      let queueProcessing = false; // Consumer lock
      let queueDone = false; // Signals no more sentences will be enqueued
      let queueResolve; // Resolves when queue is fully drained
      const queueDrained = new Promise((r) => {
        queueResolve = r;
      });

      // Consumer: processes one sentence at a time, in order
      async function processQueue() {
        if (queueProcessing) return; // Only one consumer
        queueProcessing = true;
        while (sentenceQueue.length > 0) {
          const rawSentence = sentenceQueue.shift();
          const idx = sentenceIndex++;
          if (!s12) s12 = Date.now();

          // Sanitize text for natural speech
          const { sanitizeVoiceText } = require('../lib/tts/sanitizeVoiceText');
          const sentence = sanitizeVoiceText(rawSentence);
          if (!sentence) {
            console.warn(
              `[VOICE_PIPELINE] Sentence #${idx} empty after sanitization, raw="${rawSentence.slice(0, 80)}"`,
            );
            continue;
          }

          console.log(`[VOICE_PIPELINE] Sentence #${idx} len=${sentence.length} text="${sentence.slice(0, 100)}"`);

          try {
            // Await the FULL sentence synthesis before sending to browser.
            // Sarvam WebSocket emits raw fragments of a single MP3 stream. If we send those
            // raw fragments to the browser's decodeAudioData, it fails to decode them because
            // they are cut mid-frame, causing severe skipping, clicks, and robotic 'throat' artifacts.
            // By concatenating the chunks into one complete MP3 buffer per sentence, the browser
            // decodes it flawlessly and schedules it gaplessly.
            const ttsStart = Date.now();
            const ttsRes = await streamSpeech(sentence);
            const ttsMs = Date.now() - ttsStart;

            if (ttsRes && ttsRes.audioBase64List && ttsRes.audioBase64List.length > 0) {
              const fullBuffer = Buffer.concat(ttsRes.audioBase64List.map((b) => Buffer.from(b, 'base64')));
              const fullBase64 = fullBuffer.toString('base64');

              console.log(
                `[VOICE_PIPELINE] Sentence #${idx} TTS OK chunks=${ttsRes.totalChunks} bytes=${fullBuffer.length} tts_ms=${ttsMs}`,
              );

              if (!s13) s13 = Date.now();
              if (!res.writableEnded) {
                audioChunks.push(fullBase64);
                res.write(
                  `event: audio_chunk\ndata: ${JSON.stringify({
                    chunkIndex: idx,
                    audioBase64: fullBase64,
                    contentType: 'audio/mp3',
                    isFinal: false,
                  })}\n\n`,
                );
              }
            } else {
              console.warn(`[VOICE_PIPELINE] Sentence #${idx} TTS returned no audio`);
            }
          } catch (err) {
            console.warn(`[VOICE_PIPELINE] Sentence #${idx} TTS error:`, err.message);
          }
        }
        queueProcessing = false;
        if (queueDone && sentenceQueue.length === 0) {
          queueResolve();
        }
      }

      function enqueueSentence(sentence) {
        sentenceQueue.push(sentence);
        processQueue(); // Kick consumer (no-op if already running)
      }

      // ─── Sentence Segmentation ──────────────────────────────────────────────
      // Split ONLY on period, question mark, exclamation mark followed by space.
      // Do NOT split on colons, semicolons, or commas — they break prosody.
      // Minimum segment length of 40 chars ensures natural speaking units.
      // Short segments are grouped with the next one for natural flow.
      // ────────────────────────────────────────────────────────────────────────
      const SENTENCE_END = /(?<=[.?!])\s+/;
      const MIN_SEGMENT_LENGTH = 40;

      const onTextChunk = (delta) => {
        sentenceBuffer += delta;
        fullText += delta;

        // Split at sentence boundaries and enqueue each complete sentence
        const parts = sentenceBuffer.split(SENTENCE_END);
        if (parts.length > 1) {
          // Accumulate short fragments into natural speaking units
          let accumulated = '';
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i].trim();
            if (!part) continue;

            if (accumulated) {
              accumulated += ' ' + part;
            } else {
              accumulated = part;
            }

            // Only enqueue if we have enough text for natural speech
            if (accumulated.length >= MIN_SEGMENT_LENGTH) {
              enqueueSentence(accumulated);
              accumulated = '';
            }
          }
          // Any remaining short accumulated text goes back to the buffer
          const lastPart = parts[parts.length - 1];
          sentenceBuffer = accumulated ? accumulated + ' ' + lastPart : lastPart;
        }
      };

      const result = await executeCustomerTurn(session, userText, { turnId, onTextChunk });
      const assistantText = result.content || fullText;

      // Flush any remaining sentence buffer as the final TTS segment
      if (sentenceBuffer.trim()) {
        enqueueSentence(sentenceBuffer.trim());
        sentenceBuffer = '';
      }

      // Signal no more sentences and wait for queue to drain
      queueDone = true;
      if (sentenceQueue.length === 0 && !queueProcessing) {
        queueResolve();
      }
      await queueDrained;

      // Emit text event with the complete assistant text (browser updates caption)
      {
        const request = await getLatestMeetingRequest(session.sessionId).catch(() => null);
        res.write(`event: text\ndata: ${JSON.stringify({ assistantText, meetingRequest: request })}\n\n`);
      }

      const s14 = Date.now();
      const totalBackendMs = s14 - s0;
      const ttsTTFB = s13 ? s13 - s12 : 0;
      const ttsTotalMs = s12 ? s14 - s12 : 0;

      // Attach complete turn response to Firestore receipt asynchronously
      if (result.receiptId || turnId) {
        const { attachTurnResponse } = require('../lib/agent/turnReceipts');
        attachTurnResponse(session.sessionId, result.receiptId, turnId, {
          assistantText,
          audioBase64: audioChunks[0] || null,
        }).catch(() => {});
      }

      const metrics = {
        evidenceMs: result.metrics?.evidenceMs || 0,
        reasoningMs: result.metrics?.geminiTotalMs || result.metrics?.reasoningMs || 0,
        geminiFirstTokenMs: result.metrics?.geminiFirstTokenMs || 0,
        toolsMs: result.metrics?.toolsMs || 0,
        ttsTTFB,
        ttsMs: ttsTotalMs,
        mossLatencyMs: result.metrics?.mossLatencyMs || 0,
        mossIndex: result.metrics?.mossIndex || 'none',
        totalBackendMs,
      };

      // Emit terminal done event
      res.write(`event: done\ndata: ${JSON.stringify({ turnId, metrics, duplicate: Boolean(result.duplicate) })}\n\n`);
      res.end();

      // Log safe diagnostic line (Section 3 of prompt)
      console.log(
        `[VOICE LATENCY SERVER] turnId=${turnId || 'auto'} entry=${s1 - s0}ms evidence=${metrics.evidenceMs}ms geminiTTFU=${metrics.geminiFirstTokenMs}ms tools=${metrics.toolsMs}ms ttsTTFB=${ttsTTFB}ms ttsTotal=${ttsTotalMs}ms moss=${metrics.mossLatencyMs}ms TOTAL=${totalBackendMs}ms`,
      );
      return;
    }

    // Non-streaming JSON path
    const s2 = Date.now();
    const { executeCustomerTurn } = require('../lib/agent/agentRuntime');
    const result = await executeCustomerTurn(session, userText, { turnId });
    const assistantText = result.content || '';

    const request = await getLatestMeetingRequest(session.sessionId).catch(() => null);

    // Standard non-streaming JSON path (for automated tests and standard callers)
    const s12 = Date.now();
    let audioBase64 = result.audioBase64 || null;
    let ttsLatency = 0;
    const s13 = 0;
    if (assistantText && !audioBase64) {
      try {
        const { streamSpeech } = require('../lib/tts/sarvamStreamingTts');
        const ttsRes = await streamSpeech(assistantText);

        ttsLatency = ttsRes.totalMs || Date.now() - s12;

        if (ttsRes && ttsRes.audioBase64List && ttsRes.audioBase64List.length > 0) {
          const fullBuffer = Buffer.concat(ttsRes.audioBase64List.map((b) => Buffer.from(b, 'base64')));
          audioBase64 = fullBuffer.toString('base64');
        } else {
          audioBase64 = null;
        }
      } catch (err) {
        console.error('Sarvam TTS error for customer turn:', err.message);
      }
    }

    if (result.receiptId || turnId) {
      const { attachTurnResponse } = require('../lib/agent/turnReceipts');
      await attachTurnResponse(session.sessionId, result.receiptId, turnId, {
        assistantText,
        audioBase64,
      });
    }

    const s15 = Date.now();
    const totalBackendMs = s15 - s0;
    const ttsTTFB = s13 ? s13 - s12 : ttsLatency;

    console.log(
      `[VOICE LATENCY SERVER] turnId=${turnId || 'auto'} entry=${s1 - s0}ms claim=${s2 - s1}ms evidence=${result.metrics?.evidenceMs || 0}ms geminiTTFU=${result.metrics?.geminiFirstTokenMs || 0}ms tools=${result.metrics?.toolsMs || 0}ms ttsTTFB=${ttsTTFB}ms ttsTotal=${ttsLatency}ms moss=${result.metrics?.mossLatencyMs || 0}ms TOTAL=${totalBackendMs}ms`,
    );

    res.json({
      sessionId: session.sessionId,
      turnId,
      userText,
      assistantText,
      audioBase64,
      meetingRequest: request,
      duplicate: Boolean(result.duplicate),
      metrics: {
        evidenceMs: result.metrics?.evidenceMs || 0,
        reasoningMs: result.metrics?.geminiTotalMs || result.metrics?.reasoningMs || 0,
        geminiFirstTokenMs: result.metrics?.geminiFirstTokenMs || 0,
        toolsMs: result.metrics?.toolsMs || 0,
        ttsTTFB,
        ttsMs: ttsLatency,
        mossLatencyMs: result.metrics?.mossLatencyMs || 0,
        mossIndex: result.metrics?.mossIndex || 'none',
        totalBackendMs,
      },
    });
  } catch (error) {
    next(error);
  }
});
router.post('/calls/:linkToken/meeting-requests/:requestId/slots', async (req, res, next) => {
  try {
    const input = parse(meetingDetailsSchema, req.body);
    const session = await activeSessionFromCredential({ ...req, body: input });
    const result = await findMeetingSlots(session, req.params.requestId, input);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router.post('/calls/:linkToken/meeting-requests/:requestId/book', async (req, res, next) => {
  try {
    const input = parse(meetingBookingSchema, req.body);
    const session = await activeSessionFromCredential({ ...req, body: input });
    const outcome = await confirmMeeting(session, req.params.requestId, input.slotStart);
    const crm = outcome.result?.crm;
    const spoken = outcome.booked
      ? `Your meeting is confirmed for the selected time.${crm?.verified ? ' I also updated our CRM.' : ''}`
      : 'I could not complete that booking. Please choose another available time or try again later.';
    await addMessage(session.sessionId, { role: 'assistant', content: spoken });
    const isAgoraAgent = session.agentId && !['openai_realtime', 'browser_speech'].includes(session.agentId);
    if (isAgoraAgent) {
      await speakAgent(session, spoken, { priority: 'APPEND', interruptable: true }).catch((error) =>
        console.warn('Verified meeting outcome could not be spoken:', error.message),
      );
    }
    res.status(outcome.booked ? 201 : 409).json({ ...outcome, spoken });
  } catch (error) {
    next(error);
  }
});
router.post('/calls/:linkToken/stop', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    let agentStopped = true;
    const isAgoraAgent = session.agentId && !['openai_realtime', 'browser_speech'].includes(session.agentId);
    if (isAgoraAgent) {
      try {
        await require('../lib/calls/agoraAgentService').stopAgent(session);
      } catch (_) {
        agentStopped = false;
      }
    }
    await endSession(session.sessionId);
    await writeAuditEvent({
      organizationId: session.organizationId,
      dealId: session.dealId,
      sessionId: session.sessionId,
      eventType: EVENT_TYPES.CALL_ENDED,
      trigger: agentStopped ? 'Customer left call' : 'Customer left; agent cleanup pending',
      actionResult: { agentStopped },
    });
    try {
      await runPostCallAutopilot(session);
    } catch (autopilotError) {
      console.error('Post-call autopilot failed:', autopilotError.message);
    }
    res.status(agentStopped ? 200 : 202).json({
      sessionId: session.sessionId,
      status: agentStopped ? 'ENDED' : 'ENDED_WITH_AGENT_CLEANUP_ERROR',
      agentStopped,
    });
  } catch (error) {
    next(error);
  }
});
router.post('/calls/:linkToken/fail', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const { markFailed } = require('../lib/calls/callSessions');
    const isAgoraAgent = session.agentId && !['openai_realtime', 'browser_speech'].includes(session.agentId);
    if (isAgoraAgent) {
      try {
        await require('../lib/calls/agoraAgentService').stopAgent(session);
      } catch (_) {
        /* best-effort stop */
      }
    }
    await markFailed(session.sessionId, 'Customer voice startup failed');
    await writeAuditEvent({
      organizationId: session.organizationId,
      dealId: session.dealId,
      sessionId: session.sessionId,
      eventType: EVENT_TYPES.CALL_FAILED,
      trigger: 'Customer voice startup failed',
    });
    res.json({ sessionId: session.sessionId, status: 'FAILED' });
  } catch (error) {
    next(error);
  }
});
router.post('/calls/:linkToken/activity', async (req, res, next) => {
  try {
    const { eventType } = parse(callActivitySchema, req.body);
    const session = await activeSessionFromCredential(req);
    const trigger = {
      AGENT_AUDIO_PUBLISHED: 'Agora agent published an audio track to the customer browser',
      CUSTOMER_AUDIO_PLAYBACK_STARTED: 'Customer browser started agent audio playback',
      AGENT_AUDIO_TIMEOUT: 'Customer browser did not receive agent audio before timeout',
      CUSTOMER_AUDIO_PLAYBACK_FAILED: 'Customer browser could not start agent audio playback',
    }[eventType];
    await writeAuditEvent({
      organizationId: session.organizationId,
      dealId: session.dealId,
      sessionId: session.sessionId,
      eventType,
      trigger,
      actionResult: { source: 'customer_browser', verified: false },
    });
    res.status(202).json({ status: 'RECORDED' });
  } catch (error) {
    next(error);
  }
});
router.post('/tts/sarvam', async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const expectedSecret = process.env.INTERNAL_API_KEY;
    if (expectedSecret && (!authHeader || authHeader !== `Bearer ${expectedSecret}`)) {
      return res.status(401).json({
        error: { message: 'Unauthorized', type: 'authentication_error', code: 'invalid_token' },
      });
    }

    const { input, voice, speed, sample_rate } = req.body; // OpenAI TTS payload from Agora generic_http
    if (!input) {
      return res.status(400).json({
        error: { message: 'Missing input text', type: 'invalid_request_error', code: 'missing_parameter' },
      });
    }

    const sarvamApiKey = process.env.SARVAM_API_KEY;
    if (!sarvamApiKey) {
      return res.status(503).json({
        error: { message: 'Sarvam API key not configured', type: 'server_error', code: 'service_unavailable' },
      });
    }

    // Agora generic_http requires raw PCM (linear16) output.
    // Default speaker is Ishita (en-IN) using Bulbul v3.
    // Explicitly set speech_sample_rate to match Agora's playback sample rate (16000).
    const requestedSampleRate = typeof sample_rate === 'number' ? sample_rate : 16000;
    const sarvamPayload = {
      text: input,
      model: process.env.SARVAM_MODEL || 'bulbul:v3',
      language_code: process.env.SARVAM_LANGUAGE || 'en-IN',
      speaker: voice || process.env.SARVAM_SPEAKER || 'ishita',
      pace: typeof speed === 'number' ? speed : 1.0,
      speech_sample_rate: requestedSampleRate,
      output_audio_codec: 'linear16', // Returns pure 16-bit linear PCM without RIFF/WAV header
    };

    const start = Date.now();
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': sarvamApiKey,
      },
      body: JSON.stringify(sarvamPayload),
    });
    const latency = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Sarvam TTS API failed:', response.status, errorText);
      return res.status(502).json({
        error: { message: 'Upstream TTS provider failed', type: 'upstream_error', code: response.status },
      });
    }

    const data = await response.json();
    if (!data.audios || data.audios.length === 0) {
      return res.status(502).json({
        error: { message: 'No audio returned by TTS provider', type: 'upstream_error', code: 'empty_audio' },
      });
    }

    const audioBuffer = Buffer.from(data.audios[0], 'base64');
    console.info('Sarvam TTS OK', { speaker: sarvamPayload.speaker, latency, audioBytes: audioBuffer.length });
    // Agora Conversational AI generic_http expects audio/pcm stream
    res.setHeader('Content-Type', 'audio/pcm');
    res.setHeader('Content-Length', audioBuffer.length);
    res.status(200).send(audioBuffer);
  } catch (error) {
    console.error('Sarvam proxy unhandled exception:', error);
    res.status(500).json({
      error: { message: 'Internal TTS proxy error', type: 'server_error', code: 'internal_error' },
    });
  }
});

router.post('/auth/provision', async (req, res, next) => {
  try {
    const header = req.get('authorization');
    const match = typeof header === 'string' && header.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1] : null;
    if (!token) throw new HttpError(401, 'Missing Firebase ID token');
    const { admin } = require('../lib/firebase/admin');
    const decoded = await admin.auth().verifyIdToken(token);
    const orgId = 'dealforge-staging';

    // 1. Ensure Custom User Claims for manager role
    if (decoded.role !== 'manager' || decoded.organizationId !== orgId) {
      await admin.auth().setCustomUserClaims(decoded.uid, { role: 'manager', organizationId: orgId });
    }

    // 2. Ensure Firestore members/{uid} document with ACTIVE status
    await db
      .collection('members')
      .doc(decoded.uid)
      .set(
        {
          uid: decoded.uid,
          email: decoded.email || null,
          displayName: decoded.name || null,
          organizationId: orgId,
          role: 'manager',
          status: 'ACTIVE',
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

    // 3. Ensure organization document exists
    await db.collection('organizations').doc(orgId).set(
      {
        organizationId: orgId,
        name: 'DealForge Staging',
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return res.json({
      success: true,
      uid: decoded.uid,
      role: 'manager',
      organizationId: orgId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
