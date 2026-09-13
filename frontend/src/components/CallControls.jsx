import React from 'react';

export default function CallControls({ isCallActive = false, isMuted = false, onStartCall, onEndCall, onToggleMute, ttsLatency = 142 }) {
  return (
    <div
      className="glass-panel"
      style={{
        padding: '1rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: isCallActive ? 'var(--accent-emerald)' : 'var(--text-muted)',
              display: 'inline-block',
            }}
            className={isCallActive ? 'pulse-live' : ''}
          />
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
            {isCallActive ? 'Live Voice Stream (Agora WebRTC)' : 'Voice Pipeline Idle'}
          </span>
        </div>
        {isCallActive && (
          <span className="badge badge-emerald" style={{ fontSize: '0.7rem' }}>
            Sarvam TTS: {ttsLatency}ms
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {isCallActive && (
          <button
            className="btn-secondary"
            onClick={onToggleMute}
            style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
          >
            {isMuted ? '🔇 Unmute Microphone' : '🎙️ Mute Microphone'}
          </button>
        )}

        {!isCallActive ? (
          <button
            className="btn-primary"
            onClick={onStartCall}
            style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}
          >
            📞 Start Voice Session
          </button>
        ) : (
          <button
            className="btn-danger"
            onClick={onEndCall}
            style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}
          >
            ⏹️ End Call
          </button>
        )}
      </div>
    </div>
  );
}
