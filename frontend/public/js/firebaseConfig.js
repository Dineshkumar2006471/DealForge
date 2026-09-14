/**
 * Firebase Configuration (Client-side)
 *
 * Public config only — no secrets.
 * Used by all frontend pages.
 */

// Firebase SDK loaded via CDN in HTML files
// This file initializes the app and exports references

// Default public Firebase configuration for project dealforge-507515.
// Canonical authDomain is ALWAYS dealforge-507515.firebaseapp.com,
// which matches the registered Authorized Redirect URIs in Google Cloud Console OAuth 2.0 Client.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAuQ1K1hKPBzgy1nKtJ0JYGaarSGQv9rU8',
  appId: '1:442569512705:web:6b2edfbe5988608d9dad00',
  authDomain: 'dealforge-507515.firebaseapp.com',
  projectId: 'dealforge-507515',
  storageBucket: 'dealforge-507515.firebasestorage.app',
  messagingSenderId: '442569512705',
};

const FIREBASE_CONFIG = window.DEALFORGE_FIREBASE_CONFIG || DEFAULT_FIREBASE_CONFIG;

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
