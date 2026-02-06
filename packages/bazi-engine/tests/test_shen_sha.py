"""
Tests for Shen Sha (神煞) calculation.
"""

import pytest
from app.calculator import calculate_bazi
from app.shen_sha import calculate_kong_wang, calculate_shen_sha_for_pillar


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
        """All Shen Sha names should be from our known list."""
        valid_names = {
            '天乙貴人', '文昌', '驛馬', '桃花', '華蓋',
            '將星', '祿神', '羊刃', '空亡',
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
