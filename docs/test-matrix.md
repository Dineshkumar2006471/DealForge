# DealForge Test Matrix & Invariant Verification Map

This document establishes the comprehensive module-by-module mapping of tests, invariant guarantees, coverage levels, and gate requirements across DealForge.

---

## 1. Module-to-Test Mapping

| Module Layer | Source Files | Test Files | Test Type | Line Coverage | Invariants Verified |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Policy Engine** | `server/src/lib/policy/policyEngine.js`<br>`server/src/lib/policy/approvalQueue.js`<br>`server/src/lib/policy/approvalStateMachine.js` | `server/test/policy.test.js`<br>`server/test/approval-queue.test.js`<br>`server/test/concurrency-idempotency.test.js`<br>`server/test/tenant-isolation.test.js` | Unit, Integration, Invariant | **97.78%** | 3-tier deterministic enforcement (`OBSERVE`, `ACT`, `APPROVAL`, `REJECT`), zero model bypass, discount ceiling (<=18% auto, 18-25% approval, >25% reject), approval state machine transitions, concurrent approval claim locks. |
| **Validation Schemas** | `server/src/lib/schema/validation.js`<br>`server/src/lib/schema/dealState.js` | `server/test/validation.test.js`<br>`server/test/firestore-contract.test.js` | Unit, Contract | **100%** (`validation.js`) | Strict Zod validation on all ingress fields, deal creation bounds, tool call argument schema conformance, unallowlisted field rejection. |
| **Security & Auth** | `server/src/lib/security/auth.js`<br>`server/src/lib/security/rateLimit.js`<br>`server/src/lib/security/webhookAuth.js` | `server/test/auth-manager.test.js`<br>`server/test/security.test.js`<br>`server/test/tenant-isolation.test.js` | Unit, Security | **100%** (`auth.js`)<br>**95.0%** (`webhookAuth.js`) | Role-based access control (manager vs member), bearer token verification, timing-safe webhook secret comparisons, IDOR defense, fixed-window rate limiting. |
| **Evidence Store** | `server/src/lib/evidence/confidenceConfig.js`<br>`server/src/lib/evidence/evidenceStore.js`<br>`server/src/lib/evidence/evidenceExtractor.js` | `server/test/evidence-store.test.js`<br>`server/test/evidenceStore.test.js`<br>`server/test/dealState.test.js` | Unit, Integration | **100%** (`confidenceConfig.js`)<br>**100%** (`evidenceStore.js`)<br>**80.14%** (`evidenceExtractor.js`) | Confidence-gated writes (>=0.85 accept, 0.60-0.85 clarify, <0.60 reject), monotonic evidence timestamps, immutable audit trail link. |
| **Tools & Execution** | `server/src/lib/tools/registry.js`<br>`server/src/lib/tools/calculateDiscount.js`<br>`server/src/lib/tools/checkProductAvailability.js`<br>`server/src/lib/tools/escalateToHuman.js`<br>`server/src/lib/tools/requestMeetingDetails.js`<br>`server/src/lib/tools/updateDealState.js` | `server/test/tools-execution.test.js`<br>`server/test/policy.test.js` | Unit, Integration | **100%** (`escalateToHuman.js`)<br>**100%** (`requestMeetingDetails.js`)<br>**97.59%** (`updateDealState.js`)<br>**65.92%** (`registry.js`) | Tool registry contract, atomic operation ledger check, pre-execution policy gating, post-execution verification and autonomy assessment refresh. |
| **External Integration: Cal.com** | `server/src/lib/integrations/calcom.js`<br>`server/src/lib/meetings/meetingRequests.js` | `server/test/calcom-contract.test.js`<br>`server/test/resilience-retry.test.js` | Contract, Integration | Contract verified | Pinned API versions, slot querying, duplicate booking 409 conflict handling, provider outage 500 error sanitization, ISO 8601 timezone normalizations. |
| **External Integration: HubSpot** | `server/src/lib/integrations/hubspot.js` | `server/test/hubspot-contract.test.js`<br>`server/test/resilience-retry.test.js` | Contract, Integration | Contract verified | Property allowlist enforcement, non-numeric ID rejection, deal verification, graceful skip on unlinked deals, 429 rate limit resilience. |
| **External Integration: Gemini** | `server/src/lib/agent/agentRuntime.js`<br>`server/src/lib/llm/geminiClient.js` | `server/test/gemini-contract.test.js`<br>`server/test/resilience-retry.test.js` | Contract, Invariant | Contract verified | Structured tool argument parsing, malformed output recovery, timeout fallback to safe SSE response, policy invariant (recommendation != authorization). |
| **External Integration: Moss** | `server/src/lib/retrieval/mossRetriever.js`<br>`server/src/lib/retrieval/mossIndexer.js` | `server/test/moss-contract.test.js` | Contract, Integration | Contract verified | Intent classification routing (greeting bypass, pricing/deal/product routing), seamless local memory search engine fallback, multi-tenant isolation. |
| **Firestore State Machine** | `server/src/lib/firebase/dealState.js`<br>`server/src/lib/firebase/operationLedger.js` | `server/test/firestore-contract.test.js`<br>`server/test/firestore-emulator.test.js` | Contract, Integration | Contract verified | Single source of truth at `deals/{dealId}`, atomic Firestore transactions, cross-tenant read/write prevention, idempotency deduplication. |

---

## 2. Invariant & Concurrency Test Coverage

