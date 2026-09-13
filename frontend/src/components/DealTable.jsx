import React from 'react';

export default function DealTable({ deals = [], selectedDealId, onSelectDeal }) {
  if (!deals.length) {
    return (
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>No active deals found for this organization.</p>
      </div>
    );
  }

  const getStageBadge = (stage) => {
    switch (stage) {
      case 'QUALIFY':
        return <span className="badge badge-cyan">Qualify</span>;
      case 'NEGOTIATE':
        return <span className="badge badge-amber">Negotiate</span>;
      case 'BOOK':
        return <span className="badge badge-indigo">Book</span>;
      case 'CLOSED_WON':
        return <span className="badge badge-emerald">Closed Won</span>;
      case 'CLOSED_LOST':
        return <span className="badge badge-rose">Closed Lost</span>;
      default:
        return <span className="badge badge-indigo">{stage || 'Discovery'}</span>;
    }
  };

  return (
    <div className="glass-panel" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="heading-display" style={{ fontSize: '1.125rem' }}>Active Deal Pipeline</h3>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{deals.length} deals tracked</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '0.85rem 1.5rem', fontWeight: 600 }}>Company</th>
              <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Stage</th>
              <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Target ARR</th>
              <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Health Score</th>
              <th style={{ padding: '0.85rem 1.5rem', fontWeight: 600, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => {
              const isSelected = selectedDealId === deal.id;
              const healthScore = deal.healthScore ?? 85;
              return (
                <tr
                  key={deal.id}
                  onClick={() => onSelectDeal && onSelectDeal(deal)}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  className="glass-panel-hover"
                >
                  <td style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {deal.company || 'Enterprise Prospect'}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                      ID: {deal.id.slice(0, 12)}...
                    </div>
                  </td>
                  <td style={{ padding: '1rem 1rem' }}>
                    {getStageBadge(deal.stage || deal.conversationStage)}
                  </td>
                  <td style={{ padding: '1rem 1rem', fontFamily: 'var(--font-mono)' }}>
                    ${Number(deal.targetArr || 50000).toLocaleString()}
                  </td>
                  <td style={{ padding: '1rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: healthScore >= 80 ? 'var(--accent-emerald)' : healthScore >= 60 ? 'var(--accent-amber)' : 'var(--accent-rose)',
                        }}
                      />
                      <span>{healthScore}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                    <button
                      className={isSelected ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                    >
                      {isSelected ? 'Viewing' : 'Open'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
