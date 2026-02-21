"""
Enhanced Bazi Compatibility (合盤) Engine — 8-Dimension Scoring

Compares two Bazi charts across 8 dimensions with sigmoid amplification,
knockout conditions, and comparison-type-specific weighting.

Reviewed and approved by 3 expert agents across 3 rounds:
- Bazi Domain Expert, Algorithm Engineer, Bazi Accuracy Validator

Architecture:
  - Each dimension has a dedicated scoring function returning raw 0-100
  - Sigmoid amplification compresses neutral zone, expands extremes
  - Knockout conditions apply post-aggregation bonuses/penalties
  - Final score clamped to [5, 99]
"""

import math
from typing import Any, Dict, List, Optional, Tuple

from .compatibility_constants import (
    COMPATIBILITY_LABELS,
    CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT,
    CROSS_PILLAR_BRANCH_WEIGHTS,
    CROSS_PILLAR_STEM_DEFAULT_WEIGHT,
    CROSS_PILLAR_STEM_WEIGHTS,
    DAY_STEM_INTERACTION_SCORES,
    GOD_ROLE_INDEX,
    GOD_ROLES,
    KNOCKOUT_CROSS_SANHE_YONGSHEN_BONUS,
    KNOCKOUT_GUCHEN_GUASU_BOTH_PENALTY,
    KNOCKOUT_GUAN_SHA_HUN_ZA_PENALTY,
    KNOCKOUT_BOTH_UNSTABLE_PALACE_PENALTY,
    KNOCKOUT_BOTH_YINYANG_CUOCUO_PENALTY,
    KNOCKOUT_IDENTICAL_CHART_PENALTY,
    KNOCKOUT_LIUCHONG_MODERATE_PENALTY,
    KNOCKOUT_ONE_UNSTABLE_PALACE_PENALTY,
    KNOCKOUT_LIUCHONG_ZIWU_PENALTY,
    KNOCKOUT_SHANG_GUAN_JIAN_GUAN_PENALTY,
    KNOCKOUT_TIANHE_DIHE_BONUS,
    KNOCKOUT_TIANGAN_WUHE_ADVERSE_PENALTY,
    KNOCKOUT_TIANGAN_WUHE_BONUS,
    KNOCKOUT_TIAN_KE_DI_CHONG_HARD_FLOOR,
    KNOCKOUT_TIAN_KE_DI_CHONG_PENALTY,
    KNOCKOUT_YONGSHEN_CONFLICT_PENALTY,
    LIUCHONG_SEVERITY,
    LIUHE_RESULT_ELEMENT,
    SELF_PUNISHMENT_BRANCHES,
    SHEN_SHA_GUCHEN_GUASU_BOTH,
    SHEN_SHA_GUCHEN_GUASU_ONE,
    SHEN_SHA_HONG_LUAN_TIAN_XI_SYNC,
    SHEN_SHA_HUAGAI_FRIENDSHIP_BUSINESS,
    SHEN_SHA_HUAGAI_ROMANCE,
    SHEN_SHA_NEUTRAL_DEFAULT,
    SHEN_SHA_TAOHUA_CROSS_MATCH,
    SHEN_SHA_TAOHUA_HONGLUAN_COMBO,
    SHEN_SHA_TIAN_DE_YUE_DE_MUTUAL,
    SHEN_SHA_TIAN_YI_CROSS_MATCH,
    SHEN_SHA_YIMA_BOTH,
    SIGMOID_MIDPOINT,
    SIGMOID_STEEPNESS,
    SPECIAL_LABEL_MING_ZHONG_ZHU_DING,
    SPECIAL_LABEL_QIAN_SHI_YUAN_JIA,
    SPECIAL_LABEL_XIANG_AI_XIANG_SHA,
    STEM_COMBINATION_BUSINESS_SCORE,
    STEM_COMBINATION_ROMANCE_SCORES,
    TEN_GOD_ROMANCE_SCORES,
    TIANDE_DAY_PILLAR_MITIGATION,
    TIANDE_MAX_MITIGATION,
    TIANDE_MONTH_PILLAR_MITIGATION,
    TIANDE_YEAR_HOUR_PILLAR_MITIGATION,
    TIMING_BOTH_BAD,
    TIMING_BOTH_GOOD,
    TIMING_BOTH_NEUTRAL,
    TIMING_IMBALANCED,
    WEIGHT_TABLE,
    YONGSHEN_MATRIX,
    YONGSHEN_RAW_MAX,
    YONGSHEN_RAW_MIN,
    YONGSHEN_ADVERSE_THRESHOLD,
    YONGSHEN_RANGE,
)
from .constants import (
    ELEMENT_OVERCOMES,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    FIVE_ELEMENTS,
    STEM_ELEMENT,
    STEM_YINYANG,
)
from .stem_combinations import STEM_CLASH_LOOKUP, STEM_COMBINATION_LOOKUP
from .ten_gods import derive_ten_god


# ============================================================
# Utility Functions
# ============================================================

def sigmoid_amplify(raw: float, midpoint: float = SIGMOID_MIDPOINT,
                    steepness: float = SIGMOID_STEEPNESS) -> float:
    """Map [0,100] to [0,100] with amplified extremes and compressed neutral zone.

    Uses logistic sigmoid with post-stretch to fill the full [0,100] range.
    At steepness=0.10, input range [35,65] maps to [27,88].
    """
    sigmoid_out = 100 / (1 + math.exp(-steepness * (raw - midpoint)))
    floor = 100 / (1 + math.exp(-steepness * (0 - midpoint)))
    ceil = 100 / (1 + math.exp(-steepness * (100 - midpoint)))
    stretched = (sigmoid_out - floor) / (ceil - floor) * 100
    return max(0.0, min(100.0, stretched))


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _get_element_role_in_chart(element: str, effective_gods: Dict[str, str]) -> str:
    """Find which god role (usefulGod, favorableGod, etc.) an element plays in a chart."""
    for role in GOD_ROLES:
        if effective_gods.get(role) == element:
            return role
    return 'idleGod'  # Fallback — shouldn't happen with valid data


def _get_shen_sha_by_name(shen_sha_list: List[Dict], name: str) -> List[Dict]:
    """Get all shen sha entries with a specific name from a chart's shen sha list."""
    return [ss for ss in shen_sha_list if ss.get('name') == name]


def _has_shen_sha(shen_sha_list: List[Dict], name: str) -> bool:
    return any(ss.get('name') == name for ss in shen_sha_list)


def _get_shen_sha_in_pillar(shen_sha_list: List[Dict], name: str, pillar: str) -> bool:
    return any(ss.get('name') == name and ss.get('pillar') == pillar
               for ss in shen_sha_list)


# ============================================================
# Dimension 1: 用神互補 (5-God Matrix Scoring)
# ============================================================

def score_yongshen_complementarity(
    pre_analysis_a: Dict,
    pre_analysis_b: Dict,
) -> Dict:
    """Score 用神互補 using the 5-god interaction matrix.

    For each of 5 elements, look up A's god role and B's god role,
    then sum the matrix scores. Normalize to 0-100.

    Returns:
        Dict with rawScore, normalized score, findings, and flags.
    """
    gods_a = pre_analysis_a.get('effectiveFavorableGods', {})
    gods_b = pre_analysis_b.get('effectiveFavorableGods', {})

    # Build element→role mapping for each chart
    element_role_a = {}
    element_role_b = {}
    for role in GOD_ROLES:
        elem_a = gods_a.get(role)
        elem_b = gods_b.get(role)
        if elem_a:
            element_role_a[elem_a] = role
        if elem_b:
            element_role_b[elem_b] = role

    raw_score = 0
    findings = []
    shared_jishen = False

    for element in FIVE_ELEMENTS:
        role_a = element_role_a.get(element, 'idleGod')
        role_b = element_role_b.get(element, 'idleGod')
        idx_a = GOD_ROLE_INDEX.get(role_a, 2)  # Default to 閒神
        idx_b = GOD_ROLE_INDEX.get(role_b, 2)
        cell_score = YONGSHEN_MATRIX[idx_a][idx_b]
        raw_score += cell_score

        if abs(cell_score) >= 30:
            findings.append({
                'element': element,
                'roleA': role_a,
                'roleB': role_b,
                'score': cell_score,
                'significance': 'high' if abs(cell_score) >= 40 else 'medium',
            })

        if role_a == 'tabooGod' and role_b == 'tabooGod':
            shared_jishen = True

    # Normalize to 0-100
    normalized = (raw_score - YONGSHEN_RAW_MIN) / YONGSHEN_RANGE * 100
    normalized = clamp(normalized, 0, 100)

    # Check confidence level
    classification_a = pre_analysis_a.get('classification', '')
    classification_b = pre_analysis_b.get('classification', '')
    is_neutral = classification_a == 'neutral' or classification_b == 'neutral'
    is_cong_ge = bool(pre_analysis_a.get('congGe')) or bool(pre_analysis_b.get('congGe'))

    return {
        'rawScore': round(normalized, 1),
        'rawYongshenScore': raw_score,
        'findings': findings,
        'yongshenConfidence': 'low' if is_neutral else 'high',
        'congGeAffectsYongshen': is_cong_ge,
        'sharedJishenRisk': shared_jishen,
        'isNeutralChart': is_neutral,
    }


