# Phase 12d Implementation Plan Review v1

**Reviewer**: staff engineer
**Date**: 2026-04-28
**Plan version reviewed**: v1 (`.claude/plans/phase_12d_implementation_plan.md`)
**Verdict**: **Needs rework**

---

## Issue counts

| Bucket | Count |
|---|---|
| S1 — Style / nits | 4 |
| S2 — Documentation / clarity | 4 |
| S3 — Test coverage gaps | 4 |
| S4 — Cascading effects / ordering | 3 |
| S5 — Backward compat concerns | 2 |
| S6 — Doctrinal drift from Phase A | 3 |
| S7 — Code correctness (blockers) | 7 |
| **Total** | **27** |

---

## Issues (lowest → highest priority)

### S1 — Style / nits (lowest priority)

- **S1.1** `Commit 5 — 3b-1` docstring opens with `"""\n    Detect stems that meet 真化 ..."""` and uses prose-y `Mirror's` (typo: should be `Mirrors`).
- **S1.2** Six per-rule env-flag literal-string `os.environ.get(...).lower() in ('1','true','yes','on')` is repeated verbatim across all 6 commits. Existing convention in `five_elements.py:41-43` uses a private module constant set at import-time (`_USE_WEIGHTED_IMBALANCE`). Plan should mirror that convention to ensure tests can monkeypatch the constant cleanly (existing tests do this — see `tests/test_ten_gods_imbalance.py`).
- **S1.3** `Commit 2 — 2c-1` adds `SAN_HE_TRINITIES` to `constants.py` next to `BAN_HE_*_MULTIPLIER` constants but the file already organizes constants by section (旺相休囚死, 神煞, etc.) — the plan doesn't say where to insert, increasing review friction.
- **S1.4** `Commit 6 — 3a-2` returns dict whose `'name'` ranges over `從強格 / 從旺格`. Comment says "Could refine to 一行得氣 sub-name later" — the constant `PATTERN_3A_*` set provides no place to disambiguate 曲直/炎上/稼穡/從革/潤下 sub-names. Naming is downstream-cosmetic but the Phase A doc specifically names 5 sub-types — capturing them via a small lookup is trivial work that's deferred without justification.

### S2 — Documentation / clarity

- **S2.1** Plan states "All commits use per-rule env flags so any single fix can be disabled" then sets `PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR=0` as the lone default-OFF flag. This is fine, but the section header at line 19 says "Default in dev/staging: ON" without a per-flag breakdown table; readers must scan the inline comment to spot 3a's exception.
- **S2.2** Cross-cutting concern §6 (cache invalidation) reads "Operator runs FLUSHALL + `DELETE FROM reading_cache` post-deploy" — this contradicts CLAUDE.md's standard rollout (FLUSHALL-only after preAnalysisVersion bump). Confirm whether DB cache also needs purging, or drop the second statement.
- **S2.3** Risk note in `Commit 5` says "Add a guard at the top of `check_cong_ge`: if `day_master_stem in [s for (_, s) in transformed_stems]`, return None." This is doctrine-load-bearing per Phase A (DM-involved 五合 must NOT 從格), but the actual 3b-2 implementation block does NOT include the guard. Reader has to cross-reference the Risks subsection to find missing code — easy to miss.
- **S2.4** Plan claims `1g — Re-run harness post-commit; expect 用神 agreement: 58% → 66% (+4 charts × 2 = 8 percentage points)`. Per the same plan's own "Borderline V2=39" note (line 170), `ziping_shen_lufen` is V2=34.1 (`weak`) and `dts_hezhi_long_ji_dm` is V2=44.2 (`neutral`) — these have different fates depending on whether Pattern 2 has shipped yet. Since Commit 1 ships before any V2 strength fix, only the chart with V2 ≥ 40 (`liang_chengxiang` 42.7, `qin_longtu` 39.9 — borderline, `long_ji_dm` 44.2) might fire. `shen_lufen` and `qin_longtu` (V2=39.9 `weak`) won't fire until Pattern 2 raises them above 40. The "+8pp" estimate is optimistic. (See S4.2 below.)

### S3 — Test coverage gaps

