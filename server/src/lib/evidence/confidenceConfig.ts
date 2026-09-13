/**
 * Confidence Thresholds
 *
 * Configurable thresholds for evidence-backed Deal State updates.
 */
export interface ConfidenceThresholds {
  ACCEPT: number;
  CLARIFY: number;
  REJECT: number;
}

export const CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  ACCEPT: 0.85, // >= 0.85 → update Deal State
  CLARIFY: 0.6, // 0.60–0.84 → ask clarification before treating as authoritative
  REJECT: 0.6, // < 0.60 → do not update critical fields
};
