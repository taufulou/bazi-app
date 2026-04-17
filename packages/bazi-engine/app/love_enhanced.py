"""
Love & Marriage Pre-Analysis Module (八字愛情姻緣)

All deterministic love/marriage-specific calculations. No AI involved.
Love-specific equivalent of career_enhanced.py.

Contains 11 pre-analysis functions + narrative anchors + master orchestrator:
1. classify_peach_blossoms — 桃花分類 (12 sub-types)
2. compute_spouse_star_analysis — 配偶星分析
3. compute_marriage_palace_analysis — 婚姻宮分析
4. compute_love_personality — 戀愛性格分析
5. compute_marriage_timing_indicators — 婚期指標
6. compute_romance_good_years — 桃花運好的年份
7. compute_romance_danger_years — 桃花劫年份
8. compute_marriage_change_years — 感情易變年份
9. compute_partner_recommendations — 婚配建議
10. compute_annual_love_forecast — 十年感情運勢
11. compute_monthly_love_forecast — 十二月感情運勢
"""

from typing import Any, Dict, List, Optional, Set, Tuple

from .constants import (
    BRANCH_ELEMENT,
    BRANCH_INDEX,
    BRANCH_LIUHE,
    CHANGSHENG_BRANCH,
    EARTHLY_BRANCHES,
    ELEMENT_OVERCOMES,
    ELEMENT_OVERCOME_BY,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    FIVE_ELEMENTS,
    HARM_LOOKUP,
    HEAVENLY_STEMS,
    HIDDEN_STEMS,
    HIDDEN_STEM_WEIGHTS,
    HONGYAN_SHA,
    HONGYAN_SELF_SITTING,
    HONGLUAN,
    JIUCHOU_DAYS,
    MUYU_TAOHUA,
    STEM_COMBINATIONS,
    STEM_ELEMENT,
    STEM_INDEX,
    STEM_YINYANG,
    TAOHUA,
    TIANXI,
    TIANYI_GUIREN,
    TWELVE_STAGES,
    YANGREN,
    ZODIAC,
)
from .branch_relationships import (
    CLASH_LOOKUP,
    HARMONY_LOOKUP,
    SELF_PUNISHMENT_BRANCHES,
    SIX_BREAKS,
    SIX_CLASHES,
    SIX_HARMS,
    THREE_PUNISHMENTS,
    TRIPLE_HARMONIES,
    check_sanxing_with_pool,
)
from .ten_gods import derive_ten_god
from .lifetime_enhanced import (
    compute_partner_zodiacs,
    compute_romance_years_enriched,
    compute_romance_warning_years,
    tag_romance_years_with_dayun,
    _find_luck_period_for_year,
)


# ============================================================
# Module-Level Constants
# ============================================================

# 喜用神配偶月份建議 — maps elements to favorable partner birth seasons
ELEMENT_SEASON_MAP = {
    '木': {'season': '春季', 'months': '農曆1-3月（寅卯辰月）', 'reason': '木旺於春'},
    '火': {'season': '夏季', 'months': '農曆4-6月（巳午未月）', 'reason': '火旺於夏'},
    '土': {'season': '四季月', 'months': '辰/未/戌/丑月（季末18天土旺）', 'reason': '土旺於四季末'},
    '金': {'season': '秋季', 'months': '農曆7-9月（申酉戌月）', 'reason': '金旺於秋'},
    '水': {'season': '冬季', 'months': '農曆10-12月（亥子丑月）', 'reason': '水旺於冬'},
}


# ============================================================
# Helper: Normalize effective gods format
# ============================================================

def _normalize_effective_gods(effective_gods: Dict[str, str]) -> Dict[str, str]:
    """
    Normalize effective_gods to internal format {element: role_zh}.
    Handles three input formats:
    1. English-keyed: {'usefulGod': '土', 'favorableGod': '火', 'tabooGod': '木', ...}
    2. Chinese-keyed (role→element): {'喜神': '火', '用神': '土', ...}
    3. Already normalized (element→role): {'火': '喜神', '土': '用神', ...}
    """
    ZH_ROLES = ('用神', '喜神', '忌神', '仇神', '閒神')
    ELEMENTS = ('木', '火', '土', '金', '水')
    ROLE_MAP_EN = {
        'usefulGod': '用神',
        'favorableGod': '喜神',
        'tabooGod': '忌神',
        'enemyGod': '仇神',
        'idleGod': '閒神',
    }

    # Format 3: Already {element: role_zh} — keys are elements, values are roles
    if any(v in ZH_ROLES for v in effective_gods.values()) and \
       any(k in ELEMENTS for k in effective_gods.keys()):
        return effective_gods

    # Format 2: Chinese-keyed {role_zh: element} — keys are roles, values are elements
    if any(k in ZH_ROLES for k in effective_gods.keys()) and \
       any(v in ELEMENTS for v in effective_gods.values()):
        return {element: role for role, element in effective_gods.items()
                if role in ZH_ROLES and element in ELEMENTS}

    # Format 1: English-keyed {role_en: element}
    result = {}
    for role_en, element in effective_gods.items():
        role_zh = ROLE_MAP_EN.get(role_en, '')
        if role_zh and element:
            result[element] = role_zh
    return result


# ============================================================
# Helper: Get twelve life stage at a branch
# ============================================================

def _get_twelve_stage(day_stem: str, branch: str) -> str:
    """Get the twelve life stage (十二長生) of day_stem at a given branch."""
    start_branch = CHANGSHENG_BRANCH.get(day_stem, '')
    if not start_branch:
        return ''
    start_idx = BRANCH_INDEX.get(start_branch, 0)
    target_idx = BRANCH_INDEX.get(branch, 0)

    is_yang = STEM_YINYANG.get(day_stem) == '陽'
    if is_yang:
        offset = (target_idx - start_idx) % 12
    else:
        offset = (start_idx - target_idx) % 12

    return TWELVE_STAGES[offset]


# ============================================================
# Helper: Find active luck period
# ============================================================

def _find_active_luck_period(luck_periods: List[Dict], current_year: int) -> Optional[Dict]:
    """Find the luck period covering current_year."""
    for lp in luck_periods:
        if lp.get('startYear', 0) <= current_year <= lp.get('endYear', 0):
            return lp
    return None


# ============================================================
# Helper: Enrich luck periods (add ten god info)
# ============================================================

def _enrich_luck_periods(
    luck_periods: List[Dict],
    day_master_stem: str,
    gender: str,
    effective_gods: Dict[str, str],
) -> List[Dict]:
    """Enrich luck periods with ten god and element role information."""
    enriched = []
    dm_element = STEM_ELEMENT[day_master_stem]

    for lp in luck_periods:
        lp_copy = dict(lp)
        stem = lp.get('stem', '')
        branch = lp.get('branch', '')

        if stem:
            lp_copy['tenGod'] = derive_ten_god(day_master_stem, stem)
            stem_element = STEM_ELEMENT.get(stem, '')
            lp_copy['stemElement'] = stem_element
            lp_copy['stemRole'] = effective_gods.get(stem_element, '閒神')

        if branch:
            hidden = HIDDEN_STEMS.get(branch, [])
            if hidden:
                lp_copy['branchMainTenGod'] = derive_ten_god(day_master_stem, hidden[0])
                branch_element = STEM_ELEMENT.get(hidden[0], '')
                lp_copy['branchMainElement'] = branch_element
                lp_copy['branchMainRole'] = effective_gods.get(branch_element, '閒神')

        enriched.append(lp_copy)
    return enriched


# ============================================================
# 1. Peach Blossom Classification (桃花分類)
# ============================================================

def classify_peach_blossoms(
    pillars: Dict,
    day_master_stem: str,
    day_branch: str,
    year_branch: str,
    effective_gods: Dict[str, str],
    gender: str,
) -> Dict[str, Any]:
    """
    Classify all peach blossom types in the natal chart.

    12 sub-types:
    正桃花 (5): 牆內桃花, 天喜桃花, 紅鸞桃花, 貴人桃花, 官星桃花
    爛桃花 (7): 牆外桃花, 沐浴桃花, 九丑桃花, 紅艷煞, 桃花劫, 桃花刃, (neutral沐浴)

    Returns dict with positive/negative lists and summary.
    """
    positive: List[Dict[str, Any]] = []
    negative: List[Dict[str, Any]] = []

    dm_element = STEM_ELEMENT[day_master_stem]
    taohua_branch_day = TAOHUA.get(day_branch, '')
    taohua_branch_year = TAOHUA.get(year_branch, '')
    hongluan_branch = HONGLUAN.get(year_branch, '')
    tianxi_branch = TIANXI.get(year_branch, '')
    hongyan_branch = HONGYAN_SHA.get(day_master_stem, '')
    muyu_branch = MUYU_TAOHUA.get(day_master_stem, '')
    yangren_branch = YANGREN.get(day_master_stem, '')

    # Spouse star ten god
    if gender == 'male':
        spouse_star_tg = '正財'
        romance_star_tg = '偏財'
    else:
        spouse_star_tg = '正官'
        romance_star_tg = '偏官'

    spouse_star_element = (
        ELEMENT_OVERCOMES[dm_element] if gender == 'male'
        else ELEMENT_OVERCOME_BY[dm_element]
    )

    # Check each pillar
    pillar_names = ['year', 'month', 'day', 'hour']
    for pname in pillar_names:
        pillar = pillars[pname]
        p_branch = pillar['branch']
        p_stem = pillar['stem']
        pillar_gz = p_stem + p_branch  # 干支 combo

        # --- 桃花 基本檢測 (by day branch or year branch) ---
        is_taohua = (p_branch == taohua_branch_day or p_branch == taohua_branch_year)

        if is_taohua:
            # Determine 牆內 vs 牆外 (View B — dominant mainstream: 闡微堂/百度百科/蘇民峰)
            # Year+Month = 牆內 (pre-marriage/family sphere, safe桃花)
            # Day+Hour = 牆外 (married life/external, extramarital risk)
            if pname in ('year', 'month'):
                # 牆內桃花 — Year+Month = 在家庭/婚前範疇，桃花內斂
                positive.append({
                    'type': '牆內桃花',
                    'pillar': pname,
                    'branch': p_branch,
                    'description': f'{pname}柱{p_branch}為桃花（牆內）',
                    'subNote': '桃花在年/月柱，屬婚前或家庭範疇，感情內斂穩定，婚戀觀較傳統',
                })
            else:
                # 牆外桃花 — Day+Hour = 在婚後/對外範疇，桃花外顯
                negative.append({
                    'type': '牆外桃花',
                    'pillar': pname,
                    'branch': p_branch,
                    'description': f'{pname}柱{p_branch}為桃花（牆外）',
                    'severity': 'mild',
                    'subNote': '桃花在日/時柱，婚後仍桃花旺盛，異性緣外顯，需注意感情誘惑',
                })

            # Check for 官星桃花 (hidden stem 本氣 = spouse star)
            hidden = HIDDEN_STEMS.get(p_branch, [])
            if hidden:
                benqi_tg = derive_ten_god(day_master_stem, hidden[0])
                if benqi_tg == spouse_star_tg:
                    positive.append({
                        'type': '官星桃花',
                        'pillar': pname,
                        'branch': p_branch,
                        'description': f'{pname}柱桃花藏{spouse_star_tg}（官星桃花）',
                        'subNote': '桃花帶正緣，感情對象條件好',
                    })

            # Check for 桃花刃 (peach blossom on blade)
            if p_branch == yangren_branch:
                negative.append({
                    'type': '桃花刃',
                    'pillar': pname,
                    'branch': p_branch,
                    'description': f'{pname}柱{p_branch}為桃花刃',
                    'severity': 'moderate',
                })

        # --- 紅鸞桃花 ---
        if p_branch == hongluan_branch:
            positive.append({
                'type': '紅鸞桃花',
                'pillar': pname,
                'branch': p_branch,
                'description': f'{pname}柱{p_branch}為紅鸞',
                'subNote': '正緣桃花，有利婚姻喜事',
            })

        # --- 天喜桃花 ---
        if p_branch == tianxi_branch:
            positive.append({
                'type': '天喜桃花',
                'pillar': pname,
                'branch': p_branch,
                'description': f'{pname}柱{p_branch}為天喜',
                'subNote': '喜慶之星，有利感情好事',
            })

        # --- 貴人桃花 ---
        guiren_branches = TIANYI_GUIREN.get(day_master_stem, [])
        if p_branch in guiren_branches and is_taohua:
            positive.append({
                'type': '貴人桃花',
                'pillar': pname,
                'branch': p_branch,
                'description': f'{pname}柱{p_branch}為天乙貴人+桃花',
                'subNote': '感情有貴人助力，對象身分好',
            })

        # --- 紅艷煞 ---
        if p_branch == hongyan_branch:
            is_self_sitting = (pname == 'day' and pillar_gz in HONGYAN_SELF_SITTING)
            negative.append({
                'type': '紅艷煞',
                'pillar': pname,
                'branch': p_branch,
                'description': (
                    f'{pname}柱{p_branch}為紅艷煞'
                    + ('（自坐紅艷）' if is_self_sitting else '')
                ),
                'severity': 'moderate' if is_self_sitting else 'mild',
                'selfSitting': is_self_sitting,
            })

        # --- 沐浴桃花 ---
        # POLICY: Always classify as 爛桃花 (mainstream classical view).
        # 沐浴 stage inherently implies indulgence/sensuality regardless of hidden stem.
        # Some texts (邵偉華《四柱預測學》) allow positive classification when hidden
        # stem is 正財/正官/正印/食神, but we adopt the mainstream interpretation.
        if p_branch == muyu_branch:
            negative.append({
                'type': '沐浴桃花',
                'pillar': pname,
                'branch': p_branch,
                'description': f'{pname}柱{p_branch}為沐浴桃花（爛桃花）',
                'severity': 'moderate',
                'subNote': '沐浴位為桃花沐浴之地，感情易流於放縱',
                'caveat': '部分流派認為沐浴位藏正星（如正財/正官）時可為正桃花，此處採主流解釋',
            })

        # --- 桃花劫 ---
        # Check both pillar stem AND hidden stems for 劫財
        if is_taohua:
            has_jiecai = False
            jiecai_source = ''

            # Check pillar stem
            stem_tg = derive_ten_god(day_master_stem, p_stem)
            if stem_tg == '劫財':
                has_jiecai = True
                jiecai_source = f'天干{p_stem}為劫財'

            # Check hidden stems
            hidden = HIDDEN_STEMS.get(p_branch, [])
            for hs in hidden:
                hs_tg = derive_ten_god(day_master_stem, hs)
                if hs_tg == '劫財':
                    has_jiecai = True
                    jiecai_source = jiecai_source or f'藏干{hs}為劫財'
                    break

            # For females, 七殺 on peach blossom = also 桃花劫
            if gender == 'female':
                if stem_tg == '偏官':
                    has_jiecai = True
                    jiecai_source = f'天干{p_stem}為七殺'
                else:
                    for hs in hidden:
                        hs_tg = derive_ten_god(day_master_stem, hs)
                        if hs_tg == '偏官':
                            has_jiecai = True
                            jiecai_source = jiecai_source or f'藏干{hs}為七殺'
                            break

            if has_jiecai:
                # Severity: check if 忌神
                p_branch_element = BRANCH_ELEMENT.get(p_branch, '')
                is_ji_shen = effective_gods.get(p_branch_element) == '忌神'
                severity = 'severe' if is_ji_shen else 'moderate'

                negative.append({
                    'type': '桃花劫',
                    'pillar': pname,
                    'branch': p_branch,
                    'description': f'{pname}柱桃花劫（{jiecai_source}）',
                    'severity': severity,
                })

    # --- 九丑桃花 (day pillar check) ---
    day_gz = pillars['day']['stem'] + pillars['day']['branch']
    if day_gz in JIUCHOU_DAYS:
        negative.append({
            'type': '九丑桃花',
            'pillar': 'day',
            'branch': pillars['day']['branch'],
            'description': f'日柱{day_gz}為九丑桃花',
            'severity': 'moderate',
        })

    # Summary
    total_positive = len(positive)
    total_negative = len(negative)
    if total_positive > total_negative * 2:
        summary = '先天桃花以正桃花為主，感情運勢穩健'
    elif total_negative > total_positive * 2:
        summary = '先天桃花以爛桃花居多，感情需謹慎經營'
    elif total_positive == 0 and total_negative == 0:
        summary = '桃花星不顯著，感情運偏淡'
    else:
        summary = '正爛桃花皆有，感情機會多但需分辨'

    return {
        'positive': positive,
        'negative': negative,
        'summary': summary,
        'totalPositive': total_positive,
        'totalNegative': total_negative,
    }


