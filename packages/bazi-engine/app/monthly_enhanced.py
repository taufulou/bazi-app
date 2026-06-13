"""
Monthly Enhanced — 八字月運 (Monthly Fortune) Phase 2.

Thin orchestration layer on top of `annual_enhanced._compute_single_month`
for the user-facing 月運 surface. Wraps chart pipeline + flow-year
resolution + cross-flow-year handling + 4-dim score derivation +
partition spec attachment.

Architecture:
- `compute_single_month_by_yearmonth(birth_data, year, month)` is the public
  entry point. Internally:
  1. Resolves the flow_year (立春-anchored) for the Gregorian (year, month)
     via cnlunar.lunarYear
  2. Gets chart for that flow_year (in-process LRU cache, no Redis)
  3. Resolves the target 流月 干支 via cnlunar.month8Char
  4. Finds matching month in `calculate_monthly_stars(flow_year)`
  5. Delegates to `_compute_single_month` (inherits Phase 12b/12c Fix A-F)
  6. Wraps with: energyScore + 4-dim derived scores + partitionSpec +
     metaFraming='soft_trigger' + chartContext

Cross-flow-year handling:
- Flow years are 立春-to-立春, NOT Jan-to-Dec
- January queries (e.g., 2027-01) typically resolve to flow_year=2026
  (still 丑月 of 2026)
- cnlunar.lunarYear handles this precisely (verified against test dates)

Load-bearing doctrine (do NOT relax):
- 流月 is a SUSTAINED TREND, not a verdict (per 三命通會 月運篇: «月運主一月
  之氣象，較流日為穩，較流年為動»). All AI output framed soft-trigger
  («本月宜» / «本月易於» / «本月趨向»), never absolute («必然» / «一定»).
- 用神/喜神/忌神 are chart-level only. NO monthly reassignment.
- Time partition LOCKED to `tiangan_dizhi_half` (2 cells: 上半月 stem-
  governed, 下半月 branch-governed) per Phase A Sub-Agent A research
  (2026-05-28). Citations: 司莹居士《八字泄天机》流月逼進法 + ≥5 modern
  Bazi-master sources (算准网, 网易, 神机阁, 筱竹命理, 沃酷).

References:
- Plan v4: `/Users/roger/.claude/plans/ok-next-big-feature-merry-cake.md`
  (Phase 2 月運 section)
- Phase A research results:
  `/Users/roger/.claude/plans/phase-2-yueyun-phase-a-research-results.md`
"""

from __future__ import annotations

import hashlib
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Literal, Optional, Tuple, TypedDict

import cnlunar

from .annual_enhanced import _compute_single_month
from .calculator import calculate_bazi_with_all_pipelines
from .daily_enhanced import compute_daily_fortune
from .fortune_constants import (
    FORTUNE_MONTHLY_PRE_ANALYSIS_VERSION,
    META_FRAMING_SOFT_TRIGGER,
    derive_dimension_label,
    derive_energy_score,
)
from .luck_periods import calculate_monthly_stars


# ============================================================
# PartitionSpec types (Phase 2 月運 LOCKED: tiangan_dizhi_half)
# ============================================================
#
# Sub-Agent A research lock 2026-05-28: monthly forecasting partitions on
# 天干/地支 boundary, NOT 三旬 / 4-week / 節氣半月 etc.  上半月 governed by
# 流月天干 (動氣先出); 下半月 by 流月地支 (靜氣後沉). See research-results
# doc section 1 for full citations.
#
# `governing_pillar` field is doctrine-bearing — it's referenced by the
# anti-hallucination clause 5 in FORTUNE_V1_PROMPTS.monthly. AI prompts
# must surface this field when discussing intra-month timing.


class PartitionBucket(TypedDict):
    """A single intra-month partition bucket (one of 上半月 / 下半月)."""

    label: str
    """Display label in zh-TW. '上半月' or '下半月'."""

    day_range: Tuple[int, Optional[int]]
    """(start_day, end_day) within the active 流月 day window.
    NOT Gregorian dates. None for end_day means «end of 流月»."""

    governing_pillar: Literal["stem", "branch"]
    """Which 流月 pillar (天干/地支) governs this bucket's qi.
    Doctrine-bearing per 子平 流月逼進法."""


