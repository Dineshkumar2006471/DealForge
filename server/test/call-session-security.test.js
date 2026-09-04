const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AGORA_APP_ID = 'a'.repeat(32);
process.env.AGORA_APP_CERTIFICATE = 'b'.repeat(32);
const { rtcCredentials } = require('../src/lib/calls/callSessions');

test('RTC credentials are only minted for an active, unexpired server session', () => {
  const base = {
    opaqueAgoraChannel: 'df_test', customerUid: 123456,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  };
  assert.throws(() => rtcCredentials({ ...base, status: 'JOINING' }), /not active/);
  assert.throws(() => rtcCredentials({ ...base, status: 'REVOKED', revokedAt: new Date().toISOString() }), /revoked/);
  assert.throws(() => rtcCredentials({ ...base, status: 'ACTIVE', expiresAt: new Date(Date.now() - 1).toISOString() }), /expired/);
  const credentials = rtcCredentials({ ...base, status: 'ACTIVE' });
  assert.ok(credentials.token);
  assert.ok(new Date(credentials.expiresAt) <= new Date(base.expiresAt));
});
