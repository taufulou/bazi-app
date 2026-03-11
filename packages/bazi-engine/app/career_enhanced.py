"""
Career Pre-Analysis Module (事業詳批)

All deterministic career-specific calculations. No AI involved.
Career-specific equivalent of lifetime_enhanced.py.

Contains 10 pre-analysis functions + master orchestrator:
1. compute_reputation_score — 名聲地位 (0-100)
2. compute_wealth_score — 財富格局 (0-100 + tier)
3. compute_suitable_positions — 適合職位
4. compute_company_type_fit — 企業類型
5. compute_entrepreneurship_fit — 創業適合度
6. compute_partnership_fit — 合夥適合度
7. compute_career_allies_enemies — 貴人小人
8. compute_annual_forecast_data — 五年流年
9. compute_monthly_forecast_data — 十二月運勢
10. compute_five_qi_states — 旺相休囚死
"""

from typing import Any, Dict, List, Optional, Set, Tuple

from .constants import (
    BRANCH_ELEMENT,
    BRANCH_INDEX,
    EARTHLY_BRANCHES,
    ELEMENT_OVERCOMES,
    ELEMENT_OVERCOME_BY,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    FIVE_ELEMENTS,
    HEAVENLY_STEMS,
    HIDDEN_STEMS,
    SEASON_STRENGTH,
    BRANCH_LIUHE,
    STEM_COMBINATIONS,
    STEM_ELEMENT,
    STEM_INDEX,
    STEM_YINYANG,
    TIANYI_GUIREN,
    WENCHANG,
    YIMA,
)
from .branch_relationships import (
    analyze_branch_relationships,
    THREE_PUNISHMENTS,
    SIX_HARMS,
)
from .five_elements import (
    calculate_weighted_five_elements,
    get_seasonal_state_labels,
)
from .lifetime_enhanced import ELEMENT_INDUSTRIES_DETAILED
from .shen_sha import calculate_kong_wang, get_all_shen_sha
from .ten_gods import (
    calculate_weighted_ten_gods,
    derive_ten_god,
    TEN_GOD_CAPABILITIES,
)


# ============================================================
# Constants — Position Archetypes by Pattern (格局)
# ============================================================

PATTERN_POSITIONS: Dict[str, List[str]] = {
    '正官': ['管理層', '主管', '行政', '公務員', '法律'],
    '偏官': ['軍警', '外科醫師', '工程', '危機管理', '高壓環境'],
    '正財': ['財務', '會計', '穩定企業', '不動產'],
    '偏財': ['業務', '投資', '貿易', '零售'],
    '食神': ['餐飲', '藝術', '教育', '心理諮詢'],
    '傷官': ['律師', '設計師', '工程師', '創新研發'],
    '正印': ['教育', '研究', '醫療', '宗教', '出版'],
    '偏印': ['技術研究', '哲學', '另類醫學', '策略顧問'],
    '比肩': ['合夥事業', '團隊運動', '仲介'],
    '劫財': ['競爭性行業', '業務', '投機'],
}

# Zodiac animal mapping for branch index
ZODIAC_ANIMALS: Dict[str, str] = {
    '子': '鼠', '丑': '牛', '寅': '虎', '卯': '兔',
    '辰': '龍', '巳': '蛇', '午': '馬', '未': '羊',
    '申': '猴', '酉': '雞', '戌': '狗', '亥': '豬',
}

# 三合 zodiac groupings
SANHE_GROUPS: Dict[str, List[str]] = {
    '申': ['子', '辰'], '子': ['申', '辰'], '辰': ['申', '子'],  # 水局
    '寅': ['午', '戌'], '午': ['寅', '戌'], '戌': ['寅', '午'],  # 火局
    '巳': ['酉', '丑'], '酉': ['巳', '丑'], '丑': ['巳', '酉'],  # 金局
    '亥': ['卯', '未'], '卯': ['亥', '未'], '未': ['亥', '卯'],  # 木局
}

# 六沖 pairs
LIUCHONG_PAIRS: Dict[str, str] = {
    '子': '午', '午': '子', '丑': '未', '未': '丑',
    '寅': '申', '申': '寅', '卯': '酉', '酉': '卯',
    '辰': '戌', '戌': '辰', '巳': '亥', '亥': '巳',
}

# Role key mapping: engine format → internal Chinese format
_ROLE_KEY_TO_CHINESE = {
    'usefulGod': '用神',
    'favorableGod': '喜神',
    'idleGod': '閒神',
    'tabooGod': '忌神',
    'enemyGod': '仇神',
}

# 流年-only auspiciousness mapping: god role → display label (R6-2)
# Used to compute annual auspiciousness from 流年 stem only (no 大運 combination)
YEAR_ROLE_TO_AUSPICIOUSNESS: Dict[str, str] = {
    '用神': '大吉',
    '喜神': '吉',
    '閒神': '平',
    '仇神': '凶',
    '忌神': '大凶',
}


def _normalize_effective_gods(gods_dict: Dict[str, str]) -> Dict[str, str]:
    """
    Convert effective_gods from engine format to internal format.

    Engine format: {'usefulGod': '水', 'favorableGod': '木', ...}  (role_en → element)
    Internal format: {'水': '用神', '木': '喜神', ...}  (element → role_zh)

    If already in internal format (element keys like '木','火'), returns as-is.
    """
    if not gods_dict:
        return {}
    # Detect format: if any key is an English role name, convert
    first_key = next(iter(gods_dict))
    if first_key in _ROLE_KEY_TO_CHINESE:
        # Engine format → convert to {element: role_chinese}
        return {
            element: _ROLE_KEY_TO_CHINESE[role_key]
            for role_key, element in gods_dict.items()
            if role_key in _ROLE_KEY_TO_CHINESE
        }
    # Already in internal format
    return gods_dict


# ============================================================
# 1. Reputation Score (名聲地位)
# ============================================================

def compute_reputation_score(
    pillars: Dict,
    day_master_stem: str,
    prominent_god: str,
    effective_gods: Dict[str, str],
    month_branch: str,
    cong_ge: Optional[Dict],
    branch_relationships: Dict,
) -> Dict[str, Any]:
    """
    Compute reputation/status score (名聲地位) 0-100.

    Classical basis: 《子平真詮》格局高低 assessment.
    Based on: 格局清純度(30%) + 官星力量(25%) + 用神力量(20%) +
              印星輔助(15%) + 刑沖扣分(10%)

    Returns:
        Dict with score, sub_scores, and level
    """
    all_stems = _get_all_stems(pillars)
    all_hidden = _get_all_hidden_stems(pillars)

    # Sub-score 1: 格局清純度 (Pattern Purity, 0-100)
    purity_score = _compute_pattern_purity(
        pillars, day_master_stem, prominent_god, effective_gods, all_stems,
        all_hidden=all_hidden, branch_relationships=branch_relationships,
    )

    # Sub-score 2: 官星力量 (Officer Star Strength, 0-100)
    officer_score = _compute_officer_strength(
        pillars, day_master_stem, month_branch, all_stems, all_hidden,
    )

    # Sub-score 3: 用神力量 (Useful God Strength, 0-100)
    useful_god_score = _compute_useful_god_strength(
        pillars, day_master_stem, effective_gods, month_branch,
    )

    # Sub-score 4: 印星輔助 (Seal Support, 0-100)
    seal_score = _compute_seal_support(
        pillars, day_master_stem, month_branch, all_stems, all_hidden,
    )

    # Sub-score 5: 刑沖扣分 (Clash/Punishment Deduction, 0-30)
    clash_deduction = _compute_clash_deduction(branch_relationships)

    # Apply 格局-conditional weights
    is_cong = cong_ge is not None
    if is_cong:
        cong_type = cong_ge.get('subtype', '')
        if '從官' in cong_type:
            weights = (0.20, 0.35, 0.20, 0.15, 0.10)
        elif '從財' in cong_type:
            weights = (0.30, 0.15, 0.25, 0.20, 0.10)
        elif '從兒' in cong_type:
            # A20: 從兒格 emphasizes 用神 (which IS 食傷), reduces officer weight
            weights = (0.25, 0.10, 0.30, 0.20, 0.15)
        else:
            weights = (0.30, 0.25, 0.20, 0.15, 0.10)
    else:
        weights = (0.30, 0.25, 0.20, 0.15, 0.10)

    raw_score = (
        purity_score * weights[0]
        + officer_score * weights[1]
        + useful_god_score * weights[2]
        + seal_score * weights[3]
    )
    final_score = max(0, min(100, round(raw_score - clash_deduction * weights[4])))

    level = _score_to_level(final_score)

    return {
        'score': final_score,
        'level': level,
        'subScores': {
            'patternPurity': round(purity_score),
            'officerStrength': round(officer_score),
            'usefulGodStrength': round(useful_god_score),
            'sealSupport': round(seal_score),
            'clashDeduction': round(clash_deduction),
        },
    }


# ============================================================
# 2. Wealth Score (財富格局)
# ============================================================

