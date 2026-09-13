const test = require('node:test');
const assert = require('node:assert/strict');
const { clearHistory } = require('../src/lib/agent/conversationHistory');

// ─── clearHistory safety ─────────────────────────────────────────────────────
test('clearHistory throws because deletion is controlled by retention policy', async () => {
  await assert.rejects(() => clearHistory(), {
    message: /retention policy/i,
  });
});

// ─── Module exports ──────────────────────────────────────────────────────────
test('conversationHistory exports getHistory, addMessage, getTurnNumber, clearHistory', () => {
  const mod = require('../src/lib/agent/conversationHistory');
  assert.ok(typeof mod.getHistory === 'function');
  assert.ok(typeof mod.addMessage === 'function');
  assert.ok(typeof mod.getTurnNumber === 'function');
  assert.ok(typeof mod.clearHistory === 'function');
});
