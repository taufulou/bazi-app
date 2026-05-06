"""Helper to find date pairs and populate the compatibility regression corpus.

Pre-flight verified facts (run 2026-05-06 against current main):
- cnlunar advances day8Char at 23:00 (傳統 子時); see four_pillars.py:386
- score_spouse_palace does NOT detect 六破 (Section D originally planned, dropped)
- 7 of 8 dim raw scores are floats (round to 1 decimal); only
  dayStemRelationship is int. The exact-int assertion column applies to
  dayStemRelationship ONLY — other dim names go through bands.
- result['compatibilityEnhanced']['knockoutConditions'] is the top-level
  knockout list (NOT inside dimensionScores.findings).
- tianHeDiHe is a day-pillar check (compatibility_enhanced.py:322);
  specialLabel='命中注定' requires both tianHeDiHe AND dim1.rawScore > 70.
- specialFindings has 13 keys; SPECIAL_FINDINGS_PATHS in the harness must
  cover the full set or rely on the sanity-warn at run time to surface
  drift.
- Full pipeline (calculate_bazi_compatibility) ~5ms/pair; 53 pairs ≈ 265ms.

Three search modes (one find_pair core, three CLI shorthands):
- scan: forward-search for target day pillar; reject candidates that fire
  more than `max_collateral_knockouts` cross-chart knockouts (Sections
  A/B/C/E/F/I where doctrinal-tag isolation matters).
- inverse: forward-search until target knockout fires; co-fired knockouts
  recorded as part of expected_knockout_types (Section J).
- bounded: custom predicate (Section K K2: tianHeDiHe AND dim1<=70).

Usage:
    python build_compatibility_corpus.py --emit-dates  # generate candidate dates
    python build_compatibility_corpus.py --build       # populate regression columns
    python build_compatibility_corpus.py --update-baselines [--pair=ID] [--column=NAME]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Dict, List, Optional, Set, Tuple

# ---------------------------------------------------------------------------
# Engine import bootstrapping
# ---------------------------------------------------------------------------

_THIS = Path(__file__).resolve()
_ENGINE_ROOT = _THIS.parents[2]  # packages/bazi-engine
sys.path.insert(0, str(_ENGINE_ROOT))

from app.calculator import calculate_bazi, calculate_bazi_compatibility  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CORPUS_PATH = _THIS.parent / "compatibility_pair_corpus.csv"

DEFAULT_LOCATION = "Taipei"
DEFAULT_TIMEZONE = "Asia/Taipei"
DEFAULT_TIME = "12:00"

# Search start: 1980-01-01. The 60-甲子 day cycle guarantees every target
# day pillar appears within ~60 days from any start.
SEARCH_START = date(1980, 1, 1)
# Search horizon: 1980-2010 (~30 years) is more than enough for any target.
SEARCH_DAYS = 365 * 30

# CSV columns
CSV_COLUMNS = [
    "pair_id",
    "category",
    "doctrine_note",
    "a_date", "a_time", "a_location", "a_gender",
    "b_date", "b_time", "b_location", "b_gender",
    # Doctrinal columns (HARD fail; author hand-asserts)
    "expected_findings_types",       # JSON: {"spousePalace": ["六合"], ...}
    "expected_findings_absent",      # JSON: same shape
    "expected_lookup_dim_scores",    # JSON: {"dayStemRelationship": 75} (THIS DIM ONLY)
    # Regression columns (HARD fail except baseline; build-mode populated)
    "expected_knockout_types",       # JSON list, EXACT-SET match
    "expected_dim_score_bands",      # JSON: {"yongshenComplementarity": [60.0, 70.0]}
    "expected_special_findings",     # JSON: {"tianHeDiHe": true, "specialLabel": "命中注定"}
    "adjusted_score_baseline",       # float; ±10 warn-only
    # Frozen flag
    "frozen_pending_recalibration",  # "true" | "false"
    "notes",
]


# ---------------------------------------------------------------------------
# Engine helpers
# ---------------------------------------------------------------------------

def make_birth(d: str, gender: str, t: str = DEFAULT_TIME) -> Dict:
    """Construct a birth dict matching what calculate_bazi_compatibility expects."""
    return {
        "birth_date": d,
        "birth_time": t,
        "birth_city": DEFAULT_LOCATION,
        "birth_timezone": DEFAULT_TIMEZONE,
        "gender": gender,
    }


def get_day_pillar(d: date) -> str:
    """Return the day pillar (stem+branch) for a given date.

    Uses 12:00 noon to avoid hour-boundary edge cases with 子時 換日.
    """
    chart = calculate_bazi(d.isoformat(), DEFAULT_TIME, DEFAULT_LOCATION,
                            DEFAULT_TIMEZONE, "male")
    fp = chart["fourPillars"]["day"]
    return f"{fp['stem']}{fp['branch']}"


def get_compat(date_a: str, gender_a: str,
               date_b: str, gender_b: str,
               *, comp_type: str = "romance",
               current_year: int = 2026) -> Dict:
    """Compute the full compatibility result for a pair."""
    return calculate_bazi_compatibility(
        make_birth(date_a, gender_a),
        make_birth(date_b, gender_b),
        comp_type,
        current_year=current_year,
    )


def extract_compat_block(full_result: Dict) -> Dict:
    """Return the compatibilityEnhanced block (where all assertion-relevant data lives)."""
    return full_result["compatibilityEnhanced"]


def collect_knockout_types(compat_block: Dict) -> Set[str]:
    """Return the set of knockout `type` strings emitted by this pair."""
    return {k.get("type") for k in compat_block.get("knockoutConditions", [])
            if k.get("type")}


def collect_findings_types(compat_block: Dict, dim_name: str) -> Set[str]:
    """Return the set of `type` strings from a dim's findings list."""
    dim = compat_block.get("dimensionScores", {}).get(dim_name, {})
    findings = dim.get("findings", []) or []
    return {f.get("type") for f in findings if f.get("type")}


