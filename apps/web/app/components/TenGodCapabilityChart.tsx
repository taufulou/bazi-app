"use client";

import styles from "./TenGodCapabilityChart.module.css";

/** Ten gods in traditional pair order */
const TEN_GOD_ORDER = [
  "\u6bd4\u80a9", "\u52ab\u8ca1",   // 比肩, 劫財
  "\u98df\u795e", "\u50b7\u5b98",   // 食神, 傷官
  "\u504f\u8ca1", "\u6b63\u8ca1",   // 偏財, 正財
  "\u504f\u5b98", "\u6b63\u5b98",   // 偏官, 正官
  "\u504f\u5370", "\u6b63\u5370",   // 偏印, 正印
];

/** Group labels for ten god pairs */
const TEN_GOD_GROUPS: Record<string, string> = {
  "\u6bd4\u80a9": "\u6bd4\u52ab",   // 比劫
  "\u52ab\u8ca1": "\u6bd4\u52ab",
  "\u98df\u795e": "\u98df\u50b7",   // 食傷
  "\u50b7\u5b98": "\u98df\u50b7",
  "\u504f\u8ca1": "\u8ca1\u661f",   // 財星
  "\u6b63\u8ca1": "\u8ca1\u661f",
  "\u504f\u5b98": "\u5b98\u6bba",   // 官殺
  "\u6b63\u5b98": "\u5b98\u6bba",
  "\u504f\u5370": "\u5370\u661f",   // 印星
  "\u6b63\u5370": "\u5370\u661f",
};

interface TenGodData {
  percentage: number;
  level: string;
  capabilities: string[];
}

interface TenGodCapabilityChartProps {
  data: Record<string, TenGodData>;
  title?: string;
}

export default function TenGodCapabilityChart({
  data,
  title = "後天社會能力（十神比重）",
}: TenGodCapabilityChartProps) {
  if (!data) return null;

  const tenGods = TEN_GOD_ORDER.filter((tg) => data[tg] != null);

  // Find max percentage for relative scaling
  const maxPct = Math.max(...tenGods.map((tg) => data[tg]?.percentage ?? 0), 1);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4 className={styles.title}>{title}</h4>
        <p className={styles.subtitle}>
          已根據五行旺衰（旺相休囚死）進行加權調整，更精準反映命格能量分佈
        </p>
      </div>

      <div className={styles.chartList}>
        {tenGods.map((tenGod) => {
          const info = data[tenGod];
          if (!info) return null;
          const pct = Math.min(Math.max(info.percentage, 0), 100);
          const relativeWidth = (pct / maxPct) * 100;
          const group = TEN_GOD_GROUPS[tenGod] || "";

          return (
            <div key={tenGod} className={styles.row}>
              <div className={styles.rowHeader}>
                <span className={styles.tenGodName}>{tenGod}</span>
                <span className={styles.groupLabel}>{group}</span>
                <span className={styles.percentage}>{pct.toFixed(1)}%</span>
                <span className={styles.level}>{info.level}</span>
              </div>

              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${relativeWidth}%` }}
                />
              </div>

              {info.capabilities && info.capabilities.length > 0 && (
                <div className={styles.capabilities}>
                  {info.capabilities.map((cap, i) => (
                    <span key={i} className={styles.capTag}>
                      {cap}
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
