require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const WebSocket = require('ws');

const apiKey = process.env.SARVAM_API_KEY;
console.log('SARVAM_API_KEY:', apiKey ? apiKey.slice(0, 8) + '...' : 'missing');

const ws = new WebSocket('wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true', {
  headers: {
    'Api-Subscription-Key': apiKey,
  },
});

ws.on('open', () => {
  console.log('WS OPEN');
  const cfg = {
    type: 'config',
    data: {
      model: 'bulbul:v3',
      language_code: 'en-IN',
      speaker: 'ishita',
      pace: 1.05,
      speech_sample_rate: '24000',
      output_audio_codec: 'mp3',
      output_audio_bitrate: '128k',
    },
  };
  console.log('Sending config:', JSON.stringify(cfg));
  ws.send(JSON.stringify(cfg));

  const txt = {
    type: 'text',
    data: { text: 'Hello, thanks for joining. How large is your team?' },
  };
  console.log('Sending text:', JSON.stringify(txt));
  ws.send(JSON.stringify(txt));

  console.log('Sending flush');
  ws.send(JSON.stringify({ type: 'flush' }));
});

ws.on('message', (data) => {
  console.log('WS MESSAGE received, length:', data.length);
  try {
    const parsed = JSON.parse(data.toString());
    console.log('WS MESSAGE PARSED keys:', Object.keys(parsed), 'type:', parsed.type, 'data keys:', parsed.data ? Object.keys(parsed.data) : null);
    if (parsed.data?.audio) {
      console.log('-> Has audio base64, length:', parsed.data.audio.length);
    }
    if (parsed.data?.event_type) {
      console.log('-> Event type:', parsed.data.event_type);
    }
    if (parsed.type === 'error' || parsed.error) {
      console.log('-> ERROR payload:', JSON.stringify(parsed));
    }
  } catch (err) {
    console.log('WS MESSAGE raw (not JSON):', data.slice(0, 100));
  }
});

ws.on('error', (err) => {
  console.error('WS ERROR:', err);
});

ws.on('close', (code, reason) => {
  console.log('WS CLOSE code:', code, 'reason:', reason ? reason.toString() : 'none');
  process.exit(0);
});

setTimeout(() => {
  console.log('Timeout after 8s');
  ws.close();
  process.exit(1);
}, 8000);
