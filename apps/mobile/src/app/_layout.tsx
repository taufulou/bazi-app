import * as Sentry from '@sentry/react-native';
import {
  ClerkProvider,
  ClerkLoaded,
  ClerkLoading,
  useAuth,
} from '@clerk/clerk-expo';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { PostHogProvider } from 'posthog-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { View, Text, StyleSheet } from 'react-native';
import { useEffect, useRef, type ReactNode } from 'react';
import { tokenCache } from '../lib/clerk-token-cache';
import { LanguageProvider } from '../lib/language';
import { useAppFonts } from '../theme/fonts';
import { colors, fonts, fontSize, spacing } from '../theme';
import { env } from '../lib/env';
import { setUnauthorizedHandler } from '../lib/api';

// Keep the native splash up until fonts AND (below) Clerk are ready.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Crash reporting — no-op when no DSN is configured (dev / until wired at M7).
if (env.sentryDsn) {
  Sentry.init({ dsn: env.sentryDsn, tracesSampleRate: 0.1 });
}

const publishableKey = env.clerkPublishableKey;

/** Stable splash-hide (module scope so passing it as a prop doesn't re-fire effects). */
const hideSplash = () => {
  SplashScreen.hideAsync().catch(() => {});
};

/** Warm-themed navigation stack. */
function AppStack() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgCard },
        headerTintColor: colors.textAccent,
        headerTitleStyle: { fontWeight: 'bold', color: colors.textPrimary },
        contentStyle: { backgroundColor: colors.bgPrimary },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: '登入', presentation: 'modal' }} />
      <Stack.Screen name="sign-up" options={{ title: '註冊', presentation: 'modal' }} />
      <Stack.Screen name="(authenticated)" options={{ headerShown: false }} />
      <Stack.Screen name="profiles" options={{ title: '我的命盤' }} />
      <Stack.Screen
        name="reading/paipan"
        options={{ title: '八字排盤', headerBackButtonDisplayMode: 'minimal' }}
      />
      <Stack.Screen
        name="reading/[type]"
        options={{ title: '命理解讀', headerBackButtonDisplayMode: 'minimal' }}
      />
      <Stack.Screen
        name="store"
        options={{ title: '購買點數與方案', headerBackButtonDisplayMode: 'minimal' }}
      />
    </Stack>
  );
}

/** LanguageProvider + optional PostHog analytics. */
function Providers({ children }: { children: ReactNode }) {
  const content = <LanguageProvider>{children}</LanguageProvider>;
  return env.posthogKey ? (
    <PostHogProvider apiKey={env.posthogKey}>{content}</PostHogProvider>
  ) : (
    content
  );
}

/**
 * Wires the API client's 401 handler to sign out THEN redirect to sign-in
 * (single-flight so concurrent 401s don't stack). Must live inside ClerkProvider
 * so it can access signOut — otherwise a server-side-revoked token would drop the
 * user on the sign-in form while Clerk still thinks the session is live, and
 * signIn.create() would fail with `session_exists`.
 */
function AuthBridge() {
  const { signOut } = useAuth();
  const firing = useRef(false);
  useEffect(() => {
    setUnauthorizedHandler(async () => {
      if (firing.current) return;
      firing.current = true;
      try {
        await signOut();
      } catch {
        // best-effort; still route to sign-in
      }
      router.replace('/sign-in');
      firing.current = false;
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);
  return null;
}

/** Dev-only screen shown when the Clerk key is absent (fail fast, don't fake-boot). */
function MissingKeyScreen() {
  return (
    <View style={styles.centered}>
      <Text style={styles.missingTitle}>缺少設定</Text>
      <Text style={styles.missingBody}>
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY 未設定。{'\n'}
        請在 apps/mobile/.env 中加入後重新啟動。
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();
  const fontsReady = fontsLoaded || !!fontError;

  // Hide the splash as soon as fonts are ready (fast — fonts are bundled). The
  // brief Clerk network-init gap after that is covered by the <ClerkLoading>
  // cream fill below, so there's no white flash AND the splash doesn't linger.
  useEffect(() => {
    if (fontsReady) {
      hideSplash();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null; // native splash stays visible
  }

  // No Clerk key → fail fast with a config screen. Do NOT try to render the app
  // "without auth": useAuth() throws without a ClerkProvider, which would crash
  // at boot (LanguageProvider + every authed screen call it).
  if (!publishableKey) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <MissingKeyScreen />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <StatusBar style="dark" />
          <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
            {/* Cream fill covers the gap between splash-hide and app paint. */}
            <ClerkLoading>
              <View style={styles.creamFill} />
            </ClerkLoading>
            <ClerkLoaded>
              <AuthBridge />
              <Providers>
                <AppStack />
              </Providers>
            </ClerkLoaded>
          </ClerkProvider>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  creamFill: { flex: 1, backgroundColor: colors.bgPrimary },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPrimary,
    padding: spacing.xl,
    gap: spacing.md,
  },
  missingTitle: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.xl,
    color: colors.textAccent,
    fontWeight: '700',
  },
  missingBody: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 26,
  },
});
