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
  // --- Taiwan (22 administrative divisions) ---
  // 6 Special Municipalities (直轄市)
  { name: '台北市', aliases: ['台北', 'Taipei'], longitude: 121.5654, latitude: 25.0330, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '新北市', aliases: ['新北'], longitude: 121.4628, latitude: 25.0120, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '桃園市', aliases: ['桃園'], longitude: 121.3010, latitude: 24.9936, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '台中市', aliases: ['台中'], longitude: 120.6736, latitude: 24.1477, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '台南市', aliases: ['台南'], longitude: 120.2270, latitude: 22.9999, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '高雄市', aliases: ['高雄'], longitude: 120.3014, latitude: 22.6273, timezone: 'Asia/Taipei', region: 'taiwan' },
  // 3 Provincial Cities (省轄市)
  { name: '新竹市', aliases: ['新竹'], longitude: 120.9647, latitude: 24.8138, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '基隆市', aliases: ['基隆'], longitude: 121.7419, latitude: 25.1276, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '嘉義市', aliases: ['嘉義'], longitude: 120.4491, latitude: 23.4800, timezone: 'Asia/Taipei', region: 'taiwan' },
  // County seats (縣治)
  { name: '宜蘭市', aliases: ['宜蘭', 'Yilan'], longitude: 121.7530, latitude: 24.7570, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '竹北市', aliases: ['竹北', 'Zhubei'], longitude: 121.0042, latitude: 24.8396, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '苗栗市', aliases: ['苗栗', 'Miaoli'], longitude: 120.8214, latitude: 24.5602, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '彰化市', aliases: ['彰化', 'Changhua'], longitude: 120.5382, latitude: 24.0734, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '南投市', aliases: ['南投', 'Nantou'], longitude: 120.6837, latitude: 23.9099, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '斗六市', aliases: ['斗六', 'Douliu'], longitude: 120.5275, latitude: 23.7075, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '太保市', aliases: ['太保', 'Taibao'], longitude: 120.4327, latitude: 23.4596, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '花蓮市', aliases: ['花蓮'], longitude: 121.6014, latitude: 23.9871, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '屏東市', aliases: ['屏東'], longitude: 120.4876, latitude: 22.6727, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '台東市', aliases: ['台東', 'Taitung'], longitude: 121.1460, latitude: 22.7583, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '馬公市', aliases: ['馬公', '澎湖', 'Magong'], longitude: 119.5667, latitude: 23.5666, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '金城鎮', aliases: ['金門', 'Kinmen', 'Jincheng'], longitude: 118.3177, latitude: 24.4364, timezone: 'Asia/Taipei', region: 'taiwan' },
  { name: '南竿鄉', aliases: ['馬祖', 'Matsu', 'Nangan'], longitude: 119.9440, latitude: 26.1508, timezone: 'Asia/Taipei', region: 'taiwan' },

  // --- Hong Kong & Macau ---
  // HK longitude spread is only ~0.3° (~1.2 min solar time) — districts not needed for Bazi accuracy
  { name: '香港', aliases: ['Hong Kong'], longitude: 114.1694, latitude: 22.3193, timezone: 'Asia/Hong_Kong', region: 'hong_kong_macau' },
  { name: '九龍', aliases: ['Kowloon'], longitude: 114.1840, latitude: 22.3380, timezone: 'Asia/Hong_Kong', region: 'hong_kong_macau' },
  { name: '澳門', aliases: ['Macau'], longitude: 113.5439, latitude: 22.1987, timezone: 'Asia/Macau', region: 'hong_kong_macau' },

  // --- Malaysia ---
  // Federal Territories
  { name: '吉隆坡', aliases: ['Kuala Lumpur'], longitude: 101.6869, latitude: 3.1390, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '布城', aliases: ['Putrajaya'], longitude: 101.6964, latitude: 2.9264, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  // Peninsular states (州屬) — state capital coords, max ~8 min TST error, safe for Bazi
  { name: '雪蘭莪', aliases: ['Selangor', '莎阿南', 'Shah Alam', '八打靈再也', 'Petaling Jaya', '梳邦再也', 'Subang Jaya'], longitude: 101.5325, latitude: 3.0738, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '檳城', aliases: ['Penang', 'Pulau Pinang'], longitude: 100.3293, latitude: 5.4164, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '柔佛', aliases: ['Johor', '新山', 'Johor Bahru'], longitude: 103.7414, latitude: 1.4927, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '霹靂', aliases: ['Perak', '怡保', 'Ipoh'], longitude: 101.0901, latitude: 4.5975, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '森美蘭', aliases: ['Negeri Sembilan', '芙蓉', 'Seremban'], longitude: 101.9424, latitude: 2.7258, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '馬六甲', aliases: ['Melaka', 'Malacca'], longitude: 102.2501, latitude: 2.1896, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '彭亨', aliases: ['Pahang', '關丹', 'Kuantan'], longitude: 103.4174, latitude: 3.8077, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '登嘉樓', aliases: ['Terengganu', '瓜拉登嘉樓', 'Kuala Terengganu'], longitude: 103.1324, latitude: 5.3117, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '吉蘭丹', aliases: ['Kelantan', '哥打巴魯', 'Kota Bharu'], longitude: 102.2386, latitude: 6.1256, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '吉打', aliases: ['Kedah', '亞羅士打', 'Alor Setar'], longitude: 100.3685, latitude: 6.1248, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  { name: '玻璃市', aliases: ['Perlis', '加央', 'Kangar'], longitude: 100.1953, latitude: 6.4414, timezone: 'Asia/Kuala_Lumpur', region: 'malaysia' },
  // East Malaysia (Borneo) — cities needed, not states (Sarawak spans 6° = 24 min error)
  { name: '古晉', aliases: ['Kuching'], longitude: 110.3444, latitude: 1.5497, timezone: 'Asia/Kuching', region: 'malaysia' },
  { name: '亞庇', aliases: ['Kota Kinabalu'], longitude: 116.0735, latitude: 5.9804, timezone: 'Asia/Kuching', region: 'malaysia' },
  { name: '詩巫', aliases: ['Sibu'], longitude: 111.8311, latitude: 2.3000, timezone: 'Asia/Kuching', region: 'malaysia' },
  { name: '美里', aliases: ['Miri'], longitude: 114.0127, latitude: 4.3995, timezone: 'Asia/Kuching', region: 'malaysia' },
  { name: '山打根', aliases: ['Sandakan'], longitude: 118.0669, latitude: 5.8402, timezone: 'Asia/Kuching', region: 'malaysia' },
  { name: '納閩', aliases: ['Labuan'], longitude: 115.2308, latitude: 5.2831, timezone: 'Asia/Kuching', region: 'malaysia' },

  // --- Singapore ---
  { name: '新加坡', aliases: ['Singapore'], longitude: 103.8198, latitude: 1.3521, timezone: 'Asia/Singapore', region: 'singapore' },

  // --- China (47 major cities) ---
  // Tier 1
  { name: '北京', aliases: ['Beijing'], longitude: 116.4074, latitude: 39.9042, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '上海', aliases: ['Shanghai'], longitude: 121.4737, latitude: 31.2304, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '廣州', aliases: ['广州', 'Guangzhou'], longitude: 113.2644, latitude: 23.1291, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '深圳', aliases: ['Shenzhen'], longitude: 114.0579, latitude: 22.5431, timezone: 'Asia/Shanghai', region: 'china' },
  // Tier 1.5
  { name: '成都', aliases: ['Chengdu'], longitude: 104.0665, latitude: 30.5728, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '重慶', aliases: ['重庆', 'Chongqing'], longitude: 106.5516, latitude: 29.5630, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '杭州', aliases: ['Hangzhou'], longitude: 120.1551, latitude: 30.2741, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '南京', aliases: ['Nanjing'], longitude: 118.7969, latitude: 32.0603, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '武漢', aliases: ['武汉', 'Wuhan'], longitude: 114.3055, latitude: 30.5928, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '西安', aliases: ["Xi'an"], longitude: 108.9402, latitude: 34.2583, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '天津', aliases: ['Tianjin'], longitude: 117.1901, latitude: 39.1255, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '長沙', aliases: ['长沙', 'Changsha'], longitude: 112.9388, latitude: 28.2282, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '蘇州', aliases: ['苏州', 'Suzhou'], longitude: 120.6199, latitude: 31.2990, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '東莞', aliases: ['东莞', 'Dongguan'], longitude: 113.7518, latitude: 23.0209, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '鄭州', aliases: ['郑州', 'Zhengzhou'], longitude: 113.6254, latitude: 34.7466, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '瀋陽', aliases: ['沈阳', 'Shenyang'], longitude: 123.4315, latitude: 41.8057, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '青島', aliases: ['青岛', 'Qingdao'], longitude: 120.3826, latitude: 36.0671, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '寧波', aliases: ['宁波', 'Ningbo'], longitude: 121.5440, latitude: 29.8683, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '佛山', aliases: ['Foshan'], longitude: 113.1215, latitude: 23.0218, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '大連', aliases: ['大连', 'Dalian'], longitude: 121.6147, latitude: 38.9140, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '哈爾濱', aliases: ['哈尔滨', 'Harbin'], longitude: 126.6425, latitude: 45.7567, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '濟南', aliases: ['济南', 'Jinan'], longitude: 117.0009, latitude: 36.6512, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '昆明', aliases: ['Kunming'], longitude: 102.8329, latitude: 25.0389, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '合肥', aliases: ['Hefei'], longitude: 117.2272, latitude: 31.8206, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '無錫', aliases: ['无锡', 'Wuxi'], longitude: 120.3119, latitude: 31.4912, timezone: 'Asia/Shanghai', region: 'china' },
  // Tier 2
  { name: '廈門', aliases: ['厦门', 'Xiamen'], longitude: 118.0894, latitude: 24.4798, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '福州', aliases: ['Fuzhou'], longitude: 119.2965, latitude: 26.0745, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '長春', aliases: ['长春', 'Changchun'], longitude: 125.3235, latitude: 43.8171, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '石家莊', aliases: ['石家庄', 'Shijiazhuang'], longitude: 114.5149, latitude: 38.0428, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '貴陽', aliases: ['贵阳', 'Guiyang'], longitude: 106.6302, latitude: 26.6477, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '溫州', aliases: ['温州', 'Wenzhou'], longitude: 120.6994, latitude: 28.0006, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '南寧', aliases: ['南宁', 'Nanning'], longitude: 108.3661, latitude: 22.8170, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '太原', aliases: ['Taiyuan'], longitude: 112.5489, latitude: 37.8706, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '南昌', aliases: ['Nanchang'], longitude: 115.8581, latitude: 28.6820, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '常州', aliases: ['Changzhou'], longitude: 119.9741, latitude: 31.8118, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '煙台', aliases: ['烟台', 'Yantai'], longitude: 121.3917, latitude: 37.5399, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '蘭州', aliases: ['兰州', 'Lanzhou'], longitude: 103.8343, latitude: 36.0611, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '珠海', aliases: ['Zhuhai'], longitude: 113.5767, latitude: 22.2710, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '惠州', aliases: ['Huizhou'], longitude: 114.4160, latitude: 23.1116, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '中山', aliases: ['Zhongshan'], longitude: 113.3926, latitude: 22.5176, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '海口', aliases: ['Haikou'], longitude: 110.3500, latitude: 20.0440, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '汕頭', aliases: ['汕头', 'Shantou'], longitude: 116.6815, latitude: 23.3535, timezone: 'Asia/Shanghai', region: 'china' },
  // Western China & autonomous regions
  { name: '烏魯木齊', aliases: ['乌鲁木齐', 'Urumqi'], longitude: 87.6168, latitude: 43.8256, timezone: 'Asia/Urumqi', region: 'china' },
  { name: '拉薩', aliases: ['拉萨', 'Lhasa'], longitude: 91.1320, latitude: 29.6600, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '呼和浩特', aliases: ['Hohhot'], longitude: 111.7517, latitude: 40.8426, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '銀川', aliases: ['银川', 'Yinchuan'], longitude: 106.2782, latitude: 38.4872, timezone: 'Asia/Shanghai', region: 'china' },
  { name: '西寧', aliases: ['西宁', 'Xining'], longitude: 101.7782, latitude: 36.6171, timezone: 'Asia/Shanghai', region: 'china' },

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
  { value: 'Asia/Kuala_Lumpur', label: '西馬 (UTC+8)', utcOffset: 8.0, region: 'malaysia' },
  { value: 'Asia/Kuching', label: '東馬 (UTC+8)', utcOffset: 8.0, region: 'malaysia' },

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
 * Reverse-lookup: get the region for a city by exact name/alias match.
 * Returns undefined if the city is not in the database.
 */
export function getRegionForCity(cityName: string): CityRegion | undefined {
  const city = findCityExact(cityName);
  return city?.region;
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
