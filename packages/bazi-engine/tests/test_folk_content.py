"""Phase 1.5.z folk content engine tests.

Covers:
- ELEMENT_COLOR / ELEMENT_NUMBER / ELEMENT_FOOD_FAVOR / ELEMENT_FOOD_AVOID
  table shape + classical citation presence
- compute_auspicious_hours: 6 canonical rosters + day-branch equivalence
  classes (proves month-branch independence per Phase A Sub-Agent C P0 fix)
- compute_folk_content: full payload shape + 用神 dispatch + edge cases
- Roger 2026-05-23 calibration anchor
"""

import pytest

from app.folk_content import (
    BRANCH_ORDER,
    DAY_BRANCH_QINGLONG_HOUR_START,
    ELEMENT_COLOR,
    ELEMENT_FOOD_AVOID,
    ELEMENT_FOOD_FAVOR,
    ELEMENT_NUMBER,
    HOUR_RANGES,
    SHENSHA_ROAD,
    SHENSHA_SEQUENCE,
    compute_auspicious_hours,
    compute_folk_content,
)


# ============================================================================
# 1. Lookup table shape + completeness
# ============================================================================

ELEMENTS = ('木', '火', '土', '金', '水')


class TestElementColorTable:
    def test_all_5_elements_present(self):
        assert set(ELEMENT_COLOR.keys()) == set(ELEMENTS)

    @pytest.mark.parametrize('element', ELEMENTS)
    def test_required_fields_per_element(self, element):
        entry = ELEMENT_COLOR[element]
        for key in ('primary', 'secondary', 'tertiary', 'classical_cite', 'provenance'):
            assert key in entry, f"missing {key} for {element}"
        assert entry['provenance'] == 'classical'

    @pytest.mark.parametrize('element', ELEMENTS)
    def test_素問_cited(self, element):
        cite = ELEMENT_COLOR[element]['classical_cite']
        assert '素問' in cite, f"missing 素問 citation for {element}: {cite}"

    def test_primary_color_assignments(self):
        # 五行配色 hard-locked per 黃帝內經素問·陰陽應象大論
        assert ELEMENT_COLOR['木']['primary'] == '青'
        assert ELEMENT_COLOR['火']['primary'] == '紅'
        assert ELEMENT_COLOR['土']['primary'] == '黃'
        assert ELEMENT_COLOR['金']['primary'] == '白'
        assert ELEMENT_COLOR['水']['primary'] == '黑'


class TestElementNumberTable:
    def test_all_5_elements_present(self):
        assert set(ELEMENT_NUMBER.keys()) == set(ELEMENTS)

    @pytest.mark.parametrize('element', ELEMENTS)
    def test_required_fields(self, element):
        entry = ELEMENT_NUMBER[element]
        for key in ('numbers', 'cite', 'provenance', 'modern_consensus_note'):
            assert key in entry
        assert entry['provenance'] == 'folk_tradition'  # locked decision #7
        assert '河圖' in entry['cite']
        assert isinstance(entry['numbers'], list)
        assert len(entry['numbers']) == 2

    def test_河圖_number_assignments(self):
        # 河圖五行數 (canonical)
        assert ELEMENT_NUMBER['水']['numbers'] == [1, 6]
        assert ELEMENT_NUMBER['火']['numbers'] == [2, 7]
        assert ELEMENT_NUMBER['木']['numbers'] == [3, 8]
        assert ELEMENT_NUMBER['金']['numbers'] == [4, 9]
        assert ELEMENT_NUMBER['土']['numbers'] == [5, 10]


class TestElementFoodFavorTable:
    def test_all_5_elements_present(self):
        assert set(ELEMENT_FOOD_FAVOR.keys()) == set(ELEMENTS)

    @pytest.mark.parametrize('element', ELEMENTS)
    def test_required_fields(self, element):
        entry = ELEMENT_FOOD_FAVOR[element]
        for key in ('category', 'examples', 'cite', 'provenance'):
            assert key in entry
        assert entry['provenance'] == 'classical'
        assert '素問' in entry['cite']
        assert isinstance(entry['examples'], list)
        assert len(entry['examples']) >= 3, f"{element}: at least 3 examples required"


