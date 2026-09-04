/**
 * calculate_discount
 *
 * Deterministic discount calculator. The model NEVER calculates the final number.
 * Policy: ≤18% auto, 18-25% approval, >25% reject.
 */
const { registerTool } = require('./registry');
const { appendDiscountLedger } = require('../firebase/dealState');
const { getConcessions } = require('../data/concessionCatalog');

async function calculateDiscount(args, context) {
  const requestedPct = parseFloat(args.requested_pct || args.requestedPct || 0);
  const { dealId, organizationId } = context;

  // ≤18%: Auto-approve with counter-offer at exact requested amount
  if (requestedPct <= 18) {
    const entry = {
      requested_pct: requestedPct,
      result: 'APPROVED',
      counter_pct: requestedPct,
      alternatives: [],
      timestamp: new Date().toISOString(),
      turn: context.turnNumber || 0,
    };
    await appendDiscountLedger(dealId, entry, organizationId);

    return {
      approved: true,
      discount_pct: requestedPct,
      message: `${requestedPct}% discount approved.`,
    };
  }

  // 18-25% can run only when the registry has consumed the exact approved operation.
  if (requestedPct <= 25) {
    const entry = {
      requested_pct: requestedPct,
      result: context.approvedReplay ? 'APPROVED' : 'PENDING_APPROVAL',
      counter_pct: context.approvedReplay ? requestedPct : 18,
      alternatives: context.approvedReplay ? [] : getConcessions(3).map(c => c.name),
      timestamp: new Date().toISOString(),
      turn: context.turnNumber || 0,
    };
    await appendDiscountLedger(dealId, entry, organizationId);

    return {
      approved: Boolean(context.approvedReplay),
      pending_approval: !context.approvedReplay,
      autonomous_limit: 18,
      requested: requestedPct,
      counter_offer: context.approvedReplay ? requestedPct : 18,
      alternatives: context.approvedReplay ? [] : getConcessions(3),
      message: context.approvedReplay ? `${requestedPct}% discount approved by your manager.` : `${requestedPct}% exceeds autonomous limit (18%). Approval request created. Counter-offer: 18% + concessions.`,
    };
  }

  // >25%: Reject outright
  const entry = {
    requested_pct: requestedPct,
    result: 'REJECTED',
    counter_pct: 18,
    alternatives: getConcessions(3).map(c => c.name),
    timestamp: new Date().toISOString(),
    turn: context.turnNumber || 0,
  };
  await appendDiscountLedger(dealId, entry, organizationId);

  return {
    approved: false,
    rejected: true,
    max_discount: 25,
    counter_offer: 18,
    alternatives: getConcessions(3),
    message: `${requestedPct}% exceeds maximum discount limit (25%). Best autonomous offer: 18% + concessions.`,
  };
}

// Register
registerTool('calculate_discount', calculateDiscount, {
  description: 'Calculate and apply a discount percentage. Policy enforced: ≤18% auto, 18-25% needs approval, >25% rejected.',
  parameters: {
    type: 'object',
    properties: {
      requested_pct: {
        type: 'number',
        description: 'The discount percentage the customer requested',
      },
    },
    required: ['requested_pct'],
  },
});

module.exports = calculateDiscount;
