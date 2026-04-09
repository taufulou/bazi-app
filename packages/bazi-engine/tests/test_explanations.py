"""Tests for Element Encyclopedia — explanations module."""
import json
import os
import pytest

from app.explanations import (
    get_element_explanation,
    _determine_element_god_role,
    _substitute_placeholders,
    _TEMPLATES,
    STRENGTH_LABEL_MAP,
    KONG_WANG_ROLE_MAP,
)


# ── Fixtures ──

@pytest.fixture
def sample_god_roles_strong():
    """God roles for a strong 甲木 Day Master (needs draining/controlling)."""
    return {
        "dayMasterElement": "木",
        "strengthClassification": "strong",
        "favorableGod": "火",   # 食傷 drains
        "usefulGod": "土",      # 財星 drains further
        "idleGod": "水",        # 印星 — neutral
        "tabooGod": "木",       # 比劫 — too much of same
        "enemyGod": "金",       # 官殺 — weakened by excess wood
    }


@pytest.fixture
def sample_god_roles_weak():
    """God roles for a weak 甲木 Day Master (needs support)."""
    return {
        "dayMasterElement": "木",
        "strengthClassification": "weak",
        "favorableGod": "水",   # 印星 produces me
        "usefulGod": "木",      # 比劫 supports me
        "idleGod": "金",        # 官殺 — neutral
        "tabooGod": "土",       # 財星 — drains weak DM
        "enemyGod": "火",       # 食傷 — drains weak DM more
    }


@pytest.fixture
def sample_god_roles_neutral():
    """God roles for a neutral DM."""
    return {
        "dayMasterElement": "木",
        "strengthClassification": "neutral",
        "favorableGod": "火",
        "usefulGod": "水",
        "idleGod": "金",
        "tabooGod": "土",
        "enemyGod": "木",
    }


# ── Template Loading Tests ──

class TestTemplateLoading:
    """Test that JSON template files load correctly."""

    def test_templates_loaded(self):
        """At least ten_gods template should be loaded."""
        assert 'ten_gods' in _TEMPLATES
        assert len(_TEMPLATES) >= 1

    def test_ten_gods_has_all_entries(self):
        """All 10 ten gods should have template entries."""
        ten_gods = _TEMPLATES['ten_gods']
        expected = ['比肩', '劫財', '食神', '傷官', '偏財', '正財', '偏官', '正官', '偏印', '正印']
        for god in expected:
            assert god in ten_gods, f"Missing template for {god}"

    def test_ten_god_entry_structure(self):
        """Each ten god entry should have layerA, layerB, layerC, layerD."""
        for name, entry in _TEMPLATES['ten_gods'].items():
            assert 'layerA' in entry, f"{name} missing layerA"
            assert 'layerB' in entry, f"{name} missing layerB"
            assert 'layerC' in entry, f"{name} missing layerC"
            assert 'layerD' in entry, f"{name} missing layerD"

    def test_layer_a_structure(self):
        """Layer A should have name, category, meaning, keywords, liuQin."""
        entry = _TEMPLATES['ten_gods']['正官']
        layer_a = entry['layerA']
        assert 'name' in layer_a
        assert 'category' in layer_a
        assert 'meaning' in layer_a
        assert 'keywords' in layer_a
        assert isinstance(layer_a['keywords'], list)
        assert 'liuQin' in layer_a
        assert 'male' in layer_a['liuQin']
        assert 'female' in layer_a['liuQin']

    def test_layer_b_has_four_pillars(self):
        """Layer B should have year, month, day, hour entries."""
        entry = _TEMPLATES['ten_gods']['正官']
        layer_b = entry['layerB']
        assert 'year' in layer_b
        assert 'month' in layer_b
        assert 'day' in layer_b
        assert 'hour' in layer_b

    def test_layer_c_has_five_god_roles(self):
        """Layer C should have all 5 god role variants."""
        entry = _TEMPLATES['ten_gods']['正官']
        layer_c = entry['layerC']
        for role in ['喜神', '用神', '閒神', '忌神', '仇神']:
            assert role in layer_c, f"Missing Layer C entry for {role}"

    def test_layer_d_has_both_genders(self):
        """Layer D should have male and female variants."""
        entry = _TEMPLATES['ten_gods']['正官']
        layer_d = entry['layerD']
        assert 'male' in layer_d
        assert 'female' in layer_d

    def test_layer_c_contains_strength_placeholder(self):
        """Layer C templates should contain {strengthLabel} placeholder."""
        entry = _TEMPLATES['ten_gods']['正官']
        # At least 喜神 and 忌神 should have the placeholder
        assert '{strengthLabel}' in entry['layerC']['喜神']
        assert '{strengthLabel}' in entry['layerC']['忌神']

    def test_ten_gods_json_valid(self):
        """The JSON file should be valid and loadable independently."""
        json_path = os.path.join(
            os.path.dirname(__file__), '..', 'data', 'explanations', 'ten_gods.json'
        )
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        assert len(data) == 10

    def test_load_templates_missing_directory(self, tmp_path, monkeypatch):
        """_load_templates should gracefully handle missing directory."""
        from app.explanations import _load_templates, _TEMPLATES

        # Save original state
        original = dict(_TEMPLATES)
        _TEMPLATES.clear()

        # Patch the data dir to a non-existent path
        monkeypatch.setattr(
            'app.explanations.os.path.dirname',
            lambda _: str(tmp_path / 'nonexistent'),
        )
        _load_templates()  # Should not raise

        # Restore
        _TEMPLATES.clear()
        _TEMPLATES.update(original)


