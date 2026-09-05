// Firebase Hosting does not preserve the browser Authorization header for this rewrite.
// Manager requests therefore use the configured HTTPS Cloud Run origin directly; CORS and
// Firebase ID-token verification remain the authorization boundary.
const BACKEND_URL = (window.DEALFORGE_API_URL || '/api').replace(/\/$/, '');

async function api(path, options = {}, manager = false) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (manager) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Manager sign-in is required');
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  const response = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Request failed (${response.status})`); }
  return response.json();
}
function createCallLink(dealId, expiresInMinutes = 60) { return api('/manager/call-links', { method: 'POST', body: JSON.stringify({ dealId, expiresInMinutes }) }, true); }
function resolveApproval(approvalId, decision) { return api(`/manager/approvals/${encodeURIComponent(approvalId)}/resolve`, { method: 'POST', body: JSON.stringify({ decision }) }, true); }
function stopCall(sessionId) { return api(`/manager/calls/${encodeURIComponent(sessionId)}/stop`, { method: 'POST', body: '{}' }, true); }
function revokeCall(sessionId) { return api(`/manager/calls/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST', body: '{}' }, true); }
function joinCustomerCall(linkToken) { return api(`/public/calls/${encodeURIComponent(linkToken)}/join`, { method: 'POST', body: '{}' }); }
function getIntegrationStatus() { return api('/manager/integrations/status', {}, true); }
function getAgentStatus() { return api('/manager/agent-status', {}, true); }
