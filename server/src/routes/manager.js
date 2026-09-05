const express = require('express');
const { db } = require('../lib/firebase/admin');
const { requireManager, HttpError } = require('../lib/security/auth');
const { parse, callLinkSchema, approvalResolutionSchema } = require('../lib/schema/validation');
const { createCallSession, endSession, sessionRef } = require('../lib/calls/callSessions');
const { stopAgent } = require('../lib/calls/agoraAgentService');
const { resolveApproval } = require('../lib/policy/approvalQueue');
const { writeAuditEvent } = require('../lib/audit/eventStore');
const { EVENT_TYPES } = require('../lib/audit/eventTypes');
const { runPostCallAutopilot } = require('../lib/agent/postCallAutopilot');
const router = express.Router();
router.use(requireManager);

router.post('/call-links', async (req, res, next) => {
  try {
    const input = parse(callLinkSchema, req.body);
    const { session, linkToken } = await createCallSession({ ...input, organizationId: req.manager.organizationId, managerId: req.manager.uid });
    const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, '');
    if (!publicAppUrl) throw new HttpError(503, 'Public application URL is not configured');
    res.status(201).json({ sessionId: session.sessionId, expiresAt: session.expiresAt, callUrl: `${publicAppUrl}/call.html?link=${encodeURIComponent(linkToken)}` });
  } catch (error) { next(error); }
});

router.post('/calls/:sessionId/stop', async (req, res, next) => {
  try {
    const ref = sessionRef(req.params.sessionId); const doc = await ref.get();
    if (!doc.exists || doc.data().organizationId !== req.manager.organizationId) throw new HttpError(404, 'Call session not found');
    const session = doc.data(); await stopAgent(session); await endSession(session.sessionId);
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.CALL_ENDED, trigger: 'Manager ended call' });
    try { await runPostCallAutopilot(session); } catch (autopilotError) { console.error('Post-call autopilot failed:', autopilotError.message); }
    res.json({ sessionId: session.sessionId, status: 'ENDED' });
  } catch (error) { next(error); }
});

router.post('/calls/:sessionId/revoke', async (req, res, next) => {
  try {
    const { revokeSession } = require('../lib/calls/callSessions'); const ref = sessionRef(req.params.sessionId); const doc = await ref.get();
    if (!doc.exists || doc.data().organizationId !== req.manager.organizationId) throw new HttpError(404, 'Call session not found');
    let agentStopped = true;
    try { await stopAgent(doc.data()); } catch (_) { agentStopped = false; }
    await revokeSession(req.params.sessionId);
    await writeAuditEvent({ organizationId: doc.data().organizationId, dealId: doc.data().dealId, sessionId: doc.data().sessionId, eventType: EVENT_TYPES.CALL_ENDED, trigger: agentStopped ? 'Manager revoked customer call link' : 'Manager revoked link; Agora cleanup pending', actionResult: { agentStopped } });
    res.status(agentStopped ? 200 : 202).json({ sessionId: req.params.sessionId, status: agentStopped ? 'REVOKED' : 'REVOKED_WITH_AGENT_CLEANUP_ERROR', agentStopped });
  } catch (error) { next(error); }
});

router.post('/approvals/:approvalId/resolve', async (req, res, next) => {
  try { res.json(await resolveApproval(req.params.approvalId, parse(approvalResolutionSchema, req.body).decision, req.manager)); }
  catch (error) { next(error); }
});

router.get('/integrations/status', async (_req, res) => {
  const configured = name => Boolean(process.env[name]);
  const agora = configured('AGORA_APP_ID') && configured('AGORA_CUSTOMER_ID') && configured('AGORA_CUSTOMER_SECRET') && configured('CLOUD_RUN_URL') ? 'AVAILABLE' : 'NOT CONFIGURED';
  const gemini = configured('GCP_PROJECT_ID') && configured('GEMINI_MODEL') ? 'AVAILABLE' : 'NOT CONFIGURED';
  let firestore = 'ERROR'; try { await db.collection('organizations').limit(1).get(); firestore = 'CONNECTED'; } catch (_) {}
  res.json({ agora, gemini, firestore, hubspot: configured('HUBSPOT_API_KEY') ? 'AVAILABLE' : 'NOT CONFIGURED', calcom: configured('CALCOM_API_KEY') ? 'AVAILABLE' : 'NOT CONFIGURED', slack: 'NOT CONFIGURED' });
});
router.get('/agent-status', async (req, res) => {
  const integrations = { agora: Boolean(process.env.AGORA_APP_ID), gemini: Boolean(process.env.GCP_PROJECT_ID && process.env.GEMINI_MODEL), firestore: true, hubspot: Boolean(process.env.HUBSPOT_API_KEY), calcom: Boolean(process.env.CALCOM_API_KEY) };
  const events = await db.collection('auditEvents').where('organizationId', '==', req.manager.organizationId).orderBy('timestamp', 'desc').limit(8).get();
  res.json({ voice: integrations.agora ? 'AVAILABLE' : 'NOT CONFIGURED', reasoning: integrations.gemini ? 'AVAILABLE' : 'NOT CONFIGURED', memory: integrations.firestore ? 'CONNECTED' : 'ERROR', policy: 'ENFORCING', integrations, recentActions: events.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
});
module.exports = router;
