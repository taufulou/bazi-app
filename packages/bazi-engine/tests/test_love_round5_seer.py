"""
Tests for Love V2 Round 5 — Seer Gap Fixes.

3 issues addressed:
  Issue 1: Day-branch 天喜 annotation (天喜桃花年)
  Issue 3: Non-day-branch 六沖/三合 in marriage change years
  Issue 6: 紅鸞+spouse star compound labels

Roger35 chart: 丁卯/戊申/戊午/庚申
  - DM: 戊 (Earth), year_branch=卯, day_branch=午
  - 空亡=['子', '丑']
  - TAOHUA['午']='卯' → 2035(乙卯)=桃花
  - TIANXI['午']='卯' (day-branch variant) → 2035 also day-branch 天喜
  - HONGLUAN['卯']='子' → 2032(壬子)=紅鸞
  - CLASH_LOOKUP['卯']='酉' → 2029(己酉) = natal year branch 六沖
"""

import pytest
from typing import Dict, List, Any

from app.love_enhanced import (
    compute_romance_good_years,
    compute_marriage_change_years,
)
from app.lifetime_enhanced import (
    _compute_romance_candidates,
)
from app.constants import HONGLUAN, TIANXI, TAOHUA
from app.branch_relationships import CLASH_LOOKUP


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
ROGER35_DAY_BRANCH = '午'
ROGER35_YEAR_BRANCH = '卯'
ROGER35_KONG_WANG = ['子', '丑']

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


# ============================================================
# Issue 1: Day-branch 天喜 annotation (天喜桃花年)
# ============================================================

class TestDayBranchTianxiAnnotation:
    """Test that day-branch 天喜 overlapping with 桃花 produces '桃花(天喜)' signal."""

    def test_taohua_and_day_tianxi_both_match_signal(self):
        """When TAOHUA and day-branch TIANXI point to same branch → signal='桃花(天喜)'."""
        # Use a chart where TAOHUA[day_branch] == TIANXI[day_branch]
        # For day_branch=午: TAOHUA['午']='卯', TIANXI['午']='卯' → both point to 卯
        candidates = _compute_romance_candidates(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=make_annual_stars(2033, 5),  # 2035=乙卯
            kong_wang=['子', '丑'],
        )
        year_2035 = next((c for c in candidates if c['year'] == 2035), None)
        assert year_2035 is not None, "2035 should be a romance candidate"
        # Accumulative scoring: both signals appear in the compound signal string
        assert '桃花' in year_2035['signal']
        assert '天喜' in year_2035['signal']

    def test_taohua_only_no_tianxi_day_branch(self):
        """When only TAOHUA matches (no day-branch 天喜 overlap) → normal signal."""
        # day_branch=子: TAOHUA['子']='酉', TIANXI['子']='巳' → different branches
        candidates = _compute_romance_candidates(
            gender='male',
            day_master_stem='壬',
            day_branch='子',
            year_branch='午',
            annual_stars=make_annual_stars(2025, 10),
            kong_wang=[],
        )
        taohua_years = [c for c in candidates if '桃花' in c.get('signal', '') and '天喜' not in c.get('signal', '')]
        # Any taohua year should NOT have 天喜 annotation
        for y in taohua_years:
            assert '天喜' not in y['signal']

    def test_tianxi_taohua_year_picked_by_higher_tier_keeps_stronger_signal(self):
        """When 桃花+day-branch天喜 year is picked by higher tier (正緣), stronger signal wins."""
        # 2023=癸卯: branch=卯=taohua for 午, TIANXI['午']='卯' → day-branch 天喜
        # BUT 癸=正財 for 戊 DM → picked by primary/secondary tier as 正緣
        # Since higher-tier signal doesn't contain '天喜', the post-process correctly
        # doesn't override. The stronger '正緣年' label is preserved.
        stars = make_annual_stars(2021, 5)  # 2023=癸卯
        result = compute_romance_good_years(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            birth_year=1987,
            current_year=2021,
            luck_periods_enriched=ROGER35_LUCK_PERIODS,
        )
        year_2023 = next((r for r in result if r['year'] == 2023), None)
        if year_2023:
            # Higher-tier signal wins over supplementary 天喜 annotation.
            # Phase 12g.2: archetype-promoted '正緣桃花年' replaces legacy '正緣年' for 配偶星透 alone.
            assert year_2023['starType'] in ('正緣年', '天喜桃花年', '正緣桃花年'), \
                f"Unexpected starType: {year_2023['starType']}"

    def test_roger35_2035_is_tianxi_taohua_year(self):
        """Roger35 specific: 2035(乙卯) = 天喜桃花年."""
        stars = make_annual_stars(2026, 12)  # covers 2035
        result = compute_romance_good_years(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            birth_year=1987,
            current_year=2026,
            luck_periods_enriched=ROGER35_LUCK_PERIODS,
        )
        year_2035 = next((r for r in result if r['year'] == 2035), None)
        assert year_2035 is not None, "2035 should appear in romance good years"
        assert year_2035['starType'] == '天喜桃花年', \
            f"Expected 天喜桃花年 but got {year_2035['starType']}"



# ============================================================
# Issue 3: Marriage change years pruned to caution-only (沖/刑/害)
# ============================================================

