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
// Cal.com versions are endpoint-specific. Keep known-working availability
// routes on their documented contracts and pin booking creation to the current
// contract which accepts POST /bookings.
const CALCOM_EVENT_TYPES_API_VERSION = '2024-06-14';
const CALCOM_SLOTS_API_VERSION = '2024-09-04';
const CALCOM_BOOKINGS_CREATE_API_VERSION = '2026-02-25';
const CALCOM_BOOKING_READ_API_VERSION = '2024-08-13';

function calcomConfig() {
  const { CALCOM_API_KEY: apiKey, CALCOM_EVENT_TYPE_ID: eventTypeId } = process.env;
  if (!apiKey || !eventTypeId) return null;
  if (!/^\d+$/.test(String(eventTypeId))) return null;
  return { apiKey, eventTypeId: Number(eventTypeId) };
}

function calcomErrorMessage(payload) {
  const candidate = payload?.message || payload?.error || payload?.data?.message;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  if (candidate && typeof candidate === 'object') {
    const nested = candidate.message || candidate.detail || candidate.code;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    try { return JSON.stringify(candidate); } catch (_) { /* use safe fallback below */ }
  }
  return 'provider error';
}

async function calcomRequest(path, { method = 'GET', body, apiVersion } = {}) {
  const config = calcomConfig();
  if (!config) throw new Error('Cal.com is not configured');
  if (!apiVersion) throw new Error('Cal.com API version is required for this endpoint');
  const response = await fetch(`${CALCOM_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'cal-api-version': apiVersion },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Cal.com ${method} ${path} failed (${response.status}): ${calcomErrorMessage(payload).slice(0, 180)}`);
  return payload;
}

async function configuredEventType() {
  const config = calcomConfig();
  if (!config) throw new Error('Cal.com is not configured');
  // Cal.com's supported v2 event-type probe is the collection endpoint. The
  // single-record route is not available for this API surface.
  const response = await calcomRequest('/event-types', { apiVersion: CALCOM_EVENT_TYPES_API_VERSION });
  const eventType = Array.isArray(response.data) ? response.data.find(item => Number(item.id) === config.eventTypeId) : null;
  if (!eventType) throw new Error('Configured Cal.com event type was not found');
  // Cal.com's v2 collection response can omit `active` for an enabled personal
  // event type. Only an explicit false is a safe inactive signal; treating an
  // omitted field as false incorrectly disabled real scheduling.
  if (eventType.active === false) throw new Error('Configured Cal.com event type is inactive');
  const unsupported = (eventType.bookingFields || []).filter(field => field?.required && !['name', 'email'].includes(field.type));
  if (unsupported.length) throw new Error('Configured Cal.com event type has unsupported required booking fields');
  return eventType;
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
    await configuredEventType();
    // The credential and active event type work, but no booking has been verified yet.
    return { status: 'AVAILABLE', verified: true };
  } catch (error) {
    return { status: /inactive|unsupported/i.test(error.message) ? 'DEGRADED' : 'ERROR', verified: false, error: error.message };
  }
}

function assertIanaTimeZone(timeZone) {
  try { Intl.DateTimeFormat('en-US', { timeZone }).format(); }
  catch (_) { throw new Error('Time zone must be a valid IANA time zone'); }
}

function flattenSlots(slotData) {
  return Object.values(slotData || {}).flat().map(slot => typeof slot === 'string' ? { start: slot } : slot).filter(slot => slot?.start).slice(0, 24);
}

async function getAvailableSlots({ preferredDate, timeZone }) {
  const config = calcomConfig();
  if (!config) throw new Error('Scheduling is not configured');
  assertIanaTimeZone(timeZone);
  await configuredEventType();
  const range = dayRange(`${preferredDate}T12:00:00.000Z`);
  const query = new URLSearchParams({ eventTypeId: String(config.eventTypeId), start: range.day, end: range.end, timeZone, format: 'range' });
  const slots = await calcomRequest(`/slots?${query.toString()}`, { apiVersion: CALCOM_SLOTS_API_VERSION });
  return flattenSlots(slots.data);
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

    await configuredEventType();
    const slots = await getAvailableSlots({ preferredDate: new Date(args.preferred_date).toISOString().slice(0, 10), timeZone: args.attendee.timeZone });
    if (!availableAt({ slots }, args.preferred_date)) throw new Error('The requested Cal.com slot is not available');

    const created = await calcomRequest('/bookings', { method: 'POST', apiVersion: CALCOM_BOOKINGS_CREATE_API_VERSION, body: {
      start: args.preferred_date, eventTypeId: config.eventTypeId,
      attendee: { name: args.attendee.name, email: args.attendee.email, timeZone: args.attendee.timeZone },
      metadata: { dealforgeOperationId: operationId, meetingType: args.meeting_type },
    } });
    const bookingId = created.data?.uid || created.data?.id;
    if (!bookingId) throw new Error('Cal.com did not return a booking identifier');
    const verifiedBooking = await calcomRequest(`/bookings/${encodeURIComponent(bookingId)}`, { apiVersion: CALCOM_BOOKING_READ_API_VERSION });
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
  // Booking is initiated only by the validated customer form. Giving raw booking
  // arguments to the model would invite spoken email/time transcription errors.
  agentVisible: false,
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
module.exports.getAvailableSlots = getAvailableSlots;
module.exports.configuredEventType = configuredEventType;
module.exports.assertIanaTimeZone = assertIanaTimeZone;
module.exports.calcomRequest = calcomRequest;
module.exports.CALCOM_EVENT_TYPES_API_VERSION = CALCOM_EVENT_TYPES_API_VERSION;
module.exports.CALCOM_SLOTS_API_VERSION = CALCOM_SLOTS_API_VERSION;
module.exports.CALCOM_BOOKINGS_CREATE_API_VERSION = CALCOM_BOOKINGS_CREATE_API_VERSION;
module.exports.CALCOM_BOOKING_READ_API_VERSION = CALCOM_BOOKING_READ_API_VERSION;
module.exports.calcomErrorMessage = calcomErrorMessage;
