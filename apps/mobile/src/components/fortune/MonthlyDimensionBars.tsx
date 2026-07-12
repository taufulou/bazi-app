/**
 * MonthlyDimensionBars — 月運 4-dim vertical mini bars (no 出行). RN port.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { MonthlyFortuneDimension } from '../../lib/fortune-api';
import { colors, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { MONTHLY_DIM_META, type MonthlyDimKey } from './monthlyDimensions';
import { dimTierFromScore, type DimTier } from './labels';

interface Props {
  dimensions: Record<MonthlyDimKey, MonthlyFortuneDimension>;
}

const TRACK_HEIGHT = 88;

function tierColor(t: DimTier): string {
  if (t === 'good') return colors.success;
  if (t === 'mid') return colors.gold;
  return colors.error;
}

export default function MonthlyDimensionBars({ dimensions }: Props) {
  const zh = useZh();
  return (
    <View style={styles.wrap}>
      {MONTHLY_DIM_META.map((m) => {
        const dim = dimensions[m.key];
        const score = Math.max(0, Math.min(100, dim?.score ?? 50));
        const color = tierColor(dimTierFromScore(score));
        const { Icon } = m;
        return (
          <View
            key={m.key}
            style={styles.col}
            accessibilityLabel={zh(`${m.zh}：${score}分${dim?.label ? `，${dim.label}` : ''}`)}
          >
            <Icon size={20} strokeWidth={1.8} color={color} />
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { height: `${score}%`, backgroundColor: color }]} />
            </View>
            <Text style={styles.score}>{score}</Text>
            <Text style={styles.dimName}>{zh(m.zh)}</Text>
            {dim?.label ? <Text style={[styles.dimLabel, { color }]}>{zh(dim.label)}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', paddingVertical: spacing.md },
  col: { alignItems: 'center', gap: spacing.xs, flex: 1 },
  barTrack: {
    width: 10,
    height: TRACK_HEIGHT,
    backgroundColor: colors.borderLight,
    borderRadius: radius.sm,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: radius.sm },
  score: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  dimName: { fontSize: fontSize.xs, color: colors.textSecondary },
  dimLabel: { fontSize: 10, fontWeight: '600' },
});
