'use client';

/**
 * NarrativeCard — renders AI-generated narrative for the day.
 *
 * Sections (per FORTUNE_V1_PROMPTS.daily):
 *   - daily_overview  (full-width hero summary with chip line)
 *   - daily_<dim>     (5 per-dim cards with optional pull-quote takeaway)
 *   - daily_advice    (canTry + shouldHold cards)
 *
 * Per UX Refinement Sprint (locked 2026-05-15):
 *   - 今日整體 card uses white bg (.hero) — S2.E
 *   - Per-dim score chip restructured (2-line + tier dot + aria-label) — S2.F
 *   - Pull-quote takeaway above each dim narrative — S3.E + R1.7 (no italic)
 *   - Markdown bold via parseBoldSegments + JSX (no dangerouslySetInnerHTML) — R1.3
 *   - canTry/shouldHold as cards with green/amber borders + Lucide icons — S3.F
 *   - Lucide icons replace phone emojis — S2.C
 *   - ※ disclaimer reframed to plain Chinese — S3.G
 *
 * Engine-only fallback: when `narrative` is null (AI failed or engine-only
 * preview), shows a graceful placeholder + deterministic engine signals.
 */
import * as React from 'react';
import { CircleCheck, CircleSlash } from 'lucide-react';
import type {
  DailyFortuneNarrative,
  FortuneDimension,
  HeadlinerAnchor,
} from '../../lib/fortune-api';
import HeadlinerAnchorLine from './HeadlinerAnchorLine';
import { DIM_META } from './dimensions';
import { dimTierFromScore } from './labels';
import { parseBoldSegments } from './markdown';
import styles from './NarrativeCard.module.css';

/** Phase Fortune chat — per-dim render slot for InlineAskCard wiring. */
export type FortuneDimKey = 'romance' | 'career' | 'finance' | 'travel' | 'health';

interface Props {
  narrative: DailyFortuneNarrative | null;
  dimensions: Record<FortuneDimKey, FortuneDimension>;
  headlinerSignals?: {
    chartContext: HeadlinerAnchor[];
    triggers: HeadlinerAnchor[];
  };
  /** Phase Fortune chat — optional slot rendered AFTER each dim block.
   *  Parent passes `(dimKey) => <InlineAskCard readingType="FORTUNE"
   *  sectionKey={`daily_${dimKey}`} onAsk={...} onOpenChat={...} />`
   *  to wire per-dim chat questions. Mirrors AIReadingDisplay's
   *  renderAfterSection pattern at reading/[type]/page.tsx:754. */
  renderAfterDimension?: (dimKey: FortuneDimKey) => React.ReactNode;
}

/** Per-dim takeaway field key on the narrative (e.g. 'daily_romance_takeaway') */
type TakeawayKey =
  | 'daily_romance_takeaway'
  | 'daily_career_takeaway'
  | 'daily_finance_takeaway'
  | 'daily_travel_takeaway'
  | 'daily_health_takeaway';

function takeawayKeyFor(dimKey: typeof DIM_META[number]['key']): TakeawayKey {
  return `daily_${dimKey}_takeaway` as TakeawayKey;
}

/**
 * Render a string with **markdown bold** parsed into JSX <strong> segments.
 * Safe — uses React text escaping via segment values, no dangerouslySetInnerHTML.
 */
function RichText({ text }: { text: string }) {
  const segments = parseBoldSegments(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'bold' ? <strong key={i}>{seg.value}</strong> : <span key={i}>{seg.value}</span>,
      )}
    </>
  );
}

