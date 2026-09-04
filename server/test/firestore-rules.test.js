const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('Firestore rules default deny browser writes to sensitive collections', () => {
  const rules = fs.readFileSync(require('node:path').join(__dirname, '..', '..', 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false;/);
  for (const collection of ['deals', 'approvals', 'evidence', 'auditEvents', 'meetings', 'callSessions']) assert.match(rules, new RegExp(`match \/${collection}\\/\\{`));
  assert.doesNotMatch(rules, /allow read, write: if true/);
});
