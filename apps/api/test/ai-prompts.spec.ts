/**
 * Tests for AI prompt templates and interpolation.
 */
import {
  READING_PROMPTS,
  BASE_SYSTEM_PROMPT,
  OUTPUT_FORMAT_INSTRUCTIONS,
  COMPARISON_TYPE_ZH,
  GENDER_ZH,
  STRENGTH_ZH,
} from '../src/ai/prompts';

// ============================================================
// Sample calculation data (mimics Python engine output)
// ============================================================

const SAMPLE_CALCULATION = {
  gender: 'male',
  birthDate: '1990-05-15',
  birthTime: '14:30',
  fourPillars: {
    year: {
      stem: '庚',
      branch: '午',
      stemElement: '金',
      branchElement: '火',
      stemYinYang: '陽',
      hiddenStems: ['丁', '己'],
      tenGod: '比肩',
      naYin: '路旁土',
      shenSha: [],
    },
    month: {
      stem: '辛',
      branch: '巳',
      stemElement: '金',
      branchElement: '火',
      stemYinYang: '陰',
      hiddenStems: ['丙', '庚', '戊'],
      tenGod: '劫財',
      naYin: '白蠟金',
      shenSha: ['文昌'],
    },
    day: {
      stem: '庚',
      branch: '辰',
      stemElement: '金',
      branchElement: '土',
      stemYinYang: '陽',
      hiddenStems: ['戊', '乙', '癸'],
      tenGod: null,
      naYin: '白蠟金',
      shenSha: ['華蓋'],
    },
    hour: {
      stem: '癸',
      branch: '未',
      stemElement: '水',
      branchElement: '土',
      stemYinYang: '陰',
      hiddenStems: ['己', '丁', '乙'],
      tenGod: '傷官',
      naYin: '楊柳木',
      shenSha: [],
    },
  },
  dayMaster: {
    element: '金',
    yinYang: '陽',
    strength: 'neutral',
    strengthScore: 55,
    pattern: '食神格',
    sameParty: 39,
    oppositeParty: 61,
    favorableGod: '土',
    usefulGod: '金',
    idleGod: '水',
    tabooGod: '火',
    enemyGod: '木',
  },
  dayMasterStem: '庚',
  fiveElementsBalanceZh: { '木': 10.0, '火': 25.0, '土': 25.0, '金': 25.0, '水': 15.0 },
  fiveElementsBalance: { wood: 10.0, fire: 25.0, earth: 25.0, metal: 25.0, water: 15.0 },
  trueSolarTime: {
    clock_time: '14:30',
    true_solar_time: '14:24',
    longitude_offset: -6.0,
    equation_of_time: 3.8,
  },
  lunarDate: { year: 1990, month: 4, day: 21, isLeapMonth: false },
  luckPeriods: [
    { startAge: 5, endAge: 14, startYear: 1995, endYear: 2004, stem: '壬', branch: '午', tenGod: '食神', isCurrent: false },
    { startAge: 15, endAge: 24, startYear: 2005, endYear: 2014, stem: '癸', branch: '未', tenGod: '傷官', isCurrent: false },
    { startAge: 25, endAge: 34, startYear: 2015, endYear: 2024, stem: '甲', branch: '申', tenGod: '偏財', isCurrent: false },
    { startAge: 35, endAge: 44, startYear: 2025, endYear: 2034, stem: '乙', branch: '酉', tenGod: '正財', isCurrent: true },
  ],
  annualStars: [
    { year: 2026, stem: '丙', branch: '午', tenGod: '偏官', isCurrent: true },
  ],
  monthlyStars: [
    { month: 1, solarTermDate: '2026-02-04', stem: '庚', branch: '寅', tenGod: '比肩' },
    { month: 2, solarTermDate: '2026-03-06', stem: '辛', branch: '卯', tenGod: '劫財' },
  ],
  allShenSha: [
    { name: '文昌', pillar: 'month', branch: '巳' },
    { name: '華蓋', pillar: 'day', branch: '辰' },
  ],
  tenGodDistribution: {
    '比肩': 2, '劫財': 1, '食神': 1, '傷官': 1,
    '偏財': 0, '正財': 0, '偏官': 0, '正官': 0,
    '偏印': 1, '正印': 2,
  },
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

describe('AI Prompts', () => {
  describe('BASE_SYSTEM_PROMPT', () => {
    it('should be in Traditional Chinese', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('命理大師');
      expect(BASE_SYSTEM_PROMPT).toContain('繁體中文');
    });

    it('should instruct JSON output', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('JSON');
    });
  });

  describe('OUTPUT_FORMAT_INSTRUCTIONS', () => {
    it('should define sections and summary structure', () => {
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('"sections"');
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('"summary"');
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('"preview"');
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('"full"');
    });
  });

  describe('READING_PROMPTS', () => {
    const requiredTypes = ['LIFETIME', 'ANNUAL', 'CAREER', 'LOVE', 'HEALTH', 'COMPATIBILITY'];

    it('should have prompts for all 6 reading types', () => {
      for (const type of requiredTypes) {
        expect(READING_PROMPTS[type]).toBeDefined();
      }
    });

    it.each(requiredTypes)('should have systemAddition, userTemplate, and sections for %s', (type) => {
      const prompt = READING_PROMPTS[type];
      expect(prompt.systemAddition).toBeTruthy();
      expect(prompt.userTemplate).toBeTruthy();
      expect(prompt.sections).toBeInstanceOf(Array);
      expect(prompt.sections.length).toBeGreaterThanOrEqual(3);
    });

    it('LIFETIME should have personality, career, love, finance, health sections', () => {
      expect(READING_PROMPTS.LIFETIME.sections).toEqual(
        ['personality', 'career', 'love', 'finance', 'health']
      );
    });

    it('ANNUAL should have annual-specific sections', () => {
      const sections = READING_PROMPTS.ANNUAL.sections;
      expect(sections).toContain('annual_overview');
      expect(sections).toContain('monthly_forecast');
    });

    it('CAREER should have career-specific sections', () => {
      const sections = READING_PROMPTS.CAREER.sections;
      expect(sections).toContain('career_analysis');
      expect(sections).toContain('favorable_industries');
    });

    it('LOVE should have love-specific sections', () => {
      const sections = READING_PROMPTS.LOVE.sections;
      expect(sections).toContain('ideal_partner');
      expect(sections).toContain('marriage_timing');
    });

    it('HEALTH should have health-specific sections', () => {
      const sections = READING_PROMPTS.HEALTH.sections;
      expect(sections).toContain('constitution');
      expect(sections).toContain('wellness_advice');
    });

    it('COMPATIBILITY should have compatibility-specific sections', () => {
      const sections = READING_PROMPTS.COMPATIBILITY.sections;
      expect(sections).toContain('overall_compatibility');
      expect(sections).toContain('strengths');
      expect(sections).toContain('challenges');
    });

    it('templates should contain placeholders', () => {
      for (const type of requiredTypes) {
        const template = READING_PROMPTS[type].userTemplate;
        expect(template).toContain('{{');
        expect(template).toContain('}}');
      }
    });
  });

  describe('Lookup Maps', () => {
    it('COMPARISON_TYPE_ZH should map all types', () => {
      expect(COMPARISON_TYPE_ZH['romance']).toBe('感情配對');
      expect(COMPARISON_TYPE_ZH['business']).toBe('事業合作');
      expect(COMPARISON_TYPE_ZH['friendship']).toBe('友誼互動');
    });

    it('GENDER_ZH should map male and female', () => {
      expect(GENDER_ZH['male']).toBe('男');
      expect(GENDER_ZH['female']).toBe('女');
    });

    it('STRENGTH_ZH should map all strength levels', () => {
      expect(STRENGTH_ZH['very_weak']).toBe('極弱');
      expect(STRENGTH_ZH['weak']).toBe('偏弱');
      expect(STRENGTH_ZH['neutral']).toBe('中和');
      expect(STRENGTH_ZH['strong']).toBe('偏強');
      expect(STRENGTH_ZH['very_strong']).toBe('極強');
    });
  });
});
