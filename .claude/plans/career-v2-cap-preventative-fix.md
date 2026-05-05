# Career V2 streaming — preventative cap alignment

## Bug confirmation

Career V2 has the **same code shape** as the Love V2 bug fixed in PR #40,
but the bug is **currently latent** — not user-facing today.

| Side | Code | Cap |
|------|------|-----|
| **Streamer** [`_executeStreamCareerV2`](apps/api/src/ai/ai.service.ts:1601-1611) | Iterates `enhancedInsights.deterministic.annual_forecasts` | **None** (uncapped loop) |
| **Prompt** [`buildCareerV2Prompts`](apps/api/src/ai/ai.service.ts:2436-2448) | Substitutes `YYYY1..YYYY5` slots in `CAREER_V2_PROMPTS.outputFormatCall2` | **5** (`Math.min(5, years.length)`) |
| **Engine** [`compute_annual_forecast_data`](packages/bazi-engine/app/career_enhanced.py:937-956) | `forecast_years: int = 5`, single call site at `career_enhanced.py:1441` does not override | **5** |

Today the engine caps at 5, so the streamer's uncapped iteration receives at
most 5 years and never disagrees with the prompt. Verified: Career's two read
sites already point at the same field
(`deterministic.annual_forecasts || annualForecasts`), unlike Love's pre-fix
state where streamer and prompt read different fields.

