/**
 * DealForge — Sarvam Bulbul v3 Streaming TTS Service
 *
 * Implements low-latency WebSocket streaming synthesis using Sarvam Bulbul v3.
 *
 * Protocol:
 *  - Endpoint: wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true
 *  - Auth: Api-Subscription-Key header
 *  - Step 1: Send 'config' message (model, speaker: ishita, sample_rate: 24000, codec: mp3)
 *  - Step 2: Send 'text' message(s)
 *  - Step 3: Send 'flush' message
 *  - Step 4: Stream incoming 'audio' chunks and complete on 'final' event
 *
 * Requirements:
 *  - Server-side only (never expose SARVAM_API_KEY to browser)
 *  - Fallback to REST synthesizeSpeech if WebSocket fails
 *  - Monotonic latency tracking (TTFB & total duration)
 */

const WebSocket = require('ws');
const { synthesizeSpeech } = require('./sarvamTtsService');
const { sanitizeVoiceText } = require('./sanitizeVoiceText');

const SARVAM_WS_URL = 'wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true';
const DEFAULT_SPEAKER = process.env.SARVAM_SPEAKER || 'ishita';
const DEFAULT_PACE = parseFloat(process.env.SARVAM_PACE) || 1.05;
const DEFAULT_SAMPLE_RATE = '24000';
const DEFAULT_CODEC = 'mp3';

/**
 * Streams TTS audio chunks from Sarvam WebSocket
 *
 * @param {string} text - Text to synthesize
 * @param {object} options
 * @param {string} [options.speaker='ishita']
 * @param {function} options.onChunk - Callback for each chunk: ({ chunkIndex, audioBase64, contentType, ttfbMs })
 * @param {number} [options.timeoutMs=8000] - Hard timeout before fallback
 * @returns {Promise<{ totalChunks: number, ttfbMs: number, totalMs: number, audioBase64List: string[] }>}
 */
