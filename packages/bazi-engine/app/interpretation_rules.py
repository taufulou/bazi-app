"""
Bazi Pre-Analysis Layer — Main Orchestrator

Generates deterministic, rule-based interpretation findings from a Bazi chart.
This is Layer 2 of the three-layer architecture:
  Layer 1: Python Engine → raw chart data
  Layer 2: Pre-Analysis (this module) → deterministic rules
  Layer 3: AI Narration → compelling narrative from pre-analyzed results

Key components:
  - Ten God position rules (40 rules: 10 gods × 4 positions, gender-split)
  - 透干 (Tou Gan) analysis — hidden stems that appear as manifest stems
  - 從格 (Following Pattern) detection with 4 subtypes
  - 用神合絆 (Yong Shen locking) detection
  - 墓庫 (Tomb/Storage) analysis
  - Life domain mapping (career, love, health)
  - Conflict resolution layer
  - Day Master Strength V2 (3-factor scoring)
"""

from typing import Any, Dict, List, Optional, Set, Tuple

from .constants import (
    ELEMENT_OVERCOMES,
    ELEMENT_OVERCOME_BY,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    FIVE_ELEMENTS,
    HIDDEN_STEMS,
    HIDDEN_STEM_WEIGHTS,
    SEASON_STRENGTH,
    STEM_ELEMENT,
    STEM_YINYANG,
)
from .life_stages import get_life_stage
from .stem_combinations import (
    STEM_COMBINATION_LOOKUP,
    analyze_stem_relationships,
    find_stem_combinations,
)
from .branch_relationships import analyze_branch_relationships
from .ten_gods import derive_ten_god, get_prominent_ten_god


# ============================================================
# Reading Type → Domain Mapping
# ============================================================

READING_TYPE_DOMAINS: Dict[str, List[str]] = {
    'LIFETIME':        ['career', 'love', 'health', 'timing'],
    'ANNUAL':          ['career', 'love', 'health', 'timing'],
    'CAREER_FINANCE':  ['career', 'timing'],
    'LOVE':            ['love', 'timing'],
    'HEALTH':          ['health', 'timing'],
    'COMPATIBILITY':   ['love'],
}


# ============================================================
# Day Master Strength V2 — 3-Factor Scoring (0-100 scale)
# ============================================================

# 得令: Map SEASON_STRENGTH (旺相休囚死 1-5) → score (0-50 scale)
#
# IMPORTANT: Uses element vs season (SEASON_STRENGTH), NOT stem-specific Life Stage.
# Reason: Yin stems have reversed Life Stage cycles (e.g., 丁's 長生 is 酉, 死 is 寅),
# but seasonal element support follows the element, not the stem. A 丁 Fire DM born
# in Spring (寅月) is strong because Wood produces Fire (Fire is 相), even though
# 丁's individual Life Stage in 寅 is 死.
#
# Professional Bazi masters use 旺相休囚死 for "得令" assessment:
#   旺(5)=50, 相(4)=40, 休(3)=25, 囚(2)=12, 死(1)=0
# Source: 《子平真詮·論旺相休囚死》, confirmed by web research
SEASON_DELING_SCORE: Dict[int, int] = {
    5: 50,   # 旺 — element is in season (strongest)
    4: 40,   # 相 — element is produced by season
    3: 25,   # 休 — element produces the season (resting)
    2: 12,   # 囚 — element overcomes the season (suppressed)
    1: 0,    # 死 — element is overcome by the season (dead)
}

# Life Stage scoring kept for reference and personality/timing use
# (NOT used in strength calculation — see above)
LIFE_STAGE_DELING_SCORE: Dict[str, int] = {
    '帝旺': 50, '臨官': 42, '冠帶': 33, '長生': 25,
    '沐浴': 15, '養': 10, '胎': 8,
    '衰': 6, '病': 4, '墓': 3, '死': 2, '絕': 0,
}

# 得地 pillar weights — traditional: 月支 > 日支 > 時支 > 年支
# Per 《子平真詮》 and web research. Month=35% (strongest root),
# day=30%, hour=20%, year=15%.
DEDI_PILLAR_WEIGHTS: Dict[str, float] = {
    'month': 0.35, 'day': 0.30, 'hour': 0.20, 'year': 0.15,
}


