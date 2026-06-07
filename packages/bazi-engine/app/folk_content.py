"""Folk content lookup tables + 黃道吉時 algorithm.

Phase 1.5.z — provides deterministic engine output for 4 new folk-content
fields (吉色 / 吉數 / 吉食 含忌食 / 吉時) layered on top of Phase 1's
existing wealthDirection.

All chart-level fields (color/number/food) are 用神-keyed (mirrors the
existing wealthDirection precedent at lifetime_enhanced.py::ELEMENT_DIRECTION).
The 黃道吉時 algorithm is per-day, keyed on day_branch ONLY (per 協紀辨方書
卷十 «日上起時神煞» / 青龍訣).

Research artifacts + classical citations:
    /Users/roger/.claude/plans/fortune-folk-content-research-results.md

Provenance dispatch (per Phase A Sub-Agent C verdict):
    - 吉色 / 吉食 favor / 吉食 avoid / 吉時 = 'classical' (黃帝內經 + 協紀辨方書 citations)
    - 吉數 = 'folk_tradition' (河圖 classical source, but 子平 modern-app density low —
      visible 「民俗」 UI badge enforces tier disclosure)

Anti-DM-drift contract: all chart-level fields key on USEFUL GOD (用神) element,
NOT day-master element. AI prompt forbids «您是X日主，宜X色»; required form is
«您的用神為X，宜X色». Phase A Sub-Agent C audit confirmed all 5 fields converge
with the wealthDirection precedent.

CRITICAL doctrinal distinction (per Phase A Sub-Agent B + C P0 finding):
    黃黑道十二神 (青龍/明堂/天刑/朱雀/...) — keys on DAY-BRANCH only (per 青龍訣)
    建除十二神 (建/除/滿/平/...)        — keys on MONTH-BRANCH (per 月建)
    DO NOT CONFUSE — they share the «12 神煞» framing but are distinct systems.
    Source: 協紀辨方書 卷十 «日上起時神煞» + 三命通會 卷三 «年月一組,日時一組».
"""

from typing import Any, Dict, List, Tuple

# =============================================================================
# 1. ELEMENT_COLOR — 五行配色 (黃帝內經素問·五常政大論 + 陰陽應象大論)
# =============================================================================

ELEMENT_COLOR: Dict[str, Dict[str, Any]] = {
    '木': {
        'primary': '青',
        'secondary': '綠',
        'tertiary': '黑(水生木,輔助色)',
        'classical_cite': '黃帝內經素問·五常政大論「敷和之紀…其色蒼」；素問·陰陽應象大論「東方青色,入通於肝」',
        'provenance': 'classical',
    },
    '火': {
        'primary': '紅',
        'secondary': '紫',
        'tertiary': '青綠(木生火,輔助色)',
        'classical_cite': '黃帝內經素問·五常政大論「升明之紀…其色赤」；素問·陰陽應象大論「南方赤色,入通於心」',
        'provenance': 'classical',
    },
    '土': {
        'primary': '黃',
        'secondary': '褐(土色)',
        'tertiary': '紅紫(火生土,輔助色)',
        'classical_cite': '黃帝內經素問·五常政大論「備化之紀…其色黅(黃)」；素問·陰陽應象大論「中央黃色,入通於脾」',
        'provenance': 'classical',
    },
    '金': {
        'primary': '白',
        'secondary': '金(銀白/淺金)',
        'tertiary': '黃褐(土生金,輔助色)',
        'classical_cite': '黃帝內經素問·五常政大論「審平之紀…其色白」；素問·陰陽應象大論「西方白色,入通於肺」',
        'provenance': 'classical',
    },
    '水': {
        'primary': '黑',
        'secondary': '藍(深藍/靛)',
        'tertiary': '白銀(金生水,輔助色)',
        'classical_cite': '黃帝內經素問·五常政大論「靜順之紀…其色玄(黑)」；素問·陰陽應象大論「北方黑色,入通於腎」',
        'provenance': 'classical',
    },
}


# =============================================================================
# 2. ELEMENT_NUMBER — 河圖五行數 (folk_tradition tier)
# =============================================================================

