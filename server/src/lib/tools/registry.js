/**
 * Tool Registry
 *
 * Central registry mapping tool names to handlers + permission tiers + schemas.
 * Every tool call goes through the policy engine before execution.
 */
const { checkPolicy, recordFailure, recordSuccess } = require('../policy/policyEngine');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');
const { createApproval } = require('../policy/approvalQueue');
const { parseTool } = require('../schema/validation');
const crypto = require('crypto');

// Tool handlers (lazy-loaded)
const toolHandlers = {};

function registerTool(name, handler, schema) {
  toolHandlers[name] = { handler, schema };
}

/**
 * Get OpenAI-format tool definitions for Gemini.
 */
function getToolDefinitions() {
  return Object.entries(toolHandlers).filter(([, { schema }]) => schema.agentVisible !== false).map(([name, { schema }]) => ({
    type: 'function',
    function: {
      name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }));
}

/**
 * Execute a tool call through the policy engine.
 *
 * Pipeline: POLICY CHECK → PERMISSION DECISION → EXECUTE → VERIFY → AUDIT
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} context - { dealId, sessionId, turnNumber }
 * @returns {{ result: *, policyResult: object, approved: boolean }}
 */
async function executeTool(toolName, args, context) {
  const { dealId, sessionId, turnNumber, organizationId } = context;
  let validatedArgs;
  try { validatedArgs = parseTool(toolName, args); } catch (error) { return { result: { error: 'Invalid tool arguments', rejected: true }, policyResult: { tier: 'REJECT', allowed: false, reason: error.message }, approved: false }; }

  // 1. POLICY CHECK
  let policyResult = checkPolicy(toolName, validatedArgs, context);
  const approvedReplay = context.approvedReplay && context.approvedReplay.toolName === toolName && JSON.stringify(context.approvedReplay.args) === JSON.stringify(validatedArgs);
  if (policyResult.requiresApproval && approvedReplay) policyResult = { tier: 'ACT', allowed: true, reason: `Executing consumed approval ${context.approvedReplay.approvalId}` };

  // Audit the policy check
  await writeAuditEvent({
    dealId,
    sessionId,
    eventType: EVENT_TYPES.POLICY_CHECKED,
    organizationId, trigger: `${toolName} policy evaluated`,
    policyResult,
  });

  // 2. PERMISSION DECISION
  if (policyResult.tier === 'REJECT') {
    return {
      result: { error: policyResult.reason, rejected: true },
      policyResult,
      approved: false,
    };
  }

  if (policyResult.requiresApproval) {
    // Create approval request — do NOT execute
    const approval = await createApproval({ organizationId, dealId, sessionId, toolName, validatedArgs, requestedBy: 'agent', policyReason: policyResult.reason });
    // A pending discount is not an executed concession, but it is commercial
    // state. Persist its ledger entry so the manager sees the exact INR impact
    // before deciding; the approved replay remains the only execution path.
    if (toolName === 'calculate_discount') {
      await toolHandlers[toolName].handler(validatedArgs, context);
    }

    return {
      result: {
        pending_approval: true,
        approvalId: approval.approvalId,
        reason: policyResult.reason,
        message: 'Approval request created. The agent should tell the customer they are checking with their manager.',
      },
      policyResult,
      approved: false,
    };
  }

  // 3. EXECUTE
  const handler = toolHandlers[toolName];
  if (!handler) {
    return {
      result: { error: `Tool not found: ${toolName}` },
      policyResult,
      approved: false,
    };
  }

  try {
    const operationId = crypto.createHash('sha256').update(`${sessionId}:${turnNumber}:${toolName}:${JSON.stringify(validatedArgs)}`).digest('hex');
    const operationRef = require('../firebase/admin').db.collection('operations').doc(operationId);
    const previous = await operationRef.get();
    if (previous.exists && previous.data().status === 'SUCCEEDED') return { result: previous.data().result, policyResult, approved: true };
    await operationRef.set({ operationId, organizationId, dealId, sessionId, toolName, args: validatedArgs, status: 'RUNNING', updatedAt: new Date().toISOString() }, { merge: true });
    const result = await handler.handler(validatedArgs, context);

    // 4. VERIFY. A handler may explicitly report an unverified external result;
    // that must never be stored or announced as a successful action.
    if (result === null || result === undefined) {
      recordFailure(dealId, toolName);
      throw new Error(`Tool ${toolName} returned null/undefined`);
    }
    if (result.verified === false) {
      recordFailure(dealId, toolName);
      throw new Error(result.error || result.message || `Tool ${toolName} could not be verified`);
    }

    // 5. Record success
    recordSuccess();
    await operationRef.set({ status: 'SUCCEEDED', result, completedAt: new Date().toISOString() }, { merge: true });

    // 6. AUDIT
    await writeAuditEvent({
      dealId,
      sessionId,
      eventType: EVENT_TYPES.TOOL_EXECUTED,
      organizationId, trigger: `${toolName} executed`,
      policyResult,
      actionResult: {
        tool: toolName,
        input: validatedArgs,
        output: result,
        verified: true,
      },
    });

    // A planner may recommend work, but it never bypasses this completed tool path.
    // Refreshing assessment after verified state keeps autonomy deterministic and auditable.
    await require('../agent/autonomyService').refreshAutonomy({ organizationId, dealId, sessionId, turnNumber });

    return { result, policyResult, approved: true };
  } catch (err) {
    recordFailure();
    await require('../firebase/admin').db.collection('operations').doc(crypto.createHash('sha256').update(`${sessionId}:${turnNumber}:${toolName}:${JSON.stringify(validatedArgs)}`).digest('hex')).set({ organizationId, dealId, sessionId, toolName, status: 'FAILED', error: err.message, updatedAt: new Date().toISOString() }, { merge: true });
    console.error(`Tool execution error (${toolName}):`, err.message);

    return {
      result: { error: err.message },
      policyResult,
      approved: false,
    };
  }
}

module.exports = { registerTool, getToolDefinitions, executeTool };
