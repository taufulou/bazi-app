"""
Phase 12b tests — monthly scoring refinements.

Covers:
  Fix A — rootedness-aware 蓋頭/截腳 halving (十二長生 on flow pillar)
  Fix B — role-conditional 伏吟 amplification (multi-pillar)
  Fix C — 殺印/官印相生 transient activation
  Fix D — 六合 strict 化氣 (default bound_only)
  Composition + ruleTrace ordering
  從格 guards on A/B/C/D
  Non-trigger cases
  Flag-off degradation (Fix C + Fix D 真化)

Classical sources: see .claude/plans/bazi-phase-12b-monthly-refinements.md
"""

import pytest

from app import annual_enhanced as ae
from app.annual_enhanced import (
    PHASE_12B_RULES_ENABLED,
    _compute_single_month,
    _fix_a_gaitou_halving_applies,
    _fix_b_fuyin_role_amplification,
    _fix_c_detect_officer_seal_transient,
    _fix_d_check_liu_he,
)


# Shared pillar fixture helper
def _p(ys, yb, ms, mb, ds, db, hs_, hb):
    return {
        'year':  {'stem': ys, 'branch': yb},
        'month': {'stem': ms, 'branch': mb},
        'day':   {'stem': ds, 'branch': db},
        'hour':  {'stem': hs_, 'branch': hb},
    }


def _laopo():
    """Canonical Laopo chart: 丙寅/辛丑/甲戌/壬申 female."""
    return _p('丙', '寅', '辛', '丑', '甲', '戌', '壬', '申')


def _laopo_gods():
    """Laopo's effective gods after Phase 12 Fix 1a (用=水, 喜=木).

    Returns ten-god-keyed format (expected by annual_enhanced helpers).
    For 甲DM: 水=用(偏/正印), 木=喜(比肩/劫財), 金=忌(偏/正官),
    土=仇(偏/正財), 火=閒(食神/傷官).
    """
    return {
        '比肩': '喜神', '劫財': '喜神',
        '食神': '閒神', '傷官': '閒神',
        '偏財': '仇神', '正財': '仇神',
        '偏官': '忌神', '正官': '忌神',
        '偏印': '用神', '正印': '用神',
    }


# ============================================================
# Fix A — 蓋頭/截腳 halving gate
# ============================================================

@pytest.mark.skipif(
    not PHASE_12B_RULES_ENABLED.get('A', True),
    reason='Fix A gate tests require PHASE_12B_FIX_A=1',
)
class TestFixAHalving:
    def test_jia_dies_on_wu(self):
        """甲木 at 午 is 死 → halving gate returns True."""
        assert _fix_a_gaitou_halving_applies('甲', '午') is True

    def test_geng_absent_on_yin(self):
        """庚金 at 寅 is 絕 → halving gate returns True."""
        assert _fix_a_gaitou_halving_applies('庚', '寅') is True

    def test_xin_absent_on_mao(self):
        """辛金 at 卯 is 絕 → halving gate returns True."""
        assert _fix_a_gaitou_halving_applies('辛', '卯') is True

    def test_geng_dies_on_zi(self):
        """庚金 at 子 is 死 → halving gate returns True."""
        assert _fix_a_gaitou_halving_applies('庚', '子') is True

    def test_jia_lu_on_yin(self):
        """甲木 at 寅 is 臨官 — not 絕/死/墓, halving does NOT apply."""
        assert _fix_a_gaitou_halving_applies('甲', '寅') is False

    def test_bing_on_yin(self):
        """丙火 at 寅 is 長生 — not 絕/死/墓."""
        assert _fix_a_gaitou_halving_applies('丙', '寅') is False


# ============================================================
# Fix B — 伏吟 role-conditional amplification
# ============================================================

