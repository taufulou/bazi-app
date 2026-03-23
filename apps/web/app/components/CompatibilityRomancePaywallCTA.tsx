"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./CompatibilityRomancePaywallCTA.module.css";

interface CompatibilityRomancePaywallCTAProps {
  creditCost: number;
  currentCredits: number | null;
  isSubscriber: boolean;
  isSignedIn: boolean;
  onUnlock: () => void;
  isUnlocking: boolean;
  onCreditsRefresh: () => void;
}

export default function CompatibilityRomancePaywallCTA({
  creditCost,
  currentCredits,
  isSubscriber,
  isSignedIn,
  onUnlock,
  isUnlocking,
  onCreditsRefresh,
}: CompatibilityRomancePaywallCTAProps) {
  // Re-fetch credits when user returns from /pricing tab
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        onCreditsRefresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onCreditsRefresh]);

  const hasEnoughCredits =
    isSubscriber || (currentCredits !== null && currentCredits >= creditCost);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>💑</span>
        <h3 className={styles.headerTitle}>八字感情合盤完整報告</h3>
      </div>

      <div className={styles.featureList}>
        <p className={styles.featureIntro}>包含以下深度分析：</p>
        <div className={styles.featureGrid}>
          <span className={styles.featureItem}>合盤分數 &amp; 八維度雷達分析</span>
          <span className={styles.featureItem}>雙方命局特點</span>
          <span className={styles.featureItem}>戀愛性格分析</span>
          <span className={styles.featureItem}>旺夫/旺妻分析</span>
          <span className={styles.featureItem}>婚前婚後財富</span>
          <span className={styles.featureItem}>婚後甜蜜度&穩定度</span>
          <span className={styles.featureItem}>婚變危機預測</span>
          <span className={styles.featureItem}>經營婚姻建議</span>
          <span className={styles.featureItem}>本年感情運勢</span>
        </div>
      </div>

      <div className={styles.actionArea}>
        {!isSignedIn ? (
          /* Unauthenticated user: show login link */
          <>
            <Link href="/sign-in?redirect_url=/reading/compatibility" className={styles.loginBtn}>
              登入以解鎖完整報告
            </Link>
            <p className={styles.loginHint}>
              登入後即可使用點數解鎖完整感情合盤分析報告
            </p>
          </>
        ) : hasEnoughCredits ? (
          /* Authenticated with enough credits: show unlock */
          <>
            <button
              className={styles.unlockBtn}
              onClick={onUnlock}
              disabled={isUnlocking}
              type="button"
            >
              {isUnlocking ? (
                <>
                  <span className={styles.spinner} />
                  解鎖中...
                </>
              ) : (
                <>
                  解鎖完整報告
                  <span className={styles.costBadge}>💎 {creditCost} 點</span>
                </>
              )}
            </button>
            {currentCredits !== null && (
              <p className={styles.creditsInfo}>
                剩餘 {currentCredits} 點
              </p>
            )}
          </>
        ) : (
          /* Authenticated but insufficient credits */
          <>
            <button
              className={`${styles.unlockBtn} ${styles.disabled}`}
              disabled
              type="button"
            >
              額度不足 💎 {creditCost} 點
            </button>
            <p className={styles.creditsInfo}>
              剩餘 {currentCredits ?? 0} 點，需要 {creditCost} 點
            </p>
            <div className={styles.creditsLinks}>
              <Link href="/pricing" className={styles.creditsLink}>
                查看方案 →
              </Link>
              <Link href="/store" className={styles.creditsLink}>
                購買點數 →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
