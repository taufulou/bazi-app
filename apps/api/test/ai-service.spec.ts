/**
 * Tests for AI Service - response parsing, caching, prompt building.
 * These tests don't require actual API keys — they test the deterministic logic.
 */
import { AIService } from '../src/ai/ai.service';
import { ReadingType } from '@prisma/client';

// ============================================================
// Mock dependencies
// ============================================================

const mockPrisma = {
  promptTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
  readingCache: {
    findFirst: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
  },
  aIUsageLog: { create: jest.fn().mockResolvedValue({}) },
};

const mockRedis = {
  getJson: jest.fn().mockResolvedValue(null),
  setJson: jest.fn().mockResolvedValue(undefined),
  getOrSet: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(undefined), // No API keys by default
};

// ============================================================
// Sample data
// ============================================================

const SAMPLE_CALCULATION = {
  gender: 'male',
  birthDate: '1990-05-15',
  birthTime: '14:30',
  fourPillars: {
    year: { stem: '庚', branch: '午', tenGod: '比肩', hiddenStems: ['丁', '己'], naYin: '路旁土' },
    month: { stem: '辛', branch: '巳', tenGod: '劫財', hiddenStems: ['丙', '庚', '戊'], naYin: '白蠟金' },
    day: { stem: '庚', branch: '辰', tenGod: null, hiddenStems: ['戊', '乙', '癸'], naYin: '白蠟金' },
    hour: { stem: '癸', branch: '未', tenGod: '傷官', hiddenStems: ['己', '丁', '乙'], naYin: '楊柳木' },
  },
  dayMaster: {
    element: '金', yinYang: '陽', strength: 'neutral', strengthScore: 55,
    pattern: '食神格', sameParty: 39, oppositeParty: 61,
    favorableGod: '土', usefulGod: '金', idleGod: '水', tabooGod: '火', enemyGod: '木',
  },
  dayMasterStem: '庚',
  fiveElementsBalanceZh: { '木': 10, '火': 25, '土': 25, '金': 25, '水': 15 },
  fiveElementsBalance: { wood: 10, fire: 25, earth: 25, metal: 25, water: 15 },
  trueSolarTime: { clock_time: '14:30', true_solar_time: '14:24' },
  lunarDate: { year: 1990, month: 4, day: 21, isLeapMonth: false },
  luckPeriods: [
    { startAge: 5, endAge: 14, startYear: 1995, endYear: 2004, stem: '壬', branch: '午', tenGod: '食神', isCurrent: false },
    { startAge: 35, endAge: 44, startYear: 2025, endYear: 2034, stem: '乙', branch: '酉', tenGod: '正財', isCurrent: true },
  ],
  annualStars: [{ year: 2026, stem: '丙', branch: '午', tenGod: '偏官', isCurrent: true }],
  monthlyStars: [{ month: 1, solarTermDate: '2026-02-04', stem: '庚', branch: '寅', tenGod: '比肩' }],
  allShenSha: [{ name: '文昌', pillar: 'month', branch: '巳' }],
  tenGodDistribution: { '比肩': 2, '劫財': 1, '食神': 1 },
  elementCounts: {
    stems: { '木': 0, '火': 0, '土': 0, '金': 2, '水': 2 },
    branches: { '木': 0, '火': 2, '土': 2, '金': 0, '水': 0 },
    hidden: { '木': 2, '火': 2, '土': 3, '金': 1, '水': 1 },
    total: { '木': 2, '火': 4, '土': 5, '金': 3, '水': 3 },
  },
};

// ============================================================
// Tests
// ============================================================

