const test = require('node:test');
const assert = require('node:assert/strict');

const { ttsConfig, buildAgentStartPayload } = require('../src/lib/calls/agoraAgentService');

const keys = [
  'AGORA_APP_ID', 'AGORA_APP_CERTIFICATE', 'AGORA_CUSTOMER_ID', 'AGORA_CUSTOMER_SECRET',
  'AGORA_LLM_WEBHOOK_SECRET', 'CLOUD_RUN_URL', 'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL_ID', 'ELEVENLABS_BASE_URL', 'ELEVENLABS_SAMPLE_RATE',
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
    sessionId: 'session-1', opaqueAgoraChannel: 'df_opaque',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, 'per-session-webhook-token');
  assert.deepEqual(payload.properties.tts, {
    vendor: 'elevenlabs',
    params: {
      base_url: 'wss://api.elevenlabs.io/v1', key: 'elevenlabs-secret',
      model_id: 'eleven_flash_v2_5', voice_id: 'female-voice-id', sample_rate: 24000,
    },
  });
  assert.match(payload.properties.llm.url, /^https:\/\/service\.example\/chat\/completions\//);
});

test('missing or invalid ElevenLabs TTS configuration prevents agent startup', () => {
  configure();
  delete process.env.ELEVENLABS_API_KEY;
  assert.throws(() => ttsConfig(), /ElevenLabs TTS configuration is incomplete/);
  process.env.ELEVENLABS_API_KEY = 'elevenlabs-secret';
  process.env.ELEVENLABS_SAMPLE_RATE = '12345';
  assert.throws(() => ttsConfig(), /ElevenLabs TTS configuration is incomplete/);
});
