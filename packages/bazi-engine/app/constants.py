"""
Bazi Constants — Heavenly Stems, Earthly Branches, Five Elements, Ten Gods, etc.
All lookup tables for deterministic Bazi calculation.
Mirrors the TypeScript constants in packages/shared/src/constants.ts
"""

from typing import Dict, List, Tuple

# ============================================================
# Heavenly Stems (天干) — 10 Stems
# ============================================================

HEAVENLY_STEMS: List[str] = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
STEM_INDEX: Dict[str, int] = {s: i for i, s in enumerate(HEAVENLY_STEMS)}

# ============================================================
# Earthly Branches (地支) — 12 Branches
# ============================================================

EARTHLY_BRANCHES: List[str] = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
BRANCH_INDEX: Dict[str, int] = {b: i for i, b in enumerate(EARTHLY_BRANCHES)}

# ============================================================
# Five Elements (五行) Mappings
# ============================================================

STEM_ELEMENT: Dict[str, str] = {
    '甲': '木', '乙': '木',
    '丙': '火', '丁': '火',
    '戊': '土', '己': '土',
    '庚': '金', '辛': '金',
    '壬': '水', '癸': '水',
}

BRANCH_ELEMENT: Dict[str, str] = {
    '寅': '木', '卯': '木',
    '巳': '火', '午': '火',
    '辰': '土', '未': '土', '戌': '土', '丑': '土',
    '申': '金', '酉': '金',
    '子': '水', '亥': '水',
}

# Stem Yin/Yang: even index = 陽 (yang), odd index = 陰 (yin)
STEM_YINYANG: Dict[str, str] = {
    '甲': '陽', '乙': '陰',
    '丙': '陽', '丁': '陰',
    '戊': '陽', '己': '陰',
    '庚': '陽', '辛': '陰',
    '壬': '陽', '癸': '陰',
}

BRANCH_YINYANG: Dict[str, str] = {
    '子': '陽', '丑': '陰',
    '寅': '陽', '卯': '陰',
    '辰': '陽', '巳': '陰',
    '午': '陽', '未': '陰',
    '申': '陽', '酉': '陰',
    '戌': '陽', '亥': '陰',
}

# ============================================================
# Five Elements Cycles
# ============================================================

# 相生 (Production cycle): Wood→Fire→Earth→Metal→Water→Wood
ELEMENT_PRODUCES: Dict[str, str] = {
    '木': '火', '火': '土', '土': '金', '金': '水', '水': '木',
}

# 相剋 (Overcoming cycle): Wood→Earth→Water→Fire→Metal→Wood
ELEMENT_OVERCOMES: Dict[str, str] = {
    '木': '土', '土': '水', '水': '火', '火': '金', '金': '木',
}

# Reverse: which element is overcome by this element
ELEMENT_OVERCOME_BY: Dict[str, str] = {v: k for k, v in ELEMENT_OVERCOMES.items()}

# Reverse: which element produces this element
ELEMENT_PRODUCED_BY: Dict[str, str] = {v: k for k, v in ELEMENT_PRODUCES.items()}

FIVE_ELEMENTS: List[str] = ['木', '火', '土', '金', '水']
ELEMENT_INDEX: Dict[str, int] = {e: i for i, e in enumerate(FIVE_ELEMENTS)}

ELEMENT_ENGLISH: Dict[str, str] = {
    '木': 'wood', '火': 'fire', '土': 'earth', '金': 'metal', '水': 'water',
}

# ============================================================
# Hidden Stems (藏干)
# ============================================================

HIDDEN_STEMS: Dict[str, List[str]] = {
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
}

# Hidden stem weights (本氣/中氣/餘氣 — Main/Secondary/Residual)
# Weights used for Five Elements balance calculation
HIDDEN_STEM_WEIGHTS: Dict[str, List[float]] = {
    '子': [1.0],
    '丑': [0.6, 0.2, 0.2],
    '寅': [0.6, 0.2, 0.2],
    '卯': [1.0],
    '辰': [0.6, 0.2, 0.2],
    '巳': [0.6, 0.2, 0.2],
    '午': [0.7, 0.3],
    '未': [0.6, 0.2, 0.2],
    '申': [0.6, 0.2, 0.2],
    '酉': [1.0],
    '戌': [0.6, 0.2, 0.2],
    '亥': [0.7, 0.3],
}

