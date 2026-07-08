"use client";

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { getUserProfile } from "../lib/api";
import { redirectToSignInOnExpiry } from "../lib/auth-redirect";
import { devWarnServiceDown } from "../lib/dev-warn";
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
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        // Signed-in but Clerk returned no token — the most common silent-expiry
        // signal (broken/stale session). Redirect to re-login rather than
        // hiding the badge silently. (A genuine API 401 with a token is handled
        // inside apiFetch via the same helper.)
        redirectToSignInOnExpiry();
        return;
      }
      const profile = await getUserProfile(token);
      setCredits(profile.credits);
      setTier(profile.subscriptionTier);
    } catch (err) {
      // Silent degrade (badge hides). In dev, hint when the API is genuinely
      // unreachable (fetch throws TypeError) — not for HTTP-error responses,
      // where a 401 already triggered the redirect above.
      if (err instanceof TypeError) {
        devWarnServiceDown("Credit badge", "is the API on :4000 running?", err);
      }
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
