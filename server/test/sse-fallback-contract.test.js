const test = require('node:test');
const assert = require('node:assert/strict');
const { writeSafeFallback, currentUserText, writeSseReply } = require('../src/lib/agent/agentRuntime');
const { parse, chatSchema } = require('../src/lib/schema/validation');

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

test('empty Agora join turns are identified before reaching Gemini', () => {
  assert.equal(currentUserText([{ role: 'user', content: '   ' }]), '');
  assert.equal(currentUserText([{ role: 'user', content: 'We have 300 users.' }]), 'We have 300 users.');
  assert.equal(currentUserText([{ role: 'assistant', content: 'Hello' }]), '');
  assert.equal(currentUserText([{ role: 'user', content: [{ type: 'input_text', text: 'We have ' }, { type: 'input_text', text: '300 users.' }] }]), 'We have\n300 users.');
  assert.doesNotThrow(() => parse(chatSchema, { stream: true, messages: [{ role: 'user', content: [{ type: 'input_text', text: 'We have 300 users.' }] }] }));
});

test('opening greeting uses the same complete SSE contract', () => {
  const writes = [];
  let ended = false;
  writeSseReply({ write: value => writes.push(value), end: () => { ended = true; } }, 'chatcmpl-opening', 'Hello from DealForge.');
  assert.equal(ended, true);
  const first = JSON.parse(writes[0].replace(/^data: |\n\n$/g, ''));
  const terminal = JSON.parse(writes[1].replace(/^data: |\n\n$/g, ''));
  assert.equal(first.choices[0].delta.role, 'assistant');
  assert.equal(first.choices[0].delta.content, 'Hello from DealForge.');
  assert.equal(terminal.choices[0].finish_reason, 'stop');
});
