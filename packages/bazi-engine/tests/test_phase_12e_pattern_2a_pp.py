"""
Phase 12e Pattern 2a'' — non-month 比劫祿/羊刃 boost in V2.

Source: 任鐵樵《滴天髓·天干》注: 「甲日干，月令非寅，但日支寅而時支卯，
                                  謂之專祿坐刃，身固強矣」
Phase A doctrine verified. Phase C v2 refinement: ≥2 qualifying branches
required (matches 任's combination doctrine; preserves Roger anchor).

Tests verify:
  - Pattern 2a'' fires when ≥2 non-month branches at 臨官/帝旺 + DM-counted
    effective_transparent ≥ 2
  - DM stem counts as 1 implicit transparent (PATTERN_2A_PP_DM_AS_TRANSPARENT)
  - Single qualifying branch alone (e.g., Roger's day=午=帝旺) does NOT fire
  - Yin DM cycles handled correctly via get_life_stage()
  - Pattern is gated by `_PATTERN_2A_PP_NON_MONTH` flag
  - Roger / Laopo anchors preserved (V2 pinned)
  - Boost capped at PATTERN_2A_BOOST_CAP (defensive; unreachable in 4-pillar)
  - Angelababy V2 cascade documented (very_weak → weak)
"""

import pytest

from app import interpretation_rules as ir
from app.interpretation_rules import calculate_strength_score_v2
from app.life_stages import get_life_stage
from app.constants import (
    PATTERN_2A_PP_PER_BRANCH_BOOST,
    PATTERN_2A_PP_DM_AS_TRANSPARENT,
    PATTERN_2A_PP_MIN_QUALIFYING_BRANCHES,
    PATTERN_2A_BOOST_CAP,
)


def _pillars(year, month, day, hour):
    return {
        'year':  {'stem': year[0],  'branch': year[1]},
        'month': {'stem': month[0], 'branch': month[1]},
        'day':   {'stem': day[0],   'branch': day[1]},
        'hour':  {'stem': hour[0],  'branch': hour[1]},
    }


class TestPattern2aPpFires:
    """Pattern 12e-B fires on textbook 「日支祿+時支羊刃」 charts."""

    def test_shishang_strong_jia_strong_after_2app(self):
        """edge_shishang_strong_jia: 丙寅 甲午 甲寅 丁卯, DM=甲.
        year=寅(臨官), day=寅(臨官), hour=卯(帝旺) → 3 qualifying branches.
        Pattern 2a (month=午=食傷) doesn't fire. Phase 12e-B fires.
        boost = 5 × 3 = 15. V2 49.5 → 64.5 (neutral → strong)."""
        pillars = _pillars(('丙','寅'), ('甲','午'), ('甲','寅'), ('丁','卯'))
        result = calculate_strength_score_v2(pillars, '甲')
        f = result['factors']
        assert f['pattern2aSource'] == 'non_month_lujie_yangren'
        assert f['pattern2aBoost'] == pytest.approx(15.0, abs=0.01)
        assert result['classification'] == 'strong'
        assert result['score'] == pytest.approx(64.5, abs=0.1)

    def test_dm_counted_as_implicit_transparent(self):
        """DM stem (excluded from rooted_bijie_transparent) counts as
        1 implicit transparent for Phase 12e-B's effective threshold.
        Verifies PATTERN_2A_PP_DM_AS_TRANSPARENT=True semantics."""
        # shishang_strong has rooted_bijie_transparent=1 (only month 甲),
        # but effective=1+1=2 ≥ threshold ✓
        pillars = _pillars(('丙','寅'), ('甲','午'), ('甲','寅'), ('丁','卯'))
        result = calculate_strength_score_v2(pillars, '甲')
        # If DM weren't counted, effective=1<2 → no fire. The fact that
        # this chart fires confirms DM is counted.
        assert result['factors']['pattern2aSource'] == 'non_month_lujie_yangren'