def calculate_strength_score_v2(pillars: Dict, day_master_stem: str) -> Dict:
    """
    3-factor Day Master strength scoring (0-100 scale).

    Factors:
      - 得令 (50%): Life Stage of Day Master in month branch
      - 得地 (30%): 通根 root depth in branch hidden stems
      - 得勢 (20%): Supporting elements across stems + branch main qi

    Returns:
        Dict with score, classification, and factor breakdown
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    month_branch = pillars['month']['branch']
    producing_element = ELEMENT_PRODUCED_BY[dm_element]

    # Factor 1: 得令 (50% weight) — Seasonal element strength (旺相休囚死)
    # Uses SEASON_STRENGTH (element vs month branch) for consistent results
    # across Yang and Yin stems. Life Stage retained for informational output.
    life_stage = get_life_stage(day_master_stem, month_branch)
    season_score = SEASON_STRENGTH.get(dm_element, {}).get(month_branch, 3)
    deling = SEASON_DELING_SCORE.get(season_score, 12)

    # Factor 2: 得地 (30% weight) — 通根 root depth
    root_score = 0.0
    for pillar_name, weight in DEDI_PILLAR_WEIGHTS.items():
        branch = pillars[pillar_name]['branch']
        hidden_stems = HIDDEN_STEMS.get(branch, [])
        hidden_weights = HIDDEN_STEM_WEIGHTS.get(branch, [])
        for i, hs_stem in enumerate(hidden_stems):
            hs_weight = hidden_weights[i] if i < len(hidden_weights) else 0.2
            if STEM_ELEMENT[hs_stem] == dm_element:
                root_score += weight * hs_weight
    dedi = min(root_score * 30, 30)  # Cap at 30

    # Factor 3: 得勢 (20% weight) — stems + branch main qi
    support_score = 0.0
    total_weight = 0.0
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        # Manifest stem (skip day stem = Day Master itself)
        if pillar_name != 'day':
            stem_el = STEM_ELEMENT[pillar['stem']]
            total_weight += 1.0
            if stem_el == dm_element or stem_el == producing_element:
                support_score += 1.0
        # Branch main qi (本氣)
        branch_hidden = HIDDEN_STEMS.get(pillar['branch'], [])
        if branch_hidden:
            branch_main_el = STEM_ELEMENT[branch_hidden[0]]
            total_weight += 0.6
            if branch_main_el == dm_element or branch_main_el == producing_element:
                support_score += 0.6
    deshi = (support_score / total_weight) * 20 if total_weight > 0 else 0

    total = round(deling + dedi + deshi, 1)
    classification = (
        'very_strong' if total >= 70 else
        'strong' if total >= 55 else
        'neutral' if total >= 40 else
        'weak' if total >= 25 else
        'very_weak'
    )

    return {
        'score': total,
        'classification': classification,
        'factors': {
            'deling': round(deling, 1),
            'dedi': round(dedi, 1),
            'deshi': round(deshi, 1),
        },
        'lifeStage': life_stage,
    }


# ============================================================
# 從格 (Following Pattern) Detection
# ============================================================

def check_cong_ge(
    pillars: Dict,
    day_master_stem: str,
    strength_v2: Dict,
    five_elements_balance: Dict[str, float],
) -> Optional[Dict]:
    """
    Detect 從格 (Following Pattern) — when Day Master is too weak to be independent.

    Subtypes:
      - 從財格: Wealth element dominates
      - 從官格: Authority element dominates
      - 從兒格: Output element dominates (allows minimal root)
      - 從勢格: Multiple competing elements, Day Master has no root

    Source: 《滴天髓·化氣》, 《子平真詮·論從格》

    Returns:
        Dict with cong_ge details, or None if not 從格
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    is_yang = STEM_YINYANG[day_master_stem] == '陽'
    producing_element = ELEMENT_PRODUCED_BY[dm_element]
    i_produce = ELEMENT_PRODUCES[dm_element]
    i_overcome = ELEMENT_OVERCOMES[dm_element]
    overcomes_me = ELEMENT_OVERCOME_BY[dm_element]

    score = strength_v2['score']

    # 從格 requires very weak Day Master
    # 從兒格 has a higher threshold (~35) because it allows minimal root
    if score >= 35:
        return None

    # Check for roots (通根): Day Master element in any branch hidden stem
    has_root = False
    root_count = 0
    for pillar_name in ['year', 'month', 'day', 'hour']:
        branch = pillars[pillar_name]['branch']
        for hs in HIDDEN_STEMS.get(branch, []):
            if STEM_ELEMENT[hs] == dm_element:
                has_root = True
                root_count += 1

    # Check for 印/比劫 in entire chart (stems AND branch hidden stems)
    has_yin_bijie = False
    yin_bijie_count = 0
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        # Check manifest stem (skip day master itself)
        if pillar_name != 'day':
            el = STEM_ELEMENT[pillar['stem']]
            if el == dm_element or el == producing_element:
                has_yin_bijie = True
                yin_bijie_count += 1
        # Check ALL branch hidden stems
        for hs in HIDDEN_STEMS.get(pillar['branch'], []):
            el = STEM_ELEMENT[hs]
            if el == dm_element or el == producing_element:
                has_yin_bijie = True
                yin_bijie_count += 1

    # Yang DM cannot 從 with ANY 印/比劫 (《滴天髓》: "陽干從氣不從勢")
    # Yin DM may form 假從 with one isolated, unsupported 印/比劫
    if is_yang and has_yin_bijie:
        return None
    if not is_yang and yin_bijie_count > 1:
        return None

    # Determine which element dominates (>55% of chart energy — engineering approximation)
    dominant_element = None
    dominant_pct = 0.0
    for element in FIVE_ELEMENTS:
        pct = five_elements_balance.get(element, 0.0)
        if pct > dominant_pct:
            dominant_pct = pct
            dominant_element = element

    # Classify 從格 subtype
    if dominant_pct > 55 and dominant_element == i_overcome:
        return {
            'type': 'cong_cai',
            'name': '從財格',
            'dominantElement': dominant_element,
            'dominantPct': dominant_pct,
            'description': '日主極弱，順從財星',
            'yongShen': i_overcome,  # 財 becomes 用神
            'jiShen': [dm_element, producing_element],  # 比劫/印 become 忌神
            'significance': 'critical',
        }
    elif dominant_pct > 55 and dominant_element == overcomes_me:
        return {
            'type': 'cong_guan',
            'name': '從官格',
            'dominantElement': dominant_element,
            'dominantPct': dominant_pct,
            'description': '日主極弱，順從官殺',
            'yongShen': overcomes_me,
            'jiShen': [dm_element, producing_element],
            'significance': 'critical',
        }
    elif dominant_pct > 55 and dominant_element == i_produce:
        # 從兒格: allows minimal root (score < 35 vs < 25 for others)
        if score < 35:
            return {
                'type': 'cong_er',
                'name': '從兒格',
                'dominantElement': dominant_element,
                'dominantPct': dominant_pct,
                'description': '日主極弱，順從食傷（才華）',
                'yongShen': i_produce,
                'jiShen': [dm_element, producing_element],
                'significance': 'critical',
            }
    elif score < 25 and not has_root:
        # 從勢格: no single element dominates >55%, but DM has no root
        # 食傷+財+官殺 all compete while Day Master is rootless
        return {
            'type': 'cong_shi',
            'name': '從勢格',
            'dominantElement': dominant_element,
            'dominantPct': dominant_pct,
            'description': '日主無根，順勢而行',
            'yongShen': dominant_element,  # Follow strongest force
            'jiShen': [dm_element, producing_element],
            'significance': 'critical',
        }

    return None


