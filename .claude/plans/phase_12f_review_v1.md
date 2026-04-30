# Phase 12f Cleanup Plan Review v1

**Reviewer**: staff engineer
**Date**: 2026-04-30
**Plan version reviewed**: v2 (`.claude/plans/phase_12f_cleanup_plan.md`)
**Verdict**: **Needs rework**

The plan is mostly tight — docs cleanup, the BAZI flag flip, the V2 floor, and
the docstring fix are all clean. Issue F's doctrinal motivation has a real
verification document behind it. But Commit 4's Direction A test fixture is
internally inconsistent with the proposed fix code: the chart contains 寅 (a
中氣 of 丙), and the proposed `stem in hidden[:2]` semantics will see 丙 as
rooted there, so `breaker_strong=True` and 真化 will NOT fire. The test asserts
the opposite. This will fail at test time and forces a non-trivial fixture
rewrite, so the plan can't ship as-is. There are also several smaller arithmetic
and ordering issues. Fixable in a single doc edit + fixture revision, no
re-think of the underlying fix.

---

## Issues (lowest → highest priority)

### S1 — Style / nits

- **S1.1**: Test naming consistency. The plan creates a new
  `tests/test_phase_12f_invariants.py` (Commit 3) but adds Issue F tests to the
  existing `test_phase_12d_pattern_3b.py`. Either is defensible, but for
  symmetry, consider routing the Issue F regression tests to a new
  `test_phase_12f_pattern_3b_breaker.py` (parallels the existing
  per-phase/per-pattern test-file convention). Non-blocking.
