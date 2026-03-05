"use client";

import { useState, useEffect } from "react";
import styles from "./BaziChart.module.css";

// ============================================================
// Types (matching Python engine output)
// ============================================================

interface HiddenStemGod {
  stem: string;
  element: string;
  tenGod: string;
}

interface PillarData {
  stem: string;
  branch: string;
  stemElement: string;
  branchElement: string;
  hiddenStems: string[];
  hiddenStemGods?: HiddenStemGod[];
  tenGod: string | null;
  naYin: string;
  shenSha: string[];
  lifeStage?: string;
}

interface DayMasterData {
  element: string;
  yinYang: string;
  strength: string;
  strengthScore: number;
  pattern: string;
  sameParty: number;
  oppositeParty: number;
  favorableGod: string;
  usefulGod: string;
  idleGod: string;
  tabooGod: string;
  enemyGod: string;
}

interface LuckPeriodData {
  startAge: number;
  endAge: number;
  startYear: number;
  endYear: number;
  stem: string;
  branch: string;
  tenGod: string;
  isCurrent: boolean;
}

interface ShenShaData {
  name: string;
  pillar: string;
  branch: string;
}

interface BaziChartData {
  fourPillars: {
    year: PillarData;
    month: PillarData;
    day: PillarData;
    hour: PillarData;
  };
  dayMaster: DayMasterData;
  dayMasterStem: string;
  fiveElementsBalanceZh: Record<string, number>;
  fiveElementsBalance: Record<string, number>;
  trueSolarTime: {
    clock_time: string;
    true_solar_time: string;
    total_adjustment?: number;
  };
  lunarDate: {
    year: number;
    month: number;
    day: number;
    isLeapMonth: boolean;
  };
  luckPeriods: LuckPeriodData[];
  allShenSha: ShenShaData[];
  kongWang: string[];
  ganZhi?: string;
}

interface BaziChartProps {
  data: BaziChartData;
  name?: string;
  birthDate?: string;
  birthTime?: string;
  visibleSections?: number; // 0-6. undefined = all visible (backwards compatible)
}

// ============================================================
// Helper
// ============================================================

/** Darker element colors for light background (matches design-preview.html) */
const CHART_ELEMENT_COLORS: Record<string, string> = {
  "木": "#2E7D32",
  "火": "#D32F2F",
  "土": "#8D6E63",
  "金": "#B8860B",
  "水": "#1565C0",
};

function getChartElementColor(element: string): string {
  return CHART_ELEMENT_COLORS[element] || "#8D6E63";
}

/** Earthly Branch → Chinese Zodiac Animal */
const BRANCH_ZODIAC: Record<string, string> = {
  "子": "鼠", "丑": "牛", "寅": "虎", "卯": "兔",
  "辰": "龍", "巳": "蛇", "午": "馬", "未": "羊",
  "申": "猴", "酉": "雞", "戌": "狗", "亥": "豬",
};

const STRENGTH_LABELS: Record<string, string> = {
  very_weak: "極弱",
  weak: "偏弱",
  neutral: "中和",
  strong: "偏強",
  very_strong: "極強",
};

// Contextual loading messages for staged reveal (index = visibleSections value)
const REVEAL_MESSAGES: Record<number, string> = {
  1: "正在排列四柱...",
  2: "正在分析五行能量...",
  3: "正在解讀日主強弱...",
  4: "正在推算大運走勢...",
  5: "正在排列神煞...",
};

// SVG ring constants for Five Elements animation
const RING_RADIUS = 28;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// ============================================================
// Component
// ============================================================

