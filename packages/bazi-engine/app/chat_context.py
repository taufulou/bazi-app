"""
Chat Context Builder — produces the slim grounded payload that the AI chat
feature ships to Anthropic for every user message.

Per the next-the-big-feature-proud-manatee plan:

1. **4-pipeline merge**: calls `calculate_bazi_with_all_pipelines()` (in
   calculator.py) which always runs lifetime + love + career + annual
   enhanced pipelines regardless of reading_type. The plan's staff review
   (Issue 22) caught that the original `calculate_bazi(reading_type='LIFETIME')`
   only computes lifetime — leaving love/career/annual doctrine flags empty
   for the chat AI, defaulting to folk doctrine. This module fixes that.

2. **Slim**: targets ~8-12k tokens (down from full ~15-20k). Keeps
   anti-hallucination anchor fields (narrativeAnchors, tougan_analysis,
   ten_god_position_analysis, all 8 luckPeriods, all 15 annualForecast,
   doctrineFlags). Drops prose-heavy fields the AI doesn't need.

3. **Chinese injectors**: pre-formats deterministic Chinese sentences for
   each triggered doctrine flag (e.g., 傷官見官 valence='beneficial' framing).
   Server-side composed; AI consumes verbatim — no room for folk doctrine
   override. Mirrors the `interpolateLoveV2Fields` pattern in
   `apps/api/src/ai/ai.service.ts:3794-3837`.

Public API:
    build_chat_context(chart_data, current_year, current_month) -> dict
    build_chat_context_compat(birth_data_a, birth_data_b, comparison_type, current_year, current_month) -> dict
    build_chat_context_fortune(birth_data, anchor_date, current_year, current_month, precomputed_daily=None) -> dict
"""

from typing import Any, Dict, List, Optional


# ============================================================
# Phase 3 — COMPATIBILITY chat slim filter
# ============================================================

# Round-3 HIGHEST fix: chat_context's _extract_doctrine_flags emits 7 keys
# total (4 LOVE + patternClassification, isCongGe, careerPatternType).
# For COMPATIBILITY chat slim, filter to ONLY the 4 LOVE-domain keys to avoid
# leaking CAREER/LIFETIME doctrine flags into the compat slim payload.
LOVE_DOCTRINE_FLAG_KEYS = frozenset({
    'shangguanJianGuan',
    'biJieDuoCai',
    'guanShaHunZa',
    'spousePalaceFrictions',
})


# ============================================================
# Public API
# ============================================================


def build_chat_context(
    chart_data: Dict,
    current_year: int,
    current_month: int,
) -> Dict:
    """
    Build the slim, grounded chat context payload from a full chart calculation.

    Args:
        chart_data: Output of `calculator.calculate_bazi_with_all_pipelines()`.
            MUST have all 4 enhanced-insights keys present (lifetime/love/
            career/annual). Will raise KeyError if not.
        current_year: Year for forecasts (defaults to chart_data's target_year
            if not specified separately by caller).
        current_month: Month 1-12 for monthly forecast pinning.

    Returns:
        Dict with structure:
            chart, strength, favorability, fiveElements, patternNarrative,
            narrativeAnchors, call2NarrativeAnchors, tougan_analysis,
            ten_god_position_analysis, luckPeriods, annualForecast15,
            monthlyForecast12, romance, career, relationships, shensha,
            doctrineFlags, doctrineInjectors
    """
    # Validate required pipeline outputs
    required = (
        'lifetimeEnhancedInsights',
        'loveEnhancedInsights',
        'careerEnhancedInsights',
        'annualEnhancedInsights',
    )
    missing = [k for k in required if k not in chart_data]
    if missing:
        raise ValueError(
            f"chat_context requires all 4 enhanced pipeline outputs, "
            f"missing: {missing}. Call `calculate_bazi_with_all_pipelines()` "
            f"instead of `calculate_bazi()`."
        )

    lifetime = chart_data['lifetimeEnhancedInsights']
    love = chart_data['loveEnhancedInsights']
    career = chart_data['careerEnhancedInsights']
    annual = chart_data['annualEnhancedInsights']
    pre_analysis = chart_data.get('preAnalysis', {})

    chart = _extract_chart_facts(chart_data, current_year)
    strength = _extract_strength(chart_data, pre_analysis)
    favorability = _extract_favorability(pre_analysis)
    five_elements = _extract_five_elements(chart_data)
    luck_periods = _compact_luck_periods(chart_data.get('luckPeriods', []))
    annual_forecast_15 = _compact_annual_forecast(
        chart_data.get('annualStars', []),
        max_count=15,
    )
    monthly_forecast_12 = _compact_monthly_forecasts(
        annual.get('monthlyForecasts', []),
    )

    romance = _extract_romance(lifetime, love, current_year)
    career_block = _extract_career(lifetime, career)
    relationships = _extract_relationships(lifetime, chart_data)

    doctrine_flags = _extract_doctrine_flags(lifetime, love, career, annual)
    doctrine_injectors = _build_chinese_injection_blocks(
        doctrine_flags,
        chart_data,
        current_year,
    )

    return {
        'chart': chart,
        'strength': strength,
        'favorability': favorability,
        'fiveElements': five_elements,
        'tenGodCount': _extract_ten_god_count(chart_data),
        'branchInteractions': _extract_branch_interactions_per_year(
            chart_data, annual_forecast_15,
        ),
        'patternNarrative': lifetime.get('patternNarrative'),
        'narrativeAnchors': lifetime.get('narrativeAnchors'),
        'call2NarrativeAnchors': lifetime.get('call2NarrativeAnchors'),
        'touganAnalysis': pre_analysis.get('touganAnalysis', []),
        'tenGodPositionAnalysis': pre_analysis.get('tenGodPositionAnalysis', []),
        'luckPeriods': luck_periods,
        'annualForecast15': annual_forecast_15,
        'monthlyForecast12': monthly_forecast_12,
        'romance': romance,
        'career': career_block,
        'relationships': relationships,
        'shensha': _extract_shensha_summary(chart_data.get('allShenSha', {})),
        'doctrineFlags': doctrine_flags,
        'doctrineInjectors': doctrine_injectors,
    }


# ============================================================
# Phase 3 — COMPATIBILITY chat context (two charts)
# ============================================================


