"""
Compatibility Constants for Enhanced 合盤 (Bazi Compatibility Analysis)

Contains all scoring matrices, weight tables, knockout conditions, and labels
used by the 8-dimension compatibility scoring engine.

Reviewed and approved by 3 expert agents across 3 rounds:
- Bazi Domain Expert, Algorithm Engineer, Bazi Accuracy Validator
"""

from typing import Dict, List, Tuple

# ============================================================
# Dimension 1: 用神互補 — 5-God Interaction Matrix
# ============================================================
# Rows = A's element role, Columns = B's element role
# Order: 用神(0), 喜神(1), 閒神(2), 忌神(3), 仇神(4)

GOD_ROLES = ['usefulGod', 'favorableGod', 'idleGod', 'tabooGod', 'enemyGod']
GOD_ROLE_INDEX = {role: i for i, role in enumerate(GOD_ROLES)}

# 5x5 matrix: YONGSHEN_MATRIX[a_role_idx][b_role_idx] = score
# Range verified: [-115, +105] by exhaustive permutation (120 permutations)
YONGSHEN_MATRIX: List[List[int]] = [
    # B:  用神  喜神  閒神  忌神  仇神
    [  +10,  +40,    0,  -40,  -30],  # A: 用神
    [  +40,  +10,    0,  -30,  -20],  # A: 喜神
    [    0,    0,   +5,    0,    0],  # A: 閒神
    [  -40,  -30,    0,  +15,  +10],  # A: 忌神
    [  -30,  -20,    0,  +10,   +5],  # A: 仇神
]

# Normalization range for 用神互補 raw scores
YONGSHEN_RAW_MIN = -115  # Worst permutation
YONGSHEN_RAW_MAX = +105  # Best permutation
YONGSHEN_RANGE = YONGSHEN_RAW_MAX - YONGSHEN_RAW_MIN  # 220


# ============================================================
# Dimension 2: 天干五合 — Day Stem Combination Scores
# ============================================================

# Combination-specific scores for romance (per 《三命通會》)
STEM_COMBINATION_ROMANCE_SCORES: Dict[str, int] = {
    '中正之合': 95,   # 甲己 — most harmonious for marriage
    '仁義之合': 90,   # 乙庚 — loyal, stable partnership
    '無情之合': 85,   # 戊癸 — practical, functional bond
    '威制之合': 82,   # 丙辛 — passionate but controlling dynamics
    '淫慝之合': 72,   # 丁壬 — intense attraction but fidelity risk
}

# For business, all 5 combinations use flat score (moral implications less relevant)
STEM_COMBINATION_BUSINESS_SCORE = 88

# Day stem interaction scores (non-combination)
DAY_STEM_INTERACTION_SCORES: Dict[str, int] = {
    'combination': 0,       # Handled by STEM_COMBINATION_ROMANCE_SCORES
    'production': 75,       # 相生
    'same_element': 60,     # 比和 (same element, different stem)
    'identical': 70,        # 同柱 (identical stem — masters view same DM as deep understanding)
    'no_relation': 40,      # No special relationship
    'overcoming': 25,       # 相克
    'stem_clash': 10,       # 天干七沖
}


# ============================================================
# Dimension 3: 日支配偶宮 — Spouse Palace Scores
# ============================================================

# 六沖 severity from branch_relationships.py (higher = worse)
LIUCHONG_SEVERITY: Dict[Tuple[str, str], int] = {
    ('子', '午'): 90,  # Most severe — pure Water/Fire
    ('午', '子'): 90,
    ('寅', '申'): 85,  # Complex hidden stems
    ('申', '寅'): 85,
    ('卯', '酉'): 80,  # Pure Wood-Metal
    ('酉', '卯'): 80,
    ('巳', '亥'): 80,  # Hidden stems provide partial resolution
    ('亥', '巳'): 80,
    ('辰', '戌'): 75,  # Earth-Earth storage clash
    ('戌', '辰'): 75,
    ('丑', '未'): 70,  # Earth-Earth, mildest
    ('未', '丑'): 70,
}

# Self-punishment branches (for identical chart handling)
SELF_PUNISHMENT_BRANCHES = {'辰', '午', '酉', '亥'}

# 六合 result elements (branch combination → resulting element)
LIUHE_RESULT_ELEMENT: Dict[Tuple[str, str], str] = {
    ('子', '丑'): '土', ('丑', '子'): '土',
    ('寅', '亥'): '木', ('亥', '寅'): '木',
    ('卯', '戌'): '火', ('戌', '卯'): '火',
    ('辰', '酉'): '金', ('酉', '辰'): '金',
    ('巳', '申'): '水', ('申', '巳'): '水',
    ('午', '未'): '火', ('未', '午'): '火',
}


