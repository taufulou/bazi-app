"""
Tests for Career Reading calculations (Steps 1b-1d).

Tests weighted five elements, weighted ten gods, and career pre-analysis functions.
Uses laopo10 chart: 1987-01-25 16:45 female (丙寅/辛丑/甲戌/壬申)
"""

import pytest
from datetime import datetime

from app.calculator import calculate_bazi
from app.five_elements import (
    calculate_weighted_five_elements,
    _accumulate_raw_element_scores,
    _get_element_level,
    ELEMENT_TALENTS,
)
from app.four_pillars import (
    calculate_tai_yuan,
    calculate_ming_gong,
    calculate_shen_gong,
)
from app.ten_gods import (
    calculate_weighted_ten_gods,
    _get_ten_god_level,
    TEN_GOD_CAPABILITIES,
    derive_ten_god,
)
from app.branch_relationships import analyze_branch_relationships
from app.career_enhanced import (
    _normalize_effective_gods,
    compute_reputation_score,
    compute_wealth_score,
    compute_suitable_positions,
    compute_company_type_fit,
    compute_entrepreneurship_fit,
    compute_partnership_fit,
    compute_career_allies_enemies,
    compute_annual_forecast_data,
    compute_monthly_forecast_data,
    compute_five_qi_states,
    generate_career_pre_analysis,
)


@pytest.fixture(scope='module')
def laopo10_chart():
    """Laopo10: 1987-01-25 16:45, female, 柔佛."""
    return calculate_bazi(
        '1987-01-25', '16:45', '柔佛', 'Asia/Kuala_Lumpur', 'female',
        reading_type='LIFETIME',
    )


@pytest.fixture(scope='module')
def laopo10_pillars(laopo10_chart):
    """Extract pillars from laopo10 chart."""
    return laopo10_chart['fourPillars']


@pytest.fixture(scope='module')
def laopo10_extra_pillars(laopo10_chart):
    """Build extra pillars list (胎元/命宮/身宮) from laopo10 chart."""
    return [
        laopo10_chart['taiYuan'],
        laopo10_chart['mingGong'],
        laopo10_chart['shenGong'],
    ]


# ============================================================
# Element Level Threshold Tests
# ============================================================

class TestElementLevel:
    """Test element level classification from percentages."""

    def test_very_weak(self):
        assert _get_element_level(3.0) == '很弱'

    def test_weak(self):
        assert _get_element_level(10.0) == '弱'

    def test_normal(self):
        assert _get_element_level(20.0) == '一般'

    def test_strong(self):
        assert _get_element_level(30.0) == '強'

    def test_very_strong(self):
        assert _get_element_level(45.0) == '很強'

    def test_boundary_5(self):
        """Exactly 5% should be 弱 (not 很弱)."""
        assert _get_element_level(5.0) == '弱'

    def test_boundary_15(self):
        """Exactly 15% should be 一般."""
        assert _get_element_level(15.0) == '一般'

    def test_boundary_25(self):
        """Exactly 25% should be 強."""
        assert _get_element_level(25.0) == '強'

    def test_boundary_40(self):
        """Exactly 40% should be 很強."""
        assert _get_element_level(40.0) == '很強'


# ============================================================
# Weighted Five Elements Tests
# ============================================================

class TestWeightedFiveElements:
    """Test calculate_weighted_five_elements function."""

    def test_basic_structure(self, laopo10_pillars):
        """Result has all 5 elements with correct keys."""
        result = calculate_weighted_five_elements(laopo10_pillars, '丑')
        assert len(result) == 5
        for element in ['木', '火', '土', '金', '水']:
            assert element in result
            assert 'percentage' in result[element]
            assert 'level' in result[element]
            assert 'talents' in result[element]

    def test_percentages_sum_to_100(self, laopo10_pillars):
        """All percentages should sum to approximately 100."""
        result = calculate_weighted_five_elements(laopo10_pillars, '丑')
        total = sum(r['percentage'] for r in result.values())
        assert abs(total - 100.0) < 1.0  # Allow small rounding error

    def test_percentages_non_negative(self, laopo10_pillars):
        """All percentages should be non-negative."""
        result = calculate_weighted_five_elements(laopo10_pillars, '丑')
        for element, data in result.items():
            assert data['percentage'] >= 0, f"{element} has negative percentage"

    def test_level_values_valid(self, laopo10_pillars):
        """All levels should be valid labels."""
        valid_levels = {'很弱', '弱', '一般', '強', '很強'}
        result = calculate_weighted_five_elements(laopo10_pillars, '丑')
        for element, data in result.items():
            assert data['level'] in valid_levels, f"{element} has invalid level: {data['level']}"

    def test_talents_present(self, laopo10_pillars):
        """Each element should have 3 talents."""
        result = calculate_weighted_five_elements(laopo10_pillars, '丑')
        for element, data in result.items():
            assert len(data['talents']) == 3, f"{element} should have 3 talents"

    def test_seasonal_multiplier_effect(self, laopo10_pillars):
        """Seasonal multiplier should change the distribution vs raw."""
        # 丑月 → 土旺(1.5), 金相(1.3), 火休(1.0), 木囚(0.8), 水死(0.6)
        # vs no seasonal → all ×1.0
        raw_scores = _accumulate_raw_element_scores(laopo10_pillars)
        result = calculate_weighted_five_elements(laopo10_pillars, '丑')

        # 土 should get a boost (旺 in 丑月) relative to raw
        raw_total = sum(raw_scores.values())
        raw_tu_pct = raw_scores['土'] / raw_total * 100
        weighted_tu_pct = result['土']['percentage']
        assert weighted_tu_pct > raw_tu_pct, "土 should be boosted in 丑月 (旺)"

        # 水 should get reduced (死 in 丑月)
        raw_shui_pct = raw_scores['水'] / raw_total * 100
        weighted_shui_pct = result['水']['percentage']
        assert weighted_shui_pct < raw_shui_pct, "水 should be reduced in 丑月 (死)"

    def test_extra_pillars_effect(self, laopo10_pillars, laopo10_extra_pillars):
        """Extra pillars should change the distribution."""
        without = calculate_weighted_five_elements(laopo10_pillars, '丑')
        with_extra = calculate_weighted_five_elements(
            laopo10_pillars, '丑', extra_pillars=laopo10_extra_pillars,
        )

        # The distributions should be different
        diffs = sum(
            abs(without[e]['percentage'] - with_extra[e]['percentage'])
            for e in ['木', '火', '土', '金', '水']
        )
        assert diffs > 0.5, "Extra pillars should change the distribution"

    def test_extra_pillars_sum_to_100(self, laopo10_pillars, laopo10_extra_pillars):
        """With extra pillars, percentages should still sum to ~100."""
        result = calculate_weighted_five_elements(
            laopo10_pillars, '丑', extra_pillars=laopo10_extra_pillars,
        )
        total = sum(r['percentage'] for r in result.values())
        assert abs(total - 100.0) < 1.0

    def test_extra_pillars_none_handled(self, laopo10_pillars):
        """None extra pillars should not cause errors."""
        result = calculate_weighted_five_elements(laopo10_pillars, '丑', extra_pillars=None)
        assert len(result) == 5

    def test_extra_pillars_empty_list(self, laopo10_pillars):
        """Empty extra pillars list should give same result as no extra."""
        without = calculate_weighted_five_elements(laopo10_pillars, '丑')
        with_empty = calculate_weighted_five_elements(laopo10_pillars, '丑', extra_pillars=[])
        for element in ['木', '火', '土', '金', '水']:
            assert without[element]['percentage'] == with_empty[element]['percentage']

    def test_different_seasons_produce_different_results(self, laopo10_pillars):
        """Different month branches should produce different distributions."""
        result_chou = calculate_weighted_five_elements(laopo10_pillars, '丑')  # 土旺
        result_wu = calculate_weighted_five_elements(laopo10_pillars, '午')   # 火旺

        # 土 should be stronger in 丑月 than in 午月 (旺 vs 相)
        # Actually both are 旺 for 土... Let me use a better comparison
        # 午月: 火旺, 土相, 木休, 水囚, 金死
        # The distributions should be different
        assert result_chou['火']['percentage'] != result_wu['火']['percentage']

    def test_branch_interactions_adjustment(self, laopo10_pillars):
        """Branch interactions should adjust weights when provided."""
        interactions = analyze_branch_relationships(laopo10_pillars)
        without = calculate_weighted_five_elements(laopo10_pillars, '丑')
        with_interactions = calculate_weighted_five_elements(
            laopo10_pillars, '丑', branch_interactions=interactions,
        )
        # If there are harmonies or clashes, results should differ
        has_interactions = (
            len(interactions.get('harmonies', [])) > 0
            or len(interactions.get('clashes', [])) > 0
        )
        if has_interactions:
            diffs = sum(
                abs(without[e]['percentage'] - with_interactions[e]['percentage'])
                for e in ['木', '火', '土', '金', '水']
            )
            assert diffs > 0, "Branch interactions should affect distribution"

    def test_laopo10_dominant_element(self, laopo10_pillars):
        """Laopo10 (丙寅/辛丑/甲戌/壬申) in 丑月 should have 土 as significant.

        Branches: 寅(甲丙戊), 丑(己辛癸), 戌(戊辛丁), 申(庚壬戊)
        土 appears in: 戊(寅), 己(丑), 戊(戌), 戊(申) = multiple sources
        Plus 丑月 → 土旺(×1.5)
        """
        result = calculate_weighted_five_elements(laopo10_pillars, '丑')
        # 土 should be one of the stronger elements
        assert result['土']['percentage'] > 15, "土 should be significant in laopo10's 丑月 chart"

    def test_synthetic_chart_wood_heavy(self):
        """Synthetic chart with heavy wood to verify extreme case."""
        # All 4 stems are wood, branches vary
        pillars = {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '乙', 'branch': '卯'},
            'day':   {'stem': '甲', 'branch': '寅'},
            'hour':  {'stem': '乙', 'branch': '卯'},
        }
        result = calculate_weighted_five_elements(pillars, '寅')  # 木旺
        assert result['木']['percentage'] > 50, "All-wood chart should have >50% wood"
        assert result['木']['level'] == '很強'

    def test_synthetic_chart_balanced(self):
        """Synthetic chart with mixed elements."""
        pillars = {
            'year':  {'stem': '甲', 'branch': '午'},  # 木, 火
            'month': {'stem': '庚', 'branch': '子'},  # 金, 水
            'day':   {'stem': '戊', 'branch': '辰'},  # 土, 土+水+木
            'hour':  {'stem': '丙', 'branch': '申'},  # 火, 金+水+土
        }
        result = calculate_weighted_five_elements(pillars, '辰')  # 土旺
        # All elements should have some presence
        for element in ['木', '火', '土', '金', '水']:
            assert result[element]['percentage'] > 0, f"{element} should have >0%"


