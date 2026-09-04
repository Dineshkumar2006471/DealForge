/**
 * DealForge Core — Express Entry Point
 * Cloud Run backend for the AI Sales Voice Negotiation Agent
 */
require('dotenv').config();
const { createApp } = require('./app');
const PORT = process.env.PORT || 8080;

// --- Configuration Verification ---
const requiredEnvVars = ['GCP_PROJECT_ID', 'AGORA_APP_ID', 'AGORA_APP_CERTIFICATE', 'AGORA_LLM_WEBHOOK_SECRET', 'CALL_SESSION_WEBHOOK_SIGNING_SECRET'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error('❌ FATAL: Missing required environment variables:', missingVars.join(', '));
  process.exit(1);
}

const app = createApp();

// --- Start ---
app.listen(PORT, () => {
  console.log(`\n🔥 DealForge Core running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   LLM:    POST /chat/completions/:sessionWebhookToken`);
  console.log(`   Manager: POST /api/manager/call-links`);
  console.log(`   Env:    ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Model:  ${process.env.GEMINI_MODEL || 'not configured'}\n`);
});
