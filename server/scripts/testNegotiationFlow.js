const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '..', '.env') });
const assert = require('assert/strict');
const { db } = require('../src/lib/firebase/admin');
const { createCallSession } = require('../src/lib/calls/callSessions');
const { handleChatCompletion } = require('../src/lib/agent/agentRuntime');
const { resolveApproval } = require('../src/lib/policy/approvalQueue');
const { getHistory } = require('../src/lib/agent/conversationHistory');

async function main() {
  console.log('====================================================');
  console.log('STARTING REAL NEGOTIATION & APPROVAL FLOW GATE TEST');
  console.log('competitor price -> policy -> approval -> manager decision -> agent continues');
  console.log('====================================================');

  const orgId = 'dealforge-staging';
  const dealId = 'staging-negotiation-001';
  const managerId = 'fdLljqV90ESHqHRqhXTGmftybWk1';

  // 1. Create a dedicated session for negotiation test
  const { session } = await createCallSession({
    organizationId: orgId,
    dealId: dealId,
    managerId: managerId,
    customerLabel: 'Acme VP Commercial Test',
    expiresInMinutes: 120,
  });
  console.log('Created test call session:', session.sessionId);

  // Helper mock Response object to capture SSE chunks
  function createMockResponse() {
    let headers = {};
    let data = '';
    return {
      setHeader(k, v) { headers[k] = v; },
      write(chunk) { data += chunk; },
      end() { this.ended = true; },
      getHeaders() { return headers; },
      getBody() { return data; },
      ended: false
    };
  }

  // 2. Customer asks for competitor discount (20% off - above 18% autonomous limit, within 25% manager limit)
  console.log('\n--- TURN 1: Customer requests 20% discount based on competitor price ---');
  const userText1 = 'Competitor AcmeCorp offers their solution for 20% off. Can you match that 20% discount?';
  const mockRes1 = createMockResponse();

  await handleChatCompletion(
    { messages: [{ role: 'user', content: userText1 }] },
    mockRes1,
    session
  );

  const reply1 = mockRes1.getBody();
  console.log('Agent SSE response to 20% discount request:');
  console.log(reply1);

  // Verify policy escalated to approval
  assert.ok(
    reply1.includes('manager for review') || reply1.includes('manager'),
    'Agent must state that the request is taken to the manager for review'
  );

  // 3. Inspect Firestore for pending approval
  console.log('\n--- VERIFYING APPROVAL IN FIRESTORE ---');
  const approvalsSnap = await db.collection('approvals')
    .where('sessionId', '==', session.sessionId)
    .where('status', '==', 'PENDING')
    .get();

  assert.equal(approvalsSnap.size, 1, 'Exactly one PENDING approval must exist');
  const approvalDoc = approvalsSnap.docs[0];
  const approval = approvalDoc.data();
  console.log('Created Approval Document:');
  console.log('  Approval ID:', approval.approvalId);
  console.log('  Tool Name:', approval.exactToolName);
  console.log('  Validated Args:', JSON.stringify(approval.exactValidatedArguments));
  console.log('  Status:', approval.status);
  console.log('  Policy Reason:', approval.policyReason);

  assert.equal(approval.exactToolName, 'calculate_discount');
  assert.equal(approval.exactValidatedArguments.requested_pct, 20);
  assert.equal(approval.status, 'PENDING');

  // 4. Manager reviews and APPROVES the concession
  console.log('\n--- MANAGER DECISION: APPROVING REQUEST ---');
  const resolution = await resolveApproval(
    approval.approvalId,
    'APPROVED',
    { uid: managerId, organizationId: orgId }
  );
  console.log('Manager resolution result:', resolution);
  assert.equal(resolution.status, 'APPROVED');

  const updatedApprovalDoc = await db.collection('approvals').doc(approval.approvalId).get();
  assert.equal(updatedApprovalDoc.data().status, 'APPROVED');
  console.log('Firestore approval status verified as: APPROVED');

  // 5. Customer speaks next turn -> Agent claims approval, executes concession, and continues
  console.log('\n--- TURN 2: Customer continues conversation ---');
  const userText2 = 'Thank you. Did you hear back from your manager about the discount?';
  const mockRes2 = createMockResponse();

  await handleChatCompletion(
    { messages: [{ role: 'user', content: userText2 }] },
    mockRes2,
    session
  );

  const reply2 = mockRes2.getBody();
  console.log('Agent SSE response after manager approval:');
  console.log(reply2);

  // 6. Verify approval status transition: APPROVED -> EXECUTING -> CONSUMED
  const finalApprovalDoc = await db.collection('approvals').doc(approval.approvalId).get();
  const finalApproval = finalApprovalDoc.data();
  console.log('Final Approval Document status:', finalApproval.status);
  assert.equal(finalApproval.status, 'CONSUMED', 'Approval must transition to CONSUMED after execution');
  assert.ok(finalApproval.consumedAt, 'Approval must record consumedAt timestamp');

  // 7. Verify transcript includes system execution receipt and conversational confirmation
  const history = await getHistory(session.sessionId);
  console.log('\nFinal Session Transcript Message Count:', history.length);
  history.forEach((m, idx) => {
    console.log(`  [Turn ${idx + 1}] [${m.role}]: ${m.content ? m.content.slice(0, 120) + '...' : JSON.stringify(m.tool_calls || {})}`);
  });

  const systemExecMsg = history.find(m => m.role === 'system' && m.content && m.content.includes('calculate_discount'));
  assert.ok(systemExecMsg, 'System receipt for executed calculate_discount must exist in transcript');
  console.log('System Execution Message:', systemExecMsg.content);

  console.log('\n====================================================');
  console.log('🎉 NEGOTIATION & APPROVAL FLOW TEST PASSED (GREEN)!');
  console.log('====================================================');
}

main().catch(err => {
  console.error('❌ Negotiation test failed:', err);
  process.exit(1);
});
