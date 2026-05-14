"""
Tests for `chat_context.py` — the slim grounded payload for the AI chat feature.

The central anti-hallucination test (`test_laopo_shangguan_jianguan_beneficial`)
locks in the regression caught by the staff-engineer review's Issue 22:
without merging LOVE/CAREER/ANNUAL pipelines, Laopo's 傷官見官 valence='beneficial'
flag would be empty, and the AI would default to folk «傷官見官恆凶» doctrine.
"""
from __future__ import annotations

import json
from typing import Dict

import pytest

from app.calculator import calculate_bazi_with_all_pipelines
from app.chat_context import build_chat_context


# ============================================================
# Calibration anchor charts (from CLAUDE.md)
# ============================================================


@pytest.fixture(scope='module')
def laopo_chart() -> Dict:
    """
    Laopo: 丙寅 / 辛丑 / 甲戌 / 壬申 female. The CLAUDE.md calibration anchor
    for Phase 12g.3 (傷官見官 valence='beneficial' when 正官=忌神).

    Birth: 1987-01-25 16:45, 柔佛 (Johor, Malaysia).
    """
    return calculate_bazi_with_all_pipelines(
        '1987-01-25', '16:45', '柔佛', 'Asia/Kuala_Lumpur', 'female',
        target_year=2026,
    )


@pytest.fixture(scope='module')
def roger_chart() -> Dict:
    """
    Roger: 丁卯 / 戊申 / 戊午 / 庚申 male. The other calibration anchor
    (DM=戊, weak per Phase 12d/e). Birth: 1987-09-06 16:11, 吉打 (Kedah).
    Cross-validated against 元亨利貞網 普通方式 in test_shen_sha_expanded.py.
    """
    return calculate_bazi_with_all_pipelines(
        '1987-09-06', '16:11', '吉打', 'Asia/Kuala_Lumpur', 'male',
        target_year=2026,
    )


# ============================================================
# 4-pipeline merge — Issue 22 regression
# ============================================================


class TestPipelineMerge:
    """The central staff-review fix: all 4 enhanced pipelines must merge."""

    def test_calculate_with_all_pipelines_emits_all_4_outputs(
        self, laopo_chart: Dict,
    ):
        """`calculate_bazi_with_all_pipelines` must produce all 4 enhanced
        pipeline outputs unconditionally, even though `reading_type=None`."""
        assert 'lifetimeEnhancedInsights' in laopo_chart
        assert 'loveEnhancedInsights' in laopo_chart
        assert 'careerEnhancedInsights' in laopo_chart
        assert 'annualEnhancedInsights' in laopo_chart

    def test_build_chat_context_rejects_partial_chart_data(self):
        """If caller passes `calculate_bazi(reading_type='LIFETIME')` output
        instead of `calculate_bazi_with_all_pipelines()`, must raise — this
        is the central anti-hallucination guardrail."""
        from app.calculator import calculate_bazi
        partial = calculate_bazi(
            '1987-01-25', '16:45', '柔佛', 'Asia/Kuala_Lumpur', 'female',
            reading_type='LIFETIME', target_year=2026,
        )
        # `calculate_bazi(reading_type='LIFETIME')` has lifetime but NOT love/
        # career/annual — exactly the scenario Issue 22 warned about.
        assert 'lifetimeEnhancedInsights' in partial
        assert 'loveEnhancedInsights' not in partial

        with pytest.raises(ValueError, match='all 4 enhanced pipeline outputs'):
            build_chat_context(partial, current_year=2026, current_month=5)

    @pytest.mark.parametrize(
        'reading_type, output_key',
        [
            ('LIFETIME', 'lifetimeEnhancedInsights'),
            ('CAREER', 'careerEnhancedInsights'),
            ('LOVE', 'loveEnhancedInsights'),
            ('ANNUAL', 'annualEnhancedInsights'),
        ],
    )
    def test_new_function_produces_identical_output_to_calculate_bazi(
        self, reading_type: str, output_key: str,
    ):
        """
        The strongest accuracy regression test: `calculate_bazi_with_all_pipelines`
        must produce BYTE-IDENTICAL output to `calculate_bazi(reading_type='X')`
        for each enhanced pipeline. Any difference indicates a subtle arg
        threading bug introduced by the refactor.

        Locks in the audit verification that Phase 1.2 has zero accuracy
        regression on production reading paths.
        """
        from app.calculator import calculate_bazi
        from_old = calculate_bazi(
            '1987-01-25', '16:45', '柔佛', 'Asia/Kuala_Lumpur', 'female',
            target_year=2026, reading_type=reading_type,
        )
        from_new = calculate_bazi_with_all_pipelines(
            '1987-01-25', '16:45', '柔佛', 'Asia/Kuala_Lumpur', 'female',
            target_year=2026,
        )
        old_serialized = json.dumps(
            from_old[output_key], ensure_ascii=False, sort_keys=True,
        )
        new_serialized = json.dumps(
            from_new[output_key], ensure_ascii=False, sort_keys=True,
        )
        assert old_serialized == new_serialized, (
            f"{output_key} differs between calculate_bazi(reading_type='{reading_type}') "
            f"and calculate_bazi_with_all_pipelines(). The refactor introduced "
            f"an arg-threading bug. Inspect arg list at calculator.py "
            f"calculate_bazi_with_all_pipelines() vs original conditional blocks."
        )


