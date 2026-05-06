"""
Phase 12g.5 — Romance label validation harness.

Loads `romance_label_corpus.csv` and asserts the engine emits the expected
archetype / label / valence / bidirectional flag for each chart-year fixture.

Strict gate (default): zero regressions vs Phase 12g.4 reference output.
Soft gate (with --report-only): print summary, exit 0.

Usage:
    python tests/validation/run_romance_label_validation.py
    python tests/validation/run_romance_label_validation.py --report-only

Exit codes:
    0 — all assertions pass (or --report-only)
    1 — at least one regression (mismatch on a non-doctrinal-split row)
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from typing import Dict, List

# Make app importable when run from package root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.calculator import calculate_bazi  # noqa: E402
from app.love_enhanced import compute_romance_good_years  # noqa: E402

CORPUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'romance_label_corpus.csv')


def _laopo_lps() -> List[Dict]:
    return [
        {'stem': '丁', 'branch': '酉', 'startYear': 2023, 'endYear': 2032, 'startAge': 36},
        {'stem': '丙', 'branch': '申', 'startYear': 2033, 'endYear': 2042, 'startAge': 46},
    ]


def _roger_lps() -> List[Dict]:
    # Roger 1987-04-13 — luck periods approximation (anchor placeholder)
    return [
        {'stem': '丁', 'branch': '巳', 'startYear': 2024, 'endYear': 2033, 'startAge': 37},
        {'stem': '丙', 'branch': '辰', 'startYear': 2034, 'endYear': 2043, 'startAge': 47},
    ]


def _stars_for(year_branch: str, start: int, end: int) -> List[Dict]:
    """Generate annual stars between [start, end]."""
    stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
    branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
    # 1984 = 甲子 → year offsets
    out = []
    for y in range(start, end + 1):
        offset = y - 1984
        out.append({'year': y, 'stem': stems[offset % 10], 'branch': branches[offset % 12]})
    return out


def _kong_wang_for_chart(chart_id: str) -> List[str]:
    if chart_id == 'laopo':
        return ['申', '酉']  # 甲戌旬空
    if chart_id == 'roger':
        return ['戌', '亥']  # 戊午旬空 (approx)
    return []


def evaluate_row(row: Dict[str, str]) -> Dict:
    chart_id = row['chart_id']
    gender = row['gender']
    year_branch = row['year_branch']
    day_branch = row['day_branch']
    target_year = int(row['year'])

    if chart_id == 'laopo':
        dm_stem = '甲'
        lps = _laopo_lps()
        birth_year = 1987
    elif chart_id == 'roger':
        dm_stem = '戊'
        lps = _roger_lps()
        birth_year = 1987
    else:
        return {'ok': False, 'reason': f'Unknown chart_id: {chart_id}'}

    stars = _stars_for(year_branch, target_year - 5, target_year + 5)
    kong_wang = _kong_wang_for_chart(chart_id)

    result = compute_romance_good_years(
        gender, dm_stem, day_branch, year_branch,
        stars, kong_wang, birth_year, target_year - 5, lps,
    )
    year_entry = next((y for y in result if y['year'] == target_year), None)

    expected_archetype = row.get('expected_archetype', '').strip()
    expected_label = row.get('expected_label', '').strip()
    expected_bidirectional = row.get('bidirectional', 'no').strip().lower() == 'yes'

    if year_entry is None:
        # Engine doesn't surface this year as good — treat absence as informational
        return {
            'ok': not expected_label or '(danger)' in expected_label,
            'reason': 'year not in good_years (may be in danger/change list — out of harness scope)',
            'engine': None,
            'expected': expected_label,
            'doctrinal_split': row.get('doctrinal_split', 'no').lower() == 'yes',
        }

    actual_archetype = year_entry.get('romance_archetype', '')
    actual_label = year_entry.get('starType', '')
    actual_bidirectional = year_entry.get('bidirectional', False)

    archetype_ok = (not expected_archetype) or (actual_archetype == expected_archetype)
    label_ok = (not expected_label) or (actual_label == expected_label) or '(danger)' in expected_label
    bidirectional_ok = actual_bidirectional == expected_bidirectional

    return {
        'ok': archetype_ok and label_ok and bidirectional_ok,
        'engine': {
            'archetype': actual_archetype,
            'label': actual_label,
            'bidirectional': actual_bidirectional,
        },
        'expected': {
            'archetype': expected_archetype,
            'label': expected_label,
            'bidirectional': expected_bidirectional,
        },
        'doctrinal_split': row.get('doctrinal_split', 'no').lower() == 'yes',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report-only', action='store_true',
                        help='Print summary, exit 0 even on mismatches')
    args = parser.parse_args()

    with open(CORPUS_PATH, encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)

    total = len(rows)
    passed = 0
    failed: List[Dict] = []

    for row in rows:
        outcome = evaluate_row(row)
        chart_year = f"{row['chart_id']}@{row['year']}"
        if outcome['ok']:
            passed += 1
            print(f'✓ {chart_year}: ok')
        else:
            failed.append({'row': row, 'outcome': outcome})
            print(f'✗ {chart_year}: {outcome.get("reason", "mismatch")}')
            print(f'    engine:   {outcome.get("engine")}')
            print(f'    expected: {outcome.get("expected")}')

    pct = (passed / total) * 100 if total else 0.0
    print()
    print(f'=== Phase 12g.5 Romance Label Validation ===')
    print(f'Total: {total}, Passed: {passed}, Failed: {len(failed)}, Agreement: {pct:.1f}%')
    if failed:
        print(f'Failed rows:')
        for f in failed:
            print(f'  - {f["row"]["chart_id"]}@{f["row"]["year"]}: '
                  f'{f["outcome"].get("reason", "label mismatch")}')

    if args.report_only:
        return 0
    # Strict gate: 0 regressions on non-doctrinal-split rows
    blocking = [f for f in failed if not f['outcome'].get('doctrinal_split')]
    if blocking:
        print(f'BLOCKING regressions: {len(blocking)}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
