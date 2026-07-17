/**
 * CompatibilityScoreRevealV2 — the 合盤 romance score reveal. RN port of the web
 * CompatibilityScoreRevealV2: SVG count-up ring + mini breakdown bars +
 * 🌸桃花/💍姻緣星 badges + <55 reassurance + 老師寄語 card. Count-up via a rAF
 * loop (Hermes supports requestAnimationFrame); the web's staggered phase timers
 * are collapsed to a single post-count-up render for robustness.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import type { RomancePreAnalysis } from '../../lib/readings-api';

interface Props {
  score: number;
  label: string;
  scoreBreakdown?: RomancePreAnalysis['scoreBreakdown'];
  nameA: string;
  nameB: string;
  peachBlossomCountA: number;
  peachBlossomCountB: number;
  spouseStarCountA: number;
  spouseStarCountB: number;
  romancePA?: RomancePreAnalysis;
}

const SIZE = 180;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

function scoreColor(score: number): string {
  if (score >= 85) return colors.success;
  if (score >= 70) return '#4CAF50';
  if (score >= 55) return colors.gold;
  if (score >= 40) return colors.orange;
  return colors.error;
}

export default function CompatibilityScoreRevealV2({
  score,
  label,
  scoreBreakdown,
  nameA,
  nameB,
  peachBlossomCountA,
  peachBlossomCountB,
  spouseStarCountA,
  spouseStarCountB,
  romancePA,
}: Props) {
  const zh = useZh();
  const [displayScore, setDisplayScore] = useState(0);
  const rafRef = useRef<number>(0);

  // Count-up (2s, ease-out cubic).
  useEffect(() => {
    let mounted = true;
    const duration = 1600;
    const start = Date.now();
    const tick = () => {
      if (!mounted) return;
      const t = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(eased * score));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [score]);

  const color = scoreColor(score);
  const offset = CIRC * (1 - displayScore / 100);

  const sweetness = romancePA?.postMarriageQuality?.sweetness?.score ?? 50;
  const stability = romancePA?.postMarriageQuality?.stability?.score ?? 50;
  const crisisLevel =
    romancePA?.combinedCrisis?.destructiveLevel ?? romancePA?.combinedCrisis?.overallLevel ?? '';

  const opening =
    score >= 65
      ? `從${nameA}和${nameB}的八字命盤來看，兩人的感情配對有不少值得期待的地方。`
      : score >= 45
        ? `從${nameA}和${nameB}的八字命盤來看，兩人的配對有優勢也有挑戰，需要用心經營。`
        : `從${nameA}和${nameB}的八字命盤來看，兩人在某些方面存在差異，但這不代表沒有幸福的可能。`;

  const qualityLine =
    sweetness >= 80 && stability >= 80
      ? '婚後相處品質相當高，兩人能感受到幸福和安全感。'
      : sweetness >= 60 || stability >= 60
        ? '婚後有一定的相處基礎，但需要雙方共同用心經營。'
        : '婚後需要較多的包容和磨合，建議提前了解彼此的差異。';

  const crisisLine =
    crisisLevel === '輕微' || crisisLevel === '良好'
      ? '合婚危機等級較低，這是長久穩定的好基礎。'
      : crisisLevel === '中等'
        ? '存在一些需要注意的合婚風險，但只要雙方願意溝通，都可以化解。'
        : '合婚方面有些挑戰需要正視，了解風險才能更好地經營關係。';

  const metricTone = (v: number) => (v >= 70 ? colors.success : v >= 40 ? colors.orange : colors.error);
  const crisisTone =
    crisisLevel === '輕微' || crisisLevel === '良好'
      ? colors.success
      : crisisLevel === '中等'
        ? colors.orange
        : colors.error;

  return (
    <View style={styles.container}>
      {/* Ring */}
      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(212,160,23,0.25)" strokeWidth={STROKE} />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={styles.ringCenter}>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreNumber, { color }]}>{displayScore}</Text>
            <Text style={styles.scoreUnit}>{zh('分')}</Text>
          </View>
          <Text style={styles.scoreLabel}>{zh(label)}</Text>
        </View>
      </View>

      {/* Breakdown mini-bars */}
      {scoreBreakdown ? (
        <View style={styles.breakdown}>
          <BarRow label={zh('配對契合')} value={scoreBreakdown.baseScore ?? 0} />
          <BarRow label={zh('婚後品質')} value={scoreBreakdown.romanceAvg ?? 0} />
        </View>
      ) : null}

      {/* Badges */}
      <View style={styles.badgesRow}>
        <PersonBadges zh={zh} name={nameA} peach={peachBlossomCountA} spouse={spouseStarCountA} />
        <PersonBadges zh={zh} name={nameB} peach={peachBlossomCountB} spouse={spouseStarCountB} />
      </View>

      {/* Reassurance (<55) */}
      {score < 55 ? (
        <View style={styles.reassurance}>
          <Text style={styles.reassuranceTitle}>💡 {zh('分數不等於命運')}</Text>
          <Text style={styles.reassuranceText}>
            {zh(
              '配對分數反映的是兩人先天命盤的契合度，而非最終結果。許多高分配對因為不經營而失敗，低分配對反而因為彼此珍惜而幸福美滿。了解差異，才能更好地相處。',
            )}
          </Text>
        </View>
      ) : null}

      {/* 老師寄語 */}
      <View style={styles.masterNote}>
        <Text style={styles.masterNoteTitle}>📋 {zh('老師寄語')}</Text>
        <Text style={styles.masterNoteSummary}>{zh(opening)}</Text>
        <View style={styles.metricsRow}>
          <Metric zh={zh} label="甜蜜度" value={`${sweetness}`} suffix="分" color={metricTone(sweetness)} />
          <Metric zh={zh} label="穩定度" value={`${stability}`} suffix="分" color={metricTone(stability)} />
          <Metric zh={zh} label="危機等級" value={crisisLevel || '—'} color={crisisTone} />
        </View>
        <Text style={styles.masterNoteEncouragement}>💬 {zh(qualityLine + crisisLine)}</Text>
        <Text style={styles.masterNoteFooter}>
          {zh('以下為詳細的逐項分析，幫助你們更深入了解彼此的感情特質和相處模式。')}
        </Text>
      </View>
    </View>
  );
}

