/**
 * Shared score color utility for luck period scores (0-100).
 * Thresholds calibrated for luck period distribution where most scores
 * cluster in the 20-65 range.
 */
export function getScoreColor(score: number): string {
  if (score >= 75) return "#4caf50";
  if (score >= 60) return "#8bc34a";
  if (score >= 45) return "#ff9800";
  if (score >= 30) return "#ff5722";
  return "#f44336";
}
