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

## Required evidence before demo approval

1. Docker local image build and `/health` proof.
2. Three-window Agora/Gemini discovery and approval-resume recordings.
3. Five manual demo-case outcomes, including failure behavior.

## Deployed staging endpoints

- Firebase Hosting: `https://dealforge-507515.web.app`
- Cloud Run: `https://dealforge-core-6li7mfkrtq-uc.a.run.app`
- Project: `dealforge-507515`
