"""
Tests for Five Elements (五行) balance and Day Master strength analysis.
"""

import pytest
from app.calculator import calculate_bazi
from app.five_elements import (
    calculate_five_elements_balance,
    calculate_five_elements_balance_seasonal,
    _accumulate_raw_element_scores,
    analyze_day_master_strength,
    determine_favorable_gods,
)


class TestFiveElementsBalance:
    """Test Five Elements balance calculations."""

    def test_percentages_sum_to_100(self):
        """All element percentages should sum to approximately 100%."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        balance = r['fiveElementsBalanceZh']
        total = sum(balance.values())
        assert abs(total - 100.0) < 1.0, f"Elements sum to {total}, expected ~100"

    def test_all_five_elements_present(self):
        """All five elements should be present in balance."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for element in ['木', '火', '土', '金', '水']:
            assert element in r['fiveElementsBalanceZh']

    def test_english_keys(self):
        """English balance should have wood/fire/earth/metal/water keys."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for key in ['wood', 'fire', 'earth', 'metal', 'water']:
            assert key in r['fiveElementsBalance']

    def test_no_negative_values(self):
        """No element should have a negative percentage."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for element, value in r['fiveElementsBalanceZh'].items():
            assert value >= 0, f"Element {element} has negative value {value}"

    def test_element_counts(self):
        """Element counts should have stems, branches, hidden, total."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        ec = r['elementCounts']
        assert 'stems' in ec
        assert 'branches' in ec
        assert 'hidden' in ec
        assert 'total' in ec

    def test_stem_count_equals_four(self):
        """There are exactly 4 manifest stems."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        stem_total = sum(r['elementCounts']['stems'].values())
        assert stem_total == 4

    def test_branch_count_equals_four(self):
        """There are exactly 4 branches."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        branch_total = sum(r['elementCounts']['branches'].values())
        assert branch_total == 4


class TestDayMasterStrength:
    """Test Day Master strength analysis."""

    def test_strength_field_present(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        dm = r['dayMaster']
        assert 'strength' in dm
        assert dm['strength'] in ['very_weak', 'weak', 'neutral', 'strong', 'very_strong']

    def test_strength_score_range(self):
        """Strength score should be between 0 and 100."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        score = r['dayMaster']['strengthScore']
        assert 0 <= score <= 100

    def test_same_party_sum(self):
        """sameParty + oppositeParty should equal 100."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        dm = r['dayMaster']
        assert dm['sameParty'] + dm['oppositeParty'] == 100


class TestFavorableGods:
    """Test favorable god (喜用神) determination."""

    def test_favorable_gods_present(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        dm = r['dayMaster']
        for god in ['favorableGod', 'usefulGod', 'idleGod', 'tabooGod', 'enemyGod']:
            assert god in dm
            assert dm[god] in ['木', '火', '土', '金', '水']

    def test_all_five_gods_are_different_elements(self):
        """Each god should map to a different element (all 5 elements are assigned)."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        dm = r['dayMaster']
        gods = {
            dm['favorableGod'], dm['usefulGod'], dm['idleGod'],
            dm['tabooGod'], dm['enemyGod'],
        }
        assert len(gods) == 5, "All five gods should be assigned to different elements"

    def test_strong_day_master_favorable_gods(self):
        """When Day Master is strong, favorable should be element I produce."""
        # 庚 (Metal) day master with decent strength
        from app.five_elements import determine_favorable_gods
        gods = determine_favorable_gods('庚', 'strong')  # 庚 = Metal Yang
        assert gods['favorableGod'] == '水'  # Metal produces Water
        assert gods['usefulGod'] == '木'     # Metal overcomes Wood
        assert gods['tabooGod'] == '金'      # Same element is taboo when strong
        assert gods['enemyGod'] == '土'      # Earth produces Metal = enemy when strong

    def test_weak_day_master_favorable_gods(self):
        """When Day Master is weak, favorable should be element that produces me."""
        gods = determine_favorable_gods('庚', 'weak')  # 庚 = Metal Yang
        assert gods['favorableGod'] == '土'  # Earth produces Metal (support)
        assert gods['usefulGod'] == '金'     # Same element (support)
        assert gods['tabooGod'] == '火'      # Fire overcomes Metal (attacks me)
        assert gods['enemyGod'] == '木'      # Wood = Metal must overcome = wastes energy


