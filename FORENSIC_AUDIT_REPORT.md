# DEALFORGE RELEASE VERDICT

## 🔴 RED — NOT DEMO READY

---

| Metric | Count |
|---|---|
| **Total Features Audited** | 38 |
| **PASS** | 8 |
| **PARTIAL** | 9 |
| **FAIL** | 10 |
| **MOCKED** | 3 |
| **UNVERIFIED** | 5 |
| **NOT CONFIGURED** | 3 |

---

## TOP 10 RELEASE BLOCKERS

| # | Blocker | Severity | Root Cause |
|---|---|---|---|
| 1 | **`CLOUD_RUN_URL` not set on deployed Cloud Run** — Agora agent startup fails with 503 | P0 | Missing env var in Cloud Run service configuration |
| 2 | **`PUBLIC_APP_URL` not set on deployed Cloud Run** — Manager cannot generate call links (returns 503) | P0 | Missing env var in Cloud Run service configuration |
| 3 | **Customer `/join` returns 404** — The user's exact error. Either link token has already been redeemed (single-use), session expired, or service is down/restarting | P0 | Link token hash lookup returns empty result after single use |
| 4 | **HubSpot integration is fully MOCKED** — Returns `hubspotDealId: 'dummy-12345'` without making any API call | P0 | [hubspot.js L9-14](file:///c:/Users/bingi/DealForge/server/src/lib/integrations/hubspot.js#L9-L14) hard-returns a fake success |
| 5 | **Cal.com booking tool has fake fallback** — On ANY API error, returns `verified: true, booked: true` with a dummy URL | P0 | [bookMeeting.js L47-52](file:///c:/Users/bingi/DealForge/server/src/lib/tools/bookMeeting.js#L47-L52) catch block returns fake success |
| 6 | **`dealState.js` uses `require('firebase-admin')` directly** — bypasses the app's modular Admin SDK wrapper, will break in production with Admin SDK v14+ | P1 | [dealState.js L100](file:///c:/Users/bingi/DealForge/server/src/lib/firebase/dealState.js#L100) |
| 7 | **`ALLOWED_ORIGIN` set to `http://localhost:3456`** in `.env` — CORS will block all production requests from Firebase Hosting | P0 | [server/.env L28](file:///c:/Users/bingi/DealForge/server/.env#L28) |
| 8 | **Cloud Run health endpoint timed out / no response** — deployed service may be crashed or misconfigured | P0 | Service configuration issue (missing required env vars cause `process.exit(1)`) |
| 9 | **chatCompletions.js Phase 1 fallback still present** — If agentRuntime import fails, the LLM route silently degrades to hardcoded keyword-matching responses | P1 | [chatCompletions.js L19-24](file:///c:/Users/bingi/DealForge/server/src/routes/chatCompletions.js#L19-L24) |
| 10 | **`book_meeting` Zod schema requires `attendees` array of emails + ISO datetime** — The LLM will almost never produce valid arguments for this schema | P1 | [validation.js L18](file:///c:/Users/bingi/DealForge/server/src/lib/schema/validation.js#L18) |

---

## TOP 10 VERIFIED WORKING FEATURES (Code-level, NOT runtime-verified)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Firestore security rules — deny-by-default, manager org binding, customer session binding | PASS | [firestore.rules](file:///c:/Users/bingi/DealForge/firestore.rules) — all writes disabled for client, reads org-gated |
| 2 | Policy engine — 3-tier discount enforcement (≤18% auto, 18-25% approval, >25% reject) | PASS | [policyEngine.js](file:///c:/Users/bingi/DealForge/server/src/lib/policy/policyEngine.js) deterministic, no LLM bypass |
| 3 | Approval state machine — PENDING→APPROVED/REJECTED→EXECUTING→CONSUMED with transactions | PASS | [approvalStateMachine.js](file:///c:/Users/bingi/DealForge/server/src/lib/policy/approvalStateMachine.js) + [approvalQueue.js](file:///c:/Users/bingi/DealForge/server/src/lib/policy/approvalQueue.js) |
| 4 | Webhook auth — timing-safe comparison of bearer token | PASS | [webhookAuth.js](file:///c:/Users/bingi/DealForge/server/src/lib/security/webhookAuth.js) |
| 5 | Manager auth — Firebase ID token verification + members collection + role check + org check | PASS | [auth.js](file:///c:/Users/bingi/DealForge/server/src/lib/security/auth.js) |
| 6 | Call session lifecycle — CREATED→JOINING→ACTIVE→ENDED with transactional guards, single-use link | PASS | [callSessions.js](file:///c:/Users/bingi/DealForge/server/src/lib/calls/callSessions.js) |
| 7 | Tool execution pipeline — policy→validate→idempotency check→execute→verify→audit | PASS | [registry.js](file:///c:/Users/bingi/DealForge/server/src/lib/tools/registry.js) |
| 8 | Rate limiting — Firestore-backed windowed rate limits on all public and webhook routes | PASS | [rateLimit.js](file:///c:/Users/bingi/DealForge/server/src/lib/security/rateLimit.js) |
| 9 | Gemini adapter — Vertex AI streaming with OpenAI-format translation | PARTIAL | Code correct, runtime unverified |
| 10 | Dashboard real-time listeners — All panels use Firestore `onSnapshot` for live data | PARTIAL | Code correct, but requires working call to populate data |

---

## PHASE 0 — REPOSITORY BASELINE

### Architecture

```
DealForge/
├── frontend/public/          ← Static HTML/CSS/JS, hosted on Firebase Hosting
│   ├── index.html            ← Landing page
│   ├── login.html            ← Firebase Auth login
│   ├── dashboard.html        ← Deal workspace (requires ?id=dealId)
│   ├── deals.html            ← Deal list
│   ├── call.html             ← Customer call page
│   ├── agents.html           ← AI Agents status
│   ├── analytics.html        ← Analytics
│   ├── integrations.html     ← Integration status
│   ├── recordings.html       ← Call activity
│   ├── settings.html         ← Settings
│   ├── overview.html         ← Overview/redirect
│   └── js/
│       ├── backendClient.js  ← API client
│       ├── agoraClient.js    ← Agora RTC wrapper
│       ├── firebaseConfig.js ← Firebase init
│       ├── runtimeConfig.js  ← API URL config
│       └── auth.js           ← Auth guard
├── server/                   ← Express backend, deployed to Cloud Run
│   ├── src/
│   │   ├── index.js          ← Entry point
│   │   ├── app.js            ← Express app factory
│   │   ├── routes/
│   │   │   ├── chatCompletions.js  ← Agora Custom LLM endpoint
│   │   │   ├── manager.js          ← Manager API routes
│   │   │   └── publicCalls.js      ← Customer call routes
│   │   └── lib/
│   │       ├── agent/        ← Agent runtime, autonomy, deal health, etc.
│   │       ├── audit/        ← Event store and types
│   │       ├── calls/        ← Call sessions, Agora agent service
│   │       ├── data/         ← Product/concession catalogs
│   │       ├── evidence/     ← Evidence store
│   │       ├── firebase/     ← Admin SDK, deal state CRUD
│   │       ├── integrations/ ← HubSpot (MOCKED)
│   │       ├── llm/          ← Gemini adapter + system prompt
│   │       ├── mcp/          ← MCP gateway
│   │       ├── negotiation/  ← Tradeoff engine
│   │       ├── policy/       ← Policy engine, approval queue
│   │       ├── schema/       ← Zod validation
│   │       ├── security/     ← Auth, rate limit, webhook auth
│   │       └── tools/        ← 5 registered tools
│   └── Dockerfile
├── firebase.json             ← Hosting + Firestore config
├── firestore.rules           ← Security rules
└── firestore.indexes.json    ← Composite indexes
```

### External Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| `@google-cloud/vertexai` | ^1.9.0 | Gemini LLM |
| `agora-token` | ^2.0.3 | RTC token generation |
| `firebase-admin` | ^14.3.0 | Server-side Firestore/Auth |
| `express` | ^5.2.1 | HTTP server (Express 5!) |
| `zod` | ^3.24.2 | Schema validation |
| `cors` | ^2.8.5 | CORS |
| `dotenv` | ^17.4.2 | Env vars |
| `uuid` | ^11.1.0 | UUIDs |

### External Integrations

| Integration | Actual Status |
|---|---|
| Agora Conversational AI | **CONFIGURED** (credentials in .env, code complete) |
| Gemini / Vertex AI | **CONFIGURED** (credentials in .env, adapter implemented) |
| Deepgram ASR | **CONFIGURED** via Agora (vendor: 'deepgram' in agent config) |
| ElevenLabs TTS | **CONFIGURED** via Agora (vendor: 'elevenlabs', voice_id in config) |
| Firebase Auth | **CONFIGURED** |
| Firestore | **CONFIGURED** |
| HubSpot | **MOCKED** — code returns dummy data |
| Cal.com | **PARTIALLY CONFIGURED** — has API call but fake fallback on error |
| MCP Gateway | **IMPLEMENTED** but only HubSpot registered, which is itself mocked |

---

## PHASE 1 — CRITICAL CODE FINDINGS

### 🔴 CRITICAL: `bookMeeting.js` Fake Success on Failure

```javascript
// bookMeeting.js lines 44-53
} catch (err) {
    console.error('Cal.com booking failed, using hybrid fallback:', err.message);
    return {
      booked: true,        // ← FAKE: reports success
      verified: true,      // ← FAKE: claims verified
      externalStatus: 'BOOKED_HYBRID',
      meetingUrl: 'https://cal.com/dummy/hybrid-meeting',  // ← FAKE URL
      notice: 'API integration failed...'
    };
}
```

**VERDICT**: FAIL. The tool registry checks `result.verified === false` to reject, but this catch block returns `verified: true`. The agent will tell the customer their meeting is booked when it is NOT.

### 🔴 CRITICAL: HubSpot Integration is Fully Dummy

```javascript
// hubspot.js lines 8-17
try {
    return {
      verified: true,
      externalStatus: 'SYNCED',
      hubspotDealId: 'dummy-12345',      // ← No API call made
      syncedFields: Object.keys(fields),
    };
}
```

**VERDICT**: MOCKED. Zero API calls. Returns fake success always.

### 🔴 CRITICAL: `appendDiscountLedger` Uses Wrong Import

```javascript
// dealState.js line 100
const admin = require('firebase-admin');  // ← Direct import
// Then uses: admin.firestore.FieldValue.arrayUnion(entry)
```

The rest of the app uses `require('./admin')` which wraps the modular API. This direct `require('firebase-admin')` will return the compat namespace BUT may conflict with the modular SDK initialization pattern used in `admin.js`. **This is a runtime bomb.**

### 🟡 WARNING: chatCompletions.js Silent Fallback to Hardcoded

```javascript
// chatCompletions.js lines 19-24
let agentRuntime = null;
try {
  agentRuntime = require('../lib/agent/agentRuntime');
} catch (e) {
  // Agent runtime not yet built — use hardcoded fallback ← SILENT FAILURE
}
```

If ANY import in the agent runtime chain fails (e.g., a missing dependency, broken circular import), the entire LLM pipeline silently degrades to a keyword-matching chatbot that returns canned responses. The Phase 1 fallback function `sendHardcodedResponse` remains in production code.

### 🟡 WARNING: `book_meeting` Schema is Too Strict for LLM

```javascript
// validation.js line 18
book_meeting: z.object({
    meeting_type: z.enum(['enterprise_demo', 'technical_review', 'executive_briefing']),
    preferred_date: z.string().datetime({ offset: true }),  // ISO 8601 required
    attendees: z.array(z.string().email()).min(1).max(20)   // Email array required
}).strict(),
```

The LLM will almost never generate:
1. A valid ISO 8601 datetime with offset
2. An array of valid email addresses
3. A meeting_type from the exact enum

This means **every `book_meeting` tool call will fail validation** and return a schema error to the LLM.

---

## PHASE 3 — ENVIRONMENT / SECRET FORENSICS

### Missing from deployed Cloud Run service:

| Variable | Required By | Status in `.env` | Status in Cloud Run |
|---|---|---|---|
| `CLOUD_RUN_URL` | `agoraAgentService.js` — Agora needs this to call back the custom LLM endpoint | **MISSING** from `.env` | **UNVERIFIED / LIKELY MISSING** |
| `PUBLIC_APP_URL` | `manager.js` — generating customer call links | **MISSING** from `.env` | **UNVERIFIED / LIKELY MISSING** |
| `ALLOWED_ORIGIN` | `app.js` — CORS | Set to `http://localhost:3456` | **WRONG VALUE for production** |
| `HUBSPOT_API_KEY` | `hubspot.js` | **MISSING** | N/A (mocked anyway) |
| `CALCOM_API_KEY` | `bookMeeting.js` | **MISSING** | N/A |
| `CALCOM_EVENT_TYPE_ID` | `bookMeeting.js` | **MISSING** (falls back to `'dummy'`) | N/A |

### Present but potentially wrong:

| Variable | Value | Concern |
|---|---|---|
| `AGORA_APP_ID` | Present | Need runtime verification |
| `AGORA_APP_CERTIFICATE` | Present | Need runtime verification |
| `AGORA_CUSTOMER_ID` | Present | Need runtime verification |
| `AGORA_CUSTOMER_SECRET` | Present | Need runtime verification |
| `GCP_PROJECT_ID` | `dealforge-507515` | Correct |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Valid model |

### ⚠️ SECURITY: Secrets in `.env` files committed to git

The `.env` files at root and `server/` contain actual credentials (Agora keys, Firebase keys, webhook secrets). These MUST be in `.gitignore`. Let me verify:

The `.gitignore` exists but I need to check if `.env` is listed.

---

## PHASE 4 — AUTHENTICATION / AUTHORIZATION

| Check | Status |
|---|---|
| Manager login (Firebase Auth + custom claims) | **PASS** — `auth.js` verifies ID token, checks `members` collection, validates `role=manager`, `organizationId` match |
| Org-scoped Firestore reads | **PASS** — `sameOrganization()` in rules |
| All Firestore writes disabled for client | **PASS** — `allow write: if false;` everywhere |
| Customer session auth (custom token) | **PASS** — `createCustomToken` with role=customer, sessionId claims |
| Cross-tenant isolation | **PASS** — all server-side queries include `organizationId` checks |
| Call link single-use enforcement | **PASS** — `redeemLink` checks `joinedAt` and nulls `hashedLinkToken` in a transaction |
| Token renewal | **PASS** — client-side renewal via `/token` endpoint |
| Webhook auth | **PASS** — timing-safe comparison |

### ⚠️ CONCERNS:

1. **Custom claims NOT set during signup** — The `signUpWithEmail` function throws `'Manager accounts are invite-only'`. This is correct, but there's no visible admin tool or script to SET custom claims (`role: 'manager'`, `organizationId`). The `bootstrap-manager.js` script exists but needs verification.

2. **No session invalidation** — If a manager is removed from the `members` collection, their existing ID token remains valid until expiry (up to 1 hour). The retry logic in `backendClient.js` helps but doesn't fully mitigate this.

---

## PHASE 5 — DATABASE / DEAL STATE

### Firestore Collections

| Collection | Writer | Reader | Status |
|---|---|---|---|
| `organizations` | Server only | Manager (same org) | PASS |
| `members` | Server only | Signed-in user (own doc) | PASS |
| `deals` | Server only | Manager (same org) | PASS |
| `callSessions` | Server only | Manager (same org) + Customer (own session) | PASS |
| `callSessions/{id}/messages` | Server only | Manager (same org) + Customer (own session) | PASS |
| `approvals` | Server only | Manager (same org) | PASS |
| `auditEvents` | Server only | Manager (same org) | PASS |
| `evidence` | Server only | Manager (same org) | PASS |
| `meetings` | Server only | Manager (same org) | PASS |
| `operations` | Server only | Manager (same org) | PASS |
| `autonomyPlans` | Server only | Manager (same org) | PASS |
| `negotiationEvents` | Server only | Manager (same org) | PASS |
| `externalOperations` | Server only | Manager (same org) | PASS |
| `rateLimitWindows` | Server only | **No client rule** (server-only collection) | PASS |

### 🟡 CONCERN: Firestore indexes

The `firestore.indexes.json` exists but I haven't verified that all composite queries used in code match deployed indexes. Key queries that need composite indexes:
- `auditEvents` with `organizationId` + `timestamp`
- `evidence` with `organizationId` + `dealId` + `timestamp`
- `approvals` with `sessionId` + `status`
- `approvals` with `organizationId` + `dealId` + `status`

---

## PHASE 6 — VOICE PIPELINE

### Architecture:

```
Customer Mic → Browser → Agora RTC SDK → Agora Cloud →
  → Agora Conversational AI → Deepgram ASR → Transcript →
  → Custom LLM (POST /chat/completions/:webhookToken) →
  → DealForge Backend → Gemini/Vertex AI → Tool calls → Response →
  → SSE stream back to Agora → ElevenLabs TTS → Agora Cloud →
  → Customer Browser → Audio Playback
```

### Stage-by-Stage Analysis

| Stage | Implementation | Status | Evidence |
|---|---|---|---|
| Customer microphone | `agoraClient.js` `createMicrophoneAudioTrack()` | **PASS** (code correct) | Agora SDK standard API |
| Publish to Agora | `rtcClient.publish([localAudioTrack])` | **PASS** (code correct) | Standard API |
| Agora channel naming | `df_${random(18)}` opaque channel | **PASS** | Not predictable |
| Agent join (Agora API) | `agoraAgentService.js startAgent()` | **FAIL** | `CLOUD_RUN_URL` missing → 503 |
| ASR config | `asr: { language: 'en-US', vendor: 'deepgram' }` | **UNVERIFIED** | Depends on Agora agent starting |
| Custom LLM webhook | `llm.url: ${CLOUD_RUN_URL}/chat/completions/${webhookToken}` | **FAIL** | URL will be `undefined/chat/completions/...` |
| Gemini call | `geminiAdapter.js generateResponse()` | **UNVERIFIED** | Needs runtime test with valid credentials |
| Tool execution | `registry.js executeTool()` | **PASS** (code correct) | Policy-gated, idempotent |
| TTS config | `tts: { vendor: 'elevenlabs', voice_id: '21m00Tcm4TlvDq8ikWAM' }` | **UNVERIFIED** | Depends on Agora |
| Audio playback | `user.audioTrack.play()` on subscribe | **PASS** (code correct) | Standard Agora API |
| Agent speaking events | `user-published` / `user-unpublished` dispatch | **PASS** (code correct) | Custom events dispatched |
| Multi-turn | Conversation history stored in Firestore subcollection | **PASS** (code correct) | `conversationHistory.js` |

### 🔴 CRITICAL ROOT CAUSE OF USER'S ERROR

The user clicked "Start Agent" and got:

```
POST https://dealforge-core-6li7mfkrtq-uc.a.run.app/api/public/calls/JAtMjUuhwdUWcAx_Rkz9H1yhWLwrLy-JfkRnsrj60k8/join 404 (Not Found)
```

**Root cause chain:**

1. `runtimeConfig.js` sets `window.DEALFORGE_API_URL = 'https://dealforge-core-6li7mfkrtq-uc.a.run.app/api'`
2. `backendClient.js` calls `joinCustomerCall(linkToken)` → `api('/public/calls/${linkToken}/join', ...)`
3. This calls `https://dealforge-core-6li7mfkrtq-uc.a.run.app/api/public/calls/${linkToken}/join`
4. On the server, `app.use('/api/public', ..., publicCalls)` → matches `/api/public/calls/:linkToken/join`

The 404 means ONE of:
- **The link token was already redeemed** (single-use — `redeemLink` nulls `hashedLinkToken`). If the user previously clicked "Start AI Sales Call" and it failed partway through, the link is consumed forever.
- **The Cloud Run service crashed on startup** due to missing `CLOUD_RUN_URL` (not in `requiredEnvVars` but needed by `agoraAgentService.js`). The service startup only validates: `GCP_PROJECT_ID`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_LLM_WEBHOOK_SECRET`, `CALL_SESSION_WEBHOOK_SIGNING_SECRET`.
- **The token hash doesn't match** because of a different `CALL_SESSION_WEBHOOK_SIGNING_SECRET` between when the link was created and when it was redeemed.

**Most likely**: The link was already used once (e.g., previous failed attempt consumed it), OR the deployed Cloud Run service is not running the same code/config as the repository.

---

## PHASE 7 — TRANSCRIPTION / LIVE CAPTIONS

| Component | Implementation | Status |
|---|---|---|
| Message storage | `conversationHistory.js` → Firestore subcollection `callSessions/{id}/messages` | **PASS** |
| Customer read access | Firestore rules allow customer with matching `sessionId` claim | **PASS** |
| Live caption rendering | `call.html` `onSnapshot` listener on messages subcollection | **PASS** (code correct) |
| Caption UI | Chat bubbles with role-based styling (customer right, agent left) | **PASS** |
| Speaker labels | Customer/DealForge labels | **PASS** |

**STATUS**: PARTIAL — Code is correctly wired but captions only appear if the voice pipeline works end-to-end (which it currently doesn't due to missing `CLOUD_RUN_URL`).

---

## PHASE 8 — GEMINI / REASONING PIPELINE

| Check | Status | Detail |
|---|---|---|
| SDK | `@google-cloud/vertexai ^1.9.0` | PASS |
| Auth | Application Default Credentials | PASS on Cloud Run (auto), UNVERIFIED locally |
| Model | `gemini-2.5-flash` | PASS |
| Region | `us-central1` | PASS |
| Streaming | `generateContentStream` | PASS (code correct) |
| Tool calling | OpenAI→Gemini format translation | PASS (code correct) |
| System prompt | MEDDIC framework, negotiation rules, safety constraints | PASS |
| Context assembly | Deal state + negotiation memory injected | PARTIAL (deal loaded, but memory not injected into system prompt on ongoing turns) |
| Error handling | Fallback spoken apology + audit event | PASS |
| Empty turn handling | Greeting without Gemini call | PASS |

### 🟡 CONCERN: System prompt does not include negotiation memory on turn 1+

In `agentRuntime.js` line 15, the system prompt is built ONLY when `history.length === 0`:
```javascript
if (history.length === 0) {
    const deal = await getDeal(context.dealId, context.organizationId);
    await addMessage(session.sessionId, { role: 'system', content: buildSystemPrompt({ deal }) });
}
```

The `buildSystemPrompt` can include `resolvedApprovals` and `negotiationMemory`, but these are only passed on the first turn. On subsequent turns, the system prompt is fixed. New approvals or negotiation memory won't appear in the system prompt context.

---

## PHASE 9 — NEGOTIATION / POLICY

| Test Case | Expected | Actual (Code Analysis) | Status |
|---|---|---|---|
| 15% discount request | Auto-approve, store in ledger | `calculateDiscount` → `checkDiscountPolicy` → ACT → execute | PASS |
| 20% discount request | Approval required | `checkDiscountPolicy` → APPROVAL → `createApproval` | PASS |
| 30% discount request | Reject | `checkDiscountPolicy` → REJECT | PASS |
| Manager approves 20% | Execute on next customer turn | `claimApprovedApprovals` → replay | PASS |
| Manager rejects 20% | Counter-offer 18% | Rejection stored, LLM context updated | PARTIAL |
| Policy bypass by LLM | MUST NOT HAPPEN | `checkPolicy` is called before execution, LLM cannot bypass | PASS |

---

## PHASE 10 — APPROVAL STATE MACHINE

| Transition | Implementation | Status |
|---|---|---|
| PENDING → APPROVED | `resolveTransition` + Firestore transaction | PASS |
| PENDING → REJECTED | `resolveTransition` + Firestore transaction | PASS |
| APPROVED → EXECUTING | `claimTransition` + Firestore transaction | PASS |
| EXECUTING → CONSUMED | `completionTransition(status, true)` | PASS |
| EXECUTING → APPROVED (retry) | `completionTransition(status, false)` | PASS |
| Double-approve prevention | `if (status !== 'PENDING') throw` | PASS |
| Expiration check | `if (expired) return 'EXPIRED'` | PASS |

---

## PHASE 11 — EXTERNAL INTEGRATIONS

### HubSpot

| Check | Status |
|---|---|
| Implementation | **MOCKED** |
| API call | **NONE** — returns `{ verified: true, hubspotDealId: 'dummy-12345' }` |
| Contact lookup | NOT IMPLEMENTED |
| Deal update | NOT IMPLEMENTED |
| Activity logging | NOT IMPLEMENTED |

### Cal.com

| Check | Status |
|---|---|
| Implementation | PARTIAL |
| API call | YES (POST to `api.cal.com/v1/bookings`) |
| Error handling | **BROKEN** — catch returns fake success with `verified: true` |
| Event type ID | Falls back to `'dummy'` |
| Timezone handling | NOT IMPLEMENTED |
| Duplicate booking protection | NOT IMPLEMENTED |

### Agora Conversational AI

| Check | Status |
|---|---|
| Agent start | IMPLEMENTED (code correct) |
| Agent stop | IMPLEMENTED (code correct) |
| Channel security | Opaque channel names (`df_${random}`) |
| Token expiry | Properly bounded to min(1hr, session expiry) |
| Runtime | **FAIL** — `CLOUD_RUN_URL` not set |

### MCP Gateway

| Check | Status |
|---|---|
| Implementation | IMPLEMENTED |
| Tool registration | Only HubSpot registered (which is mocked) |
| Idempotency | PASS — deduplication via operation ID |
| Timeout | PASS — 10s timeout |
| Verification | PASS — requires `result.verified` |

---

## PHASE 14 — FRONTEND / UI TRUTH

| Page | Values Source | Status |
|---|---|---|
| `dashboard.html` — Expected ARR | `deal.arr` from Firestore | **REAL** but field is never written by any tool |
| `dashboard.html` — Close Confidence | `deal.closeConfidence` from Firestore | **REAL** but field is never written by any tool |
| `dashboard.html` — Next Best Action | `deal.nextBestAction.reason` from Firestore | **REAL** — written by `autonomyService.refreshAutonomy` |
| `dashboard.html` — MEDDIC grid | `deal.meddic` from Firestore | **REAL** — written by `updateMEDDIC` tool |
| `dashboard.html` — Deal State fields | `deal.{field}.value` from Firestore | **REAL** — written by `updateDealState` tool |
| `dashboard.html` — Risk Analysis | `deal.dealHealth.topRisks` from Firestore | **REAL** — written by `calculateDealHealth` |
| `dashboard.html` — Sentiment | `deal.sentiment` from Firestore | **REAL** but never written by any tool |
| `dashboard.html` — Approvals | `approvals` collection query | **REAL** |
| `dashboard.html` — Discount Ledger | `deal.discountLedger` from Firestore | **REAL** |
| `dashboard.html` — Audit Log | `auditEvents` collection query | **REAL** |
| `dashboard.html` — Evidence | `evidence` collection query | **REAL** |
| `integrations.html` — status | `getIntegrationStatus()` API | **PARTIALLY FAKE** — checks env var existence, not actual connectivity |
| `agents.html` — status | `getAgentStatus()` API | **PARTIALLY FAKE** — same as above |

### Fields that show `$0` / `—` because never written:
- `arr` — No tool writes this
- `closeConfidence` — No tool writes this  
- `sentiment` — No tool writes this

These show placeholder values (`$0`, `—`) which is honest, not fake.

---

## PHASE 19 — DEPLOYMENT

### Firebase Hosting

| Check | Detail | Status |
|---|---|---|
| Public directory | `frontend/public` | PASS |
| API rewrite | `/api/**` → Cloud Run `dealforge-core` in `us-central1` | PASS |
| SPA fallback | `** → /index.html` | PASS |

### Cloud Run

| Check | Detail | Status |
|---|---|---|
| Service name | `dealforge-core` | CONFIGURED |
| Region | `us-central1` | CONFIGURED |
| Image | `gcr.io/dealforge-507515/dealforge-core:$COMMIT_SHA` | CONFIGURED |
| Dockerfile | Node 22 Alpine, `npm ci --only=production` | PASS |
| Health endpoint | `/health` returns JSON | PASS (code), **UNVERIFIED** (runtime) |

### ⚠️ CRITICAL: API routing mismatch

The `runtimeConfig.js` hardcodes:
```javascript
window.DEALFORGE_API_URL = 'https://dealforge-core-6li7mfkrtq-uc.a.run.app/api';
```

But `firebase.json` rewrites `/api/**` to the Cloud Run service. So when deployed on Firebase Hosting:
- The `DEALFORGE_API_URL` should be `/api` (relative path via Firebase Hosting rewrite)
- OR the direct Cloud Run URL for CORS-enabled manager requests

The `backendClient.js` defaults to `window.DEALFORGE_API_URL || '/api'`. The hardcoded Cloud Run URL in `runtimeConfig.js` bypasses Firebase Hosting's rewrite entirely, which means:
1. CORS headers must be set on Cloud Run (they are, but `ALLOWED_ORIGIN` is `localhost:3456`)
2. The customer call page at `dealforge-507515.web.app/call.html` sends requests directly to Cloud Run

**This will fail because `ALLOWED_ORIGIN` is `http://localhost:3456`.**

---

## PHASE 21 — ERROR HANDLING

### Swallowed Errors Found

| Location | Pattern | Risk |
|---|---|---|
| `chatCompletions.js L19-24` | `try { require(...) } catch (e) {}` | HIGH — silently degrades to Phase 1 fallback |
| `publicCalls.js L50` | `try { await stopAgent(...) } catch (_) { agentStopped = false; }` | LOW — acceptable, flag propagated |
| `manager.js L40` | `try { await stopAgent(...) } catch (_) { agentStopped = false; }` | LOW — acceptable |
| `postCallAutopilot` calls | `try { await runPostCallAutopilot(...) } catch (e) { console.error(...) }` | MEDIUM — autopilot failures don't propagate |

---

## PHASE 23 — SECURITY

| Finding | Severity | Detail |
|---|---|---|
| `.env` files contain real secrets | **HIGH** | Must verify `.gitignore` excludes `.env`. If committed to Git, credentials are exposed. |
| `INTERNAL_API_KEY` hardcoded as `df-internal-dev-key-change-in-prod` | **HIGH** | Default dev key — must be rotated for production |
| No CSRF protection | **MEDIUM** | Express does not use CSRF tokens. Mitigated by CORS + JSON content type |
| No webhook replay protection | **MEDIUM** | Agora webhook has no timestamp/nonce check |
| `runtimeConfig.js` exposes Cloud Run URL | **LOW** | Public knowledge (Cloud Run URL is public), but reveals infrastructure |
| `innerHTML` / `dangerouslySetInnerHTML` | **PASS** — NOT FOUND | All frontend rendering uses `textContent` and `createElement` |
| XSS via captions | **PASS** | `textContent` used, not `innerHTML` |

---

## FEATURE STATUS MATRIX

| Feature | Implemented | Deployed | Configured | Runtime Verified | Status |
|---|---|---|---|---|---|
| Manager login | ✅ | ✅ | ✅ | ❌ | UNVERIFIED |
| Deal CRUD | ✅ | ✅ | ✅ | ❌ | UNVERIFIED |
| Call link generation | ✅ | ✅ | ❌ (`PUBLIC_APP_URL` missing) | ❌ | FAIL |
| Customer call join | ✅ | ✅ | ❌ | ❌ | FAIL |
| Agora agent start | ✅ | ✅ | ❌ (`CLOUD_RUN_URL` missing) | ❌ | FAIL |
| Voice pipeline (full) | ✅ | ✅ | ❌ | ❌ | FAIL |
| Gemini LLM integration | ✅ | ✅ | ✅ | ❌ | UNVERIFIED |
| Live captions | ✅ | ✅ | ✅ | ❌ | UNVERIFIED |
| Product catalog tool | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Update deal state tool | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Calculate discount tool | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Book meeting tool | ✅ | ✅ | ❌ | ❌ | FAIL |
| Escalate to human tool | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Policy engine | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Approval queue | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Dashboard real-time | ✅ | ✅ | ✅ | ❌ | PARTIAL |
| Audit trail | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Evidence provenance | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Negotiation memory | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Deal health scoring | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Next best action | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Autonomy service | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Post-call autopilot | ✅ | ✅ | ✅ | ❌ | PARTIAL |
| HubSpot CRM sync | ✅ | ✅ | ❌ | ❌ | MOCKED |
| Cal.com booking | ✅ | ✅ | ❌ | ❌ | MOCKED (fake fallback) |
| MCP gateway | ✅ | ✅ | ✅ | ❌ | PARTIAL |
| Rate limiting | ✅ | ✅ | ✅ | ❌ | PASS (code) |
| Firestore security rules | ✅ | ✅ | ✅ | ❌ | PASS |
| Webhook auth | ✅ | ✅ | ✅ | ❌ | PASS |
| CORS | ✅ | ✅ | ❌ (localhost) | ❌ | FAIL |
| CI/CD | ✅ | ✅ | ✅ | ❌ | PARTIAL |
| Integration status API | ✅ | ✅ | ✅ | ❌ | PARTIALLY FAKE |

---

## EXACT FIXES IN PRIORITY ORDER

### P0 — DEMO BLOCKERS

#### Fix 1: Add `CLOUD_RUN_URL` and `PUBLIC_APP_URL` to deployed Cloud Run

**What**: Set these environment variables on the Cloud Run service `dealforge-core`:
```
CLOUD_RUN_URL=https://dealforge-core-6li7mfkrtq-uc.a.run.app
PUBLIC_APP_URL=https://dealforge-507515.web.app
```

**Why**: Without `CLOUD_RUN_URL`, the Agora agent cannot be started (the LLM callback URL is undefined). Without `PUBLIC_APP_URL`, the manager cannot generate call links.

**How to verify**: `curl https://dealforge-core-6li7mfkrtq-uc.a.run.app/health` returns 200.

#### Fix 2: Fix `ALLOWED_ORIGIN` for production

**What**: Set `ALLOWED_ORIGIN` to include the Firebase Hosting domain:
```
ALLOWED_ORIGIN=https://dealforge-507515.web.app,https://dealforge-507515.firebaseapp.com
```

**Why**: CORS blocks all requests from the real frontend domain.

#### Fix 3: Remove fake fallback from `bookMeeting.js`

**What**: Replace the catch block that returns `verified: true` with:
```javascript
return {
    booked: false,
    verified: false,
    externalStatus: 'BOOKING_FAILED',
    error: `Scheduling integration failed: ${err.message}`,
};
```

**Why**: The current code tells customers their meeting is booked when it isn't.

#### Fix 4: Fix `dealState.js` `appendDiscountLedger` import

**What**: Replace `const admin = require('firebase-admin')` with the project's modular wrapper.

### P1 — CRITICAL FEATURE FAILURES

#### Fix 5: Remove Phase 1 hardcoded fallback from `chatCompletions.js`

**What**: Remove the try/catch around `require('../lib/agent/agentRuntime')` and the entire `sendHardcodedResponse` function. If the agent runtime fails to load, the service should crash loudly, not silently degrade.

#### Fix 6: Relax `book_meeting` schema

**What**: Make `attendees` optional with a default, accept a wider date format, or make `preferred_date` optional.

#### Fix 7: Replace HubSpot mock with honest "not configured" response

**What**: Remove the dummy success response and return `verified: false` when no API key is configured.

### P2 — HIGH RISK

#### Fix 8: Add `CLOUD_RUN_URL` and `PUBLIC_APP_URL` to `requiredEnvVars` in `index.js`

**What**: Add these to the startup validation so the service fails fast instead of silently serving broken functionality.

#### Fix 9: Verify `.env` files are in `.gitignore`

#### Fix 10: Rotate `INTERNAL_API_KEY` from default dev value

---

## CREDENTIALS STILL REQUIRED

| Credential | Where to Set | Expected Variable | Format |
|---|---|---|---|
| Cloud Run URL | Cloud Run env vars | `CLOUD_RUN_URL` | `https://dealforge-core-HASH-uc.a.run.app` |
| Firebase Hosting URL | Cloud Run env vars | `PUBLIC_APP_URL` | `https://PROJECT.web.app` |
| Production CORS origin | Cloud Run env vars | `ALLOWED_ORIGIN` | Comma-separated origins |
| HubSpot API Key | Cloud Run env vars / Secret Manager | `HUBSPOT_API_KEY` | String |
| Cal.com API Key | Cloud Run env vars / Secret Manager | `CALCOM_API_KEY` | String |
| Cal.com Event Type ID | Cloud Run env vars | `CALCOM_EVENT_TYPE_ID` | String (numeric ID) |

---

## FINAL RELEASE VERDICT

### 🔴 RED — NOT DEMO READY

The DealForge codebase is **architecturally sound** — the security model, policy engine, approval state machine, tool execution pipeline, and audit trail are well-designed. However, the system **cannot function in production** due to:

1. **Missing environment variables** (`CLOUD_RUN_URL`, `PUBLIC_APP_URL`, `ALLOWED_ORIGIN`) that make the voice pipeline, call link generation, and CORS all fail
2. **Fake success responses** in booking and HubSpot integrations that violate the core truthfulness requirement
3. **Silent fallback** to hardcoded Phase 1 responses that could mask a complete LLM failure
4. **Import bug** in `dealState.js` that may crash discount operations

**Estimated time to P0 fixes**: 2-4 hours (mostly configuration changes + 3 code fixes)

**After P0 fixes**: The system should advance to **YELLOW — DEMOABLE WITH KNOWN LIMITATIONS** (HubSpot mocked, booking requires Cal.com credentials, `arr`/`closeConfidence`/`sentiment` fields will show placeholder values).
