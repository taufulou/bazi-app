"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import DualBirthDataForm from "../../components/DualBirthDataForm";
import CompatibilityScoreReveal from "../../components/CompatibilityScoreReveal";
import CompatibilityResultPage from "../../components/CompatibilityResultPage";
import CompatibilityRomancePaywallCTA from "../../components/CompatibilityRomancePaywallCTA";
import BaziChart from "../../components/BaziChart";
import AIReadingDisplay from "../../components/AIReadingDisplay";
import InsufficientCreditsModal from "../../components/InsufficientCreditsModal";
import { getUserProfile } from "../../lib/api";
import {
  fetchBirthProfiles,
  type BirthProfile,
} from "../../lib/birth-profiles-api";
import {
  createBaziCompatibility,
  getCompatibility,
  recalculateCompatibility,
  generateCompatibilityAI,
  streamCompatibilityReading,
  transformAIResponse,
  SECTION_TITLE_MAP,
  COMPAT_ROMANCE_V2_ALL_SECTION_KEYS,
  type CompatibilityResponse,
  type AIReadingData,
} from "../../lib/readings-api";
import { READING_TYPE_META, ENTERTAINMENT_DISCLAIMER } from "@repo/shared";
import CompatibilityScoreRevealV2 from '../../components/CompatibilityScoreRevealV2';
import styles from "./page.module.css";

// ============================================================
// Types
// ============================================================

type ViewStep = "input" | "reveal" | "result";

// ============================================================
// Helpers
// ============================================================

/** Detect if a comparison response is V2 romance */
function isV2Romance(data: CompatibilityResponse | null): boolean {
  if (!data) return false;
  return (
    data.aiVersion === 2 ||
    data.aiInterpretation?.schemaVersion === 'v2'
  );
}

// ============================================================
// V2 Dynamic section title overrides
// ============================================================

function getCompatV2DynamicTitle(
  key: string,
  genderA: string,
  genderB: string,
  currentYear: number,
): string | null {
  switch (key) {
    case 'spouse_enrichment_a':
      return genderA === 'male' ? '男方旺妻程度' : '女方旺夫程度';
    case 'spouse_enrichment_b':
      return genderB === 'male' ? '男方旺妻程度' : '女方旺夫程度';
    case 'annual_love_a':
      return `男方${currentYear}感情運`;
    case 'annual_love_b':
      return `女方${currentYear}感情運`;
    default:
      return null;
  }
}

// ============================================================
// Static Educational Component: ke_fu_ke_qi
// ============================================================

function KeFuKeQiEducation() {
  return (
    <div className={styles.educationalCard}>
      <div className={styles.educationalHeader}>
        <span className={styles.educationalIcon}>📖</span>
        <h3 className={styles.educationalTitle}>正確看待「克夫克妻」</h3>
      </div>
      <div className={styles.educationalContent}>
        <p>
          在傳統命理中，「克夫」「克妻」等說法常引起恐慌。但現代命理學認為，
          這些說法需要放在完整的命盤脈絡中理解，而非單獨論斷。
        </p>
        <p>
          所謂「克」其實是五行之間的正常互動關係。每個人的命盤都有生、克、
          制、化的循環，關鍵在於整體平衡。一個命局中的「克」，往往可以被其他
          因素化解或轉化。
        </p>
        <p>
          現代合婚分析更注重雙方命局的整體互動：互補的五行、十神的配合、
          大運流年的同步性等綜合因素，而非單一的「克」論。婚姻幸福更取決於
          雙方的理解、包容與共同成長。
        </p>
      </div>
    </div>
  );
}


// ============================================================
// Streaming loading messages (Chinese)
// ============================================================

const STREAMING_MESSAGES = [
  "正在分析雙方命局特點...",
  "正在解讀戀愛性格...",
  "正在計算旺夫旺妻程度...",
  "正在分析婚前婚後財富...",
  "正在評估婚後甜蜜度...",
  "正在預測婚變風險...",
  "正在分析合婚危機...",
  "正在撰寫經營建議...",
  "正在計算流年感情運...",
  "正在生成綜合總結...",
];

// ============================================================
// Component
// ============================================================

