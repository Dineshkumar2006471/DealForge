/**
 * DealForge — Voice Turn Latency Trace
 *
 * Monotonic per-stage latency tracking using performance.now().
 * Used by agentRuntime and publicCalls to measure each pipeline stage
 * and emit a single diagnostic log line per turn.
 *
 * All timestamps are relative to trace.start() — never wall-clock Date.now().
 */

const { performance } = require('perf_hooks');

class VoiceTurnTrace {
  constructor(turnId) {
    this.turnId = turnId || 'auto';
    this._t0 = performance.now();
    this._marks = {};
  }

  /** Mark a named checkpoint (monotonic, millisecond-precision). */
  mark(name) {
    if (!this._marks[name]) {
      this._marks[name] = performance.now();
    }
  }

  /** Elapsed milliseconds from start to a named mark (or now). */
  elapsed(name) {
    const t = this._marks[name] || performance.now();
    return Math.round(t - this._t0);
  }

  /** Elapsed milliseconds between two marks. */
  span(from, to) {
    const a = this._marks[from];
    const b = this._marks[to];
    if (!a || !b) return 0;
    return Math.round(b - a);
  }

  /** Total elapsed ms since trace creation. */
  total() {
    return Math.round(performance.now() - this._t0);
  }

  /**
   * Build a safe diagnostic log line.
   * Section 3 of the voice prompt spec: no PII, no secrets, no tokens.
   */
  diagnosticLine(extra = {}) {
    const parts = [`turnId=${this.turnId}`];
    // Add all marks as relative timestamps
    const sortedMarks = Object.entries(this._marks).sort((a, b) => a[1] - b[1]);
    for (const [name, t] of sortedMarks) {
      parts.push(`${name}=${Math.round(t - this._t0)}ms`);
    }
    // Add extra key-value pairs
    for (const [k, v] of Object.entries(extra)) {
      parts.push(`${k}=${v}`);
    }
    parts.push(`TOTAL=${this.total()}ms`);
    return `[VOICE_TURN_TRACE] ${parts.join(' ')}`;
  }
}

module.exports = { VoiceTurnTrace };
