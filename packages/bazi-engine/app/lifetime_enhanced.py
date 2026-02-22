"""
Lifetime Enhanced Insights — Deterministic computations for V2 八字終身運

Generates structured data for the enriched lifetime reading format:
  - Pattern narrative (格局 chain of reasoning)
  - Investment lookups (favorable/unfavorable by 喜忌用仇)
  - Career directions (5 categories per 用神 element)
  - Benefactor zodiac/element lookups
  - Romance year computation (gender-aware + 空亡 filter)
  - Partner zodiac computation (日支 based)
  - Parent health year computation (Ten God derived)
  - Children insights (食傷 count + hour pillar)
  - Parents insights (year pillar + Ten God)
  - Boss compatibility (格局 archetype)
  - Luck period enrichment (scoring formula + phase split)

All computations are deterministic — no AI involved.
Source: Plan at /Users/roger/.claude/plans/jaunty-petting-unicorn.md
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from .constants import (
    EARTHLY_BRANCHES,
    ELEMENT_OVERCOMES,
    ELEMENT_OVERCOME_BY,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    HIDDEN_STEMS,
    HONGLUAN,
    STEM_ELEMENT,
    TAOHUA,
    TIANXI,
)
from .branch_relationships import (
    CLASH_LOOKUP,
    HARMONY_LOOKUP,
    SIX_CLASHES,
    SIX_HARMONIES,
    THREE_PUNISHMENTS,
    TRIPLE_HARMONIES,
)
from .life_stages import get_life_stage
from .ten_gods import derive_ten_god


# ============================================================
# Lookup Tables — Investments
# ============================================================

ELEMENT_FAVORABLE_INVESTMENTS: Dict[str, List[str]] = {
    '木': ['綠色基金', '環保產業投資', '農林業相關基金', '教育科技股', '生技醫療基金'],
    '火': ['科技股', '電子產業ETF', '能源基金', '文創產業投資', '新興市場基金'],
    '土': ['房地產投資', '不動產信託(REITs)', '建設股', '農業期貨', '穩健型定存'],
    '金': ['黃金/貴金屬', '金融股', '政府公債', '保險型投資', '高股息基金'],
    '水': ['海外基金', '國際貿易ETF', '物流航運股', '科技軟體股', '加密貨幣(審慎)'],
}

ELEMENT_UNFAVORABLE_INVESTMENTS: Dict[str, List[str]] = {
    '木': ['伐木/破壞環境產業', '短期投機', '高槓桿期貨'],
    '火': ['冷門長期債券', '低波動定存', '過於保守型投資'],
    '土': ['高波動科技股', '虛擬貨幣投機', '海外高風險基金'],
    '金': ['高風險新創投資', '農業期貨投機', '不穩定新興市場'],
    '水': ['不動產過度集中', '單一市場重押', '傳統工業股過多'],
}


# ============================================================
# Lookup Tables — Career Directions (5 categories per element)
# ============================================================

ELEMENT_INDUSTRIES_DETAILED: Dict[str, List[Dict[str, Any]]] = {
    '木': [
        {'anchor': '木之本源', 'category': '自然與生命', 'industries': ['種植業', '林業', '農產品加工', '花卉', '木材加工', '紡織', '環保綠化']},
        {'anchor': '木為紙墨', 'category': '文化與出版', 'industries': ['印刷業', '造紙業', '圖書出版', '編輯', '書畫文藝']},
        {'anchor': '木之成長', 'category': '教育與培訓', 'industries': ['教育培訓', '諮詢行業', '輔導', '社會培訓']},
        {'anchor': '木之療癒', 'category': '醫療與養生', 'industries': ['中醫藥', '製藥業', '營養學', '康復治療']},
        {'anchor': '木之精神', 'category': '社會與服務', 'industries': ['社會工作', '護理', '慈善業', '心理諮商']},
    ],
    '火': [
        {'anchor': '火之光明', 'category': '傳媒與娛樂', 'industries': ['傳媒業', '廣告', '演藝', '攝影', '網路直播']},
        {'anchor': '火之熱能', 'category': '科技與能源', 'industries': ['電力', '能源', '電子科技', '資訊科技', 'AI產業']},
        {'anchor': '火之溫暖', 'category': '餐飲與時尚', 'industries': ['餐飲業', '烘焙', '美容美髮', '時尚服裝']},
        {'anchor': '火之變化', 'category': '化工與燃料', 'industries': ['化工業', '石油', '煙草', '燃料']},
        {'anchor': '火之禮儀', 'category': '文化與公關', 'industries': ['文化活動', '婚慶策劃', '公關', '品牌管理']},
    ],
    '土': [
        {'anchor': '土之承載', 'category': '建築與地產', 'industries': ['房地產', '建設工程', '建築設計', '土木工程']},
        {'anchor': '土之蘊藏', 'category': '倉儲與礦產', 'industries': ['倉儲物流', '農地開發', '礦產', '陶瓷']},
        {'anchor': '土之穩固', 'category': '金融與保險', 'industries': ['保險業', '信託', '會計', '審計']},
        {'anchor': '土之滋養', 'category': '農業與食品', 'industries': ['農業', '畜牧業', '食品加工', '有機農場']},
        {'anchor': '土之中介', 'category': '仲介與顧問', 'industries': ['仲介', '顧問', '人力資源', '物業管理']},
    ],
    '金': [
        {'anchor': '金之堅銳', 'category': '醫療與精密', 'industries': ['外科醫學', '牙醫', '精密機械', '刀具工具']},
        {'anchor': '金之貴重', 'category': '珠寶與奢侈品', 'industries': ['珠寶首飾', '貴金屬', '鐘錶', '奢侈品']},
        {'anchor': '金之肅殺', 'category': '法律與紀律', 'industries': ['法律', '司法', '軍警', '紀律部隊']},
        {'anchor': '金之理財', 'category': '金融與投資', 'industries': ['銀行', '證券', '金融理財', '投資管理']},
        {'anchor': '金之製造', 'category': '機械與製造', 'industries': ['汽車機械', '鋼鐵', '五金', '電子零件']},
    ],
    '水': [
        {'anchor': '水之流動', 'category': '貿易與運輸', 'industries': ['國際貿易', '進出口', '航運', '物流運輸']},
        {'anchor': '水之智慧', 'category': '學術與研究', 'industries': ['學術研究', '哲學', '玄學命理', '策略顧問']},
        {'anchor': '水之傳播', 'category': '傳播與語言', 'industries': ['新聞業', '翻譯', '語言教學', '出版']},
        {'anchor': '水之服務', 'category': '旅遊與服務', 'industries': ['旅遊業', '飯店酒店', '清潔', '水產漁業']},
        {'anchor': '水之科技', 'category': '科技與數據', 'industries': ['軟體開發', '網路工程', '數據分析', '資安']},
    ],
}


# ============================================================
# Lookup Tables — Directions & Zodiacs
# ============================================================

ELEMENT_DIRECTION: Dict[str, str] = {
    '木': '東方', '火': '南方', '土': '中央', '金': '西方', '水': '北方',
}

BRANCH_ZODIAC: Dict[str, str] = {
    '子': '鼠', '丑': '牛', '寅': '虎', '卯': '兔',
    '辰': '龍', '巳': '蛇', '午': '馬', '未': '羊',
    '申': '猴', '酉': '雞', '戌': '狗', '亥': '豬',
}

# Element → its 三合 branches (for benefactor zodiac computation)
ELEMENT_SANHE_BRANCHES: Dict[str, List[str]] = {
    '水': ['申', '子', '辰'],
    '木': ['亥', '卯', '未'],
    '火': ['寅', '午', '戌'],
    '金': ['巳', '酉', '丑'],
}

ELEMENT_NAME_ZH: Dict[str, str] = {
    '木': '木', '火': '火', '土': '土', '金': '金', '水': '水',
}


# ============================================================
# Lookup Tables — Boss Compatibility
# ============================================================

TEN_GOD_WORK_STYLE: Dict[str, Dict[str, Any]] = {
    '正官': {
        'dominantStyle': '正官格→循規蹈矩、責任心強',
        'idealBossType': '開明型領導，給予自主空間',
        'workplaceStrengths': ['執行力強', '有組織能力', '尊重規則', '可靠穩重'],
        'workplaceWarnings': ['過於保守', '不善變通', '壓力下容易僵化'],
    },
    '偏官': {
        'dominantStyle': '偏官格→果斷進取、勇於挑戰',
        'idealBossType': '權威型領導，欣賞實力',
        'workplaceStrengths': ['意志力堅定', '抗壓性強', '有戰略頭腦', '勇於開拓'],
        'workplaceWarnings': ['過於強勢', '容易與上司衝突', '不服管束'],
    },
    '正財': {
        'dominantStyle': '正財格→踏實穩重、務實理財',
        'idealBossType': '穩健型領導，重視業績成果',
        'workplaceStrengths': ['勤勞務實', '理財能力強', '做事有條理', '忠誠可靠'],
        'workplaceWarnings': ['缺乏冒險精神', '視野不夠開闊', '過於計較得失'],
    },
    '偏財': {
        'dominantStyle': '偏財格→社交活躍、投資敏銳',
        'idealBossType': '社交型領導，重視人脈拓展',
        'workplaceStrengths': ['人際關係好', '商業嗅覺敏銳', '善於談判', '靈活多變'],
        'workplaceWarnings': ['容易投機', '財務管理不穩', '注意力分散'],
    },
    '食神': {
        'dominantStyle': '食神格→才華橫溢、生活品味高',
        'idealBossType': '藝術型領導，欣賞創意才華',
        'workplaceStrengths': ['創造力豐富', '表達能力強', '樂觀開朗', '善於享受'],
        'workplaceWarnings': ['容易安於現狀', '紀律性不足', '缺乏競爭意識'],
    },
    '傷官': {
        'dominantStyle': '傷官格→聰明叛逆、追求自由',
        'idealBossType': '包容型領導，給予極大自由度',
        'workplaceStrengths': ['思維敏捷', '口才出眾', '創新能力強', '不畏權威'],
        'workplaceWarnings': ['與上司關係差', '容易得罪人', '恃才傲物'],
    },
    '正印': {
        'dominantStyle': '正印格→學識淵博、溫和仁厚',
        'idealBossType': '導師型領導，重視培養下屬',
        'workplaceStrengths': ['學習能力強', '善良正直', '有耐心', '注重細節'],
        'workplaceWarnings': ['決斷力不足', '過於依賴他人', '行動力弱'],
    },
    '偏印': {
        'dominantStyle': '偏印格→思想獨特、適合副業',
        'idealBossType': '開放型領導，接受非主流思維',
        'workplaceStrengths': ['獨立思考', '專業技能強', '多才多藝', '善於研究'],
        'workplaceWarnings': ['孤僻不合群', '情緒不穩', '容易中途而廢'],
    },
    '比肩': {
        'dominantStyle': '比肩格→獨立自主、同輩競爭',
        'idealBossType': '夥伴型領導，平等對待',
        'workplaceStrengths': ['獨立性強', '不需監督', '堅持己見', '行動力強'],
        'workplaceWarnings': ['固執己見', '不善合作', '容易孤軍奮戰'],
    },
    '劫財': {
        'dominantStyle': '劫財格→衝動進取、好勝心強',
        'idealBossType': '強勢型領導，能鎮住場面',
        'workplaceStrengths': ['執行力強', '善於競爭', '膽識過人', '社交能力好'],
        'workplaceWarnings': ['花費無度', '衝動決策', '容易與同事爭利'],
    },
}


# ============================================================
# Helper: 三刑 check for a single branch pair
# ============================================================

def _check_sanxing_pair(branch_a: str, branch_b: str) -> bool:
    """Check if two branches form a 三刑 partial (半刑) or full 2-branch punishment."""
    pair = frozenset({branch_a, branch_b})
    for punishment in THREE_PUNISHMENTS:
        # Check partials (for 3-branch punishments)
        for partial in punishment.get('partials', []):
            if pair == partial:
                return True
        # Check full set (for 2-branch punishments like 子卯 無禮之刑)
        if pair == punishment['branches'] and len(punishment['branches']) == 2:
            return True
    return False


# ============================================================
# Pattern Narrative
# ============================================================

def build_pattern_narrative(
    pillars: Dict,
    day_master_stem: str,
    prominent_god: str,
    strength_v2: Dict,
    cong_ge: Optional[Dict],
    effective_gods: Dict[str, str],
    tougan_analysis: List[Dict],
    ten_god_position_analysis: List[Dict],
    five_elements_balance: Dict[str, float],
) -> Dict[str, Any]:
    """
    Build patternNarrative — the 格局 chain of reasoning that anchors all AI sections.
    """
    dm_element = STEM_ELEMENT[day_master_stem]

    # Pattern name
    if cong_ge:
        pattern_name = cong_ge['name']
    else:
        pattern_name = f'{prominent_god}格'

    # Pattern logic chain
    month_branch = pillars['month']['branch']
    month_hidden = HIDDEN_STEMS.get(month_branch, [])
    month_main_qi = month_hidden[0] if month_hidden else ''
    month_main_ten_god = derive_ten_god(day_master_stem, month_main_qi) if month_main_qi else ''

    if cong_ge:
        pattern_logic = (
            f'日主{dm_element}（{day_master_stem}），'
            f'強度{strength_v2["score"]}分（{strength_v2["classification"]}），'
            f'{cong_ge["description"]}。'
            f'dominant元素{cong_ge["dominantElement"]}佔{cong_ge["dominantPct"]:.1f}%'
        )
    else:
        # Check if prominent god is transparent
        transparent_info = ''
        for tg in tougan_analysis:
            if tg['status'] == 'transparent' and tg['tenGod'] == prominent_god:
                transparent_info = f'，{prominent_god}（{tg["stem"]}）在{tg["sourcePillar"]}支透出於{tg["transparentPillar"]}干'
                break

        pattern_logic = (
            f'月令{month_branch}藏干{month_main_qi}為{month_main_ten_god}（格局）'
            f'{transparent_info}。'
            f'日主{dm_element}（{day_master_stem}），強度{strength_v2["score"]}分'
        )

    # Strength relation
    classification = strength_v2['classification']
    useful_god_el = effective_gods.get('usefulGod', '')
    taboo_god_el = effective_gods.get('tabooGod', '')
    if cong_ge:
        strength_relation = f'{cong_ge["name"]}，順從{cong_ge["dominantElement"]}，忌比劫/印生扶'
    elif classification in ('strong', 'very_strong'):
        strength_relation = f'身強，喜{useful_god_el}洩秀/克制，忌{taboo_god_el}生扶'
    elif classification in ('weak', 'very_weak'):
        strength_relation = f'身弱，喜{useful_god_el}生扶，忌{taboo_god_el}克洩'
    else:
        strength_relation = f'身中和，用{useful_god_el}平衡'

    # Dominant Ten Gods ranking
    dominant_ten_gods = _rank_dominant_ten_gods(
        pillars, day_master_stem, prominent_god, cong_ge,
        tougan_analysis, five_elements_balance,
    )

    return {
        'patternName': pattern_name,
        'patternLogic': pattern_logic,
        'patternStrengthRelation': strength_relation,
        'dominantTenGods': dominant_ten_gods,
    }


def _rank_dominant_ten_gods(
    pillars: Dict,
    day_master_stem: str,
    prominent_god: str,
    cong_ge: Optional[Dict],
    tougan_analysis: List[Dict],
    five_elements_balance: Dict[str, float],
) -> List[str]:
    """
    Rank top 2 dominant Ten Gods by algorithm:
    1. 月令 primary Ten God first (月令優先)
    2. Transparent Ten Gods by pillar weight
    3. Highest element weight
    從格 override: dominant element's Ten God first
    """
    dm_element = STEM_ELEMENT[day_master_stem]

    if cong_ge:
        # 從格: dominant element's Ten God as #1
        dominant_el = cong_ge['dominantElement']
        # Find the Ten God for a hypothetical stem of that element
        # Use the first stem of the dominant element to derive the Ten God name
        from .constants import HEAVENLY_STEMS
        dominant_tg = None
        for stem in HEAVENLY_STEMS:
            if STEM_ELEMENT[stem] == dominant_el:
                dominant_tg = derive_ten_god(day_master_stem, stem)
                break
        # Find second most powerful
        candidates = []
        for tg in tougan_analysis:
            if tg['status'] == 'transparent' and tg['tenGod'] != dominant_tg:
                candidates.append(tg['tenGod'])
        if candidates:
            return [dominant_tg, candidates[0]] if dominant_tg else candidates[:2]
        return [dominant_tg] if dominant_tg else [prominent_god]

    # Normal: 月令 first
    ranked = [prominent_god]

    # Transparent Ten Gods by pillar weight
    pillar_weight_order = {'month': 0, 'day': 1, 'hour': 2, 'year': 3}
    transparent_sorted = sorted(
        [t for t in tougan_analysis if t['status'] == 'transparent'],
        key=lambda t: pillar_weight_order.get(t['sourcePillar'], 99),
    )
    for tg in transparent_sorted:
        if tg['tenGod'] not in ranked:
            ranked.append(tg['tenGod'])
            if len(ranked) >= 2:
                break

    # If still need more, use element weight
    if len(ranked) < 2:
        # Find element with highest weight (excluding DM element)
        sorted_els = sorted(
            [(el, wt) for el, wt in five_elements_balance.items() if el != dm_element],
            key=lambda x: x[1],
            reverse=True,
        )
        for el, wt in sorted_els:
            from .constants import HEAVENLY_STEMS
            for stem in HEAVENLY_STEMS:
                if STEM_ELEMENT[stem] == el:
                    tg = derive_ten_god(day_master_stem, stem)
                    if tg not in ranked:
                        ranked.append(tg)
                        break
            if len(ranked) >= 2:
                break

    return ranked[:2]


# ============================================================
# Children Insights
# ============================================================

def build_children_insights(
    pillars: Dict,
    day_master_stem: str,
    tougan_analysis: List[Dict],
    five_elements_balance: Dict[str, float],
) -> Dict[str, Any]:
    """Build childrenInsights — 食傷 count + hour pillar data."""
    dm_element = STEM_ELEMENT[day_master_stem]
    shishan_element = ELEMENT_PRODUCES[dm_element]  # 食傷 = element DM produces

    # Count manifest 食傷 in Heavenly Stems (年/月/時干, NOT 日干)
    manifest_count = 0
    for pname in ('year', 'month', 'hour'):
        stem_el = STEM_ELEMENT[pillars[pname]['stem']]
        if stem_el == shishan_element:
            manifest_count += 1

    # Count latent 食傷 in branch 本氣 that are NOT transparent
    transparent_stems = set()
    shishan_transparent = []
    for tg in tougan_analysis:
        if tg['status'] == 'transparent' and tg['tenGod'] in ('食神', '傷官'):
            transparent_stems.add(tg['stem'])
            shishan_transparent.append(tg['tenGod'])

    latent_count = 0
    for pname in ('year', 'month', 'day', 'hour'):
        branch = pillars[pname]['branch']
        hidden = HIDDEN_STEMS.get(branch, [])
        if hidden:
            main_qi = hidden[0]
            main_qi_el = STEM_ELEMENT[main_qi]
            if main_qi_el == shishan_element and main_qi not in transparent_stems:
                latent_count += 1

    # Hour branch 本氣's Ten God
    hour_branch = pillars['hour']['branch']
    hour_hidden = HIDDEN_STEMS.get(hour_branch, [])
    hour_pillar_ten_god = derive_ten_god(day_master_stem, hour_hidden[0]) if hour_hidden else ''

    # Is 食傷 suppressed by strong 印?
    yin_element = ELEMENT_PRODUCED_BY[dm_element]  # 印 = element that produces DM
    yin_weight = five_elements_balance.get(yin_element, 0)
    shishan_weight = five_elements_balance.get(shishan_element, 0)
    is_suppressed = yin_weight > 25 and yin_weight > shishan_weight * 1.5

    # Hour branch life stage
    hour_branch_life_stage = get_life_stage(day_master_stem, hour_branch)

    return {
        'shishanManifestCount': manifest_count,
        'shishanLatentCount': latent_count,
        'shishanTransparent': shishan_transparent,
        'hourPillarTenGod': hour_pillar_ten_god,
        'isShishanSuppressed': is_suppressed,
        'hourBranchLifeStage': hour_branch_life_stage,
    }


# ============================================================
# Parents Insights
# ============================================================

def build_parents_insights(
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict[str, str],
) -> Dict[str, Any]:
    """Build parentsInsights — year pillar + Ten God data."""
    dm_element = STEM_ELEMENT[day_master_stem]

    # Year stem = father star
    year_stem = pillars['year']['stem']
    father_star = derive_ten_god(day_master_stem, year_stem)

    # Year branch 本氣 = mother star
    year_branch = pillars['year']['branch']
    year_hidden = HIDDEN_STEMS.get(year_branch, [])
    mother_star = derive_ten_god(day_master_stem, year_hidden[0]) if year_hidden else ''

    # Father element = 財星 element (element DM overcomes) — gender-neutral per 《子平真詮》
    father_element = ELEMENT_OVERCOMES[dm_element]
    # Mother element = 印星 element (element that produces DM) — gender-neutral
    mother_element = ELEMENT_PRODUCED_BY[dm_element]

    # Year pillar relation: whether year branch 生/剋 year stem
    year_stem_el = STEM_ELEMENT[year_stem]
    year_branch_main_el = STEM_ELEMENT[year_hidden[0]] if year_hidden else ''
    if year_branch_main_el:
        if ELEMENT_PRODUCES.get(year_branch_main_el) == year_stem_el:
            year_pillar_relation = '年支生年干（父母和諧）'
        elif ELEMENT_OVERCOMES.get(year_branch_main_el) == year_stem_el:
            year_pillar_relation = '年支剋年干（父母關係有壓力）'
        elif year_branch_main_el == year_stem_el:
            year_pillar_relation = '年支年干同元素（父母一致）'
        else:
            year_pillar_relation = '年支年干無直接生剋'
    else:
        year_pillar_relation = ''

    # Year pillar favorability
    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')
    taboo_god = effective_gods.get('tabooGod', '')
    enemy_god = effective_gods.get('enemyGod', '')

    if year_stem_el == useful_god or year_stem_el == favorable_god:
        favorability = '喜神'
    elif year_stem_el == taboo_god or year_stem_el == enemy_god:
        favorability = '忌神'
    else:
        favorability = '中性'

    return {
        'fatherStar': father_star,
        'motherStar': mother_star,
        'fatherElement': father_element,
        'motherElement': mother_element,
        'yearPillarRelation': year_pillar_relation,
        'yearPillarFavorability': favorability,
    }


# ============================================================
# Boss Compatibility
# ============================================================

def build_boss_compatibility(prominent_god: str) -> Dict[str, Any]:
    """Build bossCompatibility from 格局 Ten God archetype."""
    style = TEN_GOD_WORK_STYLE.get(prominent_god, TEN_GOD_WORK_STYLE['比肩'])
    return {
        'dominantStyle': style['dominantStyle'],
        'idealBossType': style['idealBossType'],
        'workplaceStrengths': style['workplaceStrengths'],
        'workplaceWarnings': style['workplaceWarnings'],
    }


# ============================================================
# Benefactors Computation
# ============================================================

def compute_benefactors(
    effective_gods: Dict[str, str],
    year_branch: str,
) -> Dict[str, Any]:
    """
    Compute career benefactors by element and zodiac.
    Uses 用神 element's 三合 group for zodiac benefactors.
    """
    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')

    # By 五行
    benefactor_elements = []
    if useful_god:
        benefactor_elements.append(useful_god)
    if favorable_god and favorable_god != useful_god:
        benefactor_elements.append(favorable_god)

    # By 生肖: 用神 element's 三合 group
    benefactor_zodiacs = []
    sanhe_branches = ELEMENT_SANHE_BRANCHES.get(useful_god, [])
    own_zodiac = BRANCH_ZODIAC.get(year_branch, '')
    for branch in sanhe_branches:
        zodiac = BRANCH_ZODIAC.get(branch, '')
        if zodiac and zodiac != own_zodiac:
            benefactor_zodiacs.append(zodiac)

    return {
        'career_benefactors_element': benefactor_elements,
        'career_benefactors_zodiac': benefactor_zodiacs,
    }


# ============================================================
# Partner Zodiacs
# ============================================================

def compute_partner_zodiacs(day_branch: str) -> Dict[str, Any]:
    """
    Compute compatible partner zodiacs based on day branch (配偶宮).
    Uses 六合 + 三合 partners.
    """
    partner_zodiacs = []

    # 六合 partner
    liuhe_partner = HARMONY_LOOKUP.get(day_branch)
    if liuhe_partner:
        partner_zodiacs.append(BRANCH_ZODIAC.get(liuhe_partner, ''))

    # 三合 group: find the group containing day_branch, get the other 2
    for harmony in TRIPLE_HARMONIES:
        if day_branch in harmony['branches']:
            for branch in harmony['order']:
                if branch != day_branch:
                    zodiac = BRANCH_ZODIAC.get(branch, '')
                    if zodiac and zodiac not in partner_zodiacs:
                        partner_zodiacs.append(zodiac)
            break

    # Also compute partner elements (喜用 elements)
    return {
        'partner_zodiac': partner_zodiacs,
    }


# ============================================================
# Romance Years Computation
# ============================================================

def compute_romance_years(
    gender: str,
    day_master_stem: str,
    day_branch: str,
    year_branch: str,
    annual_stars: List[Dict],
    kong_wang: List[str],
) -> List[int]:
    """
    Gender-aware romance year computation with 空亡 filter.
    Returns up to 5 years, priority: primary → secondary A/B → supplementary.
    """
    dm_element = STEM_ELEMENT[day_master_stem]

    # 1. Spouse star element
    if gender == 'male':
        spouse_star_element = ELEMENT_OVERCOMES[dm_element]  # 正財
    else:
        spouse_star_element = ELEMENT_OVERCOME_BY[dm_element]  # 正官

    # 2. 桃花 branch
    taohua_branch = TAOHUA.get(day_branch, '')

    # 3. 紅鸞/天喜 branches
    hongluan_branch = HONGLUAN.get(year_branch, '')
    tianxi_branch = TIANXI.get(year_branch, '')

    # 4. 六合 partner of day branch
    liuhe_partner = HARMONY_LOOKUP.get(day_branch, '')

    # Collect candidates with priority
    primary = []      # 六合 with day branch
    secondary_a = []  # Annual stem carries spouse star
    secondary_b = []  # 三合 with day branch
    supplementary = []  # 桃花/紅鸞/天喜

    for star in annual_stars:
        year = star['year']
        annual_branch = star['branch']
        annual_stem = star['stem']

        # Filter: 空亡
        if annual_branch in kong_wang:
            continue

        # Filter: 三刑 with day branch (danger, not romance)
        if _check_sanxing_pair(annual_branch, day_branch):
            continue

        # Primary: 六合 with day branch
        if annual_branch == liuhe_partner:
            primary.append(year)

        # Secondary A: stem carries spouse star element
        if STEM_ELEMENT.get(annual_stem) == spouse_star_element:
            if year not in primary:
                secondary_a.append(year)

        # Secondary B: 三合 with day branch
        for harmony in TRIPLE_HARMONIES:
            if day_branch in harmony['branches'] and annual_branch in harmony['branches']:
                if annual_branch != day_branch and year not in primary:
                    secondary_b.append(year)
                break

        # Supplementary: 桃花/紅鸞/天喜
        if annual_branch in (taohua_branch, hongluan_branch, tianxi_branch):
            if year not in primary and year not in secondary_a and year not in secondary_b:
                supplementary.append(year)

    # Combine with priority, deduplicate, sort chronologically
    all_years = []
    seen = set()
    for year_list in [primary, secondary_a, secondary_b, supplementary]:
        for y in year_list:
            if y not in seen:
                all_years.append(y)
                seen.add(y)
            if len(all_years) >= 5:
                break
        if len(all_years) >= 5:
            break

    return sorted(all_years)


# ============================================================
# Parent Health Years Computation
# ============================================================

def compute_parent_health_years(
    day_master_stem: str,
    annual_stars: List[Dict],
) -> Dict[str, List[int]]:
    """
    Compute danger years for parents based on Ten God elements.
    Father = 財星 element (DM overcomes), Mother = 印星 element (produces DM).
    Gender-neutral per 《子平真詮》.
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    father_element = ELEMENT_OVERCOMES[dm_element]  # 財星 element
    mother_element = ELEMENT_PRODUCED_BY[dm_element]  # 印星 element

    # Element that overcomes father/mother
    father_threat = ELEMENT_OVERCOME_BY[father_element]  # What 克 father
    mother_threat = ELEMENT_OVERCOME_BY[mother_element]  # What 克 mother

    father_years = []
    mother_years = []

    for star in annual_stars:
        stem_el = STEM_ELEMENT.get(star['stem'], '')
        if stem_el == father_threat and len(father_years) < 5:
            father_years.append(star['year'])
        if stem_el == mother_threat and len(mother_years) < 5:
            mother_years.append(star['year'])

    return {
        'father': father_years,
        'mother': mother_years,
    }


