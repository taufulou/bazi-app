"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  getSubscriptionStatus,
  cancelSubscription,
  reactivateSubscription,
  createPortalSession,
  getInvoices,
  stripeSubscriptionOf,
  STORE_MANAGED_NOTE,
  type SubscriptionStatus,
  type Invoice,
} from "../../lib/api";
import styles from "./page.module.css";
import { PAID_TIER_NAMES } from "../../lib/tier-names";

// ============================================================
// Tier display metadata
// ============================================================

// Named separately so the fallback below is a direct reference rather than a
// second lookup. Under `noUncheckedIndexedAccess`, every read from a
// `Record<string, T>` is `T | undefined` — including `TIER_META.FREE` — so
// `TIER_META[tier] || TIER_META.FREE` was still possibly-undefined and the two
// uses at :200-201 were unguarded.
const FREE_TIER_META = { name: "免費方案", badge: "free" };

const TIER_META: Record<string, { name: string; badge: string }> = {
  FREE: FREE_TIER_META,
  BASIC: { name: PAID_TIER_NAMES.BASIC, badge: "basic" },
  PRO: { name: PAID_TIER_NAMES.PRO, badge: "pro" },
  MASTER: { name: PAID_TIER_NAMES.MASTER, badge: "master" },
};

// ============================================================
// Invoice helpers
// ============================================================

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  paid: { text: "已付款", className: "statusPaid" },
  open: { text: "待付款", className: "statusOpen" },
  void: { text: "已作廢", className: "statusVoid" },
  uncollectible: { text: "無法收款", className: "statusUncollectible" },
  draft: { text: "草稿", className: "statusDraft" },
};

