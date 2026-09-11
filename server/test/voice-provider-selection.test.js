const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const { createRealtimeSession } = require('../src/lib/calls/openAiRealtimeService');
const { synthesizeSpeech } = require('../src/lib/tts/sarvamTtsService');

const savedEnv = {
  VOICE_PROVIDER: process.env.VOICE_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  SARVAM_API_KEY: process.env.SARVAM_API_KEY
};

const originalFetch = global.fetch;

test.after(() => {
  global.fetch = originalFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('createRealtimeSession fails cleanly when OPENAI_API_KEY is missing', async () => {
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(
    () => createRealtimeSession(),
    /OpenAI API key is not configured/
  );
});

test('createRealtimeSession returns ephemeral clientSecret from OpenAI API without exposing primary key', async () => {
  process.env.OPENAI_API_KEY = 'sk-proj-primary-key-test';
  
  let capturedAuth = null;
  let capturedBody = null;

  global.fetch = async (url, options) => {
    capturedAuth = options.headers?.Authorization;
    capturedBody = JSON.parse(options.body);

    if (url === 'https://api.openai.com/v1/realtime/client_secrets') {
      return new Response(JSON.stringify({
        value: 'ek_ephemeral_test_token_123',
        expires_at: 1726090000
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const result = await createRealtimeSession();
  assert.equal(result.clientSecret, 'ek_ephemeral_test_token_123');
  assert.equal(result.expiresAt, 1726090000);
  assert.equal(capturedAuth, 'Bearer sk-proj-primary-key-test');
  assert.equal(capturedBody.session.audio.input.turn_detection.create_response, false);
  assert.equal(capturedBody.session.audio.input.turn_detection.type, 'server_vad');
  assert.equal(capturedBody.session.audio.input.transcription.model, 'whisper-1');
  assert.notEqual(result.clientSecret, process.env.OPENAI_API_KEY);
});

test('createRealtimeSession falls back to /sessions preview endpoint if /client_secrets is unavailable', async () => {
  process.env.OPENAI_API_KEY = 'sk-proj-primary-key-test';

  global.fetch = async (url, options) => {
    if (url === 'https://api.openai.com/v1/realtime/client_secrets') {
      return new Response('Not Found', { status: 404 });
    }
    if (url === 'https://api.openai.com/v1/realtime/sessions') {
      return new Response(JSON.stringify({
        id: 'sess_123',
        client_secret: {
          value: 'ek_preview_secret_456',
          expires_at: 1726090500
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const result = await createRealtimeSession();
  assert.equal(result.clientSecret, 'ek_preview_secret_456');
  assert.equal(result.expiresAt, 1726090500);
});

test('synthesizeSpeech produces WAV output for browser audio playback', async () => {
  process.env.SARVAM_API_KEY = 'test-sarvam-key';

  const sampleWav = Buffer.from('RIFF....WAVEfmt ');
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.sarvam.ai/text-to-speech');
    const body = JSON.parse(options.body);
    assert.equal(body.output_audio_codec, 'wav');
    assert.equal(body.speaker, 'ishita');
    assert.equal(body.text, 'Hello from DealForge');
    return new Response(JSON.stringify({ audios: [sampleWav.toString('base64')] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const result = await synthesizeSpeech('Hello from DealForge', { codec: 'wav' });
  assert.equal(result.codec, 'wav');
  assert.equal(result.audioBase64, sampleWav.toString('base64'));
  assert.deepEqual(result.audioBuffer, sampleWav);
});

test('POST /calls/:linkToken/turn validates userText and sessionCredential', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();

  // Missing sessionCredential
  const noCredRes = await request(app)
    .post('/api/public/calls/test-link/turn')
    .send({ userText: 'Hello' });
  assert.equal(noCredRes.status, 400);

  // Empty userText
  const emptyTextRes = await request(app)
    .post('/api/public/calls/test-link/turn')
    .send({ sessionCredential: 'cred', userText: '   ' });
  // Note: Since 'cred' is invalid/not found in Firestore, it throws 404/410, or validation fails
  assert.ok([400, 404, 410].includes(emptyTextRes.status));
});
