# Love V2 streaming — fix false-positive `degraded` status (Option A)

## Problem

Laopo25's 八字愛情姻緣 reading is being marked `isDegraded=true` even when
the AI completes successfully within budget. The user-visible symptom is the
reading flagged as incomplete; the underlying cause is a count mismatch
between what the streamer expects and what the prompt actually asks for.

Live log evidence (Nest API, 2026-05-05 10:28:47–10:30:53):

```
[V2Stream:LOVE] Call 2 START provider=CLAUDE attempt=1/2
[V2Stream:LOVE] Call 2 SECTION EMITTED key=annual_love_2026 …
[V2Stream:LOVE] Call 2 SECTION EMITTED key=annual_love_2027 …
[V2Stream:LOVE] Call 2 SECTION EMITTED key=annual_love_2028 …
[V2Stream:LOVE] Call 2 SECTION EMITTED key=annual_love_2029 …
[V2Stream:LOVE] Call 2 SECTION EMITTED key=annual_love_2030 …
[V2Stream:LOVE] Call 2 SECTION EMITTED key=monthly_love_01..12 …
[V2Stream:LOVE] Call 2 stream COMPLETE chunks=193 buffer=5078 sections=17/22   ← Call-2-only ratio
[V2Stream:LOVE] status=degraded latency=126269ms sections=26/31 call1=9 call2=17 refunded=false   ← final status
```

Two separate log lines:
- The **intermediate** "Call 2 stream COMPLETE … sections=17/22" comes from
  [`_streamV2Call2Loop`](apps/api/src/ai/ai.service.ts:1459) — `17/22` is
  Call-2-only (17 emitted of 22 expected Call-2 keys).
- The **final** "status=degraded sections=26/31" comes from
  [`_executeStreamV2Common`](apps/api/src/ai/ai.service.ts:1224) — `26/31`
  is total: `call1=9 + call2=17` over `expected=9+22`.

126s end-to-end is well under the 180s `AI_STREAM_TIMEOUT_MS` default
([ai.service.ts:957-961](apps/api/src/ai/ai.service.ts:957)) — **this is
not a timeout issue.**

## Root cause

Two functions inside `AIService` disagree on the year count for Love:

| Site | What it does | Cap |
|------|--------------|-----|
| [`_executeStreamLoveV2`](apps/api/src/ai/ai.service.ts:3593) | Builds `call2ExpectedKeys` for the bookkeeping loop | **None** — iterates every entry of `enhancedInsights.deterministic.annual_forecasts` |
| [`buildLoveV2Prompts`](apps/api/src/ai/ai.service.ts:3643) | Substitutes years into the AI prompt template | **5** — `Math.min(5, years.length)` |

The prompt template ([`LOVE_V2_PROMPTS.outputFormatCall2`](apps/api/src/ai/prompts.ts))
is structurally locked to 5 slots: it has hardcoded placeholders
`YYYY1`…`YYYY5`. The AI literally has nowhere to emit a 6th year — so when
the chart has >5 years of forecasts, expected = N+12, returned = 5+12 = 17,
and `_executeStreamV2Common`'s status logic ([ai.service.ts:1216-1230](apps/api/src/ai/ai.service.ts:1216))
classifies it as `degraded` even though the AI did exactly what the prompt asked.

Secondary inconsistency: the two sites also read different fields —
streamer reads `enhancedInsights.deterministic.annual_forecasts` (snake_case,
under `deterministic`), prompt builder reads `enhancedInsights.annualForecasts`
(camelCase, top-level). The Python engine emits both
([love_enhanced.py:2467, 2536](packages/bazi-engine/app/love_enhanced.py:2467))
and they currently contain matching years, but having two independent reads
of "the same" data is fragile.

## Goal

Eliminate the false-positive `degraded` status on Love readings whose chart
has >5 years of `annualForecasts`, by capping the streamer's expected-keys
count to the same 5 the prompt asks for, and reading from one source of truth.

## Scope

**In:** `_executeStreamLoveV2` and `buildLoveV2Prompts` in `apps/api/src/ai/ai.service.ts`.

**Out (flagged as follow-up, not fixed here):**
- **Career has the same N-vs-cap bug, but a narrower one.**
  [`_executeStreamCareerV2`](apps/api/src/ai/ai.service.ts:1592-1599)
  iterates uncapped `annual_forecasts`, while
  [`buildCareerV2Prompts`](apps/api/src/ai/ai.service.ts:2425-2436)
  caps at 5. Career only needs the **cap fix** — both Career sites already
  read the same field (`deterministic.annual_forecasts`), so the read-path
  consolidation that Love needs is unnecessary for Career. Filed separately
  so the Love change isn't blocked by Career test churn.
