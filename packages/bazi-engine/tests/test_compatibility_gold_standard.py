"""
Gold Standard Validation Tests — Celebrity Couple Compatibility

These tests validate our 8-dimension compatibility engine against published
Bazi master analyses of real celebrity couples. The birth dates are publicly
known and the Bazi pillars have been verified against multiple master analyses.

Sources:
- 科技紫微網 (Click108), Sina Blog masters (梦死醉生命理, 董易奇, 王水清, 陈易龙)
- 《子平真詮》《三命通會》《滴天髓》traditional references

Key principle: Our engine should produce scores that DIRECTIONALLY align with
master verdicts and real-world outcomes. We test:
1. Pillar accuracy (our engine matches published pillars)
2. Interaction detection (天干合, 六沖, etc. correctly identified)
3. Score ranking (happy couples > divorced couples)
4. Dimension-level signals match master findings
"""

import pytest
from app.calculator import calculate_bazi, calculate_bazi_compatibility
from app.compatibility_enhanced import (
    detect_tianhe_dihe,
    score_day_stem_relationship,
    score_spouse_palace,
)


# ============================================================
# Helper
# ============================================================

def make_birth(date, gender, time='12:00', city='Taipei', tz='Asia/Taipei'):
    return {
        'birth_date': date,
        'birth_time': time,
        'birth_city': city,
        'birth_timezone': tz,
        'gender': gender,
    }


def get_compat(date_a, gender_a, date_b, gender_b, comp_type='romance'):
    """Run full compatibility pipeline for a couple."""
    result = calculate_bazi_compatibility(
        make_birth(date_a, gender_a),
        make_birth(date_b, gender_b),
        comp_type,
    )
    return result


def get_pillars(date, gender):
    """Get four pillars for a person."""
    chart = calculate_bazi(date, '12:00', 'Taipei', 'Asia/Taipei', gender)
    fp = chart['fourPillars']
    return {p: f"{fp[p]['stem']}{fp[p]['branch']}" for p in ['year', 'month', 'day', 'hour']}


# ============================================================
# Celebrity Birth Data (publicly known, verified)
# ============================================================

# Hour pillars use noon placeholder since actual hours are disputed.
# Only year/month/day pillars are verified against published analyses.

CELEBRITIES = {
    'jay_chou': ('1979-01-18', 'male'),
    'hannah_quinlivan': ('1993-08-12', 'female'),
    'big_s': ('1976-10-06', 'female'),
    'wang_xiaofei': ('1981-06-27', 'male'),
    'nicholas_tse': ('1980-08-29', 'male'),
    'cecilia_cheung': ('1980-05-24', 'female'),
    'faye_wong': ('1969-08-08', 'female'),
    'huang_xiaoming': ('1977-11-13', 'male'),
    'angelababy': ('1989-02-28', 'female'),
}


# ============================================================
# Test 1: Pillar Verification
# Verify our engine produces the same pillars as published analyses
# ============================================================

