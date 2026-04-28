"""
Fix 1a validation harness scaffold.

This is a placeholder. The canonical 50+ chart CSV
(`expert_labeled_charts.csv`) must be completed with Bazi-master-labeled
expected values before this harness can gate the flag flip.

See `tests/validation/README.md` for the gate criteria and CSV schema.

Until the CSV exists, running this file prints the pinned anchor chart IDs
and exits. This is intentional — we do NOT want to silently "pass" a
validation gate that has no data.
"""

import csv
import os
import sys
from pathlib import Path
from typing import Dict, List

# Canonical anchor chart IDs — zero-disagreement gate applies to these.
# (Polish #2 from v3 staff-engineer review: pinned here as constants, not prose.)
CANONICAL_ANCHOR_CHART_IDS: List[str] = [
    'roger',
    'laopo',
    'ziping_shayin_01',       # 《子平真詮》殺印相生 example
    'ditian_conggeh_01',      # 《滴天髓》從格 boundary
    'ziping_hunza_01',        # 《子平真詮》官殺混雜 anchor
]


def _csv_path() -> Path:
    return Path(__file__).parent / 'expert_labeled_charts.csv'


def main() -> int:
    csv_file = _csv_path()
    if not csv_file.exists():
        print('❌ expert_labeled_charts.csv is NOT present.')
        print('   Fix 1a validation gate CANNOT pass without this file.')
        print()
        print('   Canonical anchor chart IDs required (zero-disagreement gate):')
        for anchor_id in CANONICAL_ANCHOR_CHART_IDS:
            print(f'     - {anchor_id}')
        print()
        print('   See tests/validation/README.md for CSV schema and gate criteria.')
        return 2  # gate not ready

    # When CSV exists, run both modes and print agreement tables.
    from app import five_elements as fe
    from app.five_elements import determine_favorable_gods

    rows: List[Dict[str, str]] = []
    with csv_file.open('r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    for flag_state in (False, True):
        fe._USE_WEIGHTED_IMBALANCE = flag_state
        mode = 'ON ' if flag_state else 'OFF'
        agreements = 0
        anchor_disagreements: List[str] = []
        textbook_disagreements: List[str] = []
        for row in rows:
            # NOTE: actual pillar reconstruction from row['pillars'] string
            # is implementation-specific. This stub iterates row count only.
            pass
        print(f'[flag={mode}] rows={len(rows)} — agreement counting not yet wired.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
