"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import styles from "./AIReadingDisplay.module.css";
import { ENTERTAINMENT_DISCLAIMER } from "@repo/shared";
import type {
  AIReadingData,
  LifetimeV2DeterministicData,
  CareerV2DeterministicData,
  LuckPeriodDetailData,
} from "../lib/readings-api";
import {
  CAREER_V2_ALL_SECTION_KEYS,
  getDynamicSectionTitle,
} from "../lib/readings-api";
import { getScoreColor } from "../lib/score-utils";
import LuckPeriodChart from "./LuckPeriodChart";
import MascotViewer from "./MascotViewer";
import { isValidStem } from "../lib/mascot-utils";
import { SECTION_TECH_BUILDERS } from "./techRefBuilders";
import ScoreBar from "./ScoreBar";
import ElementCapabilityChart from "./ElementCapabilityChart";
import TenGodCapabilityChart from "./TenGodCapabilityChart";
import AnnualForecastTimeline from "./AnnualForecastTimeline";
import MonthlyFortuneGrid from "./MonthlyFortuneGrid";

// ============================================================
// Types
// ============================================================

interface AIReadingDisplayProps {
  data: AIReadingData | null;
  readingType: string;
  isSubscriber: boolean;
  isLoading?: boolean;
  isStreaming?: boolean;
  summaryPosition?: 'top' | 'bottom'; // default 'top'
  chartData?: Record<string, unknown> | null; // Bazi calculation data for technical reference card
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
  next_period: { icon: "🔮", theme: "timing" },
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
  // Career V2 sections
  suitable_positions: { icon: "💼", theme: "career" },
  career_directions_favorable: { icon: "🧭", theme: "career" },
  career_directions_unfavorable: { icon: "⚠️", theme: "career" },
  company_type_fit: { icon: "🏢", theme: "career" },
  entrepreneurship: { icon: "🚀", theme: "career" },
  partnership: { icon: "🤝", theme: "career" },
  career_allies: { icon: "👥", theme: "overview" },
};

/** Resolve section theme for dynamic keys (annual_forecast_YYYY, monthly_forecast_MM) */
function getSectionTheme(key: string): { icon: string; theme: string } {
  if (SECTION_THEMES[key]) return SECTION_THEMES[key];
  if (key.startsWith('annual_forecast_')) return { icon: "📅", theme: "timing" };
  if (key.startsWith('monthly_forecast_')) return { icon: "📆", theme: "timing" };
  return { icon: "📜", theme: "default" };
}

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
  // Career V2 sections
  suitable_positions: "適合職位分析",
  career_directions_favorable: "有利行業方向",
  career_directions_unfavorable: "不利行業方向",
  company_type_fit: "公司類型適配",
  entrepreneurship: "創業適合度分析",
  partnership: "合夥適合度分析",
  career_allies: "職場貴人與小人",
  boss_strategy: "應對上司之道",
  love_pattern: "感情格局解讀",
  children_analysis: "子女分析",
  parents_analysis: "父母情況分析",
  current_period: "當前大運詳解",
  next_period: "下一大運詳解",
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

/** Guide-style overrides for section titles (人生攻略 framing) */
const GUIDE_SECTION_TITLES_ZH: Record<string, string> = {
  chart_identity: "你的先天屬性",
  finance_pattern: "財富攻略",
  career_pattern: "事業發展路線",
  boss_strategy: "應對上司之道",
  love_pattern: "愛情攻略",
  health: "健康管理",
  children_analysis: "子女關係",
  parents_analysis: "父母關係",
  current_period: "當前大運詳解",
  next_period: "下一大運預覽",
  best_period: "最佳大運攻略",
};

// ============================================================
// StarRating Component (visual half-star support)
// ============================================================

function StarRating({ score, indicatorLabel }: { score: number; indicatorLabel?: string }) {
  const stars = [];
  const clamped = Math.max(0, Math.min(5, score));
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(clamped)) {
      // Full star
      stars.push(<span key={i} className={styles.starFull}>★</span>);
    } else if (i === Math.ceil(clamped) && clamped % 1 !== 0) {
      // Half star — overlapping spans
      stars.push(
        <span key={i} className={styles.starHalf}>
          <span className={styles.starHalfEmpty}>★</span>
          <span className={styles.starHalfFilled}>★</span>
        </span>
      );
    } else {
      // Empty star
      stars.push(<span key={i} className={styles.starEmpty}>★</span>);
    }
  }
  return (
    <div className={styles.starRating}>
      {stars}
      <span className={styles.starScore}>{clamped.toFixed(1)}</span>
      {indicatorLabel && (
        <span className={styles.starIndicator}>· {indicatorLabel}</span>
      )}
    </div>
  );
}

// ============================================================
// Career Verdict Banner (go/no-go + categorical — prominent card)
// ============================================================

const CAREER_VERDICT_SECTIONS = new Set(['company_type_fit', 'entrepreneurship', 'partnership']);

type VerdictTone = 'positive' | 'negative' | 'neutral';

function CareerVerdictBadge({ sectionKey, det }: { sectionKey: string; det: CareerV2DeterministicData }) {
  let verdictLabel = '';
  let verdictMeta = '';
  let score: number | null = null;
  let tone: VerdictTone = 'neutral';

  switch (sectionKey) {
    case 'company_type_fit': {
      const comp = det.companyTypeFit;
      if (!comp) return null;
      verdictLabel = comp.label || comp.type || '穩定型';
      verdictMeta = comp.description || '大型企業、政府機構、傳統產業';
      score = (det as any)?.companyTypeFit?.score ?? null;
      tone = 'neutral';
      break;
    }
    case 'entrepreneurship': {
      const ent = det.entrepreneurshipFit;
      if (!ent) return null;
      const typeLabels: Record<string, string> = {
        'technical_founder': '適合技術型創業',
        'business_founder': '適合商業型創業',
        'freelancer': '適合自由業型',
        'not_recommended': '不建議創業',
      };
      verdictLabel = typeLabels[ent.type] || ent.type;
      score = ent.score;
      tone = ent.type !== 'not_recommended' ? 'positive' : 'negative';
      break;
    }
    case 'partnership': {
      const part = det.partnershipFit;
      if (!part) return null;
      verdictLabel = part.suitable ? '適合合夥經營' : '不建議合夥經營';
      score = part.score;
      tone = part.suitable ? 'positive' : 'negative';
      break;
    }
    default:
      return null;
  }

  const toneClass = tone === 'positive' ? styles.verdictBannerPositive
    : tone === 'negative' ? styles.verdictBannerNegative
    : styles.verdictBannerNeutral;

  return (
    <div className={`${styles.verdictBanner} ${toneClass}`}>
      <div className={styles.verdictBannerLeft}>
        <span className={styles.verdictBannerIcon}>
          {tone === 'positive' ? '✓' : tone === 'negative' ? '✗' : '◆'}
        </span>
        <span className={styles.verdictBannerLabel}>{verdictLabel}</span>
      </div>
      <div className={styles.verdictBannerRight}>
        {score !== null && <span className={styles.verdictBannerScore}>{score}<small>/100</small></span>}
      </div>
      {verdictMeta && <div className={styles.verdictBannerMeta}>{verdictMeta}</div>}
    </div>
  );
}

