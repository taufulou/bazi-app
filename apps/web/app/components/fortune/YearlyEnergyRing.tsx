'use client';

/**
 * YearlyEnergyRing — Phase 3 年運 yearly 能量指數 circular SVG ring.
 *
 * Mirror of MonthlyEnergyRing scaled for YEAR scope.
 *
 * Differences from MONTH:
 *   - Date band shows 「2026年」 (no month) + 「丙午年 · 偏官」 sub-line
 *   - Label band copy emphasizes 今年 instead of 本月
 *   - micro-disclaimer: 「※ 今年能量為輔助顯示 · 以「{label}」為主」
 *   - Reuses the same SVG ring sizing + tier color from labels.ts (same
 *     EnergyScoreRing.module.css)
 *
 * Per CLAUDE.md Phase 3 doctrine: the 7-label is the engine source of truth;
 * the 0-100 「能量指數」 is a DERIVED display value (mid-band of each label),
 * labeled as advisory. 流年 = annual trend; the year-pillar provides the
 * sustained backdrop.
 */
import {
  friendlyExplanationFromLabel,
  ringTierFromLabel,
} from './labels';
import InfoTooltip from './InfoTooltip';
import styles from './EnergyScoreRing.module.css';

interface Props {
  /** Final auspiciousness 7-label (engine source of truth) */
  label: string;
  /** Derived 0-100 score for ring display */
  score: number;
  /** Year integer (e.g., 2026) */
  year: number;
  /** Year-pillar 干支 (e.g., '丙午') for the small line under date */
  yearGanZhi: string;
  /** Year ten-god (e.g., '偏官') for the small line under date */
  yearTenGod: string;
}

const RING_RADIUS = 65;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 150;
const RING_CENTER = RING_SIZE / 2;

/** Map 7-label to a yearly-scope friendly explanation (parallel to monthly's
 *  helper but with YEAR-scope phrasing). We reuse the daily helper but swap
 *  «今日» → «今年» where present. */
function yearlyFriendlyExplanation(label: string): string {
  const daily = friendlyExplanationFromLabel(label);
  return daily.replace(/今日/g, '今年').replace(/今天/g, '今年');
}

export default function YearlyEnergyRing({
  label,
  score,
  year,
  yearGanZhi,
  yearTenGod,
}: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = RING_CIRC * (1 - clamped / 100);
  const tier = ringTierFromLabel(label);
  const friendlyExplanation = yearlyFriendlyExplanation(label);

  return (
    <div className={styles.wrap}>
      {/* Date band — large prominent year + small Bazi-pillar sub-line */}
      <div className={styles.dateBand}>
        <div className={styles.dateLine}>{year}年</div>
        <div className={styles.baziLine}>
          {yearGanZhi}年 · {yearTenGod}
        </div>
      </div>

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
            strokeWidth={9}
          />
          <circle
            className={styles.ringProgress}
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={9}
            strokeDasharray={RING_CIRC}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
            strokeLinecap="round"
          />
        </svg>
        <div
          className={styles.scoreText}
          aria-label={`今年能量指數 ${clamped} 分`}
        >
          <span className={styles.scoreNumber}>{clamped}</span>
          <span className={styles.scoreUnit}>能量</span>
        </div>
      </div>

      <div className={styles.labelBand} data-tier={tier}>
        <span className={styles.labelText}>{label}</span>
      </div>

      {/* Friendly explanation (warm advisor tone — always visible) */}
      <p className={styles.friendlyExplanation}>{friendlyExplanation}</p>

      {/* micro-disclaimer — <div> (NOT <p>): InfoTooltip's <details> cannot be a <p> descendant (hydration error). */}
      <div className={styles.microDisclaimer}>
        <span>※ 今年能量為輔助顯示 · 以「{label}」為主</span>
        <InfoTooltip ariaLabel="今年能量指數說明">
          此判定來自命理引擎 (Phase 12 doctrine + Phase 3 年運)。能量指數
          (0-100) 為衍生顯示值，僅供 UI 渲染參考；吉凶判定請以「{label}」為主。
          流年主一年之大勢，較流月為穩。
        </InfoTooltip>
      </div>
    </div>
  );
}
