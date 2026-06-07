'use client';

/**
 * /reading/fortune — 八字日運/月運/年運 page (Phase 1: 日運 active;
 * 月運/年運 = partial preview placeholders per locked plan).
 *
 * Query params:
 *   - tab=day|month|year   (default day)
 *   - date=YYYY-MM-DD      (client resolves 23:00 子時 boundary before sending)
 *   - profileId=<uuid>     (falls back to user primary)
 *
 * Auth: protected by `middleware.ts` Clerk gate; this client component
 *       uses `useAuth().getToken()` to obtain a JWT for the API call.
 *
 * Audit #1: the inner `FortuneView` calls `useSearchParams()` and must
 * be wrapped in a `<Suspense>` boundary at the page-level default export
 * (Next.js App Router requirement for static prerendering).
 */

// React namespace import (value) — fixes `Suspense cannot be used as a JSX
// component` (TS2786) caused by dual-`@types/react` resolution in CI. Same
// pattern as FortuneShell.tsx + InfoTooltip.tsx. Hooks below still use named
// destructured imports — only JSX intrinsic components need the namespace
// reference (hooks don't trigger the JSX type identity check).
import * as React from 'react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, useSession } from '@clerk/nextjs';
import { ENTERTAINMENT_DISCLAIMER } from '@repo/shared';
import FortuneShell from '../../components/fortune/FortuneShell';
import EnergyScoreRing from '../../components/fortune/EnergyScoreRing';
import DimensionBars from '../../components/fortune/DimensionBars';
import NarrativeCard from '../../components/fortune/NarrativeCard';
import SectionDivider from '../../components/fortune/SectionDivider';
import DateNavigator from '../../components/fortune/DateNavigator';
import ProfileSwitcher from '../../components/fortune/ProfileSwitcher';
import FortuneUpgradeModal from '../../components/fortune/FortuneUpgradeModal';
import AuthExpiredBanner from '../../components/fortune/AuthExpiredBanner';
import ShareableFortuneCard from '../../components/fortune/ShareableFortuneCard';
import ShareableYearlyFortuneCard from '../../components/fortune/ShareableYearlyFortuneCard';
import ShareableMonthlyFortuneCard from '../../components/fortune/ShareableMonthlyFortuneCard';
import ShareFortuneButton, {
  type ShareFortuneButtonHandle,
} from '../../components/fortune/ShareFortuneButton';
import { fortuneShareFilename } from '../../lib/share-fortune';
import FortuneSampleQuestions from '../../components/fortune/FortuneSampleQuestions';
import ChatDrawer from '../../components/chat/ChatDrawer';
import ChatFloatingButton from '../../components/chat/ChatFloatingButton';
import InlineAskCard from '../../components/chat/InlineAskCard';
import type { FortuneDimKey } from '../../components/fortune/NarrativeCard';
// Phase 2 月運 (L5) — monthly components
import MonthNavigator from '../../components/fortune/MonthNavigator';
import MonthlyEnergyRing from '../../components/fortune/MonthlyEnergyRing';
import MonthlyDimensionBars from '../../components/fortune/MonthlyDimensionBars';
import MonthlyTimeGrid from '../../components/fortune/MonthlyTimeGrid';
import MonthlyNarrativeCard from '../../components/fortune/MonthlyNarrativeCard';
// Phase 3 年運 — yearly components
import YearNavigator from '../../components/fortune/YearNavigator';
import YearlyEnergyRing from '../../components/fortune/YearlyEnergyRing';
import YearlyDimensionStars from '../../components/fortune/YearlyDimensionStars';
import YearlyRiskOpportunityGrid from '../../components/fortune/YearlyRiskOpportunityGrid';
import YearlyLuckMethodsCard from '../../components/fortune/YearlyLuckMethodsCard';
import YearlyNarrativeCard from '../../components/fortune/YearlyNarrativeCard';
import YearlyCrossSellCard from '../../components/fortune/YearlyCrossSellCard';
import {
  resolveBaziToday,
  resolveCurrentMonthIso,
  resolveCurrentYearIso,
  type DailyFortuneResponse,
  type DailyFortuneNarrative,
  type FortuneStreamEvent,
  type MonthlyFortuneResponse,
  type MonthlyFortuneNarrative,
  type YearlyFortuneResponse,
  type YearlyFortuneNarrative,
} from '../../lib/fortune-api';
import type { YearlyDimKey } from '../../components/fortune/yearlyDimensions';
import { useFortuneNarrativeStream } from '../../components/fortune/hooks/useFortuneNarrativeStream';
import { useUserTier } from '../../lib/use-user-tier';
import { fetchBirthProfiles, type BirthProfile } from '../../lib/birth-profiles-api';
import { getProfileDisplayName } from '../../lib/format-profile-display-name';
import styles from './page.module.css';

type Tab = 'day' | 'month' | 'year';

// Top-level default export wraps the inner view in <Suspense> for the
// useSearchParams() prerender requirement.
export default function FortunePage() {
  return (
    <React.Suspense fallback={<div className={styles.skeletonWrap} aria-label="載入中" />}>
      <FortuneView />
    </React.Suspense>
  );
}