/** Returns an indicator label for career star-rated sections. */
function getCareerStarLabel(
  sectionKey: string,
  det: CareerV2DeterministicData | undefined,
): string | undefined {
  if (!det) return undefined;

  switch (sectionKey) {
    case 'career_pattern': {
      const rep = det.reputationScore;
      return rep ? rep.level : undefined;
    }
    default:
      return undefined;
  }
}

// ============================================================
// Career Info Strip (compact data row — replaces stars for info sections)
// ============================================================

const CAREER_SUMMARY_SECTIONS = new Set([
  'career_pattern',
  'suitable_positions',
  'career_directions_favorable',
  'career_directions_unfavorable',
  'career_allies',
]);

function CareerSummaryBadge({ sectionKey, det }: { sectionKey: string; det: CareerV2DeterministicData }) {
  switch (sectionKey) {
    case 'career_pattern': {
      const pattern = det.pattern;
      if (!pattern) return null;
      const rep = det.reputationScore;
      return (
        <div className={styles.infoStrip}>
          <span className={styles.infoStripTag}>{pattern}格局</span>
          {rep && <span className={styles.infoStripValue}>{rep.level}（{rep.score}/100）</span>}
        </div>
      );
    }
    case 'suitable_positions': {
      const positions = det.suitablePositions;
      if (!positions || !Array.isArray(positions) || positions.length === 0) return null;
      const types = positions.slice(0, 3)
        .map((p: any) => String(p?.pattern || p?.label || ''))
        .filter((s: string) => s.length > 0);
      return (
        <div className={styles.infoStrip}>
          <span className={styles.infoStripTag}>{positions.length}類適合職位</span>
          {types.length > 0 && <span className={styles.infoStripDetail}>{types.join('、')}</span>}
        </div>
      );
    }
    case 'career_directions_favorable': {
      const industries = det.favorableIndustries;
      if (!industries || !Array.isArray(industries) || industries.length === 0) return null;
      const elements = industries.map((ind: any) => ind?.element || '').filter(Boolean);
      return (
        <div className={styles.infoStrip} data-tone="positive">
          <span className={styles.infoStripTag}>{industries.length}個有利方向</span>
          {elements.length > 0 && <span className={styles.infoStripDetail}>{elements.join('、')}屬性</span>}
        </div>
      );
    }
    case 'career_directions_unfavorable': {
      const industries = det.unfavorableIndustries;
      if (!industries || !Array.isArray(industries) || industries.length === 0) return null;
      const elements = industries.map((ind: any) => ind?.element || '').filter(Boolean);
      return (
        <div className={styles.infoStrip} data-tone="negative">
          <span className={styles.infoStripTag}>{industries.length}個需注意方向</span>
          {elements.length > 0 && <span className={styles.infoStripDetail}>{elements.join('、')}屬性</span>}
        </div>
      );
    }
    case 'career_allies':
      return null; // just suppress stars
  }
  return null;
}

// ============================================================
// Normalize ActiveLuckPeriod (bridge snake_case from NestJS shallow conversion)
// ============================================================

interface ActiveLuckPeriodNormalized {
  stem: string;
  branch: string;
  tenGod: string;
  startYear: number;
  endYear: number;
}

function normalizeActiveLuckPeriod(raw: Record<string, unknown> | null | undefined): ActiveLuckPeriodNormalized | null {
  if (!raw || (!(raw as any).stem && !(raw as any).branch)) return null;
  return {
    stem: ((raw as any).stem || '') as string,
    branch: ((raw as any).branch || '') as string,
    tenGod: ((raw as any).tenGod || (raw as any).ten_god || '') as string,
    startYear: ((raw as any).startYear || (raw as any).start_year || 0) as number,
    endYear: ((raw as any).endYear || (raw as any).end_year || 0) as number,
  };
}

