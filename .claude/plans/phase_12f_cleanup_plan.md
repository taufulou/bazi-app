# Phase 12f Cleanup Plan v3 — Code review fixes + BAZI flag flip + Pattern 3a guard rail

**Origin**: PR #38 code review surfaced 9 issues. Issue B (test count) was posted to PR (score 82). Issues A, C, D+G, E, F, H, I were below the 80-confidence threshold but are real and warrant cleanup. Plus user request: flip `BAZI_USE_WEIGHTED_IMBALANCE` to ON (the bigger change Issue I points at) AND strengthen Pattern 3a's "DO NOT FLIP" guard rail.

**Issue F doctrine verification**: Bazi-master sub-agent verified Issue F is a REAL bug (in TWO directions — reviewer only spotted one). Fix is doctrinally aligned with 滴天髓·假化 「化神被克」. Risk is minimal: only 1 corpus chart (`ziping_niu_jianbo`) shows behavior difference and that chart's V2=55 short-circuits `check_cong_ge` → no chart-level outcome change. Anchor charts (Roger, Laopo, `anchor_cong_cai_yiwuming`) all unaffected. See `.claude/plans/phase_12f_issue_f_doctrine_verification.md`.

**Goal**: cleanup-class PR addressing all 9 issues + 2 user-requested guard rails. Single branch, 4 commits, low-risk overall.

