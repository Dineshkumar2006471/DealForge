const crypto = require('crypto');
const { admin, db } = require('../firebase/admin');
const { HttpError } = require('./auth');

function fingerprint(request) {
  return crypto
    .createHash('sha256')
    .update(String(request.ip || request.socket?.remoteAddress || 'unknown'))
    .digest('hex');
}

function windowStart(now, windowMs) {
  return Math.floor(now / windowMs) * windowMs;
}

const fallbackMemory = new Map();

function inMemoryRateLimit(scope, ipHash, start, limit, windowMs) {
  const key = `${scope}-${ipHash}-${start}`;
  const count = (fallbackMemory.get(key) || 0) + 1;
  fallbackMemory.set(key, count);
  if (fallbackMemory.size > 5000) {
    const cutoff = Date.now() - windowMs * 2;
    for (const [k] of fallbackMemory.entries()) {
      const parts = k.split('-');
      const ts = Number(parts[parts.length - 1]);
      if (ts < cutoff) fallbackMemory.delete(k);
    }
  }
  return { count, remaining: Math.max(0, limit - count) };
}

function hasFirestoreCredentials() {
  return Boolean(
    process.env.K_SERVICE || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIRESTORE_EMULATOR_HOST,
  );
}

function createRateLimit({ scope, limit, windowMs, store = db, now = () => Date.now() }) {
  if (!scope || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1000) {
    throw new Error('Invalid rate limit configuration');
  }
  return async (req, res, next) => {
    const start = windowStart(now(), windowMs);
    const resetAt = start + windowMs;

    // In unit tests or CI where Firestore is not configured or emulator is not running,
    // immediately use in-memory rate limiter to avoid initiating failed gRPC auth requests.
    if (store === db && !hasFirestoreCredentials()) {
      const mem = inMemoryRateLimit(scope, fingerprint(req), start, limit, windowMs);
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(mem.remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      if (mem.count > limit) {
        return next(new HttpError(429, 'Too many requests. Please try again shortly.'));
      }
      return next();
    }

    const reference = store.collection('rateLimitWindows').doc(`${scope}-${fingerprint(req)}-${start}`);
    try {
      let remaining;
      await store.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const count = snapshot.exists ? Number(snapshot.data().count || 0) : 0;
        if (count >= limit) throw new HttpError(429, 'Too many requests. Please try again shortly.');
        const record = {
          scope,
          count: count + 1,
          windowStartedAt: admin.firestore.Timestamp.fromMillis(start),
          expireAt: admin.firestore.Timestamp.fromMillis(resetAt + windowMs),
        };
        if (snapshot.exists) transaction.update(reference, record);
        else transaction.create(reference, record);
        remaining = limit - record.count;
      });
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      next();
    } catch (error) {
      if (error instanceof HttpError) return next(error);
      const mem = inMemoryRateLimit(scope, fingerprint(req), start, limit, windowMs);
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(mem.remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      if (mem.count > limit) {
        return next(new HttpError(429, 'Too many requests. Please try again shortly.'));
      }
      next();
    }
  };
}

module.exports = { createRateLimit, fingerprint, windowStart };
