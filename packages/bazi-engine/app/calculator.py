"""
Bazi Calculator — Main Orchestrator

Orchestrates all calculation modules to produce a complete Bazi reading:
1. True Solar Time adjustment
2. Four Pillars calculation
3. Ten Gods derivation
4. Five Elements balance
5. Day Master strength analysis
6. Shen Sha (special stars)
7. Life Stages
8. Luck Periods, Annual Stars, Monthly Stars
9. Pattern (格局) determination

This is the single entry point for the FastAPI endpoints.
"""

from datetime import datetime
from typing import Dict, Optional

from .four_pillars import calculate_four_pillars
from .ten_gods import (
    apply_ten_gods_to_pillars,
    get_prominent_ten_god,
    get_ten_god_distribution,
)
from .five_elements import (
    analyze_day_master_strength,
    calculate_five_elements_balance,
    calculate_element_counts,
    determine_favorable_gods,
)
from .shen_sha import apply_shen_sha_to_pillars, detect_special_day_pillars, get_all_shen_sha
from .life_stages import apply_life_stages_to_pillars
from .luck_periods import (
    calculate_annual_stars,
    calculate_luck_periods,
    calculate_monthly_stars,
)
from .timing_analysis import (
    analyze_timing_for_annual_stars,
    analyze_timing_for_luck_periods,
    generate_timing_insights,
)
from .compatibility import calculate_compatibility
from .constants import BRANCH_ELEMENT, PATTERN_TYPES, STEM_ELEMENT
from .interpretation_rules import generate_pre_analysis


