'use client';

/**
 * DimensionBars — 5 vertical mini bars for daily fortune dimensions
 * (感情/事業/財運/出行/健康) showing each dim's 0-100 score.
 *
 * Per UX Refinement Sprint 2.C: icons via Lucide React from shared
 * `dimensions.ts` (replaces phone emojis 💗💼💰🧭🍃 — premium feel +
 * cross-OS consistency). Tier color uses `labels.ts::dimTierFromScore`.
 */
import type { FortuneDimension } from '../../lib/fortune-api';
import { DIM_META } from './dimensions';
import { dimTierFromScore } from './labels';
import styles from './DimensionBars.module.css';

interface Props {
  dimensions: Record<'romance' | 'career' | 'finance' | 'travel' | 'health', FortuneDimension>;
}

export default function DimensionBars({ dimensions }: Props) {
  return (
    <div className={styles.wrap} role="list">
      {DIM_META.map((m) => {
        const dim = dimensions[m.key];
        const score = Math.max(0, Math.min(100, dim?.score ?? 50));
        const t = dimTierFromScore(score);
        const { Icon } = m;
        return (
          <div
            key={m.key}
            className={styles.col}
            role="listitem"
            data-tier={t}
            aria-label={`${m.zh}：${score}分${dim?.label ? `，${dim.label}` : ''}`}
          >
            <span className={styles.icon} aria-hidden="true">
              <Icon size={20} strokeWidth={1.8} />
            </span>
            <div className={styles.barTrack} aria-hidden="true">
              <div className={styles.barFill} style={{ height: `${score}%` }} />
            </div>
            <span className={styles.score}>{score}</span>
            <span className={styles.dimName}>{m.zh}</span>
            {dim?.label && <span className={styles.dimLabel}>{dim.label}</span>}
          </div>
        );
      })}
    </div>
  );
}
