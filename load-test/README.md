# Phase 3 — load test

Everything here exists only for load testing. **None of it ships to users, and
the one piece that touches production code (`LOADTEST_ANTHROPIC_BASE_URL`) is inert
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
LOADTEST_ANTHROPIC_BASE_URL=http://127.0.0.1:8080 npm run dev:api
```

Deploying to Railway as a temporary service:

1. New service from this repo, `RAILWAY_DOCKERFILE_PATH=load-test/mock-anthropic/Dockerfile`.
2. **Private networking only — do not give it a public domain.** It answers to
   any caller and fabricates readings.
3. On the **API** service set `LOADTEST_ANTHROPIC_BASE_URL=http://<mock>.railway.internal:8080`.
4. **Strip `OPENAI_API_KEY` and `GEMINI_API_KEY`** for the window. Providers are
   key-gated at registration (`ai.service.ts`), so removing the keys removes the
   fallback chain entirely — a mock failure then fails the reading instead of
   quietly falling back to a real paid provider.

### ⚠️ Two names, and only one of them is ours

`LOADTEST_ANTHROPIC_BASE_URL` is the app's switch. **`ANTHROPIC_BASE_URL` is
not** — it is a conventional name other tooling sets (Claude Code exports it),
and the app deliberately ignores it.

But **the Anthropic SDK reads `ANTHROPIC_BASE_URL` itself**, so setting it still
redirects every call — through the SDK rather than through us, with our own
`aiBaseUrlOverride` reporting `null` the whole time. That is why
`GET /api/admin/ops` also reports **`aiBaseUrlEffective`**, the resolved
`client.baseURL`.

**During an incident, read `aiBaseUrlEffective`.** It is the value the SDK will
actually use, whoever set it. `aiBaseUrlOverride` only answers "did WE do this?"

### Teardown — the step that actually matters

**Unset `LOADTEST_ANTHROPIC_BASE_URL` before the mock service is deleted.** In that order.
A stale override pointing at a deleted service makes every reading fail in a way
that looks exactly like an Anthropic outage, and nothing else about the app
looks wrong.

Confirm teardown with `GET /api/admin/ops`: **`aiBaseUrlOverride` must be `null`
AND `aiBaseUrlEffective` must point at `api.anthropic.com`.** Checking only the
first would miss a redirect set through the SDK's own variable.

## L3 — auth for k6

Clerk session JWTs live 60 seconds, which is shorter than any scenario. The
plan offered a raised-lifetime JWT template on the dev instance, or a sidecar
refreshing every minute. **Neither is needed, and the first cannot work**: L2
runs the test against PRODUCTION, and a dev-instance token cannot authenticate
against prod (different issuer, different JWKS).

### ⚠️ `sessions.createSession()` is DEVELOPMENT-ONLY

The obvious approach — `createSession` then `getToken(id, undefined, ttl)` —
works perfectly against a dev instance and fails on production with:

```
request_invalid_for_environment
"Request only valid for development instances."
```

Found by running the seeder against production with 3 users after it had passed
against dev. **No amount of local testing finds this**, because local is exactly
the instance where it works. It is the whole argument for trialling with 3.

### What works — the browser's own flow, over plain HTTP

1. `signInTokens.createSignInToken({ userId })` → a ticket. Production-safe.
2. `POST https://{fapi}/v1/client/sign_ins?_is_native=1` with `strategy=ticket`.
   **`_is_native=1` is load-bearing**: it returns the session token in the BODY
   instead of setting a browser cookie, which is what makes this scriptable.
3. `sessions.getToken(sessionId, undefined, ttl)` to extend — step 2 alone
   yields a **60-second** token, the very problem this section exists to solve.

Step 3 is a different endpoint from `createSession` and is expected to be
production-safe, but that is not yet confirmed against a live instance. If it
fails the scripts DEGRADE to the 60s token and warn; k6 must then refresh
mid-run.

The Frontend API host comes from `--fapi`, or is decoded from
`CLERK_PUBLISHABLE_KEY`. **Production is `clerk.tianmingapp.com`.**

