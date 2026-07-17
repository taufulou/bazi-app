import { useAuth } from '@clerk/clerk-expo';
import { useRouter, Redirect } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useZh } from '../lib/language';
import { colors, radius, spacing, fontSize, fonts } from '../theme';
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
          <Text style={styles.logo}>☯</Text>
          <Text style={styles.title}>天命</Text>
          <Text style={styles.subtitle}>{zh('預見你的一生')}</Text>
        </View>

        {/* Features */}
        <View style={styles.features}>
          <FeatureItem icon="🌟" text="終身運勢分析" />
          <FeatureItem icon="📅" text="流年運勢預測" />
          <FeatureItem icon="💕" text="愛情姻緣分析" />
          <FeatureItem icon="🤝" text="合盤比較" />
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

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  const zh = useZh();
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureIcon}>{icon}</Text>
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
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    textAlign: 'center',
    marginTop: 100,
  },
  branding: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.hero,
    fontWeight: '700',
    color: colors.red,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
  },
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
    fontSize: 28,
    marginBottom: spacing.xs,
  },
  featureText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
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
