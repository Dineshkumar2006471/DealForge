/**
 * Firebase Configuration (Client-side)
 *
 * Public config only — no secrets.
 * Used by all frontend pages.
 */

// Firebase SDK loaded via CDN in HTML files
// This file initializes the app and exports references

// Firebase Hosting injects the active project's public web configuration at /__/firebase/init.js.
// Local development must set window.DEALFORGE_FIREBASE_CONFIG before this script.
const FIREBASE_CONFIG = window.DEALFORGE_FIREBASE_CONFIG || null;

let app, auth, firestore;

function initFirebase() {
  if (app) return { app, auth, firestore };

  if (firebase.apps.length) app = firebase.app();
  else if (FIREBASE_CONFIG) app = firebase.initializeApp(FIREBASE_CONFIG);
  else throw new Error('Firebase Hosting initialization is required');
  auth = firebase.auth();
  firestore = firebase.firestore();

  console.log('🔥 Firebase initialized');
  return { app, auth, firestore };
}

function getAuth() {
  if (!auth) initFirebase();
  return auth;
}

function getFirestore() {
  if (!firestore) initFirebase();
  return firestore;
}
