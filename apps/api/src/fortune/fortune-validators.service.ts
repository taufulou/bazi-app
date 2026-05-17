/**
 * Anti-drift validators for the Fortune AI narrative output.
 *
 * Plan: .claude/plans/ok-next-big-feature-merry-cake.md — Accuracy Assurance
 * Layer 5 (Debt D — AI narrative anti-drift validation).
 *
 * Mirrors `chat-validators.service.ts` pattern:
 *   1. Banned-phrase regex strip (一定/必/絕對/必然/百分百/etc.) — enforced
 *      server-side BEFORE returning to client. If found, log + downgrade
 *      narrative (do NOT pass to client).
 *   2. Soft-trigger framing check — narrative must use 「今日宜/今日易於/
 *      今日適合」 framing for soft-trigger content; if absent on a soft-trigger
 *      output, flag for QA.
 *   3. Anti-fabrication: forbidden topics (lucky colors / numbers / food
 *      / 吉時) NOT shipped Phase 1 — flag if AI invents them.
 */
import { Injectable, Logger } from '@nestjs/common';
import { FORTUNE_BANNED_ABSOLUTE_PHRASES } from '../ai/prompts';

export interface FortuneValidationResult {
  passed: boolean;
  findings: Array<{
    severity: 'error' | 'warn' | 'info';
    type: string;
    detail: string;
    section?: string;
  }>;
  /** Sanitized narrative — banned phrases stripped (errors only). */
  sanitized: Record<string, unknown>;
}

@Injectable()
export class FortuneValidatorsService {
  private readonly logger = new Logger(FortuneValidatorsService.name);

  /** Forbidden folk-content topic patterns — Phase 1 doesn't ship these.
   *
   *  Audit I2 tightened: the prior `今日宜.{0,3}色` regex false-positive'd
   *  on legitimate wealth-direction narratives (e.g., 用神=土 → 「今日宜土色
   *  方位」 = direction note, not a fabricated lucky-color). Restricted to
   *  patterns where the AI is structurally introducing color/number/food
   *  as a topic, not mentioning element-color in a different context.
   */
  private readonly FORBIDDEN_FOLK_PATTERNS: Array<{ pattern: RegExp; topic: string }> = [
    { pattern: /(幸運數字|吉祥數字|幸運號碼)/, topic: 'lucky_number' },
    { pattern: /(吉祥色|今日.{0,3}幸運色|今日穿著?.{0,3}色|宜穿.{0,3}色|建議穿.{0,3}色)/, topic: 'lucky_color' },
    { pattern: /(食物建議|今日宜吃|食補建議|養生食物|建議飲食|建議吃)/, topic: 'food_advice' },
    { pattern: /(今日吉時|宜在.{0,4}時辰|黃道吉時|今日.{0,3}時辰最佳)/, topic: 'auspicious_hour' },
  ];

  /** Soft-trigger opening pattern (heuristic — AI is encouraged to use these). */
  private readonly SOFT_TRIGGER_OPENERS = /今日(宜|易於|適合|傾向|有.{1,4}傾向|可考慮)/;

  /** Per-dim narrative keys to check for takeaway + bold marker presence
   *  (UX Sprint R1.4). Each requires a sibling `<key>_takeaway` field. */
  private readonly DIM_NARRATIVE_KEYS = [
    'daily_romance',
    'daily_career',
    'daily_finance',
    'daily_travel',
    'daily_health',
  ];

  /** Strip lone / mismatched `**` markdown bold markers from text.
   *
   * Per UX Sprint R1.3 + Round-2 N5 (single-pass sanitization order):
   *   1. Count `**` occurrences — if odd, mark as unbalanced
   *   2. Strip lone markers defensively (paired pairs are preserved
   *      since regex `**...**` greedy-paired match leaves none behind)
   *
   * Returns { text: cleaned text, wasUnbalanced: bool }.
   */
  private stripLoneBoldMarkers(text: string): { text: string; wasUnbalanced: boolean } {
    const markerCount = (text.match(/\*\*/g) || []).length;
    const wasUnbalanced = markerCount % 2 !== 0;
    // Greedy-paired pass first: drop pairs that span the same line.
    // Whatever lone markers remain get stripped.
    // (We don't have to actually pair-match here — frontend `parseBoldSegments`
    //  handles the pairing. We just clean truly-lone markers that would leak
    //  to the user. If even-count, the regex below removes both halves of any
    //  pair too — but `parseBoldSegments` on frontend doesn't care since it
    //  treats lone markers as no-op text. To preserve the pairs for the
    //  frontend renderer, we ONLY strip when count is odd.)
    if (!wasUnbalanced) return { text, wasUnbalanced: false };
    // Find LAST lone `**` and strip it (most likely truncation point)
    const idx = text.lastIndexOf('**');
    if (idx === -1) return { text, wasUnbalanced };
    return {
      text: text.slice(0, idx) + text.slice(idx + 2),
      wasUnbalanced,
    };
  }

