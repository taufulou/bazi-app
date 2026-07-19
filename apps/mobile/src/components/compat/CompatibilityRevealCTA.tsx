/**
 * CompatibilityRevealCTA — the 合盤 romance "reveal full report" gate. RN port
 * of the web CompatibilityRomancePaywallCTA, but with HONEST framing: credits
 * are deducted at comparison-create (backend charges `service.creditCost` even
 * with skipAI — see bazi.service.ts createComparison), so the AI stream is
 * ALREADY PAID. The web's paywall shows a misleading "💎 N 點" badge on unlock
 * (a second charge that never happens); we drop it and frame this as revealing
 * the already-purchased report. Keeps the feature list + per-party 時辰未知
 * (unknown birth hour) warnings.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

interface Props {
  onReveal: () => void;
  isRevealing: boolean;
  hourUnknownA?: boolean;
  hourUnknownB?: boolean;
  /** actual genders drive 男方/女方 so the label agrees with the AI narrative. */
  genderA?: string;
  genderB?: string;
}

const FEATURES = [
  '合盤分數 & 八維度分析',
  '雙方命局特點',
  '戀愛性格分析',
  '旺夫/旺妻分析',
  '婚前婚後財富',
  '婚後甜蜜度&穩定度',
  '婚變危機預測',
  '經營婚姻建議',
  '本年感情運勢',
];

export default function CompatibilityRevealCTA({
  onReveal,
  isRevealing,
  hourUnknownA = false,
  hourUnknownB = false,
  genderA = 'male',
  genderB = 'female',
}: Props) {
  const zh = useZh();

  const labelFor = (g?: string) => (g === 'female' ? '女方' : '男方');
  const who =
    hourUnknownA && hourUnknownB
      ? '雙方'
      : hourUnknownA
        ? labelFor(genderA)
        : hourUnknownB
          ? labelFor(genderB)
          : '';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>💑</Text>
        <Text style={styles.headerTitle}>{zh('八字感情合盤完整報告')}</Text>
      </View>

      {who ? (
        <View style={styles.hourWarn}>
          <Text style={styles.hourWarnLead}>
            {zh(
              `⚠️ 因為${who}沒有出生時辰，這份合盤會以「年、月、日」三柱推算（大約七成）。下列與時辰有關的內容，這次不會包含：`,
            )}
          </Text>
          <Text style={styles.hourWarnItem}>{zh(`· ${who}出生時辰那一柱的分析`)}</Text>
          <Text style={styles.hourWarnItem}>{zh(`· ${who}的子女緣分與晚年同心程度`)}</Text>
          <Text style={styles.hourWarnItem}>{zh(`· ${who}的命宮、身宮`)}</Text>
          <Text style={styles.hourWarnItem}>{zh('· 與時辰有關的雙方互動（部分合、沖、刑、害）')}</Text>
          <Text style={styles.hourWarnItem}>{zh('· 部分與時辰有關的神煞')}</Text>
          <Text style={styles.hourWarnNote}>
            {zh(
              '以「日支夫妻宮」為核心的合盤判斷仍然成立；用神、五行互補僅供參考。出生時辰無法事後補上；若日後得知，可另外建立一張新命盤查看完整合盤。',
            )}
          </Text>
        </View>
      ) : null}

      <View style={styles.featureBox}>
        <Text style={styles.featureIntro}>{zh('包含以下深度分析：')}</Text>
        <View style={styles.featureGrid}>
          {FEATURES.map((f) => (
            <Text key={f} style={styles.featureItem}>
              {zh(`✓ ${f}`)}
            </Text>
          ))}
        </View>
      </View>

      <Pressable
        style={[styles.revealBtn, isRevealing && styles.revealBtnDisabled]}
        onPress={onReveal}
        disabled={isRevealing}
        accessibilityRole="button"
      >
        <Text style={styles.revealBtnText}>
          {isRevealing ? zh('載入中…') : zh('查看完整報告')}
        </Text>
      </Pressable>
      <Text style={styles.paidNote}>{zh('（此報告已包含在您的合盤點數中）')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  headerIcon: { fontSize: 24 },
  headerTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  hourWarn: {
    backgroundColor: colors.bgBannerWarm,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
  },
  hourWarnLead: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 24, marginBottom: 2 },
  hourWarnItem: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 24 },
  hourWarnNote: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18, marginTop: 4 },
  featureBox: { gap: spacing.sm },
  featureIntro: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  featureGrid: { gap: 4 },
  featureItem: { fontSize: fontSize.sm, color: colors.textPrimary },
  revealBtn: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  revealBtnDisabled: { opacity: 0.6 },
  revealBtnText: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textOnRed },
  paidNote: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center' },
});
