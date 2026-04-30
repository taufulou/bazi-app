# Phase 12e Implementation Plan Review v2

**Reviewer**: staff engineer (same as v1)
**Date**: 2026-04-29
**Plan version reviewed**: v2 (`.claude/plans/phase_12e_implementation_plan.md`)
**Verdict**: **Approve with changes** (3 minor fixes required pre-merge; none block the strategic decision)

---

## Executive summary

v2 made the right strategic call: **drop Pattern 12e-A entirely** and reclassify `dts_hezhi_noble3` as a doctrinal split. This eliminates 4 of 5 v1 blockers by removing the code that contained them (S5.1, S7.2, S7.3, S7.4, S7.5). The remaining blocker S7.1 (Roger regression) is genuinely fixed by the `≥2 qualifying branches` guard, which I verified by walking through `get_life_stage()` calls against `interpretation_rules.py:_pattern_2a_bijie_boost` for Roger, Laopo, shishang_strong, yao_pinwo, long2, and noble3. The matrix in plan section 1-8 is accurate.

The doctrinal trade-off — accepting noble3 as a documented split rather than chasing an algorithmic "fix" — is sound. Phase A's verdict on noble3 was already "⚠ partially confirmed" with explicit doubts. The corpus's "中和" tag is a borderline judgment between 食神制殺 and 印化煞 schools. Reclassification is intellectually honest.

The simplification dramatically improves rollback safety: one flag, one new behavior, byte-identical Phase 12d output when flag is OFF. Far less risk than v1's three-flag matrix with multiplier rewrites.

---

## v1 → v2 fix verification

| v1 Issue | Severity | v2 fix verified? | Notes |
|---|---|---|---|
| **S7.1** Roger regression — Pattern 12e-B fires on Roger (day=午 帝旺) | 🔴 critical | ✓ | Verified Roger has exactly 1 qualifying branch (day=午=帝旺; year=卯=沐浴; hour=申=病). With `MIN_QUALIFYING_BRANCHES=2`, function returns `(0.0, 'none')` before applying boost. V2 stays at 39.0. Plan's claim is accurate; matrix entry verified end-to-end via `get_life_stage(戊, branch)` for each non-month pillar. |
| **S7.2** noble3 not actually fixed — heaviness check rejects | 🔴 critical | ✓ | Pattern 12e-A dropped entirely. Plan section 2A removed. Reclassification adds noble3 to `DOCTRINAL_SPLIT_CHART_IDS` as new Category 6. Verified the const at `tests/validation/run_imbalance_validation.py:76-96` is the only consumer; only path-dependent on `--accept-doctrinal-splits` flag. No downstream test risk. |
| **S5.1 / S7.3** Multiplier flag rollback broken | 🔴 critical | ✓ | Verified by grep: zero references to `BAN_HE_WANG_MULTIPLIER`, `BAN_HE_MU_MULTIPLIER`, or `compute_sanhe_dm_credit` modifications in v2. Plan line 285 explicitly states "NO multiplier changes. NO `compute_sanhe_dm_credit` modifications." Single-flag rollback path is genuinely clean. |
| **S7.4** Two conflicting code rewrites in 2B-3 | 🔴 critical | ✓ | Verified single code spec for `_pattern_2a_bijie_boost` in plan section 1-4. No "Wait this isn't right" notes. No alternative versions. |
| **S7.5** Cross-file flag location for `_PATTERN_2C_MULTIPLIER_BUMP` | 🔴 critical | ✓ | Moot. The flag is dropped along with Pattern 12e-A. The single remaining flag `_PATTERN_2A_PP_NON_MONTH` lives in `interpretation_rules.py` where its sole consumer (`_pattern_2a_bijie_boost`) lives. No cross-file path. |
| **S6.1** Pattern 1 weak-band heaviness check stricter than Phase A | doctrinal drift | ✓ | Moot. Pattern 1 weak-band logic dropped with 12e-A. |
| **S2.1** Mid-document "Wait this isn't right" draft note | clarity | ✓ | Section removed. v2 reads as a finalized spec. |
| **S2.2** Risk analysis claims wrong about Roger day=午 | clarity | ✓ | Replaced by structured matrix in section 1-8. Old stream-of-consciousness gone. |
| **S2.3** Per-commit harness re-run protocol implicit | clarity | ✓ | Explicit "Per-commit harness re-run protocol" subsection at lines 265-274 with 5 numbered steps including rollback gate. |
| **S2.4** Stream-of-consciousness Roger analysis | clarity | ✓ | Replaced by 6-row anchor regression matrix. Each row computes effective_transparent + qualifying_branches + post-12e V2 + notes. Verified accurate. |
| **S3.1** No cross-pattern integration test | coverage | ⚠ | v2 says "Single commit means no cross-pattern composition; integration with Phase 12d patterns covered by anchor matrix." Acceptable design choice given simplification. The anchor matrix functions as light integration coverage. Not blocking. |
| **S3.2** Roger test doesn't pin V2 | coverage | ✓ | New tests `test_anchor_roger_v2_pinned_at_39` and `test_anchor_laopo_v2_pinned_at_20_6` listed in test plan. |
| **S3.3** No test for Roger-anchor-violation case | coverage | ✓ | `test_no_fire_when_only_1_qualifying_branch` (uses Roger pillars) is exactly that. Together with `test_anchor_roger_v2_pinned_at_39` provides defense-in-depth. |
| **S3.4** `test_long2_doctrinal_split_flips` skipped by feature flag | coverage | ✓ | Test dropped. long2 stays as doctrinal split. Replaced with `test_long2_borderline_no_fire` confirming 12e-B doesn't accidentally fire on long2. |
| **S4.1** `_has_structural_support` 2x calls `compute_sanhe_dm_credit` | perf | ✓ | Moot. Function dropped with 12e-A. |
| **S4.2** 2c-nudge corpus survey missing | perf | ✓ | Moot. Multiplier nudge dropped. |
| **S4.3** Phase 12d xfail interaction | perf | ⚠ | Subsection added with per-couple analysis. Jay Chou explicitly walked through (no fire). However the plan defers Hannah/Big S/Wang/Tse/Cheung/Wong/Huang/Angelababy to "TBD pre-implementation". This is a soft TODO; reasonable for plan stage but should be discharged before merging. See "What MUST change". |
| **S5.1** covered above | compat | ✓ | |
| **S5.2** Cache version rationale | compat | ✓ | "Per-flag-default-state cache policy" subsection at lines 263-264 explicitly addresses why caches are bumped despite default-OFF byte-identity. |
| **S1.1** Verbose flag name | nit | ⚠ | Renamed to `PHASE_12E_PATTERN_2A_PP_NON_MONTH` (33 chars). Marginally shorter than v1's 38. Acceptable but not the meaningful trim my v1 review suggested (e.g., `PHASE_12E_PATTERN_2A_PP` at 22). Non-blocking. |
| **S1.2** Constants section placement implicit | nit | ✓ | Plan section 1-1 now explicitly says "Place in a NEW clearly-headed Phase 12e section AFTER existing Phase 12d Pattern 2a/2a' block" with a sample header block. Greppable. |
| **S1.3** Phase 12e residual constants inline | nit | ✓ | Moot. Residual logic dropped. |

