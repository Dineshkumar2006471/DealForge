import React from 'react';

export default function ErrorState({
  title = 'Action Failed',
  message = 'An unexpected error occurred while processing your request.',
  onRetry,
}) {
  return (
    <div
      className="glass-panel"
      style={{ padding: '2rem', borderLeft: '4px solid var(--accent-rose)', margin: '1rem 0' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
        <div
          style={{
            background: 'rgba(244, 63, 94, 0.15)',
            color: '#fb7185',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: '1.25rem',
            fontWeight: 700,
          }}
        >
          !
        </div>
        <div style={{ flex: 1 }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#fb7185', marginBottom: '0.35rem' }}>{title}</h4>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: onRetry ? '1rem' : 0 }}>
            {message}
          </p>
          {onRetry && (
            <button
              className="btn-secondary"
              onClick={onRetry}
              style={{ fontSize: '0.8125rem', padding: '0.4rem 0.9rem' }}
            >
              Retry Action
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
