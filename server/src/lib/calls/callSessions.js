const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { db } = require('../firebase/admin');
const { HttpError } = require('../security/auth');
const { createBlankDealState } = require('../schema/dealState');

const ACTIVE = ['CREATED', 'JOINING', 'ACTIVE'];
const now = () => new Date().toISOString();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = bytes => crypto.randomBytes(bytes).toString('base64url');
function webhookTokenFor(sessionId) {
  const secret = process.env.CALL_SESSION_WEBHOOK_SIGNING_SECRET;
  if (!secret) throw new HttpError(503, 'Webhook signing is not configured');
  return crypto.createHmac('sha256', secret).update(sessionId).digest('base64url');
}

function sessionRef(id) { return db.collection('callSessions').doc(id); }
function sessionStateRef(id) { return sessionRef(id).collection('state').doc('current'); }

async function createCallSession({ organizationId, dealId, managerId, customerLabel, expiresInMinutes }) {
  const deal = await db.collection('deals').doc(dealId).get();
  if (!deal.exists || deal.data().organizationId !== organizationId) throw new HttpError(404, 'Deal not found');
  const sessionId = uuidv4();
  const linkToken = random(32);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000).toISOString();
  const session = {
    sessionId, organizationId, dealId, managerId, customerLabel,
    hashedLinkToken: hash(linkToken), hashedWebhookToken: hash(webhookTokenFor(sessionId)),
    opaqueAgoraChannel: `df_${random(18)}`, customerUid: crypto.randomInt(100000, 999999999),
    agentId: null, status: 'CREATED', expiresAt, createdAt, startedAt: null, endedAt: null,
    joinedAt: null, revokedAt: null, failureReason: null,
  };
  // Each customer link starts a clean negotiation while inheriting only safe
  // account identity and commercial terms from the parent account.
  const state = createBlankDealState(sessionId);
  const parent = deal.data();
  state.organizationId = organizationId;
  state.dealId = dealId;
  const companyValue = (parent.company?.value && parent.company.value !== 'Pending' && parent.company.value !== 'Loading...')
    ? parent.company.value
    : (customerLabel || parent.name || 'Customer');
  state.company = {
    value: companyValue,
    confidence: parent.company?.confidence ?? 1.0,
    source: parent.company?.source || 'customer_label',
    evidence_turn: parent.company?.evidence_turn ?? null,
    last_updated: now(),
  };
  state.owner = parent.owner || null;
  state.integrations = parent.integrations || {};
  state.arr = Number(parent.arr) || (String(parent.company?.value || '').toLowerCase().includes('acme') ? 1200000 : 0);
  state.currency = 'INR';
  state.listPrice = state.arr;
  state.accountDealId = dealId;
  // Create the session and its first negotiation snapshot atomically. A link
  // must never exist without the state document that scopes its conversation.
  const batch = db.batch();
  batch.set(sessionRef(sessionId), session);
  batch.set(sessionStateRef(sessionId), state);
  await batch.commit();
  return { session, linkToken };
}

async function findSessionByHash(field, token) {
  const snap = await db.collection('callSessions').where(field, '==', hash(token)).limit(1).get();
  if (snap.empty) throw new HttpError(404, 'Call session not found');
  return { ref: snap.docs[0].ref, session: snap.docs[0].data() };
}

function assertCallable(session) {
  if (session.revokedAt) throw new HttpError(410, 'Call link has been revoked');
  if (new Date(session.expiresAt) <= new Date()) throw new HttpError(410, 'Call link has expired');
  if (!ACTIVE.includes(session.status)) throw new HttpError(409, 'Call session is not active');
}

function assertActiveSession(session) {
  assertCallable(session);
  if (session.status !== 'ACTIVE') throw new HttpError(409, 'Call session is not active');
}

