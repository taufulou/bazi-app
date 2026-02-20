"""
Tests for stem_combinations.py — 天干合化 + 天干七沖

Tests all 5 combination pairs, adjacency requirements, transformation defaults,
Day Master involvement flag, and stem clash detection.

Source: 《子平真詮·論天干合化》, 《淵海子平》
"""

import pytest
from app.stem_combinations import (
    STEM_COMBINATION_LOOKUP,
    STEM_COMBINATION_PAIRS,
    STEM_CLASH_LOOKUP,
    STEM_CLASH_PAIRS,
    analyze_stem_relationships,
    find_stem_clashes,
    find_stem_combinations,
)


# ============================================================
# Test Fixtures — Helper pillar builders
# ============================================================

def _make_pillars(year_stem, month_stem, day_stem, hour_stem,
                  year_branch='子', month_branch='子', day_branch='子', hour_branch='子'):
    """Build a minimal pillars dict for testing."""
    return {
        'year':  {'stem': year_stem, 'branch': year_branch},
        'month': {'stem': month_stem, 'branch': month_branch},
        'day':   {'stem': day_stem, 'branch': day_branch},
        'hour':  {'stem': hour_stem, 'branch': hour_branch},
    }


# ============================================================
# Combination Pair Tests — All 5 pairs
# ============================================================

class TestStemCombinationPairs:
    """Verify all 5 天干合化 pairs are correctly defined."""

    def test_jia_ji_he_tu(self):
        """甲己合化土 — 中正之合"""
        key = ('甲', '己')
        assert key in STEM_COMBINATION_PAIRS
        assert STEM_COMBINATION_PAIRS[key]['element'] == '土'
        assert STEM_COMBINATION_PAIRS[key]['name'] == '中正之合'

    def test_yi_geng_he_jin(self):
        """乙庚合化金 — 仁義之合"""
        key = ('乙', '庚')
        assert key in STEM_COMBINATION_PAIRS
        assert STEM_COMBINATION_PAIRS[key]['element'] == '金'

    def test_bing_xin_he_shui(self):
        """丙辛合化水 — 威制之合"""
        key = ('丙', '辛')
        assert key in STEM_COMBINATION_PAIRS
        assert STEM_COMBINATION_PAIRS[key]['element'] == '水'

    def test_ding_ren_he_mu(self):
        """丁壬合化木 — 淫慝之合"""
        key = ('丁', '壬')
        assert key in STEM_COMBINATION_PAIRS
        assert STEM_COMBINATION_PAIRS[key]['element'] == '木'

    def test_wu_gui_he_huo(self):
        """戊癸合化火 — 無情之合"""
        key = ('戊', '癸')
        assert key in STEM_COMBINATION_PAIRS
        assert STEM_COMBINATION_PAIRS[key]['element'] == '火'

    def test_exactly_five_pairs(self):
        """There are exactly 5 combination pairs."""
        assert len(STEM_COMBINATION_PAIRS) == 5

    def test_lookup_bidirectional(self):
        """Lookup works in both directions for each pair."""
        for (a, b) in STEM_COMBINATION_PAIRS:
            assert a in STEM_COMBINATION_LOOKUP
            assert b in STEM_COMBINATION_LOOKUP
            assert STEM_COMBINATION_LOOKUP[a][0] == b
            assert STEM_COMBINATION_LOOKUP[b][0] == a


# ============================================================
# Adjacency Tests — Combinations only work between adjacent pillars
# ============================================================

class TestCombinationAdjacency:
    """Combinations require adjacent pillars (year↔month, month↔day, day↔hour)."""

    def test_year_month_adjacent(self):
        """甲年 + 己月 → combination found."""
        pillars = _make_pillars('甲', '己', '丙', '丁')
        combos = find_stem_combinations(pillars, '丙')
        assert len(combos) == 1
        assert combos[0]['pillarA'] == 'year'
        assert combos[0]['pillarB'] == 'month'

    def test_month_day_adjacent(self):
        """己月 + 甲日 → combination found."""
        pillars = _make_pillars('丙', '己', '甲', '丁')
        combos = find_stem_combinations(pillars, '甲')
        assert len(combos) == 1
        assert combos[0]['pillarA'] == 'month'
        assert combos[0]['pillarB'] == 'day'

    def test_day_hour_adjacent(self):
        """甲日 + 己時 → combination found."""
        pillars = _make_pillars('丙', '丁', '甲', '己')
        combos = find_stem_combinations(pillars, '甲')
        assert len(combos) == 1
        assert combos[0]['pillarA'] == 'day'
        assert combos[0]['pillarB'] == 'hour'

    def test_year_day_not_adjacent(self):
        """甲年 + 己日 → NOT found (not adjacent)."""
        pillars = _make_pillars('甲', '丙', '己', '丁')
        combos = find_stem_combinations(pillars, '己')
        assert len(combos) == 0

    def test_year_hour_not_adjacent(self):
        """甲年 + 己時 → NOT found."""
        pillars = _make_pillars('甲', '丙', '丁', '己')
        combos = find_stem_combinations(pillars, '丁')
        assert len(combos) == 0


