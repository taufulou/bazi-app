'use client';

/**
 * FortuneSampleQuestions — horizontal pill strip of «general» FORTUNE chat
 * questions (sectionKey=null) rendered below the daily NarrativeCard.
 *
 * Mirrors the InlineAskCard pattern (Phase 4) but flows horizontally and
 * uses sectionKey=null for general questions (not section-scoped — those
 * live in per-dim InlineAskCard under each dimension block).
 *
 * Pill tap PROPULATES the chat composer draft via the parent's onAsk
 * handler — does NOT auto-send. This mirrors the plan's iOS Safari
 * decision (predictable UX + explicit send step).
 *
 * Loading state: collapsed (returns null) — best-effort UI sugar.
 */

import { useSampleQuestions } from '../chat/hooks/useSampleQuestions';
import styles from './FortuneSampleQuestions.module.css';

interface FortuneSampleQuestionsProps {
  /** Called when the user taps a pill — opens the drawer + populates the
   *  composer draft with the supplied question text. */
  onAsk: (question: string) => void;
  /** Called when the user taps the title CTA — opens the drawer empty so
   *  the user types their own question. */
  onOpenChat: () => void;
}

export default function FortuneSampleQuestions({
  onAsk,
  onOpenChat,
}: FortuneSampleQuestionsProps) {
  // FORTUNE chat general questions live at sectionKey=null
  const { questions, loading } = useSampleQuestions('FORTUNE', null);

  if (loading || questions.length === 0) return null;

  // Cap at 6 pills — keeps the strip from overflowing on narrow viewports.
  // Mobile horizontally-scrolls if it overflows.
  const visible = questions.slice(0, 6);

  return (
    <div
      className={styles.card}
      role="region"
      aria-label="向 AI 命理師詢問今日運勢"
    >
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden>
          💬
        </span>
        <span className={styles.title}>
          想了解今日更多？
          <button
            type="button"
            className={styles.titleCTA}
            onClick={onOpenChat}
            aria-label="開啟 AI 命理師對話"
          >
            AI 命理師深入解答
          </button>
        </span>
      </div>
      <div className={styles.pills}>
        {visible.map((q) => (
          <button
            key={q.id}
            type="button"
            className={styles.pill}
            onClick={() => onAsk(q.questionText)}
          >
            <span className={styles.pillArrow} aria-hidden>
              ›
            </span>
            <span className={styles.pillText}>{q.questionText}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
