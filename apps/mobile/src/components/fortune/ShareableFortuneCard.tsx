/**
 * ShareableFortuneCard — the capture target for the daily-fortune share PNG.
 * RN port of the web card, rasterized by react-native-view-shot (captureRef).
 *
 * Layout: brand wordmark + date band + energy ring (SVG) + label band +
 * friendly line + one canTry takeaway + folk 2×2 grid (吉色/吉數[民俗]/宜食/吉時)
 * + QR footer. NO profile name (privacy — shared cards must not leak names).
 *
 * Rendered inside a preview Modal (ShareFortuneButton) so it's laid out before
 * capture. `forwardRef` exposes the outer View for `captureRef`.
 */
import { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import type { DailyFortuneResponse } from '../../lib/fortune-api';
import { formatFortuneDate, friendlyExplanationFromLabel, ringTierFromLabel } from './labels';

interface Props {
  data: DailyFortuneResponse;
}

const RING_RADIUS = 58;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 136;
const RING_CENTER = RING_SIZE / 2;
const SHARE_URL = 'https://baziapp.com';

const ShareableFortuneCard = forwardRef<View, Props>(function ShareableFortuneCard({ data }, ref) {
  const { engineOutput, narrative, date } = data;
  const { auspiciousness, energyScore, dayGanZhi, dayTenGod, folkContent } = engineOutput;
  const clamped = Math.max(0, Math.min(100, energyScore));
  const offset = RING_CIRC * (1 - clamped / 100);
  const tierColor = ringTierFromLabel(auspiciousness) === 'positive' ? colors.success : colors.gold;
  const { dateLine } = formatFortuneDate(date);
  const friendly = friendlyExplanationFromLabel(auspiciousness);
  const takeaway = narrative?.daily_advice?.canTry?.[0] ?? '';

  const luckyColor = folkContent?.luckyColor
    ? [folkContent.luckyColor.primary, folkContent.luckyColor.secondary].filter(Boolean).join('／')
    : null;
  const luckyNumber = folkContent?.luckyNumber?.numbers?.length ? folkContent.luckyNumber.numbers.join('、') : null;
  const luckyFood = folkContent?.luckyFoodFavor?.category ?? null;
  const auspiciousHours = folkContent?.auspiciousHours?.length
    ? folkContent.auspiciousHours.map((h) => h.branch).join('、')
    : null;
  const hasFolk = luckyColor || luckyNumber || luckyFood || auspiciousHours;

  return (
    <View ref={ref} style={styles.card} collapsable={false}>
      <View style={styles.brandHeader}>
        <Text style={styles.brandWordmark}>天命 BaziApp</Text>
        <Text style={styles.brandTagline}>命理日運</Text>
      </View>

      <View style={styles.dateBand}>
        <Text style={styles.dateLine}>{dateLine}</Text>
        <Text style={styles.baziLine}>{`${dayGanZhi}日 · ${dayTenGod}`}</Text>
      </View>

      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <Circle cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" stroke={colors.borderLight} strokeWidth={11} />
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke={tierColor}
            strokeWidth={11}
            strokeDasharray={RING_CIRC}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
          />
        </Svg>
        <View style={styles.scoreText}>
          <Text style={styles.scoreNumber}>{clamped}</Text>
          <Text style={styles.scoreUnit}>能量</Text>
        </View>
      </View>

      <View style={[styles.labelBand, { backgroundColor: tierColor }]}>
        <Text style={styles.labelText}>{auspiciousness}</Text>
      </View>
      <Text style={styles.friendly}>{friendly}</Text>

      {takeaway ? <Text style={styles.takeaway}>{`「${takeaway}」`}</Text> : null}

      {hasFolk ? (
        <View style={styles.folkGrid}>
          {luckyColor ? (
            <View style={styles.folkSlot}>
              <Text style={styles.folkLabel}>🌈 吉色</Text>
              <Text style={styles.folkValue}>{luckyColor}</Text>
            </View>
          ) : null}
          {luckyNumber ? (
            <View style={styles.folkSlot}>
              <Text style={styles.folkLabel}>
                🔢 吉數 <Text style={styles.folkBadge}>民俗</Text>
              </Text>
              <Text style={styles.folkValue}>{luckyNumber}</Text>
            </View>
          ) : null}
          {luckyFood ? (
            <View style={styles.folkSlot}>
              <Text style={styles.folkLabel}>🍃 今日宜食</Text>
              <Text style={styles.folkValue}>{luckyFood}</Text>
            </View>
          ) : null}
          {auspiciousHours ? (
            <View style={styles.folkSlot}>
              <Text style={styles.folkLabel}>🕘 吉時</Text>
              <Text style={styles.folkValue}>{auspiciousHours}</Text>
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
            <Text style={styles.footerTagline}>掃描查看您自己的命理日運</Text>
            <Text style={styles.footerDisclaimer}>※ 流日為觸發點，僅供參考，不構成任何專業建議</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

export default ShareableFortuneCard;

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
  dateBand: { alignItems: 'center', gap: 2 },
  dateLine: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  baziLine: { fontSize: fontSize.sm, color: colors.textSecondary },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  scoreText: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  scoreNumber: { fontFamily: fonts.serifBold, fontSize: 40, fontWeight: '800', color: colors.textPrimary, lineHeight: 44 },
  scoreUnit: { fontSize: 10, color: colors.textMuted },
  labelBand: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: 999 },
  labelText: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textOnGold },
  friendly: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  takeaway: { fontSize: fontSize.sm, color: colors.textAccent, textAlign: 'center', fontWeight: '600', paddingHorizontal: spacing.md },
  folkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  folkSlot: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 2,
  },
  folkLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  folkBadge: { fontSize: 10, color: '#8b6f47', fontStyle: 'italic' },
  folkValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '700' },
  footer: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.xs },
  footerDivider: { height: 1, backgroundColor: colors.borderLight },
  footerInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qrBox: { backgroundColor: '#FFFFFF', padding: 6, borderRadius: radius.sm },
  footerText: { flex: 1, gap: 2 },
  footerDomain: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  footerTagline: { fontSize: fontSize.xs, color: colors.textSecondary },
  footerDisclaimer: { fontSize: 10, color: colors.textMuted, lineHeight: 14 },
});
