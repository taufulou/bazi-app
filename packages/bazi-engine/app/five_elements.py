"""
Five Elements (五行) Balance Analysis

Calculates the distribution and balance of the Five Elements
across all eight characters (stems and branches) in the chart.

Also determines Day Master strength (旺衰) based on:
1. Season (month branch) support
2. Count of supporting elements
3. Hidden stem contributions
"""

from typing import Dict, List, Optional, Tuple

from .constants import (
    BRANCH_ELEMENT,
    ELEMENT_INDEX,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    ELEMENT_OVERCOMES,
    ELEMENT_OVERCOME_BY,
    FIVE_ELEMENTS,
    HIDDEN_STEMS,
    HIDDEN_STEM_WEIGHTS,
    SEASON_MULTIPLIER,
    SEASON_STATE_LABELS,
    SEASON_STRENGTH,
    STEM_ELEMENT,
    STEM_YINYANG,
    TEN_GOD_CATEGORIES,
)


def _accumulate_raw_element_scores(pillars: Dict) -> Dict[str, float]:
    """
    Shared raw score accumulation (stems + hidden stems).

    Used by both raw and seasonal balance functions to avoid code duplication.

    Scoring method:
    - Each manifest stem contributes 1.0 point to its element
    - Each branch contributes through its hidden stems with weights
      (本氣=0.6~1.0, 中氣=0.3, 餘氣=0.1)

    Args:
        pillars: The four pillars dictionary

    Returns:
        Dictionary with element → raw score (not normalized)
    """
    element_scores: Dict[str, float] = {e: 0.0 for e in FIVE_ELEMENTS}

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        stem_element = STEM_ELEMENT[pillar['stem']]
        element_scores[stem_element] += 1.0

        hidden = HIDDEN_STEMS.get(pillar['branch'], [])
        weights = HIDDEN_STEM_WEIGHTS.get(pillar['branch'], [])
        for i, hs in enumerate(hidden):
            weight = weights[i] if i < len(weights) else 0.1
            element_scores[STEM_ELEMENT[hs]] += weight

    return element_scores


def calculate_five_elements_balance(pillars: Dict) -> Dict[str, float]:
    """
    Calculate the raw Five Elements balance as percentages (no seasonal adjustment).

    Used for analytical decisions (從格 detection, etc.) where seasonal influence
    is already accounted for by strength_v2 via SEASON_DELING_SCORE.

    Args:
        pillars: The four pillars dictionary

    Returns:
        Dictionary with element → percentage (0-100, sums to ~100)
    """
    element_scores = _accumulate_raw_element_scores(pillars)

    total = sum(element_scores.values())
    if total == 0:
        return {e: 20.0 for e in FIVE_ELEMENTS}

    return {e: round(element_scores[e] / total * 100, 1) for e in FIVE_ELEMENTS}


def calculate_five_elements_balance_seasonal(pillars: Dict) -> Dict[str, float]:
    """
    Calculate seasonally-adjusted Five Elements balance for display/narration.

    Applies 旺相休囚死 (Five Qi States) multipliers based on the birth month branch.
    This matches major reference sites (易安居, 水墨先生, 神巴巴).

    Note: This is for DISPLAY/NARRATION only. Analytical decisions (從格 detection,
    DM strength) use the raw balance from calculate_five_elements_balance() to avoid
    double-counting seasonal influence (strength_v2 already incorporates seasonal
    factors via SEASON_DELING_SCORE).

    Args:
        pillars: The four pillars dictionary

    Returns:
        Dictionary with element → percentage (0-100, sums to ~100)
    """
    element_scores = _accumulate_raw_element_scores(pillars)

    # Apply seasonal multiplier based on birth month branch
    month_branch = pillars['month']['branch']
    for element in FIVE_ELEMENTS:
        season_score = SEASON_STRENGTH.get(element, {}).get(month_branch, 3)
        multiplier = SEASON_MULTIPLIER.get(season_score, 1.0)
        element_scores[element] *= multiplier

    total = sum(element_scores.values())
    if total == 0:
        return {e: 20.0 for e in FIVE_ELEMENTS}

    return {e: round(element_scores[e] / total * 100, 1) for e in FIVE_ELEMENTS}


