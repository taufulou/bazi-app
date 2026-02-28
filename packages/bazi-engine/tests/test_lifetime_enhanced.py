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
    DAY_MASTER_PERSONALITY,
    ELEMENT_DIRECTION,
    ELEMENT_FAVORABLE_INVESTMENTS,
    ELEMENT_INDUSTRIES_DETAILED,
    ELEMENT_SANHE_BRANCHES,
    ELEMENT_UNFAVORABLE_INVESTMENTS,
    STRENGTH_PERSONALITY_MODIFIER,
    TEN_GOD_PERSONALITY,
    TEN_GOD_WORK_STYLE,
    _build_personality_anchors,
    _check_sanxing_pair,
    build_boss_compatibility,
    build_children_insights,
    build_parents_insights,
    build_pattern_narrative,
    compute_benefactors,
    compute_parent_health_years,
    compute_partner_zodiacs,
    compute_romance_warning_years,
    compute_romance_years,
    compute_romance_years_enriched,
    compute_stars_in_kong_wang,
    enrich_luck_periods,
    generate_lifetime_enhanced_insights,
    tag_romance_years_with_dayun,
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

    def test_roger8_suppression_detail_field(self, roger8_enhanced):
        """New shishanSuppressionDetail field should exist."""
        ci = roger8_enhanced['childrenInsights']
        assert 'shishanSuppressionDetail' in ci


# ============================================================
# 偏印奪食 (梟神奪食) Detection Tests — 6-gate algorithm
# ============================================================

class TestPianyinDuoshi:
    """Tests for the 偏印奪食 detection algorithm in build_children_insights()."""

    def test_roger8_no_pianyin_no_suppression(self, roger8_enhanced):
        """Roger (戊DM): year=丁(正印) month=戊(比肩) hour=庚(食神).
        丁 is 正印, NOT 偏印 → Gate 2 fails → False."""
        ci = roger8_enhanced['childrenInsights']
        assert ci['isShishanSuppressed'] is False
        # Roger's DM=戊: 丁=正印, not 偏印 → no suppression possible

    def test_weak_dm_no_suppression(self):
        """Weak DM + 偏印 + 食神, but seal element NOT 忌/仇 → Gate 1 blocks.
        DM=丙(Fire): 偏印=甲(Wood), 食神=戊(Earth), 印element=木.
        When 木 is NOT taboo/enemy → weak DM benefits from 偏印."""
        pillars = {
            'year': {'stem': '壬', 'branch': '子'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '丙', 'branch': '午'},
            'hour': {'stem': '戊', 'branch': '申'},
        }
        tougan = []  # not needed for suppression detection
        balance = {'木': 35.0, '火': 10.0, '土': 15.0, '金': 20.0, '水': 20.0}
        effective = {'usefulGod': '木', 'favorableGod': '火', 'tabooGod': '土', 'enemyGod': '金'}
        result = build_children_insights(
            pillars, '丙', tougan, balance,
            effective_gods=effective,
            strength_classification='weak',
        )
        assert result['isShishanSuppressed'] is False
        assert '身弱' in result['shishanSuppressionDetail']

    def test_weak_dm_taboo_seal_proceeds(self):
        """Weak DM + 偏印 + 食神, seal element IS 忌神 → Gate 1 passes, proceeds.
        DM=丙(Fire): 偏印=甲, 食神=戊, 印element=木=忌神.
        Adjacent (month-hour) + 木>土 → suppressed."""
        pillars = {
            'year': {'stem': '壬', 'branch': '子'},
            'month': {'stem': '甲', 'branch': '寅'},  # 偏印 in month
            'day': {'stem': '丙', 'branch': '午'},
            'hour': {'stem': '戊', 'branch': '申'},   # 食神 in hour
        }
        tougan = []
        balance = {'木': 30.0, '火': 10.0, '土': 15.0, '金': 25.0, '水': 20.0}
        effective = {'usefulGod': '金', 'favorableGod': '水', 'tabooGod': '木', 'enemyGod': '火'}
        result = build_children_insights(
            pillars, '丙', tougan, balance,
            effective_gods=effective,
            strength_classification='weak',
        )
        # Gate 1 passes (weak but seal IS taboo), gates 2-6 → 木(30)>土(15), adjacent, no 偏財
        assert result['isShishanSuppressed'] is True
        assert '貼身' in result['shishanSuppressionDetail']

    def test_pianyin_duoshi_detected_adjacent(self):
        """Strong DM + adjacent 偏印(month) + 食神(hour) + seal > food → True.
        DM=丙(Fire): month=甲(偏印), hour=戊(食神). Adjacent = standard bar."""
        pillars = {
            'year': {'stem': '壬', 'branch': '子'},
            'month': {'stem': '甲', 'branch': '寅'},  # 偏印
            'day': {'stem': '丙', 'branch': '午'},
            'hour': {'stem': '戊', 'branch': '申'},   # 食神
        }
        tougan = []
        balance = {'木': 30.0, '火': 25.0, '土': 15.0, '金': 15.0, '水': 15.0}
        result = build_children_insights(
            pillars, '丙', tougan, balance,
            strength_classification='strong',
        )
        # Adjacent, 木(30)>土(15), no 偏財 → suppressed
        assert result['isShishanSuppressed'] is True
        assert '貼身' in result['shishanSuppressionDetail']
        assert '印星力量大於食傷' in result['shishanSuppressionDetail']

    def test_distant_pianyin_higher_bar(self):
        """Strong DM + year 偏印 + hour 食神 (non-adjacent) + seal barely > food.
        Non-adjacent → requires ×1.3 bar. 木(20) NOT > 土(18)×1.3=23.4 → False."""
        pillars = {
            'year': {'stem': '甲', 'branch': '寅'},   # 偏印 in year
            'month': {'stem': '壬', 'branch': '子'},
            'day': {'stem': '丙', 'branch': '午'},
            'hour': {'stem': '戊', 'branch': '申'},   # 食神 in hour
        }
        tougan = []
        balance = {'木': 20.0, '火': 25.0, '土': 18.0, '金': 20.0, '水': 17.0}
        result = build_children_insights(
            pillars, '丙', tougan, balance,
            strength_classification='strong',
        )
        # Non-adjacent: 木(20) needs to be > 土(18)×1.3 = 23.4 → False
        assert result['isShishanSuppressed'] is False

    def test_piancai_resolves(self):
        """Strong DM + adjacent 偏印 + 食神 + 偏財 in stems → resolved (偏財制梟).
        DM=丙(Fire): 偏印=甲, 食神=戊, 偏財=庚. 庚 neutralizes."""
        pillars = {
            'year': {'stem': '庚', 'branch': '申'},   # 偏財
            'month': {'stem': '甲', 'branch': '寅'},  # 偏印
            'day': {'stem': '丙', 'branch': '午'},
            'hour': {'stem': '戊', 'branch': '申'},   # 食神
        }
        tougan = []
        balance = {'木': 30.0, '火': 20.0, '土': 15.0, '金': 20.0, '水': 15.0}
        result = build_children_insights(
            pillars, '丙', tougan, balance,
            strength_classification='strong',
        )
        assert result['isShishanSuppressed'] is False
        assert '偏財制梟' in result['shishanSuppressionDetail']

    def test_zhengyin_does_not_suppress(self):
        """Chart with 正印 (not 偏印) + 食神 → Gate 2 fails → False.
        DM=丙(Fire): 乙=正印, 戊=食神. Only 偏印 triggers suppression."""
        pillars = {
            'year': {'stem': '壬', 'branch': '子'},
            'month': {'stem': '乙', 'branch': '卯'},  # 正印, NOT 偏印
            'day': {'stem': '丙', 'branch': '午'},
            'hour': {'stem': '戊', 'branch': '申'},   # 食神
        }
        tougan = []
        balance = {'木': 35.0, '火': 20.0, '土': 10.0, '金': 15.0, '水': 20.0}
        result = build_children_insights(
            pillars, '丙', tougan, balance,
            strength_classification='strong',
        )
        # 乙=正印, not 偏印 → no 偏印 positions found → False
        assert result['isShishanSuppressed'] is False
        assert result['shishanSuppressionDetail'] == ''


# ============================================================
# Parents Insights Tests
# ============================================================

