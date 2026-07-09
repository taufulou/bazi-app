"""Band-agreement gate for the 用神-alignment 5-dimension baseline (full grading).

Compares the engine's per-dimension band (`derive_dimension_label(score)`, stored
as `{dim}_label` in daily_dimension_corpus.csv) against the Bazi-master sub-agent's
independent band (`expected_{dim}_label`), on the 5-band ladder:

    極佳(0) > 順遂(1) > 平穩(2) > 需謹慎(3) > 不利(4)

- STRICT = exact band match (distance 0)
- RELAXED = within 1 band (distance ≤ 1)

Reports overall + per-dimension + per-chart agreement and lists every ≥2-band
mismatch (the calibration signal the deterministic gate can't see).

Run after populating expert columns:
  python run_daily_dimension_band_validation.py
"""

from __future__ import annotations

import csv
import os
import sys
from collections import defaultdict

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_dimension_corpus.csv')
DIMS = ['romance', 'career', 'finance', 'travel', 'health']
BANDS = ['極佳', '順遂', '平穩', '需謹慎', '不利']
POS = {b: i for i, b in enumerate(BANDS)}
RELAXED_GATE = 85.0  # within-1-band agreement target


def _dist(a: str, b: str):
    if a not in POS or b not in POS:
        return None
    return abs(POS[a] - POS[b])


def agreement():
    """Return (strict_pct, relaxed_pct, n, mismatches) — importable by the pytest gate."""
    with open(CORPUS, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    graded = [r for r in rows if any(r.get(f'expected_{d}_label') for d in DIMS)]
    total = strict = relaxed = 0
    mism = []
    for r in graded:
        for d in DIMS:
            dist = _dist(r.get(f'{d}_label', ''), r.get(f'expected_{d}_label', ''))
            if dist is None:
                continue
            total += 1
            strict += dist == 0
            relaxed += dist <= 1
            if dist >= 2:
                mism.append((r['chart_id'], r['target_date'], d, r.get(f'{d}_label'), r.get(f'expected_{d}_label')))
    if not total:
        return 0.0, 0.0, 0, []
    return 100 * strict / total, 100 * relaxed / total, total, mism


def run():
    with open(CORPUS, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    graded = [r for r in rows if any(r.get(f'expected_{d}_label') for d in DIMS)]
    if not graded:
        print('No expert grades populated yet.')
        return False

    total = strict = relaxed = 0
    per_dim = defaultdict(lambda: [0, 0, 0])   # dim -> [n, strict, relaxed]
    per_chart = defaultdict(lambda: [0, 0, 0])
    mism = []
    for r in graded:
        for d in DIMS:
            eng, exp = r.get(f'{d}_label', ''), r.get(f'expected_{d}_label', '')
            dist = _dist(eng, exp)
            if dist is None:
                continue
            total += 1
            per_dim[d][0] += 1
            per_chart[r['chart_id']][0] += 1
            if dist == 0:
                strict += 1; per_dim[d][1] += 1; per_chart[r['chart_id']][1] += 1
            if dist <= 1:
                relaxed += 1; per_dim[d][2] += 1; per_chart[r['chart_id']][2] += 1
            if dist >= 2:
                mism.append((r['chart_id'], r['target_date'], r['day_ganzhi'], d,
                             f'engine={eng}', f'expert={exp}', f'score={r.get(f"{d}_score")}',
                             f'signals={r.get(f"{d}_signals")}'))

    sp, rp = 100 * strict / total, 100 * relaxed / total
    print(f'\n=== Dimension band agreement (n={total} dimension-grades) ===')
    print(f'  STRICT  (exact band): {strict}/{total} = {sp:.1f}%')
    print(f'  RELAXED (±1 band):    {relaxed}/{total} = {rp:.1f}%  (gate ≥{RELAXED_GATE}%)')
    print('\n  per-dimension (relaxed):')
    for d in DIMS:
        n, s, rl = per_dim[d]
        if n:
            print(f'    {d:8s} strict={100*s/n:5.1f}%  relaxed={100*rl/n:5.1f}%  (n={n})')
    print('\n  per-chart (relaxed):')
    for c, (n, s, rl) in per_chart.items():
        print(f'    {c:8s} strict={100*s/n:5.1f}%  relaxed={100*rl/n:5.1f}%  (n={n})')
    if mism:
        print(f'\n  ≥2-band MISMATCHES ({len(mism)}) — calibration signal:')
        for m in mism:
            print('    ' + '  '.join(m))
    ok = rp >= RELAXED_GATE
    print(f"\n{'✅ BAND GATE PASS' if ok else '⚠️  BELOW RELAXED GATE'}")
    return ok


if __name__ == '__main__':
    sys.exit(0 if run() else 1)
