/**
 * F5 follow-up (F-1 from the fix audit) — the HTTP subscription gates.
 *
 * The F5 fix consolidated the window rule into `fortune-window.ts` on the
 * thesis that "a rule that exists on one caller is not a rule" — and then
 * shipped with zero tests on half its callers. The audit demonstrated it: with
 * all three `enforce*SubscriptionGate` bodies replaced by no-ops, the ENTIRE
 * 1482-test suite passed. That deletes the paywall on six fortune doors
 * (`GET /api/fortune/{daily,monthly,yearly}` plus their three SSE variants)
 * with CI green — the same shape of defect as F5 itself.
 *
 * The opposite direction was equally invisible: swapping the yearly gate's
 * scope argument to 'DAY' compiles, makes every yearly request 403, and passes
 * all 184 fortune tests — a total outage of a paid feature that CI cannot see.
 *
 * These pin the wiring: the right scope, for the right tier, at the right
 * boundary. The arithmetic itself is covered by `fortune-window.spec.ts`.
 */
import { ForbiddenException } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { FortuneSnapshotHelpers } from '../src/fortune/fortune-snapshot.helpers';

const FREE = SubscriptionTier.FREE;
const PRO = SubscriptionTier.PRO;

/** Helpers resolve "now" from the system clock, so pin it. */
const FIXED_NOW = new Date('2026-08-13T04:00:00Z'); // = 2026-08-13 noon Taipei

function makeHelpers() {
  return new FortuneSnapshotHelpers(
    {} as never,
    {} as never,
    {
      get: jest.fn((k: string) =>
        k === 'FORTUNE_DEFAULT_TZ' ? 'Asia/Taipei' : undefined,
      ),
    } as never,
  );
}

const codeOf = (fn: () => void): string => {
  try {
    fn();
    return 'ALLOWED';
  } catch (err) {
    return ((err as ForbiddenException).getResponse() as { code: string }).code;
  }
};

