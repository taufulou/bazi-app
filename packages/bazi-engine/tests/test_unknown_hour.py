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

from app.calculator import (
    calculate_bazi,
    calculate_bazi_compatibility,
    calculate_bazi_with_all_pipelines,
)
from app.chat_context import (
    build_chat_context,
    build_chat_context_compat,
    build_chat_context_fortune,
)
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


# A3 anchor (comprehensive QA 2026-06-15): a chart whose 3-pillar (hour-blanked)
# pre-analysis fires 從格 (congGe) → the engine withholds the 格局 verdict via
# geJuStatus='undetermined_without_hour'. Pins the otherwise-rare geJuStatus path
# (≈1.7% of charts) so it can never silently regress to dead code. 1993-03-08 台北
# male = 癸酉/乙卯/戊子, DM 戊土 very_weak 0, 從勢格.
CONG_A3 = dict(
    birth_date="1993-03-08",
    birth_city="台北市",
    birth_timezone="Asia/Taipei",
    gender="male",
    reading_type="LIFETIME",
)


@pytest.fixture(scope="module")
def cong_a3_unknown():
    return calculate_bazi(birth_time=None, hour_known=False, **CONG_A3)


def test_a3_congge_withholds_geju_verdict(cong_a3_unknown):
    dm = cong_a3_unknown["dayMaster"]
    assert dm.get("hourUnknown") is True
    assert dm.get("strength") == "very_weak"
    # 3-pillar 從格 detected → verdict withheld (the 格局待確認 path).
    assert dm.get("geJuStatus") == "undetermined_without_hour"
    assert cong_a3_unknown["preAnalysis"].get("congGe")  # truthy
    # Survivors still present even on this extreme chart.
    assert cong_a3_unknown.get("taiYuan") and cong_a3_unknown.get("taiXi")
    assert cong_a3_unknown.get("mingGong") is None


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


# ── Phase 2b — WRONG-OUTPUT phantom-hour cleanups (ANNUAL + LOVE) ──
# These charts must NEVER assert a 時柱-based finding as confirmed-absent (the
# 「never 命中無」 rule). The hour is unknown, so hour-keyed结论 are omitted or
# marked undetermined, not silently rendered as "exists and uneventful".


@pytest.fixture(scope="module")
def roger_all_pipelines_unknown():
    return calculate_bazi_with_all_pipelines(
        birth_time=None, hour_known=False, target_year=2026, **ROGER_PIPE
    )


def test_annual_no_phantom_hour_pillar(roger_all_pipelines_unknown):
    ann = roger_all_pipelines_unknown["annualEnhancedInsights"]
    # No phantom 子女宮 (hour) row in the pillar-impact analysis...
    assert "hour" not in [x["pillar"] for x in ann["pillarImpacts"]]
    # ...and no cascaded false 「子女宮平穩」 in the relationship palaces.
    assert "hour" not in ann["relationships"]["palaceRelationships"]


def test_annual_no_phantom_hour_taisui(roger_all_pipelines_unknown):
    # 太歲 loops all 4 pillar branches; the blanked hour must NOT surface as a
    # 時柱犯太歲 finding (line-audit Item 5 — engine skip-empty guard).
    ann = roger_all_pipelines_unknown["annualEnhancedInsights"]
    ts = ann.get("taiSui", {})
    assert "hour" not in [r["pillar"] for r in ts.get("pillarResults", [])]


def test_love_late_marriage_indicator_undetermined(roger_all_pipelines_unknown):
    ssa = roger_all_pipelines_unknown["loveEnhancedInsights"]["spouseStarAnalysis"]
    # None (undetermined) — NOT a confirmed False (a 時支-hidden spouse star is a
    # real late-marriage signal we just can't observe).
    assert ssa.get("lateMarriageIndicator") is None
    assert ssa.get("hourWealthNote") == ""


def test_love_visible_spouse_not_falsely_absent(roger_all_pipelines_unknown):
    mti = roger_all_pipelines_unknown["loveEnhancedInsights"]["marriageTimingIndicators"]
    joined = "".join(mti.get("lateSignals", []))
    # Must NOT assert the hard 「不透出，不宜早婚」 verdict when the 時干 is unknown.
    assert "不透出，不宜早婚" not in joined
    # When the spouse star is absent from the 3 known stems, the softened
    # explicit-undetermined note appears instead.
    if "未見" in joined:
        assert "時柱未知" in joined