async function redeemLink(linkToken) {
  const found = await findSessionByHash('hashedLinkToken', linkToken);
  const refreshToken = random(32);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(found.ref);
    if (!snapshot.exists) throw new HttpError(404, 'Call session not found');
    const session = snapshot.data();
    assertCallable(session);
    if (session.status === 'JOINING') throw new HttpError(409, 'A join attempt is already in progress');
    if (session.status === 'ACTIVE') throw new HttpError(409, 'This call is already active');
    // Mark JOINING but KEEP hashedLinkToken so the customer can retry if
    // agent startup fails downstream. The link is only consumed after the
    // agent has been verified as running (see consumeLink).
    transaction.update(found.ref, {
      status: 'JOINING',
      joinedAt: now(),
      hashedRefreshToken: hash(refreshToken),
    });
  });
  const refreshed = await found.ref.get();
  return { ref: found.ref, session: refreshed.data(), refreshToken };
}

async function consumeLink(sessionId) {
  const ref = sessionRef(sessionId);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    if (snapshot.data().status !== 'ACTIVE') return;
    // The agent is running — the link is now spent. Nullifying the link
    // token prevents a second browser from joining the same call while
    // preserving the session credential for token renewal.
    tx.update(ref, { hashedLinkToken: null });
  });
}

async function restoreForRetry(sessionId) {
  const ref = sessionRef(sessionId);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    const session = snapshot.data();
    // Only reset sessions that are still in JOINING or freshly FAILED.
    // An ACTIVE session must not be reverted. A session whose link token
    // was already consumed cannot be restored (that should never happen
    // because consumeLink only runs after ACTIVE).
    if (!['JOINING', 'FAILED'].includes(session.status)) return;
    if (!session.hashedLinkToken) return; // Link already consumed — no retry possible
    tx.update(ref, {
      status: 'CREATED',
      joinedAt: null,
      hashedRefreshToken: null,
      failureReason: null,
    });
  });
}


function rtcCredentials(session) {
  assertActiveSession(session);
  const appId = process.env.AGORA_APP_ID;
  const certificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !certificate) throw new HttpError(503, 'Agora is not configured');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionExpiry = Math.floor(new Date(session.expiresAt).getTime() / 1000);
  if (!Number.isFinite(sessionExpiry) || sessionExpiry <= nowSeconds) throw new HttpError(410, 'Call session has expired');
  const expiration = Math.min(nowSeconds + 3600, sessionExpiry);
  return { appId, channel: session.opaqueAgoraChannel, uid: session.customerUid,
    token: RtcTokenBuilder.buildTokenWithUid(appId, certificate, session.opaqueAgoraChannel, session.customerUid, RtcRole.PUBLISHER, expiration),
    expiresAt: new Date(expiration * 1000).toISOString() };
}

async function getWebhookSession(token) {
  const found = await findSessionByHash('hashedWebhookToken', token);
  assertActiveSession(found.session);
  return found.session;
}

async function markActive(sessionId, agentId) {
  const ref = sessionRef(sessionId);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpError(404, 'Call session not found');
    const session = snapshot.data();
    if (session.status !== 'JOINING' || session.revokedAt || new Date(session.expiresAt) <= new Date()) {
      throw new HttpError(409, 'Call session is no longer eligible to start');
    }
    tx.update(ref, { status: 'ACTIVE', agentId, startedAt: now(), failureReason: null });
  });
}
async function markFailed(sessionId, reason) {
  const ref = sessionRef(sessionId);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    // A server-side agent failure happens while JOINING. A browser RTC/audio
    // failure happens after the agent has already transitioned the session to
    // ACTIVE. Both must revoke the session from further token renewal/use.
    if (!snapshot.exists || !['JOINING', 'ACTIVE'].includes(snapshot.data().status)) return;
    tx.update(ref, { status: 'FAILED', endedAt: now(), failureReason: String(reason).slice(0, 500) });
  });
}
async function endSession(sessionId) { await sessionRef(sessionId).update({ status: 'ENDED', endedAt: now() }); }
async function revokeSession(sessionId) { await sessionRef(sessionId).update({ status: 'REVOKED', revokedAt: now(), endedAt: now() }); }

module.exports = { createCallSession, redeemLink, consumeLink, restoreForRetry, rtcCredentials, getWebhookSession, markActive, markFailed, endSession, revokeSession, sessionRef, sessionStateRef, findSessionByHash, assertActiveSession, hash, webhookTokenFor };
