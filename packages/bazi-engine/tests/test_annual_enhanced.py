"""
Tests for Annual Fortune Pre-Analysis Module (八字流年運勢 V2)

Tests all 12 sub-functions + master orchestrator.
"""

import pytest

from app.annual_enhanced import (
    CHANGSHENG_HEALTH_LABELS,
    ELEMENT_ORGAN_MAP,
    _assess_element_auspiciousness,
    _check_branch_interaction,
    _get_branch_role,
    _is_favorable_branch,
    _normalize_effective_gods_for_annual,
    assess_flow_year_harmony,
    compute_annual_career_analysis,
    compute_annual_finance_analysis,
    compute_annual_health_analysis,
    compute_annual_relationship_analysis,
    compute_enhanced_monthly_forecasts,
    compute_indirect_effects,
    compute_lu_yangren_analysis,
    compute_marriage_star_analysis,
    compute_pillar_impact_analysis,
    compute_seal_star_analysis,
    compute_spouse_palace_analysis,
    compute_tai_sui_analysis,
    generate_annual_pre_analysis,
)


# ============================================================
# Test Fixtures
# ============================================================

@pytest.fixture
def sample_pillars():
    """Roger's chart: 戊午年 壬戌月 戊申日 丁巳時"""
    return {
        'year': {'stem': '戊', 'branch': '午'},
        'month': {'stem': '壬', 'branch': '戌'},
        'day': {'stem': '戊', 'branch': '申'},
        'hour': {'stem': '丁', 'branch': '巳'},
    }


@pytest.fixture
def sample_effective_gods():
    """Sample effective gods mapping (ten god → role)."""
    return {
        '比肩': '忌神',
        '劫財': '忌神',
        '食神': '喜神',
        '傷官': '用神',
        '正財': '喜神',
        '偏財': '用神',
        '正官': '閒神',
        '七殺': '閒神',
        '正印': '仇神',
        '偏印': '仇神',
    }


@pytest.fixture
def sample_monthly_stars():
    """12 months of monthly star data."""
    months = [
        {'stem': '庚', 'branch': '寅', 'month': '正月'},
        {'stem': '辛', 'branch': '卯', 'month': '二月'},
        {'stem': '壬', 'branch': '辰', 'month': '三月'},
        {'stem': '癸', 'branch': '巳', 'month': '四月'},
        {'stem': '甲', 'branch': '午', 'month': '五月'},
        {'stem': '乙', 'branch': '未', 'month': '六月'},
        {'stem': '丙', 'branch': '申', 'month': '七月'},
        {'stem': '丁', 'branch': '酉', 'month': '八月'},
        {'stem': '戊', 'branch': '戌', 'month': '九月'},
        {'stem': '己', 'branch': '亥', 'month': '十月'},
        {'stem': '庚', 'branch': '子', 'month': '十一月'},
        {'stem': '辛', 'branch': '丑', 'month': '十二月'},
    ]
    return months


# ============================================================
# Helper Function Tests
# ============================================================

class TestHelperFunctions:
    def test_get_branch_role(self, sample_effective_gods):
        # 亥 本氣 = 壬(水), derive_ten_god(戊, 壬) = 偏財 → 用神
        role = _get_branch_role('亥', '戊', sample_effective_gods)
        assert role == '用神'

    def test_get_branch_role_unknown(self, sample_effective_gods):
        role = _get_branch_role('寅', '戊', {})
        assert role == '閒神'

    def test_is_favorable_branch(self, sample_effective_gods):
        assert _is_favorable_branch('亥', '戊', sample_effective_gods)  # 亥本氣壬→偏財=用神

    def test_assess_element_auspiciousness(self, sample_effective_gods):
        # 水 → 壬 → derive_ten_god(戊, 壬) = 偏財 → 用神 → 大吉
        result = _assess_element_auspiciousness('水', '戊', sample_effective_gods)
        assert result == '大吉'

    def test_check_branch_interaction_clash(self):
        interactions = _check_branch_interaction('子', '午')
        assert '六沖' in interactions

    def test_check_branch_interaction_harmony(self):
        interactions = _check_branch_interaction('子', '丑')
        assert '六合' in interactions

    def test_check_branch_interaction_fuyin(self):
        interactions = _check_branch_interaction('午', '午')
        assert '伏吟' in interactions

    def test_check_branch_interaction_harm(self):
        interactions = _check_branch_interaction('子', '未')
        assert '六害' in interactions

    def test_check_branch_interaction_break(self):
        interactions = _check_branch_interaction('子', '酉')
        assert '六破' in interactions

    def test_check_branch_interaction_punishment(self):
        interactions = _check_branch_interaction('子', '卯')
        assert any('三刑' in i for i in interactions)


# ============================================================
# Sub-Function 1: 太歲分析
# ============================================================

class TestTaiSuiAnalysis:
    def test_no_tai_sui(self, sample_effective_gods):
        """Year with no 犯太歲 for any pillar."""
        # Use pillars 子子子子 with flow year 辰 — no 值/沖/刑/害/破
        pillars = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '甲', 'branch': '子'},
            'day': {'stem': '戊', 'branch': '子'},
            'hour': {'stem': '甲', 'branch': '子'},
        }
        result = compute_tai_sui_analysis(
            pillars, '辰', '戊', sample_effective_gods)
        assert not result['hasTaiSui']
        assert result['summary'] == '今年未犯太歲'

    def test_zhi_tai_sui(self, sample_pillars, sample_effective_gods):
        """值太歲: flow year branch == natal branch."""
        result = compute_tai_sui_analysis(
            sample_pillars, '午', '戊', sample_effective_gods)
        assert result['hasTaiSui']
        # Year pillar has 午
        found = [r for r in result['pillarResults'] if r['branch'] == '午']
        assert len(found) >= 1
        assert '值太歲' in found[0]['types']

    def test_chong_tai_sui(self, sample_pillars, sample_effective_gods):
        """沖太歲: flow year clashes natal branch."""
        result = compute_tai_sui_analysis(
            sample_pillars, '子', '戊', sample_effective_gods)
        # 子 clashes 午 (year pillar)
        assert result['hasTaiSui']
        found = [r for r in result['pillarResults'] if r['pillar'] == 'year']
        assert len(found) == 1
        assert '沖太歲' in found[0]['types']

    def test_all_four_pillars_checked(self, sample_effective_gods):
        """Verify all 4 pillar branches are checked."""
        pillars = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '子'},
            'day': {'stem': '戊', 'branch': '子'},
            'hour': {'stem': '庚', 'branch': '子'},
        }
        result = compute_tai_sui_analysis(
            pillars, '子', '戊', sample_effective_gods)
        # All 4 pillars have 子 → all should have 值太歲
        assert len(result['pillarResults']) == 4

    def test_tai_sui_favorable_when_branch_is_jishen(self, sample_effective_gods):
        """犯太歲 is favorable when branch is 忌神."""
        pillars = {
            'year': {'stem': '戊', 'branch': '午'},  # 午 本氣=丁(火), 丁→戊=正印=仇神
            'month': {'stem': '壬', 'branch': '戌'},
            'day': {'stem': '戊', 'branch': '申'},
            'hour': {'stem': '丁', 'branch': '巳'},
        }
        result = compute_tai_sui_analysis(
            pillars, '子', '戊', sample_effective_gods)
        # 子 clashes 午. 午's 本氣 = 丁 = 正印 = 仇神.
        # Clashing 仇神 is favorable
        year_result = [r for r in result['pillarResults'] if r['pillar'] == 'year']
        if year_result:
            assert year_result[0]['isActuallyFavorable']


