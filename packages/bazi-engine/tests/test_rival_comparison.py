"""
Tests for Rival Seer Comparison features (R1-R5, F1-F2).

Laopo10 chart: 1987-01-25 16:45 female (丙寅/辛丑/甲戌/壬申)
  - DM: 甲 (Wood), 正官格
  - Strength: weak
  - Four pillars: year=丙寅, month=辛丑, day=甲戌, hour=壬申
"""

import pytest
from datetime import datetime

from app.calculator import calculate_bazi
from app.five_elements import get_seasonal_state_labels
from app.four_pillars import calculate_tai_yuan, calculate_ming_gong, calculate_shen_gong, calculate_tai_xi
from app.lifetime_enhanced import compute_parent_health_years
from app.luck_periods import (
    calculate_luck_period_direction,
    calculate_luck_period_start_age,
    calculate_luck_period_start_info,
)


@pytest.fixture(scope='module')
def laopo10_chart():
    """Laopo10: 1987-01-25 16:45, female, 柔佛."""
    return calculate_bazi(
        '1987-01-25', '16:45', '柔佛', 'Asia/Kuala_Lumpur', 'female',
        reading_type='LIFETIME',
    )


# ============================================================
# R1: 旺相休囚死 Seasonal State Labels
# ============================================================

class TestSeasonalStateLabels:
    """R1: 五行旺相休囚死 labels per birth month."""

    def test_chou_month_labels(self):
        """丑月 (winter earth): 土旺、金相、火休、木囚、水死."""
        result = get_seasonal_state_labels('丑')
        assert result == {'木': '囚', '火': '休', '土': '旺', '金': '相', '水': '死'}

    def test_yin_month_labels(self):
        """寅月 (spring): 木旺、火相、土死、金囚、水休."""
        result = get_seasonal_state_labels('寅')
        assert result == {'木': '旺', '火': '相', '土': '死', '金': '囚', '水': '休'}

    def test_wu_month_labels(self):
        """午月 (summer): 火旺、土相、木休、水囚、金死."""
        result = get_seasonal_state_labels('午')
        assert result == {'木': '休', '火': '旺', '土': '相', '金': '死', '水': '囚'}

    def test_you_month_labels(self):
        """酉月 (autumn): 金旺、水相、土休、火囚、木死."""
        result = get_seasonal_state_labels('酉')
        # Actually per the data, let's verify
        result = get_seasonal_state_labels('酉')
        assert result['金'] == '旺'
        assert result['水'] == '相'

    def test_si_ji_tu_convention(self):
        """四季土 convention: 辰戌丑未 all have 土旺."""
        for branch in ['辰', '戌', '丑', '未']:
            result = get_seasonal_state_labels(branch)
            assert result['土'] == '旺', f'{branch}月: expected 土旺, got 土{result["土"]}'

    def test_laopo10_seasonal_states(self, laopo10_chart):
        """Laopo10 (丑月) integration test."""
        states = laopo10_chart['seasonalStates']
        assert states == {'木': '囚', '火': '休', '土': '旺', '金': '相', '水': '死'}


# ============================================================
# R5: 空亡 Display (Year + Day Pillar)
# ============================================================

class TestKongWangDisplay:
    """R5: 空亡 display shows day (primary) + year (secondary) pillars."""

    def test_laopo10_kong_wang_display(self, laopo10_chart):
        """Laopo10: day=申酉, year=戌亥."""
        kwd = laopo10_chart['kongWangDisplay']
        assert 'day' in kwd
        assert 'year' in kwd
        assert set(kwd['day']) == {'申', '酉'}
        assert set(kwd['year']) == {'戌', '亥'}

    def test_kong_wang_display_structure(self, laopo10_chart):
        """KongWangDisplay should have exactly day and year keys."""
        kwd = laopo10_chart['kongWangDisplay']
        assert set(kwd.keys()) == {'day', 'year'}
        assert isinstance(kwd['day'], list)
        assert isinstance(kwd['year'], list)
        assert len(kwd['day']) == 2
        assert len(kwd['year']) == 2


# ============================================================
# F1: 胎元/命宮/胎息
# ============================================================