def build_chat_context_compat(
    birth_data_a: Dict,
    birth_data_b: Dict,
    comparison_type: str,
    current_year: int,
    current_month: int,
) -> Dict:
    """
    Build the slim chat context for COMPATIBILITY chat. References two
    BirthProfiles instead of a single BaziReading.

    Args:
        birth_data_a: Same shape as `calculate_bazi_with_all_pipelines` args
            (birth_date, birth_time, birth_city, birth_timezone, gender,
            birth_longitude, birth_latitude). For user A (the chat user).
        birth_data_b: Same shape for user B (the partner).
        comparison_type: 'romance' (Phase 3 only) | 'business' | 'friendship'
            — case-sensitive lowercase per compatibility_enhanced.py:252.
        current_year, current_month: Time anchors for forecasts.

    Returns:
        Slim chat context with:
            - comparisonType, targetYear
            - overallScore, adjustedScore, verbalLabel
            - dimensionScores (slimmed)
            - chartA, chartB (per-party slims with LOVE-only doctrineFlags filter)
            - crossChartFindings (三刑/半刑/子卯刑/六沖/六害 from spousePalace dim)
            - weddingTimingIndicators, conflictWarningYears, interactionPatterns
    """
    # Import here to avoid circular dep (calculator.py imports chat_context indirectly)
    from .calculator import calculate_bazi_with_all_pipelines
    from .compatibility_enhanced import calculate_enhanced_compatibility

    # 1. Compute full per-chart pipelines for both parties
    chart_a = calculate_bazi_with_all_pipelines(
        birth_date=birth_data_a['birth_date'],
        birth_time=birth_data_a['birth_time'],
        birth_city=birth_data_a['birth_city'],
        birth_timezone=birth_data_a['birth_timezone'],
        gender=birth_data_a['gender'],
        birth_longitude=birth_data_a.get('birth_longitude'),
        birth_latitude=birth_data_a.get('birth_latitude'),
        target_year=current_year,
    )
    chart_b = calculate_bazi_with_all_pipelines(
        birth_date=birth_data_b['birth_date'],
        birth_time=birth_data_b['birth_time'],
        birth_city=birth_data_b['birth_city'],
        birth_timezone=birth_data_b['birth_timezone'],
        gender=birth_data_b['gender'],
        birth_longitude=birth_data_b.get('birth_longitude'),
        birth_latitude=birth_data_b.get('birth_latitude'),
        target_year=current_year,
    )

    # 2. Per-party slim contexts (full romance pre-analysis kept)
    ctx_a = build_chat_context(chart_a, current_year, current_month)
    ctx_b = build_chat_context(chart_b, current_year, current_month)

    # 3. Run enhanced compat scoring (case-sensitive lowercase comparison_type)
    pre_analysis_a = chart_a.get('preAnalysis', {})
    pre_analysis_b = chart_b.get('preAnalysis', {})
    compat = calculate_enhanced_compatibility(
        chart_a=chart_a,
        chart_b=chart_b,
        pre_analysis_a=pre_analysis_a,
        pre_analysis_b=pre_analysis_b,
        gender_a=birth_data_a.get('gender', 'male'),
        gender_b=birth_data_b.get('gender', 'male'),
        comparison_type=comparison_type.lower(),  # engine matches lowercase
        current_year=current_year,
        shen_sha_a=chart_a.get('allShenSha', []),
        shen_sha_b=chart_b.get('allShenSha', []),
        luck_periods_a=chart_a.get('luckPeriods', []),
        luck_periods_b=chart_b.get('luckPeriods', []),
    )

    return {
        # Normalize to lowercase to match engine's storage (compatibility_enhanced.py
        # uses lowercase comparison_type internally) and the Pydantic HTTP-layer
        # pattern (`^(romance|business|friendship)$`). Without this, callers who
        # bypass the HTTP layer (e.g., direct Python tests passing 'ROMANCE')
        # see an inconsistent uppercase value in the return dict.
        'comparisonType': comparison_type.lower(),
        'targetYear': current_year,
        # Engine emits BOTH overallScore (raw) and adjustedScore (with knockout
        # conditions applied — this is what `label` is computed from per
        # compatibility_enhanced.py:1751-1759). Surface both for transparency.
        'overallScore': compat.get('overallScore'),
        'adjustedScore': compat.get('adjustedScore'),
        # COMPATIBILITY_LABELS (8 base) + SPECIAL_LABEL overrides
        # (相愛相殺/前世冤家/命中注定) — 11 possible values total. NO parallel
        # banding here — engine is source of truth.
        'verbalLabel': compat.get('label'),
        'dimensionScores': _slim_compat_dimensions(compat.get('dimensionScores', {})),
        'chartA': _slim_party_for_compat(ctx_a),
        'chartB': _slim_party_for_compat(ctx_b),
        'crossChartFindings': _extract_cross_chart_findings(compat),
        'specialFindings': compat.get('specialFindings', {}),
        'knockoutConditions': compat.get('knockoutConditions', []),
        # H1 (Phase 3 follow-up) — surface engine's `timingSync` from
        # compatibility_enhanced.py:1798-1801. Pre-slimmed at engine
        # (goldenYears/challengeYears each capped at 5 entries via
        # compatibility_enhanced.py:1273-1274; entry shape:
        # {'year': int, 'reason': str}). Load-bearing for `wedding_timing`
        # + `conflict_warning` sample-question answers.
        'timingSync': compat.get('timingSync', {}),
    }


# ============================================================
# Phase Fortune — FORTUNE chat context (single chart + day's fortune)
# ============================================================


def build_chat_context_fortune(
    birth_data: Dict,
    anchor_date: str,
    current_year: int,
    current_month: int,
    precomputed_daily: Optional[Dict] = None,
    precomputed_monthly: Optional[Dict] = None,
    fortune_scope: str = 'DAY',
) -> Dict:
    """Build the slim chat context for FORTUNE chat (八字日運 / 月運 chat scope).

    Merges single-chart 4-pipeline slim (lifetime/love/career/annual) PLUS
    the day's OR month's fortune output (per `fortune_scope`). The chat AI
    inherits ALL chart-level Phase 12 doctrine via the merged slim's
    `doctrineFlags` + `doctrineInjectors`.

    DAY scope: day-pillar TRANSIENT findings (Phase 12h.B day-of valence,
    沖日支, 紅鸞 day trigger, etc.) ride in `dailyFortune.dimensions[].signals`.

    MONTH scope (Phase 2.x L3.5b): month-pillar TRANSIENT findings (Phase 12c
    Fix C 殺印相生, 月柱沖刑, intra-month breakdown) ride in
    `monthlyFortune.dimensions[].signals` + `monthlyFortune.intraMonthBreakdown`.

    Args:
        birth_data: chart identity (birth_date/time/city/timezone/gender/long/lat)
        anchor_date: ISO date string `YYYY-MM-DD`. For MONTH scope, the day
            component is ignored — month is derived as `YYYY-MM`.
        current_year, current_month: flow-year / flow-month anchors for the
            base chart-slim context. Should typically match the anchor_date.
        precomputed_daily: optional engine output from
            `DailyFortuneSnapshot.engineOutputJson` (DAY scope only).
        precomputed_monthly: optional engine output from MONTH snapshot —
            same Issue-1 reuse path as `precomputed_daily` but for monthly.
        fortune_scope: 'DAY' (default, back-compat) or 'MONTH'. YEAR deferred
            to Phase 3.

    Returns:
        Slim payload with all `build_chat_context` fields PLUS:
            - `anchorDate`: the ISO string passed in
            - `fortuneScope`: echoed from input (lets downstream consumers + AI
              prompt rule know which doctrine surface is loaded)
            - `dailyFortune` (DAY scope only): slim dict of day's fortune
            - `monthlyFortune` (MONTH scope only): slim dict of month's fortune
              + intraMonthBreakdown sibling

    Raises:
        ValueError: anchor_date not parseable, scope unknown, or chart-pipeline
            output missing required enhanced-insights keys.
    """
    # Import here to avoid circular dep (calculator + daily_enhanced import
    # chat_context-adjacent modules indirectly)
    from datetime import date as _date
    from .calculator import calculate_bazi_with_all_pipelines
    from .daily_enhanced import compute_daily_fortune
    from .monthly_enhanced import (
        compute_intra_month_breakdown,
        compute_single_month_by_yearmonth,
    )

    # Validate scope
    if fortune_scope not in ('DAY', 'MONTH'):
        raise ValueError(
            f"fortune_scope must be 'DAY' or 'MONTH' (YEAR is Phase 3 deferred), "
            f"got: {fortune_scope!r}"
        )

    # Validate + parse anchor_date
    try:
        anchor_date_obj = _date.fromisoformat(anchor_date)
    except (ValueError, TypeError) as exc:
        raise ValueError(
            f"anchor_date must be YYYY-MM-DD ISO format, got: {anchor_date!r}"
        ) from exc

    # 1. Full chart pipeline (always all 4 enhanced pipelines per chat
    # doctrine — Phase 1 Layer 1 fix). Same shape passed to
    # build_chat_context downstream.
    chart = calculate_bazi_with_all_pipelines(
        birth_date=birth_data['birth_date'],
        birth_time=birth_data['birth_time'],
        birth_city=birth_data['birth_city'],
        birth_timezone=birth_data['birth_timezone'],
        gender=birth_data['gender'],
        birth_longitude=birth_data.get('birth_longitude'),
        birth_latitude=birth_data.get('birth_latitude'),
        target_year=current_year,
    )

    # 2. Build the chart-slim base (gives doctrineFlags / doctrineInjectors /
    # narrativeAnchors / luckPeriods / monthlyForecast12 / romance / etc.).
    # FORTUNE chat inherits ALL chart-level Phase 12 doctrine through this.
    base_ctx = build_chat_context(
        chart_data=chart,
        current_year=current_year,
        current_month=current_month,
    )

    # 3. Scope dispatch — DAY → compute_daily_fortune + dailyFortune slim;
    #    MONTH → compute_single_month_by_yearmonth + monthlyFortune slim.
    if fortune_scope == 'MONTH':
        if precomputed_monthly is not None:
            monthly_result = precomputed_monthly
        else:
            monthly_result = compute_single_month_by_yearmonth(
                birth_date=birth_data['birth_date'],
                birth_time=birth_data['birth_time'],
                birth_city=birth_data['birth_city'],
                birth_timezone=birth_data['birth_timezone'],
                gender=birth_data['gender'],
                year=anchor_date_obj.year,
                month=anchor_date_obj.month,
                birth_longitude=birth_data.get('birth_longitude'),
                birth_latitude=birth_data.get('birth_latitude'),
            )
            # Wire L1.b breakdown into chat-context MONTH path (mirrors the
            # /monthly-fortune endpoint behavior — see main.py:821). Lets the
            # chat AI answer «本月上半月vs下半月有什麼差別?» questions grounded
            # in real bucket stats. Defensive try/except — L1.b failure doesn't
            # block the rest of the chat context. Skipped when caller passed
            # precomputed_monthly (assumed to already include breakdown).
            try:
                breakdown_result = compute_intra_month_breakdown(
                    birth_date=birth_data['birth_date'],
                    birth_time=birth_data['birth_time'],
                    birth_city=birth_data['birth_city'],
                    birth_timezone=birth_data['birth_timezone'],
                    gender=birth_data['gender'],
                    year=anchor_date_obj.year,
                    month=anchor_date_obj.month,
                    birth_longitude=birth_data.get('birth_longitude'),
                    birth_latitude=birth_data.get('birth_latitude'),
                )
                monthly_result['intraMonthBreakdown'] = breakdown_result
            except Exception as breakdown_err:
                # Log + omit field (chat AI gets the bare month; intraMonthBreakdown
                # questions won't be answerable but rest of chat works).
                print(f"WARN chat_context L1.b breakdown failed: {breakdown_err}")
        return {
            **base_ctx,
            'anchorDate': anchor_date,
            'fortuneScope': 'MONTH',
            'monthlyFortune': _slim_monthly_for_chat(monthly_result),
        }

    # DAY scope (default) — original behavior.
    if precomputed_daily is not None:
        daily_result = precomputed_daily
    else:
        day_master = chart['dayMaster']
        effective_gods = {
            'usefulGod': day_master.get('usefulGod', ''),
            'favorableGod': day_master.get('favorableGod', ''),
            'idleGod': day_master.get('idleGod', ''),
            'tabooGod': day_master.get('tabooGod', ''),
            'enemyGod': day_master.get('enemyGod', ''),
        }
        is_cong_ge = bool(
            chart.get('lifetimeEnhancedInsights', {})
                 .get('deterministic', {})
                 .get('cong_ge_detected')
        )
        flow_year_data = (
            chart.get('annualEnhancedInsights', {}).get('flowYear', {})
        )
        daily_result = compute_daily_fortune(
            pillars=chart['fourPillars'],
            day_master_stem=chart['dayMasterStem'],
            effective_gods=effective_gods,
            useful_god_element=day_master.get('usefulGod', '土'),
            gender=birth_data.get('gender', 'male'),
            kong_wang=chart.get('kongWang', []),
            strength=day_master.get('strength', 'neutral'),
            is_cong_ge=is_cong_ge,
            target_date=anchor_date_obj,
            flow_year_stem=flow_year_data.get('stem', ''),
            flow_year_auspiciousness=flow_year_data.get('auspiciousness', '平'),
        )

    return {
        **base_ctx,
        'anchorDate': anchor_date,
        'fortuneScope': 'DAY',
        'dailyFortune': _slim_daily_for_chat(daily_result),
    }