- **S3.1** No proposed test exercises Pattern 1 + Pattern 2c + Pattern 2a + Pattern 2b composed in sequence on a single chart (e.g., `dts_hezhi_long2` which Phase A flagged as borderline). The 6 individual test files don't include cross-pattern interaction tests beyond anchor regression. Recommend a `test_phase_12d_integration.py` with 5-10 cross-pattern composition tests.
- **S3.2** No test asserts `BAZI_USE_WEIGHTED_IMBALANCE=0` with all 6 Phase 12d flags on still produces sensible output — i.e., what happens when the new patterns layer on top of the *raw-count* dominance fallback path? Pattern 1's helper calls `compute_weighted_category_scores` regardless of the BAZI_USE_WEIGHTED_IMBALANCE flag — but the original path uses raw counts, leading to potential inconsistency between Pattern 1's trigger and the dominant detection running underneath.
- **S3.3** "Test count delta" (line 928) sums to +32 tests but `+1 harness re-baseline integration test` is mentioned at line 938. Delta math `1914 + 33 = 1947` matches but only 32 tests are itemized — inconsistency.
- **S3.4** Per-commit harness re-run protocol (cross-cutting §3) says "Append the run output to `.claude/plans/validation_phase_12d_runs.md` with a heading per commit" but never specifies the file's expected format or what to do if a previously-passing chart regresses. Recommend a "rollback gate" rule: if a previously-passing chart flips to failing, the commit is reverted, not merged.

### S4 — Cascading effects / ordering

- **S4.1** **Pattern 1 + Pattern 3b interaction not tested:** 3b suppresses 印 stems via 真化. After 3b fires, the chart's effective 印 count drops. Pattern 1's trigger uses `cats.get('印星', 0.0)` from `compute_weighted_category_scores`, which does NOT apply 3b's suppression. So Pattern 1's 梟印奪食 cancellation could over-fire on charts where 印 was already neutralized by 3b. Plan does not address this.
- **S4.2** **Commit ordering inverted vs. Phase A doctrine.** Phase A (`validation_fix_doctrine_verification.md` §"Pattern 1 + Pattern 2 ordering", line 50) says explicitly: *"Pattern 2's strength fixes flip several borderline V2=weak charts to neutral. Apply Pattern 2 FIRST so Pattern 1's rule fires on the corrected strength label."* The plan's order is **Pattern 1 → Pattern 2c → Pattern 2a → Pattern 2b**. With Pattern 1 first, charts like `ziping_shen_lufen` (V2=34.1 weak), `ziping_qin_longtu` (V2=39.9 weak) will NOT trigger Pattern 1 because their classification is still `weak`. The `+8pp` agreement claim in `1g` is over-optimistic, and re-running the harness after Commit 1 will not show the expected lift. This is a non-blocking ordering-quality issue but invalidates the per-commit metric reporting plan.
- **S4.3** **Pattern 3a + Pattern 3b cascade:** Plan §3a states "verify both compose correctly in tests where 3b suppresses a 印 stem AND 3a evaluates the post-suppression chart." But 3a's `weighted_categories` argument is computed by `compute_weighted_category_scores` without any 3b suppression — meaning a chart that becomes 從強 only after 真化 stem suppression won't be detected. No test enforces this composition. Risk: possible new 從強 cases missed when both are on, or false positives from un-suppressed counts.

### S5 — Backward compat concerns

- **S5.1** Plan claims "Setting all 6 env flags to 0 must reproduce pre-Phase-12d behavior exactly" (cross-cutting §5). However, the new helper functions (`compute_sanhe_dm_credit`, `_pattern_2a_bijie_boost`, `_pattern_2b_surround_penalty`, `detect_neutral_shishang_outlet`, `detect_true_transformed_stems`, `check_cong_qiang_or_wang`) are **defined regardless of flags**. Their existence alone is fine. But the calls to them are wrapped in env-flag checks via `os.environ.get(...).lower() in (...)` *evaluated at runtime per-call*. This means: each chart calculation does `os.environ.get` 6× per call. Performance implication: trivial. Test implication: monkeypatching env doesn't compose well with the existing pattern (which sets module-level constants at import time per `_USE_WEIGHTED_IMBALANCE`). Recommend `_PATTERN_*` private module constants to match.
- **S5.2** Pattern 1 unconditionally adds the new dominant label `'食傷洩秀'` to `_detect_dominant_imbalance`'s return enum. Existing callers of `_detect_dominant_imbalance` only consume the return string in `determine_favorable_gods`. But the enum is documented in 4 places (docstrings at five_elements.py:476, ten_gods.py:699, etc.). Plan should update all docstrings AND verify no JSON serialization/AI prompt currently keys off the legacy 5-value enum. (Confirmed at grep time: no AI prompt depends on the dominant label string directly — but plan should explicitly call this out.)

