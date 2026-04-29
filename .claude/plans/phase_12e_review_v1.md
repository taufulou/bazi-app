# Phase 12e Implementation Plan Review v1

**Reviewer**: staff engineer
**Date**: 2026-04-29
**Plan version reviewed**: v1 (`.claude/plans/phase_12e_implementation_plan.md`)
**Verdict**: **Needs rework**

---

## Issue counts

| Bucket | Count |
|---|---|
| S1 — Style / nits | 3 |
| S2 — Documentation / clarity | 4 |
| S3 — Test coverage gaps | 4 |
| S4 — Cascading effects / ordering | 3 |
| S5 — Backward compat concerns | 2 |
| S6 — Doctrinal drift from Phase A | 1 |
| S7 — Code correctness (blockers) | 5 |
| **Total** | **22** |

---

## Issues (lowest → highest priority)

### S1 — Style / nits (lowest priority)

- **S1.1** Verbose flag name. `PHASE_12E_PATTERN_2A_PRIME_PRIME_NON_MONTH` is 38 chars long; the existing convention is shorter (`PHASE_12D_PATTERN_2A_BIJIE_BOOST` = 32). Suggest `PHASE_12E_PATTERN_2A_NON_MONTH` (29) or `PHASE_12E_PATTERN_2A_PP` (22). Phase A's verification document refers to it as "Pattern 2a''" which contains a Unicode prime — `PP` is the natural ASCII shorthand.

- **S1.2** Constants section placement is implicit. Plan lines 67–77 say "next to existing `PATTERN_2A_*`" for the new Pattern 12e-B constants. Looking at `constants.py:1073-1085`, the existing block is bounded by `# Phase 12d Pattern 2a / 2a' — 比劫 透干 boost` header and then jumps to Pattern 2b. Plan should either (a) extend that section's header to include "Phase 12e Pattern 2a''" or (b) create a new clearly-headed `# Phase 12e Pattern 2a'' — non-month 比劫祿/羊刃 boost` block. As written, a code reviewer cannot grep for "Phase 12e" in `constants.py` and find these new constants.

- **S1.3** Plan section 2A-1 (line 205-217) inlines a Phase 12e residual constant in the same block as Phase 12d multipliers WITHOUT a section header break. Suggest separating into `# Phase 12e Pattern 2c — DM-self-seat 旺神 residual` with citation, parallel to existing Phase 12d 2c block.

### S2 — Documentation / clarity