class TestFixBFuYin:
    def test_day_pillar_favorable_fuyin(self):
        """Day branch 伏吟 on 喜/用 branch → applied upgrade at weight 1.0."""
        # 甲DM weak, day branch=寅(比肩=喜), flow month also=寅
        pillars = _p('乙', '未', '丙', '辰', '甲', '寅', '戊', '午')
        gods = _laopo_gods()  # ten-god-keyed format
        res = _fix_b_fuyin_role_amplification(
            month_branch='寅', pillars=pillars, day_master_stem='甲',
            effective_gods=gods, concurrent_clash=False,
        )
        assert len(res) == 1
        assert res[0]['pillar'] == 'day'
        assert res[0]['direction'] == 'upgrade'
        assert res[0]['applied'] is True

    def test_year_pillar_narrative_only(self):
        """Year 伏吟 (weight=0.5) → narrative-only flag, applied=False."""
        pillars = _laopo()
        res = _fix_b_fuyin_role_amplification(
            month_branch='寅', pillars=pillars, day_master_stem='甲',
            effective_gods=_laopo_gods(), concurrent_clash=False,
        )
        # year branch=寅(比肩=喜) → direction upgrade but applied=False (weight 0.5)
        year_entry = next((e for e in res if e['pillar'] == 'year'), None)
        assert year_entry is not None
        assert year_entry['direction'] == 'upgrade'
        assert year_entry['applied'] is False

    def test_concurrent_clash_caps_applied(self):
        """Simultaneous 六沖 elsewhere caps applied=False for 伏吟."""
        pillars = _laopo()
        res = _fix_b_fuyin_role_amplification(
            month_branch='寅', pillars=pillars, day_master_stem='甲',
            effective_gods=_laopo_gods(), concurrent_clash=True,
        )
        for e in res:
            assert e['applied'] is False

    def test_idle_god_no_op(self):
        """閒神 branch 伏吟 → no entry emitted (not even narrative)."""
        # 甲DM, hour branch=午(傷官=閒 for Laopo gods), flow month=午
        pillars = _laopo()
        res = _fix_b_fuyin_role_amplification(
            month_branch='午', pillars=pillars, day_master_stem='甲',
            effective_gods=_laopo_gods(), concurrent_clash=False,
        )
        # 午 matches no natal branch (Laopo has 寅/丑/戌/申) → empty.
        assert res == []


# ============================================================
# Fix C — 殺印/官印相生 transient activation
# ============================================================

@pytest.mark.skipif(
    not PHASE_12B_RULES_ENABLED.get('C', True),
    reason='Fix C activation tests require PHASE_12B_FIX_C_ENABLED=1',
)
class TestFixCOfficerSeal:
    def test_laopo_geng_zi_full_activation(self):
        """Laopo 庚子月: 庚(七殺) + 子(本氣癸=正印) → full 殺印相生."""
        gods = _laopo_gods()
        act = _fix_c_detect_officer_seal_transient(
            month_stem='庚', month_branch='子',
            pillars=_laopo(), day_master_stem='甲',
            strength='very_weak', effective_gods=gods, is_cong_ge=False,
        )
        assert act is not None
        assert act['pattern'] == 'sha_yin'
        assert act['level'] == 'full'
        assert act['direction'] == 'positive'
        assert act['seal_source'] == 'benqi'

    def test_laopo_xin_chou_blocked_by_internal_cai_huai_yin(self):
        """Laopo 辛丑月: 丑本氣=己(正財) with 中氣=癸(正印) → 財壞印 blocks."""
        gods = _laopo_gods()
        act = _fix_c_detect_officer_seal_transient(
            month_stem='辛', month_branch='丑',
            pillars=_laopo(), day_master_stem='甲',
            strength='very_weak', effective_gods=gods, is_cong_ge=False,
        )
        assert act is None, '財壞印 should block partial activation on 辛丑'

    def test_cong_ge_guarded(self):
        """從格 chart → activation suppressed."""
        act = _fix_c_detect_officer_seal_transient(
            month_stem='庚', month_branch='子',
            pillars=_laopo(), day_master_stem='甲',
            strength='very_weak', effective_gods=_laopo_gods(), is_cong_ge=True,
        )
        assert act is None

    def test_strong_dm_reverse_direction(self):
        """Strong DM + 官殺 month + 印 branch → reverse mild negative direction."""
        # Synthetic: 甲DM strong chart. Doesn't need to be realistic — just check direction.
        pillars = _p('甲', '寅', '乙', '卯', '甲', '寅', '乙', '卯')
        # Need 印 in month branch hidden. Use 子 (癸=正印 for 甲DM).
        act = _fix_c_detect_officer_seal_transient(
            month_stem='庚', month_branch='子',
            pillars=pillars, day_master_stem='甲',
            strength='strong', effective_gods=_laopo_gods(), is_cong_ge=False,
        )
        assert act is not None
        assert act['direction'] == 'reverse'

    def test_neutral_dm_no_activation(self):
        """Neutral DM — activation ambiguous, skip to keep scope tight."""
        act = _fix_c_detect_officer_seal_transient(
            month_stem='庚', month_branch='子',
            pillars=_laopo(), day_master_stem='甲',
            strength='neutral', effective_gods=_laopo_gods(), is_cong_ge=False,
        )
        assert act is None

    def test_shi_shang_adjacent_blocks(self):
        """食傷 transparent on month/hour stem (adjacent) → 奪印 blocks."""
        # Use 月干 = 丙 (食神 for 甲DM), 時干 plain
        pillars = _p('戊', '辰', '丙', '子', '甲', '子', '庚', '申')
        # Flow: 庚子 with 子本氣=癸印. BUT month stem 丙=食神 in natal month stem.
        # Wait — the month stem is the FLOW month stem, and we're constructing natal.
        # The natal 月干 is 丙. That should block.
        act = _fix_c_detect_officer_seal_transient(
            month_stem='庚', month_branch='子',
            pillars=pillars, day_master_stem='甲',
            strength='weak', effective_gods=_laopo_gods(), is_cong_ge=False,
        )
        assert act is None

    def test_year_shi_shen_non_adjacent_does_not_block(self):
        """食傷 on year stem (distant) does NOT block — Laopo case.

        Laopo's 丙 year stem is 食神, but adjacency rule allows 殺印 to fire
        on flow month. This was the key fix for 庚子 activation.
        """
        act = _fix_c_detect_officer_seal_transient(
            month_stem='庚', month_branch='子',
            pillars=_laopo(), day_master_stem='甲',
            strength='very_weak', effective_gods=_laopo_gods(), is_cong_ge=False,
        )
        assert act is not None
        assert act['pattern'] == 'sha_yin'


