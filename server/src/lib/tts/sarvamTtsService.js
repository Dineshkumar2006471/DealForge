const { HttpError } = require('../security/auth');

/**
 * Synthesize speech using Sarvam AI (bulbul:v3 / Ishita)
 * @param {string} text - text to speak
 * @param {object} options
 * @param {string} [options.speaker='ishita']
 * @param {string} [options.model='bulbul:v3']
 * @param {string} [options.languageCode='en-IN']
 * @param {number} [options.pace=1.0]
 * @param {number} [options.sampleRate=16000]
 * @param {'wav'|'linear16'} [options.codec='wav']
 * @returns {Promise<{ audioBuffer: Buffer, audioBase64: string, sampleRate: number, codec: string, durationMs?: number }>}
 */
async function synthesizeSpeech(
  text,
  {
    speaker = process.env.SARVAM_SPEAKER || 'ishita',
    model = process.env.SARVAM_MODEL || 'bulbul:v3',
    languageCode = process.env.SARVAM_LANGUAGE || 'en-IN',
    pace = 1.0,
    sampleRate = 16000,
    codec = 'wav',
  } = {},
) {
  const sarvamApiKey = process.env.SARVAM_API_KEY;
  if (!sarvamApiKey) {
    throw new HttpError(503, 'Sarvam API key not configured');
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new HttpError(400, 'Text to synthesize is required');
  }

  const sarvamPayload = {
    text: text.trim(),
    model,
    language_code: languageCode,
    speaker,
    pace,
    speech_sample_rate: sampleRate,
    output_audio_codec: codec,
  };

  const start = Date.now();
  let response = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': sarvamApiKey,
        },
        body: JSON.stringify(sarvamPayload),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) break;
      if (response.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      break;
    } catch (err) {
      lastError = err;
      console.warn(`[SarvamTTS] Attempt ${attempt} failed:`, err.message);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  const latency = Date.now() - start;

  if (!response || !response.ok) {
    const errorText = response ? await response.text() : lastError?.message || 'unreachable';
    console.warn(
      `[SarvamTTS] API failed (${response?.status || 'unreachable'}): ${errorText}. Falling back to OpenAI TTS.`,
    );
    if (process.env.OPENAI_API_KEY) {
      try {
        const oaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: text.trim(),
            voice: 'alloy',
            response_format: codec === 'linear16' ? 'pcm' : codec === 'mp3' ? 'mp3' : 'wav',
            speed: pace || 1.0,
          }),
        });
        if (oaiRes.ok) {
          const buf = Buffer.from(await oaiRes.arrayBuffer());
          const audioBase64 = buf.toString('base64');
          console.info('OpenAI TTS Fallback OK', { latency: Date.now() - start, audioBytes: buf.length, codec });
          return {
            audioBuffer: buf,
            audioBase64,
            sampleRate: codec === 'linear16' ? 24000 : sampleRate,
            codec: codec === 'linear16' ? 'linear16' : codec === 'mp3' ? 'mp3' : 'wav',
            latency: Date.now() - start,
          };
        }
      } catch (oaiErr) {
        console.error('OpenAI TTS fallback error:', oaiErr.message);
      }
    }
    throw new HttpError(502, `Upstream TTS provider failed (${response?.status || 502})`);
  }

  const data = await response.json();
  if (!data.audios || data.audios.length === 0) {
    throw new HttpError(502, 'No audio returned by TTS provider');
  }

  const audioBase64 = data.audios[0];
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  console.info('Sarvam TTS OK', { speaker, latency, audioBytes: audioBuffer.length, codec });

  return {
    audioBuffer,
    audioBase64,
    sampleRate,
    codec,
    latency,
  };
}

module.exports = { synthesizeSpeech };
