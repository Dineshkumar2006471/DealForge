function resolveTransition(status, expired, decision) {
  if (status !== 'PENDING') throw new Error('Approval is no longer pending');
  if (expired) return 'EXPIRED';
  if (decision !== 'APPROVED' && decision !== 'REJECTED') throw new Error('Invalid approval decision');
  return decision;
}
function claimTransition(status, expired) { return status === 'APPROVED' && !expired ? 'EXECUTING' : expired ? 'EXPIRED' : null; }
function completionTransition(status, succeeded) { if (status !== 'EXECUTING') throw new Error('Approval is not executing'); return succeeded ? 'CONSUMED' : 'APPROVED'; }
module.exports = { resolveTransition, claimTransition, completionTransition };
