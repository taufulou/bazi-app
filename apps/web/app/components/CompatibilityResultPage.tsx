"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import CompatibilityRadarChart from "./CompatibilityRadarChart";
import AIReadingDisplay from "./AIReadingDisplay";
import type {
  CompatibilityResponse,
  CompatibilityCalculationData,
  KnockoutCondition,
  AIReadingData,
} from "../lib/readings-api";
import styles from "./CompatibilityResultPage.module.css";

// ============================================================
// Types
// ============================================================

interface CompatibilityResultPageProps {
  data: CompatibilityResponse;
  aiData: AIReadingData | null;
  isSubscriber: boolean;
  onNewComparison: () => void;
  onRecalculate?: () => void;
  isRecalculating?: boolean;
  isAILoading?: boolean;
}

// ============================================================
// Finding Formatters
// ============================================================

/** Role labels for yongshen (用神互補) findings */
const ROLE_LABELS: Record<string, string> = {
  usefulGod: "用神",
  favorableGod: "喜神",
  tabooGod: "忌神",
  enemyGod: "仇神",
  leisureGod: "閒神",
};

/** Significance labels */
const SIGNIFICANCE_LABELS: Record<string, string> = {
  high: "⚠️ 高",
  medium: "💡 中",
  low: "📝 低",
};

/** Quality labels */
const QUALITY_LABELS: Record<string, string> = {
  beneficial: "✅ 有利",
  harmful: "⚠️ 不利",
  neutral: "➖ 中性",
};

/** Pillar position labels */
const PILLAR_LABELS: Record<string, string> = {
  year: "年柱",
  month: "月柱",
  day: "日柱",
  hour: "時柱",
};

/** Effect labels for pillar interactions */
const EFFECT_LABELS: Record<string, string> = {
  positive: "✅ 有利",
  negative: "⚠️ 不利",
  neutral: "➖ 中性",
};

/** Ten god cross direction labels */
const TEN_GOD_DIRECTION: Record<string, string> = {
  a_in_b: "你在對方命盤為",
  b_in_a: "對方在你命盤為",
};

/** Format a single finding object into readable Chinese text */
function formatFinding(finding: Record<string, unknown>): string {
  // Yongshen findings: { element, roleA, roleB, score, significance }
  if ("roleA" in finding && "roleB" in finding && "element" in finding) {
    const el = String(finding.element);
    const roleA = ROLE_LABELS[String(finding.roleA)] || String(finding.roleA);
    const roleB = ROLE_LABELS[String(finding.roleB)] || String(finding.roleB);
    const score = Number(finding.score);
    const sig = SIGNIFICANCE_LABELS[String(finding.significance)] || "";
    const sign = score > 0 ? "+" : "";
    return `${el}：你的${roleA} ↔ 對方的${roleB}（${sign}${score}分）${sig}`;
  }

  // Ten god cross findings: { type: "a_in_b"|"b_in_a", tenGod, score }
  if ("tenGod" in finding && "type" in finding) {
    const dir = TEN_GOD_DIRECTION[String(finding.type)] || String(finding.type);
    const tenGod = String(finding.tenGod);
    const score = Number(finding.score);
    const sign = score > 0 ? "+" : "";
    return `${dir}${tenGod}（${sign}${score}分）`;
  }

  // Pillar / branch findings with detail: { type, detail, effect?, pillarA?, pillarB?, ... }
  if ("type" in finding && "detail" in finding) {
    let text = `${finding.type}：${finding.detail}`;
    // Show pillar positions if available
    if ("pillarA" in finding && "pillarB" in finding) {
      const pA = PILLAR_LABELS[String(finding.pillarA)] || String(finding.pillarA);
      const pB = PILLAR_LABELS[String(finding.pillarB)] || String(finding.pillarB);
      text += `（${pA} ↔ ${pB}）`;
    }
    if ("combinationName" in finding) {
      text += `（${finding.combinationName}）`;
    }
    if ("resultElement" in finding) {
      text += `→ ${finding.resultElement}`;
    }
    if ("effect" in finding) {
      const e = EFFECT_LABELS[String(finding.effect)] || String(finding.effect);
      text += ` ${e}`;
    }
    if ("quality" in finding) {
      const q = QUALITY_LABELS[String(finding.quality)] || String(finding.quality);
      text += ` ${q}`;
    }
    if ("huaHuaQuality" in finding && !("quality" in finding)) {
      const q = QUALITY_LABELS[String(finding.huaHuaQuality)] || String(finding.huaHuaQuality);
      text += ` ${q}`;
    }
    return text;
  }

  // Shen Sha / type-only findings: { type: "紅鸞天喜同步" } — no detail
  if ("type" in finding && Object.keys(finding).length <= 2) {
    return String(finding.type);
  }

  // Description-based findings: { description, impact, ... }
  if ("description" in finding) {
    let text = String(finding.description);
    if ("impact" in finding) {
      const impact = Number(finding.impact);
      const sign = impact > 0 ? "+" : "";
      text += `（${sign}${impact}分）`;
    }
    return text;
  }

  // Generic fallback with type: show type plus other fields
  if ("type" in finding) {
    const rest = Object.entries(finding)
      .filter(([k]) => k !== "type")
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("，");
    return rest ? `${finding.type}：${rest}` : String(finding.type);
  }

  // Last resort: join all key=value pairs
  return Object.entries(finding)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("，");
}

