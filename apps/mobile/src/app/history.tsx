import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Stack, useRouter } from 'expo-router';
import { READING_TYPE_META } from '@repo/shared';
import { colors, spacing, fontSize, radius, fonts, shadows } from '../theme';
import { useZh } from '../lib/language';
import { getReadingHistory, type ReadingHistoryItem } from '../lib/readings-api';

/**
 * 歷史分析記錄 — all past readings + comparisons for the user, mirroring web
 * dashboard/readings. Regular readings deep-link to /reading/[type]?id= (which
 * re-hydrates in place); comparisons to /(authenticated)/compat?id=. Filtered to
 * mobile-supported types (lifetime/annual/career/love + 合盤) — ZWDS/health have
 * no mobile screen, so those rows are omitted to avoid dead taps.
 */
const ENUM_TO_SLUG: Record<string, string> = {
  LIFETIME: 'lifetime',
  ANNUAL: 'annual',
  CAREER: 'career',
  LOVE: 'love',
};

const COMPARISON_TYPE_LABELS: Record<string, { icon: string; label: string }> = {
  ROMANCE: { icon: '💕', label: '感情合盤' },
  BUSINESS: { icon: '💼', label: '事業合盤' },
  FRIENDSHIP: { icon: '🤝', label: '友誼合盤' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Status = 'loading' | 'success' | 'error';

export default function ReadingHistoryScreen() {
  const zh = useZh();
  const router = useRouter();
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [readings, setReadings] = useState<ReadingHistoryItem[]>([]);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const result = await getReadingHistory(token, 1, 50);
        if (cancelled) return;
        setReadings(result.data);
        setStatus('success');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken omitted (unstable Clerk ref → fetch loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (isLoaded && !isSignedIn) return <Redirect href="/sign-in" />;

  // Keep comparisons + the 4 supported Bazi reading types (drop ZWDS/health).
  const visible = readings.filter((r) => r.isComparison || !!ENUM_TO_SLUG[r.readingType]);

  const openReading = (r: ReadingHistoryItem) => {
    if (r.isComparison) {
      router.push({ pathname: '/(authenticated)/compat', params: { id: r.id } });
      return;
    }
    const slug = ENUM_TO_SLUG[r.readingType];
    if (slug) router.push({ pathname: '/reading/[type]', params: { type: slug, id: r.id } });
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: zh('歷史分析記錄') }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.red} />
            <Text style={styles.centerText}>{zh('載入中…')}</Text>
          </View>
        ) : null}

        {status === 'error' ? (
          <View style={styles.center}>
            <Text style={styles.centerText}>{zh('無法載入分析記錄')}</Text>
          </View>
        ) : null}

        {status === 'success' && visible.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>{zh('尚無分析記錄')}</Text>
            <Text style={styles.emptyText}>{zh('開始一項命理分析，結果會自動儲存在這裡')}</Text>
            <Pressable
              style={styles.startBtn}
              onPress={() => router.push('/(authenticated)/readings')}
              accessibilityRole="button"
            >
              <Text style={styles.startText}>{zh('開始分析')} →</Text>
            </Pressable>
          </View>
        ) : null}

        {status === 'success' && visible.length > 0 ? (
          <View style={styles.list}>
            {visible.map((r) => {
              const isComp = r.isComparison === true;
              const meta = isComp
                ? undefined
                : READING_TYPE_META[ENUM_TO_SLUG[r.readingType] as keyof typeof READING_TYPE_META];
              const ct = isComp ? COMPARISON_TYPE_LABELS[r.comparisonType ?? 'ROMANCE'] : undefined;
              const icon = isComp ? ct?.icon ?? '🤝' : meta?.icon ?? '🔮';
              const title = isComp ? ct?.label ?? zh('合盤比較') : meta?.nameZhTw ?? r.readingType;
              const nameA = r.birthProfile?.name ?? zh('未命名');
              const isFree = r.creditsUsed === 0;

              return (
                <Pressable
                  key={r.id}
                  style={styles.card}
                  onPress={() => openReading(r)}
                  accessibilityRole="button"
                >
                  <Text style={styles.cardIcon}>{icon}</Text>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{zh(title)}</Text>
                    <View style={styles.metaRow}>
                      {isComp ? (
                        <Text style={styles.metaText} numberOfLines={1}>
                          {nameA} <Text style={styles.vs}>×</Text> {r.profileB?.name ?? zh('未命名')}
                        </Text>
                      ) : (
                        <Text style={styles.metaText} numberOfLines={1}>
                          {nameA}
                          {!isComp && r.readingType === 'ANNUAL' && r.targetYear ? (
                            <Text style={styles.year}> · {r.targetYear}{zh('年')}</Text>
                          ) : null}
                        </Text>
                      )}
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.metaText}>{fmtDate(r.createdAt)}</Text>
                      <Text style={styles.dot}>·</Text>
                      {/* 「點」 not 「額度」 — the rest of the app (CreditBadge,
                          解讀 hub, paywall, store) all say 點. */}
                      {isFree ? (
                        <Text style={styles.freeBadge}>{zh('免費')}</Text>
                      ) : (
                        <Text style={styles.creditBadge}>-{r.creditsUsed} {zh('點')}</Text>
                      )}
                    </View>
                  </View>
                  <Text style={styles.arrow}>→</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgPrimary },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl * 2 },
  centerText: { fontSize: fontSize.base, color: colors.textSecondary },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl * 2 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: fontSize.lg, fontFamily: fonts.serifBold, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', maxWidth: 260 },
  startBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    ...shadows.warm,
  },
  startText: { color: colors.textOnRed, fontSize: fontSize.base, fontWeight: '700' },
  list: { gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    ...shadows.warm,
  },
  cardIcon: { fontSize: fontSize.xxl },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: fontSize.base, fontFamily: fonts.serifBold, fontWeight: '700', color: colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  metaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  vs: { color: colors.red, fontWeight: '700' },
  year: { color: colors.red, fontWeight: '700' },
  dot: { fontSize: fontSize.sm, color: colors.textMuted },
  freeBadge: { fontSize: fontSize.xs, color: colors.success, fontWeight: '700' },
  creditBadge: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
  arrow: { fontSize: fontSize.base, color: colors.textMuted },
});