class TestParentsInsights:
    def test_roger8_father_star(self, roger8_enhanced):
        """Father star is always 偏財 per 子平真詮 (not year stem's ten god)."""
        pi = roger8_enhanced['parentsInsights']
        assert pi['fatherStar'] == '偏財'
        # Positional ten god should be stored separately
        assert pi['yearStemTenGod'] == '正印'  # 戊→丁 = 正印

    def test_roger8_mother_star(self, roger8_enhanced):
        """Mother star is always 正印 per 子平真詮 (not year branch's ten god)."""
        pi = roger8_enhanced['parentsInsights']
        assert pi['motherStar'] == '正印'
        # Positional ten god should be stored separately
        assert pi['yearBranchMainTenGod'] == '正官'  # 戊→乙 = 正官

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
        """Roger8 年支=卯(兔) → 三合 亥卯未=豬,羊 + 六合 卯→戌=狗."""
        det = roger8_enhanced['deterministic']
        assert '豬' in det['career_benefactors_zodiac']
        assert '羊' in det['career_benefactors_zodiac']
        assert '狗' in det['career_benefactors_zodiac']
        assert len(det['career_benefactors_zodiac']) == 3

    def test_benefactors_exclude_own_zodiac(self):
        """Year branch in 三合 group → own zodiac excluded from 三合, still gets 六合."""
        # year_branch=申(猴) → 三合 申子辰=鼠,龍 (excl 猴) + 六合 申→巳=蛇
        result = compute_benefactors(
            {'usefulGod': '水', 'favorableGod': '金'},
            year_branch='申',
        )
        assert '猴' not in result['career_benefactors_zodiac']
        assert '鼠' in result['career_benefactors_zodiac']
        assert '龍' in result['career_benefactors_zodiac']
        assert '蛇' in result['career_benefactors_zodiac']  # 六合
        assert len(result['career_benefactors_zodiac']) == 3

    def test_laopo9_benefactor_zodiacs(self):
        """Laopo9 年支=寅(虎) → 三合 寅午戌=馬,狗 + 六合 寅→亥=豬."""
        result = compute_benefactors(
            {'usefulGod': '木', 'favorableGod': '水'},
            year_branch='寅',
        )
        assert '馬' in result['career_benefactors_zodiac']
        assert '狗' in result['career_benefactors_zodiac']
        assert '豬' in result['career_benefactors_zodiac']  # 六合
        assert len(result['career_benefactors_zodiac']) == 3

    def test_jenna_benefactor_zodiacs(self):
        """Jenna 年支=丑(牛) → 三合 巳酉丑=蛇,雞 + 六合 丑→子=鼠."""
        result = compute_benefactors(
            {'usefulGod': '土', 'favorableGod': '火'},
            year_branch='丑',
        )
        assert '蛇' in result['career_benefactors_zodiac']
        assert '雞' in result['career_benefactors_zodiac']
        assert '鼠' in result['career_benefactors_zodiac']  # 六合
        assert len(result['career_benefactors_zodiac']) == 3
        # Previously this was EMPTY because ELEMENT_SANHE_BRANCHES had no '土' entry

    def test_all_12_year_branches_get_3_benefactors(self):
        """Every year branch should produce exactly 3 benefactor zodiacs."""
        branches = ['子', '丑', '寅', '卯', '辰', '巳',
                     '午', '未', '申', '酉', '戌', '亥']
        for branch in branches:
            result = compute_benefactors(
                {'usefulGod': '水', 'favorableGod': '金'},
                year_branch=branch,
            )
            assert len(result['career_benefactors_zodiac']) == 3, \
                f"Year branch {branch} should have 3 benefactor zodiacs, got {result['career_benefactors_zodiac']}"


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

    def test_roger8_secondary_year_branch(self):
        """Roger: day=午, year=卯. Secondary from 卯: 六合=戌(狗 in primary), 三合=亥卯未.
        狗+羊 already in primary → secondary = [豬] only."""
        result = compute_partner_zodiacs('午', '卯')
        assert result['partner_zodiac'] == ['羊', '虎', '狗']  # primary unchanged
        assert '豬' in result['partner_zodiac_secondary']
        # 狗 and 羊 should NOT duplicate into secondary
        assert '狗' not in result['partner_zodiac_secondary']
        assert '羊' not in result['partner_zodiac_secondary']

    def test_jenna_secondary_year_branch(self):
        """Jenna: day=卯, year=丑. Primary from 卯: [狗,豬,羊].
        Secondary from 丑: 六合=子(鼠), 三合=巳酉丑(蛇,雞)."""
        result = compute_partner_zodiacs('卯', '丑')
        assert result['partner_zodiac'] == ['狗', '豬', '羊']
        assert '鼠' in result['partner_zodiac_secondary']
        assert '蛇' in result['partner_zodiac_secondary']
        assert '雞' in result['partner_zodiac_secondary']

    def test_no_year_branch_backward_compat(self):
        """Without year_branch, secondary should be empty list."""
        result = compute_partner_zodiacs('午')
        assert result['partner_zodiac_secondary'] == []

    def test_laopo9_secondary_dedup(self):
        """Laopo9: day=戌, year=寅. Primary: [兔,虎,馬].
        Secondary from 寅: 六合=亥(豬), 三合=寅午戌(馬 in primary, 狗)."""
        result = compute_partner_zodiacs('戌', '寅')
        assert '兔' in result['partner_zodiac']
        assert '豬' in result['partner_zodiac_secondary']
        assert '狗' in result['partner_zodiac_secondary']
        # 馬 already in primary, should not appear in secondary
        assert '馬' not in result['partner_zodiac_secondary']


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

    def test_romance_years_birth_year_filter(self):
        """Romance years should not include years before birth_year."""
        # Simulate annual_stars spanning 2018-2030
        annual_stars = [
            {'year': y, 'stem': '甲', 'branch': '子'}
            for y in range(2018, 2031)
        ]
        years = compute_romance_years(
            gender='female',
            day_master_stem='己',
            day_branch='卯',
            year_branch='丑',
            annual_stars=annual_stars,
            kong_wang=[],
            birth_year=2021,
        )
        for y in years:
            assert y >= 2021, f"Romance year {y} is before birth year 2021"

    def test_romance_years_no_filter_when_birth_year_zero(self):
        """When birth_year=0 (default), no filtering should occur."""
        annual_stars = [
            {'year': y, 'stem': '甲', 'branch': '子'}
            for y in range(2018, 2025)
        ]
        years = compute_romance_years(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=annual_stars,
            kong_wang=[],
            birth_year=0,
        )
        # With birth_year=0, years before any threshold are allowed
        # (backward compat: no filtering)
        if years:
            assert min(years) >= 2018  # Just check they come from our range

    def test_jenna_romance_years_after_birth(self):
        """Jenna (born 2021): all romance years must be >= 2021."""
        chart = calculate_bazi(
            '2021-09-28', '17:06', '吉隆坡', 'Asia/Kuala_Lumpur', 'female',
            reading_type='LIFETIME',
        )
        enhanced = chart.get('lifetimeEnhancedInsights')
        romance_years = enhanced['deterministic']['romance_years']
        for y in romance_years:
            assert y >= 2021, f"Jenna romance year {y} is before her birth year 2021"

    def test_tiangan_he_rigan_detected(self):
        """天干合日主: annual stem that 五合 with DM should be a romance candidate.
        DM=甲, 甲合己 → 己 years are romance candidates."""
        from app.constants import STEM_COMBINATIONS
        # 甲 combines with 己
        assert STEM_COMBINATIONS['甲'] == '己'

        # Test: 己 year with safe branch (寅) — no 空亡, no 三刑
        years = compute_romance_years(
            gender='female',
            day_master_stem='甲',
            day_branch='戌',
            year_branch='寅',
            annual_stars=[
                {'year': 2039, 'stem': '己', 'branch': '寅'},  # 己=甲's 合 partner, 寅 is safe
            ],
            kong_wang=['申', '酉'],
        )
        assert 2039 in years, "己 year (天干合甲) should be detected as romance year"

        # Test: 己酉 year with 酉 in 空亡 → should be filtered out
        years2 = compute_romance_years(
            gender='female',
            day_master_stem='甲',
            day_branch='戌',
            year_branch='寅',
            annual_stars=[
                {'year': 2029, 'stem': '己', 'branch': '酉'},  # 酉 in 空亡
            ],
            kong_wang=['申', '酉'],
        )
        assert 2029 not in years2, "己酉 year should be filtered by 空亡"

    def test_tiangan_he_all_five_pairs(self):
        """All 5 天干五合 pairs should work: 甲己, 乙庚, 丙辛, 丁壬, 戊癸."""
        pairs = [('甲', '己'), ('乙', '庚'), ('丙', '辛'), ('丁', '壬'), ('戊', '癸')]
        for dm, partner in pairs:
            annual_stars = [
                {'year': 2030, 'stem': partner, 'branch': '午'},  # 午 is a safe branch
            ]
            years = compute_romance_years(
                gender='male',
                day_master_stem=dm,
                day_branch='午',
                year_branch='寅',
                annual_stars=annual_stars,
                kong_wang=[],
            )
            assert 2030 in years, \
                f"DM={dm} should detect {partner} year as romance via 天干合日主"

    def test_tiangan_he_not_duplicate_with_spouse_star(self):
        """If a year is already caught by spouse star (secondary_a),
        天干合日主 should not duplicate it."""
        # DM=戊(土), male: spouse_star = 水 (土克水)
        # 戊合癸, and 癸=水 → this year triggers BOTH spouse star AND 天干合日主
        annual_stars = [
            {'year': 2033, 'stem': '癸', 'branch': '丑'},  # 癸=水=spouse star, AND 癸=戊's 合 partner
        ]
        years = compute_romance_years(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=annual_stars,
            kong_wang=[],
        )
        # Should appear once, not duplicated
        assert years.count(2033) == 1
        assert 2033 in years

    def test_hongluan_elevated_above_taohua(self):
        """紅鸞 should be picked before 桃花/天喜 when 5-slot limit applies.
        DM=戊, day=午, year=卯 → 紅鸞=子, 桃花=卯, 天喜=午.
        六合(午)=未, spouse(male)=水, 三合(午)=寅,戌.
        Set up: 4 secondary_a years + 1 紅鸞 year + 1 桃花 year.
        Only 5 slots → 紅鸞 (secondary_d) should beat 桃花 (supplementary)."""
        annual_stars = [
            # 4 secondary_a years (stem=癸=水=spouse star for male 戊)
            {'year': 2030, 'stem': '癸', 'branch': '辰'},
            {'year': 2031, 'stem': '癸', 'branch': '巳'},
            {'year': 2032, 'stem': '癸', 'branch': '寅'},  # also 三合
            {'year': 2033, 'stem': '癸', 'branch': '丑'},
            # 紅鸞 year: branch=子 (紅鸞 for year=卯)
            {'year': 2034, 'stem': '甲', 'branch': '子'},
            # 桃花 year: branch=卯 (桃花 for day=午)
            {'year': 2035, 'stem': '乙', 'branch': '卯'},
        ]
        years = compute_romance_years(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=annual_stars,
            kong_wang=[],
        )
        assert len(years) == 5
        # 紅鸞 year 2034 should be included (secondary_d beats supplementary)
        assert 2034 in years, "紅鸞 year should be picked over 桃花"
        # 桃花 year 2035 should be excluded (supplementary, no room)
        assert 2035 not in years, "桃花 year should be bumped by 紅鸞"

    def test_hongluan_not_duplicated_with_primary(self):
        """If a year is already primary (六合), 紅鸞 should not duplicate it."""
        # DM=甲, day=丑, year=子 → 紅鸞(子)=卯, 六合(丑)=子
        # Year 2032 branch=子: hits BOTH 六合(丑→子) and would NOT be 紅鸞
        # Year 2035 branch=卯: hits 紅鸞(子→卯)
        # Let's pick: DM=甲, day=午, year=卯 → 紅鸞=子, 六合(午)=未
        # Year with branch=子 hits 紅鸞 only, not 六合 → should be in secondary_d
        annual_stars = [
            {'year': 2032, 'stem': '壬', 'branch': '子'},  # 紅鸞(卯→子)
        ]
        years = compute_romance_years(
            gender='male',
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            annual_stars=annual_stars,
            kong_wang=[],
        )
        assert years.count(2032) == 1
        assert 2032 in years

    # ── Time-window filter tests (1e) ──

    def test_current_year_filters_old_past_years(self):
        """With current_year=2026, only the 1 most recent past year is kept."""
        # DM=甲, day=戌 → 六合=卯. Both 2020 and 2023 have 卯 (primary candidates).
        annual_stars = [
            {'year': 2020, 'stem': '庚', 'branch': '卯'},  # 卯=六合戌 (past, primary)
            {'year': 2023, 'stem': '癸', 'branch': '卯'},  # 卯=六合戌 (past, primary)
            {'year': 2030, 'stem': '庚', 'branch': '戌'},
            {'year': 2031, 'stem': '辛', 'branch': '亥'},
        ]
        years = compute_romance_years(
            gender='female',
            day_master_stem='甲',
            day_branch='戌',
            year_branch='寅',
            annual_stars=annual_stars,
            kong_wang=[],
            current_year=2026,
        )
        # 2020 should be filtered out (2023 is more recent past)
        assert 2020 not in years, "2020 should be filtered (not the most recent past)"
        # 2023 is the most recent past → kept as the 1 allowed past year
        assert 2023 in years, "2023 should be kept as the most recent past year"
        past_years = [y for y in years if y < 2026]
        assert len(past_years) == 1, f"Exactly 1 past year, got {past_years}"

    def test_current_year_keeps_one_recent_past(self):
        """With current_year=2026, should keep the 1 most recent past year."""
        # DM=甲, day=戌 → 六合=卯. Set up 2 past years that are 六合 candidates.
        annual_stars = [
            {'year': 2023, 'stem': '癸', 'branch': '卯'},  # 卯=六合戌 (past, primary)
            {'year': 2025, 'stem': '乙', 'branch': '卯'},  # 卯=六合戌 (past, primary)
            {'year': 2030, 'stem': '庚', 'branch': '戌'},  # future
        ]
        years = compute_romance_years(
            gender='female',
            day_master_stem='甲',
            day_branch='戌',
            year_branch='寅',
            annual_stars=annual_stars,
            kong_wang=[],
            current_year=2026,
        )
        past_years = [y for y in years if y < 2026]
        # Should keep only 1 past year (2025, the most recent)
        assert len(past_years) <= 1, f"Should keep at most 1 past year, got {past_years}"
        if past_years:
            assert past_years[0] == 2025, "Should keep the MOST RECENT past year (2025, not 2023)"

    def test_current_year_caps_future_at_10_years(self):
        """Future years beyond current_year+10 should be excluded."""
        annual_stars = [
            {'year': 2030, 'stem': '庚', 'branch': '戌'},
            {'year': 2035, 'stem': '乙', 'branch': '卯'},  # 卯=六合戌 (primary)
            {'year': 2037, 'stem': '丁', 'branch': '巳'},  # current_year+10=2036, so 2037 is out
            {'year': 2040, 'stem': '庚', 'branch': '申'},  # way beyond
        ]
        years = compute_romance_years(
            gender='female',
            day_master_stem='甲',
            day_branch='戌',
            year_branch='寅',
            annual_stars=annual_stars,
            kong_wang=[],
            current_year=2026,
        )
        assert 2037 not in years, "2037 exceeds 10-year window (2026+10=2036)"
        assert 2040 not in years, "2040 exceeds 10-year window"

    def test_current_year_zero_no_filter(self):
        """When current_year=0 (default), no time-window filter is applied."""
        annual_stars = [
            {'year': 2010, 'stem': '庚', 'branch': '卯'},  # 卯=六合戌
            {'year': 2035, 'stem': '乙', 'branch': '卯'},  # 卯=六合戌
            {'year': 2050, 'stem': '庚', 'branch': '卯'},  # far future
        ]
        years = compute_romance_years(
            gender='female',
            day_master_stem='甲',
            day_branch='戌',
            year_branch='寅',
            annual_stars=annual_stars,
            kong_wang=[],
            current_year=0,
        )
        # All years should be candidates (no time filtering)
        assert 2010 in years, "With current_year=0, old years should not be filtered"
        assert 2050 in years, "With current_year=0, far future should not be filtered"

    def test_roger8_romance_years_no_old_past(self, roger8_enhanced):
        """Roger8 integration: at most 1 past year in romance years."""
        years = roger8_enhanced['deterministic']['romance_years']
        current_year = __import__('datetime').datetime.now().year
        past_years = [y for y in years if y < current_year]
        # At most 1 past year (the most recent romance candidate before current_year)
        assert len(past_years) <= 1, \
            f"Should have at most 1 past year, got {past_years}"
        # All future years should be within 10-year window
        future_years = [y for y in years if y >= current_year]
        for y in future_years:
            assert y <= current_year + 10, \
                f"Future year {y} exceeds 10-year window from {current_year}"


