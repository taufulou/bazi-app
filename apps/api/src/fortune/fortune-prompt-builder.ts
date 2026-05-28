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
    luckyColor?: {
      element: string; primary: string; secondary: string; tertiary?: string;
      cite: string; provenance: 'classical'; note?: string;
    } | null;
    luckyNumber?: {
      element: string; numbers: number[]; cite: string;
      provenance: 'folk_tradition'; note?: string;
    } | null;
    luckyFoodFavor?: {
      element: string; category: string; examples: string[];
      cite: string; provenance: 'classical';
    } | null;
    luckyFoodAvoid?: {
      element: string; category: string; reason: string; cite_sources: string[];
      classification: 'doctrinal'; avoid_strength: 'strong'; provenance: 'classical';
    } | null;
    auspiciousHours?: Array<{
      branch: string; hour_range: string; classical_name: string; provenance: 'classical';
    }>;
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

    // Folk content (Phase 1.5.z = 6 total: wealthDirection + 4 new chart-level + auspiciousHours per-day)
    '{{wealthDirection}}': daily.folkContent?.wealthDirection
      ? `${daily.folkContent.wealthDirection.element} → ${daily.folkContent.wealthDirection.direction} (${daily.folkContent.wealthDirection.note ?? ''})`
      : '（未提供）',
    '{{luckyColor}}': daily.folkContent?.luckyColor
      ? `${daily.folkContent.luckyColor.primary} (次選：${daily.folkContent.luckyColor.secondary}；典籍：${daily.folkContent.luckyColor.cite})`
      : '（未提供）',
    '{{luckyNumber}}': daily.folkContent?.luckyNumber
      ? `${daily.folkContent.luckyNumber.numbers.join('、')} (${daily.folkContent.luckyNumber.cite})`
      : '（未提供）',
    '{{luckyFoodFavor}}': daily.folkContent?.luckyFoodFavor
      ? `${daily.folkContent.luckyFoodFavor.category} (例：${daily.folkContent.luckyFoodFavor.examples.join('、')}；典籍：${daily.folkContent.luckyFoodFavor.cite})`
      : '（未提供）',
    '{{luckyFoodAvoid}}': daily.folkContent?.luckyFoodAvoid
      ? `${daily.folkContent.luckyFoodAvoid.category}；原因：${daily.folkContent.luckyFoodAvoid.reason} (典籍：${daily.folkContent.luckyFoodAvoid.cite_sources.join('；')})`
      : '（未提供）',
    '{{auspiciousHours}}': daily.folkContent?.auspiciousHours?.length
      ? daily.folkContent.auspiciousHours.map(h => `${h.classical_name}時 ${h.branch} (${h.hour_range})`).join('、')
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


// ============================================================
// Phase 2 — MONTHLY (八字月運) interpolator + builder
// ============================================================
//
// Separate function (per plan v4 H5 — locked decision #10): NOT branching
// inside `interpolateFortuneV1Fields`. Keeps DAY/MONTH paths independent +
// individually testable. Caller dispatches by scope.
//
// Engine output comes from `monthly_enhanced.compute_single_month_by_yearmonth`
// + optional `compute_intra_month_breakdown` (L1.b) injected as
// `intraMonthBreakdown` field on the engine output object.

/** Minimal shape contract for monthly engine output (subset). */
export interface MonthlyEngineOutput {
  monthStem: string;
  monthBranch: string;
  monthTenGod: string;
  monthLabel: string;             // e.g., '癸巳月'
  /** Final post-Phase-12-fix label */
  auspiciousness: string;
  energyScore: number;
  metaFraming: 'soft_trigger';
  ruleTrace?: string[];
  preAnalysisVersion?: string;
  /** Phase 12b/c additive — used in deterministic injector below */
  officerSealActivation?: {
    pattern: string;
    direction: string;
    level: string;
  };
  fuYinInteractions?: Array<{ pillar: string; branch: string; role: string }>;
  chongKuRelease?: {
    net: number;
    releasedStems: string[];
    direction: string;
  };
  liuHaiInteractions?: Array<{
    pillar: string;
    pair: string;
    role: string;
    kind: string;
  }>;
  /** 4 dims locked (no travel) per Sub-Agent B */
  dimensions: {
    career: { score: number; signals: string[] };
    finance: { score: number; signals: string[] };
    romance: { score: number; signals: string[] };
    health: { score: number; signals: string[] };
  };
  /** Optional L1.b breakdown — injector emits structured 上半月/下半月 block
   *  when present; otherwise emits «（無資料）» */
  intraMonthBreakdown?: {
    scheme_id: 'tiangan_dizhi_half';
    liuyue_window: { start: string; end: string; days: number };
    buckets: Array<{
      label: string;
      governing_pillar: 'stem' | 'branch';
      day_range: [number, number | null];
      auspicious_days: number;
      challenging_days: number;
      neutral_days: number;
      peak_signals: Array<{
        date: string | null;
        energyScore: number;
        label: string;
        signals: string[];
      }>;
      dominant_shensha: string[];
    }>;
  };
  chartContext?: FortuneChartContext & {
    flowYear?: number;
    flowYearStem?: string;
  };
}

