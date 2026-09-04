/**
 * Conversation History
 *
 * Durable per-session conversation history, keyed by server-owned session ID.
 * Stores OpenAI-format messages for context continuity.
 */
const { db, admin } = require('../firebase/admin');
const { v4: uuidv4 } = require('uuid');

async function getHistory(sessionId) {
  const snap = await db.collection('callSessions').doc(sessionId).collection('messages').orderBy('sequence', 'desc').limit(50).get();
  return snap.docs.map(doc => doc.data().message).reverse();
}

async function addMessage(sessionId, message) {
  const sessionRef = db.collection('callSessions').doc(sessionId);
  const messageRef = sessionRef.collection('messages').doc(uuidv4());
  await db.runTransaction(async tx => {
    const session = await tx.get(sessionRef);
    if (!session.exists) throw new Error('Call session not found');
    const sequence = (session.data().messageSequence || 0) + 1;
    tx.set(messageRef, {
      sessionId,
      organizationId: session.data().organizationId,
      sequence,
      message,
      createdAt: new Date().toISOString(),
      // Firestore TTL requires a Timestamp, not an ISO string.
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 86400000)),
    });
    tx.update(sessionRef, { messageSequence: sequence });
  });
}

async function getTurnNumber(sessionId) {
  const history = await getHistory(sessionId);
  return history.filter(m => m.role === 'user').length;
}

async function clearHistory() { throw new Error('Conversation deletion is controlled by retention policy'); }

module.exports = { getHistory, addMessage, getTurnNumber, clearHistory };