# ============================================================
# Ten God Position Rules (gender-split)
# ============================================================

# Common rules shared by both genders
_TEN_GOD_POSITION_RULES_COMMON: Dict[str, Dict[str, str]] = {
    '比肩_year':  '童年淘氣、與父母有代溝、兄弟姐妹多。家境不富裕，需自力更生。',
    '比肩_month': '社交能力強、朋友多但知己少、性格大膽、工作效率高但固執。',
    '比肩_day':   '固執己見、難以妥協。婚姻不和諧，配偶各走各路。',
    '比肩_hour':  '勤勞但思想頑固、人際關係差、偏好獨處。子女繼承固執性格。',

    '劫財_year':  '童年困難、祖業薄弱、父母可能分居。',
    '劫財_month': '固執暴躁、異性緣好但同性關係差、理財能力差。',
    '劫財_day':   '愛出風頭、不切實際、異性緣好但不關心配偶、花費無度。',
    '劫財_hour':  '情緒不穩、容易與上司爭論、工作經常更換。子女叛逆。',

    '食神_year':  '出生在富裕家庭、祖業好、童年舒適無憂。',
    '食神_month': '氣質高貴、福氣充沛、才華橫溢、身體健康長壽。最吉利位置之一。',
    '食神_day':   '一生福氣充沛、性格慷慨知足、子女多、長壽。配偶善良體貼。',
    '食神_hour':  '晚年儲蓄習慣好、經濟安全。子女孝順有成就。',

    '傷官_year':  '很少出生在富裕家庭。童年困難，少有遺產。',
    '傷官_month': '才華橫溢但不安分、與權威爭辯、創造力強但與領導衝突。',
    '傷官_day':   '配偶傾向爭辯、考驗婚姻和諧。配偶言辭犀利。',
    '傷官_hour':  '子女叛逆或體弱、與後代關係緊張。',

    '正財_year':  '童年學業興趣不高但家境好、有祖產。',
    '正財_month': '勤勞自立、白手起家、早婚傾向、事業順利。',
    '正財_hour':  '晚年享受旅行休閒、自給自足。子女容易賺錢。',

    '偏財_year':  '家境富裕、有祖產、但與父親關係不佳。',
    '偏財_month': '進入社會後急於賺錢、社交能力強、賺錢容易但有賭博傾向。',
    '偏財_hour':  '子女是財富來源、晚年財運好。',

    '正官_year':  '受祖先庇蔭、出身受尊重的家庭、早期學業成功。',
    '正官_month': '強烈的責任感、尊重權威、正直為本。最吉利位置。',
    '正官_hour':  '大福大壽、逢凶化吉。晚年事業成功，子女孝順。',

    '偏官_year':  '通常不是長子、很少來自富貴家庭、早年貧困。',
    '偏官_month': '氣場強大、意志堅定、勇敢、有戰略頭腦。適合軍警/競爭性職業。',
    '偏官_hour':  '子女運弱、與子女關係緊張。',

    '正印_year':  '出生在書香/富裕家庭、學業能力優秀。',
    '正印_month': '父母受尊敬且有福、善良聰慧、健康和平。最有利位置之一。',
    '正印_day':   '配偶善良聰慧、誠實可靠。婚姻和諧美滿。',
    '正印_hour':  '子女善良聰慧、學業成績好、孝順。',

    '偏印_year':  '損害家族聲譽（若為不利元素）、祖業基礎薄弱。',
    '偏印_month': '適合副業發展（醫療、藝術、娛樂、美容、自由職業）。',
    '偏印_day':   '男女皆有晚婚傾向、配偶問題。婚姻延遲。',
    '偏印_hour':  '子女不聽話、不孝順、體弱。',
}

