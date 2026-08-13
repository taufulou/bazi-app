/**
 * A8 (Phase 1A) — `ad_reward` section-unlock kill switch.
 *
 * The `ad_reward` branch created a SectionUnlock row with `creditsUsed: 0` and
 * verified nothing: no AdRewardLog lookup, no AdMob SSV, no proof an ad was ever
 * shown. Any authenticated user could unlock every paid section of every reading
 * they own with a single POST. Gated behind ADS_REWARDS_ENABLED (default off).
 *
 * These tests also pin the design decision from the plan review: the DTO keeps
 * ACCEPTING `ad_reward` (a static `@IsIn` cannot be env-toggled), so enforcement
 * must live in the service where the flag can actually govern it.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SectionUnlockService } from '../src/payments/section-unlock.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { CreditsService } from '../src/credits/credits.service';

const CLERK_USER = 'user_clerk_abc';
const USER_ID = 'db-uuid-1';
const READING_ID = 'reading-1';

/**
 * Marker meaning "the env var is not set at all" (config.get → undefined).
 *
 * A default parameter CANNOT express this: JS defaults fire on an explicitly
 * passed `undefined`, so `makeService('1', undefined)` would collapse into the
 * default and test the opposite of what it claims. An explicit marker keeps the
 * three states — omitted / set / unset — genuinely distinct. (The first attempt
 * here used a default value and was caught by the F3 test failing.)
 */
const UNSET = 'UNSET_ENV_VAR';

function makeService(
  adsRewardsEnabled: string | undefined,
  // Omitted ⇒ '1', so the ad_reward tests exercise the AD gate specifically
  // rather than being short-circuited by the feature switch. Pass UNSET to
  // simulate a missing env var.
  sectionUnlockEnabledArg: string = '1',
) {
  const sectionUnlockEnabled =
    sectionUnlockEnabledArg === UNSET ? undefined : sectionUnlockEnabledArg;
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
    baziReading: {
      findUnique: jest.fn().mockResolvedValue({
        id: READING_ID,
        userId: USER_ID,
        readingType: 'LIFETIME',
        // Shape matters: the service reads `aiInterpretation.sections[sectionKey]`.
        aiInterpretation: {
          sections: { career: { content: 'x' }, personality: { content: 'y' } },
        },
      }),
    },
    sectionUnlock: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    service: { findFirst: jest.fn().mockResolvedValue({ sectionUnlockCreditCost: 1 }) },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
      cb({ sectionUnlock: { create: jest.fn().mockResolvedValue({}) } }),
    ),
  };
  const credits = { deductCredits: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'ADS_REWARDS_ENABLED') return adsRewardsEnabled;
      if (key === 'SECTION_UNLOCK_ENABLED') return sectionUnlockEnabled;
      return undefined;
    }),
  };
  const service = new SectionUnlockService(
    prisma as unknown as PrismaService,
    credits as unknown as CreditsService,
    config as unknown as ConfigService,
  );
  return { service, prisma, credits, config };
}

