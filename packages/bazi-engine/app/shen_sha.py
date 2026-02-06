"""
Shen Sha (神煞) — Special Stars Calculator

Shen Sha are special stars derived from various relationships between
the Day Pillar and other pillars. They indicate auspicious or inauspicious
influences on the person's destiny.

Key stars implemented:
- 天乙貴人 (Tian Yi Noble)
- 文昌 (Wen Chang / Academic Star)
- 驛馬 (Yi Ma / Travel Star)
- 桃花 (Tao Hua / Peach Blossom / Romance)
- 華蓋 (Hua Gai / Canopy)
- 將星 (Jiang Xing / General Star)
- 祿神 (Lu Shen / Prosperity)
- 羊刃 (Yang Ren / Blade)
- 空亡 (Kong Wang / Void)
"""

from typing import Dict, List, Set

from .constants import (
    BRANCH_INDEX,
    EARTHLY_BRANCHES,
    HEAVENLY_STEMS,
    HUAGAI,
    JIANGXING,
    LUSHEN,
    STEM_INDEX,
    TAOHUA,
    TIANYI_GUIREN,
    WENCHANG,
    YANGREN,
    YIMA,
)


def calculate_kong_wang(day_stem: str, day_branch: str) -> List[str]:
    """
    Calculate Kong Wang (空亡 / Void) branches for the Day Pillar.

    In each group of 10 days in the 60 Jiazi cycle, only 10 of the 12 branches
    are used. The 2 unused branches are the "void" branches.

    Method:
    1. Find the Jiazi group index: stem_index and branch_index
    2. The starting Jiazi of the group: branch_index - stem_index (mod 12)
    3. The two void branches are at positions 10 and 11 from the start

    Args:
        day_stem: Day Heavenly Stem
        day_branch: Day Earthly Branch

    Returns:
        List of two void Earthly Branches
    """
    stem_idx = STEM_INDEX[day_stem]
    branch_idx = BRANCH_INDEX[day_branch]

    # Find the starting branch of this Jiazi 10-day group
    # In a 60-pair cycle, pairs go: 甲子, 乙丑, 丙寅...
    # Starting branch of the group = branch_idx - stem_idx (mod 12)
    start_branch = (branch_idx - stem_idx) % 12

    # The two void branches are at positions 10 and 11 from start
    void1 = EARTHLY_BRANCHES[(start_branch + 10) % 12]
    void2 = EARTHLY_BRANCHES[(start_branch + 11) % 12]

    return [void1, void2]


def calculate_shen_sha_for_pillar(
    day_stem: str,
    day_branch: str,
    pillar_name: str,
    pillar_branch: str,
    pillar_stem: str,
) -> List[str]:
    """
    Calculate all Shen Sha (神煞) that apply to a given pillar.

    Args:
        day_stem: Day Heavenly Stem (used for stem-based lookups)
        day_branch: Day Earthly Branch (used for branch-based lookups)
        pillar_name: Name of the pillar ('year', 'month', 'day', 'hour')
        pillar_branch: The pillar's Earthly Branch to check
        pillar_stem: The pillar's Heavenly Stem to check

    Returns:
        List of Shen Sha names that are present in this pillar
    """
    sha_list: List[str] = []

    # Skip checking day pillar against itself for most stars
    # (some stars are based on Year Branch instead)

    # 天乙貴人 (Tian Yi Noble) — lookup by Day Stem
    if pillar_branch in TIANYI_GUIREN.get(day_stem, []):
        sha_list.append('天乙貴人')

    # 文昌 (Wen Chang / Academic Star) — lookup by Day Stem
    if pillar_branch == WENCHANG.get(day_stem, ''):
        sha_list.append('文昌')

    # 驛馬 (Yi Ma / Travel Star) — lookup by Day Branch
    if pillar_branch == YIMA.get(day_branch, ''):
        sha_list.append('驛馬')

    # 桃花 (Tao Hua / Peach Blossom) — lookup by Day Branch
    if pillar_branch == TAOHUA.get(day_branch, ''):
        sha_list.append('桃花')

    # 華蓋 (Hua Gai / Canopy) — lookup by Day Branch
    if pillar_branch == HUAGAI.get(day_branch, ''):
        sha_list.append('華蓋')

    # 將星 (Jiang Xing / General Star) — lookup by Day Branch
    if pillar_branch == JIANGXING.get(day_branch, ''):
        sha_list.append('將星')

    # 祿神 (Lu Shen / Prosperity) — lookup by Day Stem
    if pillar_branch == LUSHEN.get(day_stem, ''):
        sha_list.append('祿神')

    # 羊刃 (Yang Ren / Blade) — lookup by Day Stem
    if pillar_branch == YANGREN.get(day_stem, ''):
        sha_list.append('羊刃')

    # 空亡 (Kong Wang / Void) — based on Day Pillar
    void_branches = calculate_kong_wang(day_stem, day_branch)
    if pillar_branch in void_branches and pillar_name != 'day':
        sha_list.append('空亡')

    return sha_list


def apply_shen_sha_to_pillars(pillars: Dict, day_stem: str, day_branch: str) -> Dict:
    """
    Apply Shen Sha calculations to all four pillars.

    Args:
        pillars: The four pillars dictionary
        day_stem: Day Heavenly Stem
        day_branch: Day Earthly Branch

    Returns:
        Updated pillars with shenSha lists populated
    """
    kong_wang = calculate_kong_wang(day_stem, day_branch)

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        sha = calculate_shen_sha_for_pillar(
            day_stem=day_stem,
            day_branch=day_branch,
            pillar_name=pillar_name,
            pillar_branch=pillar['branch'],
            pillar_stem=pillar['stem'],
        )
        pillar['shenSha'] = sha

    # Also store kong wang at the top level
    return pillars, kong_wang


def get_all_shen_sha(pillars: Dict) -> List[Dict[str, str]]:
    """
    Collect all Shen Sha across all pillars into a flat list with location info.

    Args:
        pillars: The four pillars with shenSha populated

    Returns:
        List of {name, pillar, branch} dictionaries
    """
    all_sha: List[Dict[str, str]] = []
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        for sha_name in pillar.get('shenSha', []):
            all_sha.append({
                'name': sha_name,
                'pillar': pillar_name,
                'branch': pillar['branch'],
            })
    return all_sha
