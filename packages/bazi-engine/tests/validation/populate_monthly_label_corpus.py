"""
Phase 2.x.1 Monthly Fortune — Calibration corpus populator.

Takes the Bazi-master sub-agent's grading output (see GRADING PROMPT in
the plan file's Task 4.3) and merges `expected_*` columns into
`monthly_label_corpus.csv`.

Run AFTER `build_monthly_label_corpus.py` populates the engine columns.
This script is idempotent — re-running re-applies the same grading without
duplicating rows (uses (chart_id, target_year, target_month) as key).

Plan reference: `/Users/roger/.claude/plans/ok-next-big-feature-merry-cake.md`
  search «# Phase 2.x.1 — Polish Bundle» Task 4.4.
"""

from __future__ import annotations

import csv
import os
import sys
from typing import Dict, List, Tuple

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'monthly_label_corpus.csv',
)


# ============================================================
# Sub-agent grading output (verbatim from 2026-05-29 sub-agent run)
# ============================================================
#
# Each entry: (row_id, expected_label, expected_dim_match, doctrinal_split,
#              reasoning, citation)
# row_id format: "chart@YYYY-MM" (e.g., "roger@2026-05")
#
# Grader methodology: Independent classical 子平 verdict considering chart's
# 用神/喜神/忌神/仇神 vs 流月 干支 + flow_year context + natal pillar interactions
# (沖刑害合) + 蓋頭/截腳 + 伏吟. Reasoning cites the load-bearing mechanism.

GRADER_OUTPUT: List[Tuple[str, str, str, str, str, str]] = [
    # ---- Roger 2026 (DM=戊 neutral; 用神=火 喜神=木 忌神=水 仇神=金) ----
    ('roger@2026-01', '凶中有吉', '', 'no',
     '己丑月劫財透干仇神丑土生金洩火,丑沖未未中藏丁火受牽,但2025乙巳年巳火助用神,整體偏弱中見救。',
     '三命通會·論月運'),
    ('roger@2026-02', '吉中有凶', '', 'no',
     '庚寅月食神坐偏財,寅木為喜神生火用神,然庚金仇神蓋頭洩月令火氣,流年丙午助火可解半,得失參半。',
     '滴天髓·體用論'),
    ('roger@2026-03', '凶中有吉', '', 'no',
     '辛卯月傷官坐桃花喜神,卯木生火可用,惟辛金仇神截腳忌神水未顯,卯申暗合化水傷用,需防情緒口舌。',
     '子平真詮·論傷官'),
    ('roger@2026-04', '凶', '', 'no',
     '壬辰月偏財透忌神水克用神火,辰土仇神洩火,辰戌相沖開庫釋放,雙申金生水加劇,財來財去且健康宜防。',
     '滴天髓·論墓庫'),
    ('roger@2026-05', '吉', '', 'no',
     '癸巳月正財坐巳火用神位,雖癸水忌神透干但被巳火截腳大幅減力,巳午合火局得令,流年丙午助勢,財旺身強。',
     '窮通寶鑑·夏火'),
    ('roger@2026-06', '大吉', '', 'no',
     '甲午月偏官坐用神祿位,甲木喜神生丙火用神,午為DM帝旺得地祿,流年丙午雙重用神助勢,煞印相生格成。',
     '子平真詮·論偏官'),
    ('roger@2026-07', '吉', '', 'no',
     '乙未月正官坐火墓庫,乙木喜神透干生用神火,未中藏丁己幫身,然官星非Roger用神宜慎,得令而非大利。',
     '三命通會·論正官'),
    ('roger@2026-08', '凶', '', 'no',
     '丙申月偏印坐仇神,雖丙火用神透干但被申金截腳大半,雙申並現伏吟月時兩柱,申金克卯喜神,生忌神水。',
     '滴天髓·伏吟論'),
    ('roger@2026-09', '吉中有凶', '', 'no',
     '丁酉月正印坐桃花,丁火用神透干助身,然酉金仇神為祿旺克卯喜神,卯酉相沖傷喜神根,得失參半。',
     '子平真詮·論正印'),
    ('roger@2026-10', '凶', '', 'no',
     '戊戌月比肩坐火墓庫,戊土洩火非用神位,辰戌沖年月而戌中藏丁火被牽,雙申生水忌神勢漸盛,健康財運堪憂。',
     '三命通會·論比劫'),
    ('roger@2026-11', '大凶', '', 'yes',
     '己亥月劫財坐忌神絕地,亥水忌神當令克火用神,己土仇神助金水勢,亥申相害,流年午火被亥水克;另派或論平。',
     '滴天髓·論病藥'),
    ('roger@2026-12', '大凶', '', 'no',
     '庚子月食神坐忌神帝旺,庚金仇神透干洩用神火,子水忌神當令,子午沖日支午用神祿位被破,雙申生水勢猛。',
     '滴天髓·體用論'),
    # ---- Laopo 2026 (DM=甲 very_weak; 用神=水 喜神=木 忌神=金 仇神=土) ----
    ('laopo@2026-01', '平', '', 'no',
     '己丑月正財透干,丑為金庫且伏吟年支寅之對宮丑庫,財旺身弱不能任,然流年乙巳巳火洩金生木助DM,平。',
     '子平真詮·論財格'),
    ('laopo@2026-02', '吉', '', 'no',
     '庚寅月偏官透干甲DM絕於申對沖,然寅為DM臨官祿位且為喜神,寅申沖被流月寅化解部分,煞旺有制。',
     '三命通會·論偏官'),
    ('laopo@2026-03', '大吉', '', 'no',
     '辛卯月正官透干坐DM羊刃,卯為甲DM帝旺得令,辛金官星雖忌但落卯絕之截腳,財官印俱現感情事業俱旺。',
     '滴天髓·論用神'),
    ('laopo@2026-04', '凶', '', 'no',
     '壬辰月偏印透用神水,然辰戌沖natal戌庫,辰土仇神坐位,壬水雖印星但弱不堪用,辰申半合水局只能解一時。',
     '渊海子平·論偏印'),
    ('laopo@2026-05', '吉中有凶', '', 'no',
     '癸巳月正印透用神水,巳火生戌仇神且巳申半合化水似有救,然巳火洩DM甲木喜神,印星雖透根淺,平中見小利。',
     '窮通寶鑑·春木'),
    ('laopo@2026-06', '大凶', '', 'no',
     '甲午月比肩透坐忌神絕地午火,午為DM死地且洩DM甲木,午戌半合火局洩盡日主氣,弱身遇洩無印化大凶。',
     '滴天髓·論衰旺'),
    ('laopo@2026-07', '凶', '', 'no',
     '乙未月劫財透干坐火庫,未為DM墓且洩木氣,丑未沖natal月支金庫破財,劫財奪財弱身雪上加霜。',
     '三命通會·論劫財'),
    ('laopo@2026-08', '大凶', '', 'no',
     '丙申月食神透坐DM絕地,申為甲DM絕,寅申沖年柱DM祿位,雙申並現伏吟煞重,食神洩弱身無印化危。',
     '滴天髓·論絕地'),
    ('laopo@2026-09', '凶', '', 'no',
     '丁酉月傷官透坐忌神祿位,酉為金祿克DM甲木,傷官見官(辛natal)且洩弱DM,丑酉半合金局加重忌神勢。',
     '子平真詮·論傷官見官'),
    ('laopo@2026-10', '凶中有吉', '', 'no',
     '戊戌月偏財透坐火庫,戊土仇神洩DM,然戌中藏丁火洩金生土循環有變,辰戌沖未現,流年丙午生戌土加負,小險。',
     '滴天髓·論墓庫'),
    ('laopo@2026-11', '吉', '', 'no',
     '己亥月正財透坐用神水祿位,亥水生甲DM得長生,雖己土仇神透但被亥水洩入用神,流年丙午被亥水沖解金勢。',
     '窮通寶鑑·冬木'),
    ('laopo@2026-12', '凶', '', 'yes',
     '庚子月偏官透坐用神水帝旺,子水當令生甲DM似吉,然庚金煞星透干克DM且子申半合水局過旺反成水多木漂;另派論吉。',
     '滴天髓·論煞'),
]


