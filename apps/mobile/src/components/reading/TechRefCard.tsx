import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, radius, fonts } from '../../theme';
import { useZh } from '../../lib/language';
import { SECTION_TECH_BUILDERS } from './techRefBuilders';

/**
 * Collapsible 專業命理依據 (technical reference) card, per section — mirrors web
 * AIReadingDisplay.tsx:2339-2384. Renders the deterministic label/value groups
 * produced by SECTION_TECH_BUILDERS[sectionKey](chartData). Returns null when
 * no builder is registered for the key or it yields no groups.
 */
export default function TechRefCard({
  sectionKey,
  chartData,
}: {
  sectionKey: string;
  chartData: Record<string, unknown> | null | undefined;
}) {
  const zh = useZh();
  const [expanded, setExpanded] = useState(false);

  const groups = useMemo(() => {
    const builder = SECTION_TECH_BUILDERS[sectionKey];
    if (!builder || !chartData) return [];
    try {
      return builder(chartData);
    } catch {
      return [];
    }
  }, [sectionKey, chartData]);

  if (groups.length === 0) return null;

  return (
    <View style={styles.card}>
      <Pressable
        testID="techref-toggle"
        style={styles.toggle}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={styles.arrow}>{expanded ? '▾' : '▸'}</Text>
        <Text style={styles.label}>{zh('專業命理依據')}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.content}>
          {groups.map((group) => (
            <View key={group.category} style={styles.group}>
              <Text style={styles.category}>{zh(group.category)}</Text>
              {group.items.map((item, idx) => (
                <View key={`${group.category}-${idx}`} style={styles.rowItem}>
                  <Text style={styles.key}>{zh(item.label)}</Text>
                  <Text style={styles.value}>{zh(item.value)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgBannerWarm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  arrow: { fontSize: fontSize.sm, color: colors.textMuted, width: 14 },
  label: { fontSize: fontSize.sm, fontFamily: fonts.serifBold, fontWeight: '700', color: colors.textMuted },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  group: { gap: spacing.xs },
  category: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textAccent },
  rowItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  key: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  value: { flex: 1.4, fontSize: fontSize.sm, color: colors.textPrimary, textAlign: 'right' },
});