export default function NarrativeCard({
  narrative,
  dimensions,
  headlinerSignals,
  renderAfterDimension,
}: Props) {
  if (!narrative) {
    return (
      <div className={styles.fallback}>
        <p className={styles.fallbackLead}>
          ⚠️ 今日 AI 解讀暫不可用。下方為命局層級的結構化訊號：
        </p>
        <SignalsList dimensions={dimensions} />
      </div>
    );
  }

  return (
    <section className={styles.wrap}>
      {/* Hero overview — white card bg (S2.E) */}
      <div className={styles.hero}>
        <h3 className={styles.heroTitle}>今日整體</h3>
        {/* Option 2.5 UI layer — pre-narrative anchor chip line */}
        {headlinerSignals && headlinerSignals.chartContext.length > 0 && (
          <HeadlinerAnchorLine
            chartContext={headlinerSignals.chartContext}
            triggers={headlinerSignals.triggers}
          />
        )}
        <p className={styles.heroBody}>
          <RichText text={narrative.daily_overview} />
        </p>
      </div>

      {/* 5 dimensions */}
      <div className={styles.dims}>
        {DIM_META.map((m) => {
          const text = narrative[m.narrativeKey] as string;
          const takeaway = narrative[takeawayKeyFor(m.key)] as string | undefined;
          const dim = dimensions[m.key];
          const score = Math.max(0, Math.min(100, dim?.score ?? 50));
          const tier = dimTierFromScore(score);
          const { Icon } = m;
          return (
            <article key={m.key} className={styles.dimBlock}>
              <header className={styles.dimHeader}>
                <span className={styles.dimIcon} aria-hidden="true">
                  <Icon size={20} strokeWidth={1.8} />
                </span>
                <span className={styles.dimTitle}>{m.zh}</span>
                {dim && (
                  <span
                    className={styles.dimBadge}
                    data-tier={tier}
                    aria-label={`${m.zh}：${score}分，${dim.label}`}
                  >
                    <span className={styles.dimBadgeDot} aria-hidden="true" />
                    <span className={styles.dimBadgeScore}>{score}</span>
                    <span className={styles.dimBadgeLabel}>{dim.label}</span>
                  </span>
                )}
              </header>
              {/* Pull-quote takeaway (S3.E + R1.7 — no italic, uses left border + accent color) */}
              {takeaway && takeaway.trim() && (
                <blockquote className={styles.takeaway}>{takeaway}</blockquote>
              )}
              <p className={styles.dimBody}>
                <RichText text={text} />
              </p>
              {/* Phase Fortune chat — per-dim InlineAskCard slot.
                  Only fires when the dim block is actually rendered. */}
              {renderAfterDimension ? renderAfterDimension(m.key) : null}
            </article>
          );
        })}
      </div>

      {/* Advice cards (S3.F — restructured from <ul><li> to card pills) */}
      <div className={styles.adviceGrid}>
        <div className={styles.adviceCol} data-kind="canTry">
          <h4 className={styles.adviceTitle}>
            <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
            <span>今日可試試</span>
          </h4>
          <div className={styles.adviceList} role="list">
            {(narrative.daily_advice.canTry || []).map((item, i) => (
              <div key={`ct-${i}`} className={styles.adviceItem} data-kind="canTry" role="listitem">
                <CircleCheck size={14} strokeWidth={2} aria-hidden="true" className={styles.adviceItemIcon} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.adviceCol} data-kind="shouldHold">
          <h4 className={styles.adviceTitle}>
            <CircleSlash size={18} strokeWidth={2} aria-hidden="true" />
            <span>今日宜緩</span>
          </h4>
          <div className={styles.adviceList} role="list">
            {(narrative.daily_advice.shouldHold || []).map((item, i) => (
              <div key={`sh-${i}`} className={styles.adviceItem} data-kind="shouldHold" role="listitem">
                <CircleSlash size={14} strokeWidth={2} aria-hidden="true" className={styles.adviceItemIcon} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Soft-trigger disclaimer (S3.G — reframed in plain Chinese) */}
      <p className={styles.disclaimer}>
        ※ 今日運勢為「軟提示」— 主要受您命格、大運、流年的長期結構影響，每日只是觸發點。建議搭配其他層級綜合參考。
      </p>
    </section>
  );
}

// ============================================================
// Sub-component — structured signals fallback when AI unavailable
// ============================================================

function SignalsList({
  dimensions,
}: {
  dimensions: Record<'romance' | 'career' | 'finance' | 'travel' | 'health', FortuneDimension>;
}) {
  return (
    <div className={styles.signalsList}>
      {DIM_META.map((m) => {
        const dim = dimensions[m.key];
        if (!dim) return null;
        const { Icon } = m;
        return (
          <article key={m.key} className={styles.signalsBlock}>
            <h4 className={styles.signalsTitle}>
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              {m.zh} · {dim.score} · {dim.label}
            </h4>
            {dim.signals.length > 0 ? (
              <ul className={styles.signalsItems}>
                {dim.signals.map((sig, i) => (
                  <li key={i}>{sig.narrative}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.signalsEmpty}>今日該維度平穩，無特別動向</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
