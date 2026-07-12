/**
 * ShareableMonthlyFortuneCard — capture target for the 月運 share PNG. RN.
 * Mirrors ShareableFortuneCard for MONTH scope: brand + month band + ring +
 * label + 4-dim summary + 上半月/下半月 day-count summary (from intraMonthBreakdown)
 * + QR. NO folk grid (folk content is day-only). No profile name (privacy).
 */
import { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import type { MonthlyFortuneDimension, IntraMonthBreakdown } from '../../lib/fortune-api';
import { friendlyExplanationFromLabel, ringTierFromLabel } from './labels';
import { MONTHLY_DIM_META, type MonthlyDimKey } from './monthlyDimensions';

interface Props {
  month: string; // YYYY-MM
  monthGanZhi: string;
  monthTenGod: string;
  auspiciousness: string;
  energyScore: number;
  dimensions: Record<MonthlyDimKey, MonthlyFortuneDimension>;
  intraMonthBreakdown?: IntraMonthBreakdown;
}

const RING_RADIUS = 58;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 136;
const RING_CENTER = RING_SIZE / 2;
const SHARE_URL = 'https://baziapp.com';

function formatMonthIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})$/);
  return m ? `${Number(m[1])}年${Number(m[2])}月` : iso;
}

const ShareableMonthlyFortuneCard = forwardRef<View, Props>(function ShareableMonthlyFortuneCard(
  { month, monthGanZhi, monthTenGod, auspiciousness, energyScore, dimensions, intraMonthBreakdown },
  ref,
) {
  const clamped = Math.max(0, Math.min(100, energyScore));
  const offset = RING_CIRC * (1 - clamped / 100);
  const tierColor = ringTierFromLabel(auspiciousness) === 'positive' ? colors.success : colors.gold;
  const friendly = friendlyExplanationFromLabel(auspiciousness).replace(/今日/g, '本月');
  const buckets = intraMonthBreakdown?.buckets ?? [];

  return (
    <View ref={ref} style={styles.card} collapsable={false}>
      <View style={styles.brandHeader}>
        <Text style={styles.brandWordmark}>天命 BaziApp</Text>
        <Text style={styles.brandTagline}>命理月運</Text>
      </View>

      <View style={styles.dateBand}>
        <Text style={styles.dateLine}>{formatMonthIso(month)}</Text>
        <Text style={styles.baziLine}>{`${monthGanZhi}月 · ${monthTenGod}`}</Text>
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

      {/* 4-dim summary row */}
      <View style={styles.dimRow}>
        {MONTHLY_DIM_META.map((m) => {
          const dim = dimensions[m.key];
          return (
            <View key={m.key} style={styles.dimChip}>
              <Text style={styles.dimName}>{m.zh}</Text>
              <Text style={styles.dimLabel}>{dim?.label ?? '—'}</Text>
            </View>
          );
        })}
      </View>

      {/* 上半月 / 下半月 day-count summary */}
      {buckets.length > 0 ? (
        <View style={styles.gridRow}>
          {buckets.map((b) => (
            <View key={b.label} style={styles.gridSlot}>
              <Text style={styles.gridLabel}>{b.label}</Text>
              <Text style={styles.gridValue}>
                吉 {b.auspicious_days} · 凶 {b.challenging_days}
              </Text>
            </View>
          ))}
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
            <Text style={styles.footerTagline}>掃描查看您自己的命理月運</Text>
            <Text style={styles.footerDisclaimer}>※ 流月為趨勢，僅供參考，不構成任何專業建議</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

export default ShareableMonthlyFortuneCard;

const styles = StyleSheet.create({
  card: { width: 340, backgroundColor: colors.bgSecondary, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, alignItems: 'center' },
  brandHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, alignSelf: 'flex-start' },
  brandWordmark: { fontFamily: fonts.serif, fontSize: fontSize.lg, fontWeight: '800', color: colors.red },
  brandTagline: { fontSize: fontSize.xs, color: colors.textMuted },
  dateBand: { alignItems: 'center', gap: 2 },
  dateLine: { fontFamily: fonts.serif, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  baziLine: { fontSize: fontSize.sm, color: colors.textSecondary },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  scoreText: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  scoreNumber: { fontFamily: fonts.serif, fontSize: 40, fontWeight: '800', color: colors.textPrimary, lineHeight: 44 },
  scoreUnit: { fontSize: 10, color: colors.textMuted },
  labelBand: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: 999 },
  labelText: { fontFamily: fonts.serif, fontSize: fontSize.lg, fontWeight: '700', color: colors.textOnGold },
  friendly: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  dimRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  dimChip: { alignItems: 'center', gap: 2 },
  dimName: { fontSize: fontSize.sm, color: colors.textSecondary },
  dimLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  gridRow: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch' },
  gridSlot: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.sm, gap: 2, alignItems: 'center' },
  gridLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  gridValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '700' },
  footer: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.xs },
  footerDivider: { height: 1, backgroundColor: colors.borderLight },
  footerInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qrBox: { backgroundColor: '#FFFFFF', padding: 6, borderRadius: radius.sm },
  footerText: { flex: 1, gap: 2 },
  footerDomain: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  footerTagline: { fontSize: fontSize.xs, color: colors.textSecondary },
  footerDisclaimer: { fontSize: 10, color: colors.textMuted, lineHeight: 14 },
});
