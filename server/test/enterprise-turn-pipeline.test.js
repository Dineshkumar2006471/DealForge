const test = require('node:test');
const assert = require('node:assert/strict');
const { extractEvidenceSignals } = require('../src/lib/evidence/evidenceExtractor');
const { normalizedTurn, receiptIdFor } = require('../src/lib/agent/turnReceipts');

test('evidenceExtractor correctly extracts company and team size from customer speech', () => {
  const signals = extractEvidenceSignals("We're Northstar Labs. We have about 300 sales reps.");
  const company = signals.find(s => s.field === 'company');
  const teamSize = signals.find(s => s.field === 'teamSize');

  assert.ok(company, 'Company should be extracted');
  assert.equal(company.value, 'Northstar Labs');
  assert.ok(company.confidence >= 0.85);

  assert.ok(teamSize, 'Team size should be extracted');
  assert.equal(teamSize.value, '300');
  assert.ok(teamSize.confidence >= 0.85);
});

test('evidenceExtractor correctly extracts pain and metrics MEDDIC pillars', () => {
  const signals = extractEvidenceSignals("Our main problem is inbound lead qualification. We spend around 35% of rep capacity on qualification.");
  const pain = signals.find(s => s.field === 'pain');
  const identifyPain = signals.find(s => s.pillar === 'identifyPain');
  const metrics = signals.find(s => s.pillar === 'metrics');

  assert.ok(pain, 'Pain field should be extracted');
  assert.equal(pain.value, 'Inbound lead qualification');

  assert.ok(identifyPain, 'Identify Pain pillar should be extracted');
  assert.equal(identifyPain.status, 'confirmed');

  assert.ok(metrics, 'Metrics pillar should be extracted');
  assert.equal(metrics.status, 'confirmed');
  assert.ok(metrics.value.includes('35%'));
});

test('evidenceExtractor correctly extracts economic buyer and competitor', () => {
  const signals = extractEvidenceSignals("The VP of Sales will approve this. We're evaluating Salesforce too.");
  const buyer = signals.find(s => s.pillar === 'economicBuyer');
  const competitor = signals.find(s => s.field === 'competitor');

  assert.ok(buyer, 'Economic buyer should be extracted');
  assert.equal(buyer.value, 'VP of Sales');
  assert.equal(buyer.status, 'confirmed');

  assert.ok(competitor, 'Competitor should be extracted');
  assert.ok(competitor.value.toLowerCase().includes('salesforce'));
});

test('evidenceExtractor correctly extracts budget and timeline', () => {
  const signals = extractEvidenceSignals("Our budget is ₹10–₹15 lakh annually, and we need a decision this month.");
  const budget = signals.find(s => s.field === 'budget');
  const timeline = signals.find(s => s.field === 'timeline');

  assert.ok(budget, 'Budget should be extracted');
  assert.ok(budget.value.includes('10') && budget.value.includes('15'));

  assert.ok(timeline, 'Timeline should be extracted');
  assert.ok(timeline.value.toLowerCase().includes('this month'));
});

test('evidenceExtractor correctly extracts decision criteria and process', () => {
  const signals = extractEvidenceSignals("Accuracy and CRM integration are our main decision criteria. Our evaluation process is shortlist then revops review.");
  const criteria = signals.find(s => s.pillar === 'decisionCriteria');
  const process = signals.find(s => s.pillar === 'decisionProcess');

  assert.ok(criteria, 'Decision criteria should be extracted');
  assert.equal(criteria.status, 'confirmed');

  assert.ok(process, 'Decision process should be extracted');
  assert.equal(process.status, 'confirmed');
});

test('evidenceExtractor rejects empty or invalid utterances cleanly', () => {
  assert.deepEqual(extractEvidenceSignals(''), []);
  assert.deepEqual(extractEvidenceSignals('   '), []);
  assert.deepEqual(extractEvidenceSignals(null), []);
  assert.deepEqual(extractEvidenceSignals(undefined), []);
});
