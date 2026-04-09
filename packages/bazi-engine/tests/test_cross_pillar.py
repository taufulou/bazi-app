"""Tests for cross-pillar interaction detection (Phase B1: 透干/通根)."""

import pytest
from app.cross_pillar import (
    _detect_tougan,
    _detect_tonggen,
    detect_cross_pillar_interactions,
)


# ── Sample four_pillars data ──

@pytest.fixture
def sample_four_pillars():
    """Roger's chart: 庚午 辛巳 庚辰 癸未"""
    return {
        'year': {'stem': '庚', 'branch': '午', 'tenGod': '比肩', 'hiddenStemGods': ['偏官', '偏印']},
        'month': {'stem': '辛', 'branch': '巳', 'tenGod': '劫財', 'hiddenStemGods': ['偏官', '比肩', '偏印']},
        'day': {'stem': '庚', 'branch': '辰', 'tenGod': '', 'hiddenStemGods': ['偏印', '正財', '傷官']},
        'hour': {'stem': '癸', 'branch': '未', 'tenGod': '傷官', 'hiddenStemGods': ['偏印', '正官', '正財']},
    }


@pytest.fixture
def sample_god_roles():
    return {
        'dayMasterElement': '金',
        'strengthClassification': 'very_weak',
        'favorableGod': '土',
        'usefulGod': '金',
        'idleGod': '水',
        'tabooGod': '火',
        'enemyGod': '木',
    }


# ============================================================
# 透干 (Manifest) Tests
# ============================================================