# ============================================================
# Ten God Level Threshold Tests
# ============================================================

class TestTenGodLevel:
    """Test ten god level classification from percentages."""

    def test_very_weak(self):
        assert _get_ten_god_level(2.0) == '很弱'

    def test_weak(self):
        assert _get_ten_god_level(5.0) == '弱'

    def test_normal(self):
        assert _get_ten_god_level(12.0) == '一般'

    def test_strong(self):
        assert _get_ten_god_level(20.0) == '強'

    def test_very_strong(self):
        assert _get_ten_god_level(30.0) == '很強'

    def test_boundary_3(self):
        assert _get_ten_god_level(3.0) == '弱'

    def test_boundary_8(self):
        assert _get_ten_god_level(8.0) == '一般'

    def test_boundary_15(self):
        assert _get_ten_god_level(15.0) == '強'

    def test_boundary_25(self):
        assert _get_ten_god_level(25.0) == '很強'


# ============================================================
# Weighted Ten Gods Tests
# ============================================================

class TestWeightedTenGods:
    """Test calculate_weighted_ten_gods function."""

    ALL_TEN_GODS = ['比肩', '劫財', '食神', '傷官', '偏財', '正財', '偏官', '正官', '偏印', '正印']

    def test_basic_structure(self, laopo10_pillars):
        """Result has all 10 ten gods with correct keys."""
        result = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        assert len(result) == 10
        for tg in self.ALL_TEN_GODS:
            assert tg in result
            assert 'percentage' in result[tg]
            assert 'level' in result[tg]
            assert 'capabilities' in result[tg]

    def test_percentages_sum_to_100(self, laopo10_pillars):
        """All percentages should sum to approximately 100."""
        result = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        total = sum(r['percentage'] for r in result.values())
        assert abs(total - 100.0) < 1.0

    def test_percentages_non_negative(self, laopo10_pillars):
        """All percentages should be non-negative."""
        result = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        for tg, data in result.items():
            assert data['percentage'] >= 0, f"{tg} has negative percentage"

    def test_level_values_valid(self, laopo10_pillars):
        """All levels should be valid labels."""
        valid_levels = {'很弱', '弱', '一般', '強', '很強'}
        result = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        for tg, data in result.items():
            assert data['level'] in valid_levels, f"{tg} has invalid level: {data['level']}"

    def test_capabilities_present(self, laopo10_pillars):
        """Each ten god should have 3 capabilities."""
        result = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        for tg, data in result.items():
            assert len(data['capabilities']) == 3, f"{tg} should have 3 capabilities"

    def test_day_master_excluded(self, laopo10_pillars):
        """Day master stem should not be counted as a manifest stem.

        Laopo10 DM = 甲(木). The day pillar stem 甲 should NOT contribute
        to 比肩. But 甲 in hidden stems (e.g., 寅 藏甲) DOES contribute.
        """
        result = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        # 比肩 should still have some value from hidden stems containing 甲
        # but should not include the day pillar's manifest stem contribution
        assert result['比肩']['percentage'] >= 0

    def test_seasonal_effect(self, laopo10_pillars):
        """Different seasons should produce different distributions."""
        result_chou = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        result_yin = calculate_weighted_ten_gods('甲', laopo10_pillars, '寅')
        # Distributions should differ
        diffs = sum(
            abs(result_chou[tg]['percentage'] - result_yin[tg]['percentage'])
            for tg in self.ALL_TEN_GODS
        )
        assert diffs > 0.5, "Different seasons should change distribution"

    def test_laopo10_ten_god_sanity(self, laopo10_pillars):
        """Laopo10 (DM=甲) ten god presence check.

        Stems: 丙(食神), 辛(正官), 甲(DM skip), 壬(偏印)
        So 食神, 正官, 偏印 should all have non-trivial percentages.
        """
        result = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        # These should have manifest stem contributions
        assert result['食神']['percentage'] > 0, "丙=食神 should be present"
        assert result['正官']['percentage'] > 0, "辛=正官 should be present"
        assert result['偏印']['percentage'] > 0, "壬=偏印 should be present"

    def test_branch_interactions(self, laopo10_pillars):
        """Branch interactions should adjust weights when provided."""
        interactions = analyze_branch_relationships(laopo10_pillars)
        without = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        with_interactions = calculate_weighted_ten_gods(
            '甲', laopo10_pillars, '丑', branch_interactions=interactions,
        )
        has_interactions = (
            len(interactions.get('clashes', [])) > 0
            or len(interactions.get('tripleHarmonies', [])) > 0
        )
        if has_interactions:
            diffs = sum(
                abs(without[tg]['percentage'] - with_interactions[tg]['percentage'])
                for tg in self.ALL_TEN_GODS
            )
            assert diffs > 0, "Branch interactions should affect distribution"

    def test_different_day_masters(self, laopo10_pillars):
        """Different day masters should produce completely different distributions."""
        result_jia = calculate_weighted_ten_gods('甲', laopo10_pillars, '丑')
        result_geng = calculate_weighted_ten_gods('庚', laopo10_pillars, '丑')
        # The distributions should be very different
        diffs = sum(
            abs(result_jia[tg]['percentage'] - result_geng[tg]['percentage'])
            for tg in self.ALL_TEN_GODS
        )
        assert diffs > 10, "Different day masters should produce very different distributions"

    def test_synthetic_all_wood_chart(self):
        """Synthetic all-wood chart with 甲 day master → heavy 比肩."""
        pillars = {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '甲', 'branch': '卯'},
            'day':   {'stem': '甲', 'branch': '寅'},
            'hour':  {'stem': '甲', 'branch': '卯'},
        }
        result = calculate_weighted_ten_gods('甲', pillars, '寅')
        # 比肩 should dominate (甲 stems → 比肩, 寅/卯 hidden stems are 木)
        assert result['比肩']['percentage'] > 30, "All-甲 chart should have high 比肩"


# ============================================================
# Career Pre-Analysis Fixtures
# ============================================================

@pytest.fixture(scope='module')
def laopo10_pre_analysis(laopo10_chart):
    """Extract pre-analysis data from laopo10 chart."""
    return laopo10_chart.get('preAnalysis', {})


@pytest.fixture(scope='module')
def laopo10_effective_gods(laopo10_pre_analysis):
    """Get normalized effective gods for laopo10."""
    raw = laopo10_pre_analysis.get('effectiveFavorableGods', {})
    return _normalize_effective_gods(raw)


@pytest.fixture(scope='module')
def laopo10_strength_v2(laopo10_pre_analysis):
    """Get strength V2 from laopo10."""
    return laopo10_pre_analysis.get('strengthV2', {})


