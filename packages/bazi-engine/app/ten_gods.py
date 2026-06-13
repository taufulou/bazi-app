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
    TEN_GOD_CATEGORIES,
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
        Ten God name (e.g., '偏官'), or '' when the target stem is empty
        (unknown 時辰 — the blanked hour pillar has no Ten God).
    """
    # Unknown 時辰: blanked hour pillar has an empty stem → no Ten God.
    if not target_stem:
        return ''

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

        # Unknown 時辰: blanked hour pillar (empty stem) — leave its labels empty.
        if not stem:
            pillar['tenGod'] = None
            pillar['hiddenStemGods'] = []
            continue

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

        # Unknown 時辰: skip the blanked hour pillar entirely.
        if not pillar['stem']:
            continue

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

        # 時辰未知: the blanked hour pillar has an empty stem/branch — skip it so
        # its mass is dropped (yields a valid 3-pillar 十神比重, DEGRADED + flagged
        # downstream). Mirrors the guard in five_elements._accumulate_raw_element_scores.
        # Without this, _get_seasonal_multiplier('') → STEM_ELEMENT[''] → KeyError.
        if not pillar['stem']:
            continue

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


# ============================================================
# 透干/藏干 Weighted Pressure — Imbalance-detection weights
# ============================================================
#
# Distinct from calculate_weighted_ten_gods() above, which produces display
# percentages for 事業詳批 (using HIDDEN_STEM_WEIGHTS 60/30/10 + seasonal
# multiplier). The weights below measure *classical pressure* of a specific
# stem on the Day Master for 病藥 / 格局 analysis — used by:
#
#   - check_guan_sha_hunza (Fix 1b, interpretation_rules.py): threshold for
#     true 混雜 vs 露X藏Y relabel.
#   - _detect_dominant_imbalance (Fix 1a, future): category-level pressure
#     ranking to pick 用神.
#
# Classical basis:
#   《子平真詮·論用神》: 「透出干頭則顯其用」— transparent stems carry the
#     primary 用 (function) of a ten god.
#   《滴天髓·天全一氣》: 「虛花不久長」— a transparent stem without root
#     cannot sustain its claimed strength.
#   《淵海子平》露殺藏官口訣: transparent side dominates 格局 reading.
#
# Weight-equivalence note (load-bearing, do not adjust without classical
# review — applies once Fix 1a's pillar-role weights are layered):
#
#   Month 本氣 藏干 effective weight (Fix 1a):
#     IMBALANCE_WEIGHT_HIDDEN_BENQI    (2.0)
#     × PILLAR_ROLE_WEIGHT['month']    (1.0)   [future, Fix 1a]
#     × MONTH_BENQI_COMMANDER_MULTIPLIER (1.5) [future, Fix 1a]
#     = 3.0 (equals IMBALANCE_WEIGHT_TRANSPARENT_ROOTED)
#
#   This equivalence is INTENTIONAL per 《子平真詮·論用神》「月令為提綱」—
#   the 月令 本氣 藏干 carries 司令 weight equal to a transparent stem with
#   root. Retuning any of these constants without understanding this
#   equivalence will break classical alignment.

IMBALANCE_WEIGHT_TRANSPARENT_ROOTED = 3.0   # 透干 with 本氣 or 中氣 root
IMBALANCE_WEIGHT_TRANSPARENT_WEAK_ROOT = 2.5  # 透干 with only 餘氣 root
IMBALANCE_WEIGHT_TRANSPARENT_ROOTLESS = 1.5   # 透干 with no root (虛浮)
IMBALANCE_WEIGHT_HIDDEN_BENQI = 2.0
IMBALANCE_WEIGHT_HIDDEN_ZHONGQI = 1.0
IMBALANCE_WEIGHT_HIDDEN_YUQI = 0.5


def compute_stem_pressure_weight(target_stem: str, pillars: Dict) -> Dict:
    """
    Compute the weighted presence of a specific stem symbol across the chart.

    A stem's "pressure" is the sum of:
      - transparent_count × per-transparent weight (depends on root class)
      - sum over hidden occurrences at each position (本氣/中氣/餘氣)

    Transparent weight tiers by root class:
      - has_strong_root (any 本氣 or 中氣 anywhere): 3.0 per 透干
      - has_weak_root (only 餘氣 anywhere):          2.5 per 透干
      - rootless:                                     1.5 per 透干

    Hidden weight by position:
      - 本氣 (HIDDEN_STEMS[branch][0]): 2.0
      - 中氣 (HIDDEN_STEMS[branch][1]): 1.0
      - 餘氣 (HIDDEN_STEMS[branch][2]): 0.5

    Args:
        target_stem: The heavenly stem to measure (e.g., '辛')
        pillars: The four pillars dict

    Returns:
        {
            'total': float,               # full weighted pressure
            'transparent_count': int,     # number of 天干 matches
            'hidden_positions': List[str],# e.g., ['zhongqi','yuqi']
            'has_strong_root': bool,      # 本氣 OR 中氣 present
            'has_weak_root': bool,        # only 餘氣 (and no strong root)
        }
    """
    transparent_count = 0
    hidden_positions: List[str] = []

    for pname in ('year', 'month', 'day', 'hour'):
        pillar = pillars[pname]
        if pillar.get('stem') == target_stem:
            transparent_count += 1
        hidden = HIDDEN_STEMS.get(pillar.get('branch', ''), [])
        for idx, hs in enumerate(hidden):
            if hs == target_stem:
                if idx == 0:
                    hidden_positions.append('benqi')
                elif idx == 1:
                    hidden_positions.append('zhongqi')
                else:
                    hidden_positions.append('yuqi')

    has_strong_root = ('benqi' in hidden_positions) or ('zhongqi' in hidden_positions)
    has_weak_root = ('yuqi' in hidden_positions) and not has_strong_root

    if transparent_count > 0:
        if has_strong_root:
            per_transparent = IMBALANCE_WEIGHT_TRANSPARENT_ROOTED
        elif has_weak_root:
            per_transparent = IMBALANCE_WEIGHT_TRANSPARENT_WEAK_ROOT
        else:
            per_transparent = IMBALANCE_WEIGHT_TRANSPARENT_ROOTLESS
    else:
        per_transparent = 0.0

    hidden_weight = 0.0
    for pos in hidden_positions:
        if pos == 'benqi':
            hidden_weight += IMBALANCE_WEIGHT_HIDDEN_BENQI
        elif pos == 'zhongqi':
            hidden_weight += IMBALANCE_WEIGHT_HIDDEN_ZHONGQI
        else:
            hidden_weight += IMBALANCE_WEIGHT_HIDDEN_YUQI

    total = transparent_count * per_transparent + hidden_weight

    return {
        'total': round(total, 2),
        'transparent_count': transparent_count,
        'hidden_positions': hidden_positions,
        'has_strong_root': has_strong_root,
        'has_weak_root': has_weak_root,
    }


def get_overcoming_stems_for_dm(day_master_stem: str) -> Dict[str, str]:
    """
    Return the 正官 and 偏官(七殺) stem symbols for a given Day Master.

    正官 = overcoming element, different polarity.
    偏官/七殺 = overcoming element, same polarity.

    Returns:
        {'正官': <stem>, '偏官': <stem>}
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    overcoming = ELEMENT_OVERCOME_BY[dm_element]
    dm_polarity = STEM_YINYANG[day_master_stem]

    result: Dict[str, str] = {}
    for stem in ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']:
        if STEM_ELEMENT[stem] == overcoming:
            if STEM_YINYANG[stem] == dm_polarity:
                result['偏官'] = stem
            else:
                result['正官'] = stem
    return result


