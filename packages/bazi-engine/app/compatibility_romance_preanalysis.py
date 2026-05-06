"""
Compatibility Romance V2 Pre-Analysis Module (感情合盤 V2)

All deterministic romance-specific cross-chart calculations. No AI involved.
Extends the existing compatibility_preanalysis.py with 7 new functions
for Seer-level 感情合盤 depth.

Contains:
1. compute_individual_love_personality — 柱位性格特質
2. compute_spouse_enrichment — 旺夫/旺妻 scoring
3. compute_marriage_wealth — 婚前婚後財富
4. compute_post_marriage_quality — 婚後甜蜜度+穩定度
5. compute_marriage_crisis_risk — 個人婚變風險
6. compute_combined_crisis_assessment — 兩人合婚危機
7. compute_compatibility_annual_forecast — 流年感情運
+ Master orchestrator: compute_compatibility_romance_preanalysis
"""

from typing import Any, Dict, List, Optional, Tuple

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
    HARM_LOOKUP,
    HIDDEN_STEMS,
    HIDDEN_STEM_WEIGHTS,
    HONGLUAN,
    LUSHEN,
    STEM_COMBINATIONS,
    STEM_ELEMENT,
    STEM_YINYANG,
    TAOHUA,
    TIANXI,
    TWELVE_STAGES,
    YANGREN,
)
from .branch_relationships import (
    CLASH_LOOKUP,
    HARMONY_LOOKUP,
    SIX_CLASHES,
    SIX_HARMS,
    TRIPLE_HARMONIES,
)
from .ten_gods import derive_ten_god
from .compatibility_preanalysis import generate_compatibility_pre_analysis
from .stem_combinations import STEM_CLASH_LOOKUP, STEM_COMBINATION_LOOKUP
from .interpretation_rules import check_guan_sha_hunza  # Phase 12g.1 Fix 2 — canonical helper


# ============================================================
# Module-Level Constants
# ============================================================

PILLAR_POSITION_TRAITS: Dict[str, Dict[str, str]] = {
    'year_stem': {
        '食神': '外在表現溫和有禮，給人良好第一印象',
        '傷官': '外在表現才華洋溢但銳利，第一印象強烈',
        '正財': '給人務實穩重的第一印象',
        '偏財': '外在大方豪爽，社交場合如魚得水',
        '正官': '外在正派端莊，給人可靠的第一印象',
        '偏官': '外在氣場強大，帶有壓迫感',
        '正印': '外在給人溫暖包容的第一印象',
        '偏印': '外在顯得深沉內斂，不易親近',
        '比肩': '外在獨立自主，給人堅定的第一印象',
        '劫財': '外在活躍好動，帶有競爭意識',
    },
    'month_stem': {
        '食神': '內心善良溫厚，對感情抱持享受態度',
        '傷官': '內心追求完美，對伴侶要求較高',
        '正財': '內心重視物質安全感，理財觀念強',
        '偏財': '內心嚮往自由多彩的感情生活',
        '正官': '內心渴望穩定有序的關係',
        '偏官': '內心充滿挑戰精神，不甘平淡',
        '正印': '內心渴望被理解和包容，重視精神連結',
        '偏印': '內心世界豐富但不善表達，需要獨處空間',
        '比肩': '內心堅持自我，不輕易妥協',
        '劫財': '內心好勝心強，感情中不願示弱',
    },
    'day_branch': {
        '食神': '與伴侶相處時溫柔體貼，享受二人世界',
        '傷官': '與伴侶相處時言語犀利，容易口角',
        '正財': '對伴侶忠誠踏實，重視家庭經濟',
        '偏財': '與伴侶相處時大方但不夠專注',
        '正官': '對伴侶尊重有禮，關係中偏被動',
        '偏官': '與伴侶之間存在張力，關係刺激但不穩定',
        '正印': '對伴侶包容體諒，給予精神支持',
        '偏印': '與伴侶之間有距離感，互動偏冷',
        '比肩': '與伴侶平等相待，但缺乏浪漫火花',
        '劫財': '與伴侶之間存在競爭意味',
    },
    'hour_stem': {
        '食神': '晚年感情表達豐富，與子女關係融洽',
        '傷官': '晚年仍保持銳利個性，不易妥協',
        '正財': '晚年財運穩定，家庭物質充裕',
        '偏財': '晚年社交活躍，異性緣不斷',
        '正官': '晚年生活規律穩定，受晚輩敬重',
        '偏官': '晚年仍充滿幹勁，不服老',
        '正印': '晚年精神富足，享受天倫之樂',
        '偏印': '晚年偏好獨處，有宗教或哲學傾向',
        '比肩': '晚年獨立自主，不依賴他人',
        '劫財': '晚年仍有競爭心態，需注意人際關係',
    },
}

# Ten god archetype mapping for love personality
LOVE_ARCHETYPE: Dict[str, Dict[str, str]] = {
    '食神': {'name': '享樂浪漫型', 'desc': '重視感情中的快樂和享受，天生浪漫'},
    '傷官': {'name': '完美主義型', 'desc': '追求理想伴侶，要求高但付出也多'},
    '正財': {'name': '穩定務實型', 'desc': '重視物質基礎，感情態度認真負責'},
    '偏財': {'name': '社交魅力型', 'desc': '異性緣佳，享受社交但容易分心'},
    '正官': {'name': '傳統穩重型', 'desc': '遵循傳統婚戀觀，重視名分和承諾'},
    '偏官': {'name': '衝勁行動型', 'desc': '感情來得快去得快，喜歡挑戰'},
    '正印': {'name': '精神依戀型', 'desc': '重視精神層面的連結，需要被理解'},
    '偏印': {'name': '孤獨思考型', 'desc': '不善表達感情，需要大量個人空間'},
    '比肩': {'name': '獨立平等型', 'desc': '追求平等關係，不喜歡被約束'},
    '劫財': {'name': '競爭佔有型', 'desc': '感情中有佔有慾，不容易放手'},
}

# Element personality for love
ELEMENT_LOVE_PERSONALITY: Dict[str, str] = {
    '木': '木性格：仁慈包容但有時優柔寡斷',
    '火': '火性格：熱情直率但容易急躁',
    '土': '土性格：穩重忠厚但偏於保守',
    '金': '金性格：果斷堅毅但不善表達柔情',
    '水': '水性格：聰慧靈活但感情多變',
}

# DM strength impact on love
DM_STRENGTH_LOVE_IMPACT: Dict[str, str] = {
    '極弱': '順從型，容易在感情中委曲求全',
    '偏弱': '包容型，願意配合伴侶但需注意自我價值',
    '中和': '平衡型，感情中進退得宜',
    '偏旺': '主導型，感情中傾向掌控節奏',
    '極旺': '強勢型，感情中需要學習妥協',
}

# Spouse enrichment score labels
ENRICHMENT_LEVELS: List[Dict[str, Any]] = [
    {'min': 80, 'max': 100, 'label': '非常旺', 'desc': '對配偶事業財運有顯著助力'},
    {'min': 60, 'max': 79, 'label': '較好', 'desc': '對配偶有正面影響'},
    {'min': 40, 'max': 59, 'label': '一般', 'desc': '對配偶影響中性'},
    {'min': 20, 'max': 39, 'label': '較弱', 'desc': '對配偶助力有限'},
    {'min': 0, 'max': 19, 'label': '明顯克', 'desc': '需要特別注意相處方式'},
]


# ============================================================
# Helper Functions
# ============================================================

def _get_pillars(chart: Dict) -> Dict:
    """Extract fourPillars from chart."""
    return chart.get('fourPillars', {})


def _get_dm_stem(chart: Dict) -> str:
    """Extract day master stem from chart."""
    return chart.get('dayMasterStem', '')


def _get_dm_element(chart: Dict) -> str:
    """Extract day master element from chart."""
    dm = _get_dm_stem(chart)
    return STEM_ELEMENT.get(dm, '')


def _get_effective_gods(chart: Dict) -> Dict:
    """Extract effective gods, trying multiple key locations."""
    # Direct key on chart
    gods = chart.get('effectiveGods', {})
    if gods:
        return gods
    # From preAnalysis
    pa = chart.get('preAnalysis', {})
    return pa.get('effectiveFavorableGods', {})


def _get_strength_v2(chart: Dict) -> Dict:
    """Extract strengthV2 from chart or preAnalysis."""
    sv2 = chart.get('strengthV2', {})
    if sv2:
        return sv2
    pa = chart.get('preAnalysis', {})
    return pa.get('strengthV2', {})


def _get_kong_wang(chart: Dict) -> List[str]:
    """Extract kongWang (day-pillar 空亡) from chart."""
    kw = chart.get('kongWang', [])
    if isinstance(kw, list):
        return kw
    return []


def _get_luck_periods(chart: Dict) -> List[Dict]:
    """Extract luckPeriods from chart."""
    return chart.get('luckPeriods', [])


def _get_all_shen_sha(chart: Dict) -> List[Dict]:
    """Extract allShenSha from chart."""
    return chart.get('allShenSha', [])


def _get_branches(chart: Dict) -> List[str]:
    """Extract all 4 branches from fourPillars in order: year, month, day, hour."""
    pillars = _get_pillars(chart)
    return [
        pillars.get(p, {}).get('branch', '')
        for p in ['year', 'month', 'day', 'hour']
    ]


def _get_stems(chart: Dict) -> List[str]:
    """Extract all 4 stems from fourPillars in order: year, month, day, hour."""
    pillars = _get_pillars(chart)
    return [
        pillars.get(p, {}).get('stem', '')
        for p in ['year', 'month', 'day', 'hour']
    ]


def _hour_is_unknown(chart: Dict) -> bool:
    """Check if birth hour is unknown."""
    pillars = _get_pillars(chart)
    hour = pillars.get('hour', {})
    stem = hour.get('stem', '')
    return not stem or stem == ''


def _is_liuchong(br_a: str, br_b: str) -> bool:
    """Check if two branches form a six clash (六沖)."""
    return CLASH_LOOKUP.get(br_a) == br_b


def _is_liuhe(br_a: str, br_b: str) -> bool:
    """Check if two branches form a six harmony (六合)."""
    return HARMONY_LOOKUP.get(br_a) == br_b


def _is_liuhai(br_a: str, br_b: str) -> bool:
    """Check if two branches form a six harm (六害)."""
    return HARM_LOOKUP.get(br_a) == br_b


def _is_stem_clash(stem_a: str, stem_b: str) -> bool:
    """Check if two stems clash (天干相剋)."""
    elem_a = STEM_ELEMENT.get(stem_a, '')
    elem_b = STEM_ELEMENT.get(stem_b, '')
    return ELEMENT_OVERCOMES.get(elem_a) == elem_b or ELEMENT_OVERCOMES.get(elem_b) == elem_a


