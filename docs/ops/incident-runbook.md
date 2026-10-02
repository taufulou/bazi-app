# Incident runbook

What to do when something pages you. Every instrument named here exists — field
names are from `GET /api/admin/ops`, log prefixes are greppable in Railway, and
the alert names are exactly what Sentry sends.

> ⚠️ **Read `alerting` in the ops snapshot first, once, before trusting any of
> this.** Every spend alert is a `Sentry.captureMessage`, and `Sentry.init()`
> runs only `if (process.env.SENTRY_DSN)`. With no DSN they are silent no-ops —
> the early-warning system fully built and fully disconnected, which is the
> worst shape a control can have because an audit passes it. `alerting.warnings`
> is empty only when events are genuinely deliverable.

## The three instruments

| | What it answers | Trust |
|---|---|---|
| `GET /api/admin/ops` | Live spend, breaker state, pool occupancy, quota, replica count, alerting status | **Authoritative.** Reads the same Redis counters the breaker reads. |
| `AI-CALL` log lines | Per-call route, tokens (incl. prompt-cache `cacheReadTok` / `cacheWriteTok` / `cacheW5mTok`), cost, outcome, duration | **Authoritative.** One JSON line per call, including failures. Reconcilable by hand — see "Reconciling an `AI-CALL` line" below. |
| `/admin/ai-costs` | Historical cost by READING type/provider | ⚠️ **Partial, by design and by accident.** Streamed readings were absent until #19. It is still polluted by 1,383 load-test rows until #17's purge is run against prod. And it has **never** included CHAT or FORTUNE — those call `aiSpend.record()` directly and write no `AIUsageLog` row, so their spend shows in `ops.spend` and the `AI-CALL` lines but not here. Since prompt caching (#6), a reading row's `input_tokens` is the UNCACHED remainder — input-token totals drop ~70% while cost drops ~10%; the cached part is shown beside it as "Prompt Cache Read/Write" (summary cards, reading-type and provider tables; `*PromptCache*Tokens` in the API), and "Total Tokens" excludes it. Cross-check against the two above; never size a budget from this page. |

⚠️ **Some sections describe ONE replica.** `instance` says which replica
answered. `pools`, `rateLimit`, `aiBaseUrlEffective`, `aiBaseUrlOverride` and
`alerting` are what THAT replica observed — multiply `pools` by `replicas` for the
fleet ceiling, and never read a `null` rate-limit gauge as a fact about the other
replica. `spend`, `breaker` and `quota` are fleet-wide (Redis-backed). To see each replica:
`node load-test/ops.mjs --api …` — it keeps sampling until every replica has answered
(`--samples N` takes exactly N instead).

---

## `ai.spend.cap_tripped` — the breaker is refusing paying customers

**Severity: high. Fails CLOSED, so it is safe — but customers are being told no.**

1. `GET /api/admin/ops` → `spend.dayUsd` / `spend.dayLimitUsd` / `spend.dayPct`.
2. Decide which of three it is:
   - **Legitimate demand.** Spend is real and the cap is simply too low for
     today. Raise `AI_DAILY_SPEND_LIMIT_USD` deliberately (see § Sizing) and
     redeploy. Do not raise it "just to clear the alert".
   - **A runaway.** `AI-CALL` lines show one route dominating, or retries
     looping. Grep `outcome!=ok` and `errorKind`. Leave the cap in place — it is
     doing its job — and fix the cause.
   - **A drill.** Someone lowered the cap to test. Restore it.
