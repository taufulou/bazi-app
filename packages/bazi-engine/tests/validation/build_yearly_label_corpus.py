"""
Phase 3.x Yearly Fortune — Calibration corpus builder.

Mirrors `build_monthly_label_corpus.py` for the YEAR scope. For each
(anchor_chart × flow_year) row, captures:

- The engine's structural output: year pillar (干支), ten god vs DM,
  auspiciousness label, energy score, 4 dimension scores + ★ star ratings
  (career/finance/romance/health — NO travel; 感情=romance NOT 人際關係)
- The 核心風險&機會 month names (top-3 opportunity + top-3 risk) + flatYear flag
  — these are the evidence the Bazi-master sub-agent uses to grade the row
- The 用神 element (from luckMethods card-0 flavor) — lets the grader verify
  the year's 流年 干支 vs 用神 alignment (the load-bearing 年運 doctrine input)

Expected columns (`expected_overall_label`, `expected_dim_overall_match`,
`doctrinal_split`, `reasoning`, `citation`) are left BLANK by this builder.
They are filled in by a Bazi-master sub-agent grading pass and the resulting
CSV is committed.

Usage:
    cd packages/bazi-engine && source .venv/bin/activate
    python tests/validation/build_yearly_label_corpus.py

Idempotent — re-running overwrites the engine columns but PRESERVES filled
expert columns (see `_merge_existing`).

Plan reference: `/Users/roger/.claude/plans/ok-next-big-feature-merry-cake.md`
  search «Yearly calibration corpus» (Phase 3.x follow-up after L3.5c).
"""

from __future__ import annotations

import csv
import os
import sys
from typing import Any, Dict, List

# Make app importable when run from package root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.yearly_enhanced import compute_year_by_year  # noqa: E402

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'yearly_label_corpus.csv',
)


# ============================================================
# Anchor charts — birth-data inputs to compute_year_by_year
# (mirrors monthly corpus anchors + adds Jenna 2021-child for chart diversity:
#  a distinct DM/用神 path beyond the two adult anchors)
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

# Jenna — 2021-09-28 child chart (distinct DM/用神 from the two adults).
# Adds 用神 diversity so the corpus isn't only 火 (Roger) + 水 (Laopo).
JENNA_INPUTS = {
    'birth_date': '2021-09-28',
    'birth_time': '17:07',
    'birth_city': '吉隆坡',
    'birth_timezone': 'Asia/Kuala_Lumpur',
    'gender': 'female',
}

ANCHORS = {
    'roger': ROGER_INPUTS,
    'laopo': LAOPO_INPUTS,
    'jenna': JENNA_INPUTS,
}


# ============================================================
# Year range — 7 flow years (2024..2030) exercises a spread of 流年 干支
# against each chart's 用神 (the core 年運 input variable):
#   2024 甲辰 · 2025 乙巳 · 2026 丙午 · 2027 丁未 · 2028 戊申 ·
#   2029 己酉 · 2030 庚戌
# This sweeps 用神-favorable years (e.g. 丙午/丁未 for Roger 用神火) AND
# 用神-adverse years (e.g. 庚戌/戊申 metal/earth) → the verdict should swing
# 大吉↔凶 across the range, giving the grader real signal to calibrate against.
# YEAR maps DIRECTLY to the 立春-anchored flow year (no cross-flow-year
# complexity like month's Jan/Feb), so flow_year == target_year.
#
# 3 charts × 7 years = 21 rows total.

YEARS = list(range(2024, 2031))  # 2024..2030


# ============================================================
# Row shape — column order is the CSV schema (mirrors monthly, YEAR-adapted)
# ============================================================

