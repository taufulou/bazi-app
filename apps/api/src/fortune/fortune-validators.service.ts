/**
 * Anti-drift validators for the Fortune AI narrative output.
 *
 * Plan: .claude/plans/ok-next-big-feature-merry-cake.md — Accuracy Assurance
 * Layer 5 (Debt D — AI narrative anti-drift validation) + Phase 1.5.z L4
 * 3-tier defense for folk content.
 *
 * Mirrors `chat-validators.service.ts` pattern:
 *   1. Banned-phrase regex strip (一定/必定/必然/絕對/百分百/etc. — bare
 *      「必」 intentionally excluded to avoid false positives on legitimate
 *      Chinese: 必須/必要/何必/不必/必勝. See FORTUNE_BANNED_ABSOLUTE_PHRASES
 *      in prompts.ts for the canonical list.) — enforced server-side BEFORE
 *      returning to client. If found, replace with 「易於」 (in-place
 *      substitution).
 *   2. Soft-trigger framing check — narrative must use 「今日宜/今日易於/
 *      今日適合」 framing for soft-trigger content; if absent on a soft-trigger
 *      output, flag for QA.
 *   3. **Phase 1.5.z 3-tier folk-content defense**:
 *      - Tier 1 (conditional whitelist): strip topic-mentions ONLY when
 *        engine did NOT emit the corresponding field. Preserves Phase 1
 *        safety while allowing AI to discuss fields the engine grounds.
 *      - Tier 2 (value fidelity, warn-only): when engine emits, check AI
 *        mentions for value mismatches (e.g., engine color=紅, AI mentions 藍).
 *        Warn-only because Chinese natural language regex extraction is fragile.
 *      - Tier 3 (framing rules): enforce 「民俗參考」 prefix for 吉數
 *        (folk_tradition tier) + 五行 reason citation for 忌食.
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

/** Folk content shape needed by Tier 1 conditional gate + Tier 2 value
 *  fidelity. Mirrors `DailyFortuneEngineOutput.folkContent` but accepts
 *  null values per the DTO contract (engine may omit chart-level fields
 *  for unresolved 用神 charts). */
export interface FolkContentForValidation {
  luckyColor?: {
    element?: string; primary?: string; secondary?: string; tertiary?: string;
  } | null;
  luckyNumber?: { element?: string; numbers?: number[] } | null;
  luckyFoodFavor?: { element?: string; category?: string; examples?: string[] } | null;
  luckyFoodAvoid?: { element?: string; category?: string; reason?: string } | null;
  auspiciousHours?: Array<{ branch?: string; classical_name?: string }>;
}

@Injectable()
export class FortuneValidatorsService {
  private readonly logger = new Logger(FortuneValidatorsService.name);

  /** Forbidden folk-content topic patterns — Phase 1.5.z makes these CONDITIONAL.
   *
   *  Audit I2 tightened: the prior `今日宜.{0,3}色` regex false-positive'd
   *  on legitimate wealth-direction narratives (e.g., 用神=土 → 「今日宜土色
   *  方位」 = direction note, not a fabricated lucky-color). Restricted to
   *  patterns where the AI is structurally introducing color/number/food
   *  as a topic, not mentioning element-color in a different context.
   *
   *  **Phase 1.5.z (L4 Tier 1)**: each pattern is paired with an `enabledKey`
   *  that maps to a folkContent field. The pattern strips matched sentences
   *  ONLY when the engine did NOT emit that field. If engine emits, AI is
   *  allowed to reference the topic (and Tier 2 + Tier 3 enforce correctness).
   *
   *  Map:
   *    'lucky_number'    → folkContent.luckyNumber
   *    'lucky_color'     → folkContent.luckyColor
   *    'food_advice'     → folkContent.luckyFoodFavor OR luckyFoodAvoid (either emits → allow)
   *    'auspicious_hour' → folkContent.auspiciousHours (non-empty → allow)
   */
  private readonly FORBIDDEN_FOLK_PATTERNS: Array<{ pattern: RegExp; topic: string }> = [
    { pattern: /(幸運數字|吉祥數字|幸運號碼)/, topic: 'lucky_number' },
    { pattern: /(吉祥色|今日.{0,3}幸運色|今日穿著?.{0,3}色|宜穿.{0,3}色|建議穿.{0,3}色)/, topic: 'lucky_color' },
    { pattern: /(食物建議|今日宜吃|食補建議|養生食物|建議飲食|建議吃)/, topic: 'food_advice' },
    { pattern: /(今日吉時|宜在.{0,4}時辰|黃道吉時|今日.{0,3}時辰最佳)/, topic: 'auspicious_hour' },
  ];

