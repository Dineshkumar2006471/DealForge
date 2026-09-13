/**
 * Centralized Configuration
 *
 * Validates all environment variables at startup using Zod.
 * Fail-fast on missing required config instead of silent runtime failures.
 */
const { z } = require('zod');

const envSchema = z.object({
  // Firebase / GCP (required)
  GCP_PROJECT_ID: z.string().min(1).default('dealforge-507515'),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),

  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ALLOWED_ORIGIN: z.string().optional(),

  // AI / LLM
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_REALTIME_MODEL: z.string().optional(),

  // Voice
  AGORA_APP_ID: z.string().optional(),
  AGORA_CUSTOMER_ID: z.string().optional(),
  AGORA_CUSTOMER_SECRET: z.string().optional(),
  SARVAM_API_KEY: z.string().optional(),

  // Integrations
  HUBSPOT_API_KEY: z.string().optional(),
  CALCOM_API_KEY: z.string().optional(),
  CALCOM_EVENT_TYPE_ID: z.coerce.number().optional(),

  // Retrieval
  MOSS_PROJECT_ID: z.string().optional(),
  MOSS_PROJECT_KEY: z.string().optional(),

  // Security
  INTERNAL_API_KEY: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),

  // Deployment
  CLOUD_RUN_URL: z.string().url().optional(),
});

let _config = null;

function loadConfig() {
  if (_config) return _config;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`[CONFIG] Invalid environment configuration:\n${errors}`);
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Fatal: invalid environment configuration');
    }
  }
  _config = result.success ? result.data : envSchema.parse({ ...process.env });
  return _config;
}

function getConfig() {
  return _config || loadConfig();
}

module.exports = { loadConfig, getConfig, envSchema };
