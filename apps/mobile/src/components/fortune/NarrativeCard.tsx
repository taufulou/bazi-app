/**
 * NarrativeCard — AI daily narrative (RN port of the web component).
 *
 * Sections (per FORTUNE_V1_PROMPTS.daily): daily_overview (hero) + 5 per-dim
 * cards (+ optional takeaway) + daily_advice (canTry / shouldHold).
 *
 * Streaming render (plan v2): per-section dispatch — sanitized `narrative`
 * supersedes provisional `streamedSections` supersedes skeleton. Canonical
 * order enforced by DIM_META iteration regardless of section arrival order.
 * Disclaimer rendered in ALL modes so its Y position stays stable.
 */
import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CircleCheck, CircleSlash } from 'lucide-react-native';
import type { DailyFortuneNarrative, FortuneDimension, HeadlinerAnchor } from '../../lib/fortune-api';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { DIM_META, type DimKey } from './dimensions';
import { dimTierFromScore, type DimTier } from './labels';
import { parseBoldSegments } from './markdown';

export type FortuneDimKey = DimKey;

interface Props {
  narrative: DailyFortuneNarrative | null;
  dimensions: Record<FortuneDimKey, FortuneDimension>;
  headlinerSignals?: { chartContext: HeadlinerAnchor[]; triggers: HeadlinerAnchor[] };
  /** True while AI narration is still generating (engine data already painted). */
  loading?: boolean;
  /** Per-section provisional content from `section_complete` SSE events. */
  streamedSections?: Partial<DailyFortuneNarrative>;
}

type TakeawayKey =
  | 'daily_romance_takeaway'
  | 'daily_career_takeaway'
  | 'daily_finance_takeaway'
  | 'daily_travel_takeaway'
  | 'daily_health_takeaway';

function takeawayKeyFor(dimKey: DimKey): TakeawayKey {
  return `daily_${dimKey}_takeaway` as TakeawayKey;
}

function dimTierColor(t: DimTier): string {
  if (t === 'good') return colors.success;
  if (t === 'mid') return colors.gold;
  return colors.error;
}

const DISCLAIMER =
  '※ 今日運勢為「軟提示」— 主要受您命格、大運、流年的長期結構影響，每日只是觸發點。建議搭配其他層級綜合參考。';

/** Render **markdown bold** into <Text> with bold spans (no dangerouslySetInnerHTML). */
function RichText({ text, style }: { text: string; style?: object }) {
  const zh = useZh();
  const segments = parseBoldSegments(zh(text));
  return (
    <Text style={style}>
      {segments.map((seg, i) =>
        seg.type === 'bold' ? (
          <Text key={i} style={styles.bold}>
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        ),
      )}
    </Text>
  );
}

function SkeletonLines({ widths }: { widths: string[] }) {
  return (
    <View style={styles.skeletonProse}>
      {widths.map((w, i) => (
        <View key={i} style={[styles.skeletonLine, { width: w as `${number}%` }]} />
      ))}
    </View>
  );
}

function HeadlinerChips({
  chartContext,
  triggers,
}: {
  chartContext: HeadlinerAnchor[];
  triggers: HeadlinerAnchor[];
}) {
  const zh = useZh();
  return (
    <View style={styles.chipRow}>
      {chartContext.map((a, i) => (
        <View key={`c-${i}`} style={[styles.chip, styles.chipGold]}>
          <Text style={styles.chipGoldText}>{zh(a.label)}</Text>
        </View>
      ))}
      {triggers.map((a, i) => (
        <View key={`t-${i}`} style={[styles.chip, styles.chipRedTone]}>
          <Text style={styles.chipRedText}>{zh(a.label)}</Text>
        </View>
      ))}
    </View>
  );
}

