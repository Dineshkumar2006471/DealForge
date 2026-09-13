const test = require('node:test');
const assert = require('node:assert/strict');
const { retrieveRelevantContext, classifyRetrievalRoute } = require('../src/lib/retrieval/mossRetriever');
const { INDEX_NAMES, getLocalEngine } = require('../src/lib/retrieval/mossIndexer');

test('Moss Retrieval Layer & Fallback Engine Contract', async (t) => {
  await t.test('classifyRetrievalRoute: bypasses retrieval for greetings and small talk', () => {
    const greeting = classifyRetrievalRoute('Hello good morning');
    assert.strictEqual(greeting.route, 'GREETING');
    assert.strictEqual(greeting.indexes.length, 0);

    const smallTalk = classifyRetrievalRoute('sounds good thank you');
    assert.strictEqual(smallTalk.route, 'SMALL_TALK');
    assert.strictEqual(smallTalk.indexes.length, 0);

    const meeting = classifyRetrievalRoute('Can we schedule a call tomorrow?');
    assert.strictEqual(meeting.route, 'MEETING');
    assert.strictEqual(meeting.indexes.length, 0);
  });

  await t.test('classifyRetrievalRoute: correctly routes pricing, negotiation and product questions', () => {
    const pricingQ = classifyRetrievalRoute('What is your Enterprise tier pricing?');
    assert.strictEqual(pricingQ.route, 'PRICING');
    assert.ok(pricingQ.indexes.includes(INDEX_NAMES.KNOWLEDGE));

    const negoQ = classifyRetrievalRoute('Can you offer a discount on our budget?');
    assert.strictEqual(negoQ.route, 'NEGOTIATION');
    assert.ok(negoQ.indexes.includes(INDEX_NAMES.KNOWLEDGE));
    assert.ok(negoQ.indexes.includes(INDEX_NAMES.DEAL_CONTEXT));

    const prodQ = classifyRetrievalRoute('What compliance and security features do you support?');
    assert.strictEqual(prodQ.route, 'PRODUCT');
    assert.ok(prodQ.indexes.includes(INDEX_NAMES.KNOWLEDGE));
  });

  await t.test(
    'retrieveRelevantContext: returns empty results immediately for greeting bypass without latency hit',
    async () => {
      const res = await retrieveRelevantContext({
        userText: 'Hello there',
        organizationId: 'org-test',
        dealId: 'deal-test',
      });

      assert.strictEqual(res.results.length, 0);
      assert.strictEqual(res.route, 'GREETING');
      assert.ok(res.latencyMs < 10);
    },
  );

  await t.test(
    'retrieveRelevantContext: falls back smoothly to local engine when cloud client is offline',
    async () => {
      const localEngine = getLocalEngine();
      await localEngine.addDocs(INDEX_NAMES.KNOWLEDGE, [
        {
          id: 'prod-pricing-doc',
          text: 'Enterprise plan includes 99.9% uptime SLA, SSO, and dedicated account manager.',
          metadata: { title: 'Enterprise Pricing & SLA', type: 'pricing' },
        },
      ]);

      const res = await retrieveRelevantContext({
        userText: 'What is the Enterprise plan SLA and account manager offering?',
        organizationId: 'org-test',
        dealId: 'deal-test',
      });

      assert.ok(Array.isArray(res.results));
      assert.ok(res.results.length > 0);
      assert.match(res.results[0].text, /Enterprise plan includes/);
      assert.ok(typeof res.latencyMs === 'number');
    },
  );

  await t.test(
    'Multi-tenant isolation: deal context queries are strictly filtered by organizationId and dealId',
    async () => {
      const localEngine = getLocalEngine();
      await localEngine.addDocs(INDEX_NAMES.DEAL_CONTEXT, [
        {
          id: 'doc-tenant-a',
          text: 'Tenant A confidential discount approved 15 percent.',
          metadata: { title: 'Deal A', organizationId: 'org-A', dealId: 'deal-A' },
        },
        {
          id: 'doc-tenant-b',
          text: 'Tenant B confidential discount approved 25 percent.',
          metadata: { title: 'Deal B', organizationId: 'org-B', dealId: 'deal-B' },
        },
      ]);

      // Query as Tenant A
      const resA = await retrieveRelevantContext({
        userText: 'discount approved percent',
        organizationId: 'org-A',
        dealId: 'deal-A',
      });

      // Verify Tenant A never receives Tenant B documents
      for (const doc of resA.results) {
        assert.notStrictEqual(doc.id, 'doc-tenant-b', 'Tenant A must never receive Tenant B documents');
      }
    },
  );
});
