"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { getReadingHistory, type ReadingHistoryItem } from "../../lib/readings-api";
import { READING_TYPE_META } from "@repo/shared";
import styles from "./page.module.css";

// Backend enum → frontend slug map (reverse of READING_TYPE_MAP)
const ENUM_TO_SLUG: Record<string, string> = {
  LIFETIME: "lifetime",
  ANNUAL: "annual",
  CAREER: "career",
  LOVE: "love",
  HEALTH: "health",
  COMPATIBILITY: "compatibility",
  ZWDS_LIFETIME: "zwds-lifetime",
  ZWDS_ANNUAL: "zwds-annual",
  ZWDS_CAREER: "zwds-career",
  ZWDS_LOVE: "zwds-love",
  ZWDS_HEALTH: "zwds-health",
  ZWDS_COMPATIBILITY: "zwds-compatibility",
  ZWDS_MONTHLY: "zwds-monthly",
  ZWDS_DAILY: "zwds-daily",
  ZWDS_MAJOR_PERIOD: "zwds-major-period",
  ZWDS_QA: "zwds-qa",
};

// Comparison type labels
const COMPARISON_TYPE_LABELS: Record<string, { icon: string; label: string }> = {
  ROMANCE: { icon: "💕", label: "感情合盤" },
  BUSINESS: { icon: "💼", label: "事業合盤" },
  FRIENDSHIP: { icon: "🤝", label: "友誼合盤" },
};

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReadingHistoryPage() {
  const { getToken, isLoaded } = useAuth();
  const [readings, setReadings] = useState<ReadingHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setError("請先登入");
          setIsLoading(false);
          return;
        }
        const result = await getReadingHistory(token, 1, 50);
        setReadings(result.data);
      } catch {
        setError("無法載入分析記錄");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [isLoaded, getToken]);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {/* Header */}
        <header className={styles.header}>
          <Link href="/" className={styles.backLink}>
            &larr; 返回控制台
          </Link>
          <h1 className={styles.headerTitle}>歷史分析記錄</h1>
        </header>

        {/* Loading */}
        {isLoading && (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>載入中...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className={styles.errorState}>
            <p className={styles.errorText}>{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && readings.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📋</div>
            <h3 className={styles.emptyTitle}>尚無分析記錄</h3>
            <p className={styles.emptyText}>開始一項命理分析，結果會自動儲存在這裡</p>
            <Link href="/" className={styles.startLink}>
              開始分析 &rarr;
            </Link>
          </div>
        )}

        {/* Reading cards */}
        {!isLoading && !error && readings.length > 0 && (
          <>
            <h2 className={styles.sectionLabel}>分析記錄</h2>
            <div className={styles.grid}>
              {readings.map((reading) => {
                // Comparison cards
                if (reading.isComparison) {
                  const ctMeta = COMPARISON_TYPE_LABELS[reading.comparisonType || ""] || {
                    icon: "🤝",
                    label: "合盤比較",
                  };
                  return (
                    <Link
                      key={reading.id}
                      href={`/reading/compatibility?id=${reading.id}`}
                      className={styles.cardLink}
                    >
                      <div className={styles.cardComparison}>
                        <span className={styles.cardIcon}>{ctMeta.icon}</span>
                        <div className={styles.cardBody}>
                          <div className={styles.cardTitle}>{ctMeta.label}</div>
                          <div className={styles.cardMeta}>
                            <span>{reading.birthProfile?.name || "未命名"}</span>
                            <span className={styles.vsLabel}>vs</span>
                            <span>{reading.profileB?.name || "未命名"}</span>
                            <span className={styles.metaDot}>·</span>
                            <span className={styles.cardDate}>
                              {formatDate(reading.createdAt)}
                            </span>
                            {reading.creditsUsed > 0 ? (
                              <>
                                <span className={styles.metaDot}>·</span>
                                <span className={styles.creditsBadge}>
                                  -{reading.creditsUsed} 額度
                                </span>
                              </>
                            ) : (
                              <>
                                <span className={styles.metaDot}>·</span>
                                <span className={styles.freeBadge}>免費</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className={styles.cardArrow}>&rarr;</span>
                      </div>
                    </Link>
                  );
                }

                // Regular reading cards
                const slug = ENUM_TO_SLUG[reading.readingType] || "lifetime";
                const meta = READING_TYPE_META[slug as keyof typeof READING_TYPE_META];
                const isZwds = slug.startsWith("zwds-");

                return (
                  <Link
                    key={reading.id}
                    href={`/reading/${slug}?id=${reading.id}`}
                    className={styles.cardLink}
                  >
                    <div className={isZwds ? styles.cardZwds : styles.card}>
                      <span className={styles.cardIcon}>{meta?.icon || "🔮"}</span>
                      <div className={styles.cardBody}>
                        <div className={styles.cardTitle}>
                          {meta?.nameZhTw || reading.readingType}
                        </div>
                        <div className={styles.cardMeta}>
                          <span>{reading.birthProfile?.name || "未命名"}</span>
                          <span className={styles.metaDot}>·</span>
                          <span className={styles.cardDate}>
                            {formatDate(reading.createdAt)}
                          </span>
                          {reading.creditsUsed > 0 ? (
                            <>
                              <span className={styles.metaDot}>·</span>
                              <span className={styles.creditsBadge}>
                                -{reading.creditsUsed} 額度
                              </span>
                            </>
                          ) : (
                            <>
                              <span className={styles.metaDot}>·</span>
                              <span className={styles.freeBadge}>免費</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className={styles.cardArrow}>&rarr;</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
