const { refreshAutonomy } = require('./autonomyService');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

async function runPostCallAutopilot(context) {
  const result = await refreshAutonomy(context);
  await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.POST_CALL_AUTOPILOT_COMPLETED, trigger: 'Post-call autonomous assessment completed', actionResult: { dealHealth: result.dealHealth.score, nextBestAction: result.nextBestAction.action, verified: true } });
  return result;
}

module.exports = { runPostCallAutopilot };
