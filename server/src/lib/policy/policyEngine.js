/**
 * Policy Engine
 *
 * 3-tier deterministic permission enforcement.
 * The LLM NEVER bypasses this. Every tool call is routed through here.
 *
 * Tiers:
 *   OBSERVE (Tier 1) — Safe read-only operations. Execute immediately.
 *   ACT (Tier 2)     — State-changing but within autonomous limits. Execute with validation.
 *   APPROVAL (Tier 3) — Exceeds autonomous limits. Create approval request, do NOT execute.
 *
 * Transaction boundary: REQUEST → VALIDATE → AUTHORIZE → EXECUTE → VERIFY → COMMIT → AUDIT
 */
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

// Permission tiers
const TIERS = {
  OBSERVE: 'OBSERVE',
  ACT: 'ACT',
  APPROVAL: 'APPROVAL',
  REJECT: 'REJECT',
};

// Tool → tier mapping (can be overridden by tool-specific logic)
const TOOL_TIERS = {
  check_product_availability: TIERS.OBSERVE,
  update_deal_state: TIERS.ACT,
  calculate_discount: TIERS.ACT, // escalates to APPROVAL if > 18%
  book_meeting: TIERS.ACT,
  escalate_to_human: TIERS.ACT,
};

/**
 * Check policy for a tool call.
 *
 * @param {string} toolName
 * @param {object} args - Tool arguments
 * @param {object} context - { dealId, sessionId }
 * @returns {{ tier: string, allowed: boolean, reason: string, requiresApproval?: boolean }}
 */
function checkPolicy(toolName, args, context = {}) {
  // Get base tier
  const baseTier = TOOL_TIERS[toolName];
  if (!baseTier) {
    return { tier: TIERS.REJECT, allowed: false, reason: `Unknown tool: ${toolName}` };
  }

  // Tool-specific policy escalation
  if (toolName === 'calculate_discount') {
    return checkDiscountPolicy(args);
  }

  // Default: allow based on tier
  if (baseTier === TIERS.OBSERVE) {
    return { tier: TIERS.OBSERVE, allowed: true, reason: 'Read-only operation' };
  }

  if (baseTier === TIERS.ACT) {
    return { tier: TIERS.ACT, allowed: true, reason: 'Within autonomous limits' };
  }

  return { tier: baseTier, allowed: false, reason: 'Requires approval' };
}

/**
 * Discount-specific policy.
 * ≤18% → ACT (auto)
 * >18% and ≤25% → APPROVAL (needs manager)
 * >25% → REJECT
 */
function checkDiscountPolicy(args) {
  const requestedPct = parseFloat(args.requested_pct || args.requestedPct || 0);

  if (requestedPct <= 18) {
    return {
      tier: TIERS.ACT,
      allowed: true,
      reason: `${requestedPct}% within autonomous limit (18%)`,
    };
  }

  if (requestedPct <= 25) {
    return {
      tier: TIERS.APPROVAL,
      allowed: false,
      requiresApproval: true,
      reason: `${requestedPct}% exceeds autonomous limit (18%), within manager limit (25%)`,
    };
  }

  return {
    tier: TIERS.REJECT,
    allowed: false,
    reason: `${requestedPct}% exceeds maximum discount limit (25%)`,
  };
}

/**
 * Record a tool failure for circuit breaker.
 */
function recordFailure() {}

/**
 * Record a tool success (resets circuit breaker).
 */
function recordSuccess() {}

module.exports = {
  TIERS,
  checkPolicy,
  checkDiscountPolicy,
  recordFailure,
  recordSuccess,
};
