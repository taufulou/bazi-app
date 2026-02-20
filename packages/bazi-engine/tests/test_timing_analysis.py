"""
Tests for Phase 11D: Timing Analysis (歲運分析)

Tests for:
  - 歲運並臨 (Luck Period = Annual Star)
  - 天剋地沖 (Stem clash + branch clash)
  - 伏吟 (Same pillar repeating)
  - 反吟 (Clashing pillar appearing)
  - Natal interactions (大運×natal, 流年×natal)
  - LP × Annual cross-interactions
  - Full integration via calculator.py
"""

import pytest
from app.timing_analysis import (
    analyze_branch_natal_interactions,
    analyze_lp_annual_interaction,
    analyze_stem_natal_interactions,
    analyze_timing_for_annual_stars,
    analyze_timing_for_luck_periods,
    detect_fanyin,
    detect_fuyin,
    detect_sui_yun_bing_lin,
    detect_tian_ke_di_chong,
    generate_timing_insights,
)
from app.calculator import calculate_bazi


# ============================================================
# Helper: build a minimal 4-pillar dict for testing
# ============================================================


def make_pillars(
    year_s='甲', year_b='子',
    month_s='丙', month_b='寅',
    day_s='庚', day_b='午',
    hour_s='壬', hour_b='子',
):
    """Create a minimal pillars dict for testing."""
    return {
        'year': {'stem': year_s, 'branch': year_b},
        'month': {'stem': month_s, 'branch': month_b},
        'day': {'stem': day_s, 'branch': day_b},
        'hour': {'stem': hour_s, 'branch': hour_b},
    }


# ============================================================
# 歲運並臨 Tests
# ============================================================


class TestSuiYunBingLin:
    """Test 歲運並臨 detection — LP stem+branch == Annual stem+branch."""

    def test_identical_stem_branch_detected(self):
        result = detect_sui_yun_bing_lin(
            {'stem': '甲', 'branch': '子'},
            {'stem': '甲', 'branch': '子'},
        )
        assert result is not None
        assert result['type'] == '歲運並臨'
        assert result['severity'] == 'CRITICAL'

    def test_different_stem_not_detected(self):
        result = detect_sui_yun_bing_lin(
            {'stem': '甲', 'branch': '子'},
            {'stem': '乙', 'branch': '子'},
        )
        assert result is None

    def test_different_branch_not_detected(self):
        result = detect_sui_yun_bing_lin(
            {'stem': '甲', 'branch': '子'},
            {'stem': '甲', 'branch': '午'},
        )
        assert result is None


# ============================================================
# 天剋地沖 Tests
# ============================================================


class TestTianKeDiChong:
    """Test 天剋地沖 detection — stem clash + branch clash simultaneously."""

    def test_jia_geng_zi_wu_detected(self):
        """甲庚沖 (stem) + 子午沖 (branch) = 天剋地沖."""
        result = detect_tian_ke_di_chong('甲', '子', '庚', '午')
        assert result is not None
        assert result['type'] == '天剋地沖'
        assert result['severity'] == 'VERY_HIGH'

    def test_bing_ren_yin_shen_detected(self):
        """丙壬沖 (stem) + 寅申沖 (branch) = 天剋地沖."""
        result = detect_tian_ke_di_chong('丙', '寅', '壬', '申')
        assert result is not None
        assert result['type'] == '天剋地沖'

    def test_stem_clash_only_not_detected(self):
        """Stem clash without branch clash = NOT 天剋地沖."""
        result = detect_tian_ke_di_chong('甲', '子', '庚', '子')
        assert result is None

    def test_branch_clash_only_not_detected(self):
        """Branch clash without stem clash = NOT 天剋地沖."""
        result = detect_tian_ke_di_chong('甲', '子', '甲', '午')
        assert result is None

    def test_no_clash_at_all(self):
        result = detect_tian_ke_di_chong('甲', '子', '乙', '丑')
        assert result is None

    def test_context_included_in_description(self):
        result = detect_tian_ke_di_chong('甲', '子', '庚', '午', context='大運vs流年')
        assert '大運vs流年' in result['description']


# ============================================================
# 伏吟 Tests
# ============================================================


class TestFuyin:
    """Test 伏吟 detection — same stem+branch repeating in period."""

    def test_fuyin_matching_year(self):
        pillars = make_pillars(year_s='甲', year_b='子')
        results = detect_fuyin(pillars, '甲', '子')
        assert len(results) >= 1
        year_result = [r for r in results if r['pillar'] == 'year']
        assert len(year_result) == 1
        assert year_result[0]['type'] == '伏吟'

    def test_fuyin_matching_day(self):
        pillars = make_pillars(day_s='庚', day_b='午')
        results = detect_fuyin(pillars, '庚', '午')
        assert any(r['pillar'] == 'day' for r in results)

    def test_no_fuyin_when_no_match(self):
        pillars = make_pillars()
        results = detect_fuyin(pillars, '乙', '丑')
        assert len(results) == 0

    def test_fuyin_description_contains_pillar_info(self):
        pillars = make_pillars(month_s='丙', month_b='寅')
        results = detect_fuyin(pillars, '丙', '寅')
        assert any('月柱' in r['description'] for r in results)


