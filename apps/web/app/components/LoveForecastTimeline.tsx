import React from "react";
import styles from "./LoveForecastTimeline.module.css";
import { AUSPICIOUSNESS_TO_STARS } from "../lib/bazi-utils";
import { renderNarrativeContent } from "./narrative-utils";

interface LoveAnnualForecast {
  year: number;
  stem: string;
  branch: string;
  stemTenGod: string;
  stemRole: string;
  auspiciousness: string;
  interactions: string[];
  hasRomanceStar: boolean;
  isVoid: boolean;
  lpContext: string;
  isGoodYear: boolean;
  goodYearType: string;
  isDangerYear: boolean;
  dangerYearTrigger: string;
  isChangeYear: boolean;
  changeYearType: string;
}

interface ActiveLuckPeriod {
  stem: string;
  branch: string;
  tenGod: string;
  startYear: number;
  endYear: number;
}

interface LoveForecastTimelineProps {
  forecasts: LoveAnnualForecast[];
  activeLuckPeriod: ActiveLuckPeriod | null;
  /** AI narrative sections keyed by "annual_love_YYYY" */
  narratives?: Record<string, string>;
  /** When true, show shimmer skeleton in cards without narratives */
  isStreaming?: boolean;
}

/** Love 7-level auspiciousness system: 大吉 > 吉 > 小吉 > 平 > 小凶 > 凶 > 大凶 (+ monthly extras) */
const AUSPICIOUSNESS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  "大吉": { label: "大吉", color: "#2E7D32", bg: "rgba(46,125,50,0.1)" },
  "吉": { label: "吉", color: "#388E3C", bg: "rgba(56,142,60,0.1)" },
  "小吉": { label: "小吉", color: "#66BB6A", bg: "rgba(102,187,106,0.1)" },
  "平": { label: "平", color: "#546E7A", bg: "rgba(84,110,122,0.08)" },
  "小凶": { label: "小凶", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "凶": { label: "凶", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "大凶": { label: "大凶", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "曇花一現": { label: "曇花一現", color: "#F9A825", bg: "rgba(249,168,37,0.1)" },
  "凶上加凶": { label: "凶上加凶", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
};

function StarRatingInline({ score }: { score: number }) {
  const stars = [];
  const clamped = Math.max(0, Math.min(5, score));
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(clamped)) {
      stars.push(<span key={i} className={styles.starFull}>★</span>);
    } else if (i === Math.ceil(clamped) && clamped % 1 !== 0) {
      stars.push(
        <span key={i} className={styles.starHalf}>
          <span className={styles.starHalfEmpty}>★</span>
          <span className={styles.starHalfFilled}>★</span>
        </span>
      );
    } else {
      stars.push(<span key={i} className={styles.starEmpty}>★</span>);
    }
  }
  return <span className={styles.starsInline}>{stars}</span>;
}

/** Build love indicator pills with priority: goodYear > dangerYear > changeYear > romanceStar > void. Max 3. */
function buildLoveIndicators(fc: LoveAnnualForecast): Array<{ label: string; type: string }> {
  const pills: Array<{ label: string; type: string }> = [];

  if (fc.isGoodYear && fc.goodYearType) {
    pills.push({ label: `🌸 ${fc.goodYearType}`, type: "good" });
  }
  if (fc.isDangerYear && fc.dangerYearTrigger) {
    pills.push({ label: `⚠️ 桃花劫·${fc.dangerYearTrigger}`, type: "danger" });
  }
  if (fc.isChangeYear && fc.changeYearType) {
    pills.push({ label: `🔄 ${fc.changeYearType}`, type: "change" });
  }
  // Only show romanceStar if not already showing goodYear pill
  if (fc.hasRomanceStar && !fc.isGoodYear) {
    pills.push({ label: "🌸 桃花星動", type: "good" });
  }
  if (fc.isVoid) {
    pills.push({ label: "空亡", type: "void" });
  }

  return pills.slice(0, 3);
}

export default function LoveForecastTimeline({
  forecasts,
  activeLuckPeriod,
  narratives,
  isStreaming = false,
}: LoveForecastTimelineProps) {
  if (!forecasts || forecasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {/* Luck Period context bar */}
      {activeLuckPeriod && (
        <div className={styles.luckPeriodBar}>
          <span className={styles.lpIcon}>💕</span>
          <span className={styles.lpLabel}>當前大運</span>
          <span className={styles.lpPillar}>
            {activeLuckPeriod.stem}{activeLuckPeriod.branch}
          </span>
          <span className={styles.lpTenGod}>
            【{activeLuckPeriod.tenGod}】
          </span>
          <span className={styles.lpYears}>
            {activeLuckPeriod.startYear}–{activeLuckPeriod.endYear}
          </span>
        </div>
      )}

      <div className={styles.timeline}>
        {forecasts.map((fc) => {
          const config = AUSPICIOUSNESS_CONFIG[fc.auspiciousness] ??
            AUSPICIOUSNESS_CONFIG["平"]!;
          const narrative = narratives?.[`annual_love_${fc.year}`];
          const indicators = buildLoveIndicators(fc);

          return (
            <div
              key={fc.year}
              className={styles.card}
            >
              <div className={styles.cardHeader}>
                <div className={styles.yearInfo}>
                  <span className={styles.year}>{fc.year}</span>
                  <span className={styles.ganZhi}>
                    {fc.stem}{fc.branch}年
                  </span>
                  <span className={styles.tenGod}>【{fc.stemTenGod}】</span>
                </div>
                <div className={styles.badgeRow}>
                  <span
                    className={styles.badge}
                    style={{
                      color: config.color,
                      backgroundColor: config.bg,
                    }}
                  >
                    {config.label}
                  </span>
                  <StarRatingInline score={AUSPICIOUSNESS_TO_STARS[fc.auspiciousness] ?? 3.0} />
                </div>
              </div>

              {/* Love indicator pills */}
              {indicators.length > 0 && (
                <div className={styles.indicators}>
                  {indicators.map((ind, i) => (
                    <span
                      key={i}
                      className={styles.indicator}
                      data-type={ind.type}
                    >
                      {ind.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Expanded content: interactions + narrative/skeleton */}
              {(narrative || fc.interactions.length > 0 || isStreaming) && (
                <div className={styles.expandedContent}>
                  {/* Branch interactions */}
                  {fc.interactions.length > 0 && (
                    <div className={styles.interactionsRow}>
                      <span className={styles.interactionsLabel}>配偶宮互動：</span>
                      {fc.interactions.map((bi, i) => (
                        <span key={i} className={styles.interactionTag}>{bi}</span>
                      ))}
                    </div>
                  )}

                  {/* AI narrative or streaming skeleton */}
                  {narrative ? (
                    <div className={styles.narrative}>
                      {renderNarrativeContent(narrative)}
                    </div>
                  ) : isStreaming ? (
                    <div className={styles.skeletonContent}>
                      <div className={styles.skeletonLine} style={{ width: '90%' }} />
                      <div className={styles.skeletonLine} style={{ width: '75%' }} />
                      <div className={styles.skeletonLine} style={{ width: '60%' }} />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