- `DEGRADE_THRESHOLDS.LOVE` is missing from the table
  ([ai.service.ts:135-143](apps/api/src/ai/ai.service.ts:135)) and falls
  through to `DEFAULT`. `DEFAULT` happens to be appropriate, no action needed.
- One-off DB cleanup of historical `isDegraded=true` Love rows: not required;
  users can regenerate via the existing free-regen flow (3 attempts per reading).

## Implementation steps

### Step 1 — extract the cap as a named constant

Add near the other Love V2 helpers in
[`apps/api/src/ai/ai.service.ts`](apps/api/src/ai/ai.service.ts):

```ts
/**
 * Love V2 Call 2 only emits up to this many annual_love_YYYY sections.
 * The cap is structurally enforced by the prompt template
 * (LOVE_V2_PROMPTS.outputFormatCall2 has hardcoded YYYY1..YYYY5 slots),
 * so the streamer's expected-keys count must match.
 */
const LOVE_V2_ANNUAL_FORECAST_CAP = 5;
```

Place: file-scope constant just above the `AIService` class, alongside
existing module-level constants. Do not move it to `prompts.ts` — the
constraint also lives in `ai.service.ts` (the streamer), so co-locating
with the consumers is clearer than a cross-file constant.

### Step 2 — extract a small helper for testability

Add a private method to `AIService`:

```ts
/**
 * Build Love V2 Call 2 expected keys: capped annual_love_YYYY + 12 monthly_love_MM.
 * Reads from enhancedInsights.annualForecasts (top-level, camelCase) — same
 * source buildLoveV2Prompts uses, so streamer/prompt always agree on which
 * years are requested.
 */
private buildLoveV2Call2ExpectedKeys(
  calculationData: Record<string, unknown>,
): string[] {
  const enhancedInsights = calculationData['loveEnhancedInsights'] as
    Record<string, unknown> | undefined;
  const annualForecasts = (enhancedInsights?.['annualForecasts'] || [])
    as Array<{ year: number }>;
  const keys: string[] = [];
  for (const af of annualForecasts.slice(0, LOVE_V2_ANNUAL_FORECAST_CAP)) {
    keys.push(`annual_love_${af.year}`);
  }
  for (let m = 1; m <= 12; m++) {
    keys.push(`monthly_love_${String(m).padStart(2, '0')}`);
  }
  return keys;
}
```

### Step 3 — replace the inlined logic in `_executeStreamLoveV2`

Replace [ai.service.ts:3589-3598](apps/api/src/ai/ai.service.ts:3589) with
a single call:

```ts
const call2ExpectedKeys = this.buildLoveV2Call2ExpectedKeys(calculationData);
```

Delete all three local variables that were only used by the removed loop:
`enhancedInsights`, `rawDeterministic`, and `annualForecasts`. A read of
3588-3615 confirms none of them are referenced after line 3598 — the
`autoFixCallback` at 3610 takes `calc` (= `calculationData`), not these
locals.

### Step 4 — use the named cap in `buildLoveV2Prompts`

Replace [ai.service.ts:3643](apps/api/src/ai/ai.service.ts:3643):

```ts
// Before:
for (let i = 0; i < Math.min(5, years.length); i++) {

// After:
for (let i = 0; i < Math.min(LOVE_V2_ANNUAL_FORECAST_CAP, years.length); i++) {
```

So the cap lives in one place and any future bump moves both sides together.

## Test plan

### Unit tests (new) — `apps/api/test/ai-service.spec.ts`

Add a `describe('Love V2 Call 2 expected keys', …)` block that hits
`buildLoveV2Call2ExpectedKeys` directly. Cases:

| Input | Expected output length | Expected first/last annual key |
|-------|------------------------|--------------------------------|
| 0 annualForecasts | 12 (monthly only) | n/a |
| 3 annualForecasts (2026–2028) | 15 | `annual_love_2026`, `annual_love_2028` |
| 5 annualForecasts (2026–2030) | 17 | `annual_love_2026`, `annual_love_2030` |
| 7 annualForecasts (2026–2032) | **17** (cap kicks in) | `annual_love_2026`, `annual_love_2030` |
| 10 annualForecasts (2026–2035) | **17** (cap kicks in) | `annual_love_2026`, `annual_love_2030` |
| `loveEnhancedInsights` missing | 12 | n/a |

