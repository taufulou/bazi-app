'use client';

/**
 * Sticky floating button rendered at the bottom-right of the reading page.
 * Clicking opens the ChatDrawer.
 *
 * Renders nothing on initial mount until hydrated, to avoid SSR/CSR drift.
 */

import { useEffect, useState } from 'react';
import styles from './ChatFloatingButton.module.css';

interface ChatFloatingButtonProps {
  onClick: () => void;
  /** Optional badge text shown above the icon (e.g., "12/15"). */
  badgeText?: string;
}

export default function ChatFloatingButton({
  onClick,
  badgeText,
}: ChatFloatingButtonProps) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated) return null;

  return (
    <button
      type="button"
      className={styles.button}
      onClick={onClick}
      aria-label="開啟 AI 命理師對話"
    >
      {badgeText && <span className={styles.badge}>{badgeText}</span>}
      <span className={styles.icon} aria-hidden>
        💬
      </span>
      <span className={styles.label}>問 AI 命理師</span>
    </button>
  );
}
