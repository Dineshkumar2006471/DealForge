/*
 * Creates two clearly labelled, completed demo call sessions for the isolated
 * DealForge staging project. It never creates a redeemable customer link and
 * refuses to run outside the named staging project.
 *
 * Usage:
 *   $env:GCP_PROJECT_ID='dealforge-507515'
 *   $env:SEED_ORGANIZATION_ID='dealforge-staging'
 *   $env:DEMO_SEED_CONFIRM='staging-demo-call-activity'
 *   node scripts/seedStagingDemoActivity.js
 */
const crypto = require('crypto');
const { db } = require('../src/lib/firebase/admin');

const STAGING_PROJECT_ID = 'dealforge-507515';
const CONFIRMATION = 'staging-demo-call-activity';
const DEAL_ID = 'staging-negotiation-001';

const hash = () => crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');

function session({ sessionId, createdAt, startedAt, endedAt, label }) {
  return {
    sessionId,
    organizationId: process.env.SEED_ORGANIZATION_ID,
    dealId: DEAL_ID,
    managerId: 'demo-seed',
    // These sessions are ended and expired. Hashes are still present so they
    // retain the production document shape without storing any raw credential.
    hashedLinkToken: hash(),
    hashedWebhookToken: hash(),
    opaqueAgoraChannel: `demo_${sessionId}`,
    customerUid: 0,
    agentId: 'demo-agent',
    status: 'ENDED',
    expiresAt: '2026-09-05T00:00:00.000Z',
    createdAt,
    startedAt,
    endedAt,
    joinedAt: startedAt,
    revokedAt: null,
    failureReason: null,
    isDemo: true,
    demoLabel: label,
  };
}

function event({ eventId, sessionId, timestamp, eventType, trigger, actionResult }) {
  return {
    eventId,
    organizationId: process.env.SEED_ORGANIZATION_ID,
    dealId: DEAL_ID,
    sessionId,
    eventType,
    trigger,
    actionResult: { isDemo: true, ...actionResult },
    timestamp,
    isDemo: true,
  };
}

async function seedStagingDemoActivity() {
  if (process.env.GCP_PROJECT_ID !== STAGING_PROJECT_ID || process.env.DEMO_SEED_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing to seed: set GCP_PROJECT_ID=${STAGING_PROJECT_ID} and DEMO_SEED_CONFIRM=${CONFIRMATION}`);
  }
  if (!process.env.SEED_ORGANIZATION_ID) throw new Error('SEED_ORGANIZATION_ID is required');

  const deal = await db.collection('deals').doc(DEAL_ID).get();
  if (!deal.exists || deal.data().organizationId !== process.env.SEED_ORGANIZATION_ID) {
    throw new Error(`Expected ${DEAL_ID} in organization ${process.env.SEED_ORGANIZATION_ID}`);
  }

  const discovery = {
    sessionId: 'demo-discovery-20260903',
    createdAt: '2026-09-03T07:55:00.000Z',
    startedAt: '2026-09-03T08:00:00.000Z',
    endedAt: '2026-09-03T08:24:00.000Z',
    label: 'Demo scenario — discovery call',
  };
  const negotiation = {
    sessionId: 'demo-negotiation-20260904',
    createdAt: '2026-09-04T10:25:00.000Z',
    startedAt: '2026-09-04T10:30:00.000Z',
    endedAt: '2026-09-04T10:48:00.000Z',
    label: 'Demo scenario — commercial review',
  };

  const events = [
    event({ eventId: 'demo-discovery-started', sessionId: discovery.sessionId, timestamp: discovery.startedAt, eventType: 'CALL_STARTED', trigger: 'Demo scenario — Acme discovery call started' }),
    event({ eventId: 'demo-discovery-agent', sessionId: discovery.sessionId, timestamp: '2026-09-03T08:00:03.000Z', eventType: 'AGENT_STARTED', trigger: 'Demo scenario — Revenue agent connected' }),
    event({ eventId: 'demo-discovery-evidence', sessionId: discovery.sessionId, timestamp: '2026-09-03T08:11:00.000Z', eventType: 'TOOL_EXECUTED', trigger: 'Demo scenario — team-size evidence captured', actionResult: { verified: true } }),
    event({ eventId: 'demo-discovery-ended', sessionId: discovery.sessionId, timestamp: discovery.endedAt, eventType: 'CALL_ENDED', trigger: 'Demo scenario — discovery call completed' }),
    event({ eventId: 'demo-negotiation-started', sessionId: negotiation.sessionId, timestamp: negotiation.startedAt, eventType: 'CALL_STARTED', trigger: 'Demo scenario — Acme commercial review started' }),
    event({ eventId: 'demo-negotiation-approval', sessionId: negotiation.sessionId, timestamp: '2026-09-04T10:38:00.000Z', eventType: 'APPROVAL_REQUESTED', trigger: 'Demo scenario — 25% discount sent for manager review' }),
    event({ eventId: 'demo-negotiation-approved', sessionId: negotiation.sessionId, timestamp: '2026-09-04T10:42:00.000Z', eventType: 'APPROVAL_RESOLVED', trigger: 'Demo scenario — manager approved the commercial exception' }),
    event({ eventId: 'demo-negotiation-ended', sessionId: negotiation.sessionId, timestamp: negotiation.endedAt, eventType: 'CALL_ENDED', trigger: 'Demo scenario — commercial review completed' }),
  ];

  const batch = db.batch();
  batch.set(db.collection('callSessions').doc(discovery.sessionId), session(discovery));
  batch.set(db.collection('callSessions').doc(negotiation.sessionId), session(negotiation));
  for (const record of events) batch.set(db.collection('auditEvents').doc(record.eventId), record);
  await batch.commit();
  return { sessions: 2, events: events.length };
}

seedStagingDemoActivity()
  .then(result => { console.log(`Seeded ${result.sessions} demo call sessions and ${result.events} demo activity events.`); })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
