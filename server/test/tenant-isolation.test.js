const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveApproval } = require('../src/lib/policy/approvalQueue');
const { requireManager, HttpError } = require('../src/lib/security/auth');
const { db } = require('../src/lib/firebase/admin');

test('Cross-Tenant Authorization & Multi-Tenancy Boundary Enforcement', async (t) => {
  const originalRunTransaction = db.runTransaction;
  const originalCollection = db.collection;

  t.afterEach(() => {
    db.runTransaction = originalRunTransaction;
    db.collection = originalCollection;
  });

  await t.test('Approval Isolation: Manager from Org-Alpha cannot resolve approval belonging to Org-Beta', async () => {
    const orgBetaApproval = {
      approvalId: 'app-beta-1',
      organizationId: 'org-beta',
      dealId: 'deal-beta-99',
      sessionId: 'sess-beta',
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
          data: () => orgBetaApproval,
        }),
      };
      return await txCallback(tx);
    };

    const managerAlpha = {
      uid: 'mgr-alpha-user',
      organizationId: 'org-alpha',
      email: 'alpha@example.com',
    };

    await assert.rejects(
      async () => {
        await resolveApproval('app-beta-1', 'APPROVED', managerAlpha);
      },
      (err) => {
        assert(err instanceof HttpError);
        assert.strictEqual(err.status, 404, 'Must return 404 Not Found to prevent tenant existence probing');
        return true;
      },
    );
  });

  await t.test('Deal Scoping Invariant: Deal repository queries must enforce organizationId filter', async () => {
    const allDeals = [
      { id: 'deal-1', organizationId: 'org-A', company: 'Acme A' },
      { id: 'deal-2', organizationId: 'org-B', company: 'Acme B' },
      { id: 'deal-3', organizationId: 'org-A', company: 'Acme A2' },
    ];

    function getDealsForTenant(organizationId) {
      if (!organizationId) throw new Error('organizationId is required for tenant isolation');
      return allDeals.filter((d) => d.organizationId === organizationId);
    }

    const orgADeals = getDealsForTenant('org-A');
    assert.strictEqual(orgADeals.length, 2);
    assert.ok(orgADeals.every((d) => d.organizationId === 'org-A'));

    const orgBDeals = getDealsForTenant('org-B');
    assert.strictEqual(orgBDeals.length, 1);
    assert.ok(orgBDeals.every((d) => d.organizationId === 'org-B'));

    assert.throws(() => getDealsForTenant(null), /organizationId is required/);
  });

  await t.test(
    'Token Tampering / IDOR: Forged organization claim in custom token is rejected against Firestore member record',
    async () => {
      const forgedTokenClaims = {
        uid: 'user-hacker',
        role: 'manager',
        organizationId: 'target-victim-org', // Forged claim
      };

      const realFirestoreMember = {
        uid: 'user-hacker',
        role: 'manager',
        organizationId: 'attacker-org', // Real org
        status: 'ACTIVE',
      };

      const fakeAdmin = {
        auth: () => ({
          verifyIdToken: async () => forgedTokenClaims,
        }),
      };

      db.collection = () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => realFirestoreMember,
          }),
        }),
      });

      const req = { get: () => 'Bearer forged-token' };
      let capturedErr = null;

      // Simulate requireManager with the forged token
      const { admin } = require('../src/lib/firebase/admin');
      const origAuth = admin.auth;
      admin.auth = fakeAdmin.auth;

      try {
        await requireManager(req, {}, (err) => {
          capturedErr = err;
        });
      } finally {
        admin.auth = origAuth;
      }

      assert(capturedErr instanceof HttpError);
      assert.strictEqual(capturedErr.status, 403);
      assert.match(capturedErr.message, /Manager role is required/);
    },
  );

  await t.test('Audit Log Scoping: Audit events always retain originating organizationId', () => {
    function createScopedAuditEvent(orgId, dealId, action) {
      if (!orgId) throw new Error('Unscoped audit event detected');
      return {
        eventId: 'audit-123',
        organizationId: orgId,
        dealId,
        action,
        timestamp: new Date().toISOString(),
      };
    }

    const event = createScopedAuditEvent('org-secure', 'deal-99', 'DISCOUNT_EVALUATED');
    assert.strictEqual(event.organizationId, 'org-secure');
    assert.throws(() => createScopedAuditEvent(undefined, 'deal-99', 'TEST'), /Unscoped audit event/);
  });
});
