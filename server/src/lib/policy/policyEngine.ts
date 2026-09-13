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
import type { PolicyTier, PolicyDecision } from '../../types/domain';

// Permission tiers
export const TIERS: Record<PolicyTier, PolicyTier> = {
  OBSERVE: 'OBSERVE',
  ACT: 'ACT',
  APPROVAL: 'APPROVAL',
  REJECT: 'REJECT',
};

// Tool → tier mapping (can be overridden by tool-specific logic)
export const TOOL_TIERS: Record<string, PolicyTier> = {
  check_product_availability: TIERS.OBSERVE,
  update_deal_state: TIERS.ACT,
  request_meeting_details: TIERS.ACT,
  calculate_discount: TIERS.ACT, // escalates to APPROVAL if > 18%
  book_meeting: TIERS.ACT,
  escalate_to_human: TIERS.ACT,
  // CRM writes are restricted even when the target is explicitly linked. A manager
  // approves the exact allowlisted fields before DealForge performs the verified update.
  sync_to_hubspot: TIERS.APPROVAL,
};

export interface PolicyContext {
  dealId?: string;
  sessionId?: string | null;
  organizationId?: string;
}

/**
 * Check policy for a tool call.
 */
export function checkPolicy(toolName: string, args: Record<string, any>, _context: PolicyContext = {}): PolicyDecision {
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

  return { tier: baseTier, allowed: false, requiresApproval: baseTier === TIERS.APPROVAL, reason: 'Requires approval' };
}

/**
 * Discount-specific policy.
 * ≤18% → ACT (auto)
 * >18% and ≤25% → APPROVAL (needs manager)
 * >25% → REJECT
 */
export function checkDiscountPolicy(args: Record<string, any>): PolicyDecision {
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
export function recordFailure(): void {}

/**
 * Record a tool success (resets circuit breaker).
 */
export function recordSuccess(): void {}
