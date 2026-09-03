# L6 — tuning report

Phase 3 load test, run against **production** on 2026-08-30/31 with a mock
Anthropic upstream. Written from measurements; every number below is either
observed or derived from observed numbers, and the derivations are shown.

---

## The headline: the spend cap is the binding constraint, not the pools

```
reading pool (fleet)      : 24 slots        (AI_READING_POOL 12 x REPLICA_COUNT 2)
slot-seconds per reading  : 80              (call1 + call2 in PARALLEL, ~40s each)
pool-sustainable rate     : 0.30/s = 18/min = 1,080/hr

daily spend cap           : $50 / $0.303624 = 165 readings per DAY
pool burns that cap in    : 9.1 minutes at full utilisation
```

**The pool can spend the entire daily AI budget in about nine minutes.** Raising
`AI_READING_POOL` without raising `AI_DAILY_SPEND_LIMIT_USD` changes nothing —
the breaker trips first, by a factor of ~157 on a daily basis.

So the tuning order is fixed, and it is not the order Phase 3 assumed:

1. Decide the **daily spend budget** from expected reading volume x $0.303624.
2. Size the **pool** so that peak concurrency fits within that budget's burn rate.
3. Only then revisit the **timeout**.

Doing (2) before (1) is sizing a pipe to a tank you have not measured.

---

## Verified results

### S5 — correctness under concurrency. PASS.

Ten identical concurrent `POST /api/bazi/readings` for one fresh chart:
**9 got `409` in 0s** (the dedup lock, failing fast rather than queueing),
**1 got `201` in 65s**, credits `50 -> 47`. Exactly one reading, exactly one
charge.

This is the "can we double-charge a customer" question answered with evidence,
and it is the single most valuable result in Phase 3.

### S1 — browse baseline at 100 VUs. PASS.

20,870 requests, 114 req/s, **p95 306ms**, **p99 477ms**, 0 server errors,
0 throttled.

### S2 — the realistic mix at 100 VUs, with AI actually generating. PASS.

| metric | value | threshold |
|---|---|---|
| `ai_generations` | **248** (0.59/s) | >50 |
| `ai_turn_duration` | med 15.3s, p90 54.0s, p95 55.1s, **max 60.0s** | — |
| `ai_busy` (shed) | 0.23% (35) | <5% |
| `server_errors` | 0.17% (26) | <0.5% |
| `spend_capped` | 0% | — |
| `throttled` | 8.27% (1,241) | <10% |
| browse p95 / p99 | **260ms / 431ms** | <400 / <1000 |
| SSE first byte p95 | 265ms | <1500 |

15,164 requests at 36 req/s — throughput lower than S1 because VUs block on
40-90s AI calls, which is the expected shape.

**The substrate is not the constraint.** Browse latency was *better* under AI
load (260ms p95) than in the AI-free runs, because concurrency shifted from
cheap reads to blocked AI calls.

---

## Pool sizing

At the mock's 40s/call, demand averaged **~25 concurrent against 24 slots** and
the governor shed **0.23%**. The pool is sized correctly *for a 40s upstream at
this arrival rate* — near the knee, with almost no waste and almost no shedding.

⚠️ **But 40s is a configured constant, not production latency.** A real
LIFETIME reading measured **70.5s and 90.4s end-to-end** for the whole POST
(Python engine + pre-analysis + both AI calls). The AI slice is under 60s — it
must be, since `AI_CALL_TIMEOUT_MS` is 60000 and real readings succeed — but it
was not isolated.

**Before sizing the pool, measure the AI slice.** The `AI-CALL` log lines carry
`durationMs`; one real reading yields both calls. If real per-call latency is
meaningfully above 40s, the slot-seconds per reading rise proportionally and the
sustainable rate falls by the same factor.

---

## The timeout, and why raising it is the wrong first move

`AI_CALL_TIMEOUT_MS` defaults to **60000** and is measured from when the call is
*issued* — which includes waiting for a pool slot, not just the upstream. With a
40s upstream that leaves ~20s of queue tolerance. At ~25 concurrent against 24
slots, **26 calls exhausted it** and became `AI_CALL_FAILED` 503s (the 0.17%
`server_errors`, and the reason `max ai_turn` is exactly 60.000s).

Raising the number treats the symptom. The real problem is the **failure mode**:

- What should happen when we are too busy: `AI_BUSY`, fast, no charge, "retry
  shortly".
- What actually happens: accept the request, queue it, and turn it into a failed
  reading plus a refund a minute later.

Same load, much worse experience, and it reads as an outage in the metrics
rather than as backpressure.

