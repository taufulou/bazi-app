"""
Phase 1 Daily Fortune — A3 Debt B (calibration corpus builder).

Generates `daily_label_corpus.csv` from the Phase 1 daily fortune engine.
For each (anchor_chart × date) row, captures:

- The engine's structural output: day pillar, ten god vs DM, auspiciousness
  label, energy score, 5 dimension scores
- The triggered signal NAMES per dimension (without scores) — these are the
  evidence the Bazi-master sub-agent uses to grade the row independently

Expected columns (expected_overall_label, expected_dim_label_*, doctrinal_split,
reasoning, citation) are left BLANK by this builder. They are filled in by a
Bazi-master sub-agent grading pass (see `grade_daily_label_corpus.md`) and
the resulting CSV is committed.

Usage:
    cd packages/bazi-engine && source .venv/bin/activate
    python tests/validation/build_daily_label_corpus.py

This script is idempotent — re-running with the same date range overwrites
the engine columns but PRESERVES the human/sub-agent expected columns IF
the existing CSV has them filled in. (See `_merge_existing` below.)
"""

from __future__ import annotations

import csv
import json
import os
import sys
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

# Make app importable when run from package root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.daily_enhanced import compute_daily_fortune  # noqa: E402

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'daily_label_corpus.csv',
)


# ============================================================
# Anchor charts — match `test_daily_enhanced.py` fixtures exactly
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
# Date selection — 15 days starting from anchor 2026-05-14
# ============================================================
#
# Range chosen to span ±7 days around the canonical Roger anchor
# (2026-05-14 戊子日, 凶中有吉, energy=42).  15 days × 2 charts = 30 rows.
# The natural variation in day-pillar 干支 over 15 days covers all
# Phase 12 Fix A-F doctrine triggers we want to validate (蓋頭/截腳,
# 伏吟, 殺印, 沖庫, 六害, 六合) at organic frequency.

DATE_START = date(2026, 5, 7)
DATE_END = date(2026, 5, 21)


# ============================================================
# Row shape — column order is the CSV schema
# ============================================================

ENGINE_COLUMNS = [
    'chart_id',
    'target_date',
    'day_stem',
    'day_branch',
    'day_ganzhi',
    'day_ten_god',
    'auspiciousness',
    'energy_score',
    'meta_framing',
    'romance_score',
    'romance_label',
    'romance_signals',
    'career_score',
    'career_label',
    'career_signals',
    'finance_score',
    'finance_label',
    'finance_signals',
    'travel_score',
    'travel_label',
    'travel_signals',
    'health_score',
    'health_label',
    'health_signals',
]

EXPERT_COLUMNS = [
    'expected_overall_label',
    'expected_dim_overall_match',
    'doctrinal_split',
    'reasoning',
    'citation',
]

ALL_COLUMNS = ENGINE_COLUMNS + EXPERT_COLUMNS


# ============================================================
# Engine output → row dict
# ============================================================

def _signal_names(dim_output: Dict[str, Any]) -> str:
    """Render dimension signals as `name1|name2|name3` for CSV legibility."""
    signals = dim_output.get('signals', []) or []
    names = []
    for s in signals:
        name = s.get('name') or s.get('type') or ''
        if name:
            names.append(name)
    return '|'.join(names)


def build_row(chart_id: str, target_date: date) -> Dict[str, str]:
    inputs = ANCHORS[chart_id]
    result = compute_daily_fortune(**inputs, target_date=target_date)

    dims = result.get('dimensions', {})
    romance = dims.get('romance', {})
    career = dims.get('career', {})
    finance = dims.get('finance', {})
    travel = dims.get('travel', {})
    health = dims.get('health', {})

    return {
        'chart_id': chart_id,
        'target_date': target_date.isoformat(),
        'day_stem': result.get('dayStem', ''),
        'day_branch': result.get('dayBranch', ''),
        'day_ganzhi': result.get('dayGanZhi', ''),
        'day_ten_god': result.get('dayTenGod', ''),
        'auspiciousness': result.get('auspiciousness', ''),
        'energy_score': str(result.get('energyScore', '')),
        'meta_framing': result.get('metaFraming', ''),
        'romance_score': str(romance.get('score', '')),
        'romance_label': romance.get('label', ''),
        'romance_signals': _signal_names(romance),
        'career_score': str(career.get('score', '')),
        'career_label': career.get('label', ''),
        'career_signals': _signal_names(career),
        'finance_score': str(finance.get('score', '')),
        'finance_label': finance.get('label', ''),
        'finance_signals': _signal_names(finance),
        'travel_score': str(travel.get('score', '')),
        'travel_label': travel.get('label', ''),
        'travel_signals': _signal_names(travel),
        'health_score': str(health.get('score', '')),
        'health_label': health.get('label', ''),
        'health_signals': _signal_names(health),
        # Expert columns — left blank for sub-agent grading pass
        'expected_overall_label': '',
        'expected_dim_overall_match': '',
        'doctrinal_split': '',
        'reasoning': '',
        'citation': '',
    }


def _merge_existing(new_rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Preserve expert columns from existing CSV (if present + non-empty).

    Idempotent re-runs of the builder must NOT clobber a sub-agent's grading.
    We match rows on (chart_id, target_date) and copy over the EXPERT_COLUMNS
    from the existing file when those cells are non-empty.
    """
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
    print(f'Building daily fortune corpus...')
    print(f'  Anchors: {", ".join(ANCHORS.keys())}')
    print(f'  Date range: {DATE_START.isoformat()} → {DATE_END.isoformat()}')

    rows: List[Dict[str, str]] = []
    cur = DATE_START
    while cur <= DATE_END:
        for chart_id in ANCHORS.keys():
            row = build_row(chart_id, cur)
            rows.append(row)
        cur += timedelta(days=1)

    rows = _merge_existing(rows)

    with open(CORPUS_PATH, 'w', encoding='utf-8', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=ALL_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    print(f'Wrote {len(rows)} rows → {CORPUS_PATH}')

    # Summary by chart
    by_chart: Dict[str, List[Dict[str, str]]] = {}
    for row in rows:
        by_chart.setdefault(row['chart_id'], []).append(row)
    for chart_id, chart_rows in by_chart.items():
        graded = sum(1 for r in chart_rows if r.get('expected_overall_label', '').strip())
        print(f'  {chart_id}: {len(chart_rows)} rows ({graded} graded)')

    return 0


if __name__ == '__main__':
    sys.exit(main())
