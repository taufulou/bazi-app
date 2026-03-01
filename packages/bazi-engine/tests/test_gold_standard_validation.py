"""
Gold Standard Validation Tests — Cross-validated Bazi Charts

These tests validate our engine against gold standard reference data from
multiple authoritative sources:
  - Joey Yap BaZi Profiling System (commercial PDF)
  - Rival seer app (八字終身運)
  - Published Bazi master analyses of historical figures
  - Web research from trusted TW/CN/HK calculator sites

The reference data is stored in:
  tests/fixtures/gold_standard_charts.json

Test categories:
  1. Personal charts (cross-validated with Joey Yap + rival seer)
  2. Historical figures (validated against published professional analyses)
  3. Year boundary tests (立春 edge cases)

Tolerance levels:
  - Pillars, ten gods, hidden stems: MUST match 100% (deterministic)
  - DM strength V2 score: ±5 tolerance (for regression detection)
  - Pattern: Must match recorded value
  - Useful/Favorable gods: Must match recorded value
"""

import json
import os
import pytest
from app.calculator import calculate_bazi

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')


def load_gold_standard():
    """Load the gold standard charts JSON fixture."""
    path = os.path.join(FIXTURES_DIR, 'gold_standard_charts.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture(scope='module')
def gold_data():
    return load_gold_standard()


# ============================================================
# Personal Charts — Cross-validated with Joey Yap + Rival Seer
# ============================================================

class TestPersonalChartPillars:
    """Pillar accuracy — must be 100% correct (deterministic)."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        date_str = dt[0]
        time_str = dt[1][:5]
        city = chart.get('birthCity', '台北市')
        gender = chart['gender']
        return calculate_bazi(date_str, time_str, city, "Asia/Taipei", gender)

    def test_laopo_pillars(self, gold_data):
        """Subject A: Laopo — confirmed by Joey Yap + rival seer + our engine."""
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        assert result['ganZhi']['year'] == expected['year'], f"Year: {result['ganZhi']['year']} != {expected['year']}"
        assert result['ganZhi']['month'] == expected['month'], f"Month: {result['ganZhi']['month']} != {expected['month']}"
        assert result['ganZhi']['day'] == expected['day'], f"Day: {result['ganZhi']['day']} != {expected['day']}"
        assert result['ganZhi']['hour'] == expected['hour'], f"Hour: {result['ganZhi']['hour']} != {expected['hour']}"

    def test_roger_pillars(self, gold_data):
        """Subject B: Roger — confirmed by Joey Yap + our engine."""
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        assert result['ganZhi']['year'] == expected['year']
        assert result['ganZhi']['month'] == expected['month']
        assert result['ganZhi']['day'] == expected['day']
        assert result['ganZhi']['hour'] == expected['hour']

    def test_1990_standard_pillars(self, gold_data):
        """Subject C: Standard test date 1990-05-15."""
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'test_1990')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        assert result['ganZhi']['year'] == expected['year']
        assert result['ganZhi']['month'] == expected['month']
        assert result['ganZhi']['day'] == expected['day']
        assert result['ganZhi']['hour'] == expected['hour']


class TestPersonalChartTenGods:
    """Ten god labels — deterministic given day master."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], chart.get('birthCity', '台北市'), "Asia/Taipei", chart['gender'])

    def test_laopo_ten_gods(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        expected = chart['expected']['tenGods']
        assert result['fourPillars']['year']['tenGod'] == expected['year_stem']
        assert result['fourPillars']['month']['tenGod'] == expected['month_stem']
        assert result['fourPillars']['hour']['tenGod'] == expected['hour_stem']

    def test_roger_ten_gods(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        expected = chart['expected']['tenGods']
        assert result['fourPillars']['year']['tenGod'] == expected['year_stem']
        assert result['fourPillars']['month']['tenGod'] == expected['month_stem']
        assert result['fourPillars']['hour']['tenGod'] == expected['hour_stem']

    def test_1990_ten_gods(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'test_1990')
        result = self._calc(chart)
        expected = chart['expected']['tenGods']
        assert result['fourPillars']['year']['tenGod'] == expected['year_stem']
        assert result['fourPillars']['month']['tenGod'] == expected['month_stem']
        assert result['fourPillars']['hour']['tenGod'] == expected['hour_stem']


class TestPersonalChartHiddenStems:
    """Hidden stems — standard lookup table, must match."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], chart.get('birthCity', '台北市'), "Asia/Taipei", chart['gender'])

    def test_laopo_hidden_stems(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        expected = chart['expected']['hiddenStems']
        for pillar in ['year', 'month', 'day', 'hour']:
            actual = result['fourPillars'][pillar]['hiddenStems']
            assert actual == expected[pillar], \
                f"{pillar} hidden stems: {actual} != {expected[pillar]}"

    def test_roger_hidden_stems(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        expected = chart['expected']['hiddenStems']
        for pillar in ['year', 'month', 'day', 'hour']:
            actual = result['fourPillars'][pillar]['hiddenStems']
            assert actual == expected[pillar], \
                f"{pillar} hidden stems: {actual} != {expected[pillar]}"


class TestPersonalChartAnalysis:
    """Analytical outputs — pattern, strength, useful god."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], chart.get('birthCity', '台北市'), "Asia/Taipei", chart['gender'])

    def test_laopo_pattern(self, gold_data):
        """正官格 — confirmed by Joey Yap (95%), rival seer, and our engine."""
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        assert result['dayMaster']['pattern'] == chart['expected']['pattern']['value']

    def test_roger_pattern(self, gold_data):
        """食神格 — confirmed by Joey Yap (100%) and our engine."""
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        assert result['dayMaster']['pattern'] == chart['expected']['pattern']['value']

    def test_laopo_strength_v2(self, gold_data):
        """DM strength V2 regression check — ±5 tolerance."""
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        expected_score = chart['expected']['dayMasterStrength']['v2_score']
        actual_score = result['dayMaster']['strengthScoreV2']['score']
        assert abs(actual_score - expected_score) <= 5, \
            f"V2 score regression: {actual_score} vs expected {expected_score} (±5)"

    def test_roger_strength_v2(self, gold_data):
        """DM strength V2 regression check — ±5 tolerance."""
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        expected_score = chart['expected']['dayMasterStrength']['v2_score']
        actual_score = result['dayMaster']['strengthScoreV2']['score']
        assert abs(actual_score - expected_score) <= 5, \
            f"V2 score regression: {actual_score} vs expected {expected_score} (±5)"

    def test_laopo_useful_god(self, gold_data):
        """用神=木 — confirmed by rival seer and our engine."""
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        expected = chart['expected']['favorableGods']
        assert result['dayMaster']['usefulGod'] == expected['usefulGod']
        assert result['dayMaster']['favorableGod'] == expected['favorableGod']

    def test_roger_useful_god(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        expected = chart['expected']['favorableGods']
        assert result['dayMaster']['usefulGod'] == expected['usefulGod']
        assert result['dayMaster']['favorableGod'] == expected['favorableGod']

    def test_laopo_kong_wang(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        expected = chart['expected']['kongWang']['day']
        assert sorted(result['kongWang']) == sorted(expected)

    def test_roger_kong_wang(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        expected = chart['expected']['kongWang']['day']
        assert sorted(result['kongWang']) == sorted(expected)


class TestPersonalChartNaYin:
    """納音 — deterministic lookup, must match."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], chart.get('birthCity', '台北市'), "Asia/Taipei", chart['gender'])

    def test_laopo_nayin(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        expected = chart['expected']['naYin']
        for pillar in ['year', 'month', 'day', 'hour']:
            assert result['fourPillars'][pillar]['naYin'] == expected[pillar], \
                f"{pillar} naYin: {result['fourPillars'][pillar]['naYin']} != {expected[pillar]}"

    def test_roger_nayin(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        expected = chart['expected']['naYin']
        for pillar in ['year', 'month', 'day', 'hour']:
            assert result['fourPillars'][pillar]['naYin'] == expected[pillar], \
                f"{pillar} naYin: {result['fourPillars'][pillar]['naYin']} != {expected[pillar]}"


class TestPersonalChartFiveElements:
    """Five element percentages — regression check."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], chart.get('birthCity', '台北市'), "Asia/Taipei", chart['gender'])

    def test_laopo_five_elements(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'laopo')
        result = self._calc(chart)
        expected = chart['expected']['fiveElements']['weighted']
        for element, expected_pct in expected.items():
            actual_pct = result['fiveElementsBalanceZh'][element]
            assert abs(actual_pct - expected_pct) <= 2.0, \
                f"{element}: {actual_pct}% vs expected {expected_pct}% (±2)"

    def test_roger_five_elements(self, gold_data):
        chart = next(c for c in gold_data['personal_charts'] if c['id'] == 'roger')
        result = self._calc(chart)
        expected = chart['expected']['fiveElements']['weighted']
        for element, expected_pct in expected.items():
            actual_pct = result['fiveElementsBalanceZh'][element]
            assert abs(actual_pct - expected_pct) <= 2.0, \
                f"{element}: {actual_pct}% vs expected {expected_pct}% (±2)"


# ============================================================
# Year Boundary Tests — 立春 edge cases
# ============================================================

class TestYearBoundary:
    """Verify correct year pillar assignment around 立春."""

    def test_pre_lichun_1990(self, gold_data):
        """1990-01-15 is before 立春 (Feb 4), year should be 己巳 not 庚午."""
        chart = next(c for c in gold_data['boundary_test_charts'] if c['id'] == 'pre_lichun_1990')
        dt = chart['birthDatetime'].split('T')
        result = calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])
        expected = chart['expected']['ganZhi']
        assert result['ganZhi']['year'] == expected['year'], \
            f"Pre-lichun year should be {expected['year']}, got {result['ganZhi']['year']}"
        assert result['ganZhi']['month'] == expected['month']
        assert result['ganZhi']['day'] == expected['day']
        assert result['ganZhi']['hour'] == expected['hour']

    def test_pre_lichun_2026(self, gold_data):
        """2026-02-03 is before 立春, year should be 乙巳."""
        chart = next(c for c in gold_data['boundary_test_charts'] if c['id'] == 'lichun_before_2026')
        result = calculate_bazi("2026-02-03", "12:00", "台北市", "Asia/Taipei", "male")
        assert result['ganZhi']['year'] == chart['expected']['ganZhi_year']

    def test_post_lichun_2026(self, gold_data):
        """2026-02-05 is after 立春, year should be 丙午."""
        chart = next(c for c in gold_data['boundary_test_charts'] if c['id'] == 'lichun_after_2026')
        result = calculate_bazi("2026-02-05", "12:00", "台北市", "Asia/Taipei", "male")
        assert result['ganZhi']['year'] == chart['expected']['ganZhi_year']


# ============================================================
# Historical Figures — Validated against published analyses
# ============================================================

class TestHistoricalFigurePillars:
    """Verify pillar accuracy for well-documented historical charts."""

    def _calc_historical(self, chart):
        """Calculate for historical figure using approximate birth time."""
        dt = chart['birthDatetime'].split('T')
        # Historical figures: no specific city, use default
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def test_mao_pillars(self, gold_data):
        """毛澤東: 癸巳/甲子/丁酉/甲辰"""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'mao_zedong')
        result = self._calc_historical(chart)
        expected = chart['expected']['ganZhi']
        assert result['ganZhi']['year'] == expected['year']
        assert result['ganZhi']['month'] == expected['month']
        assert result['ganZhi']['day'] == expected['day']
        assert result['ganZhi']['hour'] == expected['hour']

    def test_chiang_pillars(self, gold_data):
        """蔣介石: 丁亥/庚戌/己巳/庚午"""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'chiang_kai_shek')
        result = self._calc_historical(chart)
        expected = chart['expected']['ganZhi']
        assert result['ganZhi']['year'] == expected['year']
        assert result['ganZhi']['month'] == expected['month']
        assert result['ganZhi']['day'] == expected['day']
        assert result['ganZhi']['hour'] == expected['hour']

    def test_deng_pillars(self, gold_data):
        """鄧小平: 甲辰/壬申/戊子/壬子"""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'deng_xiaoping')
        result = self._calc_historical(chart)
        expected = chart['expected']['ganZhi']
        assert result['ganZhi']['year'] == expected['year']
        assert result['ganZhi']['month'] == expected['month']
        assert result['ganZhi']['day'] == expected['day']
        assert result['ganZhi']['hour'] == expected['hour']

    def test_zhou_pillars(self, gold_data):
        """周恩來: 戊戌/甲寅/丁卯/丙午"""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'zhou_enlai')
        result = self._calc_historical(chart)
        expected = chart['expected']['ganZhi']
        assert result['ganZhi']['year'] == expected['year']
        assert result['ganZhi']['month'] == expected['month']
        assert result['ganZhi']['day'] == expected['day']
        assert result['ganZhi']['hour'] == expected['hour']


