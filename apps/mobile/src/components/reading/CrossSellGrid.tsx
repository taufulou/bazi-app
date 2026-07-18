import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize, radius, fonts } from '../../theme';
import { useZh } from '../../lib/language';

/**
 * 🔮 更多運程分析 cross-sell grid, mirroring web AIReadingDisplay.tsx:2310-2330.
 * Rendered at the bottom of a completed reading. The current reading type is
 * filtered out. Only mobile-supported routes are listed (web's 先天健康/ZWDS
 * have no mobile screens → omitted per v1 scope).
 */
const CROSS_SELL: { slug: string; icon: string; name: string; href: string }[] = [
  { slug: 'lifetime', icon: '🌟', name: '八字終身運', href: '/reading/lifetime' },
  { slug: 'annual', icon: '📅', name: '八字流年運勢', href: '/reading/annual' },
  { slug: 'career', icon: '💼', name: '八字事業詳批', href: '/reading/career' },
  { slug: 'love', icon: '💕', name: '愛情姻緣', href: '/reading/love' },
  { slug: 'compatibility', icon: '🤝', name: '合盤比較', href: '/(authenticated)/compat' },
];

export default function CrossSellGrid({ readingType }: { readingType: string }) {
  const zh = useZh();
  const router = useRouter();
  const items = CROSS_SELL.filter((i) => i.slug !== readingType);
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>🔮</Text>
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
            <Text style={styles.cardIcon}>{item.icon}</Text>
            <Text style={styles.cardName}>{zh(item.name)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  headerIcon: { fontSize: fontSize.lg },
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
    borderColor: colors.borderLight,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  cardIcon: { fontSize: fontSize.xxl },
  cardName: { fontSize: fontSize.sm, color: colors.textPrimary, textAlign: 'center', fontWeight: '600' },
});
