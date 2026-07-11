import { useUser, useAuth } from '@clerk/clerk-expo';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { colors, spacing, fontSize, radius, shadows, fonts } from '../../theme';
import { useZh } from '../../lib/language';
import { getUserProfile, type SubscriptionTier } from '../../lib/api';

const TIER_LABEL: Record<SubscriptionTier, string> = {
  FREE: '免費會員',
  BASIC: '基礎會員',
  PRO: '專業會員',
  MASTER: '大師會員',
};

/** 首頁 — greeting + live credit balance (proves the authed API round-trip). */
export default function HomeScreen() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const zh = useZh();
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<SubscriptionTier | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setStatus('error');
          return;
        }
        const profile = await getUserProfile(token);
        if (!cancelled) {
          setCredits(profile.credits);
          setTier(profile.subscriptionTier);
          setStatus('ok');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>
        {zh('歡迎回來')}
        {user?.firstName ? `，${user.firstName}` : ''}
      </Text>

      <View style={styles.creditCard}>
        <Text style={styles.creditLabel}>{zh('我的點數')}</Text>
        {status === 'loading' ? (
          <ActivityIndicator color={colors.red} />
        ) : status === 'error' ? (
          <Text style={styles.creditError}>{zh('無法載入')}</Text>
        ) : (
          <>
            <Text style={styles.creditValue}>{credits}</Text>
            {tier ? <Text style={styles.tierBadge}>{zh(TIER_LABEL[tier])}</Text> : null}
          </>
        )}
      </View>

      <Text style={styles.hint}>{zh('選擇下方分頁開始您的命理之旅')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, gap: spacing.xl },
  greeting: {
    fontFamily: fonts.serif,
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  creditCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.warm,
  },
  creditLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  creditValue: { fontSize: fontSize.hero, fontWeight: '800', color: colors.red },
  creditError: { fontSize: fontSize.base, color: colors.error },
  tierBadge: {
    fontSize: fontSize.xs,
    color: colors.textOnGold,
    backgroundColor: colors.goldLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    overflow: 'hidden',
    fontWeight: '600',
  },
  hint: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
});
