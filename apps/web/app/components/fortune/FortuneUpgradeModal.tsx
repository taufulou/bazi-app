'use client';

/**
 * FortuneUpgradeModal — paywall prompt shown when a free user tries to
 * navigate dates outside today on the Fortune surface (Phase 1.5).
 *
 * Mirrors the body-scroll-lock + ESC + focus-trap pattern from
 * `InsufficientCreditsModal.tsx:36-73`. z-index 1000 matches that modal's
 * overlay so it correctly sits ABOVE the DateNavigator picker (z-index 60).
 *
 * VALUE namespace React import per PR #46 dual-@types/react identity fix.
 */
import * as React from 'react';
import Link from 'next/link';
import styles from './FortuneUpgradeModal.module.css';

interface FortuneUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FortuneUpgradeModal({
  isOpen,
  onClose,
}: FortuneUpgradeModalProps) {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const primaryBtnRef = React.useRef<HTMLAnchorElement>(null);

  const handleKeyDown = React.useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  React.useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    setTimeout(() => primaryBtnRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !modalRef.current) return;
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
        aria-labelledby="fortune-upgrade-title"
        onKeyDown={handleTabKey}
      >
        <div className={styles.icon} aria-hidden="true">🔒</div>
        <h3 id="fortune-upgrade-title" className={styles.title}>
          升級訂閱解鎖完整查詢範圍
        </h3>
        <p className={styles.body}>
          免費版僅可查看「今日」運勢。
          <br />
          訂閱後可查看昨日 + 今日 + 未來 30 天。
        </p>
        <div className={styles.actions}>
          <Link
            href="/pricing"
            ref={primaryBtnRef}
            className={styles.primaryBtn}
          >
            查看訂閱方案
          </Link>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClose}
          >
            稍後再說
          </button>
        </div>
      </div>
    </div>
  );
}
