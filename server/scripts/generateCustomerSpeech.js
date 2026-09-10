const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const key = execSync('gcloud secrets versions access latest --secret=dealforge-sarvam-api-key --project=dealforge-507515', { encoding: 'utf8' }).trim();
  
  const text = 'Hello, we have 300 users and we are interested in buying DealForge. Can you tell us about your pricing?';
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': key
    },
    body: JSON.stringify({
      text,
      model: 'bulbul:v3',
      language_code: 'en-IN',
      speaker: 'aditya',
      pace: 1.0,
      output_audio_codec: 'wav'
    })
  });

  const data = await response.json();
  if (!data.audios || data.audios.length === 0) {
    console.error('Sarvam failed:', data);
    process.exit(1);
  }

  const audioBytes = Buffer.from(data.audios[0], 'base64');
  const targetPath = path.join(__dirname, '..', 'customer_speech.wav');
  fs.writeFileSync(targetPath, audioBytes);
  console.log(`✓ Generated customer speech audio: ${targetPath} (${audioBytes.length} bytes)`);
}

main().catch(console.error);
