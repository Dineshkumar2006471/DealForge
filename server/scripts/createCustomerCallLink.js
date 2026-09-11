require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { createCallSession } = require(path.join(__dirname, '..', 'src', 'lib', 'calls', 'callSessions'));
const { db } = require(path.join(__dirname, '..', 'src', 'lib', 'firebase', 'admin'));

async function main() {
  const dealsSnap = await db.collection('deals').limit(1).get();
  if (dealsSnap.empty) {
    console.error('No deals found');
    process.exit(1);
  }
  const dealDoc = dealsSnap.docs[0];
  const dealId = dealDoc.id;
  const orgId = dealDoc.data().organizationId;

  const { session, linkToken } = await createCallSession({
    organizationId: orgId,
    dealId,
    managerId: 'manager-demo',
    customerLabel: 'Chrome Voice Test Customer',
    expiresInMinutes: 120
  });

  console.log('\n===============================================================');
  console.log('FRESH VERIFIED CUSTOMER CALL LINK CREATED');
  console.log('===============================================================');
  console.log(`Session ID    : ${session.sessionId}`);
  console.log(`Deal ID       : ${dealId}`);
  console.log(`Voice Provider: ${process.env.VOICE_PROVIDER || 'browser_speech'}`);
  console.log(`Local URL     : http://localhost:8080/call.html?token=${encodeURIComponent(linkToken)}`);
  console.log(`Hosted URL    : https://dealforge-507515.web.app/call.html?token=${encodeURIComponent(linkToken)}`);
  console.log('===============================================================\n');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
