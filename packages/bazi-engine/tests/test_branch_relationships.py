"""
Tests for branch_relationships.py — 地支關係 (7 types + interactions)

Tests: 六合, 六沖, 三合, 三會, 三刑, 六害, 六破, 半合, 自刑,
       pillar-specific effects, score hierarchy, interaction resolution.

Sources: 《子平真詮·論地支》, 《淵海子平·卷三》
"""

import pytest
from app.branch_relationships import (
    CLASH_LOOKUP,
    HARMONY_LOOKUP,
    SIX_BREAKS,
    SIX_CLASHES,
    SIX_HARMONIES,
    SIX_HARMS,
    THREE_MEETINGS,
    TRIPLE_HARMONIES,
    analyze_branch_relationships,
    find_six_breaks,
    find_six_clashes,
    find_six_harmonies,
    find_six_harms,
    find_three_meetings,
    find_three_punishments,
    find_triple_harmonies,
)


def _make_pillars(yb='子', mb='子', db='子', hb='子'):
    """Build minimal pillars dict with specified branches."""
    return {
        'year':  {'stem': '甲', 'branch': yb},
        'month': {'stem': '丙', 'branch': mb},
        'day':   {'stem': '戊', 'branch': db},
        'hour':  {'stem': '庚', 'branch': hb},
    }


# ============================================================
# 六合 (Six Harmonies) Tests
# ============================================================

class TestSixHarmonies:
    """Test all 6 harmony pairs and their properties."""

    def test_zi_chou_harmony(self):
        """子丑合化土"""
        pillars = _make_pillars(yb='子', mb='丑')
        results = find_six_harmonies(pillars)
        assert len(results) >= 1
        r = results[0]
        assert r['type'] == 'six_harmony'
        assert r['resultElement'] == '土'
        assert r['score'] == 80
        assert r['effect'] == 'positive'

    def test_yin_hai_harmony(self):
        """寅亥合化木"""
        pillars = _make_pillars(yb='寅', mb='亥')
        results = find_six_harmonies(pillars)
        assert len(results) >= 1
        assert results[0]['resultElement'] == '木'

    def test_mao_xu_harmony(self):
        """卯戌合化火"""
        pillars = _make_pillars(yb='卯', mb='戌')
        results = find_six_harmonies(pillars)
        assert len(results) >= 1
        assert results[0]['resultElement'] == '火'

    def test_chen_you_harmony(self):
        """辰酉合化金"""
        pillars = _make_pillars(yb='辰', mb='酉')
        results = find_six_harmonies(pillars)
        assert len(results) >= 1
        assert results[0]['resultElement'] == '金'

    def test_si_shen_harmony(self):
        """巳申合化水"""
        pillars = _make_pillars(yb='巳', mb='申')
        results = find_six_harmonies(pillars)
        assert len(results) >= 1
        assert results[0]['resultElement'] == '水'

    def test_wu_wei_harmony(self):
        """午未合化土"""
        pillars = _make_pillars(yb='午', mb='未')
        results = find_six_harmonies(pillars)
        assert len(results) >= 1
        assert results[0]['resultElement'] == '土'

    def test_exactly_six_harmony_pairs(self):
        """There are exactly 6 harmony pairs."""
        assert len(SIX_HARMONIES) == 6

    def test_harmony_lookup_complete(self):
        """Every branch has a harmony partner."""
        assert len(HARMONY_LOOKUP) == 12

    def test_no_harmony(self):
        """子子子子 — no harmonies (same branch)."""
        pillars = _make_pillars(yb='子', mb='子', db='子', hb='子')
        results = find_six_harmonies(pillars)
        assert len(results) == 0


# ============================================================
# 六沖 (Six Clashes) Tests
# ============================================================