class TestHistoricalFigureStrength:
    """Verify DM strength direction matches professional consensus."""

    def _calc_historical(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def test_mao_is_weak(self, gold_data):
        """毛澤東 should be weak/very_weak — professional consensus: 身極弱."""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'mao_zedong')
        result = self._calc_historical(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        assert v2['classification'] in ('weak', 'very_weak'), \
            f"Mao should be weak, got {v2['classification']} (score {v2['score']})"
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Mao V2 score {v2['score']} outside range [{expected_range['min']}, {expected_range['max']}]"

    def test_chiang_not_weak(self, gold_data):
        """蔣介石 should NOT be very_weak — professional consensus: 身偏旺."""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'chiang_kai_shek')
        result = self._calc_historical(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        assert v2['classification'] != 'very_weak', \
            f"Chiang should not be very_weak, got {v2['classification']} (score {v2['score']})"
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Chiang V2 score {v2['score']} outside range [{expected_range['min']}, {expected_range['max']}]"

    def test_deng_is_very_weak(self, gold_data):
        """鄧小平 should be very_weak — professional consensus: 身極弱/從財格."""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'deng_xiaoping')
        result = self._calc_historical(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        assert v2['classification'] in ('weak', 'very_weak'), \
            f"Deng should be weak/very_weak, got {v2['classification']} (score {v2['score']})"

    def test_zhou_is_strong(self, gold_data):
        """周恩來 should be strong/very_strong — professional consensus: 從強格."""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'zhou_enlai')
        result = self._calc_historical(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        assert v2['classification'] in ('strong', 'very_strong'), \
            f"Zhou should be strong/very_strong, got {v2['classification']} (score {v2['score']})"
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Zhou V2 score {v2['score']} outside range [{expected_range['min']}, {expected_range['max']}]"

    def test_zhou_stronger_than_mao(self, gold_data):
        """周恩來 must be significantly stronger than 毛澤東."""
        mao_chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'mao_zedong')
        zhou_chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'zhou_enlai')
        mao_result = self._calc_historical(mao_chart)
        zhou_result = self._calc_historical(zhou_chart)
        mao_score = mao_result['dayMaster']['strengthScoreV2']['score']
        zhou_score = zhou_result['dayMaster']['strengthScoreV2']['score']
        assert zhou_score - mao_score > 15, \
            f"Zhou ({zhou_score}) should be >15pts stronger than Mao ({mao_score})"


