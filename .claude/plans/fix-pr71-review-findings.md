# Fix: the 8 findings from the PR #71 code review

**Status:** planned, not implemented. **Standalone — does NOT supersede
`fix-usage-log-cost-inconsistency.md` (D1/D2, both shipped) or the launch-gate
todo list.** Follow-up on code already on the PR branch.

**Revision 3.** v1 → CHANGES REQUIRED (12). v2 → CHANGES REQUIRED (9), including
a **critical money regression in the shape v2 adopted**. v3's §2 is smaller than
both: it changes a label and an exit, and touches no money decision.

**Revision 2.** v1 → CHANGES REQUIRED (12 issues). Its §0 mechanism was wrong in
a way that made the whole design point at a boundary that cannot report; the
shape below is the reviewer's, and it is simpler. All 12 folded in; §7 lists them.

---

## 0. Why the obvious fix is wrong

⚠️ **F1 alone makes things worse, and F1's *natural* fix — rethrow to the
Observable boundary — cannot work at all.**

`_executeStreamV2Common` is `try { … } finally { … subscriber.complete(); }`
(`ai.service.ts:1327`, `:1701-1705`) — **there is no catch**. So a rethrow runs
`subscriber.complete()` on the way out, and only *then* rejects into the
wrapper's `.catch()` at `:1186`, which calls `subscriber.next({type:'error'})`
**on a subscriber that has already stopped.** Verified empirically against this
repo's rxjs:

```js
async function inner(sub) { try { throw new Error('AI_BUSY'); } finally { sub.complete(); } }
new Observable(sub => { inner(sub).catch(() => { sub.next({type:'error'}); sub.complete(); }); })
// observed events: ["COMPLETE"]      ← the error never lands
```

So the three states are:

| | money | what the user sees |
|---|---|---|
| **today** (no guard) | refunded — absorbed to `status='failed'`, refund at `:1661` | a `final` event saying it failed |
| **v1's plan** (rethrow to the boundary) | refunded by the boundary helper | ⚠️ **nothing.** No `final`, no `error` — the stream just ends. And the post-loop block at `:1657-1690` is skipped, so the row keeps stale content while `refundedAt` is set, which per `bazi.service.ts:1198` makes it permanently unopenable |
| **v2** (below) | refunded, labelled `self-refusal:` | a real `final` event |

v1's ordering verdict happened to be right; its mechanism was not, and its F2
test would have passed in the broken state.

**The fix is to handle the refusal INSIDE the function, before the `finally`,
reusing the block that already exists — not to rethrow.**

---

## 1. Findings

| # | Finding | Severity | Fix |
|---|---|---|---|
| F1+F2 | Streaming V2 lacks the `isSelfRefusal` guard; a rethrow would be swallowed | 🔴 | one change inside `_executeStreamV2Common` — §2 |
| F3 | `--rows` cannot recover an unpriced row | 🟡 | itemise + require the flag |
| F4 | DB row omits the estimated-tokens marker | 🟡 migration | `output_tokens_estimated` |
| F5 | `--rows` ids unvalidated | ⚪ | ⚠️ **not** the fix the review proposed — §4 |
| F6 | `--allow-fallback-price` untested as a write | ⚪ | needs a small refactor first |
| F7 | `maxRows(...)` recomputed | ⚪ | hoist |
| F8 | Spend-cap reads per streamed reading | ⚪ no code change | ⚠️ the count was wrong — §5 |

---

## 2. F1 + F2 — one change, inside one function

### The shape

⚠️ **v2's rule (`totalGot > 0` → keep the degraded reading, do not refuse) was a
MONEY REGRESSION and is withdrawn.** `call2Critical: true` is set for
**CAREER, LIFETIME, ANNUAL and DEFAULT** (`ai.service.ts:148-152`; LOVE resolves
to DEFAULT) — i.e. every consumer of `_executeStreamV2Common`. The status machine
already reads it at `:1568-1569`:

```ts
} else if (cfg.call2Critical && call2Got === 0) { status = 'failed';
```

So **today** a Call 2 refusal with `call2Got === 0` is `failed` → refunded →
content nulled, *however much Call 1 delivered*. That is deliberate: a LIFETIME
with zero Call-2 sections is not a sellable reading. v2's rule would have kept
the content and **not refunded** — full price for half a reading, on the paid
path, contradicting "the charge must follow the content". Its own test row would
have locked the regression in.

