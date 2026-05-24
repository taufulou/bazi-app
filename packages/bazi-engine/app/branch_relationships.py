"""
地支關係 (Earthly Branch Relationships) — 7 Types + Interactions

Analyzes all branch-to-branch relationships within a single Bazi chart.
Checks all C(4,2)=6 branch pairs for pairwise relationships, and all
C(4,3)=4 branch triples for 三合/三會.

Relationship types (strength hierarchy):
  Positive: 三會(100) > 三合(90) > 六合(80) > 前半合(70) > 後半合(60)
  Negative: 六沖(-90) > 三刑(-80) > 六害(-70) > 六破(-60)

Key interactions:
  - 六合 can dissolve 六沖 by ~50% (合解沖)
  - 三合 suppresses internal clashes by 50-70%
  - 三刑 CANNOT be dissolved by 合 (persists always)
  - When 合 and 沖 coexist, 合 wins but tension remains

Source: 《子平真詮·論地支》, 《淵海子平·卷三》
"""

from typing import Dict, FrozenSet, List, Optional, Set, Tuple

from .constants import (
    BRANCH_ELEMENT,
    BRANCH_INDEX,
    HIDDEN_STEMS,
    STEM_ELEMENT,
    SAN_HE_TRINITIES,
    SAN_HE_FULL_MULTIPLIER,
    BAN_HE_WANG_MULTIPLIER,
    BAN_HE_MU_MULTIPLIER,
    SAN_HE_DEDI_PER_BRANCH,
)


# ============================================================
# 六合 (Six Harmonies) with Transformation Elements
# ============================================================

SIX_HARMONIES: Dict[FrozenSet[str], Dict] = {
    frozenset({'子', '丑'}): {'element': '土', 'score': 80},
    frozenset({'寅', '亥'}): {'element': '木', 'score': 80},
    frozenset({'卯', '戌'}): {'element': '火', 'score': 80},
    frozenset({'辰', '酉'}): {'element': '金', 'score': 80},
    frozenset({'巳', '申'}): {'element': '水', 'score': 80},
    frozenset({'午', '未'}): {'element': '土', 'score': 80},
}

# Quick lookup: branch → its harmony partner
HARMONY_LOOKUP: Dict[str, str] = {
    '子': '丑', '丑': '子',
    '寅': '亥', '亥': '寅',
    '卯': '戌', '戌': '卯',
    '辰': '酉', '酉': '辰',
    '巳': '申', '申': '巳',
    '午': '未', '未': '午',
}

# ============================================================
# 六沖 (Six Clashes) with Severity
# ============================================================

SIX_CLASHES: Dict[FrozenSet[str], Dict] = {
    frozenset({'子', '午'}): {'elements': '水火', 'severity': 90},
    frozenset({'丑', '未'}): {'elements': '土土', 'severity': 70},
    frozenset({'寅', '申'}): {'elements': '木金', 'severity': 85},
    frozenset({'卯', '酉'}): {'elements': '木金', 'severity': 80},
    frozenset({'辰', '戌'}): {'elements': '土土', 'severity': 75},
    frozenset({'巳', '亥'}): {'elements': '火水', 'severity': 80},
}

# Quick lookup: branch → its clash partner
CLASH_LOOKUP: Dict[str, str] = {
    '子': '午', '午': '子',
    '丑': '未', '未': '丑',
    '寅': '申', '申': '寅',
    '卯': '酉', '酉': '卯',
    '辰': '戌', '戌': '辰',
    '巳': '亥', '亥': '巳',
}

# ============================================================
# 三合 (Triple Harmony) with Roles
# ============================================================

TRIPLE_HARMONIES: List[Dict] = [
    {
        'branches': frozenset({'申', '子', '辰'}),
        'element': '水',
        'roles': {'申': '長生', '子': '帝旺', '辰': '墓庫'},
        'order': ('申', '子', '辰'),  # canonical order
    },
    {
        'branches': frozenset({'亥', '卯', '未'}),
        'element': '木',
        'roles': {'亥': '長生', '卯': '帝旺', '未': '墓庫'},
        'order': ('亥', '卯', '未'),
    },
    {
        'branches': frozenset({'寅', '午', '戌'}),
        'element': '火',
        'roles': {'寅': '長生', '午': '帝旺', '戌': '墓庫'},
        'order': ('寅', '午', '戌'),
    },
    {
        'branches': frozenset({'巳', '酉', '丑'}),
        'element': '金',
        'roles': {'巳': '長生', '酉': '帝旺', '丑': '墓庫'},
        'order': ('巳', '酉', '丑'),
    },
]

# Score hierarchy for triple harmony variants
TRIPLE_HARMONY_FULL_SCORE = 90   # Full 三合
HALF_HARMONY_SHENG_WANG = 70     # 前半合 (生旺 pair: 長生+帝旺)
HALF_HARMONY_WANG_MU = 60        # 後半合 (旺墓 pair: 帝旺+墓庫)

