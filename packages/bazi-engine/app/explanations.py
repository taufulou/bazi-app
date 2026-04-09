"""
Element Encyclopedia — Template loader and assembly logic.

Loads pre-computed JSON explanation templates from data/explanations/
and assembles personalized explanations based on user's chart context.

No AI involved. All content is pre-written and deterministic.
"""
import json
import os
import logging
from typing import Dict, Any, Optional

from app.constants import (
    STEM_ELEMENT,
    BRANCH_ELEMENT,
    ELEMENT_PRODUCES,
    ELEMENT_OVERCOMES,
    ELEMENT_PRODUCED_BY,
    ELEMENT_OVERCOME_BY,
)

logger = logging.getLogger(__name__)

# ── Templates loaded once at module import ──
_TEMPLATES: Dict[str, Any] = {}


def _load_templates():
    """Load all explanation JSON files into memory.

    Gracefully handles missing directory and per-file errors.
    One malformed file does NOT block loading of other files.
    """
    data_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'explanations')
    try:
        filenames = sorted(os.listdir(data_dir))
    except FileNotFoundError:
        logger.warning(
            f"Explanations directory not found: {data_dir}. "
            "Element explanations will be unavailable."
        )
        return

    for filename in filenames:
        if not filename.endswith('.json'):
            continue
        filepath = os.path.join(data_dir, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                key = filename.replace('.json', '')
                _TEMPLATES[key] = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Failed to load explanation template {filename}: {e}")
            # Continue loading other files

    logger.info(f"Loaded {len(_TEMPLATES)} explanation template files")


_load_templates()


# ── Pillar context (what each pillar represents) ──
_PILLAR_CONTEXT: Dict[str, Any] = {}


def _load_pillar_context():
    """Load pillar context descriptions. Optional — missing file won't crash."""
    global _PILLAR_CONTEXT
    filepath = os.path.join(
        os.path.dirname(__file__), '..', 'data', 'explanations', 'pillar_context.json',
    )
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            _PILLAR_CONTEXT = json.load(f)
        logger.info(f"Loaded pillar context for {len(_PILLAR_CONTEXT)} pillars")
    except (FileNotFoundError, json.JSONDecodeError, IOError) as e:
        logger.warning(f"Could not load pillar_context.json: {e}. Pillar context unavailable.")
        _PILLAR_CONTEXT = {}


_load_pillar_context()


# ── Ten God → Element mapping ──
# Each ten god pair (正/偏) shares the same five-element relationship to the DM.
# The element IS deterministic from the DM stem + relationship type.
TEN_GOD_TO_RELATIONSHIP: Dict[str, str] = {
    '比肩': 'same',
    '劫財': 'same',
    '食神': 'i_produce',
    '傷官': 'i_produce',
    '偏財': 'i_overcome',
    '正財': 'i_overcome',
    '偏官': 'overcomes_me',
    '正官': 'overcomes_me',
    '偏印': 'produces_me',
    '正印': 'produces_me',
}

# Kong Wang uses collapsed 3-key system for Layer C
KONG_WANG_ROLE_MAP: Dict[str, str] = {
    '喜神': 'favorable',
    '用神': 'favorable',
    '忌神': 'unfavorable',
    '仇神': 'unfavorable',
    '閒神': 'neutral',
}

# Strength classification → Chinese label for template placeholders
STRENGTH_LABEL_MAP: Dict[str, str] = {
    'very_strong': '偏強',
    'strong': '偏強',
    'very_weak': '偏弱',
    'weak': '偏弱',
    'neutral': '中和',
}

# Map element_type → JSON template filename (without .json)
TEMPLATE_FILE_MAP: Dict[str, str] = {
    'ten_god': 'ten_gods',
    'stem': 'stems',
    'branch': 'branches',
    'hidden_stem': 'hidden_stems',
    'life_stage': 'life_stages',
    'nayin': 'nayins',
    'shensha': 'shenshas',
    'seasonal_state': 'seasonal_states',
    'kong_wang': 'kong_wang',
}


def _determine_element_god_role(
    value: str,
    element_type: str,
    god_roles: Dict[str, str],
) -> Optional[str]:
    """Determine which god role (喜神/用神/閒神/忌神/仇神) an element falls into.

    Mapping chain:
      1. value + element_type → target five element
      2. target element matched against god_roles dict

    Args:
        value: The element value (e.g., "正官", "甲", "子")
        element_type: "ten_god", "stem", "branch", "kong_wang", etc.
        god_roles: Dict with keys favorableGod/usefulGod/idleGod/tabooGod/enemyGod
                   + dayMasterElement. These are EFFECTIVE (post-從格 override).

    Returns:
        One of "喜神", "用神", "閒神", "忌神", "仇神", or None if unmappable.
    """
    target_element: Optional[str] = None

    if element_type == 'ten_god':
        # Ten god → relationship → DM element → target element
        relationship = TEN_GOD_TO_RELATIONSHIP.get(value)
        dm_element = god_roles.get('dayMasterElement')
        if not relationship or not dm_element:
            return None
        if relationship == 'same':
            target_element = dm_element
        elif relationship == 'i_produce':
            target_element = ELEMENT_PRODUCES.get(dm_element)
        elif relationship == 'i_overcome':
            target_element = ELEMENT_OVERCOMES.get(dm_element)
        elif relationship == 'overcomes_me':
            target_element = ELEMENT_OVERCOME_BY.get(dm_element)
        elif relationship == 'produces_me':
            target_element = ELEMENT_PRODUCED_BY.get(dm_element)

    elif element_type == 'stem':
        target_element = STEM_ELEMENT.get(value)

    elif element_type in ('branch', 'kong_wang'):
        # kong_wang value is a branch character — same element lookup
        target_element = BRANCH_ELEMENT.get(value)

    elif element_type == 'life_stage':
        # Life stages show the DM's stage — the relevant element is the DM itself
        target_element = god_roles.get('dayMasterElement')

    elif element_type == 'seasonal_state':
        # Seasonal states: value is the state name (旺/相/休/囚/死), not an element.
        # We skip god role mapping here — Layer C for seasonal states uses a
        # different approach (the template itself asks "is your 用神 in this state?").
        # Instead, we return None and let the template handle it contextually.
        # The seasonal_state templates key Layer C by god role, but the actual
        # element context needs to be passed separately. For now, use DM element
        # as a reasonable default (the user clicked the DM's seasonal state row).
        target_element = god_roles.get('dayMasterElement')

    elif element_type == 'hidden_stem':
        # Hidden stems are the same 10 天干 — same element lookup as stems
        target_element = STEM_ELEMENT.get(value)

    elif element_type == 'nayin':
        # Nayin element is the last character of the name (e.g., 海中金 → 金)
        if value and len(value) >= 2:
            target_element = value[-1] if value[-1] in ('金', '木', '水', '火', '土') else None

    elif element_type == 'shensha':
        # Shensha don't map cleanly to a single element.
        # Use DM element as default — Layer C templates are written
        # with simplified 3-role (favorable/neutral/unfavorable) or
        # contextual approach rather than strict element-based god roles.
        target_element = god_roles.get('dayMasterElement')

    if not target_element:
        return None

    # Match against god roles
    role_map = {
        god_roles.get('favorableGod'): '喜神',
        god_roles.get('usefulGod'): '用神',
        god_roles.get('idleGod'): '閒神',
        god_roles.get('tabooGod'): '忌神',
        god_roles.get('enemyGod'): '仇神',
    }
    return role_map.get(target_element)


def _substitute_placeholders(text: str, god_roles: Dict[str, str]) -> str:
    """Replace {strengthLabel} and {dmElement} placeholders in template text.

    Templates without placeholders pass through unmodified
    (str.replace on a string without the target is a no-op).
    """
    strength = god_roles.get('strengthClassification', 'neutral')
    label = STRENGTH_LABEL_MAP.get(strength, '中和')
    dm_element = god_roles.get('dayMasterElement', '')
    return text.replace('{strengthLabel}', label).replace('{dmElement}', dm_element)


def get_element_explanation(
    element_type: str,
    value: str,
    pillar: str,
    god_roles: Dict[str, str],
    gender: str,
    four_pillars: Optional[Dict[str, dict]] = None,
) -> dict:
    """Assemble explanation from template layers + cross-pillar interactions.

    Always returns ALL layers (no subscription gating).
    Frontend decides what to display based on isSubscriber.

    Args:
        element_type: "ten_god" | "stem" | "branch" | ... | "kong_wang"
        value: "正官" | "甲" | "子" | etc.
        pillar: "year" | "month" | "day" | "hour"
        god_roles: Minimal dict with effective god role elements + DM info.
        gender: "male" | "female"
        four_pillars: Optional full pillar data for cross-pillar interaction detection.

    Returns:
        Dict with "generic" (Layer A), "personalized" (Layers B/C/D),
        and optionally "interactions" (cross-pillar checks).
        Returns {"error": "..."} if element type or value not found.
    """
    template_file = TEMPLATE_FILE_MAP.get(element_type)
    if not template_file or template_file not in _TEMPLATES:
        return {"error": f"Unknown element type: {element_type}"}

    templates = _TEMPLATES[template_file]

    # Kong wang and seasonal_state use a single concept entry, not per-value keys
    if element_type == 'kong_wang':
        entry = templates.get('_concept')
    elif element_type == 'seasonal_state':
        entry = templates.get(value)
    else:
        entry = templates.get(value)

    if not entry:
        return {"error": f"No template for: {value}"}

    # Layer A — generic (free tier content)
    result: Dict[str, Any] = {
        "generic": entry["layerA"],
    }

    # Build personalized layers
    personalized: Dict[str, Any] = {}

    # Layer B — pillar-specific
    if pillar in entry.get("layerB", {}):
        personalized["pillarMeaning"] = entry["layerB"][pillar]

    # Layer C — god role
    god_role = _determine_element_god_role(value, element_type, god_roles)

    # Types with collapsed god role keys (5 → 3 or 5 → 2)
    if element_type in ('kong_wang', 'shensha') and god_role:
        god_role = KONG_WANG_ROLE_MAP.get(god_role, 'neutral')
    elif element_type == 'nayin' and god_role:
        # Nayin uses 2-key system: favorable vs unfavorable
        nayin_map = {'喜神': 'favorable', '用神': 'favorable',
                     '忌神': 'unfavorable', '仇神': 'unfavorable',
                     '閒神': 'favorable'}  # 閒神 defaults to favorable for nayin
        god_role = nayin_map.get(god_role, 'favorable')

    if god_role and god_role in entry.get("layerC", {}):
        raw = entry["layerC"][god_role]
        personalized["godRoleMeaning"] = _substitute_placeholders(raw, god_roles)
        personalized["godRole"] = god_role

    # Layer D — gender/六親
    if gender in entry.get("layerD", {}):
        personalized["genderMeaning"] = entry["layerD"][gender]

    result["personalized"] = personalized

    # Pillar context (what this pillar represents in the chart)
    pillar_ctx = _PILLAR_CONTEXT.get(pillar)
    if pillar_ctx:
        result["pillarContext"] = pillar_ctx

    # Cross-pillar interactions (optional — requires four_pillars data)
    if four_pillars:
        from .cross_pillar import detect_cross_pillar_interactions
        interactions = detect_cross_pillar_interactions(
            element_type=element_type,
            value=value,
            pillar=pillar,
            four_pillars=four_pillars,
            god_roles=god_roles,
        )
        if interactions:
            result["interactions"] = interactions

    # Day Pillar Combo (only for day stem clicks with four_pillars context)
    if element_type == 'stem' and pillar == 'day' and four_pillars:
        day_combos = _TEMPLATES.get('day_pillar_combos', {})
        branch = four_pillars.get('day', {}).get('branch', '')
        combo_key = f"{value}{branch}"
        combo_data = day_combos.get(combo_key)
        if combo_data:
            result["dayPillarCombo"] = combo_data
        else:
            logger.warning(f"Missing day pillar combo: {combo_key}")

    return result
