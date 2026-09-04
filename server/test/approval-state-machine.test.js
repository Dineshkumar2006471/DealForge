const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTransition, claimTransition, completionTransition } = require('../src/lib/policy/approvalStateMachine');
test('expired pending approvals resolve permanently to EXPIRED', () => assert.equal(resolveTransition('PENDING', true, 'APPROVED'), 'EXPIRED'));
test('approved operation is only consumed after successful execution', () => {
  assert.equal(claimTransition('APPROVED', false), 'EXECUTING');
  assert.equal(completionTransition('EXECUTING', false), 'APPROVED');
  assert.equal(completionTransition('EXECUTING', true), 'CONSUMED');
});
