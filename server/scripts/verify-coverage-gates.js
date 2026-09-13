const fs = require('fs');
const path = require('path');

const summaryPath = path.resolve(__dirname, '..', 'coverage', 'coverage-summary.json');

if (!fs.existsSync(summaryPath)) {
  console.error('❌ Coverage summary not found at:', summaryPath);
  console.error('Run "npm run test:coverage" first to generate coverage artifacts.');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

// Helper to calculate aggregate metrics across multiple file keys
function aggregateMetrics(filterFn) {
  let coveredLines = 0;
  let totalLines = 0;
  let coveredStatements = 0;
  let totalStatements = 0;

  for (const [filePath, data] of Object.entries(summary)) {
    if (filePath === 'total') continue;
    const normalized = filePath.replace(/\\/g, '/');
    if (filterFn(normalized)) {
      coveredLines += data.lines.covered;
      totalLines += data.lines.total;
      coveredStatements += data.statements.covered;
      totalStatements += data.statements.total;
    }
  }

  return {
    linePct: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
    stmtPct: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
    totalLines,
    coveredLines,
  };
}

// Configured gate thresholds
const GATES = [
  {
    name: 'Policy Engine (src/lib/policy/)',
    targetLinePct: 95.0,
    targetStmtPct: 95.0,
    metrics: aggregateMetrics((p) => p.includes('src/lib/policy/')),
  },
  {
    name: 'Validation Schemas (src/lib/schema/validation.js)',
    targetLinePct: 95.0,
    targetStmtPct: 95.0,
    metrics: aggregateMetrics((p) => p.includes('src/lib/schema/validation.js')),
  },
  {
    name: 'Security & Auth (src/lib/security/auth.js)',
    targetLinePct: 95.0,
    targetStmtPct: 95.0,
    metrics: aggregateMetrics((p) => p.includes('src/lib/security/auth.js')),
  },
  {
    name: 'Webhook Security (src/lib/security/webhookAuth.js)',
    targetLinePct: 95.0,
    targetStmtPct: 95.0,
    metrics: aggregateMetrics((p) => p.includes('src/lib/security/webhookAuth.js')),
  },
  {
    name: 'Evidence Store & Confidence (src/lib/evidence/)',
    targetLinePct: 80.0,
    targetStmtPct: 80.0,
    metrics: aggregateMetrics((p) => p.includes('src/lib/evidence/')),
  },
  {
    name: 'Overall Monitored Backend',
    targetLinePct: 75.0,
    targetStmtPct: 75.0,
    metrics: {
      linePct: summary.total.lines.pct,
      stmtPct: summary.total.statements.pct,
      totalLines: summary.total.lines.total,
      coveredLines: summary.total.lines.covered,
    },
  },
];

console.log('================================================================================');
console.log('                 DEALFORGE ENFORCED COVERAGE THRESHOLD GATES                    ');
console.log('================================================================================');
console.log(
  'Category'.padEnd(45) +
    'Actual Line%'.padEnd(15) +
    'Target Line%'.padEnd(15) +
    'Status'
);
console.log('-'.repeat(80));

let allPassed = true;

for (const gate of GATES) {
  const linePassed = gate.metrics.linePct >= gate.targetLinePct;
  const stmtPassed = gate.metrics.stmtPct >= gate.targetStmtPct;
  const passed = linePassed && stmtPassed;

  if (!passed) allPassed = false;

  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(
    gate.name.padEnd(45) +
      `${gate.metrics.linePct.toFixed(2)}%`.padEnd(15) +
      `>=${gate.targetLinePct.toFixed(1)}%`.padEnd(15) +
      status
  );
}

console.log('================================================================================');

if (!allPassed) {
  console.error('\n❌ COVERAGE GATE ENFORCEMENT FAILED: One or more targets fell below required threshold.');
  process.exit(1);
}

console.log('✅ ALL COVERAGE GATES SATISFIED: All production modules meet required thresholds.\n');
process.exit(0);
