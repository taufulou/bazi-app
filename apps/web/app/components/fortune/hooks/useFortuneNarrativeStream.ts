/**
 * useFortuneNarrativeStream — Phase Fortune Streaming Layer 4 (Phase 2.x scope-aware).
 *
 * Opens a single SSE connection to `GET /api/fortune/{daily|monthly|yearly}/stream`
 * (per `scope` arg) and dispatches each event through `onEvent`. Manages the
 * AbortController teardown lifecycle:
 *   - enabled true → open stream
 *   - enabled toggles to false → abort current stream
 *   - dep change (new scope / profileId / date / month / year) → abort + re-open
 *   - unmount → abort
 *
 * Phase 2.x / Phase 3 refactor:
 *   - `scope: 'day' | 'month' | 'year'` discriminator dispatches to the right wire helper
 *   - `date` (scope='day') / `month` (scope='month') / `year` (scope='year') drives URL
 *   - Effect deps include `scope` + `month` + `year` so MonthNavigator /
 *     YearNavigator changes re-open the stream (plan M-5 fix)
 *   - Invariant guards at hook entry early-return on malformed args during
 *     profile-switch races (plan NEW-M2 fix)
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
import {
  streamDailyFortune,
  streamMonthlyFortune,
  streamYearlyFortune,
  type FortuneStreamEvent,
} from '../../../lib/fortune-api';

export interface UseFortuneNarrativeStreamArgs {
  enabled: boolean;
  /** Phase 2.x / Phase 3: which scope's stream endpoint to open. Determines
   *  which date field is consumed below + which SSE endpoint URL is used.
   *  Defaults to 'day' for back-compat with day-only callers that don't yet
   *  thread the prop (existing daily callers stay unchanged). */
  scope?: 'day' | 'month' | 'year';
  profileId?: string;
  /** Required when scope='day'. Format: YYYY-MM-DD. Ignored on month/year-scope. */
  date?: string;
  /** Required when scope='month'. Format: YYYY-MM. Ignored on day/year-scope. */
  month?: string;
  /** Required when scope='year'. Format: YYYY. Ignored on day/month-scope. */
  year?: string;
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

  /** Holds the teardown function returned by streamDailyFortune / streamMonthlyFortune. */
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
  // Plan M-5 fix: deps include `scope` + `month` so MonthNavigator / tab switch
  // re-opens correctly.
  const scope = args.scope ?? 'day';
  useEffect(() => {
    if (!args.enabled) {
      cancel();
      setStreaming(false);
      return;
    }

    // Plan NEW-M2 fix — scope/date/month invariant guards. Without these, a
    // profile-switch race (where parent re-renders with date=undefined for one
    // tick before useMemo recomputes) would fire the effect with malformed
    // URL params → 400 from controller → unnecessary noise + error event
    // flicker. Pattern mirrors existing daily guard at controller level.
    if (scope === 'day' && !args.date) {
      cancel();
      setStreaming(false);
      return;
    }
    if (scope === 'month' && !args.month) {
      cancel();
      setStreaming(false);
      return;
    }
    if (scope === 'year' && !args.year) {
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

      // Shared event handlers — same shape for day + month per umbrella
      // FortuneStreamEvent union (R3 polish — single onEvent signature works
      // for both scopes; runtime branches on ev.type + scope context).
      const handlers = {
        token,
        profileId: args.profileId,
        onEvent: (ev: FortuneStreamEvent) => {
          // Audit HIGH fix — race guard: when deps change (e.g., DateNavigator
          // / MonthNavigator switches), the effect's cleanup sets `cancelled =
          // true` synchronously but the AbortController takes a tick to
          // propagate to the in-flight reader.read() loop. Without this guard,
          // late onEvent calls from the OLD stream could write into the NEW
          // stream's `streamedSections` state, briefly showing stale section
          // text under the new period's engine view. Bail early on cancellation.
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
        onError: (err: Error) => {
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
      };

      // Scope dispatch — pick wire helper based on scope arg.
      // TypeScript narrowing handles the date vs month vs year discrimination.
      if (scope === 'day') {
        teardownRef.current = streamDailyFortune({
          ...handlers,
          date: args.date,
        });
      } else if (scope === 'month') {
        teardownRef.current = streamMonthlyFortune({
          ...handlers,
          month: args.month,
        });
      } else {
        teardownRef.current = streamYearlyFortune({
          ...handlers,
          year: args.year,
        });
      }
    })();

    return () => {
      cancelled = true;
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.enabled, scope, args.profileId, args.date, args.month, args.year, getToken]);

  return { streaming, error, sectionsReceived, clearError, cancel };
}
