"""
Fix 1a validation harness — gates the BAZI_USE_WEIGHTED_IMBALANCE flag flip.

Reads `expert_labeled_charts.csv` (50+ rows of expert-labeled 用神 verdicts
from classical sources) and runs the engine in BOTH flag states (OFF and ON)
to measure agreement.

Pass criteria (all three must hold for prod flag flip):
  1. Overall agreement ≥ 95% in flag-ON mode
  2. ZERO disagreements on the 5 canonical anchor chart IDs
  3. ≤ 2 textbook-subset (子平真詮 + 滴天髓) disagreements

The harness also classifies every flag-OFF→flag-ON diff as:
  (a) was-wrong-now-right  — fixture matches expected; flag flip is justified
  (b) was-right-now-wrong  — REGRESSION (blocks merge)
  (c) ambiguous            — needs Bazi-master review

CSV schema (header row required):
  chart_id, label_source, gender,
  year_pillar, month_pillar, day_pillar, hour_pillar,
  expected_dm_strength, expected_dominant,
  expected_yong_shen, expected_xi_shen,
  is_cong_ge, source_citation, reasoning, confidence

Each *_pillar value is a 2-character Chinese stem+branch (e.g. "丙寅").
"""

from __future__ import annotations

import csv
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Make `app` importable regardless of cwd.
_HERE = Path(__file__).resolve()
_ENGINE_ROOT = _HERE.parents[2]   # packages/bazi-engine/
if str(_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_ENGINE_ROOT))


# ============================================================================
# Canonical anchors — zero-disagreement gate applies to these.
# (Polish #2 from v3 staff-engineer review: pinned here as constants.)
# ============================================================================
CANONICAL_ANCHOR_CHART_IDS: List[str] = [
    'roger',
    'laopo',
    'anchor_he_canzheng_killing_seal',     # 殺印相生 — 何參政 (子平真詮)
    'anchor_cong_cai_yiwuming',            # 從財 boundary — 易武明 (滴天髓)
    'anchor_xue_xianggong_guansha_mixed',  # 官殺混雜 — 薛相公 (子平真詮)
]

TEXTBOOK_SOURCES = {'ziping_zhenquan', 'ditian_sui', 'qiongtong_baojian'}

# Element ↔ god-role inverse (for re-deriving expected_dominant when only
# 用神 + strength are stamped in CSV — used as a sanity cross-check, not as
# the primary expected field).
ROLE_TO_DOMINANT_WEAK = {
    'produces_me': '官殺旺',  # or 食傷旺 — ambiguous on element alone
    'dm_element': 'general',  # or 財旺
}
ROLE_TO_DOMINANT_STRONG = {
    'overcomes_me': '比劫旺',
    'i_produce':    '官殺旺',
    'i_overcome':   'general',  # or 印旺
}


@dataclass
class ChartRow:
    chart_id: str
    label_source: str
    gender: str
    year_pillar: str
    month_pillar: str
    day_pillar: str
    hour_pillar: str
    expected_dm_strength: str
    expected_dominant: str
    expected_yong_shen: str
    expected_xi_shen: str
    is_cong_ge: bool
    source_citation: str
    reasoning: str
    confidence: str

    @property
    def day_master_stem(self) -> str:
        return self.day_pillar[0]

    def pillars_dict(self) -> Dict[str, Dict[str, str]]:
        return {
            'year':  {'stem': self.year_pillar[0],  'branch': self.year_pillar[1]},
            'month': {'stem': self.month_pillar[0], 'branch': self.month_pillar[1]},
            'day':   {'stem': self.day_pillar[0],   'branch': self.day_pillar[1]},
            'hour':  {'stem': self.hour_pillar[0],  'branch': self.hour_pillar[1]},
        }


@dataclass
class ChartResult:
    chart_id: str
    label_source: str
    expected_yong_shen: str
    expected_dominant: str
    actual_yong_shen: str
    actual_dominant: str
    yong_shen_match: bool
    dominant_match: bool


@dataclass
class ModeReport:
    flag_state: bool
    results: List[ChartResult] = field(default_factory=list)

    @property
    def label(self) -> str:
        return 'ON ' if self.flag_state else 'OFF'

    @property
    def n_total(self) -> int:
        return len(self.results)

    @property
    def n_yong_match(self) -> int:
        return sum(1 for r in self.results if r.yong_shen_match)

    @property
    def n_dominant_match(self) -> int:
        return sum(1 for r in self.results if r.dominant_match)

    @property
    def yong_agreement_pct(self) -> float:
        return 100.0 * self.n_yong_match / self.n_total if self.n_total else 0.0

    @property
    def dominant_agreement_pct(self) -> float:
        return 100.0 * self.n_dominant_match / self.n_total if self.n_total else 0.0


def _csv_path() -> Path:
    return Path(__file__).parent / 'expert_labeled_charts.csv'


