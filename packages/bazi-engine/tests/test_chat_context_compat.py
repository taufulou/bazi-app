"""
Tests for `build_chat_context_compat` — the COMPATIBILITY chat slim layer.

H2 (Phase 3 follow-up): unit-test coverage for the compat-specific helpers
(`build_chat_context_compat`, `_slim_party_for_compat`, `_romance_for_compat_party`,
`_extract_cross_chart_findings`, `_slim_compat_dimensions`). Locks down the
following invariants against future engine refactors:

1. Token budget — char-approx tokens ≤ 22000 for the calibration anchor pair
2. LOVE-only doctrine filter — no `careerPatternType`/`isCongGe`/
   `patternClassification` leaks into per-party `doctrineFlags`
3. `crossChartFindings` reads from `dimensionScores['spousePalace']['findings']`
   (English camelCase), NOT `compat['specialFindings']` (which holds booleans
   not 三刑/半刑 findings) — locked via type filter
4. `verbalLabel` is engine's `compat['label']` verbatim (including
   SPECIAL_LABEL overrides 相愛相殺/前世冤家/命中注定 when triggered)
5. H1 — `timingSync` present with goldenYears/challengeYears/luckCycleSyncScore
6. H4 — per-party romance excludes IDEAL-spouse fields (spouseStarAnalysis,
   marriagePalace.appearance, narrativeAnchors.spouse_appearance)

Calibration anchor: Roger (1987-09-06 male) × Laopo (1987-01-25 female).
"""
from __future__ import annotations

import json
from typing import Dict

import pytest

from app.calculator import calculate_bazi_with_all_pipelines
from app.chat_context import (
    LOVE_DOCTRINE_FLAG_KEYS,
    _truncate_narrative_hint,
    build_chat_context_compat,
)


# ============================================================
# Calibration anchor pair (Roger × Laopo)
# ============================================================


@pytest.fixture(scope='module')
def roger_birth_data() -> Dict:
    return {
        'birth_date': '1987-09-06',
        'birth_time': '16:11',
        'birth_city': '吉打',
        'birth_timezone': 'Asia/Kuala_Lumpur',
        'gender': 'male',
    }


@pytest.fixture(scope='module')
def laopo_birth_data() -> Dict:
    return {
        'birth_date': '1987-01-25',
        'birth_time': '16:45',
        'birth_city': '柔佛',
        'birth_timezone': 'Asia/Kuala_Lumpur',
        'gender': 'female',
    }


@pytest.fixture(scope='module')
def compat_ctx(roger_birth_data, laopo_birth_data) -> Dict:
    """Build the compat slim chat context for Roger × Laopo at 2026-05."""
    return build_chat_context_compat(
        birth_data_a=roger_birth_data,
        birth_data_b=laopo_birth_data,
        comparison_type='ROMANCE',
        current_year=2026,
        current_month=5,
    )


# ============================================================
# Invariant 1 — Token budget
# ============================================================


class TestTokenBudget:
    """Lock the compat slim under a char-approx token ceiling. Uses the
    same `chars // 2 ≈ tokens` heuristic as the single-chart test
    (test_chat_context.py:239 → 18k cap). Compat is 2 charts merged plus
    compat-level scores/findings/timingSync so ceiling scales to 22k
    char-approx tokens (≈ 14-16k actual tokens). Plan target was ≤ 15k
    actual tokens; this cap leaves ~headroom for engine doctrine growth.

    Catches accidental field bloat (e.g. forgetting to filter, adding
    verbose narratives) before it ships to production where it'd inflate
    the Anthropic input-token bill.

    TODO: replace with actual `anthropic.count_tokens()` once SDK budget
    is available (same TODO as single-chart test at line 248)."""

    def test_compat_chat_context_under_token_cap(self, compat_ctx):
        serialized = json.dumps(compat_ctx, ensure_ascii=False)
        approx_tokens = len(serialized) // 2
        assert approx_tokens <= 22_000, (
            f'Compat chat context is ~{approx_tokens} char-approx tokens '
            f'(cap 22000 ≈ 14-16k actual tokens). '
            f'Top-level keys: {list(compat_ctx.keys())}'
        )
        # 8k floor — below this we've definitely dropped a load-bearing
        # field (e.g. accidentally filtering out chartA or chartB).
        assert approx_tokens >= 8_000, (
            f'Compat chat context only ~{approx_tokens} char-approx tokens '
            f'(floor 8000). Likely a required field was accidentally dropped.'
        )


