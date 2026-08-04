import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Lightbulb } from 'lucide-react-native';
import { colors, spacing, fontSize, radius } from '../../theme';
import { useZh } from '../../lib/language';

/**
 * Green "loaded from cache — no credits charged" banner, mirroring web
 * page.tsx:2007-2013. Shown when a reading resolves from cache (fromCache).
 * Auto-dismisses 5s after `paused` clears (matches web), or via the ✕ button.
 *
 * ⚠️ `paused` is load-bearing, not a nicety. The staged chart reveal runs ~7.2s
 * of timers (CHART_REVEAL_DELAYS) while the viewport tracks the animating chart.
 * A countdown that started the moment the response landed expired BEFORE the
 * page settled — measured on web, the twin of this component: banner up at 2.9s,
 * down at 8.9s, page still animating until 13.9s. The user never saw it. Hold
 * the countdown until the reveal finishes and it gets a real 5s on a still page.
 */
export default function CacheToast({
  visible,
  onDismiss,
  paused = false,
}: {
  visible: boolean;
  onDismiss: () => void;
  paused?: boolean;
}) {
  const zh = useZh();

  useEffect(() => {
    if (!visible || paused) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
    // onDismiss is a stable setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, paused]);

  if (!visible) return null;

  return (
    <View style={styles.banner}>
      <Lightbulb size={17} strokeWidth={2} color={colors.textAccent} />
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
    // OPAQUE: this renders as a pinned overlay above the reading content, so the
    // web's 8%-alpha tint let 神煞 chips bleed through and made the text unreadable.
    backgroundColor: '#EDF7ED',
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.35)',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    // Lifts it off the content it now floats over.
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: { flex: 1, fontSize: fontSize.sm, color: '#2e7d32', lineHeight: 20 },
  close: { fontSize: fontSize.base, color: '#2e7d32', opacity: 0.7, paddingHorizontal: spacing.xs },
});