describe('AIService', () => {
  let service: AIService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AIService(
      mockConfigService as any,
      mockPrisma as any,
      mockRedis as any,
    );
  });

  // ============================================================
  // Prompt Building
  // ============================================================

  describe('buildPrompt', () => {
    it('should build a prompt for LIFETIME reading', async () => {
      const { systemPrompt, userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.LIFETIME,
      );

      expect(systemPrompt).toContain('命理大師');
      expect(systemPrompt).toContain('八字終身運');
      expect(userPrompt).toContain('庚午'); // year pillar
      expect(userPrompt).toContain('辛巳'); // month pillar
      expect(userPrompt).toContain('庚辰'); // day pillar
      expect(userPrompt).toContain('癸未'); // hour pillar
      expect(userPrompt).toContain('金'); // day master element
      expect(userPrompt).toContain('食神格'); // pattern
      expect(userPrompt).toContain('JSON'); // output format
    });

    it('should build a prompt for ANNUAL reading', async () => {
      const dataWithYear = { ...SAMPLE_CALCULATION, targetYear: 2026 };
      const { systemPrompt, userPrompt } = await service.buildPrompt(
        dataWithYear,
        ReadingType.ANNUAL,
      );

      expect(systemPrompt).toContain('流年運勢');
      expect(userPrompt).toContain('2026');
      expect(userPrompt).toContain('丙午'); // 2026 annual star
    });

    it('should build a prompt for CAREER reading', async () => {
      const { userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.CAREER,
      );

      expect(userPrompt).toContain('比肩');
      expect(userPrompt).toContain('career_analysis');
    });

    it('should build a prompt for LOVE reading', async () => {
      const { systemPrompt, userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.LOVE,
      );

      expect(systemPrompt).toContain('愛情姻緣');
      expect(userPrompt).toContain('ideal_partner');
    });

    it('should build a prompt for HEALTH reading', async () => {
      const { systemPrompt, userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.HEALTH,
      );

      expect(systemPrompt).toContain('先天健康分析');
      expect(userPrompt).toContain('constitution');
    });

    it('should interpolate gender correctly', async () => {
      const { userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.LIFETIME,
      );

      expect(userPrompt).toContain('男'); // male = 男
    });

    it('should interpolate strength correctly', async () => {
      const { userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.LIFETIME,
      );

      expect(userPrompt).toContain('中和'); // neutral = 中和
    });

    it('should interpolate luck periods', async () => {
      const { userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.LIFETIME,
      );

      expect(userPrompt).toContain('壬午');
      expect(userPrompt).toContain('5-14歲');
      expect(userPrompt).toContain('← 目前'); // current period
    });

    it('should interpolate shen sha', async () => {
      const { userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.LIFETIME,
      );

      expect(userPrompt).toContain('文昌');
    });

    it('should use DB prompt template if available', async () => {
      mockPrisma.promptTemplate.findFirst.mockResolvedValueOnce({
        systemPrompt: 'Custom system prompt',
        userPromptTemplate: 'Custom {{dayMaster}} analysis',
        outputFormatInstructions: 'Custom format',
      });

      const { systemPrompt, userPrompt } = await service.buildPrompt(
        SAMPLE_CALCULATION,
        ReadingType.LIFETIME,
      );

      expect(systemPrompt).toBe('Custom system prompt');
      expect(userPrompt).toContain('Custom 庚 analysis');
    });
  });

  // ============================================================
  // Response Parsing
  // ============================================================

  describe('parseAIResponse', () => {
    it('should parse valid JSON response', () => {
      const jsonResponse = JSON.stringify({
        sections: {
          personality: { preview: '命主庚金日元', full: '命主庚金日元，生於巳月火旺之時...' },
          career: { preview: '事業方面', full: '事業方面，庚金日主...' },
          love: { preview: '感情方面', full: '感情方面...' },
          finance: { preview: '財運分析', full: '財運分析...' },
          health: { preview: '健康提醒', full: '健康提醒...' },
        },
        summary: { preview: '庚金日主', full: '庚金日主整體命格...' },
      });

      const result = service.parseAIResponse(jsonResponse, ReadingType.LIFETIME);

      expect(result.sections.personality.preview).toBe('命主庚金日元');
      expect(result.sections.career.preview).toBe('事業方面');
      expect(result.summary.preview).toBe('庚金日主');
    });

    it('should parse JSON embedded in text', () => {
      const response = `Here is the analysis:\n${JSON.stringify({
        sections: {
          personality: { preview: 'P', full: 'F' },
        },
        summary: { preview: 'S', full: 'SF' },
      })}\nEnd of analysis.`;

      const result = service.parseAIResponse(response, ReadingType.LIFETIME);
      expect(result.sections.personality.preview).toBe('P');
    });

    it('should fallback gracefully for non-JSON response', () => {
      const rawText = '命主庚金日元\n\n事業分析\n\n感情分析\n\n財運分析\n\n健康提醒';

      const result = service.parseAIResponse(rawText, ReadingType.LIFETIME);

      expect(Object.keys(result.sections).length).toBeGreaterThan(0);
      expect(result.summary.preview.length).toBeGreaterThan(0);
    });

    it('should handle empty response', () => {
      const result = service.parseAIResponse('', ReadingType.LIFETIME);
      expect(result.sections).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should handle malformed JSON gracefully', () => {
      const malformed = '{"sections": {"a": {"preview": "test", "full": "test"';

      const result = service.parseAIResponse(malformed, ReadingType.LIFETIME);
      // Should fall back to text parsing
      expect(result.sections).toBeDefined();
    });
  });

  // ============================================================
  // Birth Data Hash
  // ============================================================

  describe('generateBirthDataHash', () => {
    it('should generate consistent hash for same input', () => {
      const hash1 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.LIFETIME,
      );
      const hash2 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.LIFETIME,
      );

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different input', () => {
      const hash1 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.LIFETIME,
      );
      const hash2 = service.generateBirthDataHash(
        '1990-05-16', '14:30', '台北市', 'male', ReadingType.LIFETIME,
      );

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash for different reading types', () => {
      const hash1 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.LIFETIME,
      );
      const hash2 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.CAREER,
      );

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash for different gender', () => {
      const hash1 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.LIFETIME,
      );
      const hash2 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'female', ReadingType.LIFETIME,
      );

      expect(hash1).not.toBe(hash2);
    });

    it('should include targetYear in hash for annual readings', () => {
      const hash1 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.ANNUAL, 2026,
      );
      const hash2 = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.ANNUAL, 2027,
      );

      expect(hash1).not.toBe(hash2);
    });

    it('should return a 64-character hex string', () => {
      const hash = service.generateBirthDataHash(
        '1990-05-15', '14:30', '台北市', 'male', ReadingType.LIFETIME,
      );

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ============================================================
  // Cache
  // ============================================================

  describe('getCachedInterpretation', () => {
    it('should return null when no cache exists', async () => {
      mockRedis.getJson.mockResolvedValue(null);
      mockPrisma.readingCache.findFirst.mockResolvedValue(null);

      const result = await service.getCachedInterpretation('abc123', ReadingType.LIFETIME);
      expect(result).toBeNull();
    });

    it('should return cached result from Redis', async () => {
      const cached = {
        sections: { personality: { preview: 'P', full: 'F' } },
        summary: { preview: 'S', full: 'SF' },
      };
      mockRedis.getJson.mockResolvedValue(cached);

      const result = await service.getCachedInterpretation('abc123', ReadingType.LIFETIME);
      expect(result).toEqual(cached);
    });

    it('should fall back to DB cache when Redis misses', async () => {
      mockRedis.getJson.mockResolvedValue(null);
      const cached = {
        sections: { personality: { preview: 'DB', full: 'DBFull' } },
        summary: { preview: 'S', full: 'SF' },
      };
      mockPrisma.readingCache.findFirst.mockResolvedValue({
        interpretationJson: cached,
      });

      const result = await service.getCachedInterpretation('abc123', ReadingType.LIFETIME);
      expect(result).toEqual(cached);

      // Should also populate Redis for next time
      expect(mockRedis.setJson).toHaveBeenCalled();
    });
  });

  describe('cacheInterpretation', () => {
    it('should cache to both Redis and DB', async () => {
      const interpretation = {
        sections: { personality: { preview: 'P', full: 'F' } },
        summary: { preview: 'S', full: 'SF' },
      };

      await service.cacheInterpretation(
        'abc123',
        ReadingType.LIFETIME,
        SAMPLE_CALCULATION,
        interpretation,
      );

      expect(mockRedis.setJson).toHaveBeenCalledWith(
        'reading_cache:abc123:LIFETIME',
        interpretation,
        86400,
      );
      expect(mockPrisma.readingCache.upsert).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Provider Initialization
  // ============================================================

  describe('provider initialization', () => {
    it('should have no providers when no API keys set', () => {
      service.onModuleInit();
      // generateInterpretation should throw
      expect(
        service.generateInterpretation(SAMPLE_CALCULATION, ReadingType.LIFETIME),
      ).rejects.toThrow('No AI providers configured');
    });

    it('should initialize Claude when ANTHROPIC_API_KEY is set', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return 'test-key';
        return undefined;
      });

      const s = new AIService(mockConfigService as any, mockPrisma as any, mockRedis as any);
      s.onModuleInit();

      // Verify by checking that it doesn't throw "no providers"
      // (it will throw a different error when actually calling Claude)
      expect((s as any).providers.length).toBe(1);
      expect((s as any).providers[0].provider).toBe('CLAUDE');
    });

    it('should initialize all providers when all keys set', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return 'claude-key';
        if (key === 'OPENAI_API_KEY') return 'openai-key';
        if (key === 'GEMINI_API_KEY') return 'gemini-key';
        return undefined;
      });

      const s = new AIService(mockConfigService as any, mockPrisma as any, mockRedis as any);
      s.onModuleInit();

      expect((s as any).providers.length).toBe(3);
      expect((s as any).providers[0].provider).toBe('CLAUDE');
      expect((s as any).providers[1].provider).toBe('GPT');
      expect((s as any).providers[2].provider).toBe('GEMINI');
    });
  });
});