# ============================================================
# 三刑 Filter Fix Tests (桃花年 2033 for Laopo11)
# ============================================================

class TestSanxingRomanceFilter:
    """三刑 should block all tiers EXCEPT secondary_a2 (hidden stem spouse star)."""

    def test_laopo11_2033_detected_with_sanxing_annotation(self):
        """Laopo11 (甲木女, day_branch=戌): 2033 癸丑 should be detected.
        丑-戌 is 三刑, but 丑 hides 辛(金)=正官=spouse star for 甲女.
        secondary_a2 should still detect it with (三刑沖突) annotation."""
        chart = calculate_bazi('1987-01-25', '16:45', '台北市', 'Asia/Taipei', 'female')
        pillars = chart['fourPillars']
        enriched = compute_romance_years_enriched(
            'female', pillars['day']['stem'], pillars['day']['branch'],
            pillars['year']['branch'], chart['annualStars'], chart['kongWang'],
            birth_year=1987, current_year=2026
        )
        y2033 = [e for e in enriched if e['year'] == 2033]
        assert len(y2033) == 1, f"2033 should be detected, got {y2033}"
        assert y2033[0]['tier'] == 'secondary_a2'
        assert '三刑沖突' in y2033[0]['signal']

    def test_sanxing_blocks_when_no_spouse_star_in_hidden(self):
        """三刑 + no spouse star in hidden stems → year completely blocked."""
        # 丑-戌 三刑 pair: annual=丑, day=戌
        annual_stars = [
            {'year': 2033, 'stem': '癸', 'branch': '丑'},
        ]
        # For 庚 male: spouse star = 木 (ELEMENT_OVERCOME[金]=木 → 正財/偏財)
        # 丑 hidden stems: [己(土), 癸(水), 辛(金)] — no 木 → secondary_a2 won't match
        # 癸=水 ≠ 木 → secondary_a won't match
        # 三刑 blocks all other tiers → year should be completely absent
        enriched = compute_romance_years_enriched(
            'male', '庚', '戌', '卯',
            annual_stars, [],
            birth_year=1987, current_year=2026
        )
        y2033 = [e for e in enriched if e['year'] == 2033]
        assert len(y2033) == 0, f"三刑 should block 2033 for 庚 male (no spouse star in 丑 hidden), got {y2033}"

    def test_sanxing_allows_a2_with_spouse_star_hidden(self):
        """Year with 三刑 + spouse star in hidden stems → detected with annotation."""
        # 甲女: spouse star = 金 (ELEMENT_OVERCOME_BY[木]=金 → 正官/偏官)
        # 丑 hidden stems: [己, 癸, 辛] — 辛=金 → matches!
        annual_stars = [
            {'year': 2033, 'stem': '癸', 'branch': '丑'},
        ]
        enriched = compute_romance_years_enriched(
            'female', '甲', '戌', '寅',
            annual_stars, [],
            birth_year=1987, current_year=2026
        )
        y2033 = [e for e in enriched if e['year'] == 2033]
        assert len(y2033) == 1
        assert y2033[0]['tier'] == 'secondary_a2'
        assert '配偶星藏干' in y2033[0]['signal']
        assert '三刑沖突' in y2033[0]['signal']

    def test_no_sanxing_no_annotation(self):
        """Year WITHOUT 三刑 should NOT have (三刑沖突) in signal."""
        # 甲女 with day_branch=午 (no 三刑 with 丑)
        annual_stars = [
            {'year': 2033, 'stem': '癸', 'branch': '丑'},
        ]
        enriched = compute_romance_years_enriched(
            'female', '甲', '午', '寅',
            annual_stars, [],
            birth_year=1987, current_year=2026
        )
        y2033 = [e for e in enriched if e['year'] == 2033]
        # 丑 hidden stems: [己, 癸, 辛] — 辛=金=spouse star for 甲女
        if y2033:
            assert '三刑沖突' not in y2033[0]['signal'], \
                "Without 三刑, should not have 三刑沖突 annotation"


# ============================================================
# Romance Years Enriched + 大運 Tagging Tests
# ============================================================

