const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimit, windowStart } = require('../src/lib/security/rateLimit');

function memoryStore() {
  const records = new Map();
  return {
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction: async callback => callback({
      get: async ref => ({ exists: records.has(ref.id), data: () => records.get(ref.id) }),
      create: (ref, value) => records.set(ref.id, value),
      update: (ref, value) => records.set(ref.id, { ...records.get(ref.id), ...value }),
    }),
  };
}

function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; } }; }

test('public rate limiter rejects the request after its fixed-window limit', async () => {
  const now = 1_700_000_000_000;
  const middleware = createRateLimit({ scope: 'test', limit: 2, windowMs: 60_000, store: memoryStore(), now: () => now });
  const req = { ip: '203.0.113.10' };
  const first = response(); let firstError;
  await middleware(req, first, error => { firstError = error; });
  assert.equal(firstError, undefined);
  assert.equal(first.headers['RateLimit-Remaining'], '1');
  const second = response(); let secondError;
  await middleware(req, second, error => { secondError = error; });
  assert.equal(secondError, undefined);
  assert.equal(second.headers['RateLimit-Remaining'], '0');
  const third = response(); let thirdError;
  await middleware(req, third, error => { thirdError = error; });
  assert.equal(thirdError.status, 429);
});

test('fixed windows roll over deterministically', () => {
  assert.equal(windowStart(125_000, 60_000), 120_000);
});