ELEMENT_NUMBER: Dict[str, Dict[str, Any]] = {
    '木': {
        'numbers': [3, 8],
        'cite': '河圖：「三八為朋木」；繫辭傳「天三生木,地八成之」',
        'provenance': 'folk_tradition',
        'modern_consensus_note': '河圖數字-五行映射為先秦數術經典,但在當代正統子平命理'
                                 '(滴天髓/子平真詮路線)中極少被引用為流日吉數依據;主要見於'
                                 '命名學/姓名筆畫派與現代風水擇日派。視為民俗應用,非命理硬論。',
    },
    '火': {
        'numbers': [2, 7],
        'cite': '河圖：「二七同道火」；繫辭傳「地二生火,天七成之」',
        'provenance': 'folk_tradition',
        'modern_consensus_note': '同上 — 數字屬性源於河圖體系,在子平派為輔助參考。',
    },
    '土': {
        'numbers': [5, 10],
        'cite': '河圖：「五十同德土」；繫辭傳「天五生土,地十成之」',
        'provenance': 'folk_tradition',
        'modern_consensus_note': '5/10 在民俗使用中受限(無 10 號;5 易與五行本數混淆),'
                                 '部分現代派以 2-7(火生土)或 0/5 作替代,但 5/10 為河圖原版。',
    },
    '金': {
        'numbers': [4, 9],
        'cite': '河圖：「四九為友金」；繫辭傳「地四生金,天九成之」',
        'provenance': 'folk_tradition',
        'modern_consensus_note': '同木/火 — 河圖派應用,子平派非主流。',
    },
    '水': {
        'numbers': [1, 6],
        'cite': '河圖：「一六共宗水」；繫辭傳「天一生水,地六成之」',
        'provenance': 'folk_tradition',
        'modern_consensus_note': '同上。',
    },
}


# =============================================================================
# 3. ELEMENT_FOOD_FAVOR — 五行食物 (黃帝內經素問·陰陽應象大論 + 五常政大論)
# =============================================================================

ELEMENT_FOOD_FAVOR: Dict[str, Dict[str, Any]] = {
    '木': {
        'category': '青綠葉蔬/酸味/疏肝',
        'examples': ['菠菜', '青花椰', '芹菜', '檸檬', '梅子'],
        'cite': '素問·陰陽應象大論「東方青色,入通於肝…在味為酸」；'
                '素問·五常政大論「敷和之紀…其味酸」',
        'provenance': 'classical',
    },
    '火': {
        'category': '紅色食物/苦味/養心',
        'examples': ['番茄', '紅棗', '紅豆', '苦瓜', '蓮子心'],
        'cite': '素問·陰陽應象大論「南方赤色,入通於心…在味為苦」；'
                '素問·五常政大論「升明之紀…其味苦」',
        'provenance': 'classical',
    },
    '土': {
        'category': '黃色食物/甘味/健脾',
        'examples': ['南瓜', '小米', '玉米', '地瓜', '山藥'],
        'cite': '素問·陰陽應象大論「中央黃色,入通於脾…在味為甘」；'
                '素問·五常政大論「備化之紀…其味甘」',
        'provenance': 'classical',
    },
    '金': {
        'category': '白色食物/辛味/潤肺',
        'examples': ['白蘿蔔', '銀耳', '梨', '蓮藕', '杏仁'],
        'cite': '素問·陰陽應象大論「西方白色,入通於肺…在味為辛」；'
                '素問·五常政大論「審平之紀…其味辛」',
        'provenance': 'classical',
    },
    '水': {
        'category': '黑色食物/鹹味/補腎',
        'examples': ['黑豆', '黑芝麻', '海帶', '紫菜', '黑木耳'],
        'cite': '素問·陰陽應象大論「北方黑色,入通於腎…在味為鹹」；'
                '素問·五常政大論「靜順之紀…其味鹹」',
        'provenance': 'classical',
    },
}


# =============================================================================
# 4. ELEMENT_FOOD_AVOID — 用神受剋之味 (all entries doctrinal + ≥3 sources + strong)
# =============================================================================
#
# Audit: all 5 entries classified `doctrinal` (NOT tcm_conditional) per
# Phase A Sub-Agent C verdict. ≥3 cross-source 素問 citations per entry.
# `avoid_strength='strong'` ships to UI; weak/conditional entries fenced in
# the documentation-only constant below.

