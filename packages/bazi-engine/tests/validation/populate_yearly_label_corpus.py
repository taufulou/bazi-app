"""
Phase 3.x Yearly Fortune — grading merger.

Mirrors `populate_monthly_label_corpus.py`. Merges a Bazi-master sub-agent's
graded expert columns into `yearly_label_corpus.csv`, matching rows on
(chart_id, target_year). Engine columns are NEVER touched; only the 5 expert
columns (`expected_overall_label`, `expected_dim_overall_match`,
`doctrinal_split`, `reasoning`, `citation`) are overwritten from the grading
source.

The sub-agent writes a fully-graded CSV (same header) to a scratch path; this
script copies its expert columns onto the committed corpus. (For the initial
2026-05-30 grading cycle the grader wrote the complete CSV directly, so this
script is primarily for FUTURE re-grading passes — e.g. after engine tuning,
re-run the builder to refresh engine columns, then re-grade + merge.)

Usage:
    python tests/validation/populate_yearly_label_corpus.py <graded_csv_path>
"""

from __future__ import annotations

import csv
import os
import sys
from typing import Dict, List

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'yearly_label_corpus.csv',
)

EXPERT_COLUMNS = [
    'expected_overall_label',
    'expected_dim_overall_match',
    'doctrinal_split',
    'reasoning',
    'citation',
]


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: populate_yearly_label_corpus.py <graded_csv_path>', file=sys.stderr)
        return 1
    graded_path = sys.argv[1]
    if not os.path.exists(graded_path):
        print(f'ERROR: graded CSV not found: {graded_path}', file=sys.stderr)
        return 1
    if not os.path.exists(CORPUS_PATH):
        print(f'ERROR: corpus not found: {CORPUS_PATH}', file=sys.stderr)
        return 1

    with open(graded_path, encoding='utf-8') as fh:
        graded = {
            (r['chart_id'], r['target_year']): r
            for r in csv.DictReader(fh)
        }

    with open(CORPUS_PATH, encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        rows: List[Dict[str, str]] = list(reader)

    merged = 0
    for row in rows:
        key = (row['chart_id'], row['target_year'])
        if key in graded:
            for col in EXPERT_COLUMNS:
                val = graded[key].get(col, '').strip()
                if val:
                    row[col] = val
                    merged += 1

    with open(CORPUS_PATH, 'w', encoding='utf-8', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    graded_rows = sum(1 for r in rows if r.get('expected_overall_label', '').strip())
    print(f'Merged grading into {CORPUS_PATH}')
    print(f'  {graded_rows}/{len(rows)} rows now have expected_overall_label')
    return 0


if __name__ == '__main__':
    sys.exit(main())
