/**
 * #22 — a REFUNDED row must not keep claiming the user paid.
 *
 * `refundReadingCredit` deliberately leaves `creditsUsed` at 3: that column is
 * both the refund amount and the double-refund guard (`creditsUsed > 0`). The
 * history page's only predicate was `creditsUsed === 0` → 免費, else
 * `-{creditsUsed} 額度`, so a refunded reading rendered `-3 額度` on what the
 * codebase itself calls "effectively a receipt". Refunds already happen today
 * via the AI-failure path, so this was live, not hypothetical.
 *
 * ⚠️ Two distinct failure modes are covered, because `getReadingHistory` has
 * THREE branches and the comparison ones RE-MAP field by field — adding
 * `refundedAt` to a `select` is not enough there. The same trap already has a
 * warning comment in the source about `paidAt`, and nothing tested it.
 */
import { UsersService } from '../src/users/users.service';
import { ReadingType } from '@prisma/client';

describe('getReadingHistory — refundedAt reaches the client', () => {
  const READING = {
    id: 'r1', readingType: ReadingType.LIFETIME, creditsUsed: 3,
    createdAt: new Date('2026-09-02'), targetYear: null,
    refundedAt: new Date('2026-09-02'),
    birthProfile: { name: 'Roger', birthDate: new Date('1987-09-06') },
  };
  const COMPARISON = {
    id: 'c1', comparisonType: 'ROMANCE', creditsUsed: 3,
    paidAt: new Date('2026-08-25'), refundedAt: new Date('2026-08-26'),
    createdAt: new Date('2026-08-25'),
    profileA: { name: 'Roger', birthDate: new Date('1987-09-06') },
    profileB: { name: 'Laopo', birthDate: new Date('1987-01-25') },
  };

  function build() {
    const readingFindMany = jest.fn().mockResolvedValue([READING]);
    const comparisonFindMany = jest.fn().mockResolvedValue([COMPARISON]);
    const svc = Object.create(UsersService.prototype) as UsersService;
    Object.assign(svc, {
      prisma: {
        baziReading: { findMany: readingFindMany, count: jest.fn().mockResolvedValue(1) },
        baziComparison: { findMany: comparisonFindMany, count: jest.fn().mockResolvedValue(1) },
      },
      ensureUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
    });
    return { svc, readingFindMany, comparisonFindMany };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectOf = (fn: jest.Mock) => (fn.mock.calls[0][0] as any).select;

  describe('type-filtered readings branch', () => {
    it('SELECTS refundedAt', async () => {
      const { svc, readingFindMany } = build();
      await svc.getReadingHistory('clerk_1', 1, 20, ReadingType.LIFETIME);
      expect(selectOf(readingFindMany).refundedAt).toBe(true);
    });

    it('returns it (this branch spreads, so the select is sufficient)', async () => {
      const { svc } = build();
      const res = await svc.getReadingHistory('clerk_1', 1, 20, ReadingType.LIFETIME);
      expect(res.data[0]).toMatchObject({ refundedAt: READING.refundedAt, creditsUsed: 3 });
    });
  });

  describe('type-filtered comparisons branch', () => {
    it('SELECTS refundedAt', async () => {
      const { svc, comparisonFindMany } = build();
      await svc.getReadingHistory('clerk_1', 1, 20, ReadingType.COMPATIBILITY);
      expect(selectOf(comparisonFindMany).refundedAt).toBe(true);
    });

    it('RE-MAPS it — the select alone is not enough on this branch', async () => {
      // The exact trap the source warns about for `paidAt`: this branch builds
      // its output object field by field, so a selected-but-unmapped column
      // arrives as undefined and the badge silently never renders.
      const { svc } = build();
      const res = await svc.getReadingHistory('clerk_1', 1, 20, ReadingType.COMPATIBILITY);
      expect(res.data[0]).toMatchObject({
        refundedAt: COMPARISON.refundedAt,
        paidAt: COMPARISON.paidAt,
        isComparison: true,
      });
    });
  });

  describe('merged branch (no ?type= — what /dashboard/readings actually calls)', () => {
    it('SELECTS refundedAt on BOTH tables', async () => {
      const { svc, readingFindMany, comparisonFindMany } = build();
      await svc.getReadingHistory('clerk_1', 1, 20);
      expect(selectOf(readingFindMany).refundedAt).toBe(true);
      expect(selectOf(comparisonFindMany).refundedAt).toBe(true);
    });

    it('returns it for readings AND for the re-mapped comparisons', async () => {
      const { svc } = build();
      const res = await svc.getReadingHistory('clerk_1', 1, 20);
      const reading = res.data.find((d) => !d.isComparison);
      const comparison = res.data.find((d) => d.isComparison);
      expect(reading).toMatchObject({ refundedAt: READING.refundedAt });
      expect(comparison).toMatchObject({ refundedAt: COMPARISON.refundedAt, paidAt: COMPARISON.paidAt });
    });
  });

  it('does NOT zero creditsUsed — that column is the refund amount and the double-refund guard', async () => {
    // Zeroing it would render 免費 (worse: a lie in the other direction) and
    // would break `refundReadingCredit`'s `creditsUsed > 0` guard, silently
    // making a second refund impossible to detect.
    const { svc } = build();
    const res = await svc.getReadingHistory('clerk_1', 1, 20);
    expect(res.data.find((d) => !d.isComparison)).toMatchObject({ creditsUsed: 3 });
  });
});
