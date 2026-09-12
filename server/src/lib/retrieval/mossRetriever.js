/**
 * DealForge — Moss Low-Latency Context Retriever
 *
 * Retrieves relevant product, playbook, policy, and deal context using Moss.
 *
 * Architecture: 2-Index Strategy
 *  1. dealforge-knowledge    - Unified product, pricing, playbook, competitor & policy context
 *  2. dealforge-deal-context  - Dynamic active deal context
 *
 * Requirements:
 *  - Enforces strict retrieval routing (greetings, small talk, and direct tool actions bypass retrieval).
 *  - Maximum 80ms retrieval timeout with safe fallback.
 *  - Never returns raw credentials or secrets.
 *  - Records monotonic retrieval latency (P50/P95/P99 observability).
 *  - Organization & deal ID isolation enforced.
 */

const { INDEX_NAMES, getClient, getLocalEngine } = require('./mossIndexer');

const RETRIEVAL_TIMEOUT_MS = 60;

// Simple memory cache for static index query results
const queryCache = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute for static knowledge queries

/**
 * Classify customer utterance into retrieval topics
 */
function classifyRetrievalRoute(userText) {
  const text = String(userText || '').toLowerCase().trim();

  // 1. Greetings & Pleasantries -> No retrieval
  if (!text || (/^(hi|hello|hey|good\s*(morning|afternoon|evening)|howdy|sup)\b/i.test(text) && text.split(/\s+/).length <= 4)) {
    return { route: 'GREETING', indexes: [] };
  }

  // 2. Small Talk -> No retrieval
  if (/^(how are you|who are you|thanks|thank you|ok|okay|yes|no|got it|sure|sounds good)\b/i.test(text) && text.split(/\s+/).length <= 5) {
    return { route: 'SMALL_TALK', indexes: [] };
  }

  // 3. Meeting requests -> Action path (Cal.com); bypass retrieval
  if (/(?:schedule|book|set up)\s*(?:a\s*)?(?:review|meeting|call|demo|follow-up)/i.test(text) || (/\b(tomorrow|available|slots?|calendar|meet)\b/i.test(text) && /meet/i.test(text))) {
    return { route: 'MEETING', indexes: [] };
  }

  // 4. CRM operations -> Action path (HubSpot); bypass retrieval
  if (/\b(crm|hubspot|salesforce|sync contacts?|update record)\b/i.test(text) && /(?:sync|update|send|export)/i.test(text)) {
    return { route: 'CRM', indexes: [] };
  }

  // 5. Pricing questions -> Knowledge index
  if (/\b(price|pricing|cost|how much|per seat|tier|package|plan|subscription|rate|annual discount)\b/i.test(text)) {
    return { route: 'PRICING', indexes: [INDEX_NAMES.KNOWLEDGE] };
  }

  // 6. Negotiation & Discounts -> Knowledge + Deal Context
  if (/\b(discount|concession|better rate|cheaper|lower price|deal|budget|afford|off)\b/i.test(text)) {
    return { route: 'NEGOTIATION', indexes: [INDEX_NAMES.KNOWLEDGE, INDEX_NAMES.DEAL_CONTEXT] };
  }

  // 7. Competitor comparison -> Knowledge
  if (/\b(competitor|alternative|salesforce|gong|outreach|versus|vs|other options)\b/i.test(text)) {
    return { route: 'COMPETITOR', indexes: [INDEX_NAMES.KNOWLEDGE] };
  }

  // 8. Deal qualification / status -> Deal Context
  if (/\b(status|stage|timeline|economic buyer|decision maker|champion|meddic|reps|team size)\b/i.test(text)) {
    return { route: 'DEAL_STATUS', indexes: [INDEX_NAMES.DEAL_CONTEXT] };
  }

  // 9. General product inquiry -> Knowledge
  if (/\b(features?|capabilities|integrate|security|compliance|soc2|sla|support|demo|how does it work)\b/i.test(text)) {
    return { route: 'PRODUCT', indexes: [INDEX_NAMES.KNOWLEDGE] };
  }

  // Default: search knowledge index with topK
  return { route: 'GENERAL', indexes: [INDEX_NAMES.KNOWLEDGE] };
}

/**
 * Execute a single index query with a strict timeout
 */