class TestPillarVerification:
    """Verify computed pillars match all published Bazi master analyses."""

    def test_jay_chou_pillars(self):
        """Jay Chou (周杰倫) — verified by 梦死醉生命理, 董易奇, 盲派命理."""
        p = get_pillars('1979-01-18', 'male')
        assert p['year'] == '戊午'
        assert p['month'] == '乙丑'
        assert p['day'] == '乙酉'

    def test_hannah_quinlivan_pillars(self):
        """Hannah Quinlivan (昆凌) — verified by multiple Sina Blog analyses."""
        p = get_pillars('1993-08-12', 'female')
        assert p['year'] == '癸酉'
        assert p['month'] == '庚申'
        assert p['day'] == '乙丑'

    def test_big_s_pillars(self):
        """Big S (大S / 徐熙媛) — verified by 王水清 and Sohu."""
        p = get_pillars('1976-10-06', 'female')
        assert p['year'] == '丙辰'
        assert p['month'] == '丁酉'
        assert p['day'] == '辛卯'

    def test_wang_xiaofei_pillars(self):
        """Wang Xiaofei (汪小菲) — verified by 王水清."""
        p = get_pillars('1981-06-27', 'male')
        assert p['year'] == '辛酉'
        assert p['month'] == '甲午'
        assert p['day'] == '丙子'

    def test_nicholas_tse_pillars(self):
        """Nicholas Tse (謝霆鋒) — verified by 梦死醉生命理, 董焱."""
        p = get_pillars('1980-08-29', 'male')
        assert p['year'] == '庚申'
        assert p['month'] == '甲申'
        assert p['day'] == '甲戌'

    def test_cecilia_cheung_pillars(self):
        """Cecilia Cheung (張柏芝) — verified by 董焱, Sohu."""
        p = get_pillars('1980-05-24', 'female')
        assert p['year'] == '庚申'
        assert p['month'] == '辛巳'
        assert p['day'] == '丁酉'

    def test_faye_wong_pillars(self):
        """Faye Wong (王菲) — verified by 163.com, 童子 Sina Blog."""
        p = get_pillars('1969-08-08', 'female')
        assert p['year'] == '己酉'
        assert p['month'] == '壬申'
        assert p['day'] == '乙卯'

    def test_huang_xiaoming_pillars(self):
        """Huang Xiaoming (黃曉明) — verified by 陈易龙."""
        p = get_pillars('1977-11-13', 'male')
        assert p['year'] == '丁巳'
        assert p['month'] == '辛亥'
        assert p['day'] == '甲戌'

    def test_angelababy_pillars(self):
        """Angelababy (楊穎) — verified by 陈易龙."""
        p = get_pillars('1989-02-28', 'female')
        assert p['year'] == '己巳'
        assert p['month'] == '丙寅'
        assert p['day'] == '己未'


# ============================================================
# Test 2: Interaction Detection
# Verify specific cross-chart interactions that masters identified
# ============================================================

