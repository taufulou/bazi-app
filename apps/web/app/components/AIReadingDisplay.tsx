"use client";

import Link from "next/link";
import styles from "./AIReadingDisplay.module.css";
import { ENTERTAINMENT_DISCLAIMER } from "@repo/shared";
import type {
  AIReadingData,
  LifetimeV2DeterministicData,
  LuckPeriodDetailData,
} from "../lib/readings-api";

// ============================================================
// Types
// ============================================================

interface AIReadingDisplayProps {
  data: AIReadingData | null;
  readingType: string;
  isSubscriber: boolean;
  isLoading?: boolean;
  isStreaming?: boolean;
}

// ============================================================
// Section theme + icon mapping
// ============================================================

const SECTION_THEMES: Record<string, { icon: string; theme: string }> = {
  personality: { icon: "🧠", theme: "personality" },
  career: { icon: "💼", theme: "career" },
  career_analysis: { icon: "💼", theme: "career" },
  favorable_industries: { icon: "🏢", theme: "career" },
  career_timing: { icon: "📊", theme: "career" },
  love: { icon: "💕", theme: "love" },
  ideal_partner: { icon: "💑", theme: "love" },
  marriage_timing: { icon: "💍", theme: "love" },
  relationship_advice: { icon: "❤️", theme: "love" },
  finance: { icon: "💰", theme: "finance" },
  health: { icon: "🏥", theme: "health" },
  // V2 Lifetime sections
  chart_identity: { icon: "🎴", theme: "personality" },
  finance_pattern: { icon: "💰", theme: "finance" },
  career_pattern: { icon: "💼", theme: "career" },
  boss_strategy: { icon: "🤝", theme: "career" },
  love_pattern: { icon: "💕", theme: "love" },
  children_analysis: { icon: "👶", theme: "family" },
  parents_analysis: { icon: "👨‍👩‍👧", theme: "family" },
  current_period: { icon: "📊", theme: "timing" },
  best_period: { icon: "🌟", theme: "timing" },
  annual_love: { icon: "💕", theme: "love" },
  annual_career: { icon: "💼", theme: "career" },
  annual_finance: { icon: "💰", theme: "finance" },
  annual_health: { icon: "🏥", theme: "health" },
  constitution: { icon: "🫀", theme: "health" },
  wellness_advice: { icon: "🌿", theme: "health" },
  health_timing: { icon: "📅", theme: "health" },
  annual_overview: { icon: "📅", theme: "overview" },
  monthly_forecast: { icon: "🗓️", theme: "overview" },
  key_opportunities: { icon: "⭐", theme: "overview" },
  overall_compatibility: { icon: "🤝", theme: "overview" },
  strengths: { icon: "✨", theme: "overview" },
  challenges: { icon: "⚡", theme: "overview" },
  compatibility_advice: { icon: "💡", theme: "overview" },
  cross_analysis: { icon: "🔄", theme: "personality" },
  timing: { icon: "📅", theme: "overview" },
  // ZWDS sections
  life_pattern: { icon: "🌌", theme: "personality" },
  major_periods: { icon: "🔄", theme: "overview" },
  overall_destiny: { icon: "🌟", theme: "personality" },
  annual_advice: { icon: "💡", theme: "overview" },
  career_palace: { icon: "💼", theme: "career" },
  wealth_palace: { icon: "💰", theme: "finance" },
  career_direction: { icon: "🧭", theme: "career" },
  spouse_palace: { icon: "💕", theme: "love" },
  love_timing: { icon: "💍", theme: "love" },
  health_palace: { icon: "🏥", theme: "health" },
  element_health: { icon: "🔥", theme: "health" },
  health_periods: { icon: "📅", theme: "health" },
  palace_interaction: { icon: "🔗", theme: "overview" },
  star_compatibility: { icon: "⭐", theme: "overview" },
  advice: { icon: "💡", theme: "overview" },
  // ZWDS Monthly sections
  monthly_overview: { icon: "🗓️", theme: "overview" },
  monthly_career: { icon: "💼", theme: "career" },
  monthly_love: { icon: "💕", theme: "love" },
  monthly_health: { icon: "🏥", theme: "health" },
  monthly_advice: { icon: "💡", theme: "overview" },
  // ZWDS Daily section
  daily_fortune: { icon: "☀️", theme: "overview" },
  // ZWDS Major Period sections
  period_overview: { icon: "🔄", theme: "overview" },
  period_career: { icon: "💼", theme: "career" },
  period_relationships: { icon: "💕", theme: "love" },
  period_health: { icon: "🏥", theme: "health" },
  period_strategy: { icon: "🧭", theme: "overview" },
  // ZWDS Q&A sections
  answer: { icon: "💬", theme: "overview" },
  analysis: { icon: "🔍", theme: "personality" },
  // Cross-system sections
  cross_validation: { icon: "🔗", theme: "overview" },
  bazi_perspective: { icon: "📊", theme: "overview" },
  zwds_perspective: { icon: "🌟", theme: "personality" },
  combined_career: { icon: "💼", theme: "career" },
  combined_love: { icon: "💕", theme: "love" },
  synthesis: { icon: "🎯", theme: "overview" },
  // Deep star analysis sections
  pattern_analysis: { icon: "🌌", theme: "personality" },
  palace_deep_dive: { icon: "🏛️", theme: "overview" },
  star_chains: { icon: "⛓️", theme: "overview" },
  mutagen_analysis: { icon: "🔄", theme: "personality" },
  special_formations: { icon: "✨", theme: "overview" },
  life_strategy: { icon: "🎯", theme: "overview" },
};