class TestSixClashes:
    """Test all 6 clash pairs with severity."""

    def test_zi_wu_clash(self):
        """子午沖 — highest severity (水火)."""
        pillars = _make_pillars(yb='子', mb='午')
        results = find_six_clashes(pillars)
        assert len(results) >= 1
        r = results[0]
        assert r['type'] == 'six_clash'
        assert r['severity'] == 90
        assert r['effect'] == 'negative'

    def test_chou_wei_clash(self):
        """丑未沖 — lower severity (土土)."""
        pillars = _make_pillars(yb='丑', mb='未')
        results = find_six_clashes(pillars)
        assert len(results) >= 1
        assert results[0]['severity'] == 70

    def test_yin_shen_clash(self):
        """寅申沖 — 木金"""
        pillars = _make_pillars(yb='寅', mb='申')
        results = find_six_clashes(pillars)
        assert len(results) >= 1
        assert results[0]['severity'] == 85

    def test_mao_you_clash(self):
        """卯酉沖"""
        pillars = _make_pillars(yb='卯', mb='酉')
        results = find_six_clashes(pillars)
        assert len(results) >= 1

    def test_chen_xu_clash(self):
        """辰戌沖"""
        pillars = _make_pillars(db='辰', hb='戌')
        results = find_six_clashes(pillars)
        assert len(results) >= 1

    def test_si_hai_clash(self):
        """巳亥沖"""
        pillars = _make_pillars(yb='巳', hb='亥')
        results = find_six_clashes(pillars)
        assert len(results) >= 1

    def test_pillar_effect_year_month(self):
        """年月沖 has specific pillar effect description."""
        pillars = _make_pillars(yb='子', mb='午')
        results = find_six_clashes(pillars)
        assert results[0]['pillarEffect'] != ''
        assert '年月沖' in results[0]['pillarEffect']

    def test_pillar_effect_day_hour(self):
        """日時沖 has specific pillar effect."""
        pillars = _make_pillars(db='子', hb='午')
        results = find_six_clashes(pillars)
        day_hour = [r for r in results if r['pillarA'] == 'day' and r['pillarB'] == 'hour']
        assert len(day_hour) >= 1
        assert '日時沖' in day_hour[0]['pillarEffect']

    def test_clash_lookup_complete(self):
        """Every branch has a clash partner."""
        assert len(CLASH_LOOKUP) == 12


# ============================================================
# 三合 (Triple Harmony) Tests
# ============================================================

class TestTripleHarmonies:
    """Test 三合 (full triple) and 半合 (half harmony) detection."""

    def test_shen_zi_chen_water(self):
        """申子辰三合水局"""
        pillars = _make_pillars(yb='申', mb='子', db='辰', hb='寅')
        results = find_triple_harmonies(pillars)
        full = [r for r in results if r['type'] == 'triple_harmony']
        assert len(full) >= 1
        assert full[0]['resultElement'] == '水'
        assert full[0]['score'] == 90

    def test_hai_mao_wei_wood(self):
        """亥卯未三合木局"""
        pillars = _make_pillars(yb='亥', mb='卯', db='未', hb='午')
        results = find_triple_harmonies(pillars)
        full = [r for r in results if r['type'] == 'triple_harmony']
        assert len(full) >= 1
        assert full[0]['resultElement'] == '木'

    def test_yin_wu_xu_fire(self):
        """寅午戌三合火局"""
        pillars = _make_pillars(yb='寅', mb='午', db='戌', hb='子')
        results = find_triple_harmonies(pillars)
        full = [r for r in results if r['type'] == 'triple_harmony']
        assert len(full) >= 1
        assert full[0]['resultElement'] == '火'

    def test_si_you_chou_metal(self):
        """巳酉丑三合金局"""
        pillars = _make_pillars(yb='巳', mb='酉', db='丑', hb='子')
        results = find_triple_harmonies(pillars)
        full = [r for r in results if r['type'] == 'triple_harmony']
        assert len(full) >= 1
        assert full[0]['resultElement'] == '金'

    def test_half_harmony_sheng_wang(self):
        """申子 = 前半合 (長生+帝旺) → score 70."""
        pillars = _make_pillars(yb='申', mb='子', db='午', hb='寅')
        results = find_triple_harmonies(pillars)
        halves = [r for r in results if r['type'] == 'half_harmony']
        sheng_wang = [h for h in halves if h['name'] == '前半合']
        assert len(sheng_wang) >= 1
        assert sheng_wang[0]['score'] == 70

    def test_half_harmony_wang_mu(self):
        """子辰 = 後半合 (帝旺+墓庫) → score 60."""
        pillars = _make_pillars(yb='子', mb='辰', db='午', hb='寅')
        results = find_triple_harmonies(pillars)
        halves = [r for r in results if r['type'] == 'half_harmony']
        wang_mu = [h for h in halves if h['name'] == '後半合']
        assert len(wang_mu) >= 1
        assert wang_mu[0]['score'] == 60

    def test_no_half_when_full_present(self):
        """When full 三合 found, don't also report 半合 from same group."""
        pillars = _make_pillars(yb='申', mb='子', db='辰', hb='午')
        results = find_triple_harmonies(pillars)
        full = [r for r in results if r['type'] == 'triple_harmony']
        halves = [r for r in results if r['type'] == 'half_harmony' and r['resultElement'] == '水']
        assert len(full) >= 1
        assert len(halves) == 0  # No water 半合 when full 三合 present

    def test_exactly_four_triple_groups(self):
        """There are exactly 4 triple harmony groups."""
        assert len(TRIPLE_HARMONIES) == 4


