/**
 * Unit tests for BaziService.regenerateReading (Step 10 of ai-retry-and-credit-refund plan).
 * - blocks if reading not degraded
 * - blocks if regeneration limit reached
 * - increments count + clears degraded flags + nulls aiInterpretation
 * - guards against TOCTOU race via atomic updateMany
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaziService } from '../src/bazi/bazi.service';
import { STREAMABLE_READING_TYPES } from '../src/bazi/dto/create-reading.dto';
import { ShutdownService } from '../src/common/shutdown.service';

describe('BaziService.regenerateReading', () => {
  let mockPrisma: any;
  let service: BaziService;

  const userId = 'user-1';
  const clerkUserId = 'clerk-1';
  const readingId = 'reading-1';

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: jest.fn() },
      baziReading: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const mockRedis: any = {};
    const mockConfig: any = { get: jest.fn().mockReturnValue('http://localhost:5001') };
    const mockAI: any = {};
    const mockCredits: any = {};
    const mockQuota = { consume: jest.fn(), peek: jest.fn() } as never;
    // S2 — the cap pre-check that now runs before every quota consume.
    const mockSpend = { assertUnderCap: jest.fn(), record: jest.fn(), recordFailure: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) } as never;
    service = new BaziService(
      mockPrisma, mockRedis, mockConfig, mockAI, mockCredits, mockQuota, mockSpend,
      new ShutdownService(),
    );
  });

  it('throws NotFoundException when user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when reading does not belong to user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    // Atomic update misses (no row matched)
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 0 });
    // Disambiguation findFirst also returns null → user has no such reading
    mockPrisma.baziReading.findFirst.mockResolvedValue(null);
    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when reading is not degraded', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
      // todo #3: a real row always has a type; the allowlist check fails CLOSED on an untyped one
      readingType: 'LIFETIME',
      refundedAt: null,
      isDegraded: false,
      regenerationExhausted: false,
      regenerationCount: 0,
    });
    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(
      /無需重新生成/,
    );
  });

  it('throws BadRequestException when regenerationExhausted=true', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
      // todo #3: a real row always has a type; the allowlist check fails CLOSED on an untyped one
      readingType: 'LIFETIME',
      refundedAt: null,
      isDegraded: true,
      regenerationExhausted: true,
      regenerationCount: 3,
    });
    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(
      /已達.*上限/,
    );
  });

  it('throws + sets exhausted=true when regenerationCount has hit the limit', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
      // todo #3: a real row always has a type; the allowlist check fails CLOSED on an untyped one
      readingType: 'LIFETIME',
      refundedAt: null,
      isDegraded: true,
      regenerationExhausted: false,
      regenerationCount: 3, // already at limit
    });
    mockPrisma.baziReading.update.mockResolvedValue({});

    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(
      /已達.*上限/,
    );

    expect(mockPrisma.baziReading.update).toHaveBeenCalledWith({
      where: { id: readingId },
      data: { regenerationExhausted: true },
    });
  });

  it('increments count + nulls aiInterpretation when valid', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    // Atomic update succeeds
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.baziReading.findUnique.mockResolvedValue({
      id: readingId,
      regenerationCount: 2,
    });

    const result = await service.regenerateReading(clerkUserId, readingId);

    // CRITICAL: must use Prisma.DbNull (not undefined, not JsonNull) to set SQL NULL
    // Atomic updateMany with the full where clause prevents the TOCTOU race.
    expect(mockPrisma.baziReading.updateMany).toHaveBeenCalledWith({
      where: {
        id: readingId,
        userId,
        isDegraded: true,
        regenerationExhausted: false,
        regenerationCount: { lt: 3 },
        // todo #3 — regeneration is "null the content, then re-stream", so a
        // row the stream would REFUSE must be excluded HERE, before its content
        // is destroyed. `refundedAt: null` enforces what the comment in the
        // service only assumed.
        readingType: { in: [...STREAMABLE_READING_TYPES] },
        refundedAt: null,
      },
      data: {
        regenerationCount: { increment: 1 },
        isDegraded: false,
        failedReason: null,
        aiInterpretation: Prisma.DbNull,
        aiProvider: null,
        aiModel: null,
        // Deliberately absent: `refundedAt` and `creditsUsed`. `isDegraded: true`
        // in the WHERE already implies the row was never refunded (one exclusive
        // status per attempt — see the note in `regenerateReading`), so clearing
        // the timestamp is a no-op and zeroing the charge would erase a real
        // payment and block the refund if the retry also failed.
      },
    });

    expect(result).toEqual({
      readingId,
      regenerationCount: 2,
      regenerationsRemaining: 1,
    });
  });

  describe('todo #3 — a row with no streamer is refused BEFORE its content is touched', () => {
    // A pre-fix degraded HEALTH row (narrated by `streamLifetimeV2` before the
    // 2b allowlist existed, so `isDegraded: true` is possible on it) used to be
    // nulled by the updateMany, then refused at the stream with no refund, then
    // told 「狀態正常」 on a second regenerate: paid-empty, forever.
    it('refuses a degraded HEALTH row with READING_TYPE_NOT_STREAMABLE, ahead of the degraded/exhausted answers', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
      mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 0 }); // WHERE excludes it
      mockPrisma.baziReading.findFirst.mockResolvedValue({
        id: readingId, readingType: 'HEALTH', isDegraded: true, refundedAt: null,
        regenerationExhausted: false, regenerationCount: 0,
      });
      await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'READING_TYPE_NOT_STREAMABLE' }),
      });
      // The WHERE is what protects the content; pin the conjunct, not just the throw.
      expect(mockPrisma.baziReading.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ readingType: { in: [...STREAMABLE_READING_TYPES] } }) }),
      );
      expect(mockPrisma.baziReading.update).not.toHaveBeenCalled();
    });

    it('answers with the TYPE refusal even for a NON-degraded HEALTH row — the type check comes first', async () => {
      // Pins the ORDER: below `!reading.isDegraded` this row would get
      // 「此分析狀態正常」, a message about a regeneration that can never happen.
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
      mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.baziReading.findFirst.mockResolvedValue({
        id: readingId, readingType: 'HEALTH', isDegraded: false, refundedAt: null,
        regenerationExhausted: false, regenerationCount: 0,
      });
      await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'READING_TYPE_NOT_STREAMABLE' }),
      });
    });

    it('refuses a REFUNDED row with READING_REFUNDED — the money is back, there is nothing to regenerate', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
      mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.baziReading.findFirst.mockResolvedValue({
        id: readingId, readingType: 'LIFETIME', isDegraded: true, refundedAt: new Date('2026-09-02'),
        regenerationExhausted: false, regenerationCount: 0,
      });
      await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'READING_REFUNDED' }),
      });
      expect(mockPrisma.baziReading.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ refundedAt: null }) }),
      );
    });
  });

  it('returns 0 regenerationsRemaining at the limit boundary', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.baziReading.findUnique.mockResolvedValue({
      id: readingId,
      regenerationCount: 3, // hit the limit
    });

    const result = await service.regenerateReading(clerkUserId, readingId);
    expect(result.regenerationsRemaining).toBe(0);
  });

  it('throws catch-all when updateMany misses but findFirst shows a non-categorized state', async () => {
    // Race: updateMany missed but by the time findFirst ran, the row was
    // flipped back to degraded by some concurrent process. None of the named
    // error branches apply.
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
      // todo #3: a real row always has a type; the allowlist check fails CLOSED on an untyped one
      readingType: 'LIFETIME',
      refundedAt: null,
      isDegraded: true,
      regenerationExhausted: false,
      regenerationCount: 1, // below limit, but updateMany still missed
    });
    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(
      /無法重新生成/,
    );
  });

  it('throws NotFoundException after successful update if findUnique returns null', async () => {
    // Defensive null guard — row deleted between updateMany and findUnique
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.baziReading.findUnique.mockResolvedValue(null);
    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(NotFoundException);
  });
});