def _slim_daily_for_chat(daily: Dict) -> Dict:
    """Slim `compute_daily_fortune` output for chat consumption.

    Keeps user-facing fields the AI must cite verbatim or reason from.
    Drops engine-internal fields:
      - `chartContext` (redundant — base_ctx already has chart data)
      - `monthly_result` spread leftovers like stem-branch role/score
      - `preAnalysisVersion` (engine-internal cache token)

    Preserves Phase 1 Option 2.5 transparency fields
    (`rawStructuralAuspiciousness` / `rawDailyAuspiciousness` /
    `flowMonthAuspiciousness`) — the AI prompt's anti-incoherence rule keys
    off these to avoid mistakenly framing the day with the month's
    independent theme.
    """
    if not daily:
        return {}
    return {
        'dayStem': daily.get('dayStem'),
        'dayBranch': daily.get('dayBranch'),
        'dayGanZhi': daily.get('dayGanZhi'),
        'dayTenGod': daily.get('dayTenGod'),
        'dateIso': daily.get('dateIso'),
        'auspiciousness': daily.get('auspiciousness'),
        'energyScore': daily.get('energyScore'),
        'metaFraming': daily.get('metaFraming'),
        # Option 2.5 transparency — load-bearing for AI anti-incoherence
        'rawStructuralAuspiciousness': daily.get('rawStructuralAuspiciousness'),
        'rawDailyAuspiciousness': daily.get('rawDailyAuspiciousness'),
        'flowMonthAuspiciousness': daily.get('flowMonthAuspiciousness'),
        'perDaySoftening': daily.get('perDaySoftening', []),
        # 5 dimension blocks {romance, career, finance, travel, health} — each
        # with score, label, narrative, signals[]. The signals[] are what the
        # NestJS-side interpolateFortuneV1Fields injector reads to emit
        # day-pillar TRANSIENT doctrine sentences.
        'dimensions': daily.get('dimensions', {}),
        # Pre-rendered Chinese pill-line strings (Option 2.5 UI layer)
        'headlinerSignals': daily.get('headlinerSignals'),
        # Static 用神 wealth direction (Phase 12 Fix 2 mapping)
        'folkContent': daily.get('folkContent'),
    }


def _slim_monthly_for_chat(monthly: Dict) -> Dict:
    """Phase 2.x L3.5b — slim `compute_single_month_by_yearmonth` output for
    chat consumption. Mirror of `_slim_daily_for_chat` scaled to MONTH scope.

    Keeps user-facing fields the AI must cite verbatim or reason from.
    Drops engine-internal fields:
      - `chartContext` (redundant — base_ctx already has chart data)
      - `preAnalysisVersion` (engine-internal cache token)
      - `targetYear` / `targetMonth` (caller passes anchor_date)

    Includes `intraMonthBreakdown` (L1.b) so chat AI can answer questions
    like «本月上半月vs下半月有什麼差別?» grounded in the structured per-bucket
    stats (auspicious_days / challenging_days / dominant_shensha / peak_signals).
    Per glossary: camelCase `intraMonthBreakdown` is a SIBLING of monthly
    block (not nested inside dimensions / engineOutput).

    Folk content OMITTED per Phase 2 locked decision #6 — DAY-only differentiator.
    """
    if not monthly:
        return {}
    return {
        'monthStem': monthly.get('monthStem'),
        'monthBranch': monthly.get('monthBranch'),
        'monthGanZhi': monthly.get('monthGanZhi'),
        'monthTenGod': monthly.get('monthTenGod'),
        'monthLabel': monthly.get('monthLabel'),
        'auspiciousness': monthly.get('auspiciousness'),
        'energyScore': monthly.get('energyScore'),
        'metaFraming': monthly.get('metaFraming'),
        'flowYear': monthly.get('flowYear'),
        # Phase 12b/12c transparency fields (optional — present when fired)
        'baseAuspiciousness': monthly.get('baseAuspiciousness'),
        'bareMonthAuspiciousness': monthly.get('bareMonthAuspiciousness'),
        # Phase 12b/c additive fields — surfaced for deterministic AI injection
        'officerSealActivation': monthly.get('officerSealActivation'),
        'fuYinInteractions': monthly.get('fuYinInteractions'),
        'chongKuRelease': monthly.get('chongKuRelease'),
        'liuHaiInteractions': monthly.get('liuHaiInteractions'),
        # 4 dimension blocks {career, finance, romance, health} — NO travel
        # (Sub-Agent B doctrine lock per Phase 2 plan v4 locked decision #5).
        # signals[] drive any future interpolateFortuneMonthlyFields injector.
        'dimensions': monthly.get('dimensions', {}),
        # Locked partition spec (tiangan_dizhi_half — 2 buckets per Sub-Agent A)
        'partitionSpec': monthly.get('partitionSpec'),
        # L1.b intra-month breakdown (sibling per glossary): per-bucket day
        # counts + dominant 神煞 + peak signals. Drives chat answers re:
        # 上半月/下半月 dynamics.
        'intraMonthBreakdown': monthly.get('intraMonthBreakdown'),
        'ruleTrace': monthly.get('ruleTrace', []),
    }


