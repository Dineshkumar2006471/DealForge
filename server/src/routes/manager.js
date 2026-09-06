const express = require('express');
const { db } = require('../lib/firebase/admin');
const { requireManager, HttpError } = require('../lib/security/auth');
const { parse, callLinkSchema, createDealSchema, approvalResolutionSchema, hubspotLinkSchema, bookingSyncSchema } = require('../lib/schema/validation');
const { createCallSession, endSession, sessionRef } = require('../lib/calls/callSessions');
const { stopAgent } = require('../lib/calls/agoraAgentService');
const { resolveApproval } = require('../lib/policy/approvalQueue');
const { writeAuditEvent } = require('../lib/audit/eventStore');
const { EVENT_TYPES } = require('../lib/audit/eventTypes');
const { runPostCallAutopilot } = require('../lib/agent/postCallAutopilot');
const { probeHubspot, verifyHubspotDeal, verifyBookingProperty } = require('../lib/integrations/hubspot');
const { probeCalcom } = require('../lib/tools/bookMeeting');
const { createBlankDealState } = require('../lib/schema/dealState');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
router.use(requireManager);

async function integrationStatus(organizationId, provider, toolName, probe) {
  const base = await probe();
  if (base.status !== 'AVAILABLE') return base.status;
  const operations = await db.collection('externalOperations')
    .where('organizationId', '==', organizationId)
    .limit(100)
    .get();
  const verifiedAction = operations.docs.some(doc => {
    const value = doc.data();
    return value.provider === provider && value.toolName === toolName && value.status === 'SUCCEEDED' && value.result?.verified === true;
  });
  return verifiedAction ? 'CONNECTED' : 'AVAILABLE';
}

router.post('/call-links', async (req, res, next) => {
  try {
    const input = parse(callLinkSchema, req.body);
    const { session, linkToken } = await createCallSession({ ...input, organizationId: req.manager.organizationId, managerId: req.manager.uid });
    const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, '');
    if (!publicAppUrl) throw new HttpError(503, 'Public application URL is not configured');
    res.status(201).json({ sessionId: session.sessionId, expiresAt: session.expiresAt, callUrl: `${publicAppUrl}/call.html?link=${encodeURIComponent(linkToken)}` });
  } catch (error) { next(error); }
});

// Browser clients cannot write deals directly. This manager-only route creates a
// blank, organization-bound Deal State that can then be populated by verified
// customer conversation evidence.
router.post('/deals', async (req, res, next) => {
  try {
    const input = parse(createDealSchema, req.body);
    const dealRef = db.collection('deals').doc();
    const createdAt = new Date().toISOString();
    const deal = createBlankDealState(null);
    deal.organizationId = req.manager.organizationId;
    deal.company = { value: input.company, confidence: 1, source: 'manager_input', evidence_turn: null, last_updated: createdAt };
    deal.arr = input.targetArr;
    deal.owner = { value: req.manager.uid, confidence: 1, source: 'manager_input', evidence_turn: null, last_updated: createdAt };
    deal.createdBy = req.manager.uid;
    deal.createdAt = createdAt;
    deal.updatedAt = createdAt;
    await db.runTransaction(async tx => {
      tx.create(dealRef, deal);
      tx.create(db.collection('auditEvents').doc(uuidv4()), {
        organizationId: req.manager.organizationId, dealId: dealRef.id, sessionId: null,
        eventType: EVENT_TYPES.DEAL_CREATED, trigger: 'Manager created a new Deal Workspace',
        actionResult: { company: input.company, targetArr: input.targetArr, verified: true }, timestamp: createdAt,
      });
    });
    res.status(201).json({ dealId: dealRef.id, company: input.company, targetArr: input.targetArr });
  } catch (error) { next(error); }
});

async function ownedDeal(dealId, organizationId) {
  const ref = db.collection('deals').doc(dealId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().organizationId !== organizationId) throw new HttpError(404, 'Deal not found');
  return { ref, data: snapshot.data() };
}

// A deal is the account-level commercial record. Each link creates a distinct
// call session beneath it, so managers must select a session before reviewing
// conversation-specific evidence, approvals, and audit activity. Never return
// bearer-token hashes or Agora credentials to the browser.
router.get('/deals/:dealId/call-sessions', async (req, res, next) => {
  try {
    await ownedDeal(req.params.dealId, req.manager.organizationId);
    const snapshot = await db.collection('callSessions')
      .where('organizationId', '==', req.manager.organizationId)
      .where('dealId', '==', req.params.dealId)
      .limit(50)
      .get();
    const sessions = snapshot.docs
      .map(doc => {
        const session = doc.data();
        return {
          sessionId: session.sessionId,
          status: session.status,
          createdAt: session.createdAt,
          startedAt: session.startedAt || null,
          endedAt: session.endedAt || null,
          expiresAt: session.expiresAt,
          failureReason: session.failureReason || null,
        };
      })
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    res.json({ dealId: req.params.dealId, sessions });
  } catch (error) { next(error); }
});

