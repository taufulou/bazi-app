/**
 * Phase Fortune — `chat-prompt-builder.ts` FORTUNE wiring regression locks.
 *
 * Audit-fix specs covering 2 audit-found bugs (one CRITICAL, one HIGH):
 *
 * - **CRITICAL** — `isChatEnabledType` must include 'FORTUNE' so
 *   `buildChatV1SystemPromptForType('FORTUNE')` is selected over the
 *   generic Phase 1 header. Without this, all FORTUNE-specific assets
 *   (scope clause, refuse template, cross-sell lines, F-1/F-2/F-3
 *   few-shots) are silently dropped at runtime.
 *
 * - **HIGH (Issue 14)** — `interpolateFortuneV1Fields` must be CALLED
 *   from `buildPrompt` so day-pillar TRANSIENT doctrine (傷官見官 valence,
 *   比劫奪財 valence, 沖日支, 紅鸞, 配偶星透干, 官殺日) reaches the AI as
 *   deterministic Chinese sentences. Defined-but-unwired = Phase 12h.B
 *   doctrine drift in production.
 *
 * Both bugs would silently pass the existing `prompts.fortune.spec.ts`
 * (which only tests `buildChatV1SystemPromptForType` + `interpolateFortuneV1Fields`
 * in ISOLATION, not through the assembly pipeline). These specs lock the
 * assembled output.
 */
import type { ChatContext } from './chat-context.service';
import { buildPrompt } from './chat-prompt-builder';

function mkCtx(extras: Partial<ChatContext> = {}): ChatContext {
  return {
    chart: { fourPillars: {} },
    doctrineFlags: {},
    doctrineInjectors: {},
    ...extras,
  };
}

describe('chat-prompt-builder — Phase Fortune wiring', () => {
  // ============================================================
  // CRITICAL — isChatEnabledType FORTUNE inclusion
  // ============================================================

  describe('FORTUNE per-type prompt header selection (CRITICAL audit fix)', () => {
    it('assembles FORTUNE-specific scope clause when readingType=FORTUNE', () => {
      const ctx = mkCtx();
      const { systemPromptText } = buildPrompt({
        chatContext: ctx,
        recentMessages: [],
        newUserMessage: '今天適合告白嗎？',
        readingType: 'FORTUNE',
        shouldInjectRegrounding: false,
      });
      expect(systemPromptText).toContain('《八字日運》');
    });

    it('assembles FORTUNE refuse template + cross-sell lines when readingType=FORTUNE', () => {
      const { systemPromptText } = buildPrompt({
        chatContext: mkCtx(),
        recentMessages: [],
        newUserMessage: '我命格如何？',
        readingType: 'FORTUNE',
        shouldInjectRegrounding: false,
      });
      expect(systemPromptText).toContain('【跨主題拒絕模板】');
      expect(systemPromptText).toContain('【跨閱讀引導語句');
      // 4 cross-sell targets (NO self-reference)
      expect(systemPromptText).toContain('lifetime →');
      expect(systemPromptText).toContain('love →');
      expect(systemPromptText).toContain('career →');
      expect(systemPromptText).toContain('annual →');
    });

    it('assembles FORTUNE F-1, F-2, F-3 refuse few-shots', () => {
      const { systemPromptText } = buildPrompt({
        chatContext: mkCtx(),
        recentMessages: [],
        newUserMessage: '今天能量為什麼這麼低？',
        readingType: 'FORTUNE',
        shouldInjectRegrounding: false,
      });
      expect(systemPromptText).toContain('範例 F-1');
      expect(systemPromptText).toContain('範例 F-2');
      expect(systemPromptText).toContain('範例 F-3');
    });

    it('falls back to generic Phase 1 header when readingType is undefined', () => {
      // Verify the non-FORTUNE path is unchanged — backward compat lock
      const { systemPromptText } = buildPrompt({
        chatContext: mkCtx(),
        recentMessages: [],
        newUserMessage: 'hello',
        readingType: undefined,
        shouldInjectRegrounding: false,
      });
      // Should NOT contain FORTUNE-specific sections
      expect(systemPromptText).not.toContain('《八字日運》');
      expect(systemPromptText).not.toContain('範例 F-1');
    });

    it('does NOT regress LIFETIME / LOVE / CAREER / ANNUAL / COMPATIBILITY assembly', () => {
      for (const type of ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'] as const) {
        const { systemPromptText } = buildPrompt({
          chatContext: mkCtx(),
          recentMessages: [],
          newUserMessage: 'test',
          readingType: type,
          shouldInjectRegrounding: false,
        });
        // None of the non-FORTUNE prompts should contain FORTUNE-specific assets
        expect(systemPromptText).not.toContain('《八字日運》');
        expect(systemPromptText).not.toContain('範例 F-1');
      }
    });
  });

  // ============================================================
  // HIGH (Issue 14) — interpolateFortuneV1Fields wired into buildPrompt
  // ============================================================

  describe('interpolateFortuneV1Fields wired into FORTUNE prompt (Issue 14)', () => {
    it('emits day-pillar TRANSIENT doctrine block when FORTUNE chatContext has dim signals', () => {
      const ctx = mkCtx({
        dailyFortune: {
          dayGanZhi: '戊子',
          dimensions: {
            career: {
              score: 60,
              label: 'beneficial',
              signals: [
                {
                  type: 'shangguan_jian_guan_transient',
                  valence: 'beneficial',
                  narrative: '正官為忌神，傷官制官有利',
                },
              ],
            },
          },
        },
      });
      const { systemPromptText } = buildPrompt({
        chatContext: ctx,
        recentMessages: [],
        newUserMessage: '今天事業如何？',
        readingType: 'FORTUNE',
        shouldInjectRegrounding: false,
      });
      // The pre-formatted Chinese sentence MUST appear in the system prompt
      expect(systemPromptText).toContain('【今日流日教義事件 — 必須引用以下文字】');
      expect(systemPromptText).toContain('今日 戊子 日触發 傷官見官 流日');
      expect(systemPromptText).toContain('反吉');
    });

    it('does NOT emit the day-pillar block when no signals match injector types', () => {
      const ctx = mkCtx({
        dailyFortune: {
          dayGanZhi: '戊子',
          dimensions: {
            romance: { score: 50, label: 'neutral', signals: [] },
          },
        },
      });
      const { systemPromptText } = buildPrompt({
        chatContext: ctx,
        recentMessages: [],
        newUserMessage: 'test',
        readingType: 'FORTUNE',
        shouldInjectRegrounding: false,
      });
      expect(systemPromptText).not.toContain('【今日流日教義事件');
    });

    it('does NOT emit the day-pillar block for non-FORTUNE readingTypes (gate works)', () => {
      // Even with `dailyFortune` present (which shouldn't happen for non-FORTUNE
      // chat-context, but defensively), the gate must prevent injection.
      const ctx = mkCtx({
        dailyFortune: {
          dayGanZhi: '戊子',
          dimensions: {
            career: {
              score: 60,
              signals: [
                { type: 'shangguan_jian_guan_transient', valence: 'beneficial' },
              ],
            },
          },
        },
      });
      const { systemPromptText } = buildPrompt({
        chatContext: ctx,
        recentMessages: [],
        newUserMessage: 'test',
        readingType: 'LIFETIME',
        shouldInjectRegrounding: false,
      });
      expect(systemPromptText).not.toContain('【今日流日教義事件');
    });
  });
});