  /** Validate a daily fortune AI narrative and sanitize banned phrases. */
  validate(
    narrative: Record<string, unknown> | null,
    daily: { metaFraming?: string },
  ): FortuneValidationResult {
    const findings: FortuneValidationResult['findings'] = [];

    if (!narrative) {
      return { passed: true, findings, sanitized: {} };
    }

    // Deep clone via JSON round-trip so daily_advice nested-object mutations
    // don't write back into the caller's `narrative` reference (audit C2).
    // narrative is plain-JSON-shaped (AI output) so this is safe.
    const sanitized: Record<string, unknown> = JSON.parse(JSON.stringify(narrative));

    for (const [sectionKey, raw] of Object.entries(narrative)) {
      // daily_advice has nested structure; skip deep validation here
      if (sectionKey === 'daily_advice') continue;
      if (typeof raw !== 'string') continue;

      let text = raw;

      // 0. (UX Sprint R1.4 + Round-2 N5) Strip mismatched `**` markers FIRST
      //    so bold scope is canonical before banned-phrase replacement runs.
      const { text: bareText, wasUnbalanced } = this.stripLoneBoldMarkers(text);
      text = bareText;
      if (wasUnbalanced) {
        findings.push({
          severity: 'warn',
          type: 'unbalanced_bold_markers',
          detail: 'narrative had odd `**` count — lone marker stripped',
          section: sectionKey,
        });
        this.logger.warn(
          `metric.fortune.takeaway_skip_rate type=unbalanced_bold_markers section=${sectionKey}`,
        );
      }

      // 1. Strip banned absolute phrases
      for (const banned of FORTUNE_BANNED_ABSOLUTE_PHRASES) {
        if (text.includes(banned)) {
          findings.push({
            severity: 'error',
            type: 'banned_absolute_phrase',
            detail: `forbidden phrase 「${banned}」 in section`,
            section: sectionKey,
          });
          this.logger.warn(`Fortune narrative: banned phrase 「${banned}」 in ${sectionKey}`);
          // Replace with a soft-trigger substitute
          text = text.split(banned).join('易於');
        }
      }

      // 2. Soft-trigger framing presence check (warn-only — not blocking)
      if (
        daily.metaFraming === 'soft_trigger' &&
        text.length > 30 &&
        !this.SOFT_TRIGGER_OPENERS.test(text)
      ) {
        findings.push({
          severity: 'warn',
          type: 'no_soft_trigger_opener',
          detail: 'narrative lacks 「今日宜/易於/適合」 framing — narrative may sound prescriptive',
          section: sectionKey,
        });
      }

      // 3. Forbidden folk content fabrication
      for (const { pattern, topic } of this.FORBIDDEN_FOLK_PATTERNS) {
        if (pattern.test(text)) {
          findings.push({
            severity: 'error',
            type: 'forbidden_folk_content',
            detail: `Phase 1 must not ship ${topic} — AI fabricated it`,
            section: sectionKey,
          });
          this.logger.warn(`Fortune narrative: forbidden ${topic} in ${sectionKey}`);
        }
      }

      sanitized[sectionKey] = text;
    }

    // Validate daily_advice nested structure (canTry / shouldHold lists).
    // Audit I3: list items must ALSO be scanned for forbidden folk content
    // (food/color/number/吉時), not just banned absolute phrases.
    const advice = narrative['daily_advice'];
    if (advice && typeof advice === 'object') {
      const a = advice as Record<string, unknown>;
      for (const listKey of ['canTry', 'shouldHold']) {
        const list = a[listKey];
        if (!Array.isArray(list)) continue;
        const cleaned: string[] = [];
        for (const item of list) {
          if (typeof item !== 'string') {
            cleaned.push(String(item));
            continue;
          }
          let s = item;
          for (const banned of FORTUNE_BANNED_ABSOLUTE_PHRASES) {
            if (s.includes(banned)) {
              findings.push({
                severity: 'error',
                type: 'banned_absolute_phrase',
                detail: `forbidden phrase 「${banned}」`,
                section: `daily_advice.${listKey}`,
              });
              s = s.split(banned).join('易於');
            }
          }
          // Audit I3 — same folk-content fabrication check
          for (const { pattern, topic } of this.FORBIDDEN_FOLK_PATTERNS) {
            if (pattern.test(s)) {
              findings.push({
                severity: 'error',
                type: 'forbidden_folk_content',
                detail: `Phase 1 must not ship ${topic} — AI fabricated it in list item`,
                section: `daily_advice.${listKey}`,
              });
              this.logger.warn(
                `Fortune narrative: forbidden ${topic} in daily_advice.${listKey}`,
              );
            }
          }
          cleaned.push(s);
        }
        (sanitized['daily_advice'] as Record<string, unknown>)[listKey] = cleaned;
      }
    }

    // ============================================================
    // (UX Sprint R1.4) Per-dim takeaway + bold marker presence checks
    // ============================================================
    // For each of the 5 dim narrative keys: if the narrative is non-empty
    // and (a) the sibling `<key>_takeaway` field is missing/empty OR
    // (b) the narrative contains zero `**` bold markers, push a warn finding.
    // Severity = 'warn' (doesn't block response), but observability log
    // `metric.fortune.takeaway_skip_rate` enables grep-based skip-rate
    // tracking — target <10% across first 100 production calls.
    for (const dimKey of this.DIM_NARRATIVE_KEYS) {
      const body = narrative[dimKey];
      if (typeof body !== 'string' || body.trim().length === 0) continue;
      const takeawayKey = `${dimKey}_takeaway`;
      const takeaway = narrative[takeawayKey];
      if (typeof takeaway !== 'string' || takeaway.trim().length === 0) {
        findings.push({
          severity: 'warn',
          type: 'missing_takeaway',
          detail: `${dimKey} has narrative but ${takeawayKey} is missing/empty`,
          section: takeawayKey,
        });
        this.logger.warn(
          `metric.fortune.takeaway_skip_rate type=missing_takeaway section=${takeawayKey}`,
        );
      }
      if (!body.includes('**')) {
        findings.push({
          severity: 'warn',
          type: 'missing_bold_markers',
          detail: `${dimKey} contains zero **...** bold markers`,
          section: dimKey,
        });
        this.logger.warn(
          `metric.fortune.takeaway_skip_rate type=missing_bold_markers section=${dimKey}`,
        );
      }
    }

    const passed = findings.every(f => f.severity !== 'error');
    return { passed, findings, sanitized };
  }
}
