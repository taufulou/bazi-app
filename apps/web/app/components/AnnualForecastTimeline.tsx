import React from "react";
import styles from "./AnnualForecastTimeline.module.css";

/** Parse AI narrative text into styled React elements with golden dot bullets */
function renderNarrativeContent(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={key++} className={styles.goldBulletList}>
        {bulletBuffer.map((item, i) => {
          const colonIdx = item.indexOf('：');
          if (colonIdx > 0 && colonIdx < item.length - 1) {
            const afterColon = item.slice(colonIdx + 1).trim();
            if (afterColon.includes('、')) {
              const category = item.slice(0, colonIdx);
              return (
                <li key={i} className={`${styles.goldBulletItem} ${styles.goldBulletItemCategory}`}>
                  <span className={styles.bulletCategory}>{category}</span>
                  <span className={styles.bulletCategoryItems}>{afterColon}</span>
                </li>
              );
            }
          }
          return <li key={i} className={styles.goldBulletItem}>{item}</li>;
        })}
      </ul>
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-–·‧・]\s*/.test(trimmed)) {
      bulletBuffer.push(trimmed.replace(/^[-–·‧・]\s*/, ''));
      continue;
    }
    flushBullets();
    if (trimmed === '') continue;
    if (/^(?:🔥|⚠️|⚠|💡|📍|◆|🔹|⭐|🌟|💎|🎯|💰|💼|💕|🏥|📊|🔮)/.test(trimmed)) {
      elements.push(<div key={key++} className={styles.contentSubHeader}>{trimmed}</div>);
      continue;
    }
    elements.push(<p key={key++} className={styles.contentParagraph}>{trimmed}</p>);
  }
  flushBullets();
  return <>{elements}</>;
}

interface AnnualForecast {
  year: number;
  stem: string;
  branch: string;
  tenGod: string;
  luckPeriodStem: string;
  luckPeriodBranch: string;
  luckPeriodTenGod: string;
  auspiciousness: string;
  branchInteractions: string[];
  kongWangAnalysis?: {
    hit: boolean;
    effect: string;
    favorable: boolean;
  };
  yimaAnalysis?: {
    hit: boolean;
    favorable: boolean;
    type: string;
  };
  careerIndicators: Array<{ type: string; label: string; description: string }> | string[];
}

interface ActiveLuckPeriod {
  stem: string;
  branch: string;
  tenGod: string;
  startYear: number;
  endYear: number;
}

interface AnnualForecastTimelineProps {
  forecasts: AnnualForecast[];
  activeLuckPeriod: ActiveLuckPeriod | null;
  /** AI narrative sections keyed by "annual_forecast_YYYY" */
  narratives?: Record<string, string>;
}

const AUSPICIOUSNESS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  "大吉": { label: "大吉", color: "#2E7D32", bg: "rgba(46,125,50,0.1)" },
  "吉": { label: "吉", color: "#388E3C", bg: "rgba(56,142,60,0.1)" },
  "吉中有凶": { label: "吉中有凶", color: "#F9A825", bg: "rgba(249,168,37,0.1)" },
  "平": { label: "平", color: "#546E7A", bg: "rgba(84,110,122,0.08)" },
  "凶中有吉": { label: "凶中有吉", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "凶中帶機": { label: "凶中帶機", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "小凶": { label: "小凶", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "凶": { label: "凶", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "大凶": { label: "大凶", color: "#E65100", bg: "rgba(230,81,0,0.1)" },
};

const AUSPICIOUSNESS_TO_STARS: Record<string, number> = {
  // Primary 5-level (produced by R6-2 流年-only for annual)
  '大吉': 5.0,
  '吉': 4.0,
  '平': 3.0,
  '凶': 2.0,
  '大凶': 1.0,
  // Legacy/monthly labels (kept for backward compatibility)
  '吉中有凶': 3.5,
  '小凶': 2.5,
  '凶中有吉': 2.5,
  '凶中帶機': 1.5,
  '曇花一現': 3.5,
  '凶上加凶': 0.5,
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

export default function AnnualForecastTimeline({
  forecasts,
  activeLuckPeriod,
  narratives,
}: AnnualForecastTimelineProps) {
  if (!forecasts || forecasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {/* Luck Period context bar */}
      {activeLuckPeriod && (
        <div className={styles.luckPeriodBar}>
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
          const narrative = narratives?.[`annual_forecast_${fc.year}`];

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
                  <span className={styles.tenGod}>【{fc.tenGod}】</span>
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

              {/* Indicator badges row */}
              <div className={styles.indicators}>
                {fc.kongWangAnalysis?.hit && (
                  <span
                    className={styles.indicator}
                    data-favorable={fc.kongWangAnalysis.favorable ? "true" : "false"}
                  >
                    空亡 {fc.kongWangAnalysis.favorable ? "化解" : "受困"}
                  </span>
                )}
                {fc.yimaAnalysis?.hit && (
                  <span
                    className={styles.indicator}
                    data-favorable={fc.yimaAnalysis.favorable ? "true" : "false"}
                  >
                    驛馬 {fc.yimaAnalysis.favorable ? "利動" : "不宜動"}
                  </span>
                )}
                {fc.careerIndicators.slice(0, 2).map((ci, i) => (
                  <span key={i} className={styles.indicatorNeutral}>
                    {typeof ci === 'string' ? ci : ci.label}
                  </span>
                ))}
              </div>

              {/* Always-visible content */}
              <div className={styles.expandedContent}>
                {/* Branch interactions */}
                {fc.branchInteractions.length > 0 && (
                  <div className={styles.interactionsRow}>
                    <span className={styles.interactionsLabel}>地支互動：</span>
                    {fc.branchInteractions.map((bi, i) => (
                      <span key={i} className={styles.interactionTag}>{bi}</span>
                    ))}
                  </div>
                )}

                {/* AI narrative */}
                {narrative && (
                  <div className={styles.narrative}>
                    {renderNarrativeContent(narrative)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
