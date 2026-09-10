const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { db } = require('../firebase/admin');
const { HttpError } = require('../security/auth');
const { markActive, markFailed } = require('./callSessions');
const { writeAuditEvent } = require('../audit/eventStore');
const { EVENT_TYPES } = require('../audit/eventTypes');

const BASE = 'https://api.agora.io/api/conversational-ai-agent/v2/projects';

function ttsConfig() {
  const provider = process.env.TTS_PROVIDER || 'elevenlabs';
  
  if (provider === 'sarvam') {
    if (!process.env.SARVAM_API_KEY) {
      throw new HttpError(503, 'Sarvam TTS configuration is incomplete');
    }
    // The DealForge TTS proxy at /api/public/tts/sarvam translates between
    // Agora's OpenAI TTS protocol and Sarvam's native REST API.
    // Conforms strictly to Agora generic_http schema: requires url, headers.Authorization
    // (or params.api_key), and params with response_format='pcm'.
    const cloudRunUrl = process.env.CLOUD_RUN_URL;
    if (!cloudRunUrl) throw new HttpError(503, 'CLOUD_RUN_URL is required for Sarvam TTS proxy');
    const internalSecret = process.env.INTERNAL_API_KEY || 'dealforge-internal-key';
    return {
      vendor: 'generic_http',
      url: `${cloudRunUrl}/api/public/tts/sarvam`,
      headers: {
        Authorization: `Bearer ${internalSecret}`
      },
      params: {
        model: process.env.SARVAM_MODEL || 'bulbul:v3',
        voice: process.env.SARVAM_SPEAKER || 'ishita',
        speed: 1.0,
        sample_rate: 16000,
        response_format: 'pcm'
      }
    };
  }

  if (provider === 'microsoft') {
    return { vendor: 'microsoft', params: { voice_name: 'en-US-JennyNeural' } };
  }

  const {
    ELEVENLABS_API_KEY: key,
    ELEVENLABS_VOICE_ID: voiceId,
    ELEVENLABS_MODEL_ID: modelId,
    ELEVENLABS_BASE_URL: baseUrl,
    ELEVENLABS_SAMPLE_RATE: rawSampleRate,
  } = process.env;
  const sampleRate = Number(rawSampleRate);
  const validSampleRates = new Set([16000, 22050, 24000, 44100]);
  // Agora's ElevenLabs adapter streams speech over WebSocket. Accepting an
  // https URL here lets Agora start the agent but prevents it from ever
  // publishing a remote audio track, which is indistinguishable to a caller
  // from a silent agent.
  if (!key || !voiceId || !modelId || !baseUrl || !baseUrl.startsWith('wss://') || !validSampleRates.has(sampleRate)) {
    throw new HttpError(503, 'ElevenLabs TTS configuration is incomplete');
  }
  return { vendor: 'elevenlabs', params: { base_url: baseUrl, key, model_id: modelId, voice_id: voiceId, sample_rate: sampleRate } };
}

function credentials() {
  const { AGORA_APP_ID: appId, AGORA_APP_CERTIFICATE: certificate, AGORA_CUSTOMER_ID: customerId, AGORA_CUSTOMER_SECRET: customerSecret, CLOUD_RUN_URL: baseUrl } = process.env;
  if (!appId || !certificate || !customerId || !customerSecret || !baseUrl || !process.env.AGORA_LLM_WEBHOOK_SECRET) throw new HttpError(503, 'Agora agent configuration is incomplete');
  return { appId, certificate, customerId, customerSecret, baseUrl: baseUrl.replace(/\/$/, ''), tts: ttsConfig() };
}

function buildAgentStartPayload(session, webhookToken, nowSeconds = Math.floor(Date.now() / 1000)) {
  const config = credentials();
  const sessionExpiry = Math.floor(new Date(session.expiresAt).getTime() / 1000);
  if (!Number.isFinite(sessionExpiry) || sessionExpiry <= nowSeconds) throw new HttpError(410, 'Call session has expired');
  const expiry = Math.min(nowSeconds + 3600, sessionExpiry);
  const agentUid = 1000;
  const token = RtcTokenBuilder.buildTokenWithUid(config.appId, config.certificate, session.opaqueAgoraChannel, agentUid, RtcRole.PUBLISHER, expiry);
  return { config, payload: { name: `dealforge-${session.sessionId}`, properties: {
    channel: session.opaqueAgoraChannel, token, agent_rtc_uid: String(agentUid),
    // Conversational AI v2 supports one subscribed customer UID. A wildcard
    // is not a reliable subscription target and can leave the agent detached
    // from the customer's audio stream.
    remote_rtc_uids: [String(session.customerUid)],
    idle_timeout: 120,
    asr: {
      credential_mode: 'managed',
      vendor: 'deepgram',
      params: {
        url: 'wss://api.deepgram.com/v1/listen',
        model: 'nova-3',
        language: 'en'
      }
    },
    llm: { credential_mode: 'byok', vendor: 'custom', style: 'openai', url: `${config.baseUrl}/chat/completions/${webhookToken}`, api_key: process.env.AGORA_LLM_WEBHOOK_SECRET, system_messages: [], params: { model: 'dealforge-sales-agent' } },
    // This object is sent only from Cloud Run to Agora and is never logged or returned.
    tts: config.tts,
  }}};
}

async function startAgent(session, webhookToken) {
  let config;
  let agentId;
  try {
    const built = buildAgentStartPayload(session, webhookToken);
    config = built.config;
    const payload = built.payload;
    const response = await fetch(`${BASE}/${config.appId}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.customerId}:${config.customerSecret}`).toString('base64')}` }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new HttpError(502, `Agora agent start failed: ${data.message || response.status}`);
    agentId = data.agent_id || data.id;
    if (!agentId) throw new HttpError(502, 'Agora did not return an agent ID');
    console.info('Agora agent accepted', { sessionId: session.sessionId, agentId, customerUid: session.customerUid, ttsVendor: payload.properties.tts.vendor, ttsSampleRate: payload.properties.tts.params.sample_rate });
    await markActive(session.sessionId, agentId);
    await writeAuditEvent({ organizationId: session.organizationId, dealId: session.dealId, sessionId: session.sessionId, eventType: EVENT_TYPES.AGENT_STARTED, trigger: 'Agora agent started', actionResult: { agentId, verified: true } });
    return agentId;
  } catch (error) {
    if (agentId && config) await stopAgent({ ...session, agentId }).catch(() => {});
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

async function speakAgent(session, text, { priority = 'APPEND', interruptable = true } = {}) {
  if (!session.agentId) throw new HttpError(409, 'Agora agent is not active');
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 512) throw new HttpError(400, 'Agent speech text is invalid');
  if (!['INTERRUPT', 'APPEND', 'IGNORE'].includes(priority) || typeof interruptable !== 'boolean') throw new HttpError(400, 'Agent speech options are invalid');
  const config = credentials();
  const response = await fetch(`${BASE}/${config.appId}/agents/${encodeURIComponent(session.agentId)}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.customerId}:${config.customerSecret}`).toString('base64')}` },
    body: JSON.stringify({ text: text.trim(), priority, interruptable }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `Agora agent speech request failed: ${String(data.message || response.status).slice(0, 180)}`);
  return { accepted: true };
}
module.exports = { startAgent, stopAgent, speakAgent, ttsConfig, buildAgentStartPayload };