3. ⚠️ **A refusal must not leave a customer charged.** That was a real bug
   (#21): the streaming path charged before `_setupStream` refused. It is fixed
   with a pre-flight plus a refund backstop, but if you see complaints, check
   `CreditLedger` for a `self-refusal:` refund matching the reading.

**User-visible:** 「系統今日的 AI 用量已達上限，請稍後再試。」 Already-generated
readings still render — cached content bypasses the breaker by design.

---

## `ai.spend.breaker_unavailable` — ⚠️ THE SERIOUS ONE

**Fails OPEN. There is no spend control right now.**

The other two alerts mean a control fired. This one means Redis is unreadable,
the call was **ALLOWED**, and the only ceiling left is the Anthropic account
limit. It is the alert most often left off a rule, and the only one where spend
is genuinely uncapped.

1. Check Redis health in Railway. `GET /health/ready` returns 503 when Redis is
   down (it is a required dependency there, unlike the engine which is advisory).
2. While it persists, **the Anthropic console limit is your only backstop** —
   this is exactly why that number must be deliberate rather than $200,000.
3. Restore Redis. The counters are `INCRBYFLOAT` keyed by day/month, so a brief
   outage loses the increments that happened during it: `spend.dayUsd` will
   under-report for the rest of the day. Reconcile from `AI-CALL` lines (see
   "Reconciling an `AI-CALL` line" below).

---

## `ai.spend.threshold_80` — 80% of the day's budget

**Severity: warning. This is the alert that gives you time.**

⚠️ Fires only in the 80–100% window and **dedupes per process**, so N replicas
send N copies. Set the Sentry rule to notify on first occurrence, not a count.

Look at `spend.dayPct` and the hourly shape of `AI-CALL` lines. If the curve is
steep you have minutes, not hours, before `cap_tripped`.

---

## `ai.governor.busy` — the concurrency pool is full

**Severity: warning. Self-limiting and retryable.**

`acquire` refused after `QUEUE_TIMEOUT_MS` (15s `reading`, 3s `interactive`) and
returned `AI_BUSY`. Check `pools` for `inFlight`, `queued`, `peak`, `rejected`.

- Sustained rejections → the pool is too small for demand, **or** replicas were
  scaled without updating `REPLICA_COUNT`. ⚠️ The governor divides its limit by
  that variable; scaling without it silently doubles the real burn ceiling, and
  setting it too high throttles the fleet.
- A burst → expected backpressure. `AI_BUSY` is an honest, retryable refusal and
  costs nothing.

⚠️ Since #8 the abort timeout is armed **after** the slot is held, so queue wait
is no longer charged against the provider's budget. If you see streamed readings
failing at exactly the timeout under load, that regressed.

---

## A reading was charged but has no content

The invariant is **"the charge must follow the content."** Three controls
enforce it, and they cover different causes:

| Symptom | Control | Check |
|---|---|---|
| AI failed outright | inline path throws 503 `AI_CALL_FAILED`, nothing charged | no row exists |
| We refused (cap / quota / busy) | pre-flight above the charge, plus a refund backstop in `_setupStream` | `CreditLedger` for `self-refusal:` |
| Crash / deploy mid-stream | none fired — the row is recoverable | reopening it from 歷史分析記錄 re-streams |

⚠️ A **refunded** row keeps `creditsUsed` (that column is the refund amount and
the double-refund guard) and shows 已退款 in history. `creditsUsed > 0` alone
never means "still owed".

---

## Approaching Anthropic's rate limits

**Severity: depends on the trend. The goal is to see it BEFORE users get 429s.**

`rateLimit` in the ops snapshot is the latest `anthropic-ratelimit-*` header
reading THIS replica's Anthropic calls received (`outputTokensRemaining`,
`outputTokensReset`, `requestsRemaining`). The value is account-wide; the
observation is per replica — check `instance` and read it with the counters:

(Same table as the docblock in `apps/api/src/ai/anthropic-rate-limit.ts` and
`interpret` in `load-test/ops-report.mjs` — keep the three in sync.)

| What you see | Meaning |
|---|---|
| `requestsStarted == 0` | This replica has made no Anthropic call since `instance.startedAt`. `null` is expected — read the other replica (`ops.mjs` samples every replica). |
| `responsesSeen == 0`, MORE calls in flight than failed (in flight = `requestsStarted − responsesSeen − transportErrors`) | Nothing back **yet** — the first calls are still waiting for headers. Not a failure; read again in a few seconds. Any `transportErrors` so far show as a ⚠️ beside it. |
| `transportErrors > 0`, `responsesSeen == 0`, at least as many failed as are still in flight | 🔴 **Calls are getting no HTTP response at all** — network/DNS failure or a timeout before headers. Check `aiBaseUrlEffective` (a stale load-test mock URL looks exactly like this) and `AI-CALL` lines with `"outcome":"error"`. |
| `transportErrors > 0`, `responsesSeen > 0` | ⚠️ Some calls got no response. Often routine: the counter is cumulative since `instance.startedAt` and also counts chat client disconnects and shutdown aborts that land before headers, and SDK attempts later retried (`requestsStarted` counts attempts, retries included). Worry only if it climbs fast or tracks `requestsStarted`. |
| `observedAt` set, `outputTokensRemaining` set | Working. The reading is `now − observedAt` old; under load it is seconds old. |
| `observedAt` set, `outputTokensRemaining == null` | ⚠️ **Partial** — some rate-limit headers parse, but not the output-token ones, so `rlOutRemaining` on `AI-CALL` lines is blind. |
| `observedAt == null`, `okWithoutHeaders > 0` | 🔴 **Capture is broken** — successful responses arrive without the headers we parse. You are blind to approaching limits. |
| `observedAt == null`, `okWithoutHeaders == 0`, `responsesSeen > 0` | Only error responses so far (outage, bad key, edge 502) — see `lastResponseStatus`. Not a capture bug. |
| `okWithoutHeaders > 0` with `observedAt` set | ⚠️ The reading may be STALE: compare its age with `lastResponseAt`. |

