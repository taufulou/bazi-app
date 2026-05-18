"""
Phase 1 Daily Fortune — A3 corpus populator.

Takes the Bazi-master sub-agent's grading output (see GRADING_PROMPT in this
file's docstring) and merges expected_* columns into `daily_label_corpus.csv`.

The grader output format is one row per fixture:
    {chart_id}@{target_date},{expected_label},{doctrinal_split},{reasoning},{citation}

Reasoning may contain commas — we split on the FIRST 3 commas and LAST 1 comma,
treating the middle as reasoning.

Run AFTER `build_daily_label_corpus.py` populates the engine columns.
"""

from __future__ import annotations

import csv
import os
import sys
from typing import Dict, List, Tuple

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'daily_label_corpus.csv',
)


# ============================================================
# Sub-agent grading output (verbatim from 2026-05-14 sub-agent run)
# ============================================================
#
# Each entry: (row_id, expected_label, doctrinal_split, reasoning, citation)
# row_id format: "chart@YYYY-MM-DD"

GRADER_OUTPUT: List[Tuple[str, str, str, str, str]] = [
    ('roger@2026-05-07', '吉中有凶', 'no',
     '辛=仇神(金;傷官)透干 day stem unfavorable；巳含丙戊庚 — 丙(用神)藏 + 庚(仇神)藏；'
     '傷官見官 for Roger valence harmful (正官=喜神 per signal absent favorable tag)。'
     '喜神(午=日支)未動。Net mild unfavorable.',
     '三命通會·論傷官'),
    ('laopo@2026-05-07', '大凶', 'yes',
     '辛(正官忌神)透干弱身無印化 + 巳申半合官殺局 + 寅巳半刑年柱;'
     '「弱身遇官殺無印反為禍」應為大凶。[re-graded 2026-05-14 under Option 2.5]',
     '滴天髓·論官殺'),
    ('roger@2026-05-08', '吉', 'yes',
     '壬=忌神(財)透干 BUT 午=日支(spouse palace) + 天喜 + spouse_star_transparent；'
     '壬午 截腳 (壬絕於午)。Per Phase 12b Fix A: 截腳 halving applies — 忌神壬被午截腳大幅減力。'
     'Net favorable via 午=用神.',
     '滴天髓闡微·蓋頭截腳'),
    ('laopo@2026-05-08', '吉', 'no',
     '壬=用神(印)透干 for Laopo + 午=閒神(食傷)藏丁己；壬水印星透甲木DM = 印生身 for very_weak DM。'
     'yin_day signal correct. 用神透 alone without secondary stack — 吉 better fit than 大吉.',
     '子平真詮·論印綬'),
    ('roger@2026-05-09', '凶中有吉', 'no',
     '癸=忌神(財)透干 + 未=閒神(土)spouse palace 半合 with 午；妻星不利 + spouse_palace_he positive。'
     'Mixed lean unfavorable per 忌神透.',
     '滴天髓·論妻財'),
    ('laopo@2026-05-09', '凶中有吉', 'no',
     '癸=用神(印)透 BUT 未=閒神 + spouse_palace_half_punishment(丑戌未三刑半) + career_palace_chong；'
     '印透積極但配偶宮+月柱雙重不穩。Mixed net unfavorable.',
     '三命通會·論三刑'),
    ('roger@2026-05-10', '凶中有吉', 'yes',
     '甲(喜神偏官)透干 neutral DM + 食神制殺成格;'
     '滴天髓「七殺有制反為權」雖伏吟仇神但喜神鎮頭應為凶中有吉。'
     '[A4 pattern: xishen_stem_rescue_neutral_dm — 滴天髓 vs 子平真詮 split]',
     '滴天髓·論偏官;子平真詮·七殺有制'),
    ('laopo@2026-05-10', '平', 'no',
     '甲(喜神比肩)透干很弱DM得比助 vs 寅申沖年柱 + 伏吟忌神;'
     '子平真詮「弱得比助」與沖年柱互抵應為平。[re-graded 2026-05-14]',
     '子平真詮·論比劫'),
    ('roger@2026-05-11', '凶中有吉', 'no',
     '乙=喜神(官殺)透 + 酉=仇神(金)本氣 + chong_year_branch(卯酉沖年柱)；'
     '喜神透干被酉金截腳 + 沖年柱。Engine guan_sha_favorable 但 Roger 喜=木；signal可能 mislabeled。'
     'Net unfavorable.',
     '滴天髓·論沖'),
    ('laopo@2026-05-11', '凶中有吉', 'no',
     '乙(喜神劫財)透干但乙絕於酉(蓋頭截腳) + 酉戌穿配偶宮;'
     '「劫財蓋頭遇配偶宮害」結構與軟化並存應為凶中有吉。[re-graded 2026-05-14]',
     '滴天髓闡微·截腳'),
    ('roger@2026-05-12', '吉', 'no',
     '丙=用神(印)透干 + 戌=閒神土藏丁(印)辛戊；用神透干強力 + 三合寅午戌 with年支日支成火局 = 用神大成。'
     'Engine 大吉合理但乏第二trigger外輔助 — 吉穩當.',
     '子平真詮·論印綬;滴天髓·論三合'),
    ('laopo@2026-05-12', '凶', 'no',
     '丙(閒神食神)透干洩很弱DM + 戌(仇財)伏吟配偶宮;'
     '滴天髓「身弱再洩」+ 配偶宮伏吟成立應為凶。[re-graded 2026-05-14]',
     '滴天髓·論食傷;三命通會·伏吟'),
    ('roger@2026-05-13', '凶中有吉', 'no',
     '丁=用神(印)透 BUT 亥=忌神(財水)本氣 + 丁亥 截腳(丁絕於亥) per Fix A；'
     '用神被亥水截腳大幅減力. 凶中有吉.',
     '滴天髓·論蓋頭'),
    ('laopo@2026-05-13', '吉', 'no',
     '丁=閒神(食傷)透 + 亥=用神(印水)本氣 + shangguan_jian_guan_transient但 Laopo 正官=忌神故制官有益；'
     '用神本氣 + 傷官制忌官。Engine 大吉略過 — 吉合宜.',
     '三命通會·傷官見官如官為忌反吉'),
    ('roger@2026-05-14', '凶中有吉', 'yes',
     '戊=閒神(比劫)透 + 子=忌神(財水)本氣 + spouse_palace_chong(子午沖日支) + 紅鸞 + 比劫奪財beneficial(財=忌)；'
     '沖日支大事 — 動 doctrine分歧:一派吉(動=機);一派凶(動=亂)。紅鸞補. Net 凶中有吉.',
     '滴天髓·論沖;三命通會·紅鸞'),
    ('laopo@2026-05-14', '吉中有凶', 'no',
     '戊(仇財)蓋頭子(用印)且子生甲救身 + 紅鸞動;'
     '「財蓋頭印」結構正是吉中有凶。[re-graded 2026-05-14]',
     '子平真詮·財印不相礙'),
    ('roger@2026-05-15', '凶中有吉', 'no',
     '己=閒神(比劫土)透 + 丑=閒神土 + spouse_palace_six_harm(午丑六害) + bi_jie_duo_cai_beneficial；'
     '配偶宮六害無恩之害 + 比劫攻忌財有益. Net 凶中有吉 per 六害壓制.',
     '三命通會·論六害'),
    ('laopo@2026-05-15', '凶', 'no',
     '己(仇正財)透干甲己合去弱DM + 丑戌半刑配偶宮 + 仇神雙透;'
     '紅鸞減一級至凶為合理。[re-graded 2026-05-14]',
     '三命通會·論刑;滴天髓·甲己合'),
    ('roger@2026-05-16', '吉', 'no',
     '庚=仇神(食傷金)透 + 寅=喜神(官殺木)本氣 + career_palace_chong(寅申沖月柱)；'
     '仇透但喜神本氣坐 + 沖月柱動職。庚絕於寅=截腳per Fix A使仇神減力。'
     'Engine 大吉過 — 吉合.',
     '滴天髓·論蓋頭截腳'),
    ('laopo@2026-05-16', '吉中有凶', 'no',
     '庚=忌神(官殺金)透 + 寅=喜神(比劫木)本氣 + 沖月柱(寅申沖)；'
     '忌神透官殺攻身 vs 喜神本氣坐。截腳(庚絕於寅)減忌力。Engine 大吉嚴重高估 — 吉中有凶.',
     '滴天髓·論官殺'),
    ('roger@2026-05-17', '吉', 'no',
     '辛=仇神(金傷官)透 + 卯=喜神(官殺木)本氣 = 桃花年支同 + 傷官見官 transient；'
     '喜神本氣 + 桃花。截腳(辛絕於卯)減仇神。Engine 大吉略過.',
     '三命通會·桃花'),
    ('laopo@2026-05-17', '大吉', 'no',
     '辛=忌神(正官)透 + 卯=桃花年支 + 卯戌合(spouse palace) + spouse_star_transparent + taohua + spouse_palace_he triple stack；'
     '忌神透但 配偶星3-fold trigger + 卯戌真合化火(閒神) ungated。'
     'Net favorable per 「正緣動年」 doctrine.',
     '八字應用闡微·婚姻篇'),
    ('roger@2026-05-18', '凶中有吉', 'no',
     '壬(忌偏財)透干 + 申辰半合水局加重忌神 vs neutral DM 戊有辰比助根;'
     '「財雖旺有比劫敵」應為凶中有吉非凶。[re-graded 2026-05-14, engine_too_harsh outlier]',
     '滴天髓·論財;Phase 12h.B 比劫奪財'),
    ('laopo@2026-05-18', '凶', 'no',
     '壬=用神(印)透 BUT 辰=仇神土 + spouse_palace_chong(辰戌沖) + chong_ku_release + career_palace_chong；'
     '沖日支+沖庫+沖月。Engine 凶中有吉 過寬 — 三重沖應為凶.',
     '子平真詮·論墓庫'),
    ('roger@2026-05-19', '吉中有凶', 'no',
     '癸=忌神(財)透 + 巳=喜神火(內藏丙用神) + spouse_star_transparent + career_palace_he(巳申合月支)；'
     '忌透但巳含用神丙+合月柱+配偶星. 吉中有凶合engine.',
     '滴天髓·論用神'),
    ('laopo@2026-05-19', '吉', 'no',
     '癸=用神(印)透 + 巳=閒神(食傷)藏丙戊庚 + 寅巳半刑(年支)；yin_day。'
     '用神透但巳半刑年支。Engine 大吉略過 — 吉穩.',
     '子平真詮·論印'),
    ('roger@2026-05-20', '吉', 'no',
     '甲=喜神(官殺)透 + 午=用神(印火)本氣=日支 + 天喜；'
     '喜神透+用神本氣坐自支+天喜 triple。Engine 大吉合理 — 但乏外輔降一級為吉穩.',
     '子平真詮·論官殺'),
    ('laopo@2026-05-20', '吉', 'no',
     '甲=喜神(比劫)透 + 午=閒神(食傷火)藏丁己；喜神透 + bi_jie_day for very_weak DM = 比劫扶身。'
     'Engine 大吉略過 — 吉合.',
     '滴天髓·論比劫'),
    ('roger@2026-05-21', '吉', 'no',
     '乙=喜神(官殺)透 + 未=閒神土 + spouse_palace_he(午未合) + 傷官見官favorable + career_palace_he + he_day_branch_travel；'
     '喜神透+合配偶宮+合月柱 stack. 吉合.',
     '三命通會·六合'),
    ('laopo@2026-05-21', '凶中有吉', 'no',
     '乙=喜神(比劫)透 + 未=閒神土 + spouse_palace_half_punishment(丑戌未三刑齊全) + career_palace_chong + 天喜；'
     '三刑齊全per Phase 12h.A Item 6 嚴重 + 沖月柱。喜神透+天喜難敵三刑. Lean 凶.',
     '三命通會·論三刑;滴天髓·三刑'),
]


def _parse_row_id(row_id: str) -> Tuple[str, str]:
    """Parse 'roger@2026-05-07' → ('roger', '2026-05-07')."""
    chart_id, target_date = row_id.split('@')
    return chart_id.strip(), target_date.strip()


def main() -> int:
    if not os.path.exists(CORPUS_PATH):
        print(f'ERROR: corpus CSV not found at {CORPUS_PATH}', file=sys.stderr)
        print('Run `python tests/validation/build_daily_label_corpus.py` first', file=sys.stderr)
        return 1

    # Load existing rows
    with open(CORPUS_PATH, encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
        fieldnames = reader.fieldnames or []

    # Build a lookup from grader output
    grades: Dict[Tuple[str, str], Dict[str, str]] = {}
    for row_id, label, split, reasoning, citation in GRADER_OUTPUT:
        chart_id, target_date = _parse_row_id(row_id)
        grades[(chart_id, target_date)] = {
            'expected_overall_label': label,
            'doctrinal_split': split,
            'reasoning': reasoning,
            'citation': citation,
        }

    # Merge into rows
    merged_count = 0
    for row in rows:
        key = (row['chart_id'], row['target_date'])
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
