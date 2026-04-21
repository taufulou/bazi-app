"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { READING_TYPE_META } from "@repo/shared";
import {
  getReadingHistoryByType,
  type ReadingHistoryItem,
} from "../lib/readings-api";
import styles from "./PastReadingsSection.module.css";

interface Props {
  /** Frontend slug: "lifetime" | "annual" | "career" | "love" | "health" | "compatibility" */
  readingType: string;
  /** Exclude this reading id from the rendered list (prevents self-links when re-hydrating via ?id=). */
  currentReadingId?: string;
}

const COMPARISON_TYPE_ICON: Record<string, string> = {
  ROMANCE: "💕",
  BUSINESS: "💼",
  FRIENDSHIP: "🤝",
};

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Status = "loading" | "success" | "error";

export default function PastReadingsSection({
  readingType,
  currentReadingId,
}: Props) {
  const PAGE_SIZE = 50;
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [readings, setReadings] = useState<ReadingHistoryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [refetchTick, setRefetchTick] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const meta = READING_TYPE_META[readingType as keyof typeof READING_TYPE_META];
  const typeLabel = meta?.nameZhTw ?? readingType;

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setStatus("success");
      setReadings([]);
      setTotalCount(0);
      return;
    }

    let cancelled = false;
    (async () => {
      setStatus("loading");
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setStatus("success");
            setReadings([]);
            setTotalCount(0);
          }
          return;
        }
        const result = await getReadingHistoryByType(
          token,
          readingType,
          1,
          PAGE_SIZE,
        );
        if (cancelled) return;
        setReadings(result.data);
        setTotalCount(result.meta.total);
        setStatus("success");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken, readingType, refetchTick]);

  const handleLoadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) return;
      // Next page = whatever page would contain the next unloaded item.
      // Using (loaded / PAGE_SIZE) + 1 stays correct even if prior pages
      // were partially filtered client-side.
      const nextPage = Math.floor(readings.length / PAGE_SIZE) + 1;
      const result = await getReadingHistoryByType(
        token,
        readingType,
        nextPage,
        PAGE_SIZE,
      );
      // De-dupe in case pagination overlaps with an optimistic client state.
      const seen = new Set(readings.map((r) => r.id));
      const additions = result.data.filter((r) => !seen.has(r.id));
      setReadings((prev) => [...prev, ...additions]);
      setTotalCount(result.meta.total);
    } catch {
      // Leave current state in place; user can tap again.
    } finally {
      setLoadingMore(false);
    }
  };

  // Filter out the reading currently being viewed (if any).
  const visibleReadings = currentReadingId
    ? readings.filter((r) => r.id !== currentReadingId)
    : readings;

  // Hide entirely when not signed in, or when the user genuinely has zero past readings.
  if (!isLoaded) return null;
  if (!isSignedIn) return null;
  if (status === "success" && totalCount === 0) return null;

  const handleCardClick = (id: string) => {
    // `from=form` tells the form page that the deep-link came from clicking a card
    // on the form itself, so the back button should return to the form — not to
    // /dashboard/readings (the treatment used when coming from the history page).
    router.push(`/reading/${readingType}?id=${id}&from=form`);
  };

  const handleRetry = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setRefetchTick((t) => t + 1);
  };

  const showCount = status === "success" && totalCount > 0;

  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron} aria-hidden="true">
          {expanded ? "▼" : "▶"}
        </span>
        <span className={styles.title}>
          你的{typeLabel}記錄
          {showCount && (
            <span className={styles.count}>
              <span className={styles.countSeparator}>·</span>
              共<span className={styles.countNumber}>{totalCount}</span>筆
            </span>
          )}
        </span>
        {status === "error" && (
          <span
            role="button"
            tabIndex={0}
            aria-label="重試"
            className={styles.retry}
            onClick={handleRetry}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleRetry(e);
            }}
          >
            ↻
          </span>
        )}
      </button>

      {expanded && status === "success" && visibleReadings.length > 0 && (
        <div className={styles.list}>
          {visibleReadings.map((reading) => {
            const isComparison = reading.isComparison === true;
            const icon = isComparison
              ? COMPARISON_TYPE_ICON[reading.comparisonType ?? "ROMANCE"] ?? "🤝"
              : meta?.icon ?? "🔮";
            const primaryName = reading.birthProfile?.name ?? "未命名";
            const birthDateText = formatDate(reading.birthProfile?.birthDate);

            let line1: React.ReactNode;
            if (isComparison) {
              const partnerName = reading.profileB?.name ?? "未命名";
              line1 = (
                <>
                  <span>{primaryName}</span>
                  <span className={styles.vsLabel}>×</span>
                  <span>{partnerName}</span>
                </>
              );
            } else if (readingType === "annual" && reading.targetYear) {
              line1 = (
                <>
                  <span>{primaryName}</span>
                  {birthDateText && (
                    <>
                      <span className={styles.metaDot}>·</span>
                      <span className={styles.cardBirthDate}>{birthDateText}</span>
                    </>
                  )}
                  <span className={styles.metaDot}>·</span>
                  <span className={styles.yearBadge}>{reading.targetYear}年</span>
                </>
              );
            } else {
              line1 = (
                <>
                  <span>{primaryName}</span>
                  {birthDateText && (
                    <>
                      <span className={styles.metaDot}>·</span>
                      <span className={styles.cardBirthDate}>{birthDateText}</span>
                    </>
                  )}
                </>
              );
            }

            return (
              <button
                type="button"
                key={reading.id}
                onClick={() => handleCardClick(reading.id)}
                className={styles.card}
              >
                <span className={styles.cardIcon} aria-hidden="true">
                  {icon}
                </span>
                <div className={styles.cardBody}>
                  <div className={styles.cardLine1}>{line1}</div>
                  <div className={styles.cardLine2}>
                    讀於 {formatDate(reading.createdAt)}
                  </div>
                </div>
                <span className={styles.cardArrow} aria-hidden="true">
                  →
                </span>
              </button>
            );
          })}
          {/*
            Counts compare against `readings.length` (items fetched from the server),
            NOT `visibleReadings.length` (which excludes the reading currently being
            viewed via currentReadingId). The button promises how many NEW cards the
            next fetch will surface, and handleLoadMore's dedupe guarantees the
            excluded id will not reappear. Using visibleReadings.length here would
            overpromise by 1 whenever currentReadingId matches a loaded item.
          */}
          {readings.length < totalCount && (
            <button
              type="button"
              className={styles.loadMore}
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore
                ? "載入中…"
                : `載入更多（還有 ${totalCount - readings.length} 筆）`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