function BarRow({ label, value }: { label: string; value: number }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${w}%`, backgroundColor: scoreColor(w) }]} />
      </View>
      <Text style={styles.barValue}>{Math.round(value)}</Text>
    </View>
  );
}

function PersonBadges({
  zh,
  name,
  peach,
  spouse,
}: {
  zh: (s: string) => string;
  name: string;
  peach: number;
  spouse: number;
}) {
  return (
    <View style={styles.personBadges}>
      <Text style={styles.personName}>{name}</Text>
      <Text style={styles.badge}>{zh(`🌸 桃花 ${peach}朵`)}</Text>
      <Text style={styles.badge}>{zh(`💍 姻緣星 ${spouse}顆`)}</Text>
    </View>
  );
}

function Metric({
  zh,
  label,
  value,
  suffix,
  color,
}: {
  zh: (s: string) => string;
  label: string;
  value: string;
  suffix?: string;
  color: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{zh(label)}</Text>
      <Text style={[styles.metricValue, { color }]}>
        {value}
        {suffix ? <Text style={styles.metricSuffix}>{zh(suffix)}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.lg },
  ringWrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end' },
  scoreNumber: { fontFamily: fonts.serifBold, fontSize: 52, fontWeight: '800', lineHeight: 56 },
  scoreUnit: { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: 8, marginLeft: 2 },
  scoreLabel: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent, marginTop: 2 },
  breakdown: { alignSelf: 'stretch', gap: spacing.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { width: 68, fontSize: fontSize.sm, color: colors.textSecondary },
  barTrack: { flex: 1, height: 10, borderRadius: 999, backgroundColor: colors.borderLight, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 999 },
  barValue: { width: 28, textAlign: 'right', fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  badgesRow: { alignSelf: 'stretch', gap: spacing.sm },
  personBadges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  personName: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, minWidth: 56 },
  badge: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    backgroundColor: colors.bgSecondary,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  reassurance: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgBannerWarm,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  reassuranceTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent },
  reassuranceText: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
  masterNote: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  masterNoteTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent },
  masterNoteSummary: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 22 },
  metricsRow: { flexDirection: 'row', gap: spacing.sm },
  metricCard: { flex: 1, alignItems: 'center', backgroundColor: colors.bgSecondary, borderRadius: radius.md, paddingVertical: spacing.sm },
  metricLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  metricValue: { fontSize: fontSize.lg, fontWeight: '800' },
  metricSuffix: { fontSize: fontSize.xs, color: colors.textMuted },
  masterNoteEncouragement: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
  masterNoteFooter: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
});