# ============================================================
# Dimension 2: 日柱天干關係 (Day Stem Relationship)
# ============================================================

def score_day_stem_relationship(
    stem_a: str,
    stem_b: str,
    pre_analysis_a: Dict,
    pre_analysis_b: Dict,
    comparison_type: str = 'romance',
) -> Dict:
    """Score the day stem relationship between two charts.

    Checks for: 天干五合 (with combination-specific scores), 天干七沖,
    相生, 相克, 比和, and no relationship.

    Returns:
        Dict with rawScore, combination details, and flags.
    """
    findings = []
    combination_name = None
    din_ren_warning = False
    hua_hua_quality = None

    # Check 天干五合
    combo = STEM_COMBINATION_LOOKUP.get(stem_a)
    if combo and combo[0] == stem_b:
        partner, result_element, comb_name = combo
        combination_name = comb_name

        if comparison_type == 'business':
            score = STEM_COMBINATION_BUSINESS_SCORE
        else:
            score = STEM_COMBINATION_ROMANCE_SCORES.get(comb_name, 85)

        # 合化 quality assessment
        gods_a = pre_analysis_a.get('effectiveFavorableGods', {})
        gods_b = pre_analysis_b.get('effectiveFavorableGods', {})
        is_a_yongshen = gods_a.get('usefulGod') == result_element
        is_b_yongshen = gods_b.get('usefulGod') == result_element
        is_a_jishen = gods_a.get('tabooGod') == result_element
        is_b_jishen = gods_b.get('tabooGod') == result_element

        if is_a_yongshen and is_b_yongshen:
            score = min(100, score + 5)
            hua_hua_quality = 'best'
        elif is_a_jishen or is_b_jishen:
            score = round(score * 0.7)
            hua_hua_quality = 'harmful'
        else:
            hua_hua_quality = 'neutral'

        if comb_name == '淫慝之合' and comparison_type == 'romance':
            din_ren_warning = True

        findings.append({
            'type': '天干五合',
            'detail': f'{stem_a}{stem_b}合化{result_element}',
            'combinationName': comb_name,
            'huaHuaQuality': hua_hua_quality,
        })
    else:
        # Check 天干七沖
        clash = STEM_CLASH_LOOKUP.get(stem_a)
        if clash and clash == stem_b:
            score = DAY_STEM_INTERACTION_SCORES['stem_clash']
            findings.append({'type': '天干七沖', 'detail': f'{stem_a}{stem_b}沖'})
        else:
            # Check element relationship
            elem_a = STEM_ELEMENT[stem_a]
            elem_b = STEM_ELEMENT[stem_b]
            yy_a = STEM_YINYANG[stem_a]
            yy_b = STEM_YINYANG[stem_b]

            if elem_a == elem_b and stem_a == stem_b:
                score = DAY_STEM_INTERACTION_SCORES['identical']
                findings.append({'type': '同柱', 'detail': f'同為{stem_a}'})
            elif elem_a == elem_b:
                score = DAY_STEM_INTERACTION_SCORES['same_element']
                findings.append({'type': '比和', 'detail': f'{stem_a}{stem_b}同屬{elem_a}'})
            elif ELEMENT_PRODUCES.get(elem_a) == elem_b or ELEMENT_PRODUCES.get(elem_b) == elem_a:
                score = DAY_STEM_INTERACTION_SCORES['production']
                findings.append({'type': '相生', 'detail': f'{elem_a}與{elem_b}相生'})
            elif ELEMENT_OVERCOMES.get(elem_a) == elem_b or ELEMENT_OVERCOMES.get(elem_b) == elem_a:
                score = DAY_STEM_INTERACTION_SCORES['overcoming']
                findings.append({'type': '相克', 'detail': f'{elem_a}與{elem_b}相克'})
            else:
                score = DAY_STEM_INTERACTION_SCORES['no_relation']

    return {
        'rawScore': score,
        'findings': findings,
        'combinationName': combination_name,
        'dinRenWarning': din_ren_warning,
        'huaHuaQuality': hua_hua_quality,
    }


# ============================================================
# Dimension 3: 日支配偶宮 (Spouse Palace) + 天合地合 Detection
# ============================================================

def detect_tianhe_dihe(
    day_stem_a: str, day_branch_a: str,
    day_stem_b: str, day_branch_b: str,
) -> Dict:
    """Detect 天合地合 — both stems combine AND both branches combine.

    This is the highest grade of compatibility (~1.7% probability).
    """
    # Check stem combination
    combo = STEM_COMBINATION_LOOKUP.get(day_stem_a)
    stem_combines = combo is not None and combo[0] == day_stem_b

    # Check branch 六合
    branch_combines = LIUHE_RESULT_ELEMENT.get((day_branch_a, day_branch_b)) is not None

    detected = stem_combines and branch_combines

    result = {'detected': detected}
    if detected:
        _, result_elem, comb_name = combo
        branch_result_elem = LIUHE_RESULT_ELEMENT.get((day_branch_a, day_branch_b), '')
        result['description'] = (
            f'天合地合 — 日柱{day_stem_a}{day_branch_a}與{day_stem_b}{day_branch_b}，'
            f'天干{day_stem_a}{day_stem_b}合+地支{day_branch_a}{day_branch_b}合'
        )
        result['stemCombinationName'] = comb_name
        result['stemResultElement'] = result_elem
        result['branchResultElement'] = branch_result_elem
    return result


