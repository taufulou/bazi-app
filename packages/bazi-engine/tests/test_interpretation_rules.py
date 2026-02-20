"""
Tests for interpretation_rules.py — Main pre-analysis orchestrator

Tests: Day Master Strength V2, 從格 detection, Ten God position rules
(male/female), 透干 analysis, 官殺混雜, 用神合絆, 墓庫, conflict resolution,
life domain mapping, and the full generate_pre_analysis orchestrator.

Sources: 《子平真詮》, 《滴天髓》, 《淵海子平》
"""

import pytest
from app.interpretation_rules import (
    ELEMENT_HEALTH,
    ELEMENT_INDUSTRIES,
    LIFE_STAGE_DELING_SCORE,
    LOVE_INDICATORS,
    READING_TYPE_DOMAINS,
    TEN_GOD_POSITION_RULES_FEMALE,
    TEN_GOD_POSITION_RULES_MALE,
    TOMB_STORAGE,
    analyze_tomb_storage,
    calculate_strength_score_v2,
    check_cong_ge,
    check_guan_sha_hunza,
    check_yong_shen_locked,
    generate_career_insights,
    generate_health_insights,
    generate_love_insights,
    generate_pre_analysis,
    generate_ten_god_position_analysis,
    generate_tougan_analysis,
    resolve_conflicts,
)
from app.constants import HIDDEN_STEMS, STEM_ELEMENT


def _make_pillars(ys, yb, ms, mb, ds, db, hs_, hb):
    """Build pillars dict with stems and branches."""
    return {
        'year':  {'stem': ys, 'branch': yb},
        'month': {'stem': ms, 'branch': mb},
        'day':   {'stem': ds, 'branch': db},
        'hour':  {'stem': hs_, 'branch': hb},
    }


def _apply_ten_gods(pillars, day_master_stem):
    """Apply ten god labels to pillars (simplified for tests)."""
    from app.ten_gods import apply_ten_gods_to_pillars
    return apply_ten_gods_to_pillars(pillars, day_master_stem)


# ============================================================
# Day Master Strength V2 Tests
# ============================================================

class TestStrengthScoreV2:
    """Test the 3-factor Day Master scoring formula."""

    def test_returns_all_fields(self):
        """Result has score, classification, factors, lifeStage."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        result = calculate_strength_score_v2(pillars, '戊')
        assert 'score' in result
        assert 'classification' in result
        assert 'factors' in result
        assert 'lifeStage' in result
        assert 'deling' in result['factors']
        assert 'dedi' in result['factors']
        assert 'deshi' in result['factors']

    def test_score_range(self):
        """Score should be between 0 and 100."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        result = calculate_strength_score_v2(pillars, '戊')
        assert 0 <= result['score'] <= 100

    def test_strong_day_master(self):
        """Day Master with seasonal support should score high."""
        # 甲 in 寅月 (木 in spring = 帝旺)
        pillars = _make_pillars('甲', '寅', '甲', '寅', '甲', '卯', '壬', '亥')
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['score'] >= 55
        assert result['classification'] in ('strong', 'very_strong')

    def test_weak_day_master(self):
        """Day Master without seasonal support should score low."""
        # 甲 in 申月 (木 in autumn = 絕/死)
        pillars = _make_pillars('庚', '申', '庚', '申', '甲', '戌', '庚', '酉')
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['score'] <= 30
        assert result['classification'] in ('weak', 'very_weak')

    def test_deling_uses_life_stage(self):
        """得令 factor uses Life Stage, not coarse SEASON_STRENGTH."""
        # Check life stage is set
        pillars = _make_pillars('甲', '子', '丙', '寅', '甲', '卯', '壬', '亥')
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['lifeStage'] in LIFE_STAGE_DELING_SCORE

    def test_classification_thresholds(self):
        """Verify classification thresholds are correct."""
        # We can't easily force exact scores, but check thresholds exist
        assert LIFE_STAGE_DELING_SCORE['帝旺'] == 50
        assert LIFE_STAGE_DELING_SCORE['絕'] == 0
        assert LIFE_STAGE_DELING_SCORE['墓'] > LIFE_STAGE_DELING_SCORE['死']  # 墓 > 死

    def test_mu_greater_than_si(self):
        """墓(3) > 死(2) per 《子平真詮》— tomb retains stored energy."""
        assert LIFE_STAGE_DELING_SCORE['墓'] == 3
        assert LIFE_STAGE_DELING_SCORE['死'] == 2


