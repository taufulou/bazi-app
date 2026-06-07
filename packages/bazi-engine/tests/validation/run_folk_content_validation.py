"""
Phase 1.5.z Folk Content — corpus validation harness.

Gates the engine output against the expected values populated by
`populate_folk_content_corpus.py`. Mirrors `run_daily_label_validation.py`
strict + relaxed gate methodology.

Strict gate (reported, not enforced):
    - color exact match (engine.primary == expected.primary)
    - numbers exact set match
    - food favor: keyword from expected appears in engine category string
    - food avoid: 剋 chain (e.g. «金剋木») appears in engine category string
    - hours: branch-set exact match

Relaxed gate (CI-enforced ≥85% per plan):
    - color: synset family match (青 ≡ 綠, 黃 ≡ 褐, 白 ≡ 金, 黑 ≡ 藍)
    - numbers: set-intersection ≥1
    - food favor: keyword substring match (same as strict here)
    - food avoid: 剋 chain substring (same as strict here)
    - hours: branch-set match ≥(N-1) where N = expected count (6)

Usage:
    cd packages/bazi-engine && source .venv/bin/activate
    python tests/validation/run_folk_content_validation.py [--report-only]
"""

from __future__ import annotations

import csv
import os
import sys
from typing import Any, Dict, List, Tuple

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'folk_content_corpus.csv',
)

# Color synonym sets — relaxed gate
COLOR_SYNSET: List[set[str]] = [
    {'青', '綠'},
    {'紅', '赤', '紫'},
    {'黃', '褐'},
    {'白', '金', '銀白'},
    {'黑', '藍', '玄', '靛'},
]


def _color_in_synset(a: str, b: str) -> bool:
    """True if a and b are in the same synset OR exact match."""
    if a == b:
        return True
    for syn in COLOR_SYNSET:
        if a in syn and b in syn:
            return True
    return False


def _parse_set(csv_str: str) -> set[str]:
    return {x.strip() for x in csv_str.split('|') if x.strip()}


def check_row(row: Dict[str, str]) -> Tuple[Dict[str, bool], Dict[str, bool]]:
    """Return (strict_results, relaxed_results) per field."""
    # Engine values
    eng_color = row['lucky_color_primary']
    eng_numbers = _parse_set(row['lucky_numbers'])
    eng_food_favor = row['lucky_food_favor_category']
    eng_food_avoid = row['lucky_food_avoid_category']
    eng_hours = _parse_set(row['auspicious_hours_branches'])

    # Expected values
    exp_color = row['expected_color_primary']
    exp_numbers = _parse_set(row['expected_numbers'])
    exp_food_favor_kw = row['expected_food_favor_category']
    exp_food_avoid_chain = row['expected_food_avoid_category']
    exp_hours = _parse_set(row['expected_hours_branches'])

    strict = {
        'color': eng_color == exp_color,
        'numbers': eng_numbers == exp_numbers,
        'food_favor': bool(exp_food_favor_kw) and exp_food_favor_kw in eng_food_favor,
        'food_avoid': bool(exp_food_avoid_chain) and exp_food_avoid_chain in eng_food_avoid,
        'hours': eng_hours == exp_hours,
    }

    relaxed = {
        'color': _color_in_synset(eng_color, exp_color),
        'numbers': len(eng_numbers & exp_numbers) >= 1,
        'food_favor': bool(exp_food_favor_kw) and exp_food_favor_kw in eng_food_favor,
        'food_avoid': bool(exp_food_avoid_chain) and exp_food_avoid_chain in eng_food_avoid,
        # Relaxed for hours: allow off-by-one (set-intersection ≥ N-1)
        'hours': len(eng_hours & exp_hours) >= max(1, len(exp_hours) - 1),
    }

    return strict, relaxed


def run_validation(report_only: bool = False) -> int:
    if not os.path.exists(CORPUS_PATH):
        print(f'Error: corpus not found at {CORPUS_PATH}. Run build + populate first.')
        return 1

    with open(CORPUS_PATH, encoding='utf-8') as fh:
        rows = list(csv.DictReader(fh))

    total = len(rows)
    field_keys = ['color', 'numbers', 'food_favor', 'food_avoid', 'hours']
    strict_pass = {k: 0 for k in field_keys}
    relaxed_pass = {k: 0 for k in field_keys}
    all_strict_pass = 0
    all_relaxed_pass = 0
    failures: List[Tuple[str, Dict[str, Any]]] = []

    for row in rows:
        strict, relaxed = check_row(row)
        for k in field_keys:
            if strict[k]:
                strict_pass[k] += 1
            if relaxed[k]:
                relaxed_pass[k] += 1
        if all(strict.values()):
            all_strict_pass += 1
        if all(relaxed.values()):
            all_relaxed_pass += 1
        else:
            failures.append((row['chart_id'] + '@' + row['target_date'], {
                'engine_color': row['lucky_color_primary'],
                'expected_color': row['expected_color_primary'],
                'engine_hours': row['auspicious_hours_branches'],
                'expected_hours': row['expected_hours_branches'],
                'relaxed_results': relaxed,
            }))

    # Report
    print(f'\n{"="*70}')
    print(f'Phase 1.5.z Folk Content — Corpus Validation Report ({total} rows)')
    print(f'{"="*70}\n')

    print('Per-field pass rates:')
    print(f'{"Field":<15} {"Strict":>10} {"Relaxed":>10}')
    for k in field_keys:
        print(f'  {k:<13} {strict_pass[k]:>5}/{total:<3} ({strict_pass[k] / total * 100:5.1f}%)   '
              f'{relaxed_pass[k]:>5}/{total:<3} ({relaxed_pass[k] / total * 100:5.1f}%)')

    print(f'\nAll-fields pass rates:')
    print(f'  Strict (exact match all fields):  {all_strict_pass}/{total} ({all_strict_pass / total * 100:.1f}%)')
    print(f'  Relaxed (within tolerance all):   {all_relaxed_pass}/{total} ({all_relaxed_pass / total * 100:.1f}%)')

    if failures and len(failures) <= 5:
        print(f'\nFailures:')
        for chart_date, details in failures:
            print(f'  {chart_date}: {details}')
    elif failures:
        print(f'\n{len(failures)} failures (showing first 3):')
        for chart_date, details in failures[:3]:
            print(f'  {chart_date}: {details}')

    relaxed_pct = all_relaxed_pass / total * 100
    GATE = 85.0
    print(f'\n{"="*70}')
    if relaxed_pct >= GATE:
        print(f'✅ PASS — relaxed gate {relaxed_pct:.1f}% ≥ {GATE}%')
        return 0
    print(f'❌ FAIL — relaxed gate {relaxed_pct:.1f}% < {GATE}%')
    return 0 if report_only else 1


def main() -> int:
    report_only = '--report-only' in sys.argv
    return run_validation(report_only=report_only)


if __name__ == '__main__':
    raise SystemExit(main())
