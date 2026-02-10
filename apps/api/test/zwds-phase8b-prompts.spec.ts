import {
  ZWDS_READING_PROMPTS,
  CROSS_SYSTEM_PROMPT,
  DEEP_STAR_PROMPT,
} from '../src/ai/prompts';

describe('Phase 8B — ZWDS Prompt Templates', () => {
  // ============================================================
  // ZWDS_MONTHLY
  // ============================================================

  describe('ZWDS_MONTHLY', () => {
    const prompt = ZWDS_READING_PROMPTS.ZWDS_MONTHLY;

    it('should exist with systemAddition, userTemplate, and sections', () => {
      expect(prompt).toBeDefined();
      expect(prompt.systemAddition).toBeDefined();
      expect(prompt.userTemplate).toBeDefined();
      expect(prompt.sections).toBeDefined();
    });

    it('should have exactly 5 monthly sections', () => {
      expect(prompt.sections).toEqual([
        'monthly_overview',
        'monthly_career',
        'monthly_love',
        'monthly_health',
        'monthly_advice',
      ]);
    });

    it('should mention 流月四化 in systemAddition', () => {
      expect(prompt.systemAddition).toContain('流月四化');
    });

    it('should contain monthly horoscope placeholders in template', () => {
      expect(prompt.userTemplate).toContain('{{monthlyInfo}}');
      expect(prompt.userTemplate).toContain('{{monthlyMutagen}}');
    });

    it('should contain yearly data placeholders (context for monthly analysis)', () => {
      expect(prompt.userTemplate).toContain('{{yearlyInfo}}');
      expect(prompt.userTemplate).toContain('{{yearlyMutagen}}');
    });

    it('systemAddition should be substantial (>100 chars)', () => {
      expect(prompt.systemAddition.length).toBeGreaterThan(100);
    });
  });

  // ============================================================
  // ZWDS_DAILY
  // ============================================================

  describe('ZWDS_DAILY', () => {
    const prompt = ZWDS_READING_PROMPTS.ZWDS_DAILY;

    it('should exist with systemAddition, userTemplate, and sections', () => {
      expect(prompt).toBeDefined();
      expect(prompt.systemAddition).toBeDefined();
      expect(prompt.userTemplate).toBeDefined();
      expect(prompt.sections).toBeDefined();
    });

    it('should have exactly 1 section — daily_fortune', () => {
      expect(prompt.sections).toEqual(['daily_fortune']);
    });

    it('should instruct short output (preview ~50 chars, full ~200 chars)', () => {
      // The daily prompt should mention short/brief/concise output
      const combined = prompt.systemAddition + prompt.userTemplate;
      expect(combined).toMatch(/簡短|精簡|200字/);
    });

    it('should contain daily horoscope placeholders', () => {
      expect(prompt.userTemplate).toContain('{{dailyInfo}}');
      expect(prompt.userTemplate).toContain('{{dailyMutagen}}');
    });

    it('should mention 流日四化', () => {
      expect(prompt.systemAddition).toContain('流日四化');
    });
  });

  // ============================================================
  // ZWDS_MAJOR_PERIOD
  // ============================================================

  describe('ZWDS_MAJOR_PERIOD', () => {
    const prompt = ZWDS_READING_PROMPTS.ZWDS_MAJOR_PERIOD;

    it('should exist with systemAddition, userTemplate, and sections', () => {
      expect(prompt).toBeDefined();
      expect(prompt.systemAddition).toBeDefined();
      expect(prompt.userTemplate).toBeDefined();
      expect(prompt.sections).toBeDefined();
    });

    it('should have exactly 5 major period sections', () => {
      expect(prompt.sections).toEqual([
        'period_overview',
        'period_career',
        'period_relationships',
        'period_health',
        'period_strategy',
      ]);
    });

    it('should mention 大限 in systemAddition', () => {
      expect(prompt.systemAddition).toContain('大限');
    });

    it('should contain decadal data placeholders', () => {
      expect(prompt.userTemplate).toContain('{{currentDecadal}}');
      expect(prompt.userTemplate).toContain('{{decadalPeriods}}');
    });

    it('should mention 10-year cycle concept', () => {
      expect(prompt.systemAddition).toContain('10年');
    });

    it('should reference 四化 analysis', () => {
      expect(prompt.systemAddition).toContain('四化');
    });
  });

  // ============================================================
  // ZWDS_QA
  // ============================================================

  describe('ZWDS_QA', () => {
    const prompt = ZWDS_READING_PROMPTS.ZWDS_QA;

    it('should exist with systemAddition, userTemplate, and sections', () => {
      expect(prompt).toBeDefined();
      expect(prompt.systemAddition).toBeDefined();
      expect(prompt.userTemplate).toBeDefined();
      expect(prompt.sections).toBeDefined();
    });

    it('should have exactly 3 Q&A sections', () => {
      expect(prompt.sections).toEqual(['answer', 'analysis', 'advice']);
    });

    it('should contain questionText placeholder', () => {
      expect(prompt.userTemplate).toContain('{{questionText}}');
    });

    it('should instruct direct question answering', () => {
      // The Q&A prompt should mention directly answering the question
      expect(prompt.systemAddition).toMatch(/直接回答|針對性/);
    });

    it('should mention identifying relevant palaces based on question', () => {
      expect(prompt.systemAddition).toContain('宮位');
    });
  });

  // ============================================================
  // CROSS_SYSTEM_PROMPT
  // ============================================================

  describe('CROSS_SYSTEM_PROMPT', () => {
    it('should exist with systemAddition, userTemplate, and sections', () => {
      expect(CROSS_SYSTEM_PROMPT).toBeDefined();
      expect(CROSS_SYSTEM_PROMPT.systemAddition).toBeDefined();
      expect(CROSS_SYSTEM_PROMPT.userTemplate).toBeDefined();
      expect(CROSS_SYSTEM_PROMPT.sections).toBeDefined();
    });

    it('should have 6 cross-system sections', () => {
      expect(CROSS_SYSTEM_PROMPT.sections).toEqual([
        'cross_validation',
        'bazi_perspective',
        'zwds_perspective',
        'combined_career',
        'combined_love',
        'synthesis',
      ]);
    });

    it('should mention both 八字 and 紫微 in systemAddition', () => {
      expect(CROSS_SYSTEM_PROMPT.systemAddition).toContain('八字');
      expect(CROSS_SYSTEM_PROMPT.systemAddition).toContain('紫微');
    });

    it('should contain baziData placeholder', () => {
      expect(CROSS_SYSTEM_PROMPT.userTemplate).toContain('{{baziData}}');
    });

    it('should contain ZWDS chart placeholders', () => {
      expect(CROSS_SYSTEM_PROMPT.userTemplate).toContain('{{soulStar}}');
      expect(CROSS_SYSTEM_PROMPT.userTemplate).toContain('{{fiveElementsClass}}');
      expect(CROSS_SYSTEM_PROMPT.userTemplate).toContain('{{palaceSummary}}');
    });

    it('should mention cross-validation concept (交叉驗證)', () => {
      expect(CROSS_SYSTEM_PROMPT.systemAddition).toContain('交叉');
    });
  });

  // ============================================================
  // DEEP_STAR_PROMPT
  // ============================================================

  describe('DEEP_STAR_PROMPT', () => {
    it('should exist with systemAddition, userTemplate, and sections', () => {
      expect(DEEP_STAR_PROMPT).toBeDefined();
      expect(DEEP_STAR_PROMPT.systemAddition).toBeDefined();
      expect(DEEP_STAR_PROMPT.userTemplate).toBeDefined();
      expect(DEEP_STAR_PROMPT.sections).toBeDefined();
    });

    it('should have 6 deep star sections', () => {
      expect(DEEP_STAR_PROMPT.sections).toEqual([
        'pattern_analysis',
        'palace_deep_dive',
        'star_chains',
        'mutagen_analysis',
        'special_formations',
        'life_strategy',
      ]);
    });

    it('should mention 四化飛星 (Flying Star Transformations)', () => {
      expect(DEEP_STAR_PROMPT.systemAddition).toContain('四化飛星');
    });

    it('should mention special formations (格局)', () => {
      expect(DEEP_STAR_PROMPT.systemAddition).toContain('格局');
    });

    it('should mention star brightness (亮度) and 煞星', () => {
      expect(DEEP_STAR_PROMPT.systemAddition).toContain('亮度');
      expect(DEEP_STAR_PROMPT.systemAddition).toContain('煞星');
    });

    it('should contain palace summary placeholder', () => {
      expect(DEEP_STAR_PROMPT.userTemplate).toContain('{{palaceSummary}}');
    });

    it('should contain natal mutagen placeholder', () => {
      expect(DEEP_STAR_PROMPT.userTemplate).toContain('{{natalMutagen}}');
    });
  });

  // ============================================================
  // All Phase 8B prompts — shared assertions
  // ============================================================

  describe('All Phase 8B prompts — shared structure', () => {
    const phase8bTypes = ['ZWDS_MONTHLY', 'ZWDS_DAILY', 'ZWDS_MAJOR_PERIOD', 'ZWDS_QA'];

    for (const type of phase8bTypes) {
      it(`${type} sections should all be non-empty strings`, () => {
        for (const section of ZWDS_READING_PROMPTS[type].sections) {
          expect(typeof section).toBe('string');
          expect(section.length).toBeGreaterThan(0);
        }
      });
    }

    it('all Phase 8B prompts should contain Traditional Chinese characters', () => {
      for (const type of phase8bTypes) {
        const combined =
          ZWDS_READING_PROMPTS[type].systemAddition +
          ZWDS_READING_PROMPTS[type].userTemplate;
        // Traditional Chinese check: should contain at least one CJK character
        expect(combined).toMatch(/[\u4e00-\u9fff]/);
      }
    });

    it('CROSS_SYSTEM_PROMPT should contain Traditional Chinese', () => {
      const combined = CROSS_SYSTEM_PROMPT.systemAddition + CROSS_SYSTEM_PROMPT.userTemplate;
      expect(combined).toMatch(/[\u4e00-\u9fff]/);
    });

    it('DEEP_STAR_PROMPT should contain Traditional Chinese', () => {
      const combined = DEEP_STAR_PROMPT.systemAddition + DEEP_STAR_PROMPT.userTemplate;
      expect(combined).toMatch(/[\u4e00-\u9fff]/);
    });
  });
});
