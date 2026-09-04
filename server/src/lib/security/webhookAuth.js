const crypto = require('crypto');
const { HttpError } = require('./auth');

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyAgoraWebhook(req, _res, next) {
  const expected = process.env.AGORA_LLM_WEBHOOK_SECRET;
  const header = req.get('authorization');
  const supplied = typeof header === 'string' && header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied || !secureEqual(supplied, expected)) return next(new HttpError(401, 'Unauthorized webhook'));
  next();
}

module.exports = { secureEqual, verifyAgoraWebhook };
