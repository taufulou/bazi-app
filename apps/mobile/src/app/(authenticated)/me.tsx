import { useUser, useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Platform, Linking } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors, spacing, fontSize, radius, shadows } from '../../theme';
import { useZh, useLang, useChangeLanguage } from '../../lib/language';
import { deleteAccount, ApiError } from '../../lib/api';

/** 我的 — account info + store + language toggle + sign-out + delete account. */
export default function MeScreen() {
  const { user } = useUser();
  const { signOut, getToken } = useAuth();
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

  // Deep-link to the store's manage-subscriptions page. Inlined (pure Linking)
  // rather than imported from lib/purchases so this always-mounted tab never
  // pulls the native react-native-purchases module into the app boot path.
  const openStoreSubscriptions = () => {
    const url =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
    void Linking.openURL(url);
  };

  const performDelete = async (acknowledgeIap: boolean) => {
    try {
      const token = await getToken();
      if (!token) return;
      await deleteAccount(token, acknowledgeIap);
      // Success — leave the authed stack, then sign out.
      router.replace('/');
      await signOut();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ACTIVE_IAP_SUBSCRIPTION') {
        Alert.alert(
          zh('請先取消訂閱'),
          zh('您在 App Store／Google Play 仍有有效訂閱，無法從此處取消。請先於商店取消訂閱後，再刪除帳號。'),
          [
            { text: zh('前往管理訂閱'), onPress: openStoreSubscriptions },
            { text: zh('我已取消，仍要刪除'), style: 'destructive', onPress: () => void performDelete(true) },
            { text: zh('取消'), style: 'cancel' },
          ],
        );
        return;
      }
      Alert.alert(zh('刪除失敗'), zh('請稍後再試'));
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      zh('刪除帳號'),
      zh('此操作將永久刪除您的帳號與所有資料，且無法復原。確定要繼續嗎？'),
      [
        { text: zh('取消'), style: 'cancel' },
        { text: zh('刪除'), style: 'destructive', onPress: () => void performDelete(false) },
      ],
    );
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
        onPress={() => router.push('/profiles')}
      >
        <Text style={styles.rowLabel}>{zh('我的命盤')}</Text>
        <ChevronRight color={colors.textMuted} size={20} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.row}
        accessibilityRole="button"
        onPress={() => router.push('/store')}
      >
        <Text style={styles.rowLabel}>{zh('購買點數與方案')}</Text>
        <ChevronRight color={colors.textMuted} size={20} />
      </TouchableOpacity>

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

      <TouchableOpacity
        style={styles.deleteRow}
        accessibilityRole="button"
        onPress={handleDeleteAccount}
      >
        <Text style={styles.deleteText}>{zh('刪除帳號')}</Text>
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
  deleteRow: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  deleteText: { fontSize: fontSize.sm, color: colors.textMuted, textDecorationLine: 'underline' },
});