# ============================================================
# Fix 1a: Weighted category pressure (pillar-role + 月令司令)
# ============================================================
#
# Extends compute_stem_pressure_weight with pillar-role weighting and the
# month-benqi 司令 multiplier, aggregated into the five ten god categories
# used by _detect_dominant_imbalance.
#
# Pillar-role weight (classical: 月令為提綱):
#   月=1.0 > 日=0.9 > 時=0.7 > 年=0.6
#
# 月令本氣 司令 multiplier: hidden_benqi located in month branch is
# further multiplied ×1.5. Combined with hidden_benqi=2.0 and
# PILLAR_ROLE_WEIGHT['month']=1.0, this gives effective weight 3.0,
# intentionally equal to transparent_rooted. Retuning any of these three
# without understanding the equivalence will break classical alignment —
# see Weight-equivalence note at the top of this section (~line 500).

PILLAR_ROLE_WEIGHT: Dict[str, float] = {
    'month': 1.0, 'day': 0.9, 'hour': 0.7, 'year': 0.6,
}
MONTH_BENQI_COMMANDER_MULTIPLIER = 1.5

# Dominance thresholds (Fix 1a — preserves 'general' fallback when signal weak)
WEIGHTED_DOMINANCE_MIN_MARGIN = 0.20   # (top-second)/top ≥ 20%
WEIGHTED_DOMINANCE_MIN_FLOOR = 3.0     # top score ≥ 3.0 absolute