function FortuneView() {
  const search = useSearchParams();
  const router = useRouter();
  const { getToken, isSignedIn, isLoaded } = useAuth();

  const tab: Tab = (search.get('tab') as Tab) || 'day';
  const dateParam = search.get('date') ?? undefined;
  const profileId = search.get('profileId') ?? undefined;

  // Phase 1.5 — user tier + birth profile list, fetched once on mount.
  // useUserTier owns its own fetch lifecycle (Clerk auth → /api/users/me).
  // Phase 1.5.x Issue #2: authError surfaces when tier-fetch fails (Clerk JWT
  // expired). Pipe through AuthExpiredBanner so subscribers don't silently get
  // FREE-tier locked controls.
  const { tier, isLoading: tierIsLoading, authError } = useUserTier();
  const { session } = useSession();
  const sessionId = session?.id ?? 'anon';
  const dismissKey = `fortune-auth-banner-dismissed:${sessionId}`;
  const [profiles, setProfiles] = useState<BirthProfile[]>([]);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);

  // Persist banner dismiss across page navigations within the same browser
  // session (per Phase 1.5.x R1 Issue #8). sessionStorage scoped to Clerk
  // session id so a new auth event resets the dismiss state.
  //
  // Audit Bug #2: a useState lazy-init was wrong here — at first mount,
  // Clerk's session?.id is undefined, so dismissKey contains ':anon'. The
  // lazy initializer would run ONCE under the anon key (always null), and
  // never re-read once dismissKey transitions to the real session id.
  // Result: a previously-dismissed banner would re-appear on every
  // navigation. Fix: hydrate via useEffect that re-runs when dismissKey
  // changes (i.e., when Clerk's session resolves).
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.sessionStorage.getItem(dismissKey) === '1') {
        setBannerDismissed(true);
      }
    } catch {
      // sessionStorage may throw in private browsing / quota — non-fatal
    }
  }, [dismissKey]);

  const handleBannerDismiss = useCallback(() => {
    setBannerDismissed(true);
    try {
      window.sessionStorage.setItem(dismissKey, '1');
    } catch {
      // sessionStorage may throw in private browsing / quota — non-fatal
    }
  }, [dismissKey]);

  const showAuthBanner = authError && !bannerDismissed;

  // Share-related parent state (lazy-mount the heavy ShareableFortuneCard
  // until user signals share intent via hover/touch/click on the button).
  const [shareCardArmed, setShareCardArmed] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);
  // Imperative handle to ShareFortuneButton — lets the shell's top-right
  // share icon invoke `triggerShare()` directly (preserves iOS user gesture).
  // Replaces the old pattern of programmatic `.click()` on a button ref.
  const shareButtonRef = useRef<ShareFortuneButtonHandle>(null);

  // Birth profiles fetch
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const list = await fetchBirthProfiles(token);
        if (!cancelled) setProfiles(list);
      } catch {
        // Silent — ProfileSwitcher hides when profiles.length <= 1
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getToken is stable
  }, [isLoaded, isSignedIn]);

  const handleSwitchTab = useCallback(
    (next: Tab) => {
      // Audit M#1 (L3.5b line audit) — clear chat populate state before
      // navigating. Without this, a user who tapped an InlineAskCard on
      // DAY tab (setting chatPendingMessage="今日感情如何？" +
      // chatSectionHint="daily_romance") and then switched tabs BEFORE
      // the drawer's auto-populate effect fired would leak DAY-flavored
      // populated text + invisible DAY section hint into the MONTH
      // composer. Section hint flows to the prompt → MONTH session sees
      // an unexpected `[daily_romance]` topic marker.
      setChatPendingMessage(undefined);
      setChatSectionHint(undefined);
      const params = new URLSearchParams(search.toString());
      params.set('tab', next);
      router.push(`/reading/fortune?${params.toString()}`);
    },
    [router, search],
  );

  const handleSwitchDate = useCallback(
    (nextIso: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('date', nextIso);
      router.push(`/reading/fortune?${params.toString()}`);
    },
    [router, search],
  );

  // Phase 2 月運 (L5) — analog to handleSwitchDate for MONTH scope. Updates
  // ?month=YYYY-MM query param; MonthlyFortuneView re-fetches via effect.
  const handleSwitchMonth = useCallback(
    (nextMonthIso: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('month', nextMonthIso);
      router.push(`/reading/fortune?${params.toString()}`);
    },
    [router, search],
  );

  // Phase 3 年運 — analog to handleSwitchMonth for YEAR scope. Updates
  // ?year=YYYY query param; YearlyFortuneView re-fetches via effect.
  const handleSwitchYear = useCallback(
    (nextYearIso: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('year', nextYearIso);
      router.push(`/reading/fortune?${params.toString()}`);
    },
    [router, search],
  );

  const handleSwitchProfile = useCallback(
    (nextProfileId: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('profileId', nextProfileId);
      // Drop stale date AND month AND year when switching profiles — fresh
      // start with new chart (audit fix HIGH #6 2026-05-28: was only dropping
      // date; left stale `?month=` to leak into new profile causing
      // OUT_OF_WINDOW errors or confusing stale anchors. Phase 3 adds year).
      params.delete('date');
      params.delete('month');
      params.delete('year');
      router.push(`/reading/fortune?${params.toString()}`);
    },
    [router, search],
  );

  const handleLockedAttempt = useCallback(() => {
    setIsUpgradeOpen(true);
  }, []);

  // Phase Fortune chat — drawer + composer state. Mirrors the
  // compatibility/page.tsx Phase 3 pattern (lines 980-1001):
  //   - chatOpen: drawer visibility
  //   - chatSectionHint: which dim (or general) the user tapped from
  //   - chatPendingMessage: question to populate the composer with (NOT
  //     auto-sent — predictable UX + explicit send step per plan Issue 6)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSectionHint, setChatSectionHint] = useState<string | undefined>();
  const [chatPendingMessage, setChatPendingMessage] = useState<string | undefined>();

  // Phase Fortune chat — dim key → ChatSampleQuestion sectionKey map.
  // Mirrors `chat-sample-questions.service.ts::
  // CHAT_SECTION_KEYS_BY_READING_TYPE_LOCAL.FORTUNE`.
  const DIM_TO_CHAT_SECTION: Record<FortuneDimKey, string> = {
    romance: 'daily_romance',
    career: 'daily_career',
    finance: 'daily_finance',
    travel: 'daily_travel',
    health: 'daily_health',
  };

  const handleAskFromCard = useCallback(
    (sectionKey: string, question: string) => {
      setChatSectionHint(sectionKey);
      setChatPendingMessage(question);
      setChatOpen(true);
    },
    [],
  );

  const handleOpenChatFromCard = useCallback(
    (sectionKey: string) => {
      setChatSectionHint(sectionKey);
      setChatPendingMessage(undefined);
      setChatOpen(true);
    },
    [],
  );

  const handleAskGeneral = useCallback(
    (question: string) => {
      setChatSectionHint(undefined);
      setChatPendingMessage(question);
      setChatOpen(true);
    },
    [],
  );

  const handleOpenChatGeneral = useCallback(() => {
    setChatSectionHint(undefined);
    setChatPendingMessage(undefined);
    setChatOpen(true);
  }, []);

  const handleChatDrawerClose = useCallback(() => {
    setChatOpen(false);
    // Defensive — if a pendingMessage was queued but the drawer was closed
    // before the session resolved, clear it so reopening doesn't re-send.
    setChatPendingMessage(undefined);
    // Audit fix L1/L2 — also clear the section context hint so subsequent
    // re-opens via the floating button don't inherit a stale `daily_X`
    // hint from a prior InlineAskCard click.
    setChatSectionHint(undefined);
  }, []);

  // "Today" computed from 23:00 子時 boundary helper. Recompute on every
  // render — `resolveBaziToday()` is O(1) (just `new Date()` + hour check),
  // and memoizing once-per-mount would go stale for long-lived sessions
  // that span the 23:00 boundary (audit Bug #3).
  const todayBaziIso = resolveBaziToday();
  const targetDate = dateParam ?? todayBaziIso;

  /**
   * Phase Fortune Streaming page state.
   *
   *   idle    — before stream opens (or while waiting for auth/tab to be 'day')
   *   loading — stream opened, waiting for first event (engine_ready typically <500ms)
   *   engine  — engine_ready received; engine data painted; narrative streaming via
   *             section_complete events (rendered via `streamedSections` below)
   *   success — `done` event received; sanitized narrative replaces provisional sections
   *   error   — fatal pre-flight error (SUBSCRIBER_ONLY / OUT_OF_WINDOW / NO_PRIMARY_PROFILE)
   *
   * Note: a mid-stream error AFTER engine_ready does NOT downgrade to 'error' —
   * we keep showing the engine view + NarrativeCard's hybrid render + a stream-
   * error banner above NarrativeCard (plan v2 H3).
   *
   * Streaming dual-state per plan v2 architecture:
   *   - `state.data.narrative` is null until done (sanitized supersedes provisional)
   *   - `streamedSections` holds per-section provisional content; cleared on done
   *   - ShareableFortuneCard reads `state.data.narrative` only → never captures
   *     provisional content (plan v2 M1: PNG safety)
   */
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'engine'; data: DailyFortuneResponse }
    | { status: 'success'; data: DailyFortuneResponse }
    | { status: 'error'; code: string; message: string; statusCode: number }
  >({ status: 'idle' });

  /** Per-section provisional content from section_complete events. Cleared
   *  whenever a new stream opens (date change / profile change). */
  const [streamedSections, setStreamedSections] = useState<Partial<DailyFortuneNarrative>>({});

  /** Stream-error banner state. Non-null when error event arrived AFTER
   *  engine_ready (mid-stream); plan v2 H3 keeps partial render + shows
   *  banner above NarrativeCard. */
  const [streamError, setStreamError] = useState<{ code: string; message: string } | null>(null);

  // Plan v2 M7 (Option Z) — page uses a SINGLE SSE connection. engine_ready
  // event delivers engine data as fast as a separate engineOnly fetch
  // would (~500ms). Eliminates the 2-fetch race condition + double
  // engineOnly/full code path.
  const handleStreamEvent = useCallback(
    (ev: FortuneStreamEvent) => {
      if (ev.type === 'engine_ready' && 'date' in ev) {
        // Engine arrived — render score/dims/folk immediately.
        // `'date' in ev` narrows the umbrella union to the DAY engine_ready
        // variant (Phase 3 widened the umbrella to 3 scopes — without this
        // guard `ev.engineOutput` would be a 3-way union).
        setState({
          status: 'engine',
          data: {
            date: ev.date,
            profileId: ev.profileId,
            profileBirthDate: ev.profileBirthDate,
            profileBirthTime: ev.profileBirthTime,
            engineOutput: ev.engineOutput,
            narrative: null,
            cacheHit: false,
            // Provisional `generatedAt` — the `done` event's snapshot persist
            // is the source of truth; this is just a placeholder for
            // ShareableFortuneCard if user shares before done fires (rare,
            // and the share card doesn't surface generatedAt prominently).
            generatedAt: new Date().toISOString(),
          },
        });
        // Reset provisional sections for the new stream
        setStreamedSections({});
      } else if (ev.type === 'section_complete') {
        setStreamedSections((prev) => ({
          ...prev,
          [ev.key]: ev.value as never,
        }));
      } else if (ev.type === 'done') {
        // Sanitized narrative supersedes provisional sections. The umbrella
        // `done` event is identical across scopes, so cast to the DAY shape
        // (we're in the day-tab handler).
        const dailyNarrative = ev.narrative as DailyFortuneNarrative | null;
        const doneCacheHit = ev.cacheHit;
        setState((prev) => {
          if (prev.status === 'engine' || prev.status === 'success') {
            return {
              status: 'success',
              data: { ...prev.data, narrative: dailyNarrative, cacheHit: doneCacheHit },
            };
          }
          // Audit HIGH fix — defensive: if `done` arrives before `engine_ready`
          // (would be a backend contract violation, but possible with a future
          // streaming-pipeline bug or out-of-order delivery), surface as a
          // recoverable error instead of leaving the page stuck on
          // LoadingSkeleton forever. The user gets the ErrorPanel with a
          // «回到本月」 CTA to retry. Plan v2 noted this branch should be
          // unreachable; this turns «unreachable» into «recoverable».
          return {
            status: 'error',
            code: 'STREAM_ORDER',
            message: '資料載入順序異常，請重新整理',
            statusCode: 0,
          };
        });
        setStreamedSections({});
        setStreamError(null);
      } else if (ev.type === 'error') {
        // Plan v2 H3: keep partial render if engine view already up; just
        // show banner. If engine_ready never arrived (pre-flight error),
        // promote to fatal error state.
        //
        // Audit MEDIUM fix — both setState + setStreamError are called
        // unconditionally. The status guard happens inside setState's
        // PURE updater (no side effects). The streamError is harmless when
        // state.status === 'error' (the banner only renders inside
        // SuccessView, which is unmounted in the error branch). When
        // state.status is engine/success, the banner renders + render is
        // preserved per H3.
        setState((prev) => {
          if (prev.status === 'engine' || prev.status === 'success') {
            // Mid-stream error — preserve render
            return prev;
          }
          // Pre-flight error — fatal. Map to existing ErrorPanel shape.
          // statusCode=0 (SSE doesn't carry HTTP status mid-event); ErrorPanel
          // switches on `code` not statusCode for SUBSCRIBER_ONLY / OUT_OF_WINDOW
          // / NO_PRIMARY_PROFILE / PROFILE_NOT_FOUND.
          return {
            status: 'error',
            code: ev.code,
            message: ev.message,
            statusCode: 0,
          };
        });
        // Always set the banner — render gate is at the SuccessView level
        // (only mounts for engine/success states). React 18 batches both
        // setState calls into a single render. Pure updater above (no side
        // effects) means StrictMode double-invoke is also safe.
        setStreamError({ code: ev.code, message: ev.message });
      }
    },
    [],
  );

  // Open the stream when tab=day + auth ready. Hook auto-aborts + re-opens
  // when profileId / date change (plan v2 L4).
  const { error: streamHookError } = useFortuneNarrativeStream({
    enabled: tab === 'day' && isLoaded && isSignedIn,
    profileId,
    date: targetDate,
    onEvent: handleStreamEvent,
  });

  // Transition idle → loading when stream becomes enabled. The hook itself
  // doesn't manage page-level state.status (only its own streaming/error
  // flags), so flip here when deps change.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (tab !== 'day') return;
    setState({ status: 'idle' });
    setStreamedSections({});
    setStreamError(null);
    // Lift to loading so LoadingSkeleton shows until engine_ready arrives.
    // Subsequent state transitions are driven by handleStreamEvent.
    setState({ status: 'loading' });
  }, [isLoaded, isSignedIn, profileId, targetDate, tab]);

  // Network-layer errors (AUTH_FAILED / STREAM_FAILED from the hook itself)
  // surface via streamHookError. Treat as fatal IF no engine view yet.
  useEffect(() => {
    if (!streamHookError) return;
    setState((prev) => {
      if (prev.status === 'engine' || prev.status === 'success') {
        setStreamError(streamHookError);
        return prev;
      }
      return {
        status: 'error',
        code: streamHookError.code,
        message: streamHookError.message,
        statusCode: streamHookError.code === 'AUTH_FAILED' ? 401 : 0,
      };
    });
  }, [streamHookError]);

  // Note: Date moved INTO EnergyScoreRing (UX Sprint 1 R1.2 / S1.1).
  // The subheader no longer renders a date — kept just for profile chip.

  // Phase Fortune+ progressive loading: 'engine' + 'success' both have full
  // data object — only the narrative field differs. Most UI bits (profile chip,
  // share button, chat drawer, etc.) need data but don't care whether narrative
  // is loaded yet. Extract a single «hasData» state for cleaner conditionals.
  const dataState =
    state.status === 'engine' || state.status === 'success' ? state : null;

  // Active profile for the switcher (matches URL `profileId` else primary fallback)
  // Phase 2.x L3.5b — MonthlyFortuneView resolves the user's primary profileId
  // via the stream's engine_ready event when ?profileId= is omitted from URL.
  // Surfaced via `onResolvedProfileId` callback below so the page-level
  // ChatDrawer mount can use it as `activeProfileId` on the month tab too.
  const [monthlyResolvedProfileId, setMonthlyResolvedProfileId] = useState<string | undefined>(undefined);

  // Phase 3 年運 — resolved profileId surfaced from YearlyFortuneView's
  // engine_ready (mirrors monthlyResolvedProfileId). Declared here (before
  // activeProfileId reads it). Reserved for any future year-scope chat mount
  // (chat is DEFERRED for year per Phase 3 spec — not mounted).
  const [yearlyResolvedProfileId, setYearlyResolvedProfileId] = useState<string | undefined>(undefined);

  const activeProfileId =
    profileId ?? dataState?.data.profileId ?? monthlyResolvedProfileId ?? yearlyResolvedProfileId;

  // Phase 1.5.x Issue #1 fix: resolve display name from the profile list using
  // the SAME `activeProfileId` the ProfileSwitcher uses, so chip + switcher stay
  // in sync. When profile data hasn't loaded yet (or activeProfileId is unknown),
  // displayName is empty — and we deliberately gate the chip render on truthiness
  // below, so the chip simply disappears for ~200ms rather than showing a fake
  // 「本人」 fallback that would be wrong for friend/family profiles.
  const activeProfileForDisplay = activeProfileId
    ? profiles.find((p) => p.id === activeProfileId)
    : undefined;
  const displayName = getProfileDisplayName(activeProfileForDisplay);

  // Phase 2 月運 (L5) — derive monthly target (YYYY-MM) from URL ?month param,
  // fall back to current Asia/Taipei month. Independent of `targetDate` (DAY).
  const currentMonthIso = React.useMemo(() => resolveCurrentMonthIso(), []);
  const targetMonth = search.get('month') ?? currentMonthIso;

  // Phase 3 年運 — derive yearly target (YYYY) from URL ?year param, fall back
  // to current Asia/Taipei year. Independent of targetDate / targetMonth.
  const currentYearIso = React.useMemo(() => resolveCurrentYearIso(), []);
  const targetYear = search.get('year') ?? currentYearIso;

  // Phase 3 年運 — loading state published up so YearNavigator disables arrows
  // during in-flight fetch (mirror of monthlyIsLoading).
  const [yearlyIsLoading, setYearlyIsLoading] = useState(false);

  // Phase 3 share — YearlyFortuneView publishes share-readiness UP (true only
  // on success). Drives the FortuneShell share-icon gate for the year tab.
  const [yearlyShareReady, setYearlyShareReady] = useState(false);

  // Tier B1 share — MonthlyFortuneView publishes share-readiness UP (true only
  // on success). Drives the FortuneShell share-icon gate for the month tab.
  const [monthlyShareReady, setMonthlyShareReady] = useState(false);

  // Audit fix MEDIUM #8 (2026-05-28): MonthlyFortuneView publishes its
  // loading state UP via this setter so MonthNavigator can render
  // disabled arrows during in-flight fetch (mirror of DateNavigator's
  // `isLoading` prop wired to `state.status === 'loading'`). Without
  // this, rapid ◄/► clicks fire multiple fetches; AbortController
  // prevents stale renders but UX still allows spammy clicks without
  // disabled feedback.
  const [monthlyIsLoading, setMonthlyIsLoading] = useState(false);

  // Build the navigator slot — dispatch by tab:
  //   - tab='day'   → DateNavigator (Phase 1)
  //   - tab='month' → MonthNavigator (Phase 2, sibling component)
  //   - tab='year'  → YearNavigator (Phase 3, sibling component)
  const dateNavigatorSlot =
    tab === 'day' ? (
      <DateNavigator
        value={targetDate}
        todayBaziIso={todayBaziIso}
        tier={tier}
        isTierLoading={tierIsLoading}
        onChange={handleSwitchDate}
        onLockedAttempt={handleLockedAttempt}
        isLoading={state.status === 'loading'}
      />
    ) : tab === 'month' ? (
      <MonthNavigator
        value={targetMonth}
        currentMonthIso={currentMonthIso}
        tier={tier}
        isTierLoading={tierIsLoading}
        onChange={handleSwitchMonth}
        onLockedAttempt={handleLockedAttempt}
        isLoading={monthlyIsLoading}
      />
    ) : tab === 'year' ? (
      <YearNavigator
        value={targetYear}
        currentYearIso={currentYearIso}
        tier={tier}
        isTierLoading={tierIsLoading}
        onChange={handleSwitchYear}
        onLockedAttempt={handleLockedAttempt}
        isLoading={yearlyIsLoading}
      />
    ) : undefined;

  const profileSwitcherSlot = dataState ? (
    <ProfileSwitcher
      profiles={profiles}
      activeProfileId={activeProfileId}
      onSelect={handleSwitchProfile}
    />
  ) : undefined;

  // Audit Bug #2 fix: invoke `triggerShare()` directly via useImperativeHandle.
  // The old pattern (programmatic `.click()` on a button ref) loses iOS Safari's
  // user-gesture activation, breaking navigator.share. A direct method call
  // chains synchronously through the user-gesture handler context.
  const handleShellShareClick = useCallback(() => {
    void shareButtonRef.current?.triggerShare();
  }, []);

  return (
    <>
      <FortuneShell
        activeTab={tab}
        onSwitchTab={handleSwitchTab}
        profileName={dataState && displayName ? displayName : undefined}
        birthDate={dataState?.data.profileBirthDate}
        birthTime={dataState?.data.profileBirthTime}
        dateNavigator={dateNavigatorSlot}
        profileSwitcher={profileSwitcherSlot}
        topBanner={
          showAuthBanner ? <AuthExpiredBanner onDismiss={handleBannerDismiss} /> : undefined
        }
        // CRITICAL fix per plan v2 M1 / locked decision #15: share button is
        // gated on success (NOT the streaming 'engine' window). Rationale:
        // during streaming, `narrative` is null — the share cards read
        // narrative fields (daily takeaway / yearly headline), so a share
        // triggered mid-stream would generate a PNG with empty/missing copy
        // (looks broken on LINE/WeChat). Gate on success → PNGs always
        // contain the validator-sanitized narrative.
        //
        // Tab-aware: day reads the outer day-state machine; month + year read
        // `monthlyShareReady` / `yearlyShareReady` surfaced from each view's
        // own state machine. Only one tab's ShareFortuneButton is mounted at
        // a time, so the shared shareButtonRef points to the active one.
        onShareClick={
          (tab === 'day' && state.status === 'success') ||
          (tab === 'month' && monthlyShareReady) ||
          (tab === 'year' && yearlyShareReady)
            ? handleShellShareClick
            : undefined
        }
      >
        {/* Phase 2 月運 (L5) — replace PartialPreview for month tab with real
            MonthlyFortuneView. Year tab still uses PartialPreview (Phase 3
            placeholder). */}
        {tab === 'month' && (
          <MonthlyFortuneView
            profileId={activeProfileId}
            targetMonth={targetMonth}
            getToken={getToken}
            isSignedIn={isSignedIn}
            isLoaded={isLoaded}
            onLoadingChange={setMonthlyIsLoading}
            onResolvedProfileId={setMonthlyResolvedProfileId}
            shareButtonRef={shareButtonRef}
            onShareReadyChange={setMonthlyShareReady}
            onAskFromCard={handleAskFromCard}
            onOpenChatFromCard={handleOpenChatFromCard}
          />
        )}
        {tab === 'year' && (
          <YearlyFortuneView
            profileId={activeProfileId}
            targetYear={targetYear}
            getToken={getToken}
            isSignedIn={isSignedIn}
            isLoaded={isLoaded}
            onLoadingChange={setYearlyIsLoading}
            onResolvedProfileId={setYearlyResolvedProfileId}
            shareButtonRef={shareButtonRef}
            onShareReadyChange={setYearlyShareReady}
            onAskFromCard={handleAskFromCard}
            onOpenChatFromCard={handleOpenChatFromCard}
          />
        )}

        {tab === 'day' && state.status === 'loading' && <LoadingSkeleton />}

        {tab === 'day' && state.status === 'error' && (
          <ErrorPanel
            code={state.code}
            statusCode={state.statusCode}
            message={state.message}
            activeTab="day"
          />
        )}

        {/* Phase Fortune Streaming: render SuccessView for BOTH 'engine'
            (engine data + per-section streaming via streamedSections) AND
            'success' (full sanitized narrative). NarrativeCard's
            `streamedSections` prop drives the hybrid render — sections
            appear one-by-one as section_complete events arrive.

            Stream-error banner (plan v2 H3): when a mid-stream error fires
            AFTER engine_ready, keep partial render but show banner above
            NarrativeCard so user knows the AI generation failed (and
            already-rendered sections remain visible). */}
        {tab === 'day' && dataState && (
          <SuccessView
            data={dataState.data}
            loadingNarrative={state.status === 'engine' && !streamError}
            streamedSections={streamedSections}
            streamError={streamError}
            shareCardRef={shareCardRef}
            shareCardArmed={shareCardArmed}
            onArmShareCard={() => setShareCardArmed(true)}
            qrDataUrl={qrDataUrl}
            onQrGenerated={setQrDataUrl}
            shareButtonRef={shareButtonRef}
            chatSectionMap={DIM_TO_CHAT_SECTION}
            onAskFromCard={handleAskFromCard}
            onOpenChatFromCard={handleOpenChatFromCard}
            onAskGeneral={handleAskGeneral}
            onOpenChatGeneral={handleOpenChatGeneral}
          />
        )}
      </FortuneShell>

      <FortuneUpgradeModal isOpen={isUpgradeOpen} onClose={() => setIsUpgradeOpen(false)} />

      {/* Phase Fortune chat — drawer + floating button.
          Mounted only when:
            - Active tab is 'day' (Phase Fortune ships DAY only)
            - Fortune data loaded successfully (we have a profileId)
            - The drawer is gated on activeProfileId presence — without a
              profile, FORTUNE chat has no subject.
          Pinned to targetDate (page's anchor) — DateNavigator changes
          spawn new sessions per plan Issue 10 (useChatSession deps
          include fortune.fortuneAnchorDate). */}
      {tab === 'day' && dataState && activeProfileId && (
        <>
          {/* Audit fix L1 — clear section hint before opening so a prior
              InlineAskCard click doesn't leak its `daily_X` hint into
              the user's next general question via the floating button. */}
          <ChatFloatingButton onClick={handleOpenChatGeneral} />
          <ChatDrawer
            isOpen={chatOpen}
            onClose={handleChatDrawerClose}
            readingType="FORTUNE"
            fortune={{
              profileId: activeProfileId,
              fortuneScope: 'DAY',
              fortuneAnchorDate: targetDate,
            }}
            initialSectionContextHint={chatSectionHint}
            pendingInitialMessage={chatPendingMessage}
            // Phase Fortune (plan Issue 6 lock) — pills POPULATE the
            // composer draft instead of auto-sending. User explicitly
            // taps send. Predictable UX + edit window.
            populateOnly
            onPendingInitialMessageConsumed={() => setChatPendingMessage(undefined)}
            onPickGeneralQuestion={handleAskGeneral}
          />
        </>
      )}

      {/* Phase 2.x L3.5b — Mount ChatDrawer on month tab too. Anchor date is
          the 1st of the targetMonth (matches NestJS createSession's
          normalization at chat.service.ts:255). fortuneScope='MONTH'
          dispatches to engine's MONTH chat-context path + M-1/M-2 refuse
          few-shots + 25 seeded MONTH sample questions. */}
      {tab === 'month' && activeProfileId && targetMonth && (
        <>
          <ChatFloatingButton onClick={handleOpenChatGeneral} />
          <ChatDrawer
            isOpen={chatOpen}
            onClose={handleChatDrawerClose}
            readingType="FORTUNE"
            fortune={{
              profileId: activeProfileId,
              fortuneScope: 'MONTH',
              fortuneAnchorDate: `${targetMonth}-01`,
            }}
            initialSectionContextHint={chatSectionHint}
            pendingInitialMessage={chatPendingMessage}
            populateOnly
            onPendingInitialMessageConsumed={() => setChatPendingMessage(undefined)}
            onPickGeneralQuestion={handleAskGeneral}
          />
        </>
      )}

      {/* Phase 3.5c L3.5c — Mount ChatDrawer on year tab. Anchor date is
          Jan 1 of targetYear (matches NestJS YEAR-scope normalization +
          fortune.service's YEAR DailyFortuneSnapshot.anchorDate). YEAR scope
          dispatches to the engine's YEAR chat-context path + Y-1/Y-2 refuse
          few-shots + 5 seeded YEAR general sample questions. activeProfileId
          folds in yearlyResolvedProfileId (surfaced from YearlyFortuneView's
          engine_ready), so the drawer mounts without ?profileId= in the URL. */}
      {tab === 'year' && activeProfileId && targetYear && (
        <>
          <ChatFloatingButton onClick={handleOpenChatGeneral} />
          <ChatDrawer
            isOpen={chatOpen}
            onClose={handleChatDrawerClose}
            readingType="FORTUNE"
            fortune={{
              profileId: activeProfileId,
              fortuneScope: 'YEAR',
              fortuneAnchorDate: `${targetYear}-01-01`,
            }}
            initialSectionContextHint={chatSectionHint}
            pendingInitialMessage={chatPendingMessage}
            populateOnly
            onPendingInitialMessageConsumed={() => setChatPendingMessage(undefined)}
            onPickGeneralQuestion={handleAskGeneral}
          />
        </>
      )}
    </>
  );
}

