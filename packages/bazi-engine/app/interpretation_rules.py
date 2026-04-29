"""
Bazi Pre-Analysis Layer — Main Orchestrator

Generates deterministic, rule-based interpretation findings from a Bazi chart.
This is Layer 2 of the three-layer architecture:
  Layer 1: Python Engine → raw chart data
  Layer 2: Pre-Analysis (this module) → deterministic rules
  Layer 3: AI Narration → compelling narrative from pre-analyzed results

Key components:
  - Ten God position rules (40 rules: 10 gods × 4 positions, gender-split)
  - 透干 (Tou Gan) analysis — hidden stems that appear as manifest stems
  - 從格 (Following Pattern) detection with 4 subtypes
  - 用神合絆 (Yong Shen locking) detection
  - 墓庫 (Tomb/Storage) analysis
  - Life domain mapping (career, love, health)
  - Conflict resolution layer
  - Day Master Strength V2 (3-factor scoring)
"""

import os
from typing import Any, Dict, List, Optional, Set, Tuple

from .constants import (
    ELEMENT_OVERCOMES,
    ELEMENT_OVERCOME_BY,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    FIVE_ELEMENTS,
    HIDDEN_STEMS,
    HIDDEN_STEM_WEIGHTS,
    SEASON_STRENGTH,
    STEM_ELEMENT,
    STEM_YINYANG,
    # Phase 12d Pattern 2a constants
    PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD,
    PATTERN_2A_BOOST_PER_TRANSPARENT_YIN_MONTH,
    PATTERN_2A_BOOST_PER_TRANSPARENT_BIJIE_MONTH,
    PATTERN_2A_ZHONGQI_YIN_MULTIPLIER,
    PATTERN_2A_BOOST_CAP,
    # Phase 12d Pattern 2b constants
    PATTERN_2B_ENEMY_THRESHOLD,
    PATTERN_2B_SUPPORT_CAP,
    PATTERN_2B_OFFICER_TRANSPARENT_MIN,
    PATTERN_2B_DAMPENER_MULTIPLIER,
    PATTERN_2B_DAMPENER_CAP,
    PATTERN_2B_FLAT_SURROUND_PENALTY,
    PATTERN_2B_DELING_FLOOR,
    # Phase 12d Pattern 3a constants
    PATTERN_3A_V2_FLOOR,
    PATTERN_3A_DOMINANT_PCT_FLOOR,
    PATTERN_3A_YIN_WEIGHT_THRESHOLD,
    PATTERN_3A_BREAKER_STRONG_ROOT,
    YI_XING_DE_QI_SUB_NAMES,
)
from .life_stages import get_life_stage
from .stem_combinations import (
    STEM_COMBINATION_LOOKUP,
    analyze_stem_relationships,
    find_stem_combinations,
)
from .branch_relationships import analyze_branch_relationships
from .ten_gods import (
    compute_stem_pressure_weight,
    derive_ten_god,
    get_overcoming_stems_for_dm,
    get_prominent_ten_god,
)

# ============================================================
# 官殺混雜 thresholds (Fix 1b, love domain only)
# ============================================================
#
# Classical rule (《淵海子平》, 《三命通會》):
#   「露殺藏官只論殺，露官藏殺只論官」
# True 混雜 requires both sides to be substantive AND comparable in weight.
# Fix 1b thresholds:
#   - Each side must have weighted pressure ≥ 2.0 (≥本氣藏干 or ≥透干,
#     not just 餘氣)
#   - Weaker side ≥ 50% of stronger side
#   - Otherwise: relabel to 露官藏殺只論官 / 露殺藏官只論殺 (narrative-only)
#
# IMPORTANT — independence from dominance detection (Fix 1a):
#   This relabel is narrative-only, scoped to love domain.
#   _detect_dominant_imbalance() in ten_gods.py still sums both 官 and 殺
#   contributions regardless of the 混雜 outcome — dominance detection is
#   about total category pressure on DM, not 格局 purity. A chart with
#   one 透殺 + one 藏官 still exerts combined 官殺 pressure on weak DM.
#   See ten_gods.py::compute_stem_pressure_weight and the docstring on
#   check_guan_sha_hunza below.
GUAN_SHA_HUNZA_MIN_WEIGHT = 2.0
GUAN_SHA_HUNZA_MIN_RATIO = 0.5


# ============================================================
# Reading Type → Domain Mapping
# ============================================================

READING_TYPE_DOMAINS: Dict[str, List[str]] = {
    'LIFETIME':        ['career', 'love', 'health', 'timing'],
    'ANNUAL':          ['career', 'love', 'health', 'timing'],
    'CAREER':          ['career', 'timing'],           # NEW — matches NestJS enum
    'CAREER_FINANCE':  ['career', 'timing'],           # KEPT for backward compatibility
    'LOVE':            ['love', 'timing'],
    'HEALTH':          ['health', 'timing'],
    'COMPATIBILITY':   ['love'],
}


# ============================================================
# Day Master Strength V2 — 3-Factor Scoring (0-100 scale)
# ============================================================

# 得令: Map SEASON_STRENGTH (旺相休囚死 1-5) → score (0-50 scale)
#
# IMPORTANT: Uses element vs season (SEASON_STRENGTH), NOT stem-specific Life Stage.
# Reason: Yin stems have reversed Life Stage cycles (e.g., 丁's 長生 is 酉, 死 is 寅),
# but seasonal element support follows the element, not the stem. A 丁 Fire DM born
# in Spring (寅月) is strong because Wood produces Fire (Fire is 相), even though
# 丁's individual Life Stage in 寅 is 死.
#
# Professional Bazi masters use 旺相休囚死 for "得令" assessment:
#   旺(5)=50, 相(4)=40, 休(3)=25, 囚(2)=12, 死(1)=0
# Source: 《子平真詮·論旺相休囚死》, confirmed by web research
SEASON_DELING_SCORE: Dict[int, int] = {
    5: 50,   # 旺 — element is in season (strongest)
    4: 40,   # 相 — element is produced by season
    3: 25,   # 休 — element produces the season (resting)
    2: 12,   # 囚 — element overcomes the season (suppressed)
    1: 0,    # 死 — element is overcome by the season (dead)
}

# Life Stage scoring kept for reference and personality/timing use
# (NOT used in strength calculation — see above)
LIFE_STAGE_DELING_SCORE: Dict[str, int] = {
    '帝旺': 50, '臨官': 42, '冠帶': 33, '長生': 25,
    '沐浴': 15, '養': 10, '胎': 8,
    '衰': 6, '病': 4, '墓': 3, '死': 2, '絕': 0,
}

# 得地 pillar weights — traditional: 月支 > 日支 > 時支 > 年支
# Per 《子平真詮》 and web research. Month=35% (strongest root),
# day=30%, hour=20%, year=15%.
DEDI_PILLAR_WEIGHTS: Dict[str, float] = {
    'month': 0.35, 'day': 0.30, 'hour': 0.20, 'year': 0.15,
}


# ============================================================
# Phase 12d feature flags (module-level constants — match
# `_USE_WEIGHTED_IMBALANCE` convention in five_elements.py).
# Tests monkeypatch these constants directly.
# ============================================================
_PATTERN_2C_SANHE_CREDIT: bool = os.environ.get(
    'PHASE_12D_PATTERN_2C_SANHE_CREDIT', '1'
).lower() in ('1', 'true', 'yes', 'on')

_PATTERN_2A_BIJIE_BOOST: bool = os.environ.get(
    'PHASE_12D_PATTERN_2A_BIJIE_BOOST', '1'
).lower() in ('1', 'true', 'yes', 'on')

_PATTERN_2B_SURROUND_DAMPENER: bool = os.environ.get(
    'PHASE_12D_PATTERN_2B_SURROUND_DAMPENER', '1'
).lower() in ('1', 'true', 'yes', 'on')

_PATTERN_3B_HUAQI_SUPPRESSION: bool = os.environ.get(
    'PHASE_12D_PATTERN_3B_HUAQI_SUPPRESSION', '1'
).lower() in ('1', 'true', 'yes', 'on')

