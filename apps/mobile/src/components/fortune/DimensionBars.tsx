/**
 * DimensionBars — 5 vertical mini bars for daily fortune dimensions
 * (感情/事業/財運/出行/健康). RN port of the web component.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { FortuneDimension } from '../../lib/fortune-api';
import { colors, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { DIM_META, type DimKey } from './dimensions';
import { dimTierFromScore, type DimTier } from './labels';

interface Props {
  dimensions: Record<DimKey, FortuneDimension>;
}

const TRACK_HEIGHT = 88;

function tierColor(t: DimTier): string {
  if (t === 'good') return colors.success;
  if (t === 'mid') return colors.gold;
  return colors.error;
}

/** Text cut of the tier scale — the vivid fills above are ~2.1–3.3:1 and fail as type. */
function tierColorText(t: DimTier): string {
  if (t === 'good') return colors.successText;
  if (t === 'mid') return colors.cautionText;
  return colors.errorText;
}

export default function DimensionBars({ dimensions }: Props) {
  const zh = useZh();
  return (
    <View style={styles.wrap}>
      {DIM_META.map((m) => {
        const dim = dimensions[m.key];
        const score = Math.max(0, Math.min(100, dim?.score ?? 50));
        const t = dimTierFromScore(score);
        const color = tierColor(t);
        const textColor = tierColorText(t);
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
            {dim?.label ? <Text style={[styles.dimLabel, { color: textColor }]}>{zh(dim.label)}</Text> : null}
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
    backgroundColor: colors.ringTrack,
    borderRadius: radius.sm,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: radius.sm },
  score: { fontVariant: ['tabular-nums'] as const, fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  dimName: { fontSize: fontSize.xs, color: colors.textSecondary },
  dimLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
});
