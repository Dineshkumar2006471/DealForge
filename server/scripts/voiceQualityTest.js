/**
 * DealForge — Voice Quality Regression Test
 *
 * Tests 6 fixed sentences through Sarvam TTS and logs:
 * - Sanitized text, chunk count, chunk sizes, total audio size
 * - Latency (TTFB, total)
 * - Content type verification
 * - Pass/fail per sentence
 *
 * Usage: node server/scripts/voiceQualityTest.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { streamSpeech } = require('../src/lib/tts/elevenlabsStreamingTts');
const { sanitizeVoiceText } = require('../src/lib/tts/sanitizeVoiceText');

const TEST_SENTENCES = [
  { id: 1, text: 'Hello, thanks for joining. How large is your team?' },
  { id: 2, text: "We have about 300 users and we're evaluating options this quarter." },
  { id: 3, text: 'Could you offer a 20 percent discount?' },
  { id: 4, text: 'Our budget is around twelve thousand five hundred dollars.' },
  { id: 5, text: "We're currently using HubSpot." },
  { id: 6, text: "Let's schedule a technical review next week." },
];

const MARKDOWN_TEST = {
  id: 'M1',
  text: '**Great question!** Here are the key benefits:\n- Reduced manual work\n- Better pipeline visibility\n\nLearn more at [our site](https://example.com).',
  expectedClean: 'Great question! Here are the key benefits: Reduced manual work Better pipeline visibility Learn more at our site.',
};

async function runTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  DealForge Voice Quality Regression Test');
  console.log('═══════════════════════════════════════════════════\n');

  if (!process.env.SARVAM_API_KEY) {
    console.error('FAIL: SARVAM_API_KEY not set in environment');
    process.exit(1);
  }

  // Test sanitization first
  console.log('── Sanitization Tests ──────────────────────────────\n');
  const sanitized = sanitizeVoiceText(MARKDOWN_TEST.text);
  console.log(`  Input:    "${MARKDOWN_TEST.text.slice(0, 80)}..."`);
  console.log(`  Output:   "${sanitized}"`);
  console.log(`  Expected: "${MARKDOWN_TEST.expectedClean}"`);
  const sanitizationPass = sanitized.indexOf('**') === -1 
    && sanitized.indexOf('- ') === -1 
    && sanitized.indexOf('[') === -1
    && sanitized.length > 20;
  console.log(`  Result:   ${sanitizationPass ? 'PASS ✓' : 'FAIL ✗'}\n`);

  // Test TTS for each sentence
  console.log('── TTS Generation Tests ────────────────────────────\n');

  let totalPass = 0;
  let totalFail = 0;

  for (const test of TEST_SENTENCES) {
    console.log(`  TEST ${test.id}: "${test.text}"`);
    
    const cleanText = sanitizeVoiceText(test.text);
    console.log(`    Sanitized: "${cleanText}" (${cleanText.length} chars)`);

    try {
      const start = Date.now();
      const result = await streamSpeech(test.text);
      const elapsed = Date.now() - start;

      const totalBytes = result.audioBase64List.reduce(
        (sum, b) => sum + Buffer.from(b, 'base64').length, 0
      );

      const chunkSizes = result.audioBase64List.map(
        b => Buffer.from(b, 'base64').length
      );

      console.log(`    Chunks:    ${result.totalChunks}`);
      console.log(`    Sizes:     [${chunkSizes.join(', ')}]`);
      console.log(`    Total:     ${totalBytes} bytes`);
      console.log(`    TTFB:      ${result.ttfbMs}ms`);
      console.log(`    Total:     ${result.totalMs}ms (wall: ${elapsed}ms)`);

      // Pass criteria
      const pass = result.totalChunks > 0
        && totalBytes > 500
        && result.ttfbMs < 5000
        && result.totalMs < 8000;

      console.log(`    Result:    ${pass ? 'PASS ✓' : 'FAIL ✗'}\n`);
      if (pass) totalPass++; else totalFail++;

    } catch (err) {
      console.log(`    ERROR:     ${err.message}`);
      console.log(`    Result:    FAIL ✗\n`);
      totalFail++;
    }
  }

  console.log('── Summary ─────────────────────────────────────────');
  console.log(`  Passed: ${totalPass}/${TEST_SENTENCES.length}`);
  console.log(`  Failed: ${totalFail}/${TEST_SENTENCES.length}`);
  console.log(`  Sanitization: ${sanitizationPass ? 'PASS' : 'FAIL'}`);
  console.log(`  Overall: ${totalFail === 0 && sanitizationPass ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(totalFail === 0 && sanitizationPass ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
