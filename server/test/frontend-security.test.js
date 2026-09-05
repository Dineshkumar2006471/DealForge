const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const publicRoot = path.join(__dirname, '..', '..', 'frontend', 'public');
test('frontend has no direct Firestore sensitive mutation or localhost API endpoint', () => {
  const sources = ['dashboard.html', 'js/auth.js', 'js/backendClient.js'].map(file => fs.readFileSync(path.join(publicRoot, file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /collection\(['"]approvals['"]\)\.doc\([^)]*\)\.update/);
  assert.doesNotMatch(sources, /localhost:8080/);
  const client = fs.readFileSync(path.join(publicRoot, 'js/backendClient.js'), 'utf8');
  const runtimeConfig = fs.readFileSync(path.join(publicRoot, 'js/runtimeConfig.js'), 'utf8');
  assert.match(client, /window\.DEALFORGE_API_URL \|\| '\/api'/);
  assert.match(runtimeConfig, /https:\/\//);
  assert.doesNotMatch(runtimeConfig, /localhost:8080/);
});
test('user-derived landing-page label is not inserted through innerHTML', () => {
  const source = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
  assert.match(source, /navCta\.textContent/);
  assert.doesNotMatch(source, /\$\{\(user\.displayName/);
});

test('call activity renders Firestore data through DOM text nodes', () => {
  const source = fs.readFileSync(path.join(publicRoot, 'recordings.html'), 'utf8');
  assert.match(source, /textContent = options\.text/);
  assert.doesNotMatch(source, /innerHTML/);
});

test('dashboard surfaces do not render untrusted data through HTML parsing', () => {
  const pages = ['index.html', 'overview.html', 'dashboard.html', 'deals.html', 'recordings.html', 'analytics.html', 'integrations.html'];
  const source = pages.map(file => fs.readFileSync(path.join(publicRoot, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /(?:innerHTML|insertAdjacentHTML)/);
});

test('agent and integration screens do not advertise static runtime vendors or fake bookings', () => {
  const agents = fs.readFileSync(path.join(publicRoot, 'agents.html'), 'utf8');
  const integrations = fs.readFileSync(path.join(publicRoot, 'integrations.html'), 'utf8');
  assert.doesNotMatch(agents, /MiniMax|Deepgram|\d+ Core Tools/);
  assert.doesNotMatch(integrations, /ASR \(Deepgram\)|TTS \(MiniMax\)|meeting booked successfully/i);
});

test('customer call links are not sent as referrers', () => {
  const callPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/call.html'), 'utf8');
  assert.match(callPage, /<meta name="referrer" content="no-referrer">/);
});
