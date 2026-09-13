const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/lib/firebase/admin');
const { executeTool, getToolDefinitions } = require('../src/lib/tools/registry');

// Trigger registrations
require('../src/lib/tools/calculateDiscount');
require('../src/lib/tools/checkProductAvailability');
require('../src/lib/tools/escalateToHuman');
require('../src/lib/tools/requestMeetingDetails');
require('../src/lib/tools/updateDealState');

test('Tools Pipeline Execution & Behavior Invariants', async (t) => {
  const originalCollection = db.collection;
  const mockDeal = {
    id: 'deal-tool-test',
    organizationId: 'org-test',
    company: 'ToolTest Co',
    stage: 'DISCOVERY',
    status: 'ACTIVE',
  };

  const chainableQuery = {
    where: () => chainableQuery,
    orderBy: () => chainableQuery,
    limit: () => chainableQuery,
    get: async () => ({ docs: [], empty: true }),
  };

  const makeDocRef = (docId, collName = 'deals') => ({
    id: docId,
    get: async () => ({
      exists: true,
      data: () => mockDeal,
    }),
    set: async () => {},
    update: async () => {},
    collection: (subName) => ({
      doc: (subId) => makeDocRef(subId, subName),
      where: () => chainableQuery,
      orderBy: () => chainableQuery,
      limit: () => chainableQuery,
      get: async () => ({ docs: [], empty: true }),
    }),
  });

  const originalRunTransaction = db.runTransaction;
  t.beforeEach(() => {
    db.runTransaction = async (callback) => {
      const tx = {
        get: async (ref) => ({
          exists: true,
          data: () => mockDeal,
        }),
        set: () => {},
        update: () => {},
        create: () => {},
      };
      return await callback(tx);
    };

    db.collection = (name) => ({
      doc: (id) => makeDocRef(id, name),
      where: () => chainableQuery,
      orderBy: () => chainableQuery,
      get: async () => ({ docs: [], empty: true }),
    });
  });

  t.after(() => {
    db.collection = originalCollection;
    db.runTransaction = originalRunTransaction;
  });

  const mockContext = {
    dealId: 'deal-tool-test',
    organizationId: 'org-test',
    sessionId: 'session-tool-test',
    turnNumber: 1,
    turnId: 'turn-1',
  };

  await t.test('getToolDefinitions returns registered agent-visible tools', () => {
    const defs = getToolDefinitions();
    assert(Array.isArray(defs));
    assert(defs.some((d) => d.function.name === 'check_product_availability'));
    assert(defs.some((d) => d.function.name === 'calculate_discount'));
  });

  await t.test('check_product_availability executes through policy pipeline (OBSERVE tier)', async () => {
    const { result, policyResult, approved } = await executeTool(
      'check_product_availability',
      { plan: 'enterprise' },
      mockContext,
    );
    assert.strictEqual(policyResult.tier, 'OBSERVE');
    assert.strictEqual(policyResult.allowed, true);
    assert.strictEqual(approved, true);
    assert.strictEqual(result.available, true);
    assert.strictEqual(result.plan, 'Enterprise');
  });

  await t.test('calculate_discount <=18% auto-approves through deterministic policy and appends ledger', async () => {
    const { result, policyResult, approved } = await executeTool(
      'calculate_discount',
      { requested_pct: 12 },
      mockContext,
    );
    assert.strictEqual(policyResult.allowed, true);
    assert.strictEqual(approved, true);
    assert.strictEqual(result.approved, true);
    assert.strictEqual(result.discount_pct, 12);
  });

  await t.test('calculate_discount over 25% is rejected by deterministic policy before handler executes', async () => {
    const { result, policyResult, approved } = await executeTool(
      'calculate_discount',
      { requested_pct: 35 },
      mockContext,
    );
    assert.strictEqual(policyResult.tier, 'REJECT');
    assert.strictEqual(policyResult.allowed, false);
    assert.strictEqual(approved, false);
    assert.strictEqual(result.rejected, true);
    assert.match(policyResult.reason, /exceeds maximum discount limit/i);
  });

  await t.test('update_deal_state updates stage, MEDDIC, and field with evidence', async () => {
    // Stage update
    const stageRes = await executeTool('update_deal_state', { new_stage: 'NEGOTIATE' }, mockContext);
    assert.strictEqual(stageRes.approved, true);
    assert.strictEqual(stageRes.result.value, 'NEGOTIATE');

    // MEDDIC update
    const meddicRes = await executeTool(
      'update_deal_state',
      { meddic_pillar: 'metrics', meddic_status: 'confirmed' },
      mockContext,
    );
    assert.strictEqual(meddicRes.approved, true);
    assert.strictEqual(meddicRes.result.value, 'confirmed');

    // Field update
    const fieldRes = await executeTool(
      'update_deal_state',
      { field: 'budget', value: '75000', confidence: 0.95 },
      mockContext,
    );
    assert.strictEqual(fieldRes.approved, true);
    assert.strictEqual(fieldRes.result.updated, true);
  });

  await t.test('escalate_to_human sets escalation state on deal', async () => {
    const { result, approved } = await executeTool(
      'escalate_to_human',
      { reason: 'Customer requesting custom SLA terms', urgency: 'high' },
      mockContext,
    );
    assert.strictEqual(approved, true);
    assert.strictEqual(result.escalated, true);
    assert.strictEqual(result.urgency, 'high');
  });

  await t.test('request_meeting_details triggers secure meeting form', async () => {
    const { result, approved } = await executeTool(
      'request_meeting_details',
      { meeting_type: 'enterprise_demo' },
      mockContext,
    );
    assert.strictEqual(approved, true);
    assert.strictEqual(result.verified, true);
    assert.match(result.message, /secure meeting form/i);
  });

  await t.test('executeTool rejects invalid arguments conforming to Zod schema', async () => {
    const { result, policyResult, approved } = await executeTool(
      'check_product_availability',
      { plan: 'INVALID_PLAN_XYZ' },
      mockContext,
    );
    assert.strictEqual(approved, false);
    assert.strictEqual(result.rejected, true);
  });
});
