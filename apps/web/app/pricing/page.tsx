"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import { DEFAULT_PLANS } from "@repo/shared";
import { createSubscriptionCheckout, upgradeSubscription, getUserProfile } from "../lib/api";
import styles from "./page.module.css";

// ============================================================
// Plan metadata (features, descriptions, CTA text)
// ============================================================

interface PlanInfo {
  key: keyof typeof DEFAULT_PLANS;
  name: string;
  description: string;
  features: string[];
  readingsLabel: string;
  isRecommended: boolean;
}

const PLANS: PlanInfo[] = [
  {
    key: "basic",
    name: "Basic",
    description: "適合初次體驗八字命理的用戶",
    features: [
      "每月 5 次命理解讀",
      "完整八字終身運分析",
      "基礎流年運勢",
      "命盤視覺化圖表",
      "電子郵件客服支援",
    ],
    readingsLabel: "每月 5 次解讀",
    isRecommended: false,
  },
  {
    key: "pro",
    name: "Pro",
    description: "全方位命理分析，適合深度探索命運",
    features: [
      "每月 15 次命理解讀",
      "全部 6 種解讀類型",
      "PDF 報告匯出",
      "優先 AI 分析引擎",
      "進階流年運勢與流月分析",
      "優先客服支援",
    ],
    readingsLabel: "每月 15 次解讀",
    isRecommended: true,
  },
  {
    key: "master",
    name: "Master",
    description: "無限制使用，專為命理愛好者打造",
    features: [
      "無限次數命理解讀",
      "全部功能完整開放",
      "搶先體驗新功能",
      "PDF 報告匯出",
      "最高優先 AI 分析引擎",
      "專屬 VIP 客服通道",
      "合盤比較無限次數",
    ],
    readingsLabel: "無限次解讀",
    isRecommended: false,
  },
];

// Comparison table rows: [featureLabel, free, basic, pro, master]
type ComparisonValue = string | boolean;
const COMPARISON_ROWS: [string, ComparisonValue, ComparisonValue, ComparisonValue, ComparisonValue][] = [
  ["每月解讀次數", "1 次（終身）", "5 次", "15 次", "無限"],
  ["八字終身運", "預覽", true, true, true],
  ["流年運勢", false, "基礎", "進階", "進階"],
  ["事業財運分析", false, false, true, true],
  ["愛情姻緣分析", false, false, true, true],
  ["先天健康分析", false, false, true, true],
  ["合盤比較", false, false, true, true],
  ["PDF 報告匯出", false, false, true, true],
  ["優先 AI 引擎", false, false, true, true],
  ["搶先體驗新功能", false, false, false, true],
  ["VIP 專屬客服", false, false, false, true],
];

// ============================================================
// Helper: calculate savings percentage
// ============================================================

const TIER_META: Record<string, { name: string }> = {
  FREE: { name: "免費方案" },
  BASIC: { name: "Basic 方案" },
  PRO: { name: "Pro 方案" },
  MASTER: { name: "Master 方案" },
};

function calcSavingsPercent(monthly: number, annual: number): number {
  const fullYearPrice = monthly * 12;
  return Math.round(((fullYearPrice - annual) / fullYearPrice) * 100);
}

