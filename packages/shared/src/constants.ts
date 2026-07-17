import type {
  HeavenlyStem,
  EarthlyBranch,
  FiveElement,
  YinYang,
  ReadingType,
  Language,
} from './types';

// ============================================================
// Heavenly Stems (天干) & Earthly Branches (地支)
// ============================================================

export const HEAVENLY_STEMS: HeavenlyStem[] = [
  '甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸',
];

export const EARTHLY_BRANCHES: EarthlyBranch[] = [
  '子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥',
];

// ============================================================
// Five Elements (五行) Mappings
// ============================================================

/** Stem to Element mapping */
export const STEM_ELEMENT_MAP: Record<HeavenlyStem, FiveElement> = {
  '甲': '木', '乙': '木',
  '丙': '火', '丁': '火',
  '戊': '土', '己': '土',
  '庚': '金', '辛': '金',
  '壬': '水', '癸': '水',
};

/** Branch to Element mapping */
export const BRANCH_ELEMENT_MAP: Record<EarthlyBranch, FiveElement> = {
  '寅': '木', '卯': '木',
  '巳': '火', '午': '火',
  '辰': '土', '未': '土', '戌': '土', '丑': '土',
  '申': '金', '酉': '金',
  '子': '水', '亥': '水',
};

/** Stem Yin/Yang mapping */
export const STEM_YINYANG_MAP: Record<HeavenlyStem, YinYang> = {
  '甲': '陽', '乙': '陰',
  '丙': '陽', '丁': '陰',
  '戊': '陽', '己': '陰',
  '庚': '陽', '辛': '陰',
  '壬': '陽', '癸': '陰',
};

/** Branch Yin/Yang mapping */
export const BRANCH_YINYANG_MAP: Record<EarthlyBranch, YinYang> = {
  '子': '陽', '丑': '陰',
  '寅': '陽', '卯': '陰',
  '辰': '陽', '巳': '陰',
  '午': '陽', '未': '陰',
  '申': '陽', '酉': '陰',
  '戌': '陽', '亥': '陰',
};

/** Five Elements cycle: production (相生) */
export const ELEMENT_PRODUCES: Record<FiveElement, FiveElement> = {
  '木': '火',  // Wood produces Fire
  '火': '土',  // Fire produces Earth
  '土': '金',  // Earth produces Metal
  '金': '水',  // Metal produces Water
  '水': '木',  // Water produces Wood
};

/** Five Elements cycle: overcoming (相剋) */
export const ELEMENT_OVERCOMES: Record<FiveElement, FiveElement> = {
  '木': '土',  // Wood overcomes Earth
  '土': '水',  // Earth overcomes Water
  '水': '火',  // Water overcomes Fire
  '火': '金',  // Fire overcomes Metal
  '金': '木',  // Metal overcomes Wood
};

/** Element colors for UI display */
export const ELEMENT_COLORS: Record<FiveElement, string> = {
  '木': '#4CAF50', // Green
  '火': '#F44336', // Red
  '土': '#FF9800', // Orange/Brown
  '金': '#FFD700', // Gold
  '水': '#2196F3', // Blue
};

/** Element English names */
export const ELEMENT_ENGLISH: Record<FiveElement, string> = {
  '木': 'Wood',
  '火': 'Fire',
  '土': 'Earth',
  '金': 'Metal',
  '水': 'Water',
};

// ============================================================
// Hidden Stems (藏干) Lookup
// ============================================================

export const HIDDEN_STEMS: Record<EarthlyBranch, HeavenlyStem[]> = {
  '子': ['癸'],
  '丑': ['己', '癸', '辛'],
  '寅': ['甲', '丙', '戊'],
  '卯': ['乙'],
  '辰': ['戊', '乙', '癸'],
  '巳': ['丙', '庚', '戊'],
  '午': ['丁', '己'],
  '未': ['己', '丁', '乙'],
  '申': ['庚', '壬', '戊'],
  '酉': ['辛'],
  '戌': ['戊', '辛', '丁'],
  '亥': ['壬', '甲'],
};