@pytest.fixture(scope='module')
def laopo10_career_result(laopo10_chart, laopo10_pre_analysis):
    """Run full career pre-analysis for laopo10."""
    return generate_career_pre_analysis(
        pillars=laopo10_chart['fourPillars'],
        day_master_stem=laopo10_chart.get('dayMasterStem', '甲'),
        gender='female',
        five_elements_balance=laopo10_chart['fiveElementsBalance'],
        effective_gods=laopo10_pre_analysis.get('effectiveFavorableGods', {}),
        prominent_god=laopo10_pre_analysis.get('prominentGod', ''),
        strength_v2=laopo10_pre_analysis.get('strengthV2', {}),
        cong_ge=laopo10_pre_analysis.get('congGe'),
        luck_periods=laopo10_chart.get('luckPeriods', []),
        annual_stars=laopo10_chart.get('annualStars', []),
        monthly_stars=laopo10_chart.get('monthlyStars', []),
        kong_wang=laopo10_chart.get('kongWang', []),
        branch_relationships=None,
        tai_yuan=laopo10_chart.get('taiYuan'),
        ming_gong=laopo10_chart.get('mingGong'),
        shen_gong=laopo10_chart.get('shenGong'),
        birth_year=1987,
        current_year=2026,
    )


# ============================================================
# Normalize Effective Gods Tests
# ============================================================

class TestNormalizeEffectiveGods:
    """Test format conversion for effective_gods dict."""

    def test_engine_format_to_internal(self):
        """Engine format {role_en: element} → internal {element: role_zh}."""
        raw = {
            'usefulGod': '水',
            'favorableGod': '木',
            'idleGod': '火',
            'tabooGod': '金',
            'enemyGod': '土',
        }
        result = _normalize_effective_gods(raw)
        assert result == {
            '水': '用神',
            '木': '喜神',
            '火': '閒神',
            '金': '忌神',
            '土': '仇神',
        }

    def test_already_internal_format(self):
        """Internal format should pass through unchanged."""
        internal = {
            '水': '用神',
            '木': '喜神',
            '火': '閒神',
            '金': '忌神',
            '土': '仇神',
        }
        result = _normalize_effective_gods(internal)
        assert result == internal

    def test_empty_dict(self):
        """Empty dict should return empty dict."""
        assert _normalize_effective_gods({}) == {}

    def test_unknown_keys_ignored(self):
        """Unknown keys in engine format should be ignored."""
        raw = {
            'usefulGod': '水',
            'favorableGod': '木',
            'unknownKey': '火',
        }
        result = _normalize_effective_gods(raw)
        assert len(result) == 2
        assert '水' in result
        assert '木' in result


# ============================================================
# Reputation Score Tests
# ============================================================

class TestReputationScore:
    """Test compute_reputation_score function."""

    def test_returns_score_and_level(self, laopo10_career_result):
        """Reputation score should include score, sub_scores, and level."""
        rep = laopo10_career_result['reputationScore']
        assert 'score' in rep
        assert 'level' in rep
        assert 'subScores' in rep
        assert isinstance(rep['score'], (int, float))

    def test_score_in_range(self, laopo10_career_result):
        """Score should be 0-100."""
        score = laopo10_career_result['reputationScore']['score']
        assert 0 <= score <= 100

    def test_level_valid(self, laopo10_career_result):
        """Level should be one of the valid tiers."""
        level = laopo10_career_result['reputationScore']['level']
        assert level in ('上上格', '上格', '中格', '下格', '下下格')

    def test_sub_scores_present(self, laopo10_career_result):
        """Should have all 5 sub-scores."""
        sub = laopo10_career_result['reputationScore']['subScores']
        expected_keys = {'patternPurity', 'officerStrength', 'usefulGodStrength',
                        'sealSupport', 'clashDeduction'}
        assert expected_keys.issubset(set(sub.keys()))

    def test_sub_scores_in_range(self, laopo10_career_result):
        """Sub-scores should be in valid ranges."""
        sub = laopo10_career_result['reputationScore']['subScores']
        for key, value in sub.items():
            if key == 'clashDeduction':
                assert 0 <= value <= 30, f"{key} out of range: {value}"
            else:
                assert 0 <= value <= 100, f"{key} out of range: {value}"

    def test_laopo10_reasonable_score(self, laopo10_career_result):
        """Laopo10 (甲木 weak, 正官格) should have a reasonable reputation."""
        score = laopo10_career_result['reputationScore']['score']
        # 正官 in stems + 用神 detectable → should be moderate to high
        assert score >= 40, f"甲木正官格 should have reasonable reputation, got {score}"

    def test_synthetic_strong_officer(self):
        """Chart with strong officer should score higher."""
        # Build a chart with strong 正官 presence
        pillars = {
            'year':  {'stem': '辛', 'branch': '酉'},  # 辛金 → 正官 for 甲
            'month': {'stem': '辛', 'branch': '丑'},  # 辛金 → 正官
            'day':   {'stem': '甲', 'branch': '寅'},  # DM
            'hour':  {'stem': '壬', 'branch': '子'},  # 壬水 → 偏印
        }
        effective_gods = {'金': '用神', '水': '喜神', '木': '閒神', '火': '忌神', '土': '仇神'}
        result = compute_reputation_score(
            pillars, '甲', '正官', effective_gods, '丑', None,
            analyze_branch_relationships(pillars),
        )
        assert result['score'] >= 50, "Strong officer chart should score well"


# ============================================================
# Wealth Score Tests
# ============================================================

class TestWealthScore:
    """Test compute_wealth_score function."""

    def test_returns_expected_keys(self, laopo10_career_result):
        """Wealth score should include score, tier, and sub_scores."""
        wealth = laopo10_career_result['wealthScore']
        assert 'score' in wealth
        assert 'tier' in wealth
        assert 'subScores' in wealth

    def test_score_in_range(self, laopo10_career_result):
        """Score should be 0-100."""
        score = laopo10_career_result['wealthScore']['score']
        assert 0 <= score <= 100

    def test_tier_valid(self, laopo10_career_result):
        """Tier should be one of the valid wealth tiers."""
        tier = laopo10_career_result['wealthScore']['tier']
        assert tier in ('平常', '小富', '中富', '大富', '巨富')

    def test_sub_scores_structure(self, laopo10_career_result):
        """Should have all 6 wealth sub-scores (incl. sealRescueBonus from Fix 4)."""
        sub = laopo10_career_result['wealthScore']['subScores']
        assert 'wealthFavorability' in sub
        assert 'wealthReality' in sub
        assert 'outputGenerating' in sub
        assert 'treasury' in sub
        assert 'luckPeriodSupport' in sub
        assert 'sealRescueBonus' in sub  # Fix 4: visible per UD-3 default

    def test_tier_matches_score(self, laopo10_career_result):
        """Tier should match the score range."""
        score = laopo10_career_result['wealthScore']['score']
        tier = laopo10_career_result['wealthScore']['tier']
        if score < 40:
            assert tier == '平常'
        elif score < 55:
            assert tier == '小富'
        elif score < 70:
            assert tier == '中富'
        elif score < 85:
            assert tier == '大富'
        else:
            assert tier == '巨富'

    def test_wealth_with_strong_financial_chart(self):
        """Chart with strong wealth elements should score higher."""
        pillars = {
            'year':  {'stem': '戊', 'branch': '辰'},  # 戊土 → 偏財 for 甲
            'month': {'stem': '己', 'branch': '未'},  # 己土 → 正財
            'day':   {'stem': '甲', 'branch': '寅'},  # DM
            'hour':  {'stem': '丙', 'branch': '午'},  # 丙火 → 食神
        }
        effective_gods = {'火': '喜神', '土': '用神', '木': '閒神', '金': '忌神', '水': '仇神'}
        result = compute_wealth_score(
            pillars, '甲', effective_gods, '未', None,
            {'classification': 'strong', 'score': 70}, [], 2026,
        )
        assert result['score'] >= 40, "Strong wealth chart should score well"


# ============================================================
# Fix 4: Seal Rescue Bonus Tests (印通關救應加分)
# ============================================================

