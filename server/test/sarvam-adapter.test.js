const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const publicCalls = require('../src/routes/publicCalls');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicCalls);
  return app;
}

const originalFetch = global.fetch;
const savedEnv = {
  SARVAM_API_KEY: process.env.SARVAM_API_KEY,
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
};

test.after(() => {
  global.fetch = originalFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('Sarvam TTS adapter rejects requests without input text', async () => {
  process.env.SARVAM_API_KEY = 'test-sarvam-key';
  const app = createTestApp();
  const res = await request(app)
    .post('/api/public/tts/sarvam')
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'missing_parameter');
});

test('Sarvam TTS adapter validates INTERNAL_API_KEY when set', async () => {
  process.env.SARVAM_API_KEY = 'test-sarvam-key';
  process.env.INTERNAL_API_KEY = 'secret-token';
  const app = createTestApp();
  
  // Unauthorized request
  const unauthRes = await request(app)
    .post('/api/public/tts/sarvam')
    .send({ input: 'Hello' });
  assert.equal(unauthRes.status, 401);
  assert.equal(unauthRes.body.error.code, 'invalid_token');

  // Authorized request
  const samplePcm = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.sarvam.ai/text-to-speech');
    const body = JSON.parse(options.body);
    assert.equal(body.output_audio_codec, 'linear16');
    assert.equal(body.speaker, 'ishita');
    return new Response(JSON.stringify({ audios: [samplePcm.toString('base64')] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const authRes = await request(app)
    .post('/api/public/tts/sarvam')
    .set('Authorization', 'Bearer secret-token')
    .send({ input: 'Hello' });
  assert.equal(authRes.status, 200);
  assert.equal(authRes.headers['content-type'], 'audio/pcm');
  assert.deepEqual(authRes.body, samplePcm);

  delete process.env.INTERNAL_API_KEY;
});

test('Sarvam TTS adapter returns audio/pcm with linear16 audio buffer', async () => {
  process.env.SARVAM_API_KEY = 'test-sarvam-key';
  delete process.env.INTERNAL_API_KEY;
  const app = createTestApp();
  const samplePcm = Buffer.from([10, 20, 30, 40]);

  let sentPayload;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.sarvam.ai/text-to-speech');
    assert.equal(options.headers['api-subscription-key'], 'test-sarvam-key');
    sentPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ audios: [samplePcm.toString('base64')] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const res = await request(app)
    .post('/api/public/tts/sarvam')
    .send({ input: 'Welcome to DealForge', voice: 'ishita', speed: 1.2 });

  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'audio/pcm');
  assert.equal(sentPayload.text, 'Welcome to DealForge');
  assert.equal(sentPayload.speaker, 'ishita');
  assert.equal(sentPayload.pace, 1.2);
  assert.equal(sentPayload.output_audio_codec, 'linear16');
  assert.deepEqual(res.body, samplePcm);
});
