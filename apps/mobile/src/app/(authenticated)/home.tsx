import { useUser, useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { colors, spacing, fontSize, radius, shadows, fonts } from '../../theme';
import { useZh } from '../../lib/language';
import { getUserProfile, type SubscriptionTier } from '../../lib/api';
import { fetchBirthProfiles, type BirthProfile } from '../../lib/birth-profiles-api';
import { calculateBazi } from '../../lib/bazi-api';
import type { BaziChartData } from '../../lib/bazi-types';
import BaziChart from '../../components/BaziChart';

const TIER_LABEL: Record<SubscriptionTier, string> = {
  FREE: '免費會員',
  BASIC: '基礎會員',
  PRO: '專業會員',
  MASTER: '大師會員',
};

/** 首頁 — greeting + credit balance + the primary profile's chart. */
export default function HomeScreen() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const zh = useZh();
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<SubscriptionTier | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [chart, setChart] = useState<BaziChartData | null>(null);
  const [primary, setPrimary] = useState<BirthProfile | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  // Chart failure is tracked separately from the account/credits status so a
  // chart error never blanks the (already-loaded) credit card.
  const [chartError, setChartError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let token: string | null = null;
      let p: BirthProfile | null = null;
      // Account + credits — drives the credit card `status`.
      try {
        token = await getToken();
        if (!token) {
          if (!cancelled) {
            setStatus('error');
            setChartLoading(false);
          }
          return;
        }
        const [profile, profiles] = await Promise.all([getUserProfile(token), fetchBirthProfiles(token)]);
        if (cancelled) return;
        setCredits(profile.credits);
        setTier(profile.subscriptionTier);
        setStatus('ok');
        p = profiles.find((x) => x.isPrimary) ?? profiles[0] ?? null;
        setPrimary(p);
      } catch {
        if (!cancelled) {
          setStatus('error');
          setChartLoading(false);
        }
        return;
      }
      // Primary-profile chart — independent; failure sets `chartError` only.
      if (!p || !token) {
        if (!cancelled) setChartLoading(false);
        return;
      }
      try {
        const result = await calculateBazi({
          birth_date: p.birthDate.substring(0, 10),
          birth_time: p.hourKnown ? p.birthTime : null,
          hour_known: p.hourKnown,
          birth_city: p.birthCity,
          birth_timezone: p.birthTimezone,
          gender: p.gender.toLowerCase(),
        });
        if (!cancelled) setChart(result);
      } catch {
        if (!cancelled) setChartError(true);
      } finally {
        if (!cancelled) setChartLoading(false);
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

      {chartLoading ? (
        <ActivityIndicator color={colors.red} />
      ) : chart && primary ? (
        <BaziChart
          data={chart}
          name={primary.name}
          birthDate={primary.birthDate.substring(0, 10)}
          gender={primary.gender.toLowerCase()}
          isSubscriber={tier !== null && tier !== 'FREE'}
        />
      ) : chartError && primary ? (
        // A profile exists but its chart failed to load — show a chart-specific
        // error, NOT the "add a profile" CTA (which would be misleading).
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{zh('命盤載入失敗')}</Text>
          <Text style={styles.emptySub}>{zh('無法計算命盤，請稍後再試')}</Text>
        </View>
      ) : (
        <Pressable style={styles.emptyCard} onPress={() => router.push('/profiles')} accessibilityRole="button">
          <Text style={styles.emptyTitle}>{zh('尚未建立命盤')}</Text>
          <Text style={styles.emptySub}>{zh('新增您的出生資料，即可查看八字命盤')}</Text>
          <Text style={styles.emptyCta}>{zh('前往新增 →')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xxl * 2 },
  greeting: { fontFamily: fonts.serif, fontSize: fontSize.title, fontWeight: '700', color: colors.textPrimary },
  creditCard: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.sm, ...shadows.warm },
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
  emptyCard: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.sm, ...shadows.warm },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  emptySub: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  emptyCta: { fontSize: fontSize.base, color: colors.red, fontWeight: '600', marginTop: spacing.sm },
});
