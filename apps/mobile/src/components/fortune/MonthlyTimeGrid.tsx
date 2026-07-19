/**
 * MonthlyTimeGrid — 月運 intra-month partition display (上半月/下半月). RN port.
 *
 * partition LOCKED to `tiangan_dizhi_half`: 上半月 (流月天干主氣) / 下半月
 * (流月地支主氣). With intraMonthBreakdown → per-bucket day counts + 主導神煞 +
 * peak signals; without → partition concept only.
 */
import { View, Text, StyleSheet } from 'react-native';
import type { PartitionSpec, IntraMonthBreakdown } from '../../lib/fortune-api';
import { colors, fontSize, spacing, radius, text as T } from '../../theme';
import { useZh } from '../../lib/language';

interface Props {
  partitionSpec: PartitionSpec;
  intraMonthBreakdown?: IntraMonthBreakdown;
  monthStem?: string;
  monthBranch?: string;
}

function governingPillarLabel(pillar: 'stem' | 'branch', monthStem?: string, monthBranch?: string): string {
  if (pillar === 'stem') return monthStem ? `流月天干 (${monthStem}) 主氣` : '流月天干主氣';
  return monthBranch ? `流月地支 (${monthBranch}) 主氣` : '流月地支主氣';
}

function formatDayRange(dayRange: [number, number | null]): string {
  const [start, end] = dayRange;
  if (end === null) return `第 ${start} 天起 ~ 月末`;
  return `第 ${start} ~ ${end} 天`;
}

export default function MonthlyTimeGrid({ partitionSpec, intraMonthBreakdown, monthStem, monthBranch }: Props) {
  const zh = useZh();
  const buckets = partitionSpec.buckets;
  const breakdownBuckets = intraMonthBreakdown?.buckets ?? [];

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{zh('本月時段分析')}</Text>
      <Text style={styles.subtitle}>{zh('流月逼進法 — 上半月主天干氣，下半月主地支氣')}</Text>

      <View style={styles.grid}>
        {buckets.map((bucket, idx) => {
          const breakdown = breakdownBuckets[idx];
          const pillarLabel = governingPillarLabel(bucket.governing_pillar, monthStem, monthBranch);
          return (
            <View key={bucket.label} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{zh(bucket.label)}</Text>
                <View style={styles.pillarBadge}>
                  <Text style={styles.pillarBadgeText}>{zh(pillarLabel)}</Text>
                </View>
              </View>
              <Text style={styles.cardRange}>{zh(formatDayRange(bucket.day_range))}</Text>

              {breakdown ? (
                <>
                  <View style={styles.dayCounts}>
                    <Text style={[styles.countItem, { color: colors.successText }]}>{zh(`吉 ${breakdown.auspicious_days}`)}</Text>
                    <Text style={[styles.countItem, { color: colors.metalText }]}>{zh(`平 ${breakdown.neutral_days}`)}</Text>
                    <Text style={[styles.countItem, { color: colors.errorText }]}>{zh(`凶 ${breakdown.challenging_days}`)}</Text>
                  </View>

                  {breakdown.dominant_shensha.length > 0 && (
                    <View style={styles.shenshaRow}>
                      <Text style={styles.shenshaLabel}>{zh('主導神煞：')}</Text>
                      {breakdown.dominant_shensha.map((s) => (
                        <View key={s} style={styles.shenshaTag}>
                          <Text style={styles.shenshaTagText}>{zh(s)}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {breakdown.peak_signals.slice(0, 3).map((peak, peakIdx) => (
                    <View key={peak.date ?? `${bucket.label}-peak-${peakIdx}`} style={styles.peakItem}>
                      {peak.date ? <Text style={styles.peakDate}>{peak.date}</Text> : null}
                      <Text style={styles.peakLabel}>{zh(peak.label)}</Text>
                      {peak.signals[0] ? <Text style={styles.peakSignal}>{zh(peak.signals[0])}</Text> : null}
                    </View>
                  ))}
                </>
              ) : (
                <Text style={styles.placeholderHint}>
                  {zh('詳細日級訊號可在下方解讀中閱讀，或切換至「日運」查詢單日詳情')}
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {intraMonthBreakdown ? (
        <Text style={styles.windowInfo}>
          {zh(
            `流月窗口：${intraMonthBreakdown.liuyue_window.start} — ${intraMonthBreakdown.liuyue_window.end} (共 ${intraMonthBreakdown.liuyue_window.days} 天)`,
          )}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { ...T.section, color: colors.textAccent },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  grid: { gap: spacing.md, marginTop: spacing.xs },
  card: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { ...T.subsection, color: colors.textPrimary },
  pillarBadge: { backgroundColor: 'rgba(212,160,23,0.10)', borderColor: colors.borderMedium, borderWidth: 1, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  // 「流月天干 (乙) 主氣」 — states which pillar governs the half-month; content.
  pillarBadgeText: { ...T.meta, color: colors.textSecondary, fontWeight: '600' },
  cardRange: { fontVariant: ['tabular-nums'] as const, fontSize: fontSize.sm, color: colors.textMuted },
  dayCounts: { flexDirection: 'row', gap: spacing.md },
  countItem: { fontVariant: ['tabular-nums'] as const, fontSize: fontSize.sm, fontWeight: '700' },
  shenshaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  // The 神煞 names and peak dates are the substance of this card, not chrome — they
  // sat at 12 alongside the disclaimers. `label`/`meta` (13) lifts the content a
  // rung and leaves 12 to what really is caption-class here: peakSignal (a
  // secondary detail under an already-labelled peak) and windowInfo (a footnote).
  shenshaLabel: { ...T.label, color: colors.textSecondary },
  shenshaTag: { backgroundColor: 'rgba(226,61,40,0.08)', borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  shenshaTagText: { ...T.meta, color: colors.textAccent },
  peakItem: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  peakDate: { ...T.meta, fontVariant: ['tabular-nums'] as const, fontWeight: '700', color: colors.textPrimary },
  peakLabel: { ...T.meta, color: colors.textSecondary },
  peakSignal: { fontSize: fontSize.xs, color: colors.textMuted },
  placeholderHint: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 24 },
  windowInfo: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
});
