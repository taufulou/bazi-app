"""
Compatibility Pre-Analysis for AI Narration Layer.

Transforms the raw 8-dimension compatibility engine output into a rich,
structured JSON for AI narration. Every cross-chart relationship is
PRE-COMPUTED here — the AI narrates but never computes.

This follows the project's three-layer architecture:
  Layer 1: calculator.py (raw Bazi calculation)
  Layer 2: THIS FILE (deterministic cross-chart pre-analysis)
  Layer 3: AI narration (NestJS prompts.ts)
"""

from typing import Dict, List, Optional, Tuple

from .compatibility_constants import (
    COMPATIBILITY_LABELS,
    GOD_ROLES,
    LIUHE_RESULT_ELEMENT,
    LIUCHONG_SEVERITY,
    TEN_GOD_ROMANCE_SCORES,
    WEIGHT_TABLE,
    YONGSHEN_MATRIX,
)
from .constants import (
    BRANCH_ELEMENT,
    ELEMENT_OVERCOMES,
    ELEMENT_PRODUCES,
    FIVE_ELEMENTS,
    HIDDEN_STEMS,
    STEM_ELEMENT,
    STEM_YINYANG,
)
from .ten_gods import derive_ten_god


# ============================================================
# Ten God Cross-Chart Meaning Maps
# ============================================================

# What it means when A's DM appears as a specific Ten God in B's chart
# Each entry: {romance_meaning, business_meaning, friendship_meaning}
CROSS_TEN_GOD_MEANINGS: Dict[str, Dict[str, str]] = {
    '正財': {
        'romance_male': '你是對方眼中的理想伴侶，代表穩定的感情承諾',
        'romance_female': '你是對方的財源貴人，但感情上較偏務實',
        'business': '你是對方的財源助力，合作有利可圖',
        'friendship': '你是對方生活中的穩定力量',
    },
    '偏財': {
        'romance_male': '你對對方有強烈的異性吸引力，但可能不夠穩定',
        'romance_female': '你是對方的社交財源，感情上偏向曖昧',
        'business': '你帶來意外商機，適合投資合夥',
        'friendship': '你帶給對方社交歡樂和意外驚喜',
    },
    '正官': {
        'romance_male': '你是對方敬重的對象，但可能覺得有壓力',
        'romance_female': '你是對方心中的理想丈夫/長期伴侶',
        'business': '你是對方的管理者或指導者',
        'friendship': '你是對方尊敬的朋友，有約束力',
    },
    '偏官': {
        'romance_male': '你給對方刺激感和挑戰，吸引力強但不安定',
        'romance_female': '你是對方的情人類型，有激情但難駕馭',
        'business': '你是對方的競爭對手或鞭策者',
        'friendship': '你帶給對方壓力和挑戰，但能激發潛力',
    },
    '食神': {
        'romance_male': '你帶給對方歡樂和創意，相處輕鬆愉快',
        'romance_female': '你帶給對方歡樂和創意，相處輕鬆愉快',
        'business': '你是對方的創意來源和表達管道',
        'friendship': '你是對方的開心果，在一起總是很快樂',
    },
    '傷官': {
        'romance_male': '你激發對方的表現欲，但可能引起口角',
        'romance_female': '你可能挑戰對方的權威感，需要注意相處方式',
        'business': '你是對方的創新推手，但容易意見衝突',
        'friendship': '你是對方的靈感來源，但有時太直言不諱',
    },
    '正印': {
        'romance_male': '你是對方的精神支柱，給予安全感和包容',
        'romance_female': '你是對方的靈魂伴侶，提供精神上的慰藉',
        'business': '你是對方的導師和後盾',
        'friendship': '你是對方信賴的知己，有教化之恩',
    },
    '偏印': {
        'romance_male': '你給對方孤獨感的療癒，但彼此可能都不善表達',
        'romance_female': '你懂對方的獨特想法，但需注意疏離感',
        'business': '你帶來非主流觀點，適合研發合作',
        'friendship': '你是對方思想上的知音，但往來不頻繁',
    },
    '比肩': {
        'romance_male': '你和對方像朋友一樣平等，但缺少浪漫火花',
        'romance_female': '你和對方像朋友一樣平等，但缺少浪漫火花',
        'business': '你和對方旗鼓相當，可以平等合作',
        'friendship': '你們是最對等的朋友，志同道合',
    },
    '劫財': {
        'romance_male': '你和對方存在競爭關係，感情中有搶奪意味',
        'romance_female': '你和對方存在競爭關係，感情中有搶奪意味',
        'business': '你和對方容易爭奪資源，合作需慎重',
        'friendship': '你們容易互相比較，友誼中帶有競爭',
    },
}

# Spouse star implications
SPOUSE_STAR_STATUS: Dict[str, str] = {
    'transparent_month': '透干且旺相，對婚姻態度積極且明確',
    'transparent_year': '透干在年柱，婚姻觀受家庭影響深',
    'transparent_hour': '透干在時柱，晚年感情生活豐富',
    'hidden_day': '藏在日支（配偶宮），內心渴望穩定感情但不善表達',
    'hidden_other': '藏而不透，感情態度較為被動',
    'absent': '命盤中未見明確配偶星，婚姻態度較為隨緣',
    'multiple': '配偶星出現多處，感情機會多但需慎選',
}

# Landmine trigger categories
LANDMINE_TRIGGERS: Dict[str, Dict[str, str]] = {
    'money': {
        'trigger': '金錢議題',
        'icon': '💰',
    },
    'control': {
        'trigger': '控制與權力',
        'icon': '⚡',
    },
    'communication': {
        'trigger': '溝通方式',
        'icon': '💬',
    },
    'independence': {
        'trigger': '個人空間',
        'icon': '🏠',
    },
    'family': {
        'trigger': '家庭關係',
        'icon': '👨‍👩‍👧',
    },
    'career': {
        'trigger': '事業選擇',
        'icon': '💼',
    },
    'values': {
        'trigger': '價值觀差異',
        'icon': '🎯',
    },
    'emotions': {
        'trigger': '情緒處理',
        'icon': '❤️',
    },
    'loyalty': {
        'trigger': '忠誠度',
        'icon': '🔒',
    },
    'timing': {
        'trigger': '人生節奏',
        'icon': '⏰',
    },
}

# Five-element trait meanings (for narrativeHint generation)
ELEMENT_MEANINGS: Dict[str, str] = {
    '木': '成長力、規劃能力、仁慈與耐心',
    '火': '行動力、表現力、熱情與社交',
    '土': '穩定性、信任感、包容與承載',
    '金': '決斷力、原則性、忠誠與紀律',
    '水': '智慧、靈活性、溝通與適應力',
}


