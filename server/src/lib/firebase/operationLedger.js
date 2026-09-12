/**
 * External Operation Ledger
 *
 * Provides idempotent operation tracking for external integrations (Cal.com, HubSpot).
 * Every external operation is recorded with a unique operationId. If a retry arrives
 * with the same operationId, the cached result is returned instead of creating a
 * duplicate external record.
 *
 * Schema: {
 *   operationId, organizationId, dealId, sessionId,
 *   provider, action, requestId, idempotencyKey,
 *   status: 'PENDING' | 'SUCCEEDED' | 'FAILED',
 *   startedAt, completedAt,
 *   externalRecordId, externalUrl,
 *   error, result
 * }
 */
const { db } = require('./admin');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * Generate a deterministic operation ID from session, action, and request context.
 * This ensures the same logical operation always maps to the same operationId.
 */
function generateOperationId(sessionId, provider, action, requestId) {
  const input = `${sessionId}:${provider}:${action}:${requestId}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 32);
}

/**
 * Attempt to claim an operation. If the operation already exists and has SUCCEEDED,
 * returns the cached result. If it's PENDING or FAILED, allows retry.
 *
 * @returns {{ claimed: boolean, cached: boolean, operation: object }}
 */
async function claimOperation({ operationId, organizationId, dealId, sessionId, provider, action, requestId, idempotencyKey }) {
  const ref = db.collection('externalOperations').doc(operationId);

  return await db.runTransaction(async tx => {
    const doc = await tx.get(ref);

    if (doc.exists) {
      const existing = doc.data();

      // Already succeeded — return cached result, do NOT retry
      if (existing.status === 'SUCCEEDED') {
        return {
          claimed: false,
          cached: true,
          operation: existing
        };
      }

      // PENDING or FAILED — allow retry by updating status back to PENDING
      tx.update(ref, {
        status: 'PENDING',
        startedAt: new Date().toISOString(),
        error: null
      });
      return {
        claimed: true,
        cached: false,
        operation: { ...existing, status: 'PENDING', startedAt: new Date().toISOString() }
      };
    }

    // New operation
    const operation = {
      operationId,
      organizationId,
      dealId,
      sessionId,
      provider,
      action,
      requestId: requestId || uuidv4(),
      idempotencyKey: idempotencyKey || operationId,
      status: 'PENDING',
      startedAt: new Date().toISOString(),
      completedAt: null,
      externalRecordId: null,
      externalUrl: null,
      error: null,
      result: null
    };

    tx.create(ref, operation);
    return {
      claimed: true,
      cached: false,
      operation
    };
  });
}

/**
 * Mark an operation as successfully completed.
 */
async function completeOperation(operationId, { externalRecordId, externalUrl, result } = {}) {
  const ref = db.collection('externalOperations').doc(operationId);
  await ref.update({
    status: 'SUCCEEDED',
    completedAt: new Date().toISOString(),
    externalRecordId: externalRecordId || null,
    externalUrl: externalUrl || null,
    result: result || null
  });
}

/**
 * Mark an operation as failed.
 */
async function failOperation(operationId, error) {
  const ref = db.collection('externalOperations').doc(operationId);
  await ref.update({
    status: 'FAILED',
    completedAt: new Date().toISOString(),
    error: typeof error === 'string' ? error : (error?.message || String(error))
  });
}

/**
 * Retrieve an operation by ID.
 */
async function getOperation(operationId) {
  const doc = await db.collection('externalOperations').doc(operationId).get();
  return doc.exists ? doc.data() : null;
}

module.exports = { generateOperationId, claimOperation, completeOperation, failOperation, getOperation };