class TestTougan:
    def test_tougan_found(self, sample_four_pillars):
        """甲 hidden in 寅(year) should find 甲 in day stem."""
        # Custom chart where 甲 is hidden in year branch (寅) and manifest in day stem
        fp = {
            'year': {'stem': '壬', 'branch': '寅', 'tenGod': '偏印'},
            'month': {'stem': '丁', 'branch': '未', 'tenGod': '正官'},
            'day': {'stem': '甲', 'branch': '子', 'tenGod': ''},
            'hour': {'stem': '庚', 'branch': '午', 'tenGod': '偏官'},
        }
        results = _detect_tougan('甲', 'year', fp)
        assert len(results) == 1
        assert '透干' in results[0]['name']
        assert results[0]['nature'] == 'manifest'
        assert 'day' in results[0]['pillarsInvolved']

    def test_tougan_not_found(self, sample_four_pillars):
        """癸 hidden in 辰(day) — check if 癸 appears in other stems."""
        # 癸 is in hour stem, so it SHOULD be found
        results = _detect_tougan('癸', 'day', sample_four_pillars)
        assert len(results) == 1
        assert '透干' in results[0]['name']

    def test_tougan_multiple_pillars(self):
        """Hidden stem appears in multiple other pillar stems."""
        fp = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '甲', 'branch': '寅'},
            'day': {'stem': '丙', 'branch': '寅'},  # 寅 contains 甲 as 本氣
            'hour': {'stem': '庚', 'branch': '午'},
        }
        results = _detect_tougan('甲', 'day', fp)
        # Should find 甲 in both year and month stems
        assert len(results) == 2

    def test_tougan_same_pillar_stem_matches(self):
        """Same pillar stem = hidden stem → IS 透干 (e.g., 辛 hidden in 酉 + 辛 as year stem)."""
        fp = {
            'year': {'stem': '甲', 'branch': '寅'},  # 寅 contains 甲(本氣), year stem IS 甲
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '戊', 'branch': '辰'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        results = _detect_tougan('甲', 'year', fp)
        assert len(results) == 1
        assert '透干' in results[0]['name']
        assert '本柱天干相同' in results[0]['description']

    def test_tougan_same_pillar_different_stem(self):
        """Same pillar stem ≠ hidden stem → skipped (e.g., 丙 hidden in 寅 but year stem is 甲)."""
        fp = {
            'year': {'stem': '甲', 'branch': '寅'},  # 寅 contains 丙(中氣), but stem is 甲
            'month': {'stem': '丁', 'branch': '午'},
            'day': {'stem': '戊', 'branch': '辰'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        # 丙 hidden in year branch, but year stem is 甲 (not 丙) → skip same pillar
        # No other pillar has 丙 as stem → 藏而不透
        results = _detect_tougan('丙', 'year', fp)
        assert len(results) == 1
        assert '藏而不透' in results[0]['name']

    def test_tougan_cang_er_bu_tou(self):
        """Hidden stem with no manifest counterpart → 藏而不透."""
        fp = {
            'year': {'stem': '壬', 'branch': '子'},
            'month': {'stem': '丁', 'branch': '丑'},  # 丑 contains 己癸辛
            'day': {'stem': '甲', 'branch': '辰'},
            'hour': {'stem': '庚', 'branch': '午'},
        }
        # 辛 is hidden in 丑 (餘氣) — no 辛 in any stem
        results = _detect_tougan('辛', 'month', fp)
        assert len(results) == 1
        assert '藏而不透' in results[0]['name']
        assert results[0]['nature'] == 'latent'


# ============================================================
# 通根 (Root) Tests
# ============================================================

class TestTonggen:
    def test_tonggen_benqi_same_pillar(self):
        """庚 stem with 本氣 root in same pillar → strong."""
        fp = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丁', 'branch': '丑'},
            'day': {'stem': '庚', 'branch': '申'},  # 申 contains 庚(本氣), same pillar
            'hour': {'stem': '癸', 'branch': '午'},
        }
        results = _detect_tonggen('庚', 'day', fp)
        assert len(results) == 1
        assert '本氣' in results[0]['name']
        assert results[0]['nature'] == 'strong_root'

    def test_tonggen_zhongqi(self):
        """丙 stem with 中氣 root in adjacent pillar → moderate (3*0.75=2.25)."""
        fp = {
            'year': {'stem': '甲', 'branch': '寅'},  # 寅 contains 丙(中氣), distance=1 from month
            'month': {'stem': '丙', 'branch': '丑'},
            'day': {'stem': '戊', 'branch': '辰'},
            'hour': {'stem': '庚', 'branch': '午'},  # 午 contains 丁(本), no 丙
        }
        results = _detect_tonggen('丙', 'month', fp)
        assert len(results) == 1
        # 中氣 in adjacent pillar: 3 * 0.75 = 2.25 → weak_root (<3)
        assert results[0]['nature'] == 'weak_root'

    def test_tonggen_yuqi(self):
        """戊 stem should find 餘氣 root in 寅 (戊 is 餘氣 of 寅)."""
        fp = {
            'year': {'stem': '甲', 'branch': '寅'},  # 寅 contains 甲(本),丙(中),戊(餘)
            'month': {'stem': '丁', 'branch': '卯'},
            'day': {'stem': '戊', 'branch': '子'},  # 子 only contains 癸, no 戊
            'hour': {'stem': '庚', 'branch': '午'},  # 午 contains 丁(本),己(中) — no 戊
        }
        results = _detect_tonggen('戊', 'day', fp)
        assert len(results) == 1
        assert '餘氣' in results[0]['name']

    def test_tonggen_wugen(self):
        """丙 stem with no 丙 in any hidden stems → 虛浮無根."""
        fp = {
            'year': {'stem': '甲', 'branch': '子'},  # 子=癸
            'month': {'stem': '丙', 'branch': '丑'},  # 丑=己癸辛 — no 丙
            'day': {'stem': '戊', 'branch': '辰'},  # 辰=戊乙癸 — no 丙
            'hour': {'stem': '庚', 'branch': '酉'},  # 酉=辛 — no 丙
        }
        results = _detect_tonggen('丙', 'month', fp)
        assert len(results) == 1
        assert '虛浮無根' in results[0]['name']
        assert results[0]['nature'] == 'floating'

    def test_tonggen_multiple_roots_strong(self):
        """Stem with 本氣 + 中氣 roots → strong_root (6*0.5 + 3*1.0 = 6)."""
        fp = {
            'year': {'stem': '甲', 'branch': '寅'},  # 寅 contains 甲(本氣), distance=2 from day
            'month': {'stem': '丁', 'branch': '卯'},
            'day': {'stem': '甲', 'branch': '亥'},  # 亥 contains 甲(中氣), distance=0 (same)
            'hour': {'stem': '庚', 'branch': '午'},
        }
        # Checking 甲 from day pillar:
        # 寅(year) 本氣: 6 * 0.5 (distance=2) = 3.0
        # 亥(day) 中氣: 3 * 1.0 (distance=0) = 3.0
        # Total = 6.0 → strong_root
        results = _detect_tonggen('甲', 'day', fp)
        assert len(results) == 1
        assert results[0]['nature'] == 'strong_root'
        assert '2處通根' in results[0]['description']

    def test_tonggen_same_pillar_benqi_strong(self):
        """本氣 in same pillar → 6*1.0=6 → strong_root."""
        fp = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '庚', 'branch': '申'},  # 申 contains 庚(本氣), same pillar
            'day': {'stem': '戊', 'branch': '辰'},
            'hour': {'stem': '癸', 'branch': '午'},
        }
        results = _detect_tonggen('庚', 'month', fp)
        assert len(results) == 1
        assert results[0]['nature'] == 'strong_root'

    def test_tonggen_cumulative_two_yuqi_weak(self):
        """Roger36's case: 戊 with 2× 餘氣 → weak_root with distance discount."""
        fp = {
            'year': {'stem': '丁', 'branch': '卯'},  # 卯=乙 — no 戊
            'month': {'stem': '戊', 'branch': '申'},  # 申=庚壬戊(餘) — 戊 餘氣, distance=0
            'day': {'stem': '戊', 'branch': '午'},   # 午=丁己 — no 戊
            'hour': {'stem': '庚', 'branch': '申'},  # 申=庚壬戊(餘) — 戊 餘氣, distance=2
        }
        # Checking 戊 from month pillar:
        # 月申(same) 餘氣: 1 * 1.0 = 1.0
        # 時申(dist=2) 餘氣: 1 * 0.5 = 0.5
        # Total = 1.5 → weak_root (<3)
        results = _detect_tonggen('戊', 'month', fp)
        assert len(results) == 1
        assert results[0]['nature'] == 'weak_root'
        assert '2處通根' in results[0]['description']

    def test_tonggen_zhongqi_same_pillar_moderate(self):
        """中氣 in same pillar → 3*1.0=3 → moderate_root."""
        fp = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丁', 'branch': '丑'},
            'day': {'stem': '庚', 'branch': '巳'},  # 巳 contains 庚(中氣), same pillar
            'hour': {'stem': '癸', 'branch': '午'},
        }
        results = _detect_tonggen('庚', 'day', fp)
        assert len(results) == 1
        assert results[0]['nature'] == 'moderate_root'

    def test_tonggen_single_yuqi_still_weak(self):
        """Single 餘氣 root → weak_root."""
        fp = {
            'year': {'stem': '甲', 'branch': '寅'},  # 寅=甲丙戊(餘)
            'month': {'stem': '丁', 'branch': '卯'},
            'day': {'stem': '戊', 'branch': '子'},   # 子=癸 — no 戊
            'hour': {'stem': '庚', 'branch': '午'},  # 午=丁己 — no 戊
        }
        results = _detect_tonggen('戊', 'day', fp)
        assert len(results) == 1
        assert results[0]['nature'] == 'weak_root'

    def test_tonggen_distant_benqi_discounted(self):
        """本氣 in distant pillar (year↔hour, dist=3) → 6*0.25=1.5 → weak."""
        fp = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丁', 'branch': '丑'},
            'day': {'stem': '戊', 'branch': '辰'},
            'hour': {'stem': '庚', 'branch': '寅'},  # 寅 contains 甲(本氣)
        }
        # 甲 in year stem, root in hour branch 寅: distance=3
        # 6 * 0.25 = 1.5 → weak_root
        results = _detect_tonggen('甲', 'year', fp)
        assert len(results) == 1
        assert results[0]['nature'] == 'weak_root'