| Test Suite | File | Invariant Tested | Verified Behavior |
| :--- | :--- | :--- | :--- |
| **Concurrency & Idempotency** | `server/test/concurrency-idempotency.test.js` | Replay & race conditions | Duplicate tool requests with matching fingerprint return cached result without duplicate execution; racing approvals lock atomically. |
| **Tenant Isolation** | `server/test/tenant-isolation.test.js` | Multi-tenant boundaries | Cross-tenant deal reads return null; manager token cannot approve foreign tenant requests; audit logs strictly scoped. |
| **Resilience & Retry** | `server/test/resilience-retry.test.js` | Provider timeouts & failures | External HTTP aborts when duration exceeds timeout; exponential backoff respects jitter and maxRetries ceiling; partial failures do not crash voice turns. |

---

## 3. Test Suite Categorization & Census (347 Tests Total)

| Category | Test Files | Total Tests | Pass | Skip | Fail | Invariant / Boundary Covered |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Unit Tests** | 28 files (`policy-engine`, `validation-schemas`, `auth`, `deal-state`, `system-prompt`, `logger`, etc.) | **206** | 206 | 0 | 0 | Deterministic discount tiers (18%/25%), Zod schemas, confidence thresholds, prompt safety, turn receipt fingerprints, monotonic latency calculations. |
| **Integration Tests** | 7 files (`enterprise-turn-pipeline`, `concurrency-idempotency`, `resilience-retry`, `tools-execution`, `approval-queue`, `evidence-store`, `moss-retrieval`) | **46** | 46 | 0 | 0 | End-to-end sales turn pipeline, operation ledger atomic deduplication, racing approval locks, retry jitter ceilings, tool pipeline execution, multi-turn memory retrieval. |
| **Contract Tests** | 8 files (`calcom-contract`, `hubspot-contract`, `gemini-contract`, `moss-contract`, `firestore-contract`, `integrations-contract`, `sse-fallback-contract`, `frontend-components`) | **48** | 48 | 0 | 0 | Cal.com v2 API version pinning & slot query, HubSpot allowlist & 429 backoff, Gemini structured output recovery, Moss intent classification & cache fallback, Firestore atomic write contracts, React 18 frontend component structure. |
| **Security & Adversarial** | 7 files (`security-adversarial`, `api-auth`, `auth-manager`, `call-session-security`, `frontend-security`, `tenant-isolation`, `webhook-auth`) | **40** | 40 | 0 | 0 | Cross-tenant isolation (IDOR defense), prompt injection rejection, model unapproved concession denial, bearer token tampering rejection, replay attack idempotency, timing-safe webhook secret validation. |
| **End-to-End (E2E)** | 1 file (`e2e-sales-turn.test.js`) | **6** | 6 | 0 | 0 | Full customer turn -> policy threshold check -> manager concession approval -> atomic deal ARR update -> machine-readable audit report (`e2e-report.json`). |
| **Emulator Tests** | 1 file (`firestore-emulator.test.js`) | **1** | 0 (local)* | 1* | 0 | Security rules evaluation against live Java Firestore emulator process. (*Executed live and verified green in CI via `emulators:exec`). |
| **TOTAL** | **51 files** | **347** | **346** | **1** | **0** | **0 Unexpected Failures across all suites** |

---

## 4. Coverage Gate Enforcement Status

| Category | Gate Requirement | Actual Measured Coverage | Status | Enforced By |
| :--- | :--- | :--- | :--- | :--- |
| **Policy Engine** (`src/lib/policy/`) | >= 95.0% | **97.79%** Lines / **97.79%** Statements | **PASS** | `scripts/verify-coverage-gates.js` |
| **Validation Schemas** (`src/lib/schema/validation.js`) | >= 95.0% | **100.00%** Lines / **100.00%** Statements | **PASS** | `scripts/verify-coverage-gates.js` |
| **Security & Auth** (`src/lib/security/auth.js`) | >= 95.0% | **100.00%** Lines / **100.00%** Statements | **PASS** | `scripts/verify-coverage-gates.js` |
| **Webhook Security** (`src/lib/security/webhookAuth.js`) | >= 95.0% | **95.00%** Lines / **95.00%** Statements | **PASS** | `scripts/verify-coverage-gates.js` |
| **Evidence Store & Confidence** (`src/lib/evidence/`) | >= 80.0% | **84.73%** Lines / **84.73%** Statements | **PASS** | `scripts/verify-coverage-gates.js` |
| **Overall Monitored Backend** | >= 75.0% | **78.85%** Lines / **78.85%** Statements | **PASS** | `c8 --check-coverage` & `verify-coverage-gates.js` |

---

## 5. Acceptance Criteria Compliance

1. **Unit tests**: 0 failures (206/206 passed)
2. **Integration tests**: 0 failures (46/46 passed)
3. **Contract tests**: 0 failures (48/48 passed)
4. **Security tests**: 0 failures (40/40 passed)
5. **E2E tests**: 0 unexpected failures (6/6 passed)
6. **Coverage thresholds met**: Policy (97.79%), Validation (100%), Auth (100%), Webhook (95%), Evidence (84.73%), Overall (78.85%)
7. **No critical-path tests skipped**: 0 critical business logic tests skipped
8. **Skipped tests have documented reasons**: `server/test/firestore-emulator.test.js` documents required `FIRESTORE_EMULATOR_HOST` daemon
9. **CI reproduces the same gates**: Enforced on every PR and commit to `main` via `.github/workflows/ci.yml`