def score_spouse_palace(
    day_branch_a: str,
    day_branch_b: str,
    day_stem_a: str,
    day_stem_b: str,
    all_branches_a: List[str],
    all_branches_b: List[str],
    shen_sha_a: List[Dict],
    shen_sha_b: List[Dict],
    pre_analysis_a: Dict,
    pre_analysis_b: Dict,
) -> Dict:
    """Score the spouse palace (日支配偶宮) interaction.

    Checks: 六合, 六沖 (severity-differentiated), 六害, 三合, 三刑,
    天剋地沖, and no interaction. Applies 天德/月德 mitigation.
    """
    findings = []
    score = 50  # Neutral baseline

    gods_a = pre_analysis_a.get('effectiveFavorableGods', {})
    gods_b = pre_analysis_b.get('effectiveFavorableGods', {})
    tian_ke_di_chong = False

    # Check 天剋地沖 (stem overcomes + branch clashes)
    elem_stem_a = STEM_ELEMENT.get(day_stem_a, '')
    elem_stem_b = STEM_ELEMENT.get(day_stem_b, '')
    stem_overcomes = (ELEMENT_OVERCOMES.get(elem_stem_a) == elem_stem_b or
                      ELEMENT_OVERCOMES.get(elem_stem_b) == elem_stem_a)
    branch_clashes = LIUCHONG_SEVERITY.get((day_branch_a, day_branch_b)) is not None

    if stem_overcomes and branch_clashes:
        score = 5
        tian_ke_di_chong = True
        findings.append({
            'type': '天剋地沖',
            'detail': f'{day_stem_a}{day_branch_a}與{day_stem_b}{day_branch_b}天剋地沖',
            'severity': 'critical',
        })
    elif LIUHE_RESULT_ELEMENT.get((day_branch_a, day_branch_b)) is not None:
        # 六合 — conditional scoring based on 合化 element
        result_elem = LIUHE_RESULT_ELEMENT[(day_branch_a, day_branch_b)]
        is_a_yongshen = gods_a.get('usefulGod') == result_elem or gods_a.get('favorableGod') == result_elem
        is_b_yongshen = gods_b.get('usefulGod') == result_elem or gods_b.get('favorableGod') == result_elem
        is_a_jishen = gods_a.get('tabooGod') == result_elem or gods_a.get('enemyGod') == result_elem
        is_b_jishen = gods_b.get('tabooGod') == result_elem or gods_b.get('enemyGod') == result_elem

        if is_a_yongshen or is_b_yongshen:
            score = 95
            findings.append({'type': '六合', 'detail': f'{day_branch_a}{day_branch_b}合化{result_elem}（用神元素）', 'quality': 'beneficial'})
        elif is_a_jishen or is_b_jishen:
            score = 70
            findings.append({'type': '六合', 'detail': f'{day_branch_a}{day_branch_b}合化{result_elem}（忌神元素）', 'quality': 'harmful'})
        else:
            score = 85
            findings.append({'type': '六合', 'detail': f'{day_branch_a}{day_branch_b}合化{result_elem}', 'quality': 'neutral'})
    elif LIUCHONG_SEVERITY.get((day_branch_a, day_branch_b)) is not None:
        # 六沖 — severity-differentiated
        severity = LIUCHONG_SEVERITY[(day_branch_a, day_branch_b)]
        score = max(5, 100 - severity)
        findings.append({
            'type': '六沖',
            'detail': f'{day_branch_a}{day_branch_b}沖',
            'severity_value': severity,
        })
    elif day_branch_a == day_branch_b:
        # Same branch — check self-punishment
        if day_branch_a in SELF_PUNISHMENT_BRANCHES:
            score = 35  # Cross-chart self-punishment is milder
            findings.append({'type': '自刑', 'detail': f'{day_branch_a}{day_branch_b}自刑'})
        else:
            # 日支伏吟 — same day branch
            score = 45
            findings.append({'type': '日支伏吟', 'detail': f'配偶宮同為{day_branch_a}'})
    else:
        # Check 六害
        from .compatibility import SIX_HARMS
        if SIX_HARMS.get(day_branch_a) == day_branch_b:
            score = 30
            findings.append({'type': '六害', 'detail': f'{day_branch_a}{day_branch_b}害'})
        else:
            # Check 三合 with cross-chart branches
            from .compatibility import THREE_HARMONIES
            for b1, b2, b3, elem in THREE_HARMONIES:
                trio = {b1, b2, b3}
                if day_branch_a in trio and day_branch_b in trio:
                    # Check if the third branch exists in either chart
                    needed = trio - {day_branch_a, day_branch_b}
                    if needed:
                        needed_branch = needed.pop()
                        if needed_branch in all_branches_a or needed_branch in all_branches_b:
                            score = 70
                            findings.append({
                                'type': '三合',
                                'detail': f'{day_branch_a}{day_branch_b}與{needed_branch}三合{elem}',
                                'resultElement': elem,
                            })
                            break

    # 天德/月德 mitigation (only for negative scores)
    tian_de_mitigation = 0.0
    if score < 50 and not tian_ke_di_chong:
        tian_de_mitigation = _calculate_tiande_mitigation(shen_sha_a, shen_sha_b)
        if tian_de_mitigation > 0:
            deficit = 50 - score
            score = score + deficit * tian_de_mitigation
            findings.append({
                'type': '天德月德化解',
                'detail': f'天德/月德減緩負面影響{round(tian_de_mitigation * 100)}%',
            })

    return {
        'rawScore': round(clamp(score, 0, 100), 1),
        'findings': findings,
        'tianKeDiChong': tian_ke_di_chong,
        'tianDeMitigation': round(tian_de_mitigation, 2),
    }


def _calculate_tiande_mitigation(shen_sha_a: List[Dict], shen_sha_b: List[Dict]) -> float:
    """Calculate 天德/月德 mitigation level based on pillar position.

    Day pillar: 25%, Month pillar: 17%, Year/Hour: 12%.
    Both persons having it: combine effects, cap at 40%.
    """
    total = 0.0
    for ss_list in [shen_sha_a, shen_sha_b]:
        best_for_person = 0.0
        for ss in ss_list:
            if ss.get('name') in ('天德', '月德', '天德貴人', '月德貴人'):
                pillar = ss.get('pillar', '')
                if pillar == 'day':
                    best_for_person = max(best_for_person, TIANDE_DAY_PILLAR_MITIGATION)
                elif pillar == 'month':
                    best_for_person = max(best_for_person, TIANDE_MONTH_PILLAR_MITIGATION)
                else:
                    best_for_person = max(best_for_person, TIANDE_YEAR_HOUR_PILLAR_MITIGATION)
        total += best_for_person

    return min(total, TIANDE_MAX_MITIGATION)


# ============================================================
# Dimension 4: 十神交叉 (Asymmetric Ten God Cross-Analysis)
# ============================================================

def score_ten_god_cross(
    chart_a: Dict,
    chart_b: Dict,
    gender_a: str,
    gender_b: str,
    comparison_type: str = 'romance',
) -> Dict:
    """Score the asymmetric Ten God cross-analysis.

    A→B: What role does A's DM play in B's chart?
    B→A: What role does B's DM play in A's chart?

    Gender-specific spouse star scoring for romance.
    """
    dm_a = chart_a['dayMasterStem']
    dm_b = chart_b['dayMasterStem']

    # A→B: Derive A's DM as ten god from B's perspective
    ten_god_a_in_b = derive_ten_god(dm_b, dm_a)
    # B→A: Derive B's DM as ten god from A's perspective
    ten_god_b_in_a = derive_ten_god(dm_a, dm_b)

    same_gender = gender_a == gender_b
    findings = []

    if comparison_type == 'romance':
        if same_gender:
            b_gender_key = 'neutral'
            a_gender_key = 'neutral'
        else:
            b_gender_key = gender_b
            a_gender_key = gender_a

        score_a_in_b = TEN_GOD_ROMANCE_SCORES.get(ten_god_a_in_b, {}).get(b_gender_key, 50)
        score_b_in_a = TEN_GOD_ROMANCE_SCORES.get(ten_god_b_in_a, {}).get(a_gender_key, 50)
    else:
        # Non-romance: use neutral scores
        score_a_in_b = TEN_GOD_ROMANCE_SCORES.get(ten_god_a_in_b, {}).get('neutral', 50)
        score_b_in_a = TEN_GOD_ROMANCE_SCORES.get(ten_god_b_in_a, {}).get('neutral', 50)

    # Parent-child weighting: parent→child = 70%, child→parent = 30%
    if comparison_type == 'parent_child':
        weight_a_to_b = 0.70
        weight_b_to_a = 0.30
    else:
        weight_a_to_b = 0.50
        weight_b_to_a = 0.50

    final_score = score_a_in_b * weight_a_to_b + score_b_in_a * weight_b_to_a

    findings.append({
        'type': 'a_in_b',
        'tenGod': ten_god_a_in_b,
        'score': score_a_in_b,
    })
    findings.append({
        'type': 'b_in_a',
        'tenGod': ten_god_b_in_a,
        'score': score_b_in_a,
    })

    # Cross-chart 官殺混雜 detection
    guan_sha_hun_za = _detect_cross_guan_sha_hun_za(
        chart_a, chart_b, gender_a, gender_b, comparison_type
    )

    # Cross-chart 傷官見官 detection
    shang_guan_jian_guan = _detect_cross_shang_guan_jian_guan(
        chart_a, chart_b, gender_a, gender_b, comparison_type
    )

    return {
        'rawScore': round(clamp(final_score, 0, 100), 1),
        'findings': findings,
        'sameGenderMode': same_gender,
        'guanShaHunZa': guan_sha_hun_za,
        'shangGuanJianGuan': shang_guan_jian_guan,
    }


