import { useUser, useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { colors, spacing, fontSize, radius, shadows } from '../../theme';
import { useZh, useLang, useChangeLanguage } from '../../lib/language';

/** 我的 — account info + language toggle + sign-out. */
export default function MeScreen() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const router = useRouter();
  const zh = useZh();
  const lang = useLang();
  const changeLang = useChangeLanguage();

  const handleSignOut = () => {
    Alert.alert(zh('登出'), zh('確定要登出嗎？'), [
      { text: zh('取消'), style: 'cancel' },
      {
        text: zh('確定'),
        style: 'destructive',
        onPress: async () => {
          // Navigate off the authed stack FIRST so the (authenticated) guard
          // doesn't race a redirect to /sign-in when isSignedIn flips.
          router.replace('/');
          await signOut();
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.name}>
          {user?.firstName || zh('會員')}
        </Text>
        <Text style={styles.email}>{user?.primaryEmailAddress?.emailAddress ?? ''}</Text>
      </View>

      <TouchableOpacity
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={zh('切換語言')}
        onPress={() => changeLang(lang === 'zh-CN' ? 'zh-TW' : 'zh-CN')}
      >
        <Text style={styles.rowLabel}>{zh('語言')}</Text>
        {/* Current script (tap the row to switch). */}
        <Text style={styles.rowValue}>{lang === 'zh-CN' ? '简体中文' : '繁體中文'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.row, styles.signOutRow]}
        accessibilityRole="button"
        onPress={handleSignOut}
      >
        <Text style={styles.signOutText}>{zh('登出')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, gap: spacing.lg },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.xs,
    ...shadows.warm,
  },
  name: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
  email: { fontSize: fontSize.sm, color: colors.textSecondary },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  rowLabel: { fontSize: fontSize.base, color: colors.textPrimary },
  rowValue: { fontSize: fontSize.base, color: colors.textSecondary },
  signOutRow: { justifyContent: 'center', borderColor: colors.red },
  signOutText: { fontSize: fontSize.base, fontWeight: '600', color: colors.red },
});
