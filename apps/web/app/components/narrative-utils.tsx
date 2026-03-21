import React from "react";
import styles from "./narrative-utils.module.css";

/** Parse AI narrative text into styled React elements with golden dot bullets.
 *  Shared across LoveForecastTimeline, LoveMonthlyGrid, AnnualForecastTimeline, MonthlyFortuneGrid.
 */
export function renderNarrativeContent(text: string): React.ReactNode {
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