const SECTION_TITLES_ZH: Record<string, string> = {
  personality: "命格性格分析",
  career: "事業發展分析",
  career_analysis: "事業深度分析",
  favorable_industries: "利於發展的行業",
  career_timing: "事業發展時機",
  love: "感情婚姻分析",
  ideal_partner: "理想伴侶特質",
  marriage_timing: "姻緣時機",
  relationship_advice: "感情建議",
  finance: "一生財運分析",
  health: "先天健康分析",
  // V2 Lifetime sections
  chart_identity: "先天命格解讀",
  finance_pattern: "財運格局解讀",
  career_pattern: "事業格局解讀",
  boss_strategy: "應對上司之道",
  love_pattern: "感情格局解讀",
  children_analysis: "子女分析",
  parents_analysis: "父母情況分析",
  current_period: "當前大運詳解",
  best_period: "有利大運把握",
  annual_love: "本年感情運勢",
  annual_career: "本年事業運勢",
  annual_finance: "本年財運運勢",
  annual_health: "本年健康運勢",
  constitution: "先天體質分析",
  wellness_advice: "養生保健建議",
  health_timing: "健康注意時期",
  annual_overview: "年度總覽",
  monthly_forecast: "每月運勢",
  key_opportunities: "關鍵機遇",
  overall_compatibility: "整體契合度",
  strengths: "優勢互補",
  challenges: "挑戰與磨合",
  compatibility_advice: "相處建議",
  cross_analysis: "十神交叉分析",
  timing: "時運同步度",
  // ZWDS sections
  life_pattern: "人生格局",
  major_periods: "大限運程",
  overall_destiny: "命運總論",
  annual_advice: "流年建議",
  career_palace: "事業宮分析",
  wealth_palace: "財帛宮分析",
  career_direction: "事業方向",
  spouse_palace: "夫妻宮分析",
  love_timing: "桃花姻緣時機",
  health_palace: "疾厄宮分析",
  element_health: "五行健康",
  health_periods: "健康注意時期",
  palace_interaction: "宮位互動",
  star_compatibility: "星曜契合度",
  advice: "綜合建議",
  // ZWDS Monthly sections
  monthly_overview: "本月運勢總覽",
  monthly_career: "本月事業運",
  monthly_love: "本月感情運",
  monthly_health: "本月健康運",
  monthly_advice: "本月行動建議",
  // ZWDS Daily section
  daily_fortune: "今日運勢",
  // ZWDS Major Period sections
  period_overview: "大限總覽",
  period_career: "大限事業運",
  period_relationships: "大限人際關係",
  period_health: "大限健康運",
  period_strategy: "大限發展策略",
  // ZWDS Q&A sections
  answer: "問題解答",
  analysis: "命盤分析",
  // Cross-system sections
  cross_validation: "雙系統交叉驗證",
  bazi_perspective: "八字視角分析",
  zwds_perspective: "紫微視角分析",
  combined_career: "綜合事業分析",
  combined_love: "綜合感情分析",
  synthesis: "雙系統綜合結論",
  // Deep star analysis sections
  pattern_analysis: "格局深度分析",
  palace_deep_dive: "十二宮位深度解讀",
  star_chains: "四化飛星連鎖",
  mutagen_analysis: "四化深度分析",
  special_formations: "特殊格局判定",
  life_strategy: "人生策略建議",
};

