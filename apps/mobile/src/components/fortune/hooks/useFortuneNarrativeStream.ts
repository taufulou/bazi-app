/**
 * useFortuneNarrativeStream — opens a single SSE connection to
 * GET /api/fortune/{daily|monthly|yearly}/stream (per `scope`) and dispatches
 * each event through `onEvent`. RN port of the web hook.
 *
 * Manages AbortController teardown: enabled→open, disabled→abort, dep change→
 * abort+reopen, unmount→abort. `cancelled` guards drop late callbacks from a
 * torn-down stream.
 *
 * ⚠️ Mobile gotcha: Clerk's `getToken` is a FRESH reference every render, so it
 * is deliberately EXCLUDED from the effect deps (else the stream re-opens on
 * every render → infinite reconnect loop). Same fix as the M1 fetch-loop bug.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import {
  streamDailyFortune,
  streamMonthlyFortune,
  streamYearlyFortune,
  type FortuneStreamEvent,
} from '../../../lib/fortune-api';

export interface UseFortuneNarrativeStreamArgs {
  enabled: boolean;
  scope?: 'day' | 'month' | 'year';
  profileId?: string;
  date?: string; // scope='day' YYYY-MM-DD
  month?: string; // scope='month' YYYY-MM
  year?: string; // scope='year' YYYY
  onEvent: (ev: FortuneStreamEvent) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export interface UseFortuneNarrativeStreamReturn {
  streaming: boolean;
  error: { code: string; message: string } | null;
  sectionsReceived: Set<string>;
  clearError: () => void;
  cancel: () => void;
}

export function useFortuneNarrativeStream(
  args: UseFortuneNarrativeStreamArgs,
): UseFortuneNarrativeStreamReturn {
  const { getToken } = useAuth();
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [sectionsReceived, setSectionsReceived] = useState<Set<string>>(() => new Set());

  const teardownRef = useRef<(() => void) | null>(null);

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

  const scope = args.scope ?? 'day';
  useEffect(() => {
    if (!args.enabled) {
      cancel();
      setStreaming(false);
      return;
    }
    // Invariant guards — early-return on malformed args during profile-switch races.
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

      const handlers = {
        token,
        profileId: args.profileId,
        onEvent: (ev: FortuneStreamEvent) => {
          if (cancelled) return; // drop late events from a torn-down stream
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
          if (cancelled) {
            teardownRef.current = null;
            return;
          }
          setStreaming(false);
          teardownRef.current = null;
          onCloseRef.current?.();
        },
      };

      if (scope === 'day') {
        teardownRef.current = streamDailyFortune({ ...handlers, date: args.date });
      } else if (scope === 'month') {
        teardownRef.current = streamMonthlyFortune({ ...handlers, month: args.month });
      } else {
        teardownRef.current = streamYearlyFortune({ ...handlers, year: args.year });
      }
    })();

    return () => {
      cancelled = true;
      cancel();
    };
    // getToken EXCLUDED — unstable ref each render (see header note).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.enabled, scope, args.profileId, args.date, args.month, args.year]);

  return { streaming, error, sectionsReceived, clearError, cancel };
}
