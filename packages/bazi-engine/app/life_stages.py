"""
Twelve Life Stages (十二長生) Calculator

The Twelve Life Stages represent the lifecycle of each element through
the twelve Earthly Branches:

長生 → 沐浴 → 冠帶 → 臨官 → 帝旺 → 衰 → 病 → 死 → 墓 → 絕 → 胎 → 養

Yang stems progress forward through branches.
Yin stems progress backward through branches.
"""

from typing import Dict

from .constants import (
    BRANCH_INDEX,
    CHANGSHENG_BRANCH,
    EARTHLY_BRANCHES,
    STEM_YINYANG,
    TWELVE_STAGES,
)


def get_life_stage(stem: str, branch: str) -> str:
    """
    Get the life stage of a stem at a given branch.

    Args:
        stem: Heavenly Stem (determines starting point and direction)
        branch: Earthly Branch (location to check)

    Returns:
        Life stage name (e.g., '長生', '帝旺', '墓')
    """
    start_branch = CHANGSHENG_BRANCH.get(stem)
    if start_branch is None:
        return ''

    start_idx = BRANCH_INDEX[start_branch]
    current_idx = BRANCH_INDEX[branch]
    yinyang = STEM_YINYANG[stem]

    if yinyang == '陽':
        # Yang stems go forward
        offset = (current_idx - start_idx) % 12
    else:
        # Yin stems go backward
        offset = (start_idx - current_idx) % 12

    return TWELVE_STAGES[offset]


def apply_life_stages_to_pillars(pillars: Dict, day_master_stem: str) -> Dict:
    """
    Apply life stage labels to each pillar based on the Day Master.

    Args:
        pillars: The four pillars dictionary
        day_master_stem: Day Master's Heavenly Stem

    Returns:
        Updated pillars with lifeStage field
    """
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        branch = pillar['branch']
        pillar['lifeStage'] = get_life_stage(day_master_stem, branch)
        # Self-sitting: each pillar's own stem on its own branch
        pillar['selfSitting'] = get_life_stage(pillar['stem'], branch)

    return pillars