def _load_rows(csv_file: Path) -> List[ChartRow]:
    rows: List[ChartRow] = []
    with csv_file.open('r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for raw in reader:
            rows.append(ChartRow(
                chart_id=raw['chart_id'].strip(),
                label_source=raw['label_source'].strip(),
                gender=raw['gender'].strip(),
                year_pillar=raw['year_pillar'].strip(),
                month_pillar=raw['month_pillar'].strip(),
                day_pillar=raw['day_pillar'].strip(),
                hour_pillar=raw['hour_pillar'].strip(),
                expected_dm_strength=raw['expected_dm_strength'].strip(),
                expected_dominant=raw['expected_dominant'].strip(),
                expected_yong_shen=raw['expected_yong_shen'].strip(),
                expected_xi_shen=raw['expected_xi_shen'].strip(),
                is_cong_ge=raw['is_cong_ge'].strip().lower() in ('1', 'true', 'yes'),
                source_citation=raw.get('source_citation', '').strip(),
                reasoning=raw.get('reasoning', '').strip(),
                confidence=raw.get('confidence', '').strip(),
            ))
    return rows


def _evaluate_chart(row: ChartRow) -> ChartResult:
    """Run engine on one chart in the CURRENT flag state. Caller must
    have set `five_elements._USE_WEIGHTED_IMBALANCE` before calling.

    Mirrors the real engine flow (calculator.py + interpretation_rules.py
    `generate_pre_analysis`) so 從格 overrides via `check_cong_ge` are
    honored — without this, Pattern 3b's effect on `anchor_cong_cai_yiwuming`
    would be invisible to the harness.
    """
    from app.five_elements import (
        _detect_dominant_imbalance,
        calculate_five_elements_balance,
        determine_favorable_gods,
    )
    from app.interpretation_rules import (
        calculate_strength_score_v2,
        check_cong_ge,
    )
    from app.ten_gods import get_ten_god_distribution

    pillars = row.pillars_dict()
    dm_stem = row.day_master_stem

    # V2 strength is the authoritative classification used in the real
    # engine flow (calculator.py:142). V1 analyze_day_master_strength is
    # display-only.
    strength_result = calculate_strength_score_v2(pillars, dm_stem)
    strength = strength_result['classification']

    ten_god_dist = get_ten_god_distribution(pillars, dm_stem)

    # Step 1: Check 從格 (Pattern 3b suppression applies inside check_cong_ge).
    # When 從格 fires, it overrides the dominant + 用神 verdict.
    five_elements_balance = calculate_five_elements_balance(pillars)
    cong_ge = check_cong_ge(
        pillars, dm_stem, strength_result, five_elements_balance)

    if cong_ge is not None:
        # 從格 detected — use its yongShen (mirrors generate_pre_analysis
        # effective_gods override at interpretation_rules.py:957-963).
        actual_dominant = 'cong_overridden'
        actual_yong = cong_ge['yongShen']
    else:
        # Standard 用神 path
        actual_dominant = _detect_dominant_imbalance(
            ten_god_dist,
            strength,
            pillars=pillars,
            day_master_stem=dm_stem,
            is_cong_ge=False,  # already checked above; not 從格
        )

        favorable = determine_favorable_gods(
            dm_stem,
            strength,
            ten_god_dist,
            pillars=pillars,
            is_cong_ge=False,
        )
        actual_yong = favorable['usefulGod']

    return ChartResult(
        chart_id=row.chart_id,
        label_source=row.label_source,
        expected_yong_shen=row.expected_yong_shen,
        expected_dominant=row.expected_dominant,
        actual_yong_shen=actual_yong,
        actual_dominant=actual_dominant,
        yong_shen_match=(actual_yong == row.expected_yong_shen),
        dominant_match=(actual_dominant == row.expected_dominant
                        or row.expected_dominant == 'general'),
    )


def _run_mode(rows: List[ChartRow], flag_state: bool) -> ModeReport:
    from app import five_elements as fe
    fe._USE_WEIGHTED_IMBALANCE = flag_state

    report = ModeReport(flag_state=flag_state)
    for row in rows:
        try:
            report.results.append(_evaluate_chart(row))
        except Exception as e:  # noqa: BLE001 — we want to surface every error
            print(f'  ⚠️  ERROR on {row.chart_id}: {e}', file=sys.stderr)
            report.results.append(ChartResult(
                chart_id=row.chart_id,
                label_source=row.label_source,
                expected_yong_shen=row.expected_yong_shen,
                expected_dominant=row.expected_dominant,
                actual_yong_shen='<error>',
                actual_dominant='<error>',
                yong_shen_match=False,
                dominant_match=False,
            ))
    return report


def _print_mode_summary(report: ModeReport) -> None:
    print(f'  flag={report.label}  '
          f'用神 agreement: {report.n_yong_match}/{report.n_total} '
          f'({report.yong_agreement_pct:5.1f}%)  '
          f'dominant agreement: {report.n_dominant_match}/{report.n_total} '
          f'({report.dominant_agreement_pct:5.1f}%)')


def _classify_diffs(off: ModeReport, on: ModeReport, rows: List[ChartRow]
                    ) -> Tuple[List[str], List[str], List[str]]:
    """Return (was_wrong_now_right, was_right_now_wrong, unchanged_disagree)."""
    by_id_off = {r.chart_id: r for r in off.results}
    by_id_on = {r.chart_id: r for r in on.results}
    by_id_row = {r.chart_id: r for r in rows}

    was_wrong_now_right: List[str] = []
    was_right_now_wrong: List[str] = []
    unchanged_disagree: List[str] = []

    for cid in by_id_off:
        off_r = by_id_off[cid]
        on_r = by_id_on[cid]
        if off_r.yong_shen_match and not on_r.yong_shen_match:
            was_right_now_wrong.append(
                f'{cid}: OFF={off_r.actual_yong_shen}✓ → ON={on_r.actual_yong_shen}✗ '
                f'(expected={off_r.expected_yong_shen})')
        elif (not off_r.yong_shen_match) and on_r.yong_shen_match:
            was_wrong_now_right.append(
                f'{cid}: OFF={off_r.actual_yong_shen}✗ → ON={on_r.actual_yong_shen}✓ '
                f'(expected={off_r.expected_yong_shen})')
        elif (not off_r.yong_shen_match) and (not on_r.yong_shen_match):
            unchanged_disagree.append(
                f'{cid}: OFF={off_r.actual_yong_shen} ON={on_r.actual_yong_shen} '
                f'(expected={off_r.expected_yong_shen}; '
                f'src={by_id_row[cid].label_source})')

    return was_wrong_now_right, was_right_now_wrong, unchanged_disagree


def _check_gates(on: ModeReport, rows: List[ChartRow]) -> Tuple[bool, List[str]]:
    """Return (all_passed, list_of_failures)."""
    failures: List[str] = []

    # Gate 1: ≥ 95% overall agreement on 用神
    if on.yong_agreement_pct < 95.0:
        failures.append(
            f'Gate 1 FAIL: 用神 agreement {on.yong_agreement_pct:.1f}% < 95%')

    # Gate 2: zero disagreements on canonical anchors
    by_id = {r.chart_id: r for r in on.results}
    anchor_diffs: List[str] = []
    for aid in CANONICAL_ANCHOR_CHART_IDS:
        if aid not in by_id:
            anchor_diffs.append(f'{aid} MISSING from CSV')
            continue
        if not by_id[aid].yong_shen_match:
            anchor_diffs.append(
                f'{aid}: actual={by_id[aid].actual_yong_shen} '
                f'expected={by_id[aid].expected_yong_shen}')
    if anchor_diffs:
        failures.append('Gate 2 FAIL: anchor disagreement(s):\n    - '
                        + '\n    - '.join(anchor_diffs))

    # Gate 3: ≤ 2 textbook subset disagreements
    rows_by_id = {r.chart_id: r for r in rows}
    textbook_diffs = [
        r for r in on.results
        if rows_by_id.get(r.chart_id) is not None
        and rows_by_id[r.chart_id].label_source in TEXTBOOK_SOURCES
        and not r.yong_shen_match
    ]
    if len(textbook_diffs) > 2:
        failures.append(
            f'Gate 3 FAIL: {len(textbook_diffs)} textbook subset disagreement(s) > 2')
        for r in textbook_diffs:
            failures.append(
                f'    - {r.chart_id} ({r.label_source}): '
                f'actual={r.actual_yong_shen} expected={r.expected_yong_shen}')

    return (len(failures) == 0), failures


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

    rows = _load_rows(csv_file)
    if len(rows) < 50:
        print(f'⚠️  CSV contains only {len(rows)} rows; gate requires ≥ 50.')
        print('    Continuing for diagnostic purposes only — DO NOT FLIP FLAG '
              'on a partial corpus.')

    print(f'Loaded {len(rows)} chart(s) from {csv_file.name}')
    print('=' * 72)

    print('Mode comparison:')
    off_report = _run_mode(rows, flag_state=False)
    on_report = _run_mode(rows, flag_state=True)
    _print_mode_summary(off_report)
    _print_mode_summary(on_report)
    print()

    print('Diff classification (flag-OFF → flag-ON, 用神 only):')
    won_right, lost_right, still_wrong = _classify_diffs(
        off_report, on_report, rows)
    print(f'  (a) was-wrong-now-right   : {len(won_right):3d}')
    for line in won_right:
        print(f'        + {line}')
    print(f'  (b) was-right-now-wrong   : {len(lost_right):3d}'
          + ('  ⚠️ REGRESSIONS — block merge until investigated'
             if lost_right else ''))
    for line in lost_right:
        print(f'        ! {line}')
    print(f'  (c) unchanged disagreement: {len(still_wrong):3d}'
          + ('  (review — flag flip changes nothing here)'
             if still_wrong else ''))
    for line in still_wrong:
        print(f'        ? {line}')
    print()

    print('Gate evaluation (flag=ON):')
    all_passed, failures = _check_gates(on_report, rows)
    if all_passed:
        print('  ✅ All 3 gates PASSED. Flag flip is unblocked from harness '
              'perspective.')
        print('     (Bazi-master sign-off on compat regressions still required '
              'separately.)')
        return 0
    else:
        print(f'  ❌ {len(failures)} gate(s) FAILED:')
        for line in failures:
            print(f'    - {line}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
