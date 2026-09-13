import React from 'react';

export default function TranscriptPanel({ turns = [], isStreaming = false }) {
  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h3 className="heading-display" style={{ fontSize: '1.125rem' }}>Real-Time Call Transcript</h3>
          {isStreaming && (
            <div className="waveform-container">
              <div className="waveform-bar" />
              <div className="waveform-bar" />
              <div className="waveform-bar" />
              <div className="waveform-bar" />
              <div className="waveform-bar" />
            </div>
          )}
        </div>
        <span className="badge badge-indigo">{turns.length} Turns</span>
      </div>

      {!turns.length ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No active call turn logged. Audio stream will transcribe in real-time.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', maxHeight: '420px', paddingRight: '0.5rem' }}>
          {turns.map((turn, i) => {
            const isAgent = turn.speaker === 'agent';
            return (
              <div
                key={turn.turnId || i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignSelf: isAgent ? 'flex-start' : 'flex-end',
                  maxWidth: '85%',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', alignSelf: isAgent ? 'flex-start' : 'flex-end' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isAgent ? 'var(--accent-cyan)' : '#818cf8' }}>
                    {isAgent ? 'DealForge AI Agent' : 'Customer Prospect'}
                  </span>
                  {turn.latencyMs && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {turn.latencyMs}ms TTFA
                    </span>
                  )}
                </div>
                <div
                  style={{
                    background: isAgent ? 'rgba(6, 182, 212, 0.08)' : 'rgba(99, 102, 241, 0.12)',
                    border: `1px solid ${isAgent ? 'rgba(6, 182, 212, 0.25)' : 'rgba(99, 102, 241, 0.25)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '0.75rem 1rem',
                    fontSize: '0.875rem',
                    lineHeight: '1.45',
                    color: 'var(--text-primary)',
                  }}
                >
                  {turn.text || turn.userText || turn.agentResponse}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
