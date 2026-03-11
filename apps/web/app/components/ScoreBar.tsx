"use client";

import styles from "./ScoreBar.module.css";

interface ScoreBarProps {
  label: string;
  score: number;
  max?: number;
  levels?: string[];
  tier?: string;
  color?: string;
}

const DEFAULT_LEVELS = ["低", "較低", "一般", "較高", "高"];

export default function ScoreBar({
  label,
  score,
  max = 100,
  levels = DEFAULT_LEVELS,
  tier,
  color,
}: ScoreBarProps) {
  const percentage = Math.min(Math.max((score / max) * 100, 0), 100);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={styles.score}>
          {score}分
          {tier && <span className={styles.tier}>（{tier}）</span>}
        </span>
      </div>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{
            width: `${percentage}%`,
            background: color || undefined,
          }}
        />
      </div>
      {levels.length > 0 && (
        <div className={styles.levels}>
          {levels.map((lv, i) => (
            <span key={i} className={styles.levelLabel}>{lv}</span>
          ))}
        </div>
      )}
    </div>
  );
}
