const { registerMcpTool } = require('../mcp/mcpGateway');
const { executeMcpTool } = require('../mcp/mcpGateway');
const { registerTool } = require('../tools/registry');
const { getDeal } = require('../firebase/dealState');
const { db } = require('../firebase/admin');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');
const crypto = require('crypto');

const HUBSPOT_API = 'https://api.hubapi.com';
const ALLOWED_DEAL_PROPERTIES = new Set(['dealname', 'amount', 'dealstage', 'closedate', 'description']);

function configuration() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  return token ? { token } : null;
}

async function request(path, { method = 'GET', body } = {}) {
  const config = configuration();
  if (!config) throw new Error('HubSpot is not configured');
  const response = await fetch(`${HUBSPOT_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HubSpot ${method} ${path} failed (${response.status}): ${String(payload.message || payload.category || 'provider error').slice(0, 180)}`);
  return payload;
}

function normalizeProperties(fields = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('HubSpot fields must be an object');
  const properties = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!ALLOWED_DEAL_PROPERTIES.has(name)) throw new Error(`HubSpot property is not allowlisted: ${name}`);
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`HubSpot property ${name} must be text or a number`);
    const normalized = String(value).trim();
    if (!normalized || normalized.length > 5000) throw new Error(`HubSpot property ${name} is invalid`);
    properties[name] = normalized;
  }
  if (!Object.keys(properties).length) throw new Error('At least one allowlisted HubSpot property is required');
  return properties;
}

async function probeHubspot() {
  if (!configuration()) return { status: 'NOT CONFIGURED', verified: false };
  try {
    await request('/crm/v3/objects/deals?limit=1&properties=hs_object_id');
    // A successful read proves the credential, but a CRM write has not yet been
    // independently verified. The manager UI must not overstate that distinction.
    return { status: 'AVAILABLE', verified: true };
  } catch (error) {
    return { status: 'ERROR', verified: false, error: error.message };
  }
}

async function verifyHubspotDeal(hubspotDealId) {
  if (!/^\d+$/.test(String(hubspotDealId || ''))) throw new Error('HubSpot deal ID must be numeric');
  const deal = await request(`/crm/v3/objects/deals/${encodeURIComponent(String(hubspotDealId))}?properties=dealname`);
  if (!deal?.id) throw new Error('HubSpot did not return the requested deal');
  return { hubspotDealId: String(deal.id), dealName: String(deal.properties?.dealname || '') };
}

async function verifyBookingProperty() {
  const property = await request('/crm/v3/properties/deals/dealforge_last_booking');
  if (!property?.name || property.name !== 'dealforge_last_booking') throw new Error('HubSpot DealForge Last Booking property is unavailable');
  return { name: property.name, type: property.type || null, fieldType: property.fieldType || null };
}

function bookingSummary(booking) {
  const parts = [`Cal.com booking ${booking.bookingId}`, `Start ${booking.start}`];
  if (booking.meetingUrl) parts.push(`Join ${booking.meetingUrl}`);
  return parts.join(' | ').slice(0, 5000);
}

