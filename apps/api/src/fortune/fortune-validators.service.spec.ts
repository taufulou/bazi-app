/**
 * Tests for FortuneValidatorsService — anti-drift Debt D.
 *
 * Verifies the audit fixes from this session:
 *   - C2: deep clone (no mutation of caller's narrative.daily_advice)
 *   - I2: tightened folk-content regex (no false positive on 用神 element direction)
 *   - I3: daily_advice list items scanned for forbidden folk content
 * And the pre-existing behavior (banned phrase strip, soft-trigger framing).
 */
import { FortuneValidatorsService } from './fortune-validators.service';

describe('FortuneValidatorsService', () => {
  let service: FortuneValidatorsService;
  const SOFT_TRIGGER = { metaFraming: 'soft_trigger' as const };

  beforeEach(() => {
    service = new FortuneValidatorsService();
  });

  describe('banned absolute phrases', () => {
    it('strips 一定/必/絕對 and emits an error finding', () => {
      const narrative = {
        daily_overview: '今天一定會發生好事',
        daily_romance: '今日易於社交',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      expect(r.passed).toBe(false);
      expect(r.findings.find(f => f.type === 'banned_absolute_phrase')).toBeDefined();
      expect((r.sanitized as Record<string, string>).daily_overview).not.toContain('一定');
    });

    it('scans daily_advice list items for banned phrases (I3)', () => {
      const narrative = {
        daily_overview: '今日宜穩步',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: {
          canTry: ['今日易於處理庶務'],
          shouldHold: ['必然不宜重大簽約'],
        },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      expect(r.passed).toBe(false);
      expect(
        r.findings.find(f => f.section === 'daily_advice.shouldHold'),
      ).toBeDefined();
      const sanitizedAdvice = (r.sanitized as Record<string, unknown>).daily_advice as Record<string, string[]>;
      expect(sanitizedAdvice.shouldHold[0]).not.toContain('必然');
    });
  });

  describe('forbidden folk content (Phase 1)', () => {
    it('rejects fabricated 幸運數字', () => {
      const narrative = {
        daily_overview: '今日幸運數字為 7',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      expect(
        r.findings.find(f => f.type === 'forbidden_folk_content' && f.detail.includes('lucky_number')),
      ).toBeDefined();
    });

    it('rejects fabricated 食物建議', () => {
      const narrative = {
        daily_overview: '今日宜吃 X 食物',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      expect(
        r.findings.find(f => f.type === 'forbidden_folk_content' && f.detail.includes('food_advice')),
      ).toBeDefined();
    });

    it('DOES NOT false-positive on legitimate 用神 element direction narrative (I2 audit fix)', () => {
      // Pre-fix: `今日宜.{0,3}色` matched `今日宜土色方位` (false positive).
      // Post-fix: requires `穿/穿著/幸運色/吉祥色` qualifier.
      const narrative = {
        daily_overview: '您的用神為土，今日宜土色方位（南方）',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      expect(
        r.findings.find(f => f.type === 'forbidden_folk_content'),
      ).toBeUndefined();
    });

    it('rejects fabricated folk content inside daily_advice list (I3 audit fix)', () => {
      const narrative = {
        daily_overview: '今日宜穩',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: {
          canTry: ['今日宜吃黃色食物'],
          shouldHold: [],
        },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      const folkFinding = r.findings.find(
        f => f.type === 'forbidden_folk_content' && f.section === 'daily_advice.canTry',
      );
      expect(folkFinding).toBeDefined();
    });

    it('rejects fabricated 吉時 narrative', () => {
      const narrative = {
        daily_overview: '今日吉時為 上午 8 點',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      expect(
        r.findings.find(f => f.type === 'forbidden_folk_content' && f.detail.includes('auspicious_hour')),
      ).toBeDefined();
    });
  });

  describe('deep-clone behavior (C2 audit fix)', () => {
    it('does NOT mutate caller-supplied narrative.daily_advice', () => {
      const narrative = {
        daily_overview: '今日宜穩',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: {
          canTry: ['今日一定有好事'],  // banned phrase
          shouldHold: [],
        },
      };
      const originalCanTry = narrative.daily_advice.canTry;
      service.validate(narrative, SOFT_TRIGGER);
      // The caller's array reference must be unchanged
      expect(originalCanTry[0]).toBe('今日一定有好事');
      expect(narrative.daily_advice.canTry).toBe(originalCanTry);
    });
  });

  describe('soft-trigger framing presence', () => {
    it('warns when narrative lacks 今日宜/易於/適合 opener under soft_trigger meta', () => {
      const narrative = {
        // > 30 chars with no soft-trigger opener — validator should warn
        daily_overview: '這是一段相當長的命理敘述描寫了今天會發生的諸多事情但是完全沒有使用條件式表達語氣',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      expect(
        r.findings.find(f => f.type === 'no_soft_trigger_opener'),
      ).toBeDefined();
    });

    it('passes when narrative uses 今日宜 framing', () => {
      const narrative = {
        daily_overview: '今日宜把握表達自我的機會，避免衝動決定',
        daily_romance: '今日易於社交，宜以對話化解張力',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = service.validate(narrative, SOFT_TRIGGER);
      expect(
        r.findings.find(f => f.type === 'no_soft_trigger_opener'),
      ).toBeUndefined();
    });
  });

  describe('null narrative pass-through', () => {
    it('returns passed=true with empty sanitized when narrative is null', () => {
      const r = service.validate(null, SOFT_TRIGGER);
      expect(r.passed).toBe(true);
      expect(r.sanitized).toEqual({});
      expect(r.findings).toHaveLength(0);
    });
  });

  // ============================================================
  // UX Sprint R1.4 — takeaway + bold marker presence + sanitization
  // ============================================================
  describe('R1.4 — per-dim takeaway + bold markers', () => {
    const completeNarrative = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      daily_overview: '今日宜以平常心面對。',
      daily_romance: '感情層面有 **桃花星** 觸動，今日宜主動聯繫。',
      daily_romance_takeaway: '今日宜主動聯繫',
      daily_career: '事業層面 **沖月柱**，今日宜謹慎。',
      daily_career_takeaway: '今日宜謹慎決策',
      daily_finance: '財運平穩 **比劫奪財有益**，今日宜守不宜進。',
      daily_finance_takeaway: '今日宜守不宜進',
      daily_travel: '出行 **沖日支**，今日宜短程。',
      daily_travel_takeaway: '今日宜短程',
      daily_health: '健康 **木氣偏旺**，今日宜養筋骨。',
      daily_health_takeaway: '今日宜養筋骨',
      daily_advice: { canTry: [], shouldHold: [] },
      ...overrides,
    });

    it('emits no findings when all 5 takeaways + bold markers present', () => {
      const r = service.validate(completeNarrative(), SOFT_TRIGGER);
      expect(
        r.findings.filter(f => f.type === 'missing_takeaway'),
      ).toHaveLength(0);
      expect(
        r.findings.filter(f => f.type === 'missing_bold_markers'),
      ).toHaveLength(0);
    });

    it('emits missing_takeaway finding when takeaway field omitted', () => {
      const r = service.validate(
        completeNarrative({ daily_romance_takeaway: '' }),
        SOFT_TRIGGER,
      );
      const finding = r.findings.find(
        f => f.type === 'missing_takeaway' && f.section === 'daily_romance_takeaway',
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('warn');
      // Doesn't block response (warn-only)
      expect(r.passed).toBe(true);
    });

    it('emits missing_bold_markers finding when narrative has no ** markers', () => {
      const r = service.validate(
        completeNarrative({ daily_career: '事業層面平穩，今日宜謹慎。' }),
        SOFT_TRIGGER,
      );
      const finding = r.findings.find(
        f => f.type === 'missing_bold_markers' && f.section === 'daily_career',
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('warn');
    });

    it('emits unbalanced_bold_markers finding + strips lone marker', () => {
      const r = service.validate(
        completeNarrative({ daily_romance: '感情層面 **桃花星 觸動，今日宜主動聯繫。' }),
        SOFT_TRIGGER,
      );
      const finding = r.findings.find(
        f => f.type === 'unbalanced_bold_markers' && f.section === 'daily_romance',
      );
      expect(finding).toBeDefined();
      // Lone ** stripped from sanitized output
      const sanitizedRomance = (r.sanitized as Record<string, string>).daily_romance;
      expect((sanitizedRomance.match(/\*\*/g) || []).length % 2).toBe(0);
    });

    it('preserves banned-phrase sanitization order — bold scope survives banned replacement (Round-2 N5)', () => {
      // AI emits banned phrase wrapped in bold; sanitization should:
      //   1. Strip lone marker if odd (n/a here — balanced)
      //   2. Replace 「一定」 with 「易於」
      //   3. Result: bold scope semantically still makes sense
      const r = service.validate(
        completeNarrative({ daily_romance: '今日感情 **一定發生** 變化。' }),
        SOFT_TRIGGER,
      );
      const sanitizedRomance = (r.sanitized as Record<string, string>).daily_romance;
      // Banned phrase replaced
      expect(sanitizedRomance).not.toContain('一定');
      expect(sanitizedRomance).toContain('易於');
      // Bold scope preserved
      expect(sanitizedRomance).toContain('**');
      // Finding emitted for banned phrase
      expect(
        r.findings.find(f => f.type === 'banned_absolute_phrase'),
      ).toBeDefined();
    });
  });
});
