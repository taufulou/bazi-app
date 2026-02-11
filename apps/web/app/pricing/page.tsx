"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DEFAULT_PLANS } from "@repo/shared";
import styles from "./page.module.css";
import {
  trackPricingPageViewed,
  trackBillingToggled,
  trackPlanCtaClicked,
} from "../lib/analytics";

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

// Free tier features for comparison
const FREE_FEATURES = [
  "1 次免費八字解讀",
  "基礎命盤計算",
  "五行分析圖表（預覽）",
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

function calcSavingsPercent(monthly: number, annual: number): number {
  const fullYearPrice = monthly * 12;
  return Math.round(((fullYearPrice - annual) / fullYearPrice) * 100);
}

// ============================================================
// Component
// ============================================================

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const searchParams = useSearchParams();
  const hasTrackedView = useRef(false);

  // Track pricing page view with referral source
  useEffect(() => {
    if (!hasTrackedView.current) {
      hasTrackedView.current = true;
      trackPricingPageViewed({
        source: searchParams.get("source") || document.referrer || "direct",
      });
    }
  }, [searchParams]);

  const handleBillingToggle = (annual: boolean) => {
    if (annual !== isAnnual) {
      trackBillingToggled({ newValue: annual ? "annual" : "monthly" });
    }
    setIsAnnual(annual);
  };

  return (
    <div className={styles.pageContainer}>
      {/* ---- Header ---- */}
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>選擇您的方案</h1>
        <p className={styles.pageSubtitle}>
          從免費體驗到無限探索，找到最適合您的命理旅程方案
        </p>
      </header>

      {/* ---- Billing Toggle ---- */}
      <div className={styles.billingToggle}>
        <span
          className={`${styles.billingLabel} ${!isAnnual ? styles.billingLabelActive : ""}`}
          onClick={() => handleBillingToggle(false)}
        >
          月繳
        </span>

        <div
          className={styles.toggleTrack}
          onClick={() => handleBillingToggle(!isAnnual)}
          role="switch"
          aria-checked={isAnnual}
          aria-label="切換月繳或年繳"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleBillingToggle(!isAnnual);
            }
          }}
        >
          <div
            className={`${styles.toggleThumb} ${isAnnual ? styles.toggleThumbAnnual : ""}`}
          />
        </div>

        <span
          className={`${styles.billingLabel} ${isAnnual ? styles.billingLabelActive : ""}`}
          onClick={() => handleBillingToggle(true)}
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

          return (
            <div
              key={plan.key}
              className={`${styles.planCard} ${plan.isRecommended ? styles.planCardRecommended : ""}`}
            >
              {plan.isRecommended && (
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

              {/* CTA */}
              <Link
                href="/api/payments/checkout/subscription"
                className={`${styles.ctaButton} ${plan.isRecommended ? styles.ctaPrimary : styles.ctaSecondary}`}
                onClick={() =>
                  trackPlanCtaClicked({
                    planName: plan.name,
                    billingCycle: isAnnual ? "annual" : "monthly",
                    displayPrice: displayPrice,
                  })
                }
              >
                {plan.isRecommended ? "立即訂閱" : "選擇方案"}
              </Link>
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

      {/* ---- Bottom Note ---- */}
      <p className={styles.bottomNote}>
        所有方案均可隨時取消。年繳方案將按年度收費，取消後服務持續至到期日。
        <br />
        如有任何問題，請
        <Link href="/contact" className={styles.bottomNoteLink}>聯絡我們</Link>
        。
      </p>
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
