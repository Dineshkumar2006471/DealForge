const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/lib/firebase/admin');
const {
  createApproval,
  resolveApproval,
  claimApprovedApprovals,
  completeApproval,
  releaseApproval,
} = require('../src/lib/policy/approvalQueue');
const { HttpError } = require('../src/lib/security/auth');

test('Approval Queue & State Machine Integration', async (t) => {
  const originalRunTransaction = db.runTransaction;
  const originalCollection = db.collection;

  t.afterEach(() => {
    db.runTransaction = originalRunTransaction;
    db.collection = originalCollection;
  });

  await t.test('createApproval creates pending approval record and audit event', async () => {
    const store = new Map();
    db.collection = (colName) => ({
      doc: (id) => ({
        id,
        colName,
        path: `${colName}/${id}`,
      }),
    });

    db.runTransaction = async (txCallback) => {
      const tx = {
        create: (ref, data) => {
          store.set(ref.path, data);
        },
      };
      return await txCallback(tx);
    };

    const approval = await createApproval({
      organizationId: 'org-1',
      dealId: 'deal-100',
      sessionId: 'sess-abc',
      toolName: 'calculate_discount',
      validatedArgs: { requested_pct: 20 },
      requestedBy: 'assistant',
      policyReason: 'Discount exceeds 18%',
    });

    assert.strictEqual(approval.organizationId, 'org-1');
    assert.strictEqual(approval.dealId, 'deal-100');
    assert.strictEqual(approval.status, 'PENDING');
    assert.strictEqual(approval.exactToolName, 'calculate_discount');
    assert.strictEqual(store.size, 2); // 1 approval + 1 auditEvent
  });

  await t.test('resolveApproval successfully approves pending approval', async () => {
    const docData = {
      approvalId: 'app-1',
      organizationId: 'org-1',
      dealId: 'deal-1',
      sessionId: 'sess-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    let updated = null;
    let auditCreated = null;

    db.collection = () => ({
      doc: (id) => ({ id, path: `approvals/${id}` }),
    });

    db.runTransaction = async (txCallback) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => docData,
        }),
        update: (_ref, data) => {
          updated = data;
        },
        create: (_ref, data) => {
          auditCreated = data;
        },
      };
      return await txCallback(tx);
    };

    const res = await resolveApproval('app-1', 'APPROVED', { uid: 'mgr-1', organizationId: 'org-1' });
    assert.strictEqual(res.status, 'APPROVED');
    assert.strictEqual(updated.status, 'APPROVED');
    assert.strictEqual(updated.resolvedBy, 'mgr-1');
    assert.strictEqual(auditCreated.eventType, 'APPROVAL_RESOLVED');
  });

  await t.test('resolveApproval throws 404 on cross-tenant resolution attempt', async () => {
    const docData = {
      approvalId: 'app-1',
      organizationId: 'org-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    db.collection = () => ({
      doc: (id) => ({ id, path: `approvals/${id}` }),
    });

    db.runTransaction = async (txCallback) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => docData,
        }),
      };
      return await txCallback(tx);
    };

    await assert.rejects(
      async () => {
        await resolveApproval('app-1', 'APPROVED', { uid: 'mgr-rogue', organizationId: 'org-OTHER' });
      },
      (err) => err instanceof HttpError && err.status === 404,
    );
  });

  await t.test('resolveApproval throws 410 on expired approval', async () => {
    const docData = {
      approvalId: 'app-1',
      organizationId: 'org-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 60000).toISOString(), // Expired
    };

    db.collection = () => ({
      doc: (id) => ({ id, path: `approvals/${id}` }),
    });

    db.runTransaction = async (txCallback) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => docData,
        }),
        update: () => {},
      };
      return await txCallback(tx);
    };

    await assert.rejects(
      async () => {
        await resolveApproval('app-1', 'APPROVED', { uid: 'mgr-1', organizationId: 'org-1' });
      },
      (err) => err instanceof HttpError && err.status === 410,
    );
  });

  await t.test('claimApprovedApprovals claims matching approval and sets status to EXECUTING', async () => {
    const approval = {
      approvalId: 'app-claim-1',
      organizationId: 'org-1',
      dealId: 'deal-1',
      sessionId: 'sess-1',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    let updated = null;
    const ref = { id: 'app-claim-1' };

    db.collection = () => ({
      where: () => ({
        where: () => ({
          get: async () => ({
            docs: [{ ref, data: () => approval }],
          }),
        }),
      }),
    });

    db.runTransaction = async (txCallback) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => approval,
        }),
        update: (_ref, data) => {
          updated = data;
        },
      };
      return await txCallback(tx);
    };

    const claimed = await claimApprovedApprovals({
      organizationId: 'org-1',
      dealId: 'deal-1',
      sessionId: 'sess-1',
    });

    assert.strictEqual(claimed.length, 1);
    assert.strictEqual(claimed[0].approvalId, 'app-claim-1');
    assert.strictEqual(updated.status, 'EXECUTING');
    assert.ok(updated.executionStartedAt);
  });

  await t.test('completeApproval marks executing approval as CONSUMED', async () => {
    const approval = {
      approvalId: 'app-exec-1',
      organizationId: 'org-1',
      status: 'EXECUTING',
    };

    let updated = null;
    db.collection = () => ({
      doc: (id) => ({ id }),
    });

    db.runTransaction = async (txCallback) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => approval,
        }),
        update: (_ref, data) => {
          updated = data;
        },
      };
      return await txCallback(tx);
    };

    await completeApproval('app-exec-1', 'org-1');
    assert.strictEqual(updated.status, 'CONSUMED');
    assert.ok(updated.consumedAt);
  });

  await t.test('releaseApproval rolls EXECUTING back to APPROVED on execution failure', async () => {
    const approval = {
      approvalId: 'app-fail-1',
      organizationId: 'org-1',
      status: 'EXECUTING',
    };

    let updated = null;
    db.collection = () => ({
      doc: (id) => ({ id }),
    });

    db.runTransaction = async (txCallback) => {
      const tx = {
        get: async () => ({
          exists: true,
          data: () => approval,
        }),
        update: (_ref, data) => {
          updated = data;
        },
      };
      return await txCallback(tx);
    };

    await releaseApproval('app-fail-1', 'org-1', new Error('HubSpot timeout'));
    assert.strictEqual(updated.status, 'APPROVED');
    assert.match(updated.lastExecutionError, /HubSpot timeout/);
  });
});
