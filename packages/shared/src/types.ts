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
  | 'career'             // 八字事業詳批
  | 'love'               // 愛情姻緣
  | 'health'             // 先天健康分析
  | 'compatibility'      // 八字合盤比較
  | 'zwds-lifetime'      // 紫微終身運
  | 'zwds-annual'        // 紫微流年運
  | 'zwds-career'        // 紫微事業運
  | 'zwds-love'          // 紫微愛情運
  | 'zwds-health'        // 紫微健康運
  | 'zwds-compatibility' // 紫微合盤
  | 'zwds-monthly'       // 紫微流月運
  | 'zwds-daily'         // 紫微每日運勢
  | 'zwds-major-period'  // 紫微大限分析
  | 'zwds-qa';           // 紫微問事

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

/** Strength score V2 (得令/得地/得勢 3-factor model) */
export interface StrengthScoreV2 {
  score: number;           // 0-100
  classification: 'very_weak' | 'weak' | 'neutral' | 'strong' | 'very_strong';
  factors: {
    deling: number;        // 得令 (seasonal) up to ~50
    dedi: number;          // 得地 (root depth) up to 30
    deshi: number;         // 得勢 (support) up to 20
  };
  lifeStage: string;       // e.g. '帝旺', '衰'
}

/** Day Master analysis */
export interface DayMasterAnalysis {
  element: FiveElement;
  yinYang: YinYang;
  strength: 'very_weak' | 'weak' | 'neutral' | 'strong' | 'very_strong';
  strengthScore: number; // 0-100 (V2 3-factor score, rounded to int)
  pattern: string; // 格局 e.g. 食神格, 正官格
  favorableGod: FiveElement;   // 喜神
  usefulGod: FiveElement;      // 用神
  idleGod: FiveElement;        // 閒神
  tabooGod: FiveElement;       // 忌神
  enemyGod: FiveElement;       // 仇神
  // V2 additions:
  strengthScoreV2?: StrengthScoreV2;
  sameParty?: number;          // % same element party
  oppositeParty?: number;      // % opposing element party
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
  fiveElementsBalanceRaw?: FiveElementsBalance;
  fiveElementsBalanceZh?: Record<FiveElement, number>;
  dayMaster: DayMasterAnalysis;
  dayMasterStem?: string;
  dayMasterBranch?: string;
  gender?: string;
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
  kongWang?: string[];
  kongWangPerPillar?: Record<string, string[]>;
  kongWangDisplay?: { day: string[]; year: string[] };
  seasonalStates?: Record<string, string>;
  taiYuan?: { stem: string; branch: string; naYin: string };
  mingGong?: { stem: string; branch: string; naYin: string };
  taiXi?: { stem: string; branch: string; naYin: string };
  luckPeriodStartInfo?: {
    startAge: number;
    startDate: string;
    yearsMonths: string;
    daysToTerm: number;
    direction: number;
  };
  elementCounts?: {
    stems: Record<string, number>;
    branches: Record<string, number>;
    hidden: Record<string, number>;
    total: Record<string, number>;
  };
  tenGodDistribution?: Record<string, number>;
  preAnalysis?: Record<string, unknown>;
  lifetimeEnhancedInsights?: {
    patternNarrative?: Record<string, unknown>;
    narrativeAnchors?: Record<string, string[]>;
    deterministic?: Record<string, unknown>;
    [key: string]: unknown;
  };
  // Phase 12 — Fix 2: 調候 advisory (structured; prompt layer renders Chinese)
  tiaohou?: TiaohouAdvisory | null;
  // Phase 12 — Fix 3: 桃花方位 (primary from 年支, optional secondary from 日支)
  taohuaDirections?: TaohuaDirections;
  // Phase 12 — Fix 4: 文昌貴人方位 (per 日干)
  wenchangDirection?: { branch: string; direction: string };
  // Phase 12 — Fix 4: 生肖貴人 (folk tradition, 六合 + 三合 from 年支)
  zodiacBenefactors?: ZodiacBenefactors;
}

// ============================================================
// Phase 12 — Fix 2: 調候 advisory types
// ============================================================

