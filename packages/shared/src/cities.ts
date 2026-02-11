// ============================================================
// City & Timezone Data for Bazi Platform
// Mirrors Python engine's CITY_COORDINATES & STANDARD_OFFSETS
// ============================================================

// ============================================================
// Types
// ============================================================

/** Region grouping for UI display */
export type CityRegion =
  | 'taiwan'
  | 'hong_kong_macau'
  | 'malaysia'
  | 'singapore'
  | 'china'
  | 'japan_korea'
  | 'southeast_asia'
  | 'south_asia'
  | 'australia'
  | 'americas'
  | 'europe';

/** A city entry with coordinates and default timezone */
export interface CityEntry {
  /** Display name (Traditional Chinese primary) */
  name: string;
  /** Alternative names for matching (Simplified Chinese, English, aliases) */
  aliases: string[];
  /** Longitude in degrees East */
  longitude: number;
  /** Latitude in degrees North */
  latitude: number;
  /** Default IANA timezone for this city */
  timezone: string;
  /** Region for UI grouping */
  region: CityRegion;
}

/** Timezone entry for UI display */
export interface TimezoneEntry {
  /** IANA timezone identifier */
  value: string;
  /** Display label (Chinese) */
  label: string;
  /** Standard (non-DST) UTC offset in hours */
  utcOffset: number;
  /** Region for UI grouping */
  region: CityRegion;
}

/** Region metadata for UI grouping */
export interface RegionMeta {
  key: CityRegion;
  labelZhTw: string;
  labelZhCn: string;
}

// ============================================================
// Region Definitions (ordered by market priority)
// ============================================================

export const REGIONS: RegionMeta[] = [
  { key: 'taiwan', labelZhTw: '台灣', labelZhCn: '台湾' },
  { key: 'hong_kong_macau', labelZhTw: '港澳', labelZhCn: '港澳' },
  { key: 'malaysia', labelZhTw: '馬來西亞', labelZhCn: '马来西亚' },
  { key: 'singapore', labelZhTw: '新加坡', labelZhCn: '新加坡' },
  { key: 'china', labelZhTw: '中國大陸', labelZhCn: '中国大陆' },
  { key: 'japan_korea', labelZhTw: '日韓', labelZhCn: '日韩' },
  { key: 'southeast_asia', labelZhTw: '東南亞', labelZhCn: '东南亚' },
  { key: 'south_asia', labelZhTw: '南亞', labelZhCn: '南亚' },
  { key: 'australia', labelZhTw: '澳洲', labelZhCn: '澳洲' },
  { key: 'americas', labelZhTw: '美洲', labelZhCn: '美洲' },
  { key: 'europe', labelZhTw: '歐洲', labelZhCn: '欧洲' },
];

// ============================================================
// City Database (matches Python engine's CITY_COORDINATES)
// ============================================================