async function querySingleIndexWithTimeout(client, indexName, queryText, options = {}, timeoutMs = RETRIEVAL_TIMEOUT_MS) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Moss query timeout after ${timeoutMs}ms on ${indexName}`)), timeoutMs);
  });

  try {
    const queryPromise = (async () => {
      if (typeof client.query === 'function') {
        return await client.query(indexName, queryText, options);
      }
      return { query: queryText, docs: [] };
    })();

    const result = await Promise.race([queryPromise, timeoutPromise]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Primary retrieval service
 *
 * @param {object} params
 * @param {string} params.organizationId
 * @param {string} params.dealId
 * @param {string} params.sessionId
 * @param {string} params.userText
 * @param {string} [params.topic]
 * @param {number} [params.topK=3]
 * @returns {Promise<{ results: Array, latencyMs: number, index: string, provider: string, cacheHit: boolean }>}
 */
async function retrieveRelevantContext({
  organizationId = 'dealforge-staging',
  dealId = null,
  sessionId = null,
  userText = '',
  topic = null,
  topK = 3
} = {}) {
  const tStart = performance.now();

  if (!userText || !userText.trim()) {
    return {
      results: [],
      latencyMs: 0,
      index: 'none',
      provider: 'moss',
      cacheHit: false,
      route: 'EMPTY'
    };
  }

  // Route classification
  const routeDecision = topic ? { route: topic.toUpperCase(), indexes: [INDEX_NAMES.KNOWLEDGE] } : classifyRetrievalRoute(userText);
  if (!routeDecision.indexes || routeDecision.indexes.length === 0) {
    const latencyMs = Number((performance.now() - tStart).toFixed(2));
    return {
      results: [],
      latencyMs,
      index: 'bypass',
      provider: 'moss',
      cacheHit: false,
      route: routeDecision.route
    };
  }

  // Deduplicate requested indexes
  const targetIndexes = Array.from(new Set(routeDecision.indexes));

  // Cache check for static queries
  const isDealSpecific = targetIndexes.includes(INDEX_NAMES.DEAL_CONTEXT);
  const cacheKey = `${routeDecision.route}:${userText.trim().toLowerCase()}`;
  if (!isDealSpecific && queryCache.has(cacheKey)) {
    const cached = queryCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      const latencyMs = Number((performance.now() - tStart).toFixed(2));
      return {
        results: cached.results,
        latencyMs,
        index: cached.index,
        provider: 'moss',
        cacheHit: true,
        route: routeDecision.route
      };
    }
    queryCache.delete(cacheKey);
  }

  const client = getClient();
  const allResults = [];
  const primaryIndex = targetIndexes[0];

  try {
    const queryPromises = targetIndexes.map(async (indexName) => {
      const queryOptions = {
        topK: Math.max(1, Math.min(topK, 5))
      };
      if (indexName === INDEX_NAMES.DEAL_CONTEXT) {
        queryOptions.filter = { organizationId, dealId };
      }
      return querySingleIndexWithTimeout(client, indexName, userText, queryOptions, RETRIEVAL_TIMEOUT_MS);
    });

    const settledResults = await Promise.all(queryPromises);
    for (let i = 0; i < settledResults.length; i++) {
      const res = settledResults[i];
      const indexName = targetIndexes[i];
      if (res && Array.isArray(res.docs)) {
        for (const doc of res.docs) {
          allResults.push({
            id: doc.id,
            title: doc.metadata?.title || doc.id,
            text: doc.text || '',
            score: typeof doc.score === 'number' ? Number(doc.score.toFixed(4)) : 0.5,
            index: indexName,
            type: doc.metadata?.type || 'general'
          });
        }
      }
    }

    // Sort by relevance score
    allResults.sort((a, b) => b.score - a.score);
    const finalResults = allResults.slice(0, topK);
    const latencyMs = Number((performance.now() - tStart).toFixed(2));

    // Cache if purely static
    if (!isDealSpecific && finalResults.length > 0) {
      queryCache.set(cacheKey, {
        results: finalResults,
        index: primaryIndex,
        timestamp: Date.now()
      });
    }

    return {
      results: finalResults,
      latencyMs,
      index: primaryIndex,
      provider: 'moss',
      cacheHit: false,
      route: routeDecision.route
    };
  } catch (err) {
    // Safe diagnostic log — never leak secrets or customer credentials
    console.warn(`[MOSS RETRIEVAL FALLBACK] ${primaryIndex}: ${err.message}. Serving from local search engine.`);
    
    // High-speed fallback to LocalMemorySearchEngine so retrieval never fails silently
    const localEngine = getLocalEngine();
    let fallbackDocs = [];
    try {
      for (const indexName of targetIndexes) {
        const queryOptions = {
          topK: Math.max(1, Math.min(topK, 5))
        };
        if (indexName === INDEX_NAMES.DEAL_CONTEXT) {
          queryOptions.filter = { organizationId, dealId };
        }
        const localRes = await localEngine.query(indexName, userText, queryOptions);
        if (localRes && Array.isArray(localRes.docs)) {
          for (const doc of localRes.docs) {
            fallbackDocs.push({
              id: doc.id,
              title: doc.metadata?.title || doc.id,
              text: doc.text || '',
              score: typeof doc.score === 'number' ? Number(doc.score.toFixed(4)) : 0.5,
              index: indexName,
              type: doc.metadata?.type || 'general'
            });
          }
        }
      }
      fallbackDocs.sort((a, b) => b.score - a.score);
    } catch (_) {}

    const latencyMs = Number((performance.now() - tStart).toFixed(2));
    return {
      results: fallbackDocs.slice(0, topK),
      latencyMs,
      index: primaryIndex,
      provider: 'moss_fallback',
      cacheHit: false,
      route: routeDecision.route,
      error: err.message
    };
  }
}

module.exports = {
  retrieveRelevantContext,
  classifyRetrievalRoute,
  RETRIEVAL_TIMEOUT_MS
};
