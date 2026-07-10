"""
Phase 3 年運 (Yearly Fortune) — engine tests for `yearly_enhanced.py`.

Covers: 4-dim aggregation (hybrid mean-with-peak), star bands aligned to
DIMENSION_LABEL_BANDS, 核心風險&機會 ranking + separation gate + flatYear,
deterministic 改運 luck methods (weakest-dim + 用神 dispatch), romance≠relationships,
soft-trigger metaFraming, Roger/Laopo 2026 anchors, direct generate_annual_pre_analysis
call pattern (no silent-empty).
"""

from __future__ import annotations

import pytest

from app.yearly_enhanced import (
    DIM_METHOD_CARDS,
    USEFUL_GOD_FLAVOR,
    aggregate_yearly_dim_score,
    compute_core_risk_opportunity,
    compute_year_by_year,
    compute_yearly_luck_methods,
    dim_score_to_stars,
)
from app.monthly_enhanced import _reset_flow_year_cache_for_tests
from app.fortune_constants import FORTUNE_YEARLY_PRE_ANALYSIS_VERSION


ROGER = dict(
    birth_date="1987-09-06", birth_time="16:11", birth_city="吉打",
    birth_timezone="Asia/Kuala_Lumpur", gender="male",
)
LAOPO = dict(
    birth_date="1987-01-25", birth_time="12:00", birth_city="台北",
    birth_timezone="Asia/Taipei", gender="female",
)


@pytest.fixture(autouse=True)
def _reset_cache():
    _reset_flow_year_cache_for_tests()
    yield


# ============================================================
# Aggregation (hybrid mean-with-peak-emphasis)
# ============================================================

def test_aggregate_flat_equals_mean():
    assert aggregate_yearly_dim_score([50] * 12) == 50


def test_aggregate_empty_defaults_50():
    assert aggregate_yearly_dim_score([]) == 50


def test_aggregate_peak_emphasis_lifts_above_mean():
    # mean=60, peak3=90 → 60 + 0.35*(90-60) = 70.5 → 70
    scores = [50] * 9 + [90] * 3
    result = aggregate_yearly_dim_score(scores)
    assert result == 70
    # Must be above the plain mean (60) — peak months carry the aspect
    assert result > 60


def test_aggregate_never_below_mean():
    # peak_mean >= mean always → blend never lowers below mean
    scores = [30, 40, 50, 60, 70, 80, 20, 25, 35, 45, 55, 65]
    mean = round(sum(scores) / len(scores))
    assert aggregate_yearly_dim_score(scores) >= mean


def test_aggregate_clamped_0_100():
    assert 0 <= aggregate_yearly_dim_score([100] * 12) <= 100
    assert 0 <= aggregate_yearly_dim_score([0] * 12) <= 100


# ============================================================
# Star bands (aligned to DIMENSION_LABEL_BANDS 80/65/50/35)
# ============================================================

@pytest.mark.parametrize("score,stars", [
    (100, 5), (80, 5), (79, 4), (65, 4), (64, 3), (50, 3),
    (49, 2), (35, 2), (34, 1), (0, 1),
])
def test_star_bands(score, stars):
    assert dim_score_to_stars(score) == stars


# ============================================================
# 核心風險&機會 ranking
# ============================================================

def _mk_month(idx, ausp):
    return {
        "monthIndex": idx,
        "monthLabel": f"{idx}月",
        "auspiciousness": ausp,
        "aspects": {
            "career": {"signals": []},
            "finance": {"signals": []},
            "romance": {"signals": []},
            "health": {"signals": []},
        },
    }


def test_risk_opportunity_separation_gate_and_ranking():
    # 3 大吉 (88), 3 大凶 (15), 6 平 (50)
    months = (
        [_mk_month(i, "大吉") for i in range(1, 4)]
        + [_mk_month(i, "大凶") for i in range(4, 7)]
        + [_mk_month(i, "平") for i in range(7, 13)]
    )
    result = compute_core_risk_opportunity(months, "health", "career")
    assert len(result["opportunities"]) == 3  # the 3 大吉
    assert len(result["risks"]) == 3  # the 3 大凶
    assert result["flatYear"] is False
    assert all(e["energyScore"] >= 58 for e in result["opportunities"])
    assert all(e["energyScore"] <= 42 for e in result["risks"])


def test_flat_year_emits_empty_lists_and_sentinel():
    # All 平 (50) → energy 50 is between gates (42 < 50 < 58) → no risk/opp
    months = [_mk_month(i, "平") for i in range(1, 13)]
    result = compute_core_risk_opportunity(months, "health", "career")
    assert result["opportunities"] == []
    assert result["risks"] == []
    assert result["flatYear"] is True


