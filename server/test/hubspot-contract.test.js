const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProperties, verifyHubspotDeal, syncBookingToHubspot } = require('../src/lib/integrations/hubspot');
const { db } = require('../src/lib/firebase/admin');

test('HubSpot CRM Integration Contract Layer', async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const originalCollection = db.collection;

  t.beforeEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = 'pat-na2-live-test-token';
  });

  t.afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    db.collection = originalCollection;
  });

  await t.test('normalizeProperties: allowlists amount, dealname, dealstage, closedate, description only', () => {
    const valid = normalizeProperties({
      dealname: 'Acme Enterprise Expansion',
      amount: '50000',
      dealstage: 'presentationscheduled',
      description: 'Negotiating within 18% autonomous limit',
    });

    assert.strictEqual(valid.dealname, 'Acme Enterprise Expansion');
    assert.strictEqual(valid.amount, '50000');

    // Reject non-allowlisted property
    assert.throws(
      () => normalizeProperties({ dealname: 'Test', malicious_injection: 'DROP TABLE' }),
      /not allowlisted: malicious_injection/,
    );

    // Reject empty payload
    assert.throws(() => normalizeProperties({}), /At least one allowlisted/);

    // Reject non-object
    assert.throws(() => normalizeProperties(null), /must be an object/);
  });

  await t.test('verifyHubspotDeal: rejects non-numeric deal ID before network call', async () => {
    await assert.rejects(async () => {
      await verifyHubspotDeal('alphanumeric-deal-id');
    }, /HubSpot deal ID must be numeric/);
  });

  await t.test('verifyHubspotDeal: queries deal endpoint and returns verified metadata', async () => {
    global.fetch = async (url, options) => {
      assert.strictEqual(url, 'https://api.hubapi.com/crm/v3/objects/deals/12345678?properties=dealname');
      assert.strictEqual(options.headers.Authorization, 'Bearer pat-na2-live-test-token');
      return new Response(
        JSON.stringify({
          id: '12345678',
          properties: { dealname: 'Enterprise Contract Q4' },
          url: 'https://app-na2.hubspot.com/record/12345678',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const verified = await verifyHubspotDeal('12345678');
    assert.strictEqual(verified.hubspotDealId, '12345678');
    assert.strictEqual(verified.dealName, 'Enterprise Contract Q4');
    assert.ok(verified.dealUrl);
  });

  await t.test('syncBookingToHubspot: skips gracefully when HubSpot is not configured', async () => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;

    const res = await syncBookingToHubspot({
      organizationId: 'org-test',
      dealId: 'deal-1',
      sessionId: 'sess-1',
      booking: { bookingId: 'b-1', start: '2026-09-20T10:00:00Z' },
    });

    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(res.externalStatus, 'NOT_CONFIGURED');
  });

  await t.test('syncBookingToHubspot: skips gracefully when deal has no linked HubSpot deal', async () => {
    // Mock getDeal returning deal with no integrations
    db.collection = (colName) => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ organizationId: 'org-test', integrations: {} }),
        }),
      }),
    });

    const res = await syncBookingToHubspot({
      organizationId: 'org-test',
      dealId: 'deal-unlinked',
      sessionId: 'sess-1',
      booking: { bookingId: 'b-1', start: '2026-09-20T10:00:00Z' },
    });

    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(res.externalStatus, 'NOT_LINKED');
  });

  await t.test('syncBookingToHubspot: skips when booking sync is disabled by manager', async () => {
    db.collection = (colName) => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({
            organizationId: 'org-test',
            integrations: { hubspot: { dealId: '12345', bookingSyncEnabled: false } },
          }),
        }),
      }),
    });

    const res = await syncBookingToHubspot({
      organizationId: 'org-test',
      dealId: 'deal-sync-disabled',
      sessionId: 'sess-1',
      booking: { bookingId: 'b-1', start: '2026-09-20T10:00:00Z' },
    });

    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(res.externalStatus, 'SYNC_DISABLED');
  });

  await t.test('HubSpot Error Resilience: returns structured error when CRM rate-limited (429)', async () => {
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          message: 'You have reached your secondly rate limit',
          category: 'RATE_LIMIT',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );

    await assert.rejects(
      async () => {
        await verifyHubspotDeal('123456');
      },
      (err) => {
        assert.match(err.message, /failed \(429\)/);
        assert.match(err.message, /rate limit/i);
        return true;
      },
    );
  });
});
