/**
 * useChatStream — orchestrates a single chat-stream lifecycle.
 *
 * Takes the session's append/finalize callbacks (from useChatSession) and
 * wires them to the SSE event types coming from the API.
 *
 * Returns:
 * - `streaming` — true while a stream is in flight
 * - `error` — last user-facing error (e.g., NEEDS_EXTENSION, AI_FAILED)
 * - `sendMessage(content, sectionContextHint?)` — kicks off a stream
 * - `cancel()` — aborts the in-flight stream (rarely used; mostly for unmount)
 *
 * RN port of apps/web/app/components/chat/hooks/useChatStream.ts. The only
 * changes from web are: Clerk import (@clerk/clerk-expo) and getToken excluded
 * from the sendMessage dep array (fresh ref every render on Expo → excluding it
 * prevents an infinite re-send loop). Behavior + exported interface identical.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { streamChatMessage } from '../../../lib/chat-api';

export interface ChatStreamErrorPayload {
  code: string;
  message: string;
  refunded?: boolean;
}

interface UseChatStreamArgs {
  sessionId: string | null;
  appendUserMessage: (content: string) => string;
  replaceUserMessageId: (localId: string, serverId: string) => void;
  appendAssistantPlaceholder: () => void;
  appendAssistantDelta: (text: string) => void;
  finalizeAssistantMessage: (args: {
    messageId: string;
    finalText?: string;
  }) => void;
  markUserFailed: (errorCode: string) => void;
  applyDoneEvent: (args: {
    messageCount: number;
    messagesRemaining: number;
    /** Phase Fortune+ — post-message consecutive refuse counter. Passed
     *  through to ChatDrawer's «超出範圍提醒» dialog trigger effect. */
    consecutiveRefuses: number;
  }) => void;
}

export interface UseChatStreamReturn {
  streaming: boolean;
  error: ChatStreamErrorPayload | null;
  clearError: () => void;
  sendMessage: (content: string, sectionContextHint?: string) => Promise<void>;
  cancel: () => void;
}

export function useChatStream(args: UseChatStreamArgs): UseChatStreamReturn {
  const { getToken } = useAuth();
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<ChatStreamErrorPayload | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (teardownRef.current) {
      teardownRef.current();
      teardownRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const sendMessage = useCallback(
    async (content: string, sectionContextHint?: string) => {
      if (!args.sessionId) {
        setError({ code: 'NO_SESSION', message: '尚未建立對話' });
        return;
      }
      if (streaming) return;

      setError(null);
      setStreaming(true);

      // Optimistic user message — must happen before fetch so the bubble
      // shows immediately. We hold its local id so we can swap it for the
      // server's persisted id on the session_start event.
      const localUserId = args.appendUserMessage(content);

      let token: string;
      try {
        const t = await getToken();
        if (!t) throw new Error('Not signed in');
        token = t;
      } catch (err) {
        setError({ code: 'AUTH_FAILED', message: (err as Error).message });
        args.markUserFailed('AUTH_FAILED');
        setStreaming(false);
        return;
      }

      let placeholderInstalled = false;
      let receivedDone = false;

      teardownRef.current = streamChatMessage({
        sessionId: args.sessionId,
        content,
        sectionContextHint,
        token,
        onEvent: (ev) => {
          switch (ev.type) {
            case 'session_start':
              // Backend emits the persisted USER message id here (per
              // chat-stream.service.ts). Swap our local id for it so cursor
              // pagination stays correct, then install the assistant
              // placeholder for incoming deltas.
              args.replaceUserMessageId(localUserId, ev.messageId);
              args.appendAssistantPlaceholder();
              placeholderInstalled = true;
              break;
            case 'delta':
              if (!placeholderInstalled) {
                // Refusal path emits deltas without a session_start. Synthesize
                // a placeholder; the done event will fill in the real id.
                args.appendAssistantPlaceholder();
                placeholderInstalled = true;
              }
              args.appendAssistantDelta(ev.text);
              break;
            case 'done':
              receivedDone = true;
              args.finalizeAssistantMessage({ messageId: ev.messageId });
              args.applyDoneEvent({
                messageCount: ev.messageCount,
                messagesRemaining: ev.messagesRemaining,
                // Defensive: if an older / non-Phase-Fortune-aware backend
                // omits `consecutiveRefuses`, fall back to 0 instead of
                // propagating undefined → NaN state corruption that would
                // silently disable the refuse-cap dialog (comparison with
                // NaN always returns false). Backend currently always
                // emits this field; the fallback is belt-and-braces for
                // cross-deploy windows + raw SSE clients.
                consecutiveRefuses: ev.consecutiveRefuses ?? 0,
              });
              break;
            case 'error':
              setError({
                code: ev.code,
                message: ev.message,
                refunded: ev.refunded,
              });
              args.markUserFailed(ev.code);
              break;
          }
        },
        onError: (err) => {
          setError({ code: 'STREAM_ERROR', message: err.message });
          args.markUserFailed('STREAM_ERROR');
        },
        onClose: () => {
          setStreaming(false);
          teardownRef.current = null;
          if (!receivedDone && placeholderInstalled) {
            // Stream closed mid-flight without a done event; mark assistant
            // placeholder as a stub so user sees something happened.
            args.finalizeAssistantMessage({
              messageId: `closed-${Date.now()}`,
              finalText: '（連線中斷）',
            });
          }
        },
      });
    },
    // RN: getToken is a fresh reference on every render (Expo). Excluding it
    // from the deps prevents an infinite re-send/reconnect loop — its
    // behavior is stable even though the reference changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args, streaming],
  );

  // Abort any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      if (teardownRef.current) {
        teardownRef.current();
        teardownRef.current = null;
      }
    };
  }, []);

  return { streaming, error, clearError, sendMessage, cancel };
}
