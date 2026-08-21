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
}

export const emptyStreamUsage = (): StreamUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

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
  const e = event as { type?: string; message?: { usage?: RawUsage }; usage?: RawUsage };
  if (!e || typeof e.type !== 'string') return;
  if (e.type === 'message_start') absorb(into, e.message?.usage);
  else if (e.type === 'message_delta') absorb(into, e.usage);
}

/** Prefer the authoritative final numbers when the stream completed cleanly. */
export function mergeFinalUsage(into: StreamUsage, final: RawUsage | undefined): StreamUsage {
  absorb(into, final);
  return into;
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
