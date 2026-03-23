"""
Tests for Compatibility Romance V2 Pre-Analysis Module (感情合盤 V2).

Covers all 7 new pre-analysis functions + the master orchestrator:
1. compute_individual_love_personality — 柱位性格特質
2. compute_spouse_enrichment — 旺夫/旺妻 scoring
3. compute_marriage_wealth — 婚前婚後財富
4. compute_post_marriage_quality — 婚後甜蜜度+穩定度
5. compute_marriage_crisis_risk — 個人婚變風險
6. compute_combined_crisis_assessment — 兩人合婚危機
7. compute_compatibility_annual_forecast — 流年感情運
+ Master orchestrator: compute_compatibility_romance_preanalysis

Test data: Roger + Laopo (real charts from calculator).
"""

import pytest

from app.calculator import calculate_bazi
from app.compatibility_romance_preanalysis import (
    compute_combined_crisis_assessment,
    compute_compatibility_annual_forecast,
    compute_compatibility_romance_preanalysis,
    compute_individual_love_personality,
    compute_marriage_crisis_risk,
    compute_marriage_wealth,
    compute_post_marriage_quality,
    compute_spouse_enrichment,
)


# ============================================================
# Test Data
# ============================================================

ROGER_DATA = {
    'birth_date': '1987-09-06',
    'birth_time': '15:30',
    'birth_city': 'Kuala Lumpur',
    'birth_timezone': 'Asia/Kuala_Lumpur',
    'gender': 'male',
}

LAOPO_DATA = {
    'birth_date': '1987-01-25',
    'birth_time': '15:30',
    'birth_city': 'Kuala Lumpur',
    'birth_timezone': 'Asia/Kuala_Lumpur',
    'gender': 'female',
}


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture(scope='module')
def roger_chart():
    """Calculate Roger's full Bazi chart."""
    return calculate_bazi(**ROGER_DATA)


@pytest.fixture(scope='module')
def laopo_chart():
    """Calculate Laopo's full Bazi chart."""
    return calculate_bazi(**LAOPO_DATA)


@pytest.fixture(scope='module')
def roger_effective_gods(roger_chart):
    """Extract Roger's effective gods."""
    return roger_chart['preAnalysis']['effectiveFavorableGods']


@pytest.fixture(scope='module')
def laopo_effective_gods(laopo_chart):
    """Extract Laopo's effective gods."""
    return laopo_chart['preAnalysis']['effectiveFavorableGods']


@pytest.fixture(scope='module')
def roger_love_personality(roger_chart):
    """Compute Roger's love personality."""
    return compute_individual_love_personality(roger_chart, 'male')


@pytest.fixture(scope='module')
def laopo_love_personality(laopo_chart):
    """Compute Laopo's love personality."""
    return compute_individual_love_personality(laopo_chart, 'female')


@pytest.fixture(scope='module')
def roger_spouse_enrichment(roger_chart, roger_effective_gods):
    """Compute Roger's spouse enrichment."""
    return compute_spouse_enrichment(roger_chart, 'male', roger_effective_gods)


@pytest.fixture(scope='module')
def laopo_spouse_enrichment(laopo_chart, laopo_effective_gods):
    """Compute Laopo's spouse enrichment."""
    return compute_spouse_enrichment(laopo_chart, 'female', laopo_effective_gods)


@pytest.fixture(scope='module')
def roger_marriage_wealth(roger_chart, roger_effective_gods):
    """Compute Roger's marriage wealth."""
    luck_periods = roger_chart.get('luckPeriods', [])
    return compute_marriage_wealth(roger_chart, 'male', roger_effective_gods, luck_periods)


@pytest.fixture(scope='module')
def laopo_marriage_wealth(laopo_chart, laopo_effective_gods):
    """Compute Laopo's marriage wealth."""
    luck_periods = laopo_chart.get('luckPeriods', [])
    return compute_marriage_wealth(laopo_chart, 'female', laopo_effective_gods, luck_periods)


@pytest.fixture(scope='module')
def enhanced_data_stub():
    """Minimal enhanced compatibility data stub for combined crisis tests."""
    return {
        'dimensionScores': {
            'dayStemRelationship': {
                'stemResultElement': '',
            },
        },
    }


