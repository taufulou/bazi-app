/**
 * Phase Fortune — prompts.ts FORTUNE block regression-lock specs.
 * Covers:
 * - MC-2: FORTUNE refuse template prefix literally matches
 *   CHAT_V1_TOPIC_REFUSE_OPENING_REGEX (so `consecutiveRefuses` counter
 *   increments and 5+ soft-warning fires correctly).
 * - CHAT_FORTUNE_REFUSE_FEW_SHOTS F-1, F-2, F-3 are present and textually
 *   distinguishable (load-bearing for the hybrid refuse policy).
 * - CHAT_CROSS_SELL_LINES.FORTUNE has the 4 non-self-reference targets.
 * - buildChatV1SystemPromptForType assembles a FORTUNE prompt that
 *   includes scope + refuse template + few-shots + cross-sell lines.
 */
import {
  CHAT_V1_TOPIC_REFUSE_OPENING_REGEX,
  CHAT_TOPIC_SCOPE_BY_READING_TYPE,
  CHAT_REFUSE_TEMPLATE_BY_READING_TYPE,
  CHAT_CROSS_SELL_LINES,
  CHAT_FORTUNE_REFUSE_FEW_SHOTS,
  buildChatV1SystemPromptForType,
} from './prompts';

describe('prompts.ts — Phase Fortune blocks', () => {
  // ============================================================
  // MC-2 — refuse-opening regex match
  // ============================================================

  describe('CHAT_V1_TOPIC_REFUSE_OPENING_REGEX matches FORTUNE refuse template', () => {
    it('F-1 standard refuse opening matches regex', () => {
      // The literal text from the F-1 few-shot
      const f1Opening =
        '謝謝您的提問。關於命格定性與終身格局的詳細分析，超出本《八字日運》解讀的範圍——';
      expect(CHAT_V1_TOPIC_REFUSE_OPENING_REGEX.test(f1Opening)).toBe(true);
    });

    it('FORTUNE refuse template body contains the regex-matchable prefix shape', () => {
      const template = CHAT_REFUSE_TEMPLATE_BY_READING_TYPE.FORTUNE;
      expect(template).not.toBeNull();
      // The template includes the literal pattern with placeholders, e.g.:
      // 「謝謝您的提問。關於[該領域]的詳細分析，超出本《八字日運》解讀的範圍——」
      // Substitute the placeholder with a sample topic to test regex match.
      const filled = template!.replace('[該領域]', '命格');
      // Check the rendered opening matches
      const opening = filled.match(
        /謝謝您的提問。關於.{1,30}的詳細.{0,15}分析，超出本《八字日運》解讀的範圍/,
      );
      expect(opening).not.toBeNull();
    });

    it('matches LIFETIME/LOVE/CAREER/ANNUAL/COMPATIBILITY style openers too (regex is generic)', () => {
      // Backwards-compat sanity — adding 《八字日運》 must NOT break the
      // existing 5 reading types' refuse detection.
      const samples = [
        '謝謝您的提問。關於配偶的詳細分析，超出本《八字愛情姻緣》解讀的範圍——',
        '謝謝您的提問。關於行業的詳細分析，超出本《八字事業詳批》解讀的範圍——',
        '謝謝您的提問。關於命格的詳細分析，超出本《八字終身運》解讀的範圍——',
      ];
      for (const s of samples) {
        expect(CHAT_V1_TOPIC_REFUSE_OPENING_REGEX.test(s)).toBe(true);
      }
    });
  });

  // ============================================================
  // FORTUNE refuse template + scope + cross-sell map
  // ============================================================

  describe('CHAT_TOPIC_SCOPE_BY_READING_TYPE.FORTUNE', () => {
    it('exists and is non-empty', () => {
      expect(CHAT_TOPIC_SCOPE_BY_READING_TYPE.FORTUNE).toBeDefined();
      expect(CHAT_TOPIC_SCOPE_BY_READING_TYPE.FORTUNE.length).toBeGreaterThan(200);
    });

    it('mentions hybrid refuse policy (today vs chart/multi-day)', () => {
      const scope = CHAT_TOPIC_SCOPE_BY_READING_TYPE.FORTUNE;
      expect(scope).toContain('八字日運');
      expect(scope).toContain('今日'); // in-topic anchor
      expect(scope).toContain('範疇外'); // out-of-topic boundary
    });

    it('includes load-bearing doctrine (soft-trigger framing)', () => {
      const scope = CHAT_TOPIC_SCOPE_BY_READING_TYPE.FORTUNE;
      expect(scope).toContain('TRIGGER'); // 流日 trigger doctrine
      expect(scope).toContain('soft-trigger');
      expect(scope).toMatch(/(今日宜|今日易於|今日適合)/);
    });

    it('forbids absolute language', () => {
      const scope = CHAT_TOPIC_SCOPE_BY_READING_TYPE.FORTUNE;
      // The scope clause LISTS forbidden words (so they appear); just
      // confirm the prohibition is present.
      expect(scope).toContain('禁止');
    });

    it('forbids fabricated folk content (色/數字/食物/吉時)', () => {
      const scope = CHAT_TOPIC_SCOPE_BY_READING_TYPE.FORTUNE;
      expect(scope).toMatch(/吉色|幸運數字|宜吃|吉時/);
    });
  });

  describe('CHAT_REFUSE_TEMPLATE_BY_READING_TYPE.FORTUNE', () => {
    it('exists (not null — FORTUNE refuses out-of-topic)', () => {
      expect(CHAT_REFUSE_TEMPLATE_BY_READING_TYPE.FORTUNE).not.toBeNull();
    });

    it('contains the regex-matchable prefix structure', () => {
      const t = CHAT_REFUSE_TEMPLATE_BY_READING_TYPE.FORTUNE!;
      expect(t).toContain('謝謝您的提問。關於[該領域]的詳細分析，超出本《八字日運》解讀的範圍——');
    });

    it('preserves {crossSellTarget} + {crossSellPivotHint} placeholders', () => {
      const t = CHAT_REFUSE_TEMPLATE_BY_READING_TYPE.FORTUNE!;
      expect(t).toContain('{crossSellTarget}');
      expect(t).toContain('{crossSellPivotHint}');
    });

    it('mentions the hybrid F-2 cite-today-first rule', () => {
      const t = CHAT_REFUSE_TEMPLATE_BY_READING_TYPE.FORTUNE!;
      expect(t).toContain('hybrid refuse');
      expect(t).toContain('先 cite');
    });
  });

  describe('CHAT_CROSS_SELL_LINES.FORTUNE', () => {
    it('has 4 cross-sell targets (lifetime / love / career / annual)', () => {
      const lines = CHAT_CROSS_SELL_LINES.FORTUNE;
      expect(lines).toBeDefined();
      expect(Object.keys(lines).sort()).toEqual([
        'annual',
        'career',
        'lifetime',
        'love',
      ]);
    });

    it('does NOT contain a self-reference (fortune → fortune)', () => {
      const lines = CHAT_CROSS_SELL_LINES.FORTUNE;
      expect(lines).not.toHaveProperty('fortune');
      // Also: no line text should mention 「日運」 in self-promotion form
      for (const text of Object.values(lines)) {
        expect(text).not.toContain('日運');
      }
    });

    it('all 4 lines mention an external reading type by full name', () => {
      const lines = CHAT_CROSS_SELL_LINES.FORTUNE;
      expect(lines.lifetime).toContain('《八字終身運》');
      expect(lines.love).toContain('《八字愛情姻緣》');
      expect(lines.career).toContain('《八字事業詳批》');
      expect(lines.annual).toContain('《八字流年運勢》');
    });
  });

  // ============================================================
  // CHAT_FORTUNE_REFUSE_FEW_SHOTS — F-1, F-2, F-3 presence
  // ============================================================

  describe('CHAT_FORTUNE_REFUSE_FEW_SHOTS', () => {
    it('contains 3 distinguishable scenarios (F-1, F-2, F-3)', () => {
      expect(CHAT_FORTUNE_REFUSE_FEW_SHOTS).toContain('範例 F-1');
      expect(CHAT_FORTUNE_REFUSE_FEW_SHOTS).toContain('範例 F-2');
      expect(CHAT_FORTUNE_REFUSE_FEW_SHOTS).toContain('範例 F-3');
    });

    it('F-1 is a pure chart-level refuse → LIFETIME', () => {
      const f1Match = CHAT_FORTUNE_REFUSE_FEW_SHOTS.match(
        /範例 F-1[\s\S]*?(?=範例 F-2)/,
      );
      expect(f1Match).not.toBeNull();
      const f1 = f1Match![0];
      expect(f1).toContain('命格如何');
      expect(f1).toContain('《八字終身運》');
    });

    it('F-2 is the load-bearing cite-today-first hybrid case → ANNUAL', () => {
      const f2Match = CHAT_FORTUNE_REFUSE_FEW_SHOTS.match(
        /範例 F-2[\s\S]*?(?=範例 F-3)/,
      );
      expect(f2Match).not.toBeNull();
      const f2 = f2Match![0];
      expect(f2).toContain('今年事業');
      expect(f2).toContain('《八字流年運勢》');
      // F-2 must answer in-topic first BEFORE the refuse prefix
      expect(f2).toContain('先答今日');
      expect(f2).toContain('hybrid refuse');
    });

    it('F-3 is the pushback case that does NOT refuse again', () => {
      const f3Match = CHAT_FORTUNE_REFUSE_FEW_SHOTS.match(/範例 F-3[\s\S]*$/);
      expect(f3Match).not.toBeNull();
      const f3 = f3Match![0];
      expect(f3).toContain('今天的能量');
      expect(f3).toContain('絕對不出現');
      expect(f3).toContain('禁止');
    });
  });

  // ============================================================
  // buildChatV1SystemPromptForType('FORTUNE') assembly
  // ============================================================

  describe('buildChatV1SystemPromptForType — FORTUNE assembly', () => {
    it('builds a prompt including scope + refuse template + cross-sell + few-shots', () => {
      const prompt = buildChatV1SystemPromptForType('FORTUNE');
      // Scope clause
      expect(prompt).toContain('【本對話範疇】');
      expect(prompt).toContain('《八字日運》');
      // Refuse template
      expect(prompt).toContain('【跨主題拒絕模板】');
      // Cross-sell lines
      expect(prompt).toContain('【跨閱讀引導語句');
      expect(prompt).toContain('lifetime →');
      expect(prompt).toContain('love →');
      expect(prompt).toContain('career →');
      expect(prompt).toContain('annual →');
      // Few-shots
      expect(prompt).toContain('【跨主題拒絕範例】');
      expect(prompt).toContain('範例 F-1');
      expect(prompt).toContain('範例 F-2');
      expect(prompt).toContain('範例 F-3');
    });

    it('does NOT regress non-FORTUNE assembly (LIFETIME / LOVE)', () => {
      const lifetime = buildChatV1SystemPromptForType('LIFETIME');
      expect(lifetime).toContain('《八字終身運》');
      // LIFETIME has no refuse template → no template section
      expect(lifetime).not.toContain('【跨主題拒絕模板】');

      const love = buildChatV1SystemPromptForType('LOVE');
      expect(love).toContain('《八字愛情姻緣》');
      expect(love).toContain('範例 L-1');
    });
  });
});
