import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { colors, spacing, fontSize, fonts } from '../../theme';
import { useZh } from '../../lib/language';

const BAR_WIDTH = 84;

/**
 * Floating progress pill, mirroring web page.tsx:1742-1764.
 *  - mode='reveal' → 排盤中, n/6 during the staged chart reveal
 *  - mode='stream' → 解讀中, n/total as AI sections arrive
 * Pulsing dot + a shimmer swept across the fill bar (Animated — the app has no
 * reanimated). Positioned by the caller (absolute).
 */
export default function ProgressPill({
  mode,
  current,
  total,
}: {
  mode: 'reveal' | 'stream';
  current: number;
  total: number;
}) {
  const zh = useZh();
  const pulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 750, useNativeDriver: true }),
      ]),
    );
    const s = Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }),
    );
    p.start();
    s.start();
    return () => {
      p.stop();
      s.stop();
    };
  }, [pulse, shimmer]);

  const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-BAR_WIDTH, BAR_WIDTH] });

  return (
    <View style={styles.pill}>
      <Animated.View style={[styles.dot, { opacity: dotOpacity }]} />
      <Text style={styles.label}>{zh(mode === 'reveal' ? '排盤中' : '解讀中')}</Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
        <Animated.View style={[styles.shimmer, { transform: [{ translateX: shimmerX }] }]} />
      </View>
      <Text style={styles.count}>
        {current}/{total}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,251,245,0.96)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
  label: { fontSize: fontSize.sm, fontFamily: fonts.serifBold, fontWeight: '700', color: colors.textAccent },
  bar: { width: BAR_WIDTH, height: 6, borderRadius: 3, backgroundColor: colors.borderLight, overflow: 'hidden' },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.gold, borderRadius: 3 },
  shimmer: { position: 'absolute', top: 0, bottom: 0, width: 32, backgroundColor: 'rgba(255,255,255,0.55)' },
  count: { fontSize: fontSize.xs, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