---

## New issues found in v2

### Critical (block approval)

**None.** v2 cleanly resolves the v1 blockers without introducing critical issues.

### Non-critical (must-fix-before-merge but not blocking approval)

- **N1 — Inline-import of `get_life_stage` shadows module-level import.** Plan section 1-4 line 154 says:
  ```python
      from .life_stages import get_life_stage
      qualifying_branches = 0
      for pname in ('year', 'day', 'hour'):
  ```
  But `interpretation_rules.py` already has `from .life_stages import get_life_stage` at module-level (line 56 of the current file). Inlining the import is redundant, mildly confusing, and will trigger a linter warning. **Fix**: remove the inline import; just call `get_life_stage()` directly. Trivial change.

- **N2 — Phase 12d xfail compat couple trace incomplete.** Plan line 301: "Hannah, Big S, Wang Xiaofei, Tse Tinghua, Cheung Bochi, Wong Yibo, Huang Xiaoming, Angelababy — TBD pre-implementation: each needs traced through `get_life_stage(dm, branch)` to confirm." The plan correctly notes 12e-B uses a different code path than compat scoring (line 303), so the *expected* impact is zero. But the trace would catch any indirect cascade through V2 strength score. **Fix**: complete the trace as part of implementation; either (a) confirm zero cascade or (b) pin compat scores in the test plan. Cheap to do; should not be a TODO.

- **N3 — `qualifying_branches` capping at 4 vs cap of 20 — cap is theoretical only.** With month branch excluded and only 3 non-month pillars (year, day, hour), max qualifying = 3 → max boost = 5×3 = 15, never approaching `PATTERN_2A_BOOST_CAP=20`. The `test_boost_capped_at_20` test (line 201) requires a "mock chart with qualifying=5", which is impossible in a real 4-pillar chart. **Fix**: either drop the cap test (it tests defensive code that can never fire in production), or rewrite it to test the cap on the boost computation directly without going through 4-pillar logic (e.g., monkeypatch `PATTERN_2A_PP_PER_BRANCH_BOOST` to 30 and confirm clamp at 20). Documentation should note "cap is defensive; 4-pillar charts can produce at most 15".

### Pure nits (optional)

- **NT1** Flag name still long (33 chars). `PHASE_12E_2A_PP` (15 chars) or `PHASE_12E_PATTERN_2A_PP` (22) would be cleaner. Not blocking.

