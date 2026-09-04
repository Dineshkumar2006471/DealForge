/**
 * Negotiation Memory
 *
 * Extracts and stores negotiation signals per turn.
 * Injected into Gemini context on negotiation turns.
 */
const { appendNegotiationMemory } = require('../firebase/dealState');

/**
 * Record a negotiation signal.
 */
async function recordSignal(dealId, organizationId, { preference, concession_available, turn_stated, context }) {
  const entry = {
    preference,
    concession_available: concession_available || null,
    turn_stated,
    context,
    recorded_at: new Date().toISOString(),
  };

  await appendNegotiationMemory(dealId, entry, organizationId);
  return entry;
}

/**
 * Get negotiation memory for context injection.
 */
async function getMemory(dealId, organizationId) {
  const { getDeal } = require('../firebase/dealState');
  const deal = await getDeal(dealId, organizationId);
  return deal?.negotiationMemory || [];
}

module.exports = { recordSignal, getMemory };
