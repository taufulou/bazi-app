/**
 * ZWDS (紫微斗數) chart TYPES.
 *
 * ⚠️ Types only. Every API function here was deleted with the ZWDS backend
 * module: the product is not shipping and never will, and the endpoints they
 * called (`chart-preview`, `readings`, `horoscope`, `comparisons`,
 * `cross-system`, `deep-stars`) no longer exist. Three of them charged credits
 * through a raw decrement that wrote no `CreditLedger` row.
 *
 * These interfaces survive because `ZwdsChart` still RENDERS saved readings.
 * The rows live in `bazi_readings` and are fetched through the Bazi endpoint,
 * so the two already-paid ZWDS readings remain viewable.
 */

// ============================================================
// Types (matching backend ZwdsChartData)
// ============================================================

export interface ZwdsStar {
  name: string;
  type: 'major' | 'minor' | 'adjective';
  brightness?: string; // 廟/旺/得/利/平/不/陷
  mutagen?: string;    // 祿/權/科/忌
}

export interface ZwdsPalace {
  name: string;
  index: number;
  isBodyPalace: boolean;
  heavenlyStem: string;
  earthlyBranch: string;
  majorStars: ZwdsStar[];
  minorStars: ZwdsStar[];
  adjectiveStars: ZwdsStar[];
  changsheng12: string;
  decadal: {
    startAge: number;
    endAge: number;
    stem: string;
    branch: string;
  };
  ages: number[];
}

export interface ZwdsHoroscopeItem {
  name: string;
  stem: string;
  branch: string;
  mutagen: string[];
}

export interface ZwdsHoroscope {
  decadal: ZwdsHoroscopeItem;
  yearly: ZwdsHoroscopeItem;
  monthly?: ZwdsHoroscopeItem;
  daily?: ZwdsHoroscopeItem;
}

export interface ZwdsChartData {
  solarDate: string;
  lunarDate: string;
  chineseDate: string;
  birthTime: string;
  timeRange: string;
  gender: string;
  zodiac: string;
  sign: string;
  fiveElementsClass: string;
  soulPalaceBranch: string;
  bodyPalaceBranch: string;
  soulStar: string;
  bodyStar: string;
  palaces: ZwdsPalace[];
  horoscope?: ZwdsHoroscope;
}

export interface ZwdsReadingResponse {
  id: string;
  readingType: string;
  calculationData: ZwdsChartData;
  aiInterpretation: {
    sections: Record<string, { preview: string; full: string }>;
  } | null;
  createdAt: string;
}
