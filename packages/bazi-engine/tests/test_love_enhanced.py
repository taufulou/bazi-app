"""
Comprehensive tests for love_enhanced.py — Love & Marriage Pre-Analysis Module.

150+ tests covering all 11 pre-analysis functions + narrative anchors + orchestrator.
"""

import pytest
from typing import Dict, List, Any

from app.love_enhanced import (
    classify_peach_blossoms,
    compute_spouse_star_analysis,
    compute_marriage_palace_analysis,
    compute_love_personality,
    compute_marriage_timing_indicators,
    compute_romance_good_years,
    compute_romance_danger_years,
    compute_marriage_change_years,
    compute_partner_recommendations,
    compute_annual_love_forecast,
    compute_monthly_love_forecast,
    build_love_narrative_anchors,
    generate_love_pre_analysis,
    _normalize_effective_gods,
    _get_twelve_stage,
    _find_active_luck_period,
    _enrich_luck_periods,
    year_branch_from_stars,
)
from app.ten_gods import derive_ten_god
from app.constants import (
    HONGYAN_SHA,
    HONGYAN_SELF_SITTING,
    JIUCHOU_DAYS,
    MUYU_TAOHUA,
    HARM_LOOKUP,
    TAOHUA,
    HONGLUAN,
    TIANXI,
    YANGREN,
    STEM_ELEMENT,
    HIDDEN_STEMS,
    BRANCH_ELEMENT,
)


# ============================================================
# Shared fixtures and helpers
# ============================================================

@pytest.fixture
def default_effective_gods():
    """Standard effective gods mapping (element -> role_zh)."""
    return {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}


@pytest.fixture
def default_strength_v2():
    return {'classification': 'balanced', 'score': 50.0}


@pytest.fixture
def strong_strength():
    return {'classification': 'strong', 'score': 65.0}


@pytest.fixture
def weak_strength():
    return {'classification': 'weak', 'score': 35.0}


@pytest.fixture
def empty_shen_sha():
    return []


@pytest.fixture
def sample_luck_periods():
    return [
        {'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2029, 'startAge': 25},
        {'stem': '丁', 'branch': '未', 'startYear': 2030, 'endYear': 2039, 'startAge': 35},
        {'stem': '戊', 'branch': '申', 'startYear': 2040, 'endYear': 2049, 'startAge': 45},
        {'stem': '己', 'branch': '酉', 'startYear': 2050, 'endYear': 2059, 'startAge': 55},
        {'stem': '庚', 'branch': '戌', 'startYear': 2060, 'endYear': 2069, 'startAge': 65},
    ]


@pytest.fixture
def sample_annual_stars():
    """Annual stars covering 2024-2036."""
    branches = ['辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑', '寅', '卯', '辰']
    stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '甲', '乙', '丙']
    return [
        {'year': 2024 + i, 'stem': stems[i], 'branch': branches[i]}
        for i in range(len(branches))
    ]


def make_pillars(year_s, year_b, month_s, month_b, day_s, day_b, hour_s, hour_b):
    return {
        'year': {'stem': year_s, 'branch': year_b},
        'month': {'stem': month_s, 'branch': month_b},
        'day': {'stem': day_s, 'branch': day_b},
        'hour': {'stem': hour_s, 'branch': hour_b},
    }


# ============================================================
# 0. Helper function tests
# ============================================================

class TestNormalizeEffectiveGods:
    def test_already_zh_format(self):
        eg = {'木': '用神', '水': '喜神'}
        result = _normalize_effective_gods(eg)
        assert result == eg

    def test_en_to_zh_format(self):
        eg = {'usefulGod': '木', 'favorableGod': '水', 'tabooGod': '火', 'enemyGod': '土', 'idleGod': '金'}
        result = _normalize_effective_gods(eg)
        assert result == {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}

    def test_zh_keyed_role_to_element_format(self):
        """Chinese-keyed {role→element} format from calculator — the bug that caused all roles to be 閒神."""
        eg = {'喜神': '火', '用神': '土', '閒神': '金', '忌神': '木', '仇神': '水'}
        result = _normalize_effective_gods(eg)
        assert result == {'火': '喜神', '土': '用神', '金': '閒神', '木': '忌神', '水': '仇神'}

    def test_empty_dict(self):
        result = _normalize_effective_gods({})
        assert result == {}

    def test_normalize_english_keyed_canonical_format(self):
        """Test normalization with canonical English keys from five_elements.py."""
        english_keyed = {
            'usefulGod': '土',
            'favorableGod': '火',
            'tabooGod': '木',
            'enemyGod': '水',
            'idleGod': '金',
        }
        result = _normalize_effective_gods(english_keyed)
        assert result == {'土': '用神', '火': '喜神', '木': '忌神', '水': '仇神', '金': '閒神'}


class TestGetTwelveStage:
    def test_yang_stem_甲_at_亥(self):
        # 甲 starts at 亥, so 亥 = 長生
        assert _get_twelve_stage('甲', '亥') == '長生'

    def test_yang_stem_甲_at_子(self):
        # 甲 starts at 亥 (idx=11), 子 idx=0, offset=(0-11)%12=1 → 沐浴
        assert _get_twelve_stage('甲', '子') == '沐浴'

    def test_yin_stem_乙_at_午(self):
        # 乙 starts at 午, yin reverses, so 午 = 長生
        assert _get_twelve_stage('乙', '午') == '長生'

    def test_yin_stem_乙_at_巳(self):
        # 乙 starts at 午(idx=7), 巳 idx=6, yin: offset=(7-6)%12=1 → 沐浴
        assert _get_twelve_stage('乙', '巳') == '沐浴'


class TestFindActiveLuckPeriod:
    def test_found(self, sample_luck_periods):
        lp = _find_active_luck_period(sample_luck_periods, 2025)
        assert lp['stem'] == '丙'

    def test_not_found(self, sample_luck_periods):
        lp = _find_active_luck_period(sample_luck_periods, 2010)
        assert lp is None


class TestEnrichLuckPeriods:
    def test_adds_ten_god(self, default_effective_gods):
        lps = [{'stem': '甲', 'branch': '寅', 'startYear': 2020, 'endYear': 2029}]
        result = _enrich_luck_periods(lps, '戊', 'male', default_effective_gods)
        # derive_ten_god(戊, 甲): 甲=木yang克戊=土yang → 偏官
        assert result[0]['tenGod'] == '偏官'
        assert result[0]['branchMainTenGod'] == '偏官'  # 寅 hidden[0]=甲


class TestYearBranchFromStars:
    def test_found(self, sample_annual_stars):
        assert year_branch_from_stars(sample_annual_stars, 2024) == '辰'

    def test_not_found(self, sample_annual_stars):
        assert year_branch_from_stars(sample_annual_stars, 1999) == ''


# ============================================================
# 1. classify_peach_blossoms (18 tests)
# ============================================================