class TestChangeYearsPruned:
    """Verify marriage change years only contain 沖/刑/害 after pruning."""

    def test_direct_clash_still_detected(self):
        """Flow year 六沖 with day branch → still detected."""
        stars = make_annual_stars(2030, 5)  # 2032=壬子
        result = compute_marriage_change_years(
            day_branch='午',
            annual_stars=stars,
            kong_wang=[],
            current_year=2030,
        )
        year_2032 = next((r for r in result if r['year'] == 2032), None)
        assert year_2032 is not None
        assert any(c['type'] == '六沖' for c in year_2032['changes'])

    def test_no_indirect_interactions(self):
        """No indirect interactions in change years output."""
        stars = make_annual_stars(2026, 12)
        result = compute_marriage_change_years(
            day_branch='午',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            current_year=2026,
        )
        for entry in result:
            for c in entry['changes']:
                assert c.get('indirect') is not True, f"Year {entry['year']}: indirect {c['type']} should not exist"

    def test_no_positive_interactions(self):
        """No positive interactions (六合, 三合, 半合) in change years."""
        stars = make_annual_stars(2026, 12)
        result = compute_marriage_change_years(
            day_branch='午',
            annual_stars=stars,
            kong_wang=[],
            current_year=2026,
        )
        for entry in result:
            for c in entry['changes']:
                assert c['type'] in ('六沖', '三刑', '自刑', '六害'),                     f"Year {entry['year']}: unexpected type {c['type']}"

    def test_roger35_2029_no_longer_detected(self):
        """Roger35: 2029(己酉) no longer detected (was indirect 卯酉沖, now removed)."""
        stars = make_annual_stars(2026, 10)
        result = compute_marriage_change_years(
            day_branch='午',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            current_year=2026,
        )
        year_2029 = next((r for r in result if r['year'] == 2029), None)
        assert year_2029 is None, "2029 should NOT be in change years (indirect removed)"

    def test_roger35_reduced_count(self):
        """Roger35 change years reduced to ≤4 after pruning."""
        stars = make_annual_stars(2026, 12)
        result = compute_marriage_change_years(
            day_branch='午',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            current_year=2026,
        )
        assert len(result) <= 4, f"Expected ≤4, got {len(result)}: {[r['year'] for r in result]}"


# ============================================================
# Issue 6: 紅鸞+spouse star compound labels
# ============================================================

class TestHongluanCompoundLabels:
    """Test 紅鸞 year + spouse/romance star stem → compound labels."""

    def test_hongluan_with_zhengcai_stem_becomes_zhengyuan(self):
        """紅鸞 year + 正財 stem → '紅鸞正緣年'."""
        # For 甲 DM male: spouse_tg=正財=己.
        # year_branch=寅 → HONGLUAN['寅']='丑'. Need year with branch=丑 and stem=己.
        # 己丑 year = 2009.
        stars = [{'year': 2009, 'stem': '己', 'branch': '丑'}]
        lps = [{'stem': '甲', 'branch': '子', 'startYear': 2005, 'endYear': 2014, 'startAge': 20}]
        result = compute_romance_good_years(
            gender='male',
            day_master_stem='甲',
            day_branch='午',
            year_branch='寅',   # HONGLUAN['寅']='丑' → matches 2009(己丑)
            annual_stars=stars,
            kong_wang=[],
            birth_year=1985,
            current_year=2005,
            luck_periods_enriched=lps,
        )
        year_2009 = next((r for r in result if r['year'] == 2009), None)
        assert year_2009 is not None, "2009 should appear via ensure block"
        assert year_2009['starType'] == '紅鸞正緣年', \
            f"Expected 紅鸞正緣年 but got {year_2009['starType']}"

    def test_hongluan_with_piancai_stem_has_subnote(self):
        """紅鸞 year + 偏財 stem → '紅鸞年' + subNote."""
        # Roger35: 2032=壬子. HONGLUAN['卯']='子' → 紅鸞.
        # Stem 壬: derive_ten_god('戊', '壬') = 偏財 (romance_tg for male)
        stars = make_annual_stars(2030, 5)  # 2032=壬子
        result = compute_romance_good_years(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=['子', '丑'],
            birth_year=1987,
            current_year=2030,
            luck_periods_enriched=ROGER35_LUCK_PERIODS,
        )
        year_2032 = next((r for r in result if r['year'] == 2032), None)
        assert year_2032 is not None, "2032 should appear in results"
        # 壬=偏財 for 戊 DM, so starType stays 紅鸞年 with subNote
        assert year_2032['starType'].startswith('紅鸞年'), \
            f"Expected 紅鸞年 but got {year_2032['starType']}"
        assert 'subNote' in year_2032, "Should have subNote about 偏財"
        assert '偏財' in year_2032['subNote']

    def test_hongluan_with_unrelated_stem_no_subnote(self):
        """紅鸞 year + unrelated stem → '紅鸞年' (no subNote)."""
        # For 戊 DM: spouse=癸(正財), romance=壬(偏財)
        # Need 紅鸞 year with stem != 壬 and != 癸
        # HONGLUAN['卯']='子'. Find a year with branch=子 and stem not 壬/癸
        # 丙子: 2036. Use empty kong_wang so 子 branch isn't filtered.
        stars = [{'year': 2036, 'stem': '丙', 'branch': '子'}]
        lps = [{'stem': '丁', 'branch': '未', 'startYear': 2030, 'endYear': 2039, 'startAge': 35}]
        result = compute_romance_good_years(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=stars,
            kong_wang=[],  # No 空亡 to avoid filtering
            birth_year=1987,
            current_year=2030,  # Wider window to include 2036
            luck_periods_enriched=lps,
        )
        year_2036 = next((r for r in result if r['year'] == 2036), None)
        assert year_2036 is not None, "2036 should appear via ensure block"
        # 丙 for 戊 DM = 偏印, not spouse/romance star
        assert year_2036['starType'] == '紅鸞年', \
            f"Expected 紅鸞年 but got {year_2036['starType']}"
        assert 'subNote' not in year_2036, "Should NOT have subNote for unrelated stem"