class PartitionSpec(TypedDict):
    """The intra-month partition scheme for a month."""

    scheme_id: Literal["tiangan_dizhi_half"]
    """LOCKED to tiangan_dizhi_half per Phase A Sub-Agent A research."""

    buckets: List[PartitionBucket]


TIANGAN_DIZHI_HALF_PARTITION: PartitionSpec = {
    "scheme_id": "tiangan_dizhi_half",
    "buckets": [
        {"label": "上半月", "day_range": (1, 15), "governing_pillar": "stem"},
        # day_range[1] = None means «through end of 流月» — caller resolves
        # actual end day via _resolve_liuyue_day_window
        {"label": "下半月", "day_range": (16, None), "governing_pillar": "branch"},
    ],
}


# ============================================================
# 4 monthly dimension keys (LOCKED at 4 per Sub-Agent B; no 出行)
# ============================================================
#
# Sub-Agent B research lock 2026-05-28: monthly forecast dims are exactly
# career / finance / romance / health. 出行 OMITTED because 驛馬 / 沖日支
# are doctrinally DAY-only triggers per 三命通會 神煞篇 + every modern
# practitioner write-up.

MONTHLY_DIMENSION_KEYS: List[str] = ["career", "finance", "romance", "health"]

MONTHLY_DIMENSION_LABELS_ZH: Dict[str, str] = {
    "career": "事業",
    "finance": "財運",
    "romance": "感情",
    "health": "健康",
}


# ============================================================
# Signal sentiment classifier (for per-dim score derivation)
# ============================================================
#
# `_compute_single_month` returns dim signals as plain Chinese strings
# without explicit valences. We do lightweight keyword-based sentiment
# detection to nudge per-dim scores ±5 from the overall energy baseline.
# Conservative ±5/signal so 1-2 signals shift the dim subtly but the
# overall trend still anchors to the auspiciousness label.

_POSITIVE_KEYWORDS = (
    "增加", "啟動", "機會", "穩定", "融洽", "活躍", "順遂", "助力", "貴人",
    "升遷", "和諧", "豐", "進財",
)
_NEGATIVE_KEYWORDS = (
    "壓力", "口舌", "競爭", "小人", "克財", "破財", "爭利", "波動", "慎防",
    "注意", "保養", "煩", "損失", "傷害",
    # NOTE: 「傷」 alone is intentionally EXCLUDED — it false-positives on
    # «食傷» (the doctrinal 食神+傷官 compound — neutral). Same for «損»/«防»
    # /«慎»/«得» as standalone chars. Use 2+ char idioms only.
)


def _classify_signal_sentiment(signal: str) -> int:
    """Return +1 for positive, -1 for negative, 0 for neutral."""
    has_pos = any(kw in signal for kw in _POSITIVE_KEYWORDS)
    has_neg = any(kw in signal for kw in _NEGATIVE_KEYWORDS)
    if has_pos and not has_neg:
        return 1
    if has_neg and not has_pos:
        return -1
    return 0


def _derive_dim_score(base_score: int, signals: List[str]) -> int:
    """Compute a per-dim 0-100 score from base + signal sentiment nudges.

    Each positive signal: +5; each negative: -5. Clamped 0-100.
    Conservative — preserves the overall label's center of gravity while
    giving dims some variation for visual UI distinction.
    """
    nudge = sum(_classify_signal_sentiment(s) for s in signals) * 5
    return max(0, min(100, base_score + nudge))


# ============================================================
# In-process LRU cache for chart-pipeline output
# (per plan v4 M-new-2: NOT Redis — annual pipeline is chart-derived
# and easier to recompute than to serialize)
# ============================================================

_FLOW_YEAR_CACHE_MAXSIZE = 8
_flow_year_cache: Dict[Tuple[str, int, bool], Dict[str, Any]] = {}