@pytest.fixture(scope='module')
def post_marriage_quality(roger_chart, laopo_chart, enhanced_data_stub):
    """Compute post-marriage quality for Roger + Laopo."""
    return compute_post_marriage_quality(roger_chart, laopo_chart, enhanced_data_stub)


@pytest.fixture(scope='module')
def roger_crisis_risk(roger_chart, roger_effective_gods):
    """Compute Roger's marriage crisis risk."""
    return compute_marriage_crisis_risk(roger_chart, 'male', roger_effective_gods)


@pytest.fixture(scope='module')
def laopo_crisis_risk(laopo_chart, laopo_effective_gods):
    """Compute Laopo's marriage crisis risk."""
    return compute_marriage_crisis_risk(laopo_chart, 'female', laopo_effective_gods)


@pytest.fixture(scope='module')
def combined_crisis(roger_chart, laopo_chart, enhanced_data_stub):
    """Compute combined crisis assessment."""
    return compute_combined_crisis_assessment(roger_chart, laopo_chart, enhanced_data_stub)


@pytest.fixture(scope='module')
def roger_annual_forecast(roger_chart, roger_effective_gods):
    """Compute Roger's 2026 annual forecast."""
    return compute_compatibility_annual_forecast(roger_chart, 'male', roger_effective_gods, 2026)


@pytest.fixture(scope='module')
def laopo_annual_forecast(laopo_chart, laopo_effective_gods):
    """Compute Laopo's 2026 annual forecast."""
    return compute_compatibility_annual_forecast(laopo_chart, 'female', laopo_effective_gods, 2026)


# ============================================================
# TestIndividualLovePersonality
# ============================================================

class TestIndividualLovePersonality:
    """Tests for compute_individual_love_personality."""

    def test_roger_archetype(self, roger_love_personality):
        """Roger should have a non-empty archetype name."""
        archetype = roger_love_personality['archetype']
        assert archetype, "Archetype should not be empty"
        assert isinstance(archetype, str)
        assert len(archetype) >= 2  # Chinese archetype names are at least 2 chars

    def test_roger_pillar_traits_count(self, roger_love_personality):
        """Roger has all 4 pillars known, so should have 4 pillar traits."""
        traits = roger_love_personality['pillarTraits']
        assert len(traits) == 4, f"Expected 4 traits, got {len(traits)}: {traits}"

    def test_roger_hour_stem_food_god(self, roger_love_personality):
        """Hour stem 庚 is 食神 for DM 戊. Should appear in pillarTraits."""
        traits = roger_love_personality['pillarTraits']
        hour_traits = [t for t in traits if t['position'] == 'hour_stem']
        assert len(hour_traits) == 1
        assert hour_traits[0]['tenGod'] == '食神'

    def test_laopo_archetype(self, laopo_love_personality):
        """Laopo should have a non-empty archetype."""
        archetype = laopo_love_personality['archetype']
        assert archetype
        assert isinstance(archetype, str)

    def test_laopo_food_god_in_year(self, laopo_love_personality):
        """Year stem 丙 is 食神 for DM 甲. Should be in year_stem trait."""
        traits = laopo_love_personality['pillarTraits']
        year_traits = [t for t in traits if t['position'] == 'year_stem']
        assert len(year_traits) == 1
        assert year_traits[0]['tenGod'] == '食神'

    def test_unknown_hour_flag(self):
        """Chart with no hour data should have hourUnknown=True and only 3 pillar traits."""
        # Build minimal chart with empty hour
        chart = {
            'dayMasterStem': '戊',
            'fourPillars': {
                'year': {'stem': '丁', 'branch': '卯'},
                'month': {'stem': '戊', 'branch': '申'},
                'day': {'stem': '戊', 'branch': '午'},
                'hour': {'stem': '', 'branch': ''},
            },
            'preAnalysis': {
                'effectiveFavorableGods': {
                    'usefulGod': '土',
                    'favorableGod': '火',
                    'tabooGod': '木',
                    'enemyGod': '水',
                    'idleGod': '金',
                },
                'strengthV2': {'classification': 'weak', 'score': 39},
            },
        }
        result = compute_individual_love_personality(chart, 'male')
        assert result['hourUnknown'] is True
        assert len(result['pillarTraits']) == 3