// ============================================================
// Constants
// ============================================================

/** Map technical dimension keys to user-facing labels. */
const DIMENSION_LABELS: Record<string, string> = {
  yongshenComplementarity: "用神互補",
  elementComplementarity: "五行互補",
  dayStemRelationship: "日主關係",
  spousePalace: "婚姻宮互動",
  tenGodCross: "十神交叉",
  fullPillarInteraction: "柱位互動",
  shenShaInteraction: "神煞互動",
  luckPeriodSync: "大運同步",
};

/** Ordered dimension keys for display. */
const DIMENSION_ORDER = [
  "yongshenComplementarity",
  "elementComplementarity",
  "dayStemRelationship",
  "spousePalace",
  "tenGodCross",
  "fullPillarInteraction",
  "shenShaInteraction",
  "luckPeriodSync",
];

/** TOC section IDs and labels. */
const TOC_SECTIONS = [
  { id: "score-hero", label: "總分" },
  { id: "knockouts", label: "警示" },
  { id: "dimensions", label: "維度" },
  { id: "timing", label: "時機" },
  { id: "ai-reading", label: "AI解讀" },
  { id: "actions", label: "操作" },
];

/** Comparison type labels. */
const TYPE_LABELS: Record<string, string> = {
  ROMANCE: "感情合盤",
  BUSINESS: "事業合盤",
  FRIENDSHIP: "友誼合盤",
};

/** Score color mapping. */
function getScoreColor(score: number): string {
  if (score >= 85) return "#4caf50";
  if (score >= 70) return "#8bc34a";
  if (score >= 55) return "#ffc107";
  if (score >= 40) return "#ff9800";
  return "#f44336";
}

// ============================================================
// Sub-components
// ============================================================

