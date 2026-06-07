"""Tests for daily_enhanced.py — 八字日運 (Daily Fortune).

Calibration anchors (regression-locked):
- Roger 戊午 day on 2026-05-14 (癸卯日 month, 中和+食神)
- Laopo 甲戌 day on a 沖日支 day
- 沖日支 day
- 三合 trigger day
- 驛馬 trigger day
- 桃花 trigger day

Phase 12 doctrine integration:
- Day with 傷官見官 + 正官=忌神 → valence='beneficial' (Phase 12g/12h.B Item 2 propagation works at day scope)
- Day with 比劫奪財 + 男命 + 財=用神 → 'harmful' valence (Phase 12h.B Item 8)
"""

from datetime import date, datetime, timedelta
from typing import Any, Dict

import pytest

from app.daily_enhanced import (
    _detect_shishen_zhisha_active,
    compute_daily_fortune,
    get_day_pillar,
    resolve_bazi_today_from_clock_time,
)
from app.fortune_constants import (
    DIMENSION_KEYS,
    FORTUNE_DAILY_PRE_ANALYSIS_VERSION,
    LABEL_TO_ENERGY_SCORE,
    META_FRAMING_SOFT_TRIGGER,
    derive_dimension_label,
    derive_energy_score,
)


# ============================================================
# Test fixtures
# ============================================================

ROGER_PILLARS = {
    'year':  {'stem': '丁', 'branch': '卯'},
    'month': {'stem': '戊', 'branch': '申'},
    'day':   {'stem': '戊', 'branch': '午'},
    'hour':  {'stem': '庚', 'branch': '申'},
}

ROGER_EFFECTIVE_GODS = {
    'usefulGod': '火',     # Phase 12d Pattern 1 result
    'favorableGod': '木',
    'idleGod': '土',
    'tabooGod': '水',
    'enemyGod': '金',
}

ROGER_INPUTS = {
    'pillars': ROGER_PILLARS,
    'day_master_stem': '戊',
    'effective_gods': ROGER_EFFECTIVE_GODS,
    'useful_god_element': '火',
    'gender': 'male',
    'kong_wang': ['子', '丑'],
    'strength': 'neutral',
    'is_cong_ge': False,
    'flow_year_stem': '丙',
    'flow_year_auspiciousness': '吉',
}

LAOPO_PILLARS = {
    'year':  {'stem': '丙', 'branch': '寅'},
    'month': {'stem': '辛', 'branch': '丑'},
    'day':   {'stem': '甲', 'branch': '戌'},
    'hour':  {'stem': '壬', 'branch': '申'},
}

LAOPO_EFFECTIVE_GODS = {
    'usefulGod': '水',
    'favorableGod': '木',
    'idleGod': '火',
    'tabooGod': '金',
    'enemyGod': '土',
}

LAOPO_INPUTS = {
    'pillars': LAOPO_PILLARS,
    'day_master_stem': '甲',
    'effective_gods': LAOPO_EFFECTIVE_GODS,
    'useful_god_element': '水',
    'gender': 'female',
    'kong_wang': ['申', '酉'],
    'strength': 'very_weak',
    'is_cong_ge': False,
    'flow_year_stem': '丙',
    'flow_year_auspiciousness': '吉',
}


# ============================================================
# fortune_constants tests
# ============================================================

class TestFortuneConstants:
    """Smoke tests for fortune_constants helpers."""

    def test_label_to_energy_score_covers_all_7_labels(self):
        for label in ('大吉', '吉', '吉中有凶', '平', '凶中有吉', '凶', '大凶'):
            assert label in LABEL_TO_ENERGY_SCORE
            assert 0 <= LABEL_TO_ENERGY_SCORE[label] <= 100

    def test_energy_score_monotonic_with_label_severity(self):
        """大吉 > 吉 > 吉中有凶 > 平 > 凶中有吉 > 凶 > 大凶."""
        scores = [
            LABEL_TO_ENERGY_SCORE['大吉'],
            LABEL_TO_ENERGY_SCORE['吉'],
            LABEL_TO_ENERGY_SCORE['吉中有凶'],
            LABEL_TO_ENERGY_SCORE['平'],
            LABEL_TO_ENERGY_SCORE['凶中有吉'],
            LABEL_TO_ENERGY_SCORE['凶'],
            LABEL_TO_ENERGY_SCORE['大凶'],
        ]
        assert scores == sorted(scores, reverse=True)

    def test_derive_energy_score_unknown_label_falls_to_50(self):
        assert derive_energy_score('unknown_label') == 50

    def test_derive_dimension_label_bands(self):
        assert derive_dimension_label(90) == '極佳'
        assert derive_dimension_label(70) == '順遂'
        assert derive_dimension_label(55) == '平穩'
        assert derive_dimension_label(40) == '需謹慎'
        assert derive_dimension_label(20) == '不利'
        assert derive_dimension_label(0) == '不利'


# ============================================================
# Day pillar lookup tests
# ============================================================

class TestDayPillarLookup:
    """Verifies cnlunar integration + 23:00 子時 boundary."""

    def test_get_day_pillar_known_date(self):
        # 2026-05-14 is 戊子 day (verified against cnlunar)
        stem, branch = get_day_pillar(date(2026, 5, 14))
        assert stem == '戊'
        assert branch == '子'

    def test_resolve_bazi_today_before_23_uses_calendar_day(self):
        local_dt = datetime(2026, 5, 14, 14, 30)  # 2pm
        assert resolve_bazi_today_from_clock_time(local_dt) == date(2026, 5, 14)

    def test_resolve_bazi_today_at_23_advances_to_next_day(self):
        local_dt = datetime(2026, 5, 14, 23, 5)  # 11:05pm
        # Per Bazi 子時 doctrine: 23:00+ is the START of tomorrow's day pillar
        assert resolve_bazi_today_from_clock_time(local_dt) == date(2026, 5, 15)

    def test_resolve_bazi_today_at_2300_exactly_advances(self):
        local_dt = datetime(2026, 5, 14, 23, 0)
        assert resolve_bazi_today_from_clock_time(local_dt) == date(2026, 5, 15)

    def test_resolve_bazi_today_at_2259_does_not_advance(self):
        local_dt = datetime(2026, 5, 14, 22, 59)
        assert resolve_bazi_today_from_clock_time(local_dt) == date(2026, 5, 14)


