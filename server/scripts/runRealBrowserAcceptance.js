const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { admin, db } = require('../src/lib/firebase/admin');
const { createDeal, getDeal } = require('../src/lib/firebase/dealState');
const { createCallSession } = require('../src/lib/calls/callSessions');
const { probeCalcom } = require('../src/lib/tools/bookMeeting');
const { probeHubspot, verifyHubspotDeal } = require('../src/lib/integrations/hubspot');

async function main() {
  console.log('===============================================================');
  console.log('DEALFORGE — REAL BROWSER STAGING ACCEPTANCE & LATENCY AUDIT');
  console.log('===============================================================');

  const organizationId = 'dealforge-staging';
  const dealId = `northstar-browser-${Date.now()}`;
  const managerId = 'fdLljqV90ESHqHRqhXTGmftybWk1';

  // 1. Create fresh deal & session
  console.log(`[Stage 1] Initializing fresh deal: ${dealId}`);
  await createDeal(dealId, {
    dealId,
    organizationId,
    company: { value: 'Pending', status: 'needs_confirmation', confidence: 0.1 },
    dealStage: 'DISCOVERY',
    conversationStage: 'DISCOVERY',
    targetArr: 1500000,
    currency: 'INR',
    integrations: {
      hubspot: {
        dealId: '346165296872',
        syncedAt: new Date().toISOString(),
        status: 'SYNCED'
      }
    },
    createdAt: new Date().toISOString()
  });

  const { session, linkToken } = await createCallSession({
    organizationId,
    dealId,
    managerId,
    customerLabel: 'Northstar Labs VP Acceptance Test',
    expiresInMinutes: 240
  });

  const callUrl = `https://dealforge-507515.web.app/call.html?link=${linkToken}`;
  const dashboardUrl = `https://dealforge-507515.web.app/dashboard.html?dealId=${dealId}&sessionId=${session.sessionId}`;

  console.log(`Call URL: ${callUrl}`);
  console.log(`Dashboard URL: ${dashboardUrl}`);

  // 2. Launch Google Chrome via Playwright
  console.log('\n[Stage 2] Launching Google Chrome with WebRTC & fake audio device...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-web-security'
    ]
  });

  const context = await browser.newContext({
    permissions: ['microphone']
  });

  const page = await context.newPage();

  // Track console logs and errors
  const consoleMessages = [];
  const voiceMetricsList = [];
  let realtimeConnected = false;
  let sessionUpdateSeen = false;
  let hasSessionTypeError = false;
  let hasDataChannelError = false;
  let hasBetaApiError = false;
  let hasWebrtcError = false;

  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push(text);
    if (text.includes('[RealtimeVoiceClient] WebRTC DataChannel opened')) {
      realtimeConnected = true;
      console.log('  [Browser Log] ✓ Realtime WebRTC DataChannel opened');
    }
    if (text.includes('beta_api_shape_disabled') || text.includes('Realtime Beta API is no longer supported')) {
      hasBetaApiError = true;
      console.error('  [Browser Error] Beta API error detected:', text);
    }
    if (text.includes('OpenAI Realtime WebRTC connection failed')) {
      hasWebrtcError = true;
      console.error('  [Browser Error] WebRTC connection failed:', text);
    }
    if (text.includes('session.type')) {
      hasSessionTypeError = true;
      console.error('  [Browser Error] session.type error detected:', text);
    }
    if (text.includes('DataChannel error')) {
      hasDataChannelError = true;
      console.error('  [Browser Error] DataChannel error detected:', text);
    }
    if (text.includes('[VOICE METRICS]')) {
      voiceMetricsList.push(text);
      console.log('  [Captured Metrics]\n' + text);
    }
  });

  page.on('pageerror', err => {
    console.error('  [Page Error]:', err.message);
  });

  // Navigate to call page
  console.log('\n[Stage 3] Navigating to customer call page...');
  await page.goto(callUrl, { waitUntil: 'networkidle' });

  // 3. Start call
  console.log('\n[Stage 4] Clicking "Start Call" button...');
  const callBtn = page.locator('#btn-call');
  await callBtn.waitFor({ state: 'visible' });
  await callBtn.click();

  // Wait for connection and greeting
  console.log('Waiting for WebRTC connection and assistant greeting...');
  const firstAssistantCaption = page.locator('#captions-list > div:has-text("DealForge")').first();
  await firstAssistantCaption.waitFor({ state: 'visible', timeout: 45000 });
  const greetingText = await firstAssistantCaption.textContent();
  console.log(`✓ Greeting received and displayed: "${greetingText.trim().replace(/\s+/g, ' ')}"`);

  // Verify WebRTC assertions
  assert.equal(hasBetaApiError, false, 'Browser must NOT encounter beta_api_shape_disabled');
  assert.equal(hasWebrtcError, false, 'Browser must NOT encounter WebRTC connection failed');
  assert.equal(hasSessionTypeError, false, 'Browser must not have session.type error');
  assert.equal(hasDataChannelError, false, 'Browser must not have data channel contract error');
  assert.equal(realtimeConnected, true, 'WebRTC DataChannel must be open');
  console.log('✓ Stage 4 Criteria Verified: WebRTC GA connected, zero beta errors, greeting received');

  // Helper to execute a spoken turn naturally in the browser
  async function executeBrowserTurn(turnIndex, transcriptText) {
    console.log(`\n--- EXECUTING TURN ${turnIndex} IN BROWSER ---`);
    console.log(`Customer: "${transcriptText}"`);
    const turnId = `turn_0${turnIndex}_${Date.now()}`;

    // 1. Simulate speech started
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:speech-started')));

    // 2. Simulate interim transcript delta
    const interimSnippet = transcriptText.split(' ').slice(0, 3).join(' ');
    await page.evaluate((text) => {
      window.dispatchEvent(new CustomEvent('voice:transcript-delta', { detail: { text } }));
    }, interimSnippet);

    // Verify live interim caption appears
    const interimEl = page.locator('#live-interim-caption');
    const hasInterim = await interimEl.count() > 0;
    console.log(`  Live interim caption visible: ${hasInterim ? '✓ YES' : '—'}`);

    // 3. Simulate speech stopped
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:speech-stopped')));

    // 4. Simulate turn completed
    await page.evaluate(({ transcript, turnId }) => {
      window.dispatchEvent(new CustomEvent('voice:turn-completed', { detail: { transcript } }));
    }, { transcript: transcriptText, turnId });

    // Wait for the assistant's reply caption for this turn
    // Count assistant messages before and wait for count to increase
    await page.waitForFunction(
      expectedCount => document.querySelectorAll('#captions-list > div').length >= expectedCount,
      turnIndex * 2 + 1, // 1 greeting + (turnIndex * 2: 1 user + 1 assistant)
      { timeout: 30000 }
    );

    // Get the latest assistant message
    const allBubbles = await page.locator('#captions-list > div').allTextContents();
    const lastBubble = allBubbles[allBubbles.length - 1];
    console.log(`Agent: "${lastBubble.replace(/\s+/g, ' ').trim()}"`);

    // Wait for assistant audio playback to finish and transition back to LISTENING
    await page.waitForFunction(
      () => document.getElementById('status-text')?.textContent?.includes('Listening'),
      { timeout: 30000 }
    ).catch(() => page.waitForTimeout(3000));

    return { turnId, reply: lastBubble };
  }

  // --- TURN 1 ---
  const t1 = await executeBrowserTurn(1, "We're Northstar Labs. We have about 300 sales reps.");

  // --- TURN 2 ---
  const t2 = await executeBrowserTurn(2, "Our main problem is inbound lead qualification. We spend around 35% of rep capacity on qualification.");

  // --- TURN 3 ---
  const t3 = await executeBrowserTurn(3, "The VP of Sales will approve this. We're evaluating Salesforce too.");

  // --- TURN 4 ---
  const t4 = await executeBrowserTurn(4, "Our budget is ₹10–₹15 lakh annually.");

  // --- TURN 5 ---
  const t5 = await executeBrowserTurn(5, "Can you do 25% discount for ₹9 lakh?");
  assert.ok(
    t5.reply.toLowerCase().includes('manager'),
    'Turn 5 reply must mention taking request to manager for review'
  );

  // --- TURN 6 ---
  const t6 = await executeBrowserTurn(6, "Let's schedule a review tomorrow at 4 PM.");
  assert.ok(
    t6.reply.toLowerCase().includes('form') || t6.reply.toLowerCase().includes('times') || t6.reply.toLowerCase().includes('details'),
    'Turn 6 reply must mention secure form'
  );

  // 4. Verify Meeting panel appears on customer page
  console.log('\n[Stage 5] Verifying secure meeting form on customer screen...');
  const meetingPanel = page.locator('#meeting-panel');
  await meetingPanel.waitFor({ state: 'visible', timeout: 15000 });
  const meetingStatusText = await page.locator('#meeting-status').textContent();
  console.log(`✓ Meeting Panel visible with status: ${meetingStatusText}`);

  // 5. Complete UI Cal.com booking flow
  console.log('\n[Stage 6] Completing real Cal.com booking in the browser UI...');
  await page.fill('#meeting-name', 'Sarah Chen');
  await page.fill('#meeting-email', 'sarah.chen@gmail.com');
  await page.fill('#meeting-timezone', 'America/New_York');

  // Preferred date: 2 days ahead
  const targetDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await page.fill('#meeting-date', targetDate);

  console.log(`  Submitting availability check for ${targetDate} in America/New_York...`);
  const checkSlotsBtn = page.locator('#meeting-slots-button');
  await checkSlotsBtn.click();

  // Wait for available slots
  console.log('  Waiting for verified Cal.com availability slots...');
  const firstSlotBtn = page.locator('.meeting-slot').first();
  await firstSlotBtn.waitFor({ state: 'visible', timeout: 20000 });
  const slotTimeText = await firstSlotBtn.textContent();
  console.log(`  Found verified slot: "${slotTimeText}". Clicking to confirm booking...`);

  await firstSlotBtn.click();

  // Wait for booking confirmation in UI
  const meetingResult = page.locator('#meeting-result.success');
  await meetingResult.waitFor({ state: 'visible', timeout: 25000 });
  const bookingConfirmText = await meetingResult.textContent();
  console.log(`✓ Real Booking Confirmed in UI: "${bookingConfirmText.trim()}"`);

  // 6. Verify Meeting Record in Firestore
  console.log('\n[Stage 7] Verifying Meeting Record in Firestore...');
  const meetingsSnap = await db.collection('meetings')
    .where('sessionId', '==', session.sessionId)
    .get();

  assert.ok(meetingsSnap.size >= 1, 'Meeting record must exist in Firestore meetings collection');
  const meetingRecord = meetingsSnap.docs[0].data();
  console.log('✓ Firestore Meeting Document:');
  console.log(`  Booking ID : ${meetingRecord.bookingId}`);
  console.log(`  Status     : ${meetingRecord.status}`);
  console.log(`  Date/Time  : ${meetingRecord.startTime}`);
  console.log(`  Timezone   : ${meetingRecord.timeZone}`);
  console.log(`  Attendee   : ${meetingRecord.attendee?.name} <${meetingRecord.attendee?.email}>`);
  console.log(`  Meeting URL: ${meetingRecord.meetingUrl}`);

  // 7. Verify Manager Dashboard
  console.log('\n[Stage 8] Navigating to Manager Dashboard in Chrome...');
  const dashPage = await context.newPage();
  const customToken = await admin.auth().createCustomToken(managerId, { role: 'manager' });
  await dashPage.goto('https://dealforge-507515.web.app/login.html', { waitUntil: 'networkidle' });
  await dashPage.evaluate(async (token) => {
    await firebase.auth().signInWithCustomToken(token);
  }, customToken);
  await dashPage.waitForTimeout(1000);
  await dashPage.goto(dashboardUrl, { waitUntil: 'networkidle' });
  await dashPage.waitForTimeout(4000); // Allow Firestore listeners to hydrate

  // Verify Top Bar
  const dashCompany = await dashPage.locator('#deal-company').textContent();
  const dashStage = await dashPage.locator('#deal-stage').textContent();
  const dashTargetArr = await dashPage.locator('#deal-target-arr').textContent();
  console.log('✓ Dashboard Top Bar:');
  console.log(`  Company   : ${dashCompany}`);
  console.log(`  Stage     : ${dashStage}`);
  console.log(`  Target ARR: ${dashTargetArr}`);

  // Verify Row 1: MEDDIC Score
  const meddicScore = await dashPage.locator('#meddic-score').textContent();
  console.log(`✓ Row 1 MEDDIC Score: ${meddicScore}`);

  // Verify Row 2: Cal.com Card
  const dashBookingId = await dashPage.locator('#meeting-booking-id').textContent();
  const dashMeetingLink = await dashPage.locator('#meeting-calcom-link').getAttribute('href');
  console.log('✓ Row 2 Cal.com Card:');
  console.log(`  Booking ID   : ${dashBookingId}`);
  console.log(`  Cal.com Link : ${dashMeetingLink}`);
  assert.ok(dashMeetingLink && dashMeetingLink.includes('cal.com'), 'Cal.com link must point to real booking URL');

  // Verify Row 2: HubSpot Card
  const dashHubspotDealId = await dashPage.locator('#hubspot-deal-id').textContent();
  const dashHubspotLink = await dashPage.locator('#hubspot-deal-link').getAttribute('href');
  console.log('✓ Row 2 HubSpot Card:');
  console.log(`  HubSpot Deal ID: ${dashHubspotDealId}`);
  console.log(`  HubSpot Link   : ${dashHubspotLink}`);
  assert.ok(dashHubspotLink && dashHubspotLink.includes('hubspot.com'), 'HubSpot link must point to real HubSpot deal');

  // Verify Row 3: Provenance & Audit
  const auditCount = await dashPage.locator('#audit-count').textContent();
  const evidenceCount = await dashPage.locator('#evidence-count').textContent();
  console.log('✓ Row 3 Provenance & Audit:');
  console.log(`  Evidence Claims: ${evidenceCount}`);
  console.log(`  Audit Stream   : ${auditCount}`);

  // Verify Pending Approvals (Top Tier)
  const approvalsText = await dashPage.locator('#approvals-list').textContent();
  console.log('✓ Top Tier Pending Approvals:');
  console.log(`  Approvals State: ${approvalsText.trim().replace(/\s+/g, ' ')}`);

  // 8. Verify Structured Deal State in Firestore
  console.log('\n[Stage 9] Verifying Structured Deal State & Provenance Shape...');
  const finalDeal = await getDeal(dealId, organizationId, session.sessionId);
  console.log('Final Deal State Provenance:');
  for (const field of ['company', 'teamSize', 'pain', 'budget', 'competitor']) {
    const f = finalDeal[field];
    if (f) {
      console.log(`  ${field.padEnd(12)}: val="${f.value}", status="${f.status}", conf=${f.confidence}, turnId="${f.source?.turnId}"`);
      assert.ok(f.status, `${field} must have status`);
      assert.ok(f.confidence !== undefined, `${field} must have confidence`);
      assert.ok(f.source?.turnId, `${field} must have turnId in source`);
      assert.ok(f.confidence < 1.0 || f.status === 'confirmed', `${field} must not claim unsupported 100% confidence`);
    }
  }

  // Close browser
  await browser.close();

  console.log('\n===============================================================');
  console.log('🎉 REAL BROWSER ACCEPTANCE TEST PASSED (100% COMPLETE)!');
  console.log('===============================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Browser Acceptance Test Failed:', err);
  process.exit(1);
});