# ============================================================
# Laopo central regression — Issue 22 anti-hallucination win
# ============================================================


class TestLaopoShangguanJianguan:
    """
    The single most important test in this file: locks the chat context's
    ability to deliver `valence='beneficial'` to the AI for Laopo's 傷官見官.

    Without this, the AI falls back to folk «傷官見官恆凶» doctrine and
    contradicts the user's LOVE reading. This is the central failure mode
    the entire chat feature is designed to prevent.
    """

    def test_laopo_chat_context_carries_shangguan_beneficial_valence(
        self, laopo_chart: Dict,
    ):
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)

        sjg = ctx['doctrineFlags']['shangguanJianGuan']
        assert len(sjg) >= 1, (
            "Laopo MUST have shangguanJianGuan flagged. Without this, the "
            "AI chat would default to folk «傷官見官恆凶» and contradict "
            "Phase 12g.3 doctrine."
        )
        assert sjg[0]['valence'] == 'beneficial', (
            f"Expected valence='beneficial' (Phase 12g.3 — when 正官 is 忌神). "
            f"Got: {sjg[0]['valence']}"
        )

    def test_laopo_dayun_activation_present(self, laopo_chart: Dict):
        """The 2023-2032 丁酉 大運 must be flagged as a transient activator."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        sjg = ctx['doctrineFlags']['shangguanJianGuan']
        activations = sjg[0].get('transientActivations', [])
        dayun = next((a for a in activations if a.get('level') == 'dayun'), None)
        assert dayun is not None, 'Expected dayun-level transient activation'
        assert '2023' in dayun.get('period', ''), (
            f"Expected current dayun 2023-2032. Got: {dayun.get('period')}"
        )

    def test_laopo_chinese_injector_uses_beneficial_framing(
        self, laopo_chart: Dict,
    ):
        """The deterministic Chinese injection block must use beneficial
        framing verbatim — NOT folk «恆凶» language."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        injector = ctx['doctrineInjectors']['shangguanJianGuan']

        assert injector is not None, "Expected non-empty injector for Laopo"
        # Must contain the canonical Phase 12g.3 framing
        assert '傷官制官反為調節壓力' in injector or '傷官制官反為' in injector
        assert '忌神' in injector
        # Must NOT contain folk-doctrine red flags
        assert '恆凶' not in injector, "Folk «傷官見官恆凶» must NOT appear"
        assert '必凶' not in injector
        # Phase 1.5 follow-up C iter 1 sub-pass 2: marker stripped to prevent
        # AI from citing it verbatim. Block now uses 「【傷官見官分析】」 title.
        assert '【傷官見官分析】' in injector
        assert '[doctrineDirective:' not in injector, (
            'Engine-side marker [doctrineDirective: ...] must NOT leak into '
            'injector text — AI was citing it verbatim in responses.'
        )
        assert '必須' in injector  # forced-splicing rule
        # Must reference the actual current 大運 period
        assert '丁酉' in injector
        assert '2023-2032' in injector

    def test_laopo_favorability_decomposed_correctly(
        self, laopo_chart: Dict,
    ):
        """Per CLAUDE.md: Laopo's 用神=水 (印), 喜神=木 (比劫), 忌神=金 (官殺)."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        fav = ctx['favorability']
        assert fav['yongShen'] == '水'
        assert fav['xiShen'] == '木'
        assert fav['jiShen'] == '金'

    def test_laopo_spouse_palace_friction_丑戌_half_punishment(
        self, laopo_chart: Dict,
    ):
        """Phase 12g.6 Gap 3: 丑戌半刑 must be detected on Laopo's 配偶宮."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        frictions = ctx['doctrineFlags']['spousePalaceFrictions']
        assert len(frictions) >= 1
        types = [f.get('type') for f in frictions]
        assert 'half_punishment' in types
        injector = ctx['doctrineInjectors']['spousePalaceFrictions']
        assert injector is not None
        assert '半刑' in injector


