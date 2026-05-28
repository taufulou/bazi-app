/**
 * useChatSession — owns the session lifecycle and message history.
 *
 * Responsibilities:
 * - Lazily create a session on first open (or pick up the most recent open
 *   session for the reading).
 * - Load message history with "Load 5 more" pagination.
 * - Append optimistic USER + streaming ASSISTANT messages from useChatStream.
 * - Track local copies of messageCount, paid allowance, free quota.
 *
 * Streaming itself is delegated to `useChatStream`. This hook holds the state
 * the streaming hook needs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type {
  ChatMessage,
  ChatSession,
  ChatUsageResponse,
} from '../../../lib/chat-types';
import {
  createChatSession,
  listSessionsForReading,
  getMessages,
  extendSession,
  getUsage,
  listSessionsForComparison,
  listSessionsForFortune,
  type CreateChatSessionResponse,
  ChatApiError,
} from '../../../lib/chat-api';

interface UseChatSessionArgs {
  /** Phase 3 + Phase Fortune — exactly one of (readingId, comparisonId,
   *  fortune) must be set. Backend XOR-validates at chat.service.ts. */
  readingId?: string;
  comparisonId?: string;
  /** Phase Fortune — FORTUNE chat subject. When set, sessions resume
   *  ONLY if their fortuneAnchorDate matches `fortune.fortuneAnchorDate`
   *  (plan Issue 10 — date navigation spawns new sessions). */
  fortune?: {
    profileId: string;
    fortuneScope: 'DAY' | 'MONTH' | 'YEAR';
    fortuneAnchorDate: string; // ISO YYYY-MM-DD
  };
  /** When false, hooks no-op so we don't fire requests for closed drawer. */
  enabled: boolean;
}

interface PaymentState {
  freeQuotaRemaining: number;
  monthlyQuota: number;
  /** Total paid messages purchased in this session (creditExtensions × 10). */
  paidAllowanceTotal: number;
  /** Paid messages already consumed in this session. */
  paidUsed: number;
}

export interface UseChatSessionReturn {
  sessionId: string | null;
  messages: ChatMessage[];
  payment: PaymentState | null;
  messageCount: number;
  hardCap: number;
  loading: boolean;
  loadMoreLoading: boolean;
  hasMoreHistory: boolean;
  error: string | null;
  /** All chat sessions for this reading (used by ChatHistoryPanel). */
  sessionList: ChatSession[];
  sessionListLoading: boolean;

  /** Initialize a session — picks up open session or creates new one. */
  initSession: () => Promise<void>;

  /** Force-create a brand new session (the user explicitly chose 「新對話」). */
  startNewSession: () => Promise<void>;

  /** Switch the active session to the given id. Used when user picks an
   *  open past session from the history panel. */
  switchActiveSession: (sessionId: string) => Promise<void>;

  /** Refresh the session list (e.g., after creating a new session). */
  refreshSessionList: () => Promise<void>;

  /** Mark the current session as locked due to a non-recoverable backend
   *  error (CONTEXT_VERSION_DRIFTED, SESSION_EXPIRED, SESSION_ENDED). The
   *  ChatComposer goes read-only and the user is prompted to start a new
   *  session. */
  lockSession: (reason: string) => void;
  /** True when lockSession has been called for the current session. */
  locked: boolean;
  /** User-facing reason text when locked. */
  lockReason: string | null;

  /** Surfaces a recent (within 24h) tier-upgrade refund. The chat drawer
   *  shows a one-time banner so the user understands their stranded paid
   *  messages were converted to credits. `null` if no recent refund or
   *  if the user has already dismissed this specific refund. */
  tierUpgradeRefund: { creditsRefunded: number; refundedAt: string } | null;
  /** Dismiss the tier-upgrade refund banner. Persists to localStorage so
   *  the dismissal survives page reloads. */
  dismissTierUpgradeRefund: () => void;

  /** Load N more messages (newest-first cursor pagination). */
  loadMoreHistory: () => Promise<void>;

