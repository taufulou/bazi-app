"""
Timing Analysis (歲運分析) — Luck Period and Annual Star Interactions

Analyzes timing concepts critical for Annual readings:
  - 歲運並臨: Luck Period and Annual Star share identical stem+branch (once per 60 years)
  - 天剋地沖: Stem clash + branch clash between two pillars simultaneously
  - 伏吟: Same pillar repeating in luck period (stagnation)
  - 反吟: Clashing pillar appearing in luck period (reversal)

Natal chart interactions:
  - 大運 branch × natal branches: 六沖/六合/三合/六害 per luck period
  - 流年 branch × natal branches: same analysis per year
  - 流年 stem × natal stems: 天干合/天干沖 per year
  - 大運 × 流年 cross-interaction

Source: 《子平真詮·論行運》, 《淵海子平·卷三》
"""

from typing import Any, Dict, List, Optional

from .branch_relationships import (
    CLASH_LOOKUP,
    HARMONY_LOOKUP,
    SIX_CLASHES,
    SIX_HARMONIES,
    TRIPLE_HARMONIES,
)
from .constants import (
    BRANCH_INDEX,
    EARTHLY_BRANCHES,
    HEAVENLY_STEMS,
    STEM_ELEMENT,
    STEM_INDEX,
)
from .stem_combinations import (
    STEM_CLASH_LOOKUP,
    STEM_COMBINATION_LOOKUP,
)
from .ten_gods import derive_ten_god


# ============================================================
# Pillar domain labels (for natal interaction descriptions)
# ============================================================

PILLAR_DOMAIN_ZH: Dict[str, str] = {
    'year': '年柱（祖上/父母宮）',
    'month': '月柱（事業/兄弟宮）',
    'day': '日柱（配偶宮）',
    'hour': '時柱（子女宮）',
}


# ============================================================
# Six Harms lookup (from branch_relationships, duplicated for quick access)
# ============================================================

HARM_LOOKUP: Dict[str, str] = {
    '子': '未', '未': '子',
    '丑': '午', '午': '丑',
    '寅': '巳', '巳': '寅',
    '卯': '辰', '辰': '卯',
    '申': '亥', '亥': '申',
    '酉': '戌', '戌': '酉',
}


# ============================================================
# Core Timing Concepts
# ============================================================

def detect_sui_yun_bing_lin(
    luck_period: Dict,
    annual_star: Dict,
) -> Optional[Dict[str, Any]]:
    """
    Detect 歲運並臨 — Luck Period and Annual Star share identical stem+branch.
    This is a once-per-60-years event: a critical life turning point.

    Args:
        luck_period: Luck period dict with 'stem' and 'branch'
        annual_star: Annual star dict with 'stem' and 'branch'

    Returns:
        Finding dict if detected, else None
    """
    if luck_period['stem'] == annual_star['stem'] and \
       luck_period['branch'] == annual_star['branch']:
        return {
            'type': '歲運並臨',
            'severity': 'CRITICAL',
            'stem': luck_period['stem'],
            'branch': luck_period['branch'],
            'description': (
                f'歲運並臨（{luck_period["stem"]}{luck_period["branch"]}）'
                f'——重大人生轉折點，吉凶加倍放大'
            ),
        }
    return None


def detect_tian_ke_di_chong(
    stem_a: str, branch_a: str,
    stem_b: str, branch_b: str,
    context: str = '',
) -> Optional[Dict[str, Any]]:
    """
    Detect 天剋地沖 — Stem clash + branch clash occurring simultaneously.
    Extremely conflicting energy: obstacle, accident risk.

    Args:
        stem_a, branch_a: First pillar's stem and branch
        stem_b, branch_b: Second pillar's stem and branch
        context: Description of context (e.g., "大運vs流年", "流年vs日柱")

    Returns:
        Finding dict if detected, else None
    """
    # Check stem clash
    stem_clash = STEM_CLASH_LOOKUP.get(stem_a) == stem_b

    # Check branch clash
    branch_pair = frozenset({branch_a, branch_b})
    branch_clash = branch_pair in SIX_CLASHES

    if stem_clash and branch_clash:
        return {
            'type': '天剋地沖',
            'severity': 'VERY_HIGH',
            'stemA': stem_a,
            'branchA': branch_a,
            'stemB': stem_b,
            'branchB': branch_b,
            'context': context,
            'description': (
                f'天剋地沖（{stem_a}{branch_a} vs {stem_b}{branch_b}）'
                f'——天干相剋地支相沖，極端矛盾/障礙{f"，{context}" if context else ""}'
            ),
        }
    return None


