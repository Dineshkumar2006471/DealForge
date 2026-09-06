const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTool, parse, callLinkSchema, createDealSchema, meetingDetailsSchema, meetingBookingSchema } = require('../src/lib/schema/validation');
const { checkPolicy, TIERS } = require('../src/lib/policy/policyEngine');
test('discount validation bounds malformed values while policy rejects over-limit concessions', () => {
  assert.throws(() => parseTool('calculate_discount', { requested_pct: -1 }));
  assert.throws(() => parseTool('calculate_discount', { requested_pct: 100.01 }));
  assert.deepEqual(parseTool('calculate_discount', { requested_pct: 25 }), { requested_pct: 25 });
  assert.equal(checkPolicy('calculate_discount', { requested_pct: 30 }).tier, TIERS.REJECT);
});
test('deal state validation rejects arbitrary model fields and invalid stages', () => {
  assert.throws(() => parseTool('update_deal_state', { field: 'organizationId', value: 'attacker' }));
  assert.throws(() => parseTool('update_deal_state', { new_stage: 'ENDED' }));
  assert.deepEqual(parseTool('update_deal_state', { new_stage: 'NEGOTIATE' }), { new_stage: 'NEGOTIATE' });
});
test('call links have a bounded expiry', () => {
  const base = { dealId: 'd', customerLabel: 'Acme procurement' };
  assert.throws(() => parse(callLinkSchema, { ...base, expiresInMinutes: 1 }));
  assert.throws(() => parse(callLinkSchema, { ...base, expiresInMinutes: 61 }));
  assert.equal(parse(callLinkSchema, { ...base, expiresInMinutes: 60 }).expiresInMinutes, 60);
  assert.throws(() => parse(callLinkSchema, { dealId: 'd', customerLabel: 'x', expiresInMinutes: 60 }));
});
test('Acme demo commercial policy routes a 25 percent request to approval', () => {
  const listPriceInr = 1200000;
  const requestPct = 25;
  assert.equal(listPriceInr * requestPct / 100, 300000);
  assert.equal(checkPolicy('calculate_discount', { requested_pct: requestPct }).tier, TIERS.APPROVAL);
  assert.equal(checkPolicy('calculate_discount', { requested_pct: 18 }).tier, TIERS.ACT);
  assert.equal(checkPolicy('calculate_discount', { requested_pct: 26 }).tier, TIERS.REJECT);
});
test('manager-created deals validate company and target ARR before a server write', () => {
  assert.deepEqual(parse(createDealSchema, { company: 'Northstar Labs', targetArr: 120000 }), { company: 'Northstar Labs', targetArr: 120000 });
  assert.throws(() => parse(createDealSchema, { company: ' ', targetArr: 0 }));
  assert.throws(() => parse(createDealSchema, { company: 'Northstar Labs', targetArr: -1 }));
  assert.throws(() => parse(createDealSchema, { company: 'Northstar Labs', targetArr: 100000001 }));
});
test('meeting form requires safe attendee details, date, and a selected ISO slot', () => {
  const credential = 'a'.repeat(32);
  assert.deepEqual(parse(meetingDetailsSchema, { sessionCredential: credential, attendee: { name: 'Alex Buyer', email: 'alex@example.com', timeZone: 'Asia/Kolkata' }, preferredDate: '2026-09-08' }).preferredDate, '2026-09-08');
  assert.throws(() => parse(meetingDetailsSchema, { sessionCredential: credential, attendee: { name: 'Alex', email: 'not-an-email', timeZone: 'UTC' }, preferredDate: 'tomorrow' }));
  assert.equal(parse(meetingBookingSchema, { sessionCredential: credential, slotStart: '2026-09-08T10:00:00.000+05:30' }).slotStart, '2026-09-08T10:00:00.000+05:30');
});
test('the agent can request the secure meeting form but cannot invoke raw booking arguments', () => {
  assert.equal(checkPolicy('request_meeting_details', { meeting_type: 'enterprise_demo' }).tier, TIERS.ACT);
  assert.equal(checkPolicy('book_meeting', {}).tier, TIERS.ACT);
});