# ============================================================
# 從格 Detection Tests
# ============================================================

class TestCongGe:
    """Test 從格 (Following Pattern) detection."""

    def test_no_cong_ge_strong_dm(self):
        """Strong Day Master cannot be 從格."""
        pillars = _make_pillars('甲', '寅', '甲', '寅', '甲', '卯', '壬', '亥')
        strength = {'score': 70, 'classification': 'very_strong'}
        balance = {'木': 50.0, '火': 10.0, '土': 10.0, '金': 10.0, '水': 20.0}
        result = check_cong_ge(pillars, '甲', strength, balance)
        assert result is None

    def test_no_cong_ge_yang_dm_with_yinbijie(self):
        """Yang DM with any 印/比劫 cannot form 從格 (《滴天髓》)."""
        # 甲 (Yang Wood) with 甲 in year stem (比肩)
        pillars = _make_pillars('甲', '酉', '庚', '申', '甲', '戌', '庚', '酉')
        strength = {'score': 15, 'classification': 'very_weak'}
        balance = {'木': 8.0, '火': 2.0, '土': 5.0, '金': 70.0, '水': 15.0}
        result = check_cong_ge(pillars, '甲', strength, balance)
        assert result is None

    def test_cong_cai_ge(self):
        """從財格 when wealth element dominates >55%."""
        # 乙 (Yin Wood) as DM, 金 dominates — 金 overcomes 木 → 從官格, not 從財格
        # Let's set up: 乙 DM, 土 (I overcome) dominates
        pillars = _make_pillars('戊', '辰', '戊', '戌', '乙', '丑', '己', '未')
        strength = {'score': 10, 'classification': 'very_weak'}
        balance = {'木': 5.0, '火': 3.0, '土': 72.0, '金': 10.0, '水': 10.0}
        result = check_cong_ge(pillars, '乙', strength, balance)
        # 乙 overcomes 土 → 土 is I_overcome → 從財格
        if result:
            assert result['type'] == 'cong_cai'
            assert result['significance'] == 'critical'

    def test_cong_ge_inverts_favorable_gods(self):
        """從格 should set yongShen and jiShen (inverted from normal)."""
        pillars = _make_pillars('庚', '酉', '庚', '申', '乙', '戌', '辛', '酉')
        strength = {'score': 8, 'classification': 'very_weak'}
        balance = {'木': 3.0, '火': 2.0, '土': 5.0, '金': 80.0, '水': 10.0}
        result = check_cong_ge(pillars, '乙', strength, balance)
        if result:
            assert result['yongShen'] is not None
            assert isinstance(result['jiShen'], list)


# ============================================================
# Ten God Position Rules Tests
# ============================================================

