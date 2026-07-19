import { useAuth } from '@clerk/clerk-expo';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { colors, spacing, fontSize, radius, fonts, rhythm } from '../../theme';
import { useZh } from '../../lib/language';
import EnergyScoreRing from '../../components/fortune/EnergyScoreRing';
import DimensionBars from '../../components/fortune/DimensionBars';
import NarrativeCard from '../../components/fortune/NarrativeCard';
import FolkContentCard from '../../components/fortune/FolkContentCard';
import FortuneChat, { SampleQuestionStrip } from '../../components/fortune/FortuneChat';
import SectionDivider from '../../components/fortune/SectionDivider';
import MonthlyEnergyRing from '../../components/fortune/MonthlyEnergyRing';
import MonthlyDimensionBars from '../../components/fortune/MonthlyDimensionBars';
import MonthlyTimeGrid from '../../components/fortune/MonthlyTimeGrid';
import MonthlyNarrativeCard from '../../components/fortune/MonthlyNarrativeCard';
import YearlyEnergyRing from '../../components/fortune/YearlyEnergyRing';
import YearlyDimensionStars from '../../components/fortune/YearlyDimensionStars';
import YearlyRiskOpportunityGrid from '../../components/fortune/YearlyRiskOpportunityGrid';
import YearlyLuckMethodsCard from '../../components/fortune/YearlyLuckMethodsCard';
import YearlyNarrativeCard from '../../components/fortune/YearlyNarrativeCard';
import YearlyCrossSellCard from '../../components/fortune/YearlyCrossSellCard';
import PeriodNavigator, { type PeriodOption } from '../../components/fortune/PeriodNavigator';
import ProfileSwitcher from '../../components/fortune/ProfileSwitcher';
import ShareFortuneButton from '../../components/fortune/ShareFortuneButton';
import ShareableFortuneCard from '../../components/fortune/ShareableFortuneCard';
import ShareableMonthlyFortuneCard from '../../components/fortune/ShareableMonthlyFortuneCard';
import ShareableYearlyFortuneCard from '../../components/fortune/ShareableYearlyFortuneCard';
import { formatFortuneDate } from '../../components/fortune/labels';
import { useFortuneNarrativeStream } from '../../components/fortune/hooks/useFortuneNarrativeStream';
import { getUserProfile } from '../../lib/api';
import { fetchBirthProfiles, type BirthProfile } from '../../lib/birth-profiles-api';
import {
  resolveBaziToday,
  resolveCurrentMonthIso,
  resolveCurrentYearIso,
  addDaysIso,
  addMonthsIso,
  SUBSCRIBER_WINDOW_PAST,
  SUBSCRIBER_WINDOW_FUTURE,
  SUBSCRIBER_WINDOW_PAST_MONTH,
  SUBSCRIBER_WINDOW_FUTURE_MONTH,
  SUBSCRIBER_WINDOW_PAST_YEAR,
  SUBSCRIBER_WINDOW_FUTURE_YEAR,
  type UserTier,
} from '../../lib/fortune-api';
import type {
  DailyFortuneEngineOutput,
  DailyFortuneNarrative,
  MonthlyFortuneEngineOutput,
  MonthlyFortuneNarrative,
  YearlyFortuneEngineOutput,
  YearlyFortuneNarrative,
  IntraMonthBreakdown,
  DailyFortuneResponse,
  FortuneStreamEvent,
} from '../../lib/fortune-api';

type Tab = 'day' | 'month' | 'year';

// ---- Period option builders (full subscriber window; FREE gated at tap) ----

function monthLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})$/);
  return m ? `${Number(m[1])}年${Number(m[2])}月` : iso;
}

function buildDayOptions(today: string): PeriodOption[] {
  const opts: PeriodOption[] = [];
  for (let d = -SUBSCRIBER_WINDOW_PAST; d <= SUBSCRIBER_WINDOW_FUTURE; d++) {
    const value = addDaysIso(today, d);
    opts.push({ value, label: formatFortuneDate(value).dateLine });
  }
  return opts;
}

function buildMonthOptions(current: string): PeriodOption[] {
  const opts: PeriodOption[] = [];
  for (let m = -SUBSCRIBER_WINDOW_PAST_MONTH; m <= SUBSCRIBER_WINDOW_FUTURE_MONTH; m++) {
    const value = addMonthsIso(current, m);
    opts.push({ value, label: monthLabel(value) });
  }
  return opts;
}

