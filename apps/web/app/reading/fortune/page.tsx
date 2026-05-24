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
import ShareFortuneButton, {
  type ShareFortuneButtonHandle,
} from '../../components/fortune/ShareFortuneButton';
import FortuneSampleQuestions from '../../components/fortune/FortuneSampleQuestions';
import ChatDrawer from '../../components/chat/ChatDrawer';
import ChatFloatingButton from '../../components/chat/ChatFloatingButton';
import InlineAskCard from '../../components/chat/InlineAskCard';
import type { FortuneDimKey } from '../../components/fortune/NarrativeCard';
import {
  fetchDailyFortune,
  resolveBaziToday,
  FortuneApiError,
  type DailyFortuneResponse,
} from '../../lib/fortune-api';
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

  const handleSwitchProfile = useCallback(
    (nextProfileId: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('profileId', nextProfileId);
      // Drop stale date when switching profiles — fresh start with new chart
      params.delete('date');
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

  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; data: DailyFortuneResponse }
    | { status: 'error'; code: string; message: string; statusCode: number }
  >({ status: 'idle' });

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (tab !== 'day') return;     // Phase 1: only daily fetches data

    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setState({
            status: 'error',
            code: 'NO_TOKEN',
            statusCode: 401,
            message: '請重新登入',
          });
          return;
        }
        const data = await fetchDailyFortune({ token, profileId, date: targetDate });
        if (!cancelled) setState({ status: 'success', data });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof FortuneApiError) {
          setState({
            status: 'error',
            statusCode: err.status,
            code: err.code,
            message: err.message,
          });
        } else {
          setState({
            status: 'error',
            statusCode: 0,
            code: 'NETWORK',
            message: (err as Error).message ?? '網路錯誤',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken, profileId, targetDate, tab]);

  // Note: Date moved INTO EnergyScoreRing (UX Sprint 1 R1.2 / S1.1).
  // The subheader no longer renders a date — kept just for profile chip.

  // Active profile for the switcher (matches URL `profileId` else primary fallback)
  const activeProfileId =
    profileId ?? (state.status === 'success' ? state.data.profileId : undefined);

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

  // Build the DateNavigator slot — only mounted when we have an active day,
  // so it can derive `value` confidently. Hidden on month/year tabs (Phase 2/3).
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
    ) : undefined;

  const profileSwitcherSlot =
    state.status === 'success' ? (
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
        profileName={state.status === 'success' && displayName ? displayName : undefined}
        birthDate={state.status === 'success' ? state.data.profileBirthDate : undefined}
        birthTime={state.status === 'success' ? state.data.profileBirthTime : undefined}
        dateNavigator={dateNavigatorSlot}
        profileSwitcher={profileSwitcherSlot}
        topBanner={
          showAuthBanner ? <AuthExpiredBanner onDismiss={handleBannerDismiss} /> : undefined
        }
        onShareClick={state.status === 'success' ? handleShellShareClick : undefined}
      >
        {tab !== 'day' && <PartialPreview tab={tab} />}

        {tab === 'day' && state.status === 'loading' && <LoadingSkeleton />}

        {tab === 'day' && state.status === 'error' && (
          <ErrorPanel
            code={state.code}
            statusCode={state.statusCode}
            message={state.message}
          />
        )}

        {tab === 'day' && state.status === 'success' && (
          <SuccessView
            data={state.data}
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
      {tab === 'day' && state.status === 'success' && activeProfileId && (
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
    </>
  );
}

// ============================================================
// Sub-views
// ============================================================

interface SuccessViewProps {
  data: DailyFortuneResponse;
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

      <NarrativeCard
        narrative={narrative}
        dimensions={engineOutput.dimensions}
        headlinerSignals={engineOutput.headlinerSignals}
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
        data={data}
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

function PartialPreview({ tab }: { tab: 'month' | 'year' }) {
  const labels = { month: '月運', year: '年運' } as const;
  return (
    <div className={styles.previewWrap}>
      <div className={styles.previewIcon}>📅</div>
      <h2 className={styles.previewTitle}>{labels[tab]}完整 AI 解讀即將推出</h2>
      <p className={styles.previewBody}>
        Phase 1 已上線「日運」深度解讀。{labels[tab]}的完整 AI 解讀正在開發中。
      </p>
      <p className={styles.previewBody}>
        ※ 您仍可在以下處查看完整月份/年度分析：
      </p>
      {/* Both 月運 + 年運 cross-sell to the existing 八字流年運勢 paid
          reading. Different deep links possible in Phase 2 once the
          ANNUAL reading has month-anchored sections. */}
      <Link href="/reading/annual" className={styles.previewLink}>
        前往《八字流年運勢》 →
      </Link>
    </div>
  );
}

function ErrorPanel({
  code,
  statusCode,
  message,
}: {
  code: string;
  statusCode: number;
  message: string;
}) {
  // Audit #2: branch SUBSCRIBER_ONLY (free user) vs OUT_OF_WINDOW
  // (subscriber asking for date outside +30/−1 day window). The latter
  // user IS a subscriber — telling them to "subscribe" is wrong.
  if (code === 'SUBSCRIBER_ONLY') {
    return (
      <div className={styles.errorWrap}>
        <div className={styles.errorIcon}>🔒</div>
        <h2 className={styles.errorTitle}>限訂閱用戶查看</h2>
        <p className={styles.errorBody}>
          免費用戶僅可查看「今日」的日運。訂閱後即可查看「昨日 + 未來 30 天」範圍。
        </p>
        <Link href="/pricing" className={styles.errorAction}>
          查看訂閱方案 →
        </Link>
      </div>
    );
  }

  if (code === 'OUT_OF_WINDOW') {
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
    return (
      <div className={styles.errorWrap}>
        <div className={styles.errorIcon}>📝</div>
        <h2 className={styles.errorTitle}>找不到出生資料</h2>
        <p className={styles.errorBody}>請先建立您的出生資料後再使用日運功能。</p>
        <Link href="/dashboard/profiles" className={styles.errorAction}>
          前往建立出生資料 →
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.errorWrap}>
      <div className={styles.errorIcon}>⚠️</div>
      <h2 className={styles.errorTitle}>暫時無法載入日運</h2>
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