  /** Tier 1 conditional gate — returns true when the topic should be stripped
   *  (engine omitted the corresponding field, so any AI mention is fabrication).
   *  Returns false when engine emits the field — AI is allowed to discuss it
   *  (Tier 2 + Tier 3 enforce correctness). */
  private shouldStripTopic(topic: string, folkContent?: FolkContentForValidation): boolean {
    if (!folkContent) return true;  // no engine data → strip everything (defensive)
    switch (topic) {
      case 'lucky_number':    return folkContent.luckyNumber == null;
      case 'lucky_color':     return folkContent.luckyColor == null;
      case 'food_advice':     return folkContent.luckyFoodFavor == null && folkContent.luckyFoodAvoid == null;
      case 'auspicious_hour': return !folkContent.auspiciousHours || folkContent.auspiciousHours.length === 0;
      default:                return true;
    }
  }

  /** Soft-trigger opening pattern (heuristic — AI is encouraged to use these). */
  private readonly SOFT_TRIGGER_OPENERS = /今日(宜|易於|適合|傾向|有.{1,4}傾向|可考慮)/;

  /**
   * Phase Fortune Streaming L2 — per-section banned-phrase strip at emission.
   *
   * Cheap regex-style strip over a single section's text. Used by
   * `FortuneStreamService` to enforce the «no absolute language ever reaches
   * the user» contract from CLAUDE.md AS EACH SECTION ARRIVES, before the
   * full validator runs at end-of-stream. Without per-section strip, the user
   * would briefly see «今天會...必然...» between section_complete and done.
   *
   * Returns the sanitized text + a list of phrases that were swapped (for
   * the Sentry sanitize_diff breadcrumb — telemetry only, no content
   * captured).
   *
   * NOTE: this is INTENTIONALLY narrower than `validate()` — it does NOT do
   * folk-fabrication gating, framing checks, takeaway/bold validation, etc.
   * Those rules can require cross-section context or engine field comparison;
   * they run once at end-of-stream where the full narrative is available.
   * The contract is: per-section strip preserves the «no banned phrase
   * ever leaks» invariant; full validate handles everything else.
   */
  stripBannedAbsolutePhrasesFromText(text: string): {
    text: string;
    strippedPhrases: string[];
  } {
    if (typeof text !== 'string' || text.length === 0) {
      return { text, strippedPhrases: [] };
    }
    let out = text;
    const strippedPhrases: string[] = [];
    for (const banned of FORTUNE_BANNED_ABSOLUTE_PHRASES) {
      if (out.includes(banned)) {
        strippedPhrases.push(banned);
        out = out.split(banned).join('易於');
      }
    }
    return { text: out, strippedPhrases };
  }

  /** Per-dim narrative keys to check for takeaway + bold marker presence
   *  (UX Sprint R1.4). Each requires a sibling `<key>_takeaway` field. */
  private readonly DIM_NARRATIVE_KEYS = [
    'daily_romance',
    'daily_career',
    'daily_finance',
    'daily_travel',
    'daily_health',
  ];

