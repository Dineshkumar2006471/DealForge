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
      let claims = await user.getIdTokenResult();
      if (claims.claims.role !== 'manager' || !claims.claims.organizationId) {
        console.log('🔄 Provisioning manager access for user:', user.email);
        const apiUrl = (window.DEALFORGE_API_URL || 'https://dealforge-core-6li7mfkrtq-uc.a.run.app/api').replace(/\/$/, '');
        const idToken = await user.getIdToken();
        const provRes = await fetch(`${apiUrl}/public/auth/provision`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
          }
        });
        if (provRes.ok) {
          await user.getIdToken(true);
          claims = await user.getIdTokenResult(true);
          console.log('✅ User successfully provisioned as manager:', claims.claims);
        } else {
          console.warn('Auto-provisioning endpoint returned status:', provRes.status);
        }
      }

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

// Check for pending redirect sign-in result on load
if (auth && typeof auth.getRedirectResult === 'function') {
  auth.getRedirectResult().then((result) => {
    if (result && result.user) {
      console.log('✅ Google redirect sign-in successful for:', result.user.email);
    }
  }).catch((error) => {
    console.error('Google redirect sign-in error:', error);
    const errEl = document.getElementById('error-message');
    if (errEl) {
      errEl.innerText = error.message;
      errEl.style.display = 'block';
    }
  });
}

// Helper for Google Sign-In with automatic redirect fallback if popups are blocked
async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const btn = document.getElementById('google-sign-in-btn');
  const errEl = document.getElementById('error-message');
  if (errEl) errEl.style.display = 'none';

  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Connecting to Google...</span>`;
  }

  try {
    const result = await auth.signInWithPopup(provider);
    return result;
  } catch (error) {
    console.warn('Google popup error:', error.code, error.message);

    // If popup was blocked by browser or cross-domain communication severed,
    // seamlessly fall back to full-page redirect!
    if (
      error.code === 'auth/popup-blocked' ||
      error.code === 'auth/cancelled-popup-request' ||
      error.code === 'auth/internal-error' ||
      (error.message && error.message.toLowerCase().includes('popup'))
    ) {
      console.log('🔄 Popup blocked by browser. Automatically redirecting to Google Sign-In...');
      if (btn) {
        btn.innerHTML = `<span>Redirecting to Google...</span>`;
      }
      try {
        await auth.signInWithRedirect(provider);
        return;
      } catch (redirErr) {
        console.error('Redirect error:', redirErr);
        error = redirErr;
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
    if (errEl) {
      errEl.innerText = error.message;
      errEl.style.display = 'block';
    } else {
      alert('Failed to sign in with Google: ' + error.message);
    }
  }
}

// Helper for Email/Password Sign-In
async function signInWithEmail(email, password) {
  try {
    return await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    console.error('Email Sign-In Error:', error);
    throw error;
  }
}

// Helper for Email/Password Sign-Up
async function signUpWithEmail(email, password) {
  try {
    return await auth.createUserWithEmailAndPassword(email, password);
  } catch (error) {
    console.error('Email Sign-Up Error:', error);
    throw error;
  }
}

// Helper for Sign Out
async function signOut() {
  try {
    await auth.signOut();
  } catch (error) {
    console.error('Sign Out Error:', error);
  }
}
