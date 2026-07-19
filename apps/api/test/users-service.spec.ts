import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReadingType } from '@prisma/client';
import { UsersService } from '../src/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('UsersService.getReadingHistory — ?type= filter', () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    baziReading: { findMany: jest.Mock; count: jest.Mock };
    baziComparison: { findMany: jest.Mock; count: jest.Mock };
  };

  const userA = { id: 'user-a', clerkUserId: 'clerk_a' };
  const userB = { id: 'user-b', clerkUserId: 'clerk_b' };

  beforeEach(async () => {
    const mockPrisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      baziReading: { findMany: jest.fn(), count: jest.fn() },
      baziComparison: { findMany: jest.fn(), count: jest.fn() },
      birthProfile: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        // M6: UsersService.deleteAccount needs ConfigService (Stripe/Clerk/RC keys).
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get(UsersService);
    prisma = mockPrisma as unknown as typeof prisma;

    prisma.user.findUnique.mockResolvedValue(userA);
  });

  it('throws BadRequestException on unknown type', async () => {
    await expect(
      service.getReadingHistory('clerk_a', 1, 20, 'NOT_A_REAL_TYPE'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('?type=LIFETIME returns only lifetime readings, no comparisons queried', async () => {
    const lifetimeReading = {
      id: 'r1',
      readingType: ReadingType.LIFETIME,
      creditsUsed: 3,
      createdAt: new Date('2026-03-15'),
      targetYear: null,
      birthProfile: { name: 'Roger', birthDate: new Date('1990-05-15') },
    };
    prisma.baziReading.findMany.mockResolvedValue([lifetimeReading]);
    prisma.baziReading.count.mockResolvedValue(1);

    // page=2, limit=20 → skip=20 (non-zero, distinct from limit)
    const result = await service.getReadingHistory('clerk_a', 2, 20, 'LIFETIME');

    expect(prisma.baziComparison.findMany).not.toHaveBeenCalled();
    expect(prisma.baziComparison.count).not.toHaveBeenCalled();
    // findMany must pass userId-scoped where + DB-level pagination + stable sort
    expect(prisma.baziReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', readingType: 'LIFETIME' },
        take: 20,
        skip: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    // count must also be userId-scoped (security: prevents cross-user count leak)
    expect(prisma.baziReading.count).toHaveBeenCalledWith({
      where: { userId: 'user-a', readingType: 'LIFETIME' },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 'r1',
      readingType: ReadingType.LIFETIME,
      isComparison: false,
    });
    expect(result.meta.total).toBe(1);
  });

  it('?type=ANNUAL includes targetYear in select so cards can disambiguate years', async () => {
    prisma.baziReading.findMany.mockResolvedValue([]);
    prisma.baziReading.count.mockResolvedValue(0);

    await service.getReadingHistory('clerk_a', 1, 20, 'ANNUAL');

    const findManyCall = prisma.baziReading.findMany.mock.calls[0][0];
    expect(findManyCall.select).toHaveProperty('targetYear', true);
  });

  it('?type=ZWDS_LIFETIME filters to ZWDS readings only (same pathway as Bazi types)', async () => {
    prisma.baziReading.findMany.mockResolvedValue([]);
    prisma.baziReading.count.mockResolvedValue(0);

    await service.getReadingHistory('clerk_a', 1, 20, 'ZWDS_LIFETIME');

    expect(prisma.baziReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', readingType: 'ZWDS_LIFETIME' },
      }),
    );
    expect(prisma.baziComparison.findMany).not.toHaveBeenCalled();
  });

  it('?type=COMPATIBILITY returns only comparisons with isComparison=true and profileB populated', async () => {
    const comparison = {
      id: 'c1',
      comparisonType: 'ROMANCE',
      creditsUsed: 3,
      createdAt: new Date('2026-02-01'),
      profileA: { name: 'Roger', birthDate: new Date('1990-05-15') },
      profileB: { name: '老婆', birthDate: new Date('1992-03-03') },
    };
    prisma.baziComparison.findMany.mockResolvedValue([comparison]);
    prisma.baziComparison.count.mockResolvedValue(1);

    // page=2, limit=5 → skip=5 (deliberately different values from the LIFETIME case
    // so these assertions can't accidentally pass by coincidence)
    const result = await service.getReadingHistory('clerk_a', 2, 5, 'COMPATIBILITY');

    expect(prisma.baziReading.findMany).not.toHaveBeenCalled();
    expect(prisma.baziReading.count).not.toHaveBeenCalled();
    expect(prisma.baziComparison.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a' },
        take: 5,
        skip: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(prisma.baziComparison.count).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 'c1',
      readingType: 'COMPATIBILITY',
      isComparison: true,
      comparisonType: 'ROMANCE',
      birthProfile: { name: 'Roger' },
      profileB: { name: '老婆' },
    });
  });

  it('no ?type= preserves merged behavior (backward compat for dashboard page)', async () => {
    prisma.baziReading.findMany.mockResolvedValue([
      {
        id: 'r1',
        readingType: ReadingType.LIFETIME,
        creditsUsed: 3,
        createdAt: new Date('2026-03-15'),
        targetYear: null,
        birthProfile: { name: 'Roger', birthDate: new Date('1990-05-15') },
      },
    ]);
    prisma.baziReading.count.mockResolvedValue(1);
    prisma.baziComparison.findMany.mockResolvedValue([
      {
        id: 'c1',
        comparisonType: 'ROMANCE',
        creditsUsed: 3,
        createdAt: new Date('2026-02-01'),
        profileA: { name: 'Roger', birthDate: new Date('1990-05-15') },
        profileB: { name: '老婆', birthDate: new Date('1992-03-03') },
      },
    ]);
    prisma.baziComparison.count.mockResolvedValue(1);

    const result = await service.getReadingHistory('clerk_a', 1, 20);

    expect(prisma.baziReading.findMany).toHaveBeenCalled();
    expect(prisma.baziComparison.findMany).toHaveBeenCalled();
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  it('userId scoping: user B cannot see user A history via ?type=LIFETIME', async () => {
    prisma.user.findUnique.mockResolvedValue(userB);
    prisma.baziReading.findMany.mockResolvedValue([]);
    prisma.baziReading.count.mockResolvedValue(0);

    const result = await service.getReadingHistory('clerk_b', 1, 20, 'LIFETIME');

    expect(prisma.baziReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-b', readingType: 'LIFETIME' },
      }),
    );
    expect(result.data).toEqual([]);
  });

  it('userId scoping: user B cannot see user A comparisons via ?type=COMPATIBILITY', async () => {
    prisma.user.findUnique.mockResolvedValue(userB);
    prisma.baziComparison.findMany.mockResolvedValue([]);
    prisma.baziComparison.count.mockResolvedValue(0);

    const result = await service.getReadingHistory('clerk_b', 1, 20, 'COMPATIBILITY');

    expect(prisma.baziComparison.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-b' },
      }),
    );
    expect(result.data).toEqual([]);
  });
});