def _romance_for_compat_party(romance: Dict) -> Dict:
    """
    H4 (Phase 3 follow-up) — strip fields describing the party's IDEAL
    spouse (= the OTHER party in compat) from the per-party romance block
    before it ships to the chat AI. Belt-and-suspenders on top of the K-3
    prompt rule which tells the AI not to use these fields.

    Per `love_enhanced.py:1167-1196`, `marriagePalace.personalityArchetype`
    and `marriagePalace.appearance.*` are computed from the day-branch
    ten-god (= spouse star) — they describe what kind of spouse this
    party attracts/wants, NOT this party's own personality.

    For B-the-person traits, the AI should consume `lovePersonality.*`
    (Phase 12g.4 polarity-aware library). The personality layer inside
    marriagePalace also describes the IDEAL spouse — strip too.

    Returns a SHALLOW copy with the ideal-spouse fields removed. Keeps
    spousePalace meta (day branch, twelve-stage, kong-wang, frictions)
    + lovePersonality + romance timing fields untouched.
    """
    if not romance:
        return romance
    filtered = dict(romance)
    # Drop spouseStarAnalysis entirely — describes IDEAL spouse traits
    filtered.pop('spouseStarAnalysis', None)
    # Filter spousePalace: drop ideal-spouse describing keys, keep meta
    palace = filtered.get('spousePalace')
    if isinstance(palace, dict):
        IDEAL_SPOUSE_KEYS = {
            'appearance',            # Phase 12g.4 appearance layer (ideal spouse)
            'appearanceHint',        # legacy
            'appearanceGrade',       # legacy
            'appearanceNote',        # legacy
            'personalityArchetype',  # legacy palace_archetype (ideal spouse)
            'personality',           # Phase 12g.4 personality layer (ideal spouse — same palace_archetype)
        }
        filtered['spousePalace'] = {
            k: v for k, v in palace.items() if k not in IDEAL_SPOUSE_KEYS
        }
    return filtered


def _slim_party_for_compat(ctx: Dict) -> Dict:
    """
    Per-party slim for COMPATIBILITY chat. Drops per-party career/annual
    timing (luckPeriods/annualForecast15/monthlyForecast12) — those are
    out-of-scope; COMPAT chat only answers LOVE-related topics.

    Filters doctrineFlags to the 4 LOVE-domain keys (drops
    patternClassification, isCongGe, careerPatternType — CAREER/LIFETIME-only
    flags that would mislead the compat AI). doctrineInjectors already only
    emits 4 LOVE-domain entries so passes through.

    H4 (Phase 3 follow-up): romance is filtered via `_romance_for_compat_party`
    to drop fields describing the IDEAL spouse (which is the OTHER party in
    compat context — confusing self-reference trap).

    H5 (Phase 3 follow-up): restored 4 anti-hallucination anchors from the
    single-chart slim — `patternNarrative`, `narrativeAnchors`,
    `touganAnalysis`, `tenGodPositionAnalysis`. These prevent the AI from
    hallucinating 透干 vs 藏干 distinctions, 格局 classifications, 六親
    chains. `narrativeAnchors.spouse_appearance` is stripped at copy time
    (same H4 ideal-spouse rationale).

    H5 fallback ladder step 1 applied: `call2NarrativeAnchors` is NOT
    restored. Its content is LIFETIME-Call-2 specific narration (annual
    career / annual romance) — the shared chat-prompt rule «錨點事實句」
    accommodates its absence (it says «when available, use them» — when
    absent, AI just doesn't reference). Restoring it doubled the slim
    char count to ~35k (vs 15k cap) on Roger×Laopo because each anchor
    array contains 3-5 narrated sentences × 2 charts.
    """
    # H5 — narrativeAnchors restored but with spouse_appearance key stripped
    # (per love_enhanced.py:2694 it's computed from marriagePalace and
    # describes the IDEAL spouse).
    raw_anchors = ctx.get('narrativeAnchors')
    if isinstance(raw_anchors, dict):
        narrative_anchors = {
            k: v for k, v in raw_anchors.items() if k != 'spouse_appearance'
        }
    else:
        narrative_anchors = raw_anchors

    return {
        'chart': ctx['chart'],
        'strength': ctx['strength'],
        'favorability': ctx['favorability'],
        'fiveElements': ctx['fiveElements'],
        'tenGodCount': ctx['tenGodCount'],
        # H5 — anti-hallucination anchors (consumed by COMPATIBILITY
        # prompts at apps/api/src/chat/chat-context.service.ts:88-92).
        # call2NarrativeAnchors dropped per fallback-ladder step 1 (token
        # budget — see docstring).
        'patternNarrative': ctx.get('patternNarrative'),
        'narrativeAnchors': narrative_anchors,
        'touganAnalysis': ctx.get('touganAnalysis', []),
        'tenGodPositionAnalysis': ctx.get('tenGodPositionAnalysis', []),
        # H4 — strip ideal-spouse fields from romance
        'romance': _romance_for_compat_party(ctx['romance']),
        'relationships': ctx['relationships'],
        # Filter to LOVE keys only
        'doctrineFlags': {
            k: v for k, v in ctx['doctrineFlags'].items()
            if k in LOVE_DOCTRINE_FLAG_KEYS
        },
        'doctrineInjectors': ctx['doctrineInjectors'],  # Already 4 LOVE keys
    }


def _slim_compat_dimensions(dimension_scores: Dict) -> Dict:
    """
    Compact dimension scores from `calculate_enhanced_compatibility`. Keeps
    score + label + 1-line description per dim; drops verbose findings prose
    (per-finding narrativeHints are retained because they cite specific
    branches/stems — load-bearing for AI grounding).
    """
    out = {}
    for dim_key, dim_data in dimension_scores.items():
        if not isinstance(dim_data, dict):
            continue
        # L1 (Phase 3 follow-up) — truncate per-finding narrativeHint to
        # 150 chars (string-only). Numeric/list/dict fields untouched.
        raw_findings = dim_data.get('findings', [])
        slim_findings = [
            _truncate_narrative_hint(f) if isinstance(f, dict) else f
            for f in raw_findings
        ]
        out[dim_key] = {
            'score': dim_data.get('score'),
            'label': dim_data.get('label'),
            'weight': dim_data.get('weight'),
            # Keep findings — Phase 12i 三刑/半刑/子卯刑 etc. live here for
            # the spousePalace dim
            'findings': slim_findings,
        }
    return out


_NARRATIVE_HINT_MAX_CHARS = 150  # L1 cap for verbose narrative strings


def _truncate_narrative_hint(finding: Dict) -> Dict:
    """
    L1 (Phase 3 follow-up) — cap `narrativeHint` strings at 150 chars to
    prevent token-budget bloat from verbose Phase 12i 三刑/半刑 narrative
    hints. Only truncates STRING values via `isinstance(nh, str)` guard —
    numeric/list/dict fields (e.g. severity int, finding type) pass
    through untouched.

    Returns a shallow copy when truncation applies; returns the original
    dict when narrativeHint is absent or non-string.
    """
    nh = finding.get('narrativeHint')
    if isinstance(nh, str) and len(nh) > _NARRATIVE_HINT_MAX_CHARS:
        return {**finding, 'narrativeHint': nh[:_NARRATIVE_HINT_MAX_CHARS - 3] + '...'}
    return finding


def _extract_cross_chart_findings(compat: Dict) -> List[Dict]:
    """
    Round-3 HIGHEST fix: 三刑/半刑/子卯刑/六沖/六害 findings live inside
    `compat['dimensionScores']['spousePalace']['findings']` (English
    camelCase dim key per compatibility_enhanced.py:1781). Finding `type`
    strings are Chinese ('三刑', '半刑', '子卯刑', '六沖', '六害') per
    compatibility_enhanced.py:425/443/495/516/548/557 — NOT romanized.

    `compat['specialFindings']` (line 1783) contains booleans/metadata only,
    NOT 三刑/半刑/etc. findings — do NOT read from there.

    L1 (Phase 3 follow-up): each finding's `narrativeHint` is truncated
    to 150 chars (string-only, numeric fields untouched).
    """
    spouse_palace_findings = (
        compat.get('dimensionScores', {})
              .get('spousePalace', {})
              .get('findings', [])
    )
    cross_chart_types = ('三刑', '半刑', '子卯刑', '六沖', '六害')
    return [
        _truncate_narrative_hint(f)
        for f in spouse_palace_findings
        if f.get('type') in cross_chart_types
    ]


