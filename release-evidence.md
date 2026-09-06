# DealForge release evidence

## Current release verdict

**BLOCKED — FIX THESE ITEMS FIRST**

This document records observed evidence, not intended capability. It is updated as staging gates are completed.

| Item | Status | Evidence |
| --- | --- | --- |
| Secure-core local tests | VERIFIED | 2026-09-05: 36 passed, 0 failed; 1 emulator-only test is intentionally skipped outside the emulator. |
| Firestore organization isolation | VERIFIED | 2026-09-05: Firebase Emulator ran the anonymous-denial, cross-organization denial, and browser-write-denial assertions. |
| Docker release image | VERIFIED | 2026-09-05: Docker Desktop Linux engine 28.3.2; `dealforge-core:voice-rc` built locally and its `/health` returned HTTP 200. |
| Immutable staging release candidate | VERIFIED | 2026-09-05: Cloud Build `140a36bd-937b-41f6-912e-a827ee4eab36` built commit `94561b01dfe613759aea4485065c7213f1ecbe39`; Cloud Run revision `dealforge-core-00023-8wz` serves image digest `sha256:9f3c11db794cd20e65488c7d0be43ba6eb3987a20458da297fff12ce9cf8b6a5`. |
| Staging infrastructure | VERIFIED | 2026-09-05: Cloud Run `/health` returned HTTP 200; Firebase Hosting serves the corrected call page; Firestore rules and indexes were deployed to `dealforge-507515`. |
| Voice startup contract | IMPLEMENTED BUT UNVERIFIED | Cloud Run has a mounted ElevenLabs secret and complete Agora TTS runtime settings; code fails closed if any setting is absent. A customer has not yet heard a fresh-link greeting and reply. |
| Staging security smoke checks | VERIFIED | 2026-09-05: manager route without ID token returned 401; invalid public call link returned 404; unauthenticated Agora webhook returned 401; an unapproved Origin received no CORS allow-origin header. |
| Real Agora → Gemini call | BLOCKED | Requires attended manager sign-in and a customer browser microphone test against the deployed revision. |
| HubSpot | IMPLEMENTED BUT UNVERIFIED | A server-only private-token probe and manager-approved, allowlisted linked-deal update with read-back verification are deployed. No real linked staging update has been authorized or recorded. |
| Cal.com | IMPLEMENTED BUT UNVERIFIED | V2 availability, idempotent booking, and read-back verification are deployed. No real test booking has been performed. |
| PSTN | NOT IMPLEMENTED | Browser Agora remains the only voice target. |

## Final remediation deployment — 2026-09-06

| Item | Status | Evidence |
| --- | --- | --- |
| Source commit | VERIFIED | `f24305636e0f98fdac61a76905a3c344681bc009` was pushed to GitHub before build. |
| Automated unit/API/security suite | VERIFIED | 45 passed, 0 failed; the Emulator-only test is separately recorded below. |
| Firestore Emulator isolation suite | VERIFIED | 17 test-file runs passed, 0 failed, 0 skipped. It exercised anonymous denial, cross-organization denial, and sensitive browser-write denial. |
| Cloud Build image | VERIFIED | Build `72d9ce15-3153-43b7-852b-9faa585c5718` succeeded; image digest `sha256:2d45cc9cd02ce119b64d7450bca794151be77a0610f5a6342a52d51840896fbf`. |
| Cloud Run deployment | VERIFIED | Revision `dealforge-core-00026-dm5`, 100% traffic, `/health` HTTP 200. |
| Hosting deployment | VERIFIED | `https://dealforge-507515.web.app/call.html` HTTP 200 and contains the secure meeting form. |
| Firestore rules and indexes | VERIFIED | Rules compiled and released; reviewed indexes deployed on 2026-09-06. |
| Greeting/turn repair | IMPLEMENTED BUT UNVERIFIED | The deployment has one RTC-ready greeting path, correctly uses `interruptable`, suppresses empty lifecycle turns, and persists duplicate-turn receipts. A human has not yet heard a new greeting/reply on this revision. |
| HubSpot credential and booking property | AVAILABLE | Server-only deal read probe returned HTTP 200; `dealforge_last_booking` exists. No staging deal has been linked or modified. |
| Cal.com credential/event type | DEGRADED | Credentials are valid and event type `6958388` exists, but it is inactive. Booking is correctly blocked until it is activated. |
| Public-link/CORS smoke test | VERIFIED | Invalid link returned 404; Hosting origin received the expected CORS header; an unapproved origin received none. |
| Docker local build | BLOCKED | Docker Desktop Linux engine pipe was unavailable on 2026-09-06. Cloud Build succeeded, but local Docker proof is not claimed. |

## Required evidence before demo approval

1. Docker local image build and `/health` proof.
2. Three-window Agora/Gemini discovery and approval-resume recordings.
3. Five manual demo-case outcomes, including failure behavior.

## Remaining attended staging tests

1. Create a fresh manager call link and confirm exactly one spoken greeting.
2. Say “We have 300 users” and confirm one spoken reply, transcript, evidence, Deal State, and audit update.
3. Request 25% discount, resolve manager approval, and confirm exact-once replay on the next customer turn.
4. Activate Cal.com event type `6958388`, then use the meeting form to create and read back one staging booking.
5. Link one explicit HubSpot staging deal and explicitly enable booking sync before verifying the `dealforge_last_booking` read-back.

## Deployed staging endpoints

- Firebase Hosting: `https://dealforge-507515.web.app`
- Cloud Run: `https://dealforge-core-6li7mfkrtq-uc.a.run.app`
- Project: `dealforge-507515`