# ── God Role Mapping Tests ──

class TestGodRoleMapping:
    """Test _determine_element_god_role() mapping chain."""

    def test_ten_god_same_element(self, sample_god_roles_strong):
        """比肩 (same element as DM) should map to DM's own element role."""
        # DM=木, 比肩=木, tabooGod=木 → 忌神
        role = _determine_element_god_role('比肩', 'ten_god', sample_god_roles_strong)
        assert role == '忌神'

    def test_ten_god_i_produce(self, sample_god_roles_strong):
        """食神 (I produce) for 木 DM → 火, favorableGod=火 → 喜神."""
        role = _determine_element_god_role('食神', 'ten_god', sample_god_roles_strong)
        assert role == '喜神'

    def test_ten_god_i_overcome(self, sample_god_roles_strong):
        """正財 (I overcome) for 木 DM → 土, usefulGod=土 → 用神."""
        role = _determine_element_god_role('正財', 'ten_god', sample_god_roles_strong)
        assert role == '用神'

    def test_ten_god_overcomes_me(self, sample_god_roles_strong):
        """正官 (overcomes me) for 木 DM → 金, enemyGod=金 → 仇神."""
        role = _determine_element_god_role('正官', 'ten_god', sample_god_roles_strong)
        assert role == '仇神'

    def test_ten_god_produces_me(self, sample_god_roles_strong):
        """正印 (produces me) for 木 DM → 水, idleGod=水 → 閒神."""
        role = _determine_element_god_role('正印', 'ten_god', sample_god_roles_strong)
        assert role == '閒神'

    def test_weak_dm_different_roles(self, sample_god_roles_weak):
        """Weak DM should assign different god roles (比肩=用神, 正財=忌神)."""
        role_bijian = _determine_element_god_role('比肩', 'ten_god', sample_god_roles_weak)
        assert role_bijian == '用神'  # 木=usefulGod for weak 木 DM

        role_zhengcai = _determine_element_god_role('正財', 'ten_god', sample_god_roles_weak)
        assert role_zhengcai == '忌神'  # 土=tabooGod for weak 木 DM

    def test_stem_element_mapping(self, sample_god_roles_strong):
        """Stem '甲' should map to 木 element → check against god roles."""
        role = _determine_element_god_role('甲', 'stem', sample_god_roles_strong)
        assert role == '忌神'  # 木=tabooGod for strong 木 DM

    def test_branch_element_mapping(self, sample_god_roles_strong):
        """Branch '子' should map to 水 element → check against god roles."""
        role = _determine_element_god_role('子', 'branch', sample_god_roles_strong)
        assert role == '閒神'  # 水=idleGod for strong 木 DM

    def test_kong_wang_uses_branch_mapping(self, sample_god_roles_strong):
        """Kong wang value is a branch — should use branch element lookup."""
        role = _determine_element_god_role('戌', 'kong_wang', sample_god_roles_strong)
        # 戌=土, usefulGod=土 → 用神
        assert role == '用神'

    def test_unknown_ten_god_returns_none(self, sample_god_roles_strong):
        """Unknown ten god name should return None."""
        role = _determine_element_god_role('不存在', 'ten_god', sample_god_roles_strong)
        assert role is None

    def test_unknown_element_type_returns_none(self, sample_god_roles_strong):
        """Truly unknown element type should return None."""
        role = _determine_element_god_role('甲', 'unknown_type', sample_god_roles_strong)
        assert role is None

    def test_missing_dm_element_returns_none(self):
        """Missing dayMasterElement should return None."""
        bad_roles = {"favorableGod": "火"}
        role = _determine_element_god_role('正官', 'ten_god', bad_roles)
        assert role is None


