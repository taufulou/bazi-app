/**
 * AIReadingDisplay — orchestrator for a streamed AI reading. Renders each
 * section (already in canonical order from transformAIResponse) in a themed
 * ReadingSectionCard with MarkdownText prose, paywall-gated on `isSubscriber`,
 * plus per-section deterministic widgets (via `renderExtras`), a streaming
 * skeleton, and the summary card. RN port of the web AIReadingDisplay monolith
 * (prose pipeline); the per-reading-type deterministic widgets live in sibling
 * files and are dispatched through `renderExtras`.
 */
import { type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, fontSize, spacing, radius, shadows } from '../../theme';
import { useZh } from '../../lib/language';
import type { AIReadingData, ReadingSectionData } from '../../lib/readings-api';
import { ReadingSectionCard, MarkdownText, PaywallOverlay, SectionSkeleton } from './primitives';
import TechRefCard from './TechRefCard';
import CrossSellGrid from './CrossSellGrid';

/** Sections that always show full content (never paywalled). */
const NO_PAYWALL = new Set(['annual_dayun_context']);
function isNoPaywall(key: string): boolean {
  return NO_PAYWALL.has(key) || key.startsWith('monthly_');
}

interface Props {
  data: AIReadingData | null;
  isSubscriber: boolean;
  isStreaming?: boolean;
  /** Label for the streaming skeleton (e.g. next section title). */
  nextSectionLabel?: string;
  /** Standalone widget rendered before all sections (e.g. lifetime CharacterCard). */
  header?: ReactNode;
  /**
   * Star / verdict badge rendered at the TOP of a section, BEFORE the prose —
   * web parity (apps/web AIReadingDisplay.tsx:1958-2013 puts the score star and
   * the annual/love badges above the narrative). Receives the whole section so
   * it can read `score`.
   */
  renderSectionHeader?: (section: ReadingSectionData) => ReactNode;
  /** Deterministic widget for a section, rendered inside its card after prose. */
  renderExtras?: (sectionKey: string) => ReactNode;
  /** Callback for the paywall CTA (non-subscribers). */
  onUnlock?: () => void;
  /** Chart data → per-section 專業命理依據 (TechRefCard). Omit to hide tech-ref. */
  chartData?: Record<string, unknown> | null;
  /** Frontend slug → bottom cross-sell grid (更多運程分析). Omit to hide. */
  readingType?: string;
}

export default function AIReadingDisplay({
  data,
  isSubscriber,
  isStreaming = false,
  nextSectionLabel,
  header,
  renderSectionHeader,
  renderExtras,
  onUnlock,
  chartData,
  readingType,
}: Props) {
  const zh = useZh();

  return (
    <View style={styles.wrap}>
      {header}

      {data?.sections.map((s) => {
        const showFull = isSubscriber || isNoPaywall(s.key);
        const extras = renderExtras?.(s.key);
        return (
          <ReadingSectionCard key={s.key} sectionKey={s.key} title={zh(s.title)}>
            {/* Star / verdict ABOVE the narrative (web parity). */}
            {renderSectionHeader?.(s)}
            <MarkdownText text={showFull ? s.full || s.preview : s.preview} convert={zh} />
            {!showFull && s.full ? <PaywallOverlay onUnlock={onUnlock} /> : null}
            {/* web order: prose → 專業命理依據 → InlineAsk → deterministic data */}
            {chartData ? <TechRefCard sectionKey={s.key} chartData={chartData} /> : null}
            {extras}
          </ReadingSectionCard>
        );
      })}

      {isStreaming ? (
        <View style={styles.streamingCard}>
          <SectionSkeleton label={zh(nextSectionLabel ?? '命理師正在為您撰寫…')} />
        </View>
      ) : null}

      {data?.summary ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{zh('綜合建議')}</Text>
          <MarkdownText text={data.summary.text} convert={zh} />
        </View>
      ) : null}

      <Text style={styles.disclaimer}>
        {zh('本服務僅供參考與娛樂用途，不構成任何專業建議')}
      </Text>

      {!isStreaming && readingType ? <CrossSellGrid readingType={readingType} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  streamingCard: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg, ...shadows.warm },
  summaryCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    ...shadows.warm,
  },
  summaryTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
});