// ============================================================
// Sub-views
// ============================================================

interface SuccessViewProps {
  data: DailyFortuneResponse;
  /** Phase Fortune+ progressive loading: when true, engine data is rendered
   *  but the AI narrative is still being generated. NarrativeCard renders
   *  shimmer skeletons for prose sections instead of «暫不可用» fallback.
   *  Resolves to false when narrative arrives (or AI failed — fallback OK). */
  loadingNarrative?: boolean;
  /** Phase Fortune Streaming — per-section provisional content (banned-phrase
   *  stripped on the wire). Empty on cache hit + after `done` event. */
  streamedSections?: Partial<DailyFortuneNarrative>;
  /** Phase Fortune Streaming H3 — mid-stream error banner. Non-null when an
   *  error event arrived AFTER engine_ready. Rendered inline above
   *  NarrativeCard so the user knows AI generation failed while preserving
   *  already-rendered sections. */
  streamError?: { code: string; message: string } | null;
  shareCardRef: React.RefObject<HTMLDivElement | null>;
  shareCardArmed: boolean;
  onArmShareCard: () => void;
  qrDataUrl: string | null;
  onQrGenerated: (dataUrl: string) => void;
  /** Imperative handle to ShareFortuneButton so the shell's share icon
   *  can trigger the share flow without a programmatic `.click()`. */
  shareButtonRef: React.RefObject<ShareFortuneButtonHandle | null>;
  /** Phase Fortune chat — dim key → ChatSampleQuestion sectionKey map.
   *  Threaded from parent so SuccessView can render per-dim InlineAskCards
   *  under each NarrativeCard dim block. */
  chatSectionMap: Record<FortuneDimKey, string>;
  onAskFromCard: (sectionKey: string, question: string) => void;
  onOpenChatFromCard: (sectionKey: string) => void;
  onAskGeneral: (question: string) => void;
  onOpenChatGeneral: () => void;
}

