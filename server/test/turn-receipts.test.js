const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedTurn, receiptIdFor, DUPLICATE_WINDOW_MS } = require('../src/lib/agent/turnReceipts');

test('turn receipt fingerprint normalizes harmless ASR whitespace and case differences', () => {
  assert.equal(normalizedTurn('  We   Have  300 USERS. '), 'we have 300 users.');
  assert.equal(receiptIdFor('We have 300 users.'), receiptIdFor(' we   HAVE 300 users. '));
  assert.notEqual(receiptIdFor('We have 300 users.'), receiptIdFor('We have 301 users.'));
  assert.equal(DUPLICATE_WINDOW_MS, 15_000);
});
