# Phase 12d Implementation Plan v2.1 — engine fixes for 用神 validation gate

**Origin**: validation harness Gate 1 found 10 engine bugs (3 patterns) + 11 doctrinal splits across 50 classical-source charts. Phase A (bazi-master agent): 5✓ / 1⚠ / 0✗ doctrine verification. Phase C (staff-engineer agent): 27 issues, 7 blockers in v1. v2 addressed all 10 MUST items but introduced 3 new bugs (N1/N2/N3) in the rewrite. **v2.1 fixes all three.**

**v2 → v2.1 errata** (3 surgical fixes from Phase D re-review):
- **N1**: Pattern 3b's `SEASON_MULTIPLIER.get(formed_el, {}).get(month_branch, 1.0)` was structurally wrong (constant is `Dict[int, float]` keyed by score 1-5). Fixed to score-then-multiplier two-step lookup. Without this, Pattern 3b would never fire.
- **N2**: `_assert_five_gods_distinct` invariant scoped to `dmAsYongShen=True` only. The 從弱 family deliberately has `usefulGod == favorableGod` (4-distinct), and the unscoped assertion would have broken every existing 從財/從官/從兒/從勢 chart.
- **N3**: Neutral-DM 財旺 branch in `determine_favorable_gods` narrowed to a single sub-branch (`elif strength == 'neutral' and dominant == '財旺':`), letting all other neutral cases fall through to existing weak-path defaults. Avoids silent baseline drift on neutral-general charts.

**v1 → v2 changes summary**:
- **Commit order reversed** per Phase A's explicit recommendation (Pattern 2 strength fixes ship BEFORE Pattern 1 so V2-borderline charts cross to neutral first).
- All S7 import errors fixed (`SIX_OPPOSITIONS` → `CLASH_LOOKUP`; `IMBALANCE_*` from `ten_gods.py`; `import os` added).
- Pattern 2c double-count guard fixed (compare elements, not stems).
- Pattern 1's neutral-DM `'財旺'` branch added to `determine_favorable_gods`.
- Pattern 3a `xiShen` propagation + 從強 family `tabooGod` invariant fixed.
- Pattern 2a rooted-比劫 filter implemented.
- Pattern 3b DM-involved-五合 guard added.
- Per-flag default table + 真化 condition alignment with Phase 12b Fix D + cross-pattern integration tests.

**Goal**: lift 用神 agreement on the 50-chart corpus from **58% → ~78%** by fixing 10 engine bugs. Doctrinal splits (11 charts) remain documented as accepted ambiguities.

**Source documents** (must be read before implementing):
- `.claude/plans/validation_triage_report.md` — chart-by-chart triage
- `.claude/plans/validation_fix_doctrine_verification.md` — Phase A doctrine verification
- `.claude/plans/validation_diagnostic_dump.txt` — engine reasoning dump
- `.claude/plans/phase_12d_review_v1.md` — Phase C staff-engineer review (this plan addresses every MUST item)
- `CLAUDE.md` — section "八字流年運勢 Calculation — Phase 12 / 12b / 12c Fixes"

---

## Branch + 6-commit structure

Branch: `claude/phase-12d-yongshen-fixes`

### Per-flag default table

| Env flag | Default | Rationale |
|---|---|---|
| `PHASE_12D_PATTERN_2C_SANHE_CREDIT` | **ON** | Low risk; mechanical V2 dedi credit |
| `PHASE_12D_PATTERN_2A_BIJIE_BOOST` | **ON** | Low-mod risk; rooted-stem guard prevents over-fire |
| `PHASE_12D_PATTERN_2B_SURROUND_DAMPENER` | **ON** | Mod risk; narrow trigger (官殺 透干 required) |
| `PHASE_12D_PATTERN_1_NEUTRAL_BRANCH` | **ON** | Low risk; doctrine canonical (沈孝瞻 命例) |
| `PHASE_12D_PATTERN_3B_HUAQI_SUPPRESSION` | **ON** | Mod risk; reuses Phase 12b Fix D 真化 conditions |
| `PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR` | **OFF** | High risk; ship behind explicit opt-in |

All 6 flags follow the existing `_USE_WEIGHTED_IMBALANCE` convention: a private module constant set at import time. Tests monkeypatch the constant, not the env var. `BAZI_USE_WEIGHTED_IMBALANCE` flag flip remains its own separate decision (Phase 12 Fix 1a, blocked on this validation harness).

### Commit order (per Phase A doctrine)

1. **Pattern 2c** (V2 dedi 三合/半合 credit) — V2 building block
2. **Pattern 2a / 2a'** (V2 比劫 透干 boost) — depends on 2c being in place for borderline math
3. **Pattern 2b** (V2 surround dampener) — last V2 modification
4. **Pattern 1** (neutral 食傷洩秀) — fires AFTER V2 fixes raise borderline charts to neutral
5. **Pattern 3b** (真化 suppression in 從格) — unblocks anchor chart
6. **Pattern 3a** (從強/從旺 detector) — flag-OFF default; highest risk

Re-run validation harness after EACH commit. Per-commit projected agreement (more honest after Phase A ordering correction):
- After 2c: 58% (no flips yet, sets up 2a) — agreement unchanged but `noble3` V2 rises
- After 2a: ~62% (`ma_canzheng` + `edge_shishang_strong_jia` flip)
- After 2b: ~64% (`yao_pinwo` flips)
- After 1: ~72% (Pattern 1 now fires on charts correctly classified neutral; flips 4 charts including 沈路分 + 梁丞相)
- After 3b: ~74% (`anchor_cong_cai_yiwuming` flips)
- After 3a (flag=on): ~76% (`wu_xianggong_qu_zhi` flips)

---

## Commit 1 — Pattern 2c: 三合/半合 DM-element credit in V2 dedi

**Problem**: V2 under-counts 半合/三合 formed elements that strengthen DM. `dts_hezhi_noble3` (酉丑半合金 with 辛 DM) gets V2=29.7 (weak); corpus says neutral.

**Doctrinal source**: 《滴天髓·地支》「三合會局，氣專而力大」; 《淵海子平·地支三合》「凡三合局內，旺神最重，墓神次之，生神最輕」. Multipliers (per Phase A): 三合=1.0, 旺地半合=0.7, 墓地半合=0.5.

### Files modified
- `packages/bazi-engine/app/constants.py` (new constants)
- `packages/bazi-engine/app/branch_relationships.py` (new helper, with imports added)
- `packages/bazi-engine/app/interpretation_rules.py` (V2 dedi extension; **+ `import os`**)
- `packages/bazi-engine/tests/test_phase_12d_pattern_2c.py` (NEW)

### Implementation

**2c-1 — Add `import os` to top of `interpretation_rules.py`** (S7.7 fix). All 4 V2-modifying commits depend on this; do once in commit 1.

**2c-2 — Constants** in `constants.py`, in the seasonal/relationship section (after `SEASON_MULTIPLIER`):

```python
# Phase 12d Pattern 2c: 三合/半合 formed-element multipliers for V2 得地 credit.
# Source: 《滴天髓·地支》, Phase A doctrine verification.
SAN_HE_FULL_MULTIPLIER: float = 1.0       # 三合 (3 branches present)
BAN_HE_WANG_MULTIPLIER: float = 0.7       # 旺地半合 (旺神 + 1 partner)
BAN_HE_MU_MULTIPLIER: float = 0.5         # 墓地半合 (生神 + 墓神, no 旺神)

# 三合 trinities: (旺=帝旺, 生=長生, 墓=墓庫)
SAN_HE_TRINITIES: Dict[str, Tuple[str, str, str]] = {
    '木': ('卯', '亥', '未'),
    '火': ('午', '寅', '戌'),
    '金': ('酉', '巳', '丑'),
    '水': ('子', '申', '辰'),
    # 土 has 四庫 (辰戌丑未) — out of scope for this pattern
}

# Per-branch dedi point contribution scale (matches HIDDEN_STEM_WEIGHTS scale)
SAN_HE_DEDI_PER_BRANCH: float = 5.0
```

**2c-3 — Helper** `compute_sanhe_dm_credit()` in `branch_relationships.py`:

First add to imports at top of `branch_relationships.py`:
```python
from .constants import (
    BRANCH_ELEMENT, BRANCH_INDEX,
    HIDDEN_STEMS, STEM_ELEMENT,                    # NEW for 2c
    SAN_HE_TRINITIES, SAN_HE_FULL_MULTIPLIER,      # NEW for 2c
    BAN_HE_WANG_MULTIPLIER, BAN_HE_MU_MULTIPLIER,  # NEW for 2c
    SAN_HE_DEDI_PER_BRANCH,                        # NEW for 2c
)
```