ELEMENT_FOOD_AVOID: Dict[str, Dict[str, Any]] = {
    '木': {
        'category': '辛辣/金味 (金剋木)',
        'examples': ['辣椒', '芥末', '生薑過量', '濃烈蔥蒜'],
        'reason': '用神為木,忌辛味金性食物 — 金剋木,辛入肺金,過食則木氣受抑,肝鬱不舒',
        'cite_sources': [
            '素問·五常政大論「金克木…木鬱之發,民病…」',
            '素問·宣明五氣「辛走氣,氣病無多食辛」',
            '素問·陰陽應象大論「西方白色…在味為辛」+「金勝木」相剋鏈',
        ],
        'classification': 'doctrinal',
        'avoid_strength': 'strong',
        'provenance': 'classical',
    },
    '火': {
        'category': '寒涼/鹹味 (水剋火)',
        'examples': ['過量冰品', '生冷海鮮', '重鹹醃漬物'],
        'reason': '用神為火,忌鹹味水性食物 — 水剋火,鹹入腎水,過食則火氣受撲,心陽不振',
        'cite_sources': [
            '素問·五常政大論「水克火…火鬱之發,民病…」',
            '素問·宣明五氣「鹹走血,血病無多食鹹」',
            '素問·陰陽應象大論「北方黑色…在味為鹹」+「水勝火」相剋鏈',
        ],
        'classification': 'doctrinal',
        'avoid_strength': 'strong',
        'provenance': 'classical',
    },
    '土': {
        'category': '酸味/木性 (木剋土)',
        'examples': ['過量酸梅', '濃醋', '酸味重的醃製品'],
        'reason': '用神為土,忌酸味木性食物 — 木剋土,酸入肝木,過食則土氣受疏泄,脾胃失運',
        'cite_sources': [
            '素問·五常政大論「木克土…土鬱之發,民病…」',
            '素問·宣明五氣「酸走筋,筋病無多食酸」',
            '素問·陰陽應象大論「東方青色…在味為酸」+「木勝土」相剋鏈',
        ],
        'classification': 'doctrinal',
        'avoid_strength': 'strong',
        'provenance': 'classical',
    },
    '金': {
        'category': '苦味/火性 (火剋金)',
        'examples': ['濃苦茶', '過量苦瓜', '焦烤燒灼食物'],
        'reason': '用神為金,忌苦味火性食物 — 火剋金,苦入心火,過食則金氣受灼,肺燥津傷',
        'cite_sources': [
            '素問·五常政大論「火克金…金鬱之發,民病…」',
            '素問·宣明五氣「苦走骨,骨病無多食苦」(後世注：火克金亦灼肺)',
            '素問·陰陽應象大論「南方赤色…在味為苦」+「火勝金」相剋鏈',
        ],
        'classification': 'doctrinal',
        'avoid_strength': 'strong',
        'provenance': 'classical',
    },
    '水': {
        'category': '甘膩/土性 (土剋水)',
        'examples': ['過量甜食', '濃郁糕點', '高糖飲料'],
        'reason': '用神為水,忌甘味土性食物 — 土剋水,甘入脾土,過食則水氣受堙,腎氣受困',
        'cite_sources': [
            '素問·五常政大論「土克水…水鬱之發,民病…」',
            '素問·宣明五氣「甘走肉,肉病無多食甘」',
            '素問·陰陽應象大論「中央黃色…在味為甘」+「土勝水」相剋鏈',
        ],
        'classification': 'doctrinal',
        'avoid_strength': 'strong',
        'provenance': 'classical',
    },
}


# =============================================================================
# 5. 黃道吉時 algorithm tables (per 協紀辨方書 卷十 «日上起時神煞» / 青龍訣)
# =============================================================================
#
# CRITICAL: 黃黑道十二神 keys on DAY-BRANCH (per 青龍訣 «子午青龍起在申»).
# NOT to be confused with 建除十二神 which keys on month-branch (per 月建).
# Source: 協紀辨方書 卷十 + 三命通會 卷三 «年月一組,日時一組».
#
# The 青龍訣 mnemonic (reproduced verbatim across all major 通書):
#   子午青龍起在申，卯酉之日又在寅，
#   寅申須從子上起，巳亥在午不須論，
#   唯有辰戌歸辰位，丑未原從戌上尋。