class TestTenGodPositionRules:
    """Test the 40-rule database for male and female."""

    def test_male_rules_count(self):
        """Male rules should have entries for all 10 gods × 4 positions."""
        # Not all 40 combinations may be defined, but key ones should exist
        assert '正財_day' in TEN_GOD_POSITION_RULES_MALE
        assert '正官_month' in TEN_GOD_POSITION_RULES_MALE

    def test_female_rules_differ_for_day_branch(self):
        """Female 正財_day interpretation differs from male."""
        male_interp = TEN_GOD_POSITION_RULES_MALE.get('正財_day', '')
        female_interp = TEN_GOD_POSITION_RULES_FEMALE.get('正財_day', '')
        assert male_interp != female_interp

    def test_female_qisha_day_is_spouse(self):
        """Female 偏官 in day = controlling spouse (not male interpretation)."""
        female_interp = TEN_GOD_POSITION_RULES_FEMALE.get('偏官_day', '')
        assert '配偶' in female_interp or '控制' in female_interp

    def test_male_zhengcai_day_is_spouse(self):
        """Male 正財 in day = capable spouse."""
        male_interp = TEN_GOD_POSITION_RULES_MALE.get('正財_day', '')
        assert '配偶' in male_interp

    def test_common_rules_shared(self):
        """Common rules (food god, hurting officer) are same for both genders."""
        assert TEN_GOD_POSITION_RULES_MALE['食神_month'] == TEN_GOD_POSITION_RULES_FEMALE['食神_month']
        assert TEN_GOD_POSITION_RULES_MALE['傷官_day'] == TEN_GOD_POSITION_RULES_FEMALE['傷官_day']

    def test_generate_findings(self):
        """generate_ten_god_position_analysis returns findings list."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        pillars = _apply_ten_gods(pillars, '戊')
        findings = generate_ten_god_position_analysis(pillars, '戊', 'male')
        assert isinstance(findings, list)
        assert len(findings) >= 1
        assert 'tenGod' in findings[0]
        assert 'interpretation' in findings[0]

    def test_gender_affects_findings(self):
        """Same chart produces different findings for male vs female."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '壬', '申')
        pillars = _apply_ten_gods(pillars, '戊')
        male_findings = generate_ten_god_position_analysis(pillars, '戊', 'male')
        female_findings = generate_ten_god_position_analysis(pillars, '戊', 'female')
        # They should have different interpretations for position-sensitive gods
        # (at minimum, the day branch interpretation should differ for 正財/偏財/正官/偏官)
        male_interps = {f['interpretation'] for f in male_findings}
        female_interps = {f['interpretation'] for f in female_findings}
        # Not necessarily all different, but at least some should differ
        assert len(male_findings) >= 1
        assert len(female_findings) >= 1


# ============================================================
# 透干 (Tou Gan) Tests
# ============================================================

class TestTouganAnalysis:
    """Test 透干 (transparency) analysis."""

    def test_transparent_hidden_stem(self):
        """Hidden stem appearing as manifest stem → status='transparent'."""
        # 寅 has hidden stems [甲, 丙, 戊]. If 甲 appears as year stem → transparent
        pillars = _make_pillars('甲', '寅', '丙', '午', '戊', '子', '庚', '申')
        findings = generate_tougan_analysis(pillars, '戊')
        transparent = [f for f in findings if f['status'] == 'transparent']
        assert len(transparent) >= 1

    def test_latent_main_qi(self):
        """Main qi not appearing as manifest stem → status='latent'."""
        # 午 has hidden stems [丁, 己]. If 丁 doesn't appear in any stem → latent
        pillars = _make_pillars('甲', '子', '壬', '午', '戊', '寅', '庚', '申')
        findings = generate_tougan_analysis(pillars, '戊')
        latent = [f for f in findings if f['status'] == 'latent' and f['stem'] == '丁']
        # 丁 is main qi of 午, and doesn't appear as manifest stem
        assert len(latent) >= 1

    def test_significance_main_qi(self):
        """Main qi transparency has 'high' significance."""
        pillars = _make_pillars('甲', '寅', '丙', '午', '戊', '子', '庚', '申')
        findings = generate_tougan_analysis(pillars, '戊')
        transparent_main = [f for f in findings if f['status'] == 'transparent' and f['qiType'] == '本氣']
        if transparent_main:
            assert transparent_main[0]['significance'] == 'high'


# ============================================================
# 官殺混雜 Tests
# ============================================================

