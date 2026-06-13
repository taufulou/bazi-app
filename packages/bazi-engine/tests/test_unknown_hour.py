"""
八字時辰未知 (Unknown Birth Hour) — Phase 1 engine tests.

Locks the hour-unknown behavior:
- the full LIFETIME pipeline runs WITHOUT exception (the critical guard-sweep regression);
- the hour pillar is blanked (empty stem/branch) and hourKnown=False;
- 年/月/日 pillars are byte-identical to the known-hour chart;
- 命宮/身宮 are null (need 時支); 胎元/胎息 survive (month/day only);
- 用神 is computed on 3 pillars and carries the reduced-confidence flags (D7);
- the known-hour path is unchanged (regression sanity).

Anchor: Roger (1987-09-06 吉打 male) = 丁卯/戊申/戊午/(庚申), DM 戊, 用神 火.
"""

from datetime import date

import pytest

from app.calculator import calculate_bazi, calculate_bazi_with_all_pipelines
from app.daily_enhanced import compute_daily_fortune
from app.four_pillars import is_hour_unknown
from app.monthly_enhanced import compute_single_month_by_yearmonth
from app.yearly_enhanced import compute_year_by_year

ROGER = dict(
    birth_date="1987-09-06",
    birth_city="吉打",
    birth_timezone="Asia/Kuala_Lumpur",
    gender="male",
    reading_type="LIFETIME",
)


@pytest.fixture(scope="module")
def roger_known():
    return calculate_bazi(birth_time="16:11", hour_known=True, **ROGER)


@pytest.fixture(scope="module")
def roger_unknown():
    return calculate_bazi(birth_time=None, hour_known=False, **ROGER)


# Laopo (1987-01-25 台北 female) = 丙寅/辛丑/甲戌/(壬申), DM 甲, very_weak/weak.
# Critical: a weak DM reaches check_cong_ge, which the per-anchor (neutral Roger)
# test missed — this locks that crash class.
LAOPO = dict(
    birth_date="1987-01-25",
    birth_city="台北市",
    birth_timezone="Asia/Taipei",
    gender="female",
    reading_type="LIFETIME",
)


@pytest.fixture(scope="module")
def laopo_unknown():
    return calculate_bazi(birth_time=None, hour_known=False, **LAOPO)


def test_weak_dm_full_pipeline_no_crash(laopo_unknown):
    # Weak DM hits check_cong_ge (從格 detection) — must not KeyError on empty hour.
    assert laopo_unknown is not None
    assert not laopo_unknown["fourPillars"]["hour"]["stem"]
    assert laopo_unknown.get("hourKnown") is False
    assert laopo_unknown["dayMaster"].get("hourUnknown") is True


def test_full_pipeline_runs_without_exception(roger_unknown):
    # The critical regression: the analytical guard sweep must let the whole
    # LIFETIME pipeline complete on a blanked hour pillar (no KeyError/ValueError).
    assert roger_unknown is not None
    assert roger_unknown["fourPillars"] is not None
    assert roger_unknown.get("lifetimeEnhancedInsights") is not None


def test_hour_pillar_blanked(roger_unknown):
    hour = roger_unknown["fourPillars"]["hour"]
    assert hour["stem"] == ""
    assert hour["branch"] == ""
    assert hour["tenGod"] is None
    assert hour["shenSha"] == []
    assert roger_unknown.get("hourKnown") is False
    assert roger_unknown["ganZhi"]["hour"] == ""
    # Shared detection helper agrees.
    assert is_hour_unknown(roger_unknown) is True


def test_ymd_identical_to_known(roger_known, roger_unknown):
    # Noon placeholder must not change 年/月/日 for a non-boundary birth.
    for p in ("year", "month", "day"):
        k = roger_known["fourPillars"][p]
        u = roger_unknown["fourPillars"][p]
        assert (k["stem"], k["branch"], k.get("tenGod")) == (u["stem"], u["branch"], u.get("tenGod")), p
    assert roger_known.get("hourKnown") is True
    assert is_hour_unknown(roger_known) is False


def test_palaces_lost_and_survived(roger_known, roger_unknown):
    # 命宮/身宮 need 時支 → null when unknown.
    assert roger_unknown.get("mingGong") is None
    assert roger_unknown.get("shenGong") is None
    assert roger_known.get("mingGong") is not None  # known-hour still computes it
    # 胎元 (month) + 胎息 (day) survive and match the known chart.
    assert roger_unknown.get("taiYuan") == roger_known.get("taiYuan")
    assert roger_unknown.get("taiXi") == roger_known.get("taiXi")
    assert roger_unknown["taiYuan"] is not None
    assert roger_unknown["taiXi"] is not None