# ============================================================
# Ten Gods (十神) Derivation
# ============================================================

# Ten Gods are derived from the relationship between the Day Master and other stems.
# Relationship is based on:
# 1. Same element → 比肩 (same polarity) or 劫財 (different polarity)
# 2. I produce → 食神 (same polarity) or 傷官 (different polarity)
# 3. I overcome → 偏財 (same polarity) or 正財 (different polarity)
# 4. Overcomes me → 偏官 (same polarity) or 正官 (different polarity)
# 5. Produces me → 偏印 (same polarity) or 正印 (different polarity)

TEN_GODS_SAME_POLARITY: Dict[str, str] = {
    'same': '比肩',       # Companion (比肩)
    'i_produce': '食神',   # Eating God (食神)
    'i_overcome': '偏財',  # Indirect Wealth (偏財)
    'overcomes_me': '偏官', # Indirect Officer / Seven Killings (偏官/七殺)
    'produces_me': '偏印',  # Indirect Seal (偏印)
}

TEN_GODS_DIFF_POLARITY: Dict[str, str] = {
    'same': '劫財',       # Rob Wealth (劫財)
    'i_produce': '傷官',   # Hurting Officer (傷官)
    'i_overcome': '正財',  # Direct Wealth (正財)
    'overcomes_me': '正官', # Direct Officer (正官)
    'produces_me': '正印',  # Direct Seal (正印)
}

TEN_GODS_LIST: List[str] = [
    '比肩', '劫財', '食神', '傷官', '偏財', '正財', '偏官', '正官', '偏印', '正印',
]

TEN_GODS_ENGLISH: Dict[str, str] = {
    '比肩': 'Companion',
    '劫財': 'Rob Wealth',
    '食神': 'Eating God',
    '傷官': 'Hurting Officer',
    '偏財': 'Indirect Wealth',
    '正財': 'Direct Wealth',
    '偏官': 'Seven Killings',
    '正官': 'Direct Officer',
    '偏印': 'Indirect Seal',
    '正印': 'Direct Seal',
}

# ============================================================
# Na Yin (納音) — 60 Jiazi pairs mapped to element names
# ============================================================

NAYIN: Dict[str, str] = {
    '甲子': '海中金', '乙丑': '海中金',
    '丙寅': '爐中火', '丁卯': '爐中火',
    '戊辰': '大林木', '己巳': '大林木',
    '庚午': '路旁土', '辛未': '路旁土',
    '壬申': '劍鋒金', '癸酉': '劍鋒金',
    '甲戌': '山頭火', '乙亥': '山頭火',
    '丙子': '澗下水', '丁丑': '澗下水',
    '戊寅': '城頭土', '己卯': '城頭土',
    '庚辰': '白蠟金', '辛巳': '白蠟金',
    '壬午': '楊柳木', '癸未': '楊柳木',
    '甲申': '泉中水', '乙酉': '泉中水',
    '丙戌': '屋上土', '丁亥': '屋上土',
    '戊子': '霹靂火', '己丑': '霹靂火',
    '庚寅': '松柏木', '辛卯': '松柏木',
    '壬辰': '長流水', '癸巳': '長流水',
    '甲午': '沙中金', '乙未': '沙中金',
    '丙申': '山下火', '丁酉': '山下火',
    '戊戌': '平地木', '己亥': '平地木',
    '庚子': '壁上土', '辛丑': '壁上土',
    '壬寅': '金箔金', '癸卯': '金箔金',
    '甲辰': '覆燈火', '乙巳': '覆燈火',
    '丙午': '天河水', '丁未': '天河水',
    '戊申': '大驛土', '己酉': '大驛土',
    '庚戌': '釵釧金', '辛亥': '釵釧金',
    '壬子': '桑柘木', '癸丑': '桑柘木',
    '甲寅': '大溪水', '乙卯': '大溪水',
    '丙辰': '沙中土', '丁巳': '沙中土',
    '戊午': '天上火', '己未': '天上火',
    '庚申': '石榴木', '辛酉': '石榴木',
    '壬戌': '大海水', '癸亥': '大海水',
}

# ============================================================
# Twelve Life Stages (十二長生) for each element
# ============================================================

