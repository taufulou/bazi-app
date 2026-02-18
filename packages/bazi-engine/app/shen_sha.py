"""
Shen Sha (神煞) — Special Stars Calculator

Shen Sha are special stars derived from various relationships between
the Day Pillar and other pillars. They indicate auspicious or inauspicious
influences on the person's destiny.

26 types implemented (Phase 11D expansion from original 8):

Group 1 — Major Auspicious:
  天乙貴人, 紅鸞, 天喜, 文昌, 將星, 祿神, 華蓋, 驛馬, 桃花, 羊刃

Group 2 — Second-Tier Auspicious:
  天德貴人, 月德貴人, 太極貴人, 國印貴人, 金輿, 天醫, 學堂

Group 3 — Malefic:
  孤辰, 寡宿, 災煞, 劫煞, 亡神, 天羅/地網

Group 4 — Day Pillar Specials:
  魁罡日, 陰陽差錯日, 十惡大敗日

Plus: 空亡 (Kong Wang / Void)
"""

from typing import Dict, List, Set

from .constants import (
    BRANCH_ELEMENT,
    BRANCH_INDEX,
    DIWANG_BRANCHES,
    EARTHLY_BRANCHES,
    GUCHEN,
    GUASU,
    GUOYIN,
    HEAVENLY_STEMS,
    HONGLUAN,
    HUAGAI,
    JIANGXING,
    JIESHA,
    JINYU,
    KUIGANG_DAYS,
    LUSHEN,
    SHIE_DABAI_DAYS,
    STEM_ELEMENT,
    STEM_INDEX,
    TAIJI,
    TAOHUA,
    TIANDE,
    TIANXI,
    TIANLUO_BRANCHES,
    TIANYI_DOCTOR,
    TIANYI_GUIREN,
    WANGSHEN,
    WENCHANG,
    XUETANG,
    YANGREN,
    YIMA,
    YINYANG_ERROR_DAYS,
    YUEDE,
    ZAISHA,
)


def calculate_kong_wang(day_stem: str, day_branch: str) -> List[str]:
    """
    Calculate Kong Wang (空亡 / Void) branches for the Day Pillar.

    In each group of 10 days in the 60 Jiazi cycle, only 10 of the 12 branches
    are used. The 2 unused branches are the "void" branches.

    Args:
        day_stem: Day Heavenly Stem
        day_branch: Day Earthly Branch

    Returns:
        List of two void Earthly Branches
    """
    stem_idx = STEM_INDEX[day_stem]
    branch_idx = BRANCH_INDEX[day_branch]

    start_branch = (branch_idx - stem_idx) % 12

    void1 = EARTHLY_BRANCHES[(start_branch + 10) % 12]
    void2 = EARTHLY_BRANCHES[(start_branch + 11) % 12]

    return [void1, void2]