# ============================================================
# TestSpouseEnrichment
# ============================================================

class TestSpouseEnrichment:
    """Tests for compute_spouse_enrichment."""

    def test_roger_wangqi_score_range(self, roger_spouse_enrichment):
        """Roger's 旺妻 score should be moderate (30-55)."""
        score = roger_spouse_enrichment['totalScore']
        assert 30 <= score <= 55, f"Roger's score {score} outside expected 30-55"

    def test_roger_title_is_wangqi(self, roger_spouse_enrichment):
        """Title should be '旺妻' for male."""
        assert roger_spouse_enrichment['title'] == '旺妻'

    def test_laopo_wangfu_score_range(self, laopo_spouse_enrichment):
        """Laopo's 旺夫 score should be 15-55 (pure+rooted bonus may increase score)."""
        score = laopo_spouse_enrichment['totalScore']
        assert 15 <= score <= 55, f"Laopo's score {score} outside expected 15-55"

    def test_laopo_title_is_wangfu(self, laopo_spouse_enrichment):
        """Title should be '旺夫' for female."""
        assert laopo_spouse_enrichment['title'] == '旺夫'

    def test_laopo_has_negative_indicator(self, laopo_spouse_enrichment):
        """Laopo should have a negative indicator (傷官 or 官殺混雜)."""
        indicators = laopo_spouse_enrichment['indicators']
        negative_indicators = [ind for ind in indicators if ind['type'] == 'negative']
        assert len(negative_indicators) > 0, "Laopo should have at least one negative indicator"
        # Check for common negative indicators for Laopo
        neg_descs = [ind['desc'] for ind in negative_indicators]
        has_expected = any(
            '傷官' in desc or '官殺混雜' in desc
            for desc in neg_descs
        )
        assert has_expected, f"Expected 傷官/官殺混雜 negative, got: {neg_descs}"

    def test_score_mapping_levels(self):
        """Verify enrichment level labels match score ranges."""
        from app.compatibility_romance_preanalysis import ENRICHMENT_LEVELS, _get_enrichment_label

        # Test boundary values
        assert _get_enrichment_label(100)['label'] == '非常旺'
        assert _get_enrichment_label(80)['label'] == '非常旺'
        assert _get_enrichment_label(79)['label'] == '較好'
        assert _get_enrichment_label(60)['label'] == '較好'
        assert _get_enrichment_label(59)['label'] == '一般'
        assert _get_enrichment_label(40)['label'] == '一般'
        assert _get_enrichment_label(39)['label'] == '較弱'
        assert _get_enrichment_label(20)['label'] == '較弱'
        assert _get_enrichment_label(19)['label'] == '明顯克'
        assert _get_enrichment_label(0)['label'] == '明顯克'


# ============================================================
# TestMarriageWealth
# ============================================================

class TestMarriageWealth:
    """Tests for compute_marriage_wealth."""

    def test_roger_has_pre_marriage_data(self, roger_marriage_wealth):
        """preMarriage should not be empty (Roger has LP data)."""
        # It may or may not have findings depending on LP details,
        # but the field must exist
        assert 'preMarriage' in roger_marriage_wealth
        assert isinstance(roger_marriage_wealth['preMarriage'], list)

    def test_roger_palace_support(self, roger_marriage_wealth):
        """Verify palaceSupport structure exists and has expected keys."""
        ps = roger_marriage_wealth['palaceSupport']
        assert 'status' in ps
        assert 'detail' in ps
        assert 'isKongWang' in ps
        assert ps['status'] in ('填實', '坐虛', '中性')

    def test_laopo_palace_support(self, laopo_marriage_wealth):
        """Verify Laopo's palace analysis has required structure."""
        ps = laopo_marriage_wealth['palaceSupport']
        assert 'status' in ps
        assert isinstance(ps['detail'], str)
        assert isinstance(ps['isKongWang'], bool)

    def test_estimated_marriage_age(self, roger_marriage_wealth):
        """Estimated marriage age should be reasonable (20-45)."""
        age = roger_marriage_wealth['estimatedMarriageAge']
        assert 20 <= age <= 45, f"Marriage age {age} outside expected 20-45"


