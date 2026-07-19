/**
 * Floating «問 AI 命理師» button, pinned bottom-right of a reading/fortune
 * screen. Tapping opens the ChatSheet. RN port of the web ChatFloatingButton.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, StyleSheet, View, useAnimatedValue } from 'react-native';
import { MessageCircle } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, shadows } from '../../theme';
import { useZh } from '../../lib/language';

/** Travel distance when hidden — button height plus its bottom inset. */
const HIDE_OFFSET = 96;

interface Props {
  onPress: () => void;
  /** Optional quota badge (e.g. "12/15"). */
  badgeText?: string;
  /**
   * Slide the button out of the way. The reading screens set this while the user
   * is scrolling DOWN: the button is opaque and permanently pinned, so on a long
   * reading it sat on top of real content the whole way down. Reading is the
   * primary task, so the button yields to it and returns on scroll-up.
   */
  hidden?: boolean;
}

export default function ChatFloatingButton({ onPress, badgeText, hidden = false }: Props) {
  const zh = useZh();
  const slide = useAnimatedValue(0);
  const shownRef = useRef(true);

  useEffect(() => {
    const next = hidden ? 1 : 0;
    if (shownRef.current === !hidden) return;
    shownRef.current = !hidden;
    Animated.timing(slide, {
      toValue: next,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [hidden, slide]);

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, HIDE_OFFSET] }) },
          ],
          opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        },
      ]}
      pointerEvents={hidden ? 'none' : 'box-none'}
      // Keep it off the a11y tree while parked, so screen readers don't offer a
      // control the user can't see.
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <Pressable
        style={styles.button}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={zh('開啟 AI 命理師對話')}
      >
        {badgeText ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badgeText}</Text>
          </View>
        ) : null}
        <MessageCircle size={18} strokeWidth={2} color={colors.textOnRed} />
        <Text style={styles.label}>{zh('問 AI 命理師')}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: spacing.lg, bottom: spacing.xl },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.red,
    borderRadius: 999,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.warm,
  },
  label: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textOnRed },
  badge: {
    position: 'absolute',
    top: -8,
    right: 6,
    backgroundColor: colors.gold,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: { fontSize: 11, lineHeight: 15, fontWeight: '800', color: colors.textOnGold },
});