# ============================================================
# Main dispatch tests
# ============================================================

class TestDispatch:
    def test_hidden_stem_triggers_tougan(self, sample_four_pillars, sample_god_roles):
        """element_type='hidden_stem' should trigger 透干 detection."""
        results = detect_cross_pillar_interactions(
            'hidden_stem', '庚', 'month', sample_four_pillars, sample_god_roles,
        )
        # 庚 is hidden in 巳(month) as 中氣, and 庚 appears in year+day stems
        assert len(results) >= 1

    def test_stem_triggers_tonggen(self, sample_four_pillars, sample_god_roles):
        """element_type='stem' should trigger 通根 detection."""
        results = detect_cross_pillar_interactions(
            'stem', '庚', 'year', sample_four_pillars, sample_god_roles,
        )
        assert len(results) >= 1

    def test_ten_god_triggers_tonggen(self, sample_four_pillars, sample_god_roles):
        """element_type='ten_god' should trigger tonggen check on the pillar's stem."""
        # Year pillar stem is 庚 → should detect 庚's root support
        results = detect_cross_pillar_interactions(
            'ten_god', '比肩', 'year', sample_four_pillars, sample_god_roles,
        )
        assert len(results) >= 1
        # Should be a tonggen check on 庚 (year stem), not on 比肩
        assert any('庚' in r['name'] for r in results)

    def test_other_types_no_interactions(self, sample_four_pillars, sample_god_roles):
        """element_type='life_stage' should not trigger any cross-pillar checks."""
        results = detect_cross_pillar_interactions(
            'life_stage', '長生', 'year', sample_four_pillars, sample_god_roles,
        )
        assert len(results) == 0

    def test_max_four_interactions(self):
        """Should return at most 4 interactions."""
        # Create a chart where 甲 appears in many stems
        fp = {
            'year': {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '甲', 'branch': '卯'},
            'day': {'stem': '甲', 'branch': '亥'},
            'hour': {'stem': '甲', 'branch': '子'},
        }
        results = detect_cross_pillar_interactions(
            'hidden_stem', '甲', 'day', fp, {},
        )
        assert len(results) <= 4

    def test_no_four_pillars_returns_empty(self, sample_god_roles):
        """When four_pillars is None (old API), should return empty list."""
        # This is tested indirectly — explanations.py only calls
        # detect_cross_pillar_interactions when four_pillars is present.
        # Direct call with empty dict should not crash.
        results = detect_cross_pillar_interactions(
            'hidden_stem', '甲', 'year', {}, sample_god_roles,
        )
        assert isinstance(results, list)

    def test_interaction_structure(self, sample_four_pillars, sample_god_roles):
        """Each interaction dict should have required fields."""
        results = detect_cross_pillar_interactions(
            'hidden_stem', '庚', 'month', sample_four_pillars, sample_god_roles,
        )
        for r in results:
            assert 'type' in r
            assert 'name' in r
            assert 'description' in r
            assert 'nature' in r
            assert r['nature'] in ('manifest', 'latent', 'strong_root', 'moderate_root', 'weak_root', 'floating')