def _compute_branch_element_hint(day_branch_a: str, day_branch_b: str) -> str:
    """Pre-compute the element relationship between two spouse palaces.

    Returns a deterministic narrative hint describing the element interaction
    so the AI never needs to derive 五行生剋 relationships itself.
    """
    elem_a = BRANCH_ELEMENT.get(day_branch_a, '')
    elem_b = BRANCH_ELEMENT.get(day_branch_b, '')
    if not elem_a or not elem_b:
        return ''

    prefix = f'你的配偶宮{day_branch_a}屬{elem_a}，對方配偶宮{day_branch_b}屬{elem_b}。'

    if elem_a == elem_b:
        return f'{prefix}同屬{elem_a}，代表生活節奏相近，容易產生共鳴但也可能缺少互補。'
    elif ELEMENT_PRODUCES.get(elem_a) == elem_b:
        return f'{prefix}{elem_a}生{elem_b}，你的能量自然滋養對方，形成支持型關係。'
    elif ELEMENT_PRODUCES.get(elem_b) == elem_a:
        return f'{prefix}{elem_b}生{elem_a}，對方的能量自然滋養你，形成被照顧型關係。'
    elif ELEMENT_OVERCOMES.get(elem_a) == elem_b:
        return f'{prefix}{elem_a}剋{elem_b}，在日常相處中你可能無意中壓制對方，需要刻意平衡。'
    elif ELEMENT_OVERCOMES.get(elem_b) == elem_a:
        return f'{prefix}{elem_b}剋{elem_a}，在日常相處中對方可能無意中壓制你，需要刻意平衡。'
    else:
        return f'{prefix}{elem_a}與{elem_b}無直接生剋關係，日常互動較為中性。'


# ============================================================
# Cross-Chart Ten God Analysis
# ============================================================

def _get_cross_ten_god_meaning(ten_god: str, comparison_type: str,
                                gender_of_chart_owner: str) -> str:
    """Get the meaning of a ten god in cross-chart context."""
    meanings = CROSS_TEN_GOD_MEANINGS.get(ten_god, {})
    if comparison_type == 'romance':
        key = f'romance_{gender_of_chart_owner}'
        return meanings.get(key, meanings.get('romance_male', ''))
    elif comparison_type == 'business':
        return meanings.get('business', '')
    else:
        return meanings.get('friendship', '')


def _analyze_spouse_star(
    pillars: Dict, day_master_stem: str, gender: str,
    ten_god_findings: Optional[List[Dict]] = None,
) -> Dict:
    """Analyze spouse star visibility and position for one person.

    Returns detailed spouse star analysis including:
    - What the spouse star is (正財 for male, 正官 for female)
    - Where it appears (which pillars)
    - Whether it's transparent (透干) or hidden (藏)
    - Interpretation of its status
    """
    spouse_star = '正財' if gender == 'male' else '正官'
    romance_star = '偏財' if gender == 'male' else '偏官'

    # Find spouse star in manifest stems (non-day pillars)
    manifest_positions: List[str] = []
    for pname in ('year', 'month', 'hour'):
        stem = pillars[pname]['stem']
        tg = derive_ten_god(day_master_stem, stem)
        if tg == spouse_star:
            manifest_positions.append(pname)

    # Check day branch hidden stems
    day_branch = pillars['day']['branch']
    hidden = HIDDEN_STEMS.get(day_branch, [])
    in_day_branch = False
    for hs in hidden:
        if derive_ten_god(day_master_stem, hs) == spouse_star:
            in_day_branch = True
            break

    # Determine transparency status
    if manifest_positions:
        if len(manifest_positions) > 1:
            status_key = 'multiple'
        else:
            status_key = f'transparent_{manifest_positions[0]}'
    elif in_day_branch:
        status_key = 'hidden_day'
    else:
        # Check other branches
        found_hidden = False
        for pname in ('year', 'month', 'hour'):
            branch = pillars[pname]['branch']
            for hs in HIDDEN_STEMS.get(branch, []):
                if derive_ten_god(day_master_stem, hs) == spouse_star:
                    found_hidden = True
                    break
            if found_hidden:
                break
        status_key = 'hidden_other' if found_hidden else 'absent'

    status_desc = SPOUSE_STAR_STATUS.get(status_key, '')

    # Build position description
    position_zh_map = {'year': '年柱', 'month': '月柱', 'day': '日支', 'hour': '時柱'}
    positions_zh = []
    if manifest_positions:
        positions_zh.extend(f'{position_zh_map[p]}透干' for p in manifest_positions)
    if in_day_branch:
        positions_zh.append('日支藏干')

    return {
        'star': spouse_star,
        'romanceStar': romance_star,
        'positions': manifest_positions + (['day'] if in_day_branch else []),
        'positionsZh': '、'.join(positions_zh) if positions_zh else '未見',
        'isTransparent': len(manifest_positions) > 0,
        'inSpousePalace': in_day_branch,
        'status': status_key,
        'implication': status_desc,
    }


def _build_cross_ten_gods(
    chart_a: Dict, chart_b: Dict,
    gender_a: str, gender_b: str,
    comparison_type: str,
) -> Dict:
    """Build the cross-chart Ten God analysis.

    Returns:
        Dict with a_daymaster_in_b, b_daymaster_in_a, a_spouse_star, b_spouse_star
    """
    dm_a = chart_a['dayMasterStem']
    dm_b = chart_b['dayMasterStem']
    pillars_a = chart_a['fourPillars']
    pillars_b = chart_b['fourPillars']

    # A's DM as ten god in B's chart
    tg_a_in_b = derive_ten_god(dm_b, dm_a)
    meaning_a_in_b = _get_cross_ten_god_meaning(tg_a_in_b, comparison_type, gender_b)

    # B's DM as ten god in A's chart
    tg_b_in_a = derive_ten_god(dm_a, dm_b)
    meaning_b_in_a = _get_cross_ten_god_meaning(tg_b_in_a, comparison_type, gender_a)

    # Spouse star analysis for each person
    spouse_a = _analyze_spouse_star(pillars_a, dm_a, gender_a)
    spouse_b = _analyze_spouse_star(pillars_b, dm_b, gender_b)

    # Check if A's DM element matches B's spouse star element
    elem_a = STEM_ELEMENT[dm_a]
    elem_b = STEM_ELEMENT[dm_b]
    a_is_b_spouse_element = (
        (gender_b == 'male' and ELEMENT_OVERCOMES.get(elem_b) == elem_a) or
        (gender_b == 'female' and ELEMENT_OVERCOMES.get(elem_a) == elem_b)
    )
    b_is_a_spouse_element = (
        (gender_a == 'male' and ELEMENT_OVERCOMES.get(elem_a) == elem_b) or
        (gender_a == 'female' and ELEMENT_OVERCOMES.get(elem_b) == elem_a)
    )

    return {
        'aDaymasterInB': {
            'tenGod': tg_a_in_b,
            'meaning': f'你在對方命盤中扮演{tg_a_in_b}角色',
            'forComparison': meaning_a_in_b,
            'isSpouseStarElement': a_is_b_spouse_element,
        },
        'bDaymasterInA': {
            'tenGod': tg_b_in_a,
            'meaning': f'對方在你命盤中扮演{tg_b_in_a}角色',
            'forComparison': meaning_b_in_a,
            'isSpouseStarElement': b_is_a_spouse_element,
        },
        'aSpouseStar': spouse_a,
        'bSpouseStar': spouse_b,
    }


