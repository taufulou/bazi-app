# Fix: persisted AI cost figures disagree with the spend counter

**Status:** planned, not implemented. Standalone — not part of the launch-gate
todo list.

**Revision 5.** v1 → CHANGES REQUIRED (11 issues, 2 factual errors). v2 →
CHANGES REQUIRED (3 required + 4 polish). v3 → CHANGES REQUIRED, confined to the
backfill. v4 → D1 APPROVED, D2 blocked on one issue. v5 → **APPROVE, both
deliverables.** All five rounds' findings are folded in and listed in §7.

⚠️ **Split into two deliverables**, because they are ready at different times:

| | | Status |
|---|---|---|
| **D1 — the code fix** | §3 parts A, B, C, D + the `hasPriceEntry` accessor | ✅ **APPROVED** (staff review round 4) |
| **D2 — the backfill** | §3E | lands AFTER D1 is deployed; needs `hasPriceEntry`, which is why that accessor sits in D1 |

D1 does not depend on D2 and should not wait for it. D2 writes money figures to
production irreversibly and deserves its own review pass.

**Found:** 2026-09-02, while purging load-test rows. Three production
`COMPATIBILITY` rows showed real token counts (14,769 / 11,347 / 9,939 input)
against a cost of **`$0`**.

---

## 1. What is actually wrong

There are **two price tables** and **three persisted cost figures**, and they
disagree with each other.

| # | Where the number lands | Priced by | Correct? |
|---|---|---|---|
| 1 | Redis spend counter (what the breaker reads) | `estimateCostUsd(model, usage)` → `PRICE_TABLE` | ✅ authoritative |
| 2 | `AIUsageLog.costUsd` (`/admin/ai-costs`) | `result.tokenUsage.estimatedCostUsd`, supplied by the CALLER | ❌ nine callers hardcode `0` |
| 3 | `BaziReading.tokenUsage` / `BaziComparison.tokenUsage` (Json) | aggregate `totalCost`, from `providerConfig.costPerInputToken/OutputToken` — **a second table** | ❌ diverges from #1 |

The nine `estimatedCostUsd: 0` literals are one symptom. The defect is
structural: **one number has three sources.** Every caller has to compute a cost
that the same function is already computing correctly two lines earlier, and a
second price table exists that nothing reconciles against the first.

## 2. Blast radius — measured

⚠️ **The breaker's INPUTS AND SEMANTICS are unchanged** — but as of C-bis this
is no longer the structural "we don't touch that file" claim it was in v1–v4.
`record()` calls `estimateCostUsd(args.model, args.usage)`
(`ai-spend.service.ts:327`) and never reads `estimatedCostUsd`; that stays true.
But C-bis refactors `priceFor`, which sits directly on the breaker's hot path
(`record()` → `estimateCostUsd` `:216` → `priceFor` → the daily cap), so it
**must be proven behaviour-preserving** rather than assumed.

The refactor is well covered already: `ai-spend.service.spec.ts:48-56` pins the
longest-prefix tiebreak (`gpt-4o-mini` must not price as `gpt-4o` — 0.15 vs
2.5), and `:58-70` pins the fallback with `expect(unknown).toBe(opus)` — an
assertion that itself encodes the Opus/FALLBACK collision C-bis is built around.
What is missing is coverage of the NEW method; see §4. The daily cap, the 80% warning and the trip all price
from `PRICE_TABLE`. This is a **reporting** bug, not a safety one.

### ⚠️ Two v1 claims that were WRONG

**v1 said:** *"`estimatedCostUsd` is read in exactly two places … nothing makes
a decision on it."*

**Wrong.** The whole `tokenUsage` object is persisted to two more columns:

- `BaziReading.tokenUsage` — `schema.prisma:97`, and the column comment names
  the field: `// { inputTokens, outputTokens, totalTokens, estimatedCostUsd }`.
  Written at `bazi.service.ts:609` **only**.
- `BaziComparison.tokenUsage` — `schema.prisma:138`. Written at `:2086` and
  `:2352`. ⚠️ v2 cited `:1768` as a `BaziReading` write; it is a
  `baziComparison.create` and it writes `undefined` (`const tokenUsage =
  undefined` at `:1749` — creation is deliberately AI-free).

The grep missed it because the object is **spread** into a Json column, so the
field name never appears at the write site. It also reaches the client via
`flattenComparisonResponse` (`bazi.service.ts:2448`), though no consumer reads
it: `TokenUsage` (`packages/shared/src/types.ts:568`) has zero readers in
`apps/web`, `apps/mobile` or `packages/`.