# ── Placeholder Substitution Tests ──

class TestPlaceholderSubstitution:
    """Test _substitute_placeholders() function."""

    def test_strong_label(self):
        text = "日主{strengthLabel}"
        result = _substitute_placeholders(text, {"strengthClassification": "strong"})
        assert result == "日主偏強"

    def test_very_strong_maps_to_strong(self):
        text = "日主{strengthLabel}"
        result = _substitute_placeholders(text, {"strengthClassification": "very_strong"})
        assert result == "日主偏強"

    def test_weak_label(self):
        text = "日主{strengthLabel}"
        result = _substitute_placeholders(text, {"strengthClassification": "weak"})
        assert result == "日主偏弱"

    def test_very_weak_maps_to_weak(self):
        text = "日主{strengthLabel}"
        result = _substitute_placeholders(text, {"strengthClassification": "very_weak"})
        assert result == "日主偏弱"

    def test_neutral_label(self):
        text = "日主{strengthLabel}"
        result = _substitute_placeholders(text, {"strengthClassification": "neutral"})
        assert result == "日主中和"

    def test_missing_strength_defaults_to_neutral(self):
        text = "日主{strengthLabel}"
        result = _substitute_placeholders(text, {})
        assert result == "日主中和"

    def test_dm_element_substitution(self):
        text = "你的日主五行是{dmElement}"
        result = _substitute_placeholders(text, {"dayMasterElement": "木"})
        assert result == "你的日主五行是木"

    def test_no_placeholder_passthrough(self):
        """Text without placeholders should pass through unmodified."""
        text = "這是一段沒有佔位符的文字。"
        result = _substitute_placeholders(text, {"strengthClassification": "strong"})
        assert result == text

    def test_multiple_placeholders(self):
        text = "日主{strengthLabel}，五行{dmElement}"
        result = _substitute_placeholders(text, {
            "strengthClassification": "weak",
            "dayMasterElement": "火",
        })
        assert result == "日主偏弱，五行火"


# ── Full Assembly Tests ──

