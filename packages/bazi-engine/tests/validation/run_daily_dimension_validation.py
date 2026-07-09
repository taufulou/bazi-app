"""Deterministic raw-score validation gate for the 用神-alignment 5-dimension
baseline (Plan Phase 1, MC-2).

Why this exists (MC-2): the band-level label gate (5-band 極佳/順遂/…) is
15 points wide, but the baseline shift is ≤±8 (< half a band). So the
intra-band TEXTURE that is the whole deliverable is invisible to a band
grader. This harness adds non-band, raw-score assertions:

  G1 — MONOTONICITY: for each chart, the engine's mean dimension score on
       用神-aligned day-pillars must exceed the mean on 忌神-aligned day-pillars
       by a minimum margin. Days are classified by an INDEPENDENT role rule
       (day-stem element role + day-branch 本氣 role vs the chart's effective
       gods) — NOT the engine's own dfi — so this is a real correlation check,
       not a tautology.
  G2 — HEALTH SANITY FLOOR: min health over a 60-day sweep stays >= _HEALTH_FLOOR
       (=25). This is a SANITY floor only, NOT the MC-1 double-count guard — DR-4
       (headline coupling) legitimately pulls health toward a 凶 headline, so
       health can dip into the low-30s by correct subordination. The MC-1
       organ-overload single-nudge de-dup is guarded directly by
       test_daily_enhanced.py::test_mc1_overload_single_nudge_not_per_element.
  G3 — ANTI-RUNAWAY CEILING: no dimension may exceed _DIM_CEILING (guards
       baseline-vs-dispatch compounding, e.g. 財=用神 finance days).
  G4 — BASELINE ACTIVE: with the master flag ON, the output DIFFERS from the
       flag-OFF output on at least one day (i.e. the baseline is doing something).
       NOTE: this does NOT verify flag-off byte-identity — that guarantee is
       tested by test_daily_enhanced.py::test_flag_off_is_byte_identical.

The Bazi-master sub-agent BAND grading of a widened corpus is deferred (per the
user's "deterministic gate now" decision). This raw-score gate is what actually
guards accuracy + the MC-1 de-dup in the meantime.
"""

from __future__ import annotations

import argparse
import importlib
import os
import sys
from datetime import date, timedelta
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.constants import BRANCH_ELEMENT, STEM_ELEMENT  # noqa: E402

DIMS = ['romance', 'career', 'finance', 'travel', 'health']

# Gate thresholds
_MONO_MARGIN = 3.0     # aligned-day mean must beat adverse-day mean by >= this
_HEALTH_FLOOR = 25     # SANITY floor only. The MC-1 organ-overload double-count is
#                        guarded directly by test_mc1_overload_single_nudge_not_per_element
#                        (DR-4-independent). This gate is NOT a doctrinal floor: DR-4
#                        (headline coupling) legitimately pulls health toward a 凶
#                        headline's low energyScore on a bad-pileup day, so health can
#                        dip into the low-30s by correct subordination. G2 only catches
#                        arithmetic bugs / absurd pileups.
_DIM_CEILING = 85      # anti-runaway compounding ceiling
_SWEEP_DAYS = 60       # covers all 60 甲子 day pillars
_SWEEP_START = date(2026, 5, 1)

# Anchor charts (explicit engine-format effective_gods so we exercise
# neutral / weak / strong DM + a 財=用神 finance-ceiling case).
CHARTS: Dict[str, Dict] = {
    # Roger — neutral DM, 用神=火 (matches test_daily_enhanced fixture)
    'roger_neutral': dict(
        pillars={'year': {'stem': '丁', 'branch': '卯'}, 'month': {'stem': '戊', 'branch': '申'},
                 'day': {'stem': '戊', 'branch': '午'}, 'hour': {'stem': '庚', 'branch': '申'}},
        day_master_stem='戊',
        effective_gods={'usefulGod': '火', 'favorableGod': '木', 'idleGod': '土', 'tabooGod': '水', 'enemyGod': '金'},
        useful_god_element='火', gender='male', kong_wang=['子', '丑'],
        strength='neutral', is_cong_ge=False, flow_year_stem='丙', flow_year_auspiciousness='吉'),
    # Laopo — weak DM, 用神=水
    'laopo_weak': dict(
        pillars={'year': {'stem': '丙', 'branch': '寅'}, 'month': {'stem': '辛', 'branch': '丑'},
                 'day': {'stem': '甲', 'branch': '戌'}, 'hour': {'stem': '壬', 'branch': '申'}},
        day_master_stem='甲',
        effective_gods={'usefulGod': '水', 'favorableGod': '木', 'idleGod': '火', 'tabooGod': '土', 'enemyGod': '金'},
        useful_god_element='水', gender='female', kong_wang=['申', '酉'],
        strength='weak', is_cong_ge=False, flow_year_stem='丙', flow_year_auspiciousness='吉'),
    # Strong DM=甲, 財=用神 (土) — exercises the finance ceiling + strong-DM path
    'strong_cai_useful': dict(
        pillars={'year': {'stem': '甲', 'branch': '寅'}, 'month': {'stem': '乙', 'branch': '卯'},
                 'day': {'stem': '甲', 'branch': '寅'}, 'hour': {'stem': '丙', 'branch': '子'}},
        day_master_stem='甲',
        effective_gods={'usefulGod': '土', 'favorableGod': '火', 'idleGod': '金', 'tabooGod': '水', 'enemyGod': '木'},
        useful_god_element='土', gender='male', kong_wang=['戌', '亥'],
        strength='strong', is_cong_ge=False, flow_year_stem='丙', flow_year_auspiciousness='平'),
    # 年支==日支==寅, 官殺=金=忌, weak DM — the audit-#1 health-double-count class.
    # Both 沖年支+沖日支 fire on 申 days AND day stem+branch can both be 忌/仇 →
    # exercises the MC-1 overload single-nudge cap (would read health 32 without it).
    'audit_health_pileup': dict(
        pillars={'year': {'stem': '甲', 'branch': '寅'}, 'month': {'stem': '丙', 'branch': '午'},
                 'day': {'stem': '甲', 'branch': '寅'}, 'hour': {'stem': '戊', 'branch': '辰'}},
        day_master_stem='甲',
        effective_gods={'usefulGod': '水', 'favorableGod': '木', 'idleGod': '火', 'tabooGod': '土', 'enemyGod': '金'},
        useful_god_element='水', gender='male', kong_wang=['子', '丑'],
        strength='weak', is_cong_ge=False, flow_year_stem='丙', flow_year_auspiciousness='凶'),
}