# ============================================================
# Pillar Findings Summarizer
# ============================================================

def _build_pillar_findings(
    compat_result: Dict,
    day_branch_a: str = '',
    day_branch_b: str = '',
    enemy_elements: Optional[List[str]] = None,
    taboo_elements: Optional[List[str]] = None,
) -> List[Dict]:
    """Extract and enrich the most significant pillar-level findings.

    Combines findings from all 8 dimensions into a prioritized list
    with narrative hints for the AI.

    Args:
        enemy_elements: List of element strings that are enemy gods for either person.
        taboo_elements: List of element strings that are taboo gods for either person.
    """
    findings: List[Dict] = []
    dim_scores = compat_result.get('dimensionScores', {})
    special = compat_result.get('specialFindings', {})

    # 天合地合 (highest significance)
    if special.get('tianHeDiHe'):
        detail = special.get('tianHeDiHeDetail') or {}
        findings.append({
            'type': '天合地合',
            'significance': 'critical',
            'description': detail.get('description', '日柱天合地合'),
            'narrativeHint': '天合地合是合盤中最頂級的正面信號，僅約1.7%的組合會出現。'
                            '天干合代表精神契合，地支合代表生活習慣融洽，兩者兼具極為難得。',
        })

    # Day stem combination (high significance)
    dim2 = dim_scores.get('dayStemRelationship', {})
    combo_name = special.get('combinationName')
    if combo_name:
        hua_quality = special.get('huaHuaQuality', 'neutral')
        quality_desc = {
            'best': '合化元素為雙方用神，化學反應極佳',
            'neutral': '合化元素為閒神，化學反應尚可',
            'harmful': '合化元素為忌神，雖然相吸引但可能帶來困擾',
        }
        for f in dim2.get('findings', []):
            if f.get('type') == '天干五合':
                findings.append({
                    'type': '天干五合',
                    'significance': 'high',
                    'pillarsInvolved': f.get('detail', ''),
                    'combinationName': combo_name,
                    'huaHuaQuality': hua_quality,
                    'description': f"{f.get('detail', '')}（{combo_name}）",
                    'narrativeHint': f'日干天干合是合盤中最有力的正面信號之一。'
                                    f'{quality_desc.get(hua_quality, "")}',
                })
                break

    # 丁壬 warning
    if special.get('dinRenWarning'):
        findings.append({
            'type': '丁壬合警示',
            'significance': 'medium',
            'description': '丁壬合（淫慝之合）',
            'narrativeHint': '丁壬合雖有強烈的吸引力，但古籍稱之為「淫慝之合」，'
                            '雙方需特別注意感情專一度。',
        })

    # Spouse palace findings (dim3) — Phase 12i adds 三刑/半刑/子卯刑
    dim3 = dim_scores.get('spousePalace', {})
    # Severity map: high = 天剋地沖/六合/三刑/子卯刑; medium = 六沖/六害/自刑/半刑
    HIGH_SIG_TYPES = {'天剋地沖', '六合', '三刑', '子卯刑'}
    SUPPORTED_TYPES = (
        '六合', '六沖', '天剋地沖', '自刑', '六害',
        '子卯刑', '三刑', '半刑',
    )
    for f in dim3.get('findings', []):
        ftype = f.get('type', '')
        if ftype in SUPPORTED_TYPES:
            sig = 'high' if ftype in HIGH_SIG_TYPES else 'medium'
            # Phase 12i: prefer pre-rendered narrativeHint from engine
            # (子卯刑/三刑/半刑 emit their own hint with name/third branch
            # already substituted). Legacy types fall back to hint_map.
            hint_map = {
                '六合': '配偶宮六合代表生活習慣容易磨合，日常相處融洽',
                '六沖': '配偶宮六沖代表生活節奏差異大，需要刻意經營',
                '天剋地沖': '天剋地沖是合盤中最嚴重的負面信號，需特別留意相處方式',
                '自刑': '雙方配偶宮自刑，可能在感情中重蹈覆轍',
                '六害': '配偶宮六害，相處中容易有暗中的不滿與猜疑',
            }
            base_hint = f.get('narrativeHint') or hint_map.get(ftype, '')
            element_hint = _compute_branch_element_hint(day_branch_a, day_branch_b)
            if element_hint:
                final_hint = f'{base_hint}。{element_hint}' if base_hint else element_hint
            else:
                final_hint = base_hint
            findings.append({
                'type': ftype,
                'significance': sig,
                'description': f.get('detail', ''),
                'quality': f.get('quality'),
                'narrativeHint': final_hint,
            })

    # 天德/月德 mitigation
    if special.get('tianDeMitigatesClash'):
        findings.append({
            'type': '天德月德化解',
            'significance': 'medium',
            'description': '天德/月德化解部分負面影響',
            'narrativeHint': '命帶天德或月德貴人可以減緩沖剋的不良影響，是難得的保護力量。',
        })

    # 官殺混雜
    gshz = special.get('guanShaHunZa')
    if gshz and gshz.get('detected'):
        findings.append({
            'type': '官殺混雜',
            'significance': 'high',
            'description': gshz.get('severity', '跨盤官殺混雜'),
            'narrativeHint': '跨盤官殺混雜代表感情中可能有第三者介入的風險，'
                            '需要特別維護感情專一性。',
        })

    # 傷官見官
    sgjg = special.get('shangGuanJianGuan')
    if sgjg and sgjg.get('detected'):
        findings.append({
            'type': '傷官見官',
            'significance': 'high',
            'description': '跨盤傷官見官',
            'narrativeHint': '傷官見官在合盤中代表一方可能挑戰另一方的權威，'
                            '容易產生衝突和口角。',
        })

    # Cross-chart 三合 from dim6
    dim6 = dim_scores.get('fullPillarInteraction', {})
    _enemy = set(enemy_elements or [])
    _taboo = set(taboo_elements or [])
    for sanhe in dim6.get('crossSanhe', []):
        branches_str = ''.join(sanhe.get('branches', []))
        result_element = sanhe.get('resultElement', '')
        element_meaning = ELEMENT_MEANINGS.get(result_element, '')
        is_yongshen = sanhe.get('isYongshen', False)

        if element_meaning:
            sanhe_hint = (
                f'{branches_str}三合{result_element}局。'
                f'{result_element}代表{element_meaning}。'
                f'你們在一起時這些能量會被放大。'
            )
            if is_yongshen:
                sanhe_hint += '且為用神元素，對雙方命格有額外加持。'
            elif result_element in _enemy:
                sanhe_hint += (
                    f'但{result_element}是其中一方的仇神，'
                    f'這股能量放大後也可能帶來負面影響，需要留意。'
                )
            elif result_element in _taboo:
                sanhe_hint += (
                    f'但{result_element}是其中一方的忌神，'
                    f'過多的{result_element}能量可能加重命格負擔。'
                )
        else:
            sanhe_hint = '跨盤三合代表雙方某些方面的能量可以匯聚成更強的力量。'

        findings.append({
            'type': '跨盤三合',
            'significance': 'medium',
            'description': f'{branches_str}三合{result_element}',
            'isYongshen': is_yongshen,
            'narrativeHint': sanhe_hint,
        })

    # Cross-chart 三刑 from dim6
    for sanxing in dim6.get('crossSanxing', []):
        findings.append({
            'type': '跨盤三刑',
            'significance': 'high',
            'description': f"{''.join(sanxing.get('branches', []))}三刑",
            'narrativeHint': '跨盤三刑是嚴重的負面信號，雙方在某些情境下容易互相傷害。',
        })

    # Cross-chart branch relationships (六合/六沖/六害/六破) from dim6 findings
    pillar_name_zh = {
        'year': '年柱', 'month': '月柱', 'day': '日柱', 'hour': '時柱',
    }
    branch_hint_map = {
        '六合': '六合代表相合之力，讓這兩個柱位的能量互相吸引、協調。',
        '六沖': '六沖代表衝突與變動，這兩個柱位的能量互相排斥，需要注意相關方面的摩擦。',
        '六害': '六害代表暗中的不和諧，表面看不出問題但容易產生猜疑和暗傷。',
        '六破': '六破代表破壞與消耗，需留意這兩個柱位所代表領域的問題。',
    }
    for bf in dim6.get('findings', []):
        btype = bf.get('type', '')
        if btype in branch_hint_map:
            detail = bf.get('detail', '')
            pillar_a_name = pillar_name_zh.get(bf.get('pillarA', ''), '')
            pillar_b_name = pillar_name_zh.get(bf.get('pillarB', ''), '')
            effect = bf.get('effect', '')
            sig = 'medium' if effect == 'positive' else 'medium'
            hint = (
                f'你的{pillar_a_name}與對方{pillar_b_name}形成{detail}。'
                f'{branch_hint_map[btype]}'
            )
            findings.append({
                'type': f'跨盤{btype}',
                'significance': sig,
                'description': detail,
                'effect': effect,
                'narrativeHint': hint,
            })

    # Sort by significance
    sig_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
    findings.sort(key=lambda x: sig_order.get(x.get('significance', 'low'), 3))

    return findings


