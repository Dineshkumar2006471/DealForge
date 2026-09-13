import React from 'react';

export default function ApprovalPanel({ approvals = [], onResolveApproval }) {
  const pending = approvals.filter((a) => a.status === 'PENDING');

  return (
    <div
      className="glass-panel"
      style={{
        padding: '1.5rem',
        borderTop: pending.length ? '3px solid var(--accent-amber)' : '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h3 className="heading-display" style={{ fontSize: '1.125rem' }}>
            Manager Approval Queue
          </h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Deterministic policy threshold violations</p>
        </div>
        <span className={pending.length ? 'badge badge-amber' : 'badge badge-emerald'}>
          {pending.length} Pending Actions
        </span>
      </div>

      {!pending.length ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          All autonomous agent proposals are within permitted policy limits. Zero pending escalations.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {pending.map((req) => {
            const requestedPct = req.validatedArgs?.requested_pct || req.validatedArgs?.discount_pct;
            return (
              <div
                key={req.approvalId}
                style={{
                  background: 'rgba(245, 158, 11, 0.05)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="badge badge-amber">Approval Required</span>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{req.toolName}</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    ID: {req.approvalId.slice(0, 8)}
                  </span>
                </div>

                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  {req.policyReason || 'Operation exceeds agent autonomous authority limit.'}
                </p>

                {requestedPct && (
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.2)',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      marginBottom: '1rem',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <strong>Proposed Commercial Concession:</strong> {requestedPct}% discount requested by customer. Max
                    autonomous limit: 18%.
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button
                    className="btn-danger"
                    onClick={() => onResolveApproval && onResolveApproval(req.approvalId, 'REJECTED')}
                    style={{ padding: '0.4rem 1rem', fontSize: '0.8125rem' }}
                  >
                    Reject Concession
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => onResolveApproval && onResolveApproval(req.approvalId, 'APPROVED')}
                    style={{
                      padding: '0.4rem 1rem',
                      fontSize: '0.8125rem',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    }}
                  >
                    Authorize & Replay
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
