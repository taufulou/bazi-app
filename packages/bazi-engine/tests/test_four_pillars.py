"""
Tests for Four Pillars (四柱) calculation.
Uses known birth charts validated against 萬年曆 (Ten Thousand Year Calendar).
"""

import pytest
from app.calculator import calculate_bazi


class TestFourPillarsKnownCharts:
    """
    Golden reference charts — validated against known Bazi references.
    Each test verifies the Year/Month/Day/Hour GanZhi (干支).
    """

    def test_chart_1990_05_15_taipei(self):
        """Known chart: 1990-05-15 14:30 Taipei Male"""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert r['ganZhi']['year'] == '庚午'
        assert r['ganZhi']['month'] == '辛巳'
        assert r['ganZhi']['day'] == '庚辰'
        # Hour pillar uses True Solar Time (14:30 + ~10min = 14:40, still 未時)
        assert r['ganZhi']['hour'] == '癸未'

    def test_chart_2000_01_01_taipei(self):
        """Known chart: 2000-01-01 00:00 Taipei Female"""
        r = calculate_bazi("2000-01-01", "00:00", "台北市", "Asia/Taipei", "female")
        assert r['ganZhi']['year'] == '己卯'  # Before 立春, still 己卯 year
        assert r['ganZhi']['day'] is not None

    def test_chart_1985_03_20_hk(self):
        """Known chart: 1985-03-20 08:00 Hong Kong Male"""
        r = calculate_bazi("1985-03-20", "08:00", "香港", "Asia/Hong_Kong", "male")
        assert r['ganZhi']['year'] == '乙丑'
        # March 20 is after 驚蟄, so month is 卯 month
        month_branch = r['fourPillars']['month']['branch']
        assert month_branch == '卯'

    def test_chart_leap_year(self):
        """Test a leap year date."""
        r = calculate_bazi("2000-02-29", "12:00", "台北市", "Asia/Taipei", "male")
        assert r['ganZhi']['year'] is not None
        assert r['ganZhi']['day'] is not None

    def test_year_boundary_before_lichun(self):
        """Before 立春 (~Feb 4), the Bazi year is still the previous year."""
        r = calculate_bazi("2026-02-03", "12:00", "台北市", "Asia/Taipei", "male")
        year_branch = r['fourPillars']['year']['branch']
        # Before 立春 2026 (Feb 4), should still be 乙巳 year
        assert r['ganZhi']['year'] == '乙巳'

    def test_year_boundary_after_lichun(self):
        """After 立春 (~Feb 4), the Bazi year changes."""
        r = calculate_bazi("2026-02-05", "12:00", "台北市", "Asia/Taipei", "male")
        # After 立春 2026, should be 丙午 year
        assert r['ganZhi']['year'] == '丙午'

    def test_different_cities_same_time(self):
        """Different cities should give different True Solar Times."""
        r_taipei = calculate_bazi("2026-06-15", "12:00", "台北市", "Asia/Taipei", "male")
        r_beijing = calculate_bazi("2026-06-15", "12:00", "北京", "Asia/Shanghai", "male")

        taipei_tst = r_taipei['trueSolarTime']['trueSolarTime']
        beijing_tst = r_beijing['trueSolarTime']['trueSolarTime']
        assert taipei_tst != beijing_tst

    def test_midnight_zi_hour(self):
        """23:00-00:59 should be 子時."""
        r = calculate_bazi("2026-06-15", "23:30", "台北市", "Asia/Taipei", "male")
        assert r['fourPillars']['hour']['branch'] == '子'

    def test_early_morning_zi_hour(self):
        """00:30 should still be 子時."""
        r = calculate_bazi("2026-06-15", "00:30", "台北市", "Asia/Taipei", "male")
        assert r['fourPillars']['hour']['branch'] == '子'