DAY_BRANCH_QINGLONG_HOUR_START: Dict[str, str] = {
    '子': '申',  # 子午青龍起在申
    '午': '申',
    '卯': '寅',  # 卯酉之日又在寅
    '酉': '寅',
    '寅': '子',  # 寅申須從子上起
    '申': '子',
    '巳': '午',  # 巳亥在午不須論
    '亥': '午',
    '辰': '辰',  # 唯有辰戌歸辰位
    '戌': '辰',
    '丑': '戌',  # 丑未原從戌上尋
    '未': '戌',
}

# Canonical 12-神煞 sequence (協紀辨方書 卷十 + 三命通會 卷一). LOCKED order.
SHENSHA_SEQUENCE: Tuple[str, ...] = (
    '青龍', '明堂', '天刑', '朱雀', '金匱', '天德',
    '白虎', '玉堂', '天牢', '玄武', '司命', '勾陳',
)

# 6 黃道 + 6 黑道 per 協紀辨方書 卷十.
SHENSHA_ROAD: Dict[str, str] = {
    '青龍': '黃道',  '明堂': '黃道',
    '天刑': '黑道',  '朱雀': '黑道',
    '金匱': '黃道',  '天德': '黃道',
    '白虎': '黑道',  '玉堂': '黃道',
    '天牢': '黑道',  '玄武': '黑道',
    '司命': '黃道',  '勾陳': '黑道',
}

BRANCH_ORDER: Tuple[str, ...] = (
    '子', '丑', '寅', '卯', '辰', '巳',
    '午', '未', '申', '酉', '戌', '亥',
)

# Asia/Taipei (UTC+8) per engine convention. 子時 = single 23:00-01:00 block
# (no 子初/子正 split for 神煞 dispatch per mainstream 通書 + 協紀辨方書 卷十).
HOUR_RANGES: Dict[str, str] = {
    '子': '23:00-01:00', '丑': '01:00-03:00', '寅': '03:00-05:00',
    '卯': '05:00-07:00', '辰': '07:00-09:00', '巳': '09:00-11:00',
    '午': '11:00-13:00', '未': '13:00-15:00', '申': '15:00-17:00',
    '酉': '17:00-19:00', '戌': '19:00-21:00', '亥': '21:00-23:00',
}


# =============================================================================
# 6. _TCM_CONDITIONAL_AVOIDS_DOC_ONLY — documentation-only constant
# =============================================================================
#
# DO NOT EXPORT — documentation-only. These body-constitution-dependent items
# require 體質 input the engine lacks; they are deliberately EXCLUDED from
# ELEMENT_FOOD_AVOID. Documented here to prevent future contributors from
# «completing» the avoid list with these items (per Phase A Sub-Agent C audit).

_TCM_CONDITIONAL_AVOIDS_DOC_ONLY: Dict[str, List[Tuple[str, str]]] = {
    '木': [
        ('燥熱辛烈(如重椒/麻辣鍋)', '僅適用於肝陰虛/肝陽上亢體質,健康體質木旺者可耐受'),
        ('過量酒精', '酒助肝火,木旺者忌,但木弱者反需溫養 — 體質依賴'),
    ],
    '火': [
        ('冰品/生冷', '適用於心陽不足或脾胃虛寒;心火亢盛者反宜清涼'),
        ('過食動物脂肪', '營養學風險,非五行相剋'),
    ],
    '土': [
        ('生冷瓜果', '脾陽虛體質忌;脾胃濕熱型反宜'),
        ('過量乳製品', '脾虛濕困者忌;非五行硬論'),
    ],
    '金': [
        ('煙燻燒烤', '肺陰虛者忌;屬熱毒概念非五行相剋'),
        ('過量乳製品/生痰之物', '痰濕體質肺氣不利者忌'),
    ],
    '水': [
        ('過鹹醃製品', '腎陰虛/高血壓者忌,但「鹹入腎」本為水之本味,過量才轉害'),
        ('過食溫燥食物', '腎陰虛者忌;非五行剋制硬論'),
    ],
}


# =============================================================================
# Public API
# =============================================================================

