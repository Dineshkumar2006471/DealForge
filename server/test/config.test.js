const test = require('node:test');
const assert = require('node:assert/strict');
const { envSchema } = require('../src/lib/config');

// ─── Environment Schema Defaults ─────────────────────────────────────────────
test('envSchema provides sensible defaults for development', () => {
  const result = envSchema.safeParse({});
  assert.ok(result.success, 'Schema should parse with defaults');
  assert.strictEqual(result.data.PORT, 8080);
  assert.strictEqual(result.data.NODE_ENV, 'development');
  assert.strictEqual(result.data.GEMINI_MODEL, 'gemini-2.5-flash');
  assert.strictEqual(result.data.GCP_PROJECT_ID, 'dealforge-507515');
});

test('envSchema accepts valid production configuration', () => {
  const result = envSchema.safeParse({
    GCP_PROJECT_ID: 'my-project',
    PORT: '3000',
    NODE_ENV: 'production',
    GEMINI_MODEL: 'gemini-2.5-pro',
    CLOUD_RUN_URL: 'https://dealforge.run.app',
  });
  assert.ok(result.success);
  assert.strictEqual(result.data.PORT, 3000); // coerced from string
  assert.strictEqual(result.data.NODE_ENV, 'production');
  assert.strictEqual(result.data.CLOUD_RUN_URL, 'https://dealforge.run.app');
});

test('envSchema rejects invalid NODE_ENV', () => {
  const result = envSchema.safeParse({ NODE_ENV: 'staging' });
  assert.ok(!result.success);
});

test('envSchema rejects invalid PORT', () => {
  const result = envSchema.safeParse({ PORT: '99999' });
  assert.ok(!result.success);
});

test('envSchema rejects invalid CLOUD_RUN_URL (not a URL)', () => {
  const result = envSchema.safeParse({ CLOUD_RUN_URL: 'not-a-url' });
  assert.ok(!result.success);
});

test('envSchema allows optional fields to be missing', () => {
  const result = envSchema.safeParse({});
  assert.ok(result.success);
  assert.strictEqual(result.data.OPENAI_API_KEY, undefined);
  assert.strictEqual(result.data.SARVAM_API_KEY, undefined);
  assert.strictEqual(result.data.HUBSPOT_API_KEY, undefined);
});
