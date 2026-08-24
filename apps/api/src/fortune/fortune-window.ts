import { ForbiddenException } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';

/**
 * The fortune subscription-window rule, in ONE place.
 *
 * Why it lives here rather than on `FortuneSnapshotHelpers`:
 *
 * F5 (Phase 1A audit) — the rule was implemented only inside the fortune HTTP
 * service, and AI chat is a SECOND door onto the same engine output. Chat
 * validated profile ownership and the scope enum and nothing else, so a FREE
 * user could open a chat session anchored at 2030 and read a 年運 that
 * `GET /api/fortune/yearly?year=2030` refuses with 403 — and a subscriber could
 * read any year at all at zero marginal cost out of their monthly free-message
 * quota.
 *
 * A rule that exists on one caller is not a rule. These are pure functions
 * taking an explicit `now`, so every door enforces the same thing and the
 * window arithmetic is testable without a clock or a DI container.
 *
 * ⚠️ Windows are INCLUSIVE at both ends and counted in whole periods, not days:
 * MONTH ±N means calendar months, YEAR ±N calendar years.
 */

export type FortuneScope = 'DAY' | 'MONTH' | 'YEAR';

/** Per-scope window, in whole periods, relative to "now". */
interface WindowSpec {
  freePast: number;
  freeFuture: number;
  subscriberPast: number;
  subscriberFuture: number;
  /** Trailing half of the FREE rejection message. */
  freeMessage: string;
  /** Builds the subscriber out-of-range message. */
  outOfWindowMessage: (past: number, future: number) => string;
}

export const FORTUNE_WINDOWS: Record<FortuneScope, WindowSpec> = {
  DAY: {
    freePast: 0,
    freeFuture: 0,
    subscriberPast: 1,
    subscriberFuture: 30,
    freeMessage: '此功能限訂閱用戶 — 免費用戶僅可查看當日運勢',
    outOfWindowMessage: (_p, f) => `日運可查範圍：昨日至今日後 ${f} 天`,
  },
  MONTH: {
    freePast: 0,
    freeFuture: 0,
    subscriberPast: 1,
    subscriberFuture: 12,
    freeMessage: '此功能限訂閱用戶 — 免費用戶僅可查看當月運勢',
    outOfWindowMessage: (_p, f) => `月運可查範圍：上個月 + 本月 + 未來 ${f} 個月`,
  },
  YEAR: {
    freePast: 0,
    freeFuture: 0,
    subscriberPast: 1,
    subscriberFuture: 4,
    freeMessage: '此功能限訂閱用戶 — 免費用戶僅可查看當年運勢',
    outOfWindowMessage: (_p, f) => `年運可查範圍：去年 + 今年 + 未來 ${f} 年`,
  },
};

/**
 * Accepted anchor shapes per scope. Deliberately permissive about a longer
 * suffix than the scope needs — the HTTP gates pass `YYYY-MM` / `YYYY` while
 * chat passes a full `YYYY-MM-DD`, and both are legitimate — but strict about
 * anything that is not digits and dashes.
 */
const ANCHOR_SHAPE: Record<FortuneScope, RegExp> = {
  DAY: /^\d{4}-\d{2}-\d{2}$/,
  MONTH: /^\d{4}-\d{2}(-\d{2})?$/,
  YEAR: /^\d{4}(-\d{2}(-\d{2})?)?$/,
};

/** Current date in `tz`, as YYYY-MM-DD. 'sv-SE' formats that natively. */
export function nowIsoInTz(tz: string, clock: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(clock);
}

/**
 * Whole periods from `now` to `target`, at the granularity of `scope`.
 * Both arguments are YYYY-MM-DD; the unused tail is ignored per scope, so a
 * MONTH comparison of `2026-08-31` → `2026-09-01` is +1, not 0.
 */
export function periodsBetween(
  scope: FortuneScope,
  nowIso: string,
  targetIso: string,
): number {
  if (scope === 'DAY') {
    const from = new Date(`${nowIso}T00:00:00Z`).getTime();
    const to = new Date(`${targetIso}T00:00:00Z`).getTime();
    return Math.round((to - from) / (24 * 60 * 60 * 1000));
  }
  const [ny, nm] = nowIso.split('-').map(Number);
  const [ty, tm] = targetIso.split('-').map(Number);
  if (scope === 'YEAR') return ty! - ny!;
  return (ty! - ny!) * 12 + (tm! - nm!);
}

