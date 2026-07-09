"""Pytest gate for the 用神-alignment 5-dimension baseline (Plan Phase 1, MC-2).

Enforces the DETERMINISTIC raw-score gates from
`tests/validation/run_daily_dimension_validation.py`:
  - G1 monotonicity (用神-aligned days score higher than 忌神 days)
  - G2 health floor (MC-1 no-double-count)
  - G3 anti-runaway ceiling
  - G4 baseline active under the flag

The Bazi-master BAND-grade corpus is deferred (per the "deterministic gate now"
decision); this raw-score gate is what guards accuracy in the meantime.
"""

import importlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'validation'))

import run_daily_dimension_validation as gate  # noqa: E402


def test_dimension_baseline_deterministic_gates_pass():
    ok, report = gate.run_gates()
    assert ok, '用神-alignment dimension gate FAILED:\n' + '\n'.join(report)


def test_monotonicity_margin_per_chart():
    """Each anchor chart: aligned-day mean must beat adverse-day mean by margin."""
    for name, chart in gate.CHARTS.items():
        eg = chart['effective_gods']
        rows = gate._sweep(chart, '1')
        aligned = [sum(sc.values()) / len(gate.DIMS) for gz, sc in rows if gate._classify_pillar(gz, eg) >= 1.0]
        adverse = [sum(sc.values()) / len(gate.DIMS) for gz, sc in rows if gate._classify_pillar(gz, eg) <= -1.0]
        assert aligned and adverse, f'{name}: need both aligned+adverse days in sweep'
        delta = sum(aligned) / len(aligned) - sum(adverse) / len(adverse)
        assert delta >= gate._MONO_MARGIN, f'{name}: monotonicity Δ={delta:.1f} < {gate._MONO_MARGIN}'


def test_health_floor_guards_mc1_double_count():
    for name, chart in gate.CHARTS.items():
        rows = gate._sweep(chart, '1')
        min_health = min(sc['health'] for _, sc in rows)
        assert min_health >= gate._HEALTH_FLOOR, f'{name}: health floor {min_health} < {gate._HEALTH_FLOOR} (MC-1 double-count?)'


def teardown_module(_module):
    # restore default flag + reload so other suites see the shipped default
    os.environ.pop('FORTUNE_DIM_YONGSHEN_BASELINE_ENABLED', None)
    import app.daily_enhanced as d
    importlib.reload(d)
