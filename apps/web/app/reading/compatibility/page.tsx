"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import DualBirthDataForm from "../../components/DualBirthDataForm";
import CompatibilityScoreReveal from "../../components/CompatibilityScoreReveal";
import CompatibilityResultPage from "../../components/CompatibilityResultPage";
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
  transformAIResponse,
  type CompatibilityResponse,
  type AIReadingData,
} from "../../lib/readings-api";
import { READING_TYPE_META } from "@repo/shared";
import styles from "./page.module.css";

// ============================================================
// Types
// ============================================================

type ViewStep = "input" | "reveal" | "result";

// ============================================================
// Component
// ============================================================

export default function CompatibilityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clerkAuth = useAuth();

  // E2E test mode: bypass Clerk auth when __e2e_auth cookie is set
  // This allows Playwright to test authenticated flows without real Clerk sessions
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

  // Progressive loading: race condition guards
  const currentComparisonIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // User state
  const [savedProfiles, setSavedProfiles] = useState<BirthProfile[]>([]);
  const [userCredits, setUserCredits] = useState<number>(0);
  const [userTier, setUserTier] = useState<string>("FREE");

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

  // Cleanup: abort in-flight AI generation on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
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
        // Deep-link: load saved comparison directly to results
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
      setAiData(transformAIResponse(saved.aiInterpretation));
      setStep("result"); // Skip reveal for saved readings
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
      if (msg.includes("INSUFFICIENT_CREDITS") || msg.includes("點數不足")) {
        setShowCreditsModal(true);
        return;
      }
      setError(msg);
    } else {
      setError("發生未知錯誤，請重試");
    }
  };

  // ============================================================
  // Submit handler
  // ============================================================

  const handleSubmit = async (params: {
    profileAId: string;
    profileBId: string;
    comparisonType: string;
  }) => {
    // Cancel any in-flight Phase 2 from previous submission
    abortControllerRef.current?.abort();

    setIsLoading(true);
    setError(null);
    setAiData(null);
    setIsAILoading(false);

    try {
      const token = await getToken();
      if (!token) {
        setError("請先登入");
        return;
      }

      // Phase 1: Get calc data immediately (skip AI)
      const result = await createBaziCompatibility(token, { ...params, skipAI: true });
      const comparisonId = result.id;
      currentComparisonIdRef.current = comparisonId;
      setCompatData(result);

      // Phase 2: Trigger AI generation in background
      setIsAILoading(true);
      abortControllerRef.current = new AbortController();
      generateCompatibilityAI(token, comparisonId, abortControllerRef.current.signal)
        .then((updated) => {
          // Guard: only update state if this is still the current comparison
          if (currentComparisonIdRef.current === comparisonId) {
            setCompatData(updated);
            setAiData(transformAIResponse(updated.aiInterpretation));
          }
        })
        .catch((err) => {
          if (err?.name !== "AbortError") {
            console.error("AI generation failed:", err);
          }
          // Soft failure: calc data is still visible
        })
        .finally(() => {
          if (currentComparisonIdRef.current === comparisonId) {
            setIsAILoading(false);
          }
        });

      setStep("reveal"); // Score reveal plays immediately (~2-3s after submit)
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
    setStep("result");
  }, []);

  // ============================================================
  // Try again (reset to input)
  // ============================================================

  const handleTryAgain = useCallback(() => {
    abortControllerRef.current?.abort();
    currentComparisonIdRef.current = null;
    setCompatData(null);
    setAiData(null);
    setError(null);
    setIsAILoading(false);
    setAnalyzingStep(0);
    setStep("input");
    // Refresh credits since one was used
    refreshUserProfile();
  }, [refreshUserProfile]);

  // ============================================================
  // Recalculate (annual update)
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
      refreshUserProfile(); // Refresh credit balance
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

  return (
    <div className={styles.pageContainer}>
      {/* Header */}
      <div className={styles.header}>
        <Link href="/" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10 2 4 8 10 14" /></svg>
          返回
        </Link>
        <h1 className={styles.headerTitle}>
          <span className={styles.headerIcon}>🤝</span>
          八字合盤分析
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
        <DualBirthDataForm
          onSubmit={handleSubmit}
          isLoading={isLoading}
          error={error}
          savedProfiles={savedProfiles}
          userCredits={userCredits}
          creditCost={creditCost}
          getTokenOverride={isE2ETestMode ? getToken : undefined}
        />
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

      {/* Score reveal animation */}
      {step === "reveal" && compatData && (
        <CompatibilityScoreReveal
          score={compatData.calculationData?.adjustedScore ?? compatData.calculationData?.overallScore ?? 0}
          label={compatData.calculationData?.label ?? ""}
          specialLabel={compatData.calculationData?.specialLabel ?? null}
          onComplete={handleRevealComplete}
        />
      )}

      {/* Full results */}
      {step === "result" && compatData && (
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
