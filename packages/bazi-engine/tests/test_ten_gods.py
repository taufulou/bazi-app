"""
Tests for Ten Gods (十神) derivation.
"""

import pytest
from app.ten_gods import (
    IMBALANCE_WEIGHT_HIDDEN_BENQI,
    IMBALANCE_WEIGHT_HIDDEN_YUQI,
    IMBALANCE_WEIGHT_HIDDEN_ZHONGQI,
    IMBALANCE_WEIGHT_TRANSPARENT_ROOTED,
    IMBALANCE_WEIGHT_TRANSPARENT_ROOTLESS,
    IMBALANCE_WEIGHT_TRANSPARENT_WEAK_ROOT,
    compute_stem_pressure_weight,
    derive_ten_god,
    get_overcoming_stems_for_dm,
    get_prominent_ten_god,
    get_ten_god_distribution,
)


def _p(ys, yb, ms, mb, ds, db, hs, hb):
    """Build bare pillars dict with stems/branches for tests."""
    return {
        'year':  {'stem': ys, 'branch': yb},
        'month': {'stem': ms, 'branch': mb},
        'day':   {'stem': ds, 'branch': db},
        'hour':  {'stem': hs, 'branch': hb},
    }


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


class TestComputeStemPressureWeight:
    """Test compute_stem_pressure_weight — used by Fix 1b (and future Fix 1a)."""

    def test_transparent_rooted_benqi_only(self):
        """辛 transparent + 酉本氣 root → transparent_rooted weight + 本氣 weight."""
        # 辛 on year stem; 酉 (本氣=辛) on year branch.
        pillars = _p('辛', '酉', '丙', '寅', '甲', '午', '丁', '卯')
        result = compute_stem_pressure_weight('辛', pillars)
        assert result['transparent_count'] == 1
        assert result['has_strong_root'] is True
        assert 'benqi' in result['hidden_positions']
        # 1 transparent (rooted=3.0) + 本氣 (2.0) = 5.0
        assert result['total'] == pytest.approx(
            IMBALANCE_WEIGHT_TRANSPARENT_ROOTED + IMBALANCE_WEIGHT_HIDDEN_BENQI
        )

    def test_transparent_weak_root_yuqi_only(self):
        """Stem transparent with only 餘氣 root → weak_root tier."""
        # 丁 on month stem; 戌 hidden [戊本, 辛中, 丁餘]. 丁 餘氣 in 戌.
        # No other 丁 hidden elsewhere.
        pillars = _p('甲', '子', '丁', '戌', '戊', '辰', '壬', '申')
        result = compute_stem_pressure_weight('丁', pillars)
        assert result['transparent_count'] == 1
        assert result['has_strong_root'] is False
        assert result['has_weak_root'] is True
        # 1 transparent (weak_root=2.5) + 餘氣 (0.5) = 3.0
        assert result['total'] == pytest.approx(
            IMBALANCE_WEIGHT_TRANSPARENT_WEAK_ROOT + IMBALANCE_WEIGHT_HIDDEN_YUQI
        )

    def test_transparent_rootless(self):
        """Stem transparent with no hidden root anywhere → rootless (虛浮) tier."""
        # 辛 on year stem. No 酉/戌(中=辛)/丑(中=辛)/申(餘=辛) in chart.
        pillars = _p('辛', '子', '丙', '寅', '甲', '午', '丁', '卯')
        result = compute_stem_pressure_weight('辛', pillars)
        assert result['transparent_count'] == 1
        assert result['has_strong_root'] is False
        assert result['has_weak_root'] is False
        assert result['hidden_positions'] == []
        assert result['total'] == pytest.approx(IMBALANCE_WEIGHT_TRANSPARENT_ROOTLESS)

    def test_hidden_benqi_only(self):
        """Stem only in 本氣 藏干, not transparent → hidden weight only."""
        # 庚 藏在 申本氣. Not on any stem.
        pillars = _p('甲', '子', '丁', '丑', '甲', '午', '壬', '申')
        result = compute_stem_pressure_weight('庚', pillars)
        assert result['transparent_count'] == 0
        assert 'benqi' in result['hidden_positions']
        assert result['total'] == pytest.approx(IMBALANCE_WEIGHT_HIDDEN_BENQI)

    def test_hidden_zhongqi_only(self):
        """Stem only in 中氣 藏干 → hidden 中氣 weight."""
        # 辛 藏在 戌中氣 (戌=[戊,辛,丁]). Not on any stem. No 酉/丑(餘=辛)/申(餘=辛).
        pillars = _p('甲', '子', '丁', '戌', '甲', '午', '丙', '寅')
        result = compute_stem_pressure_weight('辛', pillars)
        assert result['transparent_count'] == 0
        assert result['hidden_positions'] == ['zhongqi']
        assert result['total'] == pytest.approx(IMBALANCE_WEIGHT_HIDDEN_ZHONGQI)

    def test_multiple_occurrences_accumulate(self):
        """Stem transparent + multiple hidden roots → weights sum."""
        # Laopo: 辛 透月干 + 丑中氣 + 申餘氣
        pillars = _p('丙', '寅', '辛', '丑', '甲', '戌', '壬', '申')
        result = compute_stem_pressure_weight('辛', pillars)
        assert result['transparent_count'] == 1
        assert result['has_strong_root'] is True  # 丑中氣 triggers strong
        assert 'zhongqi' in result['hidden_positions']
        assert 'yuqi' in result['hidden_positions']
        # transparent_rooted (3.0) + 中氣 (1.0) + 餘氣 (0.5) = 4.5
        expected = (
            IMBALANCE_WEIGHT_TRANSPARENT_ROOTED
            + IMBALANCE_WEIGHT_HIDDEN_ZHONGQI
            + IMBALANCE_WEIGHT_HIDDEN_YUQI
        )
        assert result['total'] == pytest.approx(expected)

    def test_absent_stem_returns_zero(self):
        """Stem not present anywhere → total=0, transparent=0, hidden=[]."""
        # 寅=甲丙戊, 卯=乙, 午=丁己, 巳=丙庚戊 — union: {甲乙丙丁戊己庚}. 辛 absent.
        pillars = _p('丙', '寅', '丁', '卯', '甲', '午', '乙', '巳')
        result = compute_stem_pressure_weight('辛', pillars)
        assert result['total'] == 0
        assert result['transparent_count'] == 0
        assert result['hidden_positions'] == []

    def test_rootless_transparent_beats_trace_hidden(self):
        """虛浮 透干 (1.5) still scores more than a single 餘氣 hidden (0.5)."""
        # Stem A: transparent rootless. Stem B: only in 餘氣.
        pa = _p('辛', '子', '丙', '寅', '甲', '午', '丁', '卯')
        a = compute_stem_pressure_weight('辛', pa)
        # 丑's 餘氣 = 辛, so put 丑 as a branch without 辛 elsewhere (and no 辛 on stems).
        pb = _p('丁', '丑', '丙', '寅', '甲', '午', '丁', '卯')
        b = compute_stem_pressure_weight('辛', pb)
        assert a['total'] == pytest.approx(IMBALANCE_WEIGHT_TRANSPARENT_ROOTLESS)
        # 丑's 辛 is 餘氣 (position 2)
        assert b['hidden_positions'] == ['yuqi']
        assert b['total'] == pytest.approx(IMBALANCE_WEIGHT_HIDDEN_YUQI)
        assert a['total'] > b['total'], '透干虛浮 should still weigh more than single 餘氣'

    def test_hidden_benqi_beats_transparent_rootless(self):
        """本氣藏干 (2.0) weighs more than 透干虛浮 (1.5) — 《滴天髓》虛花不久長."""
        pa = _p('辛', '子', '丙', '寅', '甲', '午', '丁', '卯')  # 辛 rootless transparent
        pb = _p('丁', '酉', '丙', '寅', '甲', '午', '戊', '子')  # 辛 in 酉 本氣 only
        a = compute_stem_pressure_weight('辛', pa)
        b = compute_stem_pressure_weight('辛', pb)
        assert b['total'] > a['total']


class TestGetOvercomingStemsForDm:
    """Test 正官/偏官 stem lookup per Day Master."""

    def test_jia_dm(self):
        """甲 DM: 正官=辛 (金陰, diff polarity), 偏官=庚 (金陽, same polarity)."""
        result = get_overcoming_stems_for_dm('甲')
        assert result['正官'] == '辛'
        assert result['偏官'] == '庚'

    def test_ding_dm(self):
        """丁 DM (火陰): 克我者=水. 正官=壬 (水陽, diff), 偏官=癸 (水陰, same)."""
        result = get_overcoming_stems_for_dm('丁')
        assert result['正官'] == '壬'
        assert result['偏官'] == '癸'

    def test_ji_dm(self):
        """己 DM (土陰): 克我者=木. 正官=甲 (diff), 偏官=乙 (same)."""
        result = get_overcoming_stems_for_dm('己')
        assert result['正官'] == '甲'
        assert result['偏官'] == '乙'
