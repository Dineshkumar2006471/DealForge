const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDiscountPolicy, TIERS } = require('../src/lib/policy/policyEngine');
test('discount policy has no silent over-25 approval path', () => {
  assert.equal(checkDiscountPolicy({ requested_pct: 18 }).tier, TIERS.ACT);
  assert.equal(checkDiscountPolicy({ requested_pct: 25 }).tier, TIERS.APPROVAL);
  assert.equal(checkDiscountPolicy({ requested_pct: 25.1 }).tier, TIERS.REJECT);
});
