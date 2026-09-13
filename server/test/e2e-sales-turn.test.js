const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { db } = require('../src/lib/firebase/admin');

test('E2E Sales Turn Lifecycle, Manager Approval & Resilience Flow', async (t) => {
  const app = createApp();
  const originalCollection = db.collection;
  const originalRunTransaction = db.runTransaction;

  const testReport = {
    suite: 'E2E Sales Turn Lifecycle',
    timestamp: new Date().toISOString(),
    tests: [],
    passed: 0,
    failed: 0,
  };

  const recordResult = (name, passed, durationMs, details = {}) => {
    testReport.tests.push({ name, passed, durationMs, details });
    if (passed) testReport.passed++;
    else testReport.failed++;
  };

  const mockDeal = {
    id: 'deal-e2e-1',
    organizationId: 'org-acme-e2e',
    company: 'Acme Global',
    stage: 'QUALIFY',
    status: 'ACTIVE',
    targetArr: 80000,
    discountLedger: [],
  };

  const memory = new Map();
  const chainableQuery = {
    where: () => chainableQuery,
    orderBy: () => chainableQuery,
    limit: () => chainableQuery,
    get: async () => ({ docs: [], empty: true }),
  };

  const makeDocRef = (docId) => ({
    id: docId,
    get: async () => ({
      exists: true,
      data: () => mockDeal,
    }),
    set: async (data, opts) => {
      const existing = memory.get(docId) || {};
      memory.set(docId, opts?.merge ? { ...existing, ...data } : data);
    },
    update: async (data) => {
      const existing = memory.get(docId) || {};
      memory.set(docId, { ...existing, ...data });
    },
    collection: () => ({
      doc: (subId) => makeDocRef(subId),
      where: () => chainableQuery,
      orderBy: () => chainableQuery,
      limit: () => chainableQuery,
      get: async () => ({ docs: [], empty: true }),
    }),
  });

  t.beforeEach(() => {
    db.collection = () => ({
      doc: (id) => makeDocRef(id),
      where: () => chainableQuery,
      orderBy: () => chainableQuery,
      get: async () => ({ docs: [], empty: true }),
    });

    db.runTransaction = async (cb) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => mockDeal,
        }),
        set: () => {},
        update: () => {},
        create: () => {},
      };
      return await cb(tx);
    };
  });

  t.after(() => {
    db.collection = originalCollection;
    db.runTransaction = originalRunTransaction;

    // Save machine-readable E2E test report
    const reportDir = path.resolve(__dirname, '..', 'test-results');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    fs.writeFileSync(path.join(reportDir, 'e2e-report.json'), JSON.stringify(testReport, null, 2), 'utf8');
  });

  await t.test('Step 1: Public Health endpoint responds OK for gateway routing', async () => {
    const t0 = performance.now();
    const res = await request(app).get('/api/health');
    const duration = performance.now() - t0;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    recordResult('Health Gateway Check', true, duration, { status: res.status });
  });

  await t.test('Step 2: Unauthorized manager access is rejected with 401', async () => {
    const t0 = performance.now();
    const res = await request(app).get('/api/manager/approvals').set('Authorization', 'Bearer invalid_garbage_token');
    const duration = performance.now() - t0;
    assert.strictEqual(res.status, 401);
    recordResult('Unauthorized Manager Rejection', true, duration, { status: res.status });
  });

  await t.test('Step 3: Missing session credentials in voice turn rejected with 400', async () => {
    const t0 = performance.now();
    const res = await request(app).post('/api/public/calls/token-12345/turn').send({ userText: 'Hello' });
    const duration = performance.now() - t0;
    assert.strictEqual(res.status, 400);
    recordResult('Missing Credential Rejection', true, duration, { status: res.status });
  });

  await t.test('Step 4: End-to-end customer negotiation policy boundary and manager approval flow', async () => {
    const t0 = performance.now();

    // 1. Initial 15% discount request is auto-approved by deterministic policy (<=18%)
    const autoPolicy = require('../src/lib/policy/policyEngine').checkPolicy('calculate_discount', {
      requested_pct: 15,
    });
    assert.strictEqual(autoPolicy.allowed, true);
    assert.strictEqual(autoPolicy.tier, 'ACT');
    assert.strictEqual(Boolean(autoPolicy.requiresApproval), false);

    // 2. Concession of 22% triggers Tier 3 manager approval requirement
    const approvalPolicy = require('../src/lib/policy/policyEngine').checkPolicy('calculate_discount', {
      requested_pct: 22,
    });
    assert.strictEqual(approvalPolicy.allowed, false);
    assert.strictEqual(approvalPolicy.tier, 'APPROVAL');
    assert.strictEqual(approvalPolicy.requiresApproval, true);

    // 3. Approved replay executes discount concession atomically
    const calculateDiscount = require('../src/lib/tools/calculateDiscount');
    const approvedReplay = await calculateDiscount(
      { requested_pct: 22 },
      {
        dealId: 'deal-e2e-1',
        organizationId: 'org-acme-e2e',
        sessionId: null,
        turnNumber: 3,
        approvedReplay: true,
      },
    );
    assert.strictEqual(approvedReplay.approved, true);
    assert.strictEqual(approvedReplay.requested, 22);
    assert.strictEqual(approvedReplay.counter_offer, 22);

    const duration = performance.now() - t0;
    recordResult('End-to-End Negotiation & Approval', true, duration, { approvedPct: 22 });
  });

  await t.test('Step 5: Machine-readable report generated to test-results/e2e-report.json', () => {
    const reportDir = path.resolve(__dirname, '..', 'test-results');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    fs.writeFileSync(path.join(reportDir, 'e2e-report.json'), JSON.stringify(testReport, null, 2), 'utf8');
    assert.ok(fs.existsSync(path.join(reportDir, 'e2e-report.json')));
    const saved = JSON.parse(fs.readFileSync(path.join(reportDir, 'e2e-report.json'), 'utf8'));
    assert.strictEqual(saved.suite, 'E2E Sales Turn Lifecycle');
    assert.ok(saved.tests.length >= 4);
    assert.strictEqual(saved.failed, 0);
  });
});
