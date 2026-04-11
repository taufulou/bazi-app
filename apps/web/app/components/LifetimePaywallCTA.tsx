"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./PaywallCTA.module.css";

interface LifetimePaywallCTAProps {
  creditCost: number;
  currentCredits: number | null;
  hasFreeReading: boolean;
  isSubscriber: boolean;
  isSignedIn: boolean;
  onUnlock: () => void;
  isUnlocking: boolean;
  onCreditsRefresh: () => void;
}

export default function LifetimePaywallCTA({
  creditCost,
  currentCredits,
  hasFreeReading,
  isSubscriber,
  isSignedIn,
  onUnlock,
  isUnlocking,
  onCreditsRefresh,
}: LifetimePaywallCTAProps) {
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
    hasFreeReading || isSubscriber || (currentCredits !== null && currentCredits >= creditCost);

  const effectiveCost = hasFreeReading ? 0 : creditCost;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>🌟</span>
        <h3 className={styles.headerTitle}>八字終身運完整報告</h3>
      </div>

      <div className={styles.featureList}>
        <p className={styles.featureIntro}>包含以下深度分析：</p>
        <div className={styles.featureGrid}>
          <span className={styles.featureItem}>性格特質</span>
          <span className={styles.featureItem}>日主分析</span>
          <span className={styles.featureItem}>五行平衡</span>
          <span className={styles.featureItem}>十神分布</span>
          <span className={styles.featureItem}>大運流年</span>
          <span className={styles.featureItem}>神煞解析</span>
          <span className={styles.featureItem}>六親關係</span>
          <span className={styles.featureItem}>人生指引</span>
          <span className={styles.featureItem}>財運分析</span>
        </div>
      </div>

      <div className={styles.actionArea}>
        {!isSignedIn ? (
          <>
            <Link href="/sign-in?redirect_url=/reading/lifetime" className={styles.loginBtn}>
              登入以解鎖完整報告
            </Link>
            <p className={styles.loginHint}>
              登入後即可使用點數解鎖完整終身運報告
            </p>
          </>
        ) : hasEnoughCredits ? (
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
                  {effectiveCost > 0 && <span className={styles.costBadge}>💎 {effectiveCost} 點</span>}
                  {effectiveCost === 0 && <span className={styles.freeBadge}>免費</span>}
                </>
              )}
            </button>
            {currentCredits !== null && effectiveCost > 0 && (
              <p className={styles.creditsInfo}>
                剩餘 {currentCredits} 點
                {hasFreeReading && " ｜ 首次免費"}
              </p>
            )}
          </>
        ) : (
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
