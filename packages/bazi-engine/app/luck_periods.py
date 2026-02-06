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

from datetime import datetime
from typing import Dict, List, Optional

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


def calculate_luck_period_start_age(
    birth_datetime: datetime,
    direction: int,
) -> float:
    """
    Calculate the starting age for the first Luck Period.

    Method:
    - Count the number of days from birth to the next (forward) or previous (backward) solar term
    - Divide by 3 → each 3 days ≈ 1 year of life
    - Result is the starting age (rounded to nearest whole number)

    Simplified calculation: We use an approximation based on the birth month.
    For precise calculation, we'd need exact solar term dates.

    Args:
        birth_datetime: Birth date and time
        direction: +1 (forward to next term) or -1 (backward to previous term)

    Returns:
        Starting age as a float (then typically rounded)
    """
    # Approximate solar term dates (every ~15 days)
    # Solar terms occur roughly on the 4th-8th and 19th-23rd of each month
    day = birth_datetime.day
    month = birth_datetime.month

    if direction == 1:
        # Forward: count days to NEXT solar term (節)
        # Approximate: next term is around the 5th of the next month
        # or the 20th of current month if before the 20th
        if day < 6:
            days_to_term = 6 - day
        elif day < 21:
            days_to_term = 21 - day
        else:
            # Next term is around 6th of next month
            days_to_term = (30 - day) + 6
    else:
        # Backward: count days to PREVIOUS solar term
        if day > 21:
            days_to_term = day - 21
        elif day > 6:
            days_to_term = day - 6
        else:
            # Previous term was around 21st of last month
            days_to_term = day + (30 - 21)

    # 3 days ≈ 1 year
    start_age = round(days_to_term / 3.0)

    # Minimum start age is 1, maximum is typically around 10
    start_age = max(1, min(10, start_age))

    return start_age


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
