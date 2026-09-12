require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const assert = require('node:assert/strict');
const { db } = require('../src/lib/firebase/admin');
const { createDeal, getDeal } = require('../src/lib/firebase/dealState');
const { createCallSession } = require('../src/lib/calls/callSessions');
const { executeCustomerTurn } = require('../src/lib/agent/agentRuntime');

async function runNorthstarScenario() {
  console.log('===============================================================');
  console.log('DEALFORGE — NORTHSTAR LABS END-TO-END SCENARIO VERIFICATION');
  console.log('===============================================================');

  const orgId = 'dealforge-staging';
  const dealId = `northstar-e2e-${Date.now()}`;
  const managerId = 'fdLljqV90ESHqHRqhXTGmftybWk1';

  console.log(`\n[Stage 0: Deal Setup] Initializing clean test deal: ${dealId}`);
  await createDeal(dealId, {
    dealId,
    organizationId: orgId,
    company: { value: 'Pending', status: 'needs_confirmation', confidence: 0.1 },
    dealStage: 'DISCOVERY',
    conversationStage: 'DISCOVERY',
    createdAt: new Date().toISOString()
  });

  const { session, linkToken } = await createCallSession({
    organizationId: orgId,
    dealId,
    managerId,
    customerLabel: 'Northstar Labs E2E Test Session',
    expiresInMinutes: 120
  });
  console.log(`[Stage 0: Session Created] Session ID: ${session.sessionId}`);

  // --- TURN 1: Company & Team Size ---
  console.log('\n--- TURN 1: Company and Team Size ---');
  const turn1Text = "We're Northstar Labs. We have about 300 sales reps.";
  console.log(`Customer: "${turn1Text}"`);
  const turn1Res = await executeCustomerTurn(session, turn1Text, { turnId: 'turn_1' });
  console.log(`Agent: "${turn1Res.content}"`);

  const stateTurn1 = await getDeal(dealId, orgId, session.sessionId);
  assert.ok(stateTurn1.company, 'Company field must exist in deal state');
  assert.equal(stateTurn1.company.value, 'Northstar Labs');
  assert.equal(stateTurn1.company.status, 'confirmed');
  assert.ok(stateTurn1.company.confidence >= 0.85);
  assert.equal(stateTurn1.company.source.type, 'customer_utterance');
  assert.equal(stateTurn1.company.source.turnId, 'turn_1');
  assert.ok(stateTurn1.company.updatedAt);

  assert.ok(stateTurn1.teamSize, 'Team size field must exist in deal state');
  assert.equal(stateTurn1.teamSize.value, '300');
  assert.equal(stateTurn1.teamSize.status, 'confirmed');
  assert.ok(stateTurn1.teamSize.confidence >= 0.85);
  assert.equal(stateTurn1.teamSize.source.turnId, 'turn_1');
  console.log('✓ Turn 1 Verified: Company = Northstar Labs, Team Size = 300, structured provenance OK');

  // Verify Evidence collection
  const evSnap1 = await db.collection('evidence').where('sessionId', '==', session.sessionId).get();
  assert.ok(evSnap1.size >= 2, 'Evidence collection must have records for company and teamSize');
  console.log(`✓ Evidence count after Turn 1: ${evSnap1.size}`);

  // --- TURN 2: Pain & Metrics (MEDDIC) ---
  console.log('\n--- TURN 2: Pain and Metrics ---');
  const turn2Text = 'Our main problem is inbound lead qualification. We spend around 35% of rep capacity on qualification.';
  console.log(`Customer: "${turn2Text}"`);
  const turn2Res = await executeCustomerTurn(session, turn2Text, { turnId: 'turn_2' });
  console.log(`Agent: "${turn2Res.content}"`);

  const stateTurn2 = await getDeal(dealId, orgId, session.sessionId);
  assert.ok(stateTurn2.pain, 'Pain field must exist');
  assert.equal(stateTurn2.pain.value, 'Inbound lead qualification');
  assert.equal(stateTurn2.pain.status, 'confirmed');

  assert.ok(stateTurn2.meddic?.identifyPain, 'MEDDIC identifyPain must exist');
  assert.equal(stateTurn2.meddic.identifyPain.status, 'confirmed');
  assert.equal(stateTurn2.meddic.identifyPain.source.turnId, 'turn_2');

  assert.ok(stateTurn2.meddic?.metrics, 'MEDDIC metrics must exist');
  assert.equal(stateTurn2.meddic.metrics.status, 'confirmed');
  assert.ok(stateTurn2.meddic.metrics.value.includes('35%'));
  assert.equal(stateTurn2.meddic.metrics.source.turnId, 'turn_2');
  console.log('✓ Turn 2 Verified: Pain = Inbound lead qualification, MEDDIC metrics = 35%');

  // --- TURN 3: Economic Buyer & Competitor ---
  console.log('\n--- TURN 3: Economic Buyer and Competitor ---');
  const turn3Text = "The VP of Sales will approve this. We're evaluating Salesforce too.";
  console.log(`Customer: "${turn3Text}"`);
  const turn3Res = await executeCustomerTurn(session, turn3Text, { turnId: 'turn_3' });
  console.log(`Agent: "${turn3Res.content}"`);

  const stateTurn3 = await getDeal(dealId, orgId, session.sessionId);
  assert.ok(stateTurn3.meddic?.economicBuyer, 'MEDDIC economicBuyer must exist');
  assert.equal(stateTurn3.meddic.economicBuyer.value, 'VP of Sales');
  assert.equal(stateTurn3.meddic.economicBuyer.status, 'confirmed');
  assert.equal(stateTurn3.meddic.economicBuyer.source.turnId, 'turn_3');

  assert.ok(stateTurn3.competitor, 'Competitor field must exist');
  assert.ok(stateTurn3.competitor.value.toLowerCase().includes('salesforce'));
  assert.equal(stateTurn3.competitor.status, 'confirmed');
  assert.equal(stateTurn3.competitor.source.turnId, 'turn_3');
  console.log('✓ Turn 3 Verified: Economic Buyer = VP of Sales, Competitor = Salesforce');

  // --- TURN 4: Budget & Timeline ---
  console.log('\n--- TURN 4: Budget and Timeline ---');
  const turn4Text = 'Our budget is ₹10–₹15 lakh annually.';
  console.log(`Customer: "${turn4Text}"`);
  const turn4Res = await executeCustomerTurn(session, turn4Text, { turnId: 'turn_4' });
  console.log(`Agent: "${turn4Res.content}"`);

  const stateTurn4 = await getDeal(dealId, orgId, session.sessionId);
  assert.ok(stateTurn4.budget, 'Budget field must exist');
  assert.ok(stateTurn4.budget.value.includes('10') && stateTurn4.budget.value.includes('15'));
  assert.equal(stateTurn4.budget.status, 'confirmed');
  assert.equal(stateTurn4.budget.source.turnId, 'turn_4');
  console.log('✓ Turn 4 Verified: Budget = ₹10–₹15 lakh annually');

  // --- TURN 5: Discount Request (Policy Escalation) ---
  console.log('\n--- TURN 5: 25% Discount Request ---');
  const turn5Text = 'Can you do 25% discount for ₹9 lakh?';
  console.log(`Customer: "${turn5Text}"`);
  const turn5Res = await executeCustomerTurn(session, turn5Text, { turnId: 'turn_5' });
  console.log(`Agent: "${turn5Res.content}"`);

  assert.ok(
    turn5Res.content.includes('manager for review') || turn5Res.content.includes('manager'),
    'Agent must state that discount is escalated to manager'
  );

  const approvalsSnap = await db.collection('approvals')
    .where('sessionId', '==', session.sessionId)
    .where('status', '==', 'PENDING')
    .get();

  assert.equal(approvalsSnap.size, 1, 'Exactly one PENDING approval must be created');
  const approval = approvalsSnap.docs[0].data();
  assert.equal(approval.exactToolName, 'calculate_discount');
  assert.equal(approval.exactValidatedArguments.requested_pct, 25);
  assert.equal(approval.status, 'PENDING');
  console.log(`✓ Turn 5 Verified: Approval ${approval.approvalId} created with status PENDING for 25% discount`);

  // --- TURN 6: Meeting Scheduling ---
  console.log('\n--- TURN 6: Meeting Request ---');
  const turn6Text = "Let's schedule a review tomorrow at 4 PM.";
  console.log(`Customer: "${turn6Text}"`);
  const turn6Res = await executeCustomerTurn(session, turn6Text, { turnId: 'turn_6' });
  console.log(`Agent: "${turn6Res.content}"`);

  assert.ok(
    turn6Res.content.includes('form') || turn6Res.content.includes('details') || turn6Res.content.includes('times'),
    'Agent must inform customer about meeting form'
  );

  const meetingsSnap = await db.collection('callSessions').doc(session.sessionId).collection('meetingRequests').get();
  assert.ok(meetingsSnap.size >= 1, 'Meeting request document must exist in subcollection');
  const meeting = meetingsSnap.docs[0].data();
  assert.equal(meeting.status, 'DETAILS_REQUIRED');
  assert.equal(meeting.meetingType, 'technical_review');
  console.log(`✓ Turn 6 Verified: Meeting request ${meeting.requestId} created with status DETAILS_REQUIRED`);

  // --- AUDIT TRAIL VERIFICATION ---
  console.log('\n--- VERIFYING AUDIT TRAIL ---');
  const auditSnap = await db.collection('auditEvents')
    .where('sessionId', '==', session.sessionId)
    .get();
  console.log(`Total Audit Events Recorded: ${auditSnap.size}`);
  assert.ok(auditSnap.size >= 6, 'Audit trail must contain events for each turn');

  const eventTypes = auditSnap.docs.map(d => d.data().eventType);
  assert.ok(eventTypes.includes('DEAL_STATE_UPDATED'), 'DEAL_STATE_UPDATED events must exist');
  assert.ok(eventTypes.includes('MEETING_DETAILS_REQUESTED'), 'MEETING_DETAILS_REQUESTED event must exist');
  console.log('✓ Audit trail verified with concrete evidence');

  console.log('\n===============================================================');
  console.log('🎉 ALL 6 TURNS OF NORTHSTAR LABS SCENARIO PASSED (100% GREEN)!');
  console.log('===============================================================');
}

runNorthstarScenario()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Northstar Scenario Test Failed:', err);
    process.exit(1);
  });