**So: do not touch the status computation at all.** It already encodes the
per-type policy and already reaches the right verdict for both refusal cases.
Change only the label and the exit:

1. **Capture** the refusal in both catches — Call 1 at `:1468`, Call 2 inside
   `_streamV2Call2Loop`.
   ⚠️ Call 2 must **RETURN** the refusal, not throw it. Its call site
   `.catch()`es everything into `null` (`ai.service.ts:1367`), so a rethrow is
   swallowed and the guard would be a silent no-op — the same "guard added,
   swallow point untouched" miss as v1. Add `refusal?: unknown` to the
   `Call2Streamed` type (`:1339`) and read it at the `await` (`:1523`).
2. **Break the provider loop AFTER `:1553`**, not from inside the Call 1 catch.
   `call2Promise` is created at `:1345` (before Call 1 runs) and awaited at
   `:1523`; breaking earlier jumps past that await, so `call2TotalInput/Output
   Tokens` are never accumulated (`:1524-1526`) and `call_complete` is never
   emitted (`:1550-1553`) — while the sections themselves survive, because
   `call2FixedSections` is mutated by reference. Accounting desyncs from content.
   ⚠️ The in-flight request is not leaked: `call2Controller` is in
   `externalControllers` (`:1780`) and the teardown at `:1195` aborts it.
   ⚠️ `:1554` already does `if (totalSoFar > 0) break;`, so this only changes the
   `totalGot === 0` case.
3. **Leave `:1565-1579` untouched.**
4. In the **existing** `if (status === 'failed')` block, use
   `self-refusal:${selfRefusalCode(err)}` as the refund reason when a refusal was
   captured, else today's `ai-failed-…`.
5. In the `final` event (`:1680-1690`), use a refusal-appropriate message. The
   current "AI service is temporarily busy" is right for `AI_BUSY` and **wrong**
   for `QUOTA_EXCEEDED` and `AI_SPEND_CAP`.
6. Add `selfRefusalCode` to the import at `:17`.

⚠️ **`_setupStream`'s backstop is untouched and must stay.** Under this shape the
refusal never escapes `_executeStreamV2Common`, so `bazi.service.ts:1200-1215`
keeps covering only setup-time refusals. Do not add a second refund path.

### What F1 actually is (v1 and v2 both overstated it)

Today an AI_BUSY with nothing delivered already reaches `status='failed'`
(`:1566`) → refund (`:1660`) → `aiInterpretation: Prisma.DbNull` (`:1670`) → a
`final` event (`:1685`). **The money is already right and the user already gets
a `final`.** The real defects are narrower, which re-rates F1 from 🔴 to 🟡:

- `failedReason` says `ai-failed-LIFETIME-call1=0/…`, polluting the ledger and
  any AI-failure-rate metric with refusals we issued ourselves;
- providers 2 and 3 are attempted for a refusal that is global;
- the "temporarily busy" message is wrong for `QUOTA_EXCEEDED` / `AI_SPEND_CAP`.

### Test plan

Extend the existing specs — do not open new files that duplicate fixtures:
`src/bazi/bazi.service.self-refusal-refund.spec.ts` (the `_setupStream`
backstop) and `src/bazi/bazi.service.reveal-charge.spec.ts` (compat).
⚠️ `reveal-charge.spec.ts:136` already documents that
`streamCompatibilityRomanceV2` never calls `subscriber.error()` — do not write
an assertion that contradicts it.

| Test | Asserts |
|---|---|
| Call 1 refusal, nothing delivered | refunded with `self-refusal:`, interpretation nulled, **`final` emitted** |
| **A `final` event is emitted** | the v1 design would have passed its own test while emitting nothing — this is the assertion that catches that |
| Call 2 refusal, Call 1 delivered | ⚠️ **still `failed` + refunded**, per `call2Critical` — only the LABEL changes. v2 asserted "degraded, NOT refunded", which would have locked in full-price-for-half-a-reading |
| Provider failure | unchanged: `status='failed'`, `ai-failed-…` reason |
| No double refund | already-refunded row → `refunded:false`, no ledger row (idempotent via `credits.service.ts:71-107`) |
| Refusal stops the provider loop | providers 2 and 3 are not attempted |
| Both catches handle it | source assertion naming `:1468` and `_streamV2Call2Loop` |