def test_love_no_fabricated_hour_peach_blossom(roger_all_pipelines_unknown):
    pb = roger_all_pipelines_unknown["loveEnhancedInsights"]["peachBlossoms"]
    for entry in pb.get("positive", []) + pb.get("negative", []):
        assert entry.get("pillar") != "hour"  # no 時柱 桃花 fabricated/claimed-absent


# ── Phase 2d — chat-context honours the unknown hour (no crash + hourKnown signal) ──
# The slim chat context must surface a top-level hourKnown=False so the NestJS
# chat-prompt builder can gate its 時辰未知 suppression directive, and the build
# must not crash for any chat scope on a blanked hour.


def test_chat_context_surfaces_hour_unknown(roger_all_pipelines_unknown):
    ctx = build_chat_context(
        chart_data=roger_all_pipelines_unknown, current_year=2026, current_month=6
    )
    assert ctx.get("hourKnown") is False
    assert ctx["chart"]["fourPillars"]["hour"]["stem"] == ""


@pytest.mark.parametrize("scope", ["DAY", "MONTH", "YEAR"])
def test_chat_context_fortune_hour_unknown_no_crash(scope):
    birth_data = dict(
        birth_date="1987-09-06",
        birth_time=None,
        birth_city="吉打",
        birth_timezone="Asia/Kuala_Lumpur",
        gender="male",
    )
    ctx = build_chat_context_fortune(
        birth_data=birth_data,
        anchor_date="2026-06-13",
        current_year=2026,
        current_month=6,
        fortune_scope=scope,
        hour_known=False,
    )
    assert ctx is not None
    assert ctx.get("hourKnown") is False


# ── Phase 3b — FULL compat pipeline (calculate_bazi_compatibility) no-crash ──
# The dimension funcs are unit-tested with synthetic charts, but the full
# orchestrator ALSO runs compatibility_romance_preanalysis, which derefs 命宮
# (None for a 3-pillar chart) — a crash class the synthetic tests missed. This
# locks the full path for all 3 hour-unknown cases (A-only / B-only / both).

@pytest.mark.parametrize("hk_a,hk_b,expected", [
    (False, True, ['A']),
    (True, False, ['B']),
    (False, False, ['A', 'B']),
    (True, True, []),
])
def test_full_compat_pipeline_no_crash(hk_a, hk_b, expected):
    a = dict(birth_date="1987-09-06", birth_time=("16:11" if hk_a else None),
             hour_known=hk_a, birth_city="吉打", birth_timezone="Asia/Kuala_Lumpur", gender="male")
    b = dict(birth_date="1987-01-25", birth_time=("12:00" if hk_b else None),
             hour_known=hk_b, birth_city="台北市", birth_timezone="Asia/Taipei", gender="female")
    r = calculate_bazi_compatibility(birth_data_a=a, birth_data_b=b, comparison_type="romance", current_year=2026)
    enh = r["compatibilityEnhanced"]
    assert enh["hourUnknownParties"] == expected
    assert enh["partial"] is (len(expected) > 0)
    assert 5 <= enh["adjustedScore"] <= 99
    # romancePreAnalysis must be present (the 命宮 crash used to abort it)
    assert r.get("romancePreAnalysis") is not None


# ── Phase 3b — compat chat-context threads hour_known per party ──
# build_chat_context_compat must (a) not crash when a party lacks the hour,
# (b) surface the top-level partial/hourUnknownParties signal, and (c) carry
# per-party hourKnown inside chartA/chartB so the compat chat-prompt builder
# (3c) can gate the per-party 男方/女方 suppression directive.


def test_chat_context_compat_threads_hour_known():
    a_unknown = dict(
        birth_date="1987-09-06", birth_time=None, birth_city="吉打",
        birth_timezone="Asia/Kuala_Lumpur", gender="male", hour_known=False,
    )
    b_known = dict(
        birth_date="1987-01-25", birth_time="12:00", birth_city="台北市",
        birth_timezone="Asia/Taipei", gender="female", hour_known=True,
    )
    ctx = build_chat_context_compat(
        birth_data_a=a_unknown, birth_data_b=b_known,
        comparison_type="romance", current_year=2026, current_month=6,
    )
    assert ctx is not None
    assert ctx["partial"] is True
    assert ctx["hourUnknownParties"] == ["A"]
    assert ctx["chartA"]["hourKnown"] is False
    assert ctx["chartB"]["hourKnown"] is True
    # Party A's hour pillar is blanked in the slim chart.
    assert ctx["chartA"]["chart"]["fourPillars"]["hour"]["stem"] == ""


