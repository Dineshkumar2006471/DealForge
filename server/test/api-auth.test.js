process.env.AGORA_LLM_WEBHOOK_SECRET = 'test-webhook-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const app = createApp();
test('manager API rejects missing Firebase token', async () => {
  const response = await request(app).post('/api/manager/call-links').send({ dealId: 'deal-a', expiresInMinutes: 60 });
  assert.equal(response.status, 401);
});
test('webhook rejects missing, malformed, and wrong authorization before SSE', async () => {
  for (const authorization of [undefined, 'Basic abc', 'Bearer wrong']) {
    let query = request(app).post('/chat/completions/not-a-session').send({ stream: true, messages: [] });
    if (authorization) query = query.set('Authorization', authorization);
    const response = await query;
    assert.equal(response.status, 401);
    assert.notEqual(response.headers['content-type'], 'text/event-stream');
  }
});