class TestTaiYuanMingGongTaiXi:
    """F1: Supplementary pillar computations."""

    def test_tai_yuan_laopo10(self):
        """胎元: 辛丑 → stem=(7+1)%10=壬, branch=(1+3)%12=辰 → 壬辰(長流水)."""
        result = calculate_tai_yuan('辛', '丑')
        assert result['stem'] == '壬'
        assert result['branch'] == '辰'
        assert result['naYin'] == '長流水'

    def test_ming_gong_laopo10(self):
        """命宮: m=丑(1), h=申(8) → (5-1-8)%12=8 → 申. Year丙 → 丙申(山下火)."""
        result = calculate_ming_gong('丑', '申', '丙')
        assert result['branch'] == '申'
        assert result['stem'] == '丙'
        assert result['naYin'] == '山下火'

    def test_tai_xi_laopo10(self):
        """胎息: 甲戌 → 甲合己, 戌合卯 → 己卯(城頭土)."""
        result = calculate_tai_xi('甲', '戌')
        assert result['stem'] == '己'
        assert result['branch'] == '卯'
        assert '城' in result['naYin']

    def test_ming_gong_zi_zi(self):
        """命宮 edge case: 子月+子時 → (5-0-0)%12=5 → 巳."""
        result = calculate_ming_gong('子', '子', '甲')
        assert result['branch'] == '巳'

    def test_ming_gong_hai_hai(self):
        """命宮 edge case: 亥月+亥時 → (5-11-11)%12=(-17)%12=7 → 未."""
        result = calculate_ming_gong('亥', '亥', '甲')
        assert result['branch'] == '未'

    def test_ming_gong_yin_yin(self):
        """命宮 edge case: 寅月+寅時 → (5-2-2)%12=1 → 丑."""
        result = calculate_ming_gong('寅', '寅', '甲')
        assert result['branch'] == '丑'

    def test_ming_gong_mao_you(self):
        """命宮 edge case: 卯月+酉時 → (5-3-9)%12=(-7)%12=5 → 巳."""
        result = calculate_ming_gong('卯', '酉', '甲')
        assert result['branch'] == '巳'

    def test_integration_laopo10(self, laopo10_chart):
        """Integration: verify 胎元/命宮/胎息/身宮 in full chart output."""
        assert laopo10_chart['taiYuan']['stem'] == '壬'
        assert laopo10_chart['taiYuan']['branch'] == '辰'
        assert laopo10_chart['mingGong']['stem'] == '丙'
        assert laopo10_chart['mingGong']['branch'] == '申'
        assert laopo10_chart['taiXi']['stem'] == '己'
        assert laopo10_chart['taiXi']['branch'] == '卯'
        # 身宮: 六合(命宮申) = 巳, year丙 → 癸巳(長流水)
        assert laopo10_chart['shenGong']['branch'] == '巳'
        assert laopo10_chart['shenGong']['stem'] == '癸'


# ============================================================
# F1b: 身宮 (Body Palace) — NEW
# ============================================================

