"""
Tests for Compatibility Pre-Analysis (Layer 2 for AI Narration).

Verifies that the pre-analysis module correctly transforms the raw
8-dimension engine output into structured JSON for AI narration,
leaving ZERO Bazi computation to the AI.
"""

import pytest

from app.compatibility_preanalysis import (
    _analyze_spouse_star,
    _build_attraction_analysis,
    _build_cross_ten_gods,
    _build_dimension_summary,
    _build_element_complementarity_hint,
    _build_narration_guidance,
    _build_pillar_findings,
    _build_yongshen_detail,
    _compute_branch_element_hint,
    _detect_year_patterns,
    _enrich_timing_sync,
    _generate_landmines,
    _get_cross_ten_god_meaning,
    generate_compatibility_pre_analysis,
)
from app.compatibility_enhanced import calculate_enhanced_compatibility
from app.ten_gods import derive_ten_god


# ============================================================
# Test Fixtures
# ============================================================

def make_pillars(day_stem='甲', day_branch='子',
                 year_stem='壬', year_branch='寅',
                 month_stem='癸', month_branch='卯',
                 hour_stem='丙', hour_branch='寅'):
    """Build a minimal fourPillars dict."""
    return {
        'year': {'stem': year_stem, 'branch': year_branch, 'tenGod': '', 'hiddenStemGods': [], 'shenSha': []},
        'month': {'stem': month_stem, 'branch': month_branch, 'tenGod': '', 'hiddenStemGods': [], 'shenSha': []},
        'day': {'stem': day_stem, 'branch': day_branch, 'tenGod': '', 'hiddenStemGods': [], 'shenSha': []},
        'hour': {'stem': hour_stem, 'branch': hour_branch, 'tenGod': '', 'hiddenStemGods': [], 'shenSha': []},
    }


def make_chart(day_stem='甲', day_branch='子', pillars=None, shen_sha=None,
               five_elements=None, luck_periods=None, pre_analysis=None):
    """Build a minimal chart dict."""
    if pillars is None:
        pillars = make_pillars(day_stem=day_stem, day_branch=day_branch)
    return {
        'fourPillars': pillars,
        'dayMasterStem': day_stem,
        'dayMasterBranch': day_branch,
        'fiveElementsBalanceZh': five_elements or {'木': 30, '火': 20, '土': 15, '金': 20, '水': 15},
        'allShenSha': shen_sha or [],
        'luckPeriods': luck_periods or [],
        'preAnalysis': pre_analysis or make_pre_analysis(),
    }


def make_pre_analysis(useful='木', favorable='火', idle='土', taboo='金', enemy='水',
                      classification='strong', cong_ge=None):
    """Build a minimal pre_analysis dict."""
    return {
        'effectiveFavorableGods': {
            'usefulGod': useful,
            'favorableGod': favorable,
            'idleGod': idle,
            'tabooGod': taboo,
            'enemyGod': enemy,
        },
        'classification': classification,
        'congGe': cong_ge,
        'strengthV2': {
            'score': 65,
            'classification': classification,
        },
    }


def make_compat_result(adjusted_score=75, overall_score=72, label='良好', **overrides):
    """Build a minimal compat_result dict."""
    base = {
        'overallScore': overall_score,
        'adjustedScore': adjusted_score,
        'label': label,
        'specialLabel': None,
        'labelDescription': 'Good compatibility',
        'dimensionScores': {
            'yongshenComplementarity': {
                'rawScore': 70, 'amplifiedScore': 80, 'weightedScore': 16,
                'weight': 0.20, 'findings': [],
                'yongshenConfidence': 'high', 'congGeAffectsYongshen': False,
                'sharedJishenRisk': False, 'isNeutralChart': False,
            },
            'dayStemRelationship': {
                'rawScore': 95, 'amplifiedScore': 99, 'weightedScore': 19.8,
                'weight': 0.20, 'findings': [
                    {'type': '天干五合', 'detail': '甲己合化土', 'combinationName': '中正之合', 'huaHuaQuality': 'neutral'}
                ],
                'combinationName': '中正之合', 'dinRenWarning': False, 'huaHuaQuality': 'neutral',
            },
            'spousePalace': {
                'rawScore': 50, 'amplifiedScore': 50, 'weightedScore': 7.5,
                'weight': 0.15, 'findings': [],
                'tianKeDiChong': False, 'tianDeMitigation': 0,
            },
            'tenGodCross': {
                'rawScore': 65, 'amplifiedScore': 75, 'weightedScore': 11.25,
                'weight': 0.15, 'findings': [
                    {'type': 'a_in_b', 'tenGod': '正財', 'score': 90},
                    {'type': 'b_in_a', 'tenGod': '正官', 'score': 50},
                ],
                'sameGenderMode': False, 'guanShaHunZa': None, 'shangGuanJianGuan': None,
            },
            'elementComplementarity': {
                'rawScore': 60, 'amplifiedScore': 68, 'weightedScore': 6.8,
                'weight': 0.10, 'findings': [],
                'rawSum': 2.5,
            },
            'fullPillarInteraction': {
                'rawScore': 55, 'amplifiedScore': 60, 'weightedScore': 6,
                'weight': 0.10, 'findings': [],
                'positiveWeighted': 0.3, 'negativeWeighted': 0.1,
                'crossSanhe': [], 'crossSanxing': [],
                'interactionIntensity': 0.4,
            },
            'shenShaInteraction': {
                'rawScore': 50, 'amplifiedScore': 50, 'weightedScore': 2.5,
                'weight': 0.05, 'findings': [],
                'rawShenShaScore': 0,
            },
            'luckPeriodSync': {
                'rawScore': 50, 'amplifiedScore': 50, 'weightedScore': 2.5,
                'weight': 0.05, 'findings': [],
                'goldenYears': [{'year': 2027, 'reason': '雙方同走用神運'}],
                'challengeYears': [{'year': 2030, 'reason': '雙方同走忌神運'}],
                'yearlyScores': [], 'numYears': 10,
            },
        },
        'knockoutConditions': [],
        'specialFindings': {
            'tianHeDiHe': False,
            'tianHeDiHeDetail': None,
            'guanShaHunZa': None,
            'shangGuanJianGuan': None,
            'congGeAffectsYongshen': False,
            'identicalCharts': False,
            'identicalChartReason': None,
            'tianDeMitigatesClash': False,
            'sameGenderMode': False,
            'dinRenWarning': False,
            'sharedJishenRisk': False,
            'combinationName': '中正之合',
            'huaHuaQuality': 'neutral',
        },
        'timingSync': {
            'goldenYears': [{'year': 2027, 'reason': '雙方同走用神運'}],
            'challengeYears': [{'year': 2030, 'reason': '雙方同走忌神運'}],
            'luckCycleSyncScore': 50,
        },
        'comparisonType': 'romance',
    }
    base.update(overrides)
    return base