// ============================================================
// Reading Type Metadata
// ============================================================

export const READING_TYPE_META: Record<ReadingType, {
  nameZhTw: string;
  nameZhCn: string;
  nameEn: string;
  icon: string;
  themeColor: string;
  creditCost: number;
  description: Record<Language, string>;
  /**
   * Web-only Next.js /public path to homepage feature-card artwork
   * (e.g. "/features/lifetime.webp"). Optional — unset entries fall back to `icon`.
   * NOT a portable asset id; apps/mobile must resolve its own artwork separately.
   */
  image?: string;
}> = {
  lifetime: {
    nameZhTw: '八字終身運',
    nameZhCn: '八字终身运',
    nameEn: 'Lifetime Destiny',
    icon: '🌟',
    themeColor: '#FFD700',
    creditCost: 3,
    description: {
      'zh-TW': '全面分析您的八字命盤，深入了解一生的命運走向',
      'zh-CN': '全面分析您的八字命盘，深入了解一生的命运走向',
    },
    image: '/features/lifetime.webp',
  },
  annual: {
    nameZhTw: '八字流年運勢',
    nameZhCn: '八字流年运势',
    nameEn: 'Annual Fortune',
    icon: '📅',
    themeColor: '#9C27B0',
    creditCost: 3,
    description: {
      'zh-TW': '預測您今年的運勢變化，掌握每月吉凶',
      'zh-CN': '预测您今年的运势变化，掌握每月吉凶',
    },
    image: '/features/annual.webp',
  },
  career: {
    nameZhTw: '八字事業詳批',
    nameZhCn: '八字事业详批',
    nameEn: 'Career Detailed Reading',
    icon: '💼',
    themeColor: '#2196F3',
    creditCost: 3,
    description: {
      // Trimmed 30→26 chars so it fits the home card's 2-line clamp in full
      // (~13-14 CJK per line at 15pt). All three hooks kept: 最佳職業方向 /
      // 財富格局 / 發展時機. NOTE: shared with web — keep any rewrite ≤27 chars.
      'zh-TW': '批算你的事業運，找出最佳職業方向、財富格局與發展時機',
      'zh-CN': '批算你的事业运，找出最佳职业方向、财富格局与发展时机',
    },
    image: '/features/career.webp',
  },
  love: {
    nameZhTw: '八字愛情姻緣',
    nameZhCn: '八字爱情姻缘',
    nameEn: 'Love & Marriage',
    icon: '💕',
    themeColor: '#E91E63',
    creditCost: 3,
    description: {
      // Trimmed 33→25 chars to fit the home card's 2-line clamp in full
      // (~13-14 CJK per line at 15pt). NOTE: shared with web — keep ≤27 chars.
      'zh-TW': '深度剖析先天桃花運，精準預測感情好壞年份與婚配建議',
      'zh-CN': '深度剖析先天桃花运，精准预测感情好坏年份与婚配建议',
    },
    image: '/features/love.webp',
  },
  health: {
    nameZhTw: '先天健康分析',
    nameZhCn: '先天健康分析',
    nameEn: 'Health Analysis',
    icon: '🏥',
    themeColor: '#4CAF50',
    creditCost: 2,
    description: {
      'zh-TW': '根據五行分析先天體質，提供養生保健建議',
      'zh-CN': '根据五行分析先天体质，提供养生保健建议',
    },
  },
  compatibility: {
    nameZhTw: '合盤比較',
    nameZhCn: '合盘比较',
    nameEn: 'Compatibility',
    icon: '🤝',
    themeColor: '#FF5722',
    creditCost: 3,
    description: {
      'zh-TW': '比較兩人八字，分析感情或事業合作的契合度',
      'zh-CN': '比较两人八字，分析感情或事业合作的契合度',
    },
    image: '/features/compatibility.webp',
  },
  'zwds-lifetime': {
    nameZhTw: '紫微終身運',
    nameZhCn: '紫微终身运',
    nameEn: 'ZWDS Lifetime',
    icon: '🌟',
    themeColor: '#9C27B0',
    creditCost: 2,
    description: {
      'zh-TW': '紫微斗數全面解讀，深入分析十二宮位與一生命運格局',
      'zh-CN': '紫微斗数全面解读，深入分析十二宫位与一生命运格局',
    },
  },
  'zwds-annual': {
    nameZhTw: '紫微流年運',
    nameZhCn: '紫微流年运',
    nameEn: 'ZWDS Annual',
    icon: '📅',
    themeColor: '#3F51B5',
    creditCost: 2,
    description: {
      'zh-TW': '紫微斗數流年分析，預測今年宮位四化變動與運勢起伏',
      'zh-CN': '紫微斗数流年分析，预测今年宫位四化变动与运势起伏',
    },
  },
  'zwds-career': {
    nameZhTw: '紫微事業運',
    nameZhCn: '紫微事业运',
    nameEn: 'ZWDS Career',
    icon: '💼',
    themeColor: '#009688',
    creditCost: 2,
    description: {
      'zh-TW': '分析事業宮、財帛宮三方四正，找到最佳職業方向',
      'zh-CN': '分析事业宫、财帛宫三方四正，找到最佳职业方向',
    },
  },
  'zwds-love': {
    nameZhTw: '紫微愛情運',
    nameZhCn: '紫微爱情运',
    nameEn: 'ZWDS Love',
    icon: '💕',
    themeColor: '#C2185B',
    creditCost: 2,
    description: {
      'zh-TW': '解讀夫妻宮星曜組合，了解理想伴侶與姻緣時機',
      'zh-CN': '解读夫妻宫星曜组合，了解理想伴侣与姻缘时机',
    },
  },
  'zwds-health': {
    nameZhTw: '紫微健康運',
    nameZhCn: '紫微健康运',
    nameEn: 'ZWDS Health',
    icon: '🏥',
    themeColor: '#8BC34A',
    creditCost: 2,
    description: {
      'zh-TW': '根據疾厄宮與五行局分析先天體質，提供養生保健方向',
      'zh-CN': '根据疾厄宫与五行局分析先天体质，提供养生保健方向',
    },
  },
  'zwds-compatibility': {
    nameZhTw: '紫微合盤',
    nameZhCn: '紫微合盘',
    nameEn: 'ZWDS Compatibility',
    icon: '🤝',
    themeColor: '#E64A19',
    creditCost: 3,
    description: {
      'zh-TW': '比較兩人紫微命盤，分析宮位星曜互動與契合度',
      'zh-CN': '比较两人紫微命盘，分析宫位星曜互动与契合度',
    },
  },
  'zwds-monthly': {
    nameZhTw: '紫微流月運',
    nameZhCn: '紫微流月运',
    nameEn: 'ZWDS Monthly',
    icon: '🗓️',
    themeColor: '#7B1FA2',
    creditCost: 1,
    description: {
      'zh-TW': '紫微斗數流月分析，掌握本月宮位四化與運勢重點',
      'zh-CN': '紫微斗数流月分析，掌握本月宫位四化与运势重点',
    },
  },
  'zwds-daily': {
    nameZhTw: '紫微每日運勢',
    nameZhCn: '紫微每日运势',
    nameEn: 'ZWDS Daily',
    icon: '☀️',
    themeColor: '#FF8F00',
    creditCost: 0,
    description: {
      'zh-TW': '每日紫微運勢提點，快速掌握今天的能量與建議',
      'zh-CN': '每日紫微运势提点，快速掌握今天的能量与建议',
    },
  },
  'zwds-major-period': {
    nameZhTw: '紫微大限分析',
    nameZhCn: '紫微大限分析',
    nameEn: 'ZWDS Major Period',
    icon: '🔄',
    themeColor: '#5C6BC0',
    creditCost: 2,
    description: {
      'zh-TW': '深度分析大限轉運期，了解十年運程的重大轉變與機遇',
      'zh-CN': '深度分析大限转运期，了解十年运程的重大转变与机遇',
    },
  },
  'zwds-qa': {
    nameZhTw: '紫微問事',
    nameZhCn: '紫微问事',
    nameEn: 'ZWDS Q&A',
    icon: '❓',
    themeColor: '#00897B',
    creditCost: 1,
    description: {
      'zh-TW': '針對特定問題，結合紫微命盤與流年分析給出具體建議',
      'zh-CN': '针对特定问题，结合紫微命盘与流年分析给出具体建议',
    },
  },
};

