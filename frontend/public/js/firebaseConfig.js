/**
 * Firebase Configuration (Client-side)
 *
 * Public config only — no secrets.
 * Used by all frontend pages.
 */

// Firebase SDK loaded via CDN in HTML files
// This file initializes the app and exports references

// Firebase Hosting injects the active project's public web configuration at /__/firebase/init.js.
// Local development can set window.DEALFORGE_FIREBASE_CONFIG before this script if needed.
const FIREBASE_CONFIG = window.DEALFORGE_FIREBASE_CONFIG || null;

let app, auth, firestore;

function initFirebase() {
  if (app) return { app, auth, firestore };

  if (firebase.apps.length) {
    app = firebase.app();
  } else {
    app = firebase.initializeApp(FIREBASE_CONFIG);
  }

  // Canonical authDomain MUST be dealforge-507515.firebaseapp.com.
  // Never override authDomain with window.location.hostname (such as dealforge-507515.web.app).
  // Google's OAuth 2.0 Client ID specifically authorizes https://dealforge-507515.firebaseapp.com/__/auth/handler.
  // Overriding authDomain with web.app causes Google OAuth Error 400: redirect_uri_mismatch.
  if (app.options) {
    app.options.authDomain = 'dealforge-507515.firebaseapp.com';
  }

  auth = firebase.auth();
  firestore = firebase.firestore();

  console.log('🔥 Firebase initialized with canonical authDomain:', app.options?.authDomain);
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
