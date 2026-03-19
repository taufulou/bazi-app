"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./LovePaywallCTA.module.css";

interface LovePaywallCTAProps {
  creditCost: number;
  currentCredits: number | null;
  hasFreeReading: boolean;
  isSubscriber: boolean;
  isSignedIn: boolean;
  onUnlock: () => void;
  isUnlocking: boolean;
  onCreditsRefresh: () => void;
}

export default function LovePaywallCTA({
  creditCost,
  currentCredits,
  hasFreeReading,
  isSubscriber,
  isSignedIn,
  onUnlock,
  isUnlocking,
  onCreditsRefresh,
}: LovePaywallCTAProps) {
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
    hasFreeReading || isSubscriber || (currentCredits !== null && currentCredits >= creditCost);

  const effectiveCost = hasFreeReading ? 0 : creditCost;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>💕</span>
        <h3 className={styles.headerTitle}>八字愛情姻緣完整報告</h3>
      </div>

      <div className={styles.featureList}>
        <p className={styles.featureIntro}>包含以下深度分析：</p>
        <div className={styles.featureGrid}>
          <span className={styles.featureItem}>戀愛性格分析</span>
          <span className={styles.featureItem}>先天桃花運</span>
          <span className={styles.featureItem}>本命姻緣分析</span>
          <span className={styles.featureItem}>婚配建議</span>
          <span className={styles.featureItem}>對象性格與相貌</span>
          <span className={styles.featureItem}>桃花運好的年份</span>
          <span className={styles.featureItem}>桃花劫的年份</span>
          <span className={styles.featureItem}>感情易變年份</span>
        </div>
      </div>

      <div className={styles.actionArea}>
        {!isSignedIn ? (
          /* Unauthenticated user: show login link */
          <>
            <Link href="/sign-in?redirect_url=/reading/love" className={styles.loginBtn}>
              登入以解鎖完整報告
            </Link>
            <p className={styles.loginHint}>
              登入後即可使用點數解鎖完整愛情姻緣分析報告
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
