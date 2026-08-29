# Phase 3 — load test

Everything here exists only for load testing. **None of it ships to users, and
the one piece that touches production code (`ANTHROPIC_BASE_URL`) is inert
unless the variable is set.**

## What is here

| path | what |
|---|---|
| `mock-anthropic/server.mjs` | a stand-in for the Anthropic Messages API — real SSE shape, real usage payloads, configurable pacing |
| `mock-anthropic/Dockerfile` | deploys it as a temporary Railway service |

## Why the mock has to be faithful

A load test against the real API costs ~$0.30 a reading and measures
Anthropic's concurrency rather than ours. But a *lazy* mock is worse than no
mock: if it streams filler instead of well-formed section JSON, every reading
DEGRADES, the refund path fires, and the run measures the error path at 100 VU
while producing numbers that look perfectly plausible.

So the mock reads the section keys out of the prompt it was sent and echoes
back a valid object for exactly those keys — which also means it works
unchanged for CAREER, LOVE, ANNUAL and COMPATIBILITY without per-type config.

Verified against the real `@anthropic-ai/sdk`: cumulative `output_tokens`,
`input_tokens` on `message_start`, parseable JSON, and the
`anthropic-ratelimit-*` headers Ob1's fetch wrapper reads.

## ⚠️ The mock's fake tokens drive REAL spend accounting

`AiSpendService` prices whatever usage it is told and moves the real Redis
counters. At the default `AI_DAILY_SPEND_LIMIT_USD=50` and production-shaped
usage (~$0.30/reading), the S2 breaker trips after **~165 readings** — and every
request after that returns a legitimate `AI_SPEND_CAP` 503.

That will look like a load failure while actually being the guard working. It
also wrecks L5's `5xx < 0.5%` criterion. Decide which you are measuring:

| goal | setting |
|---|---|
| headroom under load (the main scenarios) | raise `AI_DAILY_SPEND_LIMIT_USD` for the window, or set `MOCK_USAGE_SCALE=0.01` |
| prove the breaker trips under load (worth doing once) | leave the cap at 50 and expect `AI_SPEND_CAP` — that is a PASS, not a failure |

Whichever you choose, **restore the cap afterwards** and confirm via
`GET /api/admin/ops` → `spend.dayLimitUsd`.

## Run-book

```bash
# local smoke
MOCK_STREAM_MS=3000 node load-test/mock-anthropic/server.mjs
ANTHROPIC_BASE_URL=http://127.0.0.1:8080 npm run dev:api
```

Deploying to Railway as a temporary service:

1. New service from this repo, `RAILWAY_DOCKERFILE_PATH=load-test/mock-anthropic/Dockerfile`.
2. **Private networking only — do not give it a public domain.** It answers to
   any caller and fabricates readings.
3. On the **API** service set `ANTHROPIC_BASE_URL=http://<mock>.railway.internal:8080`.
4. **Strip `OPENAI_API_KEY` and `GEMINI_API_KEY`** for the window. Providers are
   key-gated at registration (`ai.service.ts`), so removing the keys removes the
   fallback chain entirely — a mock failure then fails the reading instead of
   quietly falling back to a real paid provider.

### Teardown — the step that actually matters

**Unset `ANTHROPIC_BASE_URL` before the mock service is deleted.** In that order.
A stale override pointing at a deleted service makes every reading fail in a way
that looks exactly like an Anthropic outage, and nothing else about the app
looks wrong.

Confirm teardown with `GET /api/admin/ops` → **`aiBaseUrlOverride` must be
`null`**. That field exists for this moment.

## Env

| var | default | what |
|---|---|---|
| `MOCK_STREAM_MS` | 40000 | wall-clock per stream. Production LIFETIME is ~145s across two concurrent calls |
| `MOCK_TTFB_MS` | 400 | delay before the first event — feeds L5's "SSE first event p95 < 1.5s" |
| `MOCK_USAGE_SCALE` | 1 | multiplier on reported tokens. `0.01` keeps the S2 breaker out of the way |
| `MOCK_FAIL_RATE` | 0 | fraction answered `529 overloaded` — for the Q2 chaos drill |
| `MOCK_RL_REMAINING` | 2000000 | the rate-limit header value Ob1 will report |
