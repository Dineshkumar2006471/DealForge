import React from 'react';

export default function EvidencePanel({ evidence = [] }) {
  return (
    <div
      className="glass-panel"
      style={{ padding: '1.5rem', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 className="heading-display" style={{ fontSize: '1.125rem' }}>
            Verified Evidence Stream
          </h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Confidence-scored state mutations</p>
        </div>
        <span className="badge badge-cyan">{evidence.length} Events</span>
      </div>

      {!evidence.length ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No evidence claims extracted yet. Start a voice turn to stream verified signals.
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            overflowY: 'auto',
            maxHeight: '420px',
            paddingRight: '0.5rem',
          }}
        >
          {evidence.map((item, index) => {
            const confPct = Math.round((item.confidence || 0) * 100);
            const isHigh = confPct >= 85;
            return (
              <div
                key={item.evidenceId || index}
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderLeft: `3px solid ${isHigh ? 'var(--accent-emerald)' : 'var(--accent-amber)'}`,
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.75rem 1rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.25rem',
                  }}
                >
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {item.dealStateField || 'Signal'}
                  </span>
                  <span className={`badge ${isHigh ? 'badge-emerald' : 'badge-amber'}`} style={{ fontSize: '0.7rem' }}>
                    {confPct}% Conf
                  </span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  &ldquo;{item.claim || item.text}&rdquo;
                </p>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>Turn #{item.utteranceTurn ?? 1}</span>
                  <span>{item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : 'Just now'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
