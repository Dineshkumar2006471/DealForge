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
  const request = () => fetch(`${BACKEND_URL}${path}`, { ...options, headers });
  let response = await request();

  // Firebase SDKs cache ID tokens. A manager's role or session may have changed
  // since this tab was opened, so retry a rejected privileged request once with a
  // freshly minted token. The server remains the sole authorization decision-maker.
  if (manager && response.status === 401) {
    const user = firebase.auth().currentUser;
    if (user) {
      headers.Authorization = `Bearer ${await user.getIdToken(true)}`;
      response = await request();
    }
  }
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Request failed (${response.status})`); }
  return response.json();
}
function createCallLink(dealId, expiresInMinutes = 60) { return api('/manager/call-links', { method: 'POST', body: JSON.stringify({ dealId, expiresInMinutes }) }, true); }
function createDeal(company, targetArr = 0) { return api('/manager/deals', { method: 'POST', body: JSON.stringify({ company, targetArr }) }, true); }
function getDealCallSessions(dealId) { return api(`/manager/deals/${encodeURIComponent(dealId)}/call-sessions`, {}, true); }
function resolveApproval(approvalId, decision) { return api(`/manager/approvals/${encodeURIComponent(approvalId)}/resolve`, { method: 'POST', body: JSON.stringify({ decision }) }, true); }
function stopCall(sessionId) { return api(`/manager/calls/${encodeURIComponent(sessionId)}/stop`, { method: 'POST', body: '{}' }, true); }
function revokeCall(sessionId) { return api(`/manager/calls/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST', body: '{}' }, true); }
function joinCustomerCall(linkToken) { return api(`/public/calls/${encodeURIComponent(linkToken)}/join`, { method: 'POST', body: '{}' }); }
function getCustomerTranscript(linkToken, sessionCredential) { return api(`/public/calls/${encodeURIComponent(linkToken)}/transcript`, { method: 'POST', body: JSON.stringify({ sessionCredential }) }); }
function getCustomerMeetingRequest(linkToken, sessionCredential) { return api(`/public/calls/${encodeURIComponent(linkToken)}/meeting-requests/latest`, { method: 'POST', body: JSON.stringify({ sessionCredential }) }); }
function getIntegrationStatus() { return api('/manager/integrations/status', {}, true); }
function getAgentStatus() { return api('/manager/agent-status', {}, true); }
function linkHubspotDeal(dealId, hubspotDealId) { return api(`/manager/deals/${encodeURIComponent(dealId)}/integrations/hubspot/link`, { method: 'POST', body: JSON.stringify({ hubspotDealId }) }, true); }
function setHubspotBookingSync(dealId, enabled) { return api(`/manager/deals/${encodeURIComponent(dealId)}/integrations/hubspot/booking-sync`, { method: 'POST', body: JSON.stringify({ enabled }) }, true); }
function findMeetingSlots(linkToken, requestId, payload) { return api(`/public/calls/${encodeURIComponent(linkToken)}/meeting-requests/${encodeURIComponent(requestId)}/slots`, { method: 'POST', body: JSON.stringify(payload) }); }
function bookMeetingSlot(linkToken, requestId, payload) { return api(`/public/calls/${encodeURIComponent(linkToken)}/meeting-requests/${encodeURIComponent(requestId)}/book`, { method: 'POST', body: JSON.stringify(payload) }); }