export const CITIES: CityEntry[] = [
  // --- Taiwan ---
  { name: '台北市', aliases: ['台北', 'Taipei'], longitude: 121.5654, latitude: 25.0330, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '新北市', aliases: ['新北'], longitude: 121.4628, latitude: 25.0120, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '桃園市', aliases: ['桃園'], longitude: 121.3010, latitude: 24.9936, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '台中市', aliases: ['台中'], longitude: 120.6736, latitude: 24.1477, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '台南市', aliases: ['台南'], longitude: 120.2270, latitude: 22.9999, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '高雄市', aliases: ['高雄'], longitude: 120.3014, latitude: 22.6273, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '新竹市', aliases: ['新竹'], longitude: 120.9647, latitude: 24.8138, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '基隆市', aliases: ['基隆'], longitude: 121.7419, latitude: 25.1276, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '嘉義市', aliases: ['嘉義'], longitude: 120.4491, latitude: 23.4800, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '花蓮市', aliases: ['花蓮'], longitude: 121.6014, latitude: 23.9871, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '屏東市', aliases: ['屏東'], longitude: 120.4876, latitude: 22.6727, timezone: 'Asia/Taipei', region: 'taiwan' },

  // --- Hong Kong & Macau ---
  { name: '香港', aliases: ['Hong Kong'], longitude: 114.1694, latitude: 22.3193, timezone: 'Asia/Hong_Kong', region: 'hong_kong_macau' },
  { name: '九龍', aliases: [], longitude: 114.1840, latitude: 22.3380, timezone: 'Asia/Hong_Kong', region: 'hong_kong_macau' },
  { name: '澳門', aliases: ['Macau'], longitude: 113.5439, latitude: 22.1987, timezone: 'Asia/Macau', region: 'hong_kong_macau' },

  // --- Malaysia ---
  { name: '吉隆坡', aliases: ['Kuala Lumpur'], longitude: 101.6869, latitude: 3.1390, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '檳城', aliases: ['Penang'], longitude: 100.3293, latitude: 5.4164, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '新山', aliases: ['Johor Bahru'], longitude: 103.7414, latitude: 1.4927, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '怡保', aliases: ['Ipoh'], longitude: 101.0901, latitude: 4.5975, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },

  // --- Singapore ---
  { name: '新加坡', aliases: ['Singapore'], longitude: 103.8198, latitude: 1.3521, timezone: 'Asia/Singapore', region: 'singapore' },

  // --- China ---
  { name: '北京', aliases: ['Beijing'], longitude: 116.4074, latitude: 39.9042, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '上海', aliases: ['Shanghai'], longitude: 121.4737, latitude: 31.2304, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '廣州', aliases: ['广州', 'Guangzhou'], longitude: 113.2644, latitude: 23.1291, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '深圳', aliases: ['Shenzhen'], longitude: 114.0579, latitude: 22.5431, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '成都', aliases: ['Chengdu'], longitude: 104.0665, latitude: 30.5728, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '重慶', aliases: ['重庆', 'Chongqing'], longitude: 106.5516, latitude: 29.5630, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '杭州', aliases: ['Hangzhou'], longitude: 120.1551, latitude: 30.2741, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '南京', aliases: ['Nanjing'], longitude: 118.7969, latitude: 32.0603, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '武漢', aliases: ['武汉', 'Wuhan'], longitude: 114.3055, latitude: 30.5928, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '西安', aliases: ["Xi'an"], longitude: 108.9402, latitude: 34.2583, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '天津', aliases: ['Tianjin'], longitude: 117.1901, latitude: 39.1255, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '長沙', aliases: ['长沙', 'Changsha'], longitude: 112.9388, latitude: 28.2282, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '廈門', aliases: ['厦门', 'Xiamen'], longitude: 118.0894, latitude: 24.4798, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '福州', aliases: ['Fuzhou'], longitude: 119.2965, latitude: 26.0745, timezone: 'Asia/Shanghai', region: 'china' },

  // --- Japan & Korea ---
  { name: '東京', aliases: ['Tokyo'], longitude: 139.6917, latitude: 35.6895, timezone: 'Asia/Tokyo', region: 'japan_korea' },
  { name: '大阪', aliases: ['Osaka'], longitude: 135.5023, latitude: 34.6937, timezone: 'Asia/Tokyo', region: 'japan_korea' },
  { name: '首爾', aliases: ['Seoul'], longitude: 126.9780, latitude: 37.5665, timezone: 'Asia/Seoul', region: 'japan_korea' },

  // --- Southeast Asia ---
  { name: '曼谷', aliases: ['Bangkok'], longitude: 100.5018, latitude: 13.7563, timezone: 'Asia/Bangkok', region: 'southeast_asia' },
  { name: '胡志明市', aliases: ['Ho Chi Minh City'], longitude: 106.6297, latitude: 10.8231, timezone: 'Asia/Ho_Chi_Minh', region: 'southeast_asia' },
  { name: '雅加達', aliases: ['Jakarta'], longitude: 106.8456, latitude: -6.2088, timezone: 'Asia/Jakarta', region: 'southeast_asia' },
  { name: '馬尼拉', aliases: ['Manila'], longitude: 120.9842, latitude: 14.5995, timezone: 'Asia/Manila', region: 'southeast_asia' },
  { name: '仰光', aliases: ['Yangon'], longitude: 96.1951, latitude: 16.8661, timezone: 'Asia/Yangon', region: 'southeast_asia' },

  // --- South Asia ---
  { name: '新德里', aliases: ['New Delhi'], longitude: 77.2090, latitude: 28.6139, timezone: 'Asia/Kolkata', region: 'south_asia' },
  { name: '孟買', aliases: ['Mumbai'], longitude: 72.8777, latitude: 19.0760, timezone: 'Asia/Kolkata', region: 'south_asia' },
  { name: '可倫坡', aliases: ['Colombo'], longitude: 79.8612, latitude: 6.9271, timezone: 'Asia/Colombo', region: 'south_asia' },

  // --- Australia ---
  { name: '雪梨', aliases: ['Sydney'], longitude: 151.2093, latitude: -33.8688, timezone: 'Australia/Sydney', region: 'australia' },
  { name: '墨爾本', aliases: ['Melbourne'], longitude: 144.9631, latitude: -37.8136, timezone: 'Australia/Melbourne', region: 'australia' },
  { name: '布里斯本', aliases: ['Brisbane'], longitude: 153.0251, latitude: -27.4698, timezone: 'Australia/Brisbane', region: 'australia' },
  { name: '伯斯', aliases: ['Perth'], longitude: 115.8605, latitude: -31.9505, timezone: 'Australia/Perth', region: 'australia' },

  // --- Americas ---
  { name: '紐約', aliases: ['New York'], longitude: -74.0060, latitude: 40.7128, timezone: 'America/New_York', region: 'americas' },
  { name: '洛杉磯', aliases: ['Los Angeles'], longitude: -118.2437, latitude: 34.0522, timezone: 'America/Los_Angeles', region: 'americas' },
  { name: '舊金山', aliases: ['San Francisco'], longitude: -122.4194, latitude: 37.7749, timezone: 'America/Los_Angeles', region: 'americas' },
  { name: '多倫多', aliases: ['Toronto'], longitude: -79.3832, latitude: 43.6532, timezone: 'America/Toronto', region: 'americas' },
  { name: '溫哥華', aliases: ['Vancouver'], longitude: -123.1216, latitude: 49.2827, timezone: 'America/Vancouver', region: 'americas' },

  // --- Europe ---
  { name: '倫敦', aliases: ['London'], longitude: -0.1276, latitude: 51.5074, timezone: 'Europe/London', region: 'europe' },
  { name: '巴黎', aliases: ['Paris'], longitude: 2.3522, latitude: 48.8566, timezone: 'Europe/Paris', region: 'europe' },
  { name: '柏林', aliases: ['Berlin'], longitude: 13.4050, latitude: 52.5200, timezone: 'Europe/Berlin', region: 'europe' },
];

