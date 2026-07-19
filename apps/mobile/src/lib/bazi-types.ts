/**
 * Bazi chart-data types — the shape the engine's /calculate returns (already
 * camelCase) and BaziChart consumes. Mirrors the local interfaces in the web's
 * BaziChart.tsx. Only the fields the chart reads are typed; the engine emits many
 * more analytics fields the chart ignores.
 */

export interface HiddenStemGod {
  stem: string;
  element: string;
  tenGod: string;
}

export interface PillarData {
  stem: string;
  branch: string;
  stemElement: string; // 木/火/土/金/水 → drives cell color
  branchElement: string;
  hiddenStems: string[]; // fallback if no hiddenStemGods
  hiddenStemGods?: HiddenStemGod[]; // preferred (stem + element + 副星)
  tenGod: string | null;
  naYin: string;
  shenSha: string[];
  lifeStage?: string; // 十二運
}

export interface DayMasterData {
  element: string;
  yinYang: string;
  strength: string; // key into STRENGTH_LABELS
  strengthScore: number;
  pattern: string; // 格局
  sameParty: number; // % for strength bar (同黨)
  oppositeParty: number; // 異黨
  favorableGod: string; // 喜神
  usefulGod: string; // 用神
  idleGod: string; // 閒神
  tabooGod: string; // 忌神
  enemyGod: string; // 仇神
}

export interface LuckPeriodData {
  startAge: number;
  endAge: number;
  startYear: number;
  endYear: number;
  stem: string;
  branch: string;
  tenGod: string;
  isCurrent: boolean;
}

export interface ShenShaData {
  name: string;
  pillar: string;
  branch: string;
}

export interface PalaceData {
  stem: string;
  branch: string;
  naYin: string;
}

export interface FourPillars {
  year: PillarData;
  month: PillarData;
  day: PillarData;
  hour: PillarData;
}

export interface BaziChartData {
  fourPillars: FourPillars;
  hourKnown?: boolean;
  dayMasterStem?: string;
  dayMasterBranch?: string;
  dayMaster: DayMasterData;
  fiveElementsBalance?: Record<string, number>; // EN keys
  fiveElementsBalanceZh?: Record<string, number>; // 木/火/土/金/水 → ring
  luckPeriods?: LuckPeriodData[];
  allShenSha?: ShenShaData[];
  kongWang?: string[];
  seasonalStates?: Record<string, string>; // 旺相休囚死
  taiYuan?: PalaceData; // 胎元
  mingGong?: PalaceData; // 命宮
  taiXi?: PalaceData; // 胎息
  shenGong?: PalaceData; // 身宮
  lunarDate?: { year: number; month: number; day: number; isLeapMonth: boolean };
  gender?: string;
}
