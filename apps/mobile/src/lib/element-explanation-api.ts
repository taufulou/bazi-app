/**
 * Element Encyclopedia client — hits the NestJS public passthrough
 * (POST /api/bazi/explain-element → Python engine /explain-element).
 * Ported from apps/web/app/lib/element-explanation-api.ts (URL swapped; returns
 * an error stub on failure rather than throwing, matching the web contract).
 */

import { apiFetch, ApiError } from './api';

export interface GodRoles {
  dayMasterElement: string;
  strengthClassification: string;
  favorableGod: string;
  usefulGod: string;
  idleGod: string;
  tabooGod: string;
  enemyGod: string;
}

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
  liuQin?: { male: string; female: string };
}

export interface PersonalizedData {
  pillarMeaning?: string;
  godRoleMeaning?: string;
  godRole?: string;
  genderMeaning?: string;
}

export interface InteractionData {
  type: string;
  name: string;
  icon: string;
  description: string;
  pillarsInvolved: string[];
  nature: string;
}

export interface PillarContextData {
  free: string;
  paid: string;
}

export interface DayPillarComboData {
  grade: string;
  gradeReason: string;
  lifeStageSeat: string;
  specialLabels: string[];
  teaser: string;
  summary: string;
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

/** Extract the ~200-byte god-roles payload from full chart data. */
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

type RawPillar = {
  stem: string;
  branch: string;
  tenGod: string | null;
  hiddenStemGods?: { stem: string; element: string; tenGod: string }[];
};

/** Extract the ~500-byte four-pillars payload for cross-pillar interaction detection. */
export function extractFourPillars(chartData: {
  fourPillars: { year: RawPillar; month: RawPillar; day: RawPillar; hour: RawPillar };
}): FourPillarsPayload {
  const extract = (p: RawPillar): PillarPayload => ({
    stem: p.stem,
    branch: p.branch,
    tenGod: p.tenGod || '',
    hiddenStemGods: (p.hiddenStemGods || []).map((hsg) => hsg.tenGod).filter(Boolean),
  });
  return {
    year: extract(chartData.fourPillars.year),
    month: extract(chartData.fourPillars.month),
    day: extract(chartData.fourPillars.day),
    hour: extract(chartData.fourPillars.hour),
  };
}

function errorStub(error: string): ElementExplanationData {
  return {
    generic: { name: '', category: '', meaning: '', keywords: [] },
    personalized: {},
    error,
  };
}

/**
 * Fetch element explanation. `cache` is a session-scoped Map (pass via useRef).
 * Returns an error stub (never throws) so the sheet can render a fallback.
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
  const cached = cache?.get(cacheKey);
  if (cached) return cached;

  try {
    const json = await apiFetch<{ data?: Record<string, unknown> }>('/api/bazi/explain-element', {
      method: 'POST',
      body: {
        element_type: params.elementType,
        value: params.value,
        pillar: params.pillar,
        god_roles: params.godRoles,
        gender: params.gender,
        four_pillars: params.fourPillars || null,
      },
    });
    const rawData = json.data as Record<string, unknown> | undefined;
    if (!rawData || rawData.error) {
      return errorStub((rawData?.error as string) || 'Unknown error');
    }
    const data = rawData as unknown as ElementExplanationData;
    cache?.set(cacheKey, data);
    return data;
  } catch (e) {
    const msg = e instanceof ApiError ? `API error: ${e.status}` : String(e);
    return errorStub(msg);
  }
}
