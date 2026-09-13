import * as crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { HttpError } from './auth';

export function secureEqual(left?: string | null, right?: string | null): boolean {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyAgoraWebhook(req: Request, _res: Response, next: NextFunction): void {
  const expected = process.env.AGORA_LLM_WEBHOOK_SECRET;
  const header = req.get('authorization');
  const supplied = typeof header === 'string' && header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied || !secureEqual(supplied, expected)) {
    return next(new HttpError(401, 'Unauthorized webhook'));
  }
  next();
}
