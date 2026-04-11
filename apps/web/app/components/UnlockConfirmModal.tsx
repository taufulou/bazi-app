"use client";

import { useEffect, useRef, useCallback } from "react";
import styles from "./UnlockConfirmModal.module.css";

interface UnlockConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isUnlocking: boolean;
  readingName: string;
  icon: string;
  features: string[];
  effectiveCost: number;
  currentCredits: number | null;
}

export default function UnlockConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isUnlocking,
  readingName,
  icon,
  features,
  effectiveCost,
  currentCredits,
}: UnlockConfirmModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isUnlocking) onClose();
    },
    [onClose, isUnlocking],
  );

  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    setTimeout(() => primaryBtnRef.current?.focus(), 50);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;

    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUnlocking) onClose();
      }}
    >
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-confirm-title"
        onKeyDown={handleTabKey}
      >
        <div className={styles.icon}>{icon}</div>
        <h3 id="unlock-confirm-title" className={styles.title}>
          即將為您解鎖{readingName}
        </h3>

        <div className={styles.featureBox}>
          <div className={styles.featureGrid}>
            {features.map((f) => (
              <span key={f} className={styles.featureItem}>{f}</span>
            ))}
          </div>
        </div>

        <div className={styles.costLine}>
          {effectiveCost > 0 ? (
            <span className={styles.costBadge}>💎 {effectiveCost} 點</span>
          ) : (
            <span className={styles.freeBadge}>免費</span>
          )}
          {currentCredits !== null && effectiveCost > 0 && (
            <span className={styles.balanceText}>剩餘 {currentCredits} 點</span>
          )}
        </div>

        <div className={styles.actions}>
          <button
            ref={primaryBtnRef}
            className={styles.confirmBtn}
            onClick={onConfirm}
            disabled={isUnlocking}
            type="button"
          >
            {isUnlocking ? (
              <>
                <span className={styles.spinner} />
                解鎖中...
              </>
            ) : effectiveCost === 0 ? (
              "免費解鎖完整報告"
            ) : (
              "解鎖完整報告"
            )}
          </button>
          <button
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={isUnlocking}
            type="button"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