def detect_fuyin(
    natal_pillars: Dict,
    period_stem: str,
    period_branch: str,
) -> List[Dict[str, Any]]:
    """
    Detect 伏吟 — Same stem+branch repeating in luck period or annual star.
    Indicates stagnation, repetition, "stuck" feeling.

    Args:
        natal_pillars: Four pillars dict
        period_stem: Luck period or annual stem
        period_branch: Luck period or annual branch

    Returns:
        List of fuyin findings (one per matching natal pillar)
    """
    findings: List[Dict[str, Any]] = []

    for pname in ['year', 'month', 'day', 'hour']:
        pillar = natal_pillars[pname]
        if pillar['stem'] == period_stem and pillar['branch'] == period_branch:
            findings.append({
                'type': '伏吟',
                'severity': 'HIGH',
                'pillar': pname,
                'stem': period_stem,
                'branch': period_branch,
                'description': (
                    f'伏吟{PILLAR_DOMAIN_ZH[pname]}'
                    f'（{period_stem}{period_branch}重複）'
                    f'——停滯、重複、「卡住」的感覺'
                ),
            })

    return findings


def detect_fanyin(
    natal_pillars: Dict,
    period_stem: str,
    period_branch: str,
) -> List[Dict[str, Any]]:
    """
    Detect 反吟 — Stem clash + branch clash between period and natal pillar.
    Indicates reversal, sudden change, breakup.

    Args:
        natal_pillars: Four pillars dict
        period_stem: Luck period or annual stem
        period_branch: Luck period or annual branch

    Returns:
        List of fanyin findings (one per matching natal pillar)
    """
    findings: List[Dict[str, Any]] = []

    for pname in ['year', 'month', 'day', 'hour']:
        pillar = natal_pillars[pname]
        result = detect_tian_ke_di_chong(
            period_stem, period_branch,
            pillar['stem'], pillar['branch'],
            context=f'反吟{PILLAR_DOMAIN_ZH[pname]}',
        )
        if result:
            findings.append({
                'type': '反吟',
                'severity': 'HIGH',
                'pillar': pname,
                'stem': period_stem,
                'branch': period_branch,
                'description': (
                    f'反吟{PILLAR_DOMAIN_ZH[pname]}'
                    f'（{period_stem}{period_branch} 沖 '
                    f'{pillar["stem"]}{pillar["branch"]}）'
                    f'——逆轉、突然變化、分手/損失'
                ),
            })

    return findings


# ============================================================
# Natal Interaction Analysis
# ============================================================

