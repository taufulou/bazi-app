"""
Annual Fortune Pre-Analysis Module (八字流年運勢 V2)

All deterministic annual fortune calculations. No AI involved.
Provides anchors for AI narration layer.

Contains 12 pre-analysis functions + master orchestrator:
1.  compute_tai_sui_analysis — 太歲分析 (all 4 pillar branches)
2.  assess_flow_year_harmony — 干支通氣/蓋頭/截腳
3.  compute_pillar_impact_analysis — 四柱交互 (合走用神/忌神, 天剋地沖)
4.  compute_spouse_palace_analysis — 夫妻宮 (天地鴛鴦合)
5.  compute_marriage_star_analysis — 姻緣星 5-track
6.  compute_lu_yangren_analysis — 祿神/羊刃
7.  compute_annual_career_analysis — 事業運勢
8.  compute_annual_finance_analysis — 財運收入
9.  compute_annual_relationship_analysis — 人際關係
10. compute_annual_health_analysis — 健康狀況
11. compute_seal_star_analysis — 印星/家庭
12. compute_enhanced_monthly_forecasts — 十二月運程 (4-aspect)

Key principle: 「流年為君，大運為臣，命局為民」
"""

from typing import Any, Dict, List, Optional, Set, Tuple

from .branch_relationships import (
    CLASH_LOOKUP,
    HARMONY_LOOKUP,
    SIX_BREAKS,
    SIX_CLASHES,
    SIX_HARMS,
    SIX_HARMONIES,
    THREE_PUNISHMENTS,
    TRIPLE_HARMONIES,
)
from .constants import (
    BRANCH_ELEMENT,
    ELEMENT_OVERCOMES,
    ELEMENT_PRODUCES,
    ELEMENT_PRODUCED_BY,
    HIDDEN_STEMS,
    HONGLUAN,
    LUSHEN,
    STEM_COMBINATIONS,
    STEM_ELEMENT,
    STEM_YINYANG,
    TAOHUA,
    TIANXI,
    YANGREN,
    YIMA,
)
from .life_stages import get_life_stage
from .lifetime_enhanced import WEALTH_TREASURY
from .stem_combinations import STEM_CLASH_LOOKUP, STEM_COMBINATION_LOOKUP
from .ten_gods import derive_ten_god

# ============================================================
# Lookup Tables (only those NOT in existing codebase)
# ============================================================

ELEMENT_ORGAN_MAP: Dict[str, Dict[str, str]] = {
    '金': {'yin': '肺', 'yang': '大腸', 'system': '呼吸系統/皮膚', 'sense': '鼻',
            'symptoms': '感冒/咳嗽/過敏/皮膚問題'},
    '木': {'yin': '肝', 'yang': '膽', 'system': '筋/眼', 'sense': '目',
            'symptoms': '眼疲勞/筋骨痠痛/頭痛'},
    '水': {'yin': '腎', 'yang': '膀胱', 'system': '骨/耳', 'sense': '耳',
            'symptoms': '腰痠/泌尿問題/耳鳴'},
    '火': {'yin': '心', 'yang': '小腸', 'system': '血液/舌', 'sense': '舌',
            'symptoms': '失眠/心悸/口瘡'},
    '土': {'yin': '脾', 'yang': '胃', 'system': '肌肉/口', 'sense': '口',
            'symptoms': '胃脹/消化不良/四肢乏力'},
}

STEM_BODY_MAP: Dict[str, str] = {
    '甲': '頭/肝/膽', '乙': '肩頸/肝', '丙': '額/眼/小腸/心',
    '丁': '齒/舌/心', '戊': '鼻/面/胃', '己': '鼻/面/脾',
    '庚': '臍/筋/大腸/肺', '辛': '胸肋/肺', '壬': '小腿/膀胱/腎', '癸': '足/腎',
}

CHANGSHENG_HEALTH_LABELS: Dict[str, Dict[str, str]] = {
    '長生': {'vitality': 'rising', 'label': '新能量注入，恢復力增強'},
    '沐浴': {'vitality': 'unstable', 'label': '精力不穩，易受外界影響'},
    '冠帶': {'vitality': 'strengthening', 'label': '體質增強，抵抗力提升'},
    '臨官': {'vitality': 'strong', 'label': '精力充沛，抵抗力強'},
    '帝旺': {'vitality': 'peak', 'label': '能量高峰但需防過度消耗'},
    '衰': {'vitality': 'declining', 'label': '精力下降，需多休息'},
    '病': {'vitality': 'weak', 'label': '疾病風險升高，宜定期檢查'},
    '死': {'vitality': 'very_weak', 'label': '精力極低，需特別注意健康'},
    '墓': {'vitality': 'dormant', 'label': '能量蟄伏，慢性問題需關注'},
    '絕': {'vitality': 'critical', 'label': '體質最弱期，務必保養'},
    '胎': {'vitality': 'renewing', 'label': '新周期開始，逐步恢復'},
    '養': {'vitality': 'nurturing', 'label': '調養期，適合靜養恢復'},
}

PILLAR_PALACE_LABELS: Dict[str, str] = {
    'year': '長輩宮',
    'month': '事業宮',
    'day': '自身宮/配偶宮',
    'hour': '子女宮',
}

# Ten god spouse star mapping by gender
SPOUSE_STAR_MALE = {'正財', '偏財'}
SPOUSE_STAR_FEMALE = {'正官', '七殺'}

# Favorable and unfavorable role sets
FAVORABLE_ROLES = {'用神', '喜神'}
UNFAVORABLE_ROLES = {'忌神', '仇神'}

# Engine format role key → Chinese role name (same mapping as career_enhanced.py)
_ROLE_KEY_TO_CHINESE = {
    'usefulGod': '用神',
    'favorableGod': '喜神',
    'idleGod': '閒神',
    'tabooGod': '忌神',
    'enemyGod': '仇神',
}

# All yang/yin stem pairs for the 5 elements
_ELEMENT_STEMS = {
    '木': ('甲', '乙'), '火': ('丙', '丁'), '土': ('戊', '己'),
    '金': ('庚', '辛'), '水': ('壬', '癸'),
}


def _normalize_effective_gods_for_annual(
    gods_dict: Dict, day_master_stem: str
) -> Dict[str, str]:
    """
    Convert effective_gods from engine format to ten-god-keyed format.

    Engine format: {'usefulGod': '土', 'favorableGod': '火', ...}
    Output format: {'偏印': '喜神', '正印': '喜神', '正官': '忌神', ...}  (all 10 ten gods)

    Annual module looks up by ten god name (not element), so we expand
    each element into its yang+yin ten gods via derive_ten_god().
    Both yang and yin keys are required — _get_branch_role() resolves branch
    本氣 which can be yin stems (e.g., 卯→乙→正官).
    """
    if not gods_dict:
        return {}
    first_key = next(iter(gods_dict))

    # If already in ten-god format (test fixtures), return as-is
    if first_key not in _ROLE_KEY_TO_CHINESE:
        return gods_dict

    # Step 1: engine format → {element: role_zh}
    element_to_role = {
        element: _ROLE_KEY_TO_CHINESE[role_key]
        for role_key, element in gods_dict.items()
        if role_key in _ROLE_KEY_TO_CHINESE
    }

    # Step 2: expand to {ten_god_name: role_zh} for both yang+yin stems
    result = {}
    for element, role in element_to_role.items():
        stems = _ELEMENT_STEMS.get(element, ())
        for stem in stems:
            ten_god = derive_ten_god(day_master_stem, stem)
            if ten_god:
                result[ten_god] = role
    return result