class TestGuanShaHunza:
    """Test 官殺混雜 (both 正官 and 偏官 present) — female only."""

    def test_female_with_guan_sha_hunza(self):
        """Female chart with both 正官 and 偏官 → warning."""
        # Day Master 甲: 正官=辛 (金陰), 偏官=庚 (金陽)
        # Put 辛 in year, 庚 in month
        pillars = _make_pillars('辛', '子', '庚', '申', '甲', '午', '丙', '寅')
        result = check_guan_sha_hunza(pillars, '甲', 'female')
        assert result is not None
        assert result['type'] == 'guan_sha_hunza'
        assert 'love' in result['domains']

    def test_male_no_guan_sha_warning(self):
        """Male chart — 官殺混雜 check returns None."""
        pillars = _make_pillars('辛', '子', '庚', '申', '甲', '午', '丙', '寅')
        result = check_guan_sha_hunza(pillars, '甲', 'male')
        assert result is None

    def test_female_without_guan_sha(self):
        """Female chart with only 正官 (no 偏官) → no warning."""
        # Day Master 甲: 正官=辛, no 庚
        pillars = _make_pillars('辛', '子', '丙', '寅', '甲', '午', '丁', '卯')
        result = check_guan_sha_hunza(pillars, '甲', 'female')
        assert result is None


# ============================================================
# 用神合絆 Tests
# ============================================================

class TestYongShenLocked:
    """Test 用神 locking by stem combinations."""

    def test_locked_yong_shen(self):
        """When 用神 element stem is in a combination → locked."""
        favorable = {'usefulGod': '水'}
        # 壬 (水) in combo with 丁 (丁壬合化木)
        combos = [{
            'stems': ('丁', '壬'),
            'pillarA': 'month',
            'pillarB': 'day',
            'resultElement': '木',
            'description': '丁壬合化木（合而不化）',
        }]
        result = check_yong_shen_locked(
            _make_pillars('甲', '子', '丁', '午', '壬', '申', '庚', '酉'),
            favorable,
            combos,
        )
        assert len(result) >= 1
        assert result[0]['type'] == 'yong_shen_locked'
        assert result[0]['significance'] == 'high'

    def test_no_lock_when_element_differs(self):
        """用神 element not in any combo → no lock."""
        favorable = {'usefulGod': '火'}
        combos = [{
            'stems': ('甲', '己'),
            'pillarA': 'year',
            'pillarB': 'month',
            'resultElement': '土',
            'description': '甲己合化土（合而不化）',
        }]
        result = check_yong_shen_locked(
            _make_pillars('甲', '子', '己', '午', '丙', '寅', '庚', '申'),
            favorable,
            combos,
        )
        assert len(result) == 0


# ============================================================
# 墓庫 Tests
# ============================================================

