/**
 * useFortuneNarrativeStream — Phase Fortune Streaming Layer 4.
 *
 * Opens a single SSE connection to `GET /api/fortune/daily/stream` and
 * dispatches each event through `onEvent`. Manages the AbortController
 * teardown lifecycle:
 *   - enabled true → open stream
 *   - enabled toggles to false → abort current stream
 *   - dep change (new profileId / date) → abort + re-open
 *   - unmount → abort
 *
 * Exposes `sectionsReceived: Set<string>` so callers (e.g., the page
 * effect that controls the stream-error banner) can react to set
 * membership without re-subscribing to the event callback.
 *
 * Mirrors the `useChatStream` lifecycle pattern, simplified for fortune's
 * one-shot stream (no message-send loop, no payment, no cancel button).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { streamDailyFortune, type FortuneStreamEvent } from '../../../lib/fortune-api';

export interface UseFortuneNarrativeStreamArgs {
  enabled: boolean;
  profileId?: string;
  date?: string;
  onEvent: (ev: FortuneStreamEvent) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export interface UseFortuneNarrativeStreamReturn {
  /** True while a stream connection is open. */
  streaming: boolean;
  /** The most recent error event from the stream (or null). */
  error: { code: string; message: string } | null;
  /** Set of section keys received via section_complete events so far.
   *  Cleared whenever a new stream opens. */
  sectionsReceived: Set<string>;
  /** Reset the error state (used after the FE banner is dismissed). */
  clearError: () => void;
  /** Manually abort the in-flight stream. Rarely needed — toggle `enabled`
   *  to false or unmount instead. */
  cancel: () => void;
}

export function useFortuneNarrativeStream(
  args: UseFortuneNarrativeStreamArgs,
): UseFortuneNarrativeStreamReturn {
  const { getToken } = useAuth();
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  // Set state mutated via setter to trigger re-render. Wrapped in useState so
  // callers can `useEffect` on it as a dep.
  const [sectionsReceived, setSectionsReceived] = useState<Set<string>>(
    () => new Set(),
  );

  /** Holds the teardown function returned by `streamDailyFortune`. */
  const teardownRef = useRef<(() => void) | null>(null);

  // Capture latest onEvent in a ref so the effect can call it without
  // re-subscribing when the caller re-creates the callback inline.
  const onEventRef = useRef(args.onEvent);
  const onErrorRef = useRef(args.onError);
  const onCloseRef = useRef(args.onClose);
  useEffect(() => {
    onEventRef.current = args.onEvent;
    onErrorRef.current = args.onError;
    onCloseRef.current = args.onClose;
  }, [args.onEvent, args.onError, args.onClose]);

  const cancel = useCallback(() => {
    if (teardownRef.current) {
      teardownRef.current();
      teardownRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Open the stream when enabled + deps stable; abort + re-open on any change.
  useEffect(() => {
    if (!args.enabled) {
      cancel();
      setStreaming(false);
      return;
    }

    let cancelled = false;
    setError(null);
    setSectionsReceived(new Set());
    setStreaming(true);

    (async () => {
      let token: string;
      try {
        const t = await getToken();
        if (!t) throw new Error('Not signed in');
        token = t;
      } catch (err) {
        if (cancelled) return;
        const e = err as Error;
        setError({ code: 'AUTH_FAILED', message: e.message });
        setStreaming(false);
        onErrorRef.current?.(e);
        return;
      }
      if (cancelled) return;

      teardownRef.current = streamDailyFortune({
        token,
        profileId: args.profileId,
        date: args.date,
        onEvent: (ev) => {
          // Audit HIGH fix — race guard: when deps change (e.g., DateNavigator
          // switches to a new date), the effect's cleanup sets `cancelled =
          // true` synchronously but the AbortController takes a tick to
          // propagate to the in-flight reader.read() loop. Without this guard,
          // late onEvent calls from the OLD stream could write into the NEW
          // stream's `streamedSections` state, briefly showing stale section
          // text under the new date's engine view. Bail early on cancellation.
          if (cancelled) return;
          if (ev.type === 'section_complete') {
            setSectionsReceived((prev) => {
              if (prev.has(ev.key)) return prev;
              const next = new Set(prev);
              next.add(ev.key);
              return next;
            });
          } else if (ev.type === 'error') {
            setError({ code: ev.code, message: ev.message });
          }
          onEventRef.current(ev);
        },
        onError: (err) => {
          if (cancelled) return;
          setError({ code: 'STREAM_FAILED', message: err.message });
          onErrorRef.current?.(err);
        },
        onClose: () => {
          // onClose can fire AFTER cancellation (the fetch reader exits its
          // loop on abort and triggers onClose). It's safe to still null out
          // teardownRef + flip streaming flag — these are local-to-instance
          // state that gets reset on the next effect run anyway. But skip
          // user-callback to avoid spurious notifications.
          if (cancelled) {
            teardownRef.current = null;
            return;
          }
          setStreaming(false);
          teardownRef.current = null;
          onCloseRef.current?.();
        },
      });
    })();

    return () => {
      cancelled = true;
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.enabled, args.profileId, args.date, getToken]);

  return { streaming, error, sectionsReceived, clearError, cancel };
}