# ============================================================
# 2. Spouse Star Analysis (配偶星分析)
# ============================================================

def compute_spouse_star_analysis(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    effective_gods: Dict[str, str],
    strength_v2: Dict,
) -> Dict[str, Any]:
    """
    Analyze spouse star (配偶星) visibility, position, and marriage-danger patterns.

    Includes:
    - Spouse star identification and visibility
    - 官殺混雜 (female) / 財星混雜 (male)
    - 傷官見官 (female) with buffer detection
    - 比劫奪財 (male) with venting detection
    - DM vs spouse star strength balance
    """
    dm_element = STEM_ELEMENT[day_master_stem]

    if gender == 'male':
        spouse_star_tg = '正財'
        romance_star_tg = '偏財'
        spouse_element = ELEMENT_OVERCOMES[dm_element]
    else:
        spouse_star_tg = '正官'
        romance_star_tg = '偏官'
        spouse_element = ELEMENT_OVERCOME_BY[dm_element]

    # Scan all pillars for spouse star and related ten gods
    spouse_star_positions: List[Dict] = []
    romance_star_positions: List[Dict] = []
    all_ten_gods: Dict[str, List[str]] = {}  # ten_god -> [pillar_names]

    pillar_names = ['year', 'month', 'day', 'hour']
    for pname in pillar_names:
        pillar = pillars[pname]
        # Check stem
        stem_tg = derive_ten_god(day_master_stem, pillar['stem'])
        if stem_tg:
            all_ten_gods.setdefault(stem_tg, []).append(f'{pname}_stem')
            if stem_tg == spouse_star_tg:
                spouse_star_positions.append({
                    'pillar': pname, 'location': 'stem',
                    'visible': True, 'stem': pillar['stem'],
                })
            elif stem_tg == romance_star_tg:
                romance_star_positions.append({
                    'pillar': pname, 'location': 'stem',
                    'visible': True, 'stem': pillar['stem'],
                })

        # Check hidden stems
        hidden = HIDDEN_STEMS.get(pillar['branch'], [])
        for i, hs in enumerate(hidden):
            hs_tg = derive_ten_god(day_master_stem, hs)
            if hs_tg:
                all_ten_gods.setdefault(hs_tg, []).append(f'{pname}_hidden')
                if hs_tg == spouse_star_tg:
                    spouse_star_positions.append({
                        'pillar': pname, 'location': 'hidden',
                        'visible': False, 'stem': hs,
                        'isBenqi': i == 0,
                    })
                elif hs_tg == romance_star_tg:
                    romance_star_positions.append({
                        'pillar': pname, 'location': 'hidden',
                        'visible': False, 'stem': hs,
                        'isBenqi': i == 0,
                    })

    # Visibility classification
    visible_positions = [p for p in spouse_star_positions if p['visible']]
    hidden_positions = [p for p in spouse_star_positions if not p['visible']]

    if visible_positions:
        visibility = '透出'
    elif hidden_positions:
        visibility = '暗藏'
    else:
        visibility = '全無'

    # Element role (喜 vs 忌)
    spouse_role = effective_gods.get(spouse_element, '閒神')

    # DM strength
    strength_class = strength_v2.get('classification', 'balanced')
    is_strong = strength_class in ('strong', 'very_strong')
    is_weak = strength_class in ('weak', 'very_weak')

    # Spouse star strength (simple count-based)
    spouse_count = len(spouse_star_positions) + len(romance_star_positions)
    spouse_strong = spouse_count >= 3

    # Balance assessment
    if is_strong and spouse_strong:
        balance = 'balanced'
        balance_desc = '身強星強，勢均力敵'
    elif is_strong and not spouse_strong:
        balance = 'dominates'
        balance_desc = '身強星弱，容易主導對方'
    elif is_weak and spouse_strong:
        balance = 'overwhelmed'
        balance_desc = '身弱星強，容易受對方壓制'
    elif is_weak and not spouse_strong:
        balance = 'lacking'
        balance_desc = '身弱星弱，感情緣分偏薄'
    else:
        balance = 'balanced'
        balance_desc = '身星平衡'

    # Late marriage indicator: 時支藏 spouse star
    hour_hidden = HIDDEN_STEMS.get(pillars['hour']['branch'], [])
    late_marriage_indicator = False
    if hour_hidden:
        for hs in hour_hidden:
            tg = derive_ten_god(day_master_stem, hs)
            if tg in (spouse_star_tg, romance_star_tg):
                late_marriage_indicator = True
                break

    # 時支藏財 — potential infidelity risk (nuanced, NOT absolute)
    # Only applies to males (for males, 財 = women/romance)
    # For females, 財 represents resources/mother-in-law, not romantic partners
    hour_wealth_note = ''
    if gender == 'male':
        for hs in hour_hidden:
            tg = derive_ten_god(day_master_stem, hs)
            if tg in ('偏財', '正財'):
                hour_wealth_note = (
                    f'時支藏{tg}，代表晚年或私密層面有額外感情緣分的可能性。'
                    '但這僅是一種傾向，不代表必然，實際情況受個人價值觀、'
                    '家庭教育、伴侶關係品質等多方因素影響。'
                )
                break

    # --- Marriage danger patterns ---
    challenges: List[Dict[str, Any]] = []

    # 官殺混雜 (female) / 財星混雜 (male)
    if gender == 'female':
        guan_count = len(all_ten_gods.get('正官', []))
        sha_count = len(all_ten_gods.get('偏官', []))
        if guan_count >= 1 and sha_count >= 1:
            challenges.append({
                'type': '官殺混雜',
                'severity': 'high',
                'description': '正官與七殺同時出現，感情容易搖擺不定',
                'guanCount': guan_count,
                'shaCount': sha_count,
            })
    else:
        zhengcai_count = len(all_ten_gods.get('正財', []))
        piancai_count = len(all_ten_gods.get('偏財', []))
        if zhengcai_count >= 1 and piancai_count >= 1:
            challenges.append({
                'type': '財星混雜',
                'severity': 'high',
                'description': '正財與偏財同時出現，感情容易有多角關係',
                'zhengcaiCount': zhengcai_count,
                'piancaiCount': piancai_count,
            })

    # 傷官見官 (female)
    if gender == 'female':
        shangguan_positions = all_ten_gods.get('傷官', [])
        zhengguan_positions = all_ten_gods.get('正官', [])
        if shangguan_positions and zhengguan_positions:
            # Check for 財星 buffer (mediating element)
            caixin_positions = all_ten_gods.get('正財', []) + all_ten_gods.get('偏財', [])
            has_financial_buffer = len(caixin_positions) > 0

            # Check for 傷官合殺 (傷官 + 七殺 combo can neutralize)
            shangguan_he_sha = len(shangguan_positions) > 0 and len(all_ten_gods.get('偏官', [])) > 0

            severity = 'moderate' if (has_financial_buffer or shangguan_he_sha) else 'critical'
            challenges.append({
                'type': '傷官見官',
                'severity': severity,
                'description': '傷官見官，婚姻容易有衝突和波折',
                'hasFinancialBuffer': has_financial_buffer,
                'shangGuanHeSha': shangguan_he_sha,
                'shangguanCount': len(shangguan_positions),
                'zhengguanCount': len(zhengguan_positions),
            })

    # 比劫奪財 (male)
    if gender == 'male':
        bijian_positions = all_ten_gods.get('比肩', [])
        jiecai_positions = all_ten_gods.get('劫財', [])
        bijie_total = len(bijian_positions) + len(jiecai_positions)

        zhengcai_positions = all_ten_gods.get('正財', [])
        piancai_positions = all_ten_gods.get('偏財', [])
        cai_total = len(zhengcai_positions) + len(piancai_positions)

        if bijie_total >= 2 and cai_total >= 1:
            # Check for 食傷 venting flow (洩氣)
            shishang_count = len(all_ten_gods.get('食神', [])) + len(all_ten_gods.get('傷官', []))
            has_venting_flow = shishang_count >= 1

            # Check if 比劫 in day branch
            day_hidden = HIDDEN_STEMS.get(pillars['day']['branch'], [])
            bi_jie_in_day = False
            for hs in day_hidden:
                tg = derive_ten_god(day_master_stem, hs)
                if tg in ('比肩', '劫財'):
                    bi_jie_in_day = True
                    break

            severity = 'moderate' if has_venting_flow else 'high'
            challenges.append({
                'type': '比劫奪財',
                'severity': severity,
                'description': '比劫多而財弱，容易有感情競爭',
                'hasVentingFlow': has_venting_flow,
                'biJieInDayBranch': bi_jie_in_day,
                'biJieCount': bijie_total,
                'caiCount': cai_total,
            })

    return {
        'spouseStar': spouse_star_tg,
        'romanceStar': romance_star_tg,
        'spouseElement': spouse_element,
        'spouseRole': spouse_role,
        'visibility': visibility,
        'positions': spouse_star_positions,
        'romancePositions': romance_star_positions,
        'balance': balance,
        'balanceDescription': balance_desc,
        'lateMarriageIndicator': late_marriage_indicator,
        'hourWealthNote': hour_wealth_note,
        'challenges': challenges,
    }


