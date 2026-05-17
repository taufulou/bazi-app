'use client';

/**
 * HeadlinerAnchorLine — pre-narrative tech-anchor chip line for Option 2.5 UI.
 *
 * Renders the engine-emitted `headlinerSignals` as two color zones:
 *   - chartContext (gold pills): 日干支 · 十神 · 整體判定 (always 3)
 *   - triggers (red pills): top 2 today-specific structural/softening signals
 *
 * Separator `｜` only renders when triggers are present (drops on quiet days).
 *
 * Design intent: scannable for new users (skim past), authoritative for Bazi
 * masters (see real structural anchors at a glance). See Phase 1 Option 2.5
 * doc + plan file for the curated priority list.
 */
import type { HeadlinerAnchor } from '../../lib/fortune-api';
import styles from './HeadlinerAnchorLine.module.css';

interface Props {
  chartContext: HeadlinerAnchor[];
  triggers: HeadlinerAnchor[];
}

export default function HeadlinerAnchorLine({ chartContext, triggers }: Props) {
  if (!chartContext.length) return null;

  return (
    <div
      className={styles.line}
      role="group"
      aria-label="今日命理依據"
    >
      <div className={styles.zone} data-zone="chart-context">
        {chartContext.map((anchor) => (
          <span
            key={anchor.type}
            className={styles.pill}
            data-tone="gold"
            title={anchor.type}
          >
            {anchor.label}
          </span>
        ))}
      </div>

      {triggers.length > 0 && (
        <>
          <span className={styles.separator} aria-hidden="true">｜</span>
          <div className={styles.zone} data-zone="triggers">
            {triggers.map((anchor) => (
              <span
                key={anchor.type}
                className={styles.pill}
                data-tone="red"
                title={anchor.type}
              >
                {anchor.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