/**
 * Typed enumeration of classical 調候 phrase keys emitted by the engine.
 *
 * The engine emits one of these keys; `apps/api/src/ai/prompts.ts::
 * buildTiaohouSection` looks the key up in a Chinese phrase table. Unknown
 * key → throw (caught by AI pipeline → Sentry, advisory section omitted).
 *
 * Closure is enforced two ways:
 *  - Engine side: `packages/bazi-engine/tests/test_tiaohou.py::
 *    TestPhraseKeyClosure` asserts every realized (DM × month) combination
 *    produces a key in this union.
 *  - TS side: runtime guard in buildTiaohouSection rejects unknown keys.
 */
export type TiaohouClassicalPhraseKey =
  // 木 DM
  | 'cold_wood_needs_fire'     // 乙冬 / 甲子丑 需丙丁
  | 'cold_wood_needs_metal'    // 甲亥 需庚 (劈甲引火)
  | 'hot_wood_needs_water'     // 甲乙夏 需癸
  // 火 DM
  | 'cold_fire_needs_wood'     // 丙/丁 冬某月 需甲
  | 'cold_fire_needs_water'    // 丙 子/丑 需壬
  | 'hot_fire_needs_wood'      // 丁 夏某月 需甲
  | 'hot_fire_needs_water'     // 丙丁 巳午未 需壬
  // 土 DM
  | 'cold_earth_needs_fire'    // 戊己 冬月 需丙
  | 'cold_earth_needs_wood'    // 戊 冬某月 需甲
  | 'hot_earth_needs_water'    // 戊己 夏月 需癸/壬
  | 'hot_earth_needs_wood'     // 戊 夏某月 需甲
  // 金 DM
  | 'cold_metal_needs_fire'    // 庚辛 冬月 需丁/丙
  | 'cold_metal_needs_water'   // 辛亥 需壬
  | 'hot_metal_needs_fire'     // 庚未 需丁
  | 'hot_metal_needs_water'    // 庚辛 夏月 需壬
  // 水 DM
  | 'cold_water_needs_earth'   // 壬亥/壬子 需戊 (制水)
  | 'cold_water_needs_fire'    // 壬癸 丑 需丙
  | 'cold_water_needs_metal'   // 癸亥 需庚
  | 'hot_water_needs_water'    // 壬巳 需壬 (同氣為援)
  | 'hot_water_needs_metal';   // 壬癸 夏月 需辛/庚

export type TiaohouStatus =
  | 'present_strong'
  | 'present_weak'
  | 'combined'
  | 'clashed'
  | 'absent';

export type TiaohouSeasonalContext =
  | 'cold_winter'
  | 'hot_summer'
  | 'transitional';

export interface TiaohouAdvisory {
  primaryGod: string;
  secondaryGod: string | null;
  status: TiaohouStatus;
  combinedBy: string | null;
  clashedBy: string | null;
  seasonalContext: TiaohouSeasonalContext;
  classicalPhraseKey: TiaohouClassicalPhraseKey | null;
}

// ============================================================
// Phase 12 — Fix 3 & 4: direction + benefactor types
// ============================================================

export interface TaohuaDirectionEntry {
  source: '年支' | '日支';
  branch: string;
  direction: string;
}

export interface TaohuaDirections {
  primary?: TaohuaDirectionEntry;
  secondary?: TaohuaDirectionEntry;
}

export interface ZodiacBenefactorEntry {
  branch: string;
  zodiac: string;
  kind: 'liuhe' | 'sanhe';
}

export interface ZodiacBenefactors {
  liuhe?: ZodiacBenefactorEntry;
  sanhe: ZodiacBenefactorEntry[];
  /** Signals to the prompt layer to emit a folk-tradition disclaimer. */
  provenance: 'folk_tradition';
}

// ============================================================
// Phase 12b — Monthly scoring refinement types
// ============================================================
// Additive fields on monthly forecast entries. All optional — engines not on
// Phase 12b omit them entirely. See .claude/plans/bazi-phase-12b-monthly-refinements.md.

export interface FuYinInteraction {
  pillar: 'year' | 'month' | 'day' | 'hour';
  role: '用神' | '喜神' | '忌神' | '仇神' | '閒神';
  direction: 'upgrade' | 'downgrade';
  weight: number; // pillar role weight (0.5–1.0)
  applied: boolean; // whether the interaction actually moved the label
}

