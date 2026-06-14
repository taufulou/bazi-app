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
  /** 時辰未知 (Phase 3d): party A (男方) lacks a birth hour → 3-pillar partial. */
  hourUnknownA?: boolean;
  /** 時辰未知 (Phase 3d): party B (女方) lacks a birth hour → 3-pillar partial. */
  hourUnknownB?: boolean;
}

export default function CompatibilityRomancePaywallCTA({
  creditCost,
  currentCredits,
  isSubscriber,
  isSignedIn,
  onUnlock,
  isUnlocking,
  onCreditsRefresh,
  hourUnknownA = false,
  hourUnknownB = false,
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

  // 時辰未知 (Phase 3d): which party lacks a birth hour (banner convention: A=男方,
  // B=女方, matching the post-unlock page banner).
  const hourUnknownWho =
    hourUnknownA && hourUnknownB ? '雙方' : hourUnknownA ? '男方' : hourUnknownB ? '女方' : '';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>💑</span>
        <h3 className={styles.headerTitle}>八字感情合盤完整報告</h3>
      </div>

      {hourUnknownWho && (
        <div className={styles.hourUnknownWarn}>
          <p className={styles.hourUnknownWarnLead}>
            ⚠️ 因為{hourUnknownWho}沒有出生時辰，這份合盤會以「年、月、日」三柱推算（大約七成）。下列與時辰有關的內容，這次不會包含：
          </p>
          <ul className={styles.hourUnknownWarnList}>
            <li>{hourUnknownWho}出生時辰那一柱的分析</li>
            <li>{hourUnknownWho}的子女緣分與晚年同心程度</li>
            <li>{hourUnknownWho}的命宮、身宮</li>
            <li>與時辰有關的雙方互動（部分合、沖、刑、害）</li>
            <li>部分與時辰有關的神煞</li>
          </ul>
          <p className={styles.hourUnknownWarnNote}>
            以「日支夫妻宮」為核心的合盤判斷仍然成立；用神、五行互補僅供參考。出生時辰無法事後補上；若日後得知，可另外建立一張新命盤查看完整合盤。
          </p>
        </div>
      )}

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