def _compute_chart_hash(
    birth_date: str,
    birth_time: str,
    birth_city: str,
    birth_timezone: str,
    gender: str,
) -> str:
    """Deterministic cache key for chart identity.

    Note: this is engine-side; NestJS uses its own chartHash (with
    birthTimezone normalization audit I4 lock). For in-process cache
    purposes, only the relative key matters — no need to match the
    NestJS hash exactly.
    """
    raw = f"{birth_date}|{birth_time}|{birth_city}|{birth_timezone}|{gender}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _get_or_compute_chart_for_flow_year(
    *,
    birth_date: str,
    birth_time: Optional[str],
    birth_city: str,
    birth_timezone: str,
    gender: str,
    flow_year: int,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
    hour_known: bool = True,
) -> Dict[str, Any]:
    """Get chart for the given flow_year. In-process LRU cached.

    Cache scope:
    - Key: (chart_hash, flow_year)
    - maxsize: 8 (covers typical N=1 monthly query with cross-boundary
      headroom for 2 active flow years)
    - Eviction: FIFO on overflow (good enough for in-process; not a hot
      path)
    - Lifetime: process lifetime (no serialization)
    """
    chart_hash = _compute_chart_hash(
        birth_date, birth_time, birth_city, birth_timezone, gender
    )
    cache_key = (chart_hash, flow_year, hour_known)

    if cache_key in _flow_year_cache:
        return _flow_year_cache[cache_key]

    chart = calculate_bazi_with_all_pipelines(
        birth_date=birth_date,
        birth_time=birth_time,
        birth_city=birth_city,
        birth_timezone=birth_timezone,
        gender=gender,
        birth_longitude=birth_longitude,
        birth_latitude=birth_latitude,
        target_year=flow_year,
        hour_known=hour_known,
    )

    if len(_flow_year_cache) >= _FLOW_YEAR_CACHE_MAXSIZE:
        # FIFO eviction (Python 3.7+ dicts are insertion-ordered)
        oldest_key = next(iter(_flow_year_cache))
        del _flow_year_cache[oldest_key]

    _flow_year_cache[cache_key] = chart
    return chart


def _reset_flow_year_cache_for_tests() -> None:
    """Test-only helper to reset the in-process cache between tests."""
    _flow_year_cache.clear()


# ============================================================
# Flow-year + 流月 resolution (cnlunar-backed)
# ============================================================


def _resolve_flow_year_and_month_pillar(
    year: int, month: int
) -> Tuple[int, str, str]:
    """Resolve (flow_year, month_stem, month_branch) for a Gregorian (year, month).

    Uses cnlunar for the month pillar (which IS 立春-correct via
    `month8Char`), then derives the flow year from the calendar month
    using the standard 子平 rule:
    - calendar month == 1 (January) → flow_year = year - 1
      (January is always 丑月 of the PREVIOUS flow year per
      `calculate_monthly_stars`'s `solar_term_date='YYYY+1-01-06'`)
    - calendar month >= 2 → flow_year = year
      (day=15 representative is always past 立春 ~Feb 4 and past 大雪
      ~Dec 7 for any month >= 2)

    IMPORTANT — cnlunar quirk: `cnlunar.lunarYear` and `cnlunar.year8Char`
    transition at CHINESE NEW YEAR (CNY), NOT 立春. This is wrong for
    orthodox Bazi. We therefore derive the flow_year from the calendar
    month alone using the rule above, which IS 立春-anchored.

    Verified mappings:
    - May 2026 → (2026, '癸', '巳')
    - Dec 2026 → (2026, '庚', '子')
    - Jan 2027 → (2026, '辛', '丑')  ← 丑月 of 2026 flow year
    - Feb 2027 → (2027, '壬', '寅')  ← 1st 流月 of 2027 flow year
    """
    rep_dt = datetime(year, month, 15, 12, 0, 0)
    lunar = cnlunar.Lunar(rep_dt, godType="8char")
    month_gz = lunar.month8Char
    if len(month_gz) < 2:
        raise ValueError(f"cnlunar returned invalid month8Char: {month_gz!r}")
    # Flow year derivation: January's 丑月 belongs to PREVIOUS flow year
    flow_year = year - 1 if month == 1 else year
    return flow_year, month_gz[0], month_gz[1]