# Deterministic tiebreak priority (used when counts are close)
WEIGHTED_DOMINANCE_TIEBREAK_ORDER: List[str] = [
    '官殺', '財星', '食傷', '印星', '比劫',
]


def compute_weighted_category_scores(
    pillars: Dict,
    day_master_stem: str,
) -> Dict:
    """
    Compute weighted pressure per ten god category (Fix 1a).

    For each stem occurrence in the chart:
      - Derive its ten god via derive_ten_god(DM, stem).
      - Map to its category via TEN_GOD_CATEGORIES.
      - Apply:
          transparent: position weight (rooted/weak/rootless) × pillar role.
          hidden:      position weight (本/中/餘) × pillar role
                       × MONTH_BENQI_COMMANDER_MULTIPLIER if month-本氣.

    Returns:
        {
            'categories':       {'比劫': 4.5, '食傷': 3.0, ...},
            'category_transparent_count': {'官殺': 1, ...},
            'category_month_benqi':       {'官殺': False, ...},
                                          # True if any stem in category is
                                          # the month 本氣 藏干.
        }

    Note: root class (strong/weak/rootless) is determined per stem *across
    all branches*, matching compute_stem_pressure_weight.
    """
    from .constants import BRANCH_ELEMENT  # local import to avoid cycle noise
    _ = BRANCH_ELEMENT  # suppress unused import warning (kept for future)

    # Step 1: determine root class of each distinct stem present
    root_class_cache: Dict[str, str] = {}
    for stem in ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']:
        hidden_positions: List[str] = []
        for pname in ('year', 'month', 'day', 'hour'):
            branch = pillars.get(pname, {}).get('branch', '')
            for idx, hs in enumerate(HIDDEN_STEMS.get(branch, [])):
                if hs == stem:
                    if idx == 0:
                        hidden_positions.append('benqi')
                    elif idx == 1:
                        hidden_positions.append('zhongqi')
                    else:
                        hidden_positions.append('yuqi')
        has_strong = ('benqi' in hidden_positions) or ('zhongqi' in hidden_positions)
        has_weak = ('yuqi' in hidden_positions) and not has_strong
        if has_strong:
            root_class_cache[stem] = 'strong'
        elif has_weak:
            root_class_cache[stem] = 'weak'
        else:
            root_class_cache[stem] = 'none'

    # Step 2: iterate occurrences, accumulate per category
    categories: Dict[str, float] = {k: 0.0 for k in TEN_GOD_CATEGORIES}
    cat_transparent_count: Dict[str, int] = {k: 0 for k in TEN_GOD_CATEGORIES}
    cat_month_benqi: Dict[str, bool] = {k: False for k in TEN_GOD_CATEGORIES}

    month_branch = pillars.get('month', {}).get('branch', '')
    month_benqi_stem = HIDDEN_STEMS.get(month_branch, [''])[0] if month_branch else ''

    def _category_of(stem: str) -> str:
        """Return category key for a stem relative to DM; empty string for DM itself."""
        if stem == day_master_stem:
            # DM is 比劫 relative to itself (same element same polarity = 比肩)
            return '比劫'
        tg = derive_ten_god(day_master_stem, stem)
        for cat_name, gods in TEN_GOD_CATEGORIES.items():
            if tg in gods:
                return cat_name
        return ''

    for pname in ('year', 'month', 'day', 'hour'):
        pillar_weight = PILLAR_ROLE_WEIGHT.get(pname, 0.8)
        pillar = pillars.get(pname, {})
        # Skip DM pillar's stem (day stem is DM itself, but 日 has pillar_weight 0.9)
        # NOTE: DM itself contributes to 比劫 category only via its hidden-stem
        # occurrences elsewhere; we exclude the day stem from imbalance count
        # because DM's strength is measured independently.
        stem = pillar.get('stem', '')
        if stem and pname != 'day':
            cat = _category_of(stem)
            if cat:
                rc = root_class_cache.get(stem, 'none')
                if rc == 'strong':
                    per_w = IMBALANCE_WEIGHT_TRANSPARENT_ROOTED
                elif rc == 'weak':
                    per_w = IMBALANCE_WEIGHT_TRANSPARENT_WEAK_ROOT
                else:
                    per_w = IMBALANCE_WEIGHT_TRANSPARENT_ROOTLESS
                categories[cat] += per_w * pillar_weight
                cat_transparent_count[cat] += 1

        # Hidden stems in this pillar's branch
        branch = pillar.get('branch', '')
        hidden = HIDDEN_STEMS.get(branch, [])
        for idx, hs in enumerate(hidden):
            if not hs:
                continue
            cat = _category_of(hs)
            if not cat:
                continue
            if idx == 0:
                base = IMBALANCE_WEIGHT_HIDDEN_BENQI
            elif idx == 1:
                base = IMBALANCE_WEIGHT_HIDDEN_ZHONGQI
            else:
                base = IMBALANCE_WEIGHT_HIDDEN_YUQI
            w = base * pillar_weight
            # 月令司令 multiplier for month branch 本氣 only
            if pname == 'month' and idx == 0:
                w *= MONTH_BENQI_COMMANDER_MULTIPLIER
                cat_month_benqi[cat] = True
            categories[cat] += w

    return {
        'categories': {k: round(v, 2) for k, v in categories.items()},
        'category_transparent_count': cat_transparent_count,
        'category_month_benqi': cat_month_benqi,
    }


