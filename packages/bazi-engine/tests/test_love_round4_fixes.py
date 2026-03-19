"""
Tests for Love V2 Round 4 Fixes — P6 (空亡 danger/change years) + Topic 5 (significance).

Roger35 chart: 丁卯/戊申/戊午/庚申
  - DM: 戊 (Earth), 身弱 (score=39)
  - 空亡=['子', '丑']
  - Day branch=午, Year branch=卯
  - CLASH_LOOKUP['午'] = '子' → 2032 (壬子) = 子午六沖
  - HARM_LOOKUP['午'] = '丑' → 2033 (癸丑) = 丑午六害
"""

import pytest
from typing import Dict, List, Any

from app.love_enhanced import (
    compute_romance_danger_years,
    compute_marriage_change_years,
    compute_romance_good_years,
    build_love_narrative_anchors,
    generate_love_pre_analysis,
    CHANGE_TYPE_SIGNIFICANCE,
)
from app.branch_relationships import CLASH_LOOKUP
from app.constants import HARM_LOOKUP


# ============================================================
# Shared fixtures
# ============================================================

def make_pillars(year_s, year_b, month_s, month_b, day_s, day_b, hour_s, hour_b):
    return {
        'year': {'stem': year_s, 'branch': year_b},
        'month': {'stem': month_s, 'branch': month_b},
        'day': {'stem': day_s, 'branch': day_b},
        'hour': {'stem': hour_s, 'branch': hour_b},
    }


# Roger35: 丁卯 戊申 戊午 庚申
ROGER35_PILLARS = make_pillars('丁', '卯', '戊', '申', '戊', '午', '庚', '申')
ROGER35_KONG_WANG = ['子', '丑']
ROGER35_DAY_BRANCH = '午'
ROGER35_EFFECTIVE_GODS = {'水': '用神', '金': '喜神', '土': '忌神', '火': '仇神', '木': '閒神'}
ROGER35_STRENGTH = {'classification': 'weak', 'score': 39.0}

