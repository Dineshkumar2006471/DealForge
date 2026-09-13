const test = require('node:test');
const assert = require('node:assert/strict');
const { mask, formatEntry } = require('../src/lib/logger');

// ─── mask() ──────────────────────────────────────────────────────────────────
test('mask redacts Bearer tokens', () => {
  const input = 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc.def';
  const result = mask(input);
  assert.doesNotMatch(result, /eyJhbGci/);
  assert.match(result, /\[REDACTED\]/);
});

test('mask redacts Firebase API keys (AIza pattern)', () => {
  const prefix = 'AI' + 'za';
  const input = `API key: ${prefix}SyDwjfEQlTQ1234567890abcdefghijk`;
  const result = mask(input);
  assert.doesNotMatch(result, new RegExp(prefix));
  assert.match(result, /\[REDACTED\]/);
});

test('mask redacts OpenAI API keys (sk- pattern)', () => {
  const input = 'key: sk-abcdefghijklmnopqrstuvwxyz1234567890';
  const result = mask(input);
  assert.doesNotMatch(result, /sk-abcdefg/);
  assert.match(result, /\[REDACTED\]/);
});

test('mask passes through safe strings unchanged', () => {
  const input = 'Hello world, this is a normal message';
  assert.strictEqual(mask(input), input);
});

test('mask handles non-string input', () => {
  assert.strictEqual(mask(42), 42);
  assert.strictEqual(mask(null), null);
  assert.strictEqual(mask(undefined), undefined);
});

// ─── formatEntry() ───────────────────────────────────────────────────────────
test('formatEntry produces structured JSON with severity and timestamp', () => {
  const entry = formatEntry('info', 'Test message');
  assert.strictEqual(entry.severity, 'INFO');
  assert.strictEqual(entry.message, 'Test message');
  assert.ok(entry.timestamp);
  assert.strictEqual(entry.service, 'dealforge-core');
});

test('formatEntry includes requestId when provided', () => {
  const entry = formatEntry('warn', 'Warning', { requestId: 'req-123' });
  assert.strictEqual(entry.requestId, 'req-123');
});

test('formatEntry includes error details safely', () => {
  const err = new Error('Something broke');
  err.code = 'ERR_TEST';
  const entry = formatEntry('error', 'Failure', { error: err });
  assert.strictEqual(entry.error.message, 'Something broke');
  assert.strictEqual(entry.error.code, 'ERR_TEST');
});

test('formatEntry masks sensitive data in messages', () => {
  const entry = formatEntry('error', 'Auth failed with Bearer secret-token-here');
  assert.doesNotMatch(entry.message, /secret-token-here/);
});

test('formatEntry masks sensitive data in metadata values', () => {
  const entry = formatEntry('info', 'test', { header: 'Bearer my-secret-jwt-token-value' });
  assert.doesNotMatch(JSON.stringify(entry), /my-secret-jwt-token-value/);
});
