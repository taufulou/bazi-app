"""Phase 12f invariant tests — V2 score floor + dominant enum completeness.

Phase 12f addresses PR #38 review issues E (V2 score can theoretically go
negative) and D+G (`_detect_dominant_imbalance` docstring missing
`'食神生財'` return value).
"""

import pytest

from app import interpretation_rules as ir
from app.interpretation_rules import calculate_strength_score_v2
from app.five_elements import _detect_dominant_imbalance


class TestV2ScoreFloor:
    """V2 score must never go below 0 per contract.

    Phase 12f Issue E + S3.1 fix: real exercise of the floor via
    monkeypatch (the natural-chart yao_pinwo only reaches V2=31.3, not
    negative — insufficient to verify the floor activates). Monkeypatch
    `_pattern_2b_surround_penalty` to return an extreme flat penalty,
    then verify the floor clamps total to 0.0 instead of negative.
    """

    def test_v2_score_floor_clamps_negative_to_zero(self, monkeypatch):
        """Force Pattern 2b to return an extreme penalty large enough to
        drive total negative. With floor in place, total = max(round(...),
        0.0) = 0.0 (not negative)."""
        # Patch Pattern 2b to return: (deling_cut=0, flat_penalty=80, fired=True)
        # On yao_pinwo: deling≈50, dedi≈small, deshi≈small, pattern_2a_boost=0
        # Without floor: total ≈ 50 + small + small + 0 - 80 = -X (negative)
        # With floor: total = max(<negative>, 0.0) = 0.0
        def _fake_pattern_2b(pillars, dm_stem, deling):
            return (0.0, 80.0, True)

        monkeypatch.setattr(
            ir, '_pattern_2b_surround_penalty', _fake_pattern_2b)

        pillars = {
            'year':  {'stem': '辛', 'branch': '丑'},
            'month': {'stem': '癸', 'branch': '巳'},
            'day':   {'stem': '丙', 'branch': '子'},
            'hour':  {'stem': '丁', 'branch': '酉'},
        }
        result = calculate_strength_score_v2(pillars, '丙')
        # Floor must clamp; without floor this would be negative
        assert result['score'] == 0.0, \
            f"V2 floor failed; got {result['score']}"
        # Classification must remain valid (very_weak threshold)
        assert result['classification'] == 'very_weak'

    def test_v2_score_does_not_clamp_positive_values(self):
        """Sanity check: floor must not mangle valid positive scores.
        Roger's V2=39.0 should remain 39.0 with the floor in place."""
        pillars = {
            'year':  {'stem': '丁', 'branch': '卯'},
            'month': {'stem': '戊', 'branch': '申'},
            'day':   {'stem': '戊', 'branch': '午'},
            'hour':  {'stem': '庚', 'branch': '申'},
        }
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['score'] == pytest.approx(39.0, abs=0.1)


class TestDominantEnumCompleteness:
    """Verify all documented dominant labels in
    `_detect_dominant_imbalance` are reachable. Phase 12f D+G fix
    added `'食神生財'` to the docstring; this test exercises that path."""

    def test_food_god_chain_label_returned(self):
        """`'食神生財'` is returnable per Phase 12d Pattern 1.
        qin_longtu (己卯 丁丑 丙寅 庚寅, DM=丙) fires the chain rule:
        - DM=丙 weak (V2=39.9)
        - 印星 weighted=4.4, 比劫 weighted=3.1 → 印 ≥ 比劫 → chain rule
        - cai 透干 (庚) + cai weighted ≥ 1.0 → chain eligible
        - returns '食神生財'"""
        pillars = {
            'year':  {'stem': '己', 'branch': '卯'},
            'month': {'stem': '丁', 'branch': '丑'},
            'day':   {'stem': '丙', 'branch': '寅'},
            'hour':  {'stem': '庚', 'branch': '寅'},
        }
        from app.ten_gods import get_ten_god_distribution
        from app import five_elements as fe

        v2 = calculate_strength_score_v2(pillars, '丙')
        tgd = get_ten_god_distribution(pillars, '丙')
        # Use the post-Phase-12f code default (flag is now ON)
        fe._USE_WEIGHTED_IMBALANCE = True
        dom = _detect_dominant_imbalance(
            tgd, v2['classification'], pillars=pillars,
            day_master_stem='丙', is_cong_ge=False)
        assert dom == '食神生財'