function SuccessView({
  data,
  loadingNarrative = false,
  streamedSections,
  streamError,
  shareCardRef,
  shareCardArmed,
  onArmShareCard,
  qrDataUrl,
  onQrGenerated,
  shareButtonRef,
  chatSectionMap,
  onAskFromCard,
  onOpenChatFromCard,
  onAskGeneral,
  onOpenChatGeneral,
}: SuccessViewProps) {
  const { engineOutput, narrative } = data;

  return (
    <>
      <EnergyScoreRing
        label={engineOutput.auspiciousness}
        score={engineOutput.energyScore}
        date={data.date}
        dayGanZhi={engineOutput.dayGanZhi}
        dayTenGod={engineOutput.dayTenGod}
      />

      <SectionDivider />

      <DimensionBars dimensions={engineOutput.dimensions} />

      <SectionDivider />

      {/* Plan v2 H3 — stream error banner. Inline above NarrativeCard so it
          scrolls with the narrative content (not at the top of SuccessView
          which would feel disconnected from the failed section). */}
      {streamError && (
        <div className={styles.streamErrorBanner} role="status" aria-live="polite">
          <span className={styles.streamErrorIcon} aria-hidden="true">⚠️</span>
          <span>AI 解讀載入中斷，重新整理可再試一次</span>
        </div>
      )}

      <NarrativeCard
        narrative={narrative}
        dimensions={engineOutput.dimensions}
        headlinerSignals={engineOutput.headlinerSignals}
        loading={loadingNarrative}
        streamedSections={streamedSections}
        renderAfterDimension={(dimKey) => (
          <InlineAskCard
            readingType="FORTUNE"
            sectionKey={chatSectionMap[dimKey]}
            onAsk={onAskFromCard}
            onOpenChat={onOpenChatFromCard}
          />
        )}
      />

      <SectionDivider />

      {/* Phase Fortune chat — horizontal pill strip of «general» FORTUNE
          questions (sectionKey=null). Tapping a pill opens drawer +
          populates composer (does NOT auto-send per plan Issue 6). */}
      <FortuneSampleQuestions
        onAsk={onAskGeneral}
        onOpenChat={onOpenChatGeneral}
      />

      <SectionDivider />

      <FolkContentCard folkContent={engineOutput.folkContent} />

      {/* Phase 1.5 — ShareFortuneButton replaces the old SharePlaceholder.
          Lazy-mounts ShareableFortuneCard on first hover/touch/click. */}
      <ShareFortuneButton
        ref={shareButtonRef}
        shareMeta={{
          filename: fortuneShareFilename(data.date),
          shareText: `${data.date} 我的命理日運 — ${data.engineOutput.auspiciousness}`,
        }}
        idleLabel="分享今日運勢"
        cardRef={shareCardRef}
        shareCardArmed={shareCardArmed}
        onArmShareCard={onArmShareCard}
        qrDataUrl={qrDataUrl}
        onQrGenerated={onQrGenerated}
      />

      {/* Off-screen ShareableFortuneCard — mounted only after share intent.
          1200x1600 fixed-pixel container for html2canvas capture. */}
      {shareCardArmed && qrDataUrl && (
        <div className={styles.shareCardOffscreen} aria-hidden="true">
          <ShareableFortuneCard ref={shareCardRef} data={data} qrDataUrl={qrDataUrl} />
        </div>
      )}

      {/* Entertainment disclaimer (PR review #1 — CLAUDE.md compliance:
          all reading pages must render this. Pattern mirrors AIReadingDisplay
          + compatibility/page.tsx) */}
      <div className={styles.disclaimer}>
        <span className={styles.disclaimerIcon} aria-hidden="true">⚠️</span>
        <span className={styles.disclaimerText}>
          {ENTERTAINMENT_DISCLAIMER['zh-TW']}
        </span>
      </div>
    </>
  );
}

