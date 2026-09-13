import React, { useState } from 'react';
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

  // Mock deal data state backed by authoritative Firestore schema
  const [deals, _setDeals] = useState([
    {
      id: 'deal-acme-prod-01',
      organizationId: 'org-acme-enterprise',
      company: 'Acme Cloud Dynamics',
      stage: 'QUALIFY',
      targetArr: 120000,
      healthScore: 92,
      meddic: {
        metrics: {
          status: 'confirmed',
          confidence: 0.94,
          value: '35% reduction in CAC targeted',
          updatedAt: new Date().toISOString(),
        },
        economicBuyer: {
          status: 'confirmed',
          confidence: 0.88,
          value: 'Sarah Jenkins (VP Revenue)',
          updatedAt: new Date().toISOString(),
        },
        decisionCriteria: {
          status: 'unknown',
          confidence: 0.72,
          value: 'Evaluating latency vs Gong',
          updatedAt: new Date().toISOString(),
        },
        decisionProcess: { status: 'not_asked', confidence: 0 },
        identifyPain: {
          status: 'confirmed',
          confidence: 0.96,
          value: 'High sales rep turnaround time on voice calls',
          updatedAt: new Date().toISOString(),
        },
        champion: {
          status: 'confirmed',
          confidence: 0.91,
          value: 'Alex Mercer (Director Sales Ops)',
          updatedAt: new Date().toISOString(),
        },
      },
    },
    {
      id: 'deal-apex-global-02',
      organizationId: 'org-acme-enterprise',
      company: 'Apex Global Logistics',
      stage: 'NEGOTIATE',
      targetArr: 250000,
      healthScore: 84,
      meddic: {
        metrics: {
          status: 'confirmed',
          confidence: 0.92,
          value: '$400k annual efficiency savings',
          updatedAt: new Date().toISOString(),
        },
        economicBuyer: {
          status: 'confirmed',
          confidence: 0.89,
          value: 'David Vance (CFO)',
          updatedAt: new Date().toISOString(),
        },
        decisionCriteria: {
          status: 'confirmed',
          confidence: 0.86,
          value: 'SOC2 Type II + SSO mandatory',
          updatedAt: new Date().toISOString(),
        },
        decisionProcess: {
          status: 'confirmed',
          confidence: 0.85,
          value: 'Security review completed; commercial signoff pending',
          updatedAt: new Date().toISOString(),
        },
        identifyPain: {
          status: 'confirmed',
          confidence: 0.95,
          value: 'Complex negotiation cycles taking >6 months',
          updatedAt: new Date().toISOString(),
        },
        champion: {
          status: 'confirmed',
          confidence: 0.88,
          value: 'Elena Rostova (Head of AI)',
          updatedAt: new Date().toISOString(),
        },
      },
    },
  ]);

  const [selectedDeal, setSelectedDeal] = useState(deals[0]);

  const [evidenceList, _setEvidenceList] = useState([
    {
      evidenceId: 'ev-101',
      dealStateField: 'targetArr',
      claim: 'Target deal size stated as $120,000 for 150 enterprise seats',
      confidence: 0.94,
      utteranceTurn: 2,
      timestamp: new Date(Date.now() - 300000).toISOString(),
    },
    {
      evidenceId: 'ev-102',
      dealStateField: 'economicBuyer',
      claim: 'Sarah Jenkins VP Revenue holds final sign-off authority',
      confidence: 0.91,
      utteranceTurn: 3,
      timestamp: new Date(Date.now() - 240000).toISOString(),
    },
    {
      evidenceId: 'ev-103',
      dealStateField: 'pain',
      claim: 'Current voice workflows suffer from 4-second latency and dropped calls',
      confidence: 0.96,
      utteranceTurn: 4,
      timestamp: new Date(Date.now() - 120000).toISOString(),
    },
  ]);

  const [approvals, setApprovals] = useState([
    {
      approvalId: 'appr-882193',
      toolName: 'calculate_discount',
      policyReason: 'Customer requested 22% discount; maximum autonomous agent tier is 18%.',
      validatedArgs: { requested_pct: 22 },
      status: 'PENDING',
    },
  ]);

  const [transcriptTurns, setTranscriptTurns] = useState([
    {
      turnId: 'turn-1',
      speaker: 'agent',
      text: 'Hello! I am DealForge Sales AI. How can I assist your team today?',
      latencyMs: 120,
    },
    {
      turnId: 'turn-2',
      speaker: 'customer',
      text: 'We are evaluating autonomous voice agents for our 150 sales reps. Budget is around $120k.',
    },
    {
      turnId: 'turn-3',
      speaker: 'agent',
      text: 'Understood. DealForge Enterprise tier fully supports 150 seats with deterministic commercial policy enforcement and sub-500ms voice responses.',
      latencyMs: 340,
    },
    {
      turnId: 'turn-4',
      speaker: 'customer',
      text: 'Can you offer a 22% discount if we sign an annual commitment this week?',
    },
    {
      turnId: 'turn-5',
      speaker: 'agent',
      text: 'I would be glad to help with that. Let me submit this 22% annual concession to our sales leadership for immediate approval.',
      latencyMs: 290,
    },
  ]);

  const [auditEvents, setAuditEvents] = useState([
    {
      eventId: 'aud-1',
      eventType: 'POLICY_CHECKED',
      trigger: 'calculate_discount (requested 22%) evaluated -> Tier 3 APPROVAL required',
      timestamp: new Date().toISOString(),
    },
    {
      eventId: 'aud-2',
      eventType: 'APPROVAL_REQUESTED',
      trigger: 'Manager approval ticket appr-882193 created in pending state',
      timestamp: new Date().toISOString(),
    },
    {
      eventId: 'aud-3',
      eventType: 'EVIDENCE_RECORDED',
      trigger: 'Customer utterance confidence 0.96 recorded to audit ledger',
      timestamp: new Date().toISOString(),
    },
  ]);

  const handleResolveApproval = (approvalId, decision) => {
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
  };

  const handleStartCall = () => {
    setIsCallActive(true);
    setTranscriptTurns((prev) => [
      ...prev,
      {
        turnId: `turn-${Date.now()}`,
        speaker: 'agent',
        text: 'Voice stream connected via Agora WebRTC. Listening...',
        latencyMs: 140,
      },
    ]);
  };

  const handleEndCall = () => {
    setIsCallActive(false);
    setAuditEvents((prev) => [
      {
        eventId: `aud-${Date.now()}`,
        eventType: 'CALL_SESSION_COMPLETED',
        trigger: 'Customer session terminated cleanly. Audio streams closed.',
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
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
            Average Voice TTFA
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>284ms</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginTop: '0.25rem' }}>
            Agora + Sarvam Fast Path
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
            status="ACTIVE"
            details="Automated attendee validation, slot querying, and duplicate booking rejection."
            latency="18ms"
          />
          <IntegrationCard
            title="HubSpot CRM"
            icon="🟧"
            provider="api.hubspot.com/crm/v3"
            status="ACTIVE"
            details="Bi-directional deal synchronization, strict property allowlist, and stage tracking."
            latency="42ms"
          />
          <IntegrationCard
            title="Gemini 2.5 Flash"
            icon="✨"
            provider="Google Vertex AI"
            status="ACTIVE"
            details="Strict JSON schema generation, structured tool calling, and fallback safety."
            latency="85ms TTFT"
          />
          <IntegrationCard
            title="Moss Retrieval"
            icon="⚡"
            provider="@moss-dev/moss"
            status="ACTIVE"
            details="Low-latency semantic retrieval over playbooks and deal context with local engine fallback."
            latency="12ms"
          />
          <IntegrationCard
            title="Sarvam AI Speech"
            icon="🔊"
            provider="api.sarvam.ai"
            status="ACTIVE"
            details="Ultra-low latency streaming Hindi/Indian English voice synthesis."
            latency="142ms"
          />
          <IntegrationCard
            title="Agora Realtime RTC"
            icon="🌐"
            provider="Agora WebRTC"
            status="ACTIVE"
            details="Sub-200ms audio streaming with barge-in interruption detection."
            latency="65ms"
          />
        </div>
      )}
    </div>
  );
}
