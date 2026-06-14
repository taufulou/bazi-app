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

from .four_pillars import (
    calculate_four_pillars,
    calculate_ming_gong,
    calculate_shen_gong,
    calculate_tai_xi,
    calculate_tai_yuan,
)
from .ten_gods import (
    apply_ten_gods_to_pillars,
    get_prominent_ten_god,
    get_ten_god_distribution,
)
from .five_elements import (
    analyze_day_master_strength,
    calculate_five_elements_balance,
    calculate_five_elements_balance_seasonal,
    calculate_element_counts,
    determine_favorable_gods,
    get_seasonal_state_labels,
)
from .shen_sha import (
    apply_shen_sha_to_pillars,
    calculate_kong_wang,
    detect_special_day_pillars,
    get_all_shen_sha,
    get_taohua_directions,
    get_wenchang_direction,
    get_zodiac_benefactors,
)
from .life_stages import apply_life_stages_to_pillars
from .luck_periods import (
    calculate_annual_stars,
    calculate_luck_period_direction,
    calculate_luck_period_start_age,
    calculate_luck_period_start_info,
    calculate_luck_periods,
    calculate_monthly_stars,
)
from .timing_analysis import (
    analyze_timing_for_annual_stars,
    analyze_timing_for_luck_periods,
    generate_timing_insights,
)
from .compatibility import calculate_compatibility
from .compatibility_enhanced import calculate_enhanced_compatibility
from .compatibility_preanalysis import generate_compatibility_pre_analysis
from .constants import BRANCH_ELEMENT, PATTERN_TYPES, STEM_ELEMENT
from .interpretation_rules import calculate_strength_score_v2, generate_pre_analysis
from .tiaohou import compute_tiaohou_advisory
from .career_enhanced import generate_career_pre_analysis
from .lifetime_enhanced import generate_lifetime_enhanced_insights