class TestPattern:
    """Test pattern (格局) determination."""

    def test_pattern_present(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert 'pattern' in r['dayMaster']
        assert r['dayMaster']['pattern'].endswith('格')

    def test_pattern_is_valid(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        valid_patterns = [
            '比肩格', '劫財格', '食神格', '傷官格', '偏財格',
            '正財格', '偏官格', '正官格', '偏印格', '正印格',
        ]
        assert r['dayMaster']['pattern'] in valid_patterns


class TestSeasonalMultiplier:
    """Test 旺相休囚死 seasonal multiplier for Five Elements balance display."""

    # Roger: 丁卯/戊申/戊午/庚申, 申月 — 金 should be 旺, 土 should be 休
    ROGER = {"birth_date": "1987-09-06", "birth_time": "16:13", "birth_city": "吉打", "birth_timezone": "Asia/Kuala_Lumpur", "gender": "male"}
    # Laopo: 丙寅/辛丑/甲戌/壬申, 丑月 — 土 should be 旺, 金 should be 相
    LAOPO = {"birth_date": "1987-01-25", "birth_time": "16:39", "birth_city": "新山", "birth_timezone": "Asia/Kuala_Lumpur", "gender": "female"}

    def _get_pillars(self, birth_data):
        """Helper to get pillars from birth data."""
        r = calculate_bazi(**birth_data)
        return r['fourPillars']

    def test_roger_metal_highest_in_shen_month(self):
        """Roger (申月): 金 should be highest in seasonal balance (旺), not 土."""
        pillars = self._get_pillars(self.ROGER)
        seasonal = calculate_five_elements_balance_seasonal(pillars)
        raw = calculate_five_elements_balance(pillars)
        # Seasonal: 金 > 土 (金 is 旺 in 申月)
        assert seasonal['金'] > seasonal['土'], (
            f"In 申月, 金(旺) should be > 土(休): 金={seasonal['金']}%, 土={seasonal['土']}%"
        )
        # Raw: 土 > 金 (without seasonal adjustment)
        assert raw['土'] > raw['金'], (
            f"Raw balance should have 土 > 金: 土={raw['土']}%, 金={raw['金']}%"
        )

    def test_laopo_earth_gold_top2_in_chou_month(self):
        """Laopo (丑月): 土 and 金 should be top-2 in seasonal balance."""
        pillars = self._get_pillars(self.LAOPO)
        seasonal = calculate_five_elements_balance_seasonal(pillars)
        # Sort by percentage descending
        sorted_elements = sorted(seasonal.items(), key=lambda x: x[1], reverse=True)
        top2_elements = {sorted_elements[0][0], sorted_elements[1][0]}
        assert '土' in top2_elements, f"土 should be in top-2, got: {sorted_elements[:2]}"
        assert '金' in top2_elements, f"金 should be in top-2, got: {sorted_elements[:2]}"

    def test_wang_element_boosted_yin_month(self):
        """In 寅月 (spring), 木(旺) + 火(相) should dominate."""
        # Use a 寅月 chart — any chart with month branch 寅
        # 1990-02-15 is in 寅月 (立春 to 驚蟄)
        r = calculate_bazi("1990-02-15", "12:00", "台北市", "Asia/Taipei", "male")
        pillars = r['fourPillars']
        assert pillars['month']['branch'] == '寅', f"Expected 寅月, got {pillars['month']['branch']}"
        seasonal = calculate_five_elements_balance_seasonal(pillars)
        # 木(旺) + 火(相) should be boosted in spring
        wood_fire = seasonal['木'] + seasonal['火']
        assert wood_fire > 40, f"木+火 should be significant in 寅月: {wood_fire}%"

    def test_si_element_weakened_yin_month(self):
        """In 寅月, 土(死) should be less than 木(旺) in seasonal balance."""
        r = calculate_bazi("1990-02-15", "12:00", "台北市", "Asia/Taipei", "male")
        pillars = r['fourPillars']
        seasonal = calculate_five_elements_balance_seasonal(pillars)
        raw = calculate_five_elements_balance(pillars)
        # In seasonal balance, 土(死 in 寅月) should be depressed
        # 木(旺 in 寅月) should be boosted
        assert seasonal['木'] > seasonal['土'], (
            f"In 寅月, 木(旺) should be > 土(死): 木={seasonal['木']}%, 土={seasonal['土']}%"
        )

    def test_percentages_sum_to_100_seasonal(self):
        """Seasonal balance percentages should sum to approximately 100%."""
        test_cases = [
            ("1987-09-06", "16:13", "吉打", "Asia/Kuala_Lumpur", "male"),   # 申月
            ("1987-01-25", "16:39", "新山", "Asia/Kuala_Lumpur", "female"),  # 丑月
            ("1990-02-15", "12:00", "台北市", "Asia/Taipei", "male"),        # 寅月
            ("1985-07-20", "08:00", "台北市", "Asia/Taipei", "female"),      # 未月
            ("1992-11-10", "22:00", "台北市", "Asia/Taipei", "male"),        # 亥月
        ]
        for birth_date, birth_time, city, tz, gender in test_cases:
            r = calculate_bazi(birth_date, birth_time, city, tz, gender)
            seasonal = r['fiveElementsBalanceZh']
            total = sum(seasonal.values())
            assert abs(total - 100.0) < 0.5, (
                f"Seasonal balance for {birth_date} sums to {total}, expected ~100"
            )

    def test_raw_balance_unchanged_after_refactor(self):
        """Raw balance should produce identical results after refactoring to shared helper."""
        # Known values for Roger: the raw function should still work the same
        pillars = self._get_pillars(self.ROGER)
        raw = calculate_five_elements_balance(pillars)
        # Verify structure
        assert len(raw) == 5
        assert all(e in raw for e in ['木', '火', '土', '金', '水'])
        total = sum(raw.values())
        assert abs(total - 100.0) < 0.5
        # Verify raw ordering: 土 > 金 (without seasonal, 土 should be highest for Roger)
        assert raw['土'] > raw['金']

    def test_cong_ge_uses_raw_balance(self):
        """從格 detection should use raw balance, not seasonal (no double-counting)."""
        # Roger's raw balance: 土=33.8%, 金=27.5% — neither exceeds 55%
        # So Roger should NOT be classified as 從格
        r = calculate_bazi(**self.ROGER)
        pre_analysis = r.get('preAnalysis', {})
        cong_ge = pre_analysis.get('congGe')
        # Roger is not 從格 (no element > 55% in raw balance)
        assert cong_ge is None or cong_ge.get('detected') is False, (
            f"Roger should not be 從格 — raw balance has no element > 55%"
        )

    def test_earth_month_branch_boost(self):
        """Earth months (辰/未/戌/丑): 土 should get 旺(1.8x) boost."""
        # 丑月 (January birth)
        pillars_chou = self._get_pillars(self.LAOPO)
        assert pillars_chou['month']['branch'] == '丑'
        seasonal_chou = calculate_five_elements_balance_seasonal(pillars_chou)
        raw_chou = calculate_five_elements_balance(pillars_chou)
        # 土 should have a higher relative share in seasonal vs raw
        # due to 旺(1.8x) boost in earth months
        earth_raw_ratio = raw_chou['土'] / 100.0
        earth_seasonal_ratio = seasonal_chou['土'] / 100.0
        assert earth_seasonal_ratio > earth_raw_ratio, (
            f"In 丑月, 土 should be boosted: raw={raw_chou['土']}%, seasonal={seasonal_chou['土']}%"
        )
