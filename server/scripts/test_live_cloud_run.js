async function testLive() {
  const linkToken = 'rKhs38CenchZhr_Ueww3ttGzvx2Qq2erZszU6jzdXps';
  const sessionCredential = 'RrH_bH1E8KNcT65_zVLsHfGyhbbKq4kEnKwLFyFETSA';

  console.log('Testing live hosted turn endpoint...');
  const userText = "Hello, I have a sales team and I want to know your pricing.";
  const start = Date.now();
  const res = await fetch(`https://dealforge-507515.web.app/api/public/calls/${linkToken}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionCredential, userText })
  });

  const latency = Date.now() - start;
  console.log('Status:', res.status, `(latency: ${latency}ms)`);
  const data = await res.json();
  console.log('Assistant response:');
  console.log(' ', data.assistantText);
  console.log('Has Sarvam audioBase64:', Boolean(data.audioBase64), 'Length:', data.audioBase64?.length);
  if (data.audioBase64) {
    const riff = Buffer.from(data.audioBase64, 'base64').slice(0, 4).toString('ascii');
    console.log('Audio format:', riff);
  }
}

testLive().catch(console.error);
 