"""
Daily Fortune Pre-Analysis Module (八字日運)

All deterministic daily fortune calculations. No AI involved. Provides
structured anchors for the AI narration layer.

Key principle from research (`.claude/plans/ok-next-big-feature-merry-cake-agent-aea39761500551e82.md`):

  「流日的影响主要是瞬间的，通常认为其影响力微不足道」  — 算准网

Daily 干支 force is too weak to ACT on its own — it only TRIGGERS events
already loaded by 命局/大運/流年/流月. So:
- Engine emits `metaFraming='soft_trigger'` on every output
- The AI prompt's anti-hallucination clause keys off this flag to FORBID
  absolute language (一定/必然/必/絕對/百分百)
- UI copy + AI narrative MUST frame daily as "today inclines towards…"
  not "today will…"

Architecture: 80%+ doctrine reuse from `annual_enhanced._compute_single_month`.
The Phase 12b/12c Fix A-F machinery (蓋頭/截腳, 伏吟, 殺印, 沖庫, 六害,
六合) applies at day scope unchanged — daily is just a smaller time slice
of monthly. We wrap the day's stem-branch in a month_data shape and
delegate to `_compute_single_month`, then layer day-specific 5-dimension
dispatch + folk content on top.

DO NOT add daily-specific 用神 reassignment. 用神 is chart-level only
(per Phase 12 doctrine).
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import cnlunar

from .annual_enhanced import (
    ELEMENT_ORGAN_MAP,
    FAVORABLE_ROLES,
    SPOUSE_STAR_FEMALE,
    SPOUSE_STAR_MALE,
    UNFAVORABLE_ROLES,
    _check_branch_interaction,
    _compute_single_month,
    _get_element_role,
    _normalize_effective_gods_for_annual,
)
from .branch_relationships import banhe_forms_qi, check_branch_friction
from .constants import (
    BRANCH_ELEMENT,
    HIDDEN_STEMS,
    HONGLUAN,
    STEM_ELEMENT,
    TAOHUA,
    TIANXI,
    YIMA,
)
from .fortune_constants import (
    FORTUNE_DAILY_PRE_ANALYSIS_VERSION,
    META_FRAMING_SOFT_TRIGGER,
    derive_dimension_label,
    derive_energy_score,
)
from .label_subordination import apply_subordination_cap
from .folk_content import compute_folk_content
from .lifetime_enhanced import ELEMENT_DIRECTION
from .ten_gods import derive_ten_god


# ============================================================
# Day pillar lookup
# ============================================================

def get_day_pillar(target_date: date) -> Tuple[str, str]:
    """Return the day's (stem, branch) for an arbitrary calendar date.

    Uses cnlunar with NOON as the time-of-day. Noon sidesteps the 23:00
    子時 boundary ambiguity — if a caller wants the Bazi-day stem-branch
    for a given calendar date, noon is unambiguously inside that calendar
    day's Bazi-day.

    Callers wanting the «current Bazi day» at e.g. 23:30 local time should
    add 1 day BEFORE calling — that boundary lives in the API layer, not
    here. See `resolve_bazi_today_from_clock_time` below.
    """
    dt = datetime(target_date.year, target_date.month, target_date.day, 12, 0, 0)
    lunar = cnlunar.Lunar(dt, godType='8char')
    day_gz = lunar.day8Char
    return day_gz[0], day_gz[1]


def get_flow_month_pillar(target_date: date) -> Tuple[str, str]:
    """Return the FLOW MONTH's (stem, branch) for a calendar date.

    Uses cnlunar.month8Char which correctly applies 節氣 (solar term)
    boundaries. Different from get_day_pillar which returns the day pillar.

    Phase 1 Fortune Option 2.5: the flow-month pillar drives the
    subordination cap on the daily verdict. Per 「提綱」 doctrine, a daily
    cannot fully escape the month's broader trend — but it CAN vary
    within the month's allowed range.
    """
    dt = datetime(target_date.year, target_date.month, target_date.day, 12, 0, 0)
    lunar = cnlunar.Lunar(dt, godType='8char')
    month_gz = lunar.month8Char
    return month_gz[0], month_gz[1]


def resolve_bazi_today_from_clock_time(local_dt: datetime) -> date:
    """Resolve which Bazi day the given local clock time falls into.

    Bazi day flips at 23:00 (子時 start), not midnight. If clock time is
    23:00-23:59, the Bazi day is TOMORROW's calendar date. Otherwise it
    matches the calendar date.
    """
    if local_dt.hour >= 23:
        return (local_dt + timedelta(days=1)).date()
    return local_dt.date()


# ============================================================
# Daily neutral signals
# ============================================================

# 沖日支 universal rule: 三命通會「沖日支主動，動則不安」
# Applied uniformly across travel/career/health caution; romance gets
# the «動 — change» reading separately. Soft-trigger language.
_CHONG_DAY_BRANCH_PENALTY = -15

# 合日支 universal rule: 三命通會「合日支主合」
_HE_DAY_BRANCH_BOOST = 10

# Spouse-star transparent today (gender-dispatched). Phase 12g valence-
# aware: 正官/正財 is preferred, 偏官/偏財 is 偏緣
_SPOUSE_STAR_BOOST_PRIMARY = 12   # 正財/正官
_SPOUSE_STAR_BOOST_SECONDARY = 8  # 偏財/七殺

# 神煞 day triggers (mostly romance-positive). Soft triggers, not verdicts.
_TAOHUA_TRIGGER_BOOST = 8
_HONGLUAN_TRIGGER_BOOST = 6
_TIANXI_TRIGGER_BOOST = 6

# 驛馬 day triggers (travel-positive when 沖 the natal 驛馬 partner)
_YIMA_TRIGGER_BOOST = 10

# 用神 element resonating today (overall + element-aligned dimensions)
_USEFUL_GOD_RESONANCE = 10

# Base for dimension scores. Aggregates clamp to [0, 100].
_DIMENSION_BASE = 50


# ============================================================
# 5-dimension dispatch
# ============================================================

def _dispatch_romance(
    *,
    day_stem: str,
    day_branch: str,
    day_ten_god: str,
    pillars: Dict,
    day_master_stem: str,
    gender: str,
    effective_gods: Dict,
    branch_interactions_on_day_palace: List[str],
) -> Dict[str, Any]:
    """Compute the day's romance-dimension signals.

    Doctrine sources:
    - 滴天髓·夫妻論: 「沖配偶宮主動」 (day branch sympathy with natal 日支)
    - Phase 12g.6: 桃花/紅鸞/天喜 trigger + valence-aware 配偶星
    """
    signals: List[Dict[str, Any]] = []
    score = _DIMENSION_BASE

    natal_day_branch = pillars['day']['branch']

    # --- 配偶星 透干 today (gender-dispatched) ---
    spouse_stars = SPOUSE_STAR_MALE if gender.upper() in ('MALE', '男') else SPOUSE_STAR_FEMALE
    if day_ten_god in spouse_stars:
        is_primary = (
            (gender.upper() in ('MALE', '男') and day_ten_god == '正財')
            or (gender.upper() in ('FEMALE', '女') and day_ten_god == '正官')
        )
        boost = _SPOUSE_STAR_BOOST_PRIMARY if is_primary else _SPOUSE_STAR_BOOST_SECONDARY
        score += boost
        signals.append({
            'type': 'spouse_star_transparent',
            'tenGod': day_ten_god,
            'isPrimary': is_primary,
            'narrative': f'今日{day_ten_god}星透干，感情訊息較顯',
        })

    # --- 桃花/紅鸞/天喜 triggered on day branch ---
    taohua_branch = TAOHUA.get(natal_day_branch)
    if taohua_branch and day_branch == taohua_branch:
        score += _TAOHUA_TRIGGER_BOOST
        signals.append({
            'type': 'taohua_triggered',
            'branch': day_branch,
            'narrative': '日逢桃花，今日易於社交與情感連結',
        })

    natal_year_branch = pillars['year']['branch']
    honluan_branch = HONGLUAN.get(natal_year_branch)
    if honluan_branch and day_branch == honluan_branch:
        score += _HONGLUAN_TRIGGER_BOOST
        signals.append({
            'type': 'honluan_triggered',
            'branch': day_branch,
            'narrative': '日逢紅鸞，今日宜以喜事或社交為主',
        })
    tianxi_branch = TIANXI.get(natal_year_branch)
    if tianxi_branch and day_branch == tianxi_branch:
        score += _TIANXI_TRIGGER_BOOST
        signals.append({
            'type': 'tianxi_triggered',
            'branch': day_branch,
            'narrative': '日逢天喜，今日適合分享好消息',
        })

    # --- 配偶宮 interactions (using day's branch) ---
    if '六合' in branch_interactions_on_day_palace:
        score += _HE_DAY_BRANCH_BOOST
        signals.append({
            'type': 'spouse_palace_he',
            'narrative': '日支逢合，感情層面今日易感和諧穩定',
        })
    if '六沖' in branch_interactions_on_day_palace:
        # 沖配偶宮 = 動 (movement/change). Valence is ambiguous — for romance,
        # framed as «波動/變化», not catastrophe.
        score -= 10
        signals.append({
            'type': 'spouse_palace_chong',
            'narrative': '日支逢沖，今日感情層面有「動」之象，宜以對話化解張力',
        })

    # --- Branch friction (六害/半刑/破) on the natal 日支 today ---
    friction = check_branch_friction(natal_day_branch, day_branch)
    if friction and friction.get('type') in {'six_harm', 'half_punishment', 'zi_mao_punishment'}:
        score -= 8
        signals.append({
            'type': f'spouse_palace_{friction["type"]}',
            'narrative': friction.get('description', '配偶宮今日略有摩擦'),
        })

    score = max(0, min(100, score))
    return {
        'score': score,
        'label': derive_dimension_label(score),
        'signals': signals,
    }


def _dispatch_career(
    *,
    day_stem: str,
    day_branch: str,
    day_ten_god: str,
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict,
    branch_interactions_on_day_palace: List[str],
    branch_interactions_on_month_palace: List[str],
) -> Dict[str, Any]:
    """Compute the day's career-dimension signals.

    Doctrine sources:
    - 子平真詮·論官 + 盲派秘典 ten-god 意象
    - Phase 12g/12h.B Item 2: 傷官見官 favorability dispatch — when 正官
      is 忌神/仇神, 傷官 制官 reverses to BENEFICIAL per 三命通會 「如官為忌，
      傷官見官反以吉論」. Surfaces as `valence` field on the signal.

    月柱 = 事業宮 so day's branch interaction with month-pillar branch is
    the primary signal.
    """
    signals: List[Dict[str, Any]] = []
    score = _DIMENSION_BASE

    # --- Day's 十神 → career theme ---
    if day_ten_god in ('正官', '七殺'):
        # Valence depends on natal favorability of 官殺
        role = effective_gods.get(day_ten_god, '閒神')
        signals.append({
            'type': 'guan_sha_day',
            'tenGod': day_ten_god,
            'role': role,
            'narrative': f'今日{day_ten_god}星臨日，職場壓力或考核訊息較顯',
        })
        if role in FAVORABLE_ROLES:
            score += 8
            signals.append({
                'type': 'guan_sha_favorable',
                'valence': 'beneficial',
                'narrative': '官殺為命中喜用，今日宜把握表現與彙報機會',
            })
        elif role in UNFAVORABLE_ROLES:
            score -= 10
            signals.append({
                'type': 'guan_sha_unfavorable',
                'valence': 'harmful',
                'narrative': '官殺為命中忌仇，今日宜謙退、避免硬碰權威',
            })
    elif day_ten_god in ('食神', '傷官'):
        # Phase 12h.B Item 2 — 傷官見官 valence-aware dispatch at day scope.
        # When the day's 傷官 transits AND 正官 is in chart, surface the
        # transient activation. Day-level valence follows chart-level 正官 role:
        #   正官 = 用神/喜神 → 傷官見官 is HARMFUL (傷官 damages 用神 官)
        #   正官 = 忌神/仇神 → 傷官見官 is BENEFICIAL (傷官 制忌神 官)
        #   正官 = 閒神    → neutral (no doctrinal lift)
        #
        # Note: 食神 ≠ 傷官 doctrinally — 食神 generally drains DM cleanly
        # (洩秀), 傷官 attacks 正官. We dispatch only for 傷官; 食神 day
        # carries the soft baseline narrative.
        if day_ten_god == '傷官':
            guan_role = effective_gods.get('正官', '閒神')
            signals.append({
                'type': 'shi_shang_day',
                'tenGod': day_ten_god,
                'role': effective_gods.get(day_ten_god, '閒神'),
                'narrative': '今日傷官星臨日，宜以表達、創意、教學為主',
            })
            if guan_role in FAVORABLE_ROLES:
                score -= 8
                signals.append({
                    'type': 'shangguan_jian_guan_transient',
                    'valence': 'harmful',
                    'officerRole': guan_role,
                    'narrative': '正官為命中喜用，今日傷官透日略損官星，宜避鋒芒、不挑戰權威',
                })
            elif guan_role in UNFAVORABLE_ROLES:
                # Phase 12g/12h.B Item 2: 傷官制忌神官 反為吉
                score += 6
                signals.append({
                    'type': 'shangguan_jian_guan_transient',
                    'valence': 'beneficial',
                    'officerRole': guan_role,
                    'narrative': '正官在您命中為忌仇，傷官透日反為調節壓力，並非為禍',
                })
        else:  # 食神
            signals.append({
                'type': 'shi_shang_day',
                'tenGod': day_ten_god,
                'role': effective_gods.get(day_ten_god, '閒神'),
                'narrative': '今日食神星臨日，宜以表達、創意、教學為主',
            })
    elif day_ten_god in ('正印', '偏印'):
        signals.append({
            'type': 'yin_day',
            'tenGod': day_ten_god,
            'role': effective_gods.get(day_ten_god, '閒神'),
            'narrative': f'今日{day_ten_god}星臨日，宜學習、研究、與長輩請益',
        })

    # --- 沖月柱 = career 動 ---
    if '六沖' in branch_interactions_on_month_palace:
        score -= 12
        signals.append({
            'type': 'career_palace_chong',
            'narrative': '事業宮逢沖，今日易有計畫變動或人事消息',
        })
    if '六合' in branch_interactions_on_month_palace:
        score += 6
        signals.append({
            'type': 'career_palace_he',
            'narrative': '事業宮逢合，今日適合協調、合作、簽議',
        })

    # --- 沖日支 (cross-cutting caution) ---
    if '六沖' in branch_interactions_on_day_palace:
        score -= 8
        signals.append({
            'type': 'chong_day_branch_career',
            'narrative': '今日不利重大簽約與承諾，宜延後處理',
        })

    score = max(0, min(100, score))
    return {
        'score': score,
        'label': derive_dimension_label(score),
        'signals': signals,
    }


def _dispatch_finance(
    *,
    day_stem: str,
    day_branch: str,
    day_ten_god: str,
    day_master_stem: str,
    effective_gods: Dict,
    strength: str,
    gender: str,
    monthly_result: Dict[str, Any],
) -> Dict[str, Any]:
    """Compute the day's finance-dimension signals.

    Doctrine sources:
    - 子平真詮·論墓庫 (Phase 12c Fix F: 沖庫釋放方向性) — already in
      `_compute_single_month` output via `chongKuRelease`. We surface it
      verbatim; do NOT re-detect at day scope.
    - Phase 12h.B Item 8: 比劫奪財 3-state valence dispatch
      (love_enhanced.py:845-957 is the canonical impl). At day scope we
      apply a SIMPLIFIED version: DM-weak suppression + 財 role + gender
      narrative. No transient_activations array — that's chart-level.

    Phase 12h.B Item 8 day-scope dispatch:
    - DM weak (very_weak/weak):     valence='not_applicable' (比劫 IS 用神 — 扶身 reverses to mild positive)
    - DM strong/neutral + 財 用/喜:   valence='harmful'        (比劫奪用財)
    - DM strong/neutral + 財 忌/仇:   valence='beneficial'     (比劫制忌神 — 反為調節)
    - DM strong/neutral + 財 閒:     valence='neutral'
    Gender suffix: 男命 includes 妻緣 frame; 女命 NOT 損夫 (per Phase 12h.B
    Item 8 doctrine — 「比劫奪財損夫」是民俗誤解).
    """
    signals: List[Dict[str, Any]] = []
    score = _DIMENSION_BASE

    # --- Day's 十神 = 財星 ---
    if day_ten_god in ('正財', '偏財'):
        role = effective_gods.get(day_ten_god, '閒神')
        if role in FAVORABLE_ROLES:
            score += 12
            signals.append({
                'type': 'wealth_star_favorable',
                'tenGod': day_ten_god,
                'role': role,
                'valence': 'beneficial',
                'narrative': f'今日{day_ten_god}星透干且為命中喜用，財訊較顯，宜把握',
            })
        elif role in UNFAVORABLE_ROLES:
            score -= 8
            signals.append({
                'type': 'wealth_star_unfavorable',
                'tenGod': day_ten_god,
                'role': role,
                'valence': 'harmful',
                'narrative': f'今日{day_ten_god}星透干，但命中忌財，宜守不宜攻',
            })
        else:
            score += 4
            signals.append({
                'type': 'wealth_star_idle',
                'tenGod': day_ten_god,
                'role': role,
                'valence': 'neutral',
                'narrative': f'今日{day_ten_god}星透干，財訊溫和，例行進帳訊息',
            })
    elif day_ten_god in ('比肩', '劫財'):
        # Phase 12h.B Item 8 — 3-state valence dispatch (day-scope simplified)
        is_male = gender.upper() in ('MALE', '男')
        # Probe both 正財 + 偏財 for natal favorability (either role qualifies)
        cai_roles = (
            effective_gods.get('正財', '閒神'),
            effective_gods.get('偏財', '閒神'),
        )
        cai_has_fav = any(r in FAVORABLE_ROLES for r in cai_roles)
        cai_has_unfav = any(r in UNFAVORABLE_ROLES for r in cai_roles)

        if strength in ('weak', 'very_weak'):
            # DM weak — 比劫 IS 用神/喜神 (扶身). Suppress 「奪財」 frame entirely.
            score += 4
            signals.append({
                'type': 'bi_jie_day',
                'tenGod': day_ten_god,
                'valence': 'not_applicable',
                'gender': 'male' if is_male else 'female',
                'narrative': '今日比劫扶身，與同儕互助有助於穩定能量',
            })
        elif cai_has_fav:
            # 財 是 用/喜神 — 比劫奪財 為 HARMFUL
            score -= 10
            narrative = (
                '今日比劫臨日，財星受擾'
                + ('，亦留意夫妻財務溝通' if is_male else '，宜留意姊妹/同事間財務分擔')
                + '，宜守不宜攻'
            )
            signals.append({
                'type': 'bi_jie_duo_cai_transient',
                'tenGod': day_ten_god,
                'valence': 'harmful',
                'wealthRoles': list(cai_roles),
                'gender': 'male' if is_male else 'female',
                'narrative': narrative,
            })
        elif cai_has_unfav:
            # 財 是 忌/仇神 — 比劫制忌 反為調節 (Phase 12h.B beneficial flip)
            score += 4
            signals.append({
                'type': 'bi_jie_duo_cai_transient',
                'tenGod': day_ten_god,
                'valence': 'beneficial',
                'wealthRoles': list(cai_roles),
                'gender': 'male' if is_male else 'female',
                'narrative': '今日比劫臨日，財為命中忌仇，比劫制財反為調節，並非為禍',
            })
        else:
            # 財 閒 — 比劫 mild caution only
            score -= 2
            signals.append({
                'type': 'bi_jie_day',
                'tenGod': day_ten_god,
                'valence': 'neutral',
                'gender': 'male' if is_male else 'female',
                'narrative': '今日比劫臨日，影響溫和，例行支出或分享開銷',
            })

    # --- 沖庫 (reuse monthly engine output verbatim — same doctrine applies) ---
    chong_ku = monthly_result.get('chongKuRelease')
    if chong_ku and chong_ku.get('action') == 'downgrade':
        score -= 10
        signals.append({
            'type': 'chong_ku_release',
            'pillar': chong_ku.get('natalPillar'),
            'narrative': '今日觸發財庫沖開訊息，宜留意資產進出時機',
        })

    score = max(0, min(100, score))
    return {
        'score': score,
        'label': derive_dimension_label(score),
        'signals': signals,
    }


def _dispatch_travel(
    *,
    day_branch: str,
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict,
    branch_interactions_on_day_palace: List[str],
) -> Dict[str, Any]:
    """Compute the day's travel-dimension signals.

    Doctrine: 三命通會·驛馬 + universal app rule: 「沖日支不利遠行」.
    """
    signals: List[Dict[str, Any]] = []
    score = _DIMENSION_BASE

    natal_day_branch = pillars['day']['branch']
    yima_partner = YIMA.get(natal_day_branch)

    # --- 驛馬 today (sympathy with natal 日支's 驛馬) ---
    if yima_partner == day_branch:
        score += _YIMA_TRIGGER_BOOST
        signals.append({
            'type': 'yima_aligned',
            'branch': day_branch,
            'narrative': '今日逢驛馬，遠行或變動訊息較順',
        })

    # --- 沖日支 → universal travel caution ---
    if '六沖' in branch_interactions_on_day_palace:
        score -= 18
        signals.append({
            'type': 'chong_day_branch_travel',
            'narrative': '今日日支逢沖，不宜長途、簽訂遠端事項，宜先求穩',
        })

    # 六合 → coordination okay
    if '六合' in branch_interactions_on_day_palace:
        score += 4
        signals.append({
            'type': 'he_day_branch_travel',
            'narrative': '今日日支逢合，短程協調順遂',
        })

    score = max(0, min(100, score))
    return {
        'score': score,
        'label': derive_dimension_label(score),
        'signals': signals,
    }


def _dispatch_health(
    *,
    day_stem: str,
    day_branch: str,
    day_master_stem: str,
    effective_gods: Dict,
    branch_interactions_on_day_palace: List[str],
    branch_interactions_on_year_palace: List[str],
) -> Dict[str, Any]:
    """Compute the day's health-dimension signals.

    Doctrine note: 五行→臟腑 mapping is 中醫 doctrine, not 子平 doctrine.
    Outputs are labelled as 養生提示 (wellness suggestion), not Bazi verdict.
    The AI prompt MUST surface them with «建議/可考慮» framing, never «必»/
    «一定».
    """
    signals: List[Dict[str, Any]] = []
    score = _DIMENSION_BASE

    day_branch_element = BRANCH_ELEMENT.get(day_branch, '')
    day_stem_element = STEM_ELEMENT.get(day_stem, '')

    # Element overload onto a 忌神 → organ caution (養生 only, NOT verdict)
    for element in {day_branch_element, day_stem_element}:
        if not element:
            continue
        role = _get_element_role(element, day_master_stem, effective_gods)
        if role in UNFAVORABLE_ROLES:
            organ_info = ELEMENT_ORGAN_MAP.get(element, {})
            if organ_info:
                score -= 5
                signals.append({
                    'type': 'unfavorable_element_overload',
                    'element': element,
                    'role': role,
                    'organSystem': organ_info.get('system', ''),
                    'narrative': f'今日{element}({role})氣偏旺，宜留意{organ_info.get("system", "")}保養',
                    'provenance': 'tcm_wellness',  # 中醫養生, NOT Bazi
                })

    # 沖年柱 — 三命通會 long-elder pillar; valence is general caution
    if '六沖' in branch_interactions_on_year_palace:
        score -= 4
        signals.append({
            'type': 'chong_year_branch_health',
            'narrative': '今日逢沖年支，宜關心長輩近況、注意自身體質訊號',
        })

    # 沖日支 — 動 (rest)
    if '六沖' in branch_interactions_on_day_palace:
        score -= 4
        signals.append({
            'type': 'chong_day_branch_health',
            'narrative': '今日日支逢沖，宜降低運動強度、留意休息',
        })

    score = max(0, min(100, score))
    return {
        'score': score,
        'label': derive_dimension_label(score),
        'signals': signals,
    }


# ============================================================
# Folk content (Phase 1 — reuse existing classical helpers only)
# ============================================================

def _compute_static_folk_content(
    *,
    useful_god_element: str,
    day_branch: str,
) -> Dict[str, Any]:
    """Compute folk content for one day.

    Phase 1.5.z — extends Phase 1's wealthDirection with 4 new fields
    (luckyColor/luckyNumber/luckyFoodFavor/luckyFoodAvoid chart-level
    invariant + auspiciousHours per-day). All chart-level fields key on
    用神 element (mirrors wealthDirection precedent). 黃道吉時 algorithm
    keys on day_branch ONLY (per 協紀辨方書 卷十 «日上起時神煞» — NOT
    confused with month-branch-keyed 建除十二神).

    NOTE (audit follow-up 2026-05-22): removed unused `day_master_stem`
    + `effective_gods` parameters per engine line-audit cleanup. Folk
    content is purely 用神-keyed; DM stem would have been a DM-drift
    risk vector. If you need DM in scope, derive at the caller, not here.

    Research artifacts + classical citations:
        /Users/roger/.claude/plans/fortune-folk-content-research-results.md
    """
    direction = ELEMENT_DIRECTION.get(useful_god_element, '')
    folk = compute_folk_content(
        useful_god_element=useful_god_element,
        day_branch=day_branch,
    )
    return {
        'wealthDirection': {
            'element': useful_god_element,
            'direction': direction,
            'provenance': 'classical',
            'note': '用神方位（命格層級，每日不變）',
        },
        'luckyColor': folk['luckyColor'],
        'luckyNumber': folk['luckyNumber'],
        'luckyFoodFavor': folk['luckyFoodFavor'],
        'luckyFoodAvoid': folk['luckyFoodAvoid'],
        'auspiciousHours': folk['auspiciousHours'],
    }


# ============================================================
# Phase 1 Option 2.5 — Per-day signal softening layer
# ============================================================
#
# Adjusts the day's raw verdict (from `_compute_single_month`'s
# bareMonthAuspiciousness) based on per-day signals NOT captured by the
# monthly-level structural analysis. Examples: 紅鸞/天喜 (chart-year-based
# shensha), 比劫奪財 beneficial valence (Phase 12h.B Item 8).
#
# Cap rules (anti-folk-tier-inflation):
# - Shensha aggregate (紅鸞 + 天喜 + 桃花) capped at ±1 step contribution
# - 比劫奪財 valence: +1 step contribution (beneficial only)
# - 配偶宮 friction (六害/半刑/破/子卯刑): -1 step
# - 沖日支 valence-dispatch when 忌/仇: -1 step
# - TOTAL net adjustment capped at ±2 steps (allow 凶→凶中有吉 transition
#   from stacked mitigations like 紅鸞 + 比劫奪財; cap prevents 凶→吉 jumps)
#
# Doctrine: 紅鸞/天喜 are NOT valence-flipped per the grader's read of
# corpus row Roger 2026-05-14 — grader explicitly counted 紅鸞 as
# mitigation despite day branch=忌神 element. (紅艷 valence-flip is a
# DIFFERENT shensha — same Chinese transliteration concern; see plan.)

# ═══════════════════════════════════════════════════════════════════════════
# ⚠️ DO NOT ENABLE THIS FLAG IN PRODUCTION WITHOUT FRESH RESEARCH ⚠️
# ═══════════════════════════════════════════════════════════════════════════
#
# Phase 1.5 Option 2.5 refinement — DEFAULT OFF (gated rollout).
# Decision date: 2026-05-25. Author of gating: Roger + 4 Bazi-master sub-agents.
#
# Per Phase A 4-parallel Bazi-master research (2026-05-25) + empirical
# verification: the 2 implemented rules (食神制殺 carve-out + xishen_zhongqi
# dissolves_taboo_stem) are DOCTRINALLY CORRECT but INSUFFICIENT to deliver
# visible label improvement under the current Phase 12 cascade. Both anchor
# rows (roger@2026-05-10 + roger@2026-05-18) start at rawStructural=大凶
# (Phase 12b 伏吟 stacking + Phase 12c 六害 firing correctly per design); the
# 3-ladder-position gap to corpus expected (凶中有吉) requires Phase 12
# cascade modification (e.g., «cap multi-pillar 伏吟 at -1 total when stem
# is 喜神») — that's BEYOND Option 2.5 scope, was SKIPPED per user direction
# (would require massive Phase 12 doctrinal re-research the user judged
# not worth the engineering cost).
#
# ─── If you are reading this because you want to flip this flag to '1' ───
#
# READ THIS FIRST. The rules are GATED for a reason:
#
#   1. They ARE doctrinally accurate (Sub-Agent C verdict, regression-free).
#      They fire correctly on the 2 anchor rows. They do NOT cause new
#      label regressions on the other 28 rows of the daily-label corpus.
#
#   2. BUT they were never tested or validated in production cascade.
#      No corpus-gate test exists that covers the flag-ON state. The
#      corpus baseline locks the flag-OFF behavior; if you flip it ON,
#      you ship behavior nothing in CI exercises.
#
#   3. Visible label improvement requires Phase 12 cascade modification
#      (Phase 12i candidate, EXPLICITLY SKIPPED per user direction). Without
#      that modification, flipping this flag changes nothing user-facing
#      on the 2 outlier rows (rules add +1 step, but the ±2 net cap can't
#      bridge the 3-ladder-position gap from 大凶 to 凶中有吉).
#
#   4. There IS a small chance of regression on OTHER charts the corpus
#      doesn't cover — Phase A research validated against the 60-row corpus
#      only. Rare 八字 configurations might trigger one of these rules
#      unexpectedly. WITHOUT the cascade fix, that's an invisible engine
#      output change with no test coverage and no doctrinal benefit.
#
# Before flipping: re-do the full 4-parallel Bazi-master research cycle
# (cost ~$30 + 0.5 day wall-clock) OR commit to the Phase 12 cascade fix
# work (multi-week doctrinal research per 邵偉華 / 任鐵樵 / 三命通會 cross-
# reference). The user explicitly judged that work «not worth it» given
# the marginal gain (2 calibration rows out of 30) — talk to them before
# re-litigating.
#
# Audit trail:
# - Phase A research: /Users/roger/.claude/plans/option-25-refinement-research-results.md
# - Sub-Agent C verdict: agent ae52cf894731c304f
# - Session handoff: /Users/roger/.claude/plans/fortune-phase-1-5-z-option-25-session-handoff.md
# - User direction (2026-05-25): «skip Phase 12i Phase 12 cascade modification»
#
# To enable for engine TESTING only (not prod):
#     PHASE_1_5_OPTION_25_REFINEMENT_ENABLED=1 python -m pytest tests/test_daily_enhanced.py
# ═══════════════════════════════════════════════════════════════════════════
PHASE_1_5_OPTION_25_REFINEMENT_ENABLED = (
    os.environ.get('PHASE_1_5_OPTION_25_REFINEMENT_ENABLED', '0') == '1'
)


# Element produces (生) relation: A produces B if A is the parent in the
# 五行相生 chain. Used by xishen_zhongqi_dissolves_taboo_stem to verify the
# 化忌神 path (day_stem element → zhongqi element).
_PRODUCES: Dict[str, str] = {
    '木': '火', '火': '土', '土': '金', '金': '水', '水': '木',
}


def _element_produces(parent: str, child: str) -> bool:
    """True if `parent` element produces `child` per 五行相生 chain."""
    return _PRODUCES.get(parent) == child


def _detect_shishen_zhisha_active(
    *,
    dm_stem: str,
    dm_element: str,
    natal_stems: List[str],
    day_stem: str,
    day_branch: str,
    pillars: Dict,
    effective_gods_zh: Dict,
) -> bool:
    """Detect 食神制殺 (Food God controlling Seven Killings) for daily rescue.

    Per Sub-Agent A1 + B + C Phase A research (2026-05-25):
    Requires ALL of:
      1. day_stem.ten_god ∈ {偏官, 七殺} (七殺-specific; 偏官 = 七殺 alias)
      2. day_stem.role ∈ {用神, 喜神}
      3. day_branch.本氣.role ∈ {忌神, 仇神}
      4. DM produces 食神 element; 食神 transparent in natal stems
      5. 食神 NOT destroyed by 梟印奪食 (偏印 transparent adjacent to 食神
         without 財星 protection)
      6. 食神 has root in some natal branch (本氣 OR 中氣)
      7. day_stem has root in another natal branch (not the day_branch itself)

    Source: 三命通會 卷六·論七殺 «殺以制為貴»; 子平真詮·論七殺 «七殺最喜食神制之»;
    滴天髓闡微·七殺 «七殺乃陽剛之氣，有制則為偏官» — all 3 pillar sources agree
    (no doctrinal split). Sub-Agent C verdict: ship this NARROW carve-out
    instead of bare Pattern 4 (which is genuinely split).
    """
    # 食神 element = element DM produces
    shishen_element = _PRODUCES.get(dm_element)
    if not shishen_element:
        return False

    # 食神 transparent in natal stems (year/month/hour — NOT day stem position)
    shishen_stems_natal = [s for s in natal_stems if STEM_ELEMENT.get(s) == shishen_element]
    if not shishen_stems_natal:
        return False

    # 梟印 = 偏印 element; element that produces DM (i.e., reverse of _PRODUCES from DM-side)
    pian_yin_element = None
    for parent_el, child_el in _PRODUCES.items():
        if child_el == dm_element:
            pian_yin_element = parent_el
            break
    if pian_yin_element:
        # Check if 梟印 is ADJACENT to 食神 in natal stem positions
        # (natal_stems order: [year, month, hour] — day excluded per natal_stems builder).
        # Per Sub-Agent A1+B: «梟印 transparent ADJACENT to 食神 without 財星 protection»
        # destroys 食神. Non-adjacent 梟印 (e.g., 年 + 時 separated by 月+日 stems) does
        # NOT trigger 奪食.
        CONTROLS = {'木': '土', '火': '金', '土': '水', '金': '木', '水': '火'}
        cai_element = CONTROLS.get(dm_element)
        cai_stems_natal = [s for s in natal_stems if STEM_ELEMENT.get(s) == cai_element]
        # Find positions of 梟印 + 食神 in natal_stems
        for i, s in enumerate(natal_stems):
            if STEM_ELEMENT.get(s) != pian_yin_element:
                continue
            # 梟印 at position i. Check immediate neighbors (i-1, i+1) for 食神.
            for j in (i - 1, i + 1):
                if 0 <= j < len(natal_stems):
                    neighbor = natal_stems[j]
                    if STEM_ELEMENT.get(neighbor) == shishen_element:
                        # Adjacent 梟印 + 食神 — check 財星 protection
                        if not cai_stems_natal:
                            return False  # 奪食 destroys 食神 — rule does NOT fire

    # 食神 has root in some natal branch (本氣 OR 中氣)
    natal_branches = [
        pillars['year']['branch'],
        pillars['month']['branch'],
        pillars['day']['branch'],
        pillars['hour']['branch'],
    ]
    shishen_rooted = False
    for b in natal_branches:
        hidden = HIDDEN_STEMS.get(b, [])
        if any(STEM_ELEMENT.get(s) == shishen_element for s in hidden[:2]):
            shishen_rooted = True
            break
    if not shishen_rooted:
        return False

    # day_stem must have root in ANOTHER branch (not the day's flow branch itself)
    day_stem_element = STEM_ELEMENT.get(day_stem, '')
    other_branches = [b for b in natal_branches if b != day_branch]
    day_stem_rooted = False
    for b in other_branches:
        hidden = HIDDEN_STEMS.get(b, [])
        if any(STEM_ELEMENT.get(s) == day_stem_element for s in hidden[:2]):
            day_stem_rooted = True
            break
    if not day_stem_rooted:
        return False

    return True


def _apply_per_day_signal_adjustments(
    raw_label: str,
    *,
    day_stem: str,
    day_branch: str,
    day_ten_god: str,
    year_branch: str,
    natal_day_branch: str,
    day_master_stem: str,
    effective_gods_zh: Dict,
    branch_interactions_on_day_palace: List[str],
    # Phase 1.5 Option 2.5 refinement (research-LOCKED 2026-05-25):
    # additional context needed for 食神制殺 carve-out + xishen_zhongqi rescue
    strength: str = 'neutral',
    flow_month_branch: str = '',
    pillars: Optional[Dict] = None,
) -> Tuple[str, List[str]]:
    """Apply per-day mitigation/acceleration signals on top of raw_label.

    Returns (adjusted_label, list_of_applied_signal_names).
    """
    from .label_subordination import LABEL_LADDER, _pos
    pos = _pos(raw_label)
    applied: List[str] = []

    # --- Shensha aggregate (紅鸞 + 天喜 + 桃花): cap ±1 step ---
    shensha_steps = 0
    if HONGLUAN.get(year_branch) == day_branch:
        shensha_steps += 1
        applied.append('honluan_mitigation')
    if TIANXI.get(year_branch) == day_branch:
        shensha_steps += 1
        applied.append('tianxi_mitigation')

    # 桃花 only counts toward mitigation when day_stem ∈ {用, 喜}
    # Note: TAOHUA is keyed by NATAL DAY BRANCH per constants.py:287 doctrine.
    # 紅鸞/天喜 above use year_branch (FLOW-year doctrine — 三命通會 「年支起紅鸞」),
    # which is the canonical key for those two stars and intentionally different.
    # Pre-PR-46 bug: line used year_branch here too, causing softening to fire on
    # wrong day vs _dispatch_romance's TAOHUA.get(natal_day_branch) at line 194.
    day_stem_element = STEM_ELEMENT.get(day_stem, '')
    day_stem_role = _get_element_role(day_stem_element, day_master_stem, effective_gods_zh)
    if TAOHUA.get(natal_day_branch) == day_branch and day_stem_role in FAVORABLE_ROLES:
        shensha_steps += 1
        applied.append('taohua_mitigation_favorable_stem')

    shensha_steps = max(-1, min(1, shensha_steps))

    # --- 比劫奪財 beneficial valence (Phase 12h.B Item 8): +1 step ---
    bijie_steps = 0
    if day_ten_god in ('比肩', '劫財'):
        wealth_roles = set()
        if isinstance(effective_gods_zh, dict):
            for tg in ('正財', '偏財'):
                role = effective_gods_zh.get(tg)
                if role:
                    wealth_roles.add(role)
        if wealth_roles and wealth_roles.issubset({'忌神', '仇神'}):
            bijie_steps = 1
            applied.append('bijie_duo_cai_beneficial_valence')

    # --- 配偶宮 friction acceleration (六害/半刑/破/子卯刑): -1 step ---
    # When the day-palace already has 六害/半刑/六破 interactions, accelerate
    # toward 凶 by 1 step. Per Phase 12 doctrine 配偶宮負面 stacked with other
    # signals warrants 凶.
    friction_steps = 0
    friction = check_branch_friction(natal_day_branch, day_branch)
    if friction and friction.get('type') in (
        'six_harm', 'half_punishment', 'zi_mao_punishment', 'six_break',
    ):
        friction_steps = -1
        applied.append(f'spouse_palace_{friction["type"]}_acceleration')

    # --- 沖日支 valence-dispatch acceleration ---
    # If day branch clashes with natal day branch AND clashing element is
    # 忌神/仇神, additional -1 step (per plan's valence dispatch). The
    # structural bareMonth captures the GENERIC sevre; this adds the
    # element-aware extra.
    chong_steps = 0
    if '六沖' in branch_interactions_on_day_palace:
        day_branch_element = BRANCH_ELEMENT.get(day_branch, '')
        day_branch_role = _get_element_role(
            day_branch_element, day_master_stem, effective_gods_zh,
        )
        if day_branch_role in {'忌神', '仇神'}:
            # Already structural — only add a soft -1 if NOT already at 凶/大凶
            if pos < _pos('凶'):
                chong_steps = -1
                applied.append('chong_day_branch_unfavorable_valence')

    # --- Phase 1.5 Option 2.5 refinement (research-LOCKED 2026-05-25) ---
    # Two new rules from Phase A 4-parallel Bazi-master research:
    #   Rule A: 食神制殺 day-level rescue (replaces bare Pattern 4)
    #   Rule B: xishen_zhongqi_dissolves_taboo_stem (replaces 比劫敵財 framing)
    # Both rules: +1 step softening; neutral-DM only; mutually exclusive (disjoint
    # day_stem ten_god conditions). Both mutually exclusive with Phase 12h.B
    # 比劫奪財 beneficial valence (also disjoint day_ten_god).
    # Source: Sub-Agent C integrator verdict.
    option_25_steps = 0
    if (
        PHASE_1_5_OPTION_25_REFINEMENT_ENABLED
        and strength == 'neutral'
        and pillars is not None
    ):
        natal_stems = [
            pillars['year']['stem'],
            pillars['month']['stem'],
            pillars['hour']['stem'],
            # NOTE: day_master_stem is natal day stem; not included to avoid
            # self-reference (we want 食神 in OTHER pillars besides day).
        ]

        # Rule A — 食神制殺 day-level rescue
        # Day stem must be 七殺 attacking DM + day stem ∈ {用神, 喜神} + day branch
        # 本氣 ∈ {忌神, 仇神} + structural 制殺 chain active.
        day_stem_element_local = STEM_ELEMENT.get(day_stem, '')
        day_stem_role_local = _get_element_role(
            day_stem_element_local, day_master_stem, effective_gods_zh,
        )
        day_branch_benqi = HIDDEN_STEMS.get(day_branch, [''])[0]
        day_branch_benqi_element = STEM_ELEMENT.get(day_branch_benqi, '')
        day_branch_benqi_role = _get_element_role(
            day_branch_benqi_element, day_master_stem, effective_gods_zh,
        )
        dm_element_local = STEM_ELEMENT.get(day_master_stem, '')

        if (
            day_ten_god in ('偏官', '七殺')
            and day_stem_role_local in {'用神', '喜神'}
            and day_branch_benqi_role in {'忌神', '仇神'}
            and _detect_shishen_zhisha_active(
                dm_stem=day_master_stem,
                dm_element=dm_element_local,
                natal_stems=natal_stems,
                day_stem=day_stem,
                day_branch=day_branch,
                pillars=pillars,
                effective_gods_zh=effective_gods_zh,
            )
        ):
            option_25_steps += 1
            applied.append('shishen_zhisha_day_rescue')

        # Rule B — xishen_zhongqi_dissolves_taboo_stem
        # Day stem ∈ {忌神, 仇神} + day branch 中氣 ∈ {喜神, 用神} + 化忌 path
        # (day_stem element produces zhongqi element) + 半合化局 fails 月令.
        # Mutually exclusive with Rule A (disjoint day_ten_god — Rule A is 七殺,
        # Rule B is non-官殺 忌神).
        if (
            day_stem_role_local in {'忌神', '仇神'}
            and day_ten_god not in ('偏官', '七殺', '正官')  # not officer (Rule A territory)
            and 'shishen_zhisha_day_rescue' not in applied  # mutual exclusion safety net
        ):
            hidden = HIDDEN_STEMS.get(day_branch, [])
            if len(hidden) >= 2:
                zhongqi_stem = hidden[1]
                zhongqi_element = STEM_ELEMENT.get(zhongqi_stem, '')
                zhongqi_role = _get_element_role(
                    zhongqi_element, day_master_stem, effective_gods_zh,
                )
                if (
                    zhongqi_role in {'喜神', '用神'}
                    and _element_produces(day_stem_element_local, zhongqi_element)
                    and flow_month_branch
                    and not banhe_forms_qi(day_branch, flow_month_branch, day_stem_element_local)
                ):
                    option_25_steps += 1
                    applied.append('xishen_zhongqi_dissolves_taboo_stem')

    # --- Total net adjustment ---
    # Cap at ±2 step total (allow 凶→凶中有吉 transition from stacked
    # mitigations like 紅鸞 + 比劫奪財; cap prevents 凶→吉 jumps).
    # Option 2.5 refinement rules are mutually exclusive (+0 or +1) but
    # can stack with 紅鸞/天喜/比劫奪財 — the ±2 cap remains load-bearing.
    net_steps = shensha_steps + bijie_steps + friction_steps + chong_steps + option_25_steps
    net_steps = max(-2, min(2, net_steps))

    # Position delta: positive net_steps (mitigation) → DECREASE position (toward 大吉)
    new_pos = pos - net_steps
    new_pos = max(0, min(len(LABEL_LADDER) - 1, new_pos))
    return LABEL_LADDER[new_pos], applied


# ============================================================
# Phase 1 Option 2.5 (UI layer) — Headliner signals
# ============================================================
#
# The frontend renders a "tech anchor line" between the AI's hook sentence
# and the prose narrative in `daily_overview`. Two zones:
#   - chartContext (left, gold pills): 日干支 + 十神 + 整體判定 — always 3
#   - triggers (right, red pills): up to 2 most-significant signals firing today
#
# Why engine-side, not AI-side: the AI's prose layer can hallucinate or
# miss signals; the engine is the source of truth. Frontend renders the
# pill line VISUALLY with colors so we don't ask the AI to emit styled
# strings (fragile). The AI's narrative still mentions key triggers in
# prose for context, but the chip line is composed from this field.
#
# Priority order for `triggers` (top 2 cut, in descending importance):
#   1. Fix C 殺印相生 transient (override-level, rare)
#   2. 沖日支 / 沖年柱 / 沖月柱 (pillar interactions)
#   3. Fix F 沖庫釋放 (structural release)
#   4. 三刑齊全 (categorical severity)
#   5. 用神/忌神 透干 at day stem (deep doctrinal)
#   6. 紅鸞 / 天喜 / 桃花 觸動 (softening)
#   7. 比劫奪財 / 傷官見官 valence (skip when 'not_applicable')

# Internal-signal-name → Chinese display-label map.
_HEADLINER_TRIGGER_LABELS = {
    # Structural (Phase 12 fixes)
    'officer_seal_activation':     '殺印相生',
    'chong_ku_release':            '沖庫釋放',
    'three_punishment_full':       '三刑齊全',
    # Pillar clashes (from dimension signals)
    'chong_day_branch':            '沖配偶宮',
    'chong_year_branch':           '沖年柱',
    'chong_month_palace':          '沖月柱',
    # Day-stem 透干 (用神/忌神 at day stem)
    'useful_god_stem_transparent': '用神透干',
    'taboo_god_stem_transparent':  '忌神透干',
    # Softening (per-day mitigations)
    'honluan_mitigation':          '紅鸞觸動',
    'tianxi_mitigation':           '天喜觸動',
    'taohua_mitigation_favorable_stem': '桃花觸動',
    'bijie_duo_cai_beneficial_valence': '比劫奪財有益',
    # Valence-aware (Phase 12h.B)
    'shangguan_jian_guan_beneficial': '傷官見官有益',
    'shangguan_jian_guan_harmful':    '傷官見官損官',
}


def _compute_headliner_signals(
    *,
    day_ganzhi: str,
    day_ten_god: str,
    final_auspiciousness: str,
    monthly_result: Dict[str, Any],
    dimensions: Dict[str, Dict[str, Any]],
    softening_signals: List[str],
    effective_gods_zh: Dict[str, str],
    day_stem: str,
    day_master_stem: str,
) -> Dict[str, List[Dict[str, str]]]:
    """Compose the chartContext (always 3) + triggers (top 2) headliner signals.

    Returns:
        {
          'chartContext': [
            {'type': 'day_ganzhi', 'label': '戊子日'},
            {'type': 'day_ten_god', 'label': '比肩'},
            {'type': 'auspiciousness', 'label': '凶中有吉'},
          ],
          'triggers': [
            {'type': 'chong_day_branch', 'label': '沖配偶宮'},
            {'type': 'honluan_mitigation', 'label': '紅鸞觸動'},
          ],  # may be empty on quiet days
        }
    """
    chart_context = [
        {'type': 'day_ganzhi', 'label': f'{day_ganzhi}日'},
        {'type': 'day_ten_god', 'label': day_ten_god},
        {'type': 'auspiciousness', 'label': final_auspiciousness},
    ]

    # Collect candidate triggers in priority order. Each candidate is
    # appended only if its detection condition holds. We cap at 2 final.
    candidates: List[Dict[str, str]] = []

    # Priority 1: Fix C 殺印相生 (override-level)
    if monthly_result.get('officerSealActivation'):
        candidates.append({
            'type': 'officer_seal_activation',
            'label': _HEADLINER_TRIGGER_LABELS['officer_seal_activation'],
        })

    # Priority 2: pillar clashes — scan dimension signals
    chong_seen = set()
    for dim_data in dimensions.values():
        for sig in dim_data.get('signals', []):
            stype = sig.get('type', '')
            if stype.startswith('chong_day_branch') and 'chong_day_branch' not in chong_seen:
                chong_seen.add('chong_day_branch')
                candidates.append({
                    'type': 'chong_day_branch',
                    'label': _HEADLINER_TRIGGER_LABELS['chong_day_branch'],
                })
            elif stype.startswith('chong_year_branch') and 'chong_year_branch' not in chong_seen:
                chong_seen.add('chong_year_branch')
                candidates.append({
                    'type': 'chong_year_branch',
                    'label': _HEADLINER_TRIGGER_LABELS['chong_year_branch'],
                })
            elif stype == 'chong_day_branch_career' and 'chong_month_palace' not in chong_seen:
                # 沖月柱 typically surfaces in career dim
                pass  # already covered by chong_day_branch above

    # Priority 3: Fix F 沖庫釋放
    if monthly_result.get('chongKuRelease'):
        candidates.append({
            'type': 'chong_ku_release',
            'label': _HEADLINER_TRIGGER_LABELS['chong_ku_release'],
        })

    # Priority 4: 三刑齊全 (severe escalation per Phase 12h.A Item 6)
    # Check for severity=80 three_punishment_via_transit on any pillar
    for dim_data in dimensions.values():
        for sig in dim_data.get('signals', []):
            if sig.get('type') == 'three_punishment_via_transit' or sig.get('type') == 'three_punishment_full':
                candidates.append({
                    'type': 'three_punishment_full',
                    'label': _HEADLINER_TRIGGER_LABELS['three_punishment_full'],
                })
                break
        else:
            continue
        break

    # Priority 5: 用神/忌神 transparent at day stem
    day_stem_element = STEM_ELEMENT.get(day_stem, '')
    if day_stem_element and day_stem != day_master_stem:
        # Resolve role of day_stem element vs DM
        from .annual_enhanced import _get_element_role
        day_stem_role = _get_element_role(day_stem_element, day_master_stem, effective_gods_zh)
        if day_stem_role == '用神':
            candidates.append({
                'type': 'useful_god_stem_transparent',
                'label': _HEADLINER_TRIGGER_LABELS['useful_god_stem_transparent'],
            })
        elif day_stem_role == '忌神':
            candidates.append({
                'type': 'taboo_god_stem_transparent',
                'label': _HEADLINER_TRIGGER_LABELS['taboo_god_stem_transparent'],
            })

    # Priority 6: Softening signals (紅鸞 / 天喜 / 桃花)
    for signal_name in softening_signals:
        if signal_name in _HEADLINER_TRIGGER_LABELS and signal_name.endswith(
            ('mitigation', 'favorable_stem')
        ):
            candidates.append({
                'type': signal_name,
                'label': _HEADLINER_TRIGGER_LABELS[signal_name],
            })

    # Priority 7: 比劫奪財 valence (when ≠ 'not_applicable')
    if 'bijie_duo_cai_beneficial_valence' in softening_signals:
        candidates.append({
            'type': 'bijie_duo_cai_beneficial_valence',
            'label': _HEADLINER_TRIGGER_LABELS['bijie_duo_cai_beneficial_valence'],
        })

    # Priority 7b: 傷官見官 valence (scan career dim signals for explicit valence)
    for sig in dimensions.get('career', {}).get('signals', []):
        if sig.get('type') == 'shangguan_jian_guan_transient':
            valence = sig.get('valence')
            if valence == 'beneficial':
                candidates.append({
                    'type': 'shangguan_jian_guan_beneficial',
                    'label': _HEADLINER_TRIGGER_LABELS['shangguan_jian_guan_beneficial'],
                })
            elif valence == 'harmful':
                candidates.append({
                    'type': 'shangguan_jian_guan_harmful',
                    'label': _HEADLINER_TRIGGER_LABELS['shangguan_jian_guan_harmful'],
                })
            break

    # Deduplicate (preserve priority order) + cap at top 2
    seen_types = set()
    triggers: List[Dict[str, str]] = []
    for c in candidates:
        if c['type'] not in seen_types:
            seen_types.add(c['type'])
            triggers.append(c)
            if len(triggers) >= 2:
                break

    return {
        'chartContext': chart_context,
        'triggers': triggers,
    }


# ============================================================
# Single-day orchestrator
# ============================================================

def _compute_single_day(
    *,
    target_date: date,
    pillars: Dict,
    day_master_stem: str,
    effective_gods_zh: Dict,  # Phase 12-shape: {ten_god_zh: role_zh}
    useful_god_element: str,
    gender: str,
    year_branch: str,
    natal_day_branch: str,
    kong_wang: List[str],
    flow_year_auspiciousness: str,
    flow_year_stem: str,
    strength: str = 'neutral',
    is_cong_ge: bool = False,
) -> Dict[str, Any]:
    """Compute one day's fortune for the given chart.

    Reuses `_compute_single_month` for Fix A-F doctrine (蓋頭/截腳, 伏吟,
    殺印, 沖庫, 六害, 六合). The day's stem-branch is wrapped in the
    month_data shape and delegated to the shared month-level orchestrator.

    Then layers day-specific 5-dimension dispatch on top.

    Returns the same structured shape as `_compute_single_month` plus
    daily-specific fields:
    - `dayStem`, `dayBranch`, `dayTenGod`
    - `dimensions: {romance, career, finance, travel, health}` each with
      `score` (0-100), `label`, `signals[]`
    - `energyScore`: derived 0-100 advisory display (from `auspiciousness`)
    - `metaFraming='soft_trigger'` (load-bearing for AI prompt)
    - `folkContent`: static 用神-derived references (Phase 1 set)
    - `dateIso`, `dayGanZhi`
    """
    day_stem, day_branch = get_day_pillar(target_date)
    flow_month_stem, flow_month_branch = get_flow_month_pillar(target_date)

    # =====================================================================
    # Phase 1 Fortune Option 2.5 — Bounded decouple pipeline
    # =====================================================================
    # Two _compute_single_month calls:
    #   Call A: day-pillar as month_data → produces the DAY's own verdict
    #           + Phase 12 Fix A-F detection signals scoped to the day.
    #   Call B: actual flow-month pillar as month_data → produces the FLOW
    #           MONTH's bareMonthAuspiciousness, consumed as cap input.
    # Then apply subordination cap (month + year intersection).
    #
    # This avoids the year-combine double-count that caused all days within
    # a 大吉月 to inherit 大吉. The day's verdict is its OWN (bareMonth from
    # Call A), and the cap from Call B + year constrains it within 提綱
    # doctrine's allowed range.
    # =====================================================================

    # Call A: day pillar analyzed as a "time slice" via the month-level orchestrator
    monthly_result = _compute_single_month(
        month_data={'stem': day_stem, 'branch': day_branch},
        pillars=pillars,
        day_master_stem=day_master_stem,
        effective_gods=effective_gods_zh,
        gender=gender,
        year_branch=year_branch,
        day_branch=natal_day_branch,
        kong_wang=kong_wang,
        flow_year_auspiciousness=flow_year_auspiciousness,
        strength=strength,
        is_cong_ge=is_cong_ge,
        flow_year_stem=flow_year_stem,
    )

    # Call B: actual flow-month pillar verdict for cap chain
    flow_month_result = _compute_single_month(
        month_data={'stem': flow_month_stem, 'branch': flow_month_branch},
        pillars=pillars,
        day_master_stem=day_master_stem,
        effective_gods=effective_gods_zh,
        gender=gender,
        year_branch=year_branch,
        day_branch=natal_day_branch,
        kong_wang=kong_wang,
        flow_year_auspiciousness=flow_year_auspiciousness,
        strength=strength,
        is_cong_ge=is_cong_ge,
        flow_year_stem=flow_year_stem,
    )

    day_ten_god = derive_ten_god(day_master_stem, day_stem)

    # Compute branch-interaction subsets for dimension dispatch
    all_branches = {pillars[p]['branch'] for p in ('year', 'month', 'day', 'hour')} | {day_branch}
    bi_on_day_palace = _check_branch_interaction(natal_day_branch, day_branch, all_branches)
    bi_on_month_palace = _check_branch_interaction(pillars['month']['branch'], day_branch, all_branches)
    bi_on_year_palace = _check_branch_interaction(pillars['year']['branch'], day_branch, all_branches)

    # 5-dimension dispatch
    dimensions = {
        'romance': _dispatch_romance(
            day_stem=day_stem,
            day_branch=day_branch,
            day_ten_god=day_ten_god,
            pillars=pillars,
            day_master_stem=day_master_stem,
            gender=gender,
            effective_gods=effective_gods_zh,
            branch_interactions_on_day_palace=bi_on_day_palace,
        ),
        'career': _dispatch_career(
            day_stem=day_stem,
            day_branch=day_branch,
            day_ten_god=day_ten_god,
            pillars=pillars,
            day_master_stem=day_master_stem,
            effective_gods=effective_gods_zh,
            branch_interactions_on_day_palace=bi_on_day_palace,
            branch_interactions_on_month_palace=bi_on_month_palace,
        ),
        'finance': _dispatch_finance(
            day_stem=day_stem,
            day_branch=day_branch,
            day_ten_god=day_ten_god,
            day_master_stem=day_master_stem,
            effective_gods=effective_gods_zh,
            strength=strength,
            gender=gender,
            monthly_result=monthly_result,
        ),
        'travel': _dispatch_travel(
            day_branch=day_branch,
            pillars=pillars,
            day_master_stem=day_master_stem,
            effective_gods=effective_gods_zh,
            branch_interactions_on_day_palace=bi_on_day_palace,
        ),
        'health': _dispatch_health(
            day_stem=day_stem,
            day_branch=day_branch,
            day_master_stem=day_master_stem,
            effective_gods=effective_gods_zh,
            branch_interactions_on_day_palace=bi_on_day_palace,
            branch_interactions_on_year_palace=bi_on_year_palace,
        ),
    }

    # =====================================================================
    # Phase 1 Fortune Option 2.5 — daily verdict = bareMonth(Call A) + softening + cap
    # =====================================================================
    # Take Call A's BARE month verdict (the day's own pre-year-combine
    # label) as the structural raw daily verdict. Then:
    #   1. Apply per-day signal softening (紅鸞/天喜/桃花/比劫奪財 valence) —
    #      mitigations not captured by monthly-level doctrine
    #   2. Apply subordination cap with Call B's bareMonth (flow month) + year
    #      → matches 提綱 doctrine ("daily can vary but cannot escape month/year trend")
    raw_structural_label = monthly_result.get('bareMonthAuspiciousness', '平')
    flow_month_bare = flow_month_result.get('bareMonthAuspiciousness', '平')

    softened_label, softening_signals = _apply_per_day_signal_adjustments(
        raw_label=raw_structural_label,
        day_stem=day_stem,
        day_branch=day_branch,
        day_ten_god=day_ten_god,
        year_branch=year_branch,
        natal_day_branch=natal_day_branch,
        day_master_stem=day_master_stem,
        effective_gods_zh=effective_gods_zh,
        branch_interactions_on_day_palace=bi_on_day_palace,
        # Phase 1.5 Option 2.5 refinement — new args for 食神制殺 + xishen_zhongqi rules
        strength=strength,
        flow_month_branch=flow_month_branch,
        pillars=pillars,
    )

    final_auspiciousness = apply_subordination_cap(
        raw_label=softened_label,
        bare_month_label=flow_month_bare,
        flow_year_label=flow_year_auspiciousness,
    )

    auspiciousness = final_auspiciousness
    energy_score = derive_energy_score(auspiciousness)

    # Compose headliner signals (chartContext + triggers) for the frontend
    # tech-anchor pill line (Option 2.5 UI layer).
    headliner_signals = _compute_headliner_signals(
        day_ganzhi=f'{day_stem}{day_branch}',
        day_ten_god=day_ten_god,
        final_auspiciousness=final_auspiciousness,
        monthly_result=monthly_result,
        dimensions=dimensions,
        softening_signals=softening_signals,
        effective_gods_zh=effective_gods_zh,
        day_stem=day_stem,
        day_master_stem=day_master_stem,
    )

    # Folk content (Phase 1.5.z — direction + color + number + food (favor/avoid) + hours)
    folk_content = _compute_static_folk_content(
        useful_god_element=useful_god_element,
        day_branch=day_branch,
    )

    # Compose final result (preserving all month-level fields for AI prompt)
    result: Dict[str, Any] = {
        **monthly_result,
        'dayStem': day_stem,
        'dayBranch': day_branch,
        'dayGanZhi': f'{day_stem}{day_branch}',
        'dayTenGod': day_ten_god,
        'dateIso': target_date.isoformat(),
        'dimensions': dimensions,
        'energyScore': energy_score,
        'metaFraming': META_FRAMING_SOFT_TRIGGER,
        'folkContent': folk_content,
        'preAnalysisVersion': FORTUNE_DAILY_PRE_ANALYSIS_VERSION,
    }

    # Override auspiciousness with the Option 2.5 capped value (was monthly_result's
    # year-combined value before this refactor)
    result['auspiciousness'] = final_auspiciousness

    # Option 2.5 transparency fields — explicit data flow for AI prompts (P8 fix)
    result['rawStructuralAuspiciousness'] = raw_structural_label  # pre-softening, pre-cap
    result['rawDailyAuspiciousness'] = softened_label  # post-softening, pre-cap
    result['flowMonthAuspiciousness'] = flow_month_bare  # cap input (independent month theme)
    if softening_signals:
        result['perDaySoftening'] = softening_signals  # which mitigation/acceleration fired
    # AI prompt should prefer `auspiciousness` (final capped value) as the day's verdict.

    # Option 2.5 UI layer — pre-composed headliner pill line (chartContext + triggers)
    result['headlinerSignals'] = headliner_signals

    # Remove month-only field names that would confuse a "day" consumer
    # (preserve underlying data but rename keys for clarity)
    result.pop('monthStem', None)
    result.pop('monthBranch', None)
    result.pop('monthTenGod', None)
    result.pop('monthIndex', None)
    result.pop('monthLabel', None)
    # B2 fix: `bareMonthAuspiciousness` from Call A (via **monthly_result spread)
    # is the DAY-pillar's bare verdict, not the month's — misleading name on a
    # daily result. The same value is preserved as `rawStructuralAuspiciousness`.
    # The MONTH's actual bare is exposed via `flowMonthAuspiciousness`.
    result.pop('bareMonthAuspiciousness', None)

    return result


# ============================================================
# Public entry — compute_daily_fortune
# ============================================================

def compute_daily_fortune(
    *,
    pillars: Dict,
    day_master_stem: str,
    effective_gods: Dict,
    useful_god_element: str,
    gender: str,
    kong_wang: List[str],
    strength: str = 'neutral',
    is_cong_ge: bool = False,
    target_date: Optional[date] = None,
    flow_year_stem: str = '',
    flow_year_auspiciousness: str = '平',
) -> Dict[str, Any]:
    """Public entry point — compute daily fortune for the given chart + date.

    Args:
        pillars: dict with 'year'/'month'/'day'/'hour' each having 'stem' + 'branch'
        day_master_stem: e.g. '戊'
        effective_gods: either engine-format `{usefulGod: '火', ...}` OR
            ten-god-format `{'正官': '忌神', ...}`. Auto-detected and
            normalized via `_normalize_effective_gods_for_annual`.
        useful_god_element: e.g. '火' (per Phase 12 Fix 2 mapping)
        gender: 'male' | 'female' | '男' | '女'
        kong_wang: list of 空亡 branches for this chart
        strength: 'very_weak' | 'weak' | 'neutral' | 'strong' | 'very_strong'
        is_cong_ge: True if chart is 從格
        target_date: defaults to today (caller responsible for 23:00 boundary
            via `resolve_bazi_today_from_clock_time` if needed)
        flow_year_stem: e.g. '丙' for 丙午 2026
        flow_year_auspiciousness: e.g. '吉' (annual_enhanced.compute_tai_sui_analysis
            output — caller threads through)

    Returns:
        Full daily fortune output (see `_compute_single_day` docstring).
    """
    if target_date is None:
        target_date = date.today()

    # Normalize effective_gods to ten-god-keyed Chinese format if needed
    effective_gods_zh = _normalize_effective_gods_for_annual(effective_gods, day_master_stem)

    return _compute_single_day(
        target_date=target_date,
        pillars=pillars,
        day_master_stem=day_master_stem,
        effective_gods_zh=effective_gods_zh,
        useful_god_element=useful_god_element,
        gender=gender,
        year_branch=pillars['year']['branch'],
        natal_day_branch=pillars['day']['branch'],
        kong_wang=kong_wang,
        flow_year_auspiciousness=flow_year_auspiciousness,
        flow_year_stem=flow_year_stem,
        strength=strength,
        is_cong_ge=is_cong_ge,
    )