class TestInteractionDetection:
    """Verify engine detects the same interactions as published analyses."""

    def test_jay_chou_hannah_same_day_master(self):
        """Masters noted both share 乙木 Day Master — strong connection."""
        p_jay = get_pillars('1979-01-18', 'male')
        p_hannah = get_pillars('1993-08-12', 'female')
        assert p_jay['day'][0] == '乙'
        assert p_hannah['day'][0] == '乙'
        # Same stem = 比和 (same element)

    def test_jay_chou_hannah_year_stem_wuhe(self):
        """Masters: Year pillar 戊癸合 (Heavenly Stem Combination).
        戊 (Jay's year stem) + 癸 (Hannah's year stem) form 天干五合."""
        p_jay = get_pillars('1979-01-18', 'male')
        p_hannah = get_pillars('1993-08-12', 'female')
        assert p_jay['year'][0] == '戊'
        assert p_hannah['year'][0] == '癸'
        # 戊+癸 is one of the 5 天干合 pairs

    def test_big_s_wang_year_pillar_tianhe_dihe(self):
        """Masters: Year pillar 丙辛合 + 辰酉合 = 天合地合.
        Big S year = 丙辰, Wang year = 辛酉.
        This is NOT day pillar 天合地合 (which our engine checks),
        but YEAR pillar 天合地合 — a significant finding masters highlighted."""
        p_bs = get_pillars('1976-10-06', 'female')
        p_wx = get_pillars('1981-06-27', 'male')
        # Year pillar: 丙辰 vs 辛酉
        assert p_bs['year'] == '丙辰'
        assert p_wx['year'] == '辛酉'
        # 丙+辛 = 天干五合, 辰+酉 = 地支六合
        # Our Dimension 6 (全盤互動) should detect this cross-chart interaction
        result = get_compat('1976-10-06', 'female', '1981-06-27', 'male')
        enhanced = result['compatibilityEnhanced']
        # The year pillar interaction should contribute positively to fullPillarInteraction
        dim6 = enhanced['dimensionScores']['fullPillarInteraction']
        assert dim6['rawScore'] > 30, "Year pillar 天合地合 should boost full pillar score"

    def test_big_s_wang_day_stem_bingxin_he(self):
        """Masters: Day stems 辛 (Big S) + 丙 (Wang) = 丙辛合 (威制之合)."""
        result = get_compat('1976-10-06', 'female', '1981-06-27', 'male')
        enhanced = result['compatibilityEnhanced']
        special = enhanced.get('specialFindings', {})
        # Should detect 丙辛合 combination
        assert special.get('combinationName') == '威制之合'

    def test_tse_cheung_same_year_pillar(self):
        """Masters: Both born 庚申 year — same foundational energy."""
        p_tse = get_pillars('1980-08-29', 'male')
        p_cheung = get_pillars('1980-05-24', 'female')
        assert p_tse['year'] == '庚申'
        assert p_cheung['year'] == '庚申'

    def test_tse_cheung_day_branch_has_negative_interaction(self):
        """Masters: 甲戌 (Tse) vs 丁酉 (Cheung) — Metal clashes with Wood.
        Day stems: 甲(Wood) vs 丁(Fire) = 相生 (not clash).
        Day branches: 戌 vs 酉 = 六害 (hidden harm).
        The overall dynamic with their Metal-heavy charts is negative."""
        result = get_compat('1980-08-29', 'male', '1980-05-24', 'female')
        enhanced = result['compatibilityEnhanced']
        # Spouse palace score should be below neutral
        dim3 = enhanced['dimensionScores']['spousePalace']
        assert dim3['rawScore'] < 50, "戌-酉 六害 should give below-neutral spouse palace"

    def test_huang_angelababy_day_stem_jiaji_he(self):
        """Masters: Day stems 甲 (Huang) + 己 (Angelababy) = 甲己合 (中正之合).
        But marriage star as 忌神 means structural weakness."""
        result = get_compat('1977-11-13', 'male', '1989-02-28', 'female')
        enhanced = result['compatibilityEnhanced']
        special = enhanced.get('specialFindings', {})
        assert special.get('combinationName') == '中正之合'

    def test_huang_xiaoming_year_month_clash(self):
        """Masters: Huang has 丁巳(year) vs 辛亥(month) = 天克地冲 within own chart.
        丁+辛 stem clash + 巳+亥 branch clash. Indicates inherent marriage instability."""
        p = get_pillars('1977-11-13', 'male')
        assert p['year'] == '丁巳'
        assert p['month'] == '辛亥'
        # 丁 vs 辛: Fire克Metal = 天干沖
        # 巳 vs 亥: 六沖 pair
        # This is within-chart instability, visible in individual analysis


# ============================================================
# Test 3: Score Ranking Validation
# Happy couples should score higher than divorced couples
# ============================================================

class TestScoreRanking:
    """Validate that our scores align with real-world outcomes."""

    @pytest.fixture(scope='class')
    def all_scores(self):
        """Calculate compatibility for all 5 couples."""
        couples = {
            'jay_hannah': ('1979-01-18', 'male', '1993-08-12', 'female'),
            'bigs_wang': ('1976-10-06', 'female', '1981-06-27', 'male'),
            'tse_cheung': ('1980-08-29', 'male', '1980-05-24', 'female'),
            'wong_tse': ('1969-08-08', 'female', '1980-08-29', 'male'),
            'huang_angelababy': ('1977-11-13', 'male', '1989-02-28', 'female'),
        }
        scores = {}
        for key, (d1, g1, d2, g2) in couples.items():
            r = get_compat(d1, g1, d2, g2)
            scores[key] = r['compatibilityEnhanced']['adjustedScore']
        return scores

    def test_happy_couple_scores_highest(self, all_scores):
        """Jay Chou + Hannah (happy marriage, 3 kids) should be the highest score.
        Masters: 'Extremely compatible', 'heaven-ordained pair'."""
        assert all_scores['jay_hannah'] == max(all_scores.values()), \
            f"Jay+Hannah ({all_scores['jay_hannah']}) should be highest: {all_scores}"

    def test_divorced_couples_score_low(self, all_scores):
        """All divorced couples should score below 55.
        Masters: structural problems predicted for all three."""
        divorced = ['bigs_wang', 'tse_cheung', 'huang_angelababy']
        for couple in divorced:
            assert all_scores[couple] <= 55, \
                f"{couple} ({all_scores[couple]}) should be ≤55: {all_scores}"

    def test_happy_beats_divorced(self, all_scores):
        """Jay+Hannah (happy) > all divorced couples."""
        divorced = ['bigs_wang', 'tse_cheung', 'huang_angelababy']
        for couple in divorced:
            assert all_scores['jay_hannah'] > all_scores[couple], \
                f"Jay+Hannah ({all_scores['jay_hannah']}) should beat {couple} ({all_scores[couple]})"

    def test_bigs_wang_palace_clashes_severe(self, all_scores):
        """Big S + Wang should score very low due to within-chart palace instability.
        Masters: 'Palace clashes fatal' — both have day branch clashed within own chart,
        both have 陰陽差錯日."""
        assert all_scores['bigs_wang'] < 45, \
            f"Big S+Wang ({all_scores['bigs_wang']}) should be <45 due to palace clashes: {all_scores}"

    def test_score_spread_meaningful(self, all_scores):
        """Score range should span at least 20 points across 5 couples."""
        spread = max(all_scores.values()) - min(all_scores.values())
        assert spread >= 20, f"Score spread only {spread}: {all_scores}"

    def test_all_scores_in_valid_range(self, all_scores):
        """All scores should be within [5, 99]."""
        for key, score in all_scores.items():
            assert 5 <= score <= 99, f"{key} score {score} out of range"


