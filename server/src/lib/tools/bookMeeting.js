/**
 * book_meeting
 *
 * Tier 2 (ACT) — Requests a verified follow-up demo/meeting.
 * It intentionally performs no local substitute when scheduling is unavailable.
 */
const crypto = require('crypto');
const { registerTool } = require('./registry');
const { db } = require('../firebase/admin');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

const CALCOM_API = 'https://api.cal.com/v2';

function calcomConfig() {
  const { CALCOM_API_KEY: apiKey, CALCOM_EVENT_TYPE_ID: eventTypeId, CALCOM_API_VERSION: apiVersion } = process.env;
  if (!apiKey || !eventTypeId || !apiVersion) return null;
  if (!/^\d+$/.test(String(eventTypeId))) return null;
  return { apiKey, eventTypeId: Number(eventTypeId), apiVersion };
}

async function calcomRequest(path, { method = 'GET', body } = {}) {
  const config = calcomConfig();
  if (!config) throw new Error('Cal.com is not configured');
  const response = await fetch(`${CALCOM_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'cal-api-version': config.apiVersion },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Cal.com ${method} ${path} failed (${response.status}): ${String(payload.message || payload.error || 'provider error').slice(0, 180)}`);
  return payload;
}

function operationIdFor(args, context) {
  return crypto.createHash('sha256').update(`${context.sessionId}:${context.dealId}:calcom:${args.preferred_date}:${args.attendee.email}:${args.meeting_type}`).digest('hex');
}

function dayRange(iso) {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) throw new Error('Preferred meeting time is invalid');
  const day = start.toISOString().slice(0, 10);
  const next = new Date(`${day}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1);
  return { day, end: next.toISOString().slice(0, 10) };
}

function availableAt(slotData, preferredDate) {
  const requested = new Date(preferredDate).getTime();
  const slots = Object.values(slotData || {}).flat().filter(Boolean);
  return slots.some(slot => new Date(typeof slot === 'string' ? slot : slot.start).getTime() === requested);
}

async function probeCalcom() {
  const config = calcomConfig();
  if (!config) return { status: 'NOT CONFIGURED', verified: false };
  try {
    await calcomRequest(`/event-types/${config.eventTypeId}`);
    // The credential and event type work, but no booking has been verified yet.
    return { status: 'AVAILABLE', verified: true };
  } catch (error) {
    return { status: 'ERROR', verified: false, error: error.message };
  }
}

async function bookMeeting(args, context) {
  const config = calcomConfig();
  if (!config) {
    return {
      booked: false,
      verified: false,
      externalStatus: 'NOT CONFIGURED',
      error: 'Scheduling is not configured. No meeting was booked.',
    };
  }

  const operationId = operationIdFor(args, context);
  const operationRef = db.collection('externalOperations').doc(operationId);
  try {
    const existing = await operationRef.get();
    if (existing.exists && existing.data().status === 'SUCCEEDED') return existing.data().result;
    if (existing.exists && existing.data().status === 'RUNNING') return { booked: false, verified: false, externalStatus: 'BOOKING_IN_PROGRESS', error: 'A booking for this exact request is already in progress.' };
    await operationRef.set({ operationId, organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, provider: 'calcom', toolName: 'book_meeting', status: 'RUNNING', createdAt: new Date().toISOString() }, { merge: true });

    await calcomRequest(`/event-types/${config.eventTypeId}`);
    const range = dayRange(args.preferred_date);
    const query = new URLSearchParams({ eventTypeId: String(config.eventTypeId), start: range.day, end: range.end, timeZone: args.attendee.timeZone, format: 'range' });
    const slots = await calcomRequest(`/slots?${query.toString()}`);
    if (!availableAt(slots.data, args.preferred_date)) throw new Error('The requested Cal.com slot is not available');

    const created = await calcomRequest('/bookings', { method: 'POST', body: {
      start: args.preferred_date, eventTypeId: config.eventTypeId,
      attendee: { name: args.attendee.name, email: args.attendee.email, timeZone: args.attendee.timeZone },
      metadata: { dealforgeOperationId: operationId, meetingType: args.meeting_type },
    } });
    const bookingId = created.data?.uid || created.data?.id;
    if (!bookingId) throw new Error('Cal.com did not return a booking identifier');
    const verifiedBooking = await calcomRequest(`/bookings/${encodeURIComponent(bookingId)}`);
    if (!verifiedBooking.data) throw new Error('Cal.com booking verification returned no booking');
    const result = { booked: true, verified: true, externalStatus: 'BOOKED', bookingId: String(bookingId), meetingUrl: verifiedBooking.data.location || created.data?.location || null };
    await operationRef.set({ status: 'SUCCEEDED', result, completedAt: new Date().toISOString() }, { merge: true });
    await writeAuditEvent({ organizationId: context.organizationId, dealId: context.dealId, sessionId: context.sessionId, eventType: EVENT_TYPES.BOOKING_CREATED, trigger: 'Cal.com booking created and verified', actionResult: { bookingId: String(bookingId), verified: true } });
    return result;
  } catch (err) {
    console.error('Cal.com booking failed:', err.message);
    const result = {
      booked: false,
      verified: false,
      externalStatus: 'BOOKING_FAILED',
      error: `Scheduling integration failed: ${err.message}. No meeting was booked.`,
    };
    await operationRef.set({ status: 'FAILED', error: result.error, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    return result;
  }
}

registerTool('book_meeting', bookMeeting, {
  description: 'Request a verified follow-up meeting. It returns an error until a verified server-side scheduling integration is enabled.',
  parameters: {
    type: 'object',
    properties: {
      meeting_type: { type: 'string', description: 'Type of meeting: enterprise_demo, technical_review, executive_briefing' },
      preferred_date: { type: 'string', description: 'Confirmed ISO 8601 meeting start with UTC offset' },
      attendee: { type: 'object', description: 'Confirmed attendee name, email address, and IANA time zone' },
    },
  },
});

module.exports = bookMeeting;
module.exports.probeCalcom = probeCalcom;
module.exports.calcomConfig = calcomConfig;
module.exports.availableAt = availableAt;
module.exports.calcomRequest = calcomRequest;
