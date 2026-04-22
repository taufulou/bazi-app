/**
 * Unit tests for CreditsService — covers deductCredits, refundReadingCredit,
 * idempotency, race-safety guards.
 */
import { BadRequestException } from '@nestjs/common';
import { CreditsService } from '../src/credits/credits.service';

describe('CreditsService', () => {
  // Shared mocks rebuilt per test
  let mockTxUser: any;
  let mockTxCreditLedger: any;
  let mockTxBaziReading: any;
  let mockTxBaziComparison: any;
  let mockPrisma: any;
  let service: CreditsService;

  beforeEach(() => {
    mockTxUser = { updateMany: jest.fn(), update: jest.fn() };
    mockTxCreditLedger = { create: jest.fn().mockResolvedValue({}) };
    mockTxBaziReading = { findUnique: jest.fn(), updateMany: jest.fn() };
    mockTxBaziComparison = { findUnique: jest.fn(), updateMany: jest.fn() };

    mockPrisma = {
      user: mockTxUser,
      creditLedger: mockTxCreditLedger,
      baziReading: mockTxBaziReading,
      baziComparison: mockTxBaziComparison,
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
        return cb({
          user: mockTxUser,
          creditLedger: mockTxCreditLedger,
          baziReading: mockTxBaziReading,
          baziComparison: mockTxBaziComparison,
        });
      }),
    };

    service = new CreditsService(mockPrisma);
  });

  // ============================================================
  // deductCredits
  // ============================================================

  describe('deductCredits', () => {
    it('deducts the requested amount and writes negative ledger row', async () => {
      mockTxUser.updateMany.mockResolvedValue({ count: 1 });

      await service.deductCredits('user-1', 3, 'reading-create:CAREER', {
        readingId: 'reading-1',
      });

      expect(mockTxUser.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', credits: { gte: 3 } },
        data: { credits: { decrement: 3 } },
      });
      expect(mockTxCreditLedger.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          amount: -3,
          reason: 'reading-create:CAREER',
          readingId: 'reading-1',
          comparisonId: null,
        },
      });
    });

    it('throws BadRequestException when user has insufficient credits', async () => {
      mockTxUser.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deductCredits('user-1', 5, 'reading-create:LIFETIME'),
      ).rejects.toThrow(BadRequestException);

      expect(mockTxCreditLedger.create).not.toHaveBeenCalled();
    });

    it('rejects non-positive amounts', async () => {
      await expect(service.deductCredits('user-1', 0, 'noop')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deductCredits('user-1', -1, 'noop')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uses caller-provided transaction when given', async () => {
      const callerTxUser = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      const callerTxLedger = { create: jest.fn().mockResolvedValue({}) };
      const callerTx: any = { user: callerTxUser, creditLedger: callerTxLedger };

      await service.deductCredits('user-1', 1, 'test', { tx: callerTx });

      expect(callerTxUser.updateMany).toHaveBeenCalled();
      expect(callerTxLedger.create).toHaveBeenCalled();
      // Outer prisma untouched
      expect(mockTxUser.updateMany).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // refundReadingCredit — idempotency + atomicity
  // ============================================================

  describe('refundReadingCredit', () => {
    it('refunds creditsUsed when reading exists and not yet refunded', async () => {
      mockTxBaziReading.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        creditsUsed: 3,
        refundedAt: null,
      });
      mockTxBaziReading.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refundReadingCredit('r1', 'ai-failed');

      expect(result).toEqual({ refunded: true, amount: 3 });
      expect(mockTxBaziReading.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', refundedAt: null, creditsUsed: { gt: 0 } },
        data: expect.objectContaining({
          refundedAt: expect.any(Date),
          failedReason: 'ai-failed',
        }),
      });
      expect(mockTxUser.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { credits: { increment: 3 } },
      });
      expect(mockTxCreditLedger.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          amount: +3,
          reason: 'refund: ai-failed',
          readingId: 'r1',
        },
      });
    });

    it('is idempotent: returns refunded=false when already refunded', async () => {
      mockTxBaziReading.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        creditsUsed: 3,
        refundedAt: new Date('2026-01-01'),
      });

      const result = await service.refundReadingCredit('r1', 'retry');

      expect(result).toEqual({ refunded: false, amount: 0 });
      expect(mockTxUser.update).not.toHaveBeenCalled();
      expect(mockTxCreditLedger.create).not.toHaveBeenCalled();
    });

    it('skips refund when reading was free (creditsUsed=0)', async () => {
      mockTxBaziReading.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        creditsUsed: 0,
        refundedAt: null,
      });

      const result = await service.refundReadingCredit('r1', 'cache-hit-was-free');

      expect(result).toEqual({ refunded: false, amount: 0 });
      expect(mockTxUser.update).not.toHaveBeenCalled();
    });

    it('returns refunded=false when reading not found', async () => {
      mockTxBaziReading.findUnique.mockResolvedValue(null);

      const result = await service.refundReadingCredit('missing', 'gone');

      expect(result).toEqual({ refunded: false, amount: 0 });
      expect(mockTxUser.update).not.toHaveBeenCalled();
    });

    it('handles race-loss when atomic guard updateMany returns count=0', async () => {
      // Reading appears refundable on findUnique, but another caller refunded between
      // findUnique and updateMany.
      mockTxBaziReading.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        creditsUsed: 3,
        refundedAt: null,
      });
      mockTxBaziReading.updateMany.mockResolvedValue({ count: 0 }); // race lost

      const result = await service.refundReadingCredit('r1', 'race-test');

      expect(result).toEqual({ refunded: false, amount: 0 });
      expect(mockTxUser.update).not.toHaveBeenCalled();
      expect(mockTxCreditLedger.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // refundComparisonCredit — mirror of refundReadingCredit
  // ============================================================

  describe('refundComparisonCredit', () => {
    it('refunds comparison credit + writes ledger', async () => {
      mockTxBaziComparison.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'u1',
        creditsUsed: 5,
        refundedAt: null,
      });
      mockTxBaziComparison.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refundComparisonCredit('c1', 'romance-ai-failed');

      expect(result).toEqual({ refunded: true, amount: 5 });
      expect(mockTxUser.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { credits: { increment: 5 } },
      });
      expect(mockTxCreditLedger.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          amount: +5,
          reason: 'refund: romance-ai-failed',
          comparisonId: 'c1',
        },
      });
    });

    it('idempotent for already-refunded comparisons', async () => {
      mockTxBaziComparison.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'u1',
        creditsUsed: 5,
        refundedAt: new Date(),
      });

      const result = await service.refundComparisonCredit('c1', 'retry');
      expect(result).toEqual({ refunded: false, amount: 0 });
    });
  });

  // ============================================================
  // getBalance
  // ============================================================

  describe('getBalance', () => {
    it('returns credits for existing user', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ credits: 42 });
      expect(await service.getBalance('u1')).toBe(42);
    });

    it('returns 0 for missing user', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      expect(await service.getBalance('ghost')).toBe(0);
    });
  });
});