describe('SectionUnlockService — ad_reward kill switch (A8)', () => {
  describe('disabled (the default)', () => {
    it.each([
      ['unset (production default)', undefined],
      ["explicitly '0'", '0'],
    ])('rejects an ad_reward unlock when the flag is %s', async (_label, flag) => {
      const { service } = makeService(flag as string | undefined);

      // Assert the CODE, not just the exception class — several earlier
      // validations also throw BadRequestException, so a class-only assertion
      // would pass even if the kill switch were removed entirely.
      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'bazi', 'career', 'ad_reward'),
      ).rejects.toMatchObject({ response: { code: 'ADS_REWARDS_DISABLED' } });
    });

    it('rejects with ADS_REWARDS_DISABLED and points the user at the credit path', async () => {
      const { service } = makeService('0');

      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'bazi', 'career', 'ad_reward'),
      ).rejects.toMatchObject({ response: { code: 'ADS_REWARDS_DISABLED' } });
    });

    it('creates NO SectionUnlock row — the paid section stays locked', async () => {
      const { service, prisma } = makeService('0');

      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'bazi', 'career', 'ad_reward'),
      ).rejects.toThrow();

      expect(prisma.sectionUnlock.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('leaves the paid CREDIT path completely unaffected', async () => {
      const { service, prisma, credits } = makeService('0');

      const result = await service.unlockSection(
        CLERK_USER, READING_ID, 'bazi', 'career', 'credit',
      );

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(1);
      expect(credits.deductCredits).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('still enforces ownership before reaching the flag (no info leak)', async () => {
      const { service, prisma } = makeService('0');
      prisma.baziReading.findUnique.mockResolvedValue({
        id: READING_ID,
        userId: 'SOMEONE-ELSE',
        readingType: 'LIFETIME',
        // MUST carry the `sections` wrapper (like the default mock) — without it
        // the flow diverts into the section-existence check at service:164 and
        // this test passes no matter what the ownership code does.
        aiInterpretation: { sections: { career: { content: 'x' } } },
      });

      // Assert the POSITIVE class. The earlier `.rejects.not.toMatchObject(...)`
      // was satisfied by ANY rejection: an audit deleted the entire ownership
      // block and this test still passed. Ownership must win over the kill
      // switch so the flag's error can't confirm a reading id exists.
      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'bazi', 'career', 'ad_reward'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ============================================================
  // F3 — the whole feature is disabled (owner decision 2026-08-13)
  // ============================================================
  describe('SECTION_UNLOCK_ENABLED (F3 feature switch)', () => {
    it.each([
      ['unset (production default)', UNSET],
      ["explicitly '0'", '0'],
    ])('rejects the CREDIT method when the feature flag is %s', async (_label, flag) => {
      // Ads ON, feature OFF — proves the feature switch is what refuses, not the ad gate.
      const { service } = makeService('1', flag);

      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'bazi', 'career', 'credit'),
      ).rejects.toMatchObject({ response: { code: 'SECTION_UNLOCK_DISABLED' } });
    });

    it('charges NOTHING when disabled — the whole point of F3', async () => {
      const { service, prisma, credits } = makeService('1', '0');

      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'bazi', 'career', 'credit'),
      ).rejects.toThrow();

      expect(credits.deductCredits).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.sectionUnlock.create).not.toHaveBeenCalled();
    });

    it('outranks ADS_REWARDS_ENABLED — feature off blocks ad_reward too', async () => {
      const { service } = makeService('1', '0');

      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'bazi', 'career', 'ad_reward'),
      ).rejects.toMatchObject({ response: { code: 'SECTION_UNLOCK_DISABLED' } });
    });

    it('fires before ALL validation — no oracle for section keys or reading types', async () => {
      const { service, prisma } = makeService('1', '0');

      // Both would normally throw their own distinct BadRequestException.
      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'NOT_A_TYPE', 'career', 'credit'),
      ).rejects.toMatchObject({ response: { code: 'SECTION_UNLOCK_DISABLED' } });
      await expect(
        service.unlockSection(CLERK_USER, READING_ID, 'bazi', 'NOT_A_SECTION', 'credit'),
      ).rejects.toMatchObject({ response: { code: 'SECTION_UNLOCK_DISABLED' } });

      // And it never even looks the reading up.
      expect(prisma.baziReading.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("enabled ('1')", () => {
    it('allows the ad_reward unlock through (the documented re-enable path)', async () => {
      const { service, prisma } = makeService('1');

      const result = await service.unlockSection(
        CLERK_USER, READING_ID, 'bazi', 'career', 'ad_reward',
      );

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(0);
      expect(prisma.sectionUnlock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unlockMethod: 'AD_REWARD', creditsUsed: 0 }),
        }),
      );
    });
  });
});
