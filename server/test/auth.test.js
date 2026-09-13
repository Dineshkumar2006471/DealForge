const test = require('node:test');
const assert = require('node:assert/strict');
const { HttpError, bearerToken } = require('../src/lib/security/auth');

// ─── HttpError ───────────────────────────────────────────────────────────────
test('HttpError stores status and message', () => {
  const err = new HttpError(403, 'Forbidden');
  assert.strictEqual(err.status, 403);
  assert.strictEqual(err.message, 'Forbidden');
  assert.ok(err instanceof Error);
});

test('HttpError is catchable as an Error', () => {
  try {
    throw new HttpError(401, 'Unauthorized');
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(err instanceof HttpError);
    assert.strictEqual(err.status, 401);
  }
});

test('HttpError with 500 preserves generic message', () => {
  const err = new HttpError(500, 'Internal server error');
  assert.strictEqual(err.status, 500);
  assert.strictEqual(err.message, 'Internal server error');
});

// ─── bearerToken ─────────────────────────────────────────────────────────────
test('bearerToken extracts token from valid Bearer header', () => {
  const token = bearerToken('Bearer abc123xyz');
  assert.strictEqual(token, 'abc123xyz');
});

test('bearerToken handles case-insensitive Bearer prefix', () => {
  const token = bearerToken('bearer my-token-here');
  assert.strictEqual(token, 'my-token-here');
});

test('bearerToken returns null for missing header', () => {
  assert.strictEqual(bearerToken(undefined), null);
  assert.strictEqual(bearerToken(null), null);
});

test('bearerToken returns null for empty string', () => {
  assert.strictEqual(bearerToken(''), null);
});

test('bearerToken returns null for non-Bearer scheme', () => {
  assert.strictEqual(bearerToken('Basic abc123'), null);
});

test('bearerToken returns null for Bearer without token', () => {
  assert.strictEqual(bearerToken('Bearer'), null);
  assert.strictEqual(bearerToken('Bearer '), null);
});

test('bearerToken handles tokens with special characters', () => {
  const token = bearerToken('Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc.def');
  assert.strictEqual(token, 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc.def');
});

test('bearerToken does not match non-string input', () => {
  assert.strictEqual(bearerToken(123), null);
  assert.strictEqual(bearerToken({}), null);
  assert.strictEqual(bearerToken([]), null);
});