// ============================================================
// Reading Type Cost Tiers (for admin AI cost analytics)
// ============================================================

/** Cost tier for a reading type — groups readings by complexity/token usage */
export type ReadingCostTier = 'comprehensive' | 'periodic' | 'daily' | 'qa' | 'unclassified';

/**
 * Maps each Prisma ReadingType enum value (uppercase) to its cost tier.
 * Used by both NestJS admin service and Next.js admin page.
 */
export const READING_TYPE_TIERS: Record<string, { tier: ReadingCostTier; label: string }> = {
  LIFETIME:           { tier: 'comprehensive', label: 'Bazi Lifetime' },
  CAREER:             { tier: 'comprehensive', label: 'Bazi Career' },
  LOVE:               { tier: 'comprehensive', label: 'Bazi Love' },
  HEALTH:             { tier: 'comprehensive', label: 'Bazi Health' },
  COMPATIBILITY:      { tier: 'comprehensive', label: 'Bazi Compatibility' },
  ZWDS_LIFETIME:      { tier: 'comprehensive', label: 'ZWDS Lifetime' },
  ZWDS_CAREER:        { tier: 'comprehensive', label: 'ZWDS Career' },
  ZWDS_LOVE:          { tier: 'comprehensive', label: 'ZWDS Love' },
  ZWDS_HEALTH:        { tier: 'comprehensive', label: 'ZWDS Health' },
  ZWDS_COMPATIBILITY: { tier: 'comprehensive', label: 'ZWDS Compatibility' },
  ZWDS_MAJOR_PERIOD:  { tier: 'comprehensive', label: 'ZWDS Major Period' },
  ANNUAL:             { tier: 'periodic', label: 'Bazi Annual' },
  // FORTUNE (八字日/月/年運) — free/subscriber surface, NOT a purchasable reading
  // (so it is intentionally absent from the ReadingType union + READING_TYPE_META).
  // Listed here only so admin cost-bucketing classifies FORTUNE chat sessions
  // instead of falling through to «unclassified».
  FORTUNE:            { tier: 'periodic', label: 'Bazi Fortune (日/月/年運)' },
  ZWDS_ANNUAL:        { tier: 'periodic', label: 'ZWDS Annual' },
  ZWDS_MONTHLY:       { tier: 'periodic', label: 'ZWDS Monthly' },
  ZWDS_DAILY:         { tier: 'daily', label: 'ZWDS Daily' },
  ZWDS_QA:            { tier: 'qa', label: 'ZWDS Q&A' },
};

