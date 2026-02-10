"use client";

import { useState } from "react";
import styles from "./ZwdsChart.module.css";
import type { ZwdsChartData, ZwdsPalace, ZwdsStar } from "../lib/zwds-api";

// ============================================================
// Types
// ============================================================

interface ZwdsChartProps {
  data: ZwdsChartData;
  name?: string;
  birthDate?: string;
  birthTime?: string;
}

// ============================================================
// Constants
// ============================================================

/** Traditional ZWDS palace grid layout (4×3).
 *  Array index = earthly branch index (0=子 through 11=亥).
 *  Grid positions: top row L→R, then sides, then bottom row L→R.
 *
 *  ┌────┬────┬────┬────┐
 *  │ 巳4│ 午5│ 未6│ 申7│  row 0 (top)
 *  ├────┼────┴────┼────┤
 *  │ 辰3│        │ 酉8│  row 1 (middle)
 *  ├────┤ center  ├────┤
 *  │ 卯2│        │ 戌9│  row 2 (middle)
 *  ├────┼────┬────┼────┤
 *  │ 寅1│ 丑0│ 子11│ 亥10│  row 3 (bottom) — note: 子=index 11 here, 丑=index 0
 *  └────┴────┴────┴────┘
 *
 *  Wait — iztro palace index 0-11 maps to the ORDER of palaces as placed,
 *  not earthly branches. The earthlyBranch field tells us which branch each
 *  palace sits at. We need to map by earthlyBranch to the grid position.
 */

const BRANCH_ORDER = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

/** Grid position for each earthly branch in the 4×3 ZWDS layout.
 *  [row, col] where row 0 = top, col 0 = left. */
const BRANCH_GRID_POS: Record<string, [number, number]> = {
  "巳": [0, 0], "午": [0, 1], "未": [0, 2], "申": [0, 3],
  "辰": [1, 0],                               "酉": [1, 3],
  "卯": [2, 0],                               "戌": [2, 3],
  "寅": [3, 0], "丑": [3, 1], "子": [3, 2], "亥": [3, 3],
};

/** Brightness display: higher brightness → more opaque */
const BRIGHTNESS_OPACITY: Record<string, number> = {
  "廟": 1.0,
  "旺": 0.95,
  "得": 0.85,
  "利": 0.75,
  "平": 0.65,
  "不": 0.5,
  "陷": 0.4,
};

/** Mutagen colors */
const MUTAGEN_COLORS: Record<string, string> = {
  "祿": "#4CAF50", // Green
  "權": "#F44336", // Red
  "科": "#2196F3", // Blue
  "忌": "#9C27B0", // Purple
};

// ============================================================
// Helpers
// ============================================================

function getBrightnessOpacity(brightness?: string): number {
  if (!brightness) return 0.7;
  return BRIGHTNESS_OPACITY[brightness] ?? 0.7;
}

function getMutagenColor(mutagen?: string): string | undefined {
  if (!mutagen) return undefined;
  return MUTAGEN_COLORS[mutagen];
}

/** Build a map of earthlyBranch → palace for quick grid lookup */
function buildPalaceMap(palaces: ZwdsPalace[]): Map<string, ZwdsPalace> {
  const map = new Map<string, ZwdsPalace>();
  for (const p of palaces) {
    map.set(p.earthlyBranch, p);
  }
  return map;
}

// ============================================================
// Sub-components
// ============================================================

function StarBadge({ star, compact }: { star: ZwdsStar; compact?: boolean }) {
  const opacity = getBrightnessOpacity(star.brightness);
  const mutagenColor = getMutagenColor(star.mutagen);
  const isMajor = star.type === "major";

  return (
    <span
      className={compact ? styles.starCompact : (isMajor ? styles.starMajor : styles.starMinor)}
      style={{ opacity }}
      title={`${star.name}${star.brightness ? ` (${star.brightness})` : ""}${star.mutagen ? ` 化${star.mutagen}` : ""}`}
    >
      {star.name}
      {star.brightness && (
        <span className={styles.brightnessBadge}>{star.brightness}</span>
      )}
      {mutagenColor && (
        <span className={styles.mutagenDot} style={{ background: mutagenColor }} />
      )}
    </span>
  );
}

