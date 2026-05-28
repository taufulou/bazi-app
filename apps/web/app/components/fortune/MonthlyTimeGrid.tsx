'use client';

/**
 * MonthlyTimeGrid — Phase 2 月運 intra-month partition display.
 *
 * Per Phase A Sub-Agent A research lock (2026-05-28): partition LOCKED
 * to `tiangan_dizhi_half` — 2 cells:
 *   - 上半月 (governed by 流月天干, 主動氣先出)
 *   - 下半月 (governed by 流月地支, 靜氣後沉)
 *
 * Doctrine source: 司莹居士《八字泄天机》中卷 流月逼進法 + ≥5 modern
 * Bazi-master sources (算准网 / 网易 / 神机阁 / 筱竹命理 / 沃酷). The
 * 子平 axiom that 天干主動主上、地支主靜主下 grounds the dispatch.
 *
 * Rendering modes:
 *   - WITH intraMonthBreakdown: full per-bucket stats (auspicious/challenging/
 *     neutral day counts + dominant_shensha tags + top peak signals)
 *   - WITHOUT intraMonthBreakdown: minimal partition concept display
 *     (label + governing_pillar badge + day range only)
 *
 * Anti-hallucination contract (Clause 5): AI prompt is forbidden from
 * inventing specific dates; this UI surfaces only structured engine data.
 */
import type {
  PartitionSpec,
  IntraMonthBreakdown,
} from '../../lib/fortune-api';
import styles from './MonthlyTimeGrid.module.css';

interface Props {
  /** PartitionSpec from engine (always `tiangan_dizhi_half` per locked decision) */
  partitionSpec: PartitionSpec;
  /** L1.b intra-month aggregation (optional — only populated when caller opts in) */
  intraMonthBreakdown?: IntraMonthBreakdown;
  /** Month pillar context for badge subtitles (e.g., monthStem='癸', monthBranch='巳') */
  monthStem?: string;
  monthBranch?: string;
}

/** Map governing_pillar to display badge label. */
function governingPillarLabel(
  pillar: 'stem' | 'branch',
  monthStem?: string,
  monthBranch?: string,
): string {
  if (pillar === 'stem') {
    return monthStem ? `流月天干 (${monthStem}) 主氣` : '流月天干主氣';
  }
  return monthBranch ? `流月地支 (${monthBranch}) 主氣` : '流月地支主氣';
}

/** Format day_range as a human-readable string. */
function formatDayRange(dayRange: [number, number | null]): string {
  const [start, end] = dayRange;
  if (end === null) return `第 ${start} 天起 ~ 月末`;
  return `第 ${start} ~ ${end} 天`;
}

export default function MonthlyTimeGrid({
  partitionSpec,
  intraMonthBreakdown,
  monthStem,
  monthBranch,
}: Props) {
  const buckets = partitionSpec.buckets;
  // Align bucket index with intraMonthBreakdown.buckets index (1:1 mapping).
  const breakdownBuckets = intraMonthBreakdown?.buckets ?? [];

  return (
    <section
      className={styles.section}
      aria-labelledby="monthly-time-grid-title"
    >
      <header className={styles.header}>
        <h3 id="monthly-time-grid-title" className={styles.title}>
          本月時段分析
        </h3>
        <p className={styles.subtitle}>
          流月逼進法 — 上半月主天干氣，下半月主地支氣
        </p>
      </header>

      <div className={styles.grid} role="list">
        {buckets.map((bucket, idx) => {
          const breakdown = breakdownBuckets[idx];
          const pillarLabel = governingPillarLabel(
            bucket.governing_pillar,
            monthStem,
            monthBranch,
          );

          return (
            <div
              key={bucket.label}
              className={styles.card}
              role="listitem"
              data-pillar={bucket.governing_pillar}
            >
              {/* Header — bucket label + governing pillar badge */}
              <div className={styles.cardHeader}>
                <h4 className={styles.cardTitle}>{bucket.label}</h4>
                <span
                  className={styles.pillarBadge}
                  data-pillar={bucket.governing_pillar}
                >
                  {pillarLabel}
                </span>
              </div>

              <p className={styles.cardRange}>{formatDayRange(bucket.day_range)}</p>

              {/* Breakdown stats — only when L1.b data is provided */}
              {breakdown && (
                <>
                  <div
                    className={styles.dayCounts}
                    aria-label="本段日吉凶分布"
                  >
                    <span
                      className={styles.countItem}
                      data-tier="good"
                    >
                      吉 {breakdown.auspicious_days}
                    </span>
                    <span
                      className={styles.countItem}
                      data-tier="mid"
                    >
                      平 {breakdown.neutral_days}
                    </span>
                    <span
                      className={styles.countItem}
                      data-tier="low"
                    >
                      凶 {breakdown.challenging_days}
                    </span>
                  </div>

                  {breakdown.dominant_shensha.length > 0 && (
                    <div className={styles.shenshaRow}>
                      <span className={styles.shenshaLabel}>主導神煞：</span>
                      {breakdown.dominant_shensha.map((s) => (
                        <span key={s} className={styles.shenshaTag}>
                          {s}
                        </span>
                      ))}
                    </div>
                  )}

                  {breakdown.peak_signals.length > 0 && (
                    <ul className={styles.peakList} role="list">
                      {breakdown.peak_signals
                        .slice(0, 3)
                        .map((peak, peakIdx) => (
                          <li
                            // Audit fix HIGH #4 (2026-05-28): use bucket+index
                            // stable key instead of Math.random() which
                            // generates new key per render (breaks React
                            // reconciliation — lost focus, restarted CSS
                            // transitions, screen-reader re-announces).
                            // peak.date may be null per DTO; bucket label
                            // + index is stable across renders.
                            key={
                              peak.date ?? `${bucket.label}-peak-${peakIdx}`
                            }
                            className={styles.peakItem}
                            data-label={peak.label}
                          >
                            <span className={styles.peakDate}>
                              {peak.date}
                            </span>
                            <span className={styles.peakLabel}>
                              {peak.label}
                            </span>
                            {peak.signals[0] && (
                              <span className={styles.peakSignal}>
                                {peak.signals[0]}
                              </span>
                            )}
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              )}

              {!breakdown && (
                <p className={styles.placeholderHint}>
                  詳細日級訊號可在 AI narrative 中閱讀，或切換至《八字日運》查詢單日詳情
                </p>
              )}
            </div>
          );
        })}
      </div>

      {intraMonthBreakdown && (
        <p className={styles.windowInfo}>
          流月窗口：{intraMonthBreakdown.liuyue_window.start} —{' '}
          {intraMonthBreakdown.liuyue_window.end} (共{' '}
          {intraMonthBreakdown.liuyue_window.days} 天)
        </p>
      )}
    </section>
  );
}
