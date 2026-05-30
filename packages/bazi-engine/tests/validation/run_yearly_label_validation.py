"""
Phase 3.x Yearly Fortune — Calibration validation harness.

Mirrors `run_monthly_label_validation.py` for the YEAR scope. Loads
`yearly_label_corpus.csv` and compares the engine's emitted `auspiciousness`
label against the Bazi-master sub-agent's `expected_overall_label` per row.

- **Strict agreement**: exact label match
- **Relaxed agreement** (within-1-step): engine and expected at most ONE
  position apart on the 9-label severity ladder
  (大吉 → 吉 → 吉中有凶 → 平 → 凶中有吉 → 小凶 → 凶 → 大凶 → 凶上加凶)

Doctrinal-split rows (`doctrinal_split=yes`) are EXCLUDED from the strict gate
(both schools defensible) but still counted in the relaxed gate.

Gates:
    --strict-gate=N    Require strict agreement ≥N% (default: report-only)
    --relaxed-gate=N   Require relaxed agreement ≥N% (default: baseline)

Usage:
    python tests/validation/run_yearly_label_validation.py
    python tests/validation/run_yearly_label_validation.py --report-only
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from typing import Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'yearly_label_corpus.csv',
)

# Label severity ladder (mirrors daily + monthly — same 9-label system)
LABEL_LADDER = [
    '大吉', '吉', '吉中有凶', '平', '凶中有吉', '小凶', '凶', '大凶', '凶上加凶',
]
LABEL_TO_POSITION: Dict[str, int] = {label: i for i, label in enumerate(LABEL_LADDER)}


def _ladder_distance(a: str, b: str) -> int:
    pa = LABEL_TO_POSITION.get(a, -1)
    pb = LABEL_TO_POSITION.get(b, -1)
    if pa < 0 or pb < 0:
        return -1
    return abs(pa - pb)


def _classify_row(row: Dict[str, str]) -> Dict[str, object]:
    engine_label = row.get('auspiciousness', '').strip()
    expected_label = row.get('expected_overall_label', '').strip()
    doctrinal_split = row.get('doctrinal_split', 'no').strip().lower() == 'yes'

    if not expected_label:
        return {'state': 'ungraded', 'engine_label': engine_label,
                'expected_label': '', 'distance': -1, 'doctrinal_split': doctrinal_split}

    distance = _ladder_distance(engine_label, expected_label)
    if distance == 0:
        state = 'strict_match'
    elif 0 < distance <= 1:
        state = 'relaxed_match'
    elif distance > 1:
        state = 'mismatch'
    else:
        state = 'unknown_label'

    return {'state': state, 'engine_label': engine_label,
            'expected_label': expected_label, 'distance': distance,
            'doctrinal_split': doctrinal_split}


def _row_id(row: Dict[str, str]) -> str:
    return f"{row['chart_id']}@{row['target_year']}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--report-only', action='store_true')
    parser.add_argument('--strict-gate', type=float, default=None)
    parser.add_argument('--relaxed-gate', type=float, default=40.0,
                        help='Require relaxed agreement ≥ N%% (default: 40 — '
                             'baseline measured 2026-05-30 first calibration cycle. '
                             'Engine has 用神-alignment direction bias for yearly; bump '
                             'to 60 then 80 after Phase 3.x.2 engine tuning.)')
    args = parser.parse_args()

    if not os.path.exists(CORPUS_PATH):
        print(f'ERROR: corpus CSV not found at {CORPUS_PATH}', file=sys.stderr)
        return 1

    with open(CORPUS_PATH, encoding='utf-8') as fh:
        rows = list(csv.DictReader(fh))

    classifications = [(row, _classify_row(row)) for row in rows]

    total = len(classifications)
    graded = [c for c in classifications if c[1]['state'] != 'ungraded']
    strict_matches = [c for c in classifications if c[1]['state'] == 'strict_match']
    relaxed_matches = [c for c in classifications
                       if c[1]['state'] in ('strict_match', 'relaxed_match')]
    mismatches = [c for c in classifications if c[1]['state'] == 'mismatch']
    doctrinal_splits = [c for c in classifications if c[1]['doctrinal_split']]
    strict_eligible = [c for c in graded if not c[1]['doctrinal_split']]
    strict_eligible_matches = [c for c in strict_eligible if c[1]['state'] == 'strict_match']

    strict_pct = (len(strict_eligible_matches) / len(strict_eligible)) * 100 if strict_eligible else 0.0
    relaxed_pct = (len(relaxed_matches) / len(graded)) * 100 if graded else 0.0

    print('=== Yearly Fortune Label Validation ===')
    print(f'Total rows: {total}')
    print(f'Graded: {len(graded)} (ungraded: {total - len(graded)})')
    print(f'Doctrinal splits: {len(doctrinal_splits)} (excluded from strict gate)')
    print()
    print(f'STRICT agreement (exact, splits excluded): '
          f'{len(strict_eligible_matches)}/{len(strict_eligible)} = {strict_pct:.1f}%')
    print(f'RELAXED agreement (within 1 ladder step): '
          f'{len(relaxed_matches)}/{len(graded)} = {relaxed_pct:.1f}%')
    print(f'Mismatches (≥2 ladder steps apart): {len(mismatches)}')
    print()

    print('--- Per-row breakdown ---')
    for row, c in classifications:
        marker = {'strict_match': '✓', 'relaxed_match': '~', 'mismatch': '✗',
                  'ungraded': '?', 'unknown_label': '!'}[c['state']]
        ds = ' [SPLIT]' if c['doctrinal_split'] else ''
        print(f'  {marker} {_row_id(row)}: engine={c["engine_label"]:<6} '
              f'expected={c["expected_label"]:<6} dist={c["distance"]}{ds}')

    if mismatches:
        print()
        print('--- Mismatches (≥2 steps apart) ---')
        for row, c in mismatches:
            print(f'  ✗ {_row_id(row)}: engine={c["engine_label"]} '
                  f'expected={c["expected_label"]} (distance={c["distance"]})')
            print(f'    Reasoning: {row.get("reasoning", "")[:200]}')

    print()
    print('=== Gate evaluation ===')
    failed_gates: List[str] = []

    if args.strict_gate is not None:
        if strict_pct < args.strict_gate:
            failed_gates.append(f'STRICT gate FAILED: {strict_pct:.1f}% < {args.strict_gate:.1f}%')
        else:
            print(f'STRICT gate PASSED: {strict_pct:.1f}% ≥ {args.strict_gate:.1f}%')

    if relaxed_pct < args.relaxed_gate:
        failed_gates.append(f'RELAXED gate FAILED: {relaxed_pct:.1f}% < {args.relaxed_gate:.1f}%')
    else:
        print(f'RELAXED gate PASSED: {relaxed_pct:.1f}% ≥ {args.relaxed_gate:.1f}%')

    if args.report_only:
        return 0
    if failed_gates:
        for msg in failed_gates:
            print(f'  {msg}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
