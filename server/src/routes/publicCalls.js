const express = require('express');
const { redeemLink, consumeLink, restoreForRetry, rtcCredentials, webhookTokenFor, findSessionByHash, endSession, sessionRef } = require('../lib/calls/callSessions');
const { startAgent, speakAgent } = require('../lib/calls/agoraAgentService');
const { parse, sessionCredentialSchema, callActivitySchema, meetingDetailsSchema, meetingBookingSchema } = require('../lib/schema/validation');
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
        trigger: 'Customer joined verified call link (openai_realtime)'
      });
      return res.json({
        voiceProvider: 'openai_realtime',
        clientSecret: realtime.clientSecret,
        expiresAt: realtime.expiresAt,
        model: realtime.model,
        sessionId: stored.sessionId,
        sessionCredential: refreshToken
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
        trigger: 'Customer joined verified call link (browser_speech)'
      });
      return res.json({
        voiceProvider: 'browser_speech',
        sessionId: stored.sessionId,
        sessionCredential: refreshToken
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
    await writeAuditEvent({ organizationId: activeSession.organizationId, dealId: activeSession.dealId, sessionId: activeSession.sessionId, eventType: EVENT_TYPES.CALL_STARTED, trigger: 'Customer joined verified call link (agora)' });
    
    res.json({ ...credentials, voiceProvider: 'agora', sessionId: activeSession.sessionId, agentId, sessionCredential: refreshToken });
  } catch (error) { next(error); }
});
async function activeSessionFromCredential(req) {
  const { sessionCredential } = parse(sessionCredentialSchema, { sessionCredential: req.body?.sessionCredential });
  const { session } = await findSessionByHash('hashedRefreshToken', sessionCredential);
  if (session.status !== 'ACTIVE' || session.revokedAt || new Date(session.expiresAt) <= new Date()) throw new HttpError(410, 'Call session is not active');
  return session;
}
router.post('/calls/:linkToken/token', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    res.json({ ...rtcCredentials(session), sessionId: session.sessionId });
  } catch (error) { next(error); }
});
// Customer transcript reads are authenticated with the same opaque, server-issued
// session credential as the RTC flow. This fallback keeps captions available if a
// browser cannot maintain its Firestore listener; it never accepts a customer
// supplied session ID or deal ID.
router.post('/calls/:linkToken/transcript', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const messages = await getHistory(session.sessionId);
    res.json({ sessionId: session.sessionId, messages: messages.filter(message => ['user', 'assistant'].includes(message?.role)) });
  } catch (error) { next(error); }
});
router.post('/calls/:linkToken/meeting-requests/latest', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const request = await getLatestMeetingRequest(session.sessionId);
    res.json({ sessionId: session.sessionId, request });
  } catch (error) { next(error); }
});
router.post('/calls/:linkToken/ready', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const ref = sessionRef(session.sessionId);
    let shouldSpeak = false;
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data().status !== 'ACTIVE') throw new HttpError(410, 'Call session is not active');
      if (!snapshot.data().greetingRequestedAt) {
        tx.update(ref, { greetingRequestedAt: new Date().toISOString() });
        shouldSpeak = true;
      }
    });
    if (shouldSpeak) {
      const greeting = "Hello, I'm the DealForge sales assistant. I'm ready to help with your team, timeline, or pricing needs.";
      await addMessage(session.sessionId, { role: 'assistant', content: greeting });
      const isAgoraAgent = session.agentId && !['openai_realtime', 'browser_speech'].includes(session.agentId);
      if (isAgoraAgent) {
        await speakAgent(session, greeting, { priority: 'INTERRUPT', interruptable: false });
      }
      await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.AGENT_GREETING_REQUESTED, trigger: 'Customer voice ready; greeting requested', actionResult: { accepted: true, provider: isAgoraAgent ? 'agora' : session.agentId } });

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
  } catch (error) { next(error); }
});

