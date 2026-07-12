/**
 * ShareableYearlyFortuneCard — capture target for the 年運 share PNG. RN.
 * Brand + year band + ring + label + 4-dim ★ stars + 核心風險&機會 (top opp/risk
 * month) + luck-method titles + QR. No profile name (privacy).
 */
import { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import type {
  YearlyFortuneDimension,
  YearlyCoreRiskOpportunity,
  YearlyLuckMethods,
} from '../../lib/fortune-api';
import { friendlyExplanationFromLabel, ringTierFromLabel } from './labels';
import { YEARLY_DIM_META, type YearlyDimKey } from './yearlyDimensions';

interface Props {
  year: number;
  yearGanZhi: string;
  yearTenGod: string;
  auspiciousness: string;
  energyScore: number;
  dimensions: Record<YearlyDimKey, YearlyFortuneDimension>;
  coreRiskOpportunity: YearlyCoreRiskOpportunity;
  luckMethods: YearlyLuckMethods;
}

const RING_RADIUS = 58;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 136;
const RING_CENTER = RING_SIZE / 2;
const SHARE_URL = 'https://baziapp.com';
const MAX_STARS = 5;

function stars(n: number): string {
  const filled = Math.max(0, Math.min(MAX_STARS, Math.round(n)));
  return '★'.repeat(filled) + '☆'.repeat(MAX_STARS - filled);
}

const ShareableYearlyFortuneCard = forwardRef<View, Props>(function ShareableYearlyFortuneCard(
  { year, yearGanZhi, yearTenGod, auspiciousness, energyScore, dimensions, coreRiskOpportunity, luckMethods },
  ref,
) {
  const clamped = Math.max(0, Math.min(100, energyScore));
  const offset = RING_CIRC * (1 - clamped / 100);
  const tierColor = ringTierFromLabel(auspiciousness) === 'positive' ? colors.success : colors.gold;
  const friendly = friendlyExplanationFromLabel(auspiciousness).replace(/今日/g, '今年');
  const topOpp = coreRiskOpportunity.opportunities[0];
  const topRisk = coreRiskOpportunity.risks[0];
  const methodTitles = (luckMethods.cards ?? []).slice(0, 3).map((c) => c.title);

  return (
    <View ref={ref} style={styles.card} collapsable={false}>
      <View style={styles.brandHeader}>
        <Text style={styles.brandWordmark}>天命 BaziApp</Text>
        <Text style={styles.brandTagline}>命理年運</Text>
      </View>

      <View style={styles.dateBand}>
        <Text style={styles.dateLine}>{`${year}年`}</Text>
        <Text style={styles.baziLine}>{`${yearGanZhi}年 · ${yearTenGod}`}</Text>
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

      {/* 4-dim ★ stars */}
      <View style={styles.starGrid}>
        {YEARLY_DIM_META.map((m) => (
          <View key={m.key} style={styles.starSlot}>
            <Text style={styles.dimName}>{m.zh}</Text>
            <Text style={[styles.starText, { color: tierColor }]}>{stars(dimensions[m.key]?.stars ?? 3)}</Text>
          </View>
        ))}
      </View>

      {/* Top opportunity / risk month */}
      {topOpp || topRisk ? (
        <View style={styles.roRow}>
          {topOpp ? (
            <View style={styles.roSlot}>
              <Text style={[styles.roLabel, { color: colors.success }]}>💡 機會</Text>
              <Text style={styles.roValue}>{`${topOpp.monthLabel} ${topOpp.dimZh}`}</Text>
            </View>
          ) : null}
          {topRisk ? (
            <View style={styles.roSlot}>
              <Text style={[styles.roLabel, { color: colors.error }]}>🛡️ 風險</Text>
              <Text style={styles.roValue}>{`${topRisk.monthLabel} ${topRisk.dimZh}`}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Luck-method titles */}
      {methodTitles.length > 0 ? (
        <Text style={styles.methods}>{`改運：${methodTitles.join(' · ')}`}</Text>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.footerDivider} />
        <View style={styles.footerInner}>
          <View style={styles.qrBox}>
            <QRCode value={SHARE_URL} size={72} color={colors.textPrimary} backgroundColor="#FFFFFF" />
          </View>
          <View style={styles.footerText}>
            <Text style={styles.footerDomain}>baziapp.com</Text>
            <Text style={styles.footerTagline}>掃描查看您自己的命理年運</Text>
            <Text style={styles.footerDisclaimer}>※ 流年為趨勢，僅供參考，不構成任何專業建議</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

export default ShareableYearlyFortuneCard;

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
  starGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', alignSelf: 'stretch', rowGap: spacing.sm },
  starSlot: { flexBasis: '46%', alignItems: 'center', gap: 2 },
  dimName: { fontSize: fontSize.sm, color: colors.textSecondary },
  starText: { fontSize: fontSize.base, letterSpacing: 1 },
  roRow: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch' },
  roSlot: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.sm, gap: 2, alignItems: 'center' },
  roLabel: { fontSize: fontSize.xs, fontWeight: '700' },
  roValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '700' },
  methods: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center' },
  footer: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.xs },
  footerDivider: { height: 1, backgroundColor: colors.borderLight },
  footerInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qrBox: { backgroundColor: '#FFFFFF', padding: 6, borderRadius: radius.sm },
  footerText: { flex: 1, gap: 2 },
  footerDomain: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  footerTagline: { fontSize: fontSize.xs, color: colors.textSecondary },
  footerDisclaimer: { fontSize: 10, color: colors.textMuted, lineHeight: 14 },
});
