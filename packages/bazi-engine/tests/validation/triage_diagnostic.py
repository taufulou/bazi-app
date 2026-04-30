"""
Diagnostic dumper for triage of Fix 1a validation harness disagreements.

For each chart in expert_labeled_charts.csv, prints a detailed reasoning
dump showing the engine's full classification chain side-by-side with
the corpus expectation, in both flag-OFF and flag-ON modes.

Output is plain text suitable for human review (or LLM triage).

Usage:
    python tests/validation/triage_diagnostic.py [chart_id_substring]

If a substring is given, only matching charts are dumped (useful for
focusing on one chart at a time during triage).
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

_HERE = Path(__file__).resolve()
_ENGINE_ROOT = _HERE.parents[2]
if str(_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_ENGINE_ROOT))


def _csv_path() -> Path:
    return Path(__file__).parent / 'expert_labeled_charts.csv'


def _corpus_path() -> Path:
    return _ENGINE_ROOT.parents[1] / '.claude' / 'plans' / 'validation_corpus.json'


def _row_to_pillars(row: Dict[str, str]) -> Dict[str, Dict[str, str]]:
    return {
        'year':  {'stem': row['year_pillar'][0],  'branch': row['year_pillar'][1]},
        'month': {'stem': row['month_pillar'][0], 'branch': row['month_pillar'][1]},
        'day':   {'stem': row['day_pillar'][0],   'branch': row['day_pillar'][1]},
        'hour':  {'stem': row['hour_pillar'][0],  'branch': row['hour_pillar'][1]},
    }


def _dump_one(row: Dict[str, str], reasoning: str) -> str:
    from app import five_elements as fe
    from app.five_elements import (
        _detect_dominant_imbalance,
        determine_favorable_gods,
    )
    from app.interpretation_rules import calculate_strength_score_v2
    from app.ten_gods import (
        compute_weighted_category_scores,
        get_ten_god_distribution,
    )

    pillars = _row_to_pillars(row)
    dm = pillars['day']['stem']
    is_cong = row['is_cong_ge'].strip().lower() in ('1', 'true', 'yes')

    out: List[str] = []
    out.append('=' * 78)
    out.append(f"CHART: {row['chart_id']}  ({row['label_source']})")
    out.append(f"  Pillars: {row['year_pillar']} {row['month_pillar']} "
               f"{row['day_pillar']} {row['hour_pillar']}  "
               f"DM={dm}  gender={row['gender']}  is_cong_ge={is_cong}")
    out.append(f"  Citation: {row.get('source_citation', '')}")
    out.append('')
    out.append('CORPUS EXPECTATION:')
    out.append(f"  expected_dm_strength: {row['expected_dm_strength']}")
    out.append(f"  expected_dominant   : {row['expected_dominant']}")
    out.append(f"  expected_yong_shen  : {row['expected_yong_shen']}")
    out.append(f"  expected_xi_shen    : {row['expected_xi_shen']}")
    out.append(f"  reasoning           : {reasoning}")
    out.append('')

    str_v2 = calculate_strength_score_v2(pillars, dm)
    out.append(f"V2 STRENGTH: classification={str_v2['classification']}  "
               f"score={str_v2['score']}")
    factors = str_v2.get('factors', {})
    if factors:
        out.append(f"  factors: 得令={factors.get('deling', '?')}  "
                   f"得地={factors.get('dedi', '?')}  "
                   f"得勢={factors.get('deshi', '?')}")

    tgd = get_ten_god_distribution(pillars, dm)
    raw_summary = ', '.join(f'{k}={v}' for k, v in tgd.items() if v > 0)
    out.append(f"TEN GOD RAW: {raw_summary}")

    weighted = compute_weighted_category_scores(pillars, dm)
    cats = weighted['categories']
    cat_summary = ', '.join(f'{k}={v}' for k, v in cats.items() if v > 0)
    out.append(f"WEIGHTED CATEGORIES: {cat_summary}")
    transp = weighted['category_transparent_count']
    transp_summary = ', '.join(f'{k}={v}' for k, v in transp.items() if v > 0)
    if transp_summary:
        out.append(f"  transparent counts: {transp_summary}")
    monthly = [k for k, v in weighted['category_month_benqi'].items() if v]
    if monthly:
        out.append(f"  month 本氣 carriers: {monthly}")
    out.append('')

    for flag in (False, True):
        fe._USE_WEIGHTED_IMBALANCE = flag
        dom = _detect_dominant_imbalance(
            tgd, str_v2['classification'],
            pillars=pillars, day_master_stem=dm, is_cong_ge=is_cong)
        fav = determine_favorable_gods(
            dm, str_v2['classification'], tgd,
            pillars=pillars, is_cong_ge=is_cong)
        mode = 'ON ' if flag else 'OFF'
        match_dom = '✓' if (dom == row['expected_dominant']
                             or row['expected_dominant'] == 'general') else '✗'
        match_yong = '✓' if fav['usefulGod'] == row['expected_yong_shen'] else '✗'
        out.append(f"FLAG={mode} engine output:")
        out.append(f"  dominant   : {dom}  vs expected={row['expected_dominant']}  {match_dom}")
        out.append(f"  用神       : {fav['usefulGod']}  vs expected={row['expected_yong_shen']}  {match_yong}")
        out.append(f"  喜神       : {fav['favorableGod']}  vs expected={row['expected_xi_shen']}")
        out.append(f"  忌仇閒     : taboo={fav['tabooGod']}  enemy={fav['enemyGod']}  idle={fav['idleGod']}")

    out.append('')
    return '\n'.join(out)


def main() -> int:
    csv_file = _csv_path()
    corpus_file = _corpus_path()

    if not csv_file.exists():
        print(f'CSV not found: {csv_file}')
        return 2
    if not corpus_file.exists():
        print(f'Corpus JSON not found: {corpus_file}')
        return 2

    with corpus_file.open('r', encoding='utf-8') as f:
        corpus = json.load(f)
    reasoning_by_id = {c['chart_id']: c.get('reasoning', '') for c in corpus['charts']}

    rows: List[Dict[str, str]] = []
    with csv_file.open('r', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    filt = sys.argv[1] if len(sys.argv) > 1 else None
    selected = [r for r in rows if (filt is None or filt in r['chart_id'])]
    print(f'Dumping {len(selected)} of {len(rows)} chart(s)')
    print()

    for row in selected:
        print(_dump_one(row, reasoning_by_id.get(row['chart_id'], '')))

    return 0


if __name__ == '__main__':
    sys.exit(main())
