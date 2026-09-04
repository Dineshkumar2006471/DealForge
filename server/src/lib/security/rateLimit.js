const crypto = require('crypto');
const { admin, db } = require('../firebase/admin');
const { HttpError } = require('./auth');

function fingerprint(request) {
  return crypto.createHash('sha256').update(String(request.ip || request.socket?.remoteAddress || 'unknown')).digest('hex');
}

function windowStart(now, windowMs) {
  return Math.floor(now / windowMs) * windowMs;
}

function createRateLimit({ scope, limit, windowMs, store = db, now = () => Date.now() }) {
  if (!scope || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1000) throw new Error('Invalid rate limit configuration');
  return async (req, res, next) => {
    const start = windowStart(now(), windowMs);
    const resetAt = start + windowMs;
    const reference = store.collection('rateLimitWindows').doc(`${scope}-${fingerprint(req)}-${start}`);
    try {
      let remaining;
      await store.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        const count = snapshot.exists ? Number(snapshot.data().count || 0) : 0;
        if (count >= limit) throw new HttpError(429, 'Too many requests. Please try again shortly.');
        const record = { scope, count: count + 1, windowStartedAt: admin.firestore.Timestamp.fromMillis(start), expireAt: admin.firestore.Timestamp.fromMillis(resetAt + windowMs) };
        if (snapshot.exists) transaction.update(reference, record); else transaction.create(reference, record);
        remaining = limit - record.count;
      });
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      next();
    } catch (error) { next(error); }
  };
}

module.exports = { createRateLimit, fingerprint, windowStart };
