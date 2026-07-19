/**
 * 合盤 — two-person Bazi compatibility. RN port of the web
 * reading/compatibility page. Flow: DualBirthDataForm → createBaziCompatibility
 * (skipAI:true — deterministic score, credits deducted at create) → result:
 * dual 排盤 + reveal CTA → (ROMANCE) SSE stream of the V2 AI + score reveal, or
 * (BUSINESS/FRIENDSHIP) non-stream generate-ai → AIReadingDisplay sections.
 *
 * The V1 business/friendship radar / dimension-bar result page is deferred; the
 * lightweight path here shows the overall score + the streamed sections.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, TriangleAlert } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius, rhythm } from '../../theme';
import { useZh } from '../../lib/language';
import { getUserProfile, ApiError } from '../../lib/api';
import { fetchBirthProfiles, type BirthProfile } from '../../lib/birth-profiles-api';
import {
  createBaziCompatibility,
  generateCompatibilityAI,
  streamCompatibilityReading,
  getCompatibility,
  transformAIResponse,
  SECTION_TITLE_MAP,
  type CompatibilityResponse,
  type AIReadingData,
} from '../../lib/readings-api';
import type { BaziChartData } from '../../lib/bazi-types';
import DualBirthDataForm from '../../components/DualBirthDataForm';
import PastReadingsSection from '../../components/reading/PastReadingsSection';
import BaziChart from '../../components/BaziChart';
import AIReadingDisplay from '../../components/reading/AIReadingDisplay';
import CompatibilityScoreRevealV2 from '../../components/compat/CompatibilityScoreRevealV2';
import CompatibilityRevealCTA from '../../components/compat/CompatibilityRevealCTA';
import ShareableCompatibilityCard from '../../components/compat/ShareableCompatibilityCard';
import ShareFortuneButton from '../../components/fortune/ShareFortuneButton';
import ChatFloatingButton from '../../components/chat/ChatFloatingButton';
import ChatSheet from '../../components/chat/ChatSheet';

const COMPAT_CREDIT_COST = 3;

type Step = 'input' | 'result';

/** Gender/year-aware compat section titles (port of the web getCompatV2DynamicTitle):
 *  旺妻/旺夫 resolves by each party's gender; 感情運 carries the year. */
/**
 * 男方/女方 from the ACTUAL gender — never from the A/B position. Party A is not
 * always male (and the pair may be same-sex), so positional labels contradict the
 * rest of the screen.
 */
function partyLabel(gender: string): string {
  return gender === 'female' ? '女方' : '男方';
}

/** `profile.birthDate` is a full ISO timestamp; charts want just the date. */
function isoDateOnly(iso?: string): string | undefined {
  return iso ? iso.slice(0, 10) : undefined;
}

function compatDynamicTitle(
  key: string,
  genderA: string,
  genderB: string,
  year: number,
): string | null {
  switch (key) {
    case 'spouse_enrichment_a':
      return genderA === 'male' ? '男方旺妻程度' : '女方旺夫程度';
    case 'spouse_enrichment_b':
      return genderB === 'male' ? '男方旺妻程度' : '女方旺夫程度';
    // Also gender-driven (these were positional too, so a female party A got
    // 「男方2026感情運」 while the section above it said 女方).
    case 'annual_love_a':
      return `${partyLabel(genderA)}${year}感情運`;
    case 'annual_love_b':
      return `${partyLabel(genderB)}${year}感情運`;
    default:
      return null;
  }
}