/** Display order for tiers in admin UI */
export const TIER_ORDER: ReadingCostTier[] = [
  'comprehensive', 'periodic', 'daily', 'qa', 'unclassified',
];

/** Human-readable tier labels */
export const TIER_LABELS: Record<ReadingCostTier, string> = {
  comprehensive: 'Comprehensive',
  periodic: 'Periodic',
  daily: 'Daily',
  qa: 'Q&A',
  unclassified: 'Unclassified',
};

// ============================================================
// Rate Limits
// ============================================================

export const RATE_LIMITS = {
  GENERAL_API: { requests: 100, windowMs: 60_000 },        // 100 req/min per user
  BAZI_CALCULATION: { requests: 10, windowMs: 60_000 },     // 10 req/min per user
  AI_READING: { requests: 3, windowMs: 60_000 },            // 3 req/min per user
  LOGIN_ATTEMPTS: { requests: 5, windowMs: 60_000 },        // 5 req/min per IP
  GUEST_ENDPOINTS: { requests: 20, windowMs: 60_000 },      // 20 req/min per IP
} as const;

// ============================================================
// Subscription Plan Defaults
// ============================================================

export const DEFAULT_PLANS = {
  basic: {
    priceMonthly: 4.99,
    priceAnnual: 39.99,
    readingsPerMonth: 5,
  },
  pro: {
    priceMonthly: 9.99,
    priceAnnual: 79.99,
    readingsPerMonth: 15,
  },
  master: {
    priceMonthly: 19.99,
    priceAnnual: 159.99,
    readingsPerMonth: 50,
  },
} as const;

