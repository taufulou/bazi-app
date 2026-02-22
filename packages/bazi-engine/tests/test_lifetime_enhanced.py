"""
Tests for Lifetime Enhanced Insights — Deterministic computations for V2 八字終身運

Uses Roger8 chart data: 1987-09-06 16:11 male (丁卯/戊申/戊午/庚申)
  - DM: 戊 (Earth), 食神格
  - Strength: 40.6 (neutral)
  - 用神=水, 喜神=金, 忌神=土, 仇神=火
  - 日支=午, 年支=卯
  - 空亡=['子', '丑']
"""

import pytest
from app.calculator import calculate_bazi
from app.lifetime_enhanced import (
    BRANCH_ZODIAC,
    ELEMENT_DIRECTION,
    ELEMENT_FAVORABLE_INVESTMENTS,
    ELEMENT_INDUSTRIES_DETAILED,
    ELEMENT_SANHE_BRANCHES,
    ELEMENT_UNFAVORABLE_INVESTMENTS,
    TEN_GOD_WORK_STYLE,
    _check_sanxing_pair,
    build_boss_compatibility,
    build_children_insights,
    build_parents_insights,
    build_pattern_narrative,
    compute_benefactors,
    compute_parent_health_years,
    compute_partner_zodiacs,
    compute_romance_years,
    enrich_luck_periods,
    generate_lifetime_enhanced_insights,
)


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def roger8_chart():
    """Roger8 chart: 1987-09-06 16:11 male (丁卯/戊申/戊午/庚申)."""
    return calculate_bazi(
        '1987-09-06', '16:11', '台北市', 'Asia/Taipei', 'male',
        reading_type='LIFETIME',
    )


@pytest.fixture
def roger8_enhanced(roger8_chart):
    """Lifetime enhanced insights for Roger8."""
    return roger8_chart.get('lifetimeEnhancedInsights')


@pytest.fixture
def roger8_pillars(roger8_chart):
    return roger8_chart['fourPillars']


@pytest.fixture
def roger8_pre_analysis(roger8_chart):
    return roger8_chart['preAnalysis']


# ============================================================
# Lookup Table Tests
# ============================================================

class TestLookupTables:
    """Verify lookup tables are complete and correct."""

    def test_element_favorable_investments_all_5_elements(self):
        for el in ['木', '火', '土', '金', '水']:
            assert el in ELEMENT_FAVORABLE_INVESTMENTS
            assert len(ELEMENT_FAVORABLE_INVESTMENTS[el]) >= 3

    def test_element_unfavorable_investments_all_5_elements(self):
        for el in ['木', '火', '土', '金', '水']:
            assert el in ELEMENT_UNFAVORABLE_INVESTMENTS
            assert len(ELEMENT_UNFAVORABLE_INVESTMENTS[el]) >= 2

    def test_element_industries_detailed_5_categories_per_element(self):
        for el in ['木', '火', '土', '金', '水']:
            assert el in ELEMENT_INDUSTRIES_DETAILED
            categories = ELEMENT_INDUSTRIES_DETAILED[el]
            assert len(categories) == 5
            for cat in categories:
                assert 'anchor' in cat
                assert 'category' in cat
                assert 'industries' in cat
                assert len(cat['industries']) >= 3

    def test_element_directions(self):
        assert ELEMENT_DIRECTION['木'] == '東方'
        assert ELEMENT_DIRECTION['火'] == '南方'
        assert ELEMENT_DIRECTION['土'] == '中央'
        assert ELEMENT_DIRECTION['金'] == '西方'
        assert ELEMENT_DIRECTION['水'] == '北方'

    def test_branch_zodiac_12_complete(self):
        assert len(BRANCH_ZODIAC) == 12
        assert BRANCH_ZODIAC['子'] == '鼠'
        assert BRANCH_ZODIAC['午'] == '馬'
        assert BRANCH_ZODIAC['卯'] == '兔'

    def test_element_sanhe_branches(self):
        assert ELEMENT_SANHE_BRANCHES['水'] == ['申', '子', '辰']
        assert ELEMENT_SANHE_BRANCHES['木'] == ['亥', '卯', '未']
        assert ELEMENT_SANHE_BRANCHES['火'] == ['寅', '午', '戌']
        assert ELEMENT_SANHE_BRANCHES['金'] == ['巳', '酉', '丑']

    def test_boss_compatibility_all_10_ten_gods(self):
        for tg in ['正官', '偏官', '正財', '偏財', '食神', '傷官', '正印', '偏印', '比肩', '劫財']:
            assert tg in TEN_GOD_WORK_STYLE
            style = TEN_GOD_WORK_STYLE[tg]
            assert 'dominantStyle' in style
            assert 'idealBossType' in style
            assert 'workplaceStrengths' in style
            assert 'workplaceWarnings' in style


