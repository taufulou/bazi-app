# §0 STATE 2026-09-02 — STRIPE IS NEXT. Read this first.

**Supersedes every dated section below.**

> ### 📋 THE TODO LIST LIVES IN THIS FILE
> When asked to "check the todo list", read **`## ✅ THE TODO LIST`** below.
> Everything else here is history or evidence.

## Where things stand

LIVE at `https://tianmingapp.com`. Phases 1, 2B (M1–M10), 2C (Ob1–Ob3) and
**3 (load test, L1–L6)** are complete. Teardown is done — nothing from the load
test is left running.

### Since 2026-08-31

Todos #11, #15, #14, #12, #9, #16 and #13 all closed (see the list). Two things
from that run change the state above:

- **Alerting is now real.** `SENTRY_DSN` is set on the Railway API service and
  an alert rule exists; both spend events were proven end to end by the #7
  breaker drill. Before this, `AllExceptionsFilter` had **never** reported an
  application error to Sentry — the "test it by forcing a 500" advice could not
  have worked, and the operator's failed attempt is what found it.
- **🔴 A NEW money bug: todo #21.** The drill's own refusal charged 3 credits
  and delivered nothing. Same class as #2, on the streaming path. It is in
  "Blocking launch" and it is live on `main`.

Prod env now also carries `AI_STREAM_TIMEOUT_MS=300000` (todo #18) and
`AI_DAILY_SPEND_LIMIT_USD=50` / `AI_MONTHLY_SPEND_LIMIT_USD=900` (todo #7).

**⚠️ The next thing to do is STRIPE (todo #4).** It is the only launch blocker
that waits on other people (Paid Apps agreement, banking, tax), so every day it
is not started is a day on the critical path. Everything else is engineering you
control.

⚠️ **This session jumped ahead of Stripe to fix todo #2, and that was out of
order.** The decision was made when the evidence said every LIFETIME reading was
failing in production — which would have made it a genuine P0. Probe A then
disproved that premise. The fix is done and well-tested; the sequencing lesson
is that **Step 0 (a $0.60, 15-minute measurement) should have run BEFORE a
four-round reviewed plan, not after.** It would have re-ranked the whole session.

`origin/main` is at PR #70 (`c5b35f3`). **Unpushed on
`claude/m10-web-calc-routes`: 2 commits** — `9282d2d` (L6 report) and `cc02da5`
(the charged-empty-reading fix). Working tree clean.

## The charged-empty-reading fix — SHIPPED this session (`cc02da5`, unpushed)

Plan (7 revisions, 5 staff-review rounds, 33 issues, all accepted):
**`~/.claude/plans/fix-charged-empty-reading.md`**.

**The bug:** `createReading`'s catch swallowed AI errors ("Don't fail the
reading") and fell through to the transaction, which charged unconditionally.
Result on production: 201 after ~90.4s, `aiInterpretation: null`,
`aiProvider: null`, `isDegraded: false`, `failedReason: null`,
`refundedAt: null`, `creditsUsed: 3`. No refund, no alert.

**The root cause** (production log: `All AI providers failed. Last error:
Request was aborted.`): **the two paths give the same work different budgets.**

| path | timeout | measured need |
|---|---|---|
| streaming (SSE) | `AI_STREAM_TIMEOUT_MS` 300s | 180.3s ✅ |
| inline | `AI_CALL_TIMEOUT_MS` **60s** at all four inline V2 sites, none falling back to the stream var | 180.3s ❌ |

Inline V2 can never complete. Six runs landed within 0.2s of each other because
it is a stopwatch, not a flaky upstream.

**Four changes in `bazi.service.ts`:** `STREAM_REQUIRED` (400, V2 inline refused
at admission, ABOVE the engine call so it costs nothing) · `AI_CALL_FAILED`
(503, throw instead of charging) · `chargeable` (one expression driving BOTH the
persisted column and the deduction) · `READING_NOT_PAID` (stream endpoint
refuses a never-charged row — the no-charge change would otherwise have made it
streamable for a FREE full reading).

⚠️ **It reverses a recorded product decision.** `ai-failure-refund.spec.ts`
asserted `creditsUsed toBe(3)` with the comment "user chose to create reading".
Deliberate, stated in the commit message.

**Verified:** API 2216 passed / web 405 / turbo lint 5/5 / tsc clean.
**8 mutations attempted, 8 caught** — three guards had NO test that bit until
the mutation run exposed them.

**Impact is small and measured**, and an earlier claim in this session that
"every LIFETIME reading is broken in production" was WRONG and is retracted:
web and mobile both send `stream: true` for the four V2 types, a streaming
LIFETIME completes (15 sections, 3 credits, 180.3s), and HEALTH — the only
real-user inline caller — completes in ~10s.

**Plan Step 4 (remediate rows already charged) is N/A** — no real users, and the
only affected rows came from the probes and k6, deleted with the load-test
accounts. Do not run that query hunting for victims.

## Phase 3 — CLOSED

Report: **`load-test/L6-tuning-report.md`**. Headline: **the SPEND CAP is the
binding constraint, not the pools** — 24 slots sustain 1,080 readings/hr while
`AI_DAILY_SPEND_LIMIT_USD=50` allows 165/DAY, so the pool burns the whole daily
budget in ~9 minutes. Set the budget first, size pools second, timeout last.

Teardown complete: 103 seeded Clerk users erased through the app's own
`DELETE /api/users/me`, `tokens.json` + `seed-manifest.json` deleted,
`LOADTEST_ANTHROPIC_BASE_URL` unset, the `mock-anthropic` Railway service
DELETED, cap restored to $50, traffic confirmed on real Anthropic.

⚠️ **The breaker drill never ran.** Three readings against a $0.70 cap never
tripped it, because a failing call records no spend. Re-run it after todo #7 —
no mock needed: lower the cap to just above the day's spend and drive real
readings.

## ⚠️ Load-test facts that cost real time to learn

1. **`sessions.createSession()` is DEVELOPMENT-INSTANCE ONLY.** It underpinned
   the whole auth design, works perfectly on dev, and fails on production with
   `request_invalid_for_environment`. Replaced by the browser's own flow:
   `signInTokens.createSignInToken` → `POST {fapi}/v1/client/sign_ins?_is_native=1`
   → `sessions.getToken(sessionId, undefined, ttl)`. **`_is_native=1` is
   load-bearing** — it returns the token in the BODY instead of a cookie.
   Production FAPI host is `clerk.tianmingapp.com`.
2. **Sign-in tickets are SINGLE-USE**, and a 429'd attempt still consumes one.
   A retry must mint a fresh ticket or it fails `ticket_expired_code` forever.
3. **Clerk's Frontend API is rate limited far tighter than the Backend API** —
   a tight loop dies at ~5. Paced 250ms + backoff; 88/100 minted on the first
   good run, which is plenty.
4. **Revoking a session does NOT invalidate an already-minted token.** Measured.
   The only control is a short `--ttl`; deleting `tokens.json` plus waiting for
   expiry IS the disposal.
5. **`GET /api/users/me` 404s for a fresh Clerk user** — it does not
   auto-create. `createBirthProfile` is one of six methods calling `ensureUser`,
   so the profile POST must come FIRST.
6. **Cleanup must NOT rely on the `user.deleted` webhook.** It left 3 of 3
   profiles behind while printing "Clerk side clean". Use the app's own
   `DELETE /api/users/me`, whose 200 is a SYNCHRONOUS receipt that
   `erasePersonalData` ran (profiles, readings, chat AND the ReadingCache rows
   the run fabricates).
7. **Renaming a Railway service changes its `.railway.internal` hostname.**

## ⚠️ The switch is `LOADTEST_ANTHROPIC_BASE_URL`, and read `aiBaseUrlEffective`

`ANTHROPIC_BASE_URL` is a CONVENTIONAL name other tooling sets (Claude Code
exports it), so the app deliberately ignores it. **But the Anthropic SDK reads
it anyway**, so setting it still redirects every call while
`aiBaseUrlOverride` reports `null`.

`GET /api/admin/ops` therefore reports **`aiBaseUrlEffective`** — the resolved
`client.baseURL`, the only value that cannot lie about where traffic is going.
**Read that one at teardown, not the override.**

`node load-test/ops.mjs --api <url> --fapi clerk.tianmingapp.com` prints a
plain ARMED / NOT ARMED verdict and is the arm-time and teardown check.

## ⚠️ The mock's FAKE tokens drive REAL spend accounting

`AiSpendService` prices whatever usage it is told. At `MOCK_USAGE_SCALE=1` with
production-shaped usage the S2 breaker trips after ~165 readings, and every
request afterwards is a legitimate `AI_SPEND_CAP` 503 — which destroys L5's
`5xx<0.5%` criterion and every number after it. **Currently set to 0.01.**
Prove the breaker in its own short run instead.

## ✅ RESOLVED — the spend "under-count" was MOCK_USAGE_SCALE

`/api/admin/ops` showed **`spend today $0.013824`** after readings that cost
**$0.303624** each on real Anthropic. Flagged here as a possible ledger bug.

It is not. `MOCK_USAGE_SCALE=0.01` on the mock service scales the fabricated
usage by 100x, and that setting is documented in the section directly above:

    0.013824 / 0.01 = $1.3824 unscaled = 4.55 readings at $0.303624

which is exactly the handful that had run. **The ledger is correct.** Do not
compare a mock-armed `dayUsd` against real per-reading prices without dividing
by the scale first — the two numbers are in different units.

⚠️ L6 sizes pools from spend, so L6 must use REAL measured spend (mock
disarmed), not anything recorded while `MOCK_USAGE_SCALE` is in effect.

## ⚠️ TEARDOWN — do this even if Phase 3 is abandoned

1. `node load-test/seed-users.mjs --cleanup --fapi clerk.tianmingapp.com --api <url>`
   — 100 seeded users are REAL production Clerk users counting toward MAU, and
   the run leaves fabricated readings CACHED BY BIRTH-DATA HASH.
2. `rm load-test/tokens.json` — live bearer tokens; revocation cannot recall them.
3. **Unset `LOADTEST_ANTHROPIC_BASE_URL` BEFORE deleting the mock service.**
   Reversed, every reading fails looking exactly like an Anthropic outage.
4. Restore `ANTHROPIC_API_KEY` if it was swapped for a dummy.
5. Confirm with `ops.mjs`: 🟢 NOT ARMED and `aiBaseUrlEffective` on
   `api.anthropic.com`.

## Test suites (measured 2026-08-30)

`api 2210 passed / 5 skipped` · `web 405 passed` · `engine 3180 passed / 2
skipped / 5 xfailed` · api+web tsc clean · `turbo run lint` 5/5 · both CI
guards pass.

> When asked to "check the todo list", read **`## ✅ THE TODO LIST`** below.
> It is the canonical list of what is left before launch. Everything else in
> this file is history or evidence.

## Where things stand

The product is LIVE at `https://tianmingapp.com`. **Phase 2B (multi-instance
correctness, M1–M10) and Phase 2C (observability, Ob1–Ob3) are both finished,
merged, and verified in production with real traffic.**

`origin/main` is at `8a88eea` (merge of PR #66). Nothing is unpushed. The work
branch `claude/m10-web-calc-routes` is level with main.

**Phase 2C is verified live, not merely deployed:** a real LIFETIME reading was
generated in production on 2026-08-28 and every layer was observed —
`AI-CALL` lines in the API log, pool occupancy and the Anthropic rate-limit
gauge moving in `/api/admin/ops`, and `Sentry initialised for bazi-engine
(traces=0.20)` in the engine log (twice — once per worker).

## Shipped this session (9 commits, all green through CI)

| commit | what |
|---|---|
| `3a54478` | why TRUST_PROXY_HOPS is 2 + Railway discards client XFF *(unpushed)* |
| `6a9104a` | **M3** engine off the event loop + 2 workers |
| `a06c569` | quiet logger — Nest's 140-line route inventory suppressed |
| `579978a` | 12 code-review findings fixed |
| `658548b` | **M8** AI ceiling divided across replicas |
| `39729a3` | **M2** bounded Prisma pool |
| `1a1e141` | **M6** graceful shutdown |
| `c77d444` | **B3-b** closed + `/.well-known` unlocked |
| `a8af56b` | launch-day lessons |

## Production configuration — VERIFIED, not assumed

| setting | value | how it was verified |
|---|---|---|
| `ENGINE_REQUIRE_KEY` | `1` (enforce) | rollup line `"mode": "enforce"`, zero rejections |
| `REPLICA_COUNT` | `2` | owner-confirmed; matches 2 boots in the log |
| Railway replicas | 2 | two full boots 1s apart, both PID 1 |
| `DATABASE_CONNECTION_LIMIT` | 10 (default) | boot log `Prisma pool — connection_limit=10 pool_timeout=20` |
| `TRUST_PROXY_HOPS` | `2` | 25 forged-XFF requests → 20×201 then 429 |
| `WEB_CONCURRENCY` | 2 (Dockerfile default) | measured 36.6→6.5ms on /health under load |
| Google sign-in | live | signed in end-to-end in a real browser |
| Sign-in pages | our own, not Clerk's portal | `sign_in_url = https://tianmingapp.com/sign-in` |

## M6 is verified in production

```
SIGTERM received — draining (0 active stream(s)); readiness now reports 503
Drain complete in 3505ms — closing server
```

Appeared **twice** (both replicas), at 3505ms and 3503ms — exactly the predicted
3000ms LB delay + 500ms settle with both stream waits skipped. The full chain
works: Dockerfile `exec` → SIGTERM reaches Node → drain → `app.close()` returns.

## Test suites (measured 2026-08-28)

`api 2196 passed / 5 skipped (119 suites)` · `web 405 passed` · `engine 3180
passed / 2 skipped / 5 xfailed` · api+web tsc clean · `turbo run lint` 5/5 ·
both CI guards pass.

## ✅ THE TODO LIST

**This is the canonical "what is left" list.** Ordered by what should happen
next, not by size. Update it in place as items land.

### Blocking launch

1. ✅ **Phase 3 — load test. DONE and TORN DOWN.** Report:
   **`load-test/L6-tuning-report.md`**. Nothing left running.
   - ⚠️ **Its headline reorders the tuning work:** the binding constraint is the
     SPEND CAP (todo #7), not the pools. 24 slots sustain 1,080 readings/hr;
     $50/day allows 165. Budget first, pools second, timeout last.
   - ⚠️ **The breaker drill never ran** — a failing call records no spend, so a
     $0.70 cap never tripped. Re-run with todo #7; no mock needed.

2. ✅ **A paid reading could be charged and delivered empty — FIXED
   (`cc02da5`, unpushed).** Plan:
   `~/.claude/plans/fix-charged-empty-reading.md`. Full detail in §0.
   - ⚠️ **The earlier "EVERY LIFETIME reading fails in production" framing here
     was WRONG.** It was measured on the non-streaming path only. Streaming —
     what web and mobile actually use — completes fine (verified: 15 sections,
     3 credits, 180.3s against real Anthropic).
   - Root cause: inline `AI_CALL_TIMEOUT_MS` 60s vs a measured 180.3s need,
     while streaming gets 300s. Inline V2 could never complete.
   - **Remaining: nothing.** Plan Step 4 (remediate charged rows) is N/A — no
     real users, and the only affected rows died with the load-test accounts.

21. ✅ **FIXED 2026-09-02 (unpushed) — a self-refusal on the STREAMING path
    charged 3 credits and delivered nothing.** Three controls: pre-flight above
    the charge, refund backstop in `_setupStream`'s catch, and a recovery branch
    in the web client for paid-empty rows with no refusal behind them (that last
    one is what made the loss PERMANENT — a history click runs
    `loadSavedReading`, which only rendered what it found). 28 API + 9 web tests,
    every guard mutation-verified. Invariants in CLAUDE.md § "A refusal WE issue".
    ⚠️ Residual: the backstop refunds during stream SETUP, before any SSE event,
    so the client's existing refunded-banner (`onFinal`) does not fire — credits
    return silently and only 已退款 in history shows it. Rare (race window only).
    (Was:) Found 2026-09-02 by the #7 breaker drill — the drill's own
    refusal is the reproduction. Sibling of item 2 (`cc02da5`), which fixed
    *AI failed → charged*; this is *we deliberately refused → charged*.
    - `createReading` (`apps/api/src/bazi/bazi.service.ts`) branches
      `if (cachedInterpretation) … else if (!isStreamingRequest) …`. A streaming
      request with no cache takes **neither** branch, so the create-path
      `assertUnderCap('reading:create')` at `:442` — which sits INSIDE the
      inline branch — never runs.
    - It then charges unconditionally: `chargeable = !fromCache &&
      (isStreamingRequest || !!aiInterpretation)` → true → `deductCredits`, and
      returns `streamReady: true`. `_setupStream` refuses afterwards at
      `assertUnderCap('reading:stream')` (~`:1049`) and its catch does
      `releaseStreamSlot(); throw err;` — **no refund**, and the controller has
      none either.
    - **Not only the spend cap.** The stream-slot acquisition (`AI_BUSY`,
      ~`:1010`) and `quota.consume` (~`:1050`) are also downstream of the
      charge. All three self-refusals charge-then-refuse.
    - Live on `origin/main` (`} else if (!isStreamingRequest) {` at `:378`).
    - ⚠️ It fires **exactly when the cap does its job** — under budget stress,
      when a refusal is most likely and least excusable. The user-facing string
      even promises 「已生成的內容仍可查看」 while nothing was generated.
    - Two defensible fixes; the SECOND is the one that matches the codebase's
      stated invariant ("the charge must follow the content"):
      (a) hoist a cap/capacity/quota pre-flight above the charge in
          `createReading` for the streaming path — cheap, but it duplicates the
          checks and can still race;
      (b) refund in `_setupStream`'s catch when `isSelfRefusal(err)` — mirrors
          the inline path's `if (isSelfRefusal(err)) throw err;` at `:499` and
          cannot drift out of sync with where the refusal is raised.
      ⚠️ Whichever is chosen, **mutation-test it**: delete the refund and prove
      a test goes red. And check the refund does not double-fire with the
      degraded/refund path already in `_setupStream`.
    - Verified during the drill: a **cached** reading correctly bypasses all of
      this — `_setupStream` returns at `if (reading.aiInterpretation)` before
      reaching the cap. Only a *fresh* chart is affected.

22. ✅ **FIXED 2026-09-02 (unpushed) — a refunded reading showed `-3 額度` in
    歷史分析記錄.** `refundedAt` now flows through all three `getReadingHistory`
    branches (both comparison ones RE-MAP, so the select alone was not enough)
    to a 已退款 badge, checked BEFORE the 未解鎖 branch. `creditsUsed` untouched.
    (Was:) Found
    2026-09-02 by the operator asking whether a #21 refund would be visible
    there. **Live today and independent of #21** — `ai.service.ts:1650` already
    refunds on total AI failure, so refunded rows exist now and every one of
    them claims the user paid.
    - `refundReadingCredit` (`apps/api/src/credits/credits.service.ts:71`) sets
      `refundedAt` + `failedReason`, increments `User.credits`, and writes a
      `+amount` `CreditLedger` row — but **deliberately leaves `creditsUsed`
      intact**, because that field is both the refund amount and the
      double-refund guard (`creditsUsed: { gt: 0 }`). Do NOT "fix" this by
      zeroing it; the guard and the amount both depend on it.
    - The history row's whole predicate is `creditsUsed === 0` → 免費, else
      `-{creditsUsed} 額度` (`apps/web/app/dashboard/readings/page.tsx:194,223`),
      and **`ReadingHistoryItem` has no `refundedAt` field**
      (`apps/web/app/lib/readings-api.ts`) — the page cannot know.
    - Fix: carry `refundedAt` through `UsersService.getReadingHistory` →
      `ReadingHistoryItem` → a **已退款** badge. Leave `creditsUsed` alone.
    - ⚠️ Same class as `eb68c81` (re-pricing history from the list price), which
      was reverted for exactly this reason: the page is a RECEIPT and must show
      what happened, not what the price was. See CLAUDE.md § "The history page
      shows what was CHARGED".
    - ⚠️ Comparisons take the other branch (`isCompUnpaid` / `compCost`) and need
      the same treatment — `refundComparisonCredit` also clears `paidAt`, so a
      refunded comparison currently renders as 未解鎖 rather than 已退款.

3. **🔴 HEALTH readings deliver LIFETIME content — a customer buys the wrong
   product.** Found 2026-08-30 while verifying the load-test mock; fix in its
   own session, do not fold it into Phase 3.
   - `apps/api/src/bazi/bazi.service.ts` ~:910 (`_setupStream`, "Delegate to
     correct V2 streamer") switches on CAREER / ANNUAL / LOVE and sends
     everything else to `default: streamLifetimeV2`. **HEALTH has no case, and
     no `streamHealthV2` exists** — the only V2 streamers are Lifetime, Career,
     Annual, Love, CompatibilityRomance.
   - HEALTH is fully sellable: `READING_TYPE_META.health` (先天健康分析,
     2 credits, no hidden flag; `apps/web/app/page.tsx` renders every entry),
     `VALID_TYPES` in `apps/web/app/reading/[type]/page.tsx`, and
     `BAZI_CREATABLE_READING_TYPES` in the create DTO.
   - Evidence on production: reading `ab232801-c14b-40fd-878d-34c9410e93e1`
     has `readingType: HEALTH`, `creditsUsed: 2`, and
     `failedReason: ai-failed-LIFETIME-call1=0/8-call2=0/7` — LIFETIME's 8+7
     section shape, not HEALTH's 4. (It failed for an unrelated load-test
     reason; the LIFETIME label is the finding.)
   - A V1 HEALTH prompt exists (`prompts.ts:738`, keys at `:787` —
     `constitution, organ_analysis, health_risks, wellness_advice`), so the
     content spec is written but no V2 two-call pipeline was ever built.
   - Two defensible fixes; **assess, don't assume**: build `streamHealthV2` on
     the `streamLoveV2` pattern (needs a V2 prompt pair + a
     `PRE_ANALYSIS_VERSIONS` entry), OR withdraw HEALTH from all three
     allowlists if it was never meant to ship. Either way **check production
     for real paid HEALTH rows first** — load-test users are
     `loadtest+NNN@tianmingapp.com`.
   - ⚠️ Whichever is chosen, make that `default:` **throw**. Silently generating
     the wrong reading type is what let this ship, and it is the same shape as
     the `generic_section` mock bug: a plausible answer where an error belonged.

4. **Stripe is in TEST mode.** Live keys, live webhook + signing secret,
   re-verify `WEB_ORIGINS`. Blocks real revenue and waits on other people
   (Paid Apps agreement, banking, tax) — start it in PARALLEL, not after.
5. 🟡 **Phase 4 launch gate — the WRITABLE half is done 2026-09-02 (unpushed);
   the rest needs a console.**
   - ✅ **`docs/ops/incident-runbook.md`** — per-alert response, grounded in real
     field names. ⚠️ Leads with "check `alerting` first": with no SENTRY_DSN every
     spend alert is a silent no-op.
   - ✅ **`docs/ops/backups-and-dr.md`** — a GAP ANALYSIS. Railway backup settings
     cannot be established from the repo, so they are marked UNVERIFIED. Highest
     -value open item: **perform ONE restore.** An untested backup is a hypothesis.
   - ✅ Chaos-drill table, with the two already run (spend breaker, deploy drain)
     and what each found. The unrun one that matters most is **Redis down** — it
     is the only drill that exercises the fail-OPEN path.
   - 🟡 **Owner-only, cannot be done from the repo:**
     - ✅ **Anthropic console spend limit lowered $200,000 → $1,500** (2026-09-19).
       Chosen to sit just above the app's own $900/month + $50/day cap, so it is a
       backstop for the app's cap failing — not a second budget.
     - ⬜ **NEXT SESSION — Railway Postgres backups + DR.** Owner confirmed
       2026-09-19 that **no backup work has been done yet**, so treat
       `docs/ops/backups-and-dr.md` as describing an ABSENT posture, not a
       partial one. Steps: confirm a schedule + retention exist, then **restore
       ONE snapshot into a throwaway service** (never over the live database),
       verify the tables have rows, record RTO, delete the temp service.
       Highest-value open item in the gate — an untested backup is a hypothesis.
     - ⬜ Raise auto-reload only after S2 is verified.
   - ⚠️ **Retire prod-as-test is an EVENT, not a date — the first real user.**
     Documented in the DR doc.
   - ⚠️ Size the cap AFTER re-measuring per-reading cost: the $0.312474 figure
     predates the #20 fix and is a FLOOR.
   (Was: chaos drills, backups/DR, incident runbook, and
   the ⭐ items: lower the self-imposed Anthropic spend limit from $200,000 to a
   deliberate number, raise auto-reload only with S2 verified, and retire the
   prod-as-test-environment rule.

### Cost / quality, not blocking

6. **⭐ Prompt caching on the reading paths — MEASURED, NOT IMPLEMENTED.**
   Deferred deliberately on 2026-08-28; see
   **`## 📌 DEFERRED FINDING — prompt caching`** below for the full measurement,
   the economics, and the trap that makes a naive implementation wrong.
   Short version: **71% of every reading's input is a byte-identical static
   system prompt that is not cached.** ~10% saving guaranteed, up to ~28% under
   traffic. Requires making the spend price table TTL-aware FIRST.

7. ✅ **`AI_DAILY_SPEND_LIMIT_USD` set + breaker drill RUN — 2026-09-02.**
   Live values: **daily $50, monthly $900**. Both alert events proven end to
   end against production (Sentry rule + email): `ai.spend.threshold_80` fired
   at 90.7% of a temporarily-lowered $0.35 cap, and `ai.spend.cap_tripped`
   fired on the next reading, which was correctly refused with
   「系統今日的 AI 用量已達上限」.
   - **True per-reading cost re-measured: $0.312474** (call1 $0.130755 +
     call2 $0.181719), within 2.9% of the $0.303624 measured 2026-08-28. So
     $50/day ≈ 160 readings — still the binding constraint per L6 rec 1
     (pools sustain 1,080/hr). Revisit after item 6; caching changes the
     per-reading cost the budget is derived from.
   - ⚠️ **Drill method, for whoever repeats it:** lower the cap, don't buy more
     readings. And do NOT pick a cap below one reading's cost — `maybeWarn`
     returns early when `total >= limit`, so a $0.20 cap skips `threshold_80`
     entirely and only `cap_tripped` fires. $0.35 (≈ 1.1 readings) exercises
     both.
   - ⚠️ **The drill exposed todo #21** — the refusal it produced charged 3
     credits and delivered nothing. That is the drill's most valuable output;
     do not close #7 as "clean".
   - ⚠️ Restore the cap after any future drill. Readings stay refused until
     you do.

8. ✅ **FIXED 2026-09-02 (unpushed) — for the STREAMING path.**
   ⚠️ **Re-scope before believing the old text below.** The NON-streaming path
   was already fixed in `a56dcd9`, and that is where the measured evidence came
   from (26 calls at exactly 60.000s = a 25% cut at that budget). The streaming
   path still armed its abort before taking the S1 slot, but at a 300s budget the
   worst case is ~5% — real and bounded, not the failed-readings story below.
   Fix: `streamProvider` gained an `onSlotAcquired` hook invoked once the slot is
   held; all five streaming sites arm there. Safe because queue wait is separately
   bounded (`QUEUE_TIMEOUT_MS.reading = 15s` → AI_BUSY), so this converts budget
   erosion into an honest retryable refusal rather than an unbounded hang.
   ⚠️ Its source sweep found a compat **Call 3** that both this and #19 had
   missed — the reveal makes three calls and a two-entry list looked complete.
   (Was:)
   `AI_CALL_TIMEOUT_MS` (60000) is measured from when the call is ISSUED, which
   includes waiting for an S1 pool slot. Under load that turns backpressure into
   FAILED PAID READINGS plus refunds, instead of a fast `AI_BUSY` the client can
   retry. Measured in S2: 26 calls hit exactly 60.000s and became
   `AI_CALL_FAILED` 503s. **Do not just raise the number** — bound queue wait
   separately, or start the clock after slot acquisition.

### Small debts

20. ✅ **FIXED 2026-09-02 (unpushed).** Counts `content_block_delta` characters
   and estimates output tokens when `message_delta` never arrived, flagged as an
   estimate end to end (`outEst` on the AI-CALL line). `max(observed, estimate)`,
   rounds up (under-counting is the dangerous direction for a spend cap).
   Applied at all FIVE metering sites — there were two parallel usage mechanisms,
   both carrying the bug.
   ⚠️ **Knock-on for #7: re-measure the per-reading cost.** The $0.312474 figure
   was taken while aborted streams reported zero output; treat it as a FLOOR.
   (Was:) Measured in production 2026-09-02 from a real `AI-CALL` line:

       ms:179998  inTok:22222  outTok:0  costUsd:0.066666

   22222 x $3/1M = $0.066666 exactly — the cost is INPUT ONLY. Yet that call
   produced most of 14 sections, i.e. thousands of output tokens.
   - Cause: `stream-usage.ts` takes input from `message_start` but output only
     from `message_delta`. Abort before a `message_delta` carrying usage and the
     output side is recorded as zero.
   - Anthropic bills those tokens; the Redis counter does not see them. At a
     plausible ~10k output tokens the reading truly cost ~$0.34 against $0.187
     booked — roughly a **45% under-count**.
   - ⚠️ **The breaker is blindest exactly when spend spikes.** Timeouts and
     retries are the runaway case, and they are the case that under-reports.
   - ⚠️ It also distorts #7: a daily cap sized on measured spend lets the real
     Anthropic bill exceed the cap's intent. Re-measure per-reading cost AFTER
     #18 is fixed (a completed stream reports its output normally), and treat
     the pre-#18 $0.303624 as a floor rather than the number.
   - Possible fix: on abort, estimate output from the bytes already streamed, or
     record a explicit `outputTokensUnknown` marker so the gap is visible instead
     of silently zero. Either way the ledger should not report a confident $0.

18. ✅ **FIXED 2026-09-02 — `AI_STREAM_TIMEOUT_MS=300000` is now set on the
    Railway API service; a re-run produced a complete 15/15 reading.** (Was:
    `AI_STREAM_TIMEOUT_MS` is NOT set in production — every LIFETIME
   reading is arriving degraded.** Observed 2026-09-02: a real reading returned
   「命理分析未完整 / 已生成 14 / 15 個段落」.
   - Unset, the V2 stream path falls back to **180000** (`ai.service.ts` ~:276).
     The measured need for a LIFETIME reading is **180.3s**. It times out by
     three tenths of a second, truncating the tail of Call 2 — which is why it
     is 14/15 and not 9/15.
   - CLAUDE.md already records the fix ("`AI_STREAM_TIMEOUT_MS=300000` in
     `apps/api/.env` — gitignored, **set in prod env too**"). The prod half was
     evidently never done, and it is not in the worktree `.env` either.
   - **FIX: set `AI_STREAM_TIMEOUT_MS=300000` on Railway `bazi-app`.** This is a
     customer-facing defect independent of #7 — paying customers receive
     incomplete readings today.

19. ✅ **FIXED 2026-09-02 (unpushed).** `AiCallAttribution` carries `readingId` +
   `readingType`; `_streamProviderInner` writes the row via a new shared
   `persistUsageRow`. ⚠️ NOT via `logUsage` — that also calls `record()`, which
   would double-count against the daily cap.
   (Was:)
   `_executeStreamV2Common` never calls `logUsage`, so a streamed reading writes
   NO `AIUsageLog` row — only the Redis spend counter moves. The dashboard
   therefore omits the most expensive path in the app entirely.
   - Combined with #17 (1,383 mock rows retained), that page currently reports
     close to the inverse of reality: fabricated rows present, real streamed
     readings absent.
   - Trustworthy sources are the Redis counter (`/api/admin/ops` →
     `spend.dayUsd`) and the `AI-CALL` log lines. Fixing this means calling
     `logUsage` from the streaming path, or rebuilding the page on the same data
     Ob1 emits.

17. ✅ **DONE 2026-09-02 — 1,378 of 1,383 rows purged from production.**
   ⚠️ **The original diagnosis in this entry was WRONG and is corrected below.**
   `SetNull` never fired: `deleteAccount` ANONYMISES the User row
   (`clerkUserId` → `deleted_user_*`) instead of deleting it, so the FK still
   resolves and `user_id IS NULL` matched **0 of 1,383**. The manifest window was
   wrong too — its `createdAt` is the SEED time, while the rows spanned five days
   before it. The tool now scopes by OWNER (anonymised + no profiles + no
   readings) and gained a read-only `--inspect`.
   ⚠️ 5 rows deliberately remain: 4 belong to a REAL account (genuine compat
   calls at ~14k input) and 1 to a load-test account whose deletion failed.
   ⚠️ The seed manifest recorded only 1 user for a 103-account run — do not trust
   it as the list of load-test accounts; query the DB.
   (Superseded detail:) `load-test/purge-usage-log.mjs` — dry-run by default,
   never unscoped, requires `--target <db-host>` to execute, and prints the token
   shape as evidence first. Retention decision (KEEP on account deletion; it is
   anonymous cost history) recorded in docs/security/data-inventory-and-retention.md.
   Run: `node load-test/purge-usage-log.mjs` then add `--execute --target …`.
   (Was: Found 2026-09-02
   while establishing the per-reading cost for #7.
   - `AIUsageLog.userId` and `.readingId` are BOTH `onDelete: SetNull`, and
     `erasePersonalData` never touches that table. Deleting the 103 load-test
     accounts nulled the pointers and **left 1,383 usage rows in production**.
   - The dashboard therefore reads **$0.04 total / $0.0000 avg per reading** over
     30 days. The tell is the token columns: "Bazi Lifetime, 449 requests, 208
     avg input tokens" — a real LIFETIME call is ~22,000. Those are
     `MOCK_USAGE_SCALE=0.01` fabrications. Arithmetic check: 244k in + 104k out
     at Sonnet rates is ~$2.30, not $0.0434.
   - ⚠️ **The real per-reading figure is still $0.303624**, from `AI-CALL` lines
     that reconciled with the Redis counter — NOT from this table. Do not let
     the dashboard talk anyone into a lower budget.
   - Cleanup is a scoped delete of the mock rows (they are identifiable by
     absurd token counts and/or `created_at` inside the load-test window, and
     all have `user_id IS NULL`). ⚠️ Real rows also go NULL when a genuine user
     deletes their account, so `user_id IS NULL` ALONE is not a safe predicate —
     scope by time window too.
   - Also worth deciding: whether account deletion SHOULD delete these. They
     carry no birth data (tokens, cost, latency, model) so retention is
     defensible for billing history — but then teardown of a load test needs its
     own cleanup step, which it did not have.



9. ✅ **Stale Playwright specs addressed 2026-09-01.** CLAUDE.md § "Defense in
   depth can hide a layer that is entirely gone".
   - ⚠️ The item said "8 specs". It was **17 of 21 files** — full lockdown
     removed anonymous access, so almost every spec ran against the sign-in
     page and failed with things like «expected 八字命理», which sends a reader
     hunting for a UI regression instead of telling them the page needs an
     account.
   - **New `e2e/signed-out-lockdown.spec.ts`, 22 tests, all passing against a
     live dev server.** It asserts the control that REPLACED all of it, and it
     splits the two layers deliberately — see the finding below.
   - 17 files carry a file-level `test.skip(true, reason)` with a docblock
     naming the routes they visit, why the premise is gone, and where the
     replacement coverage lives. Skipped rather than deleted: the pages still
     exist for signed-in users, so this is coverage awaiting an authenticated
     fixture. 4 of them carry a SECOND cause (ZWDS), flagged so nobody
     un-skips and expects green.
   - `api-health.spec.ts` had two assertions that `/` and `/pricing` return
     200. Removed — the lockdown spec now owns the opposite (correct) fact, and
     one owner beats two contradicting ones.
   - **MEASURED: 126 passed / 0 failed / 99 skipped.** Verified with a real
     `next dev` on :3000 and `playwright-minimal.config.ts`.
   - ⚠️ **The first pass got this wrong and the audit caught it.** It banded 17
     files by inspection ("this file visits a locked route"), which disabled
     **99 PASSING tests**. Many specs `goto('/')` only to get a browser context
     and then assert on `page.evaluate(fetch(...))` against MOCKED routes — the
     page content is irrelevant, so lockdown never affected them. `ad-rewards`
     12/12, `monthly-credits` 18/18, `subscription-checkout` 10/10,
     `admin-monetization`, `credit-purchase`, `reading-history`,
     `subscription-page` were all fully green. Corrected to: 6 file-level skips
     (nothing in them passes) + per-test skips in 5 mixed files + 7 files left
     untouched.
   - ⚠️ Measure with `--reporter=list`; `line` only persists failures, so it
     cannot tell you what passed.
   - ⚠️ **KEY FINDING, mutation-proven.** `page.goto(x)` → expect `/sign-in`
     passes if EITHER layer fires. Re-opening `/pricing` in the middleware
     allowlist left it GREEN because the client watcher still redirected — so a
     suite could report a fully removed server-side lockdown as healthy. The
     spec now asserts Layer B through `request.get()` (no JS, so only the
     server can refuse) and Layer A through `/reading/*` (deliberately
     middleware-public, so the client is the only guard). Both verified by
     mutation in both directions.
   - **NOT addressed, deliberately:** `career-reading.spec.ts` and
     `compatibility.spec.ts` — the two `__e2e_auth` cookie-bypass files. Their
     describes MIX cookie and no-cookie tests, so a file-level skip would
     disable working coverage, and per this file's own earlier measurement only
     8 of their ~23 failures are lockdown-caused (the rest is form-drift: specs
     expecting «八字合盤分析» when the title is «八字感情合盤»). That is a
     spec-rewrite project, not a lockdown cleanup.

10. **Sign in with Apple** — blocked on the Developer Program membership;
   runbook already written. A website with Google-only is fine.
11. ✅ **`/api/zwds-calculate` DELETED 2026-09-01** — not rate-limited, removed.
   It was unauthenticated, unthrottled, and ran a synchronous `iztro` calc on the
   **Next.js web server** (single-threaded event loop, also serves sign-in), so a
   flood was a whole-site outage for a product deleted in `ad106fc`. Deleting beat
   guarding: route + middleware entry + 2 call sites + the `iztro` dependency +
   6 e2e route probes, all gone. **`VALID_TYPES` untouched** — the two paid
   `ZWDS_LIFETIME` readings render from `reading.calculationData` via `?id=` and
   never used the route. Proved by a fresh `next build`: `.next/server/app/api/`
   now holds only `bazi-calculate`, `explain-element`, `og`.
   - Follow-ups it uncovered (small, NOT blocking):
     (a) the `*_lunar_date` sessionStorage **writes** at `page.tsx:~922-953` are now
         written and never read — the read-backs were dead and were removed. Ripping
         out the writes touches paid-reading refresh-resilience, so it was left.
     (b) 4 `page.route('**/api/zwds-calculate', …)` mocks remain in
         `reading-submission` / `free-reading` / `section-unlock` e2e specs. Those
         specs also mock `/api/zwds/readings`, a NestJS endpoint deleted in
         `ad106fc`, so they already target a removed product — folded into item 9.
         ⚠️ Their current pass/fail state was NOT measured.
     (c) `apps/web` imports `lunar-typescript` without declaring it (it is in the
         ROOT and `apps/mobile` package.json). Safe today — a scoped install still
         gets root deps — but it is the same shape as the `iztro` launch-day bug,
         where the crutch was a SIBLING workspace. Declare it in `apps/web`.
12. ✅ **Streamed-reading attribution FIXED 2026-09-01.** CLAUDE.md
   § "Ob1: attribution — who the call was for, and which call it was".
   - `AiCallAttribution` ({route, userId}) threaded from the five public stream
     entry points to `_streamProviderInner`. Routes are now
     `stream:{READING_TYPE}:call1|call2` and `stream:COMPATIBILITY:call1|2|3`,
     replacing `stream:CLAUDE` for all of them.
   - `userId` on the five entry points is **required** — the compiler is the
     enforcer (optional fails tsc; deleting fails at every call site, both
     verified). The estimate of "five public signatures" was right; the diff
     was mechanical and all 5 callers are in `bazi.service.ts`.
   - Bonus: the eslint ratchet moved DOWN (`ai.service.ts` no-unused-vars
     3 → 2) because `readingType` is now genuinely used rather than suppressed
     as `_readingType`. Pruned and re-pinned.
   - 10 tests; **12 mutations attempted, 12 caught** — but only after 4 turned
     out to be non-results: two didn't compile, one was a no-op, and one
     exposed a VACUOUS test (it built its own attribution objects, so it could
     not fail whatever production did). Replaced with a source-level "no two
     call sites share a route" invariant.
   - ⚠️ **The first pass tested only the pieces**: every test handed
     `_streamProviderInner` an attribution the test itself wrote, and the rest
     read literals out of the file. Nothing exercised the CHAIN. Closed in the
     audit with an end-to-end test that drives the public `streamLifetimeV2`
     and asserts what the real call sites hand to `streamProvider` — mutations
     Q1/Q2 (userId dropped at the entry point and at the helper's opts) and
     Q3b/Q4 (route reverted to the provider name, call2 reusing call1's route)
     all fail against it and would ALL have passed before.
   - Audited clean: all four `_executeStream*V2` pass `userId` into the common
     opts; compat's `userId` is the parameter with no shadowing; and the RAW id
     has exactly one path to a log — `record({userId})` → `hashUserId` — with
     no logger/Sentry call touching `attribution` (grep-verified, plus a test
     asserting the raw id appears nowhere in the emitted line).
   - Note `callProviderWithTimeout`'s failure lines (added in #14) still carry
     no userId — that method never receives one, and threading it means 11 more
     call sites on the non-streaming path, which is now refused for V2 anyway.

13. ✅ **Spend alerts PROVEN end to end 2026-09-02** by the #7 breaker drill:
   `ai.spend.threshold_80` fired at 90.7% of a lowered cap and
   `ai.spend.cap_tripped` on the next reading — both emails arrived. The third,
   `ai.spend.breaker_unavailable`, is wired the same way but has no natural
   trigger (it needs Redis unreachable) and stays unexercised.
   (Was: code done, both operator steps done, ONE hop still unproven.) CLAUDE.md § "A built alert and a delivered alert are different
   claims" and § "Sentry was armed and had never received an error".
   - ⚠️ **THREE events, not two.** The item missed
     **`ai.spend.breaker_unavailable`** — the only one that fails **OPEN**
     (Redis unreadable → the call is ALLOWED → spend capped only by the
     Anthropic account limit). The other two mean a control fired.
   - ⚠️ **Discovered en route: Sentry had NEVER received an error.**
     `AllExceptionsFilter` is `@Catch()` with no `captureException`, no
     `@SentryExceptionCaptured()`, and no `SentryModule` — it intercepted every
     exception before the SDK saw it. Only `captureMessage` got through, which
     is why the spend alerts were fine and error reporting was empty. Fixed in
     `090e3ff`, reporting from inside the existing `status >= 500` branch so
     401s (every anonymous request) do not drown it.
   - **Shipped:** `common/alerting-status.ts` (boot report + `alerting` on
     `GET /api/admin/ops`), verified at a real boot in both branches, DSN key
     absent from the log. Verdict reads `Sentry.getClient()`, NOT the env var —
     the ConfigModule write-back trap.
   - ✅ **OPERATOR 1 — `SENTRY_DSN` set** on Railway `bazi-app`, 2026-09-02.
     Sentry project **`bazi-api`** (org `brainy-entertainment-plt`), separate
     from `bazi-engine` by design — different PII profiles must not share a
     project.
   - ✅ **OPERATOR 2 — alert rule created**, and its **test notification
     arrived**. Config: WHEN `An event or issue activity is captured` · IF
     *(none — any event)* · THEN notify owner · throttle **60 min** · all envs.
     - No IF filter ON PURPOSE. Scoping to `ai.spend.` would have silenced the
       5xx reports that `090e3ff` just enabled, and this project is dedicated
       and low-traffic.
     - Throttle is load-bearing: `assertUnderCap` emits `cap_tripped` on EVERY
       refused call, so once the cap trips a busy hour is hundreds of events.
   - ⬜ **STILL UNPROVEN: the app → Sentry hop.** The test notification proves
     Sentry → email only. Verified on `origin/main`: the ONLY things that can
     create an issue today are the 3 `ai.spend.*` messages — no
     `captureException` anywhere, and breadcrumbs do not create issues. So
     nothing routine will confirm the DSN.
     **#7's drill is the confirmation**: lower `AI_DAILY_SPEND_LIMIT_USD` just
     under the day's spend, drive one reading, expect `ai.spend.threshold_80`.
     That works against production as it stands — it needs no merge.

14. ✅ **Ob1 blind spot CLOSED 2026-09-01.** Full reasoning in CLAUDE.md
   § "Ob1: a failed AI call must leave a line".
   - `record()` prices usage, so it only ran once usage existed. Three gaps:
     the non-streaming choke point emitted NOTHING on throw; the streaming one
     emitted a `$0` line indistinguishable from a cache hit; the four
     `hasUsage`-guarded sites emitted nothing on a zero-token abort.
   - Now: `AiSpendService.recordFailure()` + `outcome` (`ok`/`error`/
     `abandoned`) + `errorKind` on every line. `callProviderWithTimeout` emits
     and rethrows; `_streamProviderInner` distinguishes all three endings;
     chat + fortune ×3 emit in the `else`.
   - ⚠️ `recordFailure` deliberately does NOT satisfy the CI metering guard
     (the regex needs `record(`, not `recordFailure(`) — a file that only logs
     failures is still unmetered. Verified empirically, not assumed.
   - ⚠️ `errorKind` never carries `error.message` (prompts contain the four
     pillars), and `classifyAiError` is total.
   - 28 new/extended tests; **13 mutations attempted, 13 caught** (two first
     attempts reported `Tests: 0 total` — did not compile, so non-results, not
     passes; both redone). api 2257 / web 405 / tsc clean / turbo lint 5/5 with
     0 cached / S2 guard green.
   - ⚠️ **The first pass wired 4 streaming sites and tested NONE of them** —
     the same "untested wiring" shape this repo keeps hitting. Closed in the
     audit: chat and fortune-DAILY are now proven by EXECUTION (each spec had
     an Anthropic-throws test to hang the assertion on), and monthly/yearly by
     a countable invariant — `recordFailure` calls must equal
     `hasUsage(streamUsage)` guards per file, so a site cannot be wired half
     way or added without a failure branch. Mutations N11–N13 confirm both
     halves bite, site-specifically.
   - Audited and clean: all 4 sites verified to share ONE try/catch/finally
     (brace-depth check, not eyeballing); no path double-emits
     (`callProviderWithTimeout` is confined to `ai.service.ts`, while chat and
     fortune call the SDK directly).
   - Still open, unchanged by this: **streamed readings log `userIdHash: null`**
     (todo #12) — `callProviderWithTimeout` and `_streamProviderInner` receive
     no user id, so the failure lines inherit that gap.

15. ✅ **Generation-lock TTLs FIXED 2026-09-01 — and the audit found two MORE
   instances, one worse than the reported one.** Full reasoning in CLAUDE.md
   § "A per-call timeout is NOT how long a generation can run".
   - Root cause: `AI_MAX_TOTAL_TIME_MS` (900s) gates the START of an attempt,
     not an abort in flight, so the real bound is budget + one call timeout
     (~1200s). Three values were sized against `AI_STREAM_TIMEOUT_MS` instead:
     | value | was | now | consequence when short |
     |---|---|---|---|
     | `stream:reading:{id}` lock | 330s | 1260s | double Anthropic spend + racing writers |
     | `ai:generate:comparison:{id}` lock | 60s | 960s | same, **guaranteed** past 1 min, on a 3-credit purchase |
     | first-generation in-flight window | 360s | 1260s | **user charged a second time** mid-generation |
   - All three now derive from `AIService.getMaxStreamedGenerationMs()` /
     `getMaxCompatGenerationMs()`. 19 new tests; **10 mutations attempted, 10
     caught**; api 2235 / web 405 / tsc clean / turbo lint 5/5 with 0 cached.
   - ⚠️ **Accepted tradeoff:** a CRASHED generation (SIGKILL only — M6's drain
     covers SIGTERM, and error/complete/catch all release) now wedges a retry
     for ~21 min instead of ~6. Deliberate: a too-short TTL charges silently,
     a too-long one self-heals.
   - ⚠️ It also broke `bazi.service.reading-dedupe.spec.ts`, whose `longAgo()`
     fixture was a hardcoded `600_000` — outside the old 360s window, INSIDE
     the new one. Now derived from a mocked bound. Watch for this shape.
   - ⚠️ **The fix introduced a defect, caught by auditing the fix.** Deriving
     the TTLs put `parseInt` output on a path the hardcoded literals never
     touched: a malformed `AI_STREAM_TIMEOUT_MS` / `AI_COMPAT_V2_TIMEOUT_MS` /
     `MAX_TOTAL_AI_TIME_MS` parses to NaN, propagates through the arithmetic,
     and reaches `redis.acquireLock` as an expiry Redis rejects. On the compat
     path that lock sits AFTER `_chargeForReveal`, so ONE TYPO would charge 3
     credits and then 500 — the charged-but-empty shape from `cc02da5`, this
     time sourced from config. `AIService.safeBoundMs` now fails CLOSED to
     `AI_GENERATION_BOUND_FALLBACK_MS` (30 min) and logs at error level.
     Wide is the safe direction for a lock; a zero bound is rejected too.
   - **Remaining from the audit, NOT fixed (each needs its own reasoning):**
     (a) `reading:create:{userId}` 30s holds the inline AI call. After
         `STREAM_REQUIRED` only HEALTH/V1 runs inline there (~10s), so 30s
         usually covers it but a retry does not. Impact is now much lower
         because the corrected in-flight window catches the second create and
         returns the row free instead of charging — the two compose.
     (b) `comparison:create:{userId}` 30s — creation no longer generates AI, so
         the work inside is short. Believed fine; not measured.
     (c) **`redis.acquireLock` has no ownership token** — it stores `'1'` and
         `releaseLock` is a bare `DEL`, so a holder whose lock expired deletes
         its SUCCESSOR's lock, and safe renewal is impossible. Fixing the TTLs
         removes the trigger on these keys but not the hazard. Adding a token
         touches all 5 call sites.
     (d) `chat-stream.service.ts`'s 150s is **correct** — 90s timeout + 60s
         watchdog, no retry/fallback budget. Do not "fix" it by analogy.

16. ✅ **`Ob1Verify` profile DELETED from production 2026-09-01** (owner, via
   `/dashboard/profiles`). Verified beforehand in the schema: `BaziReading` is
   Cascade, so its attached LIFETIME reading went with it — certainty, not
   "may". `CreditLedger.readingId` is SetNull, so the ledger row SURVIVED and
   `sum(CreditLedger.amount) == User.credits` is unaffected. Deleted through
   the app (not SQL) because `deleteBirthProfile` pre-deletes
   `DailyFortuneSnapshot` rows in a transaction — a raw SQL delete would have
   orphaned them permanently (SetNull + account deletion scopes on profile ids
   that no longer exist).

23. ⬜ **`redis.acquireLock` has no ownership token — promoted from #15(c) so it
    is not lost under a ✅ item.** It stores the constant `'1'` and
    `releaseLock` is a bare `DEL`, so a holder whose lock expired deletes its
    SUCCESSOR's lock, and safe renewal is impossible. #15's TTL fix removed the
    TRIGGER (a lock that never expires while held is always released by its own
    holder) but not the HAZARD: any future shortened TTL, or a new caller that
    copies the primitive, re-arms it silently. Fix = write a random token as
    the value and release via a compare-and-delete Lua script; touches all 5
    call sites (`bazi.service` stream + comparison locks, `chat-stream`,
    fortune ×?). Do it when someone is already in that code. Not blocking.

24. ⬜ **`/api/admin/ops` → `rateLimit.*` read `null` right after a real
    streamed reading (2026-09-07).** Those are Anthropic's rate-limit headers,
    captured per PROCESS, and the API runs 2 replicas — so the ops request very
    likely hit the replica that did not serve the stream. Benign if so. Check:
    after a few more readings, hit `/api/admin/ops` several times (the LB
    spreads across replicas). If every response is still `null`, the capture
    in `anthropic-rate-limit.ts` is broken and you are blind to approaching
    Anthropic's limits until users see 429s. Five-minute check, not blocking.

25. ⬜ **Mobile's Sentry has NO scrubber — a trap armed by M7, not a leak today.**
    Found 2026-09-26 while checking whether the security work covered mobile.
    `apps/mobile/src/app/_layout.tsx:30` is the whole config:
    `Sentry.init({ dsn: env.sentryDsn, tracesSampleRate: 0.1 })`. No
    `beforeSend`, no `beforeSendTransaction`, no `sendDefaultPii: false` — the
    only one of FOUR surfaces without them (api `main.ts:23`, web
    `sentry.client.config.ts:12`, engine `observability.py:343`).
    - **Inert right now**, and that is the danger: the init is gated
      `if (env.sentryDsn)` and `EXPO_PUBLIC_SENTRY_DSN` is EMPTY in
      `.env.example`. The code comment says "until wired at M7". So it arms at
      the exact moment someone is doing store-launch wiring and is least likely
      to be thinking about PII scrubbing — and nothing fails when it does.
    - **Why mobile is the worst surface to leave unscrubbed**: it RENDERS the
      chart, so the four pillars sit in component state and props. Per the
      domain PII rule they are a reversible encoding of a birth datetime.
      `tracesSampleRate: 0.1` also means transactions are on, which is exactly
      why the other three scrub transactions too ("transactions carry request
      context").
    - ⚠️ NOT yet established whether a chart payload can actually REACH Sentry
      from RN (depends on breadcrumbs + error-boundary capture). Trace that
      before sizing the work — the certain part is that the defense present
      everywhere else is absent.
    - Fix: a 4th copy at `apps/mobile/src/lib/sentry-scrub.ts` (mobile cannot
      import from `apps/api` or `apps/web`; whether `@repo/shared` is usable
      from RN is an open question — the off-limits rule is about the NestJS
      runtime, so it may be fine here and would collapse two copies into one).
      Then **extend `apps/api/test/sentry-scrub-parity.spec.ts`**, which today
      compares api ↔ web only, to cover the mobile copy — otherwise the 4th
      copy drifts the way the 3rd nearly did.
    - While in there: **PostHog on mobile is also unscrubbed**
      (`PostHogProvider` at `_layout.tsx:80`). Check what it auto-captures.
    - Checked and CORRECT on mobile, do not re-audit: Clerk tokens in
      `expo-secure-store`; every `EXPO_PUBLIC_*` is publishable-by-design
      (no secret in the binary); a global single-flight 401 handler exists
      (`src/lib/api.ts` + `_layout.tsx:87`).

---

## 📌 DEFERRED FINDING — prompt caching on the reading paths

Measured 2026-08-28 from the first production `AI-CALL` lines. **Not
implemented.** Recorded here so a future session does not have to rediscover it.

### The measurement

`buildLifetimeV2Prompts` builds ONE `systemPrompt` used by BOTH V2 calls, from
`buildLifetimeSystemPrompt() + LIFETIME_V2_PROMPTS.systemAddition +
GUIDE_STYLE_RULES`. **Nothing chart-specific is interpolated into it**, so it is
byte-identical across both calls AND across every LIFETIME reading for every
user.

```
system prompt      15,527 chars  →  15,756 tokens   (67% CJK)
  └ GUIDE_STYLE_RULES  11,071 chars — 71% of the system prompt

Call 1   22,587 in  =  15,756 shared (70%)  +  6,831 chart-specific
Call 2   21,516 in  =  15,756 shared (73%)  +  5,760 chart-specific
```

Both calls send `system: <string>` with **no `cache_control`**
(`ai.service.ts::streamClaude`, and the same shape in `callClaude`).

### The economics (Sonnet: $3/1M in · $3.75/1M 5-min write · $0.30/1M read)

| | cost of the shared 15,756 tokens |
|---|---|
| today, per reading | 2 × 15,756 × $3 = **$0.0945** |
| with a 5-min cache | 15,756 × $3.75 + 15,756 × $0.30 = **$0.0638** |
| **saving** | **$0.0307 — ~10% of a $0.30 reading, guaranteed** |
| a 2nd reading inside the window | 2 × 15,756 × $0.30 = $0.0095 → **~28% saving** |

### ⚠️ Two traps

1. **Use the 5-MINUTE TTL, not 1-hour.** The 1h write premium is 2× rather than
   1.25×, so for an ISOLATED reading it costs $0.0993 vs $0.0945 uncached —
   *worse than not caching*. It only pays above ~2 readings/hour. Chat correctly
   uses 1h because its turns repeat; readings are one-shot. Same feature,
   opposite parameter, for a real reason.
2. **`AiSpendService`'s price table has ONE hardcoded cache-write rate, and it
   is the 1-hour one** (its own ⚠️ comment says so, because chat sends
   `ttl: '1h'`). Point readings at a 5-min TTL without changing that and every
   cache write is billed at 2× when it costs 1.25× — **spend over-reported by
   60% on that component**, which would corrupt the very numbers used to verify
   the saving. Make the table TTL-aware FIRST.

### Why it was deferred

It modifies the spend ceiling — the only control that stops runaway AI spend —
so it deserves a session where that is the main event and gets its own audit.
At current volume ($3.32 for the month) the saving is cents; it matters at
launch scale, which Phase 3 establishes.

### Suggested order when picked up

TTL-aware pricing → `cache_control` on the reading paths → verify a second
reading shows non-zero `cacheReadTok` in its `AI-CALL` line and that the spend
arithmetic still reconciles. No prompt TEXT changes, so **no cache-version bump
and no Redis flush** — the reading cache key is the birth-data hash. Measure
CAREER / LOVE / ANNUAL / COMPAT too; they almost certainly share the structure.

## Methodology that kept paying — do not drop it

**Mutation testing.** Every control this session was neutered to prove its test
failed: 9 mutations on the audit fixes, 4 on the logger, 2 on the M3 guard, 3 on
the governor, 4 on the pool builder. All caught. A green suite you wrote proves
nothing until you have seen it go red.

**"Well-covered helper behind untested wiring" recurred THREE more times** and is
now the single most reliable bug shape in this repo:
- `buildPooledDatabaseUrl` had 11 tests; nothing proved Prisma honoured the URL
  (proved by timing 12 concurrent queries at limits 3/6/12).
- `ShutdownService` had 12 tests; none of the 6 registration sites was covered.
- `QuietBootstrapLogger` asserted context strings it hardcoded; a real Nest boot
  was needed to prove they match what Nest emits.

**Measuring beat reasoning, every time.** `sh -c "a && node"` swallowing SIGTERM,
Nest running `onModuleDestroy` BEFORE `beforeApplicationShutdown`, and Railway
discarding client `X-Forwarded-For` were all discovered by running something, and
all three contradicted a confident prior.

**Fixes introduce defects.** The M6 audit found that the drain's own post-abort
window re-created, in miniature, the disconnected-pool bug the commit existed to
fix. Audit the fix, not just the original code.

---

# Session Handoff — Launch Security + Scalability, Phase 1

**Updated 2026-08-23. Read §0 first — it supersedes every dated block below.**

⚠️ **ACTIVE BRANCH IS NOW `claude/m10-web-calc-routes`** (off `9ce1ba6`), NOT
`claude/bazi-scalability-security-e4ff78`, which is merged and finished.

> ⚠️ **SHAs in this file were rewritten on 2026-08-21.** The security branch was
> rebased onto main, which rewrote every commit id; the originals are gone. The
> ids below are the post-rebase ones now reachable on `main`. Two exceptions,
> both deliberate: `32c5d00` (the pure-deps commit SKIPPED during the rebase) and
> `37e1bc2` (PR #63's fix) never reached main under those ids — #63 was
> **squash**-merged as `1261c35`, which is what actually carries their content.

Plan (authoritative, v5.5): `~/.claude/plans/launch-scalability-security-plan.md`
Findings + reasoning (in repo): `docs/security/audit-2026-08.md` (659 lines) ·
`docs/security/data-inventory-and-retention.md` · `docs/security/dependency-and-secret-scan.md`
Branch: `claude/bazi-scalability-security-e4ff78` · worktree
`/Users/roger/Documents/Python/Bazi_Plotting/.claude/worktrees/elastic-pascal-cc5187`

---

## 0. STATE 2026-08-26 — READ THIS FIRST (supersedes everything below)

### THE PRODUCT IS LIVE ON ITS OWN DOMAIN

**`https://tianmingapp.com` serves the real app.** Until this session the
platform was backend-only and the domain resolved to nothing. Everything below
was done and verified in production, not staged.

`origin/main` = `31e74a4`. Nothing unpushed that matters (the local branch is
4 ahead only because of the pre-merge tip; the merge carried them).

| Commit | |
|---|---|
| `5094cf8` | merge of [PR #65](https://github.com/taufulou/bazi-app/pull/65) — M9 web deploy + M7 readiness + M10 + M1 + B3-b tooling (18 commits) |
| `f9bfb18` | `iztro` moved to the workspace that imports it |
| `915183a` | CSP now allows the PRODUCTION Clerk host |
| `31e74a4` | first-profile-primary + the 子時 boundary paywall |

### Owner-side production config, all NEW this session

| | |
|---|---|
| Railway **web service** | created; Dockerfile builder, `docker/Dockerfile.web`, **port 8080** (Railway injects `PORT`, overriding the image's 3000) |
| DNS | Namecheap **ALIAS** on `@` → Railway; TLS issued; `tianmingapp.com` live |
| `WEB_ORIGINS` / `CORS_ORIGINS` | `https://tianmingapp.com` on the **API** service |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | set (were ABSENT — see below) |
| `CHAT_ENABLED_READING_TYPES` | all six types (was unset ⇒ only LIFETIME worked) |
| `CLERK_AUTHORIZED_PARTIES` | `https://tianmingapp.com`, BOTH services — verified sign-in still works |
| API healthcheck path | `/health/ready` |
| Owner's prod account | tier **BASIC** (test-mode subscription), ~25 credits, 3 birth profiles |

### SIX bugs, every one found by USING the deployed app

None were reachable by CI, and none by reading code. This is the session's
main lesson: **a green pipeline says nothing about whether the thing is
configured to run.**

1. **`iztro` declared in `apps/api`, imported by `apps/web`.** Worked via npm
   hoisting; the web Dockerfile's scoped `npm ci` removed the crutch and the
   image would not build. CI installs ALL workspaces so it can never catch this
   class. Fixed by moving the dep; verified by reproducing the Dockerfile's exact
   `npm ci` in a scratch dir (absent before, present after).
2. **CSP allowed `*.clerk.accounts.dev` but not the production Clerk host.**
   Sign-in would have been a blank box in every browser while every server-side
   check returned 200 — a CSP only bites client-side. Now DERIVED from the
   publishable key (which base64-encodes the host), so the two cannot drift.
3. **Stripe entirely unconfigured in production.** Keys existed only in the
   gitignored `apps/api/.env`. `stripe.service.ts` falls back to the literal
   `'sk_test_placeholder'`, so the API boots with one log warning and 500s the
   moment anyone pays.
4. **A user's first birth profile was never primary.** Fortune resolves by
   `isPrimary`; the form never surfaces it; `|| false` did the rest. Every new
   account entered its birth data and was told 「找不到出生資料」 one screen later.
5. **子時 boundary paywalled free users for an hour every night.** See the
   CLAUDE.md section — the fix is "accept either anchor", not "roll the server".
6. **`CHAT_ENABLED_READING_TYPES` unset ⇒ fallback `['LIFETIME']`.** Five of six
   chat surfaces (LOVE/CAREER/ANNUAL/COMPATIBILITY/FORTUNE) were silently off in
   production. All built, all tested, all disabled.

Still open, cosmetic: the compat page renders `1987-09-06T00:00:00.000Z` where
the lifetime page correctly formats `1987-09-06 16:11`. And the Clerk sign-in
card says 「以繼續前往 BAZI APP」 rather than 天命 (Clerk dashboard, not code).

### Verified working in production

Payments **both modes**: one-time (credits 3 → 33) and subscription (tier →
BASIC, plus the 5 monthly credits from `invoice.payment_succeeded`). Different
Stripe modes, different webhook handlers, neither previously exercised.

Engine output matches the calibration anchors **exactly** — Roger's chart
(39分 / 食神格 / 用神火) and, most tellingly, 2026 年運 reproduced 丙午 / 偏印 /
大吉 / 88 with the risk and opportunity months in the documented order.

The doctrine injectors reach the AI and it cites them rather than improvising:
FORTUNE chat restated the 7-label-is-authoritative rule unprompted; compat chat
produced **丑戌半刑 severity 60**, verbatim the Phase 12g.6 Gap 3 anchor.

### B3-b — ✅ DONE, FLIPPED 2026-08-26

**`ENGINE_REQUIRE_KEY=1` is set on the engine service. Enforce mode is live in
production.** Confirmed by a rollup line reading `"mode": "enforce"` with
`"rejected_key_fingerprints": {}`, followed by a clean smoke test (sign-in,
`/calculate` via both `bazi.passthrough` and `bazi.reading`, `/explain-element`,
`/daily-fortune`, and a real LIFETIME reading that came back `degraded: false`
with correct pillars 辛未/己亥/戊子/丙辰).

Final gate: **10 windows, ~2h22m, all 9 call sites keyed, zero rejections.**

Condition 4 — the "1h settle" the script cannot check — was resolved by
**inspection, not by waiting**: there are no scheduled callers at all (zero
`@Cron`/`@Interval`/`@Timeout` in `apps/api/src`; the `chat-cleanup.cron`
referenced in CLAUDE.md no longer exists), and the only continuous caller is
Railway's healthcheck, which hits `/health` — the sole entry in
`engine_auth.py:62`'s `EXEMPT_PATHS`, and therefore invisible to the rollup and
unaffected by the flip. A quiet hour had nothing left to surface.

**Rollback if anything 401s later:** set `ENGINE_REQUIRE_KEY=0` and redeploy.
`require_key_enabled()` re-reads the env per request, so nothing caches a stale
value — but the variable still has to reach the running process, so redeploy
rather than assuming.

#### What the gate caught (why it refused 3 times)

It said DO-NOT-FLIP three times and was right each time. Worth preserving,
because the third refusal is a trap that will recur:

1. Five paths simply hadn't been exercised.
2. Two more hadn't.
3. **`/compatibility` and `/build-chat-context-compat` were driven against
   Roger × Laopo — a pair compared earlier the same day — so the API served the
   stored comparison and never called the engine. Every request returned 200
   while the paths stayed absent.** Fixed by creating a brand-new profile
   (`B3bFreshPair`, 1991-11-14) so the pair had never been computed.
   `/build-chat-context-compat` additionally needs the comparison *unlocked*
   (`COMPARISON_NOT_UNLOCKED`), which costs the 3-credit reveal.

A looser gate would have said GO on the first run, and enforcement would have
been switched on with five call sites never once proven to send a key.

#### Test data left behind (safe to delete)

Under `tapper.fun@gmail.com`: profiles `B3bFreshPair` (1991-11-14) and `TestB3b`
(1993-07-19), the Roger × B3bFreshPair comparison, and a LIFETIME reading on
B3bFreshPair. Credits went 26 → 20 across the exercise (3 compat reveal +
3 LIFETIME reading).

### B3-b — how it got here (historical)

All 9 engine paths have now been driven in production. Six were confirmed keyed
from Railway logs; the last three (`/calculate` both callers, `/explain-element`,
`/build-chat-context`) were driven at the very end of the session using a FRESH
birth profile (1993-07-19) specifically to defeat the caches — the paid-reading
call site is cache-gated and will not fire on a repeated birth date.

**Next action: get the newest `ENGINE-AUTH-ROLLUP` lines from the engine
service's Railway logs and run**

```
node scripts/b3b-preflight.mjs --file <log>
```

Every window so far shows `keyed` with zero absent/invalid and zero counter
failures — only coverage was ever in doubt. If it says GO, set
`ENGINE_REQUIRE_KEY=1` on the engine service and the security phase is done.

⚠️ **The rollup only emits when a request arrives AFTER the 60s window elapses.**
A quiet engine keeps its last window open and never writes the line. Drive one
cheap request to flush it.

⚠️ The gate requires **every** recognised caller of a path, not any one of them.
`/calculate` needs BOTH `bazi.reading` and `bazi.passthrough`.

### Tooling note for whoever picks this up

The built-in browser pane is usable but flaky: it intermittently reports
`Viewport: 0x0`, returns blank screenshots, and its accessibility tree silently
stops partway (the compat form's time/region selects never appear, so
`form_input` cannot address them). Workarounds that held up: close and reopen the
tab to recover the pane; compute coordinates from a live `getBoundingClientRect()`
and scale by `800/innerWidth` rather than trusting a screenshot; prefer creating a
saved profile and picking it from a dropdown over filling a long form.

---

## 0. STATE 2026-08-23 — READ THIS FIRST (supersedes everything below)

**Both security PRs are MERGED AND DEPLOYED.** #63 (deps) → `1261c35`; #64
(Phase 1 + 2A, 48 commits) → merge commit `9ce1ba6`. Prod is healthy on it.

**MERGED 2026-08-23 as [PR #65](https://github.com/taufulou/bazi-app/pull/65)**,
merge commit `5094cf8` — 18 commits, all six CI checks green. Merge commit, NOT
squash, deliberately: CLAUDE.md and this file cite individual SHAs, and a squash
orphans them (that has happened once already). All cited SHAs verified present
on `main` after the merge.

Merging `main` deploys. The owner's standing no-push instruction was lifted for
this batch specifically, because M9's whole purpose is unblocking work that
cannot start from a local branch. It still applies to whatever comes next —
**do not push or merge again without being asked.**

| # | Commit | What |
|---|---|---|
| 1 | `7bb86bd` | CLAUDE.md ZWDS SHA citation repointed (the rebase rewrote every id) |
| 2 | `f002215` | **M10** — web app stops being an engine caller |
| 3 | `606bde9` | M10 audit fixes |
| 4 | `c2ea724` | worktree `node_modules/node_modules` trap recorded |
| 5 | `a229bc8` | **Web suite green + `test-web` CI job** |
| 6 | `d3ca976` | audit fixes: last partial `@repo/shared` stub; the jest-major trap |
| 7 | `9080265` | **history page shows what was CHARGED**, not the list price |
| 8 | `e8b7626` | **M1** — Redis throttling keyed on a verified user |
| 9 | `a58390b` | M1 audit fixes (the DoS I introduced — see below) |
| 10 | `caa9aa4` | **B3-b** rehearsal + pre-flight gate |
| 11 | `11c5179` | B3-b audit fixes (the gate wrongly said GO, twice) |
| 12 | `668b10c` | docs: production LIVE-FACTS table + M1 invariants into CLAUDE.md |
| 13 | `8bcd4a0` | **M9** — `docker/Dockerfile.web` + `WEB_ORIGINS` Stripe allowlist + runbook |
| 14 | `cd6bf14` | M9 audit fixes (a comment I wrote was false; a mutation test caught it) |
| 15 | `44da62b` | docs: WEB_ORIGINS invariants + web deploy recipe |
| 16 | `3884b9b` | **M7** — `GET /health/ready` (DB+Redis required, engine advisory) |
| 17 | `e1681e9` | M7 audit fixes (the public body was leaking driver error text) |
| 18 | `57dea8c` | two comments this batch made false (found by `/code-review`, not by my audits) |

`api tsc 0 · api jest 102 suites / 2017 · web jest 38 suites / 405 · web tsc 0 ·
turbo lint 5/5 · both guards · nest build clean`

### M9 — what shipped, and what is still owner-side

**Code is done; the Railway service does not exist yet.** `docs/deploy/web-service.md`
is the recipe — read it before touching Railway, it carries the failure modes.

- `docker/Dockerfile.web` (multi-stage; standalone needs no runtime install).
  Every COPY path came from running a real `next build` and booting the result
  on :3999 — Docker is unavailable here, so guessing would have surfaced first in
  production. Two `test -f`/`test -d` guards fail the BUILD if Next moves the
  layout, and a shell guard fails it if a required `NEXT_PUBLIC_*` build arg is
  empty (verified under real `/bin/sh`, both ways).
- `WEB_ORIGINS` replaced a regex that allowlisted **`bazi-platform.com`, a domain
  we do not own**, and whose relative branch matched `//evil.com`. See the
  CLAUDE.md section for the invariants. 35 tests; there were **zero** before.
- Found by curling the built server: **`robots.txt` and `sitemap.xml` were
  auth-protected** — the middleware matcher skips a fixed list of static
  extensions and `.txt`/`.xml` are not on it. Nothing had noticed because nothing
  had ever fetched them. Also `robots.txt` named `bazi-platform.com` as the
  sitemap host.

Owner-side next, in order: create the service (Dockerfile builder,
`docker/Dockerfile.web`, Wait-for-CI ON) → set `WEB_ORIGINS` + `CORS_ORIGINS` on
the **API** service → one real test-mode checkout round-trip → a foreign-origin
400 → only then `CLERK_AUTHORIZED_PARTIES` on both services.

### ⚠️ THE OWNER DID THREE THINGS IN PROD THIS SESSION — these are now FACTS

1. **Domain bought: `tianmingapp.com`** (Namecheap, BasicDNS, nameservers
   `dns1/dns2.registrar-servers.com`). Clerk's CNAMEs verified:
   `clerk.` → `frontend-api.clerk.services`, `accounts.` → `accounts.clerk.services`,
   `clkmail.` → `mail.3xtq63frbjw5.clerk.services`. **The BARE domain resolves to
   NOTHING** — no A record, NXDOMAIN. It is not wired to Railway.
2. **Clerk PRODUCTION cutover DONE and verified** (B4-C). Prod API now runs
   `sk_live` + a production webhook. Verified end-to-end: `user.created` webhook
   → HTTP 200; a real production token → `GET /api/users/me` → 200 with
   `credits: 3` (so the signup grant path ran). Owner's prod account:
   clerk `user_3IJ15P0uteRbrJ5tP26JMEaLj6Q`, db id
   `c54573ed-f847-4fab-b159-3818618ef9d7`, admin granted via Clerk
   `publicMetadata.role = "admin"`. Clerk plan upgraded to **Pro** (owner's call).
   ⚠️ Social logins (Apple/Facebook/Google/LINE) are enabled in the UI but have
   NO custom OAuth credentials → clicking them gives Google's
   `Missing required parameter: client_id`. Email sign-in works. Not yet done.
   ⚠️ **The DEV Clerk instance is untouched and is still what local dev uses.**
3. **Redis eviction set** (M5): `maxmemory 256mb` + `maxmemory-policy volatile-lru`,
   applied via the **Custom Start Command**, because `CONFIG SET` did NOT survive a
   restart (tested — it reverted to `0`/`noeviction`). Image is the OFFICIAL
   `redis:8.2.1`, so `REDIS_EXTRA_FLAGS` is ignored. Working command:
   `/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH --maxmemory 256mb --maxmemory-policy volatile-lru"`

### B3-b — HALF DONE, and the remaining half needs the website

`ENGINE_KEY` is set on **both** Railway services and confirmed working: the prod
engine rollup shows `keyed: 2` with recognised callers
(`/calculate<-bazi.passthrough`), zero `absent`/`invalid`/`unconfigured`, mode
`observe`. So the secret is wired correctly — the main risk is cleared.

What remains is EVIDENCE: all 9 engine paths must show `keyed` from their real
caller, which means driving the product. **There is no deployed website**, so
that cannot be done today. Parked deliberately.

Enforce mode was **rehearsed locally** and works (health exempt → 200, 9 paths
401 unkeyed, 422 keyed, and the real `engineFetch` from `apps/api/dist`
round-trips against an enforcing engine). Gate: `node scripts/b3b-preflight.mjs`
— pipe Railway logs in; it refuses undated/stale logs, `keyed<-unknown`, partial
call-site coverage, and either of the engine's TWO counter-failure lines.

### The defect pattern held all session — 3 more instances

- **M10**: I fixed one doc that lied about the web app calling the engine and
  missed its sibling 23 lines up in the SAME file, plus the root `.env.example`.
- **M1**: I put an **unbounded network call in front of the rate limiter**. The
  tracker awaited Clerk's `verifyToken`; a forged token's unknown `kid` always
  misses Clerk's JWKS cache and fetches with NO timeout. So `Bearer <garbage>`
  forced an outbound call BEFORE the throttle decision — inverting
  cheap-gate-before-expensive-gate inside the rate limiter itself. Also claimed
  "parity with the reference" while shipping a FIXED window against the
  reference's sliding one (~2x sustained rate at the boundary).
- **B3-b**: the pre-flight gate said GO on a log containing the engine's
  shutdown-flush failure line, and on a log from 2019.

All found by audit, all fixed, all mutation-checked.

### Immediate next actions

1. ~~M9~~ **DONE in code** (`8bcd4a0` + `cd6bf14`) — the Railway service itself
   is owner-side and still unbuilt. See the M9 block in §0.
2. ~~M7~~ **DONE** (`3884b9b` + `e1681e9`). `GET /health/ready` — DB + Redis
   required, engine advisory, 1s memo + in-flight dedupe, per-dependency
   deadlines, public body redacted. Runbook: `docs/deploy/health-and-readiness.md`.
   **Owner-side**: set the API service's healthcheck path to `/health/ready`.
   Verified live (Redis at a dead port → 503; engine down → 200 degraded;
   `/health` stays 200 throughout). The engine's `EXEMPT_PATHS` was confirmed to
   skip `/health` BEFORE the enforce branch, so the hop survives B3-b's flip.
3. Rest of Phase 2B: M2 Prisma pool · M3 engine `--workers 2` · M4 in-memory
   sweep · M6 graceful shutdown · M8 replicas.
4. Owner-side, optional, nothing blocked on them: Google OAuth (~15 min, needs a
   Google Cloud client); reattaching the owner's orphaned pre-cutover readings to
   the new prod account (SQL not yet written).

---

## 0. STATE 2026-08-17 — READ THIS FIRST (supersedes §1 below)

**PR #63 (deps) MERGED + DEPLOYED as `1261c35`.** Prod verified after: `/health`
200, `/api/bazi/services` 200, `/api/docs` 404 (⇒ `NODE_ENV=production` ⇒
Dockerfile builder ⇒ its `prisma migrate deploy &&` prefix ran).

**Security branch REBASED onto `1261c35` and PUSHED — [PR #64](https://github.com/taufulou/bazi-app/pull/64) is open.**
48 commits, 151 files, +17240/−4040.

The rebase: `32c5d00` was pure deps → **skipped** (main already had it).
`6b08e54` / `2c1191f` / `f986f2c` carried real code alongside dep edits — all
three conflicts resolved with `--ours` (main's side); one was literally the
`_comment` that broke `npm ci`. **The rebased tree is byte-identical to the
pre-rebase backup** (`git diff backup-pre-rebase-1622 HEAD` empty) — that check,
not the suite, is what proves nothing was lost. Only the 2 `guard:*` scripts
differ from main, exactly as the #63 carve-out intended.

`api tsc 0 · api jest 96 suites / 1914 · engine 3137 pytest (2 skip, 5 xfail) ·
web tsc 0 · both CI guards green · nest build clean`

⚠️ **LINT: run `./node_modules/.bin/turbo run lint` FROM THE REPO ROOT.** My
sweep ran `npm run lint` inside `apps/api` and reported green; CI runs turbo
across **five** workspaces (api, web, mobile, `@repo/ui`, `@repo/shared`) and
**web failed** — B5's `CLERK_AUTHORIZED_PARTIES` read in `apps/web/middleware.ts`
was undeclared in `turbo.json`, and web's lint is `--max-warnings 0`. Fixed in
`f8af461` (added to `globalEnv`; it is not a nit — an undeclared var is invisible
to turbo's cache key, so changing the azp allowlist would serve a stale build).
The turbo binary is at `./node_modules/.bin/turbo` in the worktree, NOT
`../../node_modules/.bin/`.

⚠️ **web jest 35/37, 383 passed, 13 failed — MEASURED, not assumed.** The note
used to say "pre-existing" on faith, but this branch **touches
`apps/web/app/pricing/page.tsx`**, the subject of one failing spec. Verified by
building a throwaway worktree at clean `main` `1261c35` (symlink node_modules
from the main checkout) and running both specs there: **identical 13-test failure
set** (`pricing-page` = `useRouter is not a function`; `reading-history` = text
matchers). Redo that comparison, don't re-trust this sentence.

### ⚠️ THE DEPLOY SITUATION CHANGED — the old notes below are WRONG

Railway used to deploy from `feat/mobile-m0`. **The owner switched both the API
service and the private engine service to `main` on 2026-08-16, with auto-deploy
ON and Wait for CI ON.** Switching the branch fired a deploy immediately: prod
jumped from 2026-07-19 (`ad64f5b`) to `6167ea9` at 13:49 and came up healthy,
fully migrated.

So: **merging to main IS a deploy, again.** Verified prod state after that deploy:
`/health` ok · `/api/bazi/services` 200 with real data · `POST /api/zwds/readings`
404 (post-Aug-4 code) · `/api/docs` 404 (⇒ `NODE_ENV=production` ⇒ the Dockerfile
is the builder ⇒ its CMD `prisma migrate deploy && node …` ran, and the app
serving at all proves migrations applied).

Check deploys with `gh api "repos/taufulou/bazi-app/deployments?per_page=10"` —
note this only shows GitHub-triggered deploys, not CLI/dashboard ones.

### PR #63 — deps, ready to merge

`claude/deps-security-patches` = **4 files off main** (package.json ×3 +
package-lock.json). Carved out deliberately: the Swagger-gate code could NOT come
with it because `main.ts` on the security branch imports `common/sentry-scrub.ts`,
which does not exist on main. The two `guard:*` npm scripts were left behind for
the same reason.

Reviewed with `/code-review:code-review 63` (5 parallel agents + confidence
scoring). **One issue, scored 100, and it was mine** — fixed in `37e1bc2`. All 5
CI checks green, `mergeStateStatus: CLEAN`.

⚠️ **Merge order:** the security branch contains the same dependency work in its
own history. Merge #63 first, THEN rebase the security branch onto main (those 3
commits collapse to a no-op). Otherwise they conflict on package.json/lockfile.

### What this session did (12 commits, newest first)

| Commit | What |
|---|---|
| `f986f2c` | Same `_comment` fix as #63, applied at source; warning moved into swagger-gate.ts |
| `2c1191f` | Swagger gate was STILL fail-open (see the Joi trap below); spec rewritten from theatre to behaviour; js-yaml advisory cleared, not accepted |
| `6b08e54` | Overrides were the wrong tool — `npm update` was; blanket brace-expansion override had BROKEN minimatch 9/10 |
| `32c5d00` | next 16.1.5→16.3.1, @nestjs/swagger→11.4.6, react-dom realign |
| `e5e9b75` | Fixed the LKG fallback my own cap-check had stranded; compat cap moved below the cache read |
| `721e0aa` | Cap-before-quota at 13 sites · stream usage on abort · Gemini abort signal · record() never-throws · judge cap · SSE code |
| `addb9d8` | Shut the door ZWDS was still reachable through (`POST /api/bazi/readings` accepted ZWDS types) |
| `ad106fc` | **Deleted ZWDS entirely** — 3715 lines, 15 files |
| `c128a84` | Compat reveal refund skipped by my own guard · compat generator recorded $0 · AI_BUSY recognised nowhere |
| `a659089` | Closed the spend guard's own bypasses; gave it a self-test |

### Recurring defect, now at instance ~15

Every audit this session found a bug **introduced by the previous fix**:
the cap check that stranded the LKG fallback, the guard that jumped the refund,
the override that fixed an advisory and broke minimatch, the fail-open gate
"fixed" into a different fail-open, the `_comment` documenting an npm trap that
WAS an npm trap. The pattern: **a control that is right in the helper and wrong
at the call site, or a fix verified against already-resolved state rather than
re-derived state.** Audit after every slice; mutation-test every lock.

### Immediate next actions

1. ~~Merge PR #63~~ ✅ · ~~rebase~~ ✅ · ~~re-sweep~~ ✅ · ~~open the security PR~~ ✅ (#64)
2. **Run `/code-review:code-review 64`** once its CI is green. Expect more than
   #63's single finding: 151 files of money paths, entitlement gates and spend
   controls, and this branch's own history contains **five bugs introduced by the
   previous round's fix**, every one of which passed a full green suite. A clean
   review here is a reason to look harder at call sites, not a pass.
3. Merge #64 → **this deploys Phase 1 + 2A**. No migration, no schema change,
   every new env var optional-with-safe-default, both kill switches ship off.
4. Then: **M10 → B3-b → M7 in that order** (they pull against each other and are
   all in Phase 2B — M10 moves the last non-NestJS engine callers, B3-b's
   fail-closed flip breaks the free chart preview until it lands, and M7's
   readiness probe must use the keyed helper or B3-a's counter never reaches
   zero). S5 stays blocked on a Sentry DSN. Then Phase 2C, Phase 3 load test.

### Still open (deliberately)

- `AI_BUSY` still costs a quota unit on the bazi/chat paths (fortune is fixed —
  its quota now sits inside the stream method, after cap and slot).
- COMPATIBILITY/ZWDS cache-purge gap — published 「永久刪除」 inaccurate for 合盤.
- Orphaned fortune snapshots.
- Signed-out e2e specs (8 expected breaks + standalone anon specs + 3 stale ZWDS
  intercepts in `e2e/free-reading.spec.ts`).
- RevenueCat F8/F10 before any IAP ship.
- 81 npm advisories remain, **all** in the Expo/React-Native cluster (not
  deployed); zero non-mobile.

---

## 1. State (HISTORICAL — 2026-08-15)

**25 commits ahead of main, nothing merged, nothing deployed.** Working tree clean.
`api tsc 0 · api lint 0 · 1769 jest passing`.

> ⚠️ **Correction (2026-08-15).** Earlier notes and commit messages in this branch
> reported "web tsc 106 (unchanged baseline)". **That number was an artifact of
> this worktree**, not of the code: `apps/web/tsconfig.json` includes
> `.next/types/**/*.ts`, and a stale local `.next` produced 106 phantom errors.
> Measured in clean throwaway worktrees with the documented symlinks, **web tsc
> is 0 on main AND 0 on this branch**. The conclusion ("the branch adds no web
> type errors") was right; the number was noise. Verify with a detached worktree,
> not this directory.

**Phase 1: 1A ✅ · 1B ✅ · 1C ✅ · 1D ✅** — each line-audited by parallel sub-agents, every
finding fixed or explicitly recorded as accepted.

### STATE 2026-08-15 (late) — PHASE 1 GATE PASSED, AWAITING THE MERGE DECISION

**30 commits.** `B3-a` shipped (`bb7d5f9`) + its line audit (`6d47847`) + the
**Phase 1 gate** (`6ea81ba`). The gate was the plan's 2-parallel audit
(money-paths / authz+PII) over the cumulative diff; both halves returned
GO-WITH-FOLLOWUPS, all before-merge findings are fixed and mutation-tested.

`api tsc 0 · lint 0 · 1862 jest · engine 3137 pytest · web tsc 0 · guard green ·
merges clean into main (main has not moved since the branch point)`.

⚠️ **The merge is the deploy** (Railway auto-deploys `main`) and is the OWNER'S
call — not taken. Everything below the gate section in
`docs/security/audit-2026-08.md` is the deferred list with triggers.

**No DB migration, no schema change, and every new env var is optional with a
safe default** — the API boots in prod with no config change, both kill switches
already off. Post-merge verification steps are in the gate section of the audit
doc.

### IMMEDIATE NEXT ACTION (superseded — kept for the B3 history)

**B3 — lock the Python engine. Now ONE step, not three.** It was blocked; the owner's 2026-08-15
Railway screenshots unblocked it *and* shrank it:

- Engine has **no public domain** (private networking only, `engine.railway.internal`) ⇒ P0.5
  resolved, B3 re-rated **not urgent** — the attacker set is "code already inside the Railway
  project", not the internet. Still worth doing before launch.
- **No healthcheck path configured** ⇒ B3-b's fail-closed flip cannot break a deploy. ⚠️ If one is
  ever added, `/health` (`packages/bazi-engine/app/main.py:253`) must be exempt from the auth check.
- **No Sentry DSN on the engine** ⇒ B3-a(0)'s acceptance ("the rejection counter needs somewhere to
  live") was unsatisfiable. **Decision: count rejections in Railway logs instead.** Removes the
  owner dependency and collapses observe→enforce into one step. Do NOT re-introduce a Sentry
  requirement without also handling sentry-python's PII defaults (`send_default_pii=False`,
  `max_request_body_size="never"`, **`include_local_variables=False`** — at an engine exception the
  stack locals ARE the birth data).

The engine currently has **zero** auth references (`grep -cE 'Depends|Header\(|Authorization'` over
`main.py` → 0).

After B3: **Phase 1 gate → merge.**

---

## 2. The 25 commits

`a49498e` A8 rewarded-ads kill · `5f76227` A8 audit · `beded6c` F3 section-unlock off ·
`1a148b1` A3 webhooks · `9d25b7d` F2 paywall · `7045a88` A4/F1 profile cap + signup bonus ·
`32e710d` A6/A7 ledger + atomic admin · `8b711ef` 1A audit gate ·
`6d7ca23` F5 · `7026365` F5 audit · `3cdf67f` F6 · `2ed1cdf` F6 audit ·
`b09d4ea` B1+O3 · `f079b28` B1/B2 audit · `c5aa50b` F9 · `9768321` F9 audit ·
`3029e71` proration credit guard · `bf6b33b` B5 azp · `52e525b` B5 audit ·
`9c65fce` 1C PII · `72299bc` 1C audit · `d385c43` 1D scans · `aeaf95e` 1D audit ·
`34f3126` DB password rotation · `653520a` owner answers

---

## 3. Owner-side items (2026-08-15)

| Item | Status |
|---|---|
| O8 zero-users Clerk reset | ✅ **ACCEPTED** — dev account + 96 profiles need not survive cutover |
| Local Postgres password | ✅ **ROTATED** — and it exposed that Postgres uses `trust` auth (§6) |
| Stripe portal | ✅ Answered — live NOT configured; sandbox plan-switching turned **OFF** |
| Railway engine (P0.3/P0.5) | ✅ Answered — see §1 |
| `CLERK_AUTHORIZED_PARTIES` | ⏸ **Deferred — no web deploy exists.** Do NOT set it to localhost |
| B4 prod Clerk instance | ⏸ Deferred — needs a domain (none configured) |

Owner deliverable page (kept current):
https://claude.ai/code/artifact/6299d7e9-c4fc-4764-b831-150e1cd4f147

### Two things nothing will prompt anyone about

1. **Set `CLERK_AUTHORIZED_PARTIES` on both Railway services the day web deploys.** B5 is inert
   until then; the guard logs a warning saying so. Get the value by decoding a real token's `azp`
   — never guess, never use localhost (it's the one origin any attacker can claim).
2. **Re-check the Stripe portal page when live Stripe is configured.** Live and sandbox portal
   configs are independent; F-2 is unreachable today only because sandbox switching is off.

---

## 4. What's live (verified 2026-08-15)

| | |
|---|---|
| API | `https://bazi-app-production-5e54.up.railway.app` — `/health` returns 200 |
| Engine, Postgres, Redis | Railway, **private to the project** |
| Web | **NOT deployed.** Runs locally at `localhost:3000` |
| Mobile | Dev builds only |

Merging to `main` is what triggers a Railway deploy. That is the audit-before-merge gate.

---

## 5. Standing constraints (do not relax)

- Branch commits do NOT deploy; only merging to `main` does.
- Production doubles as the test environment (zero real users). **HARD CUTOVER: this stops the
  moment one real user exists.**
- Do NOT raise auto-reload until S2 (spend breaker) ships and is verified.
- `ADS_REWARDS_ENABLED` re-enable requires AdMob SSV first; `SECTION_UNLOCK_ENABLED` requires
  wiring `SectionUnlock` into content delivery first. **The flags are kill switches, not fixes.**
- **Never gate content on `creditsUsed > 0`** — 0-credit cache-hit readings are deliberately free
  (F4, owner-confirmed).
- **Never log or telemeter the four pillars / 干支.** See CLAUDE.md § "Security hardening".
- Commit only when the owner asks. Line-audit each phase before starting the next.

---

## 6. Verification lessons — read before writing any fix

### The one that recurred SIX times

A well-covered **helper** behind **untested wiring**, or a **sibling path** doing the same thing
unfixed. Every instance passed the full suite with the control deleted:

1. F6's stream door · 2. O3's tier decision · 3. F-1's `sendMessage` door · 4. F-7's ZWDS twin ·
5. F9's `/payments/upgrade` route (no controller test among 14 covered payments routes) ·
6. **1C's Clerk `user.deleted` webhook** — the headline bug repeated verbatim, and it runs on every
in-app deletion because `deleteAccount` deletes the Clerk user.

**Ask per CALL SITE, not per file — and against the column the decision actually reads.** F9's
sweep grepped `subscriptionTier:` when the input to `computeEffectiveTier` is `Subscription.status`;
that is how `cancelSubscription` / `reactivateSubscription` were missed.

### Mutation testing

- **A mutation must COMPILE.** `Tests: 0 total`, or a failed suite with no failing test, = compile
  error = the mutation proved NOTHING. Always read `Test Suites:` beside `Tests:`.
- Some mutants are **equivalent** (e.g. `status: stripeStatus` → `'ACTIVE'` past a gate that proves
  it). Say so; don't claim coverage.
- **Never run the full suite while a mutation auditor is live** — phantom failures.
- zsh does NOT word-split unquoted `$VARS`: `jest $SPECS` becomes one pattern → "No tests found" →
  exit 1, which reads like a caught mutation. Pass args explicitly.

### Mocks

- A **static fixture severs read-from-write**: 1C and F9 both had `findMany` returning the
  post-state unconditionally, so writing the WRONG value *and* reordering the writes both stayed
  green. Make the fake stateful when ordering or derivation is the claim.
- A **blanket config stub answers questions it was never asked** — `get: () => 'sk_test_fake'` fed
  the secret key in as B5's azp allowlist the moment the guard read a second key.
- A fixture that already contains what you're asserting makes the test vacuous (B5's metadata test:
  dropping the fix survived all 161 tests).
- A mock cannot validate SQL (`GREATEST`, `ON CONFLICT`, CTEs).
- A test that asserts only `not.toThrow()` can pass **while leaking** (the scrubber depth test).

### Claims

- Don't publish a number you didn't just run: `npm audit` said 32 high, then 72 an hour later
  (advisories are fetched live). Date every count.
- Don't state a vendor behaviour as verified when it's inference. "Mobile sends no `azp`" was
  written as fact; `azp` is minted by Clerk's servers and nothing in this repo proves it.
- Verify against the **vendored source** in `node_modules` rather than memory — that settled the
  Clerk `!azp` short-circuit and Stripe's `error_if_incomplete` semantics.

---

## 7. Accepted-not-fixed (each with a trigger)

Full list in `docs/security/audit-2026-08.md`. Most likely to matter:

- **Cache purge is incomplete** — COMPATIBILITY uses `generateComparisonHash` (different function,
  folds in the year); ZWDS rows with month/day/question key on 9 args while the purge passes 6
  (verified hash mismatch). Trigger: before any external PDPA audit.
- **`ReadingCache` has no enforced TTL** — `expiresAt` is a read-time filter and there are **zero
  `@Cron` in the API**. Also means `ChatSession.hardDeleteAt`'s 12-month delete is unenforced, and
  CLAUDE.md's `chat-cleanup.cron` does not exist.
- **`next@16.1.5` → 16.3.1 is URGENT** — 12 HIGH advisories, three App-Router middleware bypasses
  landing on the `auth.protect()` signed-out lockdown. Apply in the MAIN checkout: `npm audit fix`
  from a worktree writes through the symlink into main.
- **`@clerk/clerk-expo` auth bypass** — the advisory range covers our own pin, so bumping to the pin
  fixes nothing. Before mobile ships.
- **Local Postgres does not check passwords** — `trust` auth; a garbage password authenticates.
  Bounded to localhost (`listen_addresses = localhost`). Optional: `scram-sha-256` in
  `/opt/homebrew/var/postgresql@15/pg_hba.conf` — but several project scripts may rely on
  passwordless connections, so check first.
- **PostHog** — `mask_all_text` shipped; `autocapture` deliberately left ON (product decision).
- Webhook ordering guard; wrong plan name on Stripe invoices; `syncUserTier` unlocked recompute.

---

## 8. Gotchas

- `nest`/`npx` often fail from a worktree → absolute
  `node /Users/roger/Documents/Python/Bazi_Plotting/node_modules/.bin/nest build`.
- Every shell needs `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.
- After editing services → rebuild NestJS + restart; the running PID has stale code.
- Browser on `127.0.0.1:3000` (HSTS dodge) → `__session` is httpOnly; use
  `await window.Clerk.session.getToken()`.
- `cmd | tail` returns *tail's* exit code — capture the real one before piping.
- **The eslint suppressions ratchet is two-sided** — fails if a count rises AND if it falls without
  re-pinning. `--prune-suppressions` clears stale entries.
- There are **47 stale worktrees**; a recursive grep from the repo root returns ~150 hits for
  anything in a tracked file, and it once silently skipped `apps/api/.env`. Check specific files
  directly when the answer matters.