// ============================================================
// Disclaimers (Required for all readings)
// ============================================================

export const ENTERTAINMENT_DISCLAIMER: Record<Language, string> = {
  'zh-TW': '本服務僅供參考與娛樂用途，不構成任何專業建議。重要決定請諮詢相關專業人士。',
  'zh-CN': '本服务仅供参考与娱乐用途，不构成任何专业建议。重要决定请咨询相关专业人士。',
};

// ============================================================
// Love V2 Section Keys (single source of truth for frontend)
// ============================================================
// NOTE: NestJS files (ai.service.ts, prompts.ts) keep local string literals
// because @repo/shared has a known runtime import issue with NestJS.
// These constants are the canonical source — backend literals must stay in sync.

export const LOVE_V2_SECTION_KEYS = {
  PERSONALITY: 'love_personality',
  PEACH_BLOSSOM: 'peach_blossom_analysis',
  NATAL_MARRIAGE: 'natal_marriage',
  PARTNER_MATCHING: 'partner_matching',
  SPOUSE_APPEARANCE: 'spouse_appearance',
  ROMANCE_GOOD_YEARS: 'romance_good_years',
  ROMANCE_DANGER_YEARS: 'romance_danger_years',
  MARRIAGE_CHANGE_YEARS: 'marriage_change_years',
  LOVE_SUMMARY: 'love_summary',
} as const;

// ============================================================
// Compatibility Romance V2 Section Keys (frontend-only)
// ============================================================
// NestJS uses local string literals (cannot import @repo/shared at runtime).
// These are the canonical source — backend literals in prompts.ts must stay in sync.
// NOTE: ke_fu_ke_qi_education is static frontend content, not an AI section.

export const COMPAT_ROMANCE_V2_SECTION_KEYS = {
  COMPATIBILITY_BASIS: 'compatibility_basis',
  CHART_PROFILE_A: 'chart_profile_a',
  CHART_PROFILE_B: 'chart_profile_b',
  LOVE_PERSONALITY_A: 'love_personality_a',
  LOVE_PERSONALITY_B: 'love_personality_b',
  SPOUSE_ENRICHMENT_A: 'spouse_enrichment_a',
  SPOUSE_ENRICHMENT_B: 'spouse_enrichment_b',
  MARRIAGE_WEALTH_A: 'marriage_wealth_a',
  MARRIAGE_WEALTH_B: 'marriage_wealth_b',
  POST_MARRIAGE_SWEETNESS: 'post_marriage_sweetness',
  POST_MARRIAGE_STABILITY: 'post_marriage_stability',
  MARRIAGE_CRISIS_A: 'marriage_crisis_a',
  MARRIAGE_CRISIS_B: 'marriage_crisis_b',
  COMBINED_CRISIS_ANALYSIS: 'combined_crisis_analysis',
  MARRIAGE_ADVICE: 'marriage_advice',
  ANNUAL_LOVE_A: 'annual_love_a',
  ANNUAL_LOVE_B: 'annual_love_b',
  COMPATIBILITY_SUMMARY: 'compatibility_summary',
} as const;