# ============================================================
# Luck Period Enrichment
# ============================================================

def enrich_luck_periods(
    luck_periods: List[Dict],
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict[str, str],
) -> List[Dict]:
    """
    Enrich each luck period with score (0-100) and phase split.

    Scoring formula (base 50):
    - Stem 用/喜/忌/仇 scoring
    - Branch 本氣 scoring
    - Interaction bonuses/penalties (六沖, 三刑, 反吟, 伏吟, 歲運並臨)
    """
    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')
    taboo_god = effective_gods.get('tabooGod', '')
    enemy_god = effective_gods.get('enemyGod', '')

    enriched = []
    for lp in luck_periods:
        score = 50.0  # Base

        stem = lp['stem']
        branch = lp['branch']
        stem_el = STEM_ELEMENT.get(stem, '')
        branch_hidden = HIDDEN_STEMS.get(branch, [])
        branch_main_el = STEM_ELEMENT[branch_hidden[0]] if branch_hidden else ''

        # Stem scoring
        if stem_el == useful_god:
            score += 15
        elif stem_el == favorable_god:
            score += 10
        elif stem_el == taboo_god:
            score -= 15
        elif stem_el == enemy_god:
            score -= 10

        # Branch 本氣 scoring
        if branch_main_el == useful_god:
            score += 20
        elif branch_main_el == favorable_god:
            score += 10
        elif branch_main_el == taboo_god:
            score -= 20
        elif branch_main_el == enemy_god:
            score -= 10

        # Interaction bonuses/penalties from natalInteractions
        interactions_summary = []
        natal_ints = lp.get('natalInteractions', [])
        for interaction in natal_ints:
            int_type = interaction.get('type', '')
            pillar = interaction.get('pillar', '')

            if int_type == '三合':
                formed_el = interaction.get('element', '')
                if formed_el == useful_god:
                    score += 15
                    interactions_summary.append(f'三合{formed_el}局（+15）')

            elif int_type == '六合':
                formed_el = interaction.get('element', '')
                if formed_el == useful_god:
                    score += 5
                    interactions_summary.append(f'六合{formed_el}（+5）')

            elif int_type == '六沖':
                if pillar == 'day':
                    score -= 10
                    interactions_summary.append('沖日支/配偶宮（-10）')
                elif pillar == 'month':
                    score -= 10
                    interactions_summary.append('沖月支/事業宮（-10）')

            elif int_type == '反吟':
                if pillar == 'day':
                    score -= 15
                    interactions_summary.append('反吟日柱（-15）')
                elif pillar == 'month':
                    score -= 12
                    interactions_summary.append('反吟月柱（-12）')
                elif pillar in ('year', 'hour'):
                    score -= 8
                    interactions_summary.append(f'反吟{pillar}柱（-8）')

            elif int_type == '伏吟':
                if pillar in ('day', 'month'):
                    score -= 5
                    interactions_summary.append(f'伏吟{pillar}柱（-5）')

        # 三刑 check: LP branch against all 4 natal branches
        for pname in ['year', 'month', 'day', 'hour']:
            natal_branch = pillars[pname]['branch']
            if _check_sanxing_pair(branch, natal_branch):
                score -= 5
                interactions_summary.append(f'三刑{pname}支（-5）')

        # 歲運並臨 (check within natal interactions if present)
        for interaction in natal_ints:
            if interaction.get('type') == '歲運並臨':
                # Check if the matching element is favorable or not
                sybl_el = STEM_ELEMENT.get(interaction.get('stem', ''), '')
                if sybl_el == useful_god or sybl_el == favorable_god:
                    score += 10
                    interactions_summary.append('歲運並臨（喜用，+10）')
                else:
                    score -= 10
                    interactions_summary.append('歲運並臨（忌仇，-10）')

        # Cap [0, 100]
        score = max(0, min(100, score))

        # Phase split description
        stem_phase = f'前5年{stem}（{stem_el}）主導'
        branch_phase = f'後5年{branch}（{branch_main_el}）主導'

        enriched.append({
            'stem': stem,
            'branch': branch,
            'startAge': lp.get('startAge', 0),
            'endAge': lp.get('endAge', 0),
            'startYear': lp.get('startYear', 0),
            'endYear': lp.get('endYear', 0),
            'tenGod': lp.get('tenGod', ''),
            'score': round(score),
            'stemPhase': stem_phase,
            'branchPhase': branch_phase,
            'interactions': interactions_summary,
            'isCurrent': lp.get('isCurrent', False),
        })

    return enriched


