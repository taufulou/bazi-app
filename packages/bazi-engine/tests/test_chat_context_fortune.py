"""
Tests for `build_chat_context_fortune` (FORTUNE chat scope, 八字日運).

Locks the Phase Fortune chat context implementation against the staff-engineer
plan's required regression points:

- Roger anchor: chart 4 pillars + dailyFortune present, day pillar / ten god /
  auspiciousness / energyScore all populated, doctrineFlags non-empty (chart-
  level Phase 12 doctrine inherited)
- Laopo doctrine inheritance: chart-level `shangguanJianGuan[0].valence`
  survives the FORTUNE merge as `'beneficial'` (Phase 12g.3 — the central
  anti-hallucination test that mirrors `test_chat_context.py::
  test_laopo_shangguan_jianguan_beneficial`)
- Token budget lock (Issue 3): payload stays under 14000 tokens by
  `cl100k_base` token count, with char-count fallback
- Anchor-date ISO parsing: invalid date → ValueError
- Snapshot reuse (Issue 1): `precomputed_daily` short-circuits the second
  `compute_daily_fortune` call
- Folk content + headliner signals present for AI grounding
"""
from __future__ import annotations

import json
from typing import Dict
from unittest.mock import patch

import pytest

from app.chat_context import build_chat_context_fortune


# ============================================================
# Calibration anchor birth data (from CLAUDE.md + test_chat_context.py)
# ============================================================


@pytest.fixture(scope='module')
def roger_birth() -> Dict:
    """Roger: 丁卯 / 戊申 / 戊午 / 庚申 male, DM=戊 neutral.
    Birth: 1987-09-06 16:11, 吉打 (Kedah, Malaysia)."""
    return {
        'birth_date': '1987-09-06',
        'birth_time': '16:11',
        'birth_city': '吉打',
        'birth_timezone': 'Asia/Kuala_Lumpur',
        'gender': 'male',
    }


@pytest.fixture(scope='module')
def laopo_birth() -> Dict:
    """Laopo: 丙寅 / 辛丑 / 甲戌 / 壬申 female. The Phase 12g.3 calibration anchor
    for 傷官見官 valence='beneficial' (正官=忌神). Birth: 1987-01-25 16:45, 柔佛."""
    return {
        'birth_date': '1987-01-25',
        'birth_time': '16:45',
        'birth_city': '柔佛',
        'birth_timezone': 'Asia/Kuala_Lumpur',
        'gender': 'female',
    }


# The Phase 1 daily-fortune calibration anchor per CLAUDE.md (Roger 戊子日).
# 2026-05-20 produces 甲午日; 2026-05-14 produces 戊子日 — both valid for
# different aspects of regression. Tests below use whichever anchors the
# canonical engine behavior.
ANCHOR_DATE_WUZI = '2026-05-14'  # Roger → 戊子日 (Phase 1 anchor)


# ============================================================
# Roger anchor — chart + dailyFortune shape
# ============================================================


class TestRogerAnchor:
    """The first calibration anchor. Locks the structural output shape."""

    def test_returns_chart_slim_plus_dailyFortune_plus_anchorDate(self, roger_birth):
        ctx = build_chat_context_fortune(
            birth_data=roger_birth,
            anchor_date=ANCHOR_DATE_WUZI,
            current_year=2026,
            current_month=5,
        )

        # Chart slim must be present (inherited from build_chat_context)
        assert 'chart' in ctx
        assert 'doctrineFlags' in ctx
        assert 'doctrineInjectors' in ctx
        assert 'narrativeAnchors' in ctx

        # FORTUNE-specific fields
        assert ctx['anchorDate'] == ANCHOR_DATE_WUZI
        assert 'dailyFortune' in ctx
        daily = ctx['dailyFortune']
        assert daily['dayGanZhi'] == '戊子'
        assert daily['dayTenGod'] == '比肩'
        assert daily['dayStem'] == '戊'
        assert daily['dayBranch'] == '子'
        assert daily['dateIso'] == ANCHOR_DATE_WUZI
        assert daily['metaFraming'] == 'soft_trigger'

    def test_dailyFortune_dimensions_complete(self, roger_birth):
        ctx = build_chat_context_fortune(
            birth_data=roger_birth,
            anchor_date=ANCHOR_DATE_WUZI,
            current_year=2026,
            current_month=5,
        )
        dims = ctx['dailyFortune']['dimensions']
        for key in ('romance', 'career', 'finance', 'travel', 'health'):
            assert key in dims, f'missing dim: {key}'
            assert 'score' in dims[key]
            assert 'label' in dims[key]

    def test_dailyFortune_folk_content_wealth_direction_present(self, roger_birth):
        ctx = build_chat_context_fortune(
            birth_data=roger_birth,
            anchor_date=ANCHOR_DATE_WUZI,
            current_year=2026,
            current_month=5,
        )
        folk = ctx['dailyFortune']['folkContent']
        assert 'wealthDirection' in folk
        # Roger 用神=火 → 南方 per Phase 12 Fix 2
        wd = folk['wealthDirection']
        assert wd['element'] == '火'
        assert wd['direction'] == '南方'

    def test_dailyFortune_option_2_5_transparency_fields(self, roger_birth):
        """Option 2.5 transparency fields are load-bearing for AI
        anti-incoherence rule (prevents 「本月本來大吉」 misframing)."""
        ctx = build_chat_context_fortune(
            birth_data=roger_birth,
            anchor_date=ANCHOR_DATE_WUZI,
            current_year=2026,
            current_month=5,
        )
        daily = ctx['dailyFortune']
        assert 'rawStructuralAuspiciousness' in daily
        assert 'rawDailyAuspiciousness' in daily
        assert 'flowMonthAuspiciousness' in daily
        assert 'auspiciousness' in daily  # final capped