# ============================================================
# Test 4: Master Finding Alignment
# Specific dimension scores should reflect master's key observations
# ============================================================

class TestMasterFindingAlignment:
    """Test that dimension-level scores align with master findings."""

    def test_jay_hannah_yongshen_strong(self):
        """Masters: Both share same 用神 system → strong 用神互補.
        Our engine: identical god assignments → diagonal sum = 72.7 (high)."""
        r = get_compat('1979-01-18', 'male', '1993-08-12', 'female')
        dim1 = r['compatibilityEnhanced']['dimensionScores']['yongshenComplementarity']
        assert dim1['rawScore'] >= 60, \
            f"Jay+Hannah yongshen should be high (same gods): {dim1['rawScore']}"

    def test_tse_cheung_yongshen_conflict(self):
        """Masters: Metal-wood war, fundamental conflict.
        用神互補 should be low."""
        r = get_compat('1980-08-29', 'male', '1980-05-24', 'female')
        dim1 = r['compatibilityEnhanced']['dimensionScores']['yongshenComplementarity']
        # yongshen conflict detected by knockout
        knockouts = r['compatibilityEnhanced'].get('knockoutConditions', [])
        conflict_kos = [ko for ko in knockouts if ko['type'] == 'yongshen_conflict']
        assert len(conflict_kos) > 0, "Should detect yongshen conflict for Tse+Cheung"

    def test_big_s_wang_ten_god_attraction(self):
        """Masters: Big S's 辛 is Wang's 正財 (wife star); Wang's 丙 is Big S's 正官 (husband star).
        Mutual spouse star activation → high ten god cross score."""
        r = get_compat('1976-10-06', 'female', '1981-06-27', 'male')
        dim4 = r['compatibilityEnhanced']['dimensionScores']['tenGodCross']
        assert dim4['rawScore'] >= 70, \
            f"Big S+Wang ten god cross should be high (mutual spouse stars): {dim4['rawScore']}"

    def test_huang_angelababy_stem_combination_quality(self):
        """Masters: 甲己合 is 中正之合 (highest quality, score 95).
        But overall marriage still failed — other dimensions dragged down."""
        r = get_compat('1977-11-13', 'male', '1989-02-28', 'female')
        dim2 = r['compatibilityEnhanced']['dimensionScores']['dayStemRelationship']
        assert dim2['rawScore'] >= 90, \
            f"甲己合 should score ≥90 (中正之合): {dim2['rawScore']}"

    def test_tse_cheung_spouse_palace_negative(self):
        """Masters: Marriage Palace problems (戌-酉 harm).
        Spouse palace dimension should be below neutral."""
        r = get_compat('1980-08-29', 'male', '1980-05-24', 'female')
        dim3 = r['compatibilityEnhanced']['dimensionScores']['spousePalace']
        assert dim3['rawScore'] < 50, \
            f"Tse+Cheung spouse palace should be negative: {dim3['rawScore']}"

    def test_jay_hannah_element_complementarity(self):
        """Jay: strong earth/wood, weak metal/water.
        Hannah: strong metal/water, weak wood/fire.
        Directional complementarity should be significant."""
        r = get_compat('1979-01-18', 'male', '1993-08-12', 'female')
        dim5 = r['compatibilityEnhanced']['dimensionScores']['elementComplementarity']
        assert dim5['rawScore'] > 20, \
            f"Jay+Hannah should have meaningful element complementarity: {dim5['rawScore']}"

    def test_wong_tse_spouse_palace_positive(self):
        """Faye Wong day branch 卯, Tse day branch 戌.
        卯+戌 = 六合 (one of the six harmonies) → high spouse palace score."""
        r = get_compat('1969-08-08', 'female', '1980-08-29', 'male')
        dim3 = r['compatibilityEnhanced']['dimensionScores']['spousePalace']
        assert dim3['rawScore'] >= 70, \
            f"Wong+Tse spouse palace should be high (卯戌六合): {dim3['rawScore']}"