def compute_auspicious_hours(*, day_branch: str) -> List[Dict[str, str]]:
    """Return all yellow-road (黃道) hours for a given day-branch.

    Algorithm: 協紀辨方書 卷十 «日上起時神煞».
    Month-branch is NOT a parameter — the calculation depends solely on
    day-branch + 青龍訣 + 12-神煞 sequence.

    NOTE: distinct from 建除十二神 which keys on month-branch. DO NOT confuse.

    Returns 6 yellow-road hours (one per equivalence class of day-branches).
    Output sorted 子→亥 for deterministic UI rendering.

    Args:
        day_branch: One of 12 地支 (子丑寅卯辰巳午未申酉戌亥).
                    MUST be the BAZI day-branch (per 23:00 子時 rollover convention
                    in fortune_constants.py), NOT the calendar day-branch.

    Returns:
        List of 6 dicts, each {branch, hour_range, classical_name}.

    Raises:
        ValueError: if day_branch is not one of the 12 地支.
    """
    if day_branch not in DAY_BRANCH_QINGLONG_HOUR_START:
        raise ValueError(f'invalid day_branch: {day_branch!r}')

    qinglong_hour = DAY_BRANCH_QINGLONG_HOUR_START[day_branch]
    start_idx = BRANCH_ORDER.index(qinglong_hour)

    rows: List[Dict[str, str]] = []
    for offset in range(12):
        hour_branch = BRANCH_ORDER[(start_idx + offset) % 12]
        shensha = SHENSHA_SEQUENCE[offset]
        if SHENSHA_ROAD[shensha] == '黃道':
            rows.append({
                'branch': hour_branch,
                'hour_range': HOUR_RANGES[hour_branch],
                'classical_name': shensha,
                'provenance': 'classical',
            })
    rows.sort(key=lambda r: BRANCH_ORDER.index(r['branch']))
    return rows


def compute_folk_content(
    *,
    useful_god_element: str,
    day_branch: str,
) -> Dict[str, Any]:
    """Compute the full folk-content payload for a single day.

    Returns 5 keys (the 4 new fields; wealthDirection is wrapped by the
    caller in daily_enhanced.py::_compute_static_folk_content):
        - luckyColor       — chart-level invariant (用神 element)
        - luckyNumber      — chart-level invariant (用神 element, folk_tradition)
        - luckyFoodFavor   — chart-level invariant (用神 element)
        - luckyFoodAvoid   — chart-level invariant (用神 element受剋之味)
        - auspiciousHours  — per-day (day_branch only)

    Empty/None useful_god_element → chart-level fields return None
    (defensive: caller may have unresolved 用神 for edge-case charts).
    Auspicious hours still emit (day_branch is always available).
    """
    out: Dict[str, Any] = {
        'auspiciousHours': compute_auspicious_hours(day_branch=day_branch),
    }

    if useful_god_element and useful_god_element in ELEMENT_COLOR:
        color = ELEMENT_COLOR[useful_god_element]
        out['luckyColor'] = {
            'element': useful_god_element,
            'primary': color['primary'],
            'secondary': color['secondary'],
            'tertiary': color['tertiary'],
            'cite': color['classical_cite'],
            'provenance': color['provenance'],
            'note': '用神配色（命局層級，每日不變）',
        }

        number = ELEMENT_NUMBER[useful_god_element]
        out['luckyNumber'] = {
            'element': useful_god_element,
            'numbers': list(number['numbers']),
            'cite': number['cite'],
            'provenance': number['provenance'],
            'note': '河圖五行數（民俗應用，命局層級不變）',
        }

        food_favor = ELEMENT_FOOD_FAVOR[useful_god_element]
        out['luckyFoodFavor'] = {
            'element': useful_god_element,
            'category': food_favor['category'],
            'examples': list(food_favor['examples']),
            'cite': food_favor['cite'],
            'provenance': food_favor['provenance'],
        }

        food_avoid = ELEMENT_FOOD_AVOID[useful_god_element]
        out['luckyFoodAvoid'] = {
            'element': useful_god_element,
            'category': food_avoid['category'],
            'reason': food_avoid['reason'],
            'cite_sources': list(food_avoid['cite_sources']),
            'classification': food_avoid['classification'],
            'avoid_strength': food_avoid['avoid_strength'],
            'provenance': food_avoid['provenance'],
        }
    else:
        # Unresolved 用神: omit chart-level fields. Validator + UI will gracefully
        # render only auspiciousHours + wealthDirection (wealthDirection has its
        # own fallback in _compute_static_folk_content).
        out['luckyColor'] = None
        out['luckyNumber'] = None
        out['luckyFoodFavor'] = None
        out['luckyFoodAvoid'] = None

    return out
