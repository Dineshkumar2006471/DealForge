# Voice Latency Root Cause Analysis

## Problem Statement

When a customer finishes speaking, there is a ~5-second silence before DealForge
starts speaking back. This is unacceptable for a real-time conversational AI.

## Architecture Before (Fully Serialized)

```
Customer stops speaking
  → 500ms   VAD silence detection (OpenAI Realtime)
  → 200-500ms  Whisper transcription finalization
  → 50ms    Network: POST /turn
  → 80ms    activeSessionFromCredential (Firestore)
  → 120ms   claimTurnReceipt (Firestore transaction)
  → 60ms    addMessage user (Firestore transaction)         ← BLOCKING
  → 30ms    extractAndApplyEvidence (Firestore writes)      ← BLOCKING
  → 40ms    Moss retrieveRelevantContext
  → 600-1500ms  Gemini generateContentStream (BUFFERED)     ← CRITICAL
  → 0ms     SSE headers set (BUT ONLY NOW)                  ← CRITICAL
  → 200-800ms  Sarvam TTS (FULL TEXT, NOT STREAMED)         ← CRITICAL
  → 50ms    browser decode + playback
  ────────────────────────────────────────
  TOTAL: ~2000-3800ms server + ~700-1000ms client = 3-5s silence
```

## Three Killer Problems

### 1. SSE opens AFTER entire pipeline completes

In `publicCalls.js`, the handler called `await executeCustomerTurn()` and only
opened the SSE stream after it returned. The entire Gemini generation + evidence +
audit + autonomy had to complete before the browser received any bytes.

### 2. Gemini streaming tokens are buffered

In `agentRuntime.js`, the `for await` loop over `generateResponse()` collected
all text chunks into `initialTextChunks` before acting on them. Even though
Vertex AI sends tokens progressively, the runtime waited for all of them.

### 3. TTS waits for complete response

In `publicCalls.js`, `streamSpeech()` was called with the entire assistant text.
No sentence-level pipelining existed — the complete Gemini response had to finish
before a single TTS byte was generated.

## Architecture After (Pipelined)

```
Customer stops speaking
  → 300ms   VAD silence detection (reduced from 500ms)
  → 200-400ms  Whisper transcription
  → 50ms    Network: POST /turn
  → 80ms    auth
  → IMMEDIATELY: Open SSE stream, emit turn_started
  → IN PARALLEL:
  │   ├── claimTurnReceipt
  │   ├── addMessage(user) — fire-and-forget
  │   └── evidence extraction — fire-and-forget
  → 100ms   receipt claimed, context retrieved
  → Gemini streaming starts
  → 300-600ms  Gemini first token
  → First sentence boundary detected
  → IMMEDIATELY: Sarvam TTS starts on first sentence
  → 150-250ms  TTS first audio chunk
  → emit audio_chunk → browser plays
  → Meanwhile: Gemini continues → more sentences → more TTS
  ────────────────────────────────────────
  TOTAL SERVER: ~800-1200ms to first audio chunk
  TOTAL USER: ~1300-2000ms (including VAD + transcription)
```

## Changes Made

### 1. `agentRuntime.js` — Streaming callback + deferred writes
- Added `onTextChunk` callback parameter to `executeCustomerTurn()`
- Forward Gemini streaming deltas to callback immediately
- `addMessage(user)` and `extractAndApplyEvidence` are now fire-and-forget
- `writeAuditEvent` and `refreshAutonomy` deferred to `setImmediate`

### 2. `publicCalls.js` — SSE opens before pipeline, sentence-level TTS
- SSE headers sent immediately after auth (before Gemini)
- Sentence boundary accumulator splits Gemini text at punctuation
- Each complete sentence triggers independent TTS via `streamSpeech()`
- Audio chunks emitted to SSE as each sentence's TTS completes

### 3. `realtimeVoiceClient.js` — Reduced VAD silence
- `silence_duration_ms` reduced from 500ms to 300ms (saves ~200ms per turn)

### 4. `call.html` — Earlier mic unmute
- Mic unmuted when audio playback starts (SPEAKING state) instead of `finally`
- Enables barge-in detection during agent speech

### 5. `voiceTurnTrace.js` — Monotonic instrumentation
- Reusable latency tracing with `performance.now()`
- Safe diagnostic log lines (no PII, no secrets)

## Safety Analysis

- **Evidence extraction deferred**: Safe because Gemini already has the user text
  in its context via `currentModelMessages()`. Evidence updates are for future turns.
- **Audit + autonomy deferred**: Dashboard enrichment — not required for voice response.
- **Sentence-level TTS**: Each sentence is synthesized independently. If one fails,
  the fallback REST path handles it.
- **VAD 300ms**: Standard for conversational speech. 500ms was conservative.