def _detect_cross_guan_sha_hun_za(
    chart_a: Dict, chart_b: Dict,
    gender_a: str, gender_b: str,
    comparison_type: str,
) -> Optional[Dict]:
    """Detect cross-chart 官殺混雜.

    For romance: female-only. For business: both genders.
    Checks all 4 of the partner's manifest stems as Ten Gods from the subject's DM.
    """
    results = []

    def _check_for_subject(subject_chart: Dict, partner_chart: Dict,
                           subject_gender: str, label: str):
        if comparison_type == 'romance' and subject_gender != 'female':
            return None

        dm_subject = subject_chart['dayMasterStem']
        partner_pillars = partner_chart['fourPillars']

        zheng_guan_count = 0
        qi_sha_count = 0
        pillar_details = []

        for pillar_name in ['year', 'month', 'day', 'hour']:
            partner_stem = partner_pillars[pillar_name]['stem']
            ten_god = derive_ten_god(dm_subject, partner_stem)
            if ten_god == '正官':
                weight = 1.0 if pillar_name == 'day' else (0.8 if pillar_name == 'month' else 0.5)
                zheng_guan_count += weight
                pillar_details.append((pillar_name, '正官', weight))
            elif ten_god in ('偏官', '七殺'):
                weight = 1.0 if pillar_name == 'day' else (0.8 if pillar_name == 'month' else 0.5)
                qi_sha_count += weight
                pillar_details.append((pillar_name, '七殺', weight))

        if zheng_guan_count > 0 and qi_sha_count > 0:
            severity = 'critical' if comparison_type == 'romance' else 'high'
            return {
                'detected': True,
                'subject': label,
                'severity': severity,
                'zhengGuanWeight': zheng_guan_count,
                'qiShaWeight': qi_sha_count,
                'pillarDetails': pillar_details,
            }
        return None

    # Check A as subject (partner B's stems analyzed from A's DM)
    result_a = _check_for_subject(chart_a, chart_b, gender_a, 'A')
    if result_a:
        return result_a

    # Check B as subject (partner A's stems analyzed from B's DM)
    result_b = _check_for_subject(chart_b, chart_a, gender_b, 'B')
    if result_b:
        return result_b

    return None


def _detect_cross_shang_guan_jian_guan(
    chart_a: Dict, chart_b: Dict,
    gender_a: str, gender_b: str,
    comparison_type: str,
) -> Optional[Dict]:
    """Detect cross-chart 傷官見官.

    Female must have prominent 傷官 (2+ occurrences or month-pillar).
    Male's DM must be 正官 from Female's DM perspective.
    """
    def _check(female_chart: Dict, male_chart: Dict, label: str):
        dm_female = female_chart['dayMasterStem']
        dm_male = male_chart['dayMasterStem']

        # Check if male's DM is 正官 from female's perspective
        ten_god = derive_ten_god(dm_female, dm_male)
        if ten_god != '正官':
            return None

        # Check if female has prominent 傷官
        pillars = female_chart['fourPillars']
        shang_guan_count = 0
        month_shang_guan = False
        for pillar_name in ['year', 'month', 'day', 'hour']:
            stem = pillars[pillar_name]['stem']
            if derive_ten_god(dm_female, stem) == '傷官':
                shang_guan_count += 1
                if pillar_name == 'month':
                    month_shang_guan = True

        if shang_guan_count >= 2 or month_shang_guan:
            return {
                'detected': True,
                'subject': label,
                'shangGuanCount': shang_guan_count,
                'monthPillar': month_shang_guan,
            }
        return None

    if comparison_type == 'romance':
        # Only check female
        if gender_a == 'female':
            return _check(chart_a, chart_b, 'A')
        elif gender_b == 'female':
            return _check(chart_b, chart_a, 'B')
    elif comparison_type == 'business':
        # Check both directions
        result = _check(chart_a, chart_b, 'A')
        if result:
            return result
        return _check(chart_b, chart_a, 'B')

    return None


# ============================================================
# Dimension 5: 五行互補 (Directional Element Complementarity)
# ============================================================

def score_element_complementarity(
    elements_a: Dict[str, float],
    elements_b: Dict[str, float],
) -> Dict:
    """Score directional element complementarity.

    For each element: complementarity = min(A's excess, B's deficit) + min(B's excess, A's deficit)
    This captures MUTUAL benefit — A fills B's gaps and vice versa.
    """
    # Map between Chinese element names and English keys used by fiveElementsBalance
    ELEMENT_EN_TO_ZH = {'wood': '木', 'fire': '火', 'earth': '土', 'metal': '金', 'water': '水'}
    ELEMENT_ZH_TO_EN = {v: k for k, v in ELEMENT_EN_TO_ZH.items()}

    raw_sum = 0.0
    findings = []

    for element in FIVE_ELEMENTS:
        # Support both Chinese keys (木) and English keys (wood)
        en_key = ELEMENT_ZH_TO_EN.get(element, element)
        pct_a = elements_a.get(element, elements_a.get(en_key, 20.0))
        pct_b = elements_b.get(element, elements_b.get(en_key, 20.0))

        excess_a = max(0, pct_a - 20)
        deficit_a = max(0, 20 - pct_a)
        excess_b = max(0, pct_b - 20)
        deficit_b = max(0, 20 - pct_b)

        complementarity = min(excess_a, deficit_b) + min(excess_b, deficit_a)
        raw_sum += complementarity

        if complementarity >= 10:
            findings.append({
                'element': element,
                'complementarity': round(complementarity, 1),
                'personA': round(pct_a, 1),
                'personB': round(pct_b, 1),
            })

    # Normalize using empirical max (~50 estimated)
    empirical_max = 50.0
    normalized = min(100, raw_sum / empirical_max * 100)

    return {
        'rawScore': round(clamp(normalized, 0, 100), 1),
        'rawSum': round(raw_sum, 1),
        'findings': findings,
    }


# ============================================================
# Dimension 6: 全盤互動 (Full Pillar Interactions)
# ============================================================

def analyze_cross_chart_stems(
    pillars_a: Dict, pillars_b: Dict,
) -> Dict:
    """Analyze all 15 cross-chart stem pairs (excluding day×day = Dim 2).

    Returns weighted positive/negative scores.
    """
    positive_weighted = 0.0
    negative_weighted = 0.0
    findings = []
    pillar_names = ['year', 'month', 'day', 'hour']

    seen_combos = set()

    for pa_name in pillar_names:
        stem_a = pillars_a[pa_name]['stem']
        for pb_name in pillar_names:
            # Skip day×day (handled by Dimension 2)
            if pa_name == 'day' and pb_name == 'day':
                continue

            stem_b = pillars_b[pb_name]['stem']
            pair_key = (pa_name, pb_name)
            weight = CROSS_PILLAR_STEM_WEIGHTS.get(
                (pa_name, pb_name), CROSS_PILLAR_STEM_DEFAULT_WEIGHT
            )

            # Deduplication: if same stem appears in multiple pillars, count best only
            dedup_key = (stem_a, stem_b)
            if dedup_key in seen_combos:
                continue

            # Check 天干合
            combo = STEM_COMBINATION_LOOKUP.get(stem_a)
            if combo and combo[0] == stem_b:
                positive_weighted += weight
                seen_combos.add(dedup_key)
                findings.append({
                    'type': '天干合',
                    'pillarA': pa_name,
                    'pillarB': pb_name,
                    'detail': f'{stem_a}{stem_b}合',
                    'weight': weight,
                    'effect': 'positive',
                })
                continue

            # Check 天干沖
            clash = STEM_CLASH_LOOKUP.get(stem_a)
            if clash and clash == stem_b:
                negative_weighted += weight
                seen_combos.add(dedup_key)
                findings.append({
                    'type': '天干沖',
                    'pillarA': pa_name,
                    'pillarB': pb_name,
                    'detail': f'{stem_a}{stem_b}沖',
                    'weight': weight,
                    'effect': 'negative',
                })

    return {
        'positiveWeighted': positive_weighted,
        'negativeWeighted': negative_weighted,
        'findings': findings,
    }


