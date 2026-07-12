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
import type { AIReadingData } from '../../lib/readings-api';
import { ReadingSectionCard, MarkdownText, PaywallOverlay, SectionSkeleton } from './primitives';

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
  /** Deterministic widget for a section, rendered inside its card after prose. */
  renderExtras?: (sectionKey: string) => ReactNode;
  /** Callback for the paywall CTA (non-subscribers). */
  onUnlock?: () => void;
}

export default function AIReadingDisplay({
  data,
  isSubscriber,
  isStreaming = false,
  nextSectionLabel,
  header,
  renderExtras,
  onUnlock,
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
            <MarkdownText text={showFull ? s.full || s.preview : s.preview} convert={zh} />
            {!showFull && s.full ? <PaywallOverlay onUnlock={onUnlock} /> : null}
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
  summaryTitle: { fontFamily: fonts.serif, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 17 },
});
