/**
 * Negotiation Memory
 *
 * Extracts and stores negotiation signals per turn.
 * Injected into Gemini context on negotiation turns.
 */
const { appendNegotiationMemory } = require('../firebase/dealState');
const { db } = require('../firebase/admin');
const { v4: uuidv4 } = require('uuid');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

/**
 * Record a negotiation signal.
 */
async function recordSignal(dealId, organizationId, { sessionId = null, type = 'CUSTOMER_REQUEST', preference = null, requestedPct = null, offeredPct = null, tradeOffs = [], urgency = null, status = null, concession_available = null, turn_stated = 0, context = '' }) {
  const entry = {
    type,
    preference,
    requestedPct,
    offeredPct,
    tradeOffs,
    urgency,
    status,
    concession_available: concession_available || null,
    turn_stated,
    context,
    recorded_at: new Date().toISOString(),
  };
  const eventId = uuidv4();
  await db.collection('negotiationEvents').doc(eventId).set({ eventId, organizationId, dealId, sessionId, ...entry });
  await appendNegotiationMemory(dealId, entry, organizationId, sessionId);
  await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.NEGOTIATION_MEMORY_RECORDED, trigger: `Negotiation ${type.toLowerCase().replace(/_/g, ' ')}`, actionResult: { eventId, verified: true } });
  return { eventId, ...entry };
}

/**
 * Get negotiation memory for context injection.
 */
async function getMemory(dealId, organizationId, sessionId = null) {
  const { getDeal } = require('../firebase/dealState');
  const deal = await getDeal(dealId, organizationId, sessionId);
  return deal?.negotiationMemory || [];
}

module.exports = { recordSignal, getMemory };
