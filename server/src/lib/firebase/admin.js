/**
 * Firebase Admin SDK Initialization
 *
 * Uses Application Default Credentials on Cloud Run.
 * Uses GOOGLE_APPLICATION_CREDENTIALS or project ID in development.
 */
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore, Timestamp } = require('firebase-admin/firestore');

const existingApp = getApps()[0];
const app = existingApp || initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT_ID,
  });

if (!existingApp) {
  console.log(`🔥 Firebase Admin initialized for project: ${process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT_ID}`);
}

const db = getFirestore(app);

// Keep the small compatibility surface used by the application while using
// Firebase Admin's modular APIs (required by Admin SDK v14+).
const admin = {
  auth: () => getAuth(app),
  firestore: { FieldValue, Timestamp },
};

module.exports = { admin, db };
