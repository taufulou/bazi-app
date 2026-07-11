import { useSignUp } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useZh } from '../lib/language';
import { colors, radius, spacing, fontSize, fonts } from '../theme';

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const zh = useZh();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignUp = useCallback(async () => {
    if (!isLoaded) return;

    setLoading(true);
    try {
      await signUp.create({
        emailAddress,
        password,
      });

      // Send email verification code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err: unknown) {
      const error = err as { errors?: Array<{ message?: string; longMessage?: string }> };
      const clerkErr = error.errors?.[0];
      Alert.alert(
        zh('註冊失敗'),
        clerkErr?.longMessage || clerkErr?.message || zh('請檢查您的資料後重試'),
      );
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signUp, emailAddress, password, zh]);

  const onVerify = useCallback(async () => {
    if (!isLoaded) return;

    setLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/(authenticated)/home');
      } else {
        // Non-complete (e.g., phone required per the Clerk dashboard config) —
        // surface it instead of leaving the user on a dead spinner.
        Alert.alert(zh('需要額外資料'), zh('此帳號還需要補充資料才能完成註冊，請改用網頁版完成。'));
      }
    } catch (err: unknown) {
      const error = err as { errors?: Array<{ message?: string; longMessage?: string }> };
      const clerkErr = error.errors?.[0];
      Alert.alert(
        zh('驗證失敗'),
        clerkErr?.longMessage || clerkErr?.message || zh('驗證碼不正確，請重試'),
      );
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signUp, code, setActive, router, zh]);

  // Verification code screen
  if (pendingVerification) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.title}>{zh('驗證電子郵件')}</Text>
            <Text style={styles.subtitle}>
              {zh('我們已將驗證碼發送到')} {emailAddress}
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{zh('驗證碼')}</Text>
              <TextInput
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

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              accessibilityRole="button"
              onPress={onVerify}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.textOnRed} />
              ) : (
                <Text style={styles.buttonText}>{zh('驗證')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Sign up form
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>{zh('建立帳號')}</Text>
          <Text style={styles.subtitle}>{zh('開始您的命理之旅')}</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{zh('電子郵件')}</Text>
            <TextInput
              style={styles.input}
              value={emailAddress}
              onChangeText={setEmailAddress}
              placeholder={zh('輸入您的電子郵件')}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{zh('密碼')}</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={zh('設定您的密碼')}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            accessibilityRole="button"
            onPress={onSignUp}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnRed} />
            ) : (
              <Text style={styles.buttonText}>{zh('註冊')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            accessibilityRole="button"
            onPress={() => router.push('/sign-in')}
          >
            <Text style={styles.linkText}>
              {zh('已有帳號？')} <Text style={styles.linkHighlight}>{zh('登入')}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textAccent,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: spacing.xl,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.sm,
    fontWeight: '500',
  },
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
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.textOnRed,
    fontSize: fontSize.base,
    fontWeight: '700',
  },
  linkButton: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  linkText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  linkHighlight: {
    color: colors.red,
    fontWeight: '600',
  },
});
