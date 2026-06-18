"use client";

import { useState } from "react";
import type { BirthProfile } from "../lib/birth-profiles-api";
import { genderFromApi } from "../lib/birth-profiles-api";
import styles from "./ProfileCard.module.css";

interface ProfileCardProps {
  profile: BirthProfile;
  isSelected?: boolean;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSetPrimary?: () => void;
  compact?: boolean;
}

const TAG_LABELS: Record<string, string> = {
  SELF: "本人",
  FAMILY: "家人",
  FRIEND: "朋友",
};

function formatDate(isoDate: string): string {
  const d = isoDate.substring(0, 10);
  const [y, m, day] = d.split("-");
  return `${y}年${m}月${day}日`;
}

export default function ProfileCard({
  profile,
  isSelected = false,
  onClick,
  onEdit,
  onDelete,
  onSetPrimary,
  compact = false,
}: ProfileCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const cardClass = [
    styles.card,
    isSelected ? styles.cardSelected : "",
    compact ? styles.cardCompact : "",
    onClick ? styles.cardClickable : "",
  ]
    .filter(Boolean)
    .join(" ");

  const genderLabel = genderFromApi(profile.gender) === "male" ? "男" : "女";

  return (
    <div
      className={cardClass}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {/* Top row: name + action buttons */}
      <div className={styles.topRow}>
        <div className={styles.nameRow}>
          {profile.isPrimary && (
            <span className={styles.primaryStar} title="主要資料">
              ★
            </span>
          )}
          <span className={styles.name} data-no-zh="">{profile.name}</span>
        </div>
        {(onEdit || onDelete || onSetPrimary) && (
          <div className={styles.actions}>
            {onSetPrimary && !profile.isPrimary && (
              <button
                className={styles.actionBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetPrimary();
                }}
                title="設為主要"
                aria-label="設為主要"
              >
                ☆
              </button>
            )}
            {onEdit && (
              <button
                className={styles.actionBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                title="編輯"
                aria-label="編輯"
              >
                ✎
              </button>
            )}
            {onDelete && !confirmDelete && (
              <button
                className={`${styles.actionBtn} ${styles.deleteBtn}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
                title="刪除"
                aria-label="刪除"
              >
                🗑
              </button>
            )}
          </div>
        )}
      </div>

      {/* Info rows */}
      <div className={styles.info}>
        <span className={styles.date}>
          {formatDate(profile.birthDate)} {profile.birthTime}
        </span>
      </div>
      <div className={styles.meta}>
        <span>
          {profile.birthCity} · {genderLabel}
        </span>
      </div>

      {/* Badges */}
      <div className={styles.badges}>
        <span
          className={`${styles.badge} ${styles[`badge${profile.relationshipTag}`] || ""}`}
        >
          {TAG_LABELS[profile.relationshipTag] || profile.relationshipTag}
        </span>
        {profile.isPrimary && (
          <span className={`${styles.badge} ${styles.badgePrimary}`}>主要</span>
        )}
      </div>

      {/* Inline delete confirmation */}
      {confirmDelete && (
        <div className={styles.confirmOverlay}>
          <span className={styles.confirmText}>確定要刪除嗎？</span>
          <div className={styles.confirmBtns}>
            <button
              className={styles.confirmYes}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
                onDelete?.();
              }}
            >
              確定
            </button>
            <button
              className={styles.confirmNo}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
