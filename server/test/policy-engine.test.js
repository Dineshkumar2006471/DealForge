const test = require('node:test');
const assert = require('node:assert/strict');
const { TIERS, checkPolicy, checkDiscountPolicy } = require('../src/lib/policy/policyEngine');

// ─── Tier Constants ───────────────────────────────────────────────────────────
test('TIERS exports all four permission levels', () => {
  assert.deepStrictEqual(Object.keys(TIERS).sort(), ['ACT', 'APPROVAL', 'OBSERVE', 'REJECT']);
  assert.strictEqual(TIERS.OBSERVE, 'OBSERVE');
  assert.strictEqual(TIERS.ACT, 'ACT');
  assert.strictEqual(TIERS.APPROVAL, 'APPROVAL');
  assert.strictEqual(TIERS.REJECT, 'REJECT');
});

// ─── Tool Tier Routing ────────────────────────────────────────────────────────
test('checkPolicy returns OBSERVE for read-only tool check_product_availability', () => {
  const result = checkPolicy('check_product_availability', {});
  assert.strictEqual(result.tier, TIERS.OBSERVE);
  assert.strictEqual(result.allowed, true);
  assert.ok(result.reason);
});

test('checkPolicy returns ACT for state-changing tools within autonomous limits', () => {
  for (const tool of ['update_deal_state', 'request_meeting_details', 'book_meeting', 'escalate_to_human']) {
    const result = checkPolicy(tool, {});
    assert.strictEqual(result.tier, TIERS.ACT, `${tool} should be ACT tier`);
    assert.strictEqual(result.allowed, true, `${tool} should be allowed`);
  }
});

test('checkPolicy returns APPROVAL for sync_to_hubspot (CRM write)', () => {
  const result = checkPolicy('sync_to_hubspot', {});
  assert.strictEqual(result.tier, TIERS.APPROVAL);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.requiresApproval, true);
});

test('checkPolicy rejects unknown tools', () => {
  const result = checkPolicy('delete_everything', {});
  assert.strictEqual(result.tier, TIERS.REJECT);
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /Unknown tool/);
});

// ─── Discount Policy: 3-Tier Boundary Tests ─────────────────────────────────
test('discount: 0% is within autonomous limit', () => {
  const result = checkDiscountPolicy({ requested_pct: 0 });
  assert.strictEqual(result.tier, TIERS.ACT);
  assert.strictEqual(result.allowed, true);
});

test('discount: 10% is within autonomous limit', () => {
  const result = checkDiscountPolicy({ requested_pct: 10 });
  assert.strictEqual(result.tier, TIERS.ACT);
  assert.strictEqual(result.allowed, true);
});

test('discount: exactly 18% is within autonomous limit (boundary)', () => {
  const result = checkDiscountPolicy({ requested_pct: 18 });
  assert.strictEqual(result.tier, TIERS.ACT);
  assert.strictEqual(result.allowed, true);
  assert.match(result.reason, /18%/);
});

test('discount: 18.01% requires manager approval (just above boundary)', () => {
  const result = checkDiscountPolicy({ requested_pct: 18.01 });
  assert.strictEqual(result.tier, TIERS.APPROVAL);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.requiresApproval, true);
});

test('discount: 20% requires manager approval', () => {
  const result = checkDiscountPolicy({ requested_pct: 20 });
  assert.strictEqual(result.tier, TIERS.APPROVAL);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.requiresApproval, true);
});

test('discount: exactly 25% requires manager approval (upper boundary)', () => {
  const result = checkDiscountPolicy({ requested_pct: 25 });
  assert.strictEqual(result.tier, TIERS.APPROVAL);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.requiresApproval, true);
  assert.match(result.reason, /25%/);
});

test('discount: 25.01% is rejected (just above upper limit)', () => {
  const result = checkDiscountPolicy({ requested_pct: 25.01 });
  assert.strictEqual(result.tier, TIERS.REJECT);
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /exceeds maximum/);
});

test('discount: 50% is rejected', () => {
  const result = checkDiscountPolicy({ requested_pct: 50 });
  assert.strictEqual(result.tier, TIERS.REJECT);
  assert.strictEqual(result.allowed, false);
});

test('discount: 100% is rejected', () => {
  const result = checkDiscountPolicy({ requested_pct: 100 });
  assert.strictEqual(result.tier, TIERS.REJECT);
  assert.strictEqual(result.allowed, false);
});

// ─── Discount Policy: Edge Cases ────────────────────────────────────────────
test('discount: missing requested_pct defaults to 0 (auto-approved)', () => {
  const result = checkDiscountPolicy({});
  assert.strictEqual(result.tier, TIERS.ACT);
  assert.strictEqual(result.allowed, true);
});

test('discount: NaN requested_pct defaults to 0 (auto-approved)', () => {
  const result = checkDiscountPolicy({ requested_pct: NaN });
  assert.strictEqual(result.tier, TIERS.ACT);
  assert.strictEqual(result.allowed, true);
});

test('discount: string requested_pct is parsed correctly', () => {
  const result = checkDiscountPolicy({ requested_pct: '20' });
  assert.strictEqual(result.tier, TIERS.APPROVAL);
  assert.strictEqual(result.allowed, false);
});

test('discount: requestedPct alias is also accepted', () => {
  const result = checkDiscountPolicy({ requestedPct: 22 });
  assert.strictEqual(result.tier, TIERS.APPROVAL);
  assert.strictEqual(result.allowed, false);
});

// ─── checkPolicy routes discount through checkDiscountPolicy ────────────────
test('checkPolicy for calculate_discount delegates to discount-specific policy', () => {
  const auto = checkPolicy('calculate_discount', { requested_pct: 15 });
  assert.strictEqual(auto.tier, TIERS.ACT);
  assert.strictEqual(auto.allowed, true);

  const approval = checkPolicy('calculate_discount', { requested_pct: 22 });
  assert.strictEqual(approval.tier, TIERS.APPROVAL);
  assert.strictEqual(approval.requiresApproval, true);

  const rejected = checkPolicy('calculate_discount', { requested_pct: 30 });
  assert.strictEqual(rejected.tier, TIERS.REJECT);
  assert.strictEqual(rejected.allowed, false);
});

// ─── Result Shape Invariants ────────────────────────────────────────────────
test('all checkPolicy results include tier, allowed, and reason', () => {
  const scenarios = [
    ['check_product_availability', {}],
    ['update_deal_state', {}],
    ['calculate_discount', { requested_pct: 10 }],
    ['calculate_discount', { requested_pct: 20 }],
    ['calculate_discount', { requested_pct: 30 }],
    ['sync_to_hubspot', {}],
    ['nonexistent_tool', {}],
  ];
  for (const [tool, args] of scenarios) {
    const result = checkPolicy(tool, args);
    assert.ok('tier' in result, `${tool} result missing tier`);
    assert.ok('allowed' in result, `${tool} result missing allowed`);
    assert.ok('reason' in result, `${tool} result missing reason`);
    assert.ok(typeof result.tier === 'string', `${tool} tier should be string`);
    assert.ok(typeof result.allowed === 'boolean', `${tool} allowed should be boolean`);
    assert.ok(typeof result.reason === 'string', `${tool} reason should be string`);
  }
});
