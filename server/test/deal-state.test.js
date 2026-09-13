const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIDENCE_THRESHOLDS } = require('../src/lib/evidence/confidenceConfig');

// ─── Confidence Thresholds ───────────────────────────────────────────────────
test('CONFIDENCE_THRESHOLDS exports ACCEPT, CLARIFY, and REJECT', () => {
  assert.ok('ACCEPT' in CONFIDENCE_THRESHOLDS);
  assert.ok('CLARIFY' in CONFIDENCE_THRESHOLDS);
  assert.ok('REJECT' in CONFIDENCE_THRESHOLDS);
});

test('ACCEPT threshold is 0.85', () => {
  assert.strictEqual(CONFIDENCE_THRESHOLDS.ACCEPT, 0.85);
});

test('CLARIFY threshold is 0.6', () => {
  assert.strictEqual(CONFIDENCE_THRESHOLDS.CLARIFY, 0.6);
});

test('REJECT threshold equals CLARIFY (below CLARIFY means reject)', () => {
  assert.strictEqual(CONFIDENCE_THRESHOLDS.REJECT, CONFIDENCE_THRESHOLDS.CLARIFY);
});

test('threshold ordering: REJECT <= CLARIFY < ACCEPT', () => {
  assert.ok(CONFIDENCE_THRESHOLDS.REJECT <= CONFIDENCE_THRESHOLDS.CLARIFY);
  assert.ok(CONFIDENCE_THRESHOLDS.CLARIFY < CONFIDENCE_THRESHOLDS.ACCEPT);
});

// ─── Deal State Module Exports ───────────────────────────────────────────────
test('dealState exports getDeal, createDeal, updateDealField, updateMEDDIC', () => {
  const mod = require('../src/lib/firebase/dealState');
  assert.ok(typeof mod.getDeal === 'function');
  assert.ok(typeof mod.createDeal === 'function');
  assert.ok(typeof mod.updateDealField === 'function');
  assert.ok(typeof mod.updateMEDDIC === 'function');
});

// ─── Deal Schema Constants ───────────────────────────────────────────────────
test('STAGES includes all deal lifecycle stages', () => {
  const { STAGES } = require('../src/lib/schema/validation');
  assert.ok(STAGES.includes('QUALIFY'));
  assert.ok(STAGES.includes('NEGOTIATE'));
  assert.ok(STAGES.includes('BOOK'));
  assert.ok(STAGES.includes('CLOSED_WON'));
  assert.ok(STAGES.includes('CLOSED_LOST'));
  assert.strictEqual(STAGES.length, 5);
});

test('STATUSES includes all deal statuses', () => {
  const { STATUSES } = require('../src/lib/schema/validation');
  assert.ok(STATUSES.includes('ACTIVE'));
  assert.ok(STATUSES.includes('QUALIFIED'));
  assert.ok(STATUSES.includes('PENDING_APPROVAL'));
  assert.ok(STATUSES.includes('CLOSED_WON'));
  assert.ok(STATUSES.includes('CLOSED_LOST'));
  assert.strictEqual(STATUSES.length, 5);
});
