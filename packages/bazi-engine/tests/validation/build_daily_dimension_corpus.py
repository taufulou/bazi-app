"""Dimension calibration corpus builder (用神-alignment baseline — full grading).

Companion to `build_daily_label_corpus.py`, but grades the 5 DIMENSION bands
(極佳/順遂/平穩/需謹慎/不利) rather than the single overall 吉凶 label. This is
the "gold-standard" pass deferred from the "deterministic gate now" decision.

Methodology (mirrors the label corpus):
- Engine columns are machine-generated (dim scores + labels + SIGNAL NAMES).
- Expert columns (`expected_{dim}_label`) are graded by a Bazi-master sub-agent
  that sees ONLY the day pillar + 十神 + signal NAMES + chart 用神 context +
  the day's overall auspiciousness — the dim SCORES/LABELS are WITHHELD, so the
  grade is independent (not anchoring on engine output).
- `--grader-view` prints exactly that withheld view for the sub-agent.
- The band gate then compares the engine's `derive_dimension_label(score)` to
  the expert band (within-1-band relaxed).

Run:
  python build_daily_dimension_corpus.py            # (re)build engine columns
  python build_daily_dimension_corpus.py --grader-view   # dump grader prompt view
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import date, timedelta
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.daily_enhanced import compute_daily_fortune  # noqa: E402

CORPUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_dimension_corpus.csv')

DIMS = ['romance', 'career', 'finance', 'travel', 'health']
DIM_ZH = {'romance': '感情', 'career': '事業', 'finance': '財運', 'travel': '出行', 'health': '健康'}

# ============================================================
# Anchor charts — 3 charts spanning neutral / very-weak / strong DM
# ============================================================
ROGER = {  # neutral DM 戊土, 用神=火 (matches test_daily_enhanced fixture)
    'pillars': {'year': {'stem': '丁', 'branch': '卯'}, 'month': {'stem': '戊', 'branch': '申'},
                'day': {'stem': '戊', 'branch': '午'}, 'hour': {'stem': '庚', 'branch': '申'}},
    'day_master_stem': '戊',
    'effective_gods': {'usefulGod': '火', 'favorableGod': '木', 'idleGod': '土', 'tabooGod': '水', 'enemyGod': '金'},
    'useful_god_element': '火', 'gender': 'male', 'kong_wang': ['子', '丑'],
    'strength': 'neutral', 'is_cong_ge': False, 'flow_year_stem': '丙', 'flow_year_auspiciousness': '吉',
    '_desc': 'DM 戊土 中和；用神=火(印), 喜神=木(官殺洩→印), 閒神=土(比劫), 忌神=水(財), 仇神=金(食傷)。男命。',
}
LAOPO = {  # very-weak DM 甲木, 用神=水(印)
    'pillars': {'year': {'stem': '丙', 'branch': '寅'}, 'month': {'stem': '辛', 'branch': '丑'},
                'day': {'stem': '甲', 'branch': '戌'}, 'hour': {'stem': '壬', 'branch': '申'}},
    'day_master_stem': '甲',
    'effective_gods': {'usefulGod': '水', 'favorableGod': '木', 'idleGod': '火', 'tabooGod': '金', 'enemyGod': '土'},
    'useful_god_element': '水', 'gender': 'female', 'kong_wang': ['申', '酉'],
    'strength': 'very_weak', 'is_cong_ge': False, 'flow_year_stem': '丙', 'flow_year_auspiciousness': '吉',
    '_desc': 'DM 甲木 極弱；用神=水(印), 喜神=木(比劫), 閒神=火(食傷), 忌神=金(官殺), 仇神=土(財)。女命。',
}
STRONG = {  # strong DM 甲木, 用神=土(財) — 財為用
    'pillars': {'year': {'stem': '甲', 'branch': '寅'}, 'month': {'stem': '乙', 'branch': '卯'},
                'day': {'stem': '甲', 'branch': '寅'}, 'hour': {'stem': '丙', 'branch': '子'}},
    'day_master_stem': '甲',
    'effective_gods': {'usefulGod': '土', 'favorableGod': '火', 'idleGod': '金', 'tabooGod': '水', 'enemyGod': '木'},
    'useful_god_element': '土', 'gender': 'male', 'kong_wang': ['戌', '亥'],
    'strength': 'strong', 'is_cong_ge': False, 'flow_year_stem': '丙', 'flow_year_auspiciousness': '平',
    '_desc': 'DM 甲木 偏強(比劫旺)；用神=土(財), 喜神=火(食傷生財), 閒神=金(官殺), 忌神=水(印), 仇神=木(比劫)。男命。',
}
ANCHORS = {'roger': ROGER, 'laopo': LAOPO, 'strong': STRONG}

DATE_START = date(2026, 5, 7)
N_DAYS = 10  # 3 charts × 10 days = 30 rows × 5 dims = 150 dimension grades

ENGINE_COLUMNS = ['chart_id', 'target_date', 'day_ganzhi', 'day_ten_god', 'dm_strength',
                  'useful_god', 'auspiciousness']
for _d in DIMS:
    ENGINE_COLUMNS += [f'{_d}_score', f'{_d}_label', f'{_d}_signals']
EXPERT_COLUMNS = [f'expected_{_d}_label' for _d in DIMS] + ['dim_reasoning', 'dim_citation', 'doctrinal_split']
ALL_COLUMNS = ENGINE_COLUMNS + EXPERT_COLUMNS


def _signal_names(dim: Dict[str, Any]) -> str:
    return '|'.join(s.get('type', '') for s in (dim.get('signals') or []) if s.get('type')) or '(none)'


def _compute(chart_id: str, target: date) -> Dict[str, Any]:
    inp = {k: v for k, v in ANCHORS[chart_id].items() if not k.startswith('_')}
    return compute_daily_fortune(target_date=target, **inp)


def build_row(chart_id: str, target: date) -> Dict[str, str]:
    r = _compute(chart_id, target)
    row = {c: '' for c in ALL_COLUMNS}
    row.update({
        'chart_id': chart_id, 'target_date': target.isoformat(),
        'day_ganzhi': r['dayGanZhi'], 'day_ten_god': r['dayTenGod'],
        'dm_strength': ANCHORS[chart_id]['strength'],
        'useful_god': ANCHORS[chart_id]['useful_god_element'],
        'auspiciousness': r['auspiciousness'],
    })
    for d in DIMS:
        dim = r['dimensions'][d]
        row[f'{d}_score'] = str(dim['score'])
        row[f'{d}_label'] = dim['label']
        row[f'{d}_signals'] = _signal_names(dim)
    return row


def _merge_existing(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Preserve already-filled EXPERT columns on rebuild (idempotent)."""
    if not os.path.exists(CORPUS_PATH):
        return rows
    prev = {}
    with open(CORPUS_PATH, newline='', encoding='utf-8') as f:
        for old in csv.DictReader(f):
            prev[(old['chart_id'], old['target_date'])] = old
    for row in rows:
        old = prev.get((row['chart_id'], row['target_date']))
        if old:
            for c in EXPERT_COLUMNS:
                if old.get(c):
                    row[c] = old[c]
    return rows


def build() -> None:
    rows = [build_row(cid, DATE_START + timedelta(days=i))
            for cid in ANCHORS for i in range(N_DAYS)]
    rows = _merge_existing(rows)
    with open(CORPUS_PATH, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=ALL_COLUMNS)
        w.writeheader()
        w.writerows(rows)
    print(f'Wrote {len(rows)} rows → {CORPUS_PATH}')


def grader_view() -> None:
    """Print the withheld-scores view for the Bazi-master sub-agent."""
    for cid in ANCHORS:
        print(f'\n{"="*70}\nCHART: {cid}  —  {ANCHORS[cid]["_desc"]}\n{"="*70}')
        for i in range(N_DAYS):
            target = DATE_START + timedelta(days=i)
            r = _compute(cid, target)
            print(f'\n--- {cid}@{target.isoformat()}  day pillar {r["dayGanZhi"]} '
                  f'(day 十神={r["dayTenGod"]})  | 當日整體={r["auspiciousness"]} ---')
            for d in DIMS:
                print(f'  {DIM_ZH[d]}({d}) signals: {_signal_names(r["dimensions"][d])}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--grader-view', action='store_true')
    args = ap.parse_args()
    if args.grader_view:
        grader_view()
    else:
        build()
