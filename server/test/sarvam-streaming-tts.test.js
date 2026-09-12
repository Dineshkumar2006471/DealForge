require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { streamSpeech, SARVAM_WS_URL, DEFAULT_SPEAKER } = require('../src/lib/tts/sarvamStreamingTts');

describe('Sarvam Bulbul v3 Streaming TTS Service', () => {
  it('1. Rejects empty or missing text with clear validation error', async () => {
    await assert.rejects(
      async () => streamSpeech(''),
      /text is required/
    );
    await assert.rejects(
      async () => streamSpeech(null),
      /text is required/
    );
  });

  it('2. Exposes correct default configuration and official AsyncAPI endpoint', () => {
    assert.ok(SARVAM_WS_URL.includes('wss://api.sarvam.ai/text-to-speech/ws'));
    assert.ok(SARVAM_WS_URL.includes('model=bulbul:v3'));
    assert.equal(DEFAULT_SPEAKER, 'ishita');
  });

  it('3. Streaming synthesis yields audio chunks with monotonic latency tracking', async () => {
    const receivedChunks = [];
    const tStart = Date.now();

    const result = await streamSpeech('DealForge enterprise sales intelligence.', {
      speaker: 'ishita',
      onChunk: (chunk) => {
        receivedChunks.push(chunk);
      },
      timeoutMs: 7000
    });

    assert.ok(result.totalChunks >= 1, 'Should deliver at least one audio chunk');
    assert.ok(result.ttfbMs >= 0, 'ttfbMs must be non-negative');
    assert.ok(result.totalMs >= result.ttfbMs, 'totalMs must be >= ttfbMs');
    assert.ok(Array.isArray(result.audioBase64List), 'Must return audioBase64List array');

    // Verify first chunk structure
    const first = receivedChunks[0];
    assert.ok(first, 'First chunk must exist');
    assert.equal(typeof first.chunkIndex, 'number');
    assert.ok(first.audioBase64, 'Chunk must contain base64 audio payload');
    assert.ok(['audio/mpeg', 'audio/mp3', 'audio/wav'].includes(first.contentType));
  });

  it('4. Safe error handling never leaks SARVAM_API_KEY in errors or outputs', async () => {
    try {
      const res = await streamSpeech('Short test phrase');
      const serialized = JSON.stringify(res);
      assert.ok(!serialized.includes(process.env.SARVAM_API_KEY || 'no_key_found'), 'API key must never be in result');
    } catch (err) {
      assert.ok(!err.message.includes(process.env.SARVAM_API_KEY || 'no_key_found'), 'API key must never be in error message');
    }
  });
});
