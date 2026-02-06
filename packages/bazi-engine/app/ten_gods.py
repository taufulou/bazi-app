"""
Ten Gods (十神) Derivation

The Ten Gods represent the relationship between the Day Master (日主)
and the other Heavenly Stems in the chart.

The relationship is determined by:
1. The Five Element relationship between two stems
2. Whether they share the same Yin/Yang polarity

十神 Mapping:
- Same element, same polarity → 比肩 (Companion)
- Same element, diff polarity → 劫財 (Rob Wealth)
- I produce, same polarity → 食神 (Eating God)
- I produce, diff polarity → 傷官 (Hurting Officer)
- I overcome, same polarity → 偏財 (Indirect Wealth)
- I overcome, diff polarity → 正財 (Direct Wealth)
- Overcomes me, same polarity → 偏官 (Seven Killings)
- Overcomes me, diff polarity → 正官 (Direct Officer)
- Produces me, same polarity → 偏印 (Indirect Seal)
- Produces me, diff polarity → 正印 (Direct Seal)
"""

from typing import Dict, List, Optional

from .constants import (
    ELEMENT_OVERCOMES,
    ELEMENT_PRODUCES,
    ELEMENT_OVERCOME_BY,
    ELEMENT_PRODUCED_BY,
    HIDDEN_STEMS,
    STEM_ELEMENT,
    STEM_YINYANG,
    TEN_GODS_SAME_POLARITY,
    TEN_GODS_DIFF_POLARITY,
)


def derive_ten_god(day_master_stem: str, target_stem: str) -> str:
    """
    Derive the Ten God relationship between the Day Master and another stem.

    Args:
        day_master_stem: The Day Master's Heavenly Stem (e.g., '甲')
        target_stem: The target Heavenly Stem to compare (e.g., '庚')

    Returns:
        Ten God name (e.g., '偏官')
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    target_element = STEM_ELEMENT[target_stem]
    dm_yinyang = STEM_YINYANG[day_master_stem]
    target_yinyang = STEM_YINYANG[target_stem]

    same_polarity = dm_yinyang == target_yinyang

    # Determine the Five Element relationship
    if dm_element == target_element:
        relationship = 'same'
    elif ELEMENT_PRODUCES[dm_element] == target_element:
        relationship = 'i_produce'
    elif ELEMENT_OVERCOMES[dm_element] == target_element:
        relationship = 'i_overcome'
    elif ELEMENT_OVERCOME_BY[dm_element] == target_element:
        relationship = 'overcomes_me'
    elif ELEMENT_PRODUCED_BY[dm_element] == target_element:
        relationship = 'produces_me'
    else:
        # Should never happen with correct element cycle
        raise ValueError(f"Unknown relationship between {dm_element} and {target_element}")

    if same_polarity:
        return TEN_GODS_SAME_POLARITY[relationship]
    else:
        return TEN_GODS_DIFF_POLARITY[relationship]


def derive_ten_god_for_branch(day_master_stem: str, branch: str) -> List[Dict[str, str]]:
    """
    Derive Ten Gods for a branch's hidden stems.

    Args:
        day_master_stem: Day Master's Heavenly Stem
        branch: Earthly Branch

    Returns:
        List of dicts with stem and its Ten God
    """
    hidden = HIDDEN_STEMS.get(branch, [])
    result = []
    for stem in hidden:
        ten_god = derive_ten_god(day_master_stem, stem)
        result.append({
            'stem': stem,
            'element': STEM_ELEMENT[stem],
            'tenGod': ten_god,
        })
    return result


def apply_ten_gods_to_pillars(pillars: Dict, day_master_stem: str) -> Dict:
    """
    Apply Ten God labels to all four pillars.

    The Day Pillar's stem is the Day Master itself — it gets '日主' label (or null).
    Other pillars get their Ten God based on their stem's relationship to the Day Master.

    Args:
        pillars: The four pillars dictionary
        day_master_stem: The Day Master's Heavenly Stem

    Returns:
        Updated pillars with Ten God labels
    """
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        stem = pillar['stem']
        branch = pillar['branch']

        # Day pillar stem = Day Master itself
        if pillar_name == 'day':
            pillar['tenGod'] = None  # Day Master has no Ten God
        else:
            pillar['tenGod'] = derive_ten_god(day_master_stem, stem)

        # Add Ten Gods for hidden stems
        pillar['hiddenStemGods'] = derive_ten_god_for_branch(day_master_stem, branch)

    return pillars


def get_ten_god_distribution(pillars: Dict, day_master_stem: str) -> Dict[str, int]:
    """
    Count the distribution of Ten Gods across all pillars.
    Includes both manifest stems and hidden stems.

    Args:
        pillars: The four pillars
        day_master_stem: Day Master's Heavenly Stem

    Returns:
        Dictionary with Ten God name → count
    """
    distribution: Dict[str, int] = {}

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]

        # Count manifest stem's Ten God (skip Day Master)
        if pillar_name != 'day':
            ten_god = derive_ten_god(day_master_stem, pillar['stem'])
            distribution[ten_god] = distribution.get(ten_god, 0) + 1

        # Count hidden stems' Ten Gods
        for hs in HIDDEN_STEMS.get(pillar['branch'], []):
            ten_god = derive_ten_god(day_master_stem, hs)
            distribution[ten_god] = distribution.get(ten_god, 0) + 1

    return distribution


def get_prominent_ten_god(pillars: Dict, day_master_stem: str) -> str:
    """
    Determine the most prominent Ten God in the chart.
    Used for pattern (格局) determination.

    Priority: Month pillar's hidden stem main qi (本氣) >
              Month pillar stem > others

    Args:
        pillars: The four pillars
        day_master_stem: Day Master's Heavenly Stem

    Returns:
        The most prominent Ten God
    """
    month_branch = pillars['month']['branch']
    month_stem = pillars['month']['stem']

    # First check month branch's main hidden stem (本氣)
    month_hidden = HIDDEN_STEMS.get(month_branch, [])
    if month_hidden:
        main_qi_stem = month_hidden[0]  # First hidden stem = 本氣
        main_qi_god = derive_ten_god(day_master_stem, main_qi_stem)
        # If main qi is not 比肩 or 劫財 (same element as Day Master),
        # it's the pattern-defining god
        if main_qi_god not in ('比肩', '劫財'):
            return main_qi_god

    # Check month stem
    month_god = derive_ten_god(day_master_stem, month_stem)
    if month_god not in ('比肩', '劫財'):
        return month_god

    # Fallback: most frequent Ten God excluding 比肩/劫財
    dist = get_ten_god_distribution(pillars, day_master_stem)
    # Remove 比肩 and 劫財
    dist.pop('比肩', None)
    dist.pop('劫財', None)

    if dist:
        return max(dist, key=lambda k: dist[k])

    # Ultimate fallback
    return '比肩'