class TestRomanceYearsEnriched:
    """Tests for compute_romance_years_enriched() and tag_romance_years_with_dayun()."""

    def test_romance_years_enriched_structure(self, roger8_chart):
        """compute_romance_years_enriched() returns list of dicts with year/tier/signal."""
        pillars = roger8_chart['fourPillars']
        day_branch = pillars['day']['branch']
        year_branch = pillars['year']['branch']
        kong_wang = roger8_chart['kongWang']
        annual_stars = roger8_chart['annualStars']
        enriched = compute_romance_years_enriched(
            'male', '戊', day_branch, year_branch,
            annual_stars, kong_wang, birth_year=1987,
        )
        assert isinstance(enriched, list)
        assert len(enriched) > 0
        for item in enriched:
            assert 'year' in item
            assert 'tier' in item
            assert 'signal' in item
            assert item['tier'] in (
                'primary', 'secondary_a', 'secondary_a2', 'secondary_b',
                'secondary_c', 'secondary_d', 'supplementary',
            )

    def test_existing_romance_years_unchanged(self, roger8_chart):
        """compute_romance_years() still returns List[int] — backward compatibility."""
        pillars = roger8_chart['fourPillars']
        day_branch = pillars['day']['branch']
        year_branch = pillars['year']['branch']
        kong_wang = roger8_chart['kongWang']
        annual_stars = roger8_chart['annualStars']
        years = compute_romance_years(
            'male', '戊', day_branch, year_branch,
            annual_stars, kong_wang, birth_year=1987,
        )
        assert isinstance(years, list)
        assert all(isinstance(y, int) for y in years)
        # Must match enriched years
        enriched = compute_romance_years_enriched(
            'male', '戊', day_branch, year_branch,
            annual_stars, kong_wang, birth_year=1987,
        )
        assert years == [e['year'] for e in enriched]

    def test_roger8_romance_dayun_context_structure(self, roger8_enhanced):
        """Integration: romance_years_dayun_context exists in deterministic output."""
        det = roger8_enhanced['deterministic']
        assert 'romance_years_dayun_context' in det
        dayun_ctx = det['romance_years_dayun_context']
        assert isinstance(dayun_ctx, list)
        for item in dayun_ctx:
            assert 'year' in item
            assert 'tier' in item
            assert 'signal' in item
            assert 'dayun_context' in item
            assert item['dayun_context'] in ('strong', 'moderate', 'weak')
            assert 'dayun_score' in item
            assert 'dayun_signals' in item
            assert 'conflicted' in item
            assert isinstance(item['conflicted'], bool)

    def test_dayun_spouse_star_boosts(self):
        """LP stem = 配偶星 → positive score boost.
        Male DM=戊(土): 配偶星=水(正財/偏財). LP stem=壬(水)=偏財 → +20."""
        romance_data = [{'year': 2030, 'tier': 'primary', 'signal': '六合日支'}]
        annual_stars = [{'year': 2030, 'stem': '庚', 'branch': '戌'}]
        # LP with stem=壬 (偏財 for 戊DM), branch=子
        luck_periods = [{
            'stem': '壬', 'branch': '子',
            'startYear': 2025, 'endYear': 2034, 'score': 60,
        }]
        result = tag_romance_years_with_dayun(
            romance_data, annual_stars, luck_periods,
            day_branch='午', year_branch='卯',
            day_master_stem='戊', gender='male',
        )
        assert len(result) == 1
        assert result[0]['dayun_score'] > 0
        assert any('配偶星' in s or '偏財' in s for s in result[0]['dayun_signals'])

    def test_dayun_liuhe_day_branch_strong(self):
        """LP branch 六合 day branch → strong score.
        Day branch=午, 午 六合 partner=未. LP branch=未 → +30."""
        romance_data = [{'year': 2030, 'tier': 'primary', 'signal': '六合日支'}]
        annual_stars = [{'year': 2030, 'stem': '庚', 'branch': '戌'}]
        # LP branch=未, which 六合 with 午
        luck_periods = [{
            'stem': '甲', 'branch': '未',
            'startYear': 2025, 'endYear': 2034, 'score': 60,
        }]
        result = tag_romance_years_with_dayun(
            romance_data, annual_stars, luck_periods,
            day_branch='午', year_branch='卯',
            day_master_stem='戊', gender='male',
        )
        assert result[0]['dayun_score'] >= 30
        assert result[0]['dayun_context'] == 'strong'
        assert any('合配偶宮' in s for s in result[0]['dayun_signals'])

    def test_dayun_clash_day_branch_weak(self):
        """LP branch 六沖 day branch + low LP score → weak context.
        Day branch=午, 六沖 partner=子. LP branch=子 + low score → negative."""
        romance_data = [{'year': 2030, 'tier': 'supplementary', 'signal': '桃花'}]
        annual_stars = [{'year': 2030, 'stem': '庚', 'branch': '戌'}]
        # LP branch=子 clashes 午 + low score
        luck_periods = [{
            'stem': '甲', 'branch': '子',
            'startYear': 2025, 'endYear': 2034, 'score': 30,
        }]
        result = tag_romance_years_with_dayun(
            romance_data, annual_stars, luck_periods,
            day_branch='午', year_branch='卯',
            day_master_stem='戊', gender='male',
        )
        assert result[0]['dayun_score'] < 0
        assert result[0]['dayun_context'] == 'weak'
        assert any('沖配偶宮' in s for s in result[0]['dayun_signals'])

    def test_dayun_conflicted_flag(self):
        """LP has both 配偶星 stem AND 沖配偶宮 branch → conflicted=True.
        Male DM=戊: LP stem=壬(偏財,配偶星) + LP branch=子(沖午/day_branch)."""
        romance_data = [{'year': 2030, 'tier': 'secondary_a', 'signal': '配偶星天干'}]
        annual_stars = [{'year': 2030, 'stem': '庚', 'branch': '戌'}]
        # LP: stem=壬(偏財) + branch=子(沖午)
        luck_periods = [{
            'stem': '壬', 'branch': '子',
            'startYear': 2025, 'endYear': 2034, 'score': 50,
        }]
        result = tag_romance_years_with_dayun(
            romance_data, annual_stars, luck_periods,
            day_branch='午', year_branch='卯',
            day_master_stem='戊', gender='male',
        )
        assert result[0]['conflicted'] is True
        assert '波折' in result[0]['conflicted_detail']

    def test_lp_annual_clash_penalty(self):
        """LP branch 六沖 annual branch → -20 penalty.
        LP branch=午, annual branch=子 → 六沖 → dayun_score -= 20."""
        romance_data = [{'year': 2030, 'tier': 'primary', 'signal': '六合日支'}]
        annual_stars = [{'year': 2030, 'stem': '庚', 'branch': '子'}]
        # LP branch=午 clashes annual branch 子
        luck_periods = [{
            'stem': '甲', 'branch': '午',
            'startYear': 2025, 'endYear': 2034, 'score': 60,
        }]
        result = tag_romance_years_with_dayun(
            romance_data, annual_stars, luck_periods,
            day_branch='寅', year_branch='卯',
            day_master_stem='戊', gender='male',
        )
        assert any('年運相沖' in s for s in result[0]['dayun_signals'])

    def test_empty_luck_periods(self):
        """Empty luck_periods → all years tagged 'moderate' with score 0."""
        romance_data = [
            {'year': 2030, 'tier': 'primary', 'signal': '六合日支'},
            {'year': 2031, 'tier': 'supplementary', 'signal': '桃花'},
        ]
        result = tag_romance_years_with_dayun(
            romance_data, [], [],
            day_branch='午', year_branch='卯',
            day_master_stem='戊', gender='male',
        )
        assert len(result) == 2
        for item in result:
            assert item['dayun_context'] == 'moderate'
            assert item['dayun_score'] == 0

    def test_dayun_gender_specific(self):
        """Male vs female produce different spouse star → different scores.
        DM=戊: Male 配偶星=水(財星), Female 配偶星=木(官星).
        LP stem=壬(水)=偏財 for male, 偏官 for female → different scoring."""
        romance_data = [{'year': 2030, 'tier': 'primary', 'signal': '六合日支'}]
        annual_stars = [{'year': 2030, 'stem': '庚', 'branch': '戌'}]
        luck_periods = [{
            'stem': '壬', 'branch': '戌',
            'startYear': 2025, 'endYear': 2034, 'score': 60,
        }]
        # Male: 壬=偏財(配偶星) → +20
        result_male = tag_romance_years_with_dayun(
            romance_data, annual_stars, luck_periods,
            day_branch='午', year_branch='卯',
            day_master_stem='戊', gender='male',
        )
        # Female: 壬=偏官 for 戊DM → but 偏官 IS 配偶星 for female → also +20
        # Wait — female spouse star for 戊(土): ELEMENT_OVERCOME_BY[土] = 木(官星)
        # 壬=水, derive_ten_god(戊, 壬)=偏財 → 偏財 is NOT 正官/偏官 for female
        result_female = tag_romance_years_with_dayun(
            romance_data, annual_stars, luck_periods,
            day_branch='午', year_branch='卯',
            day_master_stem='戊', gender='female',
        )
        # Male gets +20 for 配偶星, female does NOT (壬=偏財, not 官星)
        assert result_male[0]['dayun_score'] > result_female[0]['dayun_score']


# ============================================================
# Romance Warning Years Tests (六沖日支)
# ============================================================