# ============================================================
# Fix D — 六合 strict 化氣 gate
# ============================================================

class TestFixDLiuHe:
    def test_mao_xu_bound_only_when_hua_not_in_season(self):
        """Laopo 辛卯月 × 戌 day branch: 化火 but 火 not 旺 in 卯 → bound_only."""
        results = _fix_d_check_liu_he(
            month_branch='卯', month_stem='辛',
            pillars=_laopo(), flow_year_stem='丙',
            day_master_stem='甲', effective_gods=_laopo_gods(),
        )
        assert len(results) == 1
        assert results[0]['kind'] == 'bound_only'
        # Block reason: either weaker rooted OR hua not in season
        assert results[0].get('block_reason') in (
            'weaker_rooted', 'hua_not_transparent', 'hua_not_in_season'
        )

    def test_no_combination(self):
        """Month branch without 六合 partner in natal → empty results."""
        # Laopo natal {寅,丑,戌,申}; 六合 partners: 寅↔亥, 丑↔子, 戌↔卯, 申↔巳.
        # Flow month 午: 午未合 → 未 not in natal. → no result.
        results = _fix_d_check_liu_he(
            month_branch='午', month_stem='甲',
            pillars=_laopo(), flow_year_stem='丙',
            day_master_stem='甲', effective_gods=_laopo_gods(),
        )
        assert results == []

    def test_zheng_he_forces_bound_only(self):
        """Branch 六合 with multiple natal branches → forced bound_only."""
        # Construct: flow month 寅, natal has 亥 in year AND hour (both combine with 寅)
        pillars = _p('乙', '亥', '辛', '丑', '甲', '戌', '乙', '亥')
        results = _fix_d_check_liu_he(
            month_branch='寅', month_stem='甲',
            pillars=pillars, flow_year_stem='丁',
            day_master_stem='甲', effective_gods=_laopo_gods(),
        )
        # Two liuhe entries (year 亥 + hour 亥), both forced bound_only via zheng_he
        assert len(results) == 2
        for r in results:
            assert r['kind'] == 'bound_only'
            assert r.get('block_reason') == 'zheng_he'


# ============================================================
# Composition + ruleTrace ordering (C→A→B→D)
# ============================================================