# Male-specific overrides for 日支
TEN_GOD_POSITION_RULES_MALE: Dict[str, str] = {
    **_TEN_GOD_POSITION_RULES_COMMON,
    '正財_day':   '得到能幹賢惠的配偶、配偶提供極好的支持。婚姻非常有利。',
    '偏財_day':   '通過異性關係獲得好運、對異性有吸引力。可能面臨三角關係。',
    '正官_day':   '配偶有官方背景、婚姻提升地位。成就卓越。',
    '偏官_day':   '命格清晰、聰明能幹、以身作則。吸引伴侶。',
}

# Female-specific overrides
TEN_GOD_POSITION_RULES_FEMALE: Dict[str, str] = {
    **_TEN_GOD_POSITION_RULES_COMMON,
    '正財_day':   '理財能力強、善於管理家庭經濟。',
    '偏財_day':   '財務敏銳、投資眼光好。',
    '正官_day':   '丈夫正派可靠、婚姻穩定幸福。配偶有社會地位。',
    '偏官_day':   '配偶控制欲強、婚姻需要忍耐。可能面臨感情波折。',
}


def generate_ten_god_position_analysis(
    pillars: Dict,
    day_master_stem: str,
    gender: str = 'male',
) -> List[Dict]:
    """
    Generate Ten God position analysis for all pillars.

    Args:
        pillars: Four pillars with Ten God labels already applied
        day_master_stem: Day Master stem
        gender: 'male' or 'female'

    Returns:
        List of position analysis findings
    """
    rules = TEN_GOD_POSITION_RULES_MALE if gender == 'male' else TEN_GOD_POSITION_RULES_FEMALE
    findings: List[Dict] = []

    pillar_positions = {
        'year': '年柱',
        'month': '月柱',
        'day': '日支',
        'hour': '時柱',
    }

    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]

        if pillar_name == 'day':
            # Day pillar uses branch hidden stem main qi for position rules
            hidden = HIDDEN_STEMS.get(pillar['branch'], [])
            if not hidden:
                continue
            ten_god = derive_ten_god(day_master_stem, hidden[0])
        else:
            ten_god = pillar.get('tenGod')
            if not ten_god:
                continue

        key = f'{ten_god}_{pillar_name}'
        interpretation = rules.get(key)
        if not interpretation:
            continue

        # Determine significance based on pillar and ten god
        significance = 'medium'
        if pillar_name == 'month' and ten_god in ('正官', '食神', '正印', '正財'):
            significance = 'high'
        elif pillar_name == 'day':
            significance = 'high'  # Spouse palace always important

        findings.append({
            'tenGod': ten_god,
            'pillar': pillar_name,
            'pillarZh': pillar_positions[pillar_name],
            'interpretation': interpretation,
            'significance': significance,
        })

    return findings


# ============================================================
# 透干 (Tou Gan) Analysis
# ============================================================

def generate_tougan_analysis(
    pillars: Dict,
    day_master_stem: str,
) -> List[Dict]:
    """
    Analyze 透干 (transparency) — hidden stems that appear as manifest stems.

    A hidden stem that also appears as a manifest stem in another pillar
    has full power (透干). One that remains hidden is latent (藏而不透).

    Returns:
        List of transparency findings
    """
    findings: List[Dict] = []

    # Collect all manifest stems
    manifest_stems: Dict[str, str] = {}  # stem → pillar_name
    for pname in ('year', 'month', 'hour'):
        manifest_stems[pillars[pname]['stem']] = pname

    # Check each pillar's hidden stems for transparency
    for pillar_name in ['year', 'month', 'day', 'hour']:
        branch = pillars[pillar_name]['branch']
        hidden = HIDDEN_STEMS.get(branch, [])

        for i, hs in enumerate(hidden):
            ten_god = derive_ten_god(day_master_stem, hs)
            is_main_qi = (i == 0)
            qi_type = '本氣' if is_main_qi else ('中氣' if i == 1 else '餘氣')

            if hs in manifest_stems:
                # 透干: hidden stem appears as manifest stem
                transparent_pillar = manifest_stems[hs]
                findings.append({
                    'stem': hs,
                    'tenGod': ten_god,
                    'sourcePillar': pillar_name,
                    'transparentPillar': transparent_pillar,
                    'qiType': qi_type,
                    'status': 'transparent',
                    'description': f'{ten_god}（{hs}）在{pillar_name}支{qi_type}透出於{transparent_pillar}干，力量充分',
                    'significance': 'high' if is_main_qi else 'medium',
                })
            elif is_main_qi:
                # Main qi that doesn't 透干 — latent but still important
                findings.append({
                    'stem': hs,
                    'tenGod': ten_god,
                    'sourcePillar': pillar_name,
                    'transparentPillar': None,
                    'qiType': qi_type,
                    'status': 'latent',
                    'description': f'{ten_god}（{hs}）藏於{pillar_name}支{qi_type}，藏而不透，力量潛伏',
                    'significance': 'low',
                })

    return findings


