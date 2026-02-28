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
    BRANCH_ELEMENT,
    EARTHLY_BRANCHES,
    ELEMENT_OVERCOMES,
    ELEMENT_OVERCOME_BY,
    ELEMENT_PRODUCED_BY,
    ELEMENT_PRODUCES,
    HEAVENLY_STEMS,
    HIDDEN_STEMS,
    HONGLUAN,
    LUSHEN,
    STEM_COMBINATIONS,
    STEM_ELEMENT,
    TAOHUA,
    TIANXI,
    TIANYI_GUIREN,
    WENCHANG,
    YIMA,
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
from .shen_sha import get_all_shen_sha
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
# Personality Anchors: 4-Layer Model Lookup Tables
# ============================================================

# Layer 1: Day Master (日主) personality archetypes — universally accepted across all Bazi schools
DAY_MASTER_PERSONALITY: Dict[str, Dict[str, str]] = {
    '甲': {
        'archetype': '參天大樹',
        'traits': '正直有原則、有領導氣質、做事有規劃、但性格較固執不易妥協',
    },
    '乙': {
        'archetype': '花草藤蔓',
        'traits': '柔韌適應力強、善於合作與周旋、外表溫柔但內心有主見',
    },
    '丙': {
        'archetype': '太陽烈火',
        'traits': '熱情開朗、影響力大、樂觀積極、但有時過於張揚或急躁',
    },
    '丁': {
        'archetype': '燭光星火',
        'traits': '外柔內韌、專注力強、善於啟發他人、不易屈服',
    },
    '戊': {
        'archetype': '高山厚土',
        'traits': '穩重可靠、包容力強、外柔內剛、重承諾但行動較慢',
    },
    '己': {
        'archetype': '田園沃土',
        'traits': '滋養型人格、靈活務實、不愛出風頭但策略性強',
    },
    '庚': {
        'archetype': '刀劍鋼鐵',
        'traits': '果斷勇敢、執行力強、重義氣、但過於剛硬易得罪人',
    },
    '辛': {
        'archetype': '珠玉珍寶',
        'traits': '外柔內剛、追求完美、有審美品味、重質感但容易鑽牛角尖',
    },
    '壬': {
        'archetype': '江河大海',
        'traits': '自由奔放、思維開闊、善於連結溝通、但容易衝動不定',
    },
    '癸': {
        'archetype': '雨露霧氣',
        'traits': '直覺敏銳、洞察力強、內斂含蓄、善於策略但有時猶豫不決',
    },
}

# Layer 2+3: Ten God (十神) personality traits — position-specific for Iron Triangle
# 'external' = 月干 (external projection), 'internal' = 日支 (true inner self),
# 'motivation' = 時干 (drives and goals), 'core' = general/格局 usage
TEN_GOD_PERSONALITY: Dict[str, Dict[str, str]] = {
    # Note: 比肩's external/internal/motivation ARE used — 比肩 is only skipped
    # at 月干 position (redundant with DM Layer 1), but still appears at 日支 or 時干.
    '比肩': {
        'core': '獨立自主、有主見、重視自我價值',
        'external': '表現得堅持己見、不輕易妥協、有競爭意識',
        'internal': '內心重視公平、珍惜同儕關係、但容易固執',
        'motivation': '追求自我實現、希望靠自身能力證明價值',
    },
    '劫財': {
        'core': '好勝心強、社交能力好、行動力旺盛',
        'external': '表現得豪爽大方、善於號召、人緣佳但衝動',
        'internal': '內心不服輸、佔有慾強、容易因義氣而損財',
        'motivation': '渴望被認同、追求影響力與團體中的領導地位',
    },
    '食神': {
        'core': '溫和聰慧、注重生活品味、有藝術天賦',
        'external': '表現得隨和親切、談吐優雅、讓人感到舒適',
        'internal': '內心追求精神滿足、重視生活品質、不喜壓力',
        'motivation': '渴望自在表達、享受創造與分享的過程',
    },
    '傷官': {
        'core': '聰明伶俐、口才出眾、思維敏捷且叛逆',
        'external': '表現得才華橫溢、批判性強、不畏權威',
        'internal': '內心追求自由、不甘平庸、容易看不起他人',
        'motivation': '渴望突破常規、證明自己的與眾不同',
    },
    '偏財': {
        'core': '慷慨大方、社交手腕好、善於把握機會',
        'external': '表現得八面玲瓏、出手闊綽、人脈廣泛',
        'internal': '內心追求新鮮刺激、喜歡冒險但容易見異思遷',
        'motivation': '渴望自由掌控資源、享受創造財富的過程',
    },
    '正財': {
        'core': '務實勤奮、理財保守、做事踏實',
        'external': '表現得穩重可靠、節儉有序、值得信賴',
        'internal': '內心重視安全感、對金錢精打細算、不喜冒險',
        'motivation': '追求穩定收入與物質安全感',
    },
    '偏官': {
        'core': '果斷進取、勇於挑戰、有魄力與威嚴',
        'external': '表現得強勢有力、不怕衝突、行動果決',
        'internal': '內心有壓力感、常處於備戰狀態、對自己要求嚴格',
        'motivation': '渴望掌控局面、征服困難、建立權威',
    },
    '正官': {
        'core': '守規矩、責任心強、自律嚴謹',
        'external': '表現得端正有禮、循規蹈矩、適合體制內發展',
        'internal': '內心重視名譽與社會地位、害怕犯錯或失面子',
        'motivation': '追求社會認可、穩定的晉升與體面的生活',
    },
    '偏印': {
        'core': '思想獨特、興趣廣泛但不專一、有藝術靈感',
        'external': '表現得特立獨行、神秘感強、不按常理出牌',
        'internal': '內心孤獨、渴望理解但不善表達、容易鑽牛角尖',
        'motivation': '渴望找到獨特定位、追求與眾不同的學問或技藝',
    },
    '正印': {
        'core': '善良仁厚、學習力強、重視精神成長',
        'external': '表現得溫文爾雅、樂於助人、有長輩緣',
        'internal': '內心依賴感強、追求安全與被保護、容易安逸懶散',
        'motivation': '渴望知識充實、追求精神層面的安定感',
    },
}

