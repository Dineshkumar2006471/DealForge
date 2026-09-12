/**
 * DealForge — Moss Low-Latency Retrieval Indexer
 *
 * Architecture: 2-Index Strategy
 *  1. dealforge-knowledge    - Unified index containing product docs, pricing, plans, capabilities,
 *                              integrations, FAQs, security, MEDDIC guidance, qualification playbook,
 *                              objection handling, competitive positioning, and policy reference.
 *  2. dealforge-deal-context  - Dynamically synchronized active deal context (company, team size,
 *                              pain, MEDDIC pillars, CRM/meeting status, stage, next best action).
 *
 * Capacity Constraints:
 *  - Developer tier allows 3 total index slots.
 *  - Existing starter index `edge_ai-starter-751a6` is strictly preserved untouched.
 *  - DealForge uses exactly the remaining 2 index slots.
 *
 * Invariants:
 *  - Firestore remains the authoritative source of truth.
 *  - Deterministic policy engine remains authoritative (retrieved context is advisory only).
 *  - No secrets or credentials are ever indexed.
 *  - Idempotent, retry-safe, and dual-layer (cloud sync + local in-memory sub-10ms fallback).
 */

const { MossClient } = require('@moss-dev/moss');

const INDEX_NAMES = {
  KNOWLEDGE: 'dealforge-knowledge',
  DEAL_CONTEXT: 'dealforge-deal-context',
  // Backward compatibility aliases
  PRODUCT: 'dealforge-knowledge',
  PLAYBOOK: 'dealforge-knowledge',
  POLICY: 'dealforge-knowledge'
};

const INDEX_VERSIONS = {
  [INDEX_NAMES.KNOWLEDGE]: '1.0.0',
  [INDEX_NAMES.DEAL_CONTEXT]: '1.0.0'
};

// In-Memory search engine fallback for sub-10ms queries & offline resilience
class LocalMemorySearchEngine {
  constructor() {
    this.indexes = new Map();
  }

  async createIndex(indexName, documents = []) {
    const docMap = new Map();
    for (const doc of documents) {
      if (doc && doc.id) {
        docMap.set(doc.id, {
          id: doc.id,
          text: doc.text || '',
          metadata: doc.metadata || {},
          updatedAt: doc.updatedAt || new Date().toISOString()
        });
      }
    }
    this.indexes.set(indexName, docMap);
    return { name: indexName, docCount: docMap.size };
  }

  async loadIndex(indexName) {
    if (!this.indexes.has(indexName)) {
      this.indexes.set(indexName, new Map());
    }
    return { name: indexName, docCount: this.indexes.get(indexName).size };
  }

  async addDocs(indexName, documents = []) {
    if (!this.indexes.has(indexName)) {
      this.indexes.set(indexName, new Map());
    }
    const docMap = this.indexes.get(indexName);
    for (const doc of documents) {
      if (doc && doc.id) {
        docMap.set(doc.id, {
          id: doc.id,
          text: doc.text || '',
          metadata: doc.metadata || {},
          updatedAt: doc.updatedAt || new Date().toISOString()
        });
      }
    }
    return { jobId: `local_job_${Date.now()}`, status: 'completed' };
  }

  async deleteDocs(indexName, docIds = []) {
    const docMap = this.indexes.get(indexName);
    if (docMap) {
      for (const id of docIds) {
        docMap.delete(id);
      }
    }
    return { jobId: `local_del_${Date.now()}`, status: 'completed' };
  }

  async getDocs(indexName) {
    const docMap = this.indexes.get(indexName);
    return docMap ? Array.from(docMap.values()) : [];
  }

  async query(indexName, queryText, options = {}) {
    const docMap = this.indexes.get(indexName);
    if (!docMap || docMap.size === 0) {
      return { query: queryText, docs: [] };
    }

    const { topK = 3, filter = null } = options;
    const tokens = String(queryText || '').toLowerCase().split(/\W+/).filter(t => t.length > 2);

    const scored = [];
    for (const doc of docMap.values()) {
      // Apply metadata filter if specified
      if (filter && typeof filter === 'object') {
        let matches = true;
        if (filter.organizationId && doc.metadata?.organizationId && doc.metadata.organizationId !== filter.organizationId) {
          matches = false;
        }
        if (filter.dealId && doc.metadata?.dealId && doc.metadata.dealId !== filter.dealId) {
          matches = false;
        }
        if (!matches) continue;
      }

      const docText = (doc.text || '').toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (docText.includes(token)) {
          score += 1;
        }
      }

      // Base relevance normalization
      const normalizedScore = tokens.length > 0 ? (score / tokens.length) : 0.1;
      if (score > 0 || tokens.length === 0) {
        scored.push({
          id: doc.id,
          score: Math.min(1.0, Math.max(0.1, normalizedScore)),
          text: doc.text,
          metadata: doc.metadata
        });
      }
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);
    return {
      query: queryText,
      docs: scored.slice(0, topK)
    };
  }

  async close() {
    this.indexes.clear();
  }
}