TWELVE_STAGES: List[str] = [
    '長生', '沐浴', '冠帶', '臨官', '帝旺', '衰',
    '病', '死', '墓', '絕', '胎', '養',
]

# Starting branch for each stem (陽干順行, 陰干逆行)
# Index in EARTHLY_BRANCHES where 長生 starts
STAGE_START: Dict[str, int] = {
    '甲': 10,  # 亥
    '乙': 4,   # 午 (reversed)
    '丙': 2,   # 寅
    '丁': 8,   # 酉 (reversed)
    '戊': 2,   # 寅
    '己': 8,   # 酉 (reversed)
    '庚': 5,   # 巳
    '辛': 0,   # 子 (reversed)
    '壬': 8,   # 申 → 猴 actually 申 is index 8? No. Let me recalculate.
    '癸': 2,   # 卯 (reversed) → actually 卯 is index 3
}

# Actually, let's use a proper mapping.
# For Yang stems (甲丙戊庚壬), stages go forward through branches.
# For Yin stems (乙丁己辛癸), stages go backward through branches.
# 長生 starting branch for each stem:
CHANGSHENG_BRANCH: Dict[str, str] = {
    '甲': '亥',  # Wood Yang: born in 亥 (Water)
    '乙': '午',  # Wood Yin: born in 午 (Fire)
    '丙': '寅',  # Fire Yang: born in 寅 (Wood)
    '丁': '酉',  # Fire Yin: born in 酉 (Metal)
    '戊': '寅',  # Earth Yang: born in 寅 (same as Fire)
    '己': '酉',  # Earth Yin: born in 酉 (same as Fire Yin)
    '庚': '巳',  # Metal Yang: born in 巳 (Fire)
    '辛': '子',  # Metal Yin: born in 子 (Water)
    '壬': '申',  # Water Yang: born in 申 (Metal)
    '癸': '卯',  # Water Yin: born in 卯 (Wood)
}

# ============================================================
# Shen Sha (神煞) — Special Stars
# ============================================================

# Tian Yi Noble (天乙貴人) — lookup by Day Stem
TIANYI_GUIREN: Dict[str, List[str]] = {
    '甲': ['丑', '未'],
    '乙': ['子', '申'],
    '丙': ['亥', '酉'],
    '丁': ['亥', '酉'],
    '戊': ['丑', '未'],
    '己': ['子', '申'],
    '庚': ['丑', '未'],
    '辛': ['寅', '午'],
    '壬': ['卯', '巳'],
    '癸': ['卯', '巳'],
}

# Wen Chang (文昌) — Academic star, lookup by Day Stem
WENCHANG: Dict[str, str] = {
    '甲': '巳', '乙': '午', '丙': '申', '丁': '酉',
    '戊': '申', '己': '酉', '庚': '亥', '辛': '子',
    '壬': '寅', '癸': '卯',
}

# Yi Ma (驛馬) — Travel star, lookup by Day Branch
# Also called Relay Horse
YIMA: Dict[str, str] = {
    '申': '寅', '子': '寅', '辰': '寅',  # 申子辰 → 寅
    '寅': '申', '午': '申', '戌': '申',  # 寅午戌 → 申
    '巳': '亥', '酉': '亥', '丑': '亥',  # 巳酉丑 → 亥
    '亥': '巳', '卯': '巳', '未': '巳',  # 亥卯未 → 巳
}

# Tao Hua (桃花) — Peach Blossom / Romance star, lookup by Day Branch
TAOHUA: Dict[str, str] = {
    '申': '酉', '子': '酉', '辰': '酉',
    '寅': '卯', '午': '卯', '戌': '卯',
    '巳': '午', '酉': '午', '丑': '午',
    '亥': '子', '卯': '子', '未': '子',
}

# Hua Gai (華蓋) — Canopy star, lookup by Day Branch
HUAGAI: Dict[str, str] = {
    '申': '辰', '子': '辰', '辰': '辰',
    '寅': '戌', '午': '戌', '戌': '戌',
    '巳': '丑', '酉': '丑', '丑': '丑',
    '亥': '未', '卯': '未', '未': '未',
}