function FolkContentCard({
  folkContent,
}: {
  folkContent: DailyFortuneResponse['engineOutput']['folkContent'];
}) {
  // Defensive guard — Phase 1.5.z browser test §H1 fix (LOW): Next.js HMR
  // transients between old/new component signature occasionally pass an
  // undefined folkContent and crash the destructure with «Cannot destructure
  // property 'wealthDirection' of 'folkContent' as undefined». Production
  // navigations never reach this state (engine always emits folkContent),
  // but the dev HMR noise is annoying + the runtime cost of the guard is
  // zero. Silently render nothing — the rest of the page is unaffected.
  if (!folkContent) return null;
  const { wealthDirection, luckyColor, luckyNumber, luckyFoodFavor, luckyFoodAvoid, auspiciousHours } = folkContent;
  const showMedicalDisclaimer = !!luckyFoodAvoid;
  return (
    <section className={styles.folkSection}>
      <h3 className={styles.folkTitle}>命局層級參考</h3>
      <div className={styles.folkGrid}>
        {/* 1. 財運位 (Phase 1) */}
        <div className={styles.folkCard}>
          <div className={styles.folkIcon}>🧭</div>
          <div className={styles.folkLabel}>財運位</div>
          <div className={styles.folkValue}>{wealthDirection.direction}</div>
          <div className={styles.folkNote}>您命格適合常用的方位</div>
        </div>

        {/* 2. 吉色 (Phase 1.5.z — classical) */}
        {luckyColor && (
          <div className={styles.folkCard}>
            <div className={styles.folkIcon}>🌈</div>
            <div className={styles.folkLabel}>吉色</div>
            <div className={styles.folkValue}>
              {luckyColor.primary}
              <span className={styles.folkValueSecondary}>／{luckyColor.secondary}</span>
            </div>
            <div className={styles.folkNote}>用神（{luckyColor.element}）配色</div>
          </div>
        )}

        {/* 3. 吉數 (Phase 1.5.z — folk_tradition; visible 民俗 badge) */}
        {luckyNumber && (
          <div className={styles.folkCard}>
            <div className={styles.folkIcon}>🔢</div>
            <div className={styles.folkLabel}>
              吉數
              <span
                className={styles.folkBadge}
                title="民俗來源（河圖洛書）— 較典籍級別參考性弱"
              >
                民俗
              </span>
            </div>
            <div className={styles.folkValue}>{luckyNumber.numbers.join('、')}</div>
            <div className={styles.folkNote}>河圖五行數，民俗應用</div>
          </div>
        )}

        {/* 4. 今日宜食 (Phase 1.5.z — classical) */}
        {luckyFoodFavor && (
          <div className={styles.folkCard}>
            <div className={styles.folkIcon}>🍃</div>
            <div className={styles.folkLabel}>今日宜食</div>
            <div className={styles.folkValue}>{luckyFoodFavor.category}</div>
            <div className={styles.folkNote}>例：{luckyFoodFavor.examples.join('、')}</div>
          </div>
        )}

        {/* 5. 今日忌食 (Phase 1.5.z — classical, with reason) */}
        {luckyFoodAvoid && (
          <div className={styles.folkCard}>
            <div className={styles.folkIcon}>🚫</div>
            <div className={styles.folkLabel}>今日忌食</div>
            <div className={styles.folkValue}>{luckyFoodAvoid.category}</div>
            <div className={styles.folkNote}>{luckyFoodAvoid.reason}</div>
          </div>
        )}

        {/* 6. 今日吉時 (Phase 1.5.z — per-day, day_branch only per 協紀辨方書) */}
        {auspiciousHours.length > 0 && (
          <div className={`${styles.folkCard} ${styles.folkCardWide}`}>
            <div className={styles.folkIcon}>🕘</div>
            <div className={styles.folkLabel}>今日吉時</div>
            <div className={styles.folkHoursChips}>
              {auspiciousHours.map((h) => (
                <span key={h.branch} className={styles.folkHourChip}>
                  {h.classical_name}時 {h.branch}（{h.hour_range}）
                </span>
              ))}
            </div>
            <div className={styles.folkNote}>協紀辨方書 卷十 黃道時辰</div>
          </div>
        )}
      </div>

      {showMedicalDisclaimer && (
        <div className={styles.folkMedicalDisclaimer}>
          <span aria-hidden="true">ℹ️</span>{' '}
          飲食建議僅為命理參考，不取代醫療建議。如有特殊體質或健康狀況，請諮詢專業醫師。
        </div>
      )}
    </section>
  );
}

// Sprint 4 SharePlaceholder removed in Phase 1.5 — replaced by
// <ShareFortuneButton /> inside <SuccessView />. The old disabled placeholder
// was deleted to keep the page tree clean.

// ChatCTA placeholder removed in Phase Fortune chat ship.
// Replaced by:
//   - <FortuneSampleQuestions> strip inside <SuccessView> (sectionKey=null)
//   - <ChatFloatingButton> mounted at FortuneView's top level
//   - <ChatDrawer readingType="FORTUNE" fortune={{...}}> page-level mount
// Per-dim <InlineAskCard> components wire via NarrativeCard's
// renderAfterDimension slot.

function LoadingSkeleton() {
  return (
    <div className={styles.skeletonWrap}>
      <div className={styles.skeletonRing} />
      <div className={styles.skeletonBars} />
      <div className={styles.skeletonText} />
      <div className={styles.skeletonText} />
      <div className={styles.skeletonText} style={{ width: '70%' }} />
    </div>
  );
}

// PartialPreview removed in Phase 3 — both month (Phase 2) and year (Phase 3)
// tabs now render real views (MonthlyFortuneView / YearlyFortuneView). The
// cross-sell to 《八字流年運勢》 lives in <YearlyCrossSellCard> within the
// yearly view.

// ============================================================
// Phase 2 月運 (L5) — MonthlyFortuneView
// ============================================================
// Phase 2.x — Monthly streaming. Renders MonthlyEnergyRing +
// MonthlyDimensionBars + MonthlyTimeGrid + MonthlyNarrativeCard
// progressively as the SSE stream arrives:
//   - engine_ready (~1s) → engine state, Ring/Bars/TimeGrid paint immediately
//   - section_complete × N → MonthlyNarrativeCard reveals each section
//   - done → final sanitized narrative
//
// State machine: loading → engine → success → error. Plan v3 NEW-M1:
// cacheHit consumed from engine_ready event payload (not hardcoded false).
// Plan v3 NEW-H1: done handler spreads prev.data to preserve intraMonthBreakdown
// (single canonical source on engine_ready event).
//
// Stream-error banner: plan v3 L5 — when streamError non-null + state.status==='engine',
// show banner above MonthlyNarrativeCard but preserve already-arrived sections.

/** Phase 2.x HIGH H-1 audit fix — whitelist of valid section keys the AI may
 *  emit inside `MonthlyFortuneNarrative`. Used by MonthlyFortuneView's
 *  `section_complete` handler to drop cross-scope keys (e.g., daily_*) that
 *  could pollute state if the backend ever drifts. */
const MONTHLY_NARRATIVE_KEYS = new Set<string>([
  'monthly_overview',
  'monthly_career',
  'monthly_career_takeaway',
  'monthly_finance',
  'monthly_finance_takeaway',
  'monthly_romance',
  'monthly_romance_takeaway',
  'monthly_health',
  'monthly_health_takeaway',
  'monthly_advice',
  'intra_month_breakdown',
]);

type MonthlyFortuneViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'engine'; data: MonthlyFortuneResponse }
  | { status: 'success'; data: MonthlyFortuneResponse }
  | { status: 'error'; code: string; statusCode: number; message: string };

interface MonthlyFortuneViewProps {
  profileId: string | undefined;
  targetMonth: string;
  getToken: () => Promise<string | null>;
  isSignedIn: boolean | undefined;
  isLoaded: boolean;
  /** Audit fix MEDIUM #8 — publish loading state UP so MonthNavigator
   *  can render disabled arrows during in-flight fetch. */
  onLoadingChange?: (isLoading: boolean) => void;
  /** Phase 2.x L3.5b — publish the resolved profileId (from engine_ready event)
   *  UP so the page-level ChatDrawer mount can use it as `fortune.profileId`
   *  when user navigated without ?profileId= (NestJS resolves user's primary). */
  onResolvedProfileId?: (profileId: string) => void;
  /** Tier B1 share — parent-owned imperative handle to the month
   *  ShareFortuneButton (lets the shell's top-right share icon invoke
   *  triggerShare(); only one tab's button is mounted at a time, so the
   *  parent reuses the same ref). */
  shareButtonRef?: React.RefObject<ShareFortuneButtonHandle | null>;
  /** Tier B1 share — publish share-readiness UP (true only on success);
   *  the shell-icon gate reads this so PNG capture never includes a
   *  provisional/streaming narrative. */
  onShareReadyChange?: (ready: boolean) => void;
  /** MONTH per-dim parity (mirror Tier B2 YEAR) — per-dim InlineAskCard
   *  handlers (reuse the page-level chat open/populate handlers; same ones
   *  daily's SuccessView + YearlyFortuneView receive). Tapping a month per-dim
   *  card opens the page-level MONTH ChatDrawer with the `monthly_*`
   *  sectionContextHint. */
  onAskFromCard?: (sectionKey: string, question: string) => void;
  onOpenChatFromCard?: (sectionKey: string) => void;
}

/** MONTH per-dim parity (mirror YEARLY_DIM_TO_CHAT_SECTION) — month dim key →
 *  ChatSampleQuestion sectionKey (monthly_*). 4 dims, no travel (month scope). */
const MONTHLY_DIM_TO_CHAT_SECTION: Record<'career' | 'finance' | 'romance' | 'health', string> = {
  career: 'monthly_career',
  finance: 'monthly_finance',
  romance: 'monthly_romance',
  health: 'monthly_health',
};

