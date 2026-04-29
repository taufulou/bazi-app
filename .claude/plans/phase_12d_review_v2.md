# Phase 12d Implementation Plan Review v2

**Reviewer**: staff engineer (same as v1)
**Date**: 2026-04-28
**Plan version reviewed**: v2 (`.claude/plans/phase_12d_implementation_plan.md`)
**Verdict**: **Needs rework (smaller scope than v1)**

---

## Issue counts

| Bucket | Count |
|---|---|
| v1 MUST-change items verified fixed | 10 / 10 |
| v1 SHOULD items incorporated | 10 / 10 |
| New blockers introduced by v2 | **3** |
| New non-critical issues introduced by v2 | 1 |

The doctrinal foundation and architecture are correct. But three concrete bugs in the v2-edited code blocks will break in CI: one breaks **every existing 從格 chart** (invariant assertion regression), one prevents **Pattern 3b from ever firing** (`SEASON_MULTIPLIER` lookup mismatch inherited from a pre-existing engine bug), and one **silently changes neutral-DM defaults** even with all flags off (violating the `test_all_flags_off_reproduces_baseline` invariant the plan promises).

---

## v1 MUST-change verification

| Item | v1 issue | v2 fix verified? | Notes |
|---|---|---|---|
| S7.1 | `SIX_OPPOSITIONS` import errors | ✓ | Both call sites (Pattern 2c §2c-3 line 143; Pattern 3b §3b-1 lines 728, 764) use `CLASH_LOOKUP`. Confirmed `branch_relationships.py:66` defines `CLASH_LOOKUP: Dict[str, str]`; `SIX_OPPOSITIONS` does not exist. |
| S7.2 | Pattern 2b imports from wrong module | ✓ | §2b-2 reads `from .ten_gods import (IMBALANCE_WEIGHT_HIDDEN_BENQI, MONTH_BENQI_COMMANDER_MULTIPLIER, PILLAR_ROLE_WEIGHT,)`. Confirmed those constants live in `ten_gods.py:412/540/543`, NOT `constants.py`. |
| S7.3 | `HIDDEN_STEMS` import missing in `branch_relationships.py` | ✓ | §2c-3 explicitly extends imports: `HIDDEN_STEMS, STEM_ELEMENT, SAN_HE_TRINITIES, ...`. Both `STEM_ELEMENT` and `HIDDEN_STEMS` exist in `constants.py:27/92`. |
| S7.4 | Pattern 2c double-count guard compared stem-string to element-string | ✓ | §2c-3 lines 160-169: `benqi_element = STEM_ELEMENT.get(benqi_stems[0], '')` then `if benqi_element != dm_element`. Element-to-element comparison is correct. |
| S7.5 | Neutral-DM `'財旺'` had no branch in `determine_favorable_gods` | ✓ | §1-4 lines 625-650 add a `strength == 'neutral'` block with explicit `if dominant == '財旺'` branch (用=i_overcome, 喜=i_produce). |
| S7.6 / S6.2 | Pattern 3a `xiShen` discarded; 從強 `tabooGod` inverted | ✓ (mostly) | §3a-3 returns dict with `xiShen`, `jiShen`, `idleGod`, `dmAsYongShen`. §3a-5 override block keys on `cong_ge.get('dmAsYongShen', False)` and copies `xiShen` into `favorableGod`. **But see new issue N2 below — the `_assert_five_gods_distinct` invariant breaks 從弱 family.** |
| S7.7 | `import os` missing in `interpretation_rules.py` | ✓ | §2c-1 explicitly adds `import os` at top of file. |
| S4.2 | Commit ordering inverted vs. Phase A | ✓ | New order: 2c → 2a → 2b → 1 → 3b → 3a (lines 43-58). Per-commit projections rewritten to reflect that Pattern 1's lift only manifests after V2 strength fixes ship. |
| S6.3 / S2.3 | Rooted-比劫 filter missing; DM-five-合 guard missing | ✓ | §2a-2 adds `_build_root_class_cache` helper and filters `if root_cache.get(stem, 'none') in ('strong', 'weak')`. §3b-3 adds DM guard at top of `check_cong_ge`: `if any(s == day_master_stem for (_, s) in transformed_stems): return None`. |
| S6.1 | Pattern 3b 真化 condition (ii) used `>= 4` not `>= 1.5` | ✓ | §3b-1 line 743: `if SEASON_MULTIPLIER.get(formed_el, {}).get(month_branch, 1.0) < 1.5: continue`. Aligned with Phase 12b Fix D verbatim. **But see new issue N1 — this lookup is buggy in BOTH places.** |

