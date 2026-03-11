"use client";

import styles from "./ElementCapabilityChart.module.css";

/** Matches BaziChart.tsx CHART_ELEMENT_COLORS */
const ELEMENT_COLORS: Record<string, string> = {
  "\u6728": "#2E7D32", // 木
  "\u706b": "#D32F2F", // 火
  "\u571f": "#8D6E63", // 土
  "\u91d1": "#B8860B", // 金
  "\u6c34": "#1565C0", // 水
};

const ELEMENT_ORDER = ["\u6728", "\u706b", "\u571f", "\u91d1", "\u6c34"];

interface ElementData {
  percentage: number;
  level: string;
  talents: string[];
}

interface ElementCapabilityChartProps {
  data: Record<string, ElementData>;
  title?: string;
}

export default function ElementCapabilityChart({
  data,
  title = "先天潛在能力（五行比重）",
}: ElementCapabilityChartProps) {
  if (!data) return null;

  // Collect elements in standard order, falling back to data keys if needed
  const elements = ELEMENT_ORDER.filter((e) => data[e] != null);

  // Find max percentage for relative scaling (largest bar fills 100% of track)
  const maxPct = Math.max(...elements.map((e) => data[e]?.percentage ?? 0), 1);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4 className={styles.title}>{title}</h4>
        <p className={styles.subtitle}>
          已根據五行旺衰（旺相休囚死）進行加權調整，更精準反映命格能量分佈
        </p>
      </div>

      <div className={styles.chartList}>
        {elements.map((element) => {
          const info = data[element];
          if (!info) return null;
          const color = ELEMENT_COLORS[element] || "#8D6E63";
          const pct = Math.min(Math.max(info.percentage, 0), 100);
          const barWidth = (pct / maxPct) * 100;

          return (
            <div key={element} className={styles.row}>
              <div className={styles.rowHeader}>
                <span
                  className={styles.elementBadge}
                  style={{ backgroundColor: color }}
                >
                  {element}
                </span>
                <span className={styles.percentage}>{pct.toFixed(1)}%</span>
                <span className={styles.level}>{info.level}</span>
              </div>

              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: color,
                  }}
                />
              </div>

              {info.talents && info.talents.length > 0 && (
                <div className={styles.talents}>
                  {info.talents.map((talent, i) => (
                    <span key={i} className={styles.talentTag}>
                      {talent}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
