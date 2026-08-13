/**
 * F5 (Phase 1A audit) — the fortune subscription window.
 *
 * The rule used to live only inside the fortune HTTP service. AI chat is a
 * SECOND door onto the same engine output and checked profile ownership and the
 * scope enum and nothing else, so:
 *
 *   - a FREE user could open a chat session anchored at 2030 and read a 年運
 *     that `GET /api/fortune/yearly?year=2030` refuses with 403;
 *   - a SUBSCRIBER could read ANY year at zero marginal cost, out of the
 *     monthly free-message quota rather than the +4yr window.
 *
 * `fortune-window.ts` is now the single implementation. These tests cover the
 * rule itself; `fortune-chat-window.spec.ts` covers the three chat doors.
 */
import { ForbiddenException } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import {
  assertFortuneWindow,
  periodsBetween,
  nowIsoInTz,
  FORTUNE_WINDOWS,
  type FortuneScope,
} from '../src/fortune/fortune-window';

const NOW = '2026-08-13';
const FREE = SubscriptionTier.FREE;
const PRO = SubscriptionTier.PRO;

const allow = (scope: FortuneScope, tier: SubscriptionTier, target: string) =>
  expect(() => assertFortuneWindow(scope, tier, target, NOW)).not.toThrow();

const codeFor = (scope: FortuneScope, tier: SubscriptionTier, target: string): string => {
  try {
    assertFortuneWindow(scope, tier, target, NOW);
    return 'ALLOWED';
  } catch (err) {
    return ((err as ForbiddenException).getResponse() as { code: string }).code;
  }
};

describe('F5 — period arithmetic', () => {
  it('DAY counts calendar days', () => {
    expect(periodsBetween('DAY', NOW, '2026-08-13')).toBe(0);
    expect(periodsBetween('DAY', NOW, '2026-08-14')).toBe(1);
    expect(periodsBetween('DAY', NOW, '2026-08-12')).toBe(-1);
    expect(periodsBetween('DAY', NOW, '2026-09-12')).toBe(30);
  });

  it('MONTH counts whole calendar months, not 30-day blocks', () => {
    // One day apart across a month boundary is +1 month, not 0.
    expect(periodsBetween('MONTH', '2026-08-31', '2026-09-01')).toBe(1);
    expect(periodsBetween('MONTH', NOW, '2026-08-01')).toBe(0);
    expect(periodsBetween('MONTH', NOW, '2027-08-01')).toBe(12);
    expect(periodsBetween('MONTH', NOW, '2026-07-01')).toBe(-1);
  });

  it('YEAR counts calendar years', () => {
    expect(periodsBetween('YEAR', '2026-12-31', '2027-01-01')).toBe(1);
    expect(periodsBetween('YEAR', NOW, '2030-01-01')).toBe(4);
  });

  it('accepts the truncated forms the HTTP gates pass (YYYY-MM, YYYY)', () => {
    // enforceMonthlySubscriptionGate passes 'YYYY-MM'; the yearly one 'YYYY'.
    // Chat passes full 'YYYY-MM-DD'. One function has to serve both.
    expect(periodsBetween('MONTH', '2026-08', '2026-09')).toBe(1);
    expect(periodsBetween('YEAR', '2026', '2030')).toBe(4);
  });
});

describe('F5 — FREE tier sees only the current period', () => {
  it.each([
    ['DAY', '2026-08-13'],
    ['MONTH', '2026-08-01'],
    ['YEAR', '2026-01-01'],
  ] as Array<[FortuneScope, string]>)('%s: current period allowed', (scope, target) => {
    allow(scope, FREE, target);
  });

  it.each([
    ['DAY', '2026-08-14', 'tomorrow'],
    ['DAY', '2026-08-12', 'yesterday'],
    ['MONTH', '2026-09-01', 'next month'],
    ['MONTH', '2026-07-01', 'last month'],
    ['YEAR', '2027-01-01', 'next year'],
    ['YEAR', '2025-01-01', 'last year'],
    ['YEAR', '2030-01-01', 'the F5 exploit anchor'],
  ] as Array<[FortuneScope, string, string]>)(
    '%s: %s (%s) → SUBSCRIBER_ONLY',
    (scope, target) => {
      expect(codeFor(scope, FREE, target)).toBe('SUBSCRIBER_ONLY');
    },
  );
});

