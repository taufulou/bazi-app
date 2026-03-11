import React from "react";
import styles from "./MonthlyFortuneGrid.module.css";

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

interface MonthlyForecast {
  month: number;
  stem: string;
  branch: string;
  tenGod: string;
  auspiciousness: string;
  monthName: string;
  solarTermDate: string;
  solarTermEndDate?: string;
  seasonElement: string;
  annualContext?: string;
  branchInteractions?: Array<{
    type: string;
    description: string;
    effect: string;
  }>;
}

interface MonthlyFortuneGridProps {
  forecasts: MonthlyForecast[];
  /** AI narrative sections keyed by "monthly_forecast_01" etc. */
  narratives?: Record<string, string>;
}

const AUSPICIOUSNESS_COLORS: Record<string, { color: string; bg: string }> = {
  "大吉": { color: "#2E7D32", bg: "rgba(46,125,50,0.1)" },
  "吉": { color: "#388E3C", bg: "rgba(56,142,60,0.1)" },
  "吉中有凶": { color: "#F9A825", bg: "rgba(249,168,37,0.1)" },
  "曇花一現": { color: "#F9A825", bg: "rgba(249,168,37,0.1)" },
  "平": { color: "#546E7A", bg: "rgba(84,110,122,0.08)" },
  "小凶": { color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "凶中有吉": { color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "凶中帶機": { color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "凶": { color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "大凶": { color: "#E65100", bg: "rgba(230,81,0,0.1)" },
  "凶上加凶": { color: "#E65100", bg: "rgba(230,81,0,0.1)" },
};

const MONTH_NAMES = [
  "", "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

const AUSPICIOUSNESS_TO_STARS: Record<string, number> = {
  '大吉': 5.0,
  '吉': 4.0,
  '平': 3.0,
  '凶': 2.0,
  '大凶': 1.0,
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

export default function MonthlyFortuneGrid({
  forecasts,
  narratives,
}: MonthlyFortuneGridProps) {
  if (!forecasts || forecasts.length === 0) return null;

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {forecasts.map((fc) => {
          const colors = AUSPICIOUSNESS_COLORS[fc.auspiciousness] ??
            AUSPICIOUSNESS_COLORS["平"]!;
          const monthPad = fc.month.toString().padStart(2, "0");
          const narrative = narratives?.[`monthly_forecast_${monthPad}`];
          const monthName = MONTH_NAMES[fc.month] || `${fc.month}月`;

          return (
            <div
              key={fc.month}
              className={styles.card}
            >
              <div className={styles.cardTop}>
                <div className={styles.monthInfo}>
                  <span className={styles.monthName}>{monthName}</span>
                  <span className={styles.solarTerm}>{fc.monthName}</span>
                </div>

                <div className={styles.badgeRow}>
                  <span
                    className={styles.badge}
                    style={{
                      color: colors.color,
                      backgroundColor: colors.bg,
                    }}
                  >
                    {fc.auspiciousness}
                  </span>
                  <StarRatingInline score={AUSPICIOUSNESS_TO_STARS[fc.auspiciousness] ?? 3.0} />
                </div>
              </div>

              <div className={styles.cardMeta}>
                <span className={styles.ganZhi}>
                  {fc.stem}{fc.branch}
                </span>
                <span className={styles.metaTenGod}>【{fc.tenGod}】</span>
              </div>

              <div className={styles.dateRange}>
                {fc.solarTermDate}
                {fc.solarTermEndDate && ` ~ ${fc.solarTermEndDate}`}
              </div>

              {/* Always-visible content */}
              {(narrative || (fc.branchInteractions && fc.branchInteractions.length > 0)) && (
                <div className={styles.expandedContent}>
                  {fc.branchInteractions && fc.branchInteractions.length > 0 && (
                    <div className={styles.branchBadges}>
                      {fc.branchInteractions.map((bi, i) => (
                        <span key={i} className={styles.branchBadge} data-type={bi.type}>
                          {bi.type}：{bi.effect}
                        </span>
                      ))}
                    </div>
                  )}
                  {narrative && (
                    <div className={styles.narrative}>
                      {renderNarrativeContent(narrative)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
