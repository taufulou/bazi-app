"""
調候 (Climatic Regulation) Advisory — Fix 2

Emits structured advisory about 調候神 presence/status per 《窮通寶鑑》.
This is an ADVISORY layer only. It does NOT override the 扶抑/病藥-derived
用神 from `determine_favorable_gods()` in `five_elements.py` — the two
methodologies (扶抑 vs 調候) are distinct classical traditions that can
legitimately disagree. The AI narration layer decides how to weave them.

Engine emits only structured keys (status, primary_god, seasonalContext,
classicalPhraseKey, etc.). Chinese narrative rendering lives in
`apps/api/src/ai/prompts.ts::buildTiaohouSection` keyed on the typed
`TiaohouClassicalPhraseKey` union in `packages/shared/src/types/bazi.ts`.

從格 guard: 從格 charts skip 調候 (they follow 順勢, 調候 不適用).

Classical source: 《窮通寶鑑》 chapter-by-chapter 調候用神 tables, verified
against 甲木篇 丑月條 as anchor ("十二月甲木，天寒氣凍，木性極寒，先用庚
噼甲，方引丁火").
"""

from typing import Dict, List, Optional, Tuple

from .constants import HIDDEN_STEMS, STEM_ELEMENT
from .stem_combinations import STEM_CLASH_LOOKUP, STEM_COMBINATION_LOOKUP
from .ten_gods import compute_stem_pressure_weight


# ============================================================
# TIAOHOU table (10 DMs × 12 months)
# ============================================================
# Primary 調候神 per 《窮通寶鑑》 (main stem).
# Secondary 調候神 stored separately where mainstream 子平 practice provides one.

TIAOHOU_TABLE: Dict[Tuple[str, str], str] = {
    # 甲木
    ('甲', '寅'): '丙', ('甲', '卯'): '庚', ('甲', '辰'): '庚',
    ('甲', '巳'): '癸', ('甲', '午'): '癸', ('甲', '未'): '癸',
    ('甲', '申'): '庚', ('甲', '酉'): '庚', ('甲', '戌'): '庚',
    ('甲', '亥'): '庚', ('甲', '子'): '丁', ('甲', '丑'): '丁',
    # 乙木
    ('乙', '寅'): '丙', ('乙', '卯'): '丙', ('乙', '辰'): '癸',
    ('乙', '巳'): '癸', ('乙', '午'): '癸', ('乙', '未'): '癸',
    ('乙', '申'): '丙', ('乙', '酉'): '癸', ('乙', '戌'): '癸',
    ('乙', '亥'): '丙', ('乙', '子'): '丙', ('乙', '丑'): '丙',
    # 丙火
    ('丙', '寅'): '壬', ('丙', '卯'): '壬', ('丙', '辰'): '壬',
    ('丙', '巳'): '壬', ('丙', '午'): '壬', ('丙', '未'): '壬',
    ('丙', '申'): '壬', ('丙', '酉'): '壬', ('丙', '戌'): '甲',
    ('丙', '亥'): '甲', ('丙', '子'): '壬', ('丙', '丑'): '壬',
    # 丁火
    ('丁', '寅'): '甲', ('丁', '卯'): '庚', ('丁', '辰'): '甲',
    ('丁', '巳'): '甲', ('丁', '午'): '壬', ('丁', '未'): '甲',
    ('丁', '申'): '甲', ('丁', '酉'): '甲', ('丁', '戌'): '甲',
    ('丁', '亥'): '甲', ('丁', '子'): '甲', ('丁', '丑'): '甲',
    # 戊土
    ('戊', '寅'): '丙', ('戊', '卯'): '丙', ('戊', '辰'): '甲',
    ('戊', '巳'): '甲', ('戊', '午'): '壬', ('戊', '未'): '癸',
    ('戊', '申'): '丙', ('戊', '酉'): '丙', ('戊', '戌'): '甲',
    ('戊', '亥'): '甲', ('戊', '子'): '丙', ('戊', '丑'): '丙',
    # 己土
    ('己', '寅'): '丙', ('己', '卯'): '甲', ('己', '辰'): '丙',
    ('己', '巳'): '癸', ('己', '午'): '癸', ('己', '未'): '癸',
    ('己', '申'): '丙', ('己', '酉'): '丙', ('己', '戌'): '甲',
    ('己', '亥'): '丙', ('己', '子'): '丙', ('己', '丑'): '丙',
    # 庚金
    ('庚', '寅'): '戊', ('庚', '卯'): '丁', ('庚', '辰'): '甲',
    ('庚', '巳'): '壬', ('庚', '午'): '壬', ('庚', '未'): '丁',
    ('庚', '申'): '丁', ('庚', '酉'): '丁', ('庚', '戌'): '甲',
    ('庚', '亥'): '丁', ('庚', '子'): '丁', ('庚', '丑'): '丙',
    # 辛金
    ('辛', '寅'): '己', ('辛', '卯'): '壬', ('辛', '辰'): '壬',
    ('辛', '巳'): '壬', ('辛', '午'): '壬', ('辛', '未'): '壬',
    ('辛', '申'): '壬', ('辛', '酉'): '壬', ('辛', '戌'): '壬',
    ('辛', '亥'): '壬', ('辛', '子'): '丙', ('辛', '丑'): '丙',
    # 壬水
    ('壬', '寅'): '庚', ('壬', '卯'): '戊', ('壬', '辰'): '甲',
    ('壬', '巳'): '壬', ('壬', '午'): '癸', ('壬', '未'): '辛',
    ('壬', '申'): '戊', ('壬', '酉'): '甲', ('壬', '戌'): '甲',
    ('壬', '亥'): '戊', ('壬', '子'): '戊', ('壬', '丑'): '丙',
    # 癸水
    ('癸', '寅'): '辛', ('癸', '卯'): '庚', ('癸', '辰'): '丙',
    ('癸', '巳'): '辛', ('癸', '午'): '庚', ('癸', '未'): '庚',
    ('癸', '申'): '丁', ('癸', '酉'): '辛', ('癸', '戌'): '辛',
    ('癸', '亥'): '庚', ('癸', '子'): '丙', ('癸', '丑'): '丙',
}

