/**
 * Evidence Store
 *
 * Writes evidence records to evidence/{evidenceId} collection.
 * Links evidence to deal state fields and utterance turns.
 */
import { v4 as uuidv4 } from 'uuid';
import type { Evidence } from '../../types/domain';

// Lazy-require or typed reference to Firestore admin
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { db } = require('../firebase/admin') as { db: any };

export interface StoreEvidenceParams {
  organizationId: string;
  dealId: string;
  sessionId?: string | null;
  claim: string;
  utteranceTurn: number;
  confidence: number;
  source: 'customer_statement' | 'inferred' | 'tool_result';
  dealStateField: string;
}

export interface StoredEvidenceRecord extends StoreEvidenceParams {
  evidenceId: string;
  timestamp: string;
}

/**
 * Store an evidence record.
 */
export async function storeEvidence({
  organizationId,
  dealId,
  sessionId = null,
  claim,
  utteranceTurn,
  confidence,
  source,
  dealStateField,
}: StoreEvidenceParams): Promise<StoredEvidenceRecord> {
  const evidenceId = uuidv4();
  const record = {
    organizationId,
    dealId,
    sessionId,
    claim,
    utteranceTurn,
    confidence,
    source, // "customer_statement" | "inferred" | "tool_result"
    dealStateField, // "budget" | "teamSize" | etc.
    timestamp: new Date().toISOString(),
  };

  await db.collection('evidence').doc(evidenceId).set(record);
  return { evidenceId, ...record };
}

/**
 * Get all evidence for a deal.
 */
export async function getEvidenceForDeal(dealId: string): Promise<Array<{ id: string } & Record<string, unknown>>> {
  const snapshot = await db.collection('evidence').where('dealId', '==', dealId).orderBy('timestamp', 'asc').get();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Get evidence chain for a specific deal state field.
 * Answers: "Why does DealForge think teamSize is 300?"
 */
export async function getEvidenceChain(
  dealId: string,
  field: string,
): Promise<Array<{ id: string } & Record<string, unknown>>> {
  const snapshot = await db
    .collection('evidence')
    .where('dealId', '==', dealId)
    .where('dealStateField', '==', field)
    .orderBy('timestamp', 'asc')
    .get();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
}
