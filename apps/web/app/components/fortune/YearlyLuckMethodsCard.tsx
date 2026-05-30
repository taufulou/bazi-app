'use client';

/**
 * YearlyLuckMethodsCard — Phase 3 年運 改運建議&好運加持 section.
 *
 * Renders the engine `luckMethods.cards[]` (title + body). Cards whose
 * provenance is 'folk_tradition' or 'mixed' get a visible 「民俗」 badge
 * (reuses the daily FolkContentCard badge styling/disclosure pattern) so
 * users understand the doctrinal tier. A disclaimer follows below.
 *
 * The weakestDim (engine-computed) drives which methods are surfaced; we
 * show the engine's pre-rendered cards verbatim (no AI prose here — these
 * are deterministic 民俗/改運 suggestions, mirroring the daily folk content
 * which is also AI-free).
 *
 * Anti-hallucination: all card content is from the engine; nothing is
 * AI-generated. Same contract as the daily FolkContentCard.
 */
import type { YearlyLuckMethods } from '../../lib/fortune-api';
import styles from './YearlyLuckMethodsCard.module.css';

interface Props {
  luckMethods: YearlyLuckMethods;
}

/** True when the card's provenance warrants a 民俗 disclosure badge. */
function showsFolkBadge(provenance: string): boolean {
  return provenance === 'folk_tradition' || provenance === 'mixed';
}

export default function YearlyLuckMethodsCard({ luckMethods }: Props) {
  const { cards, weakestDimZh, disclaimer } = luckMethods;

  if (!cards || cards.length === 0) return null;

  return (
    <section
      className={styles.section}
      aria-labelledby="yearly-luck-methods-title"
    >
      <header className={styles.header}>
        <h3 id="yearly-luck-methods-title" className={styles.title}>
          改運建議 &amp; 好運加持
        </h3>
        {weakestDimZh && (
          <p className={styles.subtitle}>
            本年度可特別留意「{weakestDimZh}」面向的調養
          </p>
        )}
      </header>

      <div className={styles.grid} role="list">
        {cards.map((card) => (
          <article key={card.id} className={styles.card} role="listitem">
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>{card.title}</span>
              {showsFolkBadge(card.provenance) && (
                <span
                  className={styles.folkBadge}
                  title="民俗來源 — 較典籍級別參考性弱"
                >
                  民俗
                </span>
              )}
            </div>
            <p className={styles.cardBody}>{card.body}</p>
            {(card.usefulGodElement ||
              card.usefulGodDirection ||
              card.usefulGodColor) && (
              <div className={styles.cardMeta}>
                {card.usefulGodElement && (
                  <span className={styles.cardMetaChip}>
                    用神：{card.usefulGodElement}
                  </span>
                )}
                {card.usefulGodDirection && (
                  <span className={styles.cardMetaChip}>
                    方位：{card.usefulGodDirection}
                  </span>
                )}
                {card.usefulGodColor && (
                  <span className={styles.cardMetaChip}>
                    色：{card.usefulGodColor}
                  </span>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      {disclaimer && <p className={styles.disclaimer}>{disclaimer}</p>}
    </section>
  );
}
