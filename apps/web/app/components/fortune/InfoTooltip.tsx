'use client';

/**
 * InfoTooltip — keyboard-friendly disclosure widget wrapping `<details>`.
 *
 * Per Revision Round 1 §R1.17 + Round-2 N8: locks `<details><summary>`
 * with cross-OS CSS reset so the experience is consistent across
 * iOS Safari / Android Chrome / desktop.
 *
 * Use for short context expansions like the energy ring ⓘ helper text.
 * Native semantics: keyboard accessible, screen-reader announces
 * «summary» on focus, no JS state needed.
 */
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import styles from './InfoTooltip.module.css';

interface Props {
  /** Short tap-target content (defaults to small ⓘ icon) */
  summary?: ReactNode;
  /** Expanded content shown when opened */
  children: ReactNode;
  /** Accessible label for the summary tap-target */
  ariaLabel?: string;
}

export default function InfoTooltip({
  summary,
  children,
  ariaLabel = '展開詳細資訊',
}: Props) {
  return (
    <details className={styles.tooltip}>
      <summary className={styles.summary} aria-label={ariaLabel}>
        {summary ?? <Info size={14} strokeWidth={2} aria-hidden="true" />}
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
