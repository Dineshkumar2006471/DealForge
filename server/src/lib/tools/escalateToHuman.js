/**
 * escalate_to_human
 *
 * Tier 2 (ACT) — Sets escalation flag on Deal State.
 * Triggered when the customer is hostile, makes threats, or the agent is stuck.
 */
const { registerTool } = require('./registry');
const { setEscalation } = require('../firebase/dealState');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

async function escalateToHuman(args, context) {
  const { reason, urgency } = args;
  const { dealId, sessionId, organizationId } = context;

  await setEscalation(dealId, reason, urgency || 'medium', organizationId, sessionId);

  await writeAuditEvent({
    organizationId, dealId,
    sessionId,
    eventType: EVENT_TYPES.ESCALATION_TRIGGERED,
    trigger: `Escalation: ${reason}`,
    actionResult: { tool: 'escalate_to_human', input: args, output: { flagged: true }, verified: true },
  });

  return {
    escalated: true,
    reason,
    urgency: urgency || 'medium',
    message: 'Escalation flag set. A human representative will be notified.',
  };
}

registerTool('escalate_to_human', escalateToHuman, {
  description: 'Escalate the conversation to a human manager. Use when the customer is hostile, makes legal threats, or the conversation is stuck.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why escalation is needed' },
      urgency: { type: 'string', description: 'Urgency level: low, medium, high' },
    },
    required: ['reason'],
  },
});

module.exports = escalateToHuman;