class TestFourPillarsStructure:
    """Test the structure and completeness of the four pillars output."""

    @pytest.fixture
    def sample_chart(self):
        return calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")

    def test_has_all_pillars(self, sample_chart):
        assert 'year' in sample_chart['fourPillars']
        assert 'month' in sample_chart['fourPillars']
        assert 'day' in sample_chart['fourPillars']
        assert 'hour' in sample_chart['fourPillars']

    def test_pillar_has_stem_and_branch(self, sample_chart):
        for name in ['year', 'month', 'day', 'hour']:
            pillar = sample_chart['fourPillars'][name]
            assert 'stem' in pillar
            assert 'branch' in pillar
            assert len(pillar['stem']) == 1  # Single Chinese character
            assert len(pillar['branch']) == 1

    def test_pillar_has_elements(self, sample_chart):
        for name in ['year', 'month', 'day', 'hour']:
            pillar = sample_chart['fourPillars'][name]
            assert pillar['stemElement'] in ['木', '火', '土', '金', '水']
            assert pillar['branchElement'] in ['木', '火', '土', '金', '水']

    def test_pillar_has_yinyang(self, sample_chart):
        for name in ['year', 'month', 'day', 'hour']:
            pillar = sample_chart['fourPillars'][name]
            assert pillar['stemYinYang'] in ['陰', '陽']

    def test_pillar_has_hidden_stems(self, sample_chart):
        for name in ['year', 'month', 'day', 'hour']:
            pillar = sample_chart['fourPillars'][name]
            assert isinstance(pillar['hiddenStems'], list)
            assert len(pillar['hiddenStems']) >= 1

    def test_pillar_has_nayin(self, sample_chart):
        for name in ['year', 'month', 'day', 'hour']:
            pillar = sample_chart['fourPillars'][name]
            assert isinstance(pillar['naYin'], str)
            assert len(pillar['naYin']) > 0

    def test_day_pillar_ten_god_is_none(self, sample_chart):
        """Day pillar's Ten God should be None (it's the Day Master)."""
        assert sample_chart['fourPillars']['day']['tenGod'] is None

    def test_other_pillars_have_ten_god(self, sample_chart):
        for name in ['year', 'month', 'hour']:
            pillar = sample_chart['fourPillars'][name]
            assert pillar['tenGod'] is not None

    def test_has_lunar_date(self, sample_chart):
        ld = sample_chart['lunarDate']
        assert 'year' in ld
        assert 'month' in ld
        assert 'day' in ld
        assert 'isLeapMonth' in ld

    def test_has_true_solar_time(self, sample_chart):
        tst = sample_chart['trueSolarTime']
        assert 'clockTime' in tst
        assert 'trueSolarTime' in tst
        assert 'longitudeOffset' in tst
        assert 'equationOfTime' in tst
        assert 'totalAdjustment' in tst

    def test_has_ganZhi(self, sample_chart):
        gz = sample_chart['ganZhi']
        assert 'year' in gz
        assert 'month' in gz
        assert 'day' in gz
        assert 'hour' in gz
        # Each GanZhi should be 2 characters
        for key in ['year', 'month', 'day', 'hour']:
            assert len(gz[key]) == 2


class TestFourPillarsPerformance:
    """Test calculation performance."""

    def test_calculation_under_50ms(self):
        """Single calculation should complete in under 50ms."""
        import time
        start = time.perf_counter()
        calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        elapsed = (time.perf_counter() - start) * 1000
        assert elapsed < 50, f"Calculation took {elapsed:.2f}ms (should be <50ms)"

    def test_100_calculations_under_5s(self):
        """100 calculations should complete in under 5 seconds."""
        import time
        start = time.perf_counter()
        for i in range(100):
            year = 1950 + (i % 80)
            month = (i % 12) + 1
            day = (i % 28) + 1
            hour = (i % 24)
            calculate_bazi(
                f"{year}-{month:02d}-{day:02d}",
                f"{hour:02d}:00",
                "台北市",
                "Asia/Taipei",
                "male" if i % 2 == 0 else "female",
            )
        elapsed = time.perf_counter() - start
        assert elapsed < 5, f"100 calculations took {elapsed:.2f}s (should be <5s)"
