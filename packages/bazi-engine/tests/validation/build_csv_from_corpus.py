"""
Convert validation_corpus.json → expert_labeled_charts.csv.

Reads the JSON corpus produced by the bazi-master research agent and emits
the CSV consumed by run_imbalance_validation.py. Performs:

  - Pillar parity validation (yang stem ↔ yang branch, yin ↔ yin)
  - Deduplication by (year_pillar, month_pillar, day_pillar, hour_pillar, gender)
  - Schema completeness check (all required columns present)

Usage:
    python tests/validation/build_csv_from_corpus.py

Reads from:  .claude/plans/validation_corpus.json
Writes to:   tests/validation/expert_labeled_charts.csv
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

# 60甲子 parity: yang stems pair with yang branches, yin with yin.
YANG_STEMS = set('甲丙戊庚壬')
YIN_STEMS = set('乙丁己辛癸')
YANG_BRANCHES = set('子寅辰午申戌')
YIN_BRANCHES = set('丑卯巳未酉亥')

VALID_ELEMENTS = {'木', '火', '土', '金', '水'}
VALID_DOMINANT = {
    '食傷旺', '財旺', '官殺旺', '印旺', '比劫旺', 'general', 'cong_overridden',
}
VALID_STRENGTHS = {'very_weak', 'weak', 'neutral', 'strong', 'very_strong'}
VALID_LABEL_SOURCES = {
    'canonical_anchor', 'ziping_zhenquan', 'ditian_sui',
    'qiongtong_baojian', 'edge_case',
}

CSV_COLUMNS = [
    'chart_id', 'label_source', 'gender',
    'year_pillar', 'month_pillar', 'day_pillar', 'hour_pillar',
    'expected_dm_strength', 'expected_dominant',
    'expected_yong_shen', 'expected_xi_shen',
    'is_cong_ge', 'source_citation', 'reasoning', 'confidence',
]


def _validate_pillar(pillar: str, label: str) -> List[str]:
    errs: List[str] = []
    if len(pillar) != 2:
        errs.append(f'{label} "{pillar}": must be exactly 2 chars')
        return errs
    stem, branch = pillar[0], pillar[1]
    if stem not in YANG_STEMS and stem not in YIN_STEMS:
        errs.append(f'{label} "{pillar}": "{stem}" is not a valid stem')
    if branch not in YANG_BRANCHES and branch not in YIN_BRANCHES:
        errs.append(f'{label} "{pillar}": "{branch}" is not a valid branch')
    if stem in YANG_STEMS and branch in YIN_BRANCHES:
        errs.append(f'{label} "{pillar}": yang stem "{stem}" cannot pair '
                    f'with yin branch "{branch}" (60甲子 violation)')
    if stem in YIN_STEMS and branch in YANG_BRANCHES:
        errs.append(f'{label} "{pillar}": yin stem "{stem}" cannot pair '
                    f'with yang branch "{branch}" (60甲子 violation)')
    return errs


def _validate_chart(chart: Dict, idx: int) -> List[str]:
    errs: List[str] = []
    cid = chart.get('chart_id', f'<row {idx}>')
    prefix = f'[{cid}]'

    for col in ['chart_id', 'label_source', 'gender',
                'year_pillar', 'month_pillar', 'day_pillar', 'hour_pillar',
                'expected_dm_strength', 'expected_dominant',
                'expected_yong_shen', 'expected_xi_shen', 'is_cong_ge']:
        if col not in chart:
            errs.append(f'{prefix} missing required field: {col}')

    if errs:
        return errs

    if chart['gender'] not in ('male', 'female'):
        errs.append(f'{prefix} gender must be male|female, got "{chart["gender"]}"')

    if chart['label_source'] not in VALID_LABEL_SOURCES:
        errs.append(f'{prefix} label_source "{chart["label_source"]}" '
                    f'not in {sorted(VALID_LABEL_SOURCES)}')

    if chart['expected_dm_strength'] not in VALID_STRENGTHS:
        errs.append(f'{prefix} expected_dm_strength "{chart["expected_dm_strength"]}" '
                    f'not in {sorted(VALID_STRENGTHS)}')

    if chart['expected_dominant'] not in VALID_DOMINANT:
        errs.append(f'{prefix} expected_dominant "{chart["expected_dominant"]}" '
                    f'not in {sorted(VALID_DOMINANT)}')

    if chart['expected_yong_shen'] not in VALID_ELEMENTS:
        errs.append(f'{prefix} expected_yong_shen "{chart["expected_yong_shen"]}" '
                    f'not a valid element')

    if chart['expected_xi_shen'] not in VALID_ELEMENTS:
        errs.append(f'{prefix} expected_xi_shen "{chart["expected_xi_shen"]}" '
                    f'not a valid element')

    for col in ['year_pillar', 'month_pillar', 'day_pillar', 'hour_pillar']:
        errs.extend([f'{prefix} {e}' for e in _validate_pillar(chart[col], col)])

    return errs


def _dedup_key(chart: Dict) -> Tuple[str, str, str, str, str]:
    return (
        chart['year_pillar'],
        chart['month_pillar'],
        chart['day_pillar'],
        chart['hour_pillar'],
        chart['gender'],
    )


def main() -> int:
    here = Path(__file__).resolve().parent
    repo_root = here.parents[3]   # validation/ → tests/ → bazi-engine/ → packages/ → repo
    corpus_path = repo_root / '.claude' / 'plans' / 'validation_corpus.json'
    csv_path = here / 'expert_labeled_charts.csv'

    if not corpus_path.exists():
        print(f'❌ corpus JSON not found at {corpus_path}')
        return 2

    with corpus_path.open('r', encoding='utf-8') as f:
        corpus = json.load(f)

    charts: List[Dict] = corpus['charts']
    print(f'Read {len(charts)} chart(s) from {corpus_path.name}')

    # Validate all charts
    all_errs: List[str] = []
    for i, c in enumerate(charts):
        all_errs.extend(_validate_chart(c, i))
    if all_errs:
        print(f'❌ {len(all_errs)} validation error(s):')
        for e in all_errs:
            print(f'   - {e}')
        return 1

    # Deduplicate
    seen: Set[Tuple[str, str, str, str, str]] = set()
    deduped: List[Dict] = []
    dropped: List[str] = []
    for c in charts:
        key = _dedup_key(c)
        if key in seen:
            dropped.append(f'{c["chart_id"]} (duplicate of '
                           f'{c["year_pillar"]}{c["month_pillar"]}'
                           f'{c["day_pillar"]}{c["hour_pillar"]} {c["gender"]})')
            continue
        seen.add(key)
        deduped.append(c)

    if dropped:
        print(f'Deduplicated: dropped {len(dropped)} duplicate(s):')
        for d in dropped:
            print(f'   - {d}')

    # Diversity report
    by_source: Dict[str, int] = {}
    by_dm: Dict[str, int] = {}
    by_gender: Dict[str, int] = {}
    for c in deduped:
        by_source[c['label_source']] = by_source.get(c['label_source'], 0) + 1
        dm = c['day_pillar'][0]
        by_dm[dm] = by_dm.get(dm, 0) + 1
        by_gender[c['gender']] = by_gender.get(c['gender'], 0) + 1

    print(f'\nFinal corpus: {len(deduped)} chart(s)')
    print(f'  By source: {dict(sorted(by_source.items()))}')
    print(f'  By DM stem: {dict(sorted(by_dm.items()))}')
    print(f'  By gender: {dict(sorted(by_gender.items()))}')

    # Write CSV
    with csv_path.open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for c in deduped:
            row = {col: c.get(col, '') for col in CSV_COLUMNS}
            row['is_cong_ge'] = '1' if c['is_cong_ge'] else '0'
            writer.writerow(row)

    print(f'\n✅ Wrote {csv_path.relative_to(repo_root)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