def get_seasonal_state_labels(month_branch: str) -> Dict[str, str]:
    """
    Return the 旺相休囚死 seasonal state label for each element given a birth month branch.

    Example for 丑月: {木: '囚', 火: '休', 土: '旺', 金: '相', 水: '死'}

    Args:
        month_branch: The birth month's Earthly Branch

    Returns:
        Dictionary with element → seasonal state label (旺/相/休/囚/死)
    """
    return {
        e: SEASON_STATE_LABELS.get(SEASON_STRENGTH.get(e, {}).get(month_branch, 3), '休')
        for e in FIVE_ELEMENTS
    }


# ============================================================
# Weighted Five Elements for Career Pre-Analysis
# ============================================================

# Element → Talent mapping (matches Seer's commercial format)
ELEMENT_TALENTS: Dict[str, List[str]] = {
    '木': ['學習能力', '自愈能力', '協調能力'],
    '火': ['情緒感知力', '探索能力', '表現力'],
    '土': ['自律能力', '自控力', '責任承擔力'],
    '金': ['實操能力', '掌控力', '應變能力'],
    '水': ['邏輯思維', '細節處理能力', '專注力'],
}

# Level thresholds
ELEMENT_LEVEL_THRESHOLDS = [
    (5.0, '很弱'),
    (15.0, '弱'),
    (25.0, '一般'),
    (40.0, '強'),
    (100.0, '很強'),
]


def _get_element_level(percentage: float) -> str:
    """Get element strength level label from percentage."""
    for threshold, label in ELEMENT_LEVEL_THRESHOLDS:
        if percentage < threshold:
            return label
    return '很強'


def calculate_weighted_five_elements(
    pillars: Dict,
    month_branch: str,
    extra_pillars: Optional[List[Dict[str, str]]] = None,
    branch_interactions: Optional[Dict] = None,
) -> Dict[str, Dict]:
    """
    Calculate weighted Five Elements (五行比重) for career pre-analysis.

    Uses System A "Equal Base" — the most commonly used system across
    commercial Bazi sites (易安居, 水墨先生, 神巴巴).

    Algorithm:
    1. Accumulate raw element scores from four pillars
       (stems=1.0, branches via hidden stem weights: 60:30:10 / 70:30 / 100%)
    2. Add extra pillars (胎元/命宮/身宮) at 0.5× weight
    3. Apply 旺相休囚死 seasonal multiplier (1.5/1.3/1.0/0.8/0.6)
    4. Optionally adjust for 地支合沖 interactions
    5. Normalize to percentages and map to levels/talents

    Args:
        pillars: The four pillars dictionary
        month_branch: Birth month's Earthly Branch
        extra_pillars: Optional list of supplementary pillars (胎元/命宮/身宮),
                       each with 'stem' and 'branch' keys. Weighted at 0.5×.
        branch_interactions: Optional dict from analyze_branch_relationships()
                            for 六合/六沖 adjustments.

    Returns:
        Dictionary with element → { percentage, level, talents } per element
    """
    # Step 1: Base raw element scores from four pillars
    element_scores = _accumulate_raw_element_scores(pillars)

    # Step 2: Add extra pillar contributions at 0.5× weight
    if extra_pillars:
        for ep in extra_pillars:
            if not ep or 'stem' not in ep or 'branch' not in ep:
                continue
            # Stem contribution at 0.5×
            stem_element = STEM_ELEMENT.get(ep['stem'])
            if stem_element:
                element_scores[stem_element] += 0.5

            # Branch hidden stems at 0.5×
            hidden = HIDDEN_STEMS.get(ep['branch'], [])
            weights = HIDDEN_STEM_WEIGHTS.get(ep['branch'], [])
            for i, hs in enumerate(hidden):
                weight = weights[i] if i < len(weights) else 0.1
                hs_element = STEM_ELEMENT.get(hs)
                if hs_element:
                    element_scores[hs_element] += weight * 0.5

    # Step 3: Apply 旺相休囚死 seasonal multiplier
    for element in FIVE_ELEMENTS:
        season_score = SEASON_STRENGTH.get(element, {}).get(month_branch, 3)
        multiplier = SEASON_MULTIPLIER.get(season_score, 1.0)
        element_scores[element] *= multiplier

    # Step 4: Optional branch interaction adjustments
    if branch_interactions:
        # 六合 that transforms: boost the transformed element
        for harmony in branch_interactions.get('harmonies', []):
            result_element = harmony.get('resultElement')
            if result_element and result_element in element_scores:
                element_scores[result_element] += 0.3

        # 六沖: reduce clashed branches' effective contribution
        for clash in branch_interactions.get('clashes', []):
            branches = clash.get('branches', ())
            for branch in branches:
                branch_element = BRANCH_ELEMENT.get(branch)
                if branch_element and branch_element in element_scores:
                    element_scores[branch_element] -= 0.15
                    # Ensure non-negative
                    if element_scores[branch_element] < 0:
                        element_scores[branch_element] = 0.0

    # Step 5: Normalize to percentages
    total = sum(element_scores.values())
    if total == 0:
        percentages = {e: 20.0 for e in FIVE_ELEMENTS}
    else:
        percentages = {e: round(element_scores[e] / total * 100, 1) for e in FIVE_ELEMENTS}

    # Build result with level and talent mapping
    result = {}
    for element in FIVE_ELEMENTS:
        pct = percentages[element]
        result[element] = {
            'percentage': pct,
            'level': _get_element_level(pct),
            'talents': ELEMENT_TALENTS.get(element, []),
        }

    return result


