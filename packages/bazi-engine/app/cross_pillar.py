"""
Cross-pillar interaction detection for the Bazi Element Encyclopedia.

Detects interactions between pillars when a user clicks an element:
- Phase B1: 藏干 透干/通根 (hidden stem manifest/root checks)
- Phase B2: 地支 六合/六沖/三合/三會 (branch interactions)
- Phase B3: 十神 cross-interactions (ten god patterns)
- Phase B4/B5: Advanced interactions (三刑, 害, 破, chains, etc.)

Templates are loaded independently from data/explanations/interactions/*.json.
"""

import json
import os
from typing import Any, Dict, List, Optional

from .constants import HIDDEN_STEMS

# ── Pillar labels for template text ──
PILLAR_LABELS: Dict[str, str] = {
    'year': '年柱', 'month': '月柱', 'day': '日柱', 'hour': '時柱',
}

# ── Root tier labels ──
ROOT_TIER_LABELS = {
    0: '本氣',   # Primary hidden stem (index 0)
    1: '中氣',   # Secondary hidden stem (index 1)
    2: '餘氣',   # Tertiary hidden stem (index 2)
}

# ── Load templates ──
_INTERACTION_TEMPLATES: Dict[str, Any] = {}

# Fallback text when modifier template is missing
_TOUGAN_FALLBACK = '此藏干的透干狀態會影響其在此宮位的表現力度。'
_TONGGEN_FALLBACK = '此天干的通根狀態會影響其在此宮位的實際力量。'

import logging
logger = logging.getLogger(__name__)


def _load_interaction_templates() -> Dict[str, Any]:
    """Load all interaction template JSON files from data/explanations/interactions/.

    This includes tougan_modifiers.json which provides pillar-aware
    透干/藏而不透 modifier text for interaction cards.
    """
    templates: Dict[str, Any] = {}
    data_dir = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'data', 'explanations', 'interactions',
    )
    if not os.path.isdir(data_dir):
        return templates
    for filename in os.listdir(data_dir):
        if filename.endswith('.json'):
            filepath = os.path.join(data_dir, filename)
            with open(filepath, encoding='utf-8') as f:
                key = filename.replace('.json', '')
                templates[key] = json.load(f)
    return templates


# Load at module import time
_INTERACTION_TEMPLATES = _load_interaction_templates()


# ============================================================
# Phase B1: 藏干 透干/通根 Detection
# ============================================================

def _detect_tougan(
    value: str,
    pillar: str,
    four_pillars: Dict[str, dict],
    is_spouse_palace: bool = False,
) -> List[Dict]:
    """Detect 透干: does this hidden stem appear as a 天干 in any other pillar?

    Args:
        value: The hidden stem character (e.g., '甲')
        pillar: Which pillar the hidden stem is in (e.g., 'year')
        four_pillars: All four pillars data
        is_spouse_palace: True when hidden_stem + day pillar (日支=配偶宮)
    """
    interactions: List[Dict] = []

    # Load tougan modifiers (pillar-aware descriptions)
    modifiers = _INTERACTION_TEMPLATES.get('tougan_modifiers', {})

    for pkey, pdata in four_pillars.items():
        # Skip same pillar only if its stem is DIFFERENT from the hidden stem.
        # If stem matches (e.g., 辛 hidden in 酉 + 辛 as year stem), that IS 透干.
        if pkey == pillar and pdata.get('stem') != value:
            continue
        if pdata.get('stem') == value:
            plabel = PILLAR_LABELS.get(pkey, pkey)

            if pkey == pillar:
                base = (
                    f'此藏干{value}與本柱天干相同，直接透出'
                    f'——藏在地支中的力量與頭頂的天干完全一致，'
                    f'形成上下呼應的格局，{value}的力量非常穩固。'
                )
            else:
                base = (
                    f'此藏干{value}已透出{plabel}天干，力量大增'
                    f'——藏在地下的力量與地上的天干連成一體，'
                    f'影響力從潛在變為實際。'
                )

            # Pillar-aware modifier from tougan_modifiers.json
            # Use 'day_spouse' key for hidden stems in day branch (配偶宮)
            modifier_pillar = 'day_spouse' if (is_spouse_palace and pillar == 'day') else pillar
            modifier = (
                modifiers.get(value, {}).get('tougan', {}).get(modifier_pillar, '')
            )
            if not modifier:
                modifier = _TOUGAN_FALLBACK
                logger.warning(f'Missing tougan modifier: {value}/{pillar}')

            description = f'{base}\n\n{modifier}'

            interactions.append({
                'type': 'hidden_stem_check',
                'name': f'{value}透干',
                'icon': '✓',
                'description': description,
                'pillarsInvolved': [pillar, pkey] if pkey != pillar else [pillar],
                'nature': 'manifest',
                'priority': 75,
            })

    # If no 透干 found, note it as 藏而不透
    if not interactions:
        base = (
            f'此藏干{value}在四柱天干中沒有出現（未透干），'
            f'屬於藏而不透的狀態。這股力量並非完全無效'
            f'——它仍然在本柱中發揮潛在的影響，'
            f'像是性格中不易被察覺的內在傾向，'
            f'只是無法充分參與命局的生剋制化。'
            f'當大運或流年天干出現{value}時，這股潛能會被激活，'
            f'屆時影響力將大幅增強。'
        )

        # Pillar-aware modifier from tougan_modifiers.json
        # Use 'day_spouse' key for hidden stems in day branch (配偶宮)
        modifier_pillar = 'day_spouse' if (is_spouse_palace and pillar == 'day') else pillar
        modifier = (
            modifiers.get(value, {}).get('cang', {}).get(modifier_pillar, '')
        )
        if not modifier:
            modifier = _TOUGAN_FALLBACK
            logger.warning(f'Missing cang modifier: {value}/{pillar}')

        description = f'{base}\n\n{modifier}'

        interactions.append({
            'type': 'hidden_stem_check',
            'name': f'{value}藏而不透',
            'icon': '○',
            'description': description,
            'pillarsInvolved': [pillar],
            'nature': 'latent',
            'priority': 40,
        })

    return interactions


