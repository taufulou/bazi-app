"""Phase 12f Issue F — Pattern 3b breaker check rooted-stem semantics.

PR #38 review surfaced that `detect_true_transformed_stems`'s
condition (v) "no 克 element with strong root" used INDEPENDENT loops:
- Outer: find a stem of `breaker_el` anywhere in chart
- Inner: find ANY 本氣 branch matching `breaker_el` element anywhere

This was buggy in two directions (verified by bazi-master research at
`.claude/plans/phase_12f_issue_f_doctrine_verification.md`):

- Direction A — buggy says "block 真化" wrongly:
  Stem 丙 (yang fire) + chart has 午 (no 巳, no 寅, no 戌, no 未).
  Strict yin-yang says 丙 (陽火) does NOT root in 午 (本氣=丁陰火 only).
  Buggy logic linked them independently and blocked 真化.

- Direction B — buggy says "allow 真化" wrongly:
  Real chart `ziping_niu_jianbo` (庚寅 乙酉 癸亥 丙辰): 丙 IS rooted
  in 寅's 中氣 (寅 hidden = [甲, 丙, 戊]). Buggy code missed this
  because 寅's 本氣 is 甲, not 火 element.

Phase 12f fix: `stem in hidden[:2]` requires the SPECIFIC breaker stem
to be in 本氣 OR 中氣 of some branch (本氣+中氣 strict same-stem 通根).
Doctrine source: 滴天髓·假化 「克化神之神，或克者被制」.
"""

import pytest


class TestPattern3bBreakerStemRootedSemantics:
    """Phase 12f Issue F fix: breaker check requires breaker stem to
    have ITS OWN root (本氣 or 中氣), not arbitrary cross-pillar
    element match.

    Bazi-master verified per 滴天髓·假化 doctrine.
    """

    def test_direction_a_rootless_breaker_does_not_block(self):
        """Direction A regression: 庚辰 乙酉 戊午 丙子, DM=戊.
        乙庚 adjacent → 化金. 丙 (火, breaker for 化金) at hour stem.

        Fix uses `stem in hidden[:2]` (本氣 OR 中氣 strict yin-yang stem
        match). 丙 not in any branch's hidden[:2]:
          - 辰 hidden = [戊, 乙, 癸]; [:2] = [戊, 乙] — no 丙 ✓
          - 酉 hidden = [辛]; [:2] = [辛] — no 丙 ✓
          - 午 hidden = [丁, 己]; [:2] = [丁, 己] — no 丙 (under strict
            yin-yang, 午's 本氣 is 丁陰火, NOT 丙陽火) ✓
          - 子 hidden = [癸]; [:2] = [癸] — no 丙 ✓
        So 丙 IS rootless under strict same-stem 通根. Fix correctly
        allows 真化.

        Buggy independent-loop code WOULD have blocked 真化 (午 has 火
        本氣 element, matched independently of which pillar held 丙).

        All other gates verified to pass:
        - (i) 庚乙 adjacent (year-month) ✓
        - (ii) 月令=酉, 金 multiplier=1.5 (旺) ≥ 1.5 ✓
        - (iii) 化神 (金) root: 酉 本氣=辛=金 ✓
        - (iv) no 沖: 辰沖戌 (戌 not in chart), 酉沖卯 (卯 not in chart) ✓
        """
        pillars = {
            'year':  {'stem': '庚', 'branch': '辰'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '戊', 'branch': '午'},
            'hour':  {'stem': '丙', 'branch': '子'},
        }
        from app.stem_combinations import detect_true_transformed_stems
        result = detect_true_transformed_stems(pillars, '戊')
        # After fix: 真化 fires because 丙 is rootless
        assert ('year', '庚') in result
        assert ('month', '乙') in result

    def test_direction_b_ziping_niu_jianbo_blocks(self):
        """Direction B regression: ziping_niu_jianbo (庚寅 乙酉 癸亥 丙辰).
        乙庚 adjacent → 化金. 丙 (火, breaker for 化金) at hour stem.
        丙 IS rooted in 寅 中氣 (寅 hidden = [甲, 丙, 戊]).

        Buggy code missed this because 寅's 本氣 is 甲 (not 火 element)
        — its independent loop only checks 本氣. Fix correctly blocks
        真化 since 丙 is in 寅's hidden[:2] (中氣)."""
        pillars = {
            'year':  {'stem': '庚', 'branch': '寅'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '癸', 'branch': '亥'},
            'hour':  {'stem': '丙', 'branch': '辰'},
        }
        from app.stem_combinations import detect_true_transformed_stems
        result = detect_true_transformed_stems(pillars, '癸')
        # After fix: 真化 does NOT fire because 丙 IS rooted
        assert ('year', '庚') not in result
        assert ('month', '乙') not in result

    def test_ziping_niu_jianbo_check_cong_ge_unchanged(self):
        """Direction B regression follow-up: even after fix, the chart-level
        check_cong_ge result is unchanged because V2≥35 → early-return at
        check_cong_ge line 543. Verifies fix doesn't introduce visible
        regression on this corpus chart."""
        pillars = {
            'year':  {'stem': '庚', 'branch': '寅'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '癸', 'branch': '亥'},
            'hour':  {'stem': '丙', 'branch': '辰'},
        }
        from app.interpretation_rules import (
            calculate_strength_score_v2, check_cong_ge,
        )
        from app.five_elements import calculate_five_elements_balance
        v2 = calculate_strength_score_v2(pillars, '癸')
        balance = calculate_five_elements_balance(pillars)
        result = check_cong_ge(pillars, '癸', v2, balance)
        assert result is None
        assert v2['score'] >= 35.0  # V2 short-circuit confirmed

    def test_anchor_cong_cai_yiwuming_unchanged(self):
        """Verify the anchor chart still fires 真化. Both buggy and fixed
        agree because no 火 stem is rooted: 丙 (DM, 火) at day, but
        branches 申/酉/申/丑 contain no 丙 in 本氣 or 中氣."""
        pillars = {
            'year':  {'stem': '庚', 'branch': '申'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '丙', 'branch': '申'},
            'hour':  {'stem': '己', 'branch': '丑'},
        }
        from app.stem_combinations import detect_true_transformed_stems
        result = detect_true_transformed_stems(pillars, '丙')
        # 丙 rootless → breaker_strong=False → 真化 fires (both versions agree)
        assert ('year', '庚') in result
        assert ('month', '乙') in result

    def test_rooted_breaker_with_benqi_blocks(self):
        """If breaker stem 丁 IS rooted in 午 (本氣), 真化 still blocks.
        This is the trivial case the buggy code already handled correctly;
        verify fix preserves it."""
        pillars = {
            'year':  {'stem': '庚', 'branch': '申'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '丁', 'branch': '午'},  # 丁 rooted (午 本氣 = 丁)
            'hour':  {'stem': '壬', 'branch': '寅'},
        }
        from app.stem_combinations import detect_true_transformed_stems
        result = detect_true_transformed_stems(pillars, '丁')
        # 丁 rooted in 午 (本氣) → blocks 真化
        assert ('year', '庚') not in result