function buildYearOptions(current: string): PeriodOption[] {
  const opts: PeriodOption[] = [];
  const cy = Number(current);
  for (let y = -SUBSCRIBER_WINDOW_PAST_YEAR; y <= SUBSCRIBER_WINDOW_FUTURE_YEAR; y++) {
    const value = String(cy + y);
    opts.push({ value, label: `${value}年` });
  }
  return opts;
}

function showFortuneUpsell(periodWord: string): void {
  Alert.alert(
    '訂閱會員專屬',
    `免費會員僅可查看${periodWord === '日期' ? '今日' : periodWord === '月份' ? '本月' : '今年'}運勢。訂閱後可瀏覽更多${periodWord}的運勢。`,
  );
}

interface StreamError {
  code: string;
  message: string;
}

/** Warm-amber banner shown when the AI narration fails AFTER engine_ready — the
 *  score/dims still render; this surfaces the narration failure + a retry. */
function StreamErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const zh = useZh();
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{zh(`AI 解讀未完成：${message}`)}</Text>
      <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
        <Text style={styles.bannerRetry}>{zh('重試')}</Text>
      </Pressable>
    </View>
  );
}

interface DayEngineData {
  engineOutput: DailyFortuneEngineOutput;
  date: string;
  profileId: string;
}

type DayState =
  | { status: 'loading' }
  | { status: 'engine'; engine: DayEngineData }
  | { status: 'success'; engine: DayEngineData; narrative: DailyFortuneNarrative | null }
  | { status: 'error'; code: string; message: string };

const TABS: { key: Tab; zh: string }[] = [
  { key: 'day', zh: '日運' },
  { key: 'month', zh: '月運' },
  { key: 'year', zh: '年運' },
];

function asParam(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
}

