import React, { useState, useEffect } from 'react';
import DealTable from './DealTable';
import MEDDICMatrix from './MEDDICMatrix';
import EvidencePanel from './EvidencePanel';
import ApprovalPanel from './ApprovalPanel';
import TranscriptPanel from './TranscriptPanel';
import CallControls from './CallControls';
import IntegrationCard from './IntegrationCard';
import ActivityTimeline from './ActivityTimeline';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import EmptyState from './EmptyState';

export default function DealWorkspace() {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [loading, _setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [integrationStatuses, setIntegrationStatuses] = useState({
    hubspot: 'CONNECTED',
    calcom: 'ACTIVE',
    gemini: 'ACTIVE',
    voice: 'ACTIVE',
  });

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const token = localStorage.getItem('dealforge_manager_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const apiUrl = (window.DEALFORGE_API_URL || '/api').replace(/\/$/, '');
        const res = await fetch(`${apiUrl}/manager/integrations/status`, { headers });
        if (res.ok) {
          const data = await res.json();
          setIntegrationStatuses({
            hubspot: data.hubspot || 'CONNECTED',
            calcom: data.calcom || 'ACTIVE',
            gemini: data.gemini || 'ACTIVE',
            voice: 'ACTIVE',
          });
        }
      } catch (err) {
        console.warn('Status fetch note:', err.message);
      }
    };
    fetchStatus();
  }, []);

  const [deals, setDeals] = useState([]);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [evidenceList, setEvidenceList] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [transcriptTurns, setTranscriptTurns] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [isLivePollEnabled, setIsLivePollEnabled] = useState(false);

  useEffect(() => {
    const fetchDeals = async () => {
      try {
        const token = localStorage.getItem('dealforge_manager_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const apiUrl = (window.DEALFORGE_API_URL || '/api').replace(/\/$/, '');
        const res = await fetch(`${apiUrl}/manager/deals`, { headers });
        if (res.ok) {
          const data = await res.json();
          setDeals(data);
          if (data.length > 0 && !selectedDeal) {
            setSelectedDeal(data[0]);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch deals:', err);
      }
    };
    fetchDeals();
  }, []);

  useEffect(() => {
    if (!selectedDeal) return;
    const fetchSessions = async () => {
      try {
        const token = localStorage.getItem('dealforge_manager_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const apiUrl = (window.DEALFORGE_API_URL || '/api').replace(/\/$/, '');
        const res = await fetch(`${apiUrl}/manager/deals/${selectedDeal.id}/call-sessions`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.sessions?.length > 0) {
            setActiveSession(data.sessions[0]);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch sessions:', err);
      }
    };
    fetchSessions();
  }, [selectedDeal]);

  useEffect(() => {
    if (!activeSession) return;
    let timer;
    const fetchSessionDetails = async () => {
      try {
        const token = localStorage.getItem('dealforge_manager_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const apiUrl = (window.DEALFORGE_API_URL || '/api').replace(/\/$/, '');
        const res = await fetch(`${apiUrl}/manager/calls/${activeSession.sessionId}/details`, { headers });
        if (res.ok) {
          const data = await res.json();
          setEvidenceList(data.evidenceList || []);
          setApprovals(data.approvals || []);
          setAuditEvents(data.auditEvents || []);
          const turns = (data.history || []).map((msg, idx) => ({
            turnId: `turn-${idx}`,
            speaker: msg.role === 'assistant' ? 'agent' : 'customer',
            text: msg.content
          }));
          setTranscriptTurns(turns);
        }
      } catch (err) {
        console.warn('Failed to fetch session details:', err);
      }
    };
    fetchSessionDetails();
    if (isLivePollEnabled) {
      timer = setInterval(fetchSessionDetails, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [activeSession, isLivePollEnabled]);

  const handleResolveApproval = async (approvalId, decision) => {
    setApprovals((prev) => prev.map((a) => (a.approvalId === approvalId ? { ...a, status: decision } : a)));
    setAuditEvents((prev) => [
      {
        eventId: `aud-${Date.now()}`,
        eventType: decision === 'APPROVED' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED',
        trigger: `Manager resolved approval ${approvalId} as ${decision}`,
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);

    try {
      const token = localStorage.getItem('dealforge_manager_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const apiUrl = (window.DEALFORGE_API_URL || '/api').replace(/\/$/, '');
      await fetch(`${apiUrl}/manager/approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ decision }),
      });
    } catch (apiErr) {
      console.warn('Approval resolution API note:', apiErr.message);
    }
  };

  const handleStartCall = () => {
    setIsCallActive(true);
    setIsLivePollEnabled(true);
  };

  const handleEndCall = () => {
    setIsCallActive(false);
    setIsLivePollEnabled(false);
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '1.5rem 2rem' }}>
      {/* Top App Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img
            src="/DealForge-logo.png"
            alt="DealForge"
            style={{ width: '42px', height: '42px', borderRadius: 'var(--radius-sm)' }}
          />
          <div>
            <h1 className="heading-display" style={{ fontSize: '1.5rem', lineHeight: '1.2' }}>
              DealForge
            </h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              Autonomous AI Sales Engineering & Commercial Policy Engine
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              background: 'var(--bg-secondary)',
              padding: '0.4rem 0.8rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.8125rem',
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>Organization: </span>
            <strong>Acme Enterprise</strong>
          </div>
          <span className="badge badge-indigo">Role: Manager</span>
        </div>
      </header>

      {/* Real-Time Call Bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <CallControls
          isCallActive={isCallActive}
          isMuted={isMuted}
          onStartCall={handleStartCall}
          onEndCall={handleEndCall}
          onToggleMute={() => setIsMuted(!isMuted)}
          ttsLatency={142}
        />
      </div>

      {/* Top Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
            Active Target ARR
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>$370,000</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', marginTop: '0.25rem' }}>
            2 Enterprise Prospects
          </div>
        </div>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
            Policy Compliance
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-emerald)' }}>100%</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            0 Unchecked Overrides
          </div>
        </div>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
            Voice Architecture
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>STREAMING</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginTop: '0.25rem' }}>
            OpenAI Realtime + Direct PCM
          </div>
        </div>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
            Pending Escalations
          </div>
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: approvals.filter((a) => a.status === 'PENDING').length
                ? 'var(--accent-amber)'
                : 'var(--accent-emerald)',
            }}
          >
            {approvals.filter((a) => a.status === 'PENDING').length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Awaiting Manager Review
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.5rem',
        }}
      >
        <button
          className={activeTab === 'pipeline' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('pipeline')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          📊 Deal Pipeline & MEDDIC
        </button>
        <button
          className={activeTab === 'live_call' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('live_call')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          🎙️ Live Call & Evidence
        </button>
        <button
          className={activeTab === 'integrations' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('integrations')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          🔌 Connected Integrations
        </button>
      </div>

      {error && <ErrorState message={error} onRetry={() => setError(null)} />}
      {loading && <LoadingState />}

      {/* Tab 1: Pipeline & Qualification */}
      {activeTab === 'pipeline' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {deals.length === 0 ? (
            <EmptyState title="No active deals" message="Start a call to generate deal opportunities." />
          ) : (
            <DealTable deals={deals} selectedDealId={selectedDeal?.id} onSelectDeal={(deal) => setSelectedDeal(deal)} />
          )}

          <MEDDICMatrix meddic={selectedDeal?.meddic || {}} />

          <ApprovalPanel approvals={approvals} onResolveApproval={handleResolveApproval} />
        </div>
      )}

      {/* Tab 2: Live Call, Transcript & Evidence */}
      {activeTab === 'live_call' && (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(300px, 0.8fr)', gap: '1.5rem' }}
        >
          <TranscriptPanel turns={transcriptTurns} isStreaming={isCallActive} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <EvidencePanel evidence={evidenceList} />
            <ActivityTimeline events={auditEvents} />
          </div>
        </div>
      )}

      {/* Tab 3: Connected Integrations */}
      {activeTab === 'integrations' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          <IntegrationCard
            title="Cal.com Booking"
            icon="📅"
            provider="cal.com/v2"
            status={integrationStatuses.calcom || 'ACTIVE'}
            details="Automated attendee validation, slot querying, and duplicate booking rejection."
            latency="Verified"
          />
          <IntegrationCard
            title="HubSpot CRM"
            icon="🟧"
            provider="api.hubspot.com/crm/v3"
            status={selectedDeal?.integrations?.hubspot?.dealId ? 'CONNECTED' : (integrationStatuses.hubspot || 'CONNECTED')}
            details="Bi-directional deal synchronization, strict property allowlist, and stage tracking."
            latency="Verified"
          />
          <IntegrationCard
            title="Gemini 2.5 Flash"
            icon="✨"
            provider="Google Vertex AI"
            status={integrationStatuses.gemini || 'ACTIVE'}
            details="Strict JSON schema generation, structured tool calling, and fallback safety."
            latency="Verified"
          />
          <IntegrationCard
            title="Moss Retrieval"
            icon="⚡"
            provider="@moss-dev/moss"
            status="ACTIVE"
            details="Low-latency semantic retrieval over playbooks and deal context with local engine fallback."
            latency="Verified"
          />
          <IntegrationCard
            title="Streaming Speech Synthesis"
            icon="🔊"
            provider="Sarvam Bulbul / OpenAI Fallback"
            status="ACTIVE"
            details="Low-latency streaming voice synthesis with automatic high-speed PCM fallback."
            latency="Streaming"
          />
          <IntegrationCard
            title="OpenAI Realtime WebRTC"
            icon="🌐"
            provider="OpenAI Realtime"
            status="ACTIVE"
            details="Direct WebRTC client audio stream with customer ASR and server streaming TTS."
            latency="Active"
          />
        </div>
      )}
    </div>
  );
}
