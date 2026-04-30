# Phase 12f Cleanup Plan Review v2 (final)

**Reviewer**: staff engineer (same as v1)
**Date**: 2026-04-30
**Plan version reviewed**: v3 (`.claude/plans/phase_12f_cleanup_plan.md`)
**Verdict**: **Approve, ship it**

All three v1 MUST items resolved cleanly with verifiable arithmetic. All seven
SHOULD items addressed. The Direction A fixture replacement (`庚寅 → 庚辰`)
walks through all four upstream gates (i)-(iv) without introducing any new
confounds (no Pattern 2c 三合, no chart-level 沖 on combining branches), and the
narrative is now consistent with the `hidden[:2]` semantics the fix actually
implements. The errata block at the top of the plan documents the v2→v3 deltas
explicitly. No new criticals introduced. Ready to merge as planned (4 commits,
docs → flag flip → defensive corrections → behavioral fix gated on harness).

---

## v1 MUST items — fix verification

| MUST item | Verified? | Notes |
|---|---|---|
| **S7.1** Direction A test fixture | ✓ | New fixture `庚辰 乙酉 戊午 丙子` traces correctly per HIDDEN_STEMS table. Gates (i)-(iv) all pass; gate (v) under fix correctly yields `breaker_strong=False` so 真化 fires; test assertion `('year', '庚') in result` PASSES. Detailed trace below. |
| **S2.2 / S6.2** Narrative aligned with `hidden[:2]` semantics | ✓ | Test docstring (plan lines 542-562) now explicitly says "本氣 OR 中氣" and walks through each branch's `[:2]` slice. Errata block (line 16) calls out the narrative correction as one of the v2→v3 deltas. |
| **S2.1** Test count consistency | ✓ | All three conflicting numbers (1995, 1997, 1998) removed. Plan now defers post-12f count to `pytest --collect-only -q | tail -1` measurement after Commit 4 (lines 712-715, 743-745). Errata explicitly cites this as the S2.1 fix (line 17). Predicted +8 figure is now flagged as "informational only" with the right caveat. |

### S7.1 detailed trace (new fixture: `庚辰 乙酉 戊午 丙子`, DM=戊)

Gate (i) — Adjacent: 庚(year) + 乙(month) → year-month is in `ADJACENT_PILLAR_PAIRS` ✓

Gate (ii) — 化神 strict 旺: formed_el=金, month_branch=酉. `SEASON_STRENGTH['金']['酉']=5` → `SEASON_MULTIPLIER[5]=1.5` ≥ 1.5 ✓

Gate (iii) — 化神 has root: 酉's hidden=['辛'], `STEM_ELEMENT['辛']=金` ✓

Gate (iv) — No 沖 on combining branches (b1=辰, b2=酉):
- `CLASH_LOOKUP['辰']=戌`, not in `[辰,酉,午,子]` ✓
- `CLASH_LOOKUP['酉']=卯`, not in `[辰,酉,午,子]` ✓
- (Note: there IS a 子-午 沖 between day and hour branches, but gate (iv) only
  checks the COMBINING branches per the actual code at `stem_combinations.py:362-366`.
  Gate (iv) is correctly scoped — verified.)

Gate (v) under FIX — Inner loop now `stem in hidden[:2]`:
- breaker_el=火, outer loop matches 丙 at hour
- Inner loop checks `'丙' in hidden[:2]` for each branch:
  - 辰[:2]=['戊','乙'] → False
  - 酉[:2]=['辛'] → False
  - 午[:2]=['丁','己'] → False (strict yin-yang: 丁≠丙)
  - 子[:2]=['癸'] → False
- `breaker_strong = False` → 真化 fires
- Test assertion `('year', '庚') in result` and `('month', '乙') in result` both PASS ✓

Counterfactual: under buggy independent-loop code, the inner loop would have
matched 午 (本氣 丁 has element 火) independently of which pillar held 丙, so
buggy code yields `breaker_strong = True` → 真化 BLOCKED. This is exactly the
Direction A bug the fix is documented to correct. Test correctly differentiates
buggy vs fixed behavior.

---

## v1 SHOULD items — fix verification