export interface OfficerSealActivation {
  /** 'sha_yin' = 七殺+印 相生; 'guan_yin' = 正官+印 相生. */
  pattern: 'sha_yin' | 'guan_yin';
  /** 'full' = 印 in 月支 本氣; 'partial' = 印 in 中氣. */
  level: 'full' | 'partial';
  /** 'positive' = 身弱 benefit; 'reverse' = 身強 mild negative. */
  direction: 'positive' | 'reverse';
  seal_source: 'benqi' | 'zhongqi';
}

export interface LiuHeBoundInteraction {
  /** E.g. '卯戌' or '寅亥'. */
  pair: string;
  natal_pillar: 'year' | 'month' | 'day' | 'hour';
  hua_element: '木' | '火' | '土' | '金' | '水';
  kind: 'bound_only';
  block_reason?:
    | 'zheng_he'
    | 'weaker_rooted'
    | 'hua_not_transparent'
    | 'hua_not_in_season'
    | 'flag_disabled_true_transformation';
}

export interface LiuHeTrueTransformation {
  pair: string;
  natal_pillar: 'year' | 'month' | 'day' | 'hour';
  hua_element: '木' | '火' | '土' | '金' | '水';
  kind: 'true_transformation';
  favorability: '用神' | '喜神' | '忌神' | '仇神' | '閒神';
}

/**
 * Optional Phase 12b fields appended to each monthly forecast entry.
 * Consumers should treat all as optional — a v0 engine emits none of these.
 *
 * Phase 12c additive fields (in-place extension, no rename per plan):
 *   liuHaiInteractions, chongKuRelease.
 */
export interface Phase12bMonthlyExtras {
  ruleTrace?: string[]; // capped at 10 entries (raised from 6 in Phase 12c)
  fuYinInteractions?: FuYinInteraction[];
  officerSealActivation?: OfficerSealActivation;
  boundInteractions?: LiuHeBoundInteraction[];
  trueTransformation?: LiuHeTrueTransformation;
  // Phase 12c additive fields (六害 role-aware penalty + 沖庫釋放方向性)
  liuHaiInteractions?: LiuHaiInteraction[];
  chongKuRelease?: ChongKuRelease | null;
  /** Option 2.5 (Bounded Decouple) — pre-year-combine checkpoint label
   *  exposed by `_compute_single_month` so the daily fortune pipeline
   *  can apply the year cap independently without double-counting. Used
   *  by Phase 2 monthly tab + Fortune subordination cap. Older engine
   *  snapshots predate the field — `?` makes the contract forward-compat.
   *  See: packages/bazi-engine/app/annual_enhanced.py:2156. */
  bareMonthAuspiciousness?: string;
}

// ============================================================
// Phase 12c — 六害 role-aware penalty + 沖庫釋放方向性 types
// ============================================================
// Additive optional fields on monthly forecast entries. Engines pre-12c
// omit them entirely. See .claude/plans/bazi-phase-12c-six-harms-and-tomb-release.md.

/**
 * 六害 / 子卯刑 interaction descriptor.
 *
 * Fix E covers the 6 害 pairs (per branch_relationships.SIX_HARMS):
 *   子-未, 丑-午, 寅-巳 (無恩之害), 卯-辰, 申-亥, 酉-戌
 * Plus 1 piggybacked 六刑 pair via Fix E machinery:
 *   子-卯 (無禮之刑) — kind: 'liuxing_ziwei'
 *
 * 寅巳 (無恩之害) carries a 1.2× wuEn modifier per 《三命通會》.
 */
export interface LiuHaiInteraction {
  /** Pair label, sorted alphabetically (e.g., '寅-巳', '子-卯'). */
  pair: string;
  kind: 'liuhai' | 'liuxing_ziwei';
  pillar: 'year' | 'month' | 'day' | 'hour';
  role: '用神' | '喜神' | '忌神' | '仇神' | '閒神';
  /** True for 寅巳 / 巳寅 ("無恩之害" — magnitude × 1.2). */
  wuEn: boolean;
  /** 0.5 if 六合 binds harmed branch, else 1.0. */
  dampening: number;
  /** Final per-pillar score after wuEn × dampening. 0 for 忌/仇/閒 hits. */
  effectiveScore: number;
  /** True if this entry contributed to the (single) -1 label downgrade.
   *  Cap doctrine: 害 is 暗箭, max -1 step per month total. */
  applied: boolean;
}

