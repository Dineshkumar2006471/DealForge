const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const {
  callLinkSchema,
  createDealSchema,
  sessionCredentialSchema,
  approvalResolutionSchema,
  callStopSchema,
  meetingDetailsSchema,
  meetingBookingSchema,
  hubspotLinkSchema,
  bookingSyncSchema,
  chatSchema,
  parse,
  parseTool,
  STAGES,
  STATUSES,
} = require('../src/lib/schema/validation');

// ─── STAGES and STATUSES constants ──────────────────────────────────────────
test('STAGES contains expected deal stages', () => {
  assert.deepStrictEqual(STAGES, ['QUALIFY', 'NEGOTIATE', 'BOOK', 'CLOSED_WON', 'CLOSED_LOST']);
});

test('STATUSES contains expected deal statuses', () => {
  assert.deepStrictEqual(STATUSES, ['ACTIVE', 'QUALIFIED', 'PENDING_APPROVAL', 'CLOSED_WON', 'CLOSED_LOST']);
});

// ─── callLinkSchema ──────────────────────────────────────────────────────────
test('callLinkSchema: accepts valid input', () => {
  const result = callLinkSchema.parse({ dealId: 'deal-123', customerLabel: 'John Doe' });
  assert.strictEqual(result.dealId, 'deal-123');
  assert.strictEqual(result.customerLabel, 'John Doe');
  assert.strictEqual(result.expiresInMinutes, 60); // default
});

test('callLinkSchema: accepts custom expiry', () => {
  const result = callLinkSchema.parse({ dealId: 'deal-1', customerLabel: 'Jane', expiresInMinutes: 30 });
  assert.strictEqual(result.expiresInMinutes, 30);
});

test('callLinkSchema: rejects missing dealId', () => {
  assert.throws(() => callLinkSchema.parse({ customerLabel: 'John' }), { name: 'ZodError' });
});

test('callLinkSchema: rejects empty dealId', () => {
  assert.throws(() => callLinkSchema.parse({ dealId: '', customerLabel: 'John' }), { name: 'ZodError' });
});

test('callLinkSchema: rejects dealId over 128 chars', () => {
  assert.throws(() => callLinkSchema.parse({ dealId: 'x'.repeat(129), customerLabel: 'John' }), { name: 'ZodError' });
});

test('callLinkSchema: rejects customerLabel under 2 chars', () => {
  assert.throws(() => callLinkSchema.parse({ dealId: 'deal-1', customerLabel: 'J' }), { name: 'ZodError' });
});

test('callLinkSchema: rejects expiry below 5 minutes', () => {
  assert.throws(() => callLinkSchema.parse({ dealId: 'deal-1', customerLabel: 'John', expiresInMinutes: 2 }), {
    name: 'ZodError',
  });
});

test('callLinkSchema: rejects expiry above 60 minutes', () => {
  assert.throws(() => callLinkSchema.parse({ dealId: 'deal-1', customerLabel: 'John', expiresInMinutes: 120 }), {
    name: 'ZodError',
  });
});

test('callLinkSchema: strict mode rejects extra properties', () => {
  assert.throws(() => callLinkSchema.parse({ dealId: 'deal-1', customerLabel: 'John', extraField: 'hack' }), {
    name: 'ZodError',
  });
});

// ─── createDealSchema ────────────────────────────────────────────────────────
test('createDealSchema: accepts valid deal', () => {
  const result = createDealSchema.parse({ company: 'Acme Corp' });
  assert.strictEqual(result.company, 'Acme Corp');
  assert.strictEqual(result.targetArr, 0); // default
});

test('createDealSchema: accepts targetArr', () => {
  const result = createDealSchema.parse({ company: 'Big Co', targetArr: 50000 });
  assert.strictEqual(result.targetArr, 50000);
});

test('createDealSchema: rejects missing company', () => {
  assert.throws(() => createDealSchema.parse({}), { name: 'ZodError' });
});

test('createDealSchema: rejects company under 2 chars', () => {
  assert.throws(() => createDealSchema.parse({ company: 'X' }), { name: 'ZodError' });
});

test('createDealSchema: rejects negative targetArr', () => {
  assert.throws(() => createDealSchema.parse({ company: 'Acme', targetArr: -1 }), { name: 'ZodError' });
});

test('createDealSchema: rejects targetArr over 100 million', () => {
  assert.throws(() => createDealSchema.parse({ company: 'Acme', targetArr: 100000001 }), { name: 'ZodError' });
});

// ─── sessionCredentialSchema ─────────────────────────────────────────────────
test('sessionCredentialSchema: accepts valid credential', () => {
  const cred = 'a'.repeat(64);
  const result = sessionCredentialSchema.parse({ sessionCredential: cred });
  assert.strictEqual(result.sessionCredential, cred);
});

test('sessionCredentialSchema: rejects credential under 32 chars', () => {
  assert.throws(() => sessionCredentialSchema.parse({ sessionCredential: 'short' }), { name: 'ZodError' });
});

