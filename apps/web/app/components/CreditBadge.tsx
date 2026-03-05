"use client";

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { getUserProfile } from "../lib/api";
import styles from "./CreditBadge.module.css";

const TIER_LABELS: Record<string, string> = {
  FREE: "免費",
  BASIC: "基本",
  PRO: "專業",
  MASTER: "大師",
};

/** Imperative handle to refresh credit badge from parent */
export interface CreditBadgeHandle {
  refresh: () => Promise<void>;
}

interface CreditBadgeProps {
  showPricingLink?: boolean;
}

const CreditBadge = forwardRef<CreditBadgeHandle, CreditBadgeProps>(function CreditBadge({ showPricingLink = false }, ref) {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<string>("FREE");
  const [freeReadingUsed, setFreeReadingUsed] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const profile = await getUserProfile(token);
      setCredits(profile.credits);
      setTier(profile.subscriptionTier);
      setFreeReadingUsed(profile.freeReadingUsed);
    } catch {
      // Silent — don't show badge if API unreachable
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsLoading(false);
      return;
    }
    (async () => {
      await fetchProfile();
      setIsLoading(false);
    })();
  }, [isLoaded, isSignedIn, fetchProfile]);

  // Expose refresh() for parent components to call after credit changes
  useImperativeHandle(ref, () => ({
    refresh: fetchProfile,
  }), [fetchProfile]);

  // Don't render anything if not signed in
  if (!isSignedIn) return null;

  // Loading state
  if (isLoading) {
    return (
      <div className={styles.badgeContainer}>
        <div className={styles.skeleton} />
      </div>
    );
  }

  // API failed — silent degrade
  if (credits === null) return null;

  const tierClass = styles[`tier${tier}`] || styles.tierFREE;

  // Master tier: hide pricing link; Pro or lower: show "升級方案"; FREE: show "訂閱方案"
  const pricingLabel = tier === "FREE" ? "💎 訂閱方案" : "⬆ 升級方案";
  const showPricing = showPricingLink && tier !== "MASTER";

  return (
    <>
      <div className={styles.badgeContainer}>
        <Link
          href="/dashboard/subscription"
          className={styles.tierLink}
          aria-label={`管理訂閱方案（目前：${TIER_LABELS[tier] || "免費"}）`}
        >
          <span className={`${styles.tierBadge} ${tierClass}`}>
            {TIER_LABELS[tier] || "免費"}
          </span>
        </Link>
        <Link
          href="/store"
          className={styles.creditLink}
          aria-label={`購買點數（目前餘額：${credits} 點）`}
        >
          <span className={styles.creditBadge}>
            <span className={styles.creditIcon}>💎</span>
            <span className={styles.creditCount}>{credits}</span>
          </span>
        </Link>
        {!freeReadingUsed && (
          <Link href="/store" className={styles.freeBadgeLink} aria-label="免費體驗可用">
            <span className={styles.freeBadge} title="免費體驗可用">🎁</span>
          </Link>
        )}
      </div>
      {showPricing && (
        <Link href="/pricing" className={styles.pricingLink}>
          {pricingLabel}
        </Link>
      )}
    </>
  );
});

export default CreditBadge;