# ============================================================
# 三會 (Triple Meeting / Seasonal) — Strongest combination
# ============================================================

THREE_MEETINGS: Dict[FrozenSet[str], Dict] = {
    frozenset({'寅', '卯', '辰'}): {'season': '春', 'element': '木', 'direction': '東方'},
    frozenset({'巳', '午', '未'}): {'season': '夏', 'element': '火', 'direction': '南方'},
    frozenset({'申', '酉', '戌'}): {'season': '秋', 'element': '金', 'direction': '西方'},
    frozenset({'亥', '子', '丑'}): {'season': '冬', 'element': '水', 'direction': '北方'},
}

THREE_MEETING_SCORE = 100  # Strongest combination type

# ============================================================
# 三刑 (Triple Punishment)
# ============================================================

THREE_PUNISHMENTS: List[Dict] = [
    {
        'branches': frozenset({'寅', '巳', '申'}),
        'name': '無恩之刑',
        'meaning': '忘恩負義、背信棄義、濫用權力',
        'lifeEffect': '與權威人物關係差、法律糾紛、因果報應',
        'severity': 80,
        # Partial: any 2 of 3 also counts (weaker)
        'partials': [
            frozenset({'寅', '巳'}),
            frozenset({'巳', '申'}),
            frozenset({'寅', '申'}),
        ],
    },
    {
        'branches': frozenset({'丑', '戌', '未'}),
        'name': '持勢之刑',
        'meaning': '以勢欺人、霸凌、壓制他人',
        'lifeEffect': '攻擊性強、權力鬥爭、法律問題',
        'severity': 80,
        'partials': [
            frozenset({'丑', '戌'}),
            frozenset({'戌', '未'}),
            frozenset({'丑', '未'}),
        ],
    },
    {
        'branches': frozenset({'子', '卯'}),
        'name': '無禮之刑',
        'meaning': '缺乏禮貌尊重、粗魯無禮',
        'lifeEffect': '社交摩擦、人際關係受損',
        'severity': 70,
        'partials': [],  # Only 2 branches — always full
    },
]

def check_sanxing_with_pool(
    branch_a: str,
    branch_b: str,
    all_branches: Optional[Set[str]] = None,
) -> Optional[Dict]:
    """Check if two branches form a valid 三刑, requiring all members present.

    For 3-branch groups (寅巳申 無恩之刑, 丑戌未 持勢之刑):
    all 3 must exist in all_branches.
    For 2-branch groups (子卯 無禮之刑): always active.

    Classical: 「巳申單獨出現則論合，寅巳申俱全才論三刑」

    Args:
        branch_a: First branch (e.g., period/annual branch, or chart-A day branch)
        branch_b: Second branch (e.g., natal branch, or chart-B day branch)
        all_branches: Full set of branches to check for 3rd member.
            Two valid call patterns:
            (1) Single-chart transit: all natal branches + the incoming branch
                (e.g., 大運/流年 transit detection in love_enhanced.py).
            (2) Two-chart union: union of both charts' branch lists
                (e.g., compatibility cross-chart in compatibility_enhanced.py
                Phase 12i — passes `set(all_branches_a) | set(all_branches_b)`).
            Function only does set-membership checks, so the semantic
            distinction (which branch is "incoming") doesn't matter.
            When None, 3-branch groups return None (safe default).

    Returns:
        The matching punishment dict if valid 三刑, else None.
    """
    pair = frozenset({branch_a, branch_b})
    for punishment in THREE_PUNISHMENTS:
        if len(punishment['branches']) == 3:
            if pair.issubset(punishment['branches']):
                if all_branches is not None and punishment['branches'].issubset(all_branches):
                    return punishment
                return None  # 3rd branch missing or no context
        elif pair == punishment['branches'] and len(punishment['branches']) == 2:
            return punishment  # 2-branch group always active
    return None


# 自刑 (Self-Punishment): when duplicate branches appear
SELF_PUNISHMENT_BRANCHES: Set[str] = {'辰', '午', '酉', '亥'}


# ============================================================
# Phase 12g.6.0 — Branch Friction Helper
# ============================================================

