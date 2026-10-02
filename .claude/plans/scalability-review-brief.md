# Scalability review brief — Bazi SaaS (tianmingapp.com)

You are doing an **independent scalability review** of what is currently
deployed. A previous session did the scalability implementation (M1–M10) and ran
a load test (Phase 3). **You are not that session.**

---

## 1. ⚠️ The instruction that matters most: this is a MEASURING exercise

The predictable failure mode of this review is that it becomes a *reading*
exercise — a thoughtful essay about connection pools, produced without running
anything. That output would be worse than useless, because it would look like a
review.

**A scalability claim without a number is not a finding.** Reading the code is
how you form a hypothesis; running something is how you turn it into a finding.
If you cannot measure something, say so explicitly rather than reasoning your
way to a confident-sounding paragraph.

Same doc caveat as always: `CLAUDE.md`, `load-test/L6-tuning-report.md` and
`.claude/plans/launch-security-phase1-session-handoff.md` (in this repo) were written by the
sessions that did the work. Claims of the form "measured: X" are checkable;
claims of the form "this is fine" are conclusions and must be re-derived.

---

## 2. Understand the reframe before planning anything

Phase 3's headline finding inverts the usual capacity question:

```
reading pool (fleet)      : 24 slots     (AI_READING_POOL 12 × REPLICA_COUNT 2)
slot-seconds per reading  : 80           (call1 + call2 in PARALLEL, ~40s each)
pool-sustainable rate     : 0.30/s = 18/min = 1,080/hr

daily spend cap           : $50 / $0.303624 = 165 readings per DAY
pool burns that cap in    : 9.1 minutes at full utilisation
```

**The binding constraint is the AI spend cap, not infrastructure** — by a factor
of ~157 on a daily basis. Raising `AI_READING_POOL` without raising
`AI_DAILY_SPEND_LIMIT_USD` changes nothing; the breaker trips first.

The second structural finding: **AI load scales with DISTINCT work, not request
volume.** Readings are cached by birth-data hash and fortune by (profile, date).
One earlier run issued ~775 reading requests and reached the model **once**.
Forecast cost and concurrency from *new-chart volume*, not page views.

Verify both of these — they set the shape of everything else. If they hold, a
review that spends its budget on request-throughput tuning is aimed at the wrong
target.

---

## 3. Start here: the prior report's own gap list

`load-test/L6-tuning-report.md` § "What is NOT measured" names five gaps. These
are the highest-value starting points because they are stated as gaps, not
conclusions:

| # | Gap | Why it matters |
|---|---|---|
| 1 | **Real per-call AI latency** — only whole-POST wall clock was measured (70.5s, 90.4s). The pool arithmetic uses the **mock's** 40s. | Every pool number above is derived from an assumed latency. If real latency differs, the whole table moves. |
| 2 | **Attribution of the 248 generations** — `ai_generations` counts any call ≥5s across reading POSTs, streams and chat together. | Proves AI work happened; cannot break it down by surface. |
| 3 | **No soak beyond 6.5 minutes.** Connection-pool exhaustion, memory growth and Redis key growth are **unobserved**. | The classic slow failures all live past 6.5 minutes. Probably the single biggest gap. |
| 4 | **The breaker never tripped under load** — `spend_capped` was 0% by design (`MOCK_USAGE_SCALE=0.01`). | The refusal path at scale is unproven. |
| 5 | **Fortune and chat at generation volume** — exercised for correctness, not capacity. | Fortune is cached per (profile, date); chat needed a paid extension per session. |

Also unproven and adjacent: **Redis-down** and **engine-down** drills have never
been run (`docs/ops/backups-and-dr.md`). Redis down means the rate limiter
fails OPEN and the spend breaker fails OPEN — spend becomes uncapped while
readiness 503s. That is a capacity *and* safety property and it is cheap to
test locally.

---

## 4. Be honest about whether this review is premature

There are **zero real users**. Any load profile you invent is a guess, and
tuning against a guessed shape produces confident numbers about a fiction.

So separate two questions and say which you are answering:

- **The narrow pre-launch question** — "does anything fall over at the capacity
  already provisioned, and are the failure modes graceful?" Answerable now.
  Gaps 3 and 4 above, plus the two drills, are the meat of it.
- **The real capacity question** — "what happens at N concurrent users?"
  Needs a real N. Not answerable now; say so rather than inventing one.

If your honest conclusion is "the valuable half of this needs real traffic",
that is a legitimate finding. Report it instead of padding.

---

## 5. Rules of engagement

1. **The load test costs real money.** Get the user's explicit go-ahead before
   any run, with an estimate. Even against the mock there are traps (below).
2. **Production doubles as the test environment, and that ends the moment one
   real user exists.** Assume it could end at any time.
3. **The load test leaves fabricated readings CACHED BY BIRTH-DATA HASH.**
   Cleanup is not optional — a real user whose birth data collides would be
   served a fabricated reading. Clean up via the app's own
   `DELETE /api/users/me` (its 200 is a synchronous receipt that
   `erasePersonalData` ran). **Do NOT rely on the Clerk `user.deleted` webhook**
   — tested, it left 3 of 3 profiles behind while reporting success.
4. **Secrets never enter the transcript.** Anything needing the production
   `sk_live_` Clerk key or the Postgres connection string is the user's to run;
   write the command, have them paste the output.
5. **Restore anything you change.** Notably `AI_DAILY_SPEND_LIMIT_USD` after any
   breaker drill — readings stay refused until you put it back.

---

## 6. Load-test traps that have already cost a session each

Read `load-test/README.md` in full before running anything. The expensive ones:

- **The switch is `LOADTEST_ANTHROPIC_BASE_URL`, never `ANTHROPIC_BASE_URL`.**
  The app deliberately ignores the latter — but **the Anthropic SDK reads it
  anyway**, so setting it redirects every call while our own override reports
  `null`. Read **`aiBaseUrlEffective`** on `GET /api/admin/ops` (the resolved
  `client.baseURL`) — it is the only value that cannot lie about where AI
  traffic is going. `node load-test/ops.mjs` samples every replica and prints
  ARMED / NOT ARMED / PARTIALLY ARMED / INCONCLUSIVE / NOT CONFIRMED.
- **Unset `LOADTEST_ANTHROPIC_BASE_URL` BEFORE deleting the mock service.**
  Reversed, every reading fails looking exactly like an Anthropic outage.
- **`MOCK_USAGE_SCALE=1` drives the REAL spend ledger.** The S2 breaker trips
  after ~165 readings and everything after is a legitimate `AI_SPEND_CAP` 503,
  which destroys the `5xx<0.5%` criterion. Run throughput scenarios at `0.01`;
  use `1` only for a deliberate short breaker run (gap 4).
- **Token minting: `sessions.createSession()` is DEVELOPMENT-INSTANCE ONLY** —
  it fails on production with `request_invalid_for_environment`. Production
  needs the browser flow (`createSignInToken` → `POST {fapi}/v1/client/sign_ins?_is_native=1`
  → `getToken`). Tickets are **single-use** (a 429'd attempt spends one), and
  revoking a session does NOT invalidate an already-minted token — only a short
  TTL does.
- **Clerk's Frontend API is rate limited far tighter than the Backend API** —
  a tight loop dies at ~5. Pace ~250ms with backoff.
- **Renaming a Railway service changes its `.railway.internal` hostname.**
- **k6 scenarios must send `stream: true`** for V2 types or they are refused
  with `STREAM_REQUIRED`.

---

## 7. Things that do not scale by themselves — verify the coupling holds

- **`REPLICA_COUNT` must move WITH the platform's replica count.** It divides
  both the Prisma pool warning and `AiGovernorService`'s in-memory pools.
  Scaling replicas without updating it silently doubles the burn ceiling;
  setting it too high throttles the fleet. Currently **2**.
- **Connection math:** `DATABASE_CONNECTION_LIMIT` defaults to 10, so
  2 × 10 = 20 against a stock `max_connections=100`. Unset, Prisma would size
  from the *host's* core count, not your share.
- **Per-process state** (a single probe may hit either replica, so N replicas
  means N copies): Anthropic rate-limit headers, `ai-spend.warned` (so the 80%
  warning fires once per replica), `readiness.inFlight`, the chat
  sample-questions LRU, `ShutdownService.activeStreams`, and the engine's
  auth rollup counter.
- **`AI_MAX_TOTAL_TIME_MS` (900s) gates the START of an attempt**, not an
  in-flight one — so worst-case generation is budget + one call timeout
  (~1200s), not 300s. Three separate values were sized wrongly against the
  per-call timeout before. Check any new derived timeout goes through
  `AIService.safeBoundMs`.

---

## 8. Standard of evidence

Mark each finding **MEASURED** (you ran it and have the number) or **DERIVED**
(you computed it from someone else's number — say whose, and whether that
number was itself measured or assumed). The pool table in §2 is *derived from
the mock's 40s*, which is exactly the kind of chain worth stating plainly.

A finding needs: the number, how it was obtained, what it implies at what load,
and what breaks first.

Beware the shape that has bitten this codebase repeatedly: **a well-covered
helper behind untested wiring.** `buildPooledDatabaseUrl` had 11 tests and
nothing proved Prisma honoured the URL — the proof was timing 12 concurrent
queries at limits 3/6/12 and seeing 4/2/1 waves. Prove behaviour by running the
thing, not by reading it.

---

## 9. What to produce

1. **Findings**, ranked by what breaks first in practice. Each with the number,
   MEASURED/DERIVED, the load at which it bites, and the failure mode.
2. **A corrected capacity picture** — if the §2 table's inputs are wrong,
   restate it with real numbers.
3. **Coverage** — what you actually ran and what it showed, including runs that
   came back clean. A review that reports only problems leaves "fine" and
   "never tested" indistinguishable.
4. **What you could not measure and why** (needed real traffic, needed a
   secret, needed money the user did not authorise).
5. **Doc corrections** — anything in the L6 report or `CLAUDE.md` you found
   stale or wrong.

Do not change configuration or fix anything unless the user asks. Report first.

---

## 10. Environment

- Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`
- API `https://bazi-app-production-5e54.up.railway.app` · Web
  `https://tianmingapp.com` · engine private · API at **2 replicas**
- `GET /api/admin/ops` is the authoritative live instrument (pools, spend,
  breaker, quota, replicas, `aiBaseUrlEffective`). Needs admin auth.
- ⚠️ **`/admin/ai-costs` is NOT authoritative for budgeting** — it has never
  included chat or fortune (those call `aiSpend.record()` directly and write no
  `AIUsageLog` row). Use `/api/admin/ops` and the `AI-CALL` log lines.
- Harness: `load-test/` (README, `k6/s1-browse.js`, `s2-mix.js`,
  `s5-correctness.js`, `mock-anthropic/`, `seed-users.mjs`, `mint-tokens.mjs`,
  `ops.mjs`, `purge-usage-log.mjs`).
- Do NOT run `npm audit fix` from a worktree — `node_modules` symlinks into the
  main checkout.
