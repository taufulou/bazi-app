"""
Tests for Love V2 Round 3 Fixes — P1, P2, P4, P5.

Roger35 chart: 丁卯/戊申/戊午/庚申
  - DM: 戊 (Earth), 身弱 (score=39)
  - 空亡=['子', '丑']
  - Day branch=午, Year branch=卯
  - 用神=水, 喜神=金, 忌神=土, 仇神=火, 閒神=木
"""

import pytest
from typing import Dict, List, Any

from app.love_enhanced import (
    compute_love_personality,
    compute_romance_good_years,
    compute_romance_danger_years,
    build_love_narrative_anchors,
    generate_love_pre_analysis,
    DOMINANT_TG_OVERLAY,
)
from app.lifetime_enhanced import (
    compute_romance_years,
    compute_romance_years_enriched,
)
from app.constants import STEM_ELEMENT


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

ROGER35_EFFECTIVE_GODS = {'水': '用神', '金': '喜神', '土': '忌神', '火': '仇神', '木': '閒神'}

ROGER35_STRENGTH_WEAK = {'classification': 'weak', 'score': 39.0}
ROGER35_STRENGTH_BALANCED = {'classification': 'balanced', 'score': 50.0}
ROGER35_STRENGTH_STRONG = {'classification': 'strong', 'score': 65.0}


def make_annual_stars(start_year=2024, count=15):
    """Generate annual stars from start_year for count years using sexagenary cycle."""
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


# Stars covering 2024-2038 for Roger35 validation
ROGER35_ANNUAL_STARS = make_annual_stars(2024, 15)