def check_branch_friction(natal_branch: str, target_branch: str) -> Optional[Dict]:
    """Detect friction (沖刑害破) between a natal pillar branch and a target branch.

    Typically used to detect 配偶宮 (day branch) interactions with year/month/hour
    natal branches.

    Returns single highest-severity friction dict (priority: 沖 > 刑 > 害 > 破), or None.

    Priority order: 沖 > 刑 > 害 > 破.

    Same-pair edge case: 同一對地支同時觸發多種 friction 是物理上不可能的
    (per classical 子平 geometry — 12 地支間的關係已分類完備, 同一對只屬於一類).
    But we add a defensive priority resolver in case future classical research
    introduces new pair types or when constants are mis-edited.

    Self-pair (e.g., 戌+戌) is 伏吟, NOT friction → returns None.

    Reuses THREE_PUNISHMENTS[].partials, SIX_HARMS, SIX_BREAKS, SIX_CLASHES.
    Excludes 子卯刑 from half_punishment (it's a full 2-branch 刑, but classified
    here as 'punishment' since `partials` is empty per THREE_PUNISHMENTS data).

    Returns:
        {
            'type': 'six_clash' | 'punishment' | 'half_punishment' | 'six_harm' | 'six_break',
            'description': '...',
            'severity': int,
        }
        or None.
    """
    # Self-pair (伏吟) — not friction
    if natal_branch == target_branch:
        return None

    pair = frozenset({natal_branch, target_branch})

    # 1. 六沖 (highest priority)
    if pair in SIX_CLASHES:
        clash = SIX_CLASHES[pair]
        return {
            'type': 'six_clash',
            'description': f'{natal_branch}{target_branch}沖（{clash["elements"]}）',
            'severity': clash['severity'],
        }

    # 2. 刑 — full 2-branch 刑 (e.g., 子卯) OR half (寅巳/巳申/寅申/丑戌/戌未/丑未)
    for punishment in THREE_PUNISHMENTS:
        # Full 2-branch 刑 (子卯)
        if len(punishment['branches']) == 2 and pair == punishment['branches']:
            return {
                'type': 'punishment',
                'description': f'{natal_branch}{target_branch}刑（{punishment["name"]}）',
                'severity': punishment['severity'],
            }
        # Half 刑 (subset of 3-branch group)
        for partial in punishment['partials']:
            if pair == partial:
                return {
                    'type': 'half_punishment',
                    'description': f'{natal_branch}{target_branch}半刑（{punishment["name"]}局之半）',
                    'severity': punishment['severity'] - 20,  # half severity
                }

    # 3. 六害
    if pair in SIX_HARMS:
        harm = SIX_HARMS[pair]
        return {
            'type': 'six_harm',
            'description': f'{natal_branch}{target_branch}害（{harm["description"]}）',
            'severity': harm['severity'],
        }

    # 4. 六破 (lowest priority)
    if pair in SIX_BREAKS:
        brk = SIX_BREAKS[pair]
        return {
            'type': 'six_break',
            'description': f'{natal_branch}{target_branch}破',
            'severity': brk['severity'],
        }

    return None

# ============================================================
# 六害 (Six Harms)
# ============================================================

SIX_HARMS: Dict[FrozenSet[str], Dict] = {
    frozenset({'子', '未'}): {'description': '水土害 — 壓制成長', 'severity': 70},
    frozenset({'丑', '午'}): {'description': '土火害 — 本性衝突', 'severity': 70},
    frozenset({'寅', '巳'}): {'description': '木火害 — 先吸引後排斥', 'severity': 70},
    frozenset({'卯', '辰'}): {'description': '木土害 — 不相容', 'severity': 70},
    frozenset({'申', '亥'}): {'description': '金水害 — 互相消耗', 'severity': 70},
    frozenset({'酉', '戌'}): {'description': '金土害 — 摩擦怨恨', 'severity': 70},
}

# ============================================================
# 六破 (Six Breaks) — Least impactful negative relationship
# ============================================================

SIX_BREAKS: Dict[FrozenSet[str], Dict] = {
    frozenset({'子', '酉'}): {'severity': 60},
    frozenset({'丑', '辰'}): {'severity': 60},
    frozenset({'寅', '亥'}): {'severity': 60},
    frozenset({'卯', '午'}): {'severity': 60},
    frozenset({'巳', '申'}): {'severity': 60},
    frozenset({'未', '戌'}): {'severity': 60},
}

# ============================================================
# Pillar-Specific Clash Effects
# ============================================================

CLASH_PILLAR_EFFECTS: Dict[FrozenSet[str], str] = {
    frozenset({'year', 'month'}):  '年月沖 — 早年與父母衝突，童年動盪，事業基礎不穩',
    frozenset({'year', 'day'}):    '年日沖 — 核心身份衝突，人生大起大落，命運不穩定',
    frozenset({'year', 'hour'}):   '年時沖 — 與子女後代有衝突，晚年動盪',
    frozenset({'month', 'day'}):   '月日沖 — 內在矛盾，情緒健康問題，自我矛盾',
    frozenset({'month', 'hour'}):  '月時沖 — 工作環境摩擦，日常生活衝突',
    frozenset({'day', 'hour'}):    '日時沖 — 自我與慾望衝突，健康惡化，家庭摩擦',
}

# ============================================================
# All pillar pair/triple combinations for enumeration
# ============================================================