- **The fleet-wide time series** is the `AI-CALL` log line: every call carries
  `rlOutRemaining` / `rlOutReset`, emitted by the process that made the call — so
  it has no replica ambiguity. Exclude periods when the load-test mock was armed
  (it sends the same header with a fake value).
- **Actual 429s** show as `AI-CALL … "outcome":"error","errorKind":"rate_limit"`.
- Levers: the spend cap and the governor pools throttle us before Anthropic does;
  raising the account's rate limit is an Anthropic-console action.

---

## `redis.lock.lost_before_release` — a lock was gone when its holder released it

**Severity: warning. The holder did NOT delete anyone else's lock (that is what
the ownership token prevents) — but while its lock was gone, the mutual
exclusion it provides was not in force.** Since todo #23 every Redis lock stores
a per-holder token and releases with a compare-and-delete; this event fires
when the compare missed. Two tags: `lockPrefix` (which lock — the id is
deliberately not sent; `other` means a lock whose prefix is missing from
`KNOWN_LOCK_PREFIXES` in `redis.service.ts` — the server log has the full key)
and `cause`. **Read `cause` first.**

### `cause=overran_ttl` — the work outlived the lock's TTL

The TTL for that `lockPrefix` is shorter than the work it guards. That is a code
defect: someone else may have taken the lock and run the same work concurrently.

