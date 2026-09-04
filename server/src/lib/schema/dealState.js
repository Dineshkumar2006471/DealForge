/**
 * Deal State Schema
 *
 * JSDoc schema for the canonical deals/{dealId} Firestore document.
 * conversationStage is a FIELD inside this document, not a subcollection.
 */

/**
 * @typedef {Object} EvidenceBackedField
 * @property {*} value - The extracted value
 * @property {number} confidence - 0.0 to 1.0
 * @property {string} source - "customer_statement" | "inferred" | "tool_result"
 * @property {number} evidence_turn - Turn number where this was extracted
 * @property {string} last_updated - ISO timestamp
 */

/**
 * @typedef {Object} MEDDICItem
 * @property {string} status - "confirmed" | "unknown" | "not_asked"
 * @property {number} confidence - 0.0 to 1.0
 * @property {number} evidence_turn - Turn number
 */

/**
 * @typedef {Object} DiscountLedgerEntry
 * @property {number} requested_pct
 * @property {string} result - "APPROVED" | "REJECTED" | "COUNTER_OFFER" | "PENDING_APPROVAL"
 * @property {number} [counter_pct]
 * @property {string[]} [alternatives]
 * @property {string} timestamp
 * @property {number} turn
 */

/**
 * @typedef {Object} DealState
 * @property {EvidenceBackedField} company
 * @property {EvidenceBackedField} teamSize
 * @property {EvidenceBackedField} timeline
 * @property {EvidenceBackedField} budget
 * @property {EvidenceBackedField} competitor
 * @property {EvidenceBackedField} pain
 * @property {Object.<string, MEDDICItem>} meddic
 * @property {EvidenceBackedField} sentiment
 * @property {DiscountLedgerEntry[]} discountLedger
 * @property {{ action: string, reason: string, timestamp: string }} nextBestAction
 * @property {{ status: string, timestamp: string }} outcome
 * @property {{ flagged: boolean, reason: string, urgency: string, timestamp: string }} escalation
 * @property {{ preference: string, concession_available: string, turn_stated: number, context: string }[]} negotiationMemory
 * @property {string} conversationStage - "QUALIFY" | "NEGOTIATE" | "BOOK" | "ENDED"
 * @property {string} sessionId - Non-guessable UUID
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Create a blank evidence-backed field.
 */
function blankField() {
  return { value: null, confidence: 0, source: null, evidence_turn: null, last_updated: null };
}

/**
 * Create a blank MEDDIC item.
 */
function blankMEDDIC() {
  return { status: 'not_asked', confidence: 0, evidence_turn: null };
}

/**
 * Create a blank Deal State document.
 */
function createBlankDealState(sessionId) {
  const now = new Date().toISOString();
  return {
    company: blankField(),
    teamSize: blankField(),
    timeline: blankField(),
    budget: blankField(),
    competitor: blankField(),
    pain: blankField(),
    meddic: {
      metrics: blankMEDDIC(),
      economicBuyer: blankMEDDIC(),
      decisionCriteria: blankMEDDIC(),
      decisionProcess: blankMEDDIC(),
      identifyPain: blankMEDDIC(),
      champion: blankMEDDIC(),
    },
    sentiment: blankField(),
    discountLedger: [],
    nextBestAction: { action: null, reason: null, timestamp: null },
    outcome: { status: 'in_progress', timestamp: now },
    escalation: { flagged: false, reason: null, urgency: null, timestamp: null },
    negotiationMemory: [],
    conversationStage: 'QUALIFY',
    status: 'ACTIVE',
    sessionId,
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = {
  blankField,
  blankMEDDIC,
  createBlankDealState,
};
