"""
Tests for Fix 2 — 調候 advisory layer.

Covers:
  - Full 10 DMs × 12 months TIAOHOU_TABLE coverage smoke test
  - classify_tiaohou_status edge cases (present_strong / weak / combined /
    clashed / absent)
  - compute_tiaohou_advisory integration + 從格 guard
  - classicalPhraseKey closure against the typed Literal union
  - Laopo chart integration assertion
"""

import pytest

from app.tiaohou import (
    TIAOHOU_TABLE,
    TIAOHOU_SECONDARY,
    classify_tiaohou_status,
    compute_tiaohou_advisory,
)


def _p(ys, yb, ms, mb, ds, db, hs, hb):
    return {
        'year':  {'stem': ys, 'branch': yb},
        'month': {'stem': ms, 'branch': mb},
        'day':   {'stem': ds, 'branch': db},
        'hour':  {'stem': hs, 'branch': hb},
    }


# Mirrors TiaohouClassicalPhraseKey Literal union in
# packages/shared/src/types/bazi.ts. Runtime closure is enforced here and
# on the prompt-rendering side. Derived from the 20 realized (dm_element ×
# season × tiaohou_element) combinations in TIAOHOU_TABLE.
ALLOWED_PHRASE_KEYS = {
    # 木 DM
    'cold_wood_needs_fire',     # e.g. 乙甲 亥/子/丑 needing 丙/丁
    'cold_wood_needs_metal',    # 甲亥 needing 庚 (劈甲引火)
    'hot_wood_needs_water',     # 甲乙 巳/午/未 needing 癸
    # 火 DM
    'cold_fire_needs_wood',     # 丙/丁 戌/亥/子/丑 needing 甲
    'cold_fire_needs_water',    # 丙 子/丑 needing 壬
    'hot_fire_needs_wood',      # 丁 某夏月 needing 甲
    'hot_fire_needs_water',     # 丙丁 巳/午/未 needing 壬
    # 土 DM
    'cold_earth_needs_fire',    # 戊/己 冬月 needing 丙
    'cold_earth_needs_wood',    # 戊 冬某月 needing 甲
    'hot_earth_needs_water',    # 戊/己 夏月 needing 癸/壬
    'hot_earth_needs_wood',     # 戊 某夏月 needing 甲
    # 金 DM
    'cold_metal_needs_fire',    # 庚/辛 冬月 needing 丁/丙
    'cold_metal_needs_water',   # 辛亥 needing 壬
    'hot_metal_needs_fire',     # 庚未 needing 丁
    'hot_metal_needs_water',    # 庚/辛 巳/午 needing 壬
    # 水 DM
    'cold_water_needs_earth',   # 壬亥/壬子 needing 戊 (制水)
    'cold_water_needs_fire',    # 壬/癸 丑 needing 丙
    'cold_water_needs_metal',   # 癸亥 needing 庚
    'hot_water_needs_water',    # 壬巳 needing 壬 (同氣為援)
    'hot_water_needs_metal',    # 壬/癸 夏月 needing 辛/庚
    None,                        # transitional (卯/辰/申/酉/寅/戌) emits None
}


class TestTiaohouTable:
    """Smoke test: 10 DMs × 12 months = 120 entries."""

    def test_full_coverage(self):
        dms = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
        months = ['寅', '卯', '辰', '巳', '午', '未',
                  '申', '酉', '戌', '亥', '子', '丑']
        for dm in dms:
            for mb in months:
                assert (dm, mb) in TIAOHOU_TABLE, f'Missing ({dm},{mb})'
                assert len(TIAOHOU_TABLE[(dm, mb)]) == 1

    def test_anchor_jia_chou_is_ding(self):
        """《窮通寶鑑》甲木十二月: 丑月專用丁."""
        assert TIAOHOU_TABLE[('甲', '丑')] == '丁'
        # Secondary 丙 per mainstream 調候用神簡表
        assert TIAOHOU_SECONDARY.get(('甲', '丑')) == '丙'

    def test_anchor_bing_wu_is_ren(self):
        """丙火五月 (午月): 專用壬."""
        assert TIAOHOU_TABLE[('丙', '午')] == '壬'


class TestClassifyTiaohouStatus:
    """Test presence / 合 / 沖 / absent classification."""

    def test_present_strong_transparent_with_root(self):
        # 甲DM, 調候神=丁. 丁 透於 month stem + 未 中氣=丁 (strong root).
        # 未 has hidden stems [己, 丁, 乙] → 丁 at position 1 (中氣).
        pillars = _p('甲', '未', '丁', '卯', '甲', '子', '戊', '辰')
        status, partner = classify_tiaohou_status(pillars, '丁', '子')
        assert status == 'present_strong'
        assert partner is None

    def test_present_weak_transparent_rootless(self):
        # 甲DM, 子月, 調候神=丁. 丁 透於 month stem but no hidden root.
        # 子=癸, 午=丁己(no 丁 if we avoid 午), 戌=戊辛丁(中氣=丁 — strong).
        # Use branches without 丁 root: 子/寅/卯/申. 丁 透 rootless.
        pillars = _p('甲', '子', '丁', '卯', '甲', '寅', '戊', '申')
        status, partner = classify_tiaohou_status(pillars, '丁', '子')
        assert status == 'present_weak'
        assert partner is None

    def test_combined_dingren(self):
        # 甲DM, 子月, 調候神=丁. 丁 透 + 壬 透 → 丁壬合 → combined.
        pillars = _p('甲', '寅', '丁', '卯', '甲', '戌', '壬', '申')
        status, partner = classify_tiaohou_status(pillars, '丁', '子')
        assert status == 'combined'
        assert partner == '壬'

    def test_clashed_jia_geng(self):
        # 丁DM, 寅月, 調候神=甲. 甲 透 + 庚 透 → 甲庚沖 → clashed.
        pillars = _p('甲', '寅', '庚', '申', '丁', '卯', '戊', '辰')
        status, partner = classify_tiaohou_status(pillars, '甲', '寅')
        assert status == 'clashed'
        assert partner == '庚'

    def test_absent(self):
        # 調候神 nowhere in chart (stems or any hidden 藏干).
        # 甲DM, 子月, 調候神=丁. No 丁/午/戌/未 in chart.
        pillars = _p('甲', '子', '壬', '申', '甲', '寅', '戊', '辰')
        status, partner = classify_tiaohou_status(pillars, '丁', '子')
        assert status == 'absent'
        assert partner is None


