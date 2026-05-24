'use client';

/**
 * useUserTier — lightweight hook returning the current user's subscription
 * tier. Used by Fortune Phase 1.5 controls (DateNavigator + share gating).
 *
 * Pattern matches `CreditBadge.tsx:31-52` for reviewer one-grep traceability.
 *
 * NOTE: no `import * as React` — this is a pure-logic hook, no JSX. The
 * React-namespace convention from PR #46 applies to JSX-rendering components
 * only. An unused namespace import would fail `eslint --max-warnings 0`.
 *
 * Sentry IS imported explicitly. `@sentry/nextjs` is already in the route
 * bundle via `sentry.client.config.ts` at the app root, so the marginal cost
 * of importing here is tree-shaken in production builds. We do NOT fall back
 * to `console.error` because our Sentry config has no `CaptureConsole`
 * integration — default integrations only capture window.onerror, unhandled
 * promise rejections, and fetch/xhr failures. Explicit `captureException` with
 * a tag enables filterable production debugging via `hook:useUserTier`.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import * as Sentry from '@sentry/nextjs';
import { getUserProfile, type UserProfile } from './api';

export type UserTier = UserProfile['subscriptionTier'];

export interface UseUserTierResult {
  tier: UserTier | undefined;
  isLoading: boolean;
  /** Phase 1.5.x Issue #2: true when the tier fetch failed (Clerk JWT expired,
   *  null token, API 401/403/500, etc). Surface a re-auth banner so paid
   *  subscribers don't silently see FREE-tier locked controls. Auto-cleared
   *  on next successful fetch. */
  authError: boolean;
  /** Caller-triggered re-run (e.g., after user clicks "重新登入" and Clerk
   *  re-issues a token). Stable callback reference per useCallback([]). */
  refetch: () => void;
}

export function useUserTier(): UseUserTierResult {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [tier, setTier] = useState<UserTier>();
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [refetchKey, setRefetchKey] = useState(0);

  const refetch = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

  useEffect(() => {
    // Signed-out edge case: when Clerk middleware hasn't redirected yet, we
    // return tier=undefined → soft-fallback to FREE in UI. User briefly sees
    // locked controls before middleware kicks in (~100ms). Acceptable.
    if (!isLoaded || !isSignedIn) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          // Phase 1.5.x Issue #6: null token is the most common Clerk-expiry
          // signal (SDK lost the session). Emit Sentry breadcrumb here too —
          // the catch block would have done it; preserve observability on the
          // null-token path. Then surface authError so the banner can render.
          Sentry.captureMessage('useUserTier: getToken returned null', {
            tags: { hook: 'useUserTier', reason: 'null-token' },
            level: 'warning',
          });
          if (!cancelled) {
            setAuthError(true);
            // Audit Bug #1: this early-return path skips the `finally` block,
            // so isLoading would stay `true` forever otherwise. Manually reset
            // here. Without this, DateNavigator stays in loading-skeleton
            // placeholder forever when Clerk JWT expires.
            setIsLoading(false);
          }
          return;
        }
        const profile = await getUserProfile(token);
        if (!cancelled) {
          setTier(profile.subscriptionTier);
          // Phase 1.5.x Issue #7: clear authError on successful refetch (e.g.,
          // after Clerk silent-refresh OR explicit refetch() trigger).
          setAuthError(false);
        }
      } catch (err) {
        // Production debug of "why is subscriber seeing FREE UI" requires a
        // filterable Sentry breadcrumb. Tag enables queries like
        // `hook:useUserTier`.
        Sentry.captureException(err, { tags: { hook: 'useUserTier' } });
        if (!cancelled) setAuthError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken is stable across renders per Clerk, but ESLint can't prove it.
    // Adding it to deps would cause unnecessary re-runs if Clerk ever changed
    // identity semantics. refetchKey is included so refetch() actually re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, refetchKey]);

  return { tier, isLoading, authError, refetch };
}