# Secondary 調候神 (commonly cited in 《窮通寶鑑》 as 佐神 or 次用).
# Only populated where mainstream 子平 practice offers a clear secondary.
# NOTE: kept minimal (v1). Phase 13 may widen to List[str] if needed.
TIAOHOU_SECONDARY: Dict[Tuple[str, str], Optional[str]] = {
    ('甲', '子'): '丙',  # 寒木需丁劈甲引丙
    ('甲', '丑'): '丙',  # 同上
    ('乙', '子'): '丁',  # 陰木向陽, 丁為次助
    ('乙', '丑'): '丁',
    ('丙', '戌'): '壬',  # 丙火戌月需甲印引火, 壬次佐
    ('丙', '亥'): '壬',
    ('丁', '午'): '甲',  # 丁夏需壬潤, 甲為次
    ('庚', '丑'): '丁',  # 庚寒需丙暖, 丁次
    # All other entries default to None (no secondary).
}


# ============================================================
# Seasonal context mapping
# ============================================================

# 冬月 (寒): 亥子丑. 夏月 (炎): 巳午未. Others: transitional.
_COLD_BRANCHES = {'亥', '子', '丑'}
_HOT_BRANCHES = {'巳', '午', '未'}


def _seasonal_context(month_branch: str) -> str:
    if month_branch in _COLD_BRANCHES:
        return 'cold_winter'
    if month_branch in _HOT_BRANCHES:
        return 'hot_summer'
    return 'transitional'


# ============================================================
# classical_phrase_key derivation
# ============================================================
# Typed Literal union on TS side — keys here must stay in sync with
# `TiaohouClassicalPhraseKey` in packages/shared/src/types/bazi.ts.

_ELEMENT_ZH_TO_EN = {
    '木': 'wood', '火': 'fire', '土': 'earth', '金': 'metal', '水': 'water',
}
_ELEMENT_NEEDS_ZH_TO_EN = {
    '木': 'wood', '火': 'fire', '土': 'earth', '金': 'metal', '水': 'water',
}


def _classical_phrase_key(dm_element: str, seasonal_context: str,
                          tiaohou_element: str) -> Optional[str]:
    """
    Derive the typed classical_phrase_key for prompt-layer rendering.

    Keys follow pattern: <hot|cold>_<dm_element>_needs_<tiaohou_element>.
    Returns None for transitional seasons (no canonical couplet applies).
    """
    if seasonal_context == 'transitional':
        return None
    hot_or_cold = 'cold' if seasonal_context == 'cold_winter' else 'hot'
    dm_en = _ELEMENT_ZH_TO_EN.get(dm_element)
    th_en = _ELEMENT_NEEDS_ZH_TO_EN.get(tiaohou_element)
    if not dm_en or not th_en:
        return None
    return f'{hot_or_cold}_{dm_en}_needs_{th_en}'


