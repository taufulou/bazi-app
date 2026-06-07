/**
 * Tier C — `resolveOwnedCrossSellTargets` regression specs.
 *
 * Locks the staff-reviewed contract:
 * - FORTUNE/LOVE/CAREER/ANNUAL: maps owned BaziReading rows → cross-sell target keys.
 * - ANNUAL is YEAR-SCOPED (MEDIUM-1): a 2024 annual reading does NOT count as
 *   owning THIS year's annual when anchorYear=2026.
 * - COMPATIBILITY → empty set (v1.1 deferral; no Prisma calls).
 * - Missing birthProfileId → empty set (defensive; no Prisma calls).
 *
 * Pure unit test — Prisma mocked; Redis/Config stubbed.
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ChatContextService } from './chat-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('ChatContextService — resolveOwnedCrossSellTargets (Tier C)', () => {
  let service: ChatContextService;
  let findMany: jest.Mock;
  let findFirst: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();
    findFirst = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatContextService,
        { provide: ConfigService, useValue: { get: () => 'http://localhost:5001' } },
        {
          provide: PrismaService,
          useValue: { baziReading: { findMany, findFirst } } as unknown as PrismaService,
        },
        { provide: RedisService, useValue: {} as RedisService },
      ],
    }).compile();
    service = moduleRef.get(ChatContextService);
  });

  it('FORTUNE owning LIFETIME (not this-year ANNUAL) → {lifetime}', async () => {
    findMany.mockResolvedValue([{ readingType: 'LIFETIME' }]);
    findFirst.mockResolvedValue(null);
    const owned = await service.resolveOwnedCrossSellTargets({
      userId: 'u1',
      readingType: 'FORTUNE',
      birthProfileId: 'p1',
      anchorYear: 2026,
    });
    expect([...owned].sort()).toEqual(['lifetime']);
  });

  it('owning nothing → empty set', async () => {
    findMany.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);
    const owned = await service.resolveOwnedCrossSellTargets({
      userId: 'u1',
      readingType: 'FORTUNE',
      birthProfileId: 'p1',
      anchorYear: 2026,
    });
    expect(owned.size).toBe(0);
  });

  it('owning LIFETIME+LOVE+CAREER + this-year ANNUAL → all 4 targets', async () => {
    findMany.mockResolvedValue([
      { readingType: 'LIFETIME' },
      { readingType: 'LOVE' },
      { readingType: 'CAREER' },
    ]);
    findFirst.mockResolvedValue({ id: 'a-2026' });
    const owned = await service.resolveOwnedCrossSellTargets({
      userId: 'u1',
      readingType: 'FORTUNE',
      birthProfileId: 'p1',
      anchorYear: 2026,
    });
    expect([...owned].sort()).toEqual(['annual', 'career', 'lifetime', 'love']);
  });

  it('MEDIUM-1 — ANNUAL is year-scoped: owns 2024 annual but anchorYear=2026 → no "annual"', async () => {
    findMany.mockResolvedValue([]);
    // Simulate findFirst respecting the where.targetYear filter: returns a row
    // only when queried for 2024; null for 2026.
    findFirst.mockImplementation(({ where }: { where: { targetYear: number } }) =>
      Promise.resolve(where.targetYear === 2024 ? { id: 'a-2024' } : null),
    );
    const owned2026 = await service.resolveOwnedCrossSellTargets({
      userId: 'u1',
      readingType: 'FORTUNE',
      birthProfileId: 'p1',
      anchorYear: 2026,
    });
    expect(owned2026.has('annual')).toBe(false);

    const owned2024 = await service.resolveOwnedCrossSellTargets({
      userId: 'u1',
      readingType: 'FORTUNE',
      birthProfileId: 'p1',
      anchorYear: 2024,
    });
    expect(owned2024.has('annual')).toBe(true);
  });

  it('COMPATIBILITY → empty set, NO Prisma calls (v1.1 deferral)', async () => {
    const owned = await service.resolveOwnedCrossSellTargets({
      userId: 'u1',
      readingType: 'COMPATIBILITY',
      birthProfileId: 'p1',
      anchorYear: 2026,
    });
    expect(owned.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('missing birthProfileId → empty set, NO Prisma calls (defensive)', async () => {
    const owned = await service.resolveOwnedCrossSellTargets({
      userId: 'u1',
      readingType: 'FORTUNE',
      birthProfileId: null,
      anchorYear: 2026,
    });
    expect(owned.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('the year-agnostic query filters to LIFETIME/LOVE/CAREER (never ANNUAL via distinct)', async () => {
    findMany.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);
    await service.resolveOwnedCrossSellTargets({
      userId: 'u1',
      readingType: 'LOVE',
      birthProfileId: 'p1',
      anchorYear: 2026,
    });
    const call = findMany.mock.calls[0][0];
    expect(call.where.readingType.in).toEqual(['LIFETIME', 'LOVE', 'CAREER']);
    expect(call.distinct).toEqual(['readingType']);
    // ANNUAL is queried separately, year-scoped.
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      readingType: 'ANNUAL',
      targetYear: 2026,
    });
  });
});