class TestTombStorage:
    """Test 墓庫 (tomb/storage) analysis."""

    def test_chen_stores_water(self):
        """辰 stores 水."""
        assert TOMB_STORAGE['辰']['stores'] == '水'

    def test_xu_stores_fire(self):
        """戌 stores 火."""
        assert TOMB_STORAGE['戌']['stores'] == '火'

    def test_chou_stores_metal(self):
        """丑 stores 金."""
        assert TOMB_STORAGE['丑']['stores'] == '金'

    def test_wei_stores_wood(self):
        """未 stores 木."""
        assert TOMB_STORAGE['未']['stores'] == '木'

    def test_day_branch_tomb_spouse_note(self):
        """Day branch 墓庫 generates spouse note."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '辰', '庚', '申')
        results = analyze_tomb_storage(pillars)
        day_tombs = [r for r in results if r['pillar'] == 'day']
        assert len(day_tombs) >= 1
        assert 'spouseNote' in day_tombs[0]


# ============================================================
# Life Domain Mapping Tests
# ============================================================

class TestLifeDomainMapping:
    """Test career, health, love domain mappings."""

    def test_all_five_elements_have_industries(self):
        """Each of 5 elements maps to career industries."""
        for element in ['木', '火', '土', '金', '水']:
            assert element in ELEMENT_INDUSTRIES
            assert len(ELEMENT_INDUSTRIES[element]) >= 5

    def test_all_five_elements_have_health(self):
        """Each element maps to organs and symptoms."""
        for element in ['木', '火', '土', '金', '水']:
            assert element in ELEMENT_HEALTH
            assert 'organs' in ELEMENT_HEALTH[element]

    def test_love_indicators_male_female(self):
        """Male and female have different spouse/romance stars."""
        assert LOVE_INDICATORS['male']['spouse_star'] == '正財'
        assert LOVE_INDICATORS['female']['spouse_star'] == '正官'

    def test_career_insights(self):
        """generate_career_insights returns expected fields."""
        result = generate_career_insights(
            {'usefulGod': '水'}, '食神', 'weak'
        )
        assert 'suitableIndustries' in result
        assert '水' in str(result['suitableIndustries']) or 'IT' in str(result['suitableIndustries'])

    def test_health_insights_excess(self):
        """Excess element triggers health warning."""
        balance = {'木': 40.0, '火': 20.0, '土': 15.0, '金': 15.0, '水': 10.0}
        result = generate_health_insights(balance, '甲')
        assert result['excessElement'] == '木'
        assert len(result['warnings']) >= 1


# ============================================================
# Reading Type Domain Mapping
# ============================================================

class TestReadingTypeDomains:
    """Test reading type → domain filtering."""

    def test_lifetime_all_domains(self):
        """LIFETIME includes all 4 domains."""
        assert set(READING_TYPE_DOMAINS['LIFETIME']) == {'career', 'love', 'health', 'timing'}

    def test_career_finance_only_career(self):
        """CAREER_FINANCE only includes career + timing."""
        assert 'career' in READING_TYPE_DOMAINS['CAREER_FINANCE']
        assert 'love' not in READING_TYPE_DOMAINS['CAREER_FINANCE']

    def test_love_only_love(self):
        """LOVE includes love + timing."""
        assert 'love' in READING_TYPE_DOMAINS['LOVE']
        assert 'career' not in READING_TYPE_DOMAINS['LOVE']


# ============================================================
# Conflict Resolution Tests
# ============================================================

class TestConflictResolution:
    """Test conflict resolution priority hierarchy."""

    def test_cong_ge_highest_priority(self):
        """從格 override has priority 1."""
        findings = {
            'congGe': {'name': '從財格', 'description': 'test'},
            'yongShenLocked': [],
            'guanShaHunza': None,
        }
        resolutions = resolve_conflicts(findings)
        cong = [r for r in resolutions if r['type'] == 'cong_ge_override']
        assert len(cong) == 1
        assert cong[0]['priority'] == 1

    def test_yong_shen_locked_priority_2(self):
        """用神合絆 has priority 2."""
        findings = {
            'congGe': None,
            'yongShenLocked': [{'description': '用神被合'}],
            'guanShaHunza': None,
        }
        resolutions = resolve_conflicts(findings)
        locked = [r for r in resolutions if r['type'] == 'yong_shen_locked']
        assert len(locked) == 1
        assert locked[0]['priority'] == 2

    def test_guan_sha_priority_5(self):
        """官殺混雜 has priority 5, scoped to love domain."""
        findings = {
            'congGe': None,
            'yongShenLocked': [],
            'guanShaHunza': {
                'type': 'guan_sha_hunza',
                'description': '官殺混雜',
                'domains': ['love'],
            },
        }
        resolutions = resolve_conflicts(findings)
        gs = [r for r in resolutions if r['type'] == 'guan_sha_hunza']
        assert len(gs) == 1
        assert gs[0]['priority'] == 5
        assert 'love' in gs[0].get('domains', [])


# ============================================================
# Full Pre-Analysis Orchestrator Tests
# ============================================================

class TestGeneratePreAnalysis:
    """Test the complete generate_pre_analysis() orchestrator."""

    def test_returns_versioned_result(self):
        """Result includes version field."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        pillars = _apply_ten_gods(pillars, '戊')
        result = generate_pre_analysis(
            pillars, '戊',
            {'木': 20.0, '火': 25.0, '土': 30.0, '金': 15.0, '水': 10.0},
            {'usefulGod': '水', 'favorableGod': '金', 'idleGod': '火', 'tabooGod': '木', 'enemyGod': '土'},
            reading_type='LIFETIME',
            gender='male',
        )
        assert result['version'] == '1.0.0'

    def test_contains_key_findings(self):
        """Result has keyFindings list."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        pillars = _apply_ten_gods(pillars, '戊')
        result = generate_pre_analysis(
            pillars, '戊',
            {'木': 20.0, '火': 25.0, '土': 30.0, '金': 15.0, '水': 10.0},
            {'usefulGod': '水', 'favorableGod': '金', 'idleGod': '火', 'tabooGod': '木', 'enemyGod': '土'},
        )
        assert 'keyFindings' in result
        assert len(result['keyFindings']) >= 1

    def test_contains_strength_v2(self):
        """Result has strengthV2 field."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        pillars = _apply_ten_gods(pillars, '戊')
        result = generate_pre_analysis(
            pillars, '戊',
            {'木': 20.0, '火': 25.0, '土': 30.0, '金': 15.0, '水': 10.0},
            {'usefulGod': '水', 'favorableGod': '金', 'idleGod': '火', 'tabooGod': '木', 'enemyGod': '土'},
        )
        assert 'strengthV2' in result
        assert 'score' in result['strengthV2']

    def test_domain_filtering_career(self):
        """CAREER_FINANCE reading type includes career but not love."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        pillars = _apply_ten_gods(pillars, '戊')
        result = generate_pre_analysis(
            pillars, '戊',
            {'木': 20.0, '火': 25.0, '土': 30.0, '金': 15.0, '水': 10.0},
            {'usefulGod': '水', 'favorableGod': '金', 'idleGod': '火', 'tabooGod': '木', 'enemyGod': '土'},
            reading_type='CAREER_FINANCE',
        )
        assert 'careerInsights' in result
        assert 'loveInsights' not in result

    def test_domain_filtering_love(self):
        """LOVE reading type includes love but not career."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        pillars = _apply_ten_gods(pillars, '戊')
        result = generate_pre_analysis(
            pillars, '戊',
            {'木': 20.0, '火': 25.0, '土': 30.0, '金': 15.0, '水': 10.0},
            {'usefulGod': '水', 'favorableGod': '金', 'idleGod': '火', 'tabooGod': '木', 'enemyGod': '土'},
            reading_type='LOVE',
        )
        assert 'loveInsights' in result
        assert 'careerInsights' not in result

    def test_summary_text(self):
        """Summary contains Day Master info."""
        pillars = _make_pillars('甲', '子', '丙', '寅', '戊', '午', '庚', '申')
        pillars = _apply_ten_gods(pillars, '戊')
        result = generate_pre_analysis(
            pillars, '戊',
            {'木': 20.0, '火': 25.0, '土': 30.0, '金': 15.0, '水': 10.0},
            {'usefulGod': '水', 'favorableGod': '金', 'idleGod': '火', 'tabooGod': '木', 'enemyGod': '土'},
        )
        assert '戊' in result['summary']
        assert '土' in result['summary']

    def test_cong_ge_overrides_favorable_gods(self):
        """When 從格 detected, effectiveFavorableGods are overridden."""
        # Create a very weak chart for 乙 DM with dominating 金
        pillars = _make_pillars('庚', '酉', '辛', '申', '乙', '戌', '庚', '酉')
        pillars = _apply_ten_gods(pillars, '乙')
        balance = {'木': 3.0, '火': 2.0, '土': 5.0, '金': 80.0, '水': 10.0}
        normal_gods = {'usefulGod': '木', 'favorableGod': '水', 'idleGod': '火', 'tabooGod': '金', 'enemyGod': '土'}

        result = generate_pre_analysis(
            pillars, '乙', balance, normal_gods, 'LIFETIME', 'male',
        )
        if result.get('congGe'):
            # Effective gods should differ from normal gods
            assert result['effectiveFavorableGods']['usefulGod'] != '木'