function PalaceCell({
  palace,
  isSelected,
  onSelect,
  currentDecadalBranch,
}: {
  palace: ZwdsPalace;
  isSelected: boolean;
  onSelect: () => void;
  currentDecadalBranch?: string;
}) {
  const isCurrentDecadal = currentDecadalBranch === palace.earthlyBranch;

  return (
    <button
      className={`${styles.palaceCell} ${isSelected ? styles.palaceCellSelected : ""} ${isCurrentDecadal ? styles.palaceCellDecadal : ""} ${palace.isBodyPalace ? styles.palaceCellBody : ""}`}
      onClick={onSelect}
      type="button"
    >
      {/* Palace name + branch */}
      <div className={styles.palaceHeader}>
        <span className={styles.palaceName}>{palace.name}</span>
        <span className={styles.palaceBranch}>
          {palace.heavenlyStem}{palace.earthlyBranch}
        </span>
      </div>

      {/* Major stars */}
      <div className={styles.palaceStars}>
        {palace.majorStars.map((s, i) => (
          <StarBadge key={`m${i}`} star={s} compact />
        ))}
      </div>

      {/* Minor stars (abbreviated) */}
      {palace.minorStars.length > 0 && (
        <div className={styles.palaceMinorStars}>
          {palace.minorStars.slice(0, 4).map((s, i) => (
            <StarBadge key={`n${i}`} star={s} compact />
          ))}
          {palace.minorStars.length > 4 && (
            <span className={styles.moreStars}>+{palace.minorStars.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer: 大限 age range + body palace badge */}
      <div className={styles.palaceFooter}>
        <span className={styles.decadalAge}>
          {palace.decadal.startAge}–{palace.decadal.endAge}
        </span>
        {palace.isBodyPalace && (
          <span className={styles.bodyBadge}>身</span>
        )}
      </div>
    </button>
  );
}

// ============================================================
// Main Component
// ============================================================

export default function ZwdsChart({ data, name, birthDate, birthTime }: ZwdsChartProps) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const palaceMap = buildPalaceMap(data.palaces);

  // Determine current decadal branch (from horoscope data if available)
  const currentDecadalBranch = data.horoscope?.decadal?.branch;

  // Selected palace for detail view
  const selectedPalace = selectedBranch ? palaceMap.get(selectedBranch) : null;

  // Grid rows
  const gridRows = [
    ["巳", "午", "未", "申"],   // top
    ["辰", null, null, "酉"],   // middle-top
    ["卯", null, null, "戌"],   // middle-bottom
    ["寅", "丑", "子", "亥"],   // bottom
  ];

  return (
    <div className={styles.chartContainer}>
      {/* Profile Header */}
      <div className={styles.profileHeader}>
        {name && <div className={styles.profileName}>{name} 的紫微命盤</div>}
        <div className={styles.profileDates}>
          {birthDate && <>公曆：{birthDate} {birthTime}</>}
          {data.lunarDate && <><br />農曆：{data.lunarDate}</>}
        </div>
        <div className={styles.profileMeta}>
          <span className={styles.metaTag}>五行局：{data.fiveElementsClass}</span>
          <span className={styles.metaTag}>命主：{data.soulStar}</span>
          <span className={styles.metaTag}>身主：{data.bodyStar}</span>
          <span className={styles.metaTag}>{data.zodiac}</span>
        </div>
      </div>

      {/* Palace Grid (4×3 + center) */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>十二宮位</h3>
        <div className={styles.palaceGrid}>
          {gridRows.map((row, rowIdx) =>
            row.map((branch, colIdx) => {
              // Center cells (row 1-2, col 1-2)
              if (branch === null) {
                if (rowIdx === 1 && colIdx === 1) {
                  // Render center panel spanning 2×2
                  return (
                    <div key="center" className={styles.centerPanel}>
                      <div className={styles.centerTitle}>紫微斗數命盤</div>
                      <div className={styles.centerInfo}>
                        <div>{data.chineseDate || data.lunarDate}</div>
                        <div>{data.birthTime}（{data.timeRange}）</div>
                        <div>{data.gender === "male" ? "男命" : "女命"}</div>
                        <div className={styles.centerFiveEl}>{data.fiveElementsClass}</div>
                      </div>
                    </div>
                  );
                }
                // Other center cells are covered by the span
                return null;
              }

              const palace = palaceMap.get(branch);
              if (!palace) return <div key={`${rowIdx}-${colIdx}`} className={styles.palaceEmpty} />;

              return (
                <PalaceCell
                  key={branch}
                  palace={palace}
                  isSelected={selectedBranch === branch}
                  onSelect={() => setSelectedBranch(selectedBranch === branch ? null : branch)}
                  currentDecadalBranch={currentDecadalBranch}
                />
              );
            }),
          )}
        </div>
      </div>

      {/* Mutagen Legend */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>四化標示</h3>
        <div className={styles.legendRow}>
          {Object.entries(MUTAGEN_COLORS).map(([key, color]) => (
            <span key={key} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: color }} />
              化{key}
            </span>
          ))}
        </div>
        <div className={styles.legendRow} style={{ marginTop: "0.5rem" }}>
          <span className={styles.legendItem}>
            <span className={styles.legendSample} style={{ opacity: 1.0 }}>廟</span>
            最旺
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendSample} style={{ opacity: 0.65 }}>平</span>
            平勢
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendSample} style={{ opacity: 0.4 }}>陷</span>
            最弱
          </span>
        </div>
      </div>

      {/* Selected Palace Detail */}
      {selectedPalace && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            {selectedPalace.name} — {selectedPalace.heavenlyStem}{selectedPalace.earthlyBranch}
            {selectedPalace.isBodyPalace && <span className={styles.bodyBadgeInline}>身宮</span>}
          </h3>

          {/* Major Stars */}
          {selectedPalace.majorStars.length > 0 && (
            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>主星</div>
              <div className={styles.detailStars}>
                {selectedPalace.majorStars.map((s, i) => (
                  <StarBadge key={i} star={s} />
                ))}
              </div>
            </div>
          )}

          {/* Minor Stars */}
          {selectedPalace.minorStars.length > 0 && (
            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>輔星</div>
              <div className={styles.detailStars}>
                {selectedPalace.minorStars.map((s, i) => (
                  <StarBadge key={i} star={s} />
                ))}
              </div>
            </div>
          )}

          {/* Adjective Stars */}
          {selectedPalace.adjectiveStars.length > 0 && (
            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>雜曜</div>
              <div className={styles.detailStars}>
                {selectedPalace.adjectiveStars.map((s, i) => (
                  <StarBadge key={i} star={{ ...s, type: "adjective" }} />
                ))}
              </div>
            </div>
          )}

          {/* 十二長生 */}
          <div className={styles.detailGroup}>
            <div className={styles.detailLabel}>長生</div>
            <div className={styles.detailValue}>{selectedPalace.changsheng12}</div>
          </div>

          {/* 大限 */}
          <div className={styles.detailGroup}>
            <div className={styles.detailLabel}>大限</div>
            <div className={styles.detailValue}>
              {selectedPalace.decadal.startAge}–{selectedPalace.decadal.endAge}歲
              （{selectedPalace.decadal.stem}{selectedPalace.decadal.branch}）
            </div>
          </div>

          {/* Ages in this palace */}
          {selectedPalace.ages.length > 0 && (
            <div className={styles.detailGroup}>
              <div className={styles.detailLabel}>虛歲</div>
              <div className={styles.detailValue}>
                {selectedPalace.ages.join("、")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Horoscope (if available) */}
      {data.horoscope && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>運限資料</h3>
          <div className={styles.horoscopeGrid}>
            <div className={styles.horoscopeCard}>
              <div className={styles.horoscopeLabel}>大限</div>
              <div className={styles.horoscopeValue}>
                {data.horoscope.decadal.stem}{data.horoscope.decadal.branch}
              </div>
              {data.horoscope.decadal.mutagen.length > 0 && (
                <div className={styles.horoscopeMutagen}>
                  四化：{data.horoscope.decadal.mutagen.join("、")}
                </div>
              )}
            </div>
            <div className={styles.horoscopeCard}>
              <div className={styles.horoscopeLabel}>流年</div>
              <div className={styles.horoscopeValue}>
                {data.horoscope.yearly.stem}{data.horoscope.yearly.branch}
              </div>
              {data.horoscope.yearly.mutagen.length > 0 && (
                <div className={styles.horoscopeMutagen}>
                  四化：{data.horoscope.yearly.mutagen.join("、")}
                </div>
              )}
            </div>
            {data.horoscope.monthly && (
              <div className={styles.horoscopeCard}>
                <div className={styles.horoscopeLabel}>流月</div>
                <div className={styles.horoscopeValue}>
                  {data.horoscope.monthly.stem}{data.horoscope.monthly.branch}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* All Palaces Summary Table */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>十二宮主星一覽</h3>
        <div className={styles.summaryTable}>
          {data.palaces.map((palace) => (
            <button
              key={palace.index}
              className={`${styles.summaryRow} ${selectedBranch === palace.earthlyBranch ? styles.summaryRowActive : ""}`}
              onClick={() => setSelectedBranch(selectedBranch === palace.earthlyBranch ? null : palace.earthlyBranch)}
              type="button"
            >
              <span className={styles.summaryPalace}>
                {palace.name}
                {palace.isBodyPalace && <span className={styles.bodyDot} />}
              </span>
              <span className={styles.summaryStemBranch}>
                {palace.heavenlyStem}{palace.earthlyBranch}
              </span>
              <span className={styles.summaryStarList}>
                {palace.majorStars.map((s) => s.name).join("、") || "—"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
