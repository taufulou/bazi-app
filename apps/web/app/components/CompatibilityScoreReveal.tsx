"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./CompatibilityScoreReveal.module.css";

// ============================================================
// Types
// ============================================================

interface CompatibilityScoreRevealProps {
  score: number; // 0-100
  label: string; // e.g. "天生一對"
  specialLabel: string | null; // e.g. "鴛鴦命" or null
  onComplete: () => void;
}

type AnimPhase = "loader" | "countup" | "label" | "special" | "done";

// ============================================================
// Helpers
// ============================================================

/** Ease-out cubic: fast start, slow finish. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Map score to display color. */
function getScoreColor(score: number): string {
  if (score >= 85) return "#4caf50"; // Green
  if (score >= 70) return "#8bc34a"; // Light green
  if (score >= 55) return "#ffc107"; // Amber
  if (score >= 40) return "#ff9800"; // Orange
  return "#f44336"; // Red
}

// ============================================================
// Component
// ============================================================

export default function CompatibilityScoreReveal({
  score,
  label,
  specialLabel,
  onComplete,
}: CompatibilityScoreRevealProps) {
  const [phase, setPhase] = useState<AnimPhase>("loader");
  const [displayScore, setDisplayScore] = useState(0);
  const animFrameRef = useRef<number>(0);
  const onCompleteRef = useRef(onComplete);

  // Keep the callback ref current
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // ============================================================
  // Animation sequence
  // ============================================================

  useEffect(() => {
    // Phase 1: Loader (1.5s)
    const loaderTimer = setTimeout(() => {
      setPhase("countup");
    }, 1500);

    return () => {
      clearTimeout(loaderTimer);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Phase 2: Count-up animation
  useEffect(() => {
    if (phase !== "countup") return;

    const duration = 2000; // 2s count-up
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      setDisplayScore(Math.round(score * eased));

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Count-up done → show label
        setPhase("label");
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [phase, score]);

  // Phase 3: Label reveal → Special label → Done
  useEffect(() => {
    if (phase !== "label") return;

    const specialTimer = setTimeout(() => {
      if (specialLabel) {
        setPhase("special");
        // After special label shows, complete
        setTimeout(() => {
          setPhase("done");
          onCompleteRef.current();
        }, 1500);
      } else {
        // No special label, complete after label shows
        setPhase("done");
        setTimeout(() => {
          onCompleteRef.current();
        }, 1000);
      }
    }, 1000);

    return () => clearTimeout(specialTimer);
  }, [phase, specialLabel]);

  const scoreColor = getScoreColor(score);

  return (
    <div className={styles.container}>
      {/* Phase 1: Dual-orbit loader */}
      {phase === "loader" && (
        <div className={styles.loaderWrap}>
          <div className={styles.orbit1} />
          <div className={styles.orbit2} />
          <p className={styles.loaderText}>正在合盤分析中...</p>
        </div>
      )}

      {/* Phase 2+: Score display */}
      {phase !== "loader" && (
        <div className={styles.scoreWrap}>
          {/* Score ring */}
          <div className={styles.scoreRing}>
            <svg viewBox="0 0 200 200" className={styles.ringSvg}>
              {/* Background ring */}
              <circle
                cx="100"
                cy="100"
                r="88"
                fill="none"
                stroke="rgba(232, 213, 183, 0.1)"
                strokeWidth="6"
              />
              {/* Animated progress ring */}
              <circle
                cx="100"
                cy="100"
                r="88"
                fill="none"
                stroke={scoreColor}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 88}`}
                strokeDashoffset={`${2 * Math.PI * 88 * (1 - displayScore / 100)}`}
                transform="rotate(-90 100 100)"
                className={styles.progressRing}
              />
            </svg>

            {/* Score number */}
            <div className={styles.scoreNumber} style={{ color: scoreColor }}>
              {displayScore}
            </div>
            <div className={styles.scoreUnit}>分</div>
          </div>

          {/* Label */}
          <div
            className={`${styles.labelText} ${
              phase === "label" || phase === "special" || phase === "done"
                ? styles.labelVisible
                : ""
            }`}
          >
            {label}
          </div>

          {/* Label description */}
          {(phase === "label" || phase === "special" || phase === "done") && (
            <div className={styles.labelDesc}>
              {score >= 85 && "整體契合度極高，天作之合"}
              {score >= 70 && score < 85 && "互補性良好，發展前景樂觀"}
              {score >= 55 && score < 70 && "有一定契合度，需要磨合"}
              {score >= 40 && score < 55 && "差異較大，需要更多努力"}
              {score < 40 && "挑戰重重，需謹慎考慮"}
            </div>
          )}

          {/* Special label */}
          {(phase === "special" || phase === "done") && specialLabel && (
            <div className={styles.specialLabel}>
              <span className={styles.specialIcon}>✨</span>
              {specialLabel}
              <span className={styles.specialIcon}>✨</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
