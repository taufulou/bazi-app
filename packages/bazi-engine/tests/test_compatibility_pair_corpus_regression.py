"""Pytest integration for the compatibility pair regression corpus.

Runs the same assertions as `tests/validation/run_compatibility_pair_validation.py`
but as a parametrized pytest suite so failures land in the regular test
report.

WARNING: This test suite locks tag DETECTION (doctrinal) + engine
regression for tagged columns. It does NOT measure engine accuracy
against expert-labeled ground truth. For that, see the planned
compatibility_calibration_anchors.csv.

To refresh build-mode columns after intentional engine changes:
    cd packages/bazi-engine
    python tests/validation/build_compatibility_corpus.py build --yes
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "validation"))

from build_compatibility_corpus import (  # noqa: E402
    extract_compat_block, get_compat,
)
from run_compatibility_pair_validation import (  # noqa: E402
    assert_row, load_corpus_rows, warn_unknown_special_findings_keys,
)


def _load_pairs():
    """Returns list of (pair_id, row) tuples."""
    rows = load_corpus_rows()
    return [(r["pair_id"], r) for r in rows]


@pytest.mark.parametrize("pair_id,row", _load_pairs(),
                          ids=lambda x: x if isinstance(x, str) else "")
def test_compatibility_pair(pair_id, row):
    """Assert one corpus pair's engine output matches its locked expectations.

    Doctrinal layer (HARD fail):
      - expected_findings_types: dim findings types must include these
      - expected_findings_absent: dim findings types must NOT include these
      - expected_lookup_dim_scores: int exact match (dayStemRelationship)

    Regression layer (HARD fail except baseline):
      - expected_knockout_types: EXACT-SET match
      - expected_dim_score_bands: ±2.0 band
      - expected_special_findings: exact match via SPECIAL_FINDINGS_PATHS
      - adjusted_score_baseline: ±10 warn-only
    """
    full = get_compat(row["a_date"], row["a_gender"],
                      row["b_date"], row["b_gender"])
    ce = extract_compat_block(full)

    # Sanity warn for engine drift in specialFindings keys
    unknown = warn_unknown_special_findings_keys(ce)
    if unknown:
        pytest.warns(UserWarning, match="specialFindings drift")  # surface only
        # Also print so it shows in `-s` mode
        print(f"\nspecialFindings drift in {pair_id}: {unknown}")

    issues = assert_row(row, ce)

    # Hard failures only — warnings (frozen rows, score-baseline drift)
    # don't fail the test, only stand out in stdout.
    hard = [i for i in issues if not i.is_warning]
    soft = [i for i in issues if i.is_warning]

    if soft:
        for s in soft:
            print(f"\n[WARN] {s}")

    if hard:
        msg = "\n".join(f"[FAIL] {i}" for i in hard)
        pytest.fail(msg)