export default function NarrativeCard({
  narrative,
  dimensions,
  headlinerSignals,
  loading = false,
  streamedSections,
}: Props) {
  const zh = useZh();
  const hasStreamed = !narrative && !!streamedSections && Object.keys(streamedSections).length > 0;

  // Full shimmer skeleton — nothing yet + loading.
  if (!narrative && !hasStreamed && loading) {
    return <NarrativeSkeleton dimensions={dimensions} headlinerSignals={headlinerSignals} />;
  }

  // AI failed (not loading, nothing streamed) — deterministic signals fallback.
  if (!narrative && !hasStreamed) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackLead}>
          {zh(
            'AI 文字解讀暫時無法產生，可能因命理師服務忙線。以下為命局層級的結構化訊號可供參考，稍後再回來即可看到完整解讀：',
          )}
        </Text>
        <SignalsList dimensions={dimensions} />
      </View>
    );
  }

  const sectionText = (key: keyof DailyFortuneNarrative): string | null => {
    const fromFinal = narrative?.[key] as string | undefined;
    if (typeof fromFinal === 'string' && fromFinal.length > 0) return fromFinal;
    const fromStream = streamedSections?.[key] as string | undefined;
    if (typeof fromStream === 'string' && fromStream.length > 0) return fromStream;
    return null;
  };
  const advice: DailyFortuneNarrative['daily_advice'] | null =
    narrative?.daily_advice ??
    (streamedSections?.daily_advice as DailyFortuneNarrative['daily_advice'] | undefined) ??
    null;

  const overview = sectionText('daily_overview');

  return (
    <View style={styles.wrap}>
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{zh('今日整體')}</Text>
        {headlinerSignals && headlinerSignals.chartContext.length > 0 && (
          <HeadlinerChips chartContext={headlinerSignals.chartContext} triggers={headlinerSignals.triggers} />
        )}
        {overview ? (
          <RichText text={overview} style={styles.heroBody} />
        ) : (
          <>
            <SkeletonLines widths={['92%', '88%', '70%']} />
            <Text style={styles.skeletonHint}>{zh('AI 命理師正在為您解讀今日命盤…')}</Text>
          </>
        )}
      </View>

      {/* 5 dims — canonical order via DIM_META */}
      <View style={styles.dims}>
        {DIM_META.map((m) => {
          const text = sectionText(m.narrativeKey);
          const takeaway = sectionText(takeawayKeyFor(m.key));
          const dim = dimensions[m.key];
          const score = Math.max(0, Math.min(100, dim?.score ?? 50));
          const color = dimTierColor(dimTierFromScore(score));
          const { Icon } = m;
          return (
            <View key={m.key} style={styles.dimBlock}>
              <View style={styles.dimHeader}>
                <Icon size={20} strokeWidth={1.8} color={color} />
                <Text style={styles.dimTitle}>{zh(m.zh)}</Text>
                {dim && (
                  <View style={[styles.dimBadge, { borderColor: color }]}>
                    <View style={[styles.dimBadgeDot, { backgroundColor: color }]} />
                    <Text style={styles.dimBadgeScore}>{score}</Text>
                    <Text style={[styles.dimBadgeLabel, { color }]}>{zh(dim.label)}</Text>
                  </View>
                )}
              </View>
              {takeaway && takeaway.trim() ? (
                <Text style={styles.takeaway}>{zh(takeaway)}</Text>
              ) : null}
              {text ? (
                <RichText text={text} style={styles.dimBody} />
              ) : (
                <SkeletonLines widths={['94%', '90%', '88%', '60%']} />
              )}
            </View>
          );
        })}
      </View>

      {/* Advice */}
      <View style={styles.adviceGrid}>
        <View style={styles.adviceCol}>
          <View style={styles.adviceTitleRow}>
            <CircleCheck size={18} strokeWidth={2} color={colors.success} />
            <Text style={styles.adviceTitle}>{zh('今日可試試')}</Text>
          </View>
          {advice ? (
            (advice.canTry || []).map((item, i) => (
              <View key={`ct-${i}`} style={styles.adviceItem}>
                <CircleCheck size={14} strokeWidth={2} color={colors.success} />
                <Text style={styles.adviceItemText}>{zh(item)}</Text>
              </View>
            ))
          ) : (
            <SkeletonLines widths={['84%', '72%']} />
          )}
        </View>
        <View style={styles.adviceCol}>
          <View style={styles.adviceTitleRow}>
            <CircleSlash size={18} strokeWidth={2} color={colors.orange} />
            <Text style={styles.adviceTitle}>{zh('今日宜緩')}</Text>
          </View>
          {advice ? (
            (advice.shouldHold || []).map((item, i) => (
              <View key={`sh-${i}`} style={styles.adviceItem}>
                <CircleSlash size={14} strokeWidth={2} color={colors.orange} />
                <Text style={styles.adviceItemText}>{zh(item)}</Text>
              </View>
            ))
          ) : (
            <SkeletonLines widths={['80%', '68%']} />
          )}
        </View>
      </View>

      <Text style={styles.disclaimer}>{zh(DISCLAIMER)}</Text>
    </View>
  );
}

