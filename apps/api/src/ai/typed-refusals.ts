import { HttpException } from '@nestjs/common';
import { AI_SPEND_CAP_CODE } from './ai-spend.service';
import { AI_BUSY_CODE } from './ai-governor.service';
import { QUOTA_EXCEEDED_CODE } from './quota.service';

/**
 * The three refusals WE issue, as opposed to failures the providers hand us.
 *
 * ## Why they need to be distinguishable
 *
 * Every generation path ends in a catch that degrades gracefully: serve the
 * deterministic engine output, log an AI failure, move on. That is right for a
 * broken prompt or a provider outage. It is wrong for all three of these,
 * because none of them says anything about this request:
 *
 * - **QUOTA_EXCEEDED (429)** — this user has had their day's allowance.
 * - **AI_SPEND_CAP (503)** — the whole platform is over budget right now.
 * - **AI_BUSY (503)** — the concurrency pool is full *this second*.
 *
 * Treated as AI failures they cause real damage. An audit found each of them
 * doing so: a spend cap charged full credits for an interpretation-less reading
 * at HTTP 200, and an `AI_BUSY` — thrown after as little as three seconds of
 * queueing — incremented the fortune failure counter, which at three strikes
 * arms a **24-hour** breaker. The window that caused it is measured in seconds;
 * the punishment outlives the day the fortune was for.
 *
 * ## Why one module
 *
 * These predicates were being reinvented per package: `isQuotaError` in
 * `quota.service`, `isSpendCapError` in `fortune-snapshot.helpers`, and nothing
 * at all for `AI_BUSY`. Each catch then guarded whichever subset its author
 * happened to know about, so every site was a different combination — which is
 * exactly how `AI_BUSY` ended up guarded nowhere. One import, one list.
 *
 * ## Deliberately narrow
 *
 * Matching is on our own `code`, never on status or message. Over-matching would
 * stop these catches doing their real job, which is absorbing genuine AI
 * failures so a user still gets their chart.
 */

function hasCode(err: unknown, code: string): boolean {
  if (!(err instanceof HttpException)) return false;
  const body = err.getResponse() as { code?: string } | string;
  return typeof body === 'object' && body?.code === code;
}

/** S4 — this user is over their daily allowance. */
export function isQuotaError(err: unknown): boolean {
  return hasCode(err, QUOTA_EXCEEDED_CODE);
}

/** S2 — the platform is over its spend cap. Says nothing about this request. */
export function isSpendCapError(err: unknown): boolean {
  return hasCode(err, AI_SPEND_CAP_CODE);
}

/** S1 — the concurrency pool is full. The most transient of the three. */
export function isAiBusyError(err: unknown): boolean {
  return hasCode(err, AI_BUSY_CODE);
}

/**
 * Any refusal we issued ourselves.
 *
 * ⚠️ Prefer this to enumerating the three at a call site. Every place that
 * listed them by hand ended up with a different subset, and the missing one was
 * never the one the author was thinking about.
 */
export function isSelfRefusal(err: unknown): boolean {
  return selfRefusalCode(err) !== null;
}

/**
 * WHICH refusal, or null. For logs, and for the `failedReason` a refund writes
 * onto the reading — "we refused, here is why" is the difference between a
 * readable ledger and a mystery.
 *
 * ⚠️ `isSelfRefusal` is defined in terms of this rather than the other way
 * round, so a fourth refusal added here is automatically covered by the
 * predicate. The reverse (predicate listing three, this listing three) is the
 * duplicated-subset problem the module docblock is about.
 */
export function selfRefusalCode(err: unknown): string | null {
  for (const code of [QUOTA_EXCEEDED_CODE, AI_SPEND_CAP_CODE, AI_BUSY_CODE]) {
    if (hasCode(err, code)) return code;
  }
  return null;
}
