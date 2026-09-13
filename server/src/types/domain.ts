/**
 * DealForge Domain Type Contracts
 *
 * Authoritative TypeScript contracts for deal state, evidence, policy decisions,
 * approvals, tool calls, and integrations.
 */

export type DealStage = 'QUALIFY' | 'NEGOTIATE' | 'BOOK' | 'CLOSED_WON' | 'CLOSED_LOST';

export type DealStatus = 'ACTIVE' | 'QUALIFIED' | 'PENDING_APPROVAL' | 'CLOSED_WON' | 'CLOSED_LOST';

export type EvidenceStatus = 'confirmed' | 'likely' | 'needs_confirmation';

export interface EvidenceSource {
  type: string;
  turnId?: string;
  speaker?: 'customer' | 'agent' | 'system';
}

export interface ConfidenceGatedField<T = string | number> {
  value: T;
  confidence: number;
  status: EvidenceStatus;
  source: EvidenceSource;
  evidence_turn?: number;
  last_updated?: string;
  updatedAt?: string;
}

export type MEDDICPillar =
  | 'metrics'
  | 'economicBuyer'
  | 'decisionCriteria'
  | 'decisionProcess'
  | 'identifyPain'
  | 'champion';

export interface MEDDICItem {
  status: 'confirmed' | 'unknown' | 'not_asked';
  confidence: number;
  source: EvidenceSource;
  value?: string;
  updatedAt: string;
}

export type MEDDICState = Record<MEDDICPillar, MEDDICItem>;

export interface DiscountLedgerEntry {
  requested_pct: number;
  result: 'APPROVED' | 'PENDING_APPROVAL' | 'REJECTED';
  counter_pct: number;
  alternatives: string[];
  timestamp: string;
  turn: number;
}

export interface EscalationState {
  flagged: boolean;
  reason?: string;
  urgency?: 'low' | 'medium' | 'high';
  timestamp?: string;
}

export interface DealState {
  id: string;
  organizationId: string;
  company: string;
  stage: DealStage;
  status: DealStatus;
  targetArr: number;
  budget?: ConfidenceGatedField<number>;
  teamSize?: ConfidenceGatedField<number>;
  timeline?: ConfidenceGatedField<string>;
  competitor?: ConfidenceGatedField<string>;
  pain?: ConfidenceGatedField<string>;
  sentiment?: ConfidenceGatedField<string>;
  meddic?: MEDDICState;
  discountLedger?: DiscountLedgerEntry[];
  escalation?: EscalationState;
  conversationStage?: DealStage;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConversationTurn {
  turnId: string;
  sessionId: string;
  dealId: string;
  organizationId: string;
  turnNumber: number;
  userText: string;
  agentResponse?: string;
  timestamp: string;
  latencyMs?: number;
  evidenceExtracted?: boolean;
}

export interface Evidence {
  evidenceId: string;
  organizationId: string;
  dealId: string;
  sessionId: string;
  claim: string;
  utteranceTurn: number;
  confidence: number;
  source: EvidenceSource;
  status: EvidenceStatus;
  dealStateField: string;
  timestamp: string;
}

export type PolicyTier = 'OBSERVE' | 'ACT' | 'APPROVAL' | 'REJECT';

export interface PolicyDecision {
  tier: PolicyTier;
  allowed: boolean;
  reason: string;
  requiresApproval?: boolean;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTING';

export interface ApprovalRequest {
  approvalId: string;
  organizationId: string;
  dealId: string;
  sessionId: string;
  toolName: string;
  validatedArgs: Record<string, unknown>;
  requestedBy: 'agent' | 'user';
  status: ApprovalStatus;
  policyReason: string;
  approvedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
  context: {
    dealId: string;
    organizationId: string;
    sessionId?: string | null;
    turnNumber?: number;
    turnId?: string;
  };
}

export interface ToolResult {
  result: Record<string, unknown>;
  policyResult: PolicyDecision;
  approved: boolean;
  verified?: boolean;
}

export interface IntegrationResult<T = unknown> {
  provider: 'calcom' | 'hubspot' | 'moss' | 'gemini' | 'agora' | 'sarvam';
  operation: string;
  success: boolean;
  status: number | string;
  data?: T;
  error?: string;
}

export interface AuditEvent {
  eventId?: string;
  organizationId: string;
  dealId?: string;
  sessionId?: string;
  eventType: string;
  trigger: string;
  timestamp?: string;
  evidence?: Array<{ evidenceId: string; confidence: number; status: string }>;
  actionResult?: Record<string, unknown>;
  policyResult?: PolicyDecision;
}

export interface ErrorEnvelope {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
}