# ============================================================
# Helper Functions
# ============================================================

def _get_branch_role(branch: str, day_master_stem: str, effective_gods: Dict) -> str:
    """Determine if a branch is favorable or unfavorable using 本氣 only."""
    hidden = HIDDEN_STEMS.get(branch, [])
    if not hidden:
        return '閒神'
    main_stem = hidden[0]  # 本氣
    ten_god = derive_ten_god(day_master_stem, main_stem)
    return effective_gods.get(ten_god, '閒神')


def _is_favorable_branch(branch: str, day_master_stem: str, effective_gods: Dict) -> bool:
    """Check if a branch's role is favorable (用神/喜神)."""
    role = _get_branch_role(branch, day_master_stem, effective_gods)
    return role in FAVORABLE_ROLES


def _get_element_role(element: str, day_master_stem: str, effective_gods: Dict) -> str:
    """Determine element's role via its representative yang stem."""
    stem_map = {'木': '甲', '火': '丙', '土': '戊', '金': '庚', '水': '壬'}
    rep_stem = stem_map.get(element, '')
    if not rep_stem:
        return '閒神'
    ten_god = derive_ten_god(day_master_stem, rep_stem)
    return effective_gods.get(ten_god, '閒神')


def _assess_element_auspiciousness(element: str, day_master_stem: str,
                                    effective_gods: Dict) -> str:
    """Map element role to auspiciousness label."""
    role = _get_element_role(element, day_master_stem, effective_gods)
    mapping = {
        '用神': '大吉', '喜神': '吉', '閒神': '平',
        '忌神': '凶', '仇神': '大凶',
    }
    return mapping.get(role, '平')


def _check_branch_interaction(branch_a: str, branch_b: str) -> List[str]:
    """Check all interactions between two branches, return list of type names."""
    interactions = []
    pair = frozenset({branch_a, branch_b})

    # 伏吟 (same branch)
    if branch_a == branch_b:
        interactions.append('伏吟')

    # 六沖
    if pair in SIX_CLASHES:
        interactions.append('六沖')

    # 六合
    if pair in SIX_HARMONIES:
        interactions.append('六合')

    # 三刑 (pairwise check)
    for punishment in THREE_PUNISHMENTS:
        for partial in punishment.get('partials', []):
            if pair == partial:
                interactions.append(f"三刑({punishment['name']})")
                break
        # Also check full set with just 2 branches (子卯 case)
        if not punishment.get('partials') and pair == punishment['branches']:
            interactions.append(f"三刑({punishment['name']})")

    # 六害
    if pair in SIX_HARMS:
        interactions.append('六害')

    # 六破
    if pair in SIX_BREAKS:
        interactions.append('六破')

    return interactions


# ============================================================
# Sub-Function 1: 太歲分析
# ============================================================

def compute_tai_sui_analysis(
    pillars: Dict,
    flow_year_branch: str,
    day_master_stem: str,
    effective_gods: Dict,
) -> Dict[str, Any]:
    """Check all 4 natal pillar branches for 犯太歲 (5 types)."""
    pillar_results = []
    has_tai_sui = False

    for pname in ('year', 'month', 'day', 'hour'):
        natal_branch = pillars[pname]['branch']
        types = []

        # 值太歲
        if natal_branch == flow_year_branch:
            types.append('值太歲')

        # 沖太歲
        if CLASH_LOOKUP.get(natal_branch) == flow_year_branch:
            types.append('沖太歲')

        # 刑太歲 (pairwise)
        pair = frozenset({natal_branch, flow_year_branch})
        for punishment in THREE_PUNISHMENTS:
            for partial in punishment.get('partials', []):
                if pair == partial:
                    types.append('刑太歲')
                    break
            if not punishment.get('partials') and pair == punishment['branches']:
                types.append('刑太歲')

        # 害太歲
        if pair in SIX_HARMS:
            types.append('害太歲')

        # 破太歲
        if pair in SIX_BREAKS:
            types.append('破太歲')

        if types:
            has_tai_sui = True
            branch_role = _get_branch_role(natal_branch, day_master_stem, effective_gods)
            is_favorable = branch_role in UNFAVORABLE_ROLES  # Clashing/punishing 忌神 is good

            pillar_results.append({
                'pillar': pname,
                'branch': natal_branch,
                'types': types,
                'affectedPalace': PILLAR_PALACE_LABELS[pname],
                'branchRole': branch_role,
                'isActuallyFavorable': is_favorable,
            })

    # Generate summary
    if not has_tai_sui:
        summary = '今年未犯太歲'
    else:
        affected = [r['affectedPalace'] for r in pillar_results]
        favorable_count = sum(1 for r in pillar_results if r['isActuallyFavorable'])
        if favorable_count == len(pillar_results):
            summary = f"犯太歲涉及{'、'.join(affected)}，但受影響地支為忌神，沖去反而有利"
        elif favorable_count > 0:
            summary = f"犯太歲涉及{'、'.join(affected)}，吉凶參半需細看"
        else:
            summary = f"犯太歲涉及{'、'.join(affected)}，受影響地支為用神/喜神，需多加留意"

    return {
        'pillarResults': pillar_results,
        'summary': summary,
        'hasTaiSui': has_tai_sui,
    }


# ============================================================
# Sub-Function 2: 干支通氣/蓋頭/截腳
# ============================================================

def assess_flow_year_harmony(
    flow_year_stem: str,
    flow_year_branch: str,
) -> Dict[str, Any]:
    """Determine if flow year's stem and branch are harmonious."""
    stem_element = STEM_ELEMENT.get(flow_year_stem, '')
    branch_element = BRANCH_ELEMENT.get(flow_year_branch, '')

    if stem_element == branch_element:
        pattern = '通氣'
        description = f'{stem_element}同氣，內外一致，能量純粹'
    elif ELEMENT_PRODUCES.get(stem_element) == branch_element:
        pattern = '通氣'
        description = f'{stem_element}生{branch_element}，天干助地支，表裡呼應'
    elif ELEMENT_PRODUCED_BY.get(stem_element) == branch_element:
        pattern = '輕微通氣'
        description = f'{branch_element}生{stem_element}，地支扶天干，根基助表象'
    elif ELEMENT_OVERCOMES.get(stem_element) == branch_element:
        pattern = '蓋頭'
        description = f'{stem_element}剋{branch_element}，外在壓制內在，機遇受壓'
    elif ELEMENT_OVERCOMES.get(branch_element) == stem_element:
        pattern = '截腳'
        description = f'{branch_element}剋{stem_element}，內在拖累外在，根基動搖'
    else:
        pattern = '平'
        description = '干支關係平和'

    return {
        'pattern': pattern,
        'description': description,
        'stemElement': stem_element,
        'branchElement': branch_element,
        'flowYearLabel': f'{flow_year_stem}{flow_year_branch}年',
    }


