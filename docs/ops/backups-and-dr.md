# Backups, DR, and the launch drills

⚠️ **Status: this document is a GAP ANALYSIS, not a description of a working
DR posture.** Everything marked ⬜ is unverified — it needs someone with the
Railway console to confirm, because it cannot be established from the repo.
Treat an unverified backup as no backup.

## What we would lose

| Store | Contains | Reconstructible? |
|---|---|---|
| **Postgres** | Users, birth profiles, readings + their AI narratives, credit ledger, transactions, subscriptions, chat | **No.** The AI narratives cost real money to produce and are not deterministic — regenerating is neither free nor identical. The credit ledger is the record of what people paid. |
| **Redis** | Spend counters, quota, rate limits, locks, caches | **Yes, and losing it is survivable.** Counters restart at zero (spend under-reports for the rest of the day), caches refill. ⚠️ It is NOT a backup concern; it IS an availability one — see `breaker_unavailable` in the runbook. |
| **Artifacts** | Mascot images (served by the API) | Yes, they are in the repo. |

So DR is really one question: **can we restore Postgres, and how much would we
lose?**

## Open items

| | Item | Why it matters |
|---|---|---|
| ⬜ | Confirm Railway Postgres backups are **enabled**, and their frequency | Determines RPO. Railway's plans differ; do not assume. |
| ⬜ | Record the retention window | A backup you cannot reach back to is not cover for a bug found a week later. |
| ⬜ | **Perform one restore** into a scratch database | An untested backup is a hypothesis. This is the single highest-value item here. |
| ⬜ | Write down measured RTO from that restore | "How long are we down" is otherwise a guess. |
| ⬜ | Decide and document RPO/RTO targets | Without targets there is no way to say the posture is adequate. |
| ⬜ | Confirm whether `DATABASE_URL` rotation would break the deploy | The Dockerfile CMD runs `prisma migrate deploy` before boot. |

⚠️ **Migrations are the most likely cause of a data incident, and they are
safer here than they look**: `docker/Dockerfile.api`'s CMD is
`prisma migrate deploy && node …`, so a failed migration means no app — if the
API is serving, the migrations ran. That holds only while the builder is that
Dockerfile. There is no `railway.json` pinning it, so a switch to Nixpacks would
silently skip migrations AND unset `NODE_ENV`.

## Chaos drills

Not theatre — each of these has a specific control it is checking, and two have
already found real bugs.

| Drill | Checks | Status |
|---|---|---|
| **Spend breaker** — lower `AI_DAILY_SPEND_LIMIT_USD` below one reading's cost + a bit, generate readings | `threshold_80` and `cap_tripped` both reach a human; refusal is graceful | ✅ **Run 2026-09-02.** Both emails arrived. ⚠️ Found #21: the refusal charged 3 credits and delivered nothing. |
| **Deploy drain** — deploy while a reading is streaming | SIGTERM reaches Node, readiness 503s, the stream finishes or persists | ✅ Verified during M6. ⚠️ Found the missing `exec` in the Dockerfile CMD. |
| **Redis down** — stop Redis briefly | `breaker_unavailable` fires; `/health/ready` 503s; **spend is uncapped meanwhile** | ⬜ Not run. This is the one that proves the fail-OPEN path is visible. |
| **Engine down** — stop the Python engine | Readiness stays 200 (engine is advisory), readings fail cleanly without charging | ⬜ Not run. |
| **Postgres restore** | The whole of DR above | ⬜ Not run. |
| **Provider outage** — point `LOADTEST_ANTHROPIC_BASE_URL` at a failing mock | Fallback chain, retries, refunds, and that failures leave `AI-CALL` lines | ⬜ Partially covered by the load test. |

⚠️ Restore `AI_DAILY_SPEND_LIMIT_USD` after any breaker drill. Readings stay
refused until you do.

## The ⭐ pre-launch items

| | Item | Note |
|---|---|---|
| ⬜ | Lower the self-imposed **Anthropic console** spend limit from $200,000 | This is the backstop when our own breaker fails open. $200,000 is not a backstop. Size it at a small multiple of a bad month, not of a good one. |
| ⬜ | Raise auto-reload **only** once S2 is verified | Auto-reload plus an unverified breaker is an unbounded bill. |
| ⬜ | **Retire prod-as-test** | See below. |

### Retiring prod-as-test

Production currently doubles as the test environment because there are zero real
users. That is a reasonable trade today and an unacceptable one the moment it
stops being true.

**The cutover is not a date, it is an event: the first real user.** At that
point load tests, breaker drills, and cap changes stop being free, and every
drill in the table above needs a staging target or a maintenance window.

⚠️ The load test in particular leaves fabricated readings **cached by birth-data
hash** and usage rows in `ai_usage_log`. Its teardown is
`seed-users.mjs --cleanup` plus `purge-usage-log.mjs` — both must run, and the
second one was missing entirely on the first go.
