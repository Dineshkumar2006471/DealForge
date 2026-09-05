const { calculateDealHealth } = require('./dealHealth');

function evaluateNextBestAction(deal = {}, { pendingApprovals = [], availableTools = [] } = {}) {
  const health = calculateDealHealth(deal);
  const base = { risk: health.riskLevel, confidence: Math.min(0.95, 0.45 + health.score / 200), generatedAt: new Date().toISOString() };
  if (pendingApprovals.length) return { ...base, action: 'FOLLOW_UP_APPROVAL', reason: 'A manager-approved commercial action is waiting for the next customer turn.', expectedOutcome: 'Execute the exact approved operation once.', authority: 'OBSERVE', requiredTool: null };
  if (!deal.teamSize?.value) return { ...base, action: 'QUALIFY_TEAM_SIZE', reason: 'Team size is required to scope the commercial fit.', expectedOutcome: 'Capture a verified team-size signal.', authority: 'OBSERVE', requiredTool: 'update_deal_state' };
  if (deal.competitor?.value) return { ...base, action: 'DIFFERENTIATE_COMPETITOR', reason: `Customer is evaluating ${deal.competitor.value}.`, expectedOutcome: 'Confirm decision criteria and differentiation.', authority: 'OBSERVE', requiredTool: 'update_deal_state' };
  if (deal.conversationStage === 'BOOK') return { ...base, action: 'BOOK_MEETING', reason: 'The deal is ready to advance to a scheduled next step.', expectedOutcome: 'Verify a meeting or surface an honest booking failure.', authority: availableTools.includes('book_meeting') ? 'ACT' : 'OBSERVE', requiredTool: 'book_meeting' };
  if (deal.pain?.value && deal.timeline?.value) return { ...base, action: 'ADVANCE_QUALIFICATION', reason: 'Pain and timeline are known; complete remaining MEDDIC gaps.', expectedOutcome: 'Increase qualification completeness.', authority: 'ACT', requiredTool: 'update_deal_state' };
  return { ...base, action: 'DISCOVER_BUYING_CONTEXT', reason: 'More verified buying context is required before a commercial action.', expectedOutcome: 'Confirm pain, timeline, and decision process.', authority: 'OBSERVE', requiredTool: 'update_deal_state' };
}

module.exports = { evaluateNextBestAction };