# ============================================================
# 反吟 Tests
# ============================================================


class TestFanyin:
    """Test 反吟 detection — stem clash + branch clash against natal pillar."""

    def test_fanyin_against_day_pillar(self):
        """庚午 day pillar + 甲子 period = 甲庚沖 + 子午沖 = 反吟."""
        pillars = make_pillars(day_s='庚', day_b='午')
        results = detect_fanyin(pillars, '甲', '子')
        assert len(results) >= 1
        day_result = [r for r in results if r['pillar'] == 'day']
        assert len(day_result) == 1
        assert day_result[0]['type'] == '反吟'

    def test_no_fanyin_when_no_full_clash(self):
        pillars = make_pillars(day_s='庚', day_b='午')
        # 甲午 → stem clash (甲庚) but NOT branch clash (午午 same)
        results = detect_fanyin(pillars, '甲', '午')
        assert len(results) == 0


# ============================================================
# Branch Natal Interaction Tests
# ============================================================


class TestBranchNatalInteractions:
    """Test period branch vs natal branch interactions."""

    def test_clash_detected(self):
        """Period 午 vs natal 子 (year) = 六沖."""
        pillars = make_pillars(year_b='子')
        results = analyze_branch_natal_interactions('午', pillars, '甲')
        clashes = [r for r in results if r['type'] == '六沖']
        assert len(clashes) >= 1
        assert clashes[0]['pillar'] == 'year'

    def test_harmony_detected(self):
        """Period 丑 vs natal 子 (year) = 六合."""
        pillars = make_pillars(year_b='子')
        results = analyze_branch_natal_interactions('丑', pillars, '甲')
        harmonies = [r for r in results if r['type'] == '六合']
        assert len(harmonies) >= 1

    def test_harm_detected(self):
        """Period 未 vs natal 子 (year) = 六害."""
        pillars = make_pillars(year_b='子')
        results = analyze_branch_natal_interactions('未', pillars, '甲')
        harms = [r for r in results if r['type'] == '六害']
        assert len(harms) >= 1

    def test_triple_harmony_detected(self):
        """Period 辰 + natal 申(year) + 子(day) = 申子辰三合水局."""
        pillars = make_pillars(year_b='申', day_b='子')
        results = analyze_branch_natal_interactions('辰', pillars, '甲')
        triples = [r for r in results if r['type'] == '三合']
        assert len(triples) >= 1
        assert triples[0]['element'] == '水'

    def test_no_false_positives_when_no_relationship(self):
        """Period 寅 vs natal 午 — no clash/harmony/harm (no direct pair)."""
        pillars = make_pillars(year_b='午', month_b='午', day_b='午', hour_b='午')
        results = analyze_branch_natal_interactions('寅', pillars, '甲')
        # 寅午 is NOT a clash or harmony (they're in 寅午戌 triple but need 戌)
        # Check there are no 六沖 or 六合 (寅-午 has no pairwise relationship)
        clashes = [r for r in results if r['type'] == '六沖']
        harmonies = [r for r in results if r['type'] == '六合']
        assert len(clashes) == 0
        assert len(harmonies) == 0


# ============================================================
# Stem Natal Interaction Tests
# ============================================================


class TestStemNatalInteractions:
    """Test period stem vs natal stem interactions."""

    def test_stem_combination_detected(self):
        """Period 己 vs natal 甲 (year) = 甲己合 (中正之合)."""
        pillars = make_pillars(year_s='甲')
        results = analyze_stem_natal_interactions('己', pillars, '庚')
        combos = [r for r in results if r['type'] == '天干合']
        assert len(combos) >= 1
        assert combos[0]['name'] == '中正之合'

    def test_stem_clash_detected(self):
        """Period 庚 vs natal 甲 (year) = 甲庚沖."""
        pillars = make_pillars(year_s='甲')
        results = analyze_stem_natal_interactions('庚', pillars, '甲')
        clashes = [r for r in results if r['type'] == '天干沖']
        assert len(clashes) >= 1

    def test_day_master_involved_flagged(self):
        """When period stem combines with day stem, dayMasterInvolved should be True."""
        pillars = make_pillars(day_s='甲')
        results = analyze_stem_natal_interactions('己', pillars, '甲')
        combos = [r for r in results if r['type'] == '天干合' and r['pillar'] == 'day']
        assert len(combos) >= 1
        assert combos[0]['dayMasterInvolved'] is True


# ============================================================
# LP × Annual Cross-Interaction Tests
# ============================================================


