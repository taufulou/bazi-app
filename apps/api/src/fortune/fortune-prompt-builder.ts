/**
 * Fortune prompt builder — assembles the daily fortune AI prompt from
 * engine pre-analysis + chart context.
 *
 * Plan: .claude/plans/ok-next-big-feature-merry-cake.md
 * Pattern: mirrors `ai.service.ts::interpolateAnnualV2Fields` + the
 *          chat-prompt-builder.ts module structure.
 */

import { FORTUNE_V1_PROMPTS } from '../ai/prompts';

// ============================================================
// Types — minimal shape contracts from the engine + chart
// ============================================================

export interface FortuneChartContext {
  gender: string;                  // 'male' | 'female'
  birthDate: string;               // YYYY-MM-DD
  birthTime: string;               // HH:MM
  lunarDate?: string | null;       // optional pre-rendered lunar
  yearPillar: string;              // 干支
  monthPillar: string;
  dayPillar: string;
  hourPillar: string;
  yearTenGod: string;
  monthTenGod: string;
  hourTenGod: string;
  dayMaster: string;               // e.g. 戊
  dayMasterElement: string;        // 木/火/土/金/水
  dayMasterYinYang: string;        // 陰/陽
  strengthV2: string;              // very_weak/weak/neutral/strong/very_strong (or Chinese label)
  usefulGod: string;
  favorableGod: string;
  tabooGod: string;
  enemyGod: string;
}

export interface DailyEngineOutput {
  dayStem: string;
  dayBranch: string;
  dayGanZhi: string;
  dayTenGod: string;
  dateIso: string;
  /** Final post-cap daily verdict — what the user sees. Option 2.5: this is
   *  the day's own verdict clipped by month/year subordination cap. */
  auspiciousness: string;
  /** Legacy: pre-Phase-12-F/B/E/D checkpoint from `_compute_single_month`.
   *  Under Option 2.5 this is the day-pillar's pre-fix label — kept for
   *  backward compat. Prefer `rawDailyAuspiciousness` for new consumers. */
  baseAuspiciousness: string;
  /** Option 2.5 NEW: day's raw verdict pre-cap (post-softening). */
  rawDailyAuspiciousness?: string;
  /** Option 2.5 NEW: flow-month's independent verdict (cap input). */
  flowMonthAuspiciousness?: string;
  energyScore: number;
  metaFraming: string;
  dimensions: {
    romance: { score: number; signals: Array<Record<string, unknown>> };
    career:  { score: number; signals: Array<Record<string, unknown>> };
    finance: { score: number; signals: Array<Record<string, unknown>> };
    travel:  { score: number; signals: Array<Record<string, unknown>> };
    health:  { score: number; signals: Array<Record<string, unknown>> };
  };
  folkContent?: {
    wealthDirection?: { element: string; direction: string; note?: string };
  };
  ruleTrace?: string[];
  preAnalysisVersion?: string;
  /** Chart context (Phase Fortune) — populated by the engine endpoint
   *  so the NestJS prompt builder doesn't need a second /calculate hop. */
  chartContext?: FortuneChartContext;
}

// ============================================================
// Signal formatter — renders engine signals as Chinese bullet lines
// for the AI prompt to consume verbatim.
// ============================================================

function renderSignalLine(sig: Record<string, unknown>): string {
  const tags: string[] = [`type=${String(sig['type'] ?? 'unknown')}`];
  if (sig['valence']) tags.push(`valence=${String(sig['valence'])}`);
  if (sig['role']) tags.push(`role=${String(sig['role'])}`);
  if (sig['officerRole']) tags.push(`officerRole=${String(sig['officerRole'])}`);
  if (sig['gender']) tags.push(`gender=${String(sig['gender'])}`);
  const narrative = String(sig['narrative'] ?? '').trim();
  return `  · ${narrative}  [${tags.join(', ')}]`;
}

function renderDimSignals(signals: Array<Record<string, unknown>>): string {
  if (!signals || signals.length === 0) {
    return '  （無觸發訊號 — 今日該維度平穩無動向）';
  }
  return signals.map(renderSignalLine).join('\n');
}

// ============================================================
// Interpolator — Fortune V1 daily template field substitution
// ============================================================