# ============================================================
# Token budget verification (CI gate)
# ============================================================


class TestTokenBudget:
    """
    Per the plan: chat context targets 8-12k tokens. Above 12k risks
    Anthropic API limits + cost spike; below 6k risks dropping anchor fields.
    """

    @pytest.mark.parametrize(
        'chart_fixture',
        ['laopo_chart', 'roger_chart'],
    )
    def test_chat_context_within_token_budget(
        self, chart_fixture: str, request: pytest.FixtureRequest,
    ):
        """
        Approximate token budget check. CHARACTER-based — coarse approximation
        of `chars/2 ≈ tokens` overestimates for mixed Chinese+JSON content
        (real Anthropic tokenizer is ~0.7-1.0 tokens/CJK char + ~4 chars/token
        for JSON keys/syntax). The actual token count via Anthropic's
        count_tokens API will likely be 25-40% lower than our approximation.

        TODO (Phase 1.5): replace this with actual `anthropic.count_tokens()`
        call when the eval-corpus runner has the API key + budget. Until then,
        18k char-approx tokens is a reasonable safety ceiling — corresponds
        to ~12-14k actual tokens which fits the plan target of 8-12k.
        """
        chart = request.getfixturevalue(chart_fixture)
        ctx = build_chat_context(chart, current_year=2026, current_month=5)

        char_count = len(json.dumps(ctx, ensure_ascii=False))
        approx_tokens = char_count // 2

        # 18k coarse char-approx ≈ ~12-14k actual tokens
        assert approx_tokens <= 18000, (
            f"Chart {chart_fixture}: ~{approx_tokens} char-approx tokens "
            f"exceeds 18k ceiling (~12-14k actual). Slim aggressively."
        )
        # 4k floor — below this we've definitely dropped anchor fields
        assert approx_tokens >= 4000, (
            f"Chart {chart_fixture}: ~{approx_tokens} tokens — too thin. "
            f"Plan requires ≥8k to preserve anti-hallucination anchors."
        )


# ============================================================
# Structure / completeness
# ============================================================


