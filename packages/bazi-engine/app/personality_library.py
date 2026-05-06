"""
Polarity-aware ten god personality library — Phase 12g.0.

Loads `data/personality/ten_god_personality.json` and exposes selectors that
return personality keyword clusters based on each ten god's role assignment
(favorable / unfavorable / neutral) in a given chart.

Doctrinal basis: 子平真詮·論十神, 滴天髓·六親論, 三命通會·卷六. The same ten god
expresses opposite trait clusters when 喜用 vs 忌仇 — e.g. 偏財 喜用=慷慨大方,
偏財 忌仇=漫不經心揮霍. Pre-12g engine code held only one face per ten god;
this module enables both faces and a polarity-aware selector.

This module is consumed by:
  - love_enhanced.py (Phase 12g.4 Fix 1 + Fix 4)
  - lifetime_enhanced.py (future — Phase 12h)
  - career_enhanced.py (future — Phase 12h)

Phase 12g.0 ships data file + loader ONLY (no consumer changes). Subsequent
phases are the first to import from here.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Dict, List, Literal, Optional

Polarity = Literal["favorable", "unfavorable", "neutral"]

_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "personality",
    "ten_god_personality.json",
)

# Ten god role → polarity mapping. Engine-side `effective_gods` returns roles
# from 5-element labels (用神/喜神/忌神/仇神/閒神); this collapses to 3 polarities.
ROLE_TO_POLARITY: Dict[str, Polarity] = {
    "用神": "favorable",
    "喜神": "favorable",
    "忌神": "unfavorable",
    "仇神": "unfavorable",
    "閒神": "neutral",
}

# Ten gods recognised by the data file.
SUPPORTED_TEN_GODS = frozenset(
    ["正官", "七殺", "正財", "偏財", "食神", "傷官", "比肩", "劫財", "正印", "偏印"]
)


@lru_cache(maxsize=1)
def _load_data() -> Dict:
    """Load + cache the JSON data file."""
    with open(_DATA_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def role_to_polarity(role: Optional[str]) -> Polarity:
    """Map a 5-element role label to one of 3 polarities.

    用神/喜神 → favorable
    忌神/仇神 → unfavorable
    閒神 / unknown / None → neutral
    """
    if role is None:
        return "neutral"
    return ROLE_TO_POLARITY.get(role, "neutral")


def load_ten_god_personality(ten_god: str, polarity: Polarity) -> Dict[str, List[str] | str]:
    """Return the personality cell for (ten_god, polarity).

    Returns a dict with keys: core_keywords, spouse_traits, secondary, citation.
    Falls back to neutral polarity if the requested cell is missing (defensive).
    Raises ValueError if the ten god is not in the supported set.
    """
    if ten_god not in SUPPORTED_TEN_GODS:
        raise ValueError(
            f"Unknown ten god: {ten_god!r}. Supported: {sorted(SUPPORTED_TEN_GODS)}"
        )
    if polarity not in ("favorable", "unfavorable", "neutral"):
        raise ValueError(
            f"Unknown polarity: {polarity!r}. Must be favorable/unfavorable/neutral."
        )

    data = _load_data()
    cell = data.get(ten_god, {}).get(polarity)
    if cell is None:
        # Defensive fallback — in practice all 30 cells exist (asserted in tests).
        cell = data.get(ten_god, {}).get("neutral", {})
    return cell


def load_personality_by_role(ten_god: str, role: Optional[str]) -> Dict[str, List[str] | str]:
    """Convenience wrapper: takes a 5-element role label, returns the personality cell."""
    return load_ten_god_personality(ten_god, role_to_polarity(role))


def get_supported_ten_gods() -> List[str]:
    """Return the list of recognised ten gods (for test enumeration)."""
    return sorted(SUPPORTED_TEN_GODS)