class TestLPAnnualInteraction:
    """Test Luck Period × Annual Star cross-interactions."""

    def test_sui_yun_bing_lin(self):
        """Identical LP and annual = 歲運並臨 (dominant finding)."""
        results = analyze_lp_annual_interaction('甲', '子', '甲', '子')
        assert len(results) == 1
        assert results[0]['type'] == '歲運並臨'

    def test_tian_ke_di_chong_lp_vs_annual(self):
        """甲子 LP + 庚午 Annual = 天剋地沖."""
        results = analyze_lp_annual_interaction('甲', '子', '庚', '午')
        types = [r['type'] for r in results]
        assert '天剋地沖' in types

    def test_branch_clash_without_stem_clash(self):
        """子 LP + 午 Annual = branch clash, no full TKDC."""
        results = analyze_lp_annual_interaction('甲', '子', '甲', '午')
        types = [r['type'] for r in results]
        assert '大運流年地支沖' in types
        assert '天剋地沖' not in types

    def test_branch_harmony(self):
        """子 LP + 丑 Annual = 六合."""
        results = analyze_lp_annual_interaction('甲', '子', '乙', '丑')
        types = [r['type'] for r in results]
        assert '大運流年地支合' in types


# ============================================================
# Full Enrichment Tests
# ============================================================


class TestTimingEnrichment:
    """Test analyze_timing_for_luck_periods and analyze_timing_for_annual_stars."""

    def test_luck_periods_get_natal_interactions(self):
        pillars = make_pillars(day_s='庚', day_b='午')
        lp = [
            {
                'startAge': 3, 'endAge': 12,
                'startYear': 1993, 'endYear': 2002,
                'stem': '甲', 'branch': '子',  # 甲庚沖 + 子午沖 → fanyin vs day
                'tenGod': '偏財', 'isCurrent': False,
            },
            {
                'startAge': 13, 'endAge': 22,
                'startYear': 2003, 'endYear': 2012,
                'stem': '乙', 'branch': '丑',
                'tenGod': '正財', 'isCurrent': True,
            },
        ]
        result = analyze_timing_for_luck_periods(pillars, lp, '庚')
        # First period should have interactions (反吟 vs day)
        assert 'natalInteractions' in result[0]
        # Second period should also have the field
        assert 'natalInteractions' in result[1]

    def test_annual_stars_get_natal_and_lp_interactions(self):
        pillars = make_pillars(year_b='子')
        lp = [{
            'startAge': 13, 'endAge': 22,
            'startYear': 2020, 'endYear': 2029,
            'stem': '乙', 'branch': '丑',
            'tenGod': '正財', 'isCurrent': True,
        }]
        stars = [
            {
                'year': 2025,
                'stem': '乙', 'branch': '巳',
                'tenGod': '正財', 'isCurrent': True,
            },
        ]
        result = analyze_timing_for_annual_stars(pillars, stars, lp, '甲')
        assert 'natalInteractions' in result[0]
        assert 'lpInteraction' in result[0]


# ============================================================
# Timing Insights Generation Tests
# ============================================================


class TestTimingInsights:
    """Test generate_timing_insights for pre-analysis integration."""

    def test_basic_insights_structure(self):
        pillars = make_pillars()
        lp = [{
            'startAge': 13, 'endAge': 22,
            'startYear': 2020, 'endYear': 2029,
            'stem': '乙', 'branch': '丑',
            'tenGod': '正財', 'isCurrent': True,
            'natalInteractions': [],
        }]
        stars = [{
            'year': 2026,
            'stem': '丙', 'branch': '午',
            'tenGod': '偏印', 'isCurrent': True,
            'natalInteractions': [],
            'lpInteraction': [],
        }]
        insights = generate_timing_insights(pillars, lp, stars, '甲', 2026)
        assert 'currentPeriod' in insights
        assert 'currentYear' in insights
        assert 'significantFindings' in insights

    def test_current_period_found(self):
        pillars = make_pillars()
        lp = [{
            'startAge': 13, 'endAge': 22,
            'startYear': 2020, 'endYear': 2029,
            'stem': '乙', 'branch': '丑',
            'tenGod': '正財', 'isCurrent': True,
            'natalInteractions': [],
        }]
        stars = []
        insights = generate_timing_insights(pillars, lp, stars, '甲', 2026)
        assert insights['currentPeriod'] is not None
        assert insights['currentPeriod']['stem'] == '乙'

    def test_current_year_not_found_returns_none(self):
        pillars = make_pillars()
        insights = generate_timing_insights(pillars, [], [], '甲', 2099)
        assert insights['currentYear'] is None


# ============================================================
# Full Integration Test
# ============================================================


class TestTimingIntegration:
    """Verify timing analysis appears in full chart calculation."""

    def test_timing_insights_in_chart(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert 'timingInsights' in r
        assert isinstance(r['timingInsights'], dict)
        assert 'currentPeriod' in r['timingInsights']
        assert 'currentYear' in r['timingInsights']

    def test_luck_periods_have_natal_interactions(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for lp in r['luckPeriods']:
            assert 'natalInteractions' in lp

    def test_annual_stars_have_natal_interactions(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for star in r['annualStars']:
            assert 'natalInteractions' in star
            assert 'lpInteraction' in star

    def test_pre_analysis_includes_timing(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert 'timingInsights' in r['preAnalysis']

    def test_timing_insights_have_significant_findings(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        ti = r['timingInsights']
        assert 'significantFindings' in ti
        assert isinstance(ti['significantFindings'], list)
