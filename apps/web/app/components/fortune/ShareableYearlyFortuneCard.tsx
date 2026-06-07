'use client';

/**
 * ShareableYearlyFortuneCard — fixed 1200×1600 portrait card rasterized by
 * html2canvas for the Phase 3 年運 share feature.
 *
 * Year-specific layout (NOT a config of the daily ShareableFortuneCard — the
 * daily card hard-wires a 2×2 folk-content grid that YEAR has no data for,
 * and lacks what YEAR HAS: 4-dim ★ ratings + named 核心機會/風險 months):
 *   - brand wordmark (命理年運)
 *   - year (large) + year-pillar sub-line (丙午年 · 偏印)
 *   - EnergyScoreRing reused at 2.4× scale (overall 能量 + 7-label)
 *   - headline keyword (narrative.yearly_headline) — the year's theme
 *   - 4-dim ★ star row (事業/財運/感情/健康) — the screenshot-worthy signature
 *   - 核心機會 / 留意 named months — the "my best months are X" teaser
 *   - QR + brand domain footer
 *
 * Lazy-mounted: parent only renders this AFTER share intent (hover/touch/
 * click on the share button), mounted off-screen. QR passed eagerly as a
 * prop (`qrDataUrl`) to avoid an async-mount race — same contract as the
 * daily card.
 *
 * Share is gated on `state.status === 'success'` upstream, so `narrative` is
 * present when this mounts (or null if AI failed — every field below
 * defensively short-circuits on null).
 *
 * NO profile name printed — privacy: shared on social, would leak FAMILY/
 * FRIEND profile names. Mirrors the daily card's omission.
 */
import * as React from 'react';
import type { YearlyFortuneResponse } from '../../lib/fortune-api';
import { friendlyExplanationFromLabel, ringTierFromLabel, dimTierFromScore } from './labels';
import { YEARLY_DIM_META } from './yearlyDimensions';
import styles from './ShareableYearlyFortuneCard.module.css';

interface ShareableYearlyFortuneCardProps {
  data: YearlyFortuneResponse;
  qrDataUrl: string;
}

const RING_RADIUS = 156;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 360;
const RING_CENTER = RING_SIZE / 2;
const MAX_STARS = 5;

/** 7-label friendly explanation, year-scoped (今日 → 今年). Mirrors
 *  YearlyEnergyRing's helper. */
function yearlyFriendlyExplanation(label: string): string {
  return friendlyExplanationFromLabel(label).replace(/今日/g, '今年').replace(/今天/g, '今年');
}

const ShareableYearlyFortuneCard = React.forwardRef<HTMLDivElement, ShareableYearlyFortuneCardProps>(
  function ShareableYearlyFortuneCard({ data, qrDataUrl }, ref) {
    const { engineOutput, narrative, year } = data;
    const { auspiciousness, energyScore, yearGanZhi, yearTenGod, dimensions, coreRiskOpportunity } =
      engineOutput;

    const clamped = Math.max(0, Math.min(100, energyScore));
    const offset = RING_CIRC * (1 - clamped / 100);
    const tier = ringTierFromLabel(auspiciousness);

    // Headline keyword (year theme) if the AI produced one; else fall back to
    // the always-available friendly explanation so the slot is never empty.
    const headline = narrative?.yearly_headline?.trim() || yearlyFriendlyExplanation(auspiciousness);

    // Named 機會 / 留意 months — the teaser. monthLabel is «N月».
    const oppMonths = (coreRiskOpportunity?.opportunities ?? [])
      .map((e) => e.monthLabel)
      .filter(Boolean);
    const riskMonths = (coreRiskOpportunity?.risks ?? []).map((e) => e.monthLabel).filter(Boolean);
    const flatYear = coreRiskOpportunity?.flatYear || (oppMonths.length === 0 && riskMonths.length === 0);

    return (
      <div ref={ref} className={styles.card} aria-hidden="true">
        {/* Brand wordmark — top-left */}
        <div className={styles.brandHeader}>
          <span className={styles.brandWordmark}>BaziApp</span>
          <span className={styles.brandTagline}>命理年運</span>
        </div>

        {/* Year band */}
        <div className={styles.dateBand}>
          <div className={styles.dateLine}>{year}年</div>
          <div className={styles.baziLine}>
            {yearGanZhi}年 · {yearTenGod}
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

        {/* Headline — year theme keyword */}
        <p className={styles.headline}>{headline}</p>

        {/* 4-dim ★ star row — the year signature */}
        <div className={styles.dimRow}>
          {YEARLY_DIM_META.map((m) => {
            const dim = dimensions?.[m.key];
            const filled = Math.max(0, Math.min(MAX_STARS, Math.round(dim?.stars ?? 3)));
            const t = dimTierFromScore(dim?.score ?? 50);
            const { Icon } = m;
            return (
              <div key={m.key} className={styles.dimCard} data-tier={t}>
                <div className={styles.dimHeader}>
                  <span className={styles.dimIcon} aria-hidden="true">
                    <Icon size={26} strokeWidth={1.8} />
                  </span>
                  <span className={styles.dimName}>{m.zh}</span>
                </div>
                <div className={styles.stars}>
                  {Array.from({ length: MAX_STARS }, (_, i) => (
                    <span key={i} className={styles.star} data-filled={i < filled}>
                      {i < filled ? '★' : '☆'}
                    </span>
                  ))}
                </div>
                {dim?.label && (
                  <span className={styles.dimLabel} data-tier={t}>
                    {dim.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* 核心機會 / 留意 months — teaser. flatYear → single calm line. */}
        <div className={styles.monthsBox}>
          {flatYear ? (
            <div className={styles.flatYearLine}>今年運勢平穩，起伏不大</div>
          ) : (
            <>
              {oppMonths.length > 0 && (
                <div className={styles.monthRow}>
                  <span className={`${styles.monthTag} ${styles.monthTagOpp}`}>核心機會</span>
                  <span className={styles.monthList}>{oppMonths.join(' · ')}</span>
                </div>
              )}
              {riskMonths.length > 0 && (
                <div className={styles.monthRow}>
                  <span className={`${styles.monthTag} ${styles.monthTagRisk}`}>留意月份</span>
                  <span className={styles.monthList}>{riskMonths.join(' · ')}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer with QR + brand domain */}
        <div className={styles.footer}>
          <div className={styles.footerDivider} />
          <div className={styles.footerInner}>
            {qrDataUrl && (
              // Plain <img>: card is captured by html2canvas at fixed pixel
              // dimensions off-screen, so next/image lazy-load/responsive
              // sizing would only complicate the capture. (Same as daily card.)
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR code" className={styles.qr} width={160} height={160} />
            )}
            <div className={styles.footerText}>
              <div className={styles.footerDomain}>baziapp.com</div>
              <div className={styles.footerTagline}>掃描查看您自己的命理年運</div>
              <div className={styles.footerDisclaimer}>※ 流年為趨勢，僅供參考，不構成任何專業建議</div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export default ShareableYearlyFortuneCard;
