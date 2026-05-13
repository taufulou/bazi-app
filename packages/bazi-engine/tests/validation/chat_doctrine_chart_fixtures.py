"""
Chart fixtures for the chat doctrine eval corpus.

Maps `chart_id` (referenced in chat_doctrine_eval.csv) to the birth params
needed to call `calculate_bazi_with_all_pipelines()`.

Per Phase 1.5 plan: ~30 charts hand-labeled. This file ships with the
canonical anchors (laopo, roger) plus synthetic fixtures for each Phase
12 doctrine flag the eval corpus needs to exercise.

Charts marked with `synthetic_pillars=True` are constructed via direct
pillar substitution (used for charts where finding a real birth date that
produces the exact desired ten-god configuration is infeasible). The
runner uses these in test-only mode to bypass calculate_bazi.
"""
from __future__ import annotations

from typing import Dict, Optional, TypedDict


class ChartFixture(TypedDict, total=False):
    """Birth params for a chart_id. Either real birth params OR synthetic
    pillar override (for doctrine-flag-specific test fixtures)."""

    # Real birth (preferred — uses calculate_bazi_with_all_pipelines)
    birth_date: Optional[str]      # YYYY-MM-DD
    birth_time: Optional[str]      # HH:MM
    birth_city: Optional[str]
    birth_timezone: Optional[str]
    gender: str                     # 'male' | 'female'
    target_year: Optional[int]
    # Synthetic pillar override (used when no real birth produces the needed config)
    synthetic_pillars: Optional[Dict[str, Dict[str, str]]]
    # Description for the eval reviewer
    description: str
    # Doctrine flags this fixture is designed to exercise
    expected_doctrine_flags: list


CHART_FIXTURES: Dict[str, ChartFixture] = {
    # ============================================================
    # Canonical anchors (real births — primary calibration)
    # ============================================================

    'laopo': {
        'birth_date': '1987-01-25',
        'birth_time': '16:45',
        'birth_city': '柔佛',
        'birth_timezone': 'Asia/Kuala_Lumpur',
        'gender': 'female',
        'target_year': 2026,
        'description': 'Laopo: 丙寅/辛丑/甲戌/壬申 female. Phase 12g.3 anchor — '
                       '傷官見官 valence=beneficial (正官 is 忌神). Phase 12g.6 '
                       '配偶宮 has 丑戌半刑.',
        'expected_doctrine_flags': [
            'shangguanJianGuan', 'spousePalaceFrictions',
        ],
    },

    'roger': {
        'birth_date': '1987-09-06',
        'birth_time': '16:11',
        'birth_city': '吉打',
        'birth_timezone': 'Asia/Kuala_Lumpur',
        'gender': 'male',
        'target_year': 2026,
        'description': 'Roger: 丁卯/戊申/戊午/庚申 male. Phase 12d/e anchor — '
                       'no doctrine flags triggered, used as control / probabilistic-language regression.',
        'expected_doctrine_flags': [],
    },

    # ============================================================
    # Synthetic doctrine-flag fixtures
    # (use direct pillar configuration via test_love_enhanced.py make_pillars
    # pattern, since exact ten-god configs are hard to find via real births)
    # ============================================================

    'female_dm_weak_official_fav': {
        'gender': 'female',
        'description': '女命 weak DM with 正官 as 用神 — 傷官見官 valence=harmful '
                       '(reverse of Laopo case). Used to test the "harmful" arm '
                       'of the valence dispatch.',
        'synthetic_pillars': {
            # DM=庚, weak, with 正官=丁 (火) as 用神
            'year':  {'stem': '丁', 'branch': '亥'},   # 丁正官 透干
            'month': {'stem': '丁', 'branch': '未'},   # 月干丁正官
            'day':   {'stem': '庚', 'branch': '子'},
            'hour':  {'stem': '癸', 'branch': '未'},   # 癸傷官 透干
        },
        'expected_doctrine_flags': ['shangguanJianGuan'],
    },

    'female_bijie_duocai_harmful': {
        'gender': 'female',
        'description': '女命 strong DM with 比劫旺、財弱 — Phase 12h.B Item 8 '
                       'female biJieDuoCai valence=harmful. CRITICAL: must NOT '
                       'use «損夫» framing; must use «財運/姊妹» framing.',
        'synthetic_pillars': {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '乙', 'branch': '卯'},
            'day':   {'stem': '甲', 'branch': '寅'},
            'hour':  {'stem': '己', 'branch': '巳'},
        },
        'expected_doctrine_flags': ['biJieDuoCai'],
    },

    'male_bijie_duocai_harmful': {
        'gender': 'male',
        'description': '男命 strong DM with 比劫旺、財弱. Phase 12h.B Item 8 '
                       'male biJieDuoCai valence=harmful — must mention 妻緣 stability + 財.',
        'synthetic_pillars': {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '乙', 'branch': '卯'},
            'day':   {'stem': '甲', 'branch': '寅'},
            'hour':  {'stem': '己', 'branch': '巳'},
        },
        'expected_doctrine_flags': ['biJieDuoCai'],
    },

    'male_dm_weak_bijie': {
        'gender': 'male',
        'description': '男命 weak DM — biJieDuoCai valence=beneficial (比劫扶身為用). '
                       'Test the «反為助力» framing arm.',
        'synthetic_pillars': {
            'year':  {'stem': '丁', 'branch': '亥'},
            'month': {'stem': '丁', 'branch': '未'},
            'day':   {'stem': '甲', 'branch': '子'},   # DM=甲 weak
            'hour':  {'stem': '丁', 'branch': '未'},
        },
        'expected_doctrine_flags': ['biJieDuoCai'],
    },

    'female_guan_sha_lu_guan_cang_sha': {
        'gender': 'female',
        'description': '女命 露官藏殺 — Phase 12g.1 narrative-only path. Engine '
                       'emits to informationalNotes NOT challenges. AI must not '
                       'flag this as 混雜為禍.',
        'synthetic_pillars': {
            # 正官 透干 + 七殺 only as 藏干
            'year':  {'stem': '辛', 'branch': '酉'},   # 正官透干
            'month': {'stem': '丙', 'branch': '申'},   # 申中藏庚 七殺藏
            'day':   {'stem': '甲', 'branch': '辰'},
            'hour':  {'stem': '己', 'branch': '巳'},
        },
        'expected_doctrine_flags': ['guanShaHunZa'],
    },
}


def get_chart_birth_params(chart_id: str) -> Optional[Dict]:
    """Return birth params for the chart_id, or None if synthetic-only."""
    fixture = CHART_FIXTURES.get(chart_id)
    if not fixture:
        return None
    if 'synthetic_pillars' in fixture:
        return None
    return {
        'birth_date': fixture.get('birth_date'),
        'birth_time': fixture.get('birth_time'),
        'birth_city': fixture.get('birth_city'),
        'birth_timezone': fixture.get('birth_timezone'),
        'gender': fixture.get('gender'),
        'target_year': fixture.get('target_year'),
    }


def get_chart_synthetic_pillars(chart_id: str) -> Optional[Dict]:
    """Return synthetic pillar dict for synthetic fixtures; None if real birth."""
    fixture = CHART_FIXTURES.get(chart_id)
    if not fixture:
        return None
    return fixture.get('synthetic_pillars')


def is_known_chart(chart_id: str) -> bool:
    return chart_id in CHART_FIXTURES