# ============================================================
# 三刑 Helper Test
# ============================================================

class TestSanxingPair:
    def test_yin_si_pair(self):
        """寅巳 is a partial 三刑 (無恩之刑)."""
        assert _check_sanxing_pair('寅', '巳') is True

    def test_si_shen_pair(self):
        """巳申 is a partial 三刑 (無恩之刑)."""
        assert _check_sanxing_pair('巳', '申') is True

    def test_zi_mao_pair(self):
        """子卯 is 無禮之刑."""
        assert _check_sanxing_pair('子', '卯') is True

    def test_chou_xu_pair(self):
        """丑戌 is a partial 三刑 (持勢之刑)."""
        assert _check_sanxing_pair('丑', '戌') is True

    def test_no_sanxing(self):
        """子午 is 六沖, not 三刑."""
        assert _check_sanxing_pair('子', '午') is False

    def test_same_branch(self):
        """Same branch is not 三刑 (except self-punishment, but that's single)."""
        assert _check_sanxing_pair('午', '午') is False


# ============================================================
# Pattern Narrative Tests
# ============================================================

class TestPatternNarrative:
    def test_roger8_pattern_name(self, roger8_enhanced):
        """Roger8 should be 食神格."""
        assert roger8_enhanced['patternNarrative']['patternName'] == '食神格'

    def test_roger8_pattern_logic_contains_month(self, roger8_enhanced):
        """Pattern logic should reference month branch 申."""
        logic = roger8_enhanced['patternNarrative']['patternLogic']
        assert '申' in logic
        assert '食神' in logic

    def test_roger8_strength_relation(self, roger8_enhanced):
        """Should mention 用神 水."""
        relation = roger8_enhanced['patternNarrative']['patternStrengthRelation']
        assert '水' in relation

    def test_roger8_dominant_ten_gods(self, roger8_enhanced):
        """食神 should be #1 (月令), 比肩 likely #2."""
        gods = roger8_enhanced['patternNarrative']['dominantTenGods']
        assert len(gods) == 2
        assert gods[0] == '食神'  # 月令優先

    def test_pattern_narrative_has_all_fields(self, roger8_enhanced):
        pn = roger8_enhanced['patternNarrative']
        assert 'patternName' in pn
        assert 'patternLogic' in pn
        assert 'patternStrengthRelation' in pn
        assert 'dominantTenGods' in pn


# ============================================================
# Children Insights Tests
# ============================================================

class TestChildrenInsights:
    def test_roger8_manifest_count(self, roger8_enhanced):
        """Roger8: 庚(時干)=食神 → manifest=1."""
        ci = roger8_enhanced['childrenInsights']
        assert ci['shishanManifestCount'] == 1

    def test_roger8_latent_count(self, roger8_enhanced):
        """Roger8: branch 本氣 食傷 that are NOT transparent."""
        ci = roger8_enhanced['childrenInsights']
        assert ci['shishanLatentCount'] == 0  # 庚 is transparent (manifest stem)

    def test_roger8_hour_pillar_ten_god(self, roger8_enhanced):
        """Hour branch 申 本氣=庚 → 食神 for 戊 DM."""
        ci = roger8_enhanced['childrenInsights']
        assert ci['hourPillarTenGod'] == '食神'

    def test_roger8_suppressed(self, roger8_enhanced):
        """食傷 should not be suppressed (印 isn't dominant)."""
        ci = roger8_enhanced['childrenInsights']
        assert ci['isShishanSuppressed'] is False

    def test_roger8_hour_branch_life_stage(self, roger8_enhanced):
        """Hour branch life stage should be a valid stage name."""
        ci = roger8_enhanced['childrenInsights']
        assert ci['hourBranchLifeStage'] in [
            '帝旺', '臨官', '冠帶', '長生', '沐浴', '養', '胎',
            '衰', '病', '墓', '死', '絕',
        ]