# ============================================================
# Slim helpers
# ============================================================


def _extract_chart_facts(chart_data: Dict, current_year: int) -> Dict:
    pillars = chart_data.get('fourPillars', {})
    return {
        'fourPillars': {
            'year': _pillar_summary(pillars.get('year')),
            'month': _pillar_summary(pillars.get('month')),
            'day': _pillar_summary(pillars.get('day')),
            'hour': _pillar_summary(pillars.get('hour')),
        },
        'dayMaster': {
            'stem': chart_data.get('dayMasterStem'),
            'branch': chart_data.get('dayMasterBranch'),
        },
        'gender': chart_data.get('gender'),
        'currentYear': current_year,
        'lunarDate': chart_data.get('lunarDate'),
        'taiYuan': chart_data.get('taiYuan'),
        'mingGong': chart_data.get('mingGong'),
        'shenGong': chart_data.get('shenGong'),
    }


def _pillar_summary(pillar: Optional[Dict]) -> Optional[Dict]:
    """Compact form of a pillar — keeps only the load-bearing fields."""
    if not pillar:
        return None
    return {
        'stem': pillar.get('stem'),
        'branch': pillar.get('branch'),
        'tenGodStem': pillar.get('tenGodStem') or pillar.get('tenGod'),
        'hiddenStems': pillar.get('hiddenStems', []),
        'lifeStage': pillar.get('lifeStage'),
        'shenSha': pillar.get('shenSha', []),
        'naYin': pillar.get('naYin'),
    }


def _extract_strength(chart_data: Dict, pre_analysis: Dict) -> Dict:
    v2 = pre_analysis.get('strengthV2', {})
    return {
        'classification': v2.get('classification'),
        'score': v2.get('score'),
        'isCongGe': bool(pre_analysis.get('congGe')),
        'congGeType': (
            pre_analysis.get('congGe', {}).get('type')
            if pre_analysis.get('congGe')
            else None
        ),
    }


def _extract_favorability(pre_analysis: Dict) -> Dict:
    """
    Surface god roles as separate fields so the AI prompt can enforce
    «忌神 vs 仇神 absolutely cannot be mixed» (Phase 12 prompts.ts:1570).
    """
    eg = pre_analysis.get('effectiveFavorableGods', {})
    return {
        'yongShen': eg.get('usefulGod'),
        'xiShen': eg.get('favorableGod'),
        'jiShen': eg.get('tabooGod'),
        'chouShen': eg.get('enemyGod'),
        'xianShen': eg.get('idleGod'),
    }


def _extract_five_elements(chart_data: Dict) -> Dict:
    return {
        'balanceSeasonal': chart_data.get('fiveElementsBalanceZh', {}),
        'balanceRaw': chart_data.get('fiveElementsBalanceRaw', {}),
        'elementCounts': chart_data.get('elementCounts', {}),
        'seasonalStates': chart_data.get('seasonalStates', {}),
    }


# Phase 1.5 follow-up C iter 1 — ten-god count summary so the AI doesn't
# have to count occurrences itself (saw real hallucinations like "1個偏官"
# when chart had 0 偏官). The engine emits this in `tenGodCount` already
# under different paths; we surface a unified compact summary.
_TEN_GOD_KEYS = (
    '比肩', '劫財', '食神', '傷官', '正財', '偏財',
    '正官', '偏官', '正印', '偏印',
)


def _extract_ten_god_count(chart_data: Dict) -> Dict[str, int]:
    """Build {十神: count} summary from pre-analysis ten god distribution.

    Counts ten gods across all 4 pillars (stems + main hidden stems) so the
    AI can cite "正官×3, 偏官×0" directly rather than computing from
    `pillars.X.tenGodStem` and inferring counts. Falls back to empty dict if
    upstream field is missing — the AI prompt rule «if 0 in count summary,
    don't claim presence» still works on an empty dict (every key absent).
    """
    pre = chart_data.get('preAnalysis', {})
    # Multiple possible upstream paths — try each. If none exist, build
    # from fourPillars manually as a defensive last resort.
    raw = (
        pre.get('tenGodCount')
        or pre.get('tenGodDistribution')
        or chart_data.get('tenGodCount')
        or chart_data.get('tenGodDistribution')
    )
    if isinstance(raw, dict) and raw:
        return {k: int(raw.get(k, 0)) for k in _TEN_GOD_KEYS}

    # Manual count fallback from chart pillars.
    counts = {k: 0 for k in _TEN_GOD_KEYS}
    pillars = chart_data.get('fourPillars', {})
    for slot in ('year', 'month', 'day', 'hour'):
        p = pillars.get(slot) or {}
        # Day stem is the DM itself — skip its own ten-god (always 比肩-style).
        if slot != 'day':
            stem_tg = p.get('tenGodStem') or p.get('tenGod')
            if stem_tg in counts:
                counts[stem_tg] += 1
        # Branch hidden-stem ten gods (use main 本氣 only — first hidden stem).
        hidden = p.get('hiddenStems') or []
        if hidden:
            # The engine annotates per-hidden ten-god in `hiddenTenGods` if
            # present; otherwise we can't derive without a DM-stem table here.
            hidden_tgs = p.get('hiddenTenGods') or []
            if hidden_tgs:
                first = hidden_tgs[0]
                if first in counts:
                    counts[first] += 1
    return counts


# Phase 1.5 follow-up C iter 2 (trial_031 fix) — pre-compute branch
# interactions formed by each annual year branch with the natal pillar pool.
# Without this, the chat AI was sloppy about 三合 vs 半合 (saying "午+戌
# = 三合火局" when actually 寅午戌 三合 needs all three present, which
# Laopo's chart does have because 寅 in year + 戌 in day + 午 in flow).
# Now AI can cite the engine's actual detection rather than computing
# from memory.

