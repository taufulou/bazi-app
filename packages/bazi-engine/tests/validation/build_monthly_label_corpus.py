"""
Phase 2.x.1 Monthly Fortune — Calibration corpus builder.

Mirrors `build_daily_label_corpus.py` for the MONTH scope. For each
(anchor_chart × month) row, captures:

- The engine's structural output: month pillar, ten god vs DM, auspiciousness
  label, energy score, 4 dimension scores (career/finance/romance/health —
  NO travel per Phase 2 locked decision)
- The triggered signal NAMES per dimension (without scores) — these are the
  evidence the Bazi-master sub-agent uses to grade the row independently
- The `flow_year` resolved by cnlunar.lunarYear (CRITICAL for Jan/Feb rows
  that cross 立春 boundary and resolve to PRIOR flow year)

Expected columns (`expected_overall_label`, `expected_dim_overall_match`,
`doctrinal_split`, `reasoning`, `citation`) are left BLANK by this builder.
They are filled in by a Bazi-master sub-agent grading pass (see
`grade_monthly_label_corpus.md` — not yet created) and the resulting CSV is
committed.

Usage:
    cd packages/bazi-engine && source .venv/bin/activate
    python tests/validation/build_monthly_label_corpus.py

This script is idempotent — re-running with the same anchor + month range
overwrites the engine columns but PRESERVES the human/sub-agent expected
columns IF the existing CSV has them filled in. (See `_merge_existing` below.)

Plan reference: `/Users/roger/.claude/plans/ok-next-big-feature-merry-cake.md`
  search «# Phase 2.x.1 — Polish Bundle» Task 4.
"""

from __future__ import annotations

import csv
import os
import sys
from typing import Any, Dict, List

# Make app importable when run from package root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.monthly_enhanced import compute_single_month_by_yearmonth  # noqa: E402

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'monthly_label_corpus.csv',
)


# ============================================================
# Anchor charts — birth-data inputs to compute_single_month_by_yearmonth
# (higher-level entry than compute_daily_fortune; resolves chart internally
# via calculate_bazi_with_all_pipelines)
# ============================================================

ROGER_INPUTS = {
    'birth_date': '1987-09-06',
    'birth_time': '16:11',
    'birth_city': '吉打',
    'birth_timezone': 'Asia/Kuala_Lumpur',
    'gender': 'male',
}

LAOPO_INPUTS = {
    'birth_date': '1987-01-25',
    'birth_time': '12:00',
    'birth_city': '台北',
    'birth_timezone': 'Asia/Taipei',
    'gender': 'female',
}

ANCHORS = {
    'roger': ROGER_INPUTS,
    'laopo': LAOPO_INPUTS,
}


# ============================================================
# Month range — 12 months covering all 12 month-branches + cross-flow-year
# boundary cases (Jan/Feb 2026 cross 立春 and resolve to flow_year=2025)
# ============================================================
#
# 2026-01 through 2026-12 exercises:
# - All 12 month-branches (子..亥) via natural rotation
# - Cross-flow-year handling: 2026-01 typically resolves to flow_year=2025
#   (still 丑月 of 2025 乙巳 year, before 立春 ~Feb 4 2026)
# - 用神/喜神/忌神 interaction across multiple flow-year contexts
# - 24 rows total (2 charts × 12 months)

TARGET_YEAR = 2026
MONTHS = list(range(1, 13))  # 1..12


# ============================================================
# Row shape — column order is the CSV schema (mirrors daily + flow_year)
# ============================================================

ENGINE_COLUMNS = [
    'chart_id',
    'target_year',
    'target_month',
    'month_stem',
    'month_branch',
    'month_ganzhi',
    'month_ten_god',
    'flow_year',          # CRITICAL: populated by cnlunar.lunarYear; Jan/Feb resolve to prior flow year
    'auspiciousness',
    'energy_score',
    'career_score',
    'career_label',
    'career_signals',
    'finance_score',
    'finance_label',
    'finance_signals',
    'romance_score',
    'romance_label',
    'romance_signals',
    'health_score',
    'health_label',
    'health_signals',
]

