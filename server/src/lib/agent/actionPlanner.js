const crypto = require('crypto');
const { db } = require('../firebase/admin');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

function planIdFor({ sessionId, dealId, action, turnNumber = 0 }) { return crypto.createHash('sha256').update(`${sessionId}:${dealId}:${action}:${turnNumber}`).digest('hex'); }

async function createActionPlan({ organizationId, dealId, sessionId, turnNumber, nextBestAction }) {
  const planId = planIdFor({ sessionId, dealId, action: nextBestAction.action, turnNumber });
  const plan = { planId, organizationId, dealId, sessionId, turnNumber, nextBestAction, steps: nextBestAction.requiredTool ? [{ tool: nextBestAction.requiredTool, status: 'PROPOSED' }] : [], status: 'PROPOSED', createdAt: new Date().toISOString() };
  await db.collection('autonomyPlans').doc(planId).set(plan, { merge: true });
  await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.ACTION_PLAN_CREATED, trigger: `Autonomous action plan: ${nextBestAction.action}`, actionResult: { planId, verified: false } });
  return plan;
}

module.exports = { createActionPlan, planIdFor };