The 7-year and 10-year cases are the regression guards — they would have
produced 19 and 22 keys respectively under the old code.

For the 10-year case, additionally assert the cap was respected:
```ts
expect(keys).not.toContain('annual_love_2031');
expect(keys).not.toContain('annual_love_2035');
```
This makes the cap explicit and the test failure mode obvious if the cap
constant is ever bumped without updating the prompt template.

Helper access: `(service as any).buildLoveV2Call2ExpectedKeys(payload)` to
bypass private visibility for the test, matching the pattern already used
in this file for other `AIService` private helpers.

### Existing suites to re-run

```bash
cd apps/api && npm test
```

Watch for regressions in:
- `ai-service.spec.ts` (LOVE prompt-building cases at line 140, 225)
- `ai-prompts.spec.ts` (LOVE structural assertions at line 180-181)
- `streaming.spec.ts` (general V2 streaming path)
- `ai-failure-refund.spec.ts` (degrade/refund accounting)

No test currently asserts the exact `expectedCall2Count` for Love, so the
production behavior change won't break existing assertions, but the suites
above exercise the surrounding code.

### Manual verification

1. Restart Nest API after the patch lands.
2. Re-generate the Laopo25 八字愛情姻緣 reading.
3. Tail `/tmp/nest-api.log`, expect:
   - `Call 2 stream COMPLETE … sections=17/17` (was `17/22`)
   - `status=success` (was `status=degraded`)
   - Reading row in DB: `isDegraded=false`, no `failedReason` set.

## Rollback

Single-file change in `apps/api/src/ai/ai.service.ts`. `git revert` on the
commit. No schema migrations, no env flags, no cache-key changes (cache
keys for Love are unchanged because the prompt content is unchanged — same
5 years requested, same hash).

## Cache / data implications

- **Cache:** No change. Cache write path runs only when `status==='success'`
  ([ai.service.ts:1277-1306](apps/api/src/ai/ai.service.ts:1277)), so the
  bug never wrote bad rows; existing cached Love rows remain valid.
- **DB rows already marked `isDegraded=true`:** Stay as-is. Users can
  trigger free regen via the existing 3-attempt flow. No migration script.
- **Frontend:** No change. The set of section keys returned is the same as
  what the AI was already producing (5 annual + 12 monthly) — the fix only
  corrects the bookkeeping that wrongly classified the reading as partial.

## Risk assessment

- **Logic risk:** Very low. Capping the expected count at a value that
  matches what the prompt structurally requests cannot under-count or
  over-count valid output.
- **Edge case — chart with 0 forecast years:** Old expected 0+12=12, new
  expects 0+12=12. Identical.
- **Edge case — chart with <5 forecast years (1–4):** Old expected N+12,
  new expects min(5,N)+12 = N+12. Same. Safe.
- **Edge case — chart with exactly 5:** Old 17, new 17. Identical.
- **Edge case — chart with 6–9 forecast years (intermediate):** Old expected
  N+12 (18–21), AI emits 5+12=17, old result classified as `degraded`
  (17 ≥ floor((N+12)×0.7), 17 < N+12). New expects 17, AI emits 17,
  classified as `success`. **This case is also fixed by the same change** —
  the cap consolidation is uniform across all N>5.
- **Edge case — chart with ≥10 forecast years (Laopo25):** Old expected 22,
  AI emits 17, old result `degraded`. New expects 17, classified `success`.
  Confirmed regression case.
- **Concurrency / streaming:** No timing changes; only the size of the
  `Set` of expected keys changes. The for-await loop and
  `extractCompletedSections` are unaffected.

## Out-of-scope cleanups noticed during analysis

These are observations, not part of this PR:

1. Career V2 has the identical N-vs-cap bug
   ([ai.service.ts:1594, 2428](apps/api/src/ai/ai.service.ts:1594)).
   Same fix shape — file as a follow-up.
2. The two read paths in Love
   (`enhancedInsights.deterministic.annual_forecasts` vs
   `enhancedInsights.annualForecasts`) currently agree because both come
   from the same Python source variable
   ([love_enhanced.py:2467, 2536](packages/bazi-engine/app/love_enhanced.py:2467)),
   but having two reads of "the same" data is brittle. After this fix both
   sites read the top-level `annualForecasts` so the brittleness is gone.
