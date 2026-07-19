/**
 * ChatThread — scrollable list of chat bubbles (RN port of apps/web ChatThread).
 *
 * Presentational; driven by props. A `ScrollView` auto-scrolls to the bottom on
 * new content (new message OR a streaming delta that grows the last bubble),
 * but only when the user is already near the bottom — so reading history / after
 * a 「載入更多」 fetch doesn't yank them away.
 *
 * Empty state is intentionally nothing — the caller renders sample questions.
 */
import * as React from 'react';
import { useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import type { ChatMessage as ChatMessageType } from '../../lib/chat-types';
import ChatMessage from './ChatMessage';
import { colors, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

interface ChatThreadProps {
  messages: ChatMessageType[];
  /** True while a stream is in flight — shows a 「…」 typing indicator. */
  streaming?: boolean;
  /** Fetch older messages (older page prepended). */
  onLoadMore?: () => void;
  /** Whether an older page exists → renders the 「載入更多」 button. */
  hasMore?: boolean;
  /** True while `onLoadMore` is in flight — swaps the button for a spinner. */
  loadingMore?: boolean;
}

export default function ChatThread({
  messages,
  streaming = false,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
}: ChatThreadProps) {
  const zh = useZh();
  const scrollRef = useRef<ScrollView>(null);
  // Stick-to-bottom guard: true while the user is near the bottom. Flips false
  // when they scroll up (e.g. to read history / trigger load-more) so incoming
  // content doesn't jerk the viewport.
  const stickRef = useRef(true);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom =
      contentSize.height - contentOffset.y - layoutMeasurement.height;
    stickRef.current = distanceFromBottom < 80;
  };

  const onContentSizeChange = () => {
    if (stickRef.current) scrollRef.current?.scrollToEnd({ animated: true });
  };

  // Show the typing indicator while waiting for the response. Once the trailing
  // assistant bubble has content, that bubble itself conveys the live stream, so
  // suppress the standalone indicator to avoid a redundant double-caret.
  const last = messages[messages.length - 1];
  const trailingAssistantHasContent =
    !!last && last.role === 'ASSISTANT' && last.content.length > 0;
  const showTyping = streaming && !trailingAssistantHasContent;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.thread}
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      scrollEventThrottle={64}
      onContentSizeChange={onContentSizeChange}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {hasMore ? (
        <View style={styles.loadMoreWrap}>
          <Pressable
            style={[styles.loadMoreBtn, loadingMore && styles.loadMoreBtnDisabled]}
            onPress={onLoadMore}
            disabled={loadingMore || !onLoadMore}
            accessibilityRole="button"
          >
            {loadingMore ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Text style={styles.loadMoreText}>{zh('載入更多')}</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} />
      ))}

      {showTyping ? (
        <View style={[styles.row, styles.rowAssistant]}>
          <View style={styles.typingBubble}>
            <Text style={styles.typingText}>{zh('正在思考')}…</Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  thread: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },

  // Load-more
  loadMoreWrap: { alignItems: 'center', marginBottom: spacing.md },
  loadMoreBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: colors.bgCard,
    minWidth: 96,
    alignItems: 'center',
  },
  loadMoreBtnDisabled: { opacity: 0.6 },
  loadMoreText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },

  // Typing indicator
  row: { flexDirection: 'row', marginVertical: spacing.xs },
  rowAssistant: { justifyContent: 'flex-start' },
  typingBubble: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  typingText: { fontSize: fontSize.sm, color: colors.textMuted },
});
