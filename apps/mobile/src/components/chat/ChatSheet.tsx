/**
 * ChatSheet — the AI 命理師 chat surface. RN port of the web ChatDrawer, on a
 * plain RN `Modal` bottom sheet (NOT @gorhom/bottom-sheet, which is a no-op
 * under SDK-57 New-Arch per the M1 ElementExplanation finding). Wires
 * useChatSession + useChatStream + the leaf components + the quota/refuse
 * dialogs.
 *
 * Subject: exactly one of readingId / comparisonId / fortune (backend
 * XOR-validates). `pendingInitialMessage` + `populateOnly` drive the
 * InlineAskCard populate-only entry (pre-fill the composer, never auto-send).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { X, Plus, MessageCircle } from 'lucide-react-native';
import {
  CHAT_SESSION_HARD_CAP_MESSAGES,
  CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD,
} from '@repo/shared';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import type { ChatDialogKey } from '../../lib/chat-types';
import type { ChatReadingType, FortuneSubject } from '../../lib/chat-api';
import { useChatSession } from './hooks/useChatSession';
import { useChatStream } from './hooks/useChatStream';
import { useSampleQuestions } from './hooks/useSampleQuestions';
import ChatThread from './ChatThread';
import ChatComposer, { type ChatComposerHandle } from './ChatComposer';
import { ExtendDialog, HardCapDialog, RefuseLimitDialog } from './ChatDialogs';

// Non-recoverable session-level stream errors → lock the session + show the
// «開啟新對話» recovery banner (raw zh-TW; converted via zh() at render).
// Mirrors web ChatDrawer LOCK_ERROR_CODES.
const LOCK_ERROR_CODES: Record<string, string> = {
  CONTEXT_VERSION_DRIFTED: '對話內容已過期（系統已更新），請開啟新對話以使用最新版本',
  SESSION_EXPIRED: '此對話已超過 24 小時，請開啟新對話',
  SESSION_ENDED: '此對話已結束，請開啟新對話',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  readingType: ChatReadingType;
  readingId?: string;
  comparisonId?: string;
  fortune?: FortuneSubject;
  sectionContextHint?: string;
  /** Pre-fill / auto-send this on open (InlineAskCard). */
  pendingInitialMessage?: string;
  /** When true, POPULATE the composer (no auto-send) — the locked FORTUNE UX. */
  populateOnly?: boolean;
  onPendingInitialMessageConsumed?: () => void;
}

