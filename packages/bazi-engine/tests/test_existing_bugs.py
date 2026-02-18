"""
Tests verifying the 3 existing engine bug fixes from Phase 11B.

Bug 1: TIANYI_GUIREN 庚 entry was ['丑','未'] → fixed to ['寅','午']
Bug 2: SEASON_STRENGTH had 30+ wrong cells → full table replaced with canonical 旺相休囚死
Bug 3: get_prominent_ten_god() missing 透干 priority check → added
"""

import pytest
from app.constants import SEASON_STRENGTH, TIANYI_GUIREN
from app.ten_gods import get_prominent_ten_god


# ============================================================
# Bug 1: TIANYI_GUIREN 庚 entry
# ============================================================

class TestTianyiGuirenGeng:
    """
    Verify 庚 天乙貴人 is ['寅','午'] (modern practice).

    Source: Modern practice "庚辛逢虎馬" — widely used in apps.
    Alternative orthodox version (《三命通會》): 庚→['丑','未']
    """

    def test_geng_maps_to_yin_wu(self):
        """庚 → 寅午 (not 丑未)."""
        assert TIANYI_GUIREN['庚'] == ['寅', '午']

    def test_xin_also_yin_wu(self):
        """辛 → 寅午 (same as 庚 in modern practice)."""
        assert TIANYI_GUIREN['辛'] == ['寅', '午']

    def test_jia_wu_unchanged(self):
        """甲戊 → 丑未 (not affected by fix)."""
        assert TIANYI_GUIREN['甲'] == ['丑', '未']
        assert TIANYI_GUIREN['戊'] == ['丑', '未']


# ============================================================
# Bug 2: SEASON_STRENGTH canonical table
# ============================================================

class TestSeasonStrengthCanonical:
    """
    Verify SEASON_STRENGTH matches the canonical 旺相休囚死 table.

    Rules:
      当令者旺(5), 令生者相(4), 生令者休(3), 克令者囚(2), 令克者死(1)

    Source: 《子平真詮·論旺相休囚死》, confirmed by 百度百科, 三命通會卷二
    """

    def test_metal_in_water_season_is_xiu(self):
        """金 in 亥/子 (Water season) = 休(3), NOT 相(4)."""
        # Metal produces Water → Metal rests (休) in Water season
        assert SEASON_STRENGTH['金']['亥'] == 3
        assert SEASON_STRENGTH['金']['子'] == 3

    def test_wood_spring_is_wang(self):
        """木 in 寅/卯 = 旺(5) — Wood is strongest in Spring."""
        assert SEASON_STRENGTH['木']['寅'] == 5
        assert SEASON_STRENGTH['木']['卯'] == 5

    def test_fire_summer_is_wang(self):
        """火 in 巳/午 = 旺(5)."""
        assert SEASON_STRENGTH['火']['巳'] == 5
        assert SEASON_STRENGTH['火']['午'] == 5

    def test_earth_in_earth_months_is_wang(self):
        """土 in 辰/未/戌/丑 = 旺(5)."""
        for branch in ['辰', '未', '戌', '丑']:
            assert SEASON_STRENGTH['土'][branch] == 5

    def test_metal_autumn_is_wang(self):
        """金 in 申/酉 = 旺(5)."""
        assert SEASON_STRENGTH['金']['申'] == 5
        assert SEASON_STRENGTH['金']['酉'] == 5

    def test_water_winter_is_wang(self):
        """水 in 亥/子 = 旺(5)."""
        assert SEASON_STRENGTH['水']['亥'] == 5
        assert SEASON_STRENGTH['水']['子'] == 5

    def test_no_zeros_in_table(self):
        """Canonical system has NO zeros — minimum is 1 (死)."""
        for element, branches in SEASON_STRENGTH.items():
            for branch, score in branches.items():
                assert score >= 1, f"{element} in {branch} has score {score} (should be ≥1)"

    def test_column_sums_to_15(self):
        """Each branch column sums to exactly 15 (旺相休囚死 = 5+4+3+2+1)."""
        all_branches = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑']
        elements = ['木', '火', '土', '金', '水']
        for branch in all_branches:
            col_sum = sum(SEASON_STRENGTH[el][branch] for el in elements)
            assert col_sum == 15, f"Column {branch} sums to {col_sum}, expected 15"

    def test_each_element_uses_all_scores(self):
        """Each element row uses scores 1-5 (distributed across 12 branches)."""
        elements = ['木', '火', '土', '金', '水']
        for element in elements:
            scores = set(SEASON_STRENGTH[element].values())
            assert scores == {1, 2, 3, 4, 5}, f"{element} has scores {scores}, expected {{1,2,3,4,5}}"

    def test_overcoming_is_qiu(self):
        """Element that 克令 (overcomes the season element) = 囚(2)."""
        # 木 overcomes 土 → 木 in earth months (辰未戌丑) should be 囚(2)
        assert SEASON_STRENGTH['木']['辰'] == 2
        assert SEASON_STRENGTH['木']['未'] == 2
        assert SEASON_STRENGTH['木']['戌'] == 2
        assert SEASON_STRENGTH['木']['丑'] == 2

    def test_overcome_by_season_is_si(self):
        """Element that 令克 (season overcomes it) = 死(1)."""
        # Spring(木) overcomes 土 → 土 in Spring = 死(1)
        assert SEASON_STRENGTH['土']['寅'] == 1
        assert SEASON_STRENGTH['土']['卯'] == 1

    def test_producing_season_is_xiu(self):
        """Element that 生令 (produces the season element) = 休(3)."""
        # 木 produces 火 → 木 in Summer(巳午) = 休(3)
        assert SEASON_STRENGTH['木']['巳'] == 3
        assert SEASON_STRENGTH['木']['午'] == 3

    def test_produced_by_season_is_xiang(self):
        """Element that 令生 (season produces it) = 相(4)."""
        # Spring(木) produces 火 → 火 in Spring = 相(4)
        assert SEASON_STRENGTH['火']['寅'] == 4
        assert SEASON_STRENGTH['火']['卯'] == 4


