"""
Doctrinal Split Day Patterns — Phase 1 Fortune A4 Debt C

Enumerates ≥5 named patterns where two classical Bazi schools (子平真詮 /
滴天髓 / 三命通會 / 淵海子平) defensibly emit DIFFERENT day-verdicts for
the same chart-day combination. Both schools' verdicts are classically
supported; neither is "wrong."

# Why this module exists

The daily-fortune corpus validation gate (`run_daily_label_validation.py`)
allows engine output to disagree with the grader IF the row's
`doctrinal_split` column is `yes`. This module documents WHICH patterns
qualify and provides detection for the simpler cases.

When the engine adds a doctrinal-split row, the entry MUST cite which
pattern fired. This keeps the harness honest: not every disagreement is
"accept either" — only known classical splits qualify.

# Phase 12 doctrinal-split context

This module mirrors `DOCTRINAL_SPLIT_CHART_IDS` (Phase 12d 用神 validation)
in spirit — both enumerate cases where classical schools defensibly
diverge. The chart-level Phase 12d splits are tracked per-chart;
day-level splits are tracked per-PATTERN since the same pattern can
fire across many charts.

# How to add a new pattern

1. Append a new entry to `DOCTRINAL_SPLIT_DAY_PATTERNS` with required keys
2. Add classical citations for BOTH schools (each must be defensible)
3. If detection is straightforward, add to `detect_doctrinal_split()`
4. Add a pattern-shape regression test in `test_doctrinal_split_patterns.py`
5. Document the pattern in CLAUDE.md Fortune section

# Schema

Each pattern:
    pattern_id: str                  # snake_case unique identifier
    name_zh: str                     # Chinese name (4-8 chars)
    name_en: str                     # English short name
    school_a: {doctrine, verdict, citation}  # one classical interpretation
    school_b: {doctrine, verdict, citation}  # the other
    detection_description: str       # plain-English when this fires
    anchor_corpus_rows: List[str]    # corpus rows where the pattern is ACTIVELY
                                     # influencing engine/grader disagreement
                                     # (NOT every row matching detection — see note below)
    detectable_in_code: bool         # True if `detect_doctrinal_split()` covers it

Verdict values: any of `LABEL_LADDER` from `label_subordination.py`
(大吉 / 吉 / 吉中有凶 / 平 / 凶中有吉 / 小凶 / 凶 / 大凶 / 凶上加凶).

# Detection vs. anchor-listing — IMPORTANT semantic distinction

`detect_doctrinal_split()` returns the first matching pattern_id based on
PATTERN PRESENCE — i.e., the structural conditions for the pattern hold.
This does NOT mean the engine and grader actually disagree about that day's
verdict; many rows can match a pattern's structure but still have engine ==
grader (both lands on the same school's verdict).

`anchor_corpus_rows` lists ONLY the corpus rows where the pattern is the
DOCUMENTED reason for an engine-vs-grader disagreement (with corpus
`doctrinal_split=yes`). A row can match detection without being an anchor.

This separation matters for the corpus harness:
- `detect_doctrinal_split()` is informational — useful for narration / debug
- `doctrinal_split=yes` corpus flag is the AUTHORITATIVE exclusion gate
  (set manually by grader review) — NOT derived from detect_doctrinal_split

Future enhancement (Phase 1.5+): auto-flag via
`detect_doctrinal_split() AND engine_label != expected_label AND
 {engine_label, expected_label} intersects {school_a.verdict, school_b.verdict}`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .life_stages import get_life_stage
from .constants import (
    BRANCH_ELEMENT,
    HONGLUAN,
    STEM_ELEMENT,
)
from .branch_relationships import CLASH_LOOKUP


# ============================================================
# DOCTRINAL_SPLIT_DAY_PATTERNS — structured enumeration
# ============================================================

DOCTRINAL_SPLIT_DAY_PATTERNS: List[Dict[str, Any]] = [
    {
        'pattern_id': 'chong_day_branch_with_honluan',
        'name_zh': '沖日支同紅鸞',
        'name_en': 'Day-branch clash + Red-Phoenix trigger same day',
        'school_a': {
            'doctrine': '紅鸞動 = 婚緣機會。沖日支主動，動則婚事至 — 配偶宮被觸動引動紅鸞，正面解讀。',
            'verdict': '吉中有凶',
            'citation': '三命通會·紅鸞「紅鸞動，婚事至」',
        },
        'school_b': {
            'doctrine': '沖日支主不穩 — 配偶宮被沖開引起波動，紅鸞無法平衡結構性的「動則不安」。',
            'verdict': '凶中有吉',
            'citation': '滴天髓·夫妻論「沖日支主動，動則不安」',
        },
        'detection_description': 'day_branch is 沖 of natal day branch AND day_branch == HONGLUAN[year_branch]',
        'anchor_corpus_rows': ['roger@2026-05-14'],
        'detectable_in_code': True,
    },
    {
        'pattern_id': 'spouse_star_transparent_but_taboo',
        'name_zh': '配偶星=忌神透',
        'name_en': 'Spouse star transparent at day stem but is 忌神',
        'school_a': {
            'doctrine': '配偶星透干 = 緣分至。即使該十神為命中忌神，仍主感情事件浮現，可作為「動」之解。',
            'verdict': '凶中有吉',
            'citation': '八字應用闡微·婚姻篇「配偶星透干主感情事件」',
        },
        'school_b': {
            'doctrine': '忌神透干 = 直接害身。配偶星身份不能改變忌神對日主的攻擊性，反成「夫/妻為禍」。',
            'verdict': '凶',
            'citation': '三命通會·論官殺「忌神透干主有災」',
        },
        'detection_description': 'day_ten_god ∈ spouse_stars (gender-aware) AND that ten god\'s role in effective_gods ∈ {忌神, 仇神}. Fires when no more-specific pattern (1/3/4) applies.',
        'anchor_corpus_rows': [],  # broadest pattern — anchors typically caught by patterns 3/4 first
        'detectable_in_code': True,
    },
    {
        'pattern_id': 'jiejiao_reduces_taboo_stem',
        'name_zh': '截腳忌神大幅減',
        'name_en': '截腳 reduces 忌神 transparency (strength of reduction)',
        'school_a': {
            'doctrine': '截腳大幅減力。忌神透干坐絕/死/墓 → 該十神之凶減半以上，幾近中性。',
            'verdict': '吉',
            'citation': '滴天髓闡微·蓋頭截腳「金絕寅卯，雖有十分之凶，而減其半」',
        },
        'school_b': {
            'doctrine': '截腳僅略減。透干本身仍有引動效果，截腳只是減緩勢頭，不可視為消除。',
            'verdict': '吉中有凶',
            'citation': '子平真詮·論用神「截腳忌仍為害，僅勢稍緩」',
        },
        'detection_description': 'day stem is 忌神/仇神 element AND day stem is 絕/死/墓 on day branch (via get_life_stage)',
        'anchor_corpus_rows': ['laopo@2026-05-07'],  # 辛 in 巳 = 死; 辛=正官=忌神
        'detectable_in_code': True,
    },
    {
        'pattern_id': 'xishen_stem_rescue_neutral_dm',
        'name_zh': '中和喜用透鎮頭',
        'name_en': '喜神/用神 stem rescue on neutral DM (七殺有制 / 比劫敵忌財)',
        'school_a': {
            'doctrine': '中和日主有依 — 喜神/用神 透干即使坐仇/忌支，「鎮頭」效應使整體有救。',
            'verdict': '凶中有吉',
            'citation': '滴天髓·體用「喜用透則身有依」',
        },
        'school_b': {
            'doctrine': '透 vs 坐 — 用神坐忌支自損。喜神 透干 仍須有根支撐；坐仇神支等於透干無依，難以鎮壓結構性的凶。',
            'verdict': '凶',
            'citation': '子平真詮·論官殺「七殺需食制而非但坐」',
        },
        'detection_description': 'day_stem element role ∈ {用神, 喜神} AND day_branch element role ∈ {忌神, 仇神} AND DM strength = neutral',
        'anchor_corpus_rows': ['roger@2026-05-10'],
        'detectable_in_code': True,
    },
    {
        'pattern_id': 'transparent_vs_rooted_useful_god',
        'name_zh': '用神透vs仇神坐',
        'name_en': 'Transparent 用神 vs rooted 仇神 — school priority',
        'school_a': {
            'doctrine': '干透為先。用神 透干即現於明，仇神 藏支屬隱藏勢力，明顯者為主。',
            'verdict': '吉中有凶',
            'citation': '滴天髓·天干「干透為先」',
        },
        'school_b': {
            'doctrine': '藏干有根方為實。仇神坐 本氣根深蒂固，用神 透干 無根則為「浮干」，難敵深根。',
            'verdict': '凶中有吉',
            'citation': '子平真詮·地支「藏干有根方為實」',
        },
        'detection_description': 'day_stem element role = 用神 AND day_branch 本氣 element role ∈ {忌神, 仇神}',
        'anchor_corpus_rows': [],
        'detectable_in_code': False,  # requires 本氣 lookup which is more involved
    },
    {
        'pattern_id': 'liuhe_forming_taboo_element',
        'name_zh': '合化忌神反成凶',
        'name_en': '三合/六合 forming 忌神 element',
        'school_a': {
            'doctrine': '合為和諧。無論所合化之五行如何，「合」本身代表結合、緩衝，整體偏正面。',
            'verdict': '吉中有凶',
            'citation': '渊海子平·論合「合則為和」',
        },
        'school_b': {
            'doctrine': '合化忌反吉為凶。若合化後的五行為命中忌神，等於「補強敵人」，反而結構惡化。',
            'verdict': '凶中有吉',
            'citation': '滴天髓·論合「合化忌神反為禍源」',
        },
        'detection_description': 'day_branch + natal branches form 三合/六合 group AND formed element ∈ {忌神, 仇神}',
        'anchor_corpus_rows': [],
        'detectable_in_code': False,  # requires multi-branch 三合 detection + 化氣 lookup
    },
    {
        'pattern_id': 'banhe_with_banxing_same_branch',
        'name_zh': '半合半刑並見',
        'name_en': '半合 + 半刑 on same day branch (合先還是刑先?)',
        'school_a': {
            'doctrine': '合先論。三命通會「合則合，雖有刑害不論」 — 合為和諧之主導力量，刑害被合所緩。',
            'verdict': '吉中有凶',
            'citation': '三命通會·論合「合則合，雖有刑害不論」',
        },
        'school_b': {
            'doctrine': '刑先論。渊海子平「刑害並見必先論刑」 — 刑為破壞之力，合無法掩蓋刑之傷害。',
            'verdict': '凶中有吉',
            'citation': '渊海子平·論刑「刑害並見必先論刑」',
        },
        'detection_description': 'day_branch + natal branch form 半合 AND simultaneously form 半刑/半害 with another natal branch (e.g. 巳申半合 + 寅巳半刑)',
        'anchor_corpus_rows': [],
        'detectable_in_code': False,
    },
]


# ============================================================
# Detection helpers (for the 3-4 detectable patterns)
# ============================================================

def detect_doctrinal_split(
    *,
    day_stem: str,
    day_branch: str,
    day_ten_god: str,
    natal_day_branch: str,
    year_branch: str,
    day_master_stem: str,
    effective_gods_zh: Dict[str, str],
    strength: str,
    gender: str,
) -> Optional[str]:
    """Return the pattern_id of the first matching doctrinal split, or None.

    ⚠️ PATTERN PRESENCE vs. VERDICT MISMATCH:
    This function detects whether a day's structural conditions MATCH a
    documented doctrinal pattern — it does NOT verify that the engine and
    a grader actually disagree on the verdict. Many days will structurally
    match (e.g. every 忌神 stem in 絕/死/墓 fires pattern 3) without being
    contentious in practice. For the corpus harness, the AUTHORITATIVE
    "accept either" flag is `daily_label_corpus.csv::doctrinal_split` set
    manually by grader review, NOT this function's output.

    Use cases for this function:
    - Documentation / debug: «which classical pattern best describes this day?»
    - Future auto-flagging: combine with `engine_label != grader_label` check
      to refine corpus flags (Phase 1.5+).

    Args:
        effective_gods_zh: TEN-GOD format keyed dict
            (e.g. `{'比肩': '閒神', '正官': '喜神', ...}`).
            NOT engine format. Use `_normalize_effective_gods_for_annual`
            to convert from `{'usefulGod': '火', ...}` engine format first.

    Pattern priority (first match wins) — MOST SPECIFIC FIRST:
    1. chong_day_branch_with_honluan (needs BOTH 沖日支 AND 紅鸞 — very specific)
    2. xishen_stem_rescue_neutral_dm (neutral DM only; 用/喜 stem on 忌/仇 branch)
    3. jiejiao_reduces_taboo_stem (忌神 stem in 絕/死/墓)
    4. spouse_star_transparent_but_taboo (broadest — fires whenever spouse star=忌)

    Returns:
        pattern_id (str) of the matched pattern, or None if no detectable
        pattern applies. Patterns 5, 6, 7 (transparent_vs_rooted,
        liuhe_forming_taboo, banhe_with_banxing) are documented but not
        auto-detected — they require 藏干/化氣/multi-branch helpers.
    """
    # Pattern 1: 沖日支 + 紅鸞 同日 (highly specific — both conditions)
    if (
        CLASH_LOOKUP.get(natal_day_branch) == day_branch
        and HONGLUAN.get(year_branch) == day_branch
    ):
        return 'chong_day_branch_with_honluan'

    # Pattern 4: 喜神/用神 stem rescue on neutral DM
    if strength == 'neutral':
        day_stem_element = STEM_ELEMENT.get(day_stem, '')
        day_branch_element = BRANCH_ELEMENT.get(day_branch, '')
        day_stem_role = _resolve_element_role(day_stem_element, day_master_stem, effective_gods_zh)
        day_branch_role = _resolve_element_role(day_branch_element, day_master_stem, effective_gods_zh)
        if day_stem_role in {'用神', '喜神'} and day_branch_role in {'忌神', '仇神'}:
            return 'xishen_stem_rescue_neutral_dm'

    # Pattern 3: 截腳 忌神/仇神 stem on 絕/死/墓 branch
    day_stem_element = STEM_ELEMENT.get(day_stem, '')
    day_stem_role = _resolve_element_role(day_stem_element, day_master_stem, effective_gods_zh)
    if day_stem_role in {'忌神', '仇神'}:
        life_stage = get_life_stage(day_stem, day_branch)
        if life_stage in {'絕', '死', '墓'}:
            return 'jiejiao_reduces_taboo_stem'

    # Pattern 2: 配偶星=忌神 透干 (BROADEST — fires last)
    # Many days have spouse-star transparent; only matters when role=忌/仇.
    spouse_stars_male = {'正財', '偏財'}
    spouse_stars_female = {'正官', '偏官'}
    if gender.upper() in {'MALE', '男'}:
        if day_ten_god in spouse_stars_male:
            ten_god_role = effective_gods_zh.get(day_ten_god, '閒神')
            if ten_god_role in {'忌神', '仇神'}:
                return 'spouse_star_transparent_but_taboo'
    else:
        if day_ten_god in spouse_stars_female:
            ten_god_role = effective_gods_zh.get(day_ten_god, '閒神')
            if ten_god_role in {'忌神', '仇神'}:
                return 'spouse_star_transparent_but_taboo'

    return None


# ============================================================
# Internal helpers
# ============================================================

# Map of 十神 → DM-element relationship category (for element-role lookup)
_TEN_GOD_TO_DM_RELATION = {
    '比肩': 'same', '劫財': 'same',
    '食神': 'i_produce', '傷官': 'i_produce',
    '偏財': 'i_overcome', '正財': 'i_overcome',
    '偏官': 'overcomes_me', '正官': 'overcomes_me',
    '偏印': 'produces_me', '正印': 'produces_me',
}


def _resolve_element_role(
    element: str,
    day_master_stem: str,
    effective_gods_zh: Dict[str, str],
) -> str:
    """Given an element (e.g. '火') and the chart's effective_gods (ten-god
    keyed dict), return that element's role for the chart ('用神'/'喜神'/
    '閒神'/'忌神'/'仇神').

    The role is determined by:
    1. Compute DM stem's element
    2. Determine relationship of `element` to DM element
       (same/i_produce/i_overcome/overcomes_me/produces_me)
    3. Look up which ten god corresponds to that relationship
    4. Read effective_gods_zh[ten_god] to get the role

    Returns '閒神' as a safe default if any lookup fails.
    """
    dm_element = STEM_ELEMENT.get(day_master_stem, '')
    if not dm_element or not element:
        return '閒神'

    relationship = _element_relationship(element, dm_element)
    if not relationship:
        return '閒神'

    # Find a ten god matching this relationship
    for ten_god, rel in _TEN_GOD_TO_DM_RELATION.items():
        if rel == relationship:
            role = effective_gods_zh.get(ten_god)
            if role:
                return role
    return '閒神'


# Five-element overcoming cycle: A overcomes B (克)
_OVERCOMES = {
    '木': '土', '土': '水', '水': '火', '火': '金', '金': '木',
}
# Five-element generating cycle: A produces B (生)
_PRODUCES = {
    '木': '火', '火': '土', '土': '金', '金': '水', '水': '木',
}


def _element_relationship(element_a: str, dm_element: str) -> str:
    """Relationship of element_a TO dm_element. Returns one of:
    'same' | 'i_produce' | 'i_overcome' | 'overcomes_me' | 'produces_me'
    Empty string if not resolvable.
    """
    if element_a == dm_element:
        return 'same'
    if _PRODUCES.get(dm_element) == element_a:
        return 'i_produce'      # DM produces element_a
    if _OVERCOMES.get(dm_element) == element_a:
        return 'i_overcome'     # DM overcomes element_a
    if _OVERCOMES.get(element_a) == dm_element:
        return 'overcomes_me'   # element_a overcomes DM
    if _PRODUCES.get(element_a) == dm_element:
        return 'produces_me'    # element_a produces DM
    return ''
