# PR #37 Cleanup — 7 Issues from Code Review (v2 APPROVED)

**Origin**: Code review on PR #37 surfaced 7 issues (1 score=100 posted, 6 scored 25–75 filtered). User asked for an implementation plan to address all 7.

**Status**: Approved by staff engineer after v1 (7 issues, Needs rework with HIGH BLOCKING #7) → v2 (all resolved, **Approved, ship it**). Hold for user go-ahead before implementation.

---

## Approval trail

- v1 → 7 issues: 5 LOW/MED nits + S6 MED-HIGH (over-broad cache invalidation) + **S7 HIGH BLOCKING** (flag flip violates documented validation gate). Verdict: "Needs rework"
- v2 → all resolved (5 fully, 2 acceptable with follow-up) + 2 bonus operational notes from reviewer. **Verdict: "Approve, ship it"**

---

## Three-commit structure on the same branch (`claude/competent-shirley-270d4e`)

### Commit A — `fix(api): bump preAnalysisVersion per reading type + total budget default`

**Files**: `apps/api/src/ai/ai.service.ts`

#### A1 — per-reading-type cache version lookup (Fix #3, replaces inline conditional)

Replace `generateBirthDataHash`'s 5-line conditional at `ai.service.ts:6932-6936` with:

```ts
const PRE_ANALYSIS_VERSIONS: Record<string, string> = {
  [ReadingType.LIFETIME]: 'v2.4.0',  // bumped 2026-04 for Phase 12 Fix 1a 用神 cascade
  [ReadingType.CAREER]:   'v2.2.0',  // same cascade (官殺混雜 + 用神)
  [ReadingType.ANNUAL]:   'v2.0.0',  // major engine version: Phase 12b/12c monthly scoring
  // All other types (LOVE, HEALTH, COMPATIBILITY, ZWDS_*) stay v1.1.0.
  // Bump per-type when Phase 12d / future engine changes touch them.
};
const preAnalysisVersion = PRE_ANALYSIS_VERSIONS[readingType] ?? 'v1.1.0';
```

ZWDS reading types (10 total) and other unaffected types stay at v1.1.0 — no spurious cache invalidation for ZWDS.

#### A2 — `generateComparisonHash` bump (Fix #3 cascade)

`ai.service.ts:6951` bump `'v1.1.0'` → `'v1.2.0'` because `tests/validation/README.md:54-67` documents 3 compat-score regressions caused by Fix 1a. Even though Fix 1a default is currently OFF (per Fix #7 below), the bump is still correct — when Fix 1a eventually flips ON, all stale comparison cache entries auto-invalidate.

#### A3 — `MAX_TOTAL_AI_TIME_MS` default + defensive comment (Fix #2)

`ai.service.ts:100` change `'300000'` → `'900000'`. Add docblock at the constant:

```ts
/** Total time budget across ALL providers + retries before giving up.
 * Default 900s (15 min) matches the documented retry math: 1 same-provider
 * retry (300s + backoff + 300s ≈ 602s) + 1 fallback to next provider
 * (≈ 900s). Configurable via env.
 *
 * IMPORTANT: if deployment proxy / load-balancer / Cloudflare caps request
 * duration below 900s, set MAX_TOTAL_AI_TIME_MS to a smaller value via env
 * to avoid silent budget waste. Common defaults: nginx=60s, Cloudflare=100s
 * (Pro/Free) / unlimited (Enterprise), Vercel=300s (Pro). */
```

**Risk**: LOW — `apps/api/.env` already sets `MAX_TOTAL_AI_TIME_MS=900000` in dev/staging. Code default now matches real env.

---

### Commit B — `chore: post-review code/comment cleanup`

**Files**: `packages/bazi-engine/app/annual_enhanced.py`, `packages/bazi-engine/tests/test_phase_12c_monthly.py`

#### B1 — Drop stale "Cap ruleTrace at 6" line (Fix #4)

`annual_enhanced.py:2006` — drop the first comment line. The next 3 lines correctly explain the bump to 10.

#### B2 — Fix pipeline section header (Fix #5)

`annual_enhanced.py:1837` — change:
```
# Phase 12b rule pipeline: C → A → B → D, with ruleTrace.
```
to:
```
# C → A → F → B → E → D pipeline (Phase 12b/12c), with ruleTrace.
```
Wording "C → A → F → B → E → D pipeline" matches `test_phase_12c_monthly.py:457` verbatim — single grep finds both code comment + test docstring.

#### B3 — Convert env-var mutation to monkeypatch in snapshot test (S7 follow-up)

`test_phase_12c_monthly.py:464` — replace:
```python
os.environ['BAZI_USE_WEIGHTED_IMBALANCE'] = '1'
import importlib
from app import five_elements
importlib.reload(five_elements)
from app import calculator
importlib.reload(calculator)
```
with the existing pattern at `test_ten_gods_imbalance.py:39`:
```python
def test_laopo_full_year_ruletrace_snapshot(self, monkeypatch):
    """All 12 monthly forecasts for Laopo 2026 with locked ruleTrace."""
    from app import five_elements as fe
    monkeypatch.setattr(fe, '_USE_WEIGHTED_IMBALANCE', True)
    # ... rest of test
```

**Verified safe**: `_USE_WEIGHTED_IMBALANCE` is read at call time at `five_elements.py:480` as a module-global lookup (not captured at import). monkeypatch.setattr works correctly.

**Why this matters**: current pattern leaks env state + double-`importlib.reload` across tests under `pytest-xdist`. monkeypatch isolates state per test.

**Operational note from reviewer**: also verify `pytest --random-order tests/test_phase_12c_monthly.py` passes after conversion to confirm collection-order independence.

---

### Commit C — `docs(claude.md): test counts + Fix 1a status reconciliation`

**Files**: `CLAUDE.md`

#### C1 — Test counts refresh (Fix #7)

`CLAUDE.md:133` change `Bazi Engine: 1771 (1770 pass, 1 skip) | NestJS API: 165 | Frontend: 143 | ZWDS: 289` → `Bazi Engine: 1914 (1913 pass, 1 skip) | NestJS API: 692 | Frontend: 143 | ZWDS: 289`.

Counts verified by `pytest --collect-only -q | tail -1` (engine) and `jest` (api). Frontend/ZWDS unchanged in this PR.

#### C2 — Fix 1a default status reconciliation (Fix #1, replacing original "flip default" plan)

Add a Note block near the existing Phase 12 Fix 1a row in CLAUDE.md (specifically in the per-rule env flags section ~line 596–607):

```
> **Note on `BAZI_USE_WEIGHTED_IMBALANCE` default**: code default is `'0'` (OFF)
> pending validation harness completion at `packages/bazi-engine/tests/validation/`.
> CLAUDE.md previously stated "Default ON in dev/staging" — that was the
> *intent*, not the *current state*. Flag-flip blocked on:
> 1. Completion of the n=50 expert-labeled chart CSV
> 2. Bazi-master sign-off on 3 known compatibility regressions in
>    `test_compatibility_gold_standard.py::TestScoreRanking`
> 3. Operator runs the validation harness and confirms ≥95% agreement
>
> Tracker: file separate "Phase 12 Fix 1a default ON" PR after gates clear.
```

This converts an active misrepresentation into honest "intent vs current state" documentation without losing the design intent.

---

### Out of band — PR #37 description edit (Fix #6, no commit)

```bash
gh pr edit 37 --repo taufulou/bazi-app --body <new>
```

Replace `(3 new test files: 24+24+9 tests added)` with `(3 new test files: 34+24+9 tests added)`.

---

## Commit ordering (load-bearing per reviewer)

**A → B → C** (in this exact order):

> If commit C lands first and someone reverts it, the v1.2.0 cache key is still in production but the docs say Fix 1a is OFF — confusing forensic state.

A is the load-bearing semver+config change. B is internal cleanup. C is documentation that depends on A's posture being established.

---

## Out of scope (filed as follow-ups)

- **Phase 12d**: `ENGINE_FLAGS_FINGERPRINT` cache-key inclusion — auto-invalidate on flag flips without operator FLUSHALL or manual version bumps
- **CI improvement**: auto-generate test counts in CLAUDE.md from CI run output (avoid drift)
- **Separate PR**: "Phase 12 Fix 1a default ON" — flips `BAZI_USE_WEIGHTED_IMBALANCE` default to `'1'` after validation harness completion + Bazi-master sign-off on 3 compat regressions
- **Validation README cleanup**: remove "TBD pending harness completion" placeholders once harness exists

---

## Test plan

- Engine suite green: `pytest tests/` → 1914 collected, 1913 pass, 1 skip
- API suite green: `jest` → 692 pass
- Snapshot test passes under random order: `pytest --random-order tests/test_phase_12c_monthly.py`
- Cache hash for Laopo (LIFETIME) differs between commits: pre-A vs post-A returns different hex digest for same chart inputs
- Comparison hash for any two profiles differs between commits: pre-A vs post-A returns different hex digest

---

## Cache invalidation runbook (post-merge)

Per CLAUDE.md mandate after engine version changes:
```bash
redis-cli FLUSHALL
psql -U bazi_user -d bazi_platform -c "DELETE FROM reading_cache;"
cd apps/api && nest build && pm2 restart api
```

This is required because the per-type version bump invalidates cached readings — operator must flush Redis to release memory and force re-computation. The DB delete clears `reading_cache` table.

---

## Issues NOT addressed in this PR (deliberately)

- **Fix #1 flag flip** — moved to separate dedicated PR after validation harness completes (per S7 BLOCKING resolution)
- **Test count auto-generation** — structural CI change, deferred
- **Engine flag fingerprint in cache key** — Phase 12d architectural improvement, deferred
- **Production proxy timeout audit** — operational task outside worktree access; defensive comment added at constant warns operators