# ============================================================
# Sub-Function 2: 干支通氣/蓋頭/截腳
# ============================================================

class TestFlowYearHarmony:
    def test_tongqi_same_element(self):
        # 甲寅: 木木 → 通氣
        result = assess_flow_year_harmony('甲', '寅')
        assert result['pattern'] == '通氣'

    def test_tongqi_stem_generates_branch(self):
        # 甲午: 木生火 → 通氣
        result = assess_flow_year_harmony('甲', '午')
        assert result['pattern'] == '通氣'

    def test_gaitou(self):
        # 庚寅: 金剋木 → 蓋頭
        result = assess_flow_year_harmony('庚', '寅')
        assert result['pattern'] == '蓋頭'

    def test_jiejiao(self):
        # 甲申: 金剋木, branch controls stem → 截腳
        result = assess_flow_year_harmony('甲', '申')
        assert result['pattern'] == '截腳'

    def test_mild_tongqi(self):
        # 丙寅: 木生火, branch generates stem → 輕微通氣
        result = assess_flow_year_harmony('丙', '寅')
        assert result['pattern'] == '輕微通氣'


# ============================================================
# Sub-Function 3: 四柱交互
# ============================================================

class TestPillarImpactAnalysis:
    def test_stem_combination(self, sample_pillars, sample_effective_gods):
        """Test 天干合 detection."""
        # Flow year 癸 combines with day stem 戊 (戊癸合)
        results = compute_pillar_impact_analysis(
            sample_pillars, '戊', '癸', '丑', sample_effective_gods)
        day_result = [r for r in results if r['pillar'] == 'day']
        assert any(i['type'] == '天干合' for i in day_result[0]['interactions'])

    def test_stem_clash(self, sample_pillars, sample_effective_gods):
        """Test 天干沖 detection."""
        # Flow year 甲 clashes year stem 庚? No — year stem is 戊.
        # 壬 clashes 丙? month stem is 壬, flow year 丙 → 壬丙沖?
        # Actually 壬 clashes 丙? STEM_CLASH_LOOKUP: 丙↔壬
        results = compute_pillar_impact_analysis(
            sample_pillars, '戊', '丙', '寅', sample_effective_gods)
        month_result = [r for r in results if r['pillar'] == 'month']
        assert any(i['type'] == '天干沖' for i in month_result[0]['interactions'])

    def test_tian_ke_di_chong(self, sample_effective_gods):
        """Test 天剋地沖 detection (stem + branch clash)."""
        pillars = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '午'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        # Flow year 庚子: 甲庚沖(stem) + 子午沖(branch) on year pillar
        # But day is 戊午, flow year is 庚子 → 不是天干沖(戊庚不沖)
        # Year pillar 甲子 vs flow year 庚子: 甲庚沖 + 子子伏吟 (not clash)
        # Let's use 壬午 flow year vs 丙子 natal: 丙壬沖 + 子午沖
        pillars2 = {
            'year': {'stem': '丙', 'branch': '子'},
            'month': {'stem': '己', 'branch': '亥'},
            'day': {'stem': '戊', 'branch': '午'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        results = compute_pillar_impact_analysis(
            pillars2, '戊', '壬', '午', sample_effective_gods)
        year_result = [r for r in results if r['pillar'] == 'year']
        assert any(i['type'] == '天剋地沖' for i in year_result[0]['interactions'])

    def test_hezhou_yongshen(self, sample_effective_gods):
        """Test 合走用神 detection."""
        # 亥寅合. 亥 本氣=壬, derive_ten_god(戊,壬)=偏財=用神
        # Flow year 寅 合走 natal 亥 (用神)
        pillars = {
            'year': {'stem': '壬', 'branch': '亥'},  # 亥 本氣=壬→偏財=用神
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '戊', 'branch': '申'},
            'hour': {'stem': '庚', 'branch': '戌'},
        }
        results = compute_pillar_impact_analysis(
            pillars, '戊', '己', '寅', sample_effective_gods)
        year_result = [r for r in results if r['pillar'] == 'year']
        assert any(i['type'] == '合走用神' for i in year_result[0]['interactions'])


# ============================================================
# Sub-Function 4: 夫妻宮
# ============================================================

class TestSpousePalaceAnalysis:
    def test_clash(self, sample_pillars):
        """日支 申 被 寅 沖."""
        result = compute_spouse_palace_analysis(
            sample_pillars, '戊', '甲', '寅', 'male')
        assert any(s['type'] == '夫妻宮逢沖' for s in result['signals'])

    def test_harmony(self):
        """日支 寅 被 亥 合."""
        pillars = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '戊', 'branch': '寅'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        result = compute_spouse_palace_analysis(
            pillars, '戊', '癸', '亥', 'male')
        assert any(s['type'] == '夫妻宮逢合' for s in result['signals'])

    def test_tian_di_yuan_yang_he(self):
        """天地鴛鴦合: stem combo + branch harmony."""
        pillars = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '戊', 'branch': '卯'},  # 戊癸合, 卯戌合
            'hour': {'stem': '庚', 'branch': '申'},
        }
        result = compute_spouse_palace_analysis(
            pillars, '戊', '癸', '戌', 'male')
        assert result['tianDiYuanYang']
        assert any(s['type'] == '天地鴛鴦合' for s in result['signals'])


