const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
let env;
test.before(async () => {
  if (!enabled) return;
  env = await initializeTestEnvironment({ projectId: 'dealforge-rules-test', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => { await context.firestore().collection('members').doc('manager-a').set({ organizationId: 'org-a', role: 'manager', status: 'ACTIVE' }); await context.firestore().collection('deals').doc('deal-a').set({ organizationId: 'org-a' }); await context.firestore().collection('deals').doc('deal-b').set({ organizationId: 'org-b' }); });
});
test.after(async () => { if (env) await env.cleanup(); });
test('emulator enforces anonymous denial, organization isolation, and browser write denial', { skip: !enabled }, async () => {
  await assertFails(env.unauthenticatedContext().firestore().collection('deals').doc('deal-a').get());
  const manager = env.authenticatedContext('manager-a', { role: 'manager', organizationId: 'org-a' }).firestore();
  await assertSucceeds(manager.collection('deals').doc('deal-a').get());
  await assertFails(manager.collection('deals').doc('deal-b').get());
  await assertFails(manager.collection('deals').doc('deal-a').update({ status: 'CLOSED_WON' }));
});
