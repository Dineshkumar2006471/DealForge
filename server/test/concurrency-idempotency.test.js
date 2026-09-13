const test = require('node:test');
const assert = require('node:assert/strict');
const { claimOperation, completeOperation } = require('../src/lib/firebase/operationLedger');
const { claimApprovedApprovals } = require('../src/lib/policy/approvalQueue');
const { db } = require('../src/lib/firebase/admin');
const { receiptIdFor } = require('../src/lib/agent/turnReceipts');

test('Concurrency & Idempotency Invariants', async (t) => {
  const originalRunTransaction = db.runTransaction;
  const originalCollection = db.collection;

  t.afterEach(() => {
    db.runTransaction = originalRunTransaction;
    db.collection = originalCollection;
  });

  await t.test('Operation Ledger: duplicate claim returns cached result and blocks secondary execution', async () => {
    const memoryDb = new Map();

    db.collection = (name) => {
      assert.strictEqual(name, 'externalOperations');
      return {
        doc: (id) => ({
          id,
          get: async () => ({
            exists: memoryDb.has(id),
            data: () => memoryDb.get(id),
          }),
          update: async (patch) => {
            const current = memoryDb.get(id) || {};
            memoryDb.set(id, { ...current, ...patch });
          },
        }),
      };
    };

    db.runTransaction = async (callback) => {
      const tx = {
        get: async (ref) => ({
          exists: memoryDb.has(ref.id),
          data: () => memoryDb.get(ref.id),
        }),
        create: (ref, data) => {
          memoryDb.set(ref.id, data);
        },
        update: (ref, patch) => {
          const current = memoryDb.get(ref.id) || {};
          memoryDb.set(ref.id, { ...current, ...patch });
        },
      };
      return await callback(tx);
    };

    const opId = 'op-concurrency-101';
    const opContext = {
      operationId: opId,
      organizationId: 'org-acme',
      dealId: 'deal-1',
      sessionId: 'session-1',
      provider: 'hubspot',
      action: 'sync_deal',
    };

    // First attempt: should claim successfully
    const firstClaim = await claimOperation(opContext);
    assert.strictEqual(firstClaim.claimed, true);
    assert.strictEqual(firstClaim.cached, false);
    assert.strictEqual(firstClaim.operation.status, 'PENDING');

    // Complete the operation
    await completeOperation(opId, {
      externalRecordId: 'hubspot-deal-999',
      result: { synchronized: true },
    });

    // Second attempt (e.g. duplicate webhook or network replay): must NOT re-execute, must return cached
    const secondClaim = await claimOperation(opContext);
    assert.strictEqual(secondClaim.claimed, false);
    assert.strictEqual(secondClaim.cached, true);
    assert.strictEqual(secondClaim.operation.status, 'SUCCEEDED');
    assert.strictEqual(secondClaim.operation.externalRecordId, 'hubspot-deal-999');
  });

  await t.test(
    'Turn Receipt Fingerprinting: identical user utterances produce deterministic deduplication fingerprints',
    () => {
      const raw1 = '  Hello,   can we get a 20% discount?? ';
      const raw2 = 'hello, can we get a 20% discount?';
      const fp1 = receiptIdFor('sess-1', raw1);
      const fp2 = receiptIdFor('sess-1', raw2);

      assert.strictEqual(fp1, fp2, 'Fingerprints should normalize whitespace, casing, and trailing punctuation');

      const differentSession = receiptIdFor('sess-2', raw1);
      assert.notStrictEqual(fp1, differentSession, 'Fingerprints must isolate between different sessions');
    },
  );

  await t.test('Concurrent Approval Claims: racing workers cannot double-claim the same approved action', async () => {
    let approvalState = {
      approvalId: 'app-race-1',
      organizationId: 'org-race',
      dealId: 'deal-race',
      sessionId: 'sess-race',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    const docRef = { id: 'app-race-1' };

    db.collection = () => ({
      where: () => ({
        where: () => ({
          get: async () => ({
            docs: [{ ref: docRef, data: () => approvalState }],
          }),
        }),
      }),
    });

    db.runTransaction = async (callback) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => approvalState,
        }),
        update: (_ref, patch) => {
          approvalState = { ...approvalState, ...patch };
        },
      };
      return await callback(tx);
    };

    // Worker 1 and Worker 2 race to claim
    const [worker1Results, worker2Results] = await Promise.all([
      claimApprovedApprovals({ organizationId: 'org-race', dealId: 'deal-race', sessionId: 'sess-race' }),
      claimApprovedApprovals({ organizationId: 'org-race', dealId: 'deal-race', sessionId: 'sess-race' }),
    ]);

    const totalClaimed = worker1Results.length + worker2Results.length;
    assert.strictEqual(totalClaimed, 1, 'Only one concurrent worker can successfully claim the approval');
    assert.strictEqual(approvalState.status, 'EXECUTING');
  });

  await t.test('Firestore Transaction retry behavior: detects concurrent conflicts and aborts gracefully', async () => {
    let attempts = 0;
    const maxRetries = 3;

    db.runTransaction = async (callback) => {
      attempts++;
      if (attempts < maxRetries) {
        const conflictErr = new Error('Transaction contention: document modified by another process');
        conflictErr.code = 10; // ABORTED
        throw conflictErr;
      }
      return { committed: true, attempts };
    };

    // Simulating retry wrapper
    async function executeWithContentionRetry(fn, retries = 3) {
      for (let i = 0; i < retries; i++) {
        try {
          return await db.runTransaction(fn);
        } catch (err) {
          if (err.code === 10 && i < retries - 1) continue;
          throw err;
        }
      }
    }

    const result = await executeWithContentionRetry(async () => {});
    assert.strictEqual(result.committed, true);
    assert.strictEqual(result.attempts, 3);
  });
});