def _detect_tonggen(
    value: str,
    pillar: str,
    four_pillars: Dict[str, dict],
) -> List[Dict]:
    """Detect 通根: does this manifest stem have root support from hidden stems?

    Uses mainstream quantified scoring:
    - Base scores: 本氣=6, 中氣=3, 餘氣=1 (ratio ~6:3:1 per 李洪成/邵偉華)
    - Pillar distance discount: same=1.0, adjacent=0.75, separated=0.5, distant=0.25
    - Thresholds: ≥6 strong, ≥3 moderate, <3 weak

    Args:
        value: The heavenly stem character (e.g., '甲')
        pillar: Which pillar this stem is in
        four_pillars: All four pillars data
    """
    interactions: List[Dict] = []
    found_roots: List[Dict] = []

    # Pillar order for distance calculation
    PILLAR_ORDER = ['year', 'month', 'day', 'hour']
    # Distance discount multipliers
    DISTANCE_MULTIPLIERS = {0: 1.0, 1: 0.75, 2: 0.5, 3: 0.25}

    pillar_idx = PILLAR_ORDER.index(pillar) if pillar in PILLAR_ORDER else 0

    for pkey, pdata in four_pillars.items():
        branch = pdata.get('branch', '')
        hidden_stems = HIDDEN_STEMS.get(branch, [])

        pkey_idx = PILLAR_ORDER.index(pkey) if pkey in PILLAR_ORDER else 0
        distance = abs(pillar_idx - pkey_idx)

        for idx, hs in enumerate(hidden_stems):
            if hs == value:
                tier = ROOT_TIER_LABELS.get(idx, '餘氣')
                plabel = PILLAR_LABELS.get(pkey, pkey)
                found_roots.append({
                    'pillar': pkey,
                    'pillarLabel': plabel,
                    'branch': branch,
                    'tier': tier,
                    'tierIndex': idx,
                    'distance': distance,
                })

    if found_roots:
        # Sort by tier strength (本氣 first)
        found_roots.sort(key=lambda r: r['tierIndex'])
        best = found_roots[0]

        # Cumulative root scoring with distance discount
        # Base scores: 本氣=6, 中氣=3, 餘氣=1
        TIER_SCORES = {0: 6, 1: 3, 2: 1}
        total_score = sum(
            TIER_SCORES.get(r['tierIndex'], 1)
            * DISTANCE_MULTIPLIERS.get(r['distance'], 0.25)
            for r in found_roots
        )

        # Thresholds: ≥6 strong, ≥3 moderate, <3 weak
        if total_score >= 6:
            strength_desc = '根基深厚，力量穩固'
            nature = 'strong_root'
        elif total_score >= 3:
            strength_desc = '根基尚可，有一定的支撐力'
            nature = 'moderate_root'
        else:
            strength_desc = '根基較淺，力量有限'
            nature = 'weak_root'

        # Build description with all roots
        root_details = '、'.join(
            f'{r["pillarLabel"]}{r["branch"]}（{r["tier"]}）'
            for r in found_roots
        )
        multi = f'，共有{len(found_roots)}處通根' if len(found_roots) > 1 else ''

        # Display name: use cumulative nature, but show best tier in detail
        NATURE_LABELS = {
            'strong_root': '強',
            'moderate_root': '中',
            'weak_root': '弱',
        }
        nature_label = NATURE_LABELS.get(nature, '中')

        base = (
            f'此天干{value}在地支中有通根：{root_details}{multi}。'
            f'最強的根在{best["pillarLabel"]}{best["branch"]}（{best["tier"]}），'
            f'{strength_desc}。'
            f'通根就像大樹的根系——根越深越多，天干的力量就越穩固。'
        )

        # Pillar-aware modifier from tonggen_modifiers.json
        tg_modifiers = _INTERACTION_TEMPLATES.get('tonggen_modifiers', {})
        modifier = (
            tg_modifiers.get(value, {}).get(nature, {}).get(pillar, '')
        )
        if not modifier:
            modifier = _TONGGEN_FALLBACK
            logger.warning(f'Missing tonggen modifier: {value}/{nature}/{pillar}')

        description = f'{base}\n\n{modifier}'

        interactions.append({
            'type': 'hidden_stem_check',
            'name': f'{value}通根（{best["tier"]}）',
            'icon': '🌱',
            'description': description,
            'pillarsInvolved': [pillar] + [r['pillar'] for r in found_roots],
            'nature': nature,
            'priority': 70,
        })
    else:
        # No root — 虛浮無根
        base = (
            f'此天干{value}在四柱地支中沒有任何藏干支持，'
            f'屬於虛浮無根的狀態——就像一棵沒有根的樹，'
            f'看似存在卻站不穩。{value}所代表的十神力量較弱，'
            f'其影響多半是表面的、不穩定的。'
        )

        # Pillar-aware modifier from tonggen_modifiers.json
        tg_modifiers = _INTERACTION_TEMPLATES.get('tonggen_modifiers', {})
        modifier = (
            tg_modifiers.get(value, {}).get('floating', {}).get(pillar, '')
        )
        if not modifier:
            modifier = _TONGGEN_FALLBACK
            logger.warning(f'Missing tonggen modifier: {value}/floating/{pillar}')

        description = f'{base}\n\n{modifier}'

        interactions.append({
            'type': 'hidden_stem_check',
            'name': f'{value}虛浮無根',
            'icon': '⚠',
            'description': description,
            'pillarsInvolved': [pillar],
            'nature': 'floating',
            'priority': 65,
        })

    return interactions


