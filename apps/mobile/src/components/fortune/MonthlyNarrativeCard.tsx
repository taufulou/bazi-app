/**
 * MonthlyNarrativeCard — 月運 AI narrative. RN port.
 *
 * Hero (monthly_overview) + 4 dim cards (career/finance/romance/health, no 出行)
 * + optional intra_month_breakdown 「本月時段建議」 + monthly_advice (canTry/
 * shouldHold). 4 states: full-skeleton / AI-failed fallback / hybrid streaming /
 * success. Per-section dispatch narrative>streamedSections>skeleton.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { MonthlyFortuneNarrative } from '../../lib/fortune-api';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { MONTHLY_DIM_META } from './monthlyDimensions';
import { dimTierFromScore, type DimTier } from './labels';
import { parseBoldSegments } from './markdown';

interface Props {
  narrative: MonthlyFortuneNarrative | null;
  dimensions: Record<'career' | 'finance' | 'romance' | 'health', { score: number; label: string }>;
  loading?: boolean;
  streamedSections?: Partial<MonthlyFortuneNarrative>;
}

function dimTierColor(t: DimTier): string {
  if (t === 'good') return colors.success;
  if (t === 'mid') return colors.gold;
  return colors.error;
}

const DISCLAIMER =
  '※ 本月運勢為「持續趨勢」框架（月運主一月之氣象），引擎依據命格 + 月柱 + 時段訊號生成。具體日期細節請查「日運」。本服務僅供參考與娛樂用途。';

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

export default function MonthlyNarrativeCard({ narrative, dimensions, loading = false, streamedSections }: Props) {
  const zh = useZh();
  const hasStreamed = !narrative && !!streamedSections && Object.keys(streamedSections).length > 0;

  if (!narrative && !hasStreamed && loading) {
    return <MonthlySkeleton />;
  }

  if (!narrative && !hasStreamed) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackLead}>
          {zh(
            'AI 文字解讀暫時無法產生，可能因命理師服務忙線。上方的能量指數、四大面向與時段分析仍可參考，稍後再回來即可看到完整解讀。',
          )}
        </Text>
      </View>
    );
  }

  const sectionText = (key: keyof MonthlyFortuneNarrative): string | null => {
    const fromNarrative = narrative?.[key];
    const fromStreamed = streamedSections?.[key];
    if (typeof fromNarrative === 'string' && fromNarrative.length > 0) return fromNarrative;
    if (typeof fromStreamed === 'string' && fromStreamed.length > 0) return fromStreamed;
    return null;
  };
  const monthlyAdvice = narrative?.monthly_advice ?? streamedSections?.monthly_advice ?? null;
  const intraMonthBreakdown = narrative?.intra_month_breakdown ?? streamedSections?.intra_month_breakdown ?? null;
  const overviewText = sectionText('monthly_overview');

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{zh('本月整體')}</Text>
        {overviewText ? <RichText text={overviewText} style={styles.heroBody} /> : <SkeletonLines widths={['92%', '88%', '70%']} />}
      </View>

      <View style={styles.dims}>
        {MONTHLY_DIM_META.map((m) => {
          const dim = dimensions[m.key];
          const score = dim ? Math.max(0, Math.min(100, dim.score)) : 50;
          const color = dimTierColor(dimTierFromScore(score));
          const text = sectionText(m.narrativeKey);
          const takeaway = sectionText(m.takeawayKey);
          const { Icon } = m;
          return (
            <View key={m.key} style={styles.dimBlock}>
              <View style={styles.dimHeader}>
                <Icon size={18} strokeWidth={1.8} color={color} />
                <Text style={styles.dimTitle}>{zh(m.zh)}</Text>
                {dim && (
                  <View style={[styles.dimBadge, { borderColor: color }]}>
                    <View style={[styles.dimBadgeDot, { backgroundColor: color }]} />
                    <Text style={styles.dimBadgeScore}>{score}</Text>
                    <Text style={[styles.dimBadgeLabel, { color }]}>{zh(dim.label)}</Text>
                  </View>
                )}
              </View>
              {takeaway ? <RichText text={takeaway} style={styles.takeaway} /> : null}
              {text ? (
                <RichText text={text} style={styles.dimBody} />
              ) : narrative ? (
                <Text style={styles.dimEmpty}>{zh('本月此面向平穩無特別動向')}</Text>
              ) : (
                <SkeletonLines widths={['94%', '90%', '85%', '65%']} />
              )}
            </View>
          );
        })}
      </View>

      {intraMonthBreakdown && intraMonthBreakdown.length > 0 && (
        <View style={styles.breakdown}>
          <Text style={styles.breakdownTitle}>{zh('本月時段建議')}</Text>
          {intraMonthBreakdown.map((b, i) => (
            <View key={i} style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>{zh(b.partition_label)}</Text>
              <RichText text={b.narrative} style={styles.breakdownBody} />
            </View>
          ))}
        </View>
      )}

      {monthlyAdvice && (
        <View style={styles.adviceGrid}>
          <View style={styles.adviceCol}>
            <Text style={styles.adviceTitle}>{zh('本月可試試')}</Text>
            {monthlyAdvice.canTry.map((item, i) => (
              <RichText key={i} text={`· ${item}`} style={styles.adviceItem} />
            ))}
          </View>
          <View style={styles.adviceCol}>
            <Text style={styles.adviceTitle}>{zh('本月宜緩')}</Text>
            {monthlyAdvice.shouldHold.map((item, i) => (
              <RichText key={i} text={`· ${item}`} style={styles.adviceItem} />
            ))}
          </View>
        </View>
      )}

      <Text style={styles.disclaimer}>{zh(DISCLAIMER)}</Text>
    </View>
  );
}

function MonthlySkeleton() {
  const zh = useZh();
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{zh('本月整體')}</Text>
        <SkeletonLines widths={['92%', '88%', '70%']} />
        <Text style={styles.skeletonHint}>{zh('AI 命理師正在為您解讀本月命盤…')}</Text>
      </View>
      <View style={styles.dims}>
        {MONTHLY_DIM_META.map((m) => {
          const { Icon } = m;
          return (
            <View key={m.key} style={styles.dimBlock}>
              <View style={styles.dimHeader}>
                <Icon size={18} strokeWidth={1.8} color={colors.textSecondary} />
                <Text style={styles.dimTitle}>{zh(m.zh)}</Text>
              </View>
              <SkeletonLines widths={['94%', '90%', '85%', '65%']} />
            </View>
          );
        })}
      </View>
      <Text style={styles.disclaimer}>{zh(DISCLAIMER)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  bold: { fontWeight: '700' },
  hero: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  heroTitle: { fontFamily: fonts.serif, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  heroBody: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 24 },
  skeletonHint: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  dims: { gap: spacing.md },
  dimBlock: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  dimHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dimTitle: { fontFamily: fonts.serif, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  dimBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  dimBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  dimBadgeScore: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textPrimary },
  dimBadgeLabel: { fontSize: fontSize.xs, fontWeight: '600' },
  takeaway: { fontSize: fontSize.sm, color: colors.textAccent, borderLeftWidth: 3, borderLeftColor: colors.textAccent, paddingLeft: spacing.sm },
  dimBody: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 23 },
  dimEmpty: { fontSize: fontSize.sm, color: colors.textMuted },
  breakdown: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  breakdownTitle: { fontFamily: fonts.serif, fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent },
  breakdownItem: { gap: 2 },
  breakdownLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  breakdownBody: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 21 },
  adviceGrid: { flexDirection: 'row', gap: spacing.md },
  adviceCol: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  adviceTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  adviceItem: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18, marginTop: spacing.xs },
  skeletonProse: { gap: 6, marginTop: spacing.xs },
  skeletonLine: { height: 12, borderRadius: 4, backgroundColor: colors.borderLight },
  fallback: { gap: spacing.md },
  fallbackLead: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
});
