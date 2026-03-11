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
    BRANCH_ELEMENT,
    ELEMENT_OVERCOMES,
    ELEMENT_PRODUCES,
    ELEMENT_OVERCOME_BY,
    ELEMENT_PRODUCED_BY,
    HIDDEN_STEMS,
    HIDDEN_STEM_WEIGHTS,
    SEASON_MULTIPLIER,
    SEASON_STRENGTH,
    STEM_ELEMENT,
    STEM_YINYANG,
    TEN_GODS_DIFF_POLARITY,
    TEN_GODS_LIST,
    TEN_GODS_SAME_POLARITY,
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

    Priority (per《子平真詮》— "月支之神，透干者取之"):
      1. Month branch hidden stems that 透干 (appear as manifest stems in
         year/month/hour pillars) — the transparent god takes priority
      2. Month branch main qi (本氣) if no hidden stem is transparent
      3. Month pillar stem
      4. Fallback: most frequent Ten God

    Args:
        pillars: The four pillars
        day_master_stem: Day Master's Heavenly Stem

    Returns:
        The most prominent Ten God
    """
    month_branch = pillars['month']['branch']
    month_stem = pillars['month']['stem']

    # Collect all manifest stems (year/month/hour — skip day stem which is Day Master)
    manifest_stems = set()
    for pname in ('year', 'month', 'hour'):
        manifest_stems.add(pillars[pname]['stem'])

    # Check month branch hidden stems for 透干 (transparency) — Source: 《子平真詮·論格局》
    month_hidden = HIDDEN_STEMS.get(month_branch, [])
    for hidden_stem in month_hidden:
        if hidden_stem in manifest_stems:
            god = derive_ten_god(day_master_stem, hidden_stem)
            if god not in ('比肩', '劫財'):
                return god

    # No transparent hidden stem found — use 本氣 directly
    if month_hidden:
        main_qi_stem = month_hidden[0]  # First hidden stem = 本氣
        main_qi_god = derive_ten_god(day_master_stem, main_qi_stem)
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


# ============================================================
# Weighted Ten Gods for Career Pre-Analysis
# ============================================================

# Ten God → Capability mapping (classically grounded categorical associations)
TEN_GOD_CAPABILITIES: Dict[str, List[str]] = {
    '比肩': ['獨立能力', '動手能力', '合夥協作能力'],
    '劫財': ['談判能力', '競爭力', '行動力'],
    '食神': ['審美能力', '文學天賦', '藝術審美能力'],
    '傷官': ['口才表達力', '創新能力', '精湛技能'],
    '正財': ['理財能力', '實幹能力', '系統規劃力'],
    '偏財': ['投資眼光', '交際能力', '商業敏銳度'],
    '正官': ['領導能力', '組織協調力', '管理能力'],
    '偏官': ['危機處理能力', '開拓能力', '抗壓力'],
    '正印': ['學習能力', '知識傳授力', '服務能力'],
    '偏印': ['謀略能力', '精算能力', '另類思維力'],
}

# Also known as 七殺 — alias for display
TEN_GOD_ALIASES: Dict[str, str] = {
    '偏官': '七殺',
}

# Level thresholds for ten god strength
TEN_GOD_LEVEL_THRESHOLDS = [
    (3.0, '很弱'),
    (8.0, '弱'),
    (15.0, '一般'),
    (25.0, '強'),
    (100.0, '很強'),
]


def _get_ten_god_level(percentage: float) -> str:
    """Get ten god strength level label from percentage."""
    for threshold, label in TEN_GOD_LEVEL_THRESHOLDS:
        if percentage < threshold:
            return label
    return '很強'


def calculate_weighted_ten_gods(
    day_master_stem: str,
    pillars: Dict,
    month_branch: str,
    branch_interactions: Optional[Dict] = None,
) -> Dict[str, Dict]:
    """
    Calculate weighted Ten Gods (十神比重) for career pre-analysis.

    Uses 4 pillars only (conservative/traditional approach).
    Day master stem is excluded from counting.

    Algorithm:
    1. For each manifest stem (except day master): derive ten god,
       add 1.0 × seasonal multiplier for that stem's element
    2. For each branch hidden stem: derive ten god,
       add hidden_stem_weight × seasonal multiplier
    3. Optionally adjust for branch interactions (六沖 reduces, etc.)
    4. Normalize to percentages

    Args:
        day_master_stem: The Day Master's Heavenly Stem
        pillars: The four pillars dictionary
        month_branch: Birth month's Earthly Branch
        branch_interactions: Optional branch relationship data for adjustments

    Returns:
        Dictionary with ten_god → { percentage, level, capabilities } per ten god
    """
    ten_god_scores: Dict[str, float] = {tg: 0.0 for tg in TEN_GODS_LIST}

    def _get_seasonal_multiplier(stem: str) -> float:
        """Get the seasonal multiplier for a stem's element."""
        element = STEM_ELEMENT[stem]
        season_score = SEASON_STRENGTH.get(element, {}).get(month_branch, 3)
        return SEASON_MULTIPLIER.get(season_score, 1.0)

    # Step 1 & 2: Accumulate from four pillars
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]

        # Manifest stem (skip day master)
        if pillar_name != 'day':
            ten_god = derive_ten_god(day_master_stem, pillar['stem'])
            multiplier = _get_seasonal_multiplier(pillar['stem'])
            ten_god_scores[ten_god] += 1.0 * multiplier

        # Hidden stems
        hidden = HIDDEN_STEMS.get(pillar['branch'], [])
        weights = HIDDEN_STEM_WEIGHTS.get(pillar['branch'], [])
        for i, hs in enumerate(hidden):
            ten_god = derive_ten_god(day_master_stem, hs)
            weight = weights[i] if i < len(weights) else 0.1
            multiplier = _get_seasonal_multiplier(hs)
            ten_god_scores[ten_god] += weight * multiplier

    # Step 3: Optional branch interaction adjustments
    if branch_interactions:
        # 六沖: clashed branches lose ~50% effective weight
        for clash in branch_interactions.get('clashes', []):
            branches = clash.get('branches', ())
            for branch in branches:
                # Reduce the hidden stems' ten god scores for clashed branches
                hidden = HIDDEN_STEMS.get(branch, [])
                for hs in hidden:
                    ten_god = derive_ten_god(day_master_stem, hs)
                    ten_god_scores[ten_god] -= 0.15
                    if ten_god_scores[ten_god] < 0:
                        ten_god_scores[ten_god] = 0.0

        # 三合/三會: combined element gains bonus
        for triple in branch_interactions.get('tripleHarmonies', []):
            result_element = triple.get('resultElement')
            if result_element:
                # Find which ten gods correspond to this element
                # by checking against day master
                for stem in ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']:
                    if STEM_ELEMENT[stem] == result_element:
                        ten_god = derive_ten_god(day_master_stem, stem)
                        ten_god_scores[ten_god] += 0.1
                        break

    # Step 4: Normalize to percentages
    total = sum(ten_god_scores.values())
    if total == 0:
        percentages = {tg: 10.0 for tg in TEN_GODS_LIST}
    else:
        percentages = {
            tg: round(ten_god_scores[tg] / total * 100, 1)
            for tg in TEN_GODS_LIST
        }

    # Build result
    result = {}
    for ten_god in TEN_GODS_LIST:
        pct = percentages[ten_god]
        result[ten_god] = {
            'percentage': pct,
            'level': _get_ten_god_level(pct),
            'capabilities': TEN_GOD_CAPABILITIES.get(ten_god, []),
        }

    return result