def _extract_branch_interactions_per_year(
    chart_data: Dict,
    annual_forecast: List[Dict],
) -> Dict[str, List[Dict]]:
    """For each annual year, list the 三合/半合/三會/六合/六沖/三刑/六害
    interactions formed by combining the year's branch with the natal
    pillar branches (year/month/day/hour).

    Returns {year_str: [interaction_dict...]} where each interaction has:
        kind:        'sanhe' | 'banhe' | 'sanhui' | 'banhui' |
                     'liuhe' | 'liuchong' | 'sanxing' | 'banxing' |
                     'liuhai'
        name:        Human label e.g. "寅午戌三合火局"
        branches:    All branches that participate (incl. natal + flow)
        natal_pillars: Where each natal branch is in the chart
        result:      Result element / clash element / etc.

    Reuses lookup tables from `branch_relationships.py`.
    """
    from .branch_relationships import (
        SIX_HARMONIES, SIX_CLASHES, SIX_HARMS, SIX_BREAKS,
        TRIPLE_HARMONIES, THREE_MEETINGS, THREE_PUNISHMENTS,
    )

    pillars = chart_data.get('fourPillars', {})
    natal_branch_to_pillar: Dict[str, List[str]] = {}
    for slot in ('year', 'month', 'day', 'hour'):
        b = (pillars.get(slot) or {}).get('branch')
        if b:
            natal_branch_to_pillar.setdefault(b, []).append(slot)

    natal_branch_set = set(natal_branch_to_pillar.keys())

    out: Dict[str, List[Dict]] = {}
    for entry in annual_forecast or []:
        year = str(entry.get('year', ''))
        flow_branch = entry.get('branch')
        if not year or not flow_branch:
            continue

        interactions: List[Dict] = []
        pool = natal_branch_set | {flow_branch}

        # 三合 (full) — all 3 branches present in pool
        for harmony in TRIPLE_HARMONIES:
            if harmony['branches'].issubset(pool):
                if flow_branch not in harmony['branches']:
                    continue  # only include if flow participates
                participating_natal = sorted(harmony['branches'] - {flow_branch})
                interactions.append({
                    'kind': 'sanhe',
                    'name': f'{"".join(harmony["order"])}三合{harmony["element"]}局',
                    'flow_branch': flow_branch,
                    'natal_branches': participating_natal,
                    'natal_pillars': {
                        nb: natal_branch_to_pillar.get(nb, []) for nb in participating_natal
                    },
                    'element': harmony['element'],
                })

        # 半合 — flow_branch + ONE natal branch from a triple
        # (only if full 三合 didn't already trigger)
        sanhe_triggered = any(it['kind'] == 'sanhe' for it in interactions)
        if not sanhe_triggered:
            for harmony in TRIPLE_HARMONIES:
                if flow_branch not in harmony['branches']:
                    continue
                for nb in natal_branch_set:
                    if nb == flow_branch:
                        continue
                    if nb not in harmony['branches']:
                        continue
                    pair = frozenset({flow_branch, nb})
                    roles = {harmony['roles'][b] for b in pair}
                    if roles == {'長生', '帝旺'}:
                        ban_type = '前半合'
                    elif roles == {'帝旺', '墓庫'}:
                        ban_type = '後半合'
                    else:
                        continue  # 拱合 — not commonly cited
                    interactions.append({
                        'kind': 'banhe',
                        'name': f'{flow_branch}{nb}{ban_type}{harmony["element"]}局',
                        'flow_branch': flow_branch,
                        'natal_branches': [nb],
                        'natal_pillars': {nb: natal_branch_to_pillar.get(nb, [])},
                        'element': harmony['element'],
                        'note': f'需 {sorted(harmony["branches"] - {flow_branch, nb})[0]} 才能成全 三合',
                    })

        # 三會 (full) — all 3 branches of a seasonal trio in pool
        for triplet, info in THREE_MEETINGS.items():
            if triplet.issubset(pool):
                if flow_branch not in triplet:
                    continue
                participating_natal = sorted(triplet - {flow_branch})
                interactions.append({
                    'kind': 'sanhui',
                    'name': f'{"".join(sorted(triplet))}三會{info["element"]}局',
                    'flow_branch': flow_branch,
                    'natal_branches': participating_natal,
                    'natal_pillars': {
                        nb: natal_branch_to_pillar.get(nb, []) for nb in participating_natal
                    },
                    'element': info['element'],
                    'season': info['season'],
                    'direction': info['direction'],
                })

        # 六合
        for nb in natal_branch_set:
            pair = frozenset({flow_branch, nb})
            if pair in SIX_HARMONIES:
                info = SIX_HARMONIES[pair]
                interactions.append({
                    'kind': 'liuhe',
                    'name': f'{flow_branch}{nb}六合化{info["element"]}',
                    'flow_branch': flow_branch,
                    'natal_branches': [nb],
                    'natal_pillars': {nb: natal_branch_to_pillar.get(nb, [])},
                    'element': info['element'],
                })

        # 六沖
        for nb in natal_branch_set:
            pair = frozenset({flow_branch, nb})
            if pair in SIX_CLASHES:
                info = SIX_CLASHES[pair]
                interactions.append({
                    'kind': 'liuchong',
                    'name': f'{flow_branch}{nb}六沖',
                    'flow_branch': flow_branch,
                    'natal_branches': [nb],
                    'natal_pillars': {nb: natal_branch_to_pillar.get(nb, [])},
                    'severity': info['severity'],
                })

        # 六害
        for nb in natal_branch_set:
            pair = frozenset({flow_branch, nb})
            if pair in SIX_HARMS:
                interactions.append({
                    'kind': 'liuhai',
                    'name': f'{flow_branch}{nb}六害',
                    'flow_branch': flow_branch,
                    'natal_branches': [nb],
                    'natal_pillars': {nb: natal_branch_to_pillar.get(nb, [])},
                })

        # 三刑 (full + partial) — THREE_PUNISHMENTS is a List of Dicts
        for tp_info in THREE_PUNISHMENTS:
            triple_set = tp_info['branches']
            if triple_set.issubset(pool) and flow_branch in triple_set:
                participating_natal = sorted(triple_set - {flow_branch})
                interactions.append({
                    'kind': 'sanxing',
                    'name': f'{"".join(sorted(triple_set))}{tp_info["name"]}',
                    'flow_branch': flow_branch,
                    'natal_branches': participating_natal,
                    'natal_pillars': {
                        nb: natal_branch_to_pillar.get(nb, []) for nb in participating_natal
                    },
                    'severity': tp_info.get('severity'),
                })

        if interactions:
            out[year] = interactions
    return out


def _compact_luck_periods(luck_periods: List[Dict]) -> List[Dict]:
    """
    Compact form of luck periods. Keep all 8 (per plan — childhood and
    distant-future questions need them) but drop the verbose narrative
    fields — the AI will render its own narrative grounded in this data.
    """
    out = []
    for lp in luck_periods:
        out.append({
            'period': lp.get('period'),
            'startAge': lp.get('startAge'),
            'endAge': lp.get('endAge'),
            'startYear': lp.get('startYear'),
            'endYear': lp.get('endYear'),
            'stem': lp.get('stem'),
            'branch': lp.get('branch'),
            'tenGodStem': lp.get('tenGodStem'),
            'tenGodBranch': lp.get('tenGodBranch'),
            'stemElement': lp.get('stemElement'),
            'branchElement': lp.get('branchElement'),
            'auspiciousness': lp.get('auspiciousness'),
            'score': lp.get('score'),
            'isCurrent': lp.get('isCurrent', False),
            'isNext': lp.get('isNext', False),
        })
    return out


def _compact_annual_forecast(annual_stars: List[Dict], max_count: int = 15) -> List[Dict]:
    """
    Compact annual forecast. Per plan, keep current year + 14 ahead so
    questions like 「2040年我的運勢」 (12-15 years out) have engine backing.
    """
    out = []
    for entry in annual_stars[:max_count]:
        out.append({
            'year': entry.get('year'),
            'age': entry.get('age'),
            'stem': entry.get('stem'),
            'branch': entry.get('branch'),
            'tenGodStem': entry.get('tenGodStem'),
            'tenGodBranch': entry.get('tenGodBranch'),
            'auspiciousness': entry.get('auspiciousness'),
            'shenSha': entry.get('shenSha', []),
        })
    return out


def _compact_monthly_forecasts(monthly: List[Dict]) -> List[Dict]:
    """
    Compact monthly forecasts from annual_enhanced. All 12 kept, ruleTrace
    + verbose prose dropped. Phase 12b/c structured flags kept (they trigger
    deterministic injection in chat-context.service.ts).

    NOTE on field-name mapping (Phase 2 CAREER audit fix 2026-05-12):
    `annual_enhanced._compute_single_month` emits `monthStem` / `monthBranch`
    and `compute_enhanced_monthly_forecasts` adds `monthIndex` + `monthLabel`
    (annual_enhanced.py:2143-2161, 2216-2217). The old compactor looked for
    plain `month` / `stem` / `branch` which never existed on the source —
    every slim entry had None for those three fields. We now look at the
    actual emission keys first, with the plain keys as fallback for any
    future refactor that renames them.
    """
    out = []
    for m in monthly:
        entry = {
            'month': m.get('monthLabel') or m.get('month') or m.get('monthIndex'),
            'stem': m.get('monthStem') or m.get('stem'),
            'branch': m.get('monthBranch') or m.get('branch'),
            'auspiciousness': m.get('auspiciousness'),
            'stemBase': m.get('stemBase'),
            'branchBase': m.get('branchBase'),
        }
        # Only include Phase 12b/c structured fields when triggered
        # (saves ~50% bytes on non-trigger months)
        for flag_key in (
            'officerSealActivation',
            'fuYinInteractions',
            'liuHaiInteractions',
            'chongKuRelease',
        ):
            value = m.get(flag_key)
            if value:
                entry[flag_key] = value
        out.append(entry)
    return out