# ============================================================
# 官殺混雜 Check (Female Only)
# ============================================================

def check_guan_sha_hunza(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
) -> Optional[Dict]:
    """
    Check for 官殺混雜 — both 正官 AND 七殺/偏官 present in manifest stems.

    This is a severe marriage warning for female charts only.
    Does NOT affect career domain readings.

    Returns:
        Warning dict, or None if not applicable
    """
    if gender != 'female':
        return None

    has_zhengguan = False
    has_qisha = False

    for pname in ('year', 'month', 'hour'):
        ten_god = derive_ten_god(day_master_stem, pillars[pname]['stem'])
        if ten_god == '正官':
            has_zhengguan = True
        elif ten_god == '偏官':
            has_qisha = True

    if has_zhengguan and has_qisha:
        return {
            'type': 'guan_sha_hunza',
            'name': '官殺混雜',
            'description': '正官與偏官（七殺）同見天干，感情生活複雜，婚姻有波折',
            'domains': ['love'],
            'significance': 'high',
        }

    return None


# ============================================================
# 用神合絆 (Yong Shen Locking) Detection
# ============================================================

def check_yong_shen_locked(
    pillars: Dict,
    favorable_gods: Dict[str, str],
    stem_combinations: List[Dict],
) -> List[Dict]:
    """
    Check if the 用神 element is "locked" by a stem combination.

    When a stem carrying the 用神 element combines with another stem
    (even 合而不化), the 用神 is tied up and cannot function.

    Returns:
        List of locked 用神 findings
    """
    findings: List[Dict] = []
    useful_element = favorable_gods.get('usefulGod', '')

    for combo in stem_combinations:
        stem_a, stem_b = combo['stems']
        el_a = STEM_ELEMENT[stem_a]
        el_b = STEM_ELEMENT[stem_b]

        if el_a == useful_element or el_b == useful_element:
            locked_stem = stem_a if el_a == useful_element else stem_b
            findings.append({
                'type': 'yong_shen_locked',
                'lockedStem': locked_stem,
                'lockedElement': useful_element,
                'combinedWith': stem_b if locked_stem == stem_a else stem_a,
                'pillarA': combo['pillarA'],
                'pillarB': combo['pillarB'],
                'description': f'用神{useful_element}（{locked_stem}）被{combo["description"]}合絆，用神功能受限',
                'significance': 'high',
            })

    return findings


# ============================================================
# 墓庫 (Tomb/Storage) Analysis
# ============================================================

# 辰/戌/丑/未 store specific elements
TOMB_STORAGE: Dict[str, Dict] = {
    '辰': {'stores': '水', 'element': '土', 'description': '辰為水庫'},
    '戌': {'stores': '火', 'element': '土', 'description': '戌為火庫'},
    '丑': {'stores': '金', 'element': '土', 'description': '丑為金庫'},
    '未': {'stores': '木', 'element': '土', 'description': '未為木庫'},
}


def analyze_tomb_storage(pillars: Dict) -> List[Dict]:
    """
    Analyze 墓庫 (tomb/storage) branches in the chart.

    辰/戌/丑/未 are earth branches that store specific elements.
    When a tomb is "opened" (沖開) by its opposite branch, the stored
    element is released.
    """
    findings: List[Dict] = []

    for pillar_name in ['year', 'month', 'day', 'hour']:
        branch = pillars[pillar_name]['branch']
        if branch not in TOMB_STORAGE:
            continue

        info = TOMB_STORAGE[branch]
        finding: Dict[str, Any] = {
            'branch': branch,
            'pillar': pillar_name,
            'stores': info['stores'],
            'description': info['description'],
        }

        # Day branch 墓庫 = reserved/secretive spouse
        if pillar_name == 'day':
            finding['spouseNote'] = f'日支{branch}為{info["stores"]}庫，配偶性格內斂保守'

        findings.append(finding)

    return findings


# ============================================================
# Life Domain Mapping
# ============================================================

