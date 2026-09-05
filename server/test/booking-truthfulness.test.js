const test = require('node:test');
const assert = require('node:assert/strict');

test('meeting tool never claims an unconfigured external booking succeeded', async () => {
  const originalKey = process.env.CALCOM_API_KEY; const originalEvent = process.env.CALCOM_EVENT_TYPE_ID;
  delete process.env.CALCOM_API_KEY; delete process.env.CALCOM_EVENT_TYPE_ID;
  const bookMeeting = require('../src/lib/tools/bookMeeting');
  const result = await bookMeeting({ meeting_type: 'enterprise_demo', preferred_date: '2026-10-01T10:00:00.000Z', attendees: ['buyer@example.com'] }, { organizationId: 'org', dealId: 'deal', sessionId: 'session', turnNumber: 1 });
  assert.equal(result.booked, false); assert.equal(result.verified, false); assert.match(result.error, /No meeting was booked/);
  if (originalKey) process.env.CALCOM_API_KEY = originalKey; if (originalEvent) process.env.CALCOM_EVENT_TYPE_ID = originalEvent;
});
