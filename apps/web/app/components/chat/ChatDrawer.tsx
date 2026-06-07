'use client';

/**
 * ChatDrawer — the bottom-sheet drawer for the AI chat feature.
 *
 * Mirrors the ElementExplanation Portal + slideUp pattern. Owns:
 * - Session lifecycle (via useChatSession)
 * - Stream lifecycle (via useChatStream)
 * - Dialog dispatch (extend, soft-warning at turn 20, hard cap, etc.)
 *
 * Phase 1 — wired only on lifetime readings (`readingType === 'lifetime'`).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CHAT_SESSION_HARD_CAP_MESSAGES,
  CHAT_SOFT_WARNING_TURN,
  CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD,
} from '@repo/shared';
import { useChatSession } from './hooks/useChatSession';
import { useChatStream } from './hooks/useChatStream';
import ChatThread from './ChatThread';
import ChatComposer, { type ChatComposerHandle } from './ChatComposer';
import ChatDialogs from './ChatDialogs';
import ChatHistoryPanel from './ChatHistoryPanel';
import QuotaBadge from './QuotaBadge';
// Phase 4 — sample-questions browser overlay
import SampleQuestionsBrowser from './SampleQuestionsBrowser';
import { useSampleQuestions } from './hooks/useSampleQuestions';
import type { ChatReadingType } from '../../lib/chat-api';
import type { ChatDialogKey, DialogAction } from './dialog-copy';
import styles from './ChatDrawer.module.css';

/** Backend error codes that put the session into a non-recoverable locked
 *  state. The UI offers "開啟新對話" only — sending is disabled. */
const LOCK_ERROR_CODES: Record<string, string> = {
  CONTEXT_VERSION_DRIFTED: '對話內容已過期（系統已更新），請開啟新對話以使用最新版本',
  SESSION_EXPIRED: '此對話已超過 24 小時，請開啟新對話',
  SESSION_ENDED: '此對話已結束，請開啟新對話',
};

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Phase 3 + Phase Fortune — exactly one of (readingId, comparisonId,
   *  fortune) must be set. Backend service XOR-validates. Lets the chat
   *  mount on reading pages / compatibility page / fortune page. */
  readingId?: string;
  comparisonId?: string;
  /** Phase Fortune — FORTUNE chat subject (profileId + scope +
   *  anchorDate). When set, sessions are pinned to anchorDate per plan
   *  Issue 10 (date navigation spawns new session). */
  fortune?: {
    profileId: string;
    fortuneScope: 'DAY' | 'MONTH' | 'YEAR';
    fortuneAnchorDate: string; // ISO YYYY-MM-DD
  };
  /** Phase 2 (round-1 MED-#3) — required prop. Threads the reading's type
   *  through to the empty-state sample-questions hook + downstream UI so
   *  each reading type's chat shows its own general questions. The
   *  backend uses session.readingType (set at create time from
   *  BaziReading.readingType / BaziComparison) for prompt routing — this prop
   *  is purely for client-side UX (which questions to show in the empty state). */
  readingType: ChatReadingType;
  /** Optional: section the user clicked the InlineAskCard from. */
  initialSectionContextHint?: string;
  /** Optional: a question to auto-send once the session is ready. Used by
   *  InlineAskCard sample-question clicks. The drawer dedupes via an
   *  internal ref so the same value won't be sent twice.
   *
   *  Phase Fortune NOTE: when `populateOnly=true` is set, the drawer
   *  POPULATES the composer draft (via `appendToDraft` on the composer
   *  ref) INSTEAD of auto-sending. This is the load-bearing FORTUNE
   *  decision per plan Issue 6 — predictable UX + explicit send step
   *  (gesture survival was a false claim anyway since the gesture is
   *  consumed by the async drawer mount + session init). */
  pendingInitialMessage?: string;
  /** Called once the pendingInitialMessage has been consumed (sent OR
   *  populated, depending on `populateOnly`). Parent should clear its
   *  `pendingInitialMessage` state. */
  onPendingInitialMessageConsumed?: () => void;
  /** Phase Fortune (plan Issue 6 lock): when true, `pendingInitialMessage`
   *  POPULATES the composer draft instead of auto-sending. Default false
   *  preserves existing LIFETIME / LOVE / CAREER / ANNUAL / COMPATIBILITY
   *  auto-send behavior. */
  populateOnly?: boolean;
  /** Optional: handler invoked when the user clicks a question in the
   *  drawer's empty-state ChatSampleQuestions (general questions, no
   *  section hint). When omitted, the empty state still renders questions
   *  but they no-op. */
  onPickGeneralQuestion?: (question: string) => void;
}