# ============================================================
# Status classification
# ============================================================

def classify_tiaohou_status(
    pillars: Dict,
    tiaohou_god: str,
    month_branch: str,
) -> Tuple[str, Optional[str]]:
    """
    Classify presence/status of the 調候神 stem in the chart.

    Returns (status, combined_by):
      - 'present_strong': transparent WITH strong root (本氣/中氣), OR is
                          the 本氣 of month branch itself.
      - 'present_weak':   transparent but rootless/weak-root, OR only in
                          hidden 餘氣 / 中氣 outside month branch.
      - 'combined':       transparent AND forms 五合 with another stem in
                          the chart (調候神 被合絆).
      - 'clashed':        transparent AND is 沖 by another stem in chart.
      - 'absent':         not present anywhere in natal chart.

    combined_by: the partner stem if status == 'combined', else None.
    """
    pressure = compute_stem_pressure_weight(tiaohou_god, pillars)
    transparent = pressure['transparent_count'] > 0

    # Absent: no 透干 AND no 藏干 anywhere
    if pressure['total'] == 0:
        return 'absent', None

    # 合 check: only applies when 調候神 is transparent AND a partner exists
    # on some other stem.
    if transparent:
        partner = STEM_COMBINATION_LOOKUP.get(tiaohou_god)
        if partner:
            partner_stem, _, _ = partner
            partner_pressure = compute_stem_pressure_weight(partner_stem, pillars)
            if partner_pressure['transparent_count'] > 0:
                return 'combined', partner_stem

        # 沖 check
        clash_partner = STEM_CLASH_LOOKUP.get(tiaohou_god)
        if clash_partner:
            clash_pressure = compute_stem_pressure_weight(clash_partner, pillars)
            if clash_pressure['transparent_count'] > 0:
                return 'clashed', clash_partner

    # Presence strength assessment.
    # Strong if: transparent with strong root, OR 調候神 is 本氣 of month branch.
    month_hidden = HIDDEN_STEMS.get(month_branch, [])
    month_benqi = month_hidden[0] if month_hidden else ''
    if transparent and pressure['has_strong_root']:
        return 'present_strong', None
    if month_benqi == tiaohou_god:
        return 'present_strong', None
    # Weak presence otherwise.
    return 'present_weak', None


# ============================================================
# Main advisory entry
# ============================================================

def compute_tiaohou_advisory(
    pillars: Dict,
    dm_stem: str,
    month_branch: str,
    is_cong_ge: bool = False,
) -> Optional[Dict]:
    """
    Build the structured 調候 advisory for this chart.

    Returns:
        None if:
          - chart is 從格 (順勢 dominates, 調候 不適用)
          - TIAOHOU_TABLE has no entry (defensive)
        Otherwise a Dict with:
          {
              'primaryGod':          '丁',
              'secondaryGod':        '丙' | None,
              'status':              'absent'|'present_weak'|'present_strong'|
                                     'combined'|'clashed',
              'combinedBy':          str | None,   # partner stem when combined
              'clashedBy':           str | None,   # partner stem when clashed
              'seasonalContext':     'cold_winter'|'hot_summer'|'transitional',
              'classicalPhraseKey':  'cold_wood_needs_fire' | ... | None,
          }
    """
    if is_cong_ge:
        return None

    primary = TIAOHOU_TABLE.get((dm_stem, month_branch))
    if primary is None:
        return None
    secondary = TIAOHOU_SECONDARY.get((dm_stem, month_branch))

    status, partner = classify_tiaohou_status(pillars, primary, month_branch)
    seasonal = _seasonal_context(month_branch)
    dm_element = STEM_ELEMENT.get(dm_stem, '')
    primary_element = STEM_ELEMENT.get(primary, '')
    phrase_key = _classical_phrase_key(dm_element, seasonal, primary_element)

    return {
        'primaryGod': primary,
        'secondaryGod': secondary,
        'status': status,
        'combinedBy': partner if status == 'combined' else None,
        'clashedBy': partner if status == 'clashed' else None,
        'seasonalContext': seasonal,
        'classicalPhraseKey': phrase_key,
    }
