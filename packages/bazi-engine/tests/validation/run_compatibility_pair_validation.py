"""Validation harness for the compatibility pair regression corpus.

Consumes `compatibility_pair_corpus.csv` and asserts each pair's engine
output against the locked expected columns.

Two layers (per the approved plan):

  Doctrinal layer (HARD fail; author hand-asserts):
    expected_findings_types     — match by `type` field only
    expected_findings_absent    — must NOT appear
    expected_lookup_dim_scores  — int exact match (dayStemRelationship ONLY)

  Regression layer (HARD fail except baseline; build-mode populated):
    expected_knockout_types     — EXACT-SET match against knockoutConditions[].type
    expected_dim_score_bands    — within ±2.0 band
    expected_special_findings   — exact match resolved via SPECIAL_FINDINGS_PATHS
    adjusted_score_baseline     — ±10 warn-only

Sanity warn: log any specialFindings keys not in SPECIAL_FINDINGS_PATHS.

Frozen: rows with `frozen_pending_recalibration=true` downgrade all assertions
to warn-only, mirroring DOCTRINAL_SPLIT_CHART_IDS pattern in
run_imbalance_validation.py.

WARNING: This corpus locks tag DETECTION (doctrinal) + engine regression for
tagged columns. It does NOT measure engine accuracy against expert-labeled
ground truth. For that, see compatibility_calibration_anchors.csv (planned,
separate PR).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

_THIS = Path(__file__).resolve()
sys.path.insert(0, str(_THIS.parents[2]))  # packages/bazi-engine
sys.path.insert(0, str(_THIS.parent))  # tests/validation
from build_compatibility_corpus import (  # noqa: E402
    CORPUS_PATH, get_compat, extract_compat_block,
    collect_findings_types, collect_knockout_types,
)


# ---------------------------------------------------------------------------
# Special finding key → result-path resolver (hardcoded map per plan)
# ---------------------------------------------------------------------------

# All paths resolve under result['compatibilityEnhanced'] (the compat block).
# Keys under specialFindings sub-dict are tuple paths starting with
# 'specialFindings'. Top-level keys (specialLabel) are single-element paths.
SPECIAL_FINDINGS_PATHS: Dict[str, Tuple[str, ...]] = {
    "specialLabel": ("specialLabel",),
    "tianHeDiHe": ("specialFindings", "tianHeDiHe"),
    "tianHeDiHeDetail": ("specialFindings", "tianHeDiHeDetail"),
    "guanShaHunZa": ("specialFindings", "guanShaHunZa"),
    "shangGuanJianGuan": ("specialFindings", "shangGuanJianGuan"),
    "congGeAffectsYongshen": ("specialFindings", "congGeAffectsYongshen"),
    "identicalCharts": ("specialFindings", "identicalCharts"),
    "identicalChartReason": ("specialFindings", "identicalChartReason"),
    "dinRenWarning": ("specialFindings", "dinRenWarning"),
    "sharedJishenRisk": ("specialFindings", "sharedJishenRisk"),
    "combinationName": ("specialFindings", "combinationName"),
    "huaHuaQuality": ("specialFindings", "huaHuaQuality"),
    "tianDeMitigatesClash": ("specialFindings", "tianDeMitigatesClash"),
    "sameGenderMode": ("specialFindings", "sameGenderMode"),
}


SCORE_BAND_TOLERANCE = 2.0
ADJUSTED_SCORE_WARN_BAND = 10.0


# ---------------------------------------------------------------------------
# Frozen pair handling (mirrors DOCTRINAL_SPLIT_CHART_IDS)
# ---------------------------------------------------------------------------

FROZEN_PAIR_IDS: Set[str] = set()  # Populated by reading the CSV column


# ---------------------------------------------------------------------------
# Result dispatch
# ---------------------------------------------------------------------------

class Issue:
    """A failed assertion."""
    __slots__ = ("pair_id", "kind", "message", "is_warning")

    def __init__(self, pair_id: str, kind: str, message: str,
                 is_warning: bool = False):
        self.pair_id = pair_id
        self.kind = kind
        self.message = message
        self.is_warning = is_warning

    def __str__(self):
        prefix = "WARN" if self.is_warning else "FAIL"
        return f"[{prefix}] {self.pair_id} :: {self.kind}: {self.message}"


# ---------------------------------------------------------------------------
# Path resolver
# ---------------------------------------------------------------------------

def _resolve(ce: Dict, path: Tuple[str, ...]) -> Any:
    """Walk path through ce dict, return None if any key missing."""
    cur: Any = ce
    for k in path:
        if isinstance(cur, dict):
            cur = cur.get(k)
        else:
            return None
    return cur


def _normalize(v: Any) -> Any:
    """Recursively convert tuples → lists. Engine returns tuples in some
    nested fields (e.g. specialFindings.guanShaHunZa.pillarDetails); the
    corpus CSV stores them as JSON arrays. Comparing requires same shape."""
    if isinstance(v, (tuple, list)):
        return [_normalize(x) for x in v]
    if isinstance(v, dict):
        return {k: _normalize(val) for k, val in v.items()}
    return v


# ---------------------------------------------------------------------------
# Per-row assertions
# ---------------------------------------------------------------------------

def _parse_json_field(s: str) -> Any:
    """Parse a JSON column, return {}/[] for empty."""
    if not s or not s.strip():
        return None
    try:
        return json.loads(s)
    except json.JSONDecodeError as e:
        return {"__parse_error__": str(e)}


def assert_row(row: Dict, ce: Dict) -> List[Issue]:
    """Run all assertions for a row, return list of Issues."""
    pair_id = row["pair_id"]
    issues: List[Issue] = []
    is_frozen = row.get("frozen_pending_recalibration", "").strip().lower() == "true"

    def emit(kind: str, message: str, force_warn: bool = False):
        issues.append(Issue(pair_id, kind, message,
                              is_warning=is_frozen or force_warn))

    # ----- expected_findings_types (doctrinal) -----
    eft = _parse_json_field(row["expected_findings_types"])
    if eft and not isinstance(eft, dict):
        emit("schema", f"expected_findings_types parse error: {eft}")
    elif eft:
        for dim_name, expected_types in eft.items():
            actual = collect_findings_types(ce, dim_name)
            for t in expected_types:
                if t not in actual:
                    emit("findings_types",
                         f"{dim_name}: expected '{t}' missing "
                         f"(actual: {sorted(actual)})")

    # ----- expected_findings_absent (doctrinal) -----
    efa = _parse_json_field(row["expected_findings_absent"])
    if efa and not isinstance(efa, dict):
        emit("schema", f"expected_findings_absent parse error: {efa}")
    elif efa:
        for dim_name, absent_types in efa.items():
            actual = collect_findings_types(ce, dim_name)
            for t in absent_types:
                if t in actual:
                    emit("findings_absent",
                         f"{dim_name}: '{t}' should be absent "
                         f"(actual: {sorted(actual)})")

    # ----- expected_lookup_dim_scores (doctrinal) -----
    elds = _parse_json_field(row["expected_lookup_dim_scores"])
    if elds and not isinstance(elds, dict):
        emit("schema", f"expected_lookup_dim_scores parse error: {elds}")
    elif elds:
        for dim_name, expected in elds.items():
            if dim_name != "dayStemRelationship":
                emit("schema",
                     f"expected_lookup_dim_scores allows only "
                     f"'dayStemRelationship', got '{dim_name}'")
                continue
            actual = ce.get("dimensionScores", {}).get(dim_name, {}).get("rawScore")
            if actual != expected:
                emit("lookup_dim_score",
                     f"{dim_name}: expected {expected}, got {actual}")

    # ----- expected_knockout_types (regression, EXACT-SET) -----
    ekt = _parse_json_field(row["expected_knockout_types"])
    if ekt is None:
        ekt = []
    if not isinstance(ekt, list):
        emit("schema", f"expected_knockout_types parse error: {ekt}")
    else:
        actual_kt = collect_knockout_types(ce)
        expected_set = set(ekt)
        missing = expected_set - actual_kt
        unexpected = actual_kt - expected_set
        if missing:
            emit("knockout_missing",
                 f"engine LOST expected knockouts: {sorted(missing)}")
        if unexpected:
            emit("knockout_unexpected",
                 f"engine ADDED unexpected knockouts: {sorted(unexpected)}")

    # ----- expected_dim_score_bands (regression, ±2.0) -----
    edsb = _parse_json_field(row["expected_dim_score_bands"])
    if edsb and not isinstance(edsb, dict):
        emit("schema", f"expected_dim_score_bands parse error: {edsb}")
    elif edsb:
        for dim_name, band in edsb.items():
            if not isinstance(band, list) or len(band) != 2:
                emit("schema",
                     f"band for '{dim_name}' must be [lo, hi], got {band}")
                continue
            actual = ce.get("dimensionScores", {}).get(dim_name, {}).get("rawScore")
            if actual is None:
                emit("dim_score_missing", f"dim '{dim_name}' missing rawScore")
                continue
            lo, hi = band
            if not (lo <= actual <= hi):
                emit("dim_score_band",
                     f"{dim_name}: expected [{lo}, {hi}], got {actual}")

    # ----- expected_special_findings (regression, exact via path map) -----
    esf = _parse_json_field(row["expected_special_findings"])
    if esf and not isinstance(esf, dict):
        emit("schema", f"expected_special_findings parse error: {esf}")
    elif esf:
        for key, expected_value in esf.items():
            path = SPECIAL_FINDINGS_PATHS.get(key)
            if path is None:
                emit("schema",
                     f"unknown specialFindings key '{key}' "
                     f"(not in SPECIAL_FINDINGS_PATHS)")
                continue
            actual = _normalize(_resolve(ce, path))
            if actual != expected_value:
                emit("special_finding",
                     f"{key}: expected {expected_value!r}, got {actual!r}")

    # ----- adjusted_score_baseline (warn-only ±10) -----
    asb = row.get("adjusted_score_baseline", "").strip()
    if asb:
        try:
            baseline = float(asb)
            actual = ce.get("adjustedScore")
            if actual is None:
                emit("score_missing", "adjustedScore missing", force_warn=True)
            elif abs(float(actual) - baseline) > ADJUSTED_SCORE_WARN_BAND:
                emit("score_drift",
                     f"adjustedScore drift: baseline={baseline}, "
                     f"actual={actual} (band ±{ADJUSTED_SCORE_WARN_BAND})",
                     force_warn=True)
        except ValueError:
            emit("schema", f"adjusted_score_baseline not a float: {asb!r}")

    return issues


# ---------------------------------------------------------------------------
# specialFindings drift sanity warn (NB1)
# ---------------------------------------------------------------------------

_KNOWN_SPECIAL_FINDINGS_KEYS: Set[str] = {
    p[-1] if len(p) > 1 else p[0]
    for p in SPECIAL_FINDINGS_PATHS.values()
}


def warn_unknown_special_findings_keys(ce: Dict) -> List[str]:
    """Return list of specialFindings keys NOT in SPECIAL_FINDINGS_PATHS."""
    sf = ce.get("specialFindings", {})
    unknown = sorted(set(sf.keys()) - _KNOWN_SPECIAL_FINDINGS_KEYS)
    return unknown


# ---------------------------------------------------------------------------
# Corpus loader
# ---------------------------------------------------------------------------

def load_corpus_rows() -> List[Dict]:
    """Load corpus, skipping #-comment header lines."""
    with open(CORPUS_PATH, encoding="utf-8") as f:
        lines = [line for line in f if not line.startswith("#")]
    return list(csv.DictReader(lines))