ROGER35_LUCK_PERIODS = [
    {'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2029, 'startAge': 25},
    {'stem': '丁', 'branch': '未', 'startYear': 2030, 'endYear': 2039, 'startAge': 35},
]


def make_annual_stars(start_year=2024, count=15):
    """Generate annual stars using sexagenary cycle."""
    branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
    stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
    result = []
    for i in range(count):
        y = start_year + i
        result.append({
            'year': y,
            'stem': stems[(y - 4) % 10],
            'branch': branches[(y - 4) % 12],
        })
    return result


ROGER35_ANNUAL_STARS = make_annual_stars(2024, 15)


# ============================================================
# P6 Tests: 空亡 not blanket-skipped in danger + change years
# ============================================================

class TestP6KongWangDangerYears:
    """P6: 空亡 branches should be detected with reduced severity, not blanket-skipped."""

    # --- Danger years: core behavior ---

    def test_kong_wang_branch_not_skipped_in_danger_years(self):
        """空亡 branch is detected as danger year (not skipped)."""
        # day_branch='午', kong_wang=['子']. 子午六沖.
        stars = [{'year': 2032, 'stem': '壬', 'branch': '子'}]
        pillars = ROGER35_PILLARS
        result = compute_romance_danger_years(pillars, '戊', '午', stars, ['子', '丑'], 2026)
        assert len(result) == 1
        assert result[0]['year'] == 2032

    def test_kong_wang_severity_reduced_by_20pct(self):
        """空亡 六沖 severity reduced from 90 to 72 (round(90*0.8))."""
        stars = [{'year': 2032, 'stem': '壬', 'branch': '子'}]
        result = compute_romance_danger_years(ROGER35_PILLARS, '戊', '午', stars, ['子', '丑'], 2026)
        assert result[0]['maxSeverity'] == round(90 * 0.8)

    def test_kong_wang_flag_present(self):
        """Entry has isKongWang: True."""
        stars = [{'year': 2032, 'stem': '壬', 'branch': '子'}]
        result = compute_romance_danger_years(ROGER35_PILLARS, '戊', '午', stars, ['子', '丑'], 2026)
        assert result[0]['isKongWang'] is True

    def test_non_kong_wang_severity_unchanged(self):
        """Non-空亡 year (2026 午午自刑) keeps original severity 60."""
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = compute_romance_danger_years(ROGER35_PILLARS, '戊', '午', stars, [], 2026)
        assert result[0]['maxSeverity'] == 60
        assert 'isKongWang' not in result[0]

    def test_kong_wang_description_has_context(self):
        """六沖 trigger gets '逢沖填實'; 六害 trigger gets generic '空亡年'."""
        stars = make_annual_stars(2026, 12)
        result = compute_romance_danger_years(ROGER35_PILLARS, '戊', '午', stars, ['子', '丑'], 2026)
        # Find 2032 (六沖) and 2033 (六害)
        y2032 = next((d for d in result if d['year'] == 2032), None)
        y2033 = next((d for d in result if d['year'] == 2033), None)
        assert y2032 is not None, "2032 should be in danger years"
        assert '逢沖填實' in y2032['triggers'][0]['description']
        assert y2033 is not None, "2033 should be in danger years"
        assert '空亡年' in y2033['triggers'][0]['description']
        assert '逢沖填實' not in y2033['triggers'][0]['description']

    def test_roger35_2032_liuchong_detected(self):
        """2032 壬子 has 子午六沖 trigger for Roger35."""
        stars = make_annual_stars(2026, 12)
        result = compute_romance_danger_years(ROGER35_PILLARS, '戊', '午', stars, ROGER35_KONG_WANG, 2026)
        y2032 = next((d for d in result if d['year'] == 2032), None)
        assert y2032 is not None
        assert y2032['primaryTrigger'] == '六沖'

    def test_roger35_2033_liuhai_detected(self):
        """2033 癸丑 has 丑午六害 trigger for Roger35."""
        stars = make_annual_stars(2026, 12)
        result = compute_romance_danger_years(ROGER35_PILLARS, '戊', '午', stars, ROGER35_KONG_WANG, 2026)
        y2033 = next((d for d in result if d['year'] == 2033), None)
        assert y2033 is not None
        assert y2033['primaryTrigger'] == '六害'

    # --- Edge case: 自刑 + 空亡 simultaneously ---

    def test_self_punishment_plus_kong_wang(self):
        """day_branch='辰', kong_wang=['辰','巳'], annual_branch='辰' → 自刑 + 空亡."""
        stars = [{'year': 2026, 'stem': '丙', 'branch': '辰'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '辰', stars, ['辰', '巳'], 2026)
        assert len(result) == 1
        assert result[0]['isKongWang'] is True
        assert result[0]['maxSeverity'] == round(60 * 0.8)  # 48
        assert result[0]['primaryTrigger'] == '自刑'

    # --- Marriage change years ---

    def test_kong_wang_branch_not_skipped_in_change_years(self):
        """空亡 branch detected as change year."""
        stars = [{'year': 2032, 'stem': '壬', 'branch': '子'}]
        result = compute_marriage_change_years('午', stars, ['子', '丑'], 2026)
        assert len(result) == 1
        assert result[0]['year'] == 2032

    def test_change_year_kong_wang_flag(self):
        """Change year entry has isKongWang: True."""
        stars = [{'year': 2032, 'stem': '壬', 'branch': '子'}]
        result = compute_marriage_change_years('午', stars, ['子', '丑'], 2026)
        assert result[0]['isKongWang'] is True

    def test_roger35_2032_change_liuchong(self):
        """2032 has 六沖 change type for Roger35."""
        stars = make_annual_stars(2026, 12)
        result = compute_marriage_change_years('午', stars, ROGER35_KONG_WANG, 2026)
        y2032 = next((c for c in result if c['year'] == 2032), None)
        assert y2032 is not None
        assert any(ch['type'] == '六沖' for ch in y2032['changes'])

    def test_roger35_2033_change_liuhai(self):
        """2033 has 六害 change type for Roger35."""
        stars = make_annual_stars(2026, 12)
        result = compute_marriage_change_years('午', stars, ROGER35_KONG_WANG, 2026)
        y2033 = next((c for c in result if c['year'] == 2033), None)
        assert y2033 is not None
        assert any(ch['type'] == '六害' for ch in y2033['changes'])

    # --- Cross-reference (P1 interaction with P6) ---

    def test_roger35_2032_conflicted_after_p6(self):
        """2032 in romance_good now has conflicted=True (六沖 danger detected via P6)."""
        stars = make_annual_stars(2024, 15)
        pre = generate_love_pre_analysis(
            pillars=ROGER35_PILLARS,
            day_master_stem='戊', gender='male',
            five_elements_balance={},
            effective_gods=ROGER35_EFFECTIVE_GODS,
            prominent_god='食神',
            strength_v2=ROGER35_STRENGTH,
            cong_ge=None,
            luck_periods=ROGER35_LUCK_PERIODS,
            annual_stars=stars, monthly_stars=[],
            kong_wang=ROGER35_KONG_WANG,
            all_shen_sha=[],
            birth_year=1990, current_year=2026,
        )
        good = pre['romanceGoodYears']
        y2032 = next((g for g in good if g['year'] == 2032), None)
        assert y2032 is not None, "2032 must be in romanceGoodYears (precondition)"
        assert y2032.get('conflicted') is True

    def test_roger35_2033_conflicted_after_p6(self):
        """2033 in romance_good now has conflicted=True (六害 danger detected via P6)."""
        stars = make_annual_stars(2024, 15)
        pre = generate_love_pre_analysis(
            pillars=ROGER35_PILLARS,
            day_master_stem='戊', gender='male',
            five_elements_balance={},
            effective_gods=ROGER35_EFFECTIVE_GODS,
            prominent_god='食神',
            strength_v2=ROGER35_STRENGTH,
            cong_ge=None,
            luck_periods=ROGER35_LUCK_PERIODS,
            annual_stars=stars, monthly_stars=[],
            kong_wang=ROGER35_KONG_WANG,
            all_shen_sha=[],
            birth_year=1990, current_year=2026,
        )
        good = pre['romanceGoodYears']
        y2033 = next((g for g in good if g['year'] == 2033), None)
        assert y2033 is not None, "2033 must be in romanceGoodYears (precondition)"
        assert y2033.get('conflicted') is True

    # --- Anchor ---

    def test_danger_anchor_includes_kong_wang_note(self):
        """Danger years anchor text includes '空亡' for 2032."""
        stars = make_annual_stars(2024, 15)
        pre = generate_love_pre_analysis(
            pillars=ROGER35_PILLARS,
            day_master_stem='戊', gender='male',
            five_elements_balance={},
            effective_gods=ROGER35_EFFECTIVE_GODS,
            prominent_god='食神',
            strength_v2=ROGER35_STRENGTH,
            cong_ge=None,
            luck_periods=ROGER35_LUCK_PERIODS,
            annual_stars=stars, monthly_stars=[],
            kong_wang=ROGER35_KONG_WANG,
            all_shen_sha=[],
            birth_year=1990, current_year=2026,
        )
        anchor = pre['narrativeAnchors']['romance_danger_years']
        assert '空亡' in anchor


# ============================================================
# Topic 5 Tests: Marriage change significance weights
# ============================================================

class TestTopic5ChangeSignificance:
    """Topic 5: significance/weight field on marriage change years (caution-only)."""

    def test_liuchong_significance_90(self):
        """六沖 change has significance 90."""
        stars = [{'year': 2026, 'stem': '丙', 'branch': '戌'}]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        liuchong = [c for c in result[0]['changes'] if c['type'] == '六沖']
        assert len(liuchong) == 1
        assert liuchong[0]['significance'] == 90

    def test_sanxing_significance_80(self):
        """三刑 change has significance 80."""
        # 寅巳刑 (無恩之刑)
        stars = [{'year': 2026, 'stem': '甲', 'branch': '寅'}]
        result = compute_marriage_change_years('巳', stars, [], 2026)
        sanxing = [c for c in result[0]['changes'] if c['type'] == '三刑']
        assert len(sanxing) == 1
        assert sanxing[0]['significance'] == 80

    def test_liuhai_significance_70(self):
        """六害 change has significance 70."""
        stars = [{'year': 2033, 'stem': '癸', 'branch': '丑'}]
        result = compute_marriage_change_years('午', stars, [], 2026)
        liuhai = [c for c in result[0]['changes'] if c['type'] == '六害']
        assert len(liuhai) == 1
        assert liuhai[0]['significance'] == 70

    def test_zixing_significance_60(self):
        """自刑 change has significance 60."""
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = compute_marriage_change_years('午', stars, [], 2026)
        zixing = [c for c in result[0]['changes'] if c['type'] == '自刑']
        assert len(zixing) == 1
        assert zixing[0]['significance'] == 60

    def test_max_significance_on_entry(self):
        """Entry maxSignificance = highest among changes."""
        stars = [{'year': 2032, 'stem': '壬', 'branch': '子'}]
        result = compute_marriage_change_years('午', stars, [], 2026)
        assert result[0]['maxSignificance'] == 90

    def test_primary_change_field(self):
        """Entry primaryChange = type of highest significance."""
        stars = [{'year': 2032, 'stem': '壬', 'branch': '子'}]
        result = compute_marriage_change_years('午', stars, [], 2026)
        assert result[0]['primaryChange'] == '六沖'

    def test_changes_sorted_by_significance(self):
        """Changes list sorted descending by significance."""
        stars = make_annual_stars(2026, 12)
        result = compute_marriage_change_years('午', stars, [], 2026)
        for entry in result:
            sigs = [c.get('significance', 0) for c in entry['changes']]
            assert sigs == sorted(sigs, reverse=True), f"Year {entry['year']} changes not sorted"

    def test_kong_wang_significance_reduced(self):
        """空亡 year's significance reduced by 20%."""
        stars = [{'year': 2032, 'stem': '壬', 'branch': '子'}]
        result = compute_marriage_change_years('午', stars, ['子', '丑'], 2026)
        assert result[0]['maxSignificance'] == round(90 * 0.8)  # 72
        assert result[0]['isKongWang'] is True

    def test_roger35_change_years_have_significance(self):
        """All Roger35 change years have significance field on each change."""
        stars = make_annual_stars(2024, 15)
        result = compute_marriage_change_years('午', stars, ROGER35_KONG_WANG, 2026)
        for entry in result:
            for ch in entry['changes']:
                assert 'significance' in ch, f"Year {entry['year']} change {ch['type']} missing significance"
            assert 'maxSignificance' in entry
            assert 'primaryChange' in entry

    def test_change_anchor_includes_significance_label(self):
        """Anchor text includes 高/中/低 label (no emojis)."""
        stars = make_annual_stars(2024, 15)
        pre = generate_love_pre_analysis(
            pillars=ROGER35_PILLARS,
            day_master_stem='戊', gender='male',
            five_elements_balance={},
            effective_gods=ROGER35_EFFECTIVE_GODS,
            prominent_god='食神',
            strength_v2=ROGER35_STRENGTH,
            cong_ge=None,
            luck_periods=ROGER35_LUCK_PERIODS,
            annual_stars=stars, monthly_stars=[],
            kong_wang=ROGER35_KONG_WANG,
            all_shen_sha=[],
            birth_year=1990, current_year=2026,
        )
        anchor = pre['narrativeAnchors']['marriage_change_years']
        # Should contain significance labels
        assert '影響' in anchor
        # Should not contain emojis
        assert '⚠️' not in anchor