def compute_wealth_score(
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict[str, str],
    month_branch: str,
    cong_ge: Optional[Dict],
    strength_v2: Dict,
    luck_periods: List[Dict],
    current_year: int = 2026,
    ten_god_dist: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """
    Compute wealth score (財富格局) 0-100 + tier.

    Classical 5-factor progressive system:
    財星喜忌(25%) + 財星實虛(20%) + 食傷生財(20%) + 財庫(15%) + 大運配合(20%)

    Wealth tiers: <40=平常, 40-55=小富, 55-70=中富, 70-85=大富, 85+=巨富

    A9: Added ten_god_dist for 食神 vs 傷官 personality distinction in Factor 3.
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    wealth_element = ELEMENT_OVERCOMES[dm_element]
    output_element = ELEMENT_PRODUCES[dm_element]

    all_stems = _get_all_stems(pillars)
    all_hidden = _get_all_hidden_stems(pillars)

    # Factor 1: 財星喜忌 (Wealth Favorable/Unfavorable, 0-100)
    wealth_role = effective_gods.get(wealth_element, '閒神')
    if wealth_role in ('用神', '喜神'):
        f1_base = 50
    elif wealth_role in ('忌神', '仇神'):
        f1_base = 10
    else:
        f1_base = 30
    # Position bonus
    if pillars['day']['branch'] in _branches_of_element(wealth_element):
        f1_base += 20
    # A14: Additive and value-specific per plan (月干+15, 時干+10)
    if STEM_ELEMENT.get(pillars['month']['stem']) == wealth_element:
        f1_base += 15
    if STEM_ELEMENT.get(pillars['hour']['stem']) == wealth_element:
        f1_base += 10
    f1_score = min(100, f1_base)

    # Factor 2: 財星實虛 (Wealth Real/Hollow, 0-100)
    f2_score = 0
    wealth_stems = [s for s in all_stems if STEM_ELEMENT.get(s) == wealth_element]
    if wealth_stems:
        f2_score += min(50, len(wealth_stems) * 25)
    # Check if rooted in branches
    wealth_hidden = [h for h in all_hidden if STEM_ELEMENT.get(h) == wealth_element]
    if wealth_hidden:
        f2_score += 30  # 通根有根 = 實
    # Seasonal strength
    season_score = SEASON_STRENGTH.get(wealth_element, {}).get(month_branch, 3)
    if season_score >= 4:
        f2_score += 20
    elif season_score == 3:
        f2_score += 10
    f2_score = min(100, f2_score)

    # Factor 3: 食傷生財 (Output Generating Wealth, 0-100)
    f3_score = 0
    output_stems = [s for s in all_stems if STEM_ELEMENT.get(s) == output_element]
    output_hidden = [h for h in all_hidden if STEM_ELEMENT.get(h) == output_element]
    if (output_stems or output_hidden) and (wealth_stems or wealth_hidden):
        f3_score += 40  # Chain present
        # Check no 偏印奪食 blocking
        seal_element = ELEMENT_PRODUCED_BY[dm_element]
        indirect_seal = [s for s in all_stems if STEM_ELEMENT.get(s) == seal_element
                         and STEM_YINYANG.get(s) == STEM_YINYANG.get(day_master_stem)]
        if not indirect_seal:
            f3_score += 30  # Chain unbroken
        # Seasonal support for output
        output_season = SEASON_STRENGTH.get(output_element, {}).get(month_branch, 3)
        if output_season >= 4:
            f3_score += 15
        # A9: 食神 vs 傷官 personality distinction (+15)
        if ten_god_dist:
            shishen_count = ten_god_dist.get('食神', 0)
            shangguan_count = ten_god_dist.get('傷官', 0)
            if shishen_count > shangguan_count:
                f3_score += 15  # 食神 = gentle, steady wealth creation
            elif shangguan_count > shishen_count:
                f3_score += 15  # 傷官 = aggressive, innovative wealth creation
            # If equal, no bonus (ambiguous)
        else:
            f3_score += 15  # Fallback: base bonus for having the chain
    f3_score = min(100, f3_score)

    # Factor 4: 財庫 (Wealth Treasury, 0-100)
    f4_score = _compute_treasury_score(
        pillars, dm_element, wealth_element, effective_gods, strength_v2,
    )

    # Factor 5: 大運配合 (Luck Period Support, 0-100)
    f5_score = _compute_luck_period_wealth_support(
        luck_periods, wealth_element, effective_gods, current_year,
    )

    # Apply 格局-conditional weights
    is_cong = cong_ge is not None
    if is_cong:
        cong_type = cong_ge.get('subtype', '')
        if '從財' in cong_type:
            weights = (0.35, 0.20, 0.15, 0.15, 0.15)
        elif '從兒' in cong_type:
            weights = (0.15, 0.20, 0.30, 0.15, 0.20)
        else:
            weights = (0.25, 0.20, 0.20, 0.15, 0.20)
    else:
        weights = (0.25, 0.20, 0.20, 0.15, 0.20)

    raw_score = (
        f1_score * weights[0]
        + f2_score * weights[1]
        + f3_score * weights[2]
        + f4_score * weights[3]
        + f5_score * weights[4]
    )
    final_score = max(0, min(100, round(raw_score)))

    # Wealth tier
    if final_score >= 85:
        tier = '巨富'
    elif final_score >= 70:
        tier = '大富'
    elif final_score >= 55:
        tier = '中富'
    elif final_score >= 40:
        tier = '小富'
    else:
        tier = '平常'

    return {
        'score': final_score,
        'tier': tier,
        'subScores': {
            'wealthFavorability': round(f1_score),
            'wealthReality': round(f2_score),
            'outputGenerating': round(f3_score),
            'treasury': round(f4_score),
            'luckPeriodSupport': round(f5_score),
        },
    }


# ============================================================
# 3. Suitable Positions (適合職位)
# ============================================================

def compute_suitable_positions(
    pillars: Dict,
    day_master_stem: str,
    prominent_god: str,
    cong_ge: Optional[Dict],
) -> List[Dict[str, Any]]:
    """
    Compute suitable career positions based on 格局 + 透干 analysis.

    Returns:
        List of position recommendations with reasoning anchors
    """
    results = []

    # Primary: 格局 ten god → position archetype
    pattern_name = prominent_god
    if cong_ge:
        cong_type = cong_ge.get('subtype', '')
        if '從官' in cong_type:
            pattern_name = '偏官'
        elif '從財' in cong_type:
            pattern_name = '偏財'
        elif '從兒' in cong_type:
            pattern_name = '傷官'

    primary_positions = PATTERN_POSITIONS.get(pattern_name, [])
    results.append({
        'source': '格局',
        'pattern': pattern_name,
        'positions': primary_positions,
        'priority': 'primary',
    })

    # Secondary: 透干 analysis — which ten gods appear as manifest stems?
    manifest_gods = set()
    for pname in ('year', 'month', 'hour'):
        god = derive_ten_god(day_master_stem, pillars[pname]['stem'])
        manifest_gods.add(god)

    for god in manifest_gods:
        if god != pattern_name and god in PATTERN_POSITIONS:
            results.append({
                'source': '透干',
                'pattern': god,
                'positions': PATTERN_POSITIONS[god],
                'priority': 'secondary',
            })

    # Tertiary part 1: 月支本氣 ten god → position archetype (A19)
    month_main_hidden = HIDDEN_STEMS.get(pillars['month']['branch'], [''])[0]
    if month_main_hidden:
        month_god = derive_ten_god(day_master_stem, month_main_hidden)
        if month_god != pattern_name and month_god in PATTERN_POSITIONS:
            results.append({
                'source': '月支本氣',
                'pattern': month_god,
                'positions': PATTERN_POSITIONS[month_god],
                'priority': 'tertiary',
            })

    # Tertiary part 2: Special combinations (returns List, may match multiple)
    combos = _detect_position_combinations(manifest_gods, prominent_god)
    for combo in combos:
        results.append({
            'source': '組合',
            'pattern': combo['name'],
            'positions': combo['positions'],
            'priority': 'tertiary',
        })

    return results


# ============================================================
# 4. Company Type Fit (企業類型)
# ============================================================

def compute_company_type_fit(
    pillars: Dict,
    day_master_stem: str,
    prominent_god: str,
) -> Dict[str, Any]:
    """
    Determine company type fit based on 正/偏 ten god balance.

    正 stars (structured): 正官/正財/正印/食神/比肩
    偏 stars (dynamic): 七殺/偏財/偏印/傷官/劫財
    """
    zheng_gods = {'正官', '正財', '正印', '食神', '比肩'}
    pian_gods = {'偏官', '偏財', '偏印', '傷官', '劫財'}

    zheng_count = 0
    pian_count = 0

    # Count from manifest stems (excluding day master)
    for pname in ('year', 'month', 'hour'):
        god = derive_ten_god(day_master_stem, pillars[pname]['stem'])
        if god in zheng_gods:
            zheng_count += 1
        elif god in pian_gods:
            pian_count += 1

    # Count from hidden stems
    for pname in ('year', 'month', 'day', 'hour'):
        for hs in HIDDEN_STEMS.get(pillars[pname]['branch'], []):
            god = derive_ten_god(day_master_stem, hs)
            if god in zheng_gods:
                zheng_count += 0.5
            elif god in pian_gods:
                pian_count += 0.5

    # A18: DM yin/yang modulation (subtle tiebreaker, plan §1d.4)
    dm_yinyang = STEM_YINYANG[day_master_stem]
    if dm_yinyang == '陽':
        zheng_count += 0.5  # 陽干 = structured energy
    else:
        pian_count += 0.5   # 陰干 = fluid energy

    # Determine type
    diff = zheng_count - pian_count

    if diff >= 2:
        fit_type = 'stable'
        label = '穩定型'
        description = '大型企業、政府機構、傳統產業'
    elif diff <= -2:
        fit_type = 'innovative'
        label = '創新型'
        description = '新創公司、自由業、競爭性行業'
    else:
        fit_type = 'balanced'
        label = '兼容型'
        description = '中型企業、雙軌發展'

    return {
        'type': fit_type,
        'label': label,
        'description': description,
        'zhengCount': round(zheng_count, 1),
        'pianCount': round(pian_count, 1),
        'dayMasterYinYang': dm_yinyang,
        'anchors': {
            'prominentGod': prominent_god,
            'yinYangNote': '陽干=外向行動型' if dm_yinyang == '陽' else '陰干=靈活適應型',
        },
    }


# ============================================================
# 5. Entrepreneurship Fit (創業適合度)
# ============================================================

def compute_entrepreneurship_fit(
    pillars: Dict,
    day_master_stem: str,
    strength_v2: Dict,
    cong_ge: Optional[Dict],
    ten_god_dist: Dict[str, int],
    all_shen_sha: List[Dict],
) -> Dict[str, Any]:
    """
    Compute entrepreneurship suitability score and type.

    Key entrepreneurship indicators: 七殺, 偏財, 傷官, 劫財
    """
    score = 0
    reasons = []

    # Check primary indicators
    entrepreneur_gods = {
        '偏官': ('七殺', 20, '野心勇氣、不甘居下'),
        '偏財': ('偏財', 20, '商業直覺、社交人脈'),
        '傷官': ('傷官', 20, '創新突破、商業敏銳'),
        '劫財': ('劫財', 20, '行動果斷、冒險競爭'),
    }

    for god, (label, pts, desc) in entrepreneur_gods.items():
        if ten_god_dist.get(god, 0) > 0:
            score += pts
            reasons.append(f'{label}顯現: {desc}')

    # Key combinations (bonus +15 each)
    combos = [
        (['偏財', '偏官'], '偏財+七殺: 能力強勁、衝勁十足'),
        (['偏財', '傷官'], '偏財+傷官: 賺錢嗅覺強、能力佳'),
        (['傷官', '偏官'], '傷官+七殺: 表達才華+果斷執行'),
        (['食神', '偏財'], '食神生偏財: 創意變現、穩健創業'),  # A16
    ]
    for gods, desc in combos:
        if all(ten_god_dist.get(g, 0) > 0 for g in gods):
            score += 15
            reasons.append(desc)

    # Prerequisites check
    is_strong = strength_v2.get('category') in ('strong', 'very_strong')
    is_cong = cong_ge is not None

    if not is_strong and not is_cong:
        score = max(score - 30, 0)
        reasons.append('身弱非從格: 創業風險較高')

    # Treasury check
    dm_element = STEM_ELEMENT[day_master_stem]
    wealth_element = ELEMENT_OVERCOMES[dm_element]
    treasury = _find_treasury_branches(pillars, wealth_element)
    if treasury:
        score += 10
        reasons.append('有財庫: 具財富累積潛力')

    # 驛馬 check
    has_yima = any(sha['name'] == '驛馬' for sha in all_shen_sha)
    if has_yima:
        score += 5
        reasons.append('有驛馬: 事業擴展機動性強')

    # Anti-indicators
    anti_gods = {'正官': 15, '正印': 15, '正財': 15}
    for god, penalty in anti_gods.items():
        if ten_god_dist.get(god, 0) >= 2:  # Dominant
            score = max(score - penalty, 0)
            reasons.append(f'{god}偏旺: 偏好穩定，創業意願低')

    score = min(100, max(0, score))

    # Determine type
    if score < 30 or (not is_strong and not is_cong):
        etype = 'not_recommended'
        label = '不建議創業'
    elif ten_god_dist.get('傷官', 0) > 0 and ten_god_dist.get('偏印', 0) > 0:
        etype = 'technical_founder'
        label = '技術型創辦人'
    elif ten_god_dist.get('偏財', 0) > 0 and ten_god_dist.get('偏官', 0) > 0:
        etype = 'business_founder'
        label = '商業型創辦人'
    elif ten_god_dist.get('食神', 0) > 0 or ten_god_dist.get('傷官', 0) > 0:
        etype = 'freelancer'
        label = '自由工作者'
    else:
        etype = 'business_founder'
        label = '商業型創辦人'

    return {
        'score': score,
        'type': etype,
        'label': label,
        'reasons': reasons,
    }


# ============================================================
# 6. Partnership Fit (合夥適合度)
# ============================================================

def compute_partnership_fit(
    pillars: Dict,
    day_master_stem: str,
    ten_god_dist: Dict[str, int],
    branch_relationships: Dict,
    effective_gods: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Compute partnership suitability based on 五行互補 principle.
    A7: Added effective_gods for 用神/忌神 context-aware 比劫 scoring.
    A8: Added bijie_total == 2 branch.
    A11: Fixed typo bijiie_total → bijie_total.
    """
    score = 50  # Start neutral
    reasons = []

    # Check 比肩/劫財 balance (A7: context-aware with 用神/忌神)
    bijian = ten_god_dist.get('比肩', 0)
    jiecai = ten_god_dist.get('劫財', 0)
    bijie_total = bijian + jiecai

    # Determine if 比劫 element is 用神/喜神
    dm_element = STEM_ELEMENT.get(day_master_stem, '')
    bijie_is_useful = False
    if effective_gods:
        bijie_role = effective_gods.get(dm_element, '')
        bijie_is_useful = bijie_role in ('用神', '喜神')

    if bijie_total == 1:
        score += 15
        reasons.append('比劫適中：有合作能力但不過分')
    elif bijie_total == 2:
        if bijie_is_useful:
            score += 10
            reasons.append('比劫為喜用且適量：合夥互助有利')
        else:
            score += 5
            reasons.append('比劫數量平衡：合夥尚可但需注意分工')
    elif bijie_total >= 3:
        if bijie_is_useful:
            score += 5
            reasons.append('比劫雖多但為喜用：合夥人多反而有利，但需明確分工')
        else:
            score -= 25
            reasons.append('比劫過旺且為忌：容易與合夥人爭奪資源')
    elif bijie_total == 0:
        score += 5
        reasons.append('比劫不顯：獨立性強，合夥互補空間大')

    # Check 六合/三合 in pillars — cooperative nature
    harmonies_count = len(branch_relationships.get('harmonies', []))
    triple_count = len(branch_relationships.get('tripleHarmonies', []))
    if harmonies_count > 0 or triple_count > 0:
        score += 20
        reasons.append('命局有合: 天生具合作緣分')

    # Check 刑沖 on 月柱 — conflict-prone
    clashes = branch_relationships.get('clashes', [])
    month_clashed = any(
        'month' in (c.get('pillarA', ''), c.get('pillarB', ''))
        for c in clashes
    )
    if month_clashed:
        score -= 15
        reasons.append('月柱逢沖: 職場人際易有摩擦')

    # 食傷 + 偏財 = wealth generation through collaboration
    if ten_god_dist.get('食神', 0) > 0 or ten_god_dist.get('傷官', 0) > 0:
        if ten_god_dist.get('偏財', 0) > 0:
            score += 10
            reasons.append('食傷生偏財: 合作可產出財富')

    score = max(0, min(100, score))
    suitable = score >= 50

    return {
        'score': score,
        'suitable': suitable,
        'label': '適合合夥' if suitable else '宜獨立經營',
        'reasons': reasons,
    }


# ============================================================
# 7. Career Allies & Enemies (貴人小人)
# ============================================================

def compute_career_allies_enemies(
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict[str, str],
    all_shen_sha: List[Dict],
) -> Dict[str, Any]:
    """
    Compute career allies and enemies through 6 layers of analysis.

    Layer 1: 貴人 Noble Stars (天乙貴人, 文昌, 天德/月德, 福星)
    Layer 2: Career-Specific Shensha (將星, 國印, 華蓋, 太極)
    Layer 3: 驛馬 (mobility bringers)
    Layer 4: 三合/六合 Zodiac allies
    Layer 5: 六沖/刑/害 Zodiac enemies
    Layer 6: 四惡星 as 忌神 → 小人 indicators
    """
    # Layer 1: Noble Stars
    nobles = []
    noble_names = {'天乙貴人', '文昌', '天德貴人', '月德貴人', '福星貴人'}
    for sha in all_shen_sha:
        if sha['name'] in noble_names:
            nobles.append({
                'name': sha['name'],
                'branch': sha['branch'],
                'zodiac': ZODIAC_ANIMALS.get(sha['branch'], ''),
                'pillar': sha['pillar'],
            })

    # Layer 2: Career-Specific Shensha
    career_shensha = []
    career_sha_names = {'將星', '國印貴人', '華蓋', '太極貴人'}
    for sha in all_shen_sha:
        if sha['name'] in career_sha_names:
            career_shensha.append({
                'name': sha['name'],
                'branch': sha['branch'],
                'zodiac': ZODIAC_ANIMALS.get(sha['branch'], ''),
                'pillar': sha['pillar'],
            })

    # Layer 3: 驛馬 mobility
    mobility_bringers = []
    for sha in all_shen_sha:
        if sha['name'] == '驛馬':
            mobility_bringers.append({
                'branch': sha['branch'],
                'zodiac': ZODIAC_ANIMALS.get(sha['branch'], ''),
            })

    # Layer 4: 三合 Zodiac allies
    year_branch = pillars['year']['branch']
    day_branch = pillars['day']['branch']
    allies = set()
    for key_branch in (year_branch, day_branch):
        if key_branch in SANHE_GROUPS:
            for ally in SANHE_GROUPS[key_branch]:
                allies.add(ally)
    ally_list = [
        {'branch': b, 'zodiac': ZODIAC_ANIMALS.get(b, '')}
        for b in sorted(allies) if b != year_branch and b != day_branch
    ]

    # Layer 5: 六沖/刑/害 enemies (A17: expanded from just 六沖)
    enemies = set()
    for key_branch in (year_branch, day_branch):
        # 六沖
        if key_branch in LIUCHONG_PAIRS:
            enemies.add(LIUCHONG_PAIRS[key_branch])
        # 三刑 (from branch_relationships.py)
        for xing_group in THREE_PUNISHMENTS:
            all_sets = [xing_group['branches']] + xing_group.get('partials', [])
            for branch_set in all_sets:
                if key_branch in branch_set:
                    for b in branch_set:
                        if b != key_branch:
                            enemies.add(b)
        # 六害 (from branch_relationships.py)
        for pair in SIX_HARMS:
            if key_branch in pair:
                for b in pair:
                    if b != key_branch:
                        enemies.add(b)
    enemy_list = [
        {'branch': b, 'zodiac': ZODIAC_ANIMALS.get(b, '')}
        for b in sorted(enemies)
    ]

    # Layer 6: 四惡星 as 忌神 → 小人 indicators
    antagonists = []
    evil_star_map = {
        '偏官': ('權威型小人', '上司打壓、強勢欺壓'),
        '偏印': ('暗算型小人', '嫉妒同事、暗中破壞'),
        '劫財': ('奪財型小人', '合夥背叛、搶奪功勞'),
        '傷官': ('口舌型小人', '造謠中傷、挑起紛爭'),
    }
    for god, (label, desc) in evil_star_map.items():
        # Check if this god's element is 忌神
        god_element = _ten_god_to_element(day_master_stem, god)
        if god_element and effective_gods.get(god_element) in ('忌神', '仇神'):
            antagonists.append({
                'tenGod': god,
                'label': label,
                'description': desc,
            })

    return {
        'nobles': nobles,
        'careerShensha': career_shensha,
        'allies': ally_list,
        'mobilityBringers': mobility_bringers,
        'enemies': enemy_list,
        'antagonists': antagonists,
    }


# ============================================================
# 8. Annual Forecast Data (五年流年)
# ============================================================

def compute_annual_forecast_data(
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict[str, str],
    luck_periods: List[Dict],
    annual_stars: List[Dict],
    kong_wang: List[str],
    all_shen_sha: List[Dict],
    current_year: int = 2026,
    forecast_years: int = 5,
) -> List[Dict[str, Any]]:
    """
    Compute annual forecast data combining 大運+流年 analysis.

    Classical: "流年為君，大運為臣，命局為民" (《三命通會》)
    """
    results = []

    # Get the forecasted annual stars
    target_years = [current_year + i for i in range(forecast_years)]

    # Get 驛馬 branch from shen sha
    yima_branch = None
    for sha in all_shen_sha:
        if sha['name'] == '驛馬':
            yima_branch = sha['branch']
            break

    for year_star in annual_stars:
        if year_star['year'] not in target_years:
            continue

        year = year_star['year']
        year_stem = year_star['stem']
        year_branch = year_star['branch']
        year_ten_god = derive_ten_god(day_master_stem, year_stem)

        # Find active 大運
        active_lp = _find_active_luck_period(luck_periods, year)

        # 大運 ten god
        lp_ten_god = ''
        lp_stem = ''
        lp_branch = ''
        if active_lp:
            lp_stem = active_lp['stem']
            lp_branch = active_lp['branch']
            lp_ten_god = derive_ten_god(day_master_stem, lp_stem)

        # 大運 auspiciousness
        lp_auspicious = _assess_element_auspiciousness(
            STEM_ELEMENT.get(lp_stem, ''), effective_gods,
        ) if lp_stem else 'neutral'

        # 流年 auspiciousness
        year_auspicious = _assess_element_auspiciousness(
            STEM_ELEMENT.get(year_stem, ''), effective_gods,
        )

        # 流年-only auspiciousness — 5-level mapping based on year stem's element role
        # (大運 context still passed in output for AI narrative, but label is 流年-only)
        year_element = STEM_ELEMENT.get(year_stem, '')
        year_role = effective_gods.get(year_element, '閒神')
        combined = YEAR_ROLE_TO_AUSPICIOUSNESS.get(year_role, '平')

        # 空亡 analysis
        kong_wang_analysis = _analyze_kong_wang_for_year(
            year_branch, kong_wang, effective_gods,
        )

        # 驛馬 analysis
        yima_analysis = _analyze_yima_for_year(
            year_branch, yima_branch, effective_gods,
        )

        # Career timing indicators
        career_indicators = _detect_career_indicators(
            year_ten_god, lp_ten_god, day_master_stem, year_stem, year_branch,
            pillars, effective_gods,
        )

        # A13: Branch interactions (plan §1d.8 items d, e, f)
        branch_interactions = []
        day_branch = pillars['day']['branch']
        month_branch_val = pillars['month']['branch']

        # d. 大運地支 + 流年地支 interactions
        if lp_branch and year_branch:
            if lp_branch == year_branch:
                branch_interactions.append(f'大運{lp_branch}與流年{year_branch}伏吟')
            elif LIUCHONG_PAIRS.get(lp_branch) == year_branch:
                branch_interactions.append(f'大運{lp_branch}沖流年{year_branch}')
            if BRANCH_LIUHE.get(lp_branch) == year_branch:
                branch_interactions.append(f'大運{lp_branch}合流年{year_branch}')

        # e. 流年地支 + 日支/月支 interactions
        for label, natal_branch in [('日支', day_branch), ('月支', month_branch_val)]:
            if year_branch == natal_branch:
                branch_interactions.append(f'流年{year_branch}與{label}{natal_branch}伏吟')
            elif LIUCHONG_PAIRS.get(year_branch) == natal_branch:
                branch_interactions.append(f'流年{year_branch}沖{label}{natal_branch}')
            elif BRANCH_LIUHE.get(year_branch) == natal_branch:
                branch_interactions.append(f'流年{year_branch}合{label}{natal_branch}')

        # f. 大運地支 + 命局地支 interactions
        if lp_branch:
            for pname, plabel in [('year', '年支'), ('month', '月支'),
                                   ('day', '日支'), ('hour', '時支')]:
                nb = pillars[pname]['branch']
                if lp_branch != nb and LIUCHONG_PAIRS.get(lp_branch) == nb:
                    branch_interactions.append(f'大運{lp_branch}沖{plabel}{nb}')

        results.append({
            'year': year,
            'stem': year_stem,
            'branch': year_branch,
            'tenGod': year_ten_god,
            'luckPeriodStem': lp_stem,
            'luckPeriodBranch': lp_branch,
            'luckPeriodTenGod': lp_ten_god,
            'luckPeriodStartYear': active_lp.get('startYear', 0) if active_lp else 0,
            'luckPeriodEndYear': active_lp.get('endYear', 0) if active_lp else 0,
            'auspiciousness': combined,
            'kongWangAnalysis': kong_wang_analysis,
            'yimaAnalysis': yima_analysis,
            'careerIndicators': career_indicators,
            'branchInteractions': branch_interactions,
        })

    return results


# ============================================================
# 9. Monthly Forecast Data (十二月運勢)
# ============================================================

def compute_monthly_forecast_data(
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict[str, str],
    monthly_stars: List[Dict],
    annual_auspiciousness: str,
) -> List[Dict[str, Any]]:
    """
    Compute monthly forecast data for 12 months.

    Each month is assessed independently based on its ten god relationship
    to the day master, with branch interaction modifiers (伏吟/六合/六沖).
    """
    results = []

    # Solar term month names
    MONTH_NAMES = [
        '寅月 (立春)', '卯月 (驚蟄)', '辰月 (清明)', '巳月 (立夏)',
        '午月 (芒種)', '未月 (小暑)', '申月 (立秋)', '酉月 (白露)',
        '戌月 (寒露)', '亥月 (立冬)', '子月 (大雪)', '丑月 (小寒)',
    ]

    MONTH_LABEL_MAP = {
        'auspicious': '吉',
        'neutral': '平',
        'inauspicious': '凶',
    }

    day_branch = pillars['day']['branch']

    for i, ms in enumerate(monthly_stars):
        month_stem = ms['stem']
        month_branch = ms['branch']
        month_ten_god = derive_ten_god(day_master_stem, month_stem)

        # Monthly auspiciousness — INDEPENDENT assessment
        month_element = STEM_ELEMENT.get(month_stem, '')
        month_raw = _assess_element_auspiciousness(month_element, effective_gods)

        # Map to user-friendly label independently
        combined = MONTH_LABEL_MAP.get(month_raw, '平')

        # Boost/downgrade based on branch interactions (伏吟/六合/六沖)
        month_branch_interactions = []

        # Priority: 伏吟 > 六合 > 六沖 (mutually exclusive for label modification)
        if month_branch == day_branch:
            # 伏吟: month branch == day branch (doubling energy)
            month_branch_interactions.append({
                'type': '伏吟',
                'description': f'月支{month_branch}與日支{day_branch}伏吟',
                'effect': '吉則加吉、凶則加凶' if month_raw == 'auspicious' else '反覆不安、壓力倍增',
            })
            # Intensify: 吉→大吉, 凶→大凶
            if combined == '吉':
                combined = '大吉'
            elif combined == '凶':
                combined = '大凶'
        elif BRANCH_LIUHE.get(month_branch) == day_branch:
            # 六合: month branch has 六合 with day branch (cooperation energy)
            month_branch_interactions.append({
                'type': '六合',
                'description': f'月支{month_branch}合日支{day_branch}',
                'effect': '貴人相助、人際和諧',
            })
            # Positive boost: 平→吉, 凶→凶中有吉
            if combined == '平':
                combined = '吉'
            elif combined == '凶':
                combined = '凶中有吉'
        elif LIUCHONG_PAIRS.get(month_branch) == day_branch:
            # 六沖: month branch clashes with day branch (conflict energy)
            month_branch_interactions.append({
                'type': '六沖',
                'description': f'月支{month_branch}沖日支{day_branch}',
                'effect': '變動劇烈、衝突風險',
            })
            # Negative impact: 平→小凶, 吉→吉中有凶
            if combined == '平':
                combined = '小凶'
            elif combined == '吉':
                combined = '吉中有凶'
            elif combined == '大吉':
                combined = '吉'

        # Seasonal energy context
        season_element = BRANCH_ELEMENT.get(month_branch, '土')

        results.append({
            'month': ms.get('month', i + 1),
            'monthName': MONTH_NAMES[i] if i < len(MONTH_NAMES) else f'{month_branch}月',
            'stem': month_stem,
            'branch': month_branch,
            'tenGod': month_ten_god,
            'auspiciousness': combined,
            'seasonElement': season_element,
            'solarTermDate': ms.get('solarTermDate', ''),
            'solarTermEndDate': ms.get('solarTermEndDate', ''),
            'annualContext': annual_auspiciousness,
            'branchInteractions': month_branch_interactions,
        })

    return results


# ============================================================
# 10. Five Qi States (旺相休囚死)
# ============================================================

def compute_five_qi_states(month_branch: str) -> Dict[str, str]:
    """
    Direct lookup of 旺相休囚死 per element based on birth month.
    Reuses existing get_seasonal_state_labels().
    """
    return get_seasonal_state_labels(month_branch)


# ============================================================
# Master Orchestrator
# ============================================================

def generate_career_pre_analysis(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    five_elements_balance: Dict[str, float],
    effective_gods: Dict[str, str],
    prominent_god: str,
    strength_v2: Dict,
    cong_ge: Optional[Dict],
    luck_periods: List[Dict],
    annual_stars: List[Dict],
    monthly_stars: List[Dict],
    kong_wang: List[str],
    branch_relationships: Optional[Dict] = None,
    tai_yuan: Optional[Dict] = None,
    ming_gong: Optional[Dict] = None,
    shen_gong: Optional[Dict] = None,
    birth_year: int = 0,
    current_year: int = 2026,
) -> Dict[str, Any]:
    """
    Generate all career pre-analysis data.

    Master orchestrator that calls all 10 career-specific functions
    and assembles the complete pre-analysis dict.

    Returns:
        Dict with all career pre-analysis data + deterministic section
    """
    # Normalize effective_gods format (engine returns {role_en: element},
    # but all internal functions expect {element: role_zh})
    effective_gods = _normalize_effective_gods(effective_gods)

    month_branch = pillars['month']['branch']

    # Get branch relationships if not provided
    if branch_relationships is None:
        branch_relationships = analyze_branch_relationships(pillars)

    # Get all shen sha
    all_shen_sha = get_all_shen_sha(pillars)

    # Ten god distribution (simple count)
    from .ten_gods import get_ten_god_distribution
    ten_god_dist = get_ten_god_distribution(pillars, day_master_stem)

    # Build extra pillars list
    extra_pillars = [p for p in (tai_yuan, ming_gong, shen_gong) if p is not None]

    # 1. Weighted Five Elements
    weighted_elements = calculate_weighted_five_elements(
        pillars, month_branch, extra_pillars=extra_pillars,
        branch_interactions=branch_relationships,
    )

    # 2. Weighted Ten Gods
    weighted_ten_gods = calculate_weighted_ten_gods(
        day_master_stem, pillars, month_branch,
        branch_interactions=branch_relationships,
    )

    # 3. Reputation Score
    reputation = compute_reputation_score(
        pillars, day_master_stem, prominent_god, effective_gods,
        month_branch, cong_ge, branch_relationships,
    )

    # 4. Wealth Score
    wealth = compute_wealth_score(
        pillars, day_master_stem, effective_gods, month_branch,
        cong_ge, strength_v2, luck_periods, current_year,
        ten_god_dist=ten_god_dist,
    )

    # 5. Suitable Positions
    positions = compute_suitable_positions(
        pillars, day_master_stem, prominent_god, cong_ge,
    )

    # 6. Company Type Fit
    company_fit = compute_company_type_fit(
        pillars, day_master_stem, prominent_god,
    )

    # 7. Entrepreneurship Fit
    entrepreneurship = compute_entrepreneurship_fit(
        pillars, day_master_stem, strength_v2, cong_ge,
        ten_god_dist, all_shen_sha,
    )

    # 8. Partnership Fit
    partnership = compute_partnership_fit(
        pillars, day_master_stem, ten_god_dist, branch_relationships,
        effective_gods=effective_gods,
    )

    # 9. Career Allies & Enemies
    allies_enemies = compute_career_allies_enemies(
        pillars, day_master_stem, effective_gods, all_shen_sha,
    )

    # 10. Five Qi States
    five_qi = compute_five_qi_states(month_branch)

    # 11. Annual Forecast Data (5 years)
    annual_forecast = compute_annual_forecast_data(
        pillars, day_master_stem, effective_gods,
        luck_periods, annual_stars, kong_wang,
        all_shen_sha, current_year,
    )

    # 12. Monthly Forecast Data (first year)
    first_year_auspiciousness = annual_forecast[0]['auspiciousness'] if annual_forecast else '平'
    monthly_forecast = compute_monthly_forecast_data(
        pillars, day_master_stem, effective_gods, monthly_stars,
        first_year_auspiciousness,
    )

    # Favorable/unfavorable industries from five elements
    dm_element = STEM_ELEMENT[day_master_stem]
    favorable_elements = [e for e, role in effective_gods.items()
                          if role in ('用神', '喜神')]
    unfavorable_elements = [e for e, role in effective_gods.items()
                            if role in ('忌神', '仇神')]

    favorable_industries = []
    unfavorable_industries = []
    for elem in favorable_elements:
        for cat in ELEMENT_INDUSTRIES_DETAILED.get(elem, []):
            favorable_industries.append({
                'element': elem,
                'anchor': cat['anchor'],
                'category': cat['category'],
                'industries': cat['industries'],
            })
    for elem in unfavorable_elements:
        for cat in ELEMENT_INDUSTRIES_DETAILED.get(elem, []):
            unfavorable_industries.append({
                'element': elem,
                'anchor': cat['anchor'],
                'category': cat['category'],
                'industries': cat['industries'],
            })

    # Find active luck period for display
    active_lp = _find_active_luck_period(luck_periods, current_year)

    return {
        'weightedElements': weighted_elements,
        'weightedTenGods': weighted_ten_gods,
        'reputationScore': reputation,
        'wealthScore': wealth,
        'suitablePositions': positions,
        'companyTypeFit': company_fit,
        'entrepreneurshipFit': entrepreneurship,
        'partnershipFit': partnership,
        'careerAllies': allies_enemies,
        'fiveQiStates': five_qi,
        'annualForecasts': annual_forecast,
        'monthlyForecasts': monthly_forecast,
        'favorableIndustries': favorable_industries,
        'unfavorableIndustries': unfavorable_industries,
        'pattern': prominent_god,
        'patternType': 'following' if cong_ge else 'standard',
        'activeLuckPeriod': {
            'stem': active_lp.get('stem', '') if active_lp else '',
            'branch': active_lp.get('branch', '') if active_lp else '',
            'tenGod': derive_ten_god(day_master_stem, active_lp['stem']) if active_lp else '',
            'startYear': active_lp.get('startYear', 0) if active_lp else 0,
            'endYear': active_lp.get('endYear', 0) if active_lp else 0,
        },
        # Deterministic section for frontend rendering
        'deterministic': {
            'weighted_elements': weighted_elements,
            'weighted_ten_gods': weighted_ten_gods,
            'reputation_score': {
                'score': reputation['score'],
                'level': reputation.get('level', ''),
                'sub_scores': reputation.get('subScores', {}),
            },
            'wealth_score': {
                'score': wealth['score'],
                'tier': wealth.get('tier', ''),
                'sub_scores': wealth.get('subScores', {}),
            },
            'five_qi_states': five_qi,
            'pattern': prominent_god,
            'pattern_type': 'following' if cong_ge else 'standard',
            'active_luck_period': {
                'stem': active_lp.get('stem', '') if active_lp else '',
                'branch': active_lp.get('branch', '') if active_lp else '',
                'ten_god': derive_ten_god(day_master_stem, active_lp['stem']) if active_lp else '',
                'start_year': active_lp.get('startYear', 0) if active_lp else 0,
                'end_year': active_lp.get('endYear', 0) if active_lp else 0,
            },
            # R6: Fields needed by frontend components (verdict badges, annual/monthly)
            'suitable_positions': positions,
            'company_type_fit': company_fit,
            'entrepreneurship_fit': entrepreneurship,
            'partnership_fit': partnership,
            'career_allies': allies_enemies,
            'annual_forecasts': annual_forecast,
            'monthly_forecasts': monthly_forecast,
        },
    }


# ============================================================
# Private Helper Functions
# ============================================================

def _get_all_stems(pillars: Dict) -> List[str]:
    """Get all manifest stems from pillars."""
    return [pillars[p]['stem'] for p in ('year', 'month', 'day', 'hour')]


def _get_all_hidden_stems(pillars: Dict) -> List[str]:
    """Get all hidden stems from all branches."""
    result = []
    for pname in ('year', 'month', 'day', 'hour'):
        result.extend(HIDDEN_STEMS.get(pillars[pname]['branch'], []))
    return result


def _branches_of_element(element: str) -> Set[str]:
    """Get all branches whose main element matches."""
    return {b for b, e in BRANCH_ELEMENT.items() if e == element}


def _ten_god_to_element(day_master_stem: str, ten_god: str) -> Optional[str]:
    """Get the element of a ten god relative to day master."""
    dm_element = STEM_ELEMENT[day_master_stem]
    god_element_map = {
        '比肩': dm_element, '劫財': dm_element,
        '食神': ELEMENT_PRODUCES[dm_element],
        '傷官': ELEMENT_PRODUCES[dm_element],
        '正財': ELEMENT_OVERCOMES[dm_element],
        '偏財': ELEMENT_OVERCOMES[dm_element],
        '正官': ELEMENT_OVERCOME_BY[dm_element],
        '偏官': ELEMENT_OVERCOME_BY[dm_element],
        '正印': ELEMENT_PRODUCED_BY[dm_element],
        '偏印': ELEMENT_PRODUCED_BY[dm_element],
    }
    return god_element_map.get(ten_god)


def _score_to_level(score: int) -> str:
    """Convert 0-100 score to qualitative level."""
    if score >= 85:
        return '上上格'
    elif score >= 70:
        return '上格'
    elif score >= 50:
        return '中格'
    elif score >= 30:
        return '下格'
    return '下下格'


def _compute_pattern_purity(
    pillars: Dict,
    day_master_stem: str,
    prominent_god: str,
    effective_gods: Dict[str, str],
    all_stems: List[str],
    all_hidden: Optional[List[str]] = None,
    branch_relationships: Optional[Dict] = None,
) -> float:
    """
    Compute 格局清純度 sub-score (0-100).
    A6: Expanded from 3 conditions to full plan spec.
    Based on 《子平真詮》清濁 framework.
    """
    score = 50.0  # Start at midpoint
    dm_element = STEM_ELEMENT[day_master_stem]

    if all_hidden is None:
        all_hidden = _get_all_hidden_stems(pillars)

    # Identify key elements
    useful_element = None
    xi_element = None  # 喜神
    taboo_element = None  # 忌神
    idle_element = None  # 閒神
    for e, role in effective_gods.items():
        if role == '用神':
            useful_element = e
        elif role == '喜神':
            xi_element = e
        elif role == '忌神':
            taboo_element = e
        elif role == '閒神':
            idle_element = e

    # === PURITY CONDITIONS (bonus points) ===

    # 用神有根且透干 (+25)
    if useful_element:
        useful_in_stems = any(STEM_ELEMENT.get(s) == useful_element for s in all_stems)
        useful_in_hidden = any(STEM_ELEMENT.get(h) == useful_element for h in all_hidden)
        if useful_in_stems and useful_in_hidden:
            score += 25  # Both transparent and rooted
        elif useful_in_stems:
            score += 15  # Transparent but not rooted
    else:
        score -= 10

    # 忌神受制化 (+20)
    if taboo_element:
        controller = ELEMENT_OVERCOMES.get(taboo_element)
        if controller and any(STEM_ELEMENT.get(s) == controller for s in all_stems):
            score += 20

    # 喜神得生助 (+20): 喜神 element produced by another element present in chart
    if xi_element:
        producer = ELEMENT_PRODUCED_BY.get(xi_element)
        if producer and any(STEM_ELEMENT.get(s) == producer for s in all_stems + all_hidden):
            score += 20

    # 閒神不克用神 (+15): idle god element doesn't overcome useful god
    if idle_element and useful_element:
        idle_overcomes = ELEMENT_OVERCOMES.get(idle_element)
        if idle_overcomes != useful_element:
            score += 15
        elif not any(STEM_ELEMENT.get(s) == idle_element for s in all_stems):
            # Idle element overcomes useful but not manifest → less harmful
            score += 10

    # === TURBIDITY PENALTIES (deductions) ===

    # Build manifest gods for penalty checks
    manifest_gods = set()
    for pname in ('year', 'month', 'hour'):
        god = derive_ten_god(day_master_stem, pillars[pname]['stem'])
        manifest_gods.add(god)

    # 官殺混雜 (-20)
    if '正官' in manifest_gods and '偏官' in manifest_gods:
        score -= 20

    # 用神失勢忌神當權 (-30): useful not in stems AND taboo is prominent
    if useful_element and taboo_element:
        useful_absent = not any(STEM_ELEMENT.get(s) == useful_element for s in all_stems)
        taboo_prominent = any(STEM_ELEMENT.get(s) == taboo_element for s in all_stems)
        if useful_absent and taboo_prominent:
            score -= 30

    # 提綱破損 (-25): 月支 is 六沖'd by another branch
    if branch_relationships:
        clashes = branch_relationships.get('clashes', [])
        month_branch_clashed = any(
            'month' in (c.get('pillarA', ''), c.get('pillarB', ''))
            for c in clashes
        )
        if month_branch_clashed:
            score -= 25

    # 命局過寒或過燥 (-15): Chart dominated by Fire/Water with no balancing element
    all_chart_elements = [STEM_ELEMENT.get(s) for s in all_stems + all_hidden if STEM_ELEMENT.get(s)]
    fire_count = sum(1 for e in all_chart_elements if e == '火')
    water_count = sum(1 for e in all_chart_elements if e == '水')
    total_chart = len(all_chart_elements) if all_chart_elements else 1
    if fire_count >= total_chart * 0.5 and not any(STEM_ELEMENT.get(s) == '水' for s in all_stems):
        score -= 15  # 過燥
    elif water_count >= total_chart * 0.5 and not any(STEM_ELEMENT.get(s) == '火' for s in all_stems):
        score -= 15  # 過寒

    # 喜神遭克 (-20): 喜神 element overcome by a prominent (manifest) element
    if xi_element:
        xi_controller = ELEMENT_OVERCOME_BY.get(xi_element)
        if xi_controller and any(STEM_ELEMENT.get(s) == xi_controller for s in all_stems):
            score -= 20

    # 用神受克 (-25): 用神 element directly overcome by a manifest stem
    if useful_element:
        useful_controller = ELEMENT_OVERCOME_BY.get(useful_element)
        if useful_controller and any(STEM_ELEMENT.get(s) == useful_controller for s in all_stems):
            score -= 25

    # === 正官格 SPECIFIC TABOOS (each -10) ===
    if prominent_god == '正官':
        # 傷官克官 (-10): 傷官 present in manifest gods
        if '傷官' in manifest_gods:
            score -= 10

        # 食神合官 (-10): Check if any 食神 stem has a 天干五合 pair that is a 官 stem
        officer_element = ELEMENT_OVERCOME_BY[dm_element]
        for pname in ('year', 'month', 'hour'):
            stem = pillars[pname]['stem']
            god = derive_ten_god(day_master_stem, stem)
            if god == '食神':
                combo_partner = STEM_COMBINATIONS.get(stem)
                if combo_partner and STEM_ELEMENT.get(combo_partner) == officer_element:
                    score -= 10
                    break

    return max(0, min(100, score))


def _compute_officer_strength(
    pillars: Dict,
    day_master_stem: str,
    month_branch: str,
    all_stems: List[str],
    all_hidden: List[str],
) -> float:
    """Compute 官星力量 sub-score (0-100)."""
    score = 0.0
    dm_element = STEM_ELEMENT[day_master_stem]
    officer_element = ELEMENT_OVERCOME_BY[dm_element]

    # Check if 官/殺 present in chart
    officer_stems = [s for s in all_stems if STEM_ELEMENT.get(s) == officer_element]
    officer_hidden = [h for h in all_hidden if STEM_ELEMENT.get(h) == officer_element]

    if officer_stems:
        score += 30  # Base for being present
    if officer_hidden:
        score += 25  # Rooted in branches

    # Seasonal strength
    season_score = SEASON_STRENGTH.get(officer_element, {}).get(month_branch, 3)
    if season_score >= 4:
        score += 20
    elif season_score == 3:
        score += 10

    # Position bonus (A15: additive, not elif; includes 時干)
    if STEM_ELEMENT.get(pillars['month']['stem']) == officer_element:
        score += 15  # 月干
    if STEM_ELEMENT.get(pillars['year']['stem']) == officer_element:
        score += 10  # 年干
    if STEM_ELEMENT.get(pillars['hour']['stem']) == officer_element:
        score += 10  # 時干

    # 官印相生 chain
    seal_element = ELEMENT_PRODUCED_BY[dm_element]
    seal_present = any(STEM_ELEMENT.get(s) == seal_element for s in all_stems + all_hidden)
    if officer_stems and seal_present:
        score += 15

    # A10: 官殺混雜 clash deduction (-20 unless resolved)
    has_zhengguan = any(derive_ten_god(day_master_stem, s) == '正官' for s in officer_stems)
    has_qisha = any(derive_ten_god(day_master_stem, s) in ('偏官', '七殺') for s in officer_stems)
    if has_zhengguan and has_qisha:
        score -= 20

    return min(100, score)


def _compute_useful_god_strength(
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict[str, str],
    month_branch: str,
) -> float:
    """Compute 用神力量 sub-score (0-100)."""
    score = 0.0
    useful_element = None
    for e, role in effective_gods.items():
        if role == '用神':
            useful_element = e
            break

    if not useful_element:
        return 30.0  # No clear 用神 → neutral

    all_stems = _get_all_stems(pillars)
    all_hidden = _get_all_hidden_stems(pillars)

    # Present in stems
    if any(STEM_ELEMENT.get(s) == useful_element for s in all_stems):
        score += 30
    # Rooted in hidden
    if any(STEM_ELEMENT.get(h) == useful_element for h in all_hidden):
        score += 25
    # Seasonal strength
    season_score = SEASON_STRENGTH.get(useful_element, {}).get(month_branch, 3)
    if season_score >= 4:
        score += 25
    elif season_score == 3:
        score += 15
    elif season_score == 2:
        score += 5
    # (A4 fix: removed duplicate "exposed in stems" check that was identical to
    # "present in stems" above, which double-counted +20)

    return min(100, score)


def _compute_seal_support(
    pillars: Dict,
    day_master_stem: str,
    month_branch: str,
    all_stems: List[str],
    all_hidden: List[str],
) -> float:
    """Compute 印星輔助 sub-score (0-100)."""
    score = 0.0
    dm_element = STEM_ELEMENT[day_master_stem]
    seal_element = ELEMENT_PRODUCED_BY[dm_element]

    seal_stems = [s for s in all_stems if STEM_ELEMENT.get(s) == seal_element]
    seal_hidden = [h for h in all_hidden if STEM_ELEMENT.get(h) == seal_element]

    if seal_stems or seal_hidden:
        score += 30  # Present
    if seal_stems and seal_hidden:
        score += 30  # Both transparent and rooted

    # 官印相生 chain
    officer_element = ELEMENT_OVERCOME_BY[dm_element]
    officer_present = any(STEM_ELEMENT.get(s) == officer_element for s in all_stems + all_hidden)
    if officer_present and (seal_stems or seal_hidden):
        score += 20

    # Not clashed
    score += 20  # Default — reduce if clashed (simplified)

    return min(100, score)


def _compute_clash_deduction(branch_relationships: Dict) -> float:
    """Compute 刑沖扣分 (0-30 deduction)."""
    deduction = 0.0

    # 六沖 on 月支
    for clash in branch_relationships.get('clashes', []):
        if 'month' in (clash.get('pillarA', ''), clash.get('pillarB', '')):
            deduction += 15
        else:
            deduction += 5

    # 三刑
    for punishment in branch_relationships.get('punishments', []):
        deduction += 10

    # 六害
    for harm in branch_relationships.get('harms', []):
        deduction += 5

    return min(30, deduction)


def _compute_treasury_score(
    pillars: Dict,
    dm_element: str,
    wealth_element: str,
    effective_gods: Dict[str, str],
    strength_v2: Dict,
) -> float:
    """Compute 財庫 sub-score (0-100)."""
    # Treasury branches: 辰(水庫), 未(木庫), 戌(火庫), 丑(金庫)
    treasury_map = {'水': '辰', '木': '未', '火': '戌', '金': '丑', '土': '戌'}
    treasury_branch = treasury_map.get(wealth_element)

    if not treasury_branch:
        return 0.0

    # Check if treasury branch is in chart
    chart_branches = [pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')]
    if treasury_branch not in chart_branches:
        return 0.0

    score = 40.0  # Treasury present

    # Check if treasury is clashed (逢沖)
    clash_partner = LIUCHONG_PAIRS.get(treasury_branch)
    treasury_clashed = clash_partner in chart_branches if clash_partner else False

    is_strong = strength_v2.get('category') in ('strong', 'very_strong')
    wealth_favorable = effective_gods.get(wealth_element) in ('用神', '喜神')

    if treasury_clashed:
        if is_strong and wealth_favorable:
            score += 40  # 逢沖開庫 — "有財有庫不沖不發"
        else:
            score -= 20  # 逢沖破庫
    else:
        score += 20  # 潛在財庫 (latent)

    return max(0, min(100, score))


def _compute_luck_period_wealth_support(
    luck_periods: List[Dict],
    wealth_element: str,
    effective_gods: Dict[str, str],
    current_year: int,
) -> float:
    """Compute 大運配合 sub-score for wealth (0-100)."""
    score = 0.0

    current_lp = _find_active_luck_period(luck_periods, current_year)
    if not current_lp:
        return 30.0  # Neutral if no luck period found

    lp_element = STEM_ELEMENT.get(current_lp['stem'], '')
    lp_branch_element = BRANCH_ELEMENT.get(current_lp['branch'], '')

    # Current 大運 supports wealth element
    if lp_element == wealth_element or lp_branch_element == wealth_element:
        score += 40

    # Current 大運 is 用神 period
    if effective_gods.get(lp_element) == '用神':
        score += 25
    elif effective_gods.get(lp_element) == '喜神':
        score += 15

    # Check next 大運
    next_lp = None
    for lp in luck_periods:
        if lp.get('startYear', 0) > current_lp.get('endYear', 0):
            next_lp = lp
            break
    if next_lp:
        next_element = STEM_ELEMENT.get(next_lp['stem'], '')
        if next_element == wealth_element:
            score += 20

    # 走財地
    if lp_element == wealth_element:
        score += 15

    return min(100, score)


def _find_active_luck_period(luck_periods: List[Dict], year: int) -> Optional[Dict]:
    """Find the luck period active for a given year."""
    for lp in luck_periods:
        start = lp.get('startYear', 0)
        end = lp.get('endYear', 0)
        if start <= year <= end:
            return lp
    # Fallback to first or last
    if luck_periods:
        if year < luck_periods[0].get('startYear', 0):
            return luck_periods[0]
        return luck_periods[-1]
    return None


def _find_treasury_branches(pillars: Dict, wealth_element: str) -> List[str]:
    """Find treasury branches for the wealth element in the chart."""
    treasury_map = {'水': '辰', '木': '未', '火': '戌', '金': '丑', '土': '戌'}
    treasury_branch = treasury_map.get(wealth_element)
    if not treasury_branch:
        return []
    chart_branches = [pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')]
    return [b for b in chart_branches if b == treasury_branch]


def _detect_position_combinations(
    manifest_gods: Set[str],
    prominent_god: str,
) -> List[Dict]:
    """Detect special ten god combinations that enhance position recommendations.

    Returns list of ALL matching combos (not just first).
    """
    combos = [
        ({'正官', '正印'}, '官印相生', ['學術型領導', '教育管理', '研究主管']),
        ({'食神', '正財'}, '食神生財', ['創意商業', '餐飲經營', '品牌開發']),
        ({'傷官', '偏財'}, '傷官生財', ['商業顧問', '投資分析', '技術銷售']),
        ({'偏官', '正印'}, '殺印相生', ['軍事領導', '法律執行', '高層管理']),
        ({'傷官', '正印'}, '傷官配印', ['技術顧問', '專業教練', '創意總監', '出版策劃']),
        ({'食神', '偏官'}, '食神制殺', ['紀律型管理', '體育教練', '安全管理', '品質控管']),
        ({'正財', '正官'}, '財官相生', ['企業財務主管', '政府採購', '穩定型管理職']),
    ]

    all_gods = manifest_gods | {prominent_god}
    matched = []
    for gods, name, positions in combos:
        if gods.issubset(all_gods):
            matched.append({'name': name, 'positions': positions})
    return matched


def _assess_element_auspiciousness(
    element: str,
    effective_gods: Dict[str, str],
) -> str:
    """Assess auspiciousness of an element based on its god role."""
    role = effective_gods.get(element, '閒神')
    role_map = {
        '用神': 'auspicious',
        '喜神': 'auspicious',
        '閒神': 'neutral',
        '忌神': 'inauspicious',
        '仇神': 'inauspicious',
    }
    return role_map.get(role, 'neutral')


def _combine_auspiciousness(
    lp: str,
    year: str,
    lp_element: str = '',
    year_element: str = '',
    effective_gods: Optional[Dict[str, str]] = None,
) -> str:
    """DEPRECATED by R6-2 — kept for historical reference and existing tests.

    Combine luck period and annual auspiciousness into nuanced matrix.
    Classical: "流年為君，大運為臣" — 大運 sets backdrop, 流年 triggers events.
    Now replaced by YEAR_ROLE_TO_AUSPICIOUSNESS (流年-only 5-level mapping).
    """
    if lp == 'auspicious' and year == 'auspicious':
        return '大吉'
    elif lp == 'auspicious' and year == 'inauspicious':
        return '吉中有凶'
    elif lp == 'auspicious':
        return '吉'
    elif lp == 'inauspicious' and year == 'auspicious':
        # Distinguish within 凶中有吉 —
        # If year element is 用神 (strongest favorable), the silver lining is stronger
        # If year element is only 喜神 (secondary favorable), it's a weaker silver lining
        if effective_gods and year_element:
            year_role = effective_gods.get(year_element, '閒神')
            if year_role == '用神':
                return '凶中有吉'  # Strongest favorable element — real opportunity
            else:
                return '凶中帶機'  # 喜神 only — minor opportunity
        return '凶中有吉'
    elif lp == 'inauspicious' and year == 'inauspicious':
        return '大凶'
    elif lp == 'inauspicious':
        # lp is bad, year is neutral
        # Check if lp is 忌神 (worst) vs 仇神 (bad but less so)
        if effective_gods and lp_element:
            lp_role = effective_gods.get(lp_element, '閒神')
            if lp_role == '忌神':
                return '凶'  # Worst unfavorable element
            else:
                return '小凶'  # 仇神 = bad but not worst
        return '凶'
    else:
        if year == 'auspicious':
            return '吉'
        elif year == 'inauspicious':
            return '凶'
        return '平'


def _combine_monthly_auspiciousness(month: str, annual: str) -> str:  # DEPRECATED by R4-5
    """Combine monthly with annual auspiciousness (subordinate).

    Classical: "流月包含于流年之中" — monthly luck subordinate to yearly.
    吉中有凶 grouped with neutral (平), not favorable — if year has 有凶,
    a good month is at best 吉, not 大吉.
    """
    if month == 'auspicious' and annual in ('大吉', '吉'):
        return '大吉'
    elif month == 'auspicious' and annual in ('吉中有凶', '平'):
        return '吉'  # Good month in ambiguous year = decent but not great
    elif month == 'auspicious' and annual in ('凶', '凶中有吉', '大凶'):
        return '曇花一現'  # Fleeting good
    elif month == 'inauspicious' and annual in ('大吉', '吉', '吉中有凶'):
        return '凶中有吉'  # Manageable setback in good year
    elif month == 'inauspicious' and annual in ('凶', '大凶', '凶中有吉'):
        return '凶上加凶'
    return '平'


def _analyze_kong_wang_for_year(
    year_branch: str,
    kong_wang: List[str],
    effective_gods: Dict[str, str],
) -> Dict[str, Any]:
    """Analyze 空亡 effect for a specific year."""
    if year_branch not in kong_wang:
        return {'hit': False, 'effect': None, 'favorable': None}

    # Determine if the year branch's element is 用神 or 忌神
    branch_element = BRANCH_ELEMENT.get(year_branch, '')
    role = effective_gods.get(branch_element, '閒神')

    if role in ('忌神', '仇神'):
        return {'hit': True, 'effect': '忌神逢空', 'favorable': True}
    elif role in ('用神', '喜神'):
        return {'hit': True, 'effect': '用神逢空', 'favorable': False}
    return {'hit': True, 'effect': '閒神逢空', 'favorable': None}


def _analyze_yima_for_year(
    year_branch: str,
    yima_branch: Optional[str],
    effective_gods: Dict[str, str],
) -> Dict[str, Any]:
    """Analyze 驛馬 effect for a specific year."""
    if not yima_branch or year_branch != yima_branch:
        return {'hit': False, 'favorable': None, 'type': None}

    branch_element = BRANCH_ELEMENT.get(yima_branch, '')
    role = effective_gods.get(branch_element, '閒神')

    if role in ('用神', '喜神'):
        return {
            'hit': True,
            'favorable': True,
            'type': '主動型變動（升遷/外派/國際機會）',
        }
    elif role in ('忌神', '仇神'):
        return {
            'hit': True,
            'favorable': False,
            'type': '被動型變動（調職/不穩定）',
        }
    return {'hit': True, 'favorable': None, 'type': '變動年（中性）'}


def _detect_career_indicators(
    year_ten_god: str,
    lp_ten_god: str,
    day_master_stem: str,
    year_stem: str,
    year_branch: str,
    pillars: Dict,
    effective_gods: Dict[str, str],
) -> List[Dict[str, str]]:
    """Detect career-specific timing indicators for a year."""
    indicators = []

    year_element = STEM_ELEMENT.get(year_stem, '')
    year_role = effective_gods.get(year_element, '閒神')

    # 流年正官 as 喜用 → promotion year
    if year_ten_god == '正官' and year_role in ('用神', '喜神'):
        indicators.append({
            'type': 'promotion',
            'label': '正官喜用年',
            'description': '升遷加薪之年',
        })

    # 流年正印 as 喜用 → support year
    if year_ten_god == '正印' and year_role in ('用神', '喜神'):
        indicators.append({
            'type': 'support',
            'label': '正印喜用年',
            'description': '貴人相助、事業穩健之年',
        })

    # 傷官見官 → trouble year
    manifest_gods = {derive_ten_god(day_master_stem, pillars[p]['stem'])
                     for p in ('year', 'month', 'hour')}
    if year_ten_god == '傷官' and '正官' in manifest_gods:
        indicators.append({
            'type': 'danger',
            'label': '傷官見官',
            'description': '為禍百端——官場風波、降職風險',
        })
    if year_ten_god == '正官' and '傷官' in manifest_gods:
        indicators.append({
            'type': 'danger',
            'label': '傷官見官',
            'description': '為禍百端——官場風波、降職風險',
        })

    # 官殺混雜
    if year_ten_god in ('正官', '偏官'):
        other = '偏官' if year_ten_god == '正官' else '正官'
        if other in manifest_gods:
            indicators.append({
                'type': 'instability',
                'label': '官殺混雜',
                'description': '權威混亂、事業動盪',
            })

    # 食神生財 activated
    if year_ten_god in ('食神', '傷官'):
        wealth_element = ELEMENT_OVERCOMES[STEM_ELEMENT[day_master_stem]]
        if year_role in ('用神', '喜神') or effective_gods.get(wealth_element) in ('用神', '喜神'):
            indicators.append({
                'type': 'wealth',
                'label': '食傷生財年',
                'description': '創意帶來財富',
            })

    # 偏財 as 喜用 → entrepreneurial opportunity
    if year_ten_god == '偏財' and year_role in ('用神', '喜神'):
        indicators.append({
            'type': 'opportunity',
            'label': '偏財喜用年',
            'description': '投資/創業/意外財運之年',
        })

    # 比劫奪財
    if year_ten_god in ('比肩', '劫財') and year_role in ('忌神', '仇神'):
        indicators.append({
            'type': 'financial_loss',
            'label': '比劫奪財',
            'description': '財務糾紛、競爭損失',
        })

    return indicators
