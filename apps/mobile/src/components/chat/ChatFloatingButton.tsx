/**
 * Floating «問 AI 命理師» button, pinned bottom-right of a reading/fortune
 * screen. Tapping opens the ChatSheet. RN port of the web ChatFloatingButton.
 */
import { Pressable, Text, StyleSheet, View } from 'react-native';
import { MessageCircle } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, shadows } from '../../theme';
import { useZh } from '../../lib/language';

interface Props {
  onPress: () => void;
  /** Optional quota badge (e.g. "12/15"). */
  badgeText?: string;
}

export default function ChatFloatingButton({ onPress, badgeText }: Props) {
  const zh = useZh();
  return (
    <View style={styles.wrap} pointerEvents="box-none">
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
    </View>
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
  label: { fontFamily: fonts.serif, fontSize: fontSize.base, fontWeight: '700', color: colors.textOnRed },
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
  badgeText: { fontSize: 10, fontWeight: '800', color: colors.textOnGold },
});
