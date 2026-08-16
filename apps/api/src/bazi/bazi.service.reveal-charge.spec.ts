import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaziService } from './bazi.service';

/**
 * Bundle A regression lock — the 合盤 charge moved from CREATE to REVEAL.
 *
 * Model: creating a comparison is free (it shows two 排盤 charts and nothing
 * else); the 3 credits are taken once, at reveal, via a compare-and-set on
 * `paidAt`.
 *
 * ⚠️ `paidAt` — NOT `creditsUsed` — is the paid predicate everywhere. A refunded
 * comparison keeps its `creditsUsed` (`refundComparisonCredit` guards on
 * `creditsUsed > 0`), so a creditsUsed-based gate treats a fully refunded user
 * as already paid.
 */
describe('BaziService — 合盤 charge at reveal', () => {
  const USER_ID = 'user-1';
  const COST = 3;

  let deductCredits: jest.Mock;
  let refundComparisonCredit: jest.Mock;
  let updateMany: jest.Mock;
  let claimResult: { count: number };

  function build(comparison: Record<string, unknown> | null, userCredits = 100) {
    deductCredits = jest.fn().mockResolvedValue(undefined);
    refundComparisonCredit = jest.fn().mockResolvedValue({ refunded: true, amount: COST });
    claimResult = { count: 1 };
    updateMany = jest.fn(async () => claimResult);

    const tx = { baziComparison: { updateMany } };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: USER_ID, credits: userCredits }),
      },
      service: { findFirst: jest.fn().mockResolvedValue({ creditCost: COST }) },
      baziComparison: { findFirst: jest.fn().mockResolvedValue(comparison) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const svc = new BaziService(
      prisma as never,
      {} as never,
      { get: () => 'http://engine.test' } as unknown as ConfigService,
      {} as never,
      { deductCredits, refundComparisonCredit } as never,
      { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never,
    );
    return svc;
  }

  const romanceRow = (over: Record<string, unknown> = {}) => ({
    id: 'cmp-1',
    userId: USER_ID,
    comparisonType: 'ROMANCE',
    calculationData: { romancePreAnalysis: {} },
    aiInterpretation: null,
    paidAt: null,
    creditsUsed: 0,
    ...over,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charge = (svc: BaziService, row: any) => (svc as any)._chargeForReveal(USER_ID, row);

  describe('_chargeForReveal — compare-and-set', () => {
    it('charges once on an unpaid comparison', async () => {
      const svc = build(romanceRow());
      const didCharge = await charge(svc, romanceRow());

      expect(didCharge).toBe(true);
      expect(deductCredits).toHaveBeenCalledWith(
        USER_ID, COST, 'comparison-reveal:ROMANCE',
        expect.objectContaining({ comparisonId: 'cmp-1' }),
      );
      // the claim is a CAS: it only matches while paidAt is still null
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ paidAt: null }) }),
      );
    });

    it('is a no-op on an already-unlocked comparison (free re-reveal)', async () => {
      const svc = build(romanceRow({ paidAt: new Date() }));
      const didCharge = await charge(svc, romanceRow({ paidAt: new Date() }));

      expect(didCharge).toBe(false);
      expect(deductCredits).not.toHaveBeenCalled();
    });

    it('does not double-charge when a concurrent reveal wins the CAS', async () => {
      const svc = build(romanceRow());
      claimResult = { count: 0 }; // the other request claimed it first

      const didCharge = await charge(svc, romanceRow());

      expect(didCharge).toBe(false);
      expect(deductCredits).not.toHaveBeenCalled();
    });

    it('RE-CHARGES a refunded comparison — creditsUsed is NOT the predicate', async () => {
      // The refund left creditsUsed at 3 and cleared paidAt. A creditsUsed-based
      // gate would read this as "already paid" and hand over the report free.
      const refunded = romanceRow({ paidAt: null, creditsUsed: COST, refundedAt: new Date() });
      const svc = build(refunded);

      const didCharge = await charge(svc, refunded);

      expect(didCharge).toBe(true);
      expect(deductCredits).toHaveBeenCalledTimes(1);
      // and the CAS resets the refund state so a later failure is refundable again
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ refundedAt: null, failedReason: null }),
        }),
      );
    });

    it('throws INSUFFICIENT_CREDITS before touching the row', async () => {
      const svc = build(romanceRow(), /* userCredits */ 1);

      await expect(charge(svc, romanceRow())).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMany).not.toHaveBeenCalled();
      expect(deductCredits).not.toHaveBeenCalled();
    });
  });

  describe('reveal-stream refund — A4.1 (R1-#19b lock)', () => {
    /**
     * ⚠️ The refund CANNOT hang off the observable's `error` channel.
     * `streamCompatibilityRomanceV2` never calls `subscriber.error()` (zero such
     * calls in ai.service.ts); it catches everything and emits a `next()` event
     * of type 'error', then `complete()`s in a `finally`. A refund wired to
     * `error:` is dead code and the user is charged for nothing.
     *
     * These tests drive the REAL shape: error-event-then-complete.
     */
    const { Observable } = require('rxjs');

    function buildStreamService(events: Array<{ type: string }>) {
      refundComparisonCredit = jest.fn().mockResolvedValue({ refunded: true, amount: COST });
      deductCredits = jest.fn().mockResolvedValue(undefined);
      claimResult = { count: 1 };
      updateMany = jest.fn(async () => claimResult);

      const row = {
        id: 'cmp-1', userId: USER_ID, comparisonType: 'ROMANCE',
        calculationData: { romancePreAnalysis: {} },
        aiInterpretation: null, paidAt: null, creditsUsed: 0,
      };
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, credits: 100 }) },
        service: { findFirst: jest.fn().mockResolvedValue({ creditCost: COST }) },
        baziComparison: { findFirst: jest.fn().mockResolvedValue(row) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $transaction: jest.fn(async (cb: any) => cb({ baziComparison: { updateMany } })),
      };
      const redis = {
        incrementRateLimit: jest.fn().mockResolvedValue(1),
        getClient: () => ({ decr: jest.fn().mockResolvedValue(1) }),
      };
      const ai = {
        // emit the given events, then complete — exactly what the real one does
        streamCompatibilityRomanceV2: jest.fn(
          () =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            new Observable((sub: any) => {
              events.forEach((e) => sub.next(e));
              sub.complete();
            }),
        ),
      };
      return new BaziService(
        prisma as never, redis as never,
        { get: () => 'http://engine.test' } as unknown as ConfigService,
        ai as never,
        { deductCredits, refundComparisonCredit } as never,
        { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never,
      );
    }

    const drain = (svc: BaziService) =>
      new Promise<void>((resolve) => {
        svc.streamComparisonAI('clerk-1', 'cmp-1').subscribe({ complete: () => resolve() });
      });

    it('REFUNDS when the stream errors having produced nothing', async () => {
      const svc = buildStreamService([{ type: 'error' }]);

      await drain(svc);
      await new Promise((r) => setTimeout(r, 0)); // let the refund promise settle

      expect(deductCredits).toHaveBeenCalledTimes(1);
      expect(refundComparisonCredit).toHaveBeenCalledWith('cmp-1', 'reveal-stream-failed');
    });

    it('does NOT refund a successful stream', async () => {
      const svc = buildStreamService([{ type: 'section_complete' }, { type: 'done' }]);

      await drain(svc);
      await new Promise((r) => setTimeout(r, 0));

      expect(deductCredits).toHaveBeenCalledTimes(1);
      expect(refundComparisonCredit).not.toHaveBeenCalled();
    });

    it('REFUNDS despite HEARTBEATS — they are not output', async () => {
      // ⚠️ The regression that made the first fix dead on arrival. The compat
      // stream emits {type:'heartbeat'} every 15s starting BEFORE the first
      // provider attempt (its `heartbeatInterval` in `ai.service.ts`), and every
      // REAL failure is slower
      // than 15s (300s timeout, sequential provider fallback). A classifier that
      // counts "anything not error/done/summary" as output therefore treats
      // every real failure as partial and never refunds.
      const svc = buildStreamService([
        { type: 'heartbeat' },
        { type: 'heartbeat' },
        { type: 'error' },
      ]);

      await drain(svc);
      await new Promise((r) => setTimeout(r, 0));

      expect(refundComparisonCredit).toHaveBeenCalledWith('cmp-1', 'reveal-stream-failed');
    });

    it('does NOT refund a PARTIAL stream — the user keeps those sections', async () => {
      // The client renders 「部分分析已完成」 and a retry is free via the CAS.
      const svc = buildStreamService([{ type: 'section_complete' }, { type: 'error' }]);

      await drain(svc);
      await new Promise((r) => setTimeout(r, 0));

      expect(refundComparisonCredit).not.toHaveBeenCalled();
    });
  });

  describe('recalculateComparison — must not charge for a refresh that failed', () => {
    // The AI runs BEFORE the transaction, so a failure simply skips the charge.
    // Refunding instead would have been wrong in four ways — chiefly that
    // `refundComparisonCredit` is not parameterised by amount and would return
    // the 3-credit REVEAL charge for a 1-credit refresh, a mintable loop.
    function buildRecalc(aiThrows: boolean) {
      deductCredits = jest.fn().mockResolvedValue(undefined);
      const row = {
        id: 'cmp-1', userId: USER_ID, comparisonType: 'ROMANCE',
        calculationData: { romancePreAnalysis: {}, chartA: {}, chartB: {} },
        aiInterpretation: { sections: {} }, paidAt: new Date(), creditsUsed: COST,
        lastCalculatedYear: 2020,
        profileA: { gender: 'MALE', birthDate: new Date('1987-09-06'), birthTime: '16:11', birthCity: '吉打' },
        profileB: { gender: 'FEMALE', birthDate: new Date('1987-01-25'), birthTime: '12:00', birthCity: '台北' },
      };
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, credits: 100 }) },
        baziComparison: {
          findFirst: jest.fn().mockResolvedValue(row),
          update: jest.fn().mockResolvedValue(row),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $transaction: jest.fn(async (cb: any) => cb({ baziComparison: { update: jest.fn().mockResolvedValue(row) } })),
      };
      const ai = {
        generateCompatibilityRomanceV2: aiThrows
          ? jest.fn().mockRejectedValue(new Error('all providers failed'))
          : jest.fn().mockResolvedValue({ interpretation: {}, provider: 'CLAUDE', model: 'm', tokenUsage: {} }),
        generateInterpretation: jest.fn(),
      };
      const svc = new BaziService(
        prisma as never, {} as never,
        { get: () => 'http://engine.test' } as unknown as ConfigService,
        ai as never, { deductCredits } as never,
        { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never,
      );
      jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(svc as any, 'callBaziCompatibility')
        .mockResolvedValue({ romancePreAnalysis: {}, chartA: {}, chartB: {} });
      return svc;
    }

    it('does NOT charge when the AI generation fails', async () => {
      const svc = buildRecalc(true);
      await expect(svc.recalculateComparison('clerk-1', 'cmp-1')).rejects.toThrow();
      expect(deductCredits).not.toHaveBeenCalled();
    });

    it('charges on success', async () => {
      const svc = buildRecalc(false);
      await svc.recalculateComparison('clerk-1', 'cmp-1');
      expect(deductCredits).toHaveBeenCalledWith(
        USER_ID, 1, 'comparison-recalculate', expect.objectContaining({ comparisonId: 'cmp-1' }),
      );
    });

    it('REJECTS an unpaid comparison — a 1-credit refresh must not buy a 3-credit report', async () => {
      const svc = buildRecalc(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prisma = (svc as any).prisma;
      prisma.baziComparison.findFirst.mockResolvedValue({
        id: 'cmp-1', userId: USER_ID, comparisonType: 'ROMANCE',
        calculationData: { romancePreAnalysis: {} },
        paidAt: null, lastCalculatedYear: 2020,
        profileA: {}, profileB: {},
      });

      await expect(svc.recalculateComparison('clerk-1', 'cmp-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(deductCredits).not.toHaveBeenCalled();
    });
  });

  describe('_assertRomanceV2 — cross-system guard', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assertV2 = (svc: BaziService, row: any) => () => (svc as any)._assertRomanceV2(row);

    it('accepts a Romance V2 comparison', () => {
      const svc = build(null);
      expect(assertV2(svc, romanceRow())).not.toThrow();
    });

    it('REJECTS a ZWDS-shaped row (shared table)', () => {
      // BaziComparison is shared with ZWDS compatibility. A ZWDS row carries
      // paidAt (charged at create) but no romancePreAnalysis — without this
      // guard the Bazi reveal path would charge Bazi credits and overwrite a
      // paid ZWDS report with Bazi romance content.
      const svc = build(null);
      const zwdsRow = {
        comparisonType: 'ROMANCE',
        calculationData: { palaces: [], stars: [] },
      };
      expect(assertV2(svc, zwdsRow)).toThrow(BadRequestException);
    });

    it('REJECTS a legacy Bazi V1 row (no romancePreAnalysis)', () => {
      const svc = build(null);
      const v1Row = {
        comparisonType: 'ROMANCE',
        calculationData: { chartA: {}, chartB: {}, compatibility: {} },
      };
      expect(assertV2(svc, v1Row)).toThrow(BadRequestException);
    });

    it('REJECTS a non-ROMANCE comparison type', () => {
      const svc = build(null);
      expect(
        assertV2(svc, { comparisonType: 'BUSINESS', calculationData: { romancePreAnalysis: {} } }),
      ).toThrow(BadRequestException);
    });

    it('tolerates a null calculationData without crashing', () => {
      const svc = build(null);
      expect(assertV2(svc, { comparisonType: 'ROMANCE', calculationData: null })).toThrow(
        BadRequestException,
      );
    });
  });
});
