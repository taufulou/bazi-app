"""
Phase 12d Pattern 2b — 月令祿 surround dampener.

Source: 《淵海子平·論建祿格》「若四柱財官重重而日主獨守月令祿地，反為弱論」
        Phase A doctrine verification

Tests verify:
  - Pattern 2b fires when 月令祿 + (財+官殺) ≥ 9 + (比劫+印 sans 月令) ≤ 5
    + 透干 官殺 ≥ 1
  - Two-part penalty: 得令 cut (capped at 18 and floor 12) + flat -15
  - Pattern is gated by `_PATTERN_2B_SURROUND_DAMPENER`
  - Anchor regression: Roger and Laopo unchanged
"""

import pytest

from app import interpretation_rules as ir
from app.interpretation_rules import calculate_strength_score_v2


def _pillars(year, month, day, hour):
    return {
        'year':  {'stem': year[0],  'branch': year[1]},
        'month': {'stem': month[0], 'branch': month[1]},
        'day':   {'stem': day[0],   'branch': day[1]},
        'hour':  {'stem': hour[0],  'branch': hour[1]},
    }


class TestPattern2bFires:
    """Pattern 2b fires on classic 滴天髓 surround chart."""

    def test_yao_pinwo_drops_to_weak(self):
        """dts_hezhi_yao_pinwo: 辛丑 癸巳 丙子 丁酉, DM=丙. Month=巳 (祿
        for 丙 → deling=50). 全局 辛+丑+酉+子+癸 = 財官殺. transparent
        官殺=1 (癸). Pattern 2b fires; flips strength from strong→weak."""
        pillars = _pillars(('辛','丑'), ('癸','巳'), ('丙','子'), ('丁','酉'))
        result = calculate_strength_score_v2(pillars, '丙')
        f = result['factors']
        # 2b should fire and significantly lower V2
        assert f['pattern2bFlatPenalty'] == pytest.approx(15.0, abs=0.01)
        assert f['pattern2bDelingCut'] > 0
        # Score must drop into weak territory (≤40)
        assert result['classification'] in ('weak', 'very_weak')


class TestPattern2bNoMisfire:
    """Pattern 2b should NOT fire on balanced charts."""

    def test_no_misfire_balanced_chart(self):
        """Synthetic 月令祿 with balanced 財官 (just below threshold).
        Should NOT fire."""
        # 戊DM with month=巳 (戊's 祿 — actually 戊's 祿 is 巳).
        # 戊 in 巳 → SEASON_STRENGTH[土][巳] = 5 (旺) → deling=50.
        # Need (財+官殺) < 9. Let's use mostly 比劫 to avoid trigger.
        pillars = _pillars(('戊','戌'), ('丁','巳'), ('戊','午'), ('戊','戌'))
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['factors']['pattern2bFlatPenalty'] == 0.0


    def test_no_misfire_pure_bijie_strong(self):
        """三比劫透干 + 月令祿 + minimal 財官 → support > 5, blocks 2b."""
        # 三戊透干 + 月=巳 (戊's 祿) + minimal 財官
        pillars = _pillars(('戊','辰'), ('戊','巳'), ('戊','午'), ('戊','戌'))
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['factors']['pattern2bFlatPenalty'] == 0.0


class TestPattern2bFlag:
    """Flag-OFF behavior."""

    def test_pattern_2b_disabled_when_flag_off(self, monkeypatch):
        """yao_pinwo should NOT trigger 2b when flag is off."""
        monkeypatch.setattr(ir, '_PATTERN_2B_SURROUND_DAMPENER', False)
        pillars = _pillars(('辛','丑'), ('癸','巳'), ('丙','子'), ('丁','酉'))
        result = calculate_strength_score_v2(pillars, '丙')
        assert result['factors']['pattern2bFlatPenalty'] == 0.0
        assert result['factors']['pattern2bDelingCut'] == 0.0
        # Without 2b, classification reverts to strong
        assert result['classification'] in ('strong', 'very_strong')


class TestPattern2bAnchorRegression:
    """Roger and Laopo must remain unchanged."""

    def test_anchor_roger_unchanged(self):
        """Roger 丁卯 戊申 戊午 庚申, DM=戊. Month=申 (戊's 病, deling=24
        ≠ 50). Pattern 2b doesn't fire (deling < 50)."""
        pillars = _pillars(('丁','卯'), ('戊','申'), ('戊','午'), ('庚','申'))
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['factors']['pattern2bFlatPenalty'] == 0.0
        assert result['score'] == pytest.approx(39.0, abs=0.1)
        assert result['classification'] == 'weak'

    def test_anchor_laopo_unchanged(self):
        """Laopo 丙寅 辛丑 甲戌 壬申, DM=甲. Month=丑 (土 for 甲: 死,
        deling=12 ≠ 50). Pattern 2b doesn't fire."""
        pillars = _pillars(('丙','寅'), ('辛','丑'), ('甲','戌'), ('壬','申'))
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['factors']['pattern2bFlatPenalty'] == 0.0
        assert result['score'] == pytest.approx(20.6, abs=0.1)
        assert result['classification'] == 'very_weak'


class TestPattern2bDelingFloor:
    """得令 cut respects floor (never below PATTERN_2B_DELING_FLOOR=12)."""

    def test_deling_floor_respected(self):
        """yao_pinwo's deling=50 → cut at most to 12. Verify."""
        pillars = _pillars(('辛','丑'), ('癸','巳'), ('丙','子'), ('丁','酉'))
        result = calculate_strength_score_v2(pillars, '丙')
        # final deling after cut must be >= 12 (PATTERN_2B_DELING_FLOOR)
        assert result['factors']['deling'] >= 12.0