router.post('/deals/:dealId/integrations/hubspot/link', async (req, res, next) => {
  try {
    const { hubspotDealId } = parse(hubspotLinkSchema, req.body);
    const deal = await ownedDeal(req.params.dealId, req.manager.organizationId);
    const verified = await verifyHubspotDeal(hubspotDealId);
    await deal.ref.update({
      'integrations.hubspot.dealId': verified.hubspotDealId,
      'integrations.hubspot.linkedAt': new Date().toISOString(),
      'integrations.hubspot.linkedBy': req.manager.uid,
      'integrations.hubspot.bookingSyncEnabled': false,
    });
    await writeAuditEvent({ organizationId: req.manager.organizationId, dealId: req.params.dealId, sessionId: null, eventType: EVENT_TYPES.HUBSPOT_DEAL_LINKED, trigger: 'Manager linked verified HubSpot staging deal', actionResult: { hubspotDealId: verified.hubspotDealId, verified: true } });
    res.status(201).json({ linked: true, ...verified, bookingSyncEnabled: false });
  } catch (error) { next(error); }
});

router.post('/deals/:dealId/integrations/hubspot/booking-sync', async (req, res, next) => {
  try {
    const { enabled } = parse(bookingSyncSchema, req.body);
    const deal = await ownedDeal(req.params.dealId, req.manager.organizationId);
    const link = deal.data.integrations?.hubspot?.dealId;
    if (!link) throw new HttpError(409, 'Link a verified HubSpot deal before enabling booking sync');
    if (enabled) await verifyBookingProperty();
    await deal.ref.update({
      'integrations.hubspot.bookingSyncEnabled': enabled,
      'integrations.hubspot.bookingSyncUpdatedAt': new Date().toISOString(),
      'integrations.hubspot.bookingSyncUpdatedBy': req.manager.uid,
    });
    await writeAuditEvent({ organizationId: req.manager.organizationId, dealId: req.params.dealId, sessionId: null, eventType: EVENT_TYPES.HUBSPOT_BOOKING_SYNC_UPDATED, trigger: `Manager ${enabled ? 'enabled' : 'disabled'} verified booking-to-CRM sync`, actionResult: { enabled, verified: enabled } });
    res.json({ enabled });
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

router.get('/integrations/status', async (req, res) => {
  const configured = name => Boolean(process.env[name]);
  const agora = configured('AGORA_APP_ID') && configured('AGORA_CUSTOMER_ID') && configured('AGORA_CUSTOMER_SECRET') && configured('CLOUD_RUN_URL') ? 'AVAILABLE' : 'NOT CONFIGURED';
  const gemini = configured('GCP_PROJECT_ID') && configured('GEMINI_MODEL') ? 'AVAILABLE' : 'NOT CONFIGURED';
  let firestore = 'ERROR'; try { await db.collection('organizations').limit(1).get(); firestore = 'CONNECTED'; } catch (_) {}
  const [hubspot, calcom] = await Promise.all([
    integrationStatus(req.manager.organizationId, 'hubspot', 'sync_to_hubspot', probeHubspot),
    integrationStatus(req.manager.organizationId, 'calcom', 'book_meeting', probeCalcom),
  ]);
  res.json({ agora, gemini, firestore, hubspot, calcom, slack: 'NOT CONFIGURED' });
});
router.get('/agent-status', async (req, res) => {
  const [hubspot, calcom] = await Promise.all([
    integrationStatus(req.manager.organizationId, 'hubspot', 'sync_to_hubspot', probeHubspot),
    integrationStatus(req.manager.organizationId, 'calcom', 'book_meeting', probeCalcom),
  ]);
  const integrations = { agora: Boolean(process.env.AGORA_APP_ID && process.env.ELEVENLABS_API_KEY), gemini: Boolean(process.env.GCP_PROJECT_ID && process.env.GEMINI_MODEL), firestore: true, hubspot: hubspot === 'CONNECTED', calcom: calcom === 'CONNECTED' };
  const events = await db.collection('auditEvents').where('organizationId', '==', req.manager.organizationId).orderBy('timestamp', 'desc').limit(8).get();
  res.json({ voice: integrations.agora ? 'AVAILABLE' : 'NOT CONFIGURED', reasoning: integrations.gemini ? 'AVAILABLE' : 'NOT CONFIGURED', memory: integrations.firestore ? 'CONNECTED' : 'ERROR', policy: 'ENFORCING', integrations, recentActions: events.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
});
module.exports = router;
