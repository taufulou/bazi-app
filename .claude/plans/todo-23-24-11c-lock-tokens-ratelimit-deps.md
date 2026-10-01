# Plan — todo #23 + #24 + #11(c)

**Source:** `.claude/plans/launch-security-phase1-session-handoff.md` → `## ✅ THE TODO LIST`
(#23, #24, and #11 follow-up (c)). The home-directory copy is a superseded
mirror; these three entries are byte-identical in both.

**Status:** ✅ **IMPLEMENTED 2026-10-01 (uncommitted in the worktree; owner commits).**
Plan approved by the staff-engineer reviewer in round 4 (29 findings across 4
rounds, log at §9). Implementation then went through a 3-agent line audit plus a
re-audit of the fixes; every finding was fixed (§10). Verified: api jest 2635
passed (was 2510), web 424, tsc ×2 clean, turbo lint 5/5 (0 cached), 3 guards
green, all listed mutations red, a local run of the new CI Build job, and live
browser + Redis-MONITOR tests against two local API replicas.

**Shape:** one branch, one PR, **four commits**, each self-contained and
revertable on its own, each carrying ITS OWN doc changes (so reverting one never
leaves docs contradicting code):

| # | Commit | Why separate |
|---|---|---|
| C1 | `reading:create` / `comparison:create` lock TTLs ≥ the work they hold (§1) | Closes a **live double-charge window** on `main` today. Must not be reopened by reverting the token change for some unrelated reason. |
| C2 | Lock ownership tokens + lost-lock signal (todo #23, §2) | |
| C3 | Ops replica identity + rate-limit capture diagnostics (todo #24, §3) | |
| C4 | `lunar-typescript` declared in web; CI Build mirrors Docker installs (todo #11(c), §4) | |

Merging to `main` deploys (Railway, Wait for CI on). No migration, no new env
var, no cache-version bump, no prompt change.

---

## 0. What the three items are (verified against the code)

### #23 — `redis.acquireLock` has no ownership token

`RedisService.acquireLock` (`apps/api/src/redis/redis.service.ts:147`) does
`SET key '1' EX ttl NX`; `releaseLock` (`:156`) is a bare `DEL key`. Every holder
writes the same value, so a release cannot tell "my lock" from "someone else's".

The hazard:
1. A acquires `k` (TTL T); A's work runs longer than T.
2. `k` expires; B acquires `k` legitimately.
3. A finishes and runs `DEL k` → **deletes B's lock**.
4. C acquires `k` while B still works → mutual exclusion gone, cascading.

Same primitive also makes "safe renewal" impossible. Fix = random token as the
value + compare-and-delete in Lua.

**Corrections to the todo text:**

| Todo says | Code says |
|---|---|
| "all 5 call sites … fortune ×?" | **6 call sites, none in fortune.** `bazi.service.ts` ×4 (`reading:create:{userId}` :189, `stream:reading:{readingId}` :1241, `comparison:create:{userId}` :1901, `ai:generate:comparison:{id}` :2376) + `chat.service.ts:625` (`chat-extend:{sessionId}`) + `chat-stream.service.ts:250` (`chat-session-stream:{sessionId}`). Plus `RedisService.withLock` (:165) — **zero production callers**. |
| "#15's TTL fix removed the TRIGGER" | **Only for the two generation locks.** See the next two rows. |
| (not in todo) | **`reading:create` (30s) is a live double-charge window.** The reuse check (`:231`) runs BEFORE the engine call; the row is inserted in the `$transaction` AFTER it (`:609`); `BaziReading` has no unique constraint (only `@@index`). The engine call is 30s/**45s** (CAREER/LOVE, `:2693`) and the file itself says production engine time is ~30s (`:376`). So: A's lock expires mid-engine → a double-submit / refresh-and-resubmit B acquires → B's reuse check finds no row → **both insert and both charge**. Atomic `updateMany … credits:{gte}` only prevents overdraft, not a double charge. → C1. |
| (not in todo) | **`chat-session-stream` (150s) is not the bound CLAUDE.md says.** `timeout: 90_000` (`chat-stream.service.ts:662`) is a per-attempt SDK option and `fetchWithTimeout` clears its timer once HEADERS arrive (`node_modules/@anthropic-ai/sdk/client.js:334-364`), so it bounds time-to-headers, not the stream; the body is bounded only by the 60s *idle* watchdog. The chat client keeps the SDK default `maxRetries: 2`. And the chat context is built INSIDE the lock (`:452-488`) with 45–60s engine timeouts. The `:55` comment ("Hard ceiling for the entire stream duration") and CLAUDE.md's "no retry/fallback budget" are both wrong. An expired lock there allows a second concurrent stream on one session. → **not fixed here** (needs its own design: total deadline or renewal); comment corrected + new todo filed (§2.9). |

### #24 — `/api/admin/ops` → `rateLimit.*` read `null` right after a real streamed reading

`anthropic-rate-limit.ts` wraps the Anthropic client's `fetch` and keeps the
latest `anthropic-ratelimit-*` header values in a **module variable — per
process**. Production runs 2 API replicas behind Railway's LB. The todo asks:
replica locality (benign), or broken capture (blind until users see 429s)?

What the investigation found:
- **The todo's check is undecidable as written.** "Hit `/api/admin/ops` several
  times" needs to know which replica answered; **the ops response carries no
  replica identity**.
- **Three hypotheses, not two**, for the 2026-09-07 null: (a) the other replica
  answered; (b) that reading made no Anthropic call (cache/reuse hit) or the
  replica restarted in between; (c) capture is broken.
- **A strong per-process signal already exists:** every `AI-CALL` line carries
  `rlOutRemaining`/`rlOutReset` (`ai-spend.service.ts:548,563` →
  `ai-call-log.ts:240`), read by the process that made the call. Caveats: the
  snapshot is process-wide, so a number on a `stream:*` line may come from a
  sibling non-stream call (it proves capture works, not the streaming path
  specifically); and the load-test mock sends the same header
  (`load-test/mock-anthropic/server.mjs:261-263`), so lines from mock-armed
  periods prove nothing.
- **The streaming path's wiring is untested.** `test/anthropic-client.spec.ts`
  only drives `messages.create`. (SDK 0.73.0 routes `create` and `stream` through
  `this.fetch`, `client.js:361` — expected to work, never proven.)
- **"Every other section is fleet-wide" is wrong in THREE places:**
  `docs/ops/incident-runbook.md:22`, the `ops.service.ts` docblock table, and the
  `@ApiOperation` description at `admin.controller.ts:55-59`. `rateLimit` and
  `aiBaseUrlEffective` are per-replica observations (the VALUE is account-wide).

### #11(c) — `apps/web` imports `lunar-typescript` without declaring it

`apps/web/app/lib/lunar-utils.ts:10` imports it (used by `BirthDataForm`,
`PersonBirthFields`, `DualBirthDataForm`). It is declared in the **root**
`package.json` (added by `91d29e5` — an `npm install` at the root instead of
`-w web`) and in `apps/mobile`, **not** in `apps/web`.

- CI runs a bare `npm ci` (every workspace) → hoisting hides undeclared deps.
- `Dockerfile.web` installs `--workspace=web --workspace=@repo/shared
  --workspace=@repo/ui --include-workspace-root`; only the root entry keeps the
  production web build alive.
- The root entry looks orphaned. Delete it and CI stays green while the Railway
  web build fails with `Module not found` — the `iztro` launch-day bug, again.

A probe of every bare import in `apps/web`, `apps/api`, `packages/shared`,
`packages/ui` (scratch script, not committed) found `lunar-typescript` is the only
web import neither declared nor reachable from a declared dep.

---

## 1. C1 — create-lock TTLs ≥ the work they hold

Doctrine (#15): **TTL ≥ the bound of the work it guards; too long self-heals,
too short costs silently.**

In `bazi.service.ts`:
- Name the engine timeouts and use the constants AT the call sites, so the lock
  and the timeout cannot drift apart:
  - `ENGINE_CALCULATE_TIMEOUT_MS = 30_000`, `ENGINE_CALCULATE_HEAVY_TIMEOUT_MS = 45_000`
    (CAREER/LOVE) → replace the inline ternary at `:2693`.
  - `ENGINE_COMPAT_TIMEOUT_MS = 30_000` → replace the literal at `:2829`.
  - (`:2766`'s 30s is not under a create lock — untouched.)
- Margin: **reuse the existing 60s margin (`GENERATION_LOCK_MARGIN_SECONDS`, `:42`)**
  rather than inventing a second guess — and **rename it `LOCK_MARGIN_SECONDS`**
  (4 references, all in `bazi.service.ts`; no spec imports it), rewriting its
  docblock to say it sizes BOTH the generation locks/in-flight window AND the two
  create locks, so someone tuning it for one knows it moves the other. Under DB
  pool exhaustion each Prisma op can wait `pool_timeout` (20s) and
  `_executeCreateReading` runs ~4 sequential DB ops (reuse `findFirst`,
  `readingCache.findFirst` via `getCachedInterpretation`, `$transaction`), so 60s
  covers the healthy path and moderate contention, not the worst case. Say that
  in the comment; C2's signal flags any overrun.
- `READING_CREATE_LOCK_TTL_SECONDS = ceil(45_000/1000) + 60 = 105`
- `COMPARISON_CREATE_LOCK_TTL_SECONDS = ceil(30_000/1000) + 60 = 90`
- Cost: a SIGKILL'd create blocks that user's next create for ≤105s (was 30s).
- ⚠️ The bound assumes NO inline AI call under `reading:create`. True today: every
  creatable type is streamable, a cache hit returns before AI, and a streamable
  type without `stream: true` gets `STREAM_REQUIRED`. Say so in the comment.

Tests (extend `bazi.service.generation-lock-ttl.spec.ts`, which already captures
`acquireLock` args):
- `acquireLock` receives 105 for `reading:create:*` and 90 for `comparison:create:*`.
- `READING_CREATE_LOCK_TTL_SECONDS * 1000 > ENGINE_CALCULATE_HEAVY_TIMEOUT_MS`,
  `COMPARISON_CREATE_LOCK_TTL_SECONDS * 1000 > ENGINE_COMPAT_TIMEOUT_MS`.
- The engine fetch's `AbortSignal.timeout` receives the constant (pins "same
  number in both places").

Mutations: **T1** revert `reading:create` to 30 → red (the "receives 105" check).
**T2** raise the heavy engine timeout to 120s → red via the hard-coded "receives
105" check (NOT via `>`: the TTL is derived, so it rises with the timeout — which
is the point). **T3** set `LOCK_MARGIN_SECONDS` to 0 → red via the `>` assertions,
which exist to catch a margin cut to ≤ 0.

Docs in C1: handoff note on the double-charge window and its fix; CLAUDE.md one
line in "A per-call timeout is NOT how long a generation can run" listing these
two TTLs as derived.

---

## 2. C2 — lock ownership tokens (todo #23)

### 2.1 API (`apps/api/src/redis/redis.service.ts`)

```ts
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/nestjs';

/** Delete KEYS[1] only if it still holds ARGV[1]. Atomic in Redis. */
const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

/**
 * Returns an opaque ownership token, or null when someone else holds the lock.
 * `ttlSeconds` is REQUIRED — derive it from the bound of the work you guard.
 */
async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
  const token = `${randomUUID()}.${Date.now()}.${ttlSeconds}`;
  const result = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
  return result === 'OK' ? token : null;
}

/** Release only if we still own it. true = OUR lock was deleted. NEVER throws. */
async releaseLock(key: string, token: string): Promise<boolean> { … }
```

| Decision | Why |
|---|---|
| Return `string \| null`, keep the names | Every call site already does `if (!acquired)` → still correct. The new **required** `token` parameter makes the compiler find every release site. A future caller cannot release without one. |
| `ttlSeconds` becomes **required** (also on `withLock`) | The `= 30` default is exactly how a new caller copies an underived TTL — the re-arm path the todo describes. All 6 sites already pass one explicitly. |
| Token = `uuid.acquiredAtMs.ttlSeconds`, opaque to callers | Lets a miss be classified (§2.3) with no extra Redis state. Parsed only inside `RedisService`. |
| Not a `LockHandle` object | Would rewrite ~14 spec mocks. The one mistake a string allows (right token, wrong key) fails SAFE: nothing deleted, TTL reaps, §2.3 logs it. |
| `client.eval`, not `defineCommand` | Same as the throttler (`redis-throttler.storage.ts:134`), which already runs Lua against production Redis. |
| `releaseLock` never throws | Bazi sites `await` it bare in a `finally`; a Redis blip at release would turn an already-**charged** create/reveal into a 500. The whole body — eval, token parsing, logging, Sentry — is inside one try/catch. |
| No TTL validation in `acquireLock` | Derived TTLs fail closed via `AIService.safeBoundMs`; a new throw would be a behaviour change on 6 paths. |
| No `extendLock` | Tokens now make compare-and-`PEXPIRE` renewal possible; recorded as the likely fix for §2.9, not built here. |

### 2.2 Lua return handling

ioredis returns the script's integer as a JS number. `Number(result) === 1` →
released; anything else → not ours. The real-Redis spec pins the type.

### 2.3 The lost-lock signal — classified, so it does not blame the wrong thing

A miss has several causes, and the plan v1 blamed all of them on the TTL. Using
the acquire time and TTL carried in the token:

| `cause` | Condition | Means |
|---|---|---|
| `overran_ttl` | held ≥ TTL | the guarded work outlived its TTL → TTL too short (a real defect) |
| `lost_early` | held < TTL | the key vanished early: `volatile-lru` eviction, a `redis-cli FLUSHALL` (CLAUDE.md's post-prompt-change procedure!), or a Redis container restart |
| `unparseable` | token not in the expected shape | defensive only |

On a miss:
- `this.logger.warn(\`Lock ${key} not held at release (cause=${cause}, held=${heldMs}ms, ttl=${ttl}s)\`)`
- `Sentry.captureMessage('redis.lock.lost_before_release', { level: 'warning', tags: { lockPrefix, cause }, extra: { heldMs, ttlSeconds }, fingerprint: ['redis.lock.lost_before_release', lockPrefix, cause] })`
- `lockPrefix` = the key with its final `:<id>` segment removed (`stream:reading`,
  `ai:generate:comparison`, `reading:create`, `comparison:create`, `chat-extend`,
  `chat-session-stream`). A key with no `:` → `'unknown'` (never the raw key,
  which could be an id). **No id reaches Sentry**; the server log keeps the full
  key, as other logs already carry these ids.
- The fingerprint caps issues at prefixes × causes.
- A Redis **error** at release → `logger.error`, **no** Sentry (an outage is loud
  elsewhere: readiness fails).

⚠️ **Known, pre-registered trigger:** `chat-session-stream` will raise
`overran_ttl` during Anthropic 429/529 incidents (SDK retries + unbounded body,
§0). That is a real defect (§2.9), recorded in the runbook as expected so the
first alert is not a mystery.

### 2.4 Call sites (6 + `withLock`)

Rename the variable to `lockToken`.

| Site | Change |
|---|---|
| `bazi.service.ts:189` `reading:create` | token from `acquireLock(lockKey, READING_CREATE_LOCK_TTL_SECONDS)`; `finally { await releaseLock(lockKey, lockToken) }` |
| `bazi.service.ts:1241` `stream:reading` | `releaseStreamSlot` closure passes the token. Its three callers (subscribe `error`, `complete`, setup `catch`) are mutually exclusive → still one release. |
| `bazi.service.ts:1901` `comparison:create` | as `reading:create` |
| `bazi.service.ts:2376` `ai:generate:comparison` | as above; the poll branch is unchanged |
| `chat.service.ts:625` `chat-extend` | as above; existing `.catch` kept (harmless) |
| `chat-stream.service.ts:250` `chat-session-stream` | as above |
| `RedisService.withLock(key, fn, ttlSeconds)` | token-based; `ttlSeconds` required. Kept as the safe wrapper. |

### 2.5 Tests

**Unit — rewrite `apps/api/test/redis-lock.spec.ts`** (mocked ioredis with `eval`;
mocked `@sentry/nestjs`):
1. `acquireLock` returns a token and passes **that same token** to `SET … EX ttl NX`.
2. Two acquisitions → different tokens.
3. `null` when `SET NX` returns null.
4. `releaseLock` calls `eval` with a **hard-coded copy of the expected script
   text** (not the imported constant — otherwise a mutated script mutates the
   expectation too), `1`, key, token.
5. `1` → `true`, no warn, no Sentry.
6. `0` with a token acquired "long ago" (fake timers) → `cause: 'overran_ttl'`;
   with a fresh token → `cause: 'lost_early'`. One warn, one `captureMessage`,
   tags carry the PREFIX, and the serialised payload does **not** contain the id.
7. Key without `:` → `lockPrefix: 'unknown'`.
8. `eval` rejects → `false`, error logged, no Sentry, **does not throw**.
9. `Sentry.captureMessage` throws in the lost branch → still resolves `false`.
10. `withLock` passes its token to release, releases on success AND throw, throws when held.

**Integration — new `apps/api/test/redis-lock.integration.spec.ts`** (real Redis):
- Probe reachability with a separate lazy client FIRST (mirror
  `redis-throttler-storage.spec.ts`); construct `RedisService` only if reachable;
  `await service.onModuleDestroy()` in `afterAll`. (Its constructor opens a
  non-lazy connection, `redis.service.ts:11` — constructing it unreachable leaks
  handles and unhandled `error` events.)
- **Unreachable + `REQUIRE_REDIS_TESTS=1` → FAIL, not skip.** Add
  `REQUIRE_REDIS_TESTS: '1'` to `ci.yml`'s `test-api` job `env:` (in C2) — the only
  job with a `redis:7` service, so a skip there means it broke. NOT keyed on the
  generic `CI` variable, which sandboxes and agent environments set without Redis
  and which would turn the whole API suite red there. Elsewhere: loud `SKIPPED`.
- Cases:
  1. **The hazard:** A acquires `k` (TTL 30) → `PEXPIRE k 1` + short wait → B
     acquires → A releases with A's token → `false` **and `GET k` === B's token**.
     (Against the old bare `DEL`, B's lock is gone.)
  2. Owner release → `true`, key gone.
  3. Release with key absent → `false`.
  4. The script's reply really is `typeof 'number'`.
  - Unique per-run key prefix + cleanup.

**Call-site specs — the token is threaded, not just present.** Make the
`acquireLock` mock resolve a distinctive token (e.g. `'tok-create'`) and assert
`releaseLock` got `(key, 'tok-create')`:
- `test/ai-failure-refund.spec.ts:380` (`reading:create`) — must change anyway.
- `test/chat-service.spec.ts:1130,1151,1167` (`chat-extend`) — must change anyway.
- `test/chat-stream-service.spec.ts:307` (`chat-session-stream`) — must change anyway.
- `stream:reading` — strengthen `bazi.service.stream-dispatch-default.spec.ts:91` /
  `bazi.service.self-refusal-refund.spec.ts:126` to the token form.
- `comparison:create` and `ai:generate:comparison` — one assertion each in the
  spec that already drives that path.
- `test/redis-lock.spec.ts` calls that rely on the removed TTL default (e.g.
  `acquireLock('test:lock:default')`) → pass explicit TTLs. (`chat-service.spec.ts:1097`
  already asserts an explicit `EXTEND_LOCK_TTL_SECONDS` — no change.)

Specs whose mocks return `true` and never inspect release stay as they are.

**Source guard — new `apps/api/test/redis-lock-ownership.guard.spec.ts`.** Parse
every non-spec `.ts` file under `apps/api/src` except `redis/redis.service.ts`
with the **TypeScript compiler API** (`ts.createSourceFile` + a node walk;
`typescript` is already a devDependency of `apps/api`, and this runs in jest, not
in the pre-`npm ci` Lint step). Working on the AST rather than text means
comments, string literals containing `//`, multi-line calls and nested parens all
come out right without a hand-written stripper or paren counter. Because there
are ZERO `nx` literals outside `redis.service.ts` today, the rule can be broad
(any position in the file, not just direct `.set(` arguments) and still be green.
In every non-exempt file, fail on:
- (a) any **string literal or no-substitution template literal whose value is
  `nx`** (any case), wherever it appears — so `'NX' as const`, `('NX')`,
  `const NX = 'NX'`, a spread array `['EX', 30, 'NX']` and ioredis v5's generic
  `client.call('set', k, v, 'EX', 30, 'NX')` are all caught, not only
  `client.set(..., 'NX')`;
- (b) any **string or template literal whose text matches
  `/\bSET\b[^\n]*\bNX\b/i`** — including the head / middle / tail parts of a
  template WITH `${}` substitutions (so
  `` `redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ${ms})` `` is caught) — i.e.
  a Lua `SET … NX` inside an `eval` script (the
  throttler's pattern). The throttler's own Lua (`redis.call('SET', blockKey, '1',
  'PX', blockMs)`, `redis-throttler.storage.ts:101`) has no `NX` and stays green;
  `\bSET\b` does not match inside the word "SETNX";
- (c) a **call** whose callee is a property access named `setnx` (any case).
  Prose mentions of "SETNX" stay legal: three exist today (`chat.service.ts:616`
  and `chat-stream.service.ts:106` comments, the `chat.controller.ts:211` Swagger
  description string), and a guard that fails on documentation invites deleting
  the documentation. (Comments are not AST nodes; the Swagger string contains
  neither a bare `nx` value nor `SET … NX` with word boundaries.)
- Self-test on in-memory source strings (the walker is a pure function exported
  from the spec's helper). MUST FAIL on: multi-line lowercase
  `client.set(k,'1','ex',30,'nx')`; nested-paren
  `client.set(k, String(x), 'EX', 30, 'NX')`; `client.set(k, v, 'EX', 30, 'NX' as const)`;
  a spread `const A = ['EX', 30, 'NX']; client.set(k, v, ...A)`;
  `client.call('set', k, v, 'EX', 30, 'NX')`; a Lua string
  `"redis.call('SET', KEYS[1], ARGV[1], 'NX')"`; an interpolated Lua template
  `` `redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ${ms})` ``; `client.setnx(k, v)`.
  MUST PASS on: a comment saying "Redis SETNX"; a string literal saying
  "deduplicated via Redis SETNX"; the throttler's `SET … PX` Lua; plain
  `cache.set(k, v)` / `map.set(k, v)` / `searchParams.set('pool_timeout', …)`.
- Known blind spot, accepted: an `NX` value **built at runtime** (e.g. string
  concatenation) is invisible to a static check — this is a ratchet against the
  plausible copy-paste, not a proof (same stance as `scripts/check-engine-callers.mjs`).
- Run against the real tree: green today (verified 2026-10-01 by grep: under
  `apps/api/src` the only `nx` literal and the only `SET … NX` text, any case,
  are in the exempt `redis.service.ts` (`:142` comment, `:148` call), and no
  `.setnx(` call exists).

### 2.6 Mutations (each must go red; a non-compiling mutation is a non-result — redo it)

| # | Mutation | Red |
|---|---|---|
| L1 | `releaseLock` back to bare `DEL` | integration #1 |
| L2 | `acquireLock` stores constant `'1'` (release passes `'1'`) | integration #1 |
| L3 | Lua deletes unconditionally | unit #4 (hard-coded text) AND integration #1 |
| L4 | a call site passes `lockKey` as the token | that site's token assertion |
| L5 | `releaseLock` rethrows on `eval` error | unit #8 |
| L6 | delete the `captureMessage` | unit #6 |
| L7 | send the full key to Sentry | unit #6 |
| L8 | classify every miss as `overran_ttl` | unit #6 |
| L9 | add a multi-line lowercase `set(k,'1','ex',30,'nx')` in a service | source guard |
| L10 | add `.set(k, String(x), 'EX', 30, 'NX')` (nested parens) in a service | source guard |
| L11 | add `client.call('set', k, v, 'EX', 30, 'NX')` in a service | source guard (rule a) |
| L12 | add an `eval` with a Lua `SET … NX` string in a service | source guard (rule b) |

### 2.7 Deploy compatibility (rolling deploy, mixed fleet)

Locks live seconds-to-minutes; no migration. An old replica writes `'1'` and
DELs; a new one writes a token and compare-deletes. Each replica only releases
locks it acquired, so a mixed fleet behaves as today and converges once old
replicas drain. (The `cause` classification parses the caller's OWN token, never
the stored value, so an old replica's `'1'` in Redis cannot confuse it; a stored
`'1'` simply never matches a new token, which fails safe.) Rollback = revert.

### 2.8 Docs in C2

- CLAUDE.md: replace the "`redis.acquireLock` stores a constant `'1'`…" paragraph;
  correct the "`chat-stream.service.ts`'s 150s is CORRECT" paragraph (§0 row 4).
- `chat-stream.service.ts:55-63`: correct the two docblocks to state what the
  90s timeout actually bounds. **Comment-only, no behaviour change.**
- `test/chat-stream-service.spec.ts:503` — the test named "Bug B fix —
  STREAM_LOCK_TTL_SECONDS > Anthropic timeout (no race)" certifies the invariant
  §0 shows is false. Keep the assertion (it still pins TTL > 90 so nobody lowers
  it), but rename it to what it actually checks and re-comment it: "TTL exceeds
  the per-attempt time-to-headers timeout — NOT a bound on the stream; see #26".
- Runbook: new section "`redis.lock.lost_before_release`", read `cause` first:
  - `overran_ttl` → that prefix's TTL is shorter than its work.
    `chat-session-stream` is pre-registered as known (§2.9).
  - `lost_early` (held < TTL) has five causes, with the check for each:
    1. eviction → `redis-cli INFO stats | grep evicted_keys` (non-zero/growing);
    2. Redis restart → `redis-cli INFO server | grep uptime_in_seconds` (small);
    3. a `FLUSHALL` (e.g. CLAUDE.md's post-prompt-change step) → the operator log;
    4. **an old replica's bare `DEL` during C2's own rolling deploy** (old replica
       overruns, new replica acquires, old one deletes it) → the deploy timeline;
       expected only in the deploy window;
    5. a code bug — a double release or a release with the wrong key → none of
       the above apply; look at the call site for that prefix.
- Handoff: #23 ✅ with the 6-site correction.

### 2.9 New todo filed (not fixed here)

**#26 — `chat-session-stream` lock (150s) is shorter than its work.** The stream
body is unbounded except by the 60s idle watchdog, the SDK retries twice, and the
context build runs inside the lock. Likely fix: a total stream deadline, or
renewal via a compare-and-`PEXPIRE` `extendLock` (now possible with tokens).
Needs its own design and test; the new signal measures it meanwhile.

---

## 3. C3 — rate-limit gauge: decide it, make `null` self-explaining (todo #24)

### 3.1 Step A — the decisive check (no code; first, it may close the bug half)

- **A1 — production logs (owner, Railway → `bazi-app` → Logs):** search `AI-CALL`;
  take recent lines with `"provider":"CLAUDE"`, `"outcome":"ok"`, from a period
  when the load-test mock was NOT armed (it sends the same header). Is
  `rlOutRemaining` a number?
  - **Yes → capture works in production code**; the 07 null was hypothesis (a) or
    (b). Bug half closes as benign; C3 still ships so it can never be ambiguous.
  - **`null` on every real successful call → capture broken** → §3.6.
  - This proves capture works; it does NOT prove the streaming path (process-wide
    snapshot) — §3.4's stream test does that.
- **A2 — local, real Anthropic, one streamed call (owner OK for ~$0.05):** local
  stack with `ANTHROPIC_API_KEY` exported from `apps/api/.env` (Claude Code blanks
  it). One chat message on an existing session. Then `GET /api/admin/ops`; draw a
  conclusion **only if `aiBaseUrlEffective === 'https://api.anthropic.com'`** in
  that same response (Claude Code exports `ANTHROPIC_BASE_URL`, which the SDK
  honours; a proxy value could strip headers and fake a "broken" result).

### 3.2 Step B — replica identity on the ops snapshot

New `apps/api/src/common/instance-identity.ts`:

```ts
export interface InstanceIdentity {
  replicaId: string;                 // RAILWAY_REPLICA_ID, else os.hostname()
  replicaIdSource: 'railway' | 'hostname';
  deploymentId: string | null;       // RAILWAY_DEPLOYMENT_ID
  commitSha: string | null;          // RAILWAY_GIT_COMMIT_SHA (GitHub-triggered deploys only)
  startedAt: string;                 // computed ONCE at module load
}
export function resolveInstanceIdentity(env = process.env): InstanceIdentity
```

- `startedAt` = `new Date(Date.now() - process.uptime() * 1000).toISOString()`
  evaluated once at module load → stable across requests.
- No `pid`: `Dockerfile.api` `exec`s node, so it is `1` on every replica.
- Railway variables verified against docs.railway.com/reference/variables
  (2026-10-01). Env read at call time. Container hostname differs per container,
  so the fallback still disambiguates.
- Add `instance` to `OpsSnapshot` (`ops.service.ts`). It attributes every
  per-process field — `pools`, `rateLimit`, `aiBaseUrlEffective`, `alerting`.
- `commitSha` answers "is the code I think is deployed actually deployed?"
  (CLAUDE.md, "check the CODE is deployed before the config").

### 3.3 Step C — tell "idle", "Anthropic erroring" and "capture broken" apart

In `anthropic-rate-limit.ts`, alongside the header snapshot (which is replaced
wholesale on each observation), keep counters updated in
`absorbRateLimitHeaders` BEFORE its no-headers early return:

- `responsesSeen` — every response the wrapper saw
- `okWithoutHeaders` — **2xx** responses carrying none of the parsed headers
- `lastResponseAt`, `lastResponseStatus`

Surfaced on `RateLimitSnapshot`; cleared by `resetRateLimitSnapshot`. Hot-path
invariant unchanged: inside the existing `try`, never throws, never reads the body.

| State | Means |
|---|---|
| `responsesSeen == 0` | this replica has made no Anthropic call since `instance.startedAt` |
| `observedAt` set | working; the reading is `now − observedAt` old |
| `observedAt == null`, `okWithoutHeaders > 0` | **capture broken** — successful responses lack the headers we parse |
| `observedAt == null`, `okWithoutHeaders == 0`, `responsesSeen > 0` | only error responses so far (outage, bad key, edge 502) — see `lastResponseStatus`; NOT a capture bug |
| `okWithoutHeaders > 0` **in any state**, incl. `observedAt` set | ⚠️ warning: some successful responses arrived without the headers. If `observedAt` is set, the reading may be STALE (captured earlier, headers since lost) — compare its age with `lastResponseAt`. |

`ops.mjs` prints `okWithoutHeaders` beside `observedAt` always, and flags it
whenever it is non-zero.

### 3.4 Step D — tests

- `test/anthropic-client.spec.ts` — **new**: a real client from
  `createAnthropicClient`, a stub transport returning an SSE body
  (`message_start` … `message_stop`, `content-type: text/event-stream`) with
  rate-limit headers, consumed via `client.messages.stream(...).finalMessage()` →
  gauge populated. Closes the streaming wiring.
- `test/anthropic-rate-limit.spec.ts` — a 2xx without headers bumps
  `responsesSeen` and `okWithoutHeaders`; a 502 without headers bumps only
  `responsesSeen` and sets `lastResponseStatus`; `observedAt` stays null in both;
  reset clears all.
- `test/ops.service.spec.ts:89` — exact top-level key set gains `'instance'`;
  `resolveInstanceIdentity` with and without `RAILWAY_REPLICA_ID`; `startedAt`
  identical across two calls.
- Mutations: **R1** drop `instance`; **R2** move the counters below the early
  return; **R3** count non-2xx as `okWithoutHeaders`; **R4** stop passing `fetch`
  in `buildClient` (the NEW stream test must go red too).

### 3.5 Step E — tooling + docs (all in C3)

- `load-test/ops.mjs`:
  - print `instance.replicaId` / `startedAt` / `commitSha`, the §3.3 counters and
    the reading's age; interpret per the §3.3 table;
  - `--samples N`: default 1, **capped at 20** (the admin controller is throttled
    at 30/min per user, `admin.controller.ts:34`), paced ~250ms apart, ONE minted
    token; use `http` or `https` by the URL's protocol (so `localhost:4000` works);
    group by `replicaId`; if fewer replicas seen than `ops.replicas`, print
    "INCONCLUSIVE about the unseen replica(s)". (No claim that fresh connections
    control edge routing — they may not; INCONCLUSIVE covers it.)
  - a response predating C3 (`!('instance' in ops)`) → "deployed API is older than
    this script", as it already does for `aiBaseUrlEffective`.
- Fix the "every other section is fleet-wide" claim in all three places:
  `incident-runbook.md:22`, `ops.service.ts` docblock table,
  `admin.controller.ts:55-59` `@ApiOperation` description.
- Runbook: new "Approaching Anthropic's rate limits" — `rateLimit` + `instance`,
  the §3.3 table, `rlOutRemaining` on `AI-CALL` lines as the fleet-wide time
  series, `errorKind:"rate_limit"` for actual 429s.
- Handoff: #24 ✅ with the A1/A2 result.

### 3.6 Step F — CONDITIONAL: only if A1/A2 show capture is broken

The cause decides the fix. Procedure: one local real call with a temporary log of
which `anthropic-ratelimit-*` header NAMES arrived (names only) → extend
`absorbRateLimitHeaders` to what Anthropic sends → regression test with that exact
header set → re-run A2 → remove the temporary log. Re-plan with the reviewer if
the cause is not a header-name mismatch.

### 3.7 Explicit non-goal — a fleet-wide gauge in Redis

Not publishing the snapshot to Redis: stale/null only happens on an IDLE replica,
which is when the gauge does not matter; `AI-CALL` lines are already the
fleet-wide series; and it would add a Redis write to every AI call's hot path.
Revisit past 2 replicas or if the gauge is ever wired to an alert.

---

## 4. C4 — declare `lunar-typescript` in web; CI builds the way Docker does (todo #11(c))

### 4.1 The fix

1. `apps/web/package.json` → `dependencies`: `"lunar-typescript": "^1.8.6"` (same
   range → same resolved 1.8.6).
2. Root `package.json`: **remove** the `dependencies` block (its only entry).
   Nothing at the root imports it (checked `e2e/`, `scripts/`, `load-test/`).
   Keeping it would leave web's declaration un-load-bearing.
3. Lockfile, from the worktree root, node@22 / npm **10.9.4** (= `packageManager`):
   `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
   It writes only `package-lock.json`, never `node_modules`.
   **Expected diff — exactly two hunks:** `packages[""]` loses
   `dependencies.lunar-typescript`; `packages["apps/web"].dependencies` gains it.
   `node_modules/lunar-typescript` unchanged. **Any other churn → stop, revert,
   investigate.** Never hand-edit the lockfile.

### 4.2 Proof the declaration is load-bearing (local, scratchpad)

Reproduce `Dockerfile.web`'s install in a scratch dir (its exact `COPY` list:
root `package.json`, `package-lock.json`, `turbo.json`, the 7 workspace manifests):

```bash
npm ci --workspace=web --workspace=@repo/shared --workspace=@repo/ui --include-workspace-root --ignore-scripts
test -f node_modules/lunar-typescript/package.json   # must exist
```

Negative control in a second scratch dir: web's line removed, lockfile
regenerated → must be ABSENT. (`--ignore-scripts`: this checks resolution only.)

### 4.3 CI Build runs the install the deploy runs

Change the existing **`build`** job (same id and name "Build", so Railway's
Wait-for-CI and any branch protection see the same check):

```yaml
- name: Install — API scope (mirrors docker/Dockerfile.api)
  run: npm ci --workspace=api --workspace=@repo/shared --include-workspace-root
- name: Generate Prisma client
  run: cd apps/api && npx prisma generate
- name: Build API
  run: cd apps/api && npx nest build
- name: Install — Web scope (mirrors docker/Dockerfile.web)
  run: npm ci --workspace=web --workspace=@repo/shared --workspace=@repo/ui --include-workspace-root
- name: Build Web
  run: cd apps/web && npx next build
  env: { …unchanged… }
```

- The second `npm ci` wipes `node_modules` in every workspace (npm 10 `ci.js`)
  before reinstalling — intended.
- Both installs skip mobile's React Native tree; record install time on the first
  run.
- Both commands already build production successfully on Railway.
- Lint / typecheck / test jobs keep the full install.

**Drift guard — new `scripts/check-ci-docker-install-parity.mjs`**, the repo's
guard convention (`scripts/check-*.mjs`, run in the Lint job BEFORE `npm ci`,
`ci.yml:26-29`; no dependencies — so it works on TEXT, no YAML parser). Rules:

1. **Dockerfiles:** in each of `docker/Dockerfile.api` and `docker/Dockerfile.web`,
   join `\` continuations (`Dockerfile.web:24-25` is split), then find the one
   `RUN npm ci …` line. Exactly one per file, else fail.
2. **CI:** in `.github/workflows/ci.yml`, take only the `build:` job block — from
   the line `  build:` to the next line that is **non-blank, not a comment
   (`#…` after optional whitespace), and indented ≤ 2 spaces** (or EOF). Blank
   and comment lines never end the block, so a `  # ---` divider inside it cannot
   cut it short. The other four bare `npm ci` steps
   (lint/typecheck/test-api/test-web, lines 30/44/75/96) are outside it and
   ignored on purpose. Inside it, collect every `npm ci` command (join
   continuations / `run: |` blocks), **skipping lines that start with `#` after
   optional whitespace** — a commented-out `# npm ci` must neither be flagged as
   a bare install nor satisfy the "expected scoped step present" check.
3. **Pairing key:** the Dockerfile containing `--workspace=api` pairs with the
   build-job command containing `--workspace=api`; same for `--workspace=web`.
4. **Compare** each pair as a SET of flags (order-insensitive). Fail on any
   difference, and fail when an expected scoped command is **MISSING** from the
   build job — that, not an extra command, is what makes D3 (bare `npm ci`
   restored) fail. Also fail on a bare `npm ci` (no `--workspace`) inside the
   build block.
5. Print, on failure, both flag sets side by side.

`--root <dir>` for fixtures. Spec `apps/api/test/ci-docker-install-parity.guard.spec.ts`
(same pattern as `engine-caller-guard.spec.ts`) with one fixture per rule:
in-sync → pass; a flag added to one Dockerfile only → fail; the build job's web
step missing → fail; a bare `npm ci` in the build job → fail; a bare `npm ci` in
the LINT job only → pass; Dockerfile `\` continuation → parsed; a `  # ---`
comment line at 2-space indent INSIDE the build block, followed by its install
steps → those steps are still found (pass when in sync, fail when drifted); a
commented-out scoped web install with the real step removed → fail (MISSING),
and a commented-out bare `# npm ci` beside in-sync steps → pass. Add a
`guard:install-parity` npm script and the Lint-job step.

### 4.4 Mutations

| # | Mutation | Red |
|---|---|---|
| D1 | remove web's `lunar-typescript` (root already gone) | scratch scoped install: absent; CI Build: `next build` → Module not found |
| D2 | change one `--workspace` flag in `Dockerfile.web` only | parity guard |
| D3 | restore the bare `npm ci` in the `build` job | parity guard |

### 4.5 Docs in C4

CLAUDE.md, "Launch-day lesson": the CI Build job now mirrors the Dockerfile
installs, and why a full install cannot catch this class. Handoff: #11 (c) ✅.

---

## 5. Verification (each app's own jest, per CLAUDE.md)

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
(cd apps/api && ../../node_modules/.bin/prisma generate)   # stale-client gotcha (handoff #3)
redis-cli ping                                             # integration spec must RUN, not skip
(cd apps/api && npx --no-install jest)                     # watch the COUNT
(cd apps/web && npx --no-install jest)
(cd apps/api && npx tsc --noEmit) && (cd apps/web && npx tsc --noEmit)
./node_modules/.bin/turbo run lint --force                 # 5/5, "0 cached"
node scripts/check-engine-callers.mjs && node scripts/check-ai-spend-metering.mjs \
  && node scripts/check-ci-docker-install-parity.mjs
```

Plus every mutation in §1 / §2.6 / §3.4 / §4.4 seen red then restored; the eslint
suppressions ratchet re-pinned if a count moved; the scratch install proof (§4.2);
Step A recorded in the handoff.

After deploy: `node load-test/ops.mjs --api … --samples 20` → both replica ids
(or INCONCLUSIVE), each `instance.commitSha` = the merge commit.

---

## 6. Out of scope — observed, recorded, not fixed

- **#26** (§2.9) — `chat-session-stream` TTL.
- **Lock keys are evictable** (`maxmemory 256mb` + `volatile-lru`). Tokens stop the
  cascade, not the early loss; `cause: lost_early` will show it.
- **The reveal charges BEFORE taking `ai:generate:comparison`** (`:2321` vs
  `:2376`) → a Redis error at acquire charges 3 credits then 500s. Pre-existing.
- `stream:active:{userId}` is decremented from several paths with no floor.
- `redis-throttler-storage.spec.ts` still only SKIPS when CI's Redis is missing;
  this plan makes the new integration spec fail instead but does not touch it.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A call site keeps a bare `DEL` | Required `token` fails `tsc`; source guard; per-site token assertions. |
| Lua unavailable on Railway Redis | Already used by the throttler in production. |
| New Sentry event noisy | Fingerprinted prefix × cause; `cause` separates eviction/flush from overrun; C1 removes the create-lock trigger; the chat trigger is pre-registered; rule throttle 60 min. |
| A FLUSHALL raises a burst of `lost_early` | Expected and labelled as such in the runbook. |
| Lockfile churn | Expected-diff check; abort on anything beyond the two hunks. |
| CI Build slower | Measured on first run. |
| `--samples` never reaches replica 2 | INCONCLUSIVE, not a false all-clear. |

## 8. Docs summary

Per commit: C1 §1, C2 §2.8, C3 §3.5, C4 §4.5. The handoff `§0 STATE` block is
refreshed in the last commit that lands.

---

## 9. Review log

### Round 1 (staff engineer) — 17 findings, all accepted

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | Low | `pid` is always 1; `startedAt` recomputed per request | Dropped `pid`; `startedAt` computed once at module load (§3.2). |
| 2 | Low | "fleet-wide" mislabel also in `admin.controller.ts:55-59` | Added (§3.5). |
| 3 | Low | Commits not independent (docs crossed commits) | Docs now ride in their own commit (shape table, §8). |
| 4 | Low | `--samples`: admin throttle 30/min, `https` breaks localhost, `agent:false` overclaimed | Capped at 20 + paced; protocol-aware; claim dropped (§3.5). |
| 5 | Low | 30s margin is a guess; `GENERATION_LOCK_MARGIN_SECONDS` exists | Reused 60s; documented what it does not cover (§1). |
| 6 | Low | "Never throws" must cover logging; no-colon key | Whole body in try/catch; `'unknown'` prefix; unit #7, #9 (§2.1, §2.5). |
| 7 | Low | Lost-lock signal blames TTL for flush/restart/eviction | Acquire time + TTL in the token → `cause` tag (§2.3). |
| 8 | Low | Source-guard regex trivially bypassed | Whitespace-collapsed, case-insensitive, `setnx`, planted self-test (§2.5). |
| 9 | Low | `ttlSeconds = 30` default invites the same mistake | Made required on `acquireLock` and `withLock` (§2.1). |
| 10 | Low | Integration spec leaks a connection | Probe first, construct after, `onModuleDestroy` in `afterAll` (§2.5). |
| 11 | Low | A1 needs qualifiers (mock header, process-wide snapshot, third hypothesis) | Added (§0, §3.1). |
| 12 | Low | A2 can mislead via `ANTHROPIC_BASE_URL` | Require `aiBaseUrlEffective === https://api.anthropic.com`; export the key (§3.1). |
| 13 | Low | Parity check belongs in `scripts/check-*.mjs`; `\` continuations | Moved to a scripts guard in the Lint job, line-joining (§4.3). |
| 14 | Medium | §2.3 table misdiagnoses outages as broken capture | Added `okWithoutHeaders` + `lastResponseStatus`; 4-state table (§3.3). |
| 15 | Medium | L3 only caught by a spec that skips silently | CI fails if Redis unreachable; unit test hard-codes the script text (§2.5). |
| 16 | Medium | `reading:create` overrun is a live double-charge window | Verified (`:231` / `:609`, no unique constraint, ~30s engine). Impact restated in §0; TTL fix is its own commit C1. |
| 17 | Medium | `chat-session-stream` bound understated; Risks table contradicted §5 | Verified (`client.js:334-364`, default `maxRetries`, context build inside lock). Trigger pre-registered; comments + CLAUDE.md corrected; new todo #26 (§0, §2.3, §2.8, §2.9). |

### Round 2 (same staff engineer) — 8 findings, all Low, all accepted

All 17 round-1 fixes confirmed against the code; token format, `cause`
classification, reused margin, explicit TTLs and guard conventions checked sound.

| # | Finding | Disposition |
|---|---|---|
| 1 | Line refs: "~30s engine" is `:376`; `chat-service.spec.ts:1097` already passes an explicit TTL | Fixed (§0, §2.5). |
| 2 | T2's failure reason wrong for a derived TTL; reused constant's name/docblock misleading | T2 reason corrected, T3 added; constant renamed `LOCK_MARGIN_SECONDS` with docblock covering both uses (§1). |
| 3 | `chat-stream-service.spec.ts:503` still certifies the false chat invariant | Renamed + re-commented, assertion kept, cites #26 (§2.8). |
| 4 | §3.3 table ignores `okWithoutHeaders` once `observedAt` is set (stale reading) | Warning row for any state; `ops.mjs` always shows it (§3.3). |
| 5 | Parity guard extraction unspecified; naive approach picks up 4 other `npm ci` lines and cannot fail D3 | Text rules: `build:` block by indent, pairing by `--workspace`, missing-step fails, bare-in-build fails; fixture per rule (§4.3). |
| 6 | `process.env.CI` too broad a trigger | Explicit `REQUIRE_REDIS_TESTS: '1'` in the test-api job only (§2.5). |
| 7 | `lost_early` triage incomplete, no concrete checks | Five causes incl. old-replica `DEL` during C2's own rolling deploy and code bugs, each with a check (§2.8). |
| 8 | **Source-guard rule (a) fails on day one** (2 comments + 1 Swagger string mention SETNX); rule (b) `[^)]*` misses nested parens | Verified by grep. Guard now walks the TypeScript AST (call syntax only; comments/strings/nesting handled by the parser — more robust than the suggested comment-strip + paren counter, which would mangle strings containing `//`); self-test incl. nested-paren and must-pass prose cases; L10 added (§2.5, §2.6). |

### Round 3 (same staff engineer) — 2 findings, both Low, both accepted

All 8 round-2 fixes confirmed; the TypeScript-AST guard choice confirmed sound
(`typescript` 5.9.2 resolves from `apps/api/test`; no existing `.set(` call trips
it); T2/T3 reasons, `REQUIRE_REDIS_TESTS`, parity rules, `lost_early` triage and
the A2 base-URL check all verified. Reviewer: "no blocking issues — v3 can be
approved".

| # | Finding | Disposition |
|---|---|---|
| 1 | Parity guard's `build:` block boundary would be cut short by a `  # ---` comment at 2-space indent | Boundary = next non-blank, non-comment line with indent ≤ 2; fixture added (§4.3). |
| 2 | Source guard only inspects direct `.set(` arguments — misses `'NX' as const`, spreads, `client.call('set', …, 'NX')`, a hoisted `const NX = 'NX'`, Lua `SET … NX` in `eval` | Broadened: any `nx` literal anywhere, any literal matching `/\bSET\b[^\n]*\bNX\b/i`, any `setnx` call — still green today (verified by grep); self-tests for each shape; L11/L12 added; blind spot narrowed to runtime-built values (§2.5, §2.6). |

### Round 4 (same staff engineer) — ✅ APPROVED, plus 2 Low clarifications (applied)

Verdict: "approved. Nothing blocking remains." Re-verified the broadened guard is
green on today's tree (only `redis.service.ts:142,148`, exempt), that rule (b)
leaves the throttler's `SET … PX` Lua and all three "SETNX" prose mentions alone,
and that the §4.3 block boundary is correct for this file (YAML block-scalar
lines are always indented deeper, so they never end the block).

| # | Clarification | Applied |
|---|---|---|
| 1 | Parity guard should skip commented-out `# npm ci` lines when collecting commands (else a false bare-install flag, or a commented scoped install falsely satisfying "step present") | Rule 2 skips `#` lines; two fixtures added (§4.3). |
| 2 | Rule (b) must also scan the head/middle/tail parts of templates WITH `${}` substitutions | Stated explicitly; interpolated-Lua self-test added (§2.5). |


---

## 10. Implementation log (2026-10-01)

Deviations from the plan, each made for a reason found while implementing:

- **#26 premise corrected.** The chat watchdog is a 5s `setInterval` on
  `lastDeltaAt` (set before queueing/headers/retries) and output is capped at
  800 tokens, so the stream itself IS bounded; the real overrun is the cold
  chat-context build inside the lock. Comments, CLAUDE.md and the handoff say so.
- **`ops.mjs` uses `fetch`** (handles http and https) rather than choosing a
  module by protocol.
- **`turbo.json`**: `REQUIRE_REDIS_TESTS` added to `globalPassThroughEnv` (the
  turbo lint rule caught it — the PR #64 lesson).

Line audit (3 parallel agents) + re-audit — all findings fixed:
- C2: Sentry gets only a `KNOWN_LOCK_PREFIXES` value (else `other`); lost-lock
  reporting in its own try; guard rule (d) for `del`/`unlink` of a lock key
  (word-boundary match, so `blockKey`/`clock` don't trip it); stale "30s
  advisory lock" comments and the chat-stream class docblock corrected; runbook
  create-lock row points at DB pool saturation, not the (hard-capped) engine.
- C3: `requestsStarted` / `transportErrors` counters (a network-level outage no
  longer looks idle); PARTIAL state when output-token headers are missing;
  `ops.mjs` judges ARMED over all samples, prints per-replica AI URL / pools /
  all counters / last-response age (server clock), survives old-replica samples,
  429s and network errors mid-run; scope tables classify every field; a real
  "computed once" test for `startedAt`.
- C4: the parity guard reads whole `run:` scalars, rejects any other install
  (all npm 10 aliases, yarn, pnpm, bun; `-g` allowed), any `npm ci` that is not
  exactly one mirrored command, and non-cosmetic `npm_config_*`; quoted scalars
  parsed; 46 fixtures.

Live results: see handoff #23 / #24 / #11(c).

**A1 PASSED 2026-10-01 (owner):** production `AI-CALL` (deploy `bf05633`) shows
`rlOutRemaining: 2000000` with a reset ≈ the call start (the mock would stamp
start+60s) — real Anthropic, capture works. § 3.6 not needed; #24 closed.
