/**
 * ShareableCompatibilityCard — capture target for the 合盤 share PNG (net-new;
 * the web has no compat share card, only a URL share). Rasterized by
 * react-native-view-shot via the generic ShareFortuneButton.
 *
 * Layout: brand wordmark + «nameA ❤ nameB» + score ring (SVG) + label band +
 * 甜蜜度/穩定度 mini-metrics + QR footer. Names are shown (the user is sharing
 * their OWN relationship result — that's the point of a compat card).
 */
import { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';

interface Props {
  score: number;
  label: string;
  nameA: string;
  nameB: string;
  sweetness?: number;
  stability?: number;
}

const RING_RADIUS = 58;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 136;
const RING_CENTER = RING_SIZE / 2;
const SHARE_URL = 'https://baziapp.com';

function scoreColor(score: number): string {
  if (score >= 85) return colors.success;
  if (score >= 70) return '#4CAF50';
  if (score >= 55) return colors.gold;
  if (score >= 40) return colors.orange;
  return colors.error;
}

const ShareableCompatibilityCard = forwardRef<View, Props>(function ShareableCompatibilityCard(
  { score, label, nameA, nameB, sweetness, stability },
  ref,
) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = RING_CIRC * (1 - clamped / 100);
  const color = scoreColor(clamped);

  return (
    <View ref={ref} style={styles.card} collapsable={false}>
      <View style={styles.brandHeader}>
        <Text style={styles.brandWordmark}>天命 BaziApp</Text>
        <Text style={styles.brandTagline}>八字合盤</Text>
      </View>

      <View style={styles.namesRow}>
        <Text style={styles.name} numberOfLines={1}>{nameA}</Text>
        <Text style={styles.heart}>❤</Text>
        <Text style={styles.name} numberOfLines={1}>{nameB}</Text>
      </View>

      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <Circle cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" stroke="rgba(212,160,23,0.25)" strokeWidth={11} />
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={11}
            strokeDasharray={RING_CIRC}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
          />
        </Svg>
        <View style={styles.scoreText}>
          <Text style={[styles.scoreNumber, { color }]}>{clamped}</Text>
          <Text style={styles.scoreUnit}>配對分數</Text>
        </View>
      </View>

      <View style={[styles.labelBand, { backgroundColor: color }]}>
        <Text style={styles.labelText}>{label}</Text>
      </View>

      {sweetness != null || stability != null ? (
        <View style={styles.metricsRow}>
          {sweetness != null ? (
            <View style={styles.metricSlot}>
              <Text style={styles.metricLabel}>甜蜜度</Text>
              <Text style={styles.metricValue}>{sweetness}</Text>
            </View>
          ) : null}
          {stability != null ? (
            <View style={styles.metricSlot}>
              <Text style={styles.metricLabel}>穩定度</Text>
              <Text style={styles.metricValue}>{stability}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.footerDivider} />
        <View style={styles.footerInner}>
          <View style={styles.qrBox}>
            <QRCode value={SHARE_URL} size={72} color={colors.textPrimary} backgroundColor="#FFFFFF" />
          </View>
          <View style={styles.footerText}>
            <Text style={styles.footerDomain}>baziapp.com</Text>
            <Text style={styles.footerTagline}>掃描測測你們的八字合盤</Text>
            <Text style={styles.footerDisclaimer}>※ 合盤僅供參考與娛樂用途，不構成任何專業建議</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

export default ShareableCompatibilityCard;

const styles = StyleSheet.create({
  card: {
    width: 340,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'center',
  },
  brandHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, alignSelf: 'flex-start' },
  brandWordmark: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '800', color: colors.red },
  brandTagline: { fontSize: fontSize.xs, color: colors.textMuted },
  namesRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '100%' },
  name: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  heart: { fontSize: fontSize.lg, color: colors.red },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  scoreText: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  scoreNumber: { fontFamily: fonts.serifBold, fontSize: 40, fontWeight: '800', lineHeight: 44 },
  scoreUnit: { fontSize: 10, color: colors.textMuted },
  labelBand: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: 999 },
  labelText: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textOnRed },
  metricsRow: { flexDirection: 'row', gap: spacing.md },
  metricSlot: { alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  metricLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  metricValue: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '800', color: colors.textAccent },
  footer: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.xs },
  footerDivider: { height: 1, backgroundColor: colors.borderLight },
  footerInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qrBox: { backgroundColor: '#FFFFFF', padding: 6, borderRadius: radius.sm },
  footerText: { flex: 1, gap: 2 },
  footerDomain: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  footerTagline: { fontSize: fontSize.xs, color: colors.textSecondary },
  footerDisclaimer: { fontSize: 10, color: colors.textMuted, lineHeight: 14 },
});