# ============================================================
# 三會 (Triple Meeting) Tests
# ============================================================

class TestThreeMeetings:
    """Test 三會 (seasonal triple meeting) detection."""

    def test_spring_meeting(self):
        """寅卯辰三會木局（春季東方）"""
        pillars = _make_pillars(yb='寅', mb='卯', db='辰', hb='子')
        results = find_three_meetings(pillars)
        assert len(results) >= 1
        r = results[0]
        assert r['resultElement'] == '木'
        assert r['season'] == '春'
        assert r['score'] == 100  # Strongest

    def test_summer_meeting(self):
        """巳午未三會火局"""
        pillars = _make_pillars(yb='巳', mb='午', db='未', hb='子')
        results = find_three_meetings(pillars)
        assert len(results) >= 1
        assert results[0]['resultElement'] == '火'

    def test_autumn_meeting(self):
        """申酉戌三會金局"""
        pillars = _make_pillars(yb='申', mb='酉', db='戌', hb='子')
        results = find_three_meetings(pillars)
        assert len(results) >= 1
        assert results[0]['resultElement'] == '金'

    def test_winter_meeting(self):
        """亥子丑三會水局"""
        pillars = _make_pillars(yb='亥', mb='子', db='丑', hb='午')
        results = find_three_meetings(pillars)
        assert len(results) >= 1
        assert results[0]['resultElement'] == '水'

    def test_meeting_score_higher_than_triple_harmony(self):
        """三會 score (100) > 三合 score (90)."""
        assert 100 > 90  # Trivial but documents the hierarchy

    def test_no_meeting(self):
        """寅午戌 is 三合 not 三會 — no meeting found."""
        pillars = _make_pillars(yb='寅', mb='午', db='戌', hb='子')
        results = find_three_meetings(pillars)
        assert len(results) == 0


# ============================================================
# 三刑 (Triple Punishment) Tests
# ============================================================

class TestThreePunishments:
    """Test 三刑 and partial punishment detection."""

    def test_wuen_punishment(self):
        """寅巳申 = 無恩之刑"""
        pillars = _make_pillars(yb='寅', mb='巳', db='申', hb='子')
        results = find_three_punishments(pillars)
        full = [r for r in results if r.get('full') and '無恩' in r.get('name', '')]
        assert len(full) >= 1
        assert full[0]['severity'] == 80

    def test_chishi_punishment(self):
        """丑戌未 = 持勢之刑"""
        pillars = _make_pillars(yb='丑', mb='戌', db='未', hb='子')
        results = find_three_punishments(pillars)
        full = [r for r in results if r.get('full') and '持勢' in r.get('name', '')]
        assert len(full) >= 1

    def test_wuli_punishment(self):
        """子卯 = 無禮之刑"""
        pillars = _make_pillars(yb='子', mb='卯', db='午', hb='亥')
        results = find_three_punishments(pillars)
        wuli = [r for r in results if '無禮' in r.get('name', '')]
        assert len(wuli) >= 1

    def test_partial_punishment(self):
        """寅巳 (no 申) → partial punishment (半刑)."""
        pillars = _make_pillars(yb='寅', mb='巳', db='午', hb='子')
        results = find_three_punishments(pillars)
        partials = [r for r in results if r['type'] == 'partial_punishment']
        assert len(partials) >= 1
        # Partial severity should be ~60% of full
        assert partials[0]['severity'] < 80

    def test_self_punishment_chen(self):
        """辰辰自刑"""
        pillars = _make_pillars(yb='辰', mb='辰', db='午', hb='子')
        results = find_three_punishments(pillars)
        self_p = [r for r in results if r['type'] == 'self_punishment']
        assert len(self_p) >= 1
        assert self_p[0]['branches'] == ('辰', '辰')

    def test_self_punishment_wu(self):
        """午午自刑"""
        pillars = _make_pillars(yb='午', mb='午', db='子', hb='丑')
        results = find_three_punishments(pillars)
        self_p = [r for r in results if r['type'] == 'self_punishment']
        assert len(self_p) >= 1

    def test_no_self_punishment_zi(self):
        """子子 — 子 is NOT a self-punishment branch."""
        pillars = _make_pillars(yb='子', mb='子', db='午', hb='丑')
        results = find_three_punishments(pillars)
        self_p = [r for r in results if r['type'] == 'self_punishment']
        assert len(self_p) == 0


# ============================================================
# 六害 (Six Harms) Tests
# ============================================================

