/**
 * DealForge — Voice Latency Regression Benchmark
 *
 * NO-REGRESSION GATE: measures median, P95 for all latency stages.
 * Run against both CURRENT production and POST-deploy to validate improvements.
 *
 * Metrics captured per turn:
 *   - Server turn latency (total backend ms)
 *   - Gemini time-to-first-token (TTFT)
 *   - Gemini total generation time
 *   - TTS TTFB (time to first TTS byte)
 *   - First audio chunk time (SSE first audio_chunk event)
 *   - Total response time (done event)
 *
 * Usage:
 *   node server/scripts/voiceLatencyBenchmark.js [--runs=N] [--local]
 *
 * --local: test against local server (default: uses in-process supertest)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { performance } = require('perf_hooks');

const RUNS = parseInt(process.argv.find(a => a.startsWith('--runs='))?.split('=')[1] || '5', 10);
const PROMPTS = [
  'Hello, I have a sales team and I want to know your pricing.',
  'We have about 25 sales reps and our main challenge is inbound lead qualification.',
  'What kind of integration do you offer with Salesforce?',
  'Can you tell me about your security certifications?',
  'How long does implementation typically take?',
];

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Number(sorted[Math.max(0, idx)].toFixed(1));
}

async function measureTurn(app, linkToken, sessionCredential, userText) {
  const supertest = require('supertest');
  const t0 = performance.now();

  // Non-streaming path to get complete metrics from server
  const res = await supertest(app)
    .post(`/api/public/calls/${encodeURIComponent(linkToken)}/turn`)
    .send({ sessionCredential, userText })
    .expect(200);

  const t1 = performance.now();
  const m = res.body.metrics || {};

  return {
    totalServerMs: m.totalBackendMs || Math.round(t1 - t0),
    geminiTTFT: m.geminiFirstTokenMs || 0,
    geminiTotal: m.reasoningMs || 0,
    ttsTTFB: m.ttsTTFB || 0,
    ttsTotal: m.ttsMs || 0,
    evidenceMs: m.evidenceMs || 0,
    mossMs: m.mossLatencyMs || 0,
    endToEndMs: Math.round(t1 - t0),
    assistantTextLen: (res.body.assistantText || '').length,
  };
}

async function measureStreamingTurn(app, linkToken, sessionCredential, userText) {
  const supertest = require('supertest');
  const t0 = performance.now();
  let tFirstByte = 0;
  let tFirstAudio = 0;
  let tText = 0;
  let tDone = 0;
  let backendMetrics = {};

  const res = await supertest(app)
    .post(`/api/public/calls/${encodeURIComponent(linkToken)}/turn?stream=true`)
    .set('Accept', 'text/event-stream')
    .send({ sessionCredential, userText })
    .buffer(true)
    .parse((res, callback) => {
      let data = '';
      res.on('data', (chunk) => {
        if (!tFirstByte) tFirstByte = performance.now();
        data += chunk.toString();

        // Parse SSE events inline
        const blocks = data.split('\n\n');
        for (let i = 0; i < blocks.length - 1; i++) {
          const block = blocks[i];
          const eventMatch = block.match(/event:\s*(\w+)/);
          const dataMatch = block.match(/data:\s*(.*)/s);
          if (!eventMatch || !dataMatch) continue;
          try {
            const parsed = JSON.parse(dataMatch[1]);
            if (eventMatch[1] === 'text' && !tText) tText = performance.now();
            if (eventMatch[1] === 'audio_chunk' && !tFirstAudio) tFirstAudio = performance.now();
            if (eventMatch[1] === 'done') {
              tDone = performance.now();
              backendMetrics = parsed.metrics || {};
            }
          } catch (_) {}
        }
      });
      res.on('end', () => callback(null, data));
    });

  const tEnd = performance.now();

  return {
    totalServerMs: backendMetrics.totalBackendMs || Math.round(tEnd - t0),
    geminiTTFT: backendMetrics.geminiFirstTokenMs || 0,
    geminiTotal: backendMetrics.reasoningMs || 0,
    ttsTTFB: backendMetrics.ttsTTFB || 0,
    ttsTotal: backendMetrics.ttsMs || 0,
    evidenceMs: backendMetrics.evidenceMs || 0,
    mossMs: backendMetrics.mossLatencyMs || 0,
    firstByteMs: tFirstByte ? Math.round(tFirstByte - t0) : 0,
    firstAudioMs: tFirstAudio ? Math.round(tFirstAudio - t0) : 0,
    textEventMs: tText ? Math.round(tText - t0) : 0,
    doneMs: tDone ? Math.round(tDone - t0) : 0,
    endToEndMs: Math.round(tEnd - t0),
  };
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('DEALFORGE VOICE LATENCY REGRESSION BENCHMARK');
  console.log(`Runs: ${RUNS} | Prompts: ${PROMPTS.length}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Ensure SARVAM_API_KEY
  if (!process.env.SARVAM_API_KEY) {
    try {
      const { execSync } = require('child_process');
      process.env.SARVAM_API_KEY = execSync(
        'gcloud secrets versions access latest --secret=dealforge-sarvam-api-key --project=dealforge-507515',
        { encoding: 'utf8' },
      ).trim();
      console.log('✓ Retrieved SARVAM_API_KEY from Secret Manager');
    } catch (_) {
      console.warn('⚠ SARVAM_API_KEY not available — TTS will use mock fallback');
    }
  }

  const { createApp } = require(path.join(__dirname, '..', 'src', 'app'));
  const { createCallSession } = require(path.join(__dirname, '..', 'src', 'lib', 'calls', 'callSessions'));
  const { db } = require(path.join(__dirname, '..', 'src', 'lib', 'firebase', 'admin'));

  // Find a deal
  const dealsSnap = await db.collection('deals').limit(1).get();
  if (dealsSnap.empty) {
    console.error('FAIL: No deals found in Firestore');
    process.exit(1);
  }
  const dealDoc = dealsSnap.docs[0];
  const dealId = dealDoc.id;
  const orgId = dealDoc.data().organizationId;

  // Create session
  const { session, linkToken } = await createCallSession({
    organizationId: orgId,
    dealId,
    managerId: 'benchmark-runner',
    customerLabel: 'Latency Benchmark',
    expiresInMinutes: 60,
  });
  console.log(`Session: ${session.sessionId.slice(0, 12)}... Deal: ${dealId}`);

  const app = createApp();

  // Ready/greeting
  const supertest = require('supertest');
  await supertest(app)
    .post(`/api/public/calls/${encodeURIComponent(linkToken)}/ready`)
    .send({ sessionCredential: session.sessionCredential });
  console.log('✓ Greeting completed\n');

  // ─── NON-STREAMING BENCHMARK ───
  console.log('─── NON-STREAMING (JSON) TURNS ───');
  const jsonResults = [];
  for (let r = 0; r < RUNS; r++) {
    const prompt = PROMPTS[r % PROMPTS.length];
    const m = await measureTurn(app, linkToken, session.sessionCredential, prompt);
    jsonResults.push(m);
    console.log(
      `  [${r + 1}/${RUNS}] total=${m.totalServerMs}ms geminiTTFT=${m.geminiTTFT}ms geminiTotal=${m.geminiTotal}ms ttsTTFB=${m.ttsTTFB}ms evidence=${m.evidenceMs}ms moss=${m.mossMs}ms e2e=${m.endToEndMs}ms`,
    );
  }

  // ─── STREAMING BENCHMARK ───
  console.log('\n─── STREAMING (SSE) TURNS ───');

  // New session for streaming to avoid history buildup bias
  const { session: session2, linkToken: linkToken2 } = await createCallSession({
    organizationId: orgId,
    dealId,
    managerId: 'benchmark-runner',
    customerLabel: 'Latency Benchmark SSE',
    expiresInMinutes: 60,
  });
  await supertest(app)
    .post(`/api/public/calls/${encodeURIComponent(linkToken2)}/ready`)
    .send({ sessionCredential: session2.sessionCredential });

  const sseResults = [];
  for (let r = 0; r < RUNS; r++) {
    const prompt = PROMPTS[r % PROMPTS.length];
    const m = await measureStreamingTurn(app, linkToken2, session2.sessionCredential, prompt);
    sseResults.push(m);
    console.log(
      `  [${r + 1}/${RUNS}] total=${m.totalServerMs}ms firstByte=${m.firstByteMs}ms firstAudio=${m.firstAudioMs}ms geminiTTFT=${m.geminiTTFT}ms ttsTTFB=${m.ttsTTFB}ms e2e=${m.endToEndMs}ms`,
    );
  }

  // ─── REPORT ───
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('REGRESSION REPORT');
  console.log('═══════════════════════════════════════════════════════════');

  const report = (label, results, fields) => {
    console.log(`\n  ${label}:`);
    console.log('  ' + '─'.repeat(60));
    for (const field of fields) {
      const values = results.map((r) => r[field]).filter((v) => v > 0);
      if (!values.length) {
        console.log(`    ${field.padEnd(20)} : no data`);
        continue;
      }
      console.log(
        `    ${field.padEnd(20)} : median=${percentile(values, 50)}ms  P95=${percentile(values, 95)}ms  min=${Math.min(...values).toFixed(1)}ms  max=${Math.max(...values).toFixed(1)}ms`,
      );
    }
  };

  report('JSON (non-streaming)', jsonResults, [
    'totalServerMs',
    'geminiTTFT',
    'geminiTotal',
    'ttsTTFB',
    'ttsTotal',
    'evidenceMs',
    'mossMs',
    'endToEndMs',
  ]);

  report('SSE (streaming)', sseResults, [
    'totalServerMs',
    'geminiTTFT',
    'geminiTotal',
    'ttsTTFB',
    'ttsTotal',
    'firstByteMs',
    'firstAudioMs',
    'textEventMs',
    'doneMs',
    'endToEndMs',
  ]);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`Benchmark completed at ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════');

  process.exit(0);
}

run().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
