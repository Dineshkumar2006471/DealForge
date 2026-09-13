import React from 'react';

export default function EmptyState({ icon = '📂', title = 'No Records Found', description = 'There are currently no items to display in this view.', actionText, onAction }) {
  return (
    <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', margin: '1rem 0' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.8 }}>
        {icon}
      </div>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
        {title}
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto 1.5rem auto' }}>
        {description}
      </p>
      {actionText && onAction && (
        <button className="btn-primary" onClick={onAction}>
          {actionText}
        </button>
      )}
    </div>
  );
}
