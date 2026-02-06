"""
Five Elements (五行) Balance Analysis

Calculates the distribution and balance of the Five Elements
across all eight characters (stems and branches) in the chart.

Also determines Day Master strength (旺衰) based on:
1. Season (month branch) support
2. Count of supporting elements
3. Hidden stem contributions
"""

from typing import Dict, List, Tuple

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
    SEASON_STRENGTH,
    STEM_ELEMENT,
    STEM_YINYANG,
)


def calculate_five_elements_balance(pillars: Dict) -> Dict[str, float]:
    """
    Calculate the Five Elements balance as percentages.

    Scoring method:
    - Each manifest stem contributes 1.0 point to its element
    - Each branch contributes through its hidden stems with weights
      (本氣=0.6~1.0, 中氣=0.2~0.3, 餘氣=0.2)

    Args:
        pillars: The four pillars dictionary

    Returns:
        Dictionary with element → percentage (0-100, sums to ~100)
    """
    element_scores: Dict[str, float] = {e: 0.0 for e in FIVE_ELEMENTS}

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        stem = pillar['stem']
        branch = pillar['branch']

        # Manifest stem contributes 1.0 to its element
        stem_element = STEM_ELEMENT[stem]
        element_scores[stem_element] += 1.0

        # Hidden stems contribute with weights
        hidden = HIDDEN_STEMS.get(branch, [])
        weights = HIDDEN_STEM_WEIGHTS.get(branch, [])
        for i, hs in enumerate(hidden):
            weight = weights[i] if i < len(weights) else 0.2
            hs_element = STEM_ELEMENT[hs]
            element_scores[hs_element] += weight

    # Convert to percentages
    total = sum(element_scores.values())
    if total == 0:
        return {e: 20.0 for e in FIVE_ELEMENTS}

    percentages: Dict[str, float] = {}
    for e in FIVE_ELEMENTS:
        percentages[e] = round(element_scores[e] / total * 100, 1)

    return percentages


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
            weight = weights[i] if i < len(weights) else 0.2
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


def determine_favorable_gods(
    day_master_stem: str,
    strength: str,
) -> Dict[str, str]:
    """
    Determine the Five Favorable Gods (喜用神) based on Day Master strength.

    When Day Master is STRONG (偏強), it needs draining/controlling:
    - 喜神 (Favorable): Element I produce (食傷 — drains me)
    - 用神 (Useful): Element I overcome (財 — I spend energy overcoming)
    - 閒神 (Idle): Element that overcomes me (官殺)
    - 忌神 (Taboo): Same element (比劫 — makes me stronger)
    - 仇神 (Enemy): Element that produces me (印 — feeds me)

    When Day Master is WEAK (偏弱), it needs support:
    - 喜神 (Favorable): Element that produces me (印 — feeds me)
    - 用神 (Useful): Same element (比劫 — supports me)
    - 閒神 (Idle): Element I produce (食傷)
    - 忌神 (Taboo): Element that overcomes me (官殺 — attacks me)
    - 仇神 (Enemy): Element I overcome (財 — wastes my energy)

    When NEUTRAL: Similar to weak but less pronounced.

    Args:
        day_master_stem: Day Master's Heavenly Stem
        strength: Strength classification ('very_weak', 'weak', 'neutral', 'strong', 'very_strong')

    Returns:
        Dictionary with god names → elements
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    produces_me = ELEMENT_PRODUCED_BY[dm_element]
    i_produce = ELEMENT_PRODUCES[dm_element]
    i_overcome = ELEMENT_OVERCOMES[dm_element]
    overcomes_me = ELEMENT_OVERCOME_BY[dm_element]

    if strength in ('strong', 'very_strong'):
        # Day Master is strong → needs draining/controlling
        return {
            'favorableGod': i_produce,      # 喜神: 食傷 (drain)
            'usefulGod': i_overcome,         # 用神: 財 (drain)
            'idleGod': overcomes_me,         # 閒神: 官殺
            'tabooGod': dm_element,          # 忌神: 比劫 (too strong)
            'enemyGod': produces_me,         # 仇神: 印 (feeds me)
        }
    else:
        # Day Master is weak or neutral → needs support
        return {
            'favorableGod': produces_me,     # 喜神: 印 (support)
            'usefulGod': dm_element,         # 用神: 比劫 (same element support)
            'idleGod': i_produce,            # 閒神: 食傷
            'tabooGod': overcomes_me,        # 忌神: 官殺 (attacks me)
            'enemyGod': i_overcome,          # 仇神: 財 (wastes energy)
        }