/**
 * 沖庫釋放 direction-aware release descriptor.
 *
 * Fix F fires when:
 *   - flow_month_branch ∈ {辰戌丑未}
 *   - At least one natal pillar branch ∈ {辰戌丑未} forming 沖 with flow
 *   - Not 從格
 *
 * Net role score = 0.6×r(本氣) + 0.3×r(中氣) + 0.1×r(餘氣)
 * Role values: 用=+1.0, 喜=+0.6, 閒=0, 仇=-0.6, 忌=-1.0
 * v1 ladder (downgrade-only): net ≤ -0.5 → action='downgrade', steps=1.
 * Upgrade path (net ≥ +0.5) deferred to Phase 12d.
 *
 * DOCTRINE: stem rescue cancels SHAPE MODIFIERS but NOT STRUCTURAL RELEASES.
 * Source: 《滴天髓·論墓庫》「庫沖則開, 開則藏干釋放, 不論天干能否化」.
 */
export interface ChongKuReleasedStem {
  stem: string;
  position: 'benqi' | 'zhongqi' | 'yuqi';
  tenGod: string;
  role: string;
  weight: number; // 0.6 / 0.3 / 0.1 per HIDDEN_STEM_WEIGHTS
}

export interface ChongKuRelease {
  natalPillar: 'year' | 'month' | 'day' | 'hour';
  natalBranch: '辰' | '戌' | '丑' | '未';
  releasedStems: ChongKuReleasedStem[];
  netRoleScore: number;
  /** v1 downgrade-only. Upgrade path is Phase 12d. */
  action: 'downgrade';
  steps: 1;
  /** Always false in v1 — doctrine asserts stem cannot cancel structural release. */
  stemRescueApplied: false;
}

// ============================================================
// AI Interpretation Types (Layer 2 output)
// ============================================================

/** A single section of AI interpretation with preview/full for paywall */
export interface InterpretationSection {
  preview: string;  // First paragraph, shown to free users
  full: string;     // Complete text, shown to subscribers
}

/** V1 Structured AI interpretation output (flat section keys) */
export interface AIInterpretationV1 {
  schemaVersion?: undefined;             // V1 has no version field (backward compat)
  personality?: InterpretationSection;   // 命格性格分析
  career?: InterpretationSection;        // 事業發展分析
  love?: InterpretationSection;          // 感情婚姻分析
  finance?: InterpretationSection;       // 一生財運分析
  health?: InterpretationSection;        // 先天健康分析
  compatibility?: InterpretationSection; // 合盤比較 (only for compatibility readings)
  summary?: InterpretationSection;       // Overall summary
}

/** Enriched luck period detail for V2 lifetime reading */
export interface LuckPeriodDetail {
  stem: string;
  branch: string;
  startAge: number;
  endAge: number;
  startYear: number;
  endYear: number;
  tenGod?: string;          // ten god of LP stem relative to DM
  stemTenGod?: string;      // ten god of LP stem
  branchTenGod?: string;    // ten god of LP branch main qi
  score: number;           // 0-100, formula-computed
  stemPhase: string;       // narrative hint for years 1-5
  branchPhase: string;     // narrative hint for years 6-10
  interactions: string[];  // pre-computed interactions (六沖, 三刑, etc.)
  isCurrent: boolean;
}

/** Career direction entry with conceptual anchor and industries */
export interface CareerDirection {
  anchor: string;
  category: string;
  industries: string[];
}

/** Deterministic data for V2 lifetime reading (not AI-generated) */
export interface LifetimeV2Deterministic {
  favorableInvestments: string[];
  unfavorableInvestments: string[];
  careerDirections: CareerDirection[];
  favorableDirection: string;
  careerBenefactorsElement: string[];
  careerBenefactorsZodiac: string[];
  partnerElement: string[];
  partnerZodiac: string[];
  romanceYears: number[];
  romanceWarningYears?: number[];
  parentHealthYears: { father: number[]; mother: number[] };
  luckPeriodsEnriched: LuckPeriodDetail[];
  bestPeriod: LuckPeriodDetail | null;
  annualTenGod: string;
}