  /** Strip whole sentences containing forbidden folk-content matches.
   *
   * PR review #10 (2026-05-17): naive `text.replace(pattern, '')` leaves
   * grammatically broken Chinese (orphaned subjects/commas like
   * `今日，請多加注意。`). Instead, find the containing CJK sentence
   * and remove it entirely. Sentence boundaries: 。！？\n
   *
   * Returns { text: cleaned text, sentencesStripped: count }.
   */
  private stripFolkSentences(text: string): { text: string; sentencesStripped: number } {
    let cleaned = text;
    let totalStripped = 0;
    for (const { pattern } of this.FORBIDDEN_FOLK_PATTERNS) {
      // Build a sentence-level regex by wrapping the existing pattern in
      // greedy non-terminator runs on both sides + optional terminator.
      const sentenceRegex = new RegExp(
        `[^。！？\\n]*(?:${pattern.source})[^。！？\\n]*[。！？\\n]?`,
        'g',
      );
      const matches = cleaned.match(sentenceRegex);
      if (matches) totalStripped += matches.length;
      cleaned = cleaned.replace(sentenceRegex, '');
    }
    return { text: cleaned.trim(), sentencesStripped: totalStripped };
  }

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

  /** Strip sentences containing ANY of the given patterns (subset of
   *  FORBIDDEN_FOLK_PATTERNS — used by Tier 1 conditional gate). */
  private stripFolkSentencesByPatterns(text: string, patterns: RegExp[]): { text: string; sentencesStripped: number } {
    let cleaned = text;
    let totalStripped = 0;
    for (const pattern of patterns) {
      const sentenceRegex = new RegExp(
        `[^。！？\\n]*(?:${pattern.source})[^。！？\\n]*[。！？\\n]?`,
        'g',
      );
      const matches = cleaned.match(sentenceRegex);
      if (matches) totalStripped += matches.length;
      cleaned = cleaned.replace(sentenceRegex, '');
    }
    return { text: cleaned.trim(), sentencesStripped: totalStripped };
  }

  /** Tier 3 — framing rule checks (Phase 1.5.z).
   *  Warn-only — flags issues for QA but does NOT mutate text (these are
   *  rule violations the AI made, not factual hallucinations to strip).
   *
   *  Rules:
   *    a) 民俗 prefix for 吉數 — when AI mentions luckyNumber values, the
   *       sentence MUST contain «民俗» (per locked decision #7 + L3 prompt rule).
   *    b) 五行 reason citation for 忌食 — when AI mentions luckyFoodAvoid
   *       category, the sentence MUST contain a 剋 mechanism reason
   *       (per L3 prompt rule + medical-adjacency safety).
   *    c) DM-drift on color/number/food — AI must NOT key on day-master
   *       («您是X日主，宜X色»). Must say «您的用神為X，宜X色».
   */
  private _checkTier3FramingRules(
    text: string,
    sectionKey: string,
    folkContent: FolkContentForValidation | undefined,
    findings: FortuneValidationResult['findings'],
  ): void {
    if (!folkContent) return;

    // Rule a) 民俗 prefix for 吉數
    if (folkContent.luckyNumber?.numbers?.length) {
      // Look for sentences mentioning a lucky-number number (e.g., 「今日數字宜 3、8」)
      const numbers = folkContent.luckyNumber.numbers;
      const numberPattern = new RegExp(
        `[^。！？\\n]*(?:數字|幸運數|吉數)[^。！？\\n]*(?:${numbers.join('|')})[^。！？\\n]*[。！？]?`,
        'g',
      );
      const matches = text.match(numberPattern);
      if (matches) {
        for (const sentence of matches) {
          if (!sentence.includes('民俗')) {
            findings.push({
              severity: 'warn',
              type: 'missing_folk_prefix',
              detail: `吉數 sentence missing 「民俗參考」 prefix (folk_tradition tier disclosure): «${sentence.trim().slice(0, 40)}…»`,
              section: sectionKey,
            });
            this.logger.warn(`metric.fortune.framing_violation type=missing_folk_prefix section=${sectionKey}`);
          }
        }
      }
    }

    // Rule b) 五行 reason citation for 忌食
    if (folkContent.luckyFoodAvoid?.category) {
      // Look for sentences mentioning «今日忌食» or «忌食» or «避免吃»
      const avoidPattern = /[^。！？\n]*(?:今日忌食|忌食|今日宜避免|今日避免吃|避免吃)[^。！？\n]*[。！？]?/g;
      const matches = text.match(avoidPattern);
      if (matches) {
        for (const sentence of matches) {
          // Reason must mention 剋 mechanism (e.g., 「因金剋木」)
          if (!sentence.includes('剋')) {
            findings.push({
              severity: 'warn',
              type: 'missing_avoid_reason',
              detail: `忌食 sentence missing 五行 reason citation (e.g., 「因金剋木」): «${sentence.trim().slice(0, 40)}…»`,
              section: sectionKey,
            });
            this.logger.warn(`metric.fortune.framing_violation type=missing_avoid_reason section=${sectionKey}`);
          }
        }
      }
    }

    // Rule c) DM-drift on color/number/food — forbidden 「您是X日主」 pattern
    // when discussing folk content (色/數/食).
    const dmDriftPattern = /(?:您|你)是.{1,2}日主.{0,20}(?:宜|宜選|建議)/;
    if (dmDriftPattern.test(text)) {
      findings.push({
        severity: 'warn',
        type: 'dm_drift',
        detail: 'narrative used DM-keyed framing for folk content («您是X日主，宜X»); must use 用神-keyed («您的用神為X，宜X»)',
        section: sectionKey,
      });
      this.logger.warn(`metric.fortune.framing_violation type=dm_drift section=${sectionKey}`);
    }
  }