def analyze_branch_natal_interactions(
    period_branch: str,
    natal_pillars: Dict,
    day_master_stem: str,
) -> List[Dict[str, Any]]:
    """
    Check a period/annual branch against all 4 natal branches for relationships.

    Checks: 六沖, 六合, 三合 (partial), 六害.

    Args:
        period_branch: The LP or annual branch
        natal_pillars: Four pillars dict
        day_master_stem: Day Master stem (for Ten God context)

    Returns:
        List of interaction findings
    """
    interactions: List[Dict[str, Any]] = []

    for pname in ['year', 'month', 'day', 'hour']:
        natal_branch = natal_pillars[pname]['branch']
        pair = frozenset({period_branch, natal_branch})

        # 六沖
        if pair in SIX_CLASHES:
            clash_info = SIX_CLASHES[pair]
            interactions.append({
                'type': '六沖',
                'pillar': pname,
                'branches': [period_branch, natal_branch],
                'severity': clash_info['severity'],
                'description': (
                    f'{period_branch}{natal_branch}沖'
                    f'（{PILLAR_DOMAIN_ZH[pname]}受沖）'
                ),
            })

        # 六合
        if pair in SIX_HARMONIES:
            harmony_info = SIX_HARMONIES[pair]
            interactions.append({
                'type': '六合',
                'pillar': pname,
                'branches': [period_branch, natal_branch],
                'element': harmony_info['element'],
                'description': (
                    f'{period_branch}{natal_branch}合'
                    f'{harmony_info["element"]}'
                    f'（{PILLAR_DOMAIN_ZH[pname]}得合）'
                ),
            })

        # 六害
        harm_partner = HARM_LOOKUP.get(period_branch)
        if harm_partner == natal_branch:
            interactions.append({
                'type': '六害',
                'pillar': pname,
                'branches': [period_branch, natal_branch],
                'description': (
                    f'{period_branch}{natal_branch}害'
                    f'（{PILLAR_DOMAIN_ZH[pname]}受害）'
                ),
            })

    # Check for 三合 (partial or full)
    # Collect all natal branches + period branch, check if any triple is formed
    natal_branches = [natal_pillars[p]['branch'] for p in ['year', 'month', 'day', 'hour']]
    all_branches = natal_branches + [period_branch]
    for triple in TRIPLE_HARMONIES:
        triple_set = triple['branches']
        # Count how many of the triple's branches are present
        matches = [b for b in all_branches if b in triple_set]
        # Full triple: all 3 present, and period_branch is one of them
        if len(set(matches)) >= 3 and period_branch in triple_set:
            interactions.append({
                'type': '三合',
                'element': triple['element'],
                'branches': list(triple['order']),
                'description': (
                    f'{"".join(triple["order"])}三合{triple["element"]}局'
                    f'（{triple["element"]}力量啟動）'
                ),
            })

    return interactions


def analyze_stem_natal_interactions(
    period_stem: str,
    natal_pillars: Dict,
    day_master_stem: str,
) -> List[Dict[str, Any]]:
    """
    Check an annual/LP stem against all natal stems for 天干合 and 天干沖.

    Args:
        period_stem: The LP or annual heavenly stem
        natal_pillars: Four pillars dict
        day_master_stem: Day Master stem

    Returns:
        List of stem interaction findings
    """
    interactions: List[Dict[str, Any]] = []

    for pname in ['year', 'month', 'day', 'hour']:
        natal_stem = natal_pillars[pname]['stem']

        # 天干合
        combo_info = STEM_COMBINATION_LOOKUP.get(period_stem)
        if combo_info and combo_info[0] == natal_stem:
            partner, element, name = combo_info
            is_dm = (pname == 'day')
            interactions.append({
                'type': '天干合',
                'pillar': pname,
                'stems': [period_stem, natal_stem],
                'element': element,
                'name': name,
                'dayMasterInvolved': is_dm,
                'description': (
                    f'{period_stem}{natal_stem}合（{name}→{element}）'
                    f'{"——日主被合，精力受牽制" if is_dm else f"——{PILLAR_DOMAIN_ZH[pname]}受合"}'
                ),
            })

        # 天干沖
        clash_partner = STEM_CLASH_LOOKUP.get(period_stem)
        if clash_partner == natal_stem:
            period_ten_god = derive_ten_god(day_master_stem, period_stem)
            interactions.append({
                'type': '天干沖',
                'pillar': pname,
                'stems': [period_stem, natal_stem],
                'tenGod': period_ten_god,
                'description': (
                    f'{period_stem}{natal_stem}沖'
                    f'（{PILLAR_DOMAIN_ZH[pname]}天干受沖）'
                ),
            })

    return interactions


# ============================================================
# Luck Period × Annual Star Cross-Interaction
# ============================================================

