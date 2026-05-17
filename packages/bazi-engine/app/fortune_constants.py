"""
Fortune Constants — 日運/月運/年運 (Daily/Monthly/Yearly Bazi Fortune)

Shared constants for the Fortune feature. All values are deterministic and
classically anchored; the 0-100 energy score is a DERIVED display value.
The 7-label system (大吉/吉/吉中有凶/平/凶中有吉/凶/大凶) is the engine's
source of truth.

References:
- 算准网 流日 trigger doctrine: 「流日的影响主要是瞬间的」
  https://www.suanzhun.net/article/2726.html
- 七級吉凶分級: 《滴天髓·論墓庫》 + 子平真詮·論用神成敗救應
- Subscriber window decision: Phase 1 plan (yesterday + today + 30 days
  forward; month/year: last + current + future window)

DO NOT add daily-specific 用神 reassignment — 用神 is chart-level only
(per Phase 12 doctrine).
"""

from typing import Dict


# ============================================================
# Label ↔ Energy Score mapping
# ============================================================
#
# 7-label is engine source of truth. Energy score (0-100) is derived for
# UI display as 「能量指數」 (advisory). Bands are mid-band of each label's
# classical strength tier. NOT a substitute for the label itself.
#
# WARNING: Do not change these bands without a sub-agent review pass —
# they're regression-pinned by `test_daily_enhanced.py::test_label_to_score`.

# Severity ordering (worst → best, per _compute_single_month's combined label dispatch):
#   凶上加凶 < 大凶 < 凶 < 小凶 < 凶中有吉 < 平 < 吉中有凶 < 吉 < 大吉
#
# 凶上加凶 is doctrinally MORE severe than 大凶: it fires only when BOTH
# month AND year are 凶/大凶 simultaneously (annual_enhanced.py:2076).
# A single 大凶 month with 平 year would never produce 凶上加凶 — so
# 凶上加凶 always includes a 大凶/凶 component PLUS a year-negative
# component. Score must reflect that.
LABEL_TO_ENERGY_SCORE: Dict[str, int] = {
    '大吉': 88,
    '吉': 72,
    '吉中有凶': 58,
    '平': 50,
    '凶中有吉': 42,
    '小凶': 35,    # legacy intermediate (Phase 12b emits when 平 day branch hits 六沖)
    '凶': 25,
    '大凶': 15,
    '凶上加凶': 8, # combined: month-negative AND year-negative — strictly worse than 大凶 alone
}

# Reverse map for anomaly detection (`abs(derived_score - midpoint) > 10` warns)
ENERGY_SCORE_TO_LABEL_BAND: Dict[int, str] = {v: k for k, v in LABEL_TO_ENERGY_SCORE.items()}


# ============================================================
# 5 dimension keys (must match TypeScript types + AI prompt fields)
# ============================================================

DIMENSION_KEYS = ['romance', 'career', 'finance', 'travel', 'health']

DIMENSION_LABELS_ZH = {
    'romance': '感情',
    'career': '事業',
    'finance': '財運',
    'travel': '出行',
    'health': '健康',
}


# ============================================================
# Bazi day boundary
# ============================================================
#
# A Bazi day starts at 23:00 (子時 start), NOT midnight. Implementations
# that compute 「今天的干支」 MUST add one day when local time is in the
# 23:00-23:59 window. Day pillar lookup uses 12:00 noon target to sidestep
# the boundary ambiguity for the date itself.

DAILY_BAZI_DAY_BOUNDARY_HOUR = 23


# ============================================================
# Subscriber window
# ============================================================
#
# Per locked plan:
# - DAY scope: free=today only; subscribers can also see yesterday +
#   today through +30 days.
# - MONTH scope: free=this month only; subscribers can also see last
#   month + this month through +12 months.
# - YEAR scope: free=this year only; subscribers can also see last year
#   + this year through +5 years.
#
# Past window is INTENTIONALLY just one period back (not symmetric with
# future). See plan.

SUBSCRIBER_FUTURE_DAYS = 30
SUBSCRIBER_PAST_DAYS = 1

SUBSCRIBER_FUTURE_MONTHS = 12
SUBSCRIBER_PAST_MONTHS = 1

SUBSCRIBER_FUTURE_YEARS = 5
SUBSCRIBER_PAST_YEARS = 1


# ============================================================
# Meta framing — load-bearing for AI prompt anti-hallucination
# ============================================================
#
# Daily fortune is a TRIGGER not a verdict (per modern 子平 consensus on
# 流日 weak-force doctrine). Every daily output carries this flag so the
# AI prompt's anti-hallucination clauses can key off it and forbid
# absolute language (一定/必然/必/絕對/百分百).

META_FRAMING_SOFT_TRIGGER = 'soft_trigger'


# ============================================================
# Energy score derivation
# ============================================================

def derive_energy_score(label: str) -> int:
    """Derive 0-100 energy score from 7-label.

    The label is the SOURCE OF TRUTH; the score is advisory display only.
    Unknown labels fall back to 50 (平).
    """
    return LABEL_TO_ENERGY_SCORE.get(label, 50)


# ============================================================
# Dimension score → label
# ============================================================
#
# When aggregating per-dimension signals to a score, we map back to a
# soft 5-tier label for display (different from the overall 7-tier label).

DIMENSION_LABEL_BANDS = [
    (80, '極佳'),
    (65, '順遂'),
    (50, '平穩'),
    (35, '需謹慎'),
    (0, '不利'),
]


def derive_dimension_label(score: int) -> str:
    """Map a 0-100 dimension sub-score to a soft 5-tier display label."""
    for threshold, label in DIMENSION_LABEL_BANDS:
        if score >= threshold:
            return label
    return '不利'


# ============================================================
# Pre-analysis version (bumped when daily_enhanced.py changes shape)
# ============================================================
#
# Matches FORTUNE_PRE_ANALYSIS_VERSIONS.day in apps/api/src/ai/ai.service.ts.
# Bump on any breaking change to the daily output shape (new required
# field, removed field, renamed field). Cache invalidation rules:
# bump → all DailyFortuneSnapshot rows older than this version are
# regenerated lazily on next fetch.

FORTUNE_DAILY_PRE_ANALYSIS_VERSION = 'v1.1.0'  # Option 2.5 (Bounded Decouple) per-day verdict — 2026-05-14
FORTUNE_MONTHLY_PRE_ANALYSIS_VERSION = 'v1.0.0'
FORTUNE_YEARLY_PRE_ANALYSIS_VERSION = 'v1.0.0'
