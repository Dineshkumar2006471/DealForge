/**
 * update_deal_state
 *
 * Tier 2 (ACT) — Updates a Deal State field with evidence-backed confidence check.
 */
const { registerTool } = require('./registry');
const { updateDealWithEvidence, updateMEDDIC, updateConversationStage } = require('../firebase/dealState');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

async function updateDealState(args, context) {
  const { field, value, confidence, source, meddic_pillar, meddic_status, new_stage } = args;
  const { dealId, sessionId, turnNumber, organizationId } = context;

  // Handle conversation stage update
  if (new_stage) {
    await updateConversationStage(dealId, new_stage, organizationId);
    await writeAuditEvent({
      organizationId, dealId, sessionId,
      eventType: EVENT_TYPES.CONVERSATION_STAGE_CHANGED,
      trigger: `Stage → ${new_stage}`,
    });
    return { updated: true, field: 'conversationStage', value: new_stage };
  }

  // Handle MEDDIC update
  if (meddic_pillar) {
    await updateMEDDIC(dealId, meddic_pillar, meddic_status || 'confirmed', confidence || 0.9, turnNumber, organizationId);
    return { updated: true, field: `meddic.${meddic_pillar}`, value: meddic_status || 'confirmed' };
  }

  // Handle regular Deal State field update
  if (!field || value === undefined) {
    return { updated: false, reason: 'field and value are required' };
  }

  const conf = confidence || 0.85;

  return updateDealWithEvidence({ organizationId, dealId, sessionId, field, value, confidence: conf, source: source || 'customer_statement', evidenceTurn: turnNumber });
}

registerTool('update_deal_state', updateDealState, {
  description: 'Update a field in the Deal State with evidence from the conversation. Include confidence score.',
  parameters: {
    type: 'object',
    properties: {
      field: { type: 'string', description: 'Deal state field: company, teamSize, timeline, budget, competitor, pain' },
      value: { type: 'string', description: 'The extracted value' },
      confidence: { type: 'number', description: 'Confidence score 0.0-1.0' },
      source: { type: 'string', description: 'Evidence source: customer_statement, inferred, tool_result' },
      meddic_pillar: { type: 'string', description: 'MEDDIC pillar to update: metrics, economicBuyer, decisionCriteria, decisionProcess, identifyPain, champion' },
      meddic_status: { type: 'string', description: 'MEDDIC status: confirmed, unknown' },
      new_stage: { type: 'string', description: 'New conversation stage: QUALIFY, NEGOTIATE, BOOK, ENDED' },
    },
  },
});

module.exports = updateDealState;