# ============================================================
# Landmine Generator
# ============================================================

def _generate_landmines(
    compat_result: Dict,
    pre_analysis_a: Dict,
    pre_analysis_b: Dict,
    chart_a: Dict,
    chart_b: Dict,
    gender_a: str,
    gender_b: str,
    comparison_type: str,
) -> List[Dict]:
    """Generate specific landmine warnings based on cross-chart analysis.

    Each landmine has: trigger, warning, avoidBehavior, suggestion, severity, dataSource.
    Returns 3-5 most relevant landmines.
    """
    landmines: List[Dict] = []
    dim_scores = compat_result.get('dimensionScores', {})
    special = compat_result.get('specialFindings', {})
    gods_a = pre_analysis_a.get('effectiveFavorableGods', {})
    gods_b = pre_analysis_b.get('effectiveFavorableGods', {})
    dm_a = chart_a['dayMasterStem']
    dm_b = chart_b['dayMasterStem']
    elem_a = STEM_ELEMENT[dm_a]
    elem_b = STEM_ELEMENT[dm_b]

    # 1. Money landmine: 偏財/正財 conflict
    ten_god_a_in_b = derive_ten_god(dm_b, dm_a)
    ten_god_b_in_a = derive_ten_god(dm_a, dm_b)
    wealth_gods = {'正財', '偏財'}
    if ten_god_a_in_b in wealth_gods or ten_god_b_in_a in wealth_gods:
        # Check if wealth is taboo for either
        taboo_a = gods_a.get('tabooGod', '')
        taboo_b = gods_b.get('tabooGod', '')
        elem_wealth_a = ELEMENT_OVERCOMES.get(elem_a, '')
        elem_wealth_b = ELEMENT_OVERCOMES.get(elem_b, '')
        if taboo_a == elem_wealth_a or taboo_b == elem_wealth_b:
            landmines.append({
                'severity': 'high',
                'trigger': '金錢議題',
                'warning': '一方的財星五行恰為另一方的忌神，金錢觀差異大',
                'avoidBehavior': '避免一方掌控所有財務決策',
                'suggestion': '建議設立共同帳戶，大額支出共同商議',
                'dataSource': f'財星五行互動分析',
            })

    # 2. Control landmine: 官殺 cross-chart
    control_gods = {'正官', '偏官'}
    if ten_god_a_in_b in control_gods or ten_god_b_in_a in control_gods:
        controller = '你' if ten_god_a_in_b in control_gods else '對方'
        controlled = '對方' if controller == '你' else '你'
        landmines.append({
            'severity': 'medium',
            'trigger': '控制與權力',
            'warning': f'{controller}在{controlled}命盤中扮演管束角色，容易形成不對等關係',
            'avoidBehavior': f'避免{controller}過度干涉{controlled}的決定',
            'suggestion': '重要決定共同商議，給予彼此決策空間',
            'dataSource': f'十神交叉：{controller}為{controlled}的{ten_god_a_in_b if controller == "你" else ten_god_b_in_a}',
        })

    # 3. Communication landmine: 傷官 involvement
    if ten_god_a_in_b == '傷官' or ten_god_b_in_a == '傷官':
        who = '你' if ten_god_a_in_b == '傷官' else '對方'
        landmines.append({
            'severity': 'medium',
            'trigger': '溝通方式',
            'warning': f'{who}的表達方式可能過於直接犀利，容易無意中傷害對方',
            'avoidBehavior': '避免在情緒激動時討論敏感話題',
            'suggestion': '學習先表達感受再討論事情，避免人身攻擊式的溝通',
            'dataSource': f'十神交叉：{who}為對方的傷官',
        })

    # 4. 官殺混雜 landmine
    gshz = special.get('guanShaHunZa')
    if gshz and gshz.get('detected'):
        landmines.append({
            'severity': 'high',
            'trigger': '忠誠度',
            'warning': '跨盤官殺混雜，感情中可能有第三者介入的隱患',
            'avoidBehavior': '避免過於開放的社交模式，減少曖昧互動',
            'suggestion': '明確感情界線，重視伴侶的安全感需求',
            'dataSource': '跨盤官殺混雜檢測',
        })

    # 5. 丁壬合 loyalty landmine
    if special.get('dinRenWarning'):
        landmines.append({
            'severity': 'medium',
            'trigger': '忠誠度',
            'warning': '丁壬合（淫慝之合）代表強烈的相互吸引，但也暗示感情專一度需要經營',
            'avoidBehavior': '避免將對外的社交魅力帶入私密關係中造成不安',
            'suggestion': '珍惜彼此的吸引力，將這股能量轉化為感情的黏著劑',
            'dataSource': '日干丁壬合（淫慝之合）',
        })

    # 6. Element imbalance landmine
    dim5 = dim_scores.get('elementComplementarity', {})
    if dim5.get('rawScore', 50) < 35:
        landmines.append({
            'severity': 'medium',
            'trigger': '價值觀差異',
            'warning': '雙方五行結構差異較大，處事風格和思維模式有顯著不同',
            'avoidBehavior': '避免期待對方完全理解自己的思維方式',
            'suggestion': '將差異視為互補而非衝突，尊重對方的處事風格',
            'dataSource': '五行互補分析',
        })

    # 7. Spouse palace clash landmine
    dim3 = dim_scores.get('spousePalace', {})
    if dim3.get('tianKeDiChong', False):
        landmines.append({
            'severity': 'high',
            'trigger': '人生節奏',
            'warning': '天剋地沖代表雙方在生活節奏和人生規劃上可能嚴重不同步',
            'avoidBehavior': '避免強迫對方配合自己的生活節奏',
            'suggestion': '接受彼此的不同步，在重要節點上主動溝通和妥協',
            'dataSource': '日柱天剋地沖',
        })

    # 8. 劫財 competition landmine
    if ten_god_a_in_b == '劫財' or ten_god_b_in_a == '劫財':
        landmines.append({
            'severity': 'medium',
            'trigger': '個人空間',
            'warning': '雙方存在資源競爭的傾向，容易在無意中搶奪對方的機會',
            'avoidBehavior': '避免在同一個領域直接競爭',
            'suggestion': '明確各自的領域和責任範圍，互相扶持而非比較',
            'dataSource': '十神交叉：劫財關係',
        })

    # 9. Identical chart landmine
    if special.get('identicalCharts'):
        landmines.append({
            'severity': 'medium',
            'trigger': '人生節奏',
            'warning': '八字相同意味著會同時遇到好運和壞運，缺少互相支撐的錯位',
            'avoidBehavior': '避免在雙方同時低潮時做重大決定',
            'suggestion': '建立各自獨立的支持系統（朋友、家人），不要只依賴彼此',
            'dataSource': '相同八字同步脆弱性',
        })

    # 10. Shared 忌神 risk
    if special.get('sharedJishenRisk'):
        shared_ji = gods_a.get('tabooGod', '')
        if shared_ji:
            landmines.append({
                'severity': 'medium',
                'trigger': '情緒處理',
                'warning': f'雙方共享忌神{shared_ji}，遇到{shared_ji}相關流年時容易同時受影響',
                'avoidBehavior': '避免在忌神流年同時做出重大人生決定',
                'suggestion': f'留意{shared_ji}相關的年份（忌神流年），提前做好心理準備',
                'dataSource': f'共同忌神：{shared_ji}',
            })

    # 11. 陰陽差錯日 — both persons have this special day pillar
    a_special_days = pre_analysis_a.get('specialDayPillars', [])
    b_special_days = pre_analysis_b.get('specialDayPillars', [])
    a_yinyang = any(sp.get('name') == '陰陽差錯日' for sp in a_special_days)
    b_yinyang = any(sp.get('name') == '陰陽差錯日' for sp in b_special_days)
    if a_yinyang and b_yinyang:
        landmines.append({
            'severity': 'high',
            'trigger': '婚姻穩定性',
            'warning': '雙方日柱皆為陰陽差錯日，傳統認為此組合婚姻易有波折與冷淡',
            'avoidBehavior': '避免忽視感情經營，不要把對方的存在視為理所當然',
            'suggestion': '定期安排二人專屬時間，主動表達感情，遇到問題及早溝通而非冷處理',
            'dataSource': '雙方日柱均為陰陽差錯日',
        })
    elif a_yinyang or b_yinyang:
        who = '你' if a_yinyang else '對方'
        landmines.append({
            'severity': 'medium',
            'trigger': '感情表達',
            'warning': f'{who}的日柱為陰陽差錯日，在感情表達上可能較為內斂或矛盾',
            'avoidBehavior': '避免用沉默代替溝通',
            'suggestion': '多用具體行動表達愛意，建立固定的溝通時間',
            'dataSource': f'{who}日柱為陰陽差錯日',
        })

    # 12. Within-chart Marriage Palace instability
    knockouts = compat_result.get('knockoutConditions', [])
    has_both_unstable = any(k.get('type') == 'both_unstable_marriage_palaces' for k in knockouts)
    has_one_unstable = any(k.get('type') == 'one_unstable_marriage_palace' for k in knockouts)
    if has_both_unstable:
        landmines.append({
            'severity': 'high',
            'trigger': '配偶宮不穩',
            'warning': '雙方各自命盤內配偶宮（日支）均受其他柱六沖衝破，婚姻根基需要特別經營',
            'avoidBehavior': '避免在感情中缺乏安全感時做出衝動決定',
            'suggestion': '建立共同的生活儀式感，用穩定的日常習慣增強感情根基',
            'dataSource': '雙方自身命盤配偶宮均有六沖',
        })
    elif has_one_unstable:
        landmines.append({
            'severity': 'medium',
            'trigger': '安全感',
            'warning': '一方自身配偶宮受六沖影響，對感情穩定性的需求較高',
            'avoidBehavior': '避免讓對方感到被忽視或不被重視',
            'suggestion': '主動給予安全感，尤其在對方壓力大的時期多加陪伴',
            'dataSource': '一方命盤配偶宮有六沖',
        })

    # Sort by severity, take top 5
    sev_order = {'high': 0, 'medium': 1, 'low': 2}
    landmines.sort(key=lambda x: sev_order.get(x.get('severity', 'low'), 2))

    # Deduplicate by trigger
    seen_triggers: set = set()
    deduped: List[Dict] = []
    for lm in landmines:
        if lm['trigger'] not in seen_triggers:
            seen_triggers.add(lm['trigger'])
            deduped.append(lm)

    return deduped[:5]