def analyze_lp_annual_interaction(
    lp_stem: str, lp_branch: str,
    annual_stem: str, annual_branch: str,
) -> List[Dict[str, Any]]:
    """
    Analyze interaction between a Luck Period and an Annual Star.

    Checks:
      - 歲運並臨 (identical)
      - 天剋地沖 (full clash)
      - Branch 六沖 (反吟 year within decade)
      - Branch 六合 (harmonious year)

    Args:
        lp_stem, lp_branch: Luck Period stem and branch
        annual_stem, annual_branch: Annual Star stem and branch

    Returns:
        List of LP×Annual interaction findings
    """
    interactions: List[Dict[str, Any]] = []

    # 歲運並臨
    sybl = detect_sui_yun_bing_lin(
        {'stem': lp_stem, 'branch': lp_branch},
        {'stem': annual_stem, 'branch': annual_branch},
    )
    if sybl:
        interactions.append(sybl)
        return interactions  # 歲運並臨 is the dominant finding

    # 天剋地沖
    tkdc = detect_tian_ke_di_chong(
        lp_stem, lp_branch,
        annual_stem, annual_branch,
        context='大運vs流年',
    )
    if tkdc:
        interactions.append(tkdc)

    # Branch 六沖 (without stem clash = just branch tension)
    branch_pair = frozenset({lp_branch, annual_branch})
    if branch_pair in SIX_CLASHES and not tkdc:
        clash_info = SIX_CLASHES[branch_pair]
        interactions.append({
            'type': '大運流年地支沖',
            'severity': 'MEDIUM',
            'branches': [lp_branch, annual_branch],
            'description': (
                f'大運{lp_branch}沖流年{annual_branch}'
                f'——該年度十年運基調受衝擊'
            ),
        })

    # Branch 六合
    if branch_pair in SIX_HARMONIES:
        harmony_info = SIX_HARMONIES[branch_pair]
        interactions.append({
            'type': '大運流年地支合',
            'severity': 'POSITIVE',
            'branches': [lp_branch, annual_branch],
            'element': harmony_info['element'],
            'description': (
                f'大運{lp_branch}合流年{annual_branch}'
                f'（{harmony_info["element"]}）——該年和諧順利'
            ),
        })

    return interactions


# ============================================================
# Full Timing Analysis — integrates all concepts
# ============================================================

def analyze_timing_for_luck_periods(
    natal_pillars: Dict,
    luck_periods: List[Dict],
    day_master_stem: str,
) -> List[Dict]:
    """
    Add natal interaction data to each luck period.

    For each luck period, checks its branch/stem against all natal pillar
    branches/stems for 六沖/六合/三合/六害/伏吟/反吟.

    Args:
        natal_pillars: Four pillars dict
        luck_periods: List of luck period dicts from calculate_luck_periods()
        day_master_stem: Day Master stem

    Returns:
        Updated luck periods with 'natalInteractions' field added to each
    """
    for lp in luck_periods:
        interactions: List[Dict[str, Any]] = []

        # Branch × natal interactions
        branch_ints = analyze_branch_natal_interactions(
            lp['branch'], natal_pillars, day_master_stem,
        )
        interactions.extend(branch_ints)

        # Stem × natal interactions
        stem_ints = analyze_stem_natal_interactions(
            lp['stem'], natal_pillars, day_master_stem,
        )
        interactions.extend(stem_ints)

        # 伏吟
        fuyin = detect_fuyin(natal_pillars, lp['stem'], lp['branch'])
        interactions.extend(fuyin)

        # 反吟
        fanyin = detect_fanyin(natal_pillars, lp['stem'], lp['branch'])
        interactions.extend(fanyin)

        lp['natalInteractions'] = interactions

    return luck_periods


