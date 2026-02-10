// ============================================================
// ZWDS (紫微斗數) Chart Type Definitions
// ============================================================
// Standardized types for the iztro output transformation.

export interface ZwdsStar {
  name: string;
  type: 'major' | 'minor' | 'adjective';
  brightness?: string; // 廟/旺/得/利/平/不/陷
  mutagen?: string;    // 化祿/化權/化科/化忌
}

export interface ZwdsPalace {
  name: string;          // Palace name (zh-TW)
  index: number;         // 0-11 position
  isBodyPalace: boolean;
  heavenlyStem: string;
  earthlyBranch: string;
  majorStars: ZwdsStar[];
  minorStars: ZwdsStar[];
  adjectiveStars: ZwdsStar[];
  changsheng12: string;  // 十二長生
  decadal: {
    startAge: number;
    endAge: number;
    stem: string;
    branch: string;
  };
  ages: number[];        // Ages that fall in this palace
}

export interface ZwdsHoroscopeItem {
  name: string;
  stem: string;
  branch: string;
  mutagen: string[];     // 四化 star names for this period
}

export interface ZwdsHoroscope {
  decadal: ZwdsHoroscopeItem;
  yearly: ZwdsHoroscopeItem;
  monthly?: ZwdsHoroscopeItem;
  daily?: ZwdsHoroscopeItem;
}

export interface ZwdsChartData {
  // Top-level astrolabe info
  solarDate: string;
  lunarDate: string;
  chineseDate: string;
  birthTime: string;           // e.g., "丑時"
  timeRange: string;           // e.g., "01:00~03:00"
  gender: string;
  zodiac: string;              // Chinese zodiac
  sign: string;                // Western zodiac
  fiveElementsClass: string;   // e.g., "水二局"
  soulPalaceBranch: string;    // 命宮地支
  bodyPalaceBranch: string;    // 身宮地支
  soulStar: string;            // 命主
  bodyStar: string;            // 身主

  // 12 Palaces
  palaces: ZwdsPalace[];

  // Horoscope data (if annual/monthly reading)
  horoscope?: ZwdsHoroscope;
}
