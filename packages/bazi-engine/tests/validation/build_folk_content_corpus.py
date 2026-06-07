"""
Phase 1.5.z Folk Content — calibration corpus builder.

Generates `folk_content_corpus.csv` from the Phase 1.5.z folk-content engine
(packages/bazi-engine/app/folk_content.py). Mirrors `build_daily_label_corpus.py`
pattern — engine columns auto-populated, expert columns preserved across runs.

Per Phase A Sub-Agent C verdict + research findings:
    - 吉色 / 吉數 / 吉食 (favor + avoid) — chart-level invariant (用神-keyed)
    - 吉時 — per-day (day_branch only — NOT month_branch)
    - 60 rows = Roger + Laopo × 30 days (broader than daily_label's 30 rows to
      cover more day-branch equivalence classes via day-pillar rotation)

The 4 chart-level fields produce identical engine output across all 30 days
per chart. By design — the corpus tests TEMPORAL stability (does the engine
emit consistent values?) + cross-chart 用神 diversity (Roger 用神=火 vs Laopo
用神=水 stress different lookups). The 吉時 column tests per-day algorithm
correctness via natural day-branch rotation.

Per Sub-Agent C audit: grader dedup should collapse the 30 identical
chart-level rows per chart to ~1 grading pass each (2 charts × 4 chart-level
fields ≈ 8 grader passes; 60 grader passes for 吉時). Total ~68 grader
passes not 60×5 = 300. populate_folk_content_corpus.py handles dedup.

Research artifacts: /Users/roger/.claude/plans/fortune-folk-content-research-results.md

Usage:
    cd packages/bazi-engine && source .venv/bin/activate
    python tests/validation/build_folk_content_corpus.py

Idempotent — preserves expert columns across re-runs.
"""

from __future__ import annotations

import csv
import os
import sys
from datetime import date, timedelta
from typing import Any, Dict, List

# Make app importable when run from package root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.daily_enhanced import compute_daily_fortune  # noqa: E402

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'folk_content_corpus.csv',
)


# ============================================================
# Anchor charts — match build_daily_label_corpus.py exactly
# ============================================================

ROGER_INPUTS = {
    'pillars': {
        'year':  {'stem': '丁', 'branch': '卯'},
        'month': {'stem': '戊', 'branch': '申'},
        'day':   {'stem': '戊', 'branch': '午'},
        'hour':  {'stem': '庚', 'branch': '申'},
    },
    'day_master_stem': '戊',
    'effective_gods': {
        'usefulGod': '火',
        'favorableGod': '木',
        'idleGod': '土',
        'tabooGod': '水',
        'enemyGod': '金',
    },
    'useful_god_element': '火',
    'gender': 'male',
    'kong_wang': ['子', '丑'],
    'strength': 'neutral',
    'is_cong_ge': False,
    'flow_year_stem': '丙',
    'flow_year_auspiciousness': '吉',
}

LAOPO_INPUTS = {
    'pillars': {
        'year':  {'stem': '丙', 'branch': '寅'},
        'month': {'stem': '辛', 'branch': '丑'},
        'day':   {'stem': '甲', 'branch': '戌'},
        'hour':  {'stem': '壬', 'branch': '申'},
    },
    'day_master_stem': '甲',
    'effective_gods': {
        'usefulGod': '水',
        'favorableGod': '木',
        'idleGod': '火',
        'tabooGod': '金',
        'enemyGod': '土',
    },
    'useful_god_element': '水',
    'gender': 'female',
    'kong_wang': ['申', '酉'],
    'strength': 'very_weak',
    'is_cong_ge': False,
    'flow_year_stem': '丙',
    'flow_year_auspiciousness': '吉',
}

ANCHORS = {
    'roger': ROGER_INPUTS,
    'laopo': LAOPO_INPUTS,
}


# ============================================================
# Date selection — 30 days starting from anchor 2026-05-07
# ============================================================
#
# Extends daily_label's 15-day window to 30 days (Roger + Laopo × 30 = 60 rows
# per Phase A Sub-Agent C corpus-size verdict). 30 days covers the natural
# day-branch rotation (every day-branch ≥ 2× per chart) so 吉時 algorithm
# correctness is exercised against all 6 canonical rosters multiple times.

DATE_START = date(2026, 5, 7)
DATE_END = date(2026, 6, 5)  # 30 days inclusive


# ============================================================
# Row shape — column order is the CSV schema
# ============================================================