// Cross-sell reading types (show other reading types)
const BAZI_CROSS_SELL = [
  { slug: "lifetime", icon: "🌟", name: "八字終身運" },
  { slug: "annual", icon: "📅", name: "八字流年運勢" },
  { slug: "career", icon: "💼", name: "事業財運" },
  { slug: "love", icon: "💕", name: "愛情姻緣" },
  { slug: "health", icon: "🏥", name: "先天健康分析" },
  { slug: "compatibility", icon: "🤝", name: "合盤比較" },
];

const ZWDS_CROSS_SELL = [
  { slug: "zwds-lifetime", icon: "🌟", name: "紫微終身運" },
  { slug: "zwds-annual", icon: "📅", name: "紫微流年運" },
  { slug: "zwds-career", icon: "💼", name: "紫微事業運" },
  { slug: "zwds-love", icon: "💕", name: "紫微愛情運" },
  { slug: "zwds-health", icon: "🏥", name: "紫微健康運" },
  { slug: "zwds-compatibility", icon: "🤝", name: "紫微合盤" },
  { slug: "zwds-monthly", icon: "🗓️", name: "紫微流月運" },
  { slug: "zwds-daily", icon: "☀️", name: "紫微每日運勢" },
  { slug: "zwds-major-period", icon: "🔄", name: "紫微大限分析" },
  { slug: "zwds-qa", icon: "❓", name: "紫微問事" },
];

// ============================================================
// Component
// ============================================================

// ============================================================
// V2 section groups (for inserting deterministic cards between sections)
// ============================================================

/** After which AI section key should we insert the corresponding deterministic card */
const V2_DETERMINISTIC_INSERTIONS: Record<string, string> = {
  finance_pattern: 'investments',    // After 財運格局 → show investment lists
  career_pattern: 'career_data',     // After 事業格局 → show career directions + benefactors
  love_pattern: 'love_data',         // After 感情格局 → show romance years + partner zodiacs
  parents_analysis: 'family_data',   // After 父母分析 → show parent health years
  best_period: 'luck_timeline',      // After 有利大運 → show luck period timeline
};

/** V2 section keys in expected order (for skeleton placeholders during streaming) */
const V2_ALL_SECTION_KEYS = [
  'chart_identity', 'finance_pattern', 'career_pattern', 'boss_strategy',
  'love_pattern', 'health', 'children_analysis', 'parents_analysis',
  'current_period', 'best_period',
  'annual_love', 'annual_career', 'annual_finance', 'annual_health',
];