function NarrativeSkeleton({
  dimensions,
  headlinerSignals,
}: {
  dimensions: Record<FortuneDimKey, FortuneDimension>;
  headlinerSignals?: { chartContext: HeadlinerAnchor[]; triggers: HeadlinerAnchor[] };
}) {
  const zh = useZh();
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{zh('今日整體')}</Text>
        {headlinerSignals && headlinerSignals.chartContext.length > 0 && (
          <HeadlinerChips chartContext={headlinerSignals.chartContext} triggers={headlinerSignals.triggers} />
        )}
        <SkeletonLines widths={['92%', '88%', '70%']} />
        <Text style={styles.skeletonHint}>{zh('AI 命理師正在為您解讀今日命盤…')}</Text>
      </View>
      <View style={styles.dims}>
        {DIM_META.map((m) => {
          const dim = dimensions[m.key];
          const score = Math.max(0, Math.min(100, dim?.score ?? 50));
          const color = dimTierColor(dimTierFromScore(score));
          const { Icon } = m;
          return (
            <View key={m.key} style={styles.dimBlock}>
              <View style={styles.dimHeader}>
                <Icon size={20} strokeWidth={1.8} color={color} />
                <Text style={styles.dimTitle}>{zh(m.zh)}</Text>
                {dim && (
                  <View style={[styles.dimBadge, { borderColor: color }]}>
                    <View style={[styles.dimBadgeDot, { backgroundColor: color }]} />
                    <Text style={styles.dimBadgeScore}>{score}</Text>
                    <Text style={[styles.dimBadgeLabel, { color }]}>{zh(dim.label)}</Text>
                  </View>
                )}
              </View>
              <SkeletonLines widths={['94%', '90%', '88%', '60%']} />
            </View>
          );
        })}
      </View>
      <Text style={styles.disclaimer}>{zh(DISCLAIMER)}</Text>
    </View>
  );
}

function SignalsList({ dimensions }: { dimensions: Record<DimKey, FortuneDimension> }) {
  const zh = useZh();
  return (
    <View style={{ gap: spacing.md }}>
      {DIM_META.map((m) => {
        const dim = dimensions[m.key];
        if (!dim) return null;
        const { Icon } = m;
        return (
          <View key={m.key} style={styles.signalsBlock}>
            <View style={styles.dimHeader}>
              <Icon size={16} strokeWidth={1.8} color={colors.textSecondary} />
              <Text style={styles.signalsTitle}>{zh(`${m.zh} · ${dim.score} · ${dim.label}`)}</Text>
            </View>
            {dim.signals.length > 0 ? (
              dim.signals.map((sig, i) => (
                <Text key={i} style={styles.signalsItem}>
                  · {zh(sig.narrative)}
                </Text>
              ))
            ) : (
              <Text style={styles.signalsEmpty}>{zh('今日該維度平穩，無特別動向')}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  bold: { fontWeight: '700' },
  // Hero
  hero: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  heroBody: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 26 },
  skeletonHint: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  // chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  chipGold: { backgroundColor: 'rgba(212,160,23,0.10)', borderColor: colors.borderMedium },
  chipGoldText: { fontSize: fontSize.xs, color: colors.textPrimary, fontWeight: '600' },
  chipRedTone: { backgroundColor: 'rgba(226,61,40,0.08)', borderColor: 'rgba(226,61,40,0.3)' },
  chipRedText: { fontSize: fontSize.xs, color: colors.textAccent, fontWeight: '600' },
  // dims
  dims: { gap: spacing.md },
  dimBlock: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  dimHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dimTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  dimBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  dimBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  dimBadgeScore: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textPrimary },
  dimBadgeLabel: { fontSize: fontSize.xs, fontWeight: '600' },
  takeaway: {
    fontSize: fontSize.sm,
    color: colors.textAccent,
    borderLeftWidth: 3,
    borderLeftColor: colors.textAccent,
    paddingLeft: spacing.sm,
  },
  dimBody: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 26 },
  // advice
  adviceGrid: { flexDirection: 'row', gap: spacing.md },
  adviceCol: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  adviceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  adviceTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  adviceItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  adviceItemText: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1, lineHeight: 22 },
  // disclaimer
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18, marginTop: spacing.xs },
  // skeleton
  skeletonProse: { gap: 6, marginTop: spacing.xs },
  skeletonLine: { height: 12, borderRadius: 4, backgroundColor: colors.borderLight },
  // fallback
  fallback: { gap: spacing.md },
  fallbackLead: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
  signalsBlock: { backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  signalsTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  signalsItem: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
  signalsEmpty: { fontSize: fontSize.sm, color: colors.textMuted },
});
