const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProperties, probeHubspot } = require('../src/lib/integrations/hubspot');
const { calcomRequest, availableAt, configuredEventType, CALCOM_EVENT_TYPES_API_VERSION, CALCOM_BOOKINGS_CREATE_API_VERSION } = require('../src/lib/tools/bookMeeting');

const savedEnvironment = Object.fromEntries(['HUBSPOT_ACCESS_TOKEN', 'CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID', 'CALCOM_API_VERSION'].map(key => [key, process.env[key]]));
const originalFetch = global.fetch;

test.after(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('HubSpot probe uses a server-side bearer token and reports AVAILABLE after a verified read until an action succeeds', async () => {
  process.env.HUBSPOT_ACCESS_TOKEN = 'test-token';
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.hubapi.com/crm/v3/objects/deals?limit=1&properties=hs_object_id');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  assert.deepEqual(await probeHubspot(), { status: 'AVAILABLE', verified: true });
});

test('HubSpot field normalization rejects arbitrary CRM writes', () => {
  assert.deepEqual(normalizeProperties({ amount: 12500, dealstage: 'qualifiedtobuy' }), { amount: '12500', dealstage: 'qualifiedtobuy' });
  assert.throws(() => normalizeProperties({ owner_id: 'someone-else' }), /not allowlisted/);
});

test('Cal.com client pins each endpoint to its documented version, ignoring a stale runtime value', async () => {
  Object.assign(process.env, { CALCOM_API_KEY: 'cal_test', CALCOM_EVENT_TYPE_ID: '123', CALCOM_API_VERSION: '2024-09-04' });
  let calls = 0;
  global.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://api.cal.com/v2/event-types');
    assert.equal(options.headers.Authorization, 'Bearer cal_test');
    assert.equal(options.headers['cal-api-version'], '2024-06-14');
    return new Response(JSON.stringify({ status: 'success', data: [{ id: 123, bookingFields: [] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  assert.equal(CALCOM_EVENT_TYPES_API_VERSION, '2024-06-14');
  assert.equal(CALCOM_BOOKINGS_CREATE_API_VERSION, '2026-02-25');
  assert.deepEqual(await calcomRequest('/event-types', { apiVersion: CALCOM_EVENT_TYPES_API_VERSION }), { status: 'success', data: [{ id: 123, bookingFields: [] }] });
  assert.equal((await configuredEventType()).id, 123);
  assert.equal(calls, 2);
  assert.equal(availableAt({ '2026-09-06': [{ start: '2026-09-06T10:00:00.000Z' }] }, '2026-09-06T10:00:00Z'), true);
});

test('Cal.com structured provider errors produce actionable text rather than [object Object]', async () => {
  Object.assign(process.env, { CALCOM_API_KEY: 'cal_test', CALCOM_EVENT_TYPE_ID: '123' });
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Unsupported Cal.com API version' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(() => calcomRequest('/bookings', { method: 'POST', apiVersion: CALCOM_BOOKINGS_CREATE_API_VERSION }), /Unsupported Cal\.com API version/);
});
