import { useAuth } from '@clerk/clerk-expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Lock, RefreshCw } from 'lucide-react-native';
import { READING_TYPE_META, type ReadingType } from '@repo/shared';
import { colors, spacing, fontSize, radius, shadows } from '../../theme';
import { useZh } from '../../lib/language';
import BirthDataForm from '../../components/BirthDataForm';
import BaziChart from '../../components/BaziChart';
import UnlockConfirmModal from '../../components/reading/UnlockConfirmModal';
import AIReadingDisplay from '../../components/reading/AIReadingDisplay';
import { renderReadingExtras, ReadingHeader } from '../../components/reading/readingWidgets';
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
  transformAIResponse,
  type AIReadingData,
  type NestJSReadingResponse,
  type FinalEventPayload,
} from '../../lib/readings-api';

const VALID: ReadingType[] = ['lifetime', 'love', 'career', 'annual'];

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
  const params = useLocalSearchParams<{ type?: string }>();
  const slug = asParam(params.type) as ReadingType | undefined;

  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [chart, setChart] = useState<BaziChartData | null>(null);
  const [formValues, setFormValues] = useState<BirthDataFormValues | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<BirthProfile[]>([]);

  const [credits, setCredits] = useState<number | null>(null);

  // Unlock + streaming
  const [showUnlock, setShowUnlock] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Chat (AI 命理師)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPending, setChatPending] = useState<string | undefined>(undefined);
  const [chatSectionHint, setChatSectionHint] = useState<string | undefined>(undefined);
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

  // Abort any in-flight stream on unmount.
  useEffect(() => () => streamRef.current?.close(), []);

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
      setStep('preview');
      setLoading(false);
    },
    [getToken, zh],
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
    setIsStreaming(true);
    setStep('reading');
    void refreshCredits();

    streamRef.current = streamBaziReading(token, response.id, {
      onSectionComplete: (key, section) => {
        setSections((prev) => ({ ...prev, [key]: section }));
      },
      onCallComplete: () => {
        /* progress — handled implicitly by section count */
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
      },
      onError: (err) => {
        setError(err.message || zh('生成過程發生問題'));
        setIsStreaming(false);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingId, zh]);

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

  return (
    <View style={styles.root}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: zh(meta.nameZhTw) }} />

      {step === 'form' ? (
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
      ) : null}

      {step === 'preview' && chart ? (
        <>
          <Pressable style={styles.backRow} onPress={() => setStep('form')} accessibilityRole="button">
            <ChevronLeft color={colors.red} size={20} />
            <Text style={styles.backText}>{zh('重新選擇')}</Text>
          </Pressable>
          <BaziChart
            data={chart}
            name={formValues?.name}
            birthDate={formValues?.birthDate}
            gender={formValues?.gender ?? 'male'}
            isSubscriber={false}
          />
          <Pressable style={styles.unlockCta} onPress={() => setShowUnlock(true)} accessibilityRole="button">
            <Lock size={18} color={colors.textOnRed} />
            <Text style={styles.unlockText}>
              {zh('解鎖完整報告')} · {meta.creditCost} {zh('點')}
            </Text>
          </Pressable>
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

          <AIReadingDisplay
            data={aiData}
            isSubscriber
            isStreaming={isStreaming}
            header={
              slug ? (
                <ReadingHeader readingType={slug} chartData={chart as Record<string, unknown> | null} />
              ) : null
            }
            renderExtras={(sectionKey) => (
              <>
                {slug
                  ? renderReadingExtras({
                      readingType: slug,
                      sectionKey,
                      deterministic: deterministic as never,
                      chartData: chart as Record<string, unknown> | null,
                      isSubscriber: true,
                    })
                  : null}
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
        onConfirm={startReading}
        onCancel={() => setShowUnlock(false)}
        onBuyCredits={() => {
          setShowUnlock(false);
          router.push('/store');
        }}
      />
      </ScrollView>

      {step === 'reading' && readingId ? (
        <ChatFloatingButton
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
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl * 2 },
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
  unlockCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    marginTop: spacing.xl,
    ...shadows.warm,
  },
  unlockText: { color: colors.textOnRed, fontSize: fontSize.base, fontWeight: '700' },
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
});