# ============================================================
# Sub-Function 3: 四柱交互分析
# ============================================================

def compute_pillar_impact_analysis(
    pillars: Dict,
    day_master_stem: str,
    flow_year_stem: str,
    flow_year_branch: str,
    effective_gods: Dict,
) -> List[Dict[str, Any]]:
    """Analyze flow year's interaction with each natal pillar."""
    results = []

    for pname in ('year', 'month', 'day', 'hour'):
        natal_stem = pillars[pname]['stem']
        natal_branch = pillars[pname]['branch']
        interactions = []

        # --- Stem interactions ---
        # 天干合
        combo = STEM_COMBINATION_LOOKUP.get(natal_stem)
        if combo and combo[0] == flow_year_stem:
            interactions.append({
                'type': '天干合',
                'detail': f'{natal_stem}{flow_year_stem}合化{combo[1]}',
            })

        # 天干沖
        if STEM_CLASH_LOOKUP.get(natal_stem) == flow_year_stem:
            interactions.append({
                'type': '天干沖',
                'detail': f'{natal_stem}{flow_year_stem}沖',
            })

        # --- Branch interactions ---
        branch_types = _check_branch_interaction(natal_branch, flow_year_branch)
        for bt in branch_types:
            interactions.append({
                'type': bt,
                'detail': f'{natal_branch}{flow_year_branch}{bt}',
            })

        # --- 干支見祿 ---
        if flow_year_branch == LUSHEN.get(natal_stem):
            interactions.append({
                'type': '干支見祿',
                'detail': f'{natal_stem}祿在{flow_year_branch}',
            })

        # --- 合走用神/忌神 analysis ---
        if HARMONY_LOOKUP.get(natal_branch) == flow_year_branch:
            branch_role = _get_branch_role(natal_branch, day_master_stem, effective_gods)
            if branch_role in FAVORABLE_ROLES:
                interactions.append({
                    'type': '合走用神',
                    'detail': f'{natal_branch}為{branch_role}，被{flow_year_branch}合走，有利元素被牽制',
                    'impact': 'negative',
                })
            elif branch_role in UNFAVORABLE_ROLES:
                interactions.append({
                    'type': '合走忌神',
                    'detail': f'{natal_branch}為{branch_role}，被{flow_year_branch}合走，有害元素被化解',
                    'impact': 'positive',
                })

        # --- 天剋地沖 detection ---
        stem_clash = STEM_CLASH_LOOKUP.get(natal_stem) == flow_year_stem
        branch_clash = CLASH_LOOKUP.get(natal_branch) == flow_year_branch
        if stem_clash and branch_clash:
            interactions.append({
                'type': '天剋地沖',
                'detail': f'{natal_stem}{natal_branch}與{flow_year_stem}{flow_year_branch}天剋地沖，衝擊最劇烈',
                'impact': 'very_negative',
            })

        results.append({
            'pillar': pname,
            'palace': PILLAR_PALACE_LABELS[pname],
            'natalStem': natal_stem,
            'natalBranch': natal_branch,
            'interactions': interactions,
        })

    return results


# ============================================================
# Sub-Function 4: 夫妻宮分析
# ============================================================

def compute_spouse_palace_analysis(
    pillars: Dict,
    day_master_stem: str,
    flow_year_stem: str,
    flow_year_branch: str,
    gender: str,
) -> Dict[str, Any]:
    """Analyze flow year's impact on the spouse palace (day branch)."""
    day_branch = pillars['day']['branch']
    interactions = _check_branch_interaction(day_branch, flow_year_branch)

    # 天地鴛鴦合 detection
    stem_combo = STEM_COMBINATION_LOOKUP.get(day_master_stem)
    branch_harmony = HARMONY_LOOKUP.get(day_branch) == flow_year_branch
    stem_match = stem_combo is not None and stem_combo[0] == flow_year_stem
    tian_di_yuan_yang = stem_match and branch_harmony

    signals = []
    if '六沖' in interactions:
        signals.append({'type': '夫妻宮逢沖', 'impact': 'negative',
                        'detail': '配偶宮受沖，感情易有波動或變化'})
    if '六合' in interactions:
        signals.append({'type': '夫妻宮逢合', 'impact': 'positive',
                        'detail': '配偶宮逢合，感情穩定或有新對象'})
    if '伏吟' in interactions:
        signals.append({'type': '夫妻宮伏吟', 'impact': 'mixed',
                        'detail': '配偶宮伏吟，感情事反覆或壓力加倍'})
    if tian_di_yuan_yang:
        signals.append({'type': '天地鴛鴦合', 'impact': 'very_positive',
                        'detail': '天干地支同時與日柱合化，最強婚姻信號'})
    for interaction in interactions:
        if '三刑' in interaction:
            signals.append({'type': '夫妻宮逢刑', 'impact': 'negative',
                            'detail': '配偶宮受刑，感情或婚姻有摩擦爭執'})
        if '六害' == interaction:
            signals.append({'type': '夫妻宮逢害', 'impact': 'negative',
                            'detail': '配偶宮逢害，暗中消耗感情能量'})

    return {
        'dayBranch': day_branch,
        'interactions': interactions,
        'signals': signals,
        'tianDiYuanYang': tian_di_yuan_yang,
    }


# ============================================================
# Sub-Function 5: 姻緣星 5-track
# ============================================================