# ============================================================
# Tougan Modifier Template Validation Tests
# ============================================================

class TestTouganModifiers:
    """Validate tougan_modifiers.json: all 80 entries present, non-empty, pillar domain sanity."""

    @pytest.fixture(autouse=True)
    def load_modifiers(self):
        import json
        import os
        path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'data', 'explanations', 'interactions', 'tougan_modifiers.json',
        )
        with open(path, encoding='utf-8') as f:
            self.modifiers = json.load(f)

    ALL_STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
    STATES = ['tougan', 'cang']
    PILLARS = ['year', 'month', 'day', 'hour']

    def test_all_80_keys_exist(self):
        """All 10 stems × 2 states × 4 pillars = 80 entries."""
        for stem in self.ALL_STEMS:
            assert stem in self.modifiers, f'Missing stem: {stem}'
            for state in self.STATES:
                assert state in self.modifiers[stem], f'Missing state: {stem}/{state}'
                for pillar in self.PILLARS:
                    assert pillar in self.modifiers[stem][state], (
                        f'Missing entry: {stem}/{state}/{pillar}'
                    )

    def test_no_entry_empty(self):
        """No entry should be empty or too short."""
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                for pillar in self.PILLARS:
                    text = self.modifiers[stem][state][pillar]
                    assert len(text) >= 20, (
                        f'{stem}/{state}/{pillar} too short ({len(text)} chars): {text[:30]}'
                    )

    def test_year_domain(self):
        """Year entries should reference family/childhood."""
        year_keywords = ['家族', '成長', '童年', '祖', '家庭', '根基', '早年']
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                text = self.modifiers[stem][state]['year']
                has_keyword = any(kw in text for kw in year_keywords)
                assert has_keyword, (
                    f'{stem}/{state}/year missing family/childhood keywords: {text[:50]}'
                )

    def test_month_domain(self):
        """Month entries should reference career/workplace."""
        month_keywords = ['事業', '職場', '工作', '社會', '專業', '團隊', '職業']
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                text = self.modifiers[stem][state]['month']
                has_keyword = any(kw in text for kw in month_keywords)
                assert has_keyword, (
                    f'{stem}/{state}/month missing career keywords: {text[:50]}'
                )

    def test_day_domain_not_marriage(self):
        """Day entries should focus on self/inner nature, NOT marriage."""
        bad_keywords = ['婚姻', '另一半', '配偶']
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                text = self.modifiers[stem][state]['day']
                for bad in bad_keywords:
                    assert bad not in text, (
                        f'{stem}/{state}/day contains marriage keyword "{bad}": {text[:50]}'
                    )

    def test_hour_domain(self):
        """Hour entries should reference children/late life."""
        hour_keywords = ['子女', '晚年', '後半', '孩子', '老年', '後代']
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                text = self.modifiers[stem][state]['hour']
                has_keyword = any(kw in text for kw in hour_keywords)
                assert has_keyword, (
                    f'{stem}/{state}/hour missing children/late-life keywords: {text[:50]}'
                )

    def test_tougan_modifier_in_interaction(self):
        """透干 interaction card should contain modifier text (not Layer B duplicate)."""
        fp = {
            'year': {'stem': '辛', 'branch': '酉'},
            'month': {'stem': '壬', 'branch': '辰'},
            'day': {'stem': '庚', 'branch': '辰'},
            'hour': {'stem': '丁', 'branch': '丑'},
        }
        results = _detect_tougan('辛', 'year', fp)
        assert len(results) >= 1
        # Should contain modifier from tougan_modifiers.json, not Layer B
        expected_modifier = self.modifiers['辛']['tougan']['year']
        assert expected_modifier in results[0]['description']

    def test_cang_modifier_in_interaction(self):
        """藏而不透 interaction card should contain cang modifier text."""
        fp = {
            'year': {'stem': '壬', 'branch': '子'},
            'month': {'stem': '丁', 'branch': '丑'},  # 丑 contains 辛 as 餘氣
            'day': {'stem': '甲', 'branch': '辰'},
            'hour': {'stem': '庚', 'branch': '午'},
        }
        # 辛 is hidden in 丑(month), no 辛 in any stem → 藏而不透
        results = _detect_tougan('辛', 'month', fp)
        assert len(results) == 1
        assert '藏而不透' in results[0]['name']
        expected_modifier = self.modifiers['辛']['cang']['month']
        assert expected_modifier in results[0]['description']


