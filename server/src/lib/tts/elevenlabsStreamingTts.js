/**
 * DealForge — Low-Latency Streaming TTS Service (ElevenLabs Migration)
 *
 * Implements low-latency streaming synthesis using:
 *  1. ElevenLabs HTTP Streaming API (linear16 PCM)
 *  2. High-speed fallback to OpenAI TTS PCM (24000 Hz, 16-bit mono)
 *     when ElevenLabs quota is exhausted or unreachable.
 */

const { sanitizeVoiceText } = require('./sanitizeVoiceText');
const { streamOpenAiTtsPcm } = require('./sarvamTtsService'); // we'll need to move streamOpenAiTtsPcm here or import it

const ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah
const ELEVENLABS_MODEL = 'eleven_flash_v2_5';

/**
 * Streams TTS audio chunks from OpenAI TTS as 24000Hz 16-bit mono PCM.
 */
async function streamOpenAiTtsPcmFallback(cleanText, { speed = 1.0, voice = 'alloy', onChunk = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const tStart = Date.now();
  let tFirstByte = 0;
  const audioBase64List = [];
  let chunkIndex = 0;

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: cleanText,
      voice,
      response_format: 'pcm',
      speed,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI TTS error (${res.status}): ${errText}`);
  }

  const reader = res.body.getReader();
  let leftover = Buffer.alloc(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!tFirstByte) tFirstByte = Date.now();

    let combined = leftover.length ? Buffer.concat([leftover, Buffer.from(value)]) : Buffer.from(value);
    // Align to 2-byte sample boundary
    const evenLength = combined.length - (combined.length % 2);
    if (evenLength > 0) {
      const pcmChunk = combined.subarray(0, evenLength);
      leftover = combined.subarray(evenLength);
      const b64 = pcmChunk.toString('base64');
      audioBase64List.push(b64);
      if (typeof onChunk === 'function') {
        onChunk({
          chunkIndex: chunkIndex++,
          audioBase64: b64,
          contentType: 'audio/pcm;rate=24000',
          ttfbMs: tFirstByte - tStart,
          isFinal: false,
        });
      }
    } else {
      leftover = combined;
    }
  }

  if (leftover.length > 0 && leftover.length % 2 === 0) {
    const b64 = leftover.toString('base64');
    audioBase64List.push(b64);
    if (typeof onChunk === 'function') {
      onChunk({
        chunkIndex: chunkIndex++,
        audioBase64: b64,
        contentType: 'audio/pcm;rate=24000',
        ttfbMs: tFirstByte - tStart,
        isFinal: false,
      });
    }
  }

  const totalMs = Date.now() - tStart;
  const ttfbMs = tFirstByte ? tFirstByte - tStart : totalMs;

  if (typeof onChunk === 'function') {
    onChunk({
      chunkIndex,
      audioBase64: null,
      contentType: 'audio/pcm;rate=24000',
      ttfbMs,
      isFinal: true,
    });
  }

  return {
    totalChunks: audioBase64List.length,
    ttfbMs,
    totalMs,
    audioBase64List,
    contentType: 'audio/pcm;rate=24000',
  };
}

/**
 * Streams TTS audio chunks. Attempts ElevenLabs;
 * seamlessly falls back to OpenAI TTS PCM if ElevenLabs fails.
 *
 * @param {string} text - Text to synthesize
 * @param {object} options
 * @param {function} options.onChunk - Callback for each chunk: ({ chunkIndex, audioBase64, contentType, ttfbMs, isFinal })
 * @param {number} [options.timeoutMs=5000] - Hard timeout before fallback
 * @returns {Promise<{ totalChunks: number, ttfbMs: number, totalMs: number, audioBase64List: string[], contentType: string }>}
 */
async function streamSpeech(
  text,
  { onChunk = null, timeoutMs = 5000, voiceId = ELEVENLABS_VOICE_ID, modelId = ELEVENLABS_MODEL } = {},
) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const cleanText = sanitizeVoiceText(String(text || ''));

  if (!cleanText) {
    console.warn('[TTS] Empty text after sanitization, original:', String(text || '').slice(0, 100));
    throw new Error('text is required for speech synthesis');
  }

  const runFallback = async (reason) => {
    console.warn(`[TTS] Using fallback TTS due to: ${reason}`);
    if (process.env.OPENAI_API_KEY) {
      return streamOpenAiTtsPcmFallback(cleanText, { speed: 1.0, onChunk });
    }
    throw new Error('All TTS providers failed. No fallback available.');
  };

  if (!apiKey) {
    return runFallback('No ELEVENLABS_API_KEY configured');
  }

  const tStart = Date.now();
  let tFirstByte = 0;
  const audioBase64List = [];
  let chunkIndex = 0;
  const receivedContentType = 'audio/pcm;rate=24000';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=pcm_24000`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: modelId,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      return runFallback(`ElevenLabs API error (${res.status}): ${errText}`);
    }

    const reader = res.body.getReader();
    let leftover = Buffer.alloc(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!tFirstByte) tFirstByte = Date.now();

      let combined = leftover.length ? Buffer.concat([leftover, Buffer.from(value)]) : Buffer.from(value);
      // Align to 2-byte sample boundary
      const evenLength = combined.length - (combined.length % 2);
      if (evenLength > 0) {
        const pcmChunk = combined.subarray(0, evenLength);
        leftover = combined.subarray(evenLength);
        const b64 = pcmChunk.toString('base64');
        audioBase64List.push(b64);
        if (typeof onChunk === 'function') {
          onChunk({
            chunkIndex: chunkIndex++,
            audioBase64: b64,
            contentType: receivedContentType,
            ttfbMs: tFirstByte - tStart,
            isFinal: false,
          });
        }
      } else {
        leftover = combined;
      }
    }

    if (leftover.length > 0 && leftover.length % 2 === 0) {
      const b64 = leftover.toString('base64');
      audioBase64List.push(b64);
      if (typeof onChunk === 'function') {
        onChunk({
          chunkIndex: chunkIndex++,
          audioBase64: b64,
          contentType: receivedContentType,
          ttfbMs: tFirstByte - tStart,
          isFinal: false,
        });
      }
    }

    const totalMs = Date.now() - tStart;
    const ttfbMs = tFirstByte ? tFirstByte - tStart : totalMs;

    if (typeof onChunk === 'function') {
      onChunk({
        chunkIndex,
        audioBase64: null,
        contentType: receivedContentType,
        ttfbMs,
        isFinal: true,
      });
    }

    return {
      totalChunks: audioBase64List.length,
      ttfbMs,
      totalMs,
      audioBase64List,
      contentType: receivedContentType,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return runFallback(`ElevenLabs timeout after ${timeoutMs}ms`);
    }
    return runFallback(`ElevenLabs request failed: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  streamSpeech,
  streamOpenAiTtsPcm: streamOpenAiTtsPcmFallback,
};