class TestElementFoodAvoidTable:
    def test_all_5_elements_present(self):
        assert set(ELEMENT_FOOD_AVOID.keys()) == set(ELEMENTS)

    @pytest.mark.parametrize('element', ELEMENTS)
    def test_all_doctrinal_strong_with_at_least_3_sources(self, element):
        # Per Phase A Sub-Agent A: all 5 entries must be doctrinal + strong + ≥3 sources
        entry = ELEMENT_FOOD_AVOID[element]
        assert entry['classification'] == 'doctrinal', f"{element}: must be doctrinal (not tcm_conditional)"
        assert entry['avoid_strength'] == 'strong', f"{element}: must be strong"
        assert entry['provenance'] == 'classical'
        assert len(entry['cite_sources']) >= 3, \
            f"{element}: ≥3 cross-source classical citations required (medical adjacency)"

    @pytest.mark.parametrize('element', ELEMENTS)
    def test_五行剋_mechanism_cited_in_reason(self, element):
        # Reason must explicitly cite the 五行 mechanism (anti-folk-drift)
        reason = ELEMENT_FOOD_AVOID[element]['reason']
        assert '剋' in reason, f"{element} avoid reason must cite 剋 mechanism: {reason}"
        assert '用神' in reason, f"{element} avoid reason must reference 用神: {reason}"

    def test_五行剋_chain_correctness(self):
        # Verify the 剋 relationships are correctly mapped (anti-mistake check)
        assert '金剋木' in ELEMENT_FOOD_AVOID['木']['category']
        assert '水剋火' in ELEMENT_FOOD_AVOID['火']['category']
        assert '木剋土' in ELEMENT_FOOD_AVOID['土']['category']
        assert '火剋金' in ELEMENT_FOOD_AVOID['金']['category']
        assert '土剋水' in ELEMENT_FOOD_AVOID['水']['category']


# ============================================================================
# 2. 黃道吉時 algorithm tables
# ============================================================================

class TestQingLongStartTable:
    def test_all_12_day_branches_mapped(self):
        # All 12 day-branches must have an entry
        all_branches = set(BRANCH_ORDER)
        assert set(DAY_BRANCH_QINGLONG_HOUR_START.keys()) == all_branches

    def test_only_6_unique_values_pairing(self):
        # Per 青龍訣: 子=午 / 卯=酉 / 寅=申 / 巳=亥 / 辰=戌 / 丑=未 (6 equivalence pairs)
        assert len(set(DAY_BRANCH_QINGLONG_HOUR_START.values())) == 6

    def test_canonical_pairings_per_qinglong_jue(self):
        # 子午青龍起在申
        assert DAY_BRANCH_QINGLONG_HOUR_START['子'] == '申'
        assert DAY_BRANCH_QINGLONG_HOUR_START['午'] == '申'
        # 卯酉之日又在寅
        assert DAY_BRANCH_QINGLONG_HOUR_START['卯'] == '寅'
        assert DAY_BRANCH_QINGLONG_HOUR_START['酉'] == '寅'
        # 寅申須從子上起
        assert DAY_BRANCH_QINGLONG_HOUR_START['寅'] == '子'
        assert DAY_BRANCH_QINGLONG_HOUR_START['申'] == '子'
        # 巳亥在午不須論
        assert DAY_BRANCH_QINGLONG_HOUR_START['巳'] == '午'
        assert DAY_BRANCH_QINGLONG_HOUR_START['亥'] == '午'
        # 唯有辰戌歸辰位
        assert DAY_BRANCH_QINGLONG_HOUR_START['辰'] == '辰'
        assert DAY_BRANCH_QINGLONG_HOUR_START['戌'] == '辰'
        # 丑未原從戌上尋
        assert DAY_BRANCH_QINGLONG_HOUR_START['丑'] == '戌'
        assert DAY_BRANCH_QINGLONG_HOUR_START['未'] == '戌'


