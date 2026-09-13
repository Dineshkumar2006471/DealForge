const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/lib/firebase/admin');
const { storeEvidence, getEvidenceForDeal, getEvidenceChain } = require('../src/lib/evidence/evidenceStore');

test('Evidence Store Invariants & Chain Queries', async (t) => {
  const originalCollection = db.collection;

  t.afterEach(() => {
    db.collection = originalCollection;
  });

  await t.test('storeEvidence creates record with uuid and returns complete entity', async () => {
    const memory = new Map();
    db.collection = (colName) => {
      assert.strictEqual(colName, 'evidence');
      return {
        doc: (id) => ({
          set: async (data) => {
            memory.set(id, data);
          },
        }),
      };
    };

    const evidence = await storeEvidence({
      organizationId: 'org-test',
      dealId: 'deal-456',
      sessionId: 'sess-789',
      claim: 'Customer budget is $50,000/yr',
      utteranceTurn: 3,
      confidence: 0.95,
      source: 'customer_statement',
      dealStateField: 'budget',
    });

    assert.ok(evidence.evidenceId);
    assert.strictEqual(evidence.organizationId, 'org-test');
    assert.strictEqual(evidence.dealId, 'deal-456');
    assert.strictEqual(evidence.dealStateField, 'budget');
    assert.strictEqual(evidence.confidence, 0.95);
    assert.strictEqual(memory.size, 1);
  });

  await t.test('getEvidenceForDeal retrieves all evidence ordered by timestamp', async () => {
    const sampleDocs = [
      { id: 'ev-1', data: () => ({ claim: 'Team size 200', timestamp: '2026-09-13T10:00:00Z' }) },
      { id: 'ev-2', data: () => ({ claim: 'Budget 50k', timestamp: '2026-09-13T10:05:00Z' }) },
    ];

    db.collection = () => ({
      where: (field, op, val) => {
        assert.strictEqual(field, 'dealId');
        assert.strictEqual(op, '==');
        assert.strictEqual(val, 'deal-456');
        return {
          orderBy: (orderField, dir) => {
            assert.strictEqual(orderField, 'timestamp');
            assert.strictEqual(dir, 'asc');
            return {
              get: async () => ({ docs: sampleDocs }),
            };
          },
        };
      },
    });

    const result = await getEvidenceForDeal('deal-456');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, 'ev-1');
    assert.strictEqual(result[0].claim, 'Team size 200');
    assert.strictEqual(result[1].id, 'ev-2');
  });

  await t.test('getEvidenceChain filters for specific dealStateField', async () => {
    const sampleChain = [
      {
        id: 'ev-10',
        data: () => ({ claim: 'Mentioned 50 seats', dealStateField: 'teamSize', timestamp: '2026-09-13T10:00:00Z' }),
      },
    ];

    db.collection = () => ({
      where: (f1, o1, v1) => ({
        where: (f2, o2, v2) => {
          assert.strictEqual(f2, 'dealStateField');
          assert.strictEqual(v2, 'teamSize');
          return {
            orderBy: () => ({
              get: async () => ({ docs: sampleChain }),
            }),
          };
        },
      }),
    });

    const chain = await getEvidenceChain('deal-456', 'teamSize');
    assert.strictEqual(chain.length, 1);
    assert.strictEqual(chain[0].claim, 'Mentioned 50 seats');
  });
});
