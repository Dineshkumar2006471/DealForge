const test = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_PROMPT, TURN_STABILITY_RULES, buildSystemPrompt } = require('../src/lib/llm/systemPrompt');

// ─── SYSTEM_PROMPT static content ────────────────────────────────────────────
test('SYSTEM_PROMPT includes MEDDIC qualification framework', () => {
  assert.match(SYSTEM_PROMPT, /MEDDIC/);
  assert.match(SYSTEM_PROMPT, /Metrics/);
  assert.match(SYSTEM_PROMPT, /Economic Buyer/);
  assert.match(SYSTEM_PROMPT, /Decision Criteria/);
  assert.match(SYSTEM_PROMPT, /Decision Process/);
  assert.match(SYSTEM_PROMPT, /Identify Pain/);
  assert.match(SYSTEM_PROMPT, /Champion/);
});

test('SYSTEM_PROMPT includes discount policy rules', () => {
  assert.match(SYSTEM_PROMPT, /18%/);
  assert.match(SYSTEM_PROMPT, /25%/);
  assert.match(SYSTEM_PROMPT, /calculate_discount/);
});

test('SYSTEM_PROMPT includes evidence extraction rules', () => {
  assert.match(SYSTEM_PROMPT, /confidence/i);
  assert.match(SYSTEM_PROMPT, /update_deal_state/);
});

test('SYSTEM_PROMPT includes safety constraints', () => {
  assert.match(SYSTEM_PROMPT, /NEVER/);
  assert.match(SYSTEM_PROMPT, /never/i);
});

test('SYSTEM_PROMPT does not contain hardcoded secrets or API keys', () => {
  assert.doesNotMatch(SYSTEM_PROMPT, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(SYSTEM_PROMPT, /sk-[a-zA-Z0-9]{20,}/);
  assert.doesNotMatch(SYSTEM_PROMPT, /BEGIN (RSA |EC )?PRIVATE KEY/);
  assert.doesNotMatch(SYSTEM_PROMPT, /password\s*[:=]\s*['"]\S+/i);
});

test('SYSTEM_PROMPT mentions the persona as DealForge', () => {
  assert.match(SYSTEM_PROMPT, /DealForge/);
});

test('SYSTEM_PROMPT instructs to never reveal being an AI', () => {
  assert.match(SYSTEM_PROMPT, /Never say "As an AI"/i);
});

// ─── TURN_STABILITY_RULES ────────────────────────────────────────────────────
test('TURN_STABILITY_RULES is a non-empty string', () => {
  assert.ok(typeof TURN_STABILITY_RULES === 'string');
  assert.ok(TURN_STABILITY_RULES.length > 0);
});

// ─── buildSystemPrompt ───────────────────────────────────────────────────────
test('buildSystemPrompt returns base prompt when no deal context is provided', () => {
  const prompt = buildSystemPrompt({});
  assert.ok(prompt.includes('DealForge'));
  assert.ok(prompt.includes('MEDDIC'));
});

test('buildSystemPrompt injects verified deal state when deal is provided', () => {
  const dealContext = {
    deal: {
      company: 'Acme Corp',
      teamSize: 50,
      conversationStage: 'NEGOTIATE',
      status: 'ACTIVE',
      pain: 'Manual scheduling wastes 10 hours/week',
    },
  };
  const prompt = buildSystemPrompt(dealContext);
  assert.match(prompt, /Acme Corp/);
  assert.match(prompt, /NEGOTIATE/);
  assert.match(prompt, /VERIFIED DEAL STATE/);
});

test('buildSystemPrompt includes retrieved knowledge docs when provided', () => {
  const dealContext = {
    retrievedDocs: [{ id: 'doc-1', title: 'Pricing', text: 'Enterprise plan is $149/month' }],
  };
  const prompt = buildSystemPrompt(dealContext);
  assert.match(prompt, /RETRIEVED KNOWLEDGE/);
  assert.match(prompt, /Enterprise plan/);
});

test('buildSystemPrompt includes negotiation memory when provided', () => {
  const dealContext = {
    negotiationMemory: [{ turn_stated: 3, preference: '20% discount', context: 'Competitor pricing' }],
  };
  const prompt = buildSystemPrompt(dealContext);
  assert.match(prompt, /20% discount/);
  assert.match(prompt, /Competitor pricing/);
});

test('buildSystemPrompt includes resolved approvals when provided', () => {
  const dealContext = {
    resolvedApprovals: [
      { status: 'APPROVED', exactToolName: 'calculate_discount', exactValidatedArguments: { requested_pct: 20 } },
    ],
  };
  const prompt = buildSystemPrompt(dealContext);
  assert.match(prompt, /APPROVED/);
  assert.match(prompt, /calculate_discount/);
});

test('buildSystemPrompt never leaks process.env values', () => {
  const prompt = buildSystemPrompt({ deal: { company: 'Test' } });
  assert.doesNotMatch(prompt, /process\.env/);
  assert.doesNotMatch(prompt, /SARVAM_API_KEY/);
  assert.doesNotMatch(prompt, /OPENAI_API_KEY/);
  assert.doesNotMatch(prompt, /FIREBASE_PROJECT_ID/);
});