# ============================================================
# Dimension 4: 十神交叉 — Gender-Specific Ten God Scores
# ============================================================

# A's role in B's chart → score. Key: (ten_god, b_gender)
# b_gender: 'male' or 'female'. For same-sex, use 'neutral'.
TEN_GOD_ROMANCE_SCORES: Dict[str, Dict[str, int]] = {
    '正財': {'male': 90, 'female': 50, 'neutral': 65},
    '偏財': {'male': 75, 'female': 45, 'neutral': 55},
    '正官': {'male': 50, 'female': 90, 'neutral': 65},
    '偏官': {'male': 40, 'female': 75, 'neutral': 55},
    '食神': {'male': 80, 'female': 80, 'neutral': 80},
    '傷官': {'male': 55, 'female': 35, 'neutral': 45},
    '正印': {'male': 70, 'female': 85, 'neutral': 75},
    '偏印': {'male': 45, 'female': 55, 'neutral': 50},
    '比肩': {'male': 55, 'female': 55, 'neutral': 55},
    '劫財': {'male': 40, 'female': 40, 'neutral': 40},
}

# 格局 complementarity pairs for business comparison type
GEJU_COMPLEMENTARY_PAIRS: Dict[Tuple[str, str], int] = {
    ('正官格', '食神格'): 90,
    ('食神格', '正官格'): 90,
    ('正財格', '偏印格'): 80,
    ('偏印格', '正財格'): 80,
}

GEJU_CONFLICTING_PAIRS: Dict[Tuple[str, str], int] = {
    ('劫財格', '正財格'): -60,
    ('正財格', '劫財格'): -60,
    ('傷官格', '傷官格'): -50,
}


# ============================================================
# Dimension 6: 全盤互動 — Pillar Pair Weights
# ============================================================

# Cross-chart pillar pair weights for stem analysis
# day×day excluded (covered by Dim 2)
CROSS_PILLAR_STEM_WEIGHTS: Dict[Tuple[str, str], float] = {
    ('month', 'month'): 0.9,
    ('year', 'year'): 0.5,
    ('hour', 'hour'): 0.5,
}
CROSS_PILLAR_STEM_DEFAULT_WEIGHT = 0.3  # All other cross-pillar pairs

# Cross-chart pillar pair weights for branch analysis
CROSS_PILLAR_BRANCH_WEIGHTS: Dict[Tuple[str, str], float] = {
    ('day', 'day'): 1.0,
    ('month', 'month'): 0.9,
    ('year', 'year'): 0.5,
    ('hour', 'hour'): 0.5,
}
CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT = 0.3


# ============================================================
# Dimension 7: 神煞互動 — Shen Sha Score Impacts
# ============================================================

# Score impacts out of 5 for Shen Sha interactions
SHEN_SHA_TIAN_DE_YUE_DE_MUTUAL = 4.0
SHEN_SHA_TIAN_YI_CROSS_MATCH = 3.0
SHEN_SHA_HONG_LUAN_TIAN_XI_SYNC = 3.0
SHEN_SHA_TAOHUA_CROSS_MATCH = 2.0
SHEN_SHA_TAOHUA_HONGLUAN_COMBO = 2.0
SHEN_SHA_HUAGAI_FRIENDSHIP_BUSINESS = 1.0
SHEN_SHA_HUAGAI_ROMANCE = -1.0
SHEN_SHA_YIMA_BOTH = 1.0
SHEN_SHA_GUCHEN_GUASU_ONE = -2.0
SHEN_SHA_GUCHEN_GUASU_BOTH = -4.0
SHEN_SHA_NEUTRAL_DEFAULT = 2.5


# ============================================================
# Dimension 8: 大運同步 — Timing Sync Scores
# ============================================================

TIMING_BOTH_GOOD = 3
TIMING_BOTH_BAD = -3
TIMING_IMBALANCED = -2
TIMING_BOTH_NEUTRAL = 0


# ============================================================
# Weight Tables — By Comparison Type (8 dimensions)
# ============================================================

WEIGHT_TABLE: Dict[str, Dict[str, float]] = {
    'romance': {
        'yongshenComplementarity': 0.20,
        'dayStemRelationship': 0.15,
        'spousePalace': 0.15,
        'tenGodCross': 0.15,
        'elementComplementarity': 0.10,
        'fullPillarInteraction': 0.10,
        'shenShaInteraction': 0.05,
        'luckPeriodSync': 0.10,
    },
    'business': {
        'yongshenComplementarity': 0.25,
        'dayStemRelationship': 0.10,
        'spousePalace': 0.05,
        'tenGodCross': 0.25,
        'elementComplementarity': 0.10,
        'fullPillarInteraction': 0.10,
        'shenShaInteraction': 0.05,
        'luckPeriodSync': 0.10,
    },
    'friendship': {
        'yongshenComplementarity': 0.15,
        'dayStemRelationship': 0.15,
        'spousePalace': 0.10,
        'tenGodCross': 0.15,
        'elementComplementarity': 0.15,
        'fullPillarInteraction': 0.15,
        'shenShaInteraction': 0.05,
        'luckPeriodSync': 0.10,
    },
    'parent_child': {
        'yongshenComplementarity': 0.20,
        'dayStemRelationship': 0.10,
        'spousePalace': 0.10,
        'tenGodCross': 0.20,
        'elementComplementarity': 0.10,
        'fullPillarInteraction': 0.15,
        'shenShaInteraction': 0.05,
        'luckPeriodSync': 0.10,
    },
}