ALL_PILLAR_PAIRS: List[Tuple[str, str]] = [
    ('year', 'month'), ('year', 'day'), ('year', 'hour'),
    ('month', 'day'), ('month', 'hour'), ('day', 'hour'),
]

ALL_PILLAR_TRIPLES: List[Tuple[str, str, str]] = [
    ('year', 'month', 'day'),
    ('year', 'month', 'hour'),
    ('year', 'day', 'hour'),
    ('month', 'day', 'hour'),
]


# ============================================================
# Main Analysis Functions
# ============================================================

def find_six_harmonies(pillars: Dict[str, Dict]) -> List[Dict]:
    """Find all 六合 (Six Harmonies) between branch pairs."""
    results: List[Dict] = []
    for pillar_a, pillar_b in ALL_PILLAR_PAIRS:
        branch_a = pillars[pillar_a]['branch']
        branch_b = pillars[pillar_b]['branch']
        key = frozenset({branch_a, branch_b})

        if key in SIX_HARMONIES:
            info = SIX_HARMONIES[key]
            results.append({
                'type': 'six_harmony',
                'name': '六合',
                'branches': (branch_a, branch_b),
                'pillarA': pillar_a,
                'pillarB': pillar_b,
                'resultElement': info['element'],
                'score': info['score'],
                'effect': 'positive',
                'description': f'{branch_a}{branch_b}合化{info["element"]}',
            })
    return results


def find_six_clashes(pillars: Dict[str, Dict]) -> List[Dict]:
    """Find all 六沖 (Six Clashes) between branch pairs."""
    results: List[Dict] = []
    for pillar_a, pillar_b in ALL_PILLAR_PAIRS:
        branch_a = pillars[pillar_a]['branch']
        branch_b = pillars[pillar_b]['branch']
        key = frozenset({branch_a, branch_b})

        if key in SIX_CLASHES:
            info = SIX_CLASHES[key]
            pillar_key = frozenset({pillar_a, pillar_b})
            pillar_effect = CLASH_PILLAR_EFFECTS.get(pillar_key, '')

            results.append({
                'type': 'six_clash',
                'name': '六沖',
                'branches': (branch_a, branch_b),
                'pillarA': pillar_a,
                'pillarB': pillar_b,
                'elements': info['elements'],
                'severity': info['severity'],
                'effect': 'negative',
                'description': f'{branch_a}{branch_b}沖',
                'pillarEffect': pillar_effect,
            })
    return results


def find_triple_harmonies(pillars: Dict[str, Dict]) -> List[Dict]:
    """
    Find 三合 (Triple Harmony) and 半合 (Half Harmony) among branches.

    Checks all C(4,3)=4 triples for full 三合, then all pairs for 半合.
    """
    results: List[Dict] = []
    branch_set = {name: pillars[name]['branch'] for name in ['year', 'month', 'day', 'hour']}

    # Check full triples first
    found_full_triples: List[FrozenSet[str]] = []

    for triple_pillars in ALL_PILLAR_TRIPLES:
        triple_branches = frozenset({branch_set[p] for p in triple_pillars})
        # Need exactly 3 distinct branches for a valid triple
        if len(triple_branches) < 3:
            continue

        for harmony in TRIPLE_HARMONIES:
            if triple_branches == harmony['branches']:
                pillar_names = list(triple_pillars)
                results.append({
                    'type': 'triple_harmony',
                    'name': '三合',
                    'branches': harmony['order'],
                    'pillars': pillar_names,
                    'resultElement': harmony['element'],
                    'score': TRIPLE_HARMONY_FULL_SCORE,
                    'effect': 'positive',
                    'description': f'{"".join(harmony["order"])}三合{harmony["element"]}局',
                    'roles': harmony['roles'],
                })
                found_full_triples.append(harmony['branches'])

    # Check half harmonies (半合) — only if no full triple was found for that group
    for pillar_a, pillar_b in ALL_PILLAR_PAIRS:
        branch_a = branch_set[pillar_a]
        branch_b = branch_set[pillar_b]
        if branch_a == branch_b:
            continue

        pair = frozenset({branch_a, branch_b})

        for harmony in TRIPLE_HARMONIES:
            # Skip if this pair's full triple was already found
            if harmony['branches'] in found_full_triples:
                if pair.issubset(harmony['branches']):
                    continue

            if not pair.issubset(harmony['branches']):
                continue

            # Determine which two roles are present
            roles_present = {harmony['roles'][b] for b in pair}

            if {'長生', '帝旺'} == roles_present:
                # 前半合 (生旺 pair) — stronger
                score = HALF_HARMONY_SHENG_WANG
                half_type = '前半合'
            elif {'帝旺', '墓庫'} == roles_present:
                # 後半合 (旺墓 pair) — weaker
                score = HALF_HARMONY_WANG_MU
                half_type = '後半合'
            elif {'長生', '墓庫'} == roles_present:
                # 拱合 (long-range half) — not commonly scored, skip
                continue
            else:
                continue

            results.append({
                'type': 'half_harmony',
                'name': half_type,
                'branches': (branch_a, branch_b),
                'pillarA': pillar_a,
                'pillarB': pillar_b,
                'resultElement': harmony['element'],
                'score': score,
                'effect': 'positive',
                'description': f'{branch_a}{branch_b}{half_type}{harmony["element"]}局',
            })

    return results