```bash
export CLERK_SECRET_KEY=sk_live_...      # in YOUR shell. Never paste it elsewhere.
node load-test/mint-tokens.mjs --match 'loadtest+' --ttl 4200 \
     --fapi clerk.tianmingapp.com \
     --verify https://bazi-app-production-5e54.up.railway.app
```

Writes `load-test/tokens.json` (0600, gitignored).

### ⚠️ Two measured facts that change how you handle these

1. **Revoking the session does NOT invalidate a token already minted from it.**
   Verified: mint → revoke → wait → the same `verifyToken` call the guard makes
   still ACCEPTS. The guard checks signature and expiry and makes no network
   call to test revocation. So "revoke afterwards" is a comfort, not a control.
   **The only real control is a short `--ttl`** — long enough for the run, and
   no longer. Disposal is deleting the file and waiting for expiry.

2. **The minted token has no `azp` claim**, so Clerk's `authorizedParties`
   check short-circuits and passes. That is why these work against production
   with `CLERK_AUTHORIZED_PARTIES` set — and it is exactly the kind of thing
   that would otherwise be discovered at the start of a booked window.

The script refuses to mint when `--match` matches nothing, rather than falling
back to every user: a silent fallback would hand out live tokens for real
accounts.

## L4 — seeded test users

```bash
export CLERK_SECRET_KEY=sk_live_...
node load-test/seed-users.mjs --seed --count 100 --api https://<api-host>
node load-test/seed-users.mjs --status  --api https://<api-host>
node load-test/seed-users.mjs --cleanup --api https://<api-host>
```

100 distinct users, because M1 keys throttling per userId and S4 rations per
user per day — a hundred VUs on one account would measure our own rationing
rather than capacity.

Writes `seed-manifest.json` (0600, gitignored). Birth dates are spread through
the 1920s at 03:37 so a fabricated cached reading can never collide with a real
user's chart.

⚠️ Credit top-ups are paced at ~2.1s each: they all use the SAME admin token and
admin routes are throttled 30/min, so 100 users take ~3.5 minutes however fast
you ask.

⚠️ Seeded accounts are REAL users on the production Clerk instance and count
toward MAU until `--cleanup` runs.

### Cleanup goes through the app, not around it

`--cleanup` calls `DELETE /api/users/me` for each account. That runs
`erasePersonalData` — profiles, readings, chat, comparisons AND the
content-addressed `ReadingCache` rows the run fabricated — then deletes the
Clerk user. The 200 IS the receipt, because the erase is synchronous inside the
request.

**Three things found by running this that review had not:**

1. `GET /api/users/me` 404s for a fresh Clerk user — it does not auto-create.
   `createBirthProfile` is one of the six methods that call `ensureUser`, so
   the profile POST must come FIRST. The original order failed 3/3.
2. Deleting the Clerk user and trusting the `user.deleted` webhook to erase the
   database left **3 of 3 profiles behind** — the webhook never arrived. Hence
   the app-side delete.
3. Verifying the DB side by filtering admin rows on `email` always reported
   clean, because the `users` table **has no email column** — and
   `deleteAccount` anonymises the row rather than removing it, so "does the user
   exist" is not the question either.

Verified end to end against a real API and database: 3 seeded → 3 profiles in
the DB → cleanup → 0 profiles, 0 Clerk accounts.

## Env

| var | default | what |
|---|---|---|
| `MOCK_STREAM_MS` | 40000 | wall-clock per stream. Production LIFETIME is ~145s across two concurrent calls |
| `MOCK_TTFB_MS` | 400 | delay before the first event — feeds L5's "SSE first event p95 < 1.5s" |
| `MOCK_USAGE_SCALE` | 1 | multiplier on reported tokens. `0.01` keeps the S2 breaker out of the way |
| `MOCK_FAIL_RATE` | 0 | fraction answered `529 overloaded` — for the Q2 chaos drill |
| `MOCK_RL_REMAINING` | 2000000 | the rate-limit header value Ob1 will report |
