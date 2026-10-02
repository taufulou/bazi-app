# Todo #26 — `chat-session-stream` lock can be outlived: a total deadline + a derived TTL

**Status: ✅ IMPLEMENTED 2026-10-02 on `claude/launch-security-phase1-review-d1daf4` (UNCOMMITTED — owner commits; this file is untracked, `git add` it). Built exactly as plan v3.1, which the staff-engineer reviewer APPROVED in round 3 (Round-1: REVISE 14 · Round-2: REVISE 8 · Round-3: APPROVE 2 low — §7). Mutation results, suite results and the line-audit outcome are in §8.**
Branch: `claude/launch-security-phase1-review-d1daf4` (= `main` at `992839e`).

## 0. The decision in one paragraph

`chat-session-stream:{sessionId}` is held for the WHOLE of `_streamWithLock`
(`apps/api/src/chat/chat-stream.service.ts:272-295`), but its 150s TTL was sized
against a bound that does not exist (§1). The fix mirrors #15 / #27 — **derive the
TTL from the bound of the work** — and, because the work has NO bound today,
first gives it one: a **total deadline measured from lock acquisition**
(`CHAT_STREAM_DEADLINE_MS`, 205s, derived from three named phase bounds), enforced
by the existing 5s watchdog interval (abort + refund mid-stream) and by a cheap
pre-check before the Anthropic call (refuse + refund, no Anthropic spend). The
TTL becomes `deadline + a margin DERIVED from the two post-deadline tails` =
**317s**. Lock renewal (`extendLock`) is rejected (§2.1). No migration, no env
var, no cache bump; one Sentry event so a deadline fire is never silent.

## 1. The defect, precisely

Everything between `acquireLock` (`:272`) and `releaseLock` (`:292`) runs under
the lock. In order, with its real bound:

| phase | code | bound today |
|---|---|---|
| P1 cap + quota + deduct tx + entitlement query | `:349-351`, `:464-493` | Redis (no `commandTimeout` on the client, `redis.service.ts:76-82`) + an interactive tx (Prisma defaults: `maxWait` 2s to get a connection + `timeout` 5s) + 1 plain query (connection wait ≤ `pool_timeout` 20s = `DEFAULT_POOL_TIMEOUT`, `common/database-url.ts:26`; no `statement_timeout`, so execution is unbounded) |
| P2 **chat-context build** | `:474`, `:494`, `:510` → `chat-context.service.ts` | Redis hit: ms. **Cold: exactly ONE engine call per build (`engineFetch` never retries), `AbortSignal.timeout(45_000)` reading `:1353` / fortune `:1499`, `60_000` compat `:1425`** + a few plain DB queries |
| P3 recent messages + Tier C lookup | `:549`, `:586` | 2 plain queries |
| P4 S2 cap + S1 slot | `:665-668` | `aiGovernor.acquire` is a `while` loop (`ai-governor.service.ts:166-168`): a woken waiter that loses the race waits ANOTHER `QUEUE_TIMEOUT_MS.interactive` (3s). It takes no signal, so an abort is observed only when it returns |
| P5 **Anthropic stream** | `:670-715` | the watchdog FIRES ≤ 60s + one 5s poll after `lastDeltaAt`, which is set at `:618` — before the slot wait and before the SDK's retries. **But the abort is OBSERVED late when the SDK is inside a retry sleep**: `retryRequest` (`@anthropic-ai/sdk@0.73.0` `client.js:389-416`) honours `retry-after` up to 59.99s with `await sleep(timeoutMillis)` (`internal/utils/sleep.js`, a bare `setTimeout` — takes no signal); only the next `makeRequest` (`:239`) throws `APIUserAbortError`. Retries never happen after headers/first delta. **Body: UNBOUNDED** except by the 800-token cap and the per-gap watchdog — a trickle of one delta every 60s never trips it |
| P6 post-validate + persist tx + optional refuse-refund tx + 3 plain reads (`:979`, and 2 inside `getMonthlyUsage`, `chat-payment.service.ts:444,449`) + `done` | `:826-997` | 2 tx (≤ 7s each by Prisma defaults) + 3 × (≤ 20s connection wait + unbounded execution) |

The SDK `timeout: 90_000` (`:684`) bounds only time-to-headers per attempt and the
client keeps `maxRetries: 2` — both already corrected in the docblock at `:55-66`
(which itself still says "covers… SDK retries" — it covers their FIRING, not
their observation; fixed in §3). So **150s is reachable on an ordinary bad day**:
cold compat context 60s + a slow first delta 65s + a normal 15–20s body + persist
≈ 145–150s, and anything slower overruns. When it overruns, the lock expires, a
second request on the same session acquires its own lock, and two streams run
on one session (double deduction, two assistant rows, racing
`consecutiveRefuses`). Since #23 the first stream's release reports
`redis.lock.lost_before_release` `{lockPrefix: chat-session-stream, cause:
overran_ttl}` instead of deleting the second stream's lock — the runbook
currently says to ARCHIVE that issue because its count is #26's measurement.

Already true and NOT part of the problem: the lock is released in a `finally`
on every path; `releaseLock` never throws; the client-disconnect handler aborts
the Anthropic stream (`:639-644`); the M6 drain aborts via the same controller;
`registerStream`'s release is idempotent (`shutdown.service.ts:144-148`) and is
called from the AI `finally` at `:819`, which a `return` inside that try reaches.

## 2. Design

### 2.1 Shape: total deadline + derived TTL. Renewal rejected.

| | **A. total deadline + TTL = deadline + margin (CHOSEN)** | B. `extendLock` renewal (compare-and-`PEXPIRE`) |
|---|---|---|
| Bounds the work | **yes** — that is the point | no; a wedged holder (an `await` that never resolves) renews for ever, so it NEEDS a deadline anyway |
| New primitive | none | a Lua script + `redis.service.ts` method + unit/integration specs + an ownership-guard rule |
| Runtime cost | none | one Redis command per renewal period per live stream |
| Crash (SIGKILL only — M6 covers SIGTERM) | session wedged ≤ 317s | wedged ≤ TTL (could be ~60s) |
| Precedent | #15 / #27 ("derive the TTL from the bound of the work") | none |

A 317s wedge after a SIGKILL is the accepted cost — rare and visible
(`CONCURRENT_STREAM` is NOT in the clients' `LOCK_ERROR_CODES`, so the composer
stays enabled and the user simply retries after the TTL). A too-short TTL is
common and silent. Same trade #15 made at 21 minutes. `extendLock` stays a
recorded option (tokens make it possible) for a future surface whose work is
genuinely unbounded — chat's is not, once the deadline exists.

### 2.2 The clock starts at lock acquisition

