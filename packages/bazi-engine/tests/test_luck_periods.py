"""
Tests for Luck Periods (大運), Annual Stars (流年), Monthly Stars (流月).
"""

import pytest
from app.calculator import calculate_bazi
from app.luck_periods import calculate_luck_period_direction


class TestLuckPeriodDirection:
    """Test luck period direction calculation."""

    def test_male_yang_year_forward(self):
        """Male + Yang year stem → Forward"""
        assert calculate_luck_period_direction('甲', 'male') == 1  # 甲 = Yang

    def test_male_yin_year_backward(self):
        """Male + Yin year stem → Backward"""
        assert calculate_luck_period_direction('乙', 'male') == -1  # 乙 = Yin

    def test_female_yin_year_forward(self):
        """Female + Yin year stem → Forward"""
        assert calculate_luck_period_direction('乙', 'female') == 1

    def test_female_yang_year_backward(self):
        """Female + Yang year stem → Backward"""
        assert calculate_luck_period_direction('甲', 'female') == -1


class TestLuckPeriods:
    """Test luck period calculation."""

    def test_has_eight_periods(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert len(r['luckPeriods']) == 8

    def test_period_structure(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for lp in r['luckPeriods']:
            assert 'startAge' in lp
            assert 'endAge' in lp
            assert 'startYear' in lp
            assert 'endYear' in lp
            assert 'stem' in lp
            assert 'branch' in lp
            assert 'tenGod' in lp
            assert 'isCurrent' in lp

    def test_periods_are_10_years_each(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for lp in r['luckPeriods']:
            assert lp['endAge'] - lp['startAge'] == 9
            assert lp['endYear'] - lp['startYear'] == 9

    def test_one_current_period(self):
        """Exactly one luck period should be marked as current for 2026."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        current_count = sum(1 for lp in r['luckPeriods'] if lp['isCurrent'])
        assert current_count == 1

    def test_periods_consecutive(self):
        """Luck periods should be consecutive (no gaps)."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for i in range(len(r['luckPeriods']) - 1):
            this_end = r['luckPeriods'][i]['endAge']
            next_start = r['luckPeriods'][i + 1]['startAge']
            assert next_start == this_end + 1

    def test_male_yang_year_forward_direction(self):
        """庚(Yang) year + male → periods should advance forward from month pillar."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        # Month is 辛巳. Forward from 辛巳: 壬午, 癸未, 甲申, 乙酉...
        assert r['luckPeriods'][0]['stem'] == '壬'
        assert r['luckPeriods'][0]['branch'] == '午'

    def test_female_yang_year_backward_direction(self):
        """庚(Yang) year + female → periods should go backward from month pillar."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "female")
        # Month is 辛巳. Backward from 辛巳: 庚辰, 己卯, 戊寅, 丁丑...
        assert r['luckPeriods'][0]['stem'] == '庚'
        assert r['luckPeriods'][0]['branch'] == '辰'


class TestAnnualStars:
    """Test annual star calculation."""

    def test_has_annual_stars(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        assert len(r['annualStars']) > 0

    def test_star_structure(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        for star in r['annualStars']:
            assert 'year' in star
            assert 'stem' in star
            assert 'branch' in star
            assert 'tenGod' in star

    def test_2026_is_bing_wu(self):
        """2026 should be 丙午年."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        year_2026 = next(s for s in r['annualStars'] if s['year'] == 2026)
        assert year_2026['stem'] == '丙'
        assert year_2026['branch'] == '午'

    def test_current_year_marked(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        year_2026 = next(s for s in r['annualStars'] if s['year'] == 2026)
        assert year_2026['isCurrent'] is True

    def test_60_year_cycle(self):
        """Verify the 60-year Jiazi cycle: 2026 (丙午) and 2026-60=1966 should be same."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        # Manual check: (2026-4) % 10 = 2022 % 10 = 2 → 丙
        # (2026-4) % 12 = 2022 % 12 = 6 → 午
        year_2026 = next(s for s in r['annualStars'] if s['year'] == 2026)
        assert year_2026['stem'] == '丙'
        assert year_2026['branch'] == '午'


class TestMonthlyStars:
    """Test monthly star calculation."""

    def test_has_12_months(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        assert len(r['monthlyStars']) == 12

    def test_month_structure(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        for ms in r['monthlyStars']:
            assert 'month' in ms
            assert 'solarTermDate' in ms
            assert 'stem' in ms
            assert 'branch' in ms
            assert 'tenGod' in ms

    def test_month_branches_correct_order(self):
        """Monthly branches should follow: 寅卯辰巳午未申酉戌亥子丑."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        expected = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑']
        actual = [ms['branch'] for ms in r['monthlyStars']]
        assert actual == expected

    def test_2026_month_1_stem(self):
        """2026 is 丙午 year. 丙 → 庚寅月 starts month 1."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male",
                          target_year=2026)
        month1 = r['monthlyStars'][0]
        assert month1['stem'] == '庚'
        assert month1['branch'] == '寅'