/**
 * Throws when `tier` may not view `targetIso` at `scope`. Returns silently when
 * allowed.
 *
 * @param targetIso YYYY-MM-DD. MONTH/YEAR callers may pass a period start
 *                  (`2030-01-01`); only the leading components are compared.
 * @param nowIso    today in the platform timezone — pass it explicitly so the
 *                  gate is deterministic under test.
 *
 * @throws ForbiddenException `SUBSCRIBER_ONLY` (free user outside the current
 *         period) or `OUT_OF_WINDOW` (subscriber beyond the lookahead).
 */
/**
 * @param altNowIso  A SECOND acceptable anchor for "now"; the target is in
 *   window if it satisfies the rule against EITHER. Exists for the 子時
 *   boundary: per Bazi doctrine the day flips at 23:00, so between 23:00 and
 *   midnight the civil day and the Bazi day are different dates and BOTH are
 *   legitimate answers to "today".
 *
 *   The client already rolls correctly (`resolveBaziToday`), and the server's
 *   `todayIsoDate()` deliberately does not — its own comment says the client is
 *   expected to resolve the boundary. Comparing one against the other made the
 *   gate see "+1 day" and refuse: for one hour every night, a free user asking
 *   for today's fortune got `SUBSCRIBER_ONLY`. Found in production at 23:31
 *   Taipei, which is the only reason it surfaced.
 *
 *   Accepting either anchor is deliberate over picking one. Rolling the server
 *   instead would just move the break to any client that sends the civil date;
 *   during that hour the question genuinely has two right answers, and a gate
 *   is the wrong place to adjudicate doctrine.
 */
export function assertFortuneWindow(
  scope: FortuneScope,
  tier: SubscriptionTier,
  targetIso: string,
  nowIso: string,
  altNowIso?: string,
): void {
  const spec = FORTUNE_WINDOWS[scope];

  // ⚠️ Fail CLOSED on a malformed anchor, BEFORE the arithmetic.
  //
  // Two distinct holes this closes. `NaN` satisfies neither `<` nor `>`, so an
  // anchor of "abcd-ef-gh" would sail through every comparison below and land
  // as "in window". And a partially-valid anchor is worse: at YEAR scope only
  // the leading `YYYY` is read, so "2026-13-99x" would parse to year 2026 and
  // be admitted as the current year.
  //
  // Callers do validate (the chat DTO's regex + IsDateString, the fortune
  // controller DTOs). This is not redundancy for its own sake — a gate that
  // silently admits garbage is one refactor away from being the only thing
  // between a bad input and free content.
  if (!ANCHOR_SHAPE[scope].test(targetIso)) {
    throw new ForbiddenException({
      code: 'OUT_OF_WINDOW',
      message: spec.outOfWindowMessage(spec.subscriberPast, spec.subscriberFuture),
    });
  }

  // Every anchor worth measuring against — deduped, and only the finite ones.
  // An unusable alt anchor must not make the gate more permissive OR less: it
  // is simply dropped, leaving the primary anchor's verdict to stand.
  const diffs = [nowIso, ...(altNowIso && altNowIso !== nowIso ? [altNowIso] : [])]
    .map((anchor) => periodsBetween(scope, anchor, targetIso))
    .filter((d) => Number.isFinite(d));

  if (diffs.length === 0) {
    throw new ForbiddenException({
      code: 'OUT_OF_WINDOW',
      message: spec.outOfWindowMessage(spec.subscriberPast, spec.subscriberFuture),
    });
  }

  const withinFree = diffs.some((d) => d >= -spec.freePast && d <= spec.freeFuture);
  const withinSubscriber = diffs.some(
    (d) => d >= -spec.subscriberPast && d <= spec.subscriberFuture,
  );

  if (tier === SubscriptionTier.FREE) {
    if (!withinFree) {
      // Still SUBSCRIBER_ONLY rather than OUT_OF_WINDOW when a subscriber
      // could have seen it — the message should name the thing that would fix
      // it, and "subscribe" is a different remedy from "pick another date".
      throw new ForbiddenException({
        code: withinSubscriber ? 'SUBSCRIBER_ONLY' : 'OUT_OF_WINDOW',
        message: withinSubscriber
          ? spec.freeMessage
          : spec.outOfWindowMessage(spec.subscriberPast, spec.subscriberFuture),
      });
    }
    return;
  }

  if (!withinSubscriber) {
    throw new ForbiddenException({
      code: 'OUT_OF_WINDOW',
      message: spec.outOfWindowMessage(spec.subscriberPast, spec.subscriberFuture),
    });
  }
}
