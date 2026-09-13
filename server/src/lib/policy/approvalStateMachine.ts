export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'CONSUMED' | 'EXPIRED';
export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export function resolveTransition(status: string, expired: boolean, decision: string): ApprovalStatus {
  if (status !== 'PENDING') throw new Error('Approval is no longer pending');
  if (expired) return 'EXPIRED';
  if (decision !== 'APPROVED' && decision !== 'REJECTED') throw new Error('Invalid approval decision');
  return decision as ApprovalStatus;
}

export function claimTransition(status: string, expired: boolean): 'EXECUTING' | 'EXPIRED' | null {
  return status === 'APPROVED' && !expired ? 'EXECUTING' : expired ? 'EXPIRED' : null;
}

export function completionTransition(status: string, succeeded: boolean): 'CONSUMED' | 'APPROVED' {
  if (status !== 'EXECUTING') throw new Error('Approval is not executing');
  return succeeded ? 'CONSUMED' : 'APPROVED';
}
