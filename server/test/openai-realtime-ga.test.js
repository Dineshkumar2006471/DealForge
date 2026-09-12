const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRealtimeSession } = require('../src/lib/calls/openAiRealtimeService');

const savedEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL
};

const originalFetch = global.fetch;

test.after(() => {
  global.fetch = originalFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// A & B: Verify frontend client code strictly uses GA /v1/realtime/calls and never legacy beta endpoint
test('A & B: realtimeVoiceClient.js strictly connects to GA /v1/realtime/calls and never selects legacy beta endpoints', () => {
  const clientJsPath = path.resolve(__dirname, '../../frontend/public/js/realtimeVoiceClient.js');
  const code = fs.readFileSync(clientJsPath, 'utf8');

  // Must call GA endpoint
  assert.ok(
    code.includes("https://api.openai.com/v1/realtime/calls"),
    'Must contain https://api.openai.com/v1/realtime/calls'
  );

  // Must NOT call legacy preview / beta endpoints
  assert.ok(
    !code.includes("/v1/realtime?model="),
    'Must NOT contain /v1/realtime?model='
  );
  assert.ok(
    !code.includes("OpenAI-Beta"),
    'Must NOT contain OpenAI-Beta header'
  );
  assert.ok(
    !code.includes("beta_api_shape_disabled"),
    'Must NOT contain beta_api_shape_disabled'
  );
});

// C: Permanent API key is never included in client response
test('C: Permanent OPENAI_API_KEY is never included in createRealtimeSession response', async () => {
  const SECRET_KEY = 'sk-proj-super-secret-backend-key-never-leak';
  process.env.OPENAI_API_KEY = SECRET_KEY;
  delete process.env.OPENAI_REALTIME_MODEL;

  global.fetch = async (url, options) => {
    return new Response(JSON.stringify({
      value: 'ek_safe_client_secret_789',
      expires_at: 1789999999
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const creds = await createRealtimeSession();
  assert.equal(creds.clientSecret, 'ek_safe_client_secret_789');
  assert.notEqual(creds.clientSecret, SECRET_KEY);
  assert.ok(!JSON.stringify(creds).includes(SECRET_KEY));
});

// D: Server-selected model is used
test('D: Server-selected model is configured and passed to OpenAI session configuration', async () => {
  process.env.OPENAI_API_KEY = 'sk-proj-test';
  process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime-2.1-mini';

  let capturedPayload = null;
  global.fetch = async (url, options) => {
    capturedPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      value: 'ek_token',
      expires_at: 1789999999
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const creds = await createRealtimeSession();
  assert.equal(creds.model, 'gpt-realtime-2.1-mini');
  assert.equal(capturedPayload.session.model, 'gpt-realtime-2.1-mini');
});

// E & G: session.type conforms to current GA contract and configuration is generated exactly once
test('E & G: session.type conforms to current GA contract and is generated exactly once', async () => {
  process.env.OPENAI_API_KEY = 'sk-proj-test';
  delete process.env.OPENAI_REALTIME_MODEL;

  let callCount = 0;
  let capturedPayload = null;
  global.fetch = async (url, options) => {
    callCount++;
    capturedPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      value: 'ek_token',
      expires_at: 1789999999
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  await createRealtimeSession();
  assert.equal(callCount, 1, 'Expected client_secrets to be called exactly once');
  assert.equal(capturedPayload.session.type, 'realtime');
  assert.equal(capturedPayload.session.audio.input.transcription.model, 'whisper-1');
  assert.equal(capturedPayload.session.audio.input.turn_detection.type, 'server_vad');
  assert.equal(capturedPayload.session.audio.input.turn_detection.create_response, false);
});

// F: Realtime credential creation works with ephemeral token
test('F: Realtime credential creation returns valid structure', async () => {
  process.env.OPENAI_API_KEY = 'sk-proj-test';

  global.fetch = async (url, options) => {
    return new Response(JSON.stringify({
      value: 'ek_valid_ephemeral_token',
      expires_at: 1789999999
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const res = await createRealtimeSession();
  assert.ok(res.clientSecret.startsWith('ek_'));
  assert.ok(res.expiresAt > 0);
  assert.ok(typeof res.model === 'string');
});

// H: Error response from OpenAI is surfaced safely without leaking authorization
test('H: Error response from OpenAI is surfaced safely without leaking authorization or secret keys', async () => {
  const SECRET_KEY = 'sk-proj-do-not-leak-this-header';
  process.env.OPENAI_API_KEY = SECRET_KEY;

  global.fetch = async (url, options) => {
    return new Response(JSON.stringify({
      error: {
        message: 'The model gpt-realtime-invalid does not exist.',
        type: 'invalid_request_error',
        code: 'model_not_found'
      }
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };

  await assert.rejects(
    () => createRealtimeSession(),
    (err) => {
      assert.equal(err.status, 502);
      assert.ok(err.message.includes('The model gpt-realtime-invalid does not exist.'));
      assert.ok(!err.message.includes(SECRET_KEY));
      return true;
    }
  );
});