- **NT2** Plan line 209's matrix entry for Laopo has a parenthetical re-derivation mid-cell ("year=寅 (臨官), day=戌, hour=申 — let me re-check..."). The conclusion is correct but the cell reads as draft notes. Polish to a clean "year=寅(臨官)→1, day=戌(養), hour=申(絕). Total qualifying=1" before merge.

- **NT3** Plan section 1-7 test name `test_anchor_laopo_v2_pinned_at_20_6` uses underscore-as-decimal. Common Python convention is `test_anchor_laopo_v2_pinned_at_20pt6` or `test_laopo_v2_score_unchanged`. Trivial.

---

## Risks I considered and found acceptable

- **Noble3 reclassification cascading**: I grepped for `dts_hezhi_noble3` in the engine. Two references: (a) the CSV row, (b) `tests/test_phase_12d_pattern_2c.py:37` uses noble3 as a sample chart for testing 2c behavior. Adding noble3 to `DOCTRINAL_SPLIT_CHART_IDS` only affects `--accept-doctrinal-splits` agreement scoring. No test in the suite asserts noble3's `--accept-doctrinal-splits` agreement status — additive only.
- **Boost cap clamp at 4 branches**: As noted in N3, the 20 cap can't actually fire. This is fine — a defensive cap is fine to have even if unreachable, given future doctrinal changes might raise per-branch boost.
- **Day-branch inclusion concern**: My v1 S7.1 worried that including day-branch in iteration would always lift Roger. The `≥2` guard solves this elegantly: Roger's 1 day-branch qualification is below threshold; shishang_strong's day+hour+year qualifications all collectively pass. The doctrine alignment with 任's 「日支祿+時支羊刃」 (dual-condition) makes this principled, not ad-hoc.

---

## Verdict reasoning

**Approve with changes.** v2 fixes every v1 blocker by simplification rather than complexity. The strategic decision to drop Pattern 12e-A is the right call — Phase A's noble3 verdict was already conditional, my S7.2 confirmed the proposed fix wouldn't fire, and reclassifying the chart as a doctrinal split is more honest than chasing a marginal heaviness-gate softening.

The Roger anchor preservation is the single most consequential check, and I verified it end-to-end: walking through `CHANGSHENG_BRANCH['戊']='寅'`, `BRANCH_INDEX['午']=6`, `(6-2) % 12 = 4`, `TWELVE_STAGES[4]='帝旺'` for day branch, while year=卯(沐浴) and hour=申(病) don't qualify. Roger has exactly 1 qualifying branch; `≥2` threshold genuinely preserves him at V2=39.0. The plan author's matrix in section 1-8 is accurate.

The three N-issues (inline import, incomplete compat trace, theoretical cap test) are pre-merge fixes, not blockers. They can be discharged by the implementer in <30 minutes.

The remaining S3.1 question — single-commit means no cross-pattern integration tests — is an acceptable design trade-off given the dramatically reduced scope. The anchor matrix functions as light integration coverage across 6 charts.

**Ship it after the 3 N-fixes.** No further plan revision needed.

---

## What MUST change before merge (not before plan approval)

1. **Drop the inline `from .life_stages import get_life_stage`** in plan section 1-4 (N1). Use the module-level import that already exists.

2. **Complete the Phase 12d xfail compat couple trace** (N2): walk through `get_life_stage(dm, branch)` for each remaining couple's pillars to confirm 12e-B doesn't fire. If any couple has ≥2 qualifying branches, document the V2 score delta and decide whether to add to test pins.

3. **Resolve the cap test** (N3): either drop `test_boost_capped_at_20` or rewrite to test the clamp via monkeypatched per-branch boost (e.g., set `PATTERN_2A_PP_PER_BRANCH_BOOST=8` so 3 branches → 24 → clamps at 20).

## What SHOULD change (optional)

- Shorter flag name (`PHASE_12E_PATTERN_2A_PP` would suffice).
- Polish Laopo matrix cell to remove "let me re-check" inline derivation (NT2).
- Test name `..._pinned_at_20_6` → `..._pinned_at_20pt6` for clarity (NT3).

---

## Approval confidence

| Dimension | Confidence |
|---|---|
| Roger anchor preserved | **High** — verified end-to-end via engine constants + `get_life_stage()` walk |
| Laopo anchor preserved | **High** — verified `rooted_bijie_transparent=0`, fails effective threshold |
| shishang_strong fix lands | **High** — verified 3 qualifying branches → boost=15 → V2 49.5+15=64.5 strong |
| Noble3 reclassification safe | **High** — grepped only consumer is `DOCTRINAL_SPLIT_CHART_IDS` opt-in flag |
| Compat couples unaffected | **Medium** — Jay Chou traced explicitly; others deferred (N2). Expected zero cascade per code path analysis. |
| Rollback path clean (single flag OFF = byte-identical to 12d) | **High** — single new code branch in `_pattern_2a_bijie_boost`, gated by single flag |

Overall confidence: **High enough to ship after N-fixes**. v2 is a meaningful improvement over v1 and the strategic simplification is the right call.