// ============================================================
// Timezone Database (matches Python engine's STANDARD_OFFSETS)
// ============================================================

export const TIMEZONES: TimezoneEntry[] = [
  // --- Taiwan ---
  { value: 'Asia/Taipei', label: '台灣 (UTC+8)', utcOffset: 8.0, region: 'taiwan' },

  // --- Hong Kong & Macau ---
  { value: 'Asia/Hong_Kong', label: '香港 (UTC+8)', utcOffset: 8.0, region: 'hong_kong_macau' },
  { value: 'Asia/Macau', label: '澳門 (UTC+8)', utcOffset: 8.0, region: 'hong_kong_macau' },

  // --- Malaysia ---
  { value: 'Asia/Kuala_Lumpur', label: '馬來西亞 (UTC+8)', utcOffset: 8.0, region: 'malaysia' },

  // --- Singapore ---
  { value: 'Asia/Singapore', label: '新加坡 (UTC+8)', utcOffset: 8.0, region: 'singapore' },

  // --- China ---
  { value: 'Asia/Shanghai', label: '中國 (UTC+8)', utcOffset: 8.0, region: 'china' },
  { value: 'Asia/Urumqi', label: '新疆 (UTC+6)', utcOffset: 6.0, region: 'china' },

  // --- Japan & Korea ---
  { value: 'Asia/Tokyo', label: '日本 (UTC+9)', utcOffset: 9.0, region: 'japan_korea' },
  { value: 'Asia/Seoul', label: '韓國 (UTC+9)', utcOffset: 9.0, region: 'japan_korea' },

  // --- Southeast Asia ---
  { value: 'Asia/Bangkok', label: '泰國 (UTC+7)', utcOffset: 7.0, region: 'southeast_asia' },
  { value: 'Asia/Ho_Chi_Minh', label: '越南 (UTC+7)', utcOffset: 7.0, region: 'southeast_asia' },
  { value: 'Asia/Jakarta', label: '印尼西部 (UTC+7)', utcOffset: 7.0, region: 'southeast_asia' },
  { value: 'Asia/Makassar', label: '印尼中部 (UTC+8)', utcOffset: 8.0, region: 'southeast_asia' },
  { value: 'Asia/Jayapura', label: '印尼東部 (UTC+9)', utcOffset: 9.0, region: 'southeast_asia' },
  { value: 'Asia/Manila', label: '菲律賓 (UTC+8)', utcOffset: 8.0, region: 'southeast_asia' },
  { value: 'Asia/Yangon', label: '緬甸 (UTC+6:30)', utcOffset: 6.5, region: 'southeast_asia' },
  { value: 'Asia/Phnom_Penh', label: '柬埔寨 (UTC+7)', utcOffset: 7.0, region: 'southeast_asia' },

  // --- South Asia ---
  { value: 'Asia/Kolkata', label: '印度 (UTC+5:30)', utcOffset: 5.5, region: 'south_asia' },
  { value: 'Asia/Colombo', label: '斯里蘭卡 (UTC+5:30)', utcOffset: 5.5, region: 'south_asia' },
  { value: 'Asia/Kathmandu', label: '尼泊爾 (UTC+5:45)', utcOffset: 5.75, region: 'south_asia' },
  { value: 'Asia/Dhaka', label: '孟加拉 (UTC+6)', utcOffset: 6.0, region: 'south_asia' },
  { value: 'Asia/Karachi', label: '巴基斯坦 (UTC+5)', utcOffset: 5.0, region: 'south_asia' },

  // --- Middle East ---
  { value: 'Asia/Dubai', label: '杜拜 (UTC+4)', utcOffset: 4.0, region: 'south_asia' },
  { value: 'Asia/Tehran', label: '伊朗 (UTC+3:30)', utcOffset: 3.5, region: 'south_asia' },

  // --- Australia ---
  { value: 'Australia/Sydney', label: '雪梨 (UTC+10)', utcOffset: 10.0, region: 'australia' },
  { value: 'Australia/Melbourne', label: '墨爾本 (UTC+10)', utcOffset: 10.0, region: 'australia' },
  { value: 'Australia/Brisbane', label: '布里斯本 (UTC+10)', utcOffset: 10.0, region: 'australia' },
  { value: 'Australia/Perth', label: '伯斯 (UTC+8)', utcOffset: 8.0, region: 'australia' },
  { value: 'Australia/Adelaide', label: '阿德萊德 (UTC+9:30)', utcOffset: 9.5, region: 'australia' },

  // --- Americas ---
  { value: 'America/New_York', label: '美東 (UTC-5)', utcOffset: -5.0, region: 'americas' },
  { value: 'America/Chicago', label: '美中 (UTC-6)', utcOffset: -6.0, region: 'americas' },
  { value: 'America/Denver', label: '美山區 (UTC-7)', utcOffset: -7.0, region: 'americas' },
  { value: 'America/Los_Angeles', label: '美西 (UTC-8)', utcOffset: -8.0, region: 'americas' },
  { value: 'America/Toronto', label: '多倫多 (UTC-5)', utcOffset: -5.0, region: 'americas' },
  { value: 'America/Vancouver', label: '溫哥華 (UTC-8)', utcOffset: -8.0, region: 'americas' },
  { value: 'America/Sao_Paulo', label: '聖保羅 (UTC-3)', utcOffset: -3.0, region: 'americas' },
  { value: 'Pacific/Honolulu', label: '夏威夷 (UTC-10)', utcOffset: -10.0, region: 'americas' },

  // --- Europe ---
  { value: 'Europe/London', label: '倫敦 (UTC+0)', utcOffset: 0.0, region: 'europe' },
  { value: 'Europe/Paris', label: '巴黎 (UTC+1)', utcOffset: 1.0, region: 'europe' },
  { value: 'Europe/Berlin', label: '柏林 (UTC+1)', utcOffset: 1.0, region: 'europe' },
  { value: 'Europe/Moscow', label: '莫斯科 (UTC+3)', utcOffset: 3.0, region: 'europe' },
  { value: 'Pacific/Auckland', label: '紐西蘭 (UTC+12)', utcOffset: 12.0, region: 'australia' },
  { value: 'Australia/Darwin', label: '達爾文 (UTC+9:30)', utcOffset: 9.5, region: 'australia' },
];