**Recommendation:** bound queue wait separately from upstream time — either
start the timeout clock after slot acquisition, or reject at admission when the
queue is deeper than the budget allows. Do not simply raise 60000.

⚠️ Note that `AI_BUSY` shedding stayed at 0.23% precisely *because* the pool
queues rather than rejects. The 26 timeouts are what queueing looks like when it
overruns.

---

## Spend

Real cost, measured 2026-08-28 on production: **$0.303624 per LIFETIME reading**
(two calls, ~44,000 input tokens total). The `AI-CALL` lines reconciled exactly
with `dayUsd`, so the ledger is accurate.

⚠️ **Do not read `dayUsd` while the mock is armed.** `MOCK_USAGE_SCALE=0.01`
scales fabricated usage by 100x, so a mock-armed reading records ~$0.003. A
reading of $0.013824 was flagged mid-session as a possible ledger under-count;
it was 4.55 scaled readings, exactly as configured. The two numbers are in
different units.

**Prompt caching is measured but not implemented** (see the deferred finding in
the session handoff): 71% of every reading's input is a byte-identical static
system prompt that is not cached. ~10% saving guaranteed, up to ~28% under
traffic. That directly raises the readings-per-dollar in the headline table, so
it belongs in the same decision as the spend budget.

---

## What is NOT measured, and should not be inferred from this report

- **Real per-call AI latency.** Only whole-POST wall clock (70.5s, 90.4s). The
  pool arithmetic uses the mock's 40s.
- **Attribution of the 248 generations.** `ai_generations` counts any call
  >=5s — reading POSTs, reading streams and chat turns together. It proves AI
  work happened at scale; it does not break down by surface.
- **Sustained load beyond 6.5 minutes.** No soak. Connection-pool exhaustion,
  memory growth and Redis key growth are unobserved.
- **The breaker tripping under load.** `spend_capped` was 0% throughout, by
  design (`MOCK_USAGE_SCALE=0.01`). Proving the breaker deserves its own short
  run at scale 1.
- **Fortune and chat at generation volume.** Fortune is cached per
  (profile, date) and free users only get today, so each user can generate
  exactly once; chat needed a paid extension per session. Both were exercised
  for correctness, not for capacity.

---

## The structural finding worth carrying past Phase 3

**AI load scales with DISTINCT work, not with request volume.** Readings are
cached by birth-data hash and fortune by (profile, date), so replaying traffic
against a fixed set of charts measures the cache, not the model.

Run 4 issued ~775 reading requests and reached the model **once**. The fix was
to generate a novel chart per iteration — which is also the faithful model,
since in production each reading really is a distinct customer.

The practical consequence for capacity planning: **forecast AI cost and
concurrency from new-chart volume, not from page views or request rates.**

---

## Recommendations, in order

1. **Set `AI_DAILY_SPEND_LIMIT_USD` deliberately.** At $50 the system supports
   165 readings/day. Derive the real number from expected volume x $0.303624 and
   an acceptable daily ceiling. This gates everything else.
2. **Measure real per-call AI latency** from `AI-CALL` `durationMs`, then
   recompute the slot-seconds row in the headline table.
3. **Fix the timeout's failure mode** — separate queue wait from upstream time
   so overload sheds as `AI_BUSY` instead of failing paid readings.
4. **Implement prompt caching** before raising the spend budget; it changes the
   readings-per-dollar the budget is derived from.
5. **Leave the pool at 12/replica for now.** It is correctly sized at the
   measured arrival rate and is not the binding constraint. Revisit after (1)
   and (2).
6. **Run the breaker drill** — one short run at `MOCK_USAGE_SCALE=1` to confirm
   `AI_SPEND_CAP` behaves under concurrency, since that guard is what enforces
   recommendation (1).

---

## Method note — why four runs were discarded

Four S2 runs reported all five thresholds green while generating **no AI work at
all**. Every threshold in `L5_THRESHOLDS` passes on a run that never calls the
model, because not doing work is fast.

The causes were: a mock that understood only one of two section-key formats; a
reading arm that never drove generation; a chat arm sending an invalid field
(masked by the throttler running *before* the validation pipe); measuring the
cheap hop instead of the expensive one; replaying cached charts; and finally a
mock whose non-streaming branch — the branch the reading pipeline actually uses
— had no pacing at all, making every expensive call free.

`ai_generations` (`count>50`) exists because of this. Run 5 was the first run to
**fail**, correctly, at `count=0`. Any future capacity claim from this harness
should be checked against that metric first; the rest of the summary is
meaningless without it.