export default function CompatScreen() {
  const zh = useZh();
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const idParam = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : undefined;

  /** Chat FAB auto-hide — see onResultScroll. */
  const [fabHidden, setFabHidden] = useState(false);
  const lastScrollY = useRef(0);
  const [profiles, setProfiles] = useState<BirthProfile[]>([]);
  const [credits, setCredits] = useState(0);

  /**
   * Park the chat FAB while the user reads DOWN the revealed 合盤 analysis and
   * restore it on any upward scroll — the button is an opaque pill pinned
   * bottom-right and otherwise covers the paid content for the whole scroll.
   */
  const onResultScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    if (Math.abs(dy) < 12) return;
    lastScrollY.current = y;
    setFabHidden(y > 80 && dy > 0);
  }, []);
  const [tier, setTier] = useState<string>('FREE');
  const [loadingUser, setLoadingUser] = useState(true);

  const [step, setStep] = useState<Step>('input');
  const [comparison, setComparison] = useState<CompatibilityResponse | null>(null);
  /** Profile ids submitted to CREATE — used to resolve names the response omits. */
  const [submittedIds, setSubmittedIds] = useState<{ a: string; b: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [revealed, setRevealed] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [aiData, setAiData] = useState<AIReadingData | null>(null);
  const streamRef = useRef<{ close: () => void } | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  // Guards handleReveal re-entry during the getToken() await (a double-tap would
  // otherwise open two streams / two generate-ai calls). Reset in handleNew.
  const revealingRef = useRef(false);

  // Load profiles + credits/tier on mount.
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const [prof, user] = await Promise.all([fetchBirthProfiles(token), getUserProfile(token)]);
        setProfiles(prof);
        setCredits(user.credits);
        setTier(user.subscriptionTier);
      } catch {
        /* a silent failure here just yields an empty form */
      } finally {
        setLoadingUser(false);
      }
    })();
    // getToken omitted (unstable Clerk ref → would refetch every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshCredits = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const user = await getUserProfile(token);
      setCredits(user.credits);
    } catch {
      /* non-fatal */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => streamRef.current?.close(), []);

  const handleCreate = useCallback(
    async (params: { profileAId: string; profileBId: string; comparisonType: string }) => {
      setError(null);
      setIsSubmitting(true);
      try {
        const token = await getToken();
        if (!token) throw new Error(zh('請先登入'));
        const comp = await createBaziCompatibility(token, { ...params, skipAI: true });
        setComparison(comp);
        // The CREATE response omits the profileA/profileB relations (only the
        // hydrate-from-history path includes them), so remember which profiles we
        // submitted and resolve their names locally — otherwise the charts fall
        // back to a hardcoded 「男方」/「女方」 as the *name*, which both loses the
        // real name and contradicts the gender-derived section header above it.
        setSubmittedIds({ a: params.profileAId, b: params.profileBId });
        setStep('result');
        setRevealed(false);
        setAiData(null);
        void refreshCredits();
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : zh('合盤建立失敗，請稍後再試'),
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    // getToken omitted (unstable ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshCredits, zh],
  );

  const isRomance =
    comparison?.comparisonType === 'ROMANCE' && !!comparison.calculationData.romancePreAnalysis;

  const handleReveal = useCallback(async () => {
    if (!comparison || revealingRef.current) return;
    // Flip the disabling state SYNCHRONOUSLY (before the getToken await) so a
    // second tap can't slip through the async gap.
    revealingRef.current = true;
    setError(null);
    setRevealed(true);
    // ⚠️ The FAB is gated on `revealed`, so it MOUNTS here — and reaching this
    // button requires scrolling down past two full charts, which means
    // `fabHidden` is already true. Without this reset the chat button animates
    // straight out the moment it appears and stays gone until the user happens to
    // scroll up, i.e. it is invisible for exactly the users who just paid.
    //
    // ⚠️ Reset ONLY fabHidden. Zeroing `lastScrollY` here (the view is parked at
    // ~1200 after scrolling past two charts) makes the next delta ≈ +1200, which
    // re-hides the button on the very next gesture, up or down.
    setFabHidden(false);
    setStreaming(true);
    setAiData({ sections: [], isV2: true });

    const token = await getToken();
    if (!token) {
      setError(zh('請先登入'));
      setStreaming(false);
      setRevealed(false);
      revealingRef.current = false;
      return;
    }

    if (isRomance) {
      const calc = comparison.calculationData;
      const gA = String(calc.chartA?.gender ?? 'male').toLowerCase();
      const gB = String(calc.chartB?.gender ?? 'female').toLowerCase();
      const yr = new Date().getFullYear();
      streamRef.current = streamCompatibilityReading(token, comparison.id, {
        onSectionComplete: (key, section) =>
          setAiData((prev) => ({
            ...prev!,
            sections: [
              ...(prev?.sections || []),
              {
                key,
                title: compatDynamicTitle(key, gA, gB, yr) ?? SECTION_TITLE_MAP[key] ?? key,
                preview: section.preview,
                full: section.full,
                score: section.score,
              },
            ],
          })),
        onCallComplete: () => {},
        onSummary: (s) => setAiData((prev) => ({ ...prev!, summary: { text: s.full || s.preview } })),
        onDone: () => setStreaming(false),
        onError: (err) => {
          setStreaming(false);
          setAiData((prev) => {
            if (!prev?.sections.length && !err.partial) {
              setError(zh('AI 分析生成中，請稍後再試。您的點數不會重複扣除。'));
            } else if (prev?.sections.length) {
              setError(zh('部分分析已完成，稍後可重新載入剩餘內容。'));
            }
            return prev;
          });
        },
      });
    } else {
      // Business / friendship — non-streaming generate-ai (already paid at create).
      try {
        const withAI = await generateCompatibilityAI(token, comparison.id);
        setAiData(transformAIResponse(withAI.aiInterpretation) ?? { sections: [], isV2: false });
      } catch (e) {
        setError(e instanceof Error ? e.message : zh('分析生成失敗，請稍後再試'));
      } finally {
        setStreaming(false);
      }
    }
    // getToken omitted (unstable ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison, isRomance, zh]);

  const handleNew = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    revealingRef.current = false;
    setComparison(null);
    setStep('input');
    setRevealed(false);
    setStreaming(false);
    setAiData(null);
    setError(null);
  }, []);

  // Re-hydrate a saved comparison in place (from a history/past-readings tap or
  // ?id= deep-link). A completed comparison already has aiInterpretation → show
  // the full result; a create-only one shows the reveal CTA (re-stream is free —
  // credits were charged at create).
  const hydrateComparison = useCallback(
    async (id: string) => {
      // Abort any in-flight reveal stream + clear the reveal guard so the newly
      // loaded comparison can be revealed, and a stale stream can't append its
      // sections onto this one (line-audit fixes #2/#3).
      streamRef.current?.close();
      streamRef.current = null;
      revealingRef.current = false;
      setError(null);
      try {
        const token = await getToken();
        if (!token) return;
        const comp = await getCompatibility(token, id);
        setComparison(comp);
        setStep('result');
        setStreaming(false);
        const ai = comp.aiInterpretation ? transformAIResponse(comp.aiInterpretation) : null;
        if (ai) {
          const calc = comp.calculationData;
          const gA = String(calc.chartA?.gender ?? 'male').toLowerCase();
          const gB = String(calc.chartB?.gender ?? 'female').toLowerCase();
          const yr = new Date().getFullYear();
          // transformAIResponse only carries the static SECTION_TITLE_MAP names;
          // re-apply the gender/year-aware compat titles the live stream adds.
          setAiData({
            ...ai,
            sections: ai.sections.map((s) => ({ ...s, title: compatDynamicTitle(s.key, gA, gB, yr) ?? s.title })),
          });
          setRevealed(true);
          setFabHidden(false);
        } else {
          setAiData(null);
          setRevealed(false);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : zh('無法載入這則合盤，請稍後再試'));
      }
    },
    // getToken omitted (unstable ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zh],
  );

  // Deep-link ?id= → open that comparison, then CONSUME the param immediately so
  // re-tapping the same history row (or retrying after a failed load) re-fires —
  // a one-shot deep link with no lingering guard (line-audit fixes #4a/#4b).
  useEffect(() => {
    if (!idParam) return;
    const id = idParam;
    router.setParams({ id: '' });
    void hydrateComparison(id);
  }, [idParam, hydrateComparison, router]);

  if (loadingUser) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        onScroll={onResultScroll}
        scrollEventThrottle={16}
      >
      {step === 'input' ? (
        <>
          <PastReadingsSection readingType="compatibility" onOpen={hydrateComparison} />
          <DualBirthDataForm
            onSubmit={handleCreate}
            isLoading={isSubmitting}
            error={error}
            savedProfiles={profiles}
            userCredits={credits}
            creditCost={COMPAT_CREDIT_COST}
            getToken={getToken}
          />
        </>
      ) : null}

      {step === 'result' && comparison
        ? (() => {
            const calc = comparison.calculationData;
            const rpa = calc.romancePreAnalysis;
            const chartA = calc.chartA as unknown as BaziChartData;
            const chartB = calc.chartB as unknown as BaziChartData;
            const genderA = String(calc.chartA?.gender ?? 'male').toLowerCase();
            const genderB = String(calc.chartB?.gender ?? 'female').toLowerCase();
            // Prefer the relation (hydrate path), else the locally-submitted
            // profile (create path — that response omits the relations), else the
            // gender-derived label. Never a hardcoded 男方/女方: that both loses the
            // real name and mislabels a female party A, contradicting the section
            // header directly above it.
            const localA = submittedIds ? profiles.find((p) => p.id === submittedIds.a) : undefined;
            const localB = submittedIds ? profiles.find((p) => p.id === submittedIds.b) : undefined;
            const nameA = comparison.profileA?.name ?? localA?.name ?? partyLabel(genderA);
            const nameB = comparison.profileB?.name ?? localB?.name ?? partyLabel(genderB);
            const birthA = comparison.profileA?.birthDate ?? localA?.birthDate;
            const birthB = comparison.profileB?.birthDate ?? localB?.birthDate;
            // A same-sex pair would render two identical headers (both 男方) —
            // accurate, but ambiguous about which chart is which. Append the name
            // only in that case; opposite-sex pairs keep the clean 男方/女方.
            const sameGender = genderA === genderB;
            const headerA = sameGender ? `${partyLabel(genderA)} · ${nameA}` : partyLabel(genderA);
            const headerB = sameGender ? `${partyLabel(genderB)} · ${nameB}` : partyLabel(genderB);
            const displayScore = rpa?.blendedScore ?? calc.adjustedScore ?? calc.overallScore ?? 0;
            const displayLabel = rpa?.blendedLabel ?? calc.label ?? '';
            const hourUnknownA = !!rpa?.lovePersonalityA?.hourUnknown;
            const hourUnknownB = !!rpa?.lovePersonalityB?.hourUnknown;
            const sweetness = rpa?.postMarriageQuality?.sweetness?.score;
            const stability = rpa?.postMarriageQuality?.stability?.score;
            const isSub = tier !== 'FREE';

            return (
              <>
                <Pressable style={styles.backRow} onPress={handleNew} accessibilityRole="button">
                  <ChevronLeft color={colors.red} size={20} />
                  <Text style={styles.backText}>{zh('重新合盤')}</Text>
                </Pressable>

                {/* Dual 排盤 (stacked; mobile can't do the web's side-by-side grid).
                    Labels come from the ACTUAL gender, not the A/B position — a
                    female party A was being labelled 男方, contradicting the
                    per-party 時辰未知 notes and the AI narrative on the same screen,
                    which both already dispatch on genderA/genderB. Dates are sliced
                    to YYYY-MM-DD; the raw profile value is a full ISO timestamp and
                    rendered verbatim as 「1987-01-25T00:00:00.000Z」. */}
                <Text style={styles.partyLabel}>{zh(headerA)}</Text>
                <BaziChart data={chartA} name={nameA} birthDate={isoDateOnly(birthA)} gender={genderA} isSubscriber={isSub} />
                <Text style={styles.partyLabel}>{zh(headerB)}</Text>
                <BaziChart data={chartB} name={nameB} birthDate={isoDateOnly(birthB)} gender={genderB} isSubscriber={isSub} />

                {/* Pre-reveal gate */}
                {!revealed ? (
                  isRomance ? (
                    <CompatibilityRevealCTA
                      onReveal={handleReveal}
                      isRevealing={streaming}
                      hourUnknownA={hourUnknownA}
                      hourUnknownB={hourUnknownB}
                      genderA={genderA}
                      genderB={genderB}
                    />
                  ) : (
                    <View style={styles.genericGate}>
                      <Text style={styles.genericScore}>
                        {displayScore}
                        <Text style={styles.genericScoreUnit}>{zh('分')}</Text>
                      </Text>
                      <Text style={styles.genericLabel}>{zh(displayLabel)}</Text>
                      {calc.labelDescription ? <Text style={styles.genericDesc}>{zh(calc.labelDescription)}</Text> : null}
                      <Pressable
                        style={[styles.revealBtn, streaming && styles.revealBtnDisabled]}
                        onPress={handleReveal}
                        disabled={streaming}
                        accessibilityRole="button"
                      >
                        <Text style={styles.revealBtnText}>{zh(streaming ? '載入中…' : '查看完整分析')}</Text>
                      </Pressable>
                    </View>
                  )
                ) : null}

                {/* Post-reveal */}
                {revealed ? (
                  <>
                    {isRomance ? (
                      <CompatibilityScoreRevealV2
                        score={displayScore}
                        label={displayLabel}
                        scoreBreakdown={rpa?.scoreBreakdown}
                        nameA={nameA}
                        nameB={nameB}
                        peachBlossomCountA={rpa?.peachBlossomCountA ?? 0}
                        peachBlossomCountB={rpa?.peachBlossomCountB ?? 0}
                        spouseStarCountA={rpa?.spouseStarCountA ?? 0}
                        spouseStarCountB={rpa?.spouseStarCountB ?? 0}
                        romancePA={rpa}
                      />
                    ) : (
                      <View style={styles.genericGate}>
                        <Text style={styles.genericScore}>
                          {displayScore}
                          <Text style={styles.genericScoreUnit}>{zh('分')}</Text>
                        </Text>
                        <Text style={styles.genericLabel}>{zh(displayLabel)}</Text>
                      </View>
                    )}

                    {/* Share the compat result as a PNG (gated on a settled score). */}
                    <ShareFortuneButton
                      label="分享合盤結果"
                      renderCard={(cardRef) => (
                        <ShareableCompatibilityCard
                          ref={cardRef}
                          score={displayScore}
                          label={displayLabel}
                          nameA={nameA}
                          nameB={nameB}
                          sweetness={sweetness}
                          stability={stability}
                        />
                      )}
                    />

                    {hourUnknownA || hourUnknownB ? (
                      <View style={[styles.hourBanner, styles.hourBannerRow]}>
                        <TriangleAlert size={16} strokeWidth={2} color={colors.warningText} />
                        <Text style={styles.hourBannerText}>
                          {zh('部分時辰相關分析受限')}
                          {hourUnknownA ? zh(`（${genderA === 'female' ? '女方' : '男方'}時辰未知）`) : ''}
                          {hourUnknownB ? zh(`（${genderB === 'female' ? '女方' : '男方'}時辰未知）`) : ''}
                        </Text>
                      </View>
                    ) : null}

                    {error ? <Text style={styles.error}>{zh(error)}</Text> : null}

                    <AIReadingDisplay data={aiData} isSubscriber isStreaming={streaming} />
                  </>
                ) : null}

                {!revealed && error ? <Text style={styles.error}>{zh(error)}</Text> : null}
              </>
            );
          })()
        : null}
      </ScrollView>

      {/* AI 命理師 chat — only after the reading is revealed (mirrors the web's
          !showPaywall gate). The chat stack is already comparisonId-aware. */}
      {step === 'result' && revealed && comparison?.id ? (
        <ChatFloatingButton hidden={fabHidden} onPress={() => setChatOpen(true)} />
      ) : null}
      {comparison?.id ? (
        <ChatSheet
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
          readingType="COMPATIBILITY"
          comparisonId={comparison.id}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgPrimary },
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  // gap 16 spaced EVERY child alike, so 「男方」 sat as far from its own chart as
  // the chart sat from 「女方」. paddingBottom must clear the ~52pt FAB at bottom:24.
  content: { padding: spacing.lg, gap: rhythm.section - 8, paddingBottom: 104 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgPrimary },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: fontSize.base, color: colors.red, fontWeight: '600' },
  partyLabel: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.lg,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.textAccent,
    marginBottom: -(rhythm.section - 8) + rhythm.afterHeading,
  },
  genericGate: {
    alignItems: 'center',
    gap: rhythm.tight,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    padding: spacing.xl,
  },
  genericScore: { fontFamily: fonts.serifBold, fontSize: 48, lineHeight: 56, fontWeight: '800', color: colors.red, fontVariant: ['tabular-nums'] },
  genericScoreUnit: { fontSize: fontSize.base, color: colors.textMuted },
  genericLabel: { fontFamily: fonts.serifBold, fontSize: fontSize.xl, fontWeight: '700', color: colors.textAccent },
  genericDesc: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  revealBtn: { backgroundColor: colors.red, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  revealBtnDisabled: { opacity: 0.6 },
  revealBtnText: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textOnRed },
  hourBanner: { backgroundColor: colors.bgBannerWarm, borderRadius: radius.md, padding: spacing.md },
  hourBannerRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  hourBannerText: { flex: 1, fontSize: fontSize.sm, lineHeight: 24, color: colors.warningText, fontWeight: '600' },
  error: { fontSize: fontSize.sm, lineHeight: 24, color: colors.error, textAlign: 'center' },
});