# ============================================================
# Invariant 2 — LOVE-only doctrine filter (H4 ancillary)
# ============================================================


class TestDoctrineFlagsLoveOnlyFilter:
    """Lock the per-party `doctrineFlags` filter from `_slim_party_for_compat`.
    `build_chat_context` emits 7 doctrineFlag keys total (chat_context.py:678-715):
    4 LOVE (shangguanJianGuan, biJieDuoCai, guanShaHunZa, spousePalaceFrictions)
    + patternClassification + isCongGe (LIFETIME) + careerPatternType (CAREER).
    The compat slim must filter to LOVE keys only to avoid CAREER doctrine
    polluting the compat AI."""

    def test_chart_a_doctrine_flags_subset_love_keys(self, compat_ctx):
        flags = compat_ctx['chartA']['doctrineFlags']
        assert set(flags.keys()).issubset(LOVE_DOCTRINE_FLAG_KEYS), (
            f'chartA.doctrineFlags has non-LOVE keys: '
            f'{set(flags.keys()) - LOVE_DOCTRINE_FLAG_KEYS}'
        )

    def test_chart_b_doctrine_flags_subset_love_keys(self, compat_ctx):
        flags = compat_ctx['chartB']['doctrineFlags']
        assert set(flags.keys()).issubset(LOVE_DOCTRINE_FLAG_KEYS), (
            f'chartB.doctrineFlags has non-LOVE keys: '
            f'{set(flags.keys()) - LOVE_DOCTRINE_FLAG_KEYS}'
        )

    def test_no_career_doctrine_leak_either_party(self, compat_ctx):
        """Specifically assert NO careerPatternType / isCongGe /
        patternClassification leak — these are the LIFETIME/CAREER keys
        that the round-3 audit found in the unfiltered 7-key output."""
        for side in ('chartA', 'chartB'):
            flags = compat_ctx[side]['doctrineFlags']
            assert 'careerPatternType' not in flags, side
            assert 'isCongGe' not in flags, side
            assert 'patternClassification' not in flags, side


# ============================================================
# Invariant 3 — Cross-chart findings source
# ============================================================


class TestCrossChartFindings:
    """Lock `_extract_cross_chart_findings` against the round-3 HIGHEST audit
    that found 3 wrong-shape claims: (1) source dim key is English `spousePalace`
    not Chinese `配偶宮`, (2) finding `type` strings are Chinese (`'三刑'/'半刑'/
    '子卯刑'/'六沖'/'六害'`) not romanized, (3) `compat['specialFindings']` holds
    only booleans+metadata, NOT 三刑/半刑 finding objects."""

    def test_cross_chart_findings_is_list(self, compat_ctx):
        assert isinstance(compat_ctx['crossChartFindings'], list)

    def test_cross_chart_findings_only_doctrinal_types(self, compat_ctx):
        """Whatever findings ARE extracted, they must all be doctrinal
        types (三刑/半刑/子卯刑/六沖/六害). The filter must not accidentally
        let through `三合` or other positive findings."""
        ALLOWED_TYPES = {'三刑', '半刑', '子卯刑', '六沖', '六害'}
        for f in compat_ctx['crossChartFindings']:
            assert isinstance(f, dict)
            ftype = f.get('type')
            assert ftype in ALLOWED_TYPES, (
                f'Non-doctrinal type leaked into crossChartFindings: {ftype}. '
                f'Allowed: {ALLOWED_TYPES}'
            )

    def test_special_findings_not_mapped_to_cross_chart(self, compat_ctx):
        """`compat['specialFindings']` is a boolean+metadata dict (per
        compatibility_enhanced.py:1783) — must surface verbatim under its
        own key, NOT mistakenly mapped into `crossChartFindings`."""
        sf = compat_ctx['specialFindings']
        assert isinstance(sf, dict), f'specialFindings should be dict, got {type(sf)}'


# ============================================================
# Invariant 4 — verbalLabel verbatim from engine
# ============================================================


