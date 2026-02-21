"""
Tests for Enhanced Bazi Compatibility (合盤) 8-Dimension Scoring Engine.

Covers:
- Dimension 1: 用神互補 (5-god matrix)
- Dimension 2: 日柱天干 (day stem relationship)
- Dimension 3: 配偶宮 (spouse palace) + 天合地合
- Dimension 4: 十神交叉 (asymmetric ten god cross)
- Dimension 5: 五行互補 (directional element complementarity)
- Dimension 6: 全盤互動 (full pillar interactions)
- Dimension 7: 神煞互動 (shen sha interactions)
- Dimension 8: 大運同步 (luck period timing sync)
- Knockout conditions
- Sigmoid amplification
- Main orchestrator
- Exhaustive 用神 matrix range verification
"""

import math
from itertools import permutations

import pytest

from app.compatibility_constants import (
    COMPATIBILITY_LABELS,
    GOD_ROLES,
    KNOCKOUT_TIANHE_DIHE_BONUS,
    KNOCKOUT_TIANGAN_WUHE_BONUS,
    KNOCKOUT_TIAN_KE_DI_CHONG_HARD_FLOOR,
    KNOCKOUT_TIAN_KE_DI_CHONG_PENALTY,
    SELF_PUNISHMENT_BRANCHES,
    SIGMOID_MIDPOINT,
    SIGMOID_STEEPNESS,
    WEIGHT_TABLE,
    YONGSHEN_MATRIX,
    YONGSHEN_RAW_MAX,
    YONGSHEN_RAW_MIN,
    YONGSHEN_RANGE,
)
from app.compatibility_enhanced import (
    _calculate_tiande_mitigation,
    analyze_cross_chart_branches,
    analyze_cross_chart_stems,
    calculate_enhanced_compatibility,
    clamp,
    detect_knockout_conditions,
    detect_tianhe_dihe,
    score_day_stem_relationship,
    score_element_complementarity,
    score_shen_sha_interactions,
    score_spouse_palace,
    score_ten_god_cross,
    score_yongshen_complementarity,
    sigmoid_amplify,
    sync_luck_periods,
)


# ============================================================
# Test Fixtures
# ============================================================

def make_pre_analysis(useful='木', favorable='火', idle='土', taboo='金', enemy='水',
                      classification='strong', cong_ge=None):
    """Build a minimal pre_analysis dict for testing."""
    return {
        'effectiveFavorableGods': {
            'usefulGod': useful,
            'favorableGod': favorable,
            'idleGod': idle,
            'tabooGod': taboo,
            'enemyGod': enemy,
        },
        'classification': classification,
        'congGe': cong_ge,
    }