# ============================================================
# Test 5: Pre-Analysis Quality for Celebrity Couples
# ============================================================

class TestPreAnalysisQuality:
    """Verify pre-analysis provides meaningful data for AI narration."""

    @pytest.fixture
    def jay_hannah_result(self):
        return get_compat('1979-01-18', 'male', '1993-08-12', 'female')

    @pytest.fixture
    def tse_cheung_result(self):
        return get_compat('1980-08-29', 'male', '1980-05-24', 'female')

    def test_pre_analysis_has_cross_ten_gods(self, jay_hannah_result):
        """Cross ten god analysis should be populated."""
        pre = jay_hannah_result.get('compatibilityPreAnalysis', {})
        ctg = pre.get('crossTenGods', {})
        assert 'aDaymasterInB' in ctg
        assert 'bDaymasterInA' in ctg

    def test_pre_analysis_has_landmines(self, tse_cheung_result):
        """Low-scoring couple should generate landmine warnings."""
        pre = tse_cheung_result.get('compatibilityPreAnalysis', {})
        landmines = pre.get('landmines', [])
        assert len(landmines) >= 1, "Low-scoring couple should have landmine warnings"

    def test_pre_analysis_timing_populated(self, jay_hannah_result):
        """Timing sync should have golden/challenge years."""
        pre = jay_hannah_result.get('compatibilityPreAnalysis', {})
        timing = pre.get('timingSync', {})
        assert 'goldenYears' in timing
        assert 'challengeYears' in timing

    def test_pre_analysis_dimension_summary_8_dims(self, jay_hannah_result):
        """Should have exactly 8 dimension summaries."""
        pre = jay_hannah_result.get('compatibilityPreAnalysis', {})
        dims = pre.get('dimensionSummary', [])
        assert len(dims) == 8

    def test_happy_couple_more_positive_ratio(self, jay_hannah_result, tse_cheung_result):
        """Happy couple should have better positive:negative ratio than divorced couple."""
        pre_happy = jay_hannah_result.get('compatibilityPreAnalysis', {})
        pre_bad = tse_cheung_result.get('compatibilityPreAnalysis', {})
        ratio_happy = pre_happy.get('narrationGuidance', {}).get('positiveNegativeRatio', '5:5')
        ratio_bad = pre_bad.get('narrationGuidance', {}).get('positiveNegativeRatio', '5:5')
        # Parse ratios
        pos_happy = int(ratio_happy.split(':')[0])
        pos_bad = int(ratio_bad.split(':')[0])
        assert pos_happy >= pos_bad, \
            f"Happy couple ratio ({ratio_happy}) should be >= bad couple ratio ({ratio_bad})"


# ============================================================
# Test 6: Comparison Type Differences for Same Celebrity Couple
# ============================================================