export function interpolateFortuneV1Fields(
  template: string,
  daily: DailyEngineOutput,
  chart: FortuneChartContext,
): string {
  let out = template;

  // Chart context placeholders
  const replacements: Record<string, string> = {
    '{{gender}}': chart.gender,
    '{{birthDate}}': chart.birthDate,
    '{{birthTime}}': chart.birthTime,
    '{{lunarDate}}': chart.lunarDate ?? '（未提供）',
    '{{yearPillar}}': chart.yearPillar,
    '{{monthPillar}}': chart.monthPillar,
    '{{dayPillar}}': chart.dayPillar,
    '{{hourPillar}}': chart.hourPillar,
    '{{yearTenGod}}': chart.yearTenGod,
    '{{monthTenGod}}': chart.monthTenGod,
    '{{hourTenGod}}': chart.hourTenGod,
    '{{dayMaster}}': chart.dayMaster,
    '{{dayMasterElement}}': chart.dayMasterElement,
    '{{dayMasterYinYang}}': chart.dayMasterYinYang,
    '{{strengthV2}}': chart.strengthV2,
    '{{usefulGod}}': chart.usefulGod,
    '{{favorableGod}}': chart.favorableGod,
    '{{tabooGod}}': chart.tabooGod,
    '{{enemyGod}}': chart.enemyGod,

    // Daily-output placeholders
    '{{targetDate}}': daily.dateIso,
    '{{dayGanZhi}}': daily.dayGanZhi,
    '{{dayTenGod}}': daily.dayTenGod,
    '{{metaFraming}}': daily.metaFraming,
    '{{auspiciousness}}': daily.auspiciousness,
    '{{baseAuspiciousness}}': daily.baseAuspiciousness ?? daily.auspiciousness,  // legacy
    '{{rawDailyAuspiciousness}}': daily.rawDailyAuspiciousness ?? daily.auspiciousness,
    '{{flowMonthAuspiciousness}}': daily.flowMonthAuspiciousness ?? daily.auspiciousness,
    '{{energyScore}}': String(daily.energyScore),
    '{{ruleTrace}}': (daily.ruleTrace ?? []).join(' → ') || '（無）',

    // Dimension scores
    '{{romanceScore}}': String(daily.dimensions.romance.score),
    '{{careerScore}}': String(daily.dimensions.career.score),
    '{{financeScore}}': String(daily.dimensions.finance.score),
    '{{travelScore}}': String(daily.dimensions.travel.score),
    '{{healthScore}}': String(daily.dimensions.health.score),

    // Dimension signals (multi-line)
    '{{romanceSignals}}': renderDimSignals(daily.dimensions.romance.signals),
    '{{careerSignals}}':  renderDimSignals(daily.dimensions.career.signals),
    '{{financeSignals}}': renderDimSignals(daily.dimensions.finance.signals),
    '{{travelSignals}}':  renderDimSignals(daily.dimensions.travel.signals),
    '{{healthSignals}}':  renderDimSignals(daily.dimensions.health.signals),

    // Folk content (Phase 1 = wealth direction only)
    '{{wealthDirection}}': daily.folkContent?.wealthDirection
      ? `${daily.folkContent.wealthDirection.element} → ${daily.folkContent.wealthDirection.direction} (${daily.folkContent.wealthDirection.note ?? ''})`
      : '（未提供）',
  };

  for (const [token, value] of Object.entries(replacements)) {
    // Use split/join for global replace without regex escaping
    out = out.split(token).join(value);
  }

  return out;
}

// ============================================================
// Build the full message pair (system + user) for Claude
// ============================================================

export function buildFortuneDailyMessages(
  daily: DailyEngineOutput,
  chart: FortuneChartContext,
): { systemPrompt: string; userPrompt: string } {
  const dailyPrompts = FORTUNE_V1_PROMPTS.daily;
  if (!dailyPrompts) {
    throw new Error('FORTUNE_V1_PROMPTS.daily is not configured');
  }

  const interpolated = interpolateFortuneV1Fields(
    dailyPrompts.userTemplate,
    daily,
    chart,
  );

  const userPrompt = `${interpolated}\n\n${dailyPrompts.outputFormat}`;
  const systemPrompt = dailyPrompts.systemAddition;

  return { systemPrompt, userPrompt };
}