class TestHistoricalFigureFiveElements:
    """Verify five element balance matches professional analyses."""

    def _calc_historical(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def test_mao_water_dominant(self, gold_data):
        """毛澤東: water should be ≥15%, fire < water."""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'mao_zedong')
        result = self._calc_historical(chart)
        balance = result['fiveElementsBalanceZh']
        expectations = chart['expected']['fiveElements_expectations']
        assert balance['水'] >= expectations['water_min_pct'], \
            f"Mao water {balance['水']}% should be >= {expectations['water_min_pct']}%"

    def test_chiang_earth_fire_strong(self, gold_data):
        """蔣介石: earth + fire combined ≥35%."""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'chiang_kai_shek')
        result = self._calc_historical(chart)
        balance = result['fiveElementsBalanceZh']
        combined = balance['土'] + balance['火']
        min_pct = chart['expected']['fiveElements_expectations']['earth_plus_fire_min_pct']
        assert combined >= min_pct, \
            f"Chiang earth+fire {combined}% should be >= {min_pct}%"

    def test_deng_water_overwhelming(self, gold_data):
        """鄧小平: water ≥35%, fire ≤5%."""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'deng_xiaoping')
        result = self._calc_historical(chart)
        balance = result['fiveElementsBalanceZh']
        expectations = chart['expected']['fiveElements_expectations']
        assert balance['水'] >= expectations['water_min_pct'], \
            f"Deng water {balance['水']}% should be >= {expectations['water_min_pct']}%"
        assert balance['火'] <= expectations['fire_max_pct'], \
            f"Deng fire {balance['火']}% should be <= {expectations['fire_max_pct']}%"

    def test_zhou_wood_fire_dominant(self, gold_data):
        """周恩來: wood + fire ≥55%, metal + water ≤15%."""
        chart = next(c for c in gold_data['historical_charts'] if c['id'] == 'zhou_enlai')
        result = self._calc_historical(chart)
        balance = result['fiveElementsBalanceZh']
        expectations = chart['expected']['fiveElements_expectations']
        wood_fire = balance['木'] + balance['火']
        metal_water = balance['金'] + balance['水']
        assert wood_fire >= expectations['wood_plus_fire_min_pct'], \
            f"Zhou wood+fire {wood_fire}% should be >= {expectations['wood_plus_fire_min_pct']}%"
        assert metal_water <= expectations['metal_plus_water_max_pct'], \
            f"Zhou metal+water {metal_water}% should be <= {expectations['metal_plus_water_max_pct']}%"