# ---------------------------------------------------------------------------
# Main run
# ---------------------------------------------------------------------------

CORPUS_PURPOSE_NOTICE = (
    "═" * 70 + "\n"
    "Compatibility pair corpus regression run\n"
    "─" * 70 + "\n"
    "WARNING: This corpus locks tag DETECTION (doctrinal) + engine\n"
    "regression for tagged columns. It does NOT measure engine accuracy\n"
    "against expert-labeled ground truth. For that, see\n"
    "compatibility_calibration_anchors.csv (planned, separate PR).\n"
    "═" * 70
)


def run(args) -> int:
    print(CORPUS_PURPOSE_NOTICE)
    print()

    rows = load_corpus_rows()
    print(f"Loaded {len(rows)} pair rows from {CORPUS_PATH.name}")
    if args.pair:
        rows = [r for r in rows if r["pair_id"] == args.pair]
        print(f"Filtered to {len(rows)} row(s) matching --pair={args.pair}")
    if args.section:
        rows = [r for r in rows if r["category"] == args.section]
        print(f"Filtered to {len(rows)} row(s) matching --section={args.section}")
    print()

    all_issues: List[Issue] = []
    drift_warnings: List[str] = []
    by_section: Dict[str, Tuple[int, int, int]] = defaultdict(lambda: (0, 0, 0))
    # (passing, hard_failures, warnings)

    for row in rows:
        pair_id = row["pair_id"]
        category = row["category"]
        try:
            full = get_compat(row["a_date"], row["a_gender"],
                              row["b_date"], row["b_gender"])
        except Exception as e:
            all_issues.append(Issue(pair_id, "engine_error", str(e)))
            continue
        ce = extract_compat_block(full)

        # specialFindings drift sanity warn
        unknown_keys = warn_unknown_special_findings_keys(ce)
        if unknown_keys:
            drift_warnings.append(
                f"{pair_id}: engine emits specialFindings key(s) not in "
                f"SPECIAL_FINDINGS_PATHS: {unknown_keys}")

        # Run row assertions
        issues = assert_row(row, ce)
        all_issues.extend(issues)

        # Tally per-section
        passing, fails, warns = by_section[category]
        if not issues:
            by_section[category] = (passing + 1, fails, warns)
        else:
            hard = sum(1 for i in issues if not i.is_warning)
            warnsoft = sum(1 for i in issues if i.is_warning)
            if hard > 0:
                by_section[category] = (passing, fails + 1, warns)
            else:
                by_section[category] = (passing, fails, warns + 1)

    # Output
    if drift_warnings:
        print("─── specialFindings drift sanity warnings ───")
        for w in drift_warnings:
            print(f"  {w}")
        print("  → Add new keys to SPECIAL_FINDINGS_PATHS in this file.")
        print()

    if all_issues:
        print("─── Issues ───")
        for i in all_issues:
            print(f"  {i}")
        print()

    print("─── Summary by section ───")
    for cat in sorted(by_section.keys()):
        passing, fails, warns = by_section[cat]
        print(f"  {cat:38s}  pass={passing:2d}  fail={fails:2d}  warn={warns:2d}")
    print()

    hard_fails = sum(1 for i in all_issues if not i.is_warning)
    soft_warns = sum(1 for i in all_issues if i.is_warning)
    print(f"Total: {hard_fails} hard failure(s), {soft_warns} warning(s)")

    if hard_fails > 0:
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pair", help="filter to single pair_id")
    parser.add_argument("--section", help="filter to single category (e.g. A_six_he)")
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