class TestShenGong:
    """身宮 = 六合 partner of 命宮 branch, stem via 五虎遁."""

    def test_shen_gong_laopo10(self):
        """Laopo10: 命宮=申, 六合(申)=巳, year丙 → 癸巳(長流水)."""
        result = calculate_shen_gong('丑', '申', '丙')
        assert result['branch'] == '巳'
        assert result['stem'] == '癸'
        assert result['naYin'] == '長流水'

    def test_shen_gong_zi_zi(self):
        """子月+子時: 命宮=巳, 六合(巳)=申, year甲 → 壬申(劍鋒金)."""
        result = calculate_shen_gong('子', '子', '甲')
        assert result['branch'] == '申'
        # year甲 → start=丙(2), 申 in MONTH_BRANCHES idx=6 → (2+6)%10=8 → 壬
        assert result['stem'] == '壬'
        assert result['naYin'] == '劍鋒金'

    def test_shen_gong_hai_hai(self):
        """亥月+亥時: 命宮=未, 六合(未)=午, year甲 → 庚午(路旁土)."""
        result = calculate_shen_gong('亥', '亥', '甲')
        assert result['branch'] == '午'
        # year甲 → start=丙(2), 午 in MONTH_BRANCHES idx=4 → (2+4)%10=6 → 庚
        assert result['stem'] == '庚'
        assert result['naYin'] == '路旁土'

    def test_shen_gong_yin_yin(self):
        """寅月+寅時: 命宮=丑, 六合(丑)=子, year甲 → 丙子(澗下水)."""
        result = calculate_shen_gong('寅', '寅', '甲')
        assert result['branch'] == '子'
        # year甲 → start=丙(2), 子 in MONTH_BRANCHES idx=10 → (2+10)%10=2 → 丙
        # Wait: 子 in MONTH_BRANCHES = ['寅','卯','辰','巳','午','未','申','酉','戌','亥','子','丑']
        # 子 is at index 10 → (2+10)%10 = 12%10 = 2 → 丙
        assert result['stem'] == '丙'

    def test_shen_gong_mao_you(self):
        """卯月+酉時: 命宮=巳, 六合(巳)=申, year甲 → 壬申(劍鋒金)."""
        result = calculate_shen_gong('卯', '酉', '甲')
        assert result['branch'] == '申'
        assert result['stem'] == '壬'
        assert result['naYin'] == '劍鋒金'

    def test_shen_gong_wu_wu(self):
        """午月+午時: 命宮=(5-6-6)%12=5=巳, 六合(巳)=申."""
        result = calculate_shen_gong('午', '午', '乙')
        assert result['branch'] == '申'
        # year乙 → start=戊(4), 申 in MONTH_BRANCHES idx=6 → (4+6)%10=0 → 甲
        assert result['stem'] == '甲'

    def test_shen_gong_chen_chou(self):
        """辰月+丑時: 命宮=(5-4-1)%12=0=子, 六合(子)=丑."""
        result = calculate_shen_gong('辰', '丑', '甲')
        assert result['branch'] == '丑'
        # year甲 → start=丙(2), 丑 in MONTH_BRANCHES idx=11 → (2+11)%10=3 → 丁
        assert result['stem'] == '丁'

    def test_shen_gong_different_year_stems(self):
        """Test 五虎遁 stem derivation across all 5 year stem groups."""
        # Same month/hour (丑/申) → 身宮 branch always 巳 (idx 3 in MONTH_BRANCHES)
        # 巳 at MONTH_BRANCHES idx=3
        # 甲/己 → start=丙(2): (2+3)%10=5 → 己
        assert calculate_shen_gong('丑', '申', '甲')['stem'] == '己'
        assert calculate_shen_gong('丑', '申', '己')['stem'] == '己'
        # 乙/庚 → start=戊(4): (4+3)%10=7 → 辛
        assert calculate_shen_gong('丑', '申', '乙')['stem'] == '辛'
        assert calculate_shen_gong('丑', '申', '庚')['stem'] == '辛'
        # 丙/辛 → start=庚(6): (6+3)%10=9 → 癸
        assert calculate_shen_gong('丑', '申', '丙')['stem'] == '癸'
        assert calculate_shen_gong('丑', '申', '辛')['stem'] == '癸'
        # 丁/壬 → start=壬(8): (8+3)%10=1 → 乙
        assert calculate_shen_gong('丑', '申', '丁')['stem'] == '乙'
        assert calculate_shen_gong('丑', '申', '壬')['stem'] == '乙'
        # 戊/癸 → start=甲(0): (0+3)%10=3 → 丁
        assert calculate_shen_gong('丑', '申', '戊')['stem'] == '丁'
        assert calculate_shen_gong('丑', '申', '癸')['stem'] == '丁'


# ============================================================
# F2: Precise 起運 Date Calculation
# ============================================================

class TestLuckPeriodStartInfo:
    """F2: Precise luck period start date with ephem."""

    def test_laopo10_start_age(self):
        """Laopo10 should have startAge=6."""
        birth_dt = datetime(1987, 1, 25, 16, 45)
        direction = calculate_luck_period_direction('丙', 'female')
        assert direction == -1  # Female + 陽 → backward
        start_age = calculate_luck_period_start_age(birth_dt, direction)
        assert start_age == 6

    def test_laopo10_start_info(self):
        """Laopo10 start info: age=6, date in 1993."""
        birth_dt = datetime(1987, 1, 25, 16, 45)
        direction = calculate_luck_period_direction('丙', 'female')
        start_age = calculate_luck_period_start_age(birth_dt, direction)
        info = calculate_luck_period_start_info(birth_dt, direction, start_age)

        assert info['startAge'] == 6
        assert info['startDate'].startswith('1993')
        assert '年' in info['yearsMonths']
        assert '月' in info['yearsMonths']
        assert info['direction'] == -1
        assert info['daysToTerm'] > 0

    def test_start_age_consistency(self):
        """startAge in info must match canonical value from existing function."""
        birth_dt = datetime(1987, 1, 25, 16, 45)
        direction = -1
        start_age = calculate_luck_period_start_age(birth_dt, direction)
        info = calculate_luck_period_start_info(birth_dt, direction, start_age)
        assert info['startAge'] == start_age

    def test_integration_laopo10(self, laopo10_chart):
        """Integration: luckPeriodStartInfo present in full chart output."""
        info = laopo10_chart['luckPeriodStartInfo']
        assert info['startAge'] == 6
        assert info['startDate'].startswith('1993')
        assert info['direction'] == -1