| SHOULD item | Verified? | Notes |
|---|---|---|
| **S1.1** Test naming consistency | ✓ | New file is `test_phase_12f_pattern_3b_breaker.py` (line 456, 531) — phase-named, parallel to existing `test_phase_12d_pattern_3b.py` / `test_phase_12e_pattern_2a_pp.py` convention. |
| **S1.2** Drop placeholder ceiling test | ✓ | `test_v2_score_ceiling_at_100` removed from Commit 3 test class. Explicit note at line 411 ("Note: ... placeholder dropped (no-op test per Phase D S1.2 feedback). Cap-at-100 enforcement is out of scope for Phase 12f"). |
| **S1.3** Stale "14 → 16 charts" phrasing | ✓ | Errata line tracking S1.3 confirms removal. (No "14 → 16" string visible in v3.) |
| **S2.3** Inline strict-vs-loose 通根 note | ✓ | Note moved to Phase 12d Pattern 3b doctrine section (lines 717-729 in cross-cutting describe the new placement at CLAUDE.md line ~583). Errata line 22 confirms. |
| **S2.4** Consolidation ambiguity resolved | ✓ | Plan now explicit (line 153): "consolidated table at line 741 REPLACES the inline flag listings in the Phase 12d section ... and any other scattered flag mentions" + "REMOVE the now-redundant Phase 12d inline flag listing at lines 516-521 and replace with: 'Per-rule env flags: see consolidated rollback table below (line 741).'" Single-source-of-truth design. |
| **S3.1** V2 floor test exercises floor | ✓ | Test `test_v2_score_floor_clamps_negative_to_zero` at lines 371-396 monkeypatches `ir._pattern_2b_surround_penalty` to return `(0.0, 80.0, True)`. Without the floor, `total = 50 + 5 + 5 + 0 - 80 = -20`; with floor, `max(-20, 0.0) = 0.0`. Asserts `result['score'] == 0.0`. Genuinely exercises the new code path. |
| **S5.2** .env warning in runbook | ✓ | Added to Commit 2 runbook at lines 290-296 as "Local dev environment warning" block, with verification grep command. |

---

## Any new issues introduced by v3?

**No new criticals.** Targeted spot-checks below:

1. **New fixture confound check (Pattern 2c 三合/半合)**: Branches `辰酉午子`.
   - 三合局: 申子辰水局 — missing 申. 巳酉丑金局 — missing 巳丑. 寅午戌火局 —
     missing 寅戌. 亥卯未木局 — missing 亥未. **No 三合 triggered.**
   - 半合: 子辰 (水半合, missing 申) — half-合 not standard 半合 trio rule
     (mainstream 半合 requires 旺神/墓神 pair: 子辰=水半合 yes, but only weakly).
     Pattern 2c gives credit to DM-element 三合; here DM=戊(土) and any 水 半合
     would not be DM-element. Even if Pattern 2c fires, it operates on V2's
     `dedi` (得地) — orthogonal to the Pattern 3b 真化 detection path being
     tested. **No interference with the Direction A test assertion.**

2. **Test name parallel structure**: Existing `test_phase_12d_pattern_3b.py`
   uses class-based organization (`TestPattern3bTransformsFire`, `TestPattern3bDmInvolved`,
   etc.) and a `_pillars()` helper. The new `test_phase_12f_pattern_3b_breaker.py`
   uses one `TestPattern3bBreakerStemRootedSemantics` class with imports inline
   in each test. Slightly different style but acceptable — both are valid
   pytest patterns and the new file's tests are tightly scoped to one fix.
   **Non-issue.**

3. **Fixture 子-午 沖 noted but not load-bearing**: The new fixture has 子-午
   沖 between day and hour. As verified above, gate (iv) only checks combining
   branches (辰, 酉) per code at `stem_combinations.py:362-366`, not the chart
   as a whole. The 子-午 沖 doesn't affect 真化 detection. However, the test
   docstring could optionally note this for reader clarity ("the 子-午 沖 in
   the chart doesn't enter gate (iv) because the combining branches are 辰
   and 酉, not 子 or 午"). **Non-blocking nit.**

4. **`HIDDEN_STEMS` table verified**: Confirmed against
   `packages/bazi-engine/app/constants.py:92-105`. All `[:2]` slices in the
   docstring match the actual table. ✓

5. **`STEM_COMBINATION_PAIRS` ordering**: 乙庚化金 confirmed at
   `stem_combinations.py:43`. ✓

6. **`ADJACENT_PILLAR_PAIRS` membership**: `(year, month)` confirmed at
   `stem_combinations.py:78-82`. ✓

7. **Direction B / anchor regression tests retained**: The plan's new test
   file at lines 576-631 keeps the `ziping_niu_jianbo` Direction B test AND
   the `anchor_cong_cai_yiwuming` "unchanged" test, plus the existing-test
   regression check. These give the breaker fix proper coverage in BOTH
   directions plus the anchor regression. ✓

---

## Issue counts (v3)

- **Critical / blocking**: 0
- **Should-fix**: 0 (all v1 SHOULDs resolved)
- **Nits**: 1 (S7.3-equivalent: optionally annotate the 子-午 沖 in
  Direction A docstring for reader clarity — but the trace is already
  internally complete)

---

## Verdict

**Approve, ship it.** All v1 MUST items resolved with verified arithmetic
against the engine's actual `HIDDEN_STEMS`, `SEASON_STRENGTH`, and
`CLASH_LOOKUP` tables. All v1 SHOULD items addressed. No new criticals. The
plan is structurally sound, has a sensible commit ordering with appropriate
gates, and a faithful change log via the v1→v2→v3 errata block.