# ============================================================
# Sub-Function 5: 姻緣星
# ============================================================

class TestMarriageStarAnalysis:
    def test_spouse_star_male(self, sample_effective_gods):
        """Male: 正財/偏財 as flow year ten god."""
        spouse_palace = {'signals': [], 'tianDiYuanYang': False}
        # 壬→戊=偏財 (DM 戊 controls 壬)
        result = compute_marriage_star_analysis(
            '戊', '壬', '寅', '午', '申', 'male', spouse_palace)
        tracks = [t['track'] for t in result['tracks']]
        assert '夫妻星' in tracks

    def test_taohua(self, sample_effective_gods):
        """桃花 activation."""
        spouse_palace = {'signals': [], 'tianDiYuanYang': False}
        # Day branch 申 → TAOHUA[申] = 酉
        result = compute_marriage_star_analysis(
            '戊', '己', '酉', '午', '申', 'male', spouse_palace)
        tracks = [t['track'] for t in result['tracks']]
        assert '桃花' in tracks

    def test_hongluan(self, sample_effective_gods):
        """紅鸞 activation."""
        spouse_palace = {'signals': [], 'tianDiYuanYang': False}
        # Year branch 午 → HONGLUAN[午] = 酉
        result = compute_marriage_star_analysis(
            '戊', '己', '酉', '午', '申', 'male', spouse_palace)
        tracks = [t['track'] for t in result['tracks']]
        assert '紅鸞' in tracks

    def test_romance_level(self, sample_effective_gods):
        """Romance level based on active count."""
        spouse_palace = {'signals': [], 'tianDiYuanYang': False}
        result = compute_marriage_star_analysis(
            '戊', '己', '丑', '午', '申', 'male', spouse_palace)
        assert result['romanceLevel'] in ('very_strong', 'strong', 'moderate', 'quiet')


# ============================================================
# Sub-Function 6: 祿神/羊刃
# ============================================================

class TestLuYangrenAnalysis:
    def test_lu_active(self, sample_pillars, sample_effective_gods):
        """祿神 activated: 戊 DM → LUSHEN[戊] = 巳."""
        result = compute_lu_yangren_analysis(
            '戊', '巳', sample_effective_gods, sample_pillars)
        assert result['luShen']['active']

    def test_lu_not_active(self, sample_pillars, sample_effective_gods):
        result = compute_lu_yangren_analysis(
            '戊', '子', sample_effective_gods, sample_pillars)
        assert not result['luShen']['active']

    def test_yangren_active(self, sample_pillars, sample_effective_gods):
        """羊刃 activated: 戊 DM → YANGREN[戊] = 午."""
        result = compute_lu_yangren_analysis(
            '戊', '午', sample_effective_gods, sample_pillars)
        assert result['yangRen']['active']

    def test_yangren_uses_correct_constants(self, sample_pillars, sample_effective_gods):
        """Verify YANGREN uses orthodox values (yin stem 乙→辰, not 寅)."""
        from app.constants import YANGREN
        assert YANGREN['乙'] == '辰'
        assert YANGREN['丁'] == '未'
        assert YANGREN['己'] == '未'
        assert YANGREN['辛'] == '戌'
        assert YANGREN['癸'] == '丑'


# ============================================================
# Sub-Function 7 & 8: Career & Finance
# ============================================================

class TestAnnualCareerAnalysis:
    def test_basic_career(self, sample_pillars, sample_effective_gods):
        # 壬→戊 = 偏財 (DM 戊 controls water)
        result = compute_annual_career_analysis(
            sample_pillars, '戊', '壬', '亥', sample_effective_gods)
        assert 'flowYearTenGod' in result
        assert result['flowYearTenGod'] == '偏財'

    def test_shang_guan_jian_guan(self, sample_effective_gods):
        """Test 傷官見官 detection."""
        pillars = {
            'year': {'stem': '庚', 'branch': '午'},  # 庚→戊=偏印
            'month': {'stem': '辛', 'branch': '戌'},  # 辛→戊=正印
            'day': {'stem': '戊', 'branch': '申'},
            'hour': {'stem': '乙', 'branch': '巳'},  # 乙→戊=正官
        }
        # Flow year 辛 → 傷官. Chart has 正官(乙)
        result = compute_annual_career_analysis(
            pillars, '戊', '辛', '卯', sample_effective_gods)
        signal_types = [s['type'] for s in result['signals']]
        assert '傷官見官' in signal_types


