'use client';

/**
 * ShareableMonthlyFortuneCard — fixed 1200×1600 portrait card rasterized by
 * html2canvas for the Tier B1 月運 share feature.
 *
 * Mirror of `ShareableYearlyFortuneCard`, adapted for MONTH scope:
 *   - brand wordmark (命理月運)
 *   - month band (2026年5月 · 癸巳月 · 正官) — derived by splitting
 *     `data.month` ('YYYY-MM'); MonthlyFortuneResponse has NO top-level
 *     `year` field (unlike YearlyFortuneResponse), so do NOT destructure one.
 *   - EnergyScoreRing inlined @360px (overall 能量 + 7-label)
 *   - headline (first sentence of monthly_overview, else friendly explanation)
 *   - 4-dim BARS (事業/財運/感情/健康) — matches the month page's
 *     MonthlyDimensionBars (the year card uses ★ stars; month uses bars)
 *   - 上半月/下半月 summary from intraMonthBreakdown.buckets (null-guarded:
 *     the whole box is omitted when the breakdown is absent)
 *   - QR + brand domain footer
 *
 * NO folk grid (folk content is DAY-only). NO profile name (privacy — shared
 * on social). Mirrors the daily/year cards' omissions.
 *
 * Lazy-mounted off-screen by the parent only after share intent; QR passed
 * eagerly via `qrDataUrl` prop (same contract as the daily + year cards).
 * Share is gated on `state.status === 'success'` upstream, so `narrative` is
 * present (or null if AI failed — every field below short-circuits on null).
 */
import * as React from 'react';
import type { MonthlyFortuneResponse } from '../../lib/fortune-api';
import { friendlyExplanationFromLabel, ringTierFromLabel, dimTierFromScore } from './labels';
import { MONTHLY_DIM_META } from './monthlyDimensions';
import styles from './ShareableMonthlyFortuneCard.module.css';

interface ShareableMonthlyFortuneCardProps {
  data: MonthlyFortuneResponse;
  qrDataUrl: string;
}

const RING_RADIUS = 156;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 360;
const RING_CENTER = RING_SIZE / 2;

/** YYYY-MM → 「2026年5月」. Mirrors MonthlyEnergyRing's `formatMonthIso`. */
function formatMonthIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[1]!)}年${Number(m[2]!)}月`;
}

/** 7-label friendly explanation, month-scoped (今日 → 本月). Mirrors
 *  MonthlyEnergyRing's local helper (kept local per the year card's
 *  inline-helper precedent). */
function monthlyFriendlyExplanation(label: string): string {
  return friendlyExplanationFromLabel(label).replace(/今日/g, '本月').replace(/今天/g, '本月');
}

/** First sentence (up to 。！？) of the AI overview; else the whole string. */
function firstSentence(text?: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  const m = trimmed.match(/^[^。！？\n]*[。！？]/);
  return (m ? m[0] : trimmed).trim();
}

const GOVERNING_PILLAR_LABEL: Record<'stem' | 'branch', string> = {
  stem: '天干主氣',
  branch: '地支主氣',
};

const ShareableMonthlyFortuneCard = React.forwardRef<HTMLDivElement, ShareableMonthlyFortuneCardProps>(
  function ShareableMonthlyFortuneCard({ data, qrDataUrl }, ref) {
    const { engineOutput, narrative, month, intraMonthBreakdown } = data;
    const { auspiciousness, energyScore, monthGanZhi, monthTenGod, dimensions } = engineOutput;

    const clamped = Math.max(0, Math.min(100, energyScore));
    const offset = RING_CIRC * (1 - clamped / 100);
    const tier = ringTierFromLabel(auspiciousness);

    const headline =
      firstSentence(narrative?.monthly_overview) || monthlyFriendlyExplanation(auspiciousness);

    // 上半月/下半月 buckets — teaser. Null-guard: omit the whole box when the
    // engine didn't emit intraMonthBreakdown (it's an optional sibling field).
    const buckets = intraMonthBreakdown?.buckets ?? [];

    return (
      <div ref={ref} className={styles.card} aria-hidden="true">
        {/* Brand wordmark — top-left */}
        <div className={styles.brandHeader}>
          <span className={styles.brandWordmark}>BaziApp</span>
          <span className={styles.brandTagline}>命理月運</span>
        </div>

        {/* Month band */}
        <div className={styles.dateBand}>
          <div className={styles.dateLine}>{formatMonthIso(month)}</div>
          <div className={styles.baziLine}>
            {monthGanZhi}月 · {monthTenGod}
          </div>
        </div>

        {/* Ring */}
        <div className={styles.ringWrap} data-tier={tier}>
          <svg
            className={styles.ring}
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            aria-hidden="true"
          >
            <circle
              className={styles.ringTrack}
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={22}
            />
            <circle
              className={styles.ringProgress}
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={22}
              strokeDasharray={RING_CIRC}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
              strokeLinecap="round"
            />
          </svg>
          <div className={styles.scoreText}>
            <span className={styles.scoreNumber}>{clamped}</span>
            <span className={styles.scoreUnit}>能量</span>
          </div>
        </div>

        {/* Label band */}
        <div className={styles.labelBand} data-tier={tier}>
          <span className={styles.labelText}>{auspiciousness}</span>
        </div>

        {/* Headline */}
        <p className={styles.headline}>{headline}</p>

        {/* 4-dim bars — month signature (mirrors MonthlyDimensionBars) */}
        <div className={styles.dimRow}>
          {MONTHLY_DIM_META.map((m) => {
            const dim = dimensions?.[m.key];
            const score = Math.max(0, Math.min(100, dim?.score ?? 50));
            const t = dimTierFromScore(score);
            const { Icon } = m;
            return (
              <div key={m.key} className={styles.dimCard} data-tier={t}>
                <span className={styles.dimIcon} aria-hidden="true">
                  <Icon size={26} strokeWidth={1.8} />
                </span>
                <div className={styles.barTrack} aria-hidden="true">
                  <div className={styles.barFill} style={{ height: `${score}%` }} />
                </div>
                <span className={styles.dimScore}>{score}</span>
                <span className={styles.dimName}>{m.zh}</span>
                {dim?.label && (
                  <span className={styles.dimLabel} data-tier={t}>
                    {dim.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* 上半月/下半月 summary — omitted entirely when no breakdown */}
        {buckets.length > 0 && (
          <div className={styles.summaryBox}>
            {buckets.map((b, i) => (
              <div key={i} className={styles.summaryRow}>
                <span className={styles.summaryTag}>{b.label}</span>
                <span className={styles.summaryMeta}>
                  {GOVERNING_PILLAR_LABEL[b.governing_pillar]} · {b.auspicious_days} 吉日 ·{' '}
                  {b.challenging_days} 留意
                  {b.dominant_shensha?.length
                    ? ` · ${b.dominant_shensha.slice(0, 2).join('、')}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer with QR + brand domain */}
        <div className={styles.footer}>
          <div className={styles.footerDivider} />
          <div className={styles.footerInner}>
            {qrDataUrl && (
              // Plain <img>: captured by html2canvas at fixed pixel dimensions
              // off-screen, so next/image would only complicate the capture.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR code" className={styles.qr} width={160} height={160} />
            )}
            <div className={styles.footerText}>
              <div className={styles.footerDomain}>baziapp.com</div>
              <div className={styles.footerTagline}>掃描查看您自己的命理月運</div>
              <div className={styles.footerDisclaimer}>※ 流月為趨勢，僅供參考</div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export default ShareableMonthlyFortuneCard;