# ============================================================
# Yongshen Analysis Detail
# ============================================================

def _build_yongshen_detail(
    compat_result: Dict,
    pre_analysis_a: Dict,
    pre_analysis_b: Dict,
) -> Dict:
    """Build detailed 用神互補 analysis for AI narration."""
    gods_a = pre_analysis_a.get('effectiveFavorableGods', {})
    gods_b = pre_analysis_b.get('effectiveFavorableGods', {})
    dim1 = compat_result.get('dimensionScores', {}).get('yongshenComplementarity', {})

    useful_a = gods_a.get('usefulGod', '')
    useful_b = gods_b.get('usefulGod', '')
    taboo_a = gods_a.get('tabooGod', '')
    taboo_b = gods_b.get('tabooGod', '')

    # Build complementarity explanation
    explanations: List[str] = []

    # Check if A's useful controls B's taboo
    if useful_a and taboo_b and ELEMENT_OVERCOMES.get(useful_a) == taboo_b:
        explanations.append(f'你的用神{useful_a}剋制對方忌神{taboo_b}')
    elif useful_a and taboo_b and ELEMENT_PRODUCES.get(useful_a) == taboo_b:
        explanations.append(f'你的用神{useful_a}卻生助對方忌神{taboo_b}，需注意')

    # Check if B's useful controls A's taboo
    if useful_b and taboo_a and ELEMENT_OVERCOMES.get(useful_b) == taboo_a:
        explanations.append(f'對方用神{useful_b}剋制你的忌神{taboo_a}')
    elif useful_b and taboo_a and ELEMENT_PRODUCES.get(useful_b) == taboo_a:
        explanations.append(f'對方用神{useful_b}卻生助你的忌神{taboo_a}，需注意')

    # Check mutual support
    fav_a = gods_a.get('favorableGod', '')
    fav_b = gods_b.get('favorableGod', '')
    if useful_a == fav_b:
        explanations.append(f'你的用神{useful_a}正好是對方喜神')
    if useful_b == fav_a:
        explanations.append(f'對方用神{useful_b}正好是你的喜神')

    # Shared taboo
    if taboo_a and taboo_a == taboo_b:
        explanations.append(f'雙方共享忌神{taboo_a}，遇忌神流年時雙方同受影響')

    confidence = dim1.get('yongshenConfidence', 'high')

    return {
        'aUsefulElement': useful_a,
        'bUsefulElement': useful_b,
        'aTabooElement': taboo_a,
        'bTabooElement': taboo_b,
        'complementary': dim1.get('rawScore', 50) > 55,
        'explanation': '；'.join(explanations) if explanations else '雙方用神關係尚可',
        'score': round(dim1.get('rawScore', 50)),
        'confidence': confidence,
        'sharedJishenRisk': dim1.get('sharedJishenRisk', False),
        'congGeAffectsYongshen': dim1.get('congGeAffectsYongshen', False),
    }