def _is_half_harmony(br_a: str, br_b: str) -> bool:
    """Check if two branches form part of a triple harmony (半合)."""
    pair = frozenset({br_a, br_b})
    for harmony in TRIPLE_HARMONIES:
        if pair.issubset(harmony['branches']) and len(pair) == 2:
            return True
    return False


def _get_enrichment_label(score: int) -> Dict[str, str]:
    """Map enrichment score to label and description."""
    for level in ENRICHMENT_LEVELS:
        if level['min'] <= score <= level['max']:
            return {'label': level['label'], 'desc': level['desc']}
    return {'label': '一般', 'desc': '對配偶影響中性'}


def _build_five_element_assessment(chart: Dict, effective_gods: Dict = None) -> Dict[str, Dict]:
    """Build explicit five-element assessment using seasonal balance (includes hidden stems + weighting).
    Returns authoritative status labels so AI doesn't need to infer deficiency from raw counts.
    When effective_gods is provided, cross-references each element with the god system to add
    godRole and advice fields — preventing harmful advice like 'supplement 忌神'."""
    # Use fiveElementsBalanceZh (Chinese keys, seasonal weighting) — NOT fiveElementsBalance (English keys)
    balance = chart.get('fiveElementsBalanceZh', {})
    if not balance:  # Guard: if no seasonal balance data, return empty
        return {}
    elem_counts = chart.get('elementCounts', {})
    total = elem_counts.get('total', {}) if isinstance(elem_counts, dict) else {}

    assessment = {}
    for element in ['木', '火', '土', '金', '水']:
        pct = balance.get(element, 0)
        raw = total.get(element, 0)

        if pct == 0 and raw == 0:
            status = '完全缺失'
        elif pct < 5:
            status = '極少'
        elif pct < 15:
            status = '偏少'
        elif pct < 30:
            status = '適中'
        elif pct < 45:
            status = '偏多'
        else:
            status = '極多'

        assessment[element] = {
            'percentage': round(pct, 1),
            'status': status,
        }

    # V5: Cross-reference with god system for authoritative advice
    if effective_gods:
        # effective_gods stores elements as flat strings: e.g. effective_gods.get('usefulGod') → '木'
        element_god_role = {}
        for role_key, role_label in [
            ('usefulGod', '用神'), ('favorableGod', '喜神'),
            ('tabooGod', '忌神'), ('enemyGod', '仇神'), ('idleGod', '閒神')
        ]:
            el = effective_gods.get(role_key, '')
            if el:
                element_god_role[el] = role_label

        for element, info in assessment.items():
            god_role = element_god_role.get(element, '閒神')
            info['godRole'] = god_role
            # Key logic: whether 偏少 is good or bad depends on god role
            if info['status'] in ('偏少', '極少'):
                if god_role in ('忌神', '仇神'):
                    info['advice'] = '偏少有利，無需補充'
                elif god_role in ('用神', '喜神'):
                    info['advice'] = '偏少不利，宜適當補充'
                else:
                    info['advice'] = '影響不大'
            elif info['status'] in ('偏多', '極多'):
                if god_role in ('忌神', '仇神'):
                    info['advice'] = '偏多不利，宜注意'
                elif god_role in ('用神', '喜神'):
                    info['advice'] = '偏多有利'
                else:
                    info['advice'] = '影響不大'
            elif info['status'] == '完全缺失':
                if god_role in ('忌神', '仇神'):
                    info['advice'] = '缺失有利'
                else:
                    info['advice'] = '缺失需注意'
            else:  # 適中
                info['advice'] = '適中均衡'
    else:
        import logging
        logging.warning("_build_five_element_assessment: no effective_gods — godRole annotations missing")

    return assessment


def _get_strength_classification(chart: Dict) -> str:
    """Get DM strength classification string."""
    sv2 = _get_strength_v2(chart)
    return sv2.get('classification', 'neutral')


def _get_strength_label(chart: Dict) -> str:
    """Get DM strength label (極弱/偏弱/中和/偏旺/極旺)."""
    sv2 = _get_strength_v2(chart)
    cls = sv2.get('classification', 'neutral')
    score = sv2.get('score', 50)
    label_map = {
        'very_weak': '極弱',
        'weak': '偏弱',
        'neutral': '中和',
        'strong': '偏旺',
        'very_strong': '極旺',
    }
    label = label_map.get(cls, '中和')
    return f"{label}（{score}分）"


def _get_five_element_counts(chart: Dict) -> Dict[str, int]:
    """Count five elements from stems and branch hidden stems."""
    counts: Dict[str, int] = {'木': 0, '火': 0, '土': 0, '金': 0, '水': 0}
    pillars = _get_pillars(chart)
    for pname in ['year', 'month', 'day', 'hour']:
        p = pillars.get(pname, {})
        stem = p.get('stem', '')
        branch = p.get('branch', '')
        if stem:
            elem = STEM_ELEMENT.get(stem, '')
            if elem:
                counts[elem] = counts.get(elem, 0) + 1
        for hs in HIDDEN_STEMS.get(branch, []):
            elem = STEM_ELEMENT.get(hs, '')
            if elem:
                counts[elem] = counts.get(elem, 0) + 1
    return counts


def _element_role(element: str, effective_gods: Dict) -> str:
    """Return the role of an element in the god system (用神/喜神/忌神/仇神/閒神)."""
    for role_key, role_label in [
        ('usefulGod', '用神'), ('favorableGod', '喜神'),
        ('tabooGod', '忌神'), ('enemyGod', '仇神'), ('idleGod', '閒神'),
    ]:
        if effective_gods.get(role_key) == element:
            return role_label
    return ''


# ============================================================
# Function 1: Individual Love Personality
# ============================================================

