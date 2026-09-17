require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { streamSpeech } = require('../src/lib/tts/elevenlabsStreamingTts');

describe('ElevenLabs Streaming TTS Service', () => {
  it('1. Rejects empty or missing text with clear validation error', async () => {
    await assert.rejects(async () => streamSpeech(''), /text is required/);
    await assert.rejects(async () => streamSpeech(null), /text is required/);
  });

  it('3. Streaming synthesis yields audio chunks with monotonic latency tracking', async () => {
    const receivedChunks = [];
    const tStart = Date.now();

    const result = await streamSpeech('DealForge enterprise sales intelligence.', {
      speaker: 'ishita',
      onChunk: (chunk) => {
        receivedChunks.push(chunk);
      },
      timeoutMs: 7000,
    });

    assert.ok(result.totalChunks >= 1, 'Should deliver at least one audio chunk');
    assert.ok(result.ttfbMs >= 0, 'ttfbMs must be non-negative');
    assert.ok(result.totalMs >= result.ttfbMs, 'totalMs must be >= ttfbMs');
    assert.ok(Array.isArray(result.audioBase64List), 'Must return audioBase64List array');

    // Verify first chunk structure
    const first = receivedChunks[0];
    assert.ok(first, 'First chunk must exist');
    assert.equal(typeof first.chunkIndex, 'number');
    assert.ok(
      ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/pcm', 'audio/pcm;rate=24000', 'audio/l16'].some(
        (type) => first.contentType.includes(type) || type.includes(first.contentType),
      ),
    );
  });

  it('4. Safe error handling never leaks ELEVENLABS_API_KEY in errors or outputs', async () => {
    try {
      const res = await streamSpeech('Short test phrase');
      const serialized = JSON.stringify(res);
      assert.ok(
        !serialized.includes(process.env.ELEVENLABS_API_KEY || 'no_key_found'),
        'API key must never be in result',
      );
    } catch (err) {
      assert.ok(
        !err.message.includes(process.env.ELEVENLABS_API_KEY || 'no_key_found'),
        'API key must never be in error message',
      );
    }
  });
});
