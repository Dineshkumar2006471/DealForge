const express = require('express');
const { redeemLink, rtcCredentials, webhookTokenFor, findSessionByHash, endSession, sessionRef } = require('../lib/calls/callSessions');
const { startAgent, speakAgent } = require('../lib/calls/agoraAgentService');
const { parse, sessionCredentialSchema, callActivitySchema } = require('../lib/schema/validation');
const { writeAuditEvent } = require('../lib/audit/eventStore');
const { EVENT_TYPES } = require('../lib/audit/eventTypes');
const { HttpError } = require('../lib/security/auth');
const { createRateLimit } = require('../lib/security/rateLimit');
const { runPostCallAutopilot } = require('../lib/agent/postCallAutopilot');
const router = express.Router();
const joinRateLimit = createRateLimit({ scope: 'public-call-join', limit: 8, windowMs: 60_000 });
const { db, admin } = require('../lib/firebase/admin');

router.post('/calls/:linkToken/join', joinRateLimit, async (req, res, next) => {
  try {
    const { session, refreshToken } = await redeemLink(req.params.linkToken);
    const doc = await require('../lib/calls/callSessions').sessionRef(session.sessionId).get();
    const stored = doc.data();
    const agentId = await startAgent(stored, webhookTokenFor(stored.sessionId));
    const activeDoc = await require('../lib/calls/callSessions').sessionRef(stored.sessionId).get();
    const activeSession = activeDoc.data();
    const credentials = rtcCredentials(activeSession);
    await writeAuditEvent({ organizationId: activeSession.organizationId, dealId: activeSession.dealId, sessionId: activeSession.sessionId, eventType: EVENT_TYPES.CALL_STARTED, trigger: 'Customer joined verified call link' });
    
    // Mint custom token for customer read-only access to their session
    const customerAuthToken = await admin.auth().createCustomToken(String(activeSession.customerUid), { 
      role: 'customer', 
      sessionId: activeSession.sessionId 
    });
    
    res.json({ ...credentials, sessionId: activeSession.sessionId, agentId, sessionCredential: refreshToken, customerAuthToken });
  } catch (error) { next(error); }
});
async function activeSessionFromCredential(req) {
  const { sessionCredential } = parse(sessionCredentialSchema, req.body);
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
      await speakAgent(session, "Hello, I'm the DealForge sales assistant. I'm ready to help with your team, timeline, or pricing needs.");
      await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.AGENT_GREETING_REQUESTED, trigger: 'Customer RTC ready; Agora greeting requested', actionResult: { accepted: true } });
    }
    res.status(202).json({ status: shouldSpeak ? 'GREETING_REQUESTED' : 'ALREADY_READY' });
  } catch (error) { next(error); }
});
router.post('/calls/:linkToken/stop', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    let agentStopped = true;
    try { await require('../lib/calls/agoraAgentService').stopAgent(session); } catch (_) { agentStopped = false; }
    await endSession(session.sessionId);
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.CALL_ENDED, trigger: agentStopped ? 'Customer left call' : 'Customer left; Agora cleanup pending', actionResult: { agentStopped } });
    try { await runPostCallAutopilot(session); } catch (autopilotError) { console.error('Post-call autopilot failed:', autopilotError.message); }
    res.status(agentStopped ? 200 : 202).json({ sessionId: session.sessionId, status: agentStopped ? 'ENDED' : 'ENDED_WITH_AGENT_CLEANUP_ERROR', agentStopped });
  } catch (error) { next(error); }
});
router.post('/calls/:linkToken/fail', async (req, res, next) => {
  try {
    const session = await activeSessionFromCredential(req);
    const { markFailed } = require('../lib/calls/callSessions');
    try { await require('../lib/calls/agoraAgentService').stopAgent(session); } finally { await markFailed(session.sessionId, 'Customer RTC startup failed'); }
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.CALL_FAILED, trigger: 'Customer RTC startup failed' });
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
module.exports = router;
