'use client';

/**
 * InlineAskCard — section-scoped "Ask AI about this section" card.
 *
 * Rendered in `renderAfterSection` slot of AIReadingDisplay. Shows up to
 * the first 2 active sample questions for the (readingType, sectionKey)
 * tuple, fetched from the DB-backed sample-questions service.
 *
 * Phase 2 (round-1 MED-#3) — `readingType` is a required prop. Caller
 * (the reading page) threads it down through AIReadingDisplay so each
 * reading type's chat shows its own section-specific questions.
 *
 * Returns null while loading or when no questions exist for this section
 * — best-effort UI sugar, never blocks the page.
 *
 * The buttons are keyboard-accessible — tabbable, Enter/Space activates.
 */

import { useSampleQuestions } from './hooks/useSampleQuestions';
import type { ChatReadingType } from '../../lib/chat-api';
import styles from './InlineAskCard.module.css';

interface InlineAskCardProps {
  readingType: ChatReadingType;
  sectionKey: string;
  /** Called when the user clicks one of the questions. The handler should
   *  open the drawer with the supplied sectionKey + question text. */
  onAsk: (sectionKey: string, question: string) => void;
  /** Called when the user clicks the title-CTA «AI 命理師深入解答».
   *  Should open the chat drawer with the supplied sectionKey as context
   *  hint, but WITHOUT auto-sending a question — user types/picks their
   *  own. Optional: if omitted, the title CTA is rendered as plain text. */
  onOpenChat?: (sectionKey: string) => void;
}

export default function InlineAskCard({
  readingType,
  sectionKey,
  onAsk,
  onOpenChat,
}: InlineAskCardProps) {
  const { questions, loading } = useSampleQuestions(readingType, sectionKey);

  // Don't render anything while loading or if no curated questions exist
  // for this (readingType, sectionKey) — keeps the reading page clean.
  if (loading || questions.length === 0) return null;

  const visible = questions.slice(0, 2); // show at most 2 questions per card

  return (
    <div className={styles.card} role="region" aria-label="向 AI 命理師詢問此區塊">
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden>💬</span>
        <span className={styles.title}>
          這段想了解更多？
          {onOpenChat ? (
            <button
              type="button"
              className={styles.titleCTA}
              onClick={() => onOpenChat(sectionKey)}
              aria-label="開啟 AI 命理師對話"
            >
              AI 命理師深入解答
            </button>
          ) : (
            <span className={styles.titleCTAPlain}>AI 命理師深入解答</span>
          )}
        </span>
      </div>
      <div className={styles.questions}>
        {visible.map((q) => (
          <button
            key={q.id}
            type="button"
            className={styles.questionBtn}
            onClick={() => onAsk(sectionKey, q.questionText)}
          >
            <span className={styles.questionArrow} aria-hidden>›</span>
            <span className={styles.questionText}>{q.questionText}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
