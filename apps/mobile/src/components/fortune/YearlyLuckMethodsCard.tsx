/**
 * YearlyLuckMethodsCard — 年運 改運建議&好運加持 section. RN port.
 * Engine `luckMethods.cards[]` (deterministic, AI-free). 民俗 badge for
 * folk_tradition/mixed provenance. 用神/方位/色 chips.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { YearlyLuckMethods } from '../../lib/fortune-api';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

interface Props {
  luckMethods: YearlyLuckMethods;
}

function showsFolkBadge(provenance: string): boolean {
  return provenance === 'folk_tradition' || provenance === 'mixed';
}

export default function YearlyLuckMethodsCard({ luckMethods }: Props) {
  const zh = useZh();
  const { cards, weakestDimZh, disclaimer } = luckMethods;
  if (!cards || cards.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{zh('改運建議 & 好運加持')}</Text>
      {weakestDimZh ? <Text style={styles.subtitle}>{zh(`本年度可特別留意「${weakestDimZh}」面向的調養`)}</Text> : null}

      <View style={styles.grid}>
        {cards.map((card) => (
          <View key={card.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{zh(card.title)}</Text>
              {showsFolkBadge(card.provenance) ? (
                <View style={styles.folkBadge}>
                  <Text style={styles.folkBadgeText}>{zh('民俗')}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.cardBody}>{zh(card.body)}</Text>
            {card.usefulGodElement || card.usefulGodDirection || card.usefulGodColor ? (
              <View style={styles.cardMeta}>
                {card.usefulGodElement ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{zh(`用神：${card.usefulGodElement}`)}</Text>
                  </View>
                ) : null}
                {card.usefulGodDirection ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{zh(`方位：${card.usefulGodDirection}`)}</Text>
                  </View>
                ) : null}
                {card.usefulGodColor ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{zh(`色：${card.usefulGodColor}`)}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {disclaimer ? <Text style={styles.disclaimer}>{zh(disclaimer)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  grid: { gap: spacing.md, marginTop: spacing.xs },
  card: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  folkBadge: { backgroundColor: 'rgba(139,111,71,0.12)', borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  folkBadgeText: { fontSize: 12, lineHeight: 16, fontStyle: 'italic', fontWeight: '600', color: colors.textMuted },
  cardBody: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 24 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { backgroundColor: 'rgba(212,160,23,0.10)', borderColor: colors.borderMedium, borderWidth: 1, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipText: { fontSize: fontSize.xs, color: colors.textPrimary, fontWeight: '600' },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18, marginTop: spacing.xs },
});
