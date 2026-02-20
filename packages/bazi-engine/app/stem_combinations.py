"""
天干合化 (Stem Combinations) + 天干七沖 (Stem Clashes)

Analyzes Heavenly Stem relationships within a single Bazi chart.

天干合化 — 5 combination pairs:
  甲己→土 (中正之合), 乙庚→金 (仁義之合), 丙辛→水 (威制之合),
  丁壬→木 (淫慝之合), 戊癸→火 (無情之合)

天干七沖 — 4 opposition pairs:
  甲庚, 乙辛, 丙壬, 丁癸
  (Same element family, opposite polarity, 7 positions apart on stem cycle)

Design decisions:
  - Default to 合而不化 (combining without transforming). True transformation
    requires strict conditions (adjacent, 月支 support, 天干無根) and is
    controversial across schools. We report the combination and set
    transformed=False by default.
  - When Day Master is one of the combining stems, flag dayMasterInvolved=True
    with significance='high' — critical for love readings (日主被合).
"""

from typing import Dict, List, Optional, Tuple

from .constants import (
    STEM_ELEMENT,
    STEM_YINYANG,
)


# ============================================================
# 天干合化 (Stem Combinations) — 5 pairs
# ============================================================

# Each pair: (stem_a, stem_b) → {element produced, combination name}
# Order within tuple doesn't matter — we check both directions.
STEM_COMBINATION_PAIRS: Dict[Tuple[str, str], Dict[str, str]] = {
    ('甲', '己'): {'element': '土', 'name': '中正之合'},
    ('乙', '庚'): {'element': '金', 'name': '仁義之合'},
    ('丙', '辛'): {'element': '水', 'name': '威制之合'},
    ('丁', '壬'): {'element': '木', 'name': '淫慝之合'},
    ('戊', '癸'): {'element': '火', 'name': '無情之合'},
}

# Quick lookup: given one stem, find its combination partner and result
STEM_COMBINATION_LOOKUP: Dict[str, Tuple[str, str, str]] = {}
for (a, b), info in STEM_COMBINATION_PAIRS.items():
    # stem → (partner, result_element, combination_name)
    STEM_COMBINATION_LOOKUP[a] = (b, info['element'], info['name'])
    STEM_COMBINATION_LOOKUP[b] = (a, info['element'], info['name'])


# ============================================================
# 天干七沖 (Stem Clashes) — 4 opposition pairs
# ============================================================

# Same element, opposite polarity, 7 positions apart in the stem cycle.
# 甲(木陽)↔庚(金陽), 乙(木陰)↔辛(金陰), 丙(火陽)↔壬(水陽), 丁(火陰)↔癸(水陰)
STEM_CLASH_PAIRS: Dict[Tuple[str, str], Dict[str, str]] = {
    ('甲', '庚'): {'elements': '木金', 'description': '甲庚沖'},
    ('乙', '辛'): {'elements': '木金', 'description': '乙辛沖'},
    ('丙', '壬'): {'elements': '火水', 'description': '丙壬沖'},
    ('丁', '癸'): {'elements': '火水', 'description': '丁癸沖'},
}

# Quick lookup: given one stem, find its clash partner
STEM_CLASH_LOOKUP: Dict[str, str] = {}
for (a, b) in STEM_CLASH_PAIRS:
    STEM_CLASH_LOOKUP[a] = b
    STEM_CLASH_LOOKUP[b] = a


# Adjacent pillar pairs (combinations and clashes only count between adjacent pillars)
ADJACENT_PILLAR_PAIRS: List[Tuple[str, str]] = [
    ('year', 'month'),
    ('month', 'day'),
    ('day', 'hour'),
]

# All 6 pillar pairs for clash detection (clashes checked across all pairs)
ALL_PILLAR_PAIRS: List[Tuple[str, str]] = [
    ('year', 'month'),
    ('year', 'day'),
    ('year', 'hour'),
    ('month', 'day'),
    ('month', 'hour'),
    ('day', 'hour'),
]


def find_stem_combinations(
    pillars: Dict[str, Dict],
    day_master_stem: str,
) -> List[Dict]:
    """
    Find all 天干合化 (stem combinations) in a chart.

    Only checks ADJACENT pillar pairs (year↔month, month↔day, day↔hour)
    because stem combinations require physical proximity.

    Args:
        pillars: Four pillars dict with 'year', 'month', 'day', 'hour' keys,
                 each containing at least {'stem': str, 'branch': str}
        day_master_stem: The Day Master (日主) heavenly stem

    Returns:
        List of combination dicts with:
          - stems: tuple of the two combining stems
          - pillarA / pillarB: which pillars are involved
          - resultElement: the element produced (if transformation occurred)
          - name: combination name (e.g. '中正之合')
          - description: human-readable description
          - transformed: bool (always False in v1.0 — 合而不化)
          - dayMasterInvolved: bool
          - significance: 'high' if Day Master involved, else 'medium'
    """
    combinations: List[Dict] = []

    for pillar_a, pillar_b in ADJACENT_PILLAR_PAIRS:
        stem_a = pillars[pillar_a]['stem']
        stem_b = pillars[pillar_b]['stem']

        combo = _check_stem_combination(stem_a, stem_b)
        if combo is None:
            continue

        dm_involved = (stem_a == day_master_stem or stem_b == day_master_stem)

        combinations.append({
            'stems': (stem_a, stem_b),
            'pillarA': pillar_a,
            'pillarB': pillar_b,
            'resultElement': combo['element'],
            'name': combo['name'],
            'description': f'{stem_a}{stem_b}合化{combo["element"]}（合而不化）',
            'transformed': False,  # v1.0: always 合而不化
            'dayMasterInvolved': dm_involved,
            'significance': 'high' if dm_involved else 'medium',
        })

    return combinations


