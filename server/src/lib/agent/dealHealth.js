const MEDDIC_KEYS = ['metrics', 'economicBuyer', 'decisionCriteria', 'decisionProcess', 'identifyPain', 'champion'];

function value(deal, field) { return deal?.[field]?.value; }

function calculateDealHealth(deal = {}) {
  const factors = [];
  let score = 20;
  const confirmed = MEDDIC_KEYS.filter(key => deal.meddic?.[key]?.status === 'confirmed').length;
  score += confirmed * 8;
  factors.push({ name: 'MEDDIC completeness', contribution: confirmed * 8, detail: `${confirmed}/6 confirmed` });
  if (value(deal, 'timeline')) { score += 10; factors.push({ name: 'Timeline', contribution: 10, detail: 'Customer timeline recorded' }); }
  if (value(deal, 'budget')) { score += 10; factors.push({ name: 'Budget', contribution: 10, detail: 'Budget signal recorded' }); }
  if (value(deal, 'pain')) { score += 10; factors.push({ name: 'Pain', contribution: 10, detail: 'Customer pain recorded' }); }
  if (value(deal, 'competitor')) { score -= 8; factors.push({ name: 'Competitor risk', contribution: -8, detail: 'Competitive evaluation recorded' }); }
  const pending = (deal.discountLedger || []).some(entry => entry.result === 'PENDING_APPROVAL');
  if (pending) { score -= 6; factors.push({ name: 'Pending commercial approval', contribution: -6, detail: 'Manager decision required' }); }
  score = Math.max(0, Math.min(100, score));
  const riskLevel = score >= 70 ? 'LOW' : score >= 45 ? 'MEDIUM' : 'HIGH';
  const topRisks = factors.filter(factor => factor.contribution < 0).map(factor => factor.detail);
  if (!value(deal, 'timeline')) topRisks.push('Timeline is not confirmed');
  if (!value(deal, 'budget')) topRisks.push('Budget is not confirmed');
  return { score, riskLevel, factors, topRisks: topRisks.slice(0, 3), calculatedAt: new Date().toISOString() };
}

module.exports = { calculateDealHealth };