EXPERT_COLUMNS = [
    'expected_overall_label',
    'expected_dim_overall_match',   # Optional grader boolean — empty = not-evaluated
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
        if isinstance(s, dict):
            name = s.get('name') or s.get('type') or ''
        else:
            name = str(s)
        if name:
            names.append(name)
    return '|'.join(names)


def build_row(chart_id: str, year: int, month: int) -> Dict[str, str]:
    inputs = ANCHORS[chart_id]
    result = compute_single_month_by_yearmonth(
        birth_date=inputs['birth_date'],
        birth_time=inputs['birth_time'],
        birth_city=inputs['birth_city'],
        birth_timezone=inputs['birth_timezone'],
        gender=inputs['gender'],
        year=year,
        month=month,
    )

    dims = result.get('dimensions', {})
    career = dims.get('career', {})
    finance = dims.get('finance', {})
    romance = dims.get('romance', {})
    health = dims.get('health', {})

    month_stem = result.get('monthStem', '') or result.get('stem', '')
    month_branch = result.get('monthBranch', '') or result.get('branch', '')
    # Engine attaches monthGanZhi explicitly at line 489 of monthly_enhanced.py
    month_ganzhi = result.get('monthGanZhi', f'{month_stem}{month_branch}')
    # ten god vs DM — engine fills via _compute_single_month
    month_ten_god = result.get('monthTenGod', '') or result.get('tenGod', '')

    return {
        'chart_id': chart_id,
        'target_year': str(year),
        'target_month': f'{month:02d}',
        'month_stem': month_stem,
        'month_branch': month_branch,
        'month_ganzhi': month_ganzhi,
        'month_ten_god': month_ten_god,
        'flow_year': str(result.get('flowYear', '')),
        'auspiciousness': result.get('auspiciousness', ''),
        'energy_score': str(result.get('energyScore', '')),
        'career_score': str(career.get('score', '')),
        'career_label': career.get('label', ''),
        'career_signals': _signal_names(career),
        'finance_score': str(finance.get('score', '')),
        'finance_label': finance.get('label', ''),
        'finance_signals': _signal_names(finance),
        'romance_score': str(romance.get('score', '')),
        'romance_label': romance.get('label', ''),
        'romance_signals': _signal_names(romance),
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
    We match rows on (chart_id, target_year, target_month) and copy over the
    EXPERT_COLUMNS from the existing file when those cells are non-empty.
    """
    if not os.path.exists(CORPUS_PATH):
        return new_rows

    with open(CORPUS_PATH, encoding='utf-8') as fh:
        existing = {
            (r['chart_id'], r['target_year'], r['target_month']): r
            for r in csv.DictReader(fh)
        }

    for row in new_rows:
        key = (row['chart_id'], row['target_year'], row['target_month'])
        if key in existing:
            for col in EXPERT_COLUMNS:
                existing_val = existing[key].get(col, '').strip()
                if existing_val:
                    row[col] = existing_val
    return new_rows


def main() -> int:
    print(f'Building monthly fortune corpus...')
    print(f'  Anchors: {", ".join(ANCHORS.keys())}')
    print(f'  Months: {TARGET_YEAR}-{MONTHS[0]:02d} → {TARGET_YEAR}-{MONTHS[-1]:02d}')

    rows: List[Dict[str, str]] = []
    for month in MONTHS:
        for chart_id in ANCHORS.keys():
            try:
                row = build_row(chart_id, TARGET_YEAR, month)
                rows.append(row)
            except Exception as e:
                print(f'  WARN: failed {chart_id} {TARGET_YEAR}-{month:02d}: {e}', file=sys.stderr)
                raise

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

    # Flow-year boundary summary (helps grader spot cross-flow-year rows)
    print('\nFlow-year resolution summary:')
    by_flow_year: Dict[str, List[str]] = {}
    for row in rows:
        fy = row.get('flow_year', '?')
        ym = f"{row['chart_id']}@{row['target_year']}-{row['target_month']}"
        by_flow_year.setdefault(fy, []).append(ym)
    for fy in sorted(by_flow_year.keys()):
        examples = by_flow_year[fy]
        print(f'  flow_year={fy}: {len(examples)} rows — {", ".join(examples[:4])}{"..." if len(examples) > 4 else ""}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