def find_stem_clashes(
    pillars: Dict[str, Dict],
    day_master_stem: str,
) -> List[Dict]:
    """
    Find all 天干七沖 (stem clashes) in a chart.

    Checks ALL 6 pillar pair combinations (not just adjacent),
    because stem clashes operate across the entire chart.

    Args:
        pillars: Four pillars dict
        day_master_stem: The Day Master heavenly stem

    Returns:
        List of clash dicts with:
          - stems: tuple of the two clashing stems
          - pillarA / pillarB: which pillars are involved
          - elements: the element conflict (e.g. '木金')
          - description: human-readable description
          - dayMasterInvolved: bool
          - significance: 'high' if Day Master involved, else 'medium'
    """
    clashes: List[Dict] = []

    for pillar_a, pillar_b in ALL_PILLAR_PAIRS:
        stem_a = pillars[pillar_a]['stem']
        stem_b = pillars[pillar_b]['stem']

        clash = _check_stem_clash(stem_a, stem_b)
        if clash is None:
            continue

        dm_involved = (stem_a == day_master_stem or stem_b == day_master_stem)

        clashes.append({
            'stems': (stem_a, stem_b),
            'pillarA': pillar_a,
            'pillarB': pillar_b,
            'elements': clash['elements'],
            'description': clash['description'],
            'dayMasterInvolved': dm_involved,
            'significance': 'high' if dm_involved else 'medium',
        })

    return clashes


def analyze_stem_relationships(
    pillars: Dict[str, Dict],
    day_master_stem: str,
) -> Dict:
    """
    Complete stem relationship analysis for a chart.

    Finds all combinations and clashes, then checks for
    combination-clash interactions (合 can partially neutralize 沖).

    Returns:
        Dict with:
          - combinations: list of combination results
          - clashes: list of clash results
          - interactions: list of any combination↔clash interactions
          - summary: brief text summary
    """
    combinations = find_stem_combinations(pillars, day_master_stem)
    clashes = find_stem_clashes(pillars, day_master_stem)

    # Check for interactions: if a stem is involved in BOTH a combination
    # and a clash, the combination partially neutralizes the clash
    interactions = _find_combo_clash_interactions(combinations, clashes)

    # Build summary
    summary_parts: List[str] = []
    if combinations:
        combo_descs = [c['description'] for c in combinations]
        summary_parts.append('、'.join(combo_descs))
    if clashes:
        clash_descs = [c['description'] for c in clashes]
        summary_parts.append('、'.join(clash_descs))
    if interactions:
        for interaction in interactions:
            summary_parts.append(interaction['description'])

    return {
        'combinations': combinations,
        'clashes': clashes,
        'interactions': interactions,
        'summary': '；'.join(summary_parts) if summary_parts else '天干無特殊合沖關係',
    }


# ============================================================
# Internal helpers
# ============================================================

def _check_stem_combination(stem_a: str, stem_b: str) -> Optional[Dict[str, str]]:
    """Check if two stems form a combination. Returns combo info or None."""
    key = (stem_a, stem_b)
    if key in STEM_COMBINATION_PAIRS:
        return STEM_COMBINATION_PAIRS[key]
    key_rev = (stem_b, stem_a)
    if key_rev in STEM_COMBINATION_PAIRS:
        return STEM_COMBINATION_PAIRS[key_rev]
    return None


def _check_stem_clash(stem_a: str, stem_b: str) -> Optional[Dict[str, str]]:
    """Check if two stems form a clash. Returns clash info or None."""
    key = (stem_a, stem_b)
    if key in STEM_CLASH_PAIRS:
        return STEM_CLASH_PAIRS[key]
    key_rev = (stem_b, stem_a)
    if key_rev in STEM_CLASH_PAIRS:
        return STEM_CLASH_PAIRS[key_rev]
    return None


def _find_combo_clash_interactions(
    combinations: List[Dict],
    clashes: List[Dict],
) -> List[Dict]:
    """
    Find stems involved in both a combination and a clash.

    When a stem is combined AND clashed, the combination partially
    neutralizes the clash (合解沖 ~50% reduction).
    """
    interactions: List[Dict] = []

    # Build set of stems involved in combinations
    combo_stems = set()
    for combo in combinations:
        combo_stems.add(combo['stems'][0])
        combo_stems.add(combo['stems'][1])

    for clash in clashes:
        clash_stem_a, clash_stem_b = clash['stems']
        involved_in_combo = (clash_stem_a in combo_stems or clash_stem_b in combo_stems)

        if involved_in_combo:
            interactions.append({
                'type': 'combo_neutralizes_clash',
                'clashStems': clash['stems'],
                'description': f'{clash_stem_a}{clash_stem_b}沖受合化牽制，沖力減半',
                'effect': 'clash_reduced_50pct',
            })

    return interactions