// ============================================================
// Phase 2 chat — section keys lifted to shared (round-1 MED-#2)
// ============================================================
// Single source of truth for both AIReadingDisplay rendering AND the
// admin /admin/chat-questions sectionKey dropdown. Prevents the dropdown
// from drifting away from what's actually rendered. The arrays below
// MUST match V2_ALL_SECTION_KEYS / ANNUAL_V2_ALL_SECTION_KEYS exports
// in apps/web/app/components/AIReadingDisplay.tsx — that file now
// re-exports from these constants.

/** LIFETIME chat-eligible section keys (post-Phase-1, ~11 sections). */
export const LIFETIME_V2_SECTION_KEYS_ARRAY = [
  'chart_identity',
  'finance_pattern',
  'career_pattern',
  'boss_strategy',
  'love_pattern',
  'health',
  'children_analysis',
  'parents_analysis',
  'current_period',
  'next_period',
  'best_period',
] as const;

/** LOVE chat-eligible section keys (Phase 2). */
export const LOVE_V2_SECTION_KEYS_ARRAY = [
  LOVE_V2_SECTION_KEYS.PERSONALITY,
  LOVE_V2_SECTION_KEYS.PEACH_BLOSSOM,
  LOVE_V2_SECTION_KEYS.NATAL_MARRIAGE,
  LOVE_V2_SECTION_KEYS.PARTNER_MATCHING,
  LOVE_V2_SECTION_KEYS.SPOUSE_APPEARANCE,
  LOVE_V2_SECTION_KEYS.ROMANCE_GOOD_YEARS,
  LOVE_V2_SECTION_KEYS.ROMANCE_DANGER_YEARS,
  LOVE_V2_SECTION_KEYS.MARRIAGE_CHANGE_YEARS,
  LOVE_V2_SECTION_KEYS.LOVE_SUMMARY,
] as const;

/** CAREER chat-eligible section keys (Phase 2). Mirrors career_enhanced
 *  pre-analysis structure + career-specific frontend sections. */
export const CAREER_V2_SECTION_KEYS_ARRAY = [
  'career_personality',
  'career_pattern',
  'industry_match',
  'workplace_strategy',
  'boss_subordinate',
  'career_timing',
  'entrepreneurship',
  'partnership',
  'finance_at_work',
  'career_summary',
] as const;

/** ANNUAL chat-eligible section keys (Phase 2). Includes overview +
 *  per-month placeholders. monthly_NN keys are kept generic so admin can
 *  curate questions for "any month" rather than per-month. */
export const ANNUAL_V2_SECTION_KEYS_ARRAY = [
  'annual_overview',
  'annual_tai_sui',
  'annual_dayun_context',
  'annual_career',
  'annual_finance',
  'annual_relationships',
  'annual_love',
  'annual_family',
  'annual_health',
  'monthly_overview', // generic — applies to any monthly_NN section in render
] as const;

/** Map readingType → its canonical section-keys array. Used by:
 *  - chat sample-questions admin UI (sectionKey dropdown choices)
 *  - chat sample-questions service (whitelist guard on POST/PATCH).
 *  Also exposes the sentinel `null` for "general" floating-button questions. */
export const CHAT_SECTION_KEYS_BY_READING_TYPE: Record<
  'LIFETIME' | 'LOVE' | 'CAREER' | 'ANNUAL',
  readonly string[]
> = {
  LIFETIME: LIFETIME_V2_SECTION_KEYS_ARRAY,
  LOVE: LOVE_V2_SECTION_KEYS_ARRAY,
  CAREER: CAREER_V2_SECTION_KEYS_ARRAY,
  ANNUAL: ANNUAL_V2_SECTION_KEYS_ARRAY,
};