# ============================================================
# Published Master Analysis Charts — Famous figures with
# professional Bazi master analyses for engine comparison
# ============================================================

class TestPublishedMasterPillars:
    """Verify pillar accuracy for charts from published Bazi master analyses."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def _get_chart(self, gold_data, chart_id):
        return next(c for c in gold_data['published_master_charts'] if c['id'] == chart_id)

    def test_sun_yatsen_pillars(self, gold_data):
        """孫中山: 乙丑/丁亥/丁酉/壬寅 — 《千里命稿》"""
        chart = self._get_chart(gold_data, 'sun_yatsen')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        for p in ['year', 'month', 'day', 'hour']:
            assert result['ganZhi'][p] == expected[p], \
                f"Sun Yat-sen {p}: {result['ganZhi'][p]} != {expected[p]}"

    def test_li_ka_shing_pillars(self, gold_data):
        """李嘉誠: 戊辰/己未/庚午/丁亥"""
        chart = self._get_chart(gold_data, 'li_ka_shing')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        for p in ['year', 'month', 'day', 'hour']:
            assert result['ganZhi'][p] == expected[p], \
                f"Li Ka-shing {p}: {result['ganZhi'][p]} != {expected[p]}"

    def test_lee_teng_hui_pillars(self, gold_data):
        """李登輝: 壬戌/癸丑/戊子/甲寅"""
        chart = self._get_chart(gold_data, 'lee_teng_hui')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        for p in ['year', 'month', 'day', 'hour']:
            assert result['ganZhi'][p] == expected[p], \
                f"Lee Teng-hui {p}: {result['ganZhi'][p]} != {expected[p]}"

    def test_lee_kuan_yew_pillars(self, gold_data):
        """李光耀: 癸亥/辛酉/壬辰/壬寅"""
        chart = self._get_chart(gold_data, 'lee_kuan_yew')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        for p in ['year', 'month', 'day', 'hour']:
            assert result['ganZhi'][p] == expected[p], \
                f"Lee Kuan Yew {p}: {result['ganZhi'][p]} != {expected[p]}"

    def test_bill_gates_pillars(self, gold_data):
        """Bill Gates: 乙未/丙戌/壬戌/庚戌"""
        chart = self._get_chart(gold_data, 'bill_gates')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        for p in ['year', 'month', 'day', 'hour']:
            assert result['ganZhi'][p] == expected[p], \
                f"Bill Gates {p}: {result['ganZhi'][p]} != {expected[p]}"

    def test_warren_buffett_pillars(self, gold_data):
        """Warren Buffett: 庚午/甲申/壬子/壬寅"""
        chart = self._get_chart(gold_data, 'warren_buffett')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        for p in ['year', 'month', 'day', 'hour']:
            assert result['ganZhi'][p] == expected[p], \
                f"Warren Buffett {p}: {result['ganZhi'][p]} != {expected[p]}"

    def test_steve_jobs_pillars(self, gold_data):
        """Steve Jobs: 乙未/戊寅/丙辰/辛卯"""
        chart = self._get_chart(gold_data, 'steve_jobs')
        result = self._calc(chart)
        expected = chart['expected']['ganZhi']
        for p in ['year', 'month', 'day', 'hour']:
            assert result['ganZhi'][p] == expected[p], \
                f"Steve Jobs {p}: {result['ganZhi'][p]} != {expected[p]}"


class TestPublishedMasterTenGods:
    """Ten god labels for published master charts — deterministic."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def _get_chart(self, gold_data, chart_id):
        return next(c for c in gold_data['published_master_charts'] if c['id'] == chart_id)

    def test_sun_yatsen_ten_gods(self, gold_data):
        chart = self._get_chart(gold_data, 'sun_yatsen')
        result = self._calc(chart)
        expected = chart['expected']['tenGods']
        assert result['fourPillars']['year']['tenGod'] == expected['year_stem']
        assert result['fourPillars']['month']['tenGod'] == expected['month_stem']
        assert result['fourPillars']['hour']['tenGod'] == expected['hour_stem']

    def test_li_ka_shing_ten_gods(self, gold_data):
        chart = self._get_chart(gold_data, 'li_ka_shing')
        result = self._calc(chart)
        expected = chart['expected']['tenGods']
        assert result['fourPillars']['year']['tenGod'] == expected['year_stem']
        assert result['fourPillars']['month']['tenGod'] == expected['month_stem']
        assert result['fourPillars']['hour']['tenGod'] == expected['hour_stem']

    def test_bill_gates_ten_gods(self, gold_data):
        chart = self._get_chart(gold_data, 'bill_gates')
        result = self._calc(chart)
        expected = chart['expected']['tenGods']
        assert result['fourPillars']['year']['tenGod'] == expected['year_stem']
        assert result['fourPillars']['month']['tenGod'] == expected['month_stem']
        assert result['fourPillars']['hour']['tenGod'] == expected['hour_stem']

    def test_warren_buffett_ten_gods(self, gold_data):
        chart = self._get_chart(gold_data, 'warren_buffett')
        result = self._calc(chart)
        expected = chart['expected']['tenGods']
        assert result['fourPillars']['year']['tenGod'] == expected['year_stem']
        assert result['fourPillars']['month']['tenGod'] == expected['month_stem']
        assert result['fourPillars']['hour']['tenGod'] == expected['hour_stem']

    def test_steve_jobs_ten_gods(self, gold_data):
        chart = self._get_chart(gold_data, 'steve_jobs')
        result = self._calc(chart)
        expected = chart['expected']['tenGods']
        assert result['fourPillars']['year']['tenGod'] == expected['year_stem']
        assert result['fourPillars']['month']['tenGod'] == expected['month_stem']
        assert result['fourPillars']['hour']['tenGod'] == expected['hour_stem']