# ── N1 — API-boundary validation: birth_time required when hour_known is True ──
# A known 時辰 with no time would silently fall through to the engine's NOON
# placeholder → a WRONG hour pillar. The shared `_HourKnownValidatedInput` mixin
# rejects it at the FastAPI boundary (422) instead of producing a confident-wrong
# chart. hour_known=False with no time is the intended 三柱 path and must pass.

from pydantic import ValidationError  # noqa: E402
from app.main import (  # noqa: E402
    _HourKnownValidatedInput,
    BirthDataInput,
    ChatContextInput,
    DailyFortuneInput,
    FortuneChatContextInput,
    MonthlyFortuneInput,
    YearlyFortuneInput,
)

_N1_BASE = dict(
    birth_date="1987-09-06",
    birth_city="吉打",
    birth_timezone="Asia/Kuala_Lumpur",
    gender="male",
)


def test_n1_rejects_known_hour_without_time():
    with pytest.raises(ValidationError):
        BirthDataInput(hour_known=True, birth_time=None, **_N1_BASE)


def test_n1_rejects_default_hour_without_time():
    # hour_known defaults to True → omitting BOTH must reject (the common
    # malformed-payload case: caller forgot to send hour_known=False).
    with pytest.raises(ValidationError):
        BirthDataInput(**_N1_BASE)


def test_n1_accepts_known_hour_with_time():
    m = BirthDataInput(hour_known=True, birth_time="16:11", **_N1_BASE)
    assert m.birth_time == "16:11" and m.hour_known is True


def test_n1_accepts_unknown_hour_without_time():
    m = BirthDataInput(hour_known=False, birth_time=None, **_N1_BASE)
    assert m.hour_known is False and m.birth_time is None


def test_n1_fortune_dto_inherits_validation():
    # A fortune DTO (not just BirthDataInput) must also reject — proves the
    # mixin propagates, not a one-off on the base input.
    with pytest.raises(ValidationError):
        DailyFortuneInput(hour_known=True, birth_time=None, target_date="2026-05-14", **_N1_BASE)
    ok = DailyFortuneInput(hour_known=False, birth_time=None, target_date="2026-05-14", **_N1_BASE)
    assert ok.hour_known is False


def test_n1_all_birthdata_dtos_inherit_mixin():
    # Structural lock: every birth-data-bearing FastAPI input inherits the
    # validator (catches a future refactor that reverts one back to BaseModel).
    for dto in (
        BirthDataInput,
        ChatContextInput,
        DailyFortuneInput,
        FortuneChatContextInput,
        MonthlyFortuneInput,
        YearlyFortuneInput,
    ):
        assert issubclass(dto, _HourKnownValidatedInput), dto.__name__


# ── N4 — L1.b per-day cache key includes hour_known (no cross-chart collision) ──
# An hour-known vs hour-unknown chart for the SAME person produces DIFFERENT
# effective_gods/strength (the hour pillar changes the 五行 tally), so their
# per-day fortunes must NOT share a cache entry. Passing the SAME birth_time
# under both flags isolates hour_known as the sole key differentiator (chart_hash
# is identical), proving the flag is genuinely part of the key.


def test_n4_l1b_cache_key_distinguishes_hour_known():
    from app.monthly_enhanced import (
        compute_intra_month_breakdown,
        _l1b_daily_cache,
        _reset_l1b_cache_for_tests,
    )

    _reset_l1b_cache_for_tests()
    common = dict(
        birth_date="1987-09-06",
        birth_time="16:11",  # SAME time under both flags → identical chart_hash
        birth_city="吉打",
        birth_timezone="Asia/Kuala_Lumpur",
        gender="male",
        year=2026,
        month=5,
    )
    compute_intra_month_breakdown(hour_known=True, **common)
    compute_intra_month_breakdown(hour_known=False, **common)

    keys = list(_l1b_daily_cache.keys())
    assert all(len(k) == 3 for k in keys), "cache key must be a 3-tuple"
    dates_known = {k[1] for k in keys if k[2] is True}
    dates_unknown = {k[1] for k in keys if k[2] is False}
    assert dates_known, "hour-known run produced no cache entries"
    assert dates_unknown, "hour-unknown run produced no cache entries"
    # The same (chart_hash, date) coexists under BOTH flags → no collision.
    assert dates_known & dates_unknown, "an iso date must appear under both hour_known flags"
    _reset_l1b_cache_for_tests()