ELEMENT_INDUSTRIES: Dict[str, List[str]] = {
    '木': ['教育', '醫療', '出版', '時尚', '創意寫作', '社會工作', '植物/花卉', '服裝'],
    '火': ['科技', '能源', '娛樂', '電子', '餐飲', '媒體', '光學', '美容'],
    '土': ['房地產', '建築', '農業', '礦業', '保險', '物流', '陶瓷', '顧問'],
    '金': ['金融', '法律', '汽車', '機械', '珠寶', '軍事', '外科', '會計'],
    '水': ['貿易', '航運', '旅遊', '水產', '飲料', '諮詢', '情報', 'IT'],
}

ELEMENT_HEALTH: Dict[str, Dict] = {
    '木': {'organs': ['肝', '膽'], 'excess': '肝火旺、易怒、頭痛', 'deficiency': '視力差、筋骨無力'},
    '火': {'organs': ['心', '小腸'], 'excess': '心悸、失眠、焦躁', 'deficiency': '血壓低、手腳冰冷'},
    '土': {'organs': ['脾', '胃'], 'excess': '消化不良、肥胖', 'deficiency': '食慾差、營養吸收差'},
    '金': {'organs': ['肺', '大腸'], 'excess': '皮膚過敏、呼吸急促', 'deficiency': '免疫力差、易感冒'},
    '水': {'organs': ['腎', '膀胱'], 'excess': '水腫、泌尿問題', 'deficiency': '腰膝酸軟、記憶力差'},
}

LOVE_INDICATORS: Dict[str, Dict[str, str]] = {
    'male': {
        'spouse_star': '正財',
        'romance_star': '偏財',
        'spouse_palace': '日支',
    },
    'female': {
        'spouse_star': '正官',
        'romance_star': '偏官',
        'spouse_palace': '日支',
    },
}


def generate_career_insights(
    favorable_gods: Dict[str, str],
    prominent_god: str,
    strength_classification: str,
) -> Dict:
    """Generate career domain insights based on 用神 and chart pattern."""
    useful_element = favorable_gods.get('usefulGod', '')
    industries = ELEMENT_INDUSTRIES.get(useful_element, [])

    work_style = '領導型' if strength_classification in ('strong', 'very_strong') else '輔助型'
    if prominent_god in ('正官', '偏官'):
        work_style = '管理/權威型'
    elif prominent_god in ('食神', '傷官'):
        work_style = '創意/技術型'
    elif prominent_god in ('正財', '偏財'):
        work_style = '商業/理財型'

    return {
        'suitableIndustries': industries,
        'usefulElement': useful_element,
        'workStyle': work_style,
        'prominentGod': prominent_god,
    }


def generate_health_insights(
    five_elements_balance: Dict[str, float],
    dm_element: str,
) -> Dict:
    """Generate health domain insights based on Five Elements balance."""
    # Find most excessive and most deficient elements
    sorted_elements = sorted(five_elements_balance.items(), key=lambda x: x[1], reverse=True)
    excess_element = sorted_elements[0][0] if sorted_elements[0][1] > 25 else None
    deficient_element = sorted_elements[-1][0] if sorted_elements[-1][1] < 15 else None

    weak_organs: List[str] = []
    warnings: List[str] = []

    if excess_element and excess_element in ELEMENT_HEALTH:
        info = ELEMENT_HEALTH[excess_element]
        weak_organs.extend(info['organs'])
        warnings.append(f'{excess_element}過旺：{info["excess"]}')

    if deficient_element and deficient_element in ELEMENT_HEALTH:
        info = ELEMENT_HEALTH[deficient_element]
        weak_organs.extend(info['organs'])
        warnings.append(f'{deficient_element}不足：{info["deficiency"]}')

    return {
        'weakOrgans': weak_organs,
        'excessElement': excess_element,
        'deficientElement': deficient_element,
        'warnings': warnings,
    }


def generate_love_insights(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    ten_god_findings: List[Dict],
    guan_sha: Optional[Dict],
) -> Dict:
    """Generate love domain insights."""
    indicators = LOVE_INDICATORS.get(gender, LOVE_INDICATORS['male'])
    spouse_star = indicators['spouse_star']
    romance_star = indicators['romance_star']

    # Check day branch (spouse palace) for Ten God
    day_branch = pillars['day']['branch']
    day_hidden = HIDDEN_STEMS.get(day_branch, [])
    spouse_palace_god = derive_ten_god(day_master_stem, day_hidden[0]) if day_hidden else None

    # Find spouse star positions
    spouse_star_pillars: List[str] = []
    for finding in ten_god_findings:
        if finding['tenGod'] == spouse_star:
            spouse_star_pillars.append(finding['pillar'])

    challenges: List[str] = []
    if guan_sha:
        challenges.append(guan_sha['description'])

    return {
        'spouseStar': spouse_star,
        'romanceStar': romance_star,
        'spousePalaceGod': spouse_palace_god,
        'spouseStarPillars': spouse_star_pillars,
        'challenges': challenges,
    }