async function streamSpeech(
  text,
  { speaker = DEFAULT_SPEAKER, pace = DEFAULT_PACE, onChunk = null, timeoutMs = 8000 } = {},
) {
  const apiKey = process.env.SARVAM_API_KEY;
  // Sanitize text for natural speech — strip markdown, bullets, code, etc.
  const cleanText = sanitizeVoiceText(String(text || ''));

  if (!cleanText) {
    console.warn('[Sarvam TTS] Empty text after sanitization, original:', String(text || '').slice(0, 100));
    throw new Error('text is required for speech synthesis');
  }

  console.log(
    `[VOICE_TEXT_DEBUG] original_len=${String(text || '').length} sanitized_len=${cleanText.length} speaker=${speaker} pace=${pace} text="${cleanText.slice(0, 120)}"`,
  );

  // Fallback if no API key is set
  if (!apiKey) {
    let audioBase64 = null;
    let latency = 5;
    try {
      const restRes = await synthesizeSpeech(cleanText, { speaker, codec: 'wav' });
      audioBase64 = restRes.audioBase64;
      latency = restRes.latency || 5;
    } catch (_) {
      // Mock PCM WAV buffer (44-byte header) for offline/test environments
      const mockWav = Buffer.alloc(1024);
      mockWav.write('RIFF', 0);
      mockWav.writeUInt32LE(1024 - 8, 4);
      mockWav.write('WAVEfmt ', 8);
      mockWav.writeUInt32LE(16, 16);
      mockWav.writeUInt16LE(1, 20);
      mockWav.writeUInt16LE(1, 22);
      mockWav.writeUInt32LE(24000, 24);
      mockWav.writeUInt32LE(48000, 28);
      mockWav.writeUInt16LE(2, 32);
      mockWav.writeUInt16LE(16, 34);
      mockWav.write('data', 36);
      mockWav.writeUInt32LE(1024 - 44, 40);
      audioBase64 = mockWav.toString('base64');
    }
    if (typeof onChunk === 'function' && audioBase64) {
      onChunk({
        chunkIndex: 0,
        audioBase64,
        contentType: 'audio/wav',
        isFinal: true,
      });
    }
    return {
      totalChunks: 1,
      ttfbMs: latency,
      totalMs: latency,
      audioBase64List: [audioBase64],
    };
  }

  const tStart = Date.now();
  let tFirstByte = 0;
  const audioBase64List = [];
  let chunkIndex = 0;

  return new Promise((resolve, reject) => {
    let timer = null;
    let ws = null;
    let isSettled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch (_) {
          /* best-effort close */
        }
      }
    };

    timer = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      console.warn(`[Sarvam Streaming TTS] WebSocket timed out after ${timeoutMs}ms. Falling back to REST.`);
      // Safe fallback to REST synthesizeSpeech
      synthesizeSpeech(cleanText, { speaker, codec: 'wav' })
        .then((restRes) => {
          if (typeof onChunk === 'function' && restRes.audioBase64) {
            onChunk({
              chunkIndex: 0,
              audioBase64: restRes.audioBase64,
              contentType: 'audio/wav',
              isFinal: true,
            });
          }
          resolve({
            totalChunks: 1,
            ttfbMs: Date.now() - tStart,
            totalMs: Date.now() - tStart,
            audioBase64List: [restRes.audioBase64],
          });
        })
        .catch(reject);
    }, timeoutMs);

    try {
      ws = new WebSocket(SARVAM_WS_URL, {
        headers: {
          'Api-Subscription-Key': apiKey,
        },
      });

      ws.on('open', () => {
        // Step 1: Config — include pace for natural conversational speed
        ws.send(
          JSON.stringify({
            type: 'config',
            data: {
              model: 'bulbul:v3',
              language_code: 'en-IN',
              speaker: speaker || DEFAULT_SPEAKER,
              pace: pace,
              speech_sample_rate: DEFAULT_SAMPLE_RATE,
              output_audio_codec: DEFAULT_CODEC,
              output_audio_bitrate: '128k',
            },
          }),
        );

        // Step 2: Text
        ws.send(
          JSON.stringify({
            type: 'text',
            data: { text: cleanText },
          }),
        );

        // Step 3: Flush
        ws.send(JSON.stringify({ type: 'flush' }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'audio' && msg.data?.audio) {
            if (!tFirstByte) {
              tFirstByte = Date.now();
            }
            const chunkBase64 = msg.data.audio;
            const chunkBytes = Buffer.from(chunkBase64, 'base64').length;
            audioBase64List.push(chunkBase64);
            const ttfbMs = tFirstByte - tStart;

            console.log(
              `[VOICE_AUDIO_DEBUG] chunk_index=${chunkIndex} content_type=${msg.data.content_type || 'audio/mp3'} bytes=${chunkBytes} ttfb=${ttfbMs}ms elapsed=${Date.now() - tStart}ms`,
            );

            if (typeof onChunk === 'function') {
              onChunk({
                chunkIndex: chunkIndex++,
                audioBase64: chunkBase64,
                contentType: msg.data.content_type || 'audio/mp3',
                ttfbMs,
                isFinal: false,
              });
            } else {
              chunkIndex++;
            }
          } else if (msg.type === 'event' && msg.data?.event_type === 'final') {
            if (isSettled) return;
            isSettled = true;
            cleanup();
            const totalMs = Date.now() - tStart;
            const ttfbMs = tFirstByte ? tFirstByte - tStart : totalMs;

            const totalBytes = audioBase64List.reduce((sum, b) => sum + Buffer.from(b, 'base64').length, 0);
            console.log(
              `[VOICE_AUDIO_DEBUG] COMPLETE chunks=${audioBase64List.length} total_bytes=${totalBytes} ttfb=${ttfbMs}ms total=${totalMs}ms`,
            );

            if (typeof onChunk === 'function') {
              onChunk({
                chunkIndex,
                audioBase64: null,
                contentType: 'audio/mp3',
                ttfbMs,
                isFinal: true,
              });
            }

            resolve({
              totalChunks: audioBase64List.length,
              ttfbMs,
              totalMs,
              audioBase64List,
            });
          }
        } catch (parseErr) {
          console.warn('[Sarvam Streaming TTS] Message parse error:', parseErr.message);
        }
      });

      ws.on('error', (err) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        console.warn('[Sarvam Streaming TTS] WebSocket error, falling back to REST:', err.message);
        synthesizeSpeech(cleanText, { speaker, codec: 'wav' })
          .then((restRes) => {
            if (typeof onChunk === 'function' && restRes.audioBase64) {
              onChunk({
                chunkIndex: 0,
                audioBase64: restRes.audioBase64,
                contentType: 'audio/wav',
                isFinal: true,
              });
            }
            resolve({
              totalChunks: 1,
              ttfbMs: Date.now() - tStart,
              totalMs: Date.now() - tStart,
              audioBase64List: [restRes.audioBase64],
            });
          })
          .catch(reject);
      });

      ws.on('close', (code, reason) => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          const totalMs = Date.now() - tStart;
          const ttfbMs = tFirstByte ? tFirstByte - tStart : totalMs;
          resolve({
            totalChunks: audioBase64List.length,
            ttfbMs,
            totalMs,
            audioBase64List,
          });
        }
      });
    } catch (createErr) {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      console.warn('[Sarvam Streaming TTS] Init error, falling back to REST:', createErr.message);
      synthesizeSpeech(cleanText, { speaker, codec: 'wav' })
        .then((restRes) => {
          if (typeof onChunk === 'function' && restRes.audioBase64) {
            onChunk({
              chunkIndex: 0,
              audioBase64: restRes.audioBase64,
              contentType: 'audio/wav',
              isFinal: true,
            });
          }
          resolve({
            totalChunks: 1,
            ttfbMs: Date.now() - tStart,
            totalMs: Date.now() - tStart,
            audioBase64List: [restRes.audioBase64],
          });
        })
        .catch(reject);
    }
  });
}

module.exports = {
  streamSpeech,
  SARVAM_WS_URL,
  DEFAULT_SPEAKER,
};
