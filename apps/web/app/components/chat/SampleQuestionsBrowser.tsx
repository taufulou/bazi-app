'use client';

/**
 * Phase 4 — SampleQuestionsBrowser overlay.
 *
 * Full-overlay sheet rendered INSIDE the chat drawer (below the header).
 * Lists ALL active sample questions for the current reading type as a
 * flat scrollable list. User picks a question → drawer's `onPick`
 * callback appends the text to the composer's draft (NOT auto-send).
 *
 * Layout:
 *   - Positioned `absolute` covering chat thread + composer area
 *   - Drawer header remains visible (user can still close drawer, open 歷史)
 *   - Internal sub-header with title + close button + helper text
 *   - Scrollable list of question buttons
 *   - Inline error banner if pick was blocked (session locked / hard cap)
 *
 * Accessibility: Escape closes; question buttons are tabbable; error
 * banner uses `role="alert"`.
 */

import { useEffect } from 'react';
import { useAllSampleQuestions } from './hooks/useSampleQuestions';
import type { ChatReadingType } from '../../lib/chat-api';
import styles from './SampleQuestionsBrowser.module.css';

interface SampleQuestionsBrowserProps {
  isOpen: boolean;
  readingType: ChatReadingType;
  /** Phase 2.x L3.5b — FORTUNE only. DAY/MONTH/YEAR scope filter. When set,
   *  the browser surfaces ONLY questions matching the scope. */
  fortuneScope?: 'DAY' | 'MONTH' | 'YEAR';
  /** Called when user closes the overlay (✕ tap or Escape). */
  onClose: () => void;
  /** Called when user picks a question. Drawer must check session.locked
   *  / atHardCap and either set onError to a warning string + keep open,
   *  OR call composerRef.current.appendToDraft and close. */
  onPick: (questionText: string) => void;
  /** Inline error string to display (set by drawer's onPick when blocked). */
  errorMessage?: string | null;
}

export default function SampleQuestionsBrowser({
  isOpen,
  readingType,
  fortuneScope,
  onClose,
  onPick,
  errorMessage,
}: SampleQuestionsBrowserProps) {
  const { questions, loading } = useAllSampleQuestions(readingType, fortuneScope);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-label="範例問題瀏覽">
      <div className={styles.subHeader}>
        <div className={styles.titleBlock}>
          <div className={styles.title}>想問什麼？</div>
          <div className={styles.subtitle}>
            點擊任一題目，將加入下方輸入框，可編輯後再傳送
          </div>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="關閉範例問題"
        >
          ✕
        </button>
      </div>

      {errorMessage && (
        <div className={styles.errorBanner} role="alert">
          {errorMessage}
        </div>
      )}

      <div className={styles.body}>
        {loading ? (
          <SkeletonRows />
        ) : questions.length === 0 ? (
          <div className={styles.empty}>此命書尚無範例問題。</div>
        ) : (
          <ul className={styles.list}>
            {questions.map((q) => (
              <li key={q.id} className={styles.listItem}>
                <button
                  type="button"
                  className={styles.questionBtn}
                  onClick={() => onPick(q.questionText)}
                  aria-label={`選擇問題：${q.questionText}`}
                >
                  <span className={styles.questionArrow} aria-hidden>
                    ›
                  </span>
                  <span className={styles.questionText}>{q.questionText}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && questions.length > 0 && (
        <div className={styles.footer}>
          共 {questions.length} 則範例問題
        </div>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className={styles.list} aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className={styles.listItem}>
          <div className={`${styles.questionBtn} ${styles.skeleton}`}>
            <span className={styles.skeletonText} />
          </div>
        </li>
      ))}
    </ul>
  );
}
