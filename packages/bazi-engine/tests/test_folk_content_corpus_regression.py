"""
Phase 1.5.z Folk Content — corpus regression lock (pytest hook).

Mirrors test_daily_label_corpus_regression.py pattern. Enforces:
    - Relaxed gate ≥85% (per plan)
    - All 60 rows have expected values populated (no empty grading slots)

Run by CI alongside `test_daily_label_corpus_regression.py`.
"""

from __future__ import annotations

import csv
import os
import subprocess
import sys

import pytest

CORPUS_DIR = os.path.join(os.path.dirname(__file__), 'validation')
CORPUS_PATH = os.path.join(CORPUS_DIR, 'folk_content_corpus.csv')
RUNNER_PATH = os.path.join(CORPUS_DIR, 'run_folk_content_validation.py')

RELAXED_GATE_PCT = 85.0
EXPECTED_ROWS = 60  # Roger + Laopo × 30 days


def _load_corpus():
    if not os.path.exists(CORPUS_PATH):
        pytest.skip(f'corpus not found at {CORPUS_PATH}')
    with open(CORPUS_PATH, encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def test_corpus_has_all_60_rows():
    rows = _load_corpus()
    assert len(rows) == EXPECTED_ROWS, f'expected {EXPECTED_ROWS} rows, got {len(rows)}'


def test_every_row_has_expected_columns_populated():
    rows = _load_corpus()
    required = [
        'expected_color_primary',
        'expected_numbers',
        'expected_food_favor_category',
        'expected_food_avoid_category',
        'expected_hours_branches',
    ]
    for row in rows:
        for col in required:
            assert row.get(col, '').strip(), (
                f'row {row["chart_id"]}@{row["target_date"]}: {col} is empty — '
                f'run populate_folk_content_corpus.py'
            )


def test_relaxed_gate_passes():
    """Run the validator harness in report-only mode and assert exit code 0
    AND parse the «relaxed gate» percentage from output ≥ RELAXED_GATE_PCT."""
    result = subprocess.run(
        [sys.executable, RUNNER_PATH, '--report-only'],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(CORPUS_DIR),
    )
    assert result.returncode == 0, f'validator runner failed: {result.stderr}'
    output = result.stdout
    # Parse the «Relaxed (within tolerance all): N/60 (XX.X%)» line
    relaxed_pct = None
    for line in output.splitlines():
        if 'Relaxed (within tolerance all):' in line:
            # Extract percentage
            import re
            m = re.search(r'\(([\d.]+)%\)', line)
            if m:
                relaxed_pct = float(m.group(1))
                break
    assert relaxed_pct is not None, f'could not parse relaxed gate percent from output:\n{output}'
    assert relaxed_pct >= RELAXED_GATE_PCT, (
        f'relaxed gate {relaxed_pct:.1f}% < {RELAXED_GATE_PCT}% — '
        f'engine output diverged from research-locked expected values. '
        f'Review folk_content.py + research artifacts before bumping gate.'
    )


def test_all_12_day_branches_exercised():
    """Property test — corpus must cover all 12 day-branches to validate
    the full algorithm input space (6 canonical rosters × 2 charts)."""
    rows = _load_corpus()
    day_branches = set()
    for row in rows:
        ganzhi = row.get('day_ganzhi', '')
        if len(ganzhi) >= 2:
            day_branches.add(ganzhi[1])
    assert len(day_branches) == 12, (
        f'expected all 12 day-branches in corpus, got {len(day_branches)}: {sorted(day_branches)}'
    )
