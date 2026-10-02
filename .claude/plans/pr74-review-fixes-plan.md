# PR #74 review follow-ups — implementation plan (items 1–7)

**Status:** ✅ **APPROVED (v8)** and **IMPLEMENTED 2026-10-02** — see §10.
**Branch:** `claude/launch-security-phase1-plan-8e760f` (PR #74, open, CI green at `5b1297b`).
**Source:** the `/code-review` run on PR #74 (2026-10-02). Nine candidates; none scored ≥ 80, so nothing was
posted to the PR. The owner asked to fix items 1–7. Items 8 (dead `uncertain` branch, 25) and 9 (longer
create-lock wedge after SIGKILL, 0 — a documented trade-off) are out of scope.

No migration, no env var, no prompt change, no cache-version bump. Everything here is tests, an ops
script, a CI guard, comments/docs, and one operator step in Sentry.

---

## 0. Item → files map

| # | Score | Problem (one line) | Files |
|---|---|---|---|
| 1 | 75 | `REQUIRE_REDIS_TESTS=1` is honoured by the new lock spec only; the throttler spec still skips green | NEW `apps/api/test/support/real-redis.ts`, NEW `apps/api/test/real-redis-helper.spec.ts`, `redis-throttler-storage.spec.ts`, `redis-lock.integration.spec.ts`, `.github/workflows/ci.yml` (comment) |
| 2 | 75 | `chat-session-stream` + `overran_ttl` is EXPECTED (todo #26) but would page via Sentry's any-event rule | docs only: runbook, handoff (#26, §0), CLAUDE.md, `chat-stream.service.ts` docblock — plus one owner step in Sentry when the first event arrives |
| 3 | 75 | `ops.mjs` headline says green NOT ARMED while a replica was never reached | NEW `load-test/ops-report.mjs`, `load-test/ops.mjs`, NEW `apps/api/test/ops-report.spec.ts`, CLAUDE.md, handoff, `load-test/README.md` |
| 4 | 75 | `interpret()` says "only error responses so far" / 🔴 "every call failed" when calls are merely in flight | `load-test/ops-report.mjs`, `anthropic-rate-limit.ts` table, runbook table |
| 5 | 75 | `LOCK_MARGIN_SECONDS` docblock (and runbook) describe the work under both create locks wrongly | `apps/api/src/bazi/bazi.service.ts` (comment), runbook `overran_ttl` table |
| 6 | 50 | Parity guard header overstates its rule; inline / quoted / dash-form / workflow-level `npm_config_*`, `$GITHUB_ENV`, `npm config set` and its aliases, and `npm <opts> ci` all bypass it | `scripts/check-ci-docker-install-parity.mjs`, `apps/api/test/ci-docker-install-parity.guard.spec.ts` |
| 7 | 50 | Lock guard docblock says rule (d) matches `/lock/i`; the code's `LOCK_WORD` is narrower | `apps/api/test/redis-lock-ownership.guard.spec.ts` (comment) |

---

## 1. Item 1 — the throttler spec must fail, not skip, under `REQUIRE_REDIS_TESTS=1`

**Today.** `redis-throttler-storage.spec.ts` has 6 tests, each opening with
`if (!available) return void console.warn('SKIPPED: …')` (lines 54, 81, 97, 110, 123, 133). CI sets
`REQUIRE_REDIS_TESTS: '1'` for the whole `test-api` job (`ci.yml:88-91`), but only
`redis-lock.integration.spec.ts` reads it. If the CI `redis:7` service breaks, the throttler spec —
the only test of the sliding-window Lua behind every rate limit — stays green while testing nothing.
These are the only two specs that open a real Redis (verified).

**Fix — one rule, one place.**

1. NEW `apps/api/test/support/real-redis.ts` (jest never collects it: `testRegex` is `.*\.spec\.ts$`):
   ```ts
   /**
    * Call at the top of every real-Redis test: `if (!needRedis(available, REDIS_URL)) return;`
    * Returns true when the test should run. Under REQUIRE_REDIS_TESTS=1 (CI's test-api job, which
    * provisions Redis) an unreachable Redis THROWS — a skip there would be green while testing
    * nothing. Elsewhere it skips loudly. Deliberately NOT keyed on the generic `CI` variable.
    * Reads the env var at CALL time, so there is no exported constant to go stale.
    */
   export function needRedis(available: boolean, url: string): boolean { … }
   ```
2. `redis-lock.integration.spec.ts`: delete its local `REQUIRED` + `needRedis()`, import the shared
   helper; call sites become `needRedis(available, REDIS_URL)`. Docblock unchanged in substance.
3. `redis-throttler-storage.spec.ts`: replace the 6 skip lines with
   `if (!needRedis(available, REDIS_URL)) return;`; update its docblock ("It still SKIPS (loudly)…"
   → "skips loudly on a dev machine without Redis; FAILS under `REQUIRE_REDIS_TESTS=1`").
4. NEW `apps/api/test/real-redis-helper.spec.ts` — its OWN file, so a leaked env value cannot reorder
   another suite. Saves `process.env.REQUIRE_REDIS_TESTS` in `beforeEach` and restores it in
   `afterEach` (CI sets it to `'1'` for the whole job); spies `console.warn`. Cases: available → true;
   unavailable + flag `'1'` → throws (message names the URL); unavailable + flag unset → false and
   warns; unavailable + flag `'true'` → false (only `'1'` counts, matching ci.yml).
5. `ci.yml:57-60` comment ("Without this service the spec skips") → "Without this service the
   real-Redis specs FAIL (REQUIRE_REDIS_TESTS below) — they never skip green in CI."

**Rejected:** a guard scanning every spec for a real `new Redis(` without `needRedis` — too heuristic.

**Verify (mutation):** Redis up + flag → both specs pass. `REDIS_URL=redis://localhost:6390`
(nothing listening) + flag → the throttler spec's 6 tests FAIL (run once on the OLD file first to
show they skipped green). Same dead URL, no flag → skipped, green. Make `needRedis` ignore the flag →
the helper spec fails.

---

## 2. Item 2 — a known, unfixed lost lock must not page every hour (and must still be measured)

**Today.** `RedisService.reportLostLock` sends `redis.lock.lost_before_release` (level warning,
fingerprint `[event, lockPrefix, cause]`) to Sentry. The project's single alert rule fires on ANY
event, throttled 60 min (handoff, OPERATOR 2). The runbook marks `chat-session-stream` /
`overran_ttl` as expected until todo #26.

**v1 proposed a code allowlist that skipped Sentry for that pair. Dropped in v2** (review round 1,
issue 11): #26 is explicitly WAITING for this event to say how often the overrun happens, and there
is no production data point yet — the token code ships in this PR. Code suppression would trade
Sentry's free per-issue count, graph and spike detection for a manual Railway-log search with finite
retention, and would hide a sharp increase (e.g. a regression in context build). It would also be
code someone must remember to delete.

**v2 — no code change; route the noise in Sentry, where the count survives.**
- Sentry's "Archive → Until escalating" pauses alerts on ONE issue until its event rate rises
  significantly, while still counting every event on it (Sentry docs: *Issue Status* and
  *Escalating Issues Algorithm*). Our rule is an issue alert, not a metric alert, so archiving
  silences it for that issue only. Because the fingerprint is `[event, lockPrefix, cause]`, the
  `chat-session-stream`/`overran_ttl` issue is separate from every other lost-lock issue and from
  the `ai.spend.*` issues — archiving it masks nothing else.
- So the first occurrence emails once (that is the measurement starting); the owner archives that
  one issue "until escalating"; counts keep accruing for #26; a spike re-pages.
- Bound on noise if nobody archives: the 60-minute throttle — at most one email per hour for that
  issue, and none while it does not occur.
- **The suppression itself must be verified once** (the "built vs delivered" rule applied to a
  silencing step): after archiving, the NEXT occurrence must raise that issue's event count with NO
  email.
- **Fallback, only if that check fails — and it is easy to get wrong** (review round 3, issue 6).
  "Exclude that pair" means NOT(A AND B): alert when `lockPrefix ≠ chat-session-stream` **OR**
  `cause ≠ overran_ttl`. In the rule's IF section that is filter-match **"Any"** with two
  **"is not equal to"** tag filters. The tempting "None of" + two "equals" filters is NOT(A OR B) and
  would silence every `overran_ttl` (incl. `reading:create`, the double-charge signal) and every
  `chat-session-stream` event. And because events WITHOUT these tags (`ai.spend.*`, 5xx reports) must
  keep alerting, the owner MUST confirm after saving that a tagless event still emails — with a
  REAL ingested event that goes through the rule's filters: a one-off `sentry-cli send-event` /
  `captureMessage` with a UNIQUE message (a fresh issue). The #7 spend drill also works, but only if
  the `ai.spend.threshold_80` issue has NOT alerted within the last hour — it always lands on that
  same issue (review round 5, issue 1). Two traps (review round 4, issue 2): the rule editor's "Send
  Test Notification" button fires the action WITHOUT evaluating the IF filters (the handoff already
  notes it "proves Sentry → email only"), so it would "prove" a broken filter fine; and the
  per-issue 60-minute throttle hides the email if the event lands on an issue that already alerted
  within the hour — hence the unique message. If that
  cannot be confirmed, remove the filter and accept the bounded cost — at most one email an hour for
  that one issue, only while it occurs — until #26 ships. Never leave an unverified filter on the
  only alert rule.