# ============================================================
# Main dispatch function
# ============================================================

def detect_cross_pillar_interactions(
    element_type: str,
    value: str,
    pillar: str,
    four_pillars: Dict[str, dict],
    god_roles: Dict[str, str],
) -> List[Dict]:
    """Detect cross-pillar interactions for the clicked element.

    Returns a list of interaction dicts, sorted by priority descending,
    max 4 items.

    Args:
        element_type: "hidden_stem" | "stem" | "branch" | "ten_god" | etc.
        value: The clicked element value
        pillar: Which pillar it's in
        four_pillars: All four pillars data (stems, branches, tenGods, hiddenStemGods)
        god_roles: Effective god roles for the chart
    """
    interactions: List[Dict] = []

    # Phase B1: Hidden stem / Stem checks
    if element_type == 'hidden_stem':
        is_spouse = (pillar == 'day')  # 日支 = 配偶宮
        interactions.extend(_detect_tougan(value, pillar, four_pillars, is_spouse_palace=is_spouse))
    elif element_type == 'stem':
        interactions.extend(_detect_tonggen(value, pillar, four_pillars))
    elif element_type == 'ten_god':
        # Ten god IS the stem — extract the stem from this pillar and check its root
        pillar_data = four_pillars.get(pillar, {})
        stem = pillar_data.get('stem', '')
        if stem:
            interactions.extend(_detect_tonggen(stem, pillar, four_pillars))

    # Phase B2: Branch interactions (六合/六沖/三合/三會)
    # elif element_type == 'branch':
    #     interactions.extend(_detect_branch_interactions(value, pillar, four_pillars))

    # Sort by priority descending, limit to 4
    interactions.sort(key=lambda x: x.get('priority', 0), reverse=True)
    return interactions[:4]
