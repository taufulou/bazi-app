// ============================================================
// Core Bazi Types
// ============================================================

/** 天干 Heavenly Stems */
export type HeavenlyStem = '甲' | '乙' | '丙' | '丁' | '戊' | '己' | '庚' | '辛' | '壬' | '癸';

/** 地支 Earthly Branches */
export type EarthlyBranch = '子' | '丑' | '寅' | '卯' | '辰' | '巳' | '午' | '未' | '申' | '酉' | '戌' | '亥';

/** 五行 Five Elements */
export type FiveElement = '木' | '火' | '土' | '金' | '水';
export type FiveElementEnglish = 'wood' | 'fire' | 'earth' | 'metal' | 'water';

/** 陰陽 Yin/Yang */
export type YinYang = '陰' | '陽';

/** 十神 Ten Gods */
export type TenGod =
  | '比肩' | '劫財'   // Same element (Companion, Rob Wealth)
  | '食神' | '傷官'   // Element I produce (Eating God, Hurting Officer)
  | '偏財' | '正財'   // Element I overcome (Indirect Wealth, Direct Wealth)
  | '偏官' | '正官'   // Element that overcomes me (Indirect Officer, Direct Officer)
  | '偏印' | '正印';  // Element that produces me (Indirect Seal, Direct Seal)

/** Gender */
export type Gender = 'male' | 'female';

/** Supported languages */
export type Language = 'zh-TW' | 'zh-CN';

/** Reading types available in V1 */
export type ReadingType =
  | 'lifetime'           // 八字終身運
  | 'annual'             // 八字流年運勢
  | 'career'             // 事業財運
  | 'love'               // 愛情姻緣
  | 'health'             // 先天健康分析
  | 'compatibility'      // 八字合盤比較
  | 'zwds-lifetime'      // 紫微終身運
  | 'zwds-annual'        // 紫微流年運
  | 'zwds-career'        // 紫微事業運
  | 'zwds-love'          // 紫微愛情運
  | 'zwds-health'        // 紫微健康運
  | 'zwds-compatibility'; // 紫微合盤

/** Comparison type for compatibility readings */
export type ComparisonType = 'romance' | 'business' | 'friendship';

/** Subscription tiers */
export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'master';

/** Subscription status */
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'past_due';

/** AI providers */
export type AIProvider = 'claude' | 'gpt' | 'gemini';

/** Payment providers */
export type PaymentProvider = 'stripe' | 'apple_iap' | 'google_play' | 'line_pay' | 'paypal' | 'alipay';

/** Payment regions */
export type PaymentRegion = 'global' | 'taiwan' | 'hong_kong' | 'malaysia';

/** Relationship tag for birth profiles */
export type RelationshipTag = 'self' | 'family' | 'friend';

// ============================================================
// Bazi Calculation Types (Layer 1 output)
// ============================================================

/** A single pillar (柱) */
export interface Pillar {
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  stemElement: FiveElement;
  branchElement: FiveElement;
  stemYinYang: YinYang;
  hiddenStems: HeavenlyStem[];
  tenGod: TenGod | null; // null for Day Pillar (it's the Day Master)
  naYin: string;
  shenSha: string[];
}

/** Four Pillars (四柱) */
export interface FourPillars {
  year: Pillar;   // 年柱
  month: Pillar;  // 月柱
  day: Pillar;    // 日柱 (Day Master)
  hour: Pillar;   // 時柱
}

/** Five Elements balance */
export interface FiveElementsBalance {
  wood: number;   // percentage
  fire: number;
  earth: number;
  metal: number;
  water: number;
}

/** Day Master analysis */
export interface DayMasterAnalysis {
  element: FiveElement;
  yinYang: YinYang;
  strength: 'very_weak' | 'weak' | 'neutral' | 'strong' | 'very_strong';
  strengthScore: number; // 0-100
  pattern: string; // 格局 e.g. 食神格, 正官格
  favorableGod: FiveElement;   // 喜神
  usefulGod: FiveElement;      // 用神
  idleGod: FiveElement;        // 閒神
  tabooGod: FiveElement;       // 忌神
  enemyGod: FiveElement;       // 仇神
}

/** Luck Period (大運) */
export interface LuckPeriod {
  startAge: number;
  endAge: number;
  startYear: number;
  endYear: number;
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  tenGod: TenGod;
  isCurrent: boolean;
}

/** Annual Star (流年) */
export interface AnnualStar {
  year: number;
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  tenGod: TenGod;
}