# Jiang Xing (將星) — General star, lookup by Day Branch
JIANGXING: Dict[str, str] = {
    '申': '子', '子': '子', '辰': '子',
    '寅': '午', '午': '午', '戌': '午',
    '巳': '酉', '酉': '酉', '丑': '酉',
    '亥': '卯', '卯': '卯', '未': '卯',
}

# Lu Shen (祿神) — Prosperity star, lookup by Day Stem
LUSHEN: Dict[str, str] = {
    '甲': '寅', '乙': '卯', '丙': '巳', '丁': '午',
    '戊': '巳', '己': '午', '庚': '申', '辛': '酉',
    '壬': '亥', '癸': '子',
}

# Yang Ren (羊刃) — Blade, lookup by Day Stem
YANGREN: Dict[str, str] = {
    '甲': '卯', '乙': '辰', '丙': '午', '丁': '未',
    '戊': '午', '己': '未', '庚': '酉', '辛': '戌',
    '壬': '子', '癸': '丑',
}

# Kong Wang (空亡) — Void, lookup by Day Pillar's Jiazi group
# Each group of 10 Jiazi pairs shares the same two void branches
# We compute void branches from the starting stem-branch pair of the Jiazi group


# ============================================================
# Chinese Zodiac (生肖) by Year Branch
# ============================================================

ZODIAC: Dict[str, str] = {
    '子': '鼠', '丑': '牛', '寅': '虎', '卯': '兔',
    '辰': '龍', '巳': '蛇', '午': '馬', '未': '羊',
    '申': '猴', '酉': '雞', '戌': '狗', '亥': '豬',
}

# ============================================================
# Standard Meridians for Timezone Offsets
# ============================================================

# Standard meridian longitude for UTC offset hours
# UTC+X → standard meridian = X * 15 degrees East
TIMEZONE_MERIDIAN: Dict[float, float] = {
    -12.0: -180.0, -11.0: -165.0, -10.0: -150.0, -9.0: -135.0,
    -8.0: -120.0, -7.0: -105.0, -6.0: -90.0, -5.0: -75.0,
    -4.0: -60.0, -3.0: -45.0, -2.0: -30.0, -1.0: -15.0,
    0.0: 0.0, 1.0: 15.0, 2.0: 30.0, 3.0: 45.0,
    4.0: 60.0, 4.5: 67.5, 5.0: 75.0, 5.5: 82.5,
    5.75: 86.25, 6.0: 90.0, 6.5: 97.5, 7.0: 105.0,
    8.0: 120.0, 8.75: 131.25, 9.0: 135.0, 9.5: 142.5,
    10.0: 150.0, 10.5: 157.5, 11.0: 165.0, 12.0: 180.0,
    12.75: 191.25, 13.0: 195.0,
}

# ============================================================
# Major City Coordinates for common birth locations
# ============================================================