class TestShenShaTables:
    def test_sequence_exactly_12(self):
        assert len(SHENSHA_SEQUENCE) == 12

    def test_first_shensha_is_qinglong(self):
        # The sequence ANCHORS on 青龍 — this ordering is load-bearing
        assert SHENSHA_SEQUENCE[0] == '青龍'

    def test_all_12_shensha_mapped_to_road(self):
        assert set(SHENSHA_ROAD.keys()) == set(SHENSHA_SEQUENCE)

    def test_6_yellow_6_black(self):
        yellow = [s for s, road in SHENSHA_ROAD.items() if road == '黃道']
        black = [s for s, road in SHENSHA_ROAD.items() if road == '黑道']
        assert len(yellow) == 6
        assert len(black) == 6

    def test_canonical_disposition(self):
        # 6 黃道: 青龍/明堂/金匱/天德/玉堂/司命 (per 協紀辨方書 卷十)
        assert SHENSHA_ROAD['青龍'] == '黃道'
        assert SHENSHA_ROAD['明堂'] == '黃道'
        assert SHENSHA_ROAD['金匱'] == '黃道'
        assert SHENSHA_ROAD['天德'] == '黃道'
        assert SHENSHA_ROAD['玉堂'] == '黃道'
        assert SHENSHA_ROAD['司命'] == '黃道'
        # 6 黑道
        assert SHENSHA_ROAD['天刑'] == '黑道'
        assert SHENSHA_ROAD['朱雀'] == '黑道'
        assert SHENSHA_ROAD['白虎'] == '黑道'
        assert SHENSHA_ROAD['天牢'] == '黑道'
        assert SHENSHA_ROAD['玄武'] == '黑道'
        assert SHENSHA_ROAD['勾陳'] == '黑道'


# ============================================================================
# 3. compute_auspicious_hours — 6 canonical rosters + property tests
# ============================================================================

# Per Phase A Sub-Agent B output (independently confirmed by Sub-Agent C).
# 6 distinct day-branch equivalence classes → 6 canonical rosters (sorted 子→亥).
CANONICAL_ROSTERS = {
    '子': ['子', '丑', '卯', '午', '申', '酉'],
    '午': ['子', '丑', '卯', '午', '申', '酉'],
    '丑': ['寅', '卯', '巳', '申', '戌', '亥'],
    '未': ['寅', '卯', '巳', '申', '戌', '亥'],
    '寅': ['子', '丑', '辰', '巳', '未', '戌'],
    '申': ['子', '丑', '辰', '巳', '未', '戌'],
    '卯': ['子', '寅', '卯', '午', '未', '酉'],
    '酉': ['子', '寅', '卯', '午', '未', '酉'],
    '辰': ['寅', '辰', '巳', '申', '酉', '亥'],
    '戌': ['寅', '辰', '巳', '申', '酉', '亥'],
    '巳': ['丑', '辰', '午', '未', '戌', '亥'],
    '亥': ['丑', '辰', '午', '未', '戌', '亥'],
}