- **Rollout-window events are different:** the #23 deploy is expected to produce a few `lost_early`
  events (old replicas' bare `DEL`s), each its own issue and email. Those are **Resolved** after the
  window — never archived — so a later recurrence alerts as a regression.

**Docs (this is the whole change):**
- Runbook `overran_ttl` table, `chat-session-stream` row: "Expected until #26. The FIRST event
  emails — then in Sentry open that issue (`lockPrefix:chat-session-stream`, `cause:overran_ttl`) →
  **Archive → Until escalating**. Check the next occurrence raises the count WITHOUT an email (if it
  still emails, see the fallback below the table — match "Any" + two "is not equal to" filters, then
  prove a tagless event still alerts). Its event count is #26's measurement;
  Sentry re-alerts if it spikes. Resolve it when #26 ships. Do not archive any OTHER lost-lock issue
  this way."
- Runbook `lost_early` section, cause 4 (old replica's bare `DEL` during the #23 rolling deploy):
  "**Resolve** these issues once the deploy window is over — do not archive them."
- Handoff #26: replace "so production will measure how often this happens" with the same
  instruction + "the Sentry issue's event count IS the measurement"; add "when fixed, resolve that
  issue so a recurrence alerts as a regression".
- Handoff §0 (the #26 line): "…the new alert will measure it — archive its first Sentry issue
  'until escalating'".
- CLAUDE.md #26 paragraph ("Since #23 that shows up as …"): append the archive instruction.
- `chat-stream.service.ts` `STREAM_LOCK_TTL_SECONDS` docblock: unchanged in substance (it still
  reports to Sentry); add "(archived 'until escalating' in Sentry — see runbook)".

No code, so no test. (Considered and rejected: `level: 'info'` — the rule has no level filter, so it
still emails; adding a "level ≥ warning" filter would silently drop any future `captureMessage`
left at Sentry's default `info` level — the "built vs delivered alert" trap.)

---

## 3. Items 3 + 4 — `ops.mjs` must not show an all-clear it cannot back up

### 3.1 Move ALL rendering into a pure, tested module

`ops.mjs` is the arm-time and teardown safety check and has no tests. v2 moves every decision AND
every printed line into NEW `load-test/ops-report.mjs` (ESM, zero imports, no I/O), so the spec
covers what the operator actually reads — not a helper behind untested wiring:

- `ageOn(sample, ms)`, `interpret(sample)`, `groupByReplica(samples)` — moved (interpret changed per
  §3.4).
- `verdict(samples)` → `{ kind, reached, expected, armedReplicas, deployments }`,
  `kind ∈ armed | partially_armed | inconclusive | uncertain | not_armed`.
- `render(samples)` → `string[]` — everything `ops.mjs:100-237` prints today, in the same order: the
  "deployed API is older" block, the headline, replicas/spend/breaker, the per-replica blocks, the
  unattributed-samples block, the "INCONCLUSIVE about N of M" block, the "no client built" block.
- `needMoreSamples(samples, { explicit })` → boolean (adaptive sampling, §3.3).

`ops.mjs` keeps only: args, Clerk admin lookup, token mint, `readOps()`, the sampling loop (now
calling `needMoreSamples`), and `for (const line of render(samples)) console.log(line)`.
**Rule for the move:** text and order identical except the intended changes below — diff the output
of `render()` against today's script on the same fixture to prove it (§3.5).

### 3.2 Item 3 — the headline reflects coverage

A sample is **armed** when its `aiBaseUrlEffective` is set and not `api.anthropic.com`, OR its
`aiBaseUrlOverride` is set (today's two signals, unchanged). A replica is armed when any of its
samples is. The verdict must be conservative in BOTH directions, because the script is the check at
two moments: at teardown only a clean NOT ARMED may pass, and at arm time only a fully ARMED fleet
may pass (a partly armed fleet sends some k6 traffic — and real spend — to Anthropic and spoils the
run; review round 2, issue 6).

`verdict()` precedence (first match wins):
1. **armed** — every expected replica answered (`reached ≥ expected`), every reached replica is
   armed, at most one `deploymentId` answered, and no unattributed (old-code) sample is unarmed →
   `🟠 ARMED on all ${expected} replica(s) — AI traffic is going to the MOCK, not to Anthropic.`
2. **partially_armed** — at least one sample is armed, but rule 1 does not hold (a reached replica
   is unarmed, a replica never answered, or a deploy is in progress) →
   `🟠 PARTIALLY ARMED — ${k} of the ${reached} replica(s) reached point at the MOCK (expected
   ${expected})${u ? ` and ${u} unattributed sample(s) did` : ''}; ${detail}. Not safe to start a
   load test, and NOT torn down.` (`detail` names unarmed / never answered / mid-deploy.) Counting
   against `reached`, not `expected`, so it can never read "0 of 2" (the armed sample came from an
   old-code replica with no identity) or "3 of 2" (mid-deploy) — review round 3, issue 2.
3. **inconclusive** — no sample armed AND either
   - `reached < expected` (`reached` = distinct identified `instance.replicaId`s; unattributed
     old-code samples do not count), or
   - samples carry more than one distinct non-null `instance.deploymentId` (mid rolling deploy: a
     draining old replica and a new one have different replica ids, so `reached ≥ expected` can be
     satisfied while a current replica never answered).
   Headline: `🟡 INCONCLUSIVE — not armed on the ${reached} replica(s) reached, but ${why}.` where
   `why` is `${expected - reached} of ${expected} never answered` or `a deploy is in progress
   (${n} deployments answered) — re-run after it finishes`.
4. **uncertain** — unchanged (no override, no reached replica has built a client).
5. **not_armed** — unchanged green line.

The "no replica reached had built a client" note at the bottom is printed whenever its own
condition holds (`no sample armed && every sample's aiBaseUrlEffective is null`), NOT keyed on
`kind === 'uncertain'` — otherwise it would silently disappear whenever INCONCLUSIVE takes
precedence. Tested (§3.5).

`expected` = `ops.replicas ?? 1` (first sample), as today. Comment notes the two known limits:
`replicas` is the server's `REPLICA_COUNT` (if set lower than the real fleet the check over-trusts —
the M2+M8 rule says they move together); and locally every process falls back to the same hostname,
so for a local multi-process smoke set `RAILWAY_REPLICA_ID` per process.

**Exit code stays 0** in every case (read by a human; nothing calls it). Rejected as out of scope.

### 3.3 Adaptive sampling — so the default run can actually go green on 2 replicas

Without this, `--samples` defaults to 1 and production runs 2 replicas, so EVERY default run —
including the documented teardown check — would print 🟡 INCONCLUSIVE forever, training the operator
to ignore yellow (review round 1, issue 8).

- **Default (no `--samples`): auto.** Take one sample; keep sampling (paced 250ms, hard cap 20 — the
  admin endpoint is `@Throttle(30/min)`) until every expected replica has answered with an identity.
  Stop early, as today, on a 429 or any failure, and report what was collected.
- If the FIRST sample has no `instance` (an API older than #24), stop at 1 — identities can never
  arrive, and the "older API" block already says so.
- **`--samples N`: exactly N** (cap 20), as today — for watching counters over time.
- `needMoreSamples(samples, { explicit })`: explicit → `samples.length < N`; auto →
  `samples.length < 20 && samples[0].instance && reached < expected`.
- Docblock + the throttle note updated: auto mode costs at most 20 of the 30/min.

### 3.4 Item 4 — in flight is not failure

Compute `inFlight = max(0, requestsStarted − responsesSeen − transportErrors)` (every started attempt
ends as a response or a transport error; verified in `anthropic-rate-limit.ts`). `interpret()`:

1. `requestsStarted == 0` → unchanged ("no Anthropic call…").
2. `responsesSeen == 0 && transportErrors > 0 && inFlight == 0` → unchanged 🔴 "every call got NO
   HTTP response".
3. `responsesSeen == 0 && inFlight > 0` → NEW "`${inFlight}` call(s) in flight, nothing back yet — run
   again in a few seconds"; plus, if `transportErrors > 0`, a second note "⚠️ `${n}` call(s) already
   got no HTTP response".
4. The `observedAt` / `okWithoutHeaders` / "only error responses" branches — unchanged (all imply
   `responsesSeen > 0`).
5. Secondary notes — unchanged.

Both tables `interpret` mirrors get the same rows (`anthropic-rate-limit.ts` docblock and the
runbook's "Approaching Anthropic's rate limits"): the 🔴 row gains "and nothing still in flight"; a
new row "`responsesSeen == 0`, calls in flight (`requestsStarted > responsesSeen + transportErrors`)
→ nothing back yet".

### 3.5 Tests — NEW `apps/api/test/ops-report.spec.ts`

ts-jest compiles to CommonJS, so `import()` of ESM becomes `require` and fails (verified). Same
approach as `ci-docker-install-parity.guard.spec.ts`: run `node --input-type=module -e` with a
script that imports `ops-report.mjs` by file URL and prints JSON; parse and assert. Nothing written
to the repo.

- **Fixtures are time-independent:** every sample sets `generatedAt`, and `observedAt` /
  `lastResponseAt` are absolute values relative to it, so `ageOn()` never falls back to `Date.now()`
  and the golden parity literal cannot drift or flake.
- **Each arming signal alone** (the two dangerous directions `ops.mjs` warns about), on a 1-replica
  fleet: override set + effective `null` (no client yet) → `armed`; override `null` + effective
  `http://mock-anthropic.railway.internal` (bare `ANTHROPIC_BASE_URL`) → `armed`. Mutation: drop
  either half of the per-sample armed test → its case fails.
- Arming coverage (2 expected): both reached + both armed + one deployment → `armed`; both reached,
  one armed → `partially_armed` (`1 of 2`); one reached and armed → `partially_armed` (never
  answered); both armed but two deployment ids → `partially_armed` (mid-deploy); the only armed
  sample is an unattributed old-code one → `partially_armed`, headline says "0 of the 1 replica(s)
  reached … and 1 unattributed sample(s) did" (never "0 of 2"). Mutation: make rule 1 ignore
  coverage → the partial cases fail.
- Teardown coverage (2 expected, none armed): reached 1 → `inconclusive`, headline contains `1 of
  2`; reached 2 → `not_armed`; only old-code samples → `inconclusive`; two deployment ids with
  reached 2 → `inconclusive` mentioning the deploy.
- `uncertain`, and the bottom "no client built" note STILL present when the headline is
  INCONCLUSIVE.
- `interpret`: started 0; started 2/responses 0/transport 0 → in flight; started 3/responses
  0/transport 1 → in flight + "already got no HTTP response", NOT 🔴; started 2/responses 0/transport
  2 → 🔴; errors only → "only error responses"; `observedAt` set → "working".
- `needMoreSamples`: auto stops once both replicas seen; auto continues at 1 of 2; auto stops at 20;
  auto stops when the first sample lacks `instance`; explicit 5 continues even with both seen.
- **Parity of the move:** one fixture rendered by `render()` equals, line for line, the text today's
  `ops.mjs:100-237` produces for it — except the headline line (captured once from the pre-change
  script into the spec as a literal).

**Optional live smoke** (if local servers are up): two local API processes with distinct
`RAILWAY_REPLICA_ID` and `REPLICA_COUNT=2` → auto mode reaches both and prints green; stop one →
yellow INCONCLUSIVE.

**Docs:** `ops.mjs` docblock; CLAUDE.md ("prints a plain ARMED / NOT ARMED verdict" → "ARMED / NOT
ARMED / PARTIALLY ARMED / INCONCLUSIVE — by default it samples until every replica has answered");
handoff line 169 (same) and TEARDOWN step 5 ("🟢 NOT ARMED on every replica — run it after the
redeploy that applies the variable change has finished, or it reports INCONCLUSIVE / PARTIALLY ARMED
(mid-deploy)"); the arm-time step gets the mirror ("🟠 ARMED on all replicas — PARTIALLY ARMED means
do not start k6"); `load-test/README.md` teardown section gets the same lines. (Railway stages a
variable edit until it is deployed — so the wording names "the redeploy that applies the change",
not one the edit triggers.)

---

## 4. Item 5 — describe each create lock's work correctly (comment + runbook only)

**Traced** (`bazi.service.ts` `_executeCreateReading`, `getCachedInterpretation` in `ai.service.ts`):

`reading:create`, in order:
1. reuse `baziReading.findFirst` — Prisma, may wait `pool_timeout` (20s);
2. `getCachedInterpretation` — a Redis GET, then `readingCache.findFirst` (≤ 20s; any error is
   swallowed by its `catch`);
3. the engine call — hard-capped at 45s by `AbortSignal.timeout`, no retry;
4. streaming pre-flight `assertUnderCap` + `quota.check` — Redis only;
5. the charging `prisma.$transaction(async (tx) => …)` — interactive, no options, so Prisma's
   defaults apply: `maxWait` 2s + `timeout` 5s.

Prisma-bound worst case under full pool exhaustion ≈ 20 + 20 + 45 + 7 = **~92s < 105s**. So pool
exhaustion ALONE does not outlive this lock. What can: a Redis command that hangs (this client has
`maxRetriesPerRequest: 3`, which bounds a Redis that is DOWN, but no `commandTimeout`, so a connected
Redis that stops answering blocks steps 2 and 4 indefinitely), or an event-loop stall.

`comparison:create`: engine (≤ 30s) → one insert (≤ 20s) = 50s on the normal path; the
duplicate-pair (P2002) path adds `findFirst` + possibly `update` (≤ 40s) = 90s, exactly the TTL. No
Redis inside the lock body. So an overrun needs the duplicate-pair path under full pool exhaustion,
or an event-loop stall.

**Fix:** rewrite the create-lock bullet of the `LOCK_MARGIN_SECONDS` docblock with these per-lock
bounds (replacing "~4 sequential DB operations … covers the healthy path and moderate contention,
NOT the worst case"). Runbook `overran_ttl` table: split the `reading:create, comparison:create` row
into two rows — `reading:create`: first suspect a hung Redis (`redis-cli --latency`, `SLOWLOG GET`)
or an event-loop stall, not the pool; `comparison:create`: a same-pair double-submit while the pool
was saturated, or a stall. Fix the existing phrase "each query can wait `pool_timeout` = 20s" (it is
not true of the transaction).

**Not in scope:** adding `commandTimeout` to the Redis client — a behaviour change for every Redis
call; noted in the runbook row as the known gap.

---

## 5. Item 6 — the install-parity guard: accurate header, close the realistic bypasses

**Today.** Header rule 5 says "any `npm_config_*` env key"; the code exempts 6 output-only keys. The
env check (`:159-165`) is anchored to a YAML `key:` at line start inside the `build:` block. Verified
bypasses (review round 1, issue 5): inline `npm_config_workspaces=true npm ci …` (the command is
read from `npm ci` onward, dropping the prefix); `export …`; `echo "npm_config_…=…" >> $GITHUB_ENV`
and its heredoc form `npm_config_x<<EOF`; dash-form keys (`npm_config_include-workspace-root`);
quoted keys (`"npm_config_workspaces":`); flow mappings (`env: { npm_config_workspaces: true }`); a
workflow-level `env:` (applies to every job); `npm config set` and its aliases `npm c set`,
`npm set`; and (pre-existing) `npm <options> ci …` (e.g. `npm -ws ci`), which matches neither the
`npm ci` pattern nor `OTHER_INSTALL`.

**Fix.**
0. **Two comment strippers — one per language** (review round 5, issue 2; supersedes v5's "one
   stripper everywhere", which applied SHELL quoting to YAML). The two languages disagree, and the
   guard must read exactly what GitHub executes:
   - **`stripYamlComment(value)`** — for YAML text: the `run:` header (`:171`) and every YAML line the
     key scan reads. YAML's rule depends on how the scalar STARTS: a **plain** scalar (not starting
     with `'` or `"`) ends at the first ` #`, and quote characters INSIDE it are literal —
     `run: echo " # x" && npm install` parses to `echo "` (verified with `js-yaml`), so GitHub runs a
     broken `echo "` and never the install. A **quoted** scalar (starts with `'` or `"`) is cut only
     at a ` #` AFTER its closing quote, honouring `''` inside single quotes and `\"` inside double. A
     block-scalar header (`| # c`, `>- # c`) is cut at ` #`. For a `key: value` line the rule applies
     to the value (the part after the first `: ` outside a quoted key); a flow mapping value
     (`{ … }`) is treated as plain except that quoted scalars inside it are skipped. So today's
     quote-blind strip at `:171` is CORRECT for plain scalars and stays that behaviour; what changes
     is that a quoted scalar is no longer cut inside its quotes.
   - **`stripShellComment(line)`** — for shell text: each line of a `run:` scalar's CONTENT
     (`:194`) after YAML has been applied (block-scalar bodies, and the inside of a quoted scalar). A
     `#` starts a comment only at a word start outside `'…'` / `"…"`.
   - **Escapes** (review round 6, issue 1): inside a YAML double-quoted scalar, a `\` escapes the
     NEXT character, whatever it is — so `k: "a\\" # c` closes after `\\` and the comment is cut
     (checking only "is the char before `"` a `\`" would get this wrong); inside YAML single quotes
     the only escape is `''`. In `stripShellComment`, outside single quotes a `\` escapes the next
     character — `"a \" # b"` is still inside the string, and `\#` is not a comment; inside single
     quotes nothing is special until the closing `'`.
   - Block-scalar bodies (`|`, `>`) contain no YAML comments — every body line is content, as today.
     A PLAIN multi-line scalar's continuation lines are YAML: a ` #` there ends the scalar, so the
     assembly applies `stripYamlComment` to each continuation line and stops after the first one
     that had a comment (a plain scalar followed by a comment and another continuation line is a
     YAML error that GitHub rejects anyway — verified with `js-yaml`).
   - **A QUOTED scalar may also span lines** (review round 6, issue 2) — `run: "echo ' # x'` then
     `  && npm install"` parses to `echo ' # x' && npm install`. So `stripYamlComment` is a small
     stateful scanner over the WHOLE scalar (header + continuation lines), not a per-line function:
     the open-quote state carries from the header into the continuation lines, and a ` #` is cut only
     after the closing quote has been seen.
1. **One unanchored key scan** replaces the anchored one, reading the same text GitHub would:
   - YAML lines — every non-comment line of the build block that is NOT inside a `run:` scalar, PLUS
     every non-comment line OUTSIDE the `jobs:` block (workflow-level `env:` blocks and flow
     mappings alike; other jobs never affect the Build job) — after `stripYamlComment`;
   - each `run:` scalar's assembled script, line by line, after `stripShellComment`.
   Regex (case-insensitive, global): `\bnpm_config_[A-Za-z0-9_-]+(?=["']?\s*(?:=|:|<<))`. Normalise
   each hit (`toLowerCase`, `-`→`_`) before checking `COSMETIC_NPM_CONFIG`. Covers YAML keys, quoted
   keys, flow mappings, inline assignments, `export`, `env x=y`, `$GITHUB_ENV` echo and heredoc. A
   trailing YAML comment (`NODE_VERSION: '22'  # npm_config_workspaces: never`, or
   `k: it's  # npm_config_workspaces: x` — plain scalar, so the comment is dropped despite the `'`)
   does not false-positive.
2. **A token check on every build-block shell segment** (each line split on `&&`, `;`, `||`, `|`),
   replacing v2's two regexes so options that take a separate value cannot slip through (review
   round 2, issue 2). Repeatedly drop leading `VAR=value` tokens and the wrapper words `env`,
   `time`, `command`, `sudo`, `nice` (review round 3, issue 1). If the first remaining token is
   `npm`, look at the tokens AFTER it, up to the first `run` / `run-script` / `exec` / `x` (anything
   after those is a script's own arguments):
   - **(a) config writes — never exempt, global or not:** `config` / `c` followed by a write verb
     (`set`, `delete`, `edit`, `fix`), a bare `set` subcommand, or `pkg` followed by `set` / `delete`
     / `fix` (which can rewrite `workspaces` in package.json) → fail ("config writes have no place in
     the Build job — set it in the Dockerfiles first if it is ever needed"). Read-only
     `npm config get …` / `npm config list` stay legal (review round 3, issue 3). `npm -g config set`
     writes the GLOBAL npmrc, which project installs also read, so the global exemption must NOT
     apply here (review round 3, issue 5).
   - **(b) options before the subcommand:** the first token after `npm` starts with `-`, a later
     token is `ci` or an `OTHER_INSTALL` npm alias, and the segment is NOT a global install
     (`GLOBAL_INSTALL` — the exemption applies to install subcommands only, exactly as in
     `OTHER_INSTALL` today) → fail ("put options AFTER the subcommand so the pairing can read them").
   A plain `npm ci …` / `npm install …` segment is untouched by this check — the pairing and
   `OTHER_INSTALL` already handle those, so nothing is reported twice.
   This catches `npm config set`, `npm c set`, `npm set`, `npm config delete x`, `npm pkg set
   workspaces[0]=x`, `npm -ws ci`, `npm --workspaces ci`, `npm -w api ci`, `npm --prefix . ci`,
   `npm --location=project set x`, `npm -g config set x`, `npm --global config set x`,
   `CI=1 npm -ws ci`, `env CI=1 npm -ws ci`, `time npm -w api ci`. Legal: `npm --version`, `npm -v`,
   `npm config get registry`, `npm config list`, `npm run build --workspace=web`,
   `npm -w web run build`, `npm install -g npm@10`, `npm -g install corepack`.
3. **Header rule 5 rewritten** to state exactly this, including the six allowed output-only keys, and
   the honest limit: "a ratchet against plausible drift, not adversarial edits — out of scope: a
   committed `.npmrc`, a step that writes one, an install hidden in a script file the step calls, a
   wrapper other than `env`/`time`/`command`/`sudo`/`nice`, or one of those wrappers invoked with
   its own options (`nice -n 10 npm …`, `sudo -E npm …`, `env -i …`)" (review round 4, issue 1).
4. **Fix the guard's existing strippers with the right language each** (review rounds 4 + 5). Today
   the `run:` header (`:171`) and each shell line (`:194`) both strip quote-blind. Verified on the
   current guard: (i) a `run: |` block containing `echo " # x" && npm install` PASSES — YAML keeps
   the line, the shell runs the install, but `:194` cuts at the quoted `#`; (ii) a double-quoted
   `run: "echo ' # x' && npm install"` PASSES — `:171` cuts inside the YAML quotes; (iii) a `run: |`
   block with `echo " # x" && <in-sync web npm ci>` gets a false MISSING. `:171` switches to
   `stripYamlComment` (plain scalars unchanged, quoted scalars fixed); `:194` switches to
   `stripShellComment`.

Confirmed against the real `ci.yml` (review rounds 1–6 ran the regexes, the token check and the
v6 strippers): no false positive — no non-comment line in the build job or at workflow level has an
inline ` #`, the quoted values (`'npm'`, the two `NEXT_PUBLIC_*`) contain none, and top-level `env:`
holds only `NODE_VERSION` / `PYTHON_VERSION`. The strippers change nothing on the real file.

**Spec fixtures** (`ci-docker-install-parity.guard.spec.ts`): `ciYml()` gains an optional third
parameter — text inserted at workflow level before `jobs:`. New cases, each failing with the key or
command named in the output:
- inline `npm_config_workspaces=true ${WEB_NPM_CI}`; uppercase `NPM_CONFIG_WORKSPACES=true …`;
- `run: |` with `export npm_config_workspaces=true` then the in-sync command;
- `echo "npm_config_workspaces=true" >> $GITHUB_ENV`; heredoc `echo 'npm_config_workspaces<<EOF' >> $GITHUB_ENV`;
- dash-form YAML key `npm_config_include-workspace-root: true`; quoted key; build-job flow mapping;
- workflow-level `env:` block with `npm_config_workspaces: 'true'`; workflow-level flow mapping;
- `npm config set workspaces true`; `npm c set …`; `npm set …`; `npm config delete x`;
  `npm pkg set workspaces[0]=x`; `npm --location=project set x`; `npm -g config set x`;
  `npm --global config set x`;
- `npm -ws ci`; `npm --workspaces ci`; `npm -w api ci`; `npm --prefix . ci`; `CI=1 npm -ws ci`;
  `env CI=1 npm -ws ci`; `time npm -w api ci`;
- **the comment/quote cases** (each where the text GitHub EXECUTES differs from a naive read):
  - a `run: |` block with `echo " # note" && npm_config_workspaces=true ${WEB_NPM_CI}` — the shell
    runs the assignment; only the key scan can catch it (the token check drops the leading
    `VAR=value`). The spec asserts the output CONTAINS `npm_config_workspaces`, not just exit 1.
  - a `run: |` block with `echo " # x" && npm install` — must FAIL (`OTHER_INSTALL`); passes today.
  - double-quoted `run: "echo ' # x' && npm install"` — must FAIL; passes today.
  - a double-quoted scalar spanning two lines with the ` #` on the CONTINUATION line, inside the
    still-open quote: `run: "echo ok` / `  && echo ' # x' && npm install"` (js-yaml:
    `echo ok && echo ' # x' && npm install`) — must FAIL. A per-line implementation would read the
    continuation as plain, cut at ` #` and hide the install (review round 7, issue 1).
  - YAML escape, written in the spec with `String.raw` so the YAML text is unambiguous:
    `run: "echo \" # x\" && npm install"` (js-yaml: `echo " # x" && npm install`) — must FAIL;
    dropping YAML backslash handling would close the quote at `\"`, cut at ` #` and hide the install
    (review round 7, issue 2).
  - shell escape: a `run: |` line `echo "a \" # b" && npm install` — must FAIL (the `#` is inside
    the shell string, so the install is not commented out).
Passing cases: inline cosmetic `npm_config_loglevel=warn ${WEB_NPM_CI}`; dash-form cosmetic
`npm_config_update-notifier=false`; workflow-level `env:` with `NODE_VERSION` and
`NPM_CONFIG_LOGLEVEL`; a trailing YAML comment mentioning `npm_config_workspaces:`;
`npm --version`; `npm config get registry`; `npm config list`; `npm -w web run build`;
`npm -g install corepack`; the in-sync web step written as a `run: |` block
`echo " # x" && ${WEB_NPM_CI}` (no false MISSING); workflow-level `k: it's  # npm_config_workspaces: x`;
an extra step `run: "echo a\\" # && npm install` (`String.raw`; js-yaml: `echo a\` — the `\\` is an
escaped backslash, the quote closes, and the install is in a COMMENT) — catches the tempting "char
before `"` is `\` ⇒ escaped" shortcut, which would keep the quote open and read the comment as a
command. "passes on the REAL repository" stays.

**Pinned YAML truncation (must FAIL, today and after):** plain `run: echo " # x" && ${WEB_NPM_CI}` →
MISSING the web install — YAML cuts the plain scalar at ` #`, so GitHub never runs it, and the guard
must not report parity for it.

**Mutation:** remove each new check in turn → its fixtures fail, the real repo still passes; make
`stripYamlComment` shell-aware (quote-respecting inside plain scalars) → the pinned truncation
fixture stops reporting MISSING and the `it's` fixture false-positives; make `stripShellComment`
quote-blind → the `run: |` / double-quoted fixtures fail; reset the YAML quote state per line → the
two-line quoted fixture fails; drop YAML backslash handling → the YAML-escape FAIL fixture passes;
use the "char before `"` is `\`" shortcut → the `"echo a\\" # && npm install` PASS fixture fails;
drop shell backslash handling → the shell-escape fixture passes; make the global exemption apply to
rule (a) → the `npm -g config set` fixture fails. (Each fixture was checked against `js-yaml` in
review round 7 so it bites its paired mutation.)

---

## 6. Item 7 — lock guard docblock

`redis-lock-ownership.guard.spec.ts:28-32`, rule (d): "its text matches /lock/i" → "its text contains
`lock` as a word or camel-case part (`LOCK_WORD` below: `lockKey`, `readingLockKey`, `LOCK_KEY`,
`stream:lock` — not `blockKey` / `clock` / `streamlock`), or it starts with a known lock prefix".
Comment only.

---

## 7. Order, commit, verification

**Order:** 7 → 5 (comments) → 1 → 6 → 3+4 → 2 (docs) → remaining docs. Each code item: write the
test, see it fail (or mutate), then pass.

**Commit:** one commit on the PR branch — `fix: PR #74 review follow-ups (items 1–7)` — body lists
each item; push so PR #74 updates.

**Verification before push:**
- `apps/api/tsconfig.json` includes only `src/**/*`, so `tsc` does NOT check test files or the new
  helper. Their proof is the jest runs: watch each suite's test COUNT (a suite that fails to compile
  reports `0 tests`) — and eslint, which does lint `test/**`.
- Targeted, from `apps/api` with `npx --no-install jest`, `REQUIRE_REDIS_TESTS=1`, local Redis up:
  `real-redis-helper`, `redis-throttler-storage`, `redis-lock.integration`, `redis-lock`,
  `ops-report`, `ci-docker-install-parity.guard`, `redis-lock-ownership.guard`.
- The dead-Redis runs from §1.
- Full API jest with `REQUIRE_REDIS_TESTS=1`; suite and test counts rise only by the new tests.
- `tsc --noEmit` for `apps/api` (src unaffected except comments — sanity); `./node_modules/.bin/turbo
  run lint --force` from the root (expect `0 cached`, 5/5).
- `node scripts/check-ci-docker-install-parity.mjs` on the real repo → ✓.
- Every mutation listed above, seen to fail, then reverted.
- After push: PR #74 CI all green (`ccd_pr get_status`).

## 8. Risks

- **Item 2 depends on an owner step in Sentry** after the first event. If skipped, the cost is
  bounded: at most one email per hour for that one issue, only while it occurs. Written into the
  runbook and handoff #26 where the owner will meet it.
- **Item 3 restructures the arm-time and teardown safety check.** Mitigated: every printed line now
  comes from a tested pure function, the move is proven by a line-for-line parity case, both arming
  signals are tested separately, and the verdict is conservative in both directions (only a full
  ARMED passes arm time, only a clean NOT ARMED passes teardown).
- **Item 3 auto sampling** issues up to 20 requests (of the 30/min throttle) when a replica is
  unreachable. A second run within the minute can 429 — the script already reports what it collected
  and says to wait 60s.
- **Item 6 new checks could false-positive** on a future legitimate step. Each message says why and
  what to do; cosmetic keys stay allowed; `npm --version` stays legal.

---

## 9. Review log

### Round 1 (staff engineer) — 11 issues, none Critical/High. All addressed:

| # | Sev | Issue | Resolution |
|---|---|---|---|
| 1 | Low | Helper had a const + call-time read; self-test could leak env; `ci.yml:57-60` comment stale | Const dropped; self-test in its own file with save/restore; comment fixed (§1) |
| 2 | Low | `tsc` does not cover `test/` | Risk bullet replaced; proof = jest counts + eslint (§7) |
| 3 | Low | Mixed in-flight case still 🔴 | `inFlight` computed; 🔴 only when nothing in flight (§3.4) |
| 4 | Low | `reached` over-counted mid-deploy; local hostname collision | Multiple deployment ids → INCONCLUSIVE; local note (§3.2) |
| 5 | Low | Guard misses `npm set`/`npm c set`, dash-form, quoted, flow-mapping, heredoc, `npm <opts> ci` | One unanchored scan + alias + options-before-subcommand checks, with fixtures (§5) |
| 6 | Low | Item 2 wording / missing unparseable test | Moot — item 2 is no longer a code change |
| 7 | Low | Docs left out of sync (chat-stream docblock, handoff §0/#26/TEARDOWN, README, CLAUDE.md `--samples`) | All listed in §2 / §3.5 |
| 8 | Med | Default 1 sample → every prod run INCONCLUSIVE | Adaptive sampling by default (§3.3) |
| 9 | Med | Extraction tests did not protect the wiring or each arming signal | Whole render moved into the pure module; each signal tested + mutated; parity case (§3.1, §3.5) |
| 10 | Med | `reading:create` arithmetic wrong (cache lookup before engine; pre-flight is Redis; transaction defaults 2s+5s) | Re-derived: ~92s < 105s; overrun ⇒ hung Redis or stall (§4) |
| 11 | Med | Code suppression throws away #26's measurement before any data exists | Replaced with Sentry "Archive until escalating" on that one issue — counts kept, spike re-pages, no code to forget (§2) |

### Round 2 (same reviewer) — no Critical/High/Medium; 6 Low. All addressed:

| # | Sev | Issue | Resolution |
|---|---|---|---|
| 1 | Low | Key scan false-positives on a trailing YAML comment | Quote-aware `stripTrailingComment()` before scanning; pass fixtures for both cases (§5) |
| 2 | Low | Options with a separate value (`npm -w api ci`, `npm --prefix . ci`) or before `set`/`config` evade | Token check per shell segment replaces both regexes, with fixtures (§5) |
| 3 | Low | `ageOn()` falls back to `Date.now()` → golden literal can flake | Fixtures set `generatedAt` and absolute timestamps (§3.5) |
| 4 | Low | Archive step unverified; rollout-window `lost_early` issues need different handling | One-time "next occurrence, no email" check with a tag-pair-filter fallback; rollout issues are Resolved, not archived (§2) |
| 5 | Low | Teardown wording assumed Railway redeploys on a variable edit | "the redeploy that applies the change" (§3.5) |
| 6 | Low | `armed` fires on ANY replica → a partly armed fleet passes arm time | Per-replica arming; new `partially_armed` kind; only a full ARMED passes arm time, with tests (§3.2, §3.5) |

### Round 3 (same reviewer) — no Critical/High/Medium; 6 Low. All addressed:

| # | Sev | Issue | Resolution |
|---|---|---|---|
| 1 | Low | `env` / `time` / `sudo` wrappers skip the token check | Leading wrapper words dropped with `VAR=value`; remaining wrappers named as a limit in the header (§5) |
| 2 | Low | PARTIALLY ARMED could read "0 of 2" / "3 of 2" | Counts against `reached`, adds unattributed samples; test case (§3.2, §3.5) |
| 3 | Low | Any `config` token failed, incl. read-only `config get/list` | Only write verbs (`set`/`delete`/`edit`/`fix`, bare `set`, `pkg set/delete/fix`); pass fixtures for get/list (§5) |
| 4 | Low | Quoted-`#` pass fixture tested nothing | Replaced by a FAIL fixture a quote-blind strip would miss, plus its mutation (§5) |
| 5 | Low | `GLOBAL_INSTALL` exemption would let `npm -g config set` through | Exemption applies to install subcommands only, never to config writes; fixtures + mutation (§5) |
| 6 | Low | Sentry fallback filter easy to invert (would mute `reading:create` overruns) or to mute tagless spend alerts | Exact recipe ("Any" + two "is not equal to"), mandatory tagless-event check, else no filter (§2) |

### Round 4 (same reviewer) — no Critical/High/Medium; 3 Low. All addressed:

| # | Sev | Issue | Resolution |
|---|---|---|---|
| 1 | Low | Wrappers with their own options (`nice -n 10`, `sudo -E`, `env -i`) skip the token check | Named as a limit in header rule 5 (unlikely in a Build job) (§5) |
| 2 | Low | "A tagless event still emails" check could falsely pass: test-notification button skips IF filters; per-issue throttle hides the email | Real ingested event with a unique message; both traps spelled out (§2) |
| 3 | Low | The guard's existing quote-blind strips (`:171`, `:194`) mask the new fixture and let `echo " # x" && npm install` through today | One quote-aware `stripTrailingComment()` used at all three sites; spec asserts the key name; fail + pass fixtures for the existing evasion / false MISSING (§5) — **corrected in round 5** |

### Round 5 (same reviewer) — 1 Medium, 1 Low. Both addressed:

| # | Sev | Issue | Resolution |
|---|---|---|---|
| 1 | Low | The #7 spend drill always lands on the same Sentry issue, so its email can be throttled | Drill counts only if that issue has not alerted within the hour; default is a unique-message event (§2) |
| 2 | Med | v5 applied SHELL quoting to YAML: a plain scalar ends at the first ` #` regardless of inner quotes (js-yaml: `run: echo " # x" && npm install` → `echo "`), so a shell-style strip at `:171` would read text GitHub never runs — a fail-open for the planned pass fixture. The real bypasses are `run: \|` blocks and double-quoted scalars | Two strippers: `stripYamlComment` (plain = cut at first ` #`; quoted = cut after the closing quote; block header = cut) for `:171` and YAML lines; `stripShellComment` for `:194` and run-scalar content. Fixtures moved to `run: \|` / double-quoted forms; plain-scalar truncation pinned as MISSING; mutations for both strippers (§5) |

### Round 6 (same reviewer) — "approved to implement"; 2 Low edge cases, folded in anyway:

| # | Sev | Issue | Resolution |
|---|---|---|---|
| 1 | Low | Escape handling: YAML `\\` before a closing `"`; shell `\"` inside a string and `\#` | Both strippers skip the character after a `\` (outside single quotes); YAML single quotes escape only `''`; fixtures + mutation (§5) |
| 2 | Low | A quoted `run:` scalar can span lines; per-line stripping would cut inside the still-open quote | `stripYamlComment` is a stateful scanner over the whole scalar; fixture + mutation (§5) |
| — | note | Stale "round 1 ran the regexes" citation | Updated to cover the v6 key scan, token check and strippers (§5) |

### Round 7 (same reviewer) — "approved to implement"; 2 Low fixture gaps, fixed:

| # | Sev | Issue | Resolution |
|---|---|---|---|
| 1 | Low | Two-line quoted fixture had its ` #` on the header line, so a per-line reset gave the same result | ` #` moved to the continuation line inside the open quote (§5) |
| 2 | Low | YAML-escape fixture was ambiguous and could not fail | Replaced by a FAIL (`"echo \" # x\" && npm install"`) and a PASS (`"echo a\\" # && npm install`), written with `String.raw`, each paired with its mutation (§5) |

### Round 8 (same reviewer) — **APPROVED — no issues found.**
Both round-7 fixture fixes confirmed applied exactly; each fixture fails under its paired mutation.

---

## 10. Implementation log (2026-10-02)

**Status:** IMPLEMENTED, line-audited (3 parallel auditors, then a re-audit of the fixes), live-tested.

- **Item 1** — `test/support/real-redis.ts` (`needRedis`, reads the flag at call time) used by both real-Redis specs; `real-redis-helper.spec.ts` (4). Before: Redis down + `REQUIRE_REDIS_TESTS=1` → throttler spec **7 passed** (testing nothing). After: **12 failed** across both specs; no flag → skipped.
- **Item 2** — docs only (runbook archive block, CLAUDE.md, handoff, chat-stream docblock). `redis.service.ts` unchanged.
- **Items 3+4** — `load-test/ops-report.mjs` (pure) + `ops.mjs` (fetch/print only) + `ops-report.spec.ts` (38). Line-for-line parity with the old output proven on two fixtures captured from the pre-change script.
- **Item 5** — docblock + runbook rows re-derived and verified by an auditor against the code.
- **Item 6** — guard rewritten per §5, then hardened by the line audit (YAML line folding, `>` more-indented lines, comment-only `run:` header, `|2` indicators, `!tag`/`&anchor`, JSON-style flow pairs, multi-line shell strings, comment-before-continuation, `+=`, `${x:-y}` reads, quote-aware segments, `( … )`/`if`/`!` prefixes, `rm`/`del`/abbreviated config writes, `update` and camelCase install aliases), then by the re-audit (tag/anchor before a block marker, block-scalar content indent from the indicator or first line, heredoc bodies copied verbatim, `test`/`--` as script runners, config verb = first non-option word after `config`/`pkg`, `dedupe`/`prune`/`uninstall`/`update` abbreviations, quoted `run` key). Spec 46 → **133**; every audit-driven fixture FAILS on the guard version before its fix.
- **Item 7** — comment.

**Line audit (round 1):** 3 Medium + ~25 Low, all fixed. The Mediums: YAML blank-line folding (a regression vs HEAD in two cases); the ARMED headline was never asserted (an armed fleet could print green and pass every test); README overstated what 🟢 proves → green now REQUIRES every replica to be confirmed by a built client, else 🟡 NOT CONFIRMED.

**Re-audit of the fixes:** 1 Medium + 9 Low, no regression vs HEAD in detection. Medium: `run: &anchor |` read as a plain scalar (a comment line could hide an install). Three new false positives from round 1 (heredoc apostrophe, a less-indented trailing comment under a folded scalar, `npm test -- …`) — all fixed. Out of scope and now documented as limits: escaped line breaks in double-quoted scalars, flow-mapping steps, quotes nested in `$( … )`/backticks.

**Mutation testing:** guard 32/32 caught (24 + 8 for the re-audit fixes); ops-report 18/18; helper 1/1.

**Verification:** API jest `REQUIRE_REDIS_TESTS=1` — 147 suites, **2764 passed**, 5 skipped, 0 failed (was 2635; +129). API tsc clean. `turbo run lint --force` 5/5, 0 cached. All three guards ✓. `git diff --check` clean.

**Live test** (two local API processes as Railway replicas, distinct `RAILWAY_REPLICA_ID`, `REPLICA_COUNT=2`, behind a round-robin proxy):

| Scenario | Result |
|---|---|
| both healthy | 🟢 NOT ARMED, auto-sampling stopped at 2 samples (2 of 2) |
| LB never routes to B | 🟡 INCONCLUSIVE after exactly 20 samples (old script: 🟢 after 1) |
| B armed | 🟠 PARTIALLY ARMED (old script: ARMED — would have passed arm time) |
| one AI call on armed B (browser) | counters `started 3 / noResponse 3 / responses 0` → 🔴 "every call (3) got NO HTTP response" |
| both armed | 🟠 ARMED on all 2 |
| teardown, `--samples 4` | 🟢 NOT ARMED, exactly 4 samples |

Browser (in-app): `GET /api/admin/ops` through the proxy with the signed-in admin's session alternated replica-A / replica-B, B showing the override and mock base URL. Side effects: one dev-DB fortune snapshot for 2026-10-25 marked as an AI failure (next fetch retries); ~6 dev-Clerk sessions minted for the admin by `ops.mjs`.