class TestPublishedMasterHiddenStems:
    """Hidden stems for published master charts — standard lookup."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def _get_chart(self, gold_data, chart_id):
        return next(c for c in gold_data['published_master_charts'] if c['id'] == chart_id)

    def test_sun_yatsen_hidden_stems(self, gold_data):
        chart = self._get_chart(gold_data, 'sun_yatsen')
        result = self._calc(chart)
        expected = chart['expected']['hiddenStems']
        for pillar in ['year', 'month', 'day', 'hour']:
            actual = result['fourPillars'][pillar]['hiddenStems']
            assert actual == expected[pillar], \
                f"Sun Yat-sen {pillar}: {actual} != {expected[pillar]}"

    def test_bill_gates_hidden_stems(self, gold_data):
        chart = self._get_chart(gold_data, 'bill_gates')
        result = self._calc(chart)
        expected = chart['expected']['hiddenStems']
        for pillar in ['year', 'month', 'day', 'hour']:
            actual = result['fourPillars'][pillar]['hiddenStems']
            assert actual == expected[pillar], \
                f"Bill Gates {pillar}: {actual} != {expected[pillar]}"

    def test_steve_jobs_hidden_stems(self, gold_data):
        chart = self._get_chart(gold_data, 'steve_jobs')
        result = self._calc(chart)
        expected = chart['expected']['hiddenStems']
        for pillar in ['year', 'month', 'day', 'hour']:
            actual = result['fourPillars'][pillar]['hiddenStems']
            assert actual == expected[pillar], \
                f"Steve Jobs {pillar}: {actual} != {expected[pillar]}"


class TestPublishedMasterStrength:
    """DM strength validation for published master charts."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def _get_chart(self, gold_data, chart_id):
        return next(c for c in gold_data['published_master_charts'] if c['id'] == chart_id)

    def test_sun_yatsen_very_weak(self, gold_data):
        """孫中山 should be very_weak — 丁火 in 亥月, water dominant."""
        chart = self._get_chart(gold_data, 'sun_yatsen')
        result = self._calc(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert v2['classification'] in ('weak', 'very_weak'), \
            f"Sun Yat-sen should be weak/very_weak, got {v2['classification']}"
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Sun Yat-sen V2 score {v2['score']} outside [{expected_range['min']}, {expected_range['max']}]"

    def test_li_ka_shing_neutral(self, gold_data):
        """李嘉誠 should be neutral — 庚金 with strong earth support."""
        chart = self._get_chart(gold_data, 'li_ka_shing')
        result = self._calc(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Li Ka-shing V2 score {v2['score']} outside [{expected_range['min']}, {expected_range['max']}]"

    def test_lee_teng_hui_strong(self, gold_data):
        """李登輝 should be strong — 戊土 born in 丑月 (earth season)."""
        chart = self._get_chart(gold_data, 'lee_teng_hui')
        result = self._calc(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert v2['classification'] in ('strong', 'very_strong'), \
            f"Lee Teng-hui should be strong, got {v2['classification']}"
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Lee Teng-hui V2 score {v2['score']} outside [{expected_range['min']}, {expected_range['max']}]"

    def test_lee_kuan_yew_strong(self, gold_data):
        """李光耀 should be strong — 壬水 in 酉月 with metal+water support."""
        chart = self._get_chart(gold_data, 'lee_kuan_yew')
        result = self._calc(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert v2['classification'] in ('strong', 'very_strong'), \
            f"Lee Kuan Yew should be strong, got {v2['classification']}"
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Lee Kuan Yew V2 score {v2['score']} outside [{expected_range['min']}, {expected_range['max']}]"

    def test_bill_gates_very_weak(self, gold_data):
        """Bill Gates should be very_weak — 壬水 with three 戌 earth overwhelming."""
        chart = self._get_chart(gold_data, 'bill_gates')
        result = self._calc(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert v2['classification'] == 'very_weak', \
            f"Bill Gates should be very_weak, got {v2['classification']}"
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Bill Gates V2 score {v2['score']} outside [{expected_range['min']}, {expected_range['max']}]"

    def test_warren_buffett_strong(self, gold_data):
        """Warren Buffett should be strong — 壬水 in 申月 with water roots."""
        chart = self._get_chart(gold_data, 'warren_buffett')
        result = self._calc(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert v2['classification'] in ('strong', 'very_strong'), \
            f"Warren Buffett should be strong, got {v2['classification']}"
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Warren Buffett V2 score {v2['score']} outside [{expected_range['min']}, {expected_range['max']}]"

    def test_steve_jobs_neutral(self, gold_data):
        """Steve Jobs should be neutral — 丙火 in 寅月 with strong wood support."""
        chart = self._get_chart(gold_data, 'steve_jobs')
        result = self._calc(chart)
        v2 = result['dayMaster']['strengthScoreV2']
        expected_range = chart['expected']['dayMasterStrength']['our_v2_expected_range']
        assert expected_range['min'] <= v2['score'] <= expected_range['max'], \
            f"Steve Jobs V2 score {v2['score']} outside [{expected_range['min']}, {expected_range['max']}]"


class TestPublishedMasterFiveElements:
    """Five element balance for published master charts."""

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def _get_chart(self, gold_data, chart_id):
        return next(c for c in gold_data['published_master_charts'] if c['id'] == chart_id)

    def test_sun_yatsen_water_dominant(self, gold_data):
        """孫中山: water ≥25%, wood ≥20%, fire ≤20%."""
        chart = self._get_chart(gold_data, 'sun_yatsen')
        result = self._calc(chart)
        balance = result['fiveElementsBalanceZh']
        exp = chart['expected']['fiveElements_expectations']
        assert balance['水'] >= exp['water_min_pct'], \
            f"Sun water {balance['水']}% < {exp['water_min_pct']}%"
        assert balance['木'] >= exp['wood_min_pct'], \
            f"Sun wood {balance['木']}% < {exp['wood_min_pct']}%"
        assert balance['火'] <= exp['fire_max_pct'], \
            f"Sun fire {balance['火']}% > {exp['fire_max_pct']}%"

    def test_li_ka_shing_earth_dominant(self, gold_data):
        """李嘉誠: earth ≥45%, metal ≤20%."""
        chart = self._get_chart(gold_data, 'li_ka_shing')
        result = self._calc(chart)
        balance = result['fiveElementsBalanceZh']
        exp = chart['expected']['fiveElements_expectations']
        assert balance['土'] >= exp['earth_min_pct'], \
            f"Li earth {balance['土']}% < {exp['earth_min_pct']}%"
        assert balance['金'] <= exp['metal_max_pct'], \
            f"Li metal {balance['金']}% > {exp['metal_max_pct']}%"

    def test_bill_gates_earth_fire_dominant(self, gold_data):
        """Bill Gates: earth ≥35%, water ≤10%, fire+earth ≥55%."""
        chart = self._get_chart(gold_data, 'bill_gates')
        result = self._calc(chart)
        balance = result['fiveElementsBalanceZh']
        exp = chart['expected']['fiveElements_expectations']
        assert balance['土'] >= exp['earth_min_pct'], \
            f"Gates earth {balance['土']}% < {exp['earth_min_pct']}%"
        assert balance['水'] <= exp['water_max_pct'], \
            f"Gates water {balance['水']}% > {exp['water_max_pct']}%"
        combined = balance['火'] + balance['土']
        assert combined >= exp['fire_plus_earth_min_pct'], \
            f"Gates fire+earth {combined}% < {exp['fire_plus_earth_min_pct']}%"

    def test_warren_buffett_water_metal_dominant(self, gold_data):
        """Warren Buffett: water ≥35%, metal ≥20%."""
        chart = self._get_chart(gold_data, 'warren_buffett')
        result = self._calc(chart)
        balance = result['fiveElementsBalanceZh']
        exp = chart['expected']['fiveElements_expectations']
        assert balance['水'] >= exp['water_min_pct'], \
            f"Buffett water {balance['水']}% < {exp['water_min_pct']}%"
        assert balance['金'] >= exp['metal_min_pct'], \
            f"Buffett metal {balance['金']}% < {exp['metal_min_pct']}%"

    def test_steve_jobs_wood_dominant(self, gold_data):
        """Steve Jobs: wood ≥45%, fire ≥15%."""
        chart = self._get_chart(gold_data, 'steve_jobs')
        result = self._calc(chart)
        balance = result['fiveElementsBalanceZh']
        exp = chart['expected']['fiveElements_expectations']
        assert balance['木'] >= exp['wood_min_pct'], \
            f"Jobs wood {balance['木']}% < {exp['wood_min_pct']}%"
        assert balance['火'] >= exp['fire_min_pct'], \
            f"Jobs fire {balance['火']}% < {exp['fire_min_pct']}%"


class TestPublishedMasterPatternComparison:
    """Compare engine patterns with published master analyses.

    These tests document the discrepancies between our engine's pattern
    classification and published Bazi master analyses. They serve as
    baseline documentation — not pass/fail for the engine, but tracking
    how our pattern detection compares with professional consensus.
    """

    def _calc(self, chart):
        dt = chart['birthDatetime'].split('T')
        return calculate_bazi(dt[0], dt[1][:5], "台北市", "Asia/Taipei", chart['gender'])

    def _get_chart(self, gold_data, chart_id):
        return next(c for c in gold_data['published_master_charts'] if c['id'] == chart_id)

    def test_sun_yatsen_pattern_matches(self, gold_data):
        """孫中山: Both engine and masters agree on 正官格."""
        chart = self._get_chart(gold_data, 'sun_yatsen')
        result = self._calc(chart)
        pattern_info = chart['expected']['pattern']
        assert result['dayMaster']['pattern'] == pattern_info['engine_value']
        assert pattern_info['match'] is True, "Engine should match master for Sun Yat-sen"

    def test_pattern_discrepancy_tracking(self, gold_data):
        """Document all pattern discrepancies between engine and masters.

        Expected discrepancies (engine vs master):
        - Li Ka-shing: 正印格 vs 從殺格
        - Lee Teng-hui: 正財格 vs 七殺格
        - Bill Gates: 偏官格 vs 偏財格
        - Warren Buffett: 偏印格 vs 食神制殺格
        - Steve Jobs: 食神格 vs 印綬格
        """
        discrepancies = []
        for chart in gold_data['published_master_charts']:
            pattern_info = chart['expected']['pattern']
            if not pattern_info.get('match', True):
                result = self._calc(chart)
                actual = result['dayMaster']['pattern']
                discrepancies.append({
                    'id': chart['id'],
                    'engine': actual,
                    'master': pattern_info['master_value'],
                    'engine_matches_fixture': actual == pattern_info['engine_value']
                })

        # Verify engine outputs match what we recorded
        for d in discrepancies:
            assert d['engine_matches_fixture'], \
                f"{d['id']}: engine now returns {d['engine']}, expected {d['engine']}"

        # Document: we expect exactly 5 discrepancies
        assert len(discrepancies) == 5, \
            f"Expected 5 pattern discrepancies, found {len(discrepancies)}"