/** Deterministic data for V2 career reading (not AI-generated) */
export interface CareerV2Deterministic {
  weightedElements: Record<string, { percentage: number; level: string; talents: string[] }>;
  weightedTenGods: Record<string, { percentage: number; level: string; capabilities: string[] }>;
  reputationScore: { score: number; level: string; subScores: Record<string, number> };
  wealthScore: { score: number; tier: string; subScores: Record<string, number> };
  fiveQiStates: Record<string, string>;
  pattern: string;
  patternType: string;
  activeLuckPeriod: {
    stem: string;
    branch: string;
    tenGod: string;
    startYear: number;
    endYear: number;
  } | null;
}

/** V2 Structured AI interpretation output (multi-call, rich sections) */
export interface AIInterpretationV2 {
  schemaVersion: 'v2';
  sections: Record<string, InterpretationSection>; // flat map of all section keys
  summary: InterpretationSection;
  deterministic: LifetimeV2Deterministic | CareerV2Deterministic;
}

/** Discriminated union for V1/V2 AI interpretation */
export type AIInterpretation = AIInterpretationV1 | AIInterpretationV2;

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
  isLunarDate: boolean;
  lunarBirthDate?: string;  // Format: "YYYY-MM-DD" (lunar calendar date), null/undefined for solar entries
  isLeapMonth: boolean;
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

// ============================================================
// AI Chat Feature (Phase 1)
// ============================================================

/** Role of a chat message — mirrors Prisma ChatRole enum on the API side. */
export type ChatRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

/** Identifies one of the 7 frontend dialog/banner strings.
 *  Source of truth for copy lives in `apps/web/app/components/chat/dialog-copy.ts`. */
export type ChatDialogKey =
  | 'extend_standard'             // Dialog 1
  | 'turn20_warning_zero_balance' // Dialog 2
  | 'turn20_warning_with_balance' // Dialog 3
  | 'near_cap_warning'            // Dialog 4
  | 'hard_cap_reached'            // Dialog 5
  | 'new_session_lose_paid'       // Dialog 6
  | 'quota_badge'                 // Persistent header badge
  | 'disclaimer_footer';          // Persistent footer disclaimer

/** A single chat message as the frontend sees it (subset of API ChatMessageDto). */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  isRegrounding: boolean;
  errorCode: string | null;
  refundedAt: string | null;
  createdAt: string;
}

/** A single chat session as the frontend sees it (subset of API ChatSession). */
export interface ChatSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  messageCount: number;
  unusedPaidMessages: number;
  lastMessagePreview: string | null;
}

/** SSE event shapes emitted by `POST /api/chat/sessions/:id/messages`.
 *  Mirrors `StreamEvent` in `apps/api/src/chat/chat-stream.service.ts`. */
export type ChatStreamEvent =
  | { type: 'session_start'; messageId: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      messageId: string;
      messageCount: number;
      messagesRemaining: number;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
      };
    }
  | {
      type: 'error';
      code: string;
      message: string;
      refunded?: boolean;
      refundMethod?: string | null;
    };

/** Response of POST /api/chat/sessions/:id/extend. */
export interface ChatExtendResponse {
  paidMessagesAllowance: number;
  messagesUntilHardCap: number;
  creditExtensions: number;
}

/** Response of GET /api/chat/usage/me. */
export interface ChatUsageResponse {
  thisMonth: {
    chatsUsed: number;
    monthlyQuota: number;
    resetsAt: string;
    subscriptionTier: string;
  };
  sessionsThisHour: number;
  hourlyRateLimit: number;
  /**
   * Surfaces a recent (within 24h) tier-upgrade refund for "stranded paid
   * messages" so the chat drawer can show a one-time confirmation banner.
   * `null` if no refund occurred recently.
   */
  recentTierUpgradeRefund: {
    creditsRefunded: number;
    refundedAt: string; // ISO timestamp
  } | null;
}