def calculate_shen_sha_for_pillar(
    day_stem: str,
    day_branch: str,
    year_branch: str,
    month_branch: str,
    pillar_name: str,
    pillar_branch: str,
    pillar_stem: str,
) -> List[str]:
    """
    Calculate all Shen Sha (神煞) that apply to a given pillar.

    Args:
        day_stem: Day Heavenly Stem (used for stem-based lookups)
        day_branch: Day Earthly Branch (used for branch-based lookups)
        year_branch: Year Earthly Branch (used for year-branch-based lookups)
        month_branch: Month Earthly Branch (used for month-based lookups)
        pillar_name: Name of the pillar ('year', 'month', 'day', 'hour')
        pillar_branch: The pillar's Earthly Branch to check
        pillar_stem: The pillar's Heavenly Stem to check

    Returns:
        List of Shen Sha names that are present in this pillar
    """
    sha_list: List[str] = []

    # ================================================================
    # Group 1: Major Auspicious Stars
    # ================================================================

    # 天乙貴人 (Tian Yi Noble) — lookup by Day Stem → check branch
    if pillar_branch in TIANYI_GUIREN.get(day_stem, []):
        sha_list.append('天乙貴人')

    # 紅鸞 (Hong Luan / Red Phoenix) — lookup by Year Branch → check branch
    if pillar_branch == HONGLUAN.get(year_branch, ''):
        sha_list.append('紅鸞')

    # 天喜 (Tian Xi / Heavenly Joy) — lookup by Year Branch → check branch
    if pillar_branch == TIANXI.get(year_branch, ''):
        sha_list.append('天喜')

    # 文昌 (Wen Chang / Academic Star) — lookup by Day Stem → check branch
    if pillar_branch == WENCHANG.get(day_stem, ''):
        sha_list.append('文昌')

    # 將星 (Jiang Xing / General Star) — lookup by Year/Day Branch → check branch
    if pillar_branch == JIANGXING.get(year_branch, '') or \
       pillar_branch == JIANGXING.get(day_branch, ''):
        sha_list.append('將星')

    # 祿神 (Lu Shen / Prosperity) — lookup by Day Stem → check branch
    if pillar_branch == LUSHEN.get(day_stem, ''):
        sha_list.append('祿神')

    # 華蓋 (Hua Gai / Canopy) — lookup by Year/Day Branch → check branch
    if pillar_branch == HUAGAI.get(year_branch, '') or \
       pillar_branch == HUAGAI.get(day_branch, ''):
        sha_list.append('華蓋')

    # 驛馬 (Yi Ma / Travel Star) — lookup by Year/Day Branch → check branch
    if pillar_branch == YIMA.get(year_branch, '') or \
       pillar_branch == YIMA.get(day_branch, ''):
        sha_list.append('驛馬')

    # 桃花 (Tao Hua / Peach Blossom) — lookup by Year/Day Branch → check branch
    if pillar_branch == TAOHUA.get(year_branch, '') or \
       pillar_branch == TAOHUA.get(day_branch, ''):
        sha_list.append('桃花')

    # 羊刃 (Yang Ren / Blade) — lookup by Day Stem → check branch
    if pillar_branch == YANGREN.get(day_stem, ''):
        sha_list.append('羊刃')

    # ================================================================
    # Group 2: Second-Tier Auspicious Stars
    # ================================================================

    # 天德貴人 (Tian De) — lookup by Month Branch → check pillar STEM
    tiande_stem = TIANDE.get(month_branch, '')
    if tiande_stem:
        # 天德 checks if the required stem appears in any pillar's stem
        if pillar_stem == tiande_stem:
            sha_list.append('天德貴人')
        # Also check if the required value is a branch (卯月→申, 酉月→寅 are branches)
        if tiande_stem in BRANCH_INDEX and pillar_branch == tiande_stem:
            sha_list.append('天德貴人')

    # 月德貴人 (Yue De) — lookup by Month Branch → check pillar STEM
    yuede_stem = YUEDE.get(month_branch, '')
    if yuede_stem and pillar_stem == yuede_stem:
        sha_list.append('月德貴人')

    # 太極貴人 (Tai Ji) — lookup by Day Stem → check branch
    if pillar_branch in TAIJI.get(day_stem, []):
        sha_list.append('太極貴人')

    # 國印貴人 (Guo Yin) — lookup by Day Stem → check branch
    if pillar_branch == GUOYIN.get(day_stem, ''):
        sha_list.append('國印貴人')

    # 金輿 (Jin Yu / Golden Carriage) — lookup by Day Stem → check branch
    if pillar_branch == JINYU.get(day_stem, ''):
        sha_list.append('金輿')

    # 天醫 (Tian Yi / Heavenly Doctor) — lookup by Month Branch → check branch
    if pillar_branch == TIANYI_DOCTOR.get(month_branch, ''):
        sha_list.append('天醫')

    # 學堂 (Xue Tang / Academy) — lookup by Day Stem → check branch
    if pillar_branch == XUETANG.get(day_stem, ''):
        sha_list.append('學堂')

    # ================================================================
    # Group 3: Malefic Stars
    # ================================================================

    # 孤辰 (Gu Chen / Lonely Star) — lookup by Year Branch → check branch
    if pillar_branch == GUCHEN.get(year_branch, ''):
        sha_list.append('孤辰')

    # 寡宿 (Gua Su / Lonely Lodge) — lookup by Year Branch → check branch
    if pillar_branch == GUASU.get(year_branch, ''):
        sha_list.append('寡宿')

    # 災煞 (Zai Sha / Disaster Star) — lookup by Year/Day Branch → check branch
    if pillar_branch == ZAISHA.get(year_branch, '') or \
       pillar_branch == ZAISHA.get(day_branch, ''):
        sha_list.append('災煞')

    # 劫煞 (Jie Sha / Robbery Star) — lookup by Year/Day Branch → check branch
    if pillar_branch == JIESHA.get(year_branch, '') or \
       pillar_branch == JIESHA.get(day_branch, ''):
        sha_list.append('劫煞')

    # 亡神 (Wang Shen / Death God) — lookup by Year/Day Branch → check branch
    if pillar_branch == WANGSHEN.get(year_branch, '') or \
       pillar_branch == WANGSHEN.get(day_branch, ''):
        sha_list.append('亡神')

    # 天羅/地網 (Tian Luo / Di Wang) — element-specific
    dm_element = STEM_ELEMENT.get(day_stem, '')
    branch_element = BRANCH_ELEMENT.get(pillar_branch, '')
    if pillar_branch in TIANLUO_BRANCHES and dm_element == '火':
        sha_list.append('天羅')
    if pillar_branch in DIWANG_BRANCHES and dm_element == '水':
        sha_list.append('地網')

    # ================================================================
    # 空亡 (Kong Wang / Void)
    # ================================================================
    void_branches = calculate_kong_wang(day_stem, day_branch)
    if pillar_branch in void_branches and pillar_name != 'day':
        sha_list.append('空亡')

    return sha_list