// ============================================================
// API Configuration
// ============================================================

export const AI_TIMEOUT_MS = 10_000; // 10 second timeout before failover
export const AI_MAX_RETRIES = 1;     // 1 retry per provider before failover
export const CACHE_TTL_DAYS = 30;    // Reading cache expires after 30 days

export const SESSION_EXPIRY_DAYS = 90; // Clerk session expiry

// ============================================================
// AI Regeneration Limit
// ============================================================
// Single source of truth. NestJS files keep local mirrors with a
// `// mirrors @repo/shared REGENERATION_LIMIT` comment because @repo/shared
// has a known runtime import issue with NestJS (see notes above).
export const REGENERATION_LIMIT = 3;

// ============================================================
// AI Chat (per next-the-big-feature-proud-manatee plan)
// ============================================================
// NestJS files keep local mirrors of these constants since @repo/shared has
// a known runtime import issue (see "@repo/shared runtime issue" in CLAUDE.md).

/** Each credit purchase grants 10 messages of paid allowance in the current session. */
export const CHAT_INITIAL_MESSAGES_PER_CREDIT = 10;

/** Absolute hard cap on messages per chat session. Beyond this, user must start a new session. */
export const CHAT_SESSION_HARD_CAP_MESSAGES = 30;

/** After AI replies to this turn, soft warning fires recommending new session for quality. */
export const CHAT_SOFT_WARNING_TURN = 20;

/**
 * Topic-boundary refuse refund cap. The first N consecutive refused messages
 * get auto-refunded (forgive occasional mistakes). From the (N+1)th consecutive
 * refuse onward, the refund is suppressed — user pays for repeated off-topic
 * questions. Cost defense: every refuse still costs us an Anthropic API call,
 * so unlimited refunding on spam = uncovered cost.
 *
 * Counter resets to 0 whenever the user sends an in-topic message (existing
 * `consecutiveRefuses: { set: 0 }` behavior in chat-stream.service.ts).
 *
 * Aligned with `CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD` below so the user
 * gets a clear dialog the moment refunding stops.
 */
export const CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT = 2;

/**
 * Show the «超出範圍提醒» soft-warning dialog as soon as the user reaches this
 * many consecutive refuses. Set to LIMIT + 1 so the dialog fires on the
 * first refuse that is NOT refunded — user understands why their credit was
 * deducted.
 */
export const CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD =
  CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT + 1;

/** From this turn onwards, server injects <system-reminder> as user-role to re-ground context. */
export const CHAT_REGROUNDING_TRIGGER_TURN = 4;

/** Max characters of a user input message — hard cap to bound token cost + prompt-injection surface. */
export const CHAT_INPUT_MAX_LENGTH = 500;

/** Anthropic max_tokens for assistant output per message. */
export const CHAT_OUTPUT_MAX_TOKENS = 800;

/** Per-user rate limits (defense-in-depth on top of credit system). */
export const CHAT_SESSIONS_PER_HOUR = 5;
export const CHAT_MESSAGES_PER_MINUTE = 30;

/**
 * Subscriber free chat quota by tier. A "chat" = 1 user message + 1 AI reply.
 * FREE users always pay credits.
 */
export const CHAT_FREE_QUOTA_BY_TIER: Record<string, number> = {
  FREE: 0,
  BASIC: 15,
  PRO: 30,
  MASTER: 60,
};

/** PDPA retention: chat sessions hard-deleted after this many days. */
export const CHAT_HISTORY_RETENTION_DAYS = 365;

/** Sessions older than this are auto-rejected on next message attempt. */
export const CHAT_SESSION_MAX_AGE_HOURS = 24;

/** Page size for "Load 5 more" history pagination button. */
export const CHAT_HISTORY_LOAD_PAGE_SIZE = 5;
