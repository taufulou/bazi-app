'use client';

/**
 * MonthlyEnergyRing — Phase 2 月運 monthly 能量指數 circular SVG ring.
 *
 * Mirror of EnergyScoreRing scaled for MONTH scope.
 *
 * Differences from DAY:
 *   - Date band shows 「2026年5月」 (no day) + 「癸巳月 · 正官」 sub-line
 *   - Label band copy emphasizes 本月 instead of 今日
 *   - micro-disclaimer: 「※ 本月能量為輔助顯示 · 以「{label}」為主」
 *   - Reuses the same SVG ring sizing + tier color from labels.ts
 *
 * Per CLAUDE.md Phase 2 doctrine: «流月 = SUSTAINED TREND, not verdict»
 * (per 三命通會 月運篇). The 7-label is the engine source of truth; 0-100
 * energy score is derived display only.
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
  /** YYYY-MM (e.g., '2026-05') */
  month: string;
  /** Month-pillar 干支 (e.g., '癸巳') for the small line under date */
  monthGanZhi: string;
  /** Month ten-god (e.g., '正官') for the small line under date */
  monthTenGod: string;
}

const RING_RADIUS = 65;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 150;
const RING_CENTER = RING_SIZE / 2;

/** Format YYYY-MM → 「2026年5月」 in zh-TW. */
function formatMonthIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return iso;
  const year = Number(m[1]!);
  const month = Number(m[2]!);
  return `${year}年${month}月`;
}

/** Map 7-label to a monthly-scope friendly explanation (parallel to
 *  daily's `friendlyExplanationFromLabel` but with MONTH-scope phrasing).
 *  We reuse the daily helper but swap «今日» → «本月» where present. */
function monthlyFriendlyExplanation(label: string): string {
  const daily = friendlyExplanationFromLabel(label);
  return daily.replace(/今日/g, '本月').replace(/今天/g, '本月');
}

export default function MonthlyEnergyRing({
  label,
  score,
  month,
  monthGanZhi,
  monthTenGod,
}: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = RING_CIRC * (1 - clamped / 100);
  const tier = ringTierFromLabel(label);
  const friendlyExplanation = monthlyFriendlyExplanation(label);
  const monthLine = formatMonthIso(month);

  return (
    <div className={styles.wrap}>
      {/* Date band — large prominent month + small Bazi-pillar sub-line */}
      <div className={styles.dateBand}>
        <div className={styles.dateLine}>{monthLine}</div>
        <div className={styles.baziLine}>
          {monthGanZhi}月 · {monthTenGod}
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
          aria-label={`本月能量指數 ${clamped} 分`}
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
        <span>※ 本月能量為輔助顯示 · 以「{label}」為主</span>
        <InfoTooltip ariaLabel="本月能量指數說明">
          此判定來自命理引擎 (Phase 12 doctrine + Phase 2 月運)。能量指數
          (0-100) 為衍生顯示值，僅供 UI 渲染參考；吉凶判定請以「{label}」為主。
          流月主一月之氣象 (per 三命通會 月運篇)，較流日為穩，較流年為動。
        </InfoTooltip>
      </div>
    </div>
  );
}