# ============================================================
# Transformation Defaults
# ============================================================

class TestTransformationDefaults:
    """Default to 合而不化 (combining without transforming)."""

    def test_always_he_er_bu_hua(self):
        """All combinations have transformed=False in v1.0."""
        pillars = _make_pillars('甲', '己', '丙', '丁')
        combos = find_stem_combinations(pillars, '丙')
        assert len(combos) == 1
        assert combos[0]['transformed'] is False

    def test_description_includes_he_er_bu_hua(self):
        """Description mentions 合而不化."""
        pillars = _make_pillars('甲', '己', '丙', '丁')
        combos = find_stem_combinations(pillars, '丙')
        assert '合而不化' in combos[0]['description']


# ============================================================
# Day Master Involvement
# ============================================================

class TestDayMasterInvolved:
    """Flag when Day Master participates in combination."""

    def test_day_master_in_combo(self):
        """Day Master 甲 combines with 己 → dayMasterInvolved=True, significance=high."""
        pillars = _make_pillars('丙', '己', '甲', '丁')
        combos = find_stem_combinations(pillars, '甲')
        assert len(combos) == 1
        assert combos[0]['dayMasterInvolved'] is True
        assert combos[0]['significance'] == 'high'

    def test_day_master_not_in_combo(self):
        """Day Master 丙 not in 甲己合 → dayMasterInvolved=False, significance=medium."""
        pillars = _make_pillars('甲', '己', '丙', '丁')
        combos = find_stem_combinations(pillars, '丙')
        assert len(combos) == 1
        assert combos[0]['dayMasterInvolved'] is False
        assert combos[0]['significance'] == 'medium'


# ============================================================
# Multiple Combinations
# ============================================================

class TestMultipleCombinations:
    """Charts can have 0, 1, 2, or 3 combinations."""

    def test_no_combinations(self):
        """甲丙戊庚 — no combination pairs among adjacent stems."""
        pillars = _make_pillars('甲', '丙', '戊', '庚')
        combos = find_stem_combinations(pillars, '戊')
        assert len(combos) == 0

    def test_three_combinations(self):
        """甲己甲己 — 3 adjacent pairs all have 甲己合 (year↔month, month↔day, day↔hour)."""
        pillars = _make_pillars('甲', '己', '甲', '己')
        combos = find_stem_combinations(pillars, '甲')
        assert len(combos) == 3

    def test_three_adjacent_combos(self):
        """乙庚乙庚 — 3 adjacent pairs, all have 乙庚合."""
        pillars = _make_pillars('乙', '庚', '乙', '庚')
        combos = find_stem_combinations(pillars, '乙')
        # year↔month=乙庚, month↔day=庚乙, day↔hour=乙庚 → 3 combos
        assert len(combos) == 3


# ============================================================
# Stem Clash Tests — 天干七沖
# ============================================================

class TestStemClashPairs:
    """Verify all 4 天干七沖 opposition pairs."""

    def test_jia_geng_clash(self):
        """甲庚沖 — 木金相沖"""
        assert ('甲', '庚') in STEM_CLASH_PAIRS
        assert STEM_CLASH_PAIRS[('甲', '庚')]['elements'] == '木金'

    def test_yi_xin_clash(self):
        """乙辛沖 — 木金相沖"""
        assert ('乙', '辛') in STEM_CLASH_PAIRS

    def test_bing_ren_clash(self):
        """丙壬沖 — 火水相沖"""
        assert ('丙', '壬') in STEM_CLASH_PAIRS
        assert STEM_CLASH_PAIRS[('丙', '壬')]['elements'] == '火水'

    def test_ding_gui_clash(self):
        """丁癸沖 — 火水相沖"""
        assert ('丁', '癸') in STEM_CLASH_PAIRS

    def test_exactly_four_clash_pairs(self):
        """There are exactly 4 stem clash pairs."""
        assert len(STEM_CLASH_PAIRS) == 4

    def test_no_wu_ji_clash(self):
        """戊己 (earth stems) do NOT clash — no earth vs earth opposition."""
        assert ('戊', '己') not in STEM_CLASH_PAIRS

    def test_clash_lookup_bidirectional(self):
        """Lookup works in both directions."""
        assert STEM_CLASH_LOOKUP['甲'] == '庚'
        assert STEM_CLASH_LOOKUP['庚'] == '甲'


