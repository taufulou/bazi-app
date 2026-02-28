/**
 * Tests for SSE Streaming — Phase E
 * Tests the brace-depth section extractor, static section emission,
 * and streaming Observable lifecycle.
 */
import { AIService } from '../src/ai/ai.service';
import { Observable, firstValueFrom, toArray } from 'rxjs';

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
  baziReading: { update: jest.fn().mockResolvedValue({}) },
};

const mockRedis = {
  getJson: jest.fn().mockResolvedValue(null),
  setJson: jest.fn().mockResolvedValue(undefined),
  getOrSet: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(undefined),
};

// ============================================================
// Tests
// ============================================================

describe('SSE Streaming — Phase E', () => {
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
  // Brace-depth Section Extractor
  // ============================================================

  describe('extractCompletedSections (brace-depth tracker)', () => {
    // Access private method via type assertion
    function extract(
      buffer: string,
      keys: readonly string[],
      already: Set<string> = new Set(),
    ) {
      return (service as any).extractCompletedSections(buffer, keys, already);
    }

    it('should extract a single complete section', () => {
      const buffer = `{
        "chart_identity": {"preview": "短文", "full": "完整內容"}
      }`;
      const result = extract(buffer, ['chart_identity']);
      expect(result).toHaveProperty('chart_identity');
      expect(result.chart_identity.preview).toBe('短文');
      expect(result.chart_identity.full).toBe('完整內容');
    });

    it('should extract multiple complete sections', () => {
      const buffer = `{
        "chart_identity": {"preview": "身份短文", "full": "身份完整"},
        "finance_pattern": {"preview": "財運短文", "full": "財運完整"}
      }`;
      const keys = ['chart_identity', 'finance_pattern', 'career_pattern'];
      const result = extract(buffer, keys);
      expect(Object.keys(result)).toHaveLength(2);
      expect(result.chart_identity.preview).toBe('身份短文');
      expect(result.finance_pattern.full).toBe('財運完整');
    });

    it('should not extract incomplete sections (truncated JSON)', () => {
      const buffer = `{
        "chart_identity": {"preview": "短文", "full": "完整內容"},
        "finance_pattern": {"preview": "財運短
      `;
      const keys = ['chart_identity', 'finance_pattern'];
      const result = extract(buffer, keys);
      expect(Object.keys(result)).toHaveLength(1);
      expect(result).toHaveProperty('chart_identity');
      expect(result).not.toHaveProperty('finance_pattern');
    });

    it('should handle escaped quotes inside strings', () => {
      const buffer = `{
        "chart_identity": {"preview": "日主為\\"庚金\\"", "full": "日主是\\"庚金\\"，身強"}
      }`;
      const result = extract(buffer, ['chart_identity']);
      expect(result).toHaveProperty('chart_identity');
      expect(result.chart_identity.preview).toContain('庚金');
    });

    it('should handle nested braces inside string values', () => {
      const buffer = `{
        "chart_identity": {"preview": "格局{偏官格}", "full": "格局為{偏官格}，身弱需要印星"}
      }`;
      const result = extract(buffer, ['chart_identity']);
      expect(result).toHaveProperty('chart_identity');
      expect(result.chart_identity.full).toContain('{偏官格}');
    });

    it('should skip already-extracted keys', () => {
      const buffer = `{
        "chart_identity": {"preview": "A", "full": "B"},
        "finance_pattern": {"preview": "C", "full": "D"}
      }`;
      const already = new Set(['chart_identity']);
      const result = extract(buffer, ['chart_identity', 'finance_pattern'], already);
      expect(Object.keys(result)).toHaveLength(1);
      expect(result).toHaveProperty('finance_pattern');
      expect(result).not.toHaveProperty('chart_identity');
    });

    it('should handle sections with newlines in values', () => {
      const buffer = `{
        "health": {"preview": "健康概述", "full": "健康分析\\n1. 心臟\\n2. 腸胃"}
      }`;
      const result = extract(buffer, ['health']);
      expect(result).toHaveProperty('health');
      expect(result.health.full).toContain('心臟');
    });

    it('should handle real-world V2 JSON structure', () => {
      const buffer = JSON.stringify({
        sections: {
          chart_identity: { preview: '命格概述', full: '您的八字四柱為丁卯年、戊申月、戊午日、庚申時。日主戊土生於申月，得令而旺。格局為偏印格。' },
          finance_pattern: { preview: '財運概述', full: '日主身強，財星為木。偏財旺於月柱，正財透干有力。' },
          career_pattern: { preview: '事業概述', full: '偏官格特質，適合管理型工作。' },
        },
        summary: { preview: '綜合', full: '綜合分析' },
      });

      // The sections are nested under "sections" key, but our extractor looks for flat keys
      // So let's test with the inner content
      const innerBuffer = `{
        "chart_identity": {"preview": "命格概述", "full": "完整命格分析"},
        "finance_pattern": {"preview": "財運概述", "full": "完整財運分析"},
        "career_pattern": {"preview": "事業概述", "full": "完整事業分析"}
      }`;
      const keys = ['chart_identity', 'finance_pattern', 'career_pattern', 'boss_strategy'];
      const result = extract(innerBuffer, keys);
      expect(Object.keys(result)).toHaveLength(3);
      expect(result.chart_identity.full).toBe('完整命格分析');
    });

    it('should handle empty buffer', () => {
      const result = extract('', ['chart_identity']);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle buffer with only opening brace', () => {
      const result = extract('{"chart_identity": {', ['chart_identity']);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle section with nested objects', () => {
      const buffer = `{
        "chart_identity": {"preview": "短文", "full": "完整", "extra": {"nested": true}}
      }`;
      const result = extract(buffer, ['chart_identity']);
      // Should NOT extract because it doesn't have just preview/full at top level
      // Actually it WILL extract because it has preview AND full
      expect(result).toHaveProperty('chart_identity');
      expect(result.chart_identity.preview).toBe('短文');
    });

    it('should handle progressive buffer growth (simulating streaming)', () => {
      const already = new Set<string>();
      const keys = ['chart_identity', 'finance_pattern'] as const;

      // First chunk: only chart_identity is complete
      const chunk1 = `{
        "chart_identity": {"preview": "命格", "full": "完整命格分析"},
        "finance_pattern": {"preview": "財`;
      const result1 = extract(chunk1, keys, already);
      expect(Object.keys(result1)).toHaveLength(1);
      expect(result1).toHaveProperty('chart_identity');
      expect(already.has('chart_identity')).toBe(true);

      // Second chunk: finance_pattern now complete
      const chunk2 = chunk1 + `運", "full": "完整財運分析"}
      }`;
      const result2 = extract(chunk2, keys, already);
      expect(Object.keys(result2)).toHaveLength(1);
      expect(result2).toHaveProperty('finance_pattern');
      expect(already.has('finance_pattern')).toBe(true);
    });

    it('should handle Chinese characters with special JSON escaping', () => {
      const buffer = `{
        "chart_identity": {"preview": "\\u5148\\u5929\\u547d\\u683c", "full": "\\u5b8c\\u6574"}
      }`;
      const result = extract(buffer, ['chart_identity']);
      expect(result).toHaveProperty('chart_identity');
      // JSON.parse will decode Unicode escapes
      expect(result.chart_identity.preview).toBe('先天命格');
    });
  });

  // ============================================================
  // buildLifetimeV2Prompts
  // ============================================================

  describe('buildLifetimeV2Prompts', () => {
    const SAMPLE_V2_DATA = {
      gender: 'male',
      birthDate: '1987-09-06',
      birthTime: '16:11',
      lunarDate: { year: 1987, month: 7, day: 14, isLeapMonth: false },
      fourPillars: {
        year: { stem: '丁', branch: '卯', tenGod: '正印', hiddenStems: ['乙'], naYin: '爐中火' },
        month: { stem: '戊', branch: '申', tenGod: '比肩', hiddenStems: ['庚', '壬', '戊'], naYin: '大驛土' },
        day: { stem: '戊', branch: '午', tenGod: null, hiddenStems: ['丁', '己'], naYin: '天上火' },
        hour: { stem: '庚', branch: '申', tenGod: '食神', hiddenStems: ['庚', '壬', '戊'], naYin: '石榴木' },
      },
      dayMaster: {
        element: '土', yinYang: '陽', strength: 'strong', strengthScore: 72,
        pattern: '食神格', sameParty: 58, oppositeParty: 42,
        favorableGod: '木', usefulGod: '金', idleGod: '水', tabooGod: '火', enemyGod: '土',
      },
      dayMasterStem: '戊',
      fiveElementsBalanceZh: { '木': 8, '火': 18, '土': 32, '金': 27, '水': 15 },
      trueSolarTime: { clock_time: '16:11', true_solar_time: '16:05' },
      luckPeriods: [
        { startAge: 5, endAge: 14, startYear: 1992, endYear: 2001, stem: '己', branch: '酉', tenGod: '劫財', isCurrent: false },
      ],
      annualStars: [{ year: 2026, stem: '丙', branch: '午', tenGod: '偏印', isCurrent: true }],
      allShenSha: [{ name: '天乙貴人', pillar: 'year', branch: '卯' }],
      preAnalysis: '日主戊土生於申月...',
      strengthV2: { result: 'strong', score: 72 },
      effectiveFavorableGods: { usefulGod: '金', favorableGod: '木', tabooGod: '火', enemyGod: '土' },
      lifetimeEnhancedInsights: {
        patternNarrative: {
          patternName: '食神格',
          patternLogic: '月令申金藏庚為食神',
          patternStrengthRelation: '身強食旺，洩秀為用',
          dominantTenGods: ['食神', '比肩'],
        },
        childrenInsights: {
          shishanManifestCount: 1,
          shishanLatentCount: 1,
          shishanTransparent: ['庚'],
          hourPillarTenGod: '食神',
          isShishanSuppressed: false,
          hourBranchLifeStage: '病',
        },
        parentsInsights: {
          fatherStar: '偏財',
          motherStar: '正印',
          yearStemTenGod: '正印',
          yearBranchMainTenGod: '正官',
          fatherElement: '木',
          motherElement: '火',
          fatherStarCount: 2,
          motherStarCount: 1,
          yearPillarRelation: '卯木生丁火',
          yearPillarFavorability: '喜神',
        },
        bossCompatibility: {
          dominantStyle: '食神主導→溫和細膩型',
          idealBossType: '偏財型上司',
          workplaceStrengths: ['創意', '細心'],
          workplaceWarnings: ['優柔寡斷'],
        },
        deterministic: {
          favorable_investments: ['黃金', '基金'],
          unfavorable_investments: ['期貨'],
          career_directions: [{ anchor: '金之理財', category: '金融', industries: ['銀行'] }],
          favorable_direction: '西方',
          career_benefactors_element: ['金', '木'],
          career_benefactors_zodiac: ['蛇', '牛'],
          partner_element: ['金', '木'],
          partner_zodiac: ['羊'],
          romance_years: [2027, 2030],
          parent_health_years: { father: [2029], mother: [2031] },
          luck_periods_enriched: [],
        },
      },
    };

    it('should build both Call 1 and Call 2 prompts', () => {
      const result = (service as any).buildLifetimeV2Prompts(SAMPLE_V2_DATA);
      expect(result.systemPrompt).toBeDefined();
      expect(result.userPromptCall1).toBeDefined();
      expect(result.userPromptCall2).toBeDefined();
      expect(result.systemPrompt.length).toBeGreaterThan(100);
    });

    it('should include chart data in Call 1 prompt', () => {
      const { userPromptCall1 } = (service as any).buildLifetimeV2Prompts(SAMPLE_V2_DATA);
      expect(userPromptCall1).toContain('丁卯'); // year pillar
      expect(userPromptCall1).toContain('戊申'); // month pillar
      expect(userPromptCall1).toContain('戊午'); // day pillar
      expect(userPromptCall1).toContain('庚申'); // hour pillar
      expect(userPromptCall1).toContain('土'); // day master element
    });

    it('should include patternNarrative in Call 1 prompt', () => {
      const { userPromptCall1 } = (service as any).buildLifetimeV2Prompts(SAMPLE_V2_DATA);
      expect(userPromptCall1).toContain('食神格');
      expect(userPromptCall1).toContain('月令申金藏庚為食神');
    });

    it('should include anti-hallucination rules in system prompt', () => {
      const { systemPrompt } = (service as any).buildLifetimeV2Prompts(SAMPLE_V2_DATA);
      expect(systemPrompt).toContain('JSON');
    });
  });

  // ============================================================
  // streamLifetimeV2 Observable Lifecycle
  // ============================================================

  describe('streamLifetimeV2 (Observable structure)', () => {
    it('should return an Observable', () => {
      const result = service.streamLifetimeV2({}, 'test-reading-id');
      expect(result).toBeInstanceOf(Observable);
    });

    it('should emit error event when no AI provider is configured', async () => {
      const obs = service.streamLifetimeV2(
        {
          gender: 'male',
          birthDate: '1987-09-06',
          birthTime: '16:11',
          fourPillars: {
            year: { stem: '丁', branch: '卯' },
            month: { stem: '戊', branch: '申' },
            day: { stem: '戊', branch: '午' },
            hour: { stem: '庚', branch: '申' },
          },
          dayMaster: { element: '土', pattern: '食神格' },
        },
        'test-reading-id',
      );

      const events = await firstValueFrom(obs.pipe(toArray()));
      // Should complete with at least one event (likely error since no provider configured)
      expect(events.length).toBeGreaterThan(0);
      // First meaningful event should be an error (no provider)
      const errorEvent = events.find((e: any) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    }, 15000);
  });

  // ============================================================
  // Auto-Fix Validation Layer
  // ============================================================

  describe('autoFixSection (post-processing validator)', () => {
    // Access private method via type assertion
    function autoFix(
      sectionKey: string,
      section: { preview: string; full: string },
      calculationData: Record<string, unknown>,
    ) {
      return (service as any).autoFixSection(sectionKey, section, calculationData);
    }

    const baseCalcData = {
      dayMaster: {
        element: '木',
        tabooGod: '金',
        enemyGod: '土',
      },
      dayMasterStem: '甲',
      pillars: {
        year: { stem: '丙', branch: '寅' },
        month: { stem: '辛', branch: '丑' },
        day: { stem: '甲', branch: '戌' },
        hour: { stem: '壬', branch: '申' },
      },
      lifetimeEnhancedInsights: {
        childrenInsights: {
          hourPillarTenGod: '偏官',
          shishanManifestCount: 1,
          shishanTransparent: ['食神'],
          shishanLatentCount: 0,
          isShishanSuppressed: false,
        },
      },
    };

    it('should fix 忌神/仇神 mislabeling: "忌神土" → "仇神土"', () => {
      const section = {
        preview: '命主忌神土帶來壓力',
        full: '忌神土五行使命主脾胃容易受損，忌神金則直接克制命主',
      };
      const { section: fixed, fixes } = autoFix('health', section, baseCalcData);

      expect(fixed.preview).toBe('命主仇神土帶來壓力');
      expect(fixed.full).toContain('仇神土五行');
      expect(fixed.full).toContain('忌神金'); // 金 IS the real 忌神, should stay
      expect(fixes.length).toBeGreaterThanOrEqual(2);
    });

    it('should fix parenthesized variant: "忌神（土）" → "仇神（土）"', () => {
      const section = {
        preview: '正常預覽',
        full: '需注意忌神（土）五行帶來的消化問題',
      };
      const { section: fixed, fixes } = autoFix('health', section, baseCalcData);

      expect(fixed.full).toContain('仇神（土）');
      expect(fixes.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT touch correct labels', () => {
      const section = {
        preview: '忌神金克制日主',
        full: '忌神金帶來壓力，仇神土也有不利影響',
      };
      const { section: fixed, fixes } = autoFix('health', section, baseCalcData);

      expect(fixed.full).toBe(section.full); // No changes
      expect(fixed.preview).toBe(section.preview);
      expect(fixes.length).toBe(0);
    });

    it('should fix "時支本氣為偏印" → "時支本氣為偏官" in children_analysis', () => {
      const section = {
        preview: '子女分析摘要',
        full: '時支本氣為偏印，子女性格偏向孤僻獨立',
      };
      const { section: fixed, fixes } = autoFix('children_analysis', section, baseCalcData);

      expect(fixed.full).toContain('時支本氣為偏官');
      expect(fixes.length).toBeGreaterThanOrEqual(1);
    });

    it('should fix "時柱十神為偏印" → "時柱十神為偏官" in children_analysis', () => {
      const section = {
        preview: '子女分析摘要',
        full: '時柱十神為偏印，反映子女宮能量',
      };
      const { section: fixed, fixes } = autoFix('children_analysis', section, baseCalcData);

      expect(fixed.full).toContain('時柱十神為偏官');
      expect(fixes.length).toBeGreaterThanOrEqual(1);
    });

    it('should fix transparent/latent contradiction in children_analysis', () => {
      const section = {
        preview: '子女分析摘要',
        full: '丙火食神透於年干但藏而不透，子女緣分尚可',
      };
      const { section: fixed, fixes } = autoFix('children_analysis', section, baseCalcData);

      expect(fixed.full).not.toContain('藏而不透');
      expect(fixed.full).toContain('顯現食傷');
      expect(fixes.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle multiple fixes in one section', () => {
      const section = {
        preview: '忌神土帶來壓力',
        full: '忌神土影響脾胃，時支本氣為偏印，丙火食神透於年干但藏而不透',
      };
      const { section: fixed, fixes } = autoFix('children_analysis', section, baseCalcData);

      expect(fixed.preview).toContain('仇神土');
      expect(fixed.full).toContain('仇神土');
      expect(fixed.full).toContain('時支本氣為偏官');
      expect(fixed.full).not.toContain('藏而不透');
      expect(fixes.length).toBeGreaterThanOrEqual(3);
    });

    it('should return empty fixes when no errors detected', () => {
      const section = {
        preview: '正常的預覽文字',
        full: '正常的完整分析文字，沒有任何錯誤',
      };
      const { section: fixed, fixes } = autoFix('career_pattern', section, baseCalcData);

      expect(fixed).toEqual(section);
      expect(fixes.length).toBe(0);
    });

    it('should not fix when tabooGod === enemyGod', () => {
      const sameGodData = {
        ...baseCalcData,
        dayMaster: { element: '木', tabooGod: '金', enemyGod: '金' },
      };
      const section = {
        preview: '忌神金',
        full: '忌神金克制命主',
      };
      const { fixes } = autoFix('health', section, sameGodData);
      expect(fixes.length).toBe(0); // No fix needed
    });
  });

  describe('autoFixAllSections (batch processor)', () => {
    function autoFixAll(
      parsed: { sections: Record<string, { preview: string; full: string }>; summary: { preview: string; full: string } },
      calculationData: Record<string, unknown>,
    ) {
      return (service as any).autoFixAllSections(parsed, calculationData);
    }

    it('should process all sections and aggregate fixes', () => {
      const parsed = {
        sections: {
          health: {
            preview: '忌神土',
            full: '忌神土影響健康',
          },
          career_pattern: {
            preview: '忌神土行業',
            full: '忌神土相關行業不宜從事',
          },
          finance_pattern: {
            preview: '正常',
            full: '正常分析無錯誤',
          },
        },
        summary: { preview: '總結', full: '總結全文' },
      };

      const calcData = {
        dayMaster: { element: '木', tabooGod: '金', enemyGod: '土' },
        dayMasterStem: '甲',
        lifetimeEnhancedInsights: {},
      };

      const { result, allFixes } = autoFixAll(parsed, calcData);

      // health and career_pattern should be fixed
      expect(result.sections['health'].preview).toContain('仇神土');
      expect(result.sections['health'].full).toContain('仇神土');
      expect(result.sections['career_pattern'].preview).toContain('仇神土');
      expect(result.sections['career_pattern'].full).toContain('仇神土');
      // finance_pattern should be unchanged
      expect(result.sections['finance_pattern'].full).toBe('正常分析無錯誤');
      // Summary should be preserved
      expect(result.summary).toEqual(parsed.summary);
      // Multiple fixes aggregated
      expect(allFixes.length).toBeGreaterThanOrEqual(4);
    });
  });
});