class TestComputeTiaohouAdvisory:
    """Test the main advisory function — integration + 從格 guard."""

    def test_returns_structured_dict(self):
        pillars = _p('甲', '寅', '丁', '戌', '甲', '寅', '戊', '辰')
        result = compute_tiaohou_advisory(pillars, '甲', '子')
        assert result is not None
        assert set(result.keys()) == {
            'primaryGod', 'secondaryGod', 'status',
            'combinedBy', 'clashedBy', 'seasonalContext', 'classicalPhraseKey',
        }
        assert result['primaryGod'] == '丁'
        assert result['secondaryGod'] == '丙'
        assert result['seasonalContext'] == 'cold_winter'

    def test_cong_ge_skipped(self):
        pillars = _p('甲', '寅', '丁', '戌', '甲', '寅', '戊', '辰')
        result = compute_tiaohou_advisory(pillars, '甲', '子', is_cong_ge=True)
        assert result is None

    def test_seasonal_context_hot_summer(self):
        pillars = _p('甲', '寅', '丁', '卯', '丙', '午', '戊', '辰')
        result = compute_tiaohou_advisory(pillars, '丙', '午')
        assert result['seasonalContext'] == 'hot_summer'

    def test_seasonal_context_transitional(self):
        pillars = _p('甲', '寅', '丁', '卯', '甲', '寅', '戊', '辰')
        result = compute_tiaohou_advisory(pillars, '甲', '卯')
        assert result['seasonalContext'] == 'transitional'
        # Transitional months emit None phrase key.
        assert result['classicalPhraseKey'] is None

    def test_classical_phrase_key_cold_wood(self):
        # 甲木 (wood) in cold season (子月) → cold_wood_needs_fire.
        pillars = _p('甲', '寅', '丁', '卯', '甲', '寅', '戊', '辰')
        result = compute_tiaohou_advisory(pillars, '甲', '子')
        assert result['classicalPhraseKey'] == 'cold_wood_needs_fire'

    def test_classical_phrase_key_hot_fire(self):
        # 丙火 in 午月 → hot_fire_needs_water.
        pillars = _p('甲', '寅', '丁', '卯', '丙', '午', '戊', '辰')
        result = compute_tiaohou_advisory(pillars, '丙', '午')
        assert result['classicalPhraseKey'] == 'hot_fire_needs_water'


class TestPhraseKeyClosure:
    """classicalPhraseKey must stay in sync with the typed Literal union
    in packages/shared/src/types/bazi.ts (reviewer polish #4).
    """

    def test_all_emitted_keys_in_allowed_set(self):
        """Enumerate all DM × month combinations; every phrase key emitted
        must appear in ALLOWED_PHRASE_KEYS (None included for transitional).
        """
        # Minimal pillars (shape only matters — phrase key derives from
        # dm_element + seasonal_context + tiaohou_element).
        for dm in ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']:
            for mb in ['寅', '卯', '辰', '巳', '午', '未',
                       '申', '酉', '戌', '亥', '子', '丑']:
                pillars = _p('甲', '寅', '丁', mb, dm, '寅', '戊', '辰')
                result = compute_tiaohou_advisory(pillars, dm, mb)
                if result is None:
                    continue
                assert result['classicalPhraseKey'] in ALLOWED_PHRASE_KEYS, (
                    f'({dm},{mb}) emitted unknown key '
                    f"{result['classicalPhraseKey']!r}"
                )


class TestLaopoIntegration:
    """Integration check against the Laopo chart.

    Laopo: 丙寅/辛丑/甲戌/壬申, female, very_weak 甲DM, 丑月.
    Classical 調候 for 甲丑: 丁 primary + 丙 secondary.
      - 丁 is NOT in any stem of Laopo's chart.
      - 丁 藏 in 戌 中氣 (position 1). So pressure > 0 → NOT absent.
      - 丁 is not transparent → not combined/clashed.
      - Status: present_weak (only 中氣 藏干, no 透干).
    """

    def test_laopo_tiaohou_status(self):
        pillars = _p('丙', '寅', '辛', '丑', '甲', '戌', '壬', '申')
        result = compute_tiaohou_advisory(pillars, '甲', '丑')
        assert result is not None
        assert result['primaryGod'] == '丁'
        assert result['secondaryGod'] == '丙'
        # 丁 is ONLY in 戌 中氣 and 未 中氣 (未 not in chart).
        # So 丁 hidden in 戌 中氣 only → present_weak (not strong, not combined).
        assert result['status'] == 'present_weak'
        assert result['combinedBy'] is None
        assert result['clashedBy'] is None
        assert result['seasonalContext'] == 'cold_winter'
        assert result['classicalPhraseKey'] == 'cold_wood_needs_fire'
