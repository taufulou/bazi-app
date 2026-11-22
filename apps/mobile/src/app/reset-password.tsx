import { useSignIn } from '@clerk/clerk-expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SUPPORT_EMAIL } from '../lib/links';
import { useZh } from '../lib/language';
import { colors, fontSize, fonts, radius, spacing, text as T } from '../theme';
import { enterApp } from '../lib/enter-app';

const STRATEGY = 'reset_password_email_code' as const;

type ClerkErr = { errors?: Array<{ code?: string; message?: string; longMessage?: string }> };

/**
 * 忘記密碼 — a native reset with Clerk's email-code flow (1C item 4, F11).
 *
 * Native rather than a hand-off to the website: the website sells memberships
 * outside the App Store (guideline 3.1.1), and a browser login from the app is a
 * 4.0 concern. It also rescues a user whose password the live instance refuses
 * as breached (HIBP is enforced at sign-in).
 */
export default function ResetPasswordScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const zh = useZh();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const showError = useCallback(
    (err: unknown, fallback: string) => {
      const e = (err as ClerkErr).errors?.[0];
      if (e?.code === 'strategy_for_user_invalid') {
        Alert.alert(zh('無法重設密碼'), zh('此帳號使用 Apple／Google 登入，請直接使用該方式登入。'));
        return;
      }
      Alert.alert(zh('重設失敗'), e?.longMessage || e?.message || zh(fallback));
    },
    [zh],
  );

  const sendCode = useCallback(async () => {
    if (!isLoaded || !signIn || !email.trim()) return;
    setLoading(true);
    try {
      await signIn.create({ strategy: STRATEGY, identifier: email.trim() });
      setStep('code');
    } catch (err) {
      showError(err, '無法寄送驗證碼，請確認電子郵件後重試');
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, email, showError]);

  const submitNewPassword = useCallback(async () => {
    if (!isLoaded || !signIn || !code || !password) return;
    setLoading(true);
    try {
      let res = await signIn.attemptFirstFactor({ strategy: STRATEGY, code, password });
      // Clerk accepts the password with the code, but may still ask for it.
      if (res.status === 'needs_new_password') {
        res = await signIn.resetPassword({ password });
      }
      if (res.status === 'complete' && res.createdSessionId) {
        await setActive({ session: res.createdSessionId });
        enterApp(router);
        return;
      }
      Alert.alert(zh('無法完成重設'), `${zh('請聯絡客服：')}${SUPPORT_EMAIL}`);
    } catch (err) {
      showError(err, '驗證碼或新密碼不正確，請重試');
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, code, password, setActive, router, zh, showError]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>{zh('重設密碼')}</Text>
          <Text style={styles.subtitle}>
            {step === 'email'
              ? zh('輸入註冊時使用的電子郵件，我們會寄送驗證碼。')
              : `${zh('驗證碼已寄送到')} ${email}`}
          </Text>
        </View>

        {step === 'email' ? (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{zh('電子郵件')}</Text>
            <TextInput
              testID="reset-email"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={zh('輸入您的電子郵件')}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{zh('驗證碼')}</Text>
              <TextInput
                testID="reset-code"
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder={zh('輸入驗證碼')}
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{zh('新密碼')}</Text>
              <TextInput
                testID="reset-password"
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={zh('輸入新密碼')}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                textContentType="newPassword"
              />
            </View>
          </>
        )}

        <TouchableOpacity
          testID="reset-submit"
          style={[styles.button, loading && styles.buttonDisabled]}
          accessibilityRole="button"
          onPress={() => void (step === 'email' ? sendCode() : submitNewPassword())}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.textOnRed} />
          ) : (
            <Text style={styles.buttonText}>{step === 'email' ? zh('寄送驗證碼') : zh('重設並登入')}</Text>
          )}
        </TouchableOpacity>

        {step === 'code' ? (
          <TouchableOpacity style={styles.linkButton} accessibilityRole="button" onPress={() => void sendCode()}>
            <Text style={styles.linkText}>{zh('重新寄送驗證碼')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  header: { alignItems: 'center', marginBottom: spacing.xxl },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.title,
    color: colors.textAccent,
    marginBottom: spacing.sm,
  },
  subtitle: { ...T.body, color: colors.textSecondary, textAlign: 'center' },
  inputGroup: { marginBottom: spacing.xl },
  label: { ...T.bodyTight, color: colors.textSecondary, marginBottom: spacing.sm, fontWeight: '500' },
  input: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.lg,
    color: colors.textPrimary,
    fontSize: fontSize.base,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  button: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { ...T.bodyTight, color: colors.textOnRed, fontWeight: '700' },
  linkButton: { alignItems: 'center', marginTop: spacing.xl },
  linkText: { ...T.bodyTight, color: colors.textSecondary, textDecorationLine: 'underline' },
});