class TestVerbalLabelVerbatim:
    """Lock that `verbalLabel = compat['label']` literally — no parallel banding,
    no remapping. Engine is the source of truth for the 11 possible labels (8
    `COMPATIBILITY_LABELS` + 3 SPECIAL overrides 相愛相殺/前世冤家/命中注定)."""

    ALLOWED_LABELS = {
        # 8 base from compatibility_constants.COMPATIBILITY_LABELS
        '天作之合', '天生一對', '相得益彰', '互補雙星',
        '歡喜冤家', '需要磨合', '挑戰重重', '緣分較淺',
        # 3 SPECIAL overrides from compatibility_constants.py:311-313
        '相愛相殺', '前世冤家', '命中注定',
    }

    def test_verbal_label_is_known_value(self, compat_ctx):
        label = compat_ctx['verbalLabel']
        assert label in self.ALLOWED_LABELS, (
            f'verbalLabel "{label}" not in 11 allowed values. '
            f'Engine may have added new label without updating ALLOWED_LABELS.'
        )

    def test_adjusted_score_present(self, compat_ctx):
        """Pivot hint format is «合盤總分 NN分（X）» where NN is adjustedScore
        (NOT overallScore — per compatibility_enhanced.py:1751-1759 the label
        is derived from adjustedScore)."""
        assert isinstance(compat_ctx.get('adjustedScore'), (int, float))
        assert isinstance(compat_ctx.get('overallScore'), (int, float))


# ============================================================
# Invariant 5 — H1 timingSync
# ============================================================


class TestTimingSync:
    """H1 (Phase 3 follow-up) — lock `timingSync` propagation from
    compatibility_enhanced.py:1798-1801 into the compat slim. Without this,
    `wedding_timing` + `conflict_warning` sample-question answers have no
    structured engine backing → hallucination pressure."""

    def test_timing_sync_present(self, compat_ctx):
        assert 'timingSync' in compat_ctx, (
            'timingSync key missing from compat slim. Reading-page '
            'sample questions for wedding_timing + conflict_warning '
            'depend on this for grounding.'
        )

    def test_timing_sync_shape(self, compat_ctx):
        ts = compat_ctx['timingSync']
        assert isinstance(ts, dict)
        # All 3 sub-keys should exist (may be empty list/None when engine
        # found no matching years, but the keys themselves must be present)
        assert 'goldenYears' in ts
        assert 'challengeYears' in ts
        assert 'luckCycleSyncScore' in ts

    def test_timing_sync_year_entries_well_formed(self, compat_ctx):
        """Entry shape is {'year': int, 'reason': str} per
        compatibility_enhanced.py:1255-1258."""
        ts = compat_ctx['timingSync']
        for entry in ts.get('goldenYears', []):
            assert isinstance(entry, dict)
            assert 'year' in entry
            assert isinstance(entry['year'], int)
        for entry in ts.get('challengeYears', []):
            assert isinstance(entry, dict)
            assert 'year' in entry
            assert isinstance(entry['year'], int)


# ============================================================
# Invariant 6 — H4 ideal-spouse fields excluded from per-party romance
# ============================================================


class TestRomanceExcludesIdealSpouseFields:
    """H4 (Phase 3 follow-up) — lock the defensive strip in
    `_romance_for_compat_party`. These fields all describe the party's
    IDEAL spouse (= the OTHER party in compat context) — leaving them
    in creates a confusing-self-reference trap when AI answers «her
    appearance» using B's chart but pulls the ideal-spouse-of-B fields
    (which describe user A!)."""

    def test_chart_a_romance_no_spouse_star_analysis(self, compat_ctx):
        assert 'spouseStarAnalysis' not in compat_ctx['chartA']['romance']

    def test_chart_b_romance_no_spouse_star_analysis(self, compat_ctx):
        assert 'spouseStarAnalysis' not in compat_ctx['chartB']['romance']

    def test_chart_a_marriage_palace_no_ideal_spouse_fields(self, compat_ctx):
        palace = compat_ctx['chartA']['romance'].get('spousePalace', {})
        FORBIDDEN = {
            'appearance', 'appearanceHint', 'appearanceGrade',
            'appearanceNote', 'personalityArchetype', 'personality',
        }
        leaked = FORBIDDEN & set(palace.keys())
        assert not leaked, f'chartA.spousePalace leaks ideal-spouse keys: {leaked}'

    def test_chart_b_marriage_palace_no_ideal_spouse_fields(self, compat_ctx):
        palace = compat_ctx['chartB']['romance'].get('spousePalace', {})
        FORBIDDEN = {
            'appearance', 'appearanceHint', 'appearanceGrade',
            'appearanceNote', 'personalityArchetype', 'personality',
        }
        leaked = FORBIDDEN & set(palace.keys())
        assert not leaked, f'chartB.spousePalace leaks ideal-spouse keys: {leaked}'

    def test_chart_a_narrative_anchors_no_spouse_appearance(self, compat_ctx):
        anchors = compat_ctx['chartA'].get('narrativeAnchors')
        if isinstance(anchors, dict):
            assert 'spouse_appearance' not in anchors

    def test_chart_b_narrative_anchors_no_spouse_appearance(self, compat_ctx):
        anchors = compat_ctx['chartB'].get('narrativeAnchors')
        if isinstance(anchors, dict):
            assert 'spouse_appearance' not in anchors


