# DealForge release evidence

## Current release verdict

**BLOCKED — FIX THESE ITEMS FIRST**

This document records observed evidence, not intended capability. It is updated as staging gates are completed.

| Item | Status | Evidence |
| --- | --- | --- |
| Secure-core local tests | VERIFIED | 2026-09-05: 25 pass, 0 fail; Firestore emulator organization-isolation test also passed. |
| Docker release image | VERIFIED | 2026-09-05: Docker Desktop Linux engine 28.3.2; image `dealforge-core:55c36f6` built locally and `/health` returned HTTP 200 from host and container. |
| Staging release candidate | IMPLEMENTED BUT UNVERIFIED | Current `main` changes have not been built/deployed as an immutable staging revision. |
| Real Agora → Gemini call | BLOCKED | Requires a deployed revision, Agora callback configuration, and attended microphone test. |
| HubSpot | NOT CONFIGURED | No OAuth client/credential/action verification recorded. |
| Cal.com | NOT CONFIGURED | No server credential/event type/action verification recorded. |
| PSTN | NOT IMPLEMENTED | Browser Agora remains the only voice target. |

## Required evidence before demo approval

1. Docker local image build and `/health` proof.
2. Immutable Cloud Build image digest and Cloud Run revision for `dealforge-507515`.
3. Firestore rules/indexes and Firebase Hosting deployment evidence.
4. Three-window Agora/Gemini discovery and approval-resume recordings.
5. Five manual demo-case outcomes, including failure behavior.
