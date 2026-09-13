import React from 'react';

const PILLAR_LABELS = {
  metrics: 'Metrics & Economic ROI',
  economicBuyer: 'Economic Buyer',
  decisionCriteria: 'Decision Criteria',
  decisionProcess: 'Decision Process',
  identifyPain: 'Identified Pain',
  champion: 'Internal Champion',
};

export default function MEDDICMatrix({ meddic = {} }) {
  const pillars = ['metrics', 'economicBuyer', 'decisionCriteria', 'decisionProcess', 'identifyPain', 'champion'];

  const getStatusBadge = (item) => {
    if (!item || item.status === 'not_asked' || !item.status) {
      return <span className="badge badge-rose">Not Identified</span>;
    }
    if (item.status === 'unknown') {
      return <span className="badge badge-amber">Under Review</span>;
    }
    return <span className="badge badge-emerald">Confirmed</span>;
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h3 className="heading-display" style={{ fontSize: '1.125rem' }}>MEDDIC Qualification Matrix</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Evidence-backed qualification gating</p>
        </div>
        <span className="badge badge-indigo">
          {pillars.filter((p) => meddic[p]?.status === 'confirmed').length} / 6 Confirmed
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        {pillars.map((key) => {
          const item = meddic[key] || {};
          const confidence = item.confidence ? Math.round(item.confidence * 100) : 0;
          return (
            <div
              key={key}
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{PILLAR_LABELS[key]}</span>
                {getStatusBadge(item)}
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', minHeight: '36px' }}>
                {item.value || item.status === 'confirmed' ? (item.value || 'Verified via customer turn') : 'Pending discovery in conversation'}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span>Confidence: {confidence > 0 ? `${confidence}%` : 'N/A'}</span>
                <span>{item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString() : 'Awaiting turn'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
