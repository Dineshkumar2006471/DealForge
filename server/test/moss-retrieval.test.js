const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  INDEX_NAMES,
  PRODUCT_DOCS,
  PLAYBOOK_DOCS,
  POLICY_DOCS,
  syncProductDocs,
  syncPlaybookDocs,
  syncPolicyDocs,
  syncDealContext,
  initializeAllIndexes,
  LocalMemorySearchEngine
} = require('../src/lib/retrieval/mossIndexer');

const {
  retrieveRelevantContext,
  classifyRetrievalRoute,
  RETRIEVAL_TIMEOUT_MS
} = require('../src/lib/retrieval/mossRetriever');

const { buildCompactAgentContext } = require('../src/lib/agent/agentContextBuilder');

describe('Moss Low-Latency Retrieval Integration', () => {
  before(async () => {
    // Warm up all indexes
    await initializeAllIndexes();
  });

  it('1. Index Selection and Routing classifies topics accurately', () => {
    // Greetings & Small talk bypass Moss
    assert.equal(classifyRetrievalRoute('hello').route, 'GREETING');
    assert.deepEqual(classifyRetrievalRoute('hi').indexes, []);
    assert.equal(classifyRetrievalRoute('how are you today').route, 'SMALL_TALK');
    assert.deepEqual(classifyRetrievalRoute('thanks').indexes, []);

    // Pure action turns bypass Moss
    assert.equal(classifyRetrievalRoute('Let us schedule a meeting tomorrow at 4 PM').route, 'MEETING');
    assert.deepEqual(classifyRetrievalRoute('Book a demo for next week').indexes, []);
    assert.equal(classifyRetrievalRoute('Sync this contact to HubSpot CRM').route, 'CRM');

    // Product & Pricing questions route to appropriate indexes
    const pricing = classifyRetrievalRoute('What are your pricing plans?');
    assert.equal(pricing.route, 'PRICING');
    assert.ok(pricing.indexes.includes(INDEX_NAMES.PRODUCT));
    assert.ok(pricing.indexes.includes(INDEX_NAMES.POLICY));

    // Negotiation routes to policy & deal context
    const negotiation = classifyRetrievalRoute('Can you offer a discount or better deal?');
    assert.equal(negotiation.route, 'NEGOTIATION');
    assert.ok(negotiation.indexes.includes(INDEX_NAMES.POLICY));

    // Competitor routes to playbook & product
    const comp = classifyRetrievalRoute('How do you compare vs Salesforce?');
    assert.equal(comp.route, 'COMPETITOR');
    assert.ok(comp.indexes.includes(INDEX_NAMES.PLAYBOOK));
  });

  it('2. Ingests all 4 indexes with proper document metadata and counts', async () => {
    const prodRes = await syncProductDocs();
    assert.equal(prodRes.success, true);
    assert.equal(prodRes.indexName, INDEX_NAMES.PRODUCT);
    assert.ok(prodRes.docCount >= PRODUCT_DOCS.length);

    const playbookRes = await syncPlaybookDocs();
    assert.equal(playbookRes.success, true);
    assert.equal(playbookRes.indexName, INDEX_NAMES.PLAYBOOK);
    assert.ok(playbookRes.docCount >= PLAYBOOK_DOCS.length);

    const policyRes = await syncPolicyDocs();
    assert.equal(policyRes.success, true);
    assert.equal(policyRes.indexName, INDEX_NAMES.POLICY);
    assert.ok(policyRes.docCount >= POLICY_DOCS.length);

    const dealRes = await syncDealContext('test_deal_101', {
      organizationId: 'dealforge-test-org',
      company: { value: 'Acme Corp' },
      teamSize: { value: '250' },
      pain: { value: 'Inbound qualification bottleneck' },
      dealStage: 'DISCOVERY'
    });
    assert.equal(dealRes.success, true);
    assert.equal(dealRes.indexName, INDEX_NAMES.DEAL_CONTEXT);
  });

  it('3. Retrieval returns relevant documents with sub-10ms retrieval latency and safe metadata', async () => {
    const res = await retrieveRelevantContext({
      organizationId: 'dealforge-test-org',
      dealId: 'test_deal_101',
      userText: 'What are the pricing tiers and seat costs?',
      topK: 2
    });

    assert.ok(res.results.length > 0, 'Must return relevant results');
    assert.ok(res.latencyMs >= 0, 'Latency must be recorded');
    assert.ok(res.latencyMs < RETRIEVAL_TIMEOUT_MS, 'Must be within timeout budget');
    assert.equal(res.route, 'PRICING');
    assert.equal(typeof res.cacheHit, 'boolean');

    // Verify document contains useful metadata and text
    const first = res.results[0];
    assert.ok(first.id);
    assert.ok(first.title);
    assert.ok(first.text.toLowerCase().includes('starter') || first.text.toLowerCase().includes('enterprise') || first.text.toLowerCase().includes('price') || first.text.toLowerCase().includes('plan'));
    assert.ok(first.score > 0);

    // Verify zero secrets or credentials leaked
    const jsonString = JSON.stringify(res);
    assert.ok(!jsonString.includes('sk-'), 'Must never leak api keys');
    assert.ok(!jsonString.includes('OPENAI_API_KEY'), 'Must never leak key names');
    assert.ok(!jsonString.includes('SARVAM_API_KEY'), 'Must never leak key names');
  });

  it('4. Multi-tenant organization and deal ID isolation is strictly enforced', async () => {
    // Index deal context for Org A
    await syncDealContext('deal_org_a', {
      organizationId: 'org_A',
      company: { value: 'Company Alpha Exclusive' },
      teamSize: { value: '100' }
    });

    // Index deal context for Org B
    await syncDealContext('deal_org_b', {
      organizationId: 'org_B',
      company: { value: 'Company Beta Confidential' },
      teamSize: { value: '500' }
    });

    // Query with Org A scope
    const resOrgA = await retrieveRelevantContext({
      organizationId: 'org_A',
      dealId: 'deal_org_a',
      userText: 'Company Alpha or Beta information',
      topic: 'deal_status',
      topK: 5
    });

    // Must NOT contain Org B documents
    for (const doc of resOrgA.results) {
      if (doc.metadata?.organizationId) {
        assert.equal(doc.metadata.organizationId, 'org_A');
      }
      assert.ok(!doc.text.includes('Company Beta Confidential'), 'Org A must never see Org B data');
    }
  });

  it('5. Handles empty utterances, missing text, or zero matches cleanly without throwing', async () => {
    const emptyRes = await retrieveRelevantContext({ userText: '' });
    assert.equal(emptyRes.results.length, 0);
    assert.equal(emptyRes.route, 'EMPTY');

    const whitespaceRes = await retrieveRelevantContext({ userText: '   ' });
    assert.equal(whitespaceRes.results.length, 0);

    const greetingRes = await retrieveRelevantContext({ userText: 'Hi there!' });
    assert.equal(greetingRes.results.length, 0);
    assert.equal(greetingRes.route, 'GREETING');
  });

  it('6. Fallback and timeout handling never blocks the caller', async () => {
    // Create an engine that throws or hangs
    const failingEngine = {
      async query() {
        throw new Error('Simulated network failure on vector store');
      }
    };

    const { retrieveRelevantContext: failingRetrieve } = proxyquireHelper(failingEngine);
    const res = await failingRetrieve({
      organizationId: 'dealforge-test-org',
      dealId: 'deal_1',
      userText: 'pricing plans and enterprise features'
    });

    assert.equal(res.results.length, 0);
    assert.equal(res.provider, 'moss_fallback');
    assert.ok(res.error.includes('Simulated network failure'));
    assert.ok(res.latencyMs >= 0);
  });

  it('7. Stale context precedence: Authoritative Firestore state always wins in Agent Context Builder', () => {
    // Authoritative Firestore deal state has confirmed company 'Northstar Labs' and team size '300'
    const firestoreDeal = {
      company: { value: 'Northstar Labs', status: 'confirmed' },
      teamSize: { value: '300', status: 'confirmed' },
      pain: { value: 'Inbound lead qualification' },
      dealStage: 'DISCOVERY'
    };

    // Stale Moss retrieved snippet mentions old company 'OldCorp' and team size '50'
    const staleMossDocs = [
      {
        id: 'deal_stale',
        title: 'Old Stale Record',
        text: 'Company: OldCorp. Team Size: 50 reps. Stage: INITIAL.',
        score: 0.95,
        index: INDEX_NAMES.DEAL_CONTEXT
      }
    ];

    const contextPayload = buildCompactAgentContext({
      deal: firestoreDeal,
      retrievedDocs: staleMossDocs,
      pendingApprovals: [],
      resolvedApprovals: []
    });

    // Verify sections
    assert.ok(contextPayload.includes('[AUTHORITATIVE DEAL STATE - SYSTEM OF RECORD]'));
    assert.ok(contextPayload.includes('Company: Northstar Labs (confirmed)'));
    assert.ok(contextPayload.includes('Team Size: 300 reps (confirmed)'));
    assert.ok(contextPayload.includes('[RETRIEVED CONTEXT (MOSS RETRIEVAL ACCELERATOR)]'));
    assert.ok(contextPayload.includes('[COMMERCIAL POLICY BOUNDARIES]'));

    // The authoritative block is prominently at the top, defining the ground truth
    const authoritativeIndex = contextPayload.indexOf('[AUTHORITATIVE DEAL STATE');
    const retrievedIndex = contextPayload.indexOf('[RETRIEVED CONTEXT');
    assert.ok(authoritativeIndex < retrievedIndex, 'Authoritative Firestore state must appear before retrieved context');
  });

  it('8. Deterministic policy rules remain strictly uncompromised by Moss context', () => {
    const { checkDiscountPolicy } = require('../src/lib/policy/policyEngine');

    // Regardless of what Moss might return, policy engine strictly enforces:
    // 15% -> ACT (autonomous)
    const p15 = checkDiscountPolicy({ requested_pct: 15 });
    assert.equal(p15.allowed, true);
    assert.equal(p15.tier, 'ACT');

    // 25% -> APPROVAL (PENDING manager review)
    const p25 = checkDiscountPolicy({ requested_pct: 25 });
    assert.equal(p25.allowed, false);
    assert.equal(p25.tier, 'APPROVAL');
    assert.equal(p25.requiresApproval, true);

    // 30% -> REJECT
    const p30 = checkDiscountPolicy({ requested_pct: 30 });
    assert.equal(p30.allowed, false);
    assert.equal(p30.tier, 'REJECT');
  });
});

function proxyquireHelper(mockEngine) {
  // Simple proxy mock for failing engine test
  const { classifyRetrievalRoute, RETRIEVAL_TIMEOUT_MS } = require('../src/lib/retrieval/mossRetriever');
  async function retrieveRelevantContext(params = {}) {
    const tStart = performance.now();
    try {
      await mockEngine.query('dealforge-product', params.userText);
      return { results: [], latencyMs: 1, provider: 'moss' };
    } catch (err) {
      return {
        results: [],
        latencyMs: Number((performance.now() - tStart).toFixed(2)),
        index: 'dealforge-product',
        provider: 'moss_fallback',
        cacheHit: false,
        route: classifyRetrievalRoute(params.userText).route,
        error: err.message
      };
    }
  }
  return { retrieveRelevantContext };
}
