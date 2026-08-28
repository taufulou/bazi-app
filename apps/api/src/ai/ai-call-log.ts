import { createHash } from 'node:crypto';

/**
 * Ob1 — one structured line per AI call.
 *
 * ## What question this answers
 *
 * Before this, an AI call left three separate traces and no single record: the
 * spend counter moved in Redis, a durable `AIUsageLog` row appeared for *some*
 * sites, and nothing at all said how long it took or which surface it came
 * from. So the operational questions — "why is the bill up today", "which route
 * is slow", "is one account eating the budget", "how close are we to the
 * output-token limit" — each needed a different tool, and two of them had no
 * answer.
 *
 * One line with every field answers all four with `grep`, which is the whole
 * bar for Ob1: **visible in Railway**.
 *
 * ## Why the user id is hashed
 *
 * The operational question is "are these forty calls one account?", not "which
 * account". A truncated digest answers the first and not the second, so the
 * grouping survives while a stable identifier that joins to every other table
 * in the product never reaches a third-party log store. The raw id stays inside
 * the trust boundary, exactly like the birth-data rule in
 * `common/sentry-scrub.ts`.
 *
 * ⚠️ This is pseudonymisation, not anonymisation — the space of user ids is
 * enumerable, so anyone holding the database could reverse it. It is a control
 * against casual exposure in logs, and it is not a licence to log anything else
 * identifying alongside it.
 */

/** Enough to group by, short enough to read in a log line. */
const HASH_CHARS = 12;

export function hashUserId(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return createHash('sha256').update(userId).digest('hex').slice(0, HASH_CHARS);
}

export interface AiCallLogFields {
  /** Surface + operation, e.g. `chat:stream`, `reading:LIFETIME`. */
  route: string;
  provider: string;
  model: string;
  /** Wall-clock duration of the provider call. `null` when the site cannot time it. */
  ms: number | null;
  inTok: number;
  outTok: number;
  cacheReadTok: number;
  cacheWriteTok: number;
  costUsd: number;
  userIdHash: string | null;
  /** Account-level gauge — see `anthropic-rate-limit.ts`, NOT per-call. */
  rlOutRemaining: number | null;
  rlOutReset: string | null;
}

/**
 * The prefix operators grep for. Kept as a constant so a rename cannot silently
 * break a saved Railway query while every test still passes.
 */
export const AI_CALL_LOG_PREFIX = 'AI-CALL';

/**
 * Render one call as `AI-CALL {json}`.
 *
 * JSON rather than `key=value` pairs because two of the values are free-ish
 * strings (`route`, `model`) and one is a timestamp containing `:` and `+`.
 * `JSON.stringify` escapes newlines, which also makes the line injection-proof
 * — `route` is assembled from a reading type that ultimately comes from a
 * request body.
 */
export function formatAiCallLog(f: AiCallLogFields): string {
  return `${AI_CALL_LOG_PREFIX} ${JSON.stringify({
    route: f.route,
    provider: f.provider,
    model: f.model,
    ms: f.ms,
    inTok: f.inTok,
    outTok: f.outTok,
    cacheReadTok: f.cacheReadTok,
    cacheWriteTok: f.cacheWriteTok,
    // Six decimals: a cheap Haiku call rounds to $0.000 at three, and a column
    // of zeroes is indistinguishable from "not metered".
    costUsd: Number(f.costUsd.toFixed(6)),
    userIdHash: f.userIdHash,
    rlOutRemaining: f.rlOutRemaining,
    rlOutReset: f.rlOutReset,
  })}`;
}
