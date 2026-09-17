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
  const credential =
    req.body?.sessionCredential ||
    req.query?.sessionCredential ||
    req.query?.credential ||
    req.headers?.['x-session-credential'];
  const { sessionCredential } = parse(sessionCredentialSchema, { sessionCredential: credential });
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

router.all('/calls/:linkToken/events', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write(': ping\n\n');
    if (typeof res.flush === 'function') res.flush();

    res.write(`event: connected\ndata: ${JSON.stringify({ sessionId: session.sessionId })}\n\n`);
    if (typeof res.flush === 'function') res.flush();

    const keepAliveInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
        if (typeof res.flush === 'function') res.flush();
      }
    }, 15000);

    const connectTime = new Date(Date.now() - 5000).toISOString();
    const { claimApprovedApprovals, completeApproval } = require('../lib/policy/approvalQueue');
    const { executeTool } = require('../lib/tools/registry');
    const { streamSpeech } = require('../lib/tts/elevenlabsStreamingTts');

    const eventsRef = db.collection('callSessions').doc(session.sessionId).collection('events');
    const unsubscribe = eventsRef
      .where('resolvedAt', '>=', connectTime)
      .onSnapshot(
        async (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (change.type !== 'added') continue;
            const eventDoc = change.doc;
            const eventData = eventDoc.data();
            if (eventData.eventType !== 'APPROVAL_RESOLVED') continue;

            // Atomic claim of event document
            let shouldProcess = false;
            await db.runTransaction(async (tx) => {
              const current = await tx.get(eventDoc.ref);
              if (!current.exists || current.data().processed) return;
              tx.update(eventDoc.ref, { processed: true, processedAt: new Date().toISOString() });
              shouldProcess = true;
            });

            if (!shouldProcess) continue;

            console.log(
              `[PROACTIVE_APPROVAL] Handling ${eventData.decision} for approval ${eventData.approvalId} on session ${session.sessionId}`,
            );

            let spoken = '';
            if (eventData.decision === 'APPROVED') {
              const claimedList = await claimApprovedApprovals({
                organizationId: session.organizationId,
                dealId: session.dealId,
                sessionId: session.sessionId,
              });
              const approval = claimedList.find((a) => a.approvalId === eventData.approvalId) || claimedList[0];
              if (approval) {
                const executed = await executeTool(approval.exactToolName, approval.exactValidatedArguments, {
                  organizationId: session.organizationId,
                  dealId: session.dealId,
                  sessionId: session.sessionId,
                  approvedReplay: {
                    approvalId: approval.approvalId,
                    toolName: approval.exactToolName,
                    args: approval.exactValidatedArguments,
                  },
                });
                if (executed.approved) {
                  await completeApproval(approval.approvalId, session.organizationId);
                }
              }
              spoken = 'Good news — my manager approved that concession, so I can apply it.';
            } else {
              spoken = "My manager couldn't approve that concession, but I can still look at other options.";
            }

            // Persist assistant message
            await addMessage(session.sessionId, { role: 'assistant', content: spoken });

            await writeAuditEvent({
              organizationId: session.organizationId,
              dealId: session.dealId,
              sessionId: session.sessionId,
              eventType: EVENT_TYPES.AGENT_RESPONSE_COMPLETED,
              trigger: `Proactive approval resolution (${eventData.decision}) spoken to customer`,
              actionResult: { verified: true, spoken, decision: eventData.decision },
            });

            const isAgoraAgent = session.agentId && !['openai_realtime', 'browser_speech'].includes(session.agentId);
            if (isAgoraAgent) {
              await speakAgent(session, spoken, { priority: 'INTERRUPT', interruptable: false }).catch((e) =>
                console.warn('speakAgent note:', e.message),
              );
            }

            let chunkIdx = 0;
            try {
              await streamSpeech(spoken, {
                onChunk: ({ audioBase64, contentType, isFinal }) => {
                  if (audioBase64 && !res.writableEnded) {
                    res.write(
                      `event: audio_chunk\ndata: ${JSON.stringify({
                        chunkIndex: chunkIdx++,
                        audioBase64,
                        contentType: contentType || 'audio/pcm;rate=24000',
                        isFinal: Boolean(isFinal),
                        proactive: true,
                      })}\n\n`,
                    );
                    if (typeof res.flush === 'function') res.flush();
                  }
                },
              });
            } catch (ttsErr) {
              console.warn('[PROACTIVE_APPROVAL] TTS error:', ttsErr.message);
            }

            if (!res.writableEnded) {
              res.write(`event: text\ndata: ${JSON.stringify({ assistantText: spoken, proactive: true })}\n\n`);
            }
          }
        },
        (err) => {
          console.warn('[PROACTIVE_APPROVAL] Listener note:', err.message);
        },
      );

    req.on('close', () => {
      clearInterval(keepAliveInterval);
      unsubscribe();
    });
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
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      res.write(': ping\n\n');
      if (typeof res.flush === 'function') res.flush();

      const s2 = Date.now();
      const { executeCustomerTurn } = require('../lib/agent/agentRuntime');
      const { streamSpeech } = require('../lib/tts/elevenlabsStreamingTts');

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
            const ttsStart = Date.now();
            let subChunk = 0;
            const ttsRes = await streamSpeech(sentence, {
              onChunk: ({ chunkIndex: cIdx, audioBase64, contentType, isFinal }) => {
                if (audioBase64 && !res.writableEnded) {
                  if (!s13) s13 = Date.now();
                  audioChunks.push(audioBase64);
                  res.write(
                    `event: audio_chunk\ndata: ${JSON.stringify({
                      chunkIndex: idx * 1000 + (cIdx !== undefined ? cIdx : subChunk++),
                      audioBase64,
                      contentType: contentType || 'audio/pcm;rate=24000',
                      isFinal: Boolean(isFinal),
                    })}\n\n`,
                  );
                  if (typeof res.flush === 'function') res.flush();
                }
              },
            });
            const ttsMs = Date.now() - ttsStart;
            console.log(
              `[VOICE_PIPELINE] Sentence #${idx} TTS OK chunks=${ttsRes.totalChunks} tts_ms=${ttsMs} contentType=${ttsRes.contentType}`,
            );
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
      // Split on period, question mark, or exclamation mark followed by space.
      // Natural language complete sentences are enqueued immediately without 40-char gate.
      // ────────────────────────────────────────────────────────────────────────
      const SENTENCE_END = /(?<=[.?!])\s+/;

      const onTextChunk = (delta) => {
        sentenceBuffer += delta;
        fullText += delta;

        // Split at sentence boundaries and enqueue each complete sentence immediately
        const parts = sentenceBuffer.split(SENTENCE_END);
        if (parts.length > 1) {
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i].trim();
            if (part) {
              enqueueSentence(part);
            }
          }
          sentenceBuffer = parts[parts.length - 1];
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
        const { streamSpeech } = require('../lib/tts/elevenlabsStreamingTts');
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