Then add the helper:
```python
def compute_sanhe_dm_credit(
    pillars: Dict,
    dm_element: str,
) -> Tuple[float, str]:
    """
    Compute extra 得地 credit for DM from 三合/半合 formed-element matches.

    Returns (credit_score, kind) where kind ∈ {'三合', '旺地半合', '墓地半合', 'none'}.
    Credit is in V2 dedi points (caller adds to dedi, respecting cap).

    Rules (Phase A verified):
      1. Formed-element must equal DM element. Else (0, 'none').
      2. Active 沖 on 旺神 branch nullifies credit (合而被沖則散).
      3. Branches that already provide DM 通根 via 本氣 are excluded
         from the trinity bonus (avoids double-counting standard dedi).
      4. Per-branch contribution = SAN_HE_DEDI_PER_BRANCH × multiplier.
    """
    if dm_element not in SAN_HE_TRINITIES:
        return (0.0, 'none')

    wang, sheng, mu = SAN_HE_TRINITIES[dm_element]
    natal_branches = [pillars[p]['branch'] for p in
                      ('year', 'month', 'day', 'hour')]
    has_wang = wang in natal_branches
    has_sheng = sheng in natal_branches
    has_mu = mu in natal_branches

    # 沖 disrupts 旺神
    wang_clash = CLASH_LOOKUP.get(wang)  # S7.1 fix: was SIX_OPPOSITIONS
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

    # S7.4 fix: compare ELEMENT-to-element, not stem-string-to-element-string.
    # Branches whose 本氣 element already equals DM element are excluded
    # (already credited via standard `dedi`).
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
```

**2c-4 — Module-level flag** in `interpretation_rules.py`, alongside other module constants:
```python
import os  # added in 2c-1
# ... existing imports ...

_PATTERN_2C_SANHE_CREDIT: bool = os.environ.get(
    'PHASE_12D_PATTERN_2C_SANHE_CREDIT', '1'
).lower() in ('1', 'true', 'yes', 'on')
```

**2c-5 — Wire into V2** in `calculate_strength_score_v2`, after `dedi = min(root_score * 30, 30)` (line 161):

```python
# Phase 12d Pattern 2c: 三合/半合 DM-element credit
sanhe_kind = 'none'
if _PATTERN_2C_SANHE_CREDIT:
    from .branch_relationships import compute_sanhe_dm_credit
    sanhe_credit, sanhe_kind = compute_sanhe_dm_credit(pillars, dm_element)
    if sanhe_credit > 0:
        dedi = min(dedi + sanhe_credit, 30)
```

**2c-6 — Tests** in `tests/test_phase_12d_pattern_2c.py`:

