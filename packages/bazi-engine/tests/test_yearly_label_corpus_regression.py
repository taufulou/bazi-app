"""
Phase 3.x Yearly Fortune — Calibration corpus pytest regression hook.

Mirrors `test_monthly_label_corpus_regression.py` for the YEAR scope.
Locks the relaxed-gate agreement at `RELAXED_GATE_PCT` so future engine
drift is CAUGHT. Strict-gate is REPORTED only (not enforced).

Initial baseline (2026-05-30, first calibration cycle, 21 rows = 3 charts
[roger 用神火 / laopo 用神水 / jenna 用神水] × 7 flow years 2024-2030):
  STRICT:  33.3% (6/18 exact, 3 doctrinal-splits excluded)
  RELAXED: 61.9% (13/21 within 1 ladder step)

**Engine bias finding** (surfaced by this corpus on first run — the WHOLE
POINT of building it):
The YEAR `auspiciousness` is derived from `flowYear.auspiciousness` (the
annual-pipeline verdict). The Bazi-master grader found the engine's
sign/direction is unreliable: it appears anchored on 流年天干 十神 THEME
polarity (官殺→凶, 比劫/食傷→吉) rather than the doctrinally-primary
流年干支-vs-用神 五行 ALIGNMENT. Concretely, for roger (用神=火) the engine
INVERTS 木火 years (scored 乙巳/甲辰 as 凶 — but 木生火用神 → should be 吉) vs
金 years (scored 戊申/己酉 as 吉 — but 金洩火克木 → should be adverse). The two
水-用神 charts (laopo/jenna) get over-harsh 大凶 on 火 years where 凶中有吉 is
correct. 8 of 21 rows are ≥2 ladder steps off.

The magnitude ladder tracks OK (roger 丙午/丁未 = 大吉 correct; laopo 庚戌 = 凶
correct) — it's the direction that drifts.

Initial gate at 55.0% (just below the 61.9% baseline with ~7pp headroom) locks
the current baseline so future drift is caught, while keeping CI green. After
engine tuning addresses the 用神-alignment direction bias (Phase 3.x.2 candidate
— yearly equivalent of the daily Option 2.5 / monthly 平-bias refinements),
bump to 70 then 80 to match daily's quality bar.

Reasoning for NOT failing on baseline (same as monthly precedent):
- The YEAR engine reuses the mature annual pipeline; this corpus is the FIRST
  systematic label-accuracy measurement of it. Baseline is exploratory.
- A gate at 80% would block CI immediately + force premature engine tuning.
- Locking baseline gives regression coverage NOW; tuning unlocks the higher bar.

Plan reference: `/Users/roger/.claude/plans/ok-next-big-feature-merry-cake.md`
  search «Yearly calibration corpus».
"""

from __future__ import annotations

import csv
import os
import subprocess
import sys

import pytest

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'validation', 'yearly_label_corpus.csv',
)
VALIDATION_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'validation', 'run_yearly_label_validation.py',
)

# Relaxed-gate threshold — locked just below the 61.9% baseline (measured
# 2026-05-30) with ~7pp headroom. See module docstring for the 用神-alignment
# direction-bias finding + Phase 3.x.2 tuning roadmap.
RELAXED_GATE_PCT = 55.0


def _count_graded_rows() -> int:
    if not os.path.exists(CORPUS_PATH):
        return 0
    with open(CORPUS_PATH, encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        return sum(1 for row in reader if row.get('expected_overall_label', '').strip())


def test_yearly_label_corpus_exists():
    """Corpus CSV file must exist."""
    assert os.path.exists(CORPUS_PATH), (
        f'Yearly label corpus not found at {CORPUS_PATH}. '
        f'Run `python tests/validation/build_yearly_label_corpus.py` first.'
    )


def test_yearly_label_corpus_relaxed_gate():
    """Engine agreement with sub-agent grading must clear the relaxed gate.

    Within-1-step on the 9-label severity ladder is acceptable per
    «年運 doctrine is interpretive» principle. SKIPPED if no rows graded yet.
    """
    if _count_graded_rows() == 0:
        pytest.skip(
            'Yearly corpus has no graded rows yet — run the Bazi-master '
            'sub-agent grading pass + populate_yearly_label_corpus.py before '
            'this gate activates.'
        )

    result = subprocess.run(
        [sys.executable, VALIDATION_SCRIPT, f'--relaxed-gate={RELAXED_GATE_PCT}'],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        pytest.fail(
            f'Yearly label corpus relaxed gate FAILED at threshold '
            f'{RELAXED_GATE_PCT}%. See harness output above.'
        )
