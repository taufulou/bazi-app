/**
 * The 子時 boundary — found in production at 23:31 Taipei.
 *
 * Per Bazi doctrine the day flips at 23:00, so between 23:00 and midnight the
 * civil date and the Bazi date differ. The web client rolls correctly and sends
 * the Bazi date; the server's `todayIsoDate()` deliberately does not roll. The
 * gate compared one against the other, read "+1 day", and returned
 * SUBSCRIBER_ONLY — for one hour every night, to every free user, on the free
 * tier's headline feature.
 */
import { ForbiddenException } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { assertFortuneWindow } from '../src/fortune/fortune-window';

const FREE = SubscriptionTier.FREE;
const PAID = SubscriptionTier.PRO;

function reason(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    const r = (e as ForbiddenException).getResponse() as { code?: string };
    return r.code;
  }
}

describe('the production failure, reproduced', () => {
  // 23:31 Taipei on 2026-08-23. Civil date 08-23; the client correctly asks
  // for the Bazi date, 08-24.
  const civil = '2026-08-23';
  const bazi = '2026-08-24';

  it('REGRESSION: a free user asking for the Bazi day was refused', () => {
    // Without the second anchor — exactly what shipped — this is SUBSCRIBER_ONLY.
    expect(reason(() => assertFortuneWindow('DAY', FREE, bazi, civil))).toBe(
      'SUBSCRIBER_ONLY',
    );
    // With it, the same request is allowed.
    expect(reason(() => assertFortuneWindow('DAY', FREE, bazi, civil, bazi))).toBeUndefined();
  });

  it('accepts the CIVIL date too — both are legitimate in that hour', () => {
    // Rolling the server instead of accepting both would have broken this
    // direction rather than fixing anything.
    expect(reason(() => assertFortuneWindow('DAY', FREE, civil, civil, bazi))).toBeUndefined();
  });

  it('does not widen the window beyond the boundary', () => {
    // Two days out is still refused; the fix buys exactly one day, and only
    // because that day is genuinely "today" under the other convention.
    expect(reason(() => assertFortuneWindow('DAY', FREE, '2026-08-25', civil, bazi))).toBe(
      'SUBSCRIBER_ONLY',
    );
    expect(reason(() => assertFortuneWindow('DAY', FREE, '2026-08-22', civil, bazi))).toBe(
      'SUBSCRIBER_ONLY',
    );
  });
});

describe('outside the boundary hour, nothing changes', () => {
  // For 23 hours a day both anchors are the same date and the alt is dropped.
  const today = '2026-08-23';

  it('free sees today only', () => {
    expect(reason(() => assertFortuneWindow('DAY', FREE, today, today, today))).toBeUndefined();
    expect(reason(() => assertFortuneWindow('DAY', FREE, '2026-08-24', today, today))).toBe(
      'SUBSCRIBER_ONLY',
    );
    expect(reason(() => assertFortuneWindow('DAY', FREE, '2026-08-22', today, today))).toBe(
      'SUBSCRIBER_ONLY',
    );
  });

  it('subscriber keeps yesterday + 30 days, and no more', () => {
    expect(reason(() => assertFortuneWindow('DAY', PAID, '2026-08-22', today, today))).toBeUndefined();
    expect(reason(() => assertFortuneWindow('DAY', PAID, '2026-09-22', today, today))).toBeUndefined();
    expect(reason(() => assertFortuneWindow('DAY', PAID, '2026-08-21', today, today))).toBe(
      'OUT_OF_WINDOW',
    );
    expect(reason(() => assertFortuneWindow('DAY', PAID, '2026-09-23', today, today))).toBe(
      'OUT_OF_WINDOW',
    );
  });

  it('omitting the alt anchor behaves exactly as before', () => {
    expect(reason(() => assertFortuneWindow('DAY', FREE, today, today))).toBeUndefined();
    expect(reason(() => assertFortuneWindow('DAY', FREE, '2026-08-24', today))).toBe(
      'SUBSCRIBER_ONLY',
    );
  });
});

describe('the same roll can cross a month or year end', () => {
  it('MONTH: 23:00 on the last day of August', () => {
    expect(reason(() => assertFortuneWindow('MONTH', FREE, '2026-09', '2026-08', '2026-09'))).toBeUndefined();
    // and a month that is neither is still refused
    expect(reason(() => assertFortuneWindow('MONTH', FREE, '2026-10', '2026-08', '2026-09'))).toBe(
      'SUBSCRIBER_ONLY',
    );
  });

  it('YEAR: 23:00 on New Year\'s Eve', () => {
    expect(reason(() => assertFortuneWindow('YEAR', FREE, '2027', '2026', '2027'))).toBeUndefined();
    expect(reason(() => assertFortuneWindow('YEAR', FREE, '2028', '2026', '2027'))).toBe(
      'SUBSCRIBER_ONLY',
    );
  });
});

describe('the alt anchor cannot be used to get in', () => {
  const today = '2026-08-23';

  it('a malformed TARGET still fails closed', () => {
    expect(reason(() => assertFortuneWindow('DAY', FREE, 'abcd-ef-gh', today, today))).toBe(
      'OUT_OF_WINDOW',
    );
  });

  it('a malformed ALT is dropped, leaving the primary verdict standing', () => {
    // Permissive direction: garbage must not admit a target the primary anchor
    // rejects. 2026-09-01 is 9 days out — outside free, inside subscriber — so
    // the expected verdict is SUBSCRIBER_ONLY and not "allowed".
    expect(reason(() => assertFortuneWindow('DAY', FREE, '2026-09-01', today, 'garbage'))).toBe(
      'SUBSCRIBER_ONLY',
    );
    // Restrictive direction: garbage must not reject a valid one either.
    expect(reason(() => assertFortuneWindow('DAY', FREE, today, today, 'garbage'))).toBeUndefined();
  });

  it('an out-of-range target reports OUT_OF_WINDOW, not SUBSCRIBER_ONLY', () => {
    // The message should name the remedy that would actually work: subscribing
    // does not help if no tier could see that date.
    expect(reason(() => assertFortuneWindow('DAY', FREE, '2027-01-01', today, today))).toBe(
      'OUT_OF_WINDOW',
    );
  });
});
