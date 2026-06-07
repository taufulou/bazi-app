/**
 * Tier C — Cross-sell ownership-awareness regression specs.
 *
 * Covers the staff-reviewed contract:
 * - OWNED targets swap to CHAT_CROSS_SELL_OWNED_LINES ("you already have it");
 *   UNOWNED targets keep the original "go unlock" line.
 * - Empty owned-set → byte-identical to pre-Tier-C behavior (regression lock).
 * - All-targets-owned → block stays populated (reword, not omit).
 * - HIGH-1: the owned-nudge reaches the assembled prompt THROUGH `buildPrompt`
 *   (not just the assembler) — guards the half-implement bug class.
 * - LOW-2: the owned-nudge is spliced AFTER the «超出本《…》解讀的範圍» refuse
 *   marker, so `isTopicBoundaryRefuse` detection (+ refund logic) is unaffected.
 *
 * NOTE: assertions scope to the exact «- {target} → {line}» cross-sell block
 * entry format, because the cross-sell line TEXT also appears verbatim inside
 * refuse few-shot examples — a whole-prompt `.not.toContain(line)` would
 * false-fail. The «- {target} → » prefix is unique to the cross-sell block.
 */
import {
  buildChatV1SystemPromptForType,
  CHAT_CROSS_SELL_LINES,
  CHAT_CROSS_SELL_OWNED_LINES,
  isTopicBoundaryRefuse,
} from './prompts';
import { buildPrompt } from '../chat/chat-prompt-builder';

const entry = (target: string, line: string) => `- ${target} → ${line}`;

describe('Tier C — cross-sell ownership awareness', () => {
  describe('buildChatV1SystemPromptForType — owned-line swap', () => {
    it('empty owned-set → all original "go unlock" block entries (regression: pre-Tier-C)', () => {
      const prompt = buildChatV1SystemPromptForType('FORTUNE', 'DAY', new Set());
      for (const [target, line] of Object.entries(CHAT_CROSS_SELL_LINES.FORTUNE)) {
        expect(prompt).toContain(entry(target, line));
      }
      expect(prompt).not.toContain('您已解鎖'); // no owned-nudge leaks in
      expect(prompt).not.toContain('標記為「您已解鎖」'); // no owned-mode header
    });

    it('owned lifetime → block entry reworded; love/career/annual block entries stay original', () => {
      const prompt = buildChatV1SystemPromptForType('FORTUNE', 'DAY', new Set(['lifetime']));
      expect(prompt).toContain(entry('lifetime', CHAT_CROSS_SELL_OWNED_LINES.lifetime));
      expect(prompt).not.toContain(entry('lifetime', CHAT_CROSS_SELL_LINES.FORTUNE.lifetime));
      expect(prompt).toContain(entry('love', CHAT_CROSS_SELL_LINES.FORTUNE.love));
      expect(prompt).toContain(entry('career', CHAT_CROSS_SELL_LINES.FORTUNE.career));
      expect(prompt).toContain(entry('annual', CHAT_CROSS_SELL_LINES.FORTUNE.annual));
      expect(prompt).toContain('標記為「您已解鎖」'); // owned-mode header present
    });

    it('all-4-owned → every block entry is the owned-nudge (reword, not omit)', () => {
      const prompt = buildChatV1SystemPromptForType(
        'FORTUNE',
        'DAY',
        new Set(['lifetime', 'love', 'career', 'annual']),
      );
      for (const target of ['lifetime', 'love', 'career', 'annual'] as const) {
        expect(prompt).toContain(entry(target, CHAT_CROSS_SELL_OWNED_LINES[target]));
        expect(prompt).not.toContain(entry(target, CHAT_CROSS_SELL_LINES.FORTUNE[target]));
      }
      expect(prompt).toContain('【跨閱讀引導語句'); // block header still present (not emptied)
    });

    it('owned target original line is swapped EVERYWHERE incl. refuse few-shots (anti-anchoring)', () => {
      // The Y-1 refuse few-shot hardcodes the original lifetime cross-sell line;
      // the AI anchors on it. With lifetime owned, NO occurrence of the original
      // line may survive anywhere in the assembled header (block OR few-shot).
      const owned = buildChatV1SystemPromptForType('FORTUNE', 'DAY', new Set(['lifetime']));
      expect(owned.split(CHAT_CROSS_SELL_LINES.FORTUNE.lifetime).length - 1).toBe(0); // zero occurrences
      // And the owned-nudge appears (≥1: block + however many few-shot sites).
      expect(owned).toContain(CHAT_CROSS_SELL_OWNED_LINES.lifetime);
      // Sanity: WITHOUT ownership, the original line DOES appear in the few-shot.
      const unowned = buildChatV1SystemPromptForType('FORTUNE', 'DAY', new Set());
      expect(unowned.split(CHAT_CROSS_SELL_LINES.FORTUNE.lifetime).length - 1).toBeGreaterThanOrEqual(1);
    });

    it('works for LOVE chat too (shared mechanism)', () => {
      const love = buildChatV1SystemPromptForType('LOVE', 'DAY', new Set(['career']));
      expect(love).toContain(entry('career', CHAT_CROSS_SELL_OWNED_LINES.career));
      expect(love).not.toContain(entry('career', CHAT_CROSS_SELL_LINES.LOVE.career));
      expect(love).toContain(entry('lifetime', CHAT_CROSS_SELL_LINES.LOVE.lifetime));
    });
  });

  describe('HIGH-1 — owned-nudge reaches the prompt THROUGH buildPrompt', () => {
    const baseArgs = {
      chatContext: {} as never,
      recentMessages: [],
      newUserMessage: '今年我該怎麼把握？',
      readingType: 'FORTUNE' as const,
      fortuneScope: 'DAY' as const,
      shouldInjectRegrounding: false,
    };

    it('default (no ownedCrossSellTargets) → original block entries (current behavior)', () => {
      const { systemPromptText } = buildPrompt({ ...baseArgs });
      expect(systemPromptText).toContain(
        entry('lifetime', CHAT_CROSS_SELL_LINES.FORTUNE.lifetime),
      );
      expect(systemPromptText).not.toContain('您已解鎖');
    });

    it('ownedCrossSellTargets supplied → owned-nudge appears via buildPrompt', () => {
      const { systemPromptText } = buildPrompt({
        ...baseArgs,
        ownedCrossSellTargets: new Set(['lifetime']),
      });
      expect(systemPromptText).toContain(
        entry('lifetime', CHAT_CROSS_SELL_OWNED_LINES.lifetime),
      );
      expect(systemPromptText).not.toContain(
        entry('lifetime', CHAT_CROSS_SELL_LINES.FORTUNE.lifetime),
      );
    });
  });

  describe('LOW-2 — owned-nudge does not break refuse detection', () => {
    it('FORTUNE refuse opener still matches isTopicBoundaryRefuse', () => {
      const refuseOpening =
        '謝謝您的提問。關於命格定性與終身格局的詳細分析，超出本《八字日運》解讀的範圍——這需要結合八字格局分析。';
      expect(isTopicBoundaryRefuse(refuseOpening)).toBe(true);
    });
  });
});
