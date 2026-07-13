/**
 * ChatMessage — one chat bubble (RN port of apps/web ChatMessage.tsx).
 *
 * Presentational; driven entirely by the `message` prop:
 *   - USER      → right-aligned, red-tinted bubble (typed content, NOT converted
 *                 to Simplified — mirrors the web `data-no-zh` rule).
 *   - ASSISTANT → left-aligned card bubble, **bold** markdown support + zh().
 *   - SYSTEM / isRegrounding → subtle centered note.
 *
 * Failure/refund state: REFUSED_PRE_FLIGHT is an intended (successful) refusal
 * and does NOT render as a failure. Any other errorCode, or a refundedAt, shows
 * a subtle cancelled/refunded tag + muted bubble.
 */
import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ChatMessage as ChatMessageType } from '../../lib/chat-types';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { parseBoldSegments } from '../fortune/markdown';

/** Render **markdown bold** into <Text> spans (mirrors NarrativeCard's RichText). */
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

export default function ChatMessage({ message }: { message: ChatMessageType }) {
  const zh = useZh();

  // System / regrounding notes — subtle, centered, non-bubble.
  if (message.role === 'SYSTEM' || message.isRegrounding) {
    const text = (message.content || '').trim();
    if (!text) return null;
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemNote}>{zh(text)}</Text>
      </View>
    );
  }

  const isUser = message.role === 'USER';
  const isRefusal = message.errorCode === 'REFUSED_PRE_FLIGHT';
  const isFailed = (!!message.errorCode && !isRefusal) || !!message.refundedAt;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
          isFailed && styles.bubbleFailed,
        ]}
      >
        {isUser ? (
          // Never convert the user's own typed message.
          <Text style={styles.userText}>{message.content}</Text>
        ) : (
          <RichText text={message.content} style={styles.assistantText} />
        )}

        {isFailed ? (
          <Text style={styles.errorTag}>
            {message.errorCode
              ? `${zh('已取消')}（${message.errorCode}）`
              : zh('已退款')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },

  // Row alignment
  row: { flexDirection: 'row', marginVertical: spacing.xs },
  rowUser: { justifyContent: 'flex-end' },
  rowAssistant: { justifyContent: 'flex-start' },

  // Bubbles
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleUser: {
    backgroundColor: 'rgba(226,61,40,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(226,61,40,0.28)',
    borderTopRightRadius: radius.sm,
  },
  bubbleAssistant: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderTopLeftRadius: radius.sm,
    ...({
      shadowColor: '#E23D28',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 1,
    } as const),
  },
  bubbleFailed: { opacity: 0.6 },

  userText: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 23 },
  assistantText: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 24 },

  errorTag: {
    marginTop: spacing.xs,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },

  // System / regrounding
  systemRow: { alignItems: 'center', marginVertical: spacing.xs, paddingHorizontal: spacing.lg },
  systemNote: {
    fontFamily: fonts.sans,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