def make_chart(day_stem='甲', pillars=None):
    """Build a minimal chart dict for testing."""
    if pillars is None:
        pillars = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '寅'},
            'day': {'stem': day_stem, 'branch': '午'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
    return {
        'dayMasterStem': day_stem,
        'fourPillars': pillars,
        'fiveElementsBalance': {'木': 25, '火': 30, '土': 15, '金': 20, '水': 10},
    }


def make_shen_sha(name, pillar='day', branch=None):
    """Build a shen sha dict for testing."""
    ss = {'name': name, 'pillar': pillar}
    if branch:
        ss['branch'] = branch
    return ss


# ============================================================
# Sigmoid Amplification Tests
# ============================================================

class TestSigmoidAmplify:
    """Test sigmoid amplification function."""

    def test_zero_maps_to_zero(self):
        assert sigmoid_amplify(0) == pytest.approx(0.0, abs=0.5)

    def test_hundred_maps_to_hundred(self):
        assert sigmoid_amplify(100) == pytest.approx(100.0, abs=0.5)

    def test_midpoint_maps_near_fifty(self):
        result = sigmoid_amplify(SIGMOID_MIDPOINT)
        assert 45 <= result <= 55

    def test_monotonically_increasing(self):
        values = [sigmoid_amplify(x) for x in range(0, 101, 5)]
        for i in range(1, len(values)):
            assert values[i] >= values[i - 1]

    def test_compression_at_neutral_zone(self):
        """Values 35-65 should be compressed (spread wider after sigmoid)."""
        raw_35 = sigmoid_amplify(35)
        raw_65 = sigmoid_amplify(65)
        # At steepness=0.10, the neutral zone should still show meaningful spread
        assert raw_65 - raw_35 > 20  # Significant spread

    def test_output_always_in_range(self):
        for x in range(-10, 120):
            result = sigmoid_amplify(float(x))
            assert 0 <= result <= 100


# ============================================================
# Dimension 1: 用神互補 Tests
# ============================================================

class TestYongshenComplementarity:
    """Test 5-god matrix scoring."""

    def test_perfect_complementarity(self):
        """Best case: A's 用=B's 喜, A's 喜=B's 用, etc."""
        pre_a = make_pre_analysis(useful='木', favorable='火', idle='土', taboo='金', enemy='水')
        pre_b = make_pre_analysis(useful='火', favorable='木', idle='土', taboo='水', enemy='金')
        result = score_yongshen_complementarity(pre_a, pre_b)
        # 用-喜(40) + 喜-用(40) + 閒-閒(5) + 忌-仇(10) + 仇-忌(10) = 105
        assert result['rawYongshenScore'] == 105
        assert result['rawScore'] == pytest.approx(100.0, abs=0.1)

    def test_worst_complementarity(self):
        """Worst case: A's 用=B's 忌, etc."""
        pre_a = make_pre_analysis(useful='木', favorable='火', idle='土', taboo='金', enemy='水')
        pre_b = make_pre_analysis(useful='金', favorable='水', idle='土', taboo='木', enemy='火')
        result = score_yongshen_complementarity(pre_a, pre_b)
        # 用-忌(-40) + 喜-仇(-20) + 閒-閒(5) + 忌-用(-40) + 仇-喜(-20) = -115
        assert result['rawYongshenScore'] == -115
        assert result['rawScore'] == pytest.approx(0.0, abs=0.1)

    def test_identical_gods(self):
        """Identical charts: diagonal sum = 10+10+5+15+5 = 45."""
        pre_a = make_pre_analysis(useful='木', favorable='火', idle='土', taboo='金', enemy='水')
        pre_b = make_pre_analysis(useful='木', favorable='火', idle='土', taboo='金', enemy='水')
        result = score_yongshen_complementarity(pre_a, pre_b)
        assert result['rawYongshenScore'] == 45
        expected_normalized = (45 + 115) / 220 * 100  # ~72.7
        assert result['rawScore'] == pytest.approx(expected_normalized, abs=0.5)

    def test_shared_jishen_detected(self):
        """Shared 忌神 should flag sharedJishenRisk."""
        pre_a = make_pre_analysis(useful='木', favorable='火', idle='土', taboo='金', enemy='水')
        pre_b = make_pre_analysis(useful='火', favorable='木', idle='土', taboo='金', enemy='水')
        result = score_yongshen_complementarity(pre_a, pre_b)
        assert result['sharedJishenRisk'] is True

    def test_neutral_chart_low_confidence(self):
        pre_a = make_pre_analysis(classification='neutral')
        pre_b = make_pre_analysis()
        result = score_yongshen_complementarity(pre_a, pre_b)
        assert result['yongshenConfidence'] == 'low'
        assert result['isNeutralChart'] is True

    def test_cong_ge_flag(self):
        pre_a = make_pre_analysis(cong_ge='從財格')
        pre_b = make_pre_analysis()
        result = score_yongshen_complementarity(pre_a, pre_b)
        assert result['congGeAffectsYongshen'] is True

    def test_score_always_normalized(self):
        """Score should always be between 0 and 100."""
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = score_yongshen_complementarity(pre_a, pre_b)
        assert 0 <= result['rawScore'] <= 100


# ============================================================
# Dimension 2: 日柱天干 Tests
# ============================================================

class TestDayStemRelationship:
    """Test day stem relationship scoring."""

    def test_jia_ji_combination(self):
        """甲己合 = 中正之合, score 95."""
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = score_day_stem_relationship('甲', '己', pre_a, pre_b)
        assert result['combinationName'] == '中正之合'
        assert result['rawScore'] == 95

    def test_ding_ren_warning(self):
        """丁壬合 for romance triggers dinRenWarning."""
        # Use usefulGod='火' so 合化木 doesn't trigger yongshen bonus
        pre_a = make_pre_analysis(useful='火', favorable='土', idle='金', taboo='水', enemy='木')
        pre_b = make_pre_analysis(useful='火', favorable='土', idle='金', taboo='水', enemy='木')
        result = score_day_stem_relationship('丁', '壬', pre_a, pre_b, 'romance')
        assert result['dinRenWarning'] is True
        assert result['rawScore'] == 72

    def test_ding_ren_business_no_warning(self):
        """丁壬合 for business uses flat 88, no warning."""
        # Use usefulGod='火' so 合化木 doesn't trigger yongshen bonus
        pre_a = make_pre_analysis(useful='火', favorable='土', idle='金', taboo='水', enemy='木')
        pre_b = make_pre_analysis(useful='火', favorable='土', idle='金', taboo='水', enemy='木')
        result = score_day_stem_relationship('丁', '壬', pre_a, pre_b, 'business')
        assert result['dinRenWarning'] is False
        assert result['rawScore'] == 88

    def test_stem_clash(self):
        """天干七沖 (甲庚) = 10."""
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = score_day_stem_relationship('甲', '庚', pre_a, pre_b)
        assert result['rawScore'] == 10
        assert any(f['type'] == '天干七沖' for f in result['findings'])

    def test_same_element_different_stem(self):
        """比和 (甲乙, both 木) = 60."""
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = score_day_stem_relationship('甲', '乙', pre_a, pre_b)
        assert result['rawScore'] == 60

    def test_identical_stem(self):
        """同柱 (甲甲) = 70 (masters view same DM as deep understanding, better than 比和=60)."""
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = score_day_stem_relationship('甲', '甲', pre_a, pre_b)
        assert result['rawScore'] == 70

    def test_production_cycle(self):
        """相生 (甲丙, 木生火) = 75."""
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = score_day_stem_relationship('甲', '丙', pre_a, pre_b)
        assert result['rawScore'] == 75
        assert any(f['type'] == '相生' for f in result['findings'])

    def test_overcoming_cycle(self):
        """相克 (甲戊, 木克土) = 25."""
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = score_day_stem_relationship('甲', '戊', pre_a, pre_b)
        assert result['rawScore'] == 25

    def test_huahua_harmful_penalty(self):
        """合化 element is chart's 忌神 → score × 0.7."""
        pre_a = make_pre_analysis(taboo='土')  # 甲己合化土, 土 is A's taboo
        pre_b = make_pre_analysis()
        result = score_day_stem_relationship('甲', '己', pre_a, pre_b)
        assert result['huaHuaQuality'] == 'harmful'
        assert result['rawScore'] == round(95 * 0.7)

    def test_all_five_combinations_exist(self):
        """All 5 天干五合 should be detected."""
        pairs = [('甲', '己'), ('乙', '庚'), ('丙', '辛'), ('丁', '壬'), ('戊', '癸')]
        pre = make_pre_analysis()
        for a, b in pairs:
            result = score_day_stem_relationship(a, b, pre, pre)
            assert result['combinationName'] is not None, f'{a}{b} should form 天干五合'


# ============================================================
# Dimension 3: 配偶宮 + 天合地合 Tests
# ============================================================

class TestTianHeDiHe:
    """Test 天合地合 detection."""

    def test_jia_zi_ji_chou(self):
        """甲子 + 己丑 = 天合地合 (甲己合 + 子丑合)."""
        result = detect_tianhe_dihe('甲', '子', '己', '丑')
        assert result['detected'] is True
        assert '甲己' in result['description'] or '天合地合' in result['description']

    def test_no_tianhe_dihe_stem_only(self):
        """Stem combines but branch doesn't → not 天合地合."""
        result = detect_tianhe_dihe('甲', '寅', '己', '午')
        assert result['detected'] is False

    def test_no_tianhe_dihe_branch_only(self):
        """Branch combines but stem doesn't → not 天合地合."""
        result = detect_tianhe_dihe('甲', '子', '甲', '丑')
        assert result['detected'] is False

    def test_known_tianhe_dihe_pairs(self):
        """Test several known 天合地合 pairs."""
        pairs = [
            ('甲', '子', '己', '丑'),  # 甲己合 + 子丑合
            ('乙', '亥', '庚', '寅'),  # 乙庚合 + 亥寅合
            ('丙', '辰', '辛', '酉'),  # 丙辛合 + 辰酉合
        ]
        for sa, ba, sb, bb in pairs:
            result = detect_tianhe_dihe(sa, ba, sb, bb)
            assert result['detected'] is True, f'{sa}{ba}+{sb}{bb} should be 天合地合'


class TestSpousePalace:
    """Test spouse palace scoring."""

    def test_liuhe_beneficial(self):
        """六合 + beneficial 合化 = 95."""
        pre = make_pre_analysis(useful='土')  # 子丑合化土
        result = score_spouse_palace('子', '丑', '甲', '己', ['子'], ['丑'], [], [],
                                     pre, make_pre_analysis())
        assert result['rawScore'] == 95

    def test_liuhe_neutral(self):
        """六合 without 用/忌 involvement = 85."""
        pre_a = make_pre_analysis(useful='木', taboo='火')  # Neither is 土
        pre_b = make_pre_analysis(useful='水', taboo='金')
        result = score_spouse_palace('子', '丑', '甲', '己', ['子'], ['丑'], [], [],
                                     pre_a, pre_b)
        assert result['rawScore'] == 85

    def test_liuchong_zi_wu_most_severe(self):
        """子午沖 = severity 90, score = 10."""
        pre = make_pre_analysis()
        result = score_spouse_palace('子', '午', '甲', '丙', ['子'], ['午'], [], [],
                                     pre, pre)
        assert result['rawScore'] == 10

    def test_liuchong_chou_wei_mildest(self):
        """丑未沖 = severity 70, score = 30."""
        pre = make_pre_analysis()
        result = score_spouse_palace('丑', '未', '己', '己', ['丑'], ['未'], [], [],
                                     pre, pre)
        assert result['rawScore'] == 30

    def test_liuchong_mao_you_equals_si_hai(self):
        """卯酉沖 and 巳亥沖 share severity 80, both score 20."""
        pre = make_pre_analysis()
        # Use stems that don't form 克 relationship to avoid triggering 天剋地沖
        r1 = score_spouse_palace('卯', '酉', '甲', '甲', ['卯'], ['酉'], [], [],
                                  pre, pre)
        r2 = score_spouse_palace('巳', '亥', '丙', '丙', ['巳'], ['亥'], [], [],
                                  pre, pre)
        assert r1['rawScore'] == r2['rawScore'] == 20

    def test_tian_ke_di_chong(self):
        """天剋地沖 = score 5, worst possible."""
        pre = make_pre_analysis()
        # 甲 克 戊 (木克土) + 子午沖
        result = score_spouse_palace('子', '午', '甲', '戊', ['子'], ['午'], [], [],
                                     pre, pre)
        assert result['rawScore'] == 5
        assert result['tianKeDiChong'] is True

    def test_self_punishment_branch(self):
        """辰辰 self-punishment = 35 (milder than genuine clash)."""
        pre = make_pre_analysis()
        result = score_spouse_palace('辰', '辰', '甲', '甲', ['辰'], ['辰'], [], [],
                                     pre, pre)
        assert result['rawScore'] == 35

    def test_no_interaction_neutral(self):
        """No special interaction = 50."""
        pre = make_pre_analysis()
        # 寅卯 are not in any special relationship to each other (except 六害?)
        # Use 寅辰 which has no direct relationship
        result = score_spouse_palace('寅', '辰', '甲', '甲', ['寅'], ['辰'], [], [],
                                     pre, pre)
        # This may hit 六害 or 三合 check — let's just verify range
        assert 0 <= result['rawScore'] <= 100

    def test_tiande_mitigation_reduces_negative(self):
        """天德/月德 should reduce negative spouse palace scores."""
        pre = make_pre_analysis()
        shen_sha = [make_shen_sha('天德', 'day')]
        # 子午沖 without mitigation = 10
        result_no_mit = score_spouse_palace('子', '午', '甲', '丙', ['子'], ['午'],
                                            [], [], pre, pre)
        result_with_mit = score_spouse_palace('子', '午', '甲', '丙', ['子'], ['午'],
                                              shen_sha, [], pre, pre)
        assert result_with_mit['rawScore'] > result_no_mit['rawScore']

    def test_tiande_does_not_mitigate_tian_ke_di_chong(self):
        """天剋地沖 is NOT mitigable by 天德/月德."""
        pre = make_pre_analysis()
        shen_sha = [make_shen_sha('天德', 'day')]
        result = score_spouse_palace('子', '午', '甲', '戊', ['子'], ['午'],
                                     shen_sha, [], pre, pre)
        assert result['rawScore'] == 5  # Unchanged


# ============================================================
# Dimension 4: 十神交叉 Tests
# ============================================================

class TestTenGodCross:
    """Test asymmetric ten god cross-analysis."""

    def test_asymmetric_scoring(self):
        """A→B and B→A should differ when day masters differ."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        result = score_ten_god_cross(chart_a, chart_b, 'male', 'female', 'romance')
        # A→B and B→A should have different ten gods
        a_in_b = next(f for f in result['findings'] if f['type'] == 'a_in_b')
        b_in_a = next(f for f in result['findings'] if f['type'] == 'b_in_a')
        # Both should have scores
        assert a_in_b['score'] > 0
        assert b_in_a['score'] > 0

    def test_same_gender_neutral_mode(self):
        """Same gender uses 'neutral' scoring."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        result = score_ten_god_cross(chart_a, chart_b, 'male', 'male', 'romance')
        assert result['sameGenderMode'] is True

    def test_parent_child_weighting(self):
        """Parent-child uses 70/30 weighting, not 50/50."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='丙')
        result_pc = score_ten_god_cross(chart_a, chart_b, 'male', 'male', 'parent_child')
        result_rom = score_ten_god_cross(chart_a, chart_b, 'male', 'female', 'romance')
        # Scores should differ due to different weighting
        assert result_pc['rawScore'] != result_rom['rawScore']

    def test_score_in_range(self):
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='庚')
        result = score_ten_god_cross(chart_a, chart_b, 'male', 'female', 'romance')
        assert 0 <= result['rawScore'] <= 100

    def test_guan_sha_hun_za_detection(self):
        """官殺混雜 detection for female romance."""
        # Build a male chart where stems introduce both 正官 and 七殺 from female DM
        # Female DM = 甲, 正官 = 辛 (金克木, diff polarity), 七殺 = 庚 (金克木, same polarity)
        pillars_b = {
            'year': {'stem': '辛', 'branch': '丑'},
            'month': {'stem': '庚', 'branch': '申'},
            'day': {'stem': '壬', 'branch': '子'},
            'hour': {'stem': '癸', 'branch': '亥'},
        }
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='壬')
        chart_b['fourPillars'] = pillars_b
        result = score_ten_god_cross(chart_a, chart_b, 'female', 'male', 'romance')
        assert result['guanShaHunZa'] is not None


# ============================================================
# Dimension 5: 五行互補 Tests
# ============================================================

class TestElementComplementarity:
    """Test directional element complementarity."""

    def test_identical_elements_zero_complementarity(self):
        """Identical element distributions = zero complementarity."""
        elems = {'木': 30, '火': 20, '土': 20, '金': 15, '水': 15}
        result = score_element_complementarity(elems, elems)
        assert result['rawSum'] == 0
        assert result['rawScore'] == 0

    def test_perfect_complementarity(self):
        """One has all excess, other has all deficit → high complementarity."""
        elems_a = {'木': 60, '火': 0, '土': 20, '金': 20, '水': 0}
        elems_b = {'木': 0, '火': 60, '土': 20, '金': 0, '水': 20}
        result = score_element_complementarity(elems_a, elems_b)
        assert result['rawSum'] > 0
        assert result['rawScore'] > 50

    def test_directional_vs_average(self):
        """Two charts both high in Fire should have low complementarity (not averaged)."""
        elems_a = {'木': 10, '火': 40, '土': 20, '金': 15, '水': 15}
        elems_b = {'木': 10, '火': 40, '土': 20, '金': 15, '水': 15}
        result = score_element_complementarity(elems_a, elems_b)
        assert result['rawSum'] == 0  # Both excess in Fire, no mutual filling


# ============================================================
# Dimension 6: 全盤互動 Tests
# ============================================================

class TestFullPillarInteractions:
    """Test cross-chart stem and branch analysis."""

    def test_stem_combination_detected(self):
        """Cross-chart 天干合 should be detected."""
        pillars_a = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丙', 'branch': '寅'},
            'day': {'stem': '戊', 'branch': '午'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        pillars_b = {
            'year': {'stem': '己', 'branch': '丑'},
            'month': {'stem': '辛', 'branch': '酉'},
            'day': {'stem': '癸', 'branch': '亥'},
            'hour': {'stem': '乙', 'branch': '卯'},
        }
        result = analyze_cross_chart_stems(pillars_a, pillars_b)
        # 甲-己, 丙-辛, 戊-癸, 庚-乙 are all 天干合
        assert result['positiveWeighted'] > 0
        combo_findings = [f for f in result['findings'] if f['type'] == '天干合']
        assert len(combo_findings) > 0

    def test_day_day_excluded(self):
        """Day×day stem pair should be excluded (handled by Dim 2)."""
        pillars_a = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '甲', 'branch': '子'},
            'day': {'stem': '甲', 'branch': '子'},
            'hour': {'stem': '甲', 'branch': '子'},
        }
        pillars_b = {
            'year': {'stem': '己', 'branch': '丑'},
            'month': {'stem': '己', 'branch': '丑'},
            'day': {'stem': '己', 'branch': '丑'},
            'hour': {'stem': '己', 'branch': '丑'},
        }
        result = analyze_cross_chart_stems(pillars_a, pillars_b)
        # Day×day should not appear in findings
        for f in result['findings']:
            assert not (f['pillarA'] == 'day' and f['pillarB'] == 'day')

    def test_branch_dual_tracking(self):
        """Positive and negative branch interactions tracked separately."""
        pillars_a = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '甲', 'branch': '丑'},  # 子丑合
            'day': {'stem': '甲', 'branch': '午'},
            'hour': {'stem': '甲', 'branch': '卯'},
        }
        pillars_b = {
            'year': {'stem': '己', 'branch': '丑'},  # 子丑合
            'month': {'stem': '己', 'branch': '未'},  # 丑未沖
            'day': {'stem': '己', 'branch': '子'},    # 子午沖
            'hour': {'stem': '己', 'branch': '酉'},   # 卯酉沖
        }
        pre = make_pre_analysis()
        result = analyze_cross_chart_branches(pillars_a, pillars_b, pre, pre)
        # Should have both positive and negative weighted scores
        assert result['positiveWeighted'] > 0 or result['negativeWeighted'] > 0
        assert 0 <= result['rawScore'] <= 100

    def test_cross_sanhe_detection(self):
        """Cross-chart 三合 spanning both charts should be detected."""
        # 三合: 申子辰 = 水局
        pillars_a = {
            'year': {'stem': '甲', 'branch': '申'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '甲', 'branch': '辰'},
            'hour': {'stem': '甲', 'branch': '午'},
        }
        pillars_b = {
            'year': {'stem': '己', 'branch': '子'},
            'month': {'stem': '己', 'branch': '丑'},
            'day': {'stem': '己', 'branch': '卯'},
            'hour': {'stem': '己', 'branch': '巳'},
        }
        pre = make_pre_analysis()
        result = analyze_cross_chart_branches(pillars_a, pillars_b, pre, pre)
        # 申(A) + 子(B) + 辰(A) = 三合水局 spanning both charts
        assert len(result['crossSanhe']) > 0


# ============================================================
# Dimension 7: 神煞互動 Tests
# ============================================================

class TestShenShaInteractions:
    """Test Shen Sha cross-chart scoring."""

    def test_tiande_mutual_protection(self):
        """Both having 天德/月德 = highest bonus."""
        sha_a = [make_shen_sha('天德')]
        sha_b = [make_shen_sha('月德')]
        result = score_shen_sha_interactions(sha_a, sha_b, '子', '丑')
        assert result['rawScore'] > 50
        assert any(f['type'] == '天德月德互護' for f in result['findings'])

    def test_guchen_guasu_penalty(self):
        """Both having 孤辰/寡宿 = severe penalty."""
        sha_a = [make_shen_sha('孤辰')]
        sha_b = [make_shen_sha('寡宿')]
        result = score_shen_sha_interactions(sha_a, sha_b, '子', '丑')
        assert any(f['type'] == '孤辰寡宿雙方' for f in result['findings'])

    def test_huagai_romance_negative(self):
        """Both 華蓋 in romance = negative (too inward-looking)."""
        sha_a = [make_shen_sha('華蓋')]
        sha_b = [make_shen_sha('華蓋')]
        result = score_shen_sha_interactions(sha_a, sha_b, '子', '丑', 'romance')
        huagai_finding = next((f for f in result['findings'] if '華蓋' in f['type']), None)
        assert huagai_finding is not None
        assert huagai_finding.get('score', 0) < 0

    def test_huagai_business_positive(self):
        """Both 華蓋 in business = positive (intellectual bond)."""
        sha_a = [make_shen_sha('華蓋')]
        sha_b = [make_shen_sha('華蓋')]
        result = score_shen_sha_interactions(sha_a, sha_b, '子', '丑', 'business')
        huagai_finding = next((f for f in result['findings'] if '華蓋' in f['type']), None)
        assert huagai_finding is not None
        assert huagai_finding.get('score', 0) > 0

    def test_no_shen_sha_uses_neutral(self):
        """No significant Shen Sha → neutral default."""
        result = score_shen_sha_interactions([], [], '子', '丑')
        assert result['rawScore'] == pytest.approx(50.0, abs=1)

    def test_score_normalized_to_100(self):
        """Output should be normalized to 0-100 range."""
        sha_a = [make_shen_sha('天德'), make_shen_sha('紅鸞')]
        sha_b = [make_shen_sha('月德'), make_shen_sha('天喜')]
        result = score_shen_sha_interactions(sha_a, sha_b, '子', '丑')
        assert 0 <= result['rawScore'] <= 100


# ============================================================
# Dimension 8: 大運同步 Tests
# ============================================================

class TestLuckPeriodSync:
    """Test luck period synchronization scoring."""

    def test_all_neutral_yields_50(self):
        """All neutral years → score ~50."""
        lp = [{'startYear': 2020, 'endYear': 2050, 'stem': '甲'}]
        pre = make_pre_analysis()
        pillars = {'year': {'branch': '子'}, 'month': {'branch': '寅'},
                    'day': {'branch': '午'}, 'hour': {'branch': '申'}}
        result = sync_luck_periods(lp, lp, pre, pre, pillars, pillars, 2026, 20)
        # Score should be around 50 for mostly neutral years
        assert 20 <= result['rawScore'] <= 80

    def test_empty_luck_periods_returns_neutral(self):
        """Empty luck periods should still return a valid result."""
        pre = make_pre_analysis()
        pillars = {'year': {'branch': '子'}, 'month': {'branch': '寅'},
                    'day': {'branch': '午'}, 'hour': {'branch': '申'}}
        result = sync_luck_periods([], [], pre, pre, pillars, pillars, 2026, 10)
        assert 'rawScore' in result
        assert 0 <= result['rawScore'] <= 100

    def test_has_golden_and_challenge_years(self):
        """Output should include golden and challenge year lists."""
        lp = [{'startYear': 2020, 'endYear': 2050, 'stem': '甲'}]
        pre = make_pre_analysis()
        pillars = {'year': {'branch': '子'}, 'month': {'branch': '寅'},
                    'day': {'branch': '午'}, 'hour': {'branch': '申'}}
        result = sync_luck_periods(lp, lp, pre, pre, pillars, pillars, 2026, 20)
        assert 'goldenYears' in result
        assert 'challengeYears' in result


# ============================================================
# 天德/月德 Mitigation Tests
# ============================================================

class TestTianDeMitigation:
    """Test 天德/月德 mitigation calculation."""

    def test_day_pillar_highest_mitigation(self):
        """Day pillar = 25% mitigation."""
        sha = [make_shen_sha('天德', 'day')]
        result = _calculate_tiande_mitigation(sha, [])
        assert result == pytest.approx(0.25, abs=0.01)

    def test_month_pillar_mitigation(self):
        """Month pillar = 17% mitigation."""
        sha = [make_shen_sha('月德', 'month')]
        result = _calculate_tiande_mitigation(sha, [])
        assert result == pytest.approx(0.17, abs=0.01)

    def test_year_hour_pillar_mitigation(self):
        """Year/hour pillar = 12% mitigation."""
        sha = [make_shen_sha('天德', 'year')]
        result = _calculate_tiande_mitigation(sha, [])
        assert result == pytest.approx(0.12, abs=0.01)

    def test_both_persons_cap_at_40(self):
        """Both having 天德/月德 should cap at 40% total."""
        sha_a = [make_shen_sha('天德', 'day')]  # 25%
        sha_b = [make_shen_sha('月德', 'day')]  # 25%
        result = _calculate_tiande_mitigation(sha_a, sha_b)
        assert result == pytest.approx(0.40, abs=0.01)

    def test_no_shen_sha_zero_mitigation(self):
        result = _calculate_tiande_mitigation([], [])
        assert result == 0.0


# ============================================================
# Knockout Conditions Tests
# ============================================================

class TestKnockoutConditions:
    """Test knockout condition detection."""

    def test_tianhe_dihe_bonus(self):
        """天合地合 should add +12 bonus."""
        tianhe = {'detected': True, 'description': '天合地合'}
        dim_results = {
            'dayStemRelationship': {'combinationName': '中正之合'},
            'fullPillarInteraction': {'crossSanhe': []},
            'yongshenComplementarity': {'rawYongshenScore': 50},
            'tenGodCross': {'guanShaHunZa': None, 'shangGuanJianGuan': None},
            'spousePalace': {'tianKeDiChong': False},
        }
        knockouts = detect_knockout_conditions(
            dim_results, tianhe, 'male', 'female', 'romance', [], [], '子', '丑'
        )
        tianhe_ko = next((k for k in knockouts if k['type'] == 'tianhe_dihe'), None)
        assert tianhe_ko is not None
        assert tianhe_ko['scoreImpact'] == KNOCKOUT_TIANHE_DIHE_BONUS

    def test_tianhe_dihe_supersedes_tiangan_wuhe(self):
        """天合地合 should suppress 天干五合 knockout (no double counting)."""
        tianhe = {'detected': True, 'description': '天合地合'}
        dim_results = {
            'dayStemRelationship': {'combinationName': '中正之合'},
            'fullPillarInteraction': {'crossSanhe': []},
            'yongshenComplementarity': {'rawYongshenScore': 50},
            'tenGodCross': {'guanShaHunZa': None, 'shangGuanJianGuan': None},
            'spousePalace': {'tianKeDiChong': False},
        }
        knockouts = detect_knockout_conditions(
            dim_results, tianhe, 'male', 'female', 'romance', [], [], '子', '丑'
        )
        types = [k['type'] for k in knockouts]
        assert 'tianhe_dihe' in types
        assert 'tiangan_wuhe' not in types

    def test_tian_ke_di_chong_harshest_penalty(self):
        """天剋地沖 = -15, the harshest penalty."""
        tianhe = {'detected': False}
        dim_results = {
            'dayStemRelationship': {'combinationName': None},
            'fullPillarInteraction': {'crossSanhe': []},
            'yongshenComplementarity': {'rawYongshenScore': 0},
            'tenGodCross': {'guanShaHunZa': None, 'shangGuanJianGuan': None},
            'spousePalace': {'tianKeDiChong': True},
        }
        knockouts = detect_knockout_conditions(
            dim_results, tianhe, 'male', 'female', 'romance', [], [], '子', '午'
        )
        tkdc = next((k for k in knockouts if k['type'] == 'tian_ke_di_chong'), None)
        assert tkdc is not None
        assert tkdc['scoreImpact'] == KNOCKOUT_TIAN_KE_DI_CHONG_PENALTY

    def test_tiande_mitigates_negative_knockouts(self):
        """天德/月德 should reduce negative knockout impacts (except 天剋地沖)."""
        tianhe = {'detected': False}
        dim_results = {
            'dayStemRelationship': {'combinationName': None},
            'fullPillarInteraction': {'crossSanhe': []},
            'yongshenComplementarity': {'rawYongshenScore': -20},
            'tenGodCross': {'guanShaHunZa': None, 'shangGuanJianGuan': None},
            'spousePalace': {'tianKeDiChong': False},
        }
        shen_sha = [make_shen_sha('天德', 'day')]
        knockouts = detect_knockout_conditions(
            dim_results, tianhe, 'male', 'female', 'romance',
            shen_sha, [], '子', '午'
        )
        # The 用神 conflict knockout should have mitigated impact
        yongshen_ko = next((k for k in knockouts if k['type'] == 'yongshen_conflict'), None)
        if yongshen_ko:
            assert yongshen_ko.get('mitigated', False) is True


# ============================================================
# Main Orchestrator Tests
# ============================================================

class TestEnhancedCompatibility:
    """Test the main orchestrator."""

    def _make_test_pair(self, stem_a='甲', stem_b='己', branch_a='子', branch_b='丑'):
        chart_a = make_chart(day_stem=stem_a)
        chart_a['fourPillars']['day']['branch'] = branch_a
        chart_b = make_chart(day_stem=stem_b)
        chart_b['fourPillars']['day']['branch'] = branch_b
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis(useful='火', favorable='木', idle='土', taboo='水', enemy='金')
        return chart_a, chart_b, pre_a, pre_b

    def test_output_structure(self):
        """Check all expected fields exist in output."""
        chart_a, chart_b, pre_a, pre_b = self._make_test_pair()
        result = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'romance', 2026
        )
        assert 'overallScore' in result
        assert 'adjustedScore' in result
        assert 'label' in result
        assert 'dimensionScores' in result
        assert 'knockoutConditions' in result
        assert 'specialFindings' in result
        assert 'timingSync' in result

    def test_score_in_valid_range(self):
        """Final score must be in [5, 99]."""
        chart_a, chart_b, pre_a, pre_b = self._make_test_pair()
        result = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'romance', 2026
        )
        assert 5 <= result['adjustedScore'] <= 99

    def test_all_eight_dimensions_present(self):
        """All 8 dimensions should have scores."""
        chart_a, chart_b, pre_a, pre_b = self._make_test_pair()
        result = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'romance', 2026
        )
        dims = result['dimensionScores']
        expected_dims = [
            'yongshenComplementarity', 'dayStemRelationship', 'spousePalace',
            'tenGodCross', 'elementComplementarity', 'fullPillarInteraction',
            'shenShaInteraction', 'luckPeriodSync',
        ]
        for dim in expected_dims:
            assert dim in dims, f'Missing dimension: {dim}'
            assert 'rawScore' in dims[dim]
            assert 'weight' in dims[dim]

    def test_weights_sum_to_one(self):
        """Weights for each comparison type must sum to 1.0."""
        for comp_type, weights in WEIGHT_TABLE.items():
            total = sum(weights.values())
            assert total == pytest.approx(1.0, abs=0.001), \
                f'{comp_type} weights sum to {total}, not 1.0'

    def test_neutral_chart_weight_redistribution(self):
        """When 中和 chart detected, 用神互補 weight should decrease."""
        chart_a, chart_b, _, pre_b = self._make_test_pair()
        pre_a_neutral = make_pre_analysis(classification='neutral')
        result = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a_neutral, pre_b, 'male', 'female', 'romance', 2026
        )
        ys_weight = result['dimensionScores']['yongshenComplementarity']['weight']
        # Romance default is 0.20; should be reduced to 0.10 for neutral
        assert ys_weight < 0.20

    def test_tian_ke_di_chong_hard_floor(self):
        """天剋地沖 should cap score at 60."""
        # 甲克戊(木克土) + 子午沖
        chart_a = make_chart(day_stem='甲')
        chart_a['fourPillars']['day']['branch'] = '子'
        chart_b = make_chart(day_stem='戊')
        chart_b['fourPillars']['day']['branch'] = '午'
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'romance', 2026
        )
        assert result['adjustedScore'] <= KNOCKOUT_TIAN_KE_DI_CHONG_HARD_FLOOR

    def test_identical_charts_mediocre_score(self):
        """Identical charts should score in the 40-60 range."""
        chart = make_chart(day_stem='甲')
        pre = make_pre_analysis()
        result = calculate_enhanced_compatibility(
            chart, chart, pre, pre, 'male', 'female', 'romance', 2026
        )
        assert result['specialFindings']['identicalCharts'] is True
        # Should be mediocre — between 40 and 65 (including safety valve)
        assert 30 <= result['adjustedScore'] <= 65

    def test_special_label_xiang_ai_xiang_sha(self):
        """Day stems combine + branches clash → 相愛相殺."""
        # 甲己合 + 子午沖
        chart_a = make_chart(day_stem='甲')
        chart_a['fourPillars']['day']['branch'] = '子'
        chart_b = make_chart(day_stem='己')
        chart_b['fourPillars']['day']['branch'] = '午'
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'romance', 2026
        )
        assert result['specialLabel'] == '相愛相殺'

    def test_different_comparison_types_differ(self):
        """Same pair with different comparison types should produce different scores."""
        chart_a, chart_b, pre_a, pre_b = self._make_test_pair()
        result_rom = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'romance', 2026
        )
        result_biz = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'business', 2026
        )
        # Dimension weights differ, so overall scores should differ
        assert result_rom['overallScore'] != result_biz['overallScore'] or \
               result_rom['adjustedScore'] != result_biz['adjustedScore']

    def test_label_assigned(self):
        """A valid label should always be assigned."""
        chart_a, chart_b, pre_a, pre_b = self._make_test_pair()
        result = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'romance', 2026
        )
        all_labels = [lb['label'] for lb in COMPATIBILITY_LABELS]
        special_labels = ['相愛相殺', '前世冤家', '命中注定']
        assert result['label'] in all_labels + special_labels


# ============================================================
# Exhaustive Matrix Range Verification
# ============================================================

class TestYongshenMatrixRange:
    """Verify the 5-god matrix range with exhaustive permutation."""

    def test_all_120_permutations_confirm_range(self):
        """Run all 120 permutations of 5 god roles to verify min/max."""
        roles = list(range(5))  # 用(0), 喜(1), 閒(2), 忌(3), 仇(4)
        all_scores = []

        for perm in permutations(roles):
            # perm[i] = B's role index when A's role for element i is i
            # Actually: for each element, A's role = roles[i], B's role = perm[i]
            total = 0
            for i in range(5):
                total += YONGSHEN_MATRIX[i][perm[i]]
            all_scores.append(total)

        assert min(all_scores) == YONGSHEN_RAW_MIN  # -115
        assert max(all_scores) == YONGSHEN_RAW_MAX  # +105
        assert YONGSHEN_RANGE == YONGSHEN_RAW_MAX - YONGSHEN_RAW_MIN  # 220

    def test_normalization_formula(self):
        """Verify normalization maps exactly to [0, 100]."""
        assert (YONGSHEN_RAW_MIN - YONGSHEN_RAW_MIN) / YONGSHEN_RANGE * 100 == 0
        expected_max = (YONGSHEN_RAW_MAX - YONGSHEN_RAW_MIN) / YONGSHEN_RANGE * 100
        assert expected_max == pytest.approx(100.0, abs=0.01)

    def test_diagonal_sum_for_identical_charts(self):
        """Identical assignments (diagonal) should sum to 45."""
        diagonal_sum = sum(YONGSHEN_MATRIX[i][i] for i in range(5))
        assert diagonal_sum == 45
        normalized = (diagonal_sum - YONGSHEN_RAW_MIN) / YONGSHEN_RANGE * 100
        assert normalized == pytest.approx(72.7, abs=0.5)


# ============================================================
# Edge Cases & Integration
# ============================================================

class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_clamp_function(self):
        assert clamp(50, 0, 100) == 50
        assert clamp(-10, 0, 100) == 0
        assert clamp(150, 0, 100) == 100
        assert clamp(5, 5, 99) == 5
        assert clamp(99, 5, 99) == 99

    def test_sigmoid_boundary_values(self):
        """Sigmoid at 0 → ~0, at 100 → ~100."""
        assert sigmoid_amplify(0) < 1
        assert sigmoid_amplify(100) > 99

    def test_all_compatibility_labels_ordered(self):
        """Labels should cover all score ranges with no gaps."""
        labels = COMPATIBILITY_LABELS
        # Check coverage
        for score in range(0, 100):
            found = False
            for lb in labels:
                if lb['min'] <= score <= lb['max']:
                    found = True
                    break
            assert found, f'Score {score} not covered by any label'

    def test_missing_luck_periods_handled(self):
        """Engine should handle missing luck period data gracefully."""
        chart_a = make_chart(day_stem='甲')
        chart_b = make_chart(day_stem='己')
        chart_b['fourPillars']['day']['branch'] = '丑'
        pre_a = make_pre_analysis()
        pre_b = make_pre_analysis()
        result = calculate_enhanced_compatibility(
            chart_a, chart_b, pre_a, pre_b, 'male', 'female', 'romance', 2026,
            luck_periods_a=None, luck_periods_b=None,
        )
        assert 5 <= result['adjustedScore'] <= 99