The TTL measures from the `SET … NX`; so must the deadline, or the two cannot be
related. `streamMessage` captures `lockRequestedAt = Date.now()` immediately
BEFORE calling `acquireLock` (round-3 #1: the Redis client has no
`commandTimeout`, so a slow acquire round trip would otherwise start the
deadline clock LATER than the TTL clock and eat into the margin; taken before,
the deadline is always at or ahead of the TTL — the same choice `acquireLock`
makes for its own token stamp at `redis.service.ts:229`) and passes it into
`_streamWithLock` as a new last parameter; `_streamWithLock` computes `const
deadlineAt = lockRequestedAt + CHAT_STREAM_DEADLINE_MS` as its FIRST statement, so both the pre-check and the
interval closure (created at `:627`, before the AI `try`) can see it. It is NOT
parsed from the token (`acquireLock`'s docblock: "nothing else may parse it").

### 2.3 Constants — all literals, each derived from a NAMED bound, every one USED

No env var (the #15 lesson: a derived TTL put `parseInt` output on a path to
Redis, and one typo became a charge-then-500; `safeBoundMs` exists only because
of it). Everything here is a compile-time number. `apps/api` lints with
`--max-warnings 0` and `no-unused-vars` is an error, so every constant below is
referenced by the derivation chain — a bound that is merely named is not a bound.

```ts
// chat-context.service.ts — NEW, exported; the three AbortSignal.timeout(…)
// literals become reads of this object (reading :1353, compat :1425, fortune :1499).
export const CHAT_CONTEXT_ENGINE_TIMEOUT_MS = { reading: 45_000, compat: 60_000, fortune: 45_000 } as const;

// chat-stream.service.ts
import { DEFAULT_POOL_TIMEOUT } from '../common/database-url';   // seconds; M2's pool_timeout (20)

const WATCHDOG_POLL_MS = 5_000;                       // names the existing literal at :633
const STREAM_WATCHDOG_MS = 60_000;                    // existing

// ---- the deadline: from lock acquisition to the end of the Anthropic stream ----
/** P2 bound: the slowest cold context build is compat's 60s engine call (one call, no retry). */
const CHAT_CONTEXT_BUILD_BOUND_MS = Math.max(...Object.values(CHAT_CONTEXT_ENGINE_TIMEOUT_MS)); // 60_000
/** P4+P5a bound on when the watchdog FIRES: ≤ 60s + one 5s poll after `lastDeltaAt`, which is set BEFORE the slot wait and the SDK's retries. When it is OBSERVED is an abort-path question, budgeted in ABORT_TAIL_MS below. */
const FIRST_DELTA_BOUND_MS = STREAM_WATCHDOG_MS + WATCHDOG_POLL_MS;                             // 65_000
/** P5b bound: 800 tokens at a degraded 10 tok/s. Normal Sonnet output is 50–80 tok/s → 10–20s. */
const STREAM_BODY_BOUND_MS = 80_000;
/** P1/P3 are DB round trips that are ms in health; they are NOT budgeted — see §6. */
export const CHAT_STREAM_DEADLINE_MS = CHAT_CONTEXT_BUILD_BOUND_MS + FIRST_DELTA_BOUND_MS + STREAM_BODY_BOUND_MS; // 205_000
/** Pre-check floor: a normal turn needs ≤ 3s to first delta + ≤ 20s body. With less than this left, starting a stream is more likely to be cut than to finish — and the first turn's 30k-token cache WRITE (1h TTL, 2× rate: ~$0.18) would be spent on a cut stream, recovered only if the user retries within the hour. */
const MIN_STREAM_BUDGET_MS = 30_000;

// ---- the margin: the longer of the two tails that run AFTER the deadline ----
/** The SDK's retry sleep honours `retry-after` up to 59.99s and ignores our signal (`@anthropic-ai/sdk` client.js:412-416; `internal/utils/sleep.js` is a bare setTimeout). A property of the SDK, not a knob — re-check on an SDK major bump. */
const SDK_RETRY_SLEEP_MAX_MS = 60_000;
/** Prisma interactive-transaction defaults: `maxWait` 2s for a connection + `timeout` 5s. Not configured anywhere in this repo, so a literal. */
const PRISMA_TX_BOUND_MS = 7_000;
/** A plain query's wait for a pooled connection. Its EXECUTION is unbounded (no statement_timeout) — §6. An operator override of `pool_timeout` in DATABASE_URL is not seen here, and when DATABASE_URL already carries a `connection_limit` the URL is left untouched (`database-url.ts:98-108`) and Prisma's own default (10s) applies — both inside this bound; the runbook's #27 derivation makes the same assumption. */
const POOL_WAIT_BOUND_MS = DEFAULT_POOL_TIMEOUT * 1000;                                         // 20_000
/** Normal completion (P6): one poll + 2 tx + 3 plain reads. */
const NORMAL_TAIL_MS = WATCHDOG_POLL_MS + 2 * PRISMA_TX_BOUND_MS + 3 * POOL_WAIT_BOUND_MS; // 79_000 (P6 can start up to one poll AFTER the deadline)
/** Abort path: one poll + the SDK sleep + `_refundOnError` (1 plain update + 1 refund tx). */
const ABORT_TAIL_MS = WATCHDOG_POLL_MS + SDK_RETRY_SLEEP_MAX_MS + POOL_WAIT_BOUND_MS + PRISMA_TX_BOUND_MS; // 92_000
/** Rounding cushion over the enumerated tail; the enumeration does not bound query execution. */
const LOCK_TAIL_CUSHION_SECONDS = 20;
const STREAM_LOCK_MARGIN_SECONDS =
  Math.ceil(Math.max(NORMAL_TAIL_MS, ABORT_TAIL_MS) / 1000) + LOCK_TAIL_CUSHION_SECONDS;          // 112
export const STREAM_LOCK_TTL_SECONDS = Math.ceil(CHAT_STREAM_DEADLINE_MS / 1000) + STREAM_LOCK_MARGIN_SECONDS; // 317
```

Why the margin is NOT `bazi.service.ts`'s `LOCK_MARGIN_SECONDS` (60): that one
is "an engine call + a 60s cushion"; this one is an enumerated post-deadline
tail whose dominant term is the SDK sleep. Coupling them would let a tune of
one silently move the other.

### 2.4 Where the deadline bites — three places, each deliberate

| phase | action | why here and not elsewhere |
|---|---|---|
| **P2 (context build)** | NOT aborted. The engine fetches carry their own `AbortSignal.timeout`; threading a deadline signal through three `ChatContextService` methods and three `engineFetch` sites is a wider change for no gain — the pre-check below catches the outcome. | |
| **After `buildPrompt` (`:596-611`, synchronous; `:612-616` are comments), BEFORE the `AbortController` / `registerStream` / `setInterval` / `response.on('close')` block that starts at `:617`** | **pre-check**: `if (deadlineAt - Date.now() < MIN_STREAM_BUDGET_MS)` → refuse WITHOUT calling Anthropic. Its own small block, modelled on the entitlement branch at `:530-543`: (1) best-effort stamp `chatMessage.update({errorCode:'STREAM_TIMEOUT'})` inside a try/catch; (2) `refundLastMessage(userMessageId, sessionId, userId, 'stream-deadline-before-ai:<elapsed>s').catch(() => ({refunded:false, method:null}))`; (3) `_reportDeadline('pre_ai', …)`; (4) `_emitError(response, 'STREAM_TIMEOUT', <message>, refunded, method)` where **the message is chosen from `refundResult.refunded`** — «系統忙碌，回覆逾時，點數已退還，請稍後再試» when true, «系統忙碌，回覆逾時，請稍後再試» when false (the clients render `message` verbatim; a refund claim that did not happen is a lie to the user); `return`. | **Outside the AI `try`** (`:661-820`) on purpose: that try's catch treats any non-`HttpException` as an AI failure, and the pre-check fires precisely under pool saturation — when its own refund tx is likeliest to throw (P2024/P2028). Inside the try, that throw would be relabelled `AI_CALL_FAILED`, overwrite the stamp with `AI_FAILED`, write an `AI-CALL outcome:"error"` line for a call that never happened, and escape `streamMessage` after headers. Outside it, with the `.catch`, none of that can happen. At this point P1–P3 have all elapsed, nothing is registered or scheduled yet (the close listener is `:644`, the registration `:622`), and the S1 slot is untaken. **Not** `AI_CALL_FAILED`/`AI_FAILED`: no AI call was made, and the code is careful (`:524-529`, `:746-754`) not to pollute the AI-failure signal with our own refusals. `STREAM_TIMEOUT` is NOT in the clients' `LOCK_ERROR_CODES` (web `ChatDrawer.tsx:43`, mobile `ChatSheet.tsx:43`) → a transient banner, composer enabled, retry is the right action (both clients verified). Ordering note: this sits before the S2 re-check at `:665`; under a tripped cap AND a blown budget the user sees `STREAM_TIMEOUT` rather than `AI_SPEND_CAP` — both refund, nothing is spent between them, accepted; `quota-wiring.spec.ts` (cap before every `consume`) is unaffected. |
| **Inside the existing `setInterval` at `:627`** | body is an **`if / else if / else if` chain** so exactly ONE branch runs per tick: `if (abortController.signal.aborted) return;` (a stream already aborted by the watchdog or the client must not be RE-labelled on a later tick, and must not log every 5s until the `finally` clears the timer) `else if (Date.now() >= deadlineAt) { deadlineTriggered = true; abort(); }` (most specific cause first) `else if (Date.now() - lastDeltaAt > STREAM_WATCHDOG_MS) { watchdogTriggered = true; abort(); }`. The chain — not two independent `if`s — is what makes the ORDER observable: with independent blocks a swap would set both flags and the label would not change (round-2 #7). The catch at `:772` picks the reason: deadline → `'stream-deadline-exceeded:<elapsed>s'`, else watchdog, else generic; all three go through `_refundOnError` → `AI_CALL_FAILED` + `AI_FAILED` exactly as the watchdog does today. | The watchdog is the precedent: an AI call that did not finish inside the bound IS an AI-path failure. **Accepted imprecision**: when OUR slowness ate most of the budget (P2 took 170s, the pre-check passed with 35s left, the stream was cut at 205s) the cut is still labelled `AI_CALL_FAILED`; the Sentry event carries `aiElapsedMs` beside `elapsedMs` so the two cases separate post hoc (§2.5). Choosing `STREAM_TIMEOUT` here by a threshold on `aiStartedAt - lockRequestedAt` would add a second rule to tune for a case the pre-check already makes rare. |
| **P6 (persist)** | NOT aborted — the user's answer is complete and must be persisted. Covered by the margin. | |

`_refundOnError` is NOT changed (the pre-check has its own block;
`ai-spend-degradation.spec.ts:159-167` locks its 5-arg call shape).

### 2.5 A deadline fire is never silent

Both bites call a new private `_reportDeadline(phase, { elapsedMs, aiElapsedMs,
sessionId })`: `logger.warn` with the session id (ids stay in our logs), and
`Sentry.captureMessage('chat.stream.deadline_exceeded', { level: 'warning', tags:
{ phase }, extra: { elapsedMs, aiElapsedMs, deadlineMs }, fingerprint:
['chat.stream.deadline_exceeded', phase] })` — the whole body in a try/catch, as
`reportLostLock` is, so a helper whose job is visibility cannot itself throw.
`phase` is `'pre_ai' | 'mid_stream'`; `aiElapsedMs` is `null` for `pre_ai`. The
project's one alert rule emails on any event, once an hour per issue: a chat
turn that ran past 3½ minutes is worth that email. The mid-stream bite also
leaves the normal `AI-CALL … outcome:"error"` line via the existing `finally`
(`:786-809`); the pre-check leaves none — correctly, no call was made, and T10
pins that.

### 2.6 What does NOT change

The lock key, the acquire/release sites, the `CONCURRENT_STREAM` refusal, the
watchdog's 60s, the SDK `timeout`/`maxRetries`, the client-disconnect path, the
M6 registration order, `KNOWN_LOCK_PREFIXES`, the ownership-guard rules (nothing
here trips them — verified), the refuse-refund cap, `chat-extend`'s lock,
`_refundOnError`. The clients need no change: web `streamChatMessage`
(`apps/web/app/lib/chat-api.ts:294`) has an `AbortController` but no timer, and
`apps/mobile/src/lib/stream.ts` has no timeout — nothing client-side caps a
stream below 205s. (Assumption: Railway's edge tolerates a 205s SSE response — a
LIFETIME reading streams for 180s today; see §6.)

## 3. Changes by file

| file | change |
|---|---|
| `apps/api/src/chat/chat-context.service.ts` | export `CHAT_CONTEXT_ENGINE_TIMEOUT_MS`; the three `AbortSignal.timeout(<literal>)` → reads of it (`:1353` reading, `:1425` compat, `:1499` fortune) |
| `apps/api/src/chat/chat-stream.service.ts` | import `DEFAULT_POOL_TIMEOUT`; constants per §2.3; rewrite the `:55-66` docblock (the watchdog covers when retries FIRE, not when the abort is observed) and the `:68-84` one ("CAN be outlived" → derived, and how) and the class docblock `:126-129`; keep the existing watchdog warn at `:629` inside the watchdog branch; fix the stale `:637` comment ("hold the lock for 150s wasted"); `streamMessage`: capture `lockRequestedAt` immediately BEFORE `:272`, pass as the 7th arg at `:283`; `_streamWithLock`: new param, `deadlineAt` as the first statement; pre-check block after `:611`; `WATCHDOG_POLL_MS` at `:633`; interval body per §2.4 (if/else-if chain); `deadlineTriggered` flag; reason selection at `:772`; `_reportDeadline` helper |
| `apps/api/src/ai/ai.service.ts` `:396-404` | the "Contrast `chat-stream.service.ts`, whose 150s lock IS correctly derived…" paragraph is now false twice over — rewrite to point at `STREAM_LOCK_TTL_SECONDS`'s derivation |
| `apps/api/test/chat-stream-service.spec.ts` | harness: `jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), addBreadcrumb: jest.fn() }))` — `addBreadcrumb` is REQUIRED or the refund-cap tests (`:944`) throw; keep a handle to the `ShutdownService` instance (today an inline `new ShutdownService()` at `:185`) and make the governor stub's `acquire` a `jest.fn` (today a plain arrow at `:183`); replace the `:506-527` TTL test; add a `describe('#26 — total deadline')` with fake timers (§4) |
| `apps/api/test/chat-context-engine-timeouts.guard.spec.ts` (NEW, small) | source-text guard: zero numeric literals inside `AbortSignal.timeout(` in `chat-context.service.ts`; `CHAT_CONTEXT_ENGINE_TIMEOUT_MS` has exactly the keys `reading/compat/fortune` and `max === 60_000` (re-pin when a timeout changes — that is the point) |
| `CLAUDE.md` | § "A per-call timeout is NOT how long a generation can run": the `chat-stream.service.ts` paragraph (~`:4373`) → FIXED, with the derivation, the two bites, and the SDK-sleep observation lag; the runbook-archive instruction removed |
| `docs/ops/incident-runbook.md` | `overran_ttl` table: the `chat-session-stream` row → "Not expected (TTL 317s = 205s deadline + 112s derived margin). The phases that can still run unbounded are PRE-AI (P1–P3): a hung Redis command (no `commandTimeout`), a slow-executing Postgres query (no `statement_timeout`), context-build DB waits — a P2 hang longer than the TTL produces BOTH this event AND `chat.stream.deadline_exceeded{phase:pre_ai}` with `elapsedMs` > 317000. Then the post-stream persist under pool saturation; then a stalled loop"; DELETE the «archive it» block and its 4 steps; NEW short section `chat.stream.deadline_exceeded` (`phase=pre_ai` → P1–P3 slow: pool saturation / engine latency / Redis; `phase=mid_stream` → Anthropic latency or an output trickle, OR our own pre-AI slowness — compare `aiElapsedMs` with `elapsedMs`; both: check `AI-CALL` `ms` and `rlOutRemaining`) |
| `.claude/plans/launch-security-phase1-session-handoff.md` | #26 → ✅ with a 6-line summary; §0 bullet; #15(d) cross-reference |

Sketch of the hot path (abridged — the real diff keeps every existing comment):

```ts
// streamMessage
const lockRequestedAt = Date.now();         // BEFORE the acquire: the deadline clock never lags the TTL clock
const lockToken = await this.redis.acquireLock(lockKey, STREAM_LOCK_TTL_SECONDS);
if (!lockToken) { …CONCURRENT_STREAM… }
try { await this._streamWithLock(response, user.id, session, sanitizedContent, sectionContextHint, refusal, lockRequestedAt); }
finally { await this.redis.releaseLock(lockKey, lockToken).catch(…); }

// _streamWithLock — first statement
const deadlineAt = lockRequestedAt + CHAT_STREAM_DEADLINE_MS;

// … P1, P2, P3, buildPrompt (:596-611) …

// PRE-CHECK — before the AbortController at :617. Nothing registered, nothing scheduled, no slot.
if (deadlineAt - Date.now() < MIN_STREAM_BUDGET_MS) {
  const elapsedMs = Date.now() - lockRequestedAt;
  try { await this.prisma.chatMessage.update({ where: { id: userMessageId }, data: { errorCode: 'STREAM_TIMEOUT' } }); } catch { /* best-effort stamp */ }
  const refundResult = await this.paymentService
    .refundLastMessage(userMessageId, sessionId, userId, `stream-deadline-before-ai:${Math.round(elapsedMs / 1000)}s`)
    .catch(() => ({ refunded: false, method: null }));
  this._reportDeadline('pre_ai', { elapsedMs, aiElapsedMs: null, sessionId });
  this._emitError(
    response, 'STREAM_TIMEOUT',
    refundResult.refunded ? '系統忙碌，回覆逾時，點數已退還，請稍後再試' : '系統忙碌，回覆逾時，請稍後再試',
    refundResult.refunded, refundResult.method,
  );
  return;
}

// the interval (:627) — ONE branch per tick
const watchdogTimer = setInterval(() => {
  if (abortController.signal.aborted) {
    return;                                              // already aborted: never relabel, never log again
  } else if (Date.now() >= deadlineAt) {
    deadlineTriggered = true; abortController.abort();   // most specific cause first
  } else if (Date.now() - lastDeltaAt > STREAM_WATCHDOG_MS) {
    this.logger.warn(`Stream watchdog timeout for session ${sessionId}`); // the EXISTING warn at :629 stays here — T3b/T7 count it
    watchdogTriggered = true; abortController.abort();
  }
}, WATCHDOG_POLL_MS);

// the catch at :772
const elapsedMs = Date.now() - lockRequestedAt;
const reason = deadlineTriggered
  ? `stream-deadline-exceeded:${Math.round(elapsedMs / 1000)}s`
  : watchdogTriggered ? 'watchdog-timeout-no-delta-60s' : `ai-stream-failed: …`;
if (deadlineTriggered) this._reportDeadline('mid_stream', { elapsedMs, aiElapsedMs: Date.now() - aiStartedAt, sessionId });
```

## 4. Tests and mutations

Unit, in `test/chat-stream-service.spec.ts`, inside a new `describe` that calls
`jest.useFakeTimers()` in `beforeEach` and `useRealTimers()` in `afterEach` (the
rest of the file stays on real timers). The Anthropic mock receives
`(params, { signal })`. Two kinds of mock wait, used deliberately:

- **abort-aware** — `new Promise((res, rej) => { const t = setTimeout(res, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); })`
  — the default; the generator observes the abort immediately, like the SDK
  does once headers have arrived.
- **abort-blind** (T3b only) — a plain `setTimeout(res, ms)` that ignores the
  signal, then `if (signal.aborted) throw` — mirrors the SDK's retry sleep,
  the one place an abort is observed LATE. This is the only way to exercise the
  interval's `signal.aborted` guard (round-2 #8).

**Every deadline test advances the fake clock to a 600s horizon BEFORE
`await`ing `streamMessage`**, beyond the natural end of every mutant (the T2
generator ends at 400s, M4's T6 deadline lands at 355s), so a mutation produces a
fast, informative red rather than a 5s jest timeout. Slow context builds are
mocked as a SCHEDULED fake timer — `() => new Promise((r) => setTimeout(() =>
r(ctx), 180_000))` — fired by that same outer advance, never as a nested
`advanceTimersByTime` inside the mock (round-2 #5). The house pattern is
`prompt-cache-call2-gate.spec.ts` (`advanceTimersByTimeAsync`). Instant mocks +
fake clock ⇒ the lock, `lastDeltaAt` (`:618`) and the interval (`:627`) all sit
at t = 0 and polls land at 5, 10, …, 205 — the arithmetic below depends on that
and is written into each test as a comment.

| id | test | what it pins |
|---|---|---|
| T1 | `acquireLock('chat-session-stream:s1', 317)` — **the number is hardcoded in the test** with the arithmetic in a comment (`redis-lock.spec.ts` does the same for the script text, so a formula change must be re-pinned on purpose) | TTL is derived and includes the margin |
| T2 | context instant; generator yields a delta every 10s for 40 deltas (ends at 400s) then returns, abort-aware waits; advance 600s; await → `error {code:'AI_CALL_FAILED', refunded:true}`, refund reason matches `/stream-deadline-exceeded:20\ds/`, the mock saw `signal.aborted`, Sentry `phase:'mid_stream'` with a numeric `aiElapsedMs`, user message stamped `AI_FAILED` | mid-stream bite at ~205s; the watchdog did NOT fire (deltas flowed) |
| T3 | one delta at t=0 then an abort-aware silence; advance 600s → reason `watchdog-timeout-no-delta-60s`; Sentry NOT called | the watchdog still works (the 60s watchdog had NO test — this closes that too) |
| **T3b** | one delta at t=0 then an **abort-blind** 210s sleep, then `throw` if `signal.aborted`; advance 600s → reason is the WATCHDOG's; Sentry `captureMessage` NOT called; `logger.warn` calls whose first argument matches `/Stream watchdog timeout/` number exactly ONE (a bare `toHaveBeenCalledTimes(1)` on the warn spy is wrong — `_refundOnError` also warns at `:1052`) | the watchdog fires at 65s but is observed at 210s; ticks 70…205 keep running and the 205s tick must NOT relabel it as a deadline — the `signal.aborted` guard |
| T4 | context mock = scheduled 180s timer → remaining 25s < 30s → `messages.stream` NEVER called, `aiGovernor.acquire` (a `jest.fn`) NEVER called, `error {code:'STREAM_TIMEOUT', refunded:true}` with the 已退還 message, refund reason `/before-ai:180s/`, `chatMessage.update` with `errorCode:'STREAM_TIMEOUT'`, Sentry `phase:'pre_ai'`, `aiSpend.record`/`recordFailure` NOT called; sanity: `shutdown.activeStreamCount === 0` (holds under every placement — the AI `finally` releases too — so it is a sanity check, not a mutation catcher) | pre-check; no spend; no AI-CALL line |
| T5 | context instant, 3 deltas over 20s → `done`; Sentry `captureMessage` not called; the mock never saw `signal.aborted` | negative control — a normal turn is untouched |
| T6 | context mock = scheduled 150s timer; then deltas every 10s (40 of them), abort-aware → abort at 205s total ≈ 55s into the stream; reason matches `/exceeded:20\ds/` **not** `/exceeded:35\ds/` | the clock starts at the LOCK (M4 moves it to the stream start → 355s) |
| T7 | deltas at 10, 20, …, 140 and one at **142s**, then abort-aware silence. At the 200s poll: 200−142 = 58 → watchdog false (under either `>` or `>=`), 200 < 205 → deadline false; at the 205s poll: 63 > 60 → watchdog TRUE **and** 205 ≥ 205 → deadline TRUE on the SAME tick → reason must be `deadline`; NO `logger.warn` call matching `/Stream watchdog timeout/` | check order — with the if/else-if chain, only the first true branch runs, so a swap flips the label |
| T8 (guard spec) | no numeric literal inside `AbortSignal.timeout(` in `chat-context.service.ts`; keys and max of `CHAT_CONTEXT_ENGINE_TIMEOUT_MS` | the TTL cannot drift from the engine timeouts |
| T9 | existing `redis-lock.spec.ts` "every allowlisted prefix is one a lock site really uses" — unchanged, re-run | prefix list intact |
| T10 | as T4 but `refundLastMessage` REJECTS (`P2028`-shaped error) → still `error {code:'STREAM_TIMEOUT', refunded:false}` and the message does NOT contain 已退還; `streamMessage` RESOLVES (no escaped throw); `aiSpend.recordFailure` NOT called; `chatMessage.update` was NOT later overwritten with `AI_FAILED`; `acquire` NOT called | the pre-check's own failure never becomes an "AI failure", and never claims a refund it did not make |

Mutations — each must be SEEN red, and a non-compiling mutation is a non-result,
not a pass (the #3 / #14 lesson):

| M | mutation | expected red |
|---|---|---|
| M1 | `STREAM_LOCK_TTL_SECONDS = 150` | T1 |
| M2 | delete the deadline branch of the chain | T2 (stream completes with `done` at 400s), T6, T7 |
| M3 | delete the pre-check | T4, T10 |
| M4 | compute `deadlineAt = Date.now() + CHAT_STREAM_DEADLINE_MS` **immediately before the pre-check** (i.e. after the context build) instead of as the first statement | T6 (reason `:355s`), T4 (no refusal — 205s remain) |
| M5 | `LOCK_TAIL_CUSHION_SECONDS = 0` AND, separately, `SDK_RETRY_SLEEP_MAX_MS = 0` | T1 (both — the margin is derived, so each moves the TTL) |
| M6 | reason selection drops the deadline label | T2, T6, T7 |
| M7 | swap the deadline and watchdog **branches of the chain** | T7 (label becomes the watchdog's; its warn is logged) |
| M8 | revert compat's literal to `60_000` | T8 |
| M9 | drop the `signal.aborted` first branch | **T3b** (the 205s tick relabels; Sentry `mid_stream` fires) |
| M10 | move the pre-check (verbatim, with its `.catch`) inside the AI try after `aiGovernor.acquire` | T4 and T10 — the **`acquire`-called** assertion (the `.catch` survives the move, so `recordFailure` does NOT fire; the slot is the tell) |
| M11 | pre-check refunds via `_refundOnError` instead of its own `.catch` block | T10 (escaped throw / `AI_CALL_FAILED` / `AI_FAILED` overwrite) |

Plus the whole api suite (`npx --no-install jest` from `apps/api`), `tsc`, and
`./node_modules/.bin/turbo run lint --force` from the root (`0 cached` is the
only proof it ran — CLAUDE.md; this is also what proves every constant is used).

Live, local stack (the deadline itself cannot be triggered without a slow mock,
and the mock-anthropic service has no trickle mode — unit coverage is the proof
for the bites): one real chat turn with `redis-cli MONITOR` → the lock is written
with `EX 317` and released by the compare-and-delete script; one browser chat
turn end to end to confirm nothing regressed on the happy path.

## 5. Deploy and ops

- No migration, no env var, no cache/version bump (prompt text unchanged).
- Mixed fleet mid-deploy is safe: old replicas hold 150s locks, new ones 317s;
  each only releases what it acquired (#23).
- **Owner, after deploy:** in Sentry, if the
  `redis.lock.lost_before_release {chat-session-stream, overran_ttl}` issue
  exists, note its event count (the measurement #26 waited for) and **Resolve**
  it; if the runbook's step-3 fallback rule filter was ever added, **remove it**
  — a recurrence must alert as a regression. Then watch for the new
  `chat.stream.deadline_exceeded` issue for a week; `pre_ai` fires would point at
  engine/pool latency, not at this change.

## 6. Residuals and out of scope (listed so they are not re-filed)

- **Pre-AI phases can still run unbounded** under a hung Redis command (no
  `commandTimeout`), a slow-EXECUTING Postgres query (no `statement_timeout`), or
  an engine hang that somehow survives its `AbortSignal.timeout`. The pre-check
  refuses when they finally return; if that takes longer than the TTL, BOTH
  `overran_ttl` and `deadline_exceeded{pre_ai}` fire and the runbook says so.
  Bounding Redis commands and Postgres statements is its own item.
- **The S4 daily quota is consumed at `:350` and is NOT restored by any chat
  refund path** (`refundLastMessage` restores FREE_QUOTA / PAID_ALLOWANCE only;
  `QuotaService` has no release). Pre-existing for every refusal on this surface;
  "no spend" in this plan means no Anthropic spend. A `quota.release` is a
  separate small item (limit is 200/day, cost negligible).
- **`messages-sync` (`chat.service.ts::sendMessage`) takes NO session lock at
  all**, so it can run concurrently with a stream on the same session. It is the
  CI/eval endpoint, not what the clients use; pre-existing; not touched.
- **SDK `maxRetries: 2` on the chat client** (the #6 plan's F5): its retry sleep
  is why the margin is 112 and not 94. `maxRetries: 0` for interactive chat
  would shrink the margin and fail faster on a 429 — a behaviour change, its own
  decision, not this one.
- **Threading an abort through the context build** — see §2.4.
- **A client disconnect DURING P1–P3 is invisible** (pre-existing, found by the
  backend line audit): `response.on('close', …)` is registered only after the
  context build, and `'close'` fires once — so a client that gives up during a
  slow cold build, when the pre-check still passes (> 30s left), gets a full
  Anthropic call billed with no consumer. Not a regression; cheap future fix
  is a `response.destroyed` check beside the pre-check.
- **Wall clock, not monotonic**: the deadline and the watchdog both use
  `Date.now()` (the watchdog always has). An NTP step could cut a healthy
  stream or let one outlive the TTL. `performance.now()` is the optional fix;
  not taken here to keep the change to one mechanism.
- **Railway edge timeout for a 205s SSE** — unverified; readings stream 180s in
  production today. If the edge cuts earlier, the client sees a dropped
  connection, the server's `close` handler refunds (`:639`), and the deadline
  never matters — the TTL still holds.
- **`extendLock`** — not built; §2.1.
- **`_refundOnError`'s own message always says 已退還點數** even when its refund
  returned `refunded:false` — pre-existing, same class as round-2 #2; the new
  pre-check does it right, the old helper is untouched here.

## 7. Review log

### Round 1 (2026-10-02) — VERDICT: REVISE. 14 issues; all addressed in v2.

| # | sev | finding | disposition |
|---|---|---|---|
| 1 | low | T4 cannot assert on the inline governor stub / private `activeStreams` | §3 harness: `acquire: jest.fn`, keep a `ShutdownService` handle, assert `activeStreamCount` |
| 2 | low | a Sentry mock without `addBreadcrumb` breaks the refund-cap tests | §3: mock both `captureMessage` and `addBreadcrumb` |
| 3 | low | stale comments at `ai.service.ts:396-404` and `chat-stream.service.ts:637` not in the change list | §3: both added |
| 4 | low | `deadlineAt` declared inside the try is out of scope for the interval closure | §2.2: first statement of `_streamWithLock` |
| 5 | low | the interval can relabel an already-aborted stream on a later tick | §2.4: `signal.aborted` guard first; T3b + M9 (v3) |
| 6 | low | §1 inexact: governor `while` re-wait; P6 is 3 reads + 2 tx; tx bounded by Prisma defaults not `pool_timeout` | §1 rewritten |
| 7 | low | "refuse before spending" is false for S4 (quota consumed at `:350`, never restored) | §6 residual; wording changed to "no Anthropic spend" |
| 8 | low | a mid-stream cut after OUR pre-AI slowness is still labelled `AI_CALL_FAILED` | §2.4 accepted + documented; `aiElapsedMs` added to the Sentry extra |
| 9 | low | runbook pointed `overran_ttl` at the post-stream phase; the unbounded ones are pre-AI | §3 runbook row rewritten, pre-AI first; both-signals case stated |
| 10 | med | margin sized for the normal path; the abort path's SDK retry sleep (≤ 60s, ignores the signal) makes the tail ≈ 92s | §2.3: `SDK_RETRY_SLEEP_MAX_MS` named and (v3) USED in the derivation |
| 11 | med | T2/T6 would HANG under their own mutations; silence waits must be abort-aware | §4: 600s horizon before `await`; abort-aware waits; T6 pins the elapsed figure |
| 12 | high | the "ordering trap" is false — the AI `finally` at `:819` releases the registration on a `return` | paragraph deleted; old M9 deleted |
| 13 | high | a pre-check inside the AI try routes its own refund failure into the AI-failure catch | §2.4: pre-check moved BEFORE `:617`, own block with `.catch`, `_refundOnError` untouched; T10 + M10/M11 |
| 14 | crit | T7 was a false test — with the last delta at 150s the two conditions are never true on the same tick | §4 T7: last delta at 142s; arithmetic in the test |

### Round 2 (2026-10-02) — VERDICT: REVISE. 8 issues; all addressed in v3.

| # | sev | finding | disposition |
|---|---|---|---|
| 1 | low | `chat-api.ts:303` → `:294` | §2.6 fixed |
| 2 | low | the pre-check's fixed message claims 已退還 even when `refunded:false` | §2.4 / sketch: message chosen from `refundResult.refunded`; T10 asserts the clause is absent; `_refundOnError`'s same pre-existing flaw noted in §6 |
| 3 | low | M4 ambiguous — "use `Date.now()` in the first statement" is an equivalent mutant under instant mocks | §4 M4 reworded: compute `deadlineAt` immediately before the pre-check; red = T6 (`:355s`) and T4 |
| 4 | low | M10's red was attributed to T10's `recordFailure`; the moved block keeps its `.catch`, so the real tell is T4's `acquire` assertion; `activeStreamCount === 0` catches nothing | §4: M10 → the `acquire` assertion (T4, T10); `activeStreamCount` relabelled a sanity check |
| 5 | low | nested `jest.advanceTimersByTime` inside the context mock is a harder-to-read nested tick | §4: slow context builds are SCHEDULED fake timers fired by the one outer advance |
| 6 | med | `SDK_RETRY_SLEEP_MAX_MS` declared but unused → `no-unused-vars` fails the plan's own lint step; the margin was a bare literal, not derived | §2.3: `NORMAL_TAIL_MS` / `ABORT_TAIL_MS` / `POOL_WAIT_BOUND_MS` (from `DEFAULT_POOL_TIMEOUT`) / `PRISMA_TX_BOUND_MS` / `LOCK_TAIL_CUSHION_SECONDS`; margin = ceil(max(74, 92)) + 20 = 112; TTL 317; T1 re-pinned; M5 now mutates two inputs (the normal tail was later revised 74 → 79 by the line audit, §8 — margin and TTL unchanged) |
| 7 | high | with two independent `if` blocks (only the deadline one `return`ing), swapping them sets BOTH flags and the label is unchanged — M7 survived T7 | §2.4: interval is an `if / else if / else if` chain; M7 = swap the branches; T7 also asserts the watchdog warn was NOT logged |
| 8 | high | M9 could not go red against T3: an abort-aware wait makes the catch `clearInterval` in the same flush, so no later tick exists | §4: new **T3b** with an abort-BLIND 210s sleep (mirrors the SDK retry sleep) — the only way to reach a post-abort tick; M9 re-pointed at T3b |

### Round 3 (2026-10-02) — VERDICT: APPROVE. 2 low polish items; both folded into v3.1.

| # | sev | finding | disposition |
|---|---|---|---|
| 1 | low | the deadline clock started AFTER `acquireLock` returned, so a slow acquire round trip (no `commandTimeout`) would start it later than the TTL clock and eat the margin | §2.2 / sketch / §3: `lockRequestedAt = Date.now()` taken BEFORE the acquire is the deadline's origin — at or ahead of the TTL clock by construction |
| 2 | low | the v3 interval sketch dropped the existing watchdog warn (`:629`) that T3b/T7 assert on; and a bare warn-count would also count `_refundOnError`'s warn (`:1052`) | sketch keeps the warn inside the watchdog branch; T3b/T7 count only calls matching `/Stream watchdog timeout/` |

Reviewer's round-3 walk-throughs, recorded because they ARE the proof the tests
bite: T7 under M7 — at the 205s tick the swapped first branch (watchdog) sees 63 >
60, sets `watchdogTriggered`, aborts and warns; `else if` skips the deadline
branch; the label is the watchdog's → red twice. T3b under M9 — with the
`signal.aborted` branch gone, ticks 70…200 re-run the watchdog branch (27 extra
aborts + warns) and the 205s tick runs the deadline branch, flipping the label
and firing Sentry `mid_stream` → red three ways. M5: cushion 0 → TTL 297; SDK
sleep 0 → `ABORT_TAIL` 32s, `NORMAL_TAIL` 74s is the max, margin 94, TTL 299 —
both ≠ 317. Every §2.3 constant is on the derivation chain (no
`no-unused-vars`); `database-url.ts` imports only `./replica-count` — no cycle.

## 8. Implementation log (2026-10-02)

Built as v3.1. Files touched (`git diff --stat` + untracked): `apps/api/src/chat/chat-stream.service.ts`, `apps/api/src/chat/chat-context.service.ts`, `apps/api/src/ai/ai.service.ts` (comment), `apps/api/test/chat-stream-service.spec.ts`, `apps/api/test/chat-context-engine-timeouts.guard.spec.ts` (new), `CLAUDE.md`, `docs/ops/incident-runbook.md`, `.claude/plans/launch-security-phase1-session-handoff.md`, this file. ⚠️ The same uncommitted diff also carries the UNRELATED correction of the handoff's stale todo #6 entry (prompt caching, done earlier the same day) — the owner asked for both in one session.

**Worktree gotcha hit again:** the generated Prisma client was stale (14 `tsc` errors in untouched files — `cacheReadTokens`, `outputTokensEstimated`), the exact gotcha todo #3 recorded. `../../node_modules/.bin/prisma generate` from `apps/api` fixed it; it writes to the worktree's own `node_modules`.

### Mutations — all 12 SEEN red, by test name (runner: scratchpad `mutate.mjs`, `jest --verbose`, failure headers parsed, source restored and diff-stat-verified after each)

| M | mutation applied to the real source | red tests |
|---|---|---|
| M1 | `STREAM_LOCK_TTL_SECONDS = 150` | T1 |
| M2 | deadline branch deleted from the chain | T2, T6, T7 |
| M3 | pre-check condition → `false` | T4, T10 |
| M4 | `deadlineAt` computed from `Date.now()` immediately before the pre-check | T4, T6, T10 |
| M5a | `LOCK_TAIL_CUSHION_SECONDS = 0` (TTL 297) | T1 |
| M5b | `SDK_RETRY_SLEEP_MAX_MS = 0` (TTL 299) | T1 |
| M6 | reason selection drops the deadline label | T2, T6, T7 |
| M7 | deadline and watchdog branches swapped | T7 |
| M8 | compat `AbortSignal.timeout(60_000)` literal restored | T8 both guard tests |
| M9 | `signal.aborted` first branch → `false` | T3b |
| M10 | pre-check moved inside the AI try after `aiGovernor.acquire` | T4, T10 |
| M11 | pre-check refunds via `_refundOnError` | T4, T10 |

(M4 also reddens T10 — same shape as T4, expected. Every mutant compiled; none was a non-result.)

### Suites
- `chat-stream-service.spec.ts` + `chat-context-engine-timeouts.guard.spec.ts`: **29/29** (18 existing + 8 new + 3 guard).
- Full api jest: **148 suites / 2,778 passed / 5 skipped / 0 failed** (2,775 before the three post-audit tests).
- `tsc --noEmit`: 0. `eslint --max-warnings 0` on the five touched files: 0. `turbo run lint --force`: **5/5, 0 cached**.

### Line audit (3 parallel agents: backend code / tests / docs) — every finding fixed the same day
- **Docs agent — FIX NEEDED → fixed.** 2 high: the runbook named `GET /api/admin/ops` → `pools` for DB-pool saturation (that is the in-process AI-governor pool, not Prisma — now `pg_stat_activity` + the boot log line) and `ENGINE-AUTH-ROLLUP` for engine latency (it carries no timing — now the engine's logs/Sentry). 4 medium: stale plan status; mutation results unrecorded; a surviving "archive it" in the handoff's history block; the new runbook section inserted between the two `###` children of the lost-lock section (moved after `lost_early`). 7 low (wording; "the user was refunded" → "a refund was attempted"; P1–P3 spelled out).
- **Backend agent — CLEAN**, 11 low, 9 folded in: the normal tail starts up to one poll AFTER the deadline (P6 is only reached by a stream that finished between ticks) → `NORMAL_TAIL_MS` = 5 + 14 + 60 = **79s** (was 74; `ABORT_TAIL_MS` 92 is still the max, so margin 112 and TTL 317 are unchanged); `_reportDeadline('mid_stream')` HOISTED to the top of the catch so the client-disconnect and typed-503 early returns cannot swallow it; the pre-check's refund `.catch` now logs the error NAME and `_reportDeadline` logs `refunded=`; the pre-check cost figure is the 1h-TTL write rate (~$0.18, recovered only on a retry within the hour); "could start" not "started"; P2's own DB/Redis round trips named as unbudgeted; an operator `pool_timeout` ABOVE 20s is outside the derivation; the `:637` comment reworded again. Not taken: `performance.now()` (the watchdog has always used `Date.now()`); a `response.destroyed` check in the pre-check for a disconnect during P1–P3 (pre-existing, filed as a residual in §6).
- **Tests agent — FIX NEEDED → fixed.** 3 medium: the T4 "sanity check" was the ONLY guard against a pre-check moved to after the close listener (which leaks the interval, the registration and the listener) → `drive()` now asserts `jest.getTimerCount() === 0` and `activeStreamCount === 0` after EVERY run, and that nothing escaped `streamMessage` (handler attached before the advance) — mutation **M12**; the Sentry `extra` timings were never pinned → T2/T4/T6 assert EXACT `{elapsedMs, aiElapsedMs, deadlineMs}` + `level` + `fingerprint` — mutation **M16**; T8 pinned sites→object but nothing pinned object→TTL → a `jest.isolateModules` probe loads `chat-stream.service` with compat 90s and expects 235s / 347s — mutation **M15**. 8 low: new **T4b** (`<` not `<=` at exactly 30s left — mutation **M14**) and **T6b** (clock taken BEFORE the acquire: a 10s acquire timer → 19 deltas and `aiElapsedMs` 195000, vs 20 / 205000 after — mutation **M13**); `waitAbortAware` handles an already-aborted signal and removes its listener; abort-aware silence now ends at 500s (< the horizon) so a never-aborting mutant fails on `done`, not on jest's timeout; guard regex is a negative lookahead and counts `engineFetch(` sites; T3/T5 renamed to what they pin; T1's comment no longer overclaims.

### Mutations after the audit — all 17 SEEN red, by test name (12 original + M12–M16)

| M | mutation | red tests |
|---|---|---|
| M12 | pre-check block moved to after `response.on('close', …)` (inside the scheduled/registered window) | T4, T10 (`getTimerCount` / `activeStreamCount` in `drive()`) |
| M13 | `lockRequestedAt` taken AFTER `acquireLock` returns | T6b |
| M14 | pre-check `<` → `<=` | T4b |
| M15 | `CHAT_CONTEXT_BUILD_BOUND_MS = 60_000` literal | guard probe («the deadline and the TTL MOVE with the engine timeouts») |
| M16 | `aiElapsedMs` measured from `lockRequestedAt` | T6, T6b |

M1/M5a/M5b now ALSO redden the guard probe (its expected 235s/347s shift with the TTL/margin) — more red, same guards. Final: `chat-stream-service.spec.ts` + guard spec **32/32**.

### Live (local stack, this worktree's build on API :4001 / web :3001, engine shared on :5001, owner signed in on the built-in browser)
- A stale (>24h) LIFETIME session was refused `SESSION_EXPIRED` BEFORE the lock (Redis MONITOR shows no `SET` for it — correct, pre-existing door).
- New session, one real turn («我今年的事業運勢如何？»): streamed to `done` (丙午流年 / 戊戌大運 answer, 315 chars persisted, user row `error_code` null, not refunded). `AI-CALL {"route":"chat:stream",…,"ms":12000,"outTok":343,"cacheWriteTok":30173,…,"outcome":"ok"}` against real Anthropic.
- Redis MONITOR: `set chat-session-stream:<id> "<uuid>.<ms>.317" EX 317 NX` → 12.1s later `eval` compare-and-delete with the SAME token → `GET` + `DEL`. Held 12s, released by its owner.
- API log: 0 lines matching deadline / watchdog / STREAM_TIMEOUT / CONCURRENT_STREAM / lost-lock.
- ⚠️ That first turn ran on the PRE-audit build: the post-audit restart had used `kill $(lsof -ti:4001)`, which returned a client socket's PID too, killed nothing, and the new process died `EADDRINUSE` while `/health/ready` kept answering 200 from the old one. Caught by checking the LISTEN pid. Restarted properly (`-sTCP:LISTEN`), dist verified to carry the post-audit lines, and a **second turn on the FINAL build** (pid 64782): `AI-CALL {"route":"chat:stream",…,"ms":1696,"inTok":388,"outTok":17,"cacheReadTok":30173,"cacheWriteTok":0,…,"outcome":"ok"}` (the 1h-cached system block read back), Redis `set … EX 317 NX` → compare-and-delete 1.8s later with the same token, session `message_count` 2, four clean rows, no deadline/watchdog lines.
- The deadline FIRING cannot be exercised live (no slow-Anthropic mock); it is pinned by the fake-timer tests + mutations above.
