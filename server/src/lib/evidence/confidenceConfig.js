/**
 * Confidence Thresholds
 *
 * Configurable thresholds for evidence-backed Deal State updates.
 */
const CONFIDENCE_THRESHOLDS = {
  ACCEPT: 0.85,  // >= 0.85 → update Deal State
  CLARIFY: 0.60, // 0.60–0.84 → ask clarification before treating as authoritative
  REJECT: 0.60,  // < 0.60 → do not update critical fields
};

module.exports = { CONFIDENCE_THRESHOLDS };
