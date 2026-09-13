import React from 'react';

export default function IntegrationCard({ title, icon, provider, status = 'ACTIVE', details = '', latency = null }) {
  const isHealthy = status === 'ACTIVE' || status === 'CONNECTED';

  return (
    <div
      className="glass-panel glass-panel-hover"
      style={{
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%',
      }}
    >
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.5rem' }}>{icon}</span>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{title}</span>
          </div>
          <span className={isHealthy ? 'badge badge-emerald' : 'badge badge-amber'}>
            {status}
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          {details}
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{provider}</span>
        {latency && <span>{latency}</span>}
      </div>
    </div>
  );
}
