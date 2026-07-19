/**
 * YearlyEnergyRing — 年運 yearly 能量指數 SVG ring. RN port.
 * Date band «2026年» + «丙午年·偏官».
 */
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, fonts, fontSize, spacing } from '../../theme';
import { useZh } from '../../lib/language';
import { friendlyExplanationFromLabel, ringTierFromLabel } from './labels';

interface Props {
  label: string;
  score: number;
  year: number;
  yearGanZhi: string;
  yearTenGod: string;
  /** Hide the big year line (kept 干支·十神) — chip already shows the year. */
  hideDateLine?: boolean;
}

const RING_RADIUS = 65;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 150;
const RING_CENTER = RING_SIZE / 2;

function yearlyFriendlyExplanation(label: string): string {
  return friendlyExplanationFromLabel(label, 'year');
}

export default function YearlyEnergyRing({ label, score, year, yearGanZhi, yearTenGod, hideDateLine }: Props) {
  const zh = useZh();
  const clamped = Math.max(0, Math.min(100, score));
  const offset = RING_CIRC * (1 - clamped / 100);
  const tierColor = ringTierFromLabel(label) === 'positive' ? colors.success : colors.gold;

  return (
    <View style={styles.wrap}>
      <View style={styles.dateBand}>
        {hideDateLine ? null : <Text style={styles.dateLine}>{zh(`${year}年`)}</Text>}
        <Text style={styles.baziLine}>{zh(`${yearGanZhi}年 · ${yearTenGod}`)}</Text>
      </View>

      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <Circle cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" stroke={colors.ringTrack} strokeWidth={9} />
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke={tierColor}
            strokeWidth={9}
            strokeDasharray={RING_CIRC}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
          />
        </Svg>
        <View style={styles.scoreText} accessibilityLabel={zh(`今年能量指數 ${clamped} 分`)}>
          <Text style={styles.scoreNumber}>{clamped}</Text>
          <Text style={styles.scoreUnit}>{zh('能量')}</Text>
        </View>
      </View>

      <View style={[styles.labelBand, { backgroundColor: tierColor }]}>
        <Text style={styles.labelText}>{zh(label)}</Text>
      </View>

      <Text style={styles.friendlyExplanation}>{zh(yearlyFriendlyExplanation(label))}</Text>
      <Text style={styles.microDisclaimer}>{zh(`※ 今年能量為輔助顯示 · 以「${label}」為主`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  dateBand: { alignItems: 'center', gap: 2, marginBottom: spacing.xs },
  dateLine: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  baziLine: { fontSize: fontSize.sm, color: colors.textSecondary },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  scoreText: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  scoreNumber: { fontVariant: ['tabular-nums'] as const, fontFamily: fonts.serifBold, fontSize: 44, fontWeight: '800', color: colors.textPrimary, lineHeight: 48 },
  scoreUnit: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  labelBand: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: 999, marginTop: spacing.xs },
  labelText: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textOnGold },
  friendlyExplanation: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.md },
  microDisclaimer: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
});
