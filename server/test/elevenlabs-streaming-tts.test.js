const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { streamSpeech } = require('../src/lib/tts/elevenlabsStreamingTts');

describe('ElevenLabs Streaming TTS Service', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.ELEVENLABS_API_KEY;

  before(() => {
    process.env.ELEVENLABS_API_KEY = 'test-mock-elevenlabs-key';
  });

  after(() => {
    global.fetch = originalFetch;
    if (originalApiKey !== undefined) {
      process.env.ELEVENLABS_API_KEY = originalApiKey;
    } else {
      delete process.env.ELEVENLABS_API_KEY;
    }
  });

  it('1. Rejects empty or missing text with clear validation error', async () => {
    await assert.rejects(async () => streamSpeech(''), /text is required/);
    await assert.rejects(async () => streamSpeech(null), /text is required/);
  });

  it('2. Streaming synthesis yields audio chunks with monotonic latency tracking via mocked stream', async () => {
    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6, 7, 8]);

    global.fetch = async (url, options) => {
      assert.ok(url.includes('api.elevenlabs.io'), 'Must call ElevenLabs endpoint');
      assert.equal(options.headers['xi-api-key'], 'test-mock-elevenlabs-key');
      const body = JSON.parse(options.body);
      assert.ok(body.text.includes('DealForge'), 'Request body must contain text');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk1);
          controller.enqueue(chunk2);
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'audio/pcm;rate=24000' },
      });
    };

    const receivedChunks = [];
    const result = await streamSpeech('DealForge enterprise sales intelligence.', {
      onChunk: (chunk) => {
        receivedChunks.push(chunk);
      },
      timeoutMs: 5000,
    });

    assert.ok(result.totalChunks >= 2, 'Should deliver at least two audio chunks');
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

  it('3. Safe error handling never leaks ELEVENLABS_API_KEY in errors or outputs', async () => {
    global.fetch = async () => {
      throw new Error('Upstream connection reset with sensitive key test-mock-elevenlabs-key');
    };

    try {
      const res = await streamSpeech('Short test phrase');
      const serialized = JSON.stringify(res);
      assert.ok(!serialized.includes('test-mock-elevenlabs-key'), 'API key must never be in result');
    } catch (err) {
      // If error is thrown, verify key is not in message
      assert.ok(!err.message.includes('test-mock-elevenlabs-key'), 'API key must never be in error message');
    }
  });
});
