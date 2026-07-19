import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Briefcase, Calendar, Heart, Lock, Star, type LucideIcon } from 'lucide-react-native';
import { colors, spacing, fontSize, radius, fonts, shadows, surfaces } from '../../theme';
import { useZh } from '../../lib/language';

/**
 * Per-type paywall CTA with the feature-bullet grid, mirroring the four web
 * *PaywallCTA.tsx components. Tapping 解鎖完整報告 calls onUnlock (which opens
 * the UnlockConfirmModal). When credits are insufficient the button switches to
 * a disabled 額度不足 state + a 購買點數 shortcut (matches web branch 3).
 * No "not signed in" branch — mobile is full-lockdown authed.
 */
interface PaywallFeatures {
  Icon: LucideIcon;
  title: string;
  bullets: string[];
}

const PAYWALL_FEATURES: Record<string, PaywallFeatures> = {
  lifetime: {
    Icon: Star,
    title: '八字終身運完整報告',
    bullets: ['性格特質', '日主分析', '五行平衡', '十神分布', '大運流年', '神煞解析', '六親關係', '人生指引', '財運分析'],
  },
  annual: {
    Icon: Calendar,
    title: '八字流年運勢完整報告',
    bullets: ['流年總述', '太歲分析', '事業運勢', '財運分析', '人際關係', '愛情姻緣', '家庭關係', '健康狀況', '十二月運程'],
  },
  career: {
    Icon: Briefcase,
    title: '八字事業詳批完整報告',
    bullets: ['事業格局分析', '職業能力分析', '行業方向建議', '創業適合度', '合夥適合度', '事業貴人分析', '未來五年運勢', '十二月運氣'],
  },
  love: {
    Icon: Heart,
    title: '八字愛情姻緣完整報告',
    bullets: ['戀愛性格分析', '先天桃花運', '本命姻緣分析', '婚配建議', '對象性格與相貌', '桃花運好的年份', '桃花劫的年份', '感情易變年份'],
  },
};

export default function PaywallCTA({
  readingType,
  creditCost,
  currentCredits,
  onUnlock,
  onBuyCredits,
}: {
  readingType: string;
  creditCost: number;
  currentCredits: number | null;
  onUnlock: () => void;
  onBuyCredits: () => void;
}) {
  const zh = useZh();
  const feat = PAYWALL_FEATURES[readingType];
  if (!feat) return null;

  const hasEnough = currentCredits !== null && currentCredits >= creditCost;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <feat.Icon size={24} strokeWidth={2} color={colors.textAccent} />
        <Text style={styles.headerTitle}>{zh(feat.title)}</Text>
      </View>

      <Text style={styles.intro}>{zh('包含以下深度分析：')}</Text>
      <View style={styles.grid}>
        {feat.bullets.map((b) => (
          <View key={b} style={styles.chip}>
            <Text style={styles.chipText}>{zh(b)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actionArea}>
        {hasEnough ? (
          <>
            <Pressable style={styles.unlockBtn} onPress={onUnlock} accessibilityRole="button">
              <Lock size={16} color={colors.textOnRed} />
              <Text style={styles.unlockText}>{zh('解鎖完整報告')}</Text>
              {creditCost > 0 ? (
                <View style={styles.costBadge}>
                  <Text style={styles.costBadgeText}>{creditCost} {zh("點")}</Text>
                </View>
              ) : (
                <View style={styles.freeBadge}>
                  <Text style={styles.freeBadgeText}>{zh('免費')}</Text>
                </View>
              )}
            </Pressable>
            {currentCredits !== null && creditCost > 0 ? (
              <Text style={styles.creditsInfo}>
                {zh('剩餘')} {currentCredits} {zh('點')}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={[styles.unlockBtn, styles.unlockBtnDisabled]}>
              <Text style={styles.unlockText}>
                {zh('額度不足')} · {creditCost} {zh('點')}
              </Text>
            </View>
            <Text style={styles.creditsInfo}>
              {zh('剩餘')} {currentCredits ?? 0} {zh('點，需要')} {creditCost} {zh('點')}
            </Text>
            <Pressable onPress={onBuyCredits} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.buyLink}>{zh('購買點數')} →</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    padding: spacing.lg,
    marginTop: spacing.xl,
    ...surfaces.card,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  headerTitle: { flex: 1, fontSize: fontSize.lg, fontFamily: fonts.serifBold, fontWeight: '700', color: colors.textAccent },
  intro: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.bgBannerWarm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipText: { fontSize: fontSize.sm, color: colors.textPrimary },
  actionArea: { marginTop: spacing.lg, alignItems: 'center', gap: spacing.sm },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignSelf: 'stretch',
    ...shadows.warm,
  },
  unlockBtnDisabled: { backgroundColor: colors.textMuted, opacity: 0.7 },
  unlockText: { color: colors.textOnRed, fontSize: fontSize.base, fontWeight: '700' },
  costBadge: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  costBadgeText: { color: colors.textOnRed, fontSize: fontSize.sm, fontWeight: '700' },
  freeBadge: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  freeBadgeText: { color: colors.textOnRed, fontSize: fontSize.sm, fontWeight: '700' },
  creditsInfo: { fontSize: fontSize.sm, color: colors.textSecondary },
  buyLink: { fontSize: fontSize.base, color: colors.red, fontWeight: '600' },
});