describe('F-1 — HTTP subscription gates are wired to the right scope', () => {
  let helpers: FortuneSnapshotHelpers;

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });
  afterAll(() => {
    jest.useRealTimers();
  });
  beforeEach(() => {
    helpers = makeHelpers();
  });

  describe('daily — enforceSubscriptionGate', () => {
    it('allows a FREE user today', () => {
      expect(codeOf(() => helpers.enforceSubscriptionGate(FREE, '2026-08-13'))).toBe('ALLOWED');
    });

    it('refuses a FREE user tomorrow with SUBSCRIBER_ONLY', () => {
      expect(codeOf(() => helpers.enforceSubscriptionGate(FREE, '2026-08-14'))).toBe(
        'SUBSCRIBER_ONLY',
      );
    });

    it('allows a subscriber across the full −1 .. +30 day window', () => {
      expect(codeOf(() => helpers.enforceSubscriptionGate(PRO, '2026-08-12'))).toBe('ALLOWED');
      expect(codeOf(() => helpers.enforceSubscriptionGate(PRO, '2026-09-12'))).toBe('ALLOWED');
    });

    it('refuses a subscriber past +30 days with OUT_OF_WINDOW', () => {
      expect(codeOf(() => helpers.enforceSubscriptionGate(PRO, '2026-09-13'))).toBe(
        'OUT_OF_WINDOW',
      );
    });

    it('is wired to DAY scope, not MONTH or YEAR', () => {
      // If this gate were wired to MONTH, +20 days inside the same month would
      // read as diff 0 and be allowed for a FREE user.
      expect(codeOf(() => helpers.enforceSubscriptionGate(FREE, '2026-08-31'))).toBe(
        'SUBSCRIBER_ONLY',
      );
    });
  });

  describe('monthly — enforceMonthlySubscriptionGate', () => {
    it('allows a FREE user the current month', () => {
      expect(codeOf(() => helpers.enforceMonthlySubscriptionGate(FREE, '2026-08'))).toBe(
        'ALLOWED',
      );
    });

    it('refuses a FREE user next month with SUBSCRIBER_ONLY', () => {
      expect(codeOf(() => helpers.enforceMonthlySubscriptionGate(FREE, '2026-09'))).toBe(
        'SUBSCRIBER_ONLY',
      );
    });

    it('allows a subscriber across the full −1 .. +12 month window', () => {
      expect(codeOf(() => helpers.enforceMonthlySubscriptionGate(PRO, '2026-07'))).toBe('ALLOWED');
      expect(codeOf(() => helpers.enforceMonthlySubscriptionGate(PRO, '2027-08'))).toBe('ALLOWED');
    });

    it('refuses a subscriber past +12 months with OUT_OF_WINDOW', () => {
      expect(codeOf(() => helpers.enforceMonthlySubscriptionGate(PRO, '2027-09'))).toBe(
        'OUT_OF_WINDOW',
      );
    });

    it('is wired to MONTH scope — accepts the YYYY-MM form the service passes', () => {
      // Wired to DAY, 'YYYY-MM' fails the DAY shape check and 403s everything.
      expect(codeOf(() => helpers.enforceMonthlySubscriptionGate(PRO, '2026-08'))).toBe(
        'ALLOWED',
      );
    });
  });

  describe('yearly — enforceYearlySubscriptionGate', () => {
    it('allows a FREE user the current year', () => {
      expect(codeOf(() => helpers.enforceYearlySubscriptionGate(FREE, '2026'))).toBe('ALLOWED');
    });

    it('refuses a FREE user the F5 exploit year with SUBSCRIBER_ONLY', () => {
      expect(codeOf(() => helpers.enforceYearlySubscriptionGate(FREE, '2030'))).toBe(
        'SUBSCRIBER_ONLY',
      );
    });

    it('allows a subscriber across the full −1 .. +4 year window', () => {
      expect(codeOf(() => helpers.enforceYearlySubscriptionGate(PRO, '2025'))).toBe('ALLOWED');
      expect(codeOf(() => helpers.enforceYearlySubscriptionGate(PRO, '2030'))).toBe('ALLOWED');
    });

    it('refuses a subscriber past +4 years with OUT_OF_WINDOW', () => {
      expect(codeOf(() => helpers.enforceYearlySubscriptionGate(PRO, '2031'))).toBe(
        'OUT_OF_WINDOW',
      );
    });

    it('is wired to YEAR scope — accepts the bare YYYY form the service passes', () => {
      // Wired to DAY (the audit's M9 mutation), '2026' fails the DAY shape
      // check and EVERY yearly request 403s — a silent outage of a paid feature.
      expect(codeOf(() => helpers.enforceYearlySubscriptionGate(PRO, '2026'))).toBe('ALLOWED');
    });
  });

  describe('the gates are not no-ops', () => {
    it('every gate refuses at least one input', () => {
      // The audit\'s M10: all three bodies replaced with `void tier;` passed the
      // full suite. This is the minimum assertion that catches that.
      expect(() => helpers.enforceSubscriptionGate(FREE, '2026-08-14')).toThrow(
        ForbiddenException,
      );
      expect(() => helpers.enforceMonthlySubscriptionGate(FREE, '2026-09')).toThrow(
        ForbiddenException,
      );
      expect(() => helpers.enforceYearlySubscriptionGate(FREE, '2030')).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('timezone parity with the chat gate', () => {
    it('resolves "now" in FORTUNE_DEFAULT_TZ, not UTC', () => {
      // 2026-08-13T17:00Z is already the 14th in Taipei. A UTC clock would let
      // a FREE user read the 13th (their "yesterday") and refuse the 14th.
      jest.setSystemTime(new Date('2026-08-13T17:00:00Z'));
      expect(codeOf(() => helpers.enforceSubscriptionGate(FREE, '2026-08-14'))).toBe('ALLOWED');
      expect(codeOf(() => helpers.enforceSubscriptionGate(FREE, '2026-08-13'))).toBe(
        'SUBSCRIBER_ONLY',
      );
      jest.setSystemTime(FIXED_NOW);
    });
  });
});