function renderMonthlyDimSignals(signals: string[]): string {
  if (!signals || signals.length === 0) {
    return '  （無觸發訊號 — 本月該維度平穩無動向）';
  }
  return signals.map((s) => `  · ${s}`).join('\n');
}

function renderMonthlyTransientSignals(monthly: MonthlyEngineOutput): string {
  const lines: string[] = [];

  if (monthly.officerSealActivation) {
    const a = monthly.officerSealActivation;
    lines.push(
      `  · 殺印/官印相生 transient (Phase 12b Fix C) — pattern=${a.pattern}, direction=${a.direction}, level=${a.level}`,
    );
    if (a.direction === 'positive') {
      lines.push('    ⚠️ 本月趨向得長輩／貴人助力（用 soft-trigger 框架敘述）');
    } else {
      lines.push('    ⚠️ 本月宜謹慎處理權威關係（用 soft-trigger 框架敘述）');
    }
  }

  if (monthly.chongKuRelease) {
    const c = monthly.chongKuRelease;
    lines.push(
      `  · 沖庫釋放 (Phase 12c Fix F) — net=${c.net}, releasedStems=[${c.releasedStems.join('、')}], direction=${c.direction}`,
    );
    lines.push(
      '    ⚠️ 結構釋放型訊號，stem rescue 不能抵消 (per 滴天髓·論墓庫 doctrine)',
    );
  }

  if (monthly.fuYinInteractions && monthly.fuYinInteractions.length > 0) {
    for (const fy of monthly.fuYinInteractions) {
      lines.push(
        `  · 伏吟月柱與命中 ${fy.pillar}柱 (${fy.branch})，角色 ${fy.role} — 本月此面向有「停滯／重複／放大」傾向`,
      );
    }
  }

  if (monthly.liuHaiInteractions && monthly.liuHaiInteractions.length > 0) {
    for (const lh of monthly.liuHaiInteractions) {
      lines.push(
        `  · 六害 (Phase 12c Fix E) — 月柱與命中 ${lh.pillar}柱 (${lh.pair})，對 ${lh.role} 神有暗箭之耗 (kind=${lh.kind})`,
      );
    }
  }

  if (lines.length === 0) {
    return '  （無月柱 transient 觸發 — 本月以基本月柱影響為主）';
  }
  return lines.join('\n');
}

function renderIntraMonthBreakdown(
  monthly: MonthlyEngineOutput,
): string {
  const imb = monthly.intraMonthBreakdown;
  if (!imb || !imb.buckets || imb.buckets.length === 0) {
    return '  （未提供月內時段資料 — AI 不可輸出 intra_month_breakdown 欄位）';
  }
  const lines: string[] = [
    `  scheme: ${imb.scheme_id}`,
    `  流月窗口: ${imb.liuyue_window.start} → ${imb.liuyue_window.end} (${imb.liuyue_window.days} 天)`,
  ];
  for (const b of imb.buckets) {
    lines.push('');
    lines.push(`  ◆ ${b.label} (主氣: ${b.governing_pillar === 'stem' ? '流月天干' : '流月地支'}, day-range ${b.day_range[0]}-${b.day_range[1] ?? '末'})`);
    lines.push(`    日吉凶分布: 吉=${b.auspicious_days} / 凶=${b.challenging_days} / 平=${b.neutral_days}`);
    if (b.dominant_shensha.length > 0) {
      lines.push(`    主導神煞: ${b.dominant_shensha.join('、')}`);
    }
    if (b.peak_signals.length > 0) {
      const peakLines = b.peak_signals
        .map((p) => `      · ${p.date ?? '?'} ${p.label}(${p.energyScore})${p.signals.length ? '：' + p.signals.slice(0, 2).join('；') : ''}`)
        .join('\n');
      lines.push('    高峰日 (top 3 by |score-50|):');
      lines.push(peakLines);
    }
  }
  return lines.join('\n');
}