test('sessionCredentialSchema: rejects credential over 256 chars', () => {
  assert.throws(() => sessionCredentialSchema.parse({ sessionCredential: 'x'.repeat(257) }), { name: 'ZodError' });
});

// ─── approvalResolutionSchema ────────────────────────────────────────────────
test('approvalResolutionSchema: accepts APPROVED', () => {
  const result = approvalResolutionSchema.parse({ decision: 'APPROVED' });
  assert.strictEqual(result.decision, 'APPROVED');
});

test('approvalResolutionSchema: accepts REJECTED', () => {
  const result = approvalResolutionSchema.parse({ decision: 'REJECTED' });
  assert.strictEqual(result.decision, 'REJECTED');
});

test('approvalResolutionSchema: rejects invalid decision', () => {
  assert.throws(() => approvalResolutionSchema.parse({ decision: 'MAYBE' }), { name: 'ZodError' });
});

test('approvalResolutionSchema: rejects extra fields', () => {
  assert.throws(() => approvalResolutionSchema.parse({ decision: 'APPROVED', notes: 'ok' }), { name: 'ZodError' });
});

// ─── callStopSchema ──────────────────────────────────────────────────────────
test('callStopSchema: accepts empty object', () => {
  const result = callStopSchema.parse({});
  assert.deepStrictEqual(result, {});
});

test('callStopSchema: rejects extra fields', () => {
  assert.throws(() => callStopSchema.parse({ force: true }), { name: 'ZodError' });
});

// ─── meetingDetailsSchema ────────────────────────────────────────────────────
test('meetingDetailsSchema: accepts valid meeting details', () => {
  const data = {
    sessionCredential: 'a'.repeat(64),
    attendee: { name: 'John Doe', email: 'john@example.com', timeZone: 'America/New_York' },
    preferredDate: '2026-12-15',
  };
  const result = meetingDetailsSchema.parse(data);
  assert.strictEqual(result.attendee.name, 'John Doe');
});

test('meetingDetailsSchema: rejects invalid date format', () => {
  assert.throws(
    () =>
      meetingDetailsSchema.parse({
        sessionCredential: 'a'.repeat(64),
        attendee: { name: 'John', email: 'john@example.com', timeZone: 'UTC' },
        preferredDate: '15-12-2026',
      }),
    { name: 'ZodError' },
  );
});

test('meetingDetailsSchema: rejects invalid email', () => {
  assert.throws(
    () =>
      meetingDetailsSchema.parse({
        sessionCredential: 'a'.repeat(64),
        attendee: { name: 'John', email: 'not-email', timeZone: 'UTC' },
        preferredDate: '2026-12-15',
      }),
    { name: 'ZodError' },
  );
});

// ─── meetingBookingSchema ────────────────────────────────────────────────────
test('meetingBookingSchema: accepts valid booking', () => {
  const result = meetingBookingSchema.parse({
    sessionCredential: 'a'.repeat(64),
    slotStart: '2026-12-15T10:00:00+05:30',
  });
  assert.ok(result.slotStart);
});

test('meetingBookingSchema: rejects non-ISO slotStart', () => {
  assert.throws(() => meetingBookingSchema.parse({ sessionCredential: 'a'.repeat(64), slotStart: 'tomorrow' }), {
    name: 'ZodError',
  });
});

// ─── hubspotLinkSchema ───────────────────────────────────────────────────────
test('hubspotLinkSchema: accepts numeric deal ID', () => {
  const result = hubspotLinkSchema.parse({ hubspotDealId: '12345' });
  assert.strictEqual(result.hubspotDealId, '12345');
});

test('hubspotLinkSchema: rejects non-numeric deal ID', () => {
  assert.throws(() => hubspotLinkSchema.parse({ hubspotDealId: 'abc' }), { name: 'ZodError' });
});

// ─── bookingSyncSchema ───────────────────────────────────────────────────────
test('bookingSyncSchema: accepts boolean enabled', () => {
  const result = bookingSyncSchema.parse({ enabled: true });
  assert.strictEqual(result.enabled, true);
});

test('bookingSyncSchema: rejects non-boolean', () => {
  assert.throws(() => bookingSyncSchema.parse({ enabled: 'yes' }), { name: 'ZodError' });
});

// ─── Tool Schemas via parseTool ──────────────────────────────────────────────
test('parseTool: calculate_discount accepts valid percentage', () => {
  const result = parseTool('calculate_discount', { requested_pct: 15 });
  assert.strictEqual(result.requested_pct, 15);
});

test('parseTool: calculate_discount rejects negative', () => {
  assert.throws(() => parseTool('calculate_discount', { requested_pct: -5 }), { name: 'ZodError' });
});

test('parseTool: calculate_discount rejects > 100', () => {
  assert.throws(() => parseTool('calculate_discount', { requested_pct: 101 }), { name: 'ZodError' });
});