# ============================================================
# Parents Insights Tests
# ============================================================

class TestParentsInsights:
    def test_roger8_father_star(self, roger8_enhanced):
        """Year stem 丁 → derive_ten_god(戊, 丁) = 正印."""
        pi = roger8_enhanced['parentsInsights']
        assert pi['fatherStar'] == '正印'

    def test_roger8_mother_star(self, roger8_enhanced):
        """Year branch 卯 本氣=乙 → derive_ten_god(戊, 乙) = 正官."""
        pi = roger8_enhanced['parentsInsights']
        assert pi['motherStar'] == '正官'

    def test_roger8_father_element(self, roger8_enhanced):
        """Father = 財星 element = element DM(戊/土) overcomes = 水."""
        pi = roger8_enhanced['parentsInsights']
        assert pi['fatherElement'] == '水'

    def test_roger8_mother_element(self, roger8_enhanced):
        """Mother = 印星 element = element that produces DM(戊/土) = 火."""
        pi = roger8_enhanced['parentsInsights']
        assert pi['motherElement'] == '火'

    def test_roger8_year_pillar_favorability(self, roger8_enhanced):
        """Year stem 丁=火=仇神 → should be 忌神."""
        pi = roger8_enhanced['parentsInsights']
        assert pi['yearPillarFavorability'] == '忌神'


# ============================================================
# Boss Compatibility Tests
# ============================================================

class TestBossCompatibility:
    def test_roger8_boss_style(self, roger8_enhanced):
        """Roger8 食神格 → specific boss style."""
        bc = roger8_enhanced['bossCompatibility']
        assert '食神' in bc['dominantStyle']

    def test_roger8_ideal_boss_type(self, roger8_enhanced):
        bc = roger8_enhanced['bossCompatibility']
        assert bc['idealBossType'] != ''

    def test_roger8_strengths_and_warnings(self, roger8_enhanced):
        bc = roger8_enhanced['bossCompatibility']
        assert len(bc['workplaceStrengths']) >= 3
        assert len(bc['workplaceWarnings']) >= 2

    def test_all_ten_gods_have_boss_style(self):
        """Every Ten God should produce valid boss compatibility."""
        for tg in ['正官', '偏官', '正財', '偏財', '食神', '傷官', '正印', '偏印', '比肩', '劫財']:
            result = build_boss_compatibility(tg)
            assert result['dominantStyle'] != ''
            assert result['idealBossType'] != ''


# ============================================================
# Benefactors Tests
# ============================================================

class TestBenefactors:
    def test_roger8_benefactor_elements(self, roger8_enhanced):
        """用神=水, 喜神=金 → benefactor elements = ['水', '金']."""
        det = roger8_enhanced['deterministic']
        assert '水' in det['career_benefactors_element']
        assert '金' in det['career_benefactors_element']

    def test_roger8_benefactor_zodiacs(self, roger8_enhanced):
        """用神=水 → 三合水局 = 申子辰 → 猴鼠龍 (minus own zodiac if applicable)."""
        det = roger8_enhanced['deterministic']
        # Roger8 year branch = 卯(兔), not in 水局, so all 3 zodiacs should be present
        assert '猴' in det['career_benefactors_zodiac']
        assert '鼠' in det['career_benefactors_zodiac']
        assert '龍' in det['career_benefactors_zodiac']

    def test_benefactors_exclude_own_zodiac(self):
        """If year branch is in the 三合 group, it should be excluded."""
        # 用神=水, year_branch=申(猴) → 申 is in 水局, should exclude 猴
        result = compute_benefactors(
            {'usefulGod': '水', 'favorableGod': '金'},
            year_branch='申',
        )
        assert '猴' not in result['career_benefactors_zodiac']
        assert '鼠' in result['career_benefactors_zodiac']
        assert '龍' in result['career_benefactors_zodiac']


# ============================================================
# Partner Zodiacs Tests
# ============================================================

class TestPartnerZodiacs:
    def test_roger8_partner_zodiacs(self, roger8_enhanced):
        """日支午 → 六合=未(羊), 三合=寅午戌(虎,狗)."""
        det = roger8_enhanced['deterministic']
        zodiacs = det['partner_zodiac']
        assert '羊' in zodiacs  # 六合
        assert '虎' in zodiacs  # 三合
        assert '狗' in zodiacs  # 三合

    def test_zi_day_branch_partners(self):
        """日支子 → 六合=丑(牛), 三合=申子辰(猴,龍)."""
        result = compute_partner_zodiacs('子')
        assert '牛' in result['partner_zodiac']
        assert '猴' in result['partner_zodiac']
        assert '龍' in result['partner_zodiac']