# ============================================================
# 3. Marriage Palace Analysis (婚姻宮分析)
# ============================================================

def compute_marriage_palace_analysis(
    pillars: Dict,
    day_master_stem: str,
    kong_wang: List[str],
) -> Dict[str, Any]:
    """
    Analyze the marriage palace (日支 = 配偶宮).

    Includes:
    - Day branch element and personality archetype
    - 十二長生 stage at day branch
    - 空亡 check
    - Natal 六害 check (any natal branch 六害 day branch)
    """
    day_branch = pillars['day']['branch']
    day_stem = pillars['day']['stem']
    day_gz = day_stem + day_branch

    # Element
    element = BRANCH_ELEMENT.get(day_branch, '')

    # Hidden stem personality
    hidden = HIDDEN_STEMS.get(day_branch, [])
    palace_ten_god = ''
    if hidden:
        palace_ten_god = derive_ten_god(day_master_stem, hidden[0])

    # Element-based appearance hints
    element_appearance = {
        '木': '高挑、清秀、文質彬彬',
        '火': '明亮、有活力、五官分明',
        '土': '穩重、敦厚、面圓體健',
        '金': '白皙、精緻、輪廓清晰',
        '水': '圓潤、靈動、皮膚較好',
    }

    # Ten god personality archetype for spouse
    ten_god_archetype = {
        '比肩': '獨立自主，和你相似',
        '劫財': '強勢果斷，競爭心強',
        '食神': '溫和體貼，懂得享受',
        '傷官': '才華洋溢，個性突出',
        '偏財': '交際廣泛，大方慷慨',
        '正財': '踏實穩重，理財有方',
        '偏官': '有魄力有能力，但脾氣大',
        '正官': '正派有責任感，循規蹈矩',
        '偏印': '聰明特立獨行，想法另類',
        '正印': '善良包容，有教養',
    }

    # Twelve life stage at day branch
    stage = _get_twelve_stage(day_master_stem, day_branch)

    # 空亡 check
    is_kong_wang = day_branch in kong_wang

    # Natal 六害 check
    natal_harm = []
    for pname in ['year', 'month', 'hour']:
        p_branch = pillars[pname]['branch']
        if HARM_LOOKUP.get(p_branch) == day_branch:
            natal_harm.append({
                'pillar': pname,
                'branch': p_branch,
                'description': f'{p_branch}{day_branch}害（{pname}柱害配偶宮）',
            })

    # 日支四大桃花位 — classical spouse appearance indicator
    # 子午卯酉 = 四正/四桃花: "日支坐子午卯酉，配偶相貌端莊漂亮"
    # 寅申巳亥 = 四長生: spouse clever/capable
    # 辰戌丑未 = 四墓庫: spouse steady/plain
    FOUR_PEACH_BRANCHES = {'子', '午', '卯', '酉'}
    FOUR_CHANGSHENG_BRANCHES = {'寅', '申', '巳', '亥'}

    if day_branch in FOUR_PEACH_BRANCHES:
        appearance_grade = '端莊漂亮'
        appearance_note = '日支為四大桃花位（子午卯酉），配偶外貌佳、異性緣好'
    elif day_branch in FOUR_CHANGSHENG_BRANCHES:
        appearance_grade = '精明幹練'
        appearance_note = '日支為四長生位（寅申巳亥），配偶聰慧能幹'
    else:
        appearance_grade = '樸素敦厚'
        appearance_note = '日支為四墓庫位（辰戌丑未），配偶穩重樸實'

    return {
        'dayBranch': day_branch,
        'element': element,
        'appearanceHint': element_appearance.get(element, ''),
        'appearanceGrade': appearance_grade,
        'appearanceNote': appearance_note,
        'palaceTenGod': palace_ten_god,
        'personalityArchetype': ten_god_archetype.get(palace_ten_god, ''),
        'twelveStage': stage,
        'isKongWang': is_kong_wang,
        'natalHarm': natal_harm,
        'dayPillar': day_gz,
    }


# ============================================================
# 4. Love Personality (戀愛性格分析)
# ============================================================

# Module-level constant: dominant ten god overlay for love personality
# When any ten god reaches 4+ total count (stems + hidden stems),
# it dominates the chart's behavioral energy beyond the base archetype.
DOMINANT_TG_OVERLAY = {
    '比肩': {
        'trait': '外剛內柔型',
        'description': (
            '命局中{tg}多達{count}個，行為能量以獨立自主為主導。'
            '在感情中表現為重視個人空間、競爭心強、不輕易妥協。'
        ),
        'love_impact_weak': (
            '但身弱特質讓這份獨立帶有矛盾性——'
            '表面堅持自我，內心渴望依靠；'
            '容易吸引感情競爭局面（比劫分財），需特別注意第三者風險。'
        ),
        'love_impact_strong': (
            '身強加持讓這份獨立更加堅定，在感情中容易主導關係走向，'
            '伴侶需要有足夠的獨立性和包容度才能與你長久相處。'
        ),
        'love_impact': '比劫過多易有感情競爭，需注意第三者風險。',
    },
    '劫財': {
        'trait': '衝動熱烈型',
        'description': (
            '命局中{tg}多達{count}個，感情中熱烈衝動、敢愛敢恨。'
            '你的愛情來得快去得也快，需要學習細水長流。'
        ),
        'love_impact_weak': (
            '身弱加上劫財過旺，感情容易被他人搶奪（比劫分財），'
            '且衝動行為後容易後悔和自我懷疑。'
        ),
        'love_impact_strong': (
            '身強加上劫財旺，敢愛敢恨的特質更加明顯，'
            '但也更容易因衝動而傷害到伴侶。'
        ),
        'love_impact': '劫財過多易有感情競爭和衝動決策風險。',
    },
    '食神': {
        'trait': '享樂浪漫型',
        'description': (
            '命局中{tg}多達{count}個，感情中重視享受與表達。'
            '你善於營造浪漫氛圍，但過度追求感官享受可能導致感情流於表面。'
        ),
        'love_impact': '建議在享受浪漫的同時，也注重與伴侶的深層溝通和精神交流。',
    },
    '傷官': {
        'trait': '叛逆創新型',
        'description': (
            '命局中{tg}多達{count}個，感情中追求新鮮感和刺激。'
            '你不喜歡一成不變的關係模式，但過度挑剔容易傷害伴侶。'
        ),
        'love_impact': '建議學習欣賞伴侶的優點，減少批判性思維在感情中的運用。',
    },
    '正印': {
        'trait': '溫暖守護型',
        'description': (
            '命局中{tg}多達{count}個，感情中重視精神交流和安全感。'
            '你善於給予關懷，但可能過度保護或控制伴侶。'
        ),
        'love_impact': '建議給伴侶足夠的成長空間，愛不等於控制。',
    },
    '偏印': {
        'trait': '獨特思維型',
        'description': (
            '命局中{tg}多達{count}個，感情中思維獨特、不按常理出牌。'
            '你的愛情觀可能與主流不同，需要找到理解你的人。'
        ),
        'love_impact': '建議保持溝通的耐心，不是每個人都能跟上你的思路。',
    },
    '正官': {
        'trait': '傳統規矩型',
        'description': (
            '命局中{tg}多達{count}個，感情中重視承諾和責任。'
            '你是可靠的伴侶，但可能過於嚴肅或缺乏情趣。'
        ),
        'love_impact': '建議在穩定的基礎上，適當增加一些浪漫和驚喜。',
    },
    '偏官': {
        'trait': '果斷強勢型',
        'description': (
            '命局中{tg}多達{count}個，感情中果斷而有主見。'
            '你的魅力在於氣場強大，但過度強勢可能讓伴侶感到壓力。'
        ),
        'love_impact': '建議學習傾聽和退讓，強強聯合不一定是最佳模式。',
    },
    '正財': {
        'trait': '務實穩定型',
        'description': (
            '命局中{tg}多達{count}個，感情中重視實際和穩定。'
            '你是踏實的伴侶，但可能過於計較得失。'
        ),
        'love_impact': '建議在感情中多一些浪漫和包容，不要把一切都量化。',
    },
    '偏財': {
        'trait': '風流多情型',
        'description': (
            '命局中{tg}多達{count}個，感情中浪漫多情、人緣極佳。'
            '你容易吸引異性注意，但感情容易分散。'
        ),
        'love_impact': '建議在確認關係後收斂桃花心，專注經營一段深度關係。',
    },
}