def calculate_bazi(
    birth_date: str,
    birth_time: str,
    birth_city: str,
    birth_timezone: str,
    gender: str,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
    target_year: Optional[int] = None,
    reading_type: Optional[str] = None,
) -> Dict:
    """
    Calculate a complete Bazi chart from birth data.

    This is the main entry point that orchestrates all sub-calculations.

    Args:
        birth_date: YYYY-MM-DD format
        birth_time: HH:MM format (24-hour)
        birth_city: City name (Chinese or English)
        birth_timezone: IANA timezone (e.g., 'Asia/Taipei')
        gender: 'male' or 'female'
        birth_longitude: Optional pre-provided longitude
        birth_latitude: Optional pre-provided latitude
        target_year: Target year for annual readings (default: current year)
        reading_type: NestJS reading type enum (e.g., 'LIFETIME', 'CAREER_FINANCE')

    Returns:
        Complete Bazi calculation result matching BaziCalculationResult TypeScript interface
    """
    if target_year is None:
        target_year = datetime.now().year

    # Step 1: Calculate Four Pillars (includes True Solar Time)
    pillar_data = calculate_four_pillars(
        birth_date=birth_date,
        birth_time=birth_time,
        birth_city=birth_city,
        birth_timezone=birth_timezone,
        gender=gender,
        birth_longitude=birth_longitude,
        birth_latitude=birth_latitude,
    )

    pillars = pillar_data['fourPillars']
    day_master_stem = pillar_data['dayMasterStem']
    day_master_branch = pillar_data['dayMasterBranch']
    birth_year = int(birth_date.split('-')[0])

    # Step 2: Apply Ten Gods
    pillars = apply_ten_gods_to_pillars(pillars, day_master_stem)

    # Step 3: Apply Shen Sha (special stars)
    pillars, kong_wang = apply_shen_sha_to_pillars(pillars, day_master_stem, day_master_branch)

    # Step 4: Apply Life Stages
    pillars = apply_life_stages_to_pillars(pillars, day_master_stem)

    # Step 5: Calculate Five Elements balance
    five_elements_balance = calculate_five_elements_balance(pillars)
    element_counts = calculate_element_counts(pillars)

    # Step 6: Analyze Day Master strength
    day_master_analysis = analyze_day_master_strength(pillars, day_master_stem)

    # Step 7: Determine favorable gods
    favorable_gods = determine_favorable_gods(
        day_master_stem,
        day_master_analysis['strength'],
    )

    # Step 8: Determine pattern (格局)
    prominent_god = get_prominent_ten_god(pillars, day_master_stem)
    pattern = PATTERN_TYPES.get(prominent_god, f'{prominent_god}格')

    # Step 9: Get Ten God distribution
    ten_god_distribution = get_ten_god_distribution(pillars, day_master_stem)

    # Step 10: Calculate Luck Periods
    birth_dt = datetime.strptime(f"{birth_date} {birth_time}", "%Y-%m-%d %H:%M")
    year_stem = pillars['year']['stem']
    month_stem = pillars['month']['stem']
    month_branch = pillars['month']['branch']

    luck_periods = calculate_luck_periods(
        month_stem=month_stem,
        month_branch=month_branch,
        year_stem=year_stem,
        gender=gender,
        birth_year=birth_year,
        birth_datetime=birth_dt,
        day_master_stem=day_master_stem,
        current_year=target_year,
    )

    # Step 11: Calculate Annual Stars (流年)
    annual_stars = calculate_annual_stars(
        birth_year=birth_year,
        day_master_stem=day_master_stem,
        current_year=target_year,
    )

    # Step 12: Calculate Monthly Stars (流月) for target year
    monthly_stars = calculate_monthly_stars(
        year=target_year,
        day_master_stem=day_master_stem,
    )

    # Step 13: Timing Analysis — enrich luck periods and annual stars
    luck_periods = analyze_timing_for_luck_periods(
        natal_pillars=pillars,
        luck_periods=luck_periods,
        day_master_stem=day_master_stem,
    )
    annual_stars = analyze_timing_for_annual_stars(
        natal_pillars=pillars,
        annual_stars=annual_stars,
        luck_periods=luck_periods,
        day_master_stem=day_master_stem,
    )
    timing_insights = generate_timing_insights(
        natal_pillars=pillars,
        luck_periods=luck_periods,
        annual_stars=annual_stars,
        day_master_stem=day_master_stem,
        target_year=target_year,
    )

    # Step 14: Special Day Pillar detection (魁罡日, 陰陽差錯日, 十惡大敗日)
    special_day_pillars = detect_special_day_pillars(day_master_stem, day_master_branch)

    # Step 15: Generate Pre-Analysis (Layer 2 — deterministic rules)
    pre_analysis = generate_pre_analysis(
        pillars=pillars,
        day_master_stem=day_master_stem,
        five_elements_balance=five_elements_balance,
        favorable_gods=favorable_gods,
        reading_type=reading_type or 'LIFETIME',
        gender=gender,
        timing_insights=timing_insights,
        special_day_pillars=special_day_pillars,
    )

    # Build the complete result
    day_master_result = {
        **day_master_analysis,
        **favorable_gods,
        'pattern': pattern,
        'strengthScoreV2': pre_analysis['strengthV2'],
    }

    # Convert five elements balance to English keys for TypeScript compatibility
    five_elements_balance_en = {
        'wood': five_elements_balance.get('木', 0),
        'fire': five_elements_balance.get('火', 0),
        'earth': five_elements_balance.get('土', 0),
        'metal': five_elements_balance.get('金', 0),
        'water': five_elements_balance.get('水', 0),
    }

    # Summary fields for AI consumption (Phase 11A)
    life_stages_summary = {
        pname: pillars[pname].get('lifeStage', '')
        for pname in ['year', 'month', 'day', 'hour']
    }

    pillar_elements = {
        pname: {
            'stem': pillars[pname]['stem'],
            'stemElement': STEM_ELEMENT.get(pillars[pname]['stem'], ''),
            'branch': pillars[pname]['branch'],
            'branchElement': BRANCH_ELEMENT.get(pillars[pname]['branch'], ''),
        }
        for pname in ['year', 'month', 'day', 'hour']
    }

    result = {
        'fourPillars': pillars,
        'fiveElementsBalance': five_elements_balance_en,
        'fiveElementsBalanceZh': five_elements_balance,
        'elementCounts': element_counts,
        'dayMaster': day_master_result,
        'dayMasterStem': day_master_stem,
        'dayMasterBranch': day_master_branch,
        'tenGodDistribution': ten_god_distribution,
        'luckPeriods': luck_periods,
        'annualStars': annual_stars,
        'monthlyStars': monthly_stars,
        'trueSolarTime': pillar_data['trueSolarTime'],
        'lunarDate': pillar_data['lunarDate'],
        'kongWang': kong_wang,
        'allShenSha': get_all_shen_sha(pillars),
        'ganZhi': {
            'year': pillar_data['yearGanZhi'],
            'month': pillar_data['monthGanZhi'],
            'day': pillar_data['dayGanZhi'],
            'hour': pillar_data['hourGanZhi'],
        },
        # Phase 11: Pre-analysis layer + summary fields
        'preAnalysis': pre_analysis,
        'lifeStagesSummary': life_stages_summary,
        'kongWangSummary': kong_wang,
        'pillarElements': pillar_elements,
        # Phase 11D: Timing analysis + special day pillars
        'timingInsights': timing_insights,
        'specialDayPillars': special_day_pillars,
    }

    return result


def calculate_bazi_compatibility(
    birth_data_a: Dict,
    birth_data_b: Dict,
    comparison_type: str = 'romance',
) -> Dict:
    """
    Calculate compatibility between two people's Bazi charts.

    Args:
        birth_data_a: Birth data for person A (same format as calculate_bazi args)
        birth_data_b: Birth data for person B
        comparison_type: 'romance', 'business', or 'friendship'

    Returns:
        Compatibility analysis including both individual charts and comparison
    """
    # Calculate individual charts
    chart_a = calculate_bazi(**birth_data_a)
    chart_b = calculate_bazi(**birth_data_b)

    # Calculate compatibility
    compat = calculate_compatibility(chart_a, chart_b, comparison_type)

    return {
        'chartA': chart_a,
        'chartB': chart_b,
        'compatibility': compat,
    }
