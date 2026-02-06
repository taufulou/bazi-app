"""
Four Pillars (四柱) Calculator

Calculates Year, Month, Day, and Hour pillars using:
- cnlunar library for Year, Month, Day pillars (based on solar terms)
- True Solar Time for accurate Hour Pillar
- Manual Hour Stem derivation from Day Stem
"""

from datetime import datetime
from typing import Dict, List, Optional, Tuple

import cnlunar

from .constants import (
    BRANCH_ELEMENT,
    BRANCH_INDEX,
    DAY_STEM_TO_HOUR_STEM_START,
    EARTHLY_BRANCHES,
    HEAVENLY_STEMS,
    HIDDEN_STEMS,
    HOUR_BRANCHES,
    NAYIN,
    STEM_ELEMENT,
    STEM_INDEX,
    STEM_YINYANG,
    BRANCH_YINYANG,
    YEAR_STEM_TO_MONTH_STEM_START,
    MONTH_BRANCHES,
)
from .solar_time import calculate_true_solar_time


def get_hour_branch(hour: int, minute: int = 0) -> str:
    """
    Get the Earthly Branch for a given hour (using True Solar Time).

    Time ranges:
        23:00-00:59 → 子 (early 子時 and late 子時)
        01:00-02:59 → 丑
        03:00-04:59 → 寅
        ...
        21:00-22:59 → 亥

    Args:
        hour: Hour in 24-hour format (0-23)
        minute: Minute (0-59)

    Returns:
        Earthly Branch character
    """
    # Handle the 子時 special case (spans midnight: 23:00-00:59)
    if hour == 23 or hour == 0:
        return '子'

    # For other hours, each branch covers 2 hours starting from 1:00
    branch_index = ((hour + 1) // 2) % 12
    return EARTHLY_BRANCHES[branch_index]


def get_hour_stem(day_stem: str, hour_branch: str) -> str:
    """
    Get the Heavenly Stem for the hour based on the Day Stem.

    Rule (五鼠遁時):
    - 甲己日 → 甲子時起
    - 乙庚日 → 丙子時起
    - 丙辛日 → 戊子時起
    - 丁壬日 → 庚子時起
    - 戊癸日 → 壬子時起

    Args:
        day_stem: Day pillar's Heavenly Stem
        hour_branch: Hour's Earthly Branch

    Returns:
        Hour's Heavenly Stem
    """
    day_stem_idx = STEM_INDEX[day_stem]
    start_stem_idx = DAY_STEM_TO_HOUR_STEM_START[day_stem_idx]
    branch_idx = BRANCH_INDEX[hour_branch]
    hour_stem_idx = (start_stem_idx + branch_idx) % 10
    return HEAVENLY_STEMS[hour_stem_idx]


def get_lichun_date(year: int) -> datetime:
    """
    Get the approximate date of 立春 (Start of Spring) for a given year.

    立春 typically falls on February 3, 4, or 5.
    We use the ephem library for accurate calculation when available.

    Args:
        year: The year to check

    Returns:
        Approximate datetime of 立春
    """
    try:
        import ephem
        # 立春 is when the sun reaches ecliptic longitude 315°
        # We can approximate this using the spring equinox and working backward
        # The sun's ecliptic longitude is 315° about 45 days before vernal equinox
        # Vernal equinox is around March 20, so 立春 ≈ Feb 3-5

        # Use ephem to find when sun reaches 315° ecliptic longitude
        # Simple approach: use known approximate dates and refine
        observer = ephem.Observer()
        observer.pressure = 0
        observer.horizon = '0'

        # Check Feb 3, 4, 5 at various hours for the exact boundary
        # Most 立春 dates fall on Feb 3-5, with the exact time varying
        for day in [3, 4, 5]:
            for hour in range(0, 24):
                dt = datetime(year, 2, day, hour, 0)
                observer.date = ephem.Date(dt)
                sun = ephem.Sun(observer)
                # Sun's ecliptic longitude (converted to degrees)
                ecl_lon = float(sun.hlong) * 180.0 / 3.14159265  # radians to degrees
                if ecl_lon < 0:
                    ecl_lon += 360
                # 立春 = 315°
                if abs(ecl_lon - 315.0) < 1.0:
                    return dt
    except Exception:
        pass

    # Fallback: use known approximate dates
    # Most years, 立春 is Feb 4 around 2-6 AM UTC+8
    return datetime(year, 2, 4, 5, 0)


def get_bazi_year_stem_branch(dt: datetime) -> tuple:
    """
    Get the correct Bazi year stem and branch based on 立春.

    CRITICAL: In Bazi, the year changes at 立春 (Start of Spring), NOT at
    Chinese New Year (Lunar New Year). cnlunar uses Lunar New Year for its
    year8Char, which is WRONG for Bazi. We must override this.

    Formula:
        stem_index = (year - 4) % 10
        branch_index = (year - 4) % 12

    But if the date is before 立春 of that year, use the previous year.

    Args:
        dt: The datetime to calculate for

    Returns:
        Tuple of (stem, branch, year_used)
    """
    year = dt.year
    lichun = get_lichun_date(year)

    # If before 立春, the Bazi year is the previous year
    if dt < lichun:
        year -= 1

    stem_idx = (year - 4) % 10
    branch_idx = (year - 4) % 12

    stem = HEAVENLY_STEMS[stem_idx]
    branch = EARTHLY_BRANCHES[branch_idx]

    return stem, branch, year


def get_bazi_month_stem_branch(dt: datetime, year_stem_idx: int) -> tuple:
    """
    Get the correct Bazi month stem and branch based on solar terms (節).

    Month boundaries in Bazi are defined by the 12 "jie" (節) solar terms:
    Month 1 (寅): 立春 ~ 驚蟄
    Month 2 (卯): 驚蟄 ~ 清明
    ...and so on.

    The month stem follows from the year stem using the 五虎遁月 rule.

    Since cnlunar handles month8Char correctly based on solar terms,
    we use cnlunar's month pillar directly.

    Args:
        dt: The datetime
        year_stem_idx: The year stem index (0-9)

    Returns:
        Tuple of (stem, branch) for the month
    """
    # cnlunar's month8Char uses solar terms correctly
    # We rely on it for month calculation
    # This function is here for documentation; we use cnlunar directly
    pass


def get_nayin(stem: str, branch: str) -> str:
    """
    Get Na Yin (納音) for a stem-branch pair.

    Args:
        stem: Heavenly Stem
        branch: Earthly Branch

    Returns:
        Na Yin description string
    """
    key = stem + branch
    return NAYIN.get(key, '')


def calculate_four_pillars(
    birth_date: str,
    birth_time: str,
    birth_city: str,
    birth_timezone: str,
    gender: str,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
) -> Dict:
    """
    Calculate the Four Pillars (四柱) of Bazi.

    Uses cnlunar for Year/Month/Day pillars (they handle solar terms correctly).
    Uses True Solar Time for accurate Hour Pillar.

    Args:
        birth_date: YYYY-MM-DD format
        birth_time: HH:MM format (24-hour)
        birth_city: City name
        birth_timezone: IANA timezone
        gender: 'male' or 'female'
        birth_longitude: Optional longitude
        birth_latitude: Optional latitude

    Returns:
        Dictionary with all four pillars and related data
    """
    # Step 1: Calculate True Solar Time
    solar_time_data = calculate_true_solar_time(
        birth_date=birth_date,
        birth_time=birth_time,
        birth_city=birth_city,
        birth_timezone=birth_timezone,
        birth_longitude=birth_longitude,
        birth_latitude=birth_latitude,
    )

    true_solar_dt = solar_time_data['true_solar_datetime']

    # Step 2: Use cnlunar to get Month/Day pillars
    # cnlunar needs a datetime object — we pass the TRUE SOLAR TIME datetime
    # because cnlunar also determines the Hour Pillar from the time,
    # and the time affects whether we're in the next/previous day (especially around midnight)
    lunar = cnlunar.Lunar(true_solar_dt, godType='8char')

    # Extract Eight Characters (八字) from cnlunar
    # IMPORTANT: cnlunar's year8Char uses Lunar New Year as boundary,
    # but Bazi uses 立春 (Start of Spring). We OVERRIDE the year pillar.
    month_gz = lunar.month8Char  # cnlunar handles month correctly (solar terms)
    day_gz = lunar.day8Char      # cnlunar handles day correctly
    hour_gz = lunar.twohour8Char # We'll recalculate this with True Solar Time

    # Override year pillar using 立春 boundary
    year_stem, year_branch, bazi_year = get_bazi_year_stem_branch(true_solar_dt)
    year_gz = f'{year_stem}{year_branch}'

    # Month pillar from cnlunar (already uses solar terms correctly)
    month_stem, month_branch = month_gz[0], month_gz[1]

    # But we need to fix the month stem if the year changed due to 立春 override
    # The month stem depends on the year stem via 五虎遁月
    year_stem_idx = STEM_INDEX[year_stem]
    month_stem_start = YEAR_STEM_TO_MONTH_STEM_START[year_stem_idx]
    # Find which month index this branch corresponds to
    month_branch_in_cycle = MONTH_BRANCHES.index(month_branch)
    corrected_month_stem_idx = (month_stem_start + month_branch_in_cycle) % 10
    month_stem = HEAVENLY_STEMS[corrected_month_stem_idx]
    month_gz = f'{month_stem}{month_branch}'

    # Day pillar from cnlunar (always correct)
    day_stem, day_branch = day_gz[0], day_gz[1]

    # Step 3: Calculate Hour Pillar using True Solar Time
    # We use cnlunar's hour pillar as a starting point, but verify with our own calculation
    true_hour = true_solar_dt.hour
    true_minute = true_solar_dt.minute

    hour_branch = get_hour_branch(true_hour, true_minute)
    hour_stem = get_hour_stem(day_stem, hour_branch)

    # Verify if cnlunar's hour pillar matches our True Solar Time calculation
    # If they differ, prefer our True Solar Time calculation
    cnlunar_hour_stem, cnlunar_hour_branch = hour_gz[0], hour_gz[1]
    if hour_branch != cnlunar_hour_branch:
        # True Solar Time gives a different hour — this is expected when
        # the longitude correction shifts across an hour boundary
        pass  # We use our calculated values

    # Step 4: Get lunar date info
    lunar_year = lunar.lunarYear
    lunar_month = lunar.lunarMonth
    lunar_day = lunar.lunarDay
    is_leap_month = lunar.isLunarLeapMonth

    # Step 5: Build pillar data structures
    def build_pillar(stem: str, branch: str, is_day_pillar: bool = False) -> Dict:
        """Build a single pillar's data."""
        hidden = HIDDEN_STEMS.get(branch, [])
        return {
            'stem': stem,
            'branch': branch,
            'stemElement': STEM_ELEMENT[stem],
            'branchElement': BRANCH_ELEMENT[branch],
            'stemYinYang': STEM_YINYANG[stem],
            'branchYinYang': BRANCH_YINYANG[branch],
            'hiddenStems': hidden,
            'naYin': get_nayin(stem, branch),
            'tenGod': None,  # Will be filled by ten_gods module
            'shenSha': [],   # Will be filled by shen_sha module
        }

    pillars = {
        'year': build_pillar(year_stem, year_branch),
        'month': build_pillar(month_stem, month_branch),
        'day': build_pillar(day_stem, day_branch, is_day_pillar=True),
        'hour': build_pillar(hour_stem, hour_branch),
    }

    return {
        'fourPillars': pillars,
        'dayMasterStem': day_stem,
        'dayMasterBranch': day_branch,
        'trueSolarTime': {
            'clockTime': solar_time_data['clock_time'],
            'trueSolarTime': solar_time_data['true_solar_time'],
            'longitudeOffset': solar_time_data['longitude_offset'],
            'equationOfTime': solar_time_data['equation_of_time'],
            'totalAdjustment': solar_time_data['total_adjustment'],
            'birthCity': birth_city,
            'birthLongitude': solar_time_data['birth_longitude'],
            'birthLatitude': solar_time_data['birth_latitude'],
        },
        'lunarDate': {
            'year': lunar_year,
            'month': lunar_month,
            'day': lunar_day,
            'isLeapMonth': is_leap_month,
        },
        'gender': gender,
        'yearStemIndex': STEM_INDEX[year_stem],
        'monthBranchIndex': BRANCH_INDEX[month_branch],
        # Store raw GanZhi strings for easy access
        'yearGanZhi': year_gz,
        'monthGanZhi': month_gz,
        'dayGanZhi': day_gz,
        'hourGanZhi': f'{hour_stem}{hour_branch}',
    }