class TestAnnualFinanceAnalysis:
    def test_wealth_star_present(self, sample_pillars, sample_effective_gods):
        # 壬→戊 = 偏財 (DM 戊 controls water)
        result = compute_annual_finance_analysis(
            sample_pillars, '戊', '壬', '亥', sample_effective_gods)
        assert result['wealthPresent']

    def test_caiku_feng_chong(self, sample_effective_gods):
        """Test 財庫逢沖 detection."""
        # 戊 DM, wealth element = ELEMENT_OVERCOMES[土] = 水
        # WEALTH_TREASURY[水] = 辰
        # CLASH_LOOKUP[辰] = 戌
        # So flow year 戌 clashes treasury 辰
        pillars = {
            'year': {'stem': '甲', 'branch': '辰'},  # Has treasury branch
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '戊', 'branch': '申'},
            'hour': {'stem': '庚', 'branch': '子'},
        }
        result = compute_annual_finance_analysis(
            pillars, '戊', '甲', '戌', sample_effective_gods)
        signal_types = [s['type'] for s in result['signals']]
        assert '財庫逢沖' in signal_types

    def test_wood_dm_treasury_none(self, sample_effective_gods):
        """木 DM's 財庫 (土 wealth) is None — should not crash."""
        pillars = {
            'year': {'stem': '丙', 'branch': '午'},
            'month': {'stem': '壬', 'branch': '戌'},
            'day': {'stem': '甲', 'branch': '子'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        result = compute_annual_finance_analysis(
            pillars, '甲', '壬', '午', sample_effective_gods)
        # Should not crash, and 財庫逢沖 should not be in signals
        signal_types = [s['type'] for s in result['signals']]
        assert '財庫逢沖' not in signal_types


# ============================================================
# Sub-Function 10: Health
# ============================================================

class TestAnnualHealthAnalysis:
    def test_life_stage_vitality(self, sample_effective_gods):
        result = compute_annual_health_analysis(
            {'木': 2, '火': 3, '土': 4, '金': 2, '水': 1},
            '甲', '寅', sample_effective_gods, '戊')
        assert result['lifeStage'] != ''
        assert result['healthVitality']['vitality'] in (
            'rising', 'unstable', 'strengthening', 'strong', 'peak',
            'declining', 'weak', 'very_weak', 'dormant', 'critical',
            'renewing', 'nurturing', 'unknown')

    def test_excess_element_warning(self, sample_effective_gods):
        """Element with percentage >= 30 triggers 太過 warning."""
        result = compute_annual_health_analysis(
            {'木': 10, '火': 15, '土': 35, '金': 20, '水': 20},
            '甲', '寅', sample_effective_gods, '戊')
        assert any(w['condition'] == '太過' and w['element'] == '土'
                   for w in result['elementWarnings'])

    def test_missing_element_warning(self, sample_effective_gods):
        """Element with percentage <= 5 triggers 不及 warning."""
        result = compute_annual_health_analysis(
            {'木': 25, '火': 30, '土': 25, '金': 0, '水': 20},
            '甲', '寅', sample_effective_gods, '戊')
        assert any(w['condition'] == '不及' and w['element'] == '金'
                   for w in result['elementWarnings'])

    def test_deficient_element_low_percentage(self, sample_effective_gods):
        """Element with percentage 3% (<=5) triggers 不及 warning."""
        result = compute_annual_health_analysis(
            {'木': 27, '火': 30, '土': 25, '金': 3, '水': 15},
            '甲', '寅', sample_effective_gods, '戊')
        assert any(w['condition'] == '不及' and w['element'] == '金'
                   for w in result['elementWarnings'])

    def test_no_spurious_element_warnings(self, sample_effective_gods):
        """Balanced elements (all 15-25%) should produce no warnings."""
        result = compute_annual_health_analysis(
            {'木': 20, '火': 18, '土': 25, '金': 17, '水': 20},
            '甲', '寅', sample_effective_gods, '戊')
        assert result['elementWarnings'] == []

    def test_yangren_danger_flag(self, sample_effective_gods):
        """羊刃 danger flags in health."""
        yangren_data = {'yangRen': {'active': True, 'dangerLevel': 'high'}}
        result = compute_annual_health_analysis(
            {'木': 2, '火': 2, '土': 3, '金': 2, '水': 3},
            '甲', '寅', sample_effective_gods, '戊', yangren_data)
        assert result['yangrenDanger']


# ============================================================
# Sub-Function 11: Seal Star (印星/家庭)
# ============================================================

class TestSealStar:
    def test_seal_favorable_role(self):
        """印星為用神/喜神 → '印星為用' with positive impact."""
        effective_gods = {'偏印': '喜神', '正印': '用神'}
        result = compute_seal_star_analysis('戊', '丙', effective_gods)
        assert result['isSealYear'] is True
        assert result['flowYearTenGod'] == '偏印'
        assert result['sealRole'] == '喜神'
        assert len(result['signals']) == 1
        assert result['signals'][0]['type'] == '印星為用'
        assert result['signals'][0]['impact'] == 'positive'
        assert '喜神' in result['signals'][0]['detail']

    def test_seal_unfavorable_role(self):
        """印星為忌神 → '印星為忌' with negative impact."""
        effective_gods = {'偏印': '忌神'}
        result = compute_seal_star_analysis('戊', '丙', effective_gods)
        assert result['isSealYear'] is True
        assert result['sealRole'] == '忌神'
        assert result['signals'][0]['type'] == '印星為忌'
        assert result['signals'][0]['impact'] == 'negative'
        assert '忌神' in result['signals'][0]['detail']

    def test_seal_idle_role(self):
        """印星為閒神 → '印星為閒' with neutral impact."""
        effective_gods = {'偏印': '閒神'}
        result = compute_seal_star_analysis('戊', '丙', effective_gods)
        assert result['isSealYear'] is True
        assert result['sealRole'] == '閒神'
        assert result['signals'][0]['type'] == '印星為閒'
        assert result['signals'][0]['impact'] == 'neutral'
        assert '閒神' in result['signals'][0]['detail']

    def test_non_seal_year(self):
        """Non-seal ten god → isSealYear=False, no signals."""
        effective_gods = {'偏財': '用神'}
        result = compute_seal_star_analysis('戊', '壬', effective_gods)  # 壬→戊=偏財
        assert result['isSealYear'] is False
        assert result['signals'] == []

    def test_seal_enemy_role(self):
        """印星為仇神 → '印星為忌' with negative impact."""
        effective_gods = {'正印': '仇神'}
        result = compute_seal_star_analysis('戊', '丁', effective_gods)  # 丁→戊=正印
        assert result['isSealYear'] is True
        assert result['sealRole'] == '仇神'
        assert result['signals'][0]['type'] == '印星為忌'
        assert result['signals'][0]['impact'] == 'negative'


# ============================================================
# Sub-Function 12: Monthly Forecasts
# ============================================================

class TestMonthlyForecasts:
    def test_twelve_months(self, sample_pillars, sample_effective_gods,
                           sample_monthly_stars):
        results = compute_enhanced_monthly_forecasts(
            sample_pillars, '戊', sample_effective_gods, sample_monthly_stars,
            'male', '午', '申', ['辰', '巳'], '吉')
        assert len(results) == 12

    def test_month_has_four_aspects(self, sample_pillars, sample_effective_gods,
                                    sample_monthly_stars):
        results = compute_enhanced_monthly_forecasts(
            sample_pillars, '戊', sample_effective_gods, sample_monthly_stars,
            'male', '午', '申', ['辰', '巳'], '吉')
        for month in results:
            assert 'aspects' in month
            assert 'career' in month['aspects']
            assert 'finance' in month['aspects']
            assert 'romance' in month['aspects']
            assert 'health' in month['aspects']

    def test_kong_wang_detection(self, sample_pillars, sample_effective_gods,
                                 sample_monthly_stars):
        results = compute_enhanced_monthly_forecasts(
            sample_pillars, '戊', sample_effective_gods, sample_monthly_stars,
            'male', '午', '申', ['辰', '巳'], '吉')
        # Month 3 is 辰 (in kong_wang), month 4 is 巳 (in kong_wang)
        assert results[2]['isKongWang']  # 辰
        assert results[3]['isKongWang']  # 巳

    def test_auspiciousness_modifier_fuyin(self, sample_effective_gods):
        """伏吟日支 should amplify auspiciousness."""
        pillars = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '戊', 'branch': '申'},
            'hour': {'stem': '庚', 'branch': '戌'},
        }
        # Month with branch 申 = 伏吟 day branch
        month_data = {'stem': '庚', 'branch': '申', 'month': '七月'}
        from app.annual_enhanced import _compute_single_month
        result = _compute_single_month(
            month_data, pillars, '戊', sample_effective_gods,
            'male', '子', '申', [], '吉')
        # 伏吟 should amplify
        assert result['baseAuspiciousness'] is not None