**Mutations:** make `_streamV2Call2Loop` THROW instead of returning the refusal →
the Call 2 labelling test must fail (this is the one that catches the swallowed
`.catch()`); drop the Call 1 capture → the label reverts to `ai-failed-`;
continue the provider loop → the loop test fails; break before `await
call2Promise` → the token-accounting test fails.

Add a source assertion that the `.catch()` at `:1367` is **not** what carries
refusal state.

---

## 3. F4 — persist the estimated-tokens marker

```prisma
outputTokensEstimated Boolean @default(false) @map("output_tokens_estimated")
```

⚠️ **Unstated precondition in v1, now explicit: F4 must land in the same deploy
as #20's estimator, or earlier.** The "every historical row is correctly
false" argument holds only because the estimator (`ai.service.ts:6120-6123`) has
**never been deployed** — PR #71 is unmerged and Railway deploys from `main`. If
#20 ships first, rows written in that window are estimated but recorded `false`,
and `@default(false)` silently mislabels them. Staging and load-test rows are
already in that state.

⚠️ **F4 must ship in the SAME PR as #20's estimator. Deferring it to a
follow-up is the failure mode, not a de-risking** — the gap between the two
deploys is exactly the window in which rows are estimated but recorded `false`.

⚠️ **This column has no reader yet, and that is deliberate.** No
`/admin/ai-costs` change is in scope, so nothing separates measured from
inferred after this ships. It is groundwork: it stops the fact being
*unrecoverable*. Say so rather than implying the finding is closed.

- Thread through `persistUsageRow` (it already reaches `record()` at `:6130`).
- ⚠️ Do NOT widen `logUsage`'s parameter — the non-streaming path never
  estimates (verified). Default `false` there.
- Migration BEFORE code. Additive with a default, so rollback is revert-the-code
  and the column can stay.

---

## 4. F3 + F5 + F7 — the repair script

**F3.** Unpriced rows are already reported (`repair-usage-costs.ts:221-231`),
grouped by model with a count — ⚠️ not "silently skipped", as v1 claimed. The
real gap is that `--rows` **aggregates** them when the operator asked about
specific rows. Fix: under `--rows`, list each unpriced row by id and model, and
name the flag that would include it. Do **not** make `--rows` imply
`--allow-fallback-price` — the recovery path is used when something has already
gone wrong, the worst moment to widen a rule silently.

**F5.** ⚠️ **The review's own premise was wrong and its fix would be harmful.**
`ai_usage_log.id` is **TEXT**, not `uuid` (`migrations/20260206155710_init/
migration.sql:156`; the model is `id String @id @default(uuid())` with no
`@db.Uuid`). A malformed id therefore produces **no Prisma error at all** — it
simply does not match, so there is no stack trace to replace. A uuid shape-check
would *reject an id the table genuinely contains* if the format ever varies, on
the recovery path.

So: **no shape check.** Keep only the half that closes the real gap — diff the
requested ids against what `findMany` returned and report each absentee by id,
because `findMany` silently returning fewer rows is what makes a typo look like
success.

**F7.** `const cap = maxRows(val('max-rows'));` used by both `take` and the
truncation message.

### F6 — needs a refactor first

⚠️ **The prescribed test cannot be written as-is.** `main()` is not exported and
not guarded: `repair-usage-costs.ts:274` is a bare `main().catch(…)` at module
scope, so importing the module **runs the script**. The existing suite works
around exactly this and says why (`test/repair-usage-costs.spec.ts:145-147`).

In scope, therefore:

```ts
export async function executeRepair(prisma, plan): Promise<number>   // the write loop
if (require.main === module) { main().catch(…); }                    // guard the auto-run
```

Then the write loop is unit-testable and F6 is genuinely closed. Without it F6
degrades into another source assertion — which is what the finding objected to.

| Test | Asserts |
|---|---|
| `--rows` lists an unpriced row **by id** | not folded into the aggregate |
| `--rows` still refuses to write it without the flag | the recovery path does not widen the rule |
| A requested id that does not exist is reported | the silent-`findMany` gap |
| `--allow-fallback-price` **writes** (F6) | via `executeRepair`, so dropping `willWrite` back to `priced` fails |

---

## 5. F8 — documentation only, and the count was wrong