**v1 said:** *"V1 generic (HEALTH) `:472` computes properly ✅ correct."*

**Wrong.** It computes from `providerConfig.costPerInputToken/OutputToken`
(`ai.service.ts:89-90`, ~20 references), a second table that agrees with
`PRICE_TABLE` for Claude and GPT but **not** for Gemini:

| `gemini-2.0-flash` | input /1M | output /1M |
|---|---|---|
| `PRICE_TABLE` (`ai-spend.service.ts:109`) | $0.10 | $0.40 |
| `providerConfig` (`ai.service.ts:271-272`) | $2.00 | $12.00 |

**20× and 30×.** So the V1 row is *already* inconsistent with its own `record()`
call whenever the Gemini fallback is in use.

⚠️ **But the third figure reaches fewer rows than it looks.** The streamed
completion persist (`ai.service.ts:1645`) writes `aiInterpretation`,
`aiProvider` and `aiModel` — and **not** `tokenUsage`. It is the only write on
that path, so `bazi_readings.token_usage` is **NULL for LIFETIME, CAREER, ANNUAL
and LOVE**, the four paid flagship types. The three live writers of a
`providerConfig`-priced cost are therefore `:609` (V2 non-streaming is dead, so
in practice **HEALTH only**) and the two compat sites `:2086` / `:2352`.

That does not weaken part C — both compat paths are live and are the 3-credit
ones — but it bounds the Gemini re-pricing warning in §5, and the NULL column is
itself an unrecorded gap of exactly the #19 shape (see §6).

### Which `estimatedCostUsd: 0` sites are reachable

