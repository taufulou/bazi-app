'use client';

/**
 * EnergyScoreRing — daily 能量指數 circular SVG ring + verdict label band.
 *
 * Per UX Refinement Sprint (locked decisions 2026-05-15):
 *   - 7-label is the engine's source of truth; 0-100 score is DERIVED display.
 *   - Date band ABOVE ring (R1.2 + S1.1): «2026年5月17日 週六» (large) +
 *     «辛卯日 · 傷官» (small Bazi-day line).
 *   - Ring tier color is 2-tier (R1.3): green for 大吉/吉, gold for default.
 *   - Ring sized 150×150 (R1.4 / S1.4) to bring dim bars into first-fold.
 *   - Always-visible micro-disclaimer below label (R1.1): «※ 能量為輔助顯示
 *     · 以「{label}」為主» — preserves Option 2.5 doctrine compliance.
 *   - InfoTooltip expands disclaimer with longer context.
 *   - Friendly explanation sentence beneath label band (warm advisor tone).
 */
import {
  formatFortuneDate,
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
  /** ISO date string YYYY-MM-DD (from DailyFortuneResponse.date) */
  date: string;
  /** Day-pillar 干支 (e.g. '辛卯') for the small line under date */
  dayGanZhi: string;
  /** Day ten-god (e.g. '傷官') for the small line under date */
  dayTenGod: string;
}

const RING_RADIUS = 65;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 150;
const RING_CENTER = RING_SIZE / 2;

export default function EnergyScoreRing({
  label,
  score,
  date,
  dayGanZhi,
  dayTenGod,
}: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = RING_CIRC * (1 - clamped / 100);
  const tier = ringTierFromLabel(label);
  const friendlyExplanation = friendlyExplanationFromLabel(label);
  const { dateLine } = formatFortuneDate(date);

  return (
    <div className={styles.wrap}>
      {/* Date band — large prominent date + small Bazi-day sub-line */}
      <div className={styles.dateBand}>
        <div className={styles.dateLine}>{dateLine}</div>
        <div className={styles.baziLine}>
          {dayGanZhi}日 · {dayTenGod}
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
        <div className={styles.scoreText} aria-label={`今日能量指數 ${clamped} 分`}>
          <span className={styles.scoreNumber}>{clamped}</span>
          <span className={styles.scoreUnit}>能量</span>
        </div>
      </div>

      <div className={styles.labelBand} data-tier={tier}>
        <span className={styles.labelText}>{label}</span>
      </div>

      {/* Friendly explanation (warm advisor tone — always visible) */}
      <p className={styles.friendlyExplanation}>{friendlyExplanation}</p>

      {/* Always-visible micro-disclaimer with InfoTooltip for deeper context */}
      <p className={styles.microDisclaimer}>
        <span>※ 能量為輔助顯示 · 以「{label}」為主</span>
        <InfoTooltip ariaLabel="能量指數說明">
          此判定來自命理引擎（Phase 12 doctrine）。能量指數（0-100）為衍生顯示值，
          僅供 UI 渲染參考；吉凶判定請以「{label}」為主。
        </InfoTooltip>
      </p>
    </div>
  );
}
