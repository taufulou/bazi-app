# Fix: `AIUsageLog.costUsd` disagrees with the spend counter

**Status:** planned, not implemented. Standalone — not part of the launch-gate
todo list, though it is the third reason `/admin/ai-costs` under-reports (after
#19 streaming blindness and #17 load-test residue, both now fixed).

**Found:** 2026-09-02, while purging load-test rows. Three production
`COMPATIBILITY` rows showed real token counts (14,769 / 11,347 / 9,939 input)
against a cost of **`$0`**.

---

## 1. What is actually wrong

`logUsage` does two things with one set of token counts, and prices them from
**two different sources**:

| Destination | Cost comes from | Correct? |
|---|---|---|
| Redis spend counter (what the breaker reads) | `aiSpend.record()` → `estimateCostUsd(model, usage)` | ✅ always |
| `AIUsageLog.costUsd` (what `/admin/ai-costs` reads) | `result.tokenUsage.estimatedCostUsd`, supplied by the CALLER | ❌ nine callers hardcode `0` |

So the two numbers disagree **by construction**, not by accident. Every caller
has to remember to compute a cost that the very same function is already
computing correctly two lines earlier.

The nine `estimatedCostUsd: 0` literals are the symptom. **The defect is that
`persistUsageRow` accepts a cost from its caller at all.**

## 2. Blast radius — measured, not assumed

⚠️ **The spend breaker is UNAFFECTED.** `record()` calls
`estimateCostUsd(args.model, args.usage)` and never reads `estimatedCostUsd`
(`ai-spend.service.ts:327`). Verified by grep: the field appears nowhere in
`ai-spend.service.ts`. The daily cap, the 80% warning and the trip all price
correctly. This is a **reporting** bug, not a safety one.

`estimatedCostUsd` is read in exactly two places: the DB write
(`ai.service.ts:7962`) and a log message (`:489`). Nothing makes a decision on
it.

### Which paths are affected

| Path | Sites | Live? |
|---|---|---|
| **Compat non-streaming** (`generateCompatibilityRomanceV2`) | `:4858` | ✅ **LIVE** — reached from `recalculateComparison` (`bazi.service.ts:2039`) and `generateComparisonAI` (`:2268`). **This is what produced the observed rows.** |
| LIFETIME / CAREER / ANNUAL / LOVE non-streaming V2 | `:639 :665 :830 :859 :2128 :2152 :4050 :4078` | ❌ **DEAD.** `isV2Reading && !isStreamingRequest && !cachedInterpretation` throws `STREAM_REQUIRED` (`bazi.service.ts:377`) before the inline branch, and a cache hit takes the branch above it. Unreachable, but a live trap if anyone revives them. |
| V1 generic (HEALTH) | `:472` computes properly | ✅ correct |
| Streaming (`_streamProviderInner`, added by #19) | uses `estimateCostUsd` | ✅ correct |

⚠️ The dead-path finding is worth keeping: eight of the nine zeros cannot fire
today, so **fixing only the compat site would look complete and be a
coincidence**. The next person to make a V2 type generate inline reintroduces
the bug without touching this code.

## 3. The fix

**Remove `costUsd` from `persistUsageRow`'s parameters entirely and price it
internally**, from the same function the counter uses.

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

Why this shape rather than "fix the nine zeros":

- It makes a wrong cost **structurally impossible** rather than a thing every
  call site must get right. Nine sites got it wrong; the tenth would too.
- It is the same argument that put the spend cap inside
  `callProviderWithTimeout` — coverage by construction, not by a list someone
  has to keep complete.
- The two numbers become one calculation, so they cannot drift.

Callers keep `estimatedCostUsd` on the returned `AIGenerationResult` (the
aggregate totals at `:710 :900 :2189 :4119 :4935` are real and are part of the
API response). It simply stops being the source for persistence.

⚠️ `estimateCostUsd` can throw on a malformed usage object — its own docblock
says so, which is why `record()` calls it inside a try. `persistUsageRow` must
do the same and fall back to `0` **with an error log**, never silently: a
priced-at-zero row that says so in the log is recoverable, a silent one is the
bug we are fixing.

### Also in scope

1. **Delete the nine `estimatedCostUsd: 0` literals** from the `logUsage` call
   sites. Once the parameter is gone they are dead weight that reads like a
   deliberate zero.
2. **Backfill existing rows.** `costUsd` is recomputable from `aiModel`,
   `inputTokens` and `outputTokens`, all of which are stored. Add
   `--repair-costs` to `load-test/purge-usage-log.mjs` (dry-run by default,
   `--target` required, same guards). Scope: `costUsd = 0 AND (inputTokens > 0
   OR outputTokens > 0)`.
   ⚠️ Production currently has **5 rows total** after the #17 purge, 3 of them
   the $0 compat ones — so the backfill is nearly moot today. It matters because
   rows accumulate between now and deploy.

### Explicitly NOT in scope

- Deleting the four dead V2 non-streaming generators. That is a real cleanup but
  it overlaps the HEALTH decision in launch-gate item #3, and mixing them makes
  both harder to review.
- Chat and fortune writing usage rows at all. They call `aiSpend.record()`
  directly and have never written to `AIUsageLog`, so their spend is absent from
  `/admin/ai-costs` entirely. Separate gap, separate change.

## 4. Test plan

| Test | Asserts |
|---|---|
| `persistUsageRow` prices from model + tokens | a row written with a known model and token counts carries the cost `estimateCostUsd` returns |
| The counter and the row agree | for one call, `record()`'s cost and the persisted `costUsd` are equal — the property the whole fix exists for |
| An unknown model still writes a row | falls back to the FALLBACK_PRICE path rather than dropping the row; tokens are the part that cannot be recomputed later |
| A throwing `estimateCostUsd` logs at error and still writes | never silently zero |
| Source invariant: no caller passes a cost | `persistUsageRow` has no `costUsd` parameter, and `estimatedCostUsd:` appears zero times in `logUsage` call sites |
| Backfill: dry run changes nothing | mirrors the purge tool's proven shape |
| Backfill: only touches `$0`-with-tokens rows | a correctly-priced row is left alone |

**Mutation checks** (each must turn a test red):
- price the row at a literal `0` → the agreement test fails
- swallow the `estimateCostUsd` throw without logging → the error-log test fails
- re-add a `costUsd` parameter → the source invariant fails

## 5. Risk

**Low.** The change is confined to how one column is computed; nothing reads
that column for a decision. The breaker, the quota, the cap and every payment
path are untouched.

The one thing to watch: `/admin/ai-costs` totals will **rise** after deploy —
not because spend rose, but because it was being under-reported. Anyone
comparing week-over-week needs to know the baseline moved. Same caveat as #20.