function MonthlyFortuneView({
  profileId,
  targetMonth,
  getToken: _getToken,
  isSignedIn,
  isLoaded,
  onLoadingChange,
  onResolvedProfileId,
  shareButtonRef,
  onShareReadyChange,
  onAskFromCard,
  onOpenChatFromCard,
}: MonthlyFortuneViewProps) {
  const [state, setState] = useState<MonthlyFortuneViewState>({ status: 'idle' });
  const [streamedSections, setStreamedSections] = useState<
    Partial<MonthlyFortuneNarrative>
  >({});
  const [streamError, setStreamError] = useState<{ code: string; message: string } | null>(
    null,
  );

  // Tier B1 share state — self-contained inside the month view (parent owns
  // only the shared shareButtonRef). Lazy-mount ShareableMonthlyFortuneCard
  // until share intent fires, and only on state.status === 'success' so the
  // PNG never captures a provisional narrative. Mirror of YearlyFortuneView.
  const [mShareArmed, setMShareArmed] = useState(false);
  const [mQrDataUrl, setMQrDataUrl] = useState<string | null>(null);
  const mShareCardRef = useRef<HTMLDivElement>(null);

  // CRITICAL C-1 audit fix — keep `state` accessible via ref so the onEvent
  // callback can read the CURRENT state.status when classifying error events.
  // Without this, the callback closes over a stale snapshot at the render
  // where it was created, causing mid-engine errors to wrongly transition to
  // terminal 'error' state (wiping arrived engine data) in rapid event sequences.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Reset state synchronously when month/profile changes (plan v3 + audit HIGH #5
  // parity with prior non-streaming impl). Hook's cancelled guard + effect deps
  // handle the stream abort.
  useEffect(() => {
    setState({ status: 'loading' });
    setStreamedSections({});
    setStreamError(null);
  }, [profileId, targetMonth]);

  // Publish loading state up (audit MEDIUM #8). MonthNavigator disables arrows
  // when stream hasn't reached 'engine' state yet.
  useEffect(() => {
    onLoadingChange?.(state.status === 'loading');
  }, [state.status, onLoadingChange]);

  // Tier B1 — surface share-readiness UP. True ONLY on success (PNG-safety:
  // the shell share-icon gate reads this so capture never includes a
  // provisional/streaming narrative). Mirror of YearlyFortuneView.
  useEffect(() => {
    onShareReadyChange?.(state.status === 'success');
  }, [state.status, onShareReadyChange]);

  useFortuneNarrativeStream({
    enabled: !!isLoaded && !!isSignedIn,
    scope: 'month',
    profileId,
    month: targetMonth,
    onEvent: (ev) => {
      if (ev.type === 'engine_ready' && 'month' in ev) {
        // engine_ready arrived — render Ring/Bars/TimeGrid immediately.
        // Plan v3 NEW-M1: cacheHit consumed from event payload (not hardcoded).
        setState({
          status: 'engine',
          data: {
            month: ev.month,
            flowYear: ev.flowYear,
            profileId: ev.profileId,
            profileBirthDate: ev.profileBirthDate,
            profileBirthTime: ev.profileBirthTime,
            engineOutput: ev.engineOutput,
            narrative: null,
            intraMonthBreakdown: ev.intraMonthBreakdown,
            cacheHit: ev.cacheHit,
            generatedAt: new Date().toISOString(),
          },
        });
        // Phase 2.x L3.5b — publish resolved profileId UP so the page-level
        // ChatDrawer mount can use it as `fortune.profileId` even when the
        // user didn't pass ?profileId= in URL (NestJS resolved user's primary).
        onResolvedProfileId?.(ev.profileId);
      } else if (ev.type === 'section_complete') {
        // Provisional per-section text — MonthlyNarrativeCard hybrid render
        // pulls from this until `done` event delivers sanitized narrative.
        //
        // HIGH H-1 audit fix — whitelist the section key. Backend should never
        // emit cross-scope keys (e.g., `daily_*` in a monthly stream), but
        // defensive validation against MonthlyFortuneNarrative key set catches
        // any contract drift. Unknown keys are dropped silently with a console
        // warn so devs notice during regression.
        if (MONTHLY_NARRATIVE_KEYS.has(ev.key)) {
          setStreamedSections((prev) => ({
            ...prev,
            [ev.key]: ev.value as never,
          }));
        } else if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.warn(
            `[MonthlyFortuneView] dropped section_complete with unknown key: ${ev.key}`,
          );
        }
      } else if (ev.type === 'done') {
        // Plan v3 NEW-H1 fix: spread prev.data to preserve intraMonthBreakdown +
        // cacheHit from engine_ready (single canonical source). Do NOT read
        // ev.intraMonthBreakdown — `done` event no longer carries it.
        // The umbrella `done` event is identical across scopes, so cast to the
        // MONTH narrative shape (we're in the month-tab handler).
        const monthlyNarrative = ev.narrative as MonthlyFortuneNarrative | null;
        const doneCacheHit = ev.cacheHit;
        setState((prev) => {
          if (prev.status !== 'engine') return prev;
          return {
            status: 'success',
            data: {
              ...prev.data,
              narrative: monthlyNarrative,
              // Defensive: doneCacheHit and prev.data.cacheHit should always agree
              // (same server path emitted both). `??` guards against runtime undefined.
              cacheHit: doneCacheHit ?? prev.data.cacheHit,
            },
          };
        });
        setStreamedSections({});
      } else if (ev.type === 'error') {
        // Plan v3 L5 — pre-flight errors (subscription gate, profile not found)
        // map to terminal 'error' state. Mid-stream errors (AI failure / truncation)
        // set streamError but preserve partial 'engine' render.
        //
        // CRITICAL C-1 audit fix: read CURRENT state.status via the stateRef
        // (not the stale snapshot from when this onEvent callback was created).
        // Without this, rapid engine_ready → error sequences could mis-classify
        // — terminal error wipes already-arrived engine data instead of showing
        // the soft banner. Pattern mirrors daily handler.
        //
        // HIGH H-3 audit fix: when transitioning to terminal error, clear any
        // stale streamError so the banner doesn't ghost-render.
        const currentStatus = stateRef.current.status;
        if (currentStatus === 'engine') {
          setStreamError({ code: ev.code, message: ev.message });
        } else {
          setStreamError(null);
          setState({
            status: 'error',
            code: ev.code,
            statusCode: ev.code.startsWith('HTTP_') ? Number(ev.code.slice(5)) : 0,
            message: ev.message,
          });
        }
      }
    },
  });

  // Audit fix CRITICAL #1 (2026-05-28): render the FULL skeletal layout
  // in loading state, NOT just MonthlyNarrativeCard alone. Plan v2 H4
  // invariant («disclaimer Y delta ≤8px» on loading→success transition)
  // was violated because loading only rendered the narrative card while
  // success rendered Ring + Bars + TimeGrid + NarrativeCard + disclaimer
  // — disclaimer Y shifted hundreds of pixels.
  //
  // The skeleton stack matches the success-state structure:
  //   - MonthlyEnergyRing (placeholder with skeleton class)
  //   - SectionDivider
  //   - MonthlyDimensionBars (placeholder with skeleton class)
  //   - SectionDivider
  //   - MonthlyTimeGrid (placeholder — no breakdown data yet)
  //   - SectionDivider
  //   - MonthlyNarrativeCard (its internal skeleton)
  //   - ENTERTAINMENT_DISCLAIMER
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className={styles.monthlyContentWrap}>
        <div className={styles.monthlyRingPlaceholder} aria-busy="true" aria-label="本月運勢載入中" />
        <SectionDivider />
        <div className={styles.monthlyBarsPlaceholder} aria-hidden="true" />
        <SectionDivider />
        <div className={styles.monthlyTimeGridPlaceholder} aria-hidden="true" />
        <SectionDivider />
        <MonthlyNarrativeCard
          narrative={null}
          dimensions={{
            career: { score: 50, label: '平穩' },
            finance: { score: 50, label: '平穩' },
            romance: { score: 50, label: '平穩' },
            health: { score: 50, label: '平穩' },
          }}
          loading
        />
        <p className={styles.monthlyBottomDisclaimer}>
          {ENTERTAINMENT_DISCLAIMER['zh-TW']}
        </p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <ErrorPanel
        code={state.code}
        statusCode={state.statusCode}
        message={state.message}
        activeTab="month"
      />
    );
  }

  // 'engine' OR 'success' — both render the real component stack. Difference:
  //   'engine': narrative=null + streamedSections (hybrid render in NarrativeCard)
  //   'success': full sanitized narrative
  const { engineOutput, narrative, intraMonthBreakdown } = state.data;
  // Strip labelZh from dimensions for MonthlyNarrativeCard's simpler shape
  const dimensionsForNarrative = {
    career: {
      score: engineOutput.dimensions.career.score,
      label: engineOutput.dimensions.career.label,
    },
    finance: {
      score: engineOutput.dimensions.finance.score,
      label: engineOutput.dimensions.finance.label,
    },
    romance: {
      score: engineOutput.dimensions.romance.score,
      label: engineOutput.dimensions.romance.label,
    },
    health: {
      score: engineOutput.dimensions.health.score,
      label: engineOutput.dimensions.health.label,
    },
  };

  return (
    <div className={styles.monthlyContentWrap}>
      <MonthlyEnergyRing
        label={engineOutput.auspiciousness}
        score={engineOutput.energyScore}
        month={state.data.month}
        monthGanZhi={engineOutput.monthGanZhi}
        monthTenGod={engineOutput.monthTenGod}
      />

      <SectionDivider />

      <MonthlyDimensionBars dimensions={engineOutput.dimensions} />

      <SectionDivider />

      <MonthlyTimeGrid
        partitionSpec={engineOutput.partitionSpec}
        intraMonthBreakdown={intraMonthBreakdown}
        monthStem={engineOutput.monthStem}
        monthBranch={engineOutput.monthBranch}
      />

      <SectionDivider />

      {/* Plan v3 L5 — stream-error banner above MonthlyNarrativeCard. Shows
       *  when streamError set (mid-stream AI/network failure) but preserves
       *  partial render of already-arrived sections. Reuses daily's CSS classes. */}
      {streamError && (
        <div className={styles.streamErrorBanner} role="alert">
          <span className={styles.streamErrorIcon} aria-hidden="true">⚠️</span>
          <span>AI 解讀載入中斷，重新整理可再試一次</span>
        </div>
      )}

      <MonthlyNarrativeCard
        narrative={narrative}
        dimensions={dimensionsForNarrative}
        loading={state.status === 'engine' && !streamError}
        streamedSections={
          state.status === 'engine' ? streamedSections : undefined
        }
        renderAfterDimension={
          onAskFromCard
            ? (dimKey) => (
                <InlineAskCard
                  readingType="FORTUNE"
                  sectionKey={MONTHLY_DIM_TO_CHAT_SECTION[dimKey]}
                  fortuneScope="MONTH"
                  onAsk={onAskFromCard}
                  onOpenChat={onOpenChatFromCard}
                />
              )
            : undefined
        }
      />

      {/* Tier B1 share — mounted ONLY on success (PNG-safety: never capture a
          provisional/streaming narrative). The inline button is the primary
          affordance; the FortuneShell top-right icon triggers the same flow
          via the parent-owned shareButtonRef. Mirror of YearlyFortuneView. */}
      {state.status === 'success' && (
        <>
          <SectionDivider />
          <ShareFortuneButton
            ref={shareButtonRef}
            shareMeta={{
              filename: `fortune-month-${state.data.month}.png`,
              shareText: `${state.data.month} 我的命理月運 — ${engineOutput.auspiciousness}`,
            }}
            idleLabel="分享本月運勢"
            cardRef={mShareCardRef}
            shareCardArmed={mShareArmed}
            onArmShareCard={() => setMShareArmed(true)}
            qrDataUrl={mQrDataUrl}
            onQrGenerated={setMQrDataUrl}
          />
          {/* Off-screen ShareableMonthlyFortuneCard — mounted only after share
              intent. 1200×1600 fixed-pixel container for html2canvas capture. */}
          {mShareArmed && mQrDataUrl && (
            <div className={styles.shareCardOffscreen} aria-hidden="true">
              <ShareableMonthlyFortuneCard ref={mShareCardRef} data={state.data} qrDataUrl={mQrDataUrl} />
            </div>
          )}
        </>
      )}

      <p className={styles.monthlyBottomDisclaimer}>
        {ENTERTAINMENT_DISCLAIMER['zh-TW']}
      </p>
    </div>
  );
}