def compute_marriage_star_analysis(
    day_master_stem: str,
    flow_year_stem: str,
    flow_year_branch: str,
    year_branch: str,
    day_branch: str,
    gender: str,
    spouse_palace: Dict,
) -> Dict[str, Any]:
    """5-track romance detection for the flow year."""
    tracks = []

    # Track 1: 夫妻星 (spouse star as flow year ten god)
    flow_year_ten_god = derive_ten_god(day_master_stem, flow_year_stem)
    spouse_stars = SPOUSE_STAR_MALE if gender.upper() in ('MALE', '男') else SPOUSE_STAR_FEMALE
    if flow_year_ten_god in spouse_stars:
        tracks.append({
            'track': '夫妻星',
            'active': True,
            'trackType': 'romance',
            'detail': f'流年天干為{flow_year_ten_god}，為夫妻星透出',
        })

    # Track 2: 夫妻宮 interactions (from spouse palace analysis)
    if spouse_palace.get('signals'):
        tracks.append({
            'track': '夫妻宮',
            'active': True,
            'trackType': 'romance',
            'detail': '、'.join(s['type'] for s in spouse_palace['signals']),
        })

    # Track 3: 桃花/咸池 (day branch as primary lookup key — orthodox 子平桃花)
    taohua_branch = TAOHUA.get(day_branch)
    if taohua_branch and taohua_branch == flow_year_branch:
        tracks.append({
            'track': '桃花',
            'active': True,
            'trackType': 'romance',
            'detail': f'流年地支{flow_year_branch}為桃花位',
        })

    # Track 4: 紅鸞/天喜
    # 紅鸞 = romance star; 天喜 = celebration star (紫微斗數喜慶星, NOT orthodox 子平桃花)
    hongluan_branch = HONGLUAN.get(year_branch)
    tianxi_branch = TIANXI.get(year_branch)
    if hongluan_branch == flow_year_branch:
        tracks.append({
            'track': '紅鸞',
            'active': True,
            'trackType': 'romance',
            'detail': f'流年見紅鸞星({flow_year_branch})，戀愛婚姻機緣增加',
        })
    if tianxi_branch == flow_year_branch:
        tracks.append({
            'track': '天喜',
            'active': True,
            'trackType': 'celebration',
            'detail': f'流年見天喜星({flow_year_branch})，喜慶事件增多（喜慶星，非正桃花）',
        })

    # Track 5: 天地鴛鴦合
    if spouse_palace.get('tianDiYuanYang'):
        tracks.append({
            'track': '天地鴛鴦合',
            'active': True,
            'trackType': 'romance',
            'detail': '日柱天干地支同時與流年合化，最強婚姻信號',
        })

    # Weighted romance scoring: romance tracks=1.0, celebration tracks=0.3
    track_count = len(tracks)
    romance_score = sum(
        1.0 for t in tracks if t.get('active') and t.get('trackType') == 'romance'
    ) + sum(
        0.3 for t in tracks if t.get('active') and t.get('trackType') == 'celebration'
    )
    romance_level = ('very_strong' if romance_score >= 3.0
                     else 'strong' if romance_score >= 2.0
                     else 'moderate' if romance_score >= 0.5
                     else 'quiet')

    return {
        'tracks': tracks,
        'trackCount': track_count,
        'romanceScore': romance_score,
        'romanceLevel': romance_level,
    }


# ============================================================
# Sub-Function 6: 祿神/羊刃
# ============================================================

