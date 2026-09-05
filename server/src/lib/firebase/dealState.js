/**
 * Firestore Deal State CRUD
 *
 * Evidence-backed field writer with confidence-gated writes.
 * deals/{dealId} is the single source of truth.
 */
const { db } = require('./admin');
const { CONFIDENCE_THRESHOLDS } = require('../evidence/confidenceConfig');
const { v4: uuidv4 } = require('uuid');

/**
 * Get a deal document.
 */
async function getDeal(dealId, organizationId) {
  const doc = await db.collection('deals').doc(dealId).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (organizationId && data.organizationId !== organizationId) return null;
  return { id: doc.id, ...data };
}

/**
 * Create a new deal document.
 */
async function createDeal(dealId, dealState) {
  await db.collection('deals').doc(dealId).set(dealState);
  return { id: dealId, ...dealState };
}

/**
 * Update a specific field on the deal with evidence-backed confidence check.
 *
 * Returns: { updated: boolean, reason: string }
 */
async function updateDealField(dealId, field, value, confidence, source, evidenceTurn, organizationId) {
  // Confidence gate
  if (confidence < CONFIDENCE_THRESHOLDS.REJECT) {
    return { updated: false, reason: `Confidence ${confidence} below reject threshold ${CONFIDENCE_THRESHOLDS.REJECT}` };
  }

  if (confidence < CONFIDENCE_THRESHOLDS.ACCEPT) {
    return { updated: false, reason: `Confidence ${confidence} in clarify range — ask clarifying question`, needsClarification: true };
  }

  const now = new Date().toISOString();
  const update = {
    [`${field}.value`]: value,
    [`${field}.confidence`]: confidence,
    [`${field}.source`]: source,
    [`${field}.evidence_turn`]: evidenceTurn,
    [`${field}.last_updated`]: now,
    updatedAt: now,
  };

  const ref = db.collection('deals').doc(dealId);
  await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, update); });
  return { updated: true, reason: `Field ${field} updated with confidence ${confidence}` };
}

async function updateDealWithEvidence({ organizationId, dealId, sessionId, field, value, confidence, source, evidenceTurn }) {
  if (confidence < CONFIDENCE_THRESHOLDS.REJECT) return { updated: false, reason: `Confidence ${confidence} below reject threshold ${CONFIDENCE_THRESHOLDS.REJECT}` };
  if (confidence < CONFIDENCE_THRESHOLDS.ACCEPT) return { updated: false, reason: `Confidence ${confidence} in clarify range — ask clarifying question`, needsClarification: true };
  const timestamp = new Date().toISOString(); const evidenceId = uuidv4(); const auditId = uuidv4(); const dealRef = db.collection('deals').doc(dealId);
  await db.runTransaction(async tx => {
    const deal = await tx.get(dealRef); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found');
    tx.update(dealRef, { [`${field}.value`]: value, [`${field}.confidence`]: confidence, [`${field}.source`]: source, [`${field}.evidence_turn`]: evidenceTurn, [`${field}.last_updated`]: timestamp, updatedAt: timestamp });
    tx.create(db.collection('evidence').doc(evidenceId), { evidenceId, organizationId, dealId, sessionId, claim: `${field} = ${value}`, utteranceTurn: evidenceTurn, confidence, source, dealStateField: field, timestamp });
    tx.create(db.collection('auditEvents').doc(auditId), { organizationId, dealId, sessionId, eventType: 'DEAL_STATE_UPDATED', trigger: `${field} updated from verified evidence`, evidence: [{ evidenceId, confidence }], timestamp });
  });
  return { updated: true, evidenceId, reason: `Field ${field} updated with confidence ${confidence}` };
}

/**
 * Update MEDDIC status for a specific pillar.
 */
async function updateMEDDIC(dealId, pillar, status, confidence, evidenceTurn, organizationId) {
  const now = new Date().toISOString();
  const ref = db.collection('deals').doc(dealId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    [`meddic.${pillar}.status`]: status,
    [`meddic.${pillar}.confidence`]: confidence,
    [`meddic.${pillar}.evidence_turn`]: evidenceTurn,
    updatedAt: now,
  }); });
}

/**
 * Update conversation stage.
 */
async function updateConversationStage(dealId, stage, organizationId) {
  const ref = db.collection('deals').doc(dealId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    conversationStage: stage,
    updatedAt: new Date().toISOString(),
  }); });
}

/**
 * Append to discount ledger.
 */
async function appendDiscountLedger(dealId, entry, organizationId) {
  const admin = require('firebase-admin');
  const ref = db.collection('deals').doc(dealId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    discountLedger: admin.firestore.FieldValue.arrayUnion(entry),
    updatedAt: new Date().toISOString(),
  }); });
}

/**
 * Update next best action.
 */
async function updateNextBestAction(dealId, nextBestAction, organizationId) {
  const ref = db.collection('deals').doc(dealId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    nextBestAction: { ...nextBestAction, generatedAt: nextBestAction.generatedAt || new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  }); });
}

async function updateDealHealth(dealId, dealHealth, organizationId) {
  const ref = db.collection('deals').doc(dealId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, { dealHealth, updatedAt: new Date().toISOString() }); });
}

/**
 * Set escalation flag.
 */
async function setEscalation(dealId, reason, urgency, organizationId) {
  const ref = db.collection('deals').doc(dealId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    escalation: { flagged: true, reason, urgency, timestamp: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  }); });
}

/**
 * Append to negotiation memory.
 */
async function appendNegotiationMemory(dealId, memoryEntry, organizationId) {
  const { FieldValue } = require('./admin').admin.firestore;
  const ref = db.collection('deals').doc(dealId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    negotiationMemory: FieldValue.arrayUnion(memoryEntry),
    negotiationSummary: { lastEvent: memoryEntry.type || memoryEntry.preference || 'NEGOTIATION_SIGNAL', requestedPct: memoryEntry.requestedPct ?? null, offeredPct: memoryEntry.offeredPct ?? null, urgency: memoryEntry.urgency ?? null, status: memoryEntry.status ?? null, updatedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  }); });
}

module.exports = {
  getDeal,
  createDeal,
  updateDealField,
  updateDealWithEvidence,
  updateMEDDIC,
  updateConversationStage,
  appendDiscountLedger,
  updateNextBestAction,
  updateDealHealth,
  setEscalation,
  appendNegotiationMemory,
};