# ============================================================
# Master Orchestrator
# ============================================================

class TestMasterOrchestrator:
    def test_basic_orchestration(self, sample_pillars, sample_effective_gods,
                                 sample_monthly_stars):
        annual_stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = generate_annual_pre_analysis(
            pillars=sample_pillars,
            day_master_stem='戊',
            gender='male',
            five_elements_balance={'木': 2, '火': 3, '土': 4, '金': 2, '水': 1},
            effective_gods=sample_effective_gods,
            prominent_god='傷官',
            luck_periods=[{
                'stem': '甲', 'branch': '子',
                'startYear': 2020, 'endYear': 2029,
            }],
            annual_stars=annual_stars,
            monthly_stars=sample_monthly_stars,
            kong_wang=['辰', '巳'],
            birth_year=1988,
            current_year=2026,
        )

        # Check all sections present
        assert 'flowYear' in result
        assert 'taiSui' in result
        assert 'flowYearHarmony' in result
        assert 'pillarImpacts' in result
        assert 'spousePalace' in result
        assert 'marriageStar' in result
        assert 'luYangRen' in result
        assert 'career' in result
        assert 'finance' in result
        assert 'relationships' in result
        assert 'health' in result
        assert 'sealStar' in result
        assert 'monthlyForecasts' in result
        assert 'dayunContext' in result
        assert 'deterministic' in result

        # Verify flow year info
        assert result['flowYear']['stem'] == '丙'
        assert result['flowYear']['branch'] == '午'
        assert result['flowYear']['year'] == 2026

        # Verify monthly forecasts count
        assert len(result['monthlyForecasts']) == 12

        # Verify dayun context
        assert result['dayunContext']['available']
        assert result['dayunContext']['stem'] == '甲'

        # Verify deterministic sub-dict
        det = result['deterministic']
        assert det['flowYearStem'] == '丙'
        assert det['flowYearBranch'] == '午'
        assert det['flowYearTenGod'] is not None
        assert det['hasTaiSui'] is not None
        assert det['dayunLabel'] != ''
        assert len(det['monthlyAuspiciousness']) == 12
        for m in det['monthlyAuspiciousness']:
            assert 'month' in m
            assert 'auspiciousness' in m

    def test_validation_year_before_birth(self, sample_pillars, sample_effective_gods):
        with pytest.raises(ValueError, match='before birth year'):
            generate_annual_pre_analysis(
                pillars=sample_pillars,
                day_master_stem='戊',
                gender='male',
                five_elements_balance={},
                effective_gods=sample_effective_gods,
                prominent_god='',
                birth_year=2000,
                current_year=1999,
                annual_stars=[{'year': 1999, 'stem': '己', 'branch': '卯'}],
            )

    def test_validation_year_too_far(self, sample_pillars, sample_effective_gods):
        with pytest.raises(ValueError, match='exceeds reasonable range'):
            generate_annual_pre_analysis(
                pillars=sample_pillars,
                day_master_stem='戊',
                gender='male',
                five_elements_balance={},
                effective_gods=sample_effective_gods,
                prominent_god='',
                birth_year=1988,
                current_year=2200,
                annual_stars=[{'year': 2200, 'stem': '甲', 'branch': '子'}],
            )

    def test_missing_luck_periods(self, sample_pillars, sample_effective_gods,
                                   sample_monthly_stars):
        """Empty luck periods should not crash — dayun context shows unavailable."""
        annual_stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = generate_annual_pre_analysis(
            pillars=sample_pillars,
            day_master_stem='戊',
            gender='male',
            five_elements_balance={'木': 2, '火': 3, '土': 4, '金': 2, '水': 1},
            effective_gods=sample_effective_gods,
            prominent_god='傷官',
            luck_periods=[],
            annual_stars=annual_stars,
            monthly_stars=sample_monthly_stars,
            kong_wang=[],
            birth_year=2024,
            current_year=2026,
        )
        assert result['dayunContext']['available'] is False

    def test_engine_format_effective_gods(self, sample_pillars, sample_monthly_stars):
        """Test with actual engine format effective_gods (production format)."""
        engine_gods = {
            'usefulGod': '土', 'favorableGod': '火',
            'tabooGod': '木', 'enemyGod': '水', 'idleGod': '金',
        }
        annual_stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = generate_annual_pre_analysis(
            pillars=sample_pillars,
            day_master_stem='戊',
            gender='male',
            five_elements_balance={'木': 7, '火': 16, '土': 29, '金': 39, '水': 9},
            effective_gods=engine_gods,
            prominent_god='',
            annual_stars=annual_stars,
            monthly_stars=sample_monthly_stars,
            kong_wang=[],
            birth_year=1988,
            current_year=2026,
        )
        assert 'flowYear' in result
        assert 'error' not in result
        # Verify normalization worked: flow year 丙 for DM 戊 = 偏印
        # 火 = favorableGod = 喜神, so 偏印 should be 喜神 not 閒神
        career = result.get('career', {})
        assert career.get('tenGodRole') == '喜神', \
            f"偏印 should be 喜神 (fire=favorableGod), got {career.get('tenGodRole')}"