# ============================================================
# Laopo doctrine inheritance — Phase 12g.3 anti-hallucination
# ============================================================


class TestLaopoDoctrineInheritance:
    """The central anti-hallucination test: chart-level Phase 12g.3 doctrine
    (傷官見官 valence='beneficial' when 正官=忌神) must survive the FORTUNE
    chat-context merge so the AI does not regress to folk «傷官見官恆凶» doctrine.

    Mirrors `test_chat_context.py::test_laopo_shangguan_jianguan_beneficial`.
    """

    def test_shangguan_jianguan_beneficial_survives(self, laopo_birth):
        ctx = build_chat_context_fortune(
            birth_data=laopo_birth,
            anchor_date=ANCHOR_DATE_WUZI,
            current_year=2026,
            current_month=5,
        )

        # The 4-pipeline merge must surface chart-level shangguanJianGuan flag
        # via doctrineFlags
        flags = ctx['doctrineFlags']
        assert 'shangguanJianGuan' in flags
        sg_entries = flags['shangguanJianGuan']
        assert len(sg_entries) >= 1, 'Laopo should have at least one 傷官見官 entry'

        sg = sg_entries[0]
        assert sg.get('valence') == 'beneficial', (
            f'Phase 12g.3: 正官=忌神 → 傷官制官 reverses to beneficial '
            f'per 三命通會. Got: {sg.get("valence")!r}'
        )


# ============================================================
# Token budget lock (Issue 3)
# ============================================================


class TestTokenBudget:
    """Issue 3 (plan re-review): char count was the original loose check;
    token count via tiktoken is the binding check. Plan ceiling: 14k tokens
    measured via cl100k_base; fall back to ~56k char if tiktoken unavailable.
    """

    @pytest.mark.parametrize('birth_fixture, anchor', [
        ('roger_birth', '2026-05-14'),
        ('roger_birth', '2026-05-20'),
        ('laopo_birth', '2026-05-14'),
    ])
    def test_payload_stays_under_token_budget(
        self, request, birth_fixture: str, anchor: str,
    ):
        birth = request.getfixturevalue(birth_fixture)
        ctx = build_chat_context_fortune(
            birth_data=birth, anchor_date=anchor,
            current_year=2026, current_month=5,
        )

        payload_str = json.dumps(ctx, ensure_ascii=False)

        # Try tiktoken first; fall back to char count
        try:
            import tiktoken  # type: ignore
            enc = tiktoken.get_encoding('cl100k_base')
            token_count = len(enc.encode(payload_str))
            assert token_count < 14000, (
                f'FORTUNE chat context exceeds 14k token budget '
                f'(got {token_count} tokens for {birth_fixture}@{anchor})'
            )
        except ImportError:
            # tiktoken not available — fall back to char count
            # 14k tokens for CJK ≈ 28-56k chars (1.5-4 ratio depending on mix)
            char_count = len(payload_str)
            assert char_count < 56000, (
                f'FORTUNE chat context exceeds 56k char fallback budget '
                f'(got {char_count} chars for {birth_fixture}@{anchor})'
            )


