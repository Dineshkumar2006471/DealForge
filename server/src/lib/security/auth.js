const { admin, db } = require('../firebase/admin');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function bearerToken(header) {
  const match = typeof header === 'string' && header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireManager(req, _res, next) {
  try {
    const token = bearerToken(req.get('authorization'));
    if (!token) throw new HttpError(401, 'Missing Firebase ID token');
    const decoded = await admin.auth().verifyIdToken(token, true);
    const memberDoc = await db.collection('members').doc(decoded.uid).get();
    if (!memberDoc.exists) throw new HttpError(403, 'Manager membership not found');
    const member = memberDoc.data();
    if (member.role !== 'manager' || !member.organizationId || decoded.organizationId !== member.organizationId || decoded.role !== 'manager') {
      throw new HttpError(403, 'Manager role is required');
    }
    if (member.status && member.status !== 'ACTIVE') throw new HttpError(403, 'Manager membership is inactive');
    req.manager = { uid: decoded.uid, organizationId: member.organizationId, email: decoded.email || null };
    next();
  } catch (error) {
    // Preserve a generic 401 response so callers never learn token-verification
    // internals. Log only the Firebase error classification—never the bearer token,
    // decoded claims, or request body—so staging failures can be diagnosed safely.
    if (!(error instanceof HttpError)) {
      console.warn('Firebase ID token verification failed', {
        code: error.code || 'unknown',
        message: error.message || 'No error message available',
      });
    }
    next(error instanceof HttpError ? error : new HttpError(401, 'Invalid Firebase ID token'));
  }
}

module.exports = { HttpError, requireManager, bearerToken };
