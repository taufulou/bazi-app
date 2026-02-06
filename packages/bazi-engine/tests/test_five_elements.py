"""
Tests for Five Elements (五行) balance and Day Master strength analysis.
"""

import pytest
from app.calculator import calculate_bazi
from app.five_elements import (
    calculate_five_elements_balance,
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
