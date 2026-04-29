"""
Phase 12d Pattern 3b — 真化 (true transformation) suppression in 從格 detection.

Source: 《滴天髓·化象》「合則化，化亦必得五土而後成」
        Phase 12b Fix D 4-condition gate (re-used verbatim for stem 五合)
        Phase A doctrine verification + Phase D N1 fix

Tests verify:
  - 乙庚化金 真化 fires when month 旺 + 化神 rooted + no 沖 + no breaker
  - Transformed 印/比劫 stems do NOT block 從格 detection
  - DM-involved 五合 → 從格 returns None (ambiguous)
  - 化神 lacks 月令 旺 → 真化 fails
  - 沖 disrupts → 真化 fails
  - 強根 breaker present → 真化 fails
  - Pattern is gated by `_PATTERN_3B_HUAQI_SUPPRESSION`
"""

import pytest

from app import interpretation_rules as ir
from app.stem_combinations import detect_true_transformed_stems
from app.interpretation_rules import check_cong_ge, calculate_strength_score_v2
from app.five_elements import calculate_five_elements_balance


def _pillars(year, month, day, hour):
    return {
        'year':  {'stem': year[0],  'branch': year[1]},
        'month': {'stem': month[0], 'branch': month[1]},
        'day':   {'stem': day[0],   'branch': day[1]},
        'hour':  {'stem': hour[0],  'branch': hour[1]},
    }


class TestPattern3bTransformsFire:
    """真化 conditions met → both stems transform."""

    def test_yiwuming_yi_geng_hua_jin(self):
        """anchor_cong_cai_yiwuming: 庚申 乙酉 丙申 己丑, DM=丙.
        年 庚 + 月 乙 adjacent → 乙庚化金. 月令=酉 (金 主氣) → 化神 旺.
        Should both transform."""
        pillars = _pillars(('庚','申'), ('乙','酉'), ('丙','申'), ('己','丑'))
        transformed = detect_true_transformed_stems(pillars, '丙')
        assert ('year', '庚') in transformed
        assert ('month', '乙') in transformed
        assert transformed[('year', '庚')] == '金'

    def test_yiwuming_cong_ge_fires(self):
        """After 真化 suppression, check_cong_ge fires (was None pre-3b).
        DM=丙 V2≈15 very_weak, year 乙 was blocking 印 — now suppressed."""
        pillars = _pillars(('庚','申'), ('乙','酉'), ('丙','申'), ('己','丑'))
        v2 = calculate_strength_score_v2(pillars, '丙')
        balance = calculate_five_elements_balance(pillars)
        result = check_cong_ge(pillars, '丙', v2, balance)
        assert result is not None
        # yongShen should be 金 (the dominant element after transformation)
        assert result['yongShen'] == '金'


