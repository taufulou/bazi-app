import React from "react";
import styles from "./LoveMonthlyGrid.module.css";
import { AUSPICIOUSNESS_TO_STARS } from "../lib/bazi-utils";

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

interface LoveMonthlyForecast {
  month: number;
  stem: string;
  branch: string;
  stemTenGod: string;
  stemRole: string;
  auspiciousness: string;
  interactions: string[];
  hasRomanceStar: boolean;
  isVoid: boolean;
  lpContext: string; // included for data completeness — NOT rendered in cards
}

interface LoveMonthlyGridProps {
  forecasts: LoveMonthlyForecast[];
  /** AI narrative sections keyed by "monthly_love_01" etc. */
  narratives?: Record<string, string>;
  /** When true, show shimmer skeleton in cards without narratives */
  isStreaming?: boolean;
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

/** Build monthly signal pills from interactions + romance star + void */
function buildMonthlySignals(fc: LoveMonthlyForecast): Array<{ label: string; type: string }> {
  const pills: Array<{ label: string; type: string }> = [];

  if (fc.hasRomanceStar) {
    pills.push({ label: "🌸 桃花月", type: "good" });
  }
  if (fc.isVoid) {
    pills.push({ label: "空亡月", type: "danger" });
  }
  // Parse interactions for spouse palace signals
  for (const interaction of fc.interactions) {
    if (interaction.includes('六合')) {
      pills.push({ label: "六合", type: "good" });
    } else if (interaction.includes('六沖')) {
      pills.push({ label: "六沖", type: "danger" });
    } else if (interaction.includes('六害')) {
      pills.push({ label: "六害", type: "danger" });
    } else if (interaction.includes('伏吟')) {
      pills.push({ label: "伏吟", type: "change" });
    }
  }

  return pills;
}

export default function LoveMonthlyGrid({
  forecasts,
  narratives,
  isStreaming = false,
}: LoveMonthlyGridProps) {
  if (!forecasts || forecasts.length === 0) return null;

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {forecasts.map((fc) => {
          const colors = AUSPICIOUSNESS_COLORS[fc.auspiciousness] ??
            AUSPICIOUSNESS_COLORS["平"]!;
          const monthPad = fc.month.toString().padStart(2, "0");
          const narrative = narratives?.[`monthly_love_${monthPad}`];
          const monthName = MONTH_NAMES[fc.month] || `${fc.month}月`;
          const signals = buildMonthlySignals(fc);

          return (
            <div
              key={fc.month}
              className={styles.card}
            >
              <div className={styles.cardTop}>
                <span className={styles.monthName}>{monthName}</span>
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
                <span className={styles.metaTenGod}>【{fc.stemTenGod}】</span>
              </div>

              {/* Signal pills */}
              {signals.length > 0 && (
                <div className={styles.signals}>
                  {signals.map((s, i) => (
                    <span key={i} className={styles.signal} data-type={s.type}>
                      {s.label}
                    </span>
                  ))}
                </div>
              )}

              {/* AI narrative or streaming skeleton */}
              {(narrative || isStreaming) && (
                <div className={styles.expandedContent}>
                  {narrative ? (
                    <div className={styles.narrative}>
                      {renderNarrativeContent(narrative)}
                    </div>
                  ) : (
                    <div className={styles.skeletonContent}>
                      <div className={styles.skeletonLine} style={{ width: '90%' }} />
                      <div className={styles.skeletonLine} style={{ width: '75%' }} />
                      <div className={styles.skeletonLine} style={{ width: '60%' }} />
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