def analyze_cross_chart_branches(
    pillars_a: Dict, pillars_b: Dict,
    pre_analysis_a: Dict, pre_analysis_b: Dict,
) -> Dict:
    """Analyze all 16 cross-chart branch pairs + triple formations.

    Dual-tracking: positive and negative scored separately, never cancel.
    Also detects cross-chart 三合 and 三刑.
    """
    from .compatibility import SIX_HARMONIES, SIX_CLASHES, SIX_HARMS, THREE_HARMONIES

    positive_weighted = 0.0
    negative_weighted = 0.0
    max_positive = 0.0
    max_negative = 0.0
    findings = []
    pillar_names = ['year', 'month', 'day', 'hour']

    for pa_name in pillar_names:
        branch_a = pillars_a[pa_name]['branch']
        for pb_name in pillar_names:
            branch_b = pillars_b[pb_name]['branch']
            weight = CROSS_PILLAR_BRANCH_WEIGHTS.get(
                (pa_name, pb_name), CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT
            )

            # Check 六合
            if SIX_HARMONIES.get(branch_a) == branch_b:
                positive_weighted += weight
                max_positive += weight
                findings.append({
                    'type': '六合',
                    'pillarA': pa_name,
                    'pillarB': pb_name,
                    'detail': f'{branch_a}{branch_b}合',
                    'weight': weight,
                    'effect': 'positive',
                })
            else:
                max_positive += weight  # Track theoretical max

            # Check 六沖 (with severity)
            severity = LIUCHONG_SEVERITY.get((branch_a, branch_b))
            if severity is not None:
                compat = max(5, 100 - severity) / 100.0  # Normalized severity factor
                neg_weight = weight * (severity / 90.0)  # Weighted by severity
                negative_weighted += neg_weight
                max_negative += weight
                findings.append({
                    'type': '六沖',
                    'pillarA': pa_name,
                    'pillarB': pb_name,
                    'detail': f'{branch_a}{branch_b}沖',
                    'severity': severity,
                    'weight': weight,
                    'effect': 'negative',
                })
            else:
                max_negative += weight

            # Check 六害
            if SIX_HARMS.get(branch_a) == branch_b:
                negative_weighted += weight * 0.7
                findings.append({
                    'type': '六害',
                    'pillarA': pa_name,
                    'pillarB': pb_name,
                    'detail': f'{branch_a}{branch_b}害',
                    'weight': weight,
                    'effect': 'negative',
                })

    # Cross-chart 三合 detection
    all_branches_a = [pillars_a[p]['branch'] for p in pillar_names]
    all_branches_b = [pillars_b[p]['branch'] for p in pillar_names]
    combined_branches = set(all_branches_a + all_branches_b)
    individual_a = set(all_branches_a)
    individual_b = set(all_branches_b)

    cross_sanhe = []
    gods_a = pre_analysis_a.get('effectiveFavorableGods', {})
    gods_b = pre_analysis_b.get('effectiveFavorableGods', {})

    for b1, b2, b3, elem in THREE_HARMONIES:
        trio = {b1, b2, b3}
        if trio.issubset(combined_branches):
            # Must span both charts (at least 1 branch from each)
            a_has = trio & individual_a
            b_has = trio & individual_b
            if a_has and b_has:
                # Must NOT be already complete in either chart alone
                if not trio.issubset(individual_a) and not trio.issubset(individual_b):
                    is_yongshen = (
                        gods_a.get('usefulGod') == elem or
                        gods_b.get('usefulGod') == elem
                    )
                    cross_sanhe.append({
                        'branches': sorted(list(trio)),
                        'resultElement': elem,
                        'isYongshen': is_yongshen,
                    })

    # Cross-chart 三刑 detection
    # Common 三刑 patterns: 寅巳申, 丑未戌, 子卯 (mutual)
    SANXING_PATTERNS = [
        {'寅', '巳', '申'},
        {'丑', '未', '戌'},
    ]
    cross_sanxing = []
    for pattern in SANXING_PATTERNS:
        if pattern.issubset(combined_branches):
            a_has = pattern & individual_a
            b_has = pattern & individual_b
            if a_has and b_has and not pattern.issubset(individual_a) and not pattern.issubset(individual_b):
                cross_sanxing.append({
                    'branches': sorted(list(pattern)),
                    'type': '三刑',
                })

    # Compute dimension score with dual-tracking
    max_dim = 100
    if positive_weighted == 0 and negative_weighted == 0:
        dimension_score = 38  # Neutral default below midpoint
    elif max_negative == 0 or negative_weighted == 0:
        safe_max_positive = max(max_positive, 0.001)
        dimension_score = (positive_weighted / safe_max_positive) * max_dim * 0.6 + max_dim * 0.4
    elif max_positive == 0 or positive_weighted == 0:
        safe_max_negative = max(max_negative, 0.001)
        dimension_score = (1 - negative_weighted / safe_max_negative) * max_dim * 0.4
    else:
        dimension_score = (
            (positive_weighted / max_positive) * max_dim * 0.6 +
            (1 - negative_weighted / max_negative) * max_dim * 0.4
        )

    # Apply cross-chart bonuses/penalties
    for sanhe in cross_sanhe:
        dimension_score += 15
        if sanhe['isYongshen']:
            dimension_score += 5

    for sanxing in cross_sanxing:
        dimension_score -= 7  # 0.7× within-chart penalty of 10

    # Compute interaction intensity
    total_interactions = positive_weighted + negative_weighted
    max_total = max(max_positive + max_negative, 0.001)
    interaction_intensity = total_interactions / max_total

    return {
        'rawScore': round(clamp(dimension_score, 0, 100), 1),
        'positiveWeighted': round(positive_weighted, 2),
        'negativeWeighted': round(negative_weighted, 2),
        'crossSanhe': cross_sanhe,
        'crossSanxing': cross_sanxing,
        'interactionIntensity': round(interaction_intensity, 2),
        'findings': findings,
    }


# ============================================================
# Dimension 7: 神煞互動 (Shen Sha Cross-Chart Analysis)
# ============================================================

def score_shen_sha_interactions(
    shen_sha_a: List[Dict],
    shen_sha_b: List[Dict],
    day_branch_a: str,
    day_branch_b: str,
    comparison_type: str = 'romance',
    current_year: Optional[int] = None,
) -> Dict:
    """Score cross-chart Shen Sha interactions.

    Checks: 天德/月德, 天乙貴人, 紅鸞/天喜, 桃花, 華蓋, 驛馬, 孤辰/寡宿.
    Score out of 5, then normalized to 0-100 before sigmoid.
    """
    raw_score = 0.0
    findings = []

    # 天德/月德 mutual protection
    a_has_tiande = _has_shen_sha(shen_sha_a, '天德') or _has_shen_sha(shen_sha_a, '月德')
    b_has_tiande = _has_shen_sha(shen_sha_b, '天德') or _has_shen_sha(shen_sha_b, '月德')
    if a_has_tiande and b_has_tiande:
        raw_score += SHEN_SHA_TIAN_DE_YUE_DE_MUTUAL
        findings.append({'type': '天德月德互護', 'score': SHEN_SHA_TIAN_DE_YUE_DE_MUTUAL})
    elif a_has_tiande or b_has_tiande:
        raw_score += SHEN_SHA_TIAN_DE_YUE_DE_MUTUAL * 0.6
        findings.append({'type': '天德月德單方', 'score': round(SHEN_SHA_TIAN_DE_YUE_DE_MUTUAL * 0.6, 1)})

    # 天乙貴人 cross-match (A's 天乙 branch = B's day branch)
    for ss in shen_sha_a:
        if ss.get('name') == '天乙貴人' and ss.get('branch') == day_branch_b:
            raw_score += SHEN_SHA_TIAN_YI_CROSS_MATCH
            findings.append({'type': '天乙貴人交叉', 'direction': 'A→B', 'score': SHEN_SHA_TIAN_YI_CROSS_MATCH})
            break
    for ss in shen_sha_b:
        if ss.get('name') == '天乙貴人' and ss.get('branch') == day_branch_a:
            raw_score += SHEN_SHA_TIAN_YI_CROSS_MATCH
            findings.append({'type': '天乙貴人交叉', 'direction': 'B→A', 'score': SHEN_SHA_TIAN_YI_CROSS_MATCH})
            break

    # 桃花 cross-match (A's 桃花 branch = B's day branch)
    for ss in shen_sha_a:
        if ss.get('name') == '桃花' and ss.get('branch') == day_branch_b:
            raw_score += SHEN_SHA_TAOHUA_CROSS_MATCH
            findings.append({'type': '桃花交叉', 'direction': 'A→B'})
            break
    for ss in shen_sha_b:
        if ss.get('name') == '桃花' and ss.get('branch') == day_branch_a:
            raw_score += SHEN_SHA_TAOHUA_CROSS_MATCH
            findings.append({'type': '桃花交叉', 'direction': 'B→A'})
            break

    # 紅鸞/天喜 + 桃花 combo
    a_has_hongluan = _has_shen_sha(shen_sha_a, '紅鸞') or _has_shen_sha(shen_sha_a, '天喜')
    b_has_hongluan = _has_shen_sha(shen_sha_b, '紅鸞') or _has_shen_sha(shen_sha_b, '天喜')
    a_has_taohua = _has_shen_sha(shen_sha_a, '桃花')
    b_has_taohua = _has_shen_sha(shen_sha_b, '桃花')

    if a_has_hongluan and b_has_hongluan:
        raw_score += SHEN_SHA_HONG_LUAN_TIAN_XI_SYNC
        findings.append({'type': '紅鸞天喜同步'})

    if (a_has_taohua and b_has_hongluan) or (b_has_taohua and a_has_hongluan):
        raw_score += SHEN_SHA_TAOHUA_HONGLUAN_COMBO
        findings.append({'type': '桃花紅鸞組合'})

    # 華蓋 — different scoring for romance vs others
    a_has_huagai = _has_shen_sha(shen_sha_a, '華蓋')
    b_has_huagai = _has_shen_sha(shen_sha_b, '華蓋')
    if a_has_huagai and b_has_huagai:
        if comparison_type == 'romance':
            raw_score += SHEN_SHA_HUAGAI_ROMANCE
            findings.append({'type': '華蓋雙方（Romance）', 'score': SHEN_SHA_HUAGAI_ROMANCE})
        else:
            raw_score += SHEN_SHA_HUAGAI_FRIENDSHIP_BUSINESS
            findings.append({'type': '華蓋雙方', 'score': SHEN_SHA_HUAGAI_FRIENDSHIP_BUSINESS})

    # 驛馬
    a_has_yima = _has_shen_sha(shen_sha_a, '驛馬')
    b_has_yima = _has_shen_sha(shen_sha_b, '驛馬')
    if a_has_yima and b_has_yima:
        raw_score += SHEN_SHA_YIMA_BOTH
        findings.append({'type': '驛馬雙方'})

    # 孤辰/寡宿
    a_has_lonely = _has_shen_sha(shen_sha_a, '孤辰') or _has_shen_sha(shen_sha_a, '寡宿')
    b_has_lonely = _has_shen_sha(shen_sha_b, '孤辰') or _has_shen_sha(shen_sha_b, '寡宿')
    if a_has_lonely and b_has_lonely:
        raw_score += SHEN_SHA_GUCHEN_GUASU_BOTH
        findings.append({'type': '孤辰寡宿雙方'})
    elif a_has_lonely or b_has_lonely:
        raw_score += SHEN_SHA_GUCHEN_GUASU_ONE
        findings.append({'type': '孤辰寡宿單方'})

    # If no significant shen sha found, use neutral default
    if not findings:
        raw_score = SHEN_SHA_NEUTRAL_DEFAULT

    # Clamp to [0, 5] then normalize to 0-100
    clamped = clamp(raw_score, 0, 5)
    normalized = (clamped / 5) * 100

    return {
        'rawScore': round(normalized, 1),
        'rawShenShaScore': round(raw_score, 1),
        'findings': findings,
    }