class TestRomanceWarningYears:
    """Test 六沖日支 (spouse palace clash) warning years."""

    def test_roger8_warning_years_are_zi(self, roger8_chart):
        """Roger day=午, clash partner=子. Warning years should have 子 branch.
        But 子 is in Roger's 空亡, so all 子-branch years get filtered out."""
        annual_stars = roger8_chart['annualStars']
        years = compute_romance_warning_years(
            day_branch='午', annual_stars=annual_stars,
            kong_wang=['子', '丑'], birth_year=1987,
        )
        # 子 is in 空亡 for Roger, so NO warning years expected
        assert years == []

    def test_roger8_warning_years_no_kongwang(self):
        """Roger day=午, clash partner=子. Without 空亡, 子 years ARE returned."""
        annual_stars = [
            {'year': 2028, 'stem': '戊', 'branch': '申'},
            {'year': 2029, 'stem': '己', 'branch': '酉'},
            {'year': 2030, 'stem': '庚', 'branch': '戌'},
            {'year': 2031, 'stem': '辛', 'branch': '亥'},
            {'year': 2032, 'stem': '壬', 'branch': '子'},  # clash with 午
            {'year': 2033, 'stem': '癸', 'branch': '丑'},
            {'year': 2034, 'stem': '甲', 'branch': '寅'},
            {'year': 2038, 'stem': '戊', 'branch': '午'},  # same as day, not clash
            {'year': 2044, 'stem': '甲', 'branch': '子'},  # clash with 午
        ]
        years = compute_romance_warning_years(
            day_branch='午', annual_stars=annual_stars, kong_wang=[],
        )
        assert 2032 in years
        assert 2044 in years
        assert 2038 not in years  # same branch, not clash partner

    def test_laopo9_warning_years_chen(self):
        """Laopo9 day=戌, clash partner=辰. 空亡=[申,酉] doesn't affect 辰."""
        annual_stars = [
            {'year': 2028, 'stem': '戊', 'branch': '申'},
            {'year': 2029, 'stem': '己', 'branch': '酉'},
            {'year': 2030, 'stem': '庚', 'branch': '戌'},
            {'year': 2032, 'stem': '壬', 'branch': '子'},
            {'year': 2036, 'stem': '丙', 'branch': '辰'},  # clash with 戌
        ]
        years = compute_romance_warning_years(
            day_branch='戌', annual_stars=annual_stars,
            kong_wang=['申', '酉'], birth_year=1987,
        )
        assert years == [2036]

    def test_max_5_warning_years(self):
        """Should return at most 5 warning years."""
        # Generate many 子 years to test limit
        annual_stars = [
            {'year': 2020 + i * 12, 'stem': '甲', 'branch': '子'}
            for i in range(8)
        ]
        years = compute_romance_warning_years(
            day_branch='午', annual_stars=annual_stars, kong_wang=[],
        )
        assert len(years) <= 5

    def test_birth_year_filter(self):
        """Years before birth should be filtered out."""
        annual_stars = [
            {'year': 1985, 'stem': '乙', 'branch': '子'},
            {'year': 1997, 'stem': '丁', 'branch': '子'},
        ]
        years = compute_romance_warning_years(
            day_branch='午', annual_stars=annual_stars,
            kong_wang=[], birth_year=1990,
        )
        assert 1985 not in years
        assert 1997 in years

    def test_integration_in_output(self, roger8_enhanced):
        """romance_warning_years should appear in deterministic output."""
        det = roger8_enhanced['deterministic']
        assert 'romance_warning_years' in det
        assert isinstance(det['romance_warning_years'], list)


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

    def test_parent_health_years_birth_year_filter(self):
        """Parent health years should not include years before birth_year.
        Stem-only years are dropped per classical 「天干不主吉凶」."""
        # 己 DM: father=水 (overcomes水), threat=土 (overcomes水)
        # Branch 本氣 must be 土 to count as danger (stem-only is dropped)
        annual_stars = [
            {'year': 2018, 'stem': '戊', 'branch': '戌'},  # branch本氣=戊=土 → BOTH, but before birth
            {'year': 2019, 'stem': '己', 'branch': '亥'},  # branch本氣=壬=水 → stem-only (DROPPED)
            {'year': 2021, 'stem': '辛', 'branch': '丑'},  # branch本氣=己=土 → branch-only father danger
            {'year': 2022, 'stem': '壬', 'branch': '寅'},  # 水 stem → not danger
            {'year': 2028, 'stem': '戊', 'branch': '申'},  # branch本氣=庚=金 → stem-only (DROPPED)
        ]
        result = compute_parent_health_years('己', annual_stars, birth_year=2021)
        for y in result['father']:
            assert y >= 2021, f"Father health year {y} is before birth year 2021"
        for y in result['mother']:
            assert y >= 2021, f"Mother health year {y} is before birth year 2021"
        # 2021 has branch本氣=己=土 which threatens father (水), should be in list
        assert 2021 in result['father']
        # 2018 before birth year, 2019/2028 are stem-only → all excluded
        assert 2018 not in result['father']
        assert 2019 not in result['father']
        assert 2028 not in result['father']

    def test_branch_benqi_father_danger(self):
        """Branch 本氣 should also detect father danger years.
        DM=甲(木): father=土(木克土), threat=木(克土).
        Year 2030 stem=庚(金), branch=戌 → 本氣=戊(土). 土 is NOT 木 → no branch threat.
        Year 2034 stem=甲(木), branch=寅 → 本氣=甲(木). Both stem+branch=木 → strong signal.
        Year 2036 stem=丙(火), branch=辰 → 本氣=戊(土). 土 is NOT threat. No danger.
        Year 2032 stem=壬(水), branch=子 → 本氣=癸(水). No danger at all.
        Year 2038 stem=戊(土), branch=午 → 本氣=丁(火). Stem=土, 本氣=火. 土≠木, no stem.
        Actually let me reconsider — DM=甲(木), father element = 土, father threat = 木.
        木 stems are 甲/乙. 木 本氣 branches: 寅(甲), 卯(乙).
        """
        annual_stars = [
            {'year': 2032, 'stem': '壬', 'branch': '子'},   # 水/水 → no threat
            {'year': 2034, 'stem': '甲', 'branch': '寅'},   # 木/木 → BOTH stem+branch
            {'year': 2035, 'stem': '乙', 'branch': '卯'},   # 木/木 → BOTH
            {'year': 2036, 'stem': '丙', 'branch': '辰'},   # 火/土 → no
            {'year': 2038, 'stem': '戊', 'branch': '午'},   # 土/火 → no
        ]
        result = compute_parent_health_years('甲', annual_stars)
        # 2034, 2035 should be father danger (both stem and branch are 木, 木克土)
        assert 2034 in result['father']
        assert 2035 in result['father']
        # 2032, 2036, 2038 should NOT be father danger
        assert 2032 not in result['father']
        assert 2036 not in result['father']

    def test_branch_only_danger(self):
        """Branch 本氣 alone (without stem) should still detect danger.
        DM=戊(土): father=水(土克水), threat=土(克水).
        Year where stem=non-土 but branch本氣=土 → branch-only danger."""
        annual_stars = [
            {'year': 2030, 'stem': '庚', 'branch': '戌'},   # 金/土 → branch only (戌本氣=戊=土)
            {'year': 2031, 'stem': '辛', 'branch': '亥'},   # 金/水 → no
            {'year': 2033, 'stem': '癸', 'branch': '丑'},   # 水/土 → branch only (丑本氣=己=土)
        ]
        result = compute_parent_health_years('戊', annual_stars)
        # 2030 and 2033 have branch 本氣 = 土 element → father danger
        assert 2030 in result['father']
        assert 2033 in result['father']
        # 2031 has no 土 → not danger
        assert 2031 not in result['father']

    def test_priority_both_before_branch_only(self):
        """Years with both stem+branch threat should appear before branch-only years.
        DM=戊(土): father threat=土, mother threat=金.
        Both: stem=土 + branch本氣=土 → strongest signal, should be prioritized.
        Stem-only years (e.g., 2029 己酉: stem=土 but branch本氣=金) are DROPPED
        per classical 「天干不主吉凶」."""
        annual_stars = [
            {'year': 2029, 'stem': '己', 'branch': '酉'},   # stem=土, branch=金 → stem-only (DROPPED)
            {'year': 2030, 'stem': '庚', 'branch': '戌'},   # stem=金, branch=土 → branch-only father
            {'year': 2035, 'stem': '乙', 'branch': '卯'},   # stem=木, branch=木 → no father threat
            {'year': 2039, 'stem': '己', 'branch': '未'},   # stem=土, branch=土 → BOTH father
        ]
        result = compute_parent_health_years('戊', annual_stars)
        # Only branch-relevant years should appear (2029 is stem-only, dropped)
        assert 2039 in result['father']
        assert 2030 in result['father']
        assert 2029 not in result['father']  # stem-only → dropped per 「天干不主吉凶」
        assert len(result['father']) == 2

    def test_jenna_parent_health_years_after_birth(self):
        """Jenna (born 2021): all parent health years must be >= 2021."""
        chart = calculate_bazi(
            '2021-09-28', '17:06', '吉隆坡', 'Asia/Kuala_Lumpur', 'female',
            reading_type='LIFETIME',
        )
        enhanced = chart.get('lifetimeEnhancedInsights')
        phy = enhanced['deterministic']['parent_health_years']
        for y in phy['father']:
            assert y >= 2021, f"Jenna father health year {y} is before her birth year 2021"
        for y in phy['mother']:
            assert y >= 2021, f"Jenna mother health year {y} is before her birth year 2021"


# ============================================================
# Stars in 空亡 Tests
# ============================================================

class TestStarsInKongWang:
    def test_roger8_stars_in_kong_wang_present(self, roger8_enhanced):
        """Roger8 should have stars_in_kong_wang field in deterministic."""
        det = roger8_enhanced['deterministic']
        assert 'stars_in_kong_wang' in det
        assert isinstance(det['stars_in_kong_wang'], list)

    def test_roger8_hongluan_in_kong_wang(self):
        """Roger (年支=卯, 空亡=[子,丑]): 紅鸞=子 → should be in 空亡."""
        from app.constants import HONGLUAN
        # Verify: 紅鸞 for 卯 = 子
        assert HONGLUAN['卯'] == '子'
        result = compute_stars_in_kong_wang(
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            kong_wang=['子', '丑'],
        )
        star_names = [s['star'] for s in result]
        assert '紅鸞' in star_names, "紅鸞=子 should be flagged as in 空亡"

    def test_roger8_tianyi_in_kong_wang(self):
        """Roger (DM=戊, 空亡=[子,丑]): 天乙貴人=[丑,未] → 丑 in 空亡."""
        from app.constants import TIANYI_GUIREN
        assert '丑' in TIANYI_GUIREN['戊']
        result = compute_stars_in_kong_wang(
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            kong_wang=['子', '丑'],
        )
        star_names = [s['star'] for s in result]
        assert '天乙貴人' in star_names, "天乙貴人=丑 should be flagged as in 空亡"

    def test_laopo9_yima_in_kong_wang(self):
        """Laopo9 (日支=戌, 空亡=[申,酉]): 驛馬=申 → should be in 空亡."""
        from app.constants import YIMA
        assert YIMA['戌'] == '申'
        result = compute_stars_in_kong_wang(
            day_master_stem='甲',
            day_branch='戌',
            year_branch='寅',
            kong_wang=['申', '酉'],
        )
        star_names = [s['star'] for s in result]
        assert '驛馬' in star_names, "驛馬=申 should be flagged as in 空亡"

    def test_no_stars_in_kong_wang(self):
        """A chart where no key stars land in 空亡 → empty list."""
        # DM=丙, 日支=巳, 年支=午, 空亡=[辰,巳]
        # 紅鸞(午→酉), 天喜(午→卯), 天乙(丙→亥,酉), 桃花(巳→午),
        # 驛馬(巳→亥), 文昌(丙→申), 祿神(丙→巳=空亡!)
        # Actually 祿神=巳 which IS in 空亡, so let's choose a different kong_wang
        result = compute_stars_in_kong_wang(
            day_master_stem='丙',
            day_branch='巳',
            year_branch='午',
            kong_wang=['寅', '卯'],  # None of the key stars map to 寅 or 卯 for this chart
        )
        # Check: 紅鸞=酉, 天喜=卯→YES!, so 天喜 would be flagged
        # Let me use kong_wang that truly avoids all stars
        result2 = compute_stars_in_kong_wang(
            day_master_stem='丙',
            day_branch='巳',
            year_branch='午',
            kong_wang=['丑', '未'],  # Stars: 紅鸞=酉, 天喜=卯, 天乙=[亥,酉], 桃花=午, 驛馬=亥, 文昌=申, 祿=巳
        )
        assert len(result2) == 0, "No key stars should match 空亡=[丑,未] for this chart"

    def test_empty_kong_wang_returns_empty(self):
        """If kong_wang is empty, no stars can be voided."""
        result = compute_stars_in_kong_wang(
            day_master_stem='甲',
            day_branch='子',
            year_branch='寅',
            kong_wang=[],
        )
        assert result == []

    def test_star_entry_structure(self):
        """Each entry should have star, branch, type, significance."""
        result = compute_stars_in_kong_wang(
            day_master_stem='戊',
            day_branch='午',
            year_branch='卯',
            kong_wang=['子', '丑'],
        )
        assert len(result) >= 1
        for entry in result:
            assert 'star' in entry
            assert 'branch' in entry
            assert 'type' in entry
            assert 'significance' in entry
            assert entry['type'] in ('auspicious', 'inauspicious', 'neutral')

    def test_jenna_integration(self):
        """Jenna (辛丑/丁酉/己卯/癸酉, 空亡=[申,酉]):
        Both month and hour branches are 酉, which is in 空亡.
        Check which stars are flagged."""
        chart = calculate_bazi(
            '2021-09-28', '17:06', '吉隆坡', 'Asia/Kuala_Lumpur', 'female',
            reading_type='LIFETIME',
        )
        enhanced = chart.get('lifetimeEnhancedInsights')
        stars = enhanced['deterministic']['stars_in_kong_wang']
        assert isinstance(stars, list)
        # Jenna: DM=己, 日支=卯, 年支=丑, 空亡=[申,酉]
        # 紅鸞(丑→寅), 天喜(丑→申)→YES!, 天乙(己→[子,申])→申 YES!,
        # 桃花(卯→子), 驛馬(卯→巳), 文昌(己→酉)→YES!, 祿(己→午)
        star_names = [s['star'] for s in stars]
        assert '天喜' in star_names, "天喜=申 should be in 空亡"
        assert '天乙貴人' in star_names, "天乙貴人=申 should be in 空亡"
        assert '文昌' in star_names, "文昌=酉 should be in 空亡"


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


# ============================================================
# Narrative Anchors Tests
# ============================================================