| `lockPrefix` | What concurrency it allowed | Known? |
|---|---|---|
| `chat-session-stream` | a second chat stream on the same session | ⚠️ **Expected, todo #26.** The 150s TTL does not cover a cold chat-context build + a slow first token. **Archive it — see below the table.** Its event count is #26's measurement. |
| `reading:create` | a double-submit getting past the dedupe (a double charge) | Not expected (TTL 105s, derived since #27). The engine call cannot overrun — `AbortSignal.timeout` hard-caps it at 45s, no retry — and even full **Prisma pool exhaustion** stays under the TTL (45s engine + two connection waits ≤20s each + the charging transaction, bounded by Prisma's defaults at ~7s ≈ 92s). So suspect, in order: a **hung Redis command** (the lock body runs Redis commands, and this client has no `commandTimeout`) — `redis-cli --latency`, `redis-cli SLOWLOG GET 10`; a **slow-executing Postgres query** (`pool_timeout` bounds only the wait for a connection, and there is no `statement_timeout`) — check `pg_stat_activity` for long-running queries; then a stalled event loop. |
| `comparison:create` | a same-pair double-submit getting past the dedupe | Not expected (TTL 90s). The normal path is engine (≤30s) + one insert (≤20s connection wait) = 50s. Only the duplicate-pair (P2002) path — an extra `findFirst` + `update` — can reach 90s on connection waits alone, under full pool exhaustion. So check for a same-pair double-submit while the pool was saturated, a slow-executing Postgres query (`pg_stat_activity`), then a stalled event loop. |
| `stream:reading`, `ai:generate:comparison` | a second full AI generation on one row (double Anthropic spend) | Not expected (TTLs derived from the generation bound since #15). |
| `chat-extend` | a double extension (the user pays twice and gets both) | Not expected under normal load: a 30s TTL over short DB work. But under pool exhaustion each query can wait `pool_timeout` (20s), so two queries can outlive it — check pool saturation first, then a slow-executing query. |

**The known `chat-session-stream` / `overran_ttl` issue — archive it, do not
silence it in code.** The project's one Sentry alert rule emails on ANY event
(throttled to once an hour per issue), so this known, unfixed condition would
keep emailing. But #26 is waiting for exactly this count, so it stays in Sentry:

1. The FIRST event emails. In Sentry open that issue (tags
   `lockPrefix:chat-session-stream`, `cause:overran_ttl`) → **Archive → Until
   escalating**. Sentry keeps counting it (that count is #26's measurement) and
   alerts again only if it spikes. The fingerprint is
   `[event, lockPrefix, cause]`, so this masks no other issue.
2. **Check the archive once:** the next occurrence must raise that issue's event
   count WITHOUT an email.
3. Only if it still emails — fallback, easy to get wrong: in the rule's IF
   section add filters with match **"Any"** and two **"is not equal to"** tag
   filters (`lockPrefix` ≠ `chat-session-stream`, `cause` ≠ `overran_ttl`). The
   tempting "None of" + two "equals" filters would silence EVERY `overran_ttl`
   (including `reading:create`, the double-charge signal) and every
   `chat-session-stream` event. Then prove a tagless event still emails, with a
   REAL ingested event carrying a UNIQUE message (`sentry-cli send-event`, or a
   one-off `captureMessage`) — the rule editor's "Send Test Notification" button
   skips the IF filters, and an event on an issue that already alerted within the
   hour is throttled. The #7 spend drill counts only if the
   `ai.spend.threshold_80` issue has not alerted in the last hour. If you cannot
   prove it, remove the filter: the cost of no filter is at most one email an
   hour, only while the overrun happens. Never leave an unverified filter on the
   only alert rule. Note that under the filter a SPIKE no longer re-alerts (the
   event count still accrues) — the archive does not have that cost.
4. When #26 ships, **Resolve** the issue — and **remove the step-3 filter** if you
   added it, or a recurrence can never alert as a regression.

Do not archive any OTHER lost-lock issue this way.

### `cause=lost_early` — the key vanished before its TTL

Five causes; check in this order:

1. **Eviction** — Redis is `maxmemory 256mb` + `volatile-lru`, and lock keys carry
   a TTL, so they are eviction candidates. `redis-cli INFO stats | grep evicted_keys`
   (non-zero and growing ⇒ memory pressure).
2. **Redis restart** — `redis-cli INFO server | grep uptime_in_seconds` (small ⇒
   it restarted; every held lock was lost at once).
3. **A `FLUSHALL`** — e.g. the post-prompt-change step. Check who ran what; a
   burst of `lost_early` across prefixes at one moment is the signature.
4. **An old replica's bare `DEL` during the #23 rolling deploy** — an old-code
   replica overruns, a new replica acquires, the old one deletes it. Only in the
   window of that one deploy; check the deploy timeline. **Resolve** these issues
   once the window is over — never archive them — so a later recurrence alerts as
   a regression.
5. **A code bug** — a double release, or a release with the wrong key. If none of
   the above apply, read the release site for that `lockPrefix`.

---

## Deploys and shutdown

SIGTERM runs a drain: readiness 503s immediately, then in-flight streams get
`SHUTDOWN_STREAM_GRACE_MS` to finish, then they are aborted and given
`SHUTDOWN_POST_ABORT_GRACE_MS` to persist.

- Look for `Drain complete` in the log. Its absence means the drain was cut short.
- ⚠️ Liveness `/health` must keep returning 200 during a drain; only
  `/health/ready` 503s. A failing liveness invites the platform to SIGKILL
  mid-drain.
- ⚠️ Any new `CMD` that chains commands needs an explicit `exec`, or `sh` stays
  PID 1 and SIGTERM never reaches Node — every deploy then goes straight to
  SIGKILL, silently.

---

## Sizing the daily spend cap

The cap's job is **bounding a runaway**, not tracking demand. A cap near
expected volume trips on a good day and breaks the product for paying customers.

Rough guide: `expected peak readings/day × per-reading cost × 10`.

⚠️ **Re-measure the per-reading cost before using it.** $0.312474 (2026-09-02)
is PRE-caching and was taken while aborted streams reported ZERO output tokens
(#20). The 2026-09-28 measurement with prompt caching (#6), local stack against
real Anthropic: LIFETIME **$0.275** isolated and **$0.230** when a second
LIFETIME reading starts inside 5 minutes; CAREER $0.229, LOVE $0.253, ANNUAL
$0.243, COMPAT reveal $0.275. Re-measure from the first production readings.

Measure from `AI-CALL` lines, not `/admin/ai-costs`.

### Reconciling an `AI-CALL` line

Sonnet 4.5, USD per million tokens:

    inTok×3 + outTok×15 + cacheReadTok×0.30 + cacheW5mTok×3.75
      + (cacheWriteTok − cacheW5mTok)×6

`cacheWriteTok` is the TOTAL cache write; `cacheW5mTok` is the part the API
attributed to the 5-minute TTL; the rest is priced at the 1-hour rate (chat's
writes are all 1-hour). The sum of a period's lines should equal the change in
`ops.spend.dayUsd` to within ~1e-6 per call (Redis is incremented unrounded, the
line prints 6 decimals).

A healthy isolated reading is two lines: `…:call1` WRITES the prompt cache
(`cacheWriteTok ≈ prefix`, `cacheW5mTok == cacheWriteTok`) and `…:call2` READS
it (`cacheReadTok ≈ prefix`, `cacheWriteTok 0`). If both write, Call 2 did not
wait for Call 1 — look for a `gate cap=` warning. The rollback is
`AI_READING_PROMPT_CACHE=0` (config only; restores the pre-caching behaviour).
