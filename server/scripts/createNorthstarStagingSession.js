const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { db } = require('../src/lib/firebase/admin');
const { createDeal } = require('../src/lib/firebase/dealState');
const { createCallSession } = require('../src/lib/calls/callSessions');

async function main() {
  const organizationId = 'dealforge-staging';
  const dealId = `northstar-staging-${Date.now()}`;
  const managerId = 'fdLljqV90ESHqHRqhXTGmftybWk1';

  console.log(`Creating fresh deal: ${dealId}`);
  await createDeal(dealId, {
    dealId,
    organizationId,
    company: { value: 'Pending', status: 'needs_confirmation', confidence: 0.1 },
    dealStage: 'DISCOVERY',
    conversationStage: 'DISCOVERY',
    targetArr: 1500000,
    currency: 'INR',
    createdAt: new Date().toISOString()
  });

  const { session, linkToken } = await createCallSession({
    organizationId,
    dealId,
    managerId,
    customerLabel: 'Northstar Labs VP Commercial',
    expiresInMinutes: 240
  });

  const callUrl = `https://dealforge-507515.web.app/call.html?link=${linkToken}`;
  const dashboardUrl = `https://dealforge-507515.web.app/dashboard.html?dealId=${dealId}&sessionId=${session.sessionId}`;

  console.log('====================================================');
  console.log('FRESH NORTHSTAR STAGING SESSION CREATED');
  console.log('====================================================');
  console.log(`ORGANIZATION_ID=${organizationId}`);
  console.log(`DEAL_ID=${dealId}`);
  console.log(`SESSION_ID=${session.sessionId}`);
  console.log(`LINK_TOKEN=${linkToken}`);
  console.log(`CALL_URL=${callUrl}`);
  console.log(`DASHBOARD_URL=${dashboardUrl}`);
  console.log('====================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('Failed to create Northstar staging session:', err);
  process.exit(1);
});