def _parse_row_id(row_id: str) -> Tuple[str, str, str]:
    """Parse 'roger@2026-05' → ('roger', '2026', '05')."""
    chart_id, year_month = row_id.split('@')
    year, month = year_month.split('-')
    return chart_id.strip(), year.strip(), month.strip()


def main() -> int:
    if not os.path.exists(CORPUS_PATH):
        print(f'ERROR: corpus CSV not found at {CORPUS_PATH}', file=sys.stderr)
        print('Run `python tests/validation/build_monthly_label_corpus.py` first',
              file=sys.stderr)
        return 1

    # Load existing rows
    with open(CORPUS_PATH, encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
        fieldnames = reader.fieldnames or []

    # Build a lookup from grader output
    grades: Dict[Tuple[str, str, str], Dict[str, str]] = {}
    for row_id, label, dim_match, split, reasoning, citation in GRADER_OUTPUT:
        chart_id, year, month = _parse_row_id(row_id)
        grades[(chart_id, year, month)] = {
            'expected_overall_label': label,
            'expected_dim_overall_match': dim_match,
            'doctrinal_split': split,
            'reasoning': reasoning,
            'citation': citation,
        }

    # Merge into rows
    merged_count = 0
    for row in rows:
        key = (row['chart_id'], row['target_year'], row['target_month'])
        if key in grades:
            for col, val in grades[key].items():
                row[col] = val
            merged_count += 1

    # Write back
    with open(CORPUS_PATH, 'w', encoding='utf-8', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    print(f'Populated {merged_count}/{len(rows)} rows with sub-agent grades')
    print(f'CSV: {CORPUS_PATH}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