def find_three_meetings(pillars: Dict[str, Dict]) -> List[Dict]:
    """Find 三會 (Triple Meeting / Seasonal) among branches."""
    results: List[Dict] = []
    branch_set = {name: pillars[name]['branch'] for name in ['year', 'month', 'day', 'hour']}

    for triple_pillars in ALL_PILLAR_TRIPLES:
        triple_branches = frozenset({branch_set[p] for p in triple_pillars})
        if len(triple_branches) < 3:
            continue

        if triple_branches in THREE_MEETINGS:
            info = THREE_MEETINGS[triple_branches]
            branches_sorted = sorted(triple_branches, key=lambda b: BRANCH_INDEX[b])
            pillar_names = list(triple_pillars)

            results.append({
                'type': 'three_meeting',
                'name': '三會',
                'branches': tuple(branches_sorted),
                'pillars': pillar_names,
                'season': info['season'],
                'resultElement': info['element'],
                'direction': info['direction'],
                'score': THREE_MEETING_SCORE,
                'effect': 'positive',
                'description': f'{"".join(branches_sorted)}三會{info["element"]}局（{info["season"]}季{info["direction"]}）',
            })

    return results


def find_three_punishments(pillars: Dict[str, Dict]) -> List[Dict]:
    """Find 三刑 (Triple Punishment) and partial punishments among branches.

    Note: This function detects BOTH full 三刑 AND partial 半刑 for
    comprehensive natal chart analysis. This differs from
    check_sanxing_with_pool() which requires ALL 3 branches for 3-branch
    groups — used in scoring/prediction where false positives are costly.
    """
    results: List[Dict] = []
    branch_set = {name: pillars[name]['branch'] for name in ['year', 'month', 'day', 'hour']}
    all_branches = frozenset(branch_set.values())

    for punishment in THREE_PUNISHMENTS:
        target = punishment['branches']

        # Check full triple punishment (for 3-branch types)
        if len(target) == 3 and target.issubset(all_branches):
            # Find which pillars contain these branches
            involved_pillars = []
            for pname, pbranch in branch_set.items():
                if pbranch in target:
                    involved_pillars.append(pname)

            results.append({
                'type': 'three_punishment',
                'name': f'三刑（{punishment["name"]}）',
                'branches': tuple(sorted(target, key=lambda b: BRANCH_INDEX[b])),
                'pillars': involved_pillars,
                'meaning': punishment['meaning'],
                'lifeEffect': punishment['lifeEffect'],
                'severity': punishment['severity'],
                'effect': 'negative',
                'full': True,
                'description': f'{punishment["name"]}（{"".join(sorted(target, key=lambda b: BRANCH_INDEX[b]))}）',
            })
        elif len(target) == 2:
            # 子卯 無禮之刑 — only 2 branches
            if target.issubset(all_branches):
                involved_pillars = []
                for pname, pbranch in branch_set.items():
                    if pbranch in target:
                        involved_pillars.append(pname)

                results.append({
                    'type': 'three_punishment',
                    'name': f'三刑（{punishment["name"]}）',
                    'branches': tuple(sorted(target, key=lambda b: BRANCH_INDEX[b])),
                    'pillars': involved_pillars,
                    'meaning': punishment['meaning'],
                    'lifeEffect': punishment['lifeEffect'],
                    'severity': punishment['severity'],
                    'effect': 'negative',
                    'full': True,
                    'description': f'{punishment["name"]}（{"".join(sorted(target, key=lambda b: BRANCH_INDEX[b]))}）',
                })
        else:
            # Check partial punishment (2 of 3)
            for partial in punishment.get('partials', []):
                if partial.issubset(all_branches):
                    # Don't report partial if full was already found
                    if target.issubset(all_branches):
                        continue

                    involved_pillars = []
                    for pname, pbranch in branch_set.items():
                        if pbranch in partial:
                            involved_pillars.append(pname)

                    branches_sorted = sorted(partial, key=lambda b: BRANCH_INDEX[b])
                    results.append({
                        'type': 'partial_punishment',
                        'name': f'半刑（{punishment["name"]}）',
                        'branches': tuple(branches_sorted),
                        'pillars': involved_pillars,
                        'meaning': punishment['meaning'],
                        'lifeEffect': punishment['lifeEffect'],
                        'severity': round(punishment['severity'] * 0.6),
                        'effect': 'negative',
                        'full': False,
                        'description': f'{"".join(branches_sorted)}半刑',
                    })

    # Check 自刑 (Self-Punishment)
    branch_counts: Dict[str, List[str]] = {}
    for pname, pbranch in branch_set.items():
        branch_counts.setdefault(pbranch, []).append(pname)

    for branch, pillar_list in branch_counts.items():
        if branch in SELF_PUNISHMENT_BRANCHES and len(pillar_list) >= 2:
            results.append({
                'type': 'self_punishment',
                'name': '自刑',
                'branches': (branch, branch),
                'pillars': pillar_list,
                'meaning': '自我矛盾、自我傷害傾向',
                'lifeEffect': '內心衝突、自我破壞行為',
                'severity': 60,
                'effect': 'negative',
                'full': True,
                'description': f'{branch}{branch}自刑',
            })

    return results


