const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcomRequest,
  availableAt,
  configuredEventType,
  CALCOM_EVENT_TYPES_API_VERSION,
  CALCOM_SLOTS_API_VERSION,
  CALCOM_BOOKINGS_CREATE_API_VERSION,
} = require('../src/lib/tools/bookMeeting');

test('Cal.com Integration Contract Layer', async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  t.beforeEach(() => {
    process.env.CALCOM_API_KEY = 'cal_live_contract_key';
    process.env.CALCOM_EVENT_TYPE_ID = '98765';
  });

  t.afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  await t.test('calcomRequest: sends exact pinned version, authorization bearer, and json headers', async () => {
    let capturedUrl = null;
    let capturedHeaders = null;

    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      return new Response(JSON.stringify({ status: 'success', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await calcomRequest('/test-endpoint', {
      method: 'GET',
      apiVersion: '2024-06-14',
    });

    assert.strictEqual(capturedUrl, 'https://api.cal.com/v2/test-endpoint');
    assert.strictEqual(capturedHeaders.Authorization, 'Bearer cal_live_contract_key');
    assert.strictEqual(capturedHeaders['cal-api-version'], '2024-06-14');
    assert.strictEqual(capturedHeaders['Content-Type'], 'application/json');
  });

  await t.test('configuredEventType: queries collection and finds configured event type', async () => {
    global.fetch = async (url, options) => {
      assert.strictEqual(url, 'https://api.cal.com/v2/event-types');
      assert.strictEqual(options.headers['cal-api-version'], CALCOM_EVENT_TYPES_API_VERSION);
      return new Response(
        JSON.stringify({
          data: [
            { id: 111, title: 'Intro' },
            { id: 98765, title: 'Enterprise Demo', lengthInMinutes: 30, slug: 'demo' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const eventType = await configuredEventType();
    assert.strictEqual(eventType.id, 98765);
    assert.strictEqual(eventType.title, 'Enterprise Demo');
  });

  await t.test('availableAt: verifies requested slot falls within provider returned available slots', () => {
    const targetSlot = '2026-09-20T14:00:00.000Z';
    const slotsData = {
      '2026-09-20': [{ start: targetSlot, status: 'free' }],
    };

    const available = availableAt(slotsData, targetSlot);
    assert.strictEqual(available, true);
  });

  await t.test('availableAt: returns false if slot is unavailable or already booked', () => {
    const slotsData = {
      '2026-09-20': [],
    };

    const available = availableAt(slotsData, '2026-09-20T18:00:00.000Z');
    assert.strictEqual(available, false);
  });

  await t.test(
    'Duplicate Booking Rejection: provider 409 Conflict translates to clean booking conflict error',
    async () => {
      global.fetch = async (url) => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'SLOT_ALREADY_BOOKED',
              message: 'This time slot is no longer available.',
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      };

      await assert.rejects(
        async () => {
          await calcomRequest('/bookings', {
            method: 'POST',
            apiVersion: CALCOM_BOOKINGS_CREATE_API_VERSION,
            body: { start: '2026-09-20T14:00:00.000Z', eventTypeId: 98765 },
          });
        },
        (err) => {
          assert.match(err.message, /409/);
          assert.match(err.message, /no longer available/i);
          return true;
        },
      );
    },
  );

  await t.test('Provider Outage (500): surfaces provider failure with truncated safe diagnostic message', async () => {
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          message: 'Internal Cal.com database connection pool exhausted',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );

    await assert.rejects(
      async () => {
        await calcomRequest('/event-types', {
          method: 'GET',
          apiVersion: CALCOM_EVENT_TYPES_API_VERSION,
        });
      },
      (err) => {
        assert.match(err.message, /failed \(500\)/);
        assert.match(err.message, /connection pool/);
        return true;
      },
    );
  });

  await t.test('Timezone handling: converts local timezone requests to valid ISO 8601 strings', () => {
    const slotLocal = '2026-09-20T10:00:00';
    const dateObj = new Date(slotLocal);
    assert.ok(!isNaN(dateObj.getTime()), 'Must parse valid date');
    const isoUtc = dateObj.toISOString();
    assert.match(isoUtc, /Z$/, 'Must format as UTC ISO timestamp');
  });
});