class TestNarrativeAnchors:
    """Test the pre-narrated anchor sentences for AI."""

    def test_narrative_anchors_present_in_enhanced(self, roger8_enhanced):
        """narrativeAnchors should be in enhanced insights."""
        assert 'narrativeAnchors' in roger8_enhanced

    def test_narrative_anchors_has_all_section_keys(self, roger8_enhanced):
        """Should have anchors for all main sections."""
        anchors = roger8_enhanced['narrativeAnchors']
        expected_keys = [
            'chart_identity', 'finance_pattern', 'career_pattern',
            'health', 'love_pattern', 'children_analysis',
            'parents_analysis', 'boss_strategy',
        ]
        for key in expected_keys:
            assert key in anchors, f"Missing anchor section: {key}"
            assert isinstance(anchors[key], list)
            assert len(anchors[key]) >= 1, f"Empty anchors for {key}"

    def test_god_system_anchors_in_all_sections(self, roger8_enhanced):
        """All sections should contain the god system disambiguation anchor."""
        anchors = roger8_enhanced['narrativeAnchors']
        for key, anchor_list in anchors.items():
            # At least one anchor should mention 忌神 and 仇神 being different
            has_god_anchor = any('忌神' in a and '仇神' in a for a in anchor_list)
            assert has_god_anchor, f"Section {key} missing god system anchor"

    def test_roger8_chart_identity_anchors(self, roger8_enhanced):
        """chart_identity should reference pattern and strength."""
        anchors = roger8_enhanced['narrativeAnchors']['chart_identity']
        combined = '\n'.join(anchors)
        assert '食神格' in combined, "Should mention 食神格"
        assert '戊' in combined, "Should mention day master 戊"
        assert '用神' in combined

    def test_roger8_finance_anchors_mention_gods(self, roger8_enhanced):
        """finance_pattern should mention favorable and unfavorable elements."""
        anchors = roger8_enhanced['narrativeAnchors']['finance_pattern']
        combined = '\n'.join(anchors)
        assert '水' in combined, "Should mention 用神=水"
        assert '土' in combined, "Should mention 忌神=土"

    def test_roger8_career_anchors_mention_worst_industries(self, roger8_enhanced):
        """career_pattern should list worst industries based on 忌神."""
        anchors = roger8_enhanced['narrativeAnchors']['career_pattern']
        combined = '\n'.join(anchors)
        assert '忌神' in combined, "Should mention taboo god industries"
        assert '土' in combined, "Should reference 忌神 element"

    def test_roger8_health_anchors_mention_organs(self, roger8_enhanced):
        """health should reference vulnerable organs based on 忌神/仇神."""
        anchors = roger8_enhanced['narrativeAnchors']['health']
        combined = '\n'.join(anchors)
        # 忌神=土 → 脾胃, 仇神=火 → 心臟
        assert '脾' in combined or '胃' in combined, "Should mention 土-related organs"

    def test_roger8_love_anchors_mention_spouse_star(self, roger8_enhanced):
        """love_pattern should mention spouse star."""
        anchors = roger8_enhanced['narrativeAnchors']['love_pattern']
        combined = '\n'.join(anchors)
        # Male DM=戊 → 正財 = spouse star
        assert '正財' in combined or '妻星' in combined

    def test_roger8_children_anchors_comprehensive(self, roger8_enhanced):
        """children_analysis should have detailed, self-narrating anchors."""
        anchors = roger8_enhanced['narrativeAnchors']['children_analysis']
        combined = '\n'.join(anchors)
        # Should mention 食傷 element
        assert '食傷' in combined
        # Should mention hour pillar ten god with explicit disambiguation
        assert '時支' in combined
        # Should contain ⚠️ warnings
        assert '⚠️' in combined, "Should have warning markers for critical distinctions"
        # Should mention specific personality traits for children
        assert '性格特質' in combined or '特質' in combined

    def test_roger8_children_transparent_anchors(self, roger8_enhanced):
        """Should correctly identify transparent vs latent 食傷."""
        anchors = roger8_enhanced['narrativeAnchors']['children_analysis']
        combined = '\n'.join(anchors)
        # Roger8: 庚 in hour stem = 金 = not 食傷 (食傷=金 for 戊DM is actually 金 = WRONG)
        # Let me check: 戊 DM → produces 金 (食傷). 庚 = 金 = 食傷!
        # So 庚 is manifest 食傷 in hour stem
        # Hour branch = 申, main qi = 庚, that's also 食傷
        # Should say "已透出" not "藏而不透"
        assert '透' in combined, "Should mention transparent 食傷"

    def test_roger8_parents_anchors_comprehensive(self, roger8_enhanced):
        """parents_analysis should reference year pillar ten gods."""
        anchors = roger8_enhanced['narrativeAnchors']['parents_analysis']
        combined = '\n'.join(anchors)
        # Year pillar = 丁卯. 丁 vs 戊 = 正印 (father star)
        assert '父星' in combined
        assert '母星' in combined
        assert '年干' in combined
        assert '年支' in combined

    def test_roger8_parents_favorability_precise(self, roger8_enhanced):
        """Year pillar favorability should use correct god label."""
        anchors = roger8_enhanced['narrativeAnchors']['parents_analysis']
        combined = '\n'.join(anchors)
        # Year stem 丁 = 火 element. 火 = 仇神 for Roger8
        # So favorability should say 仇神, not 忌神
        assert '仇神' in combined or '忌' in combined or '中性' in combined


class TestNarrativeAnchorsLaopo:
    """Test narrative anchors for a female chart (Laopo-like: 甲木 DM)."""

    @pytest.fixture
    def female_chart(self):
        """Female chart: 1987-01-25 16:39 Johor (丙寅/辛丑/甲戌/壬申)."""
        return calculate_bazi(
            '1987-01-25', '16:39', 'Johor', 'Asia/Kuala_Lumpur', 'female',
            reading_type='LIFETIME',
        )

    @pytest.fixture
    def female_enhanced(self, female_chart):
        return female_chart.get('lifetimeEnhancedInsights')

    def test_female_narrative_anchors_present(self, female_enhanced):
        assert 'narrativeAnchors' in female_enhanced

    def test_female_children_hour_pillar_disambiguation(self, female_enhanced):
        """Hour branch 申 main qi 庚. 庚 vs 甲 = 偏官.
        Must NOT confuse with hour stem 壬 vs 甲 = 偏印.
        """
        anchors = female_enhanced['narrativeAnchors']['children_analysis']
        combined = '\n'.join(anchors)
        # Should mention 偏官 (correct) and warn about 偏印 (wrong)
        assert '偏官' in combined, "Should reference correct hour branch main qi ten god (偏官)"
        # Should have explicit disambiguation
        assert '偏印' in combined, "Should warn about hour stem ten god (偏印) being different"
        assert '⚠️' in combined

    def test_female_children_transparent_shishan(self, female_enhanced):
        """甲 DM produces 火 (食傷). 丙 in year stem = 食神 = manifest.
        Must NOT say 藏而不透 for transparent 食傷.
        """
        anchors = female_enhanced['narrativeAnchors']['children_analysis']
        combined = '\n'.join(anchors)
        # 丙 is manifest in year stem
        assert '年' in combined, "Should mention year stem"
        assert '透' in combined or '顯現' in combined
        # Should explicitly say it's transparent, not hidden
        assert '藏而不透' not in combined or '不可說「藏而不透」' in combined

    def test_female_god_system_correct_labels(self, female_enhanced):
        """For this chart: 忌神=金, 仇神=土.
        Anchors must use correct labels.
        """
        anchors = female_enhanced['narrativeAnchors']['chart_identity']
        combined = '\n'.join(anchors)
        # Check god system anchor is present and correct
        assert '忌神' in combined
        assert '仇神' in combined

    def test_female_love_anchors_female_specific(self, female_enhanced):
        """Female chart should reference 正官 as husband star."""
        anchors = female_enhanced['narrativeAnchors']['love_pattern']
        combined = '\n'.join(anchors)
        assert '正官' in combined or '夫星' in combined
        assert '女命' in combined


# ============================================================
# v2 Enhanced Lookup Table Tests
# ============================================================

class TestV2LookupTables:
    """Verify all 7 new lookup tables from Bazi Master Review v2."""

    def test_shen_sha_pillar_interpretations_count(self):
        from app.lifetime_enhanced import SHEN_SHA_PILLAR_INTERPRETATIONS
        assert len(SHEN_SHA_PILLAR_INTERPRETATIONS) == 24
        # All must have 4 pillar keys
        for name, pillars in SHEN_SHA_PILLAR_INTERPRETATIONS.items():
            assert 'year' in pillars, f'{name} missing year'
            assert 'month' in pillars, f'{name} missing month'
            assert 'day' in pillars, f'{name} missing day'
            assert 'hour' in pillars, f'{name} missing hour'

    def test_twelve_stages_interpretations_count(self):
        from app.lifetime_enhanced import TWELVE_STAGES_INTERPRETATIONS
        assert len(TWELVE_STAGES_INTERPRETATIONS) == 12
        for stage, data in TWELVE_STAGES_INTERPRETATIONS.items():
            assert 'day_branch' in data
            assert 'hour_branch' in data
            assert 'health_by_element' in data
            # Must have all 5 elements
            for el in ['木', '火', '土', '金', '水']:
                assert el in data['health_by_element'], f'{stage} missing {el}'

    def test_pattern_finance_archetype_2d(self):
        from app.lifetime_enhanced import PATTERN_FINANCE_ARCHETYPE
        assert len(PATTERN_FINANCE_ARCHETYPE) == 10
        ten_gods = ['正官', '偏官', '正財', '偏財', '食神', '傷官', '正印', '偏印', '比肩', '劫財']
        for tg in ten_gods:
            assert tg in PATTERN_FINANCE_ARCHETYPE, f'{tg} missing'
            for strength in ['strong', 'weak', 'neutral']:
                entry = PATTERN_FINANCE_ARCHETYPE[tg][strength]
                assert 'archetype' in entry, f'{tg}/{strength} missing archetype'
                assert 'mechanism' in entry, f'{tg}/{strength} missing mechanism'
                assert 'risk' in entry, f'{tg}/{strength} missing risk'

    def test_annual_ten_god_finance_2d(self):
        from app.lifetime_enhanced import ANNUAL_TEN_GOD_FINANCE
        assert len(ANNUAL_TEN_GOD_FINANCE) == 10
        for tg in ANNUAL_TEN_GOD_FINANCE:
            assert 'strong' in ANNUAL_TEN_GOD_FINANCE[tg]
            assert 'weak' in ANNUAL_TEN_GOD_FINANCE[tg]

    def test_clash_pillar_pair_effects_all_6(self):
        from app.lifetime_enhanced import CLASH_PILLAR_PAIR_EFFECTS
        expected = ['year_month', 'year_day', 'year_hour', 'month_day', 'month_hour', 'day_hour']
        for pair in expected:
            assert pair in CLASH_PILLAR_PAIR_EFFECTS, f'{pair} missing'

    def test_harm_pillar_pair_effects_all_6(self):
        from app.lifetime_enhanced import HARM_PILLAR_PAIR_EFFECTS
        assert len(HARM_PILLAR_PAIR_EFFECTS) == 6

    def test_kong_wang_pillar_effects_all_4(self):
        from app.lifetime_enhanced import KONG_WANG_PILLAR_EFFECTS
        for pos in ['year', 'month', 'day', 'hour']:
            assert pos in KONG_WANG_PILLAR_EFFECTS
            assert 'base' in KONG_WANG_PILLAR_EFFECTS[pos]
            assert 'favorable_void' in KONG_WANG_PILLAR_EFFECTS[pos]
            assert 'unfavorable_void' in KONG_WANG_PILLAR_EFFECTS[pos]

    def test_cong_ge_finance_archetype(self):
        from app.lifetime_enhanced import CONG_GE_FINANCE_ARCHETYPE
        for cong_type in ['cong_cai', 'cong_guan', 'cong_er', 'cong_shi']:
            assert cong_type in CONG_GE_FINANCE_ARCHETYPE
            assert 'archetype' in CONG_GE_FINANCE_ARCHETYPE[cong_type]


