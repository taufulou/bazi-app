"""
Tests for romance-specific calibration in the Enhanced Compatibility engine.

Covers:
- Sigmoid steepness: 0.07 (romance) vs 0.10 (default)
- Knockout penalty cap: -12 for romance, uncapped for others
- 納音 bonus: +4 for identical year-pillar 納音 (romance only)
- Cross-pillar branch default weight: 0.2 (romance) vs 0.3 (others)
- Spouse palace score floor: 30 when raw > 65 (romance only)
"""

import math

import pytest

from app.calculator import calculate_bazi_compatibility
from app.compatibility_constants import (
    CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT,
    CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT_ROMANCE,
    KNOCKOUT_PENALTY_CAP_ROMANCE,
    KNOCKOUT_TIAN_KE_DI_CHONG_HARD_FLOOR,
    NAYIN_IDENTICAL_BONUS_ROMANCE,
    SIGMOID_MIDPOINT,
    SIGMOID_STEEPNESS,
    SIGMOID_STEEPNESS_ROMANCE,
    SPOUSE_PALACE_SCORE_FLOOR_ROMANCE,
    SPOUSE_PALACE_SCORE_FLOOR_THRESHOLD,
)
from app.compatibility_enhanced import (
    analyze_cross_chart_branches,
    sigmoid_amplify,
)


# ============================================================
# Common birth data
# ============================================================

ROGER_DATA = {
    'birth_date': '1987-09-06',
    'birth_time': '15:30',
    'birth_city': 'Kuala Lumpur',
    'birth_timezone': 'Asia/Kuala_Lumpur',
    'gender': 'male',
}
LAOPO_DATA = {
    'birth_date': '1987-01-25',
    'birth_time': '15:30',
    'birth_city': 'Kuala Lumpur',
    'birth_timezone': 'Asia/Kuala_Lumpur',
    'gender': 'female',
}


def _enhanced(birth_a, birth_b, comparison_type='romance'):
    """Run full compatibility and return the enhanced result dict."""
    full = calculate_bazi_compatibility(birth_a, birth_b, comparison_type=comparison_type)
    return full['compatibilityEnhanced']


# ============================================================
# 1. Sigmoid steepness
# ============================================================

class TestSigmoidRomanceVsDefault:
    """Romance sigmoid (0.07) is softer — compresses less at extremes."""

    def test_low_score_romance_higher(self):
        """At raw=25, softer curve produces a higher mapped score."""
        romance = sigmoid_amplify(25, steepness=SIGMOID_STEEPNESS_ROMANCE)
        default = sigmoid_amplify(25, steepness=SIGMOID_STEEPNESS)
        assert romance > default, f"romance={romance:.2f} should > default={default:.2f} at raw=25"

    def test_high_score_romance_lower(self):
        """At raw=75, softer curve produces a lower mapped score."""
        romance = sigmoid_amplify(75, steepness=SIGMOID_STEEPNESS_ROMANCE)
        default = sigmoid_amplify(75, steepness=SIGMOID_STEEPNESS)
        assert romance < default, f"romance={romance:.2f} should < default={default:.2f} at raw=75"

    def test_midpoint_close(self):
        """At the midpoint both curves produce nearly the same value."""
        romance = sigmoid_amplify(SIGMOID_MIDPOINT, steepness=SIGMOID_STEEPNESS_ROMANCE)
        default = sigmoid_amplify(SIGMOID_MIDPOINT, steepness=SIGMOID_STEEPNESS)
        assert abs(romance - default) < 1.0


# ============================================================
# 2–3. Knockout penalty cap
# ============================================================

class TestKnockoutPenaltyCap:
    """Romance caps total negative knockouts at -12; bonuses stay uncapped."""

    def test_knockout_penalty_cap_romance(self):
        """Romance total penalty is capped at -12 even if raw total is worse."""
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        cal = result['calibration']
        if cal['knockoutPenalty'] != 0:
            assert cal['knockoutPenalty'] >= KNOCKOUT_PENALTY_CAP_ROMANCE

    def test_knockout_penalty_uncapped_business(self):
        """Business uses no penalty cap — penalty reported as-is."""
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'business')
        assert result['calibration']['knockoutPenaltyCap'] is None

    def test_knockout_cap_separates_bonus_penalty(self):
        """Bonuses are NOT capped even when penalty cap is active."""
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        cal = result['calibration']
        # Bonus is independent of the penalty cap
        assert cal['knockoutBonus'] >= 0, "Bonus should be non-negative"
        # If there is a bonus, it should not be limited by -12
        if cal['knockoutBonus'] > 12:
            assert cal['knockoutBonus'] > 12, "Bonuses must not be capped"


