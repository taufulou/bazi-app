import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, fontSize, radius } from '../../theme';
import { useZh } from '../../lib/language';

/**
 * Green "loaded from cache — no credits charged" banner, mirroring web
 * page.tsx:2007-2013. Shown when a reading resolves from cache (fromCache).
 * Auto-dismisses after 5s (matches web setTimeout), or via the ✕ button.
 */
export default function CacheToast({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const zh = useZh();

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
    // onDismiss is a stable setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.icon}>💡</Text>
      <Text style={styles.text}>
        {zh('偵測到相同命盤資料，已載入先前的分析結果（未扣除額度）')}
      </Text>
      <Pressable
        onPress={onDismiss}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={zh('關閉')}
      >
        <Text style={styles.close}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.25)',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  icon: { fontSize: fontSize.base },
  text: { flex: 1, fontSize: fontSize.sm, color: '#2e7d32', lineHeight: 20 },
  close: { fontSize: fontSize.base, color: '#2e7d32', opacity: 0.7, paddingHorizontal: spacing.xs },
});