// ============================================================
// Phase 3 年運 — YearlyFortuneView
// ============================================================
// Mirror of MonthlyFortuneView. Renders YearlyEnergyRing + YearlyDimensionStars
// + YearlyRiskOpportunityGrid + YearlyNarrativeCard + YearlyLuckMethodsCard +
// YearlyCrossSellCard progressively as the SSE stream arrives:
//   - engine_ready (~1s) → engine state, Ring/Stars/RiskOpp/LuckMethods paint
//   - section_complete × N → YearlyNarrativeCard reveals each AI prose section
//   - done → final sanitized narrative
//
// State machine: loading → engine → success → error. Mirrors monthly's
// cacheHit-from-event + done-spreads-prev.data + stateRef-stale-closure fixes.

/** Whitelist of valid section keys the AI may emit inside YearlyFortuneNarrative.
 *  Drops cross-scope keys (e.g., monthly_*) if the backend ever drifts. */
const YEARLY_NARRATIVE_KEYS = new Set<string>([
  'yearly_headline',
  'yearly_overview',
  'yearly_career',
  'yearly_career_keyword',
  'yearly_finance',
  'yearly_finance_keyword',
  'yearly_romance',
  'yearly_romance_keyword',
  'yearly_health',
  'yearly_health_keyword',
  'yearly_advice',
  'yearly_risk_opportunities',
]);

type YearlyFortuneViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'engine'; data: YearlyFortuneResponse }
  | { status: 'success'; data: YearlyFortuneResponse }
  | { status: 'error'; code: string; statusCode: number; message: string };

interface YearlyFortuneViewProps {
  profileId: string | undefined;
  targetYear: string;
  getToken: () => Promise<string | null>;
  isSignedIn: boolean | undefined;
  isLoaded: boolean;
  /** Publish loading state UP so YearNavigator can disable arrows. */
  onLoadingChange?: (isLoading: boolean) => void;
  /** Publish resolved profileId (from engine_ready) UP. Surfaced for
   *  year-scope chat (L3.5c). */
  onResolvedProfileId?: (profileId: string) => void;
  /** Parent-owned imperative handle to the year ShareFortuneButton — lets
   *  FortuneShell's top-right share icon invoke triggerShare() (preserves
   *  iOS user-gesture). Only one tab's button is mounted at a time, so the
   *  parent reuses the same ref it owns for the daily SuccessView. */
  shareButtonRef?: React.RefObject<ShareFortuneButtonHandle | null>;
  /** Publish share-readiness UP (true only on success). The shell-icon gate
   *  reads this for the year tab — PNG capture must never include a
   *  provisional/streaming narrative. */
  onShareReadyChange?: (ready: boolean) => void;
  /** Tier B2 — per-dim InlineAskCard handlers (reuse the page-level chat
   *  open/populate handlers; same ones daily's SuccessView receives). Tapping
   *  a year per-dim card opens the page-level YEAR ChatDrawer with the
   *  `yearly_*` sectionContextHint. */
  onAskFromCard?: (sectionKey: string, question: string) => void;
  onOpenChatFromCard?: (sectionKey: string) => void;
}

/** Tier B2 — year dim key → ChatSampleQuestion sectionKey (yearly_*). Mirrors
 *  DIM_TO_CHAT_SECTION (daily). 4 dims, no travel (year scope). */
const YEARLY_DIM_TO_CHAT_SECTION: Record<'career' | 'finance' | 'romance' | 'health', string> = {
  career: 'yearly_career',
  finance: 'yearly_finance',
  romance: 'yearly_romance',
  health: 'yearly_health',
};

