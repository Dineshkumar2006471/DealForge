import React from 'react';

export default function ActivityTimeline({ events = [] }) {
  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h3 className="heading-display" style={{ fontSize: '1.125rem' }}>Audit Activity Timeline</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Cryptographic execution ledger</p>
        </div>
        <span className="badge badge-indigo">{events.length} Events</span>
      </div>

      {!events.length ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No recorded audit logs in this session.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', maxHeight: '420px', paddingRight: '0.5rem' }}>
          {events.map((evt, i) => {
            const isPolicy = evt.eventType?.includes('POLICY');
            const isTool = evt.eventType?.includes('TOOL');
            const isApproval = evt.eventType?.includes('APPROVAL');

            let badgeClass = 'badge-cyan';
            if (isPolicy) badgeClass = 'badge-indigo';
            if (isTool) badgeClass = 'badge-emerald';
            if (isApproval) badgeClass = 'badge-amber';

            return (
              <div
                key={evt.eventId || i}
                style={{
                  padding: '0.75rem 1rem',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span className={`badge ${badgeClass}`} style={{ fontSize: '0.68rem' }}>
                    {evt.eventType || 'SYSTEM_EVENT'}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : 'Recent'}
                  </span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  {evt.trigger || evt.details || 'State update committed.'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