# ============================================================
# Knockout Conditions
# ============================================================

KNOCKOUT_TIANHE_DIHE_BONUS = 12
KNOCKOUT_TIANGAN_WUHE_BONUS = 8
KNOCKOUT_CROSS_SANHE_YONGSHEN_BONUS = 5
KNOCKOUT_LIUCHONG_ZIWU_PENALTY = -12
KNOCKOUT_LIUCHONG_MODERATE_PENALTY = -8  # 巳亥/卯酉/寅申
KNOCKOUT_TIAN_KE_DI_CHONG_PENALTY = -15
KNOCKOUT_TIAN_KE_DI_CHONG_HARD_FLOOR = 60
KNOCKOUT_GUAN_SHA_HUN_ZA_PENALTY = -8
KNOCKOUT_SHANG_GUAN_JIAN_GUAN_PENALTY = -6
KNOCKOUT_YONGSHEN_CONFLICT_PENALTY = -5
KNOCKOUT_GUCHEN_GUASU_BOTH_PENALTY = -5
KNOCKOUT_IDENTICAL_CHART_PENALTY = -5
KNOCKOUT_TIANGAN_WUHE_ADVERSE_PENALTY = -3  # 合而不利: stem combo with severe yongshen conflict
KNOCKOUT_BOTH_UNSTABLE_PALACE_PENALTY = -8  # Both have within-chart 六沖 hitting day branch
KNOCKOUT_ONE_UNSTABLE_PALACE_PENALTY = -3   # One has within-chart 六沖 hitting day branch
KNOCKOUT_BOTH_YINYANG_CUOCUO_PENALTY = -5   # Both have 陰陽差錯日
YONGSHEN_ADVERSE_THRESHOLD = -50  # rawYongshenScore below this = 合而不利

# 天德/月德 mitigation percentages
TIANDE_DAY_PILLAR_MITIGATION = 0.25
TIANDE_MONTH_PILLAR_MITIGATION = 0.17
TIANDE_YEAR_HOUR_PILLAR_MITIGATION = 0.12
TIANDE_MAX_MITIGATION = 0.40


# ============================================================
# Sigmoid Amplification Parameters
# ============================================================

SIGMOID_MIDPOINT = 45
SIGMOID_STEEPNESS = 0.10


# ============================================================
# Compatibility Labels
# ============================================================

COMPATIBILITY_LABELS: List[Dict] = [
    {'min': 90, 'max': 100, 'label': '天作之合', 'meaning': 'Match made in heaven'},
    {'min': 80, 'max': 89,  'label': '天生一對', 'meaning': 'Natural pair'},
    {'min': 70, 'max': 79,  'label': '相得益彰', 'meaning': 'Mutually enhancing'},
    {'min': 60, 'max': 69,  'label': '互補雙星', 'meaning': 'Complementary stars'},
    {'min': 50, 'max': 59,  'label': '歡喜冤家', 'meaning': 'Joy and conflict intertwined'},
    {'min': 40, 'max': 49,  'label': '需要磨合', 'meaning': 'Requires adjustment'},
    {'min': 30, 'max': 39,  'label': '挑戰重重', 'meaning': 'Significant challenges'},
    {'min': 0,  'max': 29,  'label': '緣分較淺', 'meaning': 'Shallow affinity'},
]

# Special labels (override linear labels when conditions met)
SPECIAL_LABEL_XIANG_AI_XIANG_SHA = '相愛相殺'  # Day stems combine BUT branches clash
SPECIAL_LABEL_QIAN_SHI_YUAN_JIA = '前世冤家'   # High 用神 BUT multiple clashes
SPECIAL_LABEL_MING_ZHONG_ZHU_DING = '命中注定'  # 天合地合 + 用神 > 70

# 天合地合 — 30 pairs in the 60 Jiazi system
# For any given day pillar, exactly 1 of 59 others forms 天合地合 (~1.7%)
# Stem must form 天干合 AND branch must form 六合 simultaneously
# The 30 pairs are determined by STEM_COMBINATION_LOOKUP + SIX_HARMONIES