// Global state
let mossClientInstance = null;
let localEngineInstance = null;
let isUsingLocalEngine = false;

function getLocalEngine() {
  if (!localEngineInstance) {
    localEngineInstance = new LocalMemorySearchEngine();
  }
  return localEngineInstance;
}

function getClient() {
  const projectId = process.env.MOSS_PROJECT_ID;
  const projectKey = process.env.MOSS_PROJECT_KEY;

  if (projectId && projectKey) {
    if (!mossClientInstance) {
      try {
        mossClientInstance = new MossClient(projectId, projectKey);
        isUsingLocalEngine = false;
      } catch (err) {
        console.warn('MossClient initialization warning, using local engine fallback:', err.message);
        return getLocalEngine();
      }
    }
    return mossClientInstance;
  }

  return getLocalEngine();
}

// Comprehensive Knowledge Base Documents (12 Documents)
const KNOWLEDGE_DOCS = [
  // Product & Pricing
  {
    id: 'prod_pricing_plans',
    type: 'pricing',
    title: 'DealForge Pricing Plans & Tiers',
    text: 'DealForge offers three commercial pricing tiers: Starter Plan is $29 per user per month for teams up to 50 seats, including core CRM integration and email automation. Pro Plan is $79 per user per month for teams up to 500 seats, featuring advanced analytics, custom workflows, API access, and priority support. Enterprise Plan is $149 per user per month with custom seat scaling (100+ seats), dedicated account manager, SSO SAML, custom integrations, and 99.9% SLA. Annual commitment offers an additional 5% discount, while a 24-month multi-year commitment offers up to 10% discount.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod_capabilities',
    type: 'capabilities',
    title: 'Core Platform Capabilities',
    text: 'DealForge is an autonomous AI sales agent built for B2B enterprise revenue teams. Key capabilities include: Real-time autonomous voice conversations, deterministic commercial policy guardrails, automated MEDDIC evidence extraction from natural speech, bidirectional CRM synchronization with HubSpot and Salesforce, real-time meeting scheduling via Cal.com, and immutable audit trail logging with exact cryptographic provenance.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod_integrations',
    type: 'integrations',
    title: 'Integrations & Ecosystem',
    text: 'DealForge integrates out of the box with HubSpot CRM (bidirectional contact, deal stage, and note synchronization), Cal.com for live calendar availability and booking, OpenAI Realtime WebRTC for ultra-low-latency voice transport, Sarvam Bulbul v3 for natural Indian-accented voice synthesis, Agora Voice WebRTC fallback, and Google Vertex AI Gemini 2.5 Flash for enterprise reasoning.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod_security_compliance',
    type: 'security',
    title: 'Security, Privacy & Compliance',
    text: 'Enterprise security is built into every layer of DealForge: SOC2 Type II compliance, encryption in transit via TLS 1.3 and at rest via AES-256, SAML 2.0 and OAuth enterprise identity, role-based access control (RBAC), multi-tenant data isolation with organization-scoped Firestore security rules, and strict zero-credential-leakage guarantees.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'prod_faqs',
    type: 'faq',
    title: 'Product & Implementation FAQs',
    text: 'Q: How fast can DealForge be deployed? Standard onboarding takes under 14 days with dedicated engineering support. Q: What happens if an AI agent needs human approval? When a discount between 18% and 25% is requested, the deterministic policy engine immediately halts auto-approval, registers a PENDING APPROVAL record, and notifies the sales manager. Q: Does DealForge store sensitive voice recordings? Audio is processed ephemerally in memory; only verified transcripts, structured MEDDIC evidence, and audit logs are stored.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  // Playbook & MEDDIC
  {
    id: 'playbook_meddic_guidance',
    type: 'meddic',
    title: 'MEDDIC Qualification Framework',
    text: 'DealForge strictly qualifies enterprise deals using the 6 MEDDIC pillars: Metrics (quantifiable business impact, e.g. 35% rep time saved on inbound qualification), Economic Buyer (the executive with discretionary sign-off authority, e.g. VP of Sales or CRO), Decision Criteria (technical requirements, pricing, integrations, security), Decision Process (formal evaluation, legal, security, and procurement steps), Identify Pain (root business problem causing revenue friction), and Champion (internal influencer who actively sells DealForge internally).',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'playbook_discovery_questions',
    type: 'discovery',
    title: 'Discovery & Qualification Questions',
    text: 'Recommended discovery questions: How many sales reps are currently on your team? What is the single biggest bottleneck in your sales qualification process today? What percentage of rep time is spent on manual lead triage versus active selling? Who besides yourself will be reviewing and approving this purchase? What other solutions or competitors are you evaluating?',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'playbook_objection_handling',
    type: 'objections',
    title: 'Objection Handling & Competitive Positioning',
    text: 'Competitor comparison: When a customer mentions evaluating Salesforce or generic voice bots, emphasize that DealForge is not a replacement CRM or simple IVR. DealForge is an active autonomous sales negotiation copilot that operates with deterministic policy boundaries, live MEDDIC extraction, and manager approval queues. Unlike static bots, DealForge guarantees policy safety and never hallucinates unauthorized commercial commitments.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'playbook_negotiation_tradeoffs',
    type: 'negotiation',
    title: 'Trade-off & Value Concession Playbook',
    text: 'Rule of negotiation: Never give away cash discounts without receiving value or offering non-cash concessions first. When a customer pushes on price, offer structured concessions in order: 1. 60-day extended trial (reduces perceived risk), 2. Dedicated priority onboarding specialist for 30 days (accelerates time-to-value for teams over 50 reps), 3. Waived setup fee, 4. 5% annual commitment discount for upfront payment.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  // Human-Readable Policy Reference (Non-Authoritative Advisory Context)
  {
    id: 'policy_discount_thresholds',
    type: 'policy_reference',
    title: 'Commercial Discount Thresholds & Approval Rules',
    text: 'Deterministic Discount Policy: Autonomous limit is 18% maximum discount. Any discount request between 0% and 18% can be autonomously confirmed by DealForge. Any discount request greater than 18% up to 25% strictly requires human sales manager review and is placed into PENDING APPROVAL state. Any discount request exceeding 25% is strictly REJECTED and cannot be approved by either the agent or standard workflow.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'policy_approval_workflow',
    type: 'policy_reference',
    title: 'Manager Approval Workflow Policy',
    text: 'When a customer requests terms exceeding autonomous thresholds (such as a 25% discount), the agent must clearly state: "I can take that request to my manager for review. I will update you as soon as I have their decision." The agent must never promise immediate acceptance. Once the manager logs an approval in the DealForge dashboard, the approved operation is executed on the next turn.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'policy_escalation_rules',
    type: 'policy_reference',
    title: 'Commercial Escalation & Meeting Rules',
    text: 'Meeting requests must always route through verified calendar booking via Cal.com. The agent must never promise a time slot without real-time availability verification. CRM sync operations to HubSpot require validated fields and manager oversight.',
    version: '1.0.0',
    updatedAt: new Date().toISOString()
  }
];

// Compatibility exports
const PRODUCT_DOCS = KNOWLEDGE_DOCS.filter(d => ['pricing', 'capabilities', 'integrations', 'security', 'faq'].includes(d.type));
const PLAYBOOK_DOCS = KNOWLEDGE_DOCS.filter(d => ['meddic', 'discovery', 'objections', 'negotiation'].includes(d.type));
const POLICY_DOCS = KNOWLEDGE_DOCS.filter(d => d.type === 'policy_reference');

/**
 * Synchronize the Unified Knowledge Documentation index (dealforge-knowledge)
 */
async function syncKnowledgeDocs() {
  const client = getClient();
  const indexName = INDEX_NAMES.KNOWLEDGE;
  const localEngine = getLocalEngine();

  const formattedDocs = KNOWLEDGE_DOCS.map(d => ({
    id: d.id,
    text: `${d.title}. ${d.text}`,
    metadata: {
      type: d.type,
      title: d.title,
      version: d.version,
      updatedAt: d.updatedAt
    }
  }));

  // Always seed local engine for zero-downtime, sub-2ms query responses
  await localEngine.createIndex(indexName, formattedDocs);

  // If cloud client is configured, attempt cloud sync
  if (client && typeof client.createIndex === 'function' && client !== localEngine) {
    try {
      const existing = await client.listIndexes().catch(() => []);
      const indexExists = existing.some(idx => idx.name === indexName);

      if (indexExists) {
        if (typeof client.addDocs === 'function') {
          await client.addDocs(indexName, formattedDocs, { upsert: true });
        }
      } else {
        await client.createIndex(indexName, formattedDocs);
      }
      return { success: true, indexName, docCount: formattedDocs.length, isLocal: false };
    } catch (err) {
      console.warn(`[MOSS CLOUD SYNC] dealforge-knowledge sync note: ${err.message}. Using local search engine.`);
      return { success: true, indexName, docCount: formattedDocs.length, isLocal: true };
    }
  }

  return { success: true, indexName, docCount: formattedDocs.length, isLocal: true };
}

/**
 * Backwards compatibility sync methods
 */
async function syncProductDocs() {
  return syncKnowledgeDocs();
}
async function syncPlaybookDocs() {
  return syncKnowledgeDocs();
}
async function syncPolicyDocs() {
  return syncKnowledgeDocs();
}

/**
 * Synchronize Active Deal Context index (dealforge-deal-context)
 *
 * Requirements:
 * - Scoped strictly to organizationId & dealId
 * - Zero secrets or API keys
 * - Idempotent update
 */
async function syncDealContext(dealId, dealState = {}) {
  if (!dealId) return { success: false, reason: 'dealId is required' };
  const organizationId = dealState.organizationId || 'dealforge-staging';
  const sessionId = dealState.sessionId || null;

  // Build sanitized, human-readable deal summary text
  const parts = [];
  if (dealState.company?.value) parts.push(`Company: ${dealState.company.value}`);
  if (dealState.teamSize?.value) parts.push(`Team Size: ${dealState.teamSize.value} reps`);
  if (dealState.pain?.value) parts.push(`Primary Pain: ${dealState.pain.value}`);
  if (dealState.meddic?.metrics?.value) parts.push(`Metrics: ${dealState.meddic.metrics.value}`);
  if (dealState.meddic?.economicBuyer?.value) parts.push(`Economic Buyer: ${dealState.meddic.economicBuyer.value}`);
  if (dealState.competitor?.value) parts.push(`Competitor: ${dealState.competitor.value}`);
  if (dealState.budget?.value) parts.push(`Budget: ${dealState.budget.value}`);
  if (dealState.timeline?.value) parts.push(`Timeline: ${dealState.timeline.value}`);
  if (dealState.dealStage) parts.push(`Deal Stage: ${dealState.dealStage}`);
  if (dealState.nextBestAction?.action) parts.push(`Next Best Action: ${dealState.nextBestAction.action}`);

  const summaryText = parts.length > 0
    ? parts.join('. ') + '.'
    : `Deal ${dealId} in ${dealState.dealStage || 'DISCOVERY'} stage.`;

  const doc = {
    id: `deal_${dealId}`,
    text: summaryText,
    metadata: {
      organizationId: String(organizationId || ''),
      dealId: String(dealId || ''),
      sessionId: String(sessionId || ''),
      type: 'deal_context',
      title: `Deal Context for ${dealState.company?.value || dealId}`,
      source: 'authoritative_firestore',
      version: '1.0.0',
      updatedAt: new Date().toISOString()
    }
  };

  const client = getClient();
  const indexName = INDEX_NAMES.DEAL_CONTEXT;
  const localEngine = getLocalEngine();

  // Always seed local engine for active deal
  await localEngine.addDocs(indexName, [doc]);

  if (client && typeof client.addDocs === 'function' && client !== localEngine) {
    try {
      const existing = await client.listIndexes().catch(() => []);
      const indexExists = existing.some(idx => idx.name === indexName);
      if (indexExists) {
        await client.addDocs(indexName, [doc]);
      } else {
        await client.createIndex(indexName, [doc]);
      }
      return { success: true, indexName, dealId, isLocal: false };
    } catch (err) {
      console.warn(`[MOSS CLOUD SYNC] Deal context sync note for ${dealId}: ${err.message}. Local engine updated.`);
      return { success: true, indexName, dealId, isLocal: true };
    }
  }

  return { success: true, indexName, dealId, isLocal: true };
}

/**
 * Initialize all static indexes once on startup
 */
async function initializeAllIndexes() {
  const knowledgeRes = await syncKnowledgeDocs();
  return {
    knowledge: knowledgeRes,
    dealContext: { success: true, indexName: INDEX_NAMES.DEAL_CONTEXT, isLocal: isUsingLocalEngine },
    // Backwards compatibility mappings
    product: knowledgeRes,
    playbook: knowledgeRes,
    policy: knowledgeRes
  };
}

module.exports = {
  INDEX_NAMES,
  INDEX_VERSIONS,
  KNOWLEDGE_DOCS,
  PRODUCT_DOCS,
  PLAYBOOK_DOCS,
  POLICY_DOCS,
  getClient,
  getLocalEngine,
  syncKnowledgeDocs,
  syncProductDocs,
  syncPlaybookDocs,
  syncPolicyDocs,
  syncDealContext,
  initializeAllIndexes,
  LocalMemorySearchEngine
};