  /** Buy a 10-message paid allowance for the current session. */
  purchaseExtension: () => Promise<{ paidMessagesAllowance: number }>;
  /** True while a purchaseExtension() call is in flight (T6 fix). UI must
   *  use this to disable the «支付 1 點數繼續» button so rapid double-clicks
   *  don't enqueue a second request. Backend has its own Redis SETNX
   *  defense, but disabling at the source eliminates the user-visible race
   *  (concurrent click → second call gets EXTEND_IN_PROGRESS error toast). */
  isPurchasingExtension: boolean;

  /** Append an optimistic USER message before streaming begins. */
  appendUserMessage: (content: string) => string; // returns local id

  /** Swap the local id of the most recent optimistic USER message with the
   *  server's persisted id. Called on `session_start` (which carries the
   *  persisted USER message id, not the assistant id). Keeps pagination
   *  cursor consistent. */
  replaceUserMessageId: (localId: string, serverId: string) => void;

  /** Append the streaming ASSISTANT placeholder. */
  appendAssistantPlaceholder: () => void;

  /** Update the streaming ASSISTANT message text on each delta. */
  appendAssistantDelta: (text: string) => void;

  /** Replace the streaming ASSISTANT message with the final persisted ID/text. */
  finalizeAssistantMessage: (args: {
    messageId: string;
    finalText?: string;
  }) => void;

  /** Mark the streaming USER message as failed (e.g., refunded). */
  markUserFailed: (errorCode: string) => void;

  /** After a 'done' event, re-sync messageCount + payment from server values. */
  applyDoneEvent: (args: {
    messageCount: number;
    messagesRemaining: number;
    /** Phase Fortune+ — post-message consecutive refuse counter. Surfaced
     *  to ChatDrawer for the «超出範圍提醒» dialog at the warning threshold. */
    consecutiveRefuses: number;
  }) => void;

  /** Phase Fortune+ — current consecutive refuse counter for the active
   *  session. ChatDrawer watches this to fire the «超出範圍提醒» dialog
   *  when it crosses CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD. */
  consecutiveRefuses: number;
}

const HARD_CAP = 30;

