import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useSSO } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useZh } from '../lib/language';
import { colors, radius, spacing, fontSize } from '../theme';

// Completes the OAuth redirect back into the app after the browser closes.
WebBrowser.maybeCompleteAuthSession();

// Pre-warm the in-app browser (Android perf best-practice for OAuth handoff).
function useWarmUpBrowser() {
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

/**
 * "使用 Google 登入" — mirrors the web app's Google sign-in. Uses Clerk's SSO flow
 * (`oauth_google`) via the in-app browser, then activates the returned session.
 *
 * NOTE: if the Clerk instance requires a phone number, Google sign-in returns
 * without a session (needs the extra step) → we surface a message. Set phone to
 * "optional" in the Clerk Dashboard to allow Google sign-in to complete.
 */
export function GoogleSignInButton() {
  useWarmUpBrowser();
  const { startSSOFlow } = useSSO();
  const router = useRouter();
  const zh = useZh();
  const [loading, setLoading] = useState(false);

  const onPress = useCallback(async () => {
    setLoading(true);
    try {
      // Android's Chrome Custom Tab only matches a redirect it can identify; a bare
      // `tianming://` returns `dismiss` (OAuth code lost). An explicit path fixes it
      // on Android and is harmless on iOS.
      const redirectUrl = AuthSession.makeRedirectUri({ scheme: 'tianming', path: 'sso-callback' });
      const { createdSessionId, setActive, signIn, signUp } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl,
      });

      // 1. Happy path — the OAuth account is already linked → session ready.
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace('/(authenticated)/home');
        return;
      }

      // 2. Transfer flow (Clerk). The OAuth verification comes back
      //    "transferable" and must be completed into a sign-in (existing user)
      //    or a sign-up (new user). Without this, the flow stalls at
      //    signIn.status === 'needs_identifier' (seen on Android).
      const signInVerif = (signIn?.firstFactorVerification ?? {}) as { status?: string };
      const signUpVerif = (signUp?.verifications?.externalAccount ?? {}) as { status?: string };

      if (signInVerif.status === 'transferable') {
        const res = await signIn!.create({ transfer: true });
        if (res.status === 'complete' && res.createdSessionId && setActive) {
          await setActive({ session: res.createdSessionId });
          router.replace('/(authenticated)/home');
          return;
        }
      }
      if (signUpVerif.status === 'transferable') {
        const res = await signUp!.create({ transfer: true });
        if (res.status === 'complete' && res.createdSessionId && setActive) {
          await setActive({ session: res.createdSessionId });
          router.replace('/(authenticated)/home');
          return;
        }
      }

      // 3. Still no session → graceful message.
      Alert.alert(
        zh('登入未完成'),
        zh('無法完成 Google 登入，請再試一次，或改用網頁版。'),
      );
    } catch (err: unknown) {
      const e = err as { errors?: Array<{ longMessage?: string; message?: string }> };
      Alert.alert(
        zh('Google 登入失敗'),
        e.errors?.[0]?.longMessage || e.errors?.[0]?.message || zh('請稍後再試'),
      );
    } finally {
      setLoading(false);
    }
  }, [startSSOFlow, router, zh]);

  return (
    <Pressable
      style={[styles.btn, loading && styles.btnDisabled]}
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={zh('使用 Google 登入')}
    >
      {loading ? (
        <ActivityIndicator color={colors.textPrimary} />
      ) : (
        <>
          <View style={styles.gBadge}>
            <Text style={styles.gText}>G</Text>
          </View>
          <Text style={styles.label}>{zh('使用 Google 登入')}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  btnDisabled: { opacity: 0.7 },
  gBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  gText: { color: '#4285F4', fontSize: fontSize.base, fontWeight: '800' },
  label: { color: colors.textPrimary, fontSize: fontSize.base, fontWeight: '600' },
});
