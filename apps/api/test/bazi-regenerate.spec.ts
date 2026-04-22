/**
 * Unit tests for BaziService.regenerateReading (Step 10 of ai-retry-and-credit-refund plan).
 * - blocks if reading not degraded
 * - blocks if regeneration limit reached
 * - increments count + clears degraded flags + nulls aiInterpretation
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaziService } from '../src/bazi/bazi.service';

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
        update: jest.fn(),
      },
    };
    const mockRedis: any = {};
    const mockConfig: any = { get: jest.fn().mockReturnValue('http://localhost:5001') };
    const mockAI: any = {};
    const mockCredits: any = {};
    service = new BaziService(mockPrisma, mockRedis, mockConfig, mockAI, mockCredits);
  });

  it('throws NotFoundException when user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when reading does not belong to user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.findFirst.mockResolvedValue(null);
    await expect(service.regenerateReading(clerkUserId, readingId)).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when reading is not degraded', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
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
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
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
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
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
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
      isDegraded: true,
      regenerationExhausted: false,
      regenerationCount: 1,
    });
    mockPrisma.baziReading.update.mockResolvedValue({
      id: readingId,
      regenerationCount: 2,
    });

    const result = await service.regenerateReading(clerkUserId, readingId);

    // CRITICAL: must use Prisma.DbNull (not undefined, not JsonNull) to set SQL NULL
    expect(mockPrisma.baziReading.update).toHaveBeenCalledWith({
      where: { id: readingId },
      data: {
        regenerationCount: { increment: 1 },
        isDegraded: false,
        failedReason: null,
        aiInterpretation: Prisma.DbNull,
        aiProvider: null,
        aiModel: null,
      },
    });

    expect(result).toEqual({
      readingId,
      regenerationCount: 2,
      regenerationsRemaining: 1,
    });
  });

  it('returns 0 regenerationsRemaining at the limit boundary', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
    mockPrisma.baziReading.findFirst.mockResolvedValue({
      id: readingId,
      isDegraded: true,
      regenerationExhausted: false,
      regenerationCount: 2, // 1 below limit
    });
    mockPrisma.baziReading.update.mockResolvedValue({
      id: readingId,
      regenerationCount: 3, // hit the limit
    });

    const result = await service.regenerateReading(clerkUserId, readingId);
    expect(result.regenerationsRemaining).toBe(0);
  });
});
