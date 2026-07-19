/**
 * YearlyRiskOpportunityGrid — 年運 核心風險&機會 section. RN port.
 * 機會點 / 風險點 columns; engine months paired with AI keyword+narrative by
 * array index. flatYear → calm message.
 */
import { View, Text, StyleSheet } from 'react-native';
import type {
  YearlyCoreRiskOpportunity,
  YearlyRiskOpportunityEntry,
  YearlyFortuneNarrative,
} from '../../lib/fortune-api';
import { Lightbulb, Shield } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { parseBoldSegments } from './markdown';

type AiEntry = NonNullable<YearlyFortuneNarrative['yearly_risk_opportunities']>[number];

interface Props {
  coreRiskOpportunity: YearlyCoreRiskOpportunity;
  aiEntries?: AiEntry[];
}

function RichText({ text, style }: { text: string; style?: object }) {
  const zh = useZh();
  const segments = parseBoldSegments(zh(text));
  return (
    <Text style={style}>
      {segments.map((seg, i) =>
        seg.type === 'bold' ? (
          <Text key={i} style={styles.bold}>
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        ),
      )}
    </Text>
  );
}

function pairAi(
  entries: YearlyRiskOpportunityEntry[],
  aiEntries: AiEntry[] | undefined,
  slotType: 'opportunity' | 'risk',
): Array<{ engine: YearlyRiskOpportunityEntry; ai: AiEntry | undefined }> {
  const aiForType = (aiEntries ?? []).filter((a) => a.type === slotType);
  return entries.map((engine, idx) => ({ engine, ai: aiForType[idx] }));
}

function EntryCard({
  engine,
  ai,
  accent,
}: {
  engine: YearlyRiskOpportunityEntry;
  ai: AiEntry | undefined;
  accent: string;
}) {
  const zh = useZh();
  return (
    <View style={[styles.entry, { borderLeftColor: accent }]}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryMonth}>{zh(engine.monthLabel)}</Text>
        <Text style={styles.entryDim}>{zh(engine.dimZh)}</Text>
        <Text style={styles.entryLabel}>{zh(engine.auspiciousness)}</Text>
      </View>
      {ai?.keyword ? <Text style={styles.entryKeyword}>{zh(ai.keyword)}</Text> : null}
      {ai?.narrative ? <RichText text={ai.narrative} style={styles.entryNarrative} /> : null}
      {engine.caveat ? <Text style={styles.caveatTag}>{zh(`機會中留意：${engine.dimZh}`)}</Text> : null}
    </View>
  );
}

export default function YearlyRiskOpportunityGrid({ coreRiskOpportunity, aiEntries }: Props) {
  const zh = useZh();
  const { opportunities, risks, flatYear } = coreRiskOpportunity;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{zh('核心風險 & 機會')}</Text>
      <Text style={styles.subtitle}>{zh('本年度最值得把握與留意的關鍵月份')}</Text>

      {flatYear ? (
        <Text style={styles.flatYear}>{zh('今年運勢平穩，無顯著起伏。')}</Text>
      ) : (
        <View style={styles.columns}>
          <View style={styles.column}>
            <View style={styles.columnTitleRow}>
              <Lightbulb size={15} strokeWidth={2} color={colors.textAccent} />
              <Text style={styles.columnTitle}>{zh('機會點')}</Text>
            </View>
            {opportunities.length > 0 ? (
              pairAi(opportunities, aiEntries, 'opportunity').map(({ engine, ai }, i) => (
                <EntryCard key={`${engine.month}-${i}`} engine={engine} ai={ai} accent={colors.success} />
              ))
            ) : (
              <Text style={styles.columnEmpty}>{zh('今年無特別突出的機會月份')}</Text>
            )}
          </View>

          <View style={styles.column}>
            <View style={styles.columnTitleRow}>
              <Shield size={15} strokeWidth={2} color={colors.textAccent} />
              <Text style={styles.columnTitle}>{zh('風險點')}</Text>
            </View>
            {risks.length > 0 ? (
              pairAi(risks, aiEntries, 'risk').map(({ engine, ai }, i) => (
                <EntryCard key={`${engine.month}-${i}`} engine={engine} ai={ai} accent={colors.error} />
              ))
            ) : (
              <Text style={styles.columnEmpty}>{zh('今年無特別需留意的風險月份')}</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  bold: { fontWeight: '700' },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  flatYear: { fontSize: fontSize.base, color: colors.textSecondary, marginTop: spacing.sm },
  columns: { gap: spacing.lg, marginTop: spacing.xs },
  column: { gap: spacing.sm },
  columnTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  columnTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  columnEmpty: { fontSize: fontSize.sm, color: colors.textMuted },
  entry: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    padding: spacing.md,
    gap: 4,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entryMonth: { fontVariant: ['tabular-nums'] as const, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  entryDim: { fontSize: fontSize.xs, color: colors.textSecondary },
  entryLabel: { fontSize: fontSize.xs, color: colors.textAccent, fontWeight: '600' },
  entryKeyword: { fontSize: fontSize.sm, color: colors.textAccent, fontWeight: '600' },
  entryNarrative: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 24 },
  caveatTag: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic' },
});
