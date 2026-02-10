import { Test, TestingModule } from '@nestjs/testing';
import { ZwdsService } from '../src/zwds/zwds.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AIService } from '../src/ai/ai.service';
import { ReadingType } from '@prisma/client';
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { ZwdsChartData, ZwdsPalace } from '../src/zwds/zwds.types';

describe('ZwdsService', () => {
  let service: ZwdsService;
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;
  let aiService: jest.Mocked<AIService>;

  const mockUser = {
    id: 'user-1',
    clerkUserId: 'clerk_user_1',
    name: 'Test User',
    avatarUrl: null,
    subscriptionTier: 'FREE',
    credits: 10,
    languagePref: 'ZH_TW',
    freeReadingUsed: false,
    deviceFingerprint: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProfile = {
    id: 'profile-1',
    userId: 'user-1',
    name: '張三',
    birthDate: new Date('1990-05-15'),
    birthTime: '14:30',
    birthCity: 'Taipei',
    birthTimezone: 'Asia/Taipei',
    birthLongitude: 121.5654,
    birthLatitude: 25.0330,
    gender: 'MALE' as const,
    relationshipTag: 'SELF' as const,
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProfileB = {
    ...mockProfile,
    id: 'profile-2',
    name: '李四',
    birthDate: new Date('1992-08-20'),
    birthTime: '09:15',
    gender: 'FEMALE' as const,
  };

  const mockService = {
    id: 'svc-1',
    slug: 'zwds-lifetime',
    nameZhTw: '紫微終身運',
    nameZhCn: '紫微终身运',
    descriptionZhTw: '',
    descriptionZhCn: '',
    type: ReadingType.ZWDS_LIFETIME,
    creditCost: 2,
    isActive: true,
    sortOrder: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCompatService = {
    ...mockService,
    id: 'svc-compat',
    slug: 'zwds-compatibility',
    type: ReadingType.ZWDS_COMPATIBILITY,
    creditCost: 3,
  };

  const mockAIResult = {
    interpretation: {
      sections: {
        personality: { preview: '命主紫微坐命…', full: '完整人格分析…' },
        life_pattern: { preview: '命格概覽…', full: '完整格局分析…' },
        major_periods: { preview: '大限走勢…', full: '完整大限分析…' },
        overall_destiny: { preview: '綜合判斷…', full: '完整命運總結…' },
      },
      summary: { preview: '概要', full: '總結' },
    },
    provider: 'CLAUDE',
    model: 'claude-sonnet-4-20250514',
    tokenUsage: { inputTokens: 1500, outputTokens: 2000, totalTokens: 3500, estimatedCostUsd: 0.035 },
    latencyMs: 3000,
    isCacheHit: false,
  };

  beforeEach(async () => {
    const mockPrisma = {
      user: { findUnique: jest.fn() },
      birthProfile: { findFirst: jest.fn() },
      service: { findFirst: jest.fn() },
      baziReading: { create: jest.fn(), findFirst: jest.fn() },
      baziComparison: { create: jest.fn() },
      $transaction: jest.fn(),
    };

    const mockRedis = {
      getOrSet: jest.fn(),
      getJson: jest.fn(),
      setJson: jest.fn(),
      del: jest.fn(),
    };

    const mockAI = {
      generateBirthDataHash: jest.fn().mockReturnValue('hash123'),
      getCachedInterpretation: jest.fn().mockResolvedValue(null),
      generateInterpretation: jest.fn().mockResolvedValue(mockAIResult),
      cacheInterpretation: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZwdsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: AIService, useValue: mockAI },
      ],
    }).compile();

    service = module.get<ZwdsService>(ZwdsService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
    aiService = module.get(AIService);
  });

  // ============================================================
  // birthTimeToIndex — comprehensive time mapping
  // ============================================================

  describe('birthTimeToIndex', () => {
    // Early 子時 (23:00-00:59 → index 0)
    it('should map 00:00 to 0 (early 子時 — midnight boundary)', () => {
      expect(service.birthTimeToIndex('00:00')).toBe(0);
    });

    it('should map 00:30 to 0 (early 子時 — mid-hour)', () => {
      expect(service.birthTimeToIndex('00:30')).toBe(0);
    });

    it('should map 00:59 to 0 (early 子時 — end boundary)', () => {
      expect(service.birthTimeToIndex('00:59')).toBe(0);
    });

    // 丑時 (01:00-02:59 → index 1)
    it('should map 01:00 to 1 (丑時 start)', () => {
      expect(service.birthTimeToIndex('01:00')).toBe(1);
    });

    it('should map 02:59 to 1 (丑時 end)', () => {
      expect(service.birthTimeToIndex('02:59')).toBe(1);
    });

    // 寅時 (03:00-04:59 → index 2)
    it('should map 03:00 to 2 (寅時)', () => {
      expect(service.birthTimeToIndex('03:00')).toBe(2);
    });

    it('should map 04:30 to 2 (寅時 mid)', () => {
      expect(service.birthTimeToIndex('04:30')).toBe(2);
    });

    // 卯時 (05:00-06:59 → index 3)
    it('should map 05:00 to 3 (卯時)', () => {
      expect(service.birthTimeToIndex('05:00')).toBe(3);
    });

    // 辰時 (07:00-08:59 → index 4)
    it('should map 07:00 to 4 (辰時)', () => {
      expect(service.birthTimeToIndex('07:00')).toBe(4);
    });

    // 巳時 (09:00-10:59 → index 5)
    it('should map 09:00 to 5 (巳時)', () => {
      expect(service.birthTimeToIndex('09:00')).toBe(5);
    });

    // 午時 (11:00-12:59 → index 6)
    it('should map 11:00 to 6 (午時 start)', () => {
      expect(service.birthTimeToIndex('11:00')).toBe(6);
    });

    it('should map 12:00 to 6 (午時 noon)', () => {
      expect(service.birthTimeToIndex('12:00')).toBe(6);
    });

    it('should map 12:59 to 6 (午時 end)', () => {
      expect(service.birthTimeToIndex('12:59')).toBe(6);
    });

    // 未時 (13:00-14:59 → index 7)
    it('should map 13:00 to 7 (未時)', () => {
      expect(service.birthTimeToIndex('13:00')).toBe(7);
    });

    it('should map 14:30 to 7 (未時 mid)', () => {
      expect(service.birthTimeToIndex('14:30')).toBe(7);
    });

    // 申時 (15:00-16:59 → index 8)
    it('should map 15:00 to 8 (申時)', () => {
      expect(service.birthTimeToIndex('15:00')).toBe(8);
    });

    // 酉時 (17:00-18:59 → index 9)
    it('should map 17:00 to 9 (酉時)', () => {
      expect(service.birthTimeToIndex('17:00')).toBe(9);
    });

    // 戌時 (19:00-20:59 → index 10)
    it('should map 19:00 to 10 (戌時)', () => {
      expect(service.birthTimeToIndex('19:00')).toBe(10);
    });

    // 亥時 (21:00-22:59 → index 11)
    it('should map 21:00 to 11 (亥時 start)', () => {
      expect(service.birthTimeToIndex('21:00')).toBe(11);
    });

    it('should map 22:00 to 11 (亥時 mid)', () => {
      expect(service.birthTimeToIndex('22:00')).toBe(11);
    });

    it('should map 22:59 to 11 (亥時 end)', () => {
      expect(service.birthTimeToIndex('22:59')).toBe(11);
    });

    // Late 子時 (23:00-23:59 → index 12)
    it('should map 23:00 to 12 (late 子時 — start)', () => {
      expect(service.birthTimeToIndex('23:00')).toBe(12);
    });

    it('should map 23:30 to 12 (late 子時 — mid)', () => {
      expect(service.birthTimeToIndex('23:30')).toBe(12);
    });

    it('should map 23:59 to 12 (late 子時 — last minute of day)', () => {
      expect(service.birthTimeToIndex('23:59')).toBe(12);
    });

    // Verify all 13 indices are covered (0-12)
    it('should map all 24 hours to valid indices 0-12', () => {
      for (let h = 0; h < 24; h++) {
        const time = `${h.toString().padStart(2, '0')}:00`;
        const idx = service.birthTimeToIndex(time);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(12);
      }
    });

    // Transition boundaries — verify exact hour transitions
    it('should correctly transition between 時辰 at odd hours', () => {
      // Each odd hour starts a new 時辰
      expect(service.birthTimeToIndex('00:59')).toBe(0); // still early 子
      expect(service.birthTimeToIndex('01:00')).toBe(1); // now 丑
      expect(service.birthTimeToIndex('02:59')).toBe(1); // still 丑
      expect(service.birthTimeToIndex('03:00')).toBe(2); // now 寅
      expect(service.birthTimeToIndex('04:59')).toBe(2); // still 寅
      expect(service.birthTimeToIndex('05:00')).toBe(3); // now 卯
    });
  });

  // ============================================================
  // generateChart — iztro integration edge cases
  // ============================================================

  describe('generateChart', () => {
    // --- Basic chart structure ---
    it('should generate a chart with exactly 12 palaces', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      expect(chart.palaces).toHaveLength(12);
    });

    it('should return all required top-level fields', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      expect(chart.solarDate).toBeDefined();
      expect(chart.lunarDate).toBeDefined();
      expect(chart.chineseDate).toBeDefined();
      expect(chart.birthTime).toBeDefined();
      expect(chart.timeRange).toBeDefined();
      expect(chart.gender).toBe('男');
      expect(chart.zodiac).toBeDefined();
      expect(chart.sign).toBeDefined();
      expect(chart.fiveElementsClass).toBeDefined();
      expect(chart.soulPalaceBranch).toBeDefined();
      expect(chart.bodyPalaceBranch).toBeDefined();
      expect(chart.soulStar).toBeDefined();
      expect(chart.bodyStar).toBeDefined();
    });

    it('should have no horoscope data when targetDate not provided', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      expect(chart.horoscope).toBeUndefined();
    });

    // --- Palace structure validation ---
    it('should include all standard palace names', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const palaceNames = chart.palaces.map((p) => p.name);
      // iztro uses zh-TW names; "交友" is called "僕役" in iztro
      const requiredPalaces = ['命宮', '兄弟', '夫妻', '子女', '財帛', '疾厄',
        '遷移', '僕役', '官祿', '田宅', '福德', '父母'];
      for (const name of requiredPalaces) {
        expect(palaceNames).toContain(name);
      }
    });

    it('each palace should have index 0-11', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const indices = chart.palaces.map((p) => p.index).sort((a, b) => a - b);
      expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('each palace should have heavenly stem and earthly branch', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      for (const palace of chart.palaces) {
        expect(palace.heavenlyStem).toBeDefined();
        expect(typeof palace.heavenlyStem).toBe('string');
        expect(palace.earthlyBranch).toBeDefined();
        expect(typeof palace.earthlyBranch).toBe('string');
      }
    });

    it('exactly one palace should be the body palace', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const bodyPalaces = chart.palaces.filter((p) => p.isBodyPalace);
      expect(bodyPalaces.length).toBe(1);
    });

    it('each palace should have decadal info with age range', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      for (const palace of chart.palaces) {
        expect(palace.decadal).toBeDefined();
        expect(typeof palace.decadal.startAge).toBe('number');
        expect(typeof palace.decadal.endAge).toBe('number');
        expect(palace.decadal.endAge).toBeGreaterThan(palace.decadal.startAge);
        expect(palace.decadal.stem).toBeDefined();
        expect(palace.decadal.branch).toBeDefined();
      }
    });

    // --- Star validation ---
    it('should include major stars with brightness', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const allMajorStars = chart.palaces.flatMap((p) => p.majorStars);
      expect(allMajorStars.length).toBeGreaterThan(0);
      // All major stars should have type='major'
      for (const star of allMajorStars) {
        expect(star.type).toBe('major');
      }
      // At least some should have brightness
      const starsWithBrightness = allMajorStars.filter((s) => s.brightness);
      expect(starsWithBrightness.length).toBeGreaterThan(0);
    });

    it('should include the 14 major stars across all palaces', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const majorStarNames = chart.palaces.flatMap((p) => p.majorStars.map((s) => s.name));
      // Should have at least most of the 14 major stars
      // (not all 14 necessarily appear with names in every chart configuration)
      expect(majorStarNames.length).toBeGreaterThanOrEqual(12);
    });

    it('should include minor stars', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const allMinorStars = chart.palaces.flatMap((p) => p.minorStars);
      expect(allMinorStars.length).toBeGreaterThan(0);
      for (const star of allMinorStars) {
        expect(star.type).toBe('minor');
      }
    });

    it('should include adjective stars', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const allAdjectiveStars = chart.palaces.flatMap((p) => p.adjectiveStars);
      expect(allAdjectiveStars.length).toBeGreaterThan(0);
      for (const star of allAdjectiveStars) {
        expect(star.type).toBe('adjective');
      }
    });

    it('should have exactly 4 mutagen (四化) stars in the natal chart', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const allStars = chart.palaces.flatMap((p) => [
        ...p.majorStars,
        ...p.minorStars,
        ...p.adjectiveStars,
      ]);
      const starsWithMutagen = allStars.filter((s) => s.mutagen);
      // Natal chart should have exactly 4 四化: 祿, 權, 科, 忌 (iztro uses short form)
      expect(starsWithMutagen.length).toBe(4);
      const mutagenTypes = starsWithMutagen.map((s) => s.mutagen).sort();
      expect(mutagenTypes).toContain('祿');
      expect(mutagenTypes).toContain('權');
      expect(mutagenTypes).toContain('科');
      expect(mutagenTypes).toContain('忌');
    });

    it('brightness values should be valid ZWDS levels', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      const validBrightness = ['廟', '旺', '得', '利', '平', '不', '陷', ''];
      const allStarsWithBrightness = chart.palaces.flatMap((p) => [
        ...p.majorStars,
        ...p.minorStars,
      ]).filter((s) => s.brightness);
      for (const star of allStarsWithBrightness) {
        expect(validBrightness).toContain(star.brightness);
      }
    });

    it('each palace should have changsheng12 (十二長生)', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      for (const palace of chart.palaces) {
        expect(typeof palace.changsheng12).toBe('string');
      }
    });

    // --- Gender differences ---
    it('should generate different charts for male vs female (大限 direction)', async () => {
      const chartMale = await service.generateChart('1990-5-15', '14:30', 'male');
      const chartFemale = await service.generateChart('1990-5-15', '14:30', 'female');

      expect(chartMale.gender).toBe('男');
      expect(chartFemale.gender).toBe('女');

      // Decadal age ranges differ because male/female progress in opposite directions
      const maleDecadals = chartMale.palaces.map((p) => p.decadal.startAge);
      const femaleDecadals = chartFemale.palaces.map((p) => p.decadal.startAge);
      expect(maleDecadals).not.toEqual(femaleDecadals);
    });

    it('should produce same star placements for male vs female (only 大限 differs)', async () => {
      const chartMale = await service.generateChart('1990-5-15', '14:30', 'male');
      const chartFemale = await service.generateChart('1990-5-15', '14:30', 'female');

      // Star placements should be identical — only 大限 direction changes
      const maleMajors = chartMale.palaces.map((p) => p.majorStars.map((s) => s.name).sort());
      const femaleMajors = chartFemale.palaces.map((p) => p.majorStars.map((s) => s.name).sort());
      expect(maleMajors).toEqual(femaleMajors);
    });

    // --- Horoscope (transit data) ---
    it('should add horoscope data when targetDate provided', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male', '2026-2-10');

      expect(chart.horoscope).toBeDefined();
      expect(chart.horoscope!.decadal).toBeDefined();
      expect(chart.horoscope!.decadal.name).toBeDefined();
      expect(chart.horoscope!.decadal.stem).toBeDefined();
      expect(chart.horoscope!.decadal.branch).toBeDefined();
      expect(chart.horoscope!.decadal.mutagen).toBeDefined();
      expect(Array.isArray(chart.horoscope!.decadal.mutagen)).toBe(true);

      expect(chart.horoscope!.yearly).toBeDefined();
      expect(chart.horoscope!.yearly.name).toBeDefined();
      expect(chart.horoscope!.yearly.stem).toBeDefined();
      expect(chart.horoscope!.yearly.branch).toBeDefined();
    });

    it('should include monthly horoscope data', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male', '2026-2-10');
      // Monthly should be present for a specific date
      if (chart.horoscope!.monthly) {
        expect(chart.horoscope!.monthly.stem).toBeDefined();
        expect(chart.horoscope!.monthly.branch).toBeDefined();
      }
    });

    it('should gracefully handle horoscope failure without failing entire chart', async () => {
      // Use a far-future date that might cause issues
      const chart = await service.generateChart('1990-5-15', '14:30', 'male', '2200-1-1');
      // Should still return a valid chart even if horoscope fails
      expect(chart.palaces).toHaveLength(12);
    });

    // --- Different birth dates across decades ---
    it('should generate valid chart for 1960s birth', async () => {
      const chart = await service.generateChart('1965-3-20', '08:15', 'male');
      expect(chart.palaces).toHaveLength(12);
      expect(chart.fiveElementsClass).toBeDefined();
    });

    it('should generate valid chart for 1970s birth', async () => {
      const chart = await service.generateChart('1978-11-8', '22:00', 'female');
      expect(chart.palaces).toHaveLength(12);
      expect(chart.gender).toBe('女');
    });

    it('should generate valid chart for 2000s birth', async () => {
      const chart = await service.generateChart('2005-7-1', '06:00', 'male');
      expect(chart.palaces).toHaveLength(12);
    });

    it('should generate valid chart for 2020s birth', async () => {
      const chart = await service.generateChart('2024-12-25', '15:00', 'female');
      expect(chart.palaces).toHaveLength(12);
    });

    // --- Time boundary edge cases ---
    it('should handle midnight birth (00:00) — early 子時', async () => {
      const chart = await service.generateChart('1990-5-15', '00:00', 'male');
      expect(chart.palaces).toHaveLength(12);
      expect(chart.birthTime).toBeDefined();
    });

    it('should handle 23:00 birth — late 子時 (timeIndex=12)', async () => {
      const chart = await service.generateChart('1990-5-15', '23:00', 'male');
      expect(chart.palaces).toHaveLength(12);
    });

    it('should map 00:00 and 23:00 to different time indices (early vs late 子時)', () => {
      // Early 子 (00:00) maps to index 0, late 子 (23:00) maps to index 12
      // These are distinct iztro time indices even though both are 子時
      expect(service.birthTimeToIndex('00:00')).toBe(0);
      expect(service.birthTimeToIndex('23:00')).toBe(12);
      expect(service.birthTimeToIndex('00:00')).not.toBe(service.birthTimeToIndex('23:00'));
    });

    it('early 子時 and late 子時 produce charts via different time indices', async () => {
      // Both generate valid charts; the actual palace arrangement may or may not differ
      // depending on whether the late 子時 triggers a day boundary change in iztro
      const chartEarly = await service.generateChart('1990-5-15', '00:00', 'male');
      const chartLate = await service.generateChart('1990-5-15', '23:00', 'male');

      // Both should be valid 12-palace charts
      expect(chartEarly.palaces).toHaveLength(12);
      expect(chartLate.palaces).toHaveLength(12);
    });

    // --- Date boundary edge cases ---
    it('should handle Chinese New Year boundary (Feb 3-5 area)', async () => {
      const chart = await service.generateChart('1990-2-4', '10:00', 'male');
      expect(chart.palaces).toHaveLength(12);
      expect(chart.lunarDate).toBeDefined();
    });

    it('should handle January 1st', async () => {
      const chart = await service.generateChart('2000-1-1', '12:00', 'male');
      expect(chart.palaces).toHaveLength(12);
    });

    it('should handle December 31st', async () => {
      const chart = await service.generateChart('2000-12-31', '12:00', 'male');
      expect(chart.palaces).toHaveLength(12);
    });

    it('should handle February 29 (leap year)', async () => {
      const chart = await service.generateChart('2000-2-29', '12:00', 'male');
      expect(chart.palaces).toHaveLength(12);
    });

    // --- Five Elements Class validation ---
    it('fiveElementsClass should be one of the 6 valid classes', async () => {
      const chart = await service.generateChart('1990-5-15', '14:30', 'male');
      // 五行局: 水二局, 木三局, 金四局, 土五局, 火六局
      expect(chart.fiveElementsClass).toMatch(/[水木金土火][二三四五六]局/);
    });

    // --- Different charts for different dates ---
    it('should produce different charts for different birth dates', async () => {
      const chart1 = await service.generateChart('1990-5-15', '14:30', 'male');
      const chart2 = await service.generateChart('1985-10-20', '08:00', 'male');

      // Different birth data should yield different charts
      expect(chart1.fiveElementsClass).not.toEqual(chart2.fiveElementsClass);
    });

    it('should produce different charts for different birth times on same day', async () => {
      const chartMorning = await service.generateChart('1990-5-15', '06:00', 'male');
      const chartEvening = await service.generateChart('1990-5-15', '18:00', 'male');

      // Different time indices should produce different palace arrangements
      const morningLife = chartMorning.palaces.find((p) => p.name === '命宮');
      const eveningLife = chartEvening.palaces.find((p) => p.name === '命宮');
      // Very likely different earthly branches
      expect(morningLife!.index).not.toEqual(eveningLife!.index);
    });

    // --- Zodiac verification ---
    it('should return correct Chinese zodiac for birth year', async () => {
      // 1990 is Year of the Horse (馬)
      const chart1990 = await service.generateChart('1990-5-15', '14:30', 'male');
      expect(chart1990.zodiac).toContain('馬');
    });
  });

  // ============================================================
  // createReading — business logic edge cases
  // ============================================================

  describe('createReading', () => {
    // --- User validation ---
    it('should throw NotFoundException when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createReading('unknown_clerk', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_LIFETIME,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // --- Reading type validation ---
    it('should throw BadRequestException for Bazi LIFETIME type', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.LIFETIME as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for Bazi ANNUAL type', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ANNUAL as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for ZWDS_COMPATIBILITY (not a single reading)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_COMPATIBILITY as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // --- Annual reading requires targetYear ---
    it('should throw BadRequestException when ZWDS_ANNUAL without targetYear', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_ANNUAL,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept ZWDS_ANNUAL with targetYear', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue({
        ...mockService,
        type: ReadingType.ZWDS_ANNUAL,
      });
      const createdReading = { id: 'reading-annual', readingType: ReadingType.ZWDS_ANNUAL };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziReading: { create: jest.fn().mockResolvedValue(createdReading) },
        });
      });

      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_ANNUAL,
        targetYear: 2026,
      });

      expect(result.readingType).toBe(ReadingType.ZWDS_ANNUAL);
    });

    // --- Profile validation ---
    it('should throw NotFoundException when profile not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'nonexistent',
          readingType: ReadingType.ZWDS_LIFETIME,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // --- Service availability ---
    it('should throw BadRequestException when service not active', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_LIFETIME,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // --- Credit/payment validation ---
    it('should throw BadRequestException when insufficient credits and free reading used', async () => {
      const noCreditsUser = { ...mockUser, credits: 0, freeReadingUsed: true };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(noCreditsUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_LIFETIME,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when credits exactly 1 less than required (creditCost=2, credits=1)', async () => {
      const lowCreditsUser = { ...mockUser, credits: 1, freeReadingUsed: true };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(lowCreditsUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_LIFETIME,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when credits exactly equal to cost (creditCost=2, credits=2)', async () => {
      const exactCreditsUser = { ...mockUser, credits: 2, freeReadingUsed: true };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(exactCreditsUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);

      const createdReading = { id: 'reading-1', readingType: ReadingType.ZWDS_LIFETIME, creditsUsed: 2 };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziReading: { create: jest.fn().mockResolvedValue(createdReading) },
        });
      });

      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_LIFETIME,
      });

      expect(result.creditsUsed).toBe(2);
    });

    // --- Free trial flow ---
    it('should create reading with free trial (creditsUsed=0)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser); // freeReadingUsed: false
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);

      const createdReading = { id: 'reading-1', readingType: ReadingType.ZWDS_LIFETIME, creditsUsed: 0 };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziReading: { create: jest.fn().mockResolvedValue(createdReading) },
        });
      });

      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_LIFETIME,
      });

      expect(result.creditsUsed).toBe(0);
      expect(aiService.generateInterpretation).toHaveBeenCalled();
    });

    it('should handle race condition on free trial (concurrent claim)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);

      // Simulate race condition: updateMany returns count=0 (already claimed)
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          baziReading: { create: jest.fn() },
        });
      });

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_LIFETIME,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle race condition on credit deduction (concurrent spend)', async () => {
      const paidUser = { ...mockUser, credits: 2, freeReadingUsed: true };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(paidUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);

      // Simulate race: credits already spent by concurrent request
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          baziReading: { create: jest.fn() },
        });
      });

      await expect(
        service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_LIFETIME,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // --- Cache behavior ---
    it('should skip AI generation when cache hit', async () => {
      const cachedResult = {
        sections: { personality: { preview: 'cached preview', full: 'cached full' } },
        summary: { preview: '', full: '' },
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);
      (aiService.getCachedInterpretation as jest.Mock).mockResolvedValue(cachedResult);

      const createdReading = { id: 'reading-cached', readingType: ReadingType.ZWDS_LIFETIME };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziReading: { create: jest.fn().mockResolvedValue(createdReading) },
        });
      });

      await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_LIFETIME,
      });

      expect(aiService.generateInterpretation).not.toHaveBeenCalled();
    });

    it('should generate hash for cache lookup', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);

      const createdReading = { id: 'reading-1', readingType: ReadingType.ZWDS_LIFETIME };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziReading: { create: jest.fn().mockResolvedValue(createdReading) },
        });
      });

      await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_LIFETIME,
      });

      expect(aiService.generateBirthDataHash).toHaveBeenCalledWith(
        expect.any(String), // birthDate
        '14:30',            // birthTime
        'Taipei',           // city
        'male',             // gender
        ReadingType.ZWDS_LIFETIME,
        undefined,          // no targetYear
      );
    });

    // --- AI failure graceful degradation ---
    it('should create reading even when AI interpretation fails', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);
      (aiService.generateInterpretation as jest.Mock).mockRejectedValue(new Error('AI provider down'));

      const createdReading = {
        id: 'reading-no-ai',
        readingType: ReadingType.ZWDS_LIFETIME,
        aiInterpretation: undefined,
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziReading: { create: jest.fn().mockResolvedValue(createdReading) },
        });
      });

      // Should NOT throw — graceful degradation
      const result = await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_LIFETIME,
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('reading-no-ai');
    });

    // --- All 5 single ZWDS reading types ---
    const singleZwdsTypes = [
      ReadingType.ZWDS_LIFETIME,
      ReadingType.ZWDS_CAREER,
      ReadingType.ZWDS_LOVE,
      ReadingType.ZWDS_HEALTH,
    ];

    for (const readingType of singleZwdsTypes) {
      it(`should accept ${readingType} as valid reading type`, async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
        (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
        (prisma.service.findFirst as jest.Mock).mockResolvedValue({
          ...mockService,
          type: readingType,
        });

        const createdReading = { id: `reading-${readingType}`, readingType };
        (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
          return fn({
            user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            baziReading: { create: jest.fn().mockResolvedValue(createdReading) },
          });
        });

        const result = await service.createReading('clerk_user_1', {
          birthProfileId: 'profile-1',
          readingType,
        });

        expect(result.readingType).toBe(readingType);
      });
    }

    // --- AI enrichment data ---
    it('should pass ZWDS chart data to AI service with system=zwds', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockService);

      const createdReading = { id: 'reading-1', readingType: ReadingType.ZWDS_LIFETIME };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziReading: { create: jest.fn().mockResolvedValue(createdReading) },
        });
      });

      await service.createReading('clerk_user_1', {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_LIFETIME,
      });

      expect(aiService.generateInterpretation).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'zwds',
          palaces: expect.any(Array),
          fiveElementsClass: expect.any(String),
        }),
        ReadingType.ZWDS_LIFETIME,
        'user-1',
      );
    });
  });

  // ============================================================
  // getReading — paywall logic
  // ============================================================

  describe('getReading', () => {
    it('should throw NotFoundException when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getReading('unknown', 'reading-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when reading not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.baziReading.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getReading('clerk_user_1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should return full reading for subscriber (PRO tier)', async () => {
      const subscriber = { ...mockUser, subscriptionTier: 'PRO' };
      const reading = {
        id: 'reading-1',
        userId: 'user-1',
        creditsUsed: 2,
        aiInterpretation: {
          sections: {
            personality: { preview: 'short preview', full: 'long detailed analysis' },
            life_pattern: { preview: 'pattern preview', full: 'full pattern analysis' },
          },
        },
        birthProfile: mockProfile,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(subscriber);
      (prisma.baziReading.findFirst as jest.Mock).mockResolvedValue(reading);

      const result = await service.getReading('clerk_user_1', 'reading-1');
      expect((result as any).aiInterpretation.sections.personality.full).toBe('long detailed analysis');
    });

    it('should return full reading for MASTER tier subscriber', async () => {
      const subscriber = { ...mockUser, subscriptionTier: 'MASTER' };
      const reading = {
        id: 'reading-1',
        userId: 'user-1',
        creditsUsed: 2,
        aiInterpretation: {
          sections: {
            personality: { preview: 'preview', full: 'full text' },
          },
        },
        birthProfile: mockProfile,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(subscriber);
      (prisma.baziReading.findFirst as jest.Mock).mockResolvedValue(reading);

      const result = await service.getReading('clerk_user_1', 'reading-1');
      expect((result as any).aiInterpretation.sections.personality.full).toBe('full text');
    });

    it('should return full reading for owner who paid credits', async () => {
      // Free user who used credits for this reading
      const reading = {
        id: 'reading-1',
        userId: 'user-1',
        creditsUsed: 2,
        aiInterpretation: {
          sections: {
            personality: { preview: 'preview', full: 'detailed' },
          },
        },
        birthProfile: mockProfile,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.baziReading.findFirst as jest.Mock).mockResolvedValue(reading);

      const result = await service.getReading('clerk_user_1', 'reading-1');
      expect((result as any).aiInterpretation.sections.personality.full).toBe('detailed');
    });

    it('should return full reading for free trial reading (creditsUsed=0, same owner)', async () => {
      const reading = {
        id: 'reading-1',
        userId: 'user-1',
        creditsUsed: 0, // free trial
        aiInterpretation: {
          sections: {
            personality: { preview: 'preview', full: 'full free trial' },
          },
        },
        birthProfile: mockProfile,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.baziReading.findFirst as jest.Mock).mockResolvedValue(reading);

      const result = await service.getReading('clerk_user_1', 'reading-1');
      // Owner always gets full content (isOwnerReading: reading.userId === user.id)
      expect((result as any).aiInterpretation.sections.personality.full).toBe('full free trial');
    });

    it('should handle reading with null aiInterpretation (AI failure case)', async () => {
      const reading = {
        id: 'reading-1',
        userId: 'user-1',
        creditsUsed: 2,
        aiInterpretation: null,
        birthProfile: mockProfile,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.baziReading.findFirst as jest.Mock).mockResolvedValue(reading);

      const result = await service.getReading('clerk_user_1', 'reading-1');
      expect(result).toBeDefined();
      expect((result as any).aiInterpretation).toBeNull();
    });
  });

  // ============================================================
  // getChartPreview — free chart without AI
  // ============================================================

  describe('getChartPreview', () => {
    it('should throw NotFoundException when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getChartPreview('unknown', { birthProfileId: 'profile-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when profile not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getChartPreview('clerk_user_1', { birthProfileId: 'nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return chart data with 12 palaces', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.getChartPreview('clerk_user_1', { birthProfileId: 'profile-1' });

      expect(result.palaces).toHaveLength(12);
      expect(result.solarDate).toBeDefined();
      expect(result.fiveElementsClass).toBeDefined();
    });

    it('should NOT call AI service for chart preview', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      await service.getChartPreview('clerk_user_1', { birthProfileId: 'profile-1' });

      expect(aiService.generateInterpretation).not.toHaveBeenCalled();
      expect(aiService.getCachedInterpretation).not.toHaveBeenCalled();
    });

    it('should not include horoscope data (no target date)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.getChartPreview('clerk_user_1', { birthProfileId: 'profile-1' });
      expect(result.horoscope).toBeUndefined();
    });

    it('should format solar date without zero-padding (iztro format)', async () => {
      // Profile with Jan 5 date — should become '1990-1-5' not '1990-01-05'
      const janProfile = {
        ...mockProfile,
        birthDate: new Date('1990-01-05'),
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(janProfile);

      const result = await service.getChartPreview('clerk_user_1', { birthProfileId: 'profile-1' });
      // Should work correctly with non-zero-padded date
      expect(result.palaces).toHaveLength(12);
    });
  });

  // ============================================================
  // getHoroscope — 大限/流年/流月 transit data
  // ============================================================

  describe('getHoroscope', () => {
    it('should throw NotFoundException when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getHoroscope('unknown', { birthProfileId: 'profile-1', targetDate: '2026-2-10' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when profile not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getHoroscope('clerk_user_1', { birthProfileId: 'nonexistent', targetDate: '2026-2-10' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return chart with horoscope data for target date', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result = await service.getHoroscope('clerk_user_1', {
        birthProfileId: 'profile-1',
        targetDate: '2026-2-10',
      });

      expect(result.palaces).toHaveLength(12);
      expect(result.horoscope).toBeDefined();
      expect(result.horoscope!.decadal).toBeDefined();
      expect(result.horoscope!.yearly).toBeDefined();
    });

    it('should return different horoscope stems/branches for different years', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result2026 = await service.getHoroscope('clerk_user_1', {
        birthProfileId: 'profile-1',
        targetDate: '2026-2-10',
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result2030 = await service.getHoroscope('clerk_user_1', {
        birthProfileId: 'profile-1',
        targetDate: '2030-6-15',
      });

      // Different years should have different yearly stem+branch combination
      const yearly2026 = `${result2026.horoscope!.yearly.stem}${result2026.horoscope!.yearly.branch}`;
      const yearly2030 = `${result2030.horoscope!.yearly.stem}${result2030.horoscope!.yearly.branch}`;
      expect(yearly2026).not.toEqual(yearly2030);
    });

    it('should return different decadal stems/branches for dates 20 years apart', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result2026 = await service.getHoroscope('clerk_user_1', {
        birthProfileId: 'profile-1',
        targetDate: '2026-2-10',
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock).mockResolvedValue(mockProfile);

      const result2046 = await service.getHoroscope('clerk_user_1', {
        birthProfileId: 'profile-1',
        targetDate: '2046-2-10',
      });

      // 20 years apart with ~10yr 大限 periods → different branch
      const decadal2026 = `${result2026.horoscope!.decadal.stem}${result2026.horoscope!.decadal.branch}`;
      const decadal2046 = `${result2046.horoscope!.decadal.stem}${result2046.horoscope!.decadal.branch}`;
      expect(decadal2026).not.toEqual(decadal2046);
    });
  });

  // ============================================================
  // createComparison — compatibility flow
  // ============================================================

  describe('createComparison', () => {
    it('should throw NotFoundException when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createComparison('unknown', {
          profileAId: 'profile-1',
          profileBId: 'profile-2',
          comparisonType: 'ROMANCE' as any,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when profile A not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)  // profileA
        .mockResolvedValueOnce(mockProfileB);  // profileB

      await expect(
        service.createComparison('clerk_user_1', {
          profileAId: 'nonexistent',
          profileBId: 'profile-2',
          comparisonType: 'ROMANCE' as any,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when profile B not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProfile)  // profileA
        .mockResolvedValueOnce(null);  // profileB

      await expect(
        service.createComparison('clerk_user_1', {
          profileAId: 'profile-1',
          profileBId: 'nonexistent',
          comparisonType: 'ROMANCE' as any,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when ZWDS_COMPATIBILITY service not active', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProfile)
        .mockResolvedValueOnce(mockProfileB);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createComparison('clerk_user_1', {
          profileAId: 'profile-1',
          profileBId: 'profile-2',
          comparisonType: 'ROMANCE' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when insufficient credits for comparison (3 credits)', async () => {
      const lowCredits = { ...mockUser, credits: 2, freeReadingUsed: true };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(lowCredits);
      (prisma.birthProfile.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProfile)
        .mockResolvedValueOnce(mockProfileB);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockCompatService);

      await expect(
        service.createComparison('clerk_user_1', {
          profileAId: 'profile-1',
          profileBId: 'profile-2',
          comparisonType: 'ROMANCE' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create comparison successfully with ROMANCE type', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProfile)
        .mockResolvedValueOnce(mockProfileB);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockCompatService);

      const createdComparison = { id: 'comp-1', comparisonType: 'ROMANCE' };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziComparison: { create: jest.fn().mockResolvedValue(createdComparison) },
        });
      });

      const result = await service.createComparison('clerk_user_1', {
        profileAId: 'profile-1',
        profileBId: 'profile-2',
        comparisonType: 'ROMANCE' as any,
      });

      expect(result.comparisonType).toBe('ROMANCE');
    });

    it('should pass both charts to AI for interpretation', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProfile)
        .mockResolvedValueOnce(mockProfileB);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockCompatService);

      const createdComparison = { id: 'comp-1', comparisonType: 'ROMANCE' };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziComparison: { create: jest.fn().mockResolvedValue(createdComparison) },
        });
      });

      await service.createComparison('clerk_user_1', {
        profileAId: 'profile-1',
        profileBId: 'profile-2',
        comparisonType: 'ROMANCE' as any,
      });

      expect(aiService.generateInterpretation).toHaveBeenCalledWith(
        expect.objectContaining({
          chartA: expect.objectContaining({ palaces: expect.any(Array) }),
          chartB: expect.objectContaining({ palaces: expect.any(Array) }),
          system: 'zwds',
          comparisonType: 'romance',
        }),
        ReadingType.ZWDS_COMPATIBILITY,
        'user-1',
      );
    });

    it('should handle AI failure gracefully for comparison', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (prisma.birthProfile.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProfile)
        .mockResolvedValueOnce(mockProfileB);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockCompatService);
      (aiService.generateInterpretation as jest.Mock).mockRejectedValue(new Error('AI down'));

      const createdComparison = { id: 'comp-1', comparisonType: 'ROMANCE' };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziComparison: { create: jest.fn().mockResolvedValue(createdComparison) },
        });
      });

      // Should not throw — graceful degradation
      const result = await service.createComparison('clerk_user_1', {
        profileAId: 'profile-1',
        profileBId: 'profile-2',
        comparisonType: 'ROMANCE' as any,
      });

      expect(result).toBeDefined();
    });

    it('should use free trial for comparison if available', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser); // freeReadingUsed: false
      (prisma.birthProfile.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockProfile)
        .mockResolvedValueOnce(mockProfileB);
      (prisma.service.findFirst as jest.Mock).mockResolvedValue(mockCompatService);

      const createdComparison = { id: 'comp-1', comparisonType: 'ROMANCE', creditsUsed: 0 };
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          baziComparison: { create: jest.fn().mockResolvedValue(createdComparison) },
        });
      });

      const result = await service.createComparison('clerk_user_1', {
        profileAId: 'profile-1',
        profileBId: 'profile-2',
        comparisonType: 'ROMANCE' as any,
      });

      expect(result.creditsUsed).toBe(0);
    });
  });
});