def calculate_bazi(
    birth_date: str,
    birth_time: Optional[str],
    birth_city: str,
    birth_timezone: str,
    gender: str,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
    target_year: Optional[int] = None,
    reading_type: Optional[str] = None,
    hour_known: bool = True,
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
        hour_known=hour_known,
    )

    pillars = pillar_data['fourPillars']
    day_master_stem = pillar_data['dayMasterStem']
    day_master_branch = pillar_data['dayMasterBranch']
    birth_year = int(birth_date.split('-')[0])

    # Step 2: Apply Ten Gods
    pillars = apply_ten_gods_to_pillars(pillars, day_master_stem)

    # Step 3: Apply Shen Sha (special stars)
    pillars, kong_wang = apply_shen_sha_to_pillars(pillars, day_master_stem, day_master_branch, gender=gender)

    # Step 4: Apply Life Stages
    pillars = apply_life_stages_to_pillars(pillars, day_master_stem)

    # Step 5: Calculate Five Elements balance (raw — for analytical decisions)
    five_elements_balance = calculate_five_elements_balance(pillars)
    # Step 5b: Seasonally-adjusted balance (for display/narration)
    five_elements_balance_seasonal = calculate_five_elements_balance_seasonal(pillars)
    element_counts = calculate_element_counts(pillars)

    # Step 6: Analyze Day Master strength (V1 — kept for sameParty/oppositeParty display)
    day_master_analysis = analyze_day_master_strength(pillars, day_master_stem)

    # Step 6.5: V2 strength — authoritative classification (得令/得地/得勢 3-factor model)
    strength_v2_result = calculate_strength_score_v2(pillars, day_master_stem)

    # Step 7: Get Ten God distribution (moved before favorable gods for 病藥取用法)
    ten_god_distribution = get_ten_god_distribution(pillars, day_master_stem)

    # Step 7.5: Determine favorable gods (uses V2 classification + ten god distribution)
    # Context-dependent 病藥取用法: assignment depends on what's causing the imbalance.
    # Fix 1a: passes `pillars` to enable weighted mode when the flag is on.
    # 從格 detection happens later in generate_pre_analysis; we pass is_cong_ge=False
    # here and the downstream pre-analysis overrides favorable_gods if needed.
    favorable_gods = determine_favorable_gods(
        day_master_stem,
        strength_v2_result['classification'],
        ten_god_distribution,
        pillars=pillars,
        is_cong_ge=False,
    )

    # Step 8: Determine pattern (格局)
    prominent_god = get_prominent_ten_god(pillars, day_master_stem)
    pattern = PATTERN_TYPES.get(prominent_god, f'{prominent_god}格')

    # Step 10: Calculate Luck Periods
    # Unknown 時辰: noon placeholder for the 起運 datetime (≤±2mo turnover-date drift;
    # the integer 起運 age is hour-independent). 干支 sequence + direction need no hour.
    effective_birth_time = birth_time if hour_known else "12:00"
    birth_dt = datetime.strptime(f"{birth_date} {effective_birth_time}", "%Y-%m-%d %H:%M")
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
        five_elements_balance_seasonal=five_elements_balance_seasonal,
        strength_v2=strength_v2_result,
    )

    # Phase 12 — Fix 2: 調候 advisory (structured only; AI layer renders narrative).
    # Skipped for 從格 charts (順勢 dominates, 調候 不適用).
    tiaohou_advisory = compute_tiaohou_advisory(
        pillars=pillars,
        dm_stem=day_master_stem,
        month_branch=pillars['month']['branch'],
        is_cong_ge=bool(pre_analysis.get('congGe')),
    )

    # Step 16: Lifetime Enhanced Insights (V2 — only for lifetime reading type)
    lifetime_enhanced = None
    if reading_type and reading_type.upper() == 'LIFETIME':
        lifetime_enhanced = generate_lifetime_enhanced_insights(
            pillars=pillars,
            day_master_stem=day_master_stem,
            gender=gender,
            five_elements_balance=five_elements_balance,
            effective_gods=pre_analysis['effectiveFavorableGods'],
            prominent_god=prominent_god,
            strength_v2=pre_analysis['strengthV2'],
            cong_ge=pre_analysis.get('congGe'),
            tougan_analysis=pre_analysis.get('touganAnalysis', []),
            ten_god_position_analysis=pre_analysis.get('tenGodPositionAnalysis', []),
            luck_periods=luck_periods,
            annual_stars=annual_stars,
            kong_wang=kong_wang,
            branch_relationships=pre_analysis.get('pillarRelationships', {}).get('branchRelationships'),
            birth_year=birth_year,
            current_year=target_year,
        )

    # Build the complete result
    _v2 = pre_analysis['strengthV2']  # single canonical source for output
    day_master_result = {
        **day_master_analysis,  # V1 base (sameParty, oppositeParty, element, yinYang)
        **favorable_gods,
        'pattern': pattern,
        'strength': _v2['classification'],
        'strengthScore': round(_v2['score']),
        'strengthScoreV2': _v2,
    }

    # D7 — Unknown 時辰: 用神 is led by 月令 (hour-independent) so the direction is
    # usually robust, but flag reduced confidence, escalate when the 3-pillar
    # strength sits near a class boundary (the ~25% hour mass could tip it), and
    # withhold the 格局 verdict when 從格 is detected (the hour is decisive there).
    if not hour_known:
        score = _v2['score']
        boundaries = (25, 40, 55, 70)  # V2 cutoffs: very_weak<25 ≤weak<40 ≤neutral<55 ≤strong<70 ≤very_strong
        is_borderline = any(abs(score - b) <= 3 for b in boundaries)
        day_master_result['hourUnknown'] = True
        day_master_result['yongShenConfidence'] = 'reduced'
        day_master_result['yongShenCaveat'] = 'borderline' if is_borderline else 'reduced'
        if pre_analysis.get('congGe'):
            day_master_result['geJuStatus'] = 'undetermined_without_hour'

    # Convert seasonal balance to English keys for TypeScript compatibility (display)
    five_elements_balance_en = {
        'wood': five_elements_balance_seasonal.get('木', 0),
        'fire': five_elements_balance_seasonal.get('火', 0),
        'earth': five_elements_balance_seasonal.get('土', 0),
        'metal': five_elements_balance_seasonal.get('金', 0),
        'water': five_elements_balance_seasonal.get('水', 0),
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

    # Per-pillar Kong Wang (each pillar's own void branches)
    kong_wang_per_pillar = {}
    for pname in ['year', 'month', 'day', 'hour']:
        p = pillars[pname]
        if not p['stem']:  # unknown 時辰 — blanked hour pillar
            kong_wang_per_pillar[pname] = []
            continue
        kong_wang_per_pillar[pname] = calculate_kong_wang(p['stem'], p['branch'])

    # R1: 旺相休囚死 seasonal state labels
    seasonal_states = get_seasonal_state_labels(month_branch)

    # F1: 胎元/命宮/胎息/身宮
    # 胎元 (month) + 胎息 (day) survive without the hour; 命宮/身宮 need the 時支 → null.
    tai_yuan = calculate_tai_yuan(month_stem, month_branch)
    tai_xi = calculate_tai_xi(day_master_stem, day_master_branch)
    hour_branch_for_palace = pillars['hour']['branch']
    if hour_branch_for_palace:
        ming_gong = calculate_ming_gong(month_branch, hour_branch_for_palace, year_stem)
        shen_gong = calculate_shen_gong(month_branch, hour_branch_for_palace, year_stem)
    else:
        ming_gong = None
        shen_gong = None

    # F2: Precise 起運 date calculation
    lp_direction = calculate_luck_period_direction(year_stem, gender)
    lp_start_age = calculate_luck_period_start_age(birth_dt, lp_direction)
    luck_period_start_info = calculate_luck_period_start_info(
        birth_dt, lp_direction, lp_start_age,
    )

    # Step 17.5: Compute shen_sha early (needed by both career and annual enhanced)
    all_shen_sha = get_all_shen_sha(pillars)

    # Step 17: Career Enhanced Insights (V2 — only for CAREER reading type)
    career_enhanced = None
    if reading_type and reading_type.upper() == 'CAREER':
        career_enhanced = generate_career_pre_analysis(
            pillars=pillars,
            day_master_stem=day_master_stem,
            gender=gender,
            five_elements_balance=five_elements_balance,
            effective_gods=pre_analysis['effectiveFavorableGods'],
            prominent_god=prominent_god,
            strength_v2=pre_analysis['strengthV2'],
            cong_ge=pre_analysis.get('congGe'),
            luck_periods=luck_periods,
            annual_stars=annual_stars,
            monthly_stars=monthly_stars,
            kong_wang=kong_wang,
            branch_relationships=pre_analysis.get('pillarRelationships', {}).get('branchRelationships'),
            tai_yuan=tai_yuan,
            ming_gong=ming_gong,
            shen_gong=shen_gong,
            birth_year=birth_year,
            current_year=target_year,
        )

    # Step 17b: Love Enhanced Insights (V2 — only for LOVE reading type)
    love_enhanced = None
    if reading_type and reading_type.upper() == 'LOVE':
        from .love_enhanced import generate_love_pre_analysis
        love_enhanced = generate_love_pre_analysis(
            pillars=pillars,
            day_master_stem=day_master_stem,
            gender=gender,
            five_elements_balance=five_elements_balance,
            effective_gods=pre_analysis['effectiveFavorableGods'],
            prominent_god=prominent_god,
            strength_v2=pre_analysis['strengthV2'],
            cong_ge=pre_analysis.get('congGe'),
            luck_periods=luck_periods,
            annual_stars=annual_stars,
            monthly_stars=monthly_stars,
            kong_wang=kong_wang,
            all_shen_sha=all_shen_sha,
            branch_relationships=pre_analysis.get('pillarRelationships', {}).get('branchRelationships'),
            birth_year=birth_year,
            current_year=target_year,
        )

    # Step 18: Annual Enhanced Insights (V2 — only for ANNUAL reading type)
    annual_enhanced = None
    if reading_type and reading_type.upper() == 'ANNUAL':
        from .annual_enhanced import generate_annual_pre_analysis
        annual_enhanced = generate_annual_pre_analysis(
            pillars=pillars,
            day_master_stem=day_master_stem,
            gender=gender,
            five_elements_balance=five_elements_balance,
            effective_gods=pre_analysis['effectiveFavorableGods'],
            prominent_god=prominent_god,
            strength_v2=pre_analysis['strengthV2'],
            cong_ge=pre_analysis.get('congGe'),
            luck_periods=luck_periods,
            annual_stars=annual_stars,
            monthly_stars=monthly_stars,
            kong_wang=kong_wang,
            branch_relationships=pre_analysis.get('pillarRelationships', {}).get('branchRelationships'),
            birth_year=birth_year,
            current_year=target_year,
            shen_sha=all_shen_sha,
        )

    # R5: 空亡 display — day (primary per《神白經》) + year (secondary per 祿命法)
    kong_wang_display = {
        'day': kong_wang_per_pillar['day'],
        'year': kong_wang_per_pillar['year'],
    }

    result = {
        'fourPillars': pillars,
        'hourKnown': hour_known,
        'fiveElementsBalance': five_elements_balance_en,
        'fiveElementsBalanceZh': five_elements_balance_seasonal,
        'fiveElementsBalanceRaw': five_elements_balance,
        'elementCounts': element_counts,
        'dayMaster': day_master_result,
        'dayMasterStem': day_master_stem,
        'dayMasterBranch': day_master_branch,
        'gender': gender,
        'tenGodDistribution': ten_god_distribution,
        'luckPeriods': luck_periods,
        'annualStars': annual_stars,
        'monthlyStars': monthly_stars,
        'trueSolarTime': pillar_data['trueSolarTime'],
        'lunarDate': pillar_data['lunarDate'],
        'kongWang': kong_wang,
        'kongWangPerPillar': kong_wang_per_pillar,
        'allShenSha': all_shen_sha,
        'ganZhi': {
            'year': pillar_data['yearGanZhi'],
            'month': pillar_data['monthGanZhi'],
            'day': pillar_data['dayGanZhi'],
            'hour': pillar_data['hourGanZhi'],
        },
        # Seasonal state labels (旺相休囚死) and Kong Wang display
        'seasonalStates': seasonal_states,
        'kongWangDisplay': kong_wang_display,
        # 胎元/命宮/胎息/身宮
        'taiYuan': tai_yuan,
        'mingGong': ming_gong,
        'taiXi': tai_xi,
        'shenGong': shen_gong,
        # 起運 precise date
        'luckPeriodStartInfo': luck_period_start_info,
        # Phase 11: Pre-analysis layer + summary fields
        'preAnalysis': pre_analysis,
        'lifeStagesSummary': life_stages_summary,
        'kongWangSummary': kong_wang,
        'pillarElements': pillar_elements,
        # Phase 11D: Timing analysis + special day pillars
        'timingInsights': timing_insights,
        'specialDayPillars': special_day_pillars,
        # Phase 12 — Fix 3: 桃花方位 (year-branch primary, day-branch secondary)
        'taohuaDirections': get_taohua_directions(
            pillars['year']['branch'],
            pillars['day']['branch'],
        ),
        # Phase 12 — Fix 4: 文昌貴人方位 (per day stem)
        'wenchangDirection': get_wenchang_direction(day_master_stem),
        # Phase 12 — Fix 4: 生肖貴人 (folk tradition, 六合 + 三合 from year branch)
        'zodiacBenefactors': get_zodiac_benefactors(pillars['year']['branch']),
        # Phase 12 — Fix 2: 調候 advisory (None for 從格 charts)
        'tiaohou': tiaohou_advisory,
    }

    # Conditionally include lifetime enhanced insights
    if lifetime_enhanced is not None:
        result['lifetimeEnhancedInsights'] = lifetime_enhanced

    # Conditionally include career enhanced insights
    if career_enhanced is not None:
        result['careerEnhancedInsights'] = career_enhanced

    # Conditionally include annual enhanced insights
    if annual_enhanced is not None:
        result['annualEnhancedInsights'] = annual_enhanced

    # Conditionally include love enhanced insights
    if love_enhanced is not None:
        result['loveEnhancedInsights'] = love_enhanced

    return result


def calculate_bazi_with_all_pipelines(
    birth_date: str,
    birth_time: Optional[str],
    birth_city: str,
    birth_timezone: str,
    gender: str,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
    target_year: Optional[int] = None,
    hour_known: bool = True,
) -> Dict:
    """
    Calculate a complete Bazi chart AND run all 4 enhanced pipelines (lifetime,
    love, career, annual) regardless of reading_type. Used by the AI chat feature
    so the chat context has access to ALL doctrine flags (傷官見官 valence from
    LOVE pipeline, 比劫奪財 valence, 沖配偶宮 bidirectional, etc.) regardless of
    which reading the user is chatting from.

    The plan's staff-engineer review (Issue 22) caught that the original
    `calculate_bazi(reading_type='LIFETIME')` doesn't compute LOVE/CAREER/ANNUAL
    enhanced insights — so chat would have empty doctrineFlags and the AI would
    fall back to folk doctrine. This function fixes that gap.

    Returns:
        Same shape as `calculate_bazi(reading_type=None)` PLUS guaranteed-present:
        - `lifetimeEnhancedInsights`
        - `loveEnhancedInsights`
        - `careerEnhancedInsights`
        - `annualEnhancedInsights`

    Compute cost: ~50-100ms additional vs base calculate_bazi (each pipeline is
    light deterministic computation). Cached via chat_context cache key.
    """
    if target_year is None:
        target_year = datetime.now().year

    # Step 1: Base calculation with no reading_type → no enhanced pipelines run.
    # This is a no-op cost-wise vs reading_type='LIFETIME' (only the conditional
    # if-blocks at lines 242/325/349/372 are skipped).
    result = calculate_bazi(
        birth_date=birth_date,
        birth_time=birth_time,
        birth_city=birth_city,
        birth_timezone=birth_timezone,
        gender=gender,
        birth_longitude=birth_longitude,
        birth_latitude=birth_latitude,
        target_year=target_year,
        reading_type=None,
        hour_known=hour_known,
    )

    # Step 2: Extract args from base result
    pillars = result['fourPillars']
    day_master_stem = result['dayMasterStem']
    pre_analysis = result['preAnalysis']
    five_elements_balance = result['fiveElementsBalanceRaw']
    effective_gods = pre_analysis['effectiveFavorableGods']
    strength_v2 = pre_analysis['strengthV2']
    cong_ge = pre_analysis.get('congGe')
    luck_periods = result['luckPeriods']
    annual_stars = result['annualStars']
    monthly_stars = result['monthlyStars']
    kong_wang = result['kongWang']
    all_shen_sha = result['allShenSha']
    branch_relationships = (
        pre_analysis.get('pillarRelationships', {}).get('branchRelationships')
    )
    tai_yuan = result['taiYuan']
    ming_gong = result['mingGong']
    shen_gong = result['shenGong']
    birth_year = int(birth_date.split('-')[0])

    # Recompute prominent_god (not exposed in result)
    prominent_god = get_prominent_ten_god(pillars, day_master_stem)

    # Step 3: Run all 4 enhanced pipelines (mirrors the conditional blocks
    # at calculator.py:242, 325, 349, 372 — but unconditional)
    lifetime_enhanced = generate_lifetime_enhanced_insights(
        pillars=pillars,
        day_master_stem=day_master_stem,
        gender=gender,
        five_elements_balance=five_elements_balance,
        effective_gods=effective_gods,
        prominent_god=prominent_god,
        strength_v2=strength_v2,
        cong_ge=cong_ge,
        tougan_analysis=pre_analysis.get('touganAnalysis', []),
        ten_god_position_analysis=pre_analysis.get('tenGodPositionAnalysis', []),
        luck_periods=luck_periods,
        annual_stars=annual_stars,
        kong_wang=kong_wang,
        branch_relationships=branch_relationships,
        birth_year=birth_year,
        current_year=target_year,
    )

    career_enhanced = generate_career_pre_analysis(
        pillars=pillars,
        day_master_stem=day_master_stem,
        gender=gender,
        five_elements_balance=five_elements_balance,
        effective_gods=effective_gods,
        prominent_god=prominent_god,
        strength_v2=strength_v2,
        cong_ge=cong_ge,
        luck_periods=luck_periods,
        annual_stars=annual_stars,
        monthly_stars=monthly_stars,
        kong_wang=kong_wang,
        branch_relationships=branch_relationships,
        tai_yuan=tai_yuan,
        ming_gong=ming_gong,
        shen_gong=shen_gong,
        birth_year=birth_year,
        current_year=target_year,
    )

    from .love_enhanced import generate_love_pre_analysis
    love_enhanced = generate_love_pre_analysis(
        pillars=pillars,
        day_master_stem=day_master_stem,
        gender=gender,
        five_elements_balance=five_elements_balance,
        effective_gods=effective_gods,
        prominent_god=prominent_god,
        strength_v2=strength_v2,
        cong_ge=cong_ge,
        luck_periods=luck_periods,
        annual_stars=annual_stars,
        monthly_stars=monthly_stars,
        kong_wang=kong_wang,
        all_shen_sha=all_shen_sha,
        branch_relationships=branch_relationships,
        birth_year=birth_year,
        current_year=target_year,
    )

    from .annual_enhanced import generate_annual_pre_analysis
    annual_enhanced = generate_annual_pre_analysis(
        pillars=pillars,
        day_master_stem=day_master_stem,
        gender=gender,
        five_elements_balance=five_elements_balance,
        effective_gods=effective_gods,
        prominent_god=prominent_god,
        strength_v2=strength_v2,
        cong_ge=cong_ge,
        luck_periods=luck_periods,
        annual_stars=annual_stars,
        monthly_stars=monthly_stars,
        kong_wang=kong_wang,
        branch_relationships=branch_relationships,
        birth_year=birth_year,
        current_year=target_year,
        shen_sha=all_shen_sha,
    )

    # Step 4: Merge enhanced outputs into result
    result['lifetimeEnhancedInsights'] = lifetime_enhanced
    result['loveEnhancedInsights'] = love_enhanced
    result['careerEnhancedInsights'] = career_enhanced
    result['annualEnhancedInsights'] = annual_enhanced

    return result


def calculate_bazi_compatibility(
    birth_data_a: Dict,
    birth_data_b: Dict,
    comparison_type: str = 'romance',
    current_year: Optional[int] = None,
) -> Dict:
    """
    Calculate compatibility between two people's Bazi charts.

    Uses the enhanced 8-dimension scoring engine with sigmoid amplification,
    knockout conditions, and full pre-analysis for AI narration.

    Args:
        birth_data_a: Birth data for person A (same format as calculate_bazi args)
        birth_data_b: Birth data for person B
        comparison_type: 'romance', 'business', 'friendship', or 'parent_child'
        current_year: Current year for timing analysis (defaults to datetime.now().year)

    Returns:
        Compatibility analysis including:
        - chartA, chartB: Individual Bazi charts
        - compatibility: Legacy simple compatibility (for backward compat)
        - compatibilityEnhanced: 8-dimension enhanced scoring
        - compatibilityPreAnalysis: Structured pre-analysis for AI narration
    """
    if current_year is None:
        current_year = datetime.now().year

    # Calculate individual charts
    chart_a = calculate_bazi(**birth_data_a)
    chart_b = calculate_bazi(**birth_data_b)

    # Extract gender from birth data
    gender_a = birth_data_a.get('gender', 'male')
    gender_b = birth_data_b.get('gender', 'male')

    # Legacy compatibility (backward compatibility)
    compat_legacy = calculate_compatibility(chart_a, chart_b, comparison_type)

    # Extract pre-analysis from charts
    pre_analysis_a = chart_a.get('preAnalysis', {})
    pre_analysis_b = chart_b.get('preAnalysis', {})

    # Extract shen sha lists
    shen_sha_a = chart_a.get('allShenSha', [])
    shen_sha_b = chart_b.get('allShenSha', [])

    # Extract luck periods
    luck_periods_a = chart_a.get('luckPeriods', [])
    luck_periods_b = chart_b.get('luckPeriods', [])

    # Enhanced 8-dimension compatibility
    compat_enhanced = calculate_enhanced_compatibility(
        chart_a=chart_a,
        chart_b=chart_b,
        pre_analysis_a=pre_analysis_a,
        pre_analysis_b=pre_analysis_b,
        gender_a=gender_a,
        gender_b=gender_b,
        comparison_type=comparison_type,
        current_year=current_year,
        shen_sha_a=shen_sha_a,
        shen_sha_b=shen_sha_b,
        luck_periods_a=luck_periods_a,
        luck_periods_b=luck_periods_b,
    )

    # Pre-analysis for AI narration (Layer 2)
    compat_pre_analysis = generate_compatibility_pre_analysis(
        chart_a=chart_a,
        chart_b=chart_b,
        compat_result=compat_enhanced,
        pre_analysis_a=pre_analysis_a,
        pre_analysis_b=pre_analysis_b,
        gender_a=gender_a,
        gender_b=gender_b,
        comparison_type=comparison_type,
        current_year=current_year,
        shen_sha_a=shen_sha_a,
        shen_sha_b=shen_sha_b,
    )

    result = {
        'chartA': chart_a,
        'chartB': chart_b,
        'compatibility': compat_legacy,
        'compatibilityEnhanced': compat_enhanced,
        'compatibilityPreAnalysis': compat_pre_analysis,
    }

    # Romance V2: add enhanced romance pre-analysis alongside existing data
    if comparison_type == 'romance':
        from .compatibility_romance_preanalysis import (
            compute_compatibility_romance_preanalysis,
        )
        result['romancePreAnalysis'] = compute_compatibility_romance_preanalysis(
            chart_a=chart_a,
            chart_b=chart_b,
            gender_a=gender_a,
            gender_b=gender_b,
            enhanced_data=compat_enhanced,
            current_year=current_year,
        )

    return result