def _extract_romance(lifetime: Dict, love: Dict, current_year: int) -> Dict:
    deterministic = lifetime.get('deterministic', {})
    # `romance_years` is a list of int years; `romance_years_dayun_context`
    # is the enriched list of dicts {year, tier, signal, dayun_context,
    # romance_archetype?, chong_label?, chong_valence?, bidirectional?, ...}
    # (lifetime_enhanced.py:1459). Chat AI + the TS-side pivot extractor
    # need the rich object shape (year alone isn't enough to splice a pivot
    # hint or generate label-aware narrative), so prefer the enriched list.
    # Fallback to bare year list for any chart whose enriched computation
    # failed (defensive — `deterministic` always includes both today).
    enriched = deterministic.get('romance_years_dayun_context')
    if enriched:
        candidates = enriched
    else:
        # Wrap bare ints in {year: ...} so downstream code can rely on
        # uniform object shape.
        candidates = [{'year': y} for y in deterministic.get('romance_years', [])]
    return {
        # Lifetime-level romance signals
        'candidates': candidates,
        'warningYears': deterministic.get('romance_warning_years', []),
        # FROM LOVE pipeline — the central anti-hallucination win (Issue 22)
        'spousePalace': love.get('marriagePalace', {}),
        'spouseStarAnalysis': love.get('spouseStarAnalysis', {}),
        'lovePersonality': _compact_love_personality(love.get('lovePersonality', {})),
        # Compact year-tag forms (full prose dropped — AI doesn't need it)
        'romanceGoodYears': _compact_year_tags(love.get('romanceGoodYears', [])),
        'romanceDangerYears': _compact_year_tags(love.get('romanceDangerYears', [])),
        'marriageChangeYears': _compact_year_tags(love.get('marriageChangeYears', [])),
        'partnerRecommendations': love.get('partnerRecommendations', {}),
        'peachBlossoms': love.get('peachBlossoms', []),
        'marriageTimingIndicators': love.get('marriageTimingIndicators', {}),
        # NOTE: `annualLoveForecast` and `candidatesDayunContext` deliberately
        # dropped — annual context is already in top-level `annualForecast15`,
        # and dayun context is derivable from `luckPeriods` + `candidates`.
    }


def _compact_love_personality(lp: Dict) -> Dict:
    """Keep just the polarity-aware personalityDimensions (Phase 12g.4)."""
    if not lp:
        return {}
    return {
        'personalityDimensions': lp.get('personalityDimensions', []),
        'archetype': lp.get('archetype'),
        'elementStyle': lp.get('elementStyle'),
    }


def _compact_year_tags(years: List[Dict]) -> List[Dict]:
    """Compact year tags — keep year + label + signals, drop verbose prose."""
    out = []
    for entry in years:
        if not isinstance(entry, dict):
            out.append(entry)
            continue
        out.append({
            'year': entry.get('year'),
            'label': entry.get('label') or entry.get('chong_label'),
            'romanceArchetype': entry.get('romance_archetype'),
            'bidirectional': entry.get('bidirectional'),
            'signalNames': entry.get('signal_names', []),
            'tier': entry.get('tier'),
        })
    return out


def _extract_career(lifetime: Dict, career: Dict) -> Dict:
    deterministic = lifetime.get('deterministic', {})
    return {
        # Lifetime-level career anchors
        'favorableDirection': deterministic.get('favorable_direction'),
        'directions': deterministic.get('career_directions', []),
        'benefactorElements': deterministic.get('career_benefactors_element', []),
        'benefactorZodiac': deterministic.get('career_benefactors_zodiac', []),
        'investments': {
            'favorable': deterministic.get('favorable_investments', []),
            'unfavorable': deterministic.get('unfavorable_investments', []),
        },
        # FROM CAREER pipeline (compacted — drop duplicates with top-level)
        'pattern': career.get('pattern'),
        'patternType': career.get('patternType'),
        'suitablePositions': _compact_named_list(career.get('suitablePositions', [])),
        'entrepreneurshipFit': career.get('entrepreneurshipFit', {}),
        'partnershipFit': career.get('partnershipFit', {}),
        'companyTypeFit': career.get('companyTypeFit', {}),
        'favorableIndustries': _compact_named_list(
            career.get('favorableIndustries', []),
        ),
        'unfavorableIndustries': _compact_named_list(
            career.get('unfavorableIndustries', []),
        ),
        'careerAllies': _compact_named_list(career.get('careerAllies', [])),
        'wealthScore': career.get('wealthScore'),
        'reputationScore': career.get('reputationScore'),
        'activeLuckPeriod': career.get('activeLuckPeriod'),
        # NOTE: `annualForecasts` and `monthlyForecasts` from career pipeline
        # are deliberately dropped — they duplicate top-level
        # `annualForecast15` and `monthlyForecast12`. Career-specific timing
        # nuance is preserved in `activeLuckPeriod` + `pattern`.
    }


def _compact_named_list(items: List[Dict]) -> List[Dict]:
    """For lists of {name, description, ...} — keep just name + 1-line label."""
    out = []
    for item in items:
        if not isinstance(item, dict):
            out.append(item)
            continue
        out.append({
            'name': item.get('name') or item.get('label'),
            'category': item.get('category'),
            'tenGod': item.get('tenGod'),
            'element': item.get('element'),
        })
    return out


def _extract_relationships(lifetime: Dict, chart_data: Dict) -> Dict:
    deterministic = lifetime.get('deterministic', {})
    return {
        'partner': {
            'elements': deterministic.get('partner_element', []),
            'zodiac': deterministic.get('partner_zodiac'),
            'zodiacSecondary': deterministic.get('partner_zodiac_secondary'),
        },
        'parents': lifetime.get('parentsInsights', {}),
        'children': lifetime.get('childrenInsights', {}),
        'boss': lifetime.get('bossCompatibility', {}),
        'parentHealthYears': deterministic.get('parent_health_years', []),
    }


def _extract_shensha_summary(all_shen_sha: Any) -> Dict:
    """Surface a compact summary of shensha — names + which pillar(s)."""
    if isinstance(all_shen_sha, dict):
        return all_shen_sha
    return {}


# ============================================================
# Doctrine flag extraction
# ============================================================


def _extract_doctrine_flags(
    lifetime: Dict,
    love: Dict,
    career: Dict,
    annual: Dict,
) -> Dict:
    """
    Aggregate engine-detected doctrine flags from all 4 pipelines.

    Each flag exposes the data the AI prompt's anti-hallucination rules need.
    The AI MUST respect these per the chat system prompt (e.g., 傷官見官
    valence='beneficial' overrides folk «傷官見官恆凶»).
    """
    spouse_star = love.get('spouseStarAnalysis', {})
    challenges = spouse_star.get('challenges', [])
    marriage_palace = love.get('marriagePalace', {})
    palace_meta = marriage_palace.get('meta', {})

    return {
        # FROM LOVE pipeline — the central anti-hallucination saves
        'shangguanJianGuan': _filter_shangguan_jianguan(challenges),
        'biJieDuoCai': _filter_bijie_duocai(challenges),
        'guanShaHunZa': _filter_guan_sha_hun_za(challenges),
        'spousePalaceFrictions': palace_meta.get('natalFrictions', []),
        # FROM LIFETIME pipeline
        'patternClassification': (
            lifetime.get('patternNarrative', {}).get('classification')
            if isinstance(lifetime.get('patternNarrative'), dict)
            else None
        ),
        'isCongGe': bool(lifetime.get('deterministic', {}).get('cong_ge_detected')),
        # FROM CAREER pipeline
        'careerPatternType': career.get('patternType'),
        # NOTE: Phase 12b/c monthly flags (officerSealActivation,
        # fuYinInteractions, liuHaiInteractions, chongKuRelease) are NOT
        # duplicated here — they live per-month in `monthlyForecast12`.
        # The AI can scan that array directly to find flag-triggered months.
    }


def _filter_shangguan_jianguan(challenges: List[Dict]) -> List[Dict]:
    """
    Filter spouse-star challenges for 傷官見官. Per engine emission at
    love_enhanced.py:824: each 傷官見官 challenge has `'type': '傷官見官'`.

    Note: legacy fields `shangguanCount`/`zhengguanCount` are deprecated per
    love_enhanced.py:659 (kept for frontend backward-compat, scheduled for
    removal). We use the stable `type` field as primary detection.
    """
    return [c for c in challenges if c.get('type') == '傷官見官']


