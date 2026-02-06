"""
Tests for True Solar Time (真太陽時) calculation.
Verifies longitude correction, Equation of Time, and DST handling.
"""

import pytest
from app.solar_time import (
    calculate_equation_of_time,
    calculate_true_solar_time,
    get_city_coordinates,
    get_timezone_offset_hours,
)
from datetime import datetime


class TestCityCoordinates:
    """Test city coordinate lookup."""

    def test_taipei_exact(self):
        lng, lat = get_city_coordinates("台北市")
        assert abs(lng - 121.5654) < 0.01
        assert abs(lat - 25.033) < 0.01

    def test_taipei_short(self):
        lng, lat = get_city_coordinates("台北")
        assert abs(lng - 121.5654) < 0.01

    def test_hong_kong(self):
        lng, lat = get_city_coordinates("香港")
        assert abs(lng - 114.1694) < 0.01

    def test_kuala_lumpur(self):
        lng, lat = get_city_coordinates("吉隆坡")
        assert abs(lng - 101.6869) < 0.01

    def test_beijing(self):
        lng, lat = get_city_coordinates("北京")
        assert abs(lng - 116.4074) < 0.01

    def test_english_name(self):
        lng, lat = get_city_coordinates("Taipei")
        assert abs(lng - 121.5654) < 0.01

    def test_provided_coordinates(self):
        lng, lat = get_city_coordinates("Unknown", longitude=100.0, latitude=5.0)
        assert lng == 100.0
        assert lat == 5.0

    def test_unknown_city_raises(self):
        with pytest.raises(ValueError, match="Cannot find coordinates"):
            get_city_coordinates("完全不存在的城市XYZ")


class TestTimezoneOffset:
    """Test timezone standard offset lookup."""

    def test_taiwan(self):
        dt = datetime(2026, 1, 1)
        assert get_timezone_offset_hours("Asia/Taipei", dt) == 8.0

    def test_shanghai(self):
        dt = datetime(2026, 1, 1)
        assert get_timezone_offset_hours("Asia/Shanghai", dt) == 8.0

    def test_shanghai_ignores_dst(self):
        """China DST was in effect May 1990, but we should return standard offset."""
        dt = datetime(1990, 5, 15)
        assert get_timezone_offset_hours("Asia/Shanghai", dt) == 8.0

    def test_tokyo(self):
        dt = datetime(2026, 1, 1)
        assert get_timezone_offset_hours("Asia/Tokyo", dt) == 9.0

    def test_hong_kong(self):
        dt = datetime(2026, 1, 1)
        assert get_timezone_offset_hours("Asia/Hong_Kong", dt) == 8.0

    def test_kuala_lumpur(self):
        dt = datetime(2026, 1, 1)
        assert get_timezone_offset_hours("Asia/Kuala_Lumpur", dt) == 8.0


class TestEquationOfTime:
    """Test Equation of Time calculation."""

    def test_range(self):
        """EoT should be between -17 and +17 minutes throughout the year."""
        for month in range(1, 13):
            dt = datetime(2026, month, 15)
            eot = calculate_equation_of_time(dt)
            assert -17 < eot < 17, f"EoT out of range for month {month}: {eot}"

    def test_february_peak(self):
        """EoT is typically most negative (~-14min) around Feb 12."""
        dt = datetime(2026, 2, 12)
        eot = calculate_equation_of_time(dt)
        assert eot < -10, f"Expected EoT < -10 in February, got {eot}"

    def test_november_peak(self):
        """EoT is typically most positive (~+16min) around Nov 3."""
        dt = datetime(2026, 11, 3)
        eot = calculate_equation_of_time(dt)
        assert eot > 10, f"Expected EoT > 10 in November, got {eot}"


class TestTrueSolarTime:
    """Test complete True Solar Time calculation."""

    def test_taipei_basic(self):
        """Taipei is east of 120°E standard meridian, so TST should be ahead."""
        result = calculate_true_solar_time(
            "2026-06-15", "12:00", "台北市", "Asia/Taipei"
        )
        assert result['longitude_offset'] > 0  # East of 120°E
        assert abs(result['longitude_offset'] - 6.26) < 0.5

    def test_beijing_longitude_correction(self):
        """Beijing is west of 120°E, so longitude correction should be negative."""
        result = calculate_true_solar_time(
            "2026-06-15", "12:00", "北京", "Asia/Shanghai"
        )
        assert result['longitude_offset'] < 0
        assert abs(result['longitude_offset'] - (-14.37)) < 0.5

    def test_kuala_lumpur_large_correction(self):
        """KL is far west of 120°E, so it has a large negative correction (~73min)."""
        result = calculate_true_solar_time(
            "2026-06-15", "12:00", "吉隆坡", "Asia/Kuala_Lumpur"
        )
        assert result['longitude_offset'] < -70
        assert abs(result['longitude_offset'] - (-73.25)) < 1

    def test_dst_correction_china_1990(self):
        """China used DST in May 1990. Should subtract 1 hour from clock time."""
        result = calculate_true_solar_time(
            "1990-05-15", "14:30", "北京", "Asia/Shanghai"
        )
        assert abs(result['dst_adjustment'] - 60.0) < 0.01  # 60 minutes DST
        # True solar time should be around 13:19 (clock 14:30 - 1hr DST - 14min lng + 4min EoT)
        tst_hour = int(result['true_solar_time'].split(':')[0])
        assert tst_hour == 13

    def test_no_dst_china_2026(self):
        """China does not use DST in 2026."""
        result = calculate_true_solar_time(
            "2026-05-15", "14:30", "北京", "Asia/Shanghai"
        )
        assert abs(result['dst_adjustment']) < 0.01

    def test_no_dst_taiwan(self):
        """Taiwan does not use DST for this date."""
        result = calculate_true_solar_time(
            "1990-05-15", "14:30", "台北市", "Asia/Taipei"
        )
        assert abs(result['dst_adjustment']) < 0.01

    def test_with_provided_coordinates(self):
        """Test with explicitly provided coordinates."""
        result = calculate_true_solar_time(
            "2026-06-15", "12:00", "SomeCity", "Asia/Taipei",
            birth_longitude=121.5, birth_latitude=25.0,
        )
        assert abs(result['birth_longitude'] - 121.5) < 0.01

    def test_total_adjustment_sum(self):
        """Total adjustment should equal longitude offset + EoT."""
        result = calculate_true_solar_time(
            "2026-06-15", "12:00", "台北市", "Asia/Taipei"
        )
        expected_total = result['longitude_offset'] + result['equation_of_time']
        assert abs(result['total_adjustment'] - expected_total) < 0.01