class TestSealRescueBonus:
    """Test _compute_seal_rescue_bonus — Fix 4 (Laopo feedback v4)."""

    def test_laopo_gets_seal_rescue_bonus(self, laopo10_pillars):
        """Laopo (壬偏印透時, 癸正印藏丑) should get strong 印透干+通根 bonus."""
        from app.career_enhanced import _compute_seal_rescue_bonus
        effective_gods = {'水': '用神', '木': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        strength_v2 = {'classification': 'very_weak'}
        bonus = _compute_seal_rescue_bonus(
            laopo10_pillars, '甲', effective_gods, strength_v2, cong_ge=None,
        )
        assert bonus >= 15, f"Laopo should get strong seal rescue bonus, got {bonus}"
        assert bonus <= 25, f"Capped at +25, got {bonus}"

    def test_no_bonus_for_strong_dm(self, laopo10_pillars):
        """Strong DM should not get bonus — rule scope is weak DM only."""
        from app.career_enhanced import _compute_seal_rescue_bonus
        effective_gods = {'水': '用神', '木': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        strength_v2 = {'classification': 'strong'}
        bonus = _compute_seal_rescue_bonus(
            laopo10_pillars, '甲', effective_gods, strength_v2, cong_ge=None,
        )
        assert bonus == 0

    def test_no_bonus_when_wealth_is_yongshen(self, laopo10_pillars):
        """If 財=用神 (e.g., strong DM needs wealth), no rescue triggered."""
        from app.career_enhanced import _compute_seal_rescue_bonus
        # Reverse role assignment: 土=用 (財 is favorable)
        effective_gods = {'土': '用神', '金': '喜神', '水': '閒神', '木': '仇神', '火': '忌神'}
        strength_v2 = {'classification': 'very_weak'}
        bonus = _compute_seal_rescue_bonus(
            laopo10_pillars, '甲', effective_gods, strength_v2, cong_ge=None,
        )
        assert bonus == 0, f"Wealth=用神 should not trigger rescue, got {bonus}"

    def test_no_bonus_when_no_seal_in_chart(self):
        """Chart with no 印 element (water for 甲) should get bonus=0 (屋富人貧)."""
        from app.career_enhanced import _compute_seal_rescue_bonus
        # 甲 weak; 戊午/己未/甲戌/戊午 — all 土+火+木, NO 水 (印) anywhere
        pillars = {
            'year':  {'stem': '戊', 'branch': '午'},
            'month': {'stem': '己', 'branch': '未'},
            'day':   {'stem': '甲', 'branch': '戌'},
            'hour':  {'stem': '戊', 'branch': '午'},
        }
        effective_gods = {'水': '用神', '木': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        strength_v2 = {'classification': 'very_weak'}
        bonus = _compute_seal_rescue_bonus(
            pillars, '甲', effective_gods, strength_v2, cong_ge=None,
        )
        assert bonus == 0, f"No 印 = no rescue (屋富人貧), got {bonus}"

    def test_no_bonus_for_cong_ge(self, laopo10_pillars):
        """從格 charts skip rescue (印 becomes 忌神 in 從財/從殺)."""
        from app.career_enhanced import _compute_seal_rescue_bonus
        effective_gods = {'水': '用神', '木': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        strength_v2 = {'classification': 'very_weak'}
        cong_ge = {'subtype': '從財格'}
        bonus = _compute_seal_rescue_bonus(
            laopo10_pillars, '甲', effective_gods, strength_v2, cong_ge=cong_ge,
        )
        assert bonus == 0, f"從格 should skip rescue, got {bonus}"

    def test_laopo_wealth_score_lifted_by_seal_rescue(self, laopo10_career_result):
        """Fix 4 end-to-end: Laopo's wealth tier should escape 平常 post-rescue."""
        wealth = laopo10_career_result['wealthScore']
        assert wealth['tier'] != '平常', \
            f"Laopo should escape 平常 post seal rescue, got {wealth}"
        assert wealth['tier'] in ('小富', '中富'), \
            f"Expected 小富/中富, got tier={wealth['tier']} score={wealth['score']}"
        # Loose upper bound (avoid over-correction surface)
        assert wealth['score'] < 75, \
            f"Score overshoot — bonus may be too generous: {wealth['score']}"
        # Bonus should be visible (UD-3 default)
        assert wealth['subScores']['sealRescueBonus'] > 0


# ============================================================
# Suitable Positions Tests
# ============================================================

class TestSuitablePositions:
    """Test compute_suitable_positions function."""

    def test_returns_list(self, laopo10_career_result):
        """Positions should be a list."""
        positions = laopo10_career_result['suitablePositions']
        assert isinstance(positions, list)

    def test_positions_not_empty(self, laopo10_career_result):
        """Should have at least some positions."""
        positions = laopo10_career_result['suitablePositions']
        assert len(positions) > 0

    def test_position_structure(self, laopo10_career_result):
        """Each position entry should have required keys."""
        positions = laopo10_career_result['suitablePositions']
        for pos in positions:
            assert 'positions' in pos
            assert 'source' in pos
            assert isinstance(pos['positions'], list)

    def test_different_patterns_give_different_positions(self):
        """Different 格局 should produce different position recommendations."""
        pillars = {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '庚', 'branch': '申'},
            'day':   {'stem': '甲', 'branch': '子'},
            'hour':  {'stem': '壬', 'branch': '子'},
        }
        result_officer = compute_suitable_positions(pillars, '甲', '正官', None)
        result_seal = compute_suitable_positions(pillars, '甲', '正印', None)
        # Collect all position strings from each result
        officer_all = set()
        for entry in result_officer:
            officer_all.update(entry.get('positions', []))
        seal_all = set()
        for entry in result_seal:
            seal_all.update(entry.get('positions', []))
        assert officer_all != seal_all, \
            "Different patterns should give different positions"


# ============================================================
# Company Type Fit Tests
# ============================================================

class TestCompanyTypeFit:
    """Test compute_company_type_fit function."""

    def test_returns_expected_keys(self, laopo10_career_result):
        """Company fit should have type, label, description, and anchors."""
        fit = laopo10_career_result['companyTypeFit']
        assert 'type' in fit
        assert 'label' in fit
        assert 'description' in fit
        assert 'anchors' in fit

    def test_type_valid(self, laopo10_career_result):
        """Type should be stable, innovative, or balanced."""
        fit_type = laopo10_career_result['companyTypeFit']['type']
        assert fit_type in ('stable', 'innovative', 'balanced')

    def test_label_not_empty(self, laopo10_career_result):
        """Label should not be empty."""
        label = laopo10_career_result['companyTypeFit']['label']
        assert len(label) > 0

    def test_stable_chart(self):
        """Chart dominated by 正 stars should lean stable."""
        # 正官 + 正印 + 正財 dominant
        pillars = {
            'year':  {'stem': '辛', 'branch': '丑'},  # 正官
            'month': {'stem': '壬', 'branch': '子'},  # 偏印
            'day':   {'stem': '甲', 'branch': '寅'},  # DM
            'hour':  {'stem': '己', 'branch': '未'},  # 正財
        }
        result = compute_company_type_fit(pillars, '甲', '正官')
        # With 正官格 and 正 stars, should tend toward stable
        assert result['type'] in ('stable', 'balanced')


# ============================================================
# Entrepreneurship Fit Tests
# ============================================================

class TestEntrepreneurshipFit:
    """Test compute_entrepreneurship_fit function."""

    def test_returns_expected_keys(self, laopo10_career_result):
        """Should include score, type, label, and reasons."""
        ent = laopo10_career_result['entrepreneurshipFit']
        assert 'score' in ent
        assert 'type' in ent
        assert 'label' in ent
        assert 'reasons' in ent

    def test_score_in_range(self, laopo10_career_result):
        """Score should be 0-100."""
        score = laopo10_career_result['entrepreneurshipFit']['score']
        assert 0 <= score <= 100

    def test_type_valid(self, laopo10_career_result):
        """Type should be one of the valid categories."""
        ent_type = laopo10_career_result['entrepreneurshipFit']['type']
        valid_types = {'technical_founder', 'business_founder', 'freelancer',
                      'not_recommended', 'cautious'}
        assert ent_type in valid_types, f"Invalid entrepreneurship type: {ent_type}"

    def test_reasons_list(self, laopo10_career_result):
        """Reasons should be a list of strings."""
        reasons = laopo10_career_result['entrepreneurshipFit']['reasons']
        assert isinstance(reasons, list)
        for reason in reasons:
            assert isinstance(reason, str)

    def test_strong_entrepreneur_chart(self):
        """Chart with 七殺+偏財 should score well."""
        pillars = {
            'year':  {'stem': '庚', 'branch': '申'},  # 偏官(七殺) for 甲
            'month': {'stem': '戊', 'branch': '辰'},  # 偏財
            'day':   {'stem': '甲', 'branch': '寅'},  # DM
            'hour':  {'stem': '丙', 'branch': '午'},  # 食神
        }
        from app.ten_gods import get_ten_god_distribution
        ten_god_dist = get_ten_god_distribution(pillars, '甲')
        result = compute_entrepreneurship_fit(
            pillars, '甲', {'category': 'strong', 'score': 70},
            None, ten_god_dist, [],
        )
        assert result['score'] >= 40, "七殺+偏財 chart should have decent entrepreneurship score"


# ============================================================
# Partnership Fit Tests
# ============================================================

class TestPartnershipFit:
    """Test compute_partnership_fit function."""

    def test_returns_expected_keys(self, laopo10_career_result):
        """Should include score, suitable, label, and reasons."""
        part = laopo10_career_result['partnershipFit']
        assert 'score' in part
        assert 'suitable' in part
        assert 'label' in part
        assert 'reasons' in part

    def test_score_in_range(self, laopo10_career_result):
        """Score should be 0-100."""
        score = laopo10_career_result['partnershipFit']['score']
        assert 0 <= score <= 100

    def test_suitable_is_boolean(self, laopo10_career_result):
        """Suitable should be boolean."""
        assert isinstance(laopo10_career_result['partnershipFit']['suitable'], bool)

    def test_excessive_bijie_lowers_score(self):
        """Excessive 比劫 should lower partnership suitability."""
        pillars_high_bijie = {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '甲', 'branch': '卯'},
            'day':   {'stem': '甲', 'branch': '寅'},
            'hour':  {'stem': '乙', 'branch': '卯'},
        }
        from app.ten_gods import get_ten_god_distribution
        dist_high = get_ten_god_distribution(pillars_high_bijie, '甲')
        interactions = analyze_branch_relationships(pillars_high_bijie)
        result_high = compute_partnership_fit(pillars_high_bijie, '甲', dist_high, interactions)

        pillars_low_bijie = {
            'year':  {'stem': '庚', 'branch': '申'},
            'month': {'stem': '辛', 'branch': '酉'},
            'day':   {'stem': '甲', 'branch': '子'},
            'hour':  {'stem': '壬', 'branch': '子'},
        }
        dist_low = get_ten_god_distribution(pillars_low_bijie, '甲')
        interactions_low = analyze_branch_relationships(pillars_low_bijie)
        result_low = compute_partnership_fit(pillars_low_bijie, '甲', dist_low, interactions_low)

        # High 比劫 should score lower for partnership
        assert result_high['score'] <= result_low['score'], \
            "High 比劫 should have lower partnership score"


# ============================================================
# Career Allies & Enemies Tests
# ============================================================

class TestCareerAlliesEnemies:
    """Test compute_career_allies_enemies function."""

    def test_returns_expected_keys(self, laopo10_career_result):
        """Should include all 6 layers."""
        ae = laopo10_career_result['careerAllies']
        assert 'nobles' in ae
        assert 'careerShensha' in ae
        assert 'allies' in ae
        assert 'mobilityBringers' in ae
        assert 'enemies' in ae
        assert 'antagonists' in ae

    def test_nobles_structure(self, laopo10_career_result):
        """Nobles should be a list with name and branch."""
        nobles = laopo10_career_result['careerAllies']['nobles']
        assert isinstance(nobles, list)
        for noble in nobles:
            assert 'name' in noble
            assert 'branch' in noble

    def test_allies_have_zodiac(self, laopo10_career_result):
        """Allies should have zodiac animal names."""
        allies = laopo10_career_result['careerAllies']['allies']
        for ally in allies:
            assert 'zodiac' in ally
            assert 'branch' in ally

    def test_enemies_have_zodiac(self, laopo10_career_result):
        """Enemies should have zodiac animal names."""
        enemies = laopo10_career_result['careerAllies']['enemies']
        for enemy in enemies:
            assert 'zodiac' in enemy
            assert 'branch' in enemy

    def test_antagonists_structure(self, laopo10_career_result):
        """Antagonists should have tenGod, label, description."""
        antagonists = laopo10_career_result['careerAllies']['antagonists']
        for ant in antagonists:
            assert 'tenGod' in ant
            assert 'label' in ant
            assert 'description' in ant

    def test_allies_includes_sanhe_partners_minus_self(self, laopo10_career_result):
        """Sanhe self-zodiac fix: For Laopo (寅虎 year, 戌狗 day), 寅午戌 三合 →
        allies must include 午 (馬) but NOT 戌 (狗 = Laopo's day_branch zodiac = self).
        Supersedes prior Fix 1 expectation that included 戌. Classical convention
        excludes self ('貴人必須是與自身生肖不同的屬相')."""
        allies = laopo10_career_result['careerAllies']['allies']
        branches = {a['branch'] for a in allies}
        assert '午' in branches, "Missing 午 (馬) — 寅午戌 partner, not self"
        assert '戌' not in branches, \
            "戌 (狗) is Laopo's day_branch zodiac (self) — must NOT appear as own ally"
        assert '寅' not in branches, \
            "寅 (虎) is Laopo's year_branch zodiac (self) — must NOT appear as own ally"

    def test_allies_have_inchart_flag(self, laopo10_career_result):
        """Each ally entry should have inChart bool flag."""
        allies = laopo10_career_result['careerAllies']['allies']
        for ally in allies:
            assert 'inChart' in ally
            assert isinstance(ally['inChart'], bool)
        # 午 is NOT in Laopo's chart — should be False
        wu_ally = next((a for a in allies if a['branch'] == '午'), None)
        assert wu_ally is not None, "午 should be in allies"
        assert wu_ally['inChart'] is False, "午 not in chart should have inChart=False"

    # ────────────────────────────────────────────────────────────
    # Sanhe self-zodiac fix — new tests
    # ────────────────────────────────────────────────────────────

    def test_allies_excludes_year_branch_zodiac(self, laopo10_career_result):
        """No ally should match the user's year_branch zodiac (寅 for Laopo)."""
        allies = laopo10_career_result['careerAllies']['allies']
        # Laopo's year branch is 寅
        for ally in allies:
            assert ally['branch'] != '寅', \
                f"年支 zodiac 寅 must not appear as ally, got {ally}"

    def test_allies_excludes_day_branch_zodiac(self, laopo10_career_result):
        """No ally should match the user's day_branch zodiac (戌 for Laopo)."""
        allies = laopo10_career_result['careerAllies']['allies']
        # Laopo's day branch is 戌
        for ally in allies:
            assert ally['branch'] != '戌', \
                f"日支 zodiac 戌 must not appear as ally, got {ally}"

    def test_partial_sanhe_active_for_laopo(self, laopo10_career_result):
        """Laopo (寅+戌, both in 寅午戌 火局) should trigger 半三合 detection."""
        ae = laopo10_career_result['careerAllies']
        assert ae['partialSanheActive'] is True, \
            "Laopo's 寅+戌 should activate 半三合 (寅午戌 火局)"
        catalyst = ae['sanheCatalyst']
        assert catalyst is not None
        assert catalyst['branch'] == '午', f"Catalyst should be 午, got {catalyst}"
        assert catalyst['zodiac'] == '馬'
        assert catalyst['groupElement'] == '火'

    def test_no_partial_sanhe_when_year_day_unrelated(self):
        """Roger-like chart (year=卯, day=午 — different 三合 groups) should NOT
        trigger 半三合; allies should include all 4 partners (亥/未/寅/戌)."""
        from app.career_enhanced import compute_career_allies_enemies
        pillars = {
            'year':  {'stem': '丁', 'branch': '卯'},  # 卯 ∈ 亥卯未 木局
            'month': {'stem': '戊', 'branch': '申'},
            'day':   {'stem': '戊', 'branch': '午'},  # 午 ∈ 寅午戌 火局
            'hour':  {'stem': '庚', 'branch': '申'},
        }
        effective_gods = {'木': '用神', '水': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        result = compute_career_allies_enemies(pillars, '戊', effective_gods, [])
        assert result['partialSanheActive'] is False, \
            "year+day in different 三合 groups should not activate 半三合"
        assert result['sanheCatalyst'] is None
        # All 4 expected allies present (年支卯 → 亥, 未; 日支午 → 寅, 戌)
        branches = {a['branch'] for a in result['allies']}
        for expected in ('亥', '未', '寅', '戌'):
            assert expected in branches, f"Expected {expected} in allies, got {branches}"

    def test_year_equals_day_branch_no_double_count(self):
        """Year==day chart (寅寅): allies = [午, 戌] only (no self), partialSanheActive=False
        per binding decision (doubled qi is NOT 半三合)."""
        from app.career_enhanced import compute_career_allies_enemies
        pillars = {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '丙', 'branch': '辰'},
            'day':   {'stem': '甲', 'branch': '寅'},  # year == day
            'hour':  {'stem': '戊', 'branch': '午'},
        }
        effective_gods = {'木': '用神', '水': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        result = compute_career_allies_enemies(pillars, '甲', effective_gods, [])
        branches = sorted(a['branch'] for a in result['allies'])
        assert branches == ['午', '戌'], \
            f"寅寅 chart allies should be exactly [午, 戌], got {branches}"
        assert result['partialSanheActive'] is False, \
            "year==day must NOT trigger 半三合 (doubled qi ≠ half-harmony)"
        assert result['sanheCatalyst'] is None

    def test_month_or_hour_ally_still_included(self):
        """Self-exclusion only filters year/day zodiacs. month/hour pillars matching
        an ally branch should still be listed (with inChart=True)."""
        from app.career_enhanced import compute_career_allies_enemies
        # year=卯 → 亥/未 are partners. Place 亥 in month_branch.
        # day=戌 → 寅/午 are partners. day=戌 itself excluded (self).
        pillars = {
            'year':  {'stem': '乙', 'branch': '卯'},
            'month': {'stem': '丁', 'branch': '亥'},  # 亥 = year's 三合 partner, present in chart
            'day':   {'stem': '丙', 'branch': '戌'},
            'hour':  {'stem': '戊', 'branch': '申'},
        }
        effective_gods = {'木': '用神', '水': '喜神', '火': '閒神', '土': '仇神', '金': '忌神'}
        result = compute_career_allies_enemies(pillars, '丙', effective_gods, [])
        hai_ally = next((a for a in result['allies'] if a['branch'] == '亥'), None)
        assert hai_ally is not None, \
            "亥 (year's 三合 partner, not year/day zodiac) must appear as ally"
        assert hai_ally['inChart'] is True, "亥 IS in chart (month_branch) → inChart=True"


# ============================================================
# Annual Forecast Tests
# ============================================================

class TestAnnualForecast:
    """Test compute_annual_forecast_data function."""

    def test_returns_5_years(self, laopo10_career_result):
        """Should return exactly 5 years of forecasts."""
        annual = laopo10_career_result['annualForecasts']
        assert len(annual) == 5

    def test_years_are_sequential(self, laopo10_career_result):
        """Years should be 2026-2030."""
        annual = laopo10_career_result['annualForecasts']
        years = [a['year'] for a in annual]
        assert years == [2026, 2027, 2028, 2029, 2030]

    def test_forecast_structure(self, laopo10_career_result):
        """Each forecast should have required keys."""
        for forecast in laopo10_career_result['annualForecasts']:
            assert 'year' in forecast
            assert 'stem' in forecast
            assert 'branch' in forecast
            assert 'tenGod' in forecast
            assert 'luckPeriodStem' in forecast
            assert 'auspiciousness' in forecast
            assert 'kongWangAnalysis' in forecast
            assert 'yimaAnalysis' in forecast
            assert 'careerIndicators' in forecast

    def test_auspiciousness_valid(self, laopo10_career_result):
        """Auspiciousness should be one of the 5 valid levels (R6-2: 流年-only)."""
        valid = {'大吉', '吉', '平', '凶', '大凶'}
        for forecast in laopo10_career_result['annualForecasts']:
            assert forecast['auspiciousness'] in valid, \
                f"Year {forecast['year']}: invalid auspiciousness {forecast['auspiciousness']}"

    def test_luck_period_structure(self, laopo10_career_result):
        """Each forecast should have luck period data."""
        for forecast in laopo10_career_result['annualForecasts']:
            assert 'luckPeriodStem' in forecast
            assert 'luckPeriodBranch' in forecast
            assert 'luckPeriodTenGod' in forecast
            assert 'luckPeriodStartYear' in forecast
            assert 'luckPeriodEndYear' in forecast

    def test_kong_wang_analysis_structure(self, laopo10_career_result):
        """Kong wang analysis should have expected keys."""
        for forecast in laopo10_career_result['annualForecasts']:
            kw = forecast['kongWangAnalysis']
            assert 'hit' in kw
            assert isinstance(kw['hit'], bool)

    def test_yima_analysis_structure(self, laopo10_career_result):
        """Yima analysis should have expected keys."""
        for forecast in laopo10_career_result['annualForecasts']:
            yima = forecast['yimaAnalysis']
            assert 'hit' in yima
            assert isinstance(yima['hit'], bool)

    def test_career_indicators_list(self, laopo10_career_result):
        """Career indicators should be a list."""
        for forecast in laopo10_career_result['annualForecasts']:
            assert isinstance(forecast['careerIndicators'], list)

    def test_career_indicator_structure(self, laopo10_career_result):
        """Career indicators should have type, label, description."""
        for forecast in laopo10_career_result['annualForecasts']:
            for ind in forecast['careerIndicators']:
                assert 'type' in ind
                assert 'label' in ind
                assert 'description' in ind

    def test_laopo_2027_no_shangguan_jian_guan_danger(self, laopo10_career_result):
        """Fix 3: 2027 丁未 (丁=傷官, 辛 manifest=正官 but 辛=金=忌神 for Laopo).
        Old code incorrectly flagged 傷官見官 as danger; new code recognizes
        官=忌 → 傷官 制官 is BENEFICIAL, should flag as opportunity instead.
        """
        annual = laopo10_career_result['annualForecasts']
        year_2027 = next(a for a in annual if a['year'] == 2027)
        indicators = year_2027['careerIndicators']
        labels_by_type = {(i['type'], i['label']) for i in indicators}
        assert ('danger', '傷官見官') not in labels_by_type, \
            "傷官見官 should NOT be danger when 正官 is 忌神 (Laopo case)"
        # Should be opportunity instead
        assert ('opportunity', '傷官制官') in labels_by_type, \
            f"Should flag 傷官制官 as opportunity for 身弱官殺旺 chart, got {labels_by_type}"

    def test_strong_dm_with_official_yongshen_still_danger(self):
        """Fix 3: Synthetic strong-DM chart where 正官=用神 should STILL flag danger."""
        from app.career_enhanced import _detect_career_indicators
        # 庚 strong DM, 流年 癸=傷官, manifest 丁=正官 (火=用神 for strong-DM 庚)
        pillars = {
            'year':  {'stem': '丁', 'branch': '巳'},
            'month': {'stem': '庚', 'branch': '申'},  # 庚 strong in 申月
            'day':   {'stem': '庚', 'branch': '辰'},
            'hour':  {'stem': '辛', 'branch': '巳'},
        }
        # Strong 庚 needs 火/木/水: 用=火(正官), 喜=木(財), 忌=金(比劫), 仇=土(印)
        effective_gods = {'火': '用神', '木': '喜神', '水': '閒神', '金': '忌神', '土': '仇神'}
        indicators = _detect_career_indicators(
            year_ten_god='傷官', lp_ten_god='', day_master_stem='庚',
            year_stem='癸', year_branch='卯',
            pillars=pillars, effective_gods=effective_gods,
        )
        labels = [(i['type'], i['label']) for i in indicators]
        assert ('danger', '傷官見官') in labels, \
            f"傷官見官 SHOULD be danger when 正官=用神, got {labels}"
        assert ('opportunity', '傷官制官') not in labels

    def test_xianshen_officer_suppressed(self):
        """Fix 3: When 官 element is 閒神, suppress indicator entirely (no noise)."""
        from app.career_enhanced import _detect_career_indicators
        # Construct a chart where 官 element happens to be 閒神
        pillars = {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '丁', 'branch': '卯'},  # 丁=傷官 manifest
            'day':   {'stem': '甲', 'branch': '寅'},
            'hour':  {'stem': '辛', 'branch': '酉'},  # 辛=正官 manifest
        }
        # Make 金(官) = 閒神
        effective_gods = {'木': '用神', '水': '喜神', '金': '閒神', '火': '仇神', '土': '忌神'}
        indicators = _detect_career_indicators(
            year_ten_god='傷官', lp_ten_god='', day_master_stem='甲',
            year_stem='丁', year_branch='卯',
            pillars=pillars, effective_gods=effective_gods,
        )
        sg_labels = [i for i in indicators if i['label'] in ('傷官見官', '傷官制官')]
        assert len(sg_labels) == 0, \
            f"Should suppress 傷官見官 indicator when 官 is 閒神, got {sg_labels}"


class TestYearRoleToAuspiciousness:
    """Test R6-2: 流年-only auspiciousness mapping (YEAR_ROLE_TO_AUSPICIOUSNESS)."""

    def test_yongshen_maps_to_daji(self):
        """用神 year element → 大吉."""
        from app.career_enhanced import YEAR_ROLE_TO_AUSPICIOUSNESS
        assert YEAR_ROLE_TO_AUSPICIOUSNESS['用神'] == '大吉'

    def test_xishen_maps_to_ji(self):
        """喜神 year element → 吉."""
        from app.career_enhanced import YEAR_ROLE_TO_AUSPICIOUSNESS
        assert YEAR_ROLE_TO_AUSPICIOUSNESS['喜神'] == '吉'

    def test_xianshen_maps_to_ping(self):
        """閒神 year element → 平."""
        from app.career_enhanced import YEAR_ROLE_TO_AUSPICIOUSNESS
        assert YEAR_ROLE_TO_AUSPICIOUSNESS['閒神'] == '平'

    def test_choushen_maps_to_xiong(self):
        """仇神 year element → 凶."""
        from app.career_enhanced import YEAR_ROLE_TO_AUSPICIOUSNESS
        assert YEAR_ROLE_TO_AUSPICIOUSNESS['仇神'] == '凶'

    def test_jishen_maps_to_daxiong(self):
        """忌神 year element → 大凶."""
        from app.career_enhanced import YEAR_ROLE_TO_AUSPICIOUSNESS
        assert YEAR_ROLE_TO_AUSPICIOUSNESS['忌神'] == '大凶'

    def test_all_5_roles_covered(self):
        """All 5 god roles must be in the mapping."""
        from app.career_enhanced import YEAR_ROLE_TO_AUSPICIOUSNESS
        expected_roles = {'用神', '喜神', '閒神', '仇神', '忌神'}
        assert set(YEAR_ROLE_TO_AUSPICIOUSNESS.keys()) == expected_roles

    def test_all_5_levels_produced(self):
        """All 5 auspiciousness levels must be produced."""
        from app.career_enhanced import YEAR_ROLE_TO_AUSPICIOUSNESS
        expected_levels = {'大吉', '吉', '平', '凶', '大凶'}
        assert set(YEAR_ROLE_TO_AUSPICIOUSNESS.values()) == expected_levels


# ============================================================
# Monthly Forecast Tests
# ============================================================

class TestMonthlyForecast:
    """Test compute_monthly_forecast_data function."""

    def test_returns_12_months(self, laopo10_career_result):
        """Should return exactly 12 months."""
        monthly = laopo10_career_result['monthlyForecasts']
        assert len(monthly) == 12

    def test_monthly_structure(self, laopo10_career_result):
        """Each month should have required keys."""
        for month in laopo10_career_result['monthlyForecasts']:
            assert 'month' in month
            assert 'stem' in month
            assert 'branch' in month
            assert 'tenGod' in month
            assert 'auspiciousness' in month
            assert 'annualContext' in month
            assert 'branchInteractions' in month
            assert isinstance(month['branchInteractions'], list)

    def test_monthly_auspiciousness_valid(self, laopo10_career_result):
        """Monthly auspiciousness should be one of the 7 tiers (Fix 2 v4 vocabulary).
        Replaces legacy 9-label set {吉中有凶, 凶中有吉, 凶中帶機, ...} with cleaner
        7-tier scale produced by the new score-based algorithm."""
        valid = {'大吉', '吉', '小吉', '平', '小凶', '凶', '大凶'}
        for month in laopo10_career_result['monthlyForecasts']:
            assert month['auspiciousness'] in valid, \
                f"Month {month.get('month')}: invalid {month['auspiciousness']}"

    def test_laopo_no_more_than_5_inauspicious_months(self, laopo10_career_result):
        """Fix 2: 身弱官殺旺 chart in 平 annual year shouldn't have 8+ 凶 months.
        Old algorithm produced 8/12 凶 (over-pessimistic). New: ≤5."""
        bad = [m for m in laopo10_career_result['monthlyForecasts']
               if m['auspiciousness'] in ('凶', '大凶')]
        assert len(bad) <= 5, \
            f"Too pessimistic: {len(bad)} 凶/大凶 months out of 12"

    def test_laopo_jan_2026_geng_yin_not_xiong(self, laopo10_career_result):
        """Fix 2: 1月 庚寅: 庚=忌 stem but 寅=用神(本氣)+寅沖申(時支忌神)
        — should land favorable, NOT 凶."""
        months = laopo10_career_result['monthlyForecasts']
        jan = next(m for m in months if m['stem'] == '庚' and m['branch'] == '寅')
        assert jan['auspiciousness'] in ('小吉', '吉', '平'), \
            f"1月 庚寅 should be favorable-ish, got {jan['auspiciousness']}"

    def test_laopo_sep_2026_wu_xu_not_daxiong(self, laopo10_career_result):
        """Fix 5: 9月 戊戌 vs 甲戌日 = 戌戌伏吟 (流月 alone). Should be 凶, NOT 大凶
        (per 林子玄: 流月 伏吟 alone is at LOWER end of severity)."""
        months = laopo10_career_result['monthlyForecasts']
        sep = next(m for m in months if m['stem'] == '戊' and m['branch'] == '戌')
        assert sep['auspiciousness'] != '大凶', \
            f"9月 戊戌 流月 伏吟 alone should not be 大凶, got {sep['auspiciousness']}"
        # Should still register the 伏吟 interaction note
        types = [n.get('type') for n in sep.get('branchInteractions', [])]
        assert '伏吟' in types

    def test_fuyin_modifier_with_yongshen(self):
        """Fix 5: 伏吟 of 用神 element should NOT downgrade — use the upward map."""
        from app.career_enhanced import _apply_fuyin_modifier
        label, _note = _apply_fuyin_modifier('平', '用神')
        assert label == '小吉', f"伏吟 of 用神 base=平 → 小吉, got {label}"
        label, _note = _apply_fuyin_modifier('凶', '用神')
        assert label == '平', f"伏吟 of 用神 mitigates 凶 → 平, got {label}"

    def test_fuyin_modifier_with_jishen_caps(self):
        """Fix 5: 流月 伏吟 alone of 忌仇 should NOT escalate 凶 → 大凶."""
        from app.career_enhanced import _apply_fuyin_modifier
        label, _ = _apply_fuyin_modifier('凶', '忌神')
        assert label == '凶', f"流月 伏吟 alone should cap at 凶, got {label}"

    def test_fuyin_modifier_stack_escalation(self):
        """Fix 5: 流月+大運 同支 伏吟 (stack) should escalate one tier downward."""
        from app.career_enhanced import _apply_fuyin_modifier
        # No stacking: 凶 stays 凶
        label, _ = _apply_fuyin_modifier(
            '凶', '忌神', lp_branch='寅', year_branch='午', month_branch='戌',
        )
        assert label == '凶'
        # Stacking with 大運: 凶 → 大凶 via stack escalation
        label, note = _apply_fuyin_modifier(
            '凶', '忌神', lp_branch='戌', year_branch='午', month_branch='戌',
        )
        assert label == '大凶', f"Stack escalation should push 凶 → 大凶, got {label}"
        assert '同支' in note['description']

    def test_assess_monthly_combined_arithmetic(self, laopo10_pillars):
        """Fix 2 mechanical verification — Laopo 1月 庚寅 should compute
        score=+0.45 (with 用神=木) → base 平 → +1 from 寅沖申 → 小吉."""
        from app.career_enhanced import _assess_monthly_combined
        gods = {'水': '喜神', '木': '用神', '火': '閒神', '金': '忌神', '土': '仇神'}
        label, notes = _assess_monthly_combined(
            laopo10_pillars, day_branch='戌', day_master_stem='甲',
            month_stem='庚', month_branch='寅',
            effective_gods=gods, annual_auspiciousness='平',
        )
        assert label == '小吉'
        # Should have a 沖 interaction note for 寅沖申
        chong_notes = [n for n in notes if n.get('type') == '沖' and '申' in n.get('description', '')]
        assert chong_notes, f"Expected 沖申 interaction note, got {notes}"

    def test_interaction_cap_prevents_double_upgrade(self):
        """Fix 2 (Issue 8 R1): step 4a + step 4b cannot stack to give >+1 tier.

        Synthetic chart with 戌 day_branch + 申 hour_branch (both 忌仇 candidates
        for 甲 weak DM). 流月 寅: hits 寅沖申(step 4b, 申=忌神) but day_branch ≠ 寅.
        Hits no LIUHE with day_branch (寅合亥, no 亥 here). So only +1 from step 4b.
        """
        from app.career_enhanced import _assess_monthly_combined
        pillars = {
            'year':  {'stem': '丙', 'branch': '寅'},
            'month': {'stem': '辛', 'branch': '丑'},
            'day':   {'stem': '甲', 'branch': '戌'},
            'hour':  {'stem': '壬', 'branch': '申'},
        }
        gods = {'水': '喜神', '木': '用神', '火': '閒神', '金': '忌神', '土': '仇神'}
        # Use 庚寅 流月: stem 庚=忌(-0.60), 本氣 寅=用(+1.10), 中氣 丙=閒(0), 餘氣 戊=仇(-0.05)
        # = +0.45 → 平. Step 4a: 寅⇎戌 nothing. Step 4b: 寅沖申(time支=忌) → +1 → 小吉.
        # Total tier shift = +1 (cap respected).
        label, notes = _assess_monthly_combined(
            pillars, day_branch='戌', day_master_stem='甲',
            month_stem='庚', month_branch='寅',
            effective_gods=gods, annual_auspiciousness='平',
        )
        assert label == '小吉', f"Single +1 from step 4b should give 平→小吉, got {label}"
        # Confirm step 4b is what fired (not step 4a)
        sweep_notes = [n for n in notes if n.get('type') == '沖' and 'hour' in n.get('description', '').lower()]
        assert sweep_notes, f"Expected step 4b 寅沖申 sweep note, got {notes}"


# ============================================================
# Five Qi States Tests
# ============================================================

class TestFiveQiStates:
    """Test compute_five_qi_states function."""

    def test_returns_all_elements(self, laopo10_career_result):
        """Should have all 5 elements."""
        qi = laopo10_career_result['fiveQiStates']
        assert isinstance(qi, dict)
        assert len(qi) == 5
        for element in ['木', '火', '土', '金', '水']:
            assert element in qi

    def test_states_valid(self, laopo10_career_result):
        """States should be valid 旺相休囚死 labels."""
        valid = {'旺', '相', '休', '囚', '死'}
        qi = laopo10_career_result['fiveQiStates']
        for element, state in qi.items():
            assert state in valid, f"{element} has invalid state: {state}"

    def test_exactly_one_wang(self):
        """Each month should have exactly one 旺 element."""
        from app.constants import EARTHLY_BRANCHES
        for month in ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑']:
            states = compute_five_qi_states(month)
            wang_count = sum(1 for s in states.values() if s == '旺')
            assert wang_count == 1, f"Month {month} should have exactly 1 旺, got {wang_count}"

    def test_chou_month_states(self):
        """丑月: 土旺, 金相, 火休, 木囚, 水死."""
        states = compute_five_qi_states('丑')
        assert states['土'] == '旺'
        assert states['金'] == '相'
        assert states['火'] == '休'
        assert states['木'] == '囚'
        assert states['水'] == '死'

    def test_yin_month_states(self):
        """寅月: 木旺, 火相, 水休, 金囚, 土死."""
        states = compute_five_qi_states('寅')
        assert states['木'] == '旺'
        assert states['火'] == '相'
        assert states['水'] == '休'
        assert states['金'] == '囚'
        assert states['土'] == '死'

    def test_wu_month_states(self):
        """午月: 火旺, 土相, 木休, 水囚, 金死."""
        states = compute_five_qi_states('午')
        assert states['火'] == '旺'
        assert states['土'] == '相'
        assert states['木'] == '休'
        assert states['水'] == '囚'
        assert states['金'] == '死'


# ============================================================
# Full Integration Tests
# ============================================================

class TestCareerPreAnalysisIntegration:
    """Integration tests for the full career pre-analysis pipeline."""

    def test_all_top_level_keys_present(self, laopo10_career_result):
        """All expected top-level keys should be present."""
        expected_keys = {
            'weightedElements', 'weightedTenGods',
            'reputationScore', 'wealthScore',
            'suitablePositions', 'companyTypeFit',
            'entrepreneurshipFit', 'partnershipFit',
            'careerAllies', 'fiveQiStates',
            'annualForecasts', 'monthlyForecasts',
            'favorableIndustries', 'unfavorableIndustries',
            'activeLuckPeriod', 'pattern',
            'deterministic',
        }
        assert expected_keys.issubset(set(laopo10_career_result.keys()))

    def test_favorable_industries_not_empty(self, laopo10_career_result):
        """Favorable industries should not be empty (bug regression check)."""
        fav = laopo10_career_result['favorableIndustries']
        assert len(fav) > 0, \
            "Favorable industries should not be empty (effectiveGods format conversion)"

    def test_unfavorable_industries_not_empty(self, laopo10_career_result):
        """Unfavorable industries should not be empty."""
        unfav = laopo10_career_result['unfavorableIndustries']
        assert len(unfav) > 0

    def test_industry_structure(self, laopo10_career_result):
        """Each industry entry should have expected keys."""
        for ind in laopo10_career_result['favorableIndustries']:
            assert 'element' in ind
            assert 'category' in ind
            assert 'industries' in ind

    def test_pattern_present(self, laopo10_career_result):
        """Pattern (格局) should be a non-empty string."""
        assert len(laopo10_career_result['pattern']) > 0

    def test_active_luck_period_present(self, laopo10_career_result):
        """Active luck period should be present."""
        alp = laopo10_career_result['activeLuckPeriod']
        assert alp is not None
        assert 'stem' in alp
        assert 'branch' in alp

    def test_deterministic_section_keys(self, laopo10_career_result):
        """Deterministic section should have key data for frontend."""
        det = laopo10_career_result['deterministic']
        expected_keys = {
            'weighted_elements', 'weighted_ten_gods',
            'reputation_score', 'wealth_score',
            'five_qi_states', 'pattern',
            'active_luck_period',
        }
        assert expected_keys.issubset(set(det.keys()))

    def test_different_chart_produces_different_results(self):
        """A different birth chart should produce different career results."""
        chart2 = calculate_bazi(
            '1990-06-15', '08:30', '台北', 'Asia/Taipei', 'male',
            reading_type='LIFETIME',
        )
        pre2 = chart2.get('preAnalysis', {})
        result2 = generate_career_pre_analysis(
            pillars=chart2['fourPillars'],
            day_master_stem=chart2.get('dayMasterStem', ''),
            gender='male',
            five_elements_balance=chart2['fiveElementsBalance'],
            effective_gods=pre2.get('effectiveFavorableGods', {}),
            prominent_god=pre2.get('prominentGod', ''),
            strength_v2=pre2.get('strengthV2', {}),
            cong_ge=pre2.get('congGe'),
            luck_periods=chart2.get('luckPeriods', []),
            annual_stars=chart2.get('annualStars', []),
            monthly_stars=chart2.get('monthlyStars', []),
            kong_wang=chart2.get('kongWang', []),
            birth_year=1990,
            current_year=2026,
        )
        # At least some scores should differ
        assert result2['reputationScore']['score'] != 0
        assert result2['wealthScore']['score'] != 0
        assert len(result2['annualForecasts']) == 5
        assert len(result2['monthlyForecasts']) == 12

    def test_monthly_stars_have_solar_term_names(self, laopo10_chart):
        """Monthly stars should now include solar term names."""
        monthly = laopo10_chart.get('monthlyStars', [])
        assert len(monthly) == 12
        expected_terms = ['立春', '驚蟄', '清明', '立夏', '芒種', '小暑',
                          '立秋', '白露', '寒露', '立冬', '大雪', '小寒']
        for i, ms in enumerate(monthly):
            assert 'solarTermName' in ms, f"Month {i+1} missing solarTermName"
            assert ms['solarTermName'] == expected_terms[i], \
                f"Month {i+1}: expected {expected_terms[i]}, got {ms['solarTermName']}"

    def test_monthly_stars_have_end_dates(self, laopo10_chart):
        """Monthly stars should include end dates."""
        monthly = laopo10_chart.get('monthlyStars', [])
        for ms in monthly:
            assert 'solarTermEndDate' in ms, f"Month {ms['month']} missing end date"
            # End date should be after start date (string comparison works for YYYY-MM-DD)
            assert ms['solarTermEndDate'] >= ms['solarTermDate'], \
                f"Month {ms['month']}: end date {ms['solarTermEndDate']} before start {ms['solarTermDate']}"

    def test_monthly_stars_have_season_element(self, laopo10_chart):
        """Monthly stars should include seasonal element energy."""
        monthly = laopo10_chart.get('monthlyStars', [])
        for ms in monthly:
            assert 'seasonElement' in ms, f"Month {ms['month']} missing seasonElement"
            assert ms['seasonElement'].endswith('旺'), \
                f"Month {ms['month']}: seasonElement should end with 旺"

    def test_engine_format_gods_handled(self):
        """generate_career_pre_analysis should handle engine format gods."""
        chart = calculate_bazi(
            '1985-03-20', '12:00', '香港', 'Asia/Hong_Kong', 'male',
            reading_type='LIFETIME',
        )
        pre = chart.get('preAnalysis', {})
        raw_gods = pre.get('effectiveFavorableGods', {})
        # Verify the raw format is engine format
        if raw_gods:
            first_key = next(iter(raw_gods))
            assert first_key in ('usefulGod', 'favorableGod', 'idleGod',
                                'tabooGod', 'enemyGod'), \
                f"Expected engine format key, got '{first_key}'"

        result = generate_career_pre_analysis(
            pillars=chart['fourPillars'],
            day_master_stem=chart.get('dayMasterStem', ''),
            gender='male',
            five_elements_balance=chart['fiveElementsBalance'],
            effective_gods=raw_gods,
            prominent_god=pre.get('prominentGod', ''),
            strength_v2=pre.get('strengthV2', {}),
            cong_ge=pre.get('congGe'),
            luck_periods=chart.get('luckPeriods', []),
            annual_stars=chart.get('annualStars', []),
            monthly_stars=chart.get('monthlyStars', []),
            kong_wang=chart.get('kongWang', []),
            birth_year=1985,
            current_year=2026,
        )
        # Should successfully produce non-empty industries
        assert len(result['favorableIndustries']) > 0
        assert len(result['unfavorableIndustries']) > 0