**v1 → v2 changes**:
- Issue F implementation refined per bazi-master verdict (cleaner code structure, doctrinal alignment with 滴天髓 strict-rooting interpretation)
- Test fixtures for Issue F use the actual `ziping_niu_jianbo` corpus chart (Direction B regression) + a constructed Direction A chart per bazi-master recommendation
- Documentation note added about strict vs loose 通根 stance choice (Pattern 3b stricter than Phase 12b Fix D's element-match — consistent with chart-level 從格 doctrine)

**v2 → v3 changes** (Phase D staff-engineer review feedback):
- **S7.1 (BLOCKER) fix**: Direction A test fixture was `庚寅 乙酉 戊午 丙子` but 寅[:2] = ['甲', '丙'] contains 丙 in 中氣 → fix would block 真化 → test would fail. Replaced with `庚辰 乙酉 戊午 丙子` (辰 hidden=[戊,乙,癸], no 丙 in 本氣 OR 中氣). Verified all gates (i-iv) still pass with new fixture.
- **S6.2 fix**: Docstring narrative now correctly describes `hidden[:2]` (本氣 OR 中氣) semantics; previously said "本氣 only" which contradicted the proposed code.
- **S2.1 fix**: Test count predictions removed; defer to Commit-4-footer measurement (matches Phase 12d/12e protocol).
- **S3.1 fix**: V2 floor test now uses monkeypatch to actually drive total negative (per reviewer recommendation).
- **S1.2 fix**: Placeholder `test_v2_score_ceiling_at_100` dropped (no-op test).
- **S5.2 fix**: Added .env warning line to Commit 2's operator runbook.
- **S2.4 fix**: Consolidated env flag table EXPLICITLY replaces the older two; older sections are removed.
- **S2.3 fix**: Strict-vs-loose 通根 note moved inline alongside Phase 12d Pattern 3b doctrine (replaces bottom-of-cross-cutting placement).

**Source documents**:
- PR #38 code review comments + scoring transcripts
- `CLAUDE.md` "Phase 12d" + "Phase 12e" subsections
- Engine code at `packages/bazi-engine/app/`

---

## Branch + 4-commit structure

Branch: `claude/phase-12f-cleanup` (off `main` after PR #38 merges)

### Commit ordering (load-bearing)

1. **Commit 1**: docs cleanup (A, B, C, Pattern 3a guard rail) — pure documentation, no behavior change
2. **Commit 2**: BAZI_USE_WEIGHTED_IMBALANCE flag flip (I) — code default change, harness re-run required
3. **Commit 3**: safe code corrections (D+G, E) — docstring + defensive floor, no behavior change
4. **Commit 4**: Pattern 3b breaker fix (F) + Pattern 2a'' test coverage (H) — gated on harness re-run

The order is deliberate: docs first (free), behavioral flag change second (most consequential, validate everything still passes), trivial corrections third, behavioral code fix last with full validation gate.

---

## Commit 1 — docs(claude.md): Phase 12 cleanup + Pattern 3a guard rail

**Issues addressed**: A (Gate 1 stale note), B (test count), C (flags scattered), Pattern 3a guard rail

### Files modified
- `CLAUDE.md` only

### Changes

**1-1 — Test count fix (Issue B)** at line 136:

Current:
```
- Bazi Engine: 1994 (1988 pass, 4 xfail, 1 skip, 1 pre-existing fail unrelated)
```

Replace with (verified via `pytest --collect-only -q | tail -1`):
```
- Bazi Engine: 1989 (1983 pass, 4 xfail, 1 skip, 1 pre-existing fail unrelated)
```

**1-2 — Gate 1 stale note fix (Issue A)** at the existing `BAZI_USE_WEIGHTED_IMBALANCE` Note block (around line 758):

Current:
```
> **Note on `BAZI_USE_WEIGHTED_IMBALANCE` default**: code default is `'0'` (OFF)
> in `packages/bazi-engine/app/five_elements.py`, NOT `'1'`. The "Default ON in
> dev/staging" line above describes the *intent*; current state is OFF pending
> validation harness completion. Flag-flip blocked on:
> 1. Completion of the n=50 expert-labeled chart CSV at
>    `packages/bazi-engine/tests/validation/expert_labeled_charts.csv`
> 2. Bazi-master sign-off on 3 known compatibility regressions at
>    `tests/test_compatibility_gold_standard.py::TestScoreRanking`
> 3. Operator runs `tests/validation/run_imbalance_validation.py` and confirms
>    ≥95% agreement
> 
> Tracker: file separate "Phase 12 Fix 1a default ON" PR after gates clear.
> Until then, the documented Laopo 用神 木→水 outcome only manifests when the
> env var is explicitly set to `'1'`.
```

This entire block will be REPLACED in Commit 2 (when we flip the flag). For Commit 1 (docs only), update the gate status only:

```
> **Note on `BAZI_USE_WEIGHTED_IMBALANCE` default**: code default is `'0'` (OFF)
> in `packages/bazi-engine/app/five_elements.py`, NOT `'1'`. The "Default ON in
> dev/staging" line above describes the *intent*; current state is OFF pending
> Bazi-master sign-off. Flag-flip blocked on:
> 1. ✅ Completion of the n=50 expert-labeled chart CSV at
>    `packages/bazi-engine/tests/validation/expert_labeled_charts.csv` (DONE in PR #38)
> 2. ⏳ Bazi-master sign-off on 3 known compatibility regressions at
>    `tests/test_compatibility_gold_standard.py::TestScoreRanking`
>    (4 xfailed in Phase 12d; awaits product-owner waiver or Bazi-master review)
> 3. ✅ Operator runs `tests/validation/run_imbalance_validation.py` and confirms
>    ≥95% agreement (98% under `--accept-doctrinal-splits` post-Phase-12d/e)
> 
> 2 of 3 gates clear. Tracker: file separate "Phase 12 Fix 1a default ON" PR
> after Gate 2 clears OR product-owner explicitly waives Bazi-master review.
> Until then, the documented Laopo 用神 木→水 outcome only manifests when the
> env var is explicitly set to `'1'`.
```

Note: this block will be FURTHER updated in Commit 2 to reflect flag flip.

**1-3 — Pattern 3a "DO NOT FLIP" guard rail (user-requested)** at the env flags table around line 514-522:

Current:
```bash
PHASE_12D_PATTERN_2C_SANHE_CREDIT=1
PHASE_12D_PATTERN_2A_BIJIE_BOOST=1
PHASE_12D_PATTERN_2B_SURROUND_DAMPENER=1
PHASE_12D_PATTERN_1_NEUTRAL_BRANCH=1
PHASE_12D_PATTERN_3B_HUAQI_SUPPRESSION=1
PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR=0   # default OFF
```

Replace with:
```bash
PHASE_12D_PATTERN_2C_SANHE_CREDIT=1
PHASE_12D_PATTERN_2A_BIJIE_BOOST=1
PHASE_12D_PATTERN_2B_SURROUND_DAMPENER=1
PHASE_12D_PATTERN_1_NEUTRAL_BRANCH=1
PHASE_12D_PATTERN_3B_HUAQI_SUPPRESSION=1
PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR=0   # ⚠️ DO NOT FLIP — see guard rail below
PHASE_12E_PATTERN_2A_PP_NON_MONTH=1
```

Then add a NEW prominent guard rail block immediately after:

```markdown
> ⚠️ **DO NOT flip `PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR` to `1` without
> completing all three Phase 12f gates**:
> 1. Bazi-master audit of 4 false-positive charts: `li_zhifu`,
>    `edge_cong_sha_boundary`, `edge_yin_heavy_strong_yi`, `edge_bijie_strong_jia`
>    (where corpus picks non-從格 doctrine despite 比劫+印 dominance)
> 2. Threshold re-tuning if false-positives confirmed (V2≥70 + 比劫+印≥70%
>    may need refinement)
> 3. ≥6 months production observation period without complaints
>
> When flag is enabled with current thresholds, harness shows -2pp net
> agreement (1 chart fixed, 4 charts break). The flag is opt-in for a reason.
> Verified at PR #38 / Phase 12d Pattern 3a ship. See
> `.claude/plans/phase_12d_review_v2.md` for the audit context.
```

**1-4 — Phase 12d/12e flag table consolidation (Issue C)** in the "Per-rule env flags (rollback path)" section around line 741-756.

**Approach (S2.4 fix)**: The consolidated table at line 741 REPLACES the inline flag listings in the Phase 12d section (around line 514-522) and any other scattered flag mentions. The Phase 12d section will instead cross-reference: "See consolidated rollback table at line 741."

Update line 741-756 from current Phase 12b/12c-only list to all-phases:

```bash
# Phase 12 Fix 1a (chart-level 用神 cascade)
BAZI_USE_WEIGHTED_IMBALANCE=1   # Phase 12 Fix 1a (see Note below)

# Phase 12b monthly forecasts
PHASE_12B_FIX_A=1               # 蓋頭/截腳 halving
PHASE_12B_FIX_B=1               # 伏吟 multi-pillar role-conditional
PHASE_12B_FIX_C_ENABLED=1       # 殺印/官印相生 transient
PHASE_12B_FIX_D_TRUE_TRANSFORMATION_ENABLED=1   # 六合 真化

# Phase 12c monthly forecasts
PHASE_12C_FIX_E_ENABLED=1       # 六害 role-aware
PHASE_12C_FIX_F_ENABLED=1       # 沖庫釋放方向性

# Phase 12d 用神 validation gate fixes
PHASE_12D_PATTERN_2C_SANHE_CREDIT=1            # 三合/半合 V2 dedi
PHASE_12D_PATTERN_2A_BIJIE_BOOST=1             # 比劫 透干 boost
PHASE_12D_PATTERN_2B_SURROUND_DAMPENER=1       # 月令祿 surround dampener
PHASE_12D_PATTERN_1_NEUTRAL_BRANCH=1           # neutral DM 食傷洩秀
PHASE_12D_PATTERN_3B_HUAQI_SUPPRESSION=1       # 真化 stem suppression
PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR=0     # ⚠️ DO NOT FLIP (see guard rail above)

# Phase 12e
PHASE_12E_PATTERN_2A_PP_NON_MONTH=1            # non-month 比劫祿/羊刃 boost
```

After populating the consolidated table at line 741, REMOVE the now-redundant Phase 12d inline flag listing at lines 516-521 and replace with: "Per-rule env flags: see consolidated rollback table below (line 741)."

Same treatment for any other scattered flag mentions (e.g., the Phase 12e section's mention of `PHASE_12E_PATTERN_2A_PP_NON_MONTH=1`).

### Risks
- Pure documentation change. Zero behavioral impact.
- Risk if I miss a section: leave a stale "1994" or "blocked on" reference. Mitigation: grep verification step below.

### Verification
- `grep -n "1994\|1988 pass\|blocked on" CLAUDE.md` should return zero results (or only contextually-correct references — e.g., "blocked" inside Phase 12f errata that quotes the prior gate language).

---

## Commit 2 — feat(engine): flip BAZI_USE_WEIGHTED_IMBALANCE default ON (Issue I)

**Issues addressed**: I (BAZI flag is OFF but should be ON for documented behavior)

### Background

Per CLAUDE.md, the flag-flip is gated on:
- ✅ Gate 1: n=50 chart CSV completion (DONE in PR #38)
- ⏳ Gate 2: Bazi-master sign-off on 3 compat regressions (Phase 12d already xfailed 4 tests; product-owner explicitly waives this gate per user direction)
- ✅ Gate 3: Validation harness ≥95% agreement (98% under `--accept-doctrinal-splits`)

User has authority to waive Gate 2 as product owner. Phase 12d already documented the compat regressions as accepted-doctrinal (4 xfailed tests with `strict=False`).

### Files modified
- `packages/bazi-engine/app/five_elements.py` (1-line code change)
- `CLAUDE.md` (note block update)
- `apps/api/.env` (NOT modified — code default change is canonical; .env override remains optional)
- `apps/api/src/ai/ai.service.ts` (cache version bump for the flag flip)

### Changes

**2-1 — Flip code default** in `five_elements.py:41-43`:

Current:
```python
_USE_WEIGHTED_IMBALANCE: bool = os.environ.get(
    'BAZI_USE_WEIGHTED_IMBALANCE', '0'
).lower() in ('1', 'true', 'yes', 'on')
```

Replace with:
```python
_USE_WEIGHTED_IMBALANCE: bool = os.environ.get(
    'BAZI_USE_WEIGHTED_IMBALANCE', '1'
).lower() in ('1', 'true', 'yes', 'on')
```

**2-2 — Update CLAUDE.md note** to reflect post-flip status:

Replace the entire `BAZI_USE_WEIGHTED_IMBALANCE` Note block with:

```markdown
> **Note on `BAZI_USE_WEIGHTED_IMBALANCE` default (post-Phase-12f)**: code
> default is now `'1'` (ON) in `packages/bazi-engine/app/five_elements.py`.
> Phase 12 Fix 1a is active by default. The flag-flip preconditions:
> 1. ✅ n=50 expert-labeled chart CSV (PR #38)
> 2. ✅ Product-owner waiver of Bazi-master sign-off (user explicit, Phase 12f).
>    The 4 known compat regressions in `test_compatibility_gold_standard.py`
>    are already documented as `@pytest.mark.xfail(strict=False)` per Phase 12d
>    Pattern 1 doctrinal-split categorization.
> 3. ✅ Validation harness ≥95% agreement (98% under
>    `--accept-doctrinal-splits` post-Phase-12d/e)
> 
> Rollback: set `BAZI_USE_WEIGHTED_IMBALANCE=0` in env to revert to pre-Fix-1a
> raw-count dominance detection.
```

**2-3 — Cache version bump** in `apps/api/src/ai/ai.service.ts`:

Default-flag change cascades through downstream readings. Bump:
- LIFETIME: v2.6.0 → v2.7.0
- CAREER: v2.4.0 → v2.5.0
- ANNUAL: v2.2.0 → v2.3.0
- Comparison: v1.4.0 → v1.5.0

### Tests
- Existing `tests/test_ten_gods_imbalance.py` already has tests for both flag states (monkeypatched). No new tests needed; existing tests should still pass since the flag is consumed via module-level constant `_USE_WEIGHTED_IMBALANCE` which tests already monkeypatch.
- Update any test that asserts `_USE_WEIGHTED_IMBALANCE is False` by default to assert `True` instead.

### Validation harness re-run (mandatory gate)

After commit 2 lands locally:
```bash
cd packages/bazi-engine
source .venv/bin/activate
python tests/validation/run_imbalance_validation.py --accept-doctrinal-splits
```
Expect: 用神 agreement ≥ 95% in flag-ON mode (since the harness now defaults to flag-ON behavior throughout).

### Risks
- **xfail → XPASS shift**: 4 documented xfails in `test_compatibility_gold_standard.py` may flip to XPASS (test passes despite xfail decoration). pytest treats this as a warning, not failure. If XPASS, leave the xfail markers alone for now (Phase 12g cleanup).
- **Test fixture regression**: Some unit tests may rely on the old default. Run full suite + investigate any failures.
- **Real-user impact**: Existing cached readings continue showing pre-Fix-1a output until cache flushed. The cache bump in 2-3 forces regeneration.

### Operator runbook (post-merge to main)
```bash
# 1. Cache invalidation (REQUIRED — preAnalysisVersion bumped)
redis-cli FLUSHALL
psql -U bazi_user -d bazi_platform -c "DELETE FROM reading_cache;"

# 2. Rebuild + restart
cd apps/api && nest build && pm2 restart api
```

**Local dev environment warning**: If you previously set
`BAZI_USE_WEIGHTED_IMBALANCE=0` in your local `apps/api/.env` to
reproduce flag-off behavior, REMOVE that line OR change to
`BAZI_USE_WEIGHTED_IMBALANCE=1` to match the new code default.
Stale `=0` overrides will silently revert your local install to
pre-Fix-1a engine output despite the code change. Verify post-deploy
with: `grep BAZI_USE_WEIGHTED_IMBALANCE apps/api/.env || echo "Not set in .env (will use code default '1')"`.

---

## Commit 3 — fix(engine): docstring + defensive V2 floor (Issues D+G, E)

**Issues addressed**: D+G (docstring missing 食神生財), E (V2 total can theoretically go negative)

### Files modified
- `packages/bazi-engine/app/five_elements.py` (docstring fix)
- `packages/bazi-engine/app/interpretation_rules.py` (1-line floor)
- `packages/bazi-engine/tests/test_phase_12d_pattern_1.py` OR new test file (1 invariant test)

### Changes

**3-1 — Docstring fix in `_detect_dominant_imbalance`** in `five_elements.py:476-490`:

Current return-enum line:
```
Returns one of:
  '食傷旺' | '財旺' | '官殺旺' | '印旺' | '比劫旺' | '食傷洩秀'
  | 'general' | 'cong_overridden'

Phase 12d adds '食傷洩秀' for neutral / strong DM with 食傷 透干 outlet.
```

Replace with:
```
Returns one of:
  '食傷旺' | '財旺' | '官殺旺' | '印旺' | '比劫旺'
  | '食傷洩秀' | '食神生財'
  | 'general' | 'cong_overridden'

Phase 12d adds '食傷洩秀' (drain via 食傷 outlet) and '食神生財' (chain
to 財 endpoint). Both fire for DM with 食傷 carrier per Pattern 1
heaviness/structural-support gates.
```

**3-2 — V2 total defensive floor** in `interpretation_rules.py` `calculate_strength_score_v2` total computation:

Current:
```python
total = round(
    deling + dedi + deshi + pattern_2a_boost - pattern_2b_flat_penalty, 1)
```

Replace with:
```python
total = round(
    deling + dedi + deshi + pattern_2a_boost - pattern_2b_flat_penalty, 1)
total = max(total, 0.0)  # Phase 12f defensive floor — V2 contract is [0, 100]
```

**3-3 — Invariant tests** in `tests/test_phase_12f_invariants.py` (NEW):

```python
"""Phase 12f invariant tests — V2 score floor + dominant enum completeness."""

import pytest

from app import interpretation_rules as ir
from app.interpretation_rules import calculate_strength_score_v2
from app.five_elements import _detect_dominant_imbalance


class TestV2ScoreFloor:
    """V2 score must never go below 0 per contract.

    Phase 12f S3.1 fix: real exercise of the floor via monkeypatch
    (the natural-chart yao_pinwo only reaches V2=31.3, not negative —
    insufficient to verify the floor activates). Monkeypatch
    `_pattern_2b_surround_penalty` to return an extreme flat penalty,
    then verify the floor clamps total to 0.0 instead of negative.
    """

    def test_v2_score_floor_clamps_negative_to_zero(self, monkeypatch):
        """Force Pattern 2b to return an extreme penalty large enough to
        drive total negative. With floor in place, total = max(round(...),
        0.0) = 0.0 (not negative)."""
        # Patch Pattern 2b to return: (deling_cut=0, flat_penalty=80, fired=True)
        # On yao_pinwo: deling=50, dedi=~5, deshi=~5, pattern_2a_boost=0
        # Without floor: total = 50 + 5 + 5 + 0 - 80 = -20 (negative, violates contract)
        # With floor: total = max(-20, 0.0) = 0.0
        def _fake_pattern_2b(pillars, dm_stem, deling):
            return (0.0, 80.0, True)

        monkeypatch.setattr(
            ir, '_pattern_2b_surround_penalty', _fake_pattern_2b)

        pillars = {
            'year':  {'stem': '辛', 'branch': '丑'},
            'month': {'stem': '癸', 'branch': '巳'},
            'day':   {'stem': '丙', 'branch': '子'},
            'hour':  {'stem': '丁', 'branch': '酉'},
        }
        result = calculate_strength_score_v2(pillars, '丙')
        # Floor must clamp; without floor this would be negative
        assert result['score'] == 0.0, \
            f"V2 floor failed; got {result['score']}"
        # Classification must remain valid (very_weak threshold)
        assert result['classification'] == 'very_weak'

    def test_v2_score_does_not_clamp_positive_values(self):
        """Sanity check: floor must not mangle valid positive scores.
        Roger's V2=39.0 should remain 39.0 with the floor in place."""
        pillars = {
            'year':  {'stem': '丁', 'branch': '卯'},
            'month': {'stem': '戊', 'branch': '申'},
            'day':   {'stem': '戊', 'branch': '午'},
            'hour':  {'stem': '庚', 'branch': '申'},
        }
        result = calculate_strength_score_v2(pillars, '戊')
        assert result['score'] == pytest.approx(39.0, abs=0.1)
```

Note: `test_v2_score_ceiling_at_100` placeholder dropped (no-op test per Phase D S1.2 feedback). Cap-at-100 enforcement is out of scope for Phase 12f; if the cap question matters, file as a Phase 12g TODO.

**3-4 — Dominant enum completeness test** in same file (`tests/test_phase_12f_invariants.py`):
```python
class TestDominantEnumCompleteness:
    """Verify all documented dominant labels are reachable."""

    def test_food_god_chain_label_returned(self):
        """'食神生財' must be a returnable value from
        _detect_dominant_imbalance per Phase 12d Pattern 1."""
        # qin_longtu fires the 食神生財 chain
        pillars = {
            'year':  {'stem': '己', 'branch': '卯'},
            'month': {'stem': '丁', 'branch': '丑'},
            'day':   {'stem': '丙', 'branch': '寅'},
            'hour':  {'stem': '庚', 'branch': '寅'},
        }
        from app.ten_gods import get_ten_god_distribution
        from app import five_elements as fe
        from app.interpretation_rules import calculate_strength_score_v2

        v2 = calculate_strength_score_v2(pillars, '丙')
        tgd = get_ten_god_distribution(pillars, '丙')
        fe._USE_WEIGHTED_IMBALANCE = True
        dom = _detect_dominant_imbalance(
            tgd, v2['classification'], pillars=pillars,
            day_master_stem='丙', is_cong_ge=False)
        assert dom == '食神生財'
```

### Risks
- Floor change: ZERO behavioral impact (no real chart produces negative). Defensive only.
- Docstring change: ZERO behavioral impact.
- Tests: pure additions.

---

## Commit 4 — fix(engine): Pattern 3b breaker check + Pattern 2a'' test gap (Issues F, H)

**Issues addressed**: F (Pattern 3b breaker check too aggressive), H (Pattern 2a'' new activation path untested)

### F has potential accuracy implications — gated on harness re-run.

### Files modified
- `packages/bazi-engine/app/stem_combinations.py` (`detect_true_transformed_stems` breaker check)
- `packages/bazi-engine/tests/test_phase_12f_pattern_3b_breaker.py` (NEW — Issue F regression tests; S1.1 fix routes Phase 12f tests to phase-named file for symmetry)
- `packages/bazi-engine/tests/test_phase_12e_pattern_2a_pp.py` (test for H — extends existing Phase 12e file)

### Changes

**4-1 — Pattern 3b breaker check fix (Issue F)** in `stem_combinations.py`:

Current code (around lines 365-385):
```python
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
```

The bug: outer loop finds breaker stem; inner loop finds ANY 本氣 of breaker_el ANYWHERE. The inner loop is INDEPENDENT of which pillar the breaker stem is in.

Replace with rooted-by-itself semantics (bazi-master verified):

```python
        # (v) No 克 element to 化神 with strong root (本氣 or 中氣 of the
        # SPECIFIC stem). Phase 12f fix (Issue F from PR #38 review):
        # tighten check so breaker stem must have ITS OWN root. The
        # original independent loops were buggy in BOTH directions:
        #   - Direction A: stem present + DIFFERENT element 本氣 elsewhere
        #     spuriously triggered breaker_strong=True
        #   - Direction B: stem rooted in 中氣 (not 本氣) was missed
        # Source: 滴天髓·假化 「克化神之神，或克者被制」; rootless 克
        # stem is effectively 制 by its own weakness (任鐵樵 注).
        breaker_el = ELEMENT_OVERCOME_BY.get(formed_el, '')
        breaker_strong = False
        for pp in ('year', 'month', 'day', 'hour'):
            stem = pillars[pp]['stem']
            if STEM_ELEMENT.get(stem) != breaker_el:
                continue
            # Inner loop NOW LINKED to outer: check this specific stem's
            # own root (本氣 OR 中氣; 餘氣 too weak to count for breaker).
            for pp2 in ('year', 'month', 'day', 'hour'):
                branch = pillars[pp2]['branch']
                hidden = HIDDEN_STEMS.get(branch, [])
                if stem in hidden[:2]:
                    breaker_strong = True
                    break
            if breaker_strong:
                break
        if breaker_strong:
            continue
```

**Behavior change**: Previously, ANY breaker-element-rooted branch counted independently of which pillar held the breaker stem. Now, the breaker STEM must be in 本氣 or 中氣 of some branch (strict yin-yang stem-in-hidden — bazi-master verified this matches 子平 mainstream 通根 doctrine).

**Two real scenarios where behavior changes** (bazi-master findings):

- **Direction A** — buggy says strong=True, fix says strong=False:
  Chart with 丙 stem + 午 branch (no 巳, no 寅, no 戌, no 未). 丙 (陽火) does NOT root in 午 (本氣=丁陰火 only). Buggy code wrongly blocks 真化 because "a 火 stem exists" AND "a 火-本氣 branch exists" match independently. Fix correctly identifies 丙 is rootless → allows 真化.

- **Direction B** — buggy says strong=False, fix says strong=True:
  `ziping_niu_jianbo` (庚寅 乙酉 癸亥 丙辰): 丙 hour stem IS rooted in 寅 中氣. Buggy code misses this (寅's 本氣 = 甲, not 丙). Fix correctly identifies 丙's root → blocks 真化.

This is doctrinally MORE correct per 滴天髓·假化 + suanzhun.net 乙庚化金 conditions: "四柱不能有火來損金，或者有火被制" — rootless 火 is effectively 制 by its own weakness.

**4-2 — Tests for the fix** in NEW file `tests/test_phase_12f_pattern_3b_breaker.py` (per S1.1 — phase-named for symmetry with `test_phase_12d_*` / `test_phase_12e_*`). Bazi-master recommended fixtures + S7.1 fix applied:

```python
class TestPattern3bBreakerStemRootedSemantics:
    """Phase 12f Issue F fix: breaker check requires breaker stem to have
    ITS OWN root (本氣 or 中氣), not arbitrary cross-pillar element match.

    Bazi-master verified per 滴天髓·假化 「克化神之神，或克者被制」 doctrine.
    """

    def test_direction_a_rootless_breaker_does_not_block(self):
        """Direction A regression: 庚辰 乙酉 戊午 丙子, DM=戊.
        乙庚 adjacent → 化金. 丙 (火, breaker for 化金) at hour stem.

        Fix uses `stem in hidden[:2]` (本氣 OR 中氣 strict yin-yang stem
        match). 丙 not in any branch's hidden[:2]:
          - 辰 hidden = [戊, 乙, 癸]; [:2] = [戊, 乙] — 丙 not present ✓
          - 酉 hidden = [辛]; [:2] = [辛] — 丙 not present ✓
          - 午 hidden = [丁, 己]; [:2] = [丁, 己] — 丙 not present ✓
            (under strict yin-yang, 午's 本氣 is 丁陰火, NOT 丙陽火)
          - 子 hidden = [癸]; [:2] = [癸] — 丙 not present ✓
        So 丙 IS rootless under strict same-stem 通根. Fix correctly
        allows 真化.

        Buggy independent-loop code WOULD have blocked 真化 (午 has 火
        本氣 element, matched independently of which pillar held 丙).

        v2 → v3 fix: original fixture had 寅 (中氣=丙), which violated
        the no-丙-in-hidden[:2] premise. Replaced with 辰. All gates
        still pass: (i) 庚乙 adjacent ✓, (ii) 月令=酉, 金 multiplier=1.8 ≥ 1.5 ✓,
        (iii) 化神 root: 酉 本氣=辛=金 ✓, (iv) no 沖 on 辰 (沖=戌 not in chart)
        nor on 酉 (沖=卯 not in chart) ✓.
        """
        pillars = {
            'year':  {'stem': '庚', 'branch': '辰'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '戊', 'branch': '午'},
            'hour':  {'stem': '丙', 'branch': '子'},
        }
        from app.stem_combinations import detect_true_transformed_stems
        result = detect_true_transformed_stems(pillars, '戊')
        # After fix: 真化 fires because 丙 is rootless
        assert ('year', '庚') in result
        assert ('month', '乙') in result

    def test_direction_b_ziping_niu_jianbo_blocks(self):
        """Direction B regression: ziping_niu_jianbo (庚寅 乙酉 癸亥 丙辰).
        乙庚 adjacent → 化金. 丙 (火, breaker for 化金) at hour stem.
        丙 IS rooted in 寅 中氣 (寅 hidden = [甲, 丙, 戊]).
        Buggy code misses this because 寅's 本氣 is 甲 (not 火) — its
        independent loop only checks 本氣. Fix correctly blocks 真化
        since 丙 is in 寅's hidden[:2] (中氣)."""
        pillars = {
            'year':  {'stem': '庚', 'branch': '寅'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '癸', 'branch': '亥'},
            'hour':  {'stem': '丙', 'branch': '辰'},
        }
        from app.stem_combinations import detect_true_transformed_stems
        result = detect_true_transformed_stems(pillars, '癸')
        # After fix: 真化 does NOT fire because 丙 IS rooted
        assert ('year', '庚') not in result
        assert ('month', '乙') not in result

    def test_ziping_niu_jianbo_check_cong_ge_unchanged(self):
        """Direction B regression follow-up: even after fix, the chart-level
        check_cong_ge result is unchanged because V2=55 ≥ 35 → early-return
        at check_cong_ge line 543. Verifies fix doesn't introduce visible
        regression on this corpus chart."""
        pillars = {
            'year':  {'stem': '庚', 'branch': '寅'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '癸', 'branch': '亥'},
            'hour':  {'stem': '丙', 'branch': '辰'},
        }
        from app.interpretation_rules import (
            calculate_strength_score_v2, check_cong_ge,
        )
        from app.five_elements import calculate_five_elements_balance
        v2 = calculate_strength_score_v2(pillars, '癸')
        balance = calculate_five_elements_balance(pillars)
        result = check_cong_ge(pillars, '癸', v2, balance)
        assert result is None
        assert v2['score'] >= 35.0  # V2 short-circuit confirmed

    def test_anchor_cong_cai_yiwuming_unchanged(self):
        """Verify the anchor chart still fires 真化. Both buggy and fixed
        agree because no 火 stem is rooted: 丙 (DM, 火) at day, but
        branches 申/酉/申/丑 contain no 丙 in 本氣 or 中氣."""
        pillars = {
            'year':  {'stem': '庚', 'branch': '申'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '丙', 'branch': '申'},
            'hour':  {'stem': '己', 'branch': '丑'},
        }
        from app.stem_combinations import detect_true_transformed_stems
        result = detect_true_transformed_stems(pillars, '丙')
        # 丙 rootless → breaker_strong=False → 真化 fires (both versions agree)
        assert ('year', '庚') in result
        assert ('month', '乙') in result

    def test_existing_test_breaker_present_still_passes(self):
        """Regression: existing test_breaker_present in test_phase_12d_
        pattern_3b.py expects 丁 火 強根 to block 真化. Verify the fix
        preserves this. Existing test uses pillars with 丁 stem + 巳/午
        branches (where 丁 IS rooted)."""
        # 丁's 本氣 is in 午; 巳 中氣 = 丁 (per HIDDEN_STEMS).
        # The existing test should still pass; this test serves as
        # belt-and-suspenders verification.
        pillars = {
            'year':  {'stem': '庚', 'branch': '申'},
            'month': {'stem': '乙', 'branch': '酉'},
            'day':   {'stem': '丁', 'branch': '午'},
            'hour':  {'stem': '丁', 'branch': '巳'},
        }
        from app.stem_combinations import detect_true_transformed_stems
        result = detect_true_transformed_stems(pillars, '丁')
        # 丁 rooted in 午 (本氣) AND 巳 (中氣); blocks 真化
        assert ('year', '庚') not in result
```

**4-3 — Pattern 2a'' new activation path test (Issue H)** in `test_phase_12e_pattern_2a_pp.py`:

```python
class TestPattern2aPpRootedAtTwoEnemyMonth:
    """Phase 12f Issue H fix: cover the new activation path opened by Phase
    12e's restructure where rooted ≥ 2 + enemy month + qualifying ≥ 2."""

    def test_rooted_2_enemy_month_qualifying_2_fires_pp(self):
        """Synthetic chart: 比劫 透干 ≥ 2 (rooted), month = enemy element
        (not 印 not 比劫), 2+ non-month branches at 臨官/帝旺.
        Pattern 2a'' should fire after fall-through from month-bound paths."""
        # DM=甲. Need: 2 rooted 甲/乙 transparent (not day) + month=食傷地
        # (午=丁=食傷 for 甲) + 2 non-month branches at 臨官(寅)/帝旺(卯).
        # Chart: 甲寅 / 庚午 / 甲寅 / 乙卯
        # year=甲(rooted in 寅本氣), month=庚(NOT 比劫, skipped as transparent),
        # hour=乙(rooted in 卯 餘氣 — actually 乙 in 卯 is 本氣, but counts as rooted via cache)
        # Verify: rooted_bijie_transparent = 2 (year 甲 + hour 乙)
        # qualifying_branches: year=寅(臨官), day=寅(臨官), hour=卯(帝旺) → 3
        # Should fire: boost = 5 × 3 = 15
        pillars = {
            'year':  {'stem': '甲', 'branch': '寅'},
            'month': {'stem': '庚', 'branch': '午'},
            'day':   {'stem': '甲', 'branch': '寅'},
            'hour':  {'stem': '乙', 'branch': '卯'},
        }
        from app.interpretation_rules import calculate_strength_score_v2
        result = calculate_strength_score_v2(pillars, '甲')
        assert result['factors']['pattern2aSource'] == 'non_month_lujie_yangren'
        assert result['factors']['pattern2aBoost'] == pytest.approx(15.0, abs=0.01)
```

### Validation harness re-run (mandatory gate)

After commit 4 lands locally:
```bash
python tests/validation/run_imbalance_validation.py --accept-doctrinal-splits
```

**Expected**: 98% agreement (no change). If harness shows different result, investigate Pattern 3b breaker fix's effect on `anchor_cong_cai_yiwuming` and other 從格 charts. Roll back Commit 4 if regression.

### Risks
- **Pattern 3b breaker fix** is the only behavior-changing item in this plan. Could shift `anchor_cong_cai_yiwuming` if 丙 (DM) was somehow being incorrectly flagged. Verify via the test above.
- Harness re-run is the safety net.

---

## Cross-cutting

### CLAUDE.md update for Commit 4 only
Append a brief note to the Phase 12d / 12e section about Pattern 3b breaker semantics post-Issue-F fix.

### Cache invalidation post-deploy
Commit 2's flag flip is the only cache-affecting change. Per the existing pattern:
```bash
redis-cli FLUSHALL
psql -U bazi_user -d bazi_platform -c "DELETE FROM reading_cache;"
cd apps/api && nest build && pm2 restart api
```

### Test count update
After Commit 4 lands, run `pytest --collect-only -q | tail -1` and use the
ACTUAL count to update CLAUDE.md. Predicted addition is `Commit 3 adds 2 + Commit 4 adds 6 = +8` (delta from current 1989), but the predicted figure is informational only — defer to post-implementation measurement to avoid the test-count drift seen in PR #38 (Issue B).

Fold the final test count update into Commit 4's CLAUDE.md edit.

### CLAUDE.md doctrinal consistency note — placement (S2.3 fix)
Move the strict-vs-loose 通根 note INLINE to Phase 12d Pattern 3b doctrine section (around CLAUDE.md line 583, alongside `stem_combinations.py::detect_true_transformed_stems` reference). Better discoverability than the bottom-of-cross-cutting placement v2 had.

```markdown
> **Strict vs loose 通根 stance** (Phase 12f Issue F fix): Pattern 3b
> (chart-level 從格 detection) uses STRICT same-stem-in-hidden semantics
> for breaker checks — `stem in hidden[:2]` requires the SPECIFIC breaker
> stem to be in 本氣 OR 中氣 of some branch. Phase 12b Fix D (transient
> flow-year 六合) uses element-level 同氣通根 instead and doesn't have a
> breaker check at all — its threshold is permissive of 假化 by design.
> Both stances are doctrinally valid; the strict view is more conservative
> for 從格 stakes (per 滴天髓·假化 「克化神之神，或克者被制」).
```

---

## Risk summary

| Commit | Risk | Mitigation |
|---|---|---|
| 1 (docs) | None | Pure documentation; verify via grep |
| 2 (BAZI flag flip) | Mod | Full test suite + harness re-run; xfail markers may flip XPASS (warning only) |
| 3 (docstring + V2 floor) | None | Defensive only; no real chart triggers floor |
| 4 (Pattern 3b breaker + 2a'' test) | Mod | Harness re-run gate; rollback if regression on `anchor_cong_cai_yiwuming` |

## Test count delta

Pre-Phase-12f: 1989 (1983 pass, 4 xfail, 1 skip, 1 pre-existing fail)
Post-Phase-12f: TBD — measure via `pytest --collect-only -q | tail -1` after Commit 4 lands. Predicted addition is ~+8 (2 invariant tests + 5 Pattern 3b breaker tests + 1 Pattern 2a'' new path + 1 ziping_niu_jianbo follow-up), but actual count will differ if existing tests count classes vs functions differently. Predicted figure is informational only — defer to post-implementation measurement (matches Phase 12d/12e protocol; avoids the test-count drift seen in PR #38 Issue B).

## Reviewer change tracking

This plan addresses every PR #38 review issue:

| Review issue | Score | Phase 12f resolution |
|---|---|---|
| A (Gate 1 stale note) | 75 | Commit 1 — note updated to ✅ Gate 1 done |
| B (test count 1994 vs 1989) | 82 (POSTED) | Commit 1 — fixed to 1989 → 1995 after new tests |
| C (Phase 12d/12e flags scattered) | 75 | Commit 1 — consolidated env flag rollback table |
| D+G (docstring missing 食神生財) | 50 | Commit 3 — docstring updated |
| E (V2 total can go negative) | 50 | Commit 3 — defensive `max(total, 0.0)` floor |
| F (Pattern 3b breaker too aggressive) | 75 | Commit 4 — breaker check tightened; harness re-run gate |
| H (Pattern 2a'' new activation path untested) | 50 | Commit 4 — synthetic test added |
| I (BAZI_USE_WEIGHTED_IMBALANCE prereq not in PR description) | 75 | Commit 2 — flag flipped to ON, becomes the production default |

Plus user-requested:
- Pattern 3a "DO NOT FLIP" guard rail — Commit 1

## Phase D v1 → v2 → v3 review tracking

This v3 plan addresses every Phase D MUST-change item from `phase_12f_review_v1.md`:

| v1 Issue | Severity | v3 Resolution |
|---|---|---|
| **S7.1** Direction A test fixture broken (寅 中氣=丙 means fix blocks 真化, test would fail) | 🔴 BLOCKER | Replaced 庚寅 with 庚辰 in fixture; verified all gates (i-iv) still pass; updated docstring narrative |
| **S2.1** Three different post-12f test counts | clarity | Removed predicted counts; defer to post-implementation `pytest --collect-only` measurement |
| **S2.2** Direction A narrative contradicted bazi-master verification | clarity | Narrative now correctly describes `hidden[:2]` (本氣 OR 中氣) semantics matching the fix code |
| **S6.2** Narrative said "本氣 only" but code uses `hidden[:2]` | doctrine | Narrative aligned with code |

Phase D v1 SHOULD items also resolved:

| v1 Issue | Severity | v3 Resolution |
|---|---|---|
| **S1.1** Test naming convention | nit | New test file is `test_phase_12f_pattern_3b_breaker.py` (phase-named, parallel to 12d/12e) |
| **S1.2** Placeholder cap test | nit | Dropped `test_v2_score_ceiling_at_100` |
| **S1.3** Stale "14 → 16" phrasing | nit | Removed |
| **S2.3** Strict-vs-loose 通根 note placement | clarity | Moved INLINE to Phase 12d Pattern 3b doctrine section |
| **S2.4** Consolidation ambiguity | clarity | Explicit: consolidated table REPLACES older inline listings |
| **S3.1** V2 floor test doesn't exercise floor | coverage | Rewrote to use monkeypatch driving `_pattern_2b_surround_penalty` to extreme values |
| **S5.2** Missing .env warning in operator runbook | compat | Added explicit warning + verification grep command |

Items left as-is per reviewer's "non-issue" verdict:
- S3.3 (existing `test_breaker_present` invalid 60甲子 fixture) — optional cleanup; out of Phase 12f scope
- S4.1, S4.2, S4.3, S4.4 — all validated cleanly in v1 review
- S5.1 (cache version sequencing) — verified correct
- S6.3, S6.4 — already resolved in plan
- S7.2 — non-blocker edge case verified safe

Ready for Phase D v3 final approval.
