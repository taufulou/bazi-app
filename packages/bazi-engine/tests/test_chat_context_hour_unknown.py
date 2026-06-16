"""
時辰未知 (unknown birth hour) — chat-context BUILD crash-safety + signal regression.

Locks the gap verified live during the PR #49 code-review follow-up: building the
slim chat context for an hour-unknown chart must NOT crash and MUST carry the
hourKnown=false signal so the NestJS chat-prompt builder can gate its suppression
directive (chat-prompt-builder.ts Phase-2d/3c).

The single-chart build merges all 4 enhanced-insights pipelines (lifetime/love/
career/annual), so this exercises the cross-cutting crash path. Compat carries a
per-party hourKnown inside chartA/chartB; fortune carries a top-level hourKnown.
"""
from __future__ import annotations

import pytest

from app.calculator import calculate_bazi_with_all_pipelines
from app.chat_context import (
    build_chat_context,
    build_chat_context_compat,
    build_chat_context_fortune,
)

ROGER = dict(birth_date='1987-09-06', birth_city='吉打',
             birth_timezone='Asia/Kuala_Lumpur', gender='male')
LAOPO = dict(birth_date='1987-01-25', birth_city='台北市',
             birth_timezone='Asia/Taipei', gender='female')


def _bd(base: dict, hour_known: bool) -> dict:
    """birth_data dict for the compat build (per-party hour_known)."""
    return {**base, 'hour_known': hour_known,
            'birth_time': '16:11' if hour_known else None}


# ── single-chart build (merges lifetime+love+career+annual) ──

@pytest.fixture(scope='module')
def roger_hu_chart():
    return calculate_bazi_with_all_pipelines(
        ROGER['birth_date'], None, ROGER['birth_city'], ROGER['birth_timezone'],
        ROGER['gender'], target_year=2026, hour_known=False)


def test_single_build_no_crash_and_signal(roger_hu_chart):
    ctx = build_chat_context(roger_hu_chart, 2026, 6)
    assert ctx is not None
    # top-level hourKnown signal drives the NestJS Phase-2d gate
    assert ctx['hourKnown'] is False
    # hour pillar blanked in the slim; year/month/day survive
    assert ctx['chart']['fourPillars']['hour']['stem'] == ''
    for p in ('year', 'month', 'day'):
        assert ctx['chart']['fourPillars'][p]['stem']
    # the merged pipelines are present (this is the cross-cutting crash path)
    for k in ('romance', 'career', 'relationships', 'annualForecast15'):
        assert k in ctx


def test_single_build_hour_known_signal():
    chart = calculate_bazi_with_all_pipelines(
        ROGER['birth_date'], '16:11', ROGER['birth_city'], ROGER['birth_timezone'],
        ROGER['gender'], target_year=2026, hour_known=True)
    ctx = build_chat_context(chart, 2026, 6)
    assert ctx['hourKnown'] is True
    assert ctx['chart']['fourPillars']['hour']['stem']  # hour present


# ── compat build (per-party hourKnown inside chartA/chartB) ──

@pytest.mark.parametrize('hk_a,hk_b,parties', [
    (True, False, ['B']),
    (False, True, ['A']),
    (False, False, ['A', 'B']),
])
def test_compat_build_no_crash_and_parties(hk_a, hk_b, parties):
    ctx = build_chat_context_compat(
        birth_data_a=_bd(ROGER, hk_a), birth_data_b=_bd(LAOPO, hk_b),
        comparison_type='ROMANCE', current_year=2026, current_month=6)
    assert ctx is not None
    assert ctx['chartA']['hourKnown'] is hk_a
    assert ctx['chartB']['hourKnown'] is hk_b
    assert ctx.get('partial') is True
    assert sorted(ctx.get('hourUnknownParties', [])) == sorted(parties)


def test_compat_build_both_known_not_partial():
    ctx = build_chat_context_compat(
        birth_data_a=_bd(ROGER, True), birth_data_b=_bd(LAOPO, True),
        comparison_type='ROMANCE', current_year=2026, current_month=6)
    assert ctx['chartA']['hourKnown'] is True
    assert ctx['chartB']['hourKnown'] is True
    assert not ctx.get('partial')


# ── fortune build (DAY / MONTH / YEAR) ──

@pytest.mark.parametrize('scope', ['DAY', 'MONTH', 'YEAR'])
def test_fortune_build_no_crash_hour_unknown(scope):
    ctx = build_chat_context_fortune(
        birth_data=dict(ROGER, birth_time=None), anchor_date='2026-06-16',
        current_year=2026, current_month=6, fortune_scope=scope, hour_known=False)
    assert ctx is not None
    assert ctx['hourKnown'] is False
    assert ctx['chart']['fourPillars']['hour']['stem'] == ''


def test_fortune_build_hour_known_signal():
    ctx = build_chat_context_fortune(
        birth_data=dict(ROGER, birth_time='16:11'), anchor_date='2026-06-16',
        current_year=2026, current_month=6, fortune_scope='DAY', hour_known=True)
    assert ctx['hourKnown'] is True
