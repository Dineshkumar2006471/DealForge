const test = require('node:test');
const assert = require('node:assert/strict');

const { ttsConfig, buildAgentStartPayload, speakAgent } = require('../src/lib/calls/agoraAgentService');

const keys = [
  'AGORA_APP_ID', 'AGORA_APP_CERTIFICATE', 'AGORA_CUSTOMER_ID', 'AGORA_CUSTOMER_SECRET',
  'AGORA_LLM_WEBHOOK_SECRET', 'CLOUD_RUN_URL', 'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL_ID', 'ELEVENLABS_BASE_URL', 'ELEVENLABS_SAMPLE_RATE',
  'TTS_PROVIDER', 'SARVAM_API_KEY',
];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));

function configure() {
  Object.assign(process.env, {
    AGORA_APP_ID: 'a'.repeat(32), AGORA_APP_CERTIFICATE: 'b'.repeat(32),
    AGORA_CUSTOMER_ID: 'customer-id', AGORA_CUSTOMER_SECRET: 'customer-secret',
    AGORA_LLM_WEBHOOK_SECRET: 'webhook-secret', CLOUD_RUN_URL: 'https://service.example',
    ELEVENLABS_API_KEY: 'elevenlabs-secret', ELEVENLABS_VOICE_ID: 'female-voice-id',
    ELEVENLABS_MODEL_ID: 'eleven_flash_v2_5', ELEVENLABS_BASE_URL: 'wss://api.elevenlabs.io/v1',
    ELEVENLABS_SAMPLE_RATE: '24000',
  });
}

test.after(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('Agora agent payload contains the complete documented ElevenLabs TTS contract', () => {
  configure();
  const { payload } = buildAgentStartPayload({
    sessionId: 'session-1', opaqueAgoraChannel: 'df_opaque', customerUid: 456789,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, 'per-session-webhook-token');
  assert.deepEqual(payload.properties.tts, {
    vendor: 'elevenlabs',
    params: {
      base_url: 'wss://api.elevenlabs.io/v1', key: 'elevenlabs-secret',
      model_id: 'eleven_flash_v2_5', voice_id: 'female-voice-id', sample_rate: 24000,
    },
  });
  assert.deepEqual(payload.properties.remote_rtc_uids, ['*']);
  assert.match(payload.properties.llm.url, /^https:\/\/service\.example\/chat\/completions\//);
  assert.equal(payload.properties.asr.vendor, 'deepgram');
  assert.equal(payload.properties.asr.language, 'en-US');
});

test('Agora agent payload correctly configures Microsoft TTS', () => {
  configure();
  process.env.TTS_PROVIDER = 'microsoft';
  const { payload } = buildAgentStartPayload({
    sessionId: 'session-2', opaqueAgoraChannel: 'df_opaque2', customerUid: 123,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, 'per-session-webhook-token');
  assert.deepEqual(payload.properties.tts, {
    vendor: 'microsoft',
    params: {
      voice_name: 'en-US-JennyNeural'
    }
  });
  delete process.env.TTS_PROVIDER;
});

test('Agora agent payload correctly configures Sarvam TTS via generic_http', () => {
  configure();
  process.env.TTS_PROVIDER = 'sarvam';
  process.env.SARVAM_API_KEY = 'sarvam-test-key';
  process.env.INTERNAL_API_KEY = 'internal-test-key';
  const { payload } = buildAgentStartPayload({
    sessionId: 'session-3', opaqueAgoraChannel: 'df_opaque3', customerUid: 789,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, 'per-session-webhook-token');
  assert.equal(payload.properties.tts.vendor, 'generic_http');
  assert.equal(payload.properties.tts.url, 'https://service.example/api/public/tts/sarvam');
  assert.deepEqual(payload.properties.tts.headers, {
    Authorization: 'Bearer internal-test-key'
  });
  assert.deepEqual(payload.properties.tts.params, {
    model: 'bulbul:v3',
    voice: 'ishita',
    speed: 1.0,
    sample_rate: 16000,
    response_format: 'pcm'
  });
  delete process.env.TTS_PROVIDER;
  delete process.env.SARVAM_API_KEY;
  delete process.env.INTERNAL_API_KEY;
});

test('missing or invalid ElevenLabs TTS configuration prevents agent startup', () => {
  configure();
  delete process.env.ELEVENLABS_API_KEY;
  assert.throws(() => ttsConfig(), /ElevenLabs TTS configuration is incomplete/);
  process.env.ELEVENLABS_API_KEY = 'elevenlabs-secret';
  process.env.ELEVENLABS_SAMPLE_RATE = '12345';
  assert.throws(() => ttsConfig(), /ElevenLabs TTS configuration is incomplete/);
  process.env.ELEVENLABS_SAMPLE_RATE = '24000';
  process.env.ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
  assert.throws(() => ttsConfig(), /ElevenLabs TTS configuration is incomplete/);
});

test('Agora greeting uses the documented server-side Speak endpoint only after RTC readiness', async () => {
  configure();
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, `https://api.agora.io/api/conversational-ai-agent/v2/projects/${'a'.repeat(32)}/agents/agent-1/speak`);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { text: 'Hello', priority: 'APPEND', interruptable: true });
    return new Response(JSON.stringify({ message: 'accepted' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { assert.deepEqual(await speakAgent({ agentId: 'agent-1' }, 'Hello'), { accepted: true }); }
  finally { global.fetch = originalFetch; }
});
