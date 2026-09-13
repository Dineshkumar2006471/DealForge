const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeal, getDeal, updateDealField } = require('../src/lib/firebase/dealState');
const { db } = require('../src/lib/firebase/admin');
const { CONFIDENCE_THRESHOLDS } = require('../src/lib/evidence/confidenceConfig');

test('Firestore Deal State & Transaction Contract Layer', async (t) => {
  const originalRunTransaction = db.runTransaction;
  const originalCollection = db.collection;

  t.afterEach(() => {
    db.runTransaction = originalRunTransaction;
    db.collection = originalCollection;
  });

  await t.test(
    'createDeal & getDeal: persists complete deal entity and enforces organizationId tenant matching',
    async () => {
      const memory = new Map();
      db.collection = () => ({
        doc: (id) => ({
          id,
          set: async (data) => memory.set(id, data),
          get: async () => ({
            exists: memory.has(id),
            id,
            data: () => memory.get(id),
          }),
        }),
      });

      const newDeal = {
        organizationId: 'org-acme',
        company: 'Acme Corp',
        stage: 'DISCOVERY',
        status: 'ACTIVE',
        targetArr: 50000,
      };

      await createDeal('deal-contract-1', newDeal);

      // 1. Valid tenant read succeeds
      const readDeal = await getDeal('deal-contract-1', 'org-acme');
      assert.strictEqual(readDeal.company, 'Acme Corp');
      assert.strictEqual(readDeal.targetArr, 50000);

      // 2. Cross-tenant read returns null
      const rogueDeal = await getDeal('deal-contract-1', 'org-attacker');
      assert.strictEqual(rogueDeal, null, 'Must return null for cross-tenant access');
    },
  );

  await t.test('Confidence-Gated Field Updates: confidence < 0.60 is rejected without database write', async () => {
    let writeAttempted = false;
    db.runTransaction = async () => {
      writeAttempted = true;
    };

    const res = await updateDealField(
      'deal-1',
      'budget',
      100000,
      0.55, // below 0.60 REJECT threshold
      'customer',
      1,
      'org-acme',
    );

    assert.strictEqual(res.updated, false);
    assert.match(res.reason, /below reject threshold/);
    assert.strictEqual(writeAttempted, false, 'Database transaction must not be opened for low-confidence data');
  });

  await t.test('Confidence-Gated Field Updates: confidence in 0.60 - 0.85 requires clarification', async () => {
    let writeAttempted = false;
    db.runTransaction = async () => {
      writeAttempted = true;
    };

    const res = await updateDealField(
      'deal-1',
      'teamSize',
      50,
      0.75, // in clarify range
      'customer',
      2,
      'org-acme',
    );

    assert.strictEqual(res.updated, false);
    assert.strictEqual(res.needsClarification, true);
    assert.strictEqual(writeAttempted, false);
  });

  await t.test(
    'Confidence-Gated Field Updates: confidence >= 0.85 updates field atomically in transaction',
    async () => {
      let transactionCommitted = false;
      const existingDeal = {
        organizationId: 'org-acme',
        company: 'Acme',
        stage: 'DISCOVERY',
      };

      db.runTransaction = async (callback) => {
        const tx = {
          get: async () => ({
            exists: true,
            data: () => existingDeal,
          }),
          update: () => {
            transactionCommitted = true;
          },
          create: () => {},
        };
        return await callback(tx);
      };

      db.collection = () => ({
        doc: () => ({ id: 'mock-doc' }),
      });

      const res = await updateDealField(
        'deal-1',
        'budget',
        75000,
        0.9, // above accept threshold
        'customer',
        3,
        'org-acme',
      );

      assert.strictEqual(res.updated, true);
      assert.strictEqual(transactionCommitted, true);
    },
  );
});
