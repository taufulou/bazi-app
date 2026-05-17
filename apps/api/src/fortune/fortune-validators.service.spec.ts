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

  // ============================================================
  // PR review #10 — Folk-content sentence-level strip
  // ============================================================
  describe('PR review #10 — folk-content sentence-level strip', () => {
    const completeNarrative = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      daily_overview: '今日宜以平常心面對。',
      daily_romance: '感情有桃花星觸動。',
      daily_romance_takeaway: '今日宜主動聯繫',
      daily_career: '事業沖月柱。',
      daily_career_takeaway: '今日宜謹慎',
      daily_finance: '財運平穩。',
      daily_finance_takeaway: '今日宜守',
      daily_travel: '出行沖日支。',
      daily_travel_takeaway: '今日宜短程',
      daily_health: '健康木氣偏旺。',
      daily_health_takeaway: '今日宜養筋骨',
      daily_advice: { canTry: [], shouldHold: [] },
      ...overrides,
    });

    it('strips entire sentence (not just substring) when folk content found', () => {
      const r = service.validate(
        completeNarrative({
          daily_overview: '今日宜以平常心面對。建議穿紅色衣物增運。請多加注意人際。',
        }),
        SOFT_TRIGGER,
      );
      const sanitized = (r.sanitized as Record<string, string>).daily_overview;
      // The entire sentence containing 「穿紅色」 must be GONE — including its
      // surrounding clauses, terminator, and any orphaned commas.
      expect(sanitized).not.toMatch(/紅色/);
      expect(sanitized).not.toMatch(/建議穿/);
      // The OTHER two sentences should remain intact.
      expect(sanitized).toContain('平常心');
      expect(sanitized).toContain('人際');
      // Error finding emitted
      expect(
        r.findings.find(f => f.type === 'forbidden_folk_content'),
      ).toBeDefined();
      expect(r.passed).toBe(false);
    });

    it('drops ENTIRE list item from daily_advice.canTry (no fragment left)', () => {
      const r = service.validate(
        completeNarrative({
          daily_advice: {
            canTry: ['今日宜處理庶務', '建議穿紅色衣物', '今日宜聯繫家人'],
            shouldHold: [],
          },
        }),
        SOFT_TRIGGER,
      );
      const cleaned = (r.sanitized as Record<string, any>).daily_advice.canTry as string[];
      // 3 items in → 2 items out (the folk-content item is DROPPED entirely)
      expect(cleaned).toHaveLength(2);
      expect(cleaned).not.toEqual(expect.arrayContaining([expect.stringMatching(/紅色/)]));
      // The two clean items survive
      expect(cleaned).toContain('今日宜處理庶務');
      expect(cleaned).toContain('今日宜聯繫家人');
      // Finding emitted with section path
      const f = r.findings.find(
        x => x.type === 'forbidden_folk_content' && x.section === 'daily_advice.canTry',
      );
      expect(f).toBeDefined();
    });

    it('regression: banned-phrase strip still works alongside folk-content strip', () => {
      // Single section has BOTH a banned phrase AND folk content:
      // - 「一定」 → replaced with 「易於」 (in-place substitution)
      // - 「今日宜吃...」 sentence → entire sentence stripped
      const r = service.validate(
        completeNarrative({
          daily_overview: '今日一定順利。今日宜吃水果養生。請保持平常心。',
        }),
        SOFT_TRIGGER,
      );
      const sanitized = (r.sanitized as Record<string, string>).daily_overview;
      // Banned phrase replaced
      expect(sanitized).not.toContain('一定');
      expect(sanitized).toContain('易於');
      // Folk-content sentence stripped
      expect(sanitized).not.toContain('今日宜吃');
      expect(sanitized).not.toContain('水果');
      // Untouched sentence survives
      expect(sanitized).toContain('平常心');
      // Both findings emitted
      expect(r.findings.find(f => f.type === 'banned_absolute_phrase')).toBeDefined();
      expect(r.findings.find(f => f.type === 'forbidden_folk_content')).toBeDefined();
    });

    it('folk content in daily_<dim>_takeaway is stripped (sentence-level)', () => {
      // Pull-quote takeaway field contains fabricated folk content
      const r = service.validate(
        completeNarrative({
          daily_romance_takeaway: '今日宜吃辣養運',
        }),
        SOFT_TRIGGER,
      );
      const sanitized = (r.sanitized as Record<string, string>).daily_romance_takeaway;
      // Sentence-level strip on a single-sentence field = empty string
      expect(sanitized).not.toContain('今日宜吃');
      expect(sanitized).not.toContain('辣');
      expect(
        r.findings.find(
          f => f.type === 'forbidden_folk_content' && f.section === 'daily_romance_takeaway',
        ),
      ).toBeDefined();
    });
  });

  // ============================================================
  // PR review #5 — Validator throw safety (whole-body try/catch)
  // ============================================================
  describe('PR review #5 — validator tolerates malformed inputs', () => {
    it('tolerates daily_advice.canTry being a string instead of array (no throw)', () => {
      // The pre-fix code's list-iteration assumed canTry is always an array.
      // If AI ever returns a string instead, validator must not throw.
      const malformed = {
        daily_overview: '今日宜以平常心。',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: {
          canTry: 'a single string instead of an array',
          shouldHold: [],
        },
      };
      // Must not throw
      const r = service.validate(malformed as any, SOFT_TRIGGER);
      // Returned a sanitized output (graceful degradation)
      expect(r.sanitized).toBeDefined();
    });

    it('tolerates a non-string field value (no throw)', () => {
      // AI returns a number where a string is expected (very rare but possible)
      const malformed = {
        daily_overview: 12345,  // typeof !== 'string'
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = service.validate(malformed as any, SOFT_TRIGGER);
      expect(r.sanitized).toBeDefined();
      // The non-string field is skipped (current behavior — typeof guard at start of loop)
    });

    it('returns original narrative if validator internal error is forced', () => {
      // Force a throw inside _validateUnsafe by spying on stripLoneBoldMarkers.
      const throwingService = new FortuneValidatorsService();
      jest
        .spyOn(throwingService as any, 'stripLoneBoldMarkers')
        .mockImplementation(() => {
          throw new Error('Simulated internal error');
        });

      const narrative = {
        daily_overview: '今日宜以平常心。',
        daily_romance: '',
        daily_career: '',
        daily_finance: '',
        daily_travel: '',
        daily_health: '',
        daily_advice: { canTry: [], shouldHold: [] },
      };
      const r = throwingService.validate(narrative, SOFT_TRIGGER);
      // Must not throw — returns original narrative + warn finding
      expect(r.sanitized).toBe(narrative);  // original passed through, NOT discarded
      expect(r.passed).toBe(false);
      expect(
        r.findings.find(f => f.type === 'validator_internal_error'),
      ).toBeDefined();
    });
  });
});