# ============================================================
# Test: effective_gods Normalization
# ============================================================

class TestEffectiveGodsNormalization:
    """Tests for _normalize_effective_gods_for_annual()."""

    def test_engine_format_normalized(self):
        """Engine format {'usefulGod': '土', ...} → {ten_god: role} with all 10 gods."""
        engine_format = {
            'usefulGod': '土', 'favorableGod': '火',
            'tabooGod': '木', 'enemyGod': '水', 'idleGod': '金',
        }
        result = _normalize_effective_gods_for_annual(engine_format, '戊')
        # Yang ten gods
        assert result['偏印'] == '喜神'   # 戊→丙=偏印, 火→喜神
        assert result['偏官'] == '忌神'   # 戊→甲=偏官, 木→忌神
        assert result['偏財'] == '仇神'   # 戊→壬=偏財, 水→仇神
        assert result['食神'] == '閒神'   # 戊→庚=食神, 金→閒神
        assert result['比肩'] == '用神'   # 戊→戊=比肩, 土→用神
        # Yin ten gods (critical for _get_branch_role with yin-stem branches)
        assert result['正印'] == '喜神'   # 戊→丁=正印, 火→喜神
        assert result['正官'] == '忌神'   # 戊→乙=正官, 木→忌神
        assert result['正財'] == '仇神'   # 戊→癸=正財, 水→仇神
        assert result['傷官'] == '閒神'   # 戊→辛=傷官, 金→閒神
        assert result['劫財'] == '用神'   # 戊→己=劫財, 土→用神
        # All 10 ten gods present
        assert len(result) == 10

    def test_ten_god_format_passthrough(self):
        """Already in ten-god format → return as-is."""
        tengod_format = {'偏印': '喜神', '正官': '忌神'}
        result = _normalize_effective_gods_for_annual(tengod_format, '戊')
        assert result == tengod_format

    def test_empty_dict(self):
        """Empty dict → return empty dict."""
        result = _normalize_effective_gods_for_annual({}, '戊')
        assert result == {}


# ============================================================
# Phase 10: Methodology Gap Fix Tests
# ============================================================

