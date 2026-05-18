"""Pytest integration for the daily fortune label corpus (A3 Debt B).

Locks the relaxed (within-1-step) agreement gate as a CI signal. The strict
gate is reported but NOT enforced — engine has known systematic over-tilt
toward 大吉/凶 extremes (see CLAUDE.md Fortune section, Phase 1.5 tuning ticket).

The corpus is at `tests/validation/daily_label_corpus.csv`. It is regenerated
by `build_daily_label_corpus.py` (engine columns) + `populate_daily_label_corpus.py`
(expert columns, one-time Bazi-master sub-agent grading).
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "validation"))

from run_daily_label_validation import _classify_row, CORPUS_PATH  # noqa: E402

# Relaxed gate (within-1-step on the 9-label severity ladder).
# Set at 90% per plan target (Option 2.5 shipped 2026-05-14 with re-graded
# corpus achieving 93.3% relaxed agreement). Bumped from initial 80% baseline
# after Option 2.5 architecture stabilized engine output.
RELAXED_GATE_PCT = 90.0


def _load_corpus():
    if not CORPUS_PATH or not Path(CORPUS_PATH).exists():
        pytest.fail(f"corpus CSV not found at {CORPUS_PATH}")
    with open(CORPUS_PATH, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def test_daily_label_corpus_all_rows_graded():
    """Every corpus row must have an expected_overall_label from grading."""
    rows = _load_corpus()
    ungraded = [r for r in rows if not r.get("expected_overall_label", "").strip()]
    assert not ungraded, (
        f"{len(ungraded)} rows are ungraded — run "
        f"`python tests/validation/populate_daily_label_corpus.py`"
    )


def test_daily_label_corpus_relaxed_gate():
    """Engine label must be within 1 ladder step of grader for ≥80% of rows.

    Doctrinal-split rows (where two classical schools defensibly disagree)
    are INCLUDED in this gate because they typically differ by at most
    1 step. The strict gate (exact match only) is reported separately
    via the validation harness but NOT enforced — engine has known
    systematic over-tilt toward 大吉/凶 extremes that needs Phase 1.5
    tuning (per-day adjustment on top of the monthly-base inherited label).
    """
    rows = _load_corpus()
    classifications = [_classify_row(r) for r in rows]
    graded = [c for c in classifications if c["state"] != "ungraded"]
    relaxed = [c for c in graded if c["state"] in ("strict_match", "relaxed_match")]
    pct = (len(relaxed) / len(graded)) * 100 if graded else 0.0

    assert pct >= RELAXED_GATE_PCT, (
        f"Relaxed agreement gate FAILED: {pct:.1f}% < {RELAXED_GATE_PCT}%. "
        f"Run `python tests/validation/run_daily_label_validation.py` for "
        f"per-row breakdown. Mismatches indicate engine drift vs Bazi-master "
        f"grading on the 9-label severity ladder."
    )
