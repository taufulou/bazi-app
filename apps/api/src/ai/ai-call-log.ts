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

/**
 * Did the provider call produce a result, or die?
 *
 * Ob1 originally had no such field, and the gap was not cosmetic: a call that
 * failed before its first response reached `record()` at some sites and not at
 * others, so the most expensive path in the system could fail completely and
 * emit NOTHING. Where a line did appear it was a `$0` one, indistinguishable
 * from a cache hit. One field makes "it ran and cost nothing" and "it died"
 * different rows.
 *
 * `'abandoned'` is its own value rather than folded into either. A consumer
 * that walks away — client disconnect, watchdog abort, a `break` — abandons the
 * generator WITHOUT throwing, so it is not an `'error'`; but it is also not a
 * completed call, and the code's own note calls it "the commonest ending on
 * mobile". Labelling the most frequent non-success ending `'ok'` would make
 * this field actively misleading, which is worse than not having it.
 */
export type AiCallOutcome = 'ok' | 'error' | 'abandoned';

/**
 * Coarse classification of a provider failure, for the `errorKind` field.
 *
 * ⚠️ It NEVER includes `error.message`. A provider error can echo request
 * content back, and these requests carry birth data — the four pillars are a
 * reversible encoding of a birth datetime, so they are personal data and must
 * not reach a third-party log store (see the domain PII rule in CLAUDE.md).
 * Error NAME, numeric status and our own typed codes are all non-identifying;
 * the message is not, so it is dropped rather than filtered.
 *
 * The name is also stripped to `[A-Za-z0-9_]` — an error name is attacker-
 * influenceable in principle, and this line is grepped by operators.
 */
export function classifyAiError(err: unknown): string {
  // ⚠️ TOTAL by construction. Every call site evaluates this as an ARGUMENT —
  // outside the `try` that makes `logCall` safe — and two of them sit in a
  // `finally`, where a throw would REPLACE the original exception with a
  // logging error. Same reasoning as the nested catch in `logCall`: a helper
  // whose job is to make failures visible must not be able to create one.
  // Reading `.name` or `.getResponse()` off an arbitrary thrown value can run
  // a getter, and a getter can throw.
  try {
    return classifyAiErrorInner(err);
  } catch {
    return 'unclassifiable';
  }
}

function classifyAiErrorInner(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';

  // Our OWN refusals, which are not provider failures at all. Distinguishing
  // them matters: "Anthropic is down" and "we shed load" want different
  // responses, and both otherwise land in the 5xx bucket because NestJS
  // HttpException exposes a numeric `status` (the same trap documented on
  // `isRetryableError`).
  const body = (err as { getResponse?: () => unknown }).getResponse?.();
  const code =
    body && typeof body === 'object'
      ? (body as { code?: unknown }).code
      : undefined;
  if (typeof code === 'string' && code) return sanitiseKind(code);

  if (err.name === 'AbortError' || /abort/i.test(err.name)) return 'abort';

  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') {
    if (status === 429) return 'rate_limit';
    if (status === 529) return 'overloaded';
    if (status >= 500 && status < 600) return `server_${status}`;
    if (status >= 400 && status < 500) return `client_${status}`;
  }

  return sanitiseKind(err.name || 'error');
}

function sanitiseKind(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  return cleaned || 'error';
}

/**
 * Who a provider call is FOR, and what it is. Ob1 attribution.
 *
 * Both fields fix the same defect from opposite ends. A streamed reading — the
 * most expensive generation in the app — used to log `userIdHash: null` and a
 * route of `stream:CLAUDE`, so its lines could be attributed to neither an
 * ACCOUNT nor a CALL. Two V2 calls per reading and three per compatibility
 * reveal all rendered identically, which made "why is the bill up" unanswerable
 * on precisely the path that dominates the bill.
 *
 * Carried as one object rather than two positional parameters because the two
 * are always known together, at the same place, and a bare trailing `string`
 * next to an existing optional `AbortSignal` is easy to pass in the wrong slot.
 */
export interface AiCallAttribution {
  /** Ob1 `route` — surface, operation and which call, e.g. `stream:LIFETIME:call1`. */
  route: string;
  /** RAW id. Hashed at the log boundary by `hashUserId`; never written raw. */
  userId: string | null;
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
  /** `'error'` when the call died. Defaults to `'ok'` so existing sites are unchanged. */
  outcome?: AiCallOutcome;
  /** Set only when `outcome` is `'error'`. See `classifyAiError` — never a message. */
  errorKind?: string | null;
  /**
   * #20 — `outTok` is an ESTIMATE from streamed characters, not a figure the
   * API returned. True only for an aborted stream, which never sees the
   * `message_delta` carrying the real count.
   *
   * ⚠️ Emitted always, including `false`. A field that appears only in the
   * unusual case cannot be filtered on, and `outEst:true` is exactly the query
   * an operator needs to size how much of the day's spend is inferred.
   */
  outTokEstimated?: boolean;
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
    // Always emitted, including the `'ok'` case: a field that appears only on
    // failure cannot be filtered on, and `outcome!=ok` is the query an operator
    // actually wants.
    outcome: f.outcome ?? 'ok',
    errorKind: f.errorKind ?? null,
    outEst: f.outTokEstimated ?? false,
  })}`;
}
