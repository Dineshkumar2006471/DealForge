const test = require('node:test');
const assert = require('node:assert/strict');
const { admin, db } = require('../src/lib/firebase/admin');
const { requireManager, HttpError } = require('../src/lib/security/auth');

test('requireManager middleware tests', async (t) => {
  const originalAuth = admin.auth;
  const originalCollection = db.collection;

  t.afterEach(() => {
    admin.auth = originalAuth;
    db.collection = originalCollection;
  });

  await t.test('rejects request with missing Authorization header', async () => {
    const req = { get: () => null };
    let capturedError = null;
    await requireManager(req, {}, (err) => {
      capturedError = err;
    });
    assert(capturedError instanceof HttpError);
    assert.strictEqual(capturedError.status, 401);
    assert.match(capturedError.message, /Missing Firebase ID token/);
  });

  await t.test('rejects request with non-Bearer Authorization header', async () => {
    const req = { get: () => 'Basic dXNlcjpwYXNz' };
    let capturedError = null;
    await requireManager(req, {}, (err) => {
      capturedError = err;
    });
    assert(capturedError instanceof HttpError);
    assert.strictEqual(capturedError.status, 401);
    assert.match(capturedError.message, /Missing Firebase ID token/);
  });

  await t.test('rejects request when verifyIdToken throws (expired/invalid)', async () => {
    admin.auth = () => ({
      verifyIdToken: async () => {
        const err = new Error('Token expired');
        err.code = 'auth/id-token-expired';
        throw err;
      },
    });

    const req = { get: () => 'Bearer expired-token-123' };
    let capturedError = null;
    await requireManager(req, {}, (err) => {
      capturedError = err;
    });
    assert(capturedError instanceof HttpError);
    assert.strictEqual(capturedError.status, 401);
    assert.match(capturedError.message, /Invalid Firebase ID token/);
  });

  await t.test('rejects when member record does not exist in Firestore', async () => {
    admin.auth = () => ({
      verifyIdToken: async () => ({ uid: 'user-1', role: 'manager', organizationId: 'org-acme' }),
    });

    db.collection = (name) => {
      assert.strictEqual(name, 'members');
      return {
        doc: (id) => {
          assert.strictEqual(id, 'user-1');
          return {
            get: async () => ({ exists: false }),
          };
        },
      };
    };

    const req = { get: () => 'Bearer valid-token' };
    let capturedError = null;
    await requireManager(req, {}, (err) => {
      capturedError = err;
    });
    assert(capturedError instanceof HttpError);
    assert.strictEqual(capturedError.status, 403);
    assert.match(capturedError.message, /Manager membership not found/);
  });

  await t.test('rejects when member role is not manager', async () => {
    admin.auth = () => ({
      verifyIdToken: async () => ({ uid: 'user-1', role: 'viewer', organizationId: 'org-acme' }),
    });

    db.collection = () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ role: 'viewer', organizationId: 'org-acme', status: 'ACTIVE' }),
        }),
      }),
    });

    const req = { get: () => 'Bearer valid-token' };
    let capturedError = null;
    await requireManager(req, {}, (err) => {
      capturedError = err;
    });
    assert(capturedError instanceof HttpError);
    assert.strictEqual(capturedError.status, 403);
    assert.match(capturedError.message, /Manager role is required/);
  });

  await t.test('rejects when organizationId in token does not match member record (cross-tenant spoof)', async () => {
    admin.auth = () => ({
      verifyIdToken: async () => ({ uid: 'user-1', role: 'manager', organizationId: 'org-other' }),
    });

    db.collection = () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ role: 'manager', organizationId: 'org-acme', status: 'ACTIVE' }),
        }),
      }),
    });

    const req = { get: () => 'Bearer valid-token' };
    let capturedError = null;
    await requireManager(req, {}, (err) => {
      capturedError = err;
    });
    assert(capturedError instanceof HttpError);
    assert.strictEqual(capturedError.status, 403);
    assert.match(capturedError.message, /Manager role is required/);
  });

  await t.test('rejects when member status is INACTIVE', async () => {
    admin.auth = () => ({
      verifyIdToken: async () => ({ uid: 'user-1', role: 'manager', organizationId: 'org-acme' }),
    });

    db.collection = () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ role: 'manager', organizationId: 'org-acme', status: 'SUSPENDED' }),
        }),
      }),
    });

    const req = { get: () => 'Bearer valid-token' };
    let capturedError = null;
    await requireManager(req, {}, (err) => {
      capturedError = err;
    });
    assert(capturedError instanceof HttpError);
    assert.strictEqual(capturedError.status, 403);
    assert.match(capturedError.message, /Manager membership is inactive/);
  });

  await t.test('authenticates valid manager and sets req.manager context', async () => {
    admin.auth = () => ({
      verifyIdToken: async () => ({
        uid: 'user-manager-1',
        email: 'lead@acme.com',
        role: 'manager',
        organizationId: 'org-acme',
      }),
    });

    db.collection = () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ role: 'manager', organizationId: 'org-acme', status: 'ACTIVE' }),
        }),
      }),
    });

    const req = { get: () => 'Bearer valid-manager-token' };
    let capturedError = null;
    await requireManager(req, {}, (err) => {
      capturedError = err;
    });
    assert.strictEqual(capturedError, undefined);
    assert.deepStrictEqual(req.manager, {
      uid: 'user-manager-1',
      organizationId: 'org-acme',
      email: 'lead@acme.com',
    });
  });
});
