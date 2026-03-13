/**
 * Tests for Annual V2 prompt templates and AI service methods.
 */
import { ANNUAL_V2_PROMPTS, BASE_SYSTEM_PROMPT } from '../src/ai/prompts';

describe('Annual V2 Prompts', () => {
  describe('ANNUAL_V2_PROMPTS structure', () => {
    it('should export all required fields', () => {
      expect(ANNUAL_V2_PROMPTS.systemAddition).toBeTruthy();
      expect(ANNUAL_V2_PROMPTS.userTemplateCall1).toBeTruthy();
      expect(ANNUAL_V2_PROMPTS.userTemplateCall2).toBeTruthy();
      expect(ANNUAL_V2_PROMPTS.outputFormatCall1).toBeTruthy();
      expect(ANNUAL_V2_PROMPTS.outputFormatCall2).toBeTruthy();
      expect(ANNUAL_V2_PROMPTS.call1Sections).toBeInstanceOf(Array);
      expect(ANNUAL_V2_PROMPTS.call2SectionPrefixes).toBeInstanceOf(Array);
    });

    it('should have 9 Call 1 sections', () => {
      expect(ANNUAL_V2_PROMPTS.call1Sections).toHaveLength(9);
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_overview');
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_tai_sui');
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_career');
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_finance');
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_relationships');
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_love');
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_family');
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_health');
      expect(ANNUAL_V2_PROMPTS.call1Sections).toContain('annual_dayun_context');
    });

    it('should have monthly prefix for Call 2', () => {
      expect(ANNUAL_V2_PROMPTS.call2SectionPrefixes).toContain('monthly_');
    });
  });

  describe('systemAddition', () => {
    it('should contain annual-specific instructions', () => {
      const sys = ANNUAL_V2_PROMPTS.systemAddition;
      expect(sys).toContain('流年');
      expect(sys).toContain('太歲');
    });

    it('should emphasize 流年為君 principle', () => {
      const sys = ANNUAL_V2_PROMPTS.systemAddition;
      expect(sys).toContain('流年為君');
    });
  });

  describe('Call 1 template', () => {
    it('should contain all anchor placeholders', () => {
      const tpl = ANNUAL_V2_PROMPTS.userTemplateCall1;
      const expectedPlaceholders = [
        '{{flowYearHarmony}}',
        '{{annualTaiSui}}',
        '{{dayunContext}}',
        '{{annualPillarImpacts}}',
        '{{annualLuYangRen}}',
        '{{annualCareerAnchors}}',
        '{{annualFinanceAnchors}}',
        '{{annualRelationshipAnchors}}',
        '{{annualSpousePalace}}',
        '{{annualMarriageStar}}',
        '{{annualSealStar}}',
        '{{annualHealthAnchors}}',
      ];
      for (const placeholder of expectedPlaceholders) {
        expect(tpl).toContain(placeholder);
      }
    });

    it('should contain standard chart placeholders', () => {
      const tpl = ANNUAL_V2_PROMPTS.userTemplateCall1;
      expect(tpl).toContain('{{dayMaster}}');
      expect(tpl).toContain('{{dayMasterElement}}');
    });
  });

  describe('Call 2 template', () => {
    it('should contain monthly forecast placeholders', () => {
      const tpl = ANNUAL_V2_PROMPTS.userTemplateCall2;
      expect(tpl).toContain('{{annualContextBridge}}');
      expect(tpl).toContain('{{annualMonthlyForecasts}}');
    });
  });

  describe('Output format Call 1', () => {
    it('should define sections for all Call 1 keys', () => {
      const fmt = ANNUAL_V2_PROMPTS.outputFormatCall1;
      expect(fmt).toContain('annual_overview');
      expect(fmt).toContain('annual_tai_sui');
      expect(fmt).toContain('annual_dayun_context');
      expect(fmt).toContain('annual_career');
      expect(fmt).toContain('annual_finance');
      expect(fmt).toContain('annual_relationships');
      expect(fmt).toContain('annual_love');
      expect(fmt).toContain('annual_family');
      expect(fmt).toContain('annual_health');
      expect(fmt).toContain('preview');
      expect(fmt).toContain('full');
    });
  });

  describe('Output format Call 2', () => {
    it('should define monthly_01 through monthly_12', () => {
      const fmt = ANNUAL_V2_PROMPTS.outputFormatCall2;
      for (let m = 1; m <= 12; m++) {
        const key = `monthly_${String(m).padStart(2, '0')}`;
        expect(fmt).toContain(key);
      }
    });

    it('should have full content only (no preview for monthly)', () => {
      const fmt = ANNUAL_V2_PROMPTS.outputFormatCall2;
      // Monthly sections only have "full", not "preview"
      expect(fmt).toContain('"full"');
    });
  });

  describe('BASE_SYSTEM_PROMPT compatibility', () => {
    it('should be combinable with systemAddition', () => {
      const combined = BASE_SYSTEM_PROMPT + '\n\n' + ANNUAL_V2_PROMPTS.systemAddition;
      expect(combined).toContain('命理大師');
      expect(combined).toContain('流年為君');
    });
  });
});
