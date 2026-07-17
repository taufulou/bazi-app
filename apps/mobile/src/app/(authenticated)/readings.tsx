import { useAuth } from '@clerk/clerk-expo';
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScrollText, ChevronRight } from 'lucide-react-native';
import { READING_TYPE_META, type ReadingType } from '@repo/shared';
import { colors, spacing, fontSize, radius, fonts, shadows } from '../../theme';
import { useZh } from '../../lib/language';
import { getUserProfile } from '../../lib/api';

/** The 4 paid Bazi readings shown on the 解讀 hub (in display order). */
const PAID_READINGS: ReadingType[] = ['lifetime', 'love', 'career', 'annual'];

/**
 * 解讀 hub — grid of reading entries. A free 排盤 (chart-only) card + the 4 paid
 * Bazi readings (終身/愛情/事業/流年). Tapping a paid card → the reading flow
 * (`/reading/[type]`); the free card → `/reading/paipan`.
 */
export default function ReadingsHubScreen() {
  const { getToken, isSignedIn } = useAuth();
  const zh = useZh();
  const router = useRouter();
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const profile = await getUserProfile(token);
        if (!cancelled) setCredits(profile.credits);
      } catch {
        /* non-fatal — hub renders without the credit chip */
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken omitted (unstable Clerk ref → fetch loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{zh('命理解讀')}</Text>
        {credits !== null ? (
          <View style={styles.creditChip}>
            <Text style={styles.creditText}>
              {zh('您有')} <Text style={styles.creditNum}>{credits}</Text> {zh('點')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Free 排盤 */}
      <Pressable
        style={styles.freeCard}
        onPress={() => router.push('/reading/paipan')}
        accessibilityRole="button"
      >
        <View style={styles.freeIcon}>
          <ScrollText size={22} strokeWidth={2} color={colors.red} />
        </View>
        <View style={styles.freeBody}>
          <Text style={styles.freeTitle}>{zh('免費八字排盤')}</Text>
          <Text style={styles.freeSub}>{zh('輸入生辰，免費查看您的命盤')}</Text>
        </View>
        <ChevronRight size={20} color={colors.textMuted} />
      </Pressable>

      <Text style={styles.sectionLabel}>{zh('付費詳批')}</Text>

      {PAID_READINGS.map((slug) => {
        const meta = READING_TYPE_META[slug];
        return (
          <Pressable
            key={slug}
            style={styles.card}
            onPress={() => router.push(`/reading/${slug}`)}
            accessibilityRole="button"
            accessibilityLabel={zh(meta.nameZhTw)}
          >
            <View style={[styles.cardIcon, { backgroundColor: `${meta.themeColor}22` }]}>
              <Text style={styles.cardEmoji}>{meta.icon}</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{zh(meta.nameZhTw)}</Text>
              <Text style={styles.cardDesc} numberOfLines={2}>
                {zh(meta.description['zh-TW'])}
              </Text>
            </View>
            <View style={styles.cardRight}>
              <View style={styles.costPill}>
                <Text style={styles.costText}>{meta.creditCost}</Text>
                <Text style={styles.costUnit}>{zh('點')}</Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </View>
          </Pressable>
        );
      })}

      <Text style={styles.disclaimer}>
        {zh('本服務僅供參考與娛樂用途，不構成任何專業建議')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.title, fontWeight: '800', color: colors.textAccent },
  creditChip: {
    backgroundColor: colors.bgCard,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  creditText: { fontSize: fontSize.sm, color: colors.textSecondary },
  creditNum: { fontWeight: '800', color: colors.red },
  freeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    ...shadows.warm,
  },
  freeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(226,61,40,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeBody: { flex: 1, gap: 2 },
  freeTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  freeSub: { fontSize: fontSize.sm, color: colors.textSecondary },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.warm,
  },
  cardIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cardEmoji: { fontSize: 24 },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  cardDesc: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
  cardRight: { alignItems: 'center', gap: spacing.xs },
  costPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    backgroundColor: 'rgba(226,61,40,0.08)',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  costText: { fontSize: fontSize.base, fontWeight: '800', color: colors.red },
  costUnit: { fontSize: fontSize.xs, color: colors.red },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
});
