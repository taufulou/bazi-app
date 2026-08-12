import { useAuth } from '@clerk/clerk-expo';
import { useRouter, Redirect } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ScrollText, CalendarDays, Heart, Users, type LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useZh } from '../lib/language';
import { colors, radius, spacing, fontSize, fonts, text as T } from '../theme';
import { E2E_BYPASS_AUTH } from '../lib/e2e';

export default function HomeScreen() {
  // Always inside a ClerkProvider (the root layout shows a config screen when the
  // key is absent), so useAuth is safe to call directly.
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const zh = useZh();

  if (!isLoaded) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>{zh('載入中...')}</Text>
      </View>
    );
  }

  // If already signed in (or the dev E2E bypass is on), go to the home tab.
  if (isSignedIn || E2E_BYPASS_AUTH) {
    return <Redirect href="/(authenticated)/home" />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo / Branding */}
        <View style={styles.branding}>
          {/* U+FE0E is VARIATION SELECTOR-15 — "render the PRECEDING character as
              text, not emoji". Without it iOS picks the colour-emoji glyph for
              U+262F, which is a purple squircle: it ignores `color` entirely and
              fought a warm cream/red palette on the first screen a user sees. With
              it, ☯ is an ordinary glyph and takes the brand red like everything
              else. There is no yin-yang in Lucide, so this is the fix rather than
              another icon swap. */}
          <Text style={styles.logo}>{'\u262F\uFE0E'}</Text>
          <Text style={styles.title}>天命</Text>
          <Text style={styles.subtitle}>{zh('預見你的一生')}</Text>
        </View>

        {/* Features */}
        <View style={styles.features}>
          {/* Lucide, not emoji. The rest of the app is vector-iconned (the tab bar
              uses House / Sparkles / ScrollText / Heart / User), so 🌟📅💕🤝 here made
              the FIRST screen a new user sees the least premium one — and emoji
              render as a different typeface at a different optical weight on every
              OS version. ScrollText and Heart are reused from the tab bar's
              vocabulary deliberately; Users (two people) keeps 合盤 distinct from
              the single Heart of 愛情. */}
          <FeatureItem Icon={ScrollText} text="終身運勢分析" />
          <FeatureItem Icon={CalendarDays} text="流年運勢預測" />
          <FeatureItem Icon={Heart} text="愛情姻緣分析" />
          <FeatureItem Icon={Users} text="合盤比較" />
        </View>

        {/* Auth Buttons */}
        <View style={styles.authButtons}>
          <TouchableOpacity
            style={styles.primaryButton}
            accessibilityRole="button"
            onPress={() => router.push('/sign-up')}
          >
            <Text style={styles.primaryButtonText}>{zh('免費開始')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            accessibilityRole="button"
            onPress={() => router.push('/sign-in')}
          >
            <Text style={styles.secondaryButtonText}>{zh('已有帳號？登入')}</Text>
          </TouchableOpacity>
        </View>

        {/* Disclaimer */}
        <Text style={styles.disclaimer}>
          {zh('本服務僅供參考與娛樂用途，不構成任何專業建議')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({ Icon, text }: { Icon: LucideIcon; text: string }) {
  const zh = useZh();
  return (
    <View style={styles.featureItem}>
      {/* `size` matches the 28 the emoji occupied so the row's rhythm is unchanged;
          strokeWidth 1.75 keeps a 28px glyph from reading heavier than the tab
          icons, which are smaller. */}
      <Icon size={28} strokeWidth={1.75} color={colors.red} style={styles.featureIcon} />
      <Text style={styles.featureText}>{zh(text)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: { ...T.body, color: colors.textSecondary, textAlign: 'center', marginTop: 100 },
  branding: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 64,
    lineHeight: 76,
    color: colors.red,
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.hero,
    fontWeight: '700',
    color: colors.red,
    marginBottom: spacing.sm,
  },
  // 「預見你的一生」 — the tagline under the wordmark on the first screen anyone
  // sees. Unleaded, like the rest of this file: it predates the role system.
  subtitle: { ...T.body, color: colors.textSecondary, textAlign: 'center' },
  features: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.lg,
    marginBottom: 48,
  },
  featureItem: {
    alignItems: 'center',
    width: 140,
    paddingVertical: spacing.md,
  },
  featureIcon: {
    marginBottom: spacing.xs,
  },
  featureText: { ...T.bodyTight, color: colors.textPrimary, fontWeight: '500' },
  authButtons: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.textOnRed,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.red,
  },
  secondaryButtonText: {
    color: colors.red,
    fontSize: fontSize.base,
    fontWeight: '500',
  },
  disclaimer: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textAlign: 'center',
    lineHeight: 18,
  },
});