def analyze_timing_for_annual_stars(
    natal_pillars: Dict,
    annual_stars: List[Dict],
    luck_periods: List[Dict],
    day_master_stem: str,
) -> List[Dict]:
    """
    Add natal interaction data to each annual star.

    For each year, checks branch/stem against natal chart AND against
    the active luck period for that year.

    Args:
        natal_pillars: Four pillars dict
        annual_stars: List of annual star dicts from calculate_annual_stars()
        luck_periods: Luck periods (to find active period for LP×annual cross-check)
        day_master_stem: Day Master stem

    Returns:
        Updated annual stars with 'natalInteractions' and 'lpInteraction' fields
    """
    for star in annual_stars:
        interactions: List[Dict[str, Any]] = []

        # Branch × natal interactions
        branch_ints = analyze_branch_natal_interactions(
            star['branch'], natal_pillars, day_master_stem,
        )
        interactions.extend(branch_ints)

        # Stem × natal interactions
        stem_ints = analyze_stem_natal_interactions(
            star['stem'], natal_pillars, day_master_stem,
        )
        interactions.extend(stem_ints)

        # 伏吟
        fuyin = detect_fuyin(natal_pillars, star['stem'], star['branch'])
        interactions.extend(fuyin)

        # 反吟
        fanyin = detect_fanyin(natal_pillars, star['stem'], star['branch'])
        interactions.extend(fanyin)

        star['natalInteractions'] = interactions

        # LP × Annual cross-interaction
        star['lpInteraction'] = []
        for lp in luck_periods:
            if lp['startYear'] <= star['year'] <= lp['endYear']:
                lp_ints = analyze_lp_annual_interaction(
                    lp['stem'], lp['branch'],
                    star['stem'], star['branch'],
                )
                star['lpInteraction'] = lp_ints
                break

    return annual_stars


def generate_timing_insights(
    natal_pillars: Dict,
    luck_periods: List[Dict],
    annual_stars: List[Dict],
    day_master_stem: str,
    target_year: int,
) -> Dict[str, Any]:
    """
    Generate timing insights for the pre-analysis layer.

    Produces a summary of significant timing events for the current
    luck period and target year.

    Args:
        natal_pillars: Four pillars dict
        luck_periods: Luck periods (already enriched with natalInteractions)
        annual_stars: Annual stars (already enriched with natalInteractions)
        day_master_stem: Day Master stem
        target_year: Target year for analysis

    Returns:
        Timing insights dict for inclusion in pre-analysis
    """
    insights: Dict[str, Any] = {
        'currentPeriod': None,
        'currentYear': None,
        'significantFindings': [],
    }

    # Find current luck period
    for lp in luck_periods:
        if lp.get('isCurrent'):
            period_info: Dict[str, Any] = {
                'stem': lp['stem'],
                'branch': lp['branch'],
                'tenGod': lp['tenGod'],
                'startAge': lp['startAge'],
                'endAge': lp['endAge'],
                'startYear': lp['startYear'],
                'endYear': lp['endYear'],
            }
            natal_ints = lp.get('natalInteractions', [])
            if natal_ints:
                period_info['interactions'] = natal_ints
            insights['currentPeriod'] = period_info
            break

    # Find target year
    for star in annual_stars:
        if star['year'] == target_year:
            year_info: Dict[str, Any] = {
                'year': star['year'],
                'stem': star['stem'],
                'branch': star['branch'],
                'tenGod': star['tenGod'],
            }
            natal_ints = star.get('natalInteractions', [])
            if natal_ints:
                year_info['interactions'] = natal_ints
            lp_ints = star.get('lpInteraction', [])
            if lp_ints:
                year_info['lpInteraction'] = lp_ints
            insights['currentYear'] = year_info

            # Collect significant findings
            for interaction in natal_ints:
                stype = interaction.get('type', '')
                if stype in ('六沖', '天干沖', '伏吟', '反吟'):
                    insights['significantFindings'].append({
                        'type': stype,
                        'description': interaction.get('description', ''),
                        'severity': interaction.get('severity', 'MEDIUM'),
                    })
            for interaction in lp_ints:
                stype = interaction.get('type', '')
                if stype in ('歲運並臨', '天剋地沖'):
                    insights['significantFindings'].append({
                        'type': stype,
                        'description': interaction.get('description', ''),
                        'severity': interaction.get('severity', 'CRITICAL'),
                    })
            break

    return insights
