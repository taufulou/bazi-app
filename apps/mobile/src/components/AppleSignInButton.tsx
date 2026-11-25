import { useCallback, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useSignIn, useSignUp } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { signInWithApple, type ClerkSignInLike, type ClerkSignUpLike } from '../lib/apple-sign-in';
import { SUPPORT_EMAIL } from '../lib/links';
import { useZh } from '../lib/language';
import { radius } from '../theme';
import { enterApp } from '../lib/enter-app';

/**
 * Sign in with Apple (1C item 1; guideline 4.8 — required because Google sign-in
 * is offered). iOS only. Apple's own button, as the HIG requires. Rendered
 * immediately on iOS (no layout jump); availability is checked on press.
 */
export function AppleSignInButton({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();
  const router = useRouter();
  const zh = useZh();
  const [busy, setBusy] = useState(false);

  const onPress = useCallback(async () => {
    if (busy || !signInLoaded || !signUpLoaded || !signIn || !signUp) return;
    setBusy(true);
    try {
      const result = await signInWithApple(
        signIn as unknown as ClerkSignInLike,
        signUp as unknown as ClerkSignUpLike,
      );
      switch (result.kind) {
        case 'session':
          await setActive?.({ session: result.sessionId });
          enterApp(router);
          return;
        case 'cancelled':
          return; // the user closed Apple's sheet — nothing to say
        case 'unavailable':
          Alert.alert(zh('無法使用 Apple 登入'), zh('此裝置不支援 Apple 登入。'));
          return;
        case 'incomplete':
          Alert.alert(
            zh('登入未完成'),
            `${zh('無法完成 Apple 登入，請改用電子郵件登入，或聯絡客服：')}${SUPPORT_EMAIL}`,
          );
          return;
        case 'error':
          Alert.alert(zh('Apple 登入失敗'), result.message || zh('請稍後再試'));
          return;
      }
    } finally {
      setBusy(false);
    }
  }, [busy, signInLoaded, signUpLoaded, signIn, signUp, setActive, router, zh]);

  if (Platform.OS !== 'ios') return null;

  return (
    <View style={[styles.wrap, busy && styles.busy]} pointerEvents={busy ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        testID="apple-sign-in"
        buttonType={
          mode === 'sign-up'
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
            : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
        }
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={radius.md}
        style={styles.button}
        onPress={() => void onPress()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  busy: { opacity: 0.6 },
  button: { width: '100%', height: 50 },
});