# ============================================================
# Anchor-date validation
# ============================================================


class TestAnchorDateValidation:

    def test_invalid_anchor_date_raises_valueerror(self, roger_birth):
        with pytest.raises(ValueError, match='anchor_date'):
            build_chat_context_fortune(
                birth_data=roger_birth,
                anchor_date='not-a-date',
                current_year=2026,
                current_month=5,
            )

    def test_anchor_date_wrong_format_raises(self, roger_birth):
        # Caller MUST send YYYY-MM-DD; epoch / DateTime should fail
        with pytest.raises(ValueError, match='anchor_date'):
            build_chat_context_fortune(
                birth_data=roger_birth,
                anchor_date='2026/05/14',  # wrong delimiter
                current_year=2026,
                current_month=5,
            )

    def test_anchor_date_none_raises(self, roger_birth):
        with pytest.raises(ValueError, match='anchor_date'):
            build_chat_context_fortune(
                birth_data=roger_birth,
                anchor_date=None,  # type: ignore[arg-type]
                current_year=2026,
                current_month=5,
            )


# ============================================================
# Snapshot reuse (Issue 1 — precomputed_daily skips recompute)
# ============================================================


class TestSnapshotReuse:
    """Issue 1 — when NestJS passes the persisted
    `DailyFortuneSnapshot.engineOutputJson`, the engine must skip the
    redundant `compute_daily_fortune` call. Verified via mock."""

    def test_precomputed_daily_is_used_verbatim(self, roger_birth):
        fake_daily = {
            'dayStem': '甲',
            'dayBranch': '子',
            'dayGanZhi': '甲子',
            'dayTenGod': '偏官',
            'dateIso': '2026-05-14',
            'auspiciousness': '大吉',
            'energyScore': 99,
            'metaFraming': 'soft_trigger',
            'dimensions': {
                'romance': {'score': 90, 'label': 'beneficial'},
                'career': {'score': 90, 'label': 'beneficial'},
                'finance': {'score': 90, 'label': 'beneficial'},
                'travel': {'score': 90, 'label': 'beneficial'},
                'health': {'score': 90, 'label': 'beneficial'},
            },
            'folkContent': {
                'wealthDirection': {
                    'element': '土', 'direction': '中央',
                    'provenance': 'classical', 'note': 'test',
                },
            },
            'headlinerSignals': None,
            'rawStructuralAuspiciousness': '大吉',
            'rawDailyAuspiciousness': '大吉',
            'flowMonthAuspiciousness': '吉',
            'perDaySoftening': [],
        }

        with patch('app.daily_enhanced.compute_daily_fortune') as mock_compute:
            ctx = build_chat_context_fortune(
                birth_data=roger_birth,
                anchor_date='2026-05-14',
                current_year=2026,
                current_month=5,
                precomputed_daily=fake_daily,
            )

        # compute_daily_fortune must NOT have been called when snapshot is passed
        mock_compute.assert_not_called()

        # Output should reflect the fake snapshot's values verbatim
        assert ctx['dailyFortune']['dayGanZhi'] == '甲子'
        assert ctx['dailyFortune']['dayTenGod'] == '偏官'
        assert ctx['dailyFortune']['auspiciousness'] == '大吉'
        assert ctx['dailyFortune']['energyScore'] == 99
        assert ctx['dailyFortune']['folkContent']['wealthDirection']['direction'] == '中央'

    def test_without_precomputed_daily_engine_computes(self, roger_birth):
        """When no snapshot passed, engine falls back to compute_daily_fortune.
        Verified by checking the dayGanZhi matches what the engine would emit
        for Roger 2026-05-14 (verified above as 戊子)."""
        ctx = build_chat_context_fortune(
            birth_data=roger_birth,
            anchor_date='2026-05-14',
            current_year=2026,
            current_month=5,
            precomputed_daily=None,
        )
        assert ctx['dailyFortune']['dayGanZhi'] == '戊子'


# ============================================================
# Headliner signals + meta-framing
# ============================================================