def _resolve_liuyue_day_window(
    monthly_stars: List[Dict[str, Any]],
    month_pillar: Tuple[str, str],
) -> Tuple[date, date]:
    """Return (start_date, end_date) for the active 流月 window.

    The window is bounded by 節氣 (節) markers — start = the 流月's 節
    date; end = the NEXT 流月's 節 date (exclusive).

    Args:
        monthly_stars: output of `calculate_monthly_stars(flow_year, dm_stem)`
        month_pillar: (stem, branch) of the target 流月

    Returns:
        (start_date, end_date) — Gregorian date range covering the 流月.
        Used by L1.b to bucket per-day signals into 上半月/下半月.

    Note: monthly_stars uses APPROXIMATE 節氣 dates (hardcoded table in
    luck_periods.py:489-502). For Phase 2 MVP this is acceptable —
    ±1 day error on bucket boundary doesn't change doctrinal output.
    L1.b can opt into cnlunar-precise resolution as a Phase 2.x candidate.
    """
    target_stem, target_branch = month_pillar
    for month_data in monthly_stars:
        if (
            month_data.get("stem") == target_stem
            and month_data.get("branch") == target_branch
        ):
            start_str = month_data.get("solarTermDate", "")
            end_str = month_data.get("solarTermEndDate", "")
            try:
                start_date = date.fromisoformat(start_str)
                end_date = date.fromisoformat(end_str)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"Invalid solar term dates in monthly_stars for {target_stem}{target_branch}: "
                    f"start={start_str!r}, end={end_str!r}"
                ) from exc
            return (start_date, end_date)

    raise ValueError(
        f"Month pillar {target_stem}{target_branch} not found in monthly_stars "
        f"(this should not happen for any valid (year, month) input — possible "
        f"cnlunar / calculate_monthly_stars disagreement)"
    )


# ============================================================
# Public entry point
# ============================================================


