"""
Phase 1.5.z Folk Content — corpus expert-column populator.

Unlike `populate_daily_label_corpus.py` (which depended on sub-agent grading
because the 7-label verdict requires doctrinal judgment), folk-content
expected values are 100% deterministic given:
    - 用神 element (for chart-level fields: color, number, food favor, food avoid)
    - day_branch (for 吉時 — 6 canonical rosters per 青龍訣)

So this populator DOES NOT require a sub-agent pass. It uses the same
research data (Phase A Sub-Agent A + B outputs at
/Users/roger/.claude/plans/fortune-folk-content-research-results.md) to
populate the expert columns directly. Re-runs are idempotent.

This means the corpus gates DETECT REGRESSION rather than DOCTRINAL DRIFT —
if the engine output diverges from the documented research, the gate fails.
A future Phase A re-research that intentionally changes a mapping (e.g.
土→咖啡 instead of 黃) would require updating this populator alongside the
engine and re-grading the corpus.

For grader-cost optimization (per v2 review #4): no LLM grader needed —
this populator is pure Python lookups + classical citations. Total cost: $0.

Usage:
    cd packages/bazi-engine && source .venv/bin/activate
    python tests/validation/populate_folk_content_corpus.py
"""

from __future__ import annotations

import csv
import os
from typing import Dict, List

CORPUS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'folk_content_corpus.csv',
)

# ============================================================
# Expected values per 用神 element (chart-level fields)
# Source: /Users/roger/.claude/plans/fortune-folk-content-research-results.md
# ============================================================

# Each entry's «expected_color_primary» is the canonical primary from
# Sub-Agent A's ELEMENT_COLOR table. Synset matching (relaxed gate) allows
# 青 ≡ 綠, 黃 ≡ 褐, etc.
EXPECTED_COLOR: Dict[str, str] = {
    '木': '青',
    '火': '紅',
    '土': '黃',
    '金': '白',
    '水': '黑',
}

EXPECTED_NUMBERS: Dict[str, List[int]] = {
    '木': [3, 8],
    '火': [2, 7],
    '土': [5, 10],
    '金': [4, 9],
    '水': [1, 6],
}

# Category match is partial-string (e.g., engine emits «紅色食物/苦味/養心»;
# expected uses the most stable substring «紅色食物» or «苦味».)
EXPECTED_FOOD_FAVOR_KEYWORD: Dict[str, str] = {
    '木': '酸',     # 青綠葉蔬/酸味/疏肝
    '火': '苦',     # 紅色食物/苦味/養心
    '土': '甘',     # 黃色食物/甘味/健脾
    '金': '辛',     # 白色食物/辛味/潤肺
    '水': '鹹',     # 黑色食物/鹹味/補腎
}

# 食忌 must mention the 五行 剋 chain in category
EXPECTED_FOOD_AVOID_CHAIN: Dict[str, str] = {
    '木': '金剋木',
    '火': '水剋火',
    '土': '木剋土',
    '金': '火剋金',
    '水': '土剋水',
}

# ============================================================
# Expected 吉時 (per day_branch — 6 canonical rosters)
# Source: Sub-Agent B 青龍訣 algorithm
# ============================================================

EXPECTED_HOURS_PER_DAY_BRANCH: Dict[str, str] = {
    '子': '子|丑|卯|午|申|酉',
    '午': '子|丑|卯|午|申|酉',
    '丑': '寅|卯|巳|申|戌|亥',
    '未': '寅|卯|巳|申|戌|亥',
    '寅': '子|丑|辰|巳|未|戌',
    '申': '子|丑|辰|巳|未|戌',
    '卯': '子|寅|卯|午|未|酉',
    '酉': '子|寅|卯|午|未|酉',
    '辰': '寅|辰|巳|申|酉|亥',
    '戌': '寅|辰|巳|申|酉|亥',
    '巳': '丑|辰|午|未|戌|亥',
    '亥': '丑|辰|午|未|戌|亥',
}


def populate_row(row: Dict[str, str]) -> Dict[str, str]:
    el = row['useful_god_element']
    day_branch = row['day_ganzhi'][1] if len(row['day_ganzhi']) >= 2 else ''

    return {
        **row,
        'expected_color_primary': EXPECTED_COLOR.get(el, ''),
        'expected_numbers': '|'.join(str(n) for n in EXPECTED_NUMBERS.get(el, [])),
        'expected_food_favor_category': EXPECTED_FOOD_FAVOR_KEYWORD.get(el, ''),
        'expected_food_avoid_category': EXPECTED_FOOD_AVOID_CHAIN.get(el, ''),
        'expected_hours_branches': EXPECTED_HOURS_PER_DAY_BRANCH.get(day_branch, ''),
        'doctrinal_notes': f'用神={el}, day_branch={day_branch} (auto-populated from research artifacts)',
        'citation': '黃帝內經素問 + 河圖 + 協紀辨方書 卷十',
    }


def main() -> int:
    if not os.path.exists(CORPUS_PATH):
        print(f'Error: corpus not found at {CORPUS_PATH}. Run build_folk_content_corpus.py first.')
        return 1

    with open(CORPUS_PATH, encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        rows = [populate_row(r) for r in reader]

    with open(CORPUS_PATH, 'w', encoding='utf-8', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f'Populated {len(rows)} rows with expected values.')
    print(f'  Distinct day_branches: {len({r["day_ganzhi"][1] for r in rows if len(r["day_ganzhi"]) >= 2})}')
    print(f'  Distinct 用神: {len({r["useful_god_element"] for r in rows})}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