### S6 — Doctrinal drift from Phase A

- **S6.1** **Pattern 3b 真化 condition (ii) drifts from Fix D.** Plan §3b-1 uses `SEASON_STRENGTH.get(formed_el, {}).get(month_branch, 3) < 4` (rejects only 休/囚/死, accepts 旺=5 AND 相=4). Phase 12b Fix D (referenced as "mirror" in plan §"Risks") uses `SEASON_MULTIPLIER[化神][month_branch] >= 1.5` which equals score=5 only (`SEASON_MULTIPLIER[5]=1.5`, `SEASON_MULTIPLIER[4]=1.3`). The plan's gate is **strictly looser** than Fix D. This will fire 真化 on charts where Fix D would have rejected. Phase A doc at line 278 actually recommended "≥ 4 (旺/相)" — so the plan matches Phase A but contradicts the Fix D reuse claim. Pick one and align: either tighten to `>= 1.5 multiplier` (= score 5) or document the divergence explicitly.
- **S6.2** **Pattern 3a uses `xiShen` but the override block in `generate_pre_analysis` discards it.** Plan §3a-2 returns dict with `xiShen` (correctly set to `i_produce` for 從旺 / `producing` for 從強). But the existing override in `interpretation_rules.py:957-963` only consumes `cong_ge['yongShen']`. Result: for 曲直格 (DM=乙, corpus 用=木 喜=火), engine output will set `favorableGod=木` (wrong; should be 火) and `idleGod=火`. Validation harness measures only 用神, so the `wu_xianggong` flip will count as agreement — but the structural output (5 gods) is semantically wrong. Plan must extend the override block in `generate_pre_analysis` to honor `cong_ge.get('xiShen')` when present, AND special-case the `tabooGod` / `enemyGod` for 從強/從旺 family (currently both forced to `dm_element` and `producing_element` — opposite for 從強 family where DM element IS 用神).
- **S6.3** **Pattern 2a's per-pillar rooted-stem check is silently dropped.** Phase A §"Pattern 2a Edge cases / additions" (line 88) prescribes: "A 比劫 透干 with no root anywhere... should not count toward the boost. Source: 《滴天髓》「干多不如根重」. Engine's `compute_stem_pressure_weight` already grades root_class — leverage that: only `strong` or `weak` rooted 比劫 contribute." Plan §2a-2 helper docstring says the same ("rooted_class ∈ {strong, weak}") but the implementation just reads `bijie_transparent = scores['category_transparent_count'].get('比劫', 0)` — which is a raw count of all transparent 比劫, **not filtered by root class**. Test name `test_no_boost_for_rootless_bijie` exists in §2a-4 but the implementation can't pass it without invoking root_class_cache directly. Either the code is wrong or the test is.

### S7 — Code correctness (blockers)

- **S7.1** **`SIX_OPPOSITIONS` does not exist.** Plan imports `from .branch_relationships import SIX_OPPOSITIONS` in TWO places: `Commit 2 — 2c-2` (line 241) and `Commit 5 — 3b-1` (line 575). Verified: `branch_relationships.py:33-110` defines `SIX_HARMONIES`, `SIX_CLASHES`, `HARMONY_LOOKUP`, `CLASH_LOOKUP`, `TRIPLE_HARMONIES`, `THREE_MEETINGS`, `THREE_PUNISHMENTS`, `SIX_HARMS`, `SIX_BREAKS`. There is no `SIX_OPPOSITIONS`. The 沖 lookup the plan needs is `CLASH_LOOKUP` (a `Dict[str, str]`). **Both commits will fail at import time.**
- **S7.2** **Pattern 2b imports constants from the wrong module.** Plan §2b-2 helper uses `from .constants import (IMBALANCE_WEIGHT_HIDDEN_BENQI, MONTH_BENQI_COMMANDER_MULTIPLIER, PILLAR_ROLE_WEIGHT,)`. Verified via grep: these three constants are defined in `ten_gods.py:412, 540, 543`, NOT `constants.py`. **Import will fail.** Fix: `from .ten_gods import (...)`.
- **S7.3** **Pattern 2c's `HIDDEN_STEMS` import missing.** Plan §2c-2 helper does `HIDDEN_STEMS.get(b, [''])[0]` but the proposed home `branch_relationships.py` only imports `BRANCH_ELEMENT, BRANCH_INDEX` from constants (verified at lines 23-26). The plan does not specify adding `HIDDEN_STEMS` to that import. **NameError at runtime.**
- **S7.4** **Pattern 2c's double-count guard is broken.** Plan §2c-2:
  ```python
  new_credit_branches = [b for b in (wang, sheng, mu)
                         if b in natal_branches
                         and HIDDEN_STEMS.get(b, [''])[0] != dm_element]
  ```
  `HIDDEN_STEMS[b][0]` returns a **stem** (e.g., `'辛'`), `dm_element` is an **element** (e.g., `'金'`). The comparison `'辛' != '金'` is always True — guard never excludes anything. For `dts_hezhi_noble3` (酉丑 半合, DM=辛/金): 酉's 本氣 stem is 辛, which IS the DM stem. The 通根 to 辛 in 酉 is already credited via standard `dedi`. The plan's guard claims to prevent double-counting but doesn't. Fix: `STEM_ELEMENT.get(HIDDEN_STEMS.get(b, [''])[0], '') != dm_element`.