ENGINE_COLUMNS = [
    'chart_id',
    'target_date',
    'day_ganzhi',
    'useful_god_element',
    # Folk content engine output (1 row per (chart, date))
    'wealth_direction',
    'lucky_color_primary',
    'lucky_color_secondary',
    'lucky_numbers',
    'lucky_food_favor_category',
    'lucky_food_favor_examples',
    'lucky_food_avoid_category',
    'lucky_food_avoid_reason',
    'auspicious_hours_count',
    'auspicious_hours_branches',
    'auspicious_hours_classical_names',
]

EXPERT_COLUMNS = [
    # Per-chart-level (rated once per chart by sub-agent; populator copies across days)
    'expected_color_primary',
    'expected_numbers',
    'expected_food_favor_category',
    'expected_food_avoid_category',
    # Per-day (rated per row)
    'expected_hours_branches',
    # Misc
    'doctrinal_notes',
    'citation',
]

ALL_COLUMNS = ENGINE_COLUMNS + EXPERT_COLUMNS


# ============================================================
# Engine output → row dict
# ============================================================

def _render_examples(food_dict: Dict[str, Any] | None) -> str:
    if not food_dict:
        return ''
    examples = food_dict.get('examples') or []
    return '|'.join(str(x) for x in examples)


def build_row(chart_id: str, target_date: date) -> Dict[str, str]:
    inputs = ANCHORS[chart_id]
    result = compute_daily_fortune(**inputs, target_date=target_date)
    folk = result.get('folkContent') or {}

    wealth = folk.get('wealthDirection') or {}
    color = folk.get('luckyColor') or {}
    number = folk.get('luckyNumber') or {}
    food_favor = folk.get('luckyFoodFavor') or {}
    food_avoid = folk.get('luckyFoodAvoid') or {}
    hours = folk.get('auspiciousHours') or []

    hour_branches = '|'.join(h.get('branch', '') for h in hours)
    hour_names = '|'.join(h.get('classical_name', '') for h in hours)

    return {
        'chart_id': chart_id,
        'target_date': target_date.isoformat(),
        'day_ganzhi': result.get('dayGanZhi', ''),
        'useful_god_element': inputs['useful_god_element'],
        'wealth_direction': wealth.get('direction', ''),
        'lucky_color_primary': color.get('primary', ''),
        'lucky_color_secondary': color.get('secondary', ''),
        'lucky_numbers': '|'.join(str(n) for n in (number.get('numbers') or [])),
        'lucky_food_favor_category': food_favor.get('category', ''),
        'lucky_food_favor_examples': _render_examples(food_favor),
        'lucky_food_avoid_category': food_avoid.get('category', ''),
        'lucky_food_avoid_reason': food_avoid.get('reason', ''),
        'auspicious_hours_count': str(len(hours)),
        'auspicious_hours_branches': hour_branches,
        'auspicious_hours_classical_names': hour_names,
        # Expert columns — left blank for sub-agent grading pass
        'expected_color_primary': '',
        'expected_numbers': '',
        'expected_food_favor_category': '',
        'expected_food_avoid_category': '',
        'expected_hours_branches': '',
        'doctrinal_notes': '',
        'citation': '',
    }


def _merge_existing(new_rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Preserve expert columns from existing CSV (if present + non-empty)."""
    if not os.path.exists(CORPUS_PATH):
        return new_rows

    with open(CORPUS_PATH, encoding='utf-8') as fh:
        existing = {(r['chart_id'], r['target_date']): r for r in csv.DictReader(fh)}

    for row in new_rows:
        key = (row['chart_id'], row['target_date'])
        if key in existing:
            for col in EXPERT_COLUMNS:
                existing_val = existing[key].get(col, '').strip()
                if existing_val:
                    row[col] = existing_val
    return new_rows


def main() -> int:
    print(f'Building Phase 1.5.z folk content corpus...')
    print(f'  Anchors: {", ".join(ANCHORS.keys())}')
    print(f'  Date range: {DATE_START} → {DATE_END} ({(DATE_END - DATE_START).days + 1} days)')

    rows: List[Dict[str, str]] = []
    cur = DATE_START
    while cur <= DATE_END:
        for chart_id in ANCHORS:
            rows.append(build_row(chart_id, cur))
        cur += timedelta(days=1)

    rows = _merge_existing(rows)

    # Sort by (chart_id, target_date) for stable diff
    rows.sort(key=lambda r: (r['chart_id'], r['target_date']))

    with open(CORPUS_PATH, 'w', encoding='utf-8', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=ALL_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    n = len(rows)
    print(f'Wrote {n} rows ({n // 2} per chart) → {CORPUS_PATH}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
