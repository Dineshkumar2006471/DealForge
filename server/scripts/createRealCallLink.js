const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '..', '.env') });
const { createCallSession } = require(path.join(__dirname, '..', 'src', 'lib', 'calls', 'callSessions'));

async function main() {
  const dealId = 'staging-negotiation-001';
  const organizationId = 'dealforge-staging';
  const customerLabel = 'Acme Corp VP Procurement';
  const managerId = 'fdLljqV90ESHqHRqhXTGmftybWk1';
  
  const { session, linkToken } = await createCallSession({
    dealId,
    customerLabel,
    expiresInMinutes: 1440,
    organizationId,
    managerId
  });
  
  console.log('REAL_CALL_LINK_CREATED');
  console.log('SESSION_ID=' + session.sessionId);
  console.log('LINK_TOKEN=' + linkToken);
  console.log('CHANNEL=' + session.opaqueAgoraChannel);
  console.log('CUSTOMER_UID=' + session.customerUid);
  console.log('CALL_URL=https://dealforge-507515.web.app/call.html?link=' + linkToken);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
