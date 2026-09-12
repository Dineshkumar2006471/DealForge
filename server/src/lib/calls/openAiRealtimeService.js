const { HttpError } = require('../security/auth');

/**
 * Mint an ephemeral client secret for OpenAI Realtime WebRTC.
 * Never exposes the primary OPENAI_API_KEY to the client.
 *
 * @param {object} [options]
 * @param {string} [options.model] - defaults to OPENAI_REALTIME_MODEL env var or 'gpt-realtime-2.1-mini'
 * @returns {Promise<{ clientSecret: string, expiresAt: number, model: string }>}
 */
async function createRealtimeSession({
  model = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini'
} = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpError(503, 'OpenAI API key is not configured on the server');
  }

  // Official GA session configuration for client secret minting
  const gaSessionConfig = {
    type: 'realtime',
    model,
    instructions: "You are DealForge's voice listener. Accurately transcribe speech and do not generate audio responses.",
    audio: {
      input: {
        transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: false
        }
      }
    }
  };

  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ session: gaSessionConfig })
  });

  if (!response.ok) {
    let errorDetails = '';
    try {
      const errJson = await response.json();
      errorDetails = errJson.error?.message || errJson.error?.code || JSON.stringify(errJson);
    } catch (_) {
      try {
        errorDetails = await response.text();
      } catch (__) {
        errorDetails = response.statusText;
      }
    }
    console.error('OpenAI Realtime client_secrets minting failed:', {
      endpoint: '/v1/realtime/client_secrets',
      status: response.status,
      model,
      error: errorDetails
    });
    throw new HttpError(502, `Failed to create OpenAI Realtime session (${response.status}): ${errorDetails}`);
  }

  const data = await response.json();
  const clientSecret = data.value || data.client_secret?.value;
  if (!clientSecret) {
    throw new HttpError(502, 'OpenAI did not return a valid client_secret');
  }

  return {
    clientSecret,
    expiresAt: data.expires_at || data.client_secret?.expires_at || (Date.now() + 60000),
    model
  };
}

module.exports = { createRealtimeSession };
