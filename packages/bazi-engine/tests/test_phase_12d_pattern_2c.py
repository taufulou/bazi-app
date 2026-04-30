"""
Phase 12d Pattern 2c — 三合/半合 DM-element credit in V2 dedi.

Source: 《滴天髓·地支》「三合會局，氣專而力大」
        《淵海子平·地支三合》
        Phase A doctrine verification (validation_fix_doctrine_verification.md)

Tests verify:
  - 旺地半合 (e.g. 酉丑 with 辛 DM) credits dedi at 0.7× multiplier
  - 墓地半合 (e.g. 子辰 with 壬 DM) credits dedi at 0.5× multiplier
  - 三合 (e.g. 申子辰) credits at 1.0×
  - 沖 on 旺神 nullifies credit
  - DM 本氣 branches excluded from double-counting
  - Pattern is gated by `_PATTERN_2C_SANHE_CREDIT` flag
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


class TestPattern2cWangDiBanHe:
    """旺地半合 (旺神 + 1 partner) at 0.7× multiplier."""

    def test_dm_dedi_boosted_by_yandi_banhe(self):
        """dts_hezhi_noble3: 酉丑半合 with 辛 DM. Only 丑 contributes
        (酉本氣=辛=DM-element-aware). 5×0.7 = 3.5 expected credit."""
        pillars = _pillars(('甲','午'), ('丙','寅'), ('辛','酉'), ('己','丑'))
        result = calculate_strength_score_v2(pillars, '辛')
        assert result['factors']['sanheKind'] == '旺地半合'
        assert result['factors']['sanheCredit'] == pytest.approx(3.5, abs=0.01)

    def test_yandi_banhe_si_you(self):
        """巳酉半合金 with 庚 DM, 旺=酉 + 生=巳. 庚's 本氣 is 酉(辛),
        so STEM_ELEMENT[辛]=金=DM-element → 酉 excluded. Only 巳 contributes."""
        pillars = _pillars(('甲','子'), ('丁','巳'), ('庚','酉'), ('丙','戌'))
        result = calculate_strength_score_v2(pillars, '庚')
        # 巳本氣=丙=火≠金 → 巳 contributes; 酉本氣=辛=金=DM-element → 酉 excluded
        assert result['factors']['sanheKind'] == '旺地半合'
        assert result['factors']['sanheCredit'] == pytest.approx(3.5, abs=0.01)


class TestPattern2cMuDiBanHe:
    """墓地半合 (生神+墓神, no 旺神) at 0.5× multiplier."""

    def test_zi_chen_banhe_water_with_ren_dm(self):
        """子辰半合水 with 壬 DM. 子=旺神 (NOT 墓地半合 since 旺神 present).
        This is actually 旺地半合."""
        pillars = _pillars(('甲','寅'), ('丁','卯'), ('壬','子'), ('甲','辰'))
        result = calculate_strength_score_v2(pillars, '壬')
        assert result['factors']['sanheKind'] == '旺地半合'

    def test_shen_chen_mudi_banhe_with_gui_dm(self):
        """申辰半合水 with 癸 DM (生=申 + 墓=辰, no 旺=子). 墓地半合."""
        pillars = _pillars(('甲','寅'), ('丁','卯'), ('癸','申'), ('丙','辰'))
        result = calculate_strength_score_v2(pillars, '癸')
        assert result['factors']['sanheKind'] == '墓地半合'
        # Both 申 (本氣=庚=金) and 辰 (本氣=戊=土) ≠ 水, so both contribute
        # 5 × 2 × 0.5 = 5.0
        assert result['factors']['sanheCredit'] == pytest.approx(5.0, abs=0.01)


class TestPattern2cSanHe:
    """Full 三合 at 1.0× multiplier."""

    def test_shen_zi_chen_full_with_gui_dm(self):
        """申子辰 full 三合水 with 癸 DM. 子本氣=癸=DM-element → excluded.
        申(庚) + 辰(戊) contribute. 5 × 2 × 1.0 = 10.0."""
        pillars = _pillars(('庚','申'), ('丁','卯'), ('癸','子'), ('戊','辰'))
        result = calculate_strength_score_v2(pillars, '癸')
        assert result['factors']['sanheKind'] == '三合'
        assert result['factors']['sanheCredit'] == pytest.approx(10.0, abs=0.01)


class TestPattern2cChongDisruption:
    """沖 on 旺神 nullifies credit (合而被沖則散)."""

    def test_chong_disrupts_sanhe_credit(self):
        """酉丑半合 with 卯 (卯酉沖) → credit=0."""
        pillars = _pillars(('辛','卯'), ('丙','寅'), ('辛','酉'), ('己','丑'))
        result = calculate_strength_score_v2(pillars, '辛')
        assert result['factors']['sanheKind'] == 'none'
        assert result['factors']['sanheCredit'] == 0.0


class TestPattern2cFormedElementMismatch:
    """Formed element ≠ DM element → no credit."""

    def test_no_credit_when_formed_element_differs_from_dm(self):
        """寅午半合火 with 甲 DM (formed=火, DM=木) → credit=0."""
        pillars = _pillars(('丁','寅'), ('丙','午'), ('甲','子'), ('丙','戌'))
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['factors']['sanheKind'] == 'none'
        assert result['factors']['sanheCredit'] == 0.0


class TestPattern2cFlag:
    """Flag-OFF behavior."""

    def test_pattern_2c_disabled_when_flag_off(self, monkeypatch):
        """Setting _PATTERN_2C_SANHE_CREDIT=False reverts to baseline dedi."""
        monkeypatch.setattr(ir, '_PATTERN_2C_SANHE_CREDIT', False)
        pillars = _pillars(('甲','午'), ('丙','寅'), ('辛','酉'), ('己','丑'))
        result = calculate_strength_score_v2(pillars, '辛')
        assert result['factors']['sanheKind'] == 'none'
        assert result['factors']['sanheCredit'] == 0.0


class TestPattern2cAnchorRegression:
    """Roger/Laopo must remain unchanged under Pattern 2c."""

    def test_anchor_roger_unchanged(self):
        """Roger 丁卯 戊申 戊午 庚申 — DM=戊(土). 土 has no 三合 trinity
        (uses 四庫). Credit must be 0."""
        pillars = _pillars(('丁','卯'), ('戊','申'), ('戊','午'), ('庚','申'))
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['factors']['sanheCredit'] == 0.0
        # Score must remain at the documented 39.0
        assert result['score'] == pytest.approx(39.0, abs=0.1)
        assert result['classification'] == 'weak'

    def test_anchor_laopo_unchanged(self):
        """Laopo 丙寅 辛丑 甲戌 壬申 — DM=甲(木). 木 trinity is (卯,亥,未).
        Laopo's branches are 寅丑戌申 → no 卯/亥/未 → no match."""
        pillars = _pillars(('丙','寅'), ('辛','丑'), ('甲','戌'), ('壬','申'))
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['factors']['sanheCredit'] == 0.0
        # Score must remain at the documented 20.6
        assert result['score'] == pytest.approx(20.6, abs=0.1)
        assert result['classification'] == 'very_weak'
