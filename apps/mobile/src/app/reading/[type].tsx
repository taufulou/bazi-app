import { useAuth } from '@clerk/clerk-expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, RefreshCw } from 'lucide-react-native';
import { READING_TYPE_META, type ReadingType } from '@repo/shared';
import { colors, spacing, fontSize, radius } from '../../theme';
import { useZh } from '../../lib/language';
import BirthDataForm from '../../components/BirthDataForm';
import BaziChart from '../../components/BaziChart';
import UnlockConfirmModal from '../../components/reading/UnlockConfirmModal';
import AIReadingDisplay from '../../components/reading/AIReadingDisplay';
import {
  renderReadingExtras,
  renderReadingSectionHeader,
  ReadingHeader,
} from '../../components/reading/readingWidgets';
import StepIndicator from '../../components/reading/StepIndicator';
import PaywallCTA from '../../components/reading/PaywallCTA';
import CacheToast from '../../components/reading/CacheToast';
import ProgressPill from '../../components/reading/ProgressPill';
import PastReadingsSection from '../../components/reading/PastReadingsSection';
import ChatFloatingButton from '../../components/chat/ChatFloatingButton';
import ChatSheet from '../../components/chat/ChatSheet';
import InlineAskCard from '../../components/chat/InlineAskCard';
import type { ChatReadingType } from '../../lib/chat-api';
import { calculateBazi } from '../../lib/bazi-api';
import type { BaziChartData } from '../../lib/bazi-types';
import { ApiError, getUserProfile } from '../../lib/api';
import {
  fetchBirthProfiles,
  createBirthProfile,
  updateBirthProfile,
  formValuesToPayload,
  type BirthProfile,
} from '../../lib/birth-profiles-api';
import type { BirthDataFormValues, SaveProfileIntent } from '../../lib/birth-profile-types';
import {
  createBaziReading,
  streamBaziReading,
  regenerateBaziReading,
  getReading,
  transformAIResponse,
  expectedSectionTotal,
  type AIReadingData,
  type NestJSReadingResponse,
  type FinalEventPayload,
} from '../../lib/readings-api';
// Shared reading-page hero backdrop (mirrors web .pageContainerLifetime::before).
import READING_BG from '../../../assets/backgrounds/reading-lifetime-bg.webp';

const VALID: ReadingType[] = ['lifetime', 'love', 'career', 'annual'];

/** Staged chart-reveal step delays (ms), mirroring web page.tsx:347. */
const CHART_REVEAL_DELAYS = [0, 1000, 1500, 1500, 2000, 1200];

function asParam(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
}

type Step = 'form' | 'preview' | 'reading';

/** Streaming section accumulator → ordered AIReadingData via transformAIResponse. */
type SectionMap = Record<string, { preview: string; full: string; score?: number }>;