router.post('/calls/:linkToken/turn', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const userText = typeof req.body?.userText === 'string' ? req.body.userText.trim() : '';
    if (!userText) {
      return res.status(400).json({ error: 'userText is required' });
    }

    const { executeCustomerTurn } = require('../lib/agent/agentRuntime');
    const result = await executeCustomerTurn(session, userText);
    const assistantText = result.content || '';

    let audioBase64 = null;
    if (assistantText) {
      try {
        const { synthesizeSpeech } = require('../lib/tts/sarvamTtsService');
        const ttsRes = await synthesizeSpeech(assistantText, { codec: 'wav' });
        audioBase64 = ttsRes.audioBase64;
      } catch (err) {
        console.error('Sarvam TTS error for customer turn:', err.message);
      }
    }

    const request = await getLatestMeetingRequest(session.sessionId).catch(() => null);

    res.json({
      sessionId: session.sessionId,
      userText,
      assistantText,
      audioBase64,
      meetingRequest: request
    });
  } catch (error) { next(error); }
});
router.post('/calls/:linkToken/meeting-requests/:requestId/slots', async (req, res, next) => {
  try {
    const input = parse(meetingDetailsSchema, req.body);
    const session = await activeSessionFromCredential({ ...req, body: input });
    const result = await findMeetingSlots(session, req.params.requestId, input);
    res.json(result);
  } catch (error) { next(error); }
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
      await speakAgent(session, spoken, { priority: 'APPEND', interruptable: true }).catch(error => console.warn('Verified meeting outcome could not be spoken:', error.message));
    }
    res.status(outcome.booked ? 201 : 409).json({ ...outcome, spoken });
  } catch (error) { next(error); }
});
router.post('/calls/:linkToken/stop', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    let agentStopped = true;
    const isAgoraAgent = session.agentId && !['openai_realtime', 'browser_speech'].includes(session.agentId);
    if (isAgoraAgent) {
      try { await require('../lib/calls/agoraAgentService').stopAgent(session); } catch (_) { agentStopped = false; }
    }
    await endSession(session.sessionId);
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.CALL_ENDED, trigger: agentStopped ? 'Customer left call' : 'Customer left; agent cleanup pending', actionResult: { agentStopped } });
    try { await runPostCallAutopilot(session); } catch (autopilotError) { console.error('Post-call autopilot failed:', autopilotError.message); }
    res.status(agentStopped ? 200 : 202).json({ sessionId: session.sessionId, status: agentStopped ? 'ENDED' : 'ENDED_WITH_AGENT_CLEANUP_ERROR', agentStopped });
  } catch (error) { next(error); }
});
router.post('/calls/:linkToken/fail', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const { markFailed } = require('../lib/calls/callSessions');
    const isAgoraAgent = session.agentId && !['openai_realtime', 'browser_speech'].includes(session.agentId);
    if (isAgoraAgent) {
      try { await require('../lib/calls/agoraAgentService').stopAgent(session); } catch (_) {}
    }
    await markFailed(session.sessionId, 'Customer voice startup failed');
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.CALL_FAILED, trigger: 'Customer voice startup failed' });
    res.json({ sessionId: session.sessionId, status: 'FAILED' });
  } catch (error) { next(error); }
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
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType, trigger, actionResult: { source: 'customer_browser', verified: false } });
    res.status(202).json({ status: 'RECORDED' });
  } catch (error) { next(error); }
});
router.post('/tts/sarvam', async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const expectedSecret = process.env.INTERNAL_API_KEY;
    if (expectedSecret && (!authHeader || authHeader !== `Bearer ${expectedSecret}`)) {
      return res.status(401).json({
        error: { message: 'Unauthorized', type: 'authentication_error', code: 'invalid_token' }
      });
    }

    const { input, voice, speed, sample_rate } = req.body; // OpenAI TTS payload from Agora generic_http
    if (!input) {
      return res.status(400).json({
        error: { message: 'Missing input text', type: 'invalid_request_error', code: 'missing_parameter' }
      });
    }

    const sarvamApiKey = process.env.SARVAM_API_KEY;
    if (!sarvamApiKey) {
      return res.status(503).json({
        error: { message: 'Sarvam API key not configured', type: 'server_error', code: 'service_unavailable' }
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
      output_audio_codec: 'linear16' // Returns pure 16-bit linear PCM without RIFF/WAV header
    };

    const start = Date.now();
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': sarvamApiKey
      },
      body: JSON.stringify(sarvamPayload)
    });
    const latency = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Sarvam TTS API failed:', response.status, errorText);
      return res.status(502).json({
        error: { message: 'Upstream TTS provider failed', type: 'upstream_error', code: response.status }
      });
    }

    const data = await response.json();
    if (!data.audios || data.audios.length === 0) {
      return res.status(502).json({
        error: { message: 'No audio returned by TTS provider', type: 'upstream_error', code: 'empty_audio' }
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
      error: { message: 'Internal TTS proxy error', type: 'server_error', code: 'internal_error' }
    });
  }
});


module.exports = router;