class TestComparisonTypeCelebrity:
    """Same couple should get different scores for different relationship types."""

    def test_jay_hannah_romance_vs_business(self):
        """Romance and business should yield different scores for Jay+Hannah."""
        r_romance = get_compat('1979-01-18', 'male', '1993-08-12', 'female', 'romance')
        r_business = get_compat('1979-01-18', 'male', '1993-08-12', 'female', 'business')
        score_r = r_romance['compatibilityEnhanced']['adjustedScore']
        score_b = r_business['compatibilityEnhanced']['adjustedScore']
        assert score_r != score_b, \
            f"Romance ({score_r}) and business ({score_b}) should differ"

    def test_tse_cheung_romance_vs_friendship(self):
        """A couple that's bad for romance might be different for friendship."""
        r_romance = get_compat('1980-08-29', 'male', '1980-05-24', 'female', 'romance')
        r_friend = get_compat('1980-08-29', 'male', '1980-05-24', 'female', 'friendship')
        score_r = r_romance['compatibilityEnhanced']['adjustedScore']
        score_f = r_friend['compatibilityEnhanced']['adjustedScore']
        # Both should be in valid range
        assert 5 <= score_r <= 99
        assert 5 <= score_f <= 99


# ============================================================
# Test 7: Edge Cases from Celebrity Data
# ============================================================

class TestCelebrityEdgeCases:
    """Test edge cases revealed by celebrity data."""

    def test_same_year_pillar_couple(self):
        """Tse + Cheung: both 庚申 year. Should not crash or give anomalous score."""
        r = get_compat('1980-08-29', 'male', '1980-05-24', 'female')
        score = r['compatibilityEnhanced']['adjustedScore']
        assert 5 <= score <= 99

    def test_large_age_gap_couple(self):
        """Wong (1969) + Tse (1980): 11 year gap. Should work normally."""
        r = get_compat('1969-08-08', 'female', '1980-08-29', 'male')
        score = r['compatibilityEnhanced']['adjustedScore']
        assert 5 <= score <= 99
        # Should have luck period sync data
        enhanced = r['compatibilityEnhanced']
        assert 'luckPeriodSync' in enhanced['dimensionScores']

    def test_reversed_order_same_result(self):
        """Compatibility should be similar regardless of A/B order
        (though Ten God cross is asymmetric, overall should be close)."""
        r1 = get_compat('1977-11-13', 'male', '1989-02-28', 'female')
        r2 = get_compat('1989-02-28', 'female', '1977-11-13', 'male')
        s1 = r1['compatibilityEnhanced']['adjustedScore']
        s2 = r2['compatibilityEnhanced']['adjustedScore']
        # Allow ±15 difference due to asymmetric ten god scoring
        assert abs(s1 - s2) <= 15, \
            f"Order should not drastically change score: {s1} vs {s2}"


# ============================================================
# Test 8: Calibration Knockout Conditions
# Verify the new knockout conditions fire for the right couples
# ============================================================