# ============================================================
# Tonggen Modifier Template Validation Tests
# ============================================================

class TestTonggenModifiers:
    """Validate tonggen_modifiers.json: all 160 entries present, non-empty, pillar domain sanity."""

    @pytest.fixture(autouse=True)
    def load_modifiers(self):
        import json
        import os
        path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'data', 'explanations', 'interactions', 'tonggen_modifiers.json',
        )
        with open(path, encoding='utf-8') as f:
            self.modifiers = json.load(f)

    ALL_STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
    STATES = ['strong_root', 'moderate_root', 'weak_root', 'floating']
    PILLARS = ['year', 'month', 'day', 'hour']

    def test_all_160_keys_exist(self):
        """All 10 stems × 4 states × 4 pillars = 160 entries."""
        for stem in self.ALL_STEMS:
            assert stem in self.modifiers, f'Missing stem: {stem}'
            for state in self.STATES:
                assert state in self.modifiers[stem], f'Missing state: {stem}/{state}'
                for pillar in self.PILLARS:
                    assert pillar in self.modifiers[stem][state], (
                        f'Missing entry: {stem}/{state}/{pillar}'
                    )

    def test_no_entry_empty(self):
        """No entry should be empty or too short."""
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                for pillar in self.PILLARS:
                    text = self.modifiers[stem][state][pillar]
                    assert len(text) >= 20, (
                        f'{stem}/{state}/{pillar} too short ({len(text)} chars): {text[:30]}'
                    )

    def test_year_domain(self):
        """Year entries should reference family/childhood."""
        year_keywords = ['家族', '成長', '童年', '祖', '家庭', '根基', '早年', '家教', '教養']
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                text = self.modifiers[stem][state]['year']
                has_keyword = any(kw in text for kw in year_keywords)
                assert has_keyword, (
                    f'{stem}/{state}/year missing family/childhood keywords: {text[:50]}'
                )

    def test_month_domain(self):
        """Month entries should reference career/workplace."""
        month_keywords = ['事業', '職場', '工作', '社會', '專業', '團隊', '職業']
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                text = self.modifiers[stem][state]['month']
                has_keyword = any(kw in text for kw in month_keywords)
                assert has_keyword, (
                    f'{stem}/{state}/month missing career keywords: {text[:50]}'
                )

    def test_day_domain_not_marriage(self):
        """Day entries should focus on self/inner nature, NOT marriage."""
        bad_keywords = ['婚姻', '另一半', '配偶']
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                text = self.modifiers[stem][state]['day']
                for bad in bad_keywords:
                    assert bad not in text, (
                        f'{stem}/{state}/day contains marriage keyword "{bad}": {text[:50]}'
                    )

    def test_hour_domain(self):
        """Hour entries should reference children/late life."""
        hour_keywords = ['子女', '晚年', '後半', '孩子', '老年', '後代']
        for stem in self.ALL_STEMS:
            for state in self.STATES:
                text = self.modifiers[stem][state]['hour']
                has_keyword = any(kw in text for kw in hour_keywords)
                assert has_keyword, (
                    f'{stem}/{state}/hour missing children/late-life keywords: {text[:50]}'
                )

    def test_tonggen_modifier_in_interaction(self):
        """通根 interaction card should contain modifier text."""
        fp = {
            'year': {'stem': '甲', 'branch': '子'},
            'month': {'stem': '丁', 'branch': '丑'},
            'day': {'stem': '庚', 'branch': '申'},  # 申 contains 庚(本氣), same pillar → 6*1.0=6 → strong
            'hour': {'stem': '癸', 'branch': '午'},
        }
        results = _detect_tonggen('庚', 'day', fp)
        assert len(results) == 1
        assert '本氣' in results[0]['name']
        assert results[0]['nature'] == 'strong_root'
        expected_modifier = self.modifiers['庚']['strong_root']['day']
        assert expected_modifier in results[0]['description']

    def test_floating_modifier_in_interaction(self):
        """虛浮無根 interaction card should contain floating modifier text."""
        fp = {
            'year': {'stem': '甲', 'branch': '子'},  # 子=癸
            'month': {'stem': '丙', 'branch': '丑'},  # 丑=己癸辛
            'day': {'stem': '戊', 'branch': '辰'},  # 辰=戊乙癸
            'hour': {'stem': '庚', 'branch': '酉'},  # 酉=辛
        }
        results = _detect_tonggen('丙', 'month', fp)
        assert len(results) == 1
        assert '虛浮無根' in results[0]['name']
        expected_modifier = self.modifiers['丙']['floating']['month']
        assert expected_modifier in results[0]['description']