# Pattern 3a is HIGHEST risk — ship FLAG-OFF default.
_PATTERN_3A_CONG_QIANG_DETECTOR: bool = os.environ.get(
    'PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR', '0'
).lower() in ('1', 'true', 'yes', 'on')


def _build_root_class_cache(pillars: Dict) -> Dict[str, str]:
    """
    Build root_class_cache mirroring `compute_weighted_category_scores` logic.

    Returns {stem: 'strong' | 'weak' | 'none'} where:
      - 'strong' = stem appears as 本氣 OR 中氣 in any branch's hidden stems
      - 'weak'   = stem appears only as 餘氣
      - 'none'   = stem has no presence in any branch

    Used by Pattern 2a's rooted-透干 filter (Phase A 「干多不如根重」 doctrine).
    """
    cache: Dict[str, str] = {}
    for stem in '甲乙丙丁戊己庚辛壬癸':
        positions: List[str] = []
        for pname in ('year', 'month', 'day', 'hour'):
            branch = pillars.get(pname, {}).get('branch', '')
            for idx, hs in enumerate(HIDDEN_STEMS.get(branch, [])):
                if hs == stem:
                    positions.append(['benqi', 'zhongqi', 'yuqi'][min(idx, 2)])
        has_strong = 'benqi' in positions or 'zhongqi' in positions
        has_weak = 'yuqi' in positions and not has_strong
        cache[stem] = 'strong' if has_strong else ('weak' if has_weak else 'none')
    return cache


def _pattern_2a_bijie_boost(
    pillars: Dict,
    day_master_stem: str,
) -> Tuple[float, str]:
    """
    Phase 12d Pattern 2a / 2a': boost V2 when 比劫 transparent ≥ 2
    AND month=印 (2a) OR month=本氣比劫祿/羊刃 (2a').

    Returns (boost, source) where source ∈
      {'month_yin_benqi', 'month_yin_zhongqi', 'month_bijie', 'none'}.

    Phase A doctrine:
      - Only ROOTED 比劫 透干 contribute (root_class ∈ {'strong','weak'})
        per 《滴天髓》「干多不如根重」.
      - Boost: +8/透干 above 2nd for 月令印; +6 for 月令本氣比劫 (羊刃/祿);
        capped at +20.
      - 中氣 印 in month branch gets 60% credit of 本氣 boost.
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    producing_element = ELEMENT_PRODUCED_BY[dm_element]

    # Count rooted-only 比劫 transparent. Day pillar is skipped (it's the DM
    # position), but other pillars that happen to share the DM stem (i.e.,
    # 比肩 — same element same polarity) ARE counted. This matches
    # `compute_weighted_category_scores` convention.
    root_cache = _build_root_class_cache(pillars)
    rooted_bijie_transparent = 0
    for pname in ('year', 'month', 'hour'):  # day pillar = DM position
        stem = pillars.get(pname, {}).get('stem', '')
        if not stem:
            continue
        if STEM_ELEMENT.get(stem, '') != dm_element:
            continue
        # Same-element match covers both 比肩 (same polarity) and 劫財 (diff)
        if root_cache.get(stem, 'none') in ('strong', 'weak'):
            rooted_bijie_transparent += 1

    if rooted_bijie_transparent < PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD:
        return (0.0, 'none')

    # Determine month-branch nature
    month_branch = pillars['month']['branch']
    month_hidden = HIDDEN_STEMS.get(month_branch, [])
    month_main_el = STEM_ELEMENT.get(month_hidden[0], '') if month_hidden else ''
    month_zhongqi_el = (STEM_ELEMENT.get(month_hidden[1], '')
                        if len(month_hidden) > 1 else '')

    excess = (rooted_bijie_transparent
              - PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD + 1)

    if month_main_el == producing_element:  # 2a: 月令本氣印
        boost = excess * PATTERN_2A_BOOST_PER_TRANSPARENT_YIN_MONTH
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_yin_benqi')
    if month_zhongqi_el == producing_element:  # 月令中氣印 (60% credit)
        boost = (excess
                 * PATTERN_2A_BOOST_PER_TRANSPARENT_YIN_MONTH
                 * PATTERN_2A_ZHONGQI_YIN_MULTIPLIER)
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_yin_zhongqi')
    if month_main_el == dm_element:  # 2a': 月令本氣比劫 (祿/羊刃)
        boost = excess * PATTERN_2A_BOOST_PER_TRANSPARENT_BIJIE_MONTH
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_bijie')

    return (0.0, 'none')


def _pattern_2b_surround_penalty(
    pillars: Dict,
    day_master_stem: str,
    deling: float,
) -> Tuple[float, float, bool]:
    """
    Phase 12d Pattern 2b: 月令祿 surround penalty.

    Returns (deling_cut, flat_penalty, fired). Caller subtracts both.

    Trigger requires (Phase A verified):
      - 得令 == 50 (month=祿/帝旺/印 本氣)
      - (財+官殺) weighted ≥ 9
      - (比劫+印, sans 月令本氣 contribution) ≤ 5
      - transparent[官殺] ≥ 1

    Source: 《淵海子平·論建祿格》「若四柱財官重重而日主獨守月令祿地，
                                  反為弱論」.
    """
    if deling < 50.0:
        return (0.0, 0.0, False)

    from .ten_gods import (
        compute_weighted_category_scores,
        IMBALANCE_WEIGHT_HIDDEN_BENQI,
        MONTH_BENQI_COMMANDER_MULTIPLIER,
        PILLAR_ROLE_WEIGHT,
    )

    scores = compute_weighted_category_scores(pillars, day_master_stem)
    cats = scores['categories']
    transp = scores['category_transparent_count']

    enemy = cats.get('財星', 0.0) + cats.get('官殺', 0.0)
    support_total = cats.get('比劫', 0.0) + cats.get('印星', 0.0)

    # Subtract 月令本氣 contribution from support per Phase A: support
    # excludes the month's commander stem, since the dampener is meant
    # to reflect that the lone monthly anchor is the only DM support.
    month_branch = pillars['month']['branch']
    month_main_stem = (HIDDEN_STEMS.get(month_branch, [''])[0]
                       if HIDDEN_STEMS.get(month_branch) else '')
    if month_main_stem:
        dm_el = STEM_ELEMENT[day_master_stem]
        producing = ELEMENT_PRODUCED_BY[dm_el]
        main_el = STEM_ELEMENT.get(month_main_stem, '')
        if main_el in (dm_el, producing):
            month_contribution = (IMBALANCE_WEIGHT_HIDDEN_BENQI
                                  * MONTH_BENQI_COMMANDER_MULTIPLIER
                                  * PILLAR_ROLE_WEIGHT['month'])
            support = max(0.0, support_total - month_contribution)
        else:
            support = support_total
    else:
        support = support_total

    if (enemy >= PATTERN_2B_ENEMY_THRESHOLD
        and support <= PATTERN_2B_SUPPORT_CAP
        and transp.get('官殺', 0) >= PATTERN_2B_OFFICER_TRANSPARENT_MIN):
        deling_cut = min(
            (enemy - support) * PATTERN_2B_DAMPENER_MULTIPLIER,
            PATTERN_2B_DAMPENER_CAP,
            deling - PATTERN_2B_DELING_FLOOR,
        )
        return (deling_cut, PATTERN_2B_FLAT_SURROUND_PENALTY, True)

    return (0.0, 0.0, False)


def calculate_strength_score_v2(pillars: Dict, day_master_stem: str) -> Dict:
    """
    3-factor Day Master strength scoring (0-100 scale).

    Factors:
      - 得令 (50%): Life Stage of Day Master in month branch
      - 得地 (30%): 通根 root depth in branch hidden stems
      - 得勢 (20%): Supporting elements across stems + branch main qi

    Returns:
        Dict with score, classification, and factor breakdown
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    month_branch = pillars['month']['branch']
    producing_element = ELEMENT_PRODUCED_BY[dm_element]

    # Factor 1: 得令 (50% weight) — Seasonal element strength (旺相休囚死)
    # Uses SEASON_STRENGTH (element vs month branch) for consistent results
    # across Yang and Yin stems. Life Stage retained for informational output.
    life_stage = get_life_stage(day_master_stem, month_branch)
    season_score = SEASON_STRENGTH.get(dm_element, {}).get(month_branch, 3)
    deling = SEASON_DELING_SCORE.get(season_score, 12)

    # Factor 2: 得地 (30% weight) — 通根 root depth
    root_score = 0.0
    for pillar_name, weight in DEDI_PILLAR_WEIGHTS.items():
        branch = pillars[pillar_name]['branch']
        hidden_stems = HIDDEN_STEMS.get(branch, [])
        hidden_weights = HIDDEN_STEM_WEIGHTS.get(branch, [])
        for i, hs_stem in enumerate(hidden_stems):
            hs_weight = hidden_weights[i] if i < len(hidden_weights) else 0.1
            if STEM_ELEMENT[hs_stem] == dm_element:
                root_score += weight * hs_weight
    dedi = min(root_score * 30, 30)  # Cap at 30

    # Phase 12d Pattern 2c: 三合/半合 DM-element credit (additional dedi)
    # Source: 《滴天髓·地支》, 《淵海子平·地支三合》. Phase A verified.
    sanhe_kind = 'none'
    sanhe_credit = 0.0
    if _PATTERN_2C_SANHE_CREDIT:
        from .branch_relationships import compute_sanhe_dm_credit
        sanhe_credit, sanhe_kind = compute_sanhe_dm_credit(pillars, dm_element)
        if sanhe_credit > 0:
            dedi = min(dedi + sanhe_credit, 30)

    # Factor 3: 得勢 (20% weight) — stems + branch main qi
    support_score = 0.0
    total_weight = 0.0
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        # Manifest stem (skip day stem = Day Master itself)
        if pillar_name != 'day':
            stem_el = STEM_ELEMENT[pillar['stem']]
            total_weight += 1.0
            if stem_el == dm_element or stem_el == producing_element:
                support_score += 1.0
        # Branch main qi (本氣)
        branch_hidden = HIDDEN_STEMS.get(pillar['branch'], [])
        if branch_hidden:
            branch_main_el = STEM_ELEMENT[branch_hidden[0]]
            total_weight += 0.6
            if branch_main_el == dm_element or branch_main_el == producing_element:
                support_score += 0.6
    deshi = (support_score / total_weight) * 20 if total_weight > 0 else 0

    # Phase 12d Pattern 2a / 2a': 比劫 透干 boost
    pattern_2a_boost = 0.0
    pattern_2a_source = 'none'
    if _PATTERN_2A_BIJIE_BOOST:
        pattern_2a_boost, pattern_2a_source = _pattern_2a_bijie_boost(
            pillars, day_master_stem)

    # Phase 12d Pattern 2b: 月令祿 surround dampener
    pattern_2b_deling_cut = 0.0
    pattern_2b_flat_penalty = 0.0
    pattern_2b_fired = False
    if _PATTERN_2B_SURROUND_DAMPENER:
        pattern_2b_deling_cut, pattern_2b_flat_penalty, pattern_2b_fired = (
            _pattern_2b_surround_penalty(pillars, day_master_stem, deling))
        if pattern_2b_fired:
            deling = max(deling - pattern_2b_deling_cut,
                         PATTERN_2B_DELING_FLOOR)

    total = round(
        deling + dedi + deshi + pattern_2a_boost - pattern_2b_flat_penalty, 1)
    classification = (
        'very_strong' if total >= 70 else
        'strong' if total >= 55 else
        'neutral' if total >= 40 else
        'weak' if total >= 25 else
        'very_weak'
    )

    return {
        'score': total,
        'classification': classification,
        'factors': {
            'deling': round(deling, 1),
            'dedi': round(dedi, 1),
            'deshi': round(deshi, 1),
            'sanheCredit': round(sanhe_credit, 1),
            'sanheKind': sanhe_kind,
            'pattern2aBoost': round(pattern_2a_boost, 1),
            'pattern2aSource': pattern_2a_source,
            'pattern2bDelingCut': round(pattern_2b_deling_cut, 1),
            'pattern2bFlatPenalty': (
                round(pattern_2b_flat_penalty, 1)
                if pattern_2b_fired else 0.0
            ),
        },
        'lifeStage': life_stage,
    }