def compute_single_month_by_yearmonth(
    *,
    birth_date: str,
    birth_time: Optional[str],
    birth_city: str,
    birth_timezone: str,
    gender: str,
    year: int,
    month: int,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
    hour_known: bool = True,
) -> Dict[str, Any]:
    """Compute 八字月運 for the given chart on a target Gregorian (year, month).

    Wraps `annual_enhanced._compute_single_month` (which inherits all
    Phase 12b/12c Fix A-F doctrine) + adds monthly-specific scaffolding:
    - flow-year resolution (handles 立春-anchored cross-year cases)
    - 4-dim per-dim derived scores + labels
    - partitionSpec (`tiangan_dizhi_half` 2-cell split)
    - metaFraming='soft_trigger' (load-bearing for AI prompt)
    - chartContext for NestJS prompt builder

    The 流日 day-level intra-month aggregation (`compute_intra_month_breakdown`)
    is in L1.b (separate function in this same module) — call sites that
    need per-bucket peak signals + 神煞 should call it explicitly.

    Args:
        birth_date: 'YYYY-MM-DD'
        birth_time: 'HH:MM'
        birth_city: free text
        birth_timezone: IANA tz string (e.g., 'Asia/Kuala_Lumpur')
        gender: 'male' or 'female'
        year, month: Gregorian (year, month) the user is querying

    Returns:
        Dict with the engine's deterministic monthly pre-analysis. Shape
        mirrors daily_enhanced.compute_daily_fortune scaled to monthly
        scope (4 dims not 5; no folk content).
    """
    # 1. Resolve flow year + target month pillar
    flow_year, month_stem, month_branch = _resolve_flow_year_and_month_pillar(
        year, month
    )

    # 2. Get chart for flow year (in-process LRU cached)
    chart = _get_or_compute_chart_for_flow_year(
        birth_date=birth_date,
        birth_time=birth_time,
        birth_city=birth_city,
        birth_timezone=birth_timezone,
        gender=gender,
        flow_year=flow_year,
        birth_longitude=birth_longitude,
        birth_latitude=birth_latitude,
        hour_known=hour_known,
    )

    # 3. Build monthly_stars for the flow_year + find matching month
    pillars = chart["fourPillars"]
    day_master = chart["dayMaster"]
    day_master_stem = chart["dayMasterStem"]

    monthly_stars = calculate_monthly_stars(
        year=flow_year, day_master_stem=day_master_stem
    )

    matching_month: Optional[Dict[str, Any]] = None
    for m in monthly_stars:
        if m.get("stem") == month_stem and m.get("branch") == month_branch:
            matching_month = m
            break

    if matching_month is None:
        raise ValueError(
            f"No matching month for {month_stem}{month_branch} in flow_year={flow_year} "
            f"(this should not happen — cnlunar / calculate_monthly_stars mismatch)"
        )

    # 4. Assemble inputs for _compute_single_month
    effective_gods = {
        "usefulGod": day_master.get("usefulGod", ""),
        "favorableGod": day_master.get("favorableGod", ""),
        "idleGod": day_master.get("idleGod", ""),
        "tabooGod": day_master.get("tabooGod", ""),
        "enemyGod": day_master.get("enemyGod", ""),
    }
    is_cong_ge = bool(
        chart.get("lifetimeEnhancedInsights", {})
        .get("deterministic", {})
        .get("cong_ge_detected")
    )

    annual_insights = chart.get("annualEnhancedInsights", {})
    flow_year_data = annual_insights.get("flowYear", {})
    flow_year_stem = flow_year_data.get("stem", "")
    flow_year_auspiciousness = flow_year_data.get("auspiciousness", "平")

    # 5. Delegate to _compute_single_month (Phase 12b/12c machinery)
    month_result = _compute_single_month(
        month_data=matching_month,
        pillars=pillars,
        day_master_stem=day_master_stem,
        effective_gods=effective_gods,
        gender=gender,
        year_branch=pillars["year"]["branch"],
        day_branch=pillars["day"]["branch"],
        kong_wang=chart.get("kongWang", []),
        flow_year_auspiciousness=flow_year_auspiciousness,
        strength=day_master.get("strength", "neutral"),
        is_cong_ge=is_cong_ge,
        flow_year_stem=flow_year_stem,
    )

    # 6. Derive 4-dim scores from base + signal sentiment
    base_score = derive_energy_score(month_result.get("auspiciousness", "平"))
    dimensions: Dict[str, Dict[str, Any]] = {}
    aspects = month_result.get("aspects", {})
    for dim_key in MONTHLY_DIMENSION_KEYS:
        aspect = aspects.get(dim_key, {})
        signals = list(aspect.get("signals", []))
        score = _derive_dim_score(base_score, signals)
        dimensions[dim_key] = {
            "score": score,
            "label": derive_dimension_label(score),
            "signals": signals,
            "labelZh": MONTHLY_DIMENSION_LABELS_ZH[dim_key],
        }

    # 7. Attach metadata + chartContext (mirrors daily_enhanced shape)
    month_result["targetYear"] = year
    month_result["targetMonth"] = month
    month_result["flowYear"] = flow_year
    month_result["monthLabel"] = f"{month_stem}{month_branch}月"
    # Audit fix HIGH #3 (2026-05-28): DTO + web mirror declare monthGanZhi
    # as required string. Engine MUST emit it explicitly — composing
    # ad-hoc at TS-side was inconsistent and would yield undefined for
    # any consumer reading engineOutput.monthGanZhi directly.
    month_result["monthGanZhi"] = f"{month_stem}{month_branch}"
    month_result["energyScore"] = base_score
    month_result["dimensions"] = dimensions
    month_result["partitionSpec"] = TIANGAN_DIZHI_HALF_PARTITION
    month_result["metaFraming"] = META_FRAMING_SOFT_TRIGGER
    month_result["preAnalysisVersion"] = FORTUNE_MONTHLY_PRE_ANALYSIS_VERSION

    # chartContext for NestJS prompt builder (mirrors daily-fortune)
    month_result["chartContext"] = {
        "gender": gender,
        "birthDate": birth_date,
        "birthTime": birth_time,
        "hourKnown": chart.get("hourKnown", True),
        "yearPillar": pillars["year"]["stem"] + pillars["year"]["branch"],
        "monthPillar": pillars["month"]["stem"] + pillars["month"]["branch"],
        "dayPillar": pillars["day"]["stem"] + pillars["day"]["branch"],
        "hourPillar": pillars["hour"]["stem"] + pillars["hour"]["branch"],
        "yearTenGod": pillars["year"].get("tenGod", ""),
        "monthTenGod": pillars["month"].get("tenGod", ""),
        "hourTenGod": pillars["hour"].get("tenGod", ""),
        "dayMaster": day_master_stem,
        "dayMasterElement": day_master.get("element", ""),
        "dayMasterYinYang": day_master.get("yinYang", ""),
        "strengthV2": day_master.get("strength", "neutral"),
        "usefulGod": day_master.get("usefulGod", ""),
        "favorableGod": day_master.get("favorableGod", ""),
        "tabooGod": day_master.get("tabooGod", ""),
        "enemyGod": day_master.get("enemyGod", ""),
        "flowYear": flow_year,
        "flowYearStem": flow_year_stem,
        "flowYearAuspiciousness": flow_year_auspiciousness,
    }

    return month_result


