/**
 * Evidence Store
 *
 * Writes evidence records to evidence/{evidenceId} collection.
 * Links evidence to deal state fields and utterance turns.
 */
const { db } = require('../firebase/admin');
const { v4: uuidv4 } = require('uuid');

/**
 * Store an evidence record.
 */
async function storeEvidence({ organizationId, dealId, sessionId, claim, utteranceTurn, confidence, source, dealStateField }) {
  const evidenceId = uuidv4();
  const record = {
    organizationId,
    dealId,
    sessionId,
    claim,
    utteranceTurn,
    confidence,
    source, // "customer_statement" | "inferred" | "tool_result"
    dealStateField, // "budget" | "teamSize" | etc.
    timestamp: new Date().toISOString(),
  };

  await db.collection('evidence').doc(evidenceId).set(record);
  return { evidenceId, ...record };
}

/**
 * Get all evidence for a deal.
 */
async function getEvidenceForDeal(dealId) {
  const snapshot = await db.collection('evidence')
    .where('dealId', '==', dealId)
    .orderBy('timestamp', 'asc')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Get evidence chain for a specific deal state field.
 * Answers: "Why does DealForge think teamSize is 300?"
 */
async function getEvidenceChain(dealId, field) {
  const snapshot = await db.collection('evidence')
    .where('dealId', '==', dealId)
    .where('dealStateField', '==', field)
    .orderBy('timestamp', 'asc')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

module.exports = {
  storeEvidence,
  getEvidenceForDeal,
  getEvidenceChain,
};