def find_six_harms(pillars: Dict[str, Dict]) -> List[Dict]:
    """Find all 六害 (Six Harms) between branch pairs."""
    results: List[Dict] = []
    for pillar_a, pillar_b in ALL_PILLAR_PAIRS:
        branch_a = pillars[pillar_a]['branch']
        branch_b = pillars[pillar_b]['branch']
        key = frozenset({branch_a, branch_b})

        if key in SIX_HARMS:
            info = SIX_HARMS[key]
            results.append({
                'type': 'six_harm',
                'name': '六害',
                'branches': (branch_a, branch_b),
                'pillarA': pillar_a,
                'pillarB': pillar_b,
                'severity': info['severity'],
                'effect': 'negative',
                'description': f'{branch_a}{branch_b}害（{info["description"]}）',
            })
    return results


def find_six_breaks(pillars: Dict[str, Dict]) -> List[Dict]:
    """Find all 六破 (Six Breaks) between branch pairs."""
    results: List[Dict] = []
    for pillar_a, pillar_b in ALL_PILLAR_PAIRS:
        branch_a = pillars[pillar_a]['branch']
        branch_b = pillars[pillar_b]['branch']
        key = frozenset({branch_a, branch_b})

        if key in SIX_BREAKS:
            info = SIX_BREAKS[key]
            results.append({
                'type': 'six_break',
                'name': '六破',
                'branches': (branch_a, branch_b),
                'pillarA': pillar_a,
                'pillarB': pillar_b,
                'severity': info['severity'],
                'effect': 'negative',
                'description': f'{branch_a}{branch_b}破',
            })
    return results


# ============================================================
# Complete Branch Relationship Analysis
# ============================================================

def analyze_branch_relationships(pillars: Dict[str, Dict]) -> Dict:
    """
    Complete branch relationship analysis for a Bazi chart.

    Finds all 7 types of relationships, resolves interactions,
    and produces a scored summary.

    Args:
        pillars: Four pillars dict with 'year', 'month', 'day', 'hour' keys,
                 each containing at least {'stem': str, 'branch': str}

    Returns:
        Dict with:
          - harmonies: 六合 results
          - clashes: 六沖 results
          - tripleHarmonies: 三合 + 半合 results
          - threeMeetings: 三會 results
          - punishments: 三刑 + 自刑 results
          - harms: 六害 results
          - breaks: 六破 results
          - interactions: resolved interaction effects
          - positiveScore: total positive relationship score
          - negativeScore: total negative relationship score (absolute value)
          - netScore: positive - negative
          - summary: text summary
    """
    harmonies = find_six_harmonies(pillars)
    clashes = find_six_clashes(pillars)
    triple_harmonies = find_triple_harmonies(pillars)
    three_meetings = find_three_meetings(pillars)
    punishments = find_three_punishments(pillars)
    harms = find_six_harms(pillars)
    breaks = find_six_breaks(pillars)

    # Resolve interactions
    interactions = _resolve_interactions(harmonies, clashes, punishments)

    # Calculate scores
    positive_score = (
        sum(h.get('score', 0) for h in harmonies)
        + sum(t.get('score', 0) for t in triple_harmonies)
        + sum(m.get('score', 0) for m in three_meetings)
    )
    negative_score = (
        sum(c.get('severity', 0) for c in clashes)
        + sum(p.get('severity', 0) for p in punishments)
        + sum(h.get('severity', 0) for h in harms)
        + sum(b.get('severity', 0) for b in breaks)
    )

    # Apply interaction adjustments
    for interaction in interactions:
        if interaction['effect'] == 'clash_reduced_50pct':
            negative_score = round(negative_score * 0.75)  # Partial reduction

    # Build summary
    summary_parts: List[str] = []
    if three_meetings:
        for m in three_meetings:
            summary_parts.append(m['description'])
    if triple_harmonies:
        for t in triple_harmonies:
            summary_parts.append(t['description'])
    if harmonies:
        for h in harmonies:
            summary_parts.append(h['description'])
    if clashes:
        for c in clashes:
            summary_parts.append(c['description'])
    if punishments:
        for p in punishments:
            summary_parts.append(p['description'])
    if harms:
        for h in harms:
            summary_parts.append(h['description'])
    if breaks:
        for b in breaks:
            summary_parts.append(b['description'])

    return {
        'harmonies': harmonies,
        'clashes': clashes,
        'tripleHarmonies': triple_harmonies,
        'threeMeetings': three_meetings,
        'punishments': punishments,
        'harms': harms,
        'breaks': breaks,
        'interactions': interactions,
        'positiveScore': positive_score,
        'negativeScore': negative_score,
        'netScore': positive_score - negative_score,
        'summary': '；'.join(summary_parts) if summary_parts else '地支無特殊關係',
    }


