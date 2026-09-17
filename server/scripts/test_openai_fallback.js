require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function testOpenAiPcm() {
  const apiKey = process.env.OPENAI_API_KEY;
  const cleanText = "Hello, thanks for joining. How large is your team?";
  const tStart = Date.now();
  let tFirstByte = 0;
  let chunkCount = 0;
  let totalBytes = 0;

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: cleanText,
      voice: 'alloy',
      response_format: 'pcm',
      speed: 1.05,
    }),
  });

  console.log('Response status:', res.status);
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!tFirstByte) {
      tFirstByte = Date.now();
      console.log('TTFB:', tFirstByte - tStart, 'ms, first chunk bytes:', value.length);
    }
    chunkCount++;
    totalBytes += value.length;
  }

  console.log('Finished in:', Date.now() - tStart, 'ms, total chunks:', chunkCount, 'bytes:', totalBytes);
}

testOpenAiPcm().catch(console.error);
