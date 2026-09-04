require('dotenv').config();
const { admin, db } = require('../src/lib/firebase/admin');

async function main() {
  const [email, organizationId] = process.argv.slice(2);
  if (!email || !organizationId) throw new Error('Usage: node scripts/bootstrap-manager.js manager@example.com organization-id');
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { role: 'manager', organizationId });
  await db.collection('members').doc(user.uid).set({ uid: user.uid, email, organizationId, role: 'manager', status: 'ACTIVE', createdAt: new Date().toISOString() }, { merge: true });
  console.log(`Provisioned ${email} as manager for ${organizationId}`);
}
main().catch(error => { console.error(error.message); process.exit(1); });
