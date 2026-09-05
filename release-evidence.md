# DealForge release evidence

## Current release verdict

**BLOCKED — FIX THESE ITEMS FIRST**

This document records observed evidence, not intended capability. It is updated as staging gates are completed.

| Item | Status | Evidence |
| --- | --- | --- |
| Secure-core local tests | VERIFIED | 2026-09-05: 25 pass, 0 fail; Firestore emulator organization-isolation test also passed. |
| Docker release image | VERIFIED | 2026-09-05: Docker Desktop Linux engine 28.3.2; image `dealforge-core:55c36f6` built locally and `/health` returned HTTP 200 from host and container. |
| Immutable staging release candidate | VERIFIED | 2026-09-05: Cloud Build `6f5b90b0-efd9-437e-b489-86b478b6f546` built commit `1ee8494bc550796f17f94a6725a70263615444b0`; Cloud Run revision `dealforge-core-00008-9hd` is serving image digest `sha256:b5402871c0b2e4f1fb488242c68833e03388f57d9a3b9cdfe1328f51d9e75bf9`. |
| Staging infrastructure | VERIFIED | 2026-09-05: Cloud Run `/health` returned HTTP 200; Firebase Hosting, Firestore rules, and nine composite indexes were deployed to `dealforge-507515`. |
| Staging security smoke checks | VERIFIED | 2026-09-05: manager route without ID token returned 401; invalid public call link returned 404; unauthenticated Agora webhook returned 401; an unapproved Origin received no CORS allow-origin header. |
| Real Agora → Gemini call | BLOCKED | Requires attended manager sign-in and a customer browser microphone test against the deployed revision. |
| HubSpot | NOT CONFIGURED | No OAuth client/credential/action verification recorded. |
| Cal.com | NOT CONFIGURED | No server credential/event type/action verification recorded. |
| PSTN | NOT IMPLEMENTED | Browser Agora remains the only voice target. |

## Required evidence before demo approval

1. Docker local image build and `/health` proof.
2. Three-window Agora/Gemini discovery and approval-resume recordings.
3. Five manual demo-case outcomes, including failure behavior.

## Deployed staging endpoints

- Firebase Hosting: `https://dealforge-507515.web.app`
- Cloud Run: `https://dealforge-core-6li7mfkrtq-uc.a.run.app`
- Project: `dealforge-507515`
