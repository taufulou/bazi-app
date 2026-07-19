/**
 * YearlyDimensionStars — 年運 4-dim ★ star-rating cards. RN port.
 * ★1-5 (engine `stars`) + optional AI keyword + verdict label. No 0-100 score.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { YearlyFortuneDimension } from '../../lib/fortune-api';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { YEARLY_DIM_META, type YearlyDimKey } from './yearlyDimensions';
import { dimTierFromScore, type DimTier } from './labels';

interface Props {
  dimensions: Record<YearlyDimKey, YearlyFortuneDimension>;
  keywords?: Partial<Record<YearlyDimKey, string | undefined>>;
}

const MAX_STARS = 5;

function tierColor(t: DimTier): string {
  if (t === 'good') return colors.success;
  if (t === 'mid') return colors.gold;
  return colors.error;
}

function StarRow({ stars, color, dimZh }: { stars: number; color: string; dimZh: string }) {
  const filled = Math.max(0, Math.min(MAX_STARS, Math.round(stars)));
  return (
    <View style={styles.stars} accessibilityLabel={`${dimZh}：${filled} 顆星（共 ${MAX_STARS} 顆）`}>
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <Text key={i} style={[styles.star, { color: i < filled ? color : colors.borderMedium }]}>
          {i < filled ? '★' : '☆'}
        </Text>
      ))}
    </View>
  );
}

export default function YearlyDimensionStars({ dimensions, keywords }: Props) {
  const zh = useZh();
  return (
    <View style={styles.wrap}>
      {YEARLY_DIM_META.map((m) => {
        const dim = dimensions[m.key];
        const stars = dim?.stars ?? 3;
        const score = dim?.score ?? 50;
        const color = tierColor(dimTierFromScore(score));
        const keyword = keywords?.[m.key];
        const { Icon } = m;
        return (
          <View key={m.key} style={styles.card}>
            <View style={styles.cardHeader}>
              <Icon size={18} strokeWidth={1.8} color={color} />
              <Text style={styles.dimName}>{zh(m.zh)}</Text>
            </View>
            <StarRow stars={stars} color={color} dimZh={m.zh} />
            {keyword ? <Text style={styles.keyword}>{zh(keyword)}</Text> : null}
            {dim?.label ? <Text style={[styles.dimLabel, { color }]}>{zh(dim.label)}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    alignItems: 'center',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dimName: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  stars: { flexDirection: 'row', gap: 2 },
  star: { fontSize: fontSize.lg },
  keyword: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center' },
  dimLabel: { fontSize: fontSize.sm, fontWeight: '700' },
});
