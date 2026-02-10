import {
  ZWDS_BASE_SYSTEM_PROMPT,
  ZWDS_READING_PROMPTS,
  OUTPUT_FORMAT_INSTRUCTIONS,
} from '../src/ai/prompts';

describe('ZWDS Prompts', () => {
  // ============================================================
  // ZWDS_BASE_SYSTEM_PROMPT — expert persona and constraints
  // ============================================================

  describe('ZWDS_BASE_SYSTEM_PROMPT', () => {
    it('should be in Traditional Chinese', () => {
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('繁體中文');
    });

    it('should mention 紫微斗數', () => {
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('紫微斗數');
    });

    it('should mention 全書派 (Chen Xi-Yi school)', () => {
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('全書派');
    });

    it('should instruct JSON output', () => {
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('JSON');
    });

    it('should mention star brightness levels (廟 and 陷)', () => {
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('廟');
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('陷');
    });

    it('should mention Four Transformations (化祿 and 化忌)', () => {
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('化祿');
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('化忌');
    });

    it('should mention 宮位 (palaces)', () => {
      expect(ZWDS_BASE_SYSTEM_PROMPT).toContain('宮');
    });

    it('should be substantially long (expert persona)', () => {
      expect(ZWDS_BASE_SYSTEM_PROMPT.length).toBeGreaterThan(200);
    });

    it('should be different from a Bazi prompt (not contain 八字 as primary focus)', () => {
      // The ZWDS base prompt should focus on 紫微, not 八字
      // It might mention 八字 in passing but 紫微斗數 should appear more often
      const zwdsCount = (ZWDS_BASE_SYSTEM_PROMPT.match(/紫微/g) || []).length;
      expect(zwdsCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // ZWDS_READING_PROMPTS — all 6 reading types
  // ============================================================

  describe('ZWDS_READING_PROMPTS', () => {
    const zwdsTypes = [
      'ZWDS_LIFETIME',
      'ZWDS_ANNUAL',
      'ZWDS_CAREER',
      'ZWDS_LOVE',
      'ZWDS_HEALTH',
      'ZWDS_COMPATIBILITY',
    ];

    // --- Completeness: all 6 types exist ---

    it('should have prompts for all 6 ZWDS reading types', () => {
      for (const type of zwdsTypes) {
        expect(ZWDS_READING_PROMPTS[type]).toBeDefined();
      }
    });

    it('should not have prompts for Bazi reading types', () => {
      expect(ZWDS_READING_PROMPTS['LIFETIME']).toBeUndefined();
      expect(ZWDS_READING_PROMPTS['ANNUAL']).toBeUndefined();
      expect(ZWDS_READING_PROMPTS['CAREER']).toBeUndefined();
    });

    // --- Structure: each type has required fields ---

    for (const type of zwdsTypes) {
      describe(`${type}`, () => {
        it('should have systemAddition, userTemplate, and sections', () => {
          const config = ZWDS_READING_PROMPTS[type];
          expect(config.systemAddition).toBeDefined();
          expect(config.userTemplate).toBeDefined();
          expect(config.sections).toBeDefined();
        });

        it('systemAddition should be substantial (>50 chars)', () => {
          expect(ZWDS_READING_PROMPTS[type].systemAddition.length).toBeGreaterThan(50);
        });

        it('userTemplate should be substantial (>50 chars)', () => {
          expect(ZWDS_READING_PROMPTS[type].userTemplate.length).toBeGreaterThan(50);
        });

        it('should have at least 4 sections', () => {
          expect(ZWDS_READING_PROMPTS[type].sections.length).toBeGreaterThanOrEqual(4);
        });

        it('sections should be non-empty strings', () => {
          for (const section of ZWDS_READING_PROMPTS[type].sections) {
            expect(typeof section).toBe('string');
            expect(section.length).toBeGreaterThan(0);
          }
        });
      });
    }

    // --- ZWDS_LIFETIME specific ---

    describe('ZWDS_LIFETIME sections', () => {
      it('should have personality, life_pattern, major_periods, overall_destiny', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_LIFETIME.sections).toEqual([
          'personality',
          'life_pattern',
          'major_periods',
          'overall_destiny',
        ]);
      });
    });

    // --- ZWDS_ANNUAL specific ---

    describe('ZWDS_ANNUAL sections', () => {
      it('should have annual-specific sections', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_ANNUAL.sections).toContain('annual_overview');
        expect(ZWDS_READING_PROMPTS.ZWDS_ANNUAL.sections).toContain('monthly_forecast');
      });
    });

    // --- ZWDS_CAREER palace focus ---

    describe('ZWDS_CAREER palace focus', () => {
      it('should focus on career-related palaces (事業宮, 財帛宮, 遷移宮)', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_CAREER.systemAddition).toContain('事業宮');
        expect(ZWDS_READING_PROMPTS.ZWDS_CAREER.systemAddition).toContain('財帛宮');
        expect(ZWDS_READING_PROMPTS.ZWDS_CAREER.systemAddition).toContain('遷移宮');
      });

      it('should mention 三方四正', () => {
        // Career analysis should reference the triangular palace relationship
        const text = ZWDS_READING_PROMPTS.ZWDS_CAREER.systemAddition + ZWDS_READING_PROMPTS.ZWDS_CAREER.userTemplate;
        expect(text).toContain('三方四正');
      });
    });

    // --- ZWDS_LOVE palace focus ---

    describe('ZWDS_LOVE palace focus', () => {
      it('should focus on relationship palaces (夫妻宮)', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_LOVE.systemAddition).toContain('夫妻宮');
      });

      it('should mention 桃花星 (peach blossom stars)', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_LOVE.systemAddition).toContain('桃花星');
      });
    });

    // --- ZWDS_HEALTH specific ---

    describe('ZWDS_HEALTH specific', () => {
      it('should focus on health palace (疾厄宮)', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_HEALTH.systemAddition).toContain('疾厄宮');
      });

      it('should mention 五行局', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_HEALTH.systemAddition).toContain('五行局');
      });

      it('should include medical disclaimer (不是醫生)', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_HEALTH.systemAddition).toContain('不是醫生');
      });
    });

    // --- ZWDS_COMPATIBILITY specific ---

    describe('ZWDS_COMPATIBILITY specific', () => {
      it('should support all comparison types (ROMANCE, BUSINESS, FRIENDSHIP)', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_COMPATIBILITY.systemAddition).toContain('ROMANCE');
        expect(ZWDS_READING_PROMPTS.ZWDS_COMPATIBILITY.systemAddition).toContain('BUSINESS');
        expect(ZWDS_READING_PROMPTS.ZWDS_COMPATIBILITY.systemAddition).toContain('FRIENDSHIP');
      });

      it('should have dual-chart placeholders in template', () => {
        const template = ZWDS_READING_PROMPTS.ZWDS_COMPATIBILITY.userTemplate;
        expect(template).toContain('{{lifePalaceDataA}}');
        expect(template).toContain('{{lifePalaceDataB}}');
      });
    });

    // --- Template placeholders ---

    describe('Template placeholders', () => {
      it('ZWDS_LIFETIME should contain palace data placeholders', () => {
        const template = ZWDS_READING_PROMPTS.ZWDS_LIFETIME.userTemplate;
        expect(template).toContain('{{lifePalaceData}}');
        expect(template).toContain('{{allPalacesData}}');
      });

      it('ZWDS_LIFETIME should contain ZWDS-specific data placeholders', () => {
        const template = ZWDS_READING_PROMPTS.ZWDS_LIFETIME.userTemplate;
        expect(template).toContain('{{fiveElementsClass}}');
        expect(template).toContain('{{soulStar}}');
        expect(template).toContain('{{bodyStar}}');
      });

      it('ZWDS_CAREER should contain career palace placeholder', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_CAREER.userTemplate).toContain('{{careerPalaceData}}');
      });

      it('ZWDS_LOVE should contain spouse palace placeholder', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_LOVE.userTemplate).toContain('{{spousePalaceData}}');
      });

      it('ZWDS_HEALTH should contain health palace placeholder', () => {
        expect(ZWDS_READING_PROMPTS.ZWDS_HEALTH.userTemplate).toContain('{{healthPalaceData}}');
      });

      it('ZWDS_ANNUAL should contain horoscope placeholders', () => {
        const template = ZWDS_READING_PROMPTS.ZWDS_ANNUAL.userTemplate;
        expect(template).toContain('{{yearlyMutagen}}');
        expect(template).toContain('{{currentDecadal}}');
      });

      it('all single reading templates should have {{gender}} placeholder', () => {
        const singleTypes = ['ZWDS_LIFETIME', 'ZWDS_ANNUAL', 'ZWDS_CAREER', 'ZWDS_LOVE', 'ZWDS_HEALTH'];
        for (const type of singleTypes) {
          expect(ZWDS_READING_PROMPTS[type].userTemplate).toContain('{{gender}}');
        }
      });

      it('single reading templates should have {{solarDate}} placeholder', () => {
        const singleTypes = ['ZWDS_LIFETIME', 'ZWDS_ANNUAL', 'ZWDS_CAREER', 'ZWDS_LOVE', 'ZWDS_HEALTH'];
        for (const type of singleTypes) {
          expect(ZWDS_READING_PROMPTS[type].userTemplate).toContain('{{solarDate}}');
        }
      });

      it('ZWDS_COMPATIBILITY should have person-specific placeholders instead of solarDate', () => {
        const template = ZWDS_READING_PROMPTS.ZWDS_COMPATIBILITY.userTemplate;
        // Compatibility has dual-person data, not single birthDate/solarDate
        expect(template).toContain('{{genderA}}');
        expect(template).toContain('{{genderB}}');
        expect(template).toContain('{{fiveElementsClassA}}');
        expect(template).toContain('{{fiveElementsClassB}}');
      });
    });

    // --- No duplicate sections ---

    describe('Section uniqueness', () => {
      for (const type of zwdsTypes) {
        it(`${type} should have no duplicate sections`, () => {
          const sections = ZWDS_READING_PROMPTS[type].sections;
          const uniqueSections = new Set(sections);
          expect(uniqueSections.size).toBe(sections.length);
        });
      }
    });

    // --- Section names should be valid JSON keys ---

    describe('Section names as valid keys', () => {
      for (const type of zwdsTypes) {
        it(`${type} sections should be snake_case (valid JSON keys)`, () => {
          for (const section of ZWDS_READING_PROMPTS[type].sections) {
            expect(section).toMatch(/^[a-z][a-z0-9_]*$/);
          }
        });
      }
    });
  });

  // ============================================================
  // OUTPUT_FORMAT_INSTRUCTIONS — shared with Bazi
  // ============================================================

  describe('OUTPUT_FORMAT_INSTRUCTIONS', () => {
    it('should contain sections key', () => {
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('sections');
    });

    it('should contain preview key', () => {
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('preview');
    });

    it('should contain full key', () => {
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('full');
    });

    it('should contain summary key', () => {
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('summary');
    });

    it('should instruct JSON format', () => {
      expect(OUTPUT_FORMAT_INSTRUCTIONS).toContain('JSON');
    });
  });
});