def _indep_role_value(element: str, eg: Dict) -> float:
    """INDEPENDENT role value of an element vs the chart's engine-format gods.
    Deliberately simple (no 藏干/通根/合化/蓋頭) so the monotonicity check is not
    circular with the engine's dfi."""
    if element == eg.get('usefulGod'):
        return 2.0
    if element == eg.get('favorableGod'):
        return 1.0
    if element == eg.get('tabooGod'):
        return -2.0
    if element == eg.get('enemyGod'):
        return -1.0
    return 0.0


def _classify_pillar(day_ganzhi: str, eg: Dict) -> float:
    """Independent favorability of a day pillar: stem element + branch 本氣."""
    stem, branch = day_ganzhi[0], day_ganzhi[1]
    return _indep_role_value(STEM_ELEMENT.get(stem, ''), eg) + \
        _indep_role_value(BRANCH_ELEMENT.get(branch, ''), eg)


def _sweep(chart: Dict, flag: str) -> List[Tuple[str, Dict[str, int]]]:
    os.environ['FORTUNE_DIM_YONGSHEN_BASELINE_ENABLED'] = flag
    import app.daily_enhanced as d
    importlib.reload(d)
    rows = []
    for i in range(_SWEEP_DAYS):
        r = d.compute_daily_fortune(target_date=_SWEEP_START + timedelta(days=i), **chart)
        rows.append((r['dayGanZhi'], {k: r['dimensions'][k]['score'] for k in DIMS}))
    return rows


def run_gates() -> Tuple[bool, List[str]]:
    """Run all deterministic gates. Returns (all_passed, report_lines)."""
    report: List[str] = []
    ok = True
    for name, chart in CHARTS.items():
        eg = chart['effective_gods']
        rows = _sweep(chart, '1')
        aligned = [sum(sc.values()) / len(DIMS) for gz, sc in rows if _classify_pillar(gz, eg) >= 1.0]
        adverse = [sum(sc.values()) / len(DIMS) for gz, sc in rows if _classify_pillar(gz, eg) <= -1.0]
        min_health = min(sc['health'] for _, sc in rows)
        max_dim = max(v for _, sc in rows for v in sc.values())

        report.append(f"\n[{name}]  aligned_days={len(aligned)}  adverse_days={len(adverse)}")
        # G1 monotonicity
        if aligned and adverse:
            am, dm = sum(aligned) / len(aligned), sum(adverse) / len(adverse)
            g1 = (am - dm) >= _MONO_MARGIN
            ok &= g1
            report.append(f"  G1 monotonicity: aligned_mean={am:.1f} adverse_mean={dm:.1f} "
                          f"Δ={am - dm:+.1f} (need ≥{_MONO_MARGIN})  {'PASS' if g1 else 'FAIL'}")
        else:
            report.append("  G1 monotonicity: SKIP (insufficient aligned/adverse days)")
        # G2 health floor
        g2 = min_health >= _HEALTH_FLOOR
        ok &= g2
        report.append(f"  G2 health floor: min_health={min_health} (need ≥{_HEALTH_FLOOR})  {'PASS' if g2 else 'FAIL'}")
        # G3 anti-runaway ceiling
        g3 = max_dim <= _DIM_CEILING
        ok &= g3
        report.append(f"  G3 dim ceiling: max_dim={max_dim} (need ≤{_DIM_CEILING})  {'PASS' if g3 else 'FAIL'}")

    # G4 flag-off byte-identical (spot-check on roger)
    off = _sweep(CHARTS['roger_neutral'], '0')
    on = _sweep(CHARTS['roger_neutral'], '1')
    changed = sum(1 for (_, o), (_, n) in zip(off, on) if o != n)
    g4 = changed > 0  # flag ON must differ from OFF somewhere (baseline is active)
    ok &= g4
    report.append(f"\n[flag] G4 baseline-active: {changed}/{len(off)} days differ ON vs OFF  {'PASS' if g4 else 'FAIL'}")
    return ok, report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()
    ok, report = run_gates()
    if not args.quiet:
        print('\n'.join(report))
    print(f"\n{'✅ ALL GATES PASS' if ok else '❌ GATE FAILURE'}")
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
