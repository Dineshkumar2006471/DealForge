const test = require('node:test');
const assert = require('node:assert/strict');
const { secureEqual } = require('../src/lib/security/webhookAuth');
test('webhook secret comparison accepts exact secret only', () => {
  assert.equal(secureEqual('correct-secret', 'correct-secret'), true);
  assert.equal(secureEqual('correct-secret', 'correct-secreT'), false);
  assert.equal(secureEqual('correct-secret', ''), false);
});
