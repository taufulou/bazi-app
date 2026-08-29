# k6 scenarios

```bash
brew install k6                                   # once

# 1. seed + mint (see ../README.md)
node load-test/seed-users.mjs --seed --count 100 --fapi clerk.tianmingapp.com --api $API
node load-test/mint-tokens.mjs --match 'loadtest+' --ttl 14400 --fapi clerk.tianmingapp.com --verify $API

# 2. run, cheapest first
k6 run load-test/k6/s1-browse.js        # baseline — validates the harness
k6 run load-test/k6/s5-correctness.js   # 20 parallel identical creates -> exactly 1 charge
k6 run load-test/k6/s2-mix.js           # the one L6's numbers come from
```

`API_URL` overrides the target (defaults to the Railway API).

## Run S1 first, always

If the non-AI baseline cannot hold p95<400ms, nothing measured in S2 means
anything — the AI numbers would be sitting on top of a slow substrate and you
would tune the wrong thing.

## Three outcomes that look like failures and are not

| result | meaning |
|---|---|
| `429` | the throttler or a daily quota. S4 rations readings at 20/user/day; a long run WILL hit it |
| `503 AI_BUSY` **under 5%** | S1's governor shedding, which is its job. Over 5% it IS a finding — over-throttling is a failure mode too |
| `503 AI_SPEND_CAP` | the S2 breaker. The mock's fabricated usage drives the REAL ledger |

`lib.js` gives each its own metric (`throttled`, `ai_busy`, `spend_capped`) so
they never get folded into `server_errors`. Conflating them is how a load test
concludes the wrong thing about a system that was working.

## ⚠️ Set MOCK_USAGE_SCALE deliberately

At `1` with production-shaped usage the spend breaker trips after ~165 readings
and every request afterwards is a legitimate 503 — which destroys the `5xx<0.5%`
criterion and every number that follows. Run the main scenarios at `0.01`, and
prove the breaker in its own short run.

## Tokens expire

`--ttl 14400` gives four hours. If a run outlives it, every request 401s
mid-scenario and the results are junk. Re-mint between long runs.
