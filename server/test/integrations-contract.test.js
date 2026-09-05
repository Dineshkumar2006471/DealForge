const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProperties, probeHubspot } = require('../src/lib/integrations/hubspot');
const { calcomRequest, availableAt } = require('../src/lib/tools/bookMeeting');

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

test('Cal.com client uses current v2 endpoint, bearer authentication, and an explicit API version', async () => {
  Object.assign(process.env, { CALCOM_API_KEY: 'cal_test', CALCOM_EVENT_TYPE_ID: '123', CALCOM_API_VERSION: '2024-09-04' });
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.cal.com/v2/event-types/123');
    assert.equal(options.headers.Authorization, 'Bearer cal_test');
    assert.equal(options.headers['cal-api-version'], '2024-09-04');
    return new Response(JSON.stringify({ status: 'success', data: { id: 123 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  assert.deepEqual(await calcomRequest('/event-types/123'), { status: 'success', data: { id: 123 } });
  assert.equal(availableAt({ '2026-09-06': [{ start: '2026-09-06T10:00:00.000Z' }] }, '2026-09-06T10:00:00Z'), true);
});