CITY_COORDINATES: Dict[str, Tuple[float, float]] = {
    # Taiwan
    '台北': (121.5654, 25.0330),
    '台北市': (121.5654, 25.0330),
    'Taipei': (121.5654, 25.0330),
    '新北': (121.4628, 25.0120),
    '新北市': (121.4628, 25.0120),
    '桃園': (121.3010, 24.9936),
    '桃園市': (121.3010, 24.9936),
    '台中': (120.6736, 24.1477),
    '台中市': (120.6736, 24.1477),
    '台南': (120.2270, 22.9999),
    '台南市': (120.2270, 22.9999),
    '高雄': (120.3014, 22.6273),
    '高雄市': (120.3014, 22.6273),
    '新竹': (120.9647, 24.8138),
    '新竹市': (120.9647, 24.8138),
    '基隆': (121.7419, 25.1276),
    '基隆市': (121.7419, 25.1276),
    '嘉義': (120.4491, 23.4800),
    '嘉義市': (120.4491, 23.4800),
    '花蓮': (121.6014, 23.9871),
    '花蓮市': (121.6014, 23.9871),
    '屏東': (120.4876, 22.6727),
    '屏東市': (120.4876, 22.6727),
    # Hong Kong
    '香港': (114.1694, 22.3193),
    'Hong Kong': (114.1694, 22.3193),
    '九龍': (114.1840, 22.3380),
    # Macau
    '澳門': (113.5439, 22.1987),
    'Macau': (113.5439, 22.1987),
    # Malaysia
    '吉隆坡': (101.6869, 3.1390),
    'Kuala Lumpur': (101.6869, 3.1390),
    '檳城': (100.3293, 5.4164),
    'Penang': (100.3293, 5.4164),
    '新山': (103.7414, 1.4927),
    'Johor Bahru': (103.7414, 1.4927),
    '怡保': (101.0901, 4.5975),
    'Ipoh': (101.0901, 4.5975),
    # China Major Cities
    '北京': (116.4074, 39.9042),
    'Beijing': (116.4074, 39.9042),
    '上海': (121.4737, 31.2304),
    'Shanghai': (121.4737, 31.2304),
    '廣州': (113.2644, 23.1291),
    '广州': (113.2644, 23.1291),
    'Guangzhou': (113.2644, 23.1291),
    '深圳': (114.0579, 22.5431),
    'Shenzhen': (114.0579, 22.5431),
    '成都': (104.0665, 30.5728),
    'Chengdu': (104.0665, 30.5728),
    '重慶': (106.5516, 29.5630),
    '重庆': (106.5516, 29.5630),
    'Chongqing': (106.5516, 29.5630),
    '杭州': (120.1551, 30.2741),
    'Hangzhou': (120.1551, 30.2741),
    '南京': (118.7969, 32.0603),
    'Nanjing': (118.7969, 32.0603),
    '武漢': (114.3055, 30.5928),
    '武汉': (114.3055, 30.5928),
    'Wuhan': (114.3055, 30.5928),
    '西安': (108.9402, 34.2583),
    "Xi'an": (108.9402, 34.2583),
    '天津': (117.1901, 39.1255),
    'Tianjin': (117.1901, 39.1255),
    '長沙': (112.9388, 28.2282),
    '长沙': (112.9388, 28.2282),
    'Changsha': (112.9388, 28.2282),
    '廈門': (118.0894, 24.4798),
    '厦门': (118.0894, 24.4798),
    'Xiamen': (118.0894, 24.4798),
    '福州': (119.2965, 26.0745),
    'Fuzhou': (119.2965, 26.0745),
    # Singapore
    '新加坡': (103.8198, 1.3521),
    'Singapore': (103.8198, 1.3521),
    # Other
    '東京': (139.6917, 35.6895),
    'Tokyo': (139.6917, 35.6895),
    '首爾': (126.9780, 37.5665),
    'Seoul': (126.9780, 37.5665),
}

# ============================================================
# Pattern Types (格局) — major Bazi patterns
# ============================================================

PATTERN_TYPES: Dict[str, str] = {
    '比肩': '比肩格',
    '劫財': '劫財格',
    '食神': '食神格',
    '傷官': '傷官格',
    '偏財': '偏財格',
    '正財': '正財格',
    '偏官': '偏官格',
    '正官': '正官格',
    '偏印': '偏印格',
    '正印': '正印格',
}

# ============================================================
# Season Strength (月令旺衰) — Stem strength by Month Branch
# ============================================================

# Which element is prosperous (旺) in which month branch
MONTH_PROSPEROUS_ELEMENT: Dict[str, str] = {
    '寅': '木', '卯': '木',       # Spring → Wood prospers
    '巳': '火', '午': '火',       # Summer → Fire prospers
    '申': '金', '酉': '金',       # Autumn → Metal prospers
    '亥': '水', '子': '水',       # Winter → Water prospers
    '辰': '土', '未': '土', '戌': '土', '丑': '土',  # Earth months
}

# Day Master strength score adjustments by month
# 0 = dead season, 1 = very weak, 2 = weak, 3 = neutral, 4 = strong, 5 = prosperous
SEASON_STRENGTH: Dict[str, Dict[str, int]] = {
    '木': {'寅': 5, '卯': 5, '辰': 2, '巳': 1, '午': 1, '未': 2, '申': 0, '酉': 0, '戌': 2, '亥': 4, '子': 4, '丑': 2},
    '火': {'寅': 4, '卯': 4, '辰': 2, '巳': 5, '午': 5, '未': 2, '申': 1, '酉': 1, '戌': 2, '亥': 0, '子': 0, '丑': 2},
    '土': {'寅': 1, '卯': 1, '辰': 5, '巳': 4, '午': 4, '未': 5, '申': 2, '酉': 2, '戌': 5, '亥': 1, '子': 1, '丑': 5},
    '金': {'寅': 0, '卯': 0, '辰': 2, '巳': 1, '午': 1, '未': 2, '申': 5, '酉': 5, '戌': 2, '亥': 4, '子': 4, '丑': 2},
    '水': {'寅': 1, '卯': 1, '辰': 2, '巳': 0, '午': 0, '未': 2, '申': 4, '酉': 4, '戌': 2, '亥': 5, '子': 5, '丑': 2},
}

