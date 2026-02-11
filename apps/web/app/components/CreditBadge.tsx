"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { getUserProfile } from "../lib/api";
import styles from "./CreditBadge.module.css";

const TIER_LABELS: Record<string, string> = {
  FREE: "免費",
  BASIC: "基本",
  PRO: "專業",
  MASTER: "大師",
};

export default function CreditBadge() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<string>("FREE");
  const [freeReadingUsed, setFreeReadingUsed] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsLoading(false);
      return;
    }
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const profile = await getUserProfile(token);
        setCredits(profile.credits);
        setTier(profile.subscriptionTier);
        setFreeReadingUsed(profile.freeReadingUsed);
      } catch {
        // Silent — don't show badge if API unreachable
      } finally {
        setIsLoading(false);
      }
    })();
  }, [isLoaded, isSignedIn, getToken]);

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

  return (
    <div className={styles.badgeContainer}>
      <span className={`${styles.tierBadge} ${tierClass}`}>
        {TIER_LABELS[tier] || "免費"}
      </span>
      <span className={styles.creditBadge}>
        <span className={styles.creditIcon}>💎</span>
        <span className={styles.creditCount}>{credits}</span>
      </span>
      {!freeReadingUsed && (
        <span className={styles.freeBadge} title="免費體驗可用">🎁</span>
      )}
    </div>
  );
}
