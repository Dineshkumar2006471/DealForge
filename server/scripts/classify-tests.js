const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testDir = path.resolve(__dirname, '..', 'test');
const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js')).sort();

const classification = {
  contract: [
    'calcom-contract.test.js',
    'hubspot-contract.test.js',
    'gemini-contract.test.js',
    'moss-contract.test.js',
    'firestore-contract.test.js',
    'integrations-contract.test.js',
    'sse-fallback-contract.test.js',
    'frontend-components.test.js',
  ],
  security: [
    'security-adversarial.test.js',
    'api-auth.test.js',
    'auth-manager.test.js',
    'call-session-security.test.js',
    'frontend-security.test.js',
    'tenant-isolation.test.js',
    'webhook-auth.test.js',
  ],
  integration: [
    'enterprise-turn-pipeline.test.js',
    'concurrency-idempotency.test.js',
    'resilience-retry.test.js',
    'tools-execution.test.js',
    'approval-queue.test.js',
    'evidence-store.test.js',
    'moss-retrieval.test.js',
  ],
  e2e: ['e2e-sales-turn.test.js'],
  emulator: ['firestore-emulator.test.js'],
};

const results = [];
let totalCount = 0;
let totalPassed = 0;
let totalSkipped = 0;
let totalFailed = 0;

for (const file of files) {
  let category = 'unit';
  for (const [cat, list] of Object.entries(classification)) {
    if (list.includes(file)) {
      category = cat;
      break;
    }
  }

  const filePath = path.join(testDir, file);
  try {
    const stdout = execSync(`node --test "${filePath}"`, {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test', FIREBASE_PROJECT_ID: 'dealforge-507515' },
      stdio: 'pipe',
    }).toString();

    // Parse test count
    const testsMatch = stdout.match(/ℹ tests (\d+)/);
    const passMatch = stdout.match(/ℹ pass (\d+)/);
    const skipMatch = stdout.match(/ℹ skipped (\d+)/);
    const failMatch = stdout.match(/ℹ fail (\d+)/);

    const count = testsMatch ? parseInt(testsMatch[1], 10) : 0;
    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;

    totalCount += count;
    totalPassed += passed;
    totalSkipped += skipped;
    totalFailed += failed;

    results.push({ file, category, count, passed, skipped, failed });
  } catch (err) {
    console.error(`Error running ${file}:`, err.message);
  }
}

console.log('='.repeat(90));
console.log('Test File'.padEnd(42) + 'Category'.padEnd(16) + 'Tests'.padEnd(10) + 'Pass'.padEnd(8) + 'Skip'.padEnd(8) + 'Fail');
console.log('-'.repeat(90));

const categorySummary = {
  unit: 0,
  integration: 0,
  contract: 0,
  security: 0,
  e2e: 0,
  emulator: 0,
};

for (const r of results) {
  categorySummary[r.category] += r.count;
  console.log(
    r.file.padEnd(42) +
      r.category.toUpperCase().padEnd(16) +
      String(r.count).padEnd(10) +
      String(r.passed).padEnd(8) +
      String(r.skipped).padEnd(8) +
      String(r.failed)
  );
}

console.log('='.repeat(90));
console.log(`TOTAL SUITES: ${results.length} files`);
console.log(`TOTAL TESTS:  ${totalCount} (Passed: ${totalPassed}, Skipped: ${totalSkipped}, Failed: ${totalFailed})`);
console.log('='.repeat(90));
console.log('CATEGORY BREAKDOWN:');
for (const [cat, count] of Object.entries(categorySummary)) {
  console.log(`- ${cat.toUpperCase().padEnd(14)}: ${count} tests`);
}