// ============================================================
// Component
// ============================================================

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" } | null>(null);
  const [currentTier, setCurrentTier] = useState<string>("FREE");
  const [changeTarget, setChangeTarget] = useState<{ key: string; name: string; direction: "upgrade" | "downgrade" } | null>(null);

  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const searchParams = useSearchParams();

  // ---- Fetch current user tier ----
  useEffect(() => {
    if (!isSignedIn) {
      setCurrentTier("FREE");
      return;
    }
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const profile = await getUserProfile(token);
        setCurrentTier(profile.subscriptionTier);
      } catch {
        // Silent — default to FREE
      }
    })();
  }, [isSignedIn, getToken]);

  // ---- Handle success/cancel query params ----
  useEffect(() => {
    const subscription = searchParams.get("subscription");
    const cancelled = searchParams.get("cancelled");

    if (subscription === "success") {
      setToast({ message: "訂閱成功！歡迎加入", type: "success" });
    } else if (cancelled === "true") {
      setToast({ message: "已取消結帳流程，您可隨時再訂閱", type: "info" });
    }
  }, [searchParams]);

  // ---- Auto-dismiss toast ----
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ---- Handle plan change (upgrade or downgrade via Stripe API) ----
  const handlePlanChange = useCallback(
    async (planKey: string, direction: "upgrade" | "downgrade") => {
      setChangeTarget(null);
      setError(null);
      setLoadingPlan(planKey);

      try {
        const token = await getToken();
        if (!token) throw new Error("無法取得認證令牌，請重新登入");

        await upgradeSubscription(token, {
          planSlug: planKey,
          billingCycle: isAnnual ? "annual" : "monthly",
        });

        setCurrentTier(planKey.toUpperCase());
        setToast({
          message: direction === "upgrade" ? "方案升級成功！" : "方案已變更成功！",
          type: "success",
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "變更方案時發生錯誤，請稍後再試";
        setError(message);
      } finally {
        setLoadingPlan(null);
      }
    },
    [isAnnual, getToken],
  );

  // ---- Handle checkout ----
  const handleCheckout = useCallback(
    async (planKey: string) => {
      setError(null);

      // Not signed in → redirect to sign-in with return URL
      if (!isSignedIn) {
        window.location.href = `/sign-in?redirect_url=${encodeURIComponent("/pricing")}`;
        return;
      }

      setLoadingPlan(planKey);

      try {
        const token = await getToken();
        if (!token) {
          throw new Error("無法取得認證令牌，請重新登入");
        }

        const origin = window.location.origin;
        const session = await createSubscriptionCheckout(token, {
          planSlug: planKey,
          billingCycle: isAnnual ? "annual" : "monthly",
          successUrl: `${origin}/dashboard?subscription=success`,
          cancelUrl: `${origin}/pricing?cancelled=true`,
        });

        // Redirect to Stripe Checkout
        window.location.href = session.url;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "結帳時發生錯誤，請稍後再試";
        setError(message);
        setLoadingPlan(null);
      }
    },
    [isSignedIn, isAnnual, getToken],
  );

  return (
    <div className={styles.pageContainer}>
      {/* ---- Toast Notification ---- */}
      {toast && (
        <div
          className={`${styles.toast} ${toast.type === "success" ? styles.toastSuccess : styles.toastInfo}`}
          role="alert"
        >
          <span>{toast.message}</span>
          <button
            className={styles.toastClose}
            onClick={() => setToast(null)}
            aria-label="關閉通知"
          >
            &times;
          </button>
        </div>
      )}

      {/* ---- Header ---- */}
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>選擇您的方案</h1>
        <p className={styles.pageSubtitle}>
          從免費體驗到無限探索，找到最適合您的命理旅程方案
        </p>
      </header>

      {/* ---- Error Banner ---- */}
      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          <button
            className={styles.errorClose}
            onClick={() => setError(null)}
            aria-label="關閉錯誤"
          >
            &times;
          </button>
        </div>
      )}

      {/* ---- Billing Toggle ---- */}
      <div className={styles.billingToggle}>
        <span
          className={`${styles.billingLabel} ${!isAnnual ? styles.billingLabelActive : ""}`}
          onClick={() => setIsAnnual(false)}
        >
          月繳
        </span>

        <div
          className={styles.toggleTrack}
          onClick={() => setIsAnnual((prev) => !prev)}
          role="switch"
          aria-checked={isAnnual}
          aria-label="切換月繳或年繳"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsAnnual((prev) => !prev);
            }
          }}
        >
          <div
            className={`${styles.toggleThumb} ${isAnnual ? styles.toggleThumbAnnual : ""}`}
          />
        </div>

        <span
          className={`${styles.billingLabel} ${isAnnual ? styles.billingLabelActive : ""}`}
          onClick={() => setIsAnnual(true)}
        >
          年繳
        </span>

        {isAnnual && <span className={styles.savingsBadge}>最高省 33%</span>}
      </div>

      {/* ---- Plan Cards ---- */}
      <div className={styles.plansGrid}>
        {PLANS.map((plan) => {
          const defaults = DEFAULT_PLANS[plan.key];
          const monthlyPrice = defaults.priceMonthly;
          const annualPrice = defaults.priceAnnual;
          const displayPrice = isAnnual
            ? (annualPrice / 12).toFixed(2)
            : monthlyPrice.toFixed(2);
          const savings = calcSavingsPercent(monthlyPrice, annualPrice);
          const isLoading = loadingPlan === plan.key;

          // Determine relationship between current tier and this plan
          const TIER_ORDER: Record<string, number> = { FREE: 0, BASIC: 1, PRO: 2, MASTER: 3 };
          const planTier = plan.key.toUpperCase();
          const currentLevel = TIER_ORDER[currentTier] ?? 0;
          const planLevel = TIER_ORDER[planTier] ?? 0;
          const isCurrentPlan = currentTier === planTier;
          const isUpgrade = planLevel > currentLevel;
          const isDowngrade = planLevel < currentLevel;

          return (
            <div
              key={plan.key}
              className={`${styles.planCard} ${plan.isRecommended ? styles.planCardRecommended : ""} ${isCurrentPlan ? styles.planCardCurrent : ""}`}
            >
              {isCurrentPlan && (
                <div className={styles.currentBadge}>目前方案</div>
              )}
              {plan.isRecommended && !isCurrentPlan && (
                <div className={styles.recommendedBadge}>推薦</div>
              )}

              <h2 className={styles.planName}>{plan.name}</h2>
              <p className={styles.planDescription}>{plan.description}</p>

              {/* Price */}
              <div className={styles.priceBlock}>
                <div className={styles.priceRow}>
                  <span className={styles.priceCurrency}>$</span>
                  <span className={styles.priceAmount}>{displayPrice}</span>
                  <span className={styles.pricePeriod}>/月</span>
                </div>
                {isAnnual && (
                  <div className={styles.priceAnnualNote}>
                    年繳 ${annualPrice.toFixed(2)}/年
                    <span className={styles.priceOriginal}>
                      ${(monthlyPrice * 12).toFixed(2)}
                    </span>
                    {" "}省 {savings}%
                  </div>
                )}
              </div>

              {/* Readings count */}
              <div className={styles.readingsCount}>{plan.readingsLabel}</div>

              {/* Feature list */}
              <ul className={styles.featureList}>
                {plan.features.map((feat) => (
                  <li key={feat} className={styles.featureItem}>
                    <span className={styles.featureCheck}>&#10003;</span>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              {/* CTA Button — context-aware */}
              {isCurrentPlan ? (
                <Link href="/dashboard/subscription" className={`${styles.ctaButton} ${styles.ctaCurrent}`}>
                  管理訂閱
                </Link>
              ) : isDowngrade ? (
                <button
                  className={`${styles.ctaButton} ${styles.ctaDowngrade} ${isLoading ? styles.ctaLoading : ""}`}
                  onClick={() => setChangeTarget({ key: plan.key, name: plan.name, direction: "downgrade" })}
                  disabled={loadingPlan !== null}
                >
                  {isLoading ? (
                    <span className={styles.spinner} aria-label="載入中" />
                  ) : (
                    "降級方案"
                  )}
                </button>
              ) : isUpgrade && currentTier !== "FREE" ? (
                <button
                  className={`${styles.ctaButton} ${plan.isRecommended ? styles.ctaPrimary : styles.ctaSecondary} ${isLoading ? styles.ctaLoading : ""}`}
                  onClick={() => setChangeTarget({ key: plan.key, name: plan.name, direction: "upgrade" })}
                  disabled={loadingPlan !== null}
                >
                  {isLoading ? (
                    <span className={styles.spinner} aria-label="載入中" />
                  ) : (
                    "升級方案"
                  )}
                </button>
              ) : (
                <button
                  className={`${styles.ctaButton} ${plan.isRecommended ? styles.ctaPrimary : styles.ctaSecondary} ${isLoading ? styles.ctaLoading : ""}`}
                  onClick={() => handleCheckout(plan.key)}
                  disabled={loadingPlan !== null}
                  aria-busy={isLoading}
                >
                  {isLoading ? (
                    <span className={styles.spinner} aria-label="載入中" />
                  ) : (
                    "立即訂閱"
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- Free Tier ---- */}
      <section className={styles.freeSection}>
        <h2 className={styles.freeSectionTitle}>免費體驗</h2>
        <p className={styles.freeSectionSubtitle}>
          無需付費，即可體驗基礎八字分析功能
        </p>

        {/* Comparison Table */}
        <div className={styles.comparisonWrapper}>
          <table className={styles.comparisonTable}>
            <thead>
              <tr>
                <th>功能</th>
                <th>免費</th>
                <th>Basic</th>
                <th className={styles.comparisonHeaderRecommended}>Pro</th>
                <th>Master</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map(([label, free, basic, pro, master]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {[free, basic, pro, master].map((val, idx) => (
                    <td
                      key={idx}
                      className={idx === 2 ? styles.comparisonHighlightCol : undefined}
                    >
                      {renderComparisonValue(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Subscription Management Link (for logged-in users) ---- */}
      {isSignedIn && (
        <div className={styles.manageLinkWrapper}>
          <Link href="/dashboard/subscription" className={styles.manageLink}>
            管理我的訂閱
          </Link>
        </div>
      )}

      {/* ---- Bottom Note ---- */}
      <p className={styles.bottomNote}>
        所有方案均可隨時取消。年繳方案將按年度收費，取消後服務持續至到期日。
        <br />
        如有任何問題，請
        <Link href="/contact" className={styles.bottomNoteLink}>聯絡我們</Link>
        。
      </p>

      {/* ---- Plan Change Confirmation Modal (Upgrade / Downgrade) ---- */}
      {changeTarget && (() => {
        const targetPlan = PLANS.find((p) => p.key === changeTarget.key);
        const targetDefaults = targetPlan ? DEFAULT_PLANS[targetPlan.key] : null;
        const targetPrice = targetDefaults
          ? isAnnual
            ? `$${(targetDefaults.priceAnnual / 12).toFixed(2)}/月（年繳 $${targetDefaults.priceAnnual.toFixed(2)}/年）`
            : `$${targetDefaults.priceMonthly.toFixed(2)}/月`
          : "";
        const isUpgradeModal = changeTarget.direction === "upgrade";

        return (
          <div className={styles.upgradeOverlay} onClick={() => setChangeTarget(null)}>
            <div className={styles.upgradeDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.upgradeDialogTitle}>
                {isUpgradeModal ? "確認升級方案" : "確認降級方案"}
              </h3>
              <p className={styles.upgradeDialogText}>
                您即將從{" "}
                <strong>{TIER_META[currentTier]?.name || currentTier}</strong>{" "}
                {isUpgradeModal ? "升級" : "降級"}至{" "}
                <strong>{changeTarget.name} 方案</strong>。
              </p>
              <div className={styles.upgradeDialogPrice}>
                {targetPrice}
              </div>
              <p className={styles.upgradeDialogNote}>
                {isUpgradeModal
                  ? "升級後將立即生效，差額將按比例計算並從您的付款方式扣款。"
                  : "降級後將立即生效，多餘的費用將按比例退回或轉為帳戶餘額。降級後部分進階功能將無法使用。"}
              </p>
              <div className={styles.upgradeDialogActions}>
                <button
                  className={styles.upgradeDialogCancel}
                  onClick={() => setChangeTarget(null)}
                >
                  取消
                </button>
                <button
                  className={isUpgradeModal ? styles.upgradeDialogConfirm : styles.downgradeDialogConfirm}
                  onClick={() => handlePlanChange(changeTarget.key, changeTarget.direction)}
                  disabled={loadingPlan !== null}
                >
                  {loadingPlan === changeTarget.key ? (
                    <span className={styles.spinner} aria-label="載入中" />
                  ) : isUpgradeModal ? (
                    "確認升級"
                  ) : (
                    "確認降級"
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function renderComparisonValue(val: ComparisonValue) {
  if (val === true) {
    return <span className={styles.checkIcon}>&#10003;</span>;
  }
  if (val === false) {
    return <span className={styles.crossIcon}>&mdash;</span>;
  }
  return <span>{val}</span>;
}
