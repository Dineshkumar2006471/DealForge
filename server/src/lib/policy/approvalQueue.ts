import { v4 as uuidv4 } from 'uuid';
import { HttpError } from '../security/auth';
import { resolveTransition, claimTransition, completionTransition } from './approvalStateMachine';
import type { ApprovalRequest } from '../../types/domain';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { db } = require('../firebase/admin') as { db: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { EVENT_TYPES } = require('../audit/eventTypes') as { EVENT_TYPES: any };

export interface CreateApprovalParams {
  organizationId: string;
  dealId: string;
  sessionId?: string | null;
  toolName: string;
  validatedArgs: Record<string, unknown>;
  requestedBy: string;
  policyReason: string;
}

export async function createApproval({
  organizationId,
  dealId,
  sessionId,
  toolName,
  validatedArgs,
  requestedBy,
  policyReason,
}: CreateApprovalParams): Promise<ApprovalRequest> {
  const approvalId = uuidv4();
  const createdAt = new Date().toISOString();
  const approval: ApprovalRequest = {
    approvalId,
    organizationId,
    sessionId: sessionId || null,
    dealId,
    exactToolName: toolName,
    exactValidatedArguments: validatedArgs,
    requestedBy,
    status: 'PENDING',
    policyReason,
    createdAt,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    consumedAt: null,
  };
  const auditRef = db.collection('auditEvents').doc(uuidv4());
  await db.runTransaction(async (tx: any) => {
    tx.create(db.collection('approvals').doc(approvalId), approval);
    tx.create(auditRef, {
      organizationId,
      dealId,
      sessionId,
      eventType: EVENT_TYPES.APPROVAL_REQUESTED,
      trigger: `${toolName} requires manager approval`,
      policyResult: { tier: 'APPROVAL', allowed: false, reason: policyReason },
      timestamp: createdAt,
    });
  });
  return approval;
}

export async function resolveApproval(
  approvalId: string,
  decision: string,
  manager: { uid: string; organizationId: string },
): Promise<{ approvalId: string; status: string }> {
  const ref = db.collection('approvals').doc(approvalId);
  const auditRef = db.collection('auditEvents').doc(uuidv4());
  let output: { approvalId: string; status: string; expired?: boolean } = { approvalId, status: decision };
  await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new HttpError(404, 'Approval not found');
    const approval = doc.data();
    const timestamp = new Date().toISOString();
    if (approval.organizationId !== manager.organizationId) throw new HttpError(404, 'Approval not found');
    let next: string;
    try {
      next = resolveTransition(approval.status, new Date(approval.expiresAt) <= new Date(), decision);
    } catch (error: any) {
      throw new HttpError(409, error.message);
    }
    if (next === 'EXPIRED') {
      tx.update(ref, { status: next, resolvedAt: timestamp });
      output = { approvalId, status: next, expired: true };
      return;
    }
    tx.update(ref, { status: next, resolvedAt: timestamp, resolvedBy: manager.uid });
    tx.create(auditRef, {
      organizationId: approval.organizationId,
      dealId: approval.dealId,
      sessionId: approval.sessionId,
      eventType: EVENT_TYPES.APPROVAL_RESOLVED,
      trigger: `Manager ${decision.toLowerCase()} approval`,
      actionResult: { approvalId, status: decision },
      timestamp,
    });
    output = { approvalId, status: decision };
  });
  if (output.expired) throw new HttpError(410, 'Approval has expired');
  return output;
}

export async function claimApprovedApprovals({
  organizationId,
  dealId,
  sessionId,
}: {
  organizationId: string;
  dealId: string;
  sessionId?: string | null;
}): Promise<any[]> {
  const snapshot = await db
    .collection('approvals')
    .where('sessionId', '==', sessionId)
    .where('status', '==', 'APPROVED')
    .get();
  const claimed: any[] = [];
  for (const doc of snapshot.docs) {
    await db.runTransaction(async (tx: any) => {
      const current = await tx.get(doc.ref);
      if (!current.exists) return;
      const approval = current.data();
      const timestamp = new Date().toISOString();
      if (approval.organizationId !== organizationId || approval.dealId !== dealId || approval.status !== 'APPROVED') {
        return;
      }
      const next = claimTransition(approval.status, new Date(approval.expiresAt) <= new Date());
      if (next === 'EXPIRED') {
        tx.update(doc.ref, { status: next, resolvedAt: timestamp });
        return;
      }
      if (!next) return;
      tx.update(doc.ref, { status: next, executionStartedAt: timestamp });
      claimed.push(approval);
    });
  }
  return claimed;
}

export async function completeApproval(approvalId: string, organizationId: string): Promise<void> {
  const ref = db.collection('approvals').doc(approvalId);
  await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().organizationId !== organizationId) throw new Error('Approval cannot be completed');
    tx.update(ref, { status: completionTransition(doc.data().status, true), consumedAt: new Date().toISOString() });
  });
}

export async function releaseApproval(approvalId: string, organizationId: string, error: unknown): Promise<void> {
  const ref = db.collection('approvals').doc(approvalId);
  await db.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().organizationId !== organizationId || doc.data().status !== 'EXECUTING') return;
    tx.update(ref, {
      status: completionTransition(doc.data().status, false),
      lastExecutionError: String(error).slice(0, 500),
      executionStartedAt: null,
    });
  });
}