# ============================================================
# Bug 3: get_prominent_ten_god() 透干 priority
# ============================================================

class TestProminentTenGodTougan:
    """
    Verify 透干 priority: hidden stems that appear as manifest stems
    take precedence over 本氣 alone.

    Source: 《子平真詮》— "月支之神，透干者取之"
    """

    def test_tougan_takes_priority_over_benqi(self):
        """
        When a month branch hidden stem also appears as a manifest stem,
        that god takes priority.

        Example: Month branch 申 has hidden stems [庚, 壬, 戊].
        If 壬 (中氣) appears as year stem, the 壬-derived god takes priority
        over 庚-derived god (本氣).
        """
        # Day Master: 甲
        # Month branch: 申 → hidden: [庚, 壬, 戊]
        # Year stem: 壬 (matches 壬 in hidden stems → 壬 透干)
        # 庚 relative to 甲 = 偏官
        # 壬 relative to 甲 = 偏印
        # Without 透干 fix: would return 偏官 (庚 is 本氣)
        # With 透干 fix: 壬 is transparent, should return 偏印
        pillars = {
            'year':  {'stem': '壬', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '申'},
            'day':   {'stem': '甲', 'branch': '午'},
            'hour':  {'stem': '丁', 'branch': '卯'},
        }
        result = get_prominent_ten_god(pillars, '甲')
        assert result == '偏印'  # 壬 透干 takes priority

    def test_benqi_used_when_no_tougan(self):
        """When no hidden stem is transparent, use 本氣 as before."""
        # Month branch 申 → hidden: [庚, 壬, 戊]
        # No manifest stem matches any of these
        pillars = {
            'year':  {'stem': '丁', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '申'},
            'day':   {'stem': '甲', 'branch': '午'},
            'hour':  {'stem': '乙', 'branch': '卯'},
        }
        result = get_prominent_ten_god(pillars, '甲')
        # 庚 (本氣 of 申) relative to 甲 = 偏官
        assert result == '偏官'

    def test_benqi_bijie_skipped_for_tougan(self):
        """If 本氣 is 比肩/劫財 but a hidden stem 透干, use the transparent one."""
        # Day Master: 庚
        # Month branch 申 → hidden: [庚, 壬, 戊]
        # 庚 relative to 庚 = 比肩 (skipped)
        # 壬 in year stem → 壬 透干, relative to 庚 = 食神
        pillars = {
            'year':  {'stem': '壬', 'branch': '子'},
            'month': {'stem': '甲', 'branch': '申'},
            'day':   {'stem': '庚', 'branch': '午'},
            'hour':  {'stem': '丁', 'branch': '卯'},
        }
        result = get_prominent_ten_god(pillars, '庚')
        assert result == '食神'  # 壬 透干, and 壬 relative to 庚 = 食神

    def test_month_stem_still_checked(self):
        """Month manifest stem is still checked if hidden stems don't resolve."""
        # Month branch 卯 → hidden: [乙]
        # Day Master 甲: 乙 = 劫財 (skipped because 比肩/劫財)
        # Month stem 丙: 丙 relative to 甲 = 食神
        pillars = {
            'year':  {'stem': '壬', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '卯'},
            'day':   {'stem': '甲', 'branch': '午'},
            'hour':  {'stem': '丁', 'branch': '酉'},
        }
        result = get_prominent_ten_god(pillars, '甲')
        # 乙 (本氣 of 卯) = 劫財 → skipped
        # Check 透干: 壬 in year matches? 壬 not in 卯 hidden stems [乙], so no
        # → use month stem 丙 = 食神
        assert result == '食神'
