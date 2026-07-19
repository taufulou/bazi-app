import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Briefcase, Calendar, Handshake, Heart, Sparkles, Star, type LucideIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { READING_TYPE_META, type ReadingType } from '@repo/shared';
import { colors, spacing, fontSize, radius, fonts } from '../../theme';
import { useZh } from '../../lib/language';

/**
 * 🔮 更多運程分析 cross-sell grid, mirroring web AIReadingDisplay.tsx:2310-2330.
 * Rendered at the bottom of a completed reading. The current reading type is
 * filtered out. Only mobile-supported routes are listed (web's 先天健康/ZWDS
 * have no mobile screens → omitted per v1 scope).
 *
 * Display names come from READING_TYPE_META — the same source 首頁 FeatureCards
 * and the 解讀 hub use. Local literals had already drifted: this grid said
 * 「愛情姻緣」 while every other surface said 「八字愛情姻緣」.
 */
const CROSS_SELL: { slug: ReadingType; Icon: LucideIcon; href: string }[] = [
  { slug: 'lifetime', Icon: Star, href: '/reading/lifetime' },
  { slug: 'annual', Icon: Calendar, href: '/reading/annual' },
  { slug: 'career', Icon: Briefcase, href: '/reading/career' },
  { slug: 'love', Icon: Heart, href: '/reading/love' },
  { slug: 'compatibility', Icon: Handshake, href: '/(authenticated)/compat' },
];

export default function CrossSellGrid({ readingType }: { readingType: string }) {
  const zh = useZh();
  const router = useRouter();
  const items = CROSS_SELL.filter((i) => i.slug !== readingType);
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Sparkles size={19} strokeWidth={2} color={colors.textAccent} />
        <Text style={styles.title}>{zh('更多運程分析')}</Text>
      </View>
      <View style={styles.grid}>
        {items.map((item) => (
          <Pressable
            key={item.slug}
            style={styles.card}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPress={() => router.push(item.href as any)}
            accessibilityRole="button"
          >
            <item.Icon size={26} strokeWidth={1.8} color={colors.textAccent} />
            <Text style={styles.cardName}>{zh(READING_TYPE_META[item.slug].nameZhTw)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: fontSize.lg, fontFamily: fonts.serifBold, fontWeight: '700', color: colors.textAccent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  cardName: { fontSize: fontSize.sm, color: colors.textPrimary, textAlign: 'center', fontWeight: '600' },
});