function formatAmount(amount: number, currency: string): string {
  const symbol =
    currency === "TWD" ? "NT$" :
    currency === "USD" ? "US$" :
    `${currency} `;
  // Zero-decimal currencies show integer, others show 2 decimals
  const zeroDecimal = ["TWD", "JPY", "KRW", "VND"].includes(currency);
  return `${symbol}${zeroDecimal ? Math.round(amount) : amount.toFixed(2)}`;
}

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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);

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

  // ---- Fetch invoices ----
  const fetchInvoices = useCallback(async () => {
    try {
      setInvoicesLoading(true);
      setInvoicesError(null);
      const token = await getToken();
      if (!token) return;
      const data = await getInvoices(token);
      setInvoices(data);
    } catch (err: unknown) {
      setInvoicesError(err instanceof Error ? err.message : "無法載入帳單記錄");
    } finally {
      setInvoicesLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isSignedIn) {
      fetchData();
      fetchInvoices();
    }
  }, [isSignedIn, fetchData, fetchInvoices]);

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
  const tierInfo = TIER_META[tier] ?? FREE_TIER_META;
  const isPaid = tier !== "FREE";
  const activeSub = subscription?.activeSubscription;
  // Badge + "服務到期日" label: a CANCELLED row, or an ACTIVE one with
  // `cancelledAt` set (a Stripe portal cancel and a store auto-renew-off both
  // keep the row ACTIVE until the period ends; both clear it on un-cancel).
  const isCancelled =
    activeSub?.status === "CANCELLED" || (activeSub?.status === "ACTIVE" && !!activeSub.cancelledAt);
  const credits = subscription?.credits ?? 0;

  // 1B item 5 — every Stripe button is driven by the STRIPE row, not by the tier.
  const stripeSub = stripeSubscriptionOf(subscription);
  // Paid, with no Stripe row: the membership came from App Store / Google Play.
  const storeGoverned = isPaid && !stripeSub;
  // A live store membership alongside a Stripe row (cancelled here, then
  // subscribed in the app). `activeSubscription` is the newest row of any
  // platform, so a newer ACTIVE Apple/Google row shows up there.
  const storeActive = activeSub?.status === "ACTIVE" && activeSub.platform !== "STRIPE";
  const stripePastDue = stripeSub?.status === "PAST_DUE";
  const canCancelStripe = stripeSub?.status === "ACTIVE" && !stripeSub.cancelledAt;
  // ONLY a CANCELLED row: a portal cancel leaves the row ACTIVE + cancelledAt,
  // and `reactivateSubscription` finds CANCELLED rows only — so offering it
  // there would 404. That member un-cancels in the portal instead.
  // Never while a store membership is live: Stripe would renew alongside it —
  // double billing. The API refuses it too (409 ALREADY_SUBSCRIBED).
  const canReactivateStripe = stripeSub?.status === "CANCELLED" && !storeActive;

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10 2 4 8 10 14" /></svg>
          返回儀表板
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
                  <Link href="/store" className={styles.creditValueLink}>
                    <span className={styles.detailValue}>{credits}</span>
                    <span className={styles.creditBuyHint}>購買更多</span>
                  </Link>
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
                         activeSub.platform === "APPLE_IAP" ? "App Store" :
                         activeSub.platform === "GOOGLE_PLAY" ? "Google Play" : activeSub.platform}
                      </span>
                    </div>
                  </>
                )}

                {(storeGoverned || storeActive) && (
                  <p className={styles.storeNote}>{STORE_MANAGED_NOTE}</p>
                )}

                {stripePastDue && (
                  <p className={styles.storeNote} role="status">
                    上一筆扣款未成功，請至「管理帳務資料」更新付款方式。
                  </p>
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
              <Link href="/store" className={styles.buyCreditsLink}>💎 購買點數</Link>

              {stripeSub && (
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
              )}

              {canCancelStripe && (
                <button
                  className={styles.cancelButton}
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={actionLoading !== null}
                >
                  取消訂閱
                </button>
              )}

              {canReactivateStripe && (
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

              {/* A PAST_DUE Stripe member reads as FREE — send them to the portal
                  (above), never to a second checkout. */}
              {!isPaid && !stripeSub && (
                <Link href="/pricing" className={styles.upgradeLink}>
                  升級方案
                </Link>
              )}

              {isPaid && !storeGoverned && (
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
                    {stripeSub?.currentPeriodEnd && (
                      <>
                        （
                        {new Date(stripeSub.currentPeriodEnd).toLocaleDateString("zh-TW", {
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

            {/* Invoice History */}
            <div className={styles.invoiceSection}>
              <h2 className={styles.invoiceSectionTitle}>帳單記錄</h2>

              {invoicesLoading && (
                <div className={styles.invoiceLoading}>
                  <div className={styles.invoiceSkeleton} />
                  <div className={styles.invoiceSkeleton} />
                </div>
              )}

              {invoicesError && (
                <p className={styles.invoiceError}>{invoicesError}</p>
              )}

              {!invoicesLoading && !invoicesError && invoices.length === 0 && (
                <p className={styles.invoiceEmpty}>尚無帳單記錄</p>
              )}

              {!invoicesLoading && invoices.length > 0 && (
                <div className={styles.invoiceList}>
                  {invoices.map((inv) => {
                    const statusInfo = STATUS_LABELS[inv.status] || { text: inv.status, className: "" };
                    return (
                      <div key={inv.id} className={styles.invoiceCard}>
                        <div className={styles.invoiceMain}>
                          <div className={styles.invoiceInfo}>
                            <span className={styles.invoiceDate}>
                              {new Date(inv.date).toLocaleDateString("zh-TW", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                            {inv.number && (
                              <span className={styles.invoiceNumber}>#{inv.number}</span>
                            )}
                            {inv.description && (
                              <span className={styles.invoiceDesc}>{inv.description}</span>
                            )}
                          </div>
                          <div className={styles.invoiceRight}>
                            <span className={styles.invoiceAmount}>
                              {formatAmount(inv.amountPaid > 0 ? inv.amountPaid : inv.amountDue, inv.currency)}
                            </span>
                            <span className={`${styles.invoiceStatus} ${styles[statusInfo.className] || ""}`}>
                              {statusInfo.text}
                            </span>
                          </div>
                        </div>
                        {(inv.hostedInvoiceUrl || inv.invoicePdf) && (
                          <div className={styles.invoiceActions}>
                            {inv.hostedInvoiceUrl && (
                              <a
                                href={inv.hostedInvoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.invoiceLink}
                              >
                                查看收據
                              </a>
                            )}
                            {inv.invoicePdf && (
                              <a
                                href={inv.invoicePdf}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.invoiceLink}
                              >
                                下載 PDF
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