def compute_love_personality(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    effective_gods: Dict[str, str],
    strength_v2: Dict,
    all_shen_sha: List[Dict],
) -> Dict[str, Any]:
    """
    Compute love personality based on ten god framework + DM element style.

    Ten god framework: 10 archetypes based on prominent ten god.
    DM element: 5 element-based love styles.
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    strength_class = strength_v2.get('classification', 'balanced')

    # Count ten gods
    ten_god_counts: Dict[str, int] = {}
    pillar_names = ['year', 'month', 'day', 'hour']
    for pname in pillar_names:
        pillar = pillars[pname]
        stem_tg = derive_ten_god(day_master_stem, pillar['stem'])
        if stem_tg:
            ten_god_counts[stem_tg] = ten_god_counts.get(stem_tg, 0) + 1

        hidden = HIDDEN_STEMS.get(pillar['branch'], [])
        for hs in hidden:
            hs_tg = derive_ten_god(day_master_stem, hs)
            if hs_tg:
                ten_god_counts[hs_tg] = ten_god_counts.get(hs_tg, 0) + 1

    # Determine dominant ten god
    dominant_tg = max(ten_god_counts, key=ten_god_counts.get) if ten_god_counts else '比肩'

    # Ten God Love Archetypes
    TEN_GOD_LOVE_ARCHETYPE = {
        '比肩': {'label': '獨立型', 'trait': '重視個人空間，喜歡平等的伴侶關係'},
        '劫財': {'label': '競爭型', 'trait': '感情強烈，佔有慾強，容易爭風吃醋'},
        '食神': {'label': '享受型', 'trait': '溫柔體貼，浪漫情趣，重視感覺'},
        '傷官': {'label': '才華型', 'trait': '眼光高，感情豐富，喜歡有才華的對象'},
        '偏財': {'label': '風流型', 'trait': '異性緣好，交際廣泛，感情不專一'},
        '正財': {'label': '務實型', 'trait': '重視經濟基礎，感情穩定踏實'},
        '偏官': {'label': '霸道型', 'trait': '直接果斷，喜歡有能力的對象'},
        '正官': {'label': '傳統型', 'trait': '重視門當戶對，注重禮教規範'},
        '偏印': {'label': '獨特型', 'trait': '想法特別，不按常理出牌'},
        '正印': {'label': '溫暖型', 'trait': '善良包容，母愛/父愛型的感情'},
    }

    # DM Element Love Style
    ELEMENT_LOVE_STYLE = {
        '木': {'style': '浪漫理想派', 'description': '重感覺，追求精神共鳴，但有時太理想化'},
        '火': {'style': '熱情衝動派', 'description': '愛得轟轟烈烈，但容易來得快去得快'},
        '土': {'style': '穩重踏實派', 'description': '重視安全感，感情忠誠但不善表達'},
        '金': {'style': '冷靜理性派', 'description': '原則性強，對感情有高標準'},
        '水': {'style': '靈活變通派', 'description': '適應力強，但感情容易搖擺'},
    }

    archetype = TEN_GOD_LOVE_ARCHETYPE.get(dominant_tg, TEN_GOD_LOVE_ARCHETYPE['比肩'])
    element_style = ELEMENT_LOVE_STYLE.get(dm_element, ELEMENT_LOVE_STYLE['土'])

    # Strength impact
    if strength_class in ('strong', 'very_strong'):
        strength_impact = '身強：主導型，在感情中掌握主動權'
    elif strength_class in ('weak', 'very_weak'):
        strength_impact = '身弱：順從型，容易被感情牽制'
    else:
        strength_impact = '身中：配合型，感情中保持平衡'

    # Love shen sha tags
    love_tags: List[str] = []
    for sha in all_shen_sha:
        name = sha.get('name', '')
        if name in ('紅鸞', '天喜', '桃花', '孤辰', '寡宿', '陰陽差錯'):
            love_tags.append(name)

    # Per-pillar ten god personality (classical approach)
    # Year stem = family/childhood influence on love patterns
    # Month stem = social/work persona in relationships
    # Hour stem = inner desires/private behavior in relationships
    pillar_personality: Dict[str, Dict[str, str]] = {}
    for pname in ['year', 'month', 'hour']:
        stem_tg = derive_ten_god(day_master_stem, pillars[pname]['stem'])
        if stem_tg:
            # derive_ten_god returns '比肩' for same-stem, so stem_tg is always truthy
            archetype_info = TEN_GOD_LOVE_ARCHETYPE.get(stem_tg, {'label': '未知', 'trait': ''})
            pillar_personality[pname] = {
                'tenGod': stem_tg,
                'archetype': archetype_info['label'],
                'trait': archetype_info['trait'],
                'context': (
                    '原生家庭（童年影響）' if pname == 'year'
                    else '社交面（外在表現）' if pname == 'month'
                    else '內心面（私下想法）'
                ),
            }

    # Dominant ten god overlay: when any ten god reaches 4+ total count,
    # it dominates the chart's behavioral energy beyond the base archetype.
    DOMINANT_THRESHOLD = 4
    dominant_overlay = None
    # Sort by count descending to guarantee highest-count ten god is selected first
    for tg, count in sorted(ten_god_counts.items(), key=lambda x: -x[1]):
        if count >= DOMINANT_THRESHOLD:
            overlay_info = DOMINANT_TG_OVERLAY.get(tg)
            if overlay_info:
                # Default to generic love_impact (for balanced/zhong charts)
                love_impact = overlay_info['love_impact']
                # Override for strong or weak charts when specific text exists
                if strength_class in ('strong', 'very_strong'):
                    love_impact = overlay_info.get('love_impact_strong', overlay_info['love_impact'])
                elif strength_class in ('weak', 'very_weak'):
                    love_impact = overlay_info.get('love_impact_weak', overlay_info['love_impact'])

                dominant_overlay = {
                    'dominantTenGod': tg,
                    'count': count,
                    'trait': overlay_info['trait'],
                    'description': overlay_info['description'].format(tg=tg, count=count),
                    'loveImpact': love_impact,
                }
                break  # Only one overlay — the highest count ten god

    return {
        'dominantTenGod': dominant_tg,
        'archetype': archetype,
        'elementStyle': element_style,
        'strengthImpact': strength_impact,
        'strengthClass': strength_class,
        'dmElement': dm_element,
        'loveTags': love_tags,
        'tenGodCounts': ten_god_counts,
        'pillarPersonality': pillar_personality,
        'dominantOverlay': dominant_overlay,
    }


# ============================================================
# 5. Marriage Timing Indicators (婚期指標)
# ============================================================

def compute_marriage_timing_indicators(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    effective_gods: Dict[str, str],
    all_shen_sha: List[Dict],
    luck_periods: List[Dict],
) -> Dict[str, Any]:
    """
    Compute natal early/late marriage signals + favorable/unfavorable 大運 ranges.
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    strength_class_data = None  # We don't have strength_v2 here, use shensha instead

    if gender == 'male':
        spouse_star_tg = '正財'
        danger_tg = {'劫財', '比肩'}
    else:
        spouse_star_tg = '正官'
        danger_tg = {'傷官', '比肩'}

    spouse_element = (
        ELEMENT_OVERCOMES[dm_element] if gender == 'male'
        else ELEMENT_OVERCOME_BY[dm_element]
    )

    # Natal signals
    early_signals: List[str] = []
    late_signals: List[str] = []

    # Check month pillar for spouse star (early indicator)
    month_stem_tg = derive_ten_god(day_master_stem, pillars['month']['stem'])
    month_hidden = HIDDEN_STEMS.get(pillars['month']['branch'], [])
    if month_stem_tg == spouse_star_tg:
        early_signals.append(f'月柱天干見{spouse_star_tg}')
    elif month_hidden:
        if derive_ten_god(day_master_stem, month_hidden[0]) == spouse_star_tg:
            early_signals.append(f'月柱地支藏{spouse_star_tg}')

    # Check hour pillar for spouse star (late indicator)
    hour_stem_tg = derive_ten_god(day_master_stem, pillars['hour']['stem'])
    hour_hidden = HIDDEN_STEMS.get(pillars['hour']['branch'], [])
    if hour_stem_tg == spouse_star_tg:
        late_signals.append(f'時柱天干見{spouse_star_tg}（晚婚指標）')
    elif hour_hidden:
        for hs in hour_hidden:
            if derive_ten_god(day_master_stem, hs) == spouse_star_tg:
                late_signals.append(f'時柱地支藏{spouse_star_tg}（晚婚指標）')
                break

    # 配偶星不透出 — late marriage indicator
    # 透出 = visible on heavenly stems. Hidden stems (藏干) don't count.
    # When spouse star is absent from all four stems, early marriage unfavorable.
    visible_spouse = False
    for pname_check in ['year', 'month', 'day', 'hour']:
        stem_tg = derive_ten_god(day_master_stem, pillars[pname_check]['stem'])
        if stem_tg == spouse_star_tg:
            visible_spouse = True
            break
    if not visible_spouse:
        late_signals.append(
            f'{spouse_star_tg}不透出，不宜早婚，晚婚對事業發展和家庭幸福較有利'
        )

    # Shen sha indicators
    for sha in all_shen_sha:
        name = sha.get('name', '')
        if name in ('孤辰', '寡宿'):
            late_signals.append(f'{name}入命（晚婚指標）')
        elif name == '陰陽差錯':
            late_signals.append('陰陽差錯日（婚姻波折指標）')

    # 大運 favorable/unfavorable LP ranges
    enriched_lps = _enrich_luck_periods(luck_periods, day_master_stem, gender, effective_gods)

    favorable_lp_ranges: List[Dict] = []
    unfavorable_lp_ranges: List[Dict] = []

    # Scan first 5 luck periods
    for lp in enriched_lps[:5]:
        stem = lp.get('stem', '')
        branch = lp.get('branch', '')
        start_year = lp.get('startYear', 0)
        end_year = lp.get('endYear', 0)
        start_age = lp.get('startAge', 0)

        if not stem or not branch:
            continue

        stem_tg = derive_ten_god(day_master_stem, stem)
        hidden = HIDDEN_STEMS.get(branch, [])
        branch_tg = derive_ten_god(day_master_stem, hidden[0]) if hidden else ''

        # Check if spouse star appears in LP
        has_spouse_star = (
            stem_tg in (spouse_star_tg, '偏財' if gender == 'male' else '偏官')
            or branch_tg in (spouse_star_tg, '偏財' if gender == 'male' else '偏官')
        )

        # Check if danger star appears
        has_danger = stem_tg in danger_tg or branch_tg in danger_tg

        # Check if 六合 or 六沖 day branch
        lp_harmony = HARMONY_LOOKUP.get(branch) == pillars['day']['branch']
        lp_clash = CLASH_LOOKUP.get(branch) == pillars['day']['branch']

        if has_spouse_star or lp_harmony:
            reasons = []
            if has_spouse_star:
                reasons.append(f'大運見{spouse_star_tg}')
            if lp_harmony:
                reasons.append('大運合配偶宮')
            favorable_lp_ranges.append({
                'startYear': start_year,
                'endYear': end_year,
                'startAge': start_age,
                'stem': stem,
                'branch': branch,
                'reasons': reasons,
            })

        if has_danger or lp_clash:
            reasons = []
            if has_danger:
                reasons.append(f'大運見{"比劫" if gender == "male" else "傷官"}')
            if lp_clash:
                reasons.append('大運沖配偶宮')
            unfavorable_lp_ranges.append({
                'startYear': start_year,
                'endYear': end_year,
                'startAge': start_age,
                'stem': stem,
                'branch': branch,
                'reasons': reasons,
            })

    return {
        'earlySignals': early_signals,
        'lateSignals': late_signals,
        'favorableLPRanges': favorable_lp_ranges,
        'unfavorableLPRanges': unfavorable_lp_ranges,
    }


# ============================================================
# 6. Romance Good Years (桃花運好的年份)
# ============================================================