def _build_element_complementarity_hint(compat_result: Dict) -> str:
    """Generate narrative hint for element complementarity (dimension 5).

    Pre-computes a description of how the two charts' five-element distributions
    complement each other, so the AI never needs to self-derive element traits.
    """
    dim5 = compat_result.get('dimensionScores', {}).get('elementComplementarity', {})
    findings = dim5.get('findings', [])
    if not findings:
        return ''

    parts: List[str] = []
    for f in findings:
        element = f.get('element', '')
        pct_a = f.get('personA', 0)
        pct_b = f.get('personB', 0)
        trait = ELEMENT_MEANINGS.get(element, '')
        if not element or not trait:
            continue

        if pct_a > pct_b:
            parts.append(
                f'你的{element}佔{pct_a}%，對方{element}佔{pct_b}%。'
                f'你{element}多代表{trait}方面較強，可以在這方面帶動對方'
            )
        else:
            parts.append(
                f'對方{element}佔{pct_b}%，你的{element}佔{pct_a}%。'
                f'對方{element}多代表{trait}方面較強，可以在這方面帶動你'
            )

    return '；'.join(parts) if parts else ''


# ============================================================
# Attraction Analysis (Romance Only)
# ============================================================

def _build_attraction_analysis(
    chart_a: Dict, chart_b: Dict,
    pre_analysis_a: Dict, pre_analysis_b: Dict,
    gender_a: str, gender_b: str,
    compat_result: Dict,
    shen_sha_b: List[Dict],
    current_year: int,
) -> Dict:
    """Build "Does s/he like me?" analysis (romance only).

    Analyzes signals from B's chart that indicate attraction to A:
    - B's spouse star activity
    - B's peach blossom / 紅鸞 timing
    - Whether A matches B's spouse star element
    - B's chart emphasis on relationships
    """
    signals: List[str] = []
    dm_a = chart_a['dayMasterStem']
    dm_b = chart_b['dayMasterStem']
    elem_a = STEM_ELEMENT[dm_a]
    pillars_b = chart_b['fourPillars']

    spouse_star_b = '正財' if gender_b == 'male' else '正官'

    # Signal 1: B's spouse star is transparent
    spouse_analysis = _analyze_spouse_star(pillars_b, dm_b, gender_b)
    if spouse_analysis['isTransparent']:
        signals.append(f'對方配偶星（{spouse_star_b}）{spouse_analysis["positionsZh"]}，主動尋求伴侶')

    # Signal 2: A's element matches B's spouse star element
    if gender_b == 'male':
        # Male's spouse star is 正財 → I overcome → B overcomes A's element
        spouse_elem = ELEMENT_OVERCOMES.get(STEM_ELEMENT[dm_b], '')
    else:
        # Female's spouse star is 正官 → overcomes me → A's element overcomes B's element
        spouse_elem = ELEMENT_OVERCOMES.get(elem_a, '')
        # Actually: 正官 = the element that overcomes 日主
        # For female, 正官 element = element that overcomes dm_b's element
        # So spouse_elem = element where ELEMENT_OVERCOMES[spouse_elem] = STEM_ELEMENT[dm_b]
        for e in FIVE_ELEMENTS:
            if ELEMENT_OVERCOMES.get(e) == STEM_ELEMENT[dm_b]:
                spouse_elem = e
                break

    if elem_a == spouse_elem:
        signals.append(f'你的日主五行{elem_a}正好是對方的配偶星五行')

    # Signal 3: 紅鸞/天喜 in shen sha
    romance_sha = {'紅鸞', '天喜', '桃花'}
    for ss in shen_sha_b:
        name = ss.get('name', '') if isinstance(ss, dict) else ss
        if name in romance_sha:
            signals.append(f'對方命帶{name}，感情機會活躍')
            break

    # Signal 4: B's spouse palace (day branch) element supports relationship
    if spouse_analysis['inSpousePalace']:
        signals.append(f'對方配偶星藏在配偶宮（日支），內心渴望穩定關係')

    # Score based on signal count
    signal_count = len(signals)
    if signal_count >= 3:
        conclusion = 'strong'
        score = min(90, 60 + signal_count * 10)
    elif signal_count >= 2:
        conclusion = 'medium'
        score = 50 + signal_count * 8
    elif signal_count >= 1:
        conclusion = 'weak'
        score = 35 + signal_count * 10
    else:
        conclusion = 'unclear'
        score = 30

    return {
        'score': score,
        'signalCount': signal_count,
        'signals': signals,
        'conclusion': conclusion,
    }


