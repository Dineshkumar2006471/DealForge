const test = require('node:test');
const assert = require('node:assert/strict');
const { writeSafeFallback } = require('../src/lib/agent/agentRuntime');

test('Gemini failure fallback is a complete OpenAI-compatible SSE response', () => {
  const writes = [];
  let ended = false;
  writeSafeFallback({
    write: value => writes.push(value),
    end: () => { ended = true; },
  }, 'chatcmpl-test');

  assert.equal(ended, true);
  assert.equal(writes.length, 3);
  const first = JSON.parse(writes[0].replace(/^data: |\n\n$/g, ''));
  const terminal = JSON.parse(writes[1].replace(/^data: |\n\n$/g, ''));
  assert.equal(first.choices[0].delta.role, 'assistant');
  assert.match(first.choices[0].delta.content, /technical issue/i);
  assert.equal(terminal.choices[0].finish_reason, 'stop');
  assert.equal(writes[2], 'data: [DONE]\n\n');
});