⚠️ v1 said "two spend-cap Redis reads". A streamed LIFETIME reading performs
**at least three, normally four+**: `bazi.service.ts:593` (`reading:create`),
`:1129` (`reading:stream`), and `ai.service.ts:6026` (`stream:${provider}`)
**once per `streamProvider` call** — Call 1 and Call 2 each.

⚠️ The rationale v1 wanted to add **already exists**, at
`bazi.service.ts:582-591`. The only thing missing is a reverse pointer: a one-line
cross-reference at `:1129` back to `:582`, so someone removing the "duplicate"
reads the reason first. Removing the pre-flight reintroduces charged-then-refused.

---

## 6. Risk

**Lower than v1 and v2 both claimed.** v3 changes a refund *reason string*, an
error *message*, and when the provider loop exits. It touches **no** money
decision: the status machine, `call2Critical`, the refund call and the nulling
all stay exactly as they are.

- A saturation event already produces a `final` event with `refunded: true`
  today. After v3 it says *why* accurately instead of "temporarily busy".
- F4 changes a table shape (additive, defaulted).
- Nothing in this plan rewrites data.
- **Rollback:** revert. F4's column may stay.

---

## 7. What earlier revisions got wrong (kept deliberately)

### Round 2 (v2 → v3)

1. **Critical** — v2's `totalGot > 0` rule overrode `call2Critical: true`, which
   is set for all four consumers. It would have kept Call-1-only content and NOT
   refunded: full price for half a reading, on the paid path, with v2's own test
   locking it in. → §2.
2. **Major** — the Call 2 guard was a no-op: `_streamV2Call2Loop`'s throw is
   `.catch()`ed into `null` at `:1367`. Return the refusal instead. → §2.
3. **Major** — breaking the provider loop from the Call 1 catch skips `await
   call2Promise`, desyncing token accounting and `call_complete` from content
   that survives by reference. → §2.
4. **Moderate** — F1 was over-rated 🔴. Today's behaviour is already
   money-correct and already emits a `final`; the defects are the label, the
   pointless retries, and a wrong message for QUOTA/CAP. → §2, §6.
5. **Minor** — the plan did not say `_setupStream`'s backstop stays untouched,
   inviting a second refund path. → §2.
6. **Minor** — F4's "groundwork" framing invites splitting it into a follow-up,
   which is what creates the mislabelled window. → §3.
7. **Nit** — "refusal stops the provider loop" is already true when
   `totalSoFar > 0` (`:1554`); only the zero case changes. → §2.
8. **Nit** — `yieldedAny` is at `:1403`. → §2.
9. **Nit** — the F5 citation pointed at the `users` table; `ai_usage_log`'s id is
   at `:156`. → §4.

### Round 1 (v1 → v2)

1. **Critical** — §0's mechanism. `finally { subscriber.complete() }` runs
   before the wrapper's `.catch()`, so the error never lands; v1 would have
   refunded the user and told them nothing, left the row unopenable, and passed
   its own test. → §0, §2.
2. **Major** — the "all five boundaries" helper. Only four consume
   `_executeStreamV2Common`; the fifth is compat, takes a `comparisonId`, is
   already refunded by `settleRefundIfEmpty`, and is unreachable. → §2.
3. **Major** — F1 was placed at one of **two** catches; `_streamV2Call2Loop`
   (`:1856`) was never mentioned, and v1's "rethrow anyway" rule would discard a
   fully-delivered Call 1 there. → §2.
4. **Moderate** — F5's premise: the id column is TEXT, so there is no Prisma
   error to prevent, and a uuid check would reject valid ids. → §4.
5. **Moderate** — F6's test is unwritable without exporting the write loop and
   guarding the auto-run. → §4.
6. **Moderate** — the plan named no existing specs to extend, inviting duplicate
   fixtures and a contradiction with `reveal-charge.spec.ts:136`. → §2.
7. **Minor** — F4's backfill argument had an unstated deploy precondition. → §3.
8. **Minor** — F4 adds a column with no reader; that is groundwork, not closure. → §3.
9. **Minor** — F8's read count was 2; it is 3-4, and the comment it asked for
   already exists. → §5.
10. **Nit** — `:1468` is the per-ATTEMPT catch, not per-provider. → §2.
11. **Nit** — F3's "silently skipped"; they are already reported, just
    aggregated. → §4.
12. **Nit** — `credits.service.ts` citation was `:77-88`; the function is
    `:71-107` with the guard at `:84`. → §2.