All 10 MUST items are textually addressed.

---

## v1 SHOULD items

| Item | v2 incorporated? | Notes |
|---|---|---|
| S1.2 | ✓ | All 6 commits use `_PATTERN_*: bool = os.environ.get(...).lower() in (...)` module-level constants matching `_USE_WEIGHTED_IMBALANCE` convention. |
| S1.4 | ✓ | `YI_XING_DE_QI_SUB_NAMES` lookup added in §3a-1 (5 entries: 曲直/炎上/稼穡/從革/潤下). |
| S2.1 | ✓ | Per-flag default table at lines 32-39 shows 5 ON / 1 OFF. |
| S2.2 | ✓ | "FLUSHALL only" stated at line 1149; the prior "DELETE FROM reading_cache" line dropped. |
| S3.1 | ✓ | `test_phase_12d_integration.py` proposed at lines 1095-1107 with 8 cross-pattern tests. |
| S3.4 | ✓ | Rollback gate codified at line 1139: "REVERT the commit before proceeding". |
| S5.1 | ✓ | `test_all_flags_off_reproduces_baseline` listed at line 1104. **But see new issue N3 — the test as designed will fail because §1-4 changes neutral-DM defaults outside any flag gate.** |
| S5.2 | ✓ | §1-5 calls out docstring update for `_detect_dominant_imbalance` to add `'食傷洩秀'` enum value. |

---

## New issues found in v2

### Critical (block approval)

**N1. Pattern 3b's `SEASON_MULTIPLIER` lookup is structurally broken — Pattern 3b will never fire.**

`packages/bazi-engine/app/constants.py:1040` defines:
```python
SEASON_MULTIPLIER: Dict[int, float] = {5: 1.5, 4: 1.3, 3: 1.0, 2: 0.8, 1: 0.6}
```
A flat `Dict[int, float]` keyed by season-strength score 1-5.

But v2 plan §3b-1 line 743 (Pattern 3b helper) does:
```python
if SEASON_MULTIPLIER.get(formed_el, {}).get(month_branch, 1.0) < 1.5:
    continue
```
Treats it as `Dict[element_str, Dict[branch_str, float]]`. Since `SEASON_MULTIPLIER.get('木', {})` returns `{}`, the chained `.get(month_branch, 1.0)` always returns `1.0`. The condition `1.0 < 1.5` is always True → **continue always fires → no stem is ever marked transformed → `transformed_stems` is always empty → Pattern 3b never suppresses anything.**

