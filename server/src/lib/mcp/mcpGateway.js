const crypto = require('crypto');
const { db } = require('../firebase/admin');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

const approvedTools = new Map();

function registerMcpTool(metadata, execute) {
  if (!metadata?.name || typeof execute !== 'function') throw new Error('MCP tool registration requires metadata and executor');
  approvedTools.set(metadata.name, { metadata: { ...metadata, name: metadata.name, external: true }, execute });
}
function listApprovedTools({ organizationId } = {}) { return [...approvedTools.values()].filter(({ metadata }) => !metadata.organizationId || metadata.organizationId === organizationId).map(({ metadata }) => metadata); }
function operationIdFor({ sessionId, toolName, args }) { return crypto.createHash('sha256').update(`${sessionId}:${toolName}:${JSON.stringify(args)}`).digest('hex'); }
async function executeMcpTool({ organizationId, dealId, sessionId, toolName, args, timeoutMs = 10_000 }) {
  const registered = approvedTools.get(toolName);
  if (!registered || (registered.metadata.organizationId && registered.metadata.organizationId !== organizationId)) throw new Error('External tool is not approved for this organization');
  const operationId = operationIdFor({ sessionId, toolName, args }); const ref = db.collection('externalOperations').doc(operationId);
  const existing = await ref.get();
  if (existing.exists && existing.data().status === 'SUCCEEDED') return existing.data().result;
  await ref.set({ operationId, organizationId, dealId, sessionId, toolName, args, status: 'RUNNING', createdAt: new Date().toISOString() }, { merge: true });
  try {
    const result = await Promise.race([registered.execute(args, { organizationId, dealId, sessionId }), new Promise((_, reject) => setTimeout(() => reject(new Error('External tool timed out')), timeoutMs))]);
    if (!result?.verified) throw new Error('External tool did not return a verified result');
    await ref.set({ status: 'SUCCEEDED', result, completedAt: new Date().toISOString() }, { merge: true });
    await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.TOOL_EXECUTED, trigger: `Verified external action: ${toolName}`, actionResult: { tool: toolName, verified: true } });
    return result;
  } catch (error) {
    await ref.set({ status: 'FAILED', error: String(error.message).slice(0, 500), updatedAt: new Date().toISOString() }, { merge: true });
    await writeAuditEvent({ organizationId, dealId, sessionId, eventType: EVENT_TYPES.EXTERNAL_ACTION_FAILED, trigger: `External action failed: ${toolName}`, actionResult: { tool: toolName, verified: false } });
    throw error;
  }
}

module.exports = { registerMcpTool, listApprovedTools, executeMcpTool, operationIdFor };
