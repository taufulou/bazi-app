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
}> = {
  lifetime: {
    nameZhTw: '八字終身運',
    nameZhCn: '八字终身运',
    nameEn: 'Lifetime Destiny',
    icon: '🌟',
    themeColor: '#FFD700',
    creditCost: 2,
    description: {
      'zh-TW': '全面分析您的八字命盤，深入了解一生的命運走向',
      'zh-CN': '全面分析您的八字命盘，深入了解一生的命运走向',
    },
  },
  annual: {
    nameZhTw: '八字流年運勢',
    nameZhCn: '八字流年运势',
    nameEn: 'Annual Fortune',
    icon: '📅',
    themeColor: '#9C27B0',
    creditCost: 2,
    description: {
      'zh-TW': '預測您今年的運勢變化，掌握每月吉凶',
      'zh-CN': '预测您今年的运势变化，掌握每月吉凶',
    },
  },
  career: {
    nameZhTw: '事業財運',
    nameZhCn: '事业财运',
    nameEn: 'Career & Finance',
    icon: '💼',
    themeColor: '#2196F3',
    creditCost: 2,
    description: {
      'zh-TW': '分析事業發展方向與財運走勢，找到最佳機遇',
      'zh-CN': '分析事业发展方向与财运走势，找到最佳机遇',
    },
  },
  love: {
    nameZhTw: '愛情姻緣',
    nameZhCn: '爱情姻缘',
    nameEn: 'Love & Marriage',
    icon: '💕',
    themeColor: '#E91E63',
    creditCost: 2,
    description: {
      'zh-TW': '探索感情運勢，了解理想伴侶特質與姻緣時機',
      'zh-CN': '探索感情运势，了解理想伴侣特质与姻缘时机',
    },
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
    readingsPerMonth: -1, // unlimited
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
// API Configuration
// ============================================================

export const AI_TIMEOUT_MS = 10_000; // 10 second timeout before failover
export const AI_MAX_RETRIES = 1;     // 1 retry per provider before failover
export const CACHE_TTL_DAYS = 30;    // Reading cache expires after 30 days

export const SESSION_EXPIRY_DAYS = 90; // Clerk session expiry
