/**
 * DealForge Core — Express Entry Point
 * Cloud Run backend for the AI Sales Voice Negotiation Agent
 */
require('dotenv').config();
const { createApp } = require('./app');
const PORT = process.env.PORT || 8080;

// --- Configuration Verification ---
const requiredEnvVars = [
  'GCP_PROJECT_ID',
  'AGORA_APP_ID',
  'AGORA_APP_CERTIFICATE',
  'AGORA_LLM_WEBHOOK_SECRET',
  'CALL_SESSION_WEBHOOK_SIGNING_SECRET',
  'CLOUD_RUN_URL',
  'PUBLIC_APP_URL',
  'ALLOWED_ORIGIN',
];
if (process.env.TTS_PROVIDER === 'sarvam') {
  requiredEnvVars.push('SARVAM_API_KEY');
} else {
  requiredEnvVars.push(
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_VOICE_ID',
    'ELEVENLABS_MODEL_ID',
    'ELEVENLABS_BASE_URL',
    'ELEVENLABS_SAMPLE_RATE',
  );
}
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.error('❌ FATAL: Missing required environment variables:', missingVars.join(', '));
  process.exit(1);
}

const app = createApp();
const voiceProvider = process.env.VOICE_PROVIDER || 'openai_realtime';
if (voiceProvider === 'openai_realtime' && !process.env.OPENAI_API_KEY) {
  console.warn(
    '⚠️ WARNING: OPENAI_API_KEY is not set. openai_realtime sessions will fail unless configured or falling back to browser_speech.',
  );
}

// --- Start ---
const server = app.listen(PORT, () => {
  console.log(`\n🔥 DealForge Core running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Voice:  ${voiceProvider}`);
  console.log(`   LLM:    POST /chat/completions/:sessionWebhookToken`);
  console.log(`   Turn:   POST /api/public/calls/:linkToken/turn`);
  console.log(`   Manager: POST /api/manager/call-links`);
  console.log(`   Env:    ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Model:  ${process.env.GEMINI_MODEL || 'not configured'}\n`);
});

// --- Graceful Shutdown (Cloud Run sends SIGTERM) ---
function gracefulShutdown(signal) {
  console.log(`\n⏳ ${signal} received — starting graceful shutdown...`);
  server.close(() => {
    console.log('✅ All connections drained. Process exiting.');
    process.exit(0);
  });
  // Force close after 10 seconds if connections don't drain
  setTimeout(() => {
    console.error('⚠️ Forcefully shutting down after 10s timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
