const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTool, parse, callLinkSchema } = require('../src/lib/schema/validation');
test('discount validation rejects negative and over-limit values', () => {
  assert.throws(() => parseTool('calculate_discount', { requested_pct: -1 }));
  assert.throws(() => parseTool('calculate_discount', { requested_pct: 25.01 }));
  assert.deepEqual(parseTool('calculate_discount', { requested_pct: 25 }), { requested_pct: 25 });
});
test('deal state validation rejects arbitrary model fields and invalid stages', () => {
  assert.throws(() => parseTool('update_deal_state', { field: 'organizationId', value: 'attacker' }));
  assert.throws(() => parseTool('update_deal_state', { new_stage: 'ENDED' }));
  assert.deepEqual(parseTool('update_deal_state', { new_stage: 'NEGOTIATE' }), { new_stage: 'NEGOTIATE' });
});
test('call links have a bounded expiry', () => {
  assert.throws(() => parse(callLinkSchema, { dealId: 'd', expiresInMinutes: 1 }));
  assert.throws(() => parse(callLinkSchema, { dealId: 'd', expiresInMinutes: 61 }));
  assert.equal(parse(callLinkSchema, { dealId: 'd', expiresInMinutes: 60 }).expiresInMinutes, 60);
});