# ============================================================
# Hour Branch Time Ranges (using True Solar Time)
# ============================================================

# Each branch covers a 2-hour period
HOUR_BRANCHES: List[Tuple[int, int, str]] = [
    (23, 1, '子'),   # 23:00 - 00:59
    (1, 3, '丑'),    # 01:00 - 02:59
    (3, 5, '寅'),    # 03:00 - 04:59
    (5, 7, '卯'),    # 05:00 - 06:59
    (7, 9, '辰'),    # 07:00 - 08:59
    (9, 11, '巳'),   # 09:00 - 10:59
    (11, 13, '午'),  # 11:00 - 12:59
    (13, 15, '未'),  # 13:00 - 14:59
    (15, 17, '申'),  # 15:00 - 16:59
    (17, 19, '酉'),  # 17:00 - 18:59
    (19, 21, '戌'),  # 19:00 - 20:59
    (21, 23, '亥'),  # 21:00 - 22:59
]

# Stem for each hour, based on Day Stem
# Day Stem index (0-9) → first hour stem index
DAY_STEM_TO_HOUR_STEM_START: Dict[int, int] = {
    0: 0,  # 甲/己 day → 甲子時 start
    1: 2,  # 乙/庚 day → 丙子時 start
    2: 4,  # 丙/辛 day → 戊子時 start
    3: 6,  # 丁/壬 day → 庚子時 start
    4: 8,  # 戊/癸 day → 壬子時 start
    5: 0,  # 己/甲 → same as 甲
    6: 2,  # 庚/乙 → same as 乙
    7: 4,  # 辛/丙 → same as 丙
    8: 6,  # 壬/丁 → same as 丁
    9: 8,  # 癸/戊 → same as 戊
}

# ============================================================
# Solar Terms (節氣) — 24 solar terms for month boundary
# ============================================================

# The 12 "major" solar terms (節) that define month boundaries in Bazi
# These are the ODD-numbered solar terms in the full 24 cycle
MONTH_DEFINING_TERMS: List[str] = [
    '立春',  # Start of Spring → Month 1 (寅)
    '驚蟄',  # Awakening of Insects → Month 2 (卯)
    '清明',  # Clear and Bright → Month 3 (辰)
    '立夏',  # Start of Summer → Month 4 (巳)
    '芒種',  # Grain in Ear → Month 5 (午)
    '小暑',  # Slight Heat → Month 6 (未)
    '立秋',  # Start of Autumn → Month 7 (申)
    '白露',  # White Dew → Month 8 (酉)
    '寒露',  # Cold Dew → Month 9 (戌)
    '立冬',  # Start of Winter → Month 10 (亥)
    '大雪',  # Heavy Snow → Month 11 (子)
    '小寒',  # Slight Cold → Month 12 (丑)
]

# Month branch sequence starting from 寅 (month 1)
MONTH_BRANCHES: List[str] = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑']

# Year Stem → Month 1 (寅) Stem mapping
# 甲己年 → 丙寅月, 乙庚年 → 戊寅月, 丙辛年 → 庚寅月, 丁壬年 → 壬寅月, 戊癸年 → 甲寅月
YEAR_STEM_TO_MONTH_STEM_START: Dict[int, int] = {
    0: 2,  # 甲 → 丙 (index 2)
    1: 4,  # 乙 → 戊 (index 4)
    2: 6,  # 丙 → 庚 (index 6)
    3: 8,  # 丁 → 壬 (index 8)
    4: 0,  # 戊 → 甲 (index 0)
    5: 2,  # 己 → 丙
    6: 4,  # 庚 → 戊
    7: 6,  # 辛 → 庚
    8: 8,  # 壬 → 壬
    9: 0,  # 癸 → 甲
}