def detect_neutral_shishang_outlet(
    pillars: Dict,
    day_master_stem: str,
    strength_classification: str,
) -> Optional[str]:
    """
    Phase 12d Pattern 1: For DM with 食傷 carrier (透干 OR 月令本氣司令),
    the chart's natural outlet is 食傷洩秀 (or 食神生財 chain if 印 ≥ 比劫).

    Returns:
      '食神生財'   — chain rule applies (used when 印 ≥ 比劫)
      '食傷洩秀'   — pure 食傷 outlet (used when 比劫 > 印)
      None         — Pattern 1 doesn't apply

    Strength gating (Phase A + per-chart calibration):
      - `neutral`/`strong`: standard trigger. Default behavior; 食傷 must
        outweigh 印 (×1.5 buffer) to qualify as the outlet.
      - `weak`: extended trigger. Fires only when 食傷 is the heaviest
        category among 比劫/食傷/財星/印星 — i.e., chart's effective
        balance is 中和略強 with 食傷 dominant despite V2's weak label.
        Captures named 真詮 cases like 沈路分 / 梁丞相.
      - `very_weak`: never fires (truly drained DM needs 印, not outlet).

    Branch decision (洩秀 vs 生財):
      The chart's 印 vs 比劫 balance distinguishes between draining 比劫
      directly (洩秀) and chaining through 食傷 to 財 to control 印 (生財):
        - 印 ≥ 比劫: 食神生財 chain (drain via chain endpoint 財)
        - 比劫 > 印: 食傷洩秀 (drain via direct 食傷 outlet)

    梟印奪食 cancellation: 印 透干 ≥1 with 印 weighted ≥ 食傷×0.8 →
    食神 outlet is suppressed (《子平真詮·論食神》「梟神奪食最為大忌」).

    Source: 《子平真詮·論食神》第三十七章 (沈孝瞻):
      「食神本屬洩氣，以其能生財，所以喜之。故食神生財，美格也。」
      「藏食露傷，主人性剛，如丁亥、癸卯、癸卯、甲寅，沈路分命是也。」
    Phase A doctrine verification + per-chart re-calibration on 4
    affected charts (沈路分, 梁丞相, 秦龍圖, 龍冀任氏).
    """
    if strength_classification == 'very_weak':
        return None

    scores = compute_weighted_category_scores(pillars, day_master_stem)
    cats = scores['categories']
    transp = scores['category_transparent_count']
    month_benqi = scores['category_month_benqi']

    shishang_w = cats.get('食傷', 0.0)
    cai_w = cats.get('財星', 0.0)
    bijie_w = cats.get('比劫', 0.0)
    yinxing_w = cats.get('印星', 0.0)

    shishang_transp = transp.get('食傷', 0)
    cai_transp = transp.get('財星', 0)
    yinxing_transp = transp.get('印星', 0)

    # Trigger: 食傷 carrier (透干 OR 月令本氣司令)
    has_shishang_carrier = (shishang_transp >= 1
                            or month_benqi.get('食傷', False))
    if not has_shishang_carrier:
        return None

    # 梟印奪食 cancellation (always checked)
    if yinxing_transp >= 1 and yinxing_w >= shishang_w * 0.8:
        return None

    # Strength-conditional dominance check
    if strength_classification == 'weak':
        # Extended trigger: 食傷 must be the heaviest weighted category.
        # Captures 沈路分 (比劫=2.7, 食傷=8.9) and 龍冀任氏 (比劫=7.0, 食傷=6.0).
        if shishang_w < max(bijie_w, cai_w, yinxing_w):
            return None
        # Roger-anchor regression guard: when 印 has substantive presence
        # (≥1.0 weighted) AND there's no 財 chain target, the engine's
        # default weak-doctrine (用=印) is classically correct. Pattern 1
        # only fires here if a 食神生財 chain is viable to control 印.
        if yinxing_w >= 1.0:
            cai_chain_viable = cai_transp >= 1 and cai_w >= 1.0
            if not cai_chain_viable:
                return None
    else:
        # neutral / strong: 食傷 must outweigh 印 (the alternative 用神
        # candidate) by ≥ 1.5× when 印 has any presence. Otherwise the
        # chart is 印重 territory and 食傷 isn't the natural outlet.
        if yinxing_w > 0 and shishang_w < yinxing_w * 1.5:
            return None

    # Branch decision: chain (生財) vs direct outlet (洩秀)
    # When 印 ≥ 比劫, the chart needs 財 to control 印 → chain rule.
    # When 比劫 > 印, the chart needs to drain heavy 比劫 → direct 洩秀.
    cai_chain_eligible = cai_transp >= 1 and cai_w >= 1.0
    if cai_chain_eligible and yinxing_w >= bijie_w:
        return '食神生財'
    return '食傷洩秀'


