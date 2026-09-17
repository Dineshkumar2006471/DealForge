require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const WebSocket = require('ws');

const apiKey = process.env.SARVAM_API_KEY;
console.log('SARVAM_API_KEY present:', Boolean(apiKey));

const codecs = ['linear16', 'pcm', 'wav', 'mp3'];

async function testCodec(codec) {
  return new Promise((resolve) => {
    console.log(`\n--- Testing codec: ${codec} ---`);
    const ws = new WebSocket('wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true', {
      headers: { 'Api-Subscription-Key': apiKey }
    });

    let receivedAudio = false;
    let chunks = 0;
    let totalBytes = 0;
    let contentType = null;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'config',
        data: {
          model: 'bulbul:v3',
          language_code: 'en-IN',
          speaker: 'ishita',
          pace: 1.05,
          speech_sample_rate: '24000',
          output_audio_codec: codec,
        }
      }));
      ws.send(JSON.stringify({
        type: 'text',
        data: { text: 'Hello, this is a test.' }
      }));
      ws.send(JSON.stringify({ type: 'flush' }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'audio' && msg.data?.audio) {
          chunks++;
          contentType = msg.data.content_type;
          const buf = Buffer.from(msg.data.audio, 'base64');
          totalBytes += buf.length;
          receivedAudio = true;
        } else if (msg.type === 'event' && msg.data?.event_type === 'final') {
          console.log(`[${codec}] Final event received! Chunks: ${chunks}, Bytes: ${totalBytes}, ContentType: ${contentType}`);
          ws.close();
          resolve({ codec, success: true, chunks, bytes: totalBytes, contentType });
        } else if (msg.type === 'error') {
          console.log(`[${codec}] Error msg:`, msg);
          ws.close();
          resolve({ codec, success: false, error: msg });
        }
      } catch (err) {
        console.log(`[${codec}] Parse error:`, err.message);
      }
    });

    ws.on('error', (err) => {
      console.log(`[${codec}] WebSocket error:`, err.message);
      resolve({ codec, success: false, error: err.message });
    });

    setTimeout(() => {
      if (!receivedAudio) {
        console.log(`[${codec}] Timed out after 5s without audio`);
        try { ws.close(); } catch(e){}
        resolve({ codec, success: false, error: 'timeout' });
      }
    }, 5000);
  });
}

async function main() {
  for (const c of codecs) {
    await testCodec(c);
  }
}

main().catch(console.error);
