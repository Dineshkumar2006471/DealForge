const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDealHealth } = require('../src/lib/agent/dealHealth');
const { evaluateNextBestAction } = require('../src/lib/agent/nextBestAction');
const { createTradeoffProposal } = require('../src/lib/negotiation/tradeoffEngine');
const { operationIdFor } = require('../src/lib/mcp/mcpGateway');

const qualifiedDeal = {
  teamSize: { value: 300 }, timeline: { value: 'Q4' }, pain: { value: 'Manual entry' }, budget: { value: 'Approved' },
  meddic: { metrics: { status: 'confirmed' }, economicBuyer: { status: 'confirmed' }, decisionCriteria: { status: 'confirmed' }, decisionProcess: { status: 'unknown' }, identifyPain: { status: 'confirmed' }, champion: { status: 'unknown' } },
};

test('deal health is deterministic, bounded, and explains competitor risk', () => {
  const healthy = calculateDealHealth(qualifiedDeal); const competitive = calculateDealHealth({ ...qualifiedDeal, competitor: { value: 'Salesforce' } });
  assert.ok(healthy.score >= 0 && healthy.score <= 100); assert.equal(competitive.score, healthy.score - 8); assert.equal(competitive.riskLevel, 'LOW'); assert.ok(competitive.topRisks.includes('Competitive evaluation recorded'));
});

test('next best action waits for approved operations and never grants execution authority', () => {
  const action = evaluateNextBestAction(qualifiedDeal, { pendingApprovals: [{ status: 'APPROVED' }] });
  assert.equal(action.action, 'FOLLOW_UP_APPROVAL'); assert.equal(action.authority, 'OBSERVE'); assert.equal(action.requiredTool, null);
});

test('next best action begins with qualification when team size is absent', () => {
  const action = evaluateNextBestAction({ meddic: {} });
  assert.equal(action.action, 'QUALIFY_TEAM_SIZE'); assert.equal(action.requiredTool, 'update_deal_state');
});

test('trade-off engine preserves the 18/25 discount boundary', () => {
  assert.deepEqual(createTradeoffProposal(15).tradeOffs, []);
  const approval = createTradeoffProposal(25); assert.equal(approval.offeredPct, 18); assert.equal(approval.authority, 'APPROVAL'); assert.ok(approval.tradeOffs.length > 0);
  assert.equal(createTradeoffProposal(26), null);
});

test('MCP operation IDs are deterministic and tool-specific', () => {
  const input = { sessionId: 'session', toolName: 'crm_update', args: { stage: 'QUALIFY' } };
  assert.equal(operationIdFor(input), operationIdFor(input));
  assert.notEqual(operationIdFor(input), operationIdFor({ ...input, toolName: 'calendar_book' }));
});
