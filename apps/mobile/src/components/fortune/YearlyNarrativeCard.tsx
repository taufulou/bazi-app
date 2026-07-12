/**
 * YearlyNarrativeCard — 年運 AI narrative. RN port.
 * Hero (yearly_headline + yearly_overview) + 4 dim prose blocks (with keyword +
 * verdict badge) + yearly_advice single block (年度建議). 4-state streaming.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { YearlyFortuneNarrative } from '../../lib/fortune-api';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { YEARLY_DIM_META } from './yearlyDimensions';
import { dimTierFromScore, type DimTier } from './labels';
import { parseBoldSegments } from './markdown';

interface Props {
  narrative: YearlyFortuneNarrative | null;
  dimensions: Record<'career' | 'finance' | 'romance' | 'health', { score: number; label: string }>;
  loading?: boolean;
  streamedSections?: Partial<YearlyFortuneNarrative>;
}

function dimTierColor(t: DimTier): string {
  if (t === 'good') return colors.success;
  if (t === 'mid') return colors.gold;
  return colors.error;
}

const DISCLAIMER =
  '※ 今年運勢為「年度趨勢」框架，引擎依據命格 + 流年（+ 大運）訊號生成。具體月份細節請查「月運」。本服務僅供參考與娛樂用途。';

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

export default function YearlyNarrativeCard({ narrative, dimensions, loading = false, streamedSections }: Props) {
  const zh = useZh();
  const hasStreamed = !narrative && !!streamedSections && Object.keys(streamedSections).length > 0;

  if (!narrative && !hasStreamed && loading) {
    return <YearlySkeleton />;
  }

  if (!narrative && !hasStreamed) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackLead}>
          {zh(
            'AI 文字解讀暫時無法產生，可能因命理師服務忙線。上方的能量指數、四大面向與關鍵月份仍可參考，稍後再回來即可看到完整解讀。',
          )}
        </Text>
      </View>
    );
  }

  const sectionText = (key: keyof YearlyFortuneNarrative): string | null => {
    const fromNarrative = narrative?.[key];
    const fromStreamed = streamedSections?.[key];
    if (typeof fromNarrative === 'string' && fromNarrative.length > 0) return fromNarrative;
    if (typeof fromStreamed === 'string' && fromStreamed.length > 0) return fromStreamed;
    return null;
  };

  const headlineText = sectionText('yearly_headline');
  const overviewText = sectionText('yearly_overview');
  const adviceText = sectionText('yearly_advice');

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{zh('年度總結')}</Text>
        {headlineText ? <RichText text={headlineText} style={styles.heroHeadline} /> : null}
        {overviewText ? <RichText text={overviewText} style={styles.heroBody} /> : <SkeletonLines widths={['92%', '88%', '70%']} />}
      </View>

      <View style={styles.dims}>
        {YEARLY_DIM_META.map((m) => {
          const dim = dimensions[m.key];
          const score = dim ? Math.max(0, Math.min(100, dim.score)) : 50;
          const color = dimTierColor(dimTierFromScore(score));
          const text = sectionText(m.narrativeKey);
          const keyword = sectionText(m.keywordKey);
          const { Icon } = m;
          return (
            <View key={m.key} style={styles.dimBlock}>
              <View style={styles.dimHeader}>
                <Icon size={18} strokeWidth={1.8} color={color} />
                <Text style={styles.dimTitle}>{zh(m.zh)}</Text>
                {keyword ? <Text style={styles.dimKeyword}>{zh(keyword)}</Text> : null}
                {dim && (
                  <View style={[styles.dimBadge, { borderColor: color }]}>
                    <View style={[styles.dimBadgeDot, { backgroundColor: color }]} />
                    <Text style={[styles.dimBadgeLabel, { color }]}>{zh(dim.label)}</Text>
                  </View>
                )}
              </View>
              {text ? (
                <RichText text={text} style={styles.dimBody} />
              ) : narrative ? (
                <Text style={styles.dimEmpty}>{zh('今年此面向平穩無特別動向')}</Text>
              ) : (
                <SkeletonLines widths={['94%', '90%', '85%', '65%']} />
              )}
            </View>
          );
        })}
      </View>

      {adviceText ? (
        <View style={styles.adviceCard}>
          <Text style={styles.adviceTitle}>{zh('年度建議')}</Text>
          <RichText text={adviceText} style={styles.adviceBody} />
        </View>
      ) : null}

      <Text style={styles.disclaimer}>{zh(DISCLAIMER)}</Text>
    </View>
  );
}

function YearlySkeleton() {
  const zh = useZh();
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{zh('年度總結')}</Text>
        <SkeletonLines widths={['92%', '88%', '70%']} />
        <Text style={styles.skeletonHint}>{zh('AI 命理師正在為您解讀今年命盤…')}</Text>
      </View>
      <View style={styles.dims}>
        {YEARLY_DIM_META.map((m) => {
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
  heroHeadline: { fontFamily: fonts.serif, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  heroBody: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 24 },
  skeletonHint: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  dims: { gap: spacing.md },
  dimBlock: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  dimHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  dimTitle: { fontFamily: fonts.serif, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  dimKeyword: { fontSize: fontSize.xs, color: colors.textSecondary, flex: 1 },
  dimBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  dimBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  dimBadgeLabel: { fontSize: fontSize.xs, fontWeight: '600' },
  dimBody: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 23 },
  dimEmpty: { fontSize: fontSize.sm, color: colors.textMuted },
  adviceCard: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  adviceTitle: { fontFamily: fonts.serif, fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent },
  adviceBody: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 23 },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18, marginTop: spacing.xs },
  skeletonProse: { gap: 6, marginTop: spacing.xs },
  skeletonLine: { height: 12, borderRadius: 4, backgroundColor: colors.borderLight },
  fallback: { gap: spacing.md },
  fallbackLead: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
});