ENGINE_COLUMNS = [
    'chart_id',
    'target_year',
    'year_stem',
    'year_branch',
    'year_ganzhi',
    'year_ten_god',
    'useful_god',          # 用神 element (from luckMethods card-0) — grader's key doctrine input
    'auspiciousness',
    'energy_score',
    'career_score',
    'career_label',
    'career_stars',
    'finance_score',
    'finance_label',
    'finance_stars',
    'romance_score',
    'romance_label',
    'romance_stars',
    'health_score',
    'health_label',
    'health_stars',
    'opportunity_months',  # top-3 機會 months e.g. "9月|3月|5月"
    'risk_months',         # top-3 風險 months e.g. "1月|2月|10月"
    'flat_year',           # bool — true when no significant 起伏
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

def _months(entries: List[Dict[str, Any]]) -> str:
    """Render coreRiskOpportunity month entries as `9月|3月|5月`."""
    out = []
    for e in entries or []:
        label = e.get('monthLabel') or (f"{e.get('month')}月" if e.get('month') else '')
        if label:
            out.append(label)
    return '|'.join(out)


def build_row(chart_id: str, year: int) -> Dict[str, str]:
    inputs = ANCHORS[chart_id]
    result = compute_year_by_year(
        birth_date=inputs['birth_date'],
        birth_time=inputs['birth_time'],
        birth_city=inputs['birth_city'],
        birth_timezone=inputs['birth_timezone'],
        gender=inputs['gender'],
        year=year,
    )

    dims = result.get('dimensions', {})
    career = dims.get('career', {})
    finance = dims.get('finance', {})
    romance = dims.get('romance', {})
    health = dims.get('health', {})

    cro = result.get('coreRiskOpportunity', {})
    # 用神 element: prefer luckMethods card-0 flavor; fall back to flowYear-free
    useful_god = ''
    lm = result.get('luckMethods', {})
    cards = lm.get('cards', []) if isinstance(lm, dict) else []
    if cards and isinstance(cards[0], dict):
        useful_god = cards[0].get('usefulGodElement', '') or ''

    return {
        'chart_id': chart_id,
        'target_year': str(year),
        'year_stem': result.get('yearStem', ''),
        'year_branch': result.get('yearBranch', ''),
        'year_ganzhi': result.get('yearGanZhi', ''),
        'year_ten_god': result.get('yearTenGod', ''),
        'useful_god': useful_god,
        'auspiciousness': result.get('auspiciousness', ''),
        'energy_score': str(result.get('energyScore', '')),
        'career_score': str(career.get('score', '')),
        'career_label': career.get('label', ''),
        'career_stars': str(career.get('stars', '')),
        'finance_score': str(finance.get('score', '')),
        'finance_label': finance.get('label', ''),
        'finance_stars': str(finance.get('stars', '')),
        'romance_score': str(romance.get('score', '')),
        'romance_label': romance.get('label', ''),
        'romance_stars': str(romance.get('stars', '')),
        'health_score': str(health.get('score', '')),
        'health_label': health.get('label', ''),
        'health_stars': str(health.get('stars', '')),
        'opportunity_months': _months(cro.get('opportunities', [])),
        'risk_months': _months(cro.get('risks', [])),
        'flat_year': str(cro.get('flatYear', '')),
        # Expert columns — left blank for sub-agent grading pass
        'expected_overall_label': '',
        'expected_dim_overall_match': '',
        'doctrinal_split': '',
        'reasoning': '',
        'citation': '',
    }


def _merge_existing(new_rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Preserve filled expert columns from existing CSV (idempotent re-run)."""
    if not os.path.exists(CORPUS_PATH):
        return new_rows

    with open(CORPUS_PATH, encoding='utf-8') as fh:
        existing = {
            (r['chart_id'], r['target_year']): r
            for r in csv.DictReader(fh)
        }

    for row in new_rows:
        key = (row['chart_id'], row['target_year'])
        if key in existing:
            for col in EXPERT_COLUMNS:
                existing_val = existing[key].get(col, '').strip()
                if existing_val:
                    row[col] = existing_val
    return new_rows


def main() -> int:
    print('Building yearly fortune corpus...')
    print(f'  Anchors: {", ".join(ANCHORS.keys())}')
    print(f'  Years: {YEARS[0]} → {YEARS[-1]}')

    rows: List[Dict[str, str]] = []
    for year in YEARS:
        for chart_id in ANCHORS.keys():
            try:
                rows.append(build_row(chart_id, year))
            except Exception as e:
                print(f'  WARN: failed {chart_id} {year}: {e}', file=sys.stderr)
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
        ug = chart_rows[0].get('useful_god', '?')
        print(f'  {chart_id} (用神={ug}): {len(chart_rows)} rows ({graded} graded)')

    # Auspiciousness spread (helps grader see the range the engine emits)
    print('\nEngine auspiciousness spread:')
    spread: Dict[str, int] = {}
    for row in rows:
        spread[row['auspiciousness']] = spread.get(row['auspiciousness'], 0) + 1
    for label, n in sorted(spread.items(), key=lambda kv: -kv[1]):
        print(f'  {label}: {n}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
