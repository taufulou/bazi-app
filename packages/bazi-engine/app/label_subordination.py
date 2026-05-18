"""
Label subordination — classical 「提綱」 doctrine cap for daily/monthly fortune.

Phase 1 Fortune Option 2.5 introduces per-day verdict computation that no
longer inherits the monthly headline. The cap chain preserves 子平 doctrine
by clipping the daily verdict to a range allowed by the broader month + year
context. Per Bazi-master research (`/Users/roger/.claude/plans/ok-next-big-feature-merry-cake-agent-af8fce18112437a6b.md`):

  「凶月 contains a 吉日 only as 昙花一现 (fleeting) — daily can vary within
  the month's range but cannot fully escape the month's broader trend.」

Shared module so Phase 2 monthly polish can apply the same cap on its
month-vs-year chain (parallel refactor).

# Architecture

- LABEL_LADDER: 9-label severity ladder (most auspicious → most inauspicious)
- CAP_MATRIX: for each parent label, the (floor, ceiling) range it allows the
  child verdict to occupy.
- apply_subordination_cap: clips a raw label by INTERSECTING month + year caps.

# Loose cap (locked decision per 2026-05-14 user choice)

- 大吉月 floor=凶中有吉; 大凶月 ceiling=平 — preserves day-to-day variety
- Mid-tier months (吉/吉中有凶/平/凶中有吉) unconstrained (full range)
- Same matrix used for both month-level and year-level cap inputs

# Composition rule

When BOTH month and year caps are active, the legal range is the INTERSECTION
of the two ranges. Position-wise:

  intersection_ceiling_pos = max(month_ceiling_pos, year_ceiling_pos)
  intersection_floor_pos   = min(month_floor_pos,   year_floor_pos)

Where higher position = more inauspicious (大吉=0, 凶上加凶=8). The
intersection is non-commutative-safe: caps are computed independently from
each parent's CAP_MATRIX entry, then intersected.
"""

from __future__ import annotations

import logging
from typing import Dict, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 9-label severity ladder
# ============================================================
#
# Matches the full set `_compute_single_month` can emit (base 7 + 小凶 + 凶上加凶).
# Index 0 = most auspicious, index 8 = most inauspicious.

LABEL_LADDER = [
    '大吉',      # 0
    '吉',        # 1
    '吉中有凶',  # 2
    '平',        # 3
    '凶中有吉',  # 4
    '小凶',      # 5
    '凶',        # 6
    '大凶',      # 7
    '凶上加凶',  # 8
]

_LABEL_TO_POS: Dict[str, int] = {label: idx for idx, label in enumerate(LABEL_LADDER)}


# ============================================================
# CAP_MATRIX — for each parent label, (floor, ceiling) it allows
# ============================================================
#
# floor = the most inauspicious label allowed (closest to 凶上加凶 end)
# ceiling = the most auspicious label allowed (closest to 大吉 end)
#
# Loose cap (locked 2026-05-14): mid-tier parents unconstrained, only
# extreme parents (大吉/大凶/凶上加凶) clip the opposite end. 小凶 has a
# moderate ceiling at 吉中有凶 (between mid and extreme).

CAP_MATRIX: Dict[str, Tuple[str, str]] = {
    # parent_label: (floor, ceiling)
    '大吉':     ('凶中有吉', '大吉'),    # floor blocks 凶/大凶/凶上加凶
    '吉':       ('凶',       '大吉'),    # unconstrained on auspicious end
    '吉中有凶': ('凶',       '大吉'),    # mid — wide range
    '平':       ('大凶',     '大吉'),    # fully unconstrained
    '凶中有吉': ('大凶',     '吉'),      # mid — wide range
    '小凶':     ('大凶',     '吉中有凶'),# mild ceiling
    '凶':       ('大凶',     '吉中有凶'),# ceiling blocks 大吉/吉
    '大凶':     ('大凶',     '平'),      # ceiling blocks 大吉/吉/吉中有凶
    '凶上加凶': ('大凶',     '凶中有吉'),# more permissive on ceiling than 大凶
}


def _pos(label: str) -> int:
    """Position on severity ladder (0=大吉, 8=凶上加凶). Raises on unknown."""
    if label not in _LABEL_TO_POS:
        raise ValueError(f'Unknown label: {label!r}. Expected one of {LABEL_LADDER}')
    return _LABEL_TO_POS[label]


def _clamp_position(raw_pos: int, ceiling_pos: int, floor_pos: int) -> int:
    """Clamp raw position to [ceiling_pos, floor_pos] range.

    Note: ceiling_pos ≤ floor_pos (auspicious-end pos number is smaller).
    """
    return max(ceiling_pos, min(floor_pos, raw_pos))


def apply_subordination_cap(
    raw_label: str,
    bare_month_label: str,
    flow_year_label: str,
) -> str:
    """Apply month + year subordination cap to a raw daily label.

    Args:
        raw_label: per-day computed label (BEFORE any cap)
        bare_month_label: the month's own verdict, BEFORE year-combine.
            Use `monthly_result['bareMonthAuspiciousness']` from
            `annual_enhanced._compute_single_month`. Do NOT pass the
            year-combined `auspiciousness` field — that double-counts year.
        flow_year_label: the flow year's own verdict (independent of month).
            Typically supplied by the caller as `flow_year_auspiciousness`.

    Returns:
        The clipped final label. May equal raw_label (no clipping needed).
    """
    # Validate inputs
    if raw_label not in _LABEL_TO_POS:
        logger.warning(f'apply_subordination_cap: unknown raw_label {raw_label!r}, returning unchanged')
        return raw_label
    if bare_month_label not in CAP_MATRIX:
        logger.warning(
            f'apply_subordination_cap: unknown bare_month_label {bare_month_label!r}, '
            f'using fully-permissive cap'
        )
        bare_month_label = '平'
    if flow_year_label not in CAP_MATRIX:
        logger.warning(
            f'apply_subordination_cap: unknown flow_year_label {flow_year_label!r}, '
            f'using fully-permissive cap'
        )
        flow_year_label = '平'

    month_floor_label, month_ceiling_label = CAP_MATRIX[bare_month_label]
    year_floor_label, year_ceiling_label = CAP_MATRIX[flow_year_label]

    month_floor_pos = _pos(month_floor_label)
    month_ceiling_pos = _pos(month_ceiling_label)
    year_floor_pos = _pos(year_floor_label)
    year_ceiling_pos = _pos(year_ceiling_label)

    # Intersection: most restrictive on BOTH ends.
    # Position-wise: ceiling (auspicious end) wants SMALLEST allowed position;
    # the more restrictive of two ceilings is the LARGER number.
    # Floor (inauspicious end) wants LARGEST allowed position; the more
    # restrictive of two floors is the SMALLER number.
    final_ceiling_pos = max(month_ceiling_pos, year_ceiling_pos)
    final_floor_pos = min(month_floor_pos, year_floor_pos)

    # Impossible intersection — defensive fallback
    if final_ceiling_pos > final_floor_pos:
        logger.warning(
            f'Subordination cap impossible: month={bare_month_label} '
            f'(range [{month_ceiling_label},{month_floor_label}]) vs '
            f'year={flow_year_label} (range [{year_ceiling_label},{year_floor_label}]) — '
            f'falling back to month cap only'
        )
        clamped = _clamp_position(_pos(raw_label), month_ceiling_pos, month_floor_pos)
        return LABEL_LADDER[clamped]

    clamped = _clamp_position(_pos(raw_label), final_ceiling_pos, final_floor_pos)
    return LABEL_LADDER[clamped]
