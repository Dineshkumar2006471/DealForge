const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require(path.join(__dirname, '..', 'src', 'lib', 'firebase', 'admin'));

async function main() {
  const linkToken = process.argv[2] || 'TB459NBGJgsGamWDEqm9lktSMRzPn0fycMFJP2FIZdU';
  const sessionId = process.argv[3] || 'ca13ec88-d4ed-45eb-be91-6c3bb2d0cc3b';
  const dealId = 'staging-negotiation-001';
  const wavPath = path.join(__dirname, '..', 'customer_speech.wav');

  console.log('====================================================');
  console.log('STARTING REAL BROWSER CUSTOMER VOICE CALL GATE TEST');
  console.log('Session ID:', sessionId);
  console.log('Link Token:', linkToken);
  console.log('Audio Source:', wavPath);
  console.log('Target URL: https://dealforge-507515.web.app/call.html?link=' + linkToken);
  console.log('====================================================');

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`,
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const context = await browser.newContext({
    permissions: ['microphone']
  });

  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Agora') || text.includes('agent') || text.includes('audio') || text.includes('call') || text.includes('✅') || text.includes('🎤') || text.includes('error')) {
      console.log(`[Browser Console] ${msg.type()}: ${text}`);
    }
  });

  page.on('pageerror', err => {
    console.error(`[Browser PageError]`, err);
  });

  // Track custom Agora events dispatched on window
  await page.addInitScript(() => {
    window.__agoraEvents = [];
    ['agora:agent-audio-playing', 'agora:agent-speaking', 'agora:agent-audio-failed', 'agora:agent-stopped-speaking'].forEach(evtName => {
      window.addEventListener(evtName, e => {
        window.__agoraEvents.push({ event: evtName, detail: e.detail, time: Date.now() });
        console.log(`[DOM Event] ${evtName}:`, JSON.stringify(e.detail || {}));
      });
    });
  });

  console.log('Navigating to customer call page...');
  await page.goto(`https://dealforge-507515.web.app/call.html?link=${linkToken}`, { waitUntil: 'networkidle' });

  const initialStatus = await page.textContent('#status-text');
  console.log('Initial Status:', initialStatus);

  console.log('Clicking "Start AI Sales Call" button...');
  await page.click('#btn-call');

  // Wait for status transition
  console.log('Waiting for connection and Agora agent startup...');
  let connected = false;
  const startWait = Date.now();
  
  while (Date.now() - startWait < 45000) {
    const statusText = await page.textContent('#status-text').catch(() => '');
    const errorMsg = await page.textContent('#call-error').catch(() => '');
    if (errorMsg) {
      console.error('Browser call error element:', errorMsg);
    }
    
    if (statusText.toLowerCase().includes('connected') || statusText.toLowerCase().includes('speaking') || statusText.toLowerCase().includes('listening')) {
      connected = true;
      console.log('✓ Connection detected! Status:', statusText);
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!connected) {
    const finalStatus = await page.textContent('#status-text');
    const finalErr = await page.textContent('#call-error');
    console.error(`❌ Connection timeout. Status: "${finalStatus}", Error: "${finalErr}"`);
    await browser.close();
    process.exit(1);
  }

  // Now wait for agent audio publication and live captions
  console.log('Waiting for agent audio track publication & live captions (up to 30s)...');
  let audioPlayed = false;
  let captionsFound = [];
  const startAudioWait = Date.now();

  while (Date.now() - startAudioWait < 35000) {
    // Check DOM events
    const events = await page.evaluate(() => window.__agoraEvents || []);
    if (events.some(e => e.event === 'agora:agent-audio-playing')) {
      if (!audioPlayed) {
        audioPlayed = true;
        console.log('✓ SUCCESS: agora:agent-audio-playing event received by browser!');
      }
    }

    // Check live captions list
    const captionTexts = await page.evaluate(() => {
      const items = document.querySelectorAll('#captions-list > div');
      return Array.from(items).map(i => i.innerText.trim());
    });

    if (captionTexts.length > captionsFound.length) {
      captionsFound = captionTexts;
      console.log('✓ New caption rendered on screen:');
      console.log(captionTexts[captionTexts.length - 1]);
    }

    if (audioPlayed && captionsFound.length >= 1) {
      // Let customer audio play and wait a little for the conversation turn
      await page.waitForTimeout(10000);
      break;
    }

    await page.waitForTimeout(1500);
  }

  // Get final state from Firestore
  console.log('\n--- VERIFYING FIRESTORE PERSISTENCE ---');
  const sessionDoc = await db.collection('callSessions').doc(sessionId).get();
  const sessionData = sessionDoc.data() || {};
  console.log('Session Status:', sessionData.status);
  console.log('Session Agent ID:', sessionData.agentId);

  const messagesSnap = await db.collection('callSessions').doc(sessionId).collection('messages').orderBy('timestamp', 'asc').get();
  console.log(`Persisted Transcript Messages Count: ${messagesSnap.size}`);
  messagesSnap.forEach(m => {
    const d = m.data();
    console.log(`  [${d.role}]: ${d.content || JSON.stringify(d.tool_calls || '')}`);
  });

  const dealDoc = await db.collection('deals').doc(dealId).get();
  const dealData = dealDoc.data() || {};
  console.log('Deal State:', dealData.company, 'Stage:', dealData.stage || dealData.status);
  console.log('MEDDIC Fields:', JSON.stringify(dealData.meddic || {}, null, 2));

  // Cleanly stop the call
  console.log('Leaving call...');
  await page.evaluate(async () => {
    if (typeof leaveCall === 'function') await leaveCall();
  }).catch(() => {});
  await browser.close();

  const success = audioPlayed && (messagesSnap.size >= 1 || captionsFound.length >= 1);
  if (success) {
    console.log('\n====================================================');
    console.log('🎉 REAL VOICE CALL GATE PASSED COMPLETELY!');
    console.log('====================================================');
    process.exit(0);
  } else {
    console.error('\n❌ Gate failed: audioPlayed=' + audioPlayed + ', captions=' + captionsFound.length);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal gate execution error:', err);
  process.exit(1);
});
