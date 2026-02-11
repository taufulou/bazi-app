"use client";

import { useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import styles from "./InsufficientCreditsModal.module.css";

interface InsufficientCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewChart: () => void;
  currentCredits: number;
  requiredCredits: number;
  readingName: string;
}

export default function InsufficientCreditsModal({
  isOpen,
  onClose,
  onViewChart,
  currentCredits,
  requiredCredits,
  readingName,
}: InsufficientCreditsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLAnchorElement>(null);

  // ESC key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  // Body scroll lock + ESC listener + auto-focus
  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    // Auto-focus primary CTA
    setTimeout(() => primaryBtnRef.current?.focus(), 50);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Focus trap
  const handleTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;

    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'a[href], button, [tabindex]:not([tabindex="-1"])',
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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credits-modal-title"
        onKeyDown={handleTabKey}
      >
        <div className={styles.icon}>💎</div>
        <h3 id="credits-modal-title" className={styles.title}>
          額度不足
        </h3>
        <p className={styles.body}>
          「{readingName}」需要 <strong>{requiredCredits}</strong> 點數，您目前剩餘{" "}
          <strong>{currentCredits}</strong> 點
        </p>
        <div className={styles.actions}>
          <Link
            href="/pricing"
            ref={primaryBtnRef}
            className={styles.primaryBtn}
          >
            升級方案
          </Link>
          <button
            className={styles.secondaryBtn}
            onClick={onViewChart}
            type="button"
          >
            查看免費命盤
          </button>
        </div>
      </div>
    </div>
  );
}