# ============================================================
# 從格 (Following Pattern) Detection
# ============================================================

def check_cong_ge(
    pillars: Dict,
    day_master_stem: str,
    strength_v2: Dict,
    five_elements_balance: Dict[str, float],
) -> Optional[Dict]:
    """
    Detect 從格 (Following Pattern) — when Day Master is too weak to be independent.

    Subtypes:
      - 從財格: Wealth element dominates
      - 從官格: Authority element dominates
      - 從兒格: Output element dominates (allows minimal root)
      - 從勢格: Multiple competing elements, Day Master has no root

    Source: 《滴天髓·化氣》, 《子平真詮·論從格》

    Returns:
        Dict with cong_ge details, or None if not 從格
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    is_yang = STEM_YINYANG[day_master_stem] == '陽'
    producing_element = ELEMENT_PRODUCED_BY[dm_element]
    i_produce = ELEMENT_PRODUCES[dm_element]
    i_overcome = ELEMENT_OVERCOMES[dm_element]
    overcomes_me = ELEMENT_OVERCOME_BY[dm_element]

    score = strength_v2['score']

    # Phase 12d Pattern 3b: detect 真化 transformed stems before 從格 check.
    # When a 印/比劫 stem has fully transformed via 真化 (e.g., 乙庚化金
    # in `anchor_cong_cai_yiwuming`), it should not block 從格 detection.
    # Source: 《滴天髓·化象》, Phase A doctrine verification.
    transformed_stems: Dict[Tuple[str, str], str] = {}
    if _PATTERN_3B_HUAQI_SUPPRESSION:
        from .stem_combinations import detect_true_transformed_stems
        transformed_stems = detect_true_transformed_stems(
            pillars, day_master_stem)

        # S2.3 fix: DM-involved 五合 → 從格 ambiguous; do not fire.
        if any(s == day_master_stem for (_, s) in transformed_stems):
            return None

    # 從格 requires very weak Day Master
    # 從兒格 has a higher threshold (~35) because it allows minimal root
    if score >= 35:
        return None

    # Check for roots (通根): Day Master element in any branch hidden stem
    has_root = False
    root_count = 0
    for pillar_name in ['year', 'month', 'day', 'hour']:
        branch = pillars[pillar_name]['branch']
        for hs in HIDDEN_STEMS.get(branch, []):
            if STEM_ELEMENT[hs] == dm_element:
                has_root = True
                root_count += 1

    # Check for 印/比劫 in entire chart (stems AND branch hidden stems).
    # Phase 12d Pattern 3b: skip transformed stems (subtract by 1 effect
    # per 《子平真詮》「化而不化者，藏其性」 — the original stem's energy
    # doesn't fully disappear, but for blocking purposes 真化 stems
    # cease to function as 印/比劫).
    has_yin_bijie = False
    yin_bijie_count = 0
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        # Check manifest stem (skip day master itself)
        if pillar_name != 'day':
            stem = pillar['stem']
            # Pattern 3b: 真化 transformed stems are excluded from blocker count
            if (pillar_name, stem) in transformed_stems:
                pass  # transformed → does NOT block 從格
            else:
                el = STEM_ELEMENT[stem]
                if el == dm_element or el == producing_element:
                    has_yin_bijie = True
                    yin_bijie_count += 1
        # Check ALL branch hidden stems (branches don't transform — unchanged)
        for hs in HIDDEN_STEMS.get(pillar['branch'], []):
            el = STEM_ELEMENT[hs]
            if el == dm_element or el == producing_element:
                has_yin_bijie = True
                yin_bijie_count += 1

    # Yang DM cannot 從 with ANY 印/比劫 (《滴天髓》: "陽干從氣不從勢")
    # Yin DM may form 假從 with one isolated, unsupported 印/比劫
    if is_yang and has_yin_bijie:
        return None
    if not is_yang and yin_bijie_count > 1:
        return None

    # Determine which element dominates (>55% of chart energy — engineering approximation)
    dominant_element = None
    dominant_pct = 0.0
    for element in FIVE_ELEMENTS:
        pct = five_elements_balance.get(element, 0.0)
        if pct > dominant_pct:
            dominant_pct = pct
            dominant_element = element

    # Classify 從格 subtype
    if dominant_pct > 55 and dominant_element == i_overcome:
        return {
            'type': 'cong_cai',
            'name': '從財格',
            'dominantElement': dominant_element,
            'dominantPct': dominant_pct,
            'description': '日主極弱，順從財星',
            'yongShen': i_overcome,  # 財 becomes 用神
            'jiShen': [dm_element, producing_element],  # 比劫/印 become 忌神
            'significance': 'critical',
        }
    elif dominant_pct > 55 and dominant_element == overcomes_me:
        return {
            'type': 'cong_guan',
            'name': '從官格',
            'dominantElement': dominant_element,
            'dominantPct': dominant_pct,
            'description': '日主極弱，順從官殺',
            'yongShen': overcomes_me,
            'jiShen': [dm_element, producing_element],
            'significance': 'critical',
        }
    elif dominant_pct > 55 and dominant_element == i_produce:
        # 從兒格: allows minimal root (score < 35 vs < 25 for others)
        if score < 35:
            return {
                'type': 'cong_er',
                'name': '從兒格',
                'dominantElement': dominant_element,
                'dominantPct': dominant_pct,
                'description': '日主極弱，順從食傷（才華）',
                'yongShen': i_produce,
                'jiShen': [dm_element, producing_element],
                'significance': 'critical',
            }
    elif score < 25 and not has_root:
        # 從勢格: no single element dominates >55%, but DM has no root
        # 食傷+財+官殺 all compete while Day Master is rootless
        return {
            'type': 'cong_shi',
            'name': '從勢格',
            'dominantElement': dominant_element,
            'dominantPct': dominant_pct,
            'description': '日主無根，順勢而行',
            'yongShen': dominant_element,  # Follow strongest force
            'jiShen': [dm_element, producing_element],
            'significance': 'critical',
        }

    return None


# ============================================================
# Phase 12d Pattern 3a — 從強 / 從旺 / 一行得氣 detector
# ============================================================

def check_cong_qiang_or_wang(
    pillars: Dict,
    day_master_stem: str,
    strength_v2: Dict,
    weighted_categories: Dict[str, float],
    weighted_transparent: Dict[str, int],
) -> Optional[Dict]:
    """
    Phase 12d Pattern 3a: detect 從強 / 從旺 / 一行得氣 patterns.

    Distinct from `check_cong_ge` (which handles 從弱 family — 從財/官/兒/勢).
    Use case: charts like `ziping_wu_xianggong_qu_zhi` (癸亥 乙卯 乙未 壬午 =
    曲直格) where DM is overwhelmingly supported and follows 比劫+印 trend.

    Triggers (ALL must hold):
      (i)   V2 score ≥ PATTERN_3A_V2_FLOOR (70)
      (ii)  (比劫+印) weighted / total weighted ≥ 70%
      (iii) No 官殺 透干 with weighted ≥ PATTERN_3A_BREAKER_STRONG_ROOT (3.0)
      (iv)  For 從旺/一氣 sub-types: no 財 透干 with weighted ≥ 3.0

    Sub-type:
      - 印 weighted ≥ 4.0 → 從強格 (用=DM元素, 喜=印)
      - else → 從旺/一行得氣 (用=DM元素, 喜=食傷); name from
        YI_XING_DE_QI_SUB_NAMES (曲直/炎上/稼穡/從革/潤下).

    Returns: dict with all 5 effective gods populated (S6.2/S7.6 N2 fix
    invariant: usefulGod ≠ favorableGod ≠ idleGod ≠ tabooGod ≠ enemyGod).
    Marker `dmAsYongShen=True` distinguishes from 從弱 family.

    Source: 《滴天髓·形象》, 《滴天髓·順反》, Phase A doctrine verification.
    """
    if strength_v2['score'] < PATTERN_3A_V2_FLOOR:
        return None

    bijie = weighted_categories.get('比劫', 0.0)
    yin = weighted_categories.get('印星', 0.0)
    cai = weighted_categories.get('財星', 0.0)
    guan = weighted_categories.get('官殺', 0.0)
    shishang = weighted_categories.get('食傷', 0.0)
    total = bijie + yin + cai + guan + shishang
    if total == 0:
        return None

    combined_pct = (bijie + yin) / total * 100
    if combined_pct < PATTERN_3A_DOMINANT_PCT_FLOOR:
        return None

    # Breaker check: 官殺 透干 強根 → chart converts to 殺印相生 normal格
    if (weighted_transparent.get('官殺', 0) >= 1
        and guan >= PATTERN_3A_BREAKER_STRONG_ROOT):
        return None

    dm_element = STEM_ELEMENT[day_master_stem]
    producing = ELEMENT_PRODUCED_BY[dm_element]
    i_produce = ELEMENT_PRODUCES[dm_element]
    i_overcome = ELEMENT_OVERCOMES[dm_element]
    overcomes_me = ELEMENT_OVERCOME_BY[dm_element]

    if yin >= PATTERN_3A_YIN_WEIGHT_THRESHOLD:
        # 從強格: 印+比劫 both heavy. DM is 用神, 印 is 喜神.
        return {
            'type': 'cong_qiang',
            'name': '從強格',
            'dominantElement': dm_element,
            'description': '日主極旺，順從比劫印星',
            'yongShen': dm_element,
            'xiShen': producing,                   # 印
            'jiShen': [i_overcome, overcomes_me],  # 財, 官殺
            'idleGod': i_produce,                  # 食傷 (閒)
            'dmAsYongShen': True,
            'significance': 'critical',
        }

    # 從旺 / 一行得氣 sub-types: 財 透干 強根 also blocks
    if (weighted_transparent.get('財星', 0) >= 1
        and cai >= PATTERN_3A_BREAKER_STRONG_ROOT):
        return None

    sub_name = YI_XING_DE_QI_SUB_NAMES.get(dm_element, '從旺格')
    return {
        'type': 'cong_wang',
        'name': sub_name,
        'dominantElement': dm_element,
        'description': '日主旺極，從其旺勢，喜食傷洩秀',
        'yongShen': dm_element,
        'xiShen': i_produce,                   # 食傷
        'jiShen': [i_overcome, overcomes_me],  # 財, 官殺
        'idleGod': producing,                  # 印 (閒)
        'dmAsYongShen': True,
        'significance': 'critical',
    }


def _assert_five_gods_distinct(eg: Dict) -> None:
    """Phase 12d invariant: all 5 effective gods must be distinct elements.

    SCOPED to 從強/從旺 family only (where DM IS 用神 and 5-element-distinct
    is doctrinally required). Existing 從弱 family deliberately preserves
    the legacy `usefulGod == favorableGod` shape — DO NOT call this from
    that branch (S6.2 / N2 fix per Phase D review).
    """
    keys = ('usefulGod', 'favorableGod', 'idleGod', 'tabooGod', 'enemyGod')
    elements = [eg[k] for k in keys]
    if len(set(elements)) != 5:
        raise AssertionError(
            f'effective_gods invariant violated: '
            f'{dict(zip(keys, elements))}')


# ============================================================
# Ten God Position Rules (gender-split)
# ============================================================

# Common rules shared by both genders
_TEN_GOD_POSITION_RULES_COMMON: Dict[str, Dict[str, str]] = {
    '比肩_year':  '童年淘氣、與父母有代溝、兄弟姐妹多。家境不富裕，需自力更生。',
    '比肩_month': '社交能力強、朋友多但知己少、性格大膽、工作效率高但固執。',
    '比肩_day':   '固執己見、難以妥協。婚姻不和諧，配偶各走各路。',
    '比肩_hour':  '勤勞但思想頑固、人際關係差、偏好獨處。子女繼承固執性格。',

    '劫財_year':  '童年困難、祖業薄弱、父母可能分居。',
    '劫財_month': '固執暴躁、異性緣好但同性關係差、理財能力差。',
    '劫財_day':   '愛出風頭、不切實際、異性緣好但不關心配偶、花費無度。',
    '劫財_hour':  '情緒不穩、容易與上司爭論、工作經常更換。子女叛逆。',

    '食神_year':  '出生在富裕家庭、祖業好、童年舒適無憂。',
    '食神_month': '氣質高貴、福氣充沛、才華橫溢、身體健康長壽。最吉利位置之一。',
    '食神_day':   '一生福氣充沛、性格慷慨知足、子女多、長壽。配偶善良體貼。',
    '食神_hour':  '晚年儲蓄習慣好、經濟安全。子女孝順有成就。',

    '傷官_year':  '很少出生在富裕家庭。童年困難，少有遺產。',
    '傷官_month': '才華橫溢但不安分、與權威爭辯、創造力強但與領導衝突。',
    '傷官_day':   '配偶傾向爭辯、考驗婚姻和諧。配偶言辭犀利。',
    '傷官_hour':  '子女叛逆或體弱、與後代關係緊張。',

    '正財_year':  '童年學業興趣不高但家境好、有祖產。',
    '正財_month': '勤勞自立、白手起家、早婚傾向、事業順利。',
    '正財_hour':  '晚年享受旅行休閒、自給自足。子女容易賺錢。',

    '偏財_year':  '家境富裕、有祖產、但與父親關係不佳。',
    '偏財_month': '進入社會後急於賺錢、社交能力強、賺錢容易但有賭博傾向。',
    '偏財_hour':  '子女是財富來源、晚年財運好。',

    '正官_year':  '受祖先庇蔭、出身受尊重的家庭、早期學業成功。',
    '正官_month': '強烈的責任感、尊重權威、正直為本。最吉利位置。',
    '正官_hour':  '大福大壽、逢凶化吉。晚年事業成功，子女孝順。',

    '偏官_year':  '通常不是長子、很少來自富貴家庭、早年貧困。',
    '偏官_month': '氣場強大、意志堅定、勇敢、有戰略頭腦。適合軍警/競爭性職業。',
    '偏官_hour':  '子女運弱、與子女關係緊張。',

    '正印_year':  '出生在書香/富裕家庭、學業能力優秀。',
    '正印_month': '父母受尊敬且有福、善良聰慧、健康和平。最有利位置之一。',
    '正印_day':   '配偶善良聰慧、誠實可靠。婚姻和諧美滿。',
    '正印_hour':  '子女善良聰慧、學業成績好、孝順。',

    '偏印_year':  '損害家族聲譽（若為不利元素）、祖業基礎薄弱。',
    '偏印_month': '適合副業發展（醫療、藝術、娛樂、美容、自由職業）。',
    '偏印_day':   '男女皆有晚婚傾向、配偶問題。婚姻延遲。',
    '偏印_hour':  '子女不聽話、不孝順、體弱。',
}

# Male-specific overrides for 日支
TEN_GOD_POSITION_RULES_MALE: Dict[str, str] = {
    **_TEN_GOD_POSITION_RULES_COMMON,
    '正財_day':   '得到能幹賢惠的配偶、配偶提供極好的支持。婚姻非常有利。',
    '偏財_day':   '通過異性關係獲得好運、對異性有吸引力。可能面臨三角關係。',
    '正官_day':   '配偶有官方背景、婚姻提升地位。成就卓越。',
    '偏官_day':   '命格清晰、聰明能幹、以身作則。吸引伴侶。',
}

# Female-specific overrides
TEN_GOD_POSITION_RULES_FEMALE: Dict[str, str] = {
    **_TEN_GOD_POSITION_RULES_COMMON,
    '正財_day':   '理財能力強、善於管理家庭經濟。',
    '偏財_day':   '財務敏銳、投資眼光好。',
    '正官_day':   '丈夫正派可靠、婚姻穩定幸福。配偶有社會地位。',
    '偏官_day':   '配偶控制欲強、婚姻需要忍耐。可能面臨感情波折。',
}


def generate_ten_god_position_analysis(
    pillars: Dict,
    day_master_stem: str,
    gender: str = 'male',
) -> List[Dict]:
    """
    Generate Ten God position analysis for all pillars.

    Args:
        pillars: Four pillars with Ten God labels already applied
        day_master_stem: Day Master stem
        gender: 'male' or 'female'

    Returns:
        List of position analysis findings
    """
    rules = TEN_GOD_POSITION_RULES_MALE if gender == 'male' else TEN_GOD_POSITION_RULES_FEMALE
    findings: List[Dict] = []

    pillar_positions = {
        'year': '年柱',
        'month': '月柱',
        'day': '日支',
        'hour': '時柱',
    }

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]

        if pillar_name == 'day':
            # Day pillar uses branch hidden stem main qi for position rules
            hidden = HIDDEN_STEMS.get(pillar['branch'], [])
            if not hidden:
                continue
            ten_god = derive_ten_god(day_master_stem, hidden[0])
        else:
            ten_god = pillar.get('tenGod')
            if not ten_god:
                continue

        key = f'{ten_god}_{pillar_name}'
        interpretation = rules.get(key)
        if not interpretation:
            continue

        # Determine significance based on pillar and ten god
        significance = 'medium'
        if pillar_name == 'month' and ten_god in ('正官', '食神', '正印', '正財'):
            significance = 'high'
        elif pillar_name == 'day':
            significance = 'high'  # Spouse palace always important

        findings.append({
            'tenGod': ten_god,
            'pillar': pillar_name,
            'pillarZh': pillar_positions[pillar_name],
            'interpretation': interpretation,
            'significance': significance,
        })

    return findings


# ============================================================
# 透干 (Tou Gan) Analysis
# ============================================================

def generate_tougan_analysis(
    pillars: Dict,
    day_master_stem: str,
) -> List[Dict]:
    """
    Analyze 透干 (transparency) — hidden stems that appear as manifest stems.

    A hidden stem that also appears as a manifest stem in another pillar
    has full power (透干). One that remains hidden is latent (藏而不透).

    Returns:
        List of transparency findings
    """
    findings: List[Dict] = []

    # Collect all manifest stems
    manifest_stems: Dict[str, str] = {}  # stem → pillar_name
    for pname in ('year', 'month', 'hour'):
        manifest_stems[pillars[pname]['stem']] = pname

    # Check each pillar's hidden stems for transparency
    for pillar_name in ['year', 'month', 'day', 'hour']:
        branch = pillars[pillar_name]['branch']
        hidden = HIDDEN_STEMS.get(branch, [])

        for i, hs in enumerate(hidden):
            ten_god = derive_ten_god(day_master_stem, hs)
            is_main_qi = (i == 0)
            qi_type = '本氣' if is_main_qi else ('中氣' if i == 1 else '餘氣')

            if hs in manifest_stems:
                # 透干: hidden stem appears as manifest stem
                transparent_pillar = manifest_stems[hs]
                findings.append({
                    'stem': hs,
                    'tenGod': ten_god,
                    'sourcePillar': pillar_name,
                    'transparentPillar': transparent_pillar,
                    'qiType': qi_type,
                    'status': 'transparent',
                    'description': f'{ten_god}（{hs}）在{pillar_name}支{qi_type}透出於{transparent_pillar}干，力量充分',
                    'significance': 'high' if is_main_qi else 'medium',
                })
            elif is_main_qi:
                # Main qi that doesn't 透干 — latent but still important
                findings.append({
                    'stem': hs,
                    'tenGod': ten_god,
                    'sourcePillar': pillar_name,
                    'transparentPillar': None,
                    'qiType': qi_type,
                    'status': 'latent',
                    'description': f'{ten_god}（{hs}）藏於{pillar_name}支{qi_type}，藏而不透，力量潛伏',
                    'significance': 'low',
                })

    return findings


# ============================================================
# 官殺混雜 Check (Female Only)
# ============================================================

def check_guan_sha_hunza(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
) -> Optional[Dict]:
    """
    Check for 官殺混雜 — weighted threshold per Fix 1b.

    Classical rule (《淵海子平》, 《三命通會》): true 混雜 requires both
    正官 AND 偏官/七殺 to be substantive (≥ 本氣藏干 or ≥ 透干) AND comparable
    in weight. Else relabel to 露官藏殺只論官 / 露殺藏官只論殺.

    Narrative-only; scoped to love domain. Independent from the 官殺 category
    pressure tally used by _detect_dominant_imbalance (see module-level
    thresholds docstring and ten_gods.compute_stem_pressure_weight).

    Female charts only (severe marriage warning).

    Returns one of:
      - {type: 'guan_sha_hunza',  name: '官殺混雜',    ...}
      - {type: 'lu_guan_cang_sha', name: '露官藏殺只論官', ...}
      - {type: 'lu_sha_cang_guan', name: '露殺藏官只論殺', ...}
      - None (neither side substantive)
    """
    if gender != 'female':
        return None

    stems = get_overcoming_stems_for_dm(day_master_stem)
    zg_stem = stems.get('正官')
    qs_stem = stems.get('偏官')
    if not zg_stem or not qs_stem:
        return None

    zg = compute_stem_pressure_weight(zg_stem, pillars)
    qs = compute_stem_pressure_weight(qs_stem, pillars)
    zg_w = zg['total']
    qs_w = qs['total']

    # Neither present (or both trace-only) → nothing to say
    if zg_w == 0 or qs_w == 0:
        return None

    stronger = max(zg_w, qs_w)
    weaker = min(zg_w, qs_w)
    ratio = round(weaker / stronger, 2) if stronger > 0 else 0.0
    weights_payload = {
        'zhengguan': zg_w,
        'qisha': qs_w,
        'ratio': ratio,
        'zhengguanTransparent': zg['transparent_count'] > 0,
        'qishaTransparent': qs['transparent_count'] > 0,
    }

    both_substantive = (
        zg_w >= GUAN_SHA_HUNZA_MIN_WEIGHT
        and qs_w >= GUAN_SHA_HUNZA_MIN_WEIGHT
    )

    if both_substantive and ratio >= GUAN_SHA_HUNZA_MIN_RATIO:
        return {
            'type': 'guan_sha_hunza',
            'name': '官殺混雜',
            'description': '正官與偏官（七殺）並重同見，感情生活複雜，婚姻有波折',
            'weights': weights_payload,
            'domains': ['love'],
            'significance': 'high',
        }

    # Not true 混雜 — relabel based on which side dominates.
    if zg_w >= qs_w:
        return {
            'type': 'lu_guan_cang_sha',
            'name': '露官藏殺只論官',
            'description': '正官強於偏官，以正官論格；偏官雖在但力微，感情主軸偏穩定',
            'weights': weights_payload,
            'domains': ['love'],
            'significance': 'medium',
        }

    return {
        'type': 'lu_sha_cang_guan',
        'name': '露殺藏官只論殺',
        'description': '偏官強於正官，以七殺論格；正官雖在但力微，感情偏剛烈、波折較大',
        'weights': weights_payload,
        'domains': ['love'],
        'significance': 'medium',
    }


# ============================================================
# 用神合絆 (Yong Shen Locking) Detection
# ============================================================

def check_yong_shen_locked(
    pillars: Dict,
    favorable_gods: Dict[str, str],
    stem_combinations: List[Dict],
) -> List[Dict]:
    """
    Check if the 用神 element is "locked" by a stem combination.

    When a stem carrying the 用神 element combines with another stem
    (even 合而不化), the 用神 is tied up and cannot function.

    Returns:
        List of locked 用神 findings
    """
    findings: List[Dict] = []
    useful_element = favorable_gods.get('usefulGod', '')

    for combo in stem_combinations:
        stem_a, stem_b = combo['stems']
        el_a = STEM_ELEMENT[stem_a]
        el_b = STEM_ELEMENT[stem_b]

        if el_a == useful_element or el_b == useful_element:
            locked_stem = stem_a if el_a == useful_element else stem_b
            findings.append({
                'type': 'yong_shen_locked',
                'lockedStem': locked_stem,
                'lockedElement': useful_element,
                'combinedWith': stem_b if locked_stem == stem_a else stem_a,
                'pillarA': combo['pillarA'],
                'pillarB': combo['pillarB'],
                'description': f'用神{useful_element}（{locked_stem}）被{combo["description"]}合絆，用神功能受限',
                'significance': 'high',
            })

    return findings


# ============================================================
# 墓庫 (Tomb/Storage) Analysis
# ============================================================

# 辰/戌/丑/未 store specific elements
TOMB_STORAGE: Dict[str, Dict] = {
    '辰': {'stores': '水', 'element': '土', 'description': '辰為水庫'},
    '戌': {'stores': '火', 'element': '土', 'description': '戌為火庫'},
    '丑': {'stores': '金', 'element': '土', 'description': '丑為金庫'},
    '未': {'stores': '木', 'element': '土', 'description': '未為木庫'},
}


def analyze_tomb_storage(pillars: Dict) -> List[Dict]:
    """
    Analyze 墓庫 (tomb/storage) branches in the chart.

    辰/戌/丑/未 are earth branches that store specific elements.
    When a tomb is "opened" (沖開) by its opposite branch, the stored
    element is released.
    """
    findings: List[Dict] = []

    for pillar_name in ['year', 'month', 'day', 'hour']:
        branch = pillars[pillar_name]['branch']
        if branch not in TOMB_STORAGE:
            continue

        info = TOMB_STORAGE[branch]
        finding: Dict[str, Any] = {
            'branch': branch,
            'pillar': pillar_name,
            'stores': info['stores'],
            'description': info['description'],
        }

        # Day branch 墓庫 = reserved/secretive spouse
        if pillar_name == 'day':
            finding['spouseNote'] = f'日支{branch}為{info["stores"]}庫，配偶性格內斂保守'

        findings.append(finding)

    return findings


# ============================================================
# Life Domain Mapping
# ============================================================

ELEMENT_INDUSTRIES: Dict[str, List[str]] = {
    '木': ['教育', '醫療', '出版', '時尚', '創意寫作', '社會工作', '植物/花卉', '服裝'],
    '火': ['科技', '能源', '娛樂', '電子', '餐飲', '媒體', '光學', '美容'],
    '土': ['房地產', '建築', '農業', '礦業', '保險', '物流', '陶瓷', '顧問'],
    '金': ['金融', '法律', '汽車', '機械', '珠寶', '軍事', '外科', '會計'],
    '水': ['貿易', '航運', '旅遊', '水產', '飲料', '諮詢', '情報', 'IT'],
}

ELEMENT_HEALTH: Dict[str, Dict] = {
    '木': {'organs': ['肝', '膽'], 'excess': '肝火旺、易怒、頭痛', 'deficiency': '視力差、筋骨無力'},
    '火': {'organs': ['心', '小腸'], 'excess': '心悸、失眠、焦躁', 'deficiency': '血壓低、手腳冰冷'},
    '土': {'organs': ['脾', '胃'], 'excess': '消化不良、肥胖', 'deficiency': '食慾差、營養吸收差'},
    '金': {'organs': ['肺', '大腸'], 'excess': '皮膚過敏、呼吸急促', 'deficiency': '免疫力差、易感冒'},
    '水': {'organs': ['腎', '膀胱'], 'excess': '水腫、泌尿問題', 'deficiency': '腰膝酸軟、記憶力差'},
}

LOVE_INDICATORS: Dict[str, Dict[str, str]] = {
    'male': {
        'spouse_star': '正財',
        'romance_star': '偏財',
        'spouse_palace': '日支',
    },
    'female': {
        'spouse_star': '正官',
        'romance_star': '偏官',
        'spouse_palace': '日支',
    },
}


def generate_career_insights(
    favorable_gods: Dict[str, str],
    prominent_god: str,
    strength_classification: str,
) -> Dict:
    """Generate career domain insights based on 用神 and chart pattern."""
    useful_element = favorable_gods.get('usefulGod', '')
    industries = ELEMENT_INDUSTRIES.get(useful_element, [])

    work_style = '領導型' if strength_classification in ('strong', 'very_strong') else '輔助型'
    if prominent_god in ('正官', '偏官'):
        work_style = '管理/權威型'
    elif prominent_god in ('食神', '傷官'):
        work_style = '創意/技術型'
    elif prominent_god in ('正財', '偏財'):
        work_style = '商業/理財型'

    return {
        'suitableIndustries': industries,
        'usefulElement': useful_element,
        'workStyle': work_style,
        'prominentGod': prominent_god,
    }


def generate_health_insights(
    five_elements_balance: Dict[str, float],
    dm_element: str,
) -> Dict:
    """Generate health domain insights based on Five Elements balance."""
    # Find most excessive and most deficient elements
    sorted_elements = sorted(five_elements_balance.items(), key=lambda x: x[1], reverse=True)
    excess_element = sorted_elements[0][0] if sorted_elements[0][1] > 25 else None
    deficient_element = sorted_elements[-1][0] if sorted_elements[-1][1] < 15 else None

    weak_organs: List[str] = []
    warnings: List[str] = []

    if excess_element and excess_element in ELEMENT_HEALTH:
        info = ELEMENT_HEALTH[excess_element]
        weak_organs.extend(info['organs'])
        warnings.append(f'{excess_element}過旺：{info["excess"]}')

    if deficient_element and deficient_element in ELEMENT_HEALTH:
        info = ELEMENT_HEALTH[deficient_element]
        weak_organs.extend(info['organs'])
        warnings.append(f'{deficient_element}不足：{info["deficiency"]}')

    return {
        'weakOrgans': weak_organs,
        'excessElement': excess_element,
        'deficientElement': deficient_element,
        'warnings': warnings,
    }


def generate_love_insights(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    ten_god_findings: List[Dict],
    guan_sha: Optional[Dict],
) -> Dict:
    """Generate love domain insights."""
    indicators = LOVE_INDICATORS.get(gender, LOVE_INDICATORS['male'])
    spouse_star = indicators['spouse_star']
    romance_star = indicators['romance_star']

    # Check day branch (spouse palace) for Ten God
    day_branch = pillars['day']['branch']
    day_hidden = HIDDEN_STEMS.get(day_branch, [])
    spouse_palace_god = derive_ten_god(day_master_stem, day_hidden[0]) if day_hidden else None

    # Find spouse star positions
    spouse_star_pillars: List[str] = []
    for finding in ten_god_findings:
        if finding['tenGod'] == spouse_star:
            spouse_star_pillars.append(finding['pillar'])

    challenges: List[str] = []
    if guan_sha:
        challenges.append(guan_sha['description'])

    return {
        'spouseStar': spouse_star,
        'romanceStar': romance_star,
        'spousePalaceGod': spouse_palace_god,
        'spouseStarPillars': spouse_star_pillars,
        'challenges': challenges,
    }


# ============================================================
# Conflict Resolution
# ============================================================

def resolve_conflicts(findings: Dict) -> List[Dict]:
    """
    Apply conflict resolution priority hierarchy:
      1. 從格 overrides ALL regular 喜忌 rules
      2. 合絆 overrides Ten God position analysis (locked 用神)
      3. 三合/三會 element boost overrides surface Five Elements balance
      4. 格局 classification wins over individual Ten God positions
      5. 官殺混雜 (female only): domain-scoped override for love
    """
    resolutions: List[Dict] = []

    cong_ge = findings.get('congGe')
    yong_shen_locked = findings.get('yongShenLocked', [])
    guan_sha = findings.get('guanShaHunza')

    if cong_ge:
        resolutions.append({
            'priority': 1,
            'type': 'cong_ge_override',
            'description': f'{cong_ge["name"]}成立，喜忌神完全反轉',
            'effect': '比劫/印 become 忌神, dominant element becomes 用神',
        })

    for locked in yong_shen_locked:
        resolutions.append({
            'priority': 2,
            'type': 'yong_shen_locked',
            'description': locked['description'],
            'effect': 'Positive Ten God position meanings reduced',
        })

    if guan_sha:
        gs_type = guan_sha.get('type', 'guan_sha_hunza')
        if gs_type == 'guan_sha_hunza':
            effect = 'Love domain: overrides positive 正官/偏官 position interpretations'
        elif gs_type == 'lu_guan_cang_sha':
            effect = 'Love domain: 偏官 interpretations softened; 正官 primary'
        elif gs_type == 'lu_sha_cang_guan':
            effect = 'Love domain: 正官 interpretations softened; 七殺 primary'
        else:
            effect = 'Love domain: 官殺 balance adjusts tenGod interpretations'
        resolutions.append({
            'priority': 5,
            'type': gs_type,
            'description': guan_sha['description'],
            'effect': effect,
            'domains': ['love'],
        })

    return resolutions


# ============================================================
# Main Orchestrator
# ============================================================

def generate_pre_analysis(
    pillars: Dict,
    day_master_stem: str,
    five_elements_balance: Dict[str, float],
    favorable_gods: Dict[str, str],
    reading_type: str = 'LIFETIME',
    gender: str = 'male',
    timing_insights: Optional[Dict] = None,
    special_day_pillars: Optional[List[Dict]] = None,
    five_elements_balance_seasonal: Optional[Dict[str, float]] = None,
    strength_v2: Optional[Dict] = None,
) -> Dict:
    """
    Generate the complete pre-analysis for a Bazi chart.

    This is the main entry point for the pre-analysis layer.

    Args:
        pillars: Four pillars dict with stems, branches, and ten god labels
        day_master_stem: Day Master stem
        five_elements_balance: Raw Five Elements balance (for check_cong_ge analytics)
        favorable_gods: Favorable gods from determine_favorable_gods()
        reading_type: NestJS reading type enum string
        gender: 'male' or 'female'
        timing_insights: Timing analysis from timing_analysis.py (Phase 11D)
        special_day_pillars: Special day pillar findings (Phase 11D)
        five_elements_balance_seasonal: Seasonally-adjusted balance (for health display).
            Falls back to raw balance if not provided (backward compat).
        strength_v2: Pre-computed V2 strength result from calculate_strength_score_v2().
            Falls back to computing internally if not provided.

    Returns:
        Complete pre-analysis dict (versioned, domain-filtered)
    """
    domains = READING_TYPE_DOMAINS.get(reading_type, ['career', 'love', 'health', 'timing'])

    # Day Master Strength V2 — use pre-computed if provided, else compute
    if strength_v2 is None:
        strength_v2 = calculate_strength_score_v2(pillars, day_master_stem)

    # Stem analysis
    stem_analysis = analyze_stem_relationships(pillars, day_master_stem)

    # Branch analysis
    branch_analysis = analyze_branch_relationships(pillars)

    # 從格 detection — must run BEFORE using favorable_gods
    cong_ge = check_cong_ge(pillars, day_master_stem, strength_v2, five_elements_balance)

    # Phase 12d Pattern 3a: 從強/從旺/一行得氣 detector (FLAG-OFF default).
    # Distinct from check_cong_ge (從弱 family) — fires on overwhelmingly
    # strong DMs that follow the 比劫+印 trend.
    if cong_ge is None and _PATTERN_3A_CONG_QIANG_DETECTOR:
        from .ten_gods import compute_weighted_category_scores
        scores = compute_weighted_category_scores(pillars, day_master_stem)
        cong_ge = check_cong_qiang_or_wang(
            pillars, day_master_stem, strength_v2,
            scores['categories'], scores['category_transparent_count'])

    # If 從格 detected (either family), override favorable gods
    effective_gods = favorable_gods
    if cong_ge:
        if cong_ge.get('dmAsYongShen', False):
            # 從強/從旺 family (Pattern 3a): DM is 用神, distinct 喜神.
            # All 5 gods are distinct by construction.
            effective_gods = {
                'usefulGod':    cong_ge['yongShen'],
                'favorableGod': cong_ge.get(
                    'xiShen', ELEMENT_PRODUCES[cong_ge['yongShen']]),
                'idleGod':      cong_ge.get(
                    'idleGod', ELEMENT_PRODUCES[cong_ge['yongShen']]),
                'tabooGod':     cong_ge['jiShen'][0],
                'enemyGod':     (cong_ge['jiShen'][1]
                                 if len(cong_ge['jiShen']) > 1
                                 else cong_ge['jiShen'][0]),
            }
            # N2 fix (v2.1): invariant ONLY for 從強/從旺 family.
            _assert_five_gods_distinct(effective_gods)
        else:
            # 從弱 family preserves legacy 4-distinct shape
            # (usefulGod == favorableGod by doctrine — 用神=喜神=順從元素).
            # The 5-god distinctness invariant does NOT apply here.
            dm_element = STEM_ELEMENT[day_master_stem]
            producing_element = ELEMENT_PRODUCED_BY[dm_element]
            effective_gods = {
                'favorableGod': cong_ge['yongShen'],
                'usefulGod': cong_ge['yongShen'],
                'idleGod': ELEMENT_PRODUCES[cong_ge['yongShen']],
                'tabooGod': dm_element,
                'enemyGod': producing_element,
            }

    # Ten God position analysis
    ten_god_findings = generate_ten_god_position_analysis(pillars, day_master_stem, gender)

    # 透干 analysis
    tougan_findings = generate_tougan_analysis(pillars, day_master_stem)

    # 官殺混雜
    guan_sha = check_guan_sha_hunza(pillars, day_master_stem, gender)

    # 用神合絆
    yong_shen_locked = check_yong_shen_locked(
        pillars, effective_gods, stem_analysis['combinations']
    )

    # 墓庫 analysis
    tomb_storage = analyze_tomb_storage(pillars)

    # Prominent Ten God (格局)
    prominent_god = get_prominent_ten_god(pillars, day_master_stem)

    # Build key findings
    key_findings: List[Dict] = []

    # Strength finding
    key_findings.append({
        'category': 'strength',
        'finding': f'日主{STEM_ELEMENT[day_master_stem]}（{day_master_stem}），{strength_v2["classification"]}（{strength_v2["score"]}分）',
        'significance': 'high',
        'domains': ['career', 'love', 'health', 'timing'],
    })

    # 從格 finding
    if cong_ge:
        key_findings.append({
            'category': 'pattern',
            'finding': f'{cong_ge["name"]}：{cong_ge["description"]}',
            'significance': 'critical',
            'domains': ['career', 'love', 'health', 'timing'],
        })

    # Stem combination findings
    for combo in stem_analysis['combinations']:
        key_findings.append({
            'category': 'stem',
            'finding': combo['description'],
            'significance': combo['significance'],
            'domains': ['career', 'love'] if combo['dayMasterInvolved'] else ['career'],
        })

    # Branch relationship findings (significant ones only)
    if branch_analysis['threeMeetings']:
        for meeting in branch_analysis['threeMeetings']:
            key_findings.append({
                'category': 'branch',
                'finding': meeting['description'],
                'significance': 'high',
                'domains': ['career', 'love', 'health', 'timing'],
            })
    if branch_analysis['clashes']:
        for clash in branch_analysis['clashes']:
            key_findings.append({
                'category': 'branch',
                'finding': f'{clash["description"]}（{clash.get("pillarEffect", "")}）',
                'significance': 'high',
                'domains': ['career', 'love', 'health', 'timing'],
            })

    # 官殺混雜 finding
    if guan_sha:
        key_findings.append({
            'category': 'pattern',
            'finding': guan_sha['description'],
            'significance': 'high',
            'domains': guan_sha['domains'],
        })

    # 用神合絆 finding
    for locked in yong_shen_locked:
        key_findings.append({
            'category': 'stem',
            'finding': locked['description'],
            'significance': 'high',
            'domains': ['career', 'love', 'health'],
        })

    # Special day pillar findings (Phase 11D)
    if special_day_pillars:
        for sdp in special_day_pillars:
            key_findings.append({
                'category': 'special_day',
                'finding': f'{sdp["name"]}：{sdp["meaning"]}',
                'significance': 'high',
                'domains': ['career', 'love', 'health', 'timing'],
                'detail': sdp.get('effect', ''),
            })

    # Timing findings (Phase 11D)
    if timing_insights:
        for tf in timing_insights.get('significantFindings', []):
            key_findings.append({
                'category': 'timing',
                'finding': tf['description'],
                'significance': 'high' if tf.get('severity') in ('HIGH', 'VERY_HIGH') else 'critical',
                'domains': ['timing'],
            })

    # Conflict resolution
    all_findings = {
        'congGe': cong_ge,
        'yongShenLocked': yong_shen_locked,
        'guanShaHunza': guan_sha,
    }
    conflict_resolutions = resolve_conflicts(all_findings)

    # Build result
    result: Dict[str, Any] = {
        'version': '1.0.0',
        'summary': _build_summary(
            day_master_stem, strength_v2, prominent_god, cong_ge,
        ),
        'keyFindings': key_findings,
        'strengthV2': strength_v2,
        'pillarRelationships': {
            'stemCombinations': stem_analysis['combinations'],
            'stemClashes': stem_analysis['clashes'],
            'stemInteractions': stem_analysis['interactions'],
            'branchRelationships': branch_analysis,
        },
        'tenGodPositionAnalysis': ten_god_findings,
        'touganAnalysis': tougan_findings,
        'tombStorage': tomb_storage,
        'prominentGod': prominent_god,
        'effectiveFavorableGods': effective_gods,
        'congGe': cong_ge,
        'guanShaHunza': guan_sha,
        'yongShenLocked': yong_shen_locked,
        'conflictResolution': conflict_resolutions,
        # Phase 11D: Timing + special day pillars
        'timingInsights': timing_insights or {},
        'specialDayPillars': special_day_pillars or [],
    }

    # Domain-specific insights
    if 'career' in domains:
        result['careerInsights'] = generate_career_insights(
            effective_gods, prominent_god, strength_v2['classification'],
        )

    if 'love' in domains:
        result['loveInsights'] = generate_love_insights(
            pillars, day_master_stem, gender, ten_god_findings, guan_sha,
        )

    if 'health' in domains:
        # Use seasonal balance for health display (matches reference sites),
        # fall back to raw if seasonal not provided (backward compatibility)
        health_balance = five_elements_balance_seasonal or five_elements_balance
        result['healthInsights'] = generate_health_insights(
            health_balance, STEM_ELEMENT[day_master_stem],
        )

    return result


def _build_summary(
    day_master_stem: str,
    strength_v2: Dict,
    prominent_god: str,
    cong_ge: Optional[Dict],
) -> str:
    """Build a one-line chart summary."""
    dm_element = STEM_ELEMENT[day_master_stem]
    dm_yinyang = STEM_YINYANG[day_master_stem]

    parts = [f'{dm_yinyang}{dm_element}日主（{day_master_stem}）']

    if cong_ge:
        parts.append(cong_ge['name'])
    else:
        strength_zh = {
            'very_strong': '極旺', 'strong': '偏強',
            'neutral': '中和', 'weak': '偏弱', 'very_weak': '極弱',
        }
        parts.append(strength_zh.get(strength_v2['classification'], ''))
        parts.append(f'{prominent_god}格')

    return '，'.join(parts)
