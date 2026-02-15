"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  getSubscriptionStatus,
  cancelSubscription,
  reactivateSubscription,
  createPortalSession,
  type SubscriptionStatus,
} from "../../lib/api";
import styles from "./page.module.css";

// ============================================================
// Tier display metadata
// ============================================================

const TIER_META: Record<string, { name: string; badge: string }> = {
  FREE: { name: "免費方案", badge: "free" },
  BASIC: { name: "Basic 方案", badge: "basic" },
  PRO: { name: "Pro 方案", badge: "pro" },
  MASTER: { name: "Master 方案", badge: "master" },
};

// ============================================================
// Component
// ============================================================

export default function SubscriptionPage() {
  const { getToken, isSignedIn } = useAuth();

  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // ---- Fetch subscription data ----
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getToken();
      if (!token) throw new Error("認證過期，請重新登入");

      const sub = await getSubscriptionStatus(token);
      setSubscription(sub);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isSignedIn) {
      fetchData();
    }
  }, [isSignedIn, fetchData]);

  // ---- Cancel subscription ----
  const handleCancel = useCallback(async () => {
    setShowCancelConfirm(false);
    setActionLoading("cancel");
    try {
      const token = await getToken();
      if (!token) throw new Error("認證過期");
      await cancelSubscription(token);
      await fetchData(); // Refresh data
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "取消訂閱失敗");
    } finally {
      setActionLoading(null);
    }
  }, [getToken, fetchData]);

  // ---- Reactivate subscription ----
  const handleReactivate = useCallback(async () => {
    setActionLoading("reactivate");
    try {
      const token = await getToken();
      if (!token) throw new Error("認證過期");
      await reactivateSubscription(token);
      await fetchData(); // Refresh data
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "重新啟用失敗");
    } finally {
      setActionLoading(null);
    }
  }, [getToken, fetchData]);

  // ---- Open Stripe Customer Portal ----
  const handlePortal = useCallback(async () => {
    setActionLoading("portal");
    try {
      const token = await getToken();
      if (!token) throw new Error("認證過期");
      const origin = window.location.origin;
      const session = await createPortalSession(token, `${origin}/dashboard/subscription`);
      window.location.href = session.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "無法開啟帳務管理頁面");
      setActionLoading(null);
    }
  }, [getToken]);

  // ---- Derived state ----
  const tier = subscription?.subscriptionTier || "FREE";
  const tierInfo = TIER_META[tier] || TIER_META.FREE;
  const isPaid = tier !== "FREE";
  const activeSub = subscription?.activeSubscription;
  const isCancelled = activeSub?.status === "CANCELLED";
  const credits = subscription?.credits ?? 0;

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.backLink}>
          &larr; 返回儀表板
        </Link>
        <h1 className={styles.headerTitle}>訂閱管理</h1>
      </header>

      <div className={styles.content}>
        {/* Loading State */}
        {loading && (
          <div className={styles.loadingWrapper}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>載入訂閱資料...</p>
          </div>
        )}

        {/* Error State */}
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

        {/* Content */}
        {!loading && subscription && (
          <>
            {/* Current Plan Card */}
            <div className={styles.planCard}>
              <div className={styles.planHeader}>
                <span className={`${styles.tierBadge} ${styles[`tierBadge_${tierInfo.badge}`]}`}>
                  {tierInfo.name}
                </span>
                {isCancelled && (
                  <span className={styles.cancelledBadge}>將於到期日取消</span>
                )}
              </div>

              <div className={styles.planDetails}>
                {/* Credits */}
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>剩餘點數</span>
                  <span className={styles.detailValue}>
                    {tier === "MASTER" ? "無限" : credits}
                  </span>
                </div>

                {/* Subscription Status */}
                {isPaid && activeSub && (
                  <>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>訂閱狀態</span>
                      <span className={`${styles.detailValue} ${isCancelled ? styles.statusCancelled : styles.statusActive}`}>
                        {activeSub.status === "ACTIVE" ? "啟用中" :
                         activeSub.status === "CANCELLED" ? "已排定取消" :
                         activeSub.status === "PAST_DUE" ? "逾期" :
                         activeSub.status === "EXPIRED" ? "已過期" : activeSub.status}
                      </span>
                    </div>

                    {/* Billing Period */}
                    {activeSub.currentPeriodEnd && (
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>
                          {isCancelled ? "服務到期日" : "下次續約日"}
                        </span>
                        <span className={styles.detailValue}>
                          {new Date(activeSub.currentPeriodEnd).toLocaleDateString("zh-TW", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    )}

                    {/* Payment Platform */}
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>付款方式</span>
                      <span className={styles.detailValue}>
                        {activeSub.platform === "STRIPE" ? "信用卡 (Stripe)" :
                         activeSub.platform === "APPLE" ? "Apple IAP" :
                         activeSub.platform === "GOOGLE" ? "Google Play" : activeSub.platform}
                      </span>
                    </div>
                  </>
                )}

                {/* Free tier message */}
                {!isPaid && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>方案說明</span>
                    <span className={styles.detailValue}>
                      免費命盤排盤 + {credits} 點 AI 解讀額度
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className={styles.actions}>
              {isPaid && !isCancelled && (
                <>
                  <button
                    className={styles.portalButton}
                    onClick={handlePortal}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "portal" ? (
                      <span className={styles.btnSpinner} />
                    ) : (
                      "管理帳務資料"
                    )}
                  </button>

                  <button
                    className={styles.cancelButton}
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={actionLoading !== null}
                  >
                    取消訂閱
                  </button>
                </>
              )}

              {isPaid && isCancelled && (
                <button
                  className={styles.reactivateButton}
                  onClick={handleReactivate}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "reactivate" ? (
                    <span className={styles.btnSpinner} />
                  ) : (
                    "重新啟用訂閱"
                  )}
                </button>
              )}

              {!isPaid && (
                <Link href="/pricing" className={styles.upgradeLink}>
                  升級方案
                </Link>
              )}

              {isPaid && (
                <Link href="/pricing" className={styles.changePlanLink}>
                  變更方案
                </Link>
              )}
            </div>

            {/* Cancel Confirmation Dialog */}
            {showCancelConfirm && (
              <div className={styles.confirmOverlay} onClick={() => setShowCancelConfirm(false)}>
                <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
                  <h3 className={styles.confirmTitle}>確認取消訂閱</h3>
                  <p className={styles.confirmText}>
                    取消後，您的訂閱將持續至當前計費週期結束
                    {activeSub?.currentPeriodEnd && (
                      <>
                        （
                        {new Date(activeSub.currentPeriodEnd).toLocaleDateString("zh-TW", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                        ）
                      </>
                    )}
                    。到期後，帳戶將降級為免費方案。
                  </p>
                  <div className={styles.confirmActions}>
                    <button
                      className={styles.confirmCancel}
                      onClick={() => setShowCancelConfirm(false)}
                    >
                      返回
                    </button>
                    <button
                      className={styles.confirmProceed}
                      onClick={handleCancel}
                      disabled={actionLoading === "cancel"}
                    >
                      {actionLoading === "cancel" ? (
                        <span className={styles.btnSpinner} />
                      ) : (
                        "確認取消"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