def compute_romance_good_years(
    gender: str,
    day_master_stem: str,
    day_branch: str,
    year_branch: str,
    annual_stars: List[Dict],
    kong_wang: List[str],
    birth_year: int,
    current_year: int,
    luck_periods_enriched: List[Dict],
) -> List[Dict[str, Any]]:
    """
    Compute romance good years with star-type labels and 大運 cross-reference.

    Reuses compute_romance_years_enriched() from lifetime_enhanced,
    then enriches with star-type labels and 大運 context.
    """
    # Get enriched romance years
    romance_data = compute_romance_years_enriched(
        gender, day_master_stem, day_branch, year_branch,
        annual_stars, kong_wang, birth_year, current_year,
        max_candidates=10,  # Love reading needs more years than lifetime
    )

    if not romance_data:
        return []

    # Tag with dayun context
    tagged = tag_romance_years_with_dayun(
        romance_data, annual_stars, luck_periods_enriched,
        day_branch, year_branch, day_master_stem, gender,
    )

    # Enrich with star-type labels (gender-aware)
    hongluan_branch = HONGLUAN.get(year_branch, '')
    tianxi_branch = TIANXI.get(year_branch, '')

    # Gender-aware spouse/romance star classification
    if gender == 'male':
        spouse_tg = '正財'
        romance_tg = '偏財'
    else:
        spouse_tg = '正官'
        romance_tg = '偏官'

    for item in tagged:
        year = item['year']
        annual_star = next((s for s in annual_stars if s['year'] == year), None)
        if not annual_star:
            # Missing annual_star = data gap, apply tier-aware fallback
            tier = item.get('tier', '')
            if tier == 'primary':
                item['starType'] = '合婚年'
            elif tier == 'secondary':
                item['starType'] = '桃花合年'
            else:
                item['starType'] = '_drop'
            continue

        annual_branch = annual_star['branch']
        annual_stem = annual_star['stem']

        if annual_branch == hongluan_branch:
            item['starType'] = '紅鸞年'
            # Check if stem also carries spouse/romance star
            stem_tg = derive_ten_god(day_master_stem, annual_stem)
            if stem_tg == spouse_tg:
                item['starType'] = '紅鸞正緣年'
            elif stem_tg == romance_tg:
                item['starType'] = '紅鸞年'
                item['subNote'] = f'天干見{romance_tg}，增強桃花效力'
        elif annual_branch == tianxi_branch:
            item['starType'] = '天喜年'
        else:
            stem_tg = derive_ten_god(day_master_stem, annual_stem)
            if stem_tg == romance_tg:
                # 偏財/偏官 = casual romance, not true spouse star
                item['starType'] = f'{romance_tg}桃花年'
            elif stem_tg == spouse_tg:
                # 正財/正官 = true spouse star → genuine marriage year
                item['starType'] = '正緣年'
            else:
                # Signal-aware labeling for non-star romance candidates
                # With accumulative scoring, check signal field for specific mechanisms
                # Signal-aware labeling for non-star romance candidates
                signal = item.get('signal', '')
                tier = item.get('tier', '')
                if '六合日支' in signal:
                    item['starType'] = '合婚年'
                elif '沖開夫妻宮' in signal:
                    item['starType'] = '合婚年'
                elif tier == 'primary':
                    # Primary tier (score>=4) with strong signals
                    item['starType'] = '合婚年'
                elif tier == 'secondary' and ('天干合日主' in signal):
                    item['starType'] = '桃花合年'
                elif tier == 'supplementary':
                    # Weak signals (三合, 桃花, 天喜, 配偶星藏干) = drop
                    item['starType'] = '_drop'
                else:
                    item['starType'] = '桃花合年'

    # Post-process: annotate day-branch 天喜 overlap (regardless of starType)
    # Uses direct branch comparison, not signal string — signal field tracks
    # the candidate's detection tier, not what stars the annual branch corresponds to
    tianxi_day_branch = TIANXI.get(day_branch, '')
    for item in tagged:
        annual_star = next((s for s in annual_stars if s['year'] == item['year']), None)
        if not annual_star:
            continue
        annual_branch = annual_star['branch']
        has_tianxi = (annual_branch == tianxi_day_branch) or ('天喜' in item.get('signal', ''))
        if has_tianxi:
            if item['starType'] in ('桃花合年', '_drop', '正緣年', '偏財桃花年', '偏官桃花年'):
                item['starType'] = '天喜桃花年'
            elif item['starType'] == '紅鸞年':
                item['starType'] = '天喜紅鸞年'  # Both stars on same year
            elif item['starType'] == '合婚年':
                # 合婚年 is stronger than 天喜 — keep label, annotate in subNote
                item['subNote'] = item.get('subNote', '') + '天喜同年，喜上加喜'
            elif item['starType'] == '天喜年':
                pass  # Already the strongest 天喜 label — dual-天喜 (year+day) is a no-op

    # Remove weak-tier candidates marked for dropping (after 天喜 overlay may rescue some)
    tagged = [item for item in tagged if item.get('starType') != '_drop']

    # Post-process: annotate 空亡 years in starType (display layer only)
    for item in tagged:
        if item.get('is_kong_wang'):
            item['starType'] += '(空亡年)'

    # Ensure 紅鸞年 and 天喜年 are always included even if not romance candidates
    seen_years = {item['year'] for item in tagged}
    for star in annual_stars:
        year = star['year']
        if year < current_year or year > current_year + 10:
            continue
        if year in seen_years:
            continue
        annual_branch = star['branch']
        star_type = ''
        signal_text = ''
        if annual_branch == hongluan_branch:
            star_type = '紅鸞年'
            signal_text = '紅鸞星動'
            # Check if stem also carries spouse/romance star (compound label)
            annual_stem = star['stem']
            stem_tg = derive_ten_god(day_master_stem, annual_stem)
            if stem_tg == spouse_tg:
                star_type = '紅鸞正緣年'
            elif stem_tg == romance_tg:
                star_type = '紅鸞年'
        elif annual_branch == tianxi_branch:
            star_type = '天喜年'
            signal_text = '天喜星動'

        if star_type:
            # Look up real 大運 context instead of hardcoding
            active_lp = _find_active_luck_period(luck_periods_enriched, year)
            lp_context = 'moderate'
            lp_score = 0
            lp_signals = [signal_text]
            if active_lp:
                lp_tg = derive_ten_god(day_master_stem, active_lp.get('stem', ''))
                if lp_tg in ('正財', '正官', '偏財', '偏官'):
                    lp_context = 'strong'
                    lp_score = 2
                    lp_signals.append(f'大運{active_lp.get("stem", "")}{active_lp.get("branch", "")}帶{lp_tg}')
                elif lp_tg in ('食神', '傷官'):
                    lp_context = 'moderate'
                    lp_score = 1

            tagged.append({
                'year': year,
                'branch': annual_branch,
                'starType': star_type,
                'dayun_context': lp_context,
                'dayun_score': lp_score,
                'dayun_signals': lp_signals,
                'conflicted': False,
                'conflicted_detail': '',
                'tier': 'hongluan' if '紅鸞' in star_type else 'tianxi',
                'signal': signal_text,
            })

    # Re-sort by year
    tagged.sort(key=lambda x: x['year'])

    return tagged


# ============================================================
# 7. Romance Danger Years (桃花劫年份)
# ============================================================