def test_risk_opportunity_never_pads_below_three():
    # Only 1 大吉, 1 大凶, rest 平 → exactly 1 opp + 1 risk (NO padding)
    months = (
        [_mk_month(1, "大吉")] + [_mk_month(2, "大凶")]
        + [_mk_month(i, "平") for i in range(3, 13)]
    )
    result = compute_core_risk_opportunity(months, "health", "career")
    assert len(result["opportunities"]) == 1
    assert len(result["risks"]) == 1
    assert result["flatYear"] is False


def test_dim_attribution_uses_signal_deviation():
    # A 吉 month with strong positive romance signals → romance dominant
    m = {
        "monthIndex": 6, "monthLabel": "6月", "auspiciousness": "吉",
        "aspects": {
            "career": {"signals": []},
            "finance": {"signals": []},
            "romance": {"signals": ["桃花活躍", "感情融洽", "貴人助力"]},
            "health": {"signals": []},
        },
    }
    months = [m] + [_mk_month(i, "平") for i in range(1, 12)]
    result = compute_core_risk_opportunity(months, "health", "career")
    assert len(result["opportunities"]) == 1
    assert result["opportunities"][0]["dim"] == "romance"
    assert result["opportunities"][0]["dimZh"] == "感情"


# ============================================================
# Deterministic 改運 luck methods
# ============================================================

def test_luck_methods_weakest_dim_card():
    dim_scores = {"career": 70, "finance": 70, "romance": 70, "health": 40}
    result = compute_yearly_luck_methods(useful_god_element="火", dim_scores=dim_scores)
    assert result["weakestDim"] == "health"
    titles = [c["title"] for c in result["cards"]]
    assert "養生調息法" in titles  # health card
    assert "運勢整理法" in titles and "社交磁場法" in titles  # both generic
    assert len(result["cards"]) == 3


def test_luck_methods_tiebreak_health_first():
    # all tied → health wins per DIM_TIEBREAK_ORDER
    dim_scores = {"career": 50, "finance": 50, "romance": 50, "health": 50}
    result = compute_yearly_luck_methods(useful_god_element="水", dim_scores=dim_scores)
    assert result["weakestDim"] == "health"


def test_luck_methods_useful_god_flavor_spliced():
    dim_scores = {"career": 40, "finance": 70, "romance": 70, "health": 70}
    result = compute_yearly_luck_methods(useful_god_element="水", dim_scores=dim_scores)
    card0 = result["cards"][0]
    assert card0["provenance"] == "mixed"
    assert card0["usefulGodElement"] == "水"
    assert card0["usefulGodDirection"] == "北方"  # matches ELEMENT_DIRECTION
    assert "北方" in card0["body"]


def test_luck_methods_all_five_useful_god_elements():
    for elem, expect_dir in [("木", "東方"), ("火", "南方"), ("土", "南方"),
                             ("金", "西方"), ("水", "北方")]:
        assert USEFUL_GOD_FLAVOR[elem]["direction"] == expect_dir


def test_luck_methods_disclaimer_present():
    result = compute_yearly_luck_methods(
        useful_god_element="火", dim_scores={"career": 50, "finance": 50, "romance": 50, "health": 50}
    )
    assert "民俗" in result["disclaimer"]
    assert "醫療" in result["disclaimer"]


# ============================================================
# End-to-end anchors (Roger + Laopo 2026)
# ============================================================

def test_roger_2026_anchor():
    r = compute_year_by_year(**ROGER, year=2026)
    assert r["yearGanZhi"] == "丙午"
    assert r["yearTenGod"] == "偏印"  # DM=戊, 丙→偏印
    assert r["auspiciousness"] == "大吉"
    assert r["energyScore"] == 88
    assert r["metaFraming"] == "soft_trigger"
    assert r["preAnalysisVersion"] == FORTUNE_YEARLY_PRE_ANALYSIS_VERSION
    # 4 dims, all present with stars
    assert set(r["dimensions"].keys()) == {"career", "finance", "romance", "health"}
    for dim in r["dimensions"].values():
        assert 1 <= dim["stars"] <= 5
        assert dim["score"] == max(0, min(100, dim["score"]))
    # risk/opportunity month labels are «N月» formatted
    cro = r["coreRiskOpportunity"]
    for e in cro["opportunities"] + cro["risks"]:
        assert e["monthLabel"].endswith("月")
        assert 1 <= e["month"] <= 12


def test_laopo_2026_useful_god_water_dispatch():
    r = compute_year_by_year(**LAOPO, year=2026)
    # Laopo 用神=水 → luck card flavor must be 水/北方 (NOT Roger's 火/南方)
    card0 = r["luckMethods"]["cards"][0]
    assert card0["usefulGodElement"] == "水"
    assert card0["usefulGodDirection"] == "北方"


def test_no_travel_dimension():
    r = compute_year_by_year(**ROGER, year=2026)
    assert "travel" not in r["dimensions"]


def test_chart_context_has_useful_god():
    r = compute_year_by_year(**ROGER, year=2026)
    assert r["chartContext"]["usefulGod"]  # non-empty
    assert r["chartContext"]["flowYearStem"] == "丙"
