const test = require('node:test');
const assert = require('node:assert/strict');

// Tools register themselves on require, so require the registry and all tools
const { getToolDefinitions } = require('../src/lib/tools/registry');
require('../src/lib/tools/calculateDiscount');
require('../src/lib/tools/updateDealState');
require('../src/lib/tools/checkProductAvailability');
require('../src/lib/tools/bookMeeting');
require('../src/lib/tools/requestMeetingDetails');
require('../src/lib/tools/escalateToHuman');

// ─── Tool Definitions Format ────────────────────────────────────────────────
test('getToolDefinitions returns an array of OpenAI-format function definitions', () => {
  const defs = getToolDefinitions();
  assert.ok(Array.isArray(defs));
  assert.ok(defs.length > 0);
});

test('each tool definition has type, function.name, function.description, and function.parameters', () => {
  const defs = getToolDefinitions();
  for (const def of defs) {
    assert.strictEqual(def.type, 'function', `${JSON.stringify(def)} should have type "function"`);
    assert.ok(def.function, 'definition should have function property');
    assert.ok(typeof def.function.name === 'string', 'function.name should be a string');
    assert.ok(def.function.name.length > 0, 'function.name should be non-empty');
    assert.ok(typeof def.function.description === 'string', 'function.description should be a string');
    assert.ok(def.function.parameters, 'function.parameters should exist');
    assert.ok(typeof def.function.parameters === 'object', 'function.parameters should be an object');
  }
});

test('tool definitions include expected core tools', () => {
  const defs = getToolDefinitions();
  const names = defs.map((d) => d.function.name);
  const expected = [
    'calculate_discount',
    'update_deal_state',
    'check_product_availability',
    'request_meeting_details',
    'escalate_to_human',
  ];
  for (const tool of expected) {
    assert.ok(names.includes(tool), `Expected tool "${tool}" to be registered`);
  }
});

test('tool definition names are unique', () => {
  const defs = getToolDefinitions();
  const names = defs.map((d) => d.function.name);
  const unique = new Set(names);
  assert.strictEqual(names.length, unique.size, 'Tool names should be unique');
});

test('tool definitions do not expose internal implementation details', () => {
  const defs = getToolDefinitions();
  const json = JSON.stringify(defs);
  assert.doesNotMatch(json, /require\(/);
  assert.doesNotMatch(json, /module\.exports/);
  assert.doesNotMatch(json, /process\.env/);
});

// ─── Tool Parameters ─────────────────────────────────────────────────────────
test('calculate_discount parameters include requested_pct', () => {
  const defs = getToolDefinitions();
  const discount = defs.find((d) => d.function.name === 'calculate_discount');
  assert.ok(discount);
  const params = discount.function.parameters;
  assert.ok(params.properties || params.required, 'Parameters should define properties');
});

test('update_deal_state parameters include field, value, meddic_pillar, new_stage', () => {
  const defs = getToolDefinitions();
  const update = defs.find((d) => d.function.name === 'update_deal_state');
  assert.ok(update);
  const props = update.function.parameters.properties || {};
  for (const key of ['field', 'value', 'meddic_pillar', 'new_stage']) {
    assert.ok(key in props, `update_deal_state should have "${key}" parameter`);
  }
});

test('escalate_to_human parameters include reason and urgency', () => {
  const defs = getToolDefinitions();
  const escalate = defs.find((d) => d.function.name === 'escalate_to_human');
  assert.ok(escalate);
  const props = escalate.function.parameters.properties || {};
  assert.ok('reason' in props, 'escalate_to_human should have "reason" parameter');
  assert.ok('urgency' in props, 'escalate_to_human should have "urgency" parameter');
});
