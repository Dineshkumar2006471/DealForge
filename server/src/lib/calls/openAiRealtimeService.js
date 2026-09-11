const { HttpError } = require('../security/auth');

/**
 * Mint an ephemeral client secret for OpenAI Realtime WebRTC.
 * Never exposes the primary OPENAI_API_KEY to the client.
 *
 * @param {object} [options]
 * @param {string} [options.model='gpt-4o-realtime-preview']
 * @returns {Promise<{ clientSecret: string, expiresAt: number, model: string }>}
 */
async function createRealtimeSession({
  model = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini'
} = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpError(503, 'OpenAI API key is not configured on the server');
  }

  // GA session config structure
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

  // Try official GA client_secrets endpoint first
  let response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ session: gaSessionConfig })
  }).catch(() => null);

  let data = null;
  if (response && response.ok) {
    data = await response.json();
    const clientSecret = data.value || data.client_secret?.value;
    if (clientSecret) {
      return {
        clientSecret,
        expiresAt: data.expires_at || (Date.now() + 60000),
        model
      };
    }
  }

  // Fallback legacy preview config
  const legacyConfig = {
    model,
    modalities: ['audio', 'text'],
    instructions: "You are DealForge's voice listener. Accurately transcribe speech and do not generate text responses.",
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      create_response: false
    },
    input_audio_transcription: {
      model: 'whisper-1'
    }
  };

  response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'realtime=v1',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(legacyConfig)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI Realtime session minting failed:', response.status, errorText);
    throw new HttpError(502, `Failed to create OpenAI Realtime session (${response.status})`);
  }

  data = await response.json();
  const clientSecret = data.client_secret?.value || data.value;
  if (!clientSecret) {
    throw new HttpError(502, 'OpenAI did not return a valid client_secret');
  }

  return {
    clientSecret,
    expiresAt: data.client_secret?.expires_at || data.expires_at || (Date.now() + 60000),
    model
  };
}

module.exports = { createRealtimeSession };
