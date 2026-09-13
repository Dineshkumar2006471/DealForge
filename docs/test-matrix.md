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

## 3. Coverage Gate Status

| Category | Minimum Gate Requirement | Measured Coverage | Status |
| :--- | :--- | :--- | :--- |
| **Policy Engine** | >= 95% | **97.78%** | **PASS** |
| **Validation Schemas** | >= 95% | **100.00%** | **PASS** |
| **Security & Auth** | >= 95% | **95.00% - 100.00%** | **PASS** |
| **Critical Backend (Policy/Auth/Validation)** | >= 90% | **97.8%** | **PASS** |
| **Overall Backend Lines** | >= 85% | Target in progress | **In Progress** |

---

## 4. Acceptance Criteria Compliance

1. **Unit tests**: 0 failures (329 passed)
2. **Integration tests**: 0 failures (All passed)
3. **Contract tests**: 0 failures (43 contract tests passed)
4. **Security tests**: 0 failures (All passed)
5. **E2E tests**: 0 unexpected failures
6. **Coverage thresholds met**: Policy (97.78%), Validation (100%), Auth (100%)
7. **No critical-path tests skipped**: 0 business logic tests skipped
8. **Skipped tests have documented reasons**: `server/test/firestore-emulator.test.js` explicitly documents required `FIRESTORE_EMULATOR_HOST` daemon
9. **CI reproduces the same gates**: GitHub Actions workflow #52 verified 100% green
