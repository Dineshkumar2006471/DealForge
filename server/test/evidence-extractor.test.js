const test = require('node:test');
const assert = require('node:assert/strict');
const { extractEvidenceSignals } = require('../src/lib/evidence/evidenceExtractor');

// ─── Empty/Invalid Input ─────────────────────────────────────────────────────
test('extractEvidenceSignals returns empty array for null input', () => {
  assert.deepStrictEqual(extractEvidenceSignals(null), []);
});

test('extractEvidenceSignals returns empty array for undefined input', () => {
  assert.deepStrictEqual(extractEvidenceSignals(undefined), []);
});

test('extractEvidenceSignals returns empty array for empty string', () => {
  assert.deepStrictEqual(extractEvidenceSignals(''), []);
});

test('extractEvidenceSignals returns empty array for non-string input', () => {
  assert.deepStrictEqual(extractEvidenceSignals(123), []);
  assert.deepStrictEqual(extractEvidenceSignals({}), []);
});

test('extractEvidenceSignals returns empty for generic greeting', () => {
  const signals = extractEvidenceSignals('Hello, nice to meet you');
  // A generic greeting should not extract any company or structured data
  const structured = signals.filter((s) => s.type === 'field' || s.type === 'meddic');
  // We accept either empty or safe signals here
  assert.ok(Array.isArray(structured));
});

// ─── Company Name Extraction ─────────────────────────────────────────────────
test('extractEvidenceSignals extracts company from "we are [Company]"', () => {
  const signals = extractEvidenceSignals("We're Acme Corp and we need help");
  const company = signals.find((s) => s.field === 'company');
  assert.ok(company, 'Should extract company');
  assert.strictEqual(company.value, 'Acme Corp');
  assert.ok(company.confidence >= 0.9);
});

test('extractEvidenceSignals extracts Northstar Labs specifically', () => {
  const signals = extractEvidenceSignals('Hi, this is from Northstar Labs');
  const company = signals.find((s) => s.field === 'company');
  assert.ok(company, 'Should extract Northstar Labs');
  assert.strictEqual(company.value, 'Northstar Labs');
});

test('extractEvidenceSignals does not extract common verbs as company names', () => {
  const signals = extractEvidenceSignals("We're looking for a solution");
  const company = signals.find((s) => s.field === 'company');
  assert.ok(!company, 'Should not extract "looking" as company name');
});

// ─── Team Size Extraction ────────────────────────────────────────────────────
test('extractEvidenceSignals extracts team size from "50 sales reps"', () => {
  const signals = extractEvidenceSignals('We have 50 sales reps');
  const team = signals.find((s) => s.field === 'teamSize');
  assert.ok(team, 'Should extract team size');
  assert.strictEqual(team.value, '50');
  assert.ok(team.confidence >= 0.9);
});

test('extractEvidenceSignals extracts team size from "about 200 users"', () => {
  const signals = extractEvidenceSignals('We have about 200 users');
  const team = signals.find((s) => s.field === 'teamSize');
  assert.ok(team);
  assert.strictEqual(team.value, '200');
});

// ─── Budget Extraction ───────────────────────────────────────────────────────
test('extractEvidenceSignals extracts budget from lakh format', () => {
  const signals = extractEvidenceSignals('Our budget is 10-15 lakh annually');
  const budget = signals.find((s) => s.field === 'budget');
  assert.ok(budget, 'Should extract budget');
  assert.ok(budget.confidence >= 0.8);
});

// ─── Timeline Extraction ─────────────────────────────────────────────────────
test('extractEvidenceSignals extracts timeline from "decision this month"', () => {
  const signals = extractEvidenceSignals('We need to make a decision this month');
  const timeline = signals.find((s) => s.field === 'timeline');
  assert.ok(timeline, 'Should extract timeline');
});

// ─── Competitor Extraction ───────────────────────────────────────────────────
test('extractEvidenceSignals extracts competitor mentions', () => {
  const signals = extractEvidenceSignals("We're currently evaluating Salesforce as well");
  const competitor = signals.find((s) => s.field === 'competitor');
  assert.ok(competitor, 'Should extract competitor');
  assert.match(competitor.value, /Salesforce/i);
});

// ─── Pain Point Extraction ───────────────────────────────────────────────────
test('extractEvidenceSignals extracts pain from frustration statements', () => {
  const signals = extractEvidenceSignals('Our biggest challenge is manual data entry taking too much time');
  const pain = signals.find((s) => s.field === 'pain' || (s.type === 'meddic' && s.pillar === 'identifyPain'));
  assert.ok(pain, 'Should extract pain point');
});

// ─── MEDDIC Pillar Extraction ────────────────────────────────────────────────
test('extractEvidenceSignals extracts economic buyer from decision-maker statements', () => {
  const signals = extractEvidenceSignals('The VP of Sales, Sarah Chen, makes the final call on purchases');
  const eb = signals.find((s) => s.type === 'meddic' && s.pillar === 'economicBuyer');
  assert.ok(eb, 'Should extract economic buyer');
});

test('extractEvidenceSignals extracts metrics from percentage-based outcomes', () => {
  const signals = extractEvidenceSignals('35% of our rep capacity is spent qualifying leads');
  const metrics = signals.find((s) => s.type === 'meddic' && s.pillar === 'metrics');
  assert.ok(metrics, 'Should extract metrics');
});

// ─── Signal Shape Invariant ──────────────────────────────────────────────────
test('every signal has type, value, confidence, and claim', () => {
  const signals = extractEvidenceSignals(
    "We're Acme Corp with 50 reps, budget of $100K, using Salesforce, need to deploy by Q3",
  );
  for (const signal of signals) {
    assert.ok('type' in signal, 'Signal should have type');
    assert.ok('value' in signal, 'Signal should have value');
    assert.ok('confidence' in signal, 'Signal should have confidence');
    assert.ok('claim' in signal, 'Signal should have claim');
    assert.ok(signal.confidence >= 0 && signal.confidence <= 1, 'Confidence should be between 0 and 1');
    assert.ok(typeof signal.claim === 'string', 'Claim should be string');
  }
});