class TestComputeAuspiciousHours:
    @pytest.mark.parametrize('day_branch,expected_hours', list(CANONICAL_ROSTERS.items()))
    def test_canonical_roster_per_day_branch(self, day_branch, expected_hours):
        rows = compute_auspicious_hours(day_branch=day_branch)
        actual_branches = [r['branch'] for r in rows]
        assert actual_branches == expected_hours

    @pytest.mark.parametrize('day_branch', list(CANONICAL_ROSTERS.keys()))
    def test_returns_exactly_6_yellow_hours(self, day_branch):
        rows = compute_auspicious_hours(day_branch=day_branch)
        assert len(rows) == 6

    @pytest.mark.parametrize('day_branch', list(CANONICAL_ROSTERS.keys()))
    def test_each_row_has_required_fields(self, day_branch):
        rows = compute_auspicious_hours(day_branch=day_branch)
        for r in rows:
            assert 'branch' in r
            assert 'hour_range' in r
            assert 'classical_name' in r
            assert 'provenance' in r
            assert r['provenance'] == 'classical'
            # hour_range matches HOUR_RANGES table
            assert r['hour_range'] == HOUR_RANGES[r['branch']]
            # classical_name is a 黃道 shen-sha
            assert r['classical_name'] in SHENSHA_ROAD
            assert SHENSHA_ROAD[r['classical_name']] == '黃道'

    def test_paired_branches_yield_identical_rosters(self):
        # 6 equivalence classes — paired branches must yield same result
        pairs = [('子', '午'), ('丑', '未'), ('寅', '申'),
                 ('卯', '酉'), ('辰', '戌'), ('巳', '亥')]
        for a, b in pairs:
            assert compute_auspicious_hours(day_branch=a) == compute_auspicious_hours(day_branch=b), \
                f"{a} and {b} should produce identical rosters (equivalence class)"

    def test_invalid_day_branch_raises(self):
        with pytest.raises(ValueError, match='invalid day_branch'):
            compute_auspicious_hours(day_branch='XX')


# ============================================================================
# 4. compute_folk_content — orchestrator
# ============================================================================

class TestComputeFolkContent:
    def test_full_payload_shape(self):
        out = compute_folk_content(useful_god_element='火', day_branch='未')
        assert set(out.keys()) == {
            'luckyColor', 'luckyNumber',
            'luckyFoodFavor', 'luckyFoodAvoid',
            'auspiciousHours',
        }

    def test_lucky_color_dispatch(self):
        out = compute_folk_content(useful_god_element='火', day_branch='未')
        assert out['luckyColor']['element'] == '火'
        assert out['luckyColor']['primary'] == '紅'
        assert out['luckyColor']['provenance'] == 'classical'
        assert '素問' in out['luckyColor']['cite']

    def test_lucky_number_dispatch(self):
        out = compute_folk_content(useful_god_element='木', day_branch='子')
        assert out['luckyNumber']['element'] == '木'
        assert out['luckyNumber']['numbers'] == [3, 8]
        assert out['luckyNumber']['provenance'] == 'folk_tradition'

    def test_lucky_food_favor_dispatch(self):
        out = compute_folk_content(useful_god_element='水', day_branch='巳')
        assert out['luckyFoodFavor']['element'] == '水'
        assert '黑' in out['luckyFoodFavor']['category'] or '鹹' in out['luckyFoodFavor']['category']
        assert out['luckyFoodFavor']['provenance'] == 'classical'

    def test_lucky_food_avoid_dispatch(self):
        out = compute_folk_content(useful_god_element='木', day_branch='寅')
        # 用神=木 → avoid 辛/金 (金剋木)
        assert '金剋木' in out['luckyFoodAvoid']['category']
        assert out['luckyFoodAvoid']['classification'] == 'doctrinal'
        assert out['luckyFoodAvoid']['avoid_strength'] == 'strong'
        assert len(out['luckyFoodAvoid']['cite_sources']) >= 3

    def test_auspicious_hours_per_day(self):
        out = compute_folk_content(useful_god_element='火', day_branch='未')
        assert len(out['auspiciousHours']) == 6
        assert all(h['provenance'] == 'classical' for h in out['auspiciousHours'])

    def test_unresolved_useful_god_omits_chart_fields_keeps_hours(self):
        # Edge case: empty useful_god_element (rare — unresolved 用神 chart)
        out = compute_folk_content(useful_god_element='', day_branch='申')
        assert out['luckyColor'] is None
        assert out['luckyNumber'] is None
        assert out['luckyFoodFavor'] is None
        assert out['luckyFoodAvoid'] is None
        # auspiciousHours still emits (day-branch independent of 用神)
        assert len(out['auspiciousHours']) == 6

    def test_unknown_useful_god_omits_chart_fields(self):
        out = compute_folk_content(useful_god_element='WAT', day_branch='申')
        assert out['luckyColor'] is None
        assert out['luckyNumber'] is None
        assert len(out['auspiciousHours']) == 6


