/**
 * Element Encyclopedia — Frontend API client.
 *
 * Calls the Python engine's /explain-element endpoint via Next.js proxy.
 * Includes session-scoped caching via useRef in the calling component.
 */

// Proxy through Next.js API route to avoid CORS/PNA browser restrictions
const EXPLAIN_API_URL = '/api/explain-element';

// ── Types ──

export interface GodRoles {
  dayMasterElement: string;
  strengthClassification: string;
  favorableGod: string;
  usefulGod: string;
  idleGod: string;
  tabooGod: string;
  enemyGod: string;
}

/** Minimal pillar data for cross-pillar interaction detection */
export interface PillarPayload {
  stem: string;
  branch: string;
  tenGod: string;
  hiddenStemGods: string[];
}

export interface FourPillarsPayload {
  year: PillarPayload;
  month: PillarPayload;
  day: PillarPayload;
  hour: PillarPayload;
}

export interface LayerAData {
  name: string;
  category: string;
  meaning: string;
  keywords: string[];
  liuQin?: {
    male: string;
    female: string;
  };
}

export interface PersonalizedData {
  pillarMeaning?: string;
  godRoleMeaning?: string;
  godRole?: string;
  genderMeaning?: string;
}

export interface InteractionData {
  type: string;         // hidden_stem_check | branch_interaction | ten_god_cross
  name: string;         // e.g., "甲透干", "子午沖"
  icon: string;         // e.g., "✓", "⚡", "🔗"
  description: string;  // Full explanation text
  pillarsInvolved: string[];
  nature: string;       // manifest | latent | strong_root | moderate_root | weak_root | floating
}

export interface PillarContextData {
  free: string;
  paid: string;
}

export interface DayPillarComboData {
  grade: string;           // "上等" | "中等" | "下等"
  gradeReason: string;     // Why this grade
  lifeStageSeat: string;   // 十二長生 position (帝旺, 臨官, etc.)
  specialLabels: string[]; // ["六秀日", "八專日", ...]
  teaser: string;          // Free tier text (~50 chars)
  summary: string;         // Paid tier text (~200 chars)
}

export interface ElementExplanationData {
  generic: LayerAData;
  personalized: PersonalizedData;
  interactions?: InteractionData[];
  pillarContext?: PillarContextData;
  dayPillarCombo?: DayPillarComboData;
  error?: string;
}

export type ElementType =
  | 'ten_god'
  | 'stem'
  | 'branch'
  | 'hidden_stem'
  | 'life_stage'
  | 'nayin'
  | 'shensha'
  | 'seasonal_state'
  | 'kong_wang';

// ── Helpers ──

/**
 * Extract minimal god roles from full chart data.
 * Only ~200 bytes vs 50-200KB for the full chart object.
 */
export function extractGodRoles(chartData: {
  dayMaster: {
    element: string;
    strength: string;
    favorableGod: string;
    usefulGod: string;
    idleGod: string;
    tabooGod: string;
    enemyGod: string;
  };
}): GodRoles {
  return {
    dayMasterElement: chartData.dayMaster.element,
    strengthClassification: chartData.dayMaster.strength,
    favorableGod: chartData.dayMaster.favorableGod,
    usefulGod: chartData.dayMaster.usefulGod,
    idleGod: chartData.dayMaster.idleGod,
    tabooGod: chartData.dayMaster.tabooGod,
    enemyGod: chartData.dayMaster.enemyGod,
  };
}

/**
 * Extract four pillars payload for cross-pillar interaction detection.
 * ~500 bytes — includes stems, branches, ten gods, and hidden stem gods.
 */
export function extractFourPillars(chartData: {
  fourPillars: {
    year: { stem: string; branch: string; tenGod: string | null; hiddenStemGods?: { stem: string; element: string; tenGod: string }[] };
    month: { stem: string; branch: string; tenGod: string | null; hiddenStemGods?: { stem: string; element: string; tenGod: string }[] };
    day: { stem: string; branch: string; tenGod: string | null; hiddenStemGods?: { stem: string; element: string; tenGod: string }[] };
    hour: { stem: string; branch: string; tenGod: string | null; hiddenStemGods?: { stem: string; element: string; tenGod: string }[] };
  };
}): FourPillarsPayload {
  const extract = (p: { stem: string; branch: string; tenGod: string | null; hiddenStemGods?: { stem: string; element: string; tenGod: string }[] }): PillarPayload => ({
    stem: p.stem,
    branch: p.branch,
    tenGod: p.tenGod || '',
    hiddenStemGods: (p.hiddenStemGods || []).map(hsg => hsg.tenGod).filter(Boolean),
  });

  return {
    year: extract(chartData.fourPillars.year),
    month: extract(chartData.fourPillars.month),
    day: extract(chartData.fourPillars.day),
    hour: extract(chartData.fourPillars.hour),
  };
}

// ── API Call ──

/**
 * Fetch element explanation from the Python engine.
 *
 * @param params - Element identification + chart context
 * @param cache - Optional Map for session-scoped caching (pass via useRef)
 * @returns Explanation data with generic + personalized + interactions layers
 */
export async function fetchElementExplanation(
  params: {
    elementType: ElementType;
    value: string;
    pillar: string;
    godRoles: GodRoles;
    gender: string;
    fourPillars?: FourPillarsPayload;
  },
  cache?: Map<string, ElementExplanationData>,
): Promise<ElementExplanationData> {
  const cacheKey = `${params.elementType}:${params.value}:${params.pillar}:${params.gender}`;

  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const response = await fetch(EXPLAIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      element_type: params.elementType,
      value: params.value,
      pillar: params.pillar,
      god_roles: params.godRoles,
      gender: params.gender,
      four_pillars: params.fourPillars || null,
    }),
  });

  if (!response.ok) {
    return {
      generic: { name: '', category: '', meaning: '', keywords: [] },
      personalized: {},
      error: `API error: ${response.status}`,
    };
  }

  const json = await response.json();
  const rawData = json.data as Record<string, unknown>;

  // Don't cache error responses from engine
  if (!rawData || rawData.error) {
    return {
      generic: { name: '', category: '', meaning: '', keywords: [] },
      personalized: {},
      error: (rawData?.error as string) || 'Unknown error',
    };
  }

  const data = rawData as unknown as ElementExplanationData;
  cache?.set(cacheKey, data);
  return data;
}