export default function FortuneScreen() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const zh = useZh();
  const [tab, setTab] = useState<Tab>('day');
  // Subscription tier — drives the period-navigator gating. undefined while
  // loading → treated as FREE (conservative).
  const [tier, setTier] = useState<UserTier | undefined>(undefined);

  // Multi-profile switcher (mirrors web). `selectedProfileId` is the EXPLICIT
  // user pick (undefined → the API defaults to the primary, so no wasteful
  // double-fetch on load). `resolvedProfileId` comes from the active view's
  // engine_ready — used ONLY to highlight the primary row before any pick.
  const [profiles, setProfiles] = useState<BirthProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  const [resolvedProfileId, setResolvedProfileId] = useState<string | undefined>(undefined);
  // Anchor date of each scope's picker, reported up so the FORTUNE chat session
  // pins to the period actually on screen (day: the date · month: YYYY-MM-01 ·
  // year: YYYY-01-01). Sessions are per anchor date.
  const [dayAnchor, setDayAnchor] = useState<string | undefined>(undefined);
  const [monthAnchor, setMonthAnchor] = useState<string | undefined>(undefined);
  const [yearAnchor, setYearAnchor] = useState<string | undefined>(undefined);

  // FORTUNE chat — one shared sheet across the tabs, opened by the floating button
  // OR a sample-question pill (which prefills the composer). Closed on tab change:
  // a session is bound to one scope+anchor, so it shouldn't survive a scope switch.
  const [chatOpen, setChatOpen] = useState(false);
  /** Chat FAB auto-hide — see onFortuneScroll. */
  const [fabHidden, setFabHidden] = useState(false);
  const lastScrollY = useRef(0);

  /**
   * Park the chat FAB while reading DOWN, restore on scroll-up. The button is an
   * opaque pill pinned bottom-right across all three fortune tabs.
   */
  const onFortuneScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    if (Math.abs(dy) < 12) return;
    lastScrollY.current = y;
    setFabHidden(y > 80 && dy > 0);
  }, []);
  const [chatPending, setChatPending] = useState<string | undefined>(undefined);
  const askFortune = useCallback((question?: string) => {
    setChatPending(question);
    setChatOpen(true);
  }, []);
  useEffect(() => {
    setChatOpen(false);
  }, [tab]);

  // Deep-link from the home «今日運勢» card: `?day=<today>&n=<nonce>` → switch to
  // the day tab + reset the day view to today (the nonce re-fires on repeat taps).
  const params = useLocalSearchParams<{ day?: string; n?: string }>();
  const focusDate = asParam(params.day);
  const focusNonce = asParam(params.n);
  useEffect(() => {
    if (focusNonce) setTab('day');
  }, [focusNonce]);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const profile = await getUserProfile(token);
        if (!cancelled) setTier(profile.subscriptionTier);
      } catch {
        /* non-fatal — gating falls back to FREE */
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken is a fresh ref each render (Clerk) — omit to avoid a fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Birth profiles for the switcher. Silent on failure (switcher hides when
  // profiles.length <= 1 anyway).
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const list = await fetchBirthProfiles(token);
        if (!cancelled) setProfiles(list);
      } catch {
        /* non-fatal — no switcher */
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken omitted (unstable Clerk ref → fetch loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  if (!isLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const isFree = tier === undefined || tier === 'FREE';
  const switcherActiveId = selectedProfileId ?? resolvedProfileId;

  return (
    // Wrapper so the floating chat button can sit ABOVE the scroll content
    // (inside the ScrollView it would scroll away with the page).
    <View style={styles.screen}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      onScroll={onFortuneScroll}
      scrollEventThrottle={16}
    >
      {/* Profile switcher (hidden when <= 1 profile) */}
      <ProfileSwitcher
        profiles={profiles}
        activeProfileId={switcherActiveId}
        onSelect={setSelectedProfileId}
      />

      {/* Scope pills */}
      <View style={styles.pills}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              // testID survives Fabric view-flattening AND iOS accessibility
              // containment, so it's the only selector automation can rely on
              // (a Pressable's accessibilityLabel replaces its children in the
              // iOS a11y tree, hiding the inner Text from element lookup).
              testID={`fortune-scope-${t.key}`}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => {
                // A fresh tab starts at the top, so the parked FAB would stay
                // parked until the next scroll happened to self-correct it.
                setFabHidden(false);
                setTab(t.key);
              }}
              accessibilityRole="button"
              accessibilityLabel={zh(t.zh)}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{zh(t.zh)}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'day' ? (
        <DailyFortuneView
          isFree={isFree}
          profileId={selectedProfileId}
          onResolvedProfile={setResolvedProfileId}
          onAnchorChange={setDayAnchor}
          onAsk={askFortune}
          focusDate={focusDate}
          focusNonce={focusNonce}
        />
      ) : tab === 'month' ? (
        <MonthlyFortuneView
          isFree={isFree}
          profileId={selectedProfileId}
          onResolvedProfile={setResolvedProfileId}
          onAnchorChange={setMonthAnchor}
        />
      ) : (
        <YearlyFortuneView
          isFree={isFree}
          profileId={selectedProfileId}
          onResolvedProfile={setResolvedProfileId}
          onAnchorChange={setYearAnchor}
        />
      )}
    </ScrollView>

    {/* 問 AI 命理師 — web mounts chat on all three fortune tabs. One shared sheet,
        pinned to the active tab's on-screen anchor (day → date · month → YYYY-MM-01
        · year → YYYY-01-01), so the session always matches the period viewed. */}
    <FortuneChat
      profileId={switcherActiveId}
      scope={tab === 'day' ? 'DAY' : tab === 'month' ? 'MONTH' : 'YEAR'}
      anchorDate={tab === 'day' ? dayAnchor : tab === 'month' ? monthAnchor : yearAnchor}
      open={chatOpen}
      pending={chatPending}
      onOpenChange={setChatOpen}
      onPendingConsumed={() => setChatPending(undefined)}
      fabHidden={fabHidden}
    />
    </View>
  );
}

// ============================================================
// DAY scope — streaming state machine
// ============================================================

function DailyFortuneView({
  isFree,
  profileId,
  onResolvedProfile,
  onAnchorChange,
  onAsk,
  focusDate,
  focusNonce,
}: {
  isFree: boolean;
  profileId?: string;
  onResolvedProfile?: (id: string) => void;
  /** Reports the viewed date up so the parent can anchor the FORTUNE chat session. */
  onAnchorChange?: (anchorDate: string) => void;
  /** Opens the shared chat sheet, optionally prefilled with a sample question. */
  onAsk?: (question?: string) => void;
  focusDate?: string;
  focusNonce?: string;
}) {
  const zh = useZh();
  const today = useMemo(() => resolveBaziToday(), []);
  const options = useMemo(() => buildDayOptions(today), [today]);
  const [date, setDate] = useState(today);
  const dateRef = useRef(date);
  dateRef.current = date;
  // Keep the parent's chat anchor in step with the picker. Safe to list the
  // callback in deps: the parent passes a stable setState setter.
  useEffect(() => {
    onAnchorChange?.(date);
  }, [date, onAnchorChange]);
  const [enabled, setEnabled] = useState(true);
  const [state, setState] = useState<DayState>({ status: 'loading' });
  const [streamed, setStreamed] = useState<Partial<DailyFortuneNarrative>>({});
  const [streamError, setStreamError] = useState<StreamError | null>(null);
  const engineRef = useRef<DayEngineData | null>(null);

  const handleStreamError = useCallback((code: string, message: string) => {
    const engine = engineRef.current;
    if (engine) {
      // Post-engine failure (AI narration): keep the rendered engine data + show
      // a banner; NarrativeCard degrades to its «AI unavailable» fallback.
      setStreamError({ code, message });
      setState({ status: 'success', engine, narrative: null });
    } else {
      // Pre-engine failure (auth / network / gate): full error state + 重試.
      setState({ status: 'error', code, message });
    }
  }, []);

  const onEvent = useCallback(
    (ev: FortuneStreamEvent) => {
      if (ev.type === 'engine_ready') {
        const daily = ev as Extract<FortuneStreamEvent, { type: 'engine_ready'; date: string }>;
        const engine: DayEngineData = {
          engineOutput: daily.engineOutput as DailyFortuneEngineOutput,
          date: daily.date,
          profileId: daily.profileId,
        };
        engineRef.current = engine;
        onResolvedProfile?.(daily.profileId);
        setStreamed({});
        setState({ status: 'engine', engine });
      } else if (ev.type === 'section_complete') {
        setStreamed((prev) => ({ ...prev, [ev.key]: ev.value }));
      } else if (ev.type === 'done') {
        const engine = engineRef.current;
        if (engine) {
          setState({
            status: 'success',
            engine,
            narrative: (ev.narrative as DailyFortuneNarrative | null) ?? null,
          });
        }
      } else if (ev.type === 'error') {
        handleStreamError(ev.code, ev.message);
      }
    },
    [handleStreamError, onResolvedProfile],
  );

  useFortuneNarrativeStream({
    enabled,
    scope: 'day',
    profileId,
    date,
    onEvent,
    onError: (err) => handleStreamError('STREAM_FAILED', err.message),
  });

  // Reset the render state when the switcher picks a different profile (the hook
  // re-opens the stream via its profileId dep; this clears the stale profile's
  // rendered data so it doesn't linger until the new engine_ready). Keeps the
  // current date — a date is profile-independent + the subscriber window is
  // tier-based, so no OUT_OF_WINDOW risk.
  const prevProfileRef = useRef(profileId);
  useEffect(() => {
    if (prevProfileRef.current === profileId) return;
    prevProfileRef.current = profileId;
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
  }, [profileId]);

  const resetTo = useCallback((next: string) => {
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
    setDate(next);
  }, []);

  const retry = useCallback(() => {
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
    setEnabled(false);
    setTimeout(() => setEnabled(true), 0);
  }, []);

  // Home-card deep-link: on a nonce change, reset to the focused date (today) —
  // but only if not already there (resetTo with the same date sets loading
  // without re-opening the stream → stuck spinner).
  useEffect(() => {
    if (focusDate && dateRef.current !== focusDate) resetTo(focusDate);
    // Fire on the nonce only (each home-card tap); dateRef/resetTo are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const nav = (
    <PeriodNavigator
      currentLabel={formatFortuneDate(date).dateLine}
      hint="點擊選擇日期"
      pickerTitle="選擇日期"
      options={options}
      value={date}
      onChange={resetTo}
      isFree={isFree}
      onLockedAttempt={() => showFortuneUpsell('日期')}
      disabled={state.status === 'loading'}
    />
  );

  let content: ReactNode;
  if (state.status === 'loading') {
    content = (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.red} />
        <Text style={styles.loadingText}>{zh('正在為您排運勢…')}</Text>
      </View>
    );
  } else if (state.status === 'error') {
    content = (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>{zh('暫時無法載入運勢')}</Text>
        <Text style={styles.errorMsg}>{zh(state.message)}</Text>
        <Pressable style={styles.retryBtn} onPress={retry} accessibilityRole="button">
          <Text style={styles.retryText}>{zh('重試')}</Text>
        </Pressable>
      </View>
    );
  } else {
    const eo = state.engine.engineOutput;
    const narrative = state.status === 'success' ? state.narrative : null;
    // Share gated on 'success' only (PNG safety per web M1 — never capture the
    // streaming/engine state with an incomplete narrative).
    const shareData: DailyFortuneResponse | null =
      state.status === 'success'
        ? {
            date: state.engine.date,
            profileId: state.engine.profileId,
            profileBirthDate: '',
            engineOutput: eo,
            narrative,
            cacheHit: false,
            generatedAt: '',
          }
        : null;
    content = (
      <>
        <EnergyScoreRing
          label={eo.auspiciousness}
          score={eo.energyScore}
          date={state.engine.date}
          dayGanZhi={eo.dayGanZhi}
          dayTenGod={eo.dayTenGod}
          hideDateLine
        />
        <SectionDivider />
        <DimensionBars dimensions={eo.dimensions} />
        <SectionDivider />
        <NarrativeCard
          narrative={narrative}
          dimensions={eo.dimensions}
          headlinerSignals={eo.headlinerSignals}
          loading={state.status === 'engine'}
          streamedSections={streamed}
        />
        {/* 想問什麼？ pill strip — web places it between the narrative and the folk
            card. Tapping a pill opens the shared chat sheet with it prefilled. */}
        {onAsk ? (
          <>
            <SectionDivider />
            <SampleQuestionStrip onPick={onAsk} />
          </>
        ) : null}
        <SectionDivider />
        {/* 命局層級參考 — web renders this between the narrative and the share
            button. It was missing on mobile entirely: the folk data was fetched
            and drawn into the share IMAGE, but never shown on the screen, so
            吉色/吉數/宜食/忌食/吉時 were unreachable without exporting a share card.
            Engine-only (no AI), so it shows as soon as engine data lands. */}
        <FolkContentCard folkContent={eo.folkContent} />
        {shareData ? (
          <ShareFortuneButton renderCard={(ref) => <ShareableFortuneCard ref={ref} data={shareData} />} />
        ) : null}
      </>
    );
  }

  return (
    <View style={styles.dayWrap}>
      {nav}
      {streamError && state.status !== 'error' ? (
        <StreamErrorBanner message={streamError.message} onRetry={retry} />
      ) : null}
      {content}
    </View>
  );
}

// ============================================================
// MONTH scope — streaming state machine
// ============================================================

interface MonthEngineData {
  engineOutput: MonthlyFortuneEngineOutput;
  month: string;
  profileId: string;
  intraMonthBreakdown?: IntraMonthBreakdown;
}

type MonthState =
  | { status: 'loading' }
  | { status: 'engine'; engine: MonthEngineData }
  | { status: 'success'; engine: MonthEngineData; narrative: MonthlyFortuneNarrative | null }
  | { status: 'error'; code: string; message: string };

function MonthlyFortuneView({
  isFree,
  profileId,
  onResolvedProfile,
  onAnchorChange,
}: {
  isFree: boolean;
  profileId?: string;
  onResolvedProfile?: (id: string) => void;
  /** Reports the anchor (YYYY-MM-01) up so the parent can pin the FORTUNE chat. */
  onAnchorChange?: (anchorDate: string) => void;
}) {
  const zh = useZh();
  const current = useMemo(() => resolveCurrentMonthIso(), []);
  const options = useMemo(() => buildMonthOptions(current), [current]);
  const [month, setMonth] = useState(current);
  // Anchor is the 1st of the viewed month (matches web's `${targetMonth}-01`).
  useEffect(() => {
    onAnchorChange?.(`${month}-01`);
  }, [month, onAnchorChange]);
  const [enabled, setEnabled] = useState(true);
  const [state, setState] = useState<MonthState>({ status: 'loading' });
  const [streamed, setStreamed] = useState<Partial<MonthlyFortuneNarrative>>({});
  const [streamError, setStreamError] = useState<StreamError | null>(null);
  const engineRef = useRef<MonthEngineData | null>(null);

  const handleStreamError = useCallback((code: string, message: string) => {
    const engine = engineRef.current;
    if (engine) {
      setStreamError({ code, message });
      setState({ status: 'success', engine, narrative: null });
    } else {
      setState({ status: 'error', code, message });
    }
  }, []);

  const onEvent = useCallback(
    (ev: FortuneStreamEvent) => {
      if (ev.type === 'engine_ready') {
        const monthly = ev as Extract<FortuneStreamEvent, { type: 'engine_ready'; month: string }>;
        const engine: MonthEngineData = {
          engineOutput: monthly.engineOutput as MonthlyFortuneEngineOutput,
          month: monthly.month,
          profileId: monthly.profileId,
          intraMonthBreakdown: monthly.intraMonthBreakdown,
        };
        engineRef.current = engine;
        onResolvedProfile?.(monthly.profileId);
        setStreamed({});
        setState({ status: 'engine', engine });
      } else if (ev.type === 'section_complete') {
        setStreamed((prev) => ({ ...prev, [ev.key]: ev.value }));
      } else if (ev.type === 'done') {
        const engine = engineRef.current;
        if (engine) {
          setState({
            status: 'success',
            engine,
            narrative: (ev.narrative as MonthlyFortuneNarrative | null) ?? null,
          });
        }
      } else if (ev.type === 'error') {
        handleStreamError(ev.code, ev.message);
      }
    },
    [handleStreamError, onResolvedProfile],
  );

  useFortuneNarrativeStream({
    enabled,
    scope: 'month',
    profileId,
    month,
    onEvent,
    onError: (err) => handleStreamError('STREAM_FAILED', err.message),
  });

  const prevProfileRef = useRef(profileId);
  useEffect(() => {
    if (prevProfileRef.current === profileId) return;
    prevProfileRef.current = profileId;
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
  }, [profileId]);

  const resetTo = useCallback((next: string) => {
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
    setMonth(next);
  }, []);

  const retry = useCallback(() => {
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
    setEnabled(false);
    setTimeout(() => setEnabled(true), 0);
  }, []);

  const nav = (
    <PeriodNavigator
      currentLabel={monthLabel(month)}
      hint="點擊選擇月份"
      pickerTitle="選擇月份"
      options={options}
      value={month}
      onChange={resetTo}
      isFree={isFree}
      onLockedAttempt={() => showFortuneUpsell('月份')}
      disabled={state.status === 'loading'}
    />
  );

  let content: ReactNode;
  if (state.status === 'loading') {
    content = (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.red} />
        <Text style={styles.loadingText}>{zh('正在為您排運勢…')}</Text>
      </View>
    );
  } else if (state.status === 'error') {
    content = (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>{zh('暫時無法載入運勢')}</Text>
        <Text style={styles.errorMsg}>{zh(state.message)}</Text>
        <Pressable style={styles.retryBtn} onPress={retry} accessibilityRole="button">
          <Text style={styles.retryText}>{zh('重試')}</Text>
        </Pressable>
      </View>
    );
  } else {
    const eo = state.engine.engineOutput;
    const narrative = state.status === 'success' ? state.narrative : null;
    content = (
      <>
        <MonthlyEnergyRing
          label={eo.auspiciousness}
          score={eo.energyScore}
          month={state.engine.month}
          monthGanZhi={eo.monthGanZhi}
          monthTenGod={eo.monthTenGod}
          hideDateLine
        />
        <MonthlyDimensionBars dimensions={eo.dimensions} />
        <MonthlyTimeGrid
          partitionSpec={eo.partitionSpec}
          intraMonthBreakdown={state.engine.intraMonthBreakdown}
          monthStem={eo.monthStem}
          monthBranch={eo.monthBranch}
        />
        <MonthlyNarrativeCard
          narrative={narrative}
          dimensions={eo.dimensions}
          loading={state.status === 'engine'}
          streamedSections={streamed}
        />
        {state.status === 'success' ? (
          <ShareFortuneButton
            label="分享本月運勢"
            renderCard={(ref) => (
              <ShareableMonthlyFortuneCard
                ref={ref}
                month={state.engine.month}
                monthGanZhi={eo.monthGanZhi}
                monthTenGod={eo.monthTenGod}
                auspiciousness={eo.auspiciousness}
                energyScore={eo.energyScore}
                dimensions={eo.dimensions}
                intraMonthBreakdown={state.engine.intraMonthBreakdown}
              />
            )}
          />
        ) : null}
      </>
    );
  }

  return (
    <View style={styles.dayWrap}>
      {nav}
      {streamError && state.status !== 'error' ? (
        <StreamErrorBanner message={streamError.message} onRetry={retry} />
      ) : null}
      {content}
    </View>
  );
}