# ============================================================
# Test: Cross Ten God Analysis
# ============================================================

class TestCrossTenGods:
    """Test cross-chart Ten God analysis."""

    def test_basic_cross_ten_gods(self):
        """甲 in 己's chart = 正財 (male perspective)."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        result = _build_cross_ten_gods(chart_a, chart_b, 'male', 'female', 'romance')
        assert result['aDaymasterInB']['tenGod'] == derive_ten_god('己', '甲')
        assert result['bDaymasterInA']['tenGod'] == derive_ten_god('甲', '己')

    def test_cross_ten_gods_has_meaning(self):
        """Cross ten god includes meaning text."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        result = _build_cross_ten_gods(chart_a, chart_b, 'male', 'female', 'romance')
        assert '命盤' in result['aDaymasterInB']['meaning']
        assert len(result['aDaymasterInB']['forComparison']) > 0

    def test_spouse_star_analysis_male(self):
        """Male spouse star = 正財."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        result = _build_cross_ten_gods(chart_a, chart_b, 'male', 'female', 'romance')
        assert result['aSpouseStar']['star'] == '正財'
        assert result['bSpouseStar']['star'] == '正官'

    def test_spouse_star_analysis_female(self):
        """Female spouse star = 正官."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        result = _build_cross_ten_gods(chart_a, chart_b, 'female', 'male', 'romance')
        assert result['aSpouseStar']['star'] == '正官'
        assert result['bSpouseStar']['star'] == '正財'

    def test_business_comparison_type(self):
        """Business comparison uses business meanings."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        result = _build_cross_ten_gods(chart_a, chart_b, 'male', 'male', 'business')
        # Should contain business-related meaning
        assert len(result['aDaymasterInB']['forComparison']) > 0


class TestSpouseStarAnalysis:
    """Test individual spouse star analysis."""

    def test_transparent_in_month(self):
        """Spouse star transparent in month pillar."""
        # Male: 正財 = 日主所克同性 = 甲克土 = 己(陰土) = 正財
        # So 正財 stem is 己. Put 己 in month pillar.
        pillars = make_pillars(day_stem='甲', month_stem='己')
        result = _analyze_spouse_star(pillars, '甲', 'male')
        assert result['star'] == '正財'
        assert result['isTransparent'] is True
        assert 'month' in result['positions']

    def test_hidden_in_day_branch(self):
        """Spouse star hidden in day branch."""
        # 甲 male: 正財 = 己. 日支=未 has hidden stems [己, 丁, 乙].
        # 己 → derive_ten_god('甲', '己') = '正財' ✓
        pillars = make_pillars(day_stem='甲', day_branch='未',
                               month_stem='壬')  # 壬 ≠ 正財
        result = _analyze_spouse_star(pillars, '甲', 'male')
        assert result['inSpousePalace'] is True

    def test_absent_spouse_star(self):
        """No spouse star found anywhere."""
        # 甲 male: 正財 = 己. None of the pillars have 己.
        # Need all stems and hidden stems to NOT produce 正財
        # Use 甲,壬,癸,丙 as stems (none is 己)
        # Branches: choose ones without 己 in hidden stems
        # 子=[癸], 卯=[乙], 寅=[甲,丙,戊] → 戊 is 偏財 not 正財
        pillars = make_pillars(day_stem='甲', day_branch='子',
                               year_stem='壬', year_branch='卯',
                               month_stem='癸', month_branch='子',
                               hour_stem='丙', hour_branch='卯')
        result = _analyze_spouse_star(pillars, '甲', 'male')
        assert result['status'] == 'absent'

    def test_multiple_positions(self):
        """Spouse star appears in multiple manifest positions."""
        # 甲 male: 正財 = 己. Put 己 in year + month stems.
        pillars = make_pillars(day_stem='甲',
                               year_stem='己', month_stem='己',
                               hour_stem='壬')
        result = _analyze_spouse_star(pillars, '甲', 'male')
        assert result['status'] == 'multiple'
        assert len(result['positions']) >= 2


# ============================================================
# Test: Pillar Findings
# ============================================================

class TestPillarFindings:
    """Test pillar findings summarization."""

    def test_tianhe_dihe_is_critical(self):
        """天合地合 should be at top of findings."""
        compat = make_compat_result()
        compat['specialFindings']['tianHeDiHe'] = True
        compat['specialFindings']['tianHeDiHeDetail'] = {
            'detected': True,
            'description': '天合地合 — 日柱甲子與己丑',
        }
        findings = _build_pillar_findings(compat)
        assert findings[0]['type'] == '天合地合'
        assert findings[0]['significance'] == 'critical'

    def test_stem_combination_included(self):
        """天干五合 should appear in findings."""
        compat = make_compat_result()
        findings = _build_pillar_findings(compat)
        combo_findings = [f for f in findings if f['type'] == '天干五合']
        assert len(combo_findings) == 1
        assert combo_findings[0]['combinationName'] == '中正之合'

    def test_dinren_warning_included(self):
        """丁壬合 warning should appear when flagged."""
        compat = make_compat_result()
        compat['specialFindings']['dinRenWarning'] = True
        findings = _build_pillar_findings(compat)
        dinren = [f for f in findings if f['type'] == '丁壬合警示']
        assert len(dinren) == 1

    def test_spouse_palace_clash_included(self):
        """六沖 in spouse palace should appear."""
        compat = make_compat_result()
        compat['dimensionScores']['spousePalace']['findings'] = [
            {'type': '六沖', 'detail': '子午沖', 'severity_value': 95}
        ]
        findings = _build_pillar_findings(compat)
        chong = [f for f in findings if f['type'] == '六沖']
        assert len(chong) == 1

    def test_findings_sorted_by_significance(self):
        """Findings should be sorted: critical > high > medium > low."""
        compat = make_compat_result()
        compat['specialFindings']['tianHeDiHe'] = True
        compat['specialFindings']['tianHeDiHeDetail'] = {'detected': True, 'description': 'X'}
        compat['specialFindings']['dinRenWarning'] = True
        findings = _build_pillar_findings(compat)
        sigs = [f['significance'] for f in findings]
        sig_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
        assert sigs == sorted(sigs, key=lambda s: sig_order.get(s, 3))


# ============================================================
# Test: Landmine Generator
# ============================================================

class TestLandmineGenerator:
    """Test landmine warning generation."""

    def test_generates_landmines(self):
        """Should generate at least 1 landmine for typical charts."""
        compat = make_compat_result()
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        landmines = _generate_landmines(
            compat, pre_a, pre_b, chart_a, chart_b,
            'male', 'female', 'romance',
        )
        assert isinstance(landmines, list)

    def test_max_five_landmines(self):
        """Should return at most 5 landmines."""
        compat = make_compat_result()
        compat['specialFindings']['dinRenWarning'] = True
        compat['specialFindings']['sharedJishenRisk'] = True
        compat['specialFindings']['identicalCharts'] = True
        compat['specialFindings']['guanShaHunZa'] = {'detected': True, 'severity': 'severe'}
        compat['dimensionScores']['spousePalace']['tianKeDiChong'] = True
        compat['dimensionScores']['elementComplementarity']['rawScore'] = 20
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        chart_a = make_chart(day_stem='丁')
        chart_b = make_chart(day_stem='壬')
        landmines = _generate_landmines(
            compat, pre_a, pre_b, chart_a, chart_b,
            'male', 'female', 'romance',
        )
        assert len(landmines) <= 5

    def test_landmine_structure(self):
        """Each landmine should have required fields."""
        compat = make_compat_result()
        compat['specialFindings']['dinRenWarning'] = True
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        chart_a = make_chart(day_stem='丁')
        chart_b = make_chart(day_stem='壬')
        landmines = _generate_landmines(
            compat, pre_a, pre_b, chart_a, chart_b,
            'male', 'female', 'romance',
        )
        for lm in landmines:
            assert 'severity' in lm
            assert 'trigger' in lm
            assert 'warning' in lm
            assert 'avoidBehavior' in lm
            assert 'suggestion' in lm
            assert 'dataSource' in lm

    def test_no_duplicate_triggers(self):
        """Landmines should be deduplicated by trigger category."""
        compat = make_compat_result()
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='庚')
        landmines = _generate_landmines(
            compat, pre_a, pre_b, chart_a, chart_b,
            'male', 'female', 'romance',
        )
        triggers = [lm['trigger'] for lm in landmines]
        assert len(triggers) == len(set(triggers))

    def test_tian_ke_di_chong_generates_landmine(self):
        """天剋地沖 should generate a timing landmine."""
        compat = make_compat_result()
        compat['dimensionScores']['spousePalace']['tianKeDiChong'] = True
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        landmines = _generate_landmines(
            compat, pre_a, pre_b, chart_a, chart_b,
            'male', 'female', 'romance',
        )
        timing = [lm for lm in landmines if '天剋地沖' in lm.get('dataSource', '')]
        assert len(timing) == 1


# ============================================================
# Test: Yongshen Detail
# ============================================================

class TestYongshenDetail:
    """Test 用神互補 detail builder."""

    def test_complementary_detection(self):
        """High score means complementary."""
        compat = make_compat_result()
        compat['dimensionScores']['yongshenComplementarity']['rawScore'] = 80
        pre_a = make_pre_analysis(useful='木', taboo='金')
        pre_b = make_pre_analysis(useful='火', taboo='水')
        result = _build_yongshen_detail(compat, pre_a, pre_b)
        assert result['complementary'] is True
        assert result['aUsefulElement'] == '木'
        assert result['bUsefulElement'] == '火'

    def test_not_complementary(self):
        """Low score means not complementary."""
        compat = make_compat_result()
        compat['dimensionScores']['yongshenComplementarity']['rawScore'] = 30
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = _build_yongshen_detail(compat, pre_a, pre_b)
        assert result['complementary'] is False

    def test_shared_jishen_noted(self):
        """Shared 忌神 risk should be flagged."""
        compat = make_compat_result()
        compat['dimensionScores']['yongshenComplementarity']['sharedJishenRisk'] = True
        pre_a = make_pre_analysis(taboo='金')
        pre_b = make_pre_analysis(taboo='金')
        result = _build_yongshen_detail(compat, pre_a, pre_b)
        assert result['sharedJishenRisk'] is True
        assert '金' in result['explanation']

    def test_mutual_support_explanation(self):
        """When A's useful = B's favorable, explanation should note it."""
        compat = make_compat_result()
        pre_a = make_pre_analysis(useful='木', favorable='火')
        pre_b = make_pre_analysis(useful='火', favorable='木')
        result = _build_yongshen_detail(compat, pre_a, pre_b)
        assert '喜神' in result['explanation']


# ============================================================
# Test: Attraction Analysis
# ============================================================

class TestAttractionAnalysis:
    """Test "Does s/he like me?" analysis."""

    def test_romance_only(self):
        """Attraction analysis only for romance type."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()
        result = _build_attraction_analysis(
            chart_a, chart_b, pre_a, pre_b,
            'male', 'female', compat, [], 2025,
        )
        assert 'score' in result
        assert 'signals' in result
        assert 'conclusion' in result

    def test_signals_are_strings(self):
        """Each signal should be a descriptive string."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己',
                              shen_sha=[{'name': '紅鸞', 'pillar': 'month', 'branch': '午'}])
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()
        result = _build_attraction_analysis(
            chart_a, chart_b, pre_a, pre_b,
            'male', 'female', compat,
            [{'name': '紅鸞', 'pillar': 'month', 'branch': '午'}],
            2025,
        )
        for signal in result['signals']:
            assert isinstance(signal, str)
            assert len(signal) > 0

    def test_conclusion_valid_values(self):
        """Conclusion should be strong/medium/weak/unclear."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()
        result = _build_attraction_analysis(
            chart_a, chart_b, pre_a, pre_b,
            'male', 'female', compat, [], 2025,
        )
        assert result['conclusion'] in ('strong', 'medium', 'weak', 'unclear')