# ============================================================
# L1.b — Intra-month per-day aggregation
# ============================================================
#
# Per plan v4 H-new-1 (v4 final): L1.b reads per-day computes either from
# (a) caller-supplied `precomputed_days` dict (NestJS injects this from
# its DailyFortuneSnapshot cache lookup — keeps DB ownership clean) or
# (b) the in-process LRU `_l1b_daily_cache` (separate from
# `_flow_year_cache` to avoid mixing scopes). NEVER writes to the
# DailyFortuneSnapshot table — that's `/daily-fortune.persistSnapshot`'s
# exclusive ownership; double-writes would misfire the `aiFailureCount`
# circuit breaker on rows with `promptVersion=null`.

_L1B_DAILY_CACHE_MAXSIZE = 64
_l1b_daily_cache: Dict[Tuple[str, str], Dict[str, Any]] = {}


def _reset_l1b_cache_for_tests() -> None:
    """Test-only helper to reset the L1.b in-process per-day cache."""
    _l1b_daily_cache.clear()


# ============================================================
# Shensha keyword catalog (for dominant_shensha aggregation)
# ============================================================
#
# Per Phase 12b/12c doctrine + Phase 1 daily fortune signal vocabulary.
# When a daily signal text contains one of these keywords, we increment
# its frequency count for the bucket. Top-3 most-frequent shensha names
# become the bucket's `dominant_shensha`.

_SHENSHA_KEYWORDS: Tuple[str, ...] = (
    # Romance / 桃花 family (Phase 1 daily dim)
    "紅鸞", "天喜", "桃花", "正緣", "偏緣",
    # Movement / 驛馬 family (Phase 1 daily dim)
    "驛馬", "沖日支",
    # Officer / 殺印 family (Phase 12b Fix C)
    "殺印", "官印", "正官", "七殺", "偏官",
    # Wealth / 比劫 family (Phase 12h.B + Phase 12b/c)
    "比劫", "奪財",
    # Branch interactions (Phase 12c)
    "六合", "六沖", "六害", "三刑", "半刑", "沖庫", "伏吟",
    # Shang-Guan family (Phase 12g)
    "傷官見官", "食神制殺",
    # Spouse palace
    "配偶宮", "配偶星",
)

# Labels grouped by auspicious / challenging / neutral for bucket counts
_AUSPICIOUS_LABELS = {"大吉", "吉", "吉中有凶"}
_CHALLENGING_LABELS = {"凶中有吉", "小凶", "凶", "大凶", "凶上加凶"}
# 平 → neutral


def _resolve_day_in_bucket(
    day_index: int, bucket: PartitionBucket, window_length: int
) -> bool:
    """Check if `day_index` (1-based within 流月 window) falls in this bucket."""
    start, end = bucket["day_range"]
    actual_end = window_length if end is None else end
    return start <= day_index <= actual_end


def _extract_shensha_from_signals(signals: List[str]) -> List[str]:
    """Extract shensha keyword matches from a list of signal strings.

    A single signal may match multiple keywords (e.g., «沖日支同紅鸞» →
    [沖日支, 紅鸞]). Returns the raw list (no dedup); caller's Counter
    handles frequency.
    """
    matches: List[str] = []
    for signal in signals:
        for kw in _SHENSHA_KEYWORDS:
            if kw in signal:
                matches.append(kw)
    return matches


