"use client";

import { useMemo } from "react";
import type { CompatibilityDimensionScore } from "../lib/readings-api";
import styles from "./CompatibilityRadarChart.module.css";

// ============================================================
// Types
// ============================================================

interface CompatibilityRadarChartProps {
  dimensionScores: Record<string, CompatibilityDimensionScore>;
  comparisonType: string; // 'ROMANCE' | 'BUSINESS' | 'FRIENDSHIP'
  size?: number; // SVG side length, default 300
}

interface RadarAxis {
  key: string;
  label: string;
  score: number; // 0-100 (amplifiedScore)
}

// ============================================================
// Constants
// ============================================================

/**
 * Map 8 technical dimensions → 7 user-facing axes.
 * yongshenComplementarity + elementComplementarity are averaged into one axis.
 */
const AXIS_CONFIG: Array<{
  keys: string[]; // technical keys (averaged if multiple)
  label: string;
}> = [
  { keys: ["yongshenComplementarity", "elementComplementarity"], label: "命格互補" },
  { keys: ["dayStemRelationship"], label: "靈魂契合度" },
  { keys: ["spousePalace"], label: "婚姻宮互動" },
  { keys: ["tenGodCross"], label: "角色互動" },
  { keys: ["fullPillarInteraction"], label: "整體相容" },
  { keys: ["shenShaInteraction"], label: "緣分星曜" },
  { keys: ["luckPeriodSync"], label: "時運同步" },
];

const NUM_AXES = 7;

/** Comparison type → theme colors */
const TYPE_COLORS: Record<string, { fill: string; stroke: string }> = {
  ROMANCE: { fill: "rgba(233, 30, 99, 0.2)", stroke: "#e91e63" },
  BUSINESS: { fill: "rgba(33, 150, 243, 0.2)", stroke: "#2196f3" },
  FRIENDSHIP: { fill: "rgba(76, 175, 80, 0.2)", stroke: "#4caf50" },
};

// ============================================================
// Helpers
// ============================================================

/** Calculate point on the polygon for a given axis index and score (0-100). */
function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  axisIndex: number,
  totalAxes: number,
): { x: number; y: number } {
  const angle = (2 * Math.PI * axisIndex) / totalAxes - Math.PI / 2; // Start from top
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

/** Build polygon path string for a set of scores. */
function buildPolygonPath(
  scores: number[],
  cx: number,
  cy: number,
  maxRadius: number,
): string {
  return scores
    .map((score, i) => {
      const r = (score / 100) * maxRadius;
      const { x, y } = polarToCartesian(cx, cy, r, i, scores.length);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ") + " Z";
}

/** Build polygon path for grid levels (equal scores). */
function buildGridPath(
  level: number,
  cx: number,
  cy: number,
  maxRadius: number,
  numAxes: number,
): string {
  const r = level * maxRadius;
  return Array.from({ length: numAxes })
    .map((_, i) => {
      const { x, y } = polarToCartesian(cx, cy, r, i, numAxes);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ") + " Z";
}

// ============================================================
// Component
// ============================================================

export default function CompatibilityRadarChart({
  dimensionScores,
  comparisonType,
  size = 300,
}: CompatibilityRadarChartProps) {
  // Guard: if dimensionScores is undefined/null, render nothing
  if (!dimensionScores) return null;
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = size * 0.38; // Leave room for labels
  const labelRadius = size * 0.47;

  const defaultColors = { fill: "rgba(233, 30, 99, 0.2)", stroke: "#e91e63" };
  const colors = TYPE_COLORS[comparisonType] ?? defaultColors;

  // Build axes data from dimension scores
  const axes: RadarAxis[] = useMemo(() => {
    return AXIS_CONFIG.map((cfg) => {
      const scores = cfg.keys
        .map((k) => dimensionScores[k]?.amplifiedScore ?? 50)
        .filter((s) => !isNaN(s));
      const avg = scores.length > 0
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : 50;
      return {
        key: cfg.keys[0] || cfg.label,
        label: cfg.label,
        score: Math.round(Math.min(100, Math.max(0, avg))),
      };
    });
  }, [dimensionScores]);

  const scoreValues = axes.map((a) => a.score);
  const dataPath = buildPolygonPath(scoreValues, cx, cy, maxRadius);

  // Grid levels: 33%, 66%, 100%
  const gridLevels = [0.33, 0.66, 1.0];

  return (
    <div className={styles.chartContainer}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className={styles.svg}
      >
        {/* Grid lines */}
        {gridLevels.map((level) => (
          <path
            key={level}
            d={buildGridPath(level, cx, cy, maxRadius, NUM_AXES)}
            fill="none"
            stroke="rgba(232, 213, 183, 0.1)"
            strokeWidth="1"
          />
        ))}

        {/* Axis lines from center to edge */}
        {axes.map((_, i) => {
          const { x, y } = polarToCartesian(cx, cy, maxRadius, i, NUM_AXES);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="rgba(232, 213, 183, 0.08)"
              strokeWidth="1"
            />
          );
        })}

        {/* Data polygon */}
        <path
          d={dataPath}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          className={styles.dataPolygon}
        />

        {/* Data points */}
        {axes.map((axis, i) => {
          const r = (axis.score / 100) * maxRadius;
          const { x, y } = polarToCartesian(cx, cy, r, i, NUM_AXES);
          return (
            <circle
              key={axis.key}
              cx={x}
              cy={y}
              r="3.5"
              fill={colors.stroke}
              className={styles.dataPoint}
            />
          );
        })}

        {/* Labels */}
        {axes.map((axis, i) => {
          const { x, y } = polarToCartesian(cx, cy, labelRadius, i, NUM_AXES);
          return (
            <text
              key={axis.key}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className={styles.axisLabel}
              fill="#a0a0a0"
              fontSize="11"
            >
              {axis.label}
            </text>
          );
        })}

        {/* Score values near each point */}
        {axes.map((axis, i) => {
          const r = (axis.score / 100) * maxRadius + 12;
          const { x, y } = polarToCartesian(cx, cy, r, i, NUM_AXES);
          return (
            <text
              key={`score-${axis.key}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={colors.stroke}
              fontSize="10"
              fontWeight="600"
              className={styles.scoreText}
            >
              {axis.score}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
