/**
 * Audit Event Store
 *
 * Centralized writer for structured audit events.
 * Every state-changing action MUST produce an audit event.
 * Never scattered across tool files.
 */
const { db } = require('../firebase/admin');
const { v4: uuidv4 } = require('uuid');

/**
 * Write a structured audit event.
 *
 * @param {Object} event
 * @param {string} event.dealId
 * @param {string} event.sessionId
 * @param {string} event.eventType - From EVENT_TYPES enum
 * @param {string} event.trigger - What caused this event
 * @param {Array} [event.evidence] - Related evidence records
 * @param {Object} [event.policyResult] - Policy decision
 * @param {Object} [event.actionResult] - Tool execution result
 */
async function writeAuditEvent(event) {
  const eventId = uuidv4();
  const record = {
    ...event,
    organizationId: event.organizationId,
    timestamp: new Date().toISOString(),
  };

  await db.collection('auditEvents').doc(eventId).set(record);
  console.log(`📋 Audit: ${event.eventType} — ${event.trigger || 'no trigger'}`);
  return { eventId, ...record };
}

/**
 * Get audit trail for a deal.
 */
async function getAuditTrail(dealId) {
  const snapshot = await db.collection('auditEvents')
    .where('dealId', '==', dealId)
    .orderBy('timestamp', 'asc')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

module.exports = { writeAuditEvent, getAuditTrail };