def _aggregate_bucket(
    *,
    bucket: PartitionBucket,
    days_in_bucket: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Aggregate per-day engine outputs into one bucket summary."""
    auspicious_count = 0
    challenging_count = 0
    neutral_count = 0
    all_shensha: List[str] = []
    # peak_signals: top 3 days by abs(energyScore - 50) — biggest movers
    day_score_pairs: List[Tuple[date, int, str, Dict[str, Any]]] = []

    for day_result in days_in_bucket:
        label = day_result.get("auspiciousness", "平")
        if label in _AUSPICIOUS_LABELS:
            auspicious_count += 1
        elif label in _CHALLENGING_LABELS:
            challenging_count += 1
        else:
            neutral_count += 1

        # Collect shensha from ALL 5 dim signal arrays
        dims = day_result.get("dimensions", {})
        for dim_data in dims.values():
            sigs = dim_data.get("signals", []) if isinstance(dim_data, dict) else []
            # Each sig may be a string OR a dict with 'narrative' field
            sig_strs = []
            for s in sigs:
                if isinstance(s, str):
                    sig_strs.append(s)
                elif isinstance(s, dict):
                    sig_strs.append(s.get("narrative", "") or s.get("type", ""))
            all_shensha.extend(_extract_shensha_from_signals(sig_strs))

        # Track day for peak_signals (top by abs movement from 50)
        score = day_result.get("energyScore", 50)
        day_score_pairs.append(
            (
                day_result.get("date"),
                score,
                label,
                day_result,
            )
        )

    # Top-3 dominant shensha by frequency
    shensha_counter = Counter(all_shensha)
    dominant_shensha = [name for name, _count in shensha_counter.most_common(3)]

    # Top-3 peak signal days by abs(score - 50) — biggest movers in either direction
    peak_sorted = sorted(
        day_score_pairs, key=lambda t: abs(t[1] - 50), reverse=True
    )[:3]
    peak_signals = []
    for day_date, score, label, day_result in peak_sorted:
        # Surface 1-2 representative signal strings per peak day
        rep_signals: List[str] = []
        dims = day_result.get("dimensions", {})
        for dim_data in dims.values():
            sigs = dim_data.get("signals", []) if isinstance(dim_data, dict) else []
            for s in sigs:
                if isinstance(s, str) and s:
                    rep_signals.append(s)
                elif isinstance(s, dict):
                    narr = s.get("narrative", "") or s.get("type", "")
                    if narr:
                        rep_signals.append(narr)
        peak_signals.append(
            {
                "date": day_date.isoformat() if day_date else None,
                "energyScore": score,
                "label": label,
                "signals": rep_signals[:3],  # cap at 3 to keep payload light
            }
        )

    return {
        "label": bucket["label"],
        "day_range": list(bucket["day_range"]),
        "governing_pillar": bucket["governing_pillar"],
        "auspicious_days": auspicious_count,
        "challenging_days": challenging_count,
        "neutral_days": neutral_count,
        "peak_signals": peak_signals,
        "dominant_shensha": dominant_shensha,
    }


def compute_intra_month_breakdown(
    *,
    birth_date: str,
    birth_time: Optional[str],
    birth_city: str,
    birth_timezone: str,
    gender: str,
    year: int,
    month: int,
    partition_spec: Optional[PartitionSpec] = None,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
    precomputed_days: Optional[Dict[str, Dict[str, Any]]] = None,
    hour_known: bool = True,
) -> Dict[str, Any]:
    """Aggregate per-day signals across a 流月 into per-partition buckets.

    Per plan v4 L1.b spec. Each day in the 流月 window is computed via
    `compute_daily_fortune`, with 3-tier cache:
    1. `precomputed_days` (caller-supplied dict from NestJS
       DailyFortuneSnapshot cache, keyed by ISO date string)
    2. `_l1b_daily_cache` (in-process LRU, keyed by (chart_hash, iso_date))
    3. Cold compute via `compute_daily_fortune`

    NEVER writes to DailyFortuneSnapshot DB (per plan v4 H-new-1 fix —
    avoids ownership race with `/daily-fortune.persistSnapshot` circuit
    breaker).

    Args:
        birth_date, birth_time, birth_city, birth_timezone, gender: chart identity
        year, month: Gregorian target (flow-year resolution applied internally)
        partition_spec: defaults to `TIANGAN_DIZHI_HALF_PARTITION` (locked
            per Phase A Sub-Agent A)
        precomputed_days: optional dict mapping ISO date string ('YYYY-MM-DD')
            → daily fortune engine output, for skipping individual day
            computes when NestJS has them cached

    Returns:
        {
            'scheme_id': str,
            'liuyue_window': {'start': iso, 'end': iso, 'days': int},
            'buckets': [
                {
                    'label': '上半月' | '下半月',
                    'day_range': [start, end],
                    'governing_pillar': 'stem' | 'branch',
                    'auspicious_days': int,
                    'challenging_days': int,
                    'neutral_days': int,
                    'peak_signals': List[Dict],  # top 3 by abs(score-50)
                    'dominant_shensha': List[str],  # top 3 by frequency
                },
                ...
            ],
        }
    """
    spec: PartitionSpec = partition_spec or TIANGAN_DIZHI_HALF_PARTITION

    # 1. Resolve flow year + month pillar (reuse L1 logic)
    flow_year, month_stem, month_branch = _resolve_flow_year_and_month_pillar(
        year, month
    )

    # 2. Get chart for flow year (cached via _flow_year_cache from L1)
    chart = _get_or_compute_chart_for_flow_year(
        birth_date=birth_date,
        birth_time=birth_time,
        birth_city=birth_city,
        birth_timezone=birth_timezone,
        gender=gender,
        flow_year=flow_year,
        birth_longitude=birth_longitude,
        birth_latitude=birth_latitude,
        hour_known=hour_known,
    )

    # 3. Get monthly_stars + resolve 流月 day window
    pillars = chart["fourPillars"]
    day_master = chart["dayMaster"]
    day_master_stem = chart["dayMasterStem"]
    monthly_stars = calculate_monthly_stars(
        year=flow_year, day_master_stem=day_master_stem
    )
    start_date, end_date_exclusive = _resolve_liuyue_day_window(
        monthly_stars, (month_stem, month_branch)
    )
    # end_date_exclusive is the NEXT 流月's start day — so the LAST day of
    # this 流月 is end_date_exclusive - 1.
    last_day = end_date_exclusive - timedelta(days=1)
    window_length = (last_day - start_date).days + 1

    # 4. Resolve compute_daily_fortune inputs from chart
    effective_gods = {
        "usefulGod": day_master.get("usefulGod", ""),
        "favorableGod": day_master.get("favorableGod", ""),
        "idleGod": day_master.get("idleGod", ""),
        "tabooGod": day_master.get("tabooGod", ""),
        "enemyGod": day_master.get("enemyGod", ""),
    }
    is_cong_ge = bool(
        chart.get("lifetimeEnhancedInsights", {})
        .get("deterministic", {})
        .get("cong_ge_detected")
    )
    annual_insights = chart.get("annualEnhancedInsights", {})
    flow_year_data = annual_insights.get("flowYear", {})
    flow_year_stem = flow_year_data.get("stem", "")
    flow_year_auspiciousness = flow_year_data.get("auspiciousness", "平")
    chart_hash = _compute_chart_hash(
        birth_date, birth_time, birth_city, birth_timezone, gender
    )

    # 5. Iterate days in window, populate per-day results via 3-tier cache
    per_day_results: List[Dict[str, Any]] = []
    current = start_date
    while current <= last_day:
        iso_str = current.isoformat()

        # Tier 1: caller-supplied precomputed (NestJS DailyFortuneSnapshot)
        day_result: Optional[Dict[str, Any]] = None
        if precomputed_days and iso_str in precomputed_days:
            day_result = precomputed_days[iso_str]

        # Tier 2: in-process LRU cache
        if day_result is None:
            cache_key = (chart_hash, iso_str)
            if cache_key in _l1b_daily_cache:
                day_result = _l1b_daily_cache[cache_key]
            else:
                # Tier 3: cold compute
                day_result = compute_daily_fortune(
                    pillars=pillars,
                    day_master_stem=day_master_stem,
                    effective_gods=effective_gods,
                    useful_god_element=day_master.get("usefulGod", "土"),
                    gender=gender,
                    kong_wang=chart.get("kongWang", []),
                    strength=day_master.get("strength", "neutral"),
                    is_cong_ge=is_cong_ge,
                    target_date=current,
                    flow_year_stem=flow_year_stem,
                    flow_year_auspiciousness=flow_year_auspiciousness,
                )
                # Bound LRU + insert
                if len(_l1b_daily_cache) >= _L1B_DAILY_CACHE_MAXSIZE:
                    oldest_key = next(iter(_l1b_daily_cache))
                    del _l1b_daily_cache[oldest_key]
                _l1b_daily_cache[cache_key] = day_result

        # Attach the calendar date for downstream aggregation
        day_result_with_date = dict(day_result)
        day_result_with_date["date"] = current
        per_day_results.append(day_result_with_date)

        current = current + timedelta(days=1)

    # 6. Bucket days into partitions
    bucket_results: List[Dict[str, Any]] = []
    for bucket in spec["buckets"]:
        days_in_this_bucket = [
            day_result_with_date
            for day_index, day_result_with_date in enumerate(per_day_results, start=1)
            if _resolve_day_in_bucket(day_index, bucket, window_length)
        ]
        bucket_results.append(
            _aggregate_bucket(bucket=bucket, days_in_bucket=days_in_this_bucket)
        )

    return {
        "scheme_id": spec["scheme_id"],
        "liuyue_window": {
            "start": start_date.isoformat(),
            "end": last_day.isoformat(),
            "days": window_length,
        },
        "buckets": bucket_results,
    }