def detect_dominant_imbalance_weighted(
    pillars: Dict,
    day_master_stem: str,
    strength: str,
    is_cong_ge: bool = False,
) -> str:
    """
    Classical 病藥 dominance detection using weighted pillar + stem-position
    pressure (Fix 1a).

    Preserves the 'general' fallback: requires top score to exceed second
    by ≥20% margin AND top ≥ 3.0 absolute floor. Below that, signal is
    considered weak and default assignment is used.

    從格 guard: returns 'cong_overridden' if is_cong_ge is True.

    Tiebreak priority (applied when top-second margin < 20%):
      1. Category with month-branch 本氣 contribution (司令)
      2. Category with more transparent stem count
      3. Fixed enum order: ['官殺','財星','食傷','印星','比劫']

    Returns one of:
      '食傷旺' | '財旺' | '官殺旺' | '印旺' | '比劫旺' | 'general'
      | 'cong_overridden'
    """
    if is_cong_ge:
        return 'cong_overridden'

    scores = compute_weighted_category_scores(pillars, day_master_stem)
    cats = scores['categories']

    if strength in ('strong', 'very_strong'):
        relevant = {k: v for k, v in cats.items() if k in ('比劫', '印星', '官殺')}
    else:
        relevant = {k: v for k, v in cats.items() if k in ('食傷', '財星', '官殺')}

    if not relevant:
        return 'general'

    # Sort by score descending
    sorted_cats = sorted(relevant.items(), key=lambda x: -x[1])
    top_cat, top_score = sorted_cats[0]
    second_score = sorted_cats[1][1] if len(sorted_cats) > 1 else 0.0

    if top_score < WEIGHTED_DOMINANCE_MIN_FLOOR:
        return 'general'

    # Margin check — if top doesn't clearly lead, apply tiebreak.
    #
    # Tiebreak priority (documented design decision):
    #   1. Transparent stem count — 《子平真詮·論用神》「透出干頭則顯其用」.
    #      Transparent stems DIRECTLY manifest their 用; a category with
    #      a 透干 outranks one carried only by 藏干, even if the latter
    #      is 月令司令. Critical: avoids double-counting 月令 weight since
    #      MONTH_BENQI_COMMANDER_MULTIPLIER already boosts month-本氣
    #      藏干 scores by ×1.5 (into the raw score above).
    #   2. Month-本氣 carrier — used only when transparent counts tie.
    #   3. Fixed enum order ['官殺','財星','食傷','印星','比劫'] — stable
    #      final tiebreak (never alphabetical; see load-bearing docstring).
    margin = (top_score - second_score) / top_score if top_score > 0 else 0.0
    if margin < WEIGHTED_DOMINANCE_MIN_MARGIN:
        tied_cats = [
            c for c, s in sorted_cats
            if abs(s - top_score) / max(top_score, 1e-9) < WEIGHTED_DOMINANCE_MIN_MARGIN
        ]
        # Priority 1: more transparent stems
        if len(tied_cats) > 1:
            max_transparent = max(
                scores['category_transparent_count'].get(c, 0) for c in tied_cats
            )
            if max_transparent > 0:
                tied_cats = [
                    c for c in tied_cats
                    if scores['category_transparent_count'].get(c, 0) == max_transparent
                ]
        # Priority 2: month-本氣 carrier (only narrows if still tied)
        if len(tied_cats) > 1:
            month_benqi_tied = [
                c for c in tied_cats
                if scores['category_month_benqi'].get(c, False)
            ]
            if month_benqi_tied:
                tied_cats = month_benqi_tied
        # Priority 3: fixed enum order (deterministic final tiebreak)
        for cat in WEIGHTED_DOMINANCE_TIEBREAK_ORDER:
            if cat in tied_cats:
                top_cat = cat
                break

    label_map = {
        '食傷': '食傷旺', '財星': '財旺', '官殺': '官殺旺',
        '印星': '印旺', '比劫': '比劫旺',
    }
    return label_map.get(top_cat, 'general')
