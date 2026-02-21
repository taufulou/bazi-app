"use client";

import Link from "next/link";
import styles from "./AIReadingDisplay.module.css";
import { ENTERTAINMENT_DISCLAIMER } from "@repo/shared";

// ============================================================
// Types
// ============================================================

interface ReadingSectionData {
  key: string;
  title: string;
  preview: string;
  full: string;
}

interface ReadingSummary {
  text: string;
}

interface AIReadingData {
  sections: ReadingSectionData[];
  summary?: ReadingSummary;
}

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

export default function AIReadingDisplay({
  data,
  readingType,
  isSubscriber,
  isLoading = false,
  isStreaming = false,
}: AIReadingDisplayProps) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!data || !data.sections || data.sections.length === 0) {
    return (
      <div className={styles.readingContainer}>
        <div className={styles.summaryCard}>
          <p style={{ color: "#a0a0a0" }}>暫無 AI 解讀資料</p>
        </div>
      </div>
    );
  }

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

        return (
          <div
            key={section.key || index}
            className={styles.readingSection}
            data-theme={themeInfo.theme}
          >
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}>{themeInfo.icon}</span>
              <h3 className={styles.sectionTitle}>{titleZh}</h3>
            </div>

            {isSubscriber ? (
              /* Subscriber: show full content */
              <div className={styles.sectionContent}>
                {section.full}
                {isStreaming && index === data.sections.length - 1 && (
                  <span className={styles.streamingCursor} />
                )}
              </div>
            ) : (
              /* Free user: show preview + paywall */
              <div className={styles.paywallWrapper}>
                {/* Preview text (visible) */}
                <div className={styles.previewContent}>{section.preview}</div>

                {/* Blurred full text behind paywall */}
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
        );
      })}

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