// ============================================================
// Lookup Helpers
// ============================================================

/** Index of all city names + aliases → CityEntry for fast lookup */
const cityNameIndex: Map<string, CityEntry> = new Map();
for (const city of CITIES) {
  cityNameIndex.set(city.name, city);
  for (const alias of city.aliases) {
    cityNameIndex.set(alias, city);
  }
}

/**
 * Find a city by exact name or alias match only.
 * Use this for UI auto-timezone where precision matters.
 * Returns undefined if no exact match found.
 */
export function findCityExact(name: string): CityEntry | undefined {
  return cityNameIndex.get(name);
}

/**
 * Find a city by exact match first, then partial/substring match.
 * The partial match is useful for the Python engine's server-side fallback
 * but too aggressive for real-time UI updates.
 * Returns undefined if not found.
 */
export function findCity(name: string): CityEntry | undefined {
  const exact = cityNameIndex.get(name);
  if (exact) return exact;

  // Partial match: input is substring of a key, or key is substring of input
  for (const [key, entry] of cityNameIndex) {
    if (key.includes(name) || name.includes(key)) {
      return entry;
    }
  }

  return undefined;
}

/**
 * Get the default timezone for a city name using exact match.
 * Returns undefined if the city is not recognized — callers should
 * preserve the current timezone selection when this returns undefined.
 */
export function getTimezoneForCity(cityName: string): string | undefined {
  const city = findCityExact(cityName);
  return city?.timezone;
}

/**
 * Get cities grouped by region, ordered by market priority.
 */
export function getCitiesByRegion(): { region: RegionMeta; cities: CityEntry[] }[] {
  return REGIONS
    .map((region) => ({
      region,
      cities: CITIES.filter((c) => c.region === region.key),
    }))
    .filter((group) => group.cities.length > 0);
}

/**
 * Get timezones grouped by region, ordered by market priority.
 */
export function getTimezonesByRegion(): { region: RegionMeta; timezones: TimezoneEntry[] }[] {
  return REGIONS
    .map((region) => ({
      region,
      timezones: TIMEZONES.filter((tz) => tz.region === region.key),
    }))
    .filter((group) => group.timezones.length > 0);
}