- **S7.5** **Pattern 1's `'財旺'` fast-path doesn't actually re-route the 用神 for neutral DM.** Plan §1c returns `'財旺'` for the 食神生財 chain. But `determine_favorable_gods` for `strength='neutral'` falls into the `else` branch (line 604), which only special-cases `dominant in ('食傷旺', '官殺旺')`. `'財旺'` falls through to default-weak (`useful = dm_element`, `favorable = produces_me`) — i.e., 用=比劫, 喜=印. For `ziping_qin_longtu` (DM=丙 neutral, corpus 用=金財 喜=土食傷), Pattern 1 returns `'財旺'` → engine emits 用=火 (DM element), not 用=金 (corpus). **The plan's claim that this chart is fixed is wrong unless `determine_favorable_gods` also gets a neutral-DM `'財旺'` branch.** Fix: extend `determine_favorable_gods` with a neutral-DM `'財旺'` (food→wealth chain) branch that prescribes useful=i_overcome / favorable=i_produce.
- **S7.6** **Pattern 3a's effective_gods override drops `xiShen` (already documented under S6.2 but doubles as code correctness).** The override block has hardcoded `tabooGod=dm_element, enemyGod=producing_element` — correct for 從弱 family but **inverted** for 從強 family (從強/從旺 charts have DM element AS 用神). Without modification, 曲直格 will emit `tabooGod=木` (= `usefulGod=木`), violating the invariant that all 5 gods are distinct. Could break downstream rendering in `effective_gods` consumers (e.g., `lifetime_enhanced.py`, AI prompts).
- **S7.7** **Missing `import os` in `interpretation_rules.py`.** `Commit 2 — 2c-3`, `Commit 3 — 2a-3`, `Commit 4 — 2b-3`, `Commit 6 — 3a-3` all add `os.environ.get(...)` calls inside `interpretation_rules.py`. The file currently does NOT import `os` (verified via grep at lines 21-47). The plan does not specify adding `import os` at module top. **NameError at runtime.**

---

## Verdict reasoning

**This plan needs rework before implementation.** The doctrinal analysis is sound — Phase A's 5✓/1⚠ verdict carries through, and the high-level shape (per-rule flags, 6 commits, anchor regression suite) is the right architecture. But the executable details of *at least three commits will not run as written* due to mechanical errors:

1. **S7.1, S7.2, S7.3, S7.7** are import errors that will prevent the engine from loading at all.
2. **S7.4** is a logic bug that voids the central claim of Pattern 2c (the double-count guard never fires, so `dts_hezhi_noble3` will get inflated dedi credit beyond the 5×0.5=2.5 the plan promises).
3. **S7.5** breaks Pattern 1's third-target chart (`ziping_qin_longtu`) because the plan threads `'財旺'` through a path that doesn't have a neutral-DM branch.
4. **S7.6** breaks the structural invariant of `effectiveFavorableGods` for 從強 family charts.

The most consequential issue is **S4.2** (commit ordering inverted vs Phase A): Pattern 2's strength fixes need to ship before Pattern 1 to have any effect on the V2-borderline charts (`shen_lufen`, `qin_longtu`). Re-running the harness after Commit 1 with the current order will report ~+2pp lift, not the +8pp claimed, and the engineer will spend hours tracking down a "missing flip" that's actually deferred to Commit 3+. That's wasted effort.