- **S1.2**: `test_v2_score_ceiling_at_100` is a `pass`-only placeholder (per
  the plan's own note "actual cap enforcement is out of scope"). Delete the
  placeholder rather than ship a no-op test. If the cap question is worth
  surfacing, file it as a Phase 12g TODO instead of a no-op assertion.
- **S1.3**: The plan's Commit 1 risks section says "leave one stale 14 → 16
  inconsistency" — the "14 charts" / "16 charts" framing isn't a current
  CLAUDE.md fact pattern. Likely a stale phrasing carried over from a prior
  draft. Harmless but worth removing for clarity.

### S2 — Documentation / clarity

- **S2.1**: The plan is internally inconsistent on the post-12f test count.
  Three different numbers appear:
  - Line 642: "Total: 1989 → 1997"
  - Line 656: "1997 (1991 pass, 4 xfail, ...)"
  - Line 681 / Reviewer change tracking: "1995 (+6 new tests)"
  - Line 691 (table): "fixed to 1989 → 1995 after new tests"

  Counting actual additions:
  - Commit 3: `test_v2_score_floor_at_zero`, `test_v2_score_ceiling_at_100`
    (placeholder), `test_food_god_chain_label_returned` = **3 tests**
  - Commit 4: 5 Pattern 3b breaker tests + 1 Pattern 2a'' new path = **6 tests**

  Delta is **+9** → 1998. (Delete the placeholder ceiling test per S1.2 and
  it's +8 → 1997, matching the line 656 number but not the line 642 / 691
  numbers.) Pick one number and use it everywhere. Better: defer the test
  count to post-implementation Commit-4-footer measurement (the prior phase
  reviews already established that pattern is preferable to predicted
  counts).

- **S2.2**: The bazi-master verification doc explicitly states (lines 16-18)
  "Stem 丙 + chart has 午 (no 巳, no 寅, no 戌, no 未)." — i.e., for Direction
  A to manifest, the chart must NOT contain 寅. Plan's Direction A test
  fixture contradicts this (see S6.1 / S7.1). The test fixture in the plan
  doesn't match its own verification doc. Either restate the test fixture
  to remove 寅, or update the verification doc — but they cannot both be
  correct as written.

- **S2.3**: Commit 4's "Strict vs loose 通根 stance" footer block is correct
  but slightly buried at the very bottom of the cross-cutting section. This
  doctrinal decision is load-bearing (per CLAUDE.md's "LOAD-BEARING
  DOCTRINE" idiom) and would be more visible inline in the Phase 12d
  section, alongside the existing Pattern 3b notes.

- **S2.4**: Commit 1's "1-4 Phase 12d/12e flag table consolidation" block
  duplicates the existing two flag tables (one in the 12b/12c section, one
  in the 12d section). Plan says "Remove the now-redundant flag listings in
  earlier subsections OR cross-reference this consolidated table." Pick one
  explicitly — either the consolidated table replaces the others (cleaner)
  or stays as a third copy with explicit cross-references (worse). Don't
  leave it ambiguous in the plan.

### S3 — Test coverage gaps

- **S3.1**: `test_v2_score_floor_at_zero` does NOT actually exercise the
  floor. The chart `辛丑 / 癸巳 / 丙子 / 丁酉` scores 31.3 (verified by direct
  call), nowhere near zero. The test asserts `result['score'] >= 0.0` which
  passes whether the floor exists or not. To meaningfully test the floor,
  monkeypatch `PATTERN_2B_FLAT_PENALTY` or similar to a value large enough
  to drive total negative — e.g., monkeypatch the Pattern 2b function to
  return `(0.0, 80.0, True)` and verify floor triggers. The plan
  acknowledges the floor is purely defensive ("ZERO behavioral impact"), but
  if the test doesn't exercise the new code path, the test adds no value.
  Either (a) make the test actually trigger the floor, or (b) drop it and
  rely on the docstring/comment as documentation.

- **S3.2**: No regression test covers the existing Direction-A-style path
  where 丙 IS in chart but rooted in 中氣. Once S7.1 is fixed (replace 寅
  with 辰 or similar in Direction A fixture), the resulting "rootless 丙"
  test is genuine but distinct from "丙 with 中氣 root" — both should have
  coverage to lock in the strict-vs-loose 通根 stance.

- **S3.3**: Plan promises a "regression: existing test_breaker_present in
  test_phase_12d_pattern_3b.py expects 丁 火 強根 to block 真化. Verify the
  fix preserves this." The existing test fixture (`庚申 乙酉 丁午 丁巳`) uses
  `丁午` and `丁巳` — both invalid 60甲子 stem-branch parities (yin stem +
  yang/yin branch mismatches). Engine doesn't enforce this, so test passes,
  but cleaning it up is fair game during this PR's test additions. Optional.

### S4 — Cascading effects / ordering

- **S4.1**: V2 floor placement (`max(total, 0.0)` AFTER `round(...)`). Order
  is correct in the plan. round(-2.4, 1) = -2.4 → max(-2.4, 0.0) = 0.0. ✓
  No issue.

- **S4.2**: Pattern 3b breaker fix has only 1 caller in the engine
  (`check_cong_ge` at `interpretation_rules.py:533-534`). Verified via grep.
  Safe blast radius. The bazi-master verification's harness scan (1 of 50
  charts shows behavior diff, V2 short-circuits → no chart-level outcome)
  is correct.

- **S4.3**: Commit 2 BAZI flag flip — no test asserts
  `_USE_WEIGHTED_IMBALANCE is False` by default (verified via grep). All
  test files that depend on the flag use `monkeypatch.setattr(fe,
  '_USE_WEIGHTED_IMBALANCE', True)` or `False` explicitly, so flipping the
  default doesn't break setup. Plan's claim ("Update any test that asserts
  `_USE_WEIGHTED_IMBALANCE is False` by default to assert `True` instead")
  may not have any actual targets — call out that this is a defensive
  search rather than a known TODO.

- **S4.4**: Plan correctly identifies 4 xfailed compat tests in
  `test_compatibility_gold_standard.py::TestScoreRanking` may flip XPASS
  after BAZI flag flip. All 3 xfail markers use `strict=False`, so XPASS
  produces a warning, not failure. Plan's "leave xfail markers alone for
  Phase 12g cleanup" is sensible. Non-issue.

### S5 — Backward compat concerns

- **S5.1**: Cache version bumps in Commit 2 are correct (verified current
  values in `ai.service.ts:6949-6952` + `:6972`). v2.6.0 → v2.7.0,
  v2.4.0 → v2.5.0, v2.2.0 → v2.3.0, v1.4.0 → v1.5.0. Proper sequencing.

- **S5.2**: Plan says "`apps/api/.env`: NOT modified — code default change
  is canonical; .env override remains optional." Reasonable BUT: when
  servers start, no value in .env means the env var is unset, so module-import
  reads the new default ('1'). For dev environments where someone may have
  manually set `BAZI_USE_WEIGHTED_IMBALANCE=0` in their local .env to
  reproduce flag-off behavior, the operator runbook should warn them. Add
  a note in Commit 2's runbook: "If you previously set
  `BAZI_USE_WEIGHTED_IMBALANCE=0` in your local .env, remove it or set
  to `=1` to match the new code default."

### S6 — Doctrinal drift / safety concerns

- **S6.1**: Commit 4's Direction A test fixture (`庚寅 乙酉 戊午 丙子`)
  contradicts the bazi-master verification's own framing of Direction A.
  Verification doc states: "Stem 丙 + chart has 午 (no 巳, no 寅, no 戌, no
  未)." The plan's fixture has 寅 in year branch. Under the proposed fix
  (`stem in hidden[:2]`), 丙 IS in 寅[:2] = ['甲', '丙'], so
  `breaker_strong=True` and 真化 does NOT fire. Plan's test assertion
  `('year', '庚') in result` will FAIL. See S7.1 below for fix.

- **S6.2**: Plan's narrative for Direction A says "丙 (陽火) NOT rooted in 午
  (本氣=丁陰火 only — strict yin-yang), nor in 寅 (本氣=甲), nor 子 (本氣=癸).
  So 丙 IS rootless." This narrative checks 本氣 only — but the proposed
  fix code uses `hidden[:2]` (本氣 OR 中氣). The narrative and the code
  describe different semantics. Either the fix should be `hidden[0]` only
  (本氣 strict), or the narrative should be corrected to acknowledge that
  寅's 中氣 = 丙 counts as a root. See S7.1 for the correct fixture path.

- **S6.3**: Phase 12b Fix D's `_fix_d_check_liu_he` "has_root" check uses
  element-level matching (loose 同氣通根), not stem-level matching (strict
  yin-yang 通根). Pattern 3b post-fix is stricter than Fix D. The plan
  acknowledges this in the strict/loose footer note (good), but the
  inconsistency itself is still real. Bazi-master verification §137 flagged
  this as worth documenting — the plan's footer addresses it. ✓ Resolved
  in plan.

- **S6.4**: The "DO NOT FLIP" guard rail for Pattern 3a is appropriate
  given the 4 false-positive charts already documented + the -2pp net
  agreement under flag-on. Adds friction in the right place. Non-issue.

### S7 — Code correctness (blockers)

- **S7.1 (BLOCKER)**: Direction A test fixture in Commit 4 will FAIL at test
  time. Verified by direct calculation:

  ```
  Pillars: 庚寅 乙酉 戊午 丙子, DM=戊
  Breaker_el = 火 (clashes 化金)
  Outer loop matches 丙 (hour stem, 火).
  Inner loop checks 丙 in any hidden[:2]:
    寅: hidden[:2]=['甲', '丙'] → 丙 FOUND → breaker_strong=True
    (terminates)
  Result: breaker_strong=True → 真化 does NOT fire
  Test expects: ('year', '庚') in result → FAIL
  ```

  Two paths to fix:

  **Path A (recommended)**: Replace 寅 with a non-丙-containing branch.
  Suggested fixture: `庚辰 乙酉 戊午 丙子` (年柱: 庚辰 is valid 60甲子).
  - 辰[:2]=['戊','乙'] — no 丙 ✓
  - 酉[:2]=['辛'] — no ✓
  - 午[:2]=['丁','己'] — no 丙 (strict same-stem) ✓
  - 子[:2]=['癸'] — no ✓
  Result: breaker_strong=False → 真化 fires → test passes.

  Note: Need to also re-verify the (i)-(iv) gates pass for `庚辰 乙酉 戊午
  丙子`:
  - (i) Adjacent: 庚乙 are year-month, 五合 ✓
  - (ii) 月令=酉, season multiplier for 金 in 酉 = 1.8 (旺) ≥ 1.5 ✓
  - (iii) 化神 (金) has root: 酉=辛 (本氣 金) ✓
  - (iv) No 沖 on 寅/酉: would need to check. 酉 沖 卯 (not in chart),
        辰 沖 戌 (not in chart). Should be fine but verify in
        implementation.

  **Path B**: Tighten the fix to `hidden[0]` (本氣 strict only). This
  changes doctrine — 中氣 breakers no longer count. Bazi-master
  verification specifically argued FOR the `hidden[:2]` (本氣+中氣)
  doctrine. Path A is the right fix.

- **S7.2 (NON-BLOCKER)**: `stem in hidden[:2]` edge case for single-stem
  branches. Verified: `子=[癸]`, `卯=[乙]`, `酉=[辛]` all have
  `hidden[:2]` = the 1-element list. `'丙' in ['癸']` returns `False`
  cleanly (no IndexError). Python slice on shorter list returns the full
  list. No issue.

---

## Verdict reasoning

The plan is structurally sound — 4 commits, sensible ordering (docs first,
flag flip second under harness gate, defensive corrections third, behavior
change last), correct cache version bumps, sensible risk framing, and the
prior phase reviews' protocol of "harness re-run as merge gate" preserved.
The Pattern 3a "DO NOT FLIP" guard rail is exactly the right shape (concrete
gates listed, not vague hand-waving).

What blocks "Approve, ship it" is **S7.1**: the Direction A test fixture
contradicts the proposed fix's own semantics. As written, the test would
fail — and since this is the only test exercising the Direction A behavior
change, that failure would either (a) get caught at PR time and force a
fixture revision, or (b) get hand-edited to drop the assertion (which would
defeat the test's purpose). It's a 5-minute fix (replace 寅 with 辰 in the
fixture, re-verify gates ii/iii/iv pass). But it must be fixed in the plan
before implementation, not discovered mid-implementation.

The arithmetic inconsistency (S2.1, three different post-12f test counts)
is small but a real planning slip. Combined with S7.1, S2.2, and the
narrative/code mismatch in S6.2, the plan needs one more revision pass
before approval.

---

## What MUST change before approval

1. **Fix Direction A test fixture (S7.1)**. Replace `庚寅 乙酉 戊午 丙子`
   with `庚辰 乙酉 戊午 丙子` (or equivalent fixture with no 丙-containing
   中氣). Re-verify gates (i)-(iv) pass for the replacement. Update the
   docstring narrative to match the fixture (S6.2).

2. **Reconcile the Direction A narrative (S2.2 / S6.2)**. Either:
   - Acknowledge in the test docstring that the fix uses `hidden[:2]`
     (本氣+中氣), and adjust fixture per #1; OR
   - Reconfirm with bazi-master verification that the strict semantics
     should be 本氣 only and update the fix code accordingly. The
     verification doc explicitly recommended `hidden[:2]`, so #1 (fixture
     change) is the right path.

3. **Pick one post-12f test count and use it consistently (S2.1)**. Or
   defer the count to a post-implementation Commit-4-footer measurement
   (preferred, matches Phase 12d/12e protocol).

## What SHOULD change but is optional

4. **Replace `test_v2_score_floor_at_zero` with a real floor exercise
   (S3.1)**. Either monkeypatch the Pattern 2b function to drive total
   negative, or drop the test and rely on the inline comment as
   documentation. As written it adds zero value.

5. **Drop `test_v2_score_ceiling_at_100` placeholder (S1.2)**. Pure no-op;
   if the cap question matters, file as a Phase 12g TODO instead.

6. **Add post-deploy .env warning to Commit 2 runbook (S5.2)**. One line:
   "If you previously set `BAZI_USE_WEIGHTED_IMBALANCE=0` in your local
   .env, remove it or set to `=1` to match the new code default."

7. **Resolve consolidation ambiguity (S2.4)**. Pick one path: either the
   consolidated table replaces the older two, or it cross-references them.
   Don't leave the choice to the implementer.

8. **Move the strict-vs-loose 通根 footer note inline (S2.3)**. Place
   alongside Phase 12d Pattern 3b doctrine instead of bottom of cross-
   cutting section, where it's discoverable when someone is reading
   Pattern 3b.