describe('F5 — subscriber window boundaries are INCLUSIVE', () => {
  it('DAY: −1 .. +30 allowed, −2 and +31 refused', () => {
    allow('DAY', PRO, '2026-08-12');
    allow('DAY', PRO, '2026-09-12');
    expect(codeFor('DAY', PRO, '2026-08-11')).toBe('OUT_OF_WINDOW');
    expect(codeFor('DAY', PRO, '2026-09-13')).toBe('OUT_OF_WINDOW');
  });

  it('MONTH: −1 .. +12 allowed, −2 and +13 refused', () => {
    allow('MONTH', PRO, '2026-07-01');
    allow('MONTH', PRO, '2027-08-01');
    expect(codeFor('MONTH', PRO, '2026-06-01')).toBe('OUT_OF_WINDOW');
    expect(codeFor('MONTH', PRO, '2027-09-01')).toBe('OUT_OF_WINDOW');
  });

  it('YEAR: −1 .. +4 allowed, −2 and +5 refused', () => {
    allow('YEAR', PRO, '2025-01-01');
    allow('YEAR', PRO, '2030-01-01');
    expect(codeFor('YEAR', PRO, '2024-01-01')).toBe('OUT_OF_WINDOW');
    expect(codeFor('YEAR', PRO, '2031-01-01')).toBe('OUT_OF_WINDOW');
  });

  it('applies to every paid tier, not just PRO', () => {
    for (const tier of [SubscriptionTier.BASIC, SubscriptionTier.PRO, SubscriptionTier.MASTER]) {
      expect(codeFor('YEAR', tier, '2031-01-01')).toBe('OUT_OF_WINDOW');
      allow('YEAR', tier, '2030-01-01');
    }
  });
});

describe('F5 — fails closed on a malformed anchor', () => {
  it.each(['abcd-ef-gh', '', 'not-a-date', '  ', '2026/08/13'])(
    'refuses an unparseable anchor rather than admitting it: "%s"',
    (garbage) => {
      // NaN satisfies neither `<` nor `>`, so an unguarded comparison reads
      // "in window" for every one of these.
      for (const scope of ['DAY', 'MONTH', 'YEAR'] as FortuneScope[]) {
        expect(() => assertFortuneWindow(scope, PRO, garbage, NOW)).toThrow(
          ForbiddenException,
        );
        expect(() => assertFortuneWindow(scope, FREE, garbage, NOW)).toThrow(
          ForbiddenException,
        );
      }
    },
  );

  it('refuses a PARTIALLY valid anchor — the subtler hole', () => {
    // "2026-13-99x" has a valid leading YYYY. At YEAR scope only that prefix is
    // read, so arithmetic alone would resolve it to the current year and admit
    // it. The shape check is what rejects it.
    expect(() => assertFortuneWindow('YEAR', FREE, '2026-13-99x', NOW)).toThrow(
      ForbiddenException,
    );
    expect(() => assertFortuneWindow('MONTH', FREE, '2026-08-xx', NOW)).toThrow(
      ForbiddenException,
    );
  });

  it('still accepts the legitimate truncated forms the HTTP gates use', () => {
    // The shape check must not break the existing callers: monthly passes
    // 'YYYY-MM', yearly passes 'YYYY'.
    allow('MONTH', FREE, '2026-08');
    allow('YEAR', FREE, '2026');
    // …but DAY genuinely requires a full date.
    expect(() => assertFortuneWindow('DAY', FREE, '2026-08', NOW)).toThrow(
      ForbiddenException,
    );
  });
});

describe('F5 — timezone', () => {
  it('resolves "now" in the given zone, not UTC', () => {
    // 2026-08-13T17:00Z is already the 14th in Taipei (UTC+8). A UTC clock
    // would shift every boundary by up to 8 hours for the primary market.
    const clock = new Date('2026-08-13T17:00:00Z');
    expect(nowIsoInTz('Asia/Taipei', clock)).toBe('2026-08-14');
    expect(nowIsoInTz('UTC', clock)).toBe('2026-08-13');
  });
});

describe('F5 — the window spec is the single source of truth', () => {
  it('matches the documented product windows', () => {
    // Guards against a silent widening: if someone edits these numbers, the
    // change has to be deliberate enough to update this table too.
    expect(FORTUNE_WINDOWS.DAY).toMatchObject({
      freePast: 0, freeFuture: 0, subscriberPast: 1, subscriberFuture: 30,
    });
    expect(FORTUNE_WINDOWS.MONTH).toMatchObject({
      freePast: 0, freeFuture: 0, subscriberPast: 1, subscriberFuture: 12,
    });
    expect(FORTUNE_WINDOWS.YEAR).toMatchObject({
      freePast: 0, freeFuture: 0, subscriberPast: 1, subscriberFuture: 4,
    });
  });
});
