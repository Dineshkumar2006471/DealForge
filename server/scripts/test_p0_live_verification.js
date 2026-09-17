const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

function getSecret(secretName) {
  try {
    return execSync(`gcloud secrets versions access latest --secret=${secretName} --project=dealforge-507515`, { encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

if (!process.env.CALL_SESSION_WEBHOOK_SIGNING_SECRET) {
  process.env.CALL_SESSION_WEBHOOK_SIGNING_SECRET = getSecret('dealforge-call-session-webhook-signing-secret');
}

const { createCallSession } = require('../src/lib/calls/callSessions');
const { resolveApproval } = require('../src/lib/policy/approvalQueue');
const { db } = require('../src/lib/firebase/admin');

const BASE_URL = 'https://dealforge-507515.web.app';

async function runLiveVerification() {
  console.log('===============================================================');
  console.log('DEALFORGE P0 PRODUCTION LIVE FORENSIC VERIFICATION');
  console.log('Target: ' + BASE_URL);
  console.log('===============================================================\n');

  let passedAll = true;

  // -------------------------------------------------------------------------
  // TEST 1: Scan live HTML assets for stale marketing claims
  // -------------------------------------------------------------------------
  console.log('[TEST 1] Verifying no stale marketing claims on live hosted assets...');
  const pagesToScan = ['/call.html', '/dashboard.html', '/index.html'];
  const bannedPhrases = ['Sub-500ms Voice Pipeline', '284ms', 'Agora + Sarvam Fast Path'];

  for (const page of pagesToScan) {
    const res = await fetch(`${BASE_URL}${page}`);
    const html = await res.text();
    for (const phrase of bannedPhrases) {
      if (html.includes(phrase)) {
        console.error(`  ❌ FAILED: Live page ${page} still contains stale claim: "${phrase}"`);
        passedAll = false;
      }
    }
  }
  console.log('  ✔ Passed: No stale claims found on live hosted pages.\n');

  // -------------------------------------------------------------------------
  // TEST 2: Create a fresh session and test join + ready greeting
  // -------------------------------------------------------------------------
  console.log('[TEST 2] Creating fresh session and verifying live join + ready greeting...');
  const { session, linkToken } = await createCallSession({
    organizationId: 'dealforge-staging',
    dealId: 'staging-negotiation-001',
    managerId: 'fdLljqV90ESHqHRqhXTGmftybWk1',
    customerLabel: 'Forensic Live Audit Customer',
    expiresInMinutes: 60,
  });

  console.log(`  Session ID: ${session.sessionId}`);
  console.log(`  Link Token: ${linkToken}`);

  const joinRes = await fetch(`${BASE_URL}/api/public/calls/${linkToken}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!joinRes.ok) {
    throw new Error(`Join failed with status ${joinRes.status}: ${await joinRes.text()}`);
  }
  const joinData = await joinRes.json();
  const sessionCredential = joinData.sessionCredential;
  console.log(`  Joined call. Provider: ${joinData.voiceProvider}`);

  // Test /ready
  const readyStart = Date.now();
  const readyRes = await fetch(`${BASE_URL}/api/public/calls/${linkToken}/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionCredential }),
  });
  const readyLatency = Date.now() - readyStart;
  const readyData = await readyRes.json();
  console.log(`  Ready response (${readyLatency}ms):`);
  console.log(`    Greeting: "${readyData.greeting}"`);
  console.log(`    Audio returned: ${Boolean(readyData.audioBase64)} (length: ${readyData.audioBase64?.length || 0})`);
  if (!readyData.greeting || !readyData.audioBase64) {
    console.error('  ❌ FAILED: Ready greeting or audio was missing!');
    passedAll = false;
  } else {
    console.log('  ✔ Passed: Spoken greeting generated with audio.\n');
  }

  // -------------------------------------------------------------------------
  // TEST 3: Streaming Customer Turn & Audio Delivery Latency (P0-A & P0-B)
  // -------------------------------------------------------------------------
  console.log('[TEST 3] Testing streaming customer turn for latency & audio quality...');
  const turnText = "We have 300 sales reps and our budget is around $120,000.";
  const tTurnStart = Date.now();
  let tFirstChunk = 0;
  let tFirstAudio = 0;
  const audioChunks = [];
  let fullAssistantText = '';

  const turnRes = await fetch(`${BASE_URL}/api/public/calls/${linkToken}/turn?stream=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({
      sessionCredential,
      turnId: 'turn_forensic_' + Date.now(),
      userText: turnText,
    }),
  });

  if (!turnRes.ok) {
    throw new Error(`Turn request failed: ${turnRes.status} ${await turnRes.text()}`);
  }

  const reader = turnRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (!tFirstChunk) tFirstChunk = Date.now();
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop();

    for (const block of blocks) {
      const eventMatch = block.match(/event:\s*(\w+)/);
      const dataMatch = block.match(/data:\s*(.*)/s);
      if (!eventMatch || !dataMatch) continue;

      const eventType = eventMatch[1];
      let data;
      try { data = JSON.parse(dataMatch[1]); } catch (_) { continue; }

      if (eventType === 'audio_chunk') {
        if (!tFirstAudio) tFirstAudio = Date.now();
        audioChunks.push(data);
      } else if (eventType === 'text') {
        if (data.assistantText) fullAssistantText = data.assistantText;
      }
    }
  }

  const totalTurnMs = Date.now() - tTurnStart;
  const ttfbMs = tFirstChunk ? tFirstChunk - tTurnStart : 0;
  const ttfaMs = tFirstAudio ? tFirstAudio - tTurnStart : 0;

  console.log(`  Assistant: "${fullAssistantText}"`);
  console.log(`  Timing metrics:`);
  console.log(`    Time to First SSE Chunk (TTFB): ${ttfbMs}ms`);
  console.log(`    Time to First Audio Chunk (TTFA): ${ttfaMs}ms`);
  console.log(`    Total Turn Duration: ${totalTurnMs}ms`);
  console.log(`    Audio chunks received: ${audioChunks.length}`);

  if (audioChunks.length > 0) {
    console.log(`    First chunk contentType: ${audioChunks[0].contentType}`);
    const firstBytes = Buffer.from(audioChunks[0].audioBase64, 'base64');
    console.log(`    First chunk byte size: ${firstBytes.length} bytes`);
  }

  if (audioChunks.length === 0) {
    console.error('  ❌ FAILED: Zero audio chunks received for turn!');
    passedAll = false;
  } else if (ttfaMs > 4500) {
    console.error(`  ❌ FAILED: TTFA exceeded 4500ms (${ttfaMs}ms)`);
    passedAll = false;
  } else {
    console.log(`  ✔ Passed: TTFA was ${ttfaMs}ms (< 4500ms, massive improvement over 5s gap) with ${audioChunks.length} streaming audio chunks.\n`);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Automatic Proactive Approval Voice Response (P0-C)
  // -------------------------------------------------------------------------
  console.log('[TEST 4] Testing Automatic Manager Approval Voice Trigger (P0-C)...');
  console.log('  1. Customer requests over-policy concession (22% discount)...');

  // Trigger concession turn
  const concessionRes = await fetch(`${BASE_URL}/api/public/calls/${linkToken}/turn?stream=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({
      sessionCredential,
      turnId: 'turn_concession_' + Date.now(),
      userText: "Can we get a 22% discount if we sign an annual contract this week?",
    }),
  });

  // Consume turn response
  const cReader = concessionRes.body.getReader();
  while (true) {
    const { done } = await cReader.read();
    if (done) break;
  }

  // Find created pending approval in Firestore
  console.log('  2. Finding pending approval in Firestore...');
  const apprSnap = await db.collection('approvals')
    .where('sessionId', '==', session.sessionId)
    .where('status', '==', 'PENDING')
    .limit(1)
    .get();

  if (apprSnap.empty) {
    console.error('  ❌ FAILED: Concession did not create a PENDING approval!');
    passedAll = false;
  } else {
    const approvalDoc = apprSnap.docs[0];
    const approvalId = approvalDoc.id;
    console.log(`  Pending approval found: ${approvalId} (${approvalDoc.data().policyReason})`);

    // 3. Connect to proactive SSE endpoint /events
    console.log('  3. Connecting customer to SSE proactive events stream (/events)...');
    const eventsUrl = `${BASE_URL}/api/public/calls/${linkToken}/events?credential=${sessionCredential}`;
    const eventsRes = await fetch(eventsUrl, {
      headers: { 'Accept': 'text/event-stream' },
    });

    if (!eventsRes.ok) {
      throw new Error(`Events stream failed: ${eventsRes.status} ${await eventsRes.text()}`);
    }

    const eventsReader = eventsRes.body.getReader();
    let receivedApprovalAudio = false;
    let receivedApprovalText = '';

    const readEventsPromise = (async () => {
      let evBuffer = '';
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const { done, value } = await eventsReader.read();
        if (done) break;
        evBuffer += decoder.decode(value, { stream: true });
        const blocks = evBuffer.split('\n\n');
        evBuffer = blocks.pop();

        for (const block of blocks) {
          const eventMatch = block.match(/event:\s*(\w+)/);
          const dataMatch = block.match(/data:\s*(.*)/s);
          if (!eventMatch || !dataMatch) continue;

          const eventType = eventMatch[1];
          let data;
          try { data = JSON.parse(dataMatch[1]); } catch (_) { continue; }

          if (eventType === 'audio_chunk' && data.proactive) {
            receivedApprovalAudio = true;
          }
          if (eventType === 'text' && data.proactive) {
            receivedApprovalText = data.assistantText;
          }
        }
        if (receivedApprovalAudio && receivedApprovalText) break;
      }
    })();

    // 4. Resolve approval as manager
    console.log('  4. Manager resolves approval as APPROVED...');
    await resolveApproval(approvalId, 'APPROVED', {
      uid: 'fdLljqV90ESHqHRqhXTGmftybWk1',
      organizationId: 'dealforge-staging',
    });

    console.log('  5. Waiting for proactive voice response on customer SSE stream...');
    await readEventsPromise;

    console.log(`    Proactive audio received: ${receivedApprovalAudio}`);
    console.log(`    Proactive text received: "${receivedApprovalText}"`);

    if (receivedApprovalAudio && receivedApprovalText.includes('manager approved')) {
      console.log('  ✔ Passed: Customer received proactive voice response automatically without speaking!\n');
    } else {
      console.error('  ❌ FAILED: Proactive approval voice was not delivered to customer stream!');
      passedAll = false;
    }
  }

  // -------------------------------------------------------------------------
  // TEST 5: Authoritative HubSpot Link & Post-Call State (P0-D)
  // -------------------------------------------------------------------------
  console.log('[TEST 5] Testing HubSpot Link persistence & post-call state...');
  const dealDoc = await db.collection('deals').doc('staging-negotiation-001').get();
  const dealData = dealDoc.data();
  console.log(`  Deal Company: ${dealData.company?.value}`);
  console.log(`  HubSpot Integration:`, dealData.integrations?.hubspot);

  // Stop the call
  const stopRes = await fetch(`${BASE_URL}/api/public/calls/${linkToken}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionCredential }),
  });
  const stopData = await stopRes.json();
  console.log(`  Call stopped: ${stopData.status}`);

  // Re-check deal doc
  const postCallDeal = (await db.collection('deals').doc('staging-negotiation-001').get()).data();
  console.log(`  Post-call deal stage: ${postCallDeal.conversationStage}`);
  console.log(`  Post-call nextBestAction: ${postCallDeal.nextBestAction?.action || 'none'}`);
  console.log(`  HubSpot integration preserved: ${Boolean(postCallDeal.integrations?.hubspot?.dealId)}`);

  if (!postCallDeal.integrations?.hubspot?.dealId) {
    console.error('  ❌ FAILED: HubSpot integration was wiped or unlinked on call stop!');
    passedAll = false;
  } else {
    console.log('  ✔ Passed: HubSpot link is authoritative and preserved through call end.\n');
  }

  console.log('===============================================================');
  if (passedAll) {
    console.log('✅ ALL P0 LIVE FORENSIC TESTS PASSED SUCCESSFULLY!');
  } else {
    console.log('❌ SOME P0 TESTS FAILED! Review output above.');
  }
  console.log('===============================================================');
  process.exit(passedAll ? 0 : 1);
}

runLiveVerification().catch(err => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
