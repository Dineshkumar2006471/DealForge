require('dotenv').config();
const { db } = require('../src/lib/firebase/admin');
const { createCallSession } = require('../src/lib/calls/callSessions');

async function createTestLink() {
  const dealId = 'test-deal-' + Date.now();
  const organizationId = 'test-org'; 
  const customerLabel = 'Test Customer';
  
  await db.collection('deals').doc(dealId).set({
    organizationId: organizationId,
    company: 'Test Company',
    targetArr: 50000,
    status: 'ACTIVE',
    health: 'GREEN',
    createdAt: new Date().toISOString()
  });

  const { linkToken } = await createCallSession({ dealId, customerLabel, expiresInMinutes: 60, organizationId, managerId: 'test-manager' });
  console.log(`LINK_TOKEN=${linkToken}`);
  process.exit(0);
}

createTestLink().catch(console.error);
