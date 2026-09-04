const { db } = require('../firebase/admin');
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('../security/auth');
const { EVENT_TYPES } = require('../audit/eventTypes');
const { resolveTransition, claimTransition, completionTransition } = require('./approvalStateMachine');

async function createApproval({ organizationId, dealId, sessionId, toolName, validatedArgs, requestedBy, policyReason }) {
  const approvalId = uuidv4();
  const createdAt = new Date().toISOString();
  const approval = { approvalId, organizationId, sessionId, dealId, exactToolName: toolName, exactValidatedArguments: validatedArgs, requestedBy, status: 'PENDING', policyReason, createdAt, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), resolvedAt: null, resolvedBy: null, consumedAt: null };
  const auditRef = db.collection('auditEvents').doc(uuidv4());
  await db.runTransaction(async tx => {
    tx.create(db.collection('approvals').doc(approvalId), approval);
    tx.create(auditRef, { organizationId, dealId, sessionId, eventType: EVENT_TYPES.APPROVAL_REQUESTED, trigger: `${toolName} requires manager approval`, policyResult: { tier: 'APPROVAL', allowed: false, reason: policyReason }, timestamp: createdAt });
  });
  return approval;
}

async function resolveApproval(approvalId, decision, manager) {
  const ref = db.collection('approvals').doc(approvalId); const auditRef = db.collection('auditEvents').doc(uuidv4()); let output;
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref); if (!doc.exists) throw new HttpError(404, 'Approval not found');
    const approval = doc.data(); const timestamp = new Date().toISOString();
    if (approval.organizationId !== manager.organizationId) throw new HttpError(404, 'Approval not found');
    let next; try { next = resolveTransition(approval.status, new Date(approval.expiresAt) <= new Date(), decision); } catch (error) { throw new HttpError(409, error.message); }
    if (next === 'EXPIRED') { tx.update(ref, { status: next, resolvedAt: timestamp }); output = { approvalId, status: next, expired: true }; return; }
    tx.update(ref, { status: next, resolvedAt: timestamp, resolvedBy: manager.uid });
    tx.create(auditRef, { organizationId: approval.organizationId, dealId: approval.dealId, sessionId: approval.sessionId, eventType: EVENT_TYPES.APPROVAL_RESOLVED, trigger: `Manager ${decision.toLowerCase()} approval`, actionResult: { approvalId, status: decision }, timestamp });
    output = { approvalId, status: decision };
  });
  if (output.expired) throw new HttpError(410, 'Approval has expired');
  return output;
}

async function claimApprovedApprovals({ organizationId, dealId, sessionId }) {
  const snapshot = await db.collection('approvals').where('sessionId', '==', sessionId).where('status', '==', 'APPROVED').get();
  const claimed = [];
  for (const doc of snapshot.docs) await db.runTransaction(async tx => {
    const current = await tx.get(doc.ref); if (!current.exists) return;
    const approval = current.data(); const timestamp = new Date().toISOString();
    if (approval.organizationId !== organizationId || approval.dealId !== dealId || approval.status !== 'APPROVED') return;
    const next = claimTransition(approval.status, new Date(approval.expiresAt) <= new Date());
    if (next === 'EXPIRED') { tx.update(doc.ref, { status: next, resolvedAt: timestamp }); return; }
    if (!next) return;
    tx.update(doc.ref, { status: next, executionStartedAt: timestamp });
    claimed.push(approval);
  });
  return claimed;
}

async function completeApproval(approvalId, organizationId) {
  const ref = db.collection('approvals').doc(approvalId);
  await db.runTransaction(async tx => { const doc = await tx.get(ref); if (!doc.exists || doc.data().organizationId !== organizationId) throw new Error('Approval cannot be completed'); tx.update(ref, { status: completionTransition(doc.data().status, true), consumedAt: new Date().toISOString() }); });
}

async function releaseApproval(approvalId, organizationId, error) {
  const ref = db.collection('approvals').doc(approvalId);
  await db.runTransaction(async tx => { const doc = await tx.get(ref); if (!doc.exists || doc.data().organizationId !== organizationId || doc.data().status !== 'EXECUTING') return; tx.update(ref, { status: completionTransition(doc.data().status, false), lastExecutionError: String(error).slice(0, 500), executionStartedAt: null }); });
}

module.exports = { createApproval, resolveApproval, claimApprovedApprovals, completeApproval, releaseApproval };
