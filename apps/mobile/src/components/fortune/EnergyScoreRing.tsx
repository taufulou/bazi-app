/**
 * EnergyScoreRing — daily 能量指數 circular SVG ring + verdict label band.
 * RN port of apps/web/app/components/fortune/EnergyScoreRing.tsx.
 *
 *   - 7-label is the engine's source of truth; 0-100 score is DERIVED display.
 *   - Date band ABOVE ring: «2026年5月17日 週六» + «辛卯日 · 傷官» sub-line.
 *   - Ring tier color 2-tier: green for 大吉/吉, gold for default.
 *   - Always-visible micro-disclaimer: «※ 能量為輔助顯示 · 以「{label}」為主».
 */
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, fonts, fontSize, spacing } from '../../theme';
import { useZh } from '../../lib/language';
import { formatFortuneDate, friendlyExplanationFromLabel, ringTierFromLabel } from './labels';

interface Props {
  label: string;
  score: number;
  date: string; // YYYY-MM-DD
  dayGanZhi: string;
  dayTenGod: string;
  /** Hide the big date line (keep the 干支·十神 sub-line) — used on the fortune
   *  page where the PeriodNavigator chip already shows the date. */
  hideDateLine?: boolean;
}

const RING_RADIUS = 65;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 150;
const RING_CENTER = RING_SIZE / 2;

export default function EnergyScoreRing({ label, score, date, dayGanZhi, dayTenGod, hideDateLine }: Props) {
  const zh = useZh();
  const clamped = Math.max(0, Math.min(100, score));
  const offset = RING_CIRC * (1 - clamped / 100);
  const tier = ringTierFromLabel(label);
  const tierColor = tier === 'positive' ? colors.success : colors.gold;
  const friendlyExplanation = friendlyExplanationFromLabel(label);
  const { dateLine } = formatFortuneDate(date);

  return (
    <View style={styles.wrap}>
      {/* Date band */}
      <View style={styles.dateBand}>
        {hideDateLine ? null : <Text style={styles.dateLine}>{zh(dateLine)}</Text>}
        <Text style={styles.baziLine}>
          {zh(`${dayGanZhi}日 · ${dayTenGod}`)}
        </Text>
      </View>

      {/* Ring */}
      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke={colors.ringTrack}
            strokeWidth={9}
          />
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
        <View style={styles.scoreText} accessibilityLabel={zh(`今日能量指數 ${clamped} 分`)}>
          <Text style={styles.scoreNumber}>{clamped}</Text>
          <Text style={styles.scoreUnit}>{zh('能量')}</Text>
        </View>
      </View>

      {/* Label band */}
      <View style={[styles.labelBand, { backgroundColor: tierColor }]}>
        <Text style={styles.labelText}>{zh(label)}</Text>
      </View>

      {/* Friendly explanation */}
      <Text style={styles.friendlyExplanation}>{zh(friendlyExplanation)}</Text>

      {/* Micro-disclaimer */}
      <Text style={styles.microDisclaimer}>{zh(`※ 能量為輔助顯示 · 以「${label}」為主`)}</Text>
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
  labelBand: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    marginTop: spacing.xs,
  },
  labelText: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textOnGold },
  friendlyExplanation: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.md },
  microDisclaimer: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
});
