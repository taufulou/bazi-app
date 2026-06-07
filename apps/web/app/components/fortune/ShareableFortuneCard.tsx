'use client';

/**
 * ShareableFortuneCard — fixed 1200×1600 portrait card rasterized by
 * html2canvas for the Phase 1.5 share feature.
 *
 * Lazy-mounted: parent only renders this component AFTER user signals
 * share intent (hover/touchstart/click on ShareFortuneButton). Mounted
 * off-screen at `position: absolute; left: -9999px`.
 *
 * QR is passed in as `qrDataUrl: string` prop (computed eagerly by parent
 * BEFORE mount). This eliminates the async-mount race that an internal
 * useEffect-driven QR generation would introduce.
 *
 * Layout intentionally medium-density:
 *   - brand wordmark
 *   - date (large) + day-pillar sub-line
 *   - EnergyScoreRing reused at 2.4× scale
 *   - HeadlinerAnchorLine reused (chip pills)
 *   - one canTry takeaway line (if present)
 *   - QR + brand domain footer
 *
 * NO profile name printed — privacy concern: shared on social, would
 * leak FAMILY/FRIEND profile names. The user's own name on their own
 * card is also intentionally omitted for the same reason.
 */
import * as React from 'react';
import HeadlinerAnchorLine from './HeadlinerAnchorLine';
import { formatFortuneDate, friendlyExplanationFromLabel, ringTierFromLabel } from './labels';
import type { DailyFortuneResponse } from '../../lib/fortune-api';
import styles from './ShareableFortuneCard.module.css';

interface ShareableFortuneCardProps {
  data: DailyFortuneResponse;
  qrDataUrl: string;
}

const RING_RADIUS = 156;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 360;
const RING_CENTER = RING_SIZE / 2;

const ShareableFortuneCard = React.forwardRef<HTMLDivElement, ShareableFortuneCardProps>(
  function ShareableFortuneCard({ data, qrDataUrl }, ref) {
    const { engineOutput, narrative, date } = data;
    const { auspiciousness, energyScore, dayGanZhi, dayTenGod, headlinerSignals, folkContent } = engineOutput;
    const clamped = Math.max(0, Math.min(100, energyScore));
    const offset = RING_CIRC * (1 - clamped / 100);
    const tier = ringTierFromLabel(auspiciousness);
    const { dateLine } = formatFortuneDate(date);
    const friendly = friendlyExplanationFromLabel(auspiciousness);

    const takeaway = narrative?.daily_advice?.canTry?.[0] ?? '';

    // Phase 1.5.z folk content — render 4 condensed slots on the share card.
    // Excludes 「今日忌食」 deliberately: avoid framing + 五行 reason
    // citation + medical disclaimer don't fit a positive share vibe.
    // Each slot defensively short-circuits if engine omitted the field
    // (rare — only when 用神 unresolved).
    const luckyColorDisplay = folkContent?.luckyColor
      ? [folkContent.luckyColor.primary, folkContent.luckyColor.secondary]
          .filter(Boolean)
          .join('／')
      : null;
    const luckyNumberDisplay = folkContent?.luckyNumber?.numbers?.length
      ? folkContent.luckyNumber.numbers.join('、')
      : null;
    const luckyFoodDisplay = folkContent?.luckyFoodFavor?.category ?? null;
    // For hours: render branches only (most compact). 6 branches fit on
    // one line of the share card's 2x2 grid cell at the chosen font size.
    const auspiciousHoursDisplay = folkContent?.auspiciousHours?.length
      ? folkContent.auspiciousHours.map((h) => h.branch).join('、')
      : null;
    const hasAnyFolkContent =
      luckyColorDisplay || luckyNumberDisplay || luckyFoodDisplay || auspiciousHoursDisplay;

    return (
      <div ref={ref} className={styles.card} aria-hidden="true">
        {/* Brand wordmark — top-left */}
        <div className={styles.brandHeader}>
          <span className={styles.brandWordmark}>BaziApp</span>
          <span className={styles.brandTagline}>命理日運</span>
        </div>

        {/* Date band */}
        <div className={styles.dateBand}>
          <div className={styles.dateLine}>{dateLine}</div>
          <div className={styles.baziLine}>
            {dayGanZhi}日 · {dayTenGod}
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

        <p className={styles.friendlyExplanation}>{friendly}</p>

        {/* Headliner anchor line */}
        {headlinerSignals && (
          <div className={styles.headliner}>
            <HeadlinerAnchorLine
              chartContext={headlinerSignals.chartContext}
              triggers={headlinerSignals.triggers}
            />
          </div>
        )}

        {/* Single takeaway line */}
        {takeaway && (
          <div className={styles.takeawayBox}>
            <span className={styles.takeawayQuoteMark}>「</span>
            <span className={styles.takeawayText}>{takeaway}</span>
            <span className={styles.takeawayQuoteMark}>」</span>
          </div>
        )}

        {/*
          Phase 1.5.z folk content — 2×2 grid: 吉色 | 吉數 [民俗]
          / 今日宜食 | 吉時. 「民俗」 badge on 吉數 only (河圖洛書 source).
          Whole block hidden when engine omits all 4 (rare: unresolved 用神).
        */}
        {hasAnyFolkContent && (
          <div className={styles.folkGrid}>
            {luckyColorDisplay && (
              <div className={styles.folkSlot}>
                <div className={styles.folkLabel}>🌈 吉色</div>
                <div className={styles.folkValue}>{luckyColorDisplay}</div>
              </div>
            )}
            {luckyNumberDisplay && (
              <div className={styles.folkSlot}>
                <div className={styles.folkLabel}>
                  🔢 吉數
                  <span className={styles.folkBadge} aria-label="民俗來源">民俗</span>
                </div>
                <div className={styles.folkValue}>{luckyNumberDisplay}</div>
              </div>
            )}
            {luckyFoodDisplay && (
              <div className={styles.folkSlot}>
                <div className={styles.folkLabel}>🍃 今日宜食</div>
                <div className={styles.folkValue}>{luckyFoodDisplay}</div>
              </div>
            )}
            {auspiciousHoursDisplay && (
              <div className={styles.folkSlot}>
                <div className={styles.folkLabel}>🕘 吉時</div>
                <div className={styles.folkValue}>{auspiciousHoursDisplay}</div>
              </div>
            )}
          </div>
        )}

        {/* Footer with QR + brand domain */}
        <div className={styles.footer}>
          <div className={styles.footerDivider} />
          <div className={styles.footerInner}>
            {qrDataUrl && (
              // next/image is wrong tool here — the card is captured by
              // html2canvas at fixed pixel dimensions OFF-screen, so lazy-load
              // + responsive sizing would just complicate the capture pipeline.
              // Plain <img> is exactly what we need.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR code" className={styles.qr} width={160} height={160} />
            )}
            <div className={styles.footerText}>
              <div className={styles.footerDomain}>baziapp.com</div>
              <div className={styles.footerTagline}>掃描查看您自己的命理日運</div>
              <div className={styles.footerDisclaimer}>※ 流日為觸發點，僅供參考，不構成任何專業建議</div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export default ShareableFortuneCard;