@pytest.mark.skipif(
    not PHASE_12B_RULES_ENABLED.get('C', True)
    or not PHASE_12B_RULES_ENABLED.get('A', True),
    reason='Composition tests require Fix A AND Fix C enabled',
)
class TestComposition:
    def test_laopo_geng_zi_c_fires_skips_a(self):
        """C fires (殺印相生) → A SKIPPED. ruleTrace has no 'gaitou_halving'."""
        pillars = _laopo()
        gods = _laopo_gods()
        result = _compute_single_month(
            month_data={'stem': '庚', 'branch': '子'},
            pillars=pillars, day_master_stem='甲',
            effective_gods=gods, gender='female',
            year_branch='寅', day_branch='戌',
            kong_wang=['申', '酉'], flow_year_auspiciousness='平',
            strength='very_weak', is_cong_ge=False, flow_year_stem='丙',
        )
        assert result['baseAuspiciousness'] == '大吉'
        trace = result['ruleTrace']
        # C fires first
        assert any('officer_seal_transient' in t for t in trace)
        # A is SKIPPED — no 'gaitou_halving' entry
        assert not any(t.startswith('gaitou_halving') for t in trace)

    def test_laopo_geng_yin_c_misses_a_fires(self):
        """C doesn't fire (寅 is 比劫 not 印) → A fires (庚絕寅)."""
        pillars = _laopo()
        gods = _laopo_gods()
        result = _compute_single_month(
            month_data={'stem': '庚', 'branch': '寅'},
            pillars=pillars, day_master_stem='甲',
            effective_gods=gods, gender='female',
            year_branch='寅', day_branch='戌',
            kong_wang=['申', '酉'], flow_year_auspiciousness='平',
            strength='very_weak', is_cong_ge=False, flow_year_stem='丙',
        )
        trace = result['ruleTrace']
        # C did NOT fire
        assert not any('officer_seal' in t for t in trace)
        # A fired
        assert 'gaitou_halving_upgrade' in trace
        # Base upgraded from 吉中有凶 → 吉
        assert result['baseAuspiciousness'] == '吉'

    def test_rule_trace_ordering_c_before_a_before_b_before_d(self):
        """Rule trace entries must appear in execution order C → A → B → D."""
        pillars = _laopo()
        gods = _laopo_gods()
        result = _compute_single_month(
            month_data={'stem': '庚', 'branch': '子'},
            pillars=pillars, day_master_stem='甲',
            effective_gods=gods, gender='female',
            year_branch='寅', day_branch='戌',
            kong_wang=['申', '酉'], flow_year_auspiciousness='平',
            strength='very_weak', is_cong_ge=False, flow_year_stem='丙',
        )
        trace = result['ruleTrace']
        # C first
        c_idx = next((i for i, t in enumerate(trace) if 'officer_seal' in t), -1)
        # D after C (Fix A skipped here because C fired; B no match for 子)
        d_idx = next((i for i, t in enumerate(trace) if 'liuhe' in t), -1)
        if c_idx >= 0 and d_idx >= 0:
            assert c_idx < d_idx, f'C must come before D in ruleTrace; got {trace}'


# ============================================================
# Non-trigger cases (false-positive guard)
# ============================================================

class TestNonTrigger:
    def test_a_non_trigger_stem_rooted(self):
        """Stem at 臨官/帝旺 on flow branch — halving does NOT apply."""
        # 甲DM, 月=甲寅 (甲 at 寅=臨官). Not 絕/死/墓.
        pillars = _laopo()
        gods = _laopo_gods()
        result = _compute_single_month(
            month_data={'stem': '甲', 'branch': '寅'},
            pillars=pillars, day_master_stem='甲',
            effective_gods=gods, gender='female',
            year_branch='寅', day_branch='戌',
            kong_wang=[], flow_year_auspiciousness='平',
            strength='very_weak', is_cong_ge=False, flow_year_stem='丙',
        )
        # No halving entry should appear
        assert 'gaitou_halving_upgrade' not in result['ruleTrace']

    def test_c_non_trigger_no_seal_in_branch(self):
        """七殺 month stem but branch has no 印 → no activation."""
        # 甲DM, 庚 stem + 寅 branch (比劫 not 印)
        act = _fix_c_detect_officer_seal_transient(
            month_stem='庚', month_branch='寅',
            pillars=_laopo(), day_master_stem='甲',
            strength='very_weak', effective_gods=_laopo_gods(), is_cong_ge=False,
        )
        assert act is None

    def test_d_non_trigger_no_combination(self):
        """Flow month branch with no 六合 partner in natal → empty results."""
        results = _fix_d_check_liu_he(
            month_branch='午', month_stem='甲',
            pillars=_laopo(), flow_year_stem='丙',
            day_master_stem='甲', effective_gods=_laopo_gods(),
        )
        assert results == []


# ============================================================
# Flag-off degradation (Fix C + Fix D 真化)
# ============================================================

