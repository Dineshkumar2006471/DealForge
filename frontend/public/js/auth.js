/**
 * Shared Auth Guard & State
 *
 * Ensures the user is logged into Firebase before viewing protected pages.
 */

// We assume firebaseConfig.js is loaded BEFORE this file in the HTML

initFirebase();
let currentUser = null;
let resolveManagerReady;
window.managerReady = new Promise(resolve => { resolveManagerReady = resolve; });

function renderProfileIcon(elementOrId, size = 20) {
  const element = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!element) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path);
  }
  element.replaceChildren(svg);
}

// Listen for auth state changes globally
auth.onAuthStateChanged(async (user) => {
  if (user) {
    try {
      const claims = await user.getIdTokenResult();
      if (claims.claims.role !== 'manager' || !claims.claims.organizationId) {
        currentUser = null;
        resolveManagerReady(null);
        await auth.signOut();
        if (!window.location.pathname.includes('login')) window.location.href = '/login.html';
        return;
      }
      console.log('👤 User authenticated:', user.email);
      currentUser = user;
      window.managerOrganizationId = claims.claims.organizationId;
      resolveManagerReady({ user, organizationId: claims.claims.organizationId });

      // If we're on the login page and just got auth'd, redirect to deals
      const path = window.location.pathname;
      if (path.includes('login') || path.includes('index') || path === '/' || path === '') {
        window.location.href = '/deals.html';
      }
    } catch (error) {
      console.error('Unable to verify manager access:', error);
      currentUser = null;
      resolveManagerReady(null);
      await auth.signOut();
      if (!window.location.pathname.includes('login')) window.location.href = '/login.html';
    }
  } else {
    console.log('👤 User signed out');
    currentUser = null;
    resolveManagerReady(null);

    // If we're NOT on the login page (or index), redirect to login
    const path = window.location.pathname;
    if (!path.includes('login') && !path.includes('index') && path !== '/' && path !== '') {
      window.location.href = '/login.html';
    }
  }
});

// Helper for Google Sign-In
async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
    // onAuthStateChanged will handle the redirect
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    alert('Failed to sign in with Google: ' + error.message);
  }
}

// Helper for Email/Password Sign-In
async function signInWithEmail(email, password) {
  try {
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged will handle the redirect
  } catch (error) {
    console.error('Email Sign-In Error:', error);
    throw error; // Let the caller handle the UI error display
  }
}

// Helper for Email/Password Sign-Up
async function signUpWithEmail(email, password, firstName, lastName) {
  throw new Error('Manager accounts are invite-only. Contact your DealForge administrator.');
}

// Helper for Sign Out
async function signOut() {
  try {
    await auth.signOut();
  } catch (error) {
    console.error('Sign Out Error:', error);
  }
}
