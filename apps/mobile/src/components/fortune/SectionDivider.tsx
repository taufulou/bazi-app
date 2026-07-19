import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize } from '../../theme';

/**
 * SectionDivider — «─── ◆ ───» centered gold ornament between major zones on the
 * 運勢 screen, mirroring web's SectionDivider (UX Refinement Sprint 2.H). Purely
 * decorative → aria-hidden.
 */
export default function SectionDivider() {
  return (
    <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.line} />
      <Text style={styles.diamond}>◆</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  line: { width: 40, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderMedium },
  diamond: { fontSize: fontSize.xs, color: colors.gold },
});
