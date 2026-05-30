'use client';

/**
 * YearlyDimensionStars — Phase 3 年運 4-dim ★ star-rating cards.
 *
 * NET-NEW component (the monthly equivalent uses vertical bars; the locked
 * Phase 3 design uses ★1-5 STAR ratings per Seer's 年度 dim layout).
 *
 * Per locked design: 4 cards (事業/財運/感情/健康). Each card shows:
 *   - dim icon + zh label
 *   - ★1-5 filled / ☆ empty stars (from engine `stars`)
 *   - optional AI keyword (from narrative `yearly_<dim>_keyword`)
 *   - the verdict label (engine `label`, e.g. 順遂/平穩/需謹慎)
 *
 * The 0-100 score is NOT shown here (overall year uses the ring; dims use
 * stars per the hybrid visual lock). Star glyphs are ★ / ☆ characters with
 * tier-aware color via data-tier.
 */
import type { YearlyFortuneDimension } from '../../lib/fortune-api';
import { dimTierFromScore } from './labels';
import { YEARLY_DIM_META, type YearlyDimKey } from './yearlyDimensions';
import styles from './YearlyDimensionStars.module.css';

interface Props {
  dimensions: Record<YearlyDimKey, YearlyFortuneDimension>;
  /** Optional AI keywords per dim (from narrative yearly_<dim>_keyword).
   *  When absent (engine-only / streaming-not-yet-arrived) the card simply
   *  omits the keyword line. */
  keywords?: Partial<Record<YearlyDimKey, string | undefined>>;
}

const MAX_STARS = 5;

/** Render ★ (filled) / ☆ (empty) glyph row for a 1-5 star rating. */
function StarRow({ stars, dimZh }: { stars: number; dimZh: string }) {
  const filled = Math.max(0, Math.min(MAX_STARS, Math.round(stars)));
  return (
    <div
      className={styles.stars}
      role="img"
      aria-label={`${dimZh}：${filled} 顆星（共 ${MAX_STARS} 顆）`}
    >
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <span
          key={i}
          className={styles.star}
          data-filled={i < filled}
          aria-hidden="true"
        >
          {i < filled ? '★' : '☆'}
        </span>
      ))}
    </div>
  );
}

export default function YearlyDimensionStars({ dimensions, keywords }: Props) {
  return (
    <div className={styles.wrap} role="list" aria-label="年度四大面向">
      {YEARLY_DIM_META.map((m) => {
        const dim = dimensions[m.key];
        const stars = dim?.stars ?? 3;
        const score = dim?.score ?? 50;
        const t = dimTierFromScore(score);
        const keyword = keywords?.[m.key];
        const { Icon } = m;
        return (
          <div
            key={m.key}
            className={styles.card}
            role="listitem"
            data-tier={t}
            aria-label={`${m.zh}${dim?.label ? `：${dim.label}` : ''}`}
          >
            <header className={styles.cardHeader}>
              <span className={styles.icon} aria-hidden="true">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className={styles.dimName}>{m.zh}</span>
            </header>

            <StarRow stars={stars} dimZh={m.zh} />

            {keyword && <p className={styles.keyword}>{keyword}</p>}

            {dim?.label && (
              <span className={styles.dimLabel} data-tier={t}>
                {dim.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