class TestGetElementExplanation:
    """Test get_element_explanation() full assembly."""

    def test_returns_generic_layer(self, sample_god_roles_strong):
        """Should always return Layer A (generic)."""
        result = get_element_explanation('ten_god', '正官', 'year', sample_god_roles_strong, 'male')
        assert 'generic' in result
        assert 'name' in result['generic']
        assert result['generic']['name'] == '正官'

    def test_returns_personalized_layers(self, sample_god_roles_strong):
        """Should return Layer B, C, D in personalized."""
        result = get_element_explanation('ten_god', '正官', 'year', sample_god_roles_strong, 'male')
        personalized = result['personalized']
        assert 'pillarMeaning' in personalized  # Layer B
        assert 'godRoleMeaning' in personalized  # Layer C
        assert 'godRole' in personalized          # god role label
        assert 'genderMeaning' in personalized    # Layer D

    def test_layer_c_has_substituted_placeholders(self, sample_god_roles_strong):
        """Layer C should have {strengthLabel} replaced with actual value."""
        result = get_element_explanation('ten_god', '食神', 'month', sample_god_roles_strong, 'male')
        god_role_text = result['personalized']['godRoleMeaning']
        assert '{strengthLabel}' not in god_role_text
        assert '偏強' in god_role_text  # strong → 偏強

    def test_layer_c_weak_dm(self, sample_god_roles_weak):
        """Weak DM should get '偏弱' in Layer C text."""
        result = get_element_explanation('ten_god', '正財', 'month', sample_god_roles_weak, 'female')
        god_role_text = result['personalized']['godRoleMeaning']
        assert '偏弱' in god_role_text

    def test_different_genders_get_different_layer_d(self, sample_god_roles_strong):
        """Male and female should get different Layer D content."""
        result_m = get_element_explanation('ten_god', '正官', 'year', sample_god_roles_strong, 'male')
        result_f = get_element_explanation('ten_god', '正官', 'year', sample_god_roles_strong, 'female')
        assert result_m['personalized']['genderMeaning'] != result_f['personalized']['genderMeaning']

    def test_year_month_hour_pillars_different(self, sample_god_roles_strong):
        """Different pillars should return different Layer B content."""
        r_year = get_element_explanation('ten_god', '正官', 'year', sample_god_roles_strong, 'male')
        r_month = get_element_explanation('ten_god', '正官', 'month', sample_god_roles_strong, 'male')
        r_hour = get_element_explanation('ten_god', '正官', 'hour', sample_god_roles_strong, 'male')
        assert r_year['personalized']['pillarMeaning'] != r_month['personalized']['pillarMeaning']
        assert r_month['personalized']['pillarMeaning'] != r_hour['personalized']['pillarMeaning']

    def test_unknown_element_type_returns_error(self, sample_god_roles_strong):
        """Unknown element type should return error dict."""
        result = get_element_explanation('unknown', '正官', 'year', sample_god_roles_strong, 'male')
        assert 'error' in result

    def test_unknown_value_returns_error(self, sample_god_roles_strong):
        """Unknown value should return error dict."""
        result = get_element_explanation('ten_god', '不存在', 'year', sample_god_roles_strong, 'male')
        assert 'error' in result

    def test_hidden_stem_returns_valid(self, sample_god_roles_strong):
        """Hidden stems should return valid results now (Phase 2B implemented)."""
        result = get_element_explanation('hidden_stem', '甲', 'year', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert result['generic']['category'] == '藏干'

    def test_nayin_returns_valid(self, sample_god_roles_strong):
        """Nayin should return valid results with collapsed god roles."""
        result = get_element_explanation('nayin', '海中金', 'year', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert result['generic']['category'] == '納音'

    def test_shensha_returns_valid(self, sample_god_roles_strong):
        """Shensha should return valid results with collapsed god roles."""
        result = get_element_explanation('shensha', '天乙貴人', 'year', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert result['generic']['category'] == '神煞'

    def test_shensha_gender_layer_d(self, sample_god_roles_strong):
        """Gender-specific shensha (桃花) should return Layer D content."""
        result = get_element_explanation('shensha', '桃花', 'year', sample_god_roles_strong, 'male')
        assert 'genderMeaning' in result.get('personalized', {})

    def test_all_ten_gods_return_valid(self, sample_god_roles_strong):
        """All 10 ten gods should return valid results with no errors."""
        ten_gods = ['比肩', '劫財', '食神', '傷官', '偏財', '正財', '偏官', '正官', '偏印', '正印']
        for god in ten_gods:
            result = get_element_explanation('ten_god', god, 'month', sample_god_roles_strong, 'male')
            assert 'error' not in result, f"Error for {god}: {result.get('error')}"
            assert 'generic' in result
            assert 'personalized' in result


# ── Kong Wang Collapsing Tests ──

class TestKongWangCollapsing:
    """Test that kong_wang type uses collapsed 3-key Layer C."""

    def test_collapsing_map_values(self):
        """Verify the collapsing map covers all 5 god roles."""
        assert KONG_WANG_ROLE_MAP['喜神'] == 'favorable'
        assert KONG_WANG_ROLE_MAP['用神'] == 'favorable'
        assert KONG_WANG_ROLE_MAP['忌神'] == 'unfavorable'
        assert KONG_WANG_ROLE_MAP['仇神'] == 'unfavorable'
        assert KONG_WANG_ROLE_MAP['閒神'] == 'neutral'


# ── Strength Label Map Tests ──

class TestStrengthLabelMap:
    """Test strength classification → Chinese label mapping."""

    def test_all_five_classifications_mapped(self):
        assert STRENGTH_LABEL_MAP['very_strong'] == '偏強'
        assert STRENGTH_LABEL_MAP['strong'] == '偏強'
        assert STRENGTH_LABEL_MAP['neutral'] == '中和'
        assert STRENGTH_LABEL_MAP['weak'] == '偏弱'
        assert STRENGTH_LABEL_MAP['very_weak'] == '偏弱'


# ── Phase 2A: Stems Tests ──

class TestStemsTemplates:
    """Test heavenly stem templates."""

    def test_all_stems_loaded(self):
        assert 'stems' in _TEMPLATES
        stems = _TEMPLATES['stems']
        expected = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        for s in expected:
            assert s in stems, f"Missing stem: {s}"

    def test_stem_returns_valid(self, sample_god_roles_strong):
        result = get_element_explanation('stem', '甲', 'year', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert result['generic']['name'] == '甲木'
        assert 'personalized' in result
        assert 'pillarMeaning' in result['personalized']

    def test_stem_day_pillar_is_dm(self, sample_god_roles_strong):
        """Day pillar stem should have a DM-specific explanation."""
        result = get_element_explanation('stem', '甲', 'day', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert '日主' in result['personalized'].get('pillarMeaning', '')

    def test_stem_god_role_mapping(self, sample_god_roles_strong):
        """Stem '甲' = 木, tabooGod = 木 → 忌神."""
        result = get_element_explanation('stem', '甲', 'month', sample_god_roles_strong, 'male')
        assert result['personalized']['godRole'] == '忌神'

    def test_all_stems_return_valid(self, sample_god_roles_strong):
        stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        for s in stems:
            result = get_element_explanation('stem', s, 'month', sample_god_roles_strong, 'male')
            assert 'error' not in result, f"Error for stem {s}: {result.get('error')}"


# ── Phase 2A: Branches Tests ──

class TestBranchesTemplates:
    """Test earthly branch templates."""

    def test_all_branches_loaded(self):
        assert 'branches' in _TEMPLATES
        branches = _TEMPLATES['branches']
        expected = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
        for b in expected:
            assert b in branches, f"Missing branch: {b}"

    def test_branch_has_interactions(self):
        """Each branch Layer A should have interactions reference."""
        entry = _TEMPLATES['branches']['子']
        assert 'interactions' in entry['layerA']
        assert '六合' in entry['layerA']['interactions']
        assert '六沖' in entry['layerA']['interactions']
        assert '三合' in entry['layerA']['interactions']

    def test_branch_returns_valid(self, sample_god_roles_strong):
        result = get_element_explanation('branch', '子', 'year', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert '鼠' in result['generic']['name']

    def test_branch_god_role_mapping(self, sample_god_roles_strong):
        """Branch '子' = 水, idleGod = 水 → 閒神."""
        result = get_element_explanation('branch', '子', 'month', sample_god_roles_strong, 'male')
        assert result['personalized']['godRole'] == '閒神'

    def test_branch_has_layer_d(self, sample_god_roles_strong):
        """Branches should have gender-specific Layer D for 配偶宮."""
        result = get_element_explanation('branch', '子', 'day', sample_god_roles_strong, 'male')
        assert 'genderMeaning' in result['personalized']

    def test_all_branches_return_valid(self, sample_god_roles_strong):
        branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
        for b in branches:
            result = get_element_explanation('branch', b, 'month', sample_god_roles_strong, 'male')
            assert 'error' not in result, f"Error for branch {b}: {result.get('error')}"


# ── Phase 2A: Life Stages Tests ──

class TestLifeStagesTemplates:
    """Test twelve life stage templates."""

    def test_all_stages_loaded(self):
        assert 'life_stages' in _TEMPLATES
        stages = _TEMPLATES['life_stages']
        expected = ['長生', '沐浴', '冠帶', '臨官', '帝旺', '衰', '病', '死', '墓', '絕', '胎', '養']
        for s in expected:
            assert s in stages, f"Missing stage: {s}"

    def test_stage_returns_valid(self, sample_god_roles_strong):
        result = get_element_explanation('life_stage', '長生', 'year', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert result['generic']['name'] == '長生'

    def test_stage_god_role_uses_dm_element(self, sample_god_roles_strong):
        """Life stage god role should use DM element (木), tabooGod = 木 → 忌神."""
        result = get_element_explanation('life_stage', '帝旺', 'month', sample_god_roles_strong, 'male')
        assert result['personalized']['godRole'] == '忌神'

    def test_all_stages_return_valid(self, sample_god_roles_strong):
        stages = ['長生', '沐浴', '冠帶', '臨官', '帝旺', '衰', '病', '死', '墓', '絕', '胎', '養']
        for s in stages:
            result = get_element_explanation('life_stage', s, 'month', sample_god_roles_strong, 'male')
            assert 'error' not in result, f"Error for stage {s}: {result.get('error')}"


# ── Phase 2A: Kong Wang Tests ──

class TestKongWangTemplates:
    """Test kong wang templates."""

    def test_kong_wang_loaded(self):
        assert 'kong_wang' in _TEMPLATES
        assert '_concept' in _TEMPLATES['kong_wang']

    def test_kong_wang_returns_valid(self, sample_god_roles_strong):
        """Kong wang should return the _concept entry regardless of value."""
        result = get_element_explanation('kong_wang', '戌', 'year', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert result['generic']['name'] == '空亡'

    def test_kong_wang_uses_collapsed_roles(self, sample_god_roles_strong):
        """Kong wang Layer C should use collapsed keys (favorable/unfavorable/neutral)."""
        # 戌 = 土, usefulGod = 土 → 用神 → collapsed to 'favorable'
        result = get_element_explanation('kong_wang', '戌', 'year', sample_god_roles_strong, 'male')
        assert result['personalized']['godRole'] == 'favorable'

    def test_kong_wang_different_branches(self, sample_god_roles_strong):
        """Different branch values should still return the same concept but different god roles."""
        result_xu = get_element_explanation('kong_wang', '戌', 'year', sample_god_roles_strong, 'male')
        result_zi = get_element_explanation('kong_wang', '子', 'year', sample_god_roles_strong, 'male')
        # Both return same generic (空亡 concept)
        assert result_xu['generic']['name'] == result_zi['generic']['name']
        # But different god roles (戌=土=用神=favorable, 子=水=閒神=neutral)
        assert result_xu['personalized']['godRole'] != result_zi['personalized']['godRole']


# ── Phase 2A: Seasonal States Tests ──

class TestSeasonalStatesTemplates:
    """Test seasonal state templates."""

    def test_all_states_loaded(self):
        assert 'seasonal_states' in _TEMPLATES
        states = _TEMPLATES['seasonal_states']
        for s in ['旺', '相', '休', '囚', '死']:
            assert s in states, f"Missing state: {s}"

    def test_state_returns_valid(self, sample_god_roles_strong):
        result = get_element_explanation('seasonal_state', '旺', 'month', sample_god_roles_strong, 'male')
        assert 'error' not in result
        assert result['generic']['name'] == '旺'

    def test_state_god_role_uses_dm_element(self, sample_god_roles_strong):
        """Seasonal state god role uses DM element (木), tabooGod = 木 → 忌神."""
        result = get_element_explanation('seasonal_state', '旺', 'month', sample_god_roles_strong, 'male')
        assert result['personalized']['godRole'] == '忌神'

    def test_all_states_return_valid(self, sample_god_roles_strong):
        for s in ['旺', '相', '休', '囚', '死']:
            result = get_element_explanation('seasonal_state', s, 'month', sample_god_roles_strong, 'male')
            assert 'error' not in result, f"Error for state {s}: {result.get('error')}"


# ============================================================
# Regression Tests — Disclaimer & Conditional Text Removal
# ============================================================

class TestRegressionDisclaimerRemoval:
    """Ensure no template contains removed disclaimers (Fix 3 & 4)."""

    DATA_DIR = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'data', 'explanations',
    )

    def _load_all_jsons(self):
        """Load all explanation JSON files."""
        results = {}
        for f in os.listdir(self.DATA_DIR):
            if f.endswith('.json'):
                path = os.path.join(self.DATA_DIR, f)
                with open(path, encoding='utf-8') as fh:
                    results[f] = json.load(fh)
        return results

    def test_no_wangshuai_disclaimer(self):
        """No template should contain the 旺衰取用法 disclaimer."""
        disclaimer = '本分析基於旺衰取用法'
        for fname, data in self._load_all_jsons().items():
            raw = json.dumps(data, ensure_ascii=False)
            assert disclaimer not in raw, (
                f'{fname} still contains 旺衰取用法 disclaimer'
            )

    def test_no_hehua_disclaimer(self):
        """No template should contain the 合化 disclaimer."""
        disclaimer = '若此十神的天干與其他天干相合，其實際效果可能因合化而改變'
        for fname, data in self._load_all_jsons().items():
            raw = json.dumps(data, ensure_ascii=False)
            assert disclaimer not in raw, (
                f'{fname} still contains 合化 disclaimer'
            )

    def test_no_conditional_tougan_in_hidden_stems(self):
        """No hidden_stems.json Layer B should contain '若此藏干透出天干'."""
        path = os.path.join(self.DATA_DIR, 'hidden_stems.json')
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for stem, entry in data.items():
            for pillar, text in entry.get('layerB', {}).items():
                assert '若此藏干透出天干' not in text, (
                    f'hidden_stems.json {stem} layerB[{pillar}] still has conditional 透干 text'
                )

    def test_no_long_conditional_tougan_in_layer_c(self):
        """Layer C should not contain long '如果X透出天干' conditional sentences.
        Short notes like '是否透出天干' are allowed."""
        import re
        path = os.path.join(self.DATA_DIR, 'hidden_stems.json')
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for stem, entry in data.items():
            for role, text in entry.get('layerC', {}).items():
                # Long conditionals: "如果X透出天干" or "若X透出天干"
                has_long = bool(
                    re.search(r'如果.{0,4}透出天干', text) or
                    re.search(r'若.{0,6}透出天干', text)
                )
                # Short note: "是否透出天干" is allowed
                has_short_only = '是否透出天干' in text
                if has_long and not has_short_only:
                    assert False, (
                        f'hidden_stems.json {stem} layerC[{role}] has long conditional: {text[-60:]}'
                    )


# ============================================================
# Pillar Context Tests
# ============================================================

class TestPillarContext:
    """Validate pillar_context.json loads correctly and is returned in API."""

    DATA_DIR = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'data', 'explanations',
    )

    def test_pillar_context_file_loads(self):
        """pillar_context.json must exist and be valid JSON."""
        path = os.path.join(self.DATA_DIR, 'pillar_context.json')
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        assert isinstance(data, dict)

    def test_all_four_pillars_present(self):
        """Must have year, month, day, hour entries."""
        path = os.path.join(self.DATA_DIR, 'pillar_context.json')
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for pillar in ['year', 'month', 'day', 'hour']:
            assert pillar in data, f'Missing pillar: {pillar}'
            assert 'free' in data[pillar], f'{pillar} missing "free" key'
            assert 'paid' in data[pillar], f'{pillar} missing "paid" key'
            assert len(data[pillar]['free']) >= 20, f'{pillar} free text too short'
            assert len(data[pillar]['paid']) >= 20, f'{pillar} paid text too short'

    def test_pillar_context_in_response(self):
        """get_element_explanation should include pillarContext."""
        god_roles = {
            'dayMasterElement': '金',
            'strengthClassification': 'weak',
            'favorableGod': '土', 'usefulGod': '金',
            'idleGod': '水', 'tabooGod': '火', 'enemyGod': '木',
        }
        result = get_element_explanation('ten_god', '比肩', 'year', god_roles, 'male')
        assert 'pillarContext' in result
        assert 'free' in result['pillarContext']
        assert 'paid' in result['pillarContext']
        # Free tier is jargon-free (no 年柱/日柱 terms) — check for user-friendly content
        assert '根' in result['pillarContext']['free'] or '家庭' in result['pillarContext']['free']


# ============================================================
# Shensha Layer A Simplification Tests
# ============================================================

class TestShenshaSimplification:
    """Ensure shensha Layer A entries don't contain technical lookup formulas."""

    DATA_DIR = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'data', 'explanations',
    )

    def test_no_lookup_formulas(self):
        """No shensha Layer A meaning should contain lookup patterns."""
        import re
        path = os.path.join(self.DATA_DIR, 'shenshas.json')
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        patterns = [
            r'[甲乙丙丁戊己庚辛壬癸]日見',
            r'[寅卯辰巳午未申酉戌亥]年.*見',
            r'以日[干支]查',
        ]
        for star, entry in data.items():
            meaning = entry.get('layerA', {}).get('meaning', '')
            for pat in patterns:
                match = re.search(pat, meaning)
                assert not match, (
                    f'{star} layerA still contains lookup formula: "{match.group()}" in "{meaning[:50]}..."'
                )


# ============================================================
# Day Pillar Combo Tests
# ============================================================

class TestDayPillarCombos:
    """Validate day_pillar_combos.json and engine integration."""

    DATA_DIR = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'data', 'explanations',
    )

    VALID_GRADES = {'上等', '中等', '下等'}
    VALID_LABELS = {
        '六秀日', '八專日', '九醜日', '魁罡日',
        '陰陽差錯日', '十惡大敗日', '孤鸞煞', '金神日',
    }

    @pytest.fixture(autouse=True)
    def load_combos(self):
        path = os.path.join(self.DATA_DIR, 'day_pillar_combos.json')
        with open(path, encoding='utf-8') as f:
            self.combos = json.load(f)

    def test_all_60_combos_loaded(self):
        """Verify exactly 60 entries exist."""
        assert len(self.combos) == 60, f"Expected 60, got {len(self.combos)}"

    def test_all_60_have_required_fields(self):
        """Every entry has grade, teaser, summary, specialLabels, lifeStageSeat."""
        required = {'grade', 'gradeReason', 'lifeStageSeat', 'specialLabels', 'teaser', 'summary'}
        for key, entry in self.combos.items():
            missing = required - set(entry.keys())
            assert not missing, f"{key} missing fields: {missing}"

    def test_grade_values(self):
        """All grades are one of 上等/中等/下等."""
        for key, entry in self.combos.items():
            assert entry['grade'] in self.VALID_GRADES, (
                f"{key} has invalid grade: {entry['grade']}"
            )

    def test_grade_distribution(self):
        """Grade distribution should be roughly 21/26/13 (±5 tolerance)."""
        counts = {}
        for entry in self.combos.values():
            counts[entry['grade']] = counts.get(entry['grade'], 0) + 1
        assert 15 <= counts.get('上等', 0) <= 28, f"上等 count: {counts.get('上等', 0)}"
        assert 20 <= counts.get('中等', 0) <= 32, f"中等 count: {counts.get('中等', 0)}"
        assert 8 <= counts.get('下等', 0) <= 18, f"下等 count: {counts.get('下等', 0)}"

    def test_special_labels_valid(self):
        """All labels are from the known set."""
        for key, entry in self.combos.items():
            for label in entry.get('specialLabels', []):
                assert label in self.VALID_LABELS, (
                    f"{key} has invalid label: {label}"
                )

    def test_no_summary_too_short(self):
        """No summary under 100 chars."""
        for key, entry in self.combos.items():
            assert len(entry['summary']) >= 100, (
                f"{key} summary too short ({len(entry['summary'])} chars)"
            )

    def test_combo_returned_for_day_stem(self):
        """When stem+day+four_pillars → response has dayPillarCombo."""
        god_roles = {
            'dayMasterElement': '金',
            'strengthClassification': 'weak',
            'favorableGod': '土', 'usefulGod': '金',
            'idleGod': '水', 'tabooGod': '火', 'enemyGod': '木',
        }
        four_pillars = {
            'year': {'stem': '丁', 'branch': '卯'},
            'month': {'stem': '戊', 'branch': '申'},
            'day': {'stem': '戊', 'branch': '午'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        result = get_element_explanation(
            'stem', '戊', 'day', god_roles, 'male', four_pillars,
        )
        assert 'dayPillarCombo' in result, "dayPillarCombo missing for day stem"
        combo = result['dayPillarCombo']
        assert combo['grade'] in self.VALID_GRADES

    def test_no_combo_for_non_day(self):
        """stem+month should NOT have dayPillarCombo."""
        god_roles = {
            'dayMasterElement': '金',
            'strengthClassification': 'weak',
            'favorableGod': '土', 'usefulGod': '金',
            'idleGod': '水', 'tabooGod': '火', 'enemyGod': '木',
        }
        four_pillars = {
            'year': {'stem': '丁', 'branch': '卯'},
            'month': {'stem': '戊', 'branch': '申'},
            'day': {'stem': '戊', 'branch': '午'},
            'hour': {'stem': '庚', 'branch': '申'},
        }
        result = get_element_explanation(
            'stem', '戊', 'month', god_roles, 'male', four_pillars,
        )
        assert 'dayPillarCombo' not in result

    def test_no_combo_without_four_pillars(self):
        """Backward compat — no combo when four_pillars missing."""
        god_roles = {
            'dayMasterElement': '金',
            'strengthClassification': 'weak',
            'favorableGod': '土', 'usefulGod': '金',
            'idleGod': '水', 'tabooGod': '火', 'enemyGod': '木',
        }
        result = get_element_explanation(
            'stem', '戊', 'day', god_roles, 'male',
        )
        assert 'dayPillarCombo' not in result