/** Knockout warning banner. */
function KnockoutWarnings({ knockouts }: { knockouts: KnockoutCondition[] }) {
  if (knockouts.length === 0) return null;

  return (
    <div className={styles.knockoutSection} id="knockouts">
      <h3 className={styles.sectionTitle}>
        <span className={styles.sectionIcon}>⚠️</span>
        重要提醒
      </h3>
      <div className={styles.knockoutList}>
        {knockouts.map((ko, i) => (
          <div
            key={i}
            className={`${styles.knockoutCard} ${
              ko.severity === "critical" ? styles.knockoutCritical : styles.knockoutHigh
            }`}
          >
            <div className={styles.knockoutHeader}>
              <span className={styles.knockoutSeverity}>
                {ko.severity === "critical" ? "🔴" : "🟡"}
              </span>
              <span className={styles.knockoutType}>{ko.type}</span>
              <span className={styles.knockoutImpact}>
                {ko.scoreImpact > 0 ? "-" : ""}{Math.abs(ko.scoreImpact)}分
              </span>
            </div>
            <p className={styles.knockoutDesc}>{ko.description}</p>
            {ko.mitigated && (
              <p className={styles.knockoutMitigated}>
                ✨ 已被天德/月德化解 (原影響: {ko.originalImpact}分)
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dimension score bars. */
function DimensionBars({
  calc,
  accentColor,
}: {
  calc: CompatibilityCalculationData;
  accentColor: string;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className={styles.dimensionSection} id="dimensions">
      <h3 className={styles.sectionTitle}>
        <span className={styles.sectionIcon}>📊</span>
        八維度分析
      </h3>
      <div className={styles.dimensionList}>
        {DIMENSION_ORDER.map((key) => {
          const dim = calc.dimensionScores[key];
          if (!dim) return null;
          const score = Math.round(dim.amplifiedScore);
          const isExpanded = expandedKey === key;

          return (
            <div key={key} className={styles.dimensionItem}>
              <button
                className={styles.dimensionHeader}
                onClick={() => setExpandedKey(isExpanded ? null : key)}
                type="button"
              >
                <span className={styles.dimLabel}>
                  {DIMENSION_LABELS[key] || key}
                </span>
                <div className={styles.dimBarWrap}>
                  <div
                    className={styles.dimBar}
                    style={{
                      width: `${score}%`,
                      background: accentColor,
                    }}
                  />
                </div>
                <span
                  className={styles.dimScore}
                  style={{ color: accentColor }}
                >
                  {score}
                </span>
                <span
                  className={`${styles.dimChevron} ${isExpanded ? styles.dimChevronOpen : ""}`}
                >
                  ▾
                </span>
              </button>
              {isExpanded && dim.findings && dim.findings.length > 0 && (
                <div className={styles.dimFindings}>
                  {dim.findings.map((finding, fi) => (
                    <div key={fi} className={styles.findingItem}>
                      <span className={styles.findingText}>
                        {formatFinding(finding as Record<string, unknown>)}
                      </span>
                    </div>
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

/** Timing sync section (golden years + challenge years). */
function TimingSection({
  timing,
}: {
  timing: CompatibilityCalculationData["timingSync"];
}) {
  const goldenYears = timing?.goldenYears || [];
  const challengeYears = timing?.challengeYears || [];
  const luckScore = timing?.luckCycleSyncScore ?? 0;

  return (
    <div className={styles.timingSection} id="timing">
      <h3 className={styles.sectionTitle}>
        <span className={styles.sectionIcon}>📅</span>
        時運同步
      </h3>

      <div className={styles.timingGrid}>
        {/* Golden years */}
        <div className={styles.timingCard}>
          <h4 className={styles.timingCardTitle}>
            <span>🌟</span> 黃金年份
          </h4>
          {goldenYears.length > 0 ? (
            <ul className={styles.timingList}>
              {goldenYears.map((gy, i) => (
                <li key={i} className={styles.timingItem}>
                  <span className={styles.timingYear}>{gy.year}</span>
                  <span className={styles.timingReason}>{gy.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.timingEmpty}>暫無特別利好年份</p>
          )}
        </div>

        {/* Challenge years */}
        <div className={styles.timingCard}>
          <h4 className={styles.timingCardTitle}>
            <span>⚡</span> 注意年份
          </h4>
          {challengeYears.length > 0 ? (
            <ul className={styles.timingList}>
              {challengeYears.map((cy, i) => (
                <li key={i} className={styles.timingItem}>
                  <span className={styles.timingYear}>{cy.year}</span>
                  <span className={styles.timingReason}>{cy.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.timingEmpty}>暫無特別警示年份</p>
          )}
        </div>
      </div>

      <div className={styles.luckSyncScore}>
        大運同步度：
        <span className={styles.luckSyncValue}>
          {Math.round(luckScore)}%
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export default function CompatibilityResultPage({
  data,
  aiData,
  isSubscriber,
  onNewComparison,
  onRecalculate,
  isRecalculating = false,
  isAILoading = false,
}: CompatibilityResultPageProps) {
  const { calculationData: calc } = data;
  const [activeSection, setActiveSection] = useState("score-hero");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Comparison type accent color
  const accentColor = useMemo(() => {
    switch (data.comparisonType) {
      case "ROMANCE": return "#e91e63";
      case "BUSINESS": return "#2196f3";
      case "FRIENDSHIP": return "#4caf50";
      default: return "#e8d5b7";
    }
  }, [data.comparisonType]);

  // Intersection Observer for sticky TOC
  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    TOC_SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setActiveSection(id);
            }
          });
        },
        { rootMargin: "-20% 0px -60% 0px" },
      );

      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const adjustedScore = calc.adjustedScore ?? calc.overallScore ?? 0;
  const scoreColor = getScoreColor(adjustedScore);

  // Share handler
  const handleShare = useCallback(async () => {
    const shareUrl = `${window.location.origin}/reading/compatibility?id=${data.id}`;
    const shareTitle = `八字合盤：${adjustedScore}分 — ${calc.label || ""}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
      } catch {
        /* cancelled */
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      // Could show a toast here
    }
  }, [data.id, adjustedScore, calc.label]);

  // Filter TOC sections: hide knockouts if none exist
  const knockouts = calc.knockoutConditions || [];
  const visibleTocSections = TOC_SECTIONS.filter((s) => {
    if (s.id === "knockouts" && knockouts.length === 0) return false;
    return true;
  });

  return (
    <div
      className={styles.resultContainer}
      data-comparison-type={data.comparisonType.toLowerCase()}
    >
      {/* Sticky TOC — Desktop: sidebar, Mobile: horizontal pills */}
      <nav className={styles.tocNav}>
        <div className={styles.tocInner}>
          {visibleTocSections.map((s) => (
            <button
              key={s.id}
              className={`${styles.tocItem} ${
                activeSection === s.id ? styles.tocItemActive : ""
              }`}
              onClick={() => scrollToSection(s.id)}
              type="button"
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <div className={styles.mainContent}>
        {/* Score Hero Section */}
        <section className={styles.scoreHero} id="score-hero">
          <div className={styles.heroTop}>
            {/* Score + Info */}
            <div className={styles.heroScore}>
              {/* Type badge */}
              <span
                className={styles.typeBadge}
                style={{
                  color: accentColor,
                  borderColor: accentColor,
                  background: `${accentColor}15`,
                }}
              >
                {TYPE_LABELS[data.comparisonType] || data.comparisonType}
              </span>

              {/* Analysis year */}
              {data.lastCalculatedYear && (
                <span className={styles.yearTag}>
                  分析年份：{data.lastCalculatedYear}年
                </span>
              )}

              {/* Names */}
              {data.profileA && data.profileB && (
                <div className={styles.namesPair}>
                  <span className={styles.nameA}>{data.profileA.name}</span>
                  <span className={styles.namesLink}>×</span>
                  <span className={styles.nameB}>{data.profileB.name}</span>
                </div>
              )}

              {/* Score circle */}
              <div className={styles.scoreCircle}>
                <span className={styles.scoreNum} style={{ color: scoreColor }}>
                  {adjustedScore}
                </span>
                <span className={styles.scoreLabel}>分</span>
              </div>

              {/* Label */}
              <h2 className={styles.resultLabel} style={{ color: accentColor }}>
                {calc.label}
              </h2>

              {/* Special label */}
              {calc.specialLabel && (
                <div className={styles.specialBadge}>
                  ✨ {calc.specialLabel}
                </div>
              )}

              {/* Description */}
              <p className={styles.labelDesc}>{calc.labelDescription}</p>
            </div>

            {/* Radar chart — only if dimension scores are available */}
            {calc.dimensionScores && (
              <div className={styles.heroChart}>
                <CompatibilityRadarChart
                  dimensionScores={calc.dimensionScores}
                  comparisonType={data.comparisonType}
                  size={280}
                />
              </div>
            )}
          </div>
        </section>

        {/* Annual Update Banner */}
        {data.lastCalculatedYear != null &&
          data.lastCalculatedYear < new Date().getFullYear() &&
          onRecalculate && (
          <div className={styles.updateBanner}>
            <div className={styles.updateBannerContent}>
              <span className={styles.updateBannerIcon}>🔄</span>
              <div className={styles.updateBannerText}>
                <strong>時運分析可更新</strong>
                <span>
                  此分析基於 {data.lastCalculatedYear} 年，
                  可更新至 {new Date().getFullYear()} 年（1 點）
                </span>
              </div>
            </div>
            <button
              className={styles.updateBannerBtn}
              onClick={onRecalculate}
              disabled={isRecalculating}
              type="button"
            >
              {isRecalculating ? "更新中..." : "立即更新"}
            </button>
          </div>
        )}

        {/* Knockout Warnings */}
        <KnockoutWarnings knockouts={knockouts} />

        {/* Dimension Bars */}
        {calc.dimensionScores && <DimensionBars calc={calc} accentColor={accentColor} />}

        {/* Timing Section */}
        {calc.timingSync && <TimingSection timing={calc.timingSync} />}

        {/* AI Reading Sections */}
        <section id="ai-reading">
          <AIReadingDisplay
            data={aiData}
            readingType="compatibility"
            isSubscriber={isSubscriber}
            isLoading={isAILoading}
          />
        </section>

        {/* Actions */}
        <section className={styles.actionsSection} id="actions">
          <div className={styles.actionButtons}>
            <button
              className={styles.shareBtn}
              onClick={handleShare}
              type="button"
            >
              📤 分享結果
            </button>
            <button
              className={styles.newBtn}
              onClick={onNewComparison}
              type="button"
            >
              🔄 再次合盤
            </button>
          </div>

          {/* Entertainment disclaimer */}
          <p className={styles.disclaimer}>
            本服務僅供參考與娛樂用途，不構成任何專業建議
          </p>
        </section>
      </div>
    </div>
  );
}