# ============================================================
# Invariant 7 — H5 anti-hallucination anchors restored
# ============================================================


class TestAntiHallucinationAnchorsPresent:
    """H5 (Phase 3 follow-up) — lock that per-party slim includes 4 of the 5
    anti-hallucination anchor fields (patternNarrative, narrativeAnchors,
    touganAnalysis, tenGodPositionAnalysis). `call2NarrativeAnchors` is
    excluded per fallback-ladder step 1 (token budget — single-chart slim
    has it, compat slim omits it). Without these anchors the AI can
    hallucinate 透干 vs 藏干 distinctions, 格局 classifications, 六親
    chains."""

    # H5 fallback-ladder step 1 — call2NarrativeAnchors NOT restored.
    # See _slim_party_for_compat docstring in chat_context.py.
    REQUIRED_ANCHOR_KEYS = (
        'patternNarrative',
        'narrativeAnchors',
        'touganAnalysis',
        'tenGodPositionAnalysis',
    )

    def test_chart_a_has_all_anchors(self, compat_ctx):
        for key in self.REQUIRED_ANCHOR_KEYS:
            assert key in compat_ctx['chartA'], (
                f'chartA missing anchor field: {key}'
            )

    def test_chart_b_has_all_anchors(self, compat_ctx):
        for key in self.REQUIRED_ANCHOR_KEYS:
            assert key in compat_ctx['chartB'], (
                f'chartB missing anchor field: {key}'
            )


# ============================================================
# Invariant 8 — L1 narrativeHint truncation (string-only)
# ============================================================


class TestNarrativeHintTruncation:
    """L1 (Phase 3 follow-up) — verify `_truncate_narrative_hint` caps
    string narrativeHints at 150 chars while leaving non-string fields
    (severity int, finding type str, etc.) untouched. Token-budget polish."""

    def test_long_string_narrative_hint_truncated_with_ellipsis(self):
        long_hint = '丑戌半刑' * 50  # 200 chars
        finding = {'type': '半刑', 'severity': 60, 'narrativeHint': long_hint}
        result = _truncate_narrative_hint(finding)
        assert len(result['narrativeHint']) == 150
        assert result['narrativeHint'].endswith('...')

    def test_short_string_narrative_hint_untouched(self):
        short = '配偶宮丑戌半刑'
        finding = {'type': '半刑', 'narrativeHint': short}
        result = _truncate_narrative_hint(finding)
        assert result['narrativeHint'] == short

    def test_non_string_fields_in_finding_untouched(self):
        """severity (int) + type (str non-narrativeHint) must NOT be truncated.
        Only the `narrativeHint` key is targeted, and only when it's a string."""
        finding = {
            'type': '半刑',
            'severity': 60,  # int
            'related_branches': ['丑', '戌'],  # list
            'meta': {'pillar': 'month'},  # dict
            'narrativeHint': 'x' * 200,
        }
        result = _truncate_narrative_hint(finding)
        assert result['severity'] == 60
        assert result['related_branches'] == ['丑', '戌']
        assert result['meta'] == {'pillar': 'month'}
        assert len(result['narrativeHint']) == 150

    def test_missing_narrative_hint_returns_finding_unchanged(self):
        finding = {'type': '六沖', 'severity': 70}
        result = _truncate_narrative_hint(finding)
        assert result == finding

    def test_non_string_narrative_hint_returns_unchanged(self):
        """Defensive — if a finding accidentally has narrativeHint as a
        non-string (e.g. None, or a list), the helper leaves it as-is."""
        finding = {'type': '六沖', 'narrativeHint': None}
        result = _truncate_narrative_hint(finding)
        assert result['narrativeHint'] is None

        finding_list = {'type': '六沖', 'narrativeHint': ['a', 'b']}
        result_list = _truncate_narrative_hint(finding_list)
        assert result_list['narrativeHint'] == ['a', 'b']