# ============================================================================
# 5. Anti-DM-drift property test — chart-level fields invariant on day_branch
# ============================================================================

class TestChartLevelInvariance:
    """Per Sub-Agent C verdict: 吉色/吉數/吉食 are chart-level (用神-keyed) and
    do NOT depend on day_branch. Only auspiciousHours depend on day_branch.
    This property test proves no day_branch leakage into chart-level fields."""

    @pytest.mark.parametrize('element', ELEMENTS)
    def test_chart_fields_identical_across_all_day_branches(self, element):
        outputs = [
            compute_folk_content(useful_god_element=element, day_branch=db)
            for db in BRANCH_ORDER
        ]
        # All chart-level fields must be identical across day_branches
        for key in ('luckyColor', 'luckyNumber', 'luckyFoodFavor', 'luckyFoodAvoid'):
            for o in outputs[1:]:
                assert o[key] == outputs[0][key], \
                    f"{element}.{key} leaked day_branch dependency"

    @pytest.mark.parametrize('element', ELEMENTS)
    def test_auspicious_hours_only_varies_with_day_branch(self, element):
        # 6 unique rosters across 12 day-branches (paired)
        roster_set = set()
        for db in BRANCH_ORDER:
            out = compute_folk_content(useful_god_element=element, day_branch=db)
            roster_set.add(tuple(h['branch'] for h in out['auspiciousHours']))
        assert len(roster_set) == 6, \
            f"expected 6 unique rosters; got {len(roster_set)} for element {element}"


# ============================================================================
# 6. Roger 2026-05-23 calibration anchor
# ============================================================================

class TestRogerCalibrationAnchor:
    """Lock the engine output for Roger on 2026-05-23 so future engine changes
    that affect this chart trigger a deliberate update.

    Roger: 1987-09-06 16:11 吉打 Asia/Kuala_Lumpur male
    Pillars: 丁卯/戊申/戊午/庚申, DM=戊, 用神=火
    On 2026-05-23: day pillar is 丙申 (per cnlunar — verified upstream test).
    """

    def test_roger_lucky_color_red(self):
        # Roger 用神=火 → primary 紅, secondary 紫
        out = compute_folk_content(useful_god_element='火', day_branch='申')
        assert out['luckyColor']['primary'] == '紅'
        assert out['luckyColor']['secondary'] == '紫'

    def test_roger_lucky_number_2_7(self):
        out = compute_folk_content(useful_god_element='火', day_branch='申')
        assert out['luckyNumber']['numbers'] == [2, 7]

    def test_roger_lucky_food_favor_red_bitter(self):
        out = compute_folk_content(useful_god_element='火', day_branch='申')
        # 用神=火 → 紅色/苦味
        assert '紅' in out['luckyFoodFavor']['category'] or '苦' in out['luckyFoodFavor']['category']

    def test_roger_lucky_food_avoid_cold_salty(self):
        out = compute_folk_content(useful_god_element='火', day_branch='申')
        # 用神=火 → avoid 寒涼/鹹 (水剋火)
        assert '水剋火' in out['luckyFoodAvoid']['category']

    def test_roger_2026_05_23_申日_yellow_hours(self):
        # 申 day → same roster as 寅 day (equivalence class)
        out = compute_folk_content(useful_god_element='火', day_branch='申')
        hours = [h['branch'] for h in out['auspiciousHours']]
        assert hours == ['子', '丑', '辰', '巳', '未', '戌']
