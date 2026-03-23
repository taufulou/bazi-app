'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import styles from './CompatibilityScoreRevealV2.module.css';

interface ScoreBreakdown {
  baseScore: number;
  sweetnessScore: number;
  stabilityScore: number;
  romanceAvg: number;
  formula: string;
}

interface CompatibilityScoreRevealV2Props {
  score: number;
  label: string;
  scoreBreakdown?: ScoreBreakdown;
  nameA: string;
  nameB: string;
  peachBlossomCountA: number;
  peachBlossomCountB: number;
  spouseStarCountA: number;
  spouseStarCountB: number;
  romancePA: any;
}

function getScoreColor(score: number): string {
  if (score >= 85) return 'var(--color-success)';
  if (score >= 70) return 'var(--score-good)';
  if (score >= 55) return 'var(--color-warning)';
  if (score >= 40) return 'var(--score-poor)';
  return 'var(--color-error)';
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default function CompatibilityScoreRevealV2({
  score,
  label,
  scoreBreakdown,
  nameA,
  nameB,
  peachBlossomCountA,
  peachBlossomCountB,
  spouseStarCountA,
  spouseStarCountB,
  romancePA,
}: CompatibilityScoreRevealV2Props) {
  const [displayScore, setDisplayScore] = useState(0);
  const [phase, setPhase] = useState(0);
  // phase 0: mount, start count-up
  // phase 1: count-up done → label visible
  // phase 2: breakdown visible
  // phase 3: badges visible
  // phase 4: reassurance visible (if score < 55)
  // phase 5: masterNote visible

  const animFrameRef = useRef<number>(0);
  const mountedRef = useRef(true);

  // Count-up animation
  useEffect(() => {
    mountedRef.current = true;
    const duration = 2000; // 2 seconds
    const startTime = performance.now();

    function animate(currentTime: number) {
      if (!mountedRef.current) return;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);
      setDisplayScore(Math.round(easedProgress * score));

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    }

    animFrameRef.current = requestAnimationFrame(animate);

    // Phase timers
    const t1 = setTimeout(() => mountedRef.current && setPhase(1), 2200);  // label
    const t2 = setTimeout(() => mountedRef.current && setPhase(2), 2800);  // breakdown
    const t3 = setTimeout(() => mountedRef.current && setPhase(3), 3400);  // badges
    const t4 = setTimeout(() => mountedRef.current && setPhase(4), 4000);  // reassurance
    const t5 = setTimeout(() => mountedRef.current && setPhase(5), 4600);  // masterNote

    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [score]);

  // SVG ring calculations
  const size = 180;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = circumference - (displayScore / 100) * circumference;
  const scoreColor = getScoreColor(score);

  // 老師寄語 narrative (same logic as former MasterNote)
  const sweetness = romancePA?.postMarriageQuality?.sweetness?.score ?? 50;
  const stability = romancePA?.postMarriageQuality?.stability?.score ?? 50;
  const crisisLevel = romancePA?.combinedCrisis?.overallLevel ?? '';

  let opening: string;
  if (score >= 65) {
    opening = `從${nameA}和${nameB}的八字命盤來看，兩人的感情配對有不少值得期待的地方。`;
  } else if (score >= 45) {
    opening = `從${nameA}和${nameB}的八字命盤來看，兩人的配對有優勢也有挑戰，需要用心經營。`;
  } else {
    opening = `從${nameA}和${nameB}的八字命盤來看，兩人在某些方面存在差異，但這不代表沒有幸福的可能。`;
  }

  const scoreLine = scoreBreakdown
    ? `綜合配對指數為${score}分（配對基礎${scoreBreakdown.baseScore}分，婚後甜蜜度${scoreBreakdown.sweetnessScore}分，穩定度${scoreBreakdown.stabilityScore}分）。`
    : `綜合配對指數為${score}分。`;

  const qualityLine = sweetness >= 80 && stability >= 80
    ? '婚後相處品質相當高，兩人能感受到幸福和安全感。'
    : sweetness >= 60 || stability >= 60
    ? '婚後有一定的相處基礎，但需要雙方共同用心經營。'
    : '婚後需要較多的包容和磨合，建議提前了解彼此的差異。';

  const crisisLine = crisisLevel === '輕微' || crisisLevel === '良好'
    ? '合婚危機等級較低，這是長久穩定的好基礎。'
    : crisisLevel === '中等'
    ? '存在一些需要注意的合婚風險，但只要雙方願意溝通，都可以化解。'
    : '合婚方面有些挑戰需要正視，了解風險才能更好地經營關係。';

  return (
    <div className={styles.container}>
      {/* Score Ring */}
      <div className={styles.scoreRing}>
        <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`}>
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(212, 160, 23, 0.25)"
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={scoreColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={progressOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 0.1s ease-out' }}
          />
        </svg>
        <div className={styles.scoreCenter}>
          <div className={styles.scoreRow}>
            <span className={styles.scoreNumber} style={{ color: scoreColor }}>
              {displayScore}
            </span>
            <span className={styles.scoreUnit}>分</span>
          </div>
          {phase >= 1 && (
            <span className={styles.scoreLabelInRing}>{label}</span>
          )}
        </div>
      </div>

      {/* Score Breakdown — Mini Bar Chart */}
      {scoreBreakdown && (
        <div className={`${styles.scoreBreakdown} ${phase >= 2 ? styles.visible : ''}`}>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>配對契合</span>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                style={{ width: `${scoreBreakdown.baseScore}%`, background: getScoreColor(scoreBreakdown.baseScore) }}
              />
            </div>
            <span className={styles.barValue}>{scoreBreakdown.baseScore}</span>
          </div>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>婚後品質</span>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                style={{ width: `${scoreBreakdown.romanceAvg}%`, background: getScoreColor(scoreBreakdown.romanceAvg) }}
              />
            </div>
            <span className={styles.barValue}>{scoreBreakdown.romanceAvg}</span>
          </div>
        </div>
      )}

      {/* Star Count Badges */}
      <div className={`${styles.badgesRow} ${phase >= 3 ? styles.visible : ''}`}>
        <div className={styles.personBadges}>
          <span className={styles.personName}>{nameA}</span>
          <span className={styles.badge} data-type="peach">🌸 桃花 {peachBlossomCountA}朵</span>
          <span className={styles.badge} data-type="spouse">💍 姻緣星 {spouseStarCountA}顆</span>
        </div>
        <div className={styles.personBadges}>
          <span className={styles.personName}>{nameB}</span>
          <span className={styles.badge} data-type="peach">🌸 桃花 {peachBlossomCountB}朵</span>
          <span className={styles.badge} data-type="spouse">💍 姻緣星 {spouseStarCountB}顆</span>
        </div>
      </div>

      {/* Reassurance Banner (score < 55 only) */}
      {score < 55 && (
        <div className={`${styles.reassurance} ${phase >= 4 ? styles.visible : ''}`}>
          <span className={styles.reassuranceIcon}>💡</span>
          <div className={styles.reassuranceContent}>
            <strong>分數不等於命運</strong>
            <p>配對分數反映的是兩人先天命盤的契合度，而非最終結果。許多高分配對因為不經營而失敗，低分配對反而因為彼此珍惜而幸福美滿。了解差異，才能更好地相處。</p>
          </div>
        </div>
      )}

      {/* 老師寄語 */}
      <div className={`${styles.masterNote} ${phase >= 5 ? styles.visible : ''}`}>
        <div className={styles.masterNoteHeader}>
          <span className={styles.masterNoteIcon}>📋</span>
          <span className={styles.masterNoteTitle}>老師寄語</span>
        </div>
        <p className={styles.masterNoteText}>
          {opening}{scoreLine}{qualityLine}{crisisLine}
        </p>
        <p className={styles.masterNoteFooter}>
          以下為詳細的逐項分析，幫助你們更深入了解彼此的感情特質和相處模式。
        </p>
      </div>
    </div>
  );
}
