"""
Bazi Compatibility (合盤) Calculator

Compares two Bazi charts for relationship or business compatibility.

Key compatibility factors:
1. Day Master element interaction (相生/相剋)
2. Day Branch relationship (六合/六沖/三合/相害)
3. Five Elements balance between two charts
4. Ten Gods complementarity
"""

from typing import Dict, List, Tuple

from .constants import (
    BRANCH_INDEX,
    ELEMENT_OVERCOMES,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    FIVE_ELEMENTS,
    STEM_ELEMENT,
    STEM_YINYANG,
)


# Six Harmonies (六合) — branches that combine
SIX_HARMONIES: Dict[str, str] = {
    '子': '丑', '丑': '子',
    '寅': '亥', '亥': '寅',
    '卯': '戌', '戌': '卯',
    '辰': '酉', '酉': '辰',
    '巳': '申', '申': '巳',
    '午': '未', '未': '午',
}

# Six Clashes (六沖) — branches that clash
SIX_CLASHES: Dict[str, str] = {
    '子': '午', '午': '子',
    '丑': '未', '未': '丑',
    '寅': '申', '申': '寅',
    '卯': '酉', '酉': '卯',
    '辰': '戌', '戌': '辰',
    '巳': '亥', '亥': '巳',
}

# Three Harmonies (三合) — groups of three branches that form element alliances
THREE_HARMONIES: List[Tuple[str, str, str, str]] = [
    ('申', '子', '辰', '水'),  # Metal frame → Water
    ('亥', '卯', '未', '木'),  # Water frame → Wood
    ('寅', '午', '戌', '火'),  # Wood frame → Fire
    ('巳', '酉', '丑', '金'),  # Fire frame → Metal
]

# Six Harms (六害) — branches that harm each other
SIX_HARMS: Dict[str, str] = {
    '子': '未', '未': '子',
    '丑': '午', '午': '丑',
    '寅': '巳', '巳': '寅',
    '卯': '辰', '辰': '卯',
    '申': '亥', '亥': '申',
    '酉': '戌', '戌': '酉',
}

# Stem Combinations (天干合) — stems that combine
STEM_COMBINATIONS: Dict[str, Tuple[str, str]] = {
    '甲': ('己', '土'),
    '己': ('甲', '土'),
    '乙': ('庚', '金'),
    '庚': ('乙', '金'),
    '丙': ('辛', '水'),
    '辛': ('丙', '水'),
    '丁': ('壬', '木'),
    '壬': ('丁', '木'),
    '戊': ('癸', '火'),
    '癸': ('戊', '火'),
}


def analyze_element_relationship(element_a: str, element_b: str) -> Dict:
    """
    Analyze the Five Element relationship between two elements.

    Returns:
        Dict with relationship type and description
    """
    if element_a == element_b:
        return {'type': 'same', 'description': '比和', 'harmony': 70}
    elif ELEMENT_PRODUCES.get(element_a) == element_b:
        return {'type': 'a_produces_b', 'description': f'{element_a}生{element_b}', 'harmony': 85}
    elif ELEMENT_PRODUCES.get(element_b) == element_a:
        return {'type': 'b_produces_a', 'description': f'{element_b}生{element_a}', 'harmony': 85}
    elif ELEMENT_OVERCOMES.get(element_a) == element_b:
        return {'type': 'a_overcomes_b', 'description': f'{element_a}剋{element_b}', 'harmony': 40}
    elif ELEMENT_OVERCOMES.get(element_b) == element_a:
        return {'type': 'b_overcomes_a', 'description': f'{element_b}剋{element_a}', 'harmony': 40}
    else:
        return {'type': 'neutral', 'description': '中性', 'harmony': 60}


def analyze_branch_relationship(branch_a: str, branch_b: str) -> List[Dict]:
    """
    Analyze the relationship between two Earthly Branches.

    Checks for: Six Harmonies, Six Clashes, Six Harms

    Returns:
        List of relationship dicts found
    """
    relationships: List[Dict] = []

    # Six Harmonies (六合)
    if SIX_HARMONIES.get(branch_a) == branch_b:
        relationships.append({
            'type': 'six_harmony',
            'name': '六合',
            'description': f'{branch_a}{branch_b}合',
            'effect': 'positive',
            'score': 90,
        })

    # Six Clashes (六沖)
    if SIX_CLASHES.get(branch_a) == branch_b:
        relationships.append({
            'type': 'six_clash',
            'name': '六沖',
            'description': f'{branch_a}{branch_b}沖',
            'effect': 'negative',
            'score': 20,
        })

    # Six Harms (六害)
    if SIX_HARMS.get(branch_a) == branch_b:
        relationships.append({
            'type': 'six_harm',
            'name': '六害',
            'description': f'{branch_a}{branch_b}害',
            'effect': 'negative',
            'score': 30,
        })

    return relationships


def analyze_stem_combination(stem_a: str, stem_b: str) -> Dict:
    """Check if two stems form a combination (天干合)."""
    combo = STEM_COMBINATIONS.get(stem_a)
    if combo and combo[0] == stem_b:
        return {
            'hasCombination': True,
            'name': '天干合',
            'description': f'{stem_a}{stem_b}合化{combo[1]}',
            'resultElement': combo[1],
        }
    return {'hasCombination': False}