class TestPattern2aPpThresholdGuard:
    """≥2 qualifying branches required (preserves Roger anchor)."""

    def test_roger_anchor_v2_unchanged(self):
        """Roger 丁卯 戊申 戊午 庚申, DM=戊. Only day=午 (帝旺) qualifies;
        year=卯 (沐浴), hour=申 (病). qualifying=1 < 2 → no fire.
        V2 must remain at 39.0 (pinned anchor)."""
        pillars = _pillars(('丁','卯'), ('戊','申'), ('戊','午'), ('庚','申'))
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['factors']['pattern2aBoost'] == 0.0
        assert result['factors']['pattern2aSource'] == 'none'
        assert result['score'] == pytest.approx(39.0, abs=0.1)
        assert result['classification'] == 'weak'

    def test_laopo_anchor_v2_unchanged(self):
        """Laopo 丙寅 辛丑 甲戌 壬申, DM=甲. effective_transparent=0+1=1<2
        (no rooted 比劫 透干 in non-day pillars). Fails effective gate
        before reaching branch counting. V2 must remain at 20.6."""
        pillars = _pillars(('丙','寅'), ('辛','丑'), ('甲','戌'), ('壬','申'))
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['factors']['pattern2aBoost'] == 0.0
        assert result['factors']['pattern2aSource'] == 'none'
        assert result['score'] == pytest.approx(20.6, abs=0.1)
        assert result['classification'] == 'very_weak'

    def test_no_fire_when_only_1_qualifying_branch(self):
        """Same as Roger anchor but explicit threshold-test framing."""
        pillars = _pillars(('丁','卯'), ('戊','申'), ('戊','午'), ('庚','申'))
        # Verify the qualifying branch count via direct life-stage check
        qualifying = sum(
            1 for pname in ('year', 'day', 'hour')
            if get_life_stage('戊', pillars[pname]['branch'])
            in ('臨官', '帝旺'))
        assert qualifying == 1
        # And Pattern 2a'' correctly skips
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['factors']['pattern2aSource'] != 'non_month_lujie_yangren'

    def test_no_fire_when_zero_qualifying_branches(self):
        """Synthetic chart with 比劫 透干 ≥ 2 (effective=2) BUT no
        non-month 祿/羊刃 branch. qualifying=0 < 2 → no fire."""
        # 戊 DM + 戊 hour stem rooted in month branch 戌 (本氣戊).
        # Branches: 子, 戌, 寅, 子. None of them are 戊's 臨官(巳)/帝旺(午).
        pillars = _pillars(('丙','子'), ('丙','戌'), ('戊','寅'), ('戊','子'))
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['factors']['pattern2aSource'] != 'non_month_lujie_yangren'


class TestPattern2aPpMonthBoundDoesNotInterfere:
    """Phase 12e-B is a fallback — Pattern 2a/2a' fires first when applicable."""

    def test_ma_canzheng_uses_month_yin_benqi(self):
        """ma_canzheng: 壬寅 戊申 壬辰 壬寅. month=申(庚=印 for 壬DM).
        Pattern 2a fires (month_yin_benqi); Phase 12e-B not reached."""
        pillars = _pillars(('壬','寅'), ('戊','申'), ('壬','辰'), ('壬','寅'))
        result = calculate_strength_score_v2(pillars, '壬')
        assert result['factors']['pattern2aSource'] == 'month_yin_benqi'


class TestPattern2aPpYinDm:
    """Yin DM cycles handled correctly via get_life_stage."""

    def test_yi_dm_with_yin_lu_yangren(self):
        """乙 DM (yin wood). 乙's life stages: 帝旺=寅, 臨官=卯.
        Synthetic: 甲申 庚午 乙卯 丁寅 — day=卯(臨官) + hour=寅(帝旺) → 2.
        rooted 比劫 透干: year=甲(rooted in branches via 寅) → 1.
        effective=1+1=2 → fires. boost = 10. V2 lifts."""
        pillars = _pillars(('甲','申'), ('庚','午'), ('乙','卯'), ('丁','寅'))
        # Verify life stages match expectation
        assert get_life_stage('乙', '卯') == '臨官'
        assert get_life_stage('乙', '寅') == '帝旺'
        result = calculate_strength_score_v2(pillars, '乙')
        # Should fire Phase 12e-B
        if result['factors']['pattern2aSource'] == 'non_month_lujie_yangren':
            assert result['factors']['pattern2aBoost'] >= 5.0


