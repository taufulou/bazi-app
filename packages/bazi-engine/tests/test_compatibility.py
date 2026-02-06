"""
Tests for Bazi Compatibility (合盤) calculation.
"""

import pytest
from app.calculator import calculate_bazi, calculate_bazi_compatibility


class TestCompatibilityStructure:
    """Test compatibility output structure."""

    @pytest.fixture
    def compat_result(self):
        return calculate_bazi_compatibility(
            birth_data_a={
                'birth_date': '1990-05-15',
                'birth_time': '14:30',
                'birth_city': '台北市',
                'birth_timezone': 'Asia/Taipei',
                'gender': 'male',
            },
            birth_data_b={
                'birth_date': '1992-08-20',
                'birth_time': '10:00',
                'birth_city': '香港',
                'birth_timezone': 'Asia/Hong_Kong',
                'gender': 'female',
            },
            comparison_type='romance',
        )

    def test_has_both_charts(self, compat_result):
        assert 'chartA' in compat_result
        assert 'chartB' in compat_result
        assert 'compatibility' in compat_result

    def test_charts_are_complete(self, compat_result):
        for chart_key in ['chartA', 'chartB']:
            chart = compat_result[chart_key]
            assert 'fourPillars' in chart
            assert 'dayMaster' in chart
            assert 'fiveElementsBalance' in chart

    def test_compatibility_fields(self, compat_result):
        c = compat_result['compatibility']
        assert 'overallScore' in c
        assert 'level' in c
        assert 'levelZh' in c
        assert 'dayMasterInteraction' in c
        assert 'stemCombination' in c
        assert 'strengths' in c
        assert 'challenges' in c

    def test_score_range(self, compat_result):
        score = compat_result['compatibility']['overallScore']
        assert 0 <= score <= 100

    def test_level_valid(self, compat_result):
        level = compat_result['compatibility']['level']
        assert level in ['excellent', 'good', 'average', 'challenging', 'difficult']

    def test_comparison_type_preserved(self, compat_result):
        assert compat_result['compatibility']['comparisonType'] == 'romance'


class TestCompatibilityLogic:
    """Test compatibility calculation logic."""

    def test_same_person_high_score(self):
        """Comparing someone with themselves should score high."""
        result = calculate_bazi_compatibility(
            birth_data_a={
                'birth_date': '1990-05-15',
                'birth_time': '14:30',
                'birth_city': '台北市',
                'birth_timezone': 'Asia/Taipei',
                'gender': 'male',
            },
            birth_data_b={
                'birth_date': '1990-05-15',
                'birth_time': '14:30',
                'birth_city': '台北市',
                'birth_timezone': 'Asia/Taipei',
                'gender': 'female',
            },
            comparison_type='romance',
        )
        # Same chart elements should have high complementarity
        score = result['compatibility']['overallScore']
        assert score >= 50  # Same elements = at least average

    def test_element_complementarity(self):
        """Element complementarity should show balanced or imbalanced data."""
        result = calculate_bazi_compatibility(
            birth_data_a={
                'birth_date': '1990-05-15',
                'birth_time': '14:30',
                'birth_city': '台北市',
                'birth_timezone': 'Asia/Taipei',
                'gender': 'male',
            },
            birth_data_b={
                'birth_date': '1992-08-20',
                'birth_time': '10:00',
                'birth_city': '香港',
                'birth_timezone': 'Asia/Hong_Kong',
                'gender': 'female',
            },
        )
        ec = result['compatibility']['elementComplementarity']
        for element in ['木', '火', '土', '金', '水']:
            assert element in ec
            assert 'personA' in ec[element]
            assert 'personB' in ec[element]
            assert 'combined' in ec[element]

    def test_business_comparison_type(self):
        """Business comparison should work."""
        result = calculate_bazi_compatibility(
            birth_data_a={
                'birth_date': '1990-05-15',
                'birth_time': '14:30',
                'birth_city': '台北市',
                'birth_timezone': 'Asia/Taipei',
                'gender': 'male',
            },
            birth_data_b={
                'birth_date': '1985-03-20',
                'birth_time': '08:00',
                'birth_city': '香港',
                'birth_timezone': 'Asia/Hong_Kong',
                'gender': 'male',
            },
            comparison_type='business',
        )
        assert result['compatibility']['comparisonType'] == 'business'
        assert result['compatibility']['overallScore'] >= 0

    def test_stem_combination_detection(self):
        """Test that stem combinations (天干合) are detected."""
        # 甲己合化土 — find two people where Day Masters are 甲 and 己
        from app.compatibility import analyze_stem_combination
        combo = analyze_stem_combination('甲', '己')
        assert combo['hasCombination'] is True
        assert combo['resultElement'] == '土'

    def test_no_stem_combination(self):
        from app.compatibility import analyze_stem_combination
        combo = analyze_stem_combination('甲', '庚')
        assert combo['hasCombination'] is False

    def test_six_harmony_detection(self):
        from app.compatibility import analyze_branch_relationship
        rels = analyze_branch_relationship('子', '丑')
        harmony = [r for r in rels if r['type'] == 'six_harmony']
        assert len(harmony) == 1
        assert harmony[0]['effect'] == 'positive'

    def test_six_clash_detection(self):
        from app.compatibility import analyze_branch_relationship
        rels = analyze_branch_relationship('子', '午')
        clash = [r for r in rels if r['type'] == 'six_clash']
        assert len(clash) == 1
        assert clash[0]['effect'] == 'negative'

    def test_six_harm_detection(self):
        from app.compatibility import analyze_branch_relationship
        rels = analyze_branch_relationship('子', '未')
        harm = [r for r in rels if r['type'] == 'six_harm']
        assert len(harm) == 1
        assert harm[0]['effect'] == 'negative'