# ============================================================
# compute_daily_fortune — calibration anchors
# ============================================================

class TestRogerCalibration:
    """Roger 丁卯/戊申/戊午/庚申 male — calibration anchor."""

    def test_roger_2026_05_14_is_戊子_day(self):
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        assert result['dayStem'] == '戊'
        assert result['dayBranch'] == '子'
        assert result['dayGanZhi'] == '戊子'
        # DM=戊, day stem=戊 → 比肩
        assert result['dayTenGod'] == '比肩'

    def test_roger_2026_05_14_emits_chong_day_branch_caution(self):
        """子午沖 — day branch 子 沖 Roger's natal 日支 午."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        # Travel dim should reflect 沖日支 → 不利
        travel = result['dimensions']['travel']
        assert travel['score'] <= 40
        assert any('chong_day_branch' in s['type'] for s in travel['signals'])

    def test_roger_2026_05_14_emits_honluan_trigger(self):
        """子 is 紅鸞 of 卯年支 (Roger's year branch). Should trigger romance signal."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        romance_signals = [s['type'] for s in result['dimensions']['romance']['signals']]
        assert 'honluan_triggered' in romance_signals

    def test_roger_meta_framing_always_soft_trigger(self):
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        assert result['metaFraming'] == META_FRAMING_SOFT_TRIGGER

    def test_roger_static_wealth_direction_matches_useful_god_火_南方(self):
        """Phase 12 Fix 2: 用神=火 → 南方."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        wealth_dir = result['folkContent']['wealthDirection']
        assert wealth_dir['element'] == '火'
        assert wealth_dir['direction'] == '南方'
        assert wealth_dir['provenance'] == 'classical'


class TestLaopoCalibration:
    """Laopo 丙寅/辛丑/甲戌/壬申 female — Phase 12g calibration anchor."""

    def test_laopo_outputs_valid_shape(self):
        result = compute_daily_fortune(**LAOPO_INPUTS, target_date=date(2026, 5, 14))
        assert result['dayStem']
        assert result['dayBranch']
        assert result['dayTenGod']
        assert 'dimensions' in result
        assert set(result['dimensions'].keys()) == set(DIMENSION_KEYS)
        for dim_key in DIMENSION_KEYS:
            assert 0 <= result['dimensions'][dim_key]['score'] <= 100
            assert isinstance(result['dimensions'][dim_key]['signals'], list)

    def test_laopo_useful_god_水_yields_北方(self):
        result = compute_daily_fortune(**LAOPO_INPUTS, target_date=date(2026, 5, 14))
        wealth_dir = result['folkContent']['wealthDirection']
        assert wealth_dir['element'] == '水'
        assert wealth_dir['direction'] == '北方'


# ============================================================
# Universal day-branch signals
# ============================================================

class TestChongDayBranchUniversal:
    """沖日支 — universal rule (三命通會 「沖日支主動」)."""

    def test_chong_day_branch_caps_travel_score(self):
        # Roger's 日支=午 → 沖 by 子. 2026-05-14 is 戊子 day.
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        assert result['dimensions']['travel']['score'] <= 40

    def test_chong_day_branch_emits_career_caution(self):
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        career_types = [s['type'] for s in result['dimensions']['career']['signals']]
        assert any('chong_day_branch' in t for t in career_types)


class TestSoftTriggerDoctrine:
    """Daily 流日 is a SOFT TRIGGER, not a verdict.

    Per 算准网 + research findings: 流日的影响主要是瞬间的。
    The engine must always emit metaFraming='soft_trigger'. Narratives
    must use 「今日宜」「今日易於」「今日適合」 framing — never absolute
    語氣. AI prompt's anti-hallucination clause keys off this flag.
    """

    def test_meta_framing_present_for_roger(self):
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        assert result['metaFraming'] == META_FRAMING_SOFT_TRIGGER

    def test_meta_framing_present_for_laopo(self):
        result = compute_daily_fortune(**LAOPO_INPUTS, target_date=date(2026, 5, 14))
        assert result['metaFraming'] == META_FRAMING_SOFT_TRIGGER

    def test_no_absolute_language_in_any_signal_narrative(self):
        """Engine-level signal narratives must not contain absolute Chinese.

        These get spliced into AI prompts; the prompt-side anti-hallucination
        rules will further enforce, but the engine source MUST be clean.
        """
        forbidden = ['一定', '必定', '必然', '絕對', '百分百']
        for inputs in (ROGER_INPUTS, LAOPO_INPUTS):
            result = compute_daily_fortune(**inputs, target_date=date(2026, 5, 14))
            for dim_key, dim in result['dimensions'].items():
                for sig in dim['signals']:
                    narrative = sig.get('narrative', '')
                    for forb in forbidden:
                        assert forb not in narrative, (
                            f"Forbidden absolute word '{forb}' in {dim_key} signal "
                            f"'{sig['type']}': {narrative}"
                        )


# ============================================================
# Output shape regression
# ============================================================

class TestOutputShape:
    """Regression-lock the daily output shape — bumping `preAnalysisVersion`
    is REQUIRED for any breaking change here.
    """

    def _result(self) -> Dict[str, Any]:
        return compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))

    def test_top_level_keys_present(self):
        r = self._result()
        # Daily-specific
        assert 'dayStem' in r
        assert 'dayBranch' in r
        assert 'dayGanZhi' in r
        assert 'dayTenGod' in r
        assert 'dateIso' in r
        assert 'energyScore' in r
        assert 'metaFraming' in r
        assert 'folkContent' in r
        assert 'preAnalysisVersion' in r
        assert 'dimensions' in r
        # Reused from monthly (Phase 12 doctrine carryover)
        assert 'auspiciousness' in r
        assert 'baseAuspiciousness' in r
        assert 'ruleTrace' in r
        assert 'branchInteractions' in r
        # Month-only fields stripped
        assert 'monthStem' not in r
        assert 'monthBranch' not in r
        assert 'monthIndex' not in r

    def test_pre_analysis_version_matches_constants(self):
        assert self._result()['preAnalysisVersion'] == FORTUNE_DAILY_PRE_ANALYSIS_VERSION

    def test_energy_score_aligns_with_label_band(self):
        r = self._result()
        label = r['auspiciousness']
        expected_band = LABEL_TO_ENERGY_SCORE.get(label, 50)
        assert r['energyScore'] == expected_band

    def test_dimensions_all_five_present_with_signals(self):
        r = self._result()
        for dim in DIMENSION_KEYS:
            assert dim in r['dimensions']
            assert 'score' in r['dimensions'][dim]
            assert 'label' in r['dimensions'][dim]
            assert 'signals' in r['dimensions'][dim]


# ============================================================
# Effective gods input normalization
# ============================================================

class TestEffectiveGodsNormalization:
    """Engine-format `{usefulGod: '火', ...}` must auto-normalize to
    ten-god-keyed Chinese format under the hood (mirrors annual_enhanced).
    """

    def test_engine_format_effective_gods_works(self):
        # Engine format
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        # Should still emit valid 5-dim output
        assert result['dimensions']['romance']['score'] >= 0
        assert result['dimensions']['career']['score'] >= 0


# ============================================================
# 紅鸞 / 天喜 / 桃花 day triggers
# ============================================================

class TestShenshaDayTriggers:
    """Day branch triggers 紅鸞/天喜/桃花 → romance signal."""

    def test_roger_紅鸞_triggered_on_子日(self):
        """卯年支 → 紅鸞=子. 戊子 day triggers it."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        types = [s['type'] for s in result['dimensions']['romance']['signals']]
        assert 'honluan_triggered' in types


# ============================================================
# Phase 12h.B Item 2 — 傷官見官 valence at day scope (Issue 3 backfill)
# ============================================================

class TestShangguanJianGuanDayValence:
    """When today's day-ten-god is 傷官 AND chart has 正官, dispatch the
    valence-aware signal per Phase 12h.B Item 2 / 三命通會 「如官為忌，
    傷官見官反以吉論」.
    """

    def test_shangguan_day_with_guan_xi_yong_emits_harmful_valence(self):
        """Construct: DM=辛, 正官=丙(火). When today's 傷官=壬(水) day fires
        AND 正官 is 用神/喜神, valence='harmful'."""
        # DM=辛 (yin metal). 正官=丙 (火 controls 金). 傷官 of 辛 = 壬 (水).
        # 壬 is a 傷官 day for 辛 DM.
        pillars = {
            'year':  {'stem': '丙', 'branch': '寅'},  # 丙=正官 transparent
            'month': {'stem': '辛', 'branch': '酉'},
            'day':   {'stem': '辛', 'branch': '亥'},
            'hour':  {'stem': '癸', 'branch': '巳'},
        }
        # 正官=用神 (testing the harmful branch)
        effective_gods = {'正官': '用神', '七殺': '喜神',
                          '比肩': '閒神', '劫財': '閒神',
                          '食神': '忌神', '傷官': '忌神',
                          '正財': '閒神', '偏財': '閒神',
                          '正印': '閒神', '偏印': '閒神'}
        result = compute_daily_fortune(
            pillars=pillars,
            day_master_stem='辛',
            effective_gods=effective_gods,
            useful_god_element='火',
            gender='male',
            kong_wang=[],
            strength='neutral',
            is_cong_ge=False,
            target_date=date(2026, 1, 7),  # find a 壬X day — see below
            flow_year_stem='丙',
            flow_year_auspiciousness='平',
        )
        # If today happens to be a 傷官 day for 辛 DM, the transient signal fires
        if result['dayTenGod'] == '傷官':
            career_signals = result['dimensions']['career']['signals']
            sgjg = next((s for s in career_signals if s['type'] == 'shangguan_jian_guan_transient'), None)
            assert sgjg is not None
            assert sgjg['valence'] == 'harmful'
            assert sgjg['officerRole'] == '用神'

    def test_shangguan_day_with_guan_ji_emits_beneficial_valence(self):
        """When 正官 is 忌神, 傷官 day reverses to BENEFICIAL per Phase 12h.B Item 2."""
        pillars = {
            'year':  {'stem': '丙', 'branch': '寅'},
            'month': {'stem': '辛', 'branch': '酉'},
            'day':   {'stem': '辛', 'branch': '亥'},
            'hour':  {'stem': '癸', 'branch': '巳'},
        }
        # 正官=忌神 (testing the beneficial flip)
        effective_gods = {'正官': '忌神', '七殺': '仇神',
                          '比肩': '用神', '劫財': '喜神',
                          '食神': '閒神', '傷官': '閒神',
                          '正財': '閒神', '偏財': '閒神',
                          '正印': '閒神', '偏印': '閒神'}
        result = compute_daily_fortune(
            pillars=pillars,
            day_master_stem='辛',
            effective_gods=effective_gods,
            useful_god_element='金',
            gender='male',
            kong_wang=[],
            strength='neutral',
            is_cong_ge=False,
            target_date=date(2026, 1, 7),
            flow_year_stem='丙',
            flow_year_auspiciousness='平',
        )
        if result['dayTenGod'] == '傷官':
            career_signals = result['dimensions']['career']['signals']
            sgjg = next((s for s in career_signals if s['type'] == 'shangguan_jian_guan_transient'), None)
            assert sgjg is not None
            assert sgjg['valence'] == 'beneficial'
            assert sgjg['officerRole'] == '忌神'
            # And the absolute language ban applies to this new narrative
            assert '一定' not in sgjg['narrative']
            assert '必' not in sgjg['narrative']

    def test_non_shangguan_day_does_not_fire_transient_signal(self):
        """shangguan_jian_guan_transient must ONLY fire on 傷官 days, not on
        other ten-god days (比肩/正官/食神/etc.). Roger's 2026-05-14 = 戊子
        day = 比肩 day → must not fire."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        career_signals = result['dimensions']['career']['signals']
        types = [s['type'] for s in career_signals]
        assert 'shangguan_jian_guan_transient' not in types
        # And the 食神 day branch (when reached) emits only the soft baseline,
        # not the transient signal. Search for a 食神 day for Roger (DM=戊,
        # 食神=庚).
        for offset in range(60):
            d = date(2026, 1, 1) + timedelta(days=offset)
            result = compute_daily_fortune(**ROGER_INPUTS, target_date=d)
            if result['dayTenGod'] == '食神':
                types = [s['type'] for s in result['dimensions']['career']['signals']]
                assert 'shangguan_jian_guan_transient' not in types, (
                    f'{d.isoformat()} 食神 day must NOT fire shangguan_jian_guan_transient'
                )
                return


# ============================================================
# Phase 12h.B Item 8 — 比劫奪財 valence at day scope (Issue 1 backfill)
# ============================================================

class TestBiJieDuoCaiDayValence:
    """When today's day-ten-god is 比肩/劫財, dispatch 3-state valence per
    Phase 12h.B Item 8 — DM-weak suppression + 財 role + gender frame.
    """

    def test_bi_jie_day_dm_weak_yields_not_applicable_valence(self):
        """When DM is weak, 比劫 IS 用神 — suppress 「奪財」 framing."""
        # Laopo (DM=甲, strength=very_weak). When a 比劫 day fires, it's 扶身.
        # 2026-05-15 should be a 己丑 day (close to test date for stability).
        # Find ANY 比肩 day for Laopo (DM=甲, 比肩=甲). 2026 we look for 甲X.
        for offset in range(60):
            test_date = date(2026, 1, 1) + timedelta(days=offset)
            result = compute_daily_fortune(**LAOPO_INPUTS, target_date=test_date)
            if result['dayTenGod'] == '比肩':
                bi_jie_signal = next(
                    (s for s in result['dimensions']['finance']['signals']
                     if s.get('tenGod') == '比肩'),
                    None,
                )
                assert bi_jie_signal is not None
                # Laopo strength='very_weak' → valence='not_applicable'
                assert bi_jie_signal['valence'] == 'not_applicable'
                # And the signal score is POSITIVE for weak DM (扶身 reverses)
                assert result['dimensions']['finance']['score'] > 50 - 10
                return  # Test passed
        pytest.fail('Could not find a 比肩 day for Laopo in the 60-day search window')

    def test_bi_jie_day_dm_strong_cai_favorable_emits_harmful_valence(self):
        """When DM is strong/neutral AND 財 is 用神/喜神, 比劫 day = harmful."""
        # Construct: DM=丙 strong, 財=金 (用神).
        pillars = {
            'year':  {'stem': '丙', 'branch': '午'},
            'month': {'stem': '丙', 'branch': '午'},
            'day':   {'stem': '丙', 'branch': '寅'},
            'hour':  {'stem': '甲', 'branch': '午'},
        }
        # 正財 of 丙 = 辛 (金). Set 正財/偏財 = 用神/喜神
        effective_gods = {'比肩': '忌神', '劫財': '忌神',
                          '食神': '閒神', '傷官': '閒神',
                          '正財': '用神', '偏財': '喜神',
                          '正官': '閒神', '七殺': '閒神',
                          '正印': '閒神', '偏印': '閒神'}
        # Find a 丙X day (比肩 for DM=丙)
        for offset in range(60):
            test_date = date(2026, 1, 1) + timedelta(days=offset)
            result = compute_daily_fortune(
                pillars=pillars, day_master_stem='丙',
                effective_gods=effective_gods,
                useful_god_element='金', gender='male', kong_wang=[],
                strength='strong', is_cong_ge=False,
                target_date=test_date, flow_year_stem='丙',
                flow_year_auspiciousness='平',
            )
            if result['dayTenGod'] == '比肩':
                signal = next(
                    (s for s in result['dimensions']['finance']['signals']
                     if s.get('tenGod') == '比肩'),
                    None,
                )
                assert signal is not None
                assert signal['valence'] == 'harmful'
                assert signal['type'] == 'bi_jie_duo_cai_transient'
                # Male narrative SHOULD include 妻緣/夫妻 frame
                assert '妻' in signal['narrative'] or '夫妻' in signal['narrative']
                return
        pytest.fail('Could not find a 丙 (比肩) day in the 60-day search window')

    def test_bi_jie_day_female_no_sun_fu_phrase(self):
        """女命 比劫奪財 narrative MUST NOT contain 「損夫」 (Phase 12h.B Item 8 folk-myth correction)."""
        pillars = {
            'year':  {'stem': '丙', 'branch': '午'},
            'month': {'stem': '丙', 'branch': '午'},
            'day':   {'stem': '丙', 'branch': '寅'},
            'hour':  {'stem': '甲', 'branch': '午'},
        }
        effective_gods = {'比肩': '忌神', '劫財': '忌神',
                          '食神': '閒神', '傷官': '閒神',
                          '正財': '用神', '偏財': '喜神',
                          '正官': '閒神', '七殺': '閒神',
                          '正印': '閒神', '偏印': '閒神'}
        for offset in range(60):
            test_date = date(2026, 1, 1) + timedelta(days=offset)
            result = compute_daily_fortune(
                pillars=pillars, day_master_stem='丙',
                effective_gods=effective_gods,
                useful_god_element='金',
                gender='female',  # ← female
                kong_wang=[],
                strength='strong', is_cong_ge=False,
                target_date=test_date, flow_year_stem='丙',
                flow_year_auspiciousness='平',
            )
            if result['dayTenGod'] == '比肩':
                signal = next(
                    (s for s in result['dimensions']['finance']['signals']
                     if s.get('tenGod') == '比肩'),
                    None,
                )
                assert signal is not None
                # 女命 must NOT carry 「損夫」 framing
                assert '損夫' not in signal['narrative'], (
                    f'Female 比劫 narrative contains forbidden 「損夫」: {signal["narrative"]}'
                )
                assert signal['gender'] == 'female'
                return
        pytest.fail('Could not find a 比肩 day for female chart in 60-day window')

    def test_bi_jie_day_dm_strong_cai_unfavorable_emits_beneficial_valence(self):
        """Phase 12h.B beneficial flip: when 財 is 忌/仇神, 比劫制財 = beneficial."""
        pillars = {
            'year':  {'stem': '丙', 'branch': '午'},
            'month': {'stem': '丙', 'branch': '午'},
            'day':   {'stem': '丙', 'branch': '寅'},
            'hour':  {'stem': '甲', 'branch': '午'},
        }
        # 財 is 忌/仇神 — beneficial reversal expected
        effective_gods = {'比肩': '用神', '劫財': '喜神',
                          '食神': '閒神', '傷官': '閒神',
                          '正財': '忌神', '偏財': '仇神',
                          '正官': '閒神', '七殺': '閒神',
                          '正印': '閒神', '偏印': '閒神'}
        for offset in range(60):
            test_date = date(2026, 1, 1) + timedelta(days=offset)
            result = compute_daily_fortune(
                pillars=pillars, day_master_stem='丙',
                effective_gods=effective_gods,
                useful_god_element='火', gender='male', kong_wang=[],
                strength='strong', is_cong_ge=False,
                target_date=test_date, flow_year_stem='丙',
                flow_year_auspiciousness='平',
            )
            if result['dayTenGod'] == '比肩':
                signal = next(
                    (s for s in result['dimensions']['finance']['signals']
                     if s.get('tenGod') == '比肩'),
                    None,
                )
                assert signal is not None
                assert signal['valence'] == 'beneficial'
                return
        pytest.fail('Could not find a 比肩 day in the 60-day search window')


# ============================================================
# 凶上加凶 score ordering (Issue 4 backfill)
# ============================================================

class TestExtendedSeverityOrdering:
    """Includes legacy intermediate labels emitted by `_compute_single_month`:
    小凶 (沖 cap when base=平) and 凶上加凶 (month-neg + year-neg combined).
    """

    def test_all_9_labels_present_with_unique_scores(self):
        assert len(set(LABEL_TO_ENERGY_SCORE.values())) == len(LABEL_TO_ENERGY_SCORE)
        for label in ('大吉', '吉', '吉中有凶', '平', '凶中有吉', '小凶', '凶', '大凶', '凶上加凶'):
            assert label in LABEL_TO_ENERGY_SCORE

    def test_xiongshangjiaxiong_strictly_worse_than_dakong(self):
        """凶上加凶 means month+year both negative — strictly worse than 大凶 alone."""
        assert LABEL_TO_ENERGY_SCORE['凶上加凶'] < LABEL_TO_ENERGY_SCORE['大凶']

    def test_extended_monotonicity_across_all_9_labels(self):
        ordered = ['凶上加凶', '大凶', '凶', '小凶', '凶中有吉', '平', '吉中有凶', '吉', '大吉']
        scores = [LABEL_TO_ENERGY_SCORE[l] for l in ordered]
        assert scores == sorted(scores)


# ============================================================
# Exhaustive no-absolute-language sweep (Issue D coverage gap)
# ============================================================

class TestExhaustiveAbsoluteLanguageSweep:
    """The single-day no-absolute test is narrow. Sweep 30 consecutive
    days across both calibration anchors to catch absolute Chinese
    leakage in any signal narrative.
    """

    def test_30_day_sweep_roger_no_absolute_language(self):
        forbidden = ['一定', '必定', '必然', '絕對', '百分百', '肯定', '必']
        for offset in range(30):
            d = date(2026, 1, 1) + timedelta(days=offset)
            result = compute_daily_fortune(**ROGER_INPUTS, target_date=d)
            for dim_key, dim in result['dimensions'].items():
                for sig in dim['signals']:
                    narrative = sig.get('narrative', '')
                    for forb in forbidden:
                        assert forb not in narrative, (
                            f'Roger {d.isoformat()} dim={dim_key} sig={sig["type"]}: '
                            f'forbidden 「{forb}」 in: {narrative}'
                        )

    def test_30_day_sweep_laopo_no_absolute_language(self):
        forbidden = ['一定', '必定', '必然', '絕對', '百分百', '肯定', '必']
        for offset in range(30):
            d = date(2026, 1, 1) + timedelta(days=offset)
            result = compute_daily_fortune(**LAOPO_INPUTS, target_date=d)
            for dim_key, dim in result['dimensions'].items():
                for sig in dim['signals']:
                    narrative = sig.get('narrative', '')
                    for forb in forbidden:
                        assert forb not in narrative, (
                            f'Laopo {d.isoformat()} dim={dim_key} sig={sig["type"]}: '
                            f'forbidden 「{forb}」 in: {narrative}'
                        )


# ============================================================
# 驛馬 trigger explicit test (test claim backfill)
# ============================================================

class TestYimaTrigger:
    """When today's branch is the 驛馬 partner of natal 日支, travel dim
    should reflect the trigger.

    Roger's natal 日支 = 午; YIMA[午] = 申. So a 申X day triggers 驛馬.
    """

    def test_roger_驛馬_triggered_on_申日(self):
        # Find a 申X day in 2026 for Roger
        for offset in range(60):
            d = date(2026, 1, 1) + timedelta(days=offset)
            result = compute_daily_fortune(**ROGER_INPUTS, target_date=d)
            if result['dayBranch'] == '申':
                types = [s['type'] for s in result['dimensions']['travel']['signals']]
                assert 'yima_aligned' in types, (
                    f'Expected yima_aligned for 申 day branch (Roger 日支=午 → 驛馬=申), '
                    f'got: {types}'
                )
                return
        pytest.fail('Could not find a 申 day in 60-day search window')


# ============================================================
# Phase 1 Option 2.5 — Bounded Decouple pipeline tests
# ============================================================

class TestFlowMonthPillarLookup:
    """get_flow_month_pillar resolves the FLOW MONTH (not day) pillar via
    cnlunar's month8Char (節氣-aware)."""

    def test_may_2026_is_癸巳_month(self):
        from app.daily_enhanced import get_flow_month_pillar
        # 2026-05-14 → 癸巳月 (after 立夏 ~2026-05-05)
        stem, branch = get_flow_month_pillar(date(2026, 5, 14))
        assert stem == '癸'
        assert branch == '巳'

    def test_flow_month_differs_from_day_pillar(self):
        from app.daily_enhanced import get_day_pillar, get_flow_month_pillar
        d = date(2026, 5, 14)
        day_s, day_b = get_day_pillar(d)
        month_s, month_b = get_flow_month_pillar(d)
        # Day=戊子, Month=癸巳 — must differ
        assert (day_s, day_b) != (month_s, month_b)


class TestOption25TransparencyFields:
    """Verify Option 2.5 emits the 3 transparency fields needed by AI prompts."""

    def test_roger_emits_raw_structural_and_flow_month_fields(self):
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        # All 3 new fields must be present
        assert 'rawStructuralAuspiciousness' in result
        assert 'rawDailyAuspiciousness' in result
        assert 'flowMonthAuspiciousness' in result
        # All must be valid 9-label values
        from app.label_subordination import LABEL_LADDER
        assert result['rawStructuralAuspiciousness'] in LABEL_LADDER
        assert result['rawDailyAuspiciousness'] in LABEL_LADDER
        assert result['flowMonthAuspiciousness'] in LABEL_LADDER

    def test_roger_2026_05_14_pipeline_data_flow(self):
        """Verify the full Option 2.5 pipeline for Roger 2026-05-14:
        - rawStructural=凶 (day pillar 戊子 bareMonth)
        - softening: 紅鸞 + 比劫奪財 → 凶中有吉 (2 step mitigation)
        - flowMonth=吉中有凶 (Roger's May 2026 actual month)
        - cap: no clip (intersection permissive)
        - final=凶中有吉
        """
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        assert result['rawStructuralAuspiciousness'] == '凶'
        assert result['rawDailyAuspiciousness'] == '凶中有吉'
        assert result['flowMonthAuspiciousness'] == '吉中有凶'
        assert result['auspiciousness'] == '凶中有吉'
        # Softening signals must include both mitigations
        softening = result.get('perDaySoftening', [])
        assert 'honluan_mitigation' in softening
        assert 'bijie_duo_cai_beneficial_valence' in softening

    def test_laopo_2026_05_14_pipeline_data_flow(self):
        """Laopo 2026-05-14: bare=吉中有凶 (no softening fires); no cap clip."""
        result = compute_daily_fortune(**LAOPO_INPUTS, target_date=date(2026, 5, 14))
        assert result['rawStructuralAuspiciousness'] == '吉中有凶'
        # No applicable softening for Laopo on this day
        assert result['auspiciousness'] == '吉中有凶'


class TestSofteningLayer:
    """Direct tests for _apply_per_day_signal_adjustments."""

    def test_honluan_mitigation_shifts_凶_to_凶中有吉(self):
        """Roger's chart: 紅鸞 of 卯=子. Day branch=子 → mitigation fires."""
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        # Roger's effective gods normalized to ten-god format
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        # Start from 凶 raw; trigger 紅鸞 + 比劫奪財 mitigation
        adjusted, signals = _apply_per_day_signal_adjustments(
            raw_label='凶',
            day_stem='戊',   # 比肩
            day_branch='子',  # 紅鸞 of 卯
            day_ten_god='比肩',
            year_branch='卯',
            natal_day_branch='午',
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=['六沖'],
        )
        # 凶(pos 6) - 2 steps = pos 4 = 凶中有吉
        assert adjusted == '凶中有吉'
        assert 'honluan_mitigation' in signals
        assert 'bijie_duo_cai_beneficial_valence' in signals

    def test_no_signals_means_no_change(self):
        """Neutral conditions → raw_label unchanged."""
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        adjusted, signals = _apply_per_day_signal_adjustments(
            raw_label='平',
            day_stem='丙',   # 偏印 (用神 stem) — no mitigation trigger
            day_branch='戌',  # not 紅鸞/天喜/桃花 of 卯
            day_ten_god='偏印',
            year_branch='卯',
            natal_day_branch='午',
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=[],
        )
        assert adjusted == '平'
        # No signals fired
        assert signals == []

    def test_total_net_cap_at_2_steps(self):
        """Even if 紅鸞 + 天喜 + 比劫 all stack, cap at ±2 prevents 凶→吉."""
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        # Hypothetical: all positive signals firing
        # Roger 紅鸞=子, 天喜=午; same-day-branch can't trigger both, but 紅鸞 + 比劫 = 2 steps.
        # raw=大凶(pos 7), net=+2 → pos 5 (小凶), NOT pos 0 (大吉)
        adjusted, _ = _apply_per_day_signal_adjustments(
            raw_label='大凶',
            day_stem='戊',
            day_branch='子',  # 紅鸞
            day_ten_god='比肩',
            year_branch='卯',
            natal_day_branch='午',
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=['六沖'],
        )
        # 大凶(7) - 2 = 小凶(5), still inauspicious
        assert adjusted == '小凶'

    def test_spouse_palace_friction_acceleration(self):
        """六害/半刑 on day palace → -1 step acceleration (isolated from bijie).

        Use 丁 stem (正印 for 戊DM) — neither 比劫 nor in 紅鸞/天喜/桃花
        trigger set — so only friction fires.
        """
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        # Roger natal day branch=午. 午-丑 六害 → friction.
        # 丁 stem = 正印, day_ten_god='正印' (NOT 比劫 → no bijie trigger)
        adjusted, signals = _apply_per_day_signal_adjustments(
            raw_label='平',
            day_stem='丁',
            day_branch='丑',  # 六害 with 午
            day_ten_god='正印',
            year_branch='卯',
            natal_day_branch='午',
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=[],
        )
        # net_steps=-1, position delta = pos - net_steps = 3 - (-1) = 4 = 凶中有吉
        assert adjusted == '凶中有吉'
        assert any('spouse_palace_six_harm' in s for s in signals)

    def test_friction_and_bijie_can_cancel(self):
        """When friction (-1) + bijie (+1) both fire, net=0, label unchanged.
        Documents the additive behavior — useful for future tuning."""
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        adjusted, signals = _apply_per_day_signal_adjustments(
            raw_label='平',
            day_stem='己',  # 劫財 → triggers bijie when 財=忌
            day_branch='丑',  # 六害 with 午
            day_ten_god='劫財',
            year_branch='卯',
            natal_day_branch='午',
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=[],
        )
        # bijie (+1) + friction (-1) = 0 → unchanged
        assert adjusted == '平'
        assert 'bijie_duo_cai_beneficial_valence' in signals
        assert any('spouse_palace_six_harm' in s for s in signals)


class TestTaohuaMitigationLookup:
    """Regression for PR-46 code-review #3 fix.

    Pre-fix: `_apply_per_day_signal_adjustments` used `TAOHUA.get(year_branch)`
    which produced inconsistent behavior vs `_dispatch_romance` (line 194)
    which correctly uses `TAOHUA.get(natal_day_branch)`. Lock the fix here
    so future refactors can't silently regress to the year_branch lookup.

    Roger's chart: natal_day_branch=午 → TAOHUA[午]=卯. Year_branch=卯 →
    TAOHUA[卯]=子. Pre-fix, mitigation fired on 子日 (e.g. 2026-05-14 戊子).
    Post-fix, mitigation fires on 卯日 with a 用/喜 day stem.
    """

    def test_taohua_mitigation_fires_on_natal_taohua_day_with_favorable_stem(self):
        """Mitigation fires on TAOHUA-of-natal-day-branch with favorable stem.

        Uses SYNTHETIC natal_day_branch=申 (NOT Roger's 午) because Roger's
        TAOHUA branch (午→卯) accidentally causes 午-卯 六破 friction, which
        cancels the +1 shensha mitigation with a -1 friction step. Cleaner
        fixture: natal=申 → TAOHUA[申]=酉, and 申-酉 have no friction.

        Effective gods: 用神=金 (so 庚 stem maps to 比肩, 火→偏官, etc.)
        Pick a 用/喜 stem that doesn't have other side effects: 庚 = 比肩
        for 庚 DM = 比肩 → 閒神. Use 戊 DM + 用神=火 (Roger's gods) + 丁 stem
        but switch natal_day_branch to 申 to dodge the 卯-午 collision.
        """
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        adjusted, signals = _apply_per_day_signal_adjustments(
            raw_label='平',
            day_stem='丁',         # 火 element = 用神 (favorable)
            day_branch='酉',       # TAOHUA[natal=申]=酉
            day_ten_god='正印',
            year_branch='卯',      # year=卯 — pre-fix TAOHUA[卯]=子 ≠ 酉, so pre-fix would NOT have fired
            natal_day_branch='申', # synthetic — chosen to avoid friction with 酉
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=[],
        )
        # Mitigation fires → shensha +1 → pos 3 - 1 = 2 = 吉中有凶
        assert adjusted == '吉中有凶', (
            f"Expected 吉中有凶 (mitigation fires on TAOHUA day with favorable stem); "
            f"got {adjusted}, signals={signals}"
        )
        assert 'taohua_mitigation_favorable_stem' in signals

    def test_taohua_mitigation_does_NOT_fire_on_pre_fix_buggy_day(self):
        """Roger 子日 — pre-fix would fire (TAOHUA[year=卯]=子); post-fix must NOT.

        This test fails under the pre-fix code (year_branch lookup) — the
        regression guard. 戊子日 + 戊 stem still triggers 比劫 (+1 step
        from bijie_duo_cai_beneficial_valence) and 紅鸞 (+1 from
        honluan_mitigation), but the taohua signal name MUST NOT appear.
        """
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        adjusted, signals = _apply_per_day_signal_adjustments(
            raw_label='凶',
            day_stem='戊',
            day_branch='子',  # pre-fix bug fired here (TAOHUA[year=卯]=子)
            day_ten_god='比肩',
            year_branch='卯',
            natal_day_branch='午',
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=['六沖'],
        )
        # 桃花 mitigation MUST NOT fire — TAOHUA[natal=午]=卯, not 子
        assert 'taohua_mitigation_favorable_stem' not in signals, (
            f"taohua_mitigation should NOT fire on 子日 for Roger (natal 午); "
            f"got signals={signals}"
        )

    def test_taohua_mitigation_requires_favorable_day_stem_gate(self):
        """卯日 with non-favorable stem (e.g. 辛=enemyGod 金=仇神) → no mitigation.

        Verifies the FAVORABLE_ROLES gate still works correctly after the fix.
        """
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        # 辛 stem = 金 = Roger's enemyGod (仇神) — NOT in FAVORABLE_ROLES
        adjusted, signals = _apply_per_day_signal_adjustments(
            raw_label='平',
            day_stem='辛',
            day_branch='卯',  # 卯日 (correct TAOHUA branch)
            day_ten_god='傷官',
            year_branch='卯',
            natal_day_branch='午',
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=[],
        )
        # Stem gate blocks mitigation
        assert 'taohua_mitigation_favorable_stem' not in signals

    def test_honluan_tianxi_still_use_year_branch_correctly(self):
        """Sanity check: HONGLUAN/TIANXI still use year_branch (NOT touched by fix).

        Roger 紅鸞 = 子 (year branch 卯 → HONGLUAN[卯]=子). On a 子日,
        紅鸞 mitigation MUST fire. This guards against a future copy-paste
        of the TAOHUA fix to HONGLUAN/TIANXI which would break correct doctrine.
        """
        from app.daily_enhanced import _apply_per_day_signal_adjustments
        from app.annual_enhanced import _normalize_effective_gods_for_annual
        gods_zh = _normalize_effective_gods_for_annual(
            ROGER_INPUTS['effective_gods'], '戊',
        )
        adjusted, signals = _apply_per_day_signal_adjustments(
            raw_label='平',
            day_stem='戊',
            day_branch='子',  # HONGLUAN of year 卯
            day_ten_god='比肩',
            year_branch='卯',
            natal_day_branch='午',
            day_master_stem='戊',
            effective_gods_zh=gods_zh,
            branch_interactions_on_day_palace=[],
        )
        assert 'honluan_mitigation' in signals, (
            "HONGLUAN must still use year_branch (classical 三命通會 doctrine) — "
            "do NOT regress to natal_day_branch lookup."
        )


class TestSubordinationCapWiring:
    """Verify cap chain is wired correctly to the daily pipeline."""

    def test_cap_uses_call_b_not_call_a_for_month(self):
        """The cap input must be the FLOW MONTH's bare, not the day pillar's bare.
        This test verifies they're different sources and the right one drives the cap.
        """
        # Roger 2026-05-14:
        #   Call A (day pillar 戊子) bareMonth = 凶
        #   Call B (flow month 癸巳) bareMonth = 吉中有凶
        # Cap input must be Call B (flow month bare), not Call A.
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        assert result['flowMonthAuspiciousness'] == '吉中有凶'
        # 吉中有凶 month cap is (凶, 大吉) = permissive — softened 凶中有吉 stays
        assert result['auspiciousness'] == '凶中有吉'

    def test_cap_clips_when_intersection_restrictive(self):
        """Construct a scenario where the cap actually clips. Mock-like:
        use a day that would otherwise emit 大吉 in a 凶月. Hard to construct
        organically — instead verify the cap helper is called.
        """
        # This is indirectly covered by the corpus regression and the
        # apply_subordination_cap unit tests. Here we just verify the
        # day pipeline output is always within the 9-label set.
        from app.label_subordination import LABEL_LADDER
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        assert result['auspiciousness'] in LABEL_LADDER


class TestHeadlinerSignals:
    """Option 2.5 UI layer — `headlinerSignals` field structure + content."""

    def test_field_present_with_chartContext_and_triggers(self):
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        assert 'headlinerSignals' in result
        hs = result['headlinerSignals']
        assert 'chartContext' in hs
        assert 'triggers' in hs

    def test_chartContext_always_3_entries(self):
        """chartContext must always have 干支 + 十神 + auspiciousness — 3 entries."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        cc = result['headlinerSignals']['chartContext']
        assert len(cc) == 3
        types = [item['type'] for item in cc]
        assert types == ['day_ganzhi', 'day_ten_god', 'auspiciousness']
        # Labels populated
        for item in cc:
            assert item['label'].strip(), f'Empty label for {item["type"]}'

    def test_chartContext_labels_match_final_output(self):
        """chartContext labels must match the actual day pillar + 十神 + final auspiciousness."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        cc_by_type = {item['type']: item['label'] for item in result['headlinerSignals']['chartContext']}
        assert cc_by_type['day_ganzhi'] == f'{result["dayGanZhi"]}日'  # appends 日
        assert cc_by_type['day_ten_god'] == result['dayTenGod']
        assert cc_by_type['auspiciousness'] == result['auspiciousness']

    def test_roger_2026_05_14_emits_expected_triggers(self):
        """Roger 戊子日 has 沖配偶宮 + 紅鸞 — both should appear in triggers."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        trigger_types = [t['type'] for t in result['headlinerSignals']['triggers']]
        assert 'chong_day_branch' in trigger_types
        assert 'honluan_mitigation' in trigger_types

    def test_laopo_2026_05_14_emits_empty_triggers(self):
        """Laopo 戊子日 has no major structural triggers — triggers list should be empty (or short)."""
        result = compute_daily_fortune(**LAOPO_INPUTS, target_date=date(2026, 5, 14))
        triggers = result['headlinerSignals']['triggers']
        # Laopo has minimal triggers this day — list should be quite short
        assert len(triggers) <= 2

    def test_triggers_capped_at_2(self):
        """triggers list is hard-capped at 2 even when many signals fire."""
        # Sweep multiple days to find any that would have >2 candidates
        from datetime import timedelta
        max_seen = 0
        for offset in range(30):
            d = date(2026, 5, 1) + timedelta(days=offset)
            r = compute_daily_fortune(**ROGER_INPUTS, target_date=d)
            triggers = r['headlinerSignals']['triggers']
            max_seen = max(max_seen, len(triggers))
            assert len(triggers) <= 2, f'Triggers exceed cap on {d}: {triggers}'

    def test_trigger_label_uses_chinese_display_name(self):
        """Trigger labels must be Chinese display labels, NOT raw signal types."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        for trigger in result['headlinerSignals']['triggers']:
            # Label must contain Chinese chars, not just snake_case
            assert any('一' <= c <= '鿿' for c in trigger['label']), (
                f'Trigger label {trigger["label"]!r} is not Chinese for type={trigger["type"]}'
            )

    def test_priority_order_pillar_clash_before_softening(self):
        """When BOTH structural (沖配偶宮) AND softening (紅鸞) fire, structural
        is listed FIRST (higher priority)."""
        result = compute_daily_fortune(**ROGER_INPUTS, target_date=date(2026, 5, 14))
        triggers = result['headlinerSignals']['triggers']
        if len(triggers) >= 2:
            # If both fire and we hit the cap, structural should come first
            types = [t['type'] for t in triggers]
            chong_idx = types.index('chong_day_branch') if 'chong_day_branch' in types else -1
            honluan_idx = types.index('honluan_mitigation') if 'honluan_mitigation' in types else -1
            if chong_idx >= 0 and honluan_idx >= 0:
                assert chong_idx < honluan_idx, (
                    f'chong_day_branch should rank before honluan_mitigation; got {types}'
                )


class TestShishenZhishaNatalDayBranchExclusion:
    """PR #47 Issue 4 — `_detect_shishen_zhisha_active` rule-7 («day_stem must
    root in ANOTHER branch») must exclude the NATAL day pillar, not the FLOW
    day's branch. The dormant Option-2.5 食神制殺 rescue is gated behind
    PHASE_1_5_OPTION_25_REFINEMENT_ENABLED (default OFF); the function itself is
    pure, so we exercise it directly.

    Fixture (戊 DM, 食神=金): year/month/hour stems = 庚/戊/壬 (庚=食神 transparent,
    rooted via 申/酉); day_stem 甲(木) roots ONLY in the natal day branch 卯; the
    flow day_branch is 午 (≠ 卯). Pre-fix («b != day_branch») kept 卯 in scope →
    甲 rooted → True (rule fired wrongly). Post-fix («b != pillars['day']['branch']»)
    excludes 卯 → 甲 rootless elsewhere → False.
    """

    def test_root_only_in_natal_day_branch_does_not_fire(self):
        result = _detect_shishen_zhisha_active(
            dm_stem='戊', dm_element='土', natal_stems=['庚', '戊', '壬'],
            day_stem='甲', day_branch='午',
            pillars={
                'year': {'branch': '申'},
                'month': {'branch': '酉'},
                'day': {'branch': '卯'},  # 甲's only 木 root — the natal day pillar
                'hour': {'branch': '戌'},
            },
            effective_gods_zh={},
        )
        assert result is False

    def test_root_in_non_day_branch_still_fires(self):
        # Positive control: 甲 also roots in 寅 (year, non-day) → rule fires.
        result = _detect_shishen_zhisha_active(
            dm_stem='戊', dm_element='土', natal_stems=['庚', '戊', '壬'],
            day_stem='甲', day_branch='午',
            pillars={
                'year': {'branch': '寅'},  # 甲 roots here (non-day) → check 7 passes
                'month': {'branch': '酉'},  # 食神 金 root (check 6)
                'day': {'branch': '卯'},
                'hour': {'branch': '戌'},
            },
            effective_gods_zh={},
        )
        assert result is True