# ---------------------------------------------------------------------------
# Date search
# ---------------------------------------------------------------------------

def find_date_for_day_pillar(target: str,
                              after: date = SEARCH_START,
                              max_search_days: int = 90) -> Optional[date]:
    """Find first date on/after `after` whose day pillar matches `target`.

    Day pillar follows a strict 60-day sexagenary cycle, so a match exists
    within 60 days. We allow 90 to be safe.
    """
    for offset in range(max_search_days):
        d = after + timedelta(days=offset)
        if get_day_pillar(d) == target:
            return d
    return None


def find_pair(predicate: Callable[[Dict], bool],
              *,
              date_a_target: Optional[str] = None,
              date_b_target: Optional[str] = None,
              gender_a: str = "male",
              gender_b: str = "female",
              after_a: date = SEARCH_START,
              after_b: date = SEARCH_START,
              max_offset: int = 730,
              comp_type: str = "romance",
              ) -> Optional[Tuple[date, date, Dict]]:
    """Generic pair search. Pin one or both day pillars; iterate until predicate(compat_block) holds.

    If both day pillars are pinned, only one (a, b) candidate exists per
    (after_a, after_b) — match-or-skip; predicate must accept it. If only
    one is pinned, vary the other within `max_offset` days.

    Returns (date_a, date_b, full_result) or None.
    """
    # Resolve A's first matching date (or fixed)
    if date_a_target:
        d_a = find_date_for_day_pillar(date_a_target, after=after_a)
        if d_a is None:
            return None
    else:
        d_a = after_a

    # If B is pinned to a target day pillar, find within max_offset of d_a
    if date_b_target:
        d_b = find_date_for_day_pillar(date_b_target, after=after_b)
        if d_b is None:
            return None
        full = calculate_bazi_compatibility(
            make_birth(d_a.isoformat(), gender_a),
            make_birth(d_b.isoformat(), gender_b),
            comp_type,
        )
        if predicate(extract_compat_block(full)):
            return (d_a, d_b, full)
        return None

    # B is not pinned — vary across max_offset days from after_b
    for offset in range(max_offset):
        d_b = after_b + timedelta(days=offset)
        full = calculate_bazi_compatibility(
            make_birth(d_a.isoformat(), gender_a),
            make_birth(d_b.isoformat(), gender_b),
            comp_type,
        )
        if predicate(extract_compat_block(full)):
            return (d_a, d_b, full)
    return None


# ---------------------------------------------------------------------------
# Predicates
# ---------------------------------------------------------------------------

def predicate_collateral_knockout_cap(max_collateral: int = 1,
                                       allowed: Optional[Set[str]] = None
                                       ) -> Callable[[Dict], bool]:
    """Accept iff knockoutConditions has at most `max_collateral` non-allowed types."""
    allowed = allowed or set()
    def _check(compat_block: Dict) -> bool:
        types = collect_knockout_types(compat_block)
        unallowed = types - allowed
        return len(unallowed) <= max_collateral
    return _check


def predicate_must_fire_knockout(target_type: str) -> Callable[[Dict], bool]:
    """Accept iff `target_type` is in knockoutConditions."""
    def _check(compat_block: Dict) -> bool:
        return target_type in collect_knockout_types(compat_block)
    return _check


def predicate_special_finding(key: str, expected_value) -> Callable[[Dict], bool]:
    """Accept iff specialFindings[key] (or specialLabel for that key) equals expected_value."""
    def _check(compat_block: Dict) -> bool:
        if key == "specialLabel":
            return compat_block.get("specialLabel") == expected_value
        return compat_block.get("specialFindings", {}).get(key) == expected_value
    return _check


def predicate_combine(*preds: Callable[[Dict], bool]) -> Callable[[Dict], bool]:
    """All-of combinator."""
    def _check(compat_block: Dict) -> bool:
        return all(p(compat_block) for p in preds)
    return _check


# ---------------------------------------------------------------------------
# Build-mode: populate regression columns from engine output
# ---------------------------------------------------------------------------

