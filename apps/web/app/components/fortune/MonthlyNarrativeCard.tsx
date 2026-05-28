'use client';

/**
 * MonthlyNarrativeCard — Phase 2 月運 AI narrative display.
 *
 * Mirror of `NarrativeCard` (DAY scope) scaled for MONTH scope. Simpler
 * than daily because Phase 2 does NOT yet ship monthly streaming —
 * narrative arrives complete-or-null (loading skeleton in between).
 *
 * Sections per `MonthlyFortuneNarrative`:
 *   1. Hero overview (monthly_overview)
 *   2. 4 dim cards (career/finance/romance/health) — each with
 *      optional `monthly_<dim>_takeaway` pull-quote + soft-trigger framing
 *   3. monthly_advice (canTry / shouldHold) — symmetric to daily
 *   4. Optional intra_month_breakdown (when L1.b data was injected)
 *
 * Sub-Agent B locks NO 出行 dim (DAY-only doctrine). Folk content
 * OMITTED entirely (Sub-Agent C clause 6 — DAY-only differentiator).
 *
 * Anti-hallucination Clause 7 (cross-month redirect) + Clause 5
 * (intra-month references only from structured data) enforced AT PROMPT
 * level — no validator backstop here yet (Phase 2.x candidate).
 */
import type { MonthlyFortuneNarrative } from '../../lib/fortune-api';
import { dimTierFromScore } from './labels';
import { parseBoldSegments } from './markdown';
import { MONTHLY_DIM_META } from './monthlyDimensions';
import styles from './MonthlyNarrativeCard.module.css';

interface Props {
  narrative: MonthlyFortuneNarrative | null;
  /** 4-dim score map for badge display (mirrors daily DimensionBars data). */
  dimensions: Record<
    'career' | 'finance' | 'romance' | 'health',
    { score: number; label: string }
  >;
  loading?: boolean;
}

