import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { READING_TYPE_META, type ReadingType } from '@repo/shared';
import { colors, spacing, fontSize, radius, fonts, shadows } from '../../theme';
import { useZh } from '../../lib/language';
import lifetimeArt from '../../../assets/features/lifetime.webp';
import annualArt from '../../../assets/features/annual.webp';
import careerArt from '../../../assets/features/career.webp';
import loveArt from '../../../assets/features/love.webp';
import compatibilityArt from '../../../assets/features/compatibility.webp';

/**
 * Reading types on the home feature list, in the SAME order the web dashboard
 * shows them (apps/web/app/page.tsx filters READING_TYPE_META to drop `zwds-*`
 * and `health`, leaving exactly these five). Keep in sync with the web filter.
 * The free 排盤 deliberately is NOT here — web has no such card, and mobile keeps
 * that entry point on the 解讀 tab.
 */
const HOME_READINGS: ReadingType[] = ['lifetime', 'annual', 'career', 'love', 'compatibility'];

/**
 * Feature artwork. READING_TYPE_META.image is a web-only /public path and is
 * explicitly documented as NOT portable, so mobile resolves its own copies of the
 * same art (bundled from apps/web/public/features — ~90KB each).
 */
const FEATURE_IMAGES: Partial<Record<ReadingType, number>> = {
  lifetime: lifetimeArt,
  annual: annualArt,
  career: careerArt,
  love: loveArt,
  compatibility: compatibilityArt,
};

/**
 * 八字命理分析 — the home feature list, mirroring the web dashboard's reading
 * grid (which collapses to a single column at ≤768px, i.e. always on a phone).
 * Card anatomy matches web: artwork → body(title + 2-line description) → arrow.
 */
export function FeatureCards() {
  const zh = useZh();
  const router = useRouter();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{zh('八字命理分析')}</Text>

      {HOME_READINGS.map((slug) => {
        const meta = READING_TYPE_META[slug];
        const art = FEATURE_IMAGES[slug];
        return (
          <Pressable
            key={slug}
            style={styles.card}
            // Inlined (not a helper returning string) so expo-router's typed-route
            // literals survive. Web sends 合盤 to /reading/compatibility; on mobile
            // it's a tab, not a reading route.
            onPress={() =>
              slug === 'compatibility'
                ? router.push('/(authenticated)/compat')
                : router.push(`/reading/${slug}`)
            }
            accessibilityRole="button"
            accessibilityLabel={zh(meta.nameZhTw)}
          >
            {art ? (
              <Image source={art} style={styles.cardImage} contentFit="cover" transition={150} />
            ) : (
              <View style={styles.artFallback}>
                <Text style={styles.cardEmoji}>{meta.icon}</Text>
              </View>
            )}
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{zh(meta.nameZhTw)}</Text>
              <Text style={styles.cardDesc} numberOfLines={2}>
                {zh(meta.description['zh-TW'])}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  // Mirrors web .sectionLabel: accent text, serif, 4px red left rule.
  sectionLabel: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textAccent,
    paddingLeft: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.red,
    marginBottom: spacing.xs,
  },
  // Mirrors web .card: horizontal, min-height 72, warm shadow, hairline border.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    minHeight: 72,
    ...shadows.warm,
  },
  cardImage: { width: 80, height: 80, borderRadius: radius.md },
  // Fallback when a type has no bundled art (mirrors web's icon fallback).
  artFallback: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    backgroundColor: 'rgba(226,61,40,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: { fontSize: 30 },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardDesc: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
});