/** Monthly Star (流月) */
export interface MonthlyStar {
  month: number;
  solarTermDate: string;
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  tenGod: TenGod;
}

/** True Solar Time adjustment details */
export interface TrueSolarTime {
  clockTime: string;         // Original clock time
  trueSolarTime: string;     // Adjusted true solar time
  longitudeOffset: number;   // Minutes offset from longitude
  equationOfTime: number;    // Minutes from Equation of Time
  totalAdjustment: number;   // Total minutes adjustment
  birthCity: string;
  birthLongitude: number;
  birthLatitude: number;
}

/** Complete Bazi calculation result (Layer 1 output) */
export interface BaziCalculationResult {
  fourPillars: FourPillars;
  fiveElementsBalance: FiveElementsBalance;
  dayMaster: DayMasterAnalysis;
  luckPeriods: LuckPeriod[];
  annualStars: AnnualStar[];
  monthlyStars: MonthlyStar[];
  trueSolarTime: TrueSolarTime;
  lunarDate: {
    year: number;
    month: number;
    day: number;
    isLeapMonth: boolean;
  };
}

// ============================================================
// AI Interpretation Types (Layer 2 output)
// ============================================================

/** A single section of AI interpretation with preview/full for paywall */
export interface InterpretationSection {
  preview: string;  // First paragraph, shown to free users
  full: string;     // Complete text, shown to subscribers
}

/** Structured AI interpretation output */
export interface AIInterpretation {
  personality?: InterpretationSection;   // 命格性格分析
  career?: InterpretationSection;        // 事業發展分析
  love?: InterpretationSection;          // 感情婚姻分析
  finance?: InterpretationSection;       // 一生財運分析
  health?: InterpretationSection;        // 先天健康分析
  compatibility?: InterpretationSection; // 合盤比較 (only for compatibility readings)
  summary?: InterpretationSection;       // Overall summary
}

/** Token usage tracking */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

// ============================================================
// API Request/Response Types
// ============================================================

/** Birth data input for calculation */
export interface BirthDataInput {
  name: string;
  gender: Gender;
  birthDate: string;       // ISO date string YYYY-MM-DD
  birthTime: string;       // HH:MM format
  birthCity: string;       // City name for geocoding
  birthTimezone: string;   // IANA timezone e.g. 'Asia/Taipei'
  relationshipTag?: RelationshipTag;
}

/** Request for a Bazi reading */
export interface ReadingRequest {
  birthProfileId: string;
  readingType: ReadingType;
  targetYear?: number;     // For annual readings
  language: Language;
}

/** Request for a compatibility comparison */
export interface ComparisonRequest {
  profileAId: string;
  profileBId: string;
  comparisonType: ComparisonType;
  language: Language;
}

/** Reading response */
export interface ReadingResponse {
  id: string;
  readingType: ReadingType;
  calculation: BaziCalculationResult;
  interpretation: AIInterpretation;
  aiProvider: AIProvider;
  createdAt: string;
  isFullAccess: boolean;   // Whether user has full access (subscriber) or preview only
}

/** API error response */
export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
}

// ============================================================
// User & Auth Types
// ============================================================

/** User profile from our DB (supplementing Clerk auth) */
export interface UserProfile {
  id: string;
  clerkUserId: string;
  name: string;
  avatarUrl?: string;
  subscriptionTier: SubscriptionTier;
  credits: number;
  languagePref: Language;
  freeReadingUsed: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Birth profile saved by user */
export interface BirthProfile {
  id: string;
  userId: string;
  name: string;
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthTimezone: string;
  gender: Gender;
  relationshipTag: RelationshipTag;
  isPrimary: boolean;
  createdAt: string;
}

// ============================================================
// Admin Types
// ============================================================

/** Service/product entry (admin-configurable) */
export interface Service {
  id: string;
  slug: string;
  nameZhTw: string;
  nameZhCn: string;
  descriptionZhTw: string;
  descriptionZhCn: string;
  type: ReadingType;
  creditCost: number;
  isActive: boolean;
  sortOrder: number;
}

/** Subscription plan (admin-configurable) */
export interface Plan {
  id: string;
  slug: string;
  nameZhTw: string;
  nameZhCn: string;
  priceMonthly: number;
  priceAnnual: number;
  currency: string;
  features: string[];
  readingsPerMonth: number;
  isActive: boolean;
  sortOrder: number;
}

/** Promo code */
export interface PromoCode {
  id: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  maxUses: number;
  currentUses: number;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
}