def calculate_compatibility(
    chart_a: Dict,
    chart_b: Dict,
    comparison_type: str = 'romance',
) -> Dict:
    """
    Calculate compatibility between two Bazi charts.

    Args:
        chart_a: Complete Bazi calculation result for person A
        chart_b: Complete Bazi calculation result for person B
        comparison_type: 'romance', 'business', or 'friendship'

    Returns:
        Compatibility analysis dictionary
    """
    pillars_a = chart_a['fourPillars']
    pillars_b = chart_b['fourPillars']

    day_stem_a = chart_a['dayMasterStem']
    day_stem_b = chart_b['dayMasterStem']
    day_branch_a = pillars_a['day']['branch']
    day_branch_b = pillars_b['day']['branch']

    # 1. Day Master Element Interaction
    element_a = STEM_ELEMENT[day_stem_a]
    element_b = STEM_ELEMENT[day_stem_b]
    day_master_interaction = analyze_element_relationship(element_a, element_b)

    # 2. Day Stem Combination (天干合)
    stem_combo = analyze_stem_combination(day_stem_a, day_stem_b)

    # 3. Day Branch Relationship
    day_branch_rel = analyze_branch_relationship(day_branch_a, day_branch_b)

    # 4. Check all pillar combinations for harmonies/clashes
    all_branch_relationships: List[Dict] = []
    for pillar_name_a in ['year', 'month', 'day', 'hour']:
        for pillar_name_b in ['year', 'month', 'day', 'hour']:
            branch_a = pillars_a[pillar_name_a]['branch']
            branch_b = pillars_b[pillar_name_b]['branch']
            rels = analyze_branch_relationship(branch_a, branch_b)
            for rel in rels:
                rel['pillarA'] = pillar_name_a
                rel['pillarB'] = pillar_name_b
                all_branch_relationships.append(rel)

    # 5. Five Elements complementarity
    # Check if the two charts' element imbalances complement each other
    balance_a = chart_a.get('fiveElementsBalance', {})
    balance_b = chart_b.get('fiveElementsBalance', {})

    element_complementarity = {}
    complementarity_score = 0
    for element in FIVE_ELEMENTS:
        val_a = balance_a.get(element, 20.0)
        val_b = balance_b.get(element, 20.0)
        avg = (val_a + val_b) / 2
        # Closer to 20% (balanced) is better
        deviation = abs(avg - 20.0)
        element_complementarity[element] = {
            'personA': val_a,
            'personB': val_b,
            'combined': round(avg, 1),
            'deviation': round(deviation, 1),
        }
        # Score: less deviation = better complementarity
        complementarity_score += max(0, 20 - deviation)

    # Normalize complementarity score to 0-100
    complementarity_score = round(complementarity_score / 100 * 100)

    # 6. Calculate overall compatibility score
    # Weighted average of different factors
    scores: List[Tuple[float, float]] = []

    # Day Master interaction (weight: 25%)
    scores.append((day_master_interaction['harmony'], 0.25))

    # Day Stem combination bonus (weight: 15%)
    if stem_combo['hasCombination']:
        scores.append((95, 0.15))
    else:
        scores.append((50, 0.15))

    # Day Branch relationship (weight: 20%)
    if day_branch_rel:
        avg_branch_score = sum(r['score'] for r in day_branch_rel) / len(day_branch_rel)
        scores.append((avg_branch_score, 0.20))
    else:
        scores.append((60, 0.20))

    # All branch relationships (weight: 20%)
    if all_branch_relationships:
        positive_count = sum(1 for r in all_branch_relationships if r['effect'] == 'positive')
        negative_count = sum(1 for r in all_branch_relationships if r['effect'] == 'negative')
        total = len(all_branch_relationships)
        branch_score = (positive_count - negative_count * 0.5) / total * 100 if total > 0 else 60
        branch_score = max(0, min(100, branch_score))
        scores.append((branch_score, 0.20))
    else:
        scores.append((60, 0.20))

    # Element complementarity (weight: 20%)
    scores.append((complementarity_score, 0.20))

    # Calculate weighted score
    overall_score = round(sum(score * weight for score, weight in scores))
    overall_score = max(0, min(100, overall_score))

    # Determine compatibility level
    if overall_score >= 85:
        level = 'excellent'
        level_zh = '極佳'
    elif overall_score >= 70:
        level = 'good'
        level_zh = '良好'
    elif overall_score >= 55:
        level = 'average'
        level_zh = '普通'
    elif overall_score >= 40:
        level = 'challenging'
        level_zh = '需注意'
    else:
        level = 'difficult'
        level_zh = '困難'

    # Collect strengths and challenges
    strengths: List[str] = []
    challenges: List[str] = []

    if stem_combo['hasCombination']:
        strengths.append(f"日主{stem_combo['description']}，天作之合")
    if day_master_interaction['harmony'] >= 80:
        strengths.append(f"日主{day_master_interaction['description']}，五行相生")
    elif day_master_interaction['harmony'] <= 45:
        challenges.append(f"日主{day_master_interaction['description']}，五行相剋")

    for rel in day_branch_rel:
        if rel['effect'] == 'positive':
            strengths.append(f"日支{rel['description']}，關係和諧")
        else:
            challenges.append(f"日支{rel['description']}，需要磨合")

    # Count overall harmonies vs clashes
    harmony_count = sum(1 for r in all_branch_relationships if r['effect'] == 'positive')
    clash_count = sum(1 for r in all_branch_relationships if r['effect'] == 'negative')

    if harmony_count > clash_count:
        strengths.append(f"整體地支多合少沖（{harmony_count}合{clash_count}沖）")
    elif clash_count > harmony_count:
        challenges.append(f"整體地支沖多合少（{clash_count}沖{harmony_count}合）")

    return {
        'overallScore': overall_score,
        'level': level,
        'levelZh': level_zh,
        'dayMasterInteraction': day_master_interaction,
        'stemCombination': stem_combo,
        'dayBranchRelationships': day_branch_rel,
        'allBranchRelationships': all_branch_relationships,
        'elementComplementarity': element_complementarity,
        'complementarityScore': complementarity_score,
        'strengths': strengths,
        'challenges': challenges,
        'comparisonType': comparison_type,
    }