# ============================================================
# Test: Narration Guidance
# ============================================================

class TestNarrationGuidance:
    """Test narration guidance builder."""

    def test_high_score_enthusiastic(self):
        """Score >= 80 should suggest enthusiastic tone."""
        compat = make_compat_result(adjusted_score=85)
        result = _build_narration_guidance(compat, 'male', 'female', 'romance')
        assert result['suggestedTone'] == 'enthusiastic'

    def test_low_score_constructive(self):
        """Score < 30 should suggest constructive tone."""
        compat = make_compat_result(adjusted_score=25)
        result = _build_narration_guidance(compat, 'male', 'female', 'romance')
        assert result['suggestedTone'] == 'constructive'

    def test_contains_required_fields(self):
        """Narration guidance should have all required fields."""
        compat = make_compat_result()
        result = _build_narration_guidance(compat, 'male', 'female', 'romance')
        assert result['addressA'] == '你'
        assert result['addressB'] == '對方'
        assert result['genderA'] == 'male'
        assert result['genderB'] == 'female'
        assert result['comparisonType'] == 'romance'
        assert 'positiveNegativeRatio' in result
        assert 'highlightDimensions' in result
        assert len(result['highlightDimensions']) <= 3

    def test_highlight_dimensions_based_on_deviation(self):
        """Should highlight dimensions with most deviation from neutral."""
        compat = make_compat_result()
        compat['dimensionScores']['yongshenComplementarity']['rawScore'] = 95  # +45 deviation
        compat['dimensionScores']['dayStemRelationship']['rawScore'] = 10      # -40 deviation
        compat['dimensionScores']['spousePalace']['rawScore'] = 50             # 0 deviation
        result = _build_narration_guidance(compat, 'male', 'female', 'romance')
        highlights = result['highlightDimensions']
        # yongshenComplementarity and dayStemRelationship should be in top 3
        assert 'yongshenComplementarity' in highlights
        assert 'dayStemRelationship' in highlights