- **S2.1** **Plan contains TWO conflicting code rewrites for the same function.** Lines 287–328 show one version of `detect_neutral_shishang_outlet` modification ("New Phase 12e: weak-band extension gate ... fires Pattern 1 for `weak` DM..."). Then line 330 says "Wait — this isn't quite right. The existing `weak`-tier branch in this function already runs heaviness/Roger-guard checks. Let me restructure cleanly:" followed by lines 333–356 with a different version. **A reader could implement either.** The first version restructures the early-return logic; the second leaves the heaviness check (line 334: `if shishang_w < max(bijie_w, cai_w, yinxing_w): return None`) untouched and only relaxes the Roger-anchor guard. These have meaningfully different behavior on noble3 (see S7.2 below). Plan must DELETE the first version and keep only the second (which appears to be the author's final intent).

- **S2.2** Phase 12d v1 review precedent (S2.3 in that review) flagged "doctrine-load-bearing risk note appears in Risks section but not in implementation block". Phase 12e plan repeats this pattern: lines 173–176 contain Roger/Laopo regression analysis IN THE RISKS subsection, which is required reading for understanding whether the implementation is correct. The Roger analysis at line 173 is wrong (see S7.1). The mitigation logic must move INTO the implementation block (e.g., as a comment in the code or as a regression test that anchors V2).

- **S2.3** Per-commit harness re-run protocol implicit. Plan line 47–48 mentions per-commit projected agreement but doesn't repeat Phase 12d's "Append output to validation_phase_12e_runs.md with heading per commit" + "rollback gate if previously-passing chart regresses" rules. The previous review flagged this; same gap recurs.

- **S2.4** Plan line 491–493 contains stream-of-consciousness reasoning ("Roger regression deep-check: Roger pillars 丁卯 戊申 戊午 庚申, DM=戊. day branch=午, 戊 in 午's life stage = 帝旺 (戊 lurks under 丙午 because 戊午 day pillar — yes 戊's 帝旺 is 午). So `_has_structural_support` returns True for Roger. V2=39 falls in [28, 38]? No, 39 > 38."). This is a critical Roger anchor analysis but reads as draft notes. Promote to a structured "Roger regression matrix" table: V2 pre, V2 post, Pattern 2a'' fires?, Pattern 2c residual fires?, Pattern 1 weak-band fires?, expected behavior preserved? — one row each for Roger, Laopo, noble3, long2, shishang_strong_jia.

### S3 — Test coverage gaps

- **S3.1** **No cross-pattern integration test.** Phase 12e adds 3 sub-rules (12e-B + 12e-A 2c-nudge + 12e-A Pattern 1 weak-band). They can compose on a single chart (e.g., Roger has 2c residual not applicable but 2a'' fires; noble3 has 2c residual + Pattern 1 weak-band). Plan's tests (lines 153–168, 462–489) are isolated per-rule. Add a `test_phase_12e_integration.py` with 4–6 cross-pattern composition cases — same recommendation as Phase 12d v1 review S3.1.

- **S3.2** **Roger anchor regression test does not pin V2 score.** Plan tests `test_anchor_roger_unchanged` at line 164 says "Roger pillars: Pattern 2a/2a' don't fire (verified Phase 12d); 2a'' must also not fire". But based on the engine code (see S7.1 below), 2a'' WILL fire on Roger. Test must assert (a) `_pattern_2a_bijie_boost` returns `(0.0, 'none')` for Roger AND (b) Roger's V2 is unchanged at 39.0. Without the V2 pin, a regression that lifts Roger to neutral could pass with a too-loose assertion.

- **S3.3** **No test for Roger-anchor-violation case in Pattern 12e-B.** The 2a'' rule iterates over `('year', 'day', 'hour')`. Day branch is included by design (per doctrine: 「日支祿」 is 「日刃」 / 「專祿」). Plan needs an explicit positive test confirming day-branch 帝旺 contributes (e.g., 戊 DM with day=午, no other 比劫祿/羊刃) AND a negative test confirming this fires correctly without exceeding cap on Roger-shaped charts.

- **S3.4** **`test_long2_doctrinal_split_flips` (line 489) skipped by feature flag.** Plan implies Pattern 1 weak-band extension flips long2. But Pattern 1's existing `weak` heaviness check (`if shishang_w < max(bijie_w, cai_w, yinxing_w): return None`) may reject long2 before the band check. Test must verify long2's category weights satisfy the heaviness check, OR the plan must update the heaviness check to permit weak-band extension to bypass it (which is a separate doctrinal claim not in Phase A).

### S4 — Cascading effects / ordering

- **S4.1** **`_has_structural_support` re-computes `compute_sanhe_dm_credit` per call.** When `determine_favorable_gods` is invoked, it calls `_detect_dominant_imbalance` → `detect_neutral_shishang_outlet` → `_has_structural_support` → `compute_sanhe_dm_credit`. Then the V2 strength scoring path independently calls `compute_sanhe_dm_credit` (interpretation_rules.py:376). For chart calculation latency this is ~2x duplicated work. Not a correctness blocker, but worth caching. **Bigger concern:** the `compute_sanhe_dm_credit` call inside `_has_structural_support` is independent of the residual-flag — meaning even with `PHASE_12E_PATTERN_2C_MULTIPLIER_BUMP=0`, `_has_structural_support` still uses the residual path's logic. For backward-compat this is wrong.

- **S4.2** **2c-nudge cascades into V2 strength score AND into `_has_structural_support`.** Plan correctly flags this but offers no test to verify the cascade. With 2c residual ON, V2 lifts (e.g., for noble3 from 29.7 → ~31.5). The Pattern 1 weak-band gate is `[28, 38]` — well within range. But for OTHER charts that previously sat at V2=39 (just above weak-band ceil), a 2c residual could push V2 to 39.5 → 40 → flip to neutral, exiting the weak-band entirely. Plan should enumerate which charts in the corpus have non-zero `sanheCredit` AND V2 ≥ 38 to identify all potential cascade victims. The plan's risk table line 553–557 lists 3 charts but doesn't survey the corpus.

- **S4.3** **Phase 12d xfail compat tests interaction not analyzed.** Plan line 506 mentions "Compatibility regressions: Phase 12d's 4 xfailed compat tests may shift further" but doesn't enumerate which xfail tests exist or how to verify them. CLAUDE.md indicates compatibility regressions are a known issue. Plan must explicitly grep `@pytest.mark.xfail` in the test suite, list affected tests, and state expected behavior for each under Phase 12e flags.

### S5 — Backward compat concerns

- **S5.1** **CRITICAL: `_PATTERN_2C_MULTIPLIER_BUMP=0` does NOT reproduce Phase 12d behavior.** Plan section 2A-1 (lines 205–217) modifies `BAN_HE_WANG_MULTIPLIER` from 0.7 → 0.8 and `BAN_HE_MU_MULTIPLIER` from 0.5 → 0.55 directly in `constants.py`. The flag `_PATTERN_2C_MULTIPLIER_BUMP` (lines 222–227) only gates the residual logic, NOT the multiplier values. When the flag is OFF:
  - Multipliers stay at 0.8/0.55 (Phase 12e values, not Phase 12d's 0.7/0.5)
  - `compute_sanhe_dm_credit` returns DIFFERENT credits than Phase 12d
  - V2 scores shift across the corpus
  - Phase 12d backward-compat is BROKEN even with the flag off

  **Fix**: Either (a) add the new multipliers as separate constants (e.g., `BAN_HE_WANG_MULTIPLIER_PHASE_12E: float = 0.8`) and select inside `compute_sanhe_dm_credit` based on the flag, or (b) gate the multiplier selection at the call site in `compute_sanhe_dm_credit`:
  ```python
  multiplier = BAN_HE_WANG_MULTIPLIER if not _PATTERN_2C_MULTIPLIER_BUMP else 0.8
  ```
  Plan as written has zero rollback path for the multiplier change.

- **S5.2** **Cache invalidation versions bumped without rationale.** Plan section "Cache invalidation" (line 526–530) bumps LIFETIME v2.5.0 → v2.6.0 etc. But `BAZI_USE_WEIGHTED_IMBALANCE` is still defaulted OFF per CLAUDE.md, AND if all 3 Phase 12e flags are OFF, behavior should match Phase 12d. Why are caches purged when behavior is identical? Plan must clarify: (a) caches purged because flags ship default-ON, OR (b) define a flag-default-state-aware cache invalidation policy. (Same nit as Phase 12d v1 review S2.2.)

### S6 — Doctrinal drift from Phase A

- **S6.1** **Pattern 1 weak-band extension's bypass logic is more conservative than Phase A specified.** Phase A (doctrine doc line 68) wrote: "when V2 ∈ [28, 38] AND 食傷 weighted ≥ max(財星, 比劫) − 1.0 AND DM has 自坐祿 OR 自坐羊刃 OR 半合金 (DM-element 旺地半合), permit Pattern 1's 食傷洩秀 path". The plan's second version (lines 333–356) retains the existing heaviness check `if shishang_w < max(bijie_w, cai_w, yinxing_w): return None` — which is STRICTER than Phase A's "≥ max(財星, 比劫) − 1.0" formulation. Phase A allows shishang_w to be slightly less than the max (within 1.0 buffer), but the plan rejects unless shishang_w is strictly the maximum. For noble3, this could be the difference between fire / no-fire — see S7.2.

### S7 — Code correctness (blockers)

- **S7.1** **🔴 Roger anchor regression — Pattern 12e-B fires on Roger and lifts V2 39 → 44 (weak → neutral).** Plan lines 173 and 491 claim Roger doesn't fire 2a''. This is wrong:
  - Roger pillars: 丁卯 戊申 戊午 庚申, DM=戊
  - `rooted_bijie_transparent`: month=戊 (rooted as 餘氣 in 申). `_build_root_class_cache` returns 'weak' for 餘氣-only stems; Pattern 2a' counter accepts both 'strong' and 'weak' (line 235 of `interpretation_rules.py`: `if root_cache.get(stem, 'none') in ('strong', 'weak')`). So `rooted_bijie_transparent = 1`.
  - With `PATTERN_2A_PP_DM_AS_TRANSPARENT=True`: `effective_transparent = 1 + 1 = 2 ≥ PATTERN_2A_BIJIE_TRANSPARENT_THRESHOLD (2)`. ✓ threshold met.
  - Non-month branches: year=卯 → `get_life_stage(戊, 卯)`. 戊 starts at 寅 (CHANGSHENG_BRANCH['戊']='寅'); yang stem; offset = (3 − 2) % 12 = 1. TWELVE_STAGES[1] = '沐浴'. ✗ no.
  - day=午 → offset = (6 − 2) % 12 = 4. TWELVE_STAGES[4] = '帝旺'. **✓ YES — day=午 is 戊's 帝旺 (日刃).**
  - hour=申 → offset = (8 − 2) % 12 = 6. TWELVE_STAGES[6] = '病'. ✗ no.
  - `extra_branches = 1`, `boost = 5.0 * 1 = 5.0`. Roger V2: 39 → 44 → flips weak → neutral.

  Plan line 173 claims "year=卯 (戊's 沐浴, not 臨官/帝旺), hour=申 (戊's 病). No extras." — **omits day=午 entirely.** This is a flat error in the plan's risk analysis. CLAUDE.md explicitly notes Roger should remain `偏弱` (V2=39); flipping him to `中和` cascades into personality anchors, ten god distribution interpretation, and finance pattern archetypes — likely breaking dozens of tests.

  Plan also claims Roger's structural support analysis at line 491–492: "戊 in 午's life stage = 帝旺 ... `_has_structural_support` returns True for Roger. V2=39 falls in [28, 38]? No, 39 > 38." — but the V2 ceiling check happens AFTER structural support check, AND post-12e-B Roger's V2 jumps to 44 anyway. Cascading effect: Roger's V2=44 now `neutral`, which pushes him into the standard Pattern 1 path (`shishang_w >= yinxing_w * 1.5`) — completely different interpretation than weak-band extension.

  **Fix options**: (a) exclude day branch from 2a'' iteration (only year + hour); (b) require day-branch contribution to be ADDITIONAL evidence beyond at least one OTHER non-month branch (i.e., day alone doesn't trigger); (c) apply pillar weighting per Phase A's table (day=0.85, hour=0.65) — Phase A explicitly recommended weighting; plan rejected it but this is exactly the case it would prevent. Phase A actually prescribed (per doctrine doc line 158) `year=0.5, month=1.0, day=0.85, hour=0.65` weights, and the plan's "+5 per branch" model is a Phase A author's secondary recommendation — but the secondary recommendation can't pass the Roger anchor without modification. Either re-introduce Phase A's pillar weights OR exclude day branch.

- **S7.2** **🔴 Pattern 1 heaviness check likely rejects noble3 before weak-band extension fires.** Plan's 2B-3 second version (lines 333–356) preserves the heaviness check at line 334:
  ```python
  if shishang_w < max(bijie_w, cai_w, yinxing_w):
      return None
  ```
  For noble3 (甲午 丙寅 辛酉 己丑, DM=辛):
  - cai (木 = 財) carriers: year stem 甲 (transparent, rooted in 寅), month branch 寅 本氣甲. Heavy.
  - bijie (金 = 比劫) carriers: day branch 酉 本氣辛 (DM seat), 丑 中氣辛 (餘氣).
  - shishang (水 = 食傷) carriers: 丑 中氣癸 (餘氣). Very thin.
  - yinxing (土 = 印) carriers: hour stem 己 (transparent, rooted in 丑 本氣己).

  Without exact computation: shishang_w is almost certainly the LIGHTEST category (only 餘氣癸 in 丑). The heaviness check rejects noble3 IMMEDIATELY at line 334. The weak-band bypass at lines 344–349 never fires. **The central case Pattern 12e-A is supposed to fix is not reached.**

  Phase A's verification document specified the gate as "食傷 weighted ≥ max(財星, 比劫) − 1.0" (with 1.0 buffer), which is meaningfully looser than the existing `<` check. The plan's "second restructure" version inadvertently misses this Phase A correction. Either:
  - (a) Adopt Phase A's softer formulation: `if shishang_w < max(bijie_w, cai_w, yinxing_w) - 1.0: return None`, OR
  - (b) Bypass the heaviness check entirely when weak-band conditions hold (more aggressive — risk of long2-class false positives), OR
  - (c) Restructure so heaviness is one of several "support tiers" rather than a hard gate.

  Plan must add a positive test that asserts shishang_w vs max(other) for noble3 specifically, and verify the heaviness check passes (or the bypass fires).

- **S7.3** **🔴 `_PATTERN_2C_MULTIPLIER_BUMP` flag does not gate the multiplier change.** See S5.1 above. The flag as designed (gating only the residual logic in `compute_sanhe_dm_credit`) cannot disable the multiplier change. The plan must either:
  - (a) Move the multiplier change INSIDE the function, gated by the flag:
    ```python
    if _PATTERN_2C_MULTIPLIER_BUMP:
        if count == 2 and has_wang:
            multiplier = 0.8  # was 0.7
        ...
    else:
        # Phase 12d behavior
        if count == 2 and has_wang:
            multiplier = BAN_HE_WANG_MULTIPLIER  # 0.7
        ...
    ```
  - (b) Add NEW Phase 12e multiplier constants (`BAN_HE_WANG_MULTIPLIER_12E: float = 0.8`) and select inside the function.
  - (c) Document explicitly that "12e ships an irreversible multiplier change" (this is a doctrine commitment, not a flag-rollback). But then the flag name is misleading — should be `PHASE_12E_PATTERN_2C_RESIDUAL` instead of `..._MULTIPLIER_BUMP`.

- **S7.4** **Stream-of-consciousness comment in 2B-3 indicates the implementation guidance is ambiguous.** Plan line 330: "Wait — this isn't quite right. The existing `weak`-tier branch in this function already runs heaviness/Roger-guard checks. Let me restructure cleanly:" — this is a draft note, not a finalized spec. It introduces uncertainty about which version the engineer should implement. The plan must DELETE the first version (lines 287–328) or explicitly mark it `# REJECTED` and keep only the final version (lines 333–356). As written, an LLM or human implementer could choose either path and produce different behavior on edge cases.

- **S7.5** **Cache import path for `PATTERN_2C_DM_SELF_SEAT_RESIDUAL` is incomplete.** Plan section 2A-3 (line 262) says "Add import for `PATTERN_2C_DM_SELF_SEAT_RESIDUAL` to `branch_relationships.py` constants import block." But the existing import block at `branch_relationships.py:23-33` does NOT import any Phase 12d-Pattern-related constants — it imports BRANCH_ELEMENT, BRANCH_INDEX, HIDDEN_STEMS, STEM_ELEMENT, SAN_HE_*, BAN_HE_*. The Phase 12d residual is a new concept; the import must go in this block AND the plan must clarify whether `_PATTERN_2C_MULTIPLIER_BUMP` flag also needs to be readable here (currently the plan places the flag in `interpretation_rules.py`, but `compute_sanhe_dm_credit` lives in `branch_relationships.py`). Either:
  - (a) Move `_PATTERN_2C_MULTIPLIER_BUMP` flag to `branch_relationships.py`, OR
  - (b) Have `compute_sanhe_dm_credit` accept a flag/multiplier parameter from caller.

  Either way, the plan as written has an import path that doesn't compile cleanly.

---

## Verdict reasoning

**This plan needs rework before implementation.** The doctrinal analysis from Phase A is sound, the high-level architecture (per-rule flags, 2 commits, anchor regression suite) is correct, and the plan author has internalized the Phase 12d v1 review lessons (imports verified, env-flag convention followed, etc.). But the executable specification has at least three blockers that would either cause regressions on shipped anchors (Roger) or fail to fix the central target (noble3):

1. **S7.1 (Roger regression)** is the most consequential: the plan's risk analysis is materially wrong about Roger's day branch. Pattern 12e-B as written WILL flip Roger from V2=39 weak to V2=44 neutral, cascading through dozens of downstream tests. CLAUDE.md treats Roger's V2=39 weak as a calibrated anchor; this is not a minor regression. Either the rule excludes day branch (deviating from Phase A's doctrine slightly) or it weights pillars (re-introducing Phase A's original pillar-weight table the plan rejected).

2. **S7.2 (noble3 not actually fixed)** is critical because Pattern 12e-A's central case may not fire under the plan's "second restructure" version. The heaviness check `shishang_w < max(...)` rejects noble3 because 食傷 (water) is the THINNEST category in the chart. The fix is to soften the gate per Phase A's actual specification (the 1.0 buffer wasn't carried into the plan).

3. **S5.1 / S7.3 (rollback path broken)** is critical operationally: the `_PATTERN_2C_MULTIPLIER_BUMP` flag claim that "OFF reproduces Phase 12d behavior" is false because the multipliers are changed in `constants.py` regardless of flag state. There's no rollback if the multiplier change causes unexpected regressions in production.

Beyond the blockers, **S2.1 / S7.4** show the plan contains an unresolved "draft thought" mid-document (lines 330–332). This level of polish issue suggests the v1 plan was committed before the author re-read it. A v2 should be a cleaner read.

The good news: every blocker is fixable in a v2 revision, and the fixes are mechanical (re-scoping the flag, deleting the rejected code block, adding pillar weighting OR excluding day branch, softening the heaviness check). Estimate ~0.5 day of additional planning. The two-commit structure and per-commit harness re-run protocol can stay unchanged.

---

## What MUST change before approval

1. **Resolve Roger regression in Pattern 12e-B (S7.1).** Either:
   - Exclude day branch from the iteration (only year + hour), accepting a doctrinal compromise documented in the plan, OR
   - Re-introduce Phase A's pillar weighting (`year=0.5, day=0.85, hour=0.65`) — boosts shishang_strong_jia (day=寅+hour=卯 = 0.85+0.65 = 1.5 × +5 = +7.5; need to recalibrate cap), AND for Roger (day=午 only = 0.85 × +5 = +4.25 — still flips, so this alone doesn't fix it; need additional gate like "≥ 2 qualifying branches").
   - Add a regression test that pins Roger's V2 score at 39.0 post-12e-B.

2. **Fix noble3 firing path in Pattern 12e-A (S7.2).** Adopt Phase A's softer heaviness gate: `if shishang_w < max(bijie_w, cai_w, yinxing_w) - 1.0: return None` (or equivalent). Add a test that asserts noble3 specifically passes the heaviness check, with explicit weighted scores logged.

3. **Fix flag rollback for 2c multiplier change (S5.1, S7.3).** Either gate the multiplier change inside `compute_sanhe_dm_credit` based on flag state, OR rename the flag to reflect that multiplier change is permanent.

4. **Delete the rejected first version of the 2B-3 modification (S7.4).** Plan lines 287–328 must be removed or explicitly marked `# REJECTED — see lines 333+ for final version`.

5. **Resolve flag location for `_PATTERN_2C_MULTIPLIER_BUMP` (S7.5).** The flag must live where `compute_sanhe_dm_credit` can read it. Either move it to `branch_relationships.py` or pass it via parameter.

6. **Add Roger/Laopo regression matrix table (S2.4)**, replacing stream-of-consciousness analysis at line 491–493.

7. **Add a cross-pattern integration test file (S3.1)** with composition tests.

## What SHOULD change but is optional

- Shorter flag name (`PHASE_12E_2A_PP_NON_MONTH` or `PHASE_12E_NON_MONTH_LU_REN`) per S1.1.
- Explicit constants section header per S1.2, S1.3.
- Cache `compute_sanhe_dm_credit` result per chart computation to avoid 2x evaluation per S4.1.
- Enumerate Phase 12d xfailed compat tests with expected post-12e behavior per S4.3.
- Promote per-commit harness re-run protocol to explicit cross-cutting section per S2.3.
- Survey corpus for charts with V2 ∈ [38, 40] and non-zero `sanheCredit` to identify cascade victims of the 2c-nudge per S4.2.
- Adopt Phase A's "buffer = 1.0" formulation for shishang heaviness check per S6.1 (this is also a fix for S7.2, listed there as primary).