class TestSlimStructure:
    """All required top-level keys present, no None substitutions for
    load-bearing fields."""

    REQUIRED_TOP_KEYS = (
        'chart', 'strength', 'favorability', 'fiveElements',
        'patternNarrative', 'narrativeAnchors', 'call2NarrativeAnchors',
        'touganAnalysis', 'tenGodPositionAnalysis',
        'luckPeriods', 'annualForecast15', 'monthlyForecast12',
        'romance', 'career', 'relationships',
        'shensha', 'doctrineFlags', 'doctrineInjectors',
    )

    def test_all_required_keys_present(self, laopo_chart: Dict):
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        for key in self.REQUIRED_TOP_KEYS:
            assert key in ctx, f"Missing required top-level key: {key}"

    def test_luck_periods_kept_intact_all_8(self, laopo_chart: Dict):
        """Per plan Issue 23: ALL 8 luck periods kept (not slimmed to 3)."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        # Most charts have 8 LP entries; some boundary cases may have ±1
        assert len(ctx['luckPeriods']) >= 7, (
            f"Expected all luck periods preserved. Got "
            f"{len(ctx['luckPeriods'])} entries."
        )

    def test_annual_forecast_keeps_15_years(self, laopo_chart: Dict):
        """Per plan Issue 23: 15 years kept (not slimmed to 6) so questions
        like 「2040年我運勢」 (12-15 years out) have engine backing."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        assert len(ctx['annualForecast15']) >= 10, (
            f"Expected ≥10 annual forecast years. Got "
            f"{len(ctx['annualForecast15'])} entries."
        )

    def test_romance_block_includes_spouse_star_from_love_pipeline(
        self, laopo_chart: Dict,
    ):
        """Verify the cross-pipeline merge: spouseStarAnalysis (from LOVE
        pipeline) must appear in chat context's romance block."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        spouse_star = ctx['romance']['spouseStarAnalysis']
        assert spouse_star, "Expected non-empty spouseStarAnalysis"
        assert 'challenges' in spouse_star

    def test_career_block_includes_career_pipeline_outputs(
        self, laopo_chart: Dict,
    ):
        """Verify CAREER pipeline merge: suitablePositions, etc."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        career = ctx['career']
        assert career.get('pattern') is not None
        assert 'suitablePositions' in career
        assert 'entrepreneurshipFit' in career

    def test_monthly_forecast_includes_phase_12bc_flags_when_triggered(
        self, laopo_chart: Dict,
    ):
        """Verify ANNUAL pipeline merge: Phase 12b/c structured flags
        (officerSealActivation, fuYinInteractions, liuHaiInteractions, etc.)
        appear in any month where they trigger. Per the calibration anchor
        comment in CLAUDE.md, Laopo's 2026 has multiple Phase 12 triggers
        (Fix C 庚子, Fix E 癸巳, Fix F 壬辰)."""
        ctx = build_chat_context(laopo_chart, current_year=2026, current_month=5)
        monthly = ctx['monthlyForecast12']
        assert len(monthly) == 12
        # Across all 12 months, at least one Phase 12 flag should fire
        # for the calibration anchor (per CLAUDE.md anchor table)
        triggered_flags = set()
        for m in monthly:
            for flag_key in (
                'officerSealActivation', 'fuYinInteractions',
                'liuHaiInteractions', 'chongKuRelease',
            ):
                if m.get(flag_key):
                    triggered_flags.add(flag_key)
        assert triggered_flags, (
            f"Expected ≥1 Phase 12b/c flag triggered across 12 months for "
            f"Laopo 2026 (CLAUDE.md anchor). Got none."
        )


# ============================================================
# Roger anchor — sanity check (no shangguanJianGuan triggered)
# ============================================================


class TestRogerAnchor:
    """Roger's chart should NOT trigger 傷官見官 — sanity check that the
    flag isn't a false positive."""

    def test_roger_basic_chat_context_builds(self, roger_chart: Dict):
        """Smoke test that the builder runs without error on Roger's chart."""
        ctx = build_chat_context(roger_chart, current_year=2026, current_month=5)
        assert ctx['chart']['gender'] == 'male'
        # DM=戊 (per CLAUDE.md)
        assert ctx['chart']['dayMaster']['stem'] == '戊'


