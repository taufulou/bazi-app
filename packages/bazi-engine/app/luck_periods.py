"""
Luck Periods (大運), Annual Stars (流年), Monthly Stars (流月) Calculator

大運 (Major Luck Periods):
- 10-year cycles derived from the Month Pillar
- Direction depends on gender and Year Stem's Yin/Yang:
  - Male + Yang year OR Female + Yin year → Forward (順行)
  - Male + Yin year OR Female + Yang year → Backward (逆行)
- Starting age is calculated from the distance to the next/previous solar term

流年 (Annual Stars):
- Each year has its own Heavenly Stem and Earthly Branch
- Derived from the 60 Jiazi cycle

流月 (Monthly Stars):
- Each month has its own Stem/Branch
- Month boundaries are defined by solar terms (節氣)
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import ephem

from .constants import (
    BRANCH_INDEX,
    EARTHLY_BRANCHES,
    HEAVENLY_STEMS,
    STEM_INDEX,
    STEM_YINYANG,
    YEAR_STEM_TO_MONTH_STEM_START,
    MONTH_BRANCHES,
)
from .ten_gods import derive_ten_god


def calculate_luck_period_direction(
    year_stem: str,
    gender: str,
) -> int:
    """
    Determine the direction of Luck Periods.

    Rules:
    - Male + Yang year stem → Forward (+1)
    - Female + Yin year stem → Forward (+1)
    - Male + Yin year stem → Backward (-1)
    - Female + Yang year stem → Backward (-1)

    Args:
        year_stem: Year pillar's Heavenly Stem
        gender: 'male' or 'female'

    Returns:
        +1 for forward, -1 for backward
    """
    year_yinyang = STEM_YINYANG[year_stem]

    if gender == 'male':
        return 1 if year_yinyang == '陽' else -1
    else:  # female
        return 1 if year_yinyang == '陰' else -1


def _get_jie_solar_term_dates(year: int) -> List[datetime]:
    """
    Get exact dates of the 12 "節" (jie) solar terms for a given year
    using the cnlunar library for astronomical accuracy.

    The 12 節 terms define Bazi month boundaries:
    小寒→丑月, 立春→寅月, 驚蟄→卯月, 清明→辰月, 立夏→巳月, 芒種→午月,
    小暑→未月, 立秋→申月, 白露→酉月, 寒露→戌月, 立冬→亥月, 大雪→子月

    Args:
        year: Calendar year

    Returns:
        Sorted list of datetime objects for all 12 節 terms in that year
    """
    import cnlunar

    # The 12 "節" (jie) terms — these are the month-boundary terms
    # (as opposed to "氣" (qi) terms which are the mid-month terms)
    JIE_TERM_NAMES = [
        '小寒', '立春', '惊蛰', '清明', '立夏', '芒种',
        '小暑', '立秋', '白露', '寒露', '立冬', '大雪',
    ]

    # Use a mid-year date to get all solar terms for this year
    mid_year = datetime(year, 6, 15)
    lunar = cnlunar.Lunar(mid_year, godType='8char')
    terms_dict = lunar.thisYearSolarTermsDic

    jie_dates = []
    for name in JIE_TERM_NAMES:
        if name in terms_dict:
            month, day = terms_dict[name]
            jie_dates.append(datetime(year, month, day))

    return sorted(jie_dates)


def calculate_luck_period_start_age(
    birth_datetime: datetime,
    direction: int,
) -> int:
    """
    Calculate the starting age for the first Luck Period (大運起運歲數).

    Method (standard 子平真詮 algorithm):
    1. Determine LP direction: forward (順) or backward (逆)
    2. If forward: count days from birth to the NEXT 節 (jie) solar term
       If backward: count days from birth to the PREVIOUS 節 solar term
    3. Divide by 3 → each 3 days ≈ 1 year of life
    4. Round to nearest integer

    Uses cnlunar library for exact astronomical solar term dates,
    matching results from established sites like 易安居, 神巴巴, Seer etc.

    Args:
        birth_datetime: Birth date and time
        direction: +1 (forward to next jie term) or -1 (backward to previous jie term)

    Returns:
        Starting age as an integer (rounded)
    """
    birth_year = birth_datetime.year
    birth_date_only = datetime(birth_year, birth_datetime.month, birth_datetime.day)

    # Collect jie solar term dates from surrounding years to handle year boundaries
    # (e.g., birth in early January needs previous year's 大雪, or late December
    #  needs next year's 小寒)
    all_jie_dates = []
    for y in [birth_year - 1, birth_year, birth_year + 1]:
        try:
            all_jie_dates.extend(_get_jie_solar_term_dates(y))
        except Exception:
            pass

    all_jie_dates.sort()

    # Find the previous and next jie terms surrounding the birth date
    prev_jie = None
    next_jie = None
    for jie_dt in all_jie_dates:
        if jie_dt <= birth_date_only:
            prev_jie = jie_dt
        elif next_jie is None:
            next_jie = jie_dt

    # Calculate days to the relevant solar term based on direction
    if direction == 1:
        # Forward: count days to NEXT 節
        if next_jie is not None:
            days_to_term = (next_jie - birth_date_only).days
        else:
            days_to_term = 15  # Fallback (should never happen)
    else:
        # Backward: count days to PREVIOUS 節
        if prev_jie is not None:
            days_to_term = (birth_date_only - prev_jie).days
        else:
            days_to_term = 15  # Fallback (should never happen)

    # Standard formula: 3 days ≈ 1 year
    start_age = round(days_to_term / 3.0)

    # Clamp to valid range (minimum 1, maximum 10)
    start_age = max(1, min(10, start_age))

    return start_age


logger = logging.getLogger(__name__)

# 節 (Jie) solar term ecliptic longitudes (degrees)
# These are the 12 month-boundary solar terms used for 大運 calculation
_JIE_LONGITUDES = {
    315: '立春', 345: '驚蟄', 15: '清明', 45: '立夏',
    75: '芒種', 105: '小暑', 135: '立秋', 165: '白露',
    195: '寒露', 225: '立冬', 255: '大雪', 285: '小寒',
}


def _get_ephem_jie_datetimes(birth_datetime: datetime, direction: int) -> Optional[datetime]:
    """
    Find the exact datetime of the nearest 節 solar term using ephem library.

    Args:
        birth_datetime: Full birth datetime (with hours/minutes)
        direction: +1 = find next jie, -1 = find previous jie

    Returns:
        datetime of the nearest jie solar term, or None on failure
    """
    sun = ephem.Sun()
    # Convert birth datetime to ephem date
    birth_ephem = ephem.Date(birth_datetime)

    # Get sun's ecliptic longitude at birth
    sun.compute(birth_ephem)
    birth_lon = float(sun.hlong) * 180.0 / 3.14159265358979  # radians to degrees

    # Find which jie longitudes to target
    jie_lons = sorted(_JIE_LONGITUDES.keys())

    if direction == 1:
        # Find next jie after birth longitude
        target_lons = [l for l in jie_lons if l > birth_lon]
        if not target_lons:
            target_lons = [jie_lons[0]]  # Wrap around (e.g., past 大雪 315° → 小寒 285°→ 立春 315°)
            # Actually need the smallest longitude in next cycle
            target_lon = jie_lons[0]
        else:
            target_lon = target_lons[0]
    else:
        # Find previous jie before birth longitude
        target_lons = [l for l in jie_lons if l < birth_lon]
        if not target_lons:
            target_lon = jie_lons[-1]  # Wrap around
        else:
            target_lon = target_lons[-1]

    # Binary search for the exact time when sun reaches target_lon
    # Start with a search window of ±45 days from birth
    target_rad = target_lon * 3.14159265358979 / 180.0
    step = 15.0  # days
    current = birth_ephem

    if direction == 1:
        # Search forward
        for _ in range(60):
            sun.compute(current)
            current_lon = float(sun.hlong)
            # Check if we've passed the target
            diff = (target_rad - current_lon) % (2 * 3.14159265358979)
            if diff < 0.01:  # Close enough, refine
                break
            current = ephem.Date(current + step)
            if step > 0.5:
                step *= 0.5
    else:
        # Search backward
        for _ in range(60):
            sun.compute(current)
            current_lon = float(sun.hlong)
            diff = (current_lon - target_rad) % (2 * 3.14159265358979)
            if diff < 0.01:
                break
            current = ephem.Date(current - step)
            if step > 0.5:
                step *= 0.5

    # Use ephem's next_solstice/equinox approach — actually, let's use a simpler
    # and more reliable approach: iterate through ephem dates to find exact crossing
    # Reset and use a proper algorithm
    search_start = birth_ephem if direction == 1 else ephem.Date(birth_ephem - 45)
    search_end = ephem.Date(birth_ephem + 45) if direction == 1 else birth_ephem

    best_date = None
    best_diff = float('inf')

    # Scan in 1-day increments first
    scan = search_start
    prev_lon = None
    while scan <= search_end:
        sun.compute(scan)
        cur_lon = float(sun.hlong) * 180.0 / 3.14159265358979

        if prev_lon is not None:
            # Check if target_lon was crossed between prev and current
            for tl in jie_lons:
                crossed = False
                if prev_lon < cur_lon:
                    crossed = prev_lon <= tl < cur_lon
                else:
                    # Crossed 0°/360° boundary
                    crossed = prev_lon <= tl or tl < cur_lon

                if crossed:
                    # Refine with binary search between scan-1 and scan
                    lo = ephem.Date(scan - 1)
                    hi = scan
                    for _ in range(30):  # ~30 iterations → sub-second precision
                        mid = ephem.Date((float(lo) + float(hi)) / 2)
                        sun.compute(mid)
                        mid_lon = float(sun.hlong) * 180.0 / 3.14159265358979
                        # Normalize difference
                        diff = (mid_lon - tl) % 360
                        if diff > 180:
                            diff -= 360
                        if diff < 0:
                            lo = mid
                        else:
                            hi = mid

                    result_ephem = ephem.Date((float(lo) + float(hi)) / 2)
                    result_dt = ephem.Date(result_ephem).datetime()

                    if direction == 1 and result_dt > birth_datetime:
                        delta = (result_dt - birth_datetime).total_seconds()
                        if delta < best_diff:
                            best_diff = delta
                            best_date = result_dt
                    elif direction == -1 and result_dt < birth_datetime:
                        delta = (birth_datetime - result_dt).total_seconds()
                        if delta < best_diff:
                            best_diff = delta
                            best_date = result_dt

        prev_lon = cur_lon
        scan = ephem.Date(scan + 1)

    return best_date


def calculate_luck_period_start_info(
    birth_datetime: datetime,
    direction: int,
    start_age: int,
) -> Dict:
    """
    Calculate precise luck period start info using ephem for exact solar term times.

    Takes start_age from the existing calculate_luck_period_start_age() function
    to ensure consistency with the LP timeline. Uses ephem for the precise date only.

    Args:
        birth_datetime: Full birth datetime (with hours and minutes)
        direction: +1 (forward/順) or -1 (backward/逆)
        start_age: Canonical start age from calculate_luck_period_start_age()

    Returns:
        Dictionary with startAge, startDate, yearsMonths, daysToTerm, direction
    """
    jie_dt = _get_ephem_jie_datetimes(birth_datetime, direction)

    if jie_dt is None:
        # Fallback: use start_age to estimate
        start_date = birth_datetime + timedelta(days=start_age * 365.2422)
        return {
            'startAge': start_age,
            'startDate': start_date.strftime('%Y-%m-%d'),
            'yearsMonths': f'{start_age}年0月',
            'daysToTerm': start_age * 3.0,
            'direction': direction,
        }

    # Calculate days between birth and jie term
    if direction == 1:
        delta = jie_dt - birth_datetime
    else:
        delta = birth_datetime - jie_dt

    days_to_term = delta.total_seconds() / 86400.0

    # Continuous formula for precise start date
    # 3 days of birth-to-term = 1 year of life
    precise_years = days_to_term / 3.0
    start_date = birth_datetime + timedelta(days=precise_years * 365.2422)

    # Discrete formula for display string
    years = int(days_to_term / 3)
    remaining_days = days_to_term % 3
    months = int(remaining_days * 4)  # Each remaining day ≈ 4 months
    years_months = f'{years}年{months}月'

    # Validation: check ephem-based age ≈ cnlunar-based start_age
    ephem_age = round(days_to_term / 3.0)
    if abs(ephem_age - start_age) > 1:
        logger.warning(
            f'起運 age divergence: ephem={ephem_age}, cnlunar={start_age}, '
            f'days_to_term={days_to_term:.1f}'
        )

    return {
        'startAge': start_age,
        'startDate': start_date.strftime('%Y-%m-%d'),
        'yearsMonths': years_months,
        'daysToTerm': round(days_to_term, 2),
        'direction': direction,
    }


def calculate_luck_periods(
    month_stem: str,
    month_branch: str,
    year_stem: str,
    gender: str,
    birth_year: int,
    birth_datetime: datetime,
    day_master_stem: str,
    current_year: Optional[int] = None,
    num_periods: int = 8,
) -> List[Dict]:
    """
    Calculate Major Luck Periods (大運).

    Each period is 10 years. The stem and branch advance (or retreat)
    from the Month Pillar.

    Args:
        month_stem: Month Heavenly Stem
        month_branch: Month Earthly Branch
        year_stem: Year Heavenly Stem
        gender: 'male' or 'female'
        birth_year: Year of birth
        birth_datetime: Full birth datetime
        day_master_stem: Day Master's Heavenly Stem
        current_year: Current year for marking active period
        num_periods: Number of luck periods to calculate

    Returns:
        List of luck period dictionaries
    """
    if current_year is None:
        current_year = datetime.now().year

    direction = calculate_luck_period_direction(year_stem, gender)
    start_age = calculate_luck_period_start_age(birth_datetime, direction)

    month_stem_idx = STEM_INDEX[month_stem]
    month_branch_idx = BRANCH_INDEX[month_branch]

    periods: List[Dict] = []

    for i in range(num_periods):
        # Calculate stem and branch for this period
        period_stem_idx = (month_stem_idx + (i + 1) * direction) % 10
        period_branch_idx = (month_branch_idx + (i + 1) * direction) % 12

        period_stem = HEAVENLY_STEMS[period_stem_idx]
        period_branch = EARTHLY_BRANCHES[period_branch_idx]

        period_start_age = start_age + (i * 10)
        period_end_age = period_start_age + 9
        period_start_year = birth_year + period_start_age
        period_end_year = period_start_year + 9

        # Check if this is the current period
        is_current = period_start_year <= current_year <= period_end_year

        # Derive Ten God
        ten_god = derive_ten_god(day_master_stem, period_stem)

        periods.append({
            'startAge': period_start_age,
            'endAge': period_end_age,
            'startYear': period_start_year,
            'endYear': period_end_year,
            'stem': period_stem,
            'branch': period_branch,
            'tenGod': ten_god,
            'isCurrent': is_current,
        })

    return periods


def calculate_annual_stars(
    birth_year: int,
    day_master_stem: str,
    current_year: Optional[int] = None,
    range_years: int = 10,
) -> List[Dict]:
    """
    Calculate Annual Stars (流年) for a range of years.

    The year's stem and branch follow the 60 Jiazi cycle.
    Year stem: (year - 4) % 10 → index into HEAVENLY_STEMS
    Year branch: (year - 4) % 12 → index into EARTHLY_BRANCHES
    (Year 4 CE = 甲子)

    Args:
        birth_year: Year of birth
        day_master_stem: Day Master's stem
        current_year: Center year for the range
        range_years: Number of years to show before/after current year

    Returns:
        List of annual star dictionaries
    """
    if current_year is None:
        current_year = datetime.now().year

    start_year = current_year - range_years
    end_year = current_year + range_years

    stars: List[Dict] = []
    for year in range(start_year, end_year + 1):
        stem_idx = (year - 4) % 10
        branch_idx = (year - 4) % 12

        stem = HEAVENLY_STEMS[stem_idx]
        branch = EARTHLY_BRANCHES[branch_idx]
        ten_god = derive_ten_god(day_master_stem, stem)

        stars.append({
            'year': year,
            'stem': stem,
            'branch': branch,
            'tenGod': ten_god,
            'isCurrent': year == current_year,
        })

    return stars


def calculate_monthly_stars(
    year: int,
    day_master_stem: str,
) -> List[Dict]:
    """
    Calculate Monthly Stars (流月) for a given year.

    Month stems follow a cycle based on the Year Stem:
    - 甲己年 → 丙寅月起
    - 乙庚年 → 戊寅月起
    - 丙辛年 → 庚寅月起
    - 丁壬年 → 壬寅月起
    - 戊癸年 → 甲寅月起

    Args:
        year: The year to calculate for
        day_master_stem: Day Master's stem

    Returns:
        List of 12 monthly star dictionaries
    """
    year_stem_idx = (year - 4) % 10
    month_stem_start = YEAR_STEM_TO_MONTH_STEM_START[year_stem_idx]

    # Approximate solar term dates for each month
    # These are the "節" (jie) solar terms that start each Bazi month
    solar_term_approx = [
        (2, 4),    # 立春 → Month 1 (寅) ~Feb 4
        (3, 6),    # 驚蟄 → Month 2 (卯) ~Mar 6
        (4, 5),    # 清明 → Month 3 (辰) ~Apr 5
        (5, 6),    # 立夏 → Month 4 (巳) ~May 6
        (6, 6),    # 芒種 → Month 5 (午) ~Jun 6
        (7, 7),    # 小暑 → Month 6 (未) ~Jul 7
        (8, 7),    # 立秋 → Month 7 (申) ~Aug 7
        (9, 8),    # 白露 → Month 8 (酉) ~Sep 8
        (10, 8),   # 寒露 → Month 9 (戌) ~Oct 8
        (11, 7),   # 立冬 → Month 10 (亥) ~Nov 7
        (12, 7),   # 大雪 → Month 11 (子) ~Dec 7
        (1, 6),    # 小寒 → Month 12 (丑) ~Jan 6 (of NEXT year)
    ]

    months: List[Dict] = []
    for i in range(12):
        month_stem_idx = (month_stem_start + i) % 10
        month_branch = MONTH_BRANCHES[i]
        month_stem = HEAVENLY_STEMS[month_stem_idx]

        ten_god = derive_ten_god(day_master_stem, month_stem)

        solar_month, solar_day = solar_term_approx[i]
        # Handle month 12 (丑) which starts in January of the NEXT year
        term_year = year + 1 if i == 11 else year
        solar_term_date = f"{term_year}-{solar_month:02d}-{solar_day:02d}"

        months.append({
            'month': i + 1,
            'solarTermDate': solar_term_date,
            'stem': month_stem,
            'branch': month_branch,
            'tenGod': ten_god,
        })

    return months