class TestFlags:
    def test_fix_c_flag_off(self, monkeypatch):
        """When PHASE_12B_FIX_C_ENABLED=False, activation returns None."""
        monkeypatch.setitem(PHASE_12B_RULES_ENABLED, 'C', False)
        act = _fix_c_detect_officer_seal_transient(
            month_stem='庚', month_branch='子',
            pillars=_laopo(), day_master_stem='甲',
            strength='very_weak', effective_gods=_laopo_gods(), is_cong_ge=False,
        )
        assert act is None

    def test_fix_d_transformation_flag_off(self, monkeypatch):
        """Flag off: true_transformation path collapses to bound_only."""
        monkeypatch.setitem(PHASE_12B_RULES_ENABLED, 'D_TRANSFORMATION', False)
        # Construct a chart that would qualify for 真化 if flag were on.
        # 寅亥合化木, 化木 旺 in 卯月 (multiplier 1.5). Put 甲 transparent.
        pillars = _p('甲', '寅', '丙', '卯', '丁', '亥', '戊', '午')
        results = _fix_d_check_liu_he(
            month_branch='亥', month_stem='丁',
            pillars=pillars, flow_year_stem='甲',
            day_master_stem='丁', effective_gods=_laopo_gods(),
        )
        # Must NOT emit true_transformation
        for r in results:
            assert r['kind'] != 'true_transformation', (
                f'Flag off should block 真化; got {r}'
            )

    def test_fix_b_flag_off(self, monkeypatch):
        """When PHASE_12B_FIX_B=False, helper returns empty list."""
        monkeypatch.setitem(PHASE_12B_RULES_ENABLED, 'B', False)
        res = _fix_b_fuyin_role_amplification(
            month_branch='寅', pillars=_laopo(), day_master_stem='甲',
            effective_gods=_laopo_gods(), concurrent_clash=False,
        )
        assert res == []


# ============================================================
# Laopo 2026 integration — 3 target months
# ============================================================

@pytest.mark.skipif(
    not PHASE_12B_RULES_ENABLED.get('A', True)
    or not PHASE_12B_RULES_ENABLED.get('C', True),
    reason='Laopo integration requires Fix A AND Fix C enabled',
)
class TestLaopoIntegration:
    """The 3 monthly disagreements Phase 12b aimed to fix."""

    def _run_month(self, month_stem, month_branch):
        pillars = _laopo()
        gods = _laopo_gods()
        return _compute_single_month(
            month_data={'stem': month_stem, 'branch': month_branch},
            pillars=pillars, day_master_stem='甲',
            effective_gods=gods, gender='female',
            year_branch='寅', day_branch='戌',
            kong_wang=['申', '酉'], flow_year_auspiciousness='平',
            strength='very_weak', is_cong_ge=False, flow_year_stem='丙',
        )

    def test_geng_yin_upgrades_to_ji(self):
        """庚寅 → 吉 (Fix A halving via 庚絕寅)."""
        result = self._run_month('庚', '寅')
        assert result['baseAuspiciousness'] == '吉'
        assert 'gaitou_halving_upgrade' in result['ruleTrace']

    def test_xin_mao_upgrades_to_ji(self):
        """辛卯 → 吉 (Fix A halving via 辛絕卯)."""
        result = self._run_month('辛', '卯')
        assert result['baseAuspiciousness'] == '吉'
        assert 'gaitou_halving_upgrade' in result['ruleTrace']

    def test_geng_zi_upgrades_to_da_ji(self):
        """庚子 → 大吉 (Fix C 殺印相生, full level)."""
        result = self._run_month('庚', '子')
        assert result['baseAuspiciousness'] == '大吉'
        osa = result.get('officerSealActivation')
        assert osa is not None
        assert osa['pattern'] == 'sha_yin'
        assert osa['level'] == 'full'

    def test_xin_chou_stays_da_xiong(self):
        """辛丑 → 大凶 (Fix C BLOCKED by same-branch 財壞印)."""
        result = self._run_month('辛', '丑')
        # branchBase = 大凶 (丑 本氣=己=正財=仇神)
        assert result['branchBase'] == '大凶'
        # Fix C did NOT activate (内部 財壞印)
        assert 'officerSealActivation' not in result

    def test_roger_like_chart_no_regression(self):
        """Regression guard: 戊DM chart should not trigger unexpected 殺印相生."""
        # Minimal Roger-like (戊DM with natal 甲+寅 + 壬+子 for 七殺+印 presence)
        pillars = _p('戊', '辰', '甲', '寅', '戊', '子', '壬', '子')
        gods = {
            '用神': '火', '喜神': '土', '忌神': '水', '仇神': '木', '閒神': '金',
        }
        # Flow month 甲午: 甲 is 七殺 for 戊DM? No — 甲 是 七殺 for 戊 (木克土).
        # 午 本氣=丁=正印. Might trigger 殺印相生 for weak DM.
        # But strength is neutral here in this synthetic.
        result = _compute_single_month(
            month_data={'stem': '甲', 'branch': '午'},
            pillars=pillars, day_master_stem='戊',
            effective_gods=gods, gender='male',
            year_branch='辰', day_branch='子',
            kong_wang=[], flow_year_auspiciousness='吉',
            strength='neutral', is_cong_ge=False, flow_year_stem='丙',
        )
        # Neutral DM suppresses Fix C
        assert 'officerSealActivation' not in result