async function syncBookingToHubspot({ organizationId, dealId, sessionId, booking }) {
  if (!configuration()) return { verified: false, externalStatus: 'NOT_CONFIGURED', skipped: true, error: 'HubSpot is not configured. Booking was not synced to CRM.' };
  const deal = await getDeal(dealId, organizationId);
  const integration = deal?.integrations?.hubspot;
  if (!integration?.dealId) return { verified: false, externalStatus: 'NOT_LINKED', skipped: true, error: 'No linked HubSpot deal. Booking was not synced to CRM.' };
  if (integration.bookingSyncEnabled !== true) return { verified: false, externalStatus: 'SYNC_DISABLED', skipped: true, error: 'Manager booking-to-CRM sync is disabled.' };
  const operationId = crypto.createHash('sha256').update(`${sessionId}:${dealId}:hubspot-booking:${booking.bookingId}`).digest('hex');
  const operationRef = db.collection('externalOperations').doc(operationId);
  const existing = await operationRef.get();
  if (existing.exists && existing.data().status === 'SUCCEEDED') return existing.data().result;
  await operationRef.set({ operationId, organizationId, dealId, sessionId, provider: 'hubspot', toolName: 'sync_booking_to_hubspot', status: 'RUNNING', createdAt: new Date().toISOString() }, { merge: true });
  try {
    await verifyBookingProperty();
    const value = bookingSummary(booking);
    await request(`/crm/v3/objects/deals/${encodeURIComponent(integration.dealId)}`, { method: 'PATCH', body: { properties: { dealforge_last_booking: value } } });
    const verified = await request(`/crm/v3/objects/deals/${encodeURIComponent(integration.dealId)}?properties=dealforge_last_booking`);
    if (String(verified.properties?.dealforge_last_booking || '') !== value) throw new Error('HubSpot booking read-back did not match the requested value');
    const result = { verified: true, externalStatus: 'SYNCED', hubspotDealId: String(integration.dealId), syncedFields: ['dealforge_last_booking'] };
    await operationRef.set({ status: 'SUCCEEDED', result, completedAt: new Date().toISOString() }, { merge: true });
    await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.TOOL_EXECUTED, trigger: 'Verified Cal.com booking synced to linked HubSpot deal', actionResult: { tool: 'sync_booking_to_hubspot', verified: true, hubspotDealId: result.hubspotDealId } });
    return result;
  } catch (error) {
    const result = { verified: false, externalStatus: 'SYNC_FAILED', error: error.message };
    await operationRef.set({ status: 'FAILED', error: error.message.slice(0, 500), updatedAt: new Date().toISOString() }, { merge: true });
    await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.EXTERNAL_ACTION_FAILED, trigger: 'HubSpot booking sync failed', actionResult: { tool: 'sync_booking_to_hubspot', verified: false } });
    return result;
  }
}

async function syncToHubspot(args, context = {}) {
  if (!configuration()) return { verified: false, externalStatus: 'NOT_CONFIGURED', error: 'HubSpot is not configured. No data was synced to CRM.' };
  const dealId = context.dealId || args?.dealId;
  if (!dealId || (args?.dealId && context.dealId && args.dealId !== context.dealId)) return { verified: false, externalStatus: 'REJECTED', error: 'HubSpot sync must use the server-bound deal identity.' };
  const deal = await getDeal(dealId, context.organizationId);
  if (!deal) return { verified: false, externalStatus: 'NOT_FOUND', error: 'Server-bound deal was not found.' };
  const hubspotDealId = deal.integrations?.hubspot?.dealId;
  if (!hubspotDealId) return { verified: false, externalStatus: 'NOT_LINKED', error: 'This DealForge deal is not linked to a HubSpot deal. No CRM record was changed.' };
  try {
    const properties = normalizeProperties(args?.fields);
    await request(`/crm/v3/objects/deals/${encodeURIComponent(hubspotDealId)}`, { method: 'PATCH', body: { properties } });
    const verified = await request(`/crm/v3/objects/deals/${encodeURIComponent(hubspotDealId)}?properties=${encodeURIComponent(Object.keys(properties).join(','))}`);
    const matches = Object.entries(properties).every(([key, value]) => String(verified.properties?.[key] ?? '') === value);
    if (!matches) return { verified: false, externalStatus: 'VERIFY_FAILED', error: 'HubSpot did not return the requested values after update.' };
    return { verified: true, externalStatus: 'SYNCED', hubspotDealId: String(hubspotDealId), syncedFields: Object.keys(properties) };
  } catch (error) {
    return { verified: false, externalStatus: 'SYNC_FAILED', error: error.message };
  }
}

registerMcpTool({
  name: 'sync_to_hubspot',
  description: 'Update only the explicitly linked HubSpot deal using allowlisted properties and verify the result.',
  parameters: { type: 'object', properties: { fields: { type: 'object' } }, required: ['fields'] },
}, (args, context) => syncToHubspot(args, context));

registerTool('sync_to_hubspot', (args, context) => executeMcpTool({
  organizationId: context.organizationId,
  dealId: context.dealId,
  sessionId: context.sessionId,
  toolName: 'sync_to_hubspot',
  args,
}), {
  description: 'Request a manager-approved update to allowlisted fields on the explicitly linked HubSpot deal, then verify the read-back.',
  parameters: {
    type: 'object',
    properties: { fields: { type: 'object', description: 'Allowlisted HubSpot deal properties only.' } },
    required: ['fields'],
  },
});

module.exports = { probeHubspot, syncToHubspot, normalizeProperties, request, verifyHubspotDeal, verifyBookingProperty, syncBookingToHubspot, bookingSummary };