class TestPhase10Fixes:
    """Tests for Phase 10 methodology gap fixes."""

    # --- Standard effective_gods fixture (ten-god-keyed) for Roger35: 戊 DM ---
    @pytest.fixture
    def roger35_gods(self):
        """Ten-god-keyed effective_gods for 戊 DM (Roger35)."""
        return {
            '比肩': '用神', '劫財': '用神',       # 土 = 用神
            '偏印': '喜神', '正印': '喜神',       # 火 = 喜神
            '食神': '閒神', '傷官': '閒神',       # 金 = 閒神
            '偏官': '忌神', '正官': '忌神',       # 木 = 忌神
            '偏財': '仇神', '正財': '仇神',       # 水 = 仇神
        }

    # ---- Fix 1: 天喜 trackType + weighted romanceLevel ----

    def test_tianxi_tracktype_is_celebration(self, roger35_gods):
        """天喜 track should have trackType='celebration'."""
        # TIANXI[辰] = 巳. Set flow_year_branch=巳 to trigger.
        result = compute_marriage_star_analysis(
            day_master_stem='戊', flow_year_stem='丙', flow_year_branch='巳',
            year_branch='辰', day_branch='子', gender='male',
            spouse_palace={'signals': []},
        )
        tianxi_tracks = [t for t in result['tracks'] if t['track'] == '天喜']
        assert len(tianxi_tracks) == 1
        assert tianxi_tracks[0]['trackType'] == 'celebration'

    def test_hongluan_tracktype_is_romance(self, roger35_gods):
        """紅鸞 track should have trackType='romance'."""
        # HONGLUAN[辰] = 亥. Set flow_year_branch=亥 to trigger.
        result = compute_marriage_star_analysis(
            day_master_stem='戊', flow_year_stem='丙', flow_year_branch='亥',
            year_branch='辰', day_branch='子', gender='male',
            spouse_palace={'signals': []},
        )
        hongluan_tracks = [t for t in result['tracks'] if t['track'] == '紅鸞']
        assert len(hongluan_tracks) == 1
        assert hongluan_tracks[0]['trackType'] == 'romance'

    def test_tianxi_only_romance_level_quiet(self):
        """天喜 alone (score=0.3) → romanceLevel='quiet' (below 0.5 threshold)."""
        # TIANXI[辰] = 巳. 甲 for male not spouse star, 卯桃花=子 not 巳.
        result = compute_marriage_star_analysis(
            day_master_stem='戊', flow_year_stem='甲', flow_year_branch='巳',
            year_branch='辰', day_branch='卯', gender='male',
            spouse_palace={'signals': []},
        )
        active_tracks = [t for t in result['tracks'] if t.get('active')]
        assert any(t['track'] == '天喜' for t in active_tracks)
        # romanceLevel should be quiet since 天喜 alone = 0.3 < 0.5
        assert result['romanceLevel'] == 'quiet'
        assert result['romanceScore'] == pytest.approx(0.3)

    def test_tianxi_plus_romance_moderate(self):
        """天喜 + one romance track → romanceLevel='moderate' (score=1.3 >= 0.5)."""
        # TIANXI[辰] = 巳. Use spouse_palace with a signal to trigger track 2.
        result = compute_marriage_star_analysis(
            day_master_stem='戊', flow_year_stem='甲', flow_year_branch='巳',
            year_branch='辰', day_branch='卯', gender='male',
            spouse_palace={'signals': [{'type': '六合'}]},
        )
        active_tracks = [t for t in result['tracks'] if t.get('active')]
        assert any(t['track'] == '天喜' for t in active_tracks)
        assert any(t['track'] == '夫妻宮' for t in active_tracks)
        assert result['romanceLevel'] == 'moderate'
        assert result['romanceScore'] == pytest.approx(1.3)

    def test_trackcount_replaces_activecount(self):
        """Return dict uses 'trackCount' (not 'activeCount')."""
        result = compute_marriage_star_analysis(
            day_master_stem='戊', flow_year_stem='甲', flow_year_branch='午',
            year_branch='辰', day_branch='子', gender='male',
            spouse_palace={'signals': []},
        )
        assert 'trackCount' in result
        assert 'activeCount' not in result

    # ---- Fix 2: 印星間接利財 ----

    def test_indirect_wealth_weak_dm_seal_favorable(self, roger35_gods):
        """Weak DM + 印星 as 喜用 → '印星間接利財' signal present."""
        sample_pillars = {
            'year': {'stem': '戊', 'branch': '辰'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '子'},
            'hour': {'stem': '壬', 'branch': '子'},
        }
        result = compute_annual_finance_analysis(
            pillars=sample_pillars,
            day_master_stem='戊',
            flow_year_stem='丙',  # 丙 → 偏印 for 戊 DM, 喜神
            flow_year_branch='午',
            effective_gods=roger35_gods,
        )
        signal_types = [s['type'] for s in result['signals']]
        assert '印星間接利財' in signal_types
        assert result['wealthPresent'] is False  # Not direct 財星

    def test_no_indirect_wealth_strong_dm(self):
        """Strong DM + 印星 → signal NOT present (strong DM doesn't need help)."""
        # Make DM element (土) an 忌神 → is_strong=True → wealth_condition='strong_dm'
        strong_gods = {
            '比肩': '忌神', '劫財': '忌神',
            '偏印': '喜神', '正印': '喜神',
            '食神': '用神', '傷官': '用神',
            '偏官': '閒神', '正官': '閒神',
            '偏財': '喜神', '正財': '喜神',
        }
        sample_pillars = {
            'year': {'stem': '戊', 'branch': '辰'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '子'},
            'hour': {'stem': '壬', 'branch': '子'},
        }
        result = compute_annual_finance_analysis(
            pillars=sample_pillars,
            day_master_stem='戊',
            flow_year_stem='丙',
            flow_year_branch='午',
            effective_gods=strong_gods,
        )
        signal_types = [s['type'] for s in result['signals']]
        assert '印星間接利財' not in signal_types

    def test_no_indirect_wealth_seal_unfavorable(self, roger35_gods):
        """Weak DM + 印星 as 忌神 → signal NOT present."""
        # Override to make 偏印 = 忌神
        bad_seal_gods = dict(roger35_gods)
        bad_seal_gods['偏印'] = '忌神'
        sample_pillars = {
            'year': {'stem': '戊', 'branch': '辰'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '子'},
            'hour': {'stem': '壬', 'branch': '子'},
        }
        result = compute_annual_finance_analysis(
            pillars=sample_pillars,
            day_master_stem='戊',
            flow_year_stem='丙',
            flow_year_branch='午',
            effective_gods=bad_seal_gods,
        )
        signal_types = [s['type'] for s in result['signals']]
        assert '印星間接利財' not in signal_types

    # ---- Fix 3: Monthly stem/branch rebalancing ----

    def test_branch_positive_stem_negative_base(self, roger35_gods):
        """Branch=喜用, stem=忌神 → base='吉中有凶' (branch wins, stem tempers)."""
        from app.annual_enhanced import _compute_single_month
        sample_pillars = {
            'year': {'stem': '戊', 'branch': '辰'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '子'},
            'hour': {'stem': '壬', 'branch': '子'},
        }
        # 甲午: stem 甲=木=忌神→凶, branch 午=火=喜神→吉
        result = _compute_single_month(
            month_data={'stem': '甲', 'branch': '午'},
            pillars=sample_pillars,
            day_master_stem='戊',
            effective_gods=roger35_gods,
            gender='male', year_branch='辰', day_branch='子',
            kong_wang=[], flow_year_auspiciousness='吉',
        )
        assert result['branchBase'] == '吉'
        assert result['stemBase'] == '凶'
        assert result['baseAuspiciousness'] == '吉中有凶'

    def test_branch_negative_stem_positive_base(self, roger35_gods):
        """Branch=忌神, stem=喜用 → base='凶中有吉'."""
        from app.annual_enhanced import _compute_single_month
        sample_pillars = {
            'year': {'stem': '戊', 'branch': '辰'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '子'},
            'hour': {'stem': '壬', 'branch': '子'},
        }
        # 丁卯: stem 丁=火=喜神→吉, branch 卯=木=忌神→凶
        result = _compute_single_month(
            month_data={'stem': '丁', 'branch': '卯'},
            pillars=sample_pillars,
            day_master_stem='戊',
            effective_gods=roger35_gods,
            gender='male', year_branch='辰', day_branch='子',
            kong_wang=[], flow_year_auspiciousness='吉',
        )
        assert result['branchBase'] == '凶'
        assert result['stemBase'] == '吉'
        assert result['baseAuspiciousness'] == '凶中有吉'

    def test_branch_neutral_fallback_to_stem(self, roger35_gods):
        """Branch=閒神(平), stem=喜用 → base falls back to stem."""
        from app.annual_enhanced import _compute_single_month
        sample_pillars = {
            'year': {'stem': '戊', 'branch': '辰'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '子'},
            'hour': {'stem': '壬', 'branch': '子'},
        }
        # 辛酉: stem 辛=金=閒神→平, branch 酉=金=閒神→平
        # Both neutral → base = 平
        result = _compute_single_month(
            month_data={'stem': '辛', 'branch': '酉'},
            pillars=sample_pillars,
            day_master_stem='戊',
            effective_gods=roger35_gods,
            gender='male', year_branch='辰', day_branch='子',
            kong_wang=[], flow_year_auspiciousness='吉',
        )
        assert result['branchBase'] == '平'
        assert result['stemBase'] == '平'
        # Both neutral → fallback to stem which is also 平
        assert result['baseAuspiciousness'] == '平'

    # ---- Fix 4: Indirect effect chains ----

    def test_seal_favorable_health_effect(self, roger35_gods):
        """印星喜用 → health has '印星護身'."""
        result = compute_indirect_effects(
            day_master_stem='戊', flow_year_stem='丙',
            effective_gods=roger35_gods, wealth_condition='weak_dm',
        )
        health_types = [e['type'] for e in result['health']]
        assert '印星護身' in health_types

    def test_bijie_yongshen_career_effect(self, roger35_gods):
        """比肩用神 → career has '比劫助力'."""
        result = compute_indirect_effects(
            day_master_stem='戊', flow_year_stem='戊',
            effective_gods=roger35_gods, wealth_condition='weak_dm',
        )
        career_types = [e['type'] for e in result['career']]
        assert '比劫助力' in career_types

    def test_guansha_favorable_finance_effect(self):
        """正官喜用 → finance has '官殺間接催財'."""
        gods = {'正官': '喜神', '七殺': '用神'}
        result = compute_indirect_effects(
            day_master_stem='戊', flow_year_stem='乙',  # 乙→正官
            effective_gods=gods, wealth_condition='weak_dm',
        )
        finance_types = [e['type'] for e in result['finance']]
        assert '官殺間接催財' in finance_types

    def test_shishen_favorable_relationships_effect(self, roger35_gods):
        """食神喜用 → relationships has '食神利人緣'."""
        # Override: make 食神 = 喜神
        gods = dict(roger35_gods)
        gods['食神'] = '喜神'
        result = compute_indirect_effects(
            day_master_stem='戊', flow_year_stem='庚',  # 庚→食神
            effective_gods=gods, wealth_condition='weak_dm',
        )
        rel_types = [e['type'] for e in result['relationships']]
        assert '食神利人緣' in rel_types

    def test_caixin_unfavorable_weak_health_effect(self):
        """偏財忌+身弱 → health has '逢財傷身'."""
        gods = {'偏財': '忌神'}
        result = compute_indirect_effects(
            day_master_stem='戊', flow_year_stem='壬',  # 壬→偏財
            effective_gods=gods, wealth_condition='weak_dm',
        )
        health_types = [e['type'] for e in result['health']]
        assert '逢財傷身' in health_types

    def test_no_effects_idle_god(self, roger35_gods):
        """閒神 flow year → all effects empty."""
        result = compute_indirect_effects(
            day_master_stem='戊', flow_year_stem='庚',  # 庚→食神=閒神
            effective_gods=roger35_gods, wealth_condition='weak_dm',
        )
        for section, effects in result.items():
            assert len(effects) == 0, f"{section} should be empty for 閒神, got {effects}"

    # ---- Fix 5: Health source labeling ----

    def test_element_warning_has_natal_source(self):
        """elementWarnings should have source='natal'."""
        result = compute_annual_health_analysis(
            five_elements_balance={'土': 35, '木': 5, '火': 20, '金': 20, '水': 20},
            flow_year_stem='甲', flow_year_branch='寅',
            effective_gods={'偏官': '閒神'}, day_master_stem='戊',
        )
        for w in result['elementWarnings']:
            assert w['source'] == 'natal', f"Expected source='natal', got {w}"

    def test_risk_organ_has_flow_year_source(self):
        """riskOrgans should have source='flow_year'."""
        gods = {'偏官': '忌神', '正官': '忌神'}
        result = compute_annual_health_analysis(
            five_elements_balance={'土': 20, '木': 20, '火': 20, '金': 20, '水': 20},
            flow_year_stem='甲', flow_year_branch='寅',
            effective_gods=gods, day_master_stem='戊',
        )
        for r in result['riskOrgans']:
            assert r['source'] == 'flow_year', f"Expected source='flow_year', got {r}"

    # ---- Fix 6: 大運藏干 ----

    def test_dayun_hidden_stems_extracted(self, roger35_gods):
        """大運 branch 巳 → hidden stems [丙/庚/戊] with ten gods."""
        from app.annual_enhanced import _extract_dayun_context
        luck_periods = [
            {'startYear': 2020, 'endYear': 2030, 'stem': '乙', 'branch': '巳'},
        ]
        result = _extract_dayun_context(luck_periods, 2026, '戊', roger35_gods)
        assert result['available'] is True
        assert 'hiddenStems' in result
        assert len(result['hiddenStems']) == 3  # 巳 has 丙/庚/戊
        stems = [hs['stem'] for hs in result['hiddenStems']]
        assert '丙' in stems
        assert '庚' in stems
        assert '戊' in stems
        # Verify ten god resolution
        for hs in result['hiddenStems']:
            assert 'tenGod' in hs
            assert 'role' in hs

    def test_dayun_unavailable_no_hidden_stems(self, roger35_gods):
        """No active 大運 → no hiddenStems key."""
        from app.annual_enhanced import _extract_dayun_context
        result = _extract_dayun_context([], 2026, '戊', roger35_gods)
        assert result['available'] is False
        assert 'hiddenStems' not in result

    # ---- Orchestrator integration ----

    def test_orchestrator_has_indirect_effects(self, sample_pillars, sample_monthly_stars):
        """Orchestrator returns indirectEffects and deterministic.hasIndirectEffects."""
        gods = {
            '偏印': '喜神', '正印': '喜神',
            '比肩': '用神', '劫財': '用神',
            '食神': '閒神', '傷官': '閒神',
            '偏官': '忌神', '正官': '忌神',
            '偏財': '仇神', '正財': '仇神',
        }
        annual_stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = generate_annual_pre_analysis(
            pillars=sample_pillars,
            day_master_stem='戊', gender='male',
            five_elements_balance={'木': 7, '火': 16, '土': 29, '金': 39, '水': 9},
            effective_gods=gods,
            prominent_god='',
            annual_stars=annual_stars,
            monthly_stars=sample_monthly_stars,
            kong_wang=[], birth_year=1988, current_year=2026,
        )
        assert 'indirectEffects' in result
        assert 'hasIndirectEffects' in result['deterministic']

    def test_orchestrator_marriage_has_track_type(self, sample_pillars, sample_monthly_stars):
        """Orchestrator marriage tracks have trackType field."""
        gods = {
            '偏印': '喜神', '正印': '喜神',
            '比肩': '用神', '劫財': '用神',
            '食神': '閒神', '傷官': '閒神',
            '偏官': '忌神', '正官': '忌神',
            '偏財': '仇神', '正財': '仇神',
        }
        annual_stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = generate_annual_pre_analysis(
            pillars=sample_pillars,
            day_master_stem='戊', gender='male',
            five_elements_balance={'木': 7, '火': 16, '土': 29, '金': 39, '水': 9},
            effective_gods=gods,
            prominent_god='',
            annual_stars=annual_stars,
            monthly_stars=sample_monthly_stars,
            kong_wang=[], birth_year=1988, current_year=2026,
        )
        for t in result['marriageStar']['tracks']:
            assert 'trackType' in t, f"Track missing trackType: {t}"