# ============================================================
# Conflict Resolution
# ============================================================

def resolve_conflicts(findings: Dict) -> List[Dict]:
    """
    Apply conflict resolution priority hierarchy:
      1. 從格 overrides ALL regular 喜忌 rules
      2. 合絆 overrides Ten God position analysis (locked 用神)
      3. 三合/三會 element boost overrides surface Five Elements balance
      4. 格局 classification wins over individual Ten God positions
      5. 官殺混雜 (female only): domain-scoped override for love
    """
    resolutions: List[Dict] = []

    cong_ge = findings.get('congGe')
    yong_shen_locked = findings.get('yongShenLocked', [])
    guan_sha = findings.get('guanShaHunza')

    if cong_ge:
        resolutions.append({
            'priority': 1,
            'type': 'cong_ge_override',
            'description': f'{cong_ge["name"]}成立，喜忌神完全反轉',
            'effect': '比劫/印 become 忌神, dominant element becomes 用神',
        })

    for locked in yong_shen_locked:
        resolutions.append({
            'priority': 2,
            'type': 'yong_shen_locked',
            'description': locked['description'],
            'effect': 'Positive Ten God position meanings reduced',
        })

    if guan_sha:
        resolutions.append({
            'priority': 5,
            'type': 'guan_sha_hunza',
            'description': guan_sha['description'],
            'effect': 'Love domain: overrides positive 正官/偏官 position interpretations',
            'domains': ['love'],
        })

    return resolutions


# ============================================================
# Main Orchestrator
# ============================================================

