/**
 * YearlyCrossSellCard — 年運 cross-sell to the paid 八字流年運勢. RN port.
 *
 * NOTE: the paid ANNUAL reading isn't on mobile until M3, so this is a static
 * informational card for now (no navigation). When M3 ships the 解讀 reading
 * pages, wire the press to open the ANNUAL reading.
 */
import { View, Text, StyleSheet } from 'react-native';
import { ArrowUpRight } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

export default function YearlyCrossSellCard() {
  const zh = useZh();
  return (
    <View style={styles.card}>
      <Text style={styles.icon}>📜</Text>
      <View style={styles.body}>
        <Text style={styles.title}>{zh('想要完整的流年深度解讀？')}</Text>
        <Text style={styles.sub}>{zh('《八字流年運勢》提供大運 + 流年完整矩陣、逐月吉凶與關鍵時機分析')}</Text>
      </View>
      <ArrowUpRight size={18} strokeWidth={2} color={colors.red} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  icon: { fontSize: 26 },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.serif, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  sub: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18 },
});