class TestCalibrationKnockouts:
    """Test that the new calibration-driven knockout conditions fire correctly."""

    def test_huang_ab_he_er_bu_li(self):
        """Huang + Angelababy: 甲己合 with rawYongshenScore < -50 → 合而不利.
        The stem combination should NOT give +8 bonus; should apply -3 penalty."""
        r = get_compat('1977-11-13', 'male', '1989-02-28', 'female')
        knockouts = r['compatibilityEnhanced']['knockoutConditions']
        # Should have tiangan_wuhe_adverse, NOT tiangan_wuhe
        adverse = [ko for ko in knockouts if ko['type'] == 'tiangan_wuhe_adverse']
        normal = [ko for ko in knockouts if ko['type'] == 'tiangan_wuhe']
        assert len(adverse) > 0, \
            f"Should detect 合而不利 for Huang+AB: {[ko['type'] for ko in knockouts]}"
        assert len(normal) == 0, \
            "Should NOT have normal tiangan_wuhe when yongshen is severely conflicting"
        assert adverse[0]['scoreImpact'] < 0, \
            f"合而不利 should be negative: {adverse[0]['scoreImpact']}"

    def test_jay_hannah_stem_combo_positive(self):
        """Jay + Hannah: same DM = 比和, no stem combination → no wuhe knockout.
        But if they had a combination, yongshen is good → should be positive."""
        r = get_compat('1979-01-18', 'male', '1993-08-12', 'female')
        knockouts = r['compatibilityEnhanced']['knockoutConditions']
        # Should NOT have tiangan_wuhe_adverse (no stem combination for same DM)
        adverse = [ko for ko in knockouts if ko['type'] == 'tiangan_wuhe_adverse']
        assert len(adverse) == 0, \
            "Jay+Hannah (same DM) should not trigger stem combo knockout"

    def test_bigs_wang_both_unstable_palaces(self):
        """Big S + Wang: both have within-chart day branch clashes.
        Big S: day=卯 clashed by month=酉 (severity 80)
        Wang: day=子 clashed by month=午 (severity 90)
        Should detect both_unstable_marriage_palaces."""
        r = get_compat('1976-10-06', 'female', '1981-06-27', 'male')
        knockouts = r['compatibilityEnhanced']['knockoutConditions']
        palace_kos = [ko for ko in knockouts if ko['type'] == 'both_unstable_marriage_palaces']
        assert len(palace_kos) > 0, \
            f"Should detect both unstable palaces for BigS+Wang: {[ko['type'] for ko in knockouts]}"
        # Impact may be mitigated by 天德/月德 (from -8 to -6), so check <= -5
        assert palace_kos[0]['scoreImpact'] <= -5, \
            f"Both unstable palaces should be severe (even after mitigation): {palace_kos[0]['scoreImpact']}"

    def test_bigs_wang_both_yinyang_cuocuo(self):
        """Big S + Wang: both have 陰陽差錯日 special day pillar.
        Should detect both_yinyang_cuocuo knockout."""
        r = get_compat('1976-10-06', 'female', '1981-06-27', 'male')
        knockouts = r['compatibilityEnhanced']['knockoutConditions']
        cuocuo_kos = [ko for ko in knockouts if ko['type'] == 'both_yinyang_cuocuo']
        assert len(cuocuo_kos) > 0, \
            f"Should detect both 陰陽差錯日 for BigS+Wang: {[ko['type'] for ko in knockouts]}"
        # Impact may be mitigated by 天德/月德 (from -5 to -4), so check <= -3
        assert cuocuo_kos[0]['scoreImpact'] <= -3, \
            f"Both 陰陽差錯日 should be penalized (even after mitigation): {cuocuo_kos[0]['scoreImpact']}"

    def test_jay_hannah_no_palace_instability(self):
        """Jay + Hannah: healthy couple should NOT have palace instability knockouts."""
        r = get_compat('1979-01-18', 'male', '1993-08-12', 'female')
        knockouts = r['compatibilityEnhanced']['knockoutConditions']
        palace_kos = [ko for ko in knockouts
                      if ko['type'] in ('both_unstable_marriage_palaces',
                                        'one_unstable_marriage_palace')]
        assert len(palace_kos) == 0, \
            f"Jay+Hannah should NOT have palace instability: {[ko['type'] for ko in knockouts]}"

    def test_bigs_wang_landmines_include_yinyang(self):
        """Big S + Wang pre-analysis landmines should include 陰陽差錯日 warning."""
        r = get_compat('1976-10-06', 'female', '1981-06-27', 'male')
        pre = r.get('compatibilityPreAnalysis', {})
        landmines = pre.get('landmines', [])
        triggers = [lm.get('trigger', '') for lm in landmines]
        assert '婚姻穩定性' in triggers, \
            f"Should have 婚姻穩定性 landmine for BigS+Wang: {triggers}"

    def test_bigs_wang_landmines_include_palace(self):
        """Big S + Wang pre-analysis landmines should include palace instability warning."""
        r = get_compat('1976-10-06', 'female', '1981-06-27', 'male')
        pre = r.get('compatibilityPreAnalysis', {})
        landmines = pre.get('landmines', [])
        triggers = [lm.get('trigger', '') for lm in landmines]
        assert '配偶宮不穩' in triggers, \
            f"Should have 配偶宮不穩 landmine for BigS+Wang: {triggers}"