# Layer 4: Strength modulation — keys match strength_v2['classification'] output exactly
STRENGTH_PERSONALITY_MODIFIER: Dict[str, str] = {
    'very_strong': '性格特質表現極為強烈、自信果斷但容易過於主觀固執',
    'strong': '性格特質表現明顯、有自信與主見',
    'neutral': '性格表現適中平穩、能屈能伸',
    'weak': '性格特質表現較為含蓄、傾向配合他人但缺乏主動性',
    'very_weak': '性格特質表現較弱、容易受外在環境影響、需借助外力發揮潛能',
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

        if prominent_god == month_main_ten_god:
            # 本氣 is the格局 itself (e.g., 子月 壬 透干)
            pattern_logic = (
                f'月令{month_branch}藏干{month_main_qi}為{month_main_ten_god}（格局）'
                f'{transparent_info}。'
                f'日主{dm_element}（{day_master_stem}），強度{strength_v2["score"]}分'
            )
        elif transparent_info:
            # 本氣 ≠ 格局, but there IS a transparent stem (雜氣格 typical case)
            pattern_logic = (
                f'月令{month_branch}藏干{month_main_qi}為{month_main_ten_god}，'
                f'但取透干{prominent_god}為格局'
                f'{transparent_info}。'
                f'日主{dm_element}（{day_master_stem}），強度{strength_v2["score"]}分'
            )
        else:
            # No transparency — fallback (月干 or frequency-based prominent_god)
            # Per 《子平真詮》: 無透干則取本氣或月干
            pattern_logic = (
                f'月令{month_branch}藏干{month_main_qi}為{month_main_ten_god}，'
                f'取{prominent_god}為格局。'
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
        pass  # HEAVENLY_STEMS imported at module level
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
            pass  # HEAVENLY_STEMS imported at module level
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
    *,
    effective_gods: Optional[Dict[str, str]] = None,
    strength_classification: str = 'neutral',
) -> Dict[str, Any]:
    """
    Build childrenInsights — 食傷 count + hour pillar data + 偏印奪食 detection.

    The 偏印奪食 (梟神奪食) detection uses a 6-gate algorithm:
      Gate 1: DM strength + 用神/忌神 check (weak DMs benefit from 偏印)
      Gate 2: Find 偏印 in manifest stems (must be 偏印, NOT 正印)
      Gate 3: Find 食神 in manifest stems (偏印 specifically robs 食神)
      Gate 4: Strength comparison (印 element > 食傷 element)
      Gate 5: Positional adjacency (adjacent pillars = stronger effect)
      Gate 6: Resolution check (偏財 transparent = 偏財制梟)
    """
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
        for hs in hidden:
            hs_el = STEM_ELEMENT.get(hs, '')
            if hs_el == shishan_element and hs not in transparent_stems:
                latent_count += 1
                # break: each branch counts at most once (no branch has 2 hidden stems of same element)
                break

    # Hour branch 本氣's Ten God
    hour_branch = pillars['hour']['branch']
    hour_hidden = HIDDEN_STEMS.get(hour_branch, [])
    hour_pillar_ten_god = derive_ten_god(day_master_stem, hour_hidden[0]) if hour_hidden else ''

    # ── 偏印奪食 (梟神奪食) Detection — 6-gate algorithm ──
    yin_element = ELEMENT_PRODUCED_BY[dm_element]  # 印 = element that produces DM
    yin_weight = five_elements_balance.get(yin_element, 0)
    shishan_weight = five_elements_balance.get(shishan_element, 0)

    is_suppressed = False
    suppression_detail = ''

    if effective_gods is None:
        effective_gods = {}

    # ── Gate 1: DM strength + 用神/忌神 check ──
    # Very weak DM always benefits from 偏印 (生身有益) → no suppression
    # Weak DM: only suppress if seal element IS 忌/仇 (chart doesn't want it)
    taboo_god = effective_gods.get('tabooGod', '')
    enemy_god = effective_gods.get('enemyGod', '')

    if strength_classification == 'very_weak':
        is_suppressed = False
        suppression_detail = '身極弱，偏印生身有益'
    elif strength_classification == 'weak' and yin_element not in (taboo_god, enemy_god):
        # Weak DM AND seal element is NOT 忌/仇 → chart wants the seal
        is_suppressed = False
        suppression_detail = '身弱，偏印生身有益'
    else:
        # strong/neutral DM, or weak DM that doesn't want the seal → proceed

        # ── Gate 2: Find 偏印 positions in manifest stems ──
        # Must be 偏印 specifically, NOT 正印 (正印 is nurturing, 偏印 is controlling)
        pianyin_positions = []
        for pname in ('year', 'month', 'hour'):
            stem = pillars[pname]['stem']
            if derive_ten_god(day_master_stem, stem) == '偏印':
                pianyin_positions.append(pname)

        # ── Gate 3: Find 食神 positions in manifest stems ──
        # 偏印 specifically robs 食神 (not 傷官 — different relationship)
        shishen_positions = []
        for pname in ('year', 'month', 'hour'):
            stem = pillars[pname]['stem']
            if derive_ten_god(day_master_stem, stem) == '食神':
                shishen_positions.append(pname)

        if not pianyin_positions or not shishen_positions:
            is_suppressed = False
            suppression_detail = ''
        else:
            # ── Gate 4: Strength comparison ──
            # 印 element weight must exceed 食傷 element weight
            seal_pct_exceeds_food = yin_weight > shishan_weight

            # ── Gate 5: Proximity check ──
            # Adjacent pillars (年-月, 月-時) have direct interaction
            # Non-adjacent (年-時) = 隔柱, weaker → require higher bar (×1.3)
            ADJACENT = {('year', 'month'), ('month', 'year'),
                        ('month', 'hour'), ('hour', 'month')}
            is_adjacent = any(
                (py, ss) in ADJACENT
                for py in pianyin_positions
                for ss in shishen_positions
            )
            if not is_adjacent:
                # Non-adjacent (year-hour): require higher bar
                seal_pct_exceeds_food = yin_weight > shishan_weight * 1.3

            # ── Gate 6: Resolution — 偏財 transparent neutralizes (偏財制梟) ──
            resolved = False
            for pname in ('year', 'month', 'hour'):
                stem = pillars[pname]['stem']
                if derive_ten_god(day_master_stem, stem) == '偏財':
                    resolved = True
                    break

            is_suppressed = seal_pct_exceeds_food and not resolved

            if is_suppressed:
                adj_note = '貼身' if is_adjacent else '隔柱'
                suppression_detail = f'偏印透干剋食神（{adj_note}），印星力量大於食傷'
            elif resolved:
                suppression_detail = '偏印奪食被偏財化解（偏財制梟）'
            else:
                suppression_detail = ''

    # Hour branch life stage
    hour_branch_life_stage = get_life_stage(day_master_stem, hour_branch)

    return {
        'shishanManifestCount': manifest_count,
        'shishanLatentCount': latent_count,
        'shishanTransparent': shishan_transparent,
        'hourPillarTenGod': hour_pillar_ten_god,
        'isShishanSuppressed': is_suppressed,
        'shishanSuppressionDetail': suppression_detail,
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

    # Year stem positional ten god (NOT the father star archetype)
    year_stem = pillars['year']['stem']
    year_stem_ten_god = derive_ten_god(day_master_stem, year_stem)  # Positional
    # 子平真詮 standard: 偏財=父, 正印=母 (gender-neutral, all DMs)
    # Note: 滴天髓 school sometimes uses 正財=父, but this platform follows 子平真詮 consistently
    father_star = '偏財'  # Classical archetype — ALWAYS 偏財

    # Year branch 本氣 positional ten god (NOT the mother star archetype)
    year_branch = pillars['year']['branch']
    year_hidden = HIDDEN_STEMS.get(year_branch, [])
    year_branch_main_ten_god = derive_ten_god(day_master_stem, year_hidden[0]) if year_hidden else ''
    mother_star = '正印'  # Classical archetype — ALWAYS 正印

    # Count father star (偏財) occurrences in chart
    # No dedup — each position (surface + hidden) is independent
    father_star_count = 0
    for pname in ('year', 'month', 'hour'):
        if derive_ten_god(day_master_stem, pillars[pname]['stem']) == '偏財':
            father_star_count += 1
    for pname in ('year', 'month', 'day', 'hour'):
        for hs in HIDDEN_STEMS.get(pillars[pname]['branch'], []):
            if derive_ten_god(day_master_stem, hs) == '偏財':
                father_star_count += 1

    # Count mother star (正印) occurrences in chart
    mother_star_count = 0
    for pname in ('year', 'month', 'hour'):
        if derive_ten_god(day_master_stem, pillars[pname]['stem']) == '正印':
            mother_star_count += 1
    for pname in ('year', 'month', 'day', 'hour'):
        for hs in HIDDEN_STEMS.get(pillars[pname]['branch'], []):
            if derive_ten_god(day_master_stem, hs) == '正印':
                mother_star_count += 1

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
        'fatherStar': father_star,            # '偏財' (classical archetype)
        'motherStar': mother_star,            # '正印' (classical archetype)
        'yearStemTenGod': year_stem_ten_god,  # Positional ten god of year stem
        'yearBranchMainTenGod': year_branch_main_ten_god,  # Positional ten god of year branch 本氣
        'fatherElement': father_element,
        'motherElement': mother_element,
        'fatherStarCount': father_star_count,
        'motherStarCount': mother_star_count,
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

    - Element benefactors: 用神 + 喜神 elements (industries that help you)
    - Zodiac benefactors: 年支's 三合 + 六合 partners (people who help you)
      This is the universal standard: people whose birth zodiac forms
      三合 or 六合 with yours are your natural benefactors.
    """
    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')

    # By 五行 (element affinity for industries)
    benefactor_elements = []
    if useful_god:
        benefactor_elements.append(useful_god)
    if favorable_god and favorable_god != useful_god:
        benefactor_elements.append(favorable_god)

    # By 生肖: 年支's 三合 + 六合 partners
    benefactor_zodiacs = []
    own_zodiac = BRANCH_ZODIAC.get(year_branch, '')

    # 三合: find the triple harmony group containing year_branch, get the other 2
    for harmony in TRIPLE_HARMONIES:
        if year_branch in harmony['branches']:
            for branch in harmony['order']:
                if branch != year_branch:
                    zodiac = BRANCH_ZODIAC.get(branch, '')
                    if zodiac and zodiac not in benefactor_zodiacs:
                        benefactor_zodiacs.append(zodiac)
            break

    # 六合: the branch that forms 六合 with year_branch
    liuhe_partner = HARMONY_LOOKUP.get(year_branch)
    if liuhe_partner:
        zodiac = BRANCH_ZODIAC.get(liuhe_partner, '')
        if zodiac and zodiac not in benefactor_zodiacs:
            benefactor_zodiacs.append(zodiac)

    return {
        'career_benefactors_element': benefactor_elements,
        'career_benefactors_zodiac': benefactor_zodiacs,
    }


# ============================================================
# Partner Zodiacs
# ============================================================

def compute_partner_zodiacs(day_branch: str, year_branch: str = '') -> Dict[str, Any]:
    """
    Compute compatible partner zodiacs.

    Primary (配偶宮): day branch 六合 + 三合 — represents spouse palace traits.
    Secondary (年支): year branch 六合 + 三合 — general social/zodiac compatibility.
    Deduplicated: secondary excludes any zodiac already in primary.
    """
    # --- Primary: day branch (配偶宮) ---
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

    # --- Secondary: year branch (生肖配對) ---
    partner_zodiacs_secondary = []
    if year_branch:
        primary_set = set(partner_zodiacs)

        # 六合 partner of year branch
        yr_liuhe = HARMONY_LOOKUP.get(year_branch)
        if yr_liuhe:
            zodiac = BRANCH_ZODIAC.get(yr_liuhe, '')
            if zodiac and zodiac not in primary_set:
                partner_zodiacs_secondary.append(zodiac)

        # 三合 group of year branch
        for harmony in TRIPLE_HARMONIES:
            if year_branch in harmony['branches']:
                for branch in harmony['order']:
                    if branch != year_branch:
                        zodiac = BRANCH_ZODIAC.get(branch, '')
                        if zodiac and zodiac not in primary_set \
                                and zodiac not in partner_zodiacs_secondary:
                            partner_zodiacs_secondary.append(zodiac)
                break

    return {
        'partner_zodiac': partner_zodiacs,
        'partner_zodiac_secondary': partner_zodiacs_secondary,
    }


# ============================================================
# Romance Years Computation
# ============================================================

def _compute_romance_candidates(
    gender: str,
    day_master_stem: str,
    day_branch: str,
    year_branch: str,
    annual_stars: List[Dict],
    kong_wang: List[str],
    birth_year: int = 0,
    current_year: int = 0,
) -> List[Dict[str, Any]]:
    """
    Internal: Gender-aware romance year computation with tier/signal metadata.
    Returns list of dicts: [{'year': 2030, 'tier': 'primary', 'signal': '六合日支'}, ...]
    Up to 5 years, priority: primary → secondary A/B/C/D → supplementary.

    When current_year is provided, filters to: 1 most recent past year + next 10 years.
    This ensures users see actionable future romance years plus one recent validation year.

    Methods:
      - Primary: 六合日支 (annual branch 六合 with day branch)
      - Secondary A: 配偶星天干 (annual stem = spouse star element)
      - Secondary B: 三合日支 (annual branch 三合 with day branch)
      - Secondary C: 天干合日主 (annual stem 五合 with DM stem) — "有人來合你"
      - Secondary D: 紅鸞星動 (紅鸞 = 正緣桃花, stronger marriage signal than generic 桃花)
      - Supplementary: 桃花/天喜 (general attraction, not marriage-specific)
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

    # 5. 天干五合 partner of DM stem (e.g., 甲↔己, 乙↔庚)
    dm_combine_partner = STEM_COMBINATIONS.get(day_master_stem, '')

    # Tier label + signal label mappings
    TIER_INFO = {
        'primary': '六合日支',
        'secondary_a': '配偶星天干',
        'secondary_b': '三合日支',
        'secondary_c': '天干合日主',
        'secondary_d': '紅鸞星動',
        'supplementary_taohua': '桃花',
        'supplementary_tianxi': '天喜',
    }

    # Collect candidates with priority
    primary = []
    secondary_a = []
    secondary_a2 = []  # hidden stem spouse star (R2)
    secondary_b = []
    secondary_c = []
    secondary_d = []
    supplementary = []

    for star in annual_stars:
        year = star['year']
        annual_branch = star['branch']
        annual_stem = star['stem']

        # Filter: skip years before birth
        if birth_year and year < birth_year:
            continue

        # Filter: 空亡
        if annual_branch in kong_wang:
            continue

        # 三刑 flag — don't skip entirely; secondary_a2 (hidden stem) still needs detection
        # Classical: 「刑中帶官星，感情來路不正或有爭端中得配偶」(《三命通會》)
        has_sanxing = _check_sanxing_pair(annual_branch, day_branch)

        # Primary: 六合 with day branch (skip if 三刑)
        # Note: 六合 and 三刑 branch pairs never overlap, but guard kept for safety
        if not has_sanxing:
            if annual_branch == liuhe_partner:
                primary.append({'year': year, 'tier': 'primary', 'signal': TIER_INFO['primary']})

        # Secondary A: stem carries spouse star element (skip if 三刑)
        if not has_sanxing:
            if STEM_ELEMENT.get(annual_stem) == spouse_star_element:
                if not any(p['year'] == year for p in primary):
                    secondary_a.append({'year': year, 'tier': 'secondary_a', 'signal': TIER_INFO['secondary_a']})

        # Secondary A2: annual branch hidden stems contain spouse star element
        # ALLOW with annotation when 三刑 — hidden stem is a weak signal that needs every detection path
        branch_hidden = HIDDEN_STEMS.get(annual_branch, [])
        for hs in branch_hidden:
            if STEM_ELEMENT.get(hs) == spouse_star_element:
                if not any(p['year'] == year for p in primary) \
                        and not any(p['year'] == year for p in secondary_a):
                    is_benqi = (hs == branch_hidden[0])
                    signal = '配偶星藏干(本氣)' if is_benqi else '配偶星藏干'
                    if has_sanxing:
                        signal += '(三刑沖突)'
                    secondary_a2.append({'year': year, 'tier': 'secondary_a2', 'signal': signal})
                break

        # Secondary B: 三合 with day branch (skip if 三刑)
        if not has_sanxing:
            for harmony in TRIPLE_HARMONIES:
                if day_branch in harmony['branches'] and annual_branch in harmony['branches']:
                    if annual_branch != day_branch and not any(p['year'] == year for p in primary):
                        secondary_b.append({'year': year, 'tier': 'secondary_b', 'signal': TIER_INFO['secondary_b']})
                    break

        # Secondary C: 天干合日主 — annual stem forms 五合 with DM (skip if 三刑)
        if not has_sanxing:
            if annual_stem == dm_combine_partner:
                if not any(p['year'] == year for p in primary) \
                        and not any(p['year'] == year for p in secondary_a) \
                        and not any(p['year'] == year for p in secondary_b):
                    secondary_c.append({'year': year, 'tier': 'secondary_c', 'signal': TIER_INFO['secondary_c']})

        # Secondary D: 紅鸞星動 — stronger marriage signal than generic 桃花 (skip if 三刑)
        if not has_sanxing:
            if annual_branch == hongluan_branch:
                if not any(p['year'] == year for p in primary) \
                        and not any(p['year'] == year for p in secondary_a) \
                        and not any(p['year'] == year for p in secondary_b) \
                        and not any(p['year'] == year for p in secondary_c):
                    secondary_d.append({'year': year, 'tier': 'secondary_d', 'signal': TIER_INFO['secondary_d']})

        # Supplementary: 桃花/天喜 (紅鸞 excluded — already in secondary_d) (skip if 三刑)
        if not has_sanxing:
            if annual_branch in (taohua_branch, tianxi_branch):
                if not any(p['year'] == year for p in primary) \
                        and not any(p['year'] == year for p in secondary_a) \
                        and not any(p['year'] == year for p in secondary_b) \
                        and not any(p['year'] == year for p in secondary_c) \
                        and not any(p['year'] == year for p in secondary_d):
                    signal = TIER_INFO['supplementary_taohua'] if annual_branch == taohua_branch else TIER_INFO['supplementary_tianxi']
                    supplementary.append({'year': year, 'tier': 'supplementary', 'signal': signal})

    # Combine with priority, deduplicate, sort chronologically
    # When current_year is set, collect more candidates before filtering by time window
    collect_cap = 20 if current_year else 5
    all_candidates: List[Dict[str, Any]] = []
    seen: Set[int] = set()
    for candidate_list in [primary, secondary_a, secondary_a2, secondary_b, secondary_c, secondary_d, supplementary]:
        for c in candidate_list:
            if c['year'] not in seen:
                all_candidates.append(c)
                seen.add(c['year'])
            if len(all_candidates) >= collect_cap:
                break
        if len(all_candidates) >= collect_cap:
            break

    all_candidates.sort(key=lambda x: x['year'])

    # Time-window filter: 1 most recent past year + next 10 years
    if current_year:
        future_end = current_year + 10
        future = [c for c in all_candidates if current_year <= c['year'] <= future_end]
        past = [c for c in all_candidates if c['year'] < current_year]
        # Keep only the 1 most recent past year (highest year < current_year)
        recent_past = [past[-1]] if past else []
        all_candidates = recent_past + future

    return all_candidates[:5]


def compute_romance_years(
    gender: str,
    day_master_stem: str,
    day_branch: str,
    year_branch: str,
    annual_stars: List[Dict],
    kong_wang: List[str],
    birth_year: int = 0,
    current_year: int = 0,
) -> List[int]:
    """
    Gender-aware romance year computation with 空亡 filter.
    Returns up to 5 years as List[int] (backward compatible).

    When current_year is provided, filters to 1 most recent past year + next 10 years.
    See _compute_romance_candidates() for tier details.
    """
    candidates = _compute_romance_candidates(
        gender, day_master_stem, day_branch, year_branch,
        annual_stars, kong_wang, birth_year, current_year,
    )
    return [c['year'] for c in candidates]


def compute_romance_years_enriched(
    gender: str,
    day_master_stem: str,
    day_branch: str,
    year_branch: str,
    annual_stars: List[Dict],
    kong_wang: List[str],
    birth_year: int = 0,
    current_year: int = 0,
) -> List[Dict[str, Any]]:
    """
    Enriched romance year computation — returns tier/signal metadata per year.
    When current_year is provided, filters to 1 most recent past year + next 10 years.
    Returns: [{'year': 2030, 'tier': 'primary', 'signal': '六合日支'}, ...]
    """
    return _compute_romance_candidates(
        gender, day_master_stem, day_branch, year_branch,
        annual_stars, kong_wang, birth_year, current_year,
    )


# ============================================================
# Romance Years 大運 Tagging
# ============================================================

# 天干合化 lookup — the TRANSFORMED element after 五合
# 甲己合化土, 乙庚合化金, 丙辛合化水, 丁壬合化木, 戊癸合化火
TIANGANG_HEHUA: Dict[frozenset, str] = {
    frozenset(['甲', '己']): '土',
    frozenset(['乙', '庚']): '金',
    frozenset(['丙', '辛']): '水',
    frozenset(['丁', '壬']): '木',
    frozenset(['戊', '癸']): '火',
}


def _find_luck_period_for_year(
    year: int,
    luck_periods_enriched: List[Dict],
) -> Optional[Dict]:
    """Find the luck period (大運) that covers a given year."""
    for lp in luck_periods_enriched:
        start_year = lp.get('startYear', 0)
        end_year = lp.get('endYear', 0)
        if start_year <= year <= end_year:
            return lp
    return None


def tag_romance_years_with_dayun(
    romance_data: List[Dict],
    annual_stars: List[Dict],
    luck_periods_enriched: List[Dict],
    day_branch: str,
    year_branch: str,
    day_master_stem: str,
    gender: str,
) -> List[Dict[str, Any]]:
    """
    Tag each romance year with 大運 context for AI narration.

    Classical basis: 「大運定方向，流年看應期」
    Three-layer analysis: 命局 + 大運 + 流年 (natal + LP + annual).

    Returns list of dicts with dayun_context ('strong'/'moderate'/'weak'),
    dayun_score, dayun_signals, and conflicted flag.
    """
    if not romance_data:
        return []
    if not luck_periods_enriched:
        # No LP data → default all to 'moderate'
        return [
            {**item, 'dayun_context': 'moderate', 'dayun_score': 0,
             'dayun_signals': [], 'conflicted': False, 'conflicted_detail': ''}
            for item in romance_data
        ]

    dm_element = STEM_ELEMENT[day_master_stem]
    hongluan_branch = HONGLUAN.get(year_branch, '')
    taohua_branch = TAOHUA.get(day_branch, '')

    # Spouse star element for hehua comparison
    if gender == 'male':
        spouse_element = ELEMENT_OVERCOMES[dm_element]  # 財星
    else:
        spouse_element = ELEMENT_OVERCOME_BY[dm_element]  # 官星

    dm_combine_partner = STEM_COMBINATIONS.get(day_master_stem, '')

    tagged_results: List[Dict[str, Any]] = []

    for romance_item in romance_data:
        year = romance_item['year']
        tier = romance_item.get('tier', 'supplementary')

        lp = _find_luck_period_for_year(year, luck_periods_enriched)
        if lp is None:
            tagged_results.append({
                **romance_item,
                'dayun_context': 'moderate',
                'dayun_score': 0,
                'dayun_signals': [],
                'conflicted': False,
                'conflicted_detail': '',
            })
            continue

        dayun_score = 0
        signals: List[str] = []
        has_spouse_star_signal = False  # structured boolean for conflicted check

        lp_branch = lp['branch']
        lp_stem = lp['stem']

        # ─── Layer 1: 大運 vs 命局 (LP vs Natal) ───

        # 1a. 大運地支 六合 日支 (合配偶宮) — strongest LP marriage indicator
        if HARMONY_LOOKUP.get(lp_branch) == day_branch:
            dayun_score += 30
            signals.append('大運地支六合日支（合配偶宮）')

        # 1b. 大運天干 五合 DM stem AND check if 配偶星
        lp_stem_tg = derive_ten_god(day_master_stem, lp_stem)
        if lp_stem == dm_combine_partner:
            if gender == 'male' and lp_stem_tg in ('正財', '偏財'):
                dayun_score += 25
                signals.append(f'大運天干{lp_stem}五合日主且為{lp_stem_tg}（合入配偶星）')
                has_spouse_star_signal = True
            elif gender == 'female' and lp_stem_tg in ('正官', '偏官'):
                dayun_score += 25
                signals.append(f'大運天干{lp_stem}五合日主且為{lp_stem_tg}（合入夫星）')
                has_spouse_star_signal = True
            else:
                # 合 but not spouse star — mild positive
                dayun_score += 5
                signals.append(f'大運天干{lp_stem}五合日主')
        else:
            # Not 合, just check if 配偶星
            if gender == 'male' and lp_stem_tg in ('正財', '偏財'):
                dayun_score += 20
                signals.append(f'大運天干{lp_stem}為{lp_stem_tg}（配偶星）')
                has_spouse_star_signal = True
            elif gender == 'female' and lp_stem_tg in ('正官', '偏官'):
                dayun_score += 20
                signals.append(f'大運天干{lp_stem}為{lp_stem_tg}（夫星）')
                has_spouse_star_signal = True

        # 1c. 大運地支 本氣 = 配偶星 element
        lp_branch_hidden = HIDDEN_STEMS.get(lp_branch, [])
        if lp_branch_hidden:
            lp_branch_tg = derive_ten_god(day_master_stem, lp_branch_hidden[0])
            if gender == 'male' and lp_branch_tg in ('正財', '偏財'):
                dayun_score += 15
                signals.append(f'大運地支{lp_branch}本氣為{lp_branch_tg}')
                has_spouse_star_signal = True
            elif gender == 'female' and lp_branch_tg in ('正官', '偏官'):
                dayun_score += 15
                signals.append(f'大運地支{lp_branch}本氣為{lp_branch_tg}')
                has_spouse_star_signal = True

        # 1d. 大運地支 = 紅鸞 branch
        if lp_branch == hongluan_branch:
            dayun_score += 15
            signals.append('大運地支為紅鸞')

        # 1e. 大運地支 = 桃花 branch
        if lp_branch == taohua_branch:
            dayun_score += 10
            signals.append('大運地支為桃花')

        # 1f. NEGATIVE: 大運地支 六沖 日支 (沖配偶宮)
        lp_clashes_day = CLASH_LOOKUP.get(lp_branch) == day_branch
        if lp_clashes_day:
            dayun_score -= 25
            signals.append('大運地支六沖日支（沖配偶宮）')

        # Set conflicted ONLY when 沖配偶宮 co-exists with 配偶星-level signals
        # Classical: "配偶星現而沖配偶宮，感情雖有機緣但波折極大"
        conflicted = False
        conflicted_detail = ''
        if lp_clashes_day and has_spouse_star_signal:
            conflicted = True
            conflicted_detail = '配偶星現而沖配偶宮，感情雖有機緣但波折極大'

        # 1g. 大運 overall score (from enriched luck period)
        lp_score = lp.get('score', 50)
        if lp_score < 35:
            dayun_score -= 10
            signals.append('大運整體偏弱')

        # ─── Layer 2: 大運 vs 流年 (LP vs Annual) ───
        annual_star = next((s for s in annual_stars if s['year'] == year), None)
        if annual_star:
            annual_branch = annual_star['branch']
            annual_stem = annual_star['stem']

            # 2a. 大運地支 六沖 流年地支 (年運相沖 — disrupts the year)
            if CLASH_LOOKUP.get(lp_branch) == annual_branch:
                dayun_score -= 20
                signals.append(f'大運地支{lp_branch}沖流年地支{annual_branch}（年運相沖）')

            # 2b. 大運地支 六合 流年地支 (年運六合 — amplifies)
            elif HARMONY_LOOKUP.get(lp_branch) == annual_branch:
                dayun_score += 10
                signals.append(f'大運地支{lp_branch}合流年地支{annual_branch}（年運相合）')

            # 2c. 大運天干 + 流年天干 五合 → check TRANSFORMED element
            if STEM_COMBINATIONS.get(lp_stem) == annual_stem:
                hehua_element = TIANGANG_HEHUA.get(frozenset([lp_stem, annual_stem]), '')
                if hehua_element and hehua_element == spouse_element:
                    dayun_score += 15
                    signals.append(
                        f'大運天干{lp_stem}合流年天干{annual_stem}，合化{hehua_element}（配偶星方向）'
                    )

        # ─── Layer 3: Tier-based weighting ───
        if tier in ('primary', 'secondary_a') and dayun_score >= 20:
            dayun_score += 5  # small boost for strong-on-strong
        elif tier == 'supplementary' and dayun_score < 0:
            dayun_score -= 10  # stronger penalty for weak-on-weak

        # ─── Classify ───
        if dayun_score >= 30:
            context = 'strong'
        elif dayun_score >= 10:
            context = 'moderate'
        else:
            context = 'weak'

        tagged_results.append({
            'year': year,
            'tier': tier,
            'signal': romance_item.get('signal', ''),
            'dayun_context': context,
            'dayun_score': dayun_score,
            'dayun_signals': signals,
            'conflicted': conflicted,
            'conflicted_detail': conflicted_detail,
        })

    return tagged_results


# ============================================================
# Romance Warning Years Computation (六沖日支)
# ============================================================

def compute_romance_warning_years(
    day_branch: str,
    annual_stars: List[Dict],
    kong_wang: List[str],
    birth_year: int = 0,
) -> List[int]:
    """
    Compute warning years where 流年地支 六沖 日支 (配偶宮).

    Classical basis: 「配偶宮喜靜忌沖」 — the spouse palace prefers stillness.
    - For married persons: relationship instability, conflict, separation risk.
    - For unmarried: paradoxically may 'activate' the spouse palace (婚期觸發).

    Returns up to 5 years sorted chronologically.
    空亡 branches are excluded (clash force weakened when branch is void).
    """
    clash_partner = CLASH_LOOKUP.get(day_branch, '')
    if not clash_partner:
        return []

    warning_years = []
    for star in annual_stars:
        year = star['year']
        annual_branch = star['branch']

        # Filter: skip years before birth
        if birth_year and year < birth_year:
            continue

        # Filter: 空亡 — clash weakened when branch is void
        if annual_branch in kong_wang:
            continue

        if annual_branch == clash_partner:
            warning_years.append(year)

        if len(warning_years) >= 5:
            break

    return sorted(warning_years)


# ============================================================
# Parent Health Years Computation
# ============================================================

def compute_parent_health_years(
    day_master_stem: str,
    annual_stars: List[Dict],
    birth_year: int = 0,
    current_year: int = 0,
) -> Dict[str, List[int]]:
    """
    Compute danger years for parents based on Ten God elements.
    Father = 財星 element (DM overcomes), Mother = 印星 element (produces DM).
    Gender-neutral per 《子平真詮》.

    Classical basis: 「天干不主吉凶，地支本氣為主」
    — Stem shows event TYPE but NOT actual outcomes. Only branch 本氣 governs
    real-world impact. Stem-only threats are therefore DROPPED entirely.

    Priority: stem+branch both threatening > branch-only.
    Filters out years before birth_year (if provided).

    Returns dual output:
    - father/mother: Full list (for AI narration context)
    - father_future/mother_future: Filtered to years >= current_year (for display)
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    father_element = ELEMENT_OVERCOMES[dm_element]  # 財星 element
    mother_element = ELEMENT_PRODUCED_BY[dm_element]  # 印星 element

    # Element that overcomes father/mother
    father_threat = ELEMENT_OVERCOME_BY[father_element]  # What 克 father
    mother_threat = ELEMENT_OVERCOME_BY[mother_element]  # What 克 mother

    # Collect with priority: both(stem+branch) > branch-only
    # Stem-only dropped per classical 「天干不主吉凶」
    father_both = []    # stem AND branch 本氣 both threaten (天克地沖 type)
    father_branch = []  # branch 本氣 only
    mother_both = []
    mother_branch = []

    for star in annual_stars:
        # Filter: skip years before birth
        if birth_year and star['year'] < birth_year:
            continue

        year = star['year']
        stem_el = STEM_ELEMENT.get(star['stem'], '')

        # Branch primary hidden stem (本氣) element
        branch_hidden = HIDDEN_STEMS.get(star['branch'], [])
        branch_el = STEM_ELEMENT.get(branch_hidden[0], '') if branch_hidden else ''

        stem_father = (stem_el == father_threat)
        branch_father = (branch_el == father_threat)
        stem_mother = (stem_el == mother_threat)
        branch_mother = (branch_el == mother_threat)

        # Father danger — only include if branch 本氣 matches threat
        if stem_father and branch_father:
            father_both.append(year)
        elif branch_father:
            father_branch.append(year)

        # Mother danger — only include if branch 本氣 matches threat
        if stem_mother and branch_mother:
            mother_both.append(year)
        elif branch_mother:
            mother_branch.append(year)

    # Combine with priority, up to 5
    def _combine_priority(*lists: List[int], limit: int = 5) -> List[int]:
        result = []
        seen: set = set()
        for lst in lists:
            for y in lst:
                if y not in seen:
                    result.append(y)
                    seen.add(y)
                if len(result) >= limit:
                    return sorted(result)
        return sorted(result)

    father_all = _combine_priority(father_both, father_branch)
    mother_all = _combine_priority(mother_both, mother_branch)

    result = {
        'father': father_all,
        'mother': mother_all,
    }

    # Add future-filtered lists for display (years >= current_year)
    if current_year > 0:
        result['father_future'] = [y for y in father_all if y >= current_year]
        result['mother_future'] = [y for y in mother_all if y >= current_year]

    return result


# ============================================================
# Stars in 空亡 Detection
# ============================================================

# Star definitions: (star_name_zh, star_type, significance_when_voided)
# star_type: 'auspicious' = 吉星 (voided = weakened = bad)
#            'inauspicious' = 凶星 (voided = weakened = good)
#            'neutral' = depends on context
_STAR_KONG_WANG_MEANINGS: Dict[str, Dict[str, str]] = {
    '紅鸞': {
        'type': 'auspicious',
        'significance': '紅鸞落空亡，婚緣需更主動爭取，正緣感應較弱，易錯過姻緣時機',
    },
    '天喜': {
        'type': 'auspicious',
        'significance': '天喜落空亡，喜慶之事需多方創造條件，不宜被動等待',
    },
    '天乙貴人': {
        'type': 'auspicious',
        'significance': '天乙貴人落空亡，貴人助力減弱，需靠自身實力打拼，不宜過度依賴他人',
    },
    '桃花': {
        'type': 'neutral',  # Can be good (tames wild peach blossom) or bad (reduces romance)
        'significance': '桃花落空亡，異性緣表面熱鬧但難以深入，感情易流於表面',
    },
    '驛馬': {
        'type': 'auspicious',
        'significance': '驛馬落空亡，出行遷移之事多有波折，計畫易變動或延遲',
    },
    '文昌': {
        'type': 'auspicious',
        'significance': '文昌落空亡，學業考試需加倍努力，聰明才智不易充分發揮',
    },
    '祿神': {
        'type': 'auspicious',
        'significance': '祿神落空亡，正職收入或仕途發展需更多耐心，福祿來得較晚',
    },
}


def compute_stars_in_kong_wang(
    day_master_stem: str,
    day_branch: str,
    year_branch: str,
    kong_wang: List[str],
) -> List[Dict[str, str]]:
    """
    Check which key natal stars fall in 空亡 branches.

    Classical rule:
    - 吉星落空亡 → auspicious effect weakened ("吉空不吉")
    - 凶星落空亡 → inauspicious effect weakened ("凶空不凶", actually good)

    Returns list of {star, branch, type, significance} for each affected star.
    """
    if not kong_wang:
        return []

    kong_wang_set = set(kong_wang)
    results: List[Dict[str, str]] = []

    # 1. 紅鸞 (from year branch)
    hongluan_branch = HONGLUAN.get(year_branch, '')
    if hongluan_branch and hongluan_branch in kong_wang_set:
        info = _STAR_KONG_WANG_MEANINGS['紅鸞']
        results.append({
            'star': '紅鸞',
            'branch': hongluan_branch,
            'type': info['type'],
            'significance': info['significance'],
        })

    # 2. 天喜 (from year branch)
    tianxi_branch = TIANXI.get(year_branch, '')
    if tianxi_branch and tianxi_branch in kong_wang_set:
        info = _STAR_KONG_WANG_MEANINGS['天喜']
        results.append({
            'star': '天喜',
            'branch': tianxi_branch,
            'type': info['type'],
            'significance': info['significance'],
        })

    # 3. 天乙貴人 (from day stem, returns 2 branches)
    tianyi_branches = TIANYI_GUIREN.get(day_master_stem, [])
    for branch in tianyi_branches:
        if branch in kong_wang_set:
            info = _STAR_KONG_WANG_MEANINGS['天乙貴人']
            results.append({
                'star': '天乙貴人',
                'branch': branch,
                'type': info['type'],
                'significance': info['significance'],
            })

    # 4. 桃花 (from day branch)
    taohua_branch = TAOHUA.get(day_branch, '')
    if taohua_branch and taohua_branch in kong_wang_set:
        info = _STAR_KONG_WANG_MEANINGS['桃花']
        results.append({
            'star': '桃花',
            'branch': taohua_branch,
            'type': info['type'],
            'significance': info['significance'],
        })

    # 5. 驛馬 (from day branch)
    yima_branch = YIMA.get(day_branch, '')
    if yima_branch and yima_branch in kong_wang_set:
        info = _STAR_KONG_WANG_MEANINGS['驛馬']
        results.append({
            'star': '驛馬',
            'branch': yima_branch,
            'type': info['type'],
            'significance': info['significance'],
        })

    # 6. 文昌 (from day stem)
    wenchang_branch = WENCHANG.get(day_master_stem, '')
    if wenchang_branch and wenchang_branch in kong_wang_set:
        info = _STAR_KONG_WANG_MEANINGS['文昌']
        results.append({
            'star': '文昌',
            'branch': wenchang_branch,
            'type': info['type'],
            'significance': info['significance'],
        })

    # 7. 祿神 (from day stem)
    lushen_branch = LUSHEN.get(day_master_stem, '')
    if lushen_branch and lushen_branch in kong_wang_set:
        info = _STAR_KONG_WANG_MEANINGS['祿神']
        results.append({
            'star': '祿神',
            'branch': lushen_branch,
            'type': info['type'],
            'significance': info['significance'],
        })

    return results


def _classify_element_favorability(element: str, effective_gods: Dict) -> str:
    """5-way element favorability classification for AI narration.

    Note: Related to but distinct from _is_element_favorable() which returns
    'favorable'/'unfavorable'/'neutral'. This function provides 5-way Chinese
    labels distinguishing 用神/喜神/忌神/仇神/閒神.

    Works correctly for 從格 charts because effective_gods is already overridden
    by interpretation_rules.py (favorableGod==usefulGod for 從格, DM element
    becomes taboo).
    """
    if element == effective_gods.get('usefulGod'):
        return '為用神，運勢有利'
    if element == effective_gods.get('favorableGod'):
        return '為喜神，運勢順利'
    if element == effective_gods.get('tabooGod'):
        return '為忌神，運勢受阻'
    if element == effective_gods.get('enemyGod'):
        return '為仇神，暗中消耗'
    return '為閒神，影響平淡'


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

        # Compute stem/branch ten gods for phase description
        stem_tg = derive_ten_god(day_master_stem, stem) or ''
        branch_main_stem = branch_hidden[0] if branch_hidden else ''
        branch_tg = derive_ten_god(day_master_stem, branch_main_stem) if branch_main_stem else ''

        # Determine favorability (5-way classification)
        stem_fav = _classify_element_favorability(stem_el, effective_gods)
        branch_fav = _classify_element_favorability(branch_main_el, effective_gods)

        # Phase split description (enriched with ten god + favorability)
        stem_phase = f'前5年{stem}（{stem_el}）{stem_tg}主導，{stem_fav}'
        branch_phase = f'後5年{branch}（{branch_main_el}）{branch_tg}主導，{branch_fav}'

        enriched.append({
            'stem': stem,
            'branch': branch,
            'startAge': lp.get('startAge', 0),
            'endAge': lp.get('endAge', 0),
            'startYear': lp.get('startYear', 0),
            'endYear': lp.get('endYear', 0),
            'tenGod': lp.get('tenGod', ''),
            'stemTenGod': stem_tg,
            'branchTenGod': branch_tg,
            'score': round(score),
            'stemPhase': stem_phase,
            'branchPhase': branch_phase,
            'interactions': interactions_summary,
            'isCurrent': lp.get('isCurrent', False),
        })

    return enriched


# ============================================================
# Lookup Tables — Health Organs by Element
# ============================================================

ELEMENT_HEALTH_ORGANS: Dict[str, Dict[str, str]] = {
    '木': {'organs': '肝膽', 'excess': '肝火旺、易怒、頭痛、眼疾', 'deficiency': '視力差、筋骨無力、指甲脆弱'},
    '火': {'organs': '心臟、小腸、血液循環', 'excess': '心悸、失眠、焦躁、血壓高', 'deficiency': '血壓低、手腳冰冷、循環差'},
    '土': {'organs': '脾胃、消化系統', 'excess': '消化不良、肥胖、痰濕', 'deficiency': '食慾差、營養吸收差、肌肉無力'},
    '金': {'organs': '肺、呼吸系統、大腸', 'excess': '皮膚過敏、呼吸急促、便秘', 'deficiency': '免疫力差、易感冒、氣虛'},
    '水': {'organs': '腎、膀胱、泌尿生殖系統', 'excess': '水腫、泌尿問題、虛寒', 'deficiency': '腰膝酸軟、記憶力差、耳鳴'},
}


# ============================================================
# Lookup Tables — Hour Pillar Ten God → Children Personality
# ============================================================

HOUR_TEN_GOD_CHILDREN_TRAITS: Dict[str, str] = {
    '比肩': '獨立自主、有主見、與命主性格相似，但容易固執己見',
    '劫財': '好勝心強、社交能力好、性格衝動，需注意教養方式',
    '食神': '溫和聰慧、有藝術天賦、生活品味高，性格隨和',
    '傷官': '聰明伶俐、思維敏捷、口才出眾，但叛逆不服管教',
    '偏財': '善於社交、商業頭腦靈活、人緣好，但不夠專注',
    '正財': '踏實穩重、理財觀念好、務實可靠，但缺乏冒險精神',
    '偏官': '剛強果斷、有領導力、意志堅定，但脾氣急躁',
    '正官': '循規蹈矩、有責任心、品行端正，但個性保守',
    '偏印': '思想獨特、有研究精神、多才多藝，但性格孤僻',
    '正印': '善良仁厚、學習能力強、孝順體貼，但依賴性強',
}


# ============================================================
# Lookup Tables — Shen Sha Pillar Interpretations (24 shen sha)
# Classical sources: 《三命通會》, Bazi reference sites
# ============================================================

SHEN_SHA_PILLAR_INTERPRETATIONS: Dict[str, Dict[str, str]] = {
    '天乙貴人': {
        'year': '幼年受長輩庇蔭，祖上有德助力',
        'month': '家境良好，父母事業有成',
        'day': '可嫁娶貴人，配偶賢良子女孝順',
        'hour': '晚年子女孝順有出息',
    },
    '國印貴人': {
        'year': '親族中有從政者，利於仕途',
        'month': '性格穩重，學業事業運佳',
        'day': '可掌實權，事業運最佳位置',
        'hour': '晚年物質基礎好，事業晚成',
    },
    '華蓋': {
        'year': '性格內斂壓抑，少年孤獨',
        'month': '藝術天賦高，但恃才傲物',
        'day': '胸懷寬廣為人善良，有宗教緣',
        'hour': '對宗教玄學有興趣，子女獨立',
    },
    '驛馬': {
        'year': '祖上遷移，幼年多搬遷',
        'month': '求學或工作常出差，有留學運',
        'day': '本人好動，配偶可能來自遠方',
        'hour': '晚年喜出遊，子女在外發展',
    },
    '寡宿': {
        'year': '與家族親緣薄，須自力更生',
        'month': '與兄弟姐妹緣分薄',
        'day': '配偶宮帶寡宿，感情路較坎坷',
        'hour': '與子女緣分較薄，晚年孤寂',
    },
    '祿神': {
        'year': '歲祿，收入穩定逐年增長',
        'month': '建祿，務實穩健中年有成',
        'day': '坐祿，物質享受豐裕',
        'hour': '歸祿，為子孫辛勤耕耘',
    },
    '紅鸞': {
        'year': '少年即有桃花緣',
        'month': '同輩中情緣多',
        'day': '對婚姻影響大，感情波折或法律糾紛',
        'hour': '晚婚或晚年才遇真愛',
    },
    '文昌': {
        'year': '幼年聰穎，學業順利',
        'month': '青年有志好學，利功名',
        'day': '終身好學不倦，學識淵博',
        'hour': '晚年仍有學習力，大器晚成',
    },
    '學堂': {
        'year': '少年時期記憶力好，讀書運佳',
        'month': '青年求學順利，考運佳',
        'day': '一生與學問結緣，專業能力強',
        'hour': '晚年好學，適合研究工作',
    },
    '福星貴人': {
        'year': '祖上積福，一生衣食無憂',
        'month': '個性隨和，兄弟朋友和睦',
        'day': '內心堅韌適應力強，配偶有福',
        'hour': '晚年安康富足',
    },
    '童子煞': {
        'year': '累世童子，感情財運多挫折',
        'month': '易患怪病，工作缺乏助力',
        'day': '夫妻宮童子，感情路極為坎坷',
        'hour': '晚年孤寂，子女不在身邊',
    },
    '天羅': {
        'year': '幼年家運不穩，須防災厄',
        'month': '青年期事業多阻礙',
        'day': '中年須防疾病或官非',
        'hour': '晚年健康需特別注意',
    },
    '德秀貴人': {
        'year': '品格高尚，感化他人',
        'month': '思想成熟穩重，利人際關係',
        'day': '謙虛有領導力，決策明智',
        'hour': '專業成就高，成為領域精英',
    },
    '空亡': {
        'year': '幼年缺乏照顧，白手起家',
        'month': '青年多阻礙，手足緣薄',
        'day': '配偶宮空亡，聚少離多',
        'hour': '晚年孤寂，子女緣薄',
    },
    '桃花': {
        'year': '幼年即有人緣，異性緣早開',
        'month': '青年社交活躍，情感豐富',
        'day': '本命桃花最重，感情事多',
        'hour': '晚年仍有異性緣',
    },
    '羊刃': {
        'year': '性格剛烈，幼年家中多變動',
        'month': '事業心強但衝動，須防破財',
        'day': '配偶宮帶刃，婚姻易有波折',
        'hour': '子女性格倔強，晚年防意外',
    },
    '天醫': {
        'year': '幼年體質特殊，對醫學有緣',
        'month': '適合醫療養生行業',
        'day': '自我調養能力強，利健康',
        'hour': '晚年養生得宜，長壽之兆',
    },
    '天德': {
        'year': '祖上積德，災厄能化解',
        'month': '品行端正，逢凶化吉',
        'day': '有貴人護佑，一生平安',
        'hour': '晚年福報深厚',
    },
    '月德': {
        'year': '家族福蔭深厚',
        'month': '個性慈悲善良，有人緣',
        'day': '災難時有貴人解救',
        'hour': '子女有德行，晚年安樂',
    },
    '天喜': {
        'year': '幼年喜慶事多',
        'month': '青年運勢佳，多喜事',
        'day': '有利婚姻，喜事臨門',
        'hour': '子女帶來歡樂，晚年多喜',
    },
    '金輿': {
        'year': '出身家庭物質條件好',
        'month': '工作環境優越，有車馬之福',
        'day': '配偶家境好，物質豐裕',
        'hour': '晚年享福，出行有車馬',
    },
    '孤辰': {
        'year': '幼年離家或與祖輩緣薄',
        'month': '青年獨立，缺少兄弟助力',
        'day': '個性孤僻，感情較晚',
        'hour': '晚年獨處時間多',
    },
    '將星': {
        'year': '少年即有領導氣質',
        'month': '事業上適合擔任主管或領隊',
        'day': '本人有號召力，利管理職',
        'hour': '子女有領導才能',
    },
    '劫煞': {
        'year': '幼年防意外，性格急躁',
        'month': '事業上競爭激烈，防小人',
        'day': '防財務損失或健康問題',
        'hour': '晚年注意安全，子女須防破耗',
    },
}


# ============================================================
# Lookup Tables — Twelve Life Stages Interpretations
# Element-conditioned health (Issue #5 from Bazi Master Review)
# ============================================================

TWELVE_STAGES_INTERPRETATIONS: Dict[str, Dict[str, Any]] = {
    '長生': {
        'day_branch': '創造力強、開拓能力佳，如新生般充滿發展潛力',
        'hour_branch': '子女中有賢德孝順者，發展前景良好',
        'health_by_element': {
            '木': '肝膽功能旺盛，但須防過勞損肝',
            '火': '心血管活力充沛，注意用眼過度',
            '土': '脾胃消化力強，飲食規律即可',
            '金': '肺部功能良好，注意空氣品質',
            '水': '腎氣充足，但防縱慾傷腎',
        },
        'general_health': '生命力旺盛，體質基底佳',
    },
    '沐浴': {
        'day_branch': '直覺力強但衝動，感情事多，性格多變',
        'hour_branch': '子女生活不穩定，感情較複雜',
        'health_by_element': {
            '木': '肝膽代謝不穩，情緒波動影響健康',
            '火': '心火不定，易失眠焦躁',
            '土': '脾胃虛弱期，飲食不節易傷',
            '金': '呼吸系統脆弱，易感冒過敏',
            '水': '泌尿生殖系統敏感，注意衛生',
        },
        'general_health': '體質敏感期，情緒影響健康明顯',
    },
    '冠帶': {
        'day_branch': '自尊心強，有組織才能，但容易樹敵',
        'hour_branch': '子女早熟有主見，發展前景佳',
        'health_by_element': {
            '木': '肝氣漸旺，注意調節情緒',
            '火': '心血管系統逐漸強化',
            '土': '消化功能趨穩，適合養生',
            '金': '肺功能恢復中，宜多運動',
            '水': '腎氣漸足，體力回升',
        },
        'general_health': '體質逐步增強，宜趁勢養生',
    },
    '臨官': {
        'day_branch': '有領導力與權威感，事業心強',
        'hour_branch': '子女可能從政或擔任要職',
        'health_by_element': {
            '木': '肝膽功能穩定強健',
            '火': '心臟有力，精力充沛但防上火',
            '土': '脾胃運化良好，但防過食',
            '金': '肺氣充盈，呼吸系統佳',
            '水': '腎功能穩定，但防過勞',
        },
        'general_health': '精力充沛期，體質強健',
    },
    '帝旺': {
        'day_branch': '狀態巔峰，信心與能力最強，但恐過剛',
        'hour_branch': '子女能力強但意志剛硬，防與父母衝突',
        'health_by_element': {
            '木': '肝氣過旺，防肝火上炎、頭痛目赤',
            '火': '心火過旺，防心悸失眠、血壓偏高',
            '土': '脾胃過實，防消化不良、肥胖',
            '金': '肺氣過盛，防皮膚過敏、便秘',
            '水': '腎水過旺，防水腫、泌尿問題',
        },
        'general_health': '能量巔峰但物極必反，防「過旺成災」',
    },
    '衰': {
        'day_branch': '精力開始下降，行事宜保守穩健',
        'hour_branch': '子女運勢平淡，晚年需多注意',
        'health_by_element': {
            '木': '肝功能開始減弱，注意養肝護眼',
            '火': '心血管漸弱，定期檢查血壓',
            '土': '脾胃功能下降，飲食宜清淡',
            '金': '肺氣漸虛，防呼吸道慢性病',
            '水': '腎氣漸衰，注意腰膝保養',
        },
        'general_health': '體力進入下降期，保養重於治療',
    },
    '病': {
        'day_branch': '體質偏弱，精神動力不足',
        'hour_branch': '子女可能有健康隱憂，晚年健康挑戰',
        'health_by_element': {
            '木': '肝膽虛弱，易疲勞、視力下降',
            '火': '心氣不足，易心悸、手腳冰冷',
            '土': '脾虛消化差，營養吸收不良',
            '金': '肺氣虛弱，免疫力低易感冒',
            '水': '腎虛腰酸，記憶力減退',
        },
        'general_health': '體質虛弱期，須積極調理',
    },
    '死': {
        'day_branch': '象徵結束與轉化，非字面義，多主挫折後重生',
        'hour_branch': '與子女關係需經營，晚年挑戰多',
        'health_by_element': {
            '木': '肝氣幾乎停滯，須防肝病',
            '火': '心臟功能低下，防心血管疾病',
            '土': '脾胃極虛，消化系統問題嚴重',
            '金': '肺部問題突出，防呼吸系統重症',
            '水': '腎功能衰退，防泌尿系統疾病',
        },
        'general_health': '健康最脆弱期，必須重視體檢',
    },
    '墓': {
        'day_branch': '潛力蘊藏未發，資源待開發，遇貴人可發財',
        'hour_branch': '子女內向或大器晚成，潛力待發',
        'health_by_element': {
            '木': '肝氣收藏，功能不彰但可調養',
            '火': '心氣內收，表面平靜內有隱患',
            '土': '脾胃功能收斂，適合靜養',
            '金': '肺氣收藏，呼吸系統慢性問題',
            '水': '腎氣封藏，功能退化但穩定',
        },
        'general_health': '能量收藏期，宜靜養調理',
    },
    '絕': {
        'day_branch': '生命力降至最低，需徹底轉化重生',
        'hour_branch': '子女緣薄或子女發展困難',
        'health_by_element': {
            '木': '肝膽功能極弱，防重大肝病',
            '火': '心血管系統極度脆弱',
            '土': '脾胃幾乎喪失運化功能',
            '金': '肺部極度虛弱，防重症',
            '水': '腎氣枯竭，防腎衰竭',
        },
        'general_health': '體質最弱期，但也是新循環起點',
    },
    '胎': {
        'day_branch': '新生命孕育中，潛力尚未顯現，安全但待發展',
        'hour_branch': '子女受到保護，利懷孕生育',
        'health_by_element': {
            '木': '肝膽新氣萌動，有恢復跡象',
            '火': '心氣微弱但在孕育中',
            '土': '脾胃功能慢慢恢復',
            '金': '肺氣開始萌動',
            '水': '腎氣開始恢復',
        },
        'general_health': '新能量孕育期，需耐心等待恢復',
    },
    '養': {
        'day_branch': '潛力積累中，如待發之苗，準備下一輪長生',
        'hour_branch': '子女受到良好照顧，環境利於成長',
        'health_by_element': {
            '木': '肝膽功能緩慢恢復，宜食療養肝',
            '火': '心臟功能逐步回升，避免劇烈運動',
            '土': '脾胃在調養中，飲食宜溫補',
            '金': '肺功能在恢復中，宜多呼吸新鮮空氣',
            '水': '腎氣在培養中，適合溫和運動',
        },
        'general_health': '被動恢復期，耐心調養等待轉機',
    },
}


# ============================================================
# Lookup Tables — Pattern Finance Archetype (2D: pattern x strength)
# Issue #14 CRITICAL from Bazi Master Review
# ============================================================

PATTERN_FINANCE_ARCHETYPE: Dict[str, Dict[str, Dict[str, str]]] = {
    '正官': {
        'strong': {'archetype': '穩薪高管型', 'mechanism': '正官制身得力，適合體制內薪資穩步攀升', 'risk': '過度保守錯失投資機會'},
        'weak': {'archetype': '壓力負債型', 'mechanism': '官殺克身過重，工作壓力大、財務易受職場波動', 'risk': '因職場壓力衝動消費'},
        'neutral': {'archetype': '制度理財型', 'mechanism': '官星平衡，善用制度與規劃累積財富', 'risk': '缺乏冒險精神'},
    },
    '偏官': {
        'strong': {'archetype': '冒險投資型', 'mechanism': '身旺扛殺，敢於高風險高回報的投資', 'risk': '賭性過重易大起大落'},
        'weak': {'archetype': '被動消耗型', 'mechanism': '七殺克身過重，財富被外力消耗，官非破財', 'risk': '被動背債或被騙'},
        'neutral': {'archetype': '軍師理財型', 'mechanism': '殺星有制，善用策略穩中求進', 'risk': '行事過於算計'},
    },
    '正財': {
        'strong': {'archetype': '勤儉致富型', 'mechanism': '身旺任財，能扛得住財，正財穩定可靠', 'risk': '太過保守錯失機會'},
        'weak': {'archetype': '有財難守型', 'mechanism': '身弱財多，財來財去留不住', 'risk': '慾望超過能力'},
        'neutral': {'archetype': '穩健積累型', 'mechanism': '身財平衡，穩紮穩打累積資產', 'risk': '進展緩慢'},
    },
    '偏財': {
        'strong': {'archetype': '靈活投資型', 'mechanism': '身旺偏財旺，投機能力強，善抓商機', 'risk': '貪多嚼不爛'},
        'weak': {'archetype': '過度投機型', 'mechanism': '身弱偏財旺，野心大但資源不足以支撐', 'risk': '投機失敗負債'},
        'neutral': {'archetype': '社交生財型', 'mechanism': '偏財平衡，靠人脈與社交帶來財運', 'risk': '人情債多'},
    },
    '食神': {
        'strong': {'archetype': '才華變現型', 'mechanism': '食神洩秀，身強能撐，才華直接轉化為收入', 'risk': '揮霍享樂'},
        'weak': {'archetype': '耗洩過度型', 'mechanism': '食神洩身太過，有才華但體力資源不足以變現', 'risk': '入不敷出'},
        'neutral': {'archetype': '創意理財型', 'mechanism': '食神平衡，靠技能與品味穩定獲利', 'risk': '安於小確幸'},
    },
    '傷官': {
        'strong': {'archetype': '口才生財型', 'mechanism': '傷官洩秀有力，靠能力與表達征服市場', 'risk': '得罪權貴斷財路'},
        'weak': {'archetype': '叛逆敗財型', 'mechanism': '傷官洩身太過，反叛體制但缺乏實力支撐', 'risk': '衝動離職斷收入'},
        'neutral': {'archetype': '自由業賺錢型', 'mechanism': '傷官平衡，適合自由業或顧問型收入', 'risk': '收入不穩定'},
    },
    '正印': {
        'strong': {'archetype': '學術變現型', 'mechanism': '印星強旺，靠學歷、證照、專業知識換取穩定收入', 'risk': '賺錢速度慢'},
        'weak': {'archetype': '依賴他人型', 'mechanism': '身弱喜印生扶，靠長輩、貴人、組織庇護得財', 'risk': '缺乏獨立賺錢能力'},
        'neutral': {'archetype': '穩定專業型', 'mechanism': '印星平衡，專業能力受肯定，薪資穩定', 'risk': '升遷瓶頸'},
    },
    '偏印': {
        'strong': {'archetype': '副業斜槓型', 'mechanism': '偏印靈活，身旺多技能，副業比正職賺更多', 'risk': '主業荒廢'},
        'weak': {'archetype': '懷才不遇型', 'mechanism': '偏印克食傷，有想法但難以落地變現', 'risk': '鑽牛角尖不切實際'},
        'neutral': {'archetype': '獨門技術型', 'mechanism': '偏印平衡，靠獨特技能或冷門領域穩定獲利', 'risk': '市場太小'},
    },
    '比肩': {
        'strong': {'archetype': '競爭搶財型', 'mechanism': '比肩旺身更旺，同行競爭激烈，須靠實力脫穎而出', 'risk': '同行相忌互相拖累'},
        'weak': {'archetype': '合作共贏型', 'mechanism': '身弱得比肩幫助，合夥經營或團隊合作利財運', 'risk': '過度依賴合夥人'},
        'neutral': {'archetype': '獨立創業型', 'mechanism': '比肩平衡，適合獨立經營或自由職業', 'risk': '獨木難支'},
    },
    '劫財': {
        'strong': {'archetype': '豪賭型理財', 'mechanism': '劫財旺身更旺，大進大出、敢衝敢闖', 'risk': '因朋友或投機大破財'},
        'weak': {'archetype': '被劫財型', 'mechanism': '身弱劫財奪食，容易被朋友借錢或被騙', 'risk': '人情債纏身'},
        'neutral': {'archetype': '社交型投資', 'mechanism': '劫財平衡，善用人脈但須防合作糾紛', 'risk': '與朋友因錢反目'},
    },
}

# 從格 finance overrides (code logic uses these when cong_ge is present)
CONG_GE_FINANCE_ARCHETYPE: Dict[str, Dict[str, str]] = {
    'cong_cai': {'archetype': '順勢聚財型', 'mechanism': '從財格順從財星，天生與財富有緣，宜順勢而為', 'risk': '逢比劫/印大運則根基動搖'},
    'cong_guan': {'archetype': '權力帶財型', 'mechanism': '從官格順從官星，靠權位地位帶來財富', 'risk': '逢比劫大運失去靠山'},
    'cong_er': {'archetype': '才華噴發型', 'mechanism': '從兒格順從食傷，才華極度外放，靠創意表達賺錢', 'risk': '逢印大運壓制才華則斷財'},
    'cong_shi': {'archetype': '順勢而為型', 'mechanism': '從勢格無主見，隨大環境流動，靈活應變', 'risk': '逢比劫/印大運反而凶險'},
}


# ============================================================
# Lookup Tables — Annual Ten God Finance (2D: ten_god x strength)
# Issue #10 HIGH from Bazi Master Review
# ============================================================

ANNUAL_TEN_GOD_FINANCE: Dict[str, Dict[str, str]] = {
    '比肩': {
        'strong': '比劫爭財年，身已旺再逢比肩，同行競爭激烈、破財機率高，不宜合夥',
        'weak': '比肩幫身年，身弱得比肩助力，人脈帶財、合作有利，宜與人合夥',
    },
    '劫財': {
        'strong': '劫財奪財年，身旺遇劫財，大破財之兆，防被騙被借、投機失利',
        'weak': '劫財助身年，身弱得劫財幫扶，社交活躍帶來機會，但仍防開銷過大',
    },
    '食神': {
        'strong': '食神生財年，身旺食神洩秀生財，才華變現的最佳時機',
        'weak': '食神洩氣年，身弱被食神再洩，精力消耗大、收入不穩，量力而行',
    },
    '傷官': {
        'strong': '傷官生財年，身旺傷官洩秀，靠口才能力主動拓展財源',
        'weak': '傷官洩身年，身弱遇傷官再洩，衝動消費、與人爭執損財',
    },
    '正財': {
        'strong': '正財入命年，身旺逢正財，主動出擊可得穩定收入，利薪資加薪',
        'weak': '正財壓身年，身弱正財來反成負擔，賺錢辛苦、財重身輕',
    },
    '偏財': {
        'strong': '偏財入命年，身旺逢偏財，利投資理財、意外之財，商機敏銳',
        'weak': '偏財誘惑年，身弱偏財來引誘，貪多嚼不爛、投機反虧',
    },
    '正官': {
        'strong': '正官年，身旺得官星制衡，利在體制內爭取加薪升職帶動收入',
        'weak': '正官壓力年，身弱正官克身，工作壓力大、可能因職場變動影響收入',
    },
    '偏官': {
        'strong': '七殺年，身旺扛殺有力，競爭中勝出帶來額外收入',
        'weak': '七殺壓身年，身弱遇七殺克制，官非纏身、被迫花錢消災',
    },
    '正印': {
        'strong': '正印年，身旺再逢印生扶，能量溢出但主業穩定，利考證進修帶動未來收入',
        'weak': '正印生身年，身弱得印星生扶，貴人相助財源穩，利文書證照類收入',
    },
    '偏印': {
        'strong': '偏印年，身旺偏印奪食，正財管道受阻，須另覓出路、防副業虧損',
        'weak': '偏印年，身弱得偏印生扶，適合研究型或技術型收入，但防投機取巧',
    },
}


# ============================================================
# Lookup Tables — Clash Pillar Pair Effects
# Enhanced with god-system favorability (Issue #6)
# ============================================================

CLASH_PILLAR_PAIR_EFFECTS: Dict[str, Dict[str, str]] = {
    'year_month': {
        'identity': '離鄉背井、少年運蹉跎',
        'career': '早年學業不順或中斷',
        'love': '家庭環境影響戀愛觀',
    },
    'year_day': {
        'identity': '與父母不和、無祖業可靠',
        'career': '須完全靠自己打拼',
        'love': '家庭對婚姻有干涉',
    },
    'year_hour': {
        'identity': '遙沖影響小，早年與晚年運勢有張力',
        'career': '事業起伏跨度大',
        'love': '子女問題可能影響家族關係',
    },
    'month_day': {
        'identity': '內心矛盾感重，事業與家庭難兩全',
        'career': '職場不穩定，跳槽機率高',
        'love': '離婚機率較高，婚姻最受衝擊的位置',
    },
    'month_hour': {
        'identity': '事業與子女之間有矛盾',
        'career': '中年事業轉型壓力',
        'love': '因工作忽略家庭',
    },
    'day_hour': {
        'identity': '配偶宮與子女宮衝突，家庭不安',
        'career': '晚年事業波折',
        'love': '夫妻分居或聚少離多，子女緣薄',
    },
}


# ============================================================
# Lookup Tables — Harm Pillar Pair Effects (all 6 pairs, Issue #2)
# ============================================================

HARM_PILLAR_PAIR_EFFECTS: Dict[str, Dict[str, str]] = {
    '子未': {'identity': '勢家相害，權力衝突', 'career': '上下級關係緊張', 'love': '情感被現實力量破壞'},
    '丑午': {'identity': '官鬼相害，易有官非', 'career': '職場遇小人或官非', 'love': '感情受外在壓力干擾'},
    '寅巳': {'identity': '恃勢相害，互不相讓', 'career': '職場競爭激烈、互相嫉妒', 'love': '雙方都要贏，感情膠著'},
    '卯辰': {'identity': '以少凌長，輩分衝突', 'career': '職場代溝嚴重', 'love': '年齡差距帶來摩擦'},
    '申亥': {'identity': '爭進相害，爭奪進階', 'career': '同事間惡性競爭', 'love': '雙方各有追求難妥協'},
    '酉戌': {'identity': '嫉妒相害，互相猜忌', 'career': '被同事嫉妒排擠', 'love': '信任危機，猜疑不斷'},
}


# ============================================================
# Lookup Tables — Kong Wang Pillar Effects
# Enhanced with god conditioning (Issue #1)
# ============================================================

KONG_WANG_PILLAR_EFFECTS: Dict[str, Dict[str, str]] = {
    'year': {
        'base': '年柱空亡：幼年缺乏照顧，祖輩庇蔭弱，須白手起家',
        'favorable_void': '但空亡位為忌神五行，凶性減半，反而減少幼年阻礙',
        'unfavorable_void': '且空亡位為用神五行，吉性減半，祖輩支持更薄弱',
    },
    'month': {
        'base': '月柱空亡：青年期多阻礙，學業常中斷，手足緣薄',
        'favorable_void': '但空亡位為忌神五行，凶性減半，事業阻礙較輕',
        'unfavorable_void': '且空亡位為用神五行，吉性減半，缺少兄弟姐妹助力',
    },
    'day': {
        'base': '日支空亡：配偶宮空虛，婚姻聚少離多，感情不穩',
        'favorable_void': '但空亡位為忌神五行，配偶宮忌神減力，感情反而阻礙較小',
        'unfavorable_void': '且空亡位為用神五行，配偶宮用神減力，感情助力更弱',
    },
    'hour': {
        'base': '時柱空亡：晚年孤寂，子女緣薄，事業社交不如意',
        'favorable_void': '但空亡位為忌神五行，子女宮凶性減半，晚年阻礙減輕',
        'unfavorable_void': '且空亡位為用神五行，子女宮吉性減半，子女支持不足',
    },
}


# ============================================================
# Helper Functions — Context-Conditional Logic
# ============================================================

def _get_strength_class(classification: str) -> str:
    """Map 5-level classification to 3-level for 2D lookup tables."""
    if classification in ('strong', 'very_strong'):
        return 'strong'
    elif classification in ('weak', 'very_weak'):
        return 'weak'
    return 'neutral'


def _is_element_favorable(element: str, effective_gods: Dict[str, str]) -> str:
    """
    Check if an element is favorable or unfavorable based on god system.
    Returns: 'favorable' | 'unfavorable' | 'neutral'
    Issue #11 from Bazi Master Review.
    """
    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')
    taboo_god = effective_gods.get('tabooGod', '')
    enemy_god = effective_gods.get('enemyGod', '')

    if element in (useful_god, favorable_god):
        return 'favorable'
    elif element in (taboo_god, enemy_god):
        return 'unfavorable'
    return 'neutral'


def _shen_sha_is_valid(
    sha_name: str,
    sha_branch: str,
    kong_wang: List[str],
    clashed_branches: Set[str],
) -> bool:
    """
    Check if a shen sha is still active (not voided or clashed away).
    Issue #12 from Bazi Master Review.

    Negative shen sha (凶星) are NOT weakened by clash — they're already bad.
    """
    negative_sha = {'羊刃', '劫煞', '天羅', '童子煞', '寡宿', '孤辰'}
    if sha_name in negative_sha:
        return True  # Negative stars are always "valid" (active)

    # Positive/mixed shen sha are voided or clashed away
    if sha_branch in kong_wang:
        return False
    if sha_branch in clashed_branches:
        return False
    return True


def _detect_food_wealth_chain(
    five_elements_balance: Dict[str, float],
    tougan_analysis: List[Dict],
    effective_gods: Dict[str, str],
    day_master_stem: str,
) -> Dict[str, Any]:
    """
    Detect 食傷生財 chain with 偏印奪食 blocking check.
    Issue #7 from Bazi Master Review.

    Returns: {'active': bool, 'blocked': bool, 'reason': str}
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    food_element = ELEMENT_PRODUCES[dm_element]  # 食傷 element
    wealth_element = ELEMENT_OVERCOMES[dm_element]  # 財星 element

    # Check if food/injury AND wealth both have meaningful presence
    food_pct = five_elements_balance.get(food_element, 0)
    wealth_pct = five_elements_balance.get(wealth_element, 0)

    if food_pct < 8 or wealth_pct < 8:
        return {'active': False, 'blocked': False, 'reason': '食傷或財星力量不足'}

    # Chain is potentially active — now check for 偏印奪食 blocking
    taboo_god = effective_gods.get('tabooGod', '')
    # 偏印's element = the element that produces DM (印星 element)
    seal_element = ELEMENT_PRODUCED_BY[dm_element]

    blocked = False
    reason = ''
    for tg in tougan_analysis:
        if tg['status'] == 'transparent' and tg['tenGod'] == '偏印':
            # Is this 偏印 the taboo god? Only blocks if it's unfavorable
            piyin_element = STEM_ELEMENT.get(tg['stem'], '')
            if piyin_element == taboo_god:
                blocked = True
                reason = '偏印透干且為忌神，偏印奪食，食傷生財鏈被破壞'
            # If 偏印 is useful god, it's helping DM, not attacking food god
            break

    return {'active': True, 'blocked': blocked, 'reason': reason if reason else '食傷生財鏈暢通'}


def _count_spouse_stars(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
) -> Dict[str, Any]:
    """Count ALL spouse star occurrences across the entire chart.

    Counts surface stems (year/month/hour) + ALL hidden stems in ALL branches
    independently. No deduplication — a stem appearing as both surface and hidden
    represents two distinct energy sources (明透 vs 藏), consistent with
    tenGodDistribution's counting methodology.
    # 子平真詮: 配偶星計算包含天干及所有地支藏干

    Male: 正財=正妻星, 偏財=偏妻星
    Female: 正官=正夫星, 偏官=偏夫星
    """
    if gender == 'male':
        zheng_star = '正財'
        pian_star = '偏財'
    else:
        zheng_star = '正官'
        pian_star = '偏官'

    zheng_count = 0
    pian_count = 0
    star_details: List[str] = []

    # 1. Count surface stems (year, month, hour — not day)
    for pname in ('year', 'month', 'hour'):
        stem = pillars[pname]['stem']
        tg = derive_ten_god(day_master_stem, stem)
        if tg == zheng_star:
            zheng_count += 1
            pillar_zh = PILLAR_NAME_ZH.get(pname, pname)
            star_details.append(f'{stem}（{zheng_star}，{pillar_zh}干）')
        elif tg == pian_star:
            pian_count += 1
            pillar_zh = PILLAR_NAME_ZH.get(pname, pname)
            star_details.append(f'{stem}（{pian_star}，{pillar_zh}干）')

    # 2. Count ALL hidden stems in ALL branches — NO deduplication
    # Each hidden stem is an independent energy source regardless of surface stems
    for pname in ('year', 'month', 'day', 'hour'):
        branch = pillars[pname]['branch']
        hidden = HIDDEN_STEMS.get(branch, [])
        for idx, hs in enumerate(hidden):
            tg = derive_ten_god(day_master_stem, hs)
            if tg in (zheng_star, pian_star):
                pillar_zh = PILLAR_NAME_ZH.get(pname, pname)
                qi_type = '本氣' if idx == 0 else ('中氣' if idx == 1 else '餘氣')
                if tg == zheng_star:
                    zheng_count += 1
                else:
                    pian_count += 1
                star_details.append(f'{hs}（{tg}，藏於{pillar_zh}支{qi_type}）')

    mixed = zheng_count > 0 and pian_count > 0

    return {
        'zheng_count': zheng_count,
        'pian_count': pian_count,
        'mixed': mixed,
        'hidden_stars': star_details,
        'zheng_name': zheng_star,
        'pian_name': pian_star,
    }


def _get_clashed_branches(branch_relationships: Optional[Dict]) -> Set[str]:
    """Extract all branches involved in clashes from branch_relationships."""
    clashed: Set[str] = set()
    if not branch_relationships:
        return clashed
    for clash in branch_relationships.get('clashes', []):
        branches = clash.get('branches', ())
        if isinstance(branches, (list, tuple)):
            for b in branches:
                clashed.add(b)
        elif isinstance(branches, frozenset):
            for b in branches:
                clashed.add(b)
    return clashed


# ============================================================
# Personality Anchors Builder — 4-Layer Model
# ============================================================

def _build_personality_anchors(
    day_master_stem: str,
    pillars: Dict,
    prominent_god: str,
    pattern_narrative: Dict[str, Any],
    strength_v2: Dict,
    cong_ge: Optional[Dict],
    kong_wang: Optional[List[str]] = None,
) -> List[str]:
    """
    Build personality anchors using the professional 4-layer model:
      Layer 1: 日主 (Day Master stem) — innate nature
      Layer 2: 格局 (Pattern) — primary personality framework
      Layer 3: 鐵三角 (月干+日支+時干) — behavioral modifiers
      Layer 4: 身強/身弱 — intensity modulation

    Classical basis:
      - 月干: "天干外露" — external personality projection
      - 日支: "支藏人元" — true inner personality (hidden)
      - 時干: influences motivations and later-life expression
    """
    anchors: List[str] = []
    if kong_wang is None:
        kong_wang = []

    # ── Layer 1: 日主 baseline ──
    dm_info = DAY_MASTER_PERSONALITY.get(day_master_stem, {})
    if dm_info:
        anchors.append(
            f'日主{day_master_stem}如{dm_info["archetype"]}：{dm_info["traits"]}'
        )

    # ── Layer 2: 格局 personality ──
    # 從格 uses the dominant element's ten god, not 月令's prominent_god
    if cong_ge:
        cong_name = cong_ge.get('name', '')
        dominant_el = cong_ge.get('dominantElement', '')
        # Derive the dominant ten god from the 從格's dominant element.
        # For 從格, the personality follows the dominant flow, not the DM.
        # NOTE: This intentionally differs from _rank_dominant_ten_gods() which
        # includes the DM stem itself. Here we filter out the DM to get the
        # relationship TG (e.g. 從旺格 DM=甲 → picks 乙 → 劫財, not 比肩).
        # This produces more meaningful personality narration. Phase 13 may
        # refine yang/yin polarity handling for edge cases.
        dominant_stem = next(
            (s for s in HEAVENLY_STEMS if STEM_ELEMENT[s] == dominant_el
             and s != day_master_stem), ''
        )
        if dominant_stem:
            cong_tg = derive_ten_god(day_master_stem, dominant_stem)
            cong_personality = TEN_GOD_PERSONALITY.get(cong_tg, {})
            if cong_personality:
                anchors.append(
                    f'{cong_name}主導性格（日主順從{dominant_el}勢）：{cong_personality["core"]}'
                )
        else:
            # Fallback to prominent_god (defensive — unreachable for valid data)
            pattern_style = TEN_GOD_PERSONALITY.get(prominent_god, {})
            if pattern_style:
                anchors.append(
                    f'{cong_name}主導性格：{pattern_style["core"]}'
                )
    else:
        pattern_style = TEN_GOD_PERSONALITY.get(prominent_god, {})
        if pattern_style:
            anchors.append(
                f'格局{prominent_god}格主導性格：{pattern_style["core"]}'
            )

    # ── Layer 3: 鐵三角 behavioral modifiers ──
    # 3a. 月干 — external personality projection ("你給別人的第一印象")
    # 比肩 at 月干 is redundant with Layer 1 (DM nature), so skip it
    month_stem = pillars['month']['stem']
    month_stem_tg = derive_ten_god(day_master_stem, month_stem)
    if month_stem_tg != '比肩':
        month_personality = TEN_GOD_PERSONALITY.get(month_stem_tg, {})
        if month_personality:
            anchors.append(
                f'月干{month_stem}（{month_stem_tg}）主外在表現：{month_personality["external"]}'
            )

    # 3b. 日支本氣 — true inner personality ("你內心真正的樣子")
    day_branch = pillars['day']['branch']
    day_hidden = HIDDEN_STEMS.get(day_branch, [])
    if day_hidden:
        day_branch_tg = derive_ten_god(day_master_stem, day_hidden[0])
        day_personality = TEN_GOD_PERSONALITY.get(day_branch_tg, {})
        if day_personality:
            # Note when 日支 falls in 空亡 (inner personality weakened)
            kong_note = '（日支空亡，內在特質較不外顯）' if day_branch in kong_wang else ''
            anchors.append(
                f'日支{day_branch}本氣（{day_branch_tg}）主內在本性{kong_note}：{day_personality["internal"]}'
            )

    # 3c. 時干 — motivational coloring ("你的內在驅動力")
    hour_stem = pillars['hour']['stem']
    hour_stem_tg = derive_ten_god(day_master_stem, hour_stem)
    hour_personality = TEN_GOD_PERSONALITY.get(hour_stem_tg, {})
    if hour_personality:
        anchors.append(
            f'時干{hour_stem}（{hour_stem_tg}）主內在動機：{hour_personality["motivation"]}'
        )

    # ── Layer 3+: Secondary ten god compound description ──
    dominant_gods = pattern_narrative.get('dominantTenGods', [])
    if len(dominant_gods) >= 2:
        secondary = dominant_gods[1]
        if secondary != prominent_god:
            sec_personality = TEN_GOD_PERSONALITY.get(secondary, {})
            if sec_personality:
                anchors.append(
                    f'次要性格（{secondary}）增添色彩：{sec_personality["core"]}'
                )

    # ── Layer 4: 身強/身弱 intensity modulation ──
    classification = strength_v2.get('classification', 'neutral')
    strength_zh = {
        'very_strong': '極旺', 'strong': '偏旺', 'neutral': '中和',
        'weak': '偏弱', 'very_weak': '極弱',
    }.get(classification, classification)
    modifier = STRENGTH_PERSONALITY_MODIFIER.get(classification, '')
    if modifier:
        anchors.append(f'日主{strength_zh}：{modifier}')

    return anchors


# ============================================================
# Narrative Anchors Builder — Pre-narrated facts for AI
# ============================================================

PILLAR_NAME_ZH: Dict[str, str] = {
    'year': '年', 'month': '月', 'day': '日', 'hour': '時',
}


def build_narrative_anchors(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    five_elements_balance: Dict[str, float],
    effective_gods: Dict[str, str],
    prominent_god: str,
    strength_v2: Dict,
    cong_ge: Optional[Dict],
    tougan_analysis: List[Dict],
    children_insights: Dict[str, Any],
    parents_insights: Dict[str, Any],
    pattern_narrative: Dict[str, Any],
    branch_relationships: Optional[Dict] = None,
    kong_wang: Optional[List[str]] = None,
    all_shen_sha: Optional[List[Dict]] = None,
    romance_warning_years: Optional[List[int]] = None,
) -> Dict[str, List[str]]:
    """
    Build pre-narrated anchor sentences for each AI section.

    These anchors are DETERMINISTIC FACTS that the AI must embed into its prose.
    The AI's job is to weave these sentences into coherent narrative, not to
    re-derive facts from its own knowledge.

    v2: Enhanced with 2D context-conditional lookups per Bazi Master Review.
    All lookups factor in god system + DM strength + pattern type.

    Returns a dict keyed by section name, each containing a list of
    mandatory fact sentences the AI must reference.
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    useful_god = effective_gods.get('usefulGod', '')
    favorable_god = effective_gods.get('favorableGod', '')
    taboo_god = effective_gods.get('tabooGod', '')
    enemy_god = effective_gods.get('enemyGod', '')
    classification = strength_v2.get('classification', '')
    score = strength_v2.get('score', 0)
    strength_class = _get_strength_class(classification)
    kong_wang = kong_wang or []
    all_shen_sha = all_shen_sha or []
    clashed_branches = _get_clashed_branches(branch_relationships)

    anchors: Dict[str, List[str]] = {}

    strength_zh = {
        'very_strong': '極旺', 'strong': '偏旺', 'neutral': '中和',
        'weak': '偏弱', 'very_weak': '極弱',
    }.get(classification, classification)

    # ==== GOD SYSTEM ANCHORS (shared across all sections) ====
    god_system_anchors = [
        f'本命局用神為{useful_god}、喜神為{favorable_god}、忌神為{taboo_god}、仇神為{enemy_god}',
        f'⚠️ 忌神只有「{taboo_god}」，仇神只有「{enemy_god}」。{enemy_god}五行的負面影響必須稱為「仇神」，不可稱為「忌神」',
    ]

    # ==== CHART_IDENTITY ANCHORS (6-8 anchors) ====
    chart_anchors = []
    if cong_ge:
        chart_anchors.append(
            f'命主日主{day_master_stem}（{dm_element}），為{cong_ge["name"]}，'
            f'日主強度{score}分（{strength_zh}），順從{cong_ge["dominantElement"]}勢'
        )
    else:
        chart_anchors.append(
            f'命主日主{day_master_stem}（{dm_element}），格局為{prominent_god}格，'
            f'日主強度{score}分（{strength_zh}）'
        )
        chart_anchors.append(
            f'{pattern_narrative.get("patternLogic", "")}'
        )

    chart_anchors.append(
        f'{pattern_narrative.get("patternStrengthRelation", "")}'
    )

    # NEW: Branch interactions summary with god-system favorability (Issue #6)
    if branch_relationships:
        clashes = branch_relationships.get('clashes', [])
        harms = branch_relationships.get('harms', [])
        for clash in clashes[:2]:  # Top 2 clashes
            pair_key = None
            if hasattr(clash.get('branches', ()), '__iter__'):
                branch_list = list(clash.get('branches', ()))
                if len(branch_list) == 2:
                    pillars_involved = []
                    for pn in ('year', 'month', 'day', 'hour'):
                        if pillars[pn]['branch'] in branch_list:
                            pillars_involved.append(pn)
                    if len(pillars_involved) == 2:
                        pair_key = f'{pillars_involved[0]}_{pillars_involved[1]}'
                    clash_effect = CLASH_PILLAR_PAIR_EFFECTS.get(pair_key, {})
                    if clash_effect:
                        chart_anchors.append(
                            f'命局有{PILLAR_NAME_ZH.get(pillars_involved[0], "")}支'
                            f'與{PILLAR_NAME_ZH.get(pillars_involved[1], "")}支相沖'
                            f'（{"、".join(branch_list)}沖），{clash_effect.get("identity", "")}'
                        )

    # NEW: Day branch 十二長生 meaning
    day_branch = pillars['day']['branch']
    day_life_stage = get_life_stage(day_master_stem, day_branch)
    if day_life_stage:
        stage_info = TWELVE_STAGES_INTERPRETATIONS.get(day_life_stage, {})
        if stage_info:
            chart_anchors.append(
                f'日支{day_branch}為日主{day_master_stem}的「{day_life_stage}」位，{stage_info.get("day_branch", "")}'
            )

    # NEW: Top shen sha per-pillar (with validity gate, Issue #12)
    for sha in all_shen_sha[:6]:  # Top 6 shen sha
        sha_name = sha.get('name', '')
        sha_pillar = sha.get('pillar', '')
        sha_branch = sha.get('branch', '')
        interp = SHEN_SHA_PILLAR_INTERPRETATIONS.get(sha_name, {})
        if interp and sha_pillar in interp:
            if _shen_sha_is_valid(sha_name, sha_branch, kong_wang, clashed_branches):
                chart_anchors.append(
                    f'{PILLAR_NAME_ZH.get(sha_pillar, "")}柱帶{sha_name}：{interp[sha_pillar]}'
                )

    # ── Defensive: explicit 神煞 pillar mapping to prevent AI misattribution ──
    if all_shen_sha:
        valid_sha = [sha for sha in all_shen_sha
                     if _shen_sha_is_valid(sha.get('name', ''), sha.get('branch', ''),
                                           kong_wang or [], clashed_branches)]
        if valid_sha:
            sha_map_parts = []
            for sha in valid_sha:  # ALL valid shen sha, no cap
                pillar_zh = PILLAR_NAME_ZH.get(sha.get('pillar', ''), '')
                sha_map_parts.append(f'{sha["name"]}在{pillar_zh}柱')
            chart_anchors.append(
                f'⚠️ 神煞位置（有效）：{"、".join(sha_map_parts)}。'
                f'AI必須按此位置描述，不可將神煞歸於非其所在之柱位，不可自行推斷未列出之神煞'
            )

    # ── Personality anchors (4-layer model) ──
    personality_anchors = _build_personality_anchors(
        day_master_stem, pillars, prominent_god,
        pattern_narrative, strength_v2, cong_ge,
        kong_wang=kong_wang,
    )

    anchors['chart_identity'] = god_system_anchors + chart_anchors + personality_anchors

    # ==== FINANCE_PATTERN ANCHORS (6-8 anchors, CRITICAL Issue #14) ====
    finance_anchors = [
        f'有利財運的五行方向：{useful_god}（用神）和{favorable_god}（喜神）',
        f'不利財運的五行方向：{taboo_god}（忌神，最不利）和{enemy_god}（仇神，次不利）',
        f'最容易破財的方式與{taboo_god}五行相關產業或投機行為有關',
    ]

    # NEW: Pattern-specific finance archetype (2D lookup, Issue #14 CRITICAL)
    if cong_ge:
        cong_type = cong_ge.get('type', '')
        cong_fin = CONG_GE_FINANCE_ARCHETYPE.get(cong_type, {})
        if cong_fin:
            finance_anchors.append(
                f'從格理財型態：{cong_fin["archetype"]}——{cong_fin["mechanism"]}'
            )
            finance_anchors.append(f'從格理財風險：{cong_fin["risk"]}')
    else:
        fin_archetype = PATTERN_FINANCE_ARCHETYPE.get(prominent_god, {}).get(strength_class, {})
        if fin_archetype:
            finance_anchors.append(
                f'{prominent_god}格{strength_zh}的理財型態：{fin_archetype["archetype"]}——{fin_archetype["mechanism"]}'
            )
            finance_anchors.append(f'理財風險：{fin_archetype["risk"]}')

    # NEW: 正財/偏財 distribution count
    zhengcai_count = 0
    piancai_count = 0
    for pname in ('year', 'month', 'hour'):
        stem = pillars[pname]['stem']
        tg = derive_ten_god(day_master_stem, stem)
        if tg == '正財':
            zhengcai_count += 1
        elif tg == '偏財':
            piancai_count += 1
    finance_anchors.append(f'命局天干中正財{zhengcai_count}個、偏財{piancai_count}個')

    # NEW: 食傷生財 chain with blocking check (Issue #7)
    chain = _detect_food_wealth_chain(five_elements_balance, tougan_analysis, effective_gods, day_master_stem)
    if chain['active']:
        if chain['blocked']:
            finance_anchors.append(f'食傷生財鏈受阻：{chain["reason"]}')
        else:
            finance_anchors.append('食傷生財鏈暢通：食傷星可透過才華轉化為財富')

    anchors['finance_pattern'] = god_system_anchors + finance_anchors

    # ==== CAREER_PATTERN ANCHORS (5-7 anchors) ====
    # Build worst industries from taboo god element
    taboo_industries = ELEMENT_INDUSTRIES_DETAILED.get(taboo_god, [])
    worst_industry_names = []
    for cat in taboo_industries[:2]:  # Top 2 categories
        worst_industry_names.extend(cat.get('industries', [])[:3])

    # Build BEST industries from useful god element
    best_industries = ELEMENT_INDUSTRIES_DETAILED.get(useful_god, [])
    best_industry_names = []
    for cat in best_industries[:2]:
        best_industry_names.extend(cat.get('industries', [])[:3])

    career_anchors = [
        f'最適合的行業方向與{useful_god}五行相關',
        f'最不適合從事的行業方向與{taboo_god}（忌神）五行相關',
    ]
    if best_industry_names:
        career_anchors.append(
            f'具體適合行業包括：{"、".join(best_industry_names[:6])}'
        )
    if worst_industry_names:
        career_anchors.append(
            f'具體不宜行業包括：{"、".join(worst_industry_names[:6])}'
        )

    # NEW: Career archetype from existing TEN_GOD_WORK_STYLE (Issue #4)
    work_style = TEN_GOD_WORK_STYLE.get(prominent_god, {})
    if work_style:
        career_anchors.append(f'職場風格：{work_style.get("dominantStyle", "")}')

    # NEW: Secondary ten god influence (Issue #3)
    dominant_gods = pattern_narrative.get('dominantTenGods', [])
    if len(dominant_gods) >= 2:
        secondary = dominant_gods[1]
        secondary_style = TEN_GOD_WORK_STYLE.get(secondary, {})
        if secondary_style:
            career_anchors.append(
                f'次要職場特質（{secondary}）：{secondary_style.get("dominantStyle", "")}'
            )

    # NEW: 文昌/學堂 career shen sha (with validity gate, Issue #12)
    for sha in all_shen_sha:
        if sha['name'] in ('文昌', '學堂', '將星') and sha['pillar'] in ('month', 'day'):
            interp = SHEN_SHA_PILLAR_INTERPRETATIONS.get(sha['name'], {})
            if interp and sha['pillar'] in interp:
                if _shen_sha_is_valid(sha['name'], sha['branch'], kong_wang, clashed_branches):
                    career_anchors.append(
                        f'{PILLAR_NAME_ZH.get(sha["pillar"], "")}柱帶{sha["name"]}：{interp[sha["pillar"]]}'
                    )

    anchors['career_pattern'] = god_system_anchors + career_anchors

    # ==== HEALTH ANCHORS (5-7 anchors) ====
    health_anchors = []
    # Taboo god element → most vulnerable organs
    taboo_health = ELEMENT_HEALTH_ORGANS.get(taboo_god, {})
    if taboo_health:
        health_anchors.append(
            f'忌神{taboo_god}五行對應器官為{taboo_health["organs"]}，為最脆弱的健康環節'
        )
    # Enemy god element → secondary vulnerable organs
    enemy_health = ELEMENT_HEALTH_ORGANS.get(enemy_god, {})
    if enemy_health:
        health_anchors.append(
            f'仇神{enemy_god}五行對應器官為{enemy_health["organs"]}，為次脆弱的健康環節'
        )
    # Excess/deficiency
    sorted_elements = sorted(five_elements_balance.items(), key=lambda x: x[1], reverse=True)
    excess_el = sorted_elements[0][0] if sorted_elements[0][1] > 25 else None
    deficient_el = sorted_elements[-1][0] if sorted_elements[-1][1] < 15 else None
    if excess_el:
        excess_info = ELEMENT_HEALTH_ORGANS.get(excess_el, {})
        if excess_info:
            health_anchors.append(f'{excess_el}五行過旺（{five_elements_balance[excess_el]:.1f}%），可能出現{excess_info["excess"]}')
    if deficient_el:
        def_info = ELEMENT_HEALTH_ORGANS.get(deficient_el, {})
        if def_info:
            health_anchors.append(f'{deficient_el}五行不足（{five_elements_balance[deficient_el]:.1f}%），可能出現{def_info["deficiency"]}')

    # NEW: Element-conditioned 十二長生 health (Issue #5)
    if day_life_stage:
        stage_health = TWELVE_STAGES_INTERPRETATIONS.get(day_life_stage, {})
        el_health = stage_health.get('health_by_element', {}).get(dm_element, '')
        if el_health:
            health_anchors.append(
                f'日主{dm_element}在日支為「{day_life_stage}」，對應健康：{el_health}'
            )

    # NEW: 天醫 shen sha if present (Issue #8)
    for sha in all_shen_sha:
        if sha['name'] == '天醫':
            interp = SHEN_SHA_PILLAR_INTERPRETATIONS.get('天醫', {})
            if interp and sha['pillar'] in interp:
                if _shen_sha_is_valid('天醫', sha['branch'], kong_wang, clashed_branches):
                    health_anchors.append(
                        f'{PILLAR_NAME_ZH.get(sha["pillar"], "")}柱帶天醫：{interp[sha["pillar"]]}'
                    )

    anchors['health'] = god_system_anchors + health_anchors

    # ==== LOVE_PATTERN ANCHORS (7-9 anchors) ====
    love_anchors = []
    if gender == 'male':
        love_anchors.append('男命看正財為妻星、偏財為情緣星')
        spouse_star_el = ELEMENT_OVERCOMES[dm_element]
        love_anchors.append(f'妻星五行為{spouse_star_el}（日主{dm_element}所克）')
    else:
        love_anchors.append('女命看正官為夫星、偏官為情緣星')
        spouse_star_el = ELEMENT_OVERCOME_BY[dm_element]
        love_anchors.append(f'夫星五行為{spouse_star_el}（克日主{dm_element}之五行）')

    # Day branch (spouse palace) info
    day_hidden = HIDDEN_STEMS.get(day_branch, [])
    if day_hidden:
        day_branch_tg = derive_ten_god(day_master_stem, day_hidden[0])
        love_anchors.append(f'配偶宮（日支{day_branch}）本氣十神為{day_branch_tg}')

    # NEW: Spouse star count with hidden stems (Issue #9)
    spouse_data = _count_spouse_stars(pillars, day_master_stem, gender)
    total_spouse = spouse_data['zheng_count'] + spouse_data['pian_count']
    love_anchors.append(
        f'命局中{spouse_data["zheng_name"]}{spouse_data["zheng_count"]}個、'
        f'{spouse_data["pian_name"]}{spouse_data["pian_count"]}個'
    )
    if spouse_data['mixed']:
        love_anchors.append('⚠️ 正偏混雜：正偏配偶星同時出現，感情較複雜')
    if spouse_data['hidden_stars']:
        love_anchors.append(f'配偶星分佈：{"、".join(spouse_data["hidden_stars"])}')

    # NEW: Day branch 空亡 check with god conditioning (Issue #1)
    if day_branch in kong_wang:
        day_branch_el = BRANCH_ELEMENT.get(day_branch, '')
        fav = _is_element_favorable(day_branch_el, effective_gods)
        base = '配偶宮（日支）空亡，聚少離多、感情不穩'
        if fav == 'unfavorable':
            love_anchors.append(f'{base}，但空亡位為忌神五行，凶性減半')
        elif fav == 'favorable':
            love_anchors.append(f'{base}，且空亡位為用神五行，吉性減半，感情助力更弱')
        else:
            love_anchors.append(base)

    # NEW: Love-related shen sha with validity gate (Issue #12)
    love_sha_names = {'桃花', '紅鸞', '寡宿', '童子煞', '天喜', '孤辰'}
    for sha in all_shen_sha:
        if sha['name'] in love_sha_names:
            interp = SHEN_SHA_PILLAR_INTERPRETATIONS.get(sha['name'], {})
            if interp and sha['pillar'] in interp:
                if _shen_sha_is_valid(sha['name'], sha['branch'], kong_wang, clashed_branches):
                    love_anchors.append(
                        f'{PILLAR_NAME_ZH.get(sha["pillar"], "")}柱帶{sha["name"]}：{interp[sha["pillar"]]}'
                    )

    # NEW: Day branch clash/harm with god-system favorability (Issue #6)
    if branch_relationships:
        for clash in branch_relationships.get('clashes', []):
            branch_list = list(clash.get('branches', ()))
            if day_branch in branch_list:
                other_branch = [b for b in branch_list if b != day_branch]
                if other_branch:
                    other_el = BRANCH_ELEMENT.get(other_branch[0], '')
                    fav = _is_element_favorable(other_el, effective_gods)
                    if fav == 'unfavorable':
                        love_anchors.append(f'配偶宮{day_branch}被沖，但沖走忌神五行{other_el}，反為吉')
                    elif fav == 'favorable':
                        love_anchors.append(f'配偶宮{day_branch}被沖，沖走用神五行{other_el}，婚姻損失較大')

    # Romance warning years — framed as a STRUCTURAL pattern of the chart, not timing prediction
    # Classical: 「日支逢沖之命，一生婚姻多波折」(《子平真詮》)
    # Note: romance_warning_years is pre-filtered to future-only by caller
    if romance_warning_years:
        clash_branch = CLASH_LOOKUP.get(day_branch, '')
        years_str = '、'.join(str(y) for y in romance_warning_years[:3])
        love_anchors.append(
            f'配偶宮{day_branch}與{clash_branch}相沖，'
            f'每逢{clash_branch}年（如{years_str}）均有感情波動風險，'
            f'已婚者須防感情不穩，未婚者反可能觸發婚期'
        )

    anchors['love_pattern'] = god_system_anchors + love_anchors

    # ==== CHILDREN_ANALYSIS ANCHORS ====
    children_anchors = _build_children_anchors(
        pillars, day_master_stem, children_insights, tougan_analysis,
    )
    anchors['children_analysis'] = god_system_anchors + children_anchors

    # ==== PARENTS_ANALYSIS ANCHORS ====
    parents_anchors = _build_parents_anchors(
        pillars, day_master_stem, parents_insights, effective_gods,
    )
    anchors['parents_analysis'] = god_system_anchors + parents_anchors

    # ==== BOSS_STRATEGY ANCHORS (4-5 anchors) ====
    boss_anchors = []
    work_style_data = TEN_GOD_WORK_STYLE.get(prominent_god, {})
    if work_style_data:
        boss_anchors.append(f'工作風格：{work_style_data.get("dominantStyle", "")}')
        boss_anchors.append(f'最適合的上司類型：{work_style_data.get("idealBossType", "")}')
        strengths = work_style_data.get('workplaceStrengths', [])
        if strengths:
            boss_anchors.append(f'職場優勢：{"、".join(strengths)}')
        warnings = work_style_data.get('workplaceWarnings', [])
        if warnings:
            boss_anchors.append(f'職場注意事項：{"、".join(warnings)}')
    # Secondary ten god (Issue #3)
    if len(dominant_gods) >= 2:
        secondary = dominant_gods[1]
        sec_style = TEN_GOD_WORK_STYLE.get(secondary, {})
        if sec_style:
            boss_anchors.append(
                f'次要性格特質（{secondary}）：{sec_style.get("dominantStyle", "")}'
            )
    anchors['boss_strategy'] = god_system_anchors + boss_anchors

    return anchors


def _build_children_anchors(
    pillars: Dict,
    day_master_stem: str,
    children_insights: Dict[str, Any],
    tougan_analysis: List[Dict],
) -> List[str]:
    """Build detailed, self-narrating anchor sentences for children_analysis."""
    dm_element = STEM_ELEMENT[day_master_stem]
    shishan_element = ELEMENT_PRODUCES[dm_element]
    hour_stem = pillars['hour']['stem']
    hour_branch = pillars['hour']['branch']
    hour_hidden = HIDDEN_STEMS.get(hour_branch, [])
    hour_main_qi = hour_hidden[0] if hour_hidden else ''

    anchors = []

    # 1. 食傷 element identification
    anchors.append(
        f'日主{day_master_stem}（{dm_element}）所生之五行為{shishan_element}，'
        f'故食傷星為{shishan_element}五行的天干'
    )

    # 2. Manifest 食傷 — explicitly name WHICH stems and WHERE
    manifest_count = children_insights.get('shishanManifestCount', 0)
    shishan_transparent = children_insights.get('shishanTransparent', [])
    manifest_details = []
    for pname in ('year', 'month', 'hour'):
        stem = pillars[pname]['stem']
        stem_el = STEM_ELEMENT[stem]
        if stem_el == shishan_element:
            tg = derive_ten_god(day_master_stem, stem)
            pillar_zh = PILLAR_NAME_ZH[pname]
            manifest_details.append(f'{stem}（{tg}）在{pillar_zh}干')

    if manifest_details:
        anchors.append(
            f'食傷顯現（天干中）共{manifest_count}個：{"、".join(manifest_details)}'
            f' ← 這些是已透出天干的食傷，不可說「藏而不透」'
        )
    else:
        anchors.append('食傷顯現（天干中）：0個，命局天干中無食傷星出現')

    # 3. Latent 食傷 — explicitly identify
    latent_count = children_insights.get('shishanLatentCount', 0)
    if latent_count > 0:
        latent_details = []
        transparent_stems = set()
        for tg in tougan_analysis:
            if tg['status'] == 'transparent' and tg['tenGod'] in ('食神', '傷官'):
                transparent_stems.add(tg['stem'])
        for pname in ('year', 'month', 'day', 'hour'):
            branch = pillars[pname]['branch']
            hidden = HIDDEN_STEMS.get(branch, [])
            for idx, hs in enumerate(hidden):
                hs_el = STEM_ELEMENT.get(hs, '')
                if hs_el == shishan_element and hs not in transparent_stems:
                    tg = derive_ten_god(day_master_stem, hs)
                    pillar_zh = PILLAR_NAME_ZH[pname]
                    qi_type = '本氣' if idx == 0 else ('中氣' if idx == 1 else '餘氣')
                    latent_details.append(f'{pillar_zh}支{branch}{qi_type}{hs}（{tg}）')
                    # break: each branch counts at most once (no branch has 2 hidden stems of same element)
                    break
        if latent_details:
            anchors.append(
                f'食傷潛藏（地支藏干未透干）共{latent_count}支含食傷：{"、".join(latent_details)}'
                f' ← 這些是藏於地支未透出的食傷，可說「藏而不透」'
            )
    else:
        anchors.append('食傷潛藏（地支藏干未透干）：0支')

    # 4. Hour pillar ten god — CRITICAL disambiguation
    hour_pillar_ten_god = children_insights.get('hourPillarTenGod', '')
    hour_stem_ten_god = derive_ten_god(day_master_stem, hour_stem)

    anchors.append(
        f'⚠️ 時支{hour_branch}的本氣藏干為{hour_main_qi}，'
        f'{hour_main_qi}相對日主{day_master_stem}為「{hour_pillar_ten_god}」'
        f'（此為子女宮的核心能量，代表子女特質）'
    )
    if hour_pillar_ten_god != hour_stem_ten_god:
        anchors.append(
            f'⚠️ 注意區分：時干{hour_stem}對日主{day_master_stem}為'
            f'「{hour_stem_ten_god}」，但子女分析看的是時支本氣十神'
            f'「{hour_pillar_ten_god}」，不是時干十神「{hour_stem_ten_god}」'
        )

    # 5. Children personality from hour pillar ten god
    children_traits = HOUR_TEN_GOD_CHILDREN_TRAITS.get(hour_pillar_ten_god, '')
    if children_traits:
        anchors.append(
            f'時支本氣為{hour_pillar_ten_god}，子女性格特質：{children_traits}'
        )

    # 6. 食傷 suppression status (偏印奪食 detection)
    is_suppressed = children_insights.get('isShishanSuppressed', False)
    suppression_detail = children_insights.get('shishanSuppressionDetail', '')
    if is_suppressed:
        detail = suppression_detail or '偏印奪食，子女緣分受阻或子女發展受限'
        anchors.append(f'{detail}，子女緣分受阻或子女發展受限')
    elif suppression_detail:
        # Not suppressed but has context (e.g., resolved by 偏財, or weak DM benefits)
        anchors.append(suppression_detail)
    else:
        anchors.append('食傷未受印星過度壓制，子女緣分正常')

    # 7. Hour branch life stage
    life_stage = children_insights.get('hourBranchLifeStage', '')
    if life_stage:
        anchors.append(f'日主在時支為「{life_stage}」，反映命主晚年及子女宮的能量狀態')

    return anchors


def _build_parents_anchors(
    pillars: Dict,
    day_master_stem: str,
    parents_insights: Dict[str, Any],
    effective_gods: Dict[str, str],
) -> List[str]:
    """Build detailed, self-narrating anchor sentences for parents_analysis."""
    dm_element = STEM_ELEMENT[day_master_stem]
    year_stem = pillars['year']['stem']
    year_branch = pillars['year']['branch']
    year_hidden = HIDDEN_STEMS.get(year_branch, [])
    year_main_qi = year_hidden[0] if year_hidden else ''

    father_star = parents_insights.get('fatherStar', '')
    mother_star = parents_insights.get('motherStar', '')
    year_stem_ten_god = parents_insights.get('yearStemTenGod', '')
    year_branch_main_ten_god = parents_insights.get('yearBranchMainTenGod', '')
    father_element = parents_insights.get('fatherElement', '')
    mother_element = parents_insights.get('motherElement', '')
    father_star_count = parents_insights.get('fatherStarCount', 0)
    mother_star_count = parents_insights.get('motherStarCount', 0)
    year_relation = parents_insights.get('yearPillarRelation', '')
    favorability = parents_insights.get('yearPillarFavorability', '')

    anchors = []

    # 1. Father: archetype = 偏財, position = year stem
    anchors.append(
        f'年干{year_stem}相對日主{day_master_stem}為「{year_stem_ten_god}」（年柱代表父母宮位）；'
        f'父星為「{father_star}」（{father_element}五行）'
    )

    # 2. Mother: archetype = 正印, position = year branch
    if year_main_qi:
        anchors.append(
            f'年支{year_branch}本氣{year_main_qi}相對日主{day_master_stem}為「{year_branch_main_ten_god}」（年支宮位）；'
            f'母星為「{mother_star}」（{mother_element}五行）'
        )

    # 2b. Parent star count/location
    if father_star_count == 0:
        anchors.append(f'命局中無偏財（父星缺位），父緣較薄或早年離父')
    else:
        anchors.append(f'命局中偏財（父星）出現{father_star_count}次')

    if mother_star_count == 0:
        anchors.append(f'命局中無正印（母星缺位），母緣較薄')
    else:
        anchors.append(f'命局中正印（母星）出現{mother_star_count}次')

    # 3. Father/mother element
    anchors.append(
        f'父親五行看財星（{father_element}，日主{dm_element}所克之五行），'
        f'母親五行看印星（{mother_element}，生日主{dm_element}之五行）'
        f'——此為《子平真詮》性別中立原則'
    )

    # 4. Year pillar relation
    if year_relation:
        anchors.append(f'年柱內部關係：{year_relation}')

    # 5. Year pillar favorability
    taboo_god = effective_gods.get('tabooGod', '')
    enemy_god = effective_gods.get('enemyGod', '')

    if favorability == '喜神':
        anchors.append('年柱整體為喜用，幼年家庭環境對命主有利')
    elif favorability == '忌神':
        year_stem_el = STEM_ELEMENT[year_stem]
        # Be precise: is it taboo or enemy?
        if year_stem_el == taboo_god:
            anchors.append(f'年干五行{year_stem_el}為忌神，幼年家庭環境不利，父親方面壓力較大')
        elif year_stem_el == enemy_god:
            anchors.append(f'年干五行{year_stem_el}為仇神，幼年家庭環境有一定壓力')
        else:
            anchors.append(f'年柱整體為忌，幼年家庭環境不利於命主發展')
    else:
        anchors.append('年柱整體為中性，幼年家庭環境影響不顯著')

    return anchors


# ============================================================
# Call 2 Narrative Anchors — Timing & Fortune sections
# ============================================================

def build_call2_narrative_anchors(
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    effective_gods: Dict[str, str],
    prominent_god: str,
    strength_v2: Dict,
    cong_ge: Optional[Dict],
    luck_periods_enriched: List[Dict],
    best_period: Optional[Dict],
    annual_stars: List[Dict],
    kong_wang: List[str],
    all_shen_sha: List[Dict],
    branch_relationships: Optional[Dict],
    five_elements_balance: Dict[str, float],
    tougan_analysis: List[Dict],
) -> Dict[str, List[str]]:
    """
    Build narrative anchors for all 6 Call 2 sections (timing/fortune).

    These sections previously had ZERO anchors — AI interpreted entirely from
    its own Bazi knowledge, causing accuracy issues.

    All anchors use 2D conditioning: god system + DM strength + pattern type.
    從格 catastrophe detection in all sections (Issue #13).
    """
    dm_element = STEM_ELEMENT[day_master_stem]
    useful_god = effective_gods.get('usefulGod', '')
    taboo_god = effective_gods.get('tabooGod', '')
    classification = strength_v2.get('classification', '')
    strength_class = _get_strength_class(classification)
    clashed_branches = _get_clashed_branches(branch_relationships)

    anchors: Dict[str, List[str]] = {}

    # Determine current year's annual star
    current_year = datetime.now().year
    current_annual = None
    for star in annual_stars:
        if star.get('year') == current_year:
            current_annual = star
            break

    current_annual_tg = ''
    current_annual_branch = ''
    if current_annual:
        current_annual_tg = derive_ten_god(day_master_stem, current_annual['stem'])
        current_annual_branch = current_annual.get('branch', '')

    # Find current luck period
    current_lp = None
    for lp in luck_periods_enriched:
        if lp.get('isCurrent', False):
            current_lp = lp
            break

    # ==== CURRENT_PERIOD ANCHORS (5-7) ====
    period_anchors = []
    if current_lp:
        period_anchors.append(
            f'當前大運：{current_lp.get("stem", "")}{current_lp.get("branch", "")}，'
            f'十神{current_lp.get("tenGod", "")}，評分{current_lp.get("score", 0)}分'
        )
        # Explicit two-stage anchors (matching rival's format)
        stem_tg = current_lp.get('stemTenGod', '')
        branch_tg = current_lp.get('branchTenGod', '')
        stem_el = STEM_ELEMENT.get(current_lp.get('stem', ''), '')
        lp_branch_hidden = HIDDEN_STEMS.get(current_lp.get('branch', ''), [])
        branch_el = STEM_ELEMENT.get(lp_branch_hidden[0], '') if lp_branch_hidden else ''
        mid_year = current_lp.get('startYear', 0) + 5

        period_anchors.append(
            f'第一階段（{current_lp["startYear"]}-{mid_year - 1}）：'
            f'{current_lp["stem"]}（{stem_el}）{stem_tg}主導 — {current_lp.get("stemPhase", "")}'
        )
        period_anchors.append(
            f'第二階段（{mid_year}-{current_lp["endYear"]}）：'
            f'{current_lp["branch"]}（{branch_el}）{branch_tg}主導 — {current_lp.get("branchPhase", "")}'
        )

        # Interactions with natal chart (with favorability, Issue #6)
        interactions = current_lp.get('interactions', [])
        if interactions and isinstance(interactions, list):
            for inter in interactions[:3]:
                if isinstance(inter, str):
                    period_anchors.append(f'大運與命局互動：{inter}')
                elif isinstance(inter, dict):
                    period_anchors.append(f'大運與命局互動：{inter.get("description", str(inter))}')

        # Compare with previous period
        lp_idx = None
        for i, lp in enumerate(luck_periods_enriched):
            if lp.get('isCurrent', False):
                lp_idx = i
                break
        if lp_idx is not None:
            if lp_idx > 0:
                prev_score = luck_periods_enriched[lp_idx - 1].get('score', 0)
                curr_score = current_lp.get('score', 0)
                diff = curr_score - prev_score
                if diff > 0:
                    period_anchors.append(f'相比上一個大運上升{diff}分')
                elif diff < 0:
                    period_anchors.append(f'相比上一個大運下降{abs(diff)}分')
            if lp_idx < len(luck_periods_enriched) - 1:
                next_score = luck_periods_enriched[lp_idx + 1].get('score', 0)
                curr_score = current_lp.get('score', 0)
                if next_score > curr_score:
                    period_anchors.append(f'下一個大運將上升至{next_score}分（轉好）')
                elif next_score < curr_score:
                    period_anchors.append(f'下一個大運將降至{next_score}分（轉弱）')

        # 從格 catastrophe check (Issue #13)
        if cong_ge:
            lp_tg = current_lp.get('tenGod', '')
            cong_jishen_tgs = {'比肩', '劫財', '正印', '偏印'}
            if lp_tg in cong_jishen_tgs:
                period_anchors.append(
                    f'⚠ {cong_ge["name"]}逢{lp_tg}大運，根基動搖，此運凶險度極高'
                )

    anchors['current_period'] = period_anchors

    # ==== BEST_PERIOD ANCHORS (3-4) ====
    best_anchors = []
    if best_period:
        best_anchors.append(
            f'最佳大運：{best_period.get("stem", "")}{best_period.get("branch", "")}，'
            f'十神{best_period.get("tenGod", "")}，評分{best_period.get("score", 0)}分'
        )
        # Why it's the best
        best_tg = best_period.get('tenGod', '')
        best_tg_el = ''
        for stem in HEAVENLY_STEMS:
            tg = derive_ten_god(day_master_stem, stem)
            if tg == best_tg:
                best_tg_el = STEM_ELEMENT[stem]
                break
        if best_tg_el:
            fav = _is_element_favorable(best_tg_el, effective_gods)
            if fav == 'favorable':
                best_anchors.append(f'此運十神{best_tg}五行為{best_tg_el}（用神/喜神方向），與命局最契合')
            else:
                best_anchors.append(f'此運十神{best_tg}五行為{best_tg_el}，綜合互動分數最高')

        # Recommended focus
        best_anchors.append('建議把握此運積極發展事業、投資、進修')

    anchors['best_period'] = best_anchors

    # ==== ANNUAL_FINANCE ANCHORS (4-6) ====
    fin_anchors = []
    if current_annual_tg:
        # Strength-conditional annual ten god finance (Issue #10)
        annual_fin = ANNUAL_TEN_GOD_FINANCE.get(current_annual_tg, {})
        fin_text = annual_fin.get(strength_class, '')
        if fin_text:
            fin_anchors.append(f'今年（{current_year}）流年十神為{current_annual_tg}：{fin_text}')

        # Annual branch interactions with wealth pillars (Issue #11)
        if current_annual_branch:
            wealth_el = ELEMENT_OVERCOMES[dm_element]
            annual_el = BRANCH_ELEMENT.get(current_annual_branch, '')
            fav = _is_element_favorable(annual_el, effective_gods)
            if fav == 'favorable':
                fin_anchors.append(f'流年地支{current_annual_branch}五行為{annual_el}（用神/喜神方向），有利財運')
            elif fav == 'unfavorable':
                fin_anchors.append(f'流年地支{current_annual_branch}五行為{annual_el}（忌神/仇神方向），不利財運')

        # 食傷生財 chain activation check (Issue #7)
        chain = _detect_food_wealth_chain(five_elements_balance, tougan_analysis, effective_gods, day_master_stem)
        if chain['active'] and not chain['blocked']:
            food_el = ELEMENT_PRODUCES[dm_element]
            if current_annual_tg in ('食神', '傷官'):
                fin_anchors.append('今年流年逢食傷星，食傷生財鏈被激活，利才華變現')

        # 從格 catastrophe for finance (Issue #13)
        if cong_ge and current_annual_tg in ('比肩', '劫財', '正印', '偏印'):
            fin_anchors.append(
                f'⚠ {cong_ge["name"]}今年逢{current_annual_tg}流年，財運根基動搖，大破財之險'
            )

    anchors['annual_finance'] = fin_anchors

    # ==== ANNUAL_CAREER ANCHORS (3-5) ====
    career_anchors = []
    if current_annual_tg:
        # Annual ten god career implication (strength-conditional, all 10 gods covered)
        if strength_class == 'strong':
            if current_annual_tg in ('正官', '偏官'):
                career_anchors.append(f'今年逢{current_annual_tg}，身旺得官星制衡，利升遷加薪')
            elif current_annual_tg in ('食神', '傷官'):
                career_anchors.append(f'今年逢{current_annual_tg}，身旺洩秀，利表現才華、展現能力')
            elif current_annual_tg in ('比肩', '劫財'):
                career_anchors.append(f'今年逢{current_annual_tg}，身旺比劫再助，同行競爭激烈')
            elif current_annual_tg in ('正財', '偏財'):
                career_anchors.append(f'今年逢{current_annual_tg}，身旺財星可用，利業務拓展、主動爭取')
            elif current_annual_tg in ('正印', '偏印'):
                career_anchors.append(f'今年逢{current_annual_tg}，身旺再逢印星，學業有利但事業易保守')
        elif strength_class == 'weak':
            if current_annual_tg in ('正印', '偏印'):
                career_anchors.append(f'今年逢{current_annual_tg}，身弱得印星生扶，利進修考證')
            elif current_annual_tg in ('比肩', '劫財'):
                career_anchors.append(f'今年逢{current_annual_tg}，身弱得助力，利團隊合作')
            elif current_annual_tg in ('正官', '偏官'):
                career_anchors.append(f'今年逢{current_annual_tg}，身弱官殺克身，工作壓力大')
            elif current_annual_tg in ('食神', '傷官'):
                career_anchors.append(f'今年逢{current_annual_tg}，身弱逢食傷洩氣，工作易疲勞、產出受限')
            elif current_annual_tg in ('正財', '偏財'):
                career_anchors.append(f'今年逢{current_annual_tg}，身弱財多身弱，工作量大但回報有限')

        # 驛馬/文昌 activation (with validity gate, Issue #12)
        if current_annual_branch:
            for sha in all_shen_sha:
                if sha['name'] in ('驛馬', '文昌', '將星') and sha['branch'] == current_annual_branch:
                    interp = SHEN_SHA_PILLAR_INTERPRETATIONS.get(sha['name'], {})
                    if _shen_sha_is_valid(sha['name'], sha['branch'], kong_wang, clashed_branches):
                        career_anchors.append(f'今年流年引動{sha["name"]}，利事業變動或出差外展')

        # Annual branch vs month branch (事業宮, Issue #11)
        if current_annual_branch:
            month_branch = pillars['month']['branch']
            # Check if annual clashes month (事業宮被沖)
            from .branch_relationships import CLASH_LOOKUP, SIX_HARMS
            if CLASH_LOOKUP.get(current_annual_branch) == month_branch:
                career_anchors.append(f'流年{current_annual_branch}沖月支（事業宮）{month_branch}，事業環境有變動')
            # Check if annual harms month (事業宮受害)
            elif frozenset({current_annual_branch, month_branch}) in SIX_HARMS:
                career_anchors.append(f'流年{current_annual_branch}害月支（事業宮）{month_branch}，事業有暗中阻礙')

        # 從格 catastrophe (Issue #13)
        if cong_ge and current_annual_tg in ('比肩', '劫財', '正印', '偏印'):
            career_anchors.append(
                f'⚠ {cong_ge["name"]}今年逢{current_annual_tg}，事業根基動搖，防降職或失業'
            )

    anchors['annual_career'] = career_anchors

    # ==== ANNUAL_LOVE ANCHORS (3-5) ====
    love_anchors = []
    if current_annual_branch:
        day_branch = pillars['day']['branch']

        # Annual branch vs day branch (配偶宮, Issue #11)
        from .branch_relationships import CLASH_LOOKUP, SIX_HARMS, TRIPLE_HARMONIES
        if CLASH_LOOKUP.get(current_annual_branch) == day_branch:
            love_anchors.append(f'流年{current_annual_branch}沖日支（配偶宮）{day_branch}，感情有大變動')
        elif HARMONY_LOOKUP.get(current_annual_branch) == day_branch:
            love_anchors.append(f'流年{current_annual_branch}合日支（配偶宮）{day_branch}，感情和諧有喜')
        elif frozenset({current_annual_branch, day_branch}) in SIX_HARMS:
            love_anchors.append(f'流年{current_annual_branch}害日支（配偶宮）{day_branch}，感情有暗中困擾')

        # Check if annual branch forms 三合 involving day branch (配偶宮)
        all_natal_branches = [pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')]
        for th in TRIPLE_HARMONIES:
            th_set = th['branches']
            if day_branch in th_set and current_annual_branch in th_set:
                # Check if the third branch is in natal chart
                third = th_set - {day_branch, current_annual_branch}
                if third and list(third)[0] in all_natal_branches:
                    el = th.get('element', '')
                    fav = _is_element_favorable(el, effective_gods)
                    if fav == 'favorable':
                        love_anchors.append(f'流年{current_annual_branch}與日支{day_branch}形成三合{el}局（用神方向），感情穩定有助力')
                    elif fav == 'unfavorable':
                        love_anchors.append(f'流年{current_annual_branch}與日支{day_branch}形成三合{el}局（忌神方向），感情受外力牽動')
                    else:
                        love_anchors.append(f'流年{current_annual_branch}與日支{day_branch}形成三合{el}局，配偶宮被引動')
                    break  # Only report first matching triple harmony

        # 紅鸞/桃花/天喜 activation (with validity gate, Issue #12)
        love_sha = {'桃花', '紅鸞', '天喜'}
        for sha in all_shen_sha:
            if sha['name'] in love_sha and sha['branch'] == current_annual_branch:
                if _shen_sha_is_valid(sha['name'], sha['branch'], kong_wang, clashed_branches):
                    love_anchors.append(f'今年流年引動{sha["name"]}，有感情機遇')

        # Annual stem spouse star detection (Issue #9)
        if current_annual:
            annual_stem = current_annual.get('stem', '')
            if annual_stem:
                annual_tg = derive_ten_god(day_master_stem, annual_stem)
                if gender == 'male' and annual_tg in ('正財', '偏財'):
                    love_anchors.append(f'今年流年天干{annual_stem}為{annual_tg}（配偶星出現），利感情')
                elif gender == 'female' and annual_tg in ('正官', '偏官'):
                    love_anchors.append(f'今年流年天干{annual_stem}為{annual_tg}（夫星出現），利感情')

    # 從格 catastrophe for love (Issue #13)
    if cong_ge and current_annual_tg in ('比肩', '劫財'):
        love_anchors.append(
            f'⚠ {cong_ge["name"]}今年逢{current_annual_tg}，感情上防第三者介入或關係動搖'
        )

    anchors['annual_love'] = love_anchors

    # ==== ANNUAL_HEALTH ANCHORS (3-4) ====
    health_anchors = []
    if current_annual_branch:
        annual_el = BRANCH_ELEMENT.get(current_annual_branch, '')
        if annual_el:
            # Element balance implications (Issue #5)
            fav = _is_element_favorable(annual_el, effective_gods)
            if fav == 'unfavorable':
                el_health = ELEMENT_HEALTH_ORGANS.get(annual_el, {})
                if el_health:
                    health_anchors.append(
                        f'今年流年五行{annual_el}（忌神/仇神方向）加重，'
                        f'注意{el_health["organs"]}相關健康問題'
                    )

            # Day master element health based on annual stage
            annual_stage = get_life_stage(day_master_stem, current_annual_branch)
            if annual_stage:
                stage_health = TWELVE_STAGES_INTERPRETATIONS.get(annual_stage, {})
                el_health_text = stage_health.get('health_by_element', {}).get(dm_element, '')
                if el_health_text:
                    health_anchors.append(
                        f'日主{dm_element}在流年{current_annual_branch}為「{annual_stage}」：{el_health_text}'
                    )

    # Weakest element this year
    if current_annual_tg:
        if current_annual_tg in ('偏官', '正官') and strength_class == 'weak':
            health_anchors.append('身弱逢官殺年，身體負荷大，防過勞與壓力性疾病')
        elif current_annual_tg in ('食神', '傷官') and strength_class == 'weak':
            health_anchors.append('身弱逢食傷年，精力消耗大，注意休息與營養補充')

    anchors['annual_health'] = health_anchors

    return anchors


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
    branch_relationships: Optional[Dict] = None,
    birth_year: int = 0,
) -> Dict[str, Any]:
    """
    Generate all enhanced deterministic insights for lifetime V2 reading.

    Returns a dict with:
      - patternNarrative
      - childrenInsights
      - parentsInsights
      - bossCompatibility
      - narrativeAnchors (Call 1)
      - call2NarrativeAnchors (Call 2)
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
        effective_gods=effective_gods,
        strength_classification=strength_v2.get('classification', 'neutral'),
    )

    parents_insights = build_parents_insights(
        pillars, day_master_stem, effective_gods,
    )

    boss_compatibility = build_boss_compatibility(prominent_god)

    # Compute all shen sha internally (no new parameter needed)
    all_shen_sha = get_all_shen_sha(pillars)

    # Romance warning years (六沖日支 — spouse palace clash)
    # Computed BEFORE anchors so it can be passed to build_narrative_anchors()
    day_branch = pillars['day']['branch']
    romance_warning_years = compute_romance_warning_years(
        day_branch, annual_stars, kong_wang, birth_year=birth_year,
    )
    # Pre-filter to future years for anchor display
    now_year = datetime.now().year
    warning_years_future = [y for y in romance_warning_years if y >= now_year] if romance_warning_years else []

    # Narrative anchors — pre-narrated facts for AI to embed (v2: enhanced with 2D conditioning)
    narrative_anchors = build_narrative_anchors(
        pillars, day_master_stem, gender, five_elements_balance,
        effective_gods, prominent_god, strength_v2, cong_ge,
        tougan_analysis, children_insights, parents_insights,
        pattern_narrative,
        branch_relationships=branch_relationships,
        kong_wang=kong_wang,
        all_shen_sha=all_shen_sha,
        romance_warning_years=warning_years_future,
    )

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
    partner_data = compute_partner_zodiacs(day_branch, year_branch)
    # Add partner element (from 喜用 elements)
    partner_elements = []
    if useful_god and useful_god not in partner_elements:
        partner_elements.append(useful_god)
    if favorable_god and favorable_god != useful_god and favorable_god not in partner_elements:
        partner_elements.append(favorable_god)

    # Romance years (filtered to 1 most recent past + next 10 years)
    current_year = datetime.now().year
    romance_years = compute_romance_years(
        gender, day_master_stem, day_branch, year_branch,
        annual_stars, kong_wang, birth_year=birth_year,
        current_year=current_year,
    )

    # Parent health years (dual output: full for AI, future-filtered for display)
    parent_health_years = compute_parent_health_years(
        day_master_stem, annual_stars, birth_year=birth_year,
        current_year=current_year,
    )

    # Stars in 空亡 — flag key natal stars whose branches fall in 空亡
    stars_in_kong_wang = compute_stars_in_kong_wang(
        day_master_stem, day_branch, year_branch, kong_wang,
    )

    # Enriched luck periods
    luck_periods_enriched = enrich_luck_periods(
        luck_periods, pillars, day_master_stem, effective_gods,
    )

    # Romance years 大運 tagging — enriched with tier/signal + LP context
    romance_data_enriched = compute_romance_years_enriched(
        gender, day_master_stem, day_branch, year_branch,
        annual_stars, kong_wang, birth_year=birth_year,
        current_year=current_year,
    )
    romance_years_dayun_context = tag_romance_years_with_dayun(
        romance_data_enriched, annual_stars, luck_periods_enriched,
        day_branch, year_branch, day_master_stem, gender,
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

    # Call 2 Narrative Anchors — timing/fortune sections
    call2_anchors = build_call2_narrative_anchors(
        pillars=pillars,
        day_master_stem=day_master_stem,
        gender=gender,
        effective_gods=effective_gods,
        prominent_god=prominent_god,
        strength_v2=strength_v2,
        cong_ge=cong_ge,
        luck_periods_enriched=luck_periods_enriched,
        best_period=best_period,
        annual_stars=annual_stars,
        kong_wang=kong_wang,
        all_shen_sha=all_shen_sha,
        branch_relationships=branch_relationships,
        five_elements_balance=five_elements_balance,
        tougan_analysis=tougan_analysis,
    )

    return {
        'patternNarrative': pattern_narrative,
        'childrenInsights': children_insights,
        'parentsInsights': parents_insights,
        'bossCompatibility': boss_compatibility,
        'narrativeAnchors': narrative_anchors,
        'call2NarrativeAnchors': call2_anchors,
        'deterministic': {
            'favorable_investments': favorable_investments,
            'unfavorable_investments': unfavorable_investments,
            'career_directions': career_directions,
            'favorable_direction': favorable_direction,
            'career_benefactors_element': benefactors['career_benefactors_element'],
            'career_benefactors_zodiac': benefactors['career_benefactors_zodiac'],
            'partner_element': partner_elements,
            'partner_zodiac': partner_data['partner_zodiac'],
            'partner_zodiac_secondary': partner_data['partner_zodiac_secondary'],
            'romance_years': romance_years,
            'romance_years_dayun_context': romance_years_dayun_context,
            'romance_warning_years': romance_warning_years,
            'parent_health_years': parent_health_years,
            'stars_in_kong_wang': stars_in_kong_wang,
            'luck_periods_enriched': luck_periods_enriched,
            'best_period': best_period,
            'annualTenGod': annual_ten_god,
        },
    }