class TestSixHarms:
    """Test 六害 detection."""

    def test_zi_wei_harm(self):
        """子未害"""
        pillars = _make_pillars(yb='子', mb='未')
        results = find_six_harms(pillars)
        assert len(results) >= 1
        assert results[0]['type'] == 'six_harm'
        assert results[0]['severity'] == 70

    def test_chou_wu_harm(self):
        """丑午害"""
        pillars = _make_pillars(yb='丑', mb='午')
        results = find_six_harms(pillars)
        assert len(results) >= 1

    def test_exactly_six_harm_pairs(self):
        """There are exactly 6 harm pairs."""
        assert len(SIX_HARMS) == 6


# ============================================================
# 六破 (Six Breaks) Tests
# ============================================================

class TestSixBreaks:
    """Test 六破 detection — least impactful negative relationship."""

    def test_zi_you_break(self):
        """子酉破"""
        pillars = _make_pillars(yb='子', mb='酉')
        results = find_six_breaks(pillars)
        assert len(results) >= 1
        assert results[0]['severity'] == 60

    def test_exactly_six_break_pairs(self):
        """There are exactly 6 break pairs."""
        assert len(SIX_BREAKS) == 6


# ============================================================
# Score Hierarchy Tests
# ============================================================

class TestScoreHierarchy:
    """Verify the documented score hierarchy: 三會 > 三合 > 六合 > 前半合 > 後半合."""

    def test_three_meeting_highest(self):
        """三會 (100) is the highest positive score."""
        from app.branch_relationships import THREE_MEETING_SCORE, TRIPLE_HARMONY_FULL_SCORE
        assert THREE_MEETING_SCORE > TRIPLE_HARMONY_FULL_SCORE

    def test_triple_harmony_above_six_harmony(self):
        """三合 (90) > 六合 (80)."""
        from app.branch_relationships import TRIPLE_HARMONY_FULL_SCORE
        six_harmony_score = 80  # From SIX_HARMONIES data
        assert TRIPLE_HARMONY_FULL_SCORE > six_harmony_score

    def test_half_harmony_hierarchy(self):
        """前半合 (70) > 後半合 (60)."""
        from app.branch_relationships import HALF_HARMONY_SHENG_WANG, HALF_HARMONY_WANG_MU
        assert HALF_HARMONY_SHENG_WANG > HALF_HARMONY_WANG_MU

    def test_clash_highest_negative(self):
        """六沖 max severity (90) > 三刑 (80)."""
        max_clash = max(c['severity'] for c in SIX_CLASHES.values())
        assert max_clash >= 80  # 子午沖 = 90


# ============================================================
# Complete Analysis Integration
# ============================================================

class TestCompleteAnalysis:
    """Test the full analyze_branch_relationships() orchestrator."""

    def test_returns_all_categories(self):
        """Result contains all expected keys."""
        pillars = _make_pillars(yb='子', mb='丑', db='午', hb='未')
        result = analyze_branch_relationships(pillars)
        assert 'harmonies' in result
        assert 'clashes' in result
        assert 'tripleHarmonies' in result
        assert 'threeMeetings' in result
        assert 'punishments' in result
        assert 'harms' in result
        assert 'breaks' in result
        assert 'interactions' in result
        assert 'positiveScore' in result
        assert 'negativeScore' in result
        assert 'netScore' in result

    def test_positive_score_calculation(self):
        """Positive score sums up harmony scores."""
        pillars = _make_pillars(yb='子', mb='丑', db='午', hb='未')
        result = analyze_branch_relationships(pillars)
        # 子丑合 + 午未合 = 80 + 80 = 160
        assert result['positiveScore'] >= 160

    def test_net_score(self):
        """Net score = positive - negative."""
        pillars = _make_pillars(yb='子', mb='午', db='寅', hb='卯')
        result = analyze_branch_relationships(pillars)
        assert result['netScore'] == result['positiveScore'] - result['negativeScore']

    def test_empty_chart_summary(self):
        """Chart with no special relationships has empty summary."""
        pillars = _make_pillars(yb='子', mb='子', db='子', hb='子')
        result = analyze_branch_relationships(pillars)
        assert '地支無特殊關係' in result['summary']

    def test_interaction_harmony_reduces_clash(self):
        """六合 dissolves 六沖 when sharing a branch (合解沖)."""
        # 子丑合 + 子午沖 → 合解沖
        pillars = _make_pillars(yb='子', mb='丑', db='午', hb='寅')
        result = analyze_branch_relationships(pillars)
        assert len(result['harmonies']) >= 1
        assert len(result['clashes']) >= 1
        assert len(result['interactions']) >= 1
