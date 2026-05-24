'use client';

/**
 * AuthExpiredBanner — surfaces when `useUserTier.authError === true`,
 * typically because Clerk's JWT expired after a long session. Without this
 * banner, paid subscribers would silently see locked DateNavigator arrows +
 * upgrade modal even though they're paying customers.
 *
 * Pattern: warm amber tint (low visual weight, non-alarming), dismissable
 * with sessionStorage persistence (page-side, not component-side).
 *
 * Accessibility: role='alert' for screen readers + :focus-visible outlines
 * on both interactive controls per WCAG SC 2.4.7.
 */
import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, X } from 'lucide-react';
import styles from './AuthExpiredBanner.module.css';

interface Props {
  onDismiss: () => void;
}

export default function AuthExpiredBanner({ onDismiss }: Props) {
  return (
    <div role="alert" className={styles.banner}>
      <AlertCircle size={16} strokeWidth={2} aria-hidden="true" className={styles.icon} />
      <span className={styles.text}>
        登入狀態已過期，部分功能受限。請重新登入。
      </span>
      <Link href="/sign-in" className={styles.signInLink}>
        重新登入 →
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        className={styles.dismissBtn}
        aria-label="關閉提示"
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
