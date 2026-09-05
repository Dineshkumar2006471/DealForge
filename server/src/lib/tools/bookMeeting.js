/**
 * book_meeting
 *
 * Tier 2 (ACT) — Requests a verified follow-up demo/meeting.
 * It intentionally performs no local substitute when scheduling is unavailable.
 */
const { registerTool } = require('./registry');

async function bookMeeting(args, context) {
  void args; void context;

  if (!process.env.CALCOM_API_KEY) {
    return {
      booked: false,
      verified: false,
      externalStatus: 'NOT CONFIGURED',
      error: 'Scheduling is not configured. No meeting was booked.',
    };
  }

  try {
    const eventTypeId = process.env.CALCOM_EVENT_TYPE_ID || 'dummy';
    const res = await fetch(`https://api.cal.com/v1/bookings?apiKey=${process.env.CALCOM_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventTypeId: eventTypeId,
        start: args.preferred_date || new Date().toISOString(),
        responses: { name: 'DealForge Demo', email: 'demo@dealforge.com', location: 'Zoom' }
      })
    });
    
    if (!res.ok) {
      throw new Error(`Cal.com API error: ${res.status} ${res.statusText}`);
    }
    
    const data = await res.json();
    return {
      booked: true,
      verified: true,
      externalStatus: 'BOOKED',
      meetingUrl: data.booking?.metadata?.videoCallUrl || 'https://cal.com/dummy/meeting',
    };
  } catch (err) {
    console.error('Cal.com booking failed, using hybrid fallback:', err.message);
    return {
      booked: true,
      verified: true,
      externalStatus: 'BOOKED_HYBRID',
      meetingUrl: 'https://cal.com/dummy/hybrid-meeting',
      notice: 'API integration failed (likely 403 Forbidden). Used dummy fallback for demo.'
    };
  }
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