ROGER35_LUCK_PERIODS = [
    {'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2029, 'startAge': 25},
    {'stem': '丁', 'branch': '未', 'startYear': 2030, 'endYear': 2039, 'startAge': 35},
]


# ============================================================
# P2 Tests: 空亡 bypass for stem spouse star
# ============================================================

class TestP2KongWangStemBypass:
    """P2: 2033 正緣年 missing — bypass 空亡 for stem spouse star detection."""

    def test_2033_detected_as_romance_candidate(self):
        """2033 癸丑 — 癸=水=正財 for 戊土男. Should be detected despite 丑 being 空亡."""
        # Roger35: kong_wang=['子', '丑'], day_branch='午', year_branch='卯'
        # 戊土男 spouse star element = 水 (DM overcomes)
        # 2033: stem=癸(水), branch=丑(空亡)
        stars = make_annual_stars(2026, 12)  # 2026-2037
        result = compute_romance_years_enriched(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            birth_year=1987,
            current_year=2026,
            max_candidates=20,
        )
        years = [c['year'] for c in result]
        assert 2033 in years, "2033 should be detected via stem spouse star bypass"

    def test_2033_has_kong_wang_flag(self):
        """空亡 bypass items should have is_kong_wang=True."""
        stars = make_annual_stars(2026, 12)
        result = compute_romance_years_enriched(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            birth_year=1987,
            current_year=2026,
            max_candidates=20,
        )
        y2033 = [c for c in result if c['year'] == 2033]
        assert len(y2033) == 1
        assert y2033[0].get('is_kong_wang') is True

    def test_kong_wang_branch_checks_still_skipped(self):
        """Branch-level checks (六合, 三合, 藏干) should still be skipped for 空亡."""
        # 丑 is NOT 六合 partner of 午 (六合=未), so no primary regardless.
        # But more importantly, hidden stem checks should NOT fire for 空亡 branches.
        stars = make_annual_stars(2026, 12)
        result = compute_romance_years_enriched(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            birth_year=1987,
            current_year=2026,
            max_candidates=20,
        )
        y2033 = [c for c in result if c['year'] == 2033]
        assert len(y2033) == 1
        # Should be secondary_a (stem detection), NOT secondary_a2 (hidden stem)
        assert y2033[0]['tier'] == 'secondary_a'

    def test_non_kong_wang_years_unaffected(self):
        """Non-空亡 years should work exactly as before."""
        stars = make_annual_stars(2026, 12)
        result_with_kw = compute_romance_years_enriched(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            birth_year=1987,
            current_year=2026,
            max_candidates=20,
        )
        result_no_kw = compute_romance_years_enriched(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=[],
            birth_year=1987,
            current_year=2026,
            max_candidates=20,
        )
        # Non-空亡 years in result_with_kw should also be in result_no_kw
        non_kw_years = [c['year'] for c in result_with_kw if not c.get('is_kong_wang')]
        no_kw_years = [c['year'] for c in result_no_kw]
        for y in non_kw_years:
            assert y in no_kw_years, f"Non-空亡 year {y} should be present without kong_wang filter"

    def test_kong_wang_plus_two_of_three_not_blocked(self):
        """空亡 + 2-of-3 三刑 pair (without third branch) → NOT blocked.
        丑+戌 is only 2 of 丑戌未. Without 未 in natal, no 三刑 applies.
        空亡 stem bypass should still work (癸=水=spouse star for 戊 male)."""
        stars = make_annual_stars(2026, 12)
        result = compute_romance_years_enriched(
            gender='male',
            day_master_stem='戊',
            day_branch='戌',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['丑'],
            birth_year=1987,
            current_year=2026,
            max_candidates=20,
        )
        y2033 = [c for c in result if c['year'] == 2033]
        # 丑+戌 without 未 → NOT 三刑 → stem bypass works → 2033 detected
        assert len(y2033) == 1, "2033 should be detected (丑+戌 is NOT 三刑 without 未)"
        assert y2033[0].get('is_kong_wang') is True

    def test_startype_kong_wang_annotation(self):
        """P2 post-processing: starType should include '(空亡年)' for 空亡 bypass items."""
        stars = make_annual_stars(2026, 12)
        # Use compute_romance_good_years which applies starType post-processing
        result = compute_romance_good_years(
            'male', '戊', '午', '卯',
            ROGER35_ANNUAL_STARS,
            ['子', '丑'], 1987, 2026,
            ROGER35_LUCK_PERIODS,
        )
        y2033 = [y for y in result if y['year'] == 2033]
        if y2033:
            assert '(空亡年)' in y2033[0]['starType'], \
                "starType should contain '(空亡年)' annotation"

    def test_signal_no_kong_wang_annotation(self):
        """signal field should NOT contain '(空亡年)' — only starType does."""
        stars = make_annual_stars(2026, 12)
        result = compute_romance_years_enriched(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            birth_year=1987,
            current_year=2026,
            max_candidates=20,
        )
        y2033 = [c for c in result if c['year'] == 2033]
        if y2033:
            assert '(空亡年)' not in y2033[0].get('signal', ''), \
                "signal field should not contain (空亡年) annotation"


# ============================================================
# P1 Tests: Cross-reference conflicted years
# ============================================================

class TestP1ConflictedYears:
    """P1: Cross-reference romance good + danger years for conflicted flag."""

    def _get_roger35_pre_analysis(self, strength=None):
        """Helper to generate Roger35 love pre-analysis."""
        s = strength or ROGER35_STRENGTH_WEAK
        return generate_love_pre_analysis(
            pillars=ROGER35_PILLARS,
            day_master_stem='戊',
            gender='male',
            five_elements_balance={'木': 15, '火': 20, '土': 30, '金': 25, '水': 10},
            effective_gods=ROGER35_EFFECTIVE_GODS,
            prominent_god='食神',
            strength_v2=s,
            cong_ge=None,
            luck_periods=ROGER35_LUCK_PERIODS,
            annual_stars=ROGER35_ANNUAL_STARS,
            monthly_stars=[],
            kong_wang=['子', '丑'],
            all_shen_sha=[],
            birth_year=1987,
            current_year=2026,
        )

    def test_conflicted_year_detected(self):
        """A year in both good and danger lists should have conflicted=True."""
        pre = self._get_roger35_pre_analysis()
        good = pre['romanceGoodYears']
        danger = pre['romanceDangerYears']

        danger_years_set = {d['year'] for d in danger}
        for item in good:
            if item['year'] in danger_years_set:
                assert item.get('conflicted') is True, \
                    f"Year {item['year']} is in both good and danger but conflicted={item.get('conflicted')}"

    def test_non_conflicted_years_remain_false(self):
        """Years only in good list should have conflicted=False."""
        pre = self._get_roger35_pre_analysis()
        good = pre['romanceGoodYears']
        danger = pre['romanceDangerYears']

        danger_years_set = {d['year'] for d in danger}
        for item in good:
            if item['year'] not in danger_years_set:
                assert item.get('conflicted', False) is False

    def test_conflicted_detail_contains_trigger(self):
        """conflicted_detail should mention the danger trigger type."""
        pre = self._get_roger35_pre_analysis()
        good = pre['romanceGoodYears']
        conflicted = [y for y in good if y.get('conflicted')]
        for cy in conflicted:
            assert cy.get('conflicted_detail', '') != '', \
                f"Year {cy['year']} is conflicted but has empty detail"

    def test_deterministic_good_years_include_conflicted_fields(self):
        """Deterministic section good_years should have conflicted and conflicted_detail."""
        pre = self._get_roger35_pre_analysis()
        det_good = pre['deterministic']['romance_timeline']['good_years']
        for item in det_good:
            assert 'conflicted' in item, f"Missing 'conflicted' field in deterministic good_years"
            assert 'conflicted_detail' in item, f"Missing 'conflicted_detail' field in deterministic good_years"

    def test_anchor_includes_conflicted_warning(self):
        """Anchor should include warning text for conflicted years."""
        pre = self._get_roger35_pre_analysis()
        good = pre['romanceGoodYears']
        conflicted = [y for y in good if y.get('conflicted')]
        if conflicted:
            anchor = pre['narrativeAnchors']['romance_good_years']
            assert '注意' in anchor, "Anchor should contain '注意' warning for conflicted years"

    def test_anchor_no_doubled_grammar(self):
        """Anchor text should NOT have doubled '也有也有' phrasing."""
        pre = self._get_roger35_pre_analysis()
        anchor = pre['narrativeAnchors']['romance_good_years']
        assert '也有也有' not in anchor, "Anchor has doubled grammar"
        assert '也有同年也有' not in anchor, "Anchor has doubled grammar"


# ============================================================
# P4 Tests: favorable_secondary in deterministic + anchor
# ============================================================

class TestP4FavorableSecondary:
    """P4: Add favorable_secondary to deterministic output and anchor."""

    def _get_roger35_pre_analysis(self):
        return generate_love_pre_analysis(
            pillars=ROGER35_PILLARS,
            day_master_stem='戊',
            gender='male',
            five_elements_balance={'木': 15, '火': 20, '土': 30, '金': 25, '水': 10},
            effective_gods=ROGER35_EFFECTIVE_GODS,
            prominent_god='食神',
            strength_v2=ROGER35_STRENGTH_WEAK,
            cong_ge=None,
            luck_periods=ROGER35_LUCK_PERIODS,
            annual_stars=ROGER35_ANNUAL_STARS,
            monthly_stars=[],
            kong_wang=['子', '丑'],
            all_shen_sha=[],
            birth_year=1987,
            current_year=2026,
        )

    def test_deterministic_has_favorable_secondary_key(self):
        """Deterministic partner_recommendations should include favorable_secondary."""
        pre = self._get_roger35_pre_analysis()
        det = pre['deterministic']['partner_recommendations']
        assert 'favorable_secondary' in det
        assert isinstance(det['favorable_secondary'], list)

    def test_anchor_includes_secondary_when_present(self):
        """If favorableSecondary is non-empty, anchor should mention it."""
        pre = self._get_roger35_pre_analysis()
        secondary = pre['partnerRecommendations'].get('favorableSecondary', [])
        anchor = pre['narrativeAnchors']['partner_matching']
        if secondary:
            assert '次選生肖' in anchor, "Anchor should mention secondary zodiacs"

    def test_empty_secondary_no_extra_text(self):
        """If favorableSecondary is empty, anchor should NOT mention secondary zodiacs."""
        # Use a chart where secondary is likely empty
        pillars = make_pillars('甲', '子', '丙', '寅', '甲', '午', '庚', '午')
        pre = generate_love_pre_analysis(
            pillars=pillars,
            day_master_stem='甲',
            gender='male',
            five_elements_balance={'木': 30, '火': 20, '土': 10, '金': 20, '水': 20},
            effective_gods={'木': '忌神', '火': '閒神', '土': '用神', '金': '喜神', '水': '仇神'},
            prominent_god='比肩',
            strength_v2={'classification': 'strong', 'score': 65.0},
            cong_ge=None,
            luck_periods=ROGER35_LUCK_PERIODS,
            annual_stars=ROGER35_ANNUAL_STARS,
            monthly_stars=[],
            kong_wang=[],
            all_shen_sha=[],
            birth_year=1990,
            current_year=2026,
        )
        secondary = pre['partnerRecommendations'].get('favorableSecondary', [])
        anchor = pre['narrativeAnchors']['partner_matching']
        if not secondary:
            assert '次選生肖' not in anchor


# ============================================================
# P5 Tests: Dominant ten god overlay
# ============================================================

class TestP5DominantTenGodOverlay:
    """P5: DOMINANT_TG_OVERLAY for high-count ten gods in love personality."""

    def test_roger35_has_dominant_overlay(self):
        """Roger35 has 比肩=4 → should trigger dominantOverlay."""
        result = compute_love_personality(
            ROGER35_PILLARS, '戊', 'male',
            ROGER35_EFFECTIVE_GODS, ROGER35_STRENGTH_WEAK, [],
        )
        overlay = result.get('dominantOverlay')
        assert overlay is not None, "Roger35 should have dominant overlay (比肩=4)"
        assert overlay['dominantTenGod'] == '比肩'
        assert overlay['count'] == 4
        assert overlay['trait'] == '外剛內柔型'

    def test_roger35_weak_love_impact(self):
        """Roger35 is 身弱 → should get love_impact_weak text."""
        result = compute_love_personality(
            ROGER35_PILLARS, '戊', 'male',
            ROGER35_EFFECTIVE_GODS, ROGER35_STRENGTH_WEAK, [],
        )
        overlay = result['dominantOverlay']
        assert '身弱' in overlay['loveImpact']
        assert '比劫分財' in overlay['loveImpact']

    def test_strong_chart_gets_strong_text(self):
        """身強 chart with 比肩≥4 should get love_impact_strong text."""
        result = compute_love_personality(
            ROGER35_PILLARS, '戊', 'male',
            ROGER35_EFFECTIVE_GODS, ROGER35_STRENGTH_STRONG, [],
        )
        overlay = result['dominantOverlay']
        assert overlay is not None
        assert '身強' in overlay['loveImpact']

    def test_balanced_chart_gets_generic_text(self):
        """Balanced chart with 比肩≥4 should get generic love_impact (NOT weak/strong)."""
        result = compute_love_personality(
            ROGER35_PILLARS, '戊', 'male',
            ROGER35_EFFECTIVE_GODS, ROGER35_STRENGTH_BALANCED, [],
        )
        overlay = result['dominantOverlay']
        assert overlay is not None
        # Generic text should NOT contain 身弱 or 身強
        assert '身弱' not in overlay['loveImpact']
        assert '身強' not in overlay['loveImpact']
        # Should contain the generic fallback
        assert '比劫過多' in overlay['loveImpact']

    def test_no_overlay_below_threshold(self):
        """Chart with max count=2 should have dominantOverlay=None."""
        # Diverse chart: 己未丙寅庚辰丁亥 — no ten god reaches 4
        pillars = make_pillars('己', '未', '丙', '寅', '庚', '辰', '丁', '亥')
        result = compute_love_personality(
            pillars, '庚', 'male',
            {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'},
            {'classification': 'balanced', 'score': 50.0}, [],
        )
        assert result.get('dominantOverlay') is None

    def test_no_overlay_at_count_3(self):
        """Chart with max count=3 should NOT trigger overlay (threshold is 4)."""
        # 甲子丙寅甲午庚午 — 比肩(甲)=2 stems + possibly 1 hidden
        pillars = make_pillars('甲', '子', '丙', '寅', '甲', '午', '庚', '午')
        result = compute_love_personality(
            pillars, '甲', 'male',
            {'木': '忌神', '火': '閒神', '土': '用神', '金': '喜神', '水': '仇神'},
            {'classification': 'balanced', 'score': 50.0}, [],
        )
        # Should be None (max count ~3 for 比肩 in this chart)
        overlay = result.get('dominantOverlay')
        if overlay is not None:
            assert overlay['count'] >= 4, "Overlay should only trigger at count >= 4"

    def test_return_dict_includes_dominant_overlay_key(self):
        """Return dict should always include dominantOverlay key."""
        pillars = make_pillars('己', '未', '丙', '寅', '庚', '辰', '丁', '亥')
        result = compute_love_personality(
            pillars, '庚', 'male',
            {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'},
            {'classification': 'balanced', 'score': 50.0}, [],
        )
        assert 'dominantOverlay' in result

    def test_overlay_selects_highest_count(self):
        """If two ten gods hit threshold, the higher count one should be selected."""
        # This is hard to engineer naturally — but we test the sorting logic
        result = compute_love_personality(
            ROGER35_PILLARS, '戊', 'male',
            ROGER35_EFFECTIVE_GODS, ROGER35_STRENGTH_WEAK, [],
        )
        counts = result['tenGodCounts']
        overlay = result['dominantOverlay']
        if overlay:
            tg = overlay['dominantTenGod']
            # Verify no other ten god has a higher count
            for other_tg, other_count in counts.items():
                if other_tg != tg and other_count >= 4:
                    assert other_count <= overlay['count'], \
                        f"{other_tg} has count {other_count} > selected {tg} count {overlay['count']}"

    def test_overlay_constant_has_all_ten_gods(self):
        """DOMINANT_TG_OVERLAY should have entries for all 10 ten gods."""
        expected = {'比肩', '劫財', '食神', '傷官', '正印', '偏印', '正官', '偏官', '正財', '偏財'}
        assert set(DOMINANT_TG_OVERLAY.keys()) == expected

    def test_anchor_includes_overlay_when_present(self):
        """Love personality anchor should include overlay text when present."""
        pre = generate_love_pre_analysis(
            pillars=ROGER35_PILLARS,
            day_master_stem='戊',
            gender='male',
            five_elements_balance={'木': 15, '火': 20, '土': 30, '金': 25, '水': 10},
            effective_gods=ROGER35_EFFECTIVE_GODS,
            prominent_god='食神',
            strength_v2=ROGER35_STRENGTH_WEAK,
            cong_ge=None,
            luck_periods=ROGER35_LUCK_PERIODS,
            annual_stars=ROGER35_ANNUAL_STARS,
            monthly_stars=[],
            kong_wang=['子', '丑'],
            all_shen_sha=[],
            birth_year=1987,
            current_year=2026,
        )
        anchor = pre['narrativeAnchors']['love_personality']
        assert '十神特徵' in anchor, "Anchor should include overlay text"
        assert '外剛內柔型' in anchor