def generate_pre_analysis(
    pillars: Dict,
    day_master_stem: str,
    five_elements_balance: Dict[str, float],
    favorable_gods: Dict[str, str],
    reading_type: str = 'LIFETIME',
    gender: str = 'male',
    timing_insights: Optional[Dict] = None,
    special_day_pillars: Optional[List[Dict]] = None,
) -> Dict:
    """
    Generate the complete pre-analysis for a Bazi chart.

    This is the main entry point for the pre-analysis layer.

    Args:
        pillars: Four pillars dict with stems, branches, and ten god labels
        day_master_stem: Day Master stem
        five_elements_balance: Five Elements balance percentages
        favorable_gods: Favorable gods from determine_favorable_gods()
        reading_type: NestJS reading type enum string
        gender: 'male' or 'female'
        timing_insights: Timing analysis from timing_analysis.py (Phase 11D)
        special_day_pillars: Special day pillar findings (Phase 11D)

    Returns:
        Complete pre-analysis dict (versioned, domain-filtered)
    """
    domains = READING_TYPE_DOMAINS.get(reading_type, ['career', 'love', 'health', 'timing'])

    # Day Master Strength V2
    strength_v2 = calculate_strength_score_v2(pillars, day_master_stem)

    # Stem analysis
    stem_analysis = analyze_stem_relationships(pillars, day_master_stem)

    # Branch analysis
    branch_analysis = analyze_branch_relationships(pillars)

    # 從格 detection — must run BEFORE using favorable_gods
    cong_ge = check_cong_ge(pillars, day_master_stem, strength_v2, five_elements_balance)

    # If 從格, override favorable gods
    effective_gods = favorable_gods
    if cong_ge:
        dm_element = STEM_ELEMENT[day_master_stem]
        producing_element = ELEMENT_PRODUCED_BY[dm_element]
        effective_gods = {
            'favorableGod': cong_ge['yongShen'],
            'usefulGod': cong_ge['yongShen'],
            'idleGod': ELEMENT_PRODUCES[cong_ge['yongShen']],
            'tabooGod': dm_element,
            'enemyGod': producing_element,
        }

    # Ten God position analysis
    ten_god_findings = generate_ten_god_position_analysis(pillars, day_master_stem, gender)

    # 透干 analysis
    tougan_findings = generate_tougan_analysis(pillars, day_master_stem)

    # 官殺混雜
    guan_sha = check_guan_sha_hunza(pillars, day_master_stem, gender)

    # 用神合絆
    yong_shen_locked = check_yong_shen_locked(
        pillars, effective_gods, stem_analysis['combinations']
    )

    # 墓庫 analysis
    tomb_storage = analyze_tomb_storage(pillars)

    # Prominent Ten God (格局)
    prominent_god = get_prominent_ten_god(pillars, day_master_stem)

    # Build key findings
    key_findings: List[Dict] = []

    # Strength finding
    key_findings.append({
        'category': 'strength',
        'finding': f'日主{STEM_ELEMENT[day_master_stem]}（{day_master_stem}），{strength_v2["classification"]}（{strength_v2["score"]}分）',
        'significance': 'high',
        'domains': ['career', 'love', 'health', 'timing'],
    })

    # 從格 finding
    if cong_ge:
        key_findings.append({
            'category': 'pattern',
            'finding': f'{cong_ge["name"]}：{cong_ge["description"]}',
            'significance': 'critical',
            'domains': ['career', 'love', 'health', 'timing'],
        })

    # Stem combination findings
    for combo in stem_analysis['combinations']:
        key_findings.append({
            'category': 'stem',
            'finding': combo['description'],
            'significance': combo['significance'],
            'domains': ['career', 'love'] if combo['dayMasterInvolved'] else ['career'],
        })

    # Branch relationship findings (significant ones only)
    if branch_analysis['threeMeetings']:
        for meeting in branch_analysis['threeMeetings']:
            key_findings.append({
                'category': 'branch',
                'finding': meeting['description'],
                'significance': 'high',
                'domains': ['career', 'love', 'health', 'timing'],
            })
    if branch_analysis['clashes']:
        for clash in branch_analysis['clashes']:
            key_findings.append({
                'category': 'branch',
                'finding': f'{clash["description"]}（{clash.get("pillarEffect", "")}）',
                'significance': 'high',
                'domains': ['career', 'love', 'health', 'timing'],
            })

    # 官殺混雜 finding
    if guan_sha:
        key_findings.append({
            'category': 'pattern',
            'finding': guan_sha['description'],
            'significance': 'high',
            'domains': guan_sha['domains'],
        })

    # 用神合絆 finding
    for locked in yong_shen_locked:
        key_findings.append({
            'category': 'stem',
            'finding': locked['description'],
            'significance': 'high',
            'domains': ['career', 'love', 'health'],
        })

    # Special day pillar findings (Phase 11D)
    if special_day_pillars:
        for sdp in special_day_pillars:
            key_findings.append({
                'category': 'special_day',
                'finding': f'{sdp["name"]}：{sdp["meaning"]}',
                'significance': 'high',
                'domains': ['career', 'love', 'health', 'timing'],
                'detail': sdp.get('effect', ''),
            })

    # Timing findings (Phase 11D)
    if timing_insights:
        for tf in timing_insights.get('significantFindings', []):
            key_findings.append({
                'category': 'timing',
                'finding': tf['description'],
                'significance': 'high' if tf.get('severity') in ('HIGH', 'VERY_HIGH') else 'critical',
                'domains': ['timing'],
            })

    # Conflict resolution
    all_findings = {
        'congGe': cong_ge,
        'yongShenLocked': yong_shen_locked,
        'guanShaHunza': guan_sha,
    }
    conflict_resolutions = resolve_conflicts(all_findings)

    # Build result
    result: Dict[str, Any] = {
        'version': '1.0.0',
        'summary': _build_summary(
            day_master_stem, strength_v2, prominent_god, cong_ge,
        ),
        'keyFindings': key_findings,
        'strengthV2': strength_v2,
        'pillarRelationships': {
            'stemCombinations': stem_analysis['combinations'],
            'stemClashes': stem_analysis['clashes'],
            'stemInteractions': stem_analysis['interactions'],
            'branchRelationships': branch_analysis,
        },
        'tenGodPositionAnalysis': ten_god_findings,
        'touganAnalysis': tougan_findings,
        'tombStorage': tomb_storage,
        'prominentGod': prominent_god,
        'effectiveFavorableGods': effective_gods,
        'congGe': cong_ge,
        'guanShaHunza': guan_sha,
        'yongShenLocked': yong_shen_locked,
        'conflictResolution': conflict_resolutions,
        # Phase 11D: Timing + special day pillars
        'timingInsights': timing_insights or {},
        'specialDayPillars': special_day_pillars or [],
    }

    # Domain-specific insights
    if 'career' in domains:
        result['careerInsights'] = generate_career_insights(
            effective_gods, prominent_god, strength_v2['classification'],
        )

    if 'love' in domains:
        result['loveInsights'] = generate_love_insights(
            pillars, day_master_stem, gender, ten_god_findings, guan_sha,
        )

    if 'health' in domains:
        result['healthInsights'] = generate_health_insights(
            five_elements_balance, STEM_ELEMENT[day_master_stem],
        )

    return result


def _build_summary(
    day_master_stem: str,
    strength_v2: Dict,
    prominent_god: str,
    cong_ge: Optional[Dict],
) -> str:
    """Build a one-line chart summary."""
    dm_element = STEM_ELEMENT[day_master_stem]
    dm_yinyang = STEM_YINYANG[day_master_stem]

    parts = [f'{dm_yinyang}{dm_element}日主（{day_master_stem}）']

    if cong_ge:
        parts.append(cong_ge['name'])
    else:
        strength_zh = {
            'very_strong': '極旺', 'strong': '偏強',
            'neutral': '中和', 'weak': '偏弱', 'very_weak': '極弱',
        }
        parts.append(strength_zh.get(strength_v2['classification'], ''))
        parts.append(f'{prominent_god}格')

    return '，'.join(parts)