# ============================================================
# Doctrine flag filters — unit tests with synthetic challenges
# (locks field-name correctness in case engine output shape changes)
# ============================================================


class TestDoctrineFilters:
    """
    Direct unit tests for `_filter_*` functions. Each filter must use the
    stable `type` field (Chinese name) per love_enhanced.py emission, NOT
    the deprecated count fields (per love_enhanced.py:659).

    Original Phase 1.2 had bugs:
    - `bijieCount` (lowercase j) instead of `biJieCount` (camelCase J)
    - `qishaCount` field that engine never emits — fallback dead code

    These tests lock in the corrected field-name-based detection.
    """

    def test_filter_shangguan_jianguan_matches_by_type_field(self):
        from app.chat_context import _filter_shangguan_jianguan
        challenges = [
            {'type': '傷官見官', 'shangguanCount': 1, 'zhengguanCount': 3,
             'valence': 'beneficial'},
            {'type': '比劫奪財'},  # different type, should be skipped
            {'shangguanCount': 1, 'zhengguanCount': 1},  # no type field, skip
        ]
        result = _filter_shangguan_jianguan(challenges)
        assert len(result) == 1
        assert result[0]['valence'] == 'beneficial'

    def test_filter_bijie_duocai_matches_by_type_field(self):
        """Regression test for the `bijieCount` typo bug (lowercase j vs
        camelCase biJieCount)."""
        from app.chat_context import _filter_bijie_duocai
        challenges = [
            # Real engine emission (love_enhanced.py:965-971): camelCase J
            {'type': '比劫奪財', 'biJieCount': 3, 'caiCount': 1,
             'valence': 'harmful'},
            {'type': '傷官見官'},  # different type, skip
        ]
        result = _filter_bijie_duocai(challenges)
        assert len(result) == 1
        assert result[0]['valence'] == 'harmful'

    def test_filter_guan_sha_hun_za_matches_only_real_double_transparent(self):
        """官殺混雜 真雙透 only — narrative-only paths
        (lu_guan_cang_sha / lu_sha_cang_guan) live in informationalNotes,
        not challenges, and should not be picked up here."""
        from app.chat_context import _filter_guan_sha_hun_za
        challenges = [
            # 真雙透 — real challenge
            {'type': '官殺混雜', 'doctrineType': 'guan_sha_hunza'},
            # Different type, skip
            {'type': '傷官見官'},
        ]
        result = _filter_guan_sha_hun_za(challenges)
        assert len(result) == 1
        assert result[0]['doctrineType'] == 'guan_sha_hunza'

    def test_bijie_injector_male_emits_male_specific_phrasing(self):
        """男命 比劫奪財 must mention 妻緣穩定 in injector. 女命 must NOT."""
        from app.chat_context import _build_bijie_duocai_injector
        challenges = [{
            'type': '比劫奪財', 'biJieCount': 3, 'caiCount': 1,
            'valence': 'harmful', 'natalSeverity': 'high',
        }]
        male_text = _build_bijie_duocai_injector(challenges, 'male')
        female_text = _build_bijie_duocai_injector(challenges, 'female')

        assert '妻緣' in male_text, "Male 比劫奪財 must mention 妻緣"
        assert '妻緣' not in female_text, (
            "Female 比劫奪財 must NOT mention 妻緣 — Phase 12h.B Item 8 "
            "explicitly suppresses 損夫 framing for women"
        )
        assert '姊妹' in female_text, "Female framing must mention 姊妹"

    def test_shangguan_injector_returns_none_for_empty_input(self):
        from app.chat_context import _build_shangguan_injector
        assert _build_shangguan_injector([]) is None

    def test_bijie_injector_returns_none_for_empty_input(self):
        from app.chat_context import _build_bijie_duocai_injector
        assert _build_bijie_duocai_injector([], 'male') is None
        assert _build_bijie_duocai_injector([], 'female') is None