function RichText({ text }: { text: string }) {
  const segments = parseBoldSegments(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'bold' ? (
          <strong key={i}>{seg.value}</strong>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}

/** Render skeleton placeholder lines per dim. */
function DimSkeleton() {
  return (
    <div className={styles.skeletonProse}>
      <div className={styles.skeletonLine} style={{ width: '94%' }} />
      <div className={styles.skeletonLine} style={{ width: '90%' }} />
      <div className={styles.skeletonLine} style={{ width: '85%' }} />
      <div className={styles.skeletonLine} style={{ width: '65%' }} />
    </div>
  );
}

export default function MonthlyNarrativeCard({
  narrative,
  dimensions,
  loading = false,
}: Props) {
  // Loading state — full skeleton matching final layout (preserves
  // disclaimer Y position, per Phase Fortune Streaming H4 lesson).
  if (!narrative && loading) {
    return (
      <section
        className={styles.wrap}
        aria-busy="true"
        aria-label="本月 AI 解讀載入中"
      >
        <div className={styles.hero}>
          <h3 className={styles.heroTitle}>本月整體</h3>
          <div className={styles.skeletonProse}>
            <div className={styles.skeletonLine} style={{ width: '92%' }} />
            <div className={styles.skeletonLine} style={{ width: '88%' }} />
            <div className={styles.skeletonLine} style={{ width: '70%' }} />
          </div>
          <div className={styles.skeletonHint}>
            AI 命理師正在為您解讀本月命盤…
          </div>
        </div>
        <div className={styles.dims}>
          {MONTHLY_DIM_META.map((m) => (
            <article key={m.key} className={styles.dimBlock}>
              <header className={styles.dimHeader}>
                <span className={styles.dimIcon} aria-hidden="true">
                  <m.Icon size={18} strokeWidth={1.8} />
                </span>
                <span className={styles.dimTitle}>{m.zh}</span>
              </header>
              <DimSkeleton />
            </article>
          ))}
        </div>
        <p className={styles.disclaimer}>
          ※ 本月運勢為「持續趨勢」框架，引擎依據命格 + 月柱 +
          partition-bucket 訊號生成。具體日期細節請查《八字日運》。
        </p>
      </section>
    );
  }

  // Error / unavailable state — narrative null and not loading
  if (!narrative) {
    return (
      <div className={styles.fallback}>
        <p className={styles.fallbackLead}>
          ⚠️ 本月 AI 解讀暫不可用。請重新整理頁面再試一次。
        </p>
      </div>
    );
  }

  return (
    <section className={styles.wrap} aria-label="本月運勢解讀">
      {/* Hero overview — full-width white card */}
      <div className={styles.hero}>
        <h3 className={styles.heroTitle}>本月整體</h3>
        <p className={styles.heroBody}>
          <RichText text={narrative.monthly_overview} />
        </p>
      </div>

      {/* 4 dim cards (no 出行 per Sub-Agent B doctrine lock) */}
      <div className={styles.dims}>
        {MONTHLY_DIM_META.map((m) => {
          const dim = dimensions[m.key];
          const score = dim ? Math.max(0, Math.min(100, dim.score)) : 50;
          const t = dimTierFromScore(score);
          const text = narrative[m.narrativeKey];
          const takeaway = narrative[m.takeawayKey];

          return (
            <article
              key={m.key}
              className={styles.dimBlock}
              data-tier={t}
            >
              <header className={styles.dimHeader}>
                <span className={styles.dimIcon} aria-hidden="true">
                  <m.Icon size={18} strokeWidth={1.8} />
                </span>
                <span className={styles.dimTitle}>{m.zh}</span>
                {dim && (
                  <span className={styles.dimBadge} data-tier={t}>
                    <span
                      className={styles.dimBadgeDot}
                      aria-hidden="true"
                    />
                    <span className={styles.dimBadgeScore}>{score}</span>
                    <span className={styles.dimBadgeLabel}>{dim.label}</span>
                  </span>
                )}
              </header>

              {/* Takeaway pull-quote — accent-color left border (R1.4 / S3.1) */}
              {typeof takeaway === 'string' && takeaway.length > 0 && (
                <p className={styles.takeaway}>
                  <RichText text={takeaway} />
                </p>
              )}

              {typeof text === 'string' && text.length > 0 ? (
                <p className={styles.dimBody}>
                  <RichText text={text} />
                </p>
              ) : (
                <p className={styles.dimEmpty}>
                  本月此面向平穩無特別動向
                </p>
              )}
            </article>
          );
        })}
      </div>

      {/* Intra-month breakdown narrative — only when AI emitted it
       *  (engine L1.b data was injected at prompt time) */}
      {narrative.intra_month_breakdown &&
        narrative.intra_month_breakdown.length > 0 && (
          <div className={styles.breakdown}>
            <h4 className={styles.breakdownTitle}>本月時段建議</h4>
            {narrative.intra_month_breakdown.map((b, i) => (
              <div key={i} className={styles.breakdownItem}>
                <span className={styles.breakdownLabel}>
                  {b.partition_label}
                </span>
                <p className={styles.breakdownBody}>
                  <RichText text={b.narrative} />
                </p>
              </div>
            ))}
          </div>
        )}

      {/* monthly_advice — canTry / shouldHold pair */}
      <div className={styles.adviceGrid}>
        <div className={styles.adviceCard} data-tone="positive">
          <h4 className={styles.adviceTitle}>本月可試試</h4>
          <ul className={styles.adviceList}>
            {narrative.monthly_advice.canTry.map((item, i) => (
              <li key={i}>
                <RichText text={item} />
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.adviceCard} data-tone="caution">
          <h4 className={styles.adviceTitle}>本月宜緩</h4>
          <ul className={styles.adviceList}>
            {narrative.monthly_advice.shouldHold.map((item, i) => (
              <li key={i}>
                <RichText text={item} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className={styles.disclaimer}>
        ※ 本月運勢為「持續趨勢」框架（per 三命通會 月運篇「月運主一月之氣象」），
        引擎依據命格 + 月柱 + partition-bucket 訊號生成。具體日期細節請查
        《八字日運》。本服務僅供參考與娛樂用途。
      </p>
    </section>
  );
}