// ============================================================
// Normalize Career Deterministic Data (bridge snake_case from NestJS shallow conversion)
// NestJS snakeToCamelCase only converts top-level keys. Nested object keys and
// some top-level fields arrive as snake_case. This function normalizes all fields
// used by CareerSummaryBadge, CareerVerdictBadge, and the career rendering block.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeCareerDeterministic(raw: any): CareerV2DeterministicData {
  if (!raw) return raw;

  // Helper: try camelCase first, then snake_case
  const get = (obj: any, camel: string, snake: string) =>
    obj[camel] !== undefined ? obj[camel] : obj[snake];

  return {
    ...raw,
    // Top-level fields that may arrive as snake_case
    weightedElements: get(raw, 'weightedElements', 'weighted_elements'),
    weightedTenGods: get(raw, 'weightedTenGods', 'weighted_ten_gods'),
    reputationScore: get(raw, 'reputationScore', 'reputation_score'),
    wealthScore: get(raw, 'wealthScore', 'wealth_score'),
    fiveQiStates: get(raw, 'fiveQiStates', 'five_qi_states'),
    pattern: get(raw, 'pattern', 'pattern'),
    patternType: get(raw, 'patternType', 'pattern_type'),
    activeLuckPeriod: get(raw, 'activeLuckPeriod', 'active_luck_period'),
    suitablePositions: get(raw, 'suitablePositions', 'suitable_positions') || [],
    companyTypeFit: get(raw, 'companyTypeFit', 'company_type_fit'),
    entrepreneurshipFit: get(raw, 'entrepreneurshipFit', 'entrepreneurship_fit'),
    partnershipFit: get(raw, 'partnershipFit', 'partnership_fit'),
    careerAllies: get(raw, 'careerAllies', 'career_allies'),
    annualForecasts: get(raw, 'annualForecasts', 'annual_forecasts') || [],
    monthlyForecasts: ((get(raw, 'monthlyForecasts', 'monthly_forecasts') || []) as any[]).map((mf: any) => ({
      ...mf,
      monthName: mf.monthName || mf.month_name || '',
      tenGod: mf.tenGod || mf.ten_god || '',
      solarTermDate: mf.solarTermDate || mf.solar_term_date || '',
      solarTermEndDate: mf.solarTermEndDate || mf.solar_term_end_date || '',
      seasonElement: mf.seasonElement || mf.season_element || '',
      annualContext: mf.annualContext || mf.annual_context || '',
      branchInteractions: mf.branchInteractions || mf.branch_interactions || [],
    })),
    favorableIndustries: get(raw, 'favorableIndustries', 'favorable_industries') || [],
    unfavorableIndustries: get(raw, 'unfavorableIndustries', 'unfavorable_industries') || [],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ============================================================
// CharacterCard Reference Tables (deterministic, guide-style only)
// ============================================================

const DAY_MASTER_PERSONALITY: Record<string, { archetype: string; traits: string }> = {
  '甲': { archetype: '參天大樹', traits: '正直堅毅、有領導力、不善變通、固執但值得信賴' },
  '乙': { archetype: '藤蔓花草', traits: '柔韌靈活、善於適應、溫和細膩、但容易依賴他人' },
  '丙': { archetype: '太陽烈火', traits: '熱情開朗、光明磊落、樂觀進取、但性急易燃易滅' },
  '丁': { archetype: '燈燭星火', traits: '內斂溫暖、心思細密、善解人意、但容易多慮優柔' },
  '戊': { archetype: '高山土壤', traits: '沉著穩重、講求實際、忠厚誠懇、但行動緩慢缺乏靈活' },
  '己': { archetype: '田園沃土', traits: '包容務實、善於蓄積、謹慎低調、但有時過於保守' },
  '庚': { archetype: '精鋼利刃', traits: '果斷剛毅、重義氣、行動力強、但過於剛硬易傷人' },
  '辛': { archetype: '珠寶首飾', traits: '精緻敏銳、審美獨到、注重品質、但有潔癖和完美主義' },
  '壬': { archetype: '江河大海', traits: '智慧深沉、思維開闊、足智多謀、但容易飄忽不定' },
  '癸': { archetype: '雨露甘霖', traits: '聰慧靈敏、洞察力強、善於感知、但容易多疑內耗' },
};

const TEN_GOD_PERSONALITY: Record<string, {
  core: string; external: string; internal: string; motivation: string;
}> = {
  '比肩': { core: '獨立自主、重視平等、不喜依賴', external: '表現得自信獨立、不卑不亢', internal: '內心追求公平對等的關係', motivation: '渴望建立平等互助的人際圈' },
  '劫財': { core: '積極進取、競爭意識強、敢冒險', external: '表現得積極主動、喜歡社交', internal: '內心有強烈的得失心', motivation: '追求突破限制、贏得認可' },
  '食神': { core: '溫和聰慧、注重生活品味、有藝術天賦', external: '表現得隨和親切、談吐優雅', internal: '內心追求精神滿足、重視生活品質', motivation: '渴望自在表達、享受創造與分享的過程' },
  '傷官': { core: '才華橫溢、叛逆不羈、追求完美', external: '表現得鋒芒畢露、言辭犀利', internal: '內心極度追求自我表達', motivation: '渴望被認可為獨一無二的存在' },
  '偏財': { core: '慷慨大方、善於交際、投資直覺好', external: '表現得八面玲瓏、出手闊綽', internal: '內心對物質和自由有強烈渴望', motivation: '追求財富自由和多元體驗' },
  '正財': { core: '勤勉踏實、理財能力佳、注重穩定', external: '表現得穩重可靠、有責任感', internal: '內心重視安全感和穩定收入', motivation: '渴望建立穩固的經濟基礎' },
  '偏官': { core: '果敢強勢、領導力強、抗壓力佳', external: '表現得嚴肅有威嚴、行動迅速', internal: '內心有改變世界的野心', motivation: '渴望掌控局面、征服挑戰' },
  '正官': { core: '正直守規、責任感強、注重名譽', external: '表現得端正有禮、自律嚴謹', internal: '內心重視社會認可和道德標準', motivation: '渴望成為受人尊敬的典範' },
  '偏印': { core: '思維獨特、直覺敏銳、興趣廣泛', external: '表現得安靜內斂、有些神秘', internal: '內心世界豐富、追求精神層面探索', motivation: '渴望發現常人看不到的真理' },
  '正印': { core: '仁慈寬厚、學習力強、重視傳承', external: '表現得溫和包容、有學者氣質', internal: '內心追求知識和智慧的累積', motivation: '渴望透過學習成長來幫助他人' },
};

const STRENGTH_MODIFIER: Record<string, string> = {
  'very_strong': '能量極旺——行動力爆表但需防過剛',
  'strong': '能量偏強——實力穩固但需注意調和',
  'neutral': '能量中和——靈活應變是你的優勢',
  'weak': '能量偏弱——借力使力是你的生存智慧',
  'very_weak': '能量極弱——順勢而為反而能成大事',
};

const BRANCH_ZODIAC: Record<string, string> = {
  '子': '鼠', '丑': '牛', '寅': '虎', '卯': '兔',
  '辰': '龍', '巳': '蛇', '午': '馬', '未': '羊',
  '申': '猴', '酉': '雞', '戌': '狗', '亥': '豬',
};

const ZODIAC_PERSONALITY: Record<string, string> = {
  '鼠': '機靈敏銳、善於觀察、適應力強，擅長在變化中找到機會',
  '牛': '踏實穩重、耐力驚人、值得信賴，但有時過於固執',
  '虎': '自信果斷、有領袖魅力、勇於冒險，但容易衝動',
  '兔': '溫文儒雅、善於交際、品味不凡，但容易逃避衝突',
  '龍': '氣場強大、志向遠大、天生領袖，但有時過於自信',
  '蛇': '深謀遠慮、洞察力強、神秘魅力，但容易多疑',
  '馬': '活力充沛、熱情奔放、追求自由，但容易三分鐘熱度',
  '羊': '溫柔體貼、藝術天份、善良和順，但容易優柔寡斷',
  '猴': '聰明靈活、創意無限、多才多藝，但容易心浮氣躁',
  '雞': '精明幹練、眼光獨到、追求完美，但容易挑剔',
  '狗': '忠誠正直、有正義感、值得信賴，但容易杞人憂天',
  '豬': '樂觀豁達、寬容大度、享受生活，但容易缺乏警覺',
};

// ============================================================
// CharacterCard Component (guide-style only)
// ============================================================

function CharacterCard({ chartData }: { chartData: Record<string, unknown> }) {
  const dm = chartData?.dayMaster as {
    element?: string; yinYang?: string; strength?: string;
    pattern?: string; favorableGod?: string; usefulGod?: string;
    tabooGod?: string; enemyGod?: string;
  } | undefined;
  const dayMasterStem = chartData?.dayMasterStem as string | undefined;
  const fp = chartData?.fourPillars as Record<string, {
    stem?: string; branch?: string; tenGod?: string;
    hiddenStemGods?: Array<{ stem: string; tenGod: string }>;
    shenSha?: string[];
  }> | undefined;

  // Extract gender from chartData (works for both form-based and deep-linked saved readings)
  const gender = (chartData?.gender as string) === 'female' ? 'female' as const : 'male' as const;

  if (!dm || !dayMasterStem || !fp) return null;

  const personality = DAY_MASTER_PERSONALITY[dayMasterStem];
  if (!personality) return null;

  // Layer 1: Core essence from day master
  const coreTrait = personality;

  // Layer 2: External impression from month pillar ten god
  const monthGod = fp.month?.tenGod;
  const monthPersonality = monthGod ? TEN_GOD_PERSONALITY[monthGod] : null;
  const externalTrait = monthGod === '比肩'
    ? `外在形象與本質一致——${coreTrait.traits.split('、')[0]}`
    : monthPersonality?.external;

  // Layer 3: Internal character from day branch hidden stem main qi
  const dayHiddenGods = fp.day?.hiddenStemGods;
  const dayMainQiGod = dayHiddenGods?.[0]?.tenGod;
  const internalTrait = dayMainQiGod ? TEN_GOD_PERSONALITY[dayMainQiGod]?.internal : undefined;

  // Layer 4: Driving force from hour pillar ten god
  const hourGod = fp.hour?.tenGod;
  const motivationTrait = hourGod ? TEN_GOD_PERSONALITY[hourGod]?.motivation : undefined;

  // Zodiac from year branch
  const yearBranch = fp.year?.branch;
  const zodiac = yearBranch ? BRANCH_ZODIAC[yearBranch] : undefined;
  const zodiacTrait = zodiac ? ZODIAC_PERSONALITY[zodiac] : undefined;

  // Strength modifier
  const strengthText = dm.strength ? STRENGTH_MODIFIER[dm.strength] : undefined;

  // Key shensha (collect all)
  const allShenSha: string[] = [];
  for (const pillar of Object.values(fp)) {
    if (pillar?.shenSha) allShenSha.push(...pillar.shenSha);
  }
  const keyShenSha = [...new Set(allShenSha)].slice(0, 5);

  return (
    <div className={styles.characterCard}>
      <div className={styles.characterCardHeader}>
        <div className={styles.characterCardTitle}>
          <span className={styles.characterCardIcon}>🎴</span>
          你的角色卡
        </div>
        {zodiac && <span className={styles.zodiacBadge}>{zodiac}年生</span>}
      </div>

      {/* Mascot hero image — swipeable full/half body viewer */}
      {dayMasterStem && isValidStem(dayMasterStem) && (
        <MascotViewer stem={dayMasterStem} gender={gender} />
      )}

      <div className={styles.characterCardBody}>
        {/* Archetype */}
        <div className={styles.characterArchetype}>
          <span className={styles.archetypeLabel}>核心屬性</span>
          <span className={styles.archetypeValue}>{coreTrait.archetype}</span>
        </div>

        {/* Personality layers */}
        <div className={styles.characterLayers}>
          <div className={styles.characterLayer}>
            <span className={styles.layerLabel}>🌟 本質</span>
            <span className={styles.layerValue}>{coreTrait.traits}</span>
          </div>
          {externalTrait && (
            <div className={styles.characterLayer}>
              <span className={styles.layerLabel}>🎭 外在印象</span>
              <span className={styles.layerValue}>{externalTrait}</span>
            </div>
          )}
          {internalTrait && (
            <div className={styles.characterLayer}>
              <span className={styles.layerLabel}>💎 內在性格</span>
              <span className={styles.layerValue}>{internalTrait}</span>
            </div>
          )}
          {motivationTrait && (
            <div className={styles.characterLayer}>
              <span className={styles.layerLabel}>🔥 核心驅動力</span>
              <span className={styles.layerValue}>{motivationTrait}</span>
            </div>
          )}
        </div>

        {/* Zodiac */}
        {zodiacTrait && (
          <div className={styles.characterZodiac}>
            <span className={styles.layerLabel}>🐾 生肖特質（{zodiac}）</span>
            <span className={styles.layerValue}>{zodiacTrait}</span>
          </div>
        )}

        {/* Stats row */}
        <div className={styles.characterStats}>
          {dm.pattern && (
            <div className={styles.statItem}>
              <span className={styles.statLabel}>角色定位</span>
              <span className={styles.statValue}>{dm.pattern}</span>
            </div>
          )}
          {strengthText && (
            <div className={styles.statItem}>
              <span className={styles.statLabel}>能量狀態</span>
              <span className={styles.statValue}>{strengthText}</span>
            </div>
          )}
          {dm.usefulGod && (
            <div className={styles.statItem}>
              <span className={styles.statLabel}>最強加持</span>
              <span className={styles.statValue}>{dm.usefulGod}</span>
            </div>
          )}
          {dm.tabooGod && (
            <div className={styles.statItem}>
              <span className={styles.statLabel}>隱藏地雷</span>
              <span className={styles.statValue}>{dm.tabooGod}</span>
            </div>
          )}
        </div>

        {/* Key shensha */}
        {keyShenSha.length > 0 && (
          <div className={styles.characterShensha}>
            <span className={styles.shenshaLabel}>特殊天賦/標記</span>
            <div className={styles.shenshaTags}>
              {keyShenSha.map(s => (
                <span key={s} className={styles.shenshaTag}>{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Share button placeholder — full implementation in future session */}
      <div className={styles.shareButtonPlaceholder}>
        <span>✦ 分享我的角色卡 ✦</span>
        <span className={styles.comingSoon}>即將推出</span>
      </div>
    </div>
  );
}

// Cross-sell reading types (show other reading types)
const BAZI_CROSS_SELL = [
  { slug: "lifetime", icon: "🌟", name: "八字終身運" },
  { slug: "annual", icon: "📅", name: "八字流年運勢" },
  { slug: "career", icon: "💼", name: "事業詳批" },
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
export const V2_ALL_SECTION_KEYS = [
  'chart_identity', 'finance_pattern', 'career_pattern', 'boss_strategy',
  'love_pattern', 'health', 'children_analysis', 'parents_analysis',
  'current_period', 'next_period', 'best_period',
  'annual_love', 'annual_career', 'annual_finance', 'annual_health',
];

export default function AIReadingDisplay({
  data,
  readingType,
  isSubscriber,
  isLoading = false,
  isStreaming = false,
  summaryPosition = 'top',
  chartData = null,
}: AIReadingDisplayProps) {
  const isGuide = readingType === 'lifetime'; // LIFETIME always uses guide style
  const isCareerV2 = readingType === 'career' && data?.isV2 === true;
  // During streaming with V2 data: show arrived sections + skeletons for remaining
  const isStreamingWithData = isStreaming && data?.isV2 && data.deterministic != null;

  if (isLoading && !isStreamingWithData) {
    return <LoadingSkeleton />;
  }

  // Note: When isStreamingWithData is true, data is guaranteed non-null
  // (isStreamingWithData = isStreaming && data?.isV2 && data.deterministic != null)
  // and the !isStreamingWithData clause makes this condition false,
  // so we never show "no data" during V2 streaming.
  if (!data || (!data.sections?.length && !isStreamingWithData)) {
    return (
      <div className={styles.readingContainer}>
        <div className={styles.summaryCard}>
          <p style={{ color: "var(--text-muted)" }}>暫無解讀資料</p>
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
      {/* Summary (top position — default for non-lifetime readings) */}
      {summaryPosition !== 'bottom' && data.summary && (
        <div className={styles.readingSection} data-theme="overview">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>📋</span>
            <h3 className={styles.sectionTitle}>命理總覽</h3>
          </div>
          <div className={styles.sectionContent}>
            {renderFormattedContent(data.summary.text)}
          </div>
        </div>
      )}

      {/* CharacterCard — guide style only, rendered before all sections */}
      {isGuide && chartData && <CharacterCard chartData={chartData} />}

      {/* Career V2 deterministic data cards — before AI sections */}
      {isCareerV2 && det && (() => {
        const cdet = normalizeCareerDeterministic(det);
        return (
          <>
            {/* Scores */}
            {(cdet.reputationScore || cdet.wealthScore) && (
              <div className={styles.readingSection} data-theme="career">
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionIcon}>📊</span>
                  <h3 className={styles.sectionTitle}>事業格局評分</h3>
                </div>
                <div style={{ padding: '0 0.5rem' }}>
                  {cdet.reputationScore && (
                    <ScoreBar
                      label="名聲地位"
                      score={cdet.reputationScore.score}
                      tier={cdet.reputationScore.level}
                    />
                  )}
                  {cdet.wealthScore && (
                    <ScoreBar
                      label="財富格局"
                      score={cdet.wealthScore.score}
                      tier={cdet.wealthScore.tier}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Five Elements Capability */}
            {cdet.weightedElements && (
              <ElementCapabilityChart data={cdet.weightedElements} />
            )}

            {/* Ten God Capability */}
            {cdet.weightedTenGods && (
              <TenGodCapabilityChart data={cdet.weightedTenGods} />
            )}
          </>
        );
      })()}

      {/* Sections */}
      {data.sections.map((section, index) => {
        // Skip individual annual/monthly forecast AI sections for career V2 —
        // these are rendered as grouped AnnualForecastTimeline + MonthlyFortuneGrid below
        if (isCareerV2 && (
          section.key.startsWith('annual_forecast_') ||
          section.key.startsWith('monthly_forecast_')
        )) {
          return null;
        }

        const themeInfo = getSectionTheme(section.key);
        // Use dynamic titles for career annual/monthly forecast sections
        const titleZh = isCareerV2
          ? (getDynamicSectionTitle(section.key)
            || GUIDE_SECTION_TITLES_ZH[section.key]
            || SECTION_TITLES_ZH[section.key]
            || section.title || section.key)
          : ((isGuide ? GUIDE_SECTION_TITLES_ZH[section.key] : undefined)
            || SECTION_TITLES_ZH[section.key] || section.title || section.key);

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

              {/* Star rating — guide style + career V2 (skip timing, verdict, and summary sections) */}
              {(isGuide || isCareerV2) && typeof section.score === 'number'
                && !['current_period', 'next_period', 'best_period'].includes(section.key)
                && !CAREER_VERDICT_SECTIONS.has(section.key)
                && !CAREER_SUMMARY_SECTIONS.has(section.key)
                && (<StarRating score={section.score} indicatorLabel={isCareerV2 ? getCareerStarLabel(section.key, normalizeCareerDeterministic(det)) : undefined} />)}

              {/* Summary badge — career V2 categorical/list sections */}
              {isCareerV2 && CAREER_SUMMARY_SECTIONS.has(section.key) && det && (
                <CareerSummaryBadge sectionKey={section.key} det={normalizeCareerDeterministic(det)} />
              )}

              {/* Verdict badge — career V2 only (go-no-go sections) */}
              {isCareerV2 && CAREER_VERDICT_SECTIONS.has(section.key) && det && (
                <CareerVerdictBadge sectionKey={section.key} det={normalizeCareerDeterministic(det)} />
              )}

              {/* LuckPeriodHeader — timing sections only */}
              {isGuide && ['current_period', 'next_period', 'best_period'].includes(section.key) && data.deterministic && (() => {
                const det = data.deterministic as LifetimeV2DeterministicData;
                const result = getLuckPeriodForSection(
                  section.key,
                  det.luckPeriodsEnriched || [],
                  det.bestPeriod,
                );
                return result ? (
                  <LuckPeriodHeader
                    period={result.period}
                    ordinalLabel={result.ordinalLabel}
                    isSubscriber={isSubscriber}
                  />
                ) : null;
              })()}

              {isSubscriber ? (
                <div className={styles.sectionContent}>
                  {renderFormattedContent(section.full || '')}
                </div>
              ) : (
                <div className={styles.paywallWrapper}>
                  <div className={styles.previewContent}>{renderFormattedContent(section.preview || '')}</div>
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

              {/* Collapsible technical reference at bottom of each section */}
              {chartData && (
                <TechnicalReferenceCard
                  sectionKey={section.key}
                  chartData={chartData}
                />
              )}
            </div>

            {/* Insert deterministic data card after specific sections */}
            {deterministicKey && det && !isCareerV2 && (
              <DeterministicCard
                cardType={deterministicKey}
                data={det as LifetimeV2DeterministicData}
                isSubscriber={isSubscriber}
                chartData={chartData}
              />
            )}
          </div>
        );
      })}

      {/* Streaming: skeleton placeholder for the NEXT expected section only */}
      {isStreamingWithData && (() => {
        const arrivedKeys = new Set(data.sections.map(s => s.key));
        // Use career section keys for career V2, lifetime keys otherwise
        const allKeys = isCareerV2 ? CAREER_V2_ALL_SECTION_KEYS : V2_ALL_SECTION_KEYS;
        const remainingKeys = allKeys.filter(k => !arrivedKeys.has(k));
        const nextKey = remainingKeys[0];
        if (!nextKey) return null;
        const themeInfo = getSectionTheme(nextKey);
        const titleZh = getDynamicSectionTitle(nextKey)
          || GUIDE_SECTION_TITLES_ZH[nextKey]
          || SECTION_TITLES_ZH[nextKey] || nextKey;
        return (
          <>
            <div className={styles.streamingIndicator}>
              <span className={styles.streamingDot} />
              正在分析{titleZh}...
            </div>
            <div key={`skeleton-${nextKey}`} className={styles.readingSection} data-theme={themeInfo.theme}>
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
          </>
        );
      })()}

      {/* Career V2: Annual Forecast Timeline + Monthly Grid (after all AI sections).
          Hide during streaming for subscribers (narratives arrive progressively).
          Non-subscribers see pure deterministic data — no reason to delay. */}
      {isCareerV2 && det && (!isStreaming || !isSubscriber) && (() => {
        const cdet = normalizeCareerDeterministic(det);

        // Collect AI narratives from sections for annual/monthly
        const annualNarratives: Record<string, string> = {};
        const monthlyNarratives: Record<string, string> = {};
        for (const section of data.sections) {
          if (section.key.startsWith('annual_forecast_')) {
            annualNarratives[section.key] = section.full || section.preview || '';
          }
          if (section.key.startsWith('monthly_forecast_')) {
            monthlyNarratives[section.key] = section.full || section.preview || '';
          }
        }

        return (
          <>
            {cdet.annualForecasts && cdet.annualForecasts.length > 0 && (
              <div className={styles.readingSection} data-theme="timing">
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionIcon}>📅</span>
                  <h3 className={styles.sectionTitle}>未來五年事業運勢</h3>
                </div>
                <AnnualForecastTimeline
                  forecasts={cdet.annualForecasts}
                  activeLuckPeriod={normalizeActiveLuckPeriod(cdet.activeLuckPeriod as any)}
                  narratives={isSubscriber ? annualNarratives : undefined}
                />
              </div>
            )}

            {cdet.monthlyForecasts && cdet.monthlyForecasts.length > 0 && (
              <div className={styles.readingSection} data-theme="timing">
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionIcon}>📆</span>
                  <h3 className={styles.sectionTitle}>{cdet.annualForecasts?.[0]?.year || new Date().getFullYear()}年 每月事業運程</h3>
                </div>
                <MonthlyFortuneGrid
                  forecasts={cdet.monthlyForecasts}
                  narratives={isSubscriber ? monthlyNarratives : undefined}
                />
              </div>
            )}
          </>
        );
      })()}

      {/* Summary (bottom position — lifetime readings, acts as conclusion) */}
      {summaryPosition === 'bottom' && data.summary && (
        <div className={`${styles.readingSection} ${styles.summaryFadeIn}`} data-theme="overview">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>📋</span>
            <h3 className={styles.sectionTitle}>命理總覽</h3>
          </div>
          <div className={styles.sectionContent}>
            {renderFormattedContent(data.summary.text)}
          </div>
        </div>
      )}

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
// Technical Reference Card (collapsible, per-section)
// ============================================================

function TechnicalReferenceCard({
  sectionKey,
  chartData,
}: {
  sectionKey: string;
  chartData: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);

  // Memoize builder result — chartData is a stable reference set once
  const groups = useMemo(() => {
    const builder = SECTION_TECH_BUILDERS[sectionKey];
    if (!builder || !chartData) return [];
    return builder(chartData);
  }, [sectionKey, chartData]);

  if (groups.length === 0) return null;

  return (
    <div className={styles.techRef} data-expanded={expanded}>
      <button
        className={styles.techRefToggle}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className={styles.techRefArrow}>{expanded ? '▾' : '▸'}</span>
        <span className={styles.techRefLabel}>專業命理依據</span>
      </button>
      {expanded && (
        <div className={styles.techRefContent}>
          {groups.map((group) => (
            <div key={group.category} className={styles.techRefGroup}>
              <div className={styles.techRefCategory}>{group.category}</div>
              {group.items.map((item, idx) => (
                <div key={`${group.category}-${idx}`} className={styles.techRefRow}>
                  <span className={styles.techRefKey}>{item.label}</span>
                  <span className={styles.techRefValue}>{item.value}</span>
                </div>
              ))}
            </div>
          ))}
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
  chartData,
}: {
  cardType: string;
  data: LifetimeV2DeterministicData;
  isSubscriber: boolean;
  chartData?: Record<string, unknown> | null;
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
            <span className={styles.detCardDisclaimer}>投資有風險，此測算結果內容僅供參考，絕不構成任何投資建議或承諾</span>
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

    case "career_data": {
      if (!data.careerDirections || !data.careerBenefactorsElement || !data.careerBenefactorsZodiac) return null;
      const fp = (chartData?.fourPillars ?? null) as { year?: { branch?: string } } | null;
      const yearBranch = fp?.year?.branch;
      const userZodiac = (yearBranch ? BRANCH_ZODIAC[yearBranch] : null) || null;
      return (
        <div className={styles.detCard} data-theme="career">
          <div className={styles.detCardHeader}>
            <span className={styles.detCardIcon}>🧭</span>
            <h4 className={styles.detCardTitle}>有利發展的職業方向</h4>
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
            {data.favorableDirection ? (
              <div className={styles.detRow}>
                <span className={styles.detLabel}>有利方位</span>
                {isSubscriber ? (
                  <>
                    <div className={styles.chipGroup}>
                      <span className={styles.chipPositive}>{data.favorableDirection}</span>
                    </div>
                    <p className={styles.detExplain}>
                      {data.favorableDirection === '中央'
                        ? '根據你的命格，適合在出生地或家鄉附近發展。若已固定了工作的城市，選擇市中心區域會比較有利。'
                        : `根據你的命格，有利於職業發展的方位為出生地的${data.favorableDirection}。若已固定了工作的城市，則可選擇往該城市的${data.favorableDirection}發展。`
                      }
                    </p>
                  </>
                ) : (
                  <span className={styles.detBlurred}>方位資訊</span>
                )}
              </div>
            ) : null}
            {/* Benefactors by element */}
            {data.careerBenefactorsElement && data.careerBenefactorsElement.length > 0 ? (
              <div className={styles.detRow}>
                <span className={styles.detLabel}>事業貴人五行</span>
                {isSubscriber ? (
                  <>
                    <div className={styles.chipGroup}>
                      {data.careerBenefactorsElement.map((el) => (
                        <span key={el} className={styles.chipPositive}>{el}</span>
                      ))}
                    </div>
                    <p className={styles.detExplain}>
                      和五行屬性為{data.careerBenefactorsElement.join('、')}的人共事或合作，會比較有利於你的事業發展，能起到幫扶的作用。
                    </p>
                  </>
                ) : (
                  <span className={styles.detBlurred}>貴人五行</span>
                )}
              </div>
            ) : null}
            {/* Benefactors by zodiac */}
            {data.careerBenefactorsZodiac && data.careerBenefactorsZodiac.length > 0 ? (
              <div className={styles.detRow}>
                <span className={styles.detLabel}>事業貴人生肖</span>
                {isSubscriber ? (
                  <>
                    <div className={styles.chipGroup}>
                      {data.careerBenefactorsZodiac.map((z) => (
                        <span key={z} className={styles.chipPositive}>{z}</span>
                      ))}
                    </div>
                    <p className={styles.detExplain}>
                      {userZodiac ? `你的生肖為${userZodiac}，` : ''}在事業上與屬{data.careerBenefactorsZodiac.join('、屬')}的人共事比較合拍，互相生旺，對你的發展有扶助作用。
                    </p>
                  </>
                ) : (
                  <span className={styles.detBlurred}>貴人生肖</span>
                )}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    case "love_data": {
      if (!data.romanceYears || !data.partnerElement || !data.partnerZodiac) return null;
      const lfp = (chartData?.fourPillars ?? null) as { year?: { branch?: string } } | null;
      const lYearBranch = lfp?.year?.branch;
      const lUserZodiac = (lYearBranch ? BRANCH_ZODIAC[lYearBranch] : null) || null;
      return (
        <div className={styles.detCard} data-theme="love">
          <div className={styles.detCardHeader}>
            <span className={styles.detCardIcon}>💞</span>
            <h4 className={styles.detCardTitle}>感情時機與擇偶方向</h4>
          </div>
          <div className={styles.detCardBody}>
            {/* Romance years */}
            {data.romanceYears.length > 0 && (
              <div className={styles.detRow}>
                <span className={styles.detLabel}>桃花姻緣年份</span>
                {isSubscriber ? (
                  <>
                    <div className={styles.chipGroup}>
                      {data.romanceYears.map((y) => (
                        <span key={y} className={styles.yearChip}>{y}</span>
                      ))}
                    </div>
                    <p className={styles.detExplain}>
                      這些年份的流年與你的感情宮或配偶星產生共振，是感情出現機緣的高機率時段。單身者可積極把握社交機會。
                    </p>
                  </>
                ) : (
                  <span className={styles.detBlurred}>
                    未來有 {data.romanceYears.length} 個桃花年份
                  </span>
                )}
              </div>
            )}
            {/* Warning years */}
            {data.romanceWarningYears && data.romanceWarningYears.length > 0 && (
              <div className={styles.detRow}>
                <span className={styles.detLabel}>⚠️ 感情波動年</span>
                {isSubscriber ? (
                  <>
                    <div className={styles.chipGroup}>
                      {data.romanceWarningYears.map((y) => (
                        <span key={y} className={styles.yearChipWarn}>{y}</span>
                      ))}
                    </div>
                    <p className={styles.detExplain}>
                      這些年份流年沖擊感情宮，感情較易出現波動或考驗。已有伴侶者須特別注意溝通與維繫，單身者感情宮被觸動，姻緣或有變化，但順逆須結合整體運勢判斷。
                    </p>
                  </>
                ) : (
                  <span className={styles.detBlurred}>
                    有 {data.romanceWarningYears.length} 個波動年份
                  </span>
                )}
              </div>
            )}
            {/* Partner element */}
            {data.partnerElement && data.partnerElement.length > 0 ? (
              <div className={styles.detRow}>
                <span className={styles.detLabel}>擇偶建議五行</span>
                {isSubscriber ? (
                  <>
                    <div className={styles.chipGroup}>
                      {data.partnerElement.map((el) => (
                        <span key={el} className={styles.chipPositive}>{el}</span>
                      ))}
                    </div>
                    <p className={styles.detExplain}>
                      和五行屬性為{data.partnerElement.join('、')}的人在一起，對方的五行能量對你有扶助作用，感情較為和諧穩定。
                    </p>
                  </>
                ) : (
                  <span className={styles.detBlurred}>五行建議</span>
                )}
              </div>
            ) : null}
            {/* Partner zodiac */}
            {data.partnerZodiac && data.partnerZodiac.length > 0 ? (
              <div className={styles.detRow}>
                <span className={styles.detLabel}>擇偶建議生肖</span>
                {isSubscriber ? (
                  <>
                    <div className={styles.chipGroup}>
                      {data.partnerZodiac.map((z) => (
                        <span key={z} className={styles.chipPositive}>{z}</span>
                      ))}
                    </div>
                    <p className={styles.detExplain}>
                      {lUserZodiac ? `你的生肖為${lUserZodiac}，` : ''}與屬{data.partnerZodiac.join('、屬')}的人在感情上比較投緣，相處融洽。
                    </p>
                  </>
                ) : (
                  <span className={styles.detBlurred}>生肖建議</span>
                )}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

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
        <>
          <LuckPeriodChart
            periods={data.luckPeriodsEnriched}
            isSubscriber={isSubscriber}
          />
          <LuckPeriodTimeline
            periods={data.luckPeriodsEnriched}
            bestPeriod={data.bestPeriod}
            isSubscriber={isSubscriber}
          />
        </>
      );

    default:
      return null;
  }
}

// ============================================================
// Luck Period Header (deterministic card above AI narrative)
// ============================================================

/** Ten-god guide-friendly labels — must match prompts.ts 術語翻譯 first variant */
const TEN_GOD_GUIDE_LABELS: Record<string, string> = {
  '食神': '創造力天賦',
  '傷官': '叛逆創意天賦',
  '正財': '穩定收入天賦',
  '偏財': '意外收入天賦',
  '正官': '自律管理天賦',
  '偏官': '壓力驅動力',
  '正印': '貴人支援',
  '偏印': '獨特才華',
  '比肩': '同伴屬性',
  '劫財': '資源競爭風險',
};

/**
 * Post-process AI section text before display:
 * 1) Rename legacy "攻略秘技" → "實戰建議" in cached readings
 * 2) Collapse extra blank lines after sub-headers (🔥 強項, ⚠️ 注意事項, 💡 實戰建議)
 * 3) Collapse extra blank lines after 大運 sub-headers (📍 總述, ◆/🔹 第一/第二階段, 💡 階段總結與建議)
 */
function postProcessSectionText(text: string): string {
  // 0) Rename legacy label from cached readings
  let result = text.replace(/💡\s*攻略秘技/g, '💡 實戰建議');
  // 1) Standard section sub-headers: collapse extra \n after 🔥 強項, ⚠️ 注意事項, 💡 實戰建議
  result = result.replace(
    /((?:🔥|⚠️|⚠|💡)\s*(?:強項|注意事項|實戰建議))\n{2,}/g,
    '$1\n',
  );
  // 2) 大運 sub-headers: 📍 總述, ◆/🔹 第一階段/第二階段 (with trailing content), 💡 階段總結與建議
  result = result.replace(
    /((?:📍|◆|🔹|💡)\s*(?:總述|第一階段|第二階段|階段總結與建議).*)\n{2,}/g,
    '$1\n',
  );
  return result;
}

/**
 * Parse AI-generated text into styled React elements:
 * - Lines starting with "- " become gold-dot list items
 * - Emoji sub-headers (🔥 強項 etc.) become styled sub-headers
 * - Other text becomes paragraphs
 */
function renderFormattedContent(text: string): React.ReactNode {
  const processed = postProcessSectionText(text);
  const lines = processed.split('\n');
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={key++} className={styles.goldBulletList}>
        {bulletBuffer.map((item, i) => {
          // Detect category:items pattern (e.g., "傳媒與娛樂：傳媒業、廣告、演藝")
          // Only apply when colon is NOT at position 0, and content after colon has comma-separated items
          const colonIdx = item.indexOf('：');
          if (colonIdx > 0 && colonIdx < item.length - 1) {
            const afterColon = item.slice(colonIdx + 1).trim();
            // Heuristic: if after-colon part has Chinese commas (頓號) → category:items pattern
            if (afterColon.includes('、')) {
              const category = item.slice(0, colonIdx);
              const items = afterColon;
              return (
                <li key={i} className={`${styles.goldBulletItem} ${styles.goldBulletItemCategory}`}>
                  <span className={styles.bulletCategory}>{category}</span>
                  <span className={styles.bulletCategoryItems}>{items}</span>
                </li>
              );
            }
          }
          return <li key={i} className={styles.goldBulletItem}>{item}</li>;
        })}
      </ul>
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Bullet line: starts with "- ", "– ", "·", "‧", or "・"
    if (/^[-–·‧・]\s*/.test(trimmed)) {
      bulletBuffer.push(trimmed.replace(/^[-–·‧・]\s*/, ''));
      continue;
    }

    // Non-bullet line — flush any pending bullets first
    flushBullets();

    // Empty line
    if (trimmed === '') continue;

    // Emoji sub-header (🔥 強項, ⚠️ 注意事項, 💡 實戰建議, etc.)
    if (/^(?:🔥|⚠️|⚠|💡|📍|◆|🔹|⭐|🌟|💎|🎯|💰|💼|💕|🏥|📊|🔮)/.test(trimmed)) {
      elements.push(
        <div key={key++} className={styles.contentSubHeader}>{trimmed}</div>
      );
      continue;
    }

    // Regular text paragraph
    elements.push(
      <p key={key++} className={styles.contentParagraph}>{trimmed}</p>
    );
  }

  // Flush remaining bullets
  flushBullets();

  return <>{elements}</>;
}

function numberToChinese(n: number): string {
  const digits = ['零','一','二','三','四','五','六','七','八','九','十'];
  if (n <= 10) return digits[n] ?? String(n);
  if (n < 20) return `十${digits[n - 10] ?? ''}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${digits[tens] ?? ''}十${ones ? (digits[ones] ?? '') : ''}`;
}

/** Extract the luck period and ordinal label for a timing section key */
function getLuckPeriodForSection(
  sectionKey: string,
  periods: LuckPeriodDetailData[],
  bestPeriod: LuckPeriodDetailData | null,
): { period: LuckPeriodDetailData; ordinalLabel: string } | null {
  if (sectionKey === 'current_period') {
    const p = periods.find(p => p.isCurrent);
    if (!p) return null;
    return {
      period: p,
      ordinalLabel: p.periodOrdinal ? `第${numberToChinese(p.periodOrdinal)}大運` : '',
    };
  }
  if (sectionKey === 'next_period') {
    const currentIdx = periods.findIndex(p => p.isCurrent);
    if (currentIdx < 0 || currentIdx + 1 >= periods.length) return null;
    const p = periods[currentIdx + 1];
    if (!p) return null;
    return {
      period: p,
      ordinalLabel: p.periodOrdinal ? `第${numberToChinese(p.periodOrdinal)}大運` : '',
    };
  }
  if (sectionKey === 'best_period') {
    if (!bestPeriod) return null;
    return {
      period: bestPeriod,
      ordinalLabel: bestPeriod.periodOrdinal ? `第${numberToChinese(bestPeriod.periodOrdinal)}大運` : '',
    };
  }
  return null;
}

function LuckPeriodHeader({
  period,
  ordinalLabel,
  isSubscriber,
}: {
  period: LuckPeriodDetailData;
  ordinalLabel: string;
  isSubscriber: boolean;
}) {
  const scoreColor = getScoreColor(period.score);
  const midYear = period.startYear + 5;

  const stemTgLabel = TEN_GOD_GUIDE_LABELS[period.stemTenGod || ''] || period.stemTenGod || '';
  const branchTgLabel = TEN_GOD_GUIDE_LABELS[period.branchTenGod || ''] || period.branchTenGod || '';
  const stemEl = period.stemElement || '';
  const branchEl = period.branchElement || '';

  return (
    <div className={styles.luckPeriodHeader} data-theme="timing">
      <div className={styles.lphTitle}>
        {ordinalLabel && <span className={styles.lphOrdinal}>{ordinalLabel}</span>}
        <span className={styles.lphGanzhi}>{period.stem}{period.branch}運</span>
        <span className={styles.lphYears}>{period.startYear}-{period.endYear}</span>
      </div>
      <div className={styles.lphPhases}>
        <div className={styles.lphPhase}>
          <span className={styles.lphPhaseLabel}>🔹 第一階段</span>
          <span className={styles.lphPhaseDesc}>
            {period.stem}{stemEl}{stemTgLabel}（{period.startYear}-{midYear - 1}）
          </span>
        </div>
        <div className={styles.lphPhase}>
          <span className={styles.lphPhaseLabel}>🔹 第二階段</span>
          <span className={styles.lphPhaseDesc}>
            {period.branch}{branchEl}{branchTgLabel}（{midYear}-{period.endYear}）
          </span>
        </div>
      </div>
      {isSubscriber && (
        <div className={styles.lphScore}>
          <span className={styles.lphScoreLabel}>綜合評分</span>
          <span className={styles.lphScoreValue} style={{ color: scoreColor }}>
            {period.score}分
          </span>
        </div>
      )}
    </div>
  );
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
                    backgroundColor: isSubscriber ? scoreColor : "var(--text-muted)",
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

// getScoreColor imported from ../lib/score-utils

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