export function useChatSession(args: UseChatSessionArgs): UseChatSessionReturn {
  const { readingId, comparisonId, fortune, enabled } = args;
  const { getToken } = useAuth();
  // Phase 3 + Phase Fortune — DRY helpers for «list sessions for current
  // subject» and «create session for current subject». Backend branches on
  // subject type automatically (one of readingId / comparisonId / fortune
  // must be set per XOR DTO validation).
  const listSessionsForCurrentSubject = fortune
    ? ({ token }: { token: string }) =>
        listSessionsForFortune({
          profileId: fortune.profileId,
          fortuneAnchorDate: fortune.fortuneAnchorDate,
          token,
        })
    : comparisonId
      ? ({ token }: { token: string }) =>
          listSessionsForComparison({ comparisonId, token })
      : readingId
        ? ({ token }: { token: string }) =>
            listSessionsForReading({ readingId, token })
        : ({ token: _t }: { token: string }) => Promise.resolve([]);
  const createSessionForCurrentSubject = ({ token }: { token: string }) =>
    createChatSession({ readingId, comparisonId, fortune, token });

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [payment, setPayment] = useState<PaymentState | null>(null);
  // Tier-upgrade refund banner state (Option A1). Populated from
  // /usage's `recentTierUpgradeRefund` field. Cleared by user dismiss
  // (also persisted to localStorage so dismissal survives page reloads).
  const [tierUpgradeRefund, setTierUpgradeRefund] = useState<{
    creditsRefunded: number;
    refundedAt: string;
  } | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  // Phase Fortune+ — consecutive topic-boundary refuse counter mirrored from
  // server. Hydrated from the active session row on init/resume and updated
  // on every SSE 'done' event. ChatDrawer fires the «超出範圍提醒» dialog
  // when this crosses CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD.
  const [consecutiveRefuses, setConsecutiveRefuses] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<ChatSession[]>([]);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockReason, setLockReason] = useState<string | null>(null);
  // T6 fix — concurrent extension purchase double-charge defense:
  //
  // We use BOTH a useRef (synchronous guard against re-entry within a
  // single task tick) AND a useState (so the dialog button can render
  // disabled). The ref is the source of truth for the guard; the state
  // is downstream of it. This handles the rapid-double-click case where
  // two clicks fire before React has a chance to re-render the button
  // as `disabled={true}`.
  const isPurchasingExtensionRef = useRef(false);
  const [isPurchasingExtension, setIsPurchasingExtension] = useState(false);

  // Track the local id of the assistant message being streamed so we can
  // mutate it on each delta without searching the array.
  const streamingAssistantIdRef = useRef<string | null>(null);
  // Keep an absolute count of total persisted messages on the server so the
  // pagination cursor stays correct after appending new live messages.
  const totalCountRef = useRef(0);

  const requireToken = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error('Not signed in');
    return token;
  }, [getToken]);

  const refreshHistoryFromServer = useCallback(
    async (sid: string) => {
      const token = await requireToken();
      const initial = await getMessages({
        sessionId: sid,
        cursor: 0,
        limit: 5,
        token,
      });
      // API returns newest-first; UI displays oldest-first, so reverse.
      setMessages([...initial.messages].reverse());
      totalCountRef.current = initial.totalCount;
      setHasMoreHistory(initial.nextCursor !== null);
    },
    [requireToken],
  );

  const hydrateFromCreate = useCallback((res: CreateChatSessionResponse) => {
    setSessionId(res.sessionId);
    setPayment({
      freeQuotaRemaining: res.freeQuotaRemaining,
      monthlyQuota: res.monthlyQuota,
      paidAllowanceTotal: res.currentSessionAllowance,
      paidUsed: 0,
    });
    setMessageCount(0);
    // Brand new session — refuse counter starts at 0 by DB default.
    setConsecutiveRefuses(0);
    setMessages([]);
    setHasMoreHistory(false);
    setLocked(false);
    setLockReason(null);
    totalCountRef.current = 0;
  }, []);

  const refreshSessionList = useCallback(async () => {
    setSessionListLoading(true);
    try {
      const token = await requireToken();
      const list = await listSessionsForCurrentSubject({ token });
      // Newest first by startedAt — server already sorts but be defensive.
      list.sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
      setSessionList(list);
    } catch {
      // Non-fatal — leave list as-is.
    } finally {
      setSessionListLoading(false);
    }
    // Phase Fortune — fortune.profileId + fortuneAnchorDate must be in deps
    // so date navigation forces re-fetch (plan Issue 10).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingId, comparisonId, fortune?.profileId, fortune?.fortuneAnchorDate, requireToken]);

  const resumeOpenSession = useCallback(
    async (
      open: ChatSession,
      token: string,
    ) => {
      setSessionId(open.id);
      setMessageCount(open.messageCount);
      // Phase Fortune+ — hydrate refuse counter from server. Sessions resumed
      // mid-conversation may already be at/near the warning threshold.
      setConsecutiveRefuses(open.consecutiveRefuses ?? 0);
      setLocked(false);
      setLockReason(null);
      await refreshHistoryFromServer(open.id);
      // Payment state for resumed sessions comes from monthly usage +
      // session unusedPaidMessages. /usage gives accurate quota; the
      // session row gives accurate paid balance.
      try {
        const usage = await getUsage({ token });
        setPayment({
          freeQuotaRemaining: Math.max(
            0,
            usage.thisMonth.monthlyQuota - usage.thisMonth.chatsUsed,
          ),
          monthlyQuota: usage.thisMonth.monthlyQuota,
          paidAllowanceTotal: open.unusedPaidMessages,
          paidUsed: 0,
        });
        // Capture tier-upgrade refund banner from usage response.
        applyTierUpgradeRefundFromUsage(usage.recentTierUpgradeRefund);
      } catch {
        setPayment({
          freeQuotaRemaining: 0,
          monthlyQuota: 0,
          paidAllowanceTotal: open.unusedPaidMessages,
          paidUsed: 0,
        });
      }
    },
    [refreshHistoryFromServer],
  );

  /**
   * Apply a recent tier-upgrade refund banner from /usage. Skips if the
   * user already dismissed this specific refund (keyed by refundedAt
   * timestamp in localStorage).
   */
  const applyTierUpgradeRefundFromUsage = useCallback(
    (refund: ChatUsageResponse['recentTierUpgradeRefund']) => {
      if (!refund) {
        setTierUpgradeRefund(null);
        return;
      }
      try {
        const dismissedKey = `chat-tier-refund-dismissed-${refund.refundedAt}`;
        if (typeof window !== 'undefined' &&
            window.localStorage.getItem(dismissedKey) === '1') {
          setTierUpgradeRefund(null);
          return;
        }
      } catch {
        // localStorage unavailable — show banner anyway, user can dismiss.
      }
      setTierUpgradeRefund(refund);
    },
    [],
  );

  const dismissTierUpgradeRefund = useCallback(() => {
    if (!tierUpgradeRefund) return;
    try {
      const key = `chat-tier-refund-dismissed-${tierUpgradeRefund.refundedAt}`;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, '1');
      }
    } catch {
      // ignore storage failure; in-memory dismissal still works.
    }
    setTierUpgradeRefund(null);
  }, [tierUpgradeRefund]);

  const initSession = useCallback(async () => {
    setLoading(true);
    setSessionListLoading(true);
    setError(null);
    try {
      const token = await requireToken();

      // Try to resume the most recent open session for this reading.
      const sessions = await listSessionsForCurrentSubject({ token });
      sessions.sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
      setSessionList(sessions);
      setSessionListLoading(false);
      const openSession = sessions.find(
        (s) => s.endedAt === null && s.messageCount < HARD_CAP,
      );

      if (openSession) {
        await resumeOpenSession(openSession, token);
      } else {
        const created = await createSessionForCurrentSubject({ token });
        hydrateFromCreate(created);
        // Refresh list so the new session row appears.
        void refreshSessionList();
        // Tier-upgrade refund banner: createChatSession doesn't return the
        // refund field, so fetch /usage separately for fresh-session opens
        // (resumeOpenSession already does this). Best-effort; don't fail
        // the session-init path if /usage hiccups.
        try {
          const usage = await getUsage({ token });
          applyTierUpgradeRefundFromUsage(usage.recentTierUpgradeRefund);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      setError(
        err instanceof ChatApiError
          ? err.message
          : (err as Error).message || '無法載入對話',
      );
    } finally {
      setLoading(false);
      // Defensive — covers the path where listSessionsForReading throws
      // before the success-path setSessionListLoading(false) is reached.
      setSessionListLoading(false);
    }
  }, [
    readingId,
    // M3 (Phase 3 follow-up) — comparisonId added so back-navigation
    // between compat readings re-memoizes initSession with the new
    // subject. Sibling callbacks (startNewSession L400 +
    // switchActiveSession L447) already had it; initSession was the
    // odd one out.
    comparisonId,
    // Phase Fortune — fortune.profileId + fortuneAnchorDate must be in deps
    // so DateNavigator changes spawn a NEW session (plan Issue 10).
    fortune?.profileId,
    fortune?.fortuneAnchorDate,
    requireToken,
    resumeOpenSession,
    hydrateFromCreate,
    refreshSessionList,
  ]);

  const startNewSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireToken();
      const created = await createSessionForCurrentSubject({ token });
      hydrateFromCreate(created);
      void refreshSessionList();
    } catch (err) {
      setError(
        err instanceof ChatApiError
          ? err.message
          : (err as Error).message || '無法開啟新對話',
      );
    } finally {
      setLoading(false);
    }
  }, [
    readingId,
    comparisonId,
    fortune?.profileId,
    fortune?.fortuneAnchorDate,
    requireToken,
    hydrateFromCreate,
    refreshSessionList,
  ]);

  const switchActiveSession = useCallback(
    async (targetSessionId: string) => {
      setLoading(true);
      setError(null);
      try {
        const token = await requireToken();
        const list = await listSessionsForCurrentSubject({ token });
        const target = list.find((s) => s.id === targetSessionId);
        if (!target) {
          throw new Error('找不到對話');
        }
        setSessionList(
          list.sort(
            (a, b) =>
              new Date(b.startedAt).getTime() -
              new Date(a.startedAt).getTime(),
          ),
        );
        if (target.endedAt !== null || target.messageCount >= HARD_CAP) {
          // Closed/full session — switching to it shows it but locks composer.
          // CRITICAL: set locked BEFORE the await so React batches it with
          // sessionId/messageCount in the same commit. Otherwise the
          // hard-cap effect (which checks `!session.locked`) would fire its
          // dialog in the gap between batches and hijack the view-mode
          // intent. (Phase 1.8 audit Bug A1)
          setSessionId(target.id);
          setMessageCount(target.messageCount);
          // Phase Fortune+ — also hydrate refuse counter for closed sessions
          // (mostly cosmetic — composer is locked anyway, but keeps state
          // consistent if user re-opens an active session next).
          setConsecutiveRefuses(target.consecutiveRefuses ?? 0);
          setLocked(true);
          setLockReason(
            target.messageCount >= HARD_CAP
              ? '此對話已達 30 則上限，請開啟新對話'
              : '此對話已結束',
          );
          // Keep payment state (we still want to show monthly quota in
          // header). Don't refetch.
          await refreshHistoryFromServer(target.id);
        } else {
          await resumeOpenSession(target, token);
        }
      } catch (err) {
        setError((err as Error).message || '切換對話失敗');
      } finally {
        setLoading(false);
      }
    },
    [
      readingId,
      comparisonId,
      fortune?.profileId,
      fortune?.fortuneAnchorDate,
      requireToken,
      refreshHistoryFromServer,
      resumeOpenSession,
    ],
  );

  const lockSession = useCallback((reason: string) => {
    setLocked(true);
    setLockReason(reason);
  }, []);

  const loadMoreHistory = useCallback(async () => {
    if (!sessionId || loadMoreLoading || !hasMoreHistory) return;
    setLoadMoreLoading(true);
    try {
      const token = await requireToken();
      // Use the count of ALREADY-LOADED HISTORY messages as cursor (skip
      // optimistic streaming messages we appended locally).
      const persistedHistoryCount = messages.filter(
        (m) => !m.id.startsWith('local-'),
      ).length;
      const more = await getMessages({
        sessionId,
        cursor: persistedHistoryCount,
        limit: 5,
        token,
      });
      setMessages((prev) => [...[...more.messages].reverse(), ...prev]);
      setHasMoreHistory(more.nextCursor !== null);
    } catch (err) {
      setError((err as Error).message || '載入更多失敗');
    } finally {
      setLoadMoreLoading(false);
    }
  }, [sessionId, loadMoreLoading, hasMoreHistory, requireToken, messages]);

  const purchaseExtension = useCallback(async () => {
    if (!sessionId) throw new Error('No active session');
    // T6 fix — in-flight guard. The ref check is synchronous and runs
    // within a single React event tick, blocking the second of two rapid
    // double-clicks before it issues a second fetch. The setState call
    // immediately after lets the button render disabled (defense in
    // depth — backend Redis SETNX is the authoritative deduplication).
    if (isPurchasingExtensionRef.current) {
      throw new Error('Purchase already in progress');
    }
    isPurchasingExtensionRef.current = true;
    setIsPurchasingExtension(true);
    try {
      // CRITICAL: requireToken() must be inside the try so that if it
      // throws (e.g., Clerk session expired between dialog open and
      // click), the finally still resets the ref + state. Without this,
      // a single auth-token failure would leave the in-flight guard
      // stuck `true` for the rest of the session — the user could never
      // purchase another extension until reload.
      const token = await requireToken();
      const res = await extendSession({ sessionId, token });
      setPayment((prev) =>
        prev
          ? {
              ...prev,
              paidAllowanceTotal: res.paidMessagesAllowance + prev.paidUsed,
            }
          : prev,
      );
      return { paidMessagesAllowance: res.paidMessagesAllowance };
    } catch (err) {
      // Server may reject extension on a drifted/ended session — lock the
      // session UI so the user is prompted to start a new one instead of
      // re-trying the same purchase.
      if (err instanceof ChatApiError && err.code === 'CONTEXT_VERSION_DRIFTED') {
        setLocked(true);
        setLockReason('對話內容已過期（系統已更新），請開啟新對話以使用最新版本');
      }
      throw err;
    } finally {
      isPurchasingExtensionRef.current = false;
      setIsPurchasingExtension(false);
    }
  }, [sessionId, requireToken]);

  const appendUserMessage = useCallback((content: string) => {
    const localId = `local-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: localId,
        role: 'USER',
        content,
        isRegrounding: false,
        errorCode: null,
        refundedAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    return localId;
  }, []);

  const replaceUserMessageId = useCallback(
    (localId: string, serverId: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, id: serverId } : m)),
      );
    },
    [],
  );

  const appendAssistantPlaceholder = useCallback(() => {
    const localId = `local-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    streamingAssistantIdRef.current = localId;
    setMessages((prev) => [
      ...prev,
      {
        id: localId,
        role: 'ASSISTANT',
        content: '',
        isRegrounding: false,
        errorCode: null,
        refundedAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const appendAssistantDelta = useCallback((text: string) => {
    const localId = streamingAssistantIdRef.current;
    if (!localId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === localId ? { ...m, content: m.content + text } : m,
      ),
    );
  }, []);

  const finalizeAssistantMessage = useCallback(
    (finalArgs: { messageId: string; finalText?: string }) => {
      const localId = streamingAssistantIdRef.current;
      if (!localId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === localId
            ? {
                ...m,
                id: finalArgs.messageId,
                content: finalArgs.finalText ?? m.content,
              }
            : m,
        ),
      );
      streamingAssistantIdRef.current = null;
    },
    [],
  );

  const markUserFailed = useCallback((errorCode: string) => {
    setMessages((prev) => {
      const next = [...prev];
      // Find the most recent USER message that's still optimistic.
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i]!;
        if (m.role === 'USER' && m.id.startsWith('local-')) {
          next[i] = { ...m, errorCode };
          break;
        }
      }
      return next;
    });
    // Drop any streaming assistant placeholder that never received deltas.
    const localId = streamingAssistantIdRef.current;
    if (localId) {
      setMessages((prev) =>
        prev.filter((m) => !(m.id === localId && m.content === '')),
      );
      streamingAssistantIdRef.current = null;
    }
  }, []);

  const applyDoneEvent = useCallback(
    (done: {
      messageCount: number;
      messagesRemaining: number;
      consecutiveRefuses: number;
    }) => {
      setMessageCount(done.messageCount);
      // Phase Fortune+ — surface the post-message refuse counter so the
      // ChatDrawer can fire the «超出範圍提醒» dialog at the threshold.
      setConsecutiveRefuses(done.consecutiveRefuses);
      setPayment((prev) => {
        if (!prev) return prev;
        // The server's truth: messagesRemaining = freeRemaining + paidRemaining.
        // We can't split it here without re-fetching usage, but we know paid
        // can never exceed paidAllowanceTotal - paidUsed. Optimistically debit
        // free first, then paid.
        const beforeRemaining =
          prev.freeQuotaRemaining +
          (prev.paidAllowanceTotal - prev.paidUsed);
        const consumed = Math.max(0, beforeRemaining - done.messagesRemaining);
        let freeDebit = Math.min(prev.freeQuotaRemaining, consumed);
        let paidDebit = consumed - freeDebit;
        // Clamp paidDebit to the actual paid pool.
        const paidPool = prev.paidAllowanceTotal - prev.paidUsed;
        if (paidDebit > paidPool) {
          paidDebit = paidPool;
          freeDebit = consumed - paidDebit;
        }
        return {
          ...prev,
          freeQuotaRemaining: prev.freeQuotaRemaining - freeDebit,
          paidUsed: prev.paidUsed + paidDebit,
        };
      });
      // Phase 1.5 follow-up — keep history panel in sync. Without this, the
      // panel shows the messageCount that was cached at panel-open time
      // (e.g. "0/30 則" for an active session that has actually exchanged
      // 5+ messages). Update the local sessionList entry for the current
      // session so the panel re-render reflects the new count immediately.
      setSessionList((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messageCount: done.messageCount }
            : s,
        ),
      );
    },
    [sessionId],
  );

  // Auto-init when enabled flips to true and we don't have a session yet.
  useEffect(() => {
    if (enabled && !sessionId && !loading) {
      void initSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Phase Fortune — Issue 10 open-drawer regression fix:
  // When DateNavigator changes `fortuneAnchorDate` WHILE the drawer is
  // already open with an established session, the auto-init effect above
  // (deps: [enabled]) does NOT re-fire because `enabled` hasn't changed.
  // Without this effect, the drawer would stay pinned to yesterday's
  // anchor — chat-context loaded against the OLD anchorDate, message
  // routing through the OLD session. Doctrinal drift + 30-msg cap
  // wouldn't naturally reset.
  //
  // Fix: when the anchorDate / profileId prop changes AND we already have
  // a session, drop the current session id so the auto-init effect picks
  // up the new anchor on the next render. This mirrors the closed-drawer
  // path semantics (close → reopen → resume-or-create against the new
  // anchor) for the always-open path.
  //
  // Locked by the regression spec — without this fix, the open-drawer
  // path silently uses stale chat-context.
  const prevFortuneAnchorRef = useRef<string | undefined>(fortune?.fortuneAnchorDate);
  const prevFortuneProfileRef = useRef<string | undefined>(fortune?.profileId);
  useEffect(() => {
    if (!enabled) return;
    if (!fortune) return;
    const anchorChanged =
      prevFortuneAnchorRef.current !== undefined &&
      prevFortuneAnchorRef.current !== fortune.fortuneAnchorDate;
    const profileChanged =
      prevFortuneProfileRef.current !== undefined &&
      prevFortuneProfileRef.current !== fortune.profileId;
    if (anchorChanged || profileChanged) {
      // Reset session so the [enabled]-keyed auto-init re-runs with the
      // new anchor on the next render. Also clear messages so the drawer
      // doesn't briefly show yesterday's history under today's label.
      setSessionId(null);
      setMessages([]);
      setMessageCount(0);
      // Phase Fortune+ — refuse counter is per-session-id; reset on switch.
      setConsecutiveRefuses(0);
      setLocked(false);
      setLockReason(null);
    }
    prevFortuneAnchorRef.current = fortune.fortuneAnchorDate;
    prevFortuneProfileRef.current = fortune.profileId;
  }, [enabled, fortune?.fortuneAnchorDate, fortune?.profileId]);

  return {
    sessionId,
    messages,
    payment,
    messageCount,
    consecutiveRefuses,
    hardCap: HARD_CAP,
    loading,
    loadMoreLoading,
    hasMoreHistory,
    error,
    sessionList,
    sessionListLoading,
    locked,
    lockReason,
    tierUpgradeRefund,
    dismissTierUpgradeRefund,
    initSession,
    startNewSession,
    switchActiveSession,
    refreshSessionList,
    lockSession,
    loadMoreHistory,
    purchaseExtension,
    isPurchasingExtension,
    appendUserMessage,
    replaceUserMessageId,
    appendAssistantPlaceholder,
    appendAssistantDelta,
    finalizeAssistantMessage,
    markUserFailed,
    applyDoneEvent,
  };
}
