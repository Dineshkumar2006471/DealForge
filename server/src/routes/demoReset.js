/**
 * Demo Reset Route
 *
 * Provides a clean reset mechanism for repeating the Northstar enterprise demo.
 * Creates a fresh call session with clean state, resets session-scoped collections
 * (evidence, audit events, approvals, meetings, external operations), and returns
 * a new call link. Preserves the parent deal document.
 */

const express = require('express');
const { db } = require('../lib/firebase/admin');
const { requireManager, HttpError } = require('../lib/security/auth');
const { createCallSession } = require('../lib/calls/callSessions');
const { writeAuditEvent } = require('../lib/audit/eventStore');
const { EVENT_TYPES } = require('../lib/audit/eventTypes');

const router = express.Router();
router.use(requireManager);

router.post('/demo-reset', async (req, res, next) => {
  try {
    const dealId = req.body?.dealId;
    if (!dealId || typeof dealId !== 'string') {
      throw new HttpError(400, 'dealId is required');
    }

    const organizationId = req.manager.organizationId;
    const dealDoc = await db.collection('deals').doc(dealId).get();
    if (!dealDoc.exists || dealDoc.data().organizationId !== organizationId) {
      throw new HttpError(404, 'Deal not found');
    }

    // Find previous sessions for this deal to clean up demo artifacts
    const prevSessionsSnap = await db.collection('callSessions')
      .where('organizationId', '==', organizationId)
      .where('dealId', '==', dealId)
      .limit(50)
      .get();

    const prevSessionIds = prevSessionsSnap.docs.map(d => d.id);

    // Delete session-scoped evidence, auditEvents, approvals, meetings for previous sessions
    const collectionsToClean = ['evidence', 'auditEvents', 'approvals', 'meetings', 'externalOperations'];
    for (const collName of collectionsToClean) {
      for (const sId of prevSessionIds) {
        const snap = await db.collection(collName)
          .where('organizationId', '==', organizationId)
          .where('sessionId', '==', sId)
          .limit(100)
          .get();

        if (!snap.empty) {
          const batch = db.batch();
          snap.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      }
    }

    // Reset parent deal MEDDIC to empty so dashboard reflects a clean state
    await dealDoc.ref.update({
      conversationStage: 'QUALIFICATION',
      closeConfidence: 0.25,
      meddic: {
        metrics: { status: 'unconfirmed', value: null, confidence: 0 },
        economicBuyer: { status: 'unconfirmed', value: null, confidence: 0 },
        decisionCriteria: { status: 'unconfirmed', value: null, confidence: 0 },
        decisionProcess: { status: 'unconfirmed', value: null, confidence: 0 },
        identifyPain: { status: 'unconfirmed', value: null, confidence: 0 },
        champion: { status: 'unconfirmed', value: null, confidence: 0 }
      },
      discountLedger: [],
      updatedAt: new Date().toISOString()
    });

    // Create fresh call session
    const { session, linkToken } = await createCallSession({
      organizationId,
      dealId,
      managerId: req.manager.uid,
      customerLabel: 'Northstar Demo Session (Fresh)',
      expiresInMinutes: 60
    });

    const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, '') || '';
    const callUrl = `${publicAppUrl}/call.html?link=${encodeURIComponent(linkToken)}`;

    await writeAuditEvent({
      organizationId,
      dealId,
      sessionId: session.sessionId,
      eventType: EVENT_TYPES.CALL_CREATED,
      trigger: 'Manager triggered demo reset — clean session initialized',
      actionResult: { verified: true, newSessionId: session.sessionId }
    });

    res.status(200).json({
      success: true,
      dealId,
      sessionId: session.sessionId,
      linkToken,
      callUrl,
      message: 'Demo environment reset successfully with clean session state.'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