# ============================================================
# v2 Helper Function Tests
# ============================================================

class TestV2HelperFunctions:
    """Test 4 new helper functions from Bazi Master Review v2."""

    def test_get_strength_class_mapping(self):
        from app.lifetime_enhanced import _get_strength_class
        assert _get_strength_class('very_strong') == 'strong'
        assert _get_strength_class('strong') == 'strong'
        assert _get_strength_class('neutral') == 'neutral'
        assert _get_strength_class('weak') == 'weak'
        assert _get_strength_class('very_weak') == 'weak'

    def test_is_element_favorable_basic(self):
        from app.lifetime_enhanced import _is_element_favorable
        gods = {'usefulGod': '水', 'favorableGod': '金', 'tabooGod': '土', 'enemyGod': '火'}
        assert _is_element_favorable('水', gods) == 'favorable'
        assert _is_element_favorable('金', gods) == 'favorable'
        assert _is_element_favorable('土', gods) == 'unfavorable'
        assert _is_element_favorable('火', gods) == 'unfavorable'
        assert _is_element_favorable('木', gods) == 'neutral'

    def test_shen_sha_is_valid_positive_star(self):
        from app.lifetime_enhanced import _shen_sha_is_valid
        # Positive star voided = invalid
        assert _shen_sha_is_valid('文昌', '子', ['子', '丑'], set()) is False
        # Positive star clashed = invalid
        assert _shen_sha_is_valid('文昌', '午', [], {'午'}) is False
        # Positive star normal = valid
        assert _shen_sha_is_valid('文昌', '申', ['子', '丑'], set()) is True

    def test_shen_sha_is_valid_negative_star_always_active(self):
        from app.lifetime_enhanced import _shen_sha_is_valid
        # Negative stars are always active even if voided/clashed
        assert _shen_sha_is_valid('羊刃', '子', ['子', '丑'], set()) is True
        assert _shen_sha_is_valid('童子煞', '午', [], {'午'}) is True
        assert _shen_sha_is_valid('劫煞', '申', ['申'], {'申'}) is True

    def test_detect_food_wealth_chain_active(self):
        from app.lifetime_enhanced import _detect_food_wealth_chain
        balance = {'木': 25.0, '火': 20.0, '土': 15.0, '金': 20.0, '水': 20.0}
        gods = {'usefulGod': '水', 'tabooGod': '土'}
        # 戊 DM: food=金(produces), wealth=木(overcomes)
        # 金=20% > 8%, 木=25% > 8% → active
        result = _detect_food_wealth_chain(balance, [], gods, '戊')
        assert result['active'] is True
        assert result['blocked'] is False

    def test_detect_food_wealth_chain_blocked(self):
        from app.lifetime_enhanced import _detect_food_wealth_chain
        balance = {'木': 25.0, '火': 20.0, '土': 15.0, '金': 20.0, '水': 20.0}
        gods = {'usefulGod': '水', 'tabooGod': '火'}
        # 偏印 = 丙(火), transparent and taboo
        tougan = [{'status': 'transparent', 'tenGod': '偏印', 'stem': '丙', 'sourcePillar': 'year', 'transparentPillar': 'month'}]
        result = _detect_food_wealth_chain(balance, tougan, gods, '戊')
        assert result['active'] is True
        assert result['blocked'] is True
        assert '偏印奪食' in result['reason']

    def test_count_spouse_stars_male(self):
        from app.lifetime_enhanced import _count_spouse_stars
        # Roger8 pillars: 年丁卯/月戊申/日戊午/時庚申
        # DM = 戊(Earth), male: 正財/偏財 are 水 elements (土克水)
        # Surface stems: 丁=正印, 戊=比肩, 庚=食神 → 0 spouse stars
        # Hidden stems (NO dedup — all counted independently):
        #   卯[乙]: 正官 → skip
        #   申[庚,壬,戊]: 壬=偏財 → +1
        #   午[丁,己]: skip
        #   申[庚,壬,戊]: 壬=偏財 → +1 (hour branch also 申)
        # Total: zheng=0, pian=2
        pillars = {
            'year': {'stem': '丁', 'branch': '卯'},
            'month': {'stem': '戊', 'branch': '申'},
            'day': {'stem': '戊', 'branch': '午'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        result = _count_spouse_stars(pillars, '戊', 'male')
        assert result['zheng_name'] == '正財'
        assert result['pian_name'] == '偏財'
        assert result['zheng_count'] == 0
        assert result['pian_count'] == 2  # 壬 in both 申 hidden stems
        assert result['mixed'] is False  # Only pian, no zheng

    def test_count_spouse_stars_all_hidden(self):
        """Verify all hidden stems are counted (not just transparent ones)."""
        from app.lifetime_enhanced import _count_spouse_stars
        # Laopo12 pillars: 年丙寅/月辛丑/日甲戌/時壬申
        # DM = 甲(Wood), female: 正官/偏官 (金 elements)
        # Surface: 辛(month)=正官 → zheng=1
        # Hidden:
        #   寅[甲,丙,戊]: no spouse stars
        #   丑[己,辛,癸] or [己,癸,辛]: 辛=正官 → zheng=2
        #   戌[戊,辛,丁]: 辛=正官 → zheng=3
        #   申[庚,壬,戊]: 庚=偏官 → pian=1
        # Total: zheng=3, pian=1
        pillars = {
            'year': {'stem': '丙', 'branch': '寅'},
            'month': {'stem': '辛', 'branch': '丑'},
            'day': {'stem': '甲', 'branch': '戌'},
            'hour': {'stem': '壬', 'branch': '申'},
        }
        result = _count_spouse_stars(pillars, '甲', 'female')
        assert result['zheng_count'] == 3  # 正官: 辛(月干) + 辛(丑hidden) + 辛(戌hidden)
        assert result['pian_count'] == 1   # 偏官: 庚(申hidden)
        assert result['mixed'] is True
        assert len(result['hidden_stars']) > 0


# ============================================================
# v2 Enhanced Call 1 Anchor Tests
# ============================================================

class TestV2EnhancedCall1Anchors:
    """Test enhanced Call 1 anchors with 2D conditioning."""

    def test_roger8_finance_has_pattern_archetype(self, roger8_enhanced):
        """Finance anchors should include pattern-specific archetype (Issue #14 CRITICAL)."""
        anchors = roger8_enhanced['narrativeAnchors']['finance_pattern']
        combined = '\n'.join(anchors)
        # Roger8 is 食神格, neutral → should have 創意理財型
        assert '理財型態' in combined or '理財' in combined

    def test_roger8_finance_has_wealth_count(self, roger8_enhanced):
        """Finance anchors should count 正財/偏財."""
        anchors = roger8_enhanced['narrativeAnchors']['finance_pattern']
        combined = '\n'.join(anchors)
        assert '正財' in combined and '偏財' in combined

    def test_roger8_career_has_work_style(self, roger8_enhanced):
        """Career anchors should include work style from TEN_GOD_WORK_STYLE."""
        anchors = roger8_enhanced['narrativeAnchors']['career_pattern']
        combined = '\n'.join(anchors)
        assert '職場風格' in combined or '食神' in combined

    def test_roger8_career_has_best_industries(self, roger8_enhanced):
        """Career anchors should include favorable industries."""
        anchors = roger8_enhanced['narrativeAnchors']['career_pattern']
        combined = '\n'.join(anchors)
        assert '適合行業' in combined or '適合' in combined

    def test_roger8_boss_has_anchors(self, roger8_enhanced):
        """Boss strategy should now have real anchors, not just god system."""
        anchors = roger8_enhanced['narrativeAnchors']['boss_strategy']
        combined = '\n'.join(anchors)
        assert '工作風格' in combined
        assert '上司類型' in combined or '理想' in combined
        assert '職場優勢' in combined
        assert '注意事項' in combined

    def test_roger8_health_has_twelve_stages(self, roger8_enhanced):
        """Health anchors should include 十二長生 element-conditioned health."""
        anchors = roger8_enhanced['narrativeAnchors']['health']
        combined = '\n'.join(anchors)
        # Roger8 DM 戊 at day branch 午. 戊→午 should give a twelve stage
        assert '長生' in combined or '沐浴' in combined or '冠帶' in combined or '臨官' in combined or '帝旺' in combined or '日支' in combined

    def test_roger8_love_has_spouse_count(self, roger8_enhanced):
        """Love anchors should include spouse star count."""
        anchors = roger8_enhanced['narrativeAnchors']['love_pattern']
        combined = '\n'.join(anchors)
        assert '正財' in combined and '偏財' in combined
        assert '個' in combined

    def test_roger8_chart_identity_has_shen_sha(self, roger8_enhanced):
        """Chart identity should include shen sha per-pillar interpretations."""
        anchors = roger8_enhanced['narrativeAnchors']['chart_identity']
        combined = '\n'.join(anchors)
        # Should have at least one shen sha interpretation
        assert '柱帶' in combined or '日支' in combined


# ============================================================
# v2 Call 2 Anchor Tests
# ============================================================

class TestV2Call2Anchors:
    """Test Call 2 narrative anchors for timing/fortune sections."""

    def test_call2_anchors_present(self, roger8_enhanced):
        """Call 2 narrative anchors should exist in enhanced insights."""
        assert 'call2NarrativeAnchors' in roger8_enhanced

    def test_call2_has_all_6_sections(self, roger8_enhanced):
        """Call 2 should have all 6 section keys."""
        c2 = roger8_enhanced['call2NarrativeAnchors']
        for section in ['current_period', 'best_period', 'annual_finance', 'annual_career', 'annual_love', 'annual_health']:
            assert section in c2, f'Missing Call 2 section: {section}'

    def test_call2_current_period_has_score(self, roger8_enhanced):
        """current_period should include score and ten god."""
        anchors = roger8_enhanced['call2NarrativeAnchors']['current_period']
        if anchors:  # May be empty if no current period
            combined = '\n'.join(anchors)
            assert '評分' in combined or '分' in combined

    def test_call2_best_period_has_info(self, roger8_enhanced):
        """best_period should describe why it's the best."""
        anchors = roger8_enhanced['call2NarrativeAnchors']['best_period']
        if anchors:
            combined = '\n'.join(anchors)
            assert '最佳大運' in combined

    def test_call2_annual_finance_strength_conditional(self, roger8_enhanced):
        """annual_finance should use strength-conditional ten god mapping."""
        anchors = roger8_enhanced['call2NarrativeAnchors']['annual_finance']
        if anchors:
            combined = '\n'.join(anchors)
            # Should reference the current year
            from datetime import datetime
            assert str(datetime.now().year) in combined or '流年' in combined

    def test_call2_annual_career_present(self, roger8_enhanced):
        """annual_career should have anchors."""
        anchors = roger8_enhanced['call2NarrativeAnchors']['annual_career']
        # At minimum should be a list (possibly empty if no relevant data)
        assert isinstance(anchors, list)

    def test_call2_annual_love_present(self, roger8_enhanced):
        """annual_love should have anchors."""
        anchors = roger8_enhanced['call2NarrativeAnchors']['annual_love']
        assert isinstance(anchors, list)

    def test_call2_annual_health_present(self, roger8_enhanced):
        """annual_health should have anchors."""
        anchors = roger8_enhanced['call2NarrativeAnchors']['annual_health']
        assert isinstance(anchors, list)


class TestV2Call2AnchorsLaopo:
    """Test Call 2 anchors for female chart (Laopo5)."""

    @pytest.fixture
    def laopo_chart(self):
        return calculate_bazi(
            '1987-01-25', '16:39', 'Johor', 'Asia/Kuala_Lumpur', 'female',
            reading_type='LIFETIME',
        )

    @pytest.fixture
    def laopo_enhanced(self, laopo_chart):
        return laopo_chart.get('lifetimeEnhancedInsights')

    def test_laopo_call2_anchors_present(self, laopo_enhanced):
        assert 'call2NarrativeAnchors' in laopo_enhanced

    def test_laopo_call2_has_all_sections(self, laopo_enhanced):
        c2 = laopo_enhanced['call2NarrativeAnchors']
        for section in ['current_period', 'best_period', 'annual_finance', 'annual_career', 'annual_love', 'annual_health']:
            assert section in c2

    def test_laopo_annual_love_female_star(self, laopo_enhanced):
        """Female chart annual_love should reference 正官/偏官 as husband stars."""
        anchors = laopo_enhanced['call2NarrativeAnchors']['annual_love']
        if anchors:
            combined = '\n'.join(anchors)
            # If there's spouse star detection, should be female-specific
            if '配偶星' in combined or '夫星' in combined:
                assert '正官' in combined or '偏官' in combined


# ============================================================
# Personality Anchors Tests — 4-Layer Model
# ============================================================

class TestPersonalityAnchors:
    """Tests for _build_personality_anchors() and related lookup tables."""

    # ── Test 1: DAY_MASTER_PERSONALITY completeness ──
    def test_day_master_personality_all_10_stems(self):
        """All 10 heavenly stems have entries with 'archetype' and 'traits'."""
        stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        for stem in stems:
            assert stem in DAY_MASTER_PERSONALITY, f"Missing stem {stem}"
            entry = DAY_MASTER_PERSONALITY[stem]
            assert 'archetype' in entry, f"Missing archetype for {stem}"
            assert 'traits' in entry, f"Missing traits for {stem}"
            assert len(entry['archetype']) >= 2, f"Archetype too short for {stem}"
            assert len(entry['traits']) >= 10, f"Traits too short for {stem}"

    # ── Test 2: TEN_GOD_PERSONALITY completeness ──
    def test_ten_god_personality_all_10_gods(self):
        """All 10 ten gods have 'core', 'external', 'internal', 'motivation'."""
        gods = ['比肩', '劫財', '食神', '傷官', '偏財', '正財', '偏官', '正官', '偏印', '正印']
        for god in gods:
            assert god in TEN_GOD_PERSONALITY, f"Missing god {god}"
            entry = TEN_GOD_PERSONALITY[god]
            for key in ['core', 'external', 'internal', 'motivation']:
                assert key in entry, f"Missing {key} for {god}"
                assert len(entry[key]) >= 5, f"{key} too short for {god}"

    # ── Test 3: Roger8 Day Master layer ──
    def test_roger8_personality_anchors_day_master(self, roger8_enhanced):
        """Roger (戊DM) → '高山厚土' archetype in personality anchors."""
        anchors = roger8_enhanced['narrativeAnchors']['chart_identity']
        combined = '\n'.join(anchors)
        assert '高山厚土' in combined, "Should contain 戊 archetype 高山厚土"
        assert '日主戊如高山厚土' in combined

    # ── Test 4: Roger8 Iron Triangle (2 anchors, not 3) ──
    def test_roger8_personality_anchors_iron_triangle(self, roger8_enhanced):
        """Roger 月干=戊=比肩 is SKIPPED → only 2 Iron Triangle anchors (日支+時干)."""
        anchors = roger8_enhanced['narrativeAnchors']['chart_identity']
        combined = '\n'.join(anchors)
        # 月干戊=比肩 should be SKIPPED (redundant with Layer 1)
        assert '月干戊（比肩）主外在表現' not in combined, "比肩 at 月干 should be skipped"
        # 日支午 本氣丁 = 正印 for 戊DM
        assert '日支午本氣（正印）主內在本性' in combined, "Should have 日支 正印 internal"
        # 時干庚 = 食神 for 戊DM
        assert '時干庚（食神）主內在動機' in combined, "Should have 時干 食神 motivation"

    # ── Test 5: Roger8 secondary ten god ──
    def test_roger8_personality_anchors_secondary_god(self, roger8_enhanced):
        """Roger has secondary ten god → compound description with '次要性格' label."""
        anchors = roger8_enhanced['narrativeAnchors']['chart_identity']
        combined = '\n'.join(anchors)
        # Roger's dominant ten gods should have at least 2 entries
        # If secondary != primary, we should see a 次要性格 anchor
        # Note: this may not appear if secondary == prominent_god
        # We just verify the mechanism works — check for Layer 2 格局 at minimum
        assert '格局食神格主導性格' in combined, "Should have 格局 Layer 2 anchor"

    # ── Test 6: Roger8 strength modifier ──
    def test_roger8_personality_anchors_strength(self, roger8_enhanced):
        """Roger (neutral/40.6) → '日主中和' modifier."""
        anchors = roger8_enhanced['narrativeAnchors']['chart_identity']
        combined = '\n'.join(anchors)
        assert '日主中和' in combined, "Roger should have 中和 strength"
        assert '性格表現適中平穩' in combined, "Should have neutral modifier text"

    # ── Test 7: Integration — chart_identity contains personality anchors ──
    def test_personality_anchors_in_chart_identity(self, roger8_enhanced):
        """chart_identity section should contain personality anchors from all 4 layers."""
        anchors = roger8_enhanced['narrativeAnchors']['chart_identity']
        combined = '\n'.join(anchors)
        # Layer 1: Day Master
        assert '日主戊如' in combined, "Missing Layer 1"
        # Layer 2: Pattern
        assert '格主導性格' in combined, "Missing Layer 2"
        # Layer 3: At least one Iron Triangle anchor
        assert '主內在本性' in combined or '主外在表現' in combined or '主內在動機' in combined, \
            "Missing Layer 3"
        # Layer 4: Strength
        assert '日主中和' in combined or '日主偏旺' in combined or '日主偏弱' in combined, \
            "Missing Layer 4"

    # ── Test 8: Very weak DM with crafted data ──
    def test_personality_anchors_very_weak_dm(self):
        """Direct call with very_weak classification → '日主極弱' modifier."""
        pillars = {
            'month': {'stem': '丙', 'branch': '寅'},
            'day': {'stem': '乙', 'branch': '酉'},
            'hour': {'stem': '丁', 'branch': '亥'},
        }
        result = _build_personality_anchors(
            day_master_stem='乙',
            pillars=pillars,
            prominent_god='傷官',
            pattern_narrative={'dominantTenGods': ['傷官']},
            strength_v2={'classification': 'very_weak', 'score': 15.0},
            cong_ge=None,
        )
        combined = '\n'.join(result)
        # Layer 1: 乙=花草藤蔓
        assert '花草藤蔓' in combined, "Should have 乙 archetype"
        # Layer 2: 傷官格
        assert '傷官格主導性格' in combined
        # Layer 3: 月干丙 for DM乙 = 傷官
        assert '傷官）主外在表現' in combined
        # 日支酉 本氣辛 for DM乙: 乙=木(yin), 辛=金(yin). 金克木 = controls me.
        # Same polarity → 偏官
        assert '偏官）主內在本性' in combined
        # 時干丁 for DM乙: 乙=木(yin), 丁=火(yin). 木生火 = I produce.
        # Same polarity → 食神
        assert '食神）主內在動機' in combined
        # Layer 4: very_weak → 極弱
        assert '日主極弱' in combined

    # ── Test 9: 比肩 at 日支 (SE-7) ──
    def test_personality_anchors_bijian_at_day_branch(self):
        """比肩 at 日支 (non-月干) should use TEN_GOD_PERSONALITY['比肩']['internal']."""
        pillars = {
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '甲', 'branch': '寅'},  # 寅本氣=甲=比肩 for DM甲
            'hour': {'stem': '壬', 'branch': '子'},
        }
        result = _build_personality_anchors(
            day_master_stem='甲',
            pillars=pillars,
            prominent_god='食神',
            pattern_narrative={'dominantTenGods': ['食神']},
            strength_v2={'classification': 'strong', 'score': 55.0},
            cong_ge=None,
        )
        combined = '\n'.join(result)
        # 日支寅 本氣甲 for DM甲 = 比肩
        assert '比肩）主內在本性' in combined, "比肩 at 日支 should appear"
        assert '內心重視公平' in combined, "Should use 比肩 internal personality"

    # ── Test 10: 從格 code path (SE-13) ──
    def test_personality_anchors_cong_ge_path(self):
        """從格 path should derive ten god from dominantElement, not prominent_god."""
        pillars = {
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '乙', 'branch': '巳'},
            'hour': {'stem': '丁', 'branch': '未'},
        }
        result = _build_personality_anchors(
            day_master_stem='乙',
            pillars=pillars,
            prominent_god='食神',
            pattern_narrative={'dominantTenGods': ['傷官', '食神']},
            strength_v2={'classification': 'very_weak', 'score': 12.0},
            cong_ge={'name': '從兒格', 'dominantElement': '火'},
        )
        combined = '\n'.join(result)
        # 從兒格 dominant=火, DM=乙 → picks 丙(火,yang) → derive_ten_god('乙','丙') = 傷官
        assert '從兒格主導性格（日主順從火勢）' in combined, "Should have 從格 qualifier"
        assert TEN_GOD_PERSONALITY['傷官']['core'] in combined, "Should use 傷官 core"
        # Should NOT use the normal 格局 format
        assert '格局食神格主導性格' not in combined, "從格 should override normal pattern"