# ============================================================
# Romance Years Tests
# ============================================================

class TestRomanceYears:
    def test_roger8_romance_years_count(self, roger8_enhanced):
        """Should return up to 5 years."""
        det = roger8_enhanced['deterministic']
        assert len(det['romance_years']) <= 5
        assert len(det['romance_years']) >= 1

    def test_roger8_romance_years_sorted(self, roger8_enhanced):
        """Years should be in chronological order."""
        years = roger8_enhanced['deterministic']['romance_years']
        assert years == sorted(years)

    def test_roger8_romance_years_not_in_kong_wang(self, roger8_chart, roger8_enhanced):
        """No romance year should have its annual branch in 空亡 (子/丑 for Roger8)."""
        kong_wang = roger8_chart['kongWang']  # ['子', '丑']
        romance_years = roger8_enhanced['deterministic']['romance_years']
        annual_stars = roger8_chart['annualStars']

        for year in romance_years:
            for star in annual_stars:
                if star['year'] == year:
                    assert star['branch'] not in kong_wang, \
                        f"Romance year {year} has branch {star['branch']} in 空亡"

    def test_male_spouse_star_element(self):
        """Male: spouse star = 正財 = element DM overcomes."""
        from app.constants import ELEMENT_OVERCOMES
        # 戊 DM overcomes 水 → spouse_star_element = 水
        assert ELEMENT_OVERCOMES['土'] == '水'

    def test_female_spouse_star_element(self):
        """Female: spouse star = 正官 = element that overcomes DM."""
        from app.constants import ELEMENT_OVERCOME_BY
        # 戊 DM is overcome by 木 → spouse_star_element = 木
        assert ELEMENT_OVERCOME_BY['土'] == '木'


# ============================================================
# Parent Health Years Tests
# ============================================================

class TestParentHealthYears:
    def test_roger8_parent_health_years_structure(self, roger8_enhanced):
        det = roger8_enhanced['deterministic']
        phy = det['parent_health_years']
        assert 'father' in phy
        assert 'mother' in phy
        assert isinstance(phy['father'], list)
        assert isinstance(phy['mother'], list)

    def test_roger8_parent_health_years_max_5(self, roger8_enhanced):
        det = roger8_enhanced['deterministic']
        phy = det['parent_health_years']
        assert len(phy['father']) <= 5
        assert len(phy['mother']) <= 5

    def test_roger8_father_danger_years(self, roger8_enhanced):
        """Father element = 水 (DM overcomes). Threat = 土 (overcomes 水).
        Years with 土 stem (戊/己) are danger years."""
        det = roger8_enhanced['deterministic']
        father_years = det['parent_health_years']['father']
        assert len(father_years) >= 1


# ============================================================
# Luck Period Enrichment Tests
# ============================================================

class TestLuckPeriodEnrichment:
    def test_roger8_enriched_count(self, roger8_enhanced):
        det = roger8_enhanced['deterministic']
        assert len(det['luck_periods_enriched']) >= 7

    def test_roger8_scores_in_range(self, roger8_enhanced):
        """All scores should be in [0, 100]."""
        for lp in roger8_enhanced['deterministic']['luck_periods_enriched']:
            assert 0 <= lp['score'] <= 100

    def test_roger8_enriched_structure(self, roger8_enhanced):
        """Each enriched LP should have all expected fields."""
        for lp in roger8_enhanced['deterministic']['luck_periods_enriched']:
            assert 'stem' in lp
            assert 'branch' in lp
            assert 'startAge' in lp
            assert 'endAge' in lp
            assert 'score' in lp
            assert 'stemPhase' in lp
            assert 'branchPhase' in lp
            assert 'interactions' in lp

    def test_roger8_best_period_exists(self, roger8_enhanced):
        """Best period should be identified."""
        det = roger8_enhanced['deterministic']
        assert det['best_period'] is not None
        assert det['best_period']['score'] >= 50

    def test_roger8_best_period_highest_score(self, roger8_enhanced):
        """Best period should have the highest score."""
        det = roger8_enhanced['deterministic']
        best = det['best_period']
        for lp in det['luck_periods_enriched']:
            assert lp['score'] <= best['score']

    def test_roger8_favorable_lp_scores_higher(self, roger8_enhanced):
        """LP with 用神(水)/喜神(金) elements should score higher than average."""
        det = roger8_enhanced['deterministic']
        scores = [lp['score'] for lp in det['luck_periods_enriched']]
        avg = sum(scores) / len(scores) if scores else 50
        # 庚子 (金/水) should score well
        for lp in det['luck_periods_enriched']:
            if lp['stem'] == '庚' and lp['branch'] == '子':
                assert lp['score'] > avg, f"庚子 LP score {lp['score']} should be above avg {avg}"


