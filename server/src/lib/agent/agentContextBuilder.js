/**
 * DealForge — Agent Context Builder
 *
 * Combines authoritative Firestore deal state, compact Moss retrieval snippets,
 * commercial policy boundaries, and pending approvals into a compact prompt payload.
 *
 * Invariants:
 *  - Firestore remains authoritative over any conflicting Moss retrieved content.
 *  - Deterministic policy engine remains authoritative (Moss cannot authorize concessions).
 *  - Compact format avoids LLM context bloat and reduces Gemini generation latency.
 */

/**
 * Builds compact agent context for Gemini reasoning
 *
 * @param {object} params
 * @param {object} params.deal - Authoritative Firestore deal state
 * @param {Array}  params.retrievedDocs - Relevant snippets returned by Moss
 * @param {Array}  params.resolvedApprovals - Recent approved/rejected approvals
 * @param {Array}  params.pendingApprovals - Currently pending approvals
 * @returns {string} Formatted compact context string
 */
function buildCompactAgentContext({
  deal = {},
  retrievedDocs = [],
  resolvedApprovals = [],
  pendingApprovals = []
} = {}) {
  const sections = [];

  // 1. Authoritative Deal State (Always Wins)
  const dealLines = [];
  if (deal.company?.value) {
    dealLines.push(`Company: ${deal.company.value} (${deal.company.status || 'provisional'})`);
  }
  if (deal.teamSize?.value) {
    dealLines.push(`Team Size: ${deal.teamSize.value} reps (${deal.teamSize.status || 'provisional'})`);
  }
  if (deal.pain?.value) {
    dealLines.push(`Pain: ${deal.pain.value}`);
  }
  if (deal.meddic?.metrics?.value) {
    dealLines.push(`Metrics: ${deal.meddic.metrics.value}`);
  }
  if (deal.meddic?.economicBuyer?.value) {
    dealLines.push(`Economic Buyer: ${deal.meddic.economicBuyer.value}`);
  }
  if (deal.competitor?.value) {
    dealLines.push(`Evaluating Competitor: ${deal.competitor.value}`);
  }
  if (deal.budget?.value) {
    dealLines.push(`Budget: ${deal.budget.value}`);
  }
  if (deal.timeline?.value) {
    dealLines.push(`Timeline: ${deal.timeline.value}`);
  }
  if (deal.dealStage) {
    dealLines.push(`Current Stage: ${deal.dealStage}`);
  }
  if (dealLines.length > 0) {
    sections.push(`[AUTHORITATIVE DEAL STATE - SYSTEM OF RECORD]\n${dealLines.join('\n')}`);
  }

  // 2. Compact Retrieved Knowledge from Moss (Supplementary)
  if (Array.isArray(retrievedDocs) && retrievedDocs.length > 0) {
    const mossLines = retrievedDocs.map((doc, idx) => {
      // Keep snippets concise (max 200 chars per doc) to prevent prompt bloat
      const cleanText = (doc.text || '').replace(/\s+/g, ' ').trim();
      const snippet = cleanText.length > 200 ? cleanText.slice(0, 197) + '...' : cleanText;
      return `${idx + 1}. [${doc.title || doc.index}] ${snippet}`;
    });
    sections.push(`[RETRIEVED CONTEXT (MOSS RETRIEVAL ACCELERATOR)]\n${mossLines.join('\n')}`);
  }

  // 3. Commercial Policy Boundaries (Deterministic Enforcement)
  sections.push(
    `[COMMERCIAL POLICY BOUNDARIES]\n` +
    `- Autonomous discount limit: Up to 18% may be agreed to directly.\n` +
    `- Manager review required: Discounts between 18% and 25% require manager approval and must be queued as PENDING APPROVAL.\n` +
    `- Maximum hard limit: Discounts > 25% are strictly prohibited and must be rejected.\n` +
    `- Meeting scheduling: Direct customers to the verified meeting form; never confirm an unverified time slot.`
  );

  // 4. Active Pending & Resolved Approvals
  if (Array.isArray(pendingApprovals) && pendingApprovals.length > 0) {
    const pendingLines = pendingApprovals.map(a => `- Pending Approval: ${a.exactToolName} (${JSON.stringify(a.exactValidatedArguments)})`);
    sections.push(`[PENDING APPROVALS IN FLIGHT]\n${pendingLines.join('\n')}`);
  }

  if (Array.isArray(resolvedApprovals) && resolvedApprovals.length > 0) {
    const resolvedLines = resolvedApprovals.slice(-3).map(a => `- Resolved Approval: ${a.exactToolName} -> ${a.status}`);
    sections.push(`[RECENT RESOLVED APPROVALS]\n${resolvedLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

module.exports = {
  buildCompactAgentContext
};