export default function ChatDrawer({
  isOpen,
  onClose,
  readingId,
  comparisonId,
  fortune,
  readingType,
  initialSectionContextHint,
  pendingInitialMessage,
  onPendingInitialMessageConsumed,
  populateOnly = false,
  onPickGeneralQuestion,
}: ChatDrawerProps) {
  // Phase 2 — empty-state «general» sample questions, fetched from DB.
  // sectionKey=null means the floating-button no-section context.
  // Phase 2.x L3.5b — pass fortuneScope so MONTH chat surfaces MONTH-keyed
  // questions (25 seeded) instead of DAY questions. DAY default for non-FORTUNE.
  const { questions: generalSampleQuestions } = useSampleQuestions(
    readingType,
    null,
    fortune?.fortuneScope,
  );
  // Phase 3 + Phase Fortune — pass exactly one of (readingId, comparisonId,
  // fortune) to useChatSession. The hook XOR-routes the subject.
  const session = useChatSession({ readingId, comparisonId, fortune, enabled: isOpen });
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

  // Dialog state — at most one dialog at a time.
  const [dialogKey, setDialogKey] = useState<ChatDialogKey | null>(null);
  // Track whether we've already shown the turn-20 soft warning for this session
  // so we don't spam it on every send after turn 20.
  const [softWarningShown, setSoftWarningShown] = useState(false);
  // Phase Fortune+ — track whether we've shown the «超出範圍提醒» refuse-cap
  // dialog at the current consecutive-refuse run. Once shown, suppress until
  // the run resets (consecutiveRefuses drops below threshold via an in-topic
  // message) — otherwise spam dialogs on every consecutive refuse beyond N.
  const [refuseLimitDialogShown, setRefuseLimitDialogShown] = useState(false);
  // Whether the history panel is open.
  const [historyOpen, setHistoryOpen] = useState(false);

  // Phase 4 — sample-questions browser overlay state.
  // - browserOpen: panel visibility
  // - browserError: inline banner when pick was blocked (session locked/hard cap)
  // - composerRef: imperative handle for `appendToDraft` + `focusInput`
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const composerRef = useRef<ChatComposerHandle>(null);

  // Auto-clear browser error when overlay closes
  useEffect(() => {
    if (!browserOpen) setBrowserError(null);
  }, [browserOpen]);

  // Reset soft-warning flag whenever we transition to a new session.
  useEffect(() => {
    setSoftWarningShown(false);
    // Phase Fortune+ — refuse-cap dialog state is per-session, reset too.
    setRefuseLimitDialogShown(false);
  }, [session.sessionId]);

  // Phase Fortune+ — reset refuse-cap dialog flag whenever the counter drops
  // below threshold (user asked an in-topic question → backend ran
  // `consecutiveRefuses: { set: 0 }`). This lets the dialog fire AGAIN if
  // the user later goes off-topic for another N consecutive turns. Without
  // this reset, the user would only see the dialog once per session even if
  // they hit the cap multiple times in different runs. (The dialog fire
  // effect itself lives below the `atHardCap` declaration to avoid TDZ.)
  //
  // Deps only `[session.consecutiveRefuses]` is correct — `setRefuseLimit
  // DialogShown` is a stable React setter (not needed in deps), and the
  // threshold constant is module-scope (not needed). Setter call uses the
  // functional form so React short-circuits when value already false (no
  // wasted re-render).
  useEffect(() => {
    if (session.consecutiveRefuses < CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD) {
      setRefuseLimitDialogShown((prev) => (prev === false ? prev : false));
    }
  }, [session.consecutiveRefuses]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Escape closes drawer (unless a dialog or overlay is open — they handle escape).
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dialogKey) return; // dialog component handles its own escape
      // Phase 4 — if the sample-questions browser overlay is open, let
      // ITS Escape handler close just the overlay (not the whole drawer).
      // User pressing Escape inside an overlay expects to return to chat,
      // not exit the drawer entirely.
      if (browserOpen) return;
      if (stream.streaming) return; // don't close mid-stream
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, dialogKey, browserOpen, stream.streaming, onClose]);

  // ============================================================
  // Computed quota state
  // ============================================================

  const remainingPaid = useMemo(() => {
    if (!session.payment) return 0;
    return Math.max(
      0,
      session.payment.paidAllowanceTotal - session.payment.paidUsed,
    );
  }, [session.payment]);

  const messagesUntilHardCap = useMemo(
    () => Math.max(0, CHAT_SESSION_HARD_CAP_MESSAGES - session.messageCount),
    [session.messageCount],
  );

  const atHardCap = session.messageCount >= CHAT_SESSION_HARD_CAP_MESSAGES;

  // ============================================================
  // Send handler with per-message quota check
  // ============================================================

  const handleSend = useCallback(
    (content: string) => {
      if (session.locked) {
        // Composer should already be read-only, but defensive guard.
        return;
      }
      if (atHardCap) {
        setDialogKey('hard_cap_reached');
        return;
      }

      const freeRemaining = session.payment?.freeQuotaRemaining ?? 0;
      const hasFree = freeRemaining > 0;
      const hasPaid = remainingPaid > 0;

      // No free, no paid → must purchase extension first.
      if (!hasFree && !hasPaid) {
        // Edge case at msg 25: only 1-9 messages until cap → near_cap_warning
        // (warns user that 1 credit gives less than 10 messages of value).
        if (
          messagesUntilHardCap > 0 &&
          messagesUntilHardCap < 10 &&
          messagesUntilHardCap >= 1
        ) {
          setDialogKey('near_cap_warning');
        } else {
          setDialogKey('extend_standard');
        }
        // Stash the pending content + section hint so we can replay
        // after extension with the SAME context (L3 — capture at stash
        // time, not at replay time).
        setPendingSend(content);
        setStashedSectionHint(initialSectionContextHint);
        return;
      }

      // Have quota → send.
      void stream.sendMessage(content, initialSectionContextHint);
    },
    [
      session,
      atHardCap,
      remainingPaid,
      messagesUntilHardCap,
      stream,
      initialSectionContextHint,
    ],
  );

  // Pending send to replay after credit-extension flow.
  const [pendingSend, setPendingSend] = useState<string | null>(null);
  // L3 (Phase 3 follow-up) — capture initialSectionContextHint at stash
  // time so the replay uses the section the user was on WHEN they hit
  // the quota wall, not whatever current hint state is at replay time
  // (which can change if a 2nd InlineAskCard click sets it before
  // extend-confirm fires).
  const [stashedSectionHint, setStashedSectionHint] = useState<string | undefined>(undefined);

  // Track the last value of `pendingInitialMessage` we auto-sent so we don't
  // re-fire when the same value remains in parent state across renders.
  // Cleared on close (via the parent's onPendingInitialMessageConsumed
  // callback) — this ref is just a guard for in-flight auto-sends.
  const sentInitialMessageRef = useRef<string | null>(null);

  // Auto-send (or POPULATE if populateOnly=true) the pendingInitialMessage
  // once the session is ready. Fires as soon as: drawer is open, session
  // has an id, not loading, not locked, not currently streaming, and the
  // message hasn't been consumed yet.
  //
  // Phase Fortune branch: when `populateOnly=true`, write to the composer
  // draft via `appendToDraft` imperative API instead of sending. The user
  // gets an editable preview + must explicitly tap send. This is the
  // load-bearing FORTUNE decision per plan Issue 6 — predictable UX,
  // no surprise sends. For populateOnly the «not locked» check is still
  // required (locked composer is read-only); session must be ready so the
  // composer is mounted; streaming-guard is preserved so we don't append
  // mid-stream.
  useEffect(() => {
    if (!isOpen) return;
    if (!pendingInitialMessage) return;
    if (sentInitialMessageRef.current === pendingInitialMessage) return;
    if (!session.sessionId || session.loading || session.locked) return;
    if (stream.streaming) return;
    sentInitialMessageRef.current = pendingInitialMessage;
    if (populateOnly) {
      // Populate-only — pre-fill the composer; user explicitly hits send.
      composerRef.current?.appendToDraft(pendingInitialMessage);
      composerRef.current?.focusInput();
    } else {
      handleSend(pendingInitialMessage);
    }
    onPendingInitialMessageConsumed?.();
  }, [
    isOpen,
    pendingInitialMessage,
    populateOnly,
    session.sessionId,
    session.loading,
    session.locked,
    stream.streaming,
    handleSend,
    onPendingInitialMessageConsumed,
  ]);

  // Reset the auto-send guard whenever the drawer closes so a future open
  // with the same string would re-fire (parent clears state on close, but
  // the ref needs reset too in case parent forgets).
  useEffect(() => {
    if (!isOpen) {
      sentInitialMessageRef.current = null;
    }
  }, [isOpen]);

  // Phase 1.9 audit Bug 1.9-P: also reset the ref when pendingInitialMessage
  // transitions to falsy. Otherwise re-clicking the same InlineAskCard
  // question (after it was successfully sent OR cancelled via dialog) would
  // be silently no-op'd by the dedup ref. The ref's dedup purpose (StrictMode
  // double-fire / same-tick races) is preserved because the reset only
  // happens AFTER the parent's setState propagates a falsy value.
  useEffect(() => {
    if (!pendingInitialMessage) {
      sentInitialMessageRef.current = null;
    }
  }, [pendingInitialMessage]);

  // After a stream completes, fire soft warning at turn 20 (once per session).
  // Skip when session is locked — locked banner already prompts new-session.
  //
  // Polish item 4 — suppress Dialog 2 («turn20_warning_zero_balance») when
  // the session is in the «near hard cap» band (1-9 messages until cap).
  // Otherwise the body would say hardcoded «(再 10 則)» while the user
  // actually only has e.g. 3 left — misleading. The user will hit Dialog
  // 4 («near_cap_warning») as soon as they try to send, which renders
  // the correct dynamic «(剩餘 N 則)» text. The «with_balance» variant
  // doesn't have this issue because its body is dynamic via the
  // `remainingPaid` arg, so it stays accurate.
  useEffect(() => {
    if (
      !stream.streaming &&
      session.messageCount >= CHAT_SOFT_WARNING_TURN &&
      !softWarningShown &&
      !atHardCap &&
      !session.locked
    ) {
      const nearHardCap = messagesUntilHardCap > 0 && messagesUntilHardCap < 10;
      if (remainingPaid > 0) {
        // with-balance variant — body is dynamic, safe to fire any time.
        setDialogKey('turn20_warning_with_balance');
        setSoftWarningShown(true);
      } else if (!nearHardCap) {
        // zero-balance variant — body has hardcoded «(再 10 則)». Only
        // fire when there are >= 10 messages of capacity remaining so the
        // copy stays accurate. In the near-hard-cap band, defer to
        // Dialog 4 (which fires on send and shows accurate «(剩餘 N 則)»).
        setDialogKey('turn20_warning_zero_balance');
        setSoftWarningShown(true);
      }
      // else: near hard cap with no paid balance — silent. Dialog 4 will
      // fire when user next tries to send.
    }
  }, [
    stream.streaming,
    session.messageCount,
    softWarningShown,
    atHardCap,
    remainingPaid,
    session.locked,
    messagesUntilHardCap,
  ]);

  // Phase Fortune+ — fire the «超出範圍提醒» dialog as soon as the consecutive
  // refuse counter hits the warning threshold (matches the refund-cap, see
  // CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT + WARNING_THRESHOLD in @repo/shared).
  // This is the FIRST refuse that is NOT auto-refunded — show the dialog so
  // the user understands why their credit was deducted + that future
  // off-topic Qs will keep deducting.
  //
  // Suppression conditions:
  //  - already shown this run (refuseLimitDialogShown) — wait for reset
  //  - mid-stream (avoid interrupting AI response render)
  //  - session locked / at hard cap — dialog 4/5 takes priority
  //  - another dialog is already open — don't stack
  useEffect(() => {
    if (
      !stream.streaming &&
      session.consecutiveRefuses >= CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD &&
      !refuseLimitDialogShown &&
      !atHardCap &&
      !session.locked &&
      !dialogKey
    ) {
      setDialogKey('refuse_limit_reached');
      setRefuseLimitDialogShown(true);
    }
  }, [
    stream.streaming,
    session.consecutiveRefuses,
    refuseLimitDialogShown,
    atHardCap,
    session.locked,
    dialogKey,
  ]);

  // After hitting hard cap, show the modal. Skip when session is locked
  // (lock banner already covers this state).
  useEffect(() => {
    if (atHardCap && !dialogKey && !session.locked) {
      setDialogKey('hard_cap_reached');
    }
  }, [atHardCap, dialogKey, session.locked]);

  // ============================================================
  // Dialog action dispatch
  // ============================================================

  const handleDialogAction = useCallback(
    async (action: DialogAction, from: ChatDialogKey) => {
      if (action === 'cancel') {
        setDialogKey(null);
        // Phase Fortune+ — the `refuse_limit_reached` dialog is a pure
        // info banner («您最近多個問題都超出本服務範圍...»). It does NOT
        // intercept a queued send (refuse-cap fires post-stream when
        // pendingSend is always null in current flow). Skip the
        // pendingSend/stashedSectionHint cleanup which is only meaningful
        // for quota-wall dialogs (extend_standard, near_cap_warning,
        // turn20_warning_*) that DO queue a user message awaiting credit.
        // Future-proofing: if some path queues a send before showing this
        // dialog, the user's draft survives instead of being silently
        // dropped on confirm.
        if (from !== 'refuse_limit_reached') {
          setPendingSend(null);
          // L3 (Phase 3 follow-up) — clear stashed section hint too so a
          // subsequent re-stash with a different section doesn't see a
          // stale value during the brief overwrite window.
          setStashedSectionHint(undefined);
        }
        return;
      }

      if (action === 'extend') {
        // T6 fix — extra guard at action entry. The hook's ref also
        // blocks re-entry, but checking here prevents the second click
        // from even reaching the hook (which would throw a no-op error
        // we'd then have to filter out).
        if (session.isPurchasingExtension) return;
        try {
          await session.purchaseExtension();
          setDialogKey(null);
          // Replay pending send if any. L3 — use stashedSectionHint
          // captured at stash time, not the current initialSectionContextHint
          // (which may have changed since the user hit the quota wall).
          if (pendingSend) {
            void stream.sendMessage(pendingSend, stashedSectionHint);
            setPendingSend(null);
            setStashedSectionHint(undefined);
          }
        } catch (err) {
          // T6 fix — re-entry race: if the hook's ref-guard rejected the
          // call (because a prior click is still in flight), don't pop an
          // alert — the prior click will resolve normally and dismiss.
          if ((err as Error).message === 'Purchase already in progress') {
            return;
          }
          // Surface the error to the user; close dialog.
          setDialogKey(null);
          setPendingSend(null);
          setStashedSectionHint(undefined);  // L3 cleanup
          alert(`購買延伸失敗：${(err as Error).message}`);
        }
        return;
      }

      if (action === 'continue_paid') {
        // Bug fix: don't charge a credit if the user's remaining free quota
        // can cover the rest of the session capacity. The dialog (Turn-20
        // soft warning) intends to deduct 1 credit only when the user
        // actually needs paid messages — but if their free quota still
        // covers the remaining 10 messages until hard cap, no extension
        // purchase is required. Treat as a free continue (just dismiss).
        const freeRemaining = session.payment?.freeQuotaRemaining ?? 0;
        if (freeRemaining >= messagesUntilHardCap) {
          setDialogKey(null);
          return;
        }
        // T6 fix — same re-entry guard as the 'extend' branch above.
        if (session.isPurchasingExtension) return;
        try {
          await session.purchaseExtension();
          setDialogKey(null);
        } catch (err) {
          if ((err as Error).message === 'Purchase already in progress') {
            return;
          }
          setDialogKey(null);
          alert(`購買延伸失敗：${(err as Error).message}`);
        }
        return;
      }

      if (action === 'continue_free') {
        // User chose to continue using their already-purchased paid balance —
        // no new charge. Just dismiss.
        setDialogKey(null);
        return;
      }

      if (action === 'new_session') {
        // If they have unused paid messages AND came from a non-warning path,
        // confirm first.
        if (remainingPaid > 0 && from !== 'new_session_lose_paid') {
          setDialogKey('new_session_lose_paid');
          return;
        }
        await session.startNewSession();
        setDialogKey(null);
        setPendingSend(null);
        setStashedSectionHint(undefined);  // L3 cleanup
        return;
      }

      if (action === 'force_new_session') {
        await session.startNewSession();
        setDialogKey(null);
        setPendingSend(null);
        setStashedSectionHint(undefined);  // L3 cleanup
        return;
      }
    },
    [session, pendingSend, stashedSectionHint, stream, remainingPaid, messagesUntilHardCap],
  );

  // ============================================================
  // Stream-error → dialog routing
  // ============================================================

  useEffect(() => {
    if (!stream.error) return;
    if (stream.error.code === 'NEEDS_EXTENSION') {
      setDialogKey('extend_standard');
      stream.clearError();
    } else if (stream.error.code === 'HARD_CAP_REACHED') {
      setDialogKey('hard_cap_reached');
      stream.clearError();
    } else if (LOCK_ERROR_CODES[stream.error.code]) {
      // Non-recoverable session-level errors. Lock the session and prompt
      // the user to start a new one. The error stays visible (don't
      // auto-clear) until the user picks new-session.
      session.lockSession(LOCK_ERROR_CODES[stream.error.code]!);
      stream.clearError();
    }
  }, [stream.error, stream, session]);

  // ============================================================
  // Render
  // ============================================================

  if (typeof document === 'undefined') return null;
  if (!isOpen) return null;

  const sheet = (
    <>
      <div className={styles.backdrop} onClick={stream.streaming ? undefined : onClose} />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        // Polish item 1 — prefer aria-labelledby over aria-label when there's
        // a visible heading. Keeps the announced name in sync with the
        // visible text if the title ever changes.
        aria-labelledby="chat-drawer-title"
      >
        <div className={styles.dragHandle} />

        <header className={styles.header}>
          <div className={styles.headerTitleRow}>
            <span id="chat-drawer-title" className={styles.headerTitle}>AI 命理師對話</span>
            <div className={styles.headerActions}>
              {/* Phase 4 — sample-questions browser button. Opens a full
                  overlay inside the drawer listing all questions for this
                  reading type. Mutex with 歷史 — opening one closes the other. */}
              <button
                type="button"
                className={styles.browserBtn}
                onClick={() => {
                  setHistoryOpen(false);  // mutex — close history if open
                  setBrowserOpen(true);
                }}
                aria-label="想問什麼？"
                aria-expanded={browserOpen}
                disabled={stream.streaming}
                title="範例問題"
              >
                <span aria-hidden>💡</span>
                <span className={styles.browserBtnLabel}>想問什麼？</span>
              </button>
              <button
                className={styles.historyBtn}
                onClick={() => {
                  setBrowserOpen(false);  // reciprocal mutex
                  setHistoryOpen((v) => !v);
                }}
                aria-label={historyOpen ? '關閉過往對話' : '開啟過往對話'}
                aria-expanded={historyOpen}
                disabled={stream.streaming}
                title="過往對話"
              >
                {/* Inline icon — list bars */}
                <span aria-hidden>☰</span>
                <span className={styles.historyBtnLabel}>歷史</span>
              </button>
              <button
                className={styles.closeBtn}
                onClick={onClose}
                aria-label="關閉"
                disabled={stream.streaming}
              >
                ✕
              </button>
            </div>
          </div>
          {session.payment && (
            <QuotaBadge
              chatsUsed={Math.max(
                0,
                session.payment.monthlyQuota - session.payment.freeQuotaRemaining,
              )}
              monthlyQuota={session.payment.monthlyQuota}
              paidRemaining={remainingPaid}
            />
          )}
          {session.tierUpgradeRefund && (
            <div className={styles.tierRefundBanner} role="status">
              <div className={styles.tierRefundCopy}>
                <strong>已退還 {session.tierUpgradeRefund.creditsRefunded} 點數</strong>
                <span>
                  您升級前購買的付費對話尚未使用完，
                  我們已將
                  <strong> {session.tierUpgradeRefund.creditsRefunded} 點數 </strong>
                  退還至您的點數錢包，可用於其他閱讀或聊天。
                </span>
              </div>
              <button
                type="button"
                className={styles.tierRefundDismiss}
                onClick={session.dismissTierUpgradeRefund}
                aria-label="關閉退費通知"
              >
                ✕
              </button>
            </div>
          )}
          <div className={styles.headerMeta}>
            <span className={styles.messageCounter}>
              {session.messageCount} / {CHAT_SESSION_HARD_CAP_MESSAGES} 則
            </span>
          </div>
        </header>

        {/* Phase 4 — bodyWrap establishes positioning context so the
            SampleQuestionsBrowser overlay anchors to the body area only
            (NOT covering the drawer header above). Flex: 1 lets it grow
            to fill remaining vertical space; min-height: 0 lets ChatThread
            scroll within it. */}
        <div className={styles.bodyWrap}>

        <ChatHistoryPanel
          isOpen={historyOpen}
          sessions={session.sessionList}
          loading={session.sessionListLoading}
          activeSessionId={session.sessionId}
          hardCap={CHAT_SESSION_HARD_CAP_MESSAGES}
          onPickSession={async (sid) => {
            if (sid === session.sessionId) {
              setHistoryOpen(false);
              return;
            }
            await session.switchActiveSession(sid);
            setHistoryOpen(false);
          }}
          onClose={() => setHistoryOpen(false)}
        />

        {/* Phase 4 — SampleQuestionsBrowser overlay. Renders inside the
            bodyWrap, covering chat thread + composer area (drawer header
            stays visible above). onPick checks session.locked / atHardCap
            and either shows an inline error banner (overlay stays open)
            or appends the question to the composer's draft + closes. */}
        <SampleQuestionsBrowser
          isOpen={browserOpen}
          readingType={readingType}
          // Phase 2.x L3.5b — thread scope so MONTH chat surfaces MONTH-keyed
          // questions in the browser overlay (mirror of useSampleQuestions
          // call at line 119).
          fortuneScope={fortune?.fortuneScope}
          onClose={() => setBrowserOpen(false)}
          errorMessage={browserError}
          onPick={(questionText) => {
            // [H2] guard — composer's textarea is unmounted when readOnly.
            // Drawer knows session state authoritatively (composer doesn't).
            if (session.locked || atHardCap) {
              setBrowserError('此對話已不可繼續，請開啟新對話以使用範例問題');
              return;  // keep overlay open so user sees the error
            }
            setBrowserError(null);
            composerRef.current?.appendToDraft(questionText);
            setBrowserOpen(false);  // auto-close — overlay would hide input otherwise
          }}
        />

        {session.locked && session.lockReason && (
          <div className={styles.lockBanner}>
            <span className={styles.lockIcon} aria-hidden>🔒</span>
            <span className={styles.lockText}>{session.lockReason}</span>
            <button
              className={styles.lockNewSessionBtn}
              onClick={async () => {
                if (session.loading) return;
                await session.startNewSession();
              }}
              disabled={session.loading}
            >
              {session.loading ? '建立中...' : '開啟新對話'}
            </button>
          </div>
        )}

        {session.error && (
          <div className={styles.errorBanner}>{session.error}</div>
        )}
        {stream.error && stream.error.code !== 'NEEDS_EXTENSION' && stream.error.code !== 'HARD_CAP_REACHED' && (
          <div className={styles.errorBanner}>
            {stream.error.message}
            {stream.error.refunded && '（已退還點數）'}
            <button className={styles.errorDismiss} onClick={stream.clearError}>知道了</button>
          </div>
        )}

        <ChatThread
          messages={session.messages}
          loading={session.loading}
          hasMoreHistory={session.hasMoreHistory}
          loadMoreLoading={session.loadMoreLoading}
          onLoadMore={session.loadMoreHistory}
          streaming={stream.streaming}
          emptyState={
            <div className={styles.emptyState}>
              <p className={styles.emptyHeadline}>有任何疑問都可以問我</p>
              <p className={styles.emptyHint}>
                點選下方建議，或直接輸入您的問題：
              </p>
              <div className={styles.emptyQuestions}>
                {generalSampleQuestions.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className={styles.emptyQuestionBtn}
                    onClick={() => {
                      if (onPickGeneralQuestion) {
                        onPickGeneralQuestion(q.questionText);
                      } else {
                        // Fallback when parent doesn't wire the handler:
                        // send directly via handleSend (no sectionContextHint).
                        handleSend(q.questionText);
                      }
                    }}
                    disabled={
                      stream.streaming ||
                      !session.sessionId ||
                      session.loading ||
                      session.locked
                    }
                  >
                    {q.questionText}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        <ChatComposer
          ref={composerRef}
          onSend={handleSend}
          disabled={
            stream.streaming ||
            !session.sessionId ||
            session.loading ||
            session.locked
          }
          readOnlyReason={
            session.locked
              ? '此對話已不可繼續，請開啟新對話'
              : atHardCap
                ? `已達 ${CHAT_SESSION_HARD_CAP_MESSAGES} 則上限，請開啟新對話`
                : undefined
          }
        />

        </div>  {/* /bodyWrap */}
      </div>

      <ChatDialogs
        dialogKey={dialogKey}
        context={{
          remainingPaid,
          messagesUntilHardCap,
          freeQuotaRemaining: session.payment?.freeQuotaRemaining ?? 0,
        }}
        // T6 fix — disables Dialog 1's «支付 1 點數繼續» (and any other
        // extension-purchase action button) while a request is in flight.
        // Backend has its own Redis SETNX defense; this prevents the
        // user-visible race where a second click would otherwise pop an
        // EXTEND_IN_PROGRESS error toast.
        isPurchasingExtension={session.isPurchasingExtension}
        onAction={handleDialogAction}
      />
    </>
  );

  return createPortal(sheet, document.body);
}