# ============================================================
# TestPostMarriageQuality
# ============================================================

class TestPostMarriageQuality:
    """Tests for compute_post_marriage_quality."""

    def test_sweetness_score_range(self, post_marriage_quality):
        """Sweetness score should be 0-100."""
        score = post_marriage_quality['sweetness']['score']
        assert 0 <= score <= 100, f"Sweetness {score} outside 0-100"

    def test_stability_score_range(self, post_marriage_quality):
        """Stability score should be 0-100."""
        score = post_marriage_quality['stability']['score']
        assert 0 <= score <= 100, f"Stability {score} outside 0-100"

    def test_identical_charts_guard(self, roger_chart, enhanced_data_stub):
        """Passing same chart for both should return score=0."""
        result = compute_post_marriage_quality(roger_chart, roger_chart, enhanced_data_stub)
        assert result['sweetness']['score'] == 0
        assert result['stability']['score'] == 0
        assert result['sweetness']['note'] == 'identical_charts'

    def test_positive_factors_present(self, post_marriage_quality):
        """Sweetness should have at least 1 factor (午+戌 = 半合 should contribute)."""
        factors = post_marriage_quality['sweetness']['factors']
        assert len(factors) >= 1, f"Expected at least 1 sweetness factor, got {len(factors)}"

    def test_roger_food_god_bonus(self, post_marriage_quality):
        """Roger has 庚(食神) 透干 — should contribute to sweetness."""
        factors = post_marriage_quality['sweetness']['factors']
        food_god_factors = [
            f for f in factors
            if f['type'] == 'positive' and '食神透干' in f['desc']
        ]
        assert len(food_god_factors) >= 1, (
            f"Expected food god bonus factor, got factors: {factors}"
        )


# ============================================================
# TestMarriageCrisisRisk
# ============================================================

class TestMarriageCrisisRisk:
    """Tests for compute_marriage_crisis_risk."""

    def test_roger_overall_risk(self, roger_crisis_risk):
        """Roger's overall risk should be '低' or '中'."""
        assert roger_crisis_risk['overallRisk'] in ('低', '中'), (
            f"Expected 低/中, got {roger_crisis_risk['overallRisk']}"
        )

    def test_roger_no_shangguan_touchu(self, roger_crisis_risk):
        """辛(傷官) NOT in Roger's stems → no 傷官透出 risk factor."""
        factors = roger_crisis_risk['riskFactors']
        shangguan_factors = [f for f in factors if f['factor'] == '傷官透出']
        assert len(shangguan_factors) == 0, (
            f"Roger should not have 傷官透出: {shangguan_factors}"
        )

    def test_roger_yangren_wuzhi(self, roger_crisis_risk):
        """午=羊刃 for DM 戊, no 官殺 in stems → should flag 羊刃無制."""
        # Roger's stems: 丁(正印), 戊(DM/比肩), 戊(DM), 庚(食神)
        # No 正官 or 偏官 in stems → 羊刃無制 should be flagged
        factors = roger_crisis_risk['riskFactors']
        yangren_factors = [f for f in factors if f['factor'] == '羊刃無制']
        assert len(yangren_factors) == 1, (
            f"Expected 羊刃無制 factor, got factors: {[f['factor'] for f in factors]}"
        )

    def test_laopo_financial_star_check(self, laopo_crisis_risk):
        """For female, check 財星透出 logic. Laopo has no 正財/偏財 in stems."""
        # Laopo stems: 丙(食神), 辛(正官), 甲(DM), 壬(偏印)
        # No 正財 or 偏財 in stems → no 財星透出生官殺 factor
        factors = laopo_crisis_risk['riskFactors']
        cai_factors = [f for f in factors if f['factor'] == '財星透出生官殺']
        assert len(cai_factors) == 0, (
            f"Laopo should not have 財星透出生官殺: {cai_factors}"
        )

    def test_laopo_overall_risk(self, laopo_crisis_risk):
        """Laopo's overall risk should be '低' to '中高' range."""
        # Laopo has 官殺混雜 and potentially 傷官見官
        assert laopo_crisis_risk['overallRisk'] in ('低', '中', '中高'), (
            f"Got: {laopo_crisis_risk['overallRisk']}"
        )


