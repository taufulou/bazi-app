import { useUser } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, fonts } from '../../theme';
import { useZh } from '../../lib/language';
import CreditBadge from '../../components/home/CreditBadge';
import WelcomeFortunePill from '../../components/home/WelcomeFortunePill';
import HeroBanner from '../../components/home/HeroBanner';
import { FeatureCards } from '../../components/home/FeatureCards';
import AccountPanel from '../../components/home/AccountPanel';
import HomeDailyFortuneCard from '../../components/HomeDailyFortuneCard';
// 120px resize of apps/web/public/logo-1024.png (the 3MB original would be
// decoded in full for a 34pt header slot).
import LOGO from '../../../assets/logo-header.png';
import HERO_BG from '../../../assets/backgrounds/dashboard-hero-bg.webp';

/** Decorative backdrop height, mirroring web's clamp(240px, 30vh, 350px) at ≤768px. */
const HERO_BG_HEIGHT = 300;

/**
 * 首頁 — mirrors the web dashboard (apps/web/app/page.tsx) section-for-section:
 *
 *   header(logo + credit badge) → welcome(greeting + fortune pill + quick links)
 *   → hero banner → 八字命理分析 feature list → 今日運勢 → account panel
 *
 * Deliberately does NOT show the 八字命格 chart: web's dashboard has no chart
 * either (it lives inside a reading / 免費排盤). Web hides the username in the
 * header at ≤768px and stacks the welcome row into a column, so this always does.
 */
export default function HomeScreen() {
  const { user } = useUser();
  const zh = useZh();
  const router = useRouter();
  // The tab nav bar is disabled for 首頁 (see (authenticated)/_layout.tsx), so
  // nothing else supplies the top inset — without this the logo sits under the notch.
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
    >
      {/* Decorative backdrop (web's .page::before/::after): the horse/clouds art
          behind the header, faded into the cream page. Web uses mask-image, which
          RN has no equivalent for — a transparent→bgPrimary LinearGradient over
          the image reproduces it. Absolute + first child so later siblings paint on
          top; negative insets let it bleed past the content padding to full-bleed. */}
      <View
        pointerEvents="none"
        style={[
          styles.heroBg,
          { top: -(insets.top + spacing.sm), height: insets.top + HERO_BG_HEIGHT },
        ]}
      >
        <Image source={HERO_BG} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={['rgba(255,243,224,0.25)', 'rgba(255,243,224,0.55)', colors.bgPrimary]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Header — logo + credits. No username: web drops it on narrow screens. */}
      <View style={styles.header}>
        <Image source={LOGO} style={styles.logo} contentFit="contain" />
        <CreditBadge showPricingLink />
      </View>

      {/* Welcome row — greeting + compact fortune glance + quick link, all on ONE
          row (web's desktop layout: greeting+pill left, links right). Keeping it to
          a single row is what lifts the hero banner near the top of the screen.
          (Web shows the daily fortune twice at two fidelities on purpose: this pill,
          and the full card further down.) */}
      <View style={styles.welcomeRow}>
        <Text style={styles.greeting} numberOfLines={1}>
          {zh('歡迎回來')}
          {user?.firstName ? `，${user.firstName}` : ''}
        </Text>
        <WelcomeFortunePill />
        <View style={styles.spacer} />
        {/* Icon-only (web spells out 出生資料) — the label doesn't fit beside the
            greeting + pill on a phone. 📋 歷史記錄 lands with the history screen. */}
        <Pressable
          style={styles.quickLink}
          onPress={() => router.push('/profiles')}
          accessibilityRole="button"
          accessibilityLabel={zh('出生資料')}
          hitSlop={8}
        >
          <Text style={styles.quickLinkIcon}>👤</Text>
        </Pressable>
      </View>

      <HeroBanner />

      <FeatureCards />

      {/* Heading lives inside the card so both vanish together if the fortune
          service is down (web contract — never orphan the heading). */}
      <HomeDailyFortuneCard />

      <AccountPanel />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  // Tighter gap than the rest of the app (lg, not xl) — every pixel above the
  // banner counts. paddingTop is injected from the safe-area inset.
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.lg,
  },
  // Negative horizontal insets cancel the content's paddingHorizontal so the art
  // goes full-bleed (RN positions absolute children from the parent's padding edge).
  heroBg: {
    position: 'absolute',
    left: -spacing.lg,
    right: -spacing.lg,
    overflow: 'hidden',
  },
  // Mirrors web .header: row, space-between, hairline bottom rule.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  logo: { width: 34, height: 34, borderRadius: 8 },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  greeting: {
    fontFamily: fonts.serifBold,
    // Web's mobile size (1.2rem ≈ 19px) — the desktop 1.4rem/28 was eating the
    // vertical budget and pushing the banner down.
    fontSize: fontSize.xl,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  spacer: { flex: 1 },
  // Mirrors web .quickLink: frosted pill. Icon-only here, so hitSlop carries the
  // touch target rather than a 44pt box that would eat the row.
  quickLink: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 18,
  },
  quickLinkIcon: { fontSize: fontSize.base },
});