# ============================================================
# Dimension 8: 大運同步度 (Luck Period Timing Sync)
# ============================================================

def sync_luck_periods(
    luck_periods_a: List[Dict],
    luck_periods_b: List[Dict],
    pre_analysis_a: Dict,
    pre_analysis_b: Dict,
    pillars_a: Dict,
    pillars_b: Dict,
    current_year: int,
    num_years: int = 20,
) -> Dict:
    """Score luck period synchronization over the next num_years years.

    Per-year cross scoring: both good (+3), both bad (-3), imbalanced (-2), neutral (0).
    Golden years and challenge years are flagged.
    """
    gods_a = pre_analysis_a.get('effectiveFavorableGods', {})
    gods_b = pre_analysis_b.get('effectiveFavorableGods', {})

    yearly_scores = []
    golden_years = []
    challenge_years = []

    for year_offset in range(num_years):
        year = current_year + year_offset

        # Score each person's year
        score_a = _score_individual_year(year, luck_periods_a, gods_a, pillars_a)
        score_b = _score_individual_year(year, luck_periods_b, gods_b, pillars_b)

        # Cross-person scoring
        if score_a > 0 and score_b > 0:
            cross_score = TIMING_BOTH_GOOD
            golden_years.append({'year': year, 'reason': '雙方同時走好運'})
        elif score_a < 0 and score_b < 0:
            cross_score = TIMING_BOTH_BAD
            challenge_years.append({'year': year, 'reason': '雙方同時運勢低迷'})
        elif (score_a > 0 and score_b < 0) or (score_a < 0 and score_b > 0):
            cross_score = TIMING_IMBALANCED
        else:
            cross_score = TIMING_BOTH_NEUTRAL

        yearly_scores.append(cross_score)

    # Calculate luckCycleSyncScore
    total = sum(yearly_scores)
    luck_cycle_sync_score = (total + num_years * 3) / (num_years * 6) * 100
    luck_cycle_sync_score = clamp(luck_cycle_sync_score, 0, 100)

    return {
        'rawScore': round(luck_cycle_sync_score, 1),
        'goldenYears': golden_years[:5],  # Cap at 5 most relevant
        'challengeYears': challenge_years[:5],
        'yearlyScores': yearly_scores,
        'numYears': num_years,
    }


def _score_individual_year(
    year: int,
    luck_periods: List[Dict],
    effective_gods: Dict[str, str],
    natal_pillars: Dict,
) -> int:
    """Score an individual year for a person: +2 (good), 0 (neutral), -2 (bad)."""
    from .constants import EARTHLY_BRANCHES

    # Find current luck period
    current_lp = None
    for lp in luck_periods:
        if lp.get('startYear', 0) <= year <= lp.get('endYear', 9999):
            current_lp = lp
            break

    if not current_lp:
        return 0

    # Derive annual star (流年)
    year_stem_idx = (year - 4) % 10  # 甲=0, based on known epoch
    year_branch_idx = (year - 4) % 12
    from .constants import HEAVENLY_STEMS
    annual_stem = HEAVENLY_STEMS[year_stem_idx]
    annual_branch = EARTHLY_BRANCHES[year_branch_idx]
    annual_element = STEM_ELEMENT[annual_stem]

    yongshen = effective_gods.get('usefulGod', '')
    jishen = effective_gods.get('tabooGod', '')

    positive_signals = 0
    negative_signals = 0

    # Check if annual element supports 用神
    if annual_element == yongshen or ELEMENT_PRODUCES.get(annual_element) == yongshen:
        positive_signals += 1

    # Check if annual element is 忌神
    if annual_element == jishen or ELEMENT_PRODUCES.get(annual_element) == jishen:
        negative_signals += 1

    # Check 犯太歲 (annual branch same as day branch)
    day_branch = natal_pillars.get('day', {}).get('branch', '')
    if annual_branch == day_branch:
        negative_signals += 1

    # Check if luck period element supports 用神
    lp_element = STEM_ELEMENT.get(current_lp.get('stem', ''), '')
    if lp_element == yongshen or ELEMENT_PRODUCES.get(lp_element) == yongshen:
        positive_signals += 1
    elif lp_element == jishen:
        negative_signals += 1

    if positive_signals > negative_signals:
        return 2
    elif negative_signals > positive_signals:
        return -2
    return 0


# ============================================================
# Knockout Conditions Detection
# ============================================================

def _has_marriage_palace_clash(pre_analysis: Dict) -> Tuple[bool, int]:
    """Check if person's day branch is clashed by another pillar (within own chart).

    Returns (has_clash, max_severity).
    """
    branch_rels = pre_analysis.get('pillarRelationships', {}).get('branchRelationships', {})
    clashes = branch_rels.get('clashes', [])
    max_severity = 0
    has_clash = False
    for clash in clashes:
        if clash.get('type') == 'six_clash':
            pillar_a = clash.get('pillarA', '')
            pillar_b = clash.get('pillarB', '')
            if pillar_a == 'day' or pillar_b == 'day':
                has_clash = True
                severity = clash.get('severity', 80)
                if severity > max_severity:
                    max_severity = severity
    return has_clash, max_severity


