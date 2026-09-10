const path = require('path');
const { execSync } = require('child_process');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '..', '.env') });
const assert = require('assert/strict');

// If CALCOM_API_KEY or CALCOM_EVENT_TYPE_ID not in process.env, load from Google Secret Manager
if (!process.env.CALCOM_API_KEY) {
  try {
    process.env.CALCOM_API_KEY = execSync('gcloud secrets versions access latest --secret=dealforge-calcom-api-key').toString().trim();
  } catch (err) {
    console.error('Failed to load secret dealforge-calcom-api-key:', err.message);
  }
}
if (!process.env.CALCOM_EVENT_TYPE_ID) {
  try {
    process.env.CALCOM_EVENT_TYPE_ID = execSync('gcloud secrets versions access latest --secret=dealforge-calcom-event-type-id').toString().trim();
  } catch (err) {
    console.error('Failed to load secret dealforge-calcom-event-type-id:', err.message);
  }
}

const bookMeeting = require('../src/lib/tools/bookMeeting');
const { probeCalcom, configuredEventType, getAvailableSlots, calcomRequest, CALCOM_BOOKINGS_CREATE_API_VERSION } = bookMeeting;

async function main() {
  console.log('====================================================');
  console.log('STARTING REAL CAL.COM BOOKING GATE TEST');
  console.log('Event Type ID:', process.env.CALCOM_EVENT_TYPE_ID);
  console.log('====================================================');

  // 1. Probe Cal.com
  console.log('\n--- 1. Probing Cal.com API ---');
  const probe = await probeCalcom();
  console.log('Cal.com probe result:', probe);
  assert.equal(probe.status, 'AVAILABLE', 'Cal.com probe status must be AVAILABLE');
  assert.equal(probe.verified, true, 'Cal.com probe must report verified=true');

  // 2. Fetch configured Event Type
  console.log('\n--- 2. Verifying Configured Event Type ---');
  const eventType = await configuredEventType();
  console.log('Configured Event Type:', {
    id: eventType.id,
    title: eventType.title,
    slug: eventType.slug,
    length: eventType.length,
    active: eventType.active,
  });
  assert.equal(String(eventType.id), String(process.env.CALCOM_EVENT_TYPE_ID));

  // 3. Find an available slot over the next 14 days
  console.log('\n--- 3. Scanning for an available slot ---');
  const timeZone = 'America/New_York';
  let targetSlot = null;

  for (let offset = 2; offset <= 14; offset++) {
    const d = new Date(Date.now() + offset * 86400000);
    const dayStr = d.toISOString().slice(0, 10);
    try {
      const slots = await getAvailableSlots({ preferredDate: dayStr, timeZone });
      if (slots && slots.length > 0) {
        targetSlot = slots[0];
        console.log(`Found available slot on ${dayStr}:`, targetSlot);
        break;
      }
    } catch (err) {
      // Continue searching next days
    }
  }

  assert.ok(targetSlot && targetSlot.start, 'Must find at least one open slot in the next 14 days');

  // 4. Create real booking
  console.log('\n--- 4. Executing Real Booking with Verification ---');
  const testSessionId = `calcom-gate-${Date.now()}`;
  const bookingArgs = {
    meeting_type: 'enterprise_demo',
    preferred_date: targetSlot.start,
    attendee: {
      name: 'DealForge QA Test',
      email: 'dealforge.staging.qa@gmail.com',
      timeZone: 'America/New_York'
    }
  };

  const bookingResult = await bookMeeting(bookingArgs, {
    organizationId: 'dealforge-staging',
    dealId: 'staging-negotiation-001',
    sessionId: testSessionId,
  });

  console.log('Real Booking Result:');
  console.log(JSON.stringify(bookingResult, null, 2));

  assert.equal(bookingResult.booked, true, 'Meeting must be booked');
  assert.equal(bookingResult.verified, true, 'Meeting booking must be verified');
  assert.equal(bookingResult.externalStatus, 'BOOKED');
  assert.ok(bookingResult.bookingId, 'Must return a valid booking / event ID');

  console.log('\n====================================================');
  console.log(`🎉 CAL.COM REAL BOOKING VERIFIED! Event ID: ${bookingResult.bookingId}`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('❌ Cal.com test failed:', err);
  process.exit(1);
});
