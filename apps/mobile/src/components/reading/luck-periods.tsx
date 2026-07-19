/**
 * 大運 (luck period) widgets — RN port of the web LuckPeriodChart +
 * LuckPeriodTimeline + LuckPeriodHeader (apps/web/app/components/
 * AIReadingDisplay.tsx + LuckPeriodChart.tsx).
 *
 *  - LuckPeriodChart:    static react-native-svg line/area 大運走勢圖 (no hover on RN).
 *  - LuckPeriodTimeline: vertical per-period list with ScoreBar + interaction chips.
 *  - LuckPeriodHeader:   2-phase 干支 header for current/next/best_period sections.
 *
 * These return BARE content — the caller wraps them in a ReadingSectionCard.
 * All are subscription-agnostic (gating happens at the caller); the web
 * `isSubscriber` masking is dropped.
 */
import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Line,
  Polyline,
  Polygon,
  Circle,
  Defs,
  LinearGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { colors, elementColors, fonts, fontSize, spacing, radius, rhythm } from '../../theme';
import { useZh } from '../../lib/language';
import { ScoreBar, ChipGroup, Chip } from './primitives';
import type { LuckPeriodDetailData, LifetimeV2DeterministicData } from '../../lib/readings-api';

// ============================================================
// Shared helpers (ported)
// ============================================================

/** Ten-god → plain-language capability label (web TEN_GOD_GUIDE_LABELS). */
const TEN_GOD_GUIDE_LABELS: Record<string, string> = {
  食神: '創造力天賦',
  傷官: '叛逆創意天賦',
  正財: '穩定收入天賦',
  偏財: '意外收入天賦',
  正官: '自律管理天賦',
  偏官: '壓力驅動力',
  正印: '貴人支援',
  偏印: '獨特才華',
  比肩: '同伴屬性',
  劫財: '資源競爭風險',
};

/** Score → color band (web score-utils.getScoreColor — mobile has no copy). */
function getScoreColor(score: number): string {
  if (score >= 75) return '#4caf50';
  if (score >= 60) return '#8bc34a';
  if (score >= 45) return '#ff9800';
  if (score >= 30) return '#ff5722';
  return '#f44336';
}

/** Five-element char → chart color (defensive; null when unknown/missing). */
function elementColor(el?: string): string | null {
  if (!el) return null;
  return (elementColors as Record<string, string>)[el] ?? null;
}

function numberToChinese(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (n <= 10) return digits[n] ?? String(n);
  if (n < 20) return `十${digits[n - 10] ?? ''}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${digits[tens] ?? ''}十${ones ? (digits[ones] ?? '') : ''}`;
}

/** Resolve the luck period + ordinal label for a timing section key. */
function getLuckPeriodForSection(
  sectionKey: string,
  periods: LuckPeriodDetailData[],
  bestPeriod: LuckPeriodDetailData | null,
): { period: LuckPeriodDetailData; ordinalLabel: string } | null {
  const ordinal = (p: LuckPeriodDetailData) =>
    p.periodOrdinal ? `第${numberToChinese(p.periodOrdinal)}大運` : '';

  if (sectionKey === 'current_period') {
    const p = periods.find((x) => x.isCurrent);
    return p ? { period: p, ordinalLabel: ordinal(p) } : null;
  }
  if (sectionKey === 'next_period') {
    const currentIdx = periods.findIndex((x) => x.isCurrent);
    if (currentIdx < 0 || currentIdx + 1 >= periods.length) return null;
    const p = periods[currentIdx + 1];
    return p ? { period: p, ordinalLabel: ordinal(p) } : null;
  }
  if (sectionKey === 'best_period') {
    return bestPeriod ? { period: bestPeriod, ordinalLabel: ordinal(bestPeriod) } : null;
  }
  return null;
}

/** Best-period match — mirror web (year-range equality, tolerant of missing). */
function isBestPeriod(p: LuckPeriodDetailData, best: LuckPeriodDetailData | null): boolean {
  return !!best && p.startYear === best.startYear && p.endYear === best.endYear;
}

// ============================================================
// LuckPeriodChart — static SVG line/area 大運走勢圖
// ============================================================

const SVG_W = 330;
const SVG_H = 210;
const PAD_LEFT = 28;
const PAD_RIGHT = 12;
const PAD_TOP = 18;
const PAD_BOTTOM = 46;
const CHART_W = SVG_W - PAD_LEFT - PAD_RIGHT;
const CHART_H = SVG_H - PAD_TOP - PAD_BOTTOM;
const BASE_Y = PAD_TOP + CHART_H; // x-axis baseline