def detect_knockout_conditions(
    dim_results: Dict,
    tianhe_dihe: Dict,
    gender_a: str,
    gender_b: str,
    comparison_type: str,
    shen_sha_a: List[Dict],
    shen_sha_b: List[Dict],
    day_branch_a: str,
    day_branch_b: str,
    pre_analysis_a: Dict = None,
    pre_analysis_b: Dict = None,
) -> List[Dict]:
    """Detect all knockout conditions — bonuses and penalties applied post-aggregation."""
    knockouts = []

    # Positive knockouts
    if tianhe_dihe.get('detected'):
        knockouts.append({
            'type': 'tianhe_dihe',
            'severity': 'premium_positive',
            'description': tianhe_dihe.get('description', '天合地合'),
            'scoreImpact': KNOCKOUT_TIANHE_DIHE_BONUS,
        })
    else:
        # Day stem 天干五合 (only if NOT 天合地合)
        day_stem_result = dim_results.get('dayStemRelationship', {})
        if day_stem_result.get('combinationName'):
            # Check if yongshen is severely conflicting → 合而不利
            yongshen_raw = dim_results.get('yongshenComplementarity', {}).get('rawYongshenScore', 0)
            if yongshen_raw < YONGSHEN_ADVERSE_THRESHOLD:
                # 合而不利: surface attraction masks fundamental conflict
                knockouts.append({
                    'type': 'tiangan_wuhe_adverse',
                    'severity': 'warning',
                    'description': f'日干天干合（{day_stem_result["combinationName"]}）'
                                   f'但用神嚴重衝突，合而不利',
                    'scoreImpact': KNOCKOUT_TIANGAN_WUHE_ADVERSE_PENALTY,
                })
            else:
                knockouts.append({
                    'type': 'tiangan_wuhe',
                    'severity': 'positive',
                    'description': f'日干天干合 — {day_stem_result["combinationName"]}',
                    'scoreImpact': KNOCKOUT_TIANGAN_WUHE_BONUS,
                })

    # Cross-chart 三合 completing 用神 element
    full_pillar = dim_results.get('fullPillarInteraction', {})
    for sanhe in full_pillar.get('crossSanhe', []):
        if sanhe.get('isYongshen'):
            knockouts.append({
                'type': 'cross_sanhe_yongshen',
                'severity': 'positive',
                'description': f'跨盤三合{sanhe["resultElement"]}（用神元素）',
                'scoreImpact': KNOCKOUT_CROSS_SANHE_YONGSHEN_BONUS,
            })

    # Negative knockouts
    # Day branch 六沖
    severity = LIUCHONG_SEVERITY.get((day_branch_a, day_branch_b))
    if severity is not None:
        if severity >= 90:  # 子午沖
            knockouts.append({
                'type': 'liuchong_ziwu',
                'severity': 'critical',
                'description': f'{day_branch_a}{day_branch_b}沖（最嚴重）',
                'scoreImpact': KNOCKOUT_LIUCHONG_ZIWU_PENALTY,
            })
        elif severity >= 80:  # 巳亥/卯酉/寅申
            knockouts.append({
                'type': 'liuchong_moderate',
                'severity': 'high',
                'description': f'{day_branch_a}{day_branch_b}沖',
                'scoreImpact': KNOCKOUT_LIUCHONG_MODERATE_PENALTY,
            })

    # 天剋地沖
    spouse_palace = dim_results.get('spousePalace', {})
    if spouse_palace.get('tianKeDiChong'):
        knockouts.append({
            'type': 'tian_ke_di_chong',
            'severity': 'critical',
            'description': '天剋地沖 — 最嚴重的配偶宮衝突',
            'scoreImpact': KNOCKOUT_TIAN_KE_DI_CHONG_PENALTY,
        })

    # 官殺混雜
    ten_god = dim_results.get('tenGodCross', {})
    if ten_god.get('guanShaHunZa'):
        knockouts.append({
            'type': 'guan_sha_hun_za',
            'severity': ten_god['guanShaHunZa'].get('severity', 'critical'),
            'description': '官殺混雜 — 跨盤激活',
            'scoreImpact': KNOCKOUT_GUAN_SHA_HUN_ZA_PENALTY,
        })

    # 傷官見官
    if ten_god.get('shangGuanJianGuan'):
        knockouts.append({
            'type': 'shang_guan_jian_guan',
            'severity': 'high',
            'description': '傷官見官 — 跨盤激活',
            'scoreImpact': KNOCKOUT_SHANG_GUAN_JIAN_GUAN_PENALTY,
        })

    # 用神 mutual conflict
    yongshen = dim_results.get('yongshenComplementarity', {})
    if yongshen.get('rawYongshenScore', 0) < -10:
        knockouts.append({
            'type': 'yongshen_conflict',
            'severity': 'high',
            'description': '用神嚴重衝突',
            'scoreImpact': KNOCKOUT_YONGSHEN_CONFLICT_PENALTY,
        })

    # 孤辰/寡宿 both in day pillar
    a_lonely_day = _get_shen_sha_in_pillar(shen_sha_a, '孤辰', 'day') or _get_shen_sha_in_pillar(shen_sha_a, '寡宿', 'day')
    b_lonely_day = _get_shen_sha_in_pillar(shen_sha_b, '孤辰', 'day') or _get_shen_sha_in_pillar(shen_sha_b, '寡宿', 'day')
    if a_lonely_day and b_lonely_day:
        knockouts.append({
            'type': 'guchen_guasu_both_day',
            'severity': 'warning',
            'description': '雙方日柱均有孤辰/寡宿',
            'scoreImpact': KNOCKOUT_GUCHEN_GUASU_BOTH_PENALTY,
        })

    # Within-chart Marriage Palace instability (day branch clashed within own chart)
    if pre_analysis_a is not None and pre_analysis_b is not None:
        a_unstable, a_sev = _has_marriage_palace_clash(pre_analysis_a)
        b_unstable, b_sev = _has_marriage_palace_clash(pre_analysis_b)
        if a_unstable and b_unstable:
            knockouts.append({
                'type': 'both_unstable_marriage_palaces',
                'severity': 'high',
                'description': '雙方自身配偶宮均有六沖衝破，婚姻基礎不穩',
                'scoreImpact': KNOCKOUT_BOTH_UNSTABLE_PALACE_PENALTY,
            })
        elif a_unstable or b_unstable:
            who = '甲方' if a_unstable else '乙方'
            knockouts.append({
                'type': 'one_unstable_marriage_palace',
                'severity': 'medium',
                'description': f'{who}自身配偶宮有六沖，婚姻觀較不穩定',
                'scoreImpact': KNOCKOUT_ONE_UNSTABLE_PALACE_PENALTY,
            })

        # 陰陽差錯日 — both have this special day pillar
        a_special_days = pre_analysis_a.get('specialDayPillars', [])
        b_special_days = pre_analysis_b.get('specialDayPillars', [])
        a_yinyang = any(
            sp.get('name') == '陰陽差錯日'
            for sp in a_special_days
        )
        b_yinyang = any(
            sp.get('name') == '陰陽差錯日'
            for sp in b_special_days
        )
        if a_yinyang and b_yinyang:
            knockouts.append({
                'type': 'both_yinyang_cuocuo',
                'severity': 'medium',
                'description': '雙方日柱皆為陰陽差錯日，婚姻易有波折',
                'scoreImpact': KNOCKOUT_BOTH_YINYANG_CUOCUO_PENALTY,
            })

    # Apply 天德/月德 mitigation to negative knockouts (except 天剋地沖)
    mitigation = _calculate_tiande_mitigation(shen_sha_a, shen_sha_b)
    if mitigation > 0:
        for ko in knockouts:
            if ko['scoreImpact'] < 0 and ko['type'] != 'tian_ke_di_chong':
                original = ko['scoreImpact']
                ko['scoreImpact'] = round(original * (1 - mitigation))
                if ko['scoreImpact'] != original:
                    ko['mitigated'] = True
                    ko['originalImpact'] = original

    return knockouts


# ============================================================
# Main Orchestrator
# ============================================================