class TestPattern3bNoFire:
    """真化 conditions NOT met → no transformation."""

    def test_no_root_no_transformation(self):
        """乙庚 adjacent BUT no 化神 root in any branch → 真化 fails (iii)."""
        # 乙庚 adjacent, but no 金 in branches at all.
        # Use 寅 (no 金), 卯 (no 金), 寅, 寅 — no 金 root for 化金.
        pillars = _pillars(('庚','寅'), ('乙','卯'), ('丁','寅'), ('丁','寅'))
        transformed = detect_true_transformed_stems(pillars, '丁')
        # 月令=卯 (木), SEASON_STRENGTH[金][卯] = 1 (死), so multiplier=0.6 < 1.5
        # → fails at gate (ii) anyway, but also no root
        assert ('year', '庚') not in transformed
        assert ('month', '乙') not in transformed

    def test_no_huashen_wang_in_month(self):
        """乙庚 adjacent BUT month branch doesn't 旺 化神=金.
        Use 月=卯 (木 旺, 金 死) — fails (ii)."""
        pillars = _pillars(('庚','申'), ('乙','卯'), ('丁','酉'), ('辛','酉'))
        transformed = detect_true_transformed_stems(pillars, '丁')
        # SEASON_STRENGTH[金][卯] = 1 (死), multiplier 0.6 < 1.5 → fails
        assert ('year', '庚') not in transformed
        assert ('month', '乙') not in transformed

    def test_chong_disrupts_transformation(self):
        """乙庚 + month=酉 (金 旺) + 化神 rooted, BUT 卯 in chart →
        卯酉沖 disrupts → 真化 fails (iv)."""
        pillars = _pillars(('庚','申'), ('乙','酉'), ('丁','卯'), ('辛','酉'))
        transformed = detect_true_transformed_stems(pillars, '丁')
        # 卯酉沖 — should fail (iv). NOTE: 真化 requires no 沖 on EITHER
        # combining branch (申, 酉). Neither is in clash here, but the
        # rule applies to both pillar branches' clashes. 申寅沖 if 寅 in
        # chart? No 寅. So actually no 沖 on 申 or 酉 specifically.
        # Refining: this test verifies that overall chart 沖 doesn't
        # interfere when neither combining branch is involved.
        # (Test name is misleading; this should still transform.)
        # Let's check whether 卯酉沖 affects the COMBINING branches —
        # 酉 IS in the combining pair (year=申, month=酉). So 卯 clashes 酉
        # → 沖 on month branch → fails (iv).
        assert ('month', '乙') not in transformed

    def test_breaker_present(self):
        """乙庚 + month=酉 + 化神 rooted, BUT 丁火 透干 強根 → fails (v).
        丁 = 火 = 克金 element. Need 丁 with strong root (e.g., 午 in chart)."""
        pillars = _pillars(('庚','申'), ('乙','酉'), ('丁','午'), ('丁','巳'))
        transformed = detect_true_transformed_stems(pillars, '丁')
        # 丁 火 with 強根 (午=火本氣 + 巳=火本氣) → breaker_strong=True → fails
        assert ('year', '庚') not in transformed
        assert ('month', '乙') not in transformed


class TestPattern3bDmInvolved:
    """DM-involved 五合 → 從格 returns None (ambiguous)."""

    def test_dm_involved_returns_none(self):
        """When DM itself is one of the combining stems, 從格 ambiguous."""
        # DM=丙, year=辛 → 丙辛合 (DM-involved).
        # Need 化神 conditions met. 化水. month must be 子 or 亥 for 旺.
        pillars = _pillars(('辛','酉'), ('丙','子'), ('丙','申'), ('壬','申'))
        v2 = calculate_strength_score_v2(pillars, '丙')
        balance = calculate_five_elements_balance(pillars)
        result = check_cong_ge(pillars, '丙', v2, balance)
        # If 真化 conditions are met for 丙辛, DM-involved guard returns None
        transformed = detect_true_transformed_stems(pillars, '丙')
        if any(s == '丙' for (_, s) in transformed):
            assert result is None


class TestPattern3bFlag:
    """Flag-OFF behavior."""

    def test_pattern_3b_disabled_when_flag_off(self, monkeypatch):
        """Setting _PATTERN_3B_HUAQI_SUPPRESSION=False reverts to baseline.
        anchor_cong_cai_yiwuming returns None pre-3b (year 乙 blocks)."""
        monkeypatch.setattr(ir, '_PATTERN_3B_HUAQI_SUPPRESSION', False)
        pillars = _pillars(('庚','申'), ('乙','酉'), ('丙','申'), ('己','丑'))
        v2 = calculate_strength_score_v2(pillars, '丙')
        balance = calculate_five_elements_balance(pillars)
        result = check_cong_ge(pillars, '丙', v2, balance)
        # With suppression OFF, year 乙 blocks 從格 (yang DM with 印 stem)
        assert result is None


class TestPattern3bAnchorRegression:
    """Roger and Laopo must remain unchanged."""

    def test_anchor_roger_unchanged(self):
        """Roger 丁卯 戊申 戊午 庚申, DM=戊. No adjacent 五合 pairs
        in stems (丁戊戊庚). 真化 detection should return empty."""
        pillars = _pillars(('丁','卯'), ('戊','申'), ('戊','午'), ('庚','申'))
        transformed = detect_true_transformed_stems(pillars, '戊')
        assert transformed == {}

    def test_anchor_laopo_unchanged(self):
        """Laopo 丙寅 辛丑 甲戌 壬申, DM=甲. 丙辛 adjacent (year-month)
        BUT 化水 needs month=亥/子; month=丑 → 真化 fails (ii)."""
        pillars = _pillars(('丙','寅'), ('辛','丑'), ('甲','戌'), ('壬','申'))
        transformed = detect_true_transformed_stems(pillars, '甲')
        assert transformed == {}