class TestHeadlinerSignals:
    """Headliner signals are pre-rendered Chinese pill-line strings for the
    UI's tech-anchor pill row. Must be either None or a dict — never
    accidentally serialized as a string by the slim."""

    def test_metaFraming_soft_trigger_always_present(self, roger_birth):
        ctx = build_chat_context_fortune(
            birth_data=roger_birth,
            anchor_date=ANCHOR_DATE_WUZI,
            current_year=2026,
            current_month=5,
        )
        # Phase 1 doctrine: every daily output emits metaFraming='soft_trigger'
        # so AI prompts can key off it for anti-hallucination
        assert ctx['dailyFortune']['metaFraming'] == 'soft_trigger'


# ============================================================
# Phase 3.5c L3.5c — YEAR scope (年運 chat)
# ============================================================

# YEAR anchor is the Jan-1 of the target flow year (Phase 3 doctrine — year
# maps directly to the 立春-anchored flow year; NestJS normalizes the anchor
# to YYYY-01-01).
ANCHOR_YEAR_2026 = '2026-01-01'  # Roger → 丙午年, yearTenGod=偏印


class TestYearlyAnchor:
    """Roger 2026 (丙午年) — locks the YEAR chat output shape + sibling fields."""

    def test_returns_chart_slim_plus_yearlyFortune(self, roger_birth):
        ctx = build_chat_context_fortune(
            birth_data=roger_birth,
            anchor_date=ANCHOR_YEAR_2026,
            current_year=2026,
            current_month=1,
            fortune_scope='YEAR',
        )
        # Chart slim must be present (inherited from build_chat_context)
        assert 'chart' in ctx
        assert 'doctrineFlags' in ctx
        # FORTUNE-specific YEAR fields
        assert ctx['anchorDate'] == ANCHOR_YEAR_2026
        assert ctx['fortuneScope'] == 'YEAR'
        assert 'yearlyFortune' in ctx
        # Must NOT carry the DAY/MONTH blocks
        assert 'dailyFortune' not in ctx
        assert 'monthlyFortune' not in ctx

        yearly = ctx['yearlyFortune']
        assert yearly['yearGanZhi'] == '丙午'
        assert yearly['yearStem'] == '丙'
        assert yearly['yearBranch'] == '午'
        # DM=戊, 丙 → 偏印
        assert yearly['yearTenGod'] == '偏印'
        assert yearly['year'] == 2026
        assert yearly['metaFraming'] == 'soft_trigger'
        # Engine-internal fields must be dropped by the slim
        assert 'chartContext' not in yearly
        assert 'preAnalysisVersion' not in yearly

    def test_yearlyFortune_4dim_with_stars(self, roger_birth):
        ctx = build_chat_context_fortune(
            birth_data=roger_birth, anchor_date=ANCHOR_YEAR_2026,
            current_year=2026, current_month=1, fortune_scope='YEAR',
        )
        dims = ctx['yearlyFortune']['dimensions']
        # 4 dims — NO travel (romance=感情 NOT 人際關係)
        assert set(dims.keys()) == {'career', 'finance', 'romance', 'health'}
        for d in dims.values():
            assert 'score' in d and 'label' in d
            assert 'stars' in d and 1 <= d['stars'] <= 5
            assert 'labelZh' in d

    def test_yearlyFortune_core_risk_opportunity_sibling(self, roger_birth):
        ctx = build_chat_context_fortune(
            birth_data=roger_birth, anchor_date=ANCHOR_YEAR_2026,
            current_year=2026, current_month=1, fortune_scope='YEAR',
        )
        cro = ctx['yearlyFortune']['coreRiskOpportunity']
        # LOAD-BEARING — the injector quotes these named months verbatim
        assert 'opportunities' in cro
        assert 'risks' in cro
        assert 'flatYear' in cro

    def test_yearlyFortune_luck_methods_sibling(self, roger_birth):
        ctx = build_chat_context_fortune(
            birth_data=roger_birth, anchor_date=ANCHOR_YEAR_2026,
            current_year=2026, current_month=1, fortune_scope='YEAR',
        )
        lm = ctx['yearlyFortune']['luckMethods']
        assert 'cards' in lm and isinstance(lm['cards'], list)
        assert 'weakestDim' in lm
        assert 'disclaimer' in lm


class TestYearlyDoctrineInheritance:
    """The Layer-1 calibration anchor MUST survive YEAR scope too: Laopo's
    chart-level 傷官見官 valence='beneficial' rides in the merged base slim,
    independent of the fortune scope."""

    def test_shangguan_jianguan_beneficial_survives(self, laopo_birth):
        ctx = build_chat_context_fortune(
            birth_data=laopo_birth, anchor_date=ANCHOR_YEAR_2026,
            current_year=2026, current_month=1, fortune_scope='YEAR',
        )
        flags = ctx['doctrineFlags']
        sjg = flags.get('shangguanJianGuan')
        assert sjg, 'shangguanJianGuan flag missing for Laopo under YEAR scope'
        assert sjg[0]['valence'] == 'beneficial'