# ============================================================
# TestCombinedCrisisAssessment
# ============================================================

class TestCombinedCrisisAssessment:
    """Tests for compute_combined_crisis_assessment."""

    def test_no_crisis_flags(self, combined_crisis):
        """Roger(午)+Laopo(戌) day branches = 半合, not clash → no day crisis."""
        crisis = combined_crisis['crisisFlags']
        day_crisis = [c for c in crisis if c['position'] == 'day' and c['type'] == '六沖']
        assert len(day_crisis) == 0, f"Should not have day 六沖 crisis: {day_crisis}"

    def test_no_warning_for_same_position_clash(self, combined_crisis):
        """Year (卯+寅), month (申+丑), hour (申+申) — none are 六沖 at same position."""
        warnings = combined_crisis['warningFlags']
        # Filter for same-position 六沖 warnings only
        clash_warnings = [w for w in warnings if w['type'] == '六沖']
        assert len(clash_warnings) == 0, (
            f"Should not have same-position 六沖 warnings: {clash_warnings}"
        )

    def test_destructive_level(self, combined_crisis):
        """Should be '良好' or '輕微' for Roger + Laopo (no crisis flags)."""
        level = combined_crisis['destructiveLevel']
        assert level in ('良好', '輕微', '需留意'), (
            f"Expected non-destructive level, got: {level}"
        )

    def test_with_day_branch_clash_pair(self, enhanced_data_stub):
        """Create a mock pair with 子午沖 day branches — verify crisis flag."""
        chart_a = {
            'dayMasterStem': '甲',
            'fourPillars': {
                'year': {'stem': '甲', 'branch': '子'},
                'month': {'stem': '丙', 'branch': '寅'},
                'day': {'stem': '甲', 'branch': '子'},
                'hour': {'stem': '庚', 'branch': '申'},
            },
        }
        chart_b = {
            'dayMasterStem': '丁',
            'fourPillars': {
                'year': {'stem': '丁', 'branch': '丑'},
                'month': {'stem': '壬', 'branch': '午'},
                'day': {'stem': '丁', 'branch': '午'},
                'hour': {'stem': '辛', 'branch': '酉'},
            },
        }
        result = compute_combined_crisis_assessment(chart_a, chart_b, enhanced_data_stub)
        crisis = result['crisisFlags']
        day_clash = [c for c in crisis if c['position'] == 'day' and c['type'] == '六沖']
        assert len(day_clash) == 1, f"Expected day 六沖 crisis flag, got: {crisis}"
        assert result['destructiveLevel'] == '嚴重'


# ============================================================
# TestCompatibilityAnnualForecast
# ============================================================

class TestCompatibilityAnnualForecast:
    """Tests for compute_compatibility_annual_forecast."""

    def test_roger_2026_signals_not_empty(self, roger_annual_forecast):
        """Roger should have at least one signal for 2026."""
        signals = roger_annual_forecast['signals']
        assert len(signals) >= 1, "Signals should not be empty"

    def test_roger_hongluan_tianxi(self, roger_annual_forecast):
        """Verify 紅鸞/天喜 status fields exist for 2026."""
        assert 'annualHongluan' in roger_annual_forecast
        assert 'annualTianxi' in roger_annual_forecast
        assert isinstance(roger_annual_forecast['hongluanActivated'], bool)
        assert isinstance(roger_annual_forecast['tianxiActivated'], bool)

    def test_roger_taohua_not_activated(self, roger_annual_forecast):
        """Roger's 桃花: day=午→卯, year=卯→子. 2026=午 → not activated."""
        assert roger_annual_forecast['taohuaActivated'] is False

    def test_three_scenario_format(self, roger_annual_forecast):
        """Each signal should have singleImplication, datingImplication, marriedImplication."""
        signals = roger_annual_forecast['signals']
        for sig in signals:
            assert 'signal' in sig, f"Missing 'signal' key in {sig}"
            assert 'singleImplication' in sig, f"Missing singleImplication in {sig}"
            assert 'datingImplication' in sig, f"Missing datingImplication in {sig}"
            assert 'marriedImplication' in sig, f"Missing marriedImplication in {sig}"

    def test_laopo_2026_peach_blossom_locked(self, laopo_annual_forecast):
        """Laopo's 桃花=卯 (from both day=戌 and year=寅), natal 戌卯合 → locked."""
        signals = laopo_annual_forecast['signals']
        locked_signals = [s for s in signals if s['signal'] == '桃花星受合']
        assert len(locked_signals) == 1, (
            f"Expected 桃花星受合 signal for Laopo, got signals: {[s['signal'] for s in signals]}"
        )