export default function AIReadingDisplay({
  data,
  readingType,
  isSubscriber,
  isLoading = false,
  isStreaming = false,
}: AIReadingDisplayProps) {
  // During streaming with V2 data: show arrived sections + skeletons for remaining
  const isStreamingWithData = isStreaming && data?.isV2 && data.deterministic != null;

  if (isLoading && !isStreamingWithData) {
    return <LoadingSkeleton />;
  }

  if (!data || (!data.sections?.length && !isStreamingWithData)) {
    return (
      <div className={styles.readingContainer}>
        <div className={styles.summaryCard}>
          <p style={{ color: "#a0a0a0" }}>暫無 AI 解讀資料</p>
        </div>
      </div>
    );
  }

  const isV2 = data.isV2 === true && data.deterministic != null;
  const det = data.deterministic;
  const isZwds = readingType.startsWith("zwds-");
  const crossSellItems = isZwds ? ZWDS_CROSS_SELL : BAZI_CROSS_SELL;
  const crossSellFiltered = crossSellItems.filter(
    (item) => item.slug !== readingType,
  );

  return (
    <div className={styles.readingContainer}>
      {/* Summary */}
      {data.summary && (
        <div className={styles.summaryCard}>
          <h3 className={styles.summaryTitle}>命理總覽</h3>
          <div className={styles.summaryText}>{data.summary.text}</div>
        </div>
      )}

      {/* Sections */}
      {data.sections.map((section, index) => {
        const themeInfo = SECTION_THEMES[section.key] || {
          icon: "📜",
          theme: "default",
        };
        const titleZh =
          SECTION_TITLES_ZH[section.key] || section.title || section.key;

        // Determine which deterministic card to insert after this section
        const deterministicKey = isV2 ? V2_DETERMINISTIC_INSERTIONS[section.key] : undefined;

        return (
          <div key={section.key || index}>
            <div
              className={styles.readingSection}
              data-theme={themeInfo.theme}
            >
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>{themeInfo.icon}</span>
                <h3 className={styles.sectionTitle}>{titleZh}</h3>
              </div>

              {isSubscriber ? (
                <div className={styles.sectionContent}>
                  {section.full}
                  {isStreaming && index === data.sections.length - 1 && (
                    <span className={styles.streamingCursor} />
                  )}
                </div>
              ) : (
                <div className={styles.paywallWrapper}>
                  <div className={styles.previewContent}>{section.preview}</div>
                  {section.full && section.full !== section.preview && (
                    <>
                      <div className={styles.paywallBlur}>
                        {section.full.slice(
                          section.preview.length,
                          section.preview.length + 300,
                        )}
                      </div>
                      <div className={styles.paywallOverlay}>
                        <div className={styles.paywallIcon}>🔒</div>
                        <div className={styles.paywallMessage}>
                          訂閱解鎖完整內容
                        </div>
                        <div className={styles.paywallSubtext}>
                          升級會員查看詳細分析與建議
                        </div>
                        <button className={styles.paywallBtn}>立即訂閱</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Insert deterministic data card after specific sections */}
            {deterministicKey && det && (
              <DeterministicCard
                cardType={deterministicKey}
                data={det}
                isSubscriber={isSubscriber}
              />
            )}
          </div>
        );
      })}

      {/* Streaming: skeleton placeholders for sections not yet arrived */}
      {isStreamingWithData && (() => {
        const arrivedKeys = new Set(data.sections.map(s => s.key));
        const remainingKeys = V2_ALL_SECTION_KEYS.filter(k => !arrivedKeys.has(k));
        return remainingKeys.length > 0 ? (
          <>
            <div className={styles.streamingIndicator}>
              <span className={styles.streamingDot} />
              AI 生成中...
            </div>
            {remainingKeys.map(key => {
              const themeInfo = SECTION_THEMES[key] || { icon: '📜', theme: 'default' };
              const titleZh = SECTION_TITLES_ZH[key] || key;
              return (
                <div key={`skeleton-${key}`} className={styles.readingSection} data-theme={themeInfo.theme}>
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionIcon}>{themeInfo.icon}</span>
                    <h3 className={styles.sectionTitle}>{titleZh}</h3>
                  </div>
                  <div className={styles.skeletonContent}>
                    <div className={styles.skeletonLine} style={{ width: '90%' }} />
                    <div className={styles.skeletonLine} style={{ width: '75%' }} />
                    <div className={styles.skeletonLine} style={{ width: '85%' }} />
                    <div className={styles.skeletonLine} style={{ width: '60%' }} />
                  </div>
                </div>
              );
            })}
          </>
        ) : null;
      })()}

      {/* Entertainment Disclaimer */}
      <div className={styles.disclaimer}>
        <span className={styles.disclaimerIcon}>⚠️</span>
        <span className={styles.disclaimerText}>
          {ENTERTAINMENT_DISCLAIMER["zh-TW"]}
        </span>
      </div>

      {/* Cross-sell: Other reading types */}
      {crossSellFiltered.length > 0 && (
        <div className={styles.readingSection} data-theme="default">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>🔮</span>
            <h3 className={styles.sectionTitle}>更多運程分析</h3>
          </div>
          <div className={styles.crossSellGrid}>
            {crossSellFiltered.map((item) => (
              <Link
                key={item.slug}
                href={`/reading/${item.slug}`}
                className={styles.crossSellCard}
              >
                <div className={styles.crossSellIcon}>{item.icon}</div>
                <div className={styles.crossSellName}>{item.name}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// V2 Deterministic Data Cards
// ============================================================

function DeterministicCard({
  cardType,
  data,
  isSubscriber,
}: {
  cardType: string;
  data: LifetimeV2DeterministicData;
  isSubscriber: boolean;
}) {
  // Guard: if deterministic data is incomplete, don't render
  if (!data) return null;

  switch (cardType) {
    case "investments":
      if (!data.favorableInvestments || !data.unfavorableInvestments) return null;
      return (
        <div className={styles.detCard} data-theme="finance">
          <div className={styles.detCardHeader}>
            <span className={styles.detCardIcon}>📈</span>
            <h4 className={styles.detCardTitle}>投資理財方向</h4>
          </div>
          <div className={styles.detCardBody}>
            <div className={styles.detRow}>
              <span className={styles.detLabel}>有利投資</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.favorableInvestments.map((item) => (
                    <span key={item} className={styles.chipPositive}>{item}</span>
                  ))}
                </div>
              ) : (
                <span className={styles.detBlurred}>
                  {data.favorableInvestments.length} 項有利投資方向
                </span>
              )}
            </div>
            <div className={styles.detRow}>
              <span className={styles.detLabel}>不利投資</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.unfavorableInvestments.map((item) => (
                    <span key={item} className={styles.chipNegative}>{item}</span>
                  ))}
                </div>
              ) : (
                <span className={styles.detBlurred}>
                  {data.unfavorableInvestments.length} 項需注意投資
                </span>
              )}
            </div>
          </div>
        </div>
      );

    case "career_data":
      if (!data.careerDirections || !data.careerBenefactorsElement || !data.careerBenefactorsZodiac) return null;
      return (
        <div className={styles.detCard} data-theme="career">
          <div className={styles.detCardHeader}>
            <span className={styles.detCardIcon}>🧭</span>
            <h4 className={styles.detCardTitle}>事業發展數據</h4>
          </div>
          <div className={styles.detCardBody}>
            {/* Career directions */}
            {data.careerDirections.length > 0 && (
              <div className={styles.detRow}>
                <span className={styles.detLabel}>職業方向</span>
                {isSubscriber ? (
                  <div className={styles.careerDirList}>
                    {data.careerDirections.map((dir) => (
                      <div key={dir.category} className={styles.careerDirItem}>
                        <span className={styles.careerDirAnchor}>{dir.anchor}</span>
                        <span className={styles.careerDirCategory}>{dir.category}</span>
                        <div className={styles.chipGroup}>
                          {dir.industries.slice(0, 5).map((ind) => (
                            <span key={ind} className={styles.chipNeutral}>{ind}</span>
                          ))}
                          {dir.industries.length > 5 && (
                            <span className={styles.chipMore}>+{dir.industries.length - 5}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className={styles.detBlurred}>
                    {data.careerDirections.length} 大職業方向
                  </span>
                )}
              </div>
            )}
            {/* Favorable direction */}
            <div className={styles.detRow}>
              <span className={styles.detLabel}>有利方位</span>
              {isSubscriber ? (
                <span className={styles.chipPositive}>{data.favorableDirection}</span>
              ) : (
                <span className={styles.detBlurred}>方位資訊</span>
              )}
            </div>
            {/* Benefactors */}
            <div className={styles.detRow}>
              <span className={styles.detLabel}>事業貴人五行</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.careerBenefactorsElement.map((el) => (
                    <span key={el} className={styles.chipPositive}>{el}</span>
                  ))}
                </div>
              ) : (
                <span className={styles.detBlurred}>貴人五行</span>
              )}
            </div>
            <div className={styles.detRow}>
              <span className={styles.detLabel}>事業貴人生肖</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.careerBenefactorsZodiac.map((z) => (
                    <span key={z} className={styles.chipPositive}>{z}</span>
                  ))}
                </div>
              ) : (
                <span className={styles.detBlurred}>貴人生肖</span>
              )}
            </div>
          </div>
        </div>
      );

    case "love_data":
      if (!data.romanceYears || !data.partnerElement || !data.partnerZodiac) return null;
      return (
        <div className={styles.detCard} data-theme="love">
          <div className={styles.detCardHeader}>
            <span className={styles.detCardIcon}>💞</span>
            <h4 className={styles.detCardTitle}>感情數據分析</h4>
          </div>
          <div className={styles.detCardBody}>
            <div className={styles.detRow}>
              <span className={styles.detLabel}>正緣桃花年份</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.romanceYears.map((y) => (
                    <span key={y} className={styles.yearChip}>{y}</span>
                  ))}
                </div>
              ) : (
                <span className={styles.detBlurred}>
                  未來有 {data.romanceYears.length} 個桃花年份
                </span>
              )}
            </div>
            <div className={styles.detRow}>
              <span className={styles.detLabel}>擇偶建議五行</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.partnerElement.map((el) => (
                    <span key={el} className={styles.chipPositive}>{el}</span>
                  ))}
                </div>
              ) : (
                <span className={styles.detBlurred}>五行建議</span>
              )}
            </div>
            <div className={styles.detRow}>
              <span className={styles.detLabel}>擇偶建議生肖</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.partnerZodiac.map((z) => (
                    <span key={z} className={styles.chipPositive}>{z}</span>
                  ))}
                </div>
              ) : (
                <span className={styles.detBlurred}>生肖建議</span>
              )}
            </div>
          </div>
        </div>
      );

    case "family_data":
      if (!data.parentHealthYears?.father || !data.parentHealthYears?.mother) return null;
      return (
        <div className={styles.detCard} data-theme="family">
          <div className={styles.detCardHeader}>
            <span className={styles.detCardIcon}>🏠</span>
            <h4 className={styles.detCardTitle}>父母健康提點</h4>
          </div>
          <div className={styles.detCardBody}>
            <div className={styles.detRow}>
              <span className={styles.detLabel}>父親健康注意年份</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.parentHealthYears.father.length > 0 ? (
                    data.parentHealthYears.father.map((y) => (
                      <span key={y} className={styles.yearChipWarn}>{y}</span>
                    ))
                  ) : (
                    <span className={styles.detNote}>近15年無特別注意年份</span>
                  )}
                </div>
              ) : (
                <span className={styles.detBlurred}>
                  {data.parentHealthYears.father.length} 個注意年份
                </span>
              )}
            </div>
            <div className={styles.detRow}>
              <span className={styles.detLabel}>母親健康注意年份</span>
              {isSubscriber ? (
                <div className={styles.chipGroup}>
                  {data.parentHealthYears.mother.length > 0 ? (
                    data.parentHealthYears.mother.map((y) => (
                      <span key={y} className={styles.yearChipWarn}>{y}</span>
                    ))
                  ) : (
                    <span className={styles.detNote}>近15年無特別注意年份</span>
                  )}
                </div>
              ) : (
                <span className={styles.detBlurred}>
                  {data.parentHealthYears.mother.length} 個注意年份
                </span>
              )}
            </div>
          </div>
        </div>
      );

    case "luck_timeline":
      if (!data.luckPeriodsEnriched) return null;
      return (
        <LuckPeriodTimeline
          periods={data.luckPeriodsEnriched}
          bestPeriod={data.bestPeriod}
          isSubscriber={isSubscriber}
        />
      );

    default:
      return null;
  }
}