def compute_lu_yangren_analysis(
    day_master_stem: str,
    flow_year_branch: str,
    effective_gods: Dict,
    pillars: Dict,
) -> Dict[str, Any]:
    """Detect 祿神 and 羊刃 activation in the flow year."""
    dm_element = STEM_ELEMENT.get(day_master_stem, '')
    dm_role = _get_element_role(dm_element, day_master_stem, effective_gods)
    is_strong = dm_role in UNFAVORABLE_ROLES  # DM element is 忌神 when body is strong

    # 祿神
    lu_branch = LUSHEN.get(day_master_stem)
    lu_active = lu_branch == flow_year_branch
    lu_favorable = lu_active and not is_strong
    lu_warnings = []
    if lu_active:
        if is_strong:
            lu_warnings.append('身強見祿為忌，祿神反成負擔')
        # Check 祿逢沖
        lu_clash = CLASH_LOOKUP.get(lu_branch)
        chart_branches = [pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')]
        if lu_clash and lu_clash in chart_branches:
            lu_warnings.append(f'祿神{lu_branch}逢沖({lu_clash})，有失祿之象')

    # 羊刃
    yr_branch = YANGREN.get(day_master_stem)
    yr_active = yr_branch == flow_year_branch
    yr_favorable = yr_active and not is_strong  # Weak body benefits from 羊刃
    yr_danger_level = 'none'
    yr_warnings = []
    if yr_active:
        if is_strong:
            yr_danger_level = 'high'
            yr_warnings.append('身強逢羊刃，需防意外傷害、血光、手術')
        else:
            yr_danger_level = 'low'
            yr_warnings.append('身弱逢羊刃反助力，增添勇氣魄力')
        # 羊刃逢沖
        yr_clash = CLASH_LOOKUP.get(yr_branch)
        if yr_clash == flow_year_branch or (yr_clash and yr_clash in
                [pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')]):
            if yr_clash != flow_year_branch:  # Natal chart clashes 羊刃
                yr_danger_level = 'critical'
                yr_warnings.append(f'羊刃{yr_branch}逢沖({yr_clash})，「羊刃逢沖，血光之災」')

    return {
        'luShen': {
            'active': lu_active,
            'branch': lu_branch,
            'favorable': lu_favorable,
            'warnings': lu_warnings,
        },
        'yangRen': {
            'active': yr_active,
            'branch': yr_branch,
            'favorable': yr_favorable,
            'dangerLevel': yr_danger_level,
            'warnings': yr_warnings,
        },
    }


# ============================================================
# Sub-Function 7: 事業運勢
# ============================================================

def compute_annual_career_analysis(
    pillars: Dict,
    day_master_stem: str,
    flow_year_stem: str,
    flow_year_branch: str,
    effective_gods: Dict,
    shen_sha: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Analyze career implications for the flow year."""
    # Flow year ten god and its role
    flow_ten_god = derive_ten_god(day_master_stem, flow_year_stem)
    ten_god_role = effective_gods.get(flow_ten_god, '閒神')

    # 事業宮 (month branch) interaction
    month_branch = pillars['month']['branch']
    month_interactions = _check_branch_interaction(month_branch, flow_year_branch)

    # Career event signals
    signals = []

    # 官印相生: 正官/偏官 + 正印/偏印 both present
    official_gods = {'正官', '七殺'}
    seal_gods = {'正印', '偏印'}
    chart_ten_gods = set()
    for pname in ('year', 'month', 'day', 'hour'):
        tg = derive_ten_god(day_master_stem, pillars[pname]['stem'])
        chart_ten_gods.add(tg)
    chart_ten_gods.add(flow_ten_god)

    if chart_ten_gods & official_gods and chart_ten_gods & seal_gods:
        signals.append({'type': '官印相生', 'impact': 'positive',
                        'detail': '官星與印星互助，有升遷或權責提升機會'})

    # 食傷生財
    output_gods = {'食神', '傷官'}
    wealth_gods = {'正財', '偏財'}
    if chart_ten_gods & output_gods and (flow_ten_god in wealth_gods or chart_ten_gods & wealth_gods):
        signals.append({'type': '食傷生財', 'impact': 'positive',
                        'detail': '才華化為收入，創意或技能帶來財富'})

    # 傷官見官
    if '傷官' in chart_ten_gods and '正官' in chart_ten_gods:
        signals.append({'type': '傷官見官', 'impact': 'negative',
                        'detail': '傷官見官，職場是非或與上司衝突'})

    # 比劫爭官
    rivalry_gods = {'比肩', '劫財'}
    if chart_ten_gods & rivalry_gods and chart_ten_gods & official_gods:
        signals.append({'type': '比劫爭官', 'impact': 'mixed',
                        'detail': '比劫爭官，競爭激烈但也有合作機會'})

    # Shen sha career activation
    shen_sha_signals = []
    if shen_sha:
        all_sha = shen_sha.get('allShenSha', []) if isinstance(shen_sha, dict) else []
        sha_names = set()
        for sha_item in all_sha:
            if isinstance(sha_item, dict):
                sha_names.add(sha_item.get('name', ''))
            elif isinstance(sha_item, str):
                sha_names.add(sha_item)

        # Check if 驛馬 is activated by flow year
        yima_branch = YIMA.get(pillars['day']['branch'])
        if yima_branch == flow_year_branch:
            shen_sha_signals.append('驛馬星動（出差/調動/轉職）')

    return {
        'flowYearTenGod': flow_ten_god,
        'tenGodRole': ten_god_role,
        'monthBranchInteractions': month_interactions,
        'signals': signals,
        'shenShaSignals': shen_sha_signals,
        'auspiciousness': _assess_element_auspiciousness(
            STEM_ELEMENT.get(flow_year_stem, ''), day_master_stem, effective_gods),
    }


# ============================================================
# Sub-Function 8: 財運收入
# ============================================================

def compute_annual_finance_analysis(
    pillars: Dict,
    day_master_stem: str,
    flow_year_stem: str,
    flow_year_branch: str,
    effective_gods: Dict,
) -> Dict[str, Any]:
    """Analyze wealth implications for the flow year."""
    flow_ten_god = derive_ten_god(day_master_stem, flow_year_stem)
    dm_element = STEM_ELEMENT.get(day_master_stem, '')

    signals = []

    # Wealth star presence
    wealth_present = flow_ten_god in {'正財', '偏財'}
    if wealth_present:
        role = effective_gods.get(flow_ten_god, '閒神')
        if role in FAVORABLE_ROLES:
            signals.append({'type': '財星為用', 'impact': 'positive',
                            'detail': f'流年透{flow_ten_god}且為用神，正財運上升'})
        else:
            signals.append({'type': '財星為忌', 'impact': 'negative',
                            'detail': f'流年透{flow_ten_god}但為忌神，錢財難聚或因財生災'})

    # 食傷生財 chain
    output_gods = {'食神', '傷官'}
    chart_ten_gods = set()
    for pname in ('year', 'month', 'day', 'hour'):
        chart_ten_gods.add(derive_ten_god(day_master_stem, pillars[pname]['stem']))
    chart_ten_gods.add(flow_ten_god)

    if chart_ten_gods & output_gods and chart_ten_gods & {'正財', '偏財'}:
        signals.append({'type': '食傷生財', 'impact': 'positive',
                        'detail': '才華轉化為財富的連鎖反應啟動'})

    # 比劫奪財
    if flow_ten_god in {'比肩', '劫財'}:
        # Check if natal chart has exposed wealth star
        for pname in ('year', 'month', 'hour'):
            natal_tg = derive_ten_god(day_master_stem, pillars[pname]['stem'])
            if natal_tg in {'正財', '偏財'}:
                signals.append({'type': '比劫奪財', 'impact': 'negative',
                                'detail': '流年比劫與命局財星沖突，小心破財或與人爭財'})
                break

    # 財庫逢沖
    wealth_element = ELEMENT_OVERCOMES.get(dm_element)
    treasury_branch = WEALTH_TREASURY.get(wealth_element) if wealth_element else None
    if treasury_branch:
        treasury_clash = CLASH_LOOKUP.get(treasury_branch)
        if treasury_clash == flow_year_branch:
            signals.append({'type': '財庫逢沖', 'impact': 'mixed',
                            'detail': f'財庫{treasury_branch}被流年{flow_year_branch}沖開，'
                                      f'財來財去波動大'})
        # Also check if flow year IS the treasury (財庫到位)
        if flow_year_branch == treasury_branch:
            signals.append({'type': '財庫到位', 'impact': 'positive',
                            'detail': f'流年地支即為財庫{treasury_branch}，有聚財之象'})

    # DM strength condition
    dm_role = _get_element_role(dm_element, day_master_stem, effective_gods)
    is_strong = dm_role in UNFAVORABLE_ROLES
    wealth_condition = 'strong_dm' if is_strong else 'weak_dm'

    # Indirect wealth boost: 印星間接利財 (身弱/中性 + 喜用印星 → 扶身 → 增強扛財能力)
    # weak_dm includes neutral DMs — 印星 support benefits non-strong DMs regardless
    flow_ten_god_role = effective_gods.get(flow_ten_god, '閒神')
    if (flow_ten_god in {'正印', '偏印'}
            and flow_ten_god_role in FAVORABLE_ROLES
            and wealth_condition == 'weak_dm'):
        signals.append({
            'type': '印星間接利財',
            'impact': 'positive',
            'detail': '印星扶身，日主增強扛財能力，財運間接受惠',
        })

    return {
        'flowYearTenGod': flow_ten_god,
        'wealthPresent': wealth_present,
        'signals': signals,
        'wealthCondition': wealth_condition,
        'treasuryBranch': treasury_branch,
    }


# ============================================================
# Sub-Function 9: 人際關係
# ============================================================

def compute_annual_relationship_analysis(
    pillar_impacts: List[Dict],
) -> Dict[str, Any]:
    """Wrap pillar impacts into relationship narrative per palace."""
    palace_relationships = {}

    for impact in pillar_impacts:
        pname = impact['pillar']
        palace = impact['palace']
        interactions = impact['interactions']

        if not interactions:
            palace_relationships[pname] = {
                'palace': palace,
                'status': '平穩',
                'interactions': [],
            }
            continue

        # Determine status from interaction types
        has_negative = any(i.get('impact') == 'negative' or i.get('impact') == 'very_negative'
                          or i['type'] in ('六沖', '天剋地沖', '合走用神')
                          for i in interactions)
        has_positive = any(i.get('impact') == 'positive'
                          or i['type'] in ('六合', '合走忌神', '干支見祿')
                          for i in interactions)

        if has_negative and has_positive:
            status = '吉凶參半'
        elif has_negative:
            status = '需留意'
        elif has_positive:
            status = '有助力'
        else:
            status = '平穩'

        palace_relationships[pname] = {
            'palace': palace,
            'status': status,
            'interactions': [{'type': i['type'], 'detail': i['detail']} for i in interactions],
        }

    return {'palaceRelationships': palace_relationships}


# ============================================================
# Sub-Function 10: 健康狀況
# ============================================================

def compute_annual_health_analysis(
    five_elements_balance: Dict,
    flow_year_stem: str,
    flow_year_branch: str,
    effective_gods: Dict,
    day_master_stem: str,
    yangren_data: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Analyze health implications for the flow year."""
    flow_stem_element = STEM_ELEMENT.get(flow_year_stem, '')
    flow_branch_element = BRANCH_ELEMENT.get(flow_year_branch, '')

    # Flag organs based on 忌神 element in flow year
    risk_organs = []
    for element in {flow_stem_element, flow_branch_element}:
        if element and element in ELEMENT_ORGAN_MAP:
            role = _get_element_role(element, day_master_stem, effective_gods)
            if role in UNFAVORABLE_ROLES:
                organ_info = ELEMENT_ORGAN_MAP[element]
                risk_organs.append({
                    'element': element,
                    'organs': f"{organ_info['yin']}/{organ_info['yang']}",
                    'system': organ_info['system'],
                    'symptoms': organ_info['symptoms'],
                    'reason': f'流年{element}為{role}',
                    'source': 'flow_year',
                })

    # Natal chart excess/deficiency (five_elements_balance is percentages 0-100)
    element_warnings = []
    if five_elements_balance:
        for element, count in five_elements_balance.items():
            if isinstance(count, (int, float)):
                if count >= 30:
                    organ_info = ELEMENT_ORGAN_MAP.get(element, {})
                    element_warnings.append({
                        'element': element,
                        'condition': '太過',
                        'detail': f"{element}過旺(實證)，{organ_info.get('symptoms', '')}風險增加",
                        'source': 'natal',
                    })
                elif count <= 5:
                    organ_info = ELEMENT_ORGAN_MAP.get(element, {})
                    element_warnings.append({
                        'element': element,
                        'condition': '不及',
                        'detail': f"{element}缺乏(虛證)，{organ_info.get('system', '')}功能偏弱",
                        'source': 'natal',
                    })

    # 十二長生 health vitality
    life_stage = get_life_stage(day_master_stem, flow_year_branch)
    health_vitality = CHANGSHENG_HEALTH_LABELS.get(life_stage, {
        'vitality': 'unknown', 'label': ''
    })

    # Stem body part mapping
    stem_body_parts = STEM_BODY_MAP.get(flow_year_stem, '')

    # 羊刃 danger
    yangren_danger = False
    if yangren_data and yangren_data.get('yangRen', {}).get('active'):
        yr = yangren_data['yangRen']
        if yr.get('dangerLevel') in ('high', 'critical'):
            yangren_danger = True

    return {
        'riskOrgans': risk_organs,
        'elementWarnings': element_warnings,
        'lifeStage': life_stage,
        'healthVitality': health_vitality,
        'stemBodyParts': stem_body_parts,
        'yangrenDanger': yangren_danger,
    }


# ============================================================
# Sub-Function 11: 印星/家庭
# ============================================================

def compute_seal_star_analysis(
    day_master_stem: str,
    flow_year_stem: str,
    effective_gods: Dict,
) -> Dict[str, Any]:
    """Analyze seal star (印星) for family/education context."""
    flow_ten_god = derive_ten_god(day_master_stem, flow_year_stem)
    is_seal = flow_ten_god in {'正印', '偏印'}
    seal_role = effective_gods.get(flow_ten_god, '閒神') if is_seal else None

    signals = []
    if is_seal:
        if seal_role in FAVORABLE_ROLES:
            signals.append({
                'type': '印星為用',
                'detail': f'{flow_ten_god}為{seal_role}，長輩支持、學業進步、考運佳',
                'impact': 'positive',
            })
        elif seal_role in UNFAVORABLE_ROLES:
            signals.append({
                'type': '印星為忌',
                'detail': f'{flow_ten_god}為{seal_role}，過度依賴或壓力來自長輩',
                'impact': 'negative',
            })
        else:  # 閒神
            signals.append({
                'type': '印星為閒',
                'detail': f'{flow_ten_god}為{seal_role}，長輩影響中性，不吉不凶',
                'impact': 'neutral',
            })

    return {
        'flowYearTenGod': flow_ten_god,
        'isSealYear': is_seal,
        'sealRole': seal_role,
        'signals': signals,
    }


# ============================================================
# Sub-Function 11b: 間接效應鏈 (cross-section supplementary signals)
# ============================================================

def compute_indirect_effects(
    day_master_stem: str,
    flow_year_stem: str,
    effective_gods: Dict,
    wealth_condition: str,
) -> Dict[str, List[Dict[str, str]]]:
    """Cross-section indirect effect chains based on flow year ten god role.

    These signals describe chain mechanisms (e.g., 印星→生身→扛財) that span
    multiple life areas. They supplement primary section signals and should NOT
    duplicate signals already emitted by primary finance/career/health sections.
    """
    flow_ten_god = derive_ten_god(day_master_stem, flow_year_stem)
    flow_role = effective_gods.get(flow_ten_god, '閒神')

    effects: Dict[str, List[Dict[str, str]]] = {
        'health': [], 'career': [], 'finance': [], 'relationships': [],
    }

    # 印星+喜用 → 利健康 (生身養元氣)
    if flow_ten_god in {'正印', '偏印'} and flow_role in FAVORABLE_ROLES:
        effects['health'].append({
            'type': '印星護身',
            'impact': 'positive',
            'detail': '喜用印星扶身，元氣增強，整體健康有利',
        })

    # 比劫+用神 → 利事業 (朋友助力)
    if flow_ten_god in {'比肩', '劫財'} and flow_role == '用神':
        effects['career'].append({
            'type': '比劫助力',
            'impact': 'positive',
            'detail': '用神比劫助力，同儕朋友貴人相助利事業',
        })

    # 官殺+喜用 → 間接催財 (事業穩定→收入增長)
    if flow_ten_god in {'正官', '七殺'} and flow_role in FAVORABLE_ROLES:
        effects['finance'].append({
            'type': '官殺間接催財',
            'impact': 'positive',
            'detail': '官殺為用，事業穩定升遷，收入間接增長',
        })

    # 食神+喜用 → 利人際 (表達得體)
    if flow_ten_god == '食神' and flow_role in FAVORABLE_ROLES:
        effects['relationships'].append({
            'type': '食神利人緣',
            'impact': 'positive',
            'detail': '食神為用，表達得體人緣佳',
        })

    # 財星+忌+身弱 → 損健康 (追財傷身)
    if (flow_ten_god in {'正財', '偏財'}
            and flow_role in UNFAVORABLE_ROLES
            and wealth_condition == 'weak_dm'):
        effects['health'].append({
            'type': '逢財傷身',
            'impact': 'negative',
            'detail': '身弱逢財星忌神，追財傷身需注意休息',
        })

    return effects


# ============================================================
# Sub-Function 12: 十二月運程
# ============================================================

def _compute_single_month(
    month_data: Dict,
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict,
    gender: str,
    year_branch: str,
    day_branch: str,
    kong_wang: List[str],
    flow_year_auspiciousness: str,
) -> Dict[str, Any]:
    """Compute all 4 aspects for a single month."""
    month_stem = month_data.get('stem', '')
    month_branch = month_data.get('branch', '')

    if not month_stem or not month_branch:
        return {'auspiciousness': '平', 'aspects': {}}

    # Dual assessment: branch primary, stem modifier (classical: 地支主吉凶，天干輔助)
    month_ten_god = derive_ten_god(day_master_stem, month_stem)
    month_element = STEM_ELEMENT.get(month_stem, '')
    month_branch_element = BRANCH_ELEMENT.get(month_branch, '')

    stem_base = _assess_element_auspiciousness(month_element, day_master_stem, effective_gods)
    branch_base = _assess_element_auspiciousness(month_branch_element, day_master_stem, effective_gods)

    _POSITIVE_LABELS = {'大吉', '吉'}
    _NEGATIVE_LABELS = {'凶', '大凶'}

    if branch_base == '平':
        base = stem_base  # branch neutral → fall back to stem
    elif branch_base in _POSITIVE_LABELS:
        base = '吉中有凶' if stem_base in _NEGATIVE_LABELS else branch_base
    elif branch_base in _NEGATIVE_LABELS:
        base = '凶中有吉' if stem_base in _POSITIVE_LABELS else branch_base
    else:
        base = branch_base

    # Branch interactions with all 4 natal pillars
    all_branch_interactions = []
    day_branch_interactions = []
    for pname in ('year', 'month', 'day', 'hour'):
        natal_branch = pillars[pname]['branch']
        interactions = _check_branch_interaction(natal_branch, month_branch)
        for i_type in interactions:
            all_branch_interactions.append({'pillar': pname, 'type': i_type})
            if pname == 'day':
                day_branch_interactions.append(i_type)

    # Branch interaction modifiers (structural natal-vs-month clash/harmony — orthogonal to element favorability above)
    auspiciousness = base
    if '伏吟' in day_branch_interactions:
        if base in ('吉', '大吉'):
            auspiciousness = '大吉'
        elif base in ('凶', '大凶'):
            auspiciousness = '大凶'
    elif '六沖' in day_branch_interactions:
        if base == '平':
            auspiciousness = '小凶'
        elif base in ('吉', '大吉'):
            auspiciousness = '吉中有凶'
    elif '六合' in day_branch_interactions:
        if base == '平':
            auspiciousness = '吉'
        elif base in ('凶', '大凶'):
            auspiciousness = '凶中有吉'

    # Combine with flow year context
    combined = auspiciousness
    year_positive = flow_year_auspiciousness in ('大吉', '吉')
    year_negative = flow_year_auspiciousness in ('凶', '大凶')
    month_positive = auspiciousness in ('大吉', '吉')
    month_negative = auspiciousness in ('凶', '大凶', '小凶')

    if month_positive and year_positive:
        combined = '大吉'
    elif month_positive and year_negative:
        combined = '吉中有凶'
    elif month_negative and year_negative:
        combined = '凶上加凶'
    elif month_negative and year_positive:
        combined = '凶中有吉'

    # 空亡 check
    is_kong_wang = month_branch in kong_wang

    # --- 4 Aspects ---
    # Career
    month_branch_vs_month_pillar = _check_branch_interaction(
        pillars['month']['branch'], month_branch)
    career_aspect = {
        'tenGod': month_ten_god,
        'monthPillarInteractions': month_branch_vs_month_pillar,
        'signals': [],
    }
    if month_ten_god in {'正官', '七殺'}:
        career_aspect['signals'].append('官殺當令，有升遷或考核壓力')
    elif month_ten_god in {'食神', '傷官'}:
        career_aspect['signals'].append('食傷星動，利創意表現但易口舌')
    elif month_ten_god in {'比肩', '劫財'}:
        career_aspect['signals'].append('比劫當頭，競爭激烈需防小人')

    # Finance
    finance_aspect = {'signals': []}
    if month_ten_god in {'正財', '偏財'}:
        finance_aspect['signals'].append('財星透月，收入機會增加')
    elif month_ten_god in {'比肩', '劫財'}:
        finance_aspect['signals'].append('比劫克財，慎防破財或爭利')
    # 食傷生財 chain in month
    if month_ten_god in {'食神', '傷官'}:
        chart_has_wealth = any(
            derive_ten_god(day_master_stem, pillars[p]['stem']) in {'正財', '偏財'}
            for p in ('year', 'month', 'day', 'hour')
        )
        if chart_has_wealth:
            finance_aspect['signals'].append('食傷生財鏈啟動')

    # Romance
    romance_aspect = {'signals': []}
    spouse_stars = SPOUSE_STAR_MALE if gender.upper() in ('MALE', '男') else SPOUSE_STAR_FEMALE
    if month_ten_god in spouse_stars:
        romance_aspect['signals'].append(f'{month_ten_god}星現月柱，感情事件增多')
    taohua_branch = TAOHUA.get(day_branch)
    if taohua_branch and taohua_branch == month_branch:
        romance_aspect['signals'].append('月逢桃花，社交活躍')
    month_vs_day = _check_branch_interaction(day_branch, month_branch)
    if '六沖' in month_vs_day:
        romance_aspect['signals'].append('日支逢沖，感情易生波動')
    if '六合' in month_vs_day:
        romance_aspect['signals'].append('日支逢合，感情穩定融洽')

    # Health
    health_aspect = {'signals': []}
    month_br_element = BRANCH_ELEMENT.get(month_branch, '')
    month_st_element = STEM_ELEMENT.get(month_stem, '')
    for element in {month_br_element, month_st_element}:
        if element:
            role = _get_element_role(element, day_master_stem, effective_gods)
            if role in UNFAVORABLE_ROLES:
                organ_info = ELEMENT_ORGAN_MAP.get(element, {})
                if organ_info:
                    health_aspect['signals'].append(
                        f"{element}({role})當令，注意{organ_info.get('system', '')}保養"
                    )

    return {
        'monthStem': month_stem,
        'monthBranch': month_branch,
        'monthTenGod': month_ten_god,
        'stemBase': stem_base,
        'branchBase': branch_base,
        'baseAuspiciousness': base,  # branch-primary combined base (not stem-only)
        'auspiciousness': combined,
        'isKongWang': is_kong_wang,
        'branchInteractions': all_branch_interactions,
        'aspects': {
            'career': career_aspect,
            'finance': finance_aspect,
            'romance': romance_aspect,
            'health': health_aspect,
        },
    }


def compute_enhanced_monthly_forecasts(
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict,
    monthly_stars: List[Dict],
    gender: str,
    year_branch: str,
    day_branch: str,
    kong_wang: List[str],
    flow_year_auspiciousness: str,
) -> List[Dict[str, Any]]:
    """Compute 12 months' 4-aspect forecasts. 大運 excluded."""
    results = []
    for i, month_data in enumerate(monthly_stars):
        if i >= 12:
            break
        month_result = _compute_single_month(
            month_data=month_data,
            pillars=pillars,
            day_master_stem=day_master_stem,
            effective_gods=effective_gods,
            gender=gender,
            year_branch=year_branch,
            day_branch=day_branch,
            kong_wang=kong_wang,
            flow_year_auspiciousness=flow_year_auspiciousness,
        )
        month_result['monthIndex'] = i + 1
        month_result['monthLabel'] = month_data.get('month', f'{i+1}月')
        results.append(month_result)

    return results


# ============================================================
# 大運 Context (shallow)
# ============================================================

def _extract_dayun_context(
    luck_periods: List[Dict],
    current_year: int,
    day_master_stem: str,
    effective_gods: Dict,
) -> Dict[str, Any]:
    """Extract current 大運 backdrop info."""
    # Import from career_enhanced
    from .career_enhanced import _find_active_luck_period

    active_lp = _find_active_luck_period(luck_periods, current_year)
    if not active_lp:
        return {
            'available': False,
            'note': '目前尚未進入大運階段',
        }

    lp_stem = active_lp.get('stem', '')
    lp_branch = active_lp.get('branch', '')
    lp_ten_god = derive_ten_god(day_master_stem, lp_stem) if lp_stem else ''
    lp_role = effective_gods.get(lp_ten_god, '閒神') if lp_ten_god else '閒神'

    if lp_role in FAVORABLE_ROLES:
        favorability = '有利'
    elif lp_role in UNFAVORABLE_ROLES:
        favorability = '不利'
    else:
        favorability = '中性'

    # Expand hidden stems of 大運 branch for supplementary context
    lp_hidden_stems = []
    for hs in HIDDEN_STEMS.get(lp_branch, []):
        hs_ten_god = derive_ten_god(day_master_stem, hs)
        hs_role = effective_gods.get(hs_ten_god, '閒神') if hs_ten_god else '閒神'
        lp_hidden_stems.append({'stem': hs, 'tenGod': hs_ten_god, 'role': hs_role})

    return {
        'available': True,
        'stem': lp_stem,
        'branch': lp_branch,
        'tenGod': lp_ten_god,
        'role': lp_role,
        'startYear': active_lp.get('startYear', 0),
        'endYear': active_lp.get('endYear', 0),
        'favorability': favorability,
        'hiddenStems': lp_hidden_stems,
        'label': f'目前大運{lp_stem}{lp_branch}({lp_ten_god})對你{favorability}',
        'note': '流年為君，大運為臣 — 流年運勢以當年干支為主，大運提供背景影響。'
                '如需深入了解您的大運走勢，請參考八字終身運分析。',
    }


# ============================================================
# Master Orchestrator
# ============================================================

def generate_annual_pre_analysis(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    five_elements_balance: Dict,
    effective_gods: Dict,
    prominent_god: str,
    strength_v2: Optional[Dict] = None,
    cong_ge: Optional[Dict] = None,
    luck_periods: Optional[List[Dict]] = None,
    annual_stars: Optional[List[Dict]] = None,
    monthly_stars: Optional[List[Dict]] = None,
    kong_wang: Optional[List[str]] = None,
    branch_relationships: Any = None,
    birth_year: int = 0,
    current_year: int = 2026,
    shen_sha: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Master orchestrator for annual pre-analysis."""

    # Input validation
    if birth_year and current_year < birth_year:
        raise ValueError(f'target year {current_year} is before birth year {birth_year}')
    if birth_year and current_year > birth_year + 120:
        raise ValueError(f'target year {current_year} exceeds reasonable range')

    luck_periods = luck_periods or []
    monthly_stars = monthly_stars or []
    kong_wang = kong_wang or []

    # Determine flow year stem and branch from annual_stars
    flow_year_stem = ''
    flow_year_branch = ''
    if annual_stars:
        for star in annual_stars:
            if star.get('year') == current_year:
                flow_year_stem = star.get('stem', '')
                flow_year_branch = star.get('branch', '')
                break
        # Fallback: use first annual star for the target year
        if not flow_year_stem and annual_stars:
            flow_year_stem = annual_stars[0].get('stem', '')
            flow_year_branch = annual_stars[0].get('branch', '')

    if not flow_year_stem or not flow_year_branch:
        return {'error': 'Cannot determine flow year stem/branch'}

    year_branch = pillars['year']['branch']
    day_branch = pillars['day']['branch']

    # Normalize effective_gods from engine format to ten-god-keyed format
    normalized_gods = _normalize_effective_gods_for_annual(effective_gods, day_master_stem)

    # 1. 太歲分析
    tai_sui = compute_tai_sui_analysis(
        pillars, flow_year_branch, day_master_stem, normalized_gods)

    # 2. 干支通氣/蓋頭/截腳
    flow_year_harmony = assess_flow_year_harmony(flow_year_stem, flow_year_branch)

    # 3. 四柱交互分析
    pillar_impacts = compute_pillar_impact_analysis(
        pillars, day_master_stem, flow_year_stem, flow_year_branch, normalized_gods)

    # 4. 夫妻宮分析
    spouse_palace = compute_spouse_palace_analysis(
        pillars, day_master_stem, flow_year_stem, flow_year_branch, gender)

    # 5. 姻緣星 5-track
    marriage_star = compute_marriage_star_analysis(
        day_master_stem, flow_year_stem, flow_year_branch,
        year_branch, day_branch, gender, spouse_palace)

    # 6. 祿神/羊刃
    lu_yangren = compute_lu_yangren_analysis(
        day_master_stem, flow_year_branch, normalized_gods, pillars)

    # 7. 事業運勢
    career = compute_annual_career_analysis(
        pillars, day_master_stem, flow_year_stem, flow_year_branch,
        normalized_gods, shen_sha)

    # 8. 財運收入
    finance = compute_annual_finance_analysis(
        pillars, day_master_stem, flow_year_stem, flow_year_branch, normalized_gods)

    # 9. 人際關係
    relationships = compute_annual_relationship_analysis(pillar_impacts)

    # 10. 健康狀況
    health = compute_annual_health_analysis(
        five_elements_balance, flow_year_stem, flow_year_branch,
        normalized_gods, day_master_stem, lu_yangren)

    # 11. 印星/家庭
    seal_star = compute_seal_star_analysis(
        day_master_stem, flow_year_stem, normalized_gods)

    # 11b. 間接效應鏈
    indirect_effects = compute_indirect_effects(
        day_master_stem, flow_year_stem, normalized_gods,
        finance.get('wealthCondition', 'weak_dm'))

    # Overall flow year auspiciousness
    flow_year_element = STEM_ELEMENT.get(flow_year_stem, '')
    flow_year_auspiciousness = _assess_element_auspiciousness(
        flow_year_element, day_master_stem, normalized_gods)

    # 12. 十二月運程
    monthly_forecasts = compute_enhanced_monthly_forecasts(
        pillars, day_master_stem, normalized_gods, monthly_stars,
        gender, year_branch, day_branch, kong_wang, flow_year_auspiciousness)

    # 大運 context
    dayun_context = _extract_dayun_context(
        luck_periods, current_year, day_master_stem, normalized_gods)

    return {
        'flowYear': {
            'stem': flow_year_stem,
            'branch': flow_year_branch,
            'year': current_year,
            'tenGod': derive_ten_god(day_master_stem, flow_year_stem),
            'auspiciousness': flow_year_auspiciousness,
        },
        'taiSui': tai_sui,
        'flowYearHarmony': flow_year_harmony,
        'pillarImpacts': pillar_impacts,
        'spousePalace': spouse_palace,
        'marriageStar': marriage_star,
        'luYangRen': lu_yangren,
        'career': career,
        'finance': finance,
        'relationships': relationships,
        'health': health,
        'sealStar': seal_star,
        'indirectEffects': indirect_effects,
        'monthlyForecasts': monthly_forecasts,
        'dayunContext': dayun_context,
        'deterministic': {
            'flowYearStem': flow_year_stem,
            'flowYearBranch': flow_year_branch,
            'flowYearTenGod': derive_ten_god(day_master_stem, flow_year_stem),
            'flowYearAuspiciousness': flow_year_auspiciousness,
            'taiSuiSummary': tai_sui.get('summary', ''),
            'hasTaiSui': tai_sui.get('hasTaiSui', False),
            'dayunLabel': dayun_context.get('label', ''),
            'romanceLevel': marriage_star.get('romanceLevel', ''),
            'hasIndirectEffects': any(len(v) > 0 for v in indirect_effects.values()),
            'monthlyAuspiciousness': [
                {'month': m.get('monthIndex', 0), 'auspiciousness': m.get('auspiciousness', '平')}
                for m in monthly_forecasts
            ],
        },
    }