export default function BaziChart({ data, name, birthDate, birthTime, visibleSections }: BaziChartProps) {
  const { fourPillars: fp, dayMaster: dm, lunarDate, trueSolarTime } = data;
  const pillars = [
    { key: "hour", label: "時柱", data: fp.hour },
    { key: "day", label: "日柱", data: fp.day },
    { key: "month", label: "月柱", data: fp.month },
    { key: "year", label: "年柱", data: fp.year },
  ];

  // Staged reveal: whether a section at the given index should be visible
  const isVisible = (index: number) =>
    visibleSections === undefined || visibleSections > index;
  const isRevealing = visibleSections !== undefined;

  // Five Elements SVG ring animation trigger
  const [animateElements, setAnimateElements] = useState(false);
  useEffect(() => {
    if (animateElements) return; // Already triggered — don't re-arm
    if (visibleSections === undefined || visibleSections > 2) {
      const t = setTimeout(() => setAnimateElements(true), 100);
      return () => clearTimeout(t);
    }
  }, [visibleSections, animateElements]);

  // Helper: wrap content in reveal animation div when staged reveal is active
  const revealWrap = (content: React.ReactNode) =>
    isRevealing ? <div className={styles.revealSection}>{content}</div> : content;

  return (
    <div className={styles.chartContainer}>
      {/* Section 0: Profile Header */}
      {isVisible(0) && revealWrap(
        <div className={styles.profileHeader}>
          {name && <div className={styles.profileName}>{name} 的八字命盤</div>}
          <div className={styles.profileDates}>
            {birthDate && <>公曆：{birthDate} {birthTime}<br /></>}
            農曆：{lunarDate.year}年{lunarDate.isLeapMonth ? "閏" : ""}
            {lunarDate.month}月{lunarDate.day}日
          </div>
          {trueSolarTime && (
            <div className={styles.solarTimeNote}>
              真太陽時：{trueSolarTime.true_solar_time}
              {trueSolarTime.total_adjustment !== undefined &&
                `（校正 ${trueSolarTime.total_adjustment > 0 ? "+" : ""}${Math.round(trueSolarTime.total_adjustment)}分鐘）`}
            </div>
          )}
        </div>
      )}

      {/* Section 1: Four Pillars Table */}
      {isVisible(1) && revealWrap(
        <div className={styles.pillarsSection}>
          {/* ◆八字命格◆ Gradient Header */}
          <div className={styles.chartHeader}>
            <span className={styles.chartHeaderTitle}>
              <span className={styles.chartHeaderDiamond}>◆</span>
              八字命格
              <span className={styles.chartHeaderDiamond}>◆</span>
            </span>
          </div>
          <table className={styles.pillarsTable}>
            <thead>
              <tr>
                <th></th>
                {pillars.map((p) => (
                  <th key={p.key}>{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Ten Gods row */}
              <tr>
                <td className={styles.pillarLabel}>十神</td>
                {pillars.map((p) => (
                  <td key={p.key} className={styles.tenGodCell}>
                    {p.key === "day" ? "日元" : (p.data.tenGod || "—")}
                  </td>
                ))}
              </tr>
              {/* Combined Heavenly Stems + Earthly Branches */}
              <tr>
                <td className={styles.pillarLabel}>天干<br/>地支</td>
                {pillars.map((p) => (
                  <td key={p.key} className={styles.stemBranchCell}>
                    <div
                      className={styles.stemChar}
                      style={{ color: getChartElementColor(p.data.stemElement) }}
                    >
                      {p.data.stem}
                    </div>
                    <div className={styles.branchWrap}>
                      <span
                        className={styles.branchChar}
                        style={{ color: getChartElementColor(p.data.branchElement) }}
                      >
                        {p.data.branch}
                      </span>
                      <span className={styles.zodiacLabel}>
                        {BRANCH_ZODIAC[p.data.branch] || ""}
                      </span>
                    </div>
                  </td>
                ))}
              </tr>
              {/* Hidden Stems with inline 副星 */}
              <tr>
                <td className={styles.pillarLabel}>藏干</td>
                {pillars.map((p) => (
                  <td key={p.key} className={styles.hiddenStemsCell}>
                    {(p.data.hiddenStemGods || []).length > 0
                      ? p.data.hiddenStemGods!.map((hsg, i) => (
                          <span
                            key={i}
                            className={styles.hiddenStem}
                          >
                            <span style={{
                              color: getChartElementColor(hsg.element || STEM_ELEMENT[hsg.stem] || "土"),
                              opacity: i === 0 ? 1 : 0.7,
                            }}>
                              {hsg.stem}{hsg.element || STEM_ELEMENT[hsg.stem]}
                            </span>
                            <span className={styles.hiddenStemGod}>（{hsg.tenGod}）</span>
                          </span>
                        ))
                      : (p.data.hiddenStems || []).map((hs, i) => (
                          <span
                            key={i}
                            className={styles.hiddenStem}
                            style={{
                              color: getChartElementColor(getHiddenStemElement(hs)),
                              opacity: i === 0 ? 1 : 0.7,
                            }}
                          >
                            {hs}{STEM_ELEMENT[hs]}
                          </span>
                        ))
                    }
                  </td>
                ))}
              </tr>
              {/* Life Stage (十二運) */}
              {fp.year.lifeStage && (
                <tr>
                  <td className={styles.pillarLabel}>十二運</td>
                  {pillars.map((p) => (
                    <td key={p.key} className={styles.lifeStageCell}>
                      {p.data.lifeStage || "—"}
                    </td>
                  ))}
                </tr>
              )}
              {/* Na Yin */}
              <tr>
                <td className={styles.pillarLabel}>納音</td>
                {pillars.map((p) => (
                  <td key={p.key} className={styles.nayinCell}>
                    {p.data.naYin}
                  </td>
                ))}
              </tr>
              {/* Shen Sha per pillar */}
              <tr>
                <td className={styles.pillarLabel}>神煞</td>
                {pillars.map((p) => (
                  <td key={p.key} className={styles.shenShaCell}>
                    {p.data.shenSha.length > 0
                      ? p.data.shenSha.map((sha, i) => (
                          <span key={i} className={styles.shenShaItem}>{sha}</span>
                        ))
                      : "—"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Section 2: Five Elements Balance (SVG Ring Animation) */}
      {isVisible(2) && revealWrap(
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>五行能量</h3>
          <div className={styles.elementsGrid}>
            {(["木", "火", "土", "金", "水"] as const).map((element) => {
              const pct = data.fiveElementsBalanceZh[element] || 0;
              const color = getChartElementColor(element);
              return (
                <div key={element} className={styles.elementBar}>
                  <div className={styles.elementRingWrap}>
                    <svg viewBox="0 0 70 70" className={styles.elementRingSvg}>
                      {/* Background ring */}
                      <circle cx="35" cy="35" r={RING_RADIUS} fill="none"
                        stroke="rgba(0,0,0,0.06)" strokeWidth="4" />
                      {/* Animated progress ring */}
                      <circle cx="35" cy="35" r={RING_RADIUS} fill="none"
                        stroke={color} strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={CIRCUMFERENCE}
                        strokeDashoffset={animateElements ? CIRCUMFERENCE * (1 - pct / 100) : CIRCUMFERENCE}
                        transform="rotate(-90 35 35)"
                        className={styles.elementProgressRing} />
                    </svg>
                    {/* CJK character overlaid — NOT SVG <text> for font consistency on iOS Safari */}
                    <span className={styles.elementRingChar} style={{ color }}>{element}</span>
                  </div>
                  <div className={styles.elementPercent}>
                    {pct.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section 3: Day Master Analysis */}
      {isVisible(3) && revealWrap(
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>日主分析</h3>
          <div className={styles.dayMasterCard}>
            <div className={styles.dmItem}>
              <span className={styles.dmLabel}>日主</span>
              <span
                className={styles.dmValue}
                style={{ color: getChartElementColor(dm.element) }}
              >
                {data.dayMasterStem}（{dm.element}{dm.yinYang}）
              </span>
            </div>
            <div className={styles.dmItem}>
              <span className={styles.dmLabel}>旺衰</span>
              <span className={styles.dmValue}>
                {STRENGTH_LABELS[dm.strength] || dm.strength}
                （{dm.strengthScore}分）
              </span>
            </div>
            <div className={styles.dmItem}>
              <span className={styles.dmLabel}>格局</span>
              <span className={styles.dmValue}>{dm.pattern}</span>
            </div>
            <div className={styles.dmItem}>
              <span className={styles.dmLabel}>陰陽</span>
              <span className={styles.dmValue}>{dm.yinYang}</span>
            </div>

            {/* Strength Bar */}
            <div className={styles.strengthBar}>
              <div className={styles.strengthBarInner}>
                <div
                  className={styles.strengthSame}
                  style={{ width: `${dm.sameParty}%` }}
                >
                  {dm.sameParty}%
                </div>
                <div
                  className={styles.strengthOpposite}
                  style={{ width: `${dm.oppositeParty}%` }}
                >
                  {dm.oppositeParty}%
                </div>
              </div>
              <div className={styles.strengthLabels}>
                <span>同黨（比劫印）</span>
                <span>異黨（食傷財官）</span>
              </div>
            </div>

            {/* Gods */}
            <div className={styles.godsRow}>
              <span className={styles.godTagFavorable}>
                喜神：{dm.favorableGod}
              </span>
              <span className={styles.godTagUseful}>
                用神：{dm.usefulGod}
              </span>
              <span className={styles.godTagIdle}>
                閒神：{dm.idleGod}
              </span>
              <span className={styles.godTagTaboo}>
                忌神：{dm.tabooGod}
              </span>
              <span className={styles.godTagEnemy}>
                仇神：{dm.enemyGod}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Section 4: Luck Periods */}
      {isVisible(4) && data.luckPeriods.length > 0 && revealWrap(
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>大運</h3>
          <div className={styles.timelineScroll}>
            <div className={styles.timelineRow}>
              {data.luckPeriods.map((lp, i) => (
                <div
                  key={i}
                  className={
                    lp.isCurrent
                      ? styles.periodCardCurrent
                      : styles.periodCard
                  }
                >
                  <div className={styles.periodAge}>
                    {lp.startAge}–{lp.endAge}歲
                  </div>
                  <div className={styles.periodYear}>
                    {lp.startYear}–{lp.endYear}
                  </div>
                  <div
                    className={styles.periodStemBranch}
                    style={{
                      color: getChartElementColor(
                        getStemElement(lp.stem),
                      ),
                    }}
                  >
                    {lp.stem}{lp.branch}
                  </div>
                  <div className={styles.periodTenGod}>{lp.tenGod}</div>
                  {lp.isCurrent && (
                    <div className={styles.periodCurrentLabel}>
                      ← 目前
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Section 5: Shen Sha & Kong Wang */}
      {isVisible(5) && revealWrap(
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>神煞</h3>
          {data.allShenSha.length > 0 ? (
            <div className={styles.shenShaList}>
              {data.allShenSha.map((sha, i) => (
                <span key={i} className={styles.shenShaTag}>
                  {sha.name}（{sha.pillar}·{sha.branch}）
                </span>
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              此命盤無特殊神煞
            </p>
          )}

          {data.kongWang && data.kongWang.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <span className={styles.kongWangText}>
                空亡：
                {data.kongWang.map((kw, i) => (
                  <span key={i} className={styles.kongWangBranch}>
                    {kw}
                    {i < data.kongWang.length - 1 ? "、" : ""}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Loading placeholder for next section during staged reveal */}
      {isRevealing && visibleSections! < 6 && (
        <div className={styles.revealPlaceholder} data-reveal-placeholder>
          <span className={styles.revealSpinner} />
          <span className={styles.revealMessage}>{REVEAL_MESSAGES[visibleSections!]}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Helpers for element color lookup
// ============================================================

const STEM_ELEMENT: Record<string, string> = {
  "甲": "木", "乙": "木", "丙": "火", "丁": "火", "戊": "土",
  "己": "土", "庚": "金", "辛": "金", "壬": "水", "癸": "水",
};

function getStemElement(stem: string): string {
  return STEM_ELEMENT[stem] || "土";
}

function getHiddenStemElement(stem: string): string {
  return STEM_ELEMENT[stem] || "土";
}