def test_yongshen_flags(roger_unknown):
    dm = roger_unknown["dayMaster"]
    assert dm.get("hourUnknown") is True
    assert dm.get("yongShenConfidence") == "reduced"
    assert dm.get("yongShenCaveat") in ("borderline", "reduced")
    # 用神 direction still emitted (月令-led, hour-independent).
    assert dm.get("usefulGod")


def test_yongshen_direction_matches_known(roger_known, roger_unknown):
    # Roger's 用神 is 火 in both (病藥 led by 月令, which the hour doesn't change).
    assert roger_unknown["dayMaster"]["usefulGod"] == roger_known["dayMaster"]["usefulGod"]


def test_five_elements_excludes_hour_mass(roger_known, roger_unknown):
    # The hour pillar's ~25% mass is excluded → the raw balance differs from known.
    assert roger_unknown["fiveElementsBalanceRaw"] != roger_known["fiveElementsBalanceRaw"]
    # but stays a valid distribution (~100%).
    assert abs(sum(roger_unknown["fiveElementsBalanceRaw"].values()) - 100.0) < 1.0


def test_children_narrative_suppressed(roger_unknown):
    anchors = (
        roger_unknown["lifetimeEnhancedInsights"]
        .get("narrativeAnchors", {})
        .get("children_analysis", [])
    )
    joined = "".join(anchors)
    assert "時辰未知" in joined
    # Must not fabricate a 時支 children narrative.
    assert "子女宮的核心能量" not in joined


# ── Phase 2a — all-pipelines + FORTUNE wrappers must not crash on a blank hour ──
# calculate_bazi_with_all_pipelines runs love+career+annual+lifetime regardless of
# reading_type (chat + FORTUNE entry point). It is the path that hits the CAREER
# calculate_weighted_ten_gods KeyError (the only Phase 2 engine crash). The
# FORTUNE month/year wrappers build their own blank-hour chart via
# _get_or_compute_chart_for_flow_year (hour_known threaded).

ROGER_PIPE = dict(
    birth_date="1987-09-06",
    birth_city="吉打",
    birth_timezone="Asia/Kuala_Lumpur",
    gender="male",
)
LAOPO_PIPE = dict(
    birth_date="1987-01-25",
    birth_city="台北市",
    birth_timezone="Asia/Taipei",
    gender="female",
)


@pytest.mark.parametrize("birth", [ROGER_PIPE, LAOPO_PIPE])
def test_all_pipelines_no_crash_unknown_hour(birth):
    # The CAREER 十神比重 crash regression + love/annual/lifetime no-crash.
    chart = calculate_bazi_with_all_pipelines(
        birth_time=None, hour_known=False, target_year=2026, **birth
    )
    assert chart is not None
    assert chart["fourPillars"]["hour"]["stem"] == ""
    assert chart.get("hourKnown") is False
    assert chart.get("loveEnhancedInsights") is not None
    assert chart.get("careerEnhancedInsights") is not None
    assert chart.get("annualEnhancedInsights") is not None
    assert chart.get("lifetimeEnhancedInsights") is not None


@pytest.mark.parametrize("birth", [ROGER_PIPE, LAOPO_PIPE])
def test_fortune_month_year_wrappers_no_crash_unknown_hour(birth):
    monthly = compute_single_month_by_yearmonth(
        birth_time=None, hour_known=False, year=2026, month=5, **birth
    )
    assert monthly is not None
    assert monthly.get("chartContext", {}).get("hourKnown") is False
    yearly = compute_year_by_year(
        birth_time=None, hour_known=False, year=2026, **birth
    )
    assert yearly is not None
    assert yearly.get("chartContext", {}).get("hourKnown") is False


def test_daily_fortune_no_crash_unknown_hour():
    # Daily receives the already-blanked pillars from the all-pipelines chart;
    # the 5-dim dispatchers + folk content must tolerate the blank hour.
    chart = calculate_bazi_with_all_pipelines(
        birth_time=None, hour_known=False, target_year=2026, **ROGER_PIPE
    )
    dm = chart["dayMaster"]
    daily = compute_daily_fortune(
        pillars=chart["fourPillars"],
        day_master_stem=chart["dayMasterStem"],
        effective_gods={
            "usefulGod": dm.get("usefulGod", ""),
            "favorableGod": dm.get("favorableGod", ""),
            "idleGod": dm.get("idleGod", ""),
            "tabooGod": dm.get("tabooGod", ""),
            "enemyGod": dm.get("enemyGod", ""),
        },
        useful_god_element=dm.get("usefulGod", "土"),
        gender="male",
        kong_wang=chart.get("kongWang", []),
        strength=dm.get("strength", "neutral"),
        target_date=date(2026, 5, 14),
    )
    assert daily is not None
    assert daily.get("dayGanZhi")