# ============================================================
# Interaction Resolution
# ============================================================

def _resolve_interactions(
    harmonies: List[Dict],
    clashes: List[Dict],
    punishments: List[Dict],
) -> List[Dict]:
    """
    Resolve interactions between positive and negative relationships.

    Rules:
      - 六合 can dissolve 六沖 by ~50% when they share a branch (合解沖)
      - 三刑 CANNOT be dissolved by any 合 (persists always)
      - 三合/三會 suppresses clashes involving those branches by 50-70%
    """
    interactions: List[Dict] = []

    # Build sets of branches involved in harmonies
    harmony_branches: Set[str] = set()
    for h in harmonies:
        harmony_branches.add(h['branches'][0])
        harmony_branches.add(h['branches'][1])

    # Check if any clash branch is also in a harmony
    for clash in clashes:
        clash_a, clash_b = clash['branches']
        if clash_a in harmony_branches or clash_b in harmony_branches:
            interactions.append({
                'type': 'harmony_dissolves_clash',
                'clashBranches': (clash_a, clash_b),
                'description': f'{clash_a}{clash_b}沖受六合牽制，衝突減緩',
                'effect': 'clash_reduced_50pct',
            })

    # Note: punishments are NOT dissolved by harmonies
    # This is intentional — 三刑 persists regardless of other relationships

    return interactions


# ============================================================
# Phase 12d Pattern 2c — 三合/半合 DM-element credit
# ============================================================

def compute_sanhe_dm_credit(
    pillars: Dict,
    dm_element: str,
) -> Tuple[float, str]:
    """
    Compute extra 得地 credit for DM from 三合/半合 formed-element matches.

    Returns (credit_score, kind) where kind ∈
      {'三合', '旺地半合', '墓地半合', 'none'}.
    Credit is in V2 dedi points; caller adds to dedi respecting the cap.

    Rules (Phase A doctrine verified):
      1. Formed-element must equal DM element. Else (0, 'none').
      2. Active 沖 on 旺神 branch nullifies credit (合而被沖則散).
      3. Branches whose 本氣 element already equals DM element are
         excluded — they're already credited via standard `dedi`.
      4. Per-branch contribution = SAN_HE_DEDI_PER_BRANCH × multiplier.

    Source: 《滴天髓·地支》, 《淵海子平·地支三合》, Phase A verification.
    """
    if dm_element not in SAN_HE_TRINITIES:
        return (0.0, 'none')

    wang, sheng, mu = SAN_HE_TRINITIES[dm_element]
    natal_branches = [pillars[p]['branch'] for p in
                      ('year', 'month', 'day', 'hour')]
    has_wang = wang in natal_branches
    has_sheng = sheng in natal_branches
    has_mu = mu in natal_branches

    # 沖 disrupts 旺神 → credit nullified
    wang_clash = CLASH_LOOKUP.get(wang)
    if has_wang and wang_clash and wang_clash in natal_branches:
        return (0.0, 'none')

    count = sum([has_wang, has_sheng, has_mu])
    if count == 3:
        multiplier, kind = SAN_HE_FULL_MULTIPLIER, '三合'
    elif count == 2 and has_wang:
        multiplier, kind = BAN_HE_WANG_MULTIPLIER, '旺地半合'
    elif count == 2 and has_sheng and has_mu:
        multiplier, kind = BAN_HE_MU_MULTIPLIER, '墓地半合'
    else:
        return (0.0, 'none')

    # Element-vs-element double-count guard (S7.4 fix from v2 review):
    # branches whose 本氣 element equals DM element are already credited
    # via standard `dedi` — exclude from the trinity bonus.
    new_credit_branches: List[str] = []
    for b in (wang, sheng, mu):
        if b not in natal_branches:
            continue
        benqi_stems = HIDDEN_STEMS.get(b, [])
        if not benqi_stems:
            continue
        benqi_element = STEM_ELEMENT.get(benqi_stems[0], '')
        if benqi_element != dm_element:
            new_credit_branches.append(b)

    base_credit = SAN_HE_DEDI_PER_BRANCH * len(new_credit_branches) * multiplier
    return (round(base_credit, 1), kind)