# ============================================================
# Deterministic Data Tests
# ============================================================

class TestDeterministicData:
    def test_roger8_favorable_investments(self, roger8_enhanced):
        """用神=水, 喜神=金 → investments from both."""
        det = roger8_enhanced['deterministic']
        assert len(det['favorable_investments']) >= 5

    def test_roger8_unfavorable_investments(self, roger8_enhanced):
        """忌神=土, 仇神=火 → risky investments from both."""
        det = roger8_enhanced['deterministic']
        assert len(det['unfavorable_investments']) >= 3

    def test_roger8_career_directions(self, roger8_enhanced):
        """用神=水 → 5 career direction categories."""
        det = roger8_enhanced['deterministic']
        assert len(det['career_directions']) == 5
        # First anchor should be 水-related
        assert '水' in det['career_directions'][0]['anchor']

    def test_roger8_favorable_direction(self, roger8_enhanced):
        """用神=水 → 北方."""
        det = roger8_enhanced['deterministic']
        assert det['favorable_direction'] == '北方'

    def test_roger8_partner_elements(self, roger8_enhanced):
        """用神=水, 喜神=金."""
        det = roger8_enhanced['deterministic']
        assert '水' in det['partner_element']
        assert '金' in det['partner_element']

    def test_roger8_annual_ten_god(self, roger8_enhanced):
        """annualTenGod for current year should be a valid Ten God."""
        det = roger8_enhanced['deterministic']
        valid_ten_gods = ['比肩', '劫財', '食神', '傷官', '正財', '偏財', '正官', '偏官', '正印', '偏印']
        assert det['annualTenGod'] in valid_ten_gods


# ============================================================
# Integration: Full Pipeline Test
# ============================================================

class TestFullPipeline:
    def test_lifetime_enhanced_present_when_lifetime(self, roger8_chart):
        """lifetimeEnhancedInsights should be present for LIFETIME reading."""
        assert 'lifetimeEnhancedInsights' in roger8_chart

    def test_lifetime_enhanced_absent_when_no_reading_type(self):
        """lifetimeEnhancedInsights should NOT be present without reading_type."""
        result = calculate_bazi(
            '1987-09-06', '16:11', '台北市', 'Asia/Taipei', 'male',
        )
        assert 'lifetimeEnhancedInsights' not in result

    def test_existing_pre_analysis_still_works(self, roger8_chart):
        """Pre-analysis should still contain all original fields."""
        pa = roger8_chart['preAnalysis']
        assert 'strengthV2' in pa
        assert 'prominentGod' in pa
        assert 'effectiveFavorableGods' in pa
        assert 'tenGodPositionAnalysis' in pa
        assert 'touganAnalysis' in pa
        assert 'careerInsights' in pa
        assert 'loveInsights' in pa
        assert 'healthInsights' in pa


# ============================================================
# Timing Analysis 三刑 Extension Test
# ============================================================

class TestTimingAnalysisSanxing:
    def test_sanxing_detected_in_branch_natal_interactions(self):
        """三刑 partial should appear in analyze_branch_natal_interactions."""
        from app.timing_analysis import analyze_branch_natal_interactions
        # Natal chart with 寅 in month, check period branch 巳 → 寅巳 半刑
        pillars = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '午'},
            'hour': {'stem': '壬', 'branch': '子'},
        }
        interactions = analyze_branch_natal_interactions('巳', pillars, '戊')
        sanxing = [i for i in interactions if i['type'] == '三刑']
        assert len(sanxing) >= 1
        assert sanxing[0]['pillar'] == 'month'
        assert '無恩之刑' in sanxing[0]['name']
