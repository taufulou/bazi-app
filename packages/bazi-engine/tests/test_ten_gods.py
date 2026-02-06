"""
Tests for Ten Gods (十神) derivation.
"""

import pytest
from app.ten_gods import derive_ten_god, get_ten_god_distribution, get_prominent_ten_god


class TestTenGodDerivation:
    """Test individual Ten God derivations."""

    def test_same_element_same_polarity(self):
        """甲 vs 甲 → 比肩 (both Yang Wood)"""
        assert derive_ten_god('甲', '甲') == '比肩'

    def test_same_element_diff_polarity(self):
        """甲 vs 乙 → 劫財 (Yang Wood vs Yin Wood)"""
        assert derive_ten_god('甲', '乙') == '劫財'

    def test_i_produce_same_polarity(self):
        """甲(木) vs 丙(火) → 食神 (Wood produces Fire, both Yang)"""
        assert derive_ten_god('甲', '丙') == '食神'

    def test_i_produce_diff_polarity(self):
        """甲(木) vs 丁(火) → 傷官 (Wood produces Fire, Yang vs Yin)"""
        assert derive_ten_god('甲', '丁') == '傷官'

    def test_i_overcome_same_polarity(self):
        """甲(木) vs 戊(土) → 偏財 (Wood overcomes Earth, both Yang)"""
        assert derive_ten_god('甲', '戊') == '偏財'

    def test_i_overcome_diff_polarity(self):
        """甲(木) vs 己(土) → 正財 (Wood overcomes Earth, Yang vs Yin)"""
        assert derive_ten_god('甲', '己') == '正財'

    def test_overcomes_me_same_polarity(self):
        """甲(木) vs 庚(金) → 偏官 (Metal overcomes Wood, both Yang)"""
        assert derive_ten_god('甲', '庚') == '偏官'

    def test_overcomes_me_diff_polarity(self):
        """甲(木) vs 辛(金) → 正官 (Metal overcomes Wood, Yang vs Yin)"""
        assert derive_ten_god('甲', '辛') == '正官'

    def test_produces_me_same_polarity(self):
        """甲(木) vs 壬(水) → 偏印 (Water produces Wood, both Yang)"""
        assert derive_ten_god('甲', '壬') == '偏印'

    def test_produces_me_diff_polarity(self):
        """甲(木) vs 癸(水) → 正印 (Water produces Wood, Yang vs Yin)"""
        assert derive_ten_god('甲', '癸') == '正印'

    def test_all_ten_gods_from_jia(self):
        """Verify all 10 Ten Gods can be derived from 甲 Day Master."""
        expected = {
            '甲': '比肩', '乙': '劫財',
            '丙': '食神', '丁': '傷官',
            '戊': '偏財', '己': '正財',
            '庚': '偏官', '辛': '正官',
            '壬': '偏印', '癸': '正印',
        }
        for stem, expected_god in expected.items():
            assert derive_ten_god('甲', stem) == expected_god, \
                f"甲 vs {stem}: expected {expected_god}, got {derive_ten_god('甲', stem)}"

    def test_all_ten_gods_from_geng(self):
        """Verify all 10 Ten Gods from 庚 (Metal Yang) Day Master."""
        expected = {
            '庚': '比肩', '辛': '劫財',
            '壬': '食神', '癸': '傷官',
            '甲': '偏財', '乙': '正財',
            '丙': '偏官', '丁': '正官',
            '戊': '偏印', '己': '正印',
        }
        for stem, expected_god in expected.items():
            assert derive_ten_god('庚', stem) == expected_god


class TestTenGodDistribution:
    """Test Ten God distribution across a chart."""

    def test_distribution_counts(self):
        """Distribution should count all stems (manifest + hidden) except Day Master."""
        from app.calculator import calculate_bazi
        result = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        dist = result['tenGodDistribution']

        # Should have some entries
        assert len(dist) > 0

        # Total count should be: 3 manifest stems (year/month/hour) + all hidden stems
        total = sum(dist.values())
        # 3 manifest + hidden stems from all 4 branches
        assert total > 3  # Must be more than just manifest stems
