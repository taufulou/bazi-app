"use client";

import { useState, useCallback } from "react";
import styles from "./LuckPeriodChart.module.css";
import { getScoreColor } from "../lib/score-utils";
import type { LuckPeriodDetailData } from "../lib/readings-api";

// ============================================================
// SVG Trend Chart for Luck Period Scores
// ============================================================

interface LuckPeriodChartProps {
  periods: LuckPeriodDetailData[];
  isSubscriber: boolean;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  period: LuckPeriodDetailData | null;
}

// SVG layout constants
const SVG_W = 800;
const SVG_H = 320;
const PAD_LEFT = 45;
const PAD_RIGHT = 20;
const PAD_TOP = 25;
const PAD_BOTTOM = 80;
const CHART_W = SVG_W - PAD_LEFT - PAD_RIGHT;
const CHART_H = SVG_H - PAD_TOP - PAD_BOTTOM;
const MIN_LABEL_Y = 8; // labels must stay below this y to avoid viewBox clipping

export default function LuckPeriodChart({
  periods,
  isSubscriber,
}: LuckPeriodChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    period: null,
  });

  const n = periods.length;
  if (n === 0) return null;

  // Map index to SVG coordinates
  const getX = (i: number) => PAD_LEFT + (i / Math.max(n - 1, 1)) * CHART_W;
  const getY = (score: number) =>
    PAD_TOP + CHART_H - (score / 100) * CHART_H;

  // Build polyline points
  const points = periods
    .map((p, i) => `${getX(i)},${getY(p.score)}`)
    .join(" ");

  // Grid lines at 25, 50, 75
  const gridLines = [25, 50, 75];

  const handleMouseEnter = useCallback(
    (period: LuckPeriodDetailData, event: React.MouseEvent<SVGCircleElement>) => {
      if (!isSubscriber) return;
      const svg = event.currentTarget.closest("svg");
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = event.clientX - rect.left;
      const svgY = event.clientY - rect.top;
      setTooltip({ visible: true, x: svgX, y: svgY, period });
    },
    [isSubscriber]
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartTitle}>大運走勢圖</div>

      <div className={styles.chartScroll}>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={PAD_LEFT}
              y1={getY(v)}
              x2={SVG_W - PAD_RIGHT}
              y2={getY(v)}
              stroke="rgba(232, 213, 183, 0.1)"
              strokeDasharray="4 4"
            />
            {isSubscriber && (
              <text
                x={PAD_LEFT - 8}
                y={getY(v) + 4}
                textAnchor="end"
                fill="#666"
                fontSize="11"
              >
                {v}
              </text>
            )}
          </g>
        ))}

        {/* Y-axis labels for non-subscriber: show "??" */}
        {!isSubscriber &&
          gridLines.map((v) => (
            <text
              key={`blur-${v}`}
              x={PAD_LEFT - 8}
              y={getY(v) + 4}
              textAnchor="end"
              fill="#555"
              fontSize="11"
            >
              ??
            </text>
          ))}

        {/* Y-axis line */}
        <line
          x1={PAD_LEFT}
          y1={PAD_TOP}
          x2={PAD_LEFT}
          y2={PAD_TOP + CHART_H}
          stroke="rgba(232, 213, 183, 0.2)"
        />

        {/* X-axis line */}
        <line
          x1={PAD_LEFT}
          y1={PAD_TOP + CHART_H}
          x2={SVG_W - PAD_RIGHT}
          y2={PAD_TOP + CHART_H}
          stroke="rgba(232, 213, 183, 0.2)"
        />

        {/* Gradient fill under the line */}
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e8d5b7" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#e8d5b7" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon
          points={`${getX(0)},${PAD_TOP + CHART_H} ${points} ${getX(n - 1)},${PAD_TOP + CHART_H}`}
          fill="url(#chartGrad)"
        />

        {/* Line connecting scores */}
        <polyline
          points={points}
          fill="none"
          stroke="#e8d5b7"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots for each period */}
        {periods.map((p, i) => {
          const isCurrent = p.isCurrent;
          const rawScoreY = getY(p.score) - 10;
          const rawCurrentY = getY(p.score) - (isSubscriber ? 30 : 18);
          const currentLabelY = Math.max(MIN_LABEL_Y, rawCurrentY);
          const scoreLabelY = isCurrent
            ? Math.max(rawScoreY, currentLabelY + 16)
            : rawScoreY;

          return (
            <g key={`${p.stem}${p.branch}-${i}`}>
              {/* Score color dot */}
              <circle
                cx={getX(i)}
                cy={getY(p.score)}
                r={isCurrent ? 6 : 5}
                fill={getScoreColor(p.score)}
                stroke={isCurrent ? "#fff" : "none"}
                strokeWidth={isCurrent ? 2 : 0}
                className={isCurrent ? styles.currentDot : undefined}
                onMouseEnter={(e) => handleMouseEnter(p, e)}
                onMouseLeave={handleMouseLeave}
                style={{ cursor: isSubscriber ? "pointer" : "default" }}
              />

              {/* "當前" label above current period */}
              {isCurrent && (
                <text
                  x={getX(i)}
                  y={currentLabelY}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  className={styles.currentLabel}
                >
                  當前
                </text>
              )}

              {/* Score label */}
              {isSubscriber && (
                <text
                  x={getX(i)}
                  y={scoreLabelY}
                  textAnchor="middle"
                  fill={getScoreColor(p.score)}
                  fontSize="11"
                  fontWeight="600"
                >
                  {p.score}
                </text>
              )}

              {/* X-axis label: 干支 */}
              <text
                x={getX(i)}
                y={PAD_TOP + CHART_H + 20}
                textAnchor="middle"
                fill="#e8d5b7"
                fontSize="14"
                fontWeight="600"
              >
                {p.stem}{p.branch}
              </text>

              {/* X-axis sub-label: year range */}
              <text
                x={getX(i)}
                y={PAD_TOP + CHART_H + 40}
                textAnchor="middle"
                fill="#777"
                fontSize="12"
              >
                {p.startYear}-{p.endYear}
              </text>

              {/* X-axis sub-label: age range */}
              <text
                x={getX(i)}
                y={PAD_TOP + CHART_H + 57}
                textAnchor="middle"
                fill="#666"
                fontSize="12"
              >
                ({p.startAge}-{p.endAge}歲)
              </text>
            </g>
          );
        })}
      </svg>
      </div>

      {/* HTML tooltip (positioned outside SVG for better rendering) */}
      {tooltip.visible && tooltip.period && isSubscriber && (
        <div
          className={styles.tooltip}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className={styles.tooltipTitle}>
            {tooltip.period.stem}{tooltip.period.branch}大運
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>評分</span>
            <span
              className={styles.tooltipValue}
              style={{ color: getScoreColor(tooltip.period.score) }}
            >
              {tooltip.period.score}分
            </span>
          </div>
          {tooltip.period.stemTenGod && (
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipLabel}>天干</span>
              <span className={styles.tooltipValue}>
                {tooltip.period.stem}（{tooltip.period.stemTenGod}）
              </span>
            </div>
          )}
          {tooltip.period.branchTenGod && (
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipLabel}>地支</span>
              <span className={styles.tooltipValue}>
                {tooltip.period.branch}（{tooltip.period.branchTenGod}）
              </span>
            </div>
          )}
          {tooltip.period.interactions &&
            tooltip.period.interactions.length > 0 && (
              <div style={{ marginTop: "0.3rem", borderTop: "1px solid rgba(232,213,183,0.15)", paddingTop: "0.3rem" }}>
                <div className={styles.tooltipLabel} style={{ marginBottom: "0.15rem" }}>
                  命局互動
                </div>
                {tooltip.period.interactions.slice(0, 3).map((inter, idx) => (
                  <div key={idx} style={{ fontSize: "0.72rem", color: "#ccc" }}>
                    {inter}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {/* Non-subscriber overlay: scores masked but curve shape visible */}
      {!isSubscriber && (
        <div className={styles.blurOverlay}>
          <div className={styles.blurOverlayText}>
            訂閱後解鎖詳細分數
          </div>
        </div>
      )}
    </div>
  );
}
