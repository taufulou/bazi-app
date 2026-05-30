'use client';

/**
 * YearlyNarrativeCard — Phase 3 年運 AI narrative display.
 *
 * Mirror of `MonthlyNarrativeCard` scaled for YEAR scope, with hybrid
 * streaming render (narrative > streamedSections > skeleton).
 *
 * Sections per `YearlyFortuneNarrative`:
 *   1. Hero (yearly_headline + yearly_overview)
 *   2. 4 dim prose blocks (career/finance/romance/health) — each with
 *      optional `yearly_<dim>_keyword` mini-label + verdict badge
 *   3. yearly_advice — single prose block (NOT canTry/shouldHold like
 *      monthly; the yearly reading gives holistic guidance)
 *
 * Canonical section order locked via YEARLY_DIM_META iteration (never trust
 * SSE event arrival order — plan H5 pattern from daily/monthly streaming).
 */
import type { YearlyFortuneNarrative } from '../../lib/fortune-api';
import { dimTierFromScore } from './labels';
import { parseBoldSegments } from './markdown';
import { YEARLY_DIM_META } from './yearlyDimensions';
import styles from './YearlyNarrativeCard.module.css';

interface Props {
  narrative: YearlyFortuneNarrative | null;
  /** 4-dim score map for badge display. */
  dimensions: Record<
    'career' | 'finance' | 'romance' | 'health',
    { score: number; label: string }
  >;
  loading?: boolean;
  /**
   * Phase 3 — Provisional per-section text from SSE `section_complete` events,
   * keyed by AI section key. When `narrative` is null (streaming in progress)
   * and `streamedSections` has entries, the component renders in hybrid mode:
   * per-section dispatch `narrative[key] ?? streamedSections[key] ?? skeleton`.
   * Mirrors monthly NarrativeCard pattern. Cleared by caller on `done` event.
   */
  streamedSections?: Partial<YearlyFortuneNarrative>;
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

export default function YearlyNarrativeCard({
  narrative,
  dimensions,
  loading = false,
  streamedSections,
}: Props) {
  const hasStreamedSections =
    !narrative && !!streamedSections && Object.keys(streamedSections).length > 0;

  // Loading state — full skeleton matching final layout (preserves disclaimer
  // Y position, per Phase Fortune Streaming H4 lesson).
  if (!narrative && !hasStreamedSections && loading) {
    return (
      <section
        className={styles.wrap}
        aria-busy="true"
        aria-label="今年 AI 解讀載入中"
      >
        <div className={styles.hero}>
          <h3 className={styles.heroTitle}>年度總結</h3>
          <div className={styles.skeletonProse}>
            <div className={styles.skeletonLine} style={{ width: '92%' }} />
            <div className={styles.skeletonLine} style={{ width: '88%' }} />
            <div className={styles.skeletonLine} style={{ width: '70%' }} />
          </div>
          <div className={styles.skeletonHint}>
            AI 命理師正在為您解讀今年命盤…
          </div>
        </div>
        <div className={styles.dims}>
          {YEARLY_DIM_META.map((m) => (
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
          ※ 今年運勢為「年度趨勢」框架，引擎依據命格 + 流年（+ 大運）訊號生成。
          具體月份細節請查《八字月運》。
        </p>
      </section>
    );
  }

  // Error / unavailable state — narrative null + NOT in hybrid streaming mode.
  if (!narrative && !hasStreamedSections) {
    return (
      <div className={styles.fallback}>
        <p className={styles.fallbackLead}>
          ⚠️ 今年 AI 解讀暫不可用。請重新整理頁面再試一次。
        </p>
      </div>
    );
  }

  // Per-section selector for STRING sections (narrative > provisional > null).
  const sectionText = (key: keyof YearlyFortuneNarrative): string | null => {
    const fromNarrative = narrative?.[key];
    const fromStreamed = streamedSections?.[key];
    if (typeof fromNarrative === 'string' && fromNarrative.length > 0) return fromNarrative;
    if (typeof fromStreamed === 'string' && fromStreamed.length > 0) return fromStreamed;
    return null;
  };

  const headlineText = sectionText('yearly_headline');
  const overviewText = sectionText('yearly_overview');
  const adviceText = sectionText('yearly_advice');

  return (
    <section className={styles.wrap} aria-label="年度運勢解讀">
      {/* Hero — headline + overview */}
      <div className={styles.hero}>
        <h3 className={styles.heroTitle}>年度總結</h3>
        {headlineText && (
          <p className={styles.heroHeadline}>
            <RichText text={headlineText} />
          </p>
        )}
        {overviewText ? (
          <p className={styles.heroBody}>
            <RichText text={overviewText} />
          </p>
        ) : (
          <div className={styles.skeletonProse} aria-busy="true" aria-label="年度總結載入中">
            <div className={styles.skeletonLine} style={{ width: '92%' }} />
            <div className={styles.skeletonLine} style={{ width: '88%' }} />
            <div className={styles.skeletonLine} style={{ width: '70%' }} />
          </div>
        )}
      </div>

      {/* 4 dim prose blocks */}
      <div className={styles.dims} role="list">
        {YEARLY_DIM_META.map((m) => {
          const dim = dimensions[m.key];
          const score = dim ? Math.max(0, Math.min(100, dim.score)) : 50;
          const t = dimTierFromScore(score);
          const text = sectionText(m.narrativeKey);
          const keyword = sectionText(m.keywordKey);

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
                {keyword && <span className={styles.dimKeyword}>{keyword}</span>}
                {dim && (
                  <span className={styles.dimBadge} data-tier={t}>
                    <span className={styles.dimBadgeDot} aria-hidden="true" />
                    <span className={styles.dimBadgeLabel}>{dim.label}</span>
                  </span>
                )}
              </header>

              {text ? (
                <p className={styles.dimBody}>
                  <RichText text={text} />
                </p>
              ) : narrative ? (
                <p className={styles.dimEmpty}>今年此面向平穩無特別動向</p>
              ) : (
                <div className={styles.skeletonProse} aria-busy="true" aria-label={`${m.zh}載入中`}>
                  <div className={styles.skeletonLine} style={{ width: '94%' }} />
                  <div className={styles.skeletonLine} style={{ width: '90%' }} />
                  <div className={styles.skeletonLine} style={{ width: '85%' }} />
                  <div className={styles.skeletonLine} style={{ width: '65%' }} />
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* yearly_advice — single holistic prose block (年度建議) */}
      {adviceText && (
        <div className={styles.adviceCard}>
          <h4 className={styles.adviceTitle}>年度建議</h4>
          <p className={styles.adviceBody}>
            <RichText text={adviceText} />
          </p>
        </div>
      )}

      <p className={styles.disclaimer}>
        ※ 今年運勢為「年度趨勢」框架，引擎依據命格 + 流年（+ 大運）訊號生成。
        具體月份細節請查《八字月運》。本服務僅供參考與娛樂用途。
      </p>
    </section>
  );
}