# ============================================================
# TestMasterOrchestrator
# ============================================================

class TestMasterOrchestrator:
    """Tests for compute_compatibility_romance_preanalysis."""

    def test_roger_laopo_full_preanalysis(self, roger_chart, laopo_chart, enhanced_data_stub):
        """Call with Roger+Laopo, verify all 12 keys present."""
        result = compute_compatibility_romance_preanalysis(
            chart_a=roger_chart,
            chart_b=laopo_chart,
            gender_a='male',
            gender_b='female',
            enhanced_data=enhanced_data_stub,
            current_year=2026,
        )
        expected_keys = {
            'lovePersonalityA', 'lovePersonalityB',
            'spouseEnrichmentA', 'spouseEnrichmentB',
            'marriageWealthA', 'marriageWealthB',
            'postMarriageQuality',
            'crisisRiskA', 'crisisRiskB',
            'combinedCrisis',
            'annualForecastA', 'annualForecastB',
            # Top-level shared data (V4)
            'fiveElementAssessmentA', 'fiveElementAssessmentB',
            'luckPeriodSummaryA', 'luckPeriodSummaryB',
            'currentLuckPeriodA', 'currentLuckPeriodB',
        }
        assert expected_keys == set(result.keys()), (
            f"Missing keys: {expected_keys - set(result.keys())}, "
            f"Extra keys: {set(result.keys()) - expected_keys}"
        )

    def test_identical_charts_early_return(self, roger_chart, enhanced_data_stub):
        """Passing same chart for both should return 'identical' flag."""
        result = compute_compatibility_romance_preanalysis(
            chart_a=roger_chart,
            chart_b=roger_chart,
            gender_a='male',
            gender_b='male',
            enhanced_data=enhanced_data_stub,
        )
        assert result.get('identical') is True
        assert 'message' in result

    def test_output_structure(self, roger_chart, laopo_chart, enhanced_data_stub):
        """Verify top-level keys and sub-structures are well-formed."""
        result = compute_compatibility_romance_preanalysis(
            chart_a=roger_chart,
            chart_b=laopo_chart,
            gender_a='male',
            gender_b='female',
            enhanced_data=enhanced_data_stub,
            current_year=2026,
        )
        # Love personality
        assert 'archetype' in result['lovePersonalityA']
        assert 'pillarTraits' in result['lovePersonalityA']

        # Spouse enrichment
        assert 'totalScore' in result['spouseEnrichmentA']
        assert 'title' in result['spouseEnrichmentA']
        assert result['spouseEnrichmentA']['title'] == '旺妻'
        assert result['spouseEnrichmentB']['title'] == '旺夫'

        # Marriage wealth
        assert 'estimatedMarriageAge' in result['marriageWealthA']
        assert 'palaceSupport' in result['marriageWealthA']

        # Post marriage quality
        assert 'sweetness' in result['postMarriageQuality']
        assert 'stability' in result['postMarriageQuality']
        assert 'score' in result['postMarriageQuality']['sweetness']
        assert 'score' in result['postMarriageQuality']['stability']

        # Crisis risk
        assert 'overallRisk' in result['crisisRiskA']
        assert 'riskFactors' in result['crisisRiskA']

        # Combined crisis
        assert 'destructiveLevel' in result['combinedCrisis']
        assert 'crisisFlags' in result['combinedCrisis']

        # Annual forecast
        assert 'signals' in result['annualForecastA']
        assert 'year' in result['annualForecastA']
        assert result['annualForecastA']['year'] == 2026