# ============================================================
# Main Orchestrator
# ============================================================

def generate_lifetime_enhanced_insights(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    five_elements_balance: Dict[str, float],
    effective_gods: Dict[str, str],
    prominent_god: str,
    strength_v2: Dict,
    cong_ge: Optional[Dict],
    tougan_analysis: List[Dict],
    ten_god_position_analysis: List[Dict],
    luck_periods: List[Dict],
    annual_stars: List[Dict],
    kong_wang: List[str],
) -> Dict[str, Any]:
    """
    Generate all enhanced deterministic insights for lifetime V2 reading.

    Returns a dict with:
      - patternNarrative
      - childrenInsights
      - parentsInsights
      - bossCompatibility
      - deterministic data (investments, careers, directions, benefactors, etc.)
      - luck_periods_enriched
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')
    taboo_god = effective_gods.get('tabooGod', '')
    enemy_god = effective_gods.get('enemyGod', '')

    # Pre-analysis fields
    pattern_narrative = build_pattern_narrative(
        pillars, day_master_stem, prominent_god, strength_v2, cong_ge,
        effective_gods, tougan_analysis, ten_god_position_analysis,
        five_elements_balance,
    )

    children_insights = build_children_insights(
        pillars, day_master_stem, tougan_analysis, five_elements_balance,
    )

    parents_insights = build_parents_insights(
        pillars, day_master_stem, effective_gods,
    )

    boss_compatibility = build_boss_compatibility(prominent_god)

    # Deterministic data: investments
    favorable_investments = []
    unfavorable_investments = []
    for el in [useful_god, favorable_god]:
        if el:
            for inv in ELEMENT_FAVORABLE_INVESTMENTS.get(el, []):
                if inv not in favorable_investments:
                    favorable_investments.append(inv)
    for el in [taboo_god, enemy_god]:
        if el:
            for inv in ELEMENT_UNFAVORABLE_INVESTMENTS.get(el, []):
                if inv not in unfavorable_investments:
                    unfavorable_investments.append(inv)

    # Career directions (from 用神 element)
    career_directions = ELEMENT_INDUSTRIES_DETAILED.get(useful_god, [])

    # Favorable direction
    favorable_direction = ELEMENT_DIRECTION.get(useful_god, '')

    # Benefactors
    year_branch = pillars['year']['branch']
    benefactors = compute_benefactors(effective_gods, year_branch)

    # Partner zodiacs
    day_branch = pillars['day']['branch']
    partner_data = compute_partner_zodiacs(day_branch)
    # Add partner element (from 喜用 elements)
    partner_elements = []
    if useful_god and useful_god not in partner_elements:
        partner_elements.append(useful_god)
    if favorable_god and favorable_god != useful_god and favorable_god not in partner_elements:
        partner_elements.append(favorable_god)

    # Romance years
    romance_years = compute_romance_years(
        gender, day_master_stem, day_branch, year_branch,
        annual_stars, kong_wang,
    )

    # Parent health years
    parent_health_years = compute_parent_health_years(
        day_master_stem, annual_stars,
    )

    # Enriched luck periods
    luck_periods_enriched = enrich_luck_periods(
        luck_periods, pillars, day_master_stem, effective_gods,
    )

    # Find best period (highest score, at least 2 periods needed)
    best_period = None
    if len(luck_periods_enriched) >= 2:
        best_period = max(luck_periods_enriched, key=lambda p: p['score'])

    # Annual Ten God (for Call 2 annual_finance anchor)
    current_year = datetime.now().year
    annual_ten_god = ''
    for star in annual_stars:
        if star['year'] == current_year:
            annual_ten_god = derive_ten_god(day_master_stem, star['stem'])
            break

    return {
        'patternNarrative': pattern_narrative,
        'childrenInsights': children_insights,
        'parentsInsights': parents_insights,
        'bossCompatibility': boss_compatibility,
        'deterministic': {
            'favorable_investments': favorable_investments,
            'unfavorable_investments': unfavorable_investments,
            'career_directions': career_directions,
            'favorable_direction': favorable_direction,
            'career_benefactors_element': benefactors['career_benefactors_element'],
            'career_benefactors_zodiac': benefactors['career_benefactors_zodiac'],
            'partner_element': partner_elements,
            'partner_zodiac': partner_data['partner_zodiac'],
            'romance_years': romance_years,
            'parent_health_years': parent_health_years,
            'luck_periods_enriched': luck_periods_enriched,
            'best_period': best_period,
            'annualTenGod': annual_ten_god,
        },
    }