/** Monthly V1 template field interpolation. Mirrors `interpolateFortuneV1Fields`
 *  structure scaled for MONTH scope (no folk, no travel, monthly transients). */
export function interpolateFortuneMonthlyFields(
  template: string,
  monthly: MonthlyEngineOutput,
  chart: FortuneChartContext,
  opts: { targetMonth: string; flowYear: number },
): string {
  let out = template;

  const replacements: Record<string, string> = {
    // Chart context (mirrors daily template — but uses natalMonthPillar/TenGod
    // to disambiguate from FLOW monthPillar)
    '{{gender}}': chart.gender,
    '{{birthDate}}': chart.birthDate,
    '{{birthTime}}': chart.birthTime,
    '{{yearPillar}}': chart.yearPillar,
    '{{yearTenGod}}': chart.yearTenGod,
    '{{natalMonthPillar}}': chart.monthPillar,
    '{{natalMonthTenGod}}': chart.monthTenGod,
    '{{dayPillar}}': chart.dayPillar,
    '{{hourPillar}}': chart.hourPillar,
    '{{hourTenGod}}': chart.hourTenGod,
    '{{dayMaster}}': chart.dayMaster,
    '{{dayMasterElement}}': chart.dayMasterElement,
    '{{dayMasterYinYang}}': chart.dayMasterYinYang,
    '{{strengthV2}}': chart.strengthV2,
    '{{usefulGod}}': chart.usefulGod,
    '{{favorableGod}}': chart.favorableGod,
    '{{tabooGod}}': chart.tabooGod,
    '{{enemyGod}}': chart.enemyGod,

    // Monthly-specific placeholders
    '{{targetMonth}}': opts.targetMonth,
    '{{flowYear}}': String(opts.flowYear),
    '{{monthGanZhi}}': `${monthly.monthStem}${monthly.monthBranch}`,
    '{{monthTenGod}}': monthly.monthTenGod,
    '{{metaFraming}}': monthly.metaFraming,
    '{{auspiciousness}}': monthly.auspiciousness,
    '{{energyScore}}': String(monthly.energyScore),
    '{{ruleTrace}}': (monthly.ruleTrace ?? []).join(' → ') || '（無）',

    // 4 dim scores + signals (no travel — locked per Sub-Agent B)
    '{{careerScore}}': String(monthly.dimensions.career.score),
    '{{financeScore}}': String(monthly.dimensions.finance.score),
    '{{romanceScore}}': String(monthly.dimensions.romance.score),
    '{{healthScore}}': String(monthly.dimensions.health.score),
    '{{careerSignals}}': renderMonthlyDimSignals(monthly.dimensions.career.signals),
    '{{financeSignals}}': renderMonthlyDimSignals(monthly.dimensions.finance.signals),
    '{{romanceSignals}}': renderMonthlyDimSignals(monthly.dimensions.romance.signals),
    '{{healthSignals}}': renderMonthlyDimSignals(monthly.dimensions.health.signals),

    // Monthly transient signals (Phase 12b/c structured fields)
    '{{monthlyTransientSignals}}': renderMonthlyTransientSignals(monthly),

    // L1.b intra-month breakdown (optional)
    '{{intraMonthBreakdown}}': renderIntraMonthBreakdown(monthly),
  };

  for (const [token, value] of Object.entries(replacements)) {
    out = out.split(token).join(value);
  }
  return out;
}

/** Build the full (system, user) prompt pair for monthly Claude call. */
export function buildFortuneMonthlyMessages(
  monthly: MonthlyEngineOutput,
  chart: FortuneChartContext,
  opts: { targetMonth: string; flowYear: number },
): { systemPrompt: string; userPrompt: string } {
  const monthlyPrompts = FORTUNE_V1_PROMPTS.monthly;
  if (!monthlyPrompts) {
    throw new Error('FORTUNE_V1_PROMPTS.monthly is not configured');
  }

  const interpolated = interpolateFortuneMonthlyFields(
    monthlyPrompts.userTemplate,
    monthly,
    chart,
    opts,
  );

  const userPrompt = `${interpolated}\n\n${monthlyPrompts.outputFormat}`;
  const systemPrompt = monthlyPrompts.systemAddition;

  return { systemPrompt, userPrompt };
}