# ============================================================
# Narration Guidance
# ============================================================

def _build_narration_guidance(
    compat_result: Dict,
    gender_a: str, gender_b: str,
    comparison_type: str,
) -> Dict:
    """Build narration guidance for the AI."""
    dim_scores = compat_result.get('dimensionScores', {})

    # Count positive vs negative dimensions
    positive_count = sum(
        1 for ds in dim_scores.values()
        if ds.get('rawScore', 50) > 55
    )
    negative_count = sum(
        1 for ds in dim_scores.values()
        if ds.get('rawScore', 50) < 45
    )
    total = max(positive_count + negative_count, 1)
    ratio = f'{positive_count}:{negative_count}'

    # Determine tone
    adjusted = compat_result.get('adjustedScore', 50)
    if adjusted >= 80:
        tone = 'enthusiastic'
    elif adjusted >= 60:
        tone = 'positive'
    elif adjusted >= 45:
        tone = 'balanced'
    elif adjusted >= 30:
        tone = 'cautious'
    else:
        tone = 'constructive'

    return {
        'addressA': '你',
        'addressB': '對方',
        'genderA': gender_a,
        'genderB': gender_b,
        'comparisonType': comparison_type,
        'positiveNegativeRatio': ratio,
        'suggestedTone': tone,
        'highlightDimensions': _get_highlight_dimensions(dim_scores),
    }


def _get_highlight_dimensions(dim_scores: Dict) -> List[str]:
    """Get the top 3 most noteworthy dimensions to highlight."""
    # Score dimensions by deviation from neutral (50)
    deviations = []
    for key, ds in dim_scores.items():
        raw = ds.get('rawScore', 50)
        deviation = abs(raw - 50)
        deviations.append((key, deviation, raw))

    deviations.sort(key=lambda x: x[1], reverse=True)
    return [d[0] for d in deviations[:3]]


# ============================================================
# Dimension Score Summary
# ============================================================

def _build_dimension_summary(compat_result: Dict) -> List[Dict]:
    """Build a concise summary of all 8 dimension scores for AI reference."""
    dim_names = {
        'yongshenComplementarity': '用神互補',
        'dayStemRelationship': '日柱天干',
        'spousePalace': '配偶宮',
        'tenGodCross': '十神交叉',
        'elementComplementarity': '五行互補',
        'fullPillarInteraction': '全盤互動',
        'shenShaInteraction': '神煞互動',
        'luckPeriodSync': '大運同步',
    }
    dim_scores = compat_result.get('dimensionScores', {})
    summary: List[Dict] = []

    for key, label in dim_names.items():
        ds = dim_scores.get(key, {})
        raw = ds.get('rawScore', 50)
        weight = ds.get('weight', 0)

        if raw >= 80:
            assessment = '極佳'
        elif raw >= 65:
            assessment = '良好'
        elif raw >= 45:
            assessment = '普通'
        elif raw >= 30:
            assessment = '需注意'
        else:
            assessment = '困難'

        summary.append({
            'dimension': label,
            'dimensionKey': key,
            'score': round(raw),
            'weight': round(weight * 100),
            'assessment': assessment,
        })

    return summary


def _enrich_timing_sync(timing_sync: Dict) -> Dict:
    """Enrich timing sync data with pattern-based narrativeHints.

    Detects consecutive year patterns (golden/challenge) and adds
    pre-computed hints so the AI doesn't fabricate per-year narratives.

    Returns a new dict (does not mutate the input).
    """
    result = {
        'goldenYears': _detect_year_patterns(
            timing_sync.get('goldenYears', []), 'golden',
        ),
        'challengeYears': _detect_year_patterns(
            timing_sync.get('challengeYears', []), 'challenge',
        ),
        'luckCycleSyncScore': timing_sync.get('luckCycleSyncScore', 50),
    }
    return result


def _detect_year_patterns(years: List[Dict], year_type: str) -> List[Dict]:
    """Add narrativeHint to golden/challenge year entries based on patterns."""
    if not years:
        return []

    sorted_years = sorted(years, key=lambda y: y.get('year', 0))
    enriched: List[Dict] = []
    i = 0

    while i < len(sorted_years):
        # Find the end of this consecutive run
        run_start = i
        while (i + 1 < len(sorted_years) and
               sorted_years[i + 1].get('year', 0) == sorted_years[i].get('year', 0) + 1):
            i += 1
        run_end = i
        run_length = run_end - run_start + 1

        # Generate hint based on pattern
        if year_type == 'golden':
            if run_length >= 3:
                hint = f'連續{run_length}年的黃金期，適合長期規劃（如置產、生育、共同創業）'
            elif run_length == 2:
                hint = '連續兩年好運，可把握這個窗口期'
            else:
                hint = '獨立的好運年，適合把握特定機會'
        else:
            if run_length >= 3:
                hint = f'連續{run_length}年的低潮期，建議提前做好心理準備，減少重大決策'
            elif run_length == 2:
                hint = '連續兩年低潮，互相支持很重要'
            else:
                hint = '獨立的挑戰年，建議減少重大決策，互相支持度過'

        for j in range(run_start, run_end + 1):
            entry = dict(sorted_years[j])  # shallow copy
            entry['narrativeHint'] = hint
            enriched.append(entry)

        i += 1

    return enriched


# ============================================================
# Main Entry Point
# ============================================================

