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
| `AI-CALL` log lines | Per-call route, tokens, cost, outcome, duration | **Authoritative.** One JSON line per call, including failures. |
| `/admin/ai-costs` | Historical cost by type/provider | ⚠️ **Was unreliable.** Blind to streaming until #19, and polluted by 1,383 load-test rows until #17 is run against prod. Cross-check against the two above. |

⚠️ `pools` is **per-replica**; every other section is fleet-wide. Multiply by
`replicas` for the fleet ceiling.

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
   under-report for the rest of the day. Reconcile from `AI-CALL` lines.

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

⚠️ **Re-measure the per-reading cost before using it.** The last measurement
($0.312474, 2026-09-02) was taken while aborted streams reported ZERO output
tokens (#20). That is fixed, so treat the old figure as a **floor**, not the
number.

Measure from `AI-CALL` lines, not `/admin/ai-costs`.