// ============================================================
// YEAR scope — streaming state machine
// ============================================================

interface YearEngineData {
  engineOutput: YearlyFortuneEngineOutput;
  year: number;
  profileId: string;
}

type YearState =
  | { status: 'loading' }
  | { status: 'engine'; engine: YearEngineData }
  | { status: 'success'; engine: YearEngineData; narrative: YearlyFortuneNarrative | null }
  | { status: 'error'; code: string; message: string };

function YearlyFortuneView({
  isFree,
  profileId,
  onResolvedProfile,
  onAnchorChange,
}: {
  isFree: boolean;
  profileId?: string;
  onResolvedProfile?: (id: string) => void;
  /** Reports the anchor (YYYY-01-01) up so the parent can pin the FORTUNE chat. */
  onAnchorChange?: (anchorDate: string) => void;
}) {
  const zh = useZh();
  const current = useMemo(() => resolveCurrentYearIso(), []);
  const options = useMemo(() => buildYearOptions(current), [current]);
  const [year, setYear] = useState(current);
  // Anchor is Jan 1 of the viewed year (matches web's `${targetYear}-01-01`).
  useEffect(() => {
    onAnchorChange?.(`${year}-01-01`);
  }, [year, onAnchorChange]);
  const [enabled, setEnabled] = useState(true);
  const [state, setState] = useState<YearState>({ status: 'loading' });
  const [streamed, setStreamed] = useState<Partial<YearlyFortuneNarrative>>({});
  const [streamError, setStreamError] = useState<StreamError | null>(null);
  const engineRef = useRef<YearEngineData | null>(null);

  const handleStreamError = useCallback((code: string, message: string) => {
    const engine = engineRef.current;
    if (engine) {
      setStreamError({ code, message });
      setState({ status: 'success', engine, narrative: null });
    } else {
      setState({ status: 'error', code, message });
    }
  }, []);

  const onEvent = useCallback(
    (ev: FortuneStreamEvent) => {
      if (ev.type === 'engine_ready') {
        const yearly = ev as Extract<FortuneStreamEvent, { type: 'engine_ready'; year: number }>;
        const engine: YearEngineData = {
          engineOutput: yearly.engineOutput as YearlyFortuneEngineOutput,
          year: yearly.year,
          profileId: yearly.profileId,
        };
        engineRef.current = engine;
        onResolvedProfile?.(yearly.profileId);
        setStreamed({});
        setState({ status: 'engine', engine });
      } else if (ev.type === 'section_complete') {
        setStreamed((prev) => ({ ...prev, [ev.key]: ev.value }));
      } else if (ev.type === 'done') {
        const engine = engineRef.current;
        if (engine) {
          setState({
            status: 'success',
            engine,
            narrative: (ev.narrative as YearlyFortuneNarrative | null) ?? null,
          });
        }
      } else if (ev.type === 'error') {
        handleStreamError(ev.code, ev.message);
      }
    },
    [handleStreamError, onResolvedProfile],
  );

  useFortuneNarrativeStream({
    enabled,
    scope: 'year',
    profileId,
    year,
    onEvent,
    onError: (err) => handleStreamError('STREAM_FAILED', err.message),
  });

  const prevProfileRef = useRef(profileId);
  useEffect(() => {
    if (prevProfileRef.current === profileId) return;
    prevProfileRef.current = profileId;
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
  }, [profileId]);

  const resetTo = useCallback((next: string) => {
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
    setYear(next);
  }, []);

  const retry = useCallback(() => {
    setStreamed({});
    setStreamError(null);
    engineRef.current = null;
    setState({ status: 'loading' });
    setEnabled(false);
    setTimeout(() => setEnabled(true), 0);
  }, []);

  const nav = (
    <PeriodNavigator
      currentLabel={`${year}年`}
      hint="點擊選擇年份"
      pickerTitle="選擇年份"
      options={options}
      value={year}
      onChange={resetTo}
      isFree={isFree}
      onLockedAttempt={() => showFortuneUpsell('年份')}
      disabled={state.status === 'loading'}
    />
  );

  let content: ReactNode;
  if (state.status === 'loading') {
    content = (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.red} />
        <Text style={styles.loadingText}>{zh('正在為您排運勢…')}</Text>
      </View>
    );
  } else if (state.status === 'error') {
    content = (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>{zh('暫時無法載入運勢')}</Text>
        <Text style={styles.errorMsg}>{zh(state.message)}</Text>
        <Pressable style={styles.retryBtn} onPress={retry} accessibilityRole="button">
          <Text style={styles.retryText}>{zh('重試')}</Text>
        </Pressable>
      </View>
    );
  } else {
    const eo = state.engine.engineOutput;
    const narrative = state.status === 'success' ? state.narrative : null;
    const merged: Partial<YearlyFortuneNarrative> = { ...streamed, ...(narrative ?? {}) };
    const keywords = {
      career: merged.yearly_career_keyword,
      finance: merged.yearly_finance_keyword,
      romance: merged.yearly_romance_keyword,
      health: merged.yearly_health_keyword,
    };
    content = (
      <>
        <YearlyEnergyRing
          label={eo.auspiciousness}
          score={eo.energyScore}
          year={state.engine.year}
          yearGanZhi={eo.yearGanZhi}
          yearTenGod={eo.yearTenGod}
          hideDateLine
        />
        <YearlyDimensionStars dimensions={eo.dimensions} keywords={keywords} />
        <YearlyRiskOpportunityGrid
          coreRiskOpportunity={eo.coreRiskOpportunity}
          aiEntries={merged.yearly_risk_opportunities}
        />
        <YearlyLuckMethodsCard luckMethods={eo.luckMethods} />
        <YearlyNarrativeCard
          narrative={narrative}
          dimensions={eo.dimensions}
          loading={state.status === 'engine'}
          streamedSections={streamed}
        />
        {state.status === 'success' ? (
          <ShareFortuneButton
            label="分享今年運勢"
            renderCard={(ref) => (
              <ShareableYearlyFortuneCard
                ref={ref}
                year={state.engine.year}
                yearGanZhi={eo.yearGanZhi}
                yearTenGod={eo.yearTenGod}
                auspiciousness={eo.auspiciousness}
                energyScore={eo.energyScore}
                dimensions={eo.dimensions}
                coreRiskOpportunity={eo.coreRiskOpportunity}
                luckMethods={eo.luckMethods}
              />
            )}
          />
        ) : null}
        <YearlyCrossSellCard />
      </>
    );
  }

  return (
    <View style={styles.dayWrap}>
      {nav}
      {streamError && state.status !== 'error' ? (
        <StreamErrorBanner message={streamError.message} onRetry={retry} />
      ) : null}
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  // Wraps the ScrollView so the floating chat button overlays it.
  screen: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  // paddingBottom must clear the ~52pt FAB sitting at bottom:24 (was 64).
  content: { padding: spacing.xl, paddingBottom: 104, gap: rhythm.section - 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgPrimary },
  // pills
  pills: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.bgCard, padding: 4, borderRadius: 999 },
  pill: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: 999 },
  pillActive: { backgroundColor: colors.red },
  pillText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textSecondary },
  pillTextActive: { color: colors.textOnRed, fontWeight: '700' },
  // day
  dayWrap: { gap: spacing.xl },
  loadingBox: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl * 2 },
  loadingText: { fontSize: fontSize.sm, color: colors.textSecondary },
  errorBox: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl, backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.xl },
  errorTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  errorMsg: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.red, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  retryText: { color: colors.textOnRed, fontSize: fontSize.base, fontWeight: '700' },
  // stream-error banner (post-engine narration failure)
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.4)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  bannerText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  bannerRetry: { fontSize: fontSize.sm, fontWeight: '700', color: colors.red },
});
