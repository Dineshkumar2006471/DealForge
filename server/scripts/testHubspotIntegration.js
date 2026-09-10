const path = require('path');
const { execSync } = require('child_process');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '..', '.env') });
const assert = require('assert/strict');

// If HUBSPOT_ACCESS_TOKEN not in process.env, load from Google Secret Manager
if (!process.env.HUBSPOT_ACCESS_TOKEN) {
  try {
    process.env.HUBSPOT_ACCESS_TOKEN = execSync('gcloud secrets versions access latest --secret=dealforge-hubspot-api-key').toString().trim();
  } catch (err) {
    console.error('Failed to load secret dealforge-hubspot-api-key from Secret Manager:', err.message);
  }
}

const { probeHubspot, verifyHubspotDeal, syncToHubspot } = require('../src/lib/integrations/hubspot');

async function main() {
  console.log('====================================================');
  console.log('STARTING REAL HUBSPOT INTEGRATION GATE TEST');
  console.log('====================================================');

  // 1. Probe HubSpot API
  console.log('\n--- 1. Probing HubSpot API ---');
  const probe = await probeHubspot();
  console.log('HubSpot probe result:', probe);
  assert.equal(probe.status, 'AVAILABLE', 'HubSpot probe status must be AVAILABLE');
  assert.equal(probe.verified, true, 'HubSpot probe must report verified=true');

  // 2. Verify Deal in HubSpot
  const hubspotDealId = '346165296872';
  console.log(`\n--- 2. Verifying HubSpot Deal ID: ${hubspotDealId} ---`);
  const dealInfo = await verifyHubspotDeal(hubspotDealId);
  console.log('HubSpot deal record:', dealInfo);
  assert.equal(dealInfo.hubspotDealId, hubspotDealId);
  assert.ok(dealInfo.dealName, 'HubSpot deal must have a dealName');

  // 3. Perform real update + read-back verification
  console.log('\n--- 3. Performing real HubSpot update + read-back verification ---');
  const testAmount = Math.floor(10000 + Math.random() * 5000);
  const updateResult = await syncToHubspot(
    { fields: { amount: testAmount, description: `DealForge gate test update at ${new Date().toISOString()}` } },
    { organizationId: 'dealforge-staging', dealId: 'staging-negotiation-001' }
  );

  console.log('HubSpot sync result:', updateResult);
  assert.equal(updateResult.verified, true, 'HubSpot sync must report verified=true');
  assert.equal(updateResult.externalStatus, 'SYNCED', 'HubSpot sync externalStatus must be SYNCED');
  assert.equal(updateResult.hubspotDealId, hubspotDealId);
  assert.ok(updateResult.syncedFields.includes('amount'));

  console.log('\n====================================================');
  console.log('🎉 REAL HUBSPOT UPDATE & READ-BACK VERIFIED (PASS)!');
  console.log('====================================================');
}

main().catch(err => {
  console.error('❌ HubSpot test failed:', err);
  process.exit(1);
});