The bug becomes **active** the moment any of these happens:
- `forecast_years` default is bumped in `career_enhanced.py:946`
- Any new caller passes `forecast_years > 5` (e.g. an "extended career
  outlook" feature)
- Engine output shape evolves to include extra years from another source

When that happens, streamer expects N+12 keys, AI emits 5+12=17, every
reading is silently classified `degraded`. Same failure mode as the
Love case.

This plan applies the same constant-extraction + helper-extraction +
drift-guard pattern Love received in PR #40, so the latent risk is
neutralized at the AI layer.

## Goal

Make the 5-cap structurally explicit on the AI side and protected by a
drift-guard test, so any future engine change that produces >5 years cannot
silently degrade Career readings.

## Scope

**In:**
- `apps/api/src/ai/ai.service.ts` — `_executeStreamCareerV2` and
  `buildCareerV2Prompts`
- `apps/api/test/ai-service.spec.ts` — new test block

**Out (intentional differences from Love's PR #40):**
- **No read-path consolidation.** Career's two sites already read the same
  field (`deterministic.annual_forecasts`). Keep that path — switching
  Career to top-level `annualForecasts` is an unrelated refactor.
- **No engine change.** `career_enhanced.py:946` stays at `forecast_years=5`.
- **No prompt-content change.** `CAREER_V2_PROMPTS.outputFormatCall2` stays
  at YYYY1..YYYY5.

Since prompt content, deterministic data shape, and cache keys are all
unchanged, no `preAnalysisVersion` bump and no Redis flush are required
(per CLAUDE.md "After ANY prompt change" rule — this is not a prompt
change).

## Implementation steps

### Step 1 — export a named constant

In [`apps/api/src/ai/ai.service.ts`](apps/api/src/ai/ai.service.ts), just
below the existing `LOVE_V2_ANNUAL_FORECAST_CAP` constant added in PR #40
(currently around line 145-152), add a parallel constant:

```ts
/**
 * Career V2 Call 2 only emits up to this many annual_forecast_YYYY sections.
 * The cap is structurally enforced by the prompt template
 * (CAREER_V2_PROMPTS.outputFormatCall2 has hardcoded YYYY1..YYYY5 slots),
 * so the streamer's expected-keys count must match.
 *
 * Drift guard: a unit test in ai-service.spec.ts asserts this constant
 * equals the count of distinct YYYY\d slots in CAREER_V2_PROMPTS.outputFormatCall2.
 * If you bump this number, also add YYYY6..YYYYN slots to that template
 * AND raise career_enhanced.py::compute_annual_forecast_data's forecast_years default.
 */
export const CAREER_V2_ANNUAL_FORECAST_CAP = 5;
```

The third drift link (Python `forecast_years` default) is unique to Career:
since Career has an upstream cap that Love does not, the docstring must
remind future readers that bumping the AI-side cap requires the Python
side to actually emit more years. Without that engine change, the AI
constant alone wouldn't do anything visible.

### Step 2 — extract a helper for testability

Add a private method to `AIService`, mirroring `buildLoveV2Call2ExpectedKeys`:

```ts
/**
 * Build Career V2 Call 2 expected keys: capped annual_forecast_YYYY + 12 monthly_forecast_MM.
 * Matches the cap baked into CAREER_V2_PROMPTS.outputFormatCall2 (YYYY1..YYYY5 slots).
 *
 * Reads from enhancedInsights.deterministic.annual_forecasts (with snake_case ↔ camelCase
 * fallback) — the same field buildCareerV2Prompts reads, preserving Career's existing
 * read-path convention.
 */
private buildCareerV2Call2ExpectedKeys(
  calculationData: Record<string, unknown>,
): string[] {
  const enhancedInsights = calculationData['careerEnhancedInsights'] as Record<string, unknown> | undefined;
  const rawDeterministic = (enhancedInsights?.['deterministic'] || {}) as Record<string, unknown>;
  const annualForecasts = (rawDeterministic['annual_forecasts'] || rawDeterministic['annualForecasts'] || []) as Array<{ year: number }>;
  const keys: string[] = [];
  for (const af of annualForecasts.slice(0, CAREER_V2_ANNUAL_FORECAST_CAP)) {
    keys.push(`annual_forecast_${af.year}`);
  }
  for (let m = 1; m <= 12; m++) {
    keys.push(`monthly_forecast_${String(m).padStart(2, '0')}`);
  }
  return keys;
}
```

Place it near `buildLoveV2Call2ExpectedKeys` (file ordering: keep helpers
beside their corresponding `_executeStream*` methods if that's the existing
convention — quick scan to confirm before placement).

### Step 3 — replace inlined logic in `_executeStreamCareerV2`

Replace [ai.service.ts:1601-1611](apps/api/src/ai/ai.service.ts:1601) (the
build-expected-keys block, including the 4 lines of comment + reads + loops)
with:

```ts
const call2ExpectedKeys = this.buildCareerV2Call2ExpectedKeys(calculationData);
```

Delete all three local variables that were only used by the removed loop:
`enhancedInsights`, `rawDeterministic`, `annualForecasts`. Confirm via a
read of the surrounding 30 lines that none are referenced after the loop
exits.

### Step 4 — use the named cap in `buildCareerV2Prompts`

Replace [ai.service.ts:2440](apps/api/src/ai/ai.service.ts:2440):

```ts
// Before:
for (let i = 0; i < Math.min(5, years.length); i++) {

// After:
for (let i = 0; i < Math.min(CAREER_V2_ANNUAL_FORECAST_CAP, years.length); i++) {
```

And update the adjacent comment:

```ts
// Before:
// Strip any unreplaced YYYY tokens (edge case: fewer than 5 annual forecasts)

// After:
// Strip any unreplaced YYYY tokens (edge case: fewer than CAREER_V2_ANNUAL_FORECAST_CAP annual forecasts)
```

This mirrors the Love change in PR #40 exactly.

## Test plan

### Unit tests (new) — `apps/api/test/ai-service.spec.ts`

Add a `describe('buildCareerV2Call2ExpectedKeys', …)` block immediately
after the existing Love `describe`. Mirror the 7 Love cases, adapted for
Career's key prefix (`annual_forecast_` instead of `annual_love_`,
`monthly_forecast_` instead of `monthly_love_`) and read path
(`deterministic.annual_forecasts` instead of top-level `annualForecasts`):

| Input | Expected length | Boundary keys / negative assertions |
|-------|-----------------|--------------------------------------|
| 0 forecasts | 12 | monthly-only |
| 3 forecasts (2026–2028) | 15 | contains `annual_forecast_2026`, `annual_forecast_2028` |
| 5 forecasts (2026–2030) | 17 | contains `annual_forecast_2026`, `annual_forecast_2030` |
| 7 forecasts (2026–2032) | 17 (cap) | not `annual_forecast_2031`, not `annual_forecast_2032` |
| 10 forecasts (2026–2035) | 17 (cap) | not `annual_forecast_2031`, not `annual_forecast_2035` |
| missing `careerEnhancedInsights` | 12 | monthly-only |

Plus the drift guard:

```ts
it('CAREER_V2_PROMPTS.outputFormatCall2 has exactly CAREER_V2_ANNUAL_FORECAST_CAP distinct YYYYn slots', () => {
  const matches = CAREER_V2_PROMPTS.outputFormatCall2.match(/YYYY\d/g) || [];
  const distinct = new Set(matches);
  expect(distinct.size).toBe(CAREER_V2_ANNUAL_FORECAST_CAP);
  const expected = new Set(
    Array.from({ length: CAREER_V2_ANNUAL_FORECAST_CAP }, (_, i) => `YYYY${i + 1}`),
  );
  expect(distinct).toEqual(expected);
});
```

The fixture `makeCalc(years)` should return:

```ts
const makeCalc = (years: number[]) => ({
  careerEnhancedInsights: {
    deterministic: {
      annual_forecasts: years.map((year) => ({ year })),
    },
  },
});
```

**Fixture asymmetry note:** Career uses snake_case under `deterministic`,
while Love's existing fixture uses top-level camelCase
(`loveEnhancedInsights.annualForecasts`). Both are intentional and
correct — they mirror what each reading's Python engine actually emits
(`career_enhanced.py:1541` writes under `deterministic` snake_case;
`love_enhanced.py:2467` hoists `annualForecasts` to top-level camelCase).
Side-by-side readers should not "normalise" the fixtures.

**Imports to add** at the top of `apps/api/test/ai-service.spec.ts`,
extending the lines added in PR #40:

```ts
// Before:
import { AIService, LOVE_V2_ANNUAL_FORECAST_CAP } from '../src/ai/ai.service';
import { LOVE_V2_PROMPTS } from '../src/ai/prompts';

// After:
import {
  AIService,
  LOVE_V2_ANNUAL_FORECAST_CAP,
  CAREER_V2_ANNUAL_FORECAST_CAP,
} from '../src/ai/ai.service';
import { LOVE_V2_PROMPTS, CAREER_V2_PROMPTS } from '../src/ai/prompts';
```

Both `CAREER_V2_PROMPTS` (`prompts.ts:2239`) and the new
`CAREER_V2_ANNUAL_FORECAST_CAP` (added in Step 1 above) are exports —
no additional surgery required.

### Existing suites to re-run

```bash
cd apps/api && npm test -- ai-service ai-prompts streaming ai-failure-refund
```

The 91-test baseline established in PR #40 should grow to 98 (Love's 7 +
Career's new 7).

### Manual verification

Career's existing flow continues to work normally — the bug being fixed
is preventative, not user-facing. Manual verification:

1. Restart Nest API with the patch.
2. Generate any Career reading (e.g. Roger or Laopo's chart).
3. Tail `/tmp/nest-api.log`, expect `[V2Stream:CAREER] sections=N/N`
   where N matches today's count (typically 5+12+5=22 for Career, since
   Career Call 1 has 5 sections vs Love's 9). Status `success`. No
   regression.

## Cache / data implications

- **Prompt content unchanged.** Same 5 years requested, same template, same
  hash. Existing cached Career rows remain valid.
- **No `preAnalysisVersion` bump.** Engine output shape unchanged.
- **No Redis flush.** Per CLAUDE.md "After ANY prompt change" — this is
  not a prompt change, just a refactor of the count bookkeeping.
- **No DB rows affected.** Unlike Love (where some rows had been
  marked `isDegraded=true`), Career has no historical degraded rows from
  this bug because the engine cap meant the bug never fired.

## Risk assessment

- **Logic risk:** Very low. Slicing to a cap that matches what the prompt
  structurally requests cannot under-count or over-count valid output. The
  fix is identical to Love's change which has 91 tests passing.
- **Edge case — engine emits ≤5 years (today's reality):** Old expected N,
  new expects min(5, N) = N. Same behavior. Safe.
- **Edge case — engine ever emits >5 years:** Old expected N, classified
  `degraded` because AI emits only 5. New expects 5, classified `success`.
  Bug pre-empted.
- **Concurrency / streaming:** No timing changes; only the size of the
  expected-key Set changes. The for-await loop and `extractCompletedSections`
  are unaffected.
- **Cross-coupling with Love:** None. The Career constant lives next to the
  Love constant for readability but they're independent values.

## Rollback

Single-file change in `apps/api/src/ai/ai.service.ts` (plus tests).
`git revert` of the commit reverses both. No schema migrations, no env
flags, no cache-key changes.

## Out of scope (flagged, not part of this PR)

- **`CAREER` row in `DEGRADE_THRESHOLDS`** ([ai.service.ts:137](apps/api/src/ai/ai.service.ts:137))
  has `call2CompletionMin: 0.8` (vs Love's `DEFAULT` 0.7). After this fix,
  Career will continue using its existing 0.8 threshold against the
  capped count of 17 (5 annual + 12 monthly). `floor(0.8 × 17) = 13`, so
  a Career reading with at least 13 of 17 Call 2 sections classifies as
  `degraded` (else `failed`). The fix actually makes Career strictly more
  pass-tolerant in any future engine-bump scenario: pre-fix uncapped 22
  expected with 17 fulfilled = 0.77 < 0.8 → `degraded`; post-fix capped
  17 expected with 17 fulfilled = 1.0 → `success`. No threshold change
  needed; just noting that any future tuning should update both sides
  together.
- **Future Career feature requesting >5 years.** If product wants
  extended outlooks, a coordinated 3-file change is needed: (1) bump
  `forecast_years` default in `career_enhanced.py`, (2) bump
  `CAREER_V2_ANNUAL_FORECAST_CAP`, (3) extend
  `CAREER_V2_PROMPTS.outputFormatCall2` with new YYYY slots (edit the
  underlying `CAREER_V2_OUTPUT_FORMAT_CALL2` template literal in
  `prompts.ts`). The drift-guard test will fail loudly if any one of
  those three is forgotten. That coordination is the explicit value
  delivered by this PR.
