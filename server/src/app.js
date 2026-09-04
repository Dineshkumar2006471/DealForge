const express = require('express');
const cors = require('cors');
const chat = require('./routes/chatCompletions');
const manager = require('./routes/manager');
const publicCalls = require('./routes/publicCalls');
const { HttpError } = require('./lib/security/auth');
const { createRateLimit } = require('./lib/security/rateLimit');

function createApp() {
  const app = express();
  // Cloud Run sits behind a trusted Google proxy; this lets req.ip use the client address.
  app.set('trust proxy', 1);
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  app.use(cors({ origin: allowedOrigin ? allowedOrigin.split(',') : false, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'dealforge-core', timestamp: new Date().toISOString() }));
  app.use('/chat/completions', chat);
  app.use('/api/manager', manager);
  app.use('/api/public', createRateLimit({ scope: 'public-call', limit: 30, windowMs: 60_000 }), publicCalls);
  app.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : error.name === 'ZodError' ? 400 : 500;
    if (status >= 500) console.error('Unhandled request error:', error.message);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message });
  });
  return app;
}
module.exports = { createApp };
