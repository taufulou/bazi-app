'use client';

import styles from './QuotaBadge.module.css';
import { quotaBadgeText } from './dialog-copy';

interface QuotaBadgeProps {
  chatsUsed: number;
  monthlyQuota: number;
  paidRemaining: number;
}

export default function QuotaBadge({
  chatsUsed,
  monthlyQuota,
  paidRemaining,
}: QuotaBadgeProps) {
  const text = quotaBadgeText({ chatsUsed, monthlyQuota, paidRemaining });
  const isPaidPath = chatsUsed >= monthlyQuota;
  return (
    <div
      className={`${styles.badge} ${isPaidPath ? styles.paid : ''}`}
      aria-live="polite"
    >
      {text}
    </div>
  );
}
