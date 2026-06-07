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
import * as React from 'react'; // VALUE namespace import — dual @types/react JSX-identity fix (CLAUDE.md)
import type { MonthlyFortuneNarrative } from '../../lib/fortune-api';
import { dimTierFromScore } from './labels';
import { parseBoldSegments } from './markdown';
import { MONTHLY_DIM_META, type MonthlyDimKey } from './monthlyDimensions';
import styles from './MonthlyNarrativeCard.module.css';

interface Props {
  narrative: MonthlyFortuneNarrative | null;
  /** 4-dim score map for badge display (mirrors daily DimensionBars data). */
  dimensions: Record<
    'career' | 'finance' | 'romance' | 'health',
    { score: number; label: string }
  >;
  loading?: boolean;
  /**
   * Phase 2.x — Provisional per-section text from SSE `section_complete` events,
   * keyed by AI section key. When `narrative` is null (streaming in progress)
   * and `streamedSections` has entries, the component renders in hybrid mode:
   * per-section dispatch `narrative[key] ?? streamedSections[key] ?? skeleton`.
   * Mirrors daily NarrativeCard pattern. Cleared by caller on `done` event.
   *
   * Compound sections (monthly_advice object + intra_month_breakdown array)
   * are ALSO pulled from streamedSections (plan v2 M-2 fix — symmetric with
   * daily's adviceContent() selector). Note per plan M-6: trailing compound
   * sections may visibly skip the provisional flash because the detector
   * emits at close-bracket immediately followed by stream-end → done. The
   * selector still resolves correctly on the next render.
   */
  streamedSections?: Partial<MonthlyFortuneNarrative>;
  /** MONTH per-dim parity (mirror Tier B2 YEAR) — optional slot rendered AFTER
   *  each dim block, for per-dim InlineAskCard wiring (parent passes a
   *  `monthly_*` sectionKey card). 3-state visibility: shown when the dim is
   *  actually rendered (has `text` OR the «本月此面向平穩» empty-state), hidden
   *  (visibility:hidden, layout-reserving) ONLY during the streaming skeleton —
   *  a `text`-only guard would wrongly hide the ask card under a visibly-
   *  rendered 平穩 dim (mirror of YearlyNarrativeCard). */
  renderAfterDimension?: (dimKey: MonthlyDimKey) => React.ReactNode;
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
  streamedSections,
  renderAfterDimension,
}: Props) {
  // Phase 2.x — hybrid mode: streamedSections present + narrative not yet final.
  // In this state, per-section text comes from `narrative[key] ?? streamedSections[key] ?? null`.
  const hasStreamedSections =
    !narrative && !!streamedSections && Object.keys(streamedSections).length > 0;

  // Loading state — full skeleton matching final layout (preserves
  // disclaimer Y position, per Phase Fortune Streaming H4 lesson).
  // Only render pure skeleton when neither narrative nor streamedSections exist.
  if (!narrative && !hasStreamedSections && loading) {
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

  // Error / unavailable state — narrative null + NOT in hybrid streaming mode.
  // (Hybrid mode renders the success layout below with per-section fallbacks
  // pulling from streamedSections.)
  if (!narrative && !hasStreamedSections) {
    return (
      <div className={styles.fallback}>
        <p className={styles.fallbackLead}>
          AI 文字解讀暫時無法產生，可能因命理師服務忙線。上方的能量指數、四大面向與時段分析仍可參考，稍後再回來即可看到完整解讀。
        </p>
      </div>
    );
  }

  // Per-section selector for STRING sections (Plan v3 M-2 + R3 polish):
  // narrative wins, then provisional from streamedSections, then null = skeleton.
  // Used for monthly_overview, monthly_career, monthly_finance, monthly_romance,
  // monthly_health, and *_takeaway variants.
  const sectionText = (key: keyof MonthlyFortuneNarrative): string | null => {
    const fromNarrative = narrative?.[key];
    const fromStreamed = streamedSections?.[key];
    if (typeof fromNarrative === 'string' && fromNarrative.length > 0) return fromNarrative;
    if (typeof fromStreamed === 'string' && fromStreamed.length > 0) return fromStreamed;
    return null;
  };

  // Plan v3 M-2 fix — compound sections (object + array) ALSO pull from streamedSections.
  // Mirror daily NarrativeCard's adviceContent() pattern.
  const monthlyAdvice =
    narrative?.monthly_advice ?? streamedSections?.monthly_advice ?? null;
  const intraMonthBreakdown =
    narrative?.intra_month_breakdown ?? streamedSections?.intra_month_breakdown ?? null;

  // Hero text — string section
  const overviewText = sectionText('monthly_overview');

  return (
    <section className={styles.wrap} aria-label="本月運勢解讀">
      {/* Hero overview — full-width white card */}
      <div className={styles.hero}>
        <h3 className={styles.heroTitle}>本月整體</h3>
        {overviewText ? (
          <p className={styles.heroBody}>
            <RichText text={overviewText} />
          </p>
        ) : (
          <div className={styles.skeletonProse} aria-busy="true" aria-label="本月整體載入中">
            <div className={styles.skeletonLine} style={{ width: '92%' }} />
            <div className={styles.skeletonLine} style={{ width: '88%' }} />
            <div className={styles.skeletonLine} style={{ width: '70%' }} />
          </div>
        )}
      </div>

      {/* 4 dim cards (no 出行 per Sub-Agent B doctrine lock).
       *  Audit fix MEDIUM #9 (2026-05-28): explicit role="list" +
       *  role="listitem" for screen-reader navigation flow (mirror of
       *  MonthlyDimensionBars + MonthlyTimeGrid patterns). */}
      <div className={styles.dims} role="list">
        {MONTHLY_DIM_META.map((m) => {
          const dim = dimensions[m.key];
          const score = dim ? Math.max(0, Math.min(100, dim.score)) : 50;
          const t = dimTierFromScore(score);
          const text = sectionText(m.narrativeKey);
          const takeaway = sectionText(m.takeawayKey);

          return (
            <article
              key={m.key}
              role="listitem"
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
              {takeaway && (
                <p className={styles.takeaway}>
                  <RichText text={takeaway} />
                </p>
              )}

              {text ? (
                <p className={styles.dimBody}>
                  <RichText text={text} />
                </p>
              ) : narrative ? (
                // Final narrative has this section as empty → render the "no
                // signals" empty state (existing behavior).
                <p className={styles.dimEmpty}>
                  本月此面向平穩無特別動向
                </p>
              ) : (
                // Hybrid mode — section not yet arrived. Render skeleton.
                <div className={styles.skeletonProse} aria-busy="true" aria-label={`${m.zh}載入中`}>
                  <div className={styles.skeletonLine} style={{ width: '94%' }} />
                  <div className={styles.skeletonLine} style={{ width: '90%' }} />
                  <div className={styles.skeletonLine} style={{ width: '85%' }} />
                  <div className={styles.skeletonLine} style={{ width: '65%' }} />
                </div>
              )}

              {/* MONTH per-dim InlineAskCard slot (parity with YEAR Tier B2).
                  Visible when the dim is rendered (text OR 平穩 empty-state);
                  hidden (layout-reserving) during the streaming skeleton. */}
              {renderAfterDimension ? (
                text || narrative ? (
                  renderAfterDimension(m.key)
                ) : (
                  <div style={{ visibility: 'hidden' }} aria-hidden="true">
                    {renderAfterDimension(m.key)}
                  </div>
                )
              ) : null}
            </article>
          );
        })}
      </div>

      {/* Intra-month breakdown narrative — populated from final narrative OR
       *  streamedSections (plan v3 M-2 fix). Note plan M-6: trailing compound
       *  sections may visibly skip the provisional flash because the detector
       *  emits at close-bracket immediately followed by stream-end → done. */}
      {intraMonthBreakdown && intraMonthBreakdown.length > 0 && (
        <div className={styles.breakdown}>
          <h4 className={styles.breakdownTitle}>本月時段建議</h4>
          {intraMonthBreakdown.map((b, i) => (
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

      {/* monthly_advice — canTry / shouldHold pair. Plan v3 M-2: pulls from
       *  streamedSections in hybrid mode (mirror daily adviceContent()). */}
      {monthlyAdvice && (
        <div className={styles.adviceGrid}>
          <div className={styles.adviceCard} data-tone="positive">
            <h4 className={styles.adviceTitle}>本月可試試</h4>
            <ul className={styles.adviceList} role="list">
              {monthlyAdvice.canTry.map((item, i) => (
                <li key={i}>
                  <RichText text={item} />
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.adviceCard} data-tone="caution">
            <h4 className={styles.adviceTitle}>本月宜緩</h4>
            <ul className={styles.adviceList} role="list">
              {monthlyAdvice.shouldHold.map((item, i) => (
                <li key={i}>
                  <RichText text={item} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <p className={styles.disclaimer}>
        ※ 本月運勢為「持續趨勢」框架（per 三命通會 月運篇「月運主一月之氣象」），
        引擎依據命格 + 月柱 + partition-bucket 訊號生成。具體日期細節請查
        《八字日運》。本服務僅供參考與娛樂用途。
      </p>
    </section>
  );
}
