import React from 'react';
import DealWorkspace from './components/DealWorkspace';

export default function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <main style={{ flex: 1 }}>
        <DealWorkspace />
      </main>
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '1.25rem 2rem',
          textAlign: 'center',
          fontSize: '0.8125rem',
          color: 'var(--text-muted)',
        }}
      >
        DealForge Autonomous AI Sales Engine &bull; Deterministic Commercial Policy Gating &bull; Streaming Low-Latency
        Voice
      </footer>
    </div>
  );
}