Beyond the blockers, **S6.1, S6.2, S6.3** show drift from Phase A's specific recommendations. Particularly S6.2 (Pattern 3a's broken xiShen propagation) means even the 1 chart Pattern 3a is supposed to flip will only flip for the validation metric, not for the user-visible 5-god output.

The good news: every issue is fixable in a v2 plan revision, and the underlying doctrine is correct. Estimate ~0.5 day of additional planning to address S7.1–S7.7 and S6.x; the body of the implementation work is unchanged.

---

## What MUST change before approval

1. **S7.1**: Replace all `SIX_OPPOSITIONS` references with `CLASH_LOOKUP` (the existing `Dict[str, str]` in `branch_relationships.py:66-73`). Two locations: Pattern 2c §2c-2, Pattern 3b §3b-1.
2. **S7.2**: Fix Pattern 2b's import path. `from .ten_gods import (IMBALANCE_WEIGHT_HIDDEN_BENQI, MONTH_BENQI_COMMANDER_MULTIPLIER, PILLAR_ROLE_WEIGHT,)`.
3. **S7.3**: Add `HIDDEN_STEMS` import to `branch_relationships.py` (or move `compute_sanhe_dm_credit` to a different file with the imports already in scope).
4. **S7.4**: Fix Pattern 2c double-count guard: compare element-to-element via `STEM_ELEMENT.get(HIDDEN_STEMS.get(b, [''])[0], '')`.
5. **S7.5**: Add neutral-DM 財旺 branch to `determine_favorable_gods` so Pattern 1's 食神生財 path emits the right 用=財/喜=食傷.
6. **S7.6 / S6.2**: Extend `effective_gods` override in `generate_pre_analysis` to consume `cong_ge.get('xiShen')` AND special-case 從強/從旺 (dm_element is 用神, not 忌). Add a 4-key invariant test that all 5 gods are distinct.
7. **S7.7**: Add `import os` to `interpretation_rules.py`.
8. **S4.2**: Either reorder commits (Pattern 2c → 2a → 2b → 1 → 3b → 3a) per Phase A's recommendation, OR rewrite the per-commit agreement-target estimates to reflect that Pattern 1's full effect manifests only after Pattern 2 ships. Adjust `1g` claim from "+8pp" to "+2-4pp; remaining lift after Pattern 2".
9. **S6.3 / S2.3**: Implement the rooted-比劫 filter in Pattern 2a's helper (`_pattern_2a_bijie_boost`) per the docstring claim. Implement the DM-involved-五合 guard in Pattern 3b's caller (`check_cong_ge`) per the Risks-section recommendation.
10. **S6.1**: Pick one — either `>= 4` (per Phase A doc) or `>= 1.5 multiplier` (Fix D mirror). Update the docstring claim accordingly.

## What SHOULD change but is optional

- **S1.2**: Convert per-rule env-flag string-checks into module-level `_PATTERN_*` constants (mirroring `_USE_WEIGHTED_IMBALANCE` convention) for testability.
- **S3.1**: Add `test_phase_12d_integration.py` with cross-pattern composition tests on borderline charts (e.g., `dts_hezhi_long2`, `dts_hezhi_noble3`).
- **S3.4**: Codify the rollback gate as a docstring rule on `run_imbalance_validation.py`.
- **S2.1**: Add an explicit per-flag default table near the top of the plan.
- **S1.4**: Add a sub-name lookup for 從強格 / 曲直 / 炎上 / 稼穡 / 從革 / 潤下 in Pattern 3a.
- **S5.1**: Add a smoke test that asserts all 6 flags off + `BAZI_USE_WEIGHTED_IMBALANCE` off reproduces pre-Phase-12d output byte-identical on the 50-chart corpus.
- **S5.2**: Update the docstrings of `_detect_dominant_imbalance` and `detect_dominant_imbalance_weighted` to include `'食傷洩秀'` in the return-value enum.

---

**Bottom line**: The plan reflects solid doctrinal homework, but the executable code as written will not compile (S7.1-S7.3, S7.7), has logic bugs in two patterns (S7.4, S7.5, S7.6), and reverses the Phase A-recommended commit ordering (S4.2). Address the must-changes in v2 and resubmit.