export default function ChatSheet({
  visible,
  onClose,
  readingType,
  readingId,
  comparisonId,
  fortune,
  sectionContextHint,
  pendingInitialMessage,
  populateOnly = false,
  onPendingInitialMessageConsumed,
}: Props) {
  const zh = useZh();
  const composerRef = useRef<ChatComposerHandle>(null);

  const session = useChatSession({ readingId, comparisonId, fortune, enabled: visible });
  const stream = useChatStream({
    sessionId: session.sessionId,
    appendUserMessage: session.appendUserMessage,
    replaceUserMessageId: session.replaceUserMessageId,
    appendAssistantPlaceholder: session.appendAssistantPlaceholder,
    appendAssistantDelta: session.appendAssistantDelta,
    finalizeAssistantMessage: session.finalizeAssistantMessage,
    markUserFailed: session.markUserFailed,
    applyDoneEvent: session.applyDoneEvent,
  });
  const { questions: sampleQuestions } = useSampleQuestions(
    readingType,
    null,
    fortune?.fortuneScope,
  );

  const [dialogKey, setDialogKey] = useState<ChatDialogKey | null>(null);
  const [refuseLimitDialogShown, setRefuseLimitDialogShown] = useState(false);
  const [pendingSend, setPendingSend] = useState<string | null>(null);
  const sentInitialRef = useRef<string | null>(null);

  const remainingPaid = session.payment
    ? Math.max(0, session.payment.paidAllowanceTotal - session.payment.paidUsed)
    : 0;
  const atHardCap = session.messageCount >= CHAT_SESSION_HARD_CAP_MESSAGES;
  const messagesRemaining = Math.max(
    0,
    (session.payment?.freeQuotaRemaining ?? 0) + remainingPaid,
  );

  // Session init-on-open is owned by useChatSession's own [enabled]-keyed
  // auto-init effect (enabled === visible). A duplicate initSession() here
  // would race it on first open — both fire against the same pre-update
  // snapshot (sessionId still null) → two POST session creations, one
  // orphaned. So we DON'T re-init here.

  // Reset per-open transient state on close.
  useEffect(() => {
    if (!visible) {
      setDialogKey(null);
      setPendingSend(null);
      sentInitialRef.current = null;
    }
  }, [visible]);

  // Refuse-cap «超出範圍提醒» dialog — fire once per streak at the threshold.
  useEffect(() => {
    if (session.consecutiveRefuses >= CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD) {
      if (!refuseLimitDialogShown) {
        setDialogKey('refuse_limit_reached');
        setRefuseLimitDialogShown(true);
      }
    } else if (refuseLimitDialogShown) {
      setRefuseLimitDialogShown(false); // reset when the streak breaks
    }
  }, [session.consecutiveRefuses, refuseLimitDialogShown]);

  // Stream-error → dialog/lock routing (mirrors web ChatDrawer). Without this,
  // a NEEDS_EXTENSION/HARD_CAP_REACHED shows a bare banner instead of the
  // purchase/new-session dialog, and a CONTEXT_VERSION_DRIFTED / SESSION_EXPIRED
  // / SESSION_ENDED never locks the composer → the user retries the same
  // doomed message forever with no guidance.
  useEffect(() => {
    if (!stream.error) return;
    if (stream.error.code === 'NEEDS_EXTENSION') {
      setDialogKey('extend_standard');
      stream.clearError();
    } else if (stream.error.code === 'HARD_CAP_REACHED') {
      setDialogKey('hard_cap_reached');
      stream.clearError();
    } else if (LOCK_ERROR_CODES[stream.error.code]) {
      // Non-recoverable — lock + prompt new session. The error stays visible
      // (don't auto-clear) until the user picks new-session.
      session.lockSession(LOCK_ERROR_CODES[stream.error.code]!);
      stream.clearError();
    }
  }, [stream.error, stream, session]);

  const handleSend = useCallback(
    (content: string) => {
      if (session.locked) return;
      if (atHardCap) {
        setDialogKey('hard_cap_reached');
        return;
      }
      const hasFree = (session.payment?.freeQuotaRemaining ?? 0) > 0;
      const hasPaid = remainingPaid > 0;
      if (!hasFree && !hasPaid) {
        setDialogKey('extend_standard');
        setPendingSend(content);
        return;
      }
      void stream.sendMessage(content, sectionContextHint);
    },
    [session.locked, session.payment, atHardCap, remainingPaid, stream, sectionContextHint],
  );

  // InlineAskCard entry — populate (or send) the pending message once ready.
  useEffect(() => {
    if (!visible || !pendingInitialMessage) return;
    if (sentInitialRef.current === pendingInitialMessage) return;
    if (!session.sessionId || session.loading || session.locked || stream.streaming) return;
    sentInitialRef.current = pendingInitialMessage;
    if (populateOnly) {
      composerRef.current?.appendToDraft(pendingInitialMessage);
    } else {
      handleSend(pendingInitialMessage);
    }
    onPendingInitialMessageConsumed?.();
  }, [
    visible,
    pendingInitialMessage,
    populateOnly,
    session.sessionId,
    session.loading,
    session.locked,
    stream.streaming,
    handleSend,
    onPendingInitialMessageConsumed,
  ]);

  const confirmExtension = useCallback(async () => {
    try {
      await session.purchaseExtension();
      setDialogKey(null);
      const replay = pendingSend;
      setPendingSend(null);
      if (replay) void stream.sendMessage(replay, sectionContextHint);
    } catch {
      setDialogKey(null);
    }
  }, [session, pendingSend, stream, sectionContextHint]);

  const startNew = useCallback(async () => {
    setDialogKey(null);
    await session.startNewSession();
  }, [session]);

  const showEmptyState = session.messages.length === 0 && !session.loading && !stream.streaming;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>{zh('AI 命理師對話')}</Text>
              <View style={styles.headerRight}>
                {session.payment ? (
                  <View style={styles.quotaChip}>
                    <Text style={styles.quotaText}>{zh(`剩 ${messagesRemaining} 則`)}</Text>
                  </View>
                ) : null}
                <Pressable onPress={startNew} hitSlop={8} accessibilityLabel={zh('新對話')}>
                  <Plus size={20} color={colors.red} />
                </Pressable>
                <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={zh('關閉')}>
                  <X size={22} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>

            {session.locked ? (
              <View style={styles.lockedBanner}>
                <Text style={styles.lockedText}>{zh(session.lockReason ?? '此對話已結束，請開啟新對話')}</Text>
                <Pressable onPress={startNew} accessibilityRole="button">
                  <Text style={styles.lockedCta}>{zh('開啟新對話')}</Text>
                </Pressable>
              </View>
            ) : null}

            {stream.error && !session.locked ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{zh(stream.error.message)}</Text>
              </View>
            ) : null}

            {/* Body */}
            {session.loading && session.messages.length === 0 ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={colors.red} />
              </View>
            ) : showEmptyState ? (
              <ScrollView contentContainerStyle={styles.emptyState}>
                <MessageCircle size={40} color={colors.gold} />
                <Text style={styles.emptyTitle}>{zh('想問什麼？')}</Text>
                {sampleQuestions.slice(0, 4).map((q) => (
                  <Pressable
                    key={q.id}
                    style={styles.sampleBtn}
                    onPress={() => composerRef.current?.appendToDraft(q.questionText)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.sampleText}>{zh(q.questionText)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <ChatThread
                messages={session.messages}
                streaming={stream.streaming}
                onLoadMore={session.loadMoreHistory}
                hasMore={session.hasMoreHistory}
                loadingMore={session.loadMoreLoading}
              />
            )}

            {/* Composer */}
            <ChatComposer
              ref={composerRef}
              onSend={handleSend}
              // streaming is covered separately via `sending`; block input
              // until the session exists + finished loading so a fast typist
              // can't fire handleSend before session.payment loads (which
              // would misread quota=0 → false «需延伸» dialog).
              disabled={!session.sessionId || session.loading || session.locked}
              sending={stream.streaming}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Dialogs */}
      <ExtendDialog
        visible={dialogKey === 'extend_standard' || dialogKey === 'near_cap_warning'}
        isPurchasing={session.isPurchasingExtension}
        allowanceInfo={{ messagesUntilHardCap: Math.max(0, CHAT_SESSION_HARD_CAP_MESSAGES - session.messageCount) }}
        onConfirm={confirmExtension}
        onCancel={() => {
          setDialogKey(null);
          setPendingSend(null);
        }}
      />
      <HardCapDialog
        visible={dialogKey === 'hard_cap_reached'}
        onNewSession={startNew}
        onClose={() => setDialogKey(null)}
      />
      <RefuseLimitDialog
        visible={dialogKey === 'refuse_limit_reached'}
        onClose={() => setDialogKey(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    height: '90%',
    backgroundColor: colors.bgPrimary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.bgCard,
  },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  quotaChip: { backgroundColor: colors.bgSecondary, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  quotaText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600' },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  lockedText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  lockedCta: { fontSize: fontSize.sm, fontWeight: '700', color: colors.red },
  errorBanner: { backgroundColor: 'rgba(226,61,40,0.08)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  errorText: { fontSize: fontSize.sm, color: colors.error },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  sampleBtn: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
  },
  sampleText: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 22 },
});
