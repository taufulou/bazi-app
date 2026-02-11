"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { getUserProfile } from "../lib/api";
import styles from "./AccountPanel.module.css";

const TIER_LABELS: Record<string, string> = {
  FREE: "免費方案",
  BASIC: "基本方案",
  PRO: "專業方案",
  MASTER: "大師方案",
};

const TIER_STYLES: Record<string, string> = {
  FREE: "tierFREE",
  BASIC: "tierBASIC",
  PRO: "tierPRO",
  MASTER: "tierMASTER",
};

/** Static CTA banner — fallback when API fails */
function StaticCTA() {
  return (
    <section className={styles.panel}>
      <h3 className={styles.staticTitle}>🔓 解鎖完整命理分析</h3>
      <p className={styles.staticText}>
        訂閱會員即可查看所有分析的完整內容，包括詳細的性格分析、事業指引、感情建議等。
      </p>
      <Link href="/pricing" className={styles.ctaBtn}>
        查看訂閱方案
      </Link>
    </section>
  );
}

export default function AccountPanel() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<string>("FREE");
  const [freeReadingUsed, setFreeReadingUsed] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsLoading(false);
      return;
    }
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setHasError(true);
          return;
        }
        const profile = await getUserProfile(token);
        setCredits(profile.credits);
        setTier(profile.subscriptionTier);
        setFreeReadingUsed(profile.freeReadingUsed);
      } catch {
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [isLoaded, isSignedIn, getToken]);

  // Not signed in — show static CTA
  if (!isSignedIn) return <StaticCTA />;

  // Loading
  if (isLoading) {
    return (
      <section className={styles.panel}>
        <div className={styles.skeletonRow}>
          <div className={styles.skeletonBadge} />
          <div className={styles.skeletonCredits} />
        </div>
        <div className={styles.skeletonBtn} />
      </section>
    );
  }

  // API error — fall back to static CTA
  if (hasError || credits === null) return <StaticCTA />;

  const tierStyleKey = TIER_STYLES[tier] || "tierFREE";
  const showLowWarning = credits <= 3 && (tier === "FREE" || tier === "BASIC");
  const showFreeTrial = !freeReadingUsed;

  return (
    <section className={styles.panel}>
      {/* Row 1: Tier + Credits */}
      <div className={styles.topRow}>
        <span className={`${styles.tierBadge} ${styles[tierStyleKey]}`}>
          {TIER_LABELS[tier] || "免費方案"}
        </span>
        <div className={styles.creditDisplay}>
          <span className={styles.creditIcon}>💎</span>
          <span className={styles.creditCount}>{credits}</span>
          <span className={styles.creditLabel}>點數</span>
        </div>
      </div>

      {/* Row 2: Conditional alerts */}
      {showFreeTrial && (
        <div className={styles.freeTrialBar}>
          🎁 您有一次免費體驗機會！
        </div>
      )}
      {showLowWarning && !showFreeTrial && (
        <div className={styles.warningBar}>
          ⚠️ 點數即將用完
        </div>
      )}

      {/* Row 3: CTA */}
      {tier === "FREE" ? (
        <Link href="/pricing" className={styles.ctaBtn}>
          升級方案
        </Link>
      ) : (
        <Link href="/pricing" className={styles.ctaBtnOutline}>
          管理訂閱
        </Link>
      )}
    </section>
  );
}
