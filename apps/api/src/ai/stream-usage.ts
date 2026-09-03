/**
 * Token usage accumulated AS a stream arrives, so an aborted stream is still
 * metered.
 *
 * ## Why this exists
 *
 * Four of the five streaming call sites read usage only from
 * `await stream.finalMessage()`, which is reached solely on clean completion.
 * On a client disconnect or a watchdog abort, control jumps to the `catch` and
 * nothing is recorded — but Anthropic bills the input in full regardless, and
 * for chat that is most of the turn's cost: a ~10k-token system block cached at
 * the 1h TTL is charged at the 2× cache-WRITE rate on the first turn. So the
 * spend figure the breaker reads systematically under-counted exactly the case
 * mobile produces most.
 *
 * `ai.service.ts::_streamProviderInner` already got this right — it captures
 * `input_tokens` at `message_start` and records in a `finally`. Its comment
 * makes the argument ("recording only on clean completion would systematically
 * under-count exactly the disconnect case mobile produces most") while the four
 * other sites carried a comment asserting the opposite, calling it
 * "under-count by design". Both cannot be right about the same event. This is
 * the shared version of the one that is.
 *
 * ## What the events carry
 *
 * - `message_start` — the whole input side: `input_tokens` plus both cache
 *   counters. Present from the very first event, which is what makes an aborted
 *   stream meterable at all.
 * - `message_delta` — a running `output_tokens`. CUMULATIVE, not incremental,
 *   so it is assigned rather than added; summing them multiplies the bill.
 *
 * Fields are only overwritten when present, so a later event that omits one
 * cannot erase what an earlier event established.
 */

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * Characters of assistant text seen so far, from `content_block_delta`.
   *
   * The ONLY output signal an aborted stream leaves behind — see
   * `finalizeStreamUsage`. Counted always, so a completed stream can be used to
   * re-calibrate `CHARS_PER_OUTPUT_TOKEN` against its authoritative count.
   */
  outputTextChars: number;
  /** True when `outputTokens` came from the char estimate, not from the API. */
  outputTokensEstimated: boolean;
}

export const emptyStreamUsage = (): StreamUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTextChars: 0,
  outputTokensEstimated: false,
});

/**
 * Characters of zh-TW output per token, for the abort estimate.
 *
 * Calibrated against a real completed LIFETIME generation (2026-09-02):
 * `outTok: 7667` for a 15-section Traditional Chinese reading of roughly 11.5k
 * characters — about 1.5 chars per token. English runs nearer 4, so this
 * OVER-estimates a latin-heavy response.
 *
 * ⚠️ That direction is deliberate. This number feeds a SPEND CAP, where
 * under-counting is the dangerous error (a blind breaker during exactly the
 * runaway it exists to stop) and over-counting merely trips it early. Combined
 * with `Math.ceil` and the `max(observed, estimate)` rule below, the bias is
 * mildly upward on purpose.
 *
 * ⚠️ It is an ESTIMATE and is flagged as one (`outputTokensEstimated`), which
 * is what makes it auditable: `outputTextChars` is recorded on completed
 * streams too, so the true ratio can be recomputed from real traffic and this
 * constant re-tuned rather than trusted forever.
 */
export const CHARS_PER_OUTPUT_TOKEN = 1.5;

export function estimateOutputTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_OUTPUT_TOKEN);
}

/** The SDK types the cache counters as `number | null`, so null must be a
 *  first-class case here rather than something the caller has to launder. */
type RawUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function absorb(into: StreamUsage, usage: RawUsage | undefined): void {
  if (!usage) return;
  if (typeof usage.input_tokens === 'number') into.inputTokens = usage.input_tokens;
  // Cumulative, not incremental — see the docblock.
  if (typeof usage.output_tokens === 'number') into.outputTokens = usage.output_tokens;
  if (typeof usage.cache_read_input_tokens === 'number') {
    into.cacheReadTokens = usage.cache_read_input_tokens;
  }
  if (typeof usage.cache_creation_input_tokens === 'number') {
    into.cacheWriteTokens = usage.cache_creation_input_tokens;
  }
}

/**
 * Fold one Anthropic stream event into the accumulator.
 *
 * Deliberately total and untyped at the edge: the caller's `for await` loop is
 * the hot path and must never throw on an event shape this does not recognise.
 */
export function absorbStreamUsage(event: unknown, into: StreamUsage): void {
  const e = event as {
    type?: string;
    message?: { usage?: RawUsage };
    usage?: RawUsage;
    delta?: { text?: unknown };
  };
  if (!e || typeof e.type !== 'string') return;
  if (e.type === 'message_start') absorb(into, e.message?.usage);
  else if (e.type === 'message_delta') absorb(into, e.usage);
  else if (e.type === 'content_block_delta' && typeof e.delta?.text === 'string') {
    // The abort-survivable output signal. `message_delta` carries the real
    // `output_tokens` but arrives ONCE, near the end, so an abort before it
    // leaves only `message_start`'s token count — which is ~1.
    into.outputTextChars += e.delta.text.length;
  }
}

/** Prefer the authoritative final numbers when the stream completed cleanly. */
export function mergeFinalUsage(into: StreamUsage, final: RawUsage | undefined): StreamUsage {
  absorb(into, final);
  return into;
}

/**
 * Fill in an output figure the API never gave us.
 *
 * ## The bug this closes
 *
 * `message_delta` carries the cumulative `output_tokens` and is emitted ONCE,
 * near the end. Abort before it — a client disconnect, a watchdog, a timeout —
 * and the output side is recorded as a confident ZERO while Anthropic bills
 * every token produced.
 *
 * Measured in production 2026-09-02 on a real reading:
 *
 *     ms:179998  inTok:22222  outTok:0  costUsd:0.066666
 *
 * 22222 x $3/1M = $0.066666 exactly — input only, for a call that had produced
 * most of 14 sections. At a plausible ~10k output tokens the reading truly cost
 * ~$0.34 against $0.187 booked, roughly a 45% under-count.
 *
 * ⚠️ The breaker is blindest exactly when spend spikes: timeouts and retries
 * ARE the runaway case, and they are the case that under-reported.
 *
 * ## Why `max` rather than "estimate when no message_delta arrived"
 *
 * Some responses produce more than one `message_delta`, so a late abort can
 * capture a partial cumulative count that is real but low. Taking the larger of
 * the two is correct under either emission pattern, and can never move an
 * authoritative number DOWN.
 *
 * Idempotent — safe to call twice, and safe to call after `mergeFinalUsage`,
 * where the authoritative count normally wins.
 */
export function finalizeStreamUsage(u: StreamUsage): StreamUsage {
  const estimate = estimateOutputTokensFromChars(u.outputTextChars);
  if (estimate > u.outputTokens) {
    u.outputTokens = estimate;
    u.outputTokensEstimated = true;
  }
  return u;
}

/**
 * Did this stream cost anything?
 *
 * ⚠️ Includes the CACHE counters. The first version asked only about
 * `inputTokens || outputTokens` — in a module whose whole argument is that the
 * expensive part of a chat turn is a ~10k-token system block billed at the 2×
 * cache-WRITE rate. An abort reporting `input_tokens: 0` alongside a large
 * `cache_creation_input_tokens` would have been dropped by the guard protecting
 * it. Reachable only if the SDK ever makes `input_tokens` optional, but the
 * inconsistency is the kind that becomes true later without anyone noticing.
 */
export function hasUsage(u: StreamUsage): boolean {
  return Boolean(u.inputTokens || u.outputTokens || u.cacheReadTokens || u.cacheWriteTokens);
}
