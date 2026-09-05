/**
 * book_meeting
 *
 * Tier 2 (ACT) — Requests a verified follow-up demo/meeting.
 * It intentionally performs no local substitute when scheduling is unavailable.
 */
const { registerTool } = require('./registry');

async function bookMeeting(args, context) {
  void args; void context;

  // There is intentionally no local "booking" substitute. Until Cal.com is
  // configured and an external booking is verified, DealForge must be honest.
  if (!process.env.CALCOM_API_KEY || !process.env.CALCOM_EVENT_TYPE_ID) {
    return {
      booked: false,
      verified: false,
      externalStatus: 'NOT CONFIGURED',
      error: 'Scheduling is not configured. No meeting was booked.',
    };
  }

  // The staged Cal.com adapter is deliberately not enabled until an authenticated
  // availability and booking-verification contract has been exercised.
  return {
    booked: false,
    verified: false,
    externalStatus: 'IMPLEMENTED BUT UNVERIFIED',
    error: 'Scheduling verification is not enabled for this environment. No meeting was booked.',
  };

}

registerTool('book_meeting', bookMeeting, {
  description: 'Request a verified follow-up meeting. It returns an error until a verified server-side scheduling integration is enabled.',
  parameters: {
    type: 'object',
    properties: {
      meeting_type: { type: 'string', description: 'Type of meeting: enterprise_demo, technical_review, executive_briefing' },
      preferred_date: { type: 'string', description: 'Preferred date/time for the meeting' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'List of attendees' },
    },
  },
});

module.exports = bookMeeting;
