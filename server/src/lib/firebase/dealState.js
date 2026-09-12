/**
 * Firestore Deal State CRUD
 *
 * Evidence-backed field writer with confidence-gated writes.
 * deals/{dealId} is the single source of truth.
 */
const { db } = require('./admin');
const { CONFIDENCE_THRESHOLDS } = require('../evidence/confidenceConfig');
const { v4: uuidv4 } = require('uuid');

function stateRef(dealId, sessionId) {
  return sessionId
    ? db.collection('callSessions').doc(sessionId).collection('state').doc('current')
    : db.collection('deals').doc(dealId);
}

/**
 * Get a deal document.
 */
async function getDeal(dealId, organizationId, sessionId = null) {
  const doc = await stateRef(dealId, sessionId).get();
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
async function updateDealField(dealId, field, value, confidence, source, evidenceTurn, organizationId, sessionId = null) {
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

  const ref = stateRef(dealId, sessionId);
  await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, update); });
  return { updated: true, reason: `Field ${field} updated with confidence ${confidence}` };
}

async function updateDealWithEvidence({ organizationId, dealId, sessionId, field, value, confidence, source, evidenceTurn, turnId }) {
  if (confidence < CONFIDENCE_THRESHOLDS.REJECT) return { updated: false, reason: `Confidence ${confidence} below reject threshold ${CONFIDENCE_THRESHOLDS.REJECT}` };
  if (confidence < CONFIDENCE_THRESHOLDS.ACCEPT) return { updated: false, reason: `Confidence ${confidence} in clarify range — ask clarifying question`, needsClarification: true };
  const timestamp = new Date().toISOString(); const evidenceId = uuidv4(); const auditId = uuidv4(); const dealRef = stateRef(dealId, sessionId);
  const parentRef = db.collection('deals').doc(dealId);
  // Derive status from confidence: ≥ 0.85 → confirmed, ≥ 0.60 → likely, < 0.60 → needs_confirmation
  const status = confidence >= CONFIDENCE_THRESHOLDS.ACCEPT ? 'confirmed' : confidence >= CONFIDENCE_THRESHOLDS.CLARIFY ? 'likely' : 'needs_confirmation';
  // Structured source object with type and turnId
  const structuredSource = typeof source === 'object' ? source : { type: source || 'customer_utterance', turnId: turnId || `turn_${evidenceTurn}` };
  const fieldUpdate = {
    [`${field}.value`]: value,
    [`${field}.status`]: status,
    [`${field}.confidence`]: confidence,
    [`${field}.source`]: structuredSource,
    [`${field}.updatedAt`]: timestamp,
    updatedAt: timestamp
  };
  await db.runTransaction(async tx => {
    const deal = await tx.get(dealRef); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found');
    tx.update(dealRef, fieldUpdate);
    if (sessionId) {
      const parent = await tx.get(parentRef);
      if (parent.exists && parent.data().organizationId === organizationId) {
        tx.update(parentRef, fieldUpdate);
      }
    }
    tx.create(db.collection('evidence').doc(evidenceId), { evidenceId, organizationId, dealId, sessionId, claim: `${field} = ${value}`, utteranceTurn: evidenceTurn, confidence, source: structuredSource, status, dealStateField: field, timestamp });
    tx.create(db.collection('auditEvents').doc(auditId), { organizationId, dealId, sessionId, eventType: 'DEAL_STATE_UPDATED', trigger: `${field} updated from verified evidence`, evidence: [{ evidenceId, confidence, status }], timestamp });
  });
  return { updated: true, evidenceId, status, reason: `Field ${field} updated with confidence ${confidence} (${status})` };
}

/**
 * Update MEDDIC status for a specific pillar.
 */
async function updateMEDDIC(dealId, pillar, status, confidence, evidenceTurn, organizationId, sessionId = null, extra = {}) {
  const now = new Date().toISOString();
  const ref = stateRef(dealId, sessionId);
  const parentRef = db.collection('deals').doc(dealId);
  // Derive status from confidence if not explicitly provided
  const derivedStatus = status || (confidence >= CONFIDENCE_THRESHOLDS.ACCEPT ? 'confirmed' : confidence >= CONFIDENCE_THRESHOLDS.CLARIFY ? 'likely' : 'needs_confirmation');
  const structuredSource = extra.source && typeof extra.source === 'object' ? extra.source : { type: extra.source || 'customer_turn', turnId: extra.turnId || `turn_${evidenceTurn}` };
  const meddicUpdate = {
    [`meddic.${pillar}.status`]: derivedStatus,
    [`meddic.${pillar}.confidence`]: confidence,
    [`meddic.${pillar}.source`]: structuredSource,
    [`meddic.${pillar}.updatedAt`]: now,
    updatedAt: now,
  };
  if (extra.value !== undefined) meddicUpdate[`meddic.${pillar}.value`] = extra.value;

  await db.runTransaction(async tx => {
    const deal = await tx.get(ref);
    if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found');
    tx.update(ref, meddicUpdate);
    if (sessionId) {
      const parent = await tx.get(parentRef);
      if (parent.exists && parent.data().organizationId === organizationId) {
        tx.update(parentRef, meddicUpdate);
      }
    }
  });
}

/**
 * Update conversation stage.
 */
async function updateConversationStage(dealId, stage, organizationId, sessionId = null) {
  const ref = stateRef(dealId, sessionId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    conversationStage: stage,
    updatedAt: new Date().toISOString(),
  }); });
}

/**
 * Append to discount ledger.
 */
async function appendDiscountLedger(dealId, entry, organizationId, sessionId = null) {
  const { admin } = require('./admin');
  const ref = stateRef(dealId, sessionId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    discountLedger: admin.firestore.FieldValue.arrayUnion(entry),
    updatedAt: new Date().toISOString(),
  }); });
}

/**
 * Update next best action.
 */
async function updateNextBestAction(dealId, nextBestAction, organizationId, sessionId = null) {
  const ref = stateRef(dealId, sessionId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    nextBestAction: { ...nextBestAction, generatedAt: nextBestAction.generatedAt || new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  }); });
}

async function updateDealHealth(dealId, dealHealth, organizationId, sessionId = null) {
  const ref = stateRef(dealId, sessionId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, { dealHealth, updatedAt: new Date().toISOString() }); });
}

/**
 * Set escalation flag.
 */
async function setEscalation(dealId, reason, urgency, organizationId, sessionId = null) {
  const ref = stateRef(dealId, sessionId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
    escalation: { flagged: true, reason, urgency, timestamp: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  }); });
}

/**
 * Append to negotiation memory.
 */
async function appendNegotiationMemory(dealId, memoryEntry, organizationId, sessionId = null) {
  const { FieldValue } = require('./admin').admin.firestore;
  const ref = stateRef(dealId, sessionId); await db.runTransaction(async tx => { const deal = await tx.get(ref); if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found'); tx.update(ref, {
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
  stateRef,
};