// ============================================================
// Luck Period Timeline
// ============================================================

function LuckPeriodTimeline({
  periods,
  bestPeriod,
  isSubscriber,
}: {
  periods: LuckPeriodDetailData[];
  bestPeriod: LuckPeriodDetailData | null;
  isSubscriber: boolean;
}) {
  if (!periods || periods.length === 0) return null;

  return (
    <div className={styles.detCard} data-theme="timing">
      <div className={styles.detCardHeader}>
        <span className={styles.detCardIcon}>📈</span>
        <h4 className={styles.detCardTitle}>大運評分時間軸</h4>
      </div>
      <div className={styles.timelineContainer}>
        {periods.map((period) => {
          const isBest = bestPeriod &&
            period.startYear === bestPeriod.startYear &&
            period.endYear === bestPeriod.endYear;
          const scoreColor = getScoreColor(period.score);

          return (
            <div
              key={`${period.startYear}-${period.endYear}`}
              className={`${styles.timelinePeriod} ${period.isCurrent ? styles.timelineCurrent : ""} ${isBest ? styles.timelineBest : ""}`}
            >
              <div className={styles.timelineBar}>
                <div
                  className={styles.timelineBarFill}
                  style={{
                    width: isSubscriber ? `${period.score}%` : "50%",
                    backgroundColor: isSubscriber ? scoreColor : "#555",
                  }}
                />
              </div>
              <div className={styles.timelineLabel}>
                <span className={styles.timelineGanzhi}>
                  {period.stem}{period.branch}
                </span>
                <span className={styles.timelineAge}>
                  {period.startAge}-{period.endAge}歲
                </span>
                <span className={styles.timelineYear}>
                  {period.startYear}-{period.endYear}
                </span>
                {isSubscriber && (
                  <span
                    className={styles.timelineScore}
                    style={{ color: scoreColor }}
                  >
                    {period.score}分
                  </span>
                )}
                {period.isCurrent && (
                  <span className={styles.timelineCurrentBadge}>當前</span>
                )}
                {isBest && isSubscriber && (
                  <span className={styles.timelineBestBadge}>最佳</span>
                )}
              </div>
              {isSubscriber && period.interactions.length > 0 && (
                <div className={styles.timelineInteractions}>
                  {period.interactions.map((interaction, i) => (
                    <span key={i} className={styles.interactionChip}>{interaction}</span>
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

function getScoreColor(score: number): string {
  if (score >= 75) return "#4caf50";
  if (score >= 60) return "#8bc34a";
  if (score >= 45) return "#ff9800";
  if (score >= 30) return "#ff5722";
  return "#f44336";
}

// ============================================================
// Loading Skeleton
// ============================================================

function LoadingSkeleton() {
  return (
    <div className={styles.readingContainer}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={styles.readingSection}
          data-theme="default"
        >
          <div className={styles.sectionHeader}>
            <div
              className={styles.skeleton}
              style={{ width: 32, height: 32, borderRadius: "50%" }}
            />
            <div
              className={styles.skeleton}
              style={{ width: 140, height: 20 }}
            />
          </div>
          <div className={styles.skeletonLong} />
          <div className={styles.skeletonMedium} />
          <div className={styles.skeletonLong} />
          <div className={styles.skeletonShort} />
        </div>
      ))}
    </div>
  );
}
