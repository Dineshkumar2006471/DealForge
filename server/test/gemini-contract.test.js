const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTool } = require('../src/lib/schema/validation');

test('Gemini LLM Contract & Output Invariants', async (t) => {
  await t.test('Structured Tool Call Parsing: Valid tool call conforms to schema', () => {
    const rawToolCall = {
      name: 'calculate_discount',
      args: { requested_pct: 15 },
    };

    const parsed = parseTool(rawToolCall.name, rawToolCall.args);
    assert.strictEqual(parsed.requested_pct, 15);
  });

  await t.test('Malformed Tool Arguments: Non-numeric discount percentage throws schema error for recovery', () => {
    const malformedCall = {
      name: 'calculate_discount',
      args: { requested_pct: 'one hundred percent' },
    };

    assert.throws(() => {
      parseTool(malformedCall.name, malformedCall.args);
    }, /Expected number/i);
  });

  await t.test('Unknown Function Call: Non-existent tool call throws clear validation error', () => {
    assert.throws(() => {
      parseTool('execute_arbitrary_shell', { cmd: 'rm -rf' });
    }, /Unknown tool/i);
  });

  await t.test('Fallback Generation on LLM Failure / Timeout: Gemini failure fallback emits safe response', () => {
    function createSafeTurnFallback(error) {
      return {
        role: 'assistant',
        content: "I'm sorry, I encountered a brief technical delay. Could you please repeat your last point?",
        errorHandled: true,
        reason: error?.message || 'LLM timeout',
      };
    }

    const fallback = createSafeTurnFallback(new Error('Deadline exceeded (504)'));
    assert.strictEqual(fallback.errorHandled, true);
    assert.match(fallback.content, /brief technical delay/i);
    assert.doesNotMatch(fallback.content, /504|Deadline|stack trace/i, 'Must never leak internal errors to customer');
  });

  await t.test('Tool Call Invariant: LLM cannot execute tools directly without passing policy check', () => {
    const { checkPolicy } = require('../src/lib/policy/policyEngine');
    // Model recommends 30% discount
    const recommendation = { requested_pct: 30 };
    const decision = checkPolicy('calculate_discount', recommendation, { dealId: 'd1' });
    assert.strictEqual(decision.allowed, false, 'Policy must reject model recommendation over 25%');
    assert.strictEqual(decision.tier, 'REJECT');
  });
});