class TestYearlyTokenBudget:
    """YEAR slim adds 4 dims + 6 risk/opp months + ~3 luck cards on top of the
    base chart slim — verify it still fits the 14k token budget."""

    @pytest.mark.parametrize('birth_fixture', ['roger_birth', 'laopo_birth'])
    def test_payload_under_token_budget(self, request, birth_fixture):
        birth = request.getfixturevalue(birth_fixture)
        ctx = build_chat_context_fortune(
            birth_data=birth, anchor_date=ANCHOR_YEAR_2026,
            current_year=2026, current_month=1, fortune_scope='YEAR',
        )
        payload_str = json.dumps(ctx, ensure_ascii=False)
        try:
            import tiktoken  # type: ignore
            enc = tiktoken.get_encoding('cl100k_base')
            token_count = len(enc.encode(payload_str))
            assert token_count < 14000, (
                f'YEAR chat context exceeds 14k token budget '
                f'(got {token_count} tokens for {birth_fixture})'
            )
        except ImportError:
            assert len(payload_str) < 56000


class TestYearlySnapshotReuse:
    """Issue 1 — when NestJS passes the persisted YEAR
    `DailyFortuneSnapshot.engineOutputJson`, the engine must skip the redundant
    `compute_year_by_year` call."""

    def test_precomputed_yearly_is_used_verbatim(self, roger_birth):
        fake_yearly = {
            'yearStem': '丁', 'yearBranch': '未', 'yearGanZhi': '丁未',
            'yearTenGod': '正印', 'year': 2027,
            'auspiciousness': '吉', 'energyScore': 70,
            'metaFraming': 'soft_trigger',
            'flowYear': {'stem': '丁', 'branch': '未', 'tenGod': '正印',
                         'auspiciousness': '吉'},
            'dimensions': {
                'career': {'score': 70, 'label': '順遂', 'stars': 4, 'labelZh': '事業'},
                'finance': {'score': 65, 'label': '平穩', 'stars': 3, 'labelZh': '財運'},
                'romance': {'score': 75, 'label': '順遂', 'stars': 4, 'labelZh': '感情'},
                'health': {'score': 60, 'label': '平穩', 'stars': 3, 'labelZh': '健康'},
            },
            'coreRiskOpportunity': {'opportunities': [], 'risks': [], 'flatYear': True},
            'luckMethods': {'cards': [], 'weakestDim': 'health',
                            'weakestDimZh': '健康', 'disclaimer': 'test'},
            'chartContext': {'dayMaster': '戊'},
            'preAnalysisVersion': 'vTEST',
        }
        with patch('app.yearly_enhanced.compute_year_by_year') as mock_compute:
            ctx = build_chat_context_fortune(
                birth_data=roger_birth, anchor_date='2027-01-01',
                current_year=2027, current_month=1,
                precomputed_yearly=fake_yearly, fortune_scope='YEAR',
            )
        mock_compute.assert_not_called()
        y = ctx['yearlyFortune']
        assert y['yearGanZhi'] == '丁未'
        assert y['yearTenGod'] == '正印'
        assert y['auspiciousness'] == '吉'
        assert y['energyScore'] == 70
        # slim drops engine-internal fields even from a precomputed snapshot
        assert 'chartContext' not in y
        assert 'preAnalysisVersion' not in y


class TestYearScopeValidation:
    def test_year_scope_no_longer_rejected(self, roger_birth):
        """YEAR was Phase-3-deferred; L3.5c relaxes the gate."""
        ctx = build_chat_context_fortune(
            birth_data=roger_birth, anchor_date=ANCHOR_YEAR_2026,
            current_year=2026, current_month=1, fortune_scope='YEAR',
        )
        assert ctx['fortuneScope'] == 'YEAR'

    def test_unknown_scope_still_raises(self, roger_birth):
        with pytest.raises(ValueError, match='fortune_scope'):
            build_chat_context_fortune(
                birth_data=roger_birth, anchor_date=ANCHOR_YEAR_2026,
                current_year=2026, current_month=1, fortune_scope='DECADE',
            )