def populate_regression_columns(row: Dict) -> Dict:
    """Run engine for the pair declared in `row` and fill regression columns
    in-place with current engine output. Doctrinal columns are left as-is."""
    full = get_compat(row["a_date"], row["a_gender"],
                      row["b_date"], row["b_gender"])
    ce = extract_compat_block(full)

    # expected_knockout_types: exact-set
    knockouts = sorted(collect_knockout_types(ce))
    row["expected_knockout_types"] = json.dumps(knockouts, ensure_ascii=False)

    # expected_dim_score_bands: ±2.0 around current rawScore for ratio-derived dims
    bands = {}
    for dim_name, dim_data in ce["dimensionScores"].items():
        if dim_name == "dayStemRelationship":
            continue  # int, asserted via expected_lookup_dim_scores
        raw = dim_data.get("rawScore")
        if raw is None:
            continue
        bands[dim_name] = [round(raw - 2.0, 1), round(raw + 2.0, 1)]
    row["expected_dim_score_bands"] = json.dumps(bands, ensure_ascii=False)

    # expected_special_findings: capture all resolved truthy keys.
    # Keys covered (full specialFindings shape per engine):
    #   tianHeDiHe (bool), guanShaHunZa (dict), shangGuanJianGuan (dict),
    #   congGeAffectsYongshen (bool), identicalCharts (bool),
    #   dinRenWarning (bool), sharedJishenRisk (bool),
    #   combinationName (str — 五合 nickname per dim2),
    #   huaHuaQuality (str — 化合 quality per dim2),
    #   tianDeMitigatesClash (bool), sameGenderMode (bool).
    # tianHeDiHeDetail / identicalChartReason are nested detail blobs;
    # we don't capture them to keep the corpus diff-friendly.
    sf = ce.get("specialFindings", {})
    captured = {}
    for k in ["tianHeDiHe", "guanShaHunZa", "shangGuanJianGuan",
              "congGeAffectsYongshen", "identicalCharts", "dinRenWarning",
              "sharedJishenRisk", "combinationName", "huaHuaQuality",
              "tianDeMitigatesClash", "sameGenderMode"]:
        v = sf.get(k)
        if v:  # only emit truthy
            captured[k] = v
    if ce.get("specialLabel"):
        captured["specialLabel"] = ce["specialLabel"]
    row["expected_special_findings"] = json.dumps(captured, ensure_ascii=False)

    # adjusted_score_baseline (warn-only ±10)
    row["adjusted_score_baseline"] = str(ce.get("adjustedScore"))

    return row


# ---------------------------------------------------------------------------
# CSV I/O
# ---------------------------------------------------------------------------

CORPUS_HEADER_COMMENT = (
    "# WARNING: This corpus locks tag DETECTION (doctrinal) + engine\n"
    "# regression for tagged columns. It does NOT measure engine\n"
    "# accuracy against expert-labeled ground truth. For accuracy\n"
    "# measurement, see compatibility_calibration_anchors.csv\n"
    "# (planned, separate PR).\n"
    "# See build_compatibility_corpus.py for verified pre-flight facts.\n"
)


def load_corpus() -> List[Dict]:
    """Load corpus rows, skipping the header-comment lines."""
    rows = []
    with open(CORPUS_PATH, encoding="utf-8") as f:
        # Strip leading "#" comment lines
        lines = [line for line in f if not line.startswith("#")]
    reader = csv.DictReader(lines)
    for row in reader:
        rows.append(row)
    return rows


def save_corpus(rows: List[Dict]) -> None:
    """Write corpus rows back to CSV with the header-comment block."""
    with open(CORPUS_PATH, "w", encoding="utf-8", newline="") as f:
        f.write(CORPUS_HEADER_COMMENT)
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({col: row.get(col, "") for col in CSV_COLUMNS})


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def cmd_build(args) -> int:
    rows = load_corpus()
    target_pair_id = args.pair
    target_column = args.column
    updated = 0
    for row in rows:
        if target_pair_id and row["pair_id"] != target_pair_id:
            continue
        if target_column:
            full = get_compat(row["a_date"], row["a_gender"],
                              row["b_date"], row["b_gender"])
            ce = extract_compat_block(full)
            if target_column == "adjusted_score_baseline":
                row["adjusted_score_baseline"] = str(ce.get("adjustedScore"))
            elif target_column == "expected_knockout_types":
                row["expected_knockout_types"] = json.dumps(
                    sorted(collect_knockout_types(ce)), ensure_ascii=False)
            else:
                print(f"ERROR: unsupported --column={target_column}")
                return 2
        else:
            populate_regression_columns(row)
        updated += 1
    save_corpus(rows)
    print(f"build: refreshed {updated} row(s)")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=False)

    p_build = sub.add_parser("build", help="populate regression columns")
    p_build.add_argument("--pair", help="single pair_id to refresh")
    p_build.add_argument("--column", help="single column to refresh "
                                            "(adjusted_score_baseline | expected_knockout_types)")
    p_build.add_argument("--yes", action="store_true",
                          help="skip confirmation when refreshing all")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args()
    if not args.cmd:
        parser.print_help()
        return 1

    # Confirmation gate for blanket refresh
    if args.cmd == "build" and not args.pair and not args.column and not args.yes:
        resp = input("Refresh ALL build-mode columns for ALL pairs? [y/N] ")
        if resp.strip().lower() != "y":
            print("aborted")
            return 1

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
