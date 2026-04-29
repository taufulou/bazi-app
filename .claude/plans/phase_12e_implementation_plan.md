# Phase 12e Implementation Plan v2.1 — close the validation gate

**Origin**: After Phase 12d, 3 engine bugs remain. v1 of this plan attempted to fix 2 (`noble3` + `shishang_strong`) via 2 commits. Phase C staff-engineer review found 22 issues, 5 blockers — most critically:
1. **Roger regression**: Pattern 12e-B fires on Roger (day=午 IS 戊's 帝旺), lifts V2 39→44, breaks calibrated anchor.
2. **noble3 not actually fixed**: Pattern 1's heaviness check rejects noble3 because 食傷 (water) is the thinnest category.
3. **Multiplier flag rollback broken**: 12e-A's flag only gates residual logic, not the constant change.

**v2 strategic decision**:
- **DROP Pattern 12e-A entirely.** Reclassify `dts_hezhi_noble3` as a doctrinal split (食神制殺 vs 印化煞). Phase A's verdict on 12e-A was already "⚠ partially confirmed" with explicit doubts about whether noble3 is genuinely 中和 vs borderline doctrinal. The reviewer's S7.2 finding confirms the fix as designed wouldn't actually fire on the target chart anyway.
- **KEEP Pattern 12e-B** with a `≥2 qualifying branches` guard (was `≥1`). This guard is actually MORE classical-doctrine-aligned per 任鐵樵's 「日支祿+時支羊刃」 doctrine which explicitly requires BOTH conditions, AND preserves Roger by design.

**Goal**: lift 用神 agreement from **66% → 68%** (default, +1 chart) and from **94% → 96%** (`--accept-doctrinal-splits`, +1 chart from `noble3` reclassification + 12e-B fix). The 95% gate clears with the doctrinal-aware policy.

**v1 → v2 changes summary**:
- Two commits → one commit (drop Pattern 12e-A)
- Pattern 12e-B threshold ≥1 → ≥2 qualifying non-month 比劫祿/羊刃 branches (preserves Roger; matches classical 「日支祿+時支羊刃」 doctrine)
- New: noble3 reclassification (CLAUDE.md doctrinal-splits + DOCTRINAL_SPLIT_CHART_IDS)
- Removed: all 半合 multiplier nudges, all `compute_sanhe_dm_credit` modifications, all Pattern 1 weak-band extension logic
- Result: net code complexity drops dramatically; rollback is clean (single flag)

**v2 → v2.1 errata** (3 N-fixes from Phase D re-review, "Approve with changes"):
- **N1**: Drop redundant inline `from .life_stages import get_life_stage` (already imported at module level in `interpretation_rules.py`)
- **N2**: Complete the Phase 12d xfail compat couple trace — full table for all 9 individuals; **discovered Angelababy V2 22.8→32.8 (very_weak→weak) classification flip**, the only material cascade. New mandatory pre-merge test: `test_angelababy_v2_classification_under_12e`. Wong Yibo also fires but his very_strong classification doesn't change.
- **N3**: Rewrite `test_boost_capped_at_20` to use monkeypatched `PATTERN_2A_PP_PER_BRANCH_BOOST=8` so 3-branch chart (24) clamps at 20 — testable cap path instead of unreachable 5-branch-mock

**Source documents** (REQUIRED reading):
- `.claude/plans/phase_12e_doctrine_verification.md` — Phase A verification
- `.claude/plans/phase_12e_review_v1.md` — Phase C review (this v2 addresses every MUST-change item)
- `.claude/plans/validation_triage_report.md` — original triage
- `.claude/plans/validation_diagnostic_dump.txt` — engine reasoning per chart
- `CLAUDE.md` "Phase 12d" section — current state + doctrinal-splits list

---

## Branch + 1-commit structure

Branch: `claude/phase-12e-engine-bugs` (off main, after Phase 12d merges)

Single env flag (extends existing `_PATTERN_2A_BIJIE_BOOST` family):

| Env flag | Default | Description |
|---|---|---|
| `PHASE_12E_PATTERN_2A_PP_NON_MONTH=1` | ON | Pattern 12e-B: non-month 比劫祿/羊刃 boost |

Module-level constant `_PATTERN_2A_PP_NON_MONTH` — set at import; tests monkeypatch.

Plus a non-flag-gated correctness change: add `dts_hezhi_noble3` to `DOCTRINAL_SPLIT_CHART_IDS` and document in CLAUDE.md.

### Per-commit projection

After 12e-B + noble3 reclassification:
- 用神 agreement (default): 66% → 68% (+1 chart, `edge_shishang_strong_jia`)
- 用神 agreement (`--accept-doctrinal-splits`): 94% → 96% (+1 chart from `noble3` now scored as agreement)
- Engine bugs remaining: 1 (`wu_xianggong_qu_zhi`, addressable via Pattern 3a flag flip post-Bazi-master audit)

---

## Commit 1 — Pattern 12e-B: Pattern 2a'' for non-month 比劫祿/羊刃 (with ≥2 guard)

**Problem**: `_pattern_2a_bijie_boost` only checks the MONTH branch for 比劫祿/羊刃 (Pattern 2a'). Charts with 祿/羊刃 in day or hour pillar — common in real users — don't get the boost. Target chart `edge_shishang_strong_jia` (丙寅 甲午 甲寅 丁卯) has day=寅 (DM 祿) + hour=卯 (DM 羊刃) for DM=甲 but month=午 (食傷地). V2 lands `neutral` (49.5) instead of `strong`.

**Doctrinal source** (Phase A verified):
- 任鐵樵 注《滴天髓·天干》: 「甲日干，月令非寅，但日支寅而時支卯，謂之專祿坐刃，身固強矣」
- 《滴天髓·體象》: 「干多不如根重」
- 算準網 羊刃格: 「羊刃在月令為刃格; 在日支為日刃; 在時支為時刃。」 三 positions recognized; combination produces strength.

**Critical doctrine refinement (v2)**: 任's text says "日支寅 AND 時支卯" — the doctrine requires BOTH a 祿/臨官 AND a 羊刃/帝旺 (or two of the relevant positions). A single 帝旺 alone (e.g., Roger's 戊午 = 戊's 帝旺) is NOT classically sufficient — it's "日刃" only, not the strength-amplifying combination. Therefore the rule should require **≥2 qualifying non-month branches**, not ≥1.

This guard:
- ✓ Preserves Roger (1 branch only: day=午; below threshold)
- ✓ Captures shishang_strong (2 branches: day=寅 + hour=卯)
- ✓ Matches classical doctrine more precisely

### Files modified
- `packages/bazi-engine/app/constants.py` (3 new constants)
- `packages/bazi-engine/app/interpretation_rules.py` (extend `_pattern_2a_bijie_boost`)
- `packages/bazi-engine/tests/test_phase_12e_pattern_2a_pp.py` (NEW)
- `packages/bazi-engine/tests/validation/run_imbalance_validation.py` (add noble3 to DOCTRINAL_SPLIT_CHART_IDS)
- `CLAUDE.md` (doctrinal-splits + Phase 12e section)
- `apps/api/src/ai/ai.service.ts` (cache version bumps)

### Implementation

**1-1 — Constants** in `constants.py`. Place in a NEW clearly-headed Phase 12e section AFTER existing Phase 12d Pattern 2a/2a' block (per S1.2 reviewer feedback):

```python
# ============================================================
# Phase 12e Pattern 2a'' — non-month 比劫祿/羊刃 boost.
# Source: 任鐵樵《滴天髓·天干》注: 「甲日干，月令非寅，但日支寅而時支卯，
#                                  謂之專祿坐刃，身固強矣」
# Phase A verified. Phase C v2 refinement: require ≥2 qualifying branches
# (matches 任's 「日支祿+時支羊刃」 dual condition; single 帝旺 alone is
# 日刃 not the combination amplifying strength → preserves Roger anchor).
# ============================================================

PATTERN_2A_PP_PER_BRANCH_BOOST: float = 5.0    # +5 per qualifying non-month branch
PATTERN_2A_PP_DM_AS_TRANSPARENT: bool = True   # DM counted as 1 implicit transparent
PATTERN_2A_PP_MIN_QUALIFYING_BRANCHES: int = 2 # ≥2 branches at 臨官/帝旺
```

**1-2 — Module-level flag** in `interpretation_rules.py`. Place IMMEDIATELY AFTER existing `_PATTERN_2A_BIJIE_BOOST` constant (S1.1 reviewer feedback applied — shorter name):

```python
# Phase 12e Pattern 2a'' — extends 2a' (month-bound) to non-month 比劫祿/羊刃.
# Same family as Pattern 2a/2a'; flips together by design.
_PATTERN_2A_PP_NON_MONTH: bool = os.environ.get(
    'PHASE_12E_PATTERN_2A_PP_NON_MONTH', '1'
).lower() in ('1', 'true', 'yes', 'on')
```

**1-3 — Imports** in `interpretation_rules.py` constants block — extend the existing PATTERN_2A_* import group:

```python
from .constants import (
    # ... existing Phase 12d Pattern 2a constants ...
    PATTERN_2A_BOOST_CAP,
    # Phase 12e Pattern 2a'' constants
    PATTERN_2A_PP_PER_BRANCH_BOOST,
    PATTERN_2A_PP_DM_AS_TRANSPARENT,
    PATTERN_2A_PP_MIN_QUALIFYING_BRANCHES,
    # ... existing Phase 12d Pattern 2b constants ...
)
```

**1-4 — Modify `_pattern_2a_bijie_boost`** in `interpretation_rules.py`. Replace the trailing `return (0.0, 'none')` with the new fallback path:

```python
    # Existing 2a/2a' logic above — UNCHANGED.
    # Returns (boost, source) when month-bound trigger fires.
    if month_main_el == producing_element:  # 2a: 月令本氣印
        boost = excess * PATTERN_2A_BOOST_PER_TRANSPARENT_YIN_MONTH
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_yin_benqi')
    if month_zhongqi_el == producing_element:  # 月令中氣印 (60% credit)
        boost = (excess
                 * PATTERN_2A_BOOST_PER_TRANSPARENT_YIN_MONTH
                 * PATTERN_2A_ZHONGQI_YIN_MULTIPLIER)
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_yin_zhongqi')
    if month_main_el == dm_element:  # 2a': 月令本氣比劫 (祿/羊刃)
        boost = excess * PATTERN_2A_BOOST_PER_TRANSPARENT_BIJIE_MONTH
        return (min(boost, PATTERN_2A_BOOST_CAP), 'month_bijie')

    # Phase 12e Pattern 2a'' — non-month 比劫祿/羊刃 fallback.
    # Fires only when month-bound paths above don't fire AND there are
    # enough rooted 比劫 透干 (counting DM as 1 implicit transparent).
    # Requires ≥2 qualifying non-month branches per 任 「日支祿+時支羊刃」
    # combination doctrine.
    if not _PATTERN_2A_PP_NON_MONTH:
        return (0.0, 'none')

    # Effective threshold: DM stem counts as 1 implicit transparent.
    # rooted_bijie_transparent already excludes day pillar (DM position).
    effective_transparent = rooted_bijie_transparent + (
        1 if PATTERN_2A_PP_DM_AS_TRANSPARENT else 0)
    if effective_transparent < PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD:
        return (0.0, 'none')

    # Count non-month branches at 臨官 (祿) or 帝旺 (羊刃) for DM.
    # get_life_stage already imported at module level (line 56);
    # handles yin/yang DM cycles correctly via reversed life-stage tables.
    qualifying_branches = 0
    for pname in ('year', 'day', 'hour'):
        branch = pillars[pname]['branch']
        ls = get_life_stage(day_master_stem, branch)
        if ls in ('臨官', '帝旺'):
            qualifying_branches += 1

    # Phase C v2 refinement: require ≥2 qualifying branches (combination
    # doctrine). Roger has only 1 (day=午=戊's 帝旺), so doesn't fire.
    if qualifying_branches < PATTERN_2A_PP_MIN_QUALIFYING_BRANCHES:
        return (0.0, 'none')

    boost = PATTERN_2A_PP_PER_BRANCH_BOOST * qualifying_branches
    return (min(boost, PATTERN_2A_BOOST_CAP), 'non_month_lujie_yangren')
```

**1-5 — `factors.pattern2aSource`** already exists in V2 output. New `'non_month_lujie_yangren'` value emitted as source string. No schema change.

**1-6 — DOCTRINAL_SPLIT_CHART_IDS update** in `tests/validation/run_imbalance_validation.py`. Add `dts_hezhi_noble3` to the existing list under a NEW Category 6 (or extend Category 5):

```python
DOCTRINAL_SPLIT_CHART_IDS: List[str] = [
    # ... existing 14 entries ...
    # Category 6 (Phase 12e) — 食神制殺 vs 印化煞
    # 任鐵樵 prescribes 食傷 (制殺); engine encodes 印化煞 (default-weak doctrine).
    'dts_hezhi_noble3',
]
```

**1-7 — Tests** in `tests/test_phase_12e_pattern_2a_pp.py`:

| Test | Chart | Expected |
|---|---|---|
| `test_shishang_strong_jia_strong_after_2app` | 丙寅 甲午 甲寅 丁卯 (DM=甲) | qualifying_branches=2 (day=寅 臨官 + hour=卯 帝旺); boost=10; V2 49.5 → 59.5 strong; 用=土 ✓ |
| `test_dm_counted_as_implicit_transparent` | synthetic 比劫 透干=1 + 2 non-month 祿/羊刃 | effective=1+1=2; fires with boost=10 |
| `test_no_fire_when_only_1_qualifying_branch` | Roger pillars (戊DM, day=午=帝旺 only) | qualifying=1 < 2 threshold → returns (0.0, 'none'); V2 stays 39.0 weak ✓ |
| `test_no_fire_when_month_bound_already_fires` | chart triggering Pattern 2a (月=印) | early return at month_yin_benqi; new path NOT entered |
| `test_no_fire_when_extra_branches_zero` | rooted 比劫 透干 ≥2 BUT no non-month 祿/羊刃 | qualifying=0 < 2 → no fire |
| `test_yin_dm_乙_pattern` | 乙DM with 寅(乙's 帝旺) + 卯(乙's 臨官) in day+hour | 2 qualifying → fires |
| `test_yang_dm_庚_with_lu_yangren` | 庚DM with 申+酉 in day+hour | 2 qualifying → fires; boost=10 |
| `test_pattern_2a_pp_disabled_when_flag_off` | monkeypatch `_PATTERN_2A_PP_NON_MONTH=False` | returns (0.0, 'none') in fallback path |
| `test_anchor_roger_v2_unchanged` | Roger pillars | V2 score == 39.0 (pinned, S3.2 reviewer feedback) |
| `test_anchor_laopo_v2_unchanged` | Laopo pillars | V2 score == 20.6 (pinned; NT3 reviewer feedback — avoid underscore-as-decimal) |
| `test_yao_pinwo_no_2app_misfire` | dts_hezhi_yao_pinwo | day=子(沐浴), hour=酉(財地) — both non-qualifying → no fire ✓ (preserves Phase 12d 2b's surround penalty) |
| `test_long2_borderline_no_fire` | dts_hezhi_long2 (辛丑 癸巳 甲子 丙寅, DM=甲) | rooted 比劫 透干=0 (no other 甲/乙 stems); effective=0+1=1<2 → no fire |
| `test_noble3_no_fire` | dts_hezhi_noble3 (DM=辛, day=酉=臨官 only) | qualifying=1<2 → no fire (preserved as doctrinal split, not "fixed") |
| `test_boost_cap_clamps_via_per_branch_increase` | monkeypatch `PATTERN_2A_PP_PER_BRANCH_BOOST=8`; chart with 3 qualifying branches → 8×3=24 → clamped at 20 | boost == 20.0 (cap is defensive; 4-pillar charts max at 3 branches × 5 = 15, never reaching 20 by default) |
| `test_doctrinal_split_chart_ids_includes_noble3` | parse `DOCTRINAL_SPLIT_CHART_IDS` list | `'dts_hezhi_noble3' in DOCTRINAL_SPLIT_CHART_IDS` |

**1-8 — Anchor regression matrix** (S2.4 reviewer feedback — replaces stream-of-consciousness):

| Chart | DM | Pre-12e V2 | Effective transparent | Qualifying branches (non-month at 臨官/帝旺) | 12e-B fires? | Post-12e V2 | Notes |
|---|---|---|---|---|---|---|---|
| Roger (丁卯 戊申 戊午 庚申) | 戊 | 39.0 weak | 1+1=2 ✓ | day=午 (帝旺) → 1 | NO (1<2) | 39.0 weak ✓ | Pinned anchor; ≥2 guard preserves |
| Laopo (丙寅 辛丑 甲戌 壬申) | 甲 | 20.6 very_weak | 0+1=1 ✗ | year=寅(臨官)→1, day=戌(養), hour=申(絕). Total qualifying=1 | NO (effective<2 — fails before counting branches) | 20.6 ✓ | Pinned anchor |
| `edge_shishang_strong_jia` (丙寅 甲午 甲寅 丁卯) | 甲 | 49.5 neutral | 1+1=2 ✓ | year=寅(臨官), day=寅(臨官), hour=卯(帝旺) → 3 | YES (3≥2) | 49.5 + min(15, 20) = 64.5 strong | Target fix; 用=土 ✓ |
| `dts_hezhi_yao_pinwo` (辛丑 癸巳 丙子 丁酉) | 丙 | post-2b 31.3 weak | 0+1=1 ✗ | day=子(胎), hour=酉(死) — none qualifying | NO (effective<2) | 31.3 weak ✓ | Phase 12d 2b path preserved |
| `dts_hezhi_long2` (辛丑 癸巳 甲子 丙寅) | 甲 | 36.7 weak | 0+1=1 ✗ | year=丑, day=子, hour=寅(臨官) → 1 | NO (effective<2) | 36.7 weak ✓ | Doctrinal split unchanged |
| `dts_hezhi_noble3` (甲午 丙寅 辛酉 己丑) | 辛 | 33.2 weak | 0+1=1 ✗ | day=酉(臨官) → 1 | NO (effective<2) | 33.2 weak ✓ | Reclassified as doctrinal split |

This matrix verifies 12e-B fires ONLY on shishang_strong; all other charts are preserved.

**1-9 — Re-run harness**: expect `edge_shishang_strong_jia` to flip from 用=火 to 用=土 ✓. `noble3` no longer counted as failure under `--accept-doctrinal-splits`.

### Risks & mitigations

- **Roger anchor**: explicitly tested with V2 pin (S3.2) AND verified by anchor regression matrix.
- **Effective transparent counting subtlety**: `PATTERN_2A_PP_DM_AS_TRANSPARENT=True` means DM counts as 1 implicit transparent. This is essential for shishang_strong (1 rooted + 1 DM = 2 effective). Documented in helper docstring + dedicated unit test.
- **Yin DM symmetry**: `get_life_stage()` correctly returns 臨官/帝旺 for yin stems via reversed cycle. Tested.
- **Boost cap at 20**: enforced. Even pathological 4-branch trigger caps.
- **Noble3 reclassification fairness**: Phase A explicitly noted noble3's "中和" tag is "not unambiguously supported by 任鐵樵's actual commentary" — reclassification reflects honest doctrinal status, not avoidance.

---

## Cross-cutting

### CLAUDE.md updates

Two updates after commit lands:

**(a) Phase Status section**:
```markdown
- ✅ Phase 12e complete (Pattern 12e-B — non-month 比劫祿/羊刃 boost; noble3 reclassified as doctrinal split)
- Next: Phase 12f (Pattern 3a flag-flip after Bazi-master audit of 4 false-positives)
```

**(b) Doctrinal splits section** — add new Category 6 OR extend Category 5:

```markdown
**Category 6 — 弱身遇官殺: 食神制殺 vs 印化煞**
任鐵樵 prescribes 食傷 (制殺 — drain attacking 官殺 into 食傷) | engine encodes 印化煞 (印 mediates 官殺→印→DM)
- `dts_hezhi_noble3` (甲午 丙寅 辛酉 己丑): corpus 用=水 (癸食傷 制官), engine 用=土 (己印 化殺). Both classically valid for weak DM with 官殺 attacking.

**Total doctrinal splits: 14 → 15.**
```

**(c) Test counts**: 1977 → 1992 (~+15 tests).

### Cache invalidation

Bump `preAnalysisVersion`:
- LIFETIME: v2.5.0 → v2.6.0
- CAREER: v2.3.0 → v2.4.0
- ANNUAL: v2.1.0 → v2.2.0
- Comparison: v1.3.0 → v1.4.0

Operator: `redis-cli FLUSHALL` post-deploy.

**Per-flag-default-state cache policy** (S5.2 feedback): Cache bumped because Pattern 12e-B ships default-ON. With flag OFF, output is byte-identical to Phase 12d, but version bump is still applied because the flag default IS production behavior.

### Per-commit harness re-run protocol (S2.3 explicit)

After commit:
1. `python tests/validation/run_imbalance_validation.py` → expect 68% default
2. `python tests/validation/run_imbalance_validation.py --accept-doctrinal-splits` → expect 96%
3. Verify `edge_shishang_strong_jia` flipped (was-wrong-now-right)
4. Verify NO previously-correct chart became incorrect (rollback gate)
5. Append output to `.claude/plans/validation_phase_12e_runs.md`

If any previously-correct chart regresses → REVERT the commit and triage before re-attempting.

### Backward compat verification (S5.1 fix)

With `_PATTERN_2A_PP_NON_MONTH=False`:
- `_pattern_2a_bijie_boost` falls through to `return (0.0, 'none')` exactly as Phase 12d
- All other Phase 12d patterns unchanged
- Output byte-identical to Phase 12d main

Test: `test_pattern_2a_pp_disabled_when_flag_off` — verify the fallback path returns (0.0, 'none').

NO multiplier changes. NO `compute_sanhe_dm_credit` modifications. NO Pattern 1 behavior changes. NO V2 score changes from this commit when flag is OFF. The rollback path is clean.

### DOCTRINAL_SPLIT_CHART_IDS update (S3.4 explicit)

`run_imbalance_validation.py` constant list grows from 14 → 15 entries. The `--accept-doctrinal-splits` flag now scores noble3 as agreement when the engine gives any defensible answer (engine's 用=土 印化煞 path matches the 印化煞 doctrine = defensible).

### Phase 12d xfailed compat tests (S4.3 enumeration)

Existing 4 xfails in `test_compatibility_gold_standard.py` (Phase 12d Pattern 1 doctrinal regressions):
- `test_happy_couple_scores_highest`
- `test_divorced_couples_score_low`
- `test_happy_beats_divorced`
- `test_huang_ab_he_er_bu_li`

**Phase 12e-B impact analysis** (N2 fix — full trace executed pre-implementation):

| Person | Pillars | DM | Pre-12e V2 | Qualifying branches (year/day/hour at 臨官/帝旺) | 12e-B fires? | Post-12e V2 | Classification change? |
|---|---|---|---|---|---|---|---|
| Jay Chou | 戊午 乙丑 乙酉 壬午 | 乙 | 19.4 very_weak | year=午(沐浴), day=酉(絕), hour=午(沐浴) → **0** | NO | 19.4 ✓ | unchanged |
| Hannah | 癸酉 庚申 乙丑 壬午 | 乙 | 7.4 very_weak | year=酉(絕), day=丑(衰), hour=午(沐浴) → **0** | NO | 7.4 ✓ | unchanged |
| Big S | 丙辰 丁酉 辛卯 甲午 | 辛 | 64.9 strong | year=辰(墓), day=卯(絕), hour=午(病) → **0** | NO | 64.9 ✓ | unchanged |
| Wang Xiaofei | 辛酉 甲午 丙子 甲午 | 丙 | 73.4 very_strong | year=酉(死), day=子(胎), hour=午(帝旺) → **1** | NO (1<2) | 73.4 ✓ | unchanged |
| Tse Tinghua | 丁卯 丁未 乙酉 壬午 | 乙 | 23.5 very_weak | year=卯(臨官), day=酉(絕), hour=午(沐浴) → **1** | NO (1<2) | 23.5 ✓ | unchanged |
| Cheung Bochi | 辛亥 丙申 戊子 戊午 | 戊 | 37.5 weak | year=亥(絕), day=子(胎), hour=午(帝旺) → **1** | NO (1<2) | 37.5 ✓ | unchanged |
| **Wong Yibo** | 己酉 戊辰 戊午 戊午 | 戊 | 90.6 very_strong | year=酉(死), day=午(帝旺), hour=午(帝旺) → **2** | **YES** | 90.6+10=100.6 (clamped to ≤100 in classification) | very_strong → very_strong (no change) |
| Huang Xiaoming | 丁巳 辛亥 甲戌 庚午 | 甲 | 45.4 neutral | year=巳(病), day=戌(養), hour=午(死) → **0** | NO | 45.4 ✓ | unchanged |
| **Angelababy** | 己巳 丙寅 己未 庚午 | 己 | 22.8 very_weak | year=巳(帝旺 for 己 yin earth), day=未(冠帶), hour=午(臨官) → **2** | **YES** | 22.8+10=32.8 weak | **very_weak → weak (CASCADE)** |

**Net Phase 12e-B effect on compat couples**:
- **2 of 10 individuals fire 12e-B**: Wong Yibo (no classification change), Angelababy (very_weak → weak — cascade).
- **Angelababy's classification change** is the only material effect. Compatibility scoring downstream may shift.
- The 4 existing Phase 12d xfailed compat tests are already expected-failure — Angelababy's V2 shift could either bring them back to passing (good) or shift the failure mode (still xfail, no test breakage). Either outcome is acceptable.

**Test plan addition** (mandatory pre-merge):
- Add `test_angelababy_v2_classification_under_12e` pinning Angelababy's post-12e V2 score and classification (32.8, `weak`).
- After 12e-B lands, run `pytest tests/test_compatibility_gold_standard.py -v` and observe each xfail's status. If any xfail flips to passing (XPASS), update markers accordingly. If any new test fails, BLOCK merge for triage.

**Yin DM life-stage note**: Angelababy's DM=己 (yin earth). For yin stems, life-stage cycle is reversed relative to the yang stem of the same element. 己's 帝旺=巳, 臨官=午 (not 午/巳 like 戊). The trace above used `get_life_stage()` which handles this correctly. Test `test_yin_dm_乙_pattern` exercises this path generally; `test_angelababy_v2_classification_under_12e` covers it for the specific compat-affected case.

---

## Risk summary

| Pattern | Risk | Default | Mitigation |
|---|---|---|---|
| 12e-B (2a'' non-month with ≥2 guard) | **Low** | ON | Roger/Laopo V2 pinned in tests; ≥2 guard matches classical doctrine; flag rollback clean |
| Noble3 reclassification | **Low** | N/A | Pure documentation/list update; harness behavior change opt-in via `--accept-doctrinal-splits` flag |

## Test count delta

Pre-Phase-12e: 1977 (1971 pass, 4 xfail, 1 skip, 1 pre-existing fail)

| Component | Tests added |
|---|---|
| `test_phase_12e_pattern_2a_pp.py` | 15 |

Post-Phase-12e: ~1992 tests.

---

## Reviewer change tracking (Phase C v1 → v2)

This v2 plan addresses every Phase C MUST-change item from `phase_12e_review_v1.md`:

| v1 Issue | Severity | v2 Resolution |
|---|---|---|
| **S7.1** Roger regression — Pattern 12e-B fires on Roger (day=午 帝旺) | 🔴 critical | **≥2 qualifying branches guard** (Roger has 1 → no fire). Anchor regression matrix added (1-8). V2 pinned in tests. |
| **S7.2** noble3 not actually fixed — heaviness check rejects | 🔴 critical | **Drop Pattern 12e-A entirely**. Reclassify noble3 as doctrinal split (Category 6). |
| **S5.1 / S7.3** Multiplier flag rollback broken | 🔴 critical | **Drop multiplier nudge entirely** (no longer needed). Single flag (`_PATTERN_2A_PP_NON_MONTH`) cleanly gates the only new behavior. |
| **S7.4** Two conflicting code rewrites in 2B-3 | 🔴 critical | **Drop Pattern 12e-A entirely**. Section deleted. |
| **S7.5** Cross-file flag location for `_PATTERN_2C_MULTIPLIER_BUMP` | 🔴 critical | **Drop entirely** with Pattern 12e-A. |
| **S6.1** Pattern 1 weak-band heaviness check stricter than Phase A | doctrinal drift | **Moot** (Pattern 12e-A dropped). |
| **S2.1** Mid-document "Wait this isn't right" note | clarity | Section removed (Pattern 12e-A dropped). |
| **S2.2** Risk analysis claims wrong about Roger day=午 | clarity | Anchor regression matrix replaces stream-of-consciousness analysis. |
| **S2.3** Per-commit harness re-run protocol implicit | clarity | New "Per-commit harness re-run protocol" subsection (cross-cutting §). |
| **S2.4** Stream-of-consciousness Roger analysis | clarity | Replaced with structured matrix (1-8). |
| **S3.1** No cross-pattern integration test | coverage | Single commit means no cross-pattern composition; integration with Phase 12d patterns covered by anchor matrix. |
| **S3.2** Roger test doesn't pin V2 | coverage | Added `test_anchor_roger_v2_pinned_at_39` and Laopo equivalent. |
| **S3.3** No test for Roger-anchor-violation case | coverage | `test_no_fire_when_only_1_qualifying_branch` (uses Roger) is exactly that. |
| **S3.4** `test_long2_doctrinal_split_flips` skipped by feature flag | coverage | **Test dropped** (no longer needed; `dts_hezhi_long2` stays as doctrinal split). |
| **S4.1** `_has_structural_support` 2x calls `compute_sanhe_dm_credit` | perf | **Moot** (function dropped with Pattern 12e-A). |
| **S4.2** 2c-nudge corpus survey missing | perf | **Moot** (multiplier nudge dropped). |
| **S4.3** Phase 12d xfail compat tests interaction | perf | Cross-cutting "Phase 12d xfailed compat tests" subsection added with per-couple analysis. |
| **S5.1** Multiplier flag rollback (covered above) | compat | Resolved by dropping. |
| **S5.2** Cache version rationale | compat | "Per-flag-default-state cache policy" subsection added. |
| **S6.1** Pattern 1 weak-band heaviness drift | doctrine | **Moot**. |
| **S1.1** Verbose flag name | nit | Renamed to `PHASE_12E_PATTERN_2A_PP_NON_MONTH` (shorter). |
| **S1.2** Constants section placement implicit | nit | NEW Phase 12e section in `constants.py` clearly headed. |
| **S1.3** Phase 12e residual constants inline (no header) | nit | **Moot** (residual logic dropped). |

## What's deferred to Phase 12f (post-Bazi-master audit)

- Pattern 3a default flag flip (1 chart `wu_xianggong_qu_zhi`)
- Optional: revisit noble3 if Bazi-master agrees corpus's 中和 tag is canonical
- Doctrinal-split toggles for users who prefer 真詮 over 滴天髓 (or vice versa)
- 三會 DM-element credit (Phase 12c style 三合 extended to 三會)

## What this plan deliberately does NOT do

- **No 半合 multiplier changes** — preserves Phase 12d V2 score stability
- **No Pattern 1 weak-band extension** — heaviness gate remains strict (avoids long2-class regressions)
- **No `compute_sanhe_dm_credit` modifications** — preserves all existing Phase 12d Pattern 2c tests
- **No `determine_favorable_gods` / `_detect_dominant_imbalance` signature changes** — preserves all callers
- **No new module files or major refactors** — small, surgical change

Ready for Phase C v2 review.
