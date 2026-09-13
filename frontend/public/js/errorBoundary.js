/**
 * DealForge Global Error Boundary
 *
 * Catches uncaught exceptions and unhandled promise rejections,
 * displays user-friendly toast notifications, and logs structured errors.
 * Network errors trigger automatic retry logic.
 */
(function () {
  'use strict';

  // ─── Toast Notification System ──────────────────────────────────────────────
  const TOAST_CONTAINER_ID = 'dealforge-toast-container';

  function getOrCreateToastContainer() {
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = TOAST_CONTAINER_ID;
      Object.assign(container.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: '10000',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
        maxWidth: '400px',
      });
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, type = 'error', duration = 5000) {
    const container = getOrCreateToastContainer();
    const toast = document.createElement('div');
    const colors = {
      error: { bg: '#1a0000', border: '#ff4444', text: '#ff6666', icon: '⚠️' },
      warn: { bg: '#1a1400', border: '#ffaa00', text: '#ffcc44', icon: '⚡' },
      info: { bg: '#001a1a', border: '#00aaff', text: '#44ccff', icon: 'ℹ️' },
      success: { bg: '#001a00', border: '#44ff44', text: '#66ff66', icon: '✅' },
    };
    const c = colors[type] || colors.error;
    Object.assign(toast.style, {
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: '8px',
      padding: '12px 16px',
      color: c.text,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: '13px',
      lineHeight: '1.4',
      pointerEvents: 'auto',
      cursor: 'pointer',
      opacity: '0',
      transform: 'translateX(20px)',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    });
    toast.textContent = `${c.icon} ${message}`;
    toast.addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => dismissToast(toast), duration);
    }
    return toast;
  }

  function dismissToast(toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }

  // ─── Network Error Retry ────────────────────────────────────────────────────
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 1500;

  async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, options);
        if (response.ok || response.status < 500) return response;
        if (attempt < retries) {
          showToast(`Retrying request... (attempt ${attempt + 2})`, 'warn', 2000);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        }
      } catch (err) {
        if (attempt === retries) throw err;
        showToast('Network issue — retrying...', 'warn', 2000);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }

  // ─── Auth State Recovery ────────────────────────────────────────────────────
  function handleAuthError(error) {
    const authCodes = ['auth/network-request-failed', 'auth/user-token-expired', 'auth/id-token-expired'];
    if (error && error.code && authCodes.includes(error.code)) {
      showToast('Session expired. Redirecting to login...', 'warn', 3000);
      setTimeout(() => {
        window.location.href = '/login.html';
      }, 2000);
      return true;
    }
    return false;
  }

  // ─── Global Error Handlers ──────────────────────────────────────────────────
  window.addEventListener('error', (event) => {
    if (handleAuthError(event.error)) return;
    const message = event.error?.message || event.message || 'An unexpected error occurred';
    // Don't show toasts for resource loading errors (images, scripts)
    if (event.target && event.target !== window) return;
    showToast(message, 'error');
    console.error('[DealForge Error Boundary]', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    if (handleAuthError(error)) return;
    const message = error?.message || String(error) || 'An unexpected error occurred';
    showToast(message, 'error');
    console.error('[DealForge Unhandled Rejection]', error);
  });

  // ─── Expose Utilities ───────────────────────────────────────────────────────
  window.DealForgeErrorBoundary = {
    showToast,
    dismissToast,
    fetchWithRetry,
    handleAuthError,
  };
})();
