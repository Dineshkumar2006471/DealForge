const crypto = require('crypto');
const { db, admin } = require('../firebase/admin');

// Agora can replay a finalized ASR turn after it has already started the
// corresponding agent response. Keep the receipt long enough to cover a full
// streamed answer, not merely a transport retry.
const DUPLICATE_WINDOW_MS = 60_000;

function normalizedTurn(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    // ASR finalization often changes punctuation ("users" → "users."). It
    // must not create a second customer turn or second spoken answer.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function receiptIdFor(text) {
  return crypto.createHash('sha256').update(normalizedTurn(text)).digest('hex');
}

/**
 * Claims a short-lived, session-scoped receipt before an ASR turn reaches the
 * model. Agora or browser WebRTC may replay the same finalized utterance while reconnecting.
 * This is deliberately persisted so Cloud Run instances cannot race each other.
 * Supports explicit client-side turnId for strict turn idempotency.
 */
async function claimTurnReceipt(sessionId, text, turnId = null) {
  const receiptId = receiptIdFor(text);
  const receiptsCol = db.collection('callSessions').doc(sessionId).collection('turnReceipts');
  const textRef = receiptsCol.doc(receiptId);
  const turnRef = turnId ? receiptsCol.doc(`turn_${String(turnId).slice(0, 100)}`) : null;
  const now = Date.now();
  let claimed = false;
  let cachedResponse = null;

  await db.runTransaction(async tx => {
    const textSnapshot = await tx.get(textRef);
    let turnSnapshot = null;
    if (turnRef) {
      turnSnapshot = await tx.get(turnRef);
    }

    if (turnSnapshot && turnSnapshot.exists) {
      cachedResponse = turnSnapshot.data()?.assistantResponse || null;
      claimed = false;
      return;
    }

    const previous = textSnapshot.exists ? Date.parse(textSnapshot.data().receivedAt || '') : NaN;
    if (textSnapshot.exists && Number.isFinite(previous) && now - previous < DUPLICATE_WINDOW_MS) {
      cachedResponse = textSnapshot.data()?.assistantResponse || null;
      claimed = false;
      return;
    }

    const data = {
      receiptId,
      turnId: turnId || null,
      sessionId,
      receivedAt: new Date(now).toISOString(),
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(now + 24 * 60 * 60 * 1000)),
    };
    tx.set(textRef, data);
    if (turnRef) {
      tx.set(turnRef, data);
    }
    claimed = true;
  });

  return { claimed, receiptId, cachedResponse };
}

async function attachTurnResponse(sessionId, receiptId, turnId, assistantResponse) {
  if (!assistantResponse) return;
  try {
    const receiptsCol = db.collection('callSessions').doc(sessionId).collection('turnReceipts');
    const update = { assistantResponse, completedAt: new Date().toISOString() };
    if (receiptId) await receiptsCol.doc(receiptId).set(update, { merge: true });
    if (turnId) await receiptsCol.doc(`turn_${String(turnId).slice(0, 100)}`).set(update, { merge: true });
  } catch (err) {
    console.warn('Failed to cache turn response for idempotency:', err.message);
  }
}

module.exports = { DUPLICATE_WINDOW_MS, normalizedTurn, receiptIdFor, claimTurnReceipt, attachTurnResponse };