  /** Validate a daily fortune AI narrative and sanitize banned phrases.
   *
   *  PR review #5 (2026-05-17): the entire body is wrapped in try/catch.
   *  The validator must NEVER throw — if it does, the outer catch in
   *  `getDailyFortune` resets narrative=null and silently discards the
   *  AI's work. Potential throw points include regex ops on non-string
   *  field values and iteration over non-array daily_advice fields.
   *  On internal error: return the original narrative with a warn finding.
   */
  validate(
    narrative: Record<string, unknown> | null,
    daily: { metaFraming?: string; folkContent?: FolkContentForValidation },
  ): FortuneValidationResult {
    const findings: FortuneValidationResult['findings'] = [];

    if (!narrative) {
      return { passed: true, findings, sanitized: {} };
    }

    try {
      return this._validateUnsafe(narrative, daily, findings);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Fortune validator internal error: ${msg}`);
      findings.push({
        severity: 'warn',
        type: 'validator_internal_error',
        detail: `Validator threw — serving narrative unsanitized: ${msg}`,
        section: 'validator',
      });
      return {
        passed: false,
        findings,
        sanitized: narrative,
      };
    }
  }

  /** Inner unsanitized impl — wrapped by `validate()`'s try/catch. */
  private _validateUnsafe(
    narrative: Record<string, unknown>,
    daily: { metaFraming?: string; folkContent?: FolkContentForValidation },
    findings: FortuneValidationResult['findings'],
  ): FortuneValidationResult {
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

      // 3. Forbidden folk content fabrication (Tier 1 — CONDITIONAL per Phase 1.5.z)
      // For each topic: strip ONLY when engine did NOT emit the corresponding
      // folkContent field. If engine emits, AI is allowed to discuss the topic
      // (Tier 2 + Tier 3 enforce correctness; this gate just blocks pure fabrication).
      const stripPatterns: RegExp[] = [];
      for (const { pattern, topic } of this.FORBIDDEN_FOLK_PATTERNS) {
        if (!pattern.test(text)) continue;
        const shouldStrip = this.shouldStripTopic(topic, daily.folkContent);
        if (shouldStrip) {
          stripPatterns.push(pattern);
          findings.push({
            severity: 'error',
            type: 'forbidden_folk_content',
            detail: `engine omitted ${topic} but AI mentioned it — sentence stripped`,
            section: sectionKey,
          });
          this.logger.warn(`Fortune narrative: ungrounded ${topic} in ${sectionKey} — sentence stripped`);
        }
      }
      if (stripPatterns.length > 0) {
        const { text: stripped } = this.stripFolkSentencesByPatterns(text, stripPatterns);
        text = stripped;
      }

      // Tier 3 — framing rules (Phase 1.5.z anti-DM-drift + 民俗 prefix + 忌食 reason)
      this._checkTier3FramingRules(text, sectionKey, daily.folkContent, findings);

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
          // Audit I3 — same folk-content fabrication check, now CONDITIONAL (Phase 1.5.z Tier 1).
          // List items are short single sentences. If a folk pattern matches AND the
          // engine OMITTED that field → DROP the item (still pure fabrication). If engine
          // EMITTED the field → keep the item (AI is allowed to mention it).
          let folkItemDrop = false;
          for (const { pattern, topic } of this.FORBIDDEN_FOLK_PATTERNS) {
            if (pattern.test(s) && this.shouldStripTopic(topic, daily.folkContent)) {
              folkItemDrop = true;
              findings.push({
                severity: 'error',
                type: 'forbidden_folk_content',
                detail: `engine omitted ${topic} but AI mentioned it in list item (item dropped)`,
                section: `daily_advice.${listKey}`,
              });
              this.logger.warn(
                `Fortune narrative: ungrounded ${topic} in daily_advice.${listKey} — item dropped`,
              );
              break;  // one finding per item is enough; don't double-log
            }
          }
          if (!folkItemDrop) cleaned.push(s);
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

  // ============================================================
  // Phase 2 月運 — Monthly narrative validators
  // ============================================================
  //
  // Mirrors daily validators scaled for MONTH scope. The shared
  // `FORTUNE_BANNED_ABSOLUTE_PHRASES` constant now includes MONTH-scope
  // phrases («本月會」 etc.), so `stripBannedAbsolutePhrasesFromText` handles
  // both DAY + MONTH automatically.
  //
  // Per plan v4 L4 + research-results §6 clauses:
  // - Clause 1: soft-trigger framing for 流月 (本月宜 / 本月易於 / 本月趨向
  //   — NOT 本月會 / 本月一定)
  // - Clause 3: 用神/喜神/忌神 chart-level only (no monthly reassignment)
  // - Clause 7: cross-month redirect (defense-in-depth for H6) — flag AI
  //   responses that answer about a DIFFERENT month than session anchor

  /** Soft-trigger opening pattern for MONTH scope (parallel to daily). */
  private readonly MONTHLY_SOFT_TRIGGER_OPENERS =
    /本月(宜|易於|適合|傾向|趨向|有.{1,4}傾向|可考慮)/;

  /** Cross-month query phrases (defense-in-depth for H6 redirect rule).
   *  When session anchor month is provided, presence of these patterns
   *  in narrative MAY indicate the AI is drifting from anchor — flag warn. */
  private readonly CROSS_MONTH_PATTERNS = [
    /下個月/,
    /下下個月/,
    /上個月/,
    /明年.{1,3}月/,
    /去年.{1,3}月/,
  ];

  /** Monthly 用神 reassignment forbidden pattern. */
  private readonly MONTHLY_DM_REASSIGNMENT = /本月用神(為|是|變為|轉為)/;

  /**
   * Validate a monthly fortune AI narrative and sanitize banned phrases.
   *
   * Scope: lighter than `validate()` (daily). Monthly engine doesn't emit
   * folk content (per locked decision #6), so no folk-fabrication gate.
   * Focus is on:
   * 1. Banned absolute phrases (universal + MONTH-specific) — strip via
   *    existing public method (reuses unified constant — added MONTH
   *    phrases at L4 time).
   * 2. Soft-trigger framing presence (warn if NO 本月宜/本月易於/etc. found
   *    in monthly_overview).
   * 3. 用神 reassignment forbidden (warn — chart-level only doctrine).
   * 4. Optional: cross-month-drift detection (defense-in-depth for H6
   *    redirect rule — when `sessionAnchorMonth` is provided, warn if
   *    narrative references a DIFFERENT month).
   *
   * Never throws — internal error path returns the narrative unchanged
   * with a warn finding (matches `validate()` resilience contract).
   */
  validateMonthly(
    narrative: Record<string, unknown> | null,
    opts?: { sessionAnchorMonth?: string }
  ): FortuneValidationResult {
    const findings: FortuneValidationResult['findings'] = [];

    if (!narrative) {
      return { passed: true, findings, sanitized: {} };
    }

    try {
      return this._validateMonthlyUnsafe(narrative, findings, opts);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Fortune monthly validator internal error: ${msg}`);
      findings.push({
        severity: 'warn',
        type: 'internal_error',
        detail: msg,
      });
      return { passed: true, findings, sanitized: narrative };
    }
  }

  private _validateMonthlyUnsafe(
    narrative: Record<string, unknown>,
    findings: FortuneValidationResult['findings'],
    opts?: { sessionAnchorMonth?: string },
  ): FortuneValidationResult {
    // Audit fix HIGH #4 (2026-05-28): deep-clone matches daily-path C2 fix.
    // Previously was shallow spread `{...narrative}` — safe for current
    // implementation (string assignments + nested rebuild), but inconsistent
    // with `_validateUnsafe` (line 357) which uses JSON.parse(JSON.stringify).
    // A future contributor adding nested-mutation would silently corrupt
    // caller's narrative. Match daily path to lock the invariant.
    const sanitized: Record<string, unknown> = JSON.parse(JSON.stringify(narrative));

    // Iterate string-valued sections (monthly_overview, monthly_career, etc.
    // + takeaway pull-quotes). Skip monthly_advice (object) +
    // intra_month_breakdown (array of objects) which need structural handling.
    const stringSections: string[] = [
      'monthly_overview',
      'monthly_career', 'monthly_career_takeaway',
      'monthly_finance', 'monthly_finance_takeaway',
      'monthly_romance', 'monthly_romance_takeaway',
      'monthly_health', 'monthly_health_takeaway',
    ];

    let foundSoftTriggerInOverview = false;

    for (const key of stringSections) {
      const value = narrative[key];
      if (typeof value !== 'string' || value.length === 0) continue;

      // 1. Banned absolute phrase strip (universal helper — uses unified constant)
      const { text: stripped, strippedPhrases } =
        this.stripBannedAbsolutePhrasesFromText(value);
      if (strippedPhrases.length > 0) {
        findings.push({
          severity: 'warn',
          type: 'banned_phrase_stripped',
          detail: `stripped ${strippedPhrases.length} banned phrase(s): ${strippedPhrases.join(', ')}`,
          section: key,
        });
        this.logger.warn(
          `Fortune monthly narrative: stripped banned phrases from ${key} (${strippedPhrases.join(', ')})`,
        );
      }
      sanitized[key] = stripped;

      // 2. 用神 reassignment check (Phase 12 doctrine)
      if (this.MONTHLY_DM_REASSIGNMENT.test(stripped)) {
        findings.push({
          severity: 'warn',
          type: 'monthly_dm_reassignment',
          detail: 'narrative attempted to reassign 用神 at monthly scope; 用神 is chart-level only (子平真詮 論用神 「用神既定，不可妄改」)',
          section: key,
        });
        this.logger.warn(
          `metric.fortune.framing_violation type=monthly_dm_reassignment section=${key}`,
        );
      }

      // 3. Cross-month drift detection (defense-in-depth for H6 redirect)
      if (opts?.sessionAnchorMonth) {
        for (const pattern of this.CROSS_MONTH_PATTERNS) {
          if (pattern.test(stripped)) {
            findings.push({
              severity: 'warn',
              type: 'cross_month_drift',
              detail: `narrative references a non-anchor month (matched pattern ${pattern.source}); session anchor is ${opts.sessionAnchorMonth}. Per H6 redirect doctrine, MONTH chat should redirect cross-month queries, not answer them.`,
              section: key,
            });
            this.logger.warn(
              `metric.fortune.framing_violation type=cross_month_drift section=${key} anchor=${opts.sessionAnchorMonth} pattern=${pattern.source}`,
            );
            break; // one warn per section is enough
          }
        }
      }

      // 4. Soft-trigger framing presence (overview only — informational)
      if (key === 'monthly_overview' && this.MONTHLY_SOFT_TRIGGER_OPENERS.test(stripped)) {
        foundSoftTriggerInOverview = true;
      }
    }

    if (!foundSoftTriggerInOverview && typeof narrative['monthly_overview'] === 'string') {
      findings.push({
        severity: 'warn',
        type: 'missing_soft_trigger_framing',
        detail: 'monthly_overview lacks soft-trigger phrasing (本月宜 / 本月易於 / 本月趨向 / 本月適合 etc.) — may indicate over-strict «本月會」 framing that was stripped',
        section: 'monthly_overview',
      });
      this.logger.warn(
        'metric.fortune.framing_violation type=missing_soft_trigger_framing section=monthly_overview',
      );
    }

    // monthly_advice list-item banned-phrase strip (mirror daily logic)
    const advice = narrative['monthly_advice'];
    if (
      advice && typeof advice === 'object' &&
      !Array.isArray(advice)
    ) {
      const adviceObj = advice as Record<string, unknown>;
      const sanitizedAdvice: Record<string, unknown> = { ...adviceObj };
      for (const listKey of ['canTry', 'shouldHold']) {
        const list = adviceObj[listKey];
        if (Array.isArray(list)) {
          sanitizedAdvice[listKey] = list.map((item: unknown) => {
            if (typeof item !== 'string') return item;
            const { text, strippedPhrases } =
              this.stripBannedAbsolutePhrasesFromText(item);
            if (strippedPhrases.length > 0) {
              findings.push({
                severity: 'warn',
                type: 'banned_phrase_stripped',
                detail: `stripped ${strippedPhrases.length} banned phrase(s) in monthly_advice.${listKey} item`,
                section: `monthly_advice.${listKey}`,
              });
            }
            return text;
          });
        }
      }
      sanitized['monthly_advice'] = sanitizedAdvice;
    }

    const passed = findings.every((f) => f.severity !== 'error');
    return { passed, findings, sanitized };
  }

  // ============================================================
  // 年運 (Yearly Fortune) — Phase 3 validation
  // ============================================================
  //
  // Clauses (Phase A Sub-Agent C):
  // 1. soft-trigger framing (今年宜/今年易於/今年趨向) — banned strip handles 今年會/今年必
  // 3. 用神 reassignment forbidden at yearly scope
  // 6. romance≠relationships — yearly_romance must NOT use 人際關係/朋友/同事/社交圈
  // (Clause 4 months-from-structured-fields is enforced at the injector layer
  //  via index-pairing; AI invented months would mismatch but are low-risk —
  //  warn-only drift check could be added later.)

  /** Soft-trigger opening pattern for YEAR scope. */
  private readonly YEARLY_SOFT_TRIGGER_OPENERS =
    /今年(宜|易於|適合|傾向|趨向|有.{1,4}傾向|可考慮)/;

  /** Yearly 用神 reassignment forbidden pattern. */
  private readonly YEARLY_DM_REASSIGNMENT = /今年用神(為|是|變為|轉為)/;

  /** romance≠relationships drift — forbidden in yearly_romance (Clause 6). */
  private readonly YEARLY_ROMANCE_RELATIONSHIP_DRIFT =
    /(人際關係|同事|朋友圈|社交圈)/;

  /**
   * Validate a yearly fortune AI narrative and sanitize banned phrases.
   * Mirrors `validateMonthly` resilience contract (never throws).
   */
  validateYearly(
    narrative: Record<string, unknown> | null,
  ): FortuneValidationResult {
    const findings: FortuneValidationResult['findings'] = [];
    if (!narrative) {
      return { passed: true, findings, sanitized: {} };
    }
    try {
      return this._validateYearlyUnsafe(narrative, findings);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Fortune yearly validator internal error: ${msg}`);
      findings.push({ severity: 'warn', type: 'internal_error', detail: msg });
      return { passed: true, findings, sanitized: narrative };
    }
  }

  private _validateYearlyUnsafe(
    narrative: Record<string, unknown>,
    findings: FortuneValidationResult['findings'],
  ): FortuneValidationResult {
    const sanitized: Record<string, unknown> = JSON.parse(JSON.stringify(narrative));

    const stringSections: string[] = [
      'yearly_headline',
      'yearly_overview',
      'yearly_career', 'yearly_career_keyword',
      'yearly_finance', 'yearly_finance_keyword',
      'yearly_romance', 'yearly_romance_keyword',
      'yearly_health', 'yearly_health_keyword',
      'yearly_advice',
    ];

    let foundSoftTriggerInOverview = false;

    for (const key of stringSections) {
      const value = narrative[key];
      if (typeof value !== 'string' || value.length === 0) continue;

      // 1. Banned absolute phrase strip (handles 今年會/今年必 + universal)
      const { text: stripped, strippedPhrases } =
        this.stripBannedAbsolutePhrasesFromText(value);
      if (strippedPhrases.length > 0) {
        findings.push({
          severity: 'warn',
          type: 'banned_phrase_stripped',
          detail: `stripped ${strippedPhrases.length} banned phrase(s): ${strippedPhrases.join(', ')}`,
          section: key,
        });
        this.logger.warn(
          `Fortune yearly narrative: stripped banned phrases from ${key} (${strippedPhrases.join(', ')})`,
        );
      }
      sanitized[key] = stripped;

      // 3. 用神 reassignment check (Phase 12 doctrine)
      if (this.YEARLY_DM_REASSIGNMENT.test(stripped)) {
        findings.push({
          severity: 'warn',
          type: 'yearly_dm_reassignment',
          detail: 'narrative attempted to reassign 用神 at yearly scope; 用神 is chart-level only',
          section: key,
        });
        this.logger.warn(
          `metric.fortune.framing_violation type=yearly_dm_reassignment section=${key}`,
        );
      }

      // 6. romance≠relationships drift (yearly_romance + its keyword only)
      if (
        (key === 'yearly_romance' || key === 'yearly_romance_keyword') &&
        this.YEARLY_ROMANCE_RELATIONSHIP_DRIFT.test(stripped)
      ) {
        findings.push({
          severity: 'warn',
          type: 'romance_relationship_conflation',
          detail: 'yearly_romance referenced 人際關係/朋友圈/同事/社交圈 — that is the 人際關係 block, NOT the 感情 dim (Clause 6)',
          section: key,
        });
        this.logger.warn(
          `metric.fortune.framing_violation type=romance_relationship_conflation section=${key}`,
        );
      }

      // soft-trigger framing presence (overview only — informational)
      if (key === 'yearly_overview' && this.YEARLY_SOFT_TRIGGER_OPENERS.test(stripped)) {
        foundSoftTriggerInOverview = true;
      }
    }

    if (!foundSoftTriggerInOverview && typeof narrative['yearly_overview'] === 'string') {
      findings.push({
        severity: 'warn',
        type: 'missing_soft_trigger_framing',
        detail: 'yearly_overview lacks soft-trigger phrasing (今年宜 / 今年易於 / 今年趨向 etc.)',
        section: 'yearly_overview',
      });
      this.logger.warn(
        'metric.fortune.framing_violation type=missing_soft_trigger_framing section=yearly_overview',
      );
    }

    // yearly_risk_opportunities — array of {month_label, type, keyword, narrative}.
    // Banned-phrase strip on keyword + narrative.
    const riskOpp = narrative['yearly_risk_opportunities'];
    if (Array.isArray(riskOpp)) {
      sanitized['yearly_risk_opportunities'] = riskOpp.map((item: unknown) => {
        if (!item || typeof item !== 'object') return item;
        const obj = { ...(item as Record<string, unknown>) };
        for (const field of ['keyword', 'narrative']) {
          const v = obj[field];
          if (typeof v === 'string') {
            const { text, strippedPhrases } = this.stripBannedAbsolutePhrasesFromText(v);
            if (strippedPhrases.length > 0) {
              findings.push({
                severity: 'warn',
                type: 'banned_phrase_stripped',
                detail: `stripped ${strippedPhrases.length} banned phrase(s) in yearly_risk_opportunities.${field}`,
                section: `yearly_risk_opportunities.${field}`,
              });
            }
            obj[field] = text;
          }
        }
        return obj;
      });
    }

    const passed = findings.every((f) => f.severity !== 'error');
    return { passed, findings, sanitized };
  }
}