def detect_special_day_pillars(day_stem: str, day_branch: str) -> List[Dict[str, str]]:
    """
    Detect special day pillar combinations (Group 4 Shen Sha).

    These are checked against the day pillar only (stem+branch combination).

    Args:
        day_stem: Day Heavenly Stem
        day_branch: Day Earthly Branch

    Returns:
        List of special day pillar findings
    """
    day_ganzhi = day_stem + day_branch
    findings: List[Dict[str, str]] = []

    if day_ganzhi in KUIGANG_DAYS:
        findings.append({
            'name': '魁罡日',
            'meaning': '極端性格、全有或全無的命運、強大能量',
            'effect': '領導力強但婚姻摩擦，性格剛烈，不怒而威',
        })

    if day_ganzhi in YINYANG_ERROR_DAYS:
        findings.append({
            'name': '陰陽差錯日',
            'meaning': '婚姻不和、離婚風險、夫妻冷淡',
            'effect': '男女結婚皆不利，夫妻感情易有波折，人生反覆',
        })

    if day_ganzhi in SHIE_DABAI_DAYS:
        findings.append({
            'name': '十惡大敗日',
            'meaning': '事業困難、財運波折',
            'effect': '祿入空亡之日，早年事業不順，需後天努力補救',
        })

    return findings


def apply_shen_sha_to_pillars(
    pillars: Dict, day_stem: str, day_branch: str
) -> tuple:
    """
    Apply Shen Sha calculations to all four pillars.

    Args:
        pillars: The four pillars dictionary
        day_stem: Day Heavenly Stem
        day_branch: Day Earthly Branch

    Returns:
        Tuple of (updated pillars, kong_wang list)
    """
    kong_wang = calculate_kong_wang(day_stem, day_branch)
    year_branch = pillars['year']['branch']
    month_branch = pillars['month']['branch']

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        sha = calculate_shen_sha_for_pillar(
            day_stem=day_stem,
            day_branch=day_branch,
            year_branch=year_branch,
            month_branch=month_branch,
            pillar_name=pillar_name,
            pillar_branch=pillar['branch'],
            pillar_stem=pillar['stem'],
        )
        pillar['shenSha'] = sha

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
