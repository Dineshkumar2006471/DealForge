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

test('privileged requests retry once with a freshly minted Firebase ID token', () => {
  const client = fs.readFileSync(path.join(publicRoot, 'js/backendClient.js'), 'utf8');
  assert.match(client, /response\.status === 401/);
  assert.match(client, /user\.getIdToken\(true\)/);
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

test('customer call page never replaces the manager Firebase session in another tab', () => {
  const callPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/call.html'), 'utf8');
  assert.doesNotMatch(callPage, /signInWithCustomToken|firebase\.auth\(\)\.signOut/);
  assert.match(callPage, /getCustomerTranscript/);
  assert.match(callPage, /getCustomerMeetingRequest/);
});

test('active deals provides a manager-only server-backed deal creation path', () => {
  const deals = fs.readFileSync(path.join(publicRoot, 'deals.html'), 'utf8');
  const client = fs.readFileSync(path.join(publicRoot, 'js', 'backendClient.js'), 'utf8');
  assert.match(deals, /id="create-deal-form"/);
  assert.match(deals, /createDeal\(company, targetArr\)/);
  assert.match(client, /api\('\/manager\/deals'/);
});

test('customer call controls remain reachable on desktop and narrow screens', () => {
  const callPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/call.html'), 'utf8');
  const styles = fs.readFileSync(path.join(publicRoot, 'css', 'style.css'), 'utf8');
  assert.match(callPage, /id="btn-call"/);
  assert.match(callPage, /id="call-hint"/);
  assert.match(styles, /\.page-call \{ display: flex; flex-direction: column; min-height: 100vh;/);
  assert.match(styles, /@media \(max-height: 700px\) and \(min-width: 641px\)/);
  assert.doesNotMatch(styles, /\.page-call \{ display: flex; flex-direction: column; height: 100vh; overflow: hidden;/);
});

test('customer captions consume durable messages through the server-bound session feed', () => {
  const call = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'public', 'call.html'), 'utf8');
  const client = fs.readFileSync(path.join(publicRoot, 'js', 'backendClient.js'), 'utf8');
  assert.match(call, /async function pollCaptions\(\)/);
  assert.match(call, /response\.messages \|\| \[\]/);
  assert.match(call, /startCaptionFallback\(\)/);
  assert.match(client, /\/public\/calls\/\$\{encodeURIComponent\(linkToken\)\}\/transcript/);
});

test('customer meeting details use the secure form and server-only booking routes', () => {
  const call = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'public', 'call.html'), 'utf8');
  const client = fs.readFileSync(path.join(publicRoot, 'js', 'backendClient.js'), 'utf8');
  assert.match(call, /id="meeting-details-form"/);
  assert.match(call, /Use this form instead of saying your email address aloud/);
  assert.match(call, /startMeetingRequestFallback\(\)/);
  assert.match(client, /\/meeting-requests\/\$\{encodeURIComponent\(requestId\)\}\/slots/);
  assert.match(client, /\/meeting-requests\/latest/);
  assert.doesNotMatch(call, /innerHTML/);
});