export function LuckPeriodChart({
  periods,
  bestPeriod,
}: {
  periods: LuckPeriodDetailData[];
  bestPeriod: LuckPeriodDetailData | null;
}): React.ReactNode {
  const zh = useZh();
  if (!periods || periods.length === 0) return null;

  const n = periods.length;
  const getX = (i: number) => PAD_LEFT + (i / Math.max(n - 1, 1)) * CHART_W;
  const getY = (score: number) =>
    PAD_TOP + CHART_H - (Math.max(0, Math.min(100, score)) / 100) * CHART_H;

  const scorePoints = periods.map((p, i) => `${getX(i)},${getY(p.score)}`).join(' ');
  const areaPoints = `${getX(0)},${BASE_Y} ${scorePoints} ${getX(n - 1)},${BASE_Y}`;
  const gridY = getY(50);

  return (
    <View style={chart.wrap}>
      <Text style={chart.title}>{zh('大運走勢圖')}</Text>
      <View style={chart.svgWrap}>
        <Svg width="100%" height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}>
          <Defs>
            <LinearGradient id="luckGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={colors.red} stopOpacity={0.15} />
              <Stop offset="100%" stopColor={colors.red} stopOpacity={0.02} />
            </LinearGradient>
          </Defs>

          {/* 50 baseline (light dashed grid) + label */}
          <Line
            x1={PAD_LEFT}
            y1={gridY}
            x2={SVG_W - PAD_RIGHT}
            y2={gridY}
            stroke="rgba(212,160,23,0.35)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <SvgText x={PAD_LEFT - 6} y={gridY + 3} textAnchor="end" fontSize={10} fill={colors.textMuted}>
            50
          </SvgText>

          {/* x-axis baseline */}
          <Line
            x1={PAD_LEFT}
            y1={BASE_Y}
            x2={SVG_W - PAD_RIGHT}
            y2={BASE_Y}
            stroke="rgba(212,160,23,0.2)"
            strokeWidth={1}
          />

          {/* Area fill under the curve */}
          <Polygon points={areaPoints} fill="url(#luckGrad)" />

          {/* Line connecting scores */}
          <Polyline
            points={scorePoints}
            fill="none"
            stroke={colors.red}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Dots + x-axis labels per period */}
          {periods.map((p, i) => {
            const x = getX(i);
            const y = getY(p.score);
            const current = p.isCurrent;
            const best = isBestPeriod(p, bestPeriod);
            const dotFill = elementColor(p.stemElement) ?? getScoreColor(p.score);
            const stroke = current ? '#FFFFFF' : best ? colors.gold : undefined;
            const r = current || best ? 5 : 4;
            const markerLabel = current ? '當前' : best ? '最佳' : '';

            return (
              <React.Fragment key={`${p.stem}${p.branch}-${i}`}>
                {markerLabel ? (
                  <SvgText
                    x={x}
                    y={Math.max(9, y - 9)}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight="700"
                    fill={current ? colors.textAccent : colors.metalText}
                  >
                    {zh(markerLabel)}
                  </SvgText>
                ) : null}
                <Circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={dotFill}
                  stroke={stroke}
                  strokeWidth={stroke ? 1.5 : 0}
                />
                {/* 干支 */}
                <SvgText
                  x={x}
                  y={BASE_Y + 15}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight="600"
                  fill={colors.textPrimary}
                >
                  {zh(`${p.stem}${p.branch}`)}
                </SvgText>
                {/* start year (abbreviated x-axis) */}
                <SvgText x={x} y={BASE_Y + 29} textAnchor="middle" fontSize={10} fill={colors.textMuted}>
                  {p.startYear}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

const chart = StyleSheet.create({
  wrap: { gap: rhythm.afterHeading },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent },
  svgWrap: { width: '100%' },
});

// ============================================================
// LuckPeriodTimeline — vertical per-period list
// ============================================================

export function LuckPeriodTimeline({
  periods,
  bestPeriod,
}: {
  periods: LuckPeriodDetailData[];
  bestPeriod: LuckPeriodDetailData | null;
}): React.ReactNode {
  const zh = useZh();
  if (!periods || periods.length === 0) return null;

  return (
    <View style={tl.wrap}>
      {periods.map((p, i) => {
        const current = p.isCurrent;
        const best = isBestPeriod(p, bestPeriod);
        const scoreColor = getScoreColor(p.score);
        const tenGod = p.tenGod || p.stemTenGod || '';

        return (
          <View
            key={`${p.startYear}-${p.endYear}-${i}`}
            style={[tl.row, current && tl.rowCurrent, !current && best && tl.rowBest]}
          >
            <View style={tl.headerRow}>
              <View style={tl.headerLeft}>
                <Text style={tl.ganzhi}>{zh(`${p.stem}${p.branch}運`)}</Text>
                {tenGod ? <Text style={tl.tenGod}>{zh(tenGod)}</Text> : null}
              </View>
              <View style={tl.badges}>
                {current ? <Chip label={zh('目前')} tone="gold" /> : null}
                {best ? <Chip label={zh('最佳')} tone="positive" /> : null}
              </View>
            </View>

            <Text style={tl.meta}>{zh(`${p.startAge}-${p.endAge}歲 · ${p.startYear}-${p.endYear}`)}</Text>

            <ScoreBar label={zh('大運評分')} score={p.score} color={scoreColor} />

            {p.interactions && p.interactions.length > 0 ? (
              <ChipGroup items={p.interactions.map((it) => zh(it))} tone="neutral" />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const tl = StyleSheet.create({
  // was 8 — IDENTICAL to a row's internal gap below, so the space separating one
  // 大運 card from the next matched the space inside a card and eight stacked
  // periods read as one undifferentiated mass.
  wrap: { gap: rhythm.block },
  row: {
    gap: rhythm.tight,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    backgroundColor: colors.bgSecondary,
  },
  rowCurrent: { borderColor: colors.gold, backgroundColor: colors.bgBannerWarm },
  rowBest: { borderColor: colors.success },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  headerLeft: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexShrink: 1 },
  ganzhi: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  tenGod: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  badges: { flexDirection: 'row', gap: spacing.xs },
  meta: { fontVariant: ['tabular-nums'] as const, fontSize: fontSize.sm, color: colors.textMuted },
});

// ============================================================
// LuckPeriodHeader — 2-phase 干支 header for timing sections
// ============================================================

export function LuckPeriodHeader({
  sectionKey,
  det,
}: {
  sectionKey: string;
  det: LifetimeV2DeterministicData;
}): React.ReactNode {
  const zh = useZh();
  const resolved = getLuckPeriodForSection(
    sectionKey,
    det?.luckPeriodsEnriched ?? [],
    det?.bestPeriod ?? null,
  );
  if (!resolved) return null;

  const { period: p, ordinalLabel } = resolved;
  const scoreColor = getScoreColor(p.score);
  const midYear = p.startYear + 5;
  const stemTgLabel = TEN_GOD_GUIDE_LABELS[p.stemTenGod || ''] || p.stemTenGod || '';
  const branchTgLabel = TEN_GOD_GUIDE_LABELS[p.branchTenGod || ''] || p.branchTenGod || '';
  const stemEl = p.stemElement || '';
  const branchEl = p.branchElement || '';

  return (
    <View style={hdr.wrap}>
      <View style={hdr.titleRow}>
        {ordinalLabel ? <Text style={hdr.ordinal}>{zh(ordinalLabel)}</Text> : null}
        <Text style={hdr.ganzhi}>{zh(`${p.stem}${p.branch}運`)}</Text>
        <Text style={hdr.years}>{`${p.startYear}-${p.endYear}`}</Text>
      </View>

      <Text style={hdr.ageMeta}>{zh(`${p.startAge}-${p.endAge}歲`)}</Text>

      <View style={hdr.phases}>
        <View style={hdr.phaseRow}>
          <Text style={hdr.phaseLabel}>{zh('◆ 第一階段')}</Text>
          <Text style={hdr.phaseDesc}>
            {zh(`${p.stem}${stemEl}${stemTgLabel}（${p.startYear}-${midYear - 1}）`)}
          </Text>
        </View>
        <View style={hdr.phaseRow}>
          <Text style={hdr.phaseLabel}>{zh('◆ 第二階段')}</Text>
          <Text style={hdr.phaseDesc}>
            {zh(`${p.branch}${branchEl}${branchTgLabel}（${midYear}-${p.endYear}）`)}
          </Text>
        </View>
      </View>

      <View style={hdr.scoreRow}>
        <Text style={hdr.scoreLabel}>{zh('綜合評分')}</Text>
        <Text style={[hdr.scoreValue, { color: scoreColor }]}>{`${p.score}${zh('分')}`}</Text>
      </View>
    </View>
  );
}

const hdr = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    backgroundColor: colors.bgSecondary,
  },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm },
  ordinal: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.zwds,
    backgroundColor: colors.zwdsBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  ganzhi: { fontFamily: fonts.serifBold, fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  years: { fontVariant: ['tabular-nums'] as const, fontSize: fontSize.sm, color: colors.textSecondary },
  ageMeta: { fontSize: fontSize.sm, color: colors.textMuted },
  phases: { gap: spacing.xs },
  phaseRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  phaseLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.zwds },
  phaseDesc: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 24 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.ruleHair,
    paddingTop: spacing.sm,
  },
  scoreLabel: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  scoreValue: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '800' },
});