| Path | Sites | Live? |
|---|---|---|
| **Compat non-streaming** | `:4858` | ✅ **LIVE** — `recalculateComparison` (`bazi.service.ts:2039`), `generateComparisonAI` (`:2268`). **This produced the observed rows.** |
| LIFETIME / CAREER / ANNUAL / LOVE non-streaming V2 | `:639 :665 :830 :859 :2128 :2152 :4050 :4078` | ❌ **DEAD.** `STREAM_REQUIRED` (`bazi.service.ts:377`) throws before the inline branch; a cache hit takes the branch above. No other caller reaches those four generators. |
| V1 generic (HEALTH) | `:472` | ⚠️ computed, but from the **wrong table** (above) |
| Streaming (`_streamProviderInner`, added by #19) | — | ✅ correct |

⚠️ Eight of nine zeros cannot fire today, so **fixing only the compat site would
look complete and be a coincidence.** The next person to make a V2 type generate
inline reintroduces it without touching this code.

## 3. The fix

Four parts. Parts A and B are the change; C and D make it stick.

### A. `persistUsageRow` prices internally

Remove `costUsd` from its parameters entirely:

```ts
private async persistUsageRow(row: {
  userId?: string | null;
  readingId?: string | null;
  readingType?: ReadingType | null;
  provider: AIProvider | string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  isCacheHit?: boolean;
  // costUsd — REMOVED. Priced here, from `model` + tokens.
}): Promise<void>
```

Why this rather than "fix the nine zeros": it makes a wrong cost
**structurally impossible** instead of something every call site must get right.
Nine got it wrong; the tenth would too. Same argument that put the spend cap
inside `callProviderWithTimeout`.

⚠️ **Guard the value, not just the call.** The v1 plan said "catch a throw and
fall back to 0". Necessary but insufficient: a `NaN`/`Infinity` token count
yields `NaN` from `estimateCostUsd` **without throwing**, Prisma then rejects it
for a `Decimal` column, and that rejection lands in the OUTER catch — so the row
is silently lost. That inverts our own stated priority ("the token counts are
the part that cannot be recomputed later"). So:

One shared helper, used by `persistUsageRow` **and** all six part-C aggregates —
so the "one price table" property holds at ONE call site rather than seven:

```ts
/**
 * The only place `AIService` computes a cost. Never throws, never returns
 * non-finite. (`AiSpendService.record` computes one too, at
 * `ai-spend.service.ts:327`, and must — it is the breaker's path and cannot
 * depend on `AIService`.)
 *
 * Rounds to 6dp, which is what `AIUsageLog.costUsd` stores anyway
 * (`Decimal(10,6)`) — see §3C for why the rounding lives here.
 *
 * ⚠️ So the post-fix property is ONE CALCULATION, TWO REPRESENTATIONS — not
 * equality. `record()` increments Redis with the UNROUNDED result
 * (`ai-spend.service.ts:327` → `:343`), and it must: rounding inside `record()`
 * to "make them agree" would change what the breaker counts. The drift is
 * bounded at 5e-7 per call and is the right trade.
 */
private priceOrZero(model: string, inputTokens: number, outputTokens: number): number {
  let priced = 0;
  try {
    priced = this.aiSpend.estimateCostUsd(model, { inputTokens, outputTokens });
  } catch (err) {
    // ⚠️ Name the likely cause. In a test env this is almost always an
    // `aiSpend` stub without `estimateCostUsd` (see §4) rather than a real
    // pricing failure, and the two need different fixes.
    this.logger.error(
      `Failed to price (${model}) — typeof estimateCostUsd=` +
      `${typeof this.aiSpend?.estimateCostUsd}: ${err}`,
    );
  }
  if (!Number.isFinite(priced)) return 0;   // never lose the row
  return Math.round(priced * 1_000_000) / 1_000_000;
}
```

⚠️ The `isFinite` guard matters MORE at the part-C sites than here: a `NaN`
aggregate flows into `AIGenerationResult.tokenUsage` and then into a
`Prisma.InputJsonValue` write on `bazi_readings` / `bazi_comparisons`, so it
would fail a **paid reading's** persist, not a metrics row. (Pre-existing —
`tokens * rate` already propagates `NaN` — but part C touches all six lines, and
applying the principle in one place and not the other invites the question.)

### B. Narrow `logUsage`'s parameter so the zeros can actually be deleted

⚠️ v1 said "delete the nine `estimatedCostUsd: 0` literals". **That does not
compile.** `AIGenerationResult.tokenUsage.estimatedCostUsd` is a required
`number` (`ai.service.ts:70`) and `logUsage` takes `result: AIGenerationResult`
(`:7932`), so the literals are load-bearing for `tsc`.

Narrow the parameter instead:

```ts
private async logUsage(
  userId: string | undefined,
  readingId: string | undefined,
  config: ProviderConfig,
  result: {
    tokenUsage: { inputTokens: number; outputTokens: number };
    latencyMs: number;
    isCacheHit?: boolean;
  },
  readingType?: ReadingType,
)
```

This is strictly better than v1's shape:
- the nine literals become genuinely deletable;
- the invariant is **type-enforced** rather than resting on a grep-based source
  test (v1's only guard for it);
- it **requires** the fabricated ceremony to go — not merely permits it.
  TypeScript's excess-property check fires on every fresh object literal passed
  to the narrowed parameter, and all nine sites pass fresh literals carrying
  `interpretation`, `provider`, `model` and (nested) `totalTokens` /
  `estimatedCostUsd`. Those become **compile errors**, so plan for nine edits
  rather than discovering them. The compat site's
  `interpretation: { sections: {}, summary: { preview: '', full: '' } }`
  (`:4850-4851`) exists purely to satisfy a type whose `interpretation` field
  `logUsage` never reads.

### C. Delete the second price table

Replace the six aggregate expressions
(`totalInputTokens * providerConfig.costPerInputToken + …` at `:458-459`,
`:686-687`, `:876-877`, `:2165-2166`, `:4095-4096`, `:4912-4913`) with
`this.aiSpend.estimateCostUsd(providerConfig.model, { inputTokens, outputTokens })`,
then **delete `costPerInputToken` / `costPerOutputToken` from `ProviderConfig`**
(`:89-90`).

⚠️ **Rounding — decide it once, here.** The six sites currently disagree: four
wrap in `Math.round(x * 1_000_000) / 1_000_000` (`:472`, `:710`, `:900`,
`:2189`), two do not (`:4119` LOVE, `:4935` COMPAT — and COMPAT is the live
one). Since `priceOrZero` now rounds to 6dp internally, **delete all six
wrappers**: one rule, one place, matching what the `Decimal(10,6)` column stores
anyway. Leaving this open would invite six independent decisions.

⚠️ That alone does not remove the second table. There are 28 repo-wide
references: 20 in `ai.service.ts` and **8 in four spec files**
(`ai-service.spec.ts:618-619` — carrying real 3/15 rates —
`ai-retry-helpers.spec.ts:247-248`, `ai-call2-streaming.spec.ts:80-81`,
`ai-spend-chokepoints.spec.ts:74-75`). None breaks `tsc` (all are `any`-typed or
untyped literals, so no excess-property check fires), and §4's invariant test is
scoped to `apps/api/src/ai/`, which excludes them. Delete them in the same
commit and widen that test to `apps/api/`, or two stale rate literals survive
with no context for the next person who greps them up.

Without this, one compat reveal still writes **two disagreeing persisted cost
figures** — `ai_usage_log.cost_usd` from `PRICE_TABLE` and
`bazi_comparisons.token_usage.estimatedCostUsd` from `providerConfig` — and the
plan's own justification ("the two numbers become one calculation, so they
cannot drift") would be false on delivery.

Deleting `estimatedCostUsd` from `TokenUsage` outright is the cleanest end state
and nothing reads it — but it changes a `Json` column's shape on two tables, so
it belongs in a follow-up. Re-pricing it does not.

### C-bis. `AiSpendService.hasPriceEntry(model)` — a prerequisite for D2, shipped in D1

```ts
/** THE one scan. Null means "would fall back". */
private findPrice(model: string): ModelPrice | null { … }   // existing startsWith logic

/** Does `model` resolve to a real PRICE_TABLE entry, or would it fall back? */
hasPriceEntry(model: string): boolean { return this.findPrice(model) !== null; }

priceFor(model: string): ModelPrice {
  const p = this.findPrice(model);
  if (!p) { this.logger.warn(/* …unchanged… */); return FALLBACK_PRICE; }
  return p;
}
```

⚠️ **A `boolean` cannot give `priceFor` its price**, so the two-method shape a
first draft of this section showed (`priceFor` delegating to `hasPriceEntry`)
would scan twice while claiming one scan. The private `findPrice` is what makes
the single-scan claim true.

⚠️ **The `logger.warn` (`:206`) stays in `priceFor` ALONE**, not in `findPrice`.
Moving it into the shared scan would make `hasPriceEntry` a predicate with a
logging side effect, and D2's dry run over N unmatched rows would emit N
warnings — colliding with the "unknown model in production" signal this same
section cites that warn as providing.

⚠️ **D2 cannot be written without this, and the obvious workarounds are worse
than unavailable.** §3E must skip rows whose model would be priced at
`FALLBACK_PRICE`, but nothing outside `AiSpendService` can determine that:

- **Reference comparison** (`priceFor(m) === FALLBACK_PRICE`) would work —
  `priceFor` returns the constant itself — but `FALLBACK_PRICE` is a bare
  module-level `const` (`ai-spend.service.ts:115`), not exported, and
  `ModelPrice` (`:75`) is not exported either, so the script cannot even type
  the return value.
- **Value comparison is actively WRONG, not merely unavailable.**
  `FALLBACK_PRICE` is `{ input: 15, output: 75, cacheRead: 1.5, cacheWrite: 30 }`
  and `PRICE_TABLE['claude-opus-4']` / `['claude-opus']` (`:99-100`) are
  **byte-identical**. A value check would classify every legitimate Opus row as
  "unmatched" and skip it — and Opus is the most expensive model in the table,
  so it would refuse exactly the rows most worth repairing.
- **Re-implementing the `startsWith` scan in the script** is a second copy of
  the matching logic — the defect §3E exists to prevent, restated one level down.

Second use, worth noting: the same predicate is what an "unknown model in
production" alert would key on. Today that condition exists only as a
`logger.warn` at `:206`.

### D. Fix the test and comment this change invalidates

- `apps/api/test/stream-usage-log-row.spec.ts:42` asserts
  `expect(innerBody).toContain('this.aiSpend.estimateCostUsd(')`, where
  `innerBody` is the source slice of `_streamProviderInner`. Moving that call
  into `persistUsageRow` turns the #19 guard red. Rewrite it to assert the call
  inside the `persistUsageRow` slice **and its absence** from `innerBody` —
  which is a strictly better guard, because it then pins the dedupe.
- Relocate the comment at `ai.service.ts:6210-6222` ("⚠️ Priced separately
  rather than by awaiting `record()`'s return…") with the code. Its reasoning —
  awaiting a `void` inside a generator's `finally` changes when the generator
  settles — is still true and is still why `persistUsageRow` must not await
  `record()`.
- `scripts/check-ai-spend-metering.mjs` is unaffected: it counts
  `this.logUsage(` and `aiSpend.record(`, neither of which changes. Confirmed.

### E. Backfill — NOT in the load-test script

⚠️ v1 proposed `--repair-costs` in `load-test/purge-usage-log.mjs`. **Wrong
home.** That file is plain `.mjs` importing `@prisma/client` directly;
`PRICE_TABLE` is a non-exported `const` in a TypeScript file
(`ai-spend.service.ts:97`) and `priceFor`'s longest-prefix matching (`:197-213`)
is non-trivial. The script would have to reimplement both — **a third copy of
the pricing rules, untested, writing money figures to production.** That is a
fresh instance of the defect this plan exists to remove. Its guards do not
transfer either: `loadManifest()` `process.exit(1)`s without a manifest
(`:74-77`), and the window / `FABRICATION_INPUT_TOKEN_CEILING` predicates are
meaningless for a repair. Only `--target` carries over.

Instead: a Nest standalone script (`NestFactory.createApplicationContext`) that
injects `AiSpendService` and reuses `estimateCostUsd`. Keep the dry-run default
and `--target` confirmation; drop the manifest gate.

- Predicate: `costUsd = 0 AND (inputTokens > 0 OR outputTokens > 0)`.
- ⚠️ Write mechanism: `updateMany` **cannot** set a per-row computed value, so
  this is N individual updates (or a raw `UPDATE … CASE` keyed on `ai_model`).
  At today's 5 production rows either is fine; state that it is O(rows).
- ⚠️ **The backfill must NOT write a `FALLBACK_PRICE` row by default.**
  `priceFor` returns `FALLBACK_PRICE` = `{ input: 15, output: 75 }` for any
  `aiModel` that does not prefix-match `PRICE_TABLE`
  (`ai-spend.service.ts:205-212, 115`), and its own warning says why: *"billing
  at the most expensive known rate so the breaker errs toward tripping early."*

  That bias is right for a breaker, where over-counting merely trips early. **In
  a one-way reporting repair it is not conservative — it is just wrong**, and it
  is unrecoverable, because the repaired row stops matching the predicate.

  ⚠️ Not a marginal case: matching is `startsWith`, so a plausible historical id
  like `gpt-4-turbo` does not match `gpt-4o` and lands on FALLBACK — $15/$75
  against a real $10/$30, and a Gemini-era id would be off by 100×+.

  So: **skip rows whose model does not match `PRICE_TABLE`, and report them
  separately in the dry run.** The operator adds the model to `PRICE_TABLE` and
  re-runs — which the predicate still permits, since the row is untouched at
  `$0`. An explicit `--allow-fallback-price` may override, acknowledging the row
  will be priced at the most expensive known rate. This is a handful of lines
  and it is the difference between a repair and a fabrication.

- ⚠️ **Invariant the backfill depends on:** `costUsd` must remain a pure
  function of `(aiModel, inputTokens, outputTokens)`. `ai_usage_log` has **no
  cache-token columns**, but `estimateCostUsd` prices `cacheReadTokens` /
  `cacheWriteTokens` (`ai-spend.service.ts:215-224`) and `StreamUsage` already
  tracks both. The moment anyone feeds cache tokens into the price, `costUsd`
  stops being recomputable and the repair silently under-prices. Adding cache
  tokens to the calculation requires adding the columns first.

### Explicitly NOT in scope

- Deleting the four dead V2 non-streaming generators — overlaps the HEALTH
  decision in launch-gate #3.
- Chat and fortune writing usage rows at all. They call `aiSpend.record()`
  directly and have never written to `AIUsageLog`.
- Removing `estimatedCostUsd` from the `TokenUsage` type (Json shape change).

## 4. Test plan

### ⚠️ First: the test stub that would hide this fix

`persistUsageRow` touches no `aiSpend` method today. After part A it calls
`this.aiSpend.estimateCostUsd(...)` — and **~25 spec files stub `aiSpend` as
`{ record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn() } as never`.
None has `estimateCostUsd`.**

⚠️ Scope precisely: only the **~10 that construct `AIService`** can reach
`persistUsageRow` and need the stub widened (`ai-service.spec.ts`,
`streaming.spec.ts`, `ai-call2-streaming.spec.ts`, `ai-retry-helpers.spec.ts`,
`ai-spend-chokepoints.spec.ts`, `ai-spend-guard.spec.ts`,
`ai-failure-refund.spec.ts`, `reading-create-preflight.spec.ts`,
`users-service.spec.ts`, `bazi.service.generation-lock-ttl.spec.ts`). The wider
count matters for a different reason: it is why the **docblock** that propagates
the shape must change, or the idiom regrows.

So every one of those specs would hit `TypeError: this.aiSpend.estimateCostUsd
is not a function`, §3A's catch would swallow it, and the row would be written
at **`costUsd: 0`** — reproducing the exact defect under test while the suite
stays green. The existing `logUsage` specs assert with `expect.objectContaining`
and no `costUsd` key, so they would not notice. The mutation "price the row at a
literal `0`" would go red in **nothing**.

⚠️ This is not pattern-matching; it is this repo's documented recurring failure.
`ai-spend-chokepoints.spec.ts:10-23`: *"Two audits found this independently, and
neither the 22 service tests nor the CI guard caught it, because every spec
injected an ANONYMOUS stub … that no assertion could reach."* The plan routes a
new dependency straight back through the stub that already hid a spend defect
once, and the defensive catch added in §3A is what would make it silent.

Required, before anything else in this section:

1. Add `estimateCostUsd` to the stub everywhere `AIService` is constructed —
   **including the docblock at `ai-spend-chokepoints.spec.ts:17` that defines
   the idiom**, or the next author copies the old shape.
2. Change the existing `logUsage` specs to assert a **non-zero** `costUsd`, so a
   missing stub fails loudly instead of silently reproducing the bug.
3. The catch message names the likely cause (`typeof
   this.aiSpend?.estimateCostUsd`) — see `priceOrZero` in §3A — so the test-env
   case is diagnosable from one log line rather than mistaken for a pricing
   failure.

### The tests

| Test | Asserts |
|---|---|
| `persistUsageRow` prices from model + tokens | the row carries what `estimateCostUsd` returns |
| **Counter and row agree** | for one call, `record()`'s cost equals the persisted `costUsd`. Compare `Number(row.costUsd)` with `toBeCloseTo(recorded, 6)`. ⚠️ **The token counts MUST have a cost exactly representable at 6dp** — this is a requirement, not a suggestion, and it became load-bearing when `priceOrZero` started rounding. `toBeCloseTo(x, 6)` passes only when the difference is `< 5e-7` (strict), and rounding to 6dp produces a maximum error of *exactly* 5e-7 when the seventh decimal is a 5 — so the assertion otherwise sits precisely on its own boundary and fails intermittently. Representable inputs make the rounding a no-op and the comparison exact. If no convenient pair exists, use `toBeCloseTo(recorded, 5)`, which loses nothing that matters |
| Unknown model uses FALLBACK_PRICE | ⚠️ an unknown model does **not** throw — `priceFor` returns `FALLBACK_PRICE` after a warn (`:205-212`). This test asserts the fallback **value**, not a throw |
| A throwing `estimateCostUsd` logs at error and still writes | ⚠️ must be written with `jest.spyOn(aiSpend, 'estimateCostUsd').mockImplementation(() => { throw … })`. Under the new signature the real function cannot throw (the usage object is built in place from two required numbers, and `per()` handles `undefined`), so a malformed-input version of this test passes for the wrong reason and leaves the defensive branch unexercised |
| A non-finite price still writes the row at 0 | the `Number.isFinite` guard — otherwise Prisma rejects and the row is lost |
| Gemini aggregate re-priced from `PRICE_TABLE` | pins the 20×/30× correction |
| `hasPriceEntry('claude-opus-4') === true` | ⚠️ **the case the accessor exists for.** It is exactly what a value-based check gets wrong, since `FALLBACK_PRICE` is byte-identical to that entry |
| `hasPriceEntry(<unmatched id>) === false` | the other half |
| `priceFor` behaviour is preserved | the existing tiebreak and fallback specs must still pass unchanged after the C-bis extraction |
| Source invariant: one price table | `costPerInputToken` / `costPerOutputToken` appear nowhere in `apps/api/src/ai/` |
| Source invariant: no caller passes a cost | `persistUsageRow` has no `costUsd` parameter |
| #19 guard, rewritten | `estimateCostUsd(` present in `persistUsageRow`'s slice, ABSENT from `_streamProviderInner`'s |
| Backfill dry run changes nothing | mirrors the purge tool's proven shape |
| Backfill leaves a correctly-priced row alone | only `$0`-with-tokens rows are touched |
| **Recomputability — behavioural half** | write a row through `persistUsageRow`, recompute from `(aiModel, inputTokens, outputTokens)` ALONE, assert equality |
| **Recomputability — the half that actually bites** | ⚠️ the behavioural test above is near-tautological TODAY: `persistUsageRow` has no cache-token parameters, so the two calls cannot diverge, and it only fails after someone widens the signature — at which point they are editing its call site anyway. Pair it with a source assertion that fires without the author noticing: `cacheReadTokens` / `cacheWriteTokens` appear nowhere in `persistUsageRow`'s or `priceOrZero`'s source slice (the #19 guard already establishes the slicing technique). The absent cache COLUMNS are not a guard — widening the price needs no schema change, since `StreamUsage` tracks both (`stream-usage.ts:38-39`) and `estimateCostUsd` prices them (`ai-spend.service.ts:221-222`) |

**Mutations** (each must turn a test red): price the row at a literal `0`;
swallow the throw without logging; drop the `Number.isFinite` guard; re-add a
`costUsd` parameter; restore one `providerConfig.costPerInputToken` expression;
and — the one that proves the catch is not hiding the defect —
**remove `estimateCostUsd` from a stub.**

## 5. Risk and what to watch

**Low for correctness, but it is a visible behaviour change.**

- ⚠️ **Gemini-priced figures will drop by 20–30×** wherever the Gemini fallback
  was used, because `providerConfig` was over-pricing it relative to vendor
  rates. That is the right direction — `PRICE_TABLE` is the breaker's table and
  is documented against Anthropic/vendor pricing — but it is a real change to
  numbers someone may have recorded.
- ⚠️ `/admin/ai-costs` totals will **rise**, not because spend rose but because
  it was under-reported. Same caveat as #20. A week-over-week comparison needs
  to know the baseline moved.
- `AIUsageLog.costUsd` is `Decimal @db.Decimal(10, 6)` (`schema.prisma:266`):
  values are rounded to 6dp on store (so the persisted number is not
  bit-identical to the float), and the column tops out at $9,999.999999 — no
  single call approaches it, but the bound is now worth stating since we write a
  computed value rather than a caller-supplied one.
- Nothing reads any of these columns for a decision. The breaker, quota, cap and
  every payment path are untouched.
- **Rollback:** revert the commit for the code. ⚠️ **The backfill is ONE-WAY,
  and v2's claim that it is "re-runnable rather than lossy" was FALSE.** The
  predicate is `costUsd = 0 AND (inputTokens > 0 OR outputTokens > 0)`; once a
  row is repaired it has `costUsd > 0` and **no longer matches**, so a second run
  cannot reach it. If the first run priced wrongly — run before part C lands, or
  against a stale table — the only recovery is widening the predicate on a guess,
  which is exactly the hazard `purge-usage-log.mjs`'s own comment warns about.

  ⚠️ **v3's mitigation was inert and is withdrawn.** It said "runs only after
  part C is deployed, so there is one price table in effect." But the backfill
  injects `AiSpendService` and calls `estimateCostUsd`; it never reads
  `providerConfig`. `PRICE_TABLE` is already the only table it can reach —
  before part C and after. That constraint could not change a single value it
  writes, while `--rows`, the one thing that actually recovers a bad run, was
  labelled optional. The two were the wrong way round.

  **What actually protects an irreversible write:**

  1. **The dry-run default** — the operator sees every computed value before
     anything is committed. This is the real control, not the ordering.
  2. **`--rows <ids>` is a required CAPABILITY, not an optional extra** — and
     not a mandatory flag on every run, which would make the normal bulk repair
     impossible. It is the recovery path, used when the predicate can no longer
     reach a row.
  3. **Ordering that does matter: run it after part A is deployed**, or new `$0`
     rows keep accruing behind the repair. That is completeness, not
     correctness — the predicate still matches them on a later run.

## 6. Adjacent gaps, noted not fixed

### `bazi_readings.token_usage` is NULL for every streamed reading

The streamed completion persist (`ai.service.ts:1645`) writes
`aiInterpretation`, `aiProvider`, `aiModel` — and no token usage. It is the only
write on that path, so the column is empty for LIFETIME, CAREER, ANNUAL and
LOVE: the four paid flagship types.

⚠️ This is the **#19 shape again** — the streamed path forgot a cost column, and
nothing noticed. Recorded here so it is found as a known gap rather than
rediscovered as a new bug in three months. Out of scope because filling it is a
behaviour change to a Json column, not a correction to a wrong number.

### `isCacheHit`

`isCacheHit` is **never `true`** anywhere. The only `isCacheHit: true` in the
repo is the dashboard's own `where` filter (`admin.service.ts:711`); nothing
constructs an `AIGenerationResult` with it set. So every row is `false` and
`/admin/ai-costs`'s `cacheHitRate` is structurally 0 — while `logUsage`'s
docblock (`ai.service.ts:7935-7938`) reasons carefully about a case that cannot
occur. Adjacent to this change, not caused by it; recorded so the next reader of
that docblock is not misled.

## 7. What earlier revisions got wrong (kept deliberately)

### Round 5 (v5 → v6) — APPROVE, both deliverables

1. **Minor** — the C-bis sketch could not deliver the "one scan" it claimed: a
   `boolean` carries no price, so `priceFor` would scan twice. Needs a private
   `findPrice`. → §3C-bis.
2. **Minor** — §2's "the spend breaker is UNAFFECTED" went stale the moment
   C-bis was added to D1: it edits `priceFor`, which IS on the breaker's hot
   path. The claim was structural ("we don't touch that file") and had to become
   a behaviour-preservation obligation. → §2, §4.
3. **Nit** — the header said "three rounds"; it was four. → header.

### Round 4 (v4 → v5) — D1 APPROVED

1. **Moderate** — D2's FALLBACK-skip had no implementable detection. Worse, the
   obvious value comparison would have skipped every legitimate Opus row, since
   `FALLBACK_PRICE` is byte-identical to the two Opus entries. → §3C-bis.
2. **Nit** — "`--rows` is REQUIRED" read as a mandatory flag on every run. → §5.
3. **Nit** — after rounding moved into `priceOrZero`, the property is "one
   calculation, two representations", not equality; `record()` stays unrounded
   deliberately. → §3A.
4. **Nit** — the agreement test's representable-token-count guidance became
   load-bearing and was still written as a parenthetical. → §4.

### Round 3 (v3 → v4)

1. **Moderate** — §5's ordering mitigation was INERT: the backfill never reads
   `providerConfig`, so "after part C" could not change any value it writes,
   while `--rows` (the only real recovery) was labelled optional. → §5.
2. **Moderate** — the backfill would silently apply `FALLBACK_PRICE` ($15/$75)
   to any unrecognised model, permanently and unrecoverably overstating it. The
   bias exists for the breaker and does not belong in a reporting repair. → §3E.
3. **Minor** — the recomputability test was near-tautological as specified. → §4.
4. **Nit** — the six part-C sites round inconsistently (`:4119`, `:4935` do not,
   and COMPAT is the live one); the plan left it open. → §3A, §3C.
5. **Nit** — `priceOrZero`'s docstring claimed to be the only place a cost is
   computed; `record()` computes one too and must. → §3A.
6. **Nit** — "26 spec files" is the idiom count; only ~10 construct `AIService`
   and need the stub widened. → §4.

### Round 2 (v2 → v3)

1. **Major** — the `aiSpend` test stub in 26 spec files has no
   `estimateCostUsd`, and §3A's catch would turn that into a silent
   `costUsd: 0` across all of them, green. → §4.
2. **Moderate** — §5's "a wrong backfill is re-runnable rather than lossy" was
   FALSE: a repaired row stops matching the predicate. → §5.
3. **Moderate** — part C's reach was overstated; `token_usage` is NULL for all
   four streamed types, so the live writers are HEALTH plus two compat sites. → §2, §6.
4. **Minor** — the `isFinite` guard belonged at the six part-C sites too, where
   a `NaN` fails a PAID reading's persist. → §3A.
5. **Minor** — §3B said the ceremony *may* go; it *must* — nine compile errors. → §3B.
6. **Nit** — 8 references to the second price table survive in spec files. → §3C.
7. **Nit** — `:1768` miscited as a `BaziReading` write. → §2.

### Round 1 (v1 → v2)

1. **Critical** — claimed `estimatedCostUsd` was not persisted. It is, to two
   Json columns, from a second price table. The stated goal was not achievable
   as scoped. → §2, §3C.
2. **Major** — called the V1 path correct. It uses the second table, which
   differs 20×/30× on Gemini. → §2, §3C.
3. **Major** — put the backfill in a `.mjs` script that cannot reach
   `PRICE_TABLE`, forcing a third copy of the pricing rules. → §3E.
4. **Major** — "delete the nine literals" does not compile. → §3B.
5. **Moderate** — did not notice it breaks `stream-usage-log-row.spec.ts:42`. → §3D.
6. **Minor** — the agreement test would fail on `Prisma.Decimal` vs `number`. → §4.
7. **Minor** — assumed an unknown model throws; it falls back. → §4.
8. **Minor** — treated the backfill's recomputability as a fact, not an
   invariant to state and defend. → §3E.
9. **Minor** — guarded only against a throw, not a `NaN`, which loses the row. → §3A.
10. **Nit** — `Decimal(10,6)` precision/overflow unexamined. → §5.
11. **Nit** — `isCacheHit` dead flag unmentioned. → §6.
