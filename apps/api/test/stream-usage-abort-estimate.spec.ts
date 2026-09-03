import {
  absorbStreamUsage,
  emptyStreamUsage,
  estimateOutputTokensFromChars,
  finalizeStreamUsage,
  hasUsage,
  mergeFinalUsage,
  CHARS_PER_OUTPUT_TOKEN,
} from '../src/ai/stream-usage';

/**
 * #20 — an aborted stream booked its output as a confident ZERO.
 *
 * `message_delta` carries the cumulative `output_tokens` and is emitted ONCE,
 * near the end. Abort before it (client disconnect, watchdog, timeout) and the
 * only output figure left is `message_start`'s, which is ~1 — while Anthropic
 * bills every token produced.
 *
 * Measured in production 2026-09-02 on a real reading:
 *
 *     ms:179998  inTok:22222  outTok:0  costUsd:0.066666
 *
 * 22222 x $3/1M = $0.066666 exactly: input only, for a call that had produced
 * most of 14 sections. ~45% under-count.
 *
 * ⚠️ The breaker is blindest exactly when spend spikes — timeouts and retries
 * ARE the runaway case, and they were the case that under-reported.
 */
describe('stream usage — aborted output estimate', () => {
  const start = (inputTokens: number) => ({
    type: 'message_start',
    message: { usage: { input_tokens: inputTokens, output_tokens: 1 } },
  });
  const text = (t: string) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } });
  const finalDelta = (out: number) => ({ type: 'message_delta', usage: { output_tokens: out } });

  it('reproduces the production abort and no longer books zero output', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage(start(22222), u);
    // ~11.5k characters of zh-TW, i.e. most of a 14-section reading.
    for (let i = 0; i < 115; i++) absorbStreamUsage(text('八'.repeat(100)), u);
    // ...then the stream is aborted: no `message_delta` ever arrives.

    expect(u.outputTokens).toBe(1); // what the old code would have booked
    finalizeStreamUsage(u);

    expect(u.outputTokensEstimated).toBe(true);
    expect(u.outputTokens).toBeGreaterThan(5000);
    // Sanity against the real completed call (7667 output tokens for a
    // comparable reading) — the estimate must land in the right order of
    // magnitude, not merely be non-zero.
    expect(u.outputTokens).toBeLessThan(15000);
  });

  it('leaves a CLEAN stream on the API number, not the estimate', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage(start(22222), u);
    for (let i = 0; i < 115; i++) absorbStreamUsage(text('八'.repeat(100)), u);
    absorbStreamUsage(finalDelta(7667), u);
    finalizeStreamUsage(u);
    expect(u.outputTokens).toBe(7667);
    expect(u.outputTokensEstimated).toBe(false);
  });

  it('never moves an authoritative count DOWN', () => {
    // Some responses emit more than one `message_delta`, so a late abort can
    // hold a real-but-partial count. `max`, never assignment.
    const u = emptyStreamUsage();
    absorbStreamUsage(start(100), u);
    absorbStreamUsage(text('x'), u); // estimate would be 1
    absorbStreamUsage(finalDelta(9000), u);
    finalizeStreamUsage(u);
    expect(u.outputTokens).toBe(9000);
    expect(u.outputTokensEstimated).toBe(false);
  });

  it('is idempotent — safe to call twice and after mergeFinalUsage', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage(start(10), u);
    absorbStreamUsage(text('八'.repeat(300)), u);
    finalizeStreamUsage(u);
    const once = u.outputTokens;
    finalizeStreamUsage(u);
    expect(u.outputTokens).toBe(once);
    mergeFinalUsage(u, { output_tokens: undefined });
    finalizeStreamUsage(u);
    expect(u.outputTokens).toBe(once);
  });

  it('counts text ONLY from content_block_delta, not from other events', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage({ type: 'content_block_start', delta: { text: 'ignored' } }, u);
    absorbStreamUsage({ type: 'message_stop' }, u);
    expect(u.outputTextChars).toBe(0);
  });

  it('survives malformed events without throwing — the hot path must not break', () => {
    const u = emptyStreamUsage();
    for (const e of [null, undefined, {}, { type: 42 }, { type: 'content_block_delta' },
                     { type: 'content_block_delta', delta: { text: 12345 } }]) {
      expect(() => absorbStreamUsage(e, u)).not.toThrow();
    }
    expect(u.outputTextChars).toBe(0);
  });

  it('makes an abort that produced text pass the hasUsage gate', () => {
    // Without the estimate a text-producing abort with cached input could be
    // dropped entirely by the guard that decides whether to record at all.
    const u = emptyStreamUsage();
    absorbStreamUsage(text('八'.repeat(50)), u);
    expect(hasUsage(u)).toBe(false);
    finalizeStreamUsage(u);
    expect(hasUsage(u)).toBe(true);
  });

  describe('estimateOutputTokensFromChars', () => {
    it('rounds UP — under-counting is the dangerous direction for a spend cap', () => {
      expect(estimateOutputTokensFromChars(1)).toBe(1);
      expect(estimateOutputTokensFromChars(CHARS_PER_OUTPUT_TOKEN * 10)).toBe(10);
      expect(estimateOutputTokensFromChars(CHARS_PER_OUTPUT_TOKEN * 10 + 0.1)).toBe(11);
    });

    it('returns 0 for nothing, and for junk', () => {
      for (const v of [0, -5, NaN, Infinity]) expect(estimateOutputTokensFromChars(v)).toBe(0);
    });
  });
});
