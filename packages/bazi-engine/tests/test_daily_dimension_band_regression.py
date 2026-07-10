"""Pytest gate for the FULL Bazi-master dimension band grading (用神-alignment).

Locks the within-1-band agreement between the engine's per-dimension bands and
the blind Bazi-master sub-agent grades (`daily_dimension_corpus.csv`, populated
2026-07-10: 3 charts × 10 days × 5 dims = 150 grades, 98.7% relaxed).

Complements the DETERMINISTIC gate (`test_daily_dimension_corpus_regression.py`,
monotonicity/floor/ceiling). This one is the accuracy-vs-expert check.

Known bounded finding (documented, Phase 2.x candidate): the only 2 ≥2-band
misses are favorable-END range compression — the engine can't reach 極佳 on a
domain's strongest days (soft-trigger deltas + net cap top out ~64-66). Both
were pre-flagged by the graders (官印相生 career / 財為用+食傷生財 finance).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'validation'))

import run_daily_dimension_band_validation as band  # noqa: E402

RELAXED_GATE = 90.0  # actual 98.7%; locked at 90 for headroom


def test_dimension_band_agreement_meets_gate():
    strict_pct, relaxed_pct, n, mism = band.agreement()
    assert n >= 150, f'corpus under-populated (n={n})'
    assert relaxed_pct >= RELAXED_GATE, (
        f'within-1-band agreement {relaxed_pct:.1f}% < {RELAXED_GATE}% '
        f'(strict {strict_pct:.1f}%); ≥2-band misses: {mism}'
    )


def test_no_more_than_expected_severe_mismatches():
    # The full grading found exactly 2 ≥2-band misses (both favorable-end
    # compression). A regression that adds more is a calibration signal.
    _, _, _, mism = band.agreement()
    assert len(mism) <= 3, f'≥2-band mismatches grew to {len(mism)}: {mism}'
