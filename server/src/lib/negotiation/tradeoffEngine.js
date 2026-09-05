const { getConcessions } = require('../data/concessionCatalog');

function createTradeoffProposal(requestedPct) {
  const requested = Number(requestedPct);
  if (!Number.isFinite(requested) || requested < 0 || requested > 25) return null;
  if (requested <= 18) return { requestedPct: requested, offeredPct: requested, tradeOffs: [], authority: 'ACT', reason: 'Within the autonomous discount limit.' };
  return { requestedPct: requested, offeredPct: 18, tradeOffs: getConcessions(2).map(item => ({ id: item.id, label: item.name })), authority: 'APPROVAL', reason: 'The request exceeds the autonomous discount limit; offer value before pure discount.' };
}

module.exports = { createTradeoffProposal };