| Test | Chart | Expected |
|---|---|---|
| `test_dm_dedi_boosted_by_yandi_banhe` | `dts_hezhi_noble3` (甲午 丙寅 辛酉 己丑) | dedi rises by ~5×0.5=2.5; 酉 excluded (本氣=辛=DM); only 丑 contributes |
| `test_dm_dedi_boosted_by_full_sanhe` | synthetic 申子辰 + 壬 DM | 三合 credit applied; 申 excluded (本氣=庚≠水), 子 excluded (本氣=癸=DM-element-aware), 辰 included |
| `test_chong_disrupts_sanhe_credit` | synthetic 酉丑 + 卯 with 辛 DM | 卯酉沖 → credit=0 |
| `test_no_credit_when_formed_element_differs_from_dm` | 寅午半合 with 甲 DM (formed=火≠木) | credit=0 |
| `test_pattern_2c_disabled_when_flag_off` | monkeypatch `_PATTERN_2C_SANHE_CREDIT=False` | dedi unchanged from baseline |
| `test_anchor_roger_unchanged` | Roger pillars | dedi delta=0 (no DM-element trinity in Roger's branches) |
| `test_anchor_laopo_unchanged` | Laopo pillars | dedi delta=0 |

**2c-7 — Re-run harness**; expect `noble3` to rise from V2=29.7 to ~32. Still `weak`, but now sets up Pattern 2a and Pattern 1 to potentially fire later. Agreement unchanged at 58%.

### Risks & mitigations
- Cap at 30 stays — half/full 合 credit can't drive dedi over the existing limit.
- Element-vs-stem comparison: now correctly compared (S7.4 fix verified by test).

---

## Commit 2 — Pattern 2a + 2a': 比劫 透干 boost

**Problem**: V2 under-counts 三比劫透干 + 月令印 (`ziping_ma_canzheng` V2=53.7) AND 三比劫透干 + 月令本氣比劫/羊刃 (`edge_shishang_strong_jia` V2=49.5). Both should be `strong`.

**Doctrinal source**: 《滴天髓·體用》「身強印旺則愈壯」+ 《滴天髓》八格篇「印綬之格，月令印星，加比劫透干，身重印重，謂之旺極」.

**Refined per Phase A**:
- Trigger: `transparent_count[比劫] >= 2` (DM excluded by `compute_weighted_category_scores` convention)
- 2a (month=印): boost +8 per 透干 above the 2nd, capped at +20
- 2a' (month=本氣比劫/羊刃): boost +6 per 透干 above the 2nd
- Only **rooted** 比劫 透干 contribute (S6.3 fix — Phase A's 「干多不如根重」 requirement)
- 月令中氣印: 60% credit

### Files modified
- `packages/bazi-engine/app/constants.py`
- `packages/bazi-engine/app/interpretation_rules.py` (helper + V2 wiring)
- `packages/bazi-engine/tests/test_phase_12d_pattern_2a.py` (NEW)

### Implementation

**2a-1 — Constants** in `constants.py`:
```python
# Phase 12d Pattern 2a/2a' — 比劫 透干 boost.
PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD: int = 2  # transparent_count[比劫] >=
PATTERN_2A_BOOST_PER_TRANSPARENT_YIN_MONTH: float = 8.0    # +8/透干 above 2nd
PATTERN_2A_BOOST_PER_TRANSPARENT_BIJIE_MONTH: float = 6.0  # +6/透干 (羊刃)
PATTERN_2A_ZHONGQI_YIN_MULTIPLIER: float = 0.6  # 月令中氣 印 partial credit
PATTERN_2A_BOOST_CAP: float = 20.0
```

**2a-2 — Helper** in `interpretation_rules.py` (after `calculate_strength_score_v2`):

```python
_PATTERN_2A_BIJIE_BOOST: bool = os.environ.get(
    'PHASE_12D_PATTERN_2A_BIJIE_BOOST', '1'
).lower() in ('1', 'true', 'yes', 'on')


def _build_root_class_cache(pillars: Dict) -> Dict[str, str]:
    """
    Build root_class_cache mirroring compute_weighted_category_scores logic.
    Returns {stem: 'strong' | 'weak' | 'none'}.

    'strong' = stem appears as 本氣 OR 中氣 in any branch's hidden stems.
    'weak'   = stem appears only as 餘氣 (yuqi).
    'none'   = stem has no presence in any branch.
    """
    cache: Dict[str, str] = {}
    for stem in '甲乙丙丁戊己庚辛壬癸':
        positions: List[str] = []
        for pname in ('year', 'month', 'day', 'hour'):
            branch = pillars.get(pname, {}).get('branch', '')
            for idx, hs in enumerate(HIDDEN_STEMS.get(branch, [])):
                if hs == stem:
                    positions.append(['benqi', 'zhongqi', 'yuqi'][min(idx, 2)])
        has_strong = 'benqi' in positions or 'zhongqi' in positions
        has_weak = 'yuqi' in positions and not has_strong
        cache[stem] = 'strong' if has_strong else ('weak' if has_weak else 'none')
    return cache


def _pattern_2a_bijie_boost(
    pillars: Dict,
    day_master_stem: str,
) -> Tuple[float, str]:
    """
    Phase 12d Pattern 2a/2a': boost V2 when 比劫 transparent ≥2
    AND month=印 (2a) OR month=本氣比劫祿/羊刃 (2a').

    Returns (boost, source) where source ∈
      {'month_yin_benqi', 'month_yin_zhongqi', 'month_bijie', 'none'}.

    S6.3 fix: only rooted 比劫 (root_class ∈ {'strong','weak'}) count
    toward the boost — Phase A 「干多不如根重」.
    """
    from .ten_gods import compute_weighted_category_scores

    dm_element = STEM_ELEMENT[day_master_stem]
    producing_element = ELEMENT_PRODUCED_BY[dm_element]

    # Count rooted-only 比劫 transparent (excludes DM itself per existing
    # convention in compute_weighted_category_scores).
    root_cache = _build_root_class_cache(pillars)
    rooted_bijie_transparent = 0
    for pname in ('year', 'month', 'hour'):  # day skipped (DM)
        stem = pillars.get(pname, {}).get('stem', '')
        if not stem or stem == day_master_stem:
            continue
        if STEM_ELEMENT.get(stem, '') != dm_element:
            continue
        # Same-element check covers both 比肩 and 劫財
        if root_cache.get(stem, 'none') in ('strong', 'weak'):
            rooted_bijie_transparent += 1

    if rooted_bijie_transparent < PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD:
        return (0.0, 'none')

    # Determine month-branch nature (印 main / 中氣印 / 本氣比劫)
    month_branch = pillars['month']['branch']
    month_hidden = HIDDEN_STEMS.get(month_branch, [])
    month_main_el = STEM_ELEMENT.get(month_hidden[0], '') if month_hidden else ''
    month_zhongqi_el = (STEM_ELEMENT.get(month_hidden[1], '')
                        if len(month_hidden) > 1 else '')

    excess = rooted_bijie_transparent - PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD + 1

    if month_main_el == producing_element:  # Pattern 2a: 月令本氣印
        boost = excess * PATTERN_2A_BOOST_PER_TRANSPARENT_YIN_MONTH
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_yin_benqi')
    if month_zhongqi_el == producing_element:  # 月令中氣印 (60% credit)
        boost = (excess
                 * PATTERN_2A_BOOST_PER_TRANSPARENT_YIN_MONTH
                 * PATTERN_2A_ZHONGQI_YIN_MULTIPLIER)
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_yin_zhongqi')
    if month_main_el == dm_element:  # Pattern 2a': 月令本氣比劫 (祿/羊刃)
        boost = excess * PATTERN_2A_BOOST_PER_TRANSPARENT_BIJIE_MONTH
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_bijie')

    return (0.0, 'none')
```

**2a-3 — Wire into V2** in `calculate_strength_score_v2`, AFTER Pattern 2c block, BEFORE classification:

```python
# Phase 12d Pattern 2a/2a': 比劫 transparent boost
pattern_2a_boost = 0.0
if _PATTERN_2A_BIJIE_BOOST:
    pattern_2a_boost, _pattern_2a_source = _pattern_2a_bijie_boost(
        pillars, day_master_stem)

# 得勢 calculation (existing) — unchanged
# ...
deshi = (support_score / total_weight) * 20 if total_weight > 0 else 0

total = round(deling + dedi + deshi + pattern_2a_boost, 1)
```

**2a-4 — Tests** in `tests/test_phase_12d_pattern_2a.py`:

| Test | Chart | Expected |
|---|---|---|
| `test_ma_canzheng_strong_after_boost` | 壬寅 戊申 壬辰 壬寅 (DM=壬) | V2 53.7 → ≥55 (`strong`) |
| `test_pattern_2a_prime_works_for_yangren` | 丙寅 甲午 甲寅 丁卯 (DM=甲) | V2 49.5 → ≥55 |
| `test_no_boost_for_2_rooted_bijie` | synthetic exactly 2 透干 (`rooted_bijie_transparent=1`) | boost=0 |
| `test_no_boost_for_rootless_bijie` | 三比劫 透干 ALL rootless | boost=0 (S6.3 verification) |
| `test_zhongqi_yin_partial_credit` | synthetic month with 中氣=印 only | 60% boost |
| `test_pattern_2a_disabled_when_flag_off` | monkeypatch | unchanged |
| `test_anchor_roger_unchanged` | Roger | boost=0 (戊DM, month=申, 申本氣=庚=食神, 中氣=壬=財; not 印 nor 比劫) |
| `test_anchor_laopo_unchanged` | Laopo | boost=0 (甲DM, only 1 transparent 比劫) |

**2a-5 — Harness**: agreement 58% → ~62%.

### Risks
- **Roger/Laopo regression**: explicitly tested. Roger's month=申 (no 印/比劫 main); Laopo has only 1 transparent 比劫.
- **Cascade with 2c**: 2c modifies dedi, 2a applies separate boost to total. They compose linearly — a chart could trigger both. Tested in integration test `test_2c_2a_compose`.

---

## Commit 3 — Pattern 2b: 月令祿 surround dampener

**Problem**: V2 over-credits 月令祿 in surround scenarios. `dts_hezhi_yao_pinwo` (丙生巳月 + 全局財官) gets V2=62.2 (`strong`); corpus says `very_weak`.

**Doctrinal source**: 《淵海子平·論建祿格》「若四柱財官重重而日主獨守月令祿地，反為弱論」.

**Refined per Phase A**: dampener formula `(enemy − support) × 1.8` capped at 18 + flat -15 surround penalty (two-part rule needed to drive `yao_pinwo` from 62.2 to ≤40).

### Files modified
- `packages/bazi-engine/app/constants.py`
- `packages/bazi-engine/app/interpretation_rules.py`
- `packages/bazi-engine/tests/test_phase_12d_pattern_2b.py` (NEW)

### Implementation

**2b-1 — Constants**:
```python
# Phase 12d Pattern 2b — 月令祿 surround dampener.
PATTERN_2B_ENEMY_THRESHOLD: float = 9.0
PATTERN_2B_SUPPORT_CAP: float = 5.0
PATTERN_2B_OFFICER_TRANSPARENT_MIN: int = 1
PATTERN_2B_DAMPENER_MULTIPLIER: float = 1.8
PATTERN_2B_DAMPENER_CAP: float = 18.0
PATTERN_2B_FLAT_SURROUND_PENALTY: float = 15.0
PATTERN_2B_DELING_FLOOR: float = 12.0
```

**2b-2 — Helper** in `interpretation_rules.py`:
```python
_PATTERN_2B_SURROUND_DAMPENER: bool = os.environ.get(
    'PHASE_12D_PATTERN_2B_SURROUND_DAMPENER', '1'
).lower() in ('1', 'true', 'yes', 'on')


def _pattern_2b_surround_penalty(
    pillars: Dict,
    day_master_stem: str,
    deling: float,
) -> Tuple[float, float, bool]:
    """
    Phase 12d Pattern 2b: 月令祿 surround penalty.

    Returns (deling_cut, flat_penalty, fired). Caller subtracts both.

    Trigger requires:
      - 得令 == 50 (month=祿/帝旺/印 本氣)
      - (財+官殺) weighted ≥ 9
      - (比劫+印, sans 月令本氣 contribution) ≤ 5
      - transparent[官殺] ≥ 1
    """
    if deling < 50.0:
        return (0.0, 0.0, False)

    from .ten_gods import (
        compute_weighted_category_scores,
        IMBALANCE_WEIGHT_HIDDEN_BENQI,        # S7.2 fix: from ten_gods, not constants
        MONTH_BENQI_COMMANDER_MULTIPLIER,
        PILLAR_ROLE_WEIGHT,
    )

    scores = compute_weighted_category_scores(pillars, day_master_stem)
    cats = scores['categories']
    transp = scores['category_transparent_count']

    enemy = cats.get('財星', 0.0) + cats.get('官殺', 0.0)
    support_total = cats.get('比劫', 0.0) + cats.get('印星', 0.0)

    # Subtract 月令本氣 contribution from support (Phase A: "比劫+印 sans 月令本氣")
    month_branch = pillars['month']['branch']
    month_main_stem = (HIDDEN_STEMS.get(month_branch, [''])[0]
                       if HIDDEN_STEMS.get(month_branch) else '')
    if month_main_stem:
        dm_el = STEM_ELEMENT[day_master_stem]
        producing = ELEMENT_PRODUCED_BY[dm_el]
        main_el = STEM_ELEMENT.get(month_main_stem, '')
        if main_el in (dm_el, producing):
            month_contribution = (IMBALANCE_WEIGHT_HIDDEN_BENQI
                                  * MONTH_BENQI_COMMANDER_MULTIPLIER
                                  * PILLAR_ROLE_WEIGHT['month'])
            support = max(0.0, support_total - month_contribution)
        else:
            support = support_total
    else:
        support = support_total

    if (enemy >= PATTERN_2B_ENEMY_THRESHOLD
        and support <= PATTERN_2B_SUPPORT_CAP
        and transp.get('官殺', 0) >= PATTERN_2B_OFFICER_TRANSPARENT_MIN):
        deling_cut = min(
            (enemy - support) * PATTERN_2B_DAMPENER_MULTIPLIER,
            PATTERN_2B_DAMPENER_CAP,
            deling - PATTERN_2B_DELING_FLOOR,
        )
        return (deling_cut, PATTERN_2B_FLAT_SURROUND_PENALTY, True)

    return (0.0, 0.0, False)
```

**2b-3 — Wire into V2** (must come AFTER 2c+2a; recompute total):
```python
# Phase 12d Pattern 2b: 月令祿 surround penalty
pattern_2b_deling_cut = 0.0
pattern_2b_flat_penalty = 0.0
if _PATTERN_2B_SURROUND_DAMPENER:
    pattern_2b_deling_cut, pattern_2b_flat_penalty, fired = (
        _pattern_2b_surround_penalty(pillars, day_master_stem, deling))
    if fired:
        deling = max(deling - pattern_2b_deling_cut, PATTERN_2B_DELING_FLOOR)

# Recompute total with all Phase 12d adjustments
total = round(
    deling + dedi + deshi + pattern_2a_boost - pattern_2b_flat_penalty, 1)
```

**2b-4 — Tests**:
| Test | Chart | Expected |
|---|---|---|
| `test_yao_pinwo_drops_to_weak_or_below` | 辛丑 癸巳 丙子 丁酉 | V2 62.2 → ≤40 (weak/very_weak); 用神 chain → 木 |
| `test_pattern_2b_no_misfire_balanced_chart` | synthetic 月令祿 + balanced 財官 (enemy=8.5) | not fired |
| `test_pattern_2b_no_misfire_pure_bijie_strong` | 三比劫透干 + 月令祿 + minimal 財官 | not fired (support>5) |
| `test_pattern_2b_disabled_when_flag_off` | monkeypatch | V2 unchanged |
| `test_anchor_roger_unchanged` | Roger (deling=24, < 50) | not fired |
| `test_anchor_laopo_unchanged` | Laopo (deling for 甲 in 丑 ≠ 50) | not fired |

**2b-5 — Harness**: agreement ~62% → ~64%.

### Risks
- **2a vs 2b coexistence**: 2a fires when 比劫 透干 ≥2 + month=印. 2b fires when (比劫+印 sans 月令) ≤ 5 + 官殺 透干. A chart with 比劫 透干 ≥2 typically pushes support_total > 5, blocking 2b. Tested in integration.
- **Existing fixture regressions**: Roger=39 weak, Laopo=20.6 very_weak unchanged. Phase 12 fixtures must also pass — see integration suite.

---

## Commit 4 — Pattern 1: neutral DM with 食傷 透干 → 食傷洩秀

**Problem**: `_detect_dominant_imbalance` lumps `neutral` into the weak branch and prescribes 印 to "fix" 食傷旺. For neutral DM, 食傷 is the natural creative outlet (洩秀). 4 charts: `liang_chengxiang`, `shen_lufen`, `qin_longtu`, `dts_hezhi_long_ji_dm`.

**Doctrinal source**: 《子平真詮·論食神》「食神生財，美格也」+ 「藏食露傷，主人性剛，如丁亥、癸卯、癸卯、甲寅，沈路分命是也」. 2 of 4 affected charts are sénè孝瞻's named 命例.

**Why this commit comes AFTER 2c/2a/2b** (S4.2 fix): Pattern 1 triggers only when V2 classification ∈ {`neutral`, `strong`}. Charts `shen_lufen` (V2=34.1 weak), `qin_longtu` (V2=39.9 weak), and `long_ji_dm` (V2=44.2 neutral) need V2 fixes first — Pattern 2c/2a may push the borderline ones above 40.

### Files modified
- `packages/bazi-engine/app/five_elements.py` (module-level flag + `_detect_dominant_imbalance` + `determine_favorable_gods`)
- `packages/bazi-engine/app/ten_gods.py` (helper)
- `packages/bazi-engine/tests/test_phase_12d_pattern_1.py` (NEW)

### Implementation

**1-1 — Module-level flag** in `five_elements.py:43` alongside `_USE_WEIGHTED_IMBALANCE`:
```python
_PATTERN_1_NEUTRAL_BRANCH: bool = os.environ.get(
    'PHASE_12D_PATTERN_1_NEUTRAL_BRANCH', '1'
).lower() in ('1', 'true', 'yes', 'on')
```

**1-2 — Helper** in `ten_gods.py` (after `compute_weighted_category_scores`):
```python
def detect_neutral_shishang_outlet(
    pillars: Dict,
    day_master_stem: str,
    strength_classification: str,
) -> Optional[str]:
    """
    Pattern 1: For neutral/strong DM with 食傷 透干, the chart's natural
    outlet is 食傷洩秀 (or 食神生財 if 財 also 透干 + rooted).

    Returns:
      '食神生財'   — 食傷 透干 ≥1 AND 財 透干 ≥1 with 財 weighted ≥ 2.0
      '食傷洩秀'   — 食傷 透干 ≥1 (or 月令本氣司令) alone, no qualifying 財
      None         — Pattern 1 doesn't apply (incl. 梟印奪食 cancellation)

    Source: 《子平真詮·論食神》, Phase A doctrine verification.
    """
    if strength_classification not in ('neutral', 'strong'):
        return None

    scores = compute_weighted_category_scores(pillars, day_master_stem)
    cats = scores['categories']
    transp = scores['category_transparent_count']
    month_benqi = scores['category_month_benqi']

    shishang_w = cats.get('食傷', 0.0)
    cai_w = cats.get('財星', 0.0)
    bijie_w = cats.get('比劫', 0.0)
    yinxing_w = cats.get('印星', 0.0)

    shishang_transp = transp.get('食傷', 0)
    cai_transp = transp.get('財星', 0)
    yinxing_transp = transp.get('印星', 0)

    # Trigger 1: 食傷 carrier (透干 OR 月令本氣司令)
    has_shishang_carrier = (shishang_transp >= 1
                            or month_benqi.get('食傷', False))
    if not has_shishang_carrier:
        return None

    # 梟印奪食 cancellation: 印 透干 ≥1 with 印 weighted ≥ 食傷×0.8
    if yinxing_transp >= 1 and yinxing_w >= shishang_w * 0.8:
        return None

    # 食傷 must be heaviest among draining categories (with -1.0 tolerance)
    if shishang_w < max(cai_w, bijie_w) - 1.0:
        return None

    # 食神生財 chain: 財 透干 AND rooted (weighted >= 2.0)
    if cai_transp >= 1 and cai_w >= 2.0:
        return '食神生財'
    return '食傷洩秀'
```

**1-3 — Modify `_detect_dominant_imbalance`** in `five_elements.py:445`. Insert at the very start (before any existing branch):

```python
# Phase 12d Pattern 1: neutral DM with 食傷 透干 → 食傷洩秀 dominant
if (_PATTERN_1_NEUTRAL_BRANCH
    and pillars is not None
    and day_master_stem is not None
    and strength in ('neutral', 'strong')
    and not is_cong_ge):
    from .ten_gods import detect_neutral_shishang_outlet
    outlet = detect_neutral_shishang_outlet(
        pillars, day_master_stem, strength)
    if outlet == '食神生財':
        return '財旺'  # neutral-DM 財旺 path; new branch in determine_favorable_gods
    if outlet == '食傷洩秀':
        return '食傷洩秀'  # NEW dominant label
```

**1-4 — Add new branches in `determine_favorable_gods`** in `five_elements.py:518` (S7.5 / S7.6 fix).

The existing `weak / strong` branches at lines 588-616 don't handle:
- `dominant='食傷洩秀'` (any strength)
- `dominant='財旺'` for `strength='neutral'` (the food→wealth chain)

**Replace** the current strong/weak switch with:
```python
# Phase 12d: 食傷洩秀 path (neutral OR strong DM with 食傷 outlet)
if dominant == '食傷洩秀':
    useful = i_produce        # 食傷
    favorable = i_overcome    # 財 (chain target)
    taboo = produces_me       # 印 (kills 食傷)
    enemy = dm_element        # 比劫 (no outlet)
elif strength in ('strong', 'very_strong'):
    if dominant == '比劫旺':
        useful = overcomes_me; favorable = i_overcome
    elif dominant == '官殺旺':
        useful = i_produce; favorable = i_overcome
    else:  # 印旺 / general / 財旺
        useful = i_overcome; favorable = i_produce
    taboo = dm_element
    enemy = produces_me
elif strength == 'neutral' and dominant == '財旺':
    # N3 fix (v2.1): scope narrowed to ONLY this case per Phase C feedback.
    # All other neutral cases fall through to the unchanged weak-path else
    # below, preserving pre-Phase-12d baseline (S7.5 ask is satisfied here
    # by the single 食神生財 chain branch; neutral-general / 官殺旺 / 食傷旺
    # are deliberately NOT modified to avoid silent baseline drift).
    useful = i_overcome       # 財
    favorable = i_produce     # 食傷
    taboo = dm_element        # 比劫 (敵財)
    enemy = produces_me       # 印 (kills 食傷)
else:
    # weak / very_weak / neutral-not-財旺 (existing logic unchanged)
    if dominant in ('食傷旺', '官殺旺'):
        useful = produces_me; favorable = dm_element
    else:  # 財旺-weak / general
        useful = dm_element; favorable = produces_me
    taboo = overcomes_me
    enemy = i_overcome
```

**1-5 — Update docstring** in `_detect_dominant_imbalance` (S5.2): add `'食傷洩秀'` to the return enum docstring.

**1-6 — Tests** in `tests/test_phase_12d_pattern_1.py`:

| Test | Chart | Expected |
|---|---|---|
| `test_neutral_dm_shishang_transparent_picks_shishang` | `liang_chengxiang` (post 2c+2a re-baseline → neutral) | dominant=食傷洩秀, 用=金 |
| `test_neutral_dm_shensheng_chain_picks_cai` | synthetic 食傷+財 both 透干 + neutral | dominant=財旺, 用=財, 喜=食傷 (S7.5 verification) |
| `test_xiao_yin_duo_shi_cancels_outlet` | 印 透干 with weight ≥食傷×0.8 | Pattern 1 returns None |
| `test_weak_dm_shishang_unchanged` | weak DM + 食傷 透干 | engine doctrine unchanged (用=印) |
| `test_neutral_general_baseline_preserved` | neutral DM, dominant=general | useful=dm_element, 喜=produces_me — UNCHANGED from pre-Phase-12d (N3 guard) |
| `test_pattern_1_disabled_when_flag_off` | monkeypatch | unchanged |
| 4 anchor regression tests | `liang_chengxiang`, `shen_lufen`, `qin_longtu`, `long_ji_dm` (all post-Phase-2 V2) | each flips to corpus 用神 |
| `test_anchor_roger_unchanged` | Roger | weak — Pattern 1 doesn't fire |
| `test_anchor_laopo_unchanged` | Laopo | very_weak — Pattern 1 doesn't fire |

**1-7 — Harness**: agreement ~64% → ~72% (assuming Pattern 2c+2a raise borderline V2 charts to neutral).

### Risks
- **5-god distinctness invariant**: When `dominant='食傷洩秀'`, the 4 explicit gods are {i_produce, i_overcome, produces_me, dm_element} — all distinct (because 5-element relations form a 5-cycle). The 閒神 (idle) auto-derives from `overcomes_me`. ✓ Invariant holds. Add `test_five_gods_distinct_for_shishang_xieshu`.
- **Cascade with Phase 12 Fix 1a**: Pattern 1 sits at the top of `_detect_dominant_imbalance`. When `_USE_WEIGHTED_IMBALANCE` is also on, the existing weighted path is reached only when Pattern 1 doesn't fire. Order verified.

---

## Commit 5 — Pattern 3b: 真化 stem suppression in 從格 stem counting

**Problem**: `check_cong_ge` counts every 印/比劫 stem literally. For `anchor_cong_cai_yiwuming` (庚申 乙酉 丙申 己丑), 乙+庚 form 乙庚化金 真化 — 乙 should NOT count as 印 blocker.

**Doctrinal source**: 《滴天髓·化象》+ Phase 12b Fix D's verbatim 4-condition 真化 gate.

**Refined per Phase A**: re-use Phase 12b Fix D conditions (S6.1 alignment fix); subtract count by 1 per transformed stem (NOT zero out — 「化而不化者，藏其性」). Plus DM-involved-五合 guard (S2.3 fix).

### Files modified
- `packages/bazi-engine/app/stem_combinations.py` (new helper)
- `packages/bazi-engine/app/interpretation_rules.py` (`check_cong_ge` modifications)
- `packages/bazi-engine/tests/test_phase_12d_pattern_3b.py` (NEW)

### Implementation

**3b-1 — New helper** `detect_true_transformed_stems()` in `stem_combinations.py`. Aligned with Phase 12b Fix D `_fix_d_check_liu_he` doctrine (S6.1: use `SEASON_MULTIPLIER >= 1.5` for strict 旺 to match Fix D, NOT looser `SEASON_STRENGTH >= 4`):

```python
def detect_true_transformed_stems(
    pillars: Dict[str, Dict],
    day_master_stem: str,
) -> Dict[Tuple[str, str], str]:
    """
    Detect 五合 stem pairs meeting 真化 conditions (mirrors Phase 12b Fix D).

    Conditions (all must hold):
      (i)   Adjacent pillars (year-month, month-day, day-hour).
      (ii)  化神 strict 旺 in month branch:
            SEASON_MULTIPLIER[化神_element][month_branch] >= 1.5
            (this is exactly Fix D's condition iv, NOT the looser ">=4 score").
      (iii) 化神 has root: ≥1 branch contains 化神 element as 本氣 OR 中氣.
      (iv)  No 沖 disrupting either combining stem's pillar branch
            (uses CLASH_LOOKUP — S7.1 fix).
      (v)   No 克 element to 化神 with strong root in chart.

    Returns: {(pillar_name, stem): formed_element} for each transformed stem.

    Source: 《滴天髓·化象》, Phase 12b Fix D, Phase A doctrine verification.
    """
    from .constants import (
        SEASON_STRENGTH, SEASON_MULTIPLIER,
        STEM_ELEMENT, BRANCH_ELEMENT,
        HIDDEN_STEMS, ELEMENT_OVERCOME_BY,
    )
    from .branch_relationships import CLASH_LOOKUP  # S7.1 fix

    transformed: Dict[Tuple[str, str], str] = {}
    month_branch = pillars['month']['branch']

    for p1, p2 in ADJACENT_PILLAR_PAIRS:
        s1 = pillars[p1]['stem']
        s2 = pillars[p2]['stem']
        if s2 not in STEM_COMBINATION_LOOKUP:
            continue
        partner, formed_el, _ = STEM_COMBINATION_LOOKUP[s2]
        if partner != s1:
            continue

        # (ii) 化神 strict 旺 (Fix D condition; S6.1 alignment).
        # N1 fix (v2.1): SEASON_MULTIPLIER is Dict[int, float] keyed by 1-5
        # season-strength score, NOT Dict[str, Dict[str, float]]. Look up
        # the score from SEASON_STRENGTH first, then the multiplier.
        season_score = SEASON_STRENGTH.get(formed_el, {}).get(month_branch, 3)
        if SEASON_MULTIPLIER.get(season_score, 1.0) < 1.5:
            continue

        # (iii) 化神 has root (本氣 or 中氣)
        has_root = False
        for pp in ('year', 'month', 'day', 'hour'):
            branch = pillars[pp]['branch']
            hidden = HIDDEN_STEMS.get(branch, [])
            if (len(hidden) >= 1 and STEM_ELEMENT.get(hidden[0]) == formed_el):
                has_root = True
                break
            if (len(hidden) >= 2 and STEM_ELEMENT.get(hidden[1]) == formed_el):
                has_root = True
                break
        if not has_root:
            continue

        # (iv) No 沖 on either combining branch (S7.1 fix: CLASH_LOOKUP)
        b1, b2 = pillars[p1]['branch'], pillars[p2]['branch']
        all_branches = [pillars[p]['branch']
                        for p in ('year', 'month', 'day', 'hour')]
        if (CLASH_LOOKUP.get(b1) in all_branches
            or CLASH_LOOKUP.get(b2) in all_branches):
            continue

        # (v) No 克 element to 化神 with strong root
        breaker_el = ELEMENT_OVERCOME_BY.get(formed_el, '')
        breaker_strong = False
        for pp in ('year', 'month', 'day', 'hour'):
            stem = pillars[pp]['stem']
            if STEM_ELEMENT.get(stem) != breaker_el:
                continue
            for pp2 in ('year', 'month', 'day', 'hour'):
                branch = pillars[pp2]['branch']
                hidden = HIDDEN_STEMS.get(branch, [])
                if (len(hidden) >= 1
                    and STEM_ELEMENT.get(hidden[0]) == breaker_el):
                    breaker_strong = True
                    break
            if breaker_strong:
                break
        if breaker_strong:
            continue

        # All conditions met — both stems transform
        transformed[(p1, s1)] = formed_el
        transformed[(p2, s2)] = formed_el

    return transformed
```

**3b-2 — Module-level flag** in `interpretation_rules.py`:
```python
_PATTERN_3B_HUAQI_SUPPRESSION: bool = os.environ.get(
    'PHASE_12D_PATTERN_3B_HUAQI_SUPPRESSION', '1'
).lower() in ('1', 'true', 'yes', 'on')
```

**3b-3 — Modify `check_cong_ge`** in `interpretation_rules.py:208`. Add guards at top + modify `has_yin_bijie` counting:

```python
def check_cong_ge(
    pillars: Dict,
    day_master_stem: str,
    strength_v2: Dict,
    five_elements_balance: Dict[str, float],
) -> Optional[Dict]:
    # ... existing setup ...

    # Phase 12d Pattern 3b: detect 真化 transformed stems
    transformed_stems: Dict[Tuple[str, str], str] = {}
    if _PATTERN_3B_HUAQI_SUPPRESSION:
        from .stem_combinations import detect_true_transformed_stems
        transformed_stems = detect_true_transformed_stems(
            pillars, day_master_stem)

        # S2.3 fix: DM-involved 五合 → 從格 ambiguous; do not fire.
        if any(s == day_master_stem for (_, s) in transformed_stems):
            return None

    score = strength_v2['score']

    # 從格 requires very weak Day Master
    if score >= 35:
        return None

    # ... existing has_root counting ...

    # Modified has_yin_bijie counting with Pattern 3b suppression
    has_yin_bijie = False
    yin_bijie_count = 0
    for pillar_name in ['year', 'month', 'day', 'hour']:
        pillar = pillars[pillar_name]
        if pillar_name != 'day':
            stem = pillar['stem']
            # Pattern 3b: skip transformed stems (subtract by 1 effect)
            if (pillar_name, stem) in transformed_stems:
                continue
            el = STEM_ELEMENT[stem]
            if el == dm_element or el == producing_element:
                has_yin_bijie = True
                yin_bijie_count += 1
        # Branch hidden stems — branches don't transform; unchanged
        for hs in HIDDEN_STEMS.get(pillar['branch'], []):
            el = STEM_ELEMENT[hs]
            if el == dm_element or el == producing_element:
                has_yin_bijie = True
                yin_bijie_count += 1

    # ... rest unchanged ...
```

**3b-4 — Tests** in `tests/test_phase_12d_pattern_3b.py`:
| Test | Chart | Expected |
|---|---|---|
| `test_yiwuming_cong_cai_fires_after_huaqi` | 庚申 乙酉 丙申 己丑 | `check_cong_ge` returns 從財 (was None) |
| `test_huaqi_no_root_no_suppression` | synthetic 乙庚 + month=卯 (木) | 化金 lacks 月令; 乙 still counts |
| `test_huaqi_with_chong_no_suppression` | 乙庚 + 卯酉沖 elsewhere | 真化 fails (iv); 乙 still counts |
| `test_breaker_blocks_huaqi` | 乙庚 + 月令酉 + 丁火 強根 | 火克金; 真化 fails (v) |
| `test_dm_involved_huaqi_returns_none` | 丙辛 with 丙=DM, met all conditions | `check_cong_ge` returns None (S2.3 verification) |
| `test_pattern_3b_disabled_when_flag_off` | monkeypatch | unchanged |
| `test_anchor_roger_unchanged` | Roger (no adjacent 五合 pairs) | unchanged |
| `test_anchor_laopo_unchanged` | Laopo (丙辛 adjacent but month=丑 fails 化水 旺 check) | unchanged |

**3b-5 — Harness**: agreement ~72% → ~74%.

### Risks
- **Phase 12b Fix D 對齊**: Pattern 3b's gate condition (ii) now uses `SEASON_MULTIPLIER >= 1.5` matching Fix D exactly (S6.1 fix). The two paths share doctrine but operate on different element types (Fix D = 六合 branches; Pattern 3b = 五合 stems) — kept as separate functions intentionally.
- **DM-involved 五合**: S2.3 guard prevents 從格 from firing on charts where DM itself transforms. Tested explicitly.

---

## Commit 6 — Pattern 3a: 從強/從旺/一行得氣 detector (FLAG-OFF DEFAULT)

**Problem**: `check_cong_ge` only handles 從弱 family. `ziping_wu_xianggong_qu_zhi` (癸亥 乙卯 乙未 壬午 = 曲直格) misses detection.

**Doctrinal source**: 《滴天髓·形象》「木日，或方或局全，不雜金為曲直」+ 《滴天髓·順反》distinguishes 從旺/從強/一行得氣.

**Refined per Phase A**: V2≥70 (not 75); 比劫+印 combined ≥70% (not 比劫 alone ≥60%); explicit breaker table; sub-name lookup for 5 一行得氣 sub-types (S1.4 nice-to-have included).

**Highest risk; ship flag-OFF default.**

### Files modified
- `packages/bazi-engine/app/constants.py`
- `packages/bazi-engine/app/interpretation_rules.py` (new function + override block extension for `xiShen` propagation per S6.2 fix)
- `packages/bazi-engine/tests/test_phase_12d_pattern_3a.py` (NEW)

### Implementation

**3a-1 — Constants**:
```python
# Phase 12d Pattern 3a — 從強/從旺/一行得氣 detector.
PATTERN_3A_V2_FLOOR: float = 70.0
PATTERN_3A_DOMINANT_PCT_FLOOR: float = 70.0     # (比劫+印)/total ≥
PATTERN_3A_YIN_WEIGHT_THRESHOLD: float = 4.0    # 從強 vs 從旺 discriminator
PATTERN_3A_BREAKER_STRONG_ROOT: float = 3.0     # 官殺/財 透干 強根 threshold

# 一行得氣 sub-name lookup by DM element (S1.4 nice-to-have)
YI_XING_DE_QI_SUB_NAMES: Dict[str, str] = {
    '木': '曲直格',
    '火': '炎上格',
    '土': '稼穡格',
    '金': '從革格',
    '水': '潤下格',
}
```

**3a-2 — Module-level flag** (default OFF):
```python
_PATTERN_3A_CONG_QIANG_DETECTOR: bool = os.environ.get(
    'PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR', '0'  # default OFF
).lower() in ('1', 'true', 'yes', 'on')
```

**3a-3 — New function** in `interpretation_rules.py`:
```python
def check_cong_qiang_or_wang(
    pillars: Dict,
    day_master_stem: str,
    strength_v2: Dict,
    weighted_categories: Dict[str, float],
    weighted_transparent: Dict[str, int],
) -> Optional[Dict]:
    """
    Phase 12d Pattern 3a: detect 從強 / 從旺 / 一行得氣 patterns.

    Distinct from `check_cong_ge` (which handles 從弱 family — 從財/官/兒/勢).

    Triggers (ALL must hold):
      (i)   V2 score ≥ 70
      (ii)  (比劫+印) weighted / total weighted ≥ 70%
      (iii) No 官殺 透干 with weighted ≥ 3.0
      (iv)  For 從旺/一行得氣: no 財 透干 with weighted ≥ 3.0

    Sub-type:
      - 印 weighted ≥ 4.0 → 從強格 (用=DM元素, 喜=印)
      - else → 從旺/一行得氣 (用=DM元素, 喜=食傷)
        and labeled with 一行得氣 name from YI_XING_DE_QI_SUB_NAMES.

    Returns: dict with keys (type, name, dominantElement, yongShen,
    xiShen, jiShen, idleGod, dmAsYongShen, significance) — all 5 gods
    populated to satisfy invariant (S6.2 / S7.6 fix).
    """
    if strength_v2['score'] < PATTERN_3A_V2_FLOOR:
        return None

    bijie = weighted_categories.get('比劫', 0.0)
    yin = weighted_categories.get('印星', 0.0)
    cai = weighted_categories.get('財星', 0.0)
    guan = weighted_categories.get('官殺', 0.0)
    shishang = weighted_categories.get('食傷', 0.0)
    total = bijie + yin + cai + guan + shishang
    if total == 0:
        return None

    combined_pct = (bijie + yin) / total * 100
    if combined_pct < PATTERN_3A_DOMINANT_PCT_FLOOR:
        return None

    # Breaker: 官殺 透干 強根
    if (weighted_transparent.get('官殺', 0) >= 1
        and guan >= PATTERN_3A_BREAKER_STRONG_ROOT):
        return None

    dm_element = STEM_ELEMENT[day_master_stem]
    producing = ELEMENT_PRODUCED_BY[dm_element]
    i_produce = ELEMENT_PRODUCES[dm_element]
    i_overcome = ELEMENT_OVERCOMES[dm_element]
    overcomes_me = ELEMENT_OVERCOME_BY[dm_element]

    if yin >= PATTERN_3A_YIN_WEIGHT_THRESHOLD:
        # 從強格: DM is 用神, 印 is 喜神, 財/官 are jealous
        return {
            'type': 'cong_qiang',
            'name': '從強格',
            'dominantElement': dm_element,
            'description': '日主極旺，順從比劫印星',
            'yongShen': dm_element,
            'xiShen': producing,        # 印
            'jiShen': [i_overcome, overcomes_me],  # 財, 官殺
            'idleGod': i_produce,        # 食傷 (閒)
            'dmAsYongShen': True,        # S7.6 marker for override block
            'significance': 'critical',
        }
    else:
        # 從旺 / 一行得氣: 財 透干 強根 also blocks
        if (weighted_transparent.get('財星', 0) >= 1
            and cai >= PATTERN_3A_BREAKER_STRONG_ROOT):
            return None
        sub_name = YI_XING_DE_QI_SUB_NAMES.get(dm_element, '從旺格')
        return {
            'type': 'cong_wang',
            'name': sub_name,
            'dominantElement': dm_element,
            'description': '日主旺極，從其旺勢，喜食傷洩秀',
            'yongShen': dm_element,
            'xiShen': i_produce,        # 食傷
            'jiShen': [i_overcome, overcomes_me],  # 財, 官殺
            'idleGod': producing,        # 印 (閒)
            'dmAsYongShen': True,
            'significance': 'critical',
        }
```

**3a-4 — Wire into `generate_pre_analysis`** (`interpretation_rules.py:950`). After `check_cong_ge` returns None:
```python
cong_ge = check_cong_ge(pillars, day_master_stem, strength_v2,
                       five_elements_balance)

# Phase 12d Pattern 3a (flag-off default)
if cong_ge is None and _PATTERN_3A_CONG_QIANG_DETECTOR:
    from .ten_gods import compute_weighted_category_scores
    scores = compute_weighted_category_scores(pillars, day_master_stem)
    cong_ge = check_cong_qiang_or_wang(
        pillars, day_master_stem, strength_v2,
        scores['categories'], scores['category_transparent_count'])
```

**3a-5 — S6.2 / S7.6 fix: extend `effective_gods` override block** in `interpretation_rules.py:957-963`. Existing block (verified at line 957):
```python
if cong_ge:
    effective_gods = {
        'favorableGod': cong_ge['yongShen'],
        'usefulGod': cong_ge['yongShen'],
        'idleGod': ELEMENT_PRODUCES[cong_ge['yongShen']],
        # ... tabooGod, enemyGod hardcoded for 從弱 family
    }
```

**Replace** with:
```python
if cong_ge:
    if cong_ge.get('dmAsYongShen', False):
        # 從強/從旺 family (Pattern 3a): DM is 用神, distinct 喜神.
        # All 5 gods are distinct by construction.
        effective_gods = {
            'usefulGod':    cong_ge['yongShen'],
            'favorableGod': cong_ge.get('xiShen',
                            ELEMENT_PRODUCES[cong_ge['yongShen']]),
            'idleGod':      cong_ge.get('idleGod',
                            ELEMENT_PRODUCES[cong_ge['yongShen']]),
            'tabooGod':     cong_ge['jiShen'][0],   # 財 (for 從強/從旺)
            'enemyGod':     cong_ge['jiShen'][1] if len(cong_ge['jiShen']) > 1
                            else cong_ge['jiShen'][0],
        }
        # N2 fix (v2.1): invariant ONLY for 從強/從旺 family.
        _assert_five_gods_distinct(effective_gods)
    else:
        # 從弱 family preserves legacy 4-distinct shape
        # (usefulGod == favorableGod by doctrine — 用神=喜神=順從元素).
        # The 5-god distinctness invariant does NOT apply here.
        effective_gods = {
            'usefulGod':    cong_ge['yongShen'],
            'favorableGod': cong_ge['yongShen'],
            'idleGod':      ELEMENT_PRODUCES[cong_ge['yongShen']],
            'tabooGod':     cong_ge['jiShen'][0],
            'enemyGod':     cong_ge['jiShen'][1] if len(cong_ge['jiShen']) > 1
                            else cong_ge['jiShen'][0],
        }
```

The 5-god distinctness invariant helper:
```python
def _assert_five_gods_distinct(eg: Dict) -> None:
    """Phase 12d invariant: all 5 effective gods must be distinct elements.

    SCOPED to 從強/從旺 family only (where DM IS 用神 and 4-element-distinct
    is doctrinally required). Existing 從弱 family deliberately preserves
    the legacy `usefulGod == favorableGod` shape — DO NOT call this from
    that branch.
    """
    keys = ('usefulGod', 'favorableGod', 'idleGod', 'tabooGod', 'enemyGod')
    elements = [eg[k] for k in keys]
    if len(set(elements)) != 5:
        raise AssertionError(
            f'effective_gods invariant violated: {dict(zip(keys, elements))}')
```

**3a-6 — Tests**:
| Test | Chart | Expected |
|---|---|---|
| `test_quzhi_ge_detected` | 癸亥 乙卯 乙未 壬午 | name='曲直格', yongShen=木, xiShen=火 |
| `test_v2_below_70_no_fire` | V2=65 + combined=75% | None |
| `test_combined_pct_below_70_no_fire` | V2=72 + combined=65% | None |
| `test_official_breaker_blocks` | V2=75 + 官殺 透干 強根 | None |
| `test_cai_breaker_blocks_cong_wang_only` | V2=75 + 財 透干 強根, 印<4 | None for 從旺; tested separately for 從強 |
| `test_cong_qiang_xishen_propagated` | 從強格 with 印≥4 | effective_gods: usefulGod=DM, favorableGod=印 (S6.2 verification) |
| `test_five_gods_distinct_for_cong_qiang_wang` | every 從強/從旺 fixture | invariant holds (5 distinct elements) — N2-scoped per v2.1 |
| `test_cong_ruo_preserves_legacy_4_distinct` | every 從財/從官/從兒/從勢 fixture | `usefulGod == favorableGod` preserved; assertion NOT called (regression guard) |
| `test_pattern_3a_disabled_when_flag_off` | 曲直 chart with flag=False | None (default behavior) |
| `test_anchor_roger_unchanged` | Roger V2=39 < 70 | None |
| `test_anchor_laopo_unchanged` | Laopo V2=20 < 70 | None |

**3a-7 — Harness with flag=on**: agreement ~74% → ~76%.

### Risks
- **HIGHEST**: borderline 從強/從旺 vs normal strong charts is a doctrinal grey zone. Ship flag-OFF default. Quarterly re-run + Bazi-master review before flipping.
- **5-god invariant**: explicit assertion catches regressions where 從強's `dm_element` equals one of `jiShen[0..1]` (impossible by construction — DM element ≠ 財 nor 官殺).

---

## Cross-pattern integration tests (S3.1 fix)

NEW file `packages/bazi-engine/tests/test_phase_12d_integration.py`:

| Test | Chart | Patterns exercised | Expected |
|---|---|---|---|
| `test_2c_2a_compose` | `dts_hezhi_noble3` | 2c (酉丑半合 dedi) + 2a (no fire) | dedi rises but no Pattern 1 trigger (still weak) |
| `test_2c_2a_2b_compose` | synthetic chart triggering all 3 | full V2 cascade | total V2 reflects all 3 adjustments |
| `test_2_then_1_long_ji_dm` | `dts_hezhi_long_ji_dm` (V2=44.2 neutral) | 2 raises noble3-like to neutral; 1 fires | dominant=食傷洩秀, 用=金 |
| `test_3b_then_3a_combined` | synthetic 真化-suppressing chart that also qualifies for 3a | 3b first; 3a evaluates post-suppression | 3a fires correctly |
| `test_all_six_patterns_together` | full corpus regression | all flags ON (3a=ON for this test) | agreement ≥ 76%, 0 anchor regressions |
| `test_all_flags_off_reproduces_baseline` (S5.1 nice-to-have) | full corpus | all 6 flags OFF | byte-identical output to pre-Phase-12d main |
| `test_pattern_1_with_cong_ge_safety` | 從格 chart | Pattern 1 doesn't override 從格 path | Pattern 1 returns None when is_cong_ge=True (already coded; explicit test) |
| `test_pattern_3b_after_pattern_3a_check` | DM-involved 五合 + V2 ≥ 70 | both detectors return None | 從格 not fired |

---

## Cross-cutting concerns

### 1. CLAUDE.md doctrinal-split documentation

After all 6 commits land, append to CLAUDE.md under "八字終身運 Calculation Accuracy":

```markdown
### Accepted doctrinal ambiguities (Phase 12d)

The validation harness identified 11 charts where 子平真詮, 滴天髓, 窮通寶鑑 prescribe different 用神 for the same chart. These are NOT bugs — they reflect genuine school disagreement. Engine emits its own school's verdict:

1. **印旺身強**: 真詮 picks 食傷洩秀; 滴天髓 picks 財制印. Engine: 財制印 (default).
2. **財旺弱身**: 真詮 picks 印 (財格佩印); engine picks 比劫 (敵財).
3. **食神生財 / 並用財印**: 真詮 picks 食傷 or 財; engine picks 比劫 (default-weak-general).
4. **比劫旺極**: 滴天髓 picks 食傷洩秀; 真詮 picks 官殺. Engine: 官殺 (default).
5. **調候 vs 病藥** (summer 壬, winter 甲, etc.): 窮通寶鑑 picks 調候; engine picks 病藥. 調候 surfaces as advisory only (Phase 12 Fix 2).

Per-chart references: `.claude/plans/validation_triage_report.md`.
```

### 2. tests/validation/README.md update

Add post-Phase-12d expected agreement section. Recalibrate Gate 1 to "engine-doctrine charts ≥95%, doctrinal splits accepted as either-correct" via the `--accept-doctrinal-splits` CLI flag.

### 3. Per-commit harness re-run protocol (rollback gate per S3.4)

After each commit:
1. Run `python tests/validation/run_imbalance_validation.py`. Capture agreement %.
2. Verify the SPECIFIC affected chart(s) for that commit flipped.
3. Verify NO previously-passing chart flipped to failing — if any does, **REVERT the commit** before proceeding (rollback gate).
4. Append run output to `.claude/plans/validation_phase_12d_runs.md` with heading per commit.

### 4. Cache invalidation

Bump `preAnalysisVersion` in `apps/api/src/ai/ai.service.ts` after Phase 12d lands:
- LIFETIME: v2.4.0 → v2.5.0
- CAREER: v2.2.0 → v2.3.0
- ANNUAL: v2.0.0 → v2.1.0

Operator runs `redis-cli FLUSHALL` post-deploy. The plan's prior "DELETE FROM reading_cache" claim was inaccurate (S2.2 fix); the standard rollout is FLUSHALL-only.

### 5. Backward compatibility (explicit)

All 6 module flags default ON except 3a default OFF. With all 6 flags=False AND `BAZI_USE_WEIGHTED_IMBALANCE=False`, engine output must reproduce pre-Phase-12d byte-identical. Test `test_all_flags_off_reproduces_baseline` (above) enforces this.

### 6. Out of scope (Phase 12e)

- Pattern 3a default flag-flip (requires Bazi-master review + ≥6 months production data)
- 強者宜剋 vs 強者宜洩 toggle for 比劫旺極
- 食神制殺 alternate path for 殺旺+weak DM
- 調候 promotion to 用神 (currently advisory)
- 三會 (e.g. 寅卯辰) DM-element credit
- 真詮 mode flag for 印旺身強 alternate doctrine

These are NOT bugs — they're school-conditional toggles benefiting from a stable Phase 12d baseline first.

---

## Risk summary

| Pattern | Risk | Default | Mitigation |
|---|---|---|---|
| 2c | Low | ON | V2 dedi capped at 30; element-vs-element double-count guard |
| 2a/2a' | Low-Mod | ON | Rooted-stem requirement (S6.3); explicit Roger/Laopo regression |
| 2b | Mod | ON | Narrow 4-condition trigger; 官殺 透干 required |
| 1 | Low | ON | Doctrine canonical; named 命例 confirm; depends on V2 fixes (commit order) |
| 3b | Mod | ON | Phase 12b Fix D 真化 conditions verbatim; subtract by 1 (not zero); DM-involved guard |
| 3a | High | **OFF** | Flag-OFF default; quarterly re-baseline; explicit 5-god invariant |

## Test count delta

Pre-Phase-12d: 1914 (1912 pass, 1 skip, 1 pre-existing fail)

| Commit | Tests added |
|---|---|
| 2c | 7 |
| 2a | 8 |
| 2b | 6 |
| 1 | 11 |
| 3b | 8 |
| 3a | 10 |
| Integration | 8 |
| **Total** | **+58** |

Post-Phase-12d: ~1972 tests (1970 pass, 1 skip, 1 pre-existing fail).

## Reviewer change tracking (for Phase D)

This v2 plan addresses every Phase C MUST-change item:
- ✓ S7.1 — `SIX_OPPOSITIONS` → `CLASH_LOOKUP` (2 locations: Pattern 2c §2c-3, Pattern 3b §3b-1)
- ✓ S7.2 — `IMBALANCE_*` from `ten_gods.py` (Pattern 2b §2b-2 helper imports)
- ✓ S7.3 — `HIDDEN_STEMS` import added to `branch_relationships.py` (Pattern 2c §2c-3 imports)
- ✓ S7.4 — Pattern 2c double-count guard fixed (element-vs-element comparison)
- ✓ S7.5 — Pattern 1's neutral-DM `'財旺'` branch added in `determine_favorable_gods` (§1-4)
- ✓ S7.6 / S6.2 — Pattern 3a `xiShen` propagation + `dmAsYongShen` flag + override block extension (§3a-3, §3a-5)
- ✓ S7.7 — `import os` added to `interpretation_rules.py` (§2c-1)
- ✓ S4.2 — Commit order reversed: 2c → 2a → 2b → 1 → 3b → 3a; per-commit projections updated
- ✓ S6.3 — Pattern 2a rooted-比劫 filter implemented (§2a-2 helper uses `_build_root_class_cache`)
- ✓ S6.1 — Pattern 3b 真化 condition (ii) aligned with Fix D (`SEASON_MULTIPLIER >= 1.5`, not `>= 4 score`)

And the practical/sensible SHOULD items:
- ✓ S1.2 — Module-level `_PATTERN_*` constants (mirrors `_USE_WEIGHTED_IMBALANCE`)
- ✓ S1.4 — `YI_XING_DE_QI_SUB_NAMES` lookup added in Pattern 3a
- ✓ S2.1 — Per-flag default table at top
- ✓ S2.2 — Cache invalidation corrected (FLUSHALL only)
- ✓ S2.3 — DM-involved 五合 guard added in Pattern 3b
- ✓ S2.4 — Per-commit agreement projections updated
- ✓ S3.1 — `test_phase_12d_integration.py` added
- ✓ S3.4 — Rollback gate codified
- ✓ S5.1 — `test_all_flags_off_reproduces_baseline` added
- ✓ S5.2 — Docstring update for new dominant label

Items deferred to v2 follow-up plan (these are nice-to-haves, not blockers):
- S3.2 — `BAZI_USE_WEIGHTED_IMBALANCE=0` × Pattern 1 cross-test: handled by `test_all_flags_off_reproduces_baseline` + integration test mix; explicit "weighted off + 12d on" matrix can be added later if needed
- S3.3 — Test count math reconciled (now 58 not 32+1)

v2.1 erratum (Phase D feedback):
- ✓ N1 — Pattern 3b `SEASON_MULTIPLIER` lookup fixed (score-then-multiplier; ref `_fix_d_check_liu_he` has same pre-existing bug, out of v2.1 scope per reviewer note)
- ✓ N2 — `_assert_five_gods_distinct` scoped to `dmAsYongShen=True` only; new `test_cong_ruo_preserves_legacy_4_distinct` regression guard added
- ✓ N3 — Neutral-DM block narrowed to `elif strength == 'neutral' and dominant == '財旺':`; new `test_neutral_general_baseline_preserved` regression guard added
- ✓ N4 — Test renamed `test_five_gods_distinct_for_cong_qiang_wang` (scoped) per reviewer's documentation-of-intent recommendation

Ready for Phase D final approval.
