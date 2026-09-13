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

  if (firebase.apps.length) {
    app = firebase.app();
  } else if (FIREBASE_CONFIG) {
    app = firebase.initializeApp(FIREBASE_CONFIG);
  } else {
    throw new Error('Firebase Hosting initialization is required');
  }

  // Same-origin authDomain optimization:
  // If running on dealforge-507515.web.app or a custom domain, align authDomain with the current host
  // so the auth handler is served same-origin (dealforge-507515.web.app/__/auth/handler).
  // This completely eliminates third-party cookie blocking and cross-origin iframe / popup connection failures.
  if (typeof window !== 'undefined' && window.location && window.location.hostname && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    if (app.options && (window.location.hostname.endsWith('.web.app') || window.location.hostname.endsWith('.firebaseapp.com'))) {
      app.options.authDomain = window.location.hostname;
    }
  }

  auth = firebase.auth();
  firestore = firebase.firestore();

  console.log('🔥 Firebase initialized with authDomain:', app.options?.authDomain);
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
