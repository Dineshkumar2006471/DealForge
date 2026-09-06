const { db } = require('../firebase/admin');
const { getDeal, updateNextBestAction, updateDealHealth } = require('../firebase/dealState');
const { calculateDealHealth } = require('./dealHealth');
const { evaluateNextBestAction } = require('./nextBestAction');
const { createActionPlan } = require('./actionPlanner');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

async function refreshAutonomy({ organizationId, dealId, sessionId, turnNumber = 0 }) {
  const deal = await getDeal(dealId, organizationId, sessionId);
  if (!deal) throw new Error('Bound deal not found');
  const approvals = await db.collection('approvals').where('organizationId', '==', organizationId).where('dealId', '==', dealId).where('sessionId', '==', sessionId).where('status', 'in', ['PENDING', 'APPROVED', 'EXECUTING']).get();
  const pendingApprovals = approvals.docs.map(doc => doc.data());
  const dealHealth = calculateDealHealth(deal);
  const nextBestAction = evaluateNextBestAction(deal, { pendingApprovals, availableTools: ['update_deal_state', 'calculate_discount', 'book_meeting'] });
  await updateDealHealth(dealId, dealHealth, organizationId, sessionId);
  await updateNextBestAction(dealId, nextBestAction, organizationId, sessionId);
  const plan = await createActionPlan({ organizationId, dealId, sessionId, turnNumber, nextBestAction });
  await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.DEAL_HEALTH_CALCULATED, trigger: 'Verified state refreshed autonomous assessment', actionResult: { score: dealHealth.score, riskLevel: dealHealth.riskLevel, verified: true } });
  await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.NEXT_BEST_ACTION_UPDATED, trigger: nextBestAction.reason, actionResult: { action: nextBestAction.action, authority: nextBestAction.authority, verified: true } });
  return { dealHealth, nextBestAction, plan };
}

module.exports = { refreshAutonomy };
