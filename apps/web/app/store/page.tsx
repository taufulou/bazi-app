"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  getCreditPackages,
  createCreditCheckout,
  getUserProfile,
  type CreditPackage,
  type UserProfile,
} from "../lib/api";
import styles from "./store.module.css";

// ============================================================
// Component
// ============================================================

export default function CreditStorePage() {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" } | null>(null);

  const { isSignedIn, getToken } = useAuth();
  const searchParams = useSearchParams();

  // ---- Handle success query param ----
  useEffect(() => {
    const credits = searchParams.get("credits");
    if (credits === "success") {
      setToast({ message: "點數購買成功！已加入您的帳戶", type: "success" });
    }
  }, [searchParams]);

  // ---- Auto-dismiss toast ----
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ---- Fetch packages + profile ----
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Always fetch packages (public endpoint)
      const pkgs = await getCreditPackages();
      setPackages(pkgs);

      // Fetch profile if signed in
      if (isSignedIn) {
        const token = await getToken();
        if (token) {
          const prof = await getUserProfile(token);
          setProfile(prof);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "載入資料失敗");
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---- Handle purchase ----
  const handleBuy = useCallback(
    async (pkg: CreditPackage) => {
      setError(null);

      // Not signed in → redirect to sign-in
      if (!isSignedIn) {
        window.location.href = `/sign-in?redirect_url=${encodeURIComponent("/store")}`;
        return;
      }

      setLoadingSlug(pkg.slug);

      try {
        const token = await getToken();
        if (!token) {
          throw new Error("無法取得認證令牌，請重新登入");
        }

        const origin = window.location.origin;
        const session = await createCreditCheckout(token, {
          packageSlug: pkg.slug,
          successUrl: `${origin}/store?credits=success`,
          cancelUrl: `${origin}/store?cancelled=true`,
        });

        // Redirect to Stripe Checkout
        window.location.href = session.url;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "結帳時發生錯誤，請稍後再試";
        setError(message);
        setLoadingSlug(null);
      }
    },
    [isSignedIn, getToken],
  );

  // ---- Find best value package (highest credit-to-price ratio) ----
  const validPackages = packages.filter(
    (p) => Number(p.priceUsd) > 0 && p.creditAmount > 0,
  );
  const bestValueSlug =
    validPackages.length > 0
      ? validPackages.reduce((best, pkg) =>
          pkg.creditAmount / Number(pkg.priceUsd) >
          best.creditAmount / Number(best.priceUsd)
            ? pkg
            : best,
        ).slug
      : null;

  return (
    <div className={styles.pageContainer}>
      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${styles.toastSuccess}`} role="alert">
          <span>{toast.message}</span>
          <button
            className={styles.toastClose}
            onClick={() => setToast(null)}
            aria-label="關閉通知"
          >
            &times;
          </button>
        </div>
      )}

      {/* Header */}
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.backLink}>
          &larr; 返回儀表板
        </Link>
        <h1 className={styles.pageTitle}>購買點數</h1>
        <p className={styles.pageSubtitle}>
          選擇最適合您的點數套餐，大量購買更優惠
        </p>
      </header>

      {/* Error Banner */}
      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          <button
            className={styles.errorClose}
            onClick={() => setError(null)}
            aria-label="關閉錯誤"
          >
            &times;
          </button>
        </div>
      )}

      {/* Credit Balance (signed-in only) */}
      {isSignedIn && profile && (
        <div className={styles.balanceCard}>
          <span className={styles.balanceLabel}>目前點數餘額</span>
          <span className={styles.balanceValue}>
            {profile.subscriptionTier === "MASTER" ? "無限" : profile.credits}
            {profile.subscriptionTier !== "MASTER" && (
              <span className={styles.balanceUnit}>點</span>
            )}
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className={styles.loadingWrapper}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>載入點數套餐...</p>
        </div>
      )}

      {/* Package Cards */}
      {!loading && packages.length > 0 && (
        <div className={styles.packagesGrid}>
          {packages.map((pkg) => {
            const isBestValue = pkg.slug === bestValueSlug;
            const price = Number(pkg.priceUsd);
            const perCredit =
              price > 0 && pkg.creditAmount > 0
                ? (price / pkg.creditAmount).toFixed(2)
                : "—";
            const isLoading = loadingSlug === pkg.slug;

            return (
              <div
                key={pkg.slug}
                className={`${styles.packageCard} ${isBestValue ? styles.packageCardBestValue : ""}`}
              >
                {isBestValue && (
                  <div className={styles.bestValueBadge}>最超值</div>
                )}

                <div className={styles.creditAmount}>{pkg.creditAmount}</div>
                <div className={styles.creditLabel}>點</div>
                <div className={styles.packageName}>{pkg.nameZhTw}</div>
                <div className={styles.priceTag}>${Number(pkg.priceUsd).toFixed(2)}</div>
                <div className={styles.perCreditPrice}>
                  每點{" "}
                  <span className={isBestValue ? styles.perCreditHighlight : ""}>
                    ${perCredit}
                  </span>
                </div>

                <button
                  className={`${styles.buyButton} ${isBestValue ? styles.buyButtonPrimary : ""}`}
                  onClick={() => handleBuy(pkg)}
                  disabled={loadingSlug !== null}
                  aria-busy={isLoading}
                >
                  {isLoading ? (
                    <span className={styles.btnSpinner} aria-label="載入中" />
                  ) : (
                    "立即購買"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && packages.length === 0 && !error && (
        <div className={styles.loadingWrapper}>
          <p className={styles.loadingText}>目前沒有可用的點數套餐</p>
        </div>
      )}

      {/* Sign-in CTA (for unauthenticated) */}
      {!isSignedIn && !loading && (
        <div className={styles.signInSection}>
          <p className={styles.signInText}>
            登入後即可購買點數並開始使用 AI 命理分析
          </p>
          <Link
            href={`/sign-in?redirect_url=${encodeURIComponent("/store")}`}
            className={styles.signInLink}
          >
            登入 / 註冊
          </Link>
        </div>
      )}

      {/* Bottom links */}
      <div className={styles.bottomLinks}>
        <Link href="/pricing" className={styles.subscriptionLink}>
          或選擇訂閱方案享受更多優惠 &rarr;
        </Link>
      </div>

      <p className={styles.bottomNote}>
        點數購買後立即加入帳戶，永不過期。
        <br />
        如有任何問題，請
        <Link href="/contact" className={styles.bottomNoteLink}>
          聯絡我們
        </Link>
        。
      </p>
    </div>
  );
}
