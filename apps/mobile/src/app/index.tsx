import { useAuth } from '@clerk/clerk-expo';
import { useRouter, Redirect } from 'expo-router';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useZh } from '../lib/language';

export default function HomeScreen() {
  let isSignedIn = false;
  let isLoaded = true;

  // Try to use Clerk auth — will fail gracefully if Clerk isn't configured
  try {
    const auth = useAuth();
    isSignedIn = auth.isSignedIn ?? false;
    isLoaded = auth.isLoaded;
  } catch {
    // Clerk not available (missing publishable key)
    isLoaded = true;
    isSignedIn = false;
  }

  const router = useRouter();
  const zh = useZh();

  if (!isLoaded) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>{zh('載入中...')}</Text>
      </View>
    );
  }

  // If already signed in, go to dashboard
  if (isSignedIn) {
    return <Redirect href="/(authenticated)/dashboard" />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo / Branding */}
        <View style={styles.branding}>
          <Text style={styles.logo}>☯</Text>
          <Text style={styles.title}>天命</Text>
          <Text style={styles.subtitle}>
            {zh('預見你的一生')}
          </Text>
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
            onPress={() => router.push('/sign-up')}
          >
            <Text style={styles.primaryButtonText}>{zh('免費開始')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
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
    backgroundColor: '#1a1a2e',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#a0a0a0',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
  branding: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#e8d5b7',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#a0a0a0',
    textAlign: 'center',
  },
  features: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 48,
  },
  featureItem: {
    alignItems: 'center',
    width: 140,
    paddingVertical: 12,
  },
  featureIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  featureText: {
    color: '#e0e0e0',
    fontSize: 14,
    fontWeight: '500',
  },
  authButtons: {
    gap: 12,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: '#e8d5b7',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#1a1a2e',
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(232, 213, 183, 0.3)',
  },
  secondaryButtonText: {
    color: '#e8d5b7',
    fontSize: 16,
    fontWeight: '500',
  },
  disclaimer: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