export default function CompatibilityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clerkAuth = useAuth();

  // E2E test mode: bypass Clerk auth when __e2e_auth cookie is set
  const isE2ETestMode =
    typeof window !== "undefined" && document.cookie.includes("__e2e_auth=1");
  const isSignedIn = isE2ETestMode || clerkAuth.isSignedIn;
  const isLoaded = isE2ETestMode || clerkAuth.isLoaded;
  const getToken = isE2ETestMode
    ? async () => "e2e-mock-token"
    : clerkAuth.getToken;

  // View step
  const [step, setStep] = useState<ViewStep | null>(null);

  // Data
  const [compatData, setCompatData] = useState<CompatibilityResponse | null>(null);
  const [aiData, setAiData] = useState<AIReadingData | null>(null);

  // Loading & errors
  const [isLoading, setIsLoading] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  // V2 paywall state
  const [showPaywall, setShowPaywall] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // Progressive loading: race condition guards
  const currentComparisonIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamCleanupRef = useRef<(() => void) | null>(null);

  // V2 streaming message index
  const [streamingMsgIndex, setStreamingMsgIndex] = useState(0);

  // User state
  const [savedProfiles, setSavedProfiles] = useState<BirthProfile[]>([]);
  const [userCredits, setUserCredits] = useState<number>(0);
  const [userTier, setUserTier] = useState<string>("FREE");

  // Saved form params for V2 unlock (need profile IDs to create comparison with AI)
  const savedSubmitParamsRef = useRef<{
    profileAId: string;
    profileBId: string;
    comparisonType: string;
  } | null>(null);

  // Analyzing step animation (0 = 排盤計算中, 1 = 八維度評分)
  const [analyzingStep, setAnalyzingStep] = useState(0);
  const analyzingTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isLoading && step === "input") {
      setAnalyzingStep(0);
      analyzingTimerRef.current = setTimeout(() => setAnalyzingStep(1), 1500);
      return () => {
        if (analyzingTimerRef.current) clearTimeout(analyzingTimerRef.current);
      };
    }
  }, [isLoading, step]);

  // Cleanup: abort in-flight operations on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      streamCleanupRef.current?.();
    };
  }, []);

  // Credit cost from shared constants
  const creditCost = READING_TYPE_META["compatibility"]?.creditCost ?? 3;

  // Deep link param
  const readingIdParam = searchParams.get("id");

  // ============================================================
  // Auth guard + initial step
  // ============================================================

  useEffect(() => {
    if (isLoaded && step === null) {
      if (readingIdParam && isSignedIn) {
        loadSavedComparison(readingIdParam);
      } else {
        setStep("input");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, step, readingIdParam, isSignedIn]);

  // ============================================================
  // Fetch user profile + saved profiles on mount
  // ============================================================

  const refreshUserProfile = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      if (!token) return;
      const profile = await getUserProfile(token);
      setUserCredits(profile.credits);
      setUserTier(profile.subscriptionTier);
    } catch {
      /* silent */
    }
  }, [isSignedIn, getToken]);

  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const [profiles, profile] = await Promise.all([
          fetchBirthProfiles(token).catch(() => [] as BirthProfile[]),
          getUserProfile(token).catch(() => null),
        ]);

        setSavedProfiles(profiles);

        if (profile) {
          setUserCredits(profile.credits);
          setUserTier(profile.subscriptionTier || "FREE");
        }
      } catch {
        /* silent */
      }
    })();
  }, [isSignedIn, getToken]);

  // Refresh credits when tab becomes visible (return from /pricing)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshUserProfile();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refreshUserProfile]);

  // ============================================================
  // Load saved comparison (deep-link)
  // ============================================================

  const loadSavedComparison = async (id: string) => {
    setIsLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setError("請先登入");
        setStep("input");
        return;
      }
      const saved = await getCompatibility(token, id);
      setCompatData(saved);
      currentComparisonIdRef.current = saved.id; // Restore ref for handleRomanceUnlock

      // Check if this is a V2 romance comparison without AI yet (paywall state)
      // Note: CompatibilityCalculationData interface doesn't declare romancePreAnalysis, so cast needed
      const isV2Romance = (saved.calculationData as any)?.romancePreAnalysis;
      if (isV2Romance && !saved.aiInterpretation) {
        // Restore paywall state — credits already deducted, user just needs to unlock
        setStep("result");
        setShowPaywall(true);
      } else {
        // Has AI — show full results
        setAiData(transformAIResponse(saved.aiInterpretation));
        setStep("result");
      }
    } catch {
      setError("無法載入分析結果");
      setStep("input");
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Error handler
  // ============================================================

  const handleNestJSError = (err: unknown) => {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes("INSUFFICIENT_CREDITS") || msg.includes("點數不足") || msg.includes("Insufficient credits")) {
        setShowCreditsModal(true);
        return;
      }
      setError(msg);
    } else {
      setError("發生未知錯誤，請重試");
    }
  };

  // ============================================================
  // Submit handler — V2 romance: skipAI (free score), show paywall
  //                  V1 business/friendship: full AI (existing flow)
  // ============================================================

  const handleSubmit = async (params: {
    profileAId: string;
    profileBId: string;
    comparisonType: string;
  }) => {
    // Cancel any in-flight operations from previous submission
    abortControllerRef.current?.abort();
    streamCleanupRef.current?.();

    setIsLoading(true);
    setError(null);
    setAiData(null);
    setIsAILoading(false);
    setShowPaywall(false);
    setIsStreaming(false);

    const isRomance = params.comparisonType === "romance";

    try {
      const token = await getToken();
      if (!token) {
        setError("請先登入");
        return;
      }

      if (isRomance) {
        // V2 Romance: Phase 1 — get calc data only (free, no AI, no credits)
        const result = await createBaziCompatibility(token, { ...params, skipAI: true });
        currentComparisonIdRef.current = result.id;
        savedSubmitParamsRef.current = params;
        setCompatData(result);

        // Silently update URL so page reload can restore state via loadSavedComparison
        window.history.replaceState(null, '', `?id=${result.id}`);

        // V2: skip reveal, go straight to dual charts + paywall
        setStep("result");
        setShowPaywall(true);
      } else {
        // V1 Business/Friendship: existing two-phase flow (calc + AI in background)
        const result = await createBaziCompatibility(token, { ...params, skipAI: true });
        const comparisonId = result.id;
        currentComparisonIdRef.current = comparisonId;
        setCompatData(result);

        // Phase 2: Trigger AI generation in background
        setIsAILoading(true);
        abortControllerRef.current = new AbortController();
        generateCompatibilityAI(token, comparisonId, abortControllerRef.current.signal)
          .then((updated) => {
            if (currentComparisonIdRef.current === comparisonId) {
              setCompatData(updated);
              setAiData(transformAIResponse(updated.aiInterpretation));
            }
          })
          .catch((err) => {
            if (err?.name !== "AbortError") {
              console.error("AI generation failed:", err);
            }
          })
          .finally(() => {
            if (currentComparisonIdRef.current === comparisonId) {
              setIsAILoading(false);
            }
          });

        setStep("reveal");
      }
    } catch (err) {
      handleNestJSError(err);
      setIsAILoading(false);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Reveal → Result transition
  // ============================================================

  const handleRevealComplete = useCallback(() => {
    const isRomance = savedSubmitParamsRef.current?.comparisonType === "romance";
    setStep("result");
    if (isRomance) {
      // Show paywall for romance V2 after score reveal
      setShowPaywall(true);
    }
  }, []);

  // ============================================================
  // V2 Romance Unlock: deduct credits → stream AI sections
  // ============================================================

  async function handleRomanceUnlock() {
    setIsUnlocking(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("請先登入");

      // Reuse the comparison already created in handleSubmit (credits already deducted there)
      const comparisonId = currentComparisonIdRef.current;
      if (!comparisonId) throw new Error("找不到合盤資料");

      // Hide paywall, show streaming state, start SSE for AI generation
      setShowPaywall(false);
      setIsStreaming(true);
      setStreamingMsgIndex(0);
      setAiData({ sections: [], isV2: true });

      const msgInterval = setInterval(() => {
        setStreamingMsgIndex((prev) => Math.min(prev + 1, STREAMING_MESSAGES.length - 1));
      }, 3000);

      // Call SSE stream endpoint — AI generates on server, sections arrive progressively
      const stream = streamCompatibilityReading(token, comparisonId, {
        onSectionComplete: (key, section) => {
          setAiData((prev) => ({
            ...prev!,
            sections: [
              ...(prev?.sections || []),
              {
                key,
                title: SECTION_TITLE_MAP[key] || key,
                preview: section.preview,
                full: section.full,
                score: section.score,
              },
            ],
          }));
        },
        onCallComplete: () => {
          setStreamingMsgIndex((prev) => Math.min(prev + 2, STREAMING_MESSAGES.length - 1));
        },
        onSummary: (summary) => {
          setAiData((prev) => ({
            ...prev!,
            summary: { text: summary.full || summary.preview },
          }));
        },
        onDone: () => {
          clearInterval(msgInterval);
          setIsStreaming(false);
        },
        onError: (err) => {
          clearInterval(msgInterval);
          setIsStreaming(false);
          // Keep any partial sections that already arrived — don't wipe them
          setAiData((prev) => {
            const hasPartial = prev && prev.sections && prev.sections.length > 0;
            if (hasPartial) {
              // Partial success — keep sections, show note
              setError("部分分析已完成。重新整理頁面可嘗試載入剩餘內容。");
            } else if (!err.partial) {
              setError("AI 分析生成中，請稍後重新整理此頁面。您的額度不會重複扣除。");
            }
            return prev;
          });
        },
      });

      streamCleanupRef.current = () => {
        clearInterval(msgInterval);
        stream.close();
      };
    } catch (err) {
      handleNestJSError(err);
    } finally {
      setIsUnlocking(false);
    }
  }

  // ============================================================
  // Try again (reset to input)
  // ============================================================

  const handleTryAgain = useCallback(() => {
    abortControllerRef.current?.abort();
    streamCleanupRef.current?.();
    currentComparisonIdRef.current = null;
    savedSubmitParamsRef.current = null;
    setCompatData(null);
    setAiData(null);
    setError(null);
    setIsAILoading(false);
    setIsStreaming(false);
    setShowPaywall(false);
    setAnalyzingStep(0);
    setStep("input");
    refreshUserProfile();
  }, [refreshUserProfile]);

  // ============================================================
  // Recalculate (annual update — V1 only, V2 TBD)
  // ============================================================

  const handleRecalculate = useCallback(async () => {
    if (!compatData?.id) return;
    setIsRecalculating(true);
    try {
      const token = await getToken();
      if (!token) {
        setError("請先登入");
        return;
      }
      const updated = await recalculateCompatibility(token, compatData.id);
      setCompatData(updated);
      setAiData(transformAIResponse(updated.aiInterpretation));
      refreshUserProfile();
    } catch (err) {
      handleNestJSError(err);
    } finally {
      setIsRecalculating(false);
    }
  }, [compatData?.id, getToken, refreshUserProfile]);

  // ============================================================
  // Render
  // ============================================================

  // Loading skeleton while Clerk resolves or deep-link loads
  if (!isLoaded || step === null) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.loadingSkeleton}>
          <div className={styles.skeletonTitle} />
          <div className={styles.skeletonBlock} />
          <div className={styles.skeletonBlock} />
        </div>
      </div>
    );
  }

  // Determine if we're in V2 mode
  const isV2 = isV2Romance(compatData);
  // Also consider if the current submission is romance (before AI version is set)
  const isCurrentRomance = savedSubmitParamsRef.current?.comparisonType === "romance";

  // Determine which sections have been streamed so far (for progress)
  const streamedSectionCount = aiData?.sections?.length ?? 0;

  // Check if the educational section should be inserted
  // Insert after love_personality_b (戀愛性格), BEFORE spouse_enrichment_a (旺夫旺妻)
  const EDUCATION_INSERT_AFTER = 'love_personality_b';

  return (
    <div className={styles.pageContainer}>
      {/* Header */}
      <div className={styles.header}>
        <Link href="/" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10 2 4 8 10 14" /></svg>
          返回
        </Link>
        <h1 className={styles.headerTitle}>
          <span className={styles.headerIcon}>💕</span>
          八字感情合盤
        </h1>
        <div style={{ width: 60 }} /> {/* Spacer for centering */}
      </div>

      {/* Auth guard: show sign-in prompt for unauthenticated users */}
      {!isSignedIn && (
        <div className={styles.authGuard}>
          <h2 className={styles.authTitle}>請先登入</h2>
          <p className={styles.authSubtitle}>
            合盤分析需要登入後才能使用
          </p>
          <SignInButton mode="modal">
            <button className={styles.signInBtn}>登入 / 註冊</button>
          </SignInButton>
        </div>
      )}

      {/* Input step — hide form when loading (show analyzing state instead) */}
      {isSignedIn && step === "input" && !isLoading && (
        <div className={styles.formSection}>
          <DualBirthDataForm
            onSubmit={handleSubmit}
            isLoading={isLoading}
            error={error}
            savedProfiles={savedProfiles}
            userCredits={userCredits}
            creditCost={creditCost}
            getTokenOverride={isE2ETestMode ? getToken : undefined}
          />
        </div>
      )}

      {/* Analyzing state — shown immediately after clicking 開始分析 */}
      {isSignedIn && isLoading && step === "input" && (
        <div className={styles.analyzingState}>
          <div className={styles.analyzingCard}>
            <div className={styles.analyzingIconWrap}>
              <span className={styles.analyzingIcon}>🔮</span>
              <div className={styles.analyzingRing} />
            </div>
            <h3 className={styles.analyzingTitle}>合盤分析中</h3>
            <p className={styles.analyzingSubtitle}>
              正在計算八字契合度與八維度分析...
            </p>
            <div className={styles.analyzingSteps}>
              <div className={`${styles.analyzingStep} ${analyzingStep >= 0 ? styles.analyzingStepActive : ""}`}>
                <span className={styles.stepDot} />
                <span>排盤計算中{analyzingStep === 0 ? "..." : " ✓"}</span>
              </div>
              <div className={`${styles.analyzingStep} ${analyzingStep >= 1 ? styles.analyzingStepActive : ""}`}>
                <span className={styles.stepDot} />
                <span>八維度評分{analyzingStep >= 1 ? "..." : ""}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay during deep-link fetch */}
      {isSignedIn && isLoading && step !== "input" && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>載入中...</p>
        </div>
      )}

      {/* Score reveal animation — only for non-V2 (business/friendship) */}
      {step === "reveal" && compatData && !isCurrentRomance && (
        <CompatibilityScoreReveal
          score={compatData.calculationData?.adjustedScore ?? compatData.calculationData?.overallScore ?? 0}
          label={compatData.calculationData?.label ?? ""}
          specialLabel={compatData.calculationData?.specialLabel ?? null}
          onComplete={handleRevealComplete}
        />
      )}

      {/* Full results — V2 romance path */}
      {step === "result" && compatData && (isV2 || isCurrentRomance) && (() => {
        const calcData = compatData?.calculationData as any;
        const chartDataA = calcData?.chartA;
        const chartDataB = calcData?.chartB;
        const nameA = compatData?.profileA?.name || '男方';
        const nameB = compatData?.profileB?.name || '女方';
        const profileABirthDate = compatData?.profileA?.birthDate;
        const profileBBirthDate = compatData?.profileB?.birthDate;
        // V7-E: Prefer blendedScore for V2 romance
        const romancePA = calcData?.romancePreAnalysis;
        const displayScore = romancePA?.blendedScore ?? calcData?.adjustedScore ?? calcData?.overallScore ?? 0;
        const displayLabel = romancePA?.blendedLabel ?? calcData?.label ?? '';
        return (
        <>
          {/* Free section: Dual BaziCharts side-by-side */}
          <div className={styles.freeChartsSection}>
            {/* Labels removed — chartPanelLabel inside each panel already shows 男方/女方 */}
            <div className={styles.dualChartsGrid}>
              <div className={styles.chartPanel}>
                <div className={styles.chartPanelLabel}>男方</div>
                <BaziChart data={chartDataA} name={nameA} birthDate={profileABirthDate} hideSections={[2, 4, 5]} isSubscriber={userTier !== "FREE"} gender={(chartDataA?.gender as string) || 'male'} />
              </div>
              <div className={styles.chartPanel}>
                <div className={styles.chartPanelLabel}>女方</div>
                <BaziChart data={chartDataB} name={nameB} birthDate={profileBBirthDate} hideSections={[2, 4, 5]} isSubscriber={userTier !== "FREE"} gender={(chartDataB?.gender as string) || 'female'} />
              </div>
            </div>
          </div>

          {/* Paywall CTA — shown before unlock */}
          {showPaywall && (
            <div className={styles.paywallSection}>
              <CompatibilityRomancePaywallCTA
                creditCost={creditCost}
                currentCredits={userCredits}
                isSubscriber={userTier !== "FREE"}
                isSignedIn={!!isSignedIn}
                onUnlock={handleRomanceUnlock}
                isUnlocking={isUnlocking}
                onCreditsRefresh={refreshUserProfile}
              />
            </div>
          )}

          {/* Streaming status indicator */}
          {isStreaming && (
            <div className={styles.streamingStatus}>
              <div className={styles.streamingDot} />
              <span className={styles.streamingText}>
                {STREAMING_MESSAGES[streamingMsgIndex] || "正在生成分析報告..."}
              </span>
            </div>
          )}

          {/* V2 AI Sections — streamed progressively (also render during streaming for skeleton) */}
          {aiData && aiData.sections && (aiData.sections.length > 0 || isStreaming) && (() => {
            const calcData = compatData?.calculationData as any;
            const rpa = calcData?.romancePreAnalysis;
            const chartA = calcData?.chartA;
            const chartB = calcData?.chartB;
            const genderA = (chartA?.gender as string) || 'male';
            const genderB = (chartB?.gender as string) || 'female';
            const currentYear = (calcData?.current_year as number) || new Date().getFullYear();
            return (
            <div className={styles.v2SectionsContainer}>
              {/* V7-G: Combined score reveal + badges + 老師寄語 (post-paywall) */}
              <CompatibilityScoreRevealV2
                score={displayScore}
                label={displayLabel}
                scoreBreakdown={romancePA?.scoreBreakdown}
                nameA={nameA}
                nameB={nameB}
                peachBlossomCountA={romancePA?.peachBlossomCountA ?? 0}
                peachBlossomCountB={romancePA?.peachBlossomCountB ?? 0}
                spouseStarCountA={romancePA?.spouseStarCountA ?? 0}
                spouseStarCountB={romancePA?.spouseStarCountB ?? 0}
                romancePA={romancePA}
              />

              {/* Unknown birth time warning */}
              {(rpa?.lovePersonalityA?.hourUnknown || rpa?.lovePersonalityB?.hourUnknown) && (
                <div className={styles.hourUnknownBanner}>
                  <span>&#9888;&#65039;</span> 部分時辰相關分析受限
                  {rpa?.lovePersonalityA?.hourUnknown && <span>（男方時辰未知）</span>}
                  {rpa?.lovePersonalityB?.hourUnknown && <span>（女方時辰未知）</span>}
                </div>
              )}
              {(() => {
                // Apply dynamic titles to all sections
                const sectionsWithTitles = aiData.sections.map((section) => {
                  const dynamicTitle = getCompatV2DynamicTitle(section.key, genderA, genderB, currentYear);
                  return dynamicTitle ? { ...section, title: dynamicTitle } : section;
                });

                return (
                  <>
                    {/* Render ALL sections in ONE AIReadingDisplay */}
                    <AIReadingDisplay
                      data={{ sections: sectionsWithTitles, isV2: true }}
                      readingType="compatibility"
                      isSubscriber={true}
                      isLoading={false}
                      isStreaming={isStreaming}
                      chartData={{ romancePreAnalysis: rpa, compatibilityPreAnalysis: calcData?.compatibilityPreAnalysis, chartA, chartB, currentYear }}
                      renderAfterSection={(key) =>
                        key === EDUCATION_INSERT_AFTER ? <KeFuKeQiEducation /> : null
                      }
                    />
                  </>
                );
              })()}

              {/* Streaming: show placeholder for sections not yet arrived */}
              {isStreaming && streamedSectionCount < COMPAT_ROMANCE_V2_ALL_SECTION_KEYS.length && (
                <div className={styles.streamingStatus} style={{ opacity: 0.6 }}>
                  <div className={styles.streamingDot} />
                  <span className={styles.streamingText}>
                    還有 {COMPAT_ROMANCE_V2_ALL_SECTION_KEYS.length - streamedSectionCount} 個分析項目正在生成中...
                  </span>
                </div>
              )}
            </div>
            );
          })()}

          {/* Error display */}
          {error && (
            <div className={styles.paywallSection}>
              <p style={{ color: "var(--color-red)", textAlign: "center" }}>{error}</p>
            </div>
          )}

          {/* Entertainment disclaimer — always visible in V2 result view */}
          <p className={styles.disclaimer}>
            {ENTERTAINMENT_DISCLAIMER["zh-TW"]}
          </p>

          {/* New comparison button */}
          {!isStreaming && !showPaywall && aiData && aiData.sections && aiData.sections.length > 0 && (
            <div className={styles.newComparisonArea}>
              <button className={styles.newComparisonBtn} onClick={handleTryAgain}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10 2 4 8 10 14" /></svg>
                重新分析
              </button>
            </div>
          )}
        </>
        );
      })()}

      {/* Full results — V1 path (business/friendship, or legacy romance) */}
      {step === "result" && compatData && !isV2 && !isCurrentRomance && (
        <CompatibilityResultPage
          data={compatData}
          aiData={aiData}
          isSubscriber={userTier !== "FREE"}
          onNewComparison={handleTryAgain}
          onRecalculate={handleRecalculate}
          isRecalculating={isRecalculating}
          isAILoading={isAILoading}
        />
      )}

      {/* Insufficient credits modal */}
      <InsufficientCreditsModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
        onViewChart={() => setShowCreditsModal(false)}
        currentCredits={userCredits}
        requiredCredits={creditCost}
        readingName="合盤分析"
      />
    </div>
  );
}