def compute_romance_danger_years(
    pillars: Dict,
    day_master_stem: str,
    day_branch: str,
    annual_stars: List[Dict],
    kong_wang: List[str],
    current_year: int,
) -> List[Dict[str, Any]]:
    """
    Compute years with romance danger indicators.

    Checks: 紅艷桃花年, 六沖, 三刑, 自刑, 六害
    Severity: 六沖 > 三刑 > 六害 > 自刑 > 紅艷
    """
    hongyan_branch = HONGYAN_SHA.get(day_master_stem, '')
    harm_partner = HARM_LOOKUP.get(day_branch, '')
    clash_partner = CLASH_LOOKUP.get(day_branch, '')

    danger_years: List[Dict[str, Any]] = []

    for star in annual_stars:
        year = star['year']
        annual_branch = star['branch']

        # Filter range: current year to current_year + 10
        if year < current_year or year > current_year + 10:
            continue

        # P6: 空亡 branches are no longer blanket-skipped.
        # Classical principle "逢沖填實": void branches activate when clashed/combined.
        # Instead, flag and reduce severity by 20%.
        is_kong_wang = annual_branch in kong_wang

        triggers: List[Dict[str, Any]] = []

        # 六沖日支 (highest severity)
        if annual_branch == clash_partner:
            triggers.append({
                'type': '六沖',
                'severity': 90,
                'description': f'{annual_branch}沖{day_branch}（沖配偶宮）',
            })

        # 三刑 — shared helper requiring all 3 branches for 3-branch groups
        all_br = {pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')} | {annual_branch}
        sanxing_hit = check_sanxing_with_pool(annual_branch, day_branch, all_br)
        if sanxing_hit:
            triggers.append({
                'type': '三刑',
                'severity': 80,
                'description': f'{annual_branch}{day_branch}刑（{sanxing_hit["name"]}）',
            })

        # 自刑 (only 辰午酉亥 — classical four self-punishment branches)
        if annual_branch == day_branch and day_branch in SELF_PUNISHMENT_BRANCHES:
            triggers.append({
                'type': '自刑',
                'severity': 60,
                'description': f'{annual_branch}自刑（配偶宮自刑）',
            })

        # 六害
        if annual_branch == harm_partner:
            triggers.append({
                'type': '六害',
                'severity': 70,
                'description': f'{annual_branch}{day_branch}害（害配偶宮）',
            })

        # 紅艷桃花年
        if annual_branch == hongyan_branch:
            triggers.append({
                'type': '紅艷桃花年',
                'severity': 50,
                'description': f'流年{annual_branch}為紅艷煞',
            })

        # Apply 空亡 severity reduction (classical: 空亡 dampens but doesn't nullify)
        if is_kong_wang and triggers:
            for t in triggers:
                t['severity'] = round(t['severity'] * 0.8)  # 20% reduction
                # Differentiate annotation: 六沖 → '逢沖填實', others → generic '空亡年'
                if t['type'] == '六沖':
                    t['description'] += '（空亡年，逢沖填實）'
                else:
                    t['description'] += '（空亡年）'

        if triggers:
            # Sort by severity descending
            triggers.sort(key=lambda t: t['severity'], reverse=True)
            entry = {
                'year': year,
                'branch': annual_branch,
                'triggers': triggers,
                'primaryTrigger': triggers[0]['type'],
                'maxSeverity': triggers[0]['severity'],
            }
            if is_kong_wang:
                entry['isKongWang'] = True
            danger_years.append(entry)

    # Sort by year
    danger_years.sort(key=lambda d: d['year'])
    return danger_years[:10]  # Cap at 10


# Annual forecast cross-reference constants
# Star-based good year types already captured by has_romance_star (branch-based check).
# All star-based types start with these prefixes. Used for deduplication.
STAR_BASED_GOOD_PREFIXES = ('紅鸞', '天喜')
# Danger triggers already captured in the annual forecast interactions check.
# Only triggers NOT in this set (e.g., 紅艷桃花年) add new negative signal.
INTERACTION_BASED_DANGERS = {'六沖', '三刑', '六害', '自刑'}

# Marriage change type significance weights (caution-only: 沖/刑/害)
# Positive interactions (六合, 三合) are handled by compute_romance_good_years.
CHANGE_TYPE_SIGNIFICANCE = {
    '六沖': 90,   # Direct clash — most disruptive
    '三刑': 80,   # Three-way punishment — high conflict
    '六害': 70,   # Hidden chronic damage
    '自刑': 60,   # Self-punishment — internal friction (辰午酉亥 only)
}


# ============================================================
# 8. Marriage Change Years (感情易變年份)
# ============================================================

def compute_marriage_change_years(
    day_branch: str,
    annual_stars: List[Dict],
    kong_wang: List[str],
    current_year: int,
    natal_branches: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Compute years where the marriage palace faces negative disruption.

    Checks: 六沖, 三刑, 自刑, 六害 (direct day-branch interactions only).
    Positive interactions (六合, 三合) are handled by compute_romance_good_years.
    Note: Intentional overlap with compute_romance_danger_years — both check 沖/刑/害
    but serve different narrative targets (婚姻變動 vs 桃花劫) with different output schemas.
    """
    change_years: List[Dict[str, Any]] = []

    for star in annual_stars:
        year = star['year']
        annual_branch = star['branch']

        if year < current_year or year > current_year + 10:
            continue
        # P6: 空亡 branches no longer blanket-skipped (classical: 逢沖填實)
        is_kong_wang = annual_branch in kong_wang

        changes: List[Dict[str, Any]] = []

        # 六沖 with day branch
        if CLASH_LOOKUP.get(annual_branch) == day_branch:
            changes.append({
                'type': '六沖',
                'nature': 'negative',
                'significance': CHANGE_TYPE_SIGNIFICANCE['六沖'],
                'description': f'{annual_branch}{day_branch}沖（沖配偶宮，感情動盪）',
            })

        # 三刑 with day branch — shared helper requiring all 3 branches
        all_br = set(natal_branches or []) | {annual_branch, day_branch}
        sanxing_hit = check_sanxing_with_pool(annual_branch, day_branch, all_br)
        if sanxing_hit:
            changes.append({
                'type': '三刑',
                'nature': 'negative',
                'significance': CHANGE_TYPE_SIGNIFICANCE['三刑'],
                'description': f'{annual_branch}{day_branch}刑（{sanxing_hit["name"]}，婚姻宮受刑）',
            })

        # 自刑 (only 辰午酉亥 — classical four self-punishment branches)
        if annual_branch == day_branch and day_branch in SELF_PUNISHMENT_BRANCHES:
            changes.append({
                'type': '自刑',
                'nature': 'negative',
                'significance': CHANGE_TYPE_SIGNIFICANCE['自刑'],
                'description': f'{annual_branch}自刑（配偶宮自刑，內在摩擦）',
            })

        # 六害 with day branch
        if HARM_LOOKUP.get(annual_branch) == day_branch:
            changes.append({
                'type': '六害',
                'nature': 'negative',
                'significance': CHANGE_TYPE_SIGNIFICANCE['六害'],
                'description': f'{annual_branch}{day_branch}害（害配偶宮，暗中不利）',
            })

        if changes:
            # Apply 空亡 significance reduction FIRST (before sort)
            if is_kong_wang:
                for c in changes:
                    c['significance'] = round(c.get('significance', 0) * 0.8)
                    c['description'] += '（空亡年）'

            # Sort changes by significance descending
            changes.sort(key=lambda c: c.get('significance', 0), reverse=True)

            entry = {
                'year': year,
                'branch': annual_branch,
                'changes': changes,
                'maxSignificance': changes[0].get('significance', 0),
                'primaryChange': changes[0]['type'],
            }
            if is_kong_wang:
                entry['isKongWang'] = True
            change_years.append(entry)

    change_years.sort(key=lambda c: c['year'])
    return change_years[:10]


# ============================================================
# 9. Partner Recommendations (婚配建議)
# ============================================================

def compute_partner_recommendations(
    day_branch: str,
    year_branch: str,
    effective_gods: Dict[str, str],
) -> Dict[str, Any]:
    """
    Compute favorable and avoidance partner zodiacs.

    Favorable: 六合 + 三合 zodiacs
    Avoidance: 六沖 + 六害 zodiacs with severity labels
    """
    # Reuse lifetime function for favorable
    partner_data = compute_partner_zodiacs(day_branch, year_branch)

    # Avoidance list: 六沖 + 六害 + 六破 (day-branch) + year-branch supplement
    avoidance: List[Dict[str, Any]] = []

    # Day-branch avoidance (夫妻宮 — professional 日柱合婚法)
    # ORDERING CONTRACT: day-branch entries are added FIRST (higher severity).
    # Year-branch dedup checks existing_branches to skip duplicates.
    # This means day-branch always wins when both target the same branch.

    # 六沖
    clash_partner = CLASH_LOOKUP.get(day_branch, '')
    if clash_partner:
        zodiac = ZODIAC.get(clash_partner, '')
        if zodiac:
            avoidance.append({
                'zodiac': zodiac,
                'branch': clash_partner,
                'type': '六沖',
                'severity': 'high',
                'source': 'day_branch',
                'description': f'{day_branch}{clash_partner}沖',
            })

    # 六害
    harm_partner = HARM_LOOKUP.get(day_branch, '')
    if harm_partner:
        zodiac = ZODIAC.get(harm_partner, '')
        if zodiac:
            avoidance.append({
                'zodiac': zodiac,
                'branch': harm_partner,
                'type': '六害',
                'severity': 'moderate',
                'source': 'day_branch',
                'description': f'{day_branch}{harm_partner}害',
            })

    # 六破 (lowest severity negative relationship)
    for pair_key, info in SIX_BREAKS.items():
        if day_branch in pair_key:
            break_partner = [b for b in pair_key if b != day_branch][0]
            zodiac = ZODIAC.get(break_partner, '')
            if zodiac:
                avoidance.append({
                    'zodiac': zodiac,
                    'branch': break_partner,
                    'type': '六破',
                    'severity': 'low',
                    'source': 'day_branch',
                    'description': f'{day_branch}{break_partner}破',
                    'caveat': '六破影響較輕，非絕對不利，但需注意細節消耗',
                })

    # Year-branch avoidance (年支屬相合婚 — folk tradition supplement)
    # Only 六沖 and 六害; no 六破 (too minor, even competitors omit it)
    if year_branch:
        existing_branches = {a['branch'] for a in avoidance}

        # 年支六沖
        yr_clash = CLASH_LOOKUP.get(year_branch, '')
        if yr_clash and yr_clash not in existing_branches:
            yr_clash_zodiac = ZODIAC.get(yr_clash, '')
            if yr_clash_zodiac:
                avoidance.append({
                    'zodiac': yr_clash_zodiac,
                    'branch': yr_clash,
                    'type': '六沖',
                    'severity': 'moderate',
                    'source': 'year_branch',
                    'description': f'年支{year_branch}{yr_clash}沖',
                })

        # 年支六害
        yr_harm = HARM_LOOKUP.get(year_branch, '')
        if yr_harm and yr_harm not in existing_branches:
            yr_harm_zodiac = ZODIAC.get(yr_harm, '')
            if yr_harm_zodiac:
                avoidance.append({
                    'zodiac': yr_harm_zodiac,
                    'branch': yr_harm,
                    'type': '六害',
                    'severity': 'low',
                    'source': 'year_branch',
                    'description': f'年支{year_branch}{yr_harm}害',
                })

    # Favorable element recommendation based on effective gods
    favorable_elements = [e for e, role in effective_gods.items()
                          if role in ('用神', '喜神')]

    # 六合合化 caveat — warn if 六合 transforms into 忌神/仇神 element
    # NOTE: 午未合 is contested (合而不化 is mainstream modern view).
    # We skip it by setting empty string to avoid false caveats.
    LIUHE_TRANSFORM = {
        frozenset({'子', '丑'}): '土',
        frozenset({'寅', '亥'}): '木',
        frozenset({'卯', '戌'}): '火',
        frozenset({'辰', '酉'}): '金',
        frozenset({'巳', '申'}): '水',
        frozenset({'午', '未'}): '',  # 午未合化爭議大，主流認為合而不化，此處不加註
    }

    favorable_caveats: List[Dict[str, Any]] = []
    harmony_partner = HARMONY_LOOKUP.get(day_branch, '')
    if harmony_partner:
        pair = frozenset({day_branch, harmony_partner})
        transform_element = LIUHE_TRANSFORM.get(pair, '')
        if transform_element and effective_gods.get(transform_element) in ('忌神', '仇神'):
            favorable_caveats.append({
                'zodiac': ZODIAC.get(harmony_partner, ''),
                'branch': harmony_partner,
                'caveat': (
                    f'{day_branch}{harmony_partner}合化{transform_element}，'
                    f'但{transform_element}為{effective_gods[transform_element]}，合化後未必有利'
                ),
            })

    # 喜用神配偶月份建議 — recommend partner birth season
    favorable_seasons: List[Dict[str, Any]] = []
    for element, role in effective_gods.items():
        if role in ('用神', '喜神') and element in ELEMENT_SEASON_MAP:
            season_info = ELEMENT_SEASON_MAP[element]
            favorable_seasons.append({
                'element': element,
                'role': role,
                'season': season_info['season'],
                'months': season_info['months'],
                'reason': season_info['reason'],
            })

    return {
        'favorablePrimary': partner_data['partner_zodiac'],
        'favorableSecondary': partner_data['partner_zodiac_secondary'],
        'avoidance': avoidance,
        'favorableElements': favorable_elements,
        'favorableCaveats': favorable_caveats,
        'favorableSeasons': favorable_seasons,
    }


# ============================================================
# 10. Annual Love Forecast (十年感情運勢)
# ============================================================

def compute_annual_love_forecast(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    effective_gods: Dict[str, str],
    luck_periods: List[Dict],
    annual_stars: List[Dict],
    kong_wang: List[str],
    current_year: int,
    good_year_set: frozenset = frozenset(),
    danger_year_set: frozenset = frozenset(),
    change_year_set: frozenset = frozenset(),
    good_year_type_lookup: Optional[Dict[int, str]] = None,
    danger_year_trigger_lookup: Optional[Dict[int, str]] = None,
    change_year_type_lookup: Optional[Dict[int, str]] = None,
    danger_year_has_new_signal_lookup: Optional[Dict[int, bool]] = None,
) -> List[Dict[str, Any]]:
    """
    Compute 10-year annual love forecast with cross-reference signals.

    Cross-references romanceGoodYears, romanceDangerYears, and marriageChangeYears
    to produce more accurate auspiciousness ratings. Deduplication logic ensures
    signals already counted in the base scoring (interactions, romance stars) are
    not double-counted from cross-reference subsystems.
    """
    # Guard against None
    good_year_type_lookup = good_year_type_lookup or {}
    danger_year_trigger_lookup = danger_year_trigger_lookup or {}
    change_year_type_lookup = change_year_type_lookup or {}
    danger_year_has_new_signal_lookup = danger_year_has_new_signal_lookup or {}
    dm_element = STEM_ELEMENT[day_master_stem]
    day_branch = pillars['day']['branch']

    if gender == 'male':
        spouse_element = ELEMENT_OVERCOMES[dm_element]
    else:
        spouse_element = ELEMENT_OVERCOME_BY[dm_element]

    forecasts: List[Dict[str, Any]] = []

    for star in annual_stars:
        year = star['year']
        if year < current_year or year >= current_year + 10:
            continue

        annual_branch = star['branch']
        annual_stem = star['stem']

        # Ten god of annual stem
        stem_tg = derive_ten_god(day_master_stem, annual_stem)
        stem_element = STEM_ELEMENT.get(annual_stem, '')
        stem_role = effective_gods.get(stem_element, '閒神')

        # Branch interactions with day branch
        interactions: List[str] = []
        is_void = annual_branch in kong_wang

        # 六合
        if HARMONY_LOOKUP.get(annual_branch) == day_branch:
            interactions.append('六合配偶宮')
        # 六沖
        if CLASH_LOOKUP.get(annual_branch) == day_branch:
            interactions.append('六沖配偶宮')
        # 六害
        if HARM_LOOKUP.get(annual_branch) == day_branch:
            interactions.append('六害配偶宮')
        # 三刑 — shared helper requiring all 3 branches for 3-branch groups
        all_br = {pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')} | {annual_branch}
        sanxing_hit = check_sanxing_with_pool(annual_branch, day_branch, all_br)
        if sanxing_hit:
            interactions.append(f'三刑（{sanxing_hit["name"]}）')

        # Romance stars
        hongluan_branch = HONGLUAN.get(year_branch_from_stars(annual_stars, year), '')
        taohua_branch = TAOHUA.get(day_branch, '')
        has_romance_star = (
            annual_branch == hongluan_branch
            or annual_branch == taohua_branch
            or annual_branch == TIANXI.get(year_branch_from_stars(annual_stars, year), '')
        )

        # Find active LP
        active_lp = _find_active_luck_period(luck_periods, year)
        lp_context = ''
        if active_lp:
            lp_tg = derive_ten_god(day_master_stem, active_lp.get('stem', ''))
            lp_context = f'{active_lp.get("stem", "")}{active_lp.get("branch", "")}（{lp_tg}）'

        # Cross-reference signals (deduplicated to avoid double-counting)
        # Good year: only count if the type is NOT already captured by has_romance_star
        # Star-based types (紅鸞*, 天喜*) are already counted by has_romance_star
        good_year_type = good_year_type_lookup.get(year, '')
        good_year_types = good_year_type.split('/') if good_year_type else []
        is_good_year_new_signal = (
            year in good_year_set
            and any(
                not any(prefix in t for prefix in STAR_BASED_GOOD_PREFIXES)
                for t in good_year_types
            )
        )
        # Danger year: only count if trigger is NOT already in interactions
        has_new_danger_signal = danger_year_has_new_signal_lookup.get(year, False)

        # Auspiciousness (7 levels)
        positive_count = sum([
            stem_role in ('用神', '喜神'),
            '六合配偶宮' in interactions,
            has_romance_star,
            is_good_year_new_signal,
        ])
        negative_count = sum([
            stem_role in ('忌神', '仇神'),
            '六沖配偶宮' in interactions,
            '六害配偶宮' in interactions,
            any('三刑' in i for i in interactions),
            is_void,
            has_new_danger_signal,
        ])

        if positive_count >= 3 and negative_count == 0:
            auspiciousness = '大吉'
        elif positive_count >= 2 and negative_count == 0:
            auspiciousness = '吉'
        elif negative_count >= 3 and positive_count == 0:
            auspiciousness = '大凶'
        elif negative_count >= 2:
            auspiciousness = '凶'
        elif positive_count > negative_count:
            auspiciousness = '小吉'
        elif negative_count > positive_count:
            auspiciousness = '小凶'
        else:
            auspiciousness = '平'

        forecasts.append({
            'year': year,
            'stem': annual_stem,
            'branch': annual_branch,
            'stemTenGod': stem_tg,
            'stemRole': stem_role,
            'interactions': interactions,
            'hasRomanceStar': has_romance_star,
            'isVoid': is_void,
            'lpContext': lp_context,
            'auspiciousness': auspiciousness,
            'isGoodYear': year in good_year_set,
            'isDangerYear': year in danger_year_set,
            'isChangeYear': year in change_year_set,
            'goodYearType': good_year_type,
            'dangerYearTrigger': danger_year_trigger_lookup.get(year, ''),
            'changeYearType': change_year_type_lookup.get(year, ''),
        })

    return forecasts


def year_branch_from_stars(annual_stars: List[Dict], year: int) -> str:
    """Helper to get annual branch for a year from annual_stars list."""
    for s in annual_stars:
        if s['year'] == year:
            return s['branch']
    return ''


# ============================================================
# 11. Monthly Love Forecast (十二月感情運勢)
# ============================================================

def compute_monthly_love_forecast(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    effective_gods: Dict[str, str],
    monthly_stars: List[Dict],
    kong_wang: Optional[List[str]] = None,
    lp_context: str = '',
    current_year_branch: str = '',
) -> List[Dict[str, Any]]:
    """
    Compute 12-month love forecast with enriched scoring.

    Enhanced to parity with love annual forecast:
    - 7-level auspiciousness (大吉/吉/小吉/平/小凶/凶/大凶)
    - Romance star check (紅鸞/天喜/桃花 on monthly branch)
    - 空亡 check (month branch in kong_wang)
    - 伏吟 intensification (month branch == day branch)
    - Labeled branch interactions (六合配偶宮/六沖配偶宮/六害配偶宮)
    - 大運 context string (same for all 12 months, decade-level)

    Parameters:
        kong_wang: list of void branches for 空亡 check
        lp_context: pre-computed LP context string (same for all 12 months)
        current_year_branch: earthly branch of current year (for HONGLUAN/TIANXI rotation)
    """
    day_branch = pillars['day']['branch']

    # Pre-compute romance star branches
    # HONGLUAN and TIANXI rotate by year branch (current year, NOT natal year)
    # TAOHUA is fixed to day branch per classical 沐浴桃花 rules
    hongluan_branch = HONGLUAN.get(current_year_branch, '') if current_year_branch else ''
    tianxi_branch = TIANXI.get(current_year_branch, '') if current_year_branch else ''
    taohua_branch = TAOHUA.get(day_branch, '')

    forecasts: List[Dict[str, Any]] = []

    for star in monthly_stars:
        month = star.get('month', 0)
        month_branch = star.get('branch', '')
        month_stem = star.get('stem', '')

        stem_tg = derive_ten_god(day_master_stem, month_stem) if month_stem else ''
        stem_element = STEM_ELEMENT.get(month_stem, '')
        stem_role = effective_gods.get(stem_element, '閒神')

        # Branch interactions (labeled to match annual style)
        interactions: List[str] = []
        if HARMONY_LOOKUP.get(month_branch) == day_branch:
            interactions.append('六合配偶宮')
        if CLASH_LOOKUP.get(month_branch) == day_branch:
            interactions.append('六沖配偶宮')
        if HARM_LOOKUP.get(month_branch) == day_branch:
            interactions.append('六害配偶宮')
        # 伏吟 check (matching career monthly pattern)
        is_fuyin = (month_branch == day_branch)
        if is_fuyin:
            interactions.append('伏吟配偶宮')

        # Romance star check
        has_romance_star = month_branch in (hongluan_branch, taohua_branch, tianxi_branch)

        # 空亡 check
        is_void = month_branch in (kong_wang or [])

        # Count-based scoring (matching love annual pattern)
        positive_count = sum([
            stem_role in ('用神', '喜神'),
            '六合配偶宮' in interactions,
            has_romance_star,
        ])
        negative_count = sum([
            stem_role in ('忌神', '仇神'),
            '六沖配偶宮' in interactions,
            '六害配偶宮' in interactions,
            is_void,
        ])

        # Interaction-based modifiers (matching career monthly pattern)
        # 伏吟 intensifies: positive→more positive, negative→more negative
        if is_fuyin:
            if positive_count > negative_count:
                positive_count += 1  # Intensify good
            elif negative_count > positive_count:
                negative_count += 1  # Intensify bad

        # 7-level auspiciousness (same thresholds as love annual)
        if positive_count >= 3 and negative_count == 0:
            auspiciousness = '大吉'
        elif positive_count >= 2 and negative_count == 0:
            auspiciousness = '吉'
        elif negative_count >= 3 and positive_count == 0:
            auspiciousness = '大凶'
        elif negative_count >= 2:
            auspiciousness = '凶'
        elif positive_count > negative_count:
            auspiciousness = '小吉'
        elif negative_count > positive_count:
            auspiciousness = '小凶'
        else:
            auspiciousness = '平'

        forecasts.append({
            'month': month,
            'stem': month_stem,
            'branch': month_branch,
            'stemTenGod': stem_tg,
            'stemRole': stem_role,
            'interactions': interactions,
            'hasRomanceStar': has_romance_star,
            'isVoid': is_void,
            'lpContext': lp_context,
            'auspiciousness': auspiciousness,
        })

    return forecasts


# ============================================================
# Narrative Anchors
# ============================================================

def build_love_narrative_anchors(pre_analysis: Dict[str, Any]) -> Dict[str, str]:
    """
    Build per-section narrative anchor text for AI prompt injection.

    Anchors ensure AI narrates FROM deterministic data, not hallucinated content.
    """
    anchors: Dict[str, str] = {}

    # Personality anchor
    personality = pre_analysis.get('lovePersonality', {})
    archetype = personality.get('archetype', {})
    element_style = personality.get('elementStyle', {})
    # Add pillar personality to anchor
    pillar_p = personality.get('pillarPersonality', {})
    pillar_text = ''
    if 'year' in pillar_p:
        pillar_text += f'年干{pillar_p["year"]["tenGod"]}：原生家庭{pillar_p["year"]["archetype"]}型。'
    if 'month' in pillar_p:
        pillar_text += f'月干{pillar_p["month"]["tenGod"]}：社交面{pillar_p["month"]["archetype"]}型。'
    if 'hour' in pillar_p:
        pillar_text += f'時干{pillar_p["hour"]["tenGod"]}：內心面{pillar_p["hour"]["archetype"]}型。'

    anchors['love_personality'] = (
        f'戀愛性格：{archetype.get("label", "")}型'
        f'（{archetype.get("trait", "")}）。'
        f'日主{personality.get("dmElement", "")}行：{element_style.get("style", "")}。'
        f'{personality.get("strengthImpact", "")}。'
        f'{pillar_text}'
    )
    # Append dominant ten god overlay if present
    overlay = personality.get('dominantOverlay')
    if overlay:
        anchors['love_personality'] += (
            f'\n十神特徵：{overlay["trait"]}——{overlay["description"]} {overlay["loveImpact"]}'
        )

    # Peach blossom anchor
    peach = pre_analysis.get('peachBlossoms', {})
    pos_types = [p['type'] for p in peach.get('positive', [])]
    neg_types = [n['type'] for n in peach.get('negative', [])]
    anchors['peach_blossom_analysis'] = (
        f'正桃花：{", ".join(pos_types) if pos_types else "無"}。'
        f'爛桃花：{", ".join(neg_types) if neg_types else "無"}。'
        f'{peach.get("summary", "")}'
    )

    # Natal marriage anchor
    spouse = pre_analysis.get('spouseStarAnalysis', {})
    challenges = spouse.get('challenges', [])
    challenge_text = ''
    for c in challenges:
        ctype = c.get('type', '')
        if ctype == '傷官見官':
            buffer = '有財星化解' if c.get('hasFinancialBuffer') else '無化解'
            challenge_text += f'傷官見官（{c.get("severity", "")}，{buffer}）。'
        elif ctype == '比劫奪財':
            venting = '有食傷洩氣' if c.get('hasVentingFlow') else '無洩氣'
            challenge_text += f'比劫奪財（{c.get("severity", "")}，{venting}）。'
        elif ctype in ('官殺混雜', '財星混雜'):
            challenge_text += f'{ctype}。'

    hour_wealth_anchor = spouse.get('hourWealthNote', '')

    anchors['natal_marriage'] = (
        f'配偶星：{spouse.get("spouseStar", "")}，'
        f'可見度：{spouse.get("visibility", "")}，'
        f'角色：{spouse.get("spouseRole", "")}。'
        f'平衡：{spouse.get("balanceDescription", "")}。'
        f'{challenge_text}'
        f'{hour_wealth_anchor}'
    )

    # Partner matching anchor
    partner = pre_analysis.get('partnerRecommendations', {})
    fav = partner.get('favorablePrimary', [])
    avoid = partner.get('avoidance', [])
    seasons = partner.get('favorableSeasons', [])
    season_text = ''
    if seasons:
        season_parts = [
            f'{s.get("element", "")}({s.get("role", "")})→{s.get("season", "")}({s.get("months", "")})'
            for s in seasons
        ]
        season_text = f'喜用神配偶月份：{", ".join(season_parts)}。'

    def _fmt_avoid(a: Dict[str, Any]) -> str:
        """Format avoidance item: day-branch=鼠(六沖), year-branch=雞(年支六沖)."""
        prefix = '年支' if a.get('source') == 'year_branch' else ''
        return f'{a["zodiac"]}({prefix}{a["type"]})'

    anchors['partner_matching'] = (
        f'最佳生肖：{", ".join(fav) if fav else "無"}。'
        f'避開生肖：{", ".join(_fmt_avoid(a) for a in avoid) if avoid else "無"}。'
        f'{season_text}'
    )
    # Append secondary favorable zodiacs if present
    secondary = partner.get('favorableSecondary', [])
    if secondary:
        anchors['partner_matching'] += f'次選生肖：{"、".join(secondary)}。'

    # Spouse appearance anchor
    palace = pre_analysis.get('marriagePalace', {})
    anchors['spouse_appearance'] = (
        f'配偶宮：{palace.get("dayBranch", "")}（{palace.get("element", "")}行）。'
        f'十神：{palace.get("palaceTenGod", "")}。'
        f'性格：{palace.get("personalityArchetype", "")}。'
        f'外貌傾向：{palace.get("appearanceHint", "")}。'
        f'外貌等級：{palace.get("appearanceGrade", "")}（{palace.get("appearanceNote", "")}）。'
        f'十二長生：{palace.get("twelveStage", "")}。'
    )

    # Good years anchor
    good_years = pre_analysis.get('romanceGoodYears', [])
    if good_years:
        year_strs = [
            f'{y["year"]}({y.get("starType", "")},{y.get("dayun_context", "")})'
            for y in good_years[:10]
        ]
        anchors['romance_good_years'] = f'桃花運好年份：{", ".join(year_strs)}。'
        # Append conflicted-year warnings (P1 cross-reference)
        conflicted_years = [y for y in good_years if y.get('conflicted')]
        for cy in conflicted_years:
            anchors['romance_good_years'] += (
                f'\n注意：{cy["year"]}年既是{cy.get("starType", "")}，'
                f'{cy.get("conflicted_detail", "")}。'
            )
    else:
        anchors['romance_good_years'] = '近期無明顯桃花運好年份。'

    # Danger years anchor (with 空亡 note)
    danger_years = pre_analysis.get('romanceDangerYears', [])
    if danger_years:
        year_strs = [
            f'{d["year"]}({d["primaryTrigger"]}{"·空亡" if d.get("isKongWang") else ""})'
            for d in danger_years[:5]
        ]
        anchors['romance_danger_years'] = f'桃花劫年份：{", ".join(year_strs)}。'
    else:
        anchors['romance_danger_years'] = '近期無明顯桃花劫年份。'

    # Change years anchor (with significance label + 空亡 notes)
    # All change types are now negative (沖/刑/害 only), isConflicted removed
    change_years_data = pre_analysis.get('marriageChangeYears', [])
    if change_years_data:
        def _sig_label(c):
            sig = c.get('maxSignificance', 0)
            if sig >= 80:
                return '高'
            if sig >= 65:
                return '中'
            return '低'
        year_strs = [
            f'{c["year"]}({c.get("primaryChange", "")}·影響{_sig_label(c)}'
            f'{"·空亡" if c.get("isKongWang") else ""})'
            for c in change_years_data[:5]
        ]
        anchors['marriage_change_years'] = f'感情易變年份：{", ".join(year_strs)}。'
    else:
        anchors['marriage_change_years'] = '近期無明顯感情變化年份。'

    # Annual love forecast anchors (per-year cross-reference data)
    annual_data = pre_analysis.get('annualForecasts', [])
    if annual_data:
        year_anchors = []
        for af in annual_data:
            parts = [
                f'⚠️ {af["year"]}年：吉凶={af["auspiciousness"]}',
                f'天干角色={af.get("stemRole", "")}',
                f'大運={af.get("lpContext", "")}',
            ]
            if af.get('isGoodYear'):
                parts.append(f'桃花={af.get("goodYearType", "")}')
            if af.get('isDangerYear'):
                parts.append(f'桃花劫={af.get("dangerYearTrigger", "")}')
            if af.get('isChangeYear'):
                parts.append(f'變動={af.get("changeYearType", "")}')
            if af.get('isVoid'):
                parts.append('空亡年')
            ints = af.get('interactions', [])
            if ints:
                parts.append(f'互動={"、".join(ints)}')
            year_anchors.append(', '.join(parts))
        anchors['annual_love_forecasts'] = '\n'.join(year_anchors)
    else:
        anchors['annual_love_forecasts'] = '（無年度預測數據）'

    # Monthly love forecast anchors (per-month data for AI guidance)
    monthly_data = pre_analysis.get('monthlyForecasts', [])
    if monthly_data:
        month_anchors = []
        for mf in monthly_data:
            parts = [
                f'{mf["month"]}月：吉凶={mf["auspiciousness"]}',
                f'天干角色={mf.get("stemRole", "")}',
            ]
            if mf.get('hasRomanceStar'):
                parts.append('桃花月')
            if mf.get('isVoid'):
                parts.append('空亡月')
            ints = mf.get('interactions', [])
            if ints:
                parts.append(f'互動={"、".join(ints)}')
            month_anchors.append(', '.join(parts))
        anchors['monthly_love_forecasts'] = '\n'.join(month_anchors)
    else:
        anchors['monthly_love_forecasts'] = '（無月度預測數據）'

    # Summary anchor
    timing = pre_analysis.get('marriageTimingIndicators', {})
    early = timing.get('earlySignals', [])
    late = timing.get('lateSignals', [])
    anchors['love_summary'] = (
        f'早婚指標：{", ".join(early) if early else "無"}。'
        f'晚婚指標：{", ".join(late) if late else "無"}。'
    )

    return anchors


# ============================================================
# Master Orchestrator
# ============================================================

def generate_love_pre_analysis(
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
    all_shen_sha: List[Dict],
    branch_relationships: Optional[Dict] = None,
    birth_year: int = 0,
    current_year: int = 2026,
) -> Dict[str, Any]:
    """
    Generate all love/marriage pre-analysis data.

    Master orchestrator that calls all 11 love-specific functions
    and assembles the complete pre-analysis dict.
    """
    # Normalize effective_gods format
    effective_gods = _normalize_effective_gods(effective_gods)

    day_branch = pillars['day']['branch']
    year_branch = pillars['year']['branch']

    # Enrich luck periods
    enriched_lps = _enrich_luck_periods(
        luck_periods, day_master_stem, gender, effective_gods,
    )

    # 1. Peach Blossom Classification
    peach_blossoms = classify_peach_blossoms(
        pillars, day_master_stem, day_branch, year_branch,
        effective_gods, gender,
    )

    # 2. Spouse Star Analysis
    spouse_star = compute_spouse_star_analysis(
        pillars, day_master_stem, gender, effective_gods, strength_v2,
    )

    # 3. Marriage Palace Analysis
    marriage_palace = compute_marriage_palace_analysis(
        pillars, day_master_stem, kong_wang,
    )

    # 4. Love Personality
    love_personality = compute_love_personality(
        pillars, day_master_stem, gender, effective_gods,
        strength_v2, all_shen_sha,
    )

    # 5. Marriage Timing Indicators
    timing_indicators = compute_marriage_timing_indicators(
        pillars, day_master_stem, gender, effective_gods,
        all_shen_sha, luck_periods,
    )

    # 5b. Inject activeLuckPeriod from enriched_lps (for {{loveActiveLuckPeriod}} header)
    active_lp = _find_active_luck_period(enriched_lps, current_year)
    if active_lp:
        timing_indicators['activeLuckPeriod'] = {
            'stem': active_lp.get('stem', ''),
            'branch': active_lp.get('branch', ''),
            'startYear': active_lp.get('startYear', 0),
            'endYear': active_lp.get('endYear', 0),
            'tenGod': active_lp.get('tenGod', ''),
        }

    # 6. Romance Good Years
    romance_good = compute_romance_good_years(
        gender, day_master_stem, day_branch, year_branch,
        annual_stars, kong_wang, birth_year, current_year,
        enriched_lps,
    )

    # 7. Romance Danger Years
    romance_danger = compute_romance_danger_years(
        pillars, day_master_stem, day_branch,
        annual_stars, kong_wang, current_year,
    )

    # Cross-reference: flag years that appear in BOTH good and danger lists
    # Note: romance_danger never contains duplicate years because annual_stars has
    # one entry per year and the year-range filter prevents overlap.
    # MUST run before build_love_narrative_anchors() so anchors see updated conflicted flags.
    danger_year_map = {d['year']: d for d in romance_danger}
    for item in romance_good:
        if item['year'] in danger_year_map:
            d = danger_year_map[item['year']]
            item['conflicted'] = True
            all_triggers = [t['type'] for t in d.get('triggers', [])]
            trigger_text = '、'.join(all_triggers) if all_triggers else d.get('primaryTrigger', '')
            item['conflicted_detail'] = (
                f'但同年也有{trigger_text}風險，'
                f'桃花機會與感情風險並存，需格外謹慎分辨'
            )

    # 8. Marriage Change Years (caution-only: 沖/刑/害)
    natal_br_list = [pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')]
    marriage_changes = compute_marriage_change_years(
        day_branch, annual_stars, kong_wang, current_year,
        natal_branches=natal_br_list,
    )

    # 9. Partner Recommendations
    partner_recs = compute_partner_recommendations(
        day_branch, year_branch, effective_gods,
    )

    # 10. Annual Love Forecast (5 years) — with cross-reference signals
    # Build year sets and type lookups for deduplication-aware scoring
    good_year_set = frozenset(y['year'] for y in romance_good)
    danger_year_set = frozenset(d['year'] for d in romance_danger)
    change_year_set = frozenset(c['year'] for c in marriage_changes)

    # Good year type lookup: year → joined starType string (e.g., '桃花合年/天喜桃花年')
    _good_type_map: Dict[int, List[str]] = {}
    for y in romance_good:
        _good_type_map.setdefault(y['year'], []).append(y.get('starType', ''))
    good_year_type_lookup = {yr: '/'.join(types) for yr, types in _good_type_map.items()}

    # Danger year lookups
    danger_year_trigger_lookup = {d['year']: d['primaryTrigger'] for d in romance_danger}
    # Has new signal = any trigger NOT already in the base interactions check
    danger_year_has_new_signal_lookup = {
        d['year']: any(
            t['type'] not in INTERACTION_BASED_DANGERS
            for t in d.get('triggers', [])
        )
        for d in romance_danger
    }

    # Change year type lookup
    change_year_type_lookup = {c['year']: c['primaryChange'] for c in marriage_changes}

    annual_forecast = compute_annual_love_forecast(
        pillars, day_master_stem, gender, effective_gods,
        luck_periods, annual_stars, kong_wang, current_year,
        good_year_set=good_year_set,
        danger_year_set=danger_year_set,
        change_year_set=change_year_set,
        good_year_type_lookup=good_year_type_lookup,
        danger_year_trigger_lookup=danger_year_trigger_lookup,
        change_year_type_lookup=change_year_type_lookup,
        danger_year_has_new_signal_lookup=danger_year_has_new_signal_lookup,
    )

    # 11. Monthly Love Forecast — with enriched scoring (空亡, romance stars, 大運 context)
    # Extract LP context from annual forecast (same for all months in a year)
    monthly_lp_context = ''
    if annual_forecast:
        monthly_lp_context = annual_forecast[0].get('lpContext', '')
    elif luck_periods:
        # Fallback: compute LP context directly when annual forecast is empty
        active_lp = _find_active_luck_period(luck_periods, current_year)
        if active_lp:
            lp_stem = active_lp.get('stem', '')
            lp_branch = active_lp.get('branch', '')
            lp_tg = derive_ten_god(day_master_stem, lp_stem) if lp_stem else ''
            monthly_lp_context = f'{lp_stem}{lp_branch}（{lp_tg}）'

    # Extract current year branch for romance star lookups (HONGLUAN/TIANXI rotate yearly)
    current_year_branch = ''
    for star in annual_stars:
        if star['year'] == current_year:
            current_year_branch = star['branch']
            break

    monthly_forecast = compute_monthly_love_forecast(
        pillars, day_master_stem, gender, effective_gods, monthly_stars,
        kong_wang=kong_wang,
        lp_context=monthly_lp_context,
        current_year_branch=current_year_branch,
    )

    # Assemble pre-analysis
    pre_analysis = {
        'peachBlossoms': peach_blossoms,
        'spouseStarAnalysis': spouse_star,
        'marriagePalace': marriage_palace,
        'lovePersonality': love_personality,
        'marriageTimingIndicators': timing_indicators,
        'romanceGoodYears': romance_good,
        'romanceDangerYears': romance_danger,
        'marriageChangeYears': marriage_changes,
        'partnerRecommendations': partner_recs,
        'annualForecasts': annual_forecast,
        'monthlyForecasts': monthly_forecast,
    }

    # Build narrative anchors
    anchors = build_love_narrative_anchors(pre_analysis)
    pre_analysis['narrativeAnchors'] = anchors

    # Deterministic section for frontend rendering
    pre_analysis['deterministic'] = {
        'peach_blossoms': {
            'positive_count': peach_blossoms['totalPositive'],
            'negative_count': peach_blossoms['totalNegative'],
            'positive_types': [p['type'] for p in peach_blossoms['positive']],
            'negative_types': [n['type'] for n in peach_blossoms['negative']],
            'summary': peach_blossoms['summary'],
        },
        'spouse_star': {
            'star': spouse_star['spouseStar'],
            'visibility': spouse_star['visibility'],
            'role': spouse_star['spouseRole'],
            'balance': spouse_star['balance'],
            'balance_desc': spouse_star['balanceDescription'],
            'challenges': [c['type'] for c in spouse_star['challenges']],
            'hour_wealth_note': spouse_star.get('hourWealthNote', ''),
        },
        'marriage_palace': {
            'day_branch': marriage_palace['dayBranch'],
            'element': marriage_palace['element'],
            'ten_god': marriage_palace['palaceTenGod'],
            'twelve_stage': marriage_palace['twelveStage'],
            'is_kong_wang': marriage_palace['isKongWang'],
            'appearance_grade': marriage_palace.get('appearanceGrade', ''),
            'appearance_note': marriage_palace.get('appearanceNote', ''),
        },
        'partner_recommendations': {
            'favorable': partner_recs['favorablePrimary'],
            'favorable_secondary': partner_recs.get('favorableSecondary', []),
            'avoidance': [a['zodiac'] for a in partner_recs['avoidance']],
            'favorable_seasons': [
                {'element': s['element'], 'role': s['role'], 'season': s['season'], 'months': s['months']}
                for s in partner_recs.get('favorableSeasons', [])
            ],
        },
        'romance_timeline': {
            'good_years': [
                    {
                        'year': y['year'],
                        'type': y.get('starType', ''),
                        'conflicted': y.get('conflicted', False),
                        'conflicted_detail': y.get('conflicted_detail', ''),
                    }
                    for y in romance_good[:10]
                ],
            'danger_years': [{'year': d['year'], 'trigger': d['primaryTrigger']} for d in romance_danger[:10]],
            'change_years': [{'year': c['year'], 'type': c['primaryChange']} for c in marriage_changes[:10]],
        },
        'love_personality': {
            'archetypeLabel': love_personality['archetype']['label'],
            'archetypeTrait': love_personality['archetype']['trait'],
            'elementStyle': love_personality['elementStyle']['style'],
            'strengthClass': love_personality['strengthClass'],
            'dominantTenGod': (love_personality.get('dominantOverlay') or {}).get('dominantTenGod', love_personality.get('dominantTenGod', '')),
            'dominantCount': (love_personality.get('dominantOverlay') or {}).get('count', 0),
        },
        'timing_indicators': {
            'earlySignals': timing_indicators.get('earlySignals', []),
            'lateSignals': timing_indicators.get('lateSignals', []),
        },
        'annual_forecasts': [
            {
                'year': af['year'],
                'stem': af.get('stem', ''),
                'branch': af.get('branch', ''),
                'auspiciousness': af['auspiciousness'],
                'stemRole': af.get('stemRole', ''),
                'stemTenGod': af.get('stemTenGod', ''),
                'hasRomanceStar': af.get('hasRomanceStar', False),
                'lpContext': af.get('lpContext', ''),
                'isGoodYear': af.get('isGoodYear', False),
                'goodYearType': af.get('goodYearType', ''),
                'isDangerYear': af.get('isDangerYear', False),
                'dangerYearTrigger': af.get('dangerYearTrigger', ''),
                'isChangeYear': af.get('isChangeYear', False),
                'changeYearType': af.get('changeYearType', ''),
                'isVoid': af.get('isVoid', False),
                'interactions': af.get('interactions', []),
            }
            for af in annual_forecast
        ],
        'monthly_forecasts': [
            {
                'month': mf['month'],
                'stem': mf.get('stem', ''),
                'branch': mf.get('branch', ''),
                'auspiciousness': mf['auspiciousness'],
                'stemRole': mf.get('stemRole', ''),
                'stemTenGod': mf.get('stemTenGod', ''),
                'hasRomanceStar': mf.get('hasRomanceStar', False),
                'isVoid': mf.get('isVoid', False),
                'interactions': mf.get('interactions', []),
                'lpContext': mf.get('lpContext', ''),
            }
            for mf in monthly_forecast
        ],
        'active_luck_period': timing_indicators.get('activeLuckPeriod'),
    }

    return pre_analysis