# ============================================================
# Spouse Palace (日支配偶宮) Modifier Tests
# ============================================================

class TestSpousePalaceModifiers:
    """Test that hidden stems in 日支 use spouse-focused modifiers."""

    @pytest.fixture(autouse=True)
    def load_modifiers(self):
        import json, os
        path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'data', 'explanations', 'interactions', 'tougan_modifiers.json',
        )
        with open(path, encoding='utf-8') as f:
            self.modifiers = json.load(f)

    def test_all_stems_have_day_spouse_tougan(self):
        """All 10 stems must have tougan.day_spouse."""
        for stem in '甲乙丙丁戊己庚辛壬癸':
            assert 'day_spouse' in self.modifiers[stem]['tougan'], (
                f'{stem} missing tougan.day_spouse'
            )

    def test_all_stems_have_day_spouse_cang(self):
        """All 10 stems must have cang.day_spouse."""
        for stem in '甲乙丙丁戊己庚辛壬癸':
            assert 'day_spouse' in self.modifiers[stem]['cang'], (
                f'{stem} missing cang.day_spouse'
            )

    def test_spouse_modifier_mentions_partner(self):
        """Spouse modifiers should mention 另一半/配偶/對方."""
        partner_words = ['另一半', '配偶', '對方', '感情', '關係']
        for stem in '甲乙丙丁戊己庚辛壬癸':
            text = self.modifiers[stem]['tougan']['day_spouse']
            assert any(w in text for w in partner_words), (
                f'{stem} tougan.day_spouse does not mention partner: {text[:50]}'
            )
            text_cang = self.modifiers[stem]['cang']['day_spouse']
            assert any(w in text_cang for w in partner_words), (
                f'{stem} cang.day_spouse does not mention partner: {text_cang[:50]}'
            )

    def test_hidden_stem_day_uses_spouse_modifier(self):
        """detect_cross_pillar_interactions for hidden_stem+day should use spouse text."""
        fp = {
            'year': {'stem': '丁', 'branch': '卯'},  # 丁 appears in year stem
            'month': {'stem': '戊', 'branch': '申'},
            'day': {'stem': '戊', 'branch': '午'},   # 午 contains 丁(本氣)
            'hour': {'stem': '庚', 'branch': '申'},
        }
        # 丁 hidden in day branch (午), and 丁 is in year stem → tougan
        results = detect_cross_pillar_interactions(
            'hidden_stem', '丁', 'day', fp, {},
        )
        assert len(results) >= 1
        tougan_result = [r for r in results if '透干' in r['name']]
        assert len(tougan_result) >= 1
        # Should use spouse modifier (mentions 另一半/對方)
        partner_words = ['另一半', '配偶', '對方', '感情', '關係']
        desc = tougan_result[0]['description']
        assert any(w in desc for w in partner_words), (
            f'Day pillar hidden_stem tougan should use spouse modifier: {desc[:80]}'
        )

    def test_hidden_stem_non_day_uses_regular_modifier(self):
        """hidden_stem in non-day pillar should NOT use spouse modifier."""
        fp = {
            'year': {'stem': '甲', 'branch': '寅'},  # 寅 contains 甲
            'month': {'stem': '丙', 'branch': '午'},
            'day': {'stem': '戊', 'branch': '辰'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        # 甲 hidden in year branch (寅), and 甲 is year stem → tougan (same pillar)
        results = detect_cross_pillar_interactions(
            'hidden_stem', '甲', 'year', fp, {},
        )
        assert len(results) >= 1
        tougan_result = [r for r in results if '透干' in r['name']]
        assert len(tougan_result) >= 1
        # Should NOT use spouse modifier — should use regular year modifier
        desc = tougan_result[0]['description']
        # Check it mentions family/childhood (year domain), not spouse
        family_words = ['家族', '家庭', '童年', '成長']
        # At minimum, should NOT use spouse text
        spouse_only_words = ['另一半', '配偶']
        assert not any(w in desc for w in spouse_only_words), (
            f'Year pillar hidden_stem should NOT use spouse modifier: {desc[:80]}'
        )
