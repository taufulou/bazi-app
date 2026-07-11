import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, fonts } from '../theme';
import { useZh } from '../lib/language';

/** Placeholder body for tabs whose feature ships in a later milestone. */
export function ComingSoon({ title, note }: { title: string; note?: string }) {
  const zh = useZh();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{zh(title)}</Text>
      <Text style={styles.subtitle}>{zh(note ?? '即將推出')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPrimary,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { fontFamily: fonts.serif, fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.base, color: colors.textMuted },
});
