const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { db } = require('../firebase/admin');
const { HttpError } = require('../security/auth');
const { markActive, markFailed } = require('./callSessions');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

const BASE = 'https://api.agora.io/api/conversational-ai-agent/v2/projects';

function credentials() {
  const { AGORA_APP_ID: appId, AGORA_APP_CERTIFICATE: certificate, AGORA_CUSTOMER_ID: customerId, AGORA_CUSTOMER_SECRET: customerSecret, CLOUD_RUN_URL: baseUrl } = process.env;
  if (!appId || !certificate || !customerId || !customerSecret || !baseUrl || !process.env.AGORA_LLM_WEBHOOK_SECRET) throw new HttpError(503, 'Agora agent configuration is incomplete');
  return { appId, certificate, customerId, customerSecret, baseUrl: baseUrl.replace(/\/$/, '') };
}

async function startAgent(session, webhookToken) {
  const config = credentials();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionExpiry = Math.floor(new Date(session.expiresAt).getTime() / 1000);
  if (!Number.isFinite(sessionExpiry) || sessionExpiry <= nowSeconds) throw new HttpError(410, 'Call session has expired');
  const expiry = Math.min(nowSeconds + 3600, sessionExpiry);
  const agentUid = 1000;
  const token = RtcTokenBuilder.buildTokenWithUid(config.appId, config.certificate, session.opaqueAgoraChannel, agentUid, RtcRole.PUBLISHER, expiry);
  const payload = { name: `dealforge-${session.sessionId}`, properties: {
    channel: session.opaqueAgoraChannel, token, agent_rtc_uid: String(agentUid), remote_rtc_uids: ['*'],
    asr: { language: 'en-US', vendor: 'deepgram' },
    llm: { url: `${config.baseUrl}/chat/completions/${webhookToken}`, api_key: process.env.AGORA_LLM_WEBHOOK_SECRET, system_messages: [], params: { model: 'dealforge-sales-agent' } },
    tts: { vendor: 'elevenlabs', params: { voice_id: '21m00Tcm4TlvDq8ikWAM' } },
  }};
  let agentId;
  try {
    const response = await fetch(`${BASE}/${config.appId}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.customerId}:${config.customerSecret}`).toString('base64')}` }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new HttpError(502, `Agora agent start failed: ${data.message || response.status}`);
    agentId = data.agent_id || data.id;
    if (!agentId) throw new HttpError(502, 'Agora did not return an agent ID');
    await markActive(session.sessionId, agentId);
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.AGENT_STARTED, trigger: 'Agora agent started', actionResult: { agentId, verified: true } });
    return agentId;
  } catch (error) {
    if (agentId) await stopAgent({ ...session, agentId }).catch(() => {});
    await markFailed(session.sessionId, error.message);
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.CALL_FAILED, trigger: 'Agora agent startup failed', actionResult: { verified: false } });
    throw error;
  }
}

async function stopAgent(session) {
  if (!session.agentId) return;
  const config = credentials();
  const response = await fetch(`${BASE}/${config.appId}/agents/${session.agentId}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.customerId}:${config.customerSecret}`).toString('base64')}` } });
  if (!response.ok) throw new HttpError(502, 'Agora agent stop failed');
}
module.exports = { startAgent, stopAgent };