# ============================================================
# Phase 1.5 Option 2.5 refinement — 半合化局 月令 condition check
# ============================================================
#
# Per Sub-Agent C (Phase A research integrator, 2026-05-25):
# 半合化局 (half-combination forms qi) requires TWO conditions to fully
# convert the branch's 中氣 into the target element:
#   1. (day_branch, month_branch) ∈ SANHE_HALF_PAIRS for target_element
#   2. month_branch is in target_element's seasonal window (月令 condition)
#
# Without #2, the 半合 is only 「拱合」 (latent gather), NOT full 化局 —
# the day_branch's 中氣 retains its independent 五行 role.
#
# Used by `xishen_zhongqi_dissolves_taboo_stem` rescue rule in
# `daily_enhanced.py::_apply_per_day_signal_adjustments` (Phase 1.5 Option 2.5).
# Without this guard, Roger 2026-05-18 fires correctly (月令=巳 NOT 水季 → 半合
# fails → 乙 中氣 化忌神 path intact); but charts with 申辰 day in 子月 would
# mis-fire (月令=子 IS 水季 → 半合 forms 水局 → 乙 absorbed → no rescue).
#
# Source: 渊海子平·地支三合 + 算准网 / 八字算命網 modern consensus.
#
# Element-to-season mapping (per 五行旺相休囚死 table):
#   寅卯辰 = 春 = 木 季
#   巳午未 = 夏 = 火 季
#   申酉戌 = 秋 = 金 季
#   亥子丑 = 冬 = 水 季
# (Note: 土 has no dedicated season; 辰戌丑未 are 四季月 of each season.
#  For 半合化局 purposes, 土 局 isn't formed via 申子辰/亥卯未/寅午戌/巳酉丑
#  triples, so element ∈ {水,木,火,金} only.)

BRANCH_SEASON_ELEMENT: Dict[str, str] = {
    '寅': '木', '卯': '木', '辰': '木',
    '巳': '火', '午': '火', '未': '火',
    '申': '金', '酉': '金', '戌': '金',
    '亥': '水', '子': '水', '丑': '水',
}

# Precomputed 半合 pairs per target element (one element of the 三合 triple
# is missing). Each pair is unordered — direction doesn't matter for the
# 半合 detection.
SANHE_HALF_PAIRS: Dict[str, set] = {
    '水': {  # 申子辰 triple — missing 1 element
        ('申', '子'), ('子', '申'),    # 長生+帝旺 (前半合, stronger)
        ('子', '辰'), ('辰', '子'),    # 帝旺+墓庫 (後半合)
        ('申', '辰'), ('辰', '申'),    # 長生+墓庫 (拱合, weakest — but still 半合)
    },
    '木': {  # 亥卯未 triple
        ('亥', '卯'), ('卯', '亥'),
        ('卯', '未'), ('未', '卯'),
        ('亥', '未'), ('未', '亥'),
    },
    '火': {  # 寅午戌 triple
        ('寅', '午'), ('午', '寅'),
        ('午', '戌'), ('戌', '午'),
        ('寅', '戌'), ('戌', '寅'),
    },
    '金': {  # 巳酉丑 triple
        ('巳', '酉'), ('酉', '巳'),
        ('酉', '丑'), ('丑', '酉'),
        ('巳', '丑'), ('丑', '巳'),
    },
}


def banhe_forms_qi(day_branch: str, month_branch: str, target_element: str) -> bool:
    """Check if (day_branch, month_branch) forms a full 半合化局 of target_element.

    Returns True iff BOTH conditions hold:
      1. (day_branch, month_branch) ∈ SANHE_HALF_PAIRS[target_element]
      2. month_branch is in target_element's seasonal window
         (BRANCH_SEASON_ELEMENT[month_branch] == target_element)

    When True, the day_branch's 中氣 is absorbed into target_element flow —
    any 中氣-based rescue (e.g., xishen_zhongqi_dissolves_taboo_stem) is VOID.
    When False, 半合 is only 拱合 (latent gather), 中氣 retains independent role.

    Source: 渊海子平·地支三合 + 算准网 modern consensus on 「化局成功條件」.
    Phase A Sub-Agent C integrator verdict (2026-05-25); B mechanism.
    """
    if target_element not in SANHE_HALF_PAIRS:
        return False  # 土 has no 半合化局 (no 三合 triple targets 土)
    if (day_branch, month_branch) not in SANHE_HALF_PAIRS[target_element]:
        return False  # branches don't form a 半合 pair for this element
    return BRANCH_SEASON_ELEMENT.get(month_branch) == target_element