def calculate_enhanced_compatibility(
    chart_a: Dict,
    chart_b: Dict,
    pre_analysis_a: Dict,
    pre_analysis_b: Dict,
    gender_a: str = 'male',
    gender_b: str = 'female',
    comparison_type: str = 'romance',
    current_year: int = 2026,
    shen_sha_a: Optional[List[Dict]] = None,
    shen_sha_b: Optional[List[Dict]] = None,
    luck_periods_a: Optional[List[Dict]] = None,
    luck_periods_b: Optional[List[Dict]] = None,
) -> Dict:
    """Main orchestrator for the 8-dimension enhanced compatibility analysis.

    Calls all scoring functions, applies sigmoid amplification, dynamic weights,
    knockout conditions, and assigns labels.
    """
    pillars_a = chart_a['fourPillars']
    pillars_b = chart_b['fourPillars']
    day_stem_a = chart_a['dayMasterStem']
    day_stem_b = chart_b['dayMasterStem']
    day_branch_a = pillars_a['day']['branch']
    day_branch_b = pillars_b['day']['branch']

    shen_sha_a = shen_sha_a or []
    shen_sha_b = shen_sha_b or []
    luck_periods_a = luck_periods_a or []
    luck_periods_b = luck_periods_b or []

    all_branches_a = [pillars_a[p]['branch'] for p in ['year', 'month', 'day', 'hour']]
    all_branches_b = [pillars_b[p]['branch'] for p in ['year', 'month', 'day', 'hour']]

    # Identical chart detection
    identical_charts = (
        day_stem_a == day_stem_b and
        all(pillars_a[p]['stem'] == pillars_b[p]['stem'] and
            pillars_a[p]['branch'] == pillars_b[p]['branch']
            for p in ['year', 'month', 'day', 'hour'])
    )

    # ---- Score all 8 dimensions ----

    # Dim 1: 用神互補
    dim1 = score_yongshen_complementarity(pre_analysis_a, pre_analysis_b)

    # Dim 2: 日柱天干
    dim2 = score_day_stem_relationship(
        day_stem_a, day_stem_b, pre_analysis_a, pre_analysis_b, comparison_type
    )

    # Dim 3: 配偶宮 + 天合地合
    tianhe_dihe_result = detect_tianhe_dihe(day_stem_a, day_branch_a, day_stem_b, day_branch_b)
    dim3 = score_spouse_palace(
        day_branch_a, day_branch_b, day_stem_a, day_stem_b,
        all_branches_a, all_branches_b,
        shen_sha_a, shen_sha_b,
        pre_analysis_a, pre_analysis_b,
    )

    # Dim 4: 十神交叉
    dim4 = score_ten_god_cross(chart_a, chart_b, gender_a, gender_b, comparison_type)

    # Dim 5: 五行互補
    elements_a = chart_a.get('fiveElementsBalance', {})
    elements_b = chart_b.get('fiveElementsBalance', {})
    dim5 = score_element_complementarity(elements_a, elements_b)

    # Dim 6: 全盤互動
    stem_analysis = analyze_cross_chart_stems(pillars_a, pillars_b)
    branch_analysis = analyze_cross_chart_branches(
        pillars_a, pillars_b, pre_analysis_a, pre_analysis_b
    )
    # Combine stem and branch scores into single dimension score
    dim6_raw = branch_analysis['rawScore']

    # Dim 7: 神煞互動
    dim7 = score_shen_sha_interactions(
        shen_sha_a, shen_sha_b, day_branch_a, day_branch_b,
        comparison_type, current_year,
    )

    # Dim 8: 大運同步
    dim8 = sync_luck_periods(
        luck_periods_a, luck_periods_b,
        pre_analysis_a, pre_analysis_b,
        pillars_a, pillars_b,
        current_year,
    )

    # ---- Build dimension scores dict ----
    dimension_scores = {
        'yongshenComplementarity': dim1,
        'dayStemRelationship': dim2,
        'spousePalace': dim3,
        'tenGodCross': dim4,
        'elementComplementarity': dim5,
        'fullPillarInteraction': {**branch_analysis, 'stemAnalysis': stem_analysis},
        'shenShaInteraction': dim7,
        'luckPeriodSync': dim8,
    }

    # ---- Dynamic weight adjustment for 中和 charts ----
    weights = dict(WEIGHT_TABLE.get(comparison_type, WEIGHT_TABLE['romance']))
    if dim1.get('isNeutralChart'):
        reduction = 0.10
        current_yongshen_weight = weights['yongshenComplementarity']
        new_weight = max(0.05, current_yongshen_weight - reduction)
        actual_reduction = current_yongshen_weight - new_weight
        weights['yongshenComplementarity'] = new_weight
        weights['elementComplementarity'] = weights['elementComplementarity'] + actual_reduction / 2
        weights['fullPillarInteraction'] = weights['fullPillarInteraction'] + actual_reduction / 2

    # ---- Apply sigmoid amplification + weighted sum ----
    raw_scores = {
        'yongshenComplementarity': dim1['rawScore'],
        'dayStemRelationship': dim2['rawScore'],
        'spousePalace': dim3['rawScore'],
        'tenGodCross': dim4['rawScore'],
        'elementComplementarity': dim5['rawScore'],
        'fullPillarInteraction': dim6_raw,
        'shenShaInteraction': dim7['rawScore'],
        'luckPeriodSync': dim8['rawScore'],
    }

    base_score = 0.0
    for dim_key, raw in raw_scores.items():
        amplified = sigmoid_amplify(raw)
        weight = weights.get(dim_key, 0)
        contribution = amplified * weight
        base_score += contribution

        # Store amplified and weighted scores in dimension results
        dim_data = dimension_scores[dim_key]
        dim_data['amplifiedScore'] = round(amplified, 1)
        dim_data['weightedScore'] = round(contribution, 1)
        dim_data['weight'] = weight

    # ---- Knockout conditions ----
    knockouts = detect_knockout_conditions(
        dimension_scores, tianhe_dihe_result,
        gender_a, gender_b, comparison_type,
        shen_sha_a, shen_sha_b,
        day_branch_a, day_branch_b,
        pre_analysis_a, pre_analysis_b,
    )

    knockout_adjustment = sum(k['scoreImpact'] for k in knockouts)
    adjusted_score = base_score + knockout_adjustment

    # 天剋地沖 hard floor
    has_tkdc = any(k['type'] == 'tian_ke_di_chong' for k in knockouts)
    if has_tkdc:
        adjusted_score = min(adjusted_score, KNOCKOUT_TIAN_KE_DI_CHONG_HARD_FLOOR)

    # Identical chart penalty
    if identical_charts and adjusted_score > 60:
        adjusted_score += KNOCKOUT_IDENTICAL_CHART_PENALTY
        knockouts.append({
            'type': 'identical_chart',
            'severity': 'info',
            'description': '相同八字 — 同步脆弱性風險',
            'scoreImpact': KNOCKOUT_IDENTICAL_CHART_PENALTY,
        })

    final_score = round(clamp(adjusted_score, 5, 99))

    # ---- Label assignment ----
    label = '歡喜冤家'
    label_meaning = ''
    for lb in COMPATIBILITY_LABELS:
        if lb['min'] <= final_score <= lb['max']:
            label = lb['label']
            label_meaning = lb['meaning']
            break

    # Special labels
    special_label = None
    has_stem_combo = dim2.get('combinationName') is not None
    has_branch_clash = LIUCHONG_SEVERITY.get((day_branch_a, day_branch_b)) is not None

    if tianhe_dihe_result.get('detected') and dim1['rawScore'] > 70:
        special_label = SPECIAL_LABEL_MING_ZHONG_ZHU_DING
    elif has_stem_combo and has_branch_clash:
        special_label = SPECIAL_LABEL_XIANG_AI_XIANG_SHA
    elif dim1['rawScore'] > 70 and branch_analysis.get('negativeWeighted', 0) > branch_analysis.get('positiveWeighted', 0):
        special_label = SPECIAL_LABEL_QIAN_SHI_YUAN_JIA

    return {
        'overallScore': round(base_score),
        'adjustedScore': final_score,
        'label': special_label or label,
        'specialLabel': special_label,
        'labelDescription': label_meaning,
        'dimensionScores': dimension_scores,
        'knockoutConditions': knockouts,
        'specialFindings': {
            'tianHeDiHe': tianhe_dihe_result.get('detected', False),
            'tianHeDiHeDetail': tianhe_dihe_result if tianhe_dihe_result.get('detected') else None,
            'guanShaHunZa': dim4.get('guanShaHunZa'),
            'shangGuanJianGuan': dim4.get('shangGuanJianGuan'),
            'congGeAffectsYongshen': dim1.get('congGeAffectsYongshen', False),
            'identicalCharts': identical_charts,
            'identicalChartReason': 'synchronized_vulnerability' if identical_charts else None,
            'tianDeMitigatesClash': dim3.get('tianDeMitigation', 0) > 0,
            'sameGenderMode': dim4.get('sameGenderMode', False),
            'dinRenWarning': dim2.get('dinRenWarning', False),
            'sharedJishenRisk': dim1.get('sharedJishenRisk', False),
            'combinationName': dim2.get('combinationName'),
            'huaHuaQuality': dim2.get('huaHuaQuality'),
        },
        'timingSync': {
            'goldenYears': dim8.get('goldenYears', []),
            'challengeYears': dim8.get('challengeYears', []),
            'luckCycleSyncScore': dim8['rawScore'],
        },
        'comparisonType': comparison_type,
    }