test('parseTool: update_deal_state accepts field/value', () => {
  const result = parseTool('update_deal_state', { field: 'company', value: 'Acme Corp' });
  assert.strictEqual(result.field, 'company');
});

test('parseTool: update_deal_state accepts meddic_pillar', () => {
  const result = parseTool('update_deal_state', { meddic_pillar: 'metrics', meddic_status: 'confirmed' });
  assert.strictEqual(result.meddic_pillar, 'metrics');
});

test('parseTool: update_deal_state accepts new_stage', () => {
  const result = parseTool('update_deal_state', { new_stage: 'NEGOTIATE' });
  assert.strictEqual(result.new_stage, 'NEGOTIATE');
});

test('parseTool: update_deal_state rejects empty object', () => {
  assert.throws(() => parseTool('update_deal_state', {}), { name: 'ZodError' });
});

test('parseTool: update_deal_state rejects invalid stage', () => {
  assert.throws(() => parseTool('update_deal_state', { new_stage: 'INVALID' }), { name: 'ZodError' });
});

test('parseTool: update_deal_state rejects invalid field name', () => {
  assert.throws(() => parseTool('update_deal_state', { field: 'hack', value: 'x' }), { name: 'ZodError' });
});

test('parseTool: check_product_availability accepts valid plan', () => {
  const result = parseTool('check_product_availability', { plan: 'enterprise', seats: 50 });
  assert.strictEqual(result.plan, 'enterprise');
});

test('parseTool: check_product_availability rejects invalid plan', () => {
  assert.throws(() => parseTool('check_product_availability', { plan: 'ultimate' }), { name: 'ZodError' });
});

test('parseTool: book_meeting accepts valid booking', () => {
  const result = parseTool('book_meeting', {
    meeting_type: 'enterprise_demo',
    preferred_date: '2026-12-15T10:00:00+05:30',
    attendee: { name: 'John', email: 'john@example.com', timeZone: 'UTC' },
  });
  assert.strictEqual(result.meeting_type, 'enterprise_demo');
});

test('parseTool: book_meeting rejects invalid meeting_type', () => {
  assert.throws(
    () =>
      parseTool('book_meeting', {
        meeting_type: 'casual_chat',
        preferred_date: '2026-12-15T10:00:00Z',
        attendee: { name: 'John', email: 'john@example.com', timeZone: 'UTC' },
      }),
    { name: 'ZodError' },
  );
});

test('parseTool: sync_to_hubspot requires at least one field', () => {
  assert.throws(() => parseTool('sync_to_hubspot', { fields: {} }), { name: 'ZodError' });
});

test('parseTool: sync_to_hubspot accepts valid fields', () => {
  const result = parseTool('sync_to_hubspot', { fields: { dealname: 'Acme Deal', amount: 50000 } });
  assert.strictEqual(result.fields.dealname, 'Acme Deal');
});

test('parseTool: sync_to_hubspot rejects non-allowlisted fields', () => {
  assert.throws(() => parseTool('sync_to_hubspot', { fields: { hack: 'value' } }), { name: 'ZodError' });
});

test('parseTool: escalate_to_human accepts valid escalation', () => {
  const result = parseTool('escalate_to_human', { reason: 'Customer upset', urgency: 'high' });
  assert.strictEqual(result.urgency, 'high');
});

test('parseTool: escalate_to_human rejects invalid urgency', () => {
  assert.throws(() => parseTool('escalate_to_human', { reason: 'test', urgency: 'critical' }), { name: 'ZodError' });
});

test('parseTool: unknown tool throws Error', () => {
  assert.throws(() => parseTool('nonexistent_tool', {}), { message: /Unknown tool/ });
});

// ─── parse utility ───────────────────────────────────────────────────────────
test('parse: works with any Zod schema', () => {
  const schema = z.object({ name: z.string() });
  const result = parse(schema, { name: 'test' });
  assert.strictEqual(result.name, 'test');
});

test('parse: throws ZodError for invalid input', () => {
  const schema = z.object({ name: z.string() });
  assert.throws(() => parse(schema, { name: 123 }), { name: 'ZodError' });
});

// ─── chatSchema ──────────────────────────────────────────────────────────────
test('chatSchema: accepts valid chat completion request', () => {
  const data = {
    stream: true,
    messages: [
      { role: 'system', content: 'You are an assistant' },
      { role: 'user', content: 'Hello' },
    ],
  };
  const result = chatSchema.parse(data);
  assert.strictEqual(result.messages.length, 2);
});

test('chatSchema: rejects non-streaming', () => {
  assert.throws(
    () =>
      chatSchema.parse({
        stream: false,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    { name: 'ZodError' },
  );
});

test('chatSchema: rejects messages over limit of 20', () => {
  const messages = Array.from({ length: 21 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
  assert.throws(() => chatSchema.parse({ stream: true, messages }), { name: 'ZodError' });
});
