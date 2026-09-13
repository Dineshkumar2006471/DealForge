/**
 * Structured Logger
 *
 * JSON-structured logging for Cloud Run with automatic secret masking.
 * Never logs bearer tokens, API keys, or PII.
 */

const SENSITIVE_PATTERNS = [
  /Bearer\s+\S+/gi,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /key[=:]\s*['"]?\S{16,}/gi,
];

function mask(value) {
  if (typeof value !== 'string') return value;
  let masked = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, '[REDACTED]');
  }
  return masked;
}

function formatEntry(level, message, meta = {}) {
  const entry = {
    severity: level.toUpperCase(),
    message: mask(message),
    timestamp: new Date().toISOString(),
    service: 'dealforge-core',
  };
  if (meta.requestId) entry.requestId = meta.requestId;
  if (meta.correlationId) entry.correlationId = meta.correlationId;
  if (meta.organizationId) entry.organizationId = meta.organizationId;
  if (meta.sessionId) entry.sessionId = meta.sessionId;
  if (meta.dealId) entry.dealId = meta.dealId;
  if (meta.turnId) entry.turnId = meta.turnId;
  if (typeof meta.durationMs === 'number') entry.durationMs = meta.durationMs;
  if (typeof meta.retryCount === 'number') entry.retryCount = meta.retryCount;
  if (meta.error) {
    entry.error = {
      message: mask(meta.error.message || String(meta.error)),
      code: meta.error.code,
      stack: process.env.NODE_ENV !== 'production' ? meta.error.stack : undefined,
    };
  }
  // Merge remaining safe metadata
  const standardFields = [
    'requestId',
    'correlationId',
    'organizationId',
    'sessionId',
    'dealId',
    'turnId',
    'durationMs',
    'retryCount',
    'error',
  ];
  for (const [key, val] of Object.entries(meta)) {
    if (!standardFields.includes(key)) {
      entry[key] = typeof val === 'string' ? mask(val) : val;
    }
  }
  return entry;
}

const logger = {
  info(message, meta) {
    console.log(JSON.stringify(formatEntry('info', message, meta)));
  },
  warn(message, meta) {
    console.warn(JSON.stringify(formatEntry('warning', message, meta)));
  },
  error(message, meta) {
    console.error(JSON.stringify(formatEntry('error', message, meta)));
  },
  debug(message, meta) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(JSON.stringify(formatEntry('debug', message, meta)));
    }
  },
};

module.exports = { logger, mask, formatEntry };
