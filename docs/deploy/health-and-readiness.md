# Health endpoints (M7)

Two endpoints, deliberately different. Neither carries a global `/api` prefix —
health lives at the root, as it always has.

| Route | Question | Cost | Point a platform healthcheck here? |
|---|---|---|---|
| `GET /health` | Is the process up? | none — static object | no |
| `GET /health/ready` | Is this instance fit to take traffic? | one DB query + one Redis `PING` + one engine probe, memoised 1s | **yes** |
| `GET /health/detailed` | Everything, with latencies (admin only) | same, uncached, authed | no |

## Wiring Railway

On the **API** service: set the healthcheck path to `/health/ready`.

⚠️ **Know what that actually buys.** Railway runs the healthcheck to decide when
a *new deployment* is ready to receive traffic — it gates the switchover. Treat
"induced Redis outage → the instance restarts itself" as **unverified** until
someone confirms it against the dashboard; what is verified is the endpoint's
own behaviour (below). The useful, certain property is that a deploy will not go
live while Postgres or Redis is unreachable.

## What makes it not-ready

Postgres and Redis are **required**; the Bazi engine is **advisory**.

The engine backs a handful of routes and the rest of the API is fully useful
without it, so an engine outage reports `status: "degraded"` and still answers
**200**. Failing readiness there would take the whole instance out over a
partial loss.

Redis being required is the arguable one, and the reason is a coupling worth
knowing: `RedisThrottlerStorage` **fails open**, so during a Redis outage there
is no rate limiting at all. Under a denial-of-wallet threat model an instance
that cannot throttle is not one we want serving, so out-of-rotation beats
serving unmetered. Revisit if Redis ever gets flaky enough that the cure costs
more than the disease.

## Verified behaviour

Run against a real boot, not reasoned about:

| Condition | `/health` | `/health/ready` |
|---|---|---|
| all dependencies up | 200 | 200 · `ready` |
| engine down | 200 | **200** · `degraded` · `ready: true` |
| Redis unreachable | **200** | **503** · `not_ready`, naming redis, plus a WARN log |

Liveness staying 200 during a dependency outage is the point: restarting the
process cannot reach Postgres, and a liveness probe that fails on someone else's
outage is a restart loop.

## Two things not to break

**The engine hop must stay keyed.** It goes through `engineFetch` with
`caller: 'health.probe'`. On a continuously-polled endpoint an *unkeyed* probe
would keep B3-a's unkeyed counter climbing forever, so `scripts/b3b-preflight.mjs`
could never say GO and `ENGINE_REQUIRE_KEY` could never be flipped. The CI guard
(`scripts/check-engine-callers.mjs`) enforces the helper; nothing enforces the
`caller` string, so do not rename it casually.

**The 1-second memo is a cost control, not an optimisation.** `/health/ready` is
public, unauthenticated and `@SkipThrottle()`d — it has to be, or the platform
cannot poll it — and it issues a database query. Without the memo plus the
in-flight dedupe it is a free amplifier: one cheap HTTP request per Postgres
round-trip, from anyone.
