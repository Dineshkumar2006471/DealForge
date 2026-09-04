/**
 * Seed Data — Acme Corp Test Deal
 *
 * Creates a pre-populated deal for demo/testing purposes.
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../firebase/admin');
const { createBlankDealState } = require('./dealState');

const ACME_DEAL_ID = 'acme-demo-001';

async function seedAcmeDeal(organizationId = process.env.SEED_ORGANIZATION_ID) {
  if (!organizationId) throw new Error('SEED_ORGANIZATION_ID is required');
  const sessionId = uuidv4();
  const dealState = createBlankDealState(sessionId);
  dealState.organizationId = organizationId;
  dealState.status = 'ACTIVE';

  // Pre-populate some known data for demo
  dealState.company = {
    value: 'Acme Corp',
    confidence: 0.99,
    source: 'customer_statement',
    evidence_turn: 1,
    last_updated: new Date().toISOString(),
  };

  await db.collection('organizations').doc(organizationId).set({ organizationId, name: 'DealForge Demo', updatedAt: new Date().toISOString() }, { merge: true });
  await db.collection('deals').doc(ACME_DEAL_ID).set(dealState);
  console.log(`🌱 Seeded Acme Corp deal: ${ACME_DEAL_ID} (session: ${sessionId})`);
  return { dealId: ACME_DEAL_ID, sessionId };
}

module.exports = { seedAcmeDeal, ACME_DEAL_ID };