function YearlyFortuneView({
  profileId,
  targetYear,
  getToken: _getToken,
  isSignedIn,
  isLoaded,
  onLoadingChange,
  onResolvedProfileId,
  shareButtonRef,
  onShareReadyChange,
  onAskFromCard,
  onOpenChatFromCard,
}: YearlyFortuneViewProps) {
  const [state, setState] = useState<YearlyFortuneViewState>({ status: 'idle' });
  const [streamedSections, setStreamedSections] = useState<
    Partial<YearlyFortuneNarrative>
  >({});
  const [streamError, setStreamError] = useState<{ code: string; message: string } | null>(
    null,
  );

  // Share state — self-contained inside the year view (the parent only owns
  // the shared shareButtonRef). Lazy-mount the heavy ShareableYearlyFortuneCard
  // until share intent fires (hover/touch/click), and only when state.status
  // === 'success' so the PNG never captures a provisional narrative.
  const [yShareArmed, setYShareArmed] = useState(false);
  const [yQrDataUrl, setYQrDataUrl] = useState<string | null>(null);
  const yShareCardRef = useRef<HTMLDivElement>(null);

  // stateRef — keep current state.status readable in the onEvent closure so
  // error classification reads CURRENT status (not the stale snapshot). Mirror
  // of MonthlyFortuneView's CRITICAL C-1 audit fix.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Reset synchronously when year/profile changes.
  useEffect(() => {
    setState({ status: 'loading' });
    setStreamedSections({});
    setStreamError(null);
  }, [profileId, targetYear]);

  useEffect(() => {
    onLoadingChange?.(state.status === 'loading');
  }, [state.status, onLoadingChange]);

  // Surface share-readiness UP. True ONLY on success — the shell share icon
  // gate (parent) reads this so PNG capture never includes a streaming/
  // provisional narrative (PNG-safety, mirrors the daily success-only gate).
  useEffect(() => {
    onShareReadyChange?.(state.status === 'success');
  }, [state.status, onShareReadyChange]);

  useFortuneNarrativeStream({
    enabled: !!isLoaded && !!isSignedIn,
    scope: 'year',
    profileId,
    year: targetYear,
    onEvent: (ev) => {
      if (ev.type === 'engine_ready' && 'year' in ev) {
        setState({
          status: 'engine',
          data: {
            year: ev.year,
            profileId: ev.profileId,
            profileBirthDate: ev.profileBirthDate,
            profileBirthTime: ev.profileBirthTime,
            engineOutput: ev.engineOutput,
            narrative: null,
            cacheHit: ev.cacheHit,
            generatedAt: new Date().toISOString(),
          },
        });
        onResolvedProfileId?.(ev.profileId);
      } else if (ev.type === 'section_complete') {
        if (YEARLY_NARRATIVE_KEYS.has(ev.key)) {
          setStreamedSections((prev) => ({
            ...prev,
            [ev.key]: ev.value as never,
          }));
        } else if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.warn(
            `[YearlyFortuneView] dropped section_complete with unknown key: ${ev.key}`,
          );
        }
      } else if (ev.type === 'done') {
        // The umbrella `done` event is structurally identical across all
        // scopes ({type, narrative, cacheHit}), so TS can't discriminate it
        // to the YEAR variant by an `in` check. We're in scope='year' here,
        // so the narrative IS YearlyFortuneNarrative — cast explicitly. This
        // mirrors the daily/monthly handler pattern (the section_complete +
        // engine_ready guards above already pin scope='year').
        const yearlyNarrative = ev.narrative as YearlyFortuneNarrative | null;
        const doneCacheHit = ev.cacheHit;
        setState((prev) => {
          if (prev.status !== 'engine') return prev;
          return {
            status: 'success',
            data: {
              ...prev.data,
              narrative: yearlyNarrative,
              cacheHit: doneCacheHit ?? prev.data.cacheHit,
            },
          };
        });
        setStreamedSections({});
      } else if (ev.type === 'error') {
        const currentStatus = stateRef.current.status;
        if (currentStatus === 'engine') {
          setStreamError({ code: ev.code, message: ev.message });
        } else {
          setStreamError(null);
          setState({
            status: 'error',
            code: ev.code,
            statusCode: ev.code.startsWith('HTTP_') ? Number(ev.code.slice(5)) : 0,
            message: ev.message,
          });
        }
      }
    },
  });

  // Loading skeleton — full layout footprint so disclaimer Y stays stable.
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className={styles.monthlyContentWrap}>
        <div className={styles.monthlyRingPlaceholder} aria-busy="true" aria-label="今年運勢載入中" />
        <SectionDivider />
        <div className={styles.monthlyBarsPlaceholder} aria-hidden="true" />
        <SectionDivider />
        <div className={styles.monthlyTimeGridPlaceholder} aria-hidden="true" />
        <SectionDivider />
        <YearlyNarrativeCard
          narrative={null}
          dimensions={{
            career: { score: 50, label: '平穩' },
            finance: { score: 50, label: '平穩' },
            romance: { score: 50, label: '平穩' },
            health: { score: 50, label: '平穩' },
          }}
          loading
        />
        <p className={styles.monthlyBottomDisclaimer}>
          {ENTERTAINMENT_DISCLAIMER['zh-TW']}
        </p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <ErrorPanel
        code={state.code}
        statusCode={state.statusCode}
        message={state.message}
        activeTab="year"
      />
    );
  }

  // 'engine' OR 'success' — both render the real component stack.
  const { engineOutput, narrative } = state.data;
  const dimensionsForNarrative = {
    career: {
      score: engineOutput.dimensions.career.score,
      label: engineOutput.dimensions.career.label,
    },
    finance: {
      score: engineOutput.dimensions.finance.score,
      label: engineOutput.dimensions.finance.label,
    },
    romance: {
      score: engineOutput.dimensions.romance.score,
      label: engineOutput.dimensions.romance.label,
    },
    health: {
      score: engineOutput.dimensions.health.score,
      label: engineOutput.dimensions.health.label,
    },
  };

  // Per-dim AI keyword selector (narrative > provisional). Feeds the star cards.
  const keywordSource = narrative ?? streamedSections;
  const dimKeywords: Partial<Record<YearlyDimKey, string | undefined>> = {
    career: keywordSource?.yearly_career_keyword,
    finance: keywordSource?.yearly_finance_keyword,
    romance: keywordSource?.yearly_romance_keyword,
    health: keywordSource?.yearly_health_keyword,
  };

  // AI risk/opportunity entries (narrative > provisional) paired by index in
  // the grid component.
  const aiRiskOppEntries =
    narrative?.yearly_risk_opportunities ??
    streamedSections?.yearly_risk_opportunities ??
    undefined;

  return (
    <div className={styles.monthlyContentWrap}>
      <YearlyEnergyRing
        label={engineOutput.auspiciousness}
        score={engineOutput.energyScore}
        year={state.data.year}
        yearGanZhi={engineOutput.yearGanZhi}
        yearTenGod={engineOutput.yearTenGod}
      />

      <SectionDivider />

      <YearlyDimensionStars
        dimensions={engineOutput.dimensions}
        keywords={dimKeywords}
      />

      <SectionDivider />

      <YearlyRiskOpportunityGrid
        coreRiskOpportunity={engineOutput.coreRiskOpportunity}
        aiEntries={aiRiskOppEntries}
      />

      <SectionDivider />

      {streamError && (
        <div className={styles.streamErrorBanner} role="alert">
          <span className={styles.streamErrorIcon} aria-hidden="true">⚠️</span>
          <span>AI 解讀載入中斷，重新整理可再試一次</span>
        </div>
      )}

      <YearlyNarrativeCard
        narrative={narrative}
        dimensions={dimensionsForNarrative}
        loading={state.status === 'engine' && !streamError}
        streamedSections={
          state.status === 'engine' ? streamedSections : undefined
        }
        renderAfterDimension={
          onAskFromCard
            ? (dimKey) => (
                <InlineAskCard
                  readingType="FORTUNE"
                  sectionKey={YEARLY_DIM_TO_CHAT_SECTION[dimKey]}
                  fortuneScope="YEAR"
                  onAsk={onAskFromCard}
                  onOpenChat={onOpenChatFromCard}
                />
              )
            : undefined
        }
      />

      <SectionDivider />

      <YearlyLuckMethodsCard luckMethods={engineOutput.luckMethods} />

      <SectionDivider />

      <YearlyCrossSellCard />

      {/* Phase 3 share — mounted ONLY on success (PNG-safety: never capture a
          provisional/streaming narrative). The visible inline button is the
          primary share affordance; the FortuneShell top-right icon triggers
          the same flow via the parent-owned shareButtonRef. */}
      {state.status === 'success' && (
        <>
          <SectionDivider />
          <ShareFortuneButton
            ref={shareButtonRef}
            shareMeta={{
              filename: `fortune-year-${state.data.year}.png`,
              shareText: `${state.data.year}年 我的命理年運 — ${engineOutput.auspiciousness}`,
            }}
            idleLabel="分享今年運勢"
            cardRef={yShareCardRef}
            shareCardArmed={yShareArmed}
            onArmShareCard={() => setYShareArmed(true)}
            qrDataUrl={yQrDataUrl}
            onQrGenerated={setYQrDataUrl}
          />
          {/* Off-screen ShareableYearlyFortuneCard — mounted only after share
              intent. 1200×1600 fixed-pixel container for html2canvas capture. */}
          {yShareArmed && yQrDataUrl && (
            <div className={styles.shareCardOffscreen} aria-hidden="true">
              <ShareableYearlyFortuneCard ref={yShareCardRef} data={state.data} qrDataUrl={yQrDataUrl} />
            </div>
          )}
        </>
      )}

      <p className={styles.monthlyBottomDisclaimer}>
        {ENTERTAINMENT_DISCLAIMER['zh-TW']}
      </p>
    </div>
  );
}

function ErrorPanel({
  code,
  statusCode,
  message,
  activeTab,
}: {
  code: string;
  statusCode: number;
  message: string;
  /**
   * Active tab when this error rendered. Drives scope-aware OUT_OF_WINDOW copy
   * + CTA (Phase 2.x #84 fix). Defaults to 'day' for back-compat with day-only
   * callers that don't yet thread the prop.
   */
  activeTab?: 'day' | 'month' | 'year';
}) {
  const tab = activeTab ?? 'day';

  // Audit #2: branch SUBSCRIBER_ONLY (free user) vs OUT_OF_WINDOW
  // (subscriber asking for date outside +30/−1 day window). The latter
  // user IS a subscriber — telling them to "subscribe" is wrong.
  if (code === 'SUBSCRIBER_ONLY') {
    // Same paywall regardless of scope; copy intentionally neutral.
    return (
      <div className={styles.errorWrap}>
        <div className={styles.errorIcon}>🔒</div>
        <h2 className={styles.errorTitle}>限訂閱用戶查看</h2>
        <p className={styles.errorBody}>
          {tab === 'month'
            ? '免費用戶僅可查看「本月」的月運。訂閱後即可查看「上個月 + 本月 + 未來 12 個月」範圍。'
            : tab === 'year'
            ? '免費用戶僅可查看「今年」的年運。訂閱後即可查看「去年 + 今年 + 未來 4 年」範圍。'
            : '免費用戶僅可查看「今日」的日運。訂閱後即可查看「昨日 + 未來 30 天」範圍。'}
        </p>
        <Link href="/pricing" className={styles.errorAction}>
          查看訂閱方案 →
        </Link>
      </div>
    );
  }

  if (code === 'OUT_OF_WINDOW') {
    // Phase 2.x #84 fix — dispatch copy + CTA by tab.
    if (tab === 'month') {
      return (
        <div className={styles.errorWrap}>
          <div className={styles.errorIcon}>📅</div>
          <h2 className={styles.errorTitle}>超出查詢範圍</h2>
          <p className={styles.errorBody}>
            月運可查範圍為「上個月 + 本月 + 未來 12 個月」。請選擇此範圍內的月份。
          </p>
          <Link href="/reading/fortune?tab=month" className={styles.errorAction}>
            回到本月 →
          </Link>
        </div>
      );
    }
    // Phase 3 — year OUT_OF_WINDOW copy + CTA.
    if (tab === 'year') {
      return (
        <div className={styles.errorWrap}>
          <div className={styles.errorIcon}>📅</div>
          <h2 className={styles.errorTitle}>超出查詢範圍</h2>
          <p className={styles.errorBody}>
            年運可查範圍為「去年 + 今年 + 未來 4 年」。請選擇此範圍內的年份。
          </p>
          <Link href="/reading/fortune?tab=year" className={styles.errorAction}>
            回到今年 →
          </Link>
        </div>
      );
    }
    // Day fall-through.
    return (
      <div className={styles.errorWrap}>
        <div className={styles.errorIcon}>📅</div>
        <h2 className={styles.errorTitle}>超出查詢範圍</h2>
        <p className={styles.errorBody}>
          日運可查範圍為「昨日 + 今日 + 未來 30 天」。請選擇此範圍內的日期。
        </p>
        <Link href="/reading/fortune?tab=day" className={styles.errorAction}>
          回到今日 →
        </Link>
      </div>
    );
  }

  if (code === 'NO_PRIMARY_PROFILE' || code === 'PROFILE_NOT_FOUND' || statusCode === 404) {
    // Phase 2.x L-2 fix — genericize «日運功能» → «運勢功能» so the missing-profile
    // screen reads cleanly on any tab (day/month/year).
    return (
      <div className={styles.errorWrap}>
        <div className={styles.errorIcon}>📝</div>
        <h2 className={styles.errorTitle}>找不到出生資料</h2>
        <p className={styles.errorBody}>請先建立您的出生資料後再使用運勢功能。</p>
        <Link href="/dashboard/profiles" className={styles.errorAction}>
          前往建立出生資料 →
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.errorWrap}>
      <div className={styles.errorIcon}>⚠️</div>
      <h2 className={styles.errorTitle}>暫時無法載入運勢</h2>
      <p className={styles.errorBody}>{message}</p>
      <p className={styles.errorMeta}>
        錯誤碼：{code} ({statusCode})
      </p>
    </div>
  );
}

// formatShortDate helper removed (R1.10) — date now formatted inside
// EnergyScoreRing via labels.ts::formatFortuneDate. Subheader no longer
// shows a date.