def _filter_bijie_duocai(challenges: List[Dict]) -> List[Dict]:
    """
    Filter for 比劫奪財 (Phase 12h.B Item 8). Per engine emission at
    love_enhanced.py:965: each challenge has `'type': '比劫奪財'`.

    Note: backup detection uses `biJieCount` + `caiCount` (camelCase J per
    love_enhanced.py:970-971). Prior versions of this filter used `bijieCount`
    (lowercase j) — that was a bug, the field never matched.
    """
    return [c for c in challenges if c.get('type') == '比劫奪財']


def _filter_guan_sha_hun_za(challenges: List[Dict]) -> List[Dict]:
    """
    Filter for 官殺混雜 真雙透 (Phase 12g.1 cross-chart canonical helper).
    Per engine emission at love_enhanced.py:616: TRUE 真雙透 challenges have
    `'type': '官殺混雜'` AND `'doctrineType': 'guan_sha_hunza'`.

    The 露官藏殺/露殺藏官 narrative-only paths (`doctrineType` =
    'lu_guan_cang_sha' / 'lu_sha_cang_guan') go to `informationalNotes`, NOT
    to challenges — they are correctly excluded by filtering on `type`.
    """
    return [c for c in challenges if c.get('type') == '官殺混雜']


# ============================================================
# Chinese injection block builders (Layer 4 deterministic injection)
# ============================================================


def _build_chinese_injection_blocks(
    flags: Dict,
    chart_data: Dict,
    current_year: int,
) -> Dict[str, Optional[str]]:
    """
    Pre-format the EXACT Chinese sentences the AI must splice into responses
    when a doctrine flag is triggered. Mirrors the `interpolateLoveV2Fields`
    pattern in `apps/api/src/ai/ai.service.ts:3794-3837`. Server-side
    composition; AI consumes verbatim.

    Returns dict mapping flag name → Chinese sentence block (or None when not
    triggered for this chart).
    """
    return {
        'shangguanJianGuan': _build_shangguan_injector(
            flags.get('shangguanJianGuan', []),
        ),
        'biJieDuoCai': _build_bijie_duocai_injector(
            flags.get('biJieDuoCai', []),
            chart_data.get('gender', 'male'),
        ),
        'guanShaHunZa': _build_guan_sha_hun_za_injector(
            flags.get('guanShaHunZa', []),
        ),
        'spousePalaceFrictions': _build_spouse_palace_friction_injector(
            flags.get('spousePalaceFrictions', []),
        ),
    }


def _build_shangguan_injector(challenges: List[Dict]) -> Optional[str]:
    """
    傷官見官 injector. The Phase 12g.3 valence dispatch is the central
    anti-hallucination case. When 正官 is 忌神, 傷官 is BENEFICIAL — engine
    flags this; AI must respect.
    """
    if not challenges:
        return None
    sjg = challenges[0]
    valence = sjg.get('valence')
    natal_severity = sjg.get('natalSeverity', 'unknown')
    activations = sjg.get('transientActivations', [])
    dayun = next((a for a in activations if a.get('level') == 'dayun'), None)
    buffer_text = sjg.get('valenceNote') or sjg.get('description', '')

    # Phase 1.5 follow-up C iter 1: removed `[doctrineDirective: NAME]` header.
    # The marker was an engine-side tracking label but the AI was citing it
    # verbatim («根據您命中【doctrineDirective: shangguanJianGuan】...»),
    # leaking internal markers to end users. The injector content below is
    # already self-identifying via the 「命局層次：傷官見官」 line.
    parts = []
    parts.append(f'【傷官見官分析】')
    parts.append(f'命局層次：傷官見官，嚴重度{natal_severity}')

    if dayun:
        parts.append(
            f'大運觸發：現行大運({dayun.get("period")} '
            f'{dayun.get("stems", "")})期間，{dayun.get("detail", "")}'
        )
    else:
        parts.append('大運觸發：當前大運未引動。')

    if valence == 'beneficial':
        parts.append(
            '性質判定：正官在您命中為忌神，傷官制官反為調節壓力，並非為禍'
            '（《三命通會》：「如官為忌，傷官見官反以吉論」）'
        )
    elif valence == 'harmful':
        parts.append(
            '性質判定：正官在您命中為用神/喜神，傷官見官形成沖剋，需化解'
        )
    else:
        parts.append('性質判定：正官在您命中影響為閒神等級，影響有限')

    if buffer_text:
        parts.append(f'化解條件：{buffer_text}')
    parts.append(
        '[必須在涉及配偶/事業壓力的回答中以本段文字為主敘述，'
        '不可省略、不可改寫]'
    )
    return '\n'.join(parts)


def _build_bijie_duocai_injector(
    challenges: List[Dict],
    gender: str,
) -> Optional[str]:
    """
    比劫奪財 injector. Phase 12h.B Item 8: 3-state valence + gender dispatch
    (男命 損財+損妻; 女命 損財+損姊妹, NOT 損夫).
    """
    if not challenges:
        return None
    bjc = challenges[0]
    valence = bjc.get('valence')
    severity = bjc.get('natalSeverity', 'unknown')

    parts = ['【比劫奪財分析】']
    parts.append(f'命局層次：比劫奪財，嚴重度{severity}')

    if valence == 'harmful':
        if gender.lower() == 'male' or gender == '男':
            parts.append(
                '性質判定：男命比劫旺財弱，主損財、爭奪、'
                '兄弟朋友易生財務糾紛；亦影響妻緣穩定'
            )
        else:
            parts.append(
                '性質判定：女命比劫旺財弱，主損財、爭奪、'
                '姊妹朋友易生財務糾紛'
                '（注意：女命比劫奪財不論損夫，配偶星另論）'
            )
    elif valence == 'beneficial':
        parts.append(
            '性質判定：日主衰弱時，比劫為用，能扶身敵財，'
            '此情境下比劫奪財反為助力'
        )
    else:
        parts.append('性質判定：比劫奪財狀態不明確或不適用')

    parts.append(
        '[必須在涉及財運/兄弟姊妹/合夥/'
        + ('妻緣' if gender.lower() == 'male' or gender == '男' else '姊妹')
        + '的回答中以本段文字為主敘述]'
    )
    return '\n'.join(parts)


def _build_guan_sha_hun_za_injector(challenges: List[Dict]) -> Optional[str]:
    """
    官殺混雜 injector. Phase 12g.1 canonical helper — distinguishes
    露官藏殺/露殺藏官 (narrative-only) vs 真雙透 (high severity).
    """
    if not challenges:
        return None
    gshz = challenges[0]
    doctrine_type = gshz.get('doctrineType', '')
    severity = gshz.get('natalSeverity', 'unknown')

    parts = ['【官殺混雜分析】']

    if 'lu_guan_cang_sha' in doctrine_type:
        parts.append(
            '命局層次：露官藏殺只論官（《子平真詮》"藏官露殺...勿使官混"）'
        )
        parts.append('性質判定：以正官格論斷，正官清純，配偶星明朗')
    elif 'lu_sha_cang_guan' in doctrine_type:
        parts.append('命局層次：露殺藏官只論殺')
        parts.append('性質判定：以七殺格論斷')
    else:
        parts.append(f'命局層次：官殺真雙透，嚴重度{severity}')
        parts.append('性質判定：官殺混雜，需食神制殺或印化煞')

    parts.append('[涉及事業/上司/配偶星問題時，必須以本段文字為主敘述]')
    return '\n'.join(parts)


def _build_spouse_palace_friction_injector(
    frictions: List[Dict],
) -> Optional[str]:
    """
    配偶宮 friction injector. Phase 12g.6 Gap 3 — surfaces 三刑/半刑/子卯刑/
    六害/六沖 directly affecting day branch (配偶宮).
    """
    if not frictions:
        return None
    parts = ['【配偶宮分析】']
    parts.append('命局層次：配偶宮自然互動 (沖刑害破)')
    for f in frictions:
        ftype = f.get('type', 'unknown')
        desc = f.get('description', '')
        parts.append(f'  - {desc} (type={ftype}, severity={f.get("severity")})')
    parts.append(
        '[涉及配偶長相/性格/婚姻和諧度問題時，必須以本段文字為主敘述]'
    )
    return '\n'.join(parts)