def compute_individual_love_personality(
    chart: Dict,
    gender: str,
    partner_dm_element: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute pillar-position-specific love personality traits.

    Scans each pillar for its ten god (relative to DM) and maps to
    position-specific trait descriptions. More granular than aggregate archetype.
    """
    dm_stem = _get_dm_stem(chart)
    dm_element = STEM_ELEMENT.get(dm_stem, '')
    pillars = _get_pillars(chart)
    hour_unknown = _hour_is_unknown(chart)
    effective_gods = _get_effective_gods(chart)

    # Pillar traits
    pillar_traits: List[Dict[str, str]] = []
    ten_god_counts: Dict[str, int] = {}

    # Year stem
    year_stem = pillars.get('year', {}).get('stem', '')
    if year_stem and dm_stem:
        tg = derive_ten_god(dm_stem, year_stem)
        if tg:
            ten_god_counts[tg] = ten_god_counts.get(tg, 0) + 1
            trait = PILLAR_POSITION_TRAITS.get('year_stem', {}).get(tg, '')
            if trait:
                pillar_traits.append({
                    'position': 'year_stem',
                    'tenGod': tg,
                    'trait': trait,
                    'transparent': True,
                })

    # Month stem
    month_stem = pillars.get('month', {}).get('stem', '')
    if month_stem and dm_stem:
        tg = derive_ten_god(dm_stem, month_stem)
        if tg:
            ten_god_counts[tg] = ten_god_counts.get(tg, 0) + 1
            trait = PILLAR_POSITION_TRAITS.get('month_stem', {}).get(tg, '')
            if trait:
                pillar_traits.append({
                    'position': 'month_stem',
                    'tenGod': tg,
                    'trait': trait,
                    'transparent': True,
                })

    # Day branch (配偶宮) — use main hidden stem
    day_branch = pillars.get('day', {}).get('branch', '')
    day_hidden = HIDDEN_STEMS.get(day_branch, [])
    if day_hidden and dm_stem:
        main_hs = day_hidden[0]
        tg = derive_ten_god(dm_stem, main_hs)
        if tg:
            ten_god_counts[tg] = ten_god_counts.get(tg, 0) + 1
            trait = PILLAR_POSITION_TRAITS.get('day_branch', {}).get(tg, '')
            if trait:
                pillar_traits.append({
                    'position': 'day_branch',
                    'tenGod': tg,
                    'trait': trait,
                    'transparent': False,
                })

    # Hour stem (skip if unknown)
    if not hour_unknown:
        hour_stem = pillars.get('hour', {}).get('stem', '')
        if hour_stem and dm_stem:
            tg = derive_ten_god(dm_stem, hour_stem)
            if tg:
                ten_god_counts[tg] = ten_god_counts.get(tg, 0) + 1
                trait = PILLAR_POSITION_TRAITS.get('hour_stem', {}).get(tg, '')
                if trait:
                    pillar_traits.append({
                        'position': 'hour_stem',
                        'tenGod': tg,
                        'trait': trait,
                        'transparent': True,
                    })

    # Also count ten gods from all branch hidden stems for archetype
    for pname in ['year', 'month', 'day', 'hour']:
        if pname == 'hour' and hour_unknown:
            continue
        branch = pillars.get(pname, {}).get('branch', '')
        for hs in HIDDEN_STEMS.get(branch, []):
            tg = derive_ten_god(dm_stem, hs)
            if tg:
                ten_god_counts[tg] = ten_god_counts.get(tg, 0) + 1

    # Determine archetype from most frequent ten god
    dominant_tg = max(ten_god_counts, key=ten_god_counts.get) if ten_god_counts else '比肩'
    archetype_info = LOVE_ARCHETYPE.get(dominant_tg, LOVE_ARCHETYPE['比肩'])

    # Strengths and weaknesses
    strengths: List[str] = []
    weaknesses: List[str] = []

    # Ten god based
    if ten_god_counts.get('食神', 0) > 0:
        strengths.append('溫柔體貼')
    if ten_god_counts.get('正財', 0) > 0:
        strengths.append('務實負責')
    if ten_god_counts.get('正官', 0) > 0:
        strengths.append('正派可靠')
    if ten_god_counts.get('正印', 0) > 0:
        strengths.append('包容理解')
    if ten_god_counts.get('偏財', 0) > 0:
        strengths.append('大方慷慨')
    if ten_god_counts.get('傷官', 0) > 0:
        weaknesses.append('要求過高')
    if ten_god_counts.get('偏官', 0) > 0:
        weaknesses.append('控制慾強')
    if ten_god_counts.get('劫財', 0) > 0:
        weaknesses.append('佔有慾強')
    if ten_god_counts.get('偏印', 0) > 0:
        weaknesses.append('不善表達')

    # 正印 graduated strength check + 五行缺水 check
    five_elem_counts = _get_five_element_counts(chart)
    natal_stems = _get_stems(chart)
    natal_branches = _get_branches(chart)
    zhengyin_in_stems = any(
        derive_ten_god(dm_stem, s) == '正印'
        for s in natal_stems if s and s != dm_stem
    )
    zhengyin_in_hidden = any(
        derive_ten_god(dm_stem, hs) == '正印'
        for br in natal_branches
        for hs in HIDDEN_STEMS.get(br, [])
    )
    if not zhengyin_in_stems and not zhengyin_in_hidden:
        weaknesses.append('缺乏領悟能力，學習需要更多耐心')
    elif not zhengyin_in_stems:
        weaknesses.append('領悟能力偏弱，直覺力不足')
    if five_elem_counts.get('水', 0) == 0:
        weaknesses.append('做事刻板缺乏靈活')

    # DM strength impact
    strength_label = _get_strength_label(chart)
    sv2 = _get_strength_v2(chart)
    cls = sv2.get('classification', 'neutral')
    cls_zh_map = {
        'very_weak': '極弱', 'weak': '偏弱', 'neutral': '中和',
        'strong': '偏旺', 'very_strong': '極旺',
    }
    cls_zh = cls_zh_map.get(cls, '中和')
    dm_impact = DM_STRENGTH_LOVE_IMPACT.get(cls_zh, DM_STRENGTH_LOVE_IMPACT['中和'])

    # Transparent gods summary
    transparent_gods = list(set(t['tenGod'] for t in pillar_traits if t.get('transparent')))

    # Partner dynamic (if provided)
    partner_dynamic = None
    if partner_dm_element and dm_element:
        if dm_element == partner_dm_element:
            partner_dynamic = {'interaction': '比和', 'description': f'{dm_element}遇{partner_dm_element}，同類相惜但缺乏互補'}
        elif ELEMENT_PRODUCES.get(dm_element) == partner_dm_element:
            partner_dynamic = {'interaction': '我生對方', 'description': f'{dm_element}生{partner_dm_element}，你天生願意為對方付出'}
        elif ELEMENT_PRODUCED_BY.get(dm_element) == partner_dm_element:
            partner_dynamic = {'interaction': '對方生我', 'description': f'{partner_dm_element}生{dm_element}，對方天生是你的支持者'}
        elif ELEMENT_OVERCOMES.get(dm_element) == partner_dm_element:
            partner_dynamic = {'interaction': '我剋對方', 'description': f'{dm_element}剋{partner_dm_element}，你在關係中較強勢'}
        else:
            partner_dynamic = {'interaction': '對方剋我', 'description': f'{partner_dm_element}剋{dm_element}，對方在關係中較強勢'}

    return {
        'archetype': archetype_info['name'],
        'archetypeDesc': archetype_info['desc'],
        'pillarTraits': pillar_traits,
        'strengths': strengths[:5],
        'weaknesses': weaknesses[:5],
        'dmStrengthImpact': f"{strength_label}，{dm_impact}",
        'elementPersonality': ELEMENT_LOVE_PERSONALITY.get(dm_element, ''),
        'hourUnknown': hour_unknown,
        'transparentGods': transparent_gods,
        'partnerDynamic': partner_dynamic,
        'fiveElementAssessment': _build_five_element_assessment(chart, effective_gods),
    }


# ============================================================
# Function 2: Spouse Enrichment (旺夫/旺妻)
# ============================================================

def compute_spouse_enrichment(
    chart: Dict,
    gender: str,
    effective_gods: Dict,
) -> Dict[str, Any]:
    """Score spouse enrichment (旺夫/旺妻) on 0-100 scale.

    Four categories:
    - Day branch quality (0-35)
    - Spouse star status (0-25)
    - DM strength (0-20)
    - Productive cycle (0-20)
    """
    dm_stem = _get_dm_stem(chart)
    dm_element = STEM_ELEMENT.get(dm_stem, '')
    pillars = _get_pillars(chart)
    day_branch = pillars.get('day', {}).get('branch', '')
    kong_wang = _get_kong_wang(chart)
    branches = _get_branches(chart)
    stems = _get_stems(chart)

    # Determine spouse star based on gender
    if gender == 'female':
        spouse_tg = '正官'
        romance_tg = '偏官'
        danger_tg = '傷官'
        spouse_element = ELEMENT_OVERCOME_BY.get(dm_element, '')
    else:
        spouse_tg = '正財'
        romance_tg = '偏財'
        danger_tg = '比肩'  # 比劫奪財
        spouse_element = ELEMENT_OVERCOMES.get(dm_element, '')

    indicators: List[Dict[str, str]] = []

    # ---- Category 1: Day branch quality (0-35) ----
    cat1_score = 0
    day_branch_element = BRANCH_ELEMENT.get(day_branch, '')
    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')
    taboo_god = effective_gods.get('tabooGod', '')

    if day_branch_element == useful_god:
        cat1_score += 35
        indicators.append({'type': 'positive', 'desc': '夫妻宮坐用神，婚姻助力極強'})
    elif day_branch_element == favorable_god:
        cat1_score += 25
        indicators.append({'type': 'positive', 'desc': '夫妻宮坐喜神，婚姻有利'})
    else:
        # Check hidden stems for spouse star
        day_hidden = HIDDEN_STEMS.get(day_branch, [])
        has_spouse_in_palace = False
        for hs in day_hidden:
            tg = derive_ten_god(dm_stem, hs)
            if tg == spouse_tg:
                has_spouse_in_palace = True
                break
        if has_spouse_in_palace:
            cat1_score += 20
            indicators.append({'type': 'positive', 'desc': f'夫妻宮藏{spouse_tg}，配偶星歸位'})
        else:
            cat1_score += 10

    # Penalties on day branch
    if day_branch in kong_wang:
        cat1_score = max(0, cat1_score - 15)
        indicators.append({'type': 'negative', 'desc': '夫妻宮空亡，感情虛浮不實'})

    # Day branch internally clashed by other natal branches
    for i, br in enumerate(branches):
        if i == 2:  # skip day itself
            continue
        if _is_liuchong(br, day_branch):
            cat1_score = max(0, cat1_score - 10)
            pos_names = ['年支', '月支', '日支', '時支']
            indicators.append({'type': 'negative', 'desc': f'{pos_names[i]}沖夫妻宮，婚姻受外力干擾'})
            break

    # 傷官 in day branch (female)
    if gender == 'female':
        day_hidden = HIDDEN_STEMS.get(day_branch, [])
        for hs in day_hidden:
            if derive_ten_god(dm_stem, hs) == '傷官':
                cat1_score = max(0, cat1_score - 15)
                indicators.append({'type': 'negative', 'desc': '傷官坐夫妻宮，對婚姻有剋制'})
                break

    # 財生官 chain in day branch (female only)
    if gender == 'female' and cat1_score < 20:
        day_hidden_gods = [derive_ten_god(dm_stem, hs) for hs in HIDDEN_STEMS.get(day_branch, [])]
        has_cai_in_day = any(g in ('正財', '偏財') for g in day_hidden_gods)
        has_guan_in_day = any(g == '正官' for g in day_hidden_gods)
        if has_cai_in_day and has_guan_in_day:
            cat1_score = max(cat1_score, 20)
            indicators.append({'type': 'positive', 'desc': '財生官在夫妻宮，日支財星生官星，婚姻宮有利循環'})

    # ---- Category 2: Spouse star status (0-25) ----
    cat2_score = 0
    spouse_positions: List[str] = []
    romance_positions: List[str] = []

    pos_names = ['year', 'month', 'day', 'hour']
    for i, pname in enumerate(pos_names):
        stem = stems[i]
        if stem and dm_stem:
            tg = derive_ten_god(dm_stem, stem)
            if tg == spouse_tg:
                spouse_positions.append(pname)
            elif tg == romance_tg:
                romance_positions.append(pname)

    # Check spouse star in role system
    if spouse_element == useful_god or spouse_element == favorable_god:
        cat2_score += 25
        indicators.append({'type': 'positive', 'desc': f'{spouse_tg}為用/喜神，配偶助力大'})
    elif spouse_positions:
        cat2_score += 15
        indicators.append({'type': 'positive', 'desc': f'{spouse_tg}透干，婚姻態度明確'})
    else:
        # Check hidden
        has_hidden_spouse = False
        for pname in pos_names:
            branch = pillars.get(pname, {}).get('branch', '')
            for hs in HIDDEN_STEMS.get(branch, []):
                if derive_ten_god(dm_stem, hs) == spouse_tg:
                    has_hidden_spouse = True
                    break
            if has_hidden_spouse:
                break
        if has_hidden_spouse:
            cat2_score += 10
        else:
            cat2_score += 5

    # Pure + rooted spouse star bonus
    anti_spouse_tg = '偏官' if gender == 'female' else '偏財'
    spouse_in_stems = any(
        derive_ten_god(dm_stem, s) == spouse_tg
        for s in stems if s and s != dm_stem
    )
    anti_spouse_in_stems = any(
        derive_ten_god(dm_stem, s) == anti_spouse_tg
        for s in stems if s and s != dm_stem
    )
    spouse_rooted = any(
        derive_ten_god(dm_stem, hs) == spouse_tg
        for br in branches for hs in HIDDEN_STEMS.get(br, [])
    )
    if spouse_in_stems and not anti_spouse_in_stems and spouse_rooted:
        cat2_score = max(cat2_score, 20)
        indicators.append({'type': 'positive', 'desc': f'{spouse_tg}純正且通根，配偶星強而有力'})

    # Gender-specific penalties
    if gender == 'female':
        # 傷官見官
        has_shangguan = any(
            derive_ten_god(dm_stem, s) == '傷官'
            for s in stems if s and s != dm_stem
        )
        has_zhengguan = any(
            derive_ten_god(dm_stem, s) == '正官'
            for s in stems if s and s != dm_stem
        )
        if has_shangguan and has_zhengguan:
            cat2_score = max(0, cat2_score - 15)
            indicators.append({'type': 'negative', 'desc': '傷官見官，對婚姻不利'})

        # 官殺混雜 — Phase 12g.1 Fix 2: use canonical weighted helper
        # (子平真詮·論偏官 「藏官露殺...勿使官混；藏殺露官...不可使殺混」 —
        # 露官藏殺/露殺藏官 are NOT 真混雜).
        gs_result = check_guan_sha_hunza(pillars, dm_stem, 'female')
        if gs_result and gs_result['type'] == 'guan_sha_hunza':
            cat2_score = max(0, cat2_score - 10)
            indicators.append({'type': 'negative', 'desc': '官殺混雜，感情選擇困難'})
    else:
        # 比劫奪財
        has_bijian = any(
            derive_ten_god(dm_stem, s) in ('比肩', '劫財')
            for s in stems if s and s != dm_stem
        )
        has_zhengcai = any(
            derive_ten_god(dm_stem, s) == '正財'
            for s in stems if s and s != dm_stem
        )
        if has_bijian and has_zhengcai:
            cat2_score = max(0, cat2_score - 10)
            indicators.append({'type': 'negative', 'desc': '比劫奪財，需防感情競爭'})

        # 偏正財混雜
        has_piancai = any(
            derive_ten_god(dm_stem, s) == '偏財'
            for s in stems if s and s != dm_stem
        )
        if has_zhengcai and has_piancai:
            cat2_score = max(0, cat2_score - 10)
            indicators.append({'type': 'negative', 'desc': '偏正財混雜，感情不專一'})

    # ---- Category 3: DM strength (0-20) ----
    cat3_score = 0
    sv2 = _get_strength_v2(chart)
    cls = sv2.get('classification', 'neutral')
    if cls in ('strong', 'very_strong'):
        cat3_score = 20
    elif cls == 'neutral':
        cat3_score = 15
    elif cls == 'weak':
        cat3_score = 10
    else:  # very_weak
        cat3_score = 5

    # ---- Category 4: Productive cycle (0-20) ----
    cat4_score = 0

    # Precompute ten gods present in stems (used by both genders)
    stem_ten_gods = set()
    for s in stems:
        if s and s != dm_stem:
            tg = derive_ten_god(dm_stem, s)
            if tg:
                stem_ten_gods.add(tg)

    if gender == 'female':
        # 食神制殺
        if '食神' in stem_ten_gods and '偏官' in stem_ten_gods:
            cat4_score += 15
            indicators.append({'type': 'positive', 'desc': '食神制殺，智慧化解衝突'})

        # 食神生財→財生官
        has_cai_f = '正財' in stem_ten_gods or '偏財' in stem_ten_gods
        if '食神' in stem_ten_gods and has_cai_f and '正官' in stem_ten_gods:
            cat4_score = min(20, cat4_score + 20)
            indicators.append({'type': 'positive', 'desc': '食神生財再生官，良性循環'})
        elif '傷官' in stem_ten_gods and has_cai_f:
            cat4_score = min(20, cat4_score + 12)
            indicators.append({'type': 'positive', 'desc': '傷官帶財，轉化剋制為助力'})
        elif '傷官' in stem_ten_gods and '偏官' in stem_ten_gods:
            cat4_score = min(20, cat4_score + 12)
            indicators.append({'type': 'positive', 'desc': '傷官合殺，化解衝突為正面力量'})
    else:
        # 食傷生財
        has_cai_m = '正財' in stem_ten_gods or '偏財' in stem_ten_gods
        if ('食神' in stem_ten_gods or '傷官' in stem_ten_gods) and has_cai_m:
            cat4_score += 20
            indicators.append({'type': 'positive', 'desc': '食傷生財，才華轉化為物質保障'})

    total_score = min(100, cat1_score + cat2_score + cat3_score + cat4_score)
    level_info = _get_enrichment_label(total_score)

    title = '旺夫' if gender == 'female' else '旺妻'

    # Build explicit hidden stem ten-god mapping for day branch (夫妻宮)
    hidden_in_day = HIDDEN_STEMS.get(day_branch, [])
    day_branch_hidden = [
        {'stem': hs, 'tenGod': derive_ten_god(dm_stem, hs), 'element': STEM_ELEMENT.get(hs, '')}
        for hs in hidden_in_day
    ]

    return {
        'title': title,
        'totalScore': total_score,
        'level': level_info['label'],
        'levelDesc': level_info['desc'],
        'categoryScores': {
            'dayBranchQuality': cat1_score,
            'spouseStarStatus': cat2_score,
            'dmStrength': cat3_score,
            'productiveCycle': cat4_score,
        },
        'indicators': indicators,
        'dayBranchHiddenStems': day_branch_hidden,
    }


# ============================================================
# Function 3: Marriage Wealth (婚前婚後財富)
# ============================================================

def _detect_broad_tiangan_fuyin(
    natal_stems: List[str],
    lp_stem: str,
    dm: str,
) -> Tuple[bool, Optional[str]]:
    """Detect if LP stem's ten-god-type matches any natal stem's ten-god-type."""
    if not lp_stem or not dm:
        return False, None
    lp_tg = derive_ten_god(dm, lp_stem)
    for ns in natal_stems:
        if ns == dm:
            continue
        if not ns:
            continue
        if derive_ten_god(dm, ns) == lp_tg:
            return True, lp_tg
    return False, None


def compute_marriage_wealth(
    chart: Dict,
    gender: str,
    effective_gods: Dict,
    luck_periods: List[Dict],
) -> Dict[str, Any]:
    """Analyze marriage timing and pre/post-marriage financial trajectory.

    Determines estimated marriage timing from luck periods, then analyzes
    pre-marriage and post-marriage periods for wealth indicators.
    """
    dm_stem = _get_dm_stem(chart)
    dm_element = STEM_ELEMENT.get(dm_stem, '')
    pillars = _get_pillars(chart)
    day_branch = pillars.get('day', {}).get('branch', '')
    kong_wang = _get_kong_wang(chart)
    hour_unknown = _hour_is_unknown(chart)

    # Determine spouse star
    if gender == 'female':
        spouse_tg = '正官'
    else:
        spouse_tg = '正財'

    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')
    taboo_god = effective_gods.get('tabooGod', '')

    # Estimate marriage timing: find LP where spouse star is most active
    marriage_lp_idx = -1
    marriage_age = 27  # default

    for i, lp in enumerate(luck_periods):
        lp_stem = lp.get('stem', '')
        lp_branch = lp.get('branch', '')
        start_age = lp.get('startAge', 0)
        if start_age < 20 or start_age > 45:
            continue

        # Check if LP stem is spouse star
        if lp_stem and dm_stem:
            tg = derive_ten_god(dm_stem, lp_stem)
            if tg == spouse_tg:
                marriage_lp_idx = i
                marriage_age = start_age + 3  # middle of LP
                break

        # Check LP branch hidden stems
        for hs in HIDDEN_STEMS.get(lp_branch, []):
            if derive_ten_god(dm_stem, hs) == spouse_tg:
                if marriage_lp_idx == -1:
                    marriage_lp_idx = i
                    marriage_age = start_age + 3

    if marriage_lp_idx == -1:
        # Default to LP covering age 25-30
        for i, lp in enumerate(luck_periods):
            start = lp.get('startAge', 0)
            if 22 <= start <= 30:
                marriage_lp_idx = i
                marriage_age = start + 3
                break

    # Natal stems for 伏吟 check
    natal_stems = _get_stems(chart)
    if hour_unknown:
        natal_stems = natal_stems[:3]  # exclude hour

    # Pre-marriage analysis
    pre_marriage_findings: List[Dict[str, str]] = []
    for i, lp in enumerate(luck_periods):
        if i >= marriage_lp_idx and marriage_lp_idx >= 0:
            break
        lp_stem = lp.get('stem', '')
        start_age = lp.get('startAge', 0)
        if start_age < 10:
            continue

        lp_branch = lp.get('branch', '')
        lp_ganzhi = f"{lp_stem}{lp_branch}"

        # Check 伏吟
        is_fuyin, fuyin_tg = _detect_broad_tiangan_fuyin(natal_stems, lp_stem, dm_stem)
        if is_fuyin:
            pre_marriage_findings.append({
                'period': f"{start_age}-{start_age + 9}歲",
                'type': '天干伏吟',
                'detail': f'大運{lp_stem}與命局{fuyin_tg}重複，感情易有反覆',
                'lpGanZhi': lp_ganzhi,
            })

        # Check LP branch clash with day branch
        if _is_liuchong(lp_branch, day_branch):
            pre_marriage_findings.append({
                'period': f"{start_age}-{start_age + 9}歲",
                'type': '大運沖夫妻宮',
                'detail': '感情可能出現波折',
                'lpGanZhi': lp_ganzhi,
            })

        # Element-role assessment for pre-marriage LP
        lp_stem_element = STEM_ELEMENT.get(lp_stem, '')
        if lp_stem_element:
            dm_obj = chart.get('dayMaster', {})
            if lp_stem_element == dm_obj.get('usefulGod') or lp_stem_element == dm_obj.get('favorableGod'):
                elem_assessment = '喜用神主導，運勢較好'
            elif lp_stem_element == dm_obj.get('tabooGod') or lp_stem_element == dm_obj.get('enemyGod'):
                elem_assessment = '忌仇神主導，運勢較差'
            else:
                elem_assessment = '運勢平穩'
            pre_marriage_findings.append({
                'period': f"{start_age}-{start_age + 9}歲",
                'type': '大運五行評估',
                'detail': f'大運天干{lp_stem}（{lp_stem_element}），{elem_assessment}',
                'elementAssessment': elem_assessment,
                'lpGanZhi': lp_ganzhi,
            })

    # Post-marriage analysis
    post_marriage_findings: List[Dict[str, str]] = []
    if marriage_lp_idx >= 0:
        for i, lp in enumerate(luck_periods):
            if i <= marriage_lp_idx:
                continue
            lp_stem = lp.get('stem', '')
            lp_branch = lp.get('branch', '')
            start_age = lp.get('startAge', 0)

            lp_ganzhi = f"{lp_stem}{lp_branch}"

            # Check element role
            lp_stem_elem = STEM_ELEMENT.get(lp_stem, '')
            role = _element_role(lp_stem_elem, effective_gods)
            if role == '用神' or role == '喜神':
                post_marriage_findings.append({
                    'period': f"{start_age}-{start_age + 9}歲",
                    'type': '有利大運',
                    'detail': f'大運天干為{role}，婚後財運提升',
                    'lpGanZhi': lp_ganzhi,
                })
            elif role == '忌神' or role == '仇神':
                post_marriage_findings.append({
                    'period': f"{start_age}-{start_age + 9}歲",
                    'type': '不利大運',
                    'detail': f'大運天干為{role}，需注意財務壓力',
                    'lpGanZhi': lp_ganzhi,
                })

            # Check 伏吟 post-marriage
            is_fuyin, fuyin_tg = _detect_broad_tiangan_fuyin(natal_stems, lp_stem, dm_stem)
            if is_fuyin:
                post_marriage_findings.append({
                    'period': f"{start_age}-{start_age + 9}歲",
                    'type': '天干伏吟',
                    'detail': f'大運{lp_stem}伏吟{fuyin_tg}，此段期間感情需留意',
                    'lpGanZhi': lp_ganzhi,
                })

    # Compute remaining years in post-marriage LP
    post_marriage_years_in_lp = None
    if marriage_lp_idx >= 0 and marriage_lp_idx < len(luck_periods):
        lp = luck_periods[marriage_lp_idx]
        lp_end_age = lp.get('endAge', lp.get('startAge', 0) + 10)
        post_marriage_years_in_lp = max(0, lp_end_age - marriage_age)

    # Spouse palace support (填實/坐虛)
    palace_support = '中性'
    palace_detail = ''
    day_hidden = HIDDEN_STEMS.get(day_branch, [])
    favorable_count = 0
    unfavorable_count = 0

    for hs in day_hidden:
        hs_elem = STEM_ELEMENT.get(hs, '')
        role = _element_role(hs_elem, effective_gods)
        if role in ('用神', '喜神'):
            favorable_count += 1
        elif role in ('忌神', '仇神'):
            unfavorable_count += 1

    is_kong_wang = day_branch in kong_wang

    if not is_kong_wang and favorable_count > 0:
        palace_support = '填實'
        palace_detail = '夫妻宮藏喜用神且不空亡，配偶宮穩固'
    elif is_kong_wang or (unfavorable_count > 0 and favorable_count == 0):
        palace_support = '坐虛'
        if is_kong_wang:
            palace_detail = '夫妻宮空亡，配偶緣分較淡'
        else:
            palace_detail = '夫妻宮皆藏忌仇神，配偶宮不穩'
    else:
        palace_detail = '夫妻宮條件中性'

    return {
        'estimatedMarriageAge': marriage_age,
        'marriageLPIndex': marriage_lp_idx,
        'preMarriage': pre_marriage_findings[:5],
        'postMarriage': post_marriage_findings[:5],
        'palaceSupport': {
            'status': palace_support,
            'detail': palace_detail,
            'isKongWang': is_kong_wang,
        },
        'hourUnknown': hour_unknown,
        'postMarriageYearsInLP': post_marriage_years_in_lp,
    }


# ============================================================
# Function 4: Post-Marriage Quality (婚後甜蜜度+穩定度)
# ============================================================

def compute_post_marriage_quality(
    chart_a: Dict,
    chart_b: Dict,
    cross_data: Dict,
) -> Dict[str, Any]:
    """Compute post-marriage sweetness and stability scores.

    Sweetness: emotional quality (0-100)
    Stability: long-term resilience (0-100)
    """
    # Identical charts guard
    pillars_a = _get_pillars(chart_a)
    pillars_b = _get_pillars(chart_b)
    if _charts_are_identical(chart_a, chart_b):
        return {
            'sweetness': {'score': 0, 'note': 'identical_charts', 'factors': []},
            'stability': {'score': 0, 'note': 'identical_charts', 'factors': []},
        }

    dm_a = _get_dm_stem(chart_a)
    dm_b = _get_dm_stem(chart_b)
    day_branch_a = pillars_a.get('day', {}).get('branch', '')
    day_branch_b = pillars_b.get('day', {}).get('branch', '')
    branches_a = _get_branches(chart_a)
    branches_b = _get_branches(chart_b)
    stems_a = _get_stems(chart_a)
    stems_b = _get_stems(chart_b)

    # ---- Sweetness ----
    sweetness = 50  # base
    sweet_factors: List[Dict[str, Any]] = []

    # Day stem 五合 (天干合)
    if STEM_COMBINATIONS.get(dm_a) == dm_b:
        sweetness += 30
        sweet_factors.append({'type': 'positive', 'desc': '日主天干五合，天生默契', 'impact': 30})

    # 食神透幹 bonus per person
    for label, stems_x, dm_x in [('A', stems_a, dm_a), ('B', stems_b, dm_b)]:
        for s in stems_x:
            if s and s != dm_x and derive_ten_god(dm_x, s) == '食神':
                sweetness += 15
                sweet_factors.append({
                    'type': 'positive',
                    'desc': f'{label}方食神透干，相處愉快',
                    'impact': 15,
                })
                break

    # Day branch 六合 / 半合
    if _is_liuhe(day_branch_a, day_branch_b):
        sweetness += 25
        sweet_factors.append({'type': 'positive', 'desc': '日支六合，感情融洽', 'impact': 25})
    elif _is_half_harmony(day_branch_a, day_branch_b):
        sweetness += 15
        sweet_factors.append({'type': 'positive', 'desc': '日支半合，有共同目標', 'impact': 15})

    # Cross ten gods nurturing (正印/食神 in cross)
    nurturing_found = False
    for s_a in stems_a:
        if s_a and dm_b:
            tg = derive_ten_god(dm_b, s_a)
            if tg in ('正印', '食神'):
                nurturing_found = True
                break
    if not nurturing_found:
        for s_b in stems_b:
            if s_b and dm_a:
                tg = derive_ten_god(dm_a, s_b)
                if tg in ('正印', '食神'):
                    nurturing_found = True
                    break
    if nurturing_found:
        sweetness += 15
        sweet_factors.append({'type': 'positive', 'desc': '交叉十神有滋養關係', 'impact': 15})

    # Penalties
    for label, stems_x, dm_x in [('A', stems_a, dm_a), ('B', stems_b, dm_b)]:
        for s in stems_x:
            if s and s != dm_x and derive_ten_god(dm_x, s) == '傷官':
                sweetness -= 15
                sweet_factors.append({
                    'type': 'negative',
                    'desc': f'{label}方傷官透干，言語易傷人',
                    'impact': -15,
                })
                break

    if _is_liuchong(day_branch_a, day_branch_b):
        sweetness -= 25
        sweet_factors.append({'type': 'negative', 'desc': '日支六沖，感情摩擦大', 'impact': -25})

    # 比劫 in cross (A's DM appears as 比肩/劫財 to B)
    if dm_a and dm_b:
        cross_tg = derive_ten_god(dm_b, dm_a)
        if cross_tg in ('比肩', '劫財'):
            sweetness -= 10
            sweet_factors.append({'type': 'negative', 'desc': '日主互為比劫，缺乏互補', 'impact': -10})

    sweetness = max(0, min(100, sweetness))

    # ---- Stability ----
    stability = 50  # base
    stab_factors: List[Dict[str, Any]] = []

    # No 牆外桃花 (hour branch is taohua target)
    has_wall_outside_taohua = False
    for chart_x, label in [(chart_a, 'A'), (chart_b, 'B')]:
        br_x = _get_branches(chart_x)
        day_br = br_x[2] if len(br_x) > 2 else ''
        year_br = br_x[0] if len(br_x) > 0 else ''
        taohua_day = TAOHUA.get(day_br, '')
        taohua_year = TAOHUA.get(year_br, '')
        hour_br = br_x[3] if len(br_x) > 3 else ''
        if hour_br and (hour_br == taohua_day or hour_br == taohua_year):
            has_wall_outside_taohua = True
            stab_factors.append({
                'type': 'negative',
                'desc': f'{label}方時支帶桃花，有牆外桃花傾向',
                'impact': -15,
            })

    if not has_wall_outside_taohua:
        stability += 20
        stab_factors.append({'type': 'positive', 'desc': '雙方均無牆外桃花', 'impact': 20})

    # Year pillars compatible
    year_br_a = branches_a[0] if branches_a else ''
    year_br_b = branches_b[0] if branches_b else ''
    if _is_liuhe(year_br_a, year_br_b) or _is_half_harmony(year_br_a, year_br_b):
        stability += 15
        stab_factors.append({'type': 'positive', 'desc': '年柱地支相合，家庭背景融洽', 'impact': 15})

    # Pure spouse stars
    for chart_x, label, gdr in [(chart_a, 'A', 'male'), (chart_b, 'B', 'female')]:
        dm_x = _get_dm_stem(chart_x)
        stems_x = _get_stems(chart_x)
        gender_x = chart_x.get('gender', gdr)
        pillars_x = _get_pillars(chart_x)
        if gender_x == 'female':
            # Check 官殺混雜 — Phase 12g.1 Fix 2: weighted canonical helper
            gs_result = check_guan_sha_hunza(pillars_x, dm_x, 'female')
            if gs_result and gs_result['type'] == 'guan_sha_hunza':
                stability -= 15
                stab_factors.append({
                    'type': 'negative',
                    'desc': f'{label}方官殺混雜，感情選擇困難',
                    'impact': -15,
                })
            elif gs_result and gs_result['type'] in ('lu_guan_cang_sha', 'lu_sha_cang_guan'):
                # Pure-side dominant — partial pure bonus per pre-12g logic
                stability += 10
        else:
            # Check 偏正財混雜
            has_zc = any(derive_ten_god(dm_x, s) == '正財' for s in stems_x if s and s != dm_x)
            has_pc = any(derive_ten_god(dm_x, s) == '偏財' for s in stems_x if s and s != dm_x)
            if has_zc and has_pc:
                stability -= 15
                stab_factors.append({
                    'type': 'negative',
                    'desc': f'{label}方偏正財混雜，感情不專一',
                    'impact': -15,
                })
            elif (has_zc or has_pc) and not (has_zc and has_pc):
                stability += 10

    # Pure spouse stars full bonus if no mixed found
    pure_found = not any(f['impact'] == -15 and '混雜' in f['desc'] for f in stab_factors)
    if pure_found:
        stability += 20
        stab_factors.append({'type': 'positive', 'desc': '雙方配偶星純正', 'impact': 20})

    # No internal day branch clash
    if not _is_liuchong(day_branch_a, day_branch_b):
        stability += 20
        stab_factors.append({'type': 'positive', 'desc': '日支無沖，感情基礎穩固', 'impact': 20})

    # Communication gods (食神/正印 present)
    has_comm = False
    for chart_x, label in [(chart_a, 'A'), (chart_b, 'B')]:
        dm_x = _get_dm_stem(chart_x)
        stems_x = _get_stems(chart_x)
        for s in stems_x:
            if s and s != dm_x and derive_ten_god(dm_x, s) in ('食神', '正印'):
                has_comm = True
                break
        if has_comm:
            break
    if has_comm:
        stability += 15
        stab_factors.append({'type': 'positive', 'desc': '有溝通之神（食神/正印），善於表達', 'impact': 15})

    stability = max(0, min(100, stability))

    return {
        'sweetness': {
            'score': sweetness,
            'factors': sweet_factors,
        },
        'stability': {
            'score': stability,
            'factors': stab_factors,
        },
    }


# ============================================================
# Function 5: Marriage Crisis Risk (個人婚變風險)
# ============================================================

def compute_marriage_crisis_risk(
    chart: Dict,
    gender: str,
    effective_gods: Dict,
) -> Dict[str, Any]:
    """Compute per-person marriage crisis risk factors.

    Male: 傷官透出, 羊刃無制, 比劫奪財, 日支被沖, 偏正財混雜
    Female: 官殺混雜, 傷官見官, 財星透出, 日支被沖, 日支空亡
    """
    dm_stem = _get_dm_stem(chart)
    dm_element = STEM_ELEMENT.get(dm_stem, '')
    pillars = _get_pillars(chart)
    day_branch = pillars.get('day', {}).get('branch', '')
    kong_wang = _get_kong_wang(chart)
    branches = _get_branches(chart)
    stems = _get_stems(chart)
    hour_unknown = _hour_is_unknown(chart)

    risk_factors: List[Dict[str, str]] = []
    risk_score = 0

    if gender == 'male':
        # 傷官透出
        for i, s in enumerate(stems):
            if s and s != dm_stem and derive_ten_god(dm_stem, s) == '傷官':
                risk_factors.append({
                    'factor': '傷官透出',
                    'desc': '言語容易傷人，婚姻中需特別注意表達方式',
                    'severity': '中',
                })
                risk_score += 20
                break

        # 羊刃無制
        yangren_br = YANGREN.get(dm_stem, '')
        has_yangren = yangren_br in branches
        if has_yangren:
            # Check if controlled by 正官/偏官
            has_control = any(
                derive_ten_god(dm_stem, s) in ('正官', '偏官')
                for s in stems if s and s != dm_stem
            )
            if not has_control:
                risk_factors.append({
                    'factor': '羊刃無制',
                    'desc': '性格剛烈，容易衝動行事影響婚姻',
                    'severity': '高',
                })
                risk_score += 25

        # 比劫奪財
        has_bijie = any(
            derive_ten_god(dm_stem, s) in ('比肩', '劫財')
            for s in stems if s and s != dm_stem
        )
        has_cai = any(
            derive_ten_god(dm_stem, s) in ('正財', '偏財')
            for s in stems if s and s != dm_stem
        )
        if has_bijie and has_cai:
            risk_factors.append({
                'factor': '比劫奪財',
                'desc': '易有第三者介入感情的風險',
                'severity': '中',
            })
            risk_score += 20

        # 日支被沖
        for i, br in enumerate(branches):
            if i == 2:
                continue
            if hour_unknown and i == 3:
                continue
            if _is_liuchong(br, day_branch):
                pos_names = ['年支', '月支', '日支', '時支']
                risk_factors.append({
                    'factor': '日支被沖',
                    'desc': f'{pos_names[i]}沖夫妻宮，婚姻易受動搖',
                    'severity': '高',
                })
                risk_score += 25
                break

        # 偏正財混雜
        has_zc = any(derive_ten_god(dm_stem, s) == '正財' for s in stems if s and s != dm_stem)
        has_pc = any(derive_ten_god(dm_stem, s) == '偏財' for s in stems if s and s != dm_stem)
        if has_zc and has_pc:
            risk_factors.append({
                'factor': '偏正財混雜',
                'desc': '感情對象不專一，容易陷入多角關係',
                'severity': '中',
            })
            risk_score += 15

    else:  # female
        # 官殺混雜 — Phase 12g.1 Fix 2: weighted canonical helper
        gs_result = check_guan_sha_hunza(pillars, dm_stem, 'female')
        # Cache for downstream checks (avoid recomputing presence flags)
        has_zg = any(derive_ten_god(dm_stem, s) == '正官' for s in stems if s and s != dm_stem)
        has_pg = any(derive_ten_god(dm_stem, s) == '偏官' for s in stems if s and s != dm_stem)
        if gs_result and gs_result['type'] == 'guan_sha_hunza':
            risk_factors.append({
                'factor': '官殺混雜',
                'desc': '容易在正緣與偏緣之間搖擺不定',
                'severity': '高',
            })
            risk_score += 25

        # 傷官見官
        has_sg = any(derive_ten_god(dm_stem, s) == '傷官' for s in stems if s and s != dm_stem)
        if has_sg and has_zg:
            risk_factors.append({
                'factor': '傷官見官',
                'desc': '傷官剋制正官，對婚姻有破壞力',
                'severity': '高',
            })
            risk_score += 25

        # 財星透出 (生官殺)
        has_cai_f = any(
            derive_ten_god(dm_stem, s) in ('正財', '偏財')
            for s in stems if s and s != dm_stem
        )
        if has_cai_f and (has_zg or has_pg):
            risk_factors.append({
                'factor': '財星透出生官殺',
                'desc': '異性緣過旺，桃花機會多但不穩定',
                'severity': '中',
            })
            risk_score += 15

        # 日支被沖
        for i, br in enumerate(branches):
            if i == 2:
                continue
            if hour_unknown and i == 3:
                continue
            if _is_liuchong(br, day_branch):
                pos_names = ['年支', '月支', '日支', '時支']
                risk_factors.append({
                    'factor': '日支被沖',
                    'desc': f'{pos_names[i]}沖夫妻宮，婚姻易受動搖',
                    'severity': '高',
                })
                risk_score += 25
                break

        # 日支空亡
        if day_branch in kong_wang:
            risk_factors.append({
                'factor': '日支空亡',
                'desc': '配偶宮空虛，婚姻緣分較淡',
                'severity': '中',
            })
            risk_score += 15

    # Classify overall risk
    if risk_score >= 60:
        overall_risk = '高'
    elif risk_score >= 40:
        overall_risk = '中高'
    elif risk_score >= 20:
        overall_risk = '中'
    else:
        overall_risk = '低'

    # Infidelity risk
    infidelity_risk = '低'
    stem_tgs = set()
    for s in stems:
        if s and s != dm_stem:
            tg = derive_ten_god(dm_stem, s)
            if tg:
                stem_tgs.add(tg)

    if gender == 'male':
        if '比肩' in stem_tgs or '劫財' in stem_tgs:
            infidelity_risk = '中'
        if '正財' in stem_tgs and '偏財' in stem_tgs:
            infidelity_risk = '中高'
    else:
        if '正官' in stem_tgs and '偏官' in stem_tgs:
            infidelity_risk = '中高'

    # Volatility risk
    volatility_risk = '低'
    has_day_clash = any(
        f['factor'] == '日支被沖' for f in risk_factors
    )
    if has_day_clash:
        volatility_risk = '高'
    elif risk_score >= 30:
        volatility_risk = '中'

    return {
        'overallRisk': overall_risk,
        'riskScore': min(100, risk_score),
        'riskFactors': risk_factors,
        'infidelityRisk': infidelity_risk,
        'volatilityRisk': volatility_risk,
        'hourUnknown': hour_unknown,
    }


# ============================================================
# Function 6: Combined Crisis Assessment (兩人合婚危機)
# ============================================================

def compute_combined_crisis_assessment(
    chart_a: Dict,
    chart_b: Dict,
    enhanced_data: Dict,
) -> Dict[str, Any]:
    """Check same-position branch pairs for crisis/warning with tiered flagging.

    Tier 1 (crisis): 日支六沖, 天剋地沖
    Tier 2 (warning): 年/月支六沖, 日支六害, 合化忌神, 命宮相衝
    Tier 3 (note): Cross-position hitting day branch
    """
    branches_a = _get_branches(chart_a)
    branches_b = _get_branches(chart_b)
    stems_a = _get_stems(chart_a)
    stems_b = _get_stems(chart_b)
    dm_a = _get_dm_stem(chart_a)
    dm_b = _get_dm_stem(chart_b)
    effective_gods_a = _get_effective_gods(chart_a)
    effective_gods_b = _get_effective_gods(chart_b)

    crisis_flags: List[Dict[str, str]] = []
    warning_flags: List[Dict[str, str]] = []
    note_flags: List[Dict[str, str]] = []

    pos_names_zh = ['年', '月', '日', '時']

    # Same-position branch check
    for i, pos in enumerate(['year', 'month', 'day', 'hour']):
        if i >= len(branches_a) or i >= len(branches_b):
            continue
        br_a = branches_a[i]
        br_b = branches_b[i]
        if not br_a or not br_b:
            continue

        if _is_liuchong(br_a, br_b):
            entry = {
                'position': pos,
                'type': '六沖',
                'desc': f'{pos_names_zh[i]}支六沖（{br_a}沖{br_b}）',
            }
            if pos == 'day':
                crisis_flags.append(entry)
            else:
                warning_flags.append(entry)

        if _is_liuhai(br_a, br_b):
            entry = {
                'position': pos,
                'type': '六害',
                'desc': f'{pos_names_zh[i]}支六害（{br_a}害{br_b}）',
            }
            if pos == 'day':
                warning_flags.append(entry)
            else:
                note_flags.append(entry)

    # 天剋地沖 (day pillar)
    day_br_a = branches_a[2] if len(branches_a) > 2 else ''
    day_br_b = branches_b[2] if len(branches_b) > 2 else ''
    if dm_a and dm_b and _is_stem_clash(dm_a, dm_b) and _is_liuchong(day_br_a, day_br_b):
        crisis_flags.append({
            'position': 'day',
            'type': '天剋地沖',
            'desc': f'天干{dm_a}剋{dm_b}且日支{day_br_a}沖{day_br_b}，婚姻最大危機信號',
        })

    # 合化忌神 — compute cross-chart stem combinations directly
    taboo_a = effective_gods_a.get('tabooGod', '')
    taboo_b = effective_gods_b.get('tabooGod', '')
    seen_combos: set = set()
    for sa in stems_a:
        if not sa:
            continue
        combo_info = STEM_COMBINATION_LOOKUP.get(sa)
        if not combo_info:
            continue
        partner, result_element, combo_name = combo_info
        if partner in stems_b:
            dedup_key = tuple(sorted([sa, partner]))
            if dedup_key in seen_combos:
                continue
            seen_combos.add(dedup_key)
            if result_element == taboo_a or result_element == taboo_b:
                # Determine affected party — handle dual-taboo case
                if result_element == taboo_a and result_element == taboo_b:
                    who = '雙方'
                elif result_element == taboo_a:
                    who = '男方'
                else:
                    who = '女方'
                warning_flags.append({
                    'position': 'cross_stem',
                    'type': '合化忌神',
                    'desc': f'{sa}{partner}合（{combo_name}）化{result_element}（{who}忌神）',
                })

    # 命宮相衝
    mg_a = chart_a.get('mingGong', {}).get('branch', '')
    mg_b = chart_b.get('mingGong', {}).get('branch', '')
    if mg_a and mg_b and _is_liuchong(mg_a, mg_b):
        warning_flags.append({
            'position': 'mingGong',
            'type': '命宮相衝',
            'desc': f'命宮{mg_a}沖{mg_b}，人生方向有分歧',
        })

    # Tier 3: Cross-position hitting day branch
    # Check if A's non-day branches clash B's day branch (or vice versa)
    for i in [0, 1, 3]:  # year, month, hour
        if i >= len(branches_a):
            continue
        br = branches_a[i]
        if br and day_br_b and _is_liuchong(br, day_br_b):
            note_flags.append({
                'position': f'A_{pos_names_zh[i]}→B_日',
                'type': '沖配偶宮',
                'desc': f'男方{pos_names_zh[i]}支{br}沖女方日支{day_br_b}',
            })
        br = branches_b[i]
        if br and day_br_a and _is_liuchong(br, day_br_a):
            note_flags.append({
                'position': f'B_{pos_names_zh[i]}→A_日',
                'type': '沖配偶宮',
                'desc': f'女方{pos_names_zh[i]}支{br}沖男方日支{day_br_a}',
            })

    # Classify destructive level
    if crisis_flags:
        level = '嚴重'
    elif len(warning_flags) >= 2:
        level = '需留意'
    elif warning_flags:
        level = '輕微'
    else:
        level = '良好'

    return {
        'destructiveLevel': level,
        'crisisFlags': crisis_flags,
        'warningFlags': warning_flags,
        'noteFlags': note_flags,
    }


# ============================================================
# Function 7: Compatibility Annual Forecast (流年感情運)
# ============================================================

def _check_annual_lu_hits_spouse_palace(
    day_branch: str,
    annual_branch: str,
) -> bool:
    """Check if any hidden stem in the annual branch has its 祿神 on the natal day branch."""
    for hs in HIDDEN_STEMS.get(annual_branch, []):
        if LUSHEN.get(hs) == day_branch:
            return True
    return False


def _check_peach_blossom_locked(
    natal_branches: List[str],
    taohua_branch: str,
) -> bool:
    """Check if natal 桃花 branch is combined by any other natal branch (六合)."""
    if not taohua_branch:
        return False
    for br in natal_branches:
        if br != taohua_branch and BRANCH_LIUHE.get(br) == taohua_branch:
            return True
    return False


def _check_banhe(br_a: str, br_b: str) -> Optional[Dict[str, str]]:
    """Check if two branches form a 半合 (half of a 三合).

    Returns dict with 'element', 'missing', 'strength' or None.
    Strength levels:
    - '旺位': pair contains the 旺 (peak) branch of the element
    - '庫位': pair contains the 庫 (storage) branch
    - '缺旺': pair misses the 旺 branch (weakest half-combo)
    """
    # 三合 groups: (branch1, branch2, branch3, result_element)
    # Within each: branch order is 生位-旺位-庫位
    SANHE_TRIOS = [
        ('申', '子', '辰', '水'),  # 申=生, 子=旺, 辰=庫
        ('亥', '卯', '未', '木'),  # 亥=生, 卯=旺, 未=庫
        ('寅', '午', '戌', '火'),  # 寅=生, 午=旺, 戌=庫
        ('巳', '酉', '丑', '金'),  # 巳=生, 酉=旺, 丑=庫
    ]
    pair = {br_a, br_b}
    for sheng, wang, ku, elem in SANHE_TRIOS:
        trio = {sheng, wang, ku}
        if pair.issubset(trio) and len(pair) == 2:
            missing = (trio - pair).pop()
            if missing == wang:
                strength = '缺旺'  # weakest — missing the peak
            elif missing == ku:
                strength = '旺位'  # strong — has the peak branch
            else:  # missing == sheng
                strength = '庫位'  # moderate — has peak + storage
            return {'element': elem, 'missing': missing, 'strength': strength}
    return None


def _calculate_annual_hongluan_tianxi(
    year_branch: str,
) -> Tuple[str, str]:
    """Calculate 紅鸞 and 天喜 using annual rotation method.

    紅鸞: count backwards from 卯 by the index of the year branch
    天喜: opposite of 紅鸞 (+ 6 positions)
    """
    year_idx = BRANCH_INDEX.get(year_branch, 0)
    # 紅鸞 = (3 - year_idx) % 12 where 3 = index of 卯
    hongluan_idx = (3 - year_idx) % 12
    tianxi_idx = (hongluan_idx + 6) % 12
    return EARTHLY_BRANCHES[hongluan_idx], EARTHLY_BRANCHES[tianxi_idx]


def compute_compatibility_annual_forecast(
    chart: Dict,
    gender: str,
    effective_gods: Dict,
    current_year: int,
) -> Dict[str, Any]:
    """Compute annual love forecast with three-scenario format.

    Detects: 桃花星飛臨/未飛臨, 桃花星受合, 夫妻宮見祿,
    夫妻宮受合/受沖, 紅鸞/天喜 annual activation.
    """
    dm_stem = _get_dm_stem(chart)
    pillars = _get_pillars(chart)
    day_branch = pillars.get('day', {}).get('branch', '')
    year_branch = pillars.get('year', {}).get('branch', '')
    branches = _get_branches(chart)

    # Calculate current year branch
    # 2024 = 甲辰, branch index = (year - 4) % 12
    current_year_branch_idx = (current_year - 4) % 12
    current_year_branch = EARTHLY_BRANCHES[current_year_branch_idx]

    # Natal peach blossom branches (based on day branch and year branch)
    taohua_day = TAOHUA.get(day_branch, '')
    taohua_year = TAOHUA.get(year_branch, '')

    signals: List[Dict[str, Any]] = []

    # 1. 桃花星飛臨 — annual branch IS a peach blossom target
    taohua_activated = (current_year_branch == taohua_day or current_year_branch == taohua_year)
    if taohua_activated:
        signals.append({
            'signal': '桃花星飛臨',
            'singleImplication': '桃花運旺，異性緣明顯提升，把握社交機會',
            'datingImplication': '感情進展順利，有機會確定關係',
            'marriedImplication': '需注意婚外桃花，多與伴侶互動維繫感情',
        })
    else:
        signals.append({
            'signal': '桃花星未飛臨',
            'singleImplication': '桃花運平淡，主動出擊比被動等待更有效',
            'datingImplication': '感情穩定但缺少驚喜，需要主動製造浪漫',
            'marriedImplication': '婚姻平穩，適合經營細水長流的感情',
        })

    # 2. 桃花星受合 — natal 桃花 locked by 六合
    taohua_branches = []
    if taohua_day:
        taohua_branches.append(taohua_day)
    if taohua_year and taohua_year != taohua_day:
        taohua_branches.append(taohua_year)

    for tb in taohua_branches:
        if _check_peach_blossom_locked(branches, tb):
            signals.append({
                'signal': '桃花星受合',
                'singleImplication': '桃花被合住，異性緣被限制，不易展開新戀情',
                'datingImplication': '感情被約束，可能有家庭或工作阻礙',
                'marriedImplication': '桃花受制，婚姻較穩定，不易出軌',
            })
            break

    # 3. 夫妻宮見祿 — annual hidden stems' 祿 falls on day branch
    if _check_annual_lu_hits_spouse_palace(day_branch, current_year_branch):
        signals.append({
            'signal': '夫妻宮見祿',
            'singleImplication': '配偶宮有祿，今年有機會遇到條件好的對象',
            'datingImplication': '伴侶事業財運好轉，關係因此受益',
            'marriedImplication': '配偶財運提升，家庭經濟改善',
        })

    # 4. 夫妻宮受合/受沖
    if _is_liuhe(current_year_branch, day_branch):
        signals.append({
            'signal': '夫妻宮受合',
            'singleImplication': '配偶宮被合動，今年感情有重大進展的機會',
            'datingImplication': '與伴侶關係加深，有論及婚嫁的可能',
            'marriedImplication': '婚姻和諧度提升，感情升溫',
        })
    elif _is_liuchong(current_year_branch, day_branch):
        signals.append({
            'signal': '夫妻宮受沖',
            'singleImplication': '配偶宮被沖動，感情容易出現變化',
            'datingImplication': '與伴侶可能產生重大分歧，需要溝通',
            'marriedImplication': '婚姻面臨考驗，需特別注意經營關係',
        })

    # 4b. 夫妻宮半合 (annual branch + day branch form half of a 三合)
    # Only fires if 六合 and 六沖 both missed (to avoid duplicate signals)
    if not _is_liuhe(current_year_branch, day_branch) and not _is_liuchong(current_year_branch, day_branch):
        half_combo = _check_banhe(current_year_branch, day_branch)
        if half_combo:
            missing_br = half_combo['missing']
            result_elem = half_combo['element']
            strength = half_combo['strength']  # '旺位' or '庫位' or '缺旺'

            if strength == '旺位':
                signals.append({
                    'signal': f'夫妻宮半合{result_elem}（{strength}）',
                    'singleImplication': f'配偶宮與流年形成強力半合{result_elem}，感情有重大突破的機會',
                    'datingImplication': f'與伴侶的關係因半合{result_elem}而加速進展，適合規劃未來',
                    'marriedImplication': f'婚姻宮受半合{result_elem}催化，夫妻默契度明顯提升',
                })
            elif strength == '庫位':
                signals.append({
                    'signal': f'夫妻宮半合{result_elem}（{strength}）',
                    'singleImplication': f'配偶宮與流年半合{result_elem}入庫，有潛在感情機會但需主動爭取',
                    'datingImplication': f'關係中有穩定沉澱的趨勢，適合深入了解對方',
                    'marriedImplication': f'婚姻因半合{result_elem}入庫而更加穩固，感情沉澱期',
                })
            else:  # 缺旺
                signals.append({
                    'signal': f'夫妻宮微合{result_elem}',
                    'singleImplication': f'配偶宮有輕微合動，感情可能有微小進展',
                    'datingImplication': f'關係中有溫和的正面推動，但不會有劇烈變化',
                    'marriedImplication': f'婚姻有淡淡的正向催化，日常相處更融洽',
                })

    # 5. 紅鸞/天喜 annual activation
    annual_hongluan, annual_tianxi = _calculate_annual_hongluan_tianxi(current_year_branch)

    # Check if annual 紅鸞 or 天喜 falls on any natal branch
    hongluan_activated = annual_hongluan in branches
    tianxi_activated = annual_tianxi in branches

    if hongluan_activated:
        signals.append({
            'signal': '紅鸞星動',
            'singleImplication': '姻緣星動，今年有機會遇到正緣',
            'datingImplication': '感情成熟，有步入婚姻的機會',
            'marriedImplication': '夫妻感情回溫，可能迎來新生命',
        })
    if tianxi_activated:
        signals.append({
            'signal': '天喜星動',
            'singleImplication': '喜慶之年，社交場合有意外邂逅',
            'datingImplication': '感情中充滿喜悅，好事將近',
            'marriedImplication': '家庭有喜事，生活幸福美滿',
        })

    # 6. Annual branch element role assessment
    annual_elem = BRANCH_ELEMENT.get(current_year_branch, '')
    role = _element_role(annual_elem, effective_gods)
    if role in ('用神', '喜神'):
        signals.append({
            'signal': f'流年地支為{role}',
            'singleImplication': '整體運勢向好，感情發展有利',
            'datingImplication': '感情順遂，宜積極經營關係',
            'marriedImplication': '婚姻和睦，家庭運勢上升',
        })
    elif role in ('忌神', '仇神'):
        signals.append({
            'signal': f'流年地支為{role}',
            'singleImplication': '感情運勢受壓，耐心等待時機',
            'datingImplication': '感情中可能遇到阻礙，需要包容',
            'marriedImplication': '婚姻需要更多經營，注意溝通',
        })

    return {
        'year': current_year,
        'yearBranch': current_year_branch,
        'signals': signals,
        'annualHongluan': annual_hongluan,
        'annualTianxi': annual_tianxi,
        'hongluanActivated': hongluan_activated,
        'tianxiActivated': tianxi_activated,
        'taohuaActivated': taohua_activated,
    }


# ============================================================
# Helper: Peach Blossom & Spouse Star Counts (V7-C)
# ============================================================

def _count_peach_blossoms(chart: Dict) -> int:
    """Count natal 桃花 using standard TAOHUA table (year + day branch as source)."""
    branches = [chart.get('fourPillars', {}).get(p, {}).get('branch', '') for p in ['year', 'month', 'day', 'hour']]
    year_br = branches[0]
    day_br = branches[2]

    targets = set()
    taohua_year = TAOHUA.get(year_br, '')
    taohua_day = TAOHUA.get(day_br, '')
    if taohua_year:
        targets.add(taohua_year)
    if taohua_day:
        targets.add(taohua_day)

    count = 0
    for br in branches:
        if br in targets:
            count += 1
    return count


def _count_spouse_stars(chart: Dict, gender: str) -> int:
    """Count spouse stars in chart (正財 for male, 正官 for female)."""
    from .ten_gods import derive_ten_god
    dm = chart.get('dayMaster', {}).get('stem', '') if isinstance(chart.get('dayMaster'), dict) else ''
    if not dm:
        # Try alternate path
        dm = chart.get('fourPillars', {}).get('day', {}).get('stem', '')

    target_god = '正財' if gender == 'male' else '正官'

    count = 0
    # Check stems (year, month, hour — NOT day stem which is DM)
    for p in ['year', 'month', 'hour']:
        stem = chart.get('fourPillars', {}).get(p, {}).get('stem', '')
        if stem and derive_ten_god(dm, stem) == target_god:
            count += 1

    # Check hidden stems in all branches
    for p in ['year', 'month', 'day', 'hour']:
        branch = chart.get('fourPillars', {}).get(p, {}).get('branch', '')
        hidden = HIDDEN_STEMS.get(branch, [])
        for hs in hidden:
            if derive_ten_god(dm, hs) == target_god:
                count += 1
                break  # Count each branch once

    return count


# ============================================================
# Helper: Identical Charts Check
# ============================================================

def _charts_are_identical(chart_a: Dict, chart_b: Dict) -> bool:
    """Check if two charts have identical four pillars."""
    pillars_a = _get_pillars(chart_a)
    pillars_b = _get_pillars(chart_b)
    for pos in ['year', 'month', 'day', 'hour']:
        pa = pillars_a.get(pos, {})
        pb = pillars_b.get(pos, {})
        if pa.get('stem', '') != pb.get('stem', '') or pa.get('branch', '') != pb.get('branch', ''):
            return False
    return True


# ============================================================
# Master Orchestrator
# ============================================================

def compute_compatibility_romance_preanalysis(
    chart_a: Dict,
    chart_b: Dict,
    gender_a: str,
    gender_b: str,
    enhanced_data: Dict,
    current_year: int = 2026,
) -> Dict[str, Any]:
    """Master orchestrator for romance V2 pre-analysis.

    Calls existing generate_compatibility_pre_analysis() + all 7 new functions.
    Merges into single dict for AI narration.
    """
    # Identical charts guard
    if _charts_are_identical(chart_a, chart_b):
        return {'identical': True, 'message': '同一命盤無法進行合盤分析'}

    # Extract effective gods
    effective_gods_a = _get_effective_gods(chart_a)
    effective_gods_b = _get_effective_gods(chart_b)
    luck_periods_a = _get_luck_periods(chart_a)
    luck_periods_b = _get_luck_periods(chart_b)

    # 1. Individual love personality (with partner cross-reference)
    partner_element_b = STEM_ELEMENT.get(chart_b.get('dayMasterStem', ''), '')
    partner_element_a = STEM_ELEMENT.get(chart_a.get('dayMasterStem', ''), '')
    lp_a = compute_individual_love_personality(chart_a, gender_a, partner_dm_element=partner_element_b)
    lp_b = compute_individual_love_personality(chart_b, gender_b, partner_dm_element=partner_element_a)

    # 2. Spouse enrichment
    se_a = compute_spouse_enrichment(chart_a, gender_a, effective_gods_a)
    se_b = compute_spouse_enrichment(chart_b, gender_b, effective_gods_b)

    # 3. Marriage wealth
    mw_a = compute_marriage_wealth(chart_a, gender_a, effective_gods_a, luck_periods_a)
    mw_b = compute_marriage_wealth(chart_b, gender_b, effective_gods_b, luck_periods_b)

    # 4. Post-marriage quality
    pmq = compute_post_marriage_quality(chart_a, chart_b, enhanced_data)

    # 5. Marriage crisis risk
    cr_a = compute_marriage_crisis_risk(chart_a, gender_a, effective_gods_a)
    cr_b = compute_marriage_crisis_risk(chart_b, gender_b, effective_gods_b)

    # 6. Combined crisis assessment
    cc = compute_combined_crisis_assessment(chart_a, chart_b, enhanced_data)

    # 7. Annual forecast
    af_a = compute_compatibility_annual_forecast(chart_a, gender_a, effective_gods_a, current_year)
    af_b = compute_compatibility_annual_forecast(chart_b, gender_b, effective_gods_b, current_year)

    # V7-A: Score recalibration — blend base score with romance quality
    # Formula: 60% base adjustedScore + 40% romance quality average
    base_score = enhanced_data.get('adjustedScore', 50)
    sweetness_score = pmq.get('sweetness', {}).get('score', 50)
    stability_score = pmq.get('stability', {}).get('score', 50)
    romance_avg = (sweetness_score + stability_score) / 2
    blended_score = round(0.6 * base_score + 0.4 * romance_avg)
    blended_score = max(5, min(99, blended_score))  # clamp 5-99

    # Label thresholds
    if blended_score >= 80:
        blended_label = '天作之合'
    elif blended_score >= 65:
        blended_label = '相當契合'
    elif blended_score >= 55:
        blended_label = '需要經營'
    elif blended_score >= 40:
        blended_label = '挑戰不少'
    else:
        blended_label = '困難重重'

    # Build top-level shared data (accessible by ALL AI calls)
    def _build_lp_summary(lps):
        return [
            {
                'period': f"{lp.get('startAge', 0)}-{lp.get('endAge', lp.get('startAge', 0) + 9)}歲",
                'ganZhi': f"{lp.get('stem', '')}{lp.get('branch', '')}",
                'tenGod': lp.get('tenGod', ''),
                'isCurrent': lp.get('isCurrent', False),
            }
            for lp in lps
        ]

    def _extract_current_lp(lps, eff_gods):
        """Extract current luck period with element role assessment (V5)."""
        for lp in lps:
            if lp.get('isCurrent', False):
                result = {
                    'ganZhi': f"{lp.get('stem', '')}{lp.get('branch', '')}",
                    'period': f"{lp.get('startAge', 0)}-{lp.get('endAge', lp.get('startAge', 0) + 9)}歲",
                    'tenGod': lp.get('tenGod', ''),
                    'startYear': lp.get('startYear', 0),
                    'endYear': lp.get('endYear', 0),
                }
                # V5: Add element role assessment
                stem = lp.get('stem', '')
                branch = lp.get('branch', '')
                stem_el = STEM_ELEMENT.get(stem, '')
                branch_el = BRANCH_ELEMENT.get(branch, '')
                useful = eff_gods.get('usefulGod', '')
                favorable = eff_gods.get('favorableGod', '')
                taboo = eff_gods.get('tabooGod', '')
                enemy = eff_gods.get('enemyGod', '')
                # Check stem first (dominant), then branch
                if stem_el in (taboo, enemy):
                    result['elementRole'] = '忌仇神主導，大運整體偏弱'
                elif stem_el in (useful, favorable):
                    result['elementRole'] = '喜用神主導，大運整體有利'
                elif branch_el in (taboo, enemy):
                    result['elementRole'] = '大運地支偏弱，需留意'
                elif branch_el in (useful, favorable):
                    result['elementRole'] = '大運地支有利'
                else:
                    result['elementRole'] = '大運整體中性'
                return result
        return None

    return {
        # Per-function outputs
        'lovePersonalityA': lp_a,
        'lovePersonalityB': lp_b,
        'spouseEnrichmentA': se_a,
        'spouseEnrichmentB': se_b,
        'marriageWealthA': mw_a,
        'marriageWealthB': mw_b,
        'postMarriageQuality': pmq,
        'crisisRiskA': cr_a,
        'crisisRiskB': cr_b,
        'combinedCrisis': cc,
        'annualForecastA': af_a,
        'annualForecastB': af_b,

        # Top-level shared data (V4-1, V4-2, V4-5)
        'fiveElementAssessmentA': _build_five_element_assessment(chart_a, effective_gods_a),
        'fiveElementAssessmentB': _build_five_element_assessment(chart_b, effective_gods_b),
        'luckPeriodSummaryA': _build_lp_summary(luck_periods_a),
        'luckPeriodSummaryB': _build_lp_summary(luck_periods_b),
        'currentLuckPeriodA': _extract_current_lp(luck_periods_a, effective_gods_a),
        'currentLuckPeriodB': _extract_current_lp(luck_periods_b, effective_gods_b),

        # V7-A: Blended score
        'blendedScore': blended_score,
        'blendedLabel': blended_label,
        'scoreBreakdown': {
            'baseScore': base_score,
            'sweetnessScore': sweetness_score,
            'stabilityScore': stability_score,
            'romanceAvg': round(romance_avg),
            'formula': '60% 配對基礎分 + 40% 婚後品質平均',
        },

        # V7-C: Peach blossom & spouse star counts
        'peachBlossomCountA': _count_peach_blossoms(chart_a),
        'peachBlossomCountB': _count_peach_blossoms(chart_b),
        'spouseStarCountA': _count_spouse_stars(chart_a, gender_a),
        'spouseStarCountB': _count_spouse_stars(chart_b, gender_b),
    }
