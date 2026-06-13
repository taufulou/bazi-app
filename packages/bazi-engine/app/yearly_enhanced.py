"""
Yearly Enhanced — 八字年運 (Yearly Fortune) Phase 3.

Thin orchestration layer on top of the MATURE `generate_annual_pre_analysis`
(which powers the paid 八字流年運勢 reading). The free/subscriber 年運 tab is a
LIGHTER PREVIEW that cross-sells to the paid deep-dive — it surfaces:
- overall year auspiciousness (EnergyScoreRing 0-100)
- 4 star-rated dimensions (career/finance/romance/health — NO travel)
- 核心風險&機會 (top-3 opportunity + bottom-3 risk MONTHS, 1-liner each)
- deterministic 改運建議 luck-method cards (keyed on weakest-dim + 用神)

It does NOT duplicate the paid reading's full 12-month prose / deep 太歲 /
大運 sequence — those stay paywalled.

Architecture (Phase A research-locked 2026-05-29 — see
`.claude/plans/phase-3-nianyun-phase-a-research-results.md`):

⚠️ CRITICAL call-pattern: `generate_annual_pre_analysis` is NOT pre-populated
on the chart from `_get_or_compute_chart_for_flow_year` (that helper omits
`reading_type='ANNUAL'`, so chart['annualEnhancedInsights'] == {}). We call
`generate_annual_pre_analysis` DIRECTLY with 16 params destructured from the
chart (mirror `calculator.py:524-628`). Two params are NOT in the chart dict:
  - prominent_god → recompute via get_prominent_ten_god(pillars, dm_stem)
  - effective_gods → read from chart['preAnalysis']['effectiveFavorableGods']

立春 anchoring is UPSTREAM (in calculate_annual_stars at chart-build); we pass
current_year=year + chart['annualStars']. Year selection maps DIRECTLY to flow
year (NO cross-flow-year resolution like month — a 流年 IS 立春-to-立春).

Load-bearing doctrine (do NOT relax):
- 流年為君，大運為臣 (《三命通會·論流年》). Year tab is high-level only.
- 流年 = 持續趨勢 (sustained trend), NOT verdict. AI framed soft-trigger
  («今年宜/今年易於/今年趨向»), never absolute.
- 用神/喜神/忌神 are chart-level only — NO yearly reassignment.
- 4-dim aggregation: 三命通會 峰月主事 (activated months carry the aspect) →
  hybrid mean-with-peak-emphasis.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .annual_enhanced import generate_annual_pre_analysis
from .constants import STEM_ELEMENT
from .fortune_constants import (
    FORTUNE_YEARLY_PRE_ANALYSIS_VERSION,
    META_FRAMING_SOFT_TRIGGER,
    derive_dimension_label,
    derive_energy_score,
)
from .lifetime_enhanced import ELEMENT_DIRECTION
from .monthly_enhanced import (
    _classify_signal_sentiment,
    _derive_dim_score,
    _get_or_compute_chart_for_flow_year,
)
from .ten_gods import get_prominent_ten_god


# ============================================================
# 4 yearly dimension keys (LOCKED at 4 — no 出行; 感情=romance NOT 人際關係)
# ============================================================

YEARLY_DIMENSION_KEYS: List[str] = ["career", "finance", "romance", "health"]

YEARLY_DIMENSION_LABELS_ZH: Dict[str, str] = {
    "career": "事業",
    "finance": "財運",
    "romance": "感情",
    "health": "健康",
}


# ============================================================
# Aggregation tuning (Phase A Sub-Agent A — 峰月主事)
# ============================================================
#
# Hybrid mean-with-peak-emphasis: blended = mean + ALPHA*(peak_mean - mean).
# peak_mean = mean of the top PEAK_QUARTILE_COUNT monthly dim scores.
# ALPHA=0.0 reverts to pure arithmetic mean (fallback if validation shows
# over-inflation). peak_mean >= mean always, so blend never lowers a dim
# below its mean (risk months surface separately, not by depressing stars).

PEAK_EMPHASIS_ALPHA = 0.35
PEAK_QUARTILE_COUNT = 3


def aggregate_yearly_dim_score(monthly_dim_scores: List[int]) -> int:
    """Blend 12 monthly per-dim scores (each 0-100) into one year-level score."""
    if not monthly_dim_scores:
        return 50
    n = len(monthly_dim_scores)
    mean = sum(monthly_dim_scores) / n
    k = min(PEAK_QUARTILE_COUNT, n)
    peak_mean = sum(sorted(monthly_dim_scores, reverse=True)[:k]) / k
    blended = mean + PEAK_EMPHASIS_ALPHA * (peak_mean - mean)
    return max(0, min(100, round(blended)))


def dim_score_to_stars(score: int) -> int:
    """Map year-level 0-100 dim score → ★1-5, aligned to DIMENSION_LABEL_BANDS."""
    if score >= 80:
        return 5  # 極佳
    if score >= 65:
        return 4  # 順遂
    if score >= 50:
        return 3  # 平穩
    if score >= 35:
        return 2  # 需謹慎
    return 1  # 不利


# ============================================================
# 核心風險&機會 ranking (Phase A Sub-Agent A)
# ============================================================
#
# Separation gate: an opportunity month requires energy >= 58 (吉中有凶 floor);
# a risk month requires energy <= 42 (凶中有吉). Allow 0-3 per list — NEVER
# pad (padding a 平 month = fabrication, violates anti-hallucination Clause 4).
# Flat year → both empty → frontend `flatYear` sentinel → «今年運勢平穩».

OPPORTUNITY_ENERGY_GATE = 58
RISK_ENERGY_GATE = 42
RISK_OPP_SLOT_COUNT = 3


def _month_signal_magnitude(month: Dict[str, Any]) -> int:
    """Sum of absolute per-aspect signal-sentiment magnitudes (tie-break key)."""
    aspects = month.get("aspects", {}) or {}
    total = 0
    for dim in YEARLY_DIMENSION_KEYS:
        signals = (aspects.get(dim, {}) or {}).get("signals", []) or []
        total += abs(sum(_classify_signal_sentiment(s) for s in signals))
    return total


def _attribute_dominant_dim(
    month: Dict[str, Any], weakest_dim: str, strongest_dim: str, slot: str
) -> Dict[str, Any]:
    """Attribute ONE dominant dimension to a selected month.

    Rule (Sub-Agent A): the dim whose `_derive_dim_score` deviates MOST from
    the month's base energy score. Phrase by slot + deviation sign.
    Fallback when all dims flat (no signals): weakest-dim for risk slot,
    strongest-dim for opportunity slot — so attribution is never blank.

    Returns {dim, dimZh, deviation, caveat} where caveat is set when an
    opportunity month's dominant dim deviates negative (吉中有凶 doctrine).
    """
    base = derive_energy_score(month.get("auspiciousness", "平"))
    aspects = month.get("aspects", {}) or {}
    best_dim: Optional[str] = None
    best_dev = -1
    best_signed = 0
    for dim in YEARLY_DIMENSION_KEYS:  # stable order = deterministic tie-break
        signals = (aspects.get(dim, {}) or {}).get("signals", []) or []
        dim_score = _derive_dim_score(base, signals)
        dev = abs(dim_score - base)
        if dev > best_dev:
            best_dev = dev
            best_dim = dim
            best_signed = dim_score - base

    if best_dim is None or best_dev == 0:
        # All dims flat — fall back to chart-level weakest/strongest.
        best_dim = weakest_dim if slot == "risk" else strongest_dim
        best_signed = -1 if slot == "risk" else 1

    caveat = bool(slot == "opportunity" and best_signed < 0)
    return {
        "dim": best_dim,
        "dimZh": YEARLY_DIMENSION_LABELS_ZH[best_dim],
        "deviationSign": "positive" if best_signed >= 0 else "negative",
        "caveat": caveat,
    }


def compute_core_risk_opportunity(
    monthly_forecasts: List[Dict[str, Any]],
    weakest_dim: str,
    strongest_dim: str,
) -> Dict[str, Any]:
    """Rank 12 months → top-3 opportunity + bottom-3 risk months.

    Returns {opportunities: [...], risks: [...], flatYear: bool}.
    Each entry: {month, monthLabel, auspiciousness, energyScore, dim, dimZh,
    deviationSign, caveat}. Order is LOAD-BEARING for AI pairing (L3 injector
    emits these in this order; the AI writes keywords by array index).
    """
    enriched = []
    for m in monthly_forecasts:
        energy = derive_energy_score(m.get("auspiciousness", "平"))
        enriched.append((m, energy, _month_signal_magnitude(m)))

    # Sort ascending by energy (risks first); tie-break: smaller magnitude
    # first for risks (we reverse for opportunities); final tie-break earlier
    # month. We sort by (energy, magnitude, monthIndex) — for risks take the
    # head; for opportunities take the tail (highest energy, then magnitude).
    by_energy_asc = sorted(
        enriched,
        key=lambda t: (t[1], t[2], t[0].get("monthIndex", 0)),
    )

    def _entry(m: Dict[str, Any], energy: int, slot: str) -> Dict[str, Any]:
        attr = _attribute_dominant_dim(m, weakest_dim, strongest_dim, slot)
        month_index = m.get("monthIndex", 0)
        # monthLabel display = calendar month number (Seer shows «12月 疲勞信號»).
        # The engine's raw `monthLabel`/`month` key may be a bare int — coerce
        # to the canonical «N月» display form deterministically.
        month_label = f"{month_index}月" if month_index else str(
            m.get("monthLabel", "")
        )
        return {
            "month": month_index,
            "monthLabel": month_label,
            "auspiciousness": m.get("auspiciousness", "平"),
            "energyScore": energy,
            "dim": attr["dim"],
            "dimZh": attr["dimZh"],
            "deviationSign": attr["deviationSign"],
            "caveat": attr["caveat"],
            "slot": slot,
        }

    # Risks = lowest energy, gated at <= RISK_ENERGY_GATE
    risks: List[Dict[str, Any]] = []
    for m, energy, _mag in by_energy_asc:
        if energy <= RISK_ENERGY_GATE and len(risks) < RISK_OPP_SLOT_COUNT:
            risks.append(_entry(m, energy, "risk"))

    # Opportunities = highest energy (reverse), gated at >= OPPORTUNITY_ENERGY_GATE.
    # Reverse the ascending sort for highest-first; tie-break already baked in
    # (higher magnitude later in asc order → earlier in reversed).
    opportunities: List[Dict[str, Any]] = []
    for m, energy, _mag in reversed(by_energy_asc):
        if (
            energy >= OPPORTUNITY_ENERGY_GATE
            and len(opportunities) < RISK_OPP_SLOT_COUNT
        ):
            opportunities.append(_entry(m, energy, "opportunity"))

    flat_year = len(risks) == 0 and len(opportunities) == 0
    return {
        "opportunities": opportunities,
        "risks": risks,
        "flatYear": flat_year,
    }


# ============================================================
# 改運建議 deterministic luck-method templates (Phase A Sub-Agent B)
# ============================================================

GENERIC_METHOD_CARDS: List[Dict[str, str]] = [
    {
        "id": "yunshi_zhengli",
        "title": "運勢整理法",
        "body": "定期回顧近期的目標與進度，適時調整下一步方向。把雜亂的計畫理清，運勢自然走得更順、更有節奏。",
        "provenance": "folk_tradition",
    },
    {
        "id": "shejiao_cichang",
        "title": "社交磁場法",
        "body": "多參與興趣社群或朋友聚會，主動擴展生活圈。人脈一旦流動起來，貴人與機緣也會隨之增加。",
        "provenance": "folk_tradition",
    },
]

DIM_METHOD_CARDS: Dict[str, Dict[str, str]] = {
    "career": {
        "id": "lichang_tisheng",
        "title": "立場提升法",
        "body": "為自己設定一項可衡量的小目標並如期完成，逐步累積專業可信度。穩紮穩打地展現實力，事業舞台會慢慢為你打開。",
        "provenance": "folk_tradition",
    },
    "finance": {
        "id": "zengcai_xingdong",
        "title": "增財行動法",
        "body": "試著用自己擅長的技能創造額外收入來源，讓財路多元化。開源比守財更能讓財運活絡起來。",
        "provenance": "folk_tradition",
    },
    "romance": {
        "id": "yuanfen_kaikuo",
        "title": "緣分開闊法",
        "body": "保持親切開朗的姿態，多接觸新環境與新朋友。把心打開、減少防備，好的緣分才有空間靠近。",
        "provenance": "folk_tradition",
    },
    "health": {
        "id": "yangsheng_tiaoxi",
        "title": "養生調息法",
        "body": "規律作息、適度運動，搭配深呼吸與充足睡眠來養足精神。身體的根基穩了，整體運勢也更有後盾。",
        "provenance": "folk_tradition",
    },
}

# 用神 element flavor (classical — 協紀辨方書 24山方位 + 黃帝內經素問·五常政大論
# 五色; direction matches engine ELEMENT_DIRECTION incl 土=南方 火生土).
USEFUL_GOD_FLAVOR: Dict[str, Dict[str, str]] = {
    "木": {
        "direction": "東方",
        "color": "綠色 / 青色",
        "flavorLine": "你的用神為木，平日可多往東方走動、穿戴綠色系，並親近花草林木，藉木氣助運。",
    },
    "火": {
        "direction": "南方",
        "color": "紅色 / 紫色",
        "flavorLine": "你的用神為火，平日可多往南方走動、穿戴紅紫色系，增加曝光與社交熱度，藉火氣旺運。",
    },
    "土": {
        "direction": "南方",
        "color": "黃色 / 棕色",
        "flavorLine": "你的用神為土，平日可多往南方走動、穿戴黃棕色系，並腳踏實地經營日常，藉土氣穩運。",
    },
    "金": {
        "direction": "西方",
        "color": "白色 / 金色",
        "flavorLine": "你的用神為金，平日可多往西方走動、穿戴白金色系，保持環境整潔有序，藉金氣助運。",
    },
    "水": {
        "direction": "北方",
        "color": "黑色 / 藍色",
        "flavorLine": "你的用神為水，平日可多往北方走動、穿戴黑藍色系，並親近水域、保持思緒流動，藉水氣旺運。",
    },
}

# Weakest-dim tie-break: health most-actionable + lowest doctrinal risk;
# romance last (改運 romance advice drifts toward 桃花 superstition fastest).
DIM_TIEBREAK_ORDER: List[str] = ["health", "finance", "career", "romance"]

LUCK_METHODS_DISCLAIMER = (
    "改運建議僅為民俗參考與生活提示，不構成命理保證或專業醫療／投資建議。"
)


def _pick_weakest_dim(dim_scores: Dict[str, int]) -> str:
    """Weakest dim with deterministic tie-break (health>finance>career>romance)."""
    lo = min(dim_scores.values())
    for dim in DIM_TIEBREAK_ORDER:
        if dim_scores.get(dim) == lo:
            return dim
    return "health"  # defensive fallback


def compute_yearly_luck_methods(
    *, useful_god_element: str, dim_scores: Dict[str, int]
) -> Dict[str, Any]:
    """Return ~3 deterministic 改運 method cards + disclaimer.

    2 generic cards + 1 weakest-dim card; 用神 element flavor line spliced
    into the FIRST generic card (card becomes provenance 'mixed').
    """
    weakest = _pick_weakest_dim(dim_scores)
    cards: List[Dict[str, str]] = [dict(c) for c in GENERIC_METHOD_CARDS]
    cards.append(dict(DIM_METHOD_CARDS[weakest]))

    flavor = USEFUL_GOD_FLAVOR.get(useful_god_element)
    if flavor:
        cards[0] = {
            **cards[0],
            "body": cards[0]["body"] + " " + flavor["flavorLine"],
            "provenance": "mixed",  # folk body + classical 用神 tail
            "flavorProvenance": "classical",
            "usefulGodElement": useful_god_element,
            "usefulGodDirection": flavor["direction"],
            "usefulGodColor": flavor["color"],
        }

    return {
        "cards": cards,
        "weakestDim": weakest,
        "weakestDimZh": YEARLY_DIMENSION_LABELS_ZH[weakest],
        "disclaimer": LUCK_METHODS_DISCLAIMER,
    }


# ============================================================
# Public entry point
# ============================================================


def compute_year_by_year(
    *,
    birth_date: str,
    birth_time: Optional[str],
    birth_city: str,
    birth_timezone: str,
    gender: str,
    year: int,
    birth_longitude: Optional[float] = None,
    birth_latitude: Optional[float] = None,
    hour_known: bool = True,
) -> Dict[str, Any]:
    """Compute 八字年運 (yearly fortune) for the given chart on a flow year.

    Year selection maps DIRECTLY to the 立春-anchored flow year (no
    cross-flow-year resolution like month). Reuses the mature
    `generate_annual_pre_analysis` doctrine; layers 4-dim star aggregation +
    核心風險&機會 ranking + deterministic 改運 methods on top.
    """
    # 1. Chart for flow year (in-process LRU cached). NOTE: this chart does
    #    NOT have annualEnhancedInsights (omits reading_type='ANNUAL').
    chart = _get_or_compute_chart_for_flow_year(
        birth_date=birth_date,
        birth_time=birth_time,
        birth_city=birth_city,
        birth_timezone=birth_timezone,
        gender=gender,
        flow_year=year,
        birth_longitude=birth_longitude,
        birth_latitude=birth_latitude,
        hour_known=hour_known,
    )

    # 2. Destructure 16 params from chart (mirror calculator.py:524-628).
    pillars = chart["fourPillars"]
    day_master_stem = chart["dayMasterStem"]
    pre_analysis = chart["preAnalysis"]
    five_elements_balance = chart["fiveElementsBalanceRaw"]
    effective_gods = pre_analysis["effectiveFavorableGods"]
    strength_v2 = pre_analysis["strengthV2"]
    cong_ge = pre_analysis.get("congGe")
    luck_periods = chart["luckPeriods"]
    annual_stars = chart["annualStars"]  # REQUIRED else silent {'error': ...}
    monthly_stars = chart["monthlyStars"]
    kong_wang = chart["kongWang"]
    all_shen_sha = chart["allShenSha"]
    branch_relationships = pre_analysis.get("pillarRelationships", {}).get(
        "branchRelationships"
    )
    birth_year = int(birth_date.split("-")[0])
    # prominent_god is NOT in the chart dict — recompute (calculator.py:545).
    prominent_god = get_prominent_ten_god(pillars, day_master_stem)

    # 3. Call generate_annual_pre_analysis DIRECTLY (16 params).
    annual = generate_annual_pre_analysis(
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
        current_year=year,
        shen_sha=all_shen_sha,
    )

    if isinstance(annual, dict) and annual.get("error"):
        raise ValueError(
            f"generate_annual_pre_analysis failed for flow_year={year}: "
            f"{annual['error']} (likely empty annual_stars — check chart pipeline)"
        )

    flow_year = annual["flowYear"]
    monthly_forecasts = annual.get("monthlyForecasts", []) or []

    # 4. Derive 4-dim YEAR scores by aggregating 12 monthly per-dim scores.
    dimensions: Dict[str, Dict[str, Any]] = {}
    for dim in YEARLY_DIMENSION_KEYS:
        per_month_scores: List[int] = []
        for m in monthly_forecasts:
            base = derive_energy_score(m.get("auspiciousness", "平"))
            signals = (m.get("aspects", {}).get(dim, {}) or {}).get("signals", []) or []
            per_month_scores.append(_derive_dim_score(base, signals))
        year_score = aggregate_yearly_dim_score(per_month_scores)
        dimensions[dim] = {
            "score": year_score,
            "label": derive_dimension_label(year_score),
            "stars": dim_score_to_stars(year_score),
            "labelZh": YEARLY_DIMENSION_LABELS_ZH[dim],
        }

    # 5. Overall year energy + risk/opportunity + luck methods.
    overall_auspiciousness = flow_year.get("auspiciousness", "平")
    energy_score = derive_energy_score(overall_auspiciousness)

    dim_scores = {d: dimensions[d]["score"] for d in YEARLY_DIMENSION_KEYS}
    weakest_dim = min(dim_scores, key=dim_scores.get)
    strongest_dim = max(dim_scores, key=dim_scores.get)

    core_risk_opportunity = compute_core_risk_opportunity(
        monthly_forecasts, weakest_dim, strongest_dim
    )

    useful_god_element = effective_gods.get("usefulGod", "") if isinstance(
        effective_gods, dict
    ) else ""
    luck_methods = compute_yearly_luck_methods(
        useful_god_element=useful_god_element, dim_scores=dim_scores
    )

    # 6. Assemble result (mirrors monthly shape; camelCase engine convention).
    year_stem = flow_year.get("stem", "")
    year_branch = flow_year.get("branch", "")
    return {
        "year": year,
        "yearGanZhi": f"{year_stem}{year_branch}",
        "yearStem": year_stem,
        "yearBranch": year_branch,
        "yearTenGod": flow_year.get("tenGod", ""),
        "flowYear": flow_year,
        "auspiciousness": overall_auspiciousness,
        "energyScore": energy_score,
        "dimensions": dimensions,
        "coreRiskOpportunity": core_risk_opportunity,
        "luckMethods": luck_methods,
        "metaFraming": META_FRAMING_SOFT_TRIGGER,
        "preAnalysisVersion": FORTUNE_YEARLY_PRE_ANALYSIS_VERSION,
        "chartContext": {
            "gender": gender,
            "birthDate": birth_date,
            "birthTime": birth_time,
            "hourKnown": chart.get("hourKnown", True),
            "yearPillar": pillars["year"]["stem"] + pillars["year"]["branch"],
            "monthPillar": pillars["month"]["stem"] + pillars["month"]["branch"],
            "dayPillar": pillars["day"]["stem"] + pillars["day"]["branch"],
            "hourPillar": pillars["hour"]["stem"] + pillars["hour"]["branch"],
            "dayMaster": day_master_stem,
            "usefulGod": effective_gods.get("usefulGod", "") if isinstance(effective_gods, dict) else "",
            "favorableGod": effective_gods.get("favorableGod", "") if isinstance(effective_gods, dict) else "",
            "tabooGod": effective_gods.get("tabooGod", "") if isinstance(effective_gods, dict) else "",
            "enemyGod": effective_gods.get("enemyGod", "") if isinstance(effective_gods, dict) else "",
            "flowYearStem": year_stem,
            "flowYearBranch": year_branch,
            "flowYearAuspiciousness": overall_auspiciousness,
        },
    }
