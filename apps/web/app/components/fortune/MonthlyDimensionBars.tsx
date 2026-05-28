'use client';

/**
 * MonthlyDimensionBars — Phase 2 月運 4-dim vertical mini bars.
 *
 * Mirror of `DimensionBars` (DAY scope, 5 dims) scaled to MONTH scope
 * (4 dims, no 出行).
 *
 * Per Phase A Sub-Agent B research lock (2026-05-28): 出行 OMITTED
 * (DAY-only doctrine per 三命通會 神煞篇). 4 dims: career / finance /
 * romance / health.
 *
 * Reuses the existing `DimensionBars.module.css` for consistent visual
 * styling (same icon + bar + score + label arrangement).
 */
import type { MonthlyFortuneDimension } from '../../lib/fortune-api';
import { dimTierFromScore } from './labels';
import { MONTHLY_DIM_META, type MonthlyDimKey } from './monthlyDimensions';
import styles from './DimensionBars.module.css';

interface Props {
  dimensions: Record<MonthlyDimKey, MonthlyFortuneDimension>;
}

export default function MonthlyDimensionBars({ dimensions }: Props) {
  return (
    <div className={styles.wrap} role="list">
      {MONTHLY_DIM_META.map((m) => {
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
              <div
                className={styles.barFill}
                style={{ height: `${score}%` }}
              />
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