This is a pre-existing bug pattern in `annual_enhanced.py:1424-1466` (Phase 12b Fix D's true-transformation gate is similarly dead). v2 has copied the bug verbatim. The claim "after 3b: ~74% (`anchor_cong_cai_yiwuming` flips)" is unreachable.

**Fix**: Pattern 3b helper must use `SEASON_STRENGTH[formed_el][month_branch]` (which IS keyed `Dict[str, Dict[str, int]]`, returning a 1-5 score), then check `SEASON_MULTIPLIER[score] >= 1.5` — i.e., score ≥ 5. Or equivalently, just check `SEASON_STRENGTH[formed_el][month_branch] >= 5`. Verify by grepping `SEASON_STRENGTH` for the proper nested-dict shape:
```bash
grep -A 3 "^SEASON_STRENGTH" packages/bazi-engine/app/constants.py
```
Note that this fix also cascades back to Phase 12b Fix D's existing `_fix_d_check_liu_he` — but that's a separate Phase 12b cleanup; out of scope for v2 review.

**N2. `_assert_five_gods_distinct` invariant breaks every existing 從財/從官/從兒/從勢 chart.**

§3a-5 adds:
```python
def _assert_five_gods_distinct(eg: Dict) -> None:
    keys = ('usefulGod', 'favorableGod', 'idleGod', 'tabooGod', 'enemyGod')
    elements = [eg[k] for k in keys]
    if len(set(elements)) != 5:
        raise AssertionError(...)
```
"Call at end of every `cong_ge` override branch."

But the 從弱 family branch (§3a-5 lines 1047-1056) is `unchanged` from existing code:
```python
'usefulGod':    cong_ge['yongShen'],
'favorableGod': cong_ge['yongShen'],   # <-- same as usefulGod
```
For 從財格 with DM=甲, `yongShen=i_overcome=土`. So `usefulGod=土`, `favorableGod=土`. `len(set(...)) == 4 ≠ 5`. The assertion fires for every existing 從財/從官/從兒/從勢 chart in production AND in the existing test suite (`test_interpretation_rules.py::test_cong_cai_ge`, `test_real_world_validation.py::Deng Xiaoping 鄧小平 從財格`, etc.).

The plan explicitly acknowledges this conflict: line 1080 says `test_five_gods_distinct_invariant` should pass for "every 從格 fixture in suite". That requirement is incompatible with the existing 從弱 dict shape (`usefulGod == favorableGod`).

**Fix options**:
- (a) Only call `_assert_five_gods_distinct` in the `dmAsYongShen=True` branch (從強/從旺 family), where the invariant holds by construction. Skip for 從弱.
- (b) Change the 從弱 family override to use distinct values (e.g., `favorableGod = ELEMENT_PRODUCED_BY[yongShen]`) — but this is a doctrine change requiring Bazi-master sign-off and is NOT what the plan claims to do ("從弱 family … unchanged").
- Pick (a). Update §3a-5 to wrap the `_assert_five_gods_distinct(effective_gods)` call inside `if cong_ge.get('dmAsYongShen', False):`. Update §3a-6 test description from "every 從格 fixture" to "every 從強/從旺 fixture".

**N3. `determine_favorable_gods` neutral-DM rewrite changes baseline behavior for un-flagged charts.**

§1-4 replaces the existing `if/else` (strong/weak) with a 3-branch `if/elif strength == 'neutral'/else`. The new `strength == 'neutral'` block is **NOT** gated by `_PATTERN_1_NEUTRAL_BRANCH` — it always runs.

Existing behavior (current main): for `strength='neutral'`, falls through to `else` branch and lands at `useful=dm_element, favorable=produces_me` (default-weak path).

New v2 behavior: a new `elif strength == 'neutral':` block is reached unconditionally, with sub-branches for `dominant in ('財旺', '官殺旺', '食傷旺')` AND a "general neutral" default of `useful=i_produce, favorable=i_overcome` (mild outlet doctrine).

This means:
- Any neutral chart whose `_detect_dominant_imbalance` returns `'general'` now gets `useful=i_produce` instead of `useful=dm_element`.
- Any neutral chart with `dominant='官殺旺'` now gets `useful=produces_me` (印) — same as the existing weak-path output, but explicitly classified through a different branch. (No behavior change here.)
- `test_all_flags_off_reproduces_baseline` will FAIL because the "general neutral" default has shifted with no flag protection.

The S7.5 fix (which is necessary) only requires adding a `dominant == '財旺'` branch for neutral. The other neutral sub-branches (general, 官殺旺, 食傷旺) are gratuitous behavior changes that should either: (a) be gated by `_PATTERN_1_NEUTRAL_BRANCH`, or (b) be removed and let neutral fall through to the existing weak-path defaults.

**Fix**: Either gate the entire new `elif strength == 'neutral':` block on `_PATTERN_1_NEUTRAL_BRANCH`, OR collapse it to just the `'財旺'` sub-branch and let everything else fall through to the unchanged `else`. Recommend the latter — surgical change scoped to the actual S7.5 issue:
```python
elif strength == 'neutral' and dominant == '財旺':
    # Phase 12d Pattern 1 neutral 財旺 (S7.5 fix)
    useful = i_overcome; favorable = i_produce
    taboo = dm_element; enemy = produces_me
else:
    # weak / very_weak / neutral-not-財旺 (existing logic unchanged)
    if dominant in ('食傷旺', '官殺旺'): ...
```
This preserves the baseline for neutral-general charts and makes the §1-4 modification minimal.

### Non-critical

**N4. v2 lacks an explicit test that `_assert_five_gods_distinct` is reached at all.**

The plan's `test_five_gods_distinct_invariant` (line 1080) implies coverage but doesn't actually demonstrate which branches the assertion is called from. Once N2 is fixed (assertion moved into `dmAsYongShen` branch only), the test should specifically:
- Exercise a 從強格 chart and assert `_assert_five_gods_distinct` was reached and passed.
- Exercise a 從財格 chart and assert `_assert_five_gods_distinct` was NOT reached (preserves old shape).

This is a documentation-of-intent issue, not a correctness issue.

---

## Verdict reasoning

v2 cleanly addresses 10/10 MUST items and 10/10 SHOULD items at the textual level. The doctrinal homework remains correct. But during this re-review I found that two of v2's structural changes have concrete bugs (N1, N2) and one introduces silent baseline drift (N3). All three would surface immediately in CI:
- N1 makes `test_yiwuming_cong_cai_fires_after_huaqi` (and the harness re-baseline showing `~72% → ~74%`) impossible — Pattern 3b's helper short-circuits at condition (ii) on every chart.
- N2 will fail every existing test that exercises 從財/從官/從兒/從勢 (`test_cong_cai_ge`, the 鄧小平 fixture in `test_real_world_validation.py`, etc.).
- N3 fails `test_all_flags_off_reproduces_baseline` — the very smoke test the plan added at v2's request.

Each is a 1-2 line fix. None invalidates the design. But each will block the commit if the engineer follows the plan literally.

The most consequential of the three is **N1** (Pattern 3b dead-on-arrival), because it's not surfaced by anchor regression but only by the harness, and the harness flip claim (`anchor_cong_cai_yiwuming` 從財 detection) is the load-bearing demonstration of Pattern 3b's value. Without N1's fix, Pattern 3b looks like it works (no test fails, no chart regresses) but has zero observable effect.

This is closer to "Approve with minor changes" than "Needs rework" — the v2 plan is much closer to ship-ready than v1 was, and the residual issues are localized to specific code blocks rather than spread across the architecture. Engineer should fix N1/N2/N3 in a v2.1 (one-page erratum) and proceed; no full re-review required after that.

---

## What MUST change before approval

1. **N1 — Pattern 3b SEASON_MULTIPLIER lookup**: Replace the chained-dict pattern with the correct flat-int lookup. Verify the constant's actual shape via:
   ```bash
   grep -A 12 "^SEASON_STRENGTH" packages/bazi-engine/app/constants.py
   grep -A 8 "^SEASON_MULTIPLIER" packages/bazi-engine/app/constants.py
   ```
   Then in §3b-1 line 743, replace
   ```python
   if SEASON_MULTIPLIER.get(formed_el, {}).get(month_branch, 1.0) < 1.5:
   ```
   with
   ```python
   season_score = SEASON_STRENGTH.get(formed_el, {}).get(month_branch, 3)
   if SEASON_MULTIPLIER.get(season_score, 1.0) < 1.5:
   ```
   (i.e., `season_score >= 5`). Add a unit test that exercises a chart where `formed_el` is in-season (multiplier 1.5) and confirms `transformed_stems` is non-empty.

2. **N2 — `_assert_five_gods_distinct` scope**: In §3a-5, move the `_assert_five_gods_distinct(effective_gods)` call inside the `if cong_ge.get('dmAsYongShen', False):` branch only. Update the test name in §3a-6 from `test_five_gods_distinct_invariant` (universal) to `test_five_gods_distinct_for_cong_qiang_wang` (scoped). Add an explicit comment in the override block: `# 從弱 family preserves legacy 4-distinct shape (usefulGod == favorableGod by doctrine)`.

3. **N3 — Neutral-DM default behavior gated**: In §1-4, narrow the new `elif strength == 'neutral':` block to a single `elif strength == 'neutral' and dominant == '財旺':` branch (mirroring the precise S7.5 ask). All other neutral cases must continue falling through to the existing weak-path else. Add a regression test: pick a current-production neutral chart whose `dominant` is `'general'`, capture pre-Phase-12d output, assert post-12d output matches byte-for-byte with all flags off.

## What SHOULD change (optional)

- **N4** — Once N2 is fixed, restructure `test_five_gods_distinct_invariant` to two sub-tests demonstrating which path each invariant covers.
- The remaining S3.2 deferral (`BAZI_USE_WEIGHTED_IMBALANCE=0` × Pattern 1 cross-test) is fine as a follow-up; integration test mix in §3.1 covers the most likely failure modes.

---

**Bottom line**: v2 fixes everything v1 flagged. But during the rewrite, three new issues snuck in — one is a copied-from-Phase-12b runtime bug (N1), one is a misplaced invariant (N2), and one is a too-aggressive scope expansion of a fix that should have been one branch (N3). All three are mechanical and should take ≤1 hour to fix. After those fixes, ship.