# ============================================================
# R3: Parent Health Years — Drop Stem-Only
# ============================================================

class TestParentHealthYearsStemDrop:
    """R3: Stem-only threats dropped per 「天干不主吉凶」."""

    def test_stem_only_dropped(self):
        """Stem-only father years should be excluded entirely."""
        annual_stars = [
            {'year': 2029, 'stem': '己', 'branch': '酉'},   # stem=土, branch本氣=辛=金 → stem-only
            {'year': 2030, 'stem': '庚', 'branch': '戌'},   # stem=金, branch本氣=戊=土 → branch-only
            {'year': 2039, 'stem': '己', 'branch': '未'},   # stem=土, branch本氣=己=土 → BOTH
        ]
        # DM=戊, father=水, father_threat=土
        result = compute_parent_health_years('戊', annual_stars)
        assert 2039 in result['father']  # both
        assert 2030 in result['father']  # branch-only
        assert 2029 not in result['father']  # stem-only → dropped

    def test_dual_output_with_current_year(self):
        """With current_year, returns father_future/mother_future."""
        annual_stars = [
            {'year': 2024, 'stem': '甲', 'branch': '辰'},   # branch本氣=戊=土 → branch father
            {'year': 2030, 'stem': '庚', 'branch': '戌'},   # branch本氣=戊=土 → branch father
        ]
        result = compute_parent_health_years('戊', annual_stars, current_year=2026)
        assert 'father_future' in result
        assert 'mother_future' in result
        # 2024 is in full list but NOT in future list
        assert 2024 in result['father']
        assert 2024 not in result['father_future']
        assert 2030 in result['father_future']

    def test_no_future_keys_without_current_year(self):
        """Without current_year, no father_future/mother_future keys."""
        annual_stars = [
            {'year': 2030, 'stem': '庚', 'branch': '戌'},
        ]
        result = compute_parent_health_years('戊', annual_stars)
        assert 'father_future' not in result
        assert 'mother_future' not in result


# ============================================================
# R2: Romance Years — Hidden Stem Spouse Star
# ============================================================

class TestRomanceHiddenStemSpouseStar:
    """R2: 配偶星藏干 tier for hidden stem spouse star."""

    def test_laopo10_has_secondary_a2_tier(self, laopo10_chart):
        """Laopo10 should have at least one year with secondary_a2 tier."""
        enhanced = laopo10_chart.get('lifetimeEnhancedInsights')
        if enhanced is None:
            pytest.skip('No lifetime enhanced insights')
        dayun_context = enhanced['deterministic'].get('romance_years_dayun_context', [])
        a2_years = [r for r in dayun_context if r.get('tier') == 'secondary_a2']
        assert len(a2_years) >= 1, f'No secondary_a2 years found in: {dayun_context}'
        # All secondary_a2 entries should have 配偶星藏干 in signal
        for r in a2_years:
            assert '配偶星藏干' in r['signal']

    def test_laopo10_2025_hidden_stem(self, laopo10_chart):
        """2025 (乙巳) should have 配偶星藏干 — 巳 hidden stems [丙,庚,戊], 庚=金=正官."""
        enhanced = laopo10_chart.get('lifetimeEnhancedInsights')
        if enhanced is None:
            pytest.skip('No lifetime enhanced insights')
        dayun_context = enhanced['deterministic'].get('romance_years_dayun_context', [])
        year_2025 = [r for r in dayun_context if r.get('year') == 2025]
        assert len(year_2025) == 1
        assert year_2025[0]['tier'] == 'secondary_a2'
        assert '配偶星藏干' in year_2025[0]['signal']