class TestStemClashDetection:
    """Clash detection across ALL 6 pillar pairs (not just adjacent)."""

    def test_clash_across_non_adjacent(self):
        """甲年 + 庚日 → clash found (year↔day is not adjacent but clashes check all)."""
        pillars = _make_pillars('甲', '丙', '庚', '丁')
        clashes = find_stem_clashes(pillars, '庚')
        assert len(clashes) >= 1
        # Should find 甲庚 clash
        jia_geng = [c for c in clashes if '甲' in c['stems'] and '庚' in c['stems']]
        assert len(jia_geng) == 1

    def test_clash_year_hour(self):
        """甲年 + 庚時 → clash found."""
        pillars = _make_pillars('甲', '丙', '丁', '庚')
        clashes = find_stem_clashes(pillars, '丁')
        jia_geng = [c for c in clashes if '甲' in c['stems'] and '庚' in c['stems']]
        assert len(jia_geng) == 1

    def test_no_clash(self):
        """甲乙丙丁 — no clashes among these stems."""
        pillars = _make_pillars('甲', '乙', '丙', '丁')
        clashes = find_stem_clashes(pillars, '丙')
        assert len(clashes) == 0

    def test_day_master_involved_in_clash(self):
        """Day Master 甲 clashes with 庚 → dayMasterInvolved=True."""
        pillars = _make_pillars('丙', '庚', '甲', '丁')
        clashes = find_stem_clashes(pillars, '甲')
        geng_clashes = [c for c in clashes if '庚' in c['stems']]
        assert len(geng_clashes) == 1
        assert geng_clashes[0]['dayMasterInvolved'] is True


# ============================================================
# Combo-Clash Interactions
# ============================================================

class TestComboClashInteractions:
    """When a stem is in both a combo and a clash, combo reduces clash."""

    def test_interaction_detected(self):
        """甲己合 + 甲庚沖 → interaction: clash reduced."""
        # Year=甲, Month=己 (combo), Hour=庚 (clashes with 甲)
        pillars = _make_pillars('甲', '己', '丙', '庚')
        result = analyze_stem_relationships(pillars, '丙')
        assert len(result['combinations']) == 1
        assert len(result['clashes']) >= 1
        assert len(result['interactions']) >= 1
        assert result['interactions'][0]['effect'] == 'clash_reduced_50pct'

    def test_no_interaction_when_separate(self):
        """Combo and clash involve different stems → no interaction."""
        # 丙辛合 (month↔day) but 甲庚沖 (year↔hour) — different stems
        pillars = _make_pillars('甲', '丙', '辛', '庚')
        result = analyze_stem_relationships(pillars, '辛')
        # 甲 is in clash but not in combo (丙辛 combo doesn't involve 甲)
        combos = result['combinations']
        clashes = result['clashes']
        if combos and clashes:
            combo_stems = set()
            for c in combos:
                combo_stems.update(c['stems'])
            # Check if any clash stem is in combo stems
            has_overlap = False
            for cl in clashes:
                if cl['stems'][0] in combo_stems or cl['stems'][1] in combo_stems:
                    has_overlap = True
            if not has_overlap:
                assert len(result['interactions']) == 0


# ============================================================
# Summary Text
# ============================================================

class TestSummaryText:
    def test_no_relationships_summary(self):
        """When no combos or clashes, summary says 天干無特殊合沖關係."""
        pillars = _make_pillars('甲', '乙', '丙', '丁')
        result = analyze_stem_relationships(pillars, '丙')
        assert '天干無特殊合沖關係' in result['summary']

    def test_combo_in_summary(self):
        """Combo description appears in summary."""
        pillars = _make_pillars('甲', '己', '丙', '丁')
        result = analyze_stem_relationships(pillars, '丙')
        assert '甲己' in result['summary']
        assert '合' in result['summary']