def generate_compatibility_pre_analysis(
    chart_a: Dict,
    chart_b: Dict,
    compat_result: Dict,
    pre_analysis_a: Dict,
    pre_analysis_b: Dict,
    gender_a: str,
    gender_b: str,
    comparison_type: str = 'romance',
    current_year: int = 2025,
    shen_sha_a: Optional[List[Dict]] = None,
    shen_sha_b: Optional[List[Dict]] = None,
) -> Dict:
    """Generate comprehensive compatibility pre-analysis for AI narration.

    This is the Layer 2 cross-chart pre-analysis that leaves ZERO Bazi
    computation to the AI. Every relationship, finding, and implication
    is pre-computed here.

    Args:
        chart_a: Full Bazi chart for person A (from calculate_bazi)
        chart_b: Full Bazi chart for person B
        compat_result: Output from calculate_enhanced_compatibility()
        pre_analysis_a: Pre-analysis for person A (from generate_pre_analysis)
        pre_analysis_b: Pre-analysis for person B
        gender_a: 'male' or 'female'
        gender_b: 'male' or 'female'
        comparison_type: 'romance', 'business', 'friendship', 'parent_child'
        current_year: Current year for timing analysis
        shen_sha_a: Shen sha list for person A
        shen_sha_b: Shen sha list for person B

    Returns:
        Comprehensive pre-analysis dict for AI prompt interpolation
    """
    shen_sha_a = shen_sha_a or chart_a.get('allShenSha', [])
    shen_sha_b = shen_sha_b or chart_b.get('allShenSha', [])

    # ---- Score and label ----
    overall_score = compat_result.get('overallScore', 50)
    adjusted_score = compat_result.get('adjustedScore', 50)
    label = compat_result.get('label', '歡喜冤家')
    special_label = compat_result.get('specialLabel')

    # ---- Cross-chart Ten God analysis ----
    cross_ten_gods = _build_cross_ten_gods(
        chart_a, chart_b, gender_a, gender_b, comparison_type,
    )

    # ---- Collect enemy/taboo elements for both charts ----
    dm_a = chart_a.get('dayMaster', {})
    dm_b = chart_b.get('dayMaster', {})
    enemy_elements = [
        e for e in [dm_a.get('enemyGod'), dm_b.get('enemyGod')] if e
    ]
    taboo_elements = [
        e for e in [dm_a.get('tabooGod'), dm_b.get('tabooGod')] if e
    ]

    # ---- Pillar findings (prioritized) ----
    pillar_findings = _build_pillar_findings(
        compat_result,
        day_branch_a=chart_a['fourPillars']['day']['branch'],
        day_branch_b=chart_b['fourPillars']['day']['branch'],
        enemy_elements=enemy_elements,
        taboo_elements=taboo_elements,
    )

    # ---- Landmines ----
    landmines = _generate_landmines(
        compat_result, pre_analysis_a, pre_analysis_b,
        chart_a, chart_b, gender_a, gender_b, comparison_type,
    )

    # ---- Timing sync (enriched with pattern-based narrativeHints) ----
    timing_sync = _enrich_timing_sync(compat_result.get('timingSync', {}))

    # ---- Yongshen detail ----
    yongshen_analysis = _build_yongshen_detail(
        compat_result, pre_analysis_a, pre_analysis_b,
    )

    # ---- Element complementarity narrative (dimension 5) ----
    yongshen_analysis['elementComplementaryHint'] = _build_element_complementarity_hint(compat_result)

    # ---- Attraction analysis (romance only) ----
    attraction_analysis = None
    if comparison_type == 'romance':
        attraction_analysis = _build_attraction_analysis(
            chart_a, chart_b,
            pre_analysis_a, pre_analysis_b,
            gender_a, gender_b,
            compat_result,
            shen_sha_b,
            current_year,
        )

    # ---- Narration guidance ----
    narration_guidance = _build_narration_guidance(
        compat_result, gender_a, gender_b, comparison_type,
    )

    # ---- Dimension summary ----
    dimension_summary = _build_dimension_summary(compat_result)

    # ---- Knockout conditions summary ----
    knockout_summary = []
    for ko in compat_result.get('knockoutConditions', []):
        knockout_summary.append({
            'type': ko.get('type', ''),
            'description': ko.get('description', ''),
            'impact': ko.get('scoreImpact', 0),
            'mitigated': ko.get('mitigated', False),
        })

    # ---- Strength profiles ----
    strength_a = pre_analysis_a.get('strengthV2', {})
    strength_b = pre_analysis_b.get('strengthV2', {})

    # ---- Build final pre-analysis ----
    result = {
        'version': '1.0.0',

        # Score and label
        'overallScore': overall_score,
        'adjustedScore': adjusted_score,
        'label': label,
        'specialLabel': special_label,
        'labelDescription': compat_result.get('labelDescription', ''),

        # Cross-chart Ten God analysis
        'crossTenGods': cross_ten_gods,

        # Pillar-level interaction findings
        'pillarFindings': pillar_findings,

        # Landmine warnings
        'landmines': landmines,

        # Timing sync
        'timingSync': {
            'goldenYears': timing_sync.get('goldenYears', []),
            'challengeYears': timing_sync.get('challengeYears', []),
            'luckCycleSyncScore': timing_sync.get('luckCycleSyncScore', 50),
        },

        # 用神互補 detail
        'yongshenAnalysis': yongshen_analysis,

        # Attraction analysis (romance only)
        'attractionAnalysis': attraction_analysis,

        # Dimension score summary
        'dimensionSummary': dimension_summary,

        # Knockout conditions
        'knockoutConditions': knockout_summary,

        # Individual strength profiles
        'strengthProfiles': {
            'a': {
                'classification': strength_a.get('classification', 'neutral'),
                'score': strength_a.get('score', 50),
            },
            'b': {
                'classification': strength_b.get('classification', 'neutral'),
                'score': strength_b.get('score', 50),
            },
        },

        # Special findings flags
        'specialFlags': {
            'tianHeDiHe': compat_result.get('specialFindings', {}).get('tianHeDiHe', False),
            'tianKeDiChong': compat_result.get('dimensionScores', {}).get(
                'spousePalace', {}
            ).get('tianKeDiChong', False),
            'identicalCharts': compat_result.get('specialFindings', {}).get('identicalCharts', False),
            'congGeAffectsYongshen': compat_result.get('specialFindings', {}).get(
                'congGeAffectsYongshen', False
            ),
            'dinRenWarning': compat_result.get('specialFindings', {}).get('dinRenWarning', False),
            'sameGenderMode': compat_result.get('specialFindings', {}).get('sameGenderMode', False),
        },

        # Narration guidance
        'narrationGuidance': narration_guidance,
    }

    return result