def calculate_element_counts(pillars: Dict) -> Dict[str, Dict[str, int]]:
    """
    Count elements in different categories.

    Returns counts for:
    - stems: Only counting the 4 manifest stems
    - branches: Only counting the 4 branch main elements
    - hidden: Counting all hidden stems
    - total: Everything combined

    Args:
        pillars: The four pillars dictionary

    Returns:
        Dictionary with category → element → count
    """
    stems: Dict[str, int] = {e: 0 for e in FIVE_ELEMENTS}
    branches: Dict[str, int] = {e: 0 for e in FIVE_ELEMENTS}
    hidden_counts: Dict[str, int] = {e: 0 for e in FIVE_ELEMENTS}

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        stem = pillar['stem']
        branch = pillar['branch']

        stems[STEM_ELEMENT[stem]] += 1
        branches[BRANCH_ELEMENT[branch]] += 1

        for hs in HIDDEN_STEMS.get(branch, []):
            hidden_counts[STEM_ELEMENT[hs]] += 1

    total: Dict[str, int] = {}
    for e in FIVE_ELEMENTS:
        total[e] = stems[e] + branches[e] + hidden_counts[e]

    return {
        'stems': stems,
        'branches': branches,
        'hidden': hidden_counts,
        'total': total,
    }


def analyze_day_master_strength(
    pillars: Dict,
    day_master_stem: str,
) -> Dict:
    """
    Analyze the Day Master's strength (旺衰).

    Factors:
    1. Season support (月令): Is the Day Master's element strong in the birth month?
    2. Stem support: How many stems share or produce the Day Master's element?
    3. Branch support: How many branches support the Day Master?
    4. Overall balance: Ratio of supporting vs. draining elements

    Strength classification:
    - 偏強 (Strong): Day Master has significant support
    - 中和 (Neutral): Balanced
    - 偏弱 (Weak): Day Master lacks support

    Args:
        pillars: The four pillars
        day_master_stem: Day Master's Heavenly Stem

    Returns:
        Dictionary with strength analysis
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    dm_yinyang = STEM_YINYANG[day_master_stem]
    month_branch = pillars['month']['branch']

    # 1. Season strength (月令旺衰)
    season_score = SEASON_STRENGTH.get(dm_element, {}).get(month_branch, 2)
    # 0=dead, 1=very weak, 2=weak, 3=neutral, 4=strong, 5=prosperous

    # 2. Count supporting elements across all pillars
    # Supporting: Same element (比劫) + element that produces me (印)
    # Draining: Element I produce (食傷) + element I overcome (財) + element that overcomes me (官殺)
    supporting_element = dm_element
    producing_element = ELEMENT_PRODUCED_BY[dm_element]
    i_produce = ELEMENT_PRODUCES[dm_element]
    i_overcome = ELEMENT_OVERCOMES[dm_element]
    overcomes_me = ELEMENT_OVERCOME_BY[dm_element]

    support_score = 0.0
    drain_score = 0.0

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        stem = pillar['stem']
        branch = pillar['branch']

        # Stem contribution (skip day stem — it IS the day master)
        if pillar_name != 'day':
            stem_el = STEM_ELEMENT[stem]
            if stem_el == supporting_element or stem_el == producing_element:
                support_score += 1.0
            else:
                drain_score += 1.0
        else:
            # Day stem is the day master itself — counts as self-support
            support_score += 1.0

        # Branch hidden stems contribution
        hidden = HIDDEN_STEMS.get(branch, [])
        weights = HIDDEN_STEM_WEIGHTS.get(branch, [])
        for i, hs in enumerate(hidden):
            weight = weights[i] if i < len(weights) else 0.1
            hs_element = STEM_ELEMENT[hs]
            if hs_element == supporting_element or hs_element == producing_element:
                support_score += weight
            else:
                drain_score += weight

    # 3. Calculate overall strength score (0-100)
    total = support_score + drain_score
    if total == 0:
        support_ratio = 0.5
    else:
        support_ratio = support_score / total

    # Combine season and support ratio
    # Season weight = 40%, Support weight = 60%
    season_normalized = season_score / 5.0  # 0.0 to 1.0
    strength_score = round(
        (season_normalized * 0.4 + support_ratio * 0.6) * 100
    )

    # Clamp to 0-100
    strength_score = max(0, min(100, strength_score))

    # Classify strength
    if strength_score >= 70:
        strength = 'very_strong'
    elif strength_score >= 55:
        strength = 'strong'
    elif strength_score >= 45:
        strength = 'neutral'
    elif strength_score >= 30:
        strength = 'weak'
    else:
        strength = 'very_weak'

    # 4. Determine same-party vs opposite-party ratio
    # 同黨: Same element + produces me
    # 異黨: I produce + I overcome + overcomes me
    same_party = round(support_ratio * 100)
    opposite_party = 100 - same_party

    return {
        'element': dm_element,
        'yinYang': dm_yinyang,
        'strength': strength,
        'strengthScore': strength_score,
        'seasonScore': season_score,
        'supportScore': round(support_score, 2),
        'drainScore': round(drain_score, 2),
        'sameParty': same_party,
        'oppositeParty': opposite_party,
    }


def _detect_dominant_imbalance(
    ten_god_dist: Dict[str, int],
    strength: str,
) -> str:
    """
    Detect which ten god category is causing the Day Master's imbalance.

    Classical 病藥取用法 (illness-medicine method, 《滴天髓》):
    Identify the "illness" (病) — the dominant category causing imbalance —
    then select the "medicine" (藥) that best addresses it.

    For weak DM: check draining/attacking categories {食傷, 財星, 官殺}.
    For strong DM: check supporting categories {比劫, 印星}.

    Returns one of: '食傷旺'|'財旺'|'官殺旺'|'印旺'|'比劫旺'|'general'
    """
    # Sum counts per category
    category_counts: Dict[str, int] = {}
    for cat_name, god_names in TEN_GOD_CATEGORIES.items():
        category_counts[cat_name] = sum(ten_god_dist.get(g, 0) for g in god_names)

    if strength in ('strong', 'very_strong'):
        # For strong DM: what's causing the excess strength?
        # Includes 官殺 for rare case where DM is strong despite heavy 官殺
        candidates = {'比劫': category_counts.get('比劫', 0),
                      '印星': category_counts.get('印星', 0),
                      '官殺': category_counts.get('官殺', 0)}
    else:
        # For weak/neutral DM: what's draining/attacking the DM?
        candidates = {'食傷': category_counts.get('食傷', 0),
                      '財星': category_counts.get('財星', 0),
                      '官殺': category_counts.get('官殺', 0)}

    if not candidates:
        return 'general'

    # Find highest count
    sorted_cats = sorted(candidates.items(), key=lambda x: -x[1])
    top_cat, top_count = sorted_cats[0]
    second_count = sorted_cats[1][1] if len(sorted_cats) > 1 else 0

    # Need strict greater than second to declare dominance
    if top_count > second_count and top_count > 0:
        label_map = {'食傷': '食傷旺', '財星': '財旺', '官殺': '官殺旺',
                     '印星': '印旺', '比劫': '比劫旺'}
        return label_map.get(top_cat, 'general')

    return 'general'


def determine_favorable_gods(
    day_master_stem: str,
    strength: str,
    ten_god_distribution: Optional[Dict[str, int]] = None,
) -> Dict[str, str]:
    """
    Determine the Five Favorable Gods (喜用神) based on Day Master strength
    and the dominant imbalance cause (病藥取用法).

    Context-dependent assignment (classical 子平 methodology):

    WEAK DM scenarios:
    - 食傷旺: 用神=印(produces_me), 喜神=比劫(dm_element)
      → 印 does double duty: strengthens DM AND restrains 食傷 (印克食傷)
    - 官殺旺: 用神=印(produces_me), 喜神=比劫(dm_element)
      → 印 is 通關: converts 官殺→印→DM (transforms attack into support)
    - 財旺 / general: 用神=比劫(dm_element), 喜神=印(produces_me)
      → 比劫 directly 克財; 印 cannot restrain 財

    STRONG DM scenarios:
    - 比劫旺: 用神=官殺(overcomes_me), 喜神=財(i_overcome)
      → 官殺 directly 克比劫
    - 官殺旺 (DM still strong): 用神=食傷(i_produce), 喜神=財(i_overcome)
      → 食神制殺
    - 印旺 / general: 用神=財(i_overcome), 喜神=食傷(i_produce)
      → 財 directly 克印

    Note: 從格 charts have separate 用神 logic handled downstream
    in generate_pre_analysis() which overrides effectiveFavorableGods.

    God role derivation:
    - Default cases: follows System A (忌神 = element that 克 用神)
    - Context-dependent cases: 忌/仇 are set based on what's most harmful
      to the DM given the specific imbalance, which may differ from
      the mechanical System A derivation.
    - 閒神 = whichever element is not assigned to any other role.

    Args:
        day_master_stem: Day Master's Heavenly Stem
        strength: Strength classification ('very_weak'|'weak'|'neutral'|'strong'|'very_strong')
        ten_god_distribution: Optional ten god count dict for context-dependent assignment.
            When None, uses the simple default rule (backward compatible).

    Returns:
        Dictionary with god names → elements
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    produces_me = ELEMENT_PRODUCED_BY[dm_element]
    i_produce = ELEMENT_PRODUCES[dm_element]
    i_overcome = ELEMENT_OVERCOMES[dm_element]
    overcomes_me = ELEMENT_OVERCOME_BY[dm_element]

    # Detect dominant imbalance for context-dependent assignment
    dominant = 'general'
    if ten_god_distribution:
        dominant = _detect_dominant_imbalance(ten_god_distribution, strength)

    if strength in ('strong', 'very_strong'):
        if dominant == '比劫旺':
            # 比劫 causing strength → 用神=官殺 to directly克比劫
            useful = overcomes_me
            favorable = i_overcome
        elif dominant == '官殺旺':
            # DM strong despite 官殺 → 用神=食傷 (食神制殺)
            useful = i_produce
            favorable = i_overcome
        else:
            # Default strong (印旺 or general): 用神=財, 喜神=食傷
            useful = i_overcome
            favorable = i_produce
        # Strong DM context-dependent: 忌神=比劫(too strong), 仇神=印(feeds excess)
        taboo = dm_element
        enemy = produces_me
    else:
        if dominant in ('食傷旺', '官殺旺'):
            # 食傷 or 官殺 draining/attacking → 用神=印 (double duty)
            # 印 strengthens DM AND restrains 食傷/mediates 官殺
            useful = produces_me
            favorable = dm_element
        else:
            # Default weak (財旺 or general): 用神=比劫, 喜神=印
            useful = dm_element
            favorable = produces_me
        # Weak DM context-dependent: 忌神=官殺(attacks DM), 仇神=財(drains DM)
        taboo = overcomes_me
        enemy = i_overcome

    # 閒神 = whichever element is not assigned to any other role
    assigned = {useful, favorable, taboo, enemy}
    idle = i_produce  # default fallback
    for el in [i_produce, overcomes_me, produces_me, dm_element, i_overcome]:
        if el not in assigned:
            idle = el
            break

    return {
        'favorableGod': favorable,
        'usefulGod': useful,
        'idleGod': idle,
        'tabooGod': taboo,
        'enemyGod': enemy,
    }
