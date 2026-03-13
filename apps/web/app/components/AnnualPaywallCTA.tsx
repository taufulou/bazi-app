"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./CareerPaywallCTA.module.css";

interface AnnualPaywallCTAProps {
  creditCost: number;
  currentCredits: number | null;
  hasFreeReading: boolean;
  isSubscriber: boolean;
  isSignedIn: boolean;
  onUnlock: () => void;
  isUnlocking: boolean;
  onCreditsRefresh: () => void;
}

export default function AnnualPaywallCTA({
  creditCost,
  currentCredits,
  hasFreeReading,
  isSubscriber,
  isSignedIn,
  onUnlock,
  isUnlocking,
  onCreditsRefresh,
}: AnnualPaywallCTAProps) {
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
        <span className={styles.headerIcon}>📅</span>
        <h3 className={styles.headerTitle}>八字流年運勢完整報告</h3>
      </div>

      <div className={styles.featureList}>
        <p className={styles.featureIntro}>包含以下深度分析：</p>
        <div className={styles.featureGrid}>
          <span className={styles.featureItem}>流年總述</span>
          <span className={styles.featureItem}>太歲分析</span>
          <span className={styles.featureItem}>事業運勢</span>
          <span className={styles.featureItem}>財運分析</span>
          <span className={styles.featureItem}>人際關係</span>
          <span className={styles.featureItem}>愛情姻緣</span>
          <span className={styles.featureItem}>家庭關係</span>
          <span className={styles.featureItem}>健康狀況</span>
          <span className={styles.featureItem}>十二月運程</span>
        </div>
      </div>

      <div className={styles.actionArea}>
        {!isSignedIn ? (
          <>
            <Link href="/sign-in?redirect_url=/reading/annual" className={styles.loginBtn}>
              登入以解鎖完整報告
            </Link>
            <p className={styles.loginHint}>
              登入後即可使用點數解鎖完整流年運勢報告
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
