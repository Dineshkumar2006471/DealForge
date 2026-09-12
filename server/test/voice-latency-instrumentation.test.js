const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Validates monotonic latency calculations and safe diagnostic formatting
 */
function calculateTurnLatencyMetrics(clientTimestamps = {}, serverTimestamps = {}) {
  const { t0, t1, t2, t3, t4, t5, t6, t7 } = clientTimestamps;
  const { s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15 } = serverTimestamps;

  const asrFinalizationMs = (t3 && t1) ? (t3 - t1) : 0;
  const turnNetworkMs = (t5 && t4) ? (t5 - t4) : 0;
  const serverEntryMs = (s1 && s0) ? (s1 - s0) : 0;
  const turnClaimMs = (s2 && s1) ? (s2 - s1) : 0;
  const evidenceMs = (s4 && s3) ? (s4 - s3) : 0;
  const policyMs = (s6 && s5) ? (s6 - s5) : 0;
  const geminiTtfuMs = (s8 && s7) ? (s8 - s7) : 0;
  const geminiTotalMs = (s9 && s7) ? (s9 - s7) : 0;
  const toolsMs = (s11 && s10) ? (s11 - s10) : 0;
  const ttsTtfbMs = (s13 && s12) ? (s13 - s12) : 0;
  const ttsTotalMs = (s14 && s12) ? (s14 - s12) : 0;
  const serverTotalMs = (s15 && s0) ? (s15 - s0) : 0;
  const audioStartupMs = (t7 && t6) ? (t7 - t6) : 0;
  const endToEndTtfaMs = (t7 && t1) ? (t7 - t1) : ((t7 && t4) ? (t7 - t4) : 0);

  const diagnosticLine = `[VOICE LATENCY] speechEnd=${t1 ? t1.toFixed(0) : '—'} finalTranscript=${t3 ? t3.toFixed(0) : '—'} turnSubmit=${t4 ? t4.toFixed(0) : '—'} backend=${serverTotalMs.toFixed(0)}ms evidence=${evidenceMs.toFixed(0)}ms policy=${policyMs.toFixed(0)}ms geminiTTFU=${geminiTtfuMs.toFixed(0)}ms tools=${toolsMs.toFixed(0)}ms ttsTTFB=${ttsTtfbMs.toFixed(0)}ms playback=${t7 ? t7.toFixed(0) : '—'} TOTAL_TTFA=${endToEndTtfaMs ? endToEndTtfaMs.toFixed(0) + 'ms' : '—'}`;

  return {
    asrFinalizationMs,
    turnNetworkMs,
    serverEntryMs,
    turnClaimMs,
    evidenceMs,
    policyMs,
    geminiTtfuMs,
    geminiTotalMs,
    toolsMs,
    ttsTtfbMs,
    ttsTotalMs,
    serverTotalMs,
    audioStartupMs,
    endToEndTtfaMs,
    diagnosticLine
  };
}

describe('Voice Latency Instrumentation & Diagnostic Rules', () => {
  it('1. Correctly calculates monotonic client and server intervals', () => {
    // Monotonic simulation: user speaks for 1.5s, whisper finalizes in 350ms,
    // turn submitted, server processes in 600ms (Gemini TTFU 250ms, TTS TTFB 200ms),
    // browser receives chunk 1 in 20ms and begins playback in 15ms.
    const client = {
      t0: 1000.0,
      t1: 2500.0,
      t2: 2600.0,
      t3: 2850.0,
      t4: 2860.0,
      t5: 3480.0,
      t6: 3500.0,
      t7: 3515.0
    };

    const server = {
      s0: 2870,
      s1: 2875,
      s2: 2880,
      s3: 2885,
      s4: 2895,
      s5: 2896,
      s6: 2898,
      s7: 2900,
      s8: 3150,
      s9: 3300,
      s10: 3305,
      s11: 3310,
      s12: 3315,
      s13: 3515,
      s14: 3750,
      s15: 3760
    };

    const metrics = calculateTurnLatencyMetrics(client, server);

    assert.equal(metrics.asrFinalizationMs, 350); // t3 - t1
    assert.equal(metrics.turnNetworkMs, 620); // t5 - t4
    assert.equal(metrics.serverEntryMs, 5); // s1 - s0
    assert.equal(metrics.turnClaimMs, 5); // s2 - s1
    assert.equal(metrics.evidenceMs, 10); // s4 - s3
    assert.equal(metrics.policyMs, 2); // s6 - s5
    assert.equal(metrics.geminiTtfuMs, 250); // s8 - s7
    assert.equal(metrics.geminiTotalMs, 400); // s9 - s7
    assert.equal(metrics.toolsMs, 5); // s11 - s10
    assert.equal(metrics.ttsTtfbMs, 200); // s13 - s12
    assert.equal(metrics.ttsTotalMs, 435); // s14 - s12
    assert.equal(metrics.serverTotalMs, 890); // s15 - s0
    assert.equal(metrics.audioStartupMs, 15); // t7 - t6
    assert.equal(metrics.endToEndTtfaMs, 1015); // t7 - t1 (Time to first audio from end of speech!)
  });

  it('2. Formats safe single diagnostic line matching prompt specification', () => {
    const client = { t0: 100, t1: 500, t2: 600, t3: 750, t4: 760, t5: 1200, t6: 1220, t7: 1240 };
    const server = { s0: 770, s1: 775, s2: 780, s3: 785, s4: 795, s5: 796, s6: 798, s7: 800, s8: 950, s9: 1050, s10: 1055, s11: 1060, s12: 1065, s13: 1185, s14: 1200, s15: 1210 };

    const { diagnosticLine } = calculateTurnLatencyMetrics(client, server);

    assert.ok(diagnosticLine.startsWith('[VOICE LATENCY]'));
    assert.ok(diagnosticLine.includes('speechEnd=500'));
    assert.ok(diagnosticLine.includes('finalTranscript=750'));
    assert.ok(diagnosticLine.includes('turnSubmit=760'));
    assert.ok(diagnosticLine.includes('backend=440ms'));
    assert.ok(diagnosticLine.includes('evidence=10ms'));
    assert.ok(diagnosticLine.includes('geminiTTFU=150ms'));
    assert.ok(diagnosticLine.includes('ttsTTFB=120ms'));
    assert.ok(diagnosticLine.includes('playback=1240'));
    assert.ok(diagnosticLine.includes('TOTAL_TTFA=740ms'));
  });

  it('3. Diagnostic logs never contain sensitive secrets, tokens, or PII', () => {
    const client = { t1: 100, t7: 900 };
    const server = { s0: 150, s15: 850 };
    const { diagnosticLine } = calculateTurnLatencyMetrics(client, server);

    const sensitiveWords = ['Bearer', 'sk-', 'key', 'token', 'secret', 'password', 'authorization'];
    for (const word of sensitiveWords) {
      assert.ok(!diagnosticLine.toLowerCase().includes(word), `Diagnostic must not include ${word}`);
    }
  });
});
