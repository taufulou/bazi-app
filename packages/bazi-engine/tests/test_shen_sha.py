"""
Tests for Shen Sha (神煞) calculation.
"""

import pytest
from app.calculator import calculate_bazi
from app.shen_sha import (
    calculate_kong_wang,
    calculate_shen_sha_for_pillar,
    get_taohua_directions,
    get_wenchang_direction,
    get_zodiac_benefactors,
)


class TestKongWang:
    """Test Kong Wang (空亡) calculation."""

    def test_returns_two_branches(self):
        void = calculate_kong_wang('甲', '子')
        assert len(void) == 2

    def test_jia_zi_void_is_xu_hai(self):
        """甲子旬空: 戌亥."""
        void = calculate_kong_wang('甲', '子')
        assert set(void) == {'戌', '亥'}

    def test_jia_xu_void_is_shen_you(self):
        """甲戌旬空: 申酉."""
        void = calculate_kong_wang('甲', '戌')
        assert set(void) == {'申', '酉'}

    def test_jia_shen_void_is_wu_wei(self):
        """甲申旬空: 午未."""
        void = calculate_kong_wang('甲', '申')
        assert set(void) == {'午', '未'}


class TestShenSha:
    """Test Shen Sha calculation in complete charts."""

    def test_shen_sha_is_list(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for name in ['year', 'month', 'day', 'hour']:
            assert isinstance(r['fourPillars'][name]['shenSha'], list)

    def test_all_shen_sha_collected(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert isinstance(r['allShenSha'], list)
        for sha in r['allShenSha']:
            assert 'name' in sha
            assert 'pillar' in sha
            assert 'branch' in sha

    def test_kong_wang_present(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert isinstance(r['kongWang'], list)
        assert len(r['kongWang']) == 2

    def test_known_shen_sha(self):
        """庚辰日 should have specific Shen Sha."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        sha_names = [s['name'] for s in r['allShenSha']]
        # The chart has 華蓋 and 天乙貴人 as verified earlier
        assert '華蓋' in sha_names or '天乙貴人' in sha_names

    def test_shen_sha_valid_names(self):
        """All Shen Sha names should be from our known list (35 types + 空亡)."""
        valid_names = {
            # Group 1: Major Auspicious
            '天乙貴人', '紅鸞', '天喜', '文昌', '將星',
            '祿神', '華蓋', '驛馬', '桃花', '羊刃', '福星貴人',
            # Group 2: Second-Tier Auspicious
            '天德貴人', '月德貴人', '天德合', '月德合',
            '太極貴人', '國印貴人', '金輿', '天醫', '學堂',
            '德秀貴人', '天廚貴人',
            # Group 3: Malefic
            '孤辰', '寡宿', '災煞', '劫煞', '亡神', '天羅', '地網',
            '勾絞煞', '童子煞',
            # Void
            '空亡',
        }
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for sha in r['allShenSha']:
            assert sha['name'] in valid_names, f"Unknown Shen Sha: {sha['name']}"


class TestLifeStages:
    """Test Life Stages (十二長生) calculation."""

    def test_life_stages_present(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        valid_stages = {
            '長生', '沐浴', '冠帶', '臨官', '帝旺', '衰',
            '病', '死', '墓', '絕', '胎', '養',
        }
        for name in ['year', 'month', 'day', 'hour']:
            stage = r['fourPillars'][name].get('lifeStage', '')
            assert stage in valid_stages, f"{name} pillar has invalid life stage: {stage}"

    def test_known_life_stages(self):
        """庚 Day Master: 巳=長生, 午=沐浴."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        # Month branch is 巳 → for 庚 Day Master, 巳 should be 長生
        assert r['fourPillars']['month']['lifeStage'] == '長生'


# ============================================================
# Fix 3: 桃花方位 tests
# ============================================================

class TestTaohuaDirections:
    """Test 桃花方位 derivation via 三合組 → 桃花支 → 方位."""

    def test_yin_wu_xu_group_primary_east(self):
        """寅午戌組 → 桃花=卯 → 正東. Year=寅."""
        result = get_taohua_directions('寅', '戌')
        assert result['primary']['branch'] == '卯'
        assert result['primary']['direction'] == '正東'
        # Day 戌 shares same group → no secondary (secondary == primary → omitted)
        assert 'secondary' not in result

    def test_shen_zi_chen_group_primary_west(self):
        """申子辰組 → 桃花=酉 → 正西. Year=申."""
        result = get_taohua_directions('申', '辰')
        assert result['primary']['branch'] == '酉'
        assert result['primary']['direction'] == '正西'
        assert 'secondary' not in result

    def test_si_you_chou_group_primary_south(self):
        """巳酉丑組 → 桃花=午 → 正南. Year=巳."""
        result = get_taohua_directions('巳', '丑')
        assert result['primary']['branch'] == '午'
        assert result['primary']['direction'] == '正南'
        assert 'secondary' not in result

    def test_hai_mao_wei_group_primary_north(self):
        """亥卯未組 → 桃花=子 → 正北. Year=亥."""
        result = get_taohua_directions('亥', '未')
        assert result['primary']['branch'] == '子'
        assert result['primary']['direction'] == '正北'
        assert 'secondary' not in result

    def test_year_day_different_groups_emit_secondary(self):
        """Year and day in different 三合組 → both primary and secondary."""
        # Year=寅(寅午戌→卯正東). Day=子(申子辰→酉正西).
        result = get_taohua_directions('寅', '子')
        assert result['primary']['branch'] == '卯'
        assert result['primary']['source'] == '年支'
        assert 'secondary' in result
        assert result['secondary']['branch'] == '酉'
        assert result['secondary']['direction'] == '正西'
        assert result['secondary']['source'] == '日支'

    def test_laopo_chart_east_not_south(self):
        """Regression vs Seer bug: Laopo (年寅/日戌) → 正東 NOT 正南."""
        # Laopo: year=寅, day=戌. Both in 寅午戌組 → 桃花=卯 → 正東.
        # Seer erroneously outputs 正南 (by conflating 流年支方位).
        result = get_taohua_directions('寅', '戌')
        assert result['primary']['direction'] == '正東'


# ============================================================
# Fix 4: 文昌貴人方位 tests
# ============================================================

class TestWenchangDirection:
    """Test 文昌貴人方位 per Day Stem (classical 口訣)."""

    def test_all_ten_stems_expected(self):
        """Full classical mapping: 甲→巳, 乙→午, 丙→申, 丁→酉, 戊→申, 己→酉,
        庚→亥, 辛→子, 壬→寅, 癸→卯."""
        expected = {
            '甲': ('巳', '東南'), '乙': ('午', '正南'),
            '丙': ('申', '西南'), '丁': ('酉', '正西'),
            '戊': ('申', '西南'), '己': ('酉', '正西'),
            '庚': ('亥', '西北'), '辛': ('子', '正北'),
            '壬': ('寅', '東北'), '癸': ('卯', '正東'),
        }
        for stem, (branch, direction) in expected.items():
            result = get_wenchang_direction(stem)
            assert result['branch'] == branch, f'{stem}: wrong branch'
            assert result['direction'] == direction, f'{stem}: wrong direction'


# ============================================================
# Fix 4: 生肖貴人 (folk tradition) tests
# ============================================================

class TestZodiacBenefactors:
    """Test folk 生肖貴人 derivation (六合 + 三合) from 年支."""

    def test_yin_year_benefactors(self):
        """年=寅 → 六合=亥(豬), 三合=午(馬)+戌(狗)."""
        result = get_zodiac_benefactors('寅')
        assert result['liuhe']['branch'] == '亥'
        assert result['liuhe']['zodiac'] == '豬'
        assert result['liuhe']['kind'] == 'liuhe'
        sanhe_branches = {e['branch'] for e in result['sanhe']}
        assert sanhe_branches == {'午', '戌'}
        assert all(e['kind'] == 'sanhe' for e in result['sanhe'])

    def test_zi_year_benefactors(self):
        """年=子 → 六合=丑(牛), 三合=申(猴)+辰(龍)."""
        result = get_zodiac_benefactors('子')
        assert result['liuhe']['branch'] == '丑'
        assert result['liuhe']['zodiac'] == '牛'
        sanhe_branches = {e['branch'] for e in result['sanhe']}
        assert sanhe_branches == {'申', '辰'}

    def test_provenance_flag_present(self):
        """Every output must carry provenance flag (no disclaimer string)."""
        for yb in ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']:
            result = get_zodiac_benefactors(yb)
            assert result['provenance'] == 'folk_tradition'
            # No direction/age/name fields (those are APP-fabricated elsewhere)
            assert 'direction' not in result
            assert 'age' not in result
            assert 'nameHint' not in result

    def test_all_twelve_year_branches_coverable(self):
        """Every 年支 produces exactly 1 六合 + 2 三合 entries."""
        for yb in ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']:
            result = get_zodiac_benefactors(yb)
            assert 'liuhe' in result
            assert len(result['sanhe']) == 2
            # 六合 target should be different from both 三合 partners
            assert result['liuhe']['branch'] not in {e['branch'] for e in result['sanhe']}
