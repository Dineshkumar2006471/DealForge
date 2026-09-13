import React from 'react';

export default function LoadingState({
  message = 'Loading workspace state...',
  subtext = 'Synchronizing authoritative deal state',
}) {
  return (
    <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', margin: '1rem 0' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '3px solid rgba(99, 102, 241, 0.2)',
            borderTopColor: '#6366f1',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
        {message}
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{subtext}</p>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