export default function ReadingFlowScreen() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const zh = useZh();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const slug = asParam(params.type) as ReadingType | undefined;
  const idParam = asParam(params.id);

  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [chart, setChart] = useState<BaziChartData | null>(null);
  const [formValues, setFormValues] = useState<BirthDataFormValues | null>(null);
  // Chart-header identity (name / birthDate / gender) — populated from the form
  // (fresh) OR the reading's birthProfile (hydrated from history), so BaziChart's
  // header renders on both the preview AND the result step.
  const [chartName, setChartName] = useState<string | undefined>();
  const [chartBirthDate, setChartBirthDate] = useState<string | undefined>();
  const [chartGender, setChartGender] = useState<'male' | 'female'>('male');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<BirthProfile[]>([]);

  const [credits, setCredits] = useState<number | null>(null);

  // Unlock + streaming
  const [showUnlock, setShowUnlock] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [cacheToast, setCacheToast] = useState(false);

  // Staged chart reveal (preview step)
  const [revealedSections, setRevealedSections] = useState(0);
  const [isRevealing, setIsRevealing] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-hydrated from a past reading (?id= or a PastReadings tap) — skips form + reveal.
  const [loadedFromHistory, setLoadedFromHistory] = useState(false);

  // Chat (AI 命理師)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPending, setChatPending] = useState<string | undefined>(undefined);
  const [chatSectionHint, setChatSectionHint] = useState<string | undefined>(undefined);
  /** Chat FAB auto-hide — see onReadingScroll. */
  const [fabHidden, setFabHidden] = useState(false);
  const lastScrollY = useRef(0);

  /**
   * Park the chat FAB while the user is reading DOWN the page, restore it on any
   * upward scroll. The button is an opaque pill pinned bottom-right, so on a long
   * reading it otherwise covers real content for the entire scroll.
   * The 12px threshold keeps it from flickering on small jitters.
   *
   * ⚠️ Must stay ABOVE this component's early returns — it's a hook.
   */
  const onReadingScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    if (Math.abs(dy) < 12) return;
    lastScrollY.current = y;
    // Always show near the top, regardless of direction.
    setFabHidden(y > 80 && dy > 0);
  }, []);
  const chatReadingType = slug ? (slug.toUpperCase() as ChatReadingType) : undefined;
  const [sections, setSections] = useState<SectionMap>({});
  const [deterministic, setDeterministic] = useState<NestJSReadingResponse['deterministic']>(undefined);
  const [summary, setSummary] = useState<{ preview: string; full: string } | undefined>();
  const [isStreaming, setIsStreaming] = useState(false);
  const [finalInfo, setFinalInfo] = useState<FinalEventPayload | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const streamRef = useRef<{ close: () => void } | null>(null);

  const meta = slug && VALID.includes(slug) ? READING_TYPE_META[slug] : null;
  const hourUnknown = formValues ? formValues.hourKnown === false : false;

  // Load profiles + credits.
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const [profiles, profile] = await Promise.all([fetchBirthProfiles(token), getUserProfile(token)]);
        if (cancelled) return;
        setSavedProfiles(profiles);
        setCredits(profile.credits);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken omitted (unstable Clerk ref → fetch loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Abort any in-flight stream + reveal timer on unmount.
  useEffect(
    () => () => {
      streamRef.current?.close();
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    },
    [],
  );

  const refreshCredits = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const profile = await getUserProfile(token);
      setCredits(profile.credits);
    } catch {
      /* non-fatal */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Staged chart reveal — self-rescheduling timer chain (mirrors web startChartReveal).
  const startChartReveal = useCallback(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    setIsRevealing(true);
    setRevealedSections(1); // header shows immediately
    let idx = 1;
    const revealNext = () => {
      if (idx >= 6) {
        setIsRevealing(false);
        return;
      }
      revealTimerRef.current = setTimeout(() => {
        idx += 1;
        setRevealedSections(idx);
        revealNext();
      }, CHART_REVEAL_DELAYS[idx]);
    };
    revealNext();
  }, []);

  // Re-hydrate a completed reading in place (from a PastReadings tap or ?id= deep-link).
  const hydrateReading = useCallback(
    async (id: string) => {
      setLoading(true);
      setError('');
      try {
        const token = await getToken();
        if (!token) throw new Error('no token');
        const r = await getReading(token, id);
        setChart((r.calculationData as unknown as BaziChartData) ?? null);
        setChartName(r.birthProfile?.name);
        setChartBirthDate(r.birthProfile?.birthDate?.slice(0, 10));
        setChartGender(r.birthProfile?.gender === 'FEMALE' ? 'female' : 'male');
        setSections(r.aiInterpretation?.sections ?? {});
        setSummary(r.aiInterpretation?.summary);
        setDeterministic(r.aiInterpretation?.deterministic ?? r.deterministic);
        setReadingId(r.id);
        setFinalInfo(null);
        setIsStreaming(false);
        setLoadedFromHistory(true);
        setStep('reading');
      } catch (e) {
        setError(e instanceof ApiError ? e.message : zh('無法載入這則解讀，請稍後再試'));
      } finally {
        setLoading(false);
      }
    },
    [getToken, zh],
  );

  // Deep-link ?id= → open that reading directly (once).
  const hydratedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isSignedIn || !idParam) return;
    if (hydratedIdRef.current === idParam) return;
    hydratedIdRef.current = idParam;
    void hydrateReading(idParam);
  }, [isSignedIn, idParam, hydrateReading]);

  // Step 1 — compute chart preview + persist profile (need a birthProfileId to unlock).
  const handleFormSubmit = useCallback(
    async (data: BirthDataFormValues, _pid: string | null, saveIntent?: SaveProfileIntent) => {
      setLoading(true);
      setError('');
      let result: BaziChartData;
      try {
        result = await calculateBazi({
          birth_date: data.birthDate,
          birth_time: data.hourKnown ? data.birthTime : null,
          hour_known: data.hourKnown,
          birth_city: data.birthCity,
          birth_timezone: data.birthTimezone,
          gender: data.gender,
        });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : zh('排盤失敗，請稍後再試'));
        setLoading(false);
        return;
      }
      // Persist the profile → id (REQUIRED for the paid reading, unlike free 排盤).
      try {
        const token = await getToken();
        if (!token) throw new Error('no token');
        const payload = formValuesToPayload(data, saveIntent?.relationshipTag, saveIntent?.lunarBirthDate);
        const existingId = saveIntent?.existingProfileId ?? null;
        let pid: string;
        if (existingId) {
          await updateBirthProfile(token, existingId, payload);
          pid = existingId;
        } else {
          const created = await createBirthProfile(token, payload);
          pid = created.id;
        }
        setProfileId(pid);
      } catch {
        setError(zh('無法儲存命盤資料，請稍後再試'));
        setLoading(false);
        return;
      }
      setChart(result);
      setFormValues(data);
      setChartName(data.name);
      setChartBirthDate(data.birthDate);
      setChartGender(data.gender);
      setStep('preview');
      setLoading(false);
      startChartReveal();
    },
    [getToken, zh, startChartReveal],
  );

  // Step 2 — spend credits + stream the AI reading.
  const startReading = useCallback(async () => {
    if (!profileId || !slug) return;
    setIsUnlocking(true);
    setError('');
    let token: string | null;
    try {
      token = await getToken();
      if (!token) throw new Error('no token');
    } catch {
      setError(zh('登入狀態失效，請重新登入'));
      setIsUnlocking(false);
      return;
    }
    let response: NestJSReadingResponse;
    try {
      response = await createBaziReading(token, {
        birthProfileId: profileId,
        readingType: slug,
        targetYear: slug === 'annual' ? new Date().getFullYear() : undefined,
        stream: true,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : zh('解鎖失敗，請稍後再試'));
      setIsUnlocking(false);
      return;
    }

    setReadingId(response.id);
    setDeterministic(response.deterministic);
    setSections({});
    setSummary(undefined);
    setFinalInfo(null);
    setShowUnlock(false);
    setIsUnlocking(false);
    setCacheToast(!!response.fromCache); // 已載入…未扣點 banner
    setIsStreaming(true);
    setStep('reading');
    void refreshCredits();

    streamRef.current = streamBaziReading(token, response.id, {
      onSectionComplete: (key, section) => {
        setSections((prev) => ({ ...prev, [key]: section }));
      },
      onCallComplete: () => {
        /* progress — handled by section count via the pill */
      },
      onSummary: (s) => setSummary(s),
      // Cache-hit / reconnect paths terminate with `done` (not `final`) — stop the
      // streaming skeleton either way (backend audit 2026-07-12).
      onDone: () => setIsStreaming(false),
      onFinal: (info) => {
        setFinalInfo(info);
        setIsStreaming(false);
        if (info.status === 'failed') {
          setError(zh('AI 生成失敗，點數已退回，請稍後再試'));
          void refreshCredits(); // reflect the refund
        }
      },
      onError: (err) => {
        setError(err.message || zh('生成過程發生問題'));
        setIsStreaming(false);
      },
    });
  }, [profileId, slug, getToken, zh, refreshCredits]);

  const handleRegenerate = useCallback(async () => {
    // Degraded case: reset the reading server-side (free, ≤3×) THEN re-stream —
    // re-streaming alone just replays the same degraded content (audit fix).
    if (!readingId) return;
    const token = await getToken();
    if (!token) return;
    setSections({});
    setSummary(undefined);
    setFinalInfo(null);
    setError('');
    setIsStreaming(true);
    try {
      await regenerateBaziReading(token, readingId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : zh('重新生成失敗，請稍後再試'));
      setIsStreaming(false);
      return;
    }
    streamRef.current = streamBaziReading(token, readingId, {
      onSectionComplete: (key, section) => setSections((prev) => ({ ...prev, [key]: section })),
      onCallComplete: () => {},
      onSummary: (s) => setSummary(s),
      onDone: () => setIsStreaming(false),
      onFinal: (info) => {
        setFinalInfo(info);
        setIsStreaming(false);
        // A re-generation can itself fail; the 'degraded' banner won't show
        // (status is now 'failed'), so surface it here like the first stream.
        if (info.status === 'failed') {
          setError(zh('AI 生成失敗，點數已退回，請稍後再試'));
          void refreshCredits();
        }
      },
      onError: (err) => {
        setError(err.message || zh('生成過程發生問題'));
        setIsStreaming(false);
      },
    });
    // getToken omitted (unstable Clerk ref → loop). refreshCredits is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingId, zh, refreshCredits]);

  if (isLoaded && !isSignedIn) return <Redirect href="/sign-in" />;

  if (!meta) {
    return (
      <View style={styles.center}>
        <Text style={styles.errTitle}>{zh('找不到此解讀類型')}</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.backBtnText}>{zh('返回')}</Text>
        </Pressable>
      </View>
    );
  }

  // Ordered reading data (canonical section order via transformAIResponse).
  const aiData: AIReadingData | null =
    Object.keys(sections).length > 0
      ? transformAIResponse({
          schemaVersion: 'v2',
          sections,
          summary,
          deterministic: deterministic as never,
        })
      : null;

  const showPill = (step === 'preview' && isRevealing) || (step === 'reading' && isStreaming);
  const revealComplete = !isRevealing;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        onScroll={onReadingScroll}
        scrollEventThrottle={16}
      >
        <Stack.Screen options={{ title: zh(meta.nameZhTw) }} />

        {/* Shared reading-page hero backdrop (web .pageContainerLifetime::before):
            a top hero image faded into the cream page. RN has no mask-image → a
            LinearGradient overlay, same as the home banner.

            It lives INSIDE the scroll content (absolute against the content
            container, bled out past its padding) so it scrolls away with the
            page. As a sibling of the ScrollView it was pinned to the viewport,
            so scrolled form fields slid underneath the art and 出生日期/出生時間
            labels turned unreadable orange-on-orange.

            The gradient also starts with a translucent cream scrim rather than
            fully transparent: at scroll 0 the ①② step indicator sits over the
            art, and the bare image had far too little contrast behind it. */}
        <View style={styles.heroBackdrop} pointerEvents="none">
          <Image source={READING_BG} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient
            colors={['rgba(255,243,224,0.45)', 'rgba(255,243,224,0.82)', colors.bgPrimary]}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* ①② step indicator — hidden when a reading was opened from history. */}
        {!loadedFromHistory ? (
          <StepIndicator current={step === 'form' ? 'input' : 'result'} />
        ) : null}

        {step === 'form' ? (
          <>
            {slug ? <PastReadingsSection readingType={slug} onOpen={hydrateReading} /> : null}
            <BirthDataForm
              onSubmit={handleFormSubmit}
              isLoading={loading}
              error={error}
              title={meta.nameZhTw}
              subtitle="輸入或選擇命盤，開始詳批"
              submitLabel="排盤並預覽"
              savedProfiles={savedProfiles}
              showSaveOption
              forceSave
            />
          </>
        ) : null}

        {step === 'preview' && chart ? (
          <>
            <Pressable style={styles.backRow} onPress={() => setStep('form')} accessibilityRole="button">
              <ChevronLeft color={colors.red} size={20} />
              <Text style={styles.backText}>{zh('重新選擇')}</Text>
            </Pressable>
            <BaziChart
              data={chart}
              name={chartName}
              birthDate={chartBirthDate}
              gender={chartGender}
              isSubscriber={false}
              visibleSections={isRevealing ? revealedSections : undefined}
            />
            {revealComplete && slug ? (
              <PaywallCTA
                readingType={slug}
                creditCost={meta.creditCost}
                currentCredits={credits}
                onUnlock={() => setShowUnlock(true)}
                onBuyCredits={() => router.push('/store')}
              />
            ) : null}
          </>
        ) : null}

        {step === 'reading' ? (
          <View style={styles.reading}>
            {error ? <Text style={styles.streamError}>{zh(error)}</Text> : null}

            {finalInfo?.status === 'degraded' ? (
              <View style={styles.degraded}>
                <Text style={styles.degradedText}>{zh('部分內容生成未完整。')}</Text>
                <Pressable style={styles.regenBtn} onPress={handleRegenerate} accessibilityRole="button">
                  <RefreshCw size={14} color={colors.red} />
                  <Text style={styles.regenText}>{zh('重新生成')}</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Result top = the user's 命盤 first (web parity: the chart persists
                above the AI reading). Fully shown here — the staged reveal ran on
                the preview step. */}
            {chart ? (
              <BaziChart
                data={chart}
                name={chartName}
                birthDate={chartBirthDate}
                gender={chartGender}
                isSubscriber
              />
            ) : null}

            <AIReadingDisplay
              data={aiData}
              isSubscriber
              isStreaming={isStreaming}
              chartData={chart as Record<string, unknown> | null}
              readingType={slug}
              header={
                slug ? (
                  <ReadingHeader readingType={slug} chartData={chart as Record<string, unknown> | null} />
                ) : null
              }
              renderSectionHeader={(section) =>
                slug
                  ? renderReadingSectionHeader({
                      readingType: slug,
                      section,
                      deterministic: deterministic as never,
                    })
                  : null
              }
              renderExtras={(sectionKey) => (
                <>
                  {/* web order: 專業命理依據 → InlineAsk → deterministic data */}
                  {chatReadingType && readingId ? (
                    <InlineAskCard
                      readingType={chatReadingType}
                      sectionKey={sectionKey}
                      onAsk={(sk, q) => {
                        setChatSectionHint(sk);
                        setChatPending(q);
                        setChatOpen(true);
                      }}
                      onOpenChat={(sk) => {
                        setChatSectionHint(sk);
                        setChatPending(undefined);
                        setChatOpen(true);
                      }}
                    />
                  ) : null}
                  {slug
                    ? renderReadingExtras({
                        readingType: slug,
                        sectionKey,
                        deterministic: deterministic as never,
                        chartData: chart as Record<string, unknown> | null,
                        isSubscriber: true,
                      })
                    : null}
                </>
              )}
            />
          </View>
        ) : null}

        <UnlockConfirmModal
          visible={showUnlock}
          readingName={meta.nameZhTw}
          creditCost={meta.creditCost}
          credits={credits}
          isUnlocking={isUnlocking}
          hourUnknown={hourUnknown}
          error={showUnlock ? error : ''}
          onConfirm={startReading}
          onCancel={() => setShowUnlock(false)}
          onBuyCredits={() => {
            setShowUnlock(false);
            router.push('/store');
          }}
        />
      </ScrollView>

      {/* Cache banner — pinned to the top of the VIEWPORT, not inline in the
          scroll content. Unlock happens from the paywall CTA at the bottom of the
          page and the scroll offset is preserved, so an inline banner spends its
          entire 5s life above the fold: the user never learns they weren't
          charged, which is the one thing it exists to say. */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <CacheToast visible={cacheToast} onDismiss={() => setCacheToast(false)} />
      </View>

      {/* Floating progress pill (排盤中 during reveal / 解讀中 during stream). */}
      {showPill ? (
        <View style={styles.pillWrap} pointerEvents="none">
          <ProgressPill
            mode={step === 'preview' ? 'reveal' : 'stream'}
            current={step === 'preview' ? revealedSections : aiData?.sections.length ?? 0}
            total={step === 'preview' ? 6 : expectedSectionTotal(slug ?? '')}
          />
        </View>
      ) : null}

      {/* Hidden while the progress pill is up: both are bottom-anchored (pill
          bottom-centre, FAB bottom-right) and visibly collide mid-stream. Hiding
          it is also the correct behaviour — the chat grounds itself in the
          finished reading, so offering it before the sections land invites a
          question we can't answer well yet. */}
      {step === 'reading' && readingId && !showPill ? (
        <ChatFloatingButton
          hidden={fabHidden}
          onPress={() => {
            setChatSectionHint(undefined);
            setChatPending(undefined);
            setChatOpen(true);
          }}
        />
      ) : null}

      {chatReadingType && readingId ? (
        <ChatSheet
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
          readingType={chatReadingType}
          readingId={readingId}
          sectionContextHint={chatSectionHint}
          pendingInitialMessage={chatPending}
          populateOnly
          onPendingInitialMessageConsumed={() => setChatPending(undefined)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgPrimary },
  // Transparent so the hero backdrop shows through at the top (cream below it).
  container: { flex: 1, backgroundColor: 'transparent' },
  // paddingBottom clears the chat FAB, which sits at bottom:24 and stands ~52pt
  // tall (so it occupies 24–76). The old value of 64 left the last card clipped
  // even after the button parks itself on scroll-down.
  content: { padding: spacing.xl, paddingBottom: 104 },
  // Absolute against the SCROLL CONTENT (see the JSX comment). Negative insets
  // cancel `content`'s padding so the art still bleeds edge-to-edge.
  heroBackdrop: {
    position: 'absolute',
    top: 0,
    left: -spacing.xl,
    right: -spacing.xl,
    height: 260,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, backgroundColor: colors.bgPrimary },
  errTitle: { fontSize: fontSize.lg, color: colors.textSecondary },
  backBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xl, backgroundColor: colors.bgCard, borderRadius: radius.md },
  backBtnText: { color: colors.red, fontWeight: '600' },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  backText: { color: colors.red, fontSize: fontSize.base, fontWeight: '600' },
  reading: { gap: spacing.md },
  streamError: { color: colors.error, fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.sm },
  degraded: {
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  degradedText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  regenText: { color: colors.red, fontSize: fontSize.sm, fontWeight: '600' },
  pillWrap: { position: 'absolute', bottom: spacing.xxl, left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  // Above the pill so the two never stack ambiguously; box-none so taps pass
  // through to the page except on the banner's own ✕.
  toastWrap: { position: 'absolute', top: spacing.md, left: spacing.lg, right: spacing.lg, zIndex: 30 },
});