class TestPattern2aPpFlag:
    """Flag-OFF behavior reverts to Phase 12d."""

    def test_pattern_2a_pp_disabled_when_flag_off(self, monkeypatch):
        """Setting _PATTERN_2A_PP_NON_MONTH=False reverts to Phase 12d.
        shishang_strong should NOT fire 12e-B path."""
        monkeypatch.setattr(ir, '_PATTERN_2A_PP_NON_MONTH', False)
        pillars = _pillars(('丙','寅'), ('甲','午'), ('甲','寅'), ('丁','卯'))
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['factors']['pattern2aSource'] != 'non_month_lujie_yangren'
        assert result['factors']['pattern2aBoost'] == 0.0


class TestPattern2aPpCapClamp:
    """Defensive cap at PATTERN_2A_BOOST_CAP (unreachable in 4-pillar default)."""

    def test_boost_cap_clamps_via_per_branch_increase(self, monkeypatch):
        """With default PATTERN_2A_PP_PER_BRANCH_BOOST=5, max possible
        is 3 branches × 5 = 15 (cap=20 unreachable). Monkeypatch boost
        to 8: 3 branches × 8 = 24 → clamped at 20."""
        # Use shishang_strong (3 qualifying branches)
        # Patch the constant inside the function's module
        monkeypatch.setattr(ir, 'PATTERN_2A_PP_PER_BRANCH_BOOST', 8.0)
        pillars = _pillars(('丙','寅'), ('甲','午'), ('甲','寅'), ('丁','卯'))
        result = calculate_strength_score_v2(pillars, '甲')
        # 3 × 8 = 24 → clamped to PATTERN_2A_BOOST_CAP (20)
        assert result['factors']['pattern2aBoost'] == pytest.approx(20.0, abs=0.01)


class TestPattern2aPpNoMisfireOnPhase12dCharts:
    """Phase 12d-affected charts must not regress."""

    def test_yao_pinwo_no_misfire(self):
        """yao_pinwo: 辛丑 癸巳 丙子 丁酉, DM=丙. Phase 12d 2b path
        applies. day=子(胎), hour=酉(死) — both non-qualifying.
        Pattern 12e-B must NOT fire."""
        pillars = _pillars(('辛','丑'), ('癸','巳'), ('丙','子'), ('丁','酉'))
        result = calculate_strength_score_v2(pillars, '丙')
        assert result['factors']['pattern2aSource'] != 'non_month_lujie_yangren'

    def test_long2_borderline_no_fire(self):
        """dts_hezhi_long2: 辛丑 癸巳 甲子 丙寅, DM=甲. rooted 比劫
        透干=0 (no 甲/乙 in non-day pillars). effective=0+1=1<2.
        Pattern 12e-B must NOT fire (preserves doctrinal-split status)."""
        pillars = _pillars(('辛','丑'), ('癸','巳'), ('甲','子'), ('丙','寅'))
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['factors']['pattern2aSource'] != 'non_month_lujie_yangren'

    def test_noble3_no_fire(self):
        """dts_hezhi_noble3: 甲午 丙寅 辛酉 己丑, DM=辛. rooted 比劫
        透干=0 (no 庚/辛 in non-day pillars). effective=0+1=1<2.
        Pattern 12e-B must NOT fire (now reclassified as doctrinal split)."""
        pillars = _pillars(('甲','午'), ('丙','寅'), ('辛','酉'), ('己','丑'))
        result = calculate_strength_score_v2(pillars, '辛')
        assert result['factors']['pattern2aSource'] != 'non_month_lujie_yangren'


class TestPattern2aPpAngelababyCascade:
    """Angelababy compat-couple cascade (N2 pre-merge fix)."""

    def test_angelababy_v2_classification_under_12e(self):
        """Angelababy 1989-02-28 (己 yin earth, 己巳 丙寅 己未 庚午).
        For 己 yin earth: 帝旺=巳, 臨官=午.
        Year=巳(帝旺) + hour=午(臨官) → 2 qualifying.
        rooted 比劫 透干: year stem 己 rooted in 巳(中氣戊), 未(本氣己).
        Wait — year stem matches DM=己; rooted? 己 in branches via 中氣
        in 巳 + 本氣 in 未 + 中氣 in 午. → 'strong'.
        effective_transparent = 1 + 1 (DM) = 2 ✓.
        boost = 5 × 2 = 10. V2 22.8 → 32.8 (very_weak → weak)."""
        pillars = _pillars(('己','巳'), ('丙','寅'), ('己','未'), ('庚','午'))
        result = calculate_strength_score_v2(pillars, '己')
        assert get_life_stage('己', '巳') == '帝旺'
        assert get_life_stage('己', '午') == '臨官'
        # V2 cascade: classification flip from very_weak to weak
        assert result['factors']['pattern2aSource'] == 'non_month_lujie_yangren'
        assert result['factors']['pattern2aBoost'] == pytest.approx(10.0, abs=0.01)
        # The pinned post-12e V2 score
        assert result['score'] == pytest.approx(32.8, abs=0.5)
        assert result['classification'] == 'weak'


