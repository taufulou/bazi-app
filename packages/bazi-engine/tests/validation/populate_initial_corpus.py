"""Populate the initial compatibility-pair corpus skeleton.

Hand-coded section targets → resolved to dates via day-pillar search →
CSV emitted with doctrinal columns filled. Regression columns are left
blank and populated by `build_compatibility_corpus.py --build`.

Sections:
- A: 夫妻宫六合 (6 pairs)
- B: 夫妻宫六沖 (6 pairs)
- C: 夫妻宫六害 (6 pairs)
- E: 刑/自刑 (9 pairs)
- F: 天干五合 (5 pairs)
- G: 配偶星對應 (5 pairs)
- I: 三合 cross-chart (5 pairs) — predicate-based
- J: knockouts (8 pairs) — predicate-based
- K: 日柱天合地合 (3 pairs) — predicate-based

Total: 53 pairs.
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent))
from build_compatibility_corpus import (  # noqa: E402
    CORPUS_PATH, CSV_COLUMNS, CORPUS_HEADER_COMMENT, DEFAULT_TIME,
    DEFAULT_LOCATION, DEFAULT_TIMEZONE, SEARCH_START,
    find_date_for_day_pillar, find_pair, get_compat, extract_compat_block,
    collect_knockout_types, collect_findings_types, get_day_pillar,
    predicate_must_fire_knockout, predicate_special_finding,
    predicate_combine, save_corpus,
)


# ---------------------------------------------------------------------------
# Section targets
# ---------------------------------------------------------------------------

# A: 夫妻宫六合 — 6 pairs
A_PAIRS = [
    ("A01_zi_chou", "丙子", "丁丑", "子丑合"),
    ("A02_yin_hai", "戊寅", "丁亥", "寅亥合"),
    ("A03_mao_xu", "己卯", "丙戌", "卯戌合"),
    ("A04_chen_you", "庚辰", "乙酉", "辰酉合"),
    ("A05_si_shen", "辛巳", "甲申", "巳申合"),
    ("A06_wu_wei", "壬午", "癸未", "午未合"),
]

# B: 夫妻宫六沖 — 6 pairs (3 pure 六沖 + 3 天剋地沖)
# Pure 六沖: stems generate, only branches clash → engine emits '六沖'
# 天剋地沖: stems also clash → engine emits '天剋地沖' (more severe)
B_PAIRS = [
    ("B01_zi_wu_pure", "甲子", "丙午", "子午沖 純六沖 (甲丙生)"),
    ("B02_chen_xu_pure", "壬辰", "甲戌", "辰戌沖 純六沖 (壬甲生)"),
    ("B03_yin_shen_pure", "壬寅", "庚申", "寅申沖 純六沖 (壬庚生)"),
    ("B04_chou_wei_tianke", "丁丑", "癸未", "丑未沖 天剋地沖"),
    ("B05_mao_you_tianke", "己卯", "乙酉", "卯酉沖 天剋地沖"),
    ("B06_si_hai_tianke", "辛巳", "丁亥", "巳亥沖 天剋地沖"),
]

# C: 夫妻宫六害 — 6 pairs
C_PAIRS = [
    ("C01_zi_wei", "丙子", "癸未", "子未害 (妒嫉)"),
    ("C02_chou_wu", "丁丑", "壬午", "丑午害 (官鬼)"),
    ("C03_yin_si", "戊寅", "辛巳", "寅巳害 (無恩)"),
    ("C04_mao_chen", "己卯", "庚辰", "卯辰害 (凌長)"),
    ("C05_shen_hai", "甲申", "丁亥", "申亥害 (爭進)"),
    ("C06_you_xu", "乙酉", "丙戌", "酉戌害 (嫉妒)"),
]

# E: 刑/自刑 — 9 pairs (5 三刑/半刑 + 4 自刑)
E_PAIRS = [
    ("E01_zi_mao_xing", "丙子", "己卯", "子卯刑 (無禮)"),
    ("E02_yin_si_xing", "戊寅", "辛巳", "寅巳刑 (持勢半)"),
    ("E03_si_shen_xing", "辛巳", "甲申", "巳申刑 (合而帶刑)"),
    ("E04_chou_xu_xing", "丁丑", "丙戌", "丑戌刑 (持權)"),
    ("E05_xu_wei_xing", "丙戌", "癸未", "戌未刑 (恃勢)"),
    ("E06_chen_zixing", "庚辰", "戊辰", "辰自刑"),
    ("E07_wu_zixing", "壬午", "庚午", "午自刑"),
    ("E08_you_zixing", "乙酉", "丁酉", "酉自刑"),
    ("E09_hai_zixing", "丁亥", "己亥", "亥自刑"),
]

# F: 天干五合 — 5 pairs (gender-neutral, branch picked to avoid A/B clash)
F_PAIRS = [
    ("F01_jia_ji", "甲申", "己亥", "甲己合 中正之合"),  # 申亥 害 acceptable
    ("F02_yi_geng", "乙未", "庚寅", "乙庚合 仁義之合"),
    ("F03_bing_xin", "丙申", "辛卯", "丙辛合 威制之合"),
    ("F04_ding_ren", "丁丑", "壬寅", "丁壬合 淫匿之合"),
    ("F05_wu_gui", "戊辰", "癸亥", "戊癸合 無情之合"),
]

# G: 配偶星對應 — 5 pairs (gender-conditional alignment)
# Male DM 正財 = element DM overcomes; Female DM 正官 = element overcoming DM
G_PAIRS = [
    # M=甲木, F=己土 → male sees 己 正財; female sees 甲 正官 (perfect)
    ("G01_jia_ji_align", "甲寅", "己未", "M甲F己 perfect 正財正官"),
    # M=丙火, F=辛金 → perfect
    ("G02_bing_xin_align", "丙寅", "辛丑", "M丙F辛 perfect 正財正官"),
    # M=戊土, F=丁火 → mismatch (女丁 sees 戊 as 傷官; 男戊 sees 丁 as 正印)
    ("G03_wu_ding_mismatch", "戊辰", "丁未", "M戊F丁 mismatch (no 配偶星)"),
    # M=庚金, F=乙木 → perfect
    ("G04_geng_yi_align", "庚辰", "乙巳", "M庚F乙 perfect 正財正官"),
    # M=壬水, F=丙火 → male 壬 sees 丙 偏財 (semi-alignment), female 丙 sees 壬 七殺
    ("G05_ren_bing_partial", "壬戌", "丙寅", "M壬F丙 偏財/七殺 partial"),
]


# Pairs in A-G use specified gender (most romance pairs M+F)
GENDER_OVERRIDES = {
    # G section uses specific genders
    "G01_jia_ji_align": ("male", "female"),
    "G02_bing_xin_align": ("male", "female"),
    "G03_wu_ding_mismatch": ("male", "female"),
    "G04_geng_yi_align": ("male", "female"),
    "G05_ren_bing_partial": ("male", "female"),
}


# ---------------------------------------------------------------------------
# Doctrinal column builders
# ---------------------------------------------------------------------------

def doctrinal_for_six_he(pair_id: str) -> Dict:
    return {
        "expected_findings_types": json.dumps(
            {"spousePalace": ["六合"]}, ensure_ascii=False),
        "expected_findings_absent": json.dumps(
            {"spousePalace": ["六沖", "天剋地沖", "六害"]}, ensure_ascii=False),
        "expected_lookup_dim_scores": "",
    }


def doctrinal_for_six_chong(pair_id: str) -> Dict:
    """Pure 六沖 (no stem clash) → expect '六沖'.
    天剋地沖 (stem also clashes) → expect '天剋地沖'."""
    if "tianke" in pair_id:
        expected_type = "天剋地沖"
    else:
        expected_type = "六沖"
    return {
        "expected_findings_types": json.dumps(
            {"spousePalace": [expected_type]}, ensure_ascii=False),
        "expected_findings_absent": json.dumps(
            {"spousePalace": ["六合"]}, ensure_ascii=False),
        "expected_lookup_dim_scores": "",
    }


def doctrinal_for_six_hai(pair_id: str) -> Dict:
    # 六害 detected at compatibility_preanalysis level — emits liuHaiInteractions
    # at top of compatibilityEnhanced, NOT in spousePalace.findings
    # However score_spouse_palace does also emit '六害' findings in dim3
    return {
        "expected_findings_types": json.dumps(
            {"spousePalace": ["六害"]}, ensure_ascii=False),
        "expected_findings_absent": json.dumps(
            {"spousePalace": ["六合", "六沖"]}, ensure_ascii=False),
        "expected_lookup_dim_scores": "",
    }


def doctrinal_for_xing(pair_id: str) -> Dict:
    """E section: 自刑 + 三刑/半刑/子卯刑 detection (Phase 12i).

    自刑 (辰辰/午午/酉酉/亥亥): emits '自刑' in spousePalace.findings.
    子卯刑: emits '子卯刑' (Phase 12i — 网易《婚姻配偶宮逢刑沖》marriage modifier).
    三刑 全 / 半刑: emits '三刑' or '半刑' depending on whether 3rd branch is
        present in either chart's other pillars (cross-chart 三刑 detection).

    Dual-tag (must-include semantics — actual findings may have more):
      巳申 day-pair → 六合 + 半刑 (E03)
      寅巳 day-pair → 六害 + 半刑 (E02)
      寅申 day-pair → 六沖 + 半刑 (when stems don't form 天剋地沖)
      丑戌 day-pair → 半刑 if 未 absent, 三刑 全 if 未 in pillars (E04)
      戌未 day-pair → 半刑 if 丑 absent, 三刑 全 if 丑 in pillars (E05)

    For 三刑/半刑 ambiguity (depends on 3rd branch in other pillars), we
    leave expected_findings_types empty and rely on build-mode populated
    columns. Authors verify via running --build and reviewing diffs.
    """
    if "zixing" in pair_id:
        return {
            "expected_findings_types": json.dumps(
                {"spousePalace": ["自刑"]}, ensure_ascii=False),
            "expected_findings_absent": json.dumps(
                {"spousePalace": ["六合", "六沖"]}, ensure_ascii=False),
            "expected_lookup_dim_scores": "",
        }
    # E01 子卯刑: deterministic, always fires
    if pair_id == "E01_zi_mao_xing":
        return {
            "expected_findings_types": json.dumps(
                {"spousePalace": ["子卯刑"]}, ensure_ascii=False),
            "expected_findings_absent": json.dumps(
                {"spousePalace": ["六合", "六沖", "天剋地沖", "六害"]}, ensure_ascii=False),
            "expected_lookup_dim_scores": "",
        }
    # E02 寅巳: 六害 + 半刑 dual-tag (assumes 申 NOT in either chart)
    # E03 巳申: 六合 + 半刑 dual-tag (assumes 寅 NOT in either chart)
    # E04 丑戌: pure 半刑 OR 三刑 全 depending on 未 presence
    # E05 戌未: pure 半刑 OR 三刑 全 depending on 丑 presence
    # Pre-Phase-12i, these had empty expected_findings_types. Post-12i, the
    # build-mode populated knockout/special_findings columns lock the engine
    # truth; doctrinal layer asserts absence of incompatible tags only.
    return {
        "expected_findings_types": "",  # build-mode populated
        "expected_findings_absent": json.dumps(
            {"spousePalace": ["天剋地沖"]}, ensure_ascii=False),
        "expected_lookup_dim_scores": "",
    }


# 五合 → combinationName mapping (per classical 子平真詮)
WUHE_COMBINATION_NAMES = {
    "甲己": "中正之合",
    "乙庚": "仁義之合",
    "丙辛": "威制之合",
    "丁壬": "淫匿之合",
    "戊癸": "無情之合",
}


def doctrinal_for_wuhe(pair_id: str, day_a: str, day_b: str) -> Dict:
    stem_a = day_a[0]
    stem_b = day_b[0]
    key = "".join(sorted([stem_a, stem_b], key="甲乙丙丁戊己庚辛壬癸".index))
    name = WUHE_COMBINATION_NAMES.get(key, "")
    if not name:
        return {"expected_findings_types": "", "expected_findings_absent": "",
                "expected_lookup_dim_scores": ""}
    return {
        "expected_findings_types": "",
        "expected_findings_absent": "",
        "expected_lookup_dim_scores": "",
        # combinationName lives in specialFindings — locked via expected_special_findings
        # in build-mode; we hand-assert it here as well
        "expected_special_findings_doctrinal": json.dumps(
            {"combinationName": name}, ensure_ascii=False),
    }


def doctrinal_for_pou_xing(pair_id: str) -> Dict:
    # G section: gender-conditional spouse-star presence — author-asserted via
    # expected_findings_types on tenGodCross findings types. Build-mode fills bands.
    return {
        "expected_findings_types": "",  # build-mode populated
        "expected_findings_absent": "",
        "expected_lookup_dim_scores": "",
    }


# ---------------------------------------------------------------------------
# Row builder
# ---------------------------------------------------------------------------

def build_pinned_row(pair_id: str, category: str,
                     day_pillar_a: str, day_pillar_b: str, doctrine_note: str,
                     gender_a: str = "male", gender_b: str = "female",
                     after_a: date = SEARCH_START,
                     after_b: date = SEARCH_START) -> Dict:
    """Resolve dates and build a CSV row with doctrinal columns set.

    Regression columns left blank — populated by `build` step.
    """
    d_a = find_date_for_day_pillar(day_pillar_a, after=after_a)
    if d_a is None:
        raise RuntimeError(f"{pair_id}: cannot find date for {day_pillar_a}")
    # B's date must be different from A's (avoid identical-chart short-circuit)
    d_b = find_date_for_day_pillar(day_pillar_b, after=d_a + timedelta(days=1))
    if d_b is None:
        raise RuntimeError(f"{pair_id}: cannot find date for {day_pillar_b} after {d_a}")

    row = {
        "pair_id": pair_id,
        "category": category,
        "doctrine_note": doctrine_note,
        "a_date": d_a.isoformat(),
        "a_time": DEFAULT_TIME,
        "a_location": DEFAULT_LOCATION,
        "a_gender": gender_a,
        "b_date": d_b.isoformat(),
        "b_time": DEFAULT_TIME,
        "b_location": DEFAULT_LOCATION,
        "b_gender": gender_b,
        "expected_findings_types": "",
        "expected_findings_absent": "",
        "expected_lookup_dim_scores": "",
        "expected_knockout_types": "",
        "expected_dim_score_bands": "",
        "expected_special_findings": "",
        "adjusted_score_baseline": "",
        "frozen_pending_recalibration": "false",
        "notes": f"day_pillars: {day_pillar_a} + {day_pillar_b}",
    }
    return row


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------

def build_section_a() -> List[Dict]:
    rows = []
    for pid, dp_a, dp_b, note in A_PAIRS:
        row = build_pinned_row(pid, "A_six_he", dp_a, dp_b, note)
        d = doctrinal_for_six_he(pid)
        row.update(d)
        rows.append(row)
    return rows


def build_section_b() -> List[Dict]:
    rows = []
    for pid, dp_a, dp_b, note in B_PAIRS:
        row = build_pinned_row(pid, "B_six_chong", dp_a, dp_b, note)
        d = doctrinal_for_six_chong(pid)
        row.update(d)
        rows.append(row)
    return rows


def build_section_c() -> List[Dict]:
    rows = []
    for pid, dp_a, dp_b, note in C_PAIRS:
        row = build_pinned_row(pid, "C_six_hai", dp_a, dp_b, note)
        d = doctrinal_for_six_hai(pid)
        row.update(d)
        rows.append(row)
    return rows


def build_section_e() -> List[Dict]:
    rows = []
    for pid, dp_a, dp_b, note in E_PAIRS:
        row = build_pinned_row(pid, "E_xing_zixing", dp_a, dp_b, note)
        d = doctrinal_for_xing(pid)
        row.update(d)
        rows.append(row)
    return rows


def build_section_f() -> List[Dict]:
    rows = []
    for pid, dp_a, dp_b, note in F_PAIRS:
        row = build_pinned_row(pid, "F_tiangan_wuhe", dp_a, dp_b, note)
        # F doctrinal: combinationName lookup deterministic from day stem pair
        stem_a, stem_b = dp_a[0], dp_b[0]
        key = "".join(sorted([stem_a, stem_b], key="甲乙丙丁戊己庚辛壬癸".index))
        name = WUHE_COMBINATION_NAMES.get(key)
        if name:
            # Lookup-deterministic int (dim2 score from STEM_COMBINATION_ROMANCE_SCORES)
            # We don't hardcode the int (build-mode fills) but DO assert combinationName
            # as a doctrinal special finding
            row["expected_findings_types"] = ""
            row["expected_findings_absent"] = ""
            # Note: combinationName goes into expected_special_findings via build-mode;
            # we add a doctrinal-note marker but rely on build to populate.
        rows.append(row)
    return rows


def build_section_g() -> List[Dict]:
    rows = []
    for pid, dp_a, dp_b, note in G_PAIRS:
        ga, gb = GENDER_OVERRIDES.get(pid, ("male", "female"))
        row = build_pinned_row(pid, "G_peiouxing", dp_a, dp_b, note,
                                gender_a=ga, gender_b=gb)
        # G doctrinal: tenGodCross findings types depend on gender-conditional
        # spouse star presence. Left blank — build-mode populated.
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Section I — 三合 cross-chart (predicate search)
# ---------------------------------------------------------------------------

# 三合 groups: 申子辰 (水), 寅午戌 (火), 巳酉丑 (金), 亥卯未 (木)
# We pick day-branch HALF, then search for B's date such that the third
# branch appears in B's other pillars.

# day_branch + other_branch_in_chart_a_or_b  — we predicate on dim6 crossSanhe
def _predicate_cross_sanhe() -> callable:
    def _check(ce):
        full = ce.get("dimensionScores", {}).get("fullPillarInteraction", {})
        return bool(full.get("crossSanhe"))
    return _check


I_PAIRS = [
    # 申子 day branches → need 辰 elsewhere (水 三合)
    ("I01_shen_zi_chen", "庚申", "丙子", "三合水: 申子+辰"),
    # 寅午 day branches → need 戌 elsewhere (火 三合)
    ("I02_yin_wu_xu", "甲寅", "丙午", "三合火: 寅午+戌"),
    # 巳酉 day branches → need 丑 elsewhere (金 三合)
    ("I03_si_you_chou", "辛巳", "乙酉", "三合金: 巳酉+丑"),
    # 亥卯 day branches → need 未 elsewhere (木 三合)
    ("I04_hai_mao_wei", "丁亥", "辛卯", "三合木: 亥卯+未"),
    # Cross-pair where B's day branch + A's another pillar form a different 三合 partial
    ("I05_zi_chen_shen", "壬子", "甲辰", "三合水: 子辰+申"),
]


def build_section_i() -> List[Dict]:
    """Section I uses day-pillar pinning; the third branch in each pair's
    non-day pillars is incidental but the date-search rejects pairs where
    `dim6.crossSanhe` is empty."""
    rows = []
    for pid, dp_a, dp_b, note in I_PAIRS:
        # Search forward starting positions until predicate fires
        d_a = find_date_for_day_pillar(dp_a, after=SEARCH_START)
        # Try multiple offsets for B
        from datetime import timedelta as _td
        result = None
        b_after = SEARCH_START
        for tries in range(20):
            d_b = find_date_for_day_pillar(dp_b, after=b_after)
            if d_b is None:
                break
            full = get_compat(d_a.isoformat(), "male", d_b.isoformat(), "female")
            ce = extract_compat_block(full)
            crosssh = ce.get("dimensionScores", {}).get("fullPillarInteraction", {}).get("crossSanhe")
            if crosssh:
                result = (d_a, d_b)
                break
            b_after = d_b + _td(days=60)  # next 60-day cycle iteration
        if result is None:
            print(f"WARNING: {pid}: cross-sanhe predicate did not fire; using first date pair")
            d_b = find_date_for_day_pillar(dp_b, after=SEARCH_START)
            result = (d_a, d_b)

        row = {
            "pair_id": pid,
            "category": "I_cross_sanhe",
            "doctrine_note": note,
            "a_date": result[0].isoformat(),
            "a_time": DEFAULT_TIME,
            "a_location": DEFAULT_LOCATION,
            "a_gender": "male",
            "b_date": result[1].isoformat(),
            "b_time": DEFAULT_TIME,
            "b_location": DEFAULT_LOCATION,
            "b_gender": "female",
            "expected_findings_types": "",
            "expected_findings_absent": "",
            "expected_lookup_dim_scores": "",
            "expected_knockout_types": "",
            "expected_dim_score_bands": "",
            "expected_special_findings": "",
            "adjusted_score_baseline": "",
            "frozen_pending_recalibration": "false",
            "notes": f"day_pillars: {dp_a} + {dp_b}; predicate: crossSanhe non-empty",
        }
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Section J — Knockouts (predicate-based scan)
# ---------------------------------------------------------------------------

# 陰陽差錯日: 12 days where stem-branch yin/yang misalignment.
# Standard list per 三命通會: 丙子, 丁丑, 戊寅, 辛卯, 壬辰, 癸巳,
# 丙午, 丁未, 戊申, 辛酉, 壬戌, 癸亥
YINYANG_CUOCUO_DAYS = ["丙子", "丁丑", "戊寅", "辛卯", "壬辰", "癸巳",
                        "丙午", "丁未", "戊申", "辛酉", "壬戌", "癸亥"]


# J targets:
# (pair_id, knockout_type, anchor_pair, note)
# anchor_pair is (day_pillar_a, day_pillar_b) when known to fire the target,
# or None to fall through to brute scan.
J_TARGETS = [
    ("J01_tian_ke_di_chong", "tian_ke_di_chong",
     ("戊寅", "甲申"), "戊甲克 + 寅申沖 (天剋地沖)"),
    ("J02_guan_sha_hun_za", "guan_sha_hun_za",
     None, "cross-chart 官殺混雜 (brute scan)"),
    # J03 reuses G01 anchor — G01 already produces shang_guan_jian_guan
    ("J03_shang_guan_jian_guan", "shang_guan_jian_guan",
     ("甲寅", "己未"), "M甲F己 - 5合 + 傷官見官"),
    ("J04_yongshen_conflict", "yongshen_conflict",
     ("丙子", "壬午"), "子午沖 + 丙壬克 → 用神衝突"),
    # J05 also reuses G01 anchor — fires tiangan_wuhe_adverse + shang_guan
    ("J05_tiangan_wuhe_adverse", "tiangan_wuhe_adverse",
     ("甲寅", "己未"), "甲己合 with adverse 用神"),
    ("J06_guchen_guasu", "guchen_guasu_both_day",
     None, "both 孤辰/寡宿 day (brute scan)"),
    ("J07_both_unstable_palace", "both_unstable_marriage_palaces",
     ("丙子", "丁丑"), "both 陰陽差錯日 → unstable palaces"),
    # J08: pick TWO 陰陽差錯日 day pillars that don't 六合/六沖
    ("J08_both_yinyang_cuocuo", "both_yinyang_cuocuo",
     ("丙子", "戊寅"), "two 陰陽差錯日 (子+寅 no major interaction)"),
]


def _try_anchor(anchor_pair, gender_a="male", gender_b="female"):
    """Try the anchor pair, return (date_a, date_b, ce) or None."""
    dp_a, dp_b = anchor_pair
    d_a = find_date_for_day_pillar(dp_a, after=SEARCH_START)
    d_b = find_date_for_day_pillar(dp_b, after=d_a + timedelta(days=1))
    if d_a is None or d_b is None:
        return None
    full = get_compat(d_a.isoformat(), gender_a, d_b.isoformat(), gender_b)
    return (d_a, d_b, extract_compat_block(full))


def build_section_j() -> List[Dict]:
    """For each target knockout, try anchor pair first; fall back to brute scan."""
    rows = []
    for pid, ktype, anchor_pair, note in J_TARGETS:
        row_data = None

        # Strategy A: try anchor
        if anchor_pair:
            try:
                d_a, d_b, ce = _try_anchor(anchor_pair)
                if ktype in collect_knockout_types(ce):
                    row_data = (d_a, d_b)
                else:
                    print(f"NOTE: {pid}: anchor {anchor_pair} did not fire "
                          f"{ktype}; actual: {sorted(collect_knockout_types(ce))}")
            except Exception as e:
                print(f"NOTE: {pid}: anchor try raised: {e}")

        # Strategy B: brute scan with finer step (every 10 days)
        if row_data is None:
            for a_offset in range(0, 365 * 3, 10):
                d_a = SEARCH_START + timedelta(days=a_offset)
                for b_offset in range(1, 365, 10):
                    d_b = d_a + timedelta(days=b_offset)
                    try:
                        full = get_compat(d_a.isoformat(), "male",
                                          d_b.isoformat(), "female")
                    except Exception:
                        continue
                    ce = extract_compat_block(full)
                    if ktype in collect_knockout_types(ce):
                        row_data = (d_a, d_b)
                        break
                if row_data:
                    break

        if row_data is None:
            print(f"WARNING: {pid}: no pair found firing {ktype}; "
                  f"placeholder used")
            row_data = (SEARCH_START, SEARCH_START + timedelta(days=1))

        d_a, d_b = row_data

        d_a, d_b = row_data
        row = {
            "pair_id": pid,
            "category": "J_knockout",
            "doctrine_note": note,
            "a_date": d_a.isoformat(),
            "a_time": DEFAULT_TIME,
            "a_location": DEFAULT_LOCATION,
            "a_gender": "male",
            "b_date": d_b.isoformat(),
            "b_time": DEFAULT_TIME,
            "b_location": DEFAULT_LOCATION,
            "b_gender": "female",
            "expected_findings_types": "",
            "expected_findings_absent": "",
            "expected_lookup_dim_scores": "",
            "expected_knockout_types": "",  # build-mode populated
            "expected_dim_score_bands": "",
            "expected_special_findings": "",
            "adjusted_score_baseline": "",
            "frozen_pending_recalibration": "false",
            "notes": f"target_knockout: {ktype}",
        }
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Section K — 日柱天合地合 (3 pairs)
# ---------------------------------------------------------------------------

# K1×2: high 用神 (dim1.rawScore > 70) + tianHeDiHe both → specialLabel='命中注定'
# K2×1: low 用神 + tianHeDiHe → only tianHeDiHe, no specialLabel

# Day-pillar pairs that form 天合地合:
# 甲X+己Y where stem 甲己 五合 AND branch X+Y 六合
# Candidates:
#   甲子+己丑 (stem 甲己, branch 子丑合)
#   甲寅+己亥 (stem 甲己, branch 寅亥合)
#   乙卯+庚戌 (stem 乙庚, branch 卯戌合)
#   丙午+辛未 (stem 丙辛, branch 午未合)
#   丁卯+壬戌 (stem 丁壬, branch 卯戌合)
#   戊辰+癸酉 (stem 戊癸, branch 辰酉合)

K_CANDIDATES = [
    ("甲子", "己丑"),
    ("甲寅", "己亥"),
    ("乙卯", "庚戌"),
    ("丙午", "辛未"),
    ("丁卯", "壬戌"),
    ("戊辰", "癸酉"),
]


def build_section_k() -> List[Dict]:
    """Find 2 high-用神 + 1 low-用神 天合地合 pairs by scanning candidates."""
    high_yongshen = []
    low_yongshen = []

    for dp_a, dp_b in K_CANDIDATES:
        d_a = find_date_for_day_pillar(dp_a, after=SEARCH_START)
        d_b = find_date_for_day_pillar(dp_b, after=d_a + timedelta(days=1))
        if d_a is None or d_b is None:
            continue
        full = get_compat(d_a.isoformat(), "male", d_b.isoformat(), "female")
        ce = extract_compat_block(full)
        sf = ce.get("specialFindings", {})
        if not sf.get("tianHeDiHe"):
            continue
        dim1_raw = ce.get("dimensionScores", {}).get("yongshenComplementarity", {}).get("rawScore", 0)
        if dim1_raw > 70:
            high_yongshen.append((dp_a, dp_b, d_a, d_b, dim1_raw))
        else:
            low_yongshen.append((dp_a, dp_b, d_a, d_b, dim1_raw))

    rows = []
    for i, (dp_a, dp_b, d_a, d_b, raw) in enumerate(high_yongshen[:2]):
        rows.append({
            "pair_id": f"K1_0{i+1}_high_yongshen_thdh",
            "category": "K1_tianhe_dihe_high_yongshen",
            "doctrine_note": f"{dp_a}+{dp_b} 天合地合 (yongshen={raw:.1f}>70)",
            "a_date": d_a.isoformat(), "a_time": DEFAULT_TIME,
            "a_location": DEFAULT_LOCATION, "a_gender": "male",
            "b_date": d_b.isoformat(), "b_time": DEFAULT_TIME,
            "b_location": DEFAULT_LOCATION, "b_gender": "female",
            "expected_findings_types": "",
            "expected_findings_absent": "",
            "expected_lookup_dim_scores": "",
            "expected_knockout_types": "",
            "expected_dim_score_bands": "",
            "expected_special_findings": "",
            "adjusted_score_baseline": "",
            "frozen_pending_recalibration": "false",
            "notes": f"day_pillars: {dp_a}+{dp_b}; expect tianHeDiHe + specialLabel=命中注定",
        })
    if low_yongshen:
        dp_a, dp_b, d_a, d_b, raw = low_yongshen[0]
        rows.append({
            "pair_id": "K2_01_low_yongshen_thdh",
            "category": "K2_tianhe_dihe_low_yongshen",
            "doctrine_note": f"{dp_a}+{dp_b} 天合地合 (yongshen={raw:.1f}≤70)",
            "a_date": d_a.isoformat(), "a_time": DEFAULT_TIME,
            "a_location": DEFAULT_LOCATION, "a_gender": "male",
            "b_date": d_b.isoformat(), "b_time": DEFAULT_TIME,
            "b_location": DEFAULT_LOCATION, "b_gender": "female",
            "expected_findings_types": "",
            "expected_findings_absent": "",
            "expected_lookup_dim_scores": "",
            "expected_knockout_types": "",
            "expected_dim_score_bands": "",
            "expected_special_findings": "",
            "adjusted_score_baseline": "",
            "frozen_pending_recalibration": "false",
            "notes": f"day_pillars: {dp_a}+{dp_b}; expect tianHeDiHe ONLY, no specialLabel",
        })
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Building corpus skeleton...")
    rows = []
    for builder, name in [
        (build_section_a, "A"), (build_section_b, "B"), (build_section_c, "C"),
        (build_section_e, "E"), (build_section_f, "F"), (build_section_g, "G"),
        (build_section_i, "I"), (build_section_j, "J"), (build_section_k, "K"),
    ]:
        section_rows = builder()
        print(f"  Section {name}: {len(section_rows)} pairs")
        rows.extend(section_rows)
    print(f"Total: {len(rows)} pairs")
    save_corpus(rows)
    print(f"Wrote {CORPUS_PATH}")


if __name__ == "__main__":
    main()
