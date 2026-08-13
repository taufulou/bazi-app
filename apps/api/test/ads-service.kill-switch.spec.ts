/**
 * A8 (Phase 1A) — rewarded-ad kill switch.
 *
 * `/api/ads/claim` performs NO ad-completion verification (V1 "trust the client"
 * design). With rewards enabled, any authenticated caller can POST the endpoint
 * and mint `CREDITS_PER_AD_VIEW` credits — credits that buy readings costing real
 * Anthropic spend. The per-account daily counter bounds it at 5/day, but Clerk
 * signup is free, so it is unbounded across accounts.
 *
 * These tests lock the gate closed by default and lock the ORDER of the check:
 * the kill switch must fire before the Redis daily counter is touched, or a
 * disabled deployment still burns quota on calls that can never succeed.
 */
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AdsService } from '../src/ads/ads.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { RedisService } from '../src/redis/redis.service';

const CLERK_USER = 'user_clerk_abc';

function makeService(adsRewardsEnabled: string | undefined) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'db-uuid-1', credits: 0 }) },
    adRewardLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        user: { update: jest.fn().mockResolvedValue({}) },
        adRewardLog: { create: jest.fn().mockResolvedValue({}) },
      }),
    ),
  };
  const redis = {
    incrementRateLimit: jest.fn().mockResolvedValue(1),
    getClient: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'ADS_REWARDS_ENABLED' ? adsRewardsEnabled : undefined,
    ),
  };
  const service = new AdsService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    config as unknown as ConfigService,
  );
  return { service, prisma, redis, config };
}

describe('AdsService — ADS_REWARDS_ENABLED kill switch (A8)', () => {
  describe('disabled (the default)', () => {
    it.each([
      ['unset (production default)', undefined],
      ["explicitly '0'", '0'],
    ])('rejects a CREDIT claim when the flag is %s', async (_label, flag) => {
      const { service } = makeService(flag as string | undefined);

      await expect(
        service.claimReward(CLERK_USER, 'CREDIT'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects with the ADS_REWARDS_DISABLED code so clients can branch on it', async () => {
      const { service } = makeService('0');

      await expect(service.claimReward(CLERK_USER, 'CREDIT')).rejects.toMatchObject({
        response: { code: 'ADS_REWARDS_DISABLED' },
      });
    });

    it('grants NO credits and writes NO reward log', async () => {
      const { service, prisma } = makeService('0');

      await expect(service.claimReward(CLERK_USER, 'CREDIT')).rejects.toThrow();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.adRewardLog.create).not.toHaveBeenCalled();
    });

    it('rejects SECTION_UNLOCK and DAILY_HOROSCOPE too, not just CREDIT', async () => {
      const { service, prisma } = makeService('0');

      await expect(
        service.claimReward(CLERK_USER, 'SECTION_UNLOCK', undefined, 'reading-1', 'career'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.claimReward(CLERK_USER, 'DAILY_HOROSCOPE'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.adRewardLog.create).not.toHaveBeenCalled();
    });

    it('fires BEFORE the Redis daily counter, so a blocked call costs no quota', async () => {
      const { service, redis } = makeService('0');

      await expect(service.claimReward(CLERK_USER, 'CREDIT')).rejects.toThrow();

      expect(redis.incrementRateLimit).not.toHaveBeenCalled();
    });

    it('rejects an invalid reward type the same way — no argument oracle when disabled', async () => {
      const { service } = makeService('0');

      // Enabled, this would be "Invalid reward type"; disabled, the switch wins
      // first, so a probe cannot learn which reward types exist.
      await expect(service.claimReward(CLERK_USER, 'NOT_A_REAL_TYPE')).rejects.toMatchObject({
        response: { code: 'ADS_REWARDS_DISABLED' },
      });
    });
  });

  describe("enabled ('1')", () => {
    it('lets a CREDIT claim through to the normal grant path', async () => {
      const { service, prisma, redis } = makeService('1');

      const result = await service.claimReward(CLERK_USER, 'CREDIT');

      expect(redis.incrementRateLimit).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.creditsGranted).toBeGreaterThan(0);
    });

    it('still enforces the per-account daily cap', async () => {
      const { service, redis } = makeService('1');
      redis.incrementRateLimit.mockResolvedValue(6); // MAX_DAILY_AD_VIEWS = 5

      await expect(service.claimReward(CLERK_USER, 'CREDIT')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('still rejects an invalid reward type', async () => {
      const { service } = makeService('1');

      await expect(service.claimReward(CLERK_USER, 'NOT_A_REAL_TYPE')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