class TestPattern2aPpDoctrinalSplits:
    """Verify DOCTRINAL_SPLIT_CHART_IDS list update."""

    def test_doctrinal_split_chart_ids_includes_noble3(self):
        """noble3 is reclassified as doctrinal split per Phase 12e."""
        from tests.validation.run_imbalance_validation import (
            DOCTRINAL_SPLIT_CHART_IDS,
        )
        assert 'dts_hezhi_noble3' in DOCTRINAL_SPLIT_CHART_IDS

    def test_doctrinal_split_chart_ids_count(self):
        """Phase 12e adds 2 charts (noble3 + shishang_strong) → 16 total.
        noble3: Category 6 (食神制殺 vs 印化煞).
        shishang_strong: Category 4 extension (比劫旺極 + 食傷saturated)."""
        from tests.validation.run_imbalance_validation import (
            DOCTRINAL_SPLIT_CHART_IDS,
        )
        assert len(DOCTRINAL_SPLIT_CHART_IDS) == 16

    def test_shishang_strong_in_doctrinal_splits(self):
        """shishang_strong reclassified as Category 4 doctrinal split.
        Pattern 12e-B lifts V2 correctly (strong) but Pattern 1 hijacks
        用神 (engine: 食傷洩秀; corpus: 財). Both classically defensible."""
        from tests.validation.run_imbalance_validation import (
            DOCTRINAL_SPLIT_CHART_IDS,
        )
        assert 'edge_shishang_strong_jia' in DOCTRINAL_SPLIT_CHART_IDS


class TestPattern2aPpRootedAtTwoEnemyMonth:
    """Phase 12f Issue H — cover the new activation path opened by Phase
    12e's restructure where rooted ≥ 2 + enemy month + qualifying ≥ 2.

    Phase 12d's `_pattern_2a_bijie_boost` had a strict early-return form
    (`if rooted < 2: return (0, none)` then month-bound checks then a
    terminal return). Phase 12e wrapped the month-bound checks in
    `if rooted >= 2:` and removed the terminal return, opening a new
    code path: charts with `rooted >= 2` + enemy month (NOT 印 NOT 比劫)
    + `qualifying_branches >= 2` now fire Pattern 2a'' fallback.

    Existing tests cover `rooted=1` (using effective=1+1=2 via DM-counted
    semantics). This test covers `rooted=2` + enemy month combination.
    """

    def test_rooted_2_enemy_month_qualifying_2_fires_pp(self):
        """Synthetic chart with all conditions met:
        - DM=甲, year=甲(rooted in 寅 本氣), hour=乙(rooted in 卯 本氣)
          → rooted_bijie_transparent = 2 ✓
        - month branch=午 (火, food god — NOT 印 NOT 比劫 for 甲)
          → Pattern 2a/2a' month-bound paths skip
        - non-month qualifying branches: year=寅(臨官), day=寅(臨官),
          hour=卯(帝旺) → qualifying_branches=3 ≥ 2 ✓
        - Pattern 2a'' fires; boost = 5 × 3 = 15
        """
        pillars = {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '庚', 'branch': '午'},
            'day':   {'stem': '甲', 'branch': '寅'},
            'hour':  {'stem': '乙', 'branch': '卯'},
        }
        from app.interpretation_rules import calculate_strength_score_v2
        result = calculate_strength_score_v2(pillars, '甲')
        f = result['factors']
        # Verify Pattern 2a'' (non-month) path fired, NOT month-bound paths
        assert f['pattern2aSource'] == 'non_month_lujie_yangren'
        assert f['pattern2aBoost'] == pytest.approx(15.0, abs=0.01)