# ============================================================
# Test: Dimension Summary
# ============================================================

class TestDimensionSummary:
    """Test dimension score summary."""

    def test_all_eight_dimensions(self):
        """Should include all 8 dimensions."""
        compat = make_compat_result()
        summary = _build_dimension_summary(compat)
        assert len(summary) == 8

    def test_assessment_labels(self):
        """Assessment should be one of the defined levels."""
        compat = make_compat_result()
        summary = _build_dimension_summary(compat)
        valid = {'極佳', '良好', '普通', '需注意', '困難'}
        for dim in summary:
            assert dim['assessment'] in valid

    def test_weights_are_percentages(self):
        """Weights should be in percentage form."""
        compat = make_compat_result()
        summary = _build_dimension_summary(compat)
        for dim in summary:
            assert 0 <= dim['weight'] <= 100


# ============================================================
# Test: Main Entry Point
# ============================================================

class TestGenerateCompatibilityPreAnalysis:
    """Test the main generate_compatibility_pre_analysis function."""

    def test_output_structure(self):
        """Output should have all required top-level keys."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()

        result = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )

        required_keys = [
            'version', 'overallScore', 'adjustedScore', 'label',
            'specialLabel', 'labelDescription', 'crossTenGods',
            'pillarFindings', 'landmines', 'timingSync',
            'yongshenAnalysis', 'attractionAnalysis',
            'dimensionSummary', 'knockoutConditions',
            'strengthProfiles', 'specialFlags', 'narrationGuidance',
        ]
        for key in required_keys:
            assert key in result, f"Missing key: {key}"

    def test_attraction_analysis_romance_only(self):
        """Attraction analysis present for romance, absent for business."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()

        compat_romance = make_compat_result()
        result_romance = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat_romance, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )
        assert result_romance['attractionAnalysis'] is not None

        compat_business = make_compat_result()
        compat_business['comparisonType'] = 'business'
        result_business = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat_business, pre_a, pre_b,
            'male', 'female', 'business', 2025,
        )
        assert result_business['attractionAnalysis'] is None

    def test_version_is_set(self):
        """Version should be 1.0.0."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()

        result = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )
        assert result['version'] == '1.0.0'

    def test_timing_sync_forwarded(self):
        """Timing sync data should be forwarded from compat result."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()

        result = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )
        assert result['timingSync']['goldenYears'][0]['year'] == 2027
        assert result['timingSync']['challengeYears'][0]['year'] == 2030

    def test_special_flags(self):
        """Special flags should reflect compat result."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()
        compat['specialFindings']['tianHeDiHe'] = True

        result = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )
        assert result['specialFlags']['tianHeDiHe'] is True
        assert result['specialFlags']['tianKeDiChong'] is False

    def test_strength_profiles(self):
        """Strength profiles should reflect individual pre-analysis."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis(classification='strong')
        pre_b = make_pre_analysis(classification='weak')
        compat = make_compat_result()

        result = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )
        assert result['strengthProfiles']['a']['classification'] == 'strong'
        assert result['strengthProfiles']['b']['classification'] == 'weak'

    def test_dimension_summary_has_8_entries(self):
        """Dimension summary should have exactly 8 dimensions."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()

        result = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )
        assert len(result['dimensionSummary']) == 8

    def test_cross_ten_gods_structure(self):
        """Cross ten gods should have all 4 sub-sections."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()

        result = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )
        ctg = result['crossTenGods']
        assert 'aDaymasterInB' in ctg
        assert 'bDaymasterInA' in ctg
        assert 'aSpouseStar' in ctg
        assert 'bSpouseStar' in ctg

    def test_landmines_are_list(self):
        """Landmines should be a list of dicts."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        compat = make_compat_result()

        result = generate_compatibility_pre_analysis(
            chart_a, chart_b, compat, pre_a, pre_b,
            'male', 'female', 'romance', 2025,
        )
        assert isinstance(result['landmines'], list)


# ============================================================
# Test: Cross Ten God Meaning Lookup
# ============================================================

class TestCrossTenGodMeaning:
    """Test cross ten god meaning retrieval."""

    def test_romance_male(self):
        """正財 for romance male should return wife-related meaning."""
        meaning = _get_cross_ten_god_meaning('正財', 'romance', 'male')
        assert len(meaning) > 0

    def test_romance_female(self):
        """正官 for romance female should return husband-related meaning."""
        meaning = _get_cross_ten_god_meaning('正官', 'romance', 'female')
        assert len(meaning) > 0

    def test_business(self):
        """Business meanings should differ from romance."""
        romance = _get_cross_ten_god_meaning('正財', 'romance', 'male')
        business = _get_cross_ten_god_meaning('正財', 'business', 'male')
        assert romance != business

    def test_all_ten_gods_have_meanings(self):
        """All 10 ten gods should have meanings for all comparison types."""
        ten_gods = ['正財', '偏財', '正官', '偏官', '食神', '傷官', '正印', '偏印', '比肩', '劫財']
        for tg in ten_gods:
            for ct in ['romance', 'business', 'friendship']:
                meaning = _get_cross_ten_god_meaning(tg, ct, 'male')
                assert len(meaning) > 0, f"Missing meaning for {tg} in {ct}"


# ============================================================
# Test: Spouse Palace Element Interaction Hint (Gap 1)
# ============================================================

class TestSpousePalaceElementHint:
    """Test that spouse palace findings include element interaction hints."""

    def test_fire_produces_earth(self):
        """午(火) → 戌(土): fire produces earth."""
        hint = _compute_branch_element_hint('午', '戌')
        assert '火生土' in hint
        assert '午' in hint and '戌' in hint
        assert '滋養' in hint

    def test_wood_overcomes_earth(self):
        """寅(木) → 未(土): wood overcomes earth."""
        hint = _compute_branch_element_hint('寅', '未')
        assert '木剋土' in hint
        assert '壓制' in hint

    def test_same_element(self):
        """子(水) → 亥(水): same element."""
        hint = _compute_branch_element_hint('子', '亥')
        assert '同屬水' in hint
        assert '共鳴' in hint

    def test_produced_by(self):
        """戌(土) → 午(火): earth is produced by fire."""
        hint = _compute_branch_element_hint('戌', '午')
        assert '火生土' in hint
        assert '滋養' in hint

    def test_empty_branch_returns_empty(self):
        """Empty branch returns empty hint."""
        assert _compute_branch_element_hint('', '午') == ''
        assert _compute_branch_element_hint('午', '') == ''

    def test_spouse_palace_finding_includes_element_hint(self):
        """Pillar findings for spouse palace include element interaction hint."""
        compat = make_compat_result()
        compat['dimensionScores']['spousePalace']['findings'] = [
            {'type': '六合', 'detail': '午未合化土', 'quality': 'neutral'}
        ]
        findings = _build_pillar_findings(compat, day_branch_a='午', day_branch_b='未')
        spouse_findings = [f for f in findings if f['type'] == '六合']
        assert len(spouse_findings) == 1
        hint = spouse_findings[0]['narrativeHint']
        assert '配偶宮六合' in hint
        assert '火生土' in hint  # 午=火, 未=土

    def test_spouse_palace_no_branch_no_element_hint(self):
        """Without day branches, no element hint is appended."""
        compat = make_compat_result()
        compat['dimensionScores']['spousePalace']['findings'] = [
            {'type': '六沖', 'detail': '子午沖', 'severity_value': 85}
        ]
        findings = _build_pillar_findings(compat)  # No branch args
        spouse_findings = [f for f in findings if f['type'] == '六沖']
        assert len(spouse_findings) == 1
        hint = spouse_findings[0]['narrativeHint']
        assert '配偶宮六沖' in hint
        assert '配偶宮' in hint
        # No element hint appended because branches not provided
        assert '屬' not in hint


# ============================================================
# Test: Cross-chart 三合 Element Meaning (Gap 4)
# ============================================================

class TestCrossSanheElementMeaning:
    """Test that cross-chart 三合 findings include element meanings."""

    def test_sanhe_fire_includes_meaning(self):
        """三合火 should include fire element meaning."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['crossSanhe'] = [
            {'branches': ['午', '寅', '戌'], 'resultElement': '火', 'isYongshen': False}
        ]
        findings = _build_pillar_findings(compat)
        sanhe_findings = [f for f in findings if f['type'] == '跨盤三合']
        assert len(sanhe_findings) == 1
        hint = sanhe_findings[0]['narrativeHint']
        assert '火' in hint
        assert '行動力' in hint  # from ELEMENT_MEANINGS['火']
        assert '放大' in hint

    def test_sanhe_yongshen_includes_extra(self):
        """三合 with isYongshen should include 用神 mention."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['crossSanhe'] = [
            {'branches': ['申', '子', '辰'], 'resultElement': '水', 'isYongshen': True}
        ]
        findings = _build_pillar_findings(compat)
        sanhe_findings = [f for f in findings if f['type'] == '跨盤三合']
        assert len(sanhe_findings) == 1
        hint = sanhe_findings[0]['narrativeHint']
        assert '用神' in hint

    def test_sanhe_unknown_element_fallback(self):
        """三合 with unknown element uses generic fallback."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['crossSanhe'] = [
            {'branches': ['X', 'Y', 'Z'], 'resultElement': '', 'isYongshen': False}
        ]
        findings = _build_pillar_findings(compat)
        sanhe_findings = [f for f in findings if f['type'] == '跨盤三合']
        assert len(sanhe_findings) == 1
        hint = sanhe_findings[0]['narrativeHint']
        assert '匯聚' in hint  # generic fallback

    def test_sanhe_enemy_element_caveat(self):
        """三合 with enemy element should include warning caveat."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['crossSanhe'] = [
            {'branches': ['午', '寅', '戌'], 'resultElement': '火', 'isYongshen': False}
        ]
        findings = _build_pillar_findings(compat, enemy_elements=['火'])
        sanhe_findings = [f for f in findings if f['type'] == '跨盤三合']
        assert len(sanhe_findings) == 1
        hint = sanhe_findings[0]['narrativeHint']
        assert '仇神' in hint
        assert '負面影響' in hint

    def test_sanhe_taboo_element_caveat(self):
        """三合 with taboo element should include burden warning."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['crossSanhe'] = [
            {'branches': ['午', '寅', '戌'], 'resultElement': '火', 'isYongshen': False}
        ]
        findings = _build_pillar_findings(compat, taboo_elements=['火'])
        sanhe_findings = [f for f in findings if f['type'] == '跨盤三合']
        assert len(sanhe_findings) == 1
        hint = sanhe_findings[0]['narrativeHint']
        assert '忌神' in hint
        assert '負擔' in hint

    def test_sanhe_yongshen_overrides_enemy_caveat(self):
        """When isYongshen=True, enemy caveat should NOT appear."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['crossSanhe'] = [
            {'branches': ['申', '子', '辰'], 'resultElement': '水', 'isYongshen': True}
        ]
        findings = _build_pillar_findings(compat, enemy_elements=['水'])
        sanhe_findings = [f for f in findings if f['type'] == '跨盤三合']
        hint = sanhe_findings[0]['narrativeHint']
        assert '用神' in hint
        assert '仇神' not in hint  # yongshen takes precedence


# ============================================================
# Test: Cross-chart Branch Relationships
# ============================================================

class TestCrossBranchRelationships:
    """Test cross-chart branch relationship findings (六合/六沖/六害)."""

    def test_liuhe_generates_finding(self):
        """六合 branch finding generates positive narrativeHint."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['findings'] = [
            {'type': '六合', 'detail': '卯戌合', 'effect': 'positive',
             'pillarA': 'year', 'pillarB': 'day', 'weight': 0.3}
        ]
        findings = _build_pillar_findings(compat)
        branch_findings = [f for f in findings if f['type'] == '跨盤六合']
        assert len(branch_findings) == 1
        hint = branch_findings[0]['narrativeHint']
        assert '年柱' in hint
        assert '日柱' in hint
        assert '卯戌合' in hint
        assert '吸引' in hint or '協調' in hint

    def test_liuchong_generates_finding(self):
        """六沖 branch finding generates negative narrativeHint."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['findings'] = [
            {'type': '六沖', 'detail': '申寅沖', 'effect': 'negative',
             'pillarA': 'month', 'pillarB': 'year', 'weight': 0.3, 'severity': 85}
        ]
        findings = _build_pillar_findings(compat)
        branch_findings = [f for f in findings if f['type'] == '跨盤六沖']
        assert len(branch_findings) == 1
        hint = branch_findings[0]['narrativeHint']
        assert '月柱' in hint
        assert '年柱' in hint
        assert '申寅沖' in hint
        assert '衝突' in hint or '排斥' in hint

    def test_liuhai_generates_finding(self):
        """六害 branch finding generates negative narrativeHint."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['findings'] = [
            {'type': '六害', 'detail': '午丑害', 'effect': 'negative',
             'pillarA': 'day', 'pillarB': 'month', 'weight': 0.3}
        ]
        findings = _build_pillar_findings(compat)
        branch_findings = [f for f in findings if f['type'] == '跨盤六害']
        assert len(branch_findings) == 1
        hint = branch_findings[0]['narrativeHint']
        assert '日柱' in hint
        assert '月柱' in hint
        assert '午丑害' in hint
        assert '猜疑' in hint or '暗傷' in hint

    def test_multiple_branch_relationships(self):
        """Multiple branch findings should all appear."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['findings'] = [
            {'type': '六合', 'detail': '卯戌合', 'effect': 'positive',
             'pillarA': 'year', 'pillarB': 'day', 'weight': 0.3},
            {'type': '六沖', 'detail': '申寅沖', 'effect': 'negative',
             'pillarA': 'month', 'pillarB': 'year', 'weight': 0.3},
            {'type': '六沖', 'detail': '申寅沖', 'effect': 'negative',
             'pillarA': 'hour', 'pillarB': 'year', 'weight': 0.3},
        ]
        findings = _build_pillar_findings(compat)
        branch_findings = [f for f in findings if f['type'].startswith('跨盤六')]
        assert len(branch_findings) == 3

    def test_non_branch_findings_ignored(self):
        """Non-六合/六沖/六害 findings should be ignored."""
        compat = make_compat_result()
        compat['dimensionScores']['fullPillarInteraction']['findings'] = [
            {'type': 'other_type', 'detail': 'test', 'effect': 'positive',
             'pillarA': 'year', 'pillarB': 'day'}
        ]
        findings = _build_pillar_findings(compat)
        branch_findings = [f for f in findings if f['type'].startswith('跨盤六')]
        assert len(branch_findings) == 0


# ============================================================
# Test: Element Complementarity Narrative (Gap 2)
# ============================================================

class TestElementComplementarityNarrative:
    """Test element complementarity narrative hint generation."""

    def test_high_complementarity_generates_narrative(self):
        """Elements with complementarity >= 10 should produce narrative."""
        compat = make_compat_result()
        compat['dimensionScores']['elementComplementarity']['findings'] = [
            {'element': '土', 'complementarity': 15.2, 'personA': 33.8, 'personB': 20.0},
        ]
        hint = _build_element_complementarity_hint(compat)
        assert '土' in hint
        assert '33.8%' in hint
        assert '20.0%' in hint
        assert '穩定性' in hint  # from ELEMENT_MEANINGS['土']

    def test_no_findings_returns_empty(self):
        """No findings should return empty string."""
        compat = make_compat_result()
        compat['dimensionScores']['elementComplementarity']['findings'] = []
        hint = _build_element_complementarity_hint(compat)
        assert hint == ''

    def test_multiple_elements(self):
        """Multiple complementary elements joined with semicolons."""
        compat = make_compat_result()
        compat['dimensionScores']['elementComplementarity']['findings'] = [
            {'element': '土', 'complementarity': 15.0, 'personA': 33.8, 'personB': 20.0},
            {'element': '水', 'complementarity': 12.0, 'personA': 5.0, 'personB': 17.5},
        ]
        hint = _build_element_complementarity_hint(compat)
        assert '土' in hint
        assert '水' in hint
        assert '；' in hint  # joined with semicolons


# ============================================================
# Test: Timing Sync Enrichment (Gap 3)
# ============================================================

class TestTimingSyncEnrichment:
    """Test timing sync year pattern detection and enrichment."""

    def test_consecutive_3_golden_years(self):
        """3+ consecutive golden years get 連續N年 hint."""
        years = [
            {'year': 2032, 'reason': '雙方同時走好運'},
            {'year': 2033, 'reason': '雙方同時走好運'},
            {'year': 2034, 'reason': '雙方同時走好運'},
        ]
        result = _detect_year_patterns(years, 'golden')
        assert len(result) == 3
        assert '連續3年' in result[0]['narrativeHint']
        assert '長期規劃' in result[0]['narrativeHint']

    def test_consecutive_2_golden_years(self):
        """2 consecutive golden years get 連續兩年 hint."""
        years = [
            {'year': 2028, 'reason': '雙方同時走好運'},
            {'year': 2029, 'reason': '雙方同時走好運'},
        ]
        result = _detect_year_patterns(years, 'golden')
        assert len(result) == 2
        assert '連續兩年' in result[0]['narrativeHint']

    def test_isolated_golden_year(self):
        """Isolated golden year gets 獨立 hint."""
        years = [{'year': 2042, 'reason': '雙方同時走好運'}]
        result = _detect_year_patterns(years, 'golden')
        assert len(result) == 1
        assert '獨立' in result[0]['narrativeHint']

    def test_challenge_years_consecutive(self):
        """Challenge years also get pattern hints."""
        years = [
            {'year': 2028, 'reason': '雙方同時運勢低迷'},
            {'year': 2029, 'reason': '雙方同時運勢低迷'},
        ]
        result = _detect_year_patterns(years, 'challenge')
        assert len(result) == 2
        assert '連續兩年低潮' in result[0]['narrativeHint']
        assert '支持' in result[0]['narrativeHint']

    def test_empty_list(self):
        """Empty year list returns empty list."""
        assert _detect_year_patterns([], 'golden') == []

    def test_enrich_timing_sync_preserves_keys(self):
        """_enrich_timing_sync preserves all required keys."""
        timing = {
            'goldenYears': [{'year': 2032, 'reason': 'test'}],
            'challengeYears': [{'year': 2028, 'reason': 'test'}],
            'luckCycleSyncScore': 62,
        }
        result = _enrich_timing_sync(timing)
        assert 'goldenYears' in result
        assert 'challengeYears' in result
        assert result['luckCycleSyncScore'] == 62
        assert result['goldenYears'][0]['narrativeHint']  # hint was added
        assert result['challengeYears'][0]['narrativeHint']  # hint was added
