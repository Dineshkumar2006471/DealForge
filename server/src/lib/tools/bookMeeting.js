/**
 * book_meeting
 *
 * Tier 2 (ACT) — Books a follow-up demo/meeting.
 * Idempotent: uses idempotency key to prevent double-booking.
 */
const { registerTool } = require('./registry');
const { db } = require('../firebase/admin');
const { updateNextBestAction } = require('../firebase/dealState');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');
const { v4: uuidv4 } = require('uuid');

async function bookMeeting(args, context) {
  const { meeting_type, preferred_date, attendees } = args;
  const { dealId, sessionId, turnNumber, organizationId } = context;

  // Generate idempotency key
  const idempotencyKey = `${dealId}:${meeting_type}:${turnNumber}`;

  const meetingId = uuidv4();
  const meeting = {
    meetingId,
    organizationId, dealId, sessionId,
    type: meeting_type || 'enterprise_demo',
    preferredDate: preferred_date || 'Next week',
    attendees: attendees || [],
    status: 'BOOKED',
    bookedAt: new Date().toISOString(),
    bookedByTurn: turnNumber,
  };

  const idempotencyRef = db.collection('operations').doc(`meeting-${Buffer.from(idempotencyKey).toString('base64url')}`);
  let duplicate = false;
  await db.runTransaction(async tx => {
    const existing = await tx.get(idempotencyRef);
    if (existing.exists) { duplicate = true; return; }
    const dealRef = db.collection('deals').doc(dealId); const deal = await tx.get(dealRef);
    if (!deal.exists || deal.data().organizationId !== organizationId) throw new Error('Bound deal not found');
    tx.create(idempotencyRef, { organizationId, dealId, sessionId, operationId: idempotencyKey, status: 'SUCCEEDED', result: meeting, createdAt: new Date().toISOString() });
    tx.create(db.collection('meetings').doc(meetingId), meeting);
    tx.update(dealRef, { nextBestAction: { action: 'MEETING_BOOKED', reason: `${meeting_type} scheduled`, timestamp: new Date().toISOString() }, updatedAt: new Date().toISOString() });
  });
  if (duplicate) return { booked: true, duplicate: true, message: 'This meeting was already booked.' };
  await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.BOOKING_CREATED, trigger: `book_meeting(${meeting_type})`, actionResult: { tool: 'book_meeting', input: args, output: meeting, verified: true } });

  return {
    booked: true,
    meetingId,
    type: meeting.type,
    preferredDate: meeting.preferredDate,
    message: `${meeting.type} meeting booked successfully.`,
  };
}

registerTool('book_meeting', bookMeeting, {
  description: 'Book a follow-up meeting or demo. Idempotent — will not double-book.',
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
