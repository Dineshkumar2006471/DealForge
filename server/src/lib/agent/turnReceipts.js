const crypto = require('crypto');
const { db, admin } = require('../firebase/admin');

const DUPLICATE_WINDOW_MS = 15_000;

function normalizedTurn(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function receiptIdFor(text) {
  return crypto.createHash('sha256').update(normalizedTurn(text)).digest('hex');
}

/**
 * Claims a short-lived, session-scoped receipt before an ASR turn reaches the
 * model. Agora may replay the same finalized utterance while reconnecting.
 * This is deliberately persisted so Cloud Run instances cannot race each other.
 */
async function claimTurnReceipt(sessionId, text) {
  const receiptId = receiptIdFor(text);
  const ref = db.collection('callSessions').doc(sessionId).collection('turnReceipts').doc(receiptId);
  const now = Date.now();
  let claimed = false;
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const previous = snapshot.exists ? Date.parse(snapshot.data().receivedAt || '') : NaN;
    if (!snapshot.exists || !Number.isFinite(previous) || now - previous >= DUPLICATE_WINDOW_MS) {
      tx.set(ref, {
        receiptId,
        sessionId,
        receivedAt: new Date(now).toISOString(),
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(now + 24 * 60 * 60 * 1000)),
      });
      claimed = true;
    }
  });
  return { claimed, receiptId };
}

module.exports = { DUPLICATE_WINDOW_MS, normalizedTurn, receiptIdFor, claimTurnReceipt };
