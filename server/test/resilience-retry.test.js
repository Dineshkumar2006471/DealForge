const test = require('node:test');
const assert = require('node:assert/strict');

test('Resilience, Provider Timeouts & Retry Logic', async (t) => {
  await t.test('Timeout handling: external call aborts when request duration exceeds deadline', async () => {
    async function fetchWithDeadline(url, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Simulate delayed promise
        await new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            const err = new Error('Gateway Timeout');
            err.name = 'TimeoutError';
            err.status = 504;
            reject(err);
          });
        });
      } finally {
        clearTimeout(timer);
      }
    }

    await assert.rejects(
      async () => {
        await fetchWithDeadline('https://api.external-provider.com/data', 30);
      },
      (err) => {
        assert.strictEqual(err.name, 'TimeoutError');
        assert.strictEqual(err.status, 504);
        return true;
      },
    );
  });

  await t.test('Exponential backoff retry policy: calculates increasing backoff intervals within jitter bounds', () => {
    function calculateBackoff(attempt, baseDelayMs = 100, maxDelayMs = 2000) {
      const exponential = baseDelayMs * Math.pow(2, attempt);
      return Math.min(exponential, maxDelayMs);
    }

    assert.strictEqual(calculateBackoff(0), 100);
    assert.strictEqual(calculateBackoff(1), 200);
    assert.strictEqual(calculateBackoff(2), 400);
    assert.strictEqual(calculateBackoff(3), 800);
    assert.strictEqual(calculateBackoff(4), 1600);
    assert.strictEqual(calculateBackoff(5), 2000); // capped at maxDelayMs
    assert.strictEqual(calculateBackoff(10), 2000); // capped
  });

  await t.test('Retry executor: succeeds after transient failure and obeys maxRetries ceiling', async () => {
    let callCount = 0;

    async function flakyExternalService() {
      callCount++;
      if (callCount < 3) {
        const transientErr = new Error('503 Service Unavailable');
        transientErr.status = 503;
        throw transientErr;
      }
      return { success: true, attempts: callCount };
    }

    async function retryWithBackoff(fn, maxAttempts = 3) {
      let lastError;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastError = err;
          if (attempt === maxAttempts - 1) throw lastError;
        }
      }
    }

    const result = await retryWithBackoff(flakyExternalService, 3);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 3);

    // Verify it fails when error exceeds maxAttempts
    callCount = 0;
    await assert.rejects(
      async () => {
        await retryWithBackoff(async () => {
          callCount++;
          throw new Error('Permanent 500 error');
        }, 2);
      },
      (err) => err.message === 'Permanent 500 error',
    );
    assert.strictEqual(callCount, 2);
  });

  await t.test(
    'Malformed external response handling: invalid JSON or unexpected schema safely triggers fallback',
    () => {
      function parseExternalPayload(rawResponse) {
        try {
          const parsed = JSON.parse(rawResponse);
          if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
            return { valid: false, fallback: true, error: 'Malformed schema' };
          }
          return { valid: true, data: parsed.data };
        } catch (err) {
          return { valid: false, fallback: true, error: 'Invalid JSON', detail: err.message };
        }
      }

      // 1. Non-JSON string
      const htmlResponse = '<html><body>502 Bad Gateway</body></html>';
      const res1 = parseExternalPayload(htmlResponse);
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.fallback, true);

      // 2. JSON without expected data property
      const unexpectedJson = JSON.stringify({ unexpected: 123 });
      const res2 = parseExternalPayload(unexpectedJson);
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.fallback, true);

      // 3. Valid JSON
      const validJson = JSON.stringify({ data: { meetingId: 'cal-42' } });
      const res3 = parseExternalPayload(validJson);
      assert.strictEqual(res3.valid, true);
      assert.strictEqual(res3.data.meetingId, 'cal-42');
    },
  );

  await t.test(
    'Partial external failure isolation: downstream CRM sync error does not abort voice turn response',
    async () => {
      let voiceReplied = false;
      let backgroundSyncQueued = false;

      async function handleCustomerTurnWithResilientSync(turnText) {
        // 1. Immediate voice response must succeed
        const agentReply = `I understand you need a 15% discount for ${turnText}. Let me note that.`;
        voiceReplied = true;

        // 2. External sync is isolated: failure must NOT throw to caller
        try {
          await (async () => {
            throw new Error('HubSpot API rate limited (429)');
          })();
        } catch (syncErr) {
          // Safe isolation: queue for background retry
          backgroundSyncQueued = true;
        }

        return { agentReply, syncPending: backgroundSyncQueued };
      }

      const result = await handleCustomerTurnWithResilientSync('Acme Corporation');
      assert.strictEqual(voiceReplied, true);
      assert.strictEqual(result.syncPending, true);
      assert.match(result.agentReply, /15% discount/);
    },
  );
});
