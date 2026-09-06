const { db } = require('../firebase/admin');
const { HttpError } = require('../security/auth');
const { getAvailableSlots } = require('../tools/bookMeeting');
const bookMeeting = require('../tools/bookMeeting');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');
const { syncBookingToHubspot } = require('../integrations/hubspot');

const requestRef = (sessionId, requestId) => db.collection('callSessions').doc(sessionId).collection('meetingRequests').doc(requestId);
const requestIdFor = meetingType => `meeting-${meetingType}`;
const now = () => new Date().toISOString();

async function requestMeetingDetails({ organizationId, dealId, sessionId, meetingType }) {
  const requestId = requestIdFor(meetingType);
  const ref = requestRef(sessionId, requestId);
  let created = false;
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      tx.create(ref, { requestId, organizationId, dealId, sessionId, meetingType, status: 'DETAILS_REQUIRED', createdAt: now(), updatedAt: now() });
      created = true;
    }
  });
  if (created) await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.MEETING_DETAILS_REQUESTED, trigger: 'Agent requested secure meeting details form', actionResult: { meetingType, verified: true } });
  return { verified: true, requestId, status: created ? 'DETAILS_REQUIRED' : 'ALREADY_REQUESTED', message: 'The secure meeting form is ready for the customer.' };
}

async function requireRequest(session, requestId, statuses) {
  const doc = await requestRef(session.sessionId, requestId).get();
  if (!doc.exists) throw new HttpError(404, 'Meeting request not found');
  const request = doc.data();
  if (request.organizationId !== session.organizationId || request.dealId !== session.dealId || request.sessionId !== session.sessionId) throw new HttpError(404, 'Meeting request not found');
  if (!statuses.includes(request.status)) throw new HttpError(409, `Meeting request is ${String(request.status || 'unavailable').toLowerCase()}`);
  return { ref: doc.ref, request };
}

async function findMeetingSlots(session, requestId, { attendee, preferredDate }) {
  const { ref, request } = await requireRequest(session, requestId, ['DETAILS_REQUIRED', 'SLOTS_READY']);
  const slots = await getAvailableSlots({ preferredDate, timeZone: attendee.timeZone });
  if (!slots.length) throw new HttpError(409, 'No available slots were found for that date');
  await ref.update({ attendee, preferredDate, availableSlots: slots, status: 'SLOTS_READY', updatedAt: now() });
  await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.MEETING_SLOTS_READY, trigger: 'Cal.com availability verified for meeting request', actionResult: { requestId, slotCount: slots.length, verified: true } });
  return { requestId, meetingType: request.meetingType, slots };
}

async function confirmMeeting(session, requestId, slotStart) {
  const { ref, request } = await requireRequest(session, requestId, ['SLOTS_READY']);
  if (!request.attendee || !Array.isArray(request.availableSlots)) throw new HttpError(409, 'Meeting details must be submitted before booking');
  const selected = request.availableSlots.find(slot => slot?.start === slotStart);
  if (!selected) throw new HttpError(400, 'Choose one of the verified available slots');
  await ref.update({ status: 'BOOKING', selectedSlot: slotStart, updatedAt: now() });
  const result = await bookMeeting({ meeting_type: request.meetingType, preferred_date: slotStart, attendee: request.attendee }, { organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, turnNumber: 0 });
  if (!result.booked || !result.verified) {
    await ref.set({ status: 'BOOKING_FAILED', result, updatedAt: now() }, { merge: true });
    return { booked: false, verified: false, result };
  }
  const meetingId = `calcom-${result.bookingId}`;
  await db.collection('meetings').doc(meetingId).set({ meetingId, organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, requestId, provider: 'calcom', bookingId: result.bookingId, start: slotStart, meetingType: request.meetingType, attendee: request.attendee, meetingUrl: result.meetingUrl || null, status: 'BOOKED', verified: true, createdAt: now() }, { merge: true });
  const crm = await syncBookingToHubspot({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, booking: { bookingId: result.bookingId, start: slotStart, meetingUrl: result.meetingUrl || null } });
  await ref.set({ status: 'BOOKED', result: { ...result, crm }, updatedAt: now() }, { merge: true });
  return { booked: true, verified: true, result: { ...result, crm } };
}

module.exports = { requestMeetingDetails, findMeetingSlots, confirmMeeting, requestIdFor };