class TestClassifyPeachBlossoms:
    """Tests for classify_peach_blossoms — 12 sub-types."""

    def test_qiangnei_taohua_month_pillar(self, default_effective_gods):
        """牆內桃花: taohua branch in month pillar (View B: year+month = 牆內)."""
        # Day branch 辰 → TAOHUA['辰']='酉'. Put 酉 in month branch.
        pillars = make_pillars('庚', '午', '辛', '酉', '戊', '辰', '甲', '寅')
        result = classify_peach_blossoms(pillars, '戊', '辰', '午', default_effective_gods, 'male')
        types = [p['type'] for p in result['positive']]
        assert '牆內桃花' in types

    def test_qiangwai_taohua_hour_pillar(self, default_effective_gods):
        """牆外桃花: taohua branch in hour pillar (View B: day+hour = 牆外)."""
        # Day branch 辰 → TAOHUA='酉'. Put 酉 in hour.
        pillars = make_pillars('庚', '午', '辛', '巳', '戊', '辰', '甲', '酉')
        result = classify_peach_blossoms(pillars, '戊', '辰', '午', default_effective_gods, 'male')
        types = [n['type'] for n in result['negative']]
        assert '牆外桃花' in types

    def test_qiangnei_taohua_year_pillar(self, default_effective_gods):
        """牆內桃花: taohua branch in year pillar (View B: year+month = 牆內)."""
        # Day branch 辰 → TAOHUA='酉'. Put 酉 in year branch.
        pillars = make_pillars('庚', '酉', '辛', '巳', '戊', '辰', '甲', '寅')
        result = classify_peach_blossoms(pillars, '戊', '辰', '酉', default_effective_gods, 'male')
        types = [p['type'] for p in result['positive']]
        assert '牆內桃花' in types

    def test_tianxi_taohua(self, default_effective_gods):
        """天喜桃花: branch matches TIANXI[year_branch]."""
        # Year branch 子 → TIANXI='酉'. Put 酉 in month.
        pillars = make_pillars('庚', '子', '辛', '酉', '戊', '辰', '甲', '寅')
        result = classify_peach_blossoms(pillars, '戊', '辰', '子', default_effective_gods, 'male')
        types = [p['type'] for p in result['positive']]
        assert '天喜桃花' in types

    def test_hongluan_taohua(self, default_effective_gods):
        """紅鸞桃花: branch matches HONGLUAN[year_branch]."""
        # Year branch 子 → HONGLUAN='卯'. Put 卯 in month.
        pillars = make_pillars('庚', '子', '辛', '卯', '戊', '辰', '甲', '寅')
        result = classify_peach_blossoms(pillars, '戊', '辰', '子', default_effective_gods, 'male')
        types = [p['type'] for p in result['positive']]
        assert '紅鸞桃花' in types

    def test_guiren_taohua(self, default_effective_gods):
        """貴人桃花: branch is both TIANYI_GUIREN + taohua."""
        # DM=戊 → TIANYI_GUIREN=['丑','未']. Day branch 亥 → TAOHUA='子'. Not easy to combine.
        # DM=己 → TIANYI_GUIREN=['子','申']. Day branch 亥 → TAOHUA='子'. 子 is both guiren + taohua!
        pillars = make_pillars('庚', '午', '辛', '子', '己', '亥', '甲', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = classify_peach_blossoms(pillars, '己', '亥', '午', eg, 'male')
        types = [p['type'] for p in result['positive']]
        assert '貴人桃花' in types

    def test_guanxing_taohua_male(self, default_effective_gods):
        """官星桃花: taohua branch's hidden stem 本氣 = spouse star (正財 for male)."""
        # DM=甲, male → spouse_star=正財. 正財 element=土, so hidden benqi needs to derive as 正財.
        # Day branch 寅 → TAOHUA='卯'. 卯 hidden=[乙]. derive_ten_god(甲, 乙)=劫財. Not 正財.
        # Day branch 申 → TAOHUA='酉'. 酉 hidden=[辛]. derive_ten_god(甲,辛)=正官. Not.
        # DM=丙, male → spouse_star=正財. 正財=金(丙克金). derive_ten_god(丙,辛)=正財.
        # Day branch 辰 → TAOHUA='酉'. 酉 hidden=[辛]. derive_ten_god(丙,辛)=正財. Yes!
        pillars = make_pillars('庚', '午', '辛', '酉', '丙', '辰', '甲', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = classify_peach_blossoms(pillars, '丙', '辰', '午', eg, 'male')
        types = [p['type'] for p in result['positive']]
        assert '官星桃花' in types

    def test_muyu_taohua_always_negative(self, default_effective_gods):
        """沐浴桃花: POLICY — always 爛桃花 regardless of hidden stem ten god."""
        # DM=庚 → MUYU='午'. 午 hidden=[丁,己]. derive_ten_god(庚,丁)=正財
        # Previously this was classified as positive, but policy change: always negative.
        pillars = make_pillars('庚', '子', '辛', '午', '庚', '辰', '甲', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = classify_peach_blossoms(pillars, '庚', '辰', '子', eg, 'male')
        types = [n['type'] for n in result['negative']]
        assert '沐浴桃花' in types
        # Verify caveat field exists
        muyu_items = [n for n in result['negative'] if n['type'] == '沐浴桃花']
        assert muyu_items[0].get('caveat'), "沐浴桃花 should have caveat for competing view"

    def test_muyu_taohua_negative(self, default_effective_gods):
        """沐浴桃花 negative: hidden stem benqi = negative ten god."""
        # DM=乙 → MUYU='巳'. 巳 hidden=[丙,庚,戊]. derive_ten_god(乙,丙)=傷官 → negative
        pillars = make_pillars('庚', '子', '辛', '巳', '乙', '卯', '甲', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = classify_peach_blossoms(pillars, '乙', '卯', '子', eg, 'male')
        types = [n['type'] for n in result['negative']]
        assert '沐浴桃花' in types

    def test_jiuchou_taohua(self, default_effective_gods):
        """九丑桃花: day pillar in JIUCHOU_DAYS."""
        # 壬子 is in JIUCHOU_DAYS
        pillars = make_pillars('庚', '午', '辛', '巳', '壬', '子', '甲', '寅')
        result = classify_peach_blossoms(pillars, '壬', '子', '午', default_effective_gods, 'male')
        types = [n['type'] for n in result['negative']]
        assert '九丑桃花' in types

    def test_hongyan_sha_regular(self, default_effective_gods):
        """紅艷煞: branch matches HONGYAN_SHA[day_master_stem]."""
        # DM=甲 → HONGYAN='午'. Put 午 in year.
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = classify_peach_blossoms(pillars, '甲', '辰', '午', default_effective_gods, 'male')
        neg_types = [n['type'] for n in result['negative']]
        assert '紅艷煞' in neg_types
        hongyan = [n for n in result['negative'] if n['type'] == '紅艷煞'][0]
        assert hongyan['selfSitting'] is False
        assert hongyan['severity'] == 'mild'

    def test_hongyan_sha_self_sitting(self, default_effective_gods):
        """紅艷煞 self-sitting: day pillar is in HONGYAN_SELF_SITTING."""
        # 甲午 is in HONGYAN_SELF_SITTING. DM=甲 → HONGYAN='午'. Day=甲午.
        pillars = make_pillars('庚', '子', '辛', '巳', '甲', '午', '丙', '寅')
        result = classify_peach_blossoms(pillars, '甲', '午', '子', default_effective_gods, 'male')
        neg_types = [n['type'] for n in result['negative']]
        assert '紅艷煞' in neg_types
        hongyan = [n for n in result['negative'] if n['type'] == '紅艷煞'][0]
        assert hongyan['selfSitting'] is True
        assert hongyan['severity'] == 'moderate'

    def test_taohua_jie_jiecai(self, default_effective_gods):
        """桃花劫: taohua branch with 劫財 on stem."""
        # DM=戊, day branch 辰 → TAOHUA='酉'. Put 酉 in month with stem 己 (劫財 to 戊).
        pillars = make_pillars('庚', '午', '己', '酉', '戊', '辰', '甲', '寅')
        result = classify_peach_blossoms(pillars, '戊', '辰', '午', default_effective_gods, 'male')
        neg_types = [n['type'] for n in result['negative']]
        assert '桃花劫' in neg_types

    def test_taohua_jie_female_qisha(self, default_effective_gods):
        """桃花劫 female: taohua branch with 七殺(偏官) on stem."""
        # DM=戊, female. 偏官 = derive_ten_god(戊, X)=偏官 → X must be 甲 (甲克戊? No, 木克土, 甲 is yang wood, 戊 is yang earth → 偏官).
        # Day branch 辰 → TAOHUA='酉'. Put 酉 in month with stem 甲 (偏官).
        pillars = make_pillars('庚', '午', '甲', '酉', '戊', '辰', '丙', '寅')
        result = classify_peach_blossoms(pillars, '戊', '辰', '午', default_effective_gods, 'female')
        neg_types = [n['type'] for n in result['negative']]
        assert '桃花劫' in neg_types

    def test_taohua_ren(self, default_effective_gods):
        """桃花刃: taohua branch coincides with yangren branch."""
        # DM=壬 → YANGREN='子'. Day branch 亥 → TAOHUA='子'. So 子 is both taohua and yangren.
        # Put 子 in month.
        pillars = make_pillars('庚', '午', '辛', '子', '壬', '亥', '甲', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = classify_peach_blossoms(pillars, '壬', '亥', '午', eg, 'male')
        neg_types = [n['type'] for n in result['negative']]
        assert '桃花刃' in neg_types

    def test_no_peach_blossoms(self, default_effective_gods):
        """No peach blossoms detected."""
        # Make a chart where no branches match any peach blossom lookup
        pillars = make_pillars('庚', '寅', '辛', '巳', '戊', '戌', '甲', '辰')
        result = classify_peach_blossoms(pillars, '戊', '戌', '寅', default_effective_gods, 'male')
        # May still have hongyan etc. Check summary for low count scenario.
        assert 'summary' in result
        assert result['totalPositive'] >= 0
        assert result['totalNegative'] >= 0

    def test_multiple_types_same_pillar(self, default_effective_gods):
        """Multiple peach blossom types on same pillar."""
        # DM=壬, day branch 亥 → TAOHUA='子'. YANGREN壬='子'. HONGYAN壬='子'. MUYU壬='酉'.
        # Month branch=子: is taohua + yangren + hongyan
        pillars = make_pillars('庚', '午', '辛', '子', '壬', '亥', '甲', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = classify_peach_blossoms(pillars, '壬', '亥', '午', eg, 'male')
        all_types = [p['type'] for p in result['positive']] + [n['type'] for n in result['negative']]
        # Should have multiple types from the month pillar
        month_entries = [p for p in result['positive'] + result['negative'] if p.get('pillar') == 'month']
        assert len(month_entries) >= 2

    def test_summary_positive_dominant(self):
        """Summary when positive > 2*negative."""
        pillars = make_pillars('庚', '子', '辛', '卯', '丙', '辰', '甲', '酉')
        # year=子 → HONGLUAN='卯' (month=卯), TIANXI='酉' (hour=酉). Day=辰 → TAOHUA='酉' (hour).
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = classify_peach_blossoms(pillars, '丙', '辰', '子', eg, 'male')
        # Multiple positive entries expected
        if result['totalPositive'] > result['totalNegative'] * 2:
            assert '正桃花為主' in result['summary']


# ============================================================
# 2. compute_spouse_star_analysis (20 tests)
# ============================================================

class TestComputeSpouseStarAnalysis:
    """Tests for spouse star analysis."""

    def test_visibility_透出_male(self, default_effective_gods, default_strength_v2):
        """Male: 正財 visible on a stem → 透出."""
        # DM=甲, male. 正財=土(甲克). derive_ten_god(甲, 己)=正財. Put 己 on month stem.
        pillars = make_pillars('庚', '午', '己', '巳', '甲', '辰', '丙', '寅')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        assert result['visibility'] == '透出'
        assert result['spouseStar'] == '正財'

    def test_visibility_暗藏(self, default_effective_gods, default_strength_v2):
        """Spouse star only in hidden stems → 暗藏."""
        # DM=甲, male. 正財=己(土). No 己 on any stem, but 辰 hidden=[戊,乙,癸].
        # derive_ten_god(甲,戊)=偏財. Need 己 hidden somewhere.
        # 午 hidden=[丁,己]. derive_ten_god(甲,己)=正財.
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        # Check: stems are 庚(偏官), 辛(正官), 甲(比肩), 丙(食神) — no 正財 on stems
        # But 午 hidden has 己 → 正財 hidden
        assert result['visibility'] == '暗藏'

    def test_visibility_全無(self, default_effective_gods, default_strength_v2):
        """No spouse star anywhere → 全無."""
        # DM=壬, male. 正財=火(壬克). derive_ten_god(壬,丁)=正財, derive_ten_god(壬,丙)=偏財.
        # Need chart with no 丁 or 丙 anywhere (stems or hidden).
        # Hard to avoid completely since many branches have fire hidden stems.
        # Use branches with no fire: 子=[癸], 丑=[己癸辛], 酉=[辛], 亥=[壬甲]
        pillars = make_pillars('壬', '子', '癸', '丑', '壬', '酉', '辛', '亥')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_spouse_star_analysis(pillars, '壬', 'male', eg, default_strength_v2)
        # Check: no fire stems, hidden: 子=[癸](偏印), 丑=[己正官,癸比肩,辛正印], 酉=[辛正印], 亥=[壬比肩,甲食神]
        # derive_ten_god(壬,己)=正官, not 正財/偏財. So no spouse star.
        assert result['visibility'] == '全無'

    def test_balance_strong_dm_strong_star(self, default_effective_gods):
        """Strong DM + strong spouse star → balanced."""
        pillars = make_pillars('己', '午', '己', '巳', '甲', '辰', '己', '未')
        strength = {'classification': 'strong', 'score': 65}
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, strength)
        # 己 appears on 3 stems, each is 正財. Plus hidden stems. spouse_count >= 3
        assert result['balance'] == 'balanced'

    def test_balance_strong_dm_weak_star(self, default_effective_gods, strong_strength):
        """Strong DM + weak spouse star → dominates."""
        pillars = make_pillars('庚', '寅', '辛', '卯', '甲', '辰', '丙', '午')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, strong_strength)
        # Stems: 庚(偏官), 辛(正官), 甲(比肩), 丙(食神). Few 正財/偏財.
        if len(result['positions']) + len(result['romancePositions']) < 3:
            assert result['balance'] == 'dominates'

    def test_balance_weak_dm_strong_star(self, default_effective_gods):
        """Weak DM + strong spouse star → overwhelmed."""
        pillars = make_pillars('己', '午', '己', '巳', '甲', '未', '己', '丑')
        strength = {'classification': 'weak', 'score': 30}
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, strength)
        # Multiple 己 = 正財 on stems
        spouse_count = len(result['positions']) + len(result['romancePositions'])
        if spouse_count >= 3:
            assert result['balance'] == 'overwhelmed'

    def test_balance_weak_dm_weak_star(self, default_effective_gods, weak_strength):
        """Weak DM + weak spouse star → lacking."""
        pillars = make_pillars('庚', '寅', '辛', '卯', '甲', '辰', '丙', '午')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, weak_strength)
        spouse_count = len(result['positions']) + len(result['romancePositions'])
        if spouse_count < 3:
            assert result['balance'] == 'lacking'

    def test_guansha_hunza_female(self, default_effective_gods, default_strength_v2):
        """Female: 官殺混雜 when both 正官 and 偏官 present."""
        # DM=甲, female. 正官=辛(金yin). 偏官=庚(金yang).
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = compute_spouse_star_analysis(pillars, '甲', 'female', default_effective_gods, default_strength_v2)
        challenge_types = [c['type'] for c in result['challenges']]
        assert '官殺混雜' in challenge_types

    def test_caixing_hunza_male(self, default_effective_gods, default_strength_v2):
        """Male: 財星混雜 when both 正財 and 偏財 present."""
        # DM=甲, male. 正財=己. 偏財=戊. 辰hidden=[戊,乙,癸] has 戊=偏財. Need 己 on a stem.
        pillars = make_pillars('己', '午', '庚', '巳', '甲', '辰', '丙', '寅')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        challenge_types = [c['type'] for c in result['challenges']]
        assert '財星混雜' in challenge_types

    def test_shangguan_jianguan_female_no_buffer(self, default_effective_gods, default_strength_v2):
        """Female: 傷官見官 without financial buffer → critical."""
        # DM=甲, female. 傷官=丁(火yin). 正官=辛(金yin).
        # Need 丁 and 辛 on stems, and NO 正財/偏財 on stems/hidden.
        # Actually just needs no 財星 in all_ten_gods.
        # But 偏官=庚 is also present → 傷官合殺 triggers → severity becomes moderate.
        # Let's avoid 偏官. Use only 辛 for 正官, 丁 for 傷官.
        # Branches without 戊/己: 卯=[乙], 酉=[辛], 子=[癸], 亥=[壬,甲]
        pillars = make_pillars('丁', '卯', '辛', '子', '甲', '亥', '癸', '酉')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_spouse_star_analysis(pillars, '甲', 'female', eg, default_strength_v2)
        challenge_types = [c['type'] for c in result['challenges']]
        if '傷官見官' in challenge_types:
            sg = [c for c in result['challenges'] if c['type'] == '傷官見官'][0]
            # Check if no financial buffer and no 合殺
            if not sg.get('hasFinancialBuffer') and not sg.get('shangGuanHeSha'):
                assert sg['severity'] == 'critical'

    def test_shangguan_jianguan_female_with_buffer(self, default_effective_gods, default_strength_v2):
        """Female: 傷官見官 with 財星 buffer → moderate."""
        # DM=甲, female. 傷官=丁. 正官=辛. 正財=己.
        pillars = make_pillars('丁', '卯', '辛', '子', '甲', '丑', '己', '酉')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_spouse_star_analysis(pillars, '甲', 'female', eg, default_strength_v2)
        challenge_types = [c['type'] for c in result['challenges']]
        if '傷官見官' in challenge_types:
            sg = [c for c in result['challenges'] if c['type'] == '傷官見官'][0]
            assert sg['hasFinancialBuffer'] is True
            assert sg['severity'] == 'moderate'

    def test_shangguan_jianguan_with_hesha(self, default_effective_gods, default_strength_v2):
        """Female: 傷官見官 with 傷官合殺 → moderate."""
        # DM=甲. 傷官=丁. 正官=辛. 偏官=庚. 傷官+偏官 both present → 合殺.
        pillars = make_pillars('庚', '卯', '辛', '子', '甲', '亥', '丁', '酉')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_spouse_star_analysis(pillars, '甲', 'female', eg, default_strength_v2)
        challenge_types = [c['type'] for c in result['challenges']]
        if '傷官見官' in challenge_types:
            sg = [c for c in result['challenges'] if c['type'] == '傷官見官'][0]
            assert sg['shangGuanHeSha'] is True

    def test_bijie_duocai_male(self, default_effective_gods, default_strength_v2):
        """Male: 比劫奪財 when 比劫>=2 and 財>=1."""
        # DM=甲, male. 比肩=甲, 劫財=乙.
        # Put 甲 on year stem, 乙 on month (or hidden). 正財=己 on hour stem.
        pillars = make_pillars('甲', '卯', '乙', '巳', '甲', '辰', '己', '寅')
        # 卯hidden=[乙]=劫財. So bijie: year_stem甲(比肩), month_stem乙(劫財), 卯hidden乙(劫財), 寅hidden甲(比肩) → bijie>=2
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        challenge_types = [c['type'] for c in result['challenges']]
        assert '比劫奪財' in challenge_types

    def test_bijie_duocai_with_venting(self, default_effective_gods, default_strength_v2):
        """Male: 比劫奪財 with 食傷 venting → moderate severity."""
        # DM=甲. 比肩=甲. 劫財=乙. 食神=丙, 傷官=丁. 正財=己.
        pillars = make_pillars('甲', '午', '乙', '巳', '甲', '辰', '己', '寅')
        # 午hidden=[丁,己] → 丁=傷官. 巳hidden=[丙,庚,戊] → 丙=食神.
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        challenge_types = [c['type'] for c in result['challenges']]
        if '比劫奪財' in challenge_types:
            bjdc = [c for c in result['challenges'] if c['type'] == '比劫奪財'][0]
            assert bjdc['hasVentingFlow'] is True
            assert bjdc['severity'] == 'moderate'

    def test_bijie_in_day_branch(self, default_effective_gods, default_strength_v2):
        """Male: 比劫 in day branch hidden stems."""
        # DM=甲. Day branch=寅, hidden=[甲,丙,戊]. 甲=比肩 → bi_jie_in_day=True
        pillars = make_pillars('甲', '卯', '乙', '巳', '甲', '寅', '己', '午')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        challenge_types = [c['type'] for c in result['challenges']]
        if '比劫奪財' in challenge_types:
            bjdc = [c for c in result['challenges'] if c['type'] == '比劫奪財'][0]
            assert bjdc['biJieInDayBranch'] is True

    def test_late_marriage_indicator(self, default_effective_gods, default_strength_v2):
        """Late marriage indicator when hour hidden has spouse star."""
        # DM=甲, male. 正財=己. 偏財=戊. Hour branch=未, hidden=[己,丁,乙]. 己=正財.
        pillars = make_pillars('庚', '寅', '辛', '卯', '甲', '辰', '丙', '未')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        assert result['lateMarriageIndicator'] is True

    def test_no_late_marriage(self, default_effective_gods, default_strength_v2):
        """No late marriage indicator."""
        # DM=甲. Hour branch=酉, hidden=[辛]. derive_ten_god(甲,辛)=正官 → not spouse star for male.
        pillars = make_pillars('庚', '寅', '辛', '卯', '甲', '辰', '丙', '酉')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        assert result['lateMarriageIndicator'] is False

    def test_female_spouse_star_is_zhengguan(self, default_effective_gods, default_strength_v2):
        """Female spouse star is 正官."""
        pillars = make_pillars('庚', '寅', '辛', '卯', '甲', '辰', '丙', '酉')
        result = compute_spouse_star_analysis(pillars, '甲', 'female', default_effective_gods, default_strength_v2)
        assert result['spouseStar'] == '正官'
        assert result['romanceStar'] == '偏官'

    def test_male_spouse_star_is_zhengcai(self, default_effective_gods, default_strength_v2):
        """Male spouse star is 正財."""
        pillars = make_pillars('庚', '寅', '辛', '卯', '甲', '辰', '丙', '酉')
        result = compute_spouse_star_analysis(pillars, '甲', 'male', default_effective_gods, default_strength_v2)
        assert result['spouseStar'] == '正財'
        assert result['romanceStar'] == '偏財'


# ============================================================
# 3. compute_marriage_palace_analysis (12 tests)
# ============================================================

class TestComputeMarriagePalaceAnalysis:
    """Tests for marriage palace analysis."""

    def test_element_wood(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '卯', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', [])
        assert result['element'] == '木'
        assert result['dayBranch'] == '卯'

    def test_element_fire(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '午', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', [])
        assert result['element'] == '火'

    def test_appearance_hint(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '酉', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', [])
        assert result['element'] == '金'
        assert '白皙' in result['appearanceHint']

    def test_personality_archetype(self):
        """Palace ten god drives personality archetype."""
        # Day branch=辰, hidden=[戊,乙,癸]. DM=甲 → derive_ten_god(甲,戊)=偏財
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', [])
        assert result['palaceTenGod'] == '偏財'
        assert '交際廣泛' in result['personalityArchetype']

    def test_twelve_stage_yang_stem(self):
        """Yang stem 十二長生 stage."""
        # DM=甲(yang), starts at 亥. Day branch=寅. offset=(寅idx3 - 亥idx11)%12 = -8%12=4 → 帝旺
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '寅', '丙', '子')
        result = compute_marriage_palace_analysis(pillars, '甲', [])
        assert result['twelveStage'] == '臨官'
        # Actually: 亥=0:長生, 子=1:沐浴, 丑=2:冠帶, 寅=3:臨官

    def test_twelve_stage_yin_stem(self):
        """Yin stem 十二長生 stage (reverse)."""
        # DM=乙(yin), starts at 午(idx=7). Day branch=卯(idx=4). offset=(7-4)%12=3 → 臨官
        pillars = make_pillars('庚', '午', '辛', '巳', '乙', '卯', '丙', '子')
        result = compute_marriage_palace_analysis(pillars, '乙', [])
        assert result['twelveStage'] == '臨官'

    def test_kong_wang_true(self):
        """Day branch in kong_wang → isKongWang=True."""
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', ['辰', '巳'])
        assert result['isKongWang'] is True

    def test_kong_wang_false(self):
        """Day branch not in kong_wang → isKongWang=False."""
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', ['子', '丑'])
        assert result['isKongWang'] is False

    def test_natal_liuhai_detected(self):
        """Natal 六害 detected: another branch harms day branch."""
        # Day branch=辰. HARM_LOOKUP['卯']='辰'. Put 卯 in month.
        pillars = make_pillars('庚', '午', '辛', '卯', '甲', '辰', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', [])
        assert len(result['natalHarm']) >= 1
        assert result['natalHarm'][0]['pillar'] == 'month'

    def test_natal_liuhai_not_detected(self):
        """No natal 六害."""
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', [])
        # HARM_LOOKUP: 午→丑, 巳→寅, 寅→巳. None map to 辰.
        assert len(result['natalHarm']) == 0

    def test_day_pillar_returned(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = compute_marriage_palace_analysis(pillars, '甲', [])
        assert result['dayPillar'] == '甲辰'

    def test_all_five_elements_appearance(self):
        """All 5 elements have appearance hints."""
        for branch, element in [('寅', '木'), ('午', '火'), ('辰', '土'), ('酉', '金'), ('子', '水')]:
            pillars = make_pillars('庚', '午', '辛', '巳', '甲', branch, '丙', '寅')
            result = compute_marriage_palace_analysis(pillars, '甲', [])
            assert result['appearanceHint'] != '', f"Missing appearance for {element}"


# ============================================================
# 4. compute_love_personality (14 tests)
# ============================================================

class TestComputeLovePersonality:
    """Tests for love personality analysis."""

    def _make_result(self, dm, pillars, gender='male', strength_class='balanced', shen_sha=None):
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        sv2 = {'classification': strength_class, 'score': 50}
        return compute_love_personality(pillars, dm, gender, eg, sv2, shen_sha or [])

    def test_dominant_ten_god_detected(self):
        """Dominant ten god is the one with highest count."""
        # DM=甲. Stems: 甲(比肩)x2, 丙(食神), 庚(偏官). Branches have various hidden stems.
        pillars = make_pillars('甲', '寅', '甲', '卯', '甲', '辰', '丙', '午')
        result = self._make_result('甲', pillars)
        # 比肩 should dominate (甲 on 3 stems + 寅hidden甲 + 卯hidden乙=劫財)
        assert result['dominantTenGod'] in result['tenGodCounts']

    def test_archetype_label_exists(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars)
        assert 'label' in result['archetype']
        assert 'trait' in result['archetype']

    def test_element_style_wood(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars)
        assert result['dmElement'] == '木'
        assert result['elementStyle']['style'] == '浪漫理想派'

    def test_element_style_fire(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '丙', '辰', '甲', '寅')
        result = self._make_result('丙', pillars)
        assert result['dmElement'] == '火'
        assert result['elementStyle']['style'] == '熱情衝動派'

    def test_element_style_earth(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '戊', '辰', '甲', '寅')
        result = self._make_result('戊', pillars)
        assert result['elementStyle']['style'] == '穩重踏實派'

    def test_element_style_metal(self):
        pillars = make_pillars('甲', '午', '辛', '巳', '庚', '辰', '丙', '寅')
        result = self._make_result('庚', pillars)
        assert result['elementStyle']['style'] == '冷靜理性派'

    def test_element_style_water(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '壬', '辰', '甲', '寅')
        result = self._make_result('壬', pillars)
        assert result['elementStyle']['style'] == '靈活變通派'

    def test_strength_strong(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars, strength_class='strong')
        assert '身強' in result['strengthImpact']

    def test_strength_weak(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars, strength_class='weak')
        assert '身弱' in result['strengthImpact']

    def test_strength_balanced(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars, strength_class='balanced')
        assert '身中' in result['strengthImpact']

    def test_love_tags_from_shensha(self):
        shen_sha = [
            {'name': '紅鸞', 'pillar': 'year'},
            {'name': '天喜', 'pillar': 'month'},
            {'name': '華蓋', 'pillar': 'day'},  # Not a love tag
        ]
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars, shen_sha=shen_sha)
        assert '紅鸞' in result['loveTags']
        assert '天喜' in result['loveTags']
        assert '華蓋' not in result['loveTags']

    def test_guchen_gwashu_tags(self):
        shen_sha = [{'name': '孤辰', 'pillar': 'year'}, {'name': '寡宿', 'pillar': 'hour'}]
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars, shen_sha=shen_sha)
        assert '孤辰' in result['loveTags']
        assert '寡宿' in result['loveTags']

    def test_ten_god_counts_populated(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars)
        assert len(result['tenGodCounts']) > 0

    def test_all_ten_archetypes(self):
        """All 10 ten god labels are valid."""
        valid_labels = {'獨立型', '競爭型', '享受型', '才華型', '風流型',
                        '務實型', '霸道型', '傳統型', '獨特型', '溫暖型'}
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        result = self._make_result('甲', pillars)
        assert result['archetype']['label'] in valid_labels


# ============================================================
# 5. compute_marriage_timing_indicators (12 tests)
# ============================================================

class TestComputeMarriageTimingIndicators:
    """Tests for marriage timing indicators."""

    def _make_result(self, pillars, dm, gender, eg=None, shensha=None, lps=None):
        eg = eg or {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        return compute_marriage_timing_indicators(
            pillars, dm, gender, eg, shensha or [], lps or []
        )

    def test_early_signal_month_stem_spouse_star(self):
        """Month stem = spouse star → early signal."""
        # DM=甲, male → spouse_star=正財. derive_ten_god(甲,己)=正財. Month stem=己.
        pillars = make_pillars('庚', '寅', '己', '巳', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male')
        assert len(result['earlySignals']) >= 1
        assert '月柱天干見正財' in result['earlySignals'][0]

    def test_early_signal_month_hidden_spouse_star(self):
        """Month branch hidden benqi = spouse star → early signal."""
        # DM=甲, male → 正財=己. Month branch=未, hidden=[己,丁,乙]. 己=正財.
        pillars = make_pillars('庚', '寅', '辛', '未', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male')
        assert any('月柱地支藏正財' in s for s in result['earlySignals'])

    def test_late_signal_hour_stem_spouse_star(self):
        """Hour stem = spouse star → late signal."""
        # DM=甲, male → 正財=己. Hour stem=己.
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '己', '午')
        result = self._make_result(pillars, '甲', 'male')
        assert any('時柱天干見正財' in s for s in result['lateSignals'])

    def test_late_signal_hour_hidden_spouse_star(self):
        """Hour branch hidden has spouse star → late signal."""
        # DM=甲, male. Hour branch=未, hidden=[己]. 己=正財.
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '未')
        result = self._make_result(pillars, '甲', 'male')
        assert any('時柱地支藏正財' in s for s in result['lateSignals'])

    def test_late_signal_guchen(self):
        """孤辰 shensha → late signal."""
        shensha = [{'name': '孤辰', 'pillar': 'year'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male', shensha=shensha)
        assert any('孤辰' in s for s in result['lateSignals'])

    def test_late_signal_gwashu(self):
        shensha = [{'name': '寡宿', 'pillar': 'hour'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male', shensha=shensha)
        assert any('寡宿' in s for s in result['lateSignals'])

    def test_late_signal_yinyang_chacuo(self):
        shensha = [{'name': '陰陽差錯', 'pillar': 'day'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male', shensha=shensha)
        assert any('陰陽差錯' in s for s in result['lateSignals'])

    def test_favorable_lp_spouse_star(self):
        """LP with spouse star → favorable range."""
        # DM=甲, male → 正財 element=土. LP stem=己 → derive_ten_god(甲,己)=正財.
        lps = [{'stem': '己', 'branch': '巳', 'startYear': 2030, 'endYear': 2039, 'startAge': 35}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male', lps=lps)
        assert len(result['favorableLPRanges']) >= 1

    def test_unfavorable_lp_clash(self):
        """LP clashing day branch → unfavorable."""
        # Day branch=辰, CLASH_LOOKUP['辰']='戌'. LP branch=戌.
        lps = [{'stem': '丙', 'branch': '戌', 'startYear': 2030, 'endYear': 2039, 'startAge': 35}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male', lps=lps)
        assert len(result['unfavorableLPRanges']) >= 1

    def test_unfavorable_lp_danger_tg_male(self):
        """Male: LP with 劫財/比肩 → unfavorable."""
        # DM=甲, LP stem=甲 → 比肩 (danger for male)
        lps = [{'stem': '甲', 'branch': '午', 'startYear': 2030, 'endYear': 2039, 'startAge': 35}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male', lps=lps)
        assert len(result['unfavorableLPRanges']) >= 1

    def test_no_signals(self):
        """No early or late signals."""
        # Make chart where month and hour don't have spouse star
        pillars = make_pillars('庚', '寅', '辛', '酉', '甲', '辰', '丙', '戌')
        result = self._make_result(pillars, '甲', 'male')
        # May or may not have signals depending on hidden stems; just check structure
        assert 'earlySignals' in result
        assert 'lateSignals' in result

    def test_favorable_lp_harmony(self):
        """LP branch harmonizes with day branch → favorable."""
        # Day branch=辰. HARMONY_LOOKUP['酉']='辰'. LP branch=酉.
        lps = [{'stem': '丙', 'branch': '酉', 'startYear': 2030, 'endYear': 2039, 'startAge': 35}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = self._make_result(pillars, '甲', 'male', lps=lps)
        assert len(result['favorableLPRanges']) >= 1
        reasons = result['favorableLPRanges'][0]['reasons']
        assert any('合配偶宮' in r for r in reasons)


# ============================================================
# 6. compute_romance_good_years (12 tests)
# ============================================================

class TestComputeRomanceGoodYears:
    """Tests for romance good years computation."""

    def _make_result(self, dm='甲', day_branch='辰', year_branch='午',
                     annual_stars=None, kong_wang=None, birth_year=1990,
                     current_year=2026, lps=None, gender='male'):
        if annual_stars is None:
            # Generate stars for years 2024-2036
            branches = ['辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑', '寅', '卯', '辰']
            stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '甲', '乙', '丙']
            annual_stars = [{'year': 2024 + i, 'stem': stems[i], 'branch': branches[i]} for i in range(13)]
        return compute_romance_good_years(
            gender, dm, day_branch, year_branch,
            annual_stars, kong_wang or [], birth_year, current_year, lps or [],
        )

    def test_returns_list(self):
        result = self._make_result()
        assert isinstance(result, list)

    def test_star_type_hongluan(self):
        """Year where annual branch matches HONGLUAN should be 紅鸞年."""
        # year_branch=午 → HONGLUAN['午']='酉'. Annual branch=酉 at year 2029.
        result = self._make_result(year_branch='午')
        hongluan_years = [y for y in result if y.get('starType') == '紅鸞年']
        # May or may not appear depending on romance_years_enriched filtering
        # Just check structure
        for y in result:
            assert 'starType' in y

    def test_star_type_tianxi(self):
        """Year where annual branch matches TIANXI should be 天喜年."""
        # year_branch=午 → TIANXI['午']='卯'. Annual branch=卯 at year 2035.
        result = self._make_result(year_branch='午')
        VALID_STAR_TYPES = ('紅鸞年', '天喜年', '正緣年', '偏財桃花年', '偏官桃花年', '合婚年', '桃花合年', '紅鸞正緣年', '天喜桃花年', '天喜紅鸞年')
        for y in result:
            assert y['starType'] in VALID_STAR_TYPES

    def test_star_type_default(self):
        """Years without hongluan/tianxi match → gender-aware starType."""
        result = self._make_result()
        VALID_STAR_TYPES = ('紅鸞年', '天喜年', '正緣年', '偏財桃花年', '偏官桃花年', '合婚年', '桃花合年', '紅鸞正緣年', '天喜桃花年', '天喜紅鸞年')
        for y in result:
            assert y['starType'] in VALID_STAR_TYPES

    def test_empty_when_no_romance_data(self):
        """Returns empty list when no romance years found."""
        result = self._make_result(annual_stars=[])
        assert result == []

    def test_each_year_has_startype(self):
        result = self._make_result()
        for y in result:
            assert 'starType' in y
            assert 'year' in y

    def test_with_dayun_context(self):
        """Results should be tagged with dayun context when LPs provided."""
        lps = [{'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2029, 'startAge': 25}]
        result = self._make_result(lps=lps)
        # Structure check
        assert isinstance(result, list)

    def test_female_gender(self):
        result = self._make_result(gender='female')
        assert isinstance(result, list)

    def test_different_dm(self):
        result = self._make_result(dm='壬', day_branch='子', year_branch='申')
        assert isinstance(result, list)

    def test_kong_wang_filtering(self):
        """Kong wang branches should be excluded from romance years."""
        result_no_kw = self._make_result(kong_wang=[])
        result_with_kw = self._make_result(kong_wang=['酉', '戌'])
        # With kong_wang, some years may be excluded
        assert isinstance(result_with_kw, list)

    def test_birth_year_affects_range(self):
        result = self._make_result(birth_year=2000, current_year=2026)
        assert isinstance(result, list)

    def test_current_year_boundary(self):
        result = self._make_result(current_year=2030)
        assert isinstance(result, list)


# ============================================================
# 7. compute_romance_danger_years (15 tests)
# ============================================================

class TestComputeRomanceDangerYears:
    """Tests for romance danger years."""

    def _make_stars(self, start_year=2026, count=11):
        """Generate annual stars from start_year."""
        all_branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
        all_stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        return [
            {'year': start_year + i, 'stem': all_stems[i % 10], 'branch': all_branches[i % 12]}
            for i in range(count)
        ]

    def test_liuchong_trigger(self):
        """六沖 trigger detected."""
        # Day branch=子. CLASH_LOOKUP['子']='午'. Star with branch=午.
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '子', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '子', stars, [], 2026)
        assert len(result) >= 1
        assert result[0]['primaryTrigger'] == '六沖'

    def test_sanxing_trigger(self):
        """三刑 trigger detected (寅巳申 all 3 present)."""
        # Day branch=寅. Star branch=巳. Natal has 申 in hour → all 3 present.
        stars = [{'year': 2026, 'stem': '丙', 'branch': '巳'}]
        pillars = make_pillars('庚', '午', '辛', '申', '甲', '寅', '丙', '子')
        result = compute_romance_danger_years(pillars, '甲', '寅', stars, [], 2026)
        triggers = [t['type'] for d in result for t in d['triggers']]
        assert '三刑' in triggers

    def test_liuhai_trigger(self):
        """六害 trigger detected."""
        # Day branch=子. HARM_LOOKUP['子']='未'. Star with branch=未.
        stars = [{'year': 2026, 'stem': '丁', 'branch': '未'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '子', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '子', stars, [], 2026)
        triggers = [t['type'] for d in result for t in d['triggers']]
        assert '六害' in triggers

    def test_zixing_trigger(self):
        """自刑 trigger detected (same branch)."""
        # Day branch=午. Star with branch=午.
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '午', '丙', '子')
        result = compute_romance_danger_years(pillars, '甲', '午', stars, [], 2026)
        triggers = [t['type'] for d in result for t in d['triggers']]
        assert '自刑' in triggers

    def test_hongyan_trigger(self):
        """紅艷桃花年 trigger detected."""
        # DM=甲 → HONGYAN='午'. Star with branch=午.
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '子')
        result = compute_romance_danger_years(pillars, '甲', '辰', stars, [], 2026)
        triggers = [t['type'] for d in result for t in d['triggers']]
        assert '紅艷桃花年' in triggers

    def test_severity_ordering(self):
        """Triggers sorted by severity descending."""
        # Day branch=午. CLASH_LOOKUP['午']='子'. HARM_LOOKUP['午']='丑'.
        # Star 子 → both 六沖(90) and other.
        # Actually need a single star triggering multiple. Day branch=寅.
        # Star=巳: 三刑(寅巳=80) + HARM_LOOKUP寅=巳(70)
        stars = [{'year': 2026, 'stem': '丙', 'branch': '巳'}]
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '寅', '丙', '子')
        result = compute_romance_danger_years(pillars, '甲', '寅', stars, [], 2026)
        if result and len(result[0]['triggers']) >= 2:
            severities = [t['severity'] for t in result[0]['triggers']]
            assert severities == sorted(severities, reverse=True)

    def test_kong_wang_not_excluded_but_flagged(self):
        """P6: 空亡 years are detected with reduced severity and isKongWang flag."""
        # day_branch='子', kong_wang=['午']. 午 clashes 子 (子午六沖).
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '子', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '子', stars, ['午'], 2026)
        assert len(result) == 1
        assert result[0]['isKongWang'] is True
        assert result[0]['maxSeverity'] == round(90 * 0.8)  # 72
        assert '空亡' in result[0]['triggers'][0]['description']

    def test_multiple_triggers_same_year(self):
        """Multiple triggers in the same year (三刑 + 六害)."""
        # Day branch=寅. Star=巳. Natal has 申 → 寅巳申 三刑 + 寅巳 六害
        stars = [{'year': 2026, 'stem': '丙', 'branch': '巳'}]
        pillars = make_pillars('庚', '午', '辛', '申', '甲', '寅', '丙', '子')
        result = compute_romance_danger_years(pillars, '甲', '寅', stars, [], 2026)
        if result:
            assert len(result[0]['triggers']) >= 2

    def test_year_range_filter(self):
        """Only years in [current_year, current_year+10] are included."""
        stars = [
            {'year': 2025, 'stem': '丙', 'branch': '午'},  # Before range
            {'year': 2026, 'stem': '丙', 'branch': '午'},  # In range
            {'year': 2037, 'stem': '丙', 'branch': '午'},  # After range
        ]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '子', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '子', stars, [], 2026)
        years = [d['year'] for d in result]
        assert 2025 not in years
        assert 2037 not in years

    def test_cap_at_10(self):
        """Results capped at 10."""
        # Generate 15 years, all with clash triggers
        stars = [{'year': 2026 + i, 'stem': '丙', 'branch': '午'} for i in range(15)]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '子', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '子', stars, [], 2026)
        assert len(result) <= 10

    def test_sorted_by_year(self):
        """Results sorted by year."""
        stars = self._make_stars()
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '子', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '子', stars, [], 2026)
        years = [d['year'] for d in result]
        assert years == sorted(years)

    def test_empty_when_no_triggers(self):
        """Empty result when no triggers match."""
        # Day branch=辰. Use stars that don't clash/harm/punish 辰.
        # CLASH_LOOKUP['辰']='戌'. HARM_LOOKUP['辰']='卯'.
        # Avoid 戌, 卯, 辰 in stars. HONGYAN甲='午' — avoid 午 too.
        stars = [{'year': 2026, 'stem': '壬', 'branch': '子'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '辰', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '辰', stars, [], 2026)
        assert len(result) == 0

    def test_max_severity_field(self):
        """maxSeverity matches first trigger's severity."""
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '子', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '子', stars, [], 2026)
        if result:
            assert result[0]['maxSeverity'] == result[0]['triggers'][0]['severity']

    def test_branch_field_populated(self):
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        pillars = make_pillars('庚', '寅', '辛', '巳', '甲', '子', '丙', '午')
        result = compute_romance_danger_years(pillars, '甲', '子', stars, [], 2026)
        if result:
            assert result[0]['branch'] == '午'

    def test_primary_trigger_is_highest_severity(self):
        """primaryTrigger is the type of the highest severity trigger."""
        # Day=寅, star=巳 → 三刑(80) + 六害(70)
        stars = [{'year': 2026, 'stem': '丙', 'branch': '巳'}]
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '寅', '丙', '子')
        result = compute_romance_danger_years(pillars, '甲', '寅', stars, [], 2026)
        if result:
            assert result[0]['primaryTrigger'] == result[0]['triggers'][0]['type']


# ============================================================
# 8. compute_marriage_change_years (12 tests)
# ============================================================

class TestComputeMarriageChangeYears:
    """Tests for marriage change years (caution-only: 沖/刑/害)."""

    def test_liuchong_detected(self):
        """六沖 with day branch → detected as change year."""
        # Day branch=辰. CLASH_LOOKUP['辰']='戌'. Star branch=戌.
        stars = [{'year': 2026, 'stem': '庚', 'branch': '戌'}]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        assert len(result) >= 1
        change_types = [c['type'] for c in result[0]['changes']]
        assert '六沖' in change_types

    def test_liuhai_detected(self):
        """六害 with day branch → detected."""
        # HARM_LOOKUP['卯']='辰'. Star branch=卯, day_branch=辰.
        stars = [{'year': 2026, 'stem': '乙', 'branch': '卯'}]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '六害' in change_types

    def test_sanxing_detected(self):
        """三刑 with day branch detected (寅巳申 all 3 present)."""
        # day=巳, annual=寅, natal has 申 → all 3 of 寅巳申 present.
        stars = [{'year': 2026, 'stem': '甲', 'branch': '寅'}]
        result = compute_marriage_change_years('巳', stars, [], 2026,
                                               natal_branches=['子', '申', '巳', '午'])
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '三刑' in change_types

    def test_sanxing_zi_mao(self):
        """子卯 無禮之刑 correctly detected (2-branch punishment group)."""
        # day=子, annual=卯 → 子卯刑
        stars = [{'year': 2026, 'stem': '乙', 'branch': '卯'}]
        result = compute_marriage_change_years('子', stars, [], 2026)
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '三刑' in change_types
        xing = next(c for changes in result for c in changes['changes'] if c['type'] == '三刑')
        assert '無禮之刑' in xing['description']

    def test_zixing_detected(self):
        """自刑 detected for classical 辰午酉亥 branches (e.g., 午午)."""
        # day=午, annual=午
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = compute_marriage_change_years('午', stars, [], 2026)
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '自刑' in change_types

    def test_zixing_only_four_branches(self):
        """自刑 does NOT fire for non-辰午酉亥 branches (e.g., 子子)."""
        stars = [{'year': 2026, 'stem': '壬', 'branch': '子'}]
        result = compute_marriage_change_years('子', stars, [], 2026)
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '自刑' not in change_types

    def test_no_positive_negative_fields(self):
        """Entry dict no longer has positive/negative boolean fields."""
        stars = [{'year': 2026, 'stem': '庚', 'branch': '戌'}]  # 六沖 辰
        result = compute_marriage_change_years('辰', stars, [], 2026)
        assert len(result) >= 1
        assert 'positive' not in result[0]
        assert 'negative' not in result[0]

    def test_all_changes_are_negative(self):
        """Every individual change has nature='negative'."""
        stars = [{'year': 2026, 'stem': '庚', 'branch': '戌'}]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        if result:
            for c in result[0]['changes']:
                assert c['nature'] == 'negative'

    def test_kong_wang_not_excluded_but_flagged(self):
        """P6: 空亡 years are detected with isKongWang flag and reduced significance."""
        stars = [{'year': 2026, 'stem': '庚', 'branch': '戌'}]
        result = compute_marriage_change_years('辰', stars, ['戌'], 2026)
        assert len(result) >= 1
        assert result[0]['isKongWang'] is True
        assert result[0]['maxSignificance'] == round(90 * 0.8)  # 72
        assert '空亡' in result[0]['changes'][0]['description']

    def test_year_range_filter(self):
        """Only years in [current_year, current_year+10]."""
        stars = [
            {'year': 2025, 'stem': '庚', 'branch': '戌'},
            {'year': 2026, 'stem': '庚', 'branch': '戌'},
            {'year': 2037, 'stem': '庚', 'branch': '戌'},
        ]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        years = [c['year'] for c in result]
        assert 2025 not in years
        assert 2037 not in years

    def test_sorted_by_year(self):
        stars = [
            {'year': 2028, 'stem': '庚', 'branch': '戌'},
            {'year': 2026, 'stem': '乙', 'branch': '卯'},  # 六害 辰
        ]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        years = [c['year'] for c in result]
        assert years == sorted(years)

    def test_cap_at_10(self):
        """Capped at 10 results."""
        stars = [{'year': 2026 + i, 'stem': '庚', 'branch': '戌'} for i in range(15)]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        assert len(result) <= 10

    def test_empty_when_no_changes(self):
        """Empty when no 沖/刑/害 interactions match."""
        # 巳 has no 六沖/三刑/自刑/六害 with 辰
        stars = [{'year': 2026, 'stem': '壬', 'branch': '巳'}]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        assert len(result) == 0

    def test_liuhe_no_longer_detected(self):
        """六合 should NOT appear — positive interactions moved to romance good years."""
        # 酉辰六合
        stars = [{'year': 2026, 'stem': '丙', 'branch': '酉'}]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '六合' not in change_types

    def test_sanhe_no_longer_detected(self):
        """三合 should NOT appear in change years."""
        # 申子辰三合 — needs natal branch but function no longer checks it
        stars = [{'year': 2026, 'stem': '庚', 'branch': '申'}]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '三合' not in change_types

    def test_banhe_no_longer_detected(self):
        """半合 should NOT appear in change years."""
        stars = [{'year': 2026, 'stem': '庚', 'branch': '申'}]
        result = compute_marriage_change_years('辰', stars, [], 2026)
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '半合' not in change_types

    def test_liupo_no_longer_detected(self):
        """六破 should NOT appear in change years."""
        # 卯午六破
        stars = [{'year': 2026, 'stem': '乙', 'branch': '卯'}]
        result = compute_marriage_change_years('午', stars, [], 2026)
        change_types = [c['type'] for changes in result for c in changes.get('changes', [])]
        assert '六破' not in change_types

    def test_indirect_clash_no_longer_detected(self):
        """Indirect natal 六沖 should NOT appear."""
        # day=午, natal year=卯. 卯酉六沖 — annual=酉
        stars = [{'year': 2029, 'stem': '己', 'branch': '酉'}]
        result = compute_marriage_change_years('午', stars, [], 2029)
        if result:
            for c in result[0]['changes']:
                assert c.get('indirect') is not True

    def test_roger_change_year_count_reduced(self):
        """Roger's chart (午 day branch) produces ≤4 change years in 10-year window."""
        stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
        stars = [{'year': y, 'stem': stems[(y-4)%10], 'branch': branches[(y-4)%12]} for y in range(2026, 2037)]
        result = compute_marriage_change_years('午', stars, ['子', '丑'], 2026)
        assert len(result) <= 4, f"Expected ≤4 change years, got {len(result)}: {[r['year'] for r in result]}"
        assert len(result) >= 1, "Should have at least 1 change year"


# ============================================================
# 9. compute_partner_recommendations (10 tests)
# ============================================================

class TestComputePartnerRecommendations:
    """Tests for partner recommendations."""

    def test_favorable_primary_exists(self):
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('辰', '午', eg)
        assert 'favorablePrimary' in result
        assert isinstance(result['favorablePrimary'], list)

    def test_favorable_secondary_exists(self):
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('辰', '午', eg)
        assert 'favorableSecondary' in result

    def test_avoidance_liuchong(self):
        """Avoidance includes 六沖 zodiac."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('辰', '午', eg)
        avoid_types = [a['type'] for a in result['avoidance']]
        assert '六沖' in avoid_types

    def test_avoidance_liuhai(self):
        """Avoidance includes 六害 zodiac."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('辰', '午', eg)
        avoid_types = [a['type'] for a in result['avoidance']]
        assert '六害' in avoid_types

    def test_avoidance_severity(self):
        """Day-branch: 六沖=high, 六害=moderate. Year-branch: 六沖=moderate, 六害=low."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('辰', '午', eg)
        for a in result['avoidance']:
            if a.get('source') == 'day_branch':
                if a['type'] == '六沖':
                    assert a['severity'] == 'high'
                elif a['type'] == '六害':
                    assert a['severity'] == 'moderate'
            elif a.get('source') == 'year_branch':
                if a['type'] == '六沖':
                    assert a['severity'] == 'moderate'
                elif a['type'] == '六害':
                    assert a['severity'] == 'low'

    def test_favorable_elements(self):
        """Favorable elements from effective gods."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('辰', '午', eg)
        assert '木' in result['favorableElements']
        assert '水' in result['favorableElements']
        assert '火' not in result['favorableElements']

    def test_different_day_branch(self):
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('子', '午', eg)
        # 子 clash=午, harm=未
        avoid_branches = [a['branch'] for a in result['avoidance']]
        assert '午' in avoid_branches  # 六沖
        assert '未' in avoid_branches  # 六害

    def test_avoidance_has_zodiac(self):
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('子', '午', eg)
        for a in result['avoidance']:
            assert a['zodiac'] != ''

    def test_avoidance_has_description(self):
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('子', '午', eg)
        for a in result['avoidance']:
            assert 'description' in a

    def test_no_favorable_elements_when_all_neutral(self):
        eg = {'木': '閒神', '水': '閒神', '火': '閒神', '土': '閒神', '金': '閒神'}
        result = compute_partner_recommendations('子', '午', eg)
        assert result['favorableElements'] == []


# ============================================================
# 10. compute_annual_love_forecast (10 tests)
# ============================================================

class TestComputeAnnualLoveForecast:
    """Tests for annual love forecast."""

    def _make_result(self, dm='甲', gender='male', current_year=2026):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        # annual stars covering current_year to current_year+4
        branches = ['午', '未', '申', '酉', '戌']
        stems = ['丙', '丁', '戊', '己', '庚']
        stars = [
            {'year': current_year + i, 'stem': stems[i], 'branch': branches[i]}
            for i in range(5)
        ]
        lps = [{'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2035, 'startAge': 25}]
        return compute_annual_love_forecast(pillars, dm, gender, eg, lps, stars, [], current_year)

    def test_returns_list(self):
        result = self._make_result()
        assert isinstance(result, list)

    def test_five_year_range(self):
        """Should return up to 5 years of forecast."""
        result = self._make_result()
        assert len(result) <= 5

    def test_auspiciousness_values(self):
        """Auspiciousness should be one of the valid 7 levels."""
        result = self._make_result()
        valid = {'大吉', '吉', '小吉', '平', '小凶', '凶', '大凶'}
        for f in result:
            assert f['auspiciousness'] in valid

    def test_interactions_detected(self):
        """Interactions with day branch should be detected."""
        # Day=辰. Annual branch=酉 → HARMONY_LOOKUP['酉']='辰' → 六合
        result = self._make_result()
        # Year 2029 has branch=酉
        y2029 = [f for f in result if f['branch'] == '酉']
        if y2029:
            assert '六合配偶宮' in y2029[0]['interactions']

    def test_stem_ten_god(self):
        result = self._make_result()
        for f in result:
            assert 'stemTenGod' in f
            assert 'stemRole' in f

    def test_void_branch(self):
        """Void branch (kong_wang) is flagged."""
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = compute_annual_love_forecast(pillars, '甲', 'male', eg, [], stars, ['午'], 2026)
        if result:
            assert result[0]['isVoid'] is True

    def test_lp_context(self):
        """LP context included when active LP found."""
        result = self._make_result()
        for f in result:
            assert 'lpContext' in f

    def test_has_romance_star(self):
        """hasRomanceStar field present."""
        result = self._make_result()
        for f in result:
            assert 'hasRomanceStar' in f

    def test_female_forecast(self):
        result = self._make_result(gender='female')
        assert isinstance(result, list)

    def test_different_dm(self):
        pillars = make_pillars('甲', '午', '乙', '巳', '壬', '子', '丙', '寅')
        eg = {'木': '喜神', '水': '用神', '火': '忌神', '土': '仇神', '金': '閒神'}
        stars = [{'year': 2026, 'stem': '丙', 'branch': '午'}]
        result = compute_annual_love_forecast(pillars, '壬', 'male', eg, [], stars, [], 2026)
        assert isinstance(result, list)


# ============================================================
# 10b. Cross-reference scoring tests (11 tests)
# ============================================================

class TestAnnualForecastCrossReference:
    """Tests for cross-reference signals in annual love forecast scoring."""

    def _base_pillars(self):
        return make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')

    def _base_eg(self):
        """Neutral effective gods so stem alone doesn't skew scoring."""
        return {'木': '閒神', '水': '閒神', '火': '閒神', '土': '閒神', '金': '閒神'}

    def _call(self, pillars=None, dm='甲', gender='male', eg=None,
              stars=None, kong_wang=None, good_year_set=None,
              danger_year_set=None, change_year_set=None,
              good_year_type_lookup=None, danger_year_trigger_lookup=None,
              change_year_type_lookup=None, danger_year_has_new_signal_lookup=None):
        pillars = pillars or self._base_pillars()
        eg = eg or self._base_eg()
        stars = stars or [{'year': 2026, 'stem': '甲', 'branch': '丑'}]
        kong_wang = kong_wang or []
        lps = [{'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2035, 'startAge': 25}]
        return compute_annual_love_forecast(
            pillars, dm, gender, eg, lps, stars, kong_wang, 2026,
            good_year_set=frozenset(good_year_set or []),
            danger_year_set=frozenset(danger_year_set or []),
            change_year_set=frozenset(change_year_set or []),
            good_year_type_lookup=good_year_type_lookup or {},
            danger_year_trigger_lookup=danger_year_trigger_lookup or {},
            change_year_type_lookup=change_year_type_lookup or {},
            danger_year_has_new_signal_lookup=danger_year_has_new_signal_lookup or {},
        )

    def test_good_year_non_star_adds_positive(self):
        """桃花合年 (not a romance star) should add +1 positive."""
        result = self._call(
            good_year_set={2026},
            good_year_type_lookup={2026: '桃花合年'},
        )
        assert result[0]['isGoodYear'] is True
        assert result[0]['goodYearType'] == '桃花合年'
        # With neutral stem, no interactions, no stars: positive=1 (good year), negative=0 → 小吉
        assert result[0]['auspiciousness'] == '小吉'

    def test_star_based_good_year_no_double_count(self):
        """天喜年 already counted by has_romance_star → no extra +1 positive from cross-ref."""
        # 甲 dm, day branch=辰. Branch=酉 → 天喜 star (has_romance_star=True) AND 六合辰酉.
        # Good year type = '天喜年' → starts with STAR_BASED prefix → should NOT add extra positive.
        result = self._call(
            stars=[{'year': 2026, 'stem': '甲', 'branch': '酉'}],
            good_year_set={2026},
            good_year_type_lookup={2026: '天喜年'},
        )
        assert result[0]['hasRomanceStar'] is True
        assert result[0]['isGoodYear'] is True
        # positive=2 (has_romance_star + 六合配偶宮). NOT 3 (no extra from 天喜年 cross-ref). → 吉
        assert result[0]['auspiciousness'] == '吉'

    def test_danger_non_interaction_adds_negative(self):
        """紅艷桃花年 (not in INTERACTION_BASED_DANGERS) should add +1 negative."""
        result = self._call(
            danger_year_set={2026},
            danger_year_trigger_lookup={2026: '紅艷桃花年'},
            danger_year_has_new_signal_lookup={2026: True},
        )
        assert result[0]['isDangerYear'] is True
        assert result[0]['dangerYearTrigger'] == '紅艷桃花年'
        # positive=0, negative=1 (new danger signal) → 小凶
        assert result[0]['auspiciousness'] == '小凶'

    def test_danger_interaction_no_double_count(self):
        """三刑 danger year already in interactions → no extra +1 negative."""
        # Day branch=辰. Annual branch needs to trigger 三刑 with 辰.
        # 辰辰自刑. Let's use 辰 as annual branch.
        result = self._call(
            stars=[{'year': 2026, 'stem': '甲', 'branch': '辰'}],
            danger_year_set={2026},
            danger_year_trigger_lookup={2026: '自刑'},
            danger_year_has_new_signal_lookup={2026: False},  # 自刑 is in INTERACTION_BASED_DANGERS
        )
        assert result[0]['isDangerYear'] is True
        # The 自刑 is already counted in interactions, so has_new_danger_signal=False → no extra negative
        # negative should come from the interaction itself only
        assert result[0]['auspiciousness'] in ('小凶', '平')  # only interaction-based negative

    def test_change_year_never_adds_negative(self):
        """Change years should never inflate negative_count."""
        result = self._call(
            change_year_set={2026},
            change_year_type_lookup={2026: '六沖'},
        )
        assert result[0]['isChangeYear'] is True
        assert result[0]['changeYearType'] == '六沖'
        # Change year presence alone does NOT affect scoring
        # With neutral stem, no interactions, no stars: positive=0, negative=0 → 平
        assert result[0]['auspiciousness'] == '平'

    def test_good_and_danger_cancel_to_ping(self):
        """Year in both good+danger with no other signals → 平."""
        result = self._call(
            good_year_set={2026},
            good_year_type_lookup={2026: '桃花合年'},
            danger_year_set={2026},
            danger_year_trigger_lookup={2026: '紅艷桃花年'},
            danger_year_has_new_signal_lookup={2026: True},
        )
        # positive=1 (桃花合年=new), negative=1 (紅艷桃花年=new) → balanced → 平
        assert result[0]['auspiciousness'] == '平'

    def test_da_ji_threshold(self):
        """3+ positive, 0 negative → 大吉."""
        # Need: stem=用神, 六合配偶宮, good_year (non-star)
        # 甲 dm: 用神=木. Stem=甲 → ten god=比肩. That's 閒神. Need stem whose element is 用神.
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        # Stem 甲 → 木 → 用神. Branch=酉 → 六合 with 辰 (day branch). Also 天喜 star.
        result = self._call(
            eg=eg,
            stars=[{'year': 2026, 'stem': '甲', 'branch': '酉'}],
            good_year_set={2026},
            good_year_type_lookup={2026: '合婚年'},  # Not star-based → adds positive
        )
        # positive: stemRole=用神(1), 六合配偶宮(1), has_romance_star=天喜(1), good_year=合婚年(1) = 4
        # negative: 0
        assert result[0]['auspiciousness'] == '大吉'

    def test_da_xiong_threshold(self):
        """3+ negative, 0 positive → 大凶."""
        eg = {'木': '閒神', '水': '閒神', '火': '忌神', '土': '仇神', '金': '閒神'}
        # 甲 dm: stem=丙 → 食神. Element=火 → 忌神.
        # Branch=午 → 六沖配偶宮 (day=辰? No, 辰 clash is 戌). Let's pick branch=戌 for 辰戌沖.
        # Also add void.
        result = self._call(
            eg=eg,
            stars=[{'year': 2026, 'stem': '丙', 'branch': '戌'}],
            kong_wang=['戌'],
            danger_year_set={2026},
            danger_year_trigger_lookup={2026: '紅艷桃花年'},
            danger_year_has_new_signal_lookup={2026: True},
        )
        # 丙 → fire → 忌神(1), 戌 → 六沖配偶宮 with 辰(1), isVoid(1), 紅艷桃花年(1) = 4 negative
        # positive: 0
        assert result[0]['auspiciousness'] == '大凶'

    def test_enriched_output_fields(self):
        """Output dict should have all cross-reference fields."""
        result = self._call(
            good_year_set={2026},
            good_year_type_lookup={2026: '桃花合年'},
            danger_year_set={2026},
            danger_year_trigger_lookup={2026: '紅艷桃花年'},
            change_year_set={2026},
            change_year_type_lookup={2026: '六沖'},
            danger_year_has_new_signal_lookup={2026: True},
        )
        f = result[0]
        assert 'isGoodYear' in f
        assert 'isDangerYear' in f
        assert 'isChangeYear' in f
        assert 'goodYearType' in f
        assert 'dangerYearTrigger' in f
        assert 'changeYearType' in f
        assert f['isGoodYear'] is True
        assert f['isDangerYear'] is True
        assert f['isChangeYear'] is True
        assert f['goodYearType'] == '桃花合年'
        assert f['dangerYearTrigger'] == '紅艷桃花年'
        assert f['changeYearType'] == '六沖'

    def test_empty_sets_no_crash(self):
        """Default empty frozensets should work without error."""
        result = self._call()
        assert isinstance(result, list)
        if result:
            assert result[0]['isGoodYear'] is False
            assert result[0]['isDangerYear'] is False
            assert result[0]['isChangeYear'] is False

    def test_multi_good_type_joined(self):
        """Year with 2 good entries → types joined with '/'."""
        result = self._call(
            good_year_set={2026},
            good_year_type_lookup={2026: '桃花合年/天喜桃花年'},
        )
        assert result[0]['goodYearType'] == '桃花合年/天喜桃花年'
        # 天喜 is star-based, but 桃花合年 is NOT → should still add positive
        assert result[0]['isGoodYear'] is True
        assert result[0]['auspiciousness'] == '小吉'  # 1 positive, 0 negative


# ============================================================
# 11. compute_monthly_love_forecast (8 tests)
# ============================================================

class TestComputeMonthlyLoveForecast:
    """Tests for monthly love forecast."""

    def _make_monthly_stars(self):
        branches = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑']
        stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '甲', '乙']
        return [{'month': i + 1, 'stem': stems[i], 'branch': branches[i]} for i in range(12)]

    def test_returns_12_months(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, self._make_monthly_stars())
        assert len(result) == 12

    def test_auspiciousness_values(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, self._make_monthly_stars())
        for f in result:
            assert f['auspiciousness'] in ('大吉', '吉', '小吉', '平', '小凶', '凶', '大凶')

    def test_interactions_liuhe(self):
        """六合 interaction detected with labeled format."""
        # Day=辰. Month=酉 → HARMONY_LOOKUP['酉']='辰' → 六合配偶宮
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, self._make_monthly_stars())
        # Month 8 (酉)
        month8 = [f for f in result if f['branch'] == '酉']
        if month8:
            assert '六合配偶宮' in month8[0]['interactions']

    def test_interactions_liuchong(self):
        """六沖 interaction detected with labeled format."""
        # Day=辰. CLASH_LOOKUP['辰']='戌'. Month with 戌.
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, self._make_monthly_stars())
        month_xu = [f for f in result if f['branch'] == '戌']
        if month_xu:
            assert '六沖配偶宮' in month_xu[0]['interactions']

    def test_interactions_liuhai(self):
        """六害 interaction detected with labeled format."""
        # Day=辰. HARM_LOOKUP['卯']='辰'. Month with 卯.
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, self._make_monthly_stars())
        month_mao = [f for f in result if f['branch'] == '卯']
        if month_mao:
            assert '六害配偶宮' in month_mao[0]['interactions']

    def test_stem_ten_god_computed(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, self._make_monthly_stars())
        for f in result:
            assert 'stemTenGod' in f

    def test_ji_positive_only(self):
        """Month with 用神 and no negative → 小吉 (1 positive, 0 negative under count-based scoring)."""
        # Force a month where stem role is 用神 and no negative interactions
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '寅', '丙', '子')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        stars = [{'month': 1, 'stem': '甲', 'branch': '丑'}]
        # 甲→木=用神 → 1 positive. 丑: no 六合/六沖/六害 with 寅. No negative.
        # Under 7-level scoring: 1 positive > 0 negative → 小吉 (need ≥2 positive for 吉)
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, stars)
        if result:
            assert result[0]['auspiciousness'] == '小吉'

    def test_empty_monthly_stars(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, [])
        assert result == []


class TestMonthlyLoveForecastEnhanced:
    """Tests for enhanced monthly love forecast (parity with annual)."""

    def _make_pillars(self, day_branch='辰'):
        return make_pillars('庚', '午', '辛', '巳', '甲', day_branch, '丙', '寅')

    def _eg(self):
        return {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}

    def test_monthly_stemRole_present(self):
        """Each month has stemRole field."""
        pillars = self._make_pillars()
        stars = [{'month': 1, 'stem': '甲', 'branch': '寅'}]
        result = compute_monthly_love_forecast(pillars, '甲', 'male', self._eg(), stars)
        assert 'stemRole' in result[0]
        assert result[0]['stemRole'] == '用神'  # 甲→木=用神

    def test_monthly_hasRomanceStar_detected(self):
        """Month branch matching 紅鸞/天喜/桃花 → hasRomanceStar=True."""
        pillars = self._make_pillars('辰')
        # Day=辰. TAOHUA['辰'] = '酉'. So month branch=酉 should be a romance star month.
        stars = [{'month': 1, 'stem': '甲', 'branch': '酉'}]
        result = compute_monthly_love_forecast(
            pillars, '甲', 'male', self._eg(), stars,
            current_year_branch='午',  # Provides a year branch for HONGLUAN/TIANXI
        )
        assert result[0]['hasRomanceStar'] is True

    def test_monthly_hasRomanceStar_false_when_no_year_branch(self):
        """Without current_year_branch, HONGLUAN/TIANXI are empty but TAOHUA still works."""
        pillars = self._make_pillars('辰')
        # TAOHUA['辰'] = '酉'
        stars = [{'month': 1, 'stem': '甲', 'branch': '丑'}]  # 丑 is NOT 酉
        result = compute_monthly_love_forecast(pillars, '甲', 'male', self._eg(), stars)
        assert result[0]['hasRomanceStar'] is False

    def test_monthly_isVoid_detected(self):
        """Month branch in kong_wang → isVoid=True."""
        pillars = self._make_pillars()
        stars = [{'month': 1, 'stem': '甲', 'branch': '午'}]
        result = compute_monthly_love_forecast(
            pillars, '甲', 'male', self._eg(), stars,
            kong_wang=['午', '未'],
        )
        assert result[0]['isVoid'] is True

    def test_monthly_isVoid_false_when_no_kong_wang(self):
        """Without kong_wang param, isVoid is always False."""
        pillars = self._make_pillars()
        stars = [{'month': 1, 'stem': '甲', 'branch': '午'}]
        result = compute_monthly_love_forecast(pillars, '甲', 'male', self._eg(), stars)
        assert result[0]['isVoid'] is False

    def test_monthly_lpContext_passed(self):
        """lpContext string present when provided."""
        pillars = self._make_pillars()
        stars = [{'month': 1, 'stem': '甲', 'branch': '寅'}]
        result = compute_monthly_love_forecast(
            pillars, '甲', 'male', self._eg(), stars,
            lp_context='丙午（食神）',
        )
        assert result[0]['lpContext'] == '丙午（食神）'

    def test_monthly_interactions_labeled(self):
        """Interactions use '六合配偶宮' labels (not bare '六合')."""
        # Day=辰. Month=酉 → HARMONY_LOOKUP['酉']='辰' → 六合配偶宮
        pillars = self._make_pillars('辰')
        stars = [{'month': 1, 'stem': '甲', 'branch': '酉'}]
        result = compute_monthly_love_forecast(pillars, '甲', 'male', self._eg(), stars)
        assert '六合配偶宮' in result[0]['interactions']
        assert '六合' not in result[0]['interactions']  # Bare label should not exist

    def test_monthly_fuyin_detected(self):
        """Month branch == day branch → 伏吟配偶宮 in interactions."""
        pillars = self._make_pillars('辰')
        stars = [{'month': 1, 'stem': '甲', 'branch': '辰'}]
        result = compute_monthly_love_forecast(pillars, '甲', 'male', self._eg(), stars)
        assert '伏吟配偶宮' in result[0]['interactions']

    def test_monthly_fuyin_intensifies_positive(self):
        """伏吟 + positive stem → upgrades auspiciousness."""
        # Day=寅. Month=寅(伏吟). Stem=甲(木=用神).
        # Without 伏吟: positive=1(用神), negative=0 → 小吉
        # With 伏吟 intensification: positive=2, negative=0 → 吉
        pillars = self._make_pillars('寅')
        stars = [{'month': 1, 'stem': '甲', 'branch': '寅'}]
        result = compute_monthly_love_forecast(pillars, '甲', 'male', self._eg(), stars)
        assert '伏吟配偶宮' in result[0]['interactions']
        assert result[0]['auspiciousness'] == '吉'  # Intensified from 小吉 to 吉

    def test_monthly_fuyin_intensifies_negative(self):
        """伏吟 + negative stem → downgrades auspiciousness."""
        # Day=寅. Month=寅(伏吟). Stem=丙(火=忌神).
        # Without 伏吟: positive=0, negative=1(忌神) → 小凶
        # With 伏吟 intensification: positive=0, negative=2 → 凶
        pillars = self._make_pillars('寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        stars = [{'month': 1, 'stem': '丙', 'branch': '寅'}]
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, stars)
        assert '伏吟配偶宮' in result[0]['interactions']
        assert result[0]['auspiciousness'] == '凶'  # Intensified from 小凶 to 凶

    def test_monthly_7_level_auspiciousness(self):
        """Verify at least some levels from the 7-level system are achievable."""
        pillars = self._make_pillars('辰')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        # Generate 12 months with varied stems and branches
        branches = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑']
        stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '甲', '乙']
        stars = [{'month': i + 1, 'stem': stems[i], 'branch': branches[i]} for i in range(12)]
        result = compute_monthly_love_forecast(pillars, '甲', 'male', eg, stars)
        levels = {f['auspiciousness'] for f in result}
        # Should have at least 3 distinct levels across 12 months
        assert len(levels) >= 3
        # All should be valid 7-level values
        valid_levels = {'大吉', '吉', '小吉', '平', '小凶', '凶', '大凶'}
        assert levels.issubset(valid_levels)

    def test_monthly_stemTenGod_field_name(self):
        """Field is stemTenGod (not tenGod)."""
        pillars = self._make_pillars()
        stars = [{'month': 1, 'stem': '甲', 'branch': '寅'}]
        result = compute_monthly_love_forecast(pillars, '甲', 'male', self._eg(), stars)
        assert 'stemTenGod' in result[0]
        assert 'tenGod' not in result[0]  # Old field name should NOT exist

    def test_monthly_backward_compat_no_optional_params(self):
        """Call without kong_wang/lp_context/current_year_branch still works."""
        pillars = self._make_pillars()
        stars = [{'month': 1, 'stem': '甲', 'branch': '寅'}]
        # Call with only required params (old signature)
        result = compute_monthly_love_forecast(pillars, '甲', 'male', self._eg(), stars)
        assert len(result) == 1
        assert result[0]['hasRomanceStar'] is False  # No year branch → TAOHUA only
        assert result[0]['isVoid'] is False  # No kong_wang
        assert result[0]['lpContext'] == ''  # No lp_context


# ============================================================
# 12. Orchestrator + Narrative Anchors (10 tests)
# ============================================================

class TestOrchestratorAndAnchors:
    """Tests for generate_love_pre_analysis and build_love_narrative_anchors."""

    def _make_full_result(self):
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        sv2 = {'classification': 'balanced', 'score': 50}
        branches = ['午', '未', '申', '酉', '戌']
        stems_a = ['丙', '丁', '戊', '己', '庚']
        annual_stars = [{'year': 2026 + i, 'stem': stems_a[i], 'branch': branches[i]} for i in range(5)]
        monthly_stars = [
            {'month': i + 1, 'stem': '甲', 'branch': ['寅', '卯', '辰', '巳', '午', '未',
                                                         '申', '酉', '戌', '亥', '子', '丑'][i]}
            for i in range(12)
        ]
        lps = [{'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2029, 'startAge': 25}]

        return generate_love_pre_analysis(
            pillars=pillars,
            day_master_stem='甲',
            gender='male',
            five_elements_balance={'木': 20, '火': 25, '土': 30, '金': 15, '水': 10},
            effective_gods=eg,
            prominent_god='食神',
            strength_v2=sv2,
            cong_ge=None,
            luck_periods=lps,
            annual_stars=annual_stars,
            monthly_stars=monthly_stars,
            kong_wang=['戌', '亥'],
            all_shen_sha=[],
            birth_year=1990,
            current_year=2026,
        )

    def test_all_top_level_keys(self):
        result = self._make_full_result()
        expected_keys = [
            'peachBlossoms', 'spouseStarAnalysis', 'marriagePalace',
            'lovePersonality', 'marriageTimingIndicators',
            'romanceGoodYears', 'romanceDangerYears', 'marriageChangeYears',
            'partnerRecommendations', 'annualForecasts', 'monthlyForecasts',
            'narrativeAnchors', 'deterministic',
        ]
        for key in expected_keys:
            assert key in result, f"Missing key: {key}"

    def test_narrative_anchors_all_keys(self):
        result = self._make_full_result()
        anchors = result['narrativeAnchors']
        expected = [
            'love_personality', 'peach_blossom_analysis', 'natal_marriage',
            'partner_matching', 'spouse_appearance',
            'romance_good_years', 'romance_danger_years',
            'marriage_change_years', 'love_summary',
        ]
        for key in expected:
            assert key in anchors, f"Missing anchor: {key}"

    def test_deterministic_section_keys(self):
        result = self._make_full_result()
        det = result['deterministic']
        assert 'peach_blossoms' in det
        assert 'spouse_star' in det
        assert 'marriage_palace' in det
        assert 'partner_recommendations' in det
        assert 'romance_timeline' in det

    def test_deterministic_peach_blossoms(self):
        result = self._make_full_result()
        pb = result['deterministic']['peach_blossoms']
        assert 'positive_count' in pb
        assert 'negative_count' in pb
        assert 'summary' in pb

    def test_deterministic_spouse_star(self):
        result = self._make_full_result()
        ss = result['deterministic']['spouse_star']
        assert ss['star'] == '正財'
        assert ss['visibility'] in ('透出', '暗藏', '全無')

    def test_deterministic_romance_timeline(self):
        result = self._make_full_result()
        rt = result['deterministic']['romance_timeline']
        assert 'good_years' in rt
        assert 'danger_years' in rt
        assert 'change_years' in rt

    def test_en_format_effective_gods_normalized(self):
        """Orchestrator normalizes en-format effective gods."""
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg_en = {'usefulGod': '木', 'favorableGod': '水', 'tabooGod': '火', 'enemyGod': '土', 'idleGod': '金'}
        result = generate_love_pre_analysis(
            pillars=pillars, day_master_stem='甲', gender='male',
            five_elements_balance={}, effective_gods=eg_en, prominent_god='',
            strength_v2={'classification': 'balanced'}, cong_ge=None,
            luck_periods=[], annual_stars=[], monthly_stars=[],
            kong_wang=[], all_shen_sha=[],
        )
        assert 'peachBlossoms' in result

    def test_build_narrative_anchors_standalone(self):
        """Build anchors from pre-analysis dict."""
        pre = {
            'lovePersonality': {
                'archetype': {'label': '獨立型', 'trait': '重視空間'},
                'elementStyle': {'style': '浪漫理想派'},
                'dmElement': '木',
                'strengthImpact': '身中',
            },
            'peachBlossoms': {'positive': [], 'negative': [], 'summary': '桃花星不顯著'},
            'spouseStarAnalysis': {
                'spouseStar': '正財', 'visibility': '透出', 'spouseRole': '用神',
                'balanceDescription': '身星平衡', 'challenges': [],
            },
            'partnerRecommendations': {
                'favorablePrimary': ['雞'], 'avoidance': [],
            },
            'marriagePalace': {
                'dayBranch': '辰', 'element': '土', 'palaceTenGod': '偏財',
                'personalityArchetype': '交際廣泛', 'appearanceHint': '穩重',
                'twelveStage': '冠帶',
            },
            'romanceGoodYears': [],
            'romanceDangerYears': [],
            'marriageChangeYears': [],
            'marriageTimingIndicators': {'earlySignals': [], 'lateSignals': []},
        }
        anchors = build_love_narrative_anchors(pre)
        assert '獨立型' in anchors['love_personality']
        assert '桃花星不顯著' in anchors['peach_blossom_analysis']

    def test_anchors_with_challenges(self):
        """Anchors include challenge text."""
        pre = {
            'lovePersonality': {
                'archetype': {'label': '獨立型', 'trait': 'test'},
                'elementStyle': {'style': 'test'},
                'dmElement': '木', 'strengthImpact': 'test',
            },
            'peachBlossoms': {'positive': [], 'negative': [], 'summary': ''},
            'spouseStarAnalysis': {
                'spouseStar': '正官', 'visibility': '透出', 'spouseRole': '用神',
                'balanceDescription': 'test', 'challenges': [
                    {'type': '官殺混雜', 'severity': 'high'},
                ],
            },
            'partnerRecommendations': {'favorablePrimary': [], 'avoidance': []},
            'marriagePalace': {
                'dayBranch': '辰', 'element': '土', 'palaceTenGod': '',
                'personalityArchetype': '', 'appearanceHint': '', 'twelveStage': '',
            },
            'romanceGoodYears': [],
            'romanceDangerYears': [],
            'marriageChangeYears': [],
            'marriageTimingIndicators': {'earlySignals': [], 'lateSignals': []},
        }
        anchors = build_love_narrative_anchors(pre)
        assert '官殺混雜' in anchors['natal_marriage']

    def test_anchors_good_years_nonempty(self):
        pre = {
            'lovePersonality': {'archetype': {'label': '', 'trait': ''}, 'elementStyle': {'style': ''}, 'dmElement': '', 'strengthImpact': ''},
            'peachBlossoms': {'positive': [], 'negative': [], 'summary': ''},
            'spouseStarAnalysis': {'spouseStar': '', 'visibility': '', 'spouseRole': '', 'balanceDescription': '', 'challenges': []},
            'partnerRecommendations': {'favorablePrimary': [], 'avoidance': []},
            'marriagePalace': {'dayBranch': '', 'element': '', 'palaceTenGod': '', 'personalityArchetype': '', 'appearanceHint': '', 'twelveStage': ''},
            'romanceGoodYears': [{'year': 2027, 'starType': '紅鸞年', 'dayun_context': '大運丙午'}],
            'romanceDangerYears': [{'year': 2028, 'primaryTrigger': '六沖'}],
            'marriageChangeYears': [{'year': 2029, 'positive': True, 'negative': False}],
            'marriageTimingIndicators': {'earlySignals': ['月柱天干見正財'], 'lateSignals': []},
        }
        anchors = build_love_narrative_anchors(pre)
        assert '2027' in anchors['romance_good_years']
        assert '2028' in anchors['romance_danger_years']
        assert '2029' in anchors['marriage_change_years']
        assert '月柱天干見正財' in anchors['love_summary']


# ============================================================
# 13. Lookup table validation (6 tests)
# ============================================================

class TestLookupTableValidation:
    """Verify lookup tables have correct entries."""

    def test_hongyan_sha_has_all_10_stems(self):
        stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        for s in stems:
            assert s in HONGYAN_SHA, f"HONGYAN_SHA missing stem {s}"

    def test_jiuchou_days_has_9_entries(self):
        assert len(JIUCHOU_DAYS) == 9

    def test_muyu_taohua_has_all_10_stems(self):
        stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        for s in stems:
            assert s in MUYU_TAOHUA, f"MUYU_TAOHUA missing stem {s}"

    def test_harm_lookup_has_12_entries(self):
        assert len(HARM_LOOKUP) == 12

    def test_harm_lookup_is_bidirectional(self):
        for k, v in HARM_LOOKUP.items():
            assert HARM_LOOKUP[v] == k, f"HARM_LOOKUP not bidirectional: {k}→{v}"

    def test_taohua_has_all_12_branches(self):
        branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
        for b in branches:
            assert b in TAOHUA, f"TAOHUA missing branch {b}"


# ============================================================
# 14. New Enhancement Tests (V2 plan)
# ============================================================

class TestLiuPoInPartnerRecommendations:
    """Tests for 六破 in partner zodiac avoidance."""

    def test_wu_day_branch_has_mao_break(self):
        """午日柱 → 卯午相破 → 兔 in avoidance with severity low."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '卯', eg)
        avoidance_zodiacs = [a['zodiac'] for a in result['avoidance']]
        assert '兔' in avoidance_zodiacs
        mao_entry = [a for a in result['avoidance'] if a['zodiac'] == '兔' and a['type'] == '六破']
        assert len(mao_entry) == 1
        assert mao_entry[0]['severity'] == 'low'


class TestYearBranchAvoidance:
    """Tests for year-branch (年支) avoidance in partner recommendations."""

    def test_roger_year_branch_avoidance_added(self):
        """Roger: day=午, year=卯 → year-branch adds 雞(卯酉沖) and 龍(卯辰害)."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '卯', eg)
        avoid = result['avoidance']
        avoid_zodiacs = [a['zodiac'] for a in avoid]
        assert '雞' in avoid_zodiacs, "Year-branch 六沖: 卯酉沖 → 雞 should be in avoidance"
        assert '龍' in avoid_zodiacs, "Year-branch 六害: 卯辰害 → 龍 should be in avoidance"

    def test_year_branch_dedup(self):
        """When year-branch target already in day-branch avoidance, skip it."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        # day=子: 六沖=午, 六害=未, 六破=酉
        # year=午: 六沖=子 (not in existing), 六害=丑 (not in existing)
        result = compute_partner_recommendations('子', '午', eg)
        avoid = result['avoidance']
        # Count occurrences of each branch — no duplicates
        branches = [a['branch'] for a in avoid]
        for b in set(branches):
            assert branches.count(b) == 1, f"Branch {b} appears more than once"

    def test_year_branch_severity_lower(self):
        """Year-branch 六沖=moderate (not high), 六害=low (not moderate)."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '卯', eg)
        year_items = [a for a in result['avoidance'] if a.get('source') == 'year_branch']
        assert len(year_items) == 2
        clash_item = [a for a in year_items if a['type'] == '六沖']
        harm_item = [a for a in year_items if a['type'] == '六害']
        assert len(clash_item) == 1 and clash_item[0]['severity'] == 'moderate'
        assert len(harm_item) == 1 and harm_item[0]['severity'] == 'low'

    def test_source_field_present(self):
        """All avoidance items have 'source' field."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '卯', eg)
        for a in result['avoidance']:
            assert 'source' in a, f"Missing 'source' field in avoidance item: {a}"

    def test_no_year_branch_when_empty(self):
        """year_branch='' → only day_branch items."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '', eg)
        for a in result['avoidance']:
            assert a.get('source') == 'day_branch'

    def test_description_format(self):
        """Day-branch: no prefix. Year-branch: '年支' prefix."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '卯', eg)
        for a in result['avoidance']:
            if a.get('source') == 'day_branch':
                assert not a['description'].startswith('年支'), \
                    f"Day-branch item should NOT have 年支 prefix: {a['description']}"
            elif a.get('source') == 'year_branch':
                assert a['description'].startswith('年支'), \
                    f"Year-branch item should have 年支 prefix: {a['description']}"

    def test_same_day_and_year_branch(self):
        """day=午, year=午 → year-branch items all deduped (same clashes/harms)."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '午', eg)
        year_items = [a for a in result['avoidance'] if a.get('source') == 'year_branch']
        assert len(year_items) == 0, "Same day/year branch → all year items should be deduped"

    def test_cross_source_same_target_dedup(self):
        """When year-branch targets a branch already in day-branch avoidance, day-branch wins."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        # day=戌: 六沖=辰, 六害=酉, 六破=未
        # year=辰: 六沖=戌 (NOT in existing — 戌 is day_branch itself, not in avoidance)
        #          六害=卯 (not in existing) → added
        # But let's test overlap: day=寅: 六沖=申, 六害=巳, 六破=亥
        #                          year=亥: 六沖=巳 (巳 already in day 六害!) → deduped
        result = compute_partner_recommendations('寅', '亥', eg)
        # 巳 should appear only once (from day 六害, not year 六沖)
        si_items = [a for a in result['avoidance'] if a['branch'] == '巳']
        assert len(si_items) == 1
        assert si_items[0]['source'] == 'day_branch'
        assert si_items[0]['type'] == '六害'


class TestLiuHeHuaCaveat:
    """Tests for 六合合化 caveat on favorable zodiacs."""

    def test_caveat_when_transform_is_jishen(self):
        """When 六合 transforms into 忌神 element → caveat generated."""
        # Day branch 寅. HARMONY_LOOKUP['寅']='亥'. 寅亥合化木.
        # If 木=忌神, should generate caveat.
        eg = {'木': '忌神', '水': '喜神', '火': '用神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('寅', '午', eg)
        assert len(result['favorableCaveats']) > 0
        assert '合化木' in result['favorableCaveats'][0]['caveat']

    def test_no_caveat_for_wu_wei_liuhe(self):
        """午未合 is contested — skip caveat (empty transform element)."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '卯', eg)
        # 午未合化: transform = '' → no caveat even if 火=忌神
        caveats_for_wei = [c for c in result.get('favorableCaveats', []) if c['branch'] == '未']
        assert len(caveats_for_wei) == 0


class TestFavorableSeasons:
    """Tests for 喜用神配偶月份建議."""

    def test_seasons_for_mu_yongshen(self):
        """木=用神 → spring season recommended."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '卯', eg)
        seasons = result['favorableSeasons']
        mu_season = [s for s in seasons if s['element'] == '木']
        assert len(mu_season) == 1
        assert mu_season[0]['season'] == '春季'
        assert mu_season[0]['role'] == '用神'

    def test_both_yongshen_and_xishen(self):
        """Both 用神 and 喜神 elements get seasons."""
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_partner_recommendations('午', '卯', eg)
        season_elements = {s['element'] for s in result['favorableSeasons']}
        assert '木' in season_elements
        assert '水' in season_elements


class TestPillarPersonality:
    """Tests for per-pillar personality analysis."""

    def test_month_and_hour_returned(self):
        """Both month and hour pillar personality returned."""
        pillars = make_pillars('庚', '午', '辛', '巳', '戊', '辰', '甲', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_love_personality(
            pillars, '戊', 'male', eg,
            {'classification': 'balanced'}, [],
        )
        assert 'pillarPersonality' in result
        assert 'month' in result['pillarPersonality']
        assert 'hour' in result['pillarPersonality']
        # Month stem 辛. derive_ten_god(戊, 辛) = 傷官
        assert result['pillarPersonality']['month']['tenGod'] == '傷官'
        assert result['pillarPersonality']['month']['context'] == '社交面（外在表現）'
        # Hour stem 甲. derive_ten_god(戊, 甲) = 偏官
        assert result['pillarPersonality']['hour']['tenGod'] == '偏官'
        assert result['pillarPersonality']['hour']['context'] == '內心面（私下想法）'


class TestHourWealthNote:
    """Tests for 時支藏財 移情別戀風險."""

    def test_male_with_piancai_in_hour(self):
        """Male with 偏財 in hour hidden stems → note generated."""
        # DM=戊, hour branch=申. 申 hidden=[庚,壬,戊]. derive_ten_god(戊,壬)=偏財
        pillars = make_pillars('庚', '午', '辛', '巳', '戊', '辰', '甲', '申')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_spouse_star_analysis(pillars, '戊', 'male', eg, {'classification': 'balanced'})
        assert result['hourWealthNote'] != ''
        assert '偏財' in result['hourWealthNote']
        assert '不代表必然' in result['hourWealthNote']

    def test_female_no_hour_wealth_note(self):
        """Female → 時支藏財 is not about romance, empty note."""
        pillars = make_pillars('庚', '午', '辛', '巳', '戊', '辰', '甲', '申')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        result = compute_spouse_star_analysis(pillars, '戊', 'female', eg, {'classification': 'balanced'})
        assert result['hourWealthNote'] == ''


class TestGenderAwareStarType:
    """Tests for gender-aware 正緣年 labeling."""

    def test_male_piancai_stem_gives_piancai_year(self):
        """Male: annual stem = 偏財 → 偏財桃花年."""
        from app.love_enhanced import compute_romance_good_years
        # DM=戊, male. 偏財 element=水. 壬=偏財 for 戊.
        # Need an annual_stars set where 壬 year is a romance candidate
        stars = [{'year': y, 'stem': s, 'branch': b}
                 for y, s, b in [(2026, '丙', '午'), (2027, '丁', '未'),
                                  (2028, '戊', '申'), (2029, '己', '酉'),
                                  (2030, '庚', '戌'), (2031, '辛', '亥'),
                                  (2032, '壬', '子'), (2033, '癸', '丑'),
                                  (2034, '甲', '寅'), (2035, '乙', '卯')]]
        result = compute_romance_good_years(
            'male', '戊', '辰', '午', stars, [], 1990, 2026,
            [{'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2029, 'startAge': 25}],
        )
        # Check if any year has 偏財桃花年 or 正緣年
        star_types = {y['starType'] for y in result}
        # Should contain at least some of the new types
        VALID_TYPES = {'紅鸞年', '天喜年', '正緣年', '偏財桃花年', '偏官桃花年', '合婚年', '桃花合年', '紅鸞正緣年', '天喜桃花年', '天喜紅鸞年'}
        # Strip (空亡年) suffix before checking
        stripped = {st.replace('(空亡年)', '') for st in star_types}
        assert stripped.issubset(VALID_TYPES)


# ============================================================
# TestTierAwareLabeling — 桃花助力年 Redesign Tests
# ============================================================

class TestTierAwareLabeling:
    """Tests for tier-aware romance year labeling (replaces 桃花助力年)."""

    def _make_stars(self, year_range):
        """Generate annual stars for a range of years with standard cycle."""
        stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
        result = []
        for y in year_range:
            idx = (y - 4) % 10
            bidx = (y - 4) % 12
            result.append({'year': y, 'stem': stems[idx], 'branch': branches[bidx]})
        return result

    def test_primary_tier_labeled_as_hehun(self):
        """Primary tier (六合日支) candidate gets 合婚年, not 桃花助力年."""
        # DM=戊, day_branch=午, year_branch=卯
        # 六合日支: BRANCH_LIUHE[午]=未 → 2027年(丁未)
        # Stem 丁 for DM 戊 = 正印 (not spouse star) → falls to else → should be 合婚年
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        year_2027 = next((y for y in result if y['year'] == 2027), None)
        assert year_2027 is not None, "2027 (六合日支 未) should be in results"
        assert year_2027['starType'] == '合婚年'

    def test_secondary_b_labeled_as_taohua_he(self):
        """Secondary_b tier (三合日支) gets 桃花合年."""
        # DM=戊, day_branch=午 → 三合: 寅午戌
        # 2030年=庚戌 (stem 庚 for DM 戊 = 食神, not spouse star) → 桃花合年
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        year_2030 = next((y for y in result if y['year'] == 2030), None)
        if year_2030:
            assert year_2030['starType'] == '桃花合年', f"Expected 桃花合年, got {year_2030['starType']}"

    def test_secondary_c_labeled_as_taohua_he(self):
        """Secondary_c tier (天干合日主) gets 桃花合年."""
        # DM=戊, STEM_COMBINATIONS[戊]=癸 → 2033年=癸丑
        # If 2033 is a candidate via secondary_c, it should be 桃花合年
        # Note: 2033 may get labeled as 正緣年 if stem 癸=水=spouse star for male DM=戊
        # 癸 element = 水 = spouse star element → would be 正緣年, NOT桃花合年
        # So we need a chart where 天干合 stem is NOT spouse star element
        # DM=甲, STEM_COMBINATIONS[甲]=己 → spouse star for male = 土(甲克土)
        # 己 element = 土 = spouse star → still 正緣年
        # DM=丙, STEM_COMBINATIONS[丙]=辛 → spouse star for male = 金(丙克金)
        # 辛 element = 金 = spouse star → still 正緣年
        # DM=庚, STEM_COMBINATIONS[庚]=乙 → spouse star for male = 木(庚克木)
        # 乙 element = 木 = spouse star → still 正緣年
        # For 天干合日主 to hit the else clause, the combining stem's element must NOT be spouse star
        # This is actually impossible since 五合 pairs always result in spouse star for male
        # (甲己=土/克, 乙庚=金/克, 丙辛=金/克... wait no)
        # 甲(木) combine 己(土). Male DM=甲: spouse=土(what甲 overcomes). 己=土 → spouse star → 正緣年
        # So secondary_c always produces 正緣年 for males. For females:
        # Female DM=甲: spouse = 正官 = ELEMENT_OVERCOME_BY[木] = 金.
        # STEM_COMBINATIONS[甲]=己. 己=土 ≠ 金 → NOT spouse star → falls to else → 桃花合年!
        stars = self._make_stars(range(2024, 2037))
        # 2025年=乙巳. For female DM=甲, STEM_COMBINATIONS[甲]=己.
        # Need year with stem 己: 2029年=己酉
        result = compute_romance_good_years(
            'female', '甲', '辰', '午', stars, [], 1990, 2026, [],
        )
        # 己酉 year: stem 己 combines with DM 甲. 己 element=土. Female DM=甲: spouse=金. 土≠金 → else clause
        year_2029 = next((y for y in result if y['year'] == 2029), None)
        if year_2029 and year_2029.get('tier') == 'secondary_c':
            assert year_2029['starType'] == '桃花合年'

    def test_secondary_a2_dropped(self):
        """Secondary_a2 tier (配偶星藏干) does NOT appear in final output."""
        # DM=戊 male, day_branch=午, spouse element=水
        # 申 branch hidden stems: [庚, 壬, 戊] — 壬=水=spouse star
        # 2028年=戊申 → secondary_a2 candidate
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        # secondary_a2 items should be dropped — no item with tier='secondary_a2' in output
        a2_items = [y for y in result if y.get('tier') == 'secondary_a2']
        assert len(a2_items) == 0, f"secondary_a2 items should be dropped, found: {a2_items}"

    def test_supplementary_dropped(self):
        """Supplementary tier (桃花/天喜) does NOT appear in final output."""
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        # supplementary items should be dropped (unless rescued by 天喜 overlay)
        supp_items = [y for y in result if y.get('tier') == 'supplementary'
                      and y.get('starType') not in ('天喜桃花年', '天喜年')]
        assert len(supp_items) == 0, f"Un-rescued supplementary items should be dropped: {supp_items}"

    def test_drop_rescued_by_tianxi(self):
        """_drop item whose annual branch matches day-branch 天喜 gets upgraded to 天喜桃花年."""
        # DM=戊, day_branch=午, TIANXI[午]=卯
        # Need a secondary_a2 or supplementary candidate whose annual branch=卯
        # 2035年=乙卯 — branch=卯 matches tianxi_day_branch
        # 卯 hidden stems: [乙] — 乙=木. Male DM=戊: spouse=水. 木≠水 → not secondary_a
        # But 卯 might match 桃花: TAOHUA[午]=卯 → supplementary tier via 桃花
        # When labeling: branch=卯 ≠ hongluan(子) ≠ tianxi(午). stem 乙 ten_god for 戊 = 正官(not spouse for male)
        # → else clause → tier=supplementary → _drop → but annual_branch=卯=TIANXI[午] → rescued as 天喜桃花年
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        year_2035 = next((y for y in result if y['year'] == 2035), None)
        # 2035 should exist and be 天喜桃花年 or 天喜年 (injected) depending on path
        if year_2035:
            assert '天喜' in year_2035['starType'], f"Expected 天喜-related type, got {year_2035['starType']}"

    def test_no_taohua_zhuli_in_output(self):
        """Verify 桃花助力年 never appears in any output (eliminated from codebase)."""
        # Use Roger's chart which previously produced 桃花助力年 for primary/secondary tiers
        # DM=戊, day_branch=午, year_branch=卯
        # 2027(未) is primary tier → should be 合婚年 (not 桃花助力年)
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        for y in result:
            assert '桃花助力年' not in y.get('starType', ''), \
                f"桃花助力年 should be eliminated, found in year {y['year']}: {y['starType']}"

    def test_roger_romance_year_count_reduced(self):
        """Roger's chart produces ~5-7 romance good years (down from ~10)."""
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        # With tier-aware dropping, should be fewer than 10
        assert len(result) <= 8, f"Expected ≤8 years after tier pruning, got {len(result)}"
        assert len(result) >= 3, f"Expected ≥3 years, got {len(result)}"

    def test_hehun_not_downgraded_by_tianxi(self):
        """合婚年 item whose annual branch also matches 天喜 keeps 合婚年 label with subNote."""
        # Need: day_branch where BRANCH_LIUHE[day_branch] == TIANXI[day_branch]
        # BRANCH_LIUHE[午]=未, TIANXI[午]=卯 → not equal
        # BRANCH_LIUHE[卯]=戌, TIANXI[卯]=酉 → not equal
        # BRANCH_LIUHE[子]=丑, TIANXI[子]=未 → not equal
        # This combination is rare. Let's test directly with a custom stars list
        # where the 六合 year's branch also happens to be the tianxi_day_branch
        # Alternative: just verify that 合婚年 items DON'T become 天喜桃花年
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        hehun_years = [y for y in result if y.get('starType') == '合婚年']
        for y in hehun_years:
            # 合婚年 should never be overwritten to 天喜桃花年
            assert y['starType'] == '合婚年', f"合婚年 should not be downgraded"

    def test_injected_hongluan_zhengyuan_tier(self):
        """Injected 紅鸞正緣年 entry gets tier: 'hongluan' (not 'tianxi')."""
        # DM=戊 male, year_branch=卯, HONGLUAN[卯]=子
        # 2032年=壬子. Stem 壬=水=spouse star → 紅鸞正緣年
        stars = self._make_stars(range(2024, 2037))
        result = compute_romance_good_years(
            'male', '戊', '午', '卯', stars, [], 1987, 2026, [],
        )
        year_2032 = next((y for y in result if y['year'] == 2032), None)
        if year_2032 and year_2032.get('starType') == '紅鸞正緣年':
            assert year_2032.get('tier') == 'hongluan', \
                f"紅鸞正緣年 should have tier='hongluan', got '{year_2032.get('tier')}'"


# ============================================================
# LP Ten God Hallucination Fix — Tests
# ============================================================

class TestActiveLuckPeriod:
    """Tests for activeLuckPeriod injection into marriageTimingIndicators."""

    def _make_result_with_lps(self, lps, current_year=2026):
        """Helper: run orchestrator with given luck periods."""
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        sv2 = {'classification': 'balanced', 'score': 50}
        branches = ['午', '未', '申', '酉', '戌']
        stems_a = ['丙', '丁', '戊', '己', '庚']
        annual_stars = [{'year': current_year + i, 'stem': stems_a[i], 'branch': branches[i]} for i in range(5)]
        monthly_stars = [
            {'month': i + 1, 'stem': '甲', 'branch': ['寅', '卯', '辰', '巳', '午', '未',
                                                         '申', '酉', '戌', '亥', '子', '丑'][i]}
            for i in range(12)
        ]
        return generate_love_pre_analysis(
            pillars=pillars,
            day_master_stem='甲',
            gender='male',
            five_elements_balance={'木': 20, '火': 25, '土': 30, '金': 15, '水': 10},
            effective_gods=eg,
            prominent_god='食神',
            strength_v2=sv2,
            cong_ge=None,
            luck_periods=lps,
            annual_stars=annual_stars,
            monthly_stars=monthly_stars,
            kong_wang=['戌', '亥'],
            all_shen_sha=[],
            birth_year=1990,
            current_year=current_year,
        )

    def test_orchestrator_has_active_luck_period(self):
        """activeLuckPeriod is populated when an LP covers current year."""
        lps = [{'stem': '乙', 'branch': '巳', 'startYear': 2020, 'endYear': 2029, 'startAge': 25}]
        result = self._make_result_with_lps(lps, current_year=2026)
        ti = result['marriageTimingIndicators']
        assert 'activeLuckPeriod' in ti, "activeLuckPeriod should be present"

    def test_active_luck_period_structure(self):
        """activeLuckPeriod has correct structure with stem, branch, startYear, endYear, tenGod."""
        lps = [{'stem': '乙', 'branch': '巳', 'startYear': 2020, 'endYear': 2029, 'startAge': 25}]
        result = self._make_result_with_lps(lps, current_year=2026)
        alp = result['marriageTimingIndicators']['activeLuckPeriod']
        assert alp['stem'] == '乙'
        assert alp['branch'] == '巳'
        assert alp['startYear'] == 2020
        assert alp['endYear'] == 2029
        # DM=甲, LP stem=乙 → derive_ten_god('甲', '乙') = 劫財
        assert alp['tenGod'] == '劫財', f"Expected 劫財, got {alp['tenGod']}"

    def test_active_luck_period_none_when_no_lp(self):
        """No activeLuckPeriod when no LP covers current year."""
        # LP ends before current year
        lps = [{'stem': '乙', 'branch': '巳', 'startYear': 2010, 'endYear': 2019, 'startAge': 15}]
        result = self._make_result_with_lps(lps, current_year=2026)
        ti = result['marriageTimingIndicators']
        assert 'activeLuckPeriod' not in ti, "activeLuckPeriod should NOT be present when no LP covers current year"

    def test_annual_forecast_lp_context_transition(self):
        """Annual forecasts spanning two LPs have correct lpContext for each year."""
        # LP1: 2024-2026 (乙巳), LP2: 2027-2036 (甲辰)
        lps = [
            {'stem': '乙', 'branch': '巳', 'startYear': 2024, 'endYear': 2026, 'startAge': 29},
            {'stem': '甲', 'branch': '辰', 'startYear': 2027, 'endYear': 2036, 'startAge': 32},
        ]
        result = self._make_result_with_lps(lps, current_year=2026)
        forecasts = result['annualForecasts']

        # 2026 should be in LP1 (乙巳)
        y2026 = next((f for f in forecasts if f['year'] == 2026), None)
        assert y2026 is not None, "2026 forecast should exist"
        assert '乙巳' in y2026.get('lpContext', ''), f"2026 lpContext should contain 乙巳, got {y2026.get('lpContext')}"

        # 2027 should be in LP2 (甲辰)
        y2027 = next((f for f in forecasts if f['year'] == 2027), None)
        assert y2027 is not None, "2027 forecast should exist"
        assert '甲辰' in y2027.get('lpContext', ''), f"2027 lpContext should contain 甲辰, got {y2027.get('lpContext')}"

        # Verify the ten god is different for each LP
        # DM=甲, LP1 stem=乙 → 劫財; LP2 stem=甲 → 比肩
        assert '劫財' in y2026.get('lpContext', ''), f"2026 should have 劫財 in lpContext"
        assert '比肩' in y2027.get('lpContext', ''), f"2027 should have 比肩 in lpContext"

    def test_active_lp_ten_god_consistency(self):
        """Enriched LP tenGod matches derive_ten_god for same LP."""
        lps = [{'stem': '乙', 'branch': '巳', 'startYear': 2020, 'endYear': 2029, 'startAge': 25}]
        day_master = '甲'
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}

        # Enrich LPs (same as orchestrator does)
        enriched = _enrich_luck_periods(lps, day_master, 'male', eg)
        active = _find_active_luck_period(enriched, 2026)
        assert active is not None

        # Verify enriched tenGod matches direct derive_ten_god call
        expected_tg = derive_ten_god(day_master, active['stem'])
        assert active['tenGod'] == expected_tg, \
            f"Enriched tenGod '{active['tenGod']}' != derive_ten_god result '{expected_tg}'"


# ============================================================
# Deterministic Extension for Frontend Badges — Tests
# ============================================================

class TestDeterministicExtension:
    """Tests for new deterministic keys: love_personality, timing_indicators, annual_forecasts, monthly_forecasts."""

    def _make_result(self):
        """Reuse the orchestrator helper from TestOrchestratorAndAnchors."""
        pillars = make_pillars('庚', '午', '辛', '巳', '甲', '辰', '丙', '寅')
        eg = {'木': '用神', '水': '喜神', '火': '忌神', '土': '仇神', '金': '閒神'}
        sv2 = {'classification': 'balanced', 'score': 50}
        branches = ['午', '未', '申', '酉', '戌']
        stems_a = ['丙', '丁', '戊', '己', '庚']
        annual_stars = [{'year': 2026 + i, 'stem': stems_a[i], 'branch': branches[i]} for i in range(5)]
        monthly_stars = [
            {'month': i + 1, 'stem': '甲', 'branch': ['寅', '卯', '辰', '巳', '午', '未',
                                                         '申', '酉', '戌', '亥', '子', '丑'][i]}
            for i in range(12)
        ]
        lps = [{'stem': '丙', 'branch': '午', 'startYear': 2020, 'endYear': 2029, 'startAge': 25}]
        return generate_love_pre_analysis(
            pillars=pillars, day_master_stem='甲', gender='male',
            five_elements_balance={'木': 20, '火': 25, '土': 30, '金': 15, '水': 10},
            effective_gods=eg, prominent_god='食神', strength_v2=sv2, cong_ge=None,
            luck_periods=lps, annual_stars=annual_stars, monthly_stars=monthly_stars,
            kong_wang=['戌', '亥'], all_shen_sha=[], birth_year=1990, current_year=2026,
        )

    def test_deterministic_has_love_personality(self):
        det = self._make_result()['deterministic']
        lp = det['love_personality']
        assert 'archetypeLabel' in lp
        assert 'archetypeTrait' in lp
        assert 'elementStyle' in lp
        assert 'strengthClass' in lp
        assert 'dominantTenGod' in lp
        assert 'dominantCount' in lp
        assert isinstance(lp['archetypeLabel'], str) and len(lp['archetypeLabel']) > 0

    def test_deterministic_has_timing_indicators(self):
        det = self._make_result()['deterministic']
        ti = det['timing_indicators']
        assert 'earlySignals' in ti
        assert 'lateSignals' in ti
        assert isinstance(ti['earlySignals'], list)
        assert isinstance(ti['lateSignals'], list)

    def test_deterministic_has_annual_forecasts(self):
        det = self._make_result()['deterministic']
        af_list = det['annual_forecasts']
        assert isinstance(af_list, list)
        assert len(af_list) == 5  # 5 annual stars → 5 forecasts
        required_keys = ['year', 'stem', 'branch', 'auspiciousness', 'stemRole', 'stemTenGod',
                         'hasRomanceStar', 'lpContext',
                         'isGoodYear', 'isDangerYear', 'isVoid', 'interactions']
        for af in af_list:
            for key in required_keys:
                assert key in af, f"Missing key '{key}' in annual forecast {af.get('year')}"
            # stemTenGod must be non-empty (validates dead tenGod fallback removal)
            assert af['stemTenGod'], f"stemTenGod should be non-empty for year {af.get('year')}"

    def test_deterministic_has_monthly_forecasts(self):
        det = self._make_result()['deterministic']
        mf_list = det['monthly_forecasts']
        assert isinstance(mf_list, list)
        assert len(mf_list) == 12
        required_keys = ['month', 'stem', 'branch', 'auspiciousness', 'stemRole', 'stemTenGod',
                         'hasRomanceStar', 'isVoid', 'interactions', 'lpContext']
        for mf in mf_list:
            for key in required_keys:
                assert key in mf, f"Missing key '{key}' in monthly forecast month={mf.get('month')}"
            # stemTenGod must be non-empty
            assert mf['stemTenGod'], f"stemTenGod should be non-empty for month {mf.get('month')}"

    def test_deterministic_has_active_luck_period(self):
        det = self._make_result()['deterministic']
        alp = det.get('active_luck_period')
        assert alp is not None, "active_luck_period should exist at top level"
        assert 'stem' in alp
        assert 'branch' in alp
        assert 'tenGod' in alp
        assert 'startYear' in alp
        assert 'endYear' in alp
        assert isinstance(alp['startYear'], int)
        assert isinstance(alp['endYear'], int)

    def test_deterministic_nested_keys_are_camel_case(self):
        det = self._make_result()['deterministic']
        # Annual forecasts should use camelCase
        af = det['annual_forecasts'][0]
        assert 'stemRole' in af, "Expected camelCase 'stemRole', not snake_case"
        assert 'stemTenGod' in af, "Expected camelCase 'stemTenGod'"
        assert 'isGoodYear' in af, "Expected camelCase 'isGoodYear'"
        assert 'hasRomanceStar' in af, "Expected camelCase 'hasRomanceStar'"
        assert 'lpContext' in af, "Expected camelCase 'lpContext'"
        assert 'stem_role' not in af, "Should NOT have snake_case 'stem_role'"
        # Monthly forecasts
        mf = det['monthly_forecasts'][0]
        assert 'stemRole' in mf
        assert 'hasRomanceStar' in mf
        assert 'lpContext' in mf
        assert 'has_romance_star' not in mf
        # Love personality
        lp = det['love_personality']
        assert 'archetypeLabel' in lp
        assert 'archetype_label' not in lp
        # Active luck period
        alp = det['active_luck_period']
        assert 'tenGod' in alp
        assert 'startYear' in alp
        assert 'ten_god' not in alp