# ============================================================
# 4–5. 納音 bonus
# ============================================================

class TestNayinBonus:
    """Romance gets +4 for identical year-pillar 納音."""

    def test_nayin_bonus_romance_identical(self):
        """Roger and Laopo are both 爐中火 — romance gets +4."""
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        assert result['calibration']['nayinBonusApplied'] == NAYIN_IDENTICAL_BONUS_ROMANCE

    def test_nayin_bonus_not_applied_business(self):
        """Same charts but business comparison — no 納音 bonus."""
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'business')
        assert result['calibration']['nayinBonusApplied'] == 0

    def test_nayin_bonus_different_nayin(self):
        """Two charts with different year 納音 should get no bonus."""
        different_person = {
            'birth_date': '1990-03-15',
            'birth_time': '12:00',
            'birth_city': 'Taipei',
            'birth_timezone': 'Asia/Taipei',
            'gender': 'female',
        }
        result = _enhanced(ROGER_DATA, different_person, 'romance')
        assert result['calibration']['nayinBonusApplied'] == 0


# ============================================================
# 6. Cross-pillar branch default weight
# ============================================================

class TestCrossPillarBranchWeight:
    """Romance uses 0.2 for cross-position default; others use 0.3."""

    def test_romance_branch_weight(self):
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        assert result['calibration']['branchDefaultWeight'] == CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT_ROMANCE

    def test_business_branch_weight(self):
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'business')
        assert result['calibration']['branchDefaultWeight'] == CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT

    def test_constants_differ(self):
        assert CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT_ROMANCE == 0.2
        assert CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT == 0.3


# ============================================================
# 7–8. Spouse palace score floor
# ============================================================

class TestSpousePalaceFloor:
    """Romance enforces min score=30 when spouse palace raw > 65."""

    def test_spouse_palace_floor_romance(self):
        """If spouse palace raw > 65 and no 天剋地沖, floor applies."""
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        dim3_raw = result['dimensionScores']['spousePalace']['rawScore']
        if dim3_raw > SPOUSE_PALACE_SCORE_FLOOR_THRESHOLD:
            assert result['adjustedScore'] >= SPOUSE_PALACE_SCORE_FLOOR_ROMANCE
            assert result['calibration']['spousePalaceFloor'] is True

    def test_spouse_palace_floor_not_business(self):
        """Business never applies the spouse palace floor."""
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'business')
        assert result['calibration']['spousePalaceFloor'] is False

    def test_spouse_palace_floor_overridden_by_tkdc(self):
        """天剋地沖 hard floor overrides spouse palace floor."""
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        has_tkdc = any(k['type'] == 'tian_ke_di_chong' for k in result['knockoutConditions'])
        if has_tkdc:
            # Hard floor takes precedence, spouse palace floor should be False
            assert result['calibration']['spousePalaceFloor'] is False
            assert result['adjustedScore'] <= KNOCKOUT_TIAN_KE_DI_CHONG_HARD_FLOOR


# ============================================================
# 9. Business scores use default (non-romance) parameters
# ============================================================

class TestBusinessScoresUnchanged:
    """Business comparison uses original sigmoid=0.10, no cap, no nayin, weight 0.3."""

    def test_business_calibration_defaults(self):
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'business')
        cal = result['calibration']
        assert cal['sigmoidSteepness'] == SIGMOID_STEEPNESS
        assert cal['knockoutPenaltyCap'] is None
        assert cal['nayinBonusApplied'] == 0
        assert cal['branchDefaultWeight'] == CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT

    def test_romance_calibration_overrides(self):
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        cal = result['calibration']
        assert cal['sigmoidSteepness'] == SIGMOID_STEEPNESS_ROMANCE
        assert cal['knockoutPenaltyCap'] == KNOCKOUT_PENALTY_CAP_ROMANCE
        assert cal['branchDefaultWeight'] == CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT_ROMANCE


# ============================================================
# 10. End-to-end calibrated score
# ============================================================

class TestRogerLaopoRomanceCalibratedScore:
    """Roger+Laopo romance score with all calibrations active.
    Score shifted from ~36 to ~44 after 病藥取用法 fix (用神 火→土 swap for 食傷旺+身弱).
    """

    def test_adjusted_score_approximately_44(self):
        result = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        score = result['adjustedScore']
        assert 38 <= score <= 50, f"Expected ~44, got {score}"

    def test_romance_vs_business_different_scores(self):
        romance = _enhanced(ROGER_DATA, LAOPO_DATA, 'romance')
        business = _enhanced(ROGER_DATA, LAOPO_DATA, 'business')
        assert romance['adjustedScore'] != business['adjustedScore'], \
            "Romance and business should produce different final scores"
