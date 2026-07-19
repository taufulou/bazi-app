import { useSignIn } from '@clerk/clerk-expo';
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
import { GoogleSignInButton } from '../components/GoogleSignInButton';

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const zh = useZh();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignIn = useCallback(async () => {
    if (!isLoaded) return;

    setLoading(true);
    try {
      const result = await signIn.create({
        identifier: emailAddress,
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/(authenticated)/home');
      } else {
        // Non-complete status (2FA / missing requirements) — don't dead-end silently.
        Alert.alert(zh('需要額外驗證'), zh('此帳號需要額外的登入步驟，請稍後再試或改用網頁版。'));
      }
    } catch (err: unknown) {
      const error = err as { errors?: Array<{ message?: string; longMessage?: string }> };
      const clerkErr = error.errors?.[0];
      Alert.alert(
        zh('登入失敗'),
        clerkErr?.longMessage || clerkErr?.message || zh('請檢查您的帳號和密碼'),
      );
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, emailAddress, password, setActive, router, zh]);

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
          <Text style={styles.title}>{zh('歡迎回來')}</Text>
          <Text style={styles.subtitle}>{zh('登入您的帳號')}</Text>
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
              placeholder={zh('輸入您的密碼')}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            accessibilityRole="button"
            onPress={onSignIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnRed} />
            ) : (
              <Text style={styles.buttonText}>{zh('登入')}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{zh('或')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <GoogleSignInButton />

          <TouchableOpacity
            style={styles.linkButton}
            accessibilityRole="button"
            onPress={() => router.push('/sign-up')}
          >
            <Text style={styles.linkText}>
              {zh('還沒有帳號？')} <Text style={styles.linkHighlight}>{zh('註冊')}</Text>
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
    fontFamily: fonts.serifBold,
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textAccent,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.xl,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.borderLight },
  dividerText: { color: colors.textMuted, fontSize: fontSize.sm },
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
