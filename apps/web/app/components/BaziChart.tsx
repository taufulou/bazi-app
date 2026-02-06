"use client";

import styles from "./BaziChart.module.css";
import { ELEMENT_COLORS } from "@repo/shared";

// ============================================================
// Types (matching Python engine output)
// ============================================================

interface PillarData {
  stem: string;
  branch: string;
  stemElement: string;
  branchElement: string;
  hiddenStems: string[];
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
}

// ============================================================
// Helper
// ============================================================

function getElementColor(element: string): string {
  return (ELEMENT_COLORS as Record<string, string>)[element] || "#e0e0e0";
}

const STRENGTH_LABELS: Record<string, string> = {
  very_weak: "極弱",
  weak: "偏弱",
  neutral: "中和",
  strong: "偏強",
  very_strong: "極強",
};

// ============================================================
// Component
// ============================================================

export default function BaziChart({ data, name, birthDate, birthTime }: BaziChartProps) {
  const { fourPillars: fp, dayMaster: dm, lunarDate, trueSolarTime } = data;
  const pillars = [
    { key: "hour", label: "時柱", data: fp.hour },
    { key: "day", label: "日柱", data: fp.day },
    { key: "month", label: "月柱", data: fp.month },
    { key: "year", label: "年柱", data: fp.year },
  ];

  return (
    <div className={styles.chartContainer}>
      {/* Profile Header */}
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

      {/* Four Pillars Table */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>四柱排盤</h3>
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
              <td className={styles.pillarLabel}>主星</td>
              {pillars.map((p) => (
                <td key={p.key} className={styles.tenGodCell}>
                  {p.data.tenGod || "—"}
                </td>
              ))}
            </tr>
            {/* Heavenly Stems */}
            <tr>
              <td className={styles.pillarLabel}>天干</td>
              {pillars.map((p) => (
                <td
                  key={p.key}
                  className={styles.stemCell}
                  style={{ color: getElementColor(p.data.stemElement) }}
                >
                  {p.data.stem}
                </td>
              ))}
            </tr>
            {/* Earthly Branches */}
            <tr>
              <td className={styles.pillarLabel}>地支</td>
              {pillars.map((p) => (
                <td
                  key={p.key}
                  className={styles.branchCell}
                  style={{ color: getElementColor(p.data.branchElement) }}
                >
                  {p.data.branch}
                </td>
              ))}
            </tr>
            {/* Hidden Stems */}
            <tr>
              <td className={styles.pillarLabel}>藏干</td>
              {pillars.map((p) => (
                <td key={p.key} className={styles.hiddenStemsCell}>
                  {p.data.hiddenStems.map((hs, i) => (
                    <span
                      key={i}
                      className={styles.hiddenStem}
                      style={{
                        color: getElementColor(
                          getHiddenStemElement(hs),
                        ),
                        opacity: i === 0 ? 1 : 0.7,
                      }}
                    >
                      {hs}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
            {/* Na Yin */}
            <tr>
              <td className={styles.pillarLabel}>納音</td>
              {pillars.map((p) => (
                <td key={p.key} className={styles.nayinCell}>
                  {p.data.naYin}
                </td>
              ))}
            </tr>
            {/* Life Stage */}
            {fp.year.lifeStage && (
              <tr>
                <td className={styles.pillarLabel}>長生</td>
                {pillars.map((p) => (
                  <td key={p.key} className={styles.lifeStageCell}>
                    {p.data.lifeStage || "—"}
                  </td>
                ))}
              </tr>
            )}
            {/* Shen Sha per pillar */}
            <tr>
              <td className={styles.pillarLabel}>神煞</td>
              {pillars.map((p) => (
                <td key={p.key} className={styles.shenShaCell}>
                  {p.data.shenSha.length > 0
                    ? p.data.shenSha.join("、")
                    : "—"}
                </td>
              ))}
            </tr>
            {/* Day Master badge */}
            <tr>
              <td></td>
              {pillars.map((p) => (
                <td key={p.key}>
                  {p.key === "day" && (
                    <span className={styles.dayMasterBadge}>日主</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Five Elements Balance */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>五行能量</h3>
        <div className={styles.elementsGrid}>
          {(["木", "火", "土", "金", "水"] as const).map((element) => {
            const pct = data.fiveElementsBalanceZh[element] || 0;
            const color = getElementColor(element);
            return (
              <div key={element} className={styles.elementBar}>
                <div
                  className={styles.elementCircle}
                  style={{
                    background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
                    border: `2px solid ${color}`,
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>{element}</span>
                </div>
                <div className={styles.elementPercent}>
                  {pct.toFixed(1)}%
                </div>
                <div className={styles.elementName}>
                  {ELEMENT_ENGLISH_MAP[element]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day Master Analysis */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>日主分析</h3>
        <div className={styles.dayMasterCard}>
          <div className={styles.dmItem}>
            <span className={styles.dmLabel}>日主</span>
            <span
              className={styles.dmValue}
              style={{ color: getElementColor(dm.element) }}
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

      {/* Luck Periods */}
      {data.luckPeriods.length > 0 && (
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
                      color: getElementColor(
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

      {/* Shen Sha & Kong Wang */}
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
          <p style={{ color: "#a0a0a0", fontSize: "0.9rem" }}>
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

const ELEMENT_ENGLISH_MAP: Record<string, string> = {
  "木": "Wood", "火": "Fire", "土": "Earth", "金": "Metal", "水": "Water",
};

function getStemElement(stem: string): string {
  return STEM_ELEMENT[stem] || "土";
}

function getHiddenStemElement(stem: string): string {
  return STEM_ELEMENT[stem] || "土";
}
