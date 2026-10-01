# PR #73 code-review fixes — implementation plan

**Status:** v3 **APPROVED** by the staff-engineer reviewer, round 3, 2026-09-29 (rounds: 1 REVISE/13 · 2 REVISE/5 · 3 APPROVE/3 optional nits, folded in). **IMPLEMENTED 2026-10-01** on the same branch (follow-up commit on `0fd56e0`); line-audited (3 parallel slices, all CLEAN — 15 lows, all applied) and live-tested — record in § 10.
**Branch:** `claude/launch-security-phase1-review-05ef66`, on top of `0fd56e0` (PR #73, CI green, unmerged).
**Source:** the `/code-review` of PR #73 — 5 reviewers, 9 candidate findings scored by a separate verifier (A–E, G at 75; F, H at 50; I at 35 → dismissed), plus 2 informational notes. Parent plan: `.claude/plans/fix-health-reading-dispatch.md` (§ 3.3–3.7 are what this amends).
**Outcome:** ONE follow-up commit on the same branch; PR #73 stays open for the owner's merge.

Line numbers below are against `0fd56e0` unless stated.

---

## 0. Scope and the one design decision

Eight findings split into **one behavioural change** (A) and **seven text/test changes** (B–H). Everything hangs on A, so it is decided first:

> **A paid, empty, non-streamable row is refunded at the point we refuse it, and the web is allowed to reach that refusal.**

Why this shape and not another:

- **Refund server-side, at 2b.** Every row that reaches step 2b is charged-and-empty *by construction*: 1b turns away refunded rows, 1c never-paid rows, step 2 rows with content. So "the user keeps whatever the row holds" (the current comment) is always "nothing". The CLAUDE.md rule is exact about this: "a refusal WE issue must not leave the user charged — and the receipt must say so". `refundReadingCredit` is already atomic and idempotent on `refundedAt: null && creditsUsed > 0`, sets `refundedAt` (which makes 歷史分析記錄 show 已退款 — PR #71) and writes the ledger row. Nothing new is needed on the money side; it only has to be *called*.
- **The web must reach it.** PR #73 made the web recovery predicate fail closed on type, so a web user opening such a row never calls the stream — the refund would be unreachable for exactly the client that matters. The type gate's two stated reasons are both gone: the API no longer narrates LIFETIME over the row (2b + the throwing `default:`), and the round-trip is no longer wasted — it *is* the refund. So the gate comes out, and `recoverPaidReading`'s `onError` shows the existing refund banner when the SSE error says the row was refunded.
- **Not at `default:`** (finding I, dismissed at 35). `default:` is a code-drift 500, not a product refusal; the row it strands is of a type that *should* stream, and the standard recovery path fixes it the moment a `case` is added. Refunding there would foreclose that. Unchanged.
- **Not by a one-off SQL remediation.** The owner waived Step 0 because there are no production customers. That makes the *data* question moot today; it does not make the *code* honest. This fix removes the class rather than the instances.

Ordering invariants that MUST survive (all pinned by tests today, re-pinned in § 1.6): 2b stays after step 2 and before slot / lock / cap / quota; the refund happens **before** the throw (CLAUDE.md: "Refund before re-throwing"); 2b stays outside the `try`, so the backstop cannot double-refund (idempotent anyway).

**Reachable-state table** (round-1 verified; keep it, it is the argument):

| row state at the door | `_setupStream` | `regenerateReading` type branch |
|---|---|---|
| non-streamable, content present | served by step 2 — never reaches 2b | WHERE excludes; refused, **no refund** (content kept) |
| non-streamable, empty, charged, not refunded | **2b: refund + refuse** | WHERE excludes; **refund + refuse** |
| non-streamable, empty, `creditsUsed 0` | 1c refuses (never paid) | refused, no refund (nothing charged) |
| non-streamable, refunded | 1b refuses | refused with type code, no refund (already back) |
| streamable, any | not this change | not this change |

No HEALTH/ZWDS row can be generation-in-flight (HEALTH never took the streaming create; the DTO rejects both types today), so nothing here races `isFirstGenerationInFlight`.

---

## 1. Fix A — refund the paid-empty non-streamable row where we refuse it

### 1.1 API — one private helper, used by both doors

`apps/api/src/bazi/bazi.service.ts`, new private method next to `_setupStream`:

```ts
/**
 * A row we REFUSE to generate for, that holds no content, and was charged:
 * give the credits back at the point of refusal (CLAUDE.md § "A refusal WE
 * issue must not leave the user charged"). Two doors call this — `_setupStream`
 * step 2b and `regenerateReading`'s type refusal — with the same predicate.
 *
 * Returns true only when THIS call moved the money. False when there was
 * nothing to refund (content present / never charged / already refunded), when
 * a concurrent caller won `refundReadingCredit`'s atomic guard, or when the
 * refund THREW — logged at ERROR and swallowed, because the caller's refusal
 * must reach the client (a lost refund is findable in the log; a swallowed
 * refusal is not). ⚠️ Logs the error NAME only, never `.message` — a Prisma
 * error can echo query arguments (domain PII rule).
 *
 * ⚠️ `!(creditsUsed > 0)`, not `creditsUsed === 0`: fails CLOSED on a row
 * whose `creditsUsed` is missing (`undefined === 0` is false — the trap
 * `_setupStream`'s DO-NOT-select note describes). A refund must never fire on
 * a row this code cannot see the charge of.
 */
private async refundUnservableRow(
  reading: { id: string; userId: string; readingType: ReadingType; creditsUsed: number;
             refundedAt: Date | null; aiInterpretation: unknown },
  reason: string,
): Promise<boolean> {
  if (reading.aiInterpretation || !(reading.creditsUsed > 0) || reading.refundedAt) return false;
  try {
    const r = await this.creditsService.refundReadingCredit(reading.id, reason);
    if (r.refunded) {
      this.logger.warn(
        `[Refund] ${r.amount} credits returned for reading=${reading.id} user=${reading.userId} ` +
          `type=${reading.readingType} — ${reason}`,
      );
    }
    return r.refunded;
  } catch (err) {
    this.logger.error(
      `[Refund] FAILED for reading=${reading.id} user=${reading.userId} (${reason}): ` +
        `${err instanceof Error ? err.name : 'unknown'}`,
    );
    return false;
  }
}
```

Reason tag: `not-streamable:<READING_TYPE>` → ledger `refund: not-streamable:HEALTH`. Follows the existing `self-refusal:<CODE>-<TYPE>` convention of naming *why* rather than `ai-failed-…` (ai.service.ts:1694 comment); nothing in the codebase parses ledger reasons except one `startsWith('tier_upgrade_refund')` in chat.service, so no consumer is affected.

The predicate inside the helper re-checks conditions that are true *by construction* at 2b. That is deliberate: the helper is shared with `regenerateReading`, where they are NOT by construction, and a helper that trusts its caller is the "well-covered helper behind untested wiring" shape CLAUDE.md warns about. The `aiInterpretation` conjunct is load-bearing ONLY at the regenerate door (a degraded HEALTH row with partial content) — which is where its mutation is caught (§ 1.6 m4).

### 1.2 API — `_setupStream` step 2b (`bazi.service.ts:1059-1089`)

Replace the comment paragraph at `:1074-1077` and the body of the `if`:

```ts
// ⚠️ Every row that reaches this line is CHARGED and EMPTY — not "keeps
// whatever it holds". 1b turned away the refunded rows, 1c the never-paid
// ones, step 2 the ones with content. A refusal we issue on a charged row
// must give the money back HERE, at the refusal (CLAUDE.md). This is the
// only PERMANENT refusal on a charged row in this method (3 and 3b below are
// transient — the row stays recoverable — and also sit outside the `try`);
// it sits OUTSIDE the `try` on purpose (nothing to release), so the refund
// backstop in the catch never sees it, self-refusal or not. Refund BEFORE
// the throw. Idempotent: `refundReadingCredit` guards atomically, so two
// tabs opening the same row refund once. On this `@Sse` route the client
// sees `event: error` with `{message, code, refunded, refundedAmount}` — see
// `streamReading`; the web reuses its AI-failure refund banner on `refunded`.
if (!(STREAMABLE_READING_TYPES as readonly ReadingType[]).includes(reading.readingType)) {
  this.logger.warn(/* unchanged */);
  const refunded = await this.refundUnservableRow(reading, `not-streamable:${reading.readingType}`);
  throw new BadRequestException({
    code: 'READING_TYPE_NOT_STREAMABLE',
    refunded,
    refundedAmount: refunded ? reading.creditsUsed : 0,
    message:
      (reading.readingType.startsWith('ZWDS')
        ? '紫微斗數功能已停用，此報告無法生成'
        : '此類型分析已停止提供，無法生成') + (refunded ? '，點數已退回。' : '。'),
  });
}
```

- `refunded` in the message is driven by the helper's RESULT, not by intent: if the refund threw or lost the race, the message does not claim money moved. (Race-lost means a concurrent caller refunded — credits are back, the second tab's message just does not say so. Accepted; the banner in the first tab does.)
- Message wording changes: HEALTH 「不支援串流生成，無法重新生成」 → 「已停止提供，無法生成」 (the row was never generated; "re" was wrong). The existing spec asserting `'不支援串流生成'` is updated (§ 1.6). Nothing else asserts either string (e2e, mobile: grep clean).
- The `include`-only `findFirst` at `:985` is untouched (the DO-NOT-select warning stands); the helper reads `userId`, `creditsUsed`, `refundedAt`, `aiInterpretation`, `readingType`, all present.
- The `await` on a DB transaction lands above the slot / lock; the S2→S4 slice `quota-wiring.spec.ts` guards starts at `assertUnderCap('reading:stream')`, so it is outside that window. No new `quota.consume(` and no new `isSelfRefusal(err)) throw err;` line, so the source-level counts in that spec are unchanged.

### 1.3 API — `regenerateReading` type refusal (`bazi.service.ts:757-768`)

Same helper, same reason tag, before the throw. **No `refunded`/`refundedAmount` on this exception**: `regenerateReading` is a plain `@Post`, and `AllExceptionsFilter` (`all-exceptions.filter.ts:37-47, :119-126`) forwards only `statusCode` / `code` / `message` / `error` / `timestamp` / `path` — extra keys never reach a client, and both clients read `message` only. On this route the **message is the receipt**. (Extending the filter would touch every route; out of scope.)

```ts
// Checked BEFORE the isDegraded/exhausted answers: those would describe a row
// this endpoint is never going to regenerate. The WHERE above never touched
// the row. If it holds content (a pre-fix degraded HEALTH row narrated by
// `streamLifetimeV2`) the user keeps it — no refund. If it is charged-and-
// EMPTY, nothing can ever be generated for it: refund at the refusal, same
// rule and same helper as `_setupStream` step 2b. The message carries the
// receipt; this route's exception filter forwards `code` + `message` only.
if (!(STREAMABLE_READING_TYPES as readonly ReadingType[]).includes(reading.readingType)) {
  this.logger.warn(/* unchanged */);
  const refunded = await this.refundUnservableRow(reading, `not-streamable:${reading.readingType}`);
  throw new BadRequestException({
    code: 'READING_TYPE_NOT_STREAMABLE',
    message: '此類型分析不支援重新生成' + (refunded ? '，點數已退回。' : '。'),
  });
}
```

Reachable only by a direct API caller (the web renders the regenerate control for degraded rows, which have content). Included because the rule is per-door and the helper makes it three lines.

### 1.4 API — the SSE error event carries the typed fields (`streamReading`, `:928-935`)

Today the `.catch` forwards `err.message` only, so `code` / `refunded` never reach a client. Forward them, **picked by name**:

```ts
.catch((err) => {
  const message = err instanceof Error ? err.message : 'Stream setup failed';
  // Typed fields a client can act on, picked by NAME. An exception built from
  // an object (`new BadRequestException({code, …})`) has exactly that object as
  // its response; one built from a STRING (`new ConflictException('…')`, step 3)
  // has `{message, error, statusCode}` — never spread, or those leak.
  const resp = err instanceof HttpException ? err.getResponse() : null;
  const t = resp && typeof resp === 'object'
    ? (resp as { code?: string; refunded?: boolean; refundedAmount?: number })
    : {};
  subscriber.next({
    data: JSON.stringify({
      message,
      ...(t.code !== undefined && { code: t.code }),
      ...(t.refunded !== undefined && { refunded: t.refunded, refundedAmount: t.refundedAmount ?? 0 }),
    }),
    type: 'error',
  } as MessageEvent);
  subscriber.complete();
})
```

- `HttpException` is already imported (`bazi.service.ts:9`). Nest 11.1.28 verified: `initMessage` sets `err.message = response.message` for an object body; `getResponse()` returns the object as passed.
- Backward compatible: web (`readings-api.ts:1243` passes `data` through) and mobile (`readings-api.ts:1019` reads `message`; mobile has NO recovery path — it streams only post-create / post-regenerate) both ignore unknown keys; `load-test/k6/s2-mix.js` only times the stream. `code` now reaches clients for every typed refusal on this route (READING_REFUNDED, READING_NOT_PAID, quota/cap codes); nothing branches on it yet except the new web `refunded` branch.
- The comment in `apps/api/test/reading-paywall.spec.ts:253-259` ("streamReading forwards only `err.message` … the contract it claimed to guard does not exist") becomes false and is rewritten: the contract now exists and is pinned by the new tests in § 1.6.

### 1.5 Web — reach the refusal, show the refund honestly

**`apps/web/app/lib/readings-api.ts:529-580`**

- Delete the web `STREAMABLE_READING_TYPES` copy (readers verified: `:533` decl, `:559` doc, `:575` predicate, the spec's `:1` and `:58` — nothing else). Keep `STREAMABLE_READING_SLUGS` (drives `stream: true` on create; parity-locked in § 3).
- `needsInterpretationRecovery` loses the type gate and the `readingType` parameter (only caller: `page.tsx:605`, passing the whole `reading`):

```ts
export function needsInterpretationRecovery(
  reading: { creditsUsed: number; refundedAt?: string | null },
  sectionCount: number,
): boolean {
  return sectionCount === 0 && reading.creditsUsed > 0 && !reading.refundedAt;
}
```

Docblock: replace the "FOURTH condition … fails CLOSED" paragraph with — "todo #3 briefly added a type gate here (fail closed). It was REMOVED in the PR #73 review fixes: the API is the guard (`_setupStream` step 2b refuses AND refunds a charged-empty row), so sending such a row to the stream is not a wasted round-trip — it is how the user gets their credits back. The three conditions above are complete: a refunded row (`refundedAt`) is the post-refund state and is left alone."

- `streamBaziReading`'s `onError` type (`:1169`): `{ message: string; partial?: boolean; code?: string; refunded?: boolean; refundedAmount?: number }`.

**`apps/web/app/reading/[type]/page.tsx`**

- `refundedInfo` state (`:273`) gains an optional `body`: `{ refunded: boolean; amount: number; body?: string }`. The banner body (`:1763`) renders `{refundedInfo.body ?? 'AI 服務目前繁忙，請稍候片刻後再試一次。'}` before the refund sentence. The three existing `setRefundedInfo` sites (`:757`, `:1544`, `:1704`) do not set `body`, so the AI-failure copy is unchanged for them. Why: the default line tells the user to *retry* — wrong for a withdrawn product, and it would contradict the server's own message on the same screen. The "receipt must say so" rule applies to the surface the user looks at.
- `loadSavedReading` comment block `:596-605` ("⚠️ The predicate is TYPE-AWARE and fails closed …"): rewrite to the § 1.5 rationale (one paragraph: the API refuses and refunds; the web's job is to *reach* it).
- `recoverPaidReading` `onError` (`:1576`):

```ts
// A charged-EMPTY row the API cannot stream (HEALTH / ZWDS — todo #3) is
// REFUNDED at the refusal (`_setupStream` step 2b) and the SSE error says so.
// Same money event as an AI failure → same banner and the same page-local
// credit bump as `onFinal`'s failed branch above, with the server's message
// as the banner body (the default body says "retry", which is wrong here).
// The banner adds its own 「N 個額度已自動退回」 line, so the message's
// trailing 「，點數已退回。」 is trimmed for the body only — the wire message
// is untouched for API/mobile callers.
// `aiData` goes back to null: that is `loadSavedReading`'s own initial state
// for this row (`transformAIResponse(null)`). It also keeps the chat button
// absent — already null-typed for these pages (`chatType` is null for
// HEALTH/ZWDS); `!aiData` guards it generically. These types use the TABBED
// layout, so AIReadingDisplay is gated on the reading tab, not on `aiData`;
// the user lands on the chart tab with the banner.
// Other errors keep the pre-existing behaviour (spinner stops; the row stays
// recoverable on the next open).
onError: (err) => {
  setIsAiLoading(false);
  setRetryStatus(null);
  if (err.refunded) {
    const amount = err.refundedAmount ?? existing.creditsUsed ?? 0;
    setAiData(null);
    setRefundedInfo({
      refunded: true,
      amount,
      body: err.message.replace(/，點數已退回。$/, '。'),
    });
    if (amount > 0) setUserCredits((prev) => (prev !== null ? prev + amount : prev));
  }
},
```

`existing` is the `getReading` result in the enclosing `try` (`:1475`, same scope as this `onError`) and `NestJSReadingResponse.creditsUsed` is typed. The top refund banner (`:1745`, `aiBannerRefunded`) renders inside `step === "result"` (`:1932`) independently of `AIReadingDisplay`, and the `refundedInfo` effect (`:282-286`) scrolls it into view. `setUserCredits` is page-local state (`:259`): it drives the unlock button's 「剩 N」 and the modals — NOT the header `CreditBadge`, which owns its own fetch and exposes a `refresh()` the page never holds. That is the same limitation `onFinal`'s failed branch has today; parity is kept, the header catches up on its next fetch.

Layout facts this relies on (round-2 verified): `isFullPageLayout` is LIFETIME/CAREER/ANNUAL/LOVE only (`page.tsx:176`), so HEALTH and ZWDS render the TABBED layout, where `AIReadingDisplay` is gated on `tab === "reading"` (`:2116`) — not on `aiData` — and `loadSavedReading` lands on the chart tab (`:573`). On the reading tab, `aiData` null and `{sections: []}` render the same pre-existing 「暫無解讀資料」 card (`AIReadingDisplay.tsx:1751-1758`). The bottom banner instance (`beforeDisclaimer`, `AIReadingDisplay.tsx:2292`) sits in the component's full RENDER path, past the 「暫無解讀資料」 early return at `:1751`, in both layouts — so a section-less row never renders it and resetting `aiData` loses no banner; the top instance (`page.tsx:1960`) is the one the user sees.

The end state on the web for a paid-empty HEALTH row opened from history: chart tab renders → predicate true → stream → 2b refunds → top banner 「命理分析暫時無法完成 / 此類型分析已停止提供，無法生成。 您的 2 個額度已自動退回，未扣除任何費用。」 + the page's 剩 N counter +2, no chat button (never mounted for these types); the 命理解讀 tab shows the pre-existing 暫無解讀資料 card → on the next open `refundedAt` is set → predicate false → no stream, and 歷史分析記錄 shows 已退款.

### 1.6 Tests

**`apps/api/src/bazi/bazi.service.self-refusal-refund.spec.ts`** (dispatch describe, `:236-320`, and ZWDS describe `:190-234`)

| test | change |
|---|---|
| "REFUSES a paid-empty HEALTH row before anything is spent" | rename "… and REFUNDS it": `refundReadingCredit` called ONCE with `('reading-h', 'not-streamable:HEALTH')`; rejects `toMatchObject({ response: { code: 'READING_TYPE_NOT_STREAMABLE', refunded: true, refundedAmount: 2 } })`; message contains `點數已退回`; slot / lock / quota / cap still NOT called (unchanged asserts) |
| "uses a non-ZWDS message for HEALTH" | asserts `stringContaining('已停止提供')` |
| "is placed above the spend cap and the quota" | refund IS called once (2b's own, not the backstop's); `assertUnderCap` + `quota.consume` not called |
| "still SERVES a paid HEALTH row that already has content" | add `expect(refundReadingCredit).not.toHaveBeenCalled()` — pins that the refund cannot precede step 2 (NOT the helper's content check; that is m4 at the regenerate door) |
| ZWDS "does NOT refund — the user keeps a report we merely decline to regenerate" | the fixture is paid-EMPTY (`aiInterpretation: null`), so the name was describing a row that cannot reach 2b. Rewrite: "REFUNDS a paid-empty ZWDS row — nothing can ever be generated for it" (refund called once, `not-streamable:ZWDS_LIFETIME`, message contains 已退回) |
| ZWDS "still SERVES a paid ZWDS row that already has content" | add refund NOT called — this is the test that protects the two real paid rows |
| NEW "a FAILED refund does not swallow the refusal" | `refundReadingCredit` rejects with `new Error('db down')` → still rejects NOT_STREAMABLE with `refunded: false`, `refundedAmount: 0`, message WITHOUT 已退回, `logger.error` called with the reading id, and the joined error-log text does NOT contain `'db down'` (name only — PII rule) |
| NEW "a race-lost refund reports refunded: false" | resolves `{ refunded: false, amount: 0 }` → `refunded: false`, `refundedAmount: 0`, message without 已退回 |
| NEW "fails CLOSED when creditsUsed is absent from the row" | fixture without `creditsUsed` (bypassing 1c is impossible — 1c reads it too — so this test drives `refundUnservableRow` DIRECTLY with `(service as any).refundUnservableRow({...row, creditsUsed: undefined}, 'x')` and asserts `false` + refund not called) |

`buildWith` already returns `refundReadingCredit` (a `jest.fn` resolving `{refunded:true, amount:3}`); the HEALTH fixture has `creditsUsed: 2`, so `refundedAmount: 2` proves the amount comes from the ROW, not the mock.

**`apps/api/test/bazi-regenerate.spec.ts`** — harness first, then tests:

- Hoist `mockCredits` out of `beforeEach` into a `let` at describe scope, built as `{ refundReadingCredit: jest.fn().mockResolvedValue({ refunded: true, amount: 2 }) }` (today it is `{}` and local — no test can assert on it).
- The existing HEALTH fixtures (`:174-177`, `:193-196`) carry neither `aiInterpretation` nor `creditsUsed`; give every HEALTH fixture BOTH explicitly. (With the v1 predicate the missing `creditsUsed` would have fallen through to a refund — the `undefined === 0` trap; v2's `!(creditsUsed > 0)` fails closed, and the fixtures stop relying on it either way.)

| test | change |
|---|---|
| "refuses a degraded HEALTH row … ahead of the degraded/exhausted answers" | fixture gains `aiInterpretation: { sections: { constitution: { preview: 'p', full: 'f' } } }, creditsUsed: 2`; add `expect(mockCredits.refundReadingCredit).not.toHaveBeenCalled()` — **this is the test for m4** (content ⇒ no refund, at the one door where the helper's content check is load-bearing) |
| "answers with the TYPE refusal even for a NON-degraded HEALTH row" | fixture gains `aiInterpretation: null, creditsUsed: 2` → this row is paid-EMPTY → assert refund called once with `not-streamable:HEALTH`, response `code` + message containing 已退回, and the response has NO `refunded` key (the filter would strip it; the message is the receipt on this route) |
| NEW "a paid-empty non-streamable row whose refund FAILS still gets the type refusal" | `refundReadingCredit` rejects → 400 NOT_STREAMABLE, message without 已退回 |
| NEW "a REFUNDED non-streamable row gets the TYPE refusal and no second refund" | fixture `readingType: 'HEALTH', aiInterpretation: null, creditsUsed: 2, refundedAt: new Date()` → 400 `READING_TYPE_NOT_STREAMABLE` (not `READING_REFUNDED`), message without 已退回, `refundReadingCredit` NOT called. Pins the type-before-`refundedAt` order in THIS direction (`:202-215` pins `READING_REFUNDED` for a streamable row only), so nobody "fixes" the order to match a wrong expectation — see § 8 |

**`apps/api/test/reading-paywall.spec.ts`** (the only spec that drives `streamReading`'s catch). Harness: `makeService(readingOverrides, tier, credits?: { refundReadingCredit: jest.Mock })` — pass `credits ?? ({} as never)` in the 5th constructor slot (`:55`), so existing calls are unchanged. The default fixture has no `readingType`, so the new tests set it. Add `import { ConflictException } from '@nestjs/common';` (the file imports only `BaziService`/`CreditsService`/`ShutdownService` today, `:20-22`).

| test | change |
|---|---|
| NEW "forwards code/refunded/refundedAmount for a typed refusal, and nothing else" | `makeService({ readingType: 'HEALTH', aiInterpretation: null, creditsUsed: 2 }, 'FREE', { refundReadingCredit: jest.fn().mockResolvedValue({ refunded: true, amount: 2 }) })` → ONE `error` event whose `JSON.parse(data)` `toEqual({ message: expect.stringContaining('已退回'), code: 'READING_TYPE_NOT_STREAMABLE', refunded: true, refundedAmount: 2 })` — `toEqual`, so `statusCode`/`error` cannot be present |
| NEW "forwards message ONLY for a string-built HttpException" | `(service as any)._setupStream = jest.fn().mockRejectedValue(new ConflictException('Maximum concurrent streams reached'))` (the real step-3 refusal) → `JSON.parse(data)` `toEqual({ message: 'Maximum concurrent streams reached' })` — **this is the test for m7**: a spread would leak `{ error: 'Conflict', statusCode: 409 }` |
| NEW "forwards message ONLY for a plain Error" | `_setupStream` rejects `new Error('boom')` → `toEqual({ message: 'boom' })` |
| existing "throws READING_REFUNDED" | also assert `JSON.parse(data).code === 'READING_REFUNDED'` now that it is forwarded |
| comment `:253-259` | rewritten (§ 1.4) |

**`apps/web/test/reading-recovery-predicate.spec.ts`**: the `type-aware (todo #3)` describe is replaced by two tests — "does NOT gate on type: a paid-empty HEALTH row recovers (the API refuses AND refunds; reaching it is the point)" → `true`; ZWDS paid-empty → `true`. The `it.each(STREAMABLE_READING_TYPES)` and the missing-`readingType` tests go with the deleted constant; the import at `:1` drops it. Header comment rewritten.

**NEW `apps/web/test/stream-error-payload.spec.ts`** — first line `/** @jest-environment node */` (the web config is `jsdom`, which has no `TextDecoder`; `streamBaziReading` calls `new TextDecoder()` at `readings-api.ts:1199` and touches no DOM). Mock `global.fetch` to resolve `{ ok: true, status: 200, body: { getReader: () => ({ read }) } }` where `read` yields one encoded frame `event: error\ndata: {"message":"m","code":"READING_TYPE_NOT_STREAMABLE","refunded":true,"refundedAmount":2}\n\n` then `{ done: true }`. Assert `onError` received all four fields (`toEqual`). Pins the wire contract on the web side; the page's `onError` branch is verified live (§ 8) — the 2,200-line page has no RTL harness and building one is out of scope.

**Mutations (each must go RED, then be reverted):**

| # | mutation | red test |
|---|---|---|
| m1 | delete the `refundUnservableRow` call in 2b | self-refusal "… and REFUNDS it" |
| m2 | helper returns `true` without calling `refundReadingCredit` | same (call count) + paywall typed-refusal (`refundedAmount` would still be 2, so also assert the mock call there) |
| m3 | helper rethrows instead of swallowing | "a FAILED refund does not swallow the refusal" |
| m4 | helper skips the `aiInterpretation` check | regenerate "refuses a degraded HEALTH row" (content-bearing fixture, refund NOT called) |
| m5 | helper uses `creditsUsed === 0` | "fails CLOSED when creditsUsed is absent" |
| m6 | drop `refunded` from the 2b exception | self-refusal `toMatchObject({refunded:true})` + paywall typed-refusal |
| m7 | `streamReading` spreads the whole response object | paywall "message ONLY for a string-built HttpException" |
| m8 | `streamReading` forwards `{message}` only | paywall typed-refusal |
| m9 | delete the regenerate refund call | regenerate "NON-degraded HEALTH row" (refund called once) |
| m10 | restore the web type gate | predicate "does NOT gate on type" |
| m11 | `streamBaziReading` strips unknown keys before `onError` | stream-error-payload spec |
| m12 | delete `onError`'s `refunded` branch in the page | live test only (§ 8) — recorded as such |

### 1.7 What does NOT change, and why (write into the code comments)

- `default:` in the dispatcher: no refund (finding I). See § 0.
- The backstop catch (`:1236-1290`): untouched. 2b is outside the `try`; the comment there stays accurate.
- `_setupStream`'s 1b / 1c / step 2 / 3 / 3b: untouched; 2b's refund relies on 1b/1c/2 and the new 2b comment says so; 3/3b are transient refusals and correctly refund nothing.
- `regenerateReading`'s WHERE: untouched (§ 3.7 of the parent plan).
- `AllExceptionsFilter`: untouched (§ 1.3).

---

## 2. Fix B — the pricing page promises six types

`apps/web/app/pricing/page.tsx:45`: `"全部 6 種解讀類型"` → `"全部 5 種解讀類型"`. The count is the product rows in `COMPARISON_ROWS` below it: 八字終身運 · 流年運勢 · 八字事業詳批 · 愛情姻緣分析 · 合盤比較 = 5 (先天健康分析 was the sixth; removed in PR #73). Add a one-line comment above the bullet tying it to the table so the next removal updates both.

`e2e/pricing-page.spec.ts:183`: `'全部 6 種解讀類型'` → `'全部 5 種解讀類型'`. (The spec is skipped under the signed-out lockdown; the text is updated so it is correct when revived.)

`grep -rn "6 種\|六種\|6種" apps/web/app apps/mobile/src e2e` returns only these two lines — no other surface makes the claim.

---

## 3. Fix C — the web slug list gets a parity lock; the false comment goes

After § 1.5 the web keeps ONE mirrored list, `STREAMABLE_READING_SLUGS`. Its drift failure is loud (a stale slug list omits `stream: true` → `STREAM_REQUIRED` on every create), but the repo's convention for a mirrored cross-workspace constant is a test, not a comment (CLAUDE.md: the Sentry scrubber parity spec; the chat-payment "mirror parity" block).

**Placement — web side, reading the API source as text.** The precedent (`apps/api/test/sentry-scrub-parity.spec.ts`) sits on the API side and `require`s the web module directly. That works there because `sentry-scrub.ts` is dependency-free. `readings-api.ts` is not: it imports `./api` and `./auth-redirect` (`:6-7`), `@repo/shared` (`:8`), and deep-imports `packages/shared/src/constants` (`:14`). Requiring that from the API test runner would load browser-oriented modules for a four-string comparison, and whether their import-time code is clean under Node was not verified — the safer choice is not to find out. Importing the API DTO from the web side has the mirror problem (`@prisma/client` + class-validator, and the web test job runs no `prisma generate`). Reading the DTO as text is the approach the engine already uses for the same problem (`tests/test_observability.py` parses `sentry-scrub.ts`), and the extractor fails loudly if the shape changes.

**`apps/web/app/lib/readings-api.ts`**: `export` `READING_TYPE_MAP` (currently module-private, `:19`); no other change.

**NEW `apps/web/test/streamable-slugs-parity.spec.ts`** (regex verified against `create-reading.dto.ts:48-53` — `] as const;` is on one line; web jest's `testRegex` picks up `test/*.spec.ts`; `fs`/`path` are available under jsdom):

```ts
const dto = fs.readFileSync(path.resolve(__dirname, '../../api/src/bazi/dto/create-reading.dto.ts'), 'utf8');
const block = dto.match(/export const STREAMABLE_READING_TYPES = \[([\s\S]*?)\] as const/);
if (!block) throw new Error('create-reading.dto.ts changed shape — update this extractor, do not delete the test');
const apiTypes = [...block[1].matchAll(/ReadingType\.([A-Z_]+)/g)].map((m) => m[1]).sort();
const webTypes = STREAMABLE_READING_SLUGS.map((s) => READING_TYPE_MAP[s]).sort();
expect(apiTypes.length).toBeGreaterThan(0);
expect(webTypes).toEqual(apiTypes);
```

Two-directional by construction (set equality). Mutations: add `'health'` to the web slugs → red; remove `ReadingType.LOVE` from the API list → red.

**`apps/web/app/reading/[type]/page.tsx:702-703`** comment ("the SAME list the recovery predicate reads, so the two can never disagree") is false — replace with: "V2 streaming — slug twin of the API's `STREAMABLE_READING_TYPES`, parity-tested in `test/streamable-slugs-parity.spec.ts`. The recovery predicate does not gate on type (the API refuses and refunds; see `needsInterpretationRecovery`)."

---

## 4. Fix D + E — the regenerate / stream comments that now contradict the code

All comment-only; the code is right. Exact replacements:

**D — `bazi.service.ts:1006-1012`** (step 1b): replace the sentence starting "`regenerateReading` matches only `isDegraded: true` …" through "… anyway." with:

> `regenerateReading` refuses a refunded row explicitly (`READING_REFUNDED`, checked ahead of its degraded/exhausted answers, and `refundedAt: null` is in its atomic WHERE) — it does not rely on "a refunded row is never degraded", which is only true of rows the pipeline produced (an operator can refund a degraded row by hand, plan § 6). The web UI does not render the regenerate control for a non-degraded reading anyway.

**E1 — `bazi.service.ts:733-747`** (the `data:` block comment): the paragraph "`isDegraded: true` in the WHERE above already means this row was NOT refunded … kept the charge." asserts the invariant the new `refundedAt: null` conjunct (`:724`) exists to stop assuming. Rewrite:

> `refundedAt: null` in the WHERE above is what guarantees this row was not refunded — enforced, not inferred. (For rows the pipeline produced it is also implied by `isDegraded: true`: `ai.service.ts` sets one exclusive status per attempt and refunds only on 'failed'. That implication does not survive an operator refund, which is why the conjunct is there and why this comment no longer leans on it.)
>
> An earlier version of this block cleared `refundedAt` and zeroed `creditsUsed` … (rest unchanged).

**E2 — `bazi.service.ts:329-331`** ("a degraded / refunded / long-abandoned row is what `regenerateBaziReading` exists to replace"): refunded rows are refused there, not replaced. → "a degraded or long-abandoned row is what `regenerateBaziReading` exists to replace; a refunded row is refused there (READING_REFUNDED) and the user creates a new reading."

**E3 — `bazi.service.ts:698-701`** (regenerate header "only succeeds if the row is degraded, not exhausted, and below the limit"): → "… degraded, not exhausted, below the limit, of a streamable type, and not refunded."

**E4 — `apps/api/test/bazi-regenerate.spec.ts:150-154`** ("`isDegraded: true` in the WHERE already implies the row was never refunded"): → "`refundedAt: null` in the WHERE guarantees the row was never refunded (enforced by the conjunct asserted above, not implied by `isDegraded`)".

---

## 5. Fix G — the reading-page comment names the wrong catch

`apps/web/app/reading/[type]/page.tsx:642-648`: the instruction (do not hoist Phase 2's throw into Phase 1) is right; the reason is wrong twice — a throw in the Phase-1 block is swallowed by the Phase-1 `catch { // Chart fetch failed }` at `:668` (inside `callNestJSReading`, declared `:622`), not by `handleFormSubmit`'s catch, and PR #73 itself changed `handleFormSubmit`'s catch to surface messages. Replace the last two sentences with:

> ⚠️ Do NOT hoist Phase 2's throw up here — this block's own `catch` below swallows everything ("Chart fetch failed") so the chart fallback can proceed, and the message would never render. Phase 2's placement is what routes it through `handleNestJSError` to the banner.

---

## 6. Fix F + H — two stale pointers

**F — `bazi.service.ts:582`**: "`(`:442`)`" → "(the `assertUnderCap` + `quota.consume` pair at the top of the inline branch)". Symbol, not line — commit `9f6e1ca` replaced line citations for exactly this reason.

**H — `apps/api/src/bazi/bazi.service.stream-dispatch-default.spec.ts:14-15`**: "`buildWith`/`buildDispatch`" → "the `build()` harness below is a twin of `buildWith()` in `bazi.service.self-refusal-refund.spec.ts` — change both together." (`buildDispatch` exists nowhere.)

---

## 7. Docs and bookkeeping (same commit)

- **`CLAUDE.md` § "Readings: STREAMING and INLINE"** (`:3988-3999`): after "so a refusal spends nothing", add: "— and, since the PR #73 review fixes, **refunds**: every row that reaches 2b is charged-and-empty by construction (1b/1c/step 2 turn everything else away), so the refusal gives the credits back before it throws, and the SSE `error` event carries `refunded`/`refundedAmount` (`code` too, picked by name — never spread a string-built exception's response). The web recovery predicate therefore does NOT gate on type — reaching the refusal is how the user gets their money back. `regenerateReading`'s type branch refunds the same way; on that plain `@Post` the filter forwards `code` + `message` only, so the message is the receipt."
- **`CLAUDE.md` § "A refusal WE issue must not leave the user charged"**: add a fourth row to the controls table: `2b refund` — `_setupStream` step 2b and `regenerateReading`'s type branch, via `refundUnservableRow` — "a paid-empty row of a type we will never generate for". **And** rewrite the sentence at `:4259-4261` ("the intended division of labour between rows 2 and 3 above") to name all the rows it now means: "between the refund backstop (row 2), the recovery branch (row 3) and the 2b refund (row 4): rows 2 and 4 foreclose recovery on purpose; row 3 is for the paid-empty row nobody refused."
- **`.claude/plans/fix-health-reading-dispatch.md`**: § 3.3 ("not a self-refusal, so no refund"), § 3.5 "⚠️ Accepted consequence" bullet, § 3.7's "then refused at step 2b with no refund" → each gets a one-line "**Superseded by `pr73-review-fixes-plan.md` § 1** — 2b now refunds" note; § 12 gets a pointer to this file's review log.
- **`.claude/plans/launch-security-phase1-session-handoff.md:361`**: "(uncommitted in worktree …)" → "(PR #73, `0fd56e0` + review-fix commit)"; add one bullet under item 3: "PR #73 `/code-review`: 9 findings, none ≥ 80, six at 75 fixed in a follow-up commit (plan: `pr73-review-fixes-plan.md`) — the material one: 2b refused a charged-empty row without refunding."
- **`apps/api/test/ai-failure-refund.spec.ts:297`** ("HEALTH (V1) — the only type that still generates INLINE"): → "HEALTH (V1) — the inline stand-in: not creatable over HTTP since todo #3, still the V1 path at the service layer (CLAUDE.md § Readings)."
- **`bazi.service.self-refusal-refund.spec.ts:282`** inline comment "not a self-refusal: the user keeps the row" goes with the test rewrite.

No migration, no env var, no cache bump, no version bump. Merging to `main` deploys.

---

## 8. Verification (in order)

1. **Unit, targeted, then full.** From `apps/api`: `npx --no-install jest --config <abs>/apps/api/jest.config.js src/bazi test/bazi-regenerate test/reading-paywall test/reading-create-preflight test/reading-type-surface test/quota-wiring`; from `apps/web`: `npx --no-install jest --config <abs>/apps/web/jest.config.cjs test/reading-recovery-predicate test/stream-error-payload test/streamable-slugs-parity`. Then the full api + web suites (baseline 2438 / 421). ⚠️ One jest per Bash call, or pinned `--config` (memory: parallel calls share cwd).
2. **Mutations m1–m11** from § 1.6 + the two in § 3: each red, each reverted, recorded in § 10.
3. **`tsc --noEmit`** in both apps; **`./node_modules/.bin/turbo run lint --force`** from the root (`0 cached`).
4. **Live, on the alternate ports (API 4001 / web 3001; 3000/4000/5001 belong to another session).** Insert three tagged HEALTH fixtures under Roger in the dev DB — two paid-empty (`creditsUsed: 2`, `aiInterpretation: null`, `refundedAt: null`), one paid WITH V1 content — note the credit balance, then:
   - `/reading/health?id=<paid-empty 1>` in the built-in browser → network shows ONE `/stream` call → SSE `event: error` with `refunded: true, refundedAmount: 2` and no `statusCode` → on the chart tab the 💎 banner renders with the server's message as its body (no 「請稍候片刻後再試一次」, no duplicated 「點數已退回」) and 「2 個額度已自動退回」 → **the page's 剩 N counter** (not the header badge — that refreshes on its own next fetch) +2 → no chat floating button (never mounted for these types; `aiData` null keeps it so) → the 命理解讀 tab shows the pre-existing 「暫無解讀資料」 card → DB: `refundedAt` set, `failedReason: not-streamable:HEALTH`, ledger `refund: not-streamable:HEALTH` +2 → reload: NO `/stream` call, chart only → 歷史分析記錄 shows 已退款.
   - `curl -N …/readings/<paid-empty 2>/stream` → payload `{message, code, refunded, refundedAmount}` exactly; second curl → `{message, code: 'READING_REFUNDED'}`.
   - `POST …/readings/<paid-empty 2, now refunded>/regenerate` → 400 `{code: 'READING_TYPE_NOT_STREAMABLE', message: '此類型分析不支援重新生成。'}` — the TYPE code, not `READING_REFUNDED`: `regenerateReading` checks the allowlist (`:760`) BEFORE `refundedAt` (`:769`), per § 0 row 4 and parent-plan § 3.7; no 已退回 (the helper returns false on `refundedAt`), balance unchanged. ⚠️ Do not "fix" the code to answer `READING_REFUNDED` here — that reverses the order § 3.7 chose, and the new unit test in § 1.6 pins it. `POST …/readings/<content fixture>/regenerate` → 400 `{code: 'READING_TYPE_NOT_STREAMABLE', message: '此類型分析不支援重新生成。'}` (no 已退回), row untouched, balance unchanged. Then flip the content fixture to paid-empty by SQL and POST again → 400 with `message` ending 「點數已退回。」, ledger +2, and the body has NO `refunded` key (filter-shaped).
   - A LIFETIME paid-empty fixture still recovers normally (predicate unchanged for streamable types).
   - `/pricing` shows 5.
   Delete the fixtures and restore the balance afterwards; stop only the servers this session started.
5. **Commit** on the same branch (message names the review findings), push, let CI run, and post a short PR comment listing what changed and why (the review posted nothing because nothing scored ≥ 80).

---

## 9. Out of scope (recorded so they are not re-derived)

- **A refunded row opened from history shows no banner** (`loadSavedReading` clears `refundedInfo` and never sets it from `reading.refundedAt`). Pre-existing for every type; 歷史分析記錄 shows 已退款. Separate item if the owner wants it.
- **`recoverPaidReading.onError` is still silent for non-refund errors** (spinner stops, no message). Pre-existing; the comment there claimed otherwise and is corrected. Designing the message set is its own change.
- **The header `CreditBadge` does not refresh after an in-page refund** — same for the existing AI-failure refund; it has a `refresh()` the page never holds. Own item.
- **`AllExceptionsFilter` forwarding extra typed fields** — would touch every route; the regenerate receipt is the message (§ 1.3).
- **`default:` refund** — see § 0.
- **A real RTL harness for `reading/[type]/page.tsx`** — none exists; m12 is live-verified and recorded as such.

---

## 10. Verification record — 2026-10-01

**Suites (after the audit fixes):** api jest **2446 passed / 5 skipped** (138 suites; baseline 2438 → +8) · web jest **422 passed** (41 suites; baseline 421/39 — the predicate spec shrank 13 → 8, two new specs +6) · api `tsc` 0 · web `tsc` 0 · `turbo run lint --force` **5/5, 0 cached** (the two-sided suppressions ratchet moved DOWN for `test/bazi-regenerate.spec.ts`: `no-explicit-any` 5→4, `no-unused-vars` 1→0 — both genuine decrements, pruned).

**Mutations — 14/14 red, each reverted (byte-identical check):**

| # | mutation | result |
|---|---|---|
| m1 | delete the 2b `refundUnservableRow` call | RED 5 (self-refusal) |
| m2 | helper returns `true` without calling the refund | RED 5 |
| m3 | helper rethrows | RED 1 ("FAILED refund does not swallow") |
| m4 | helper skips the `aiInterpretation` check | RED 1 (regenerate content-bearing fixture) |
| m5 | helper uses `creditsUsed === 0` | RED 1 ("fails CLOSED") |
| m6 | drop `refunded` from the 2b exception | RED 4 |
| m7 | `streamReading` spreads `getResponse()` | RED 1 — exactly the string-built `ConflictException` test |
| m8 | `streamReading` forwards `{message}` only | RED 2 (paywall) |
| m9 | delete the regenerate refund call | RED 1 |
| m10 | restore the web type gate | RED 4 (predicate) |
| m11 | `streamBaziReading` strips unknown keys | RED 2 (stream-error-payload) |
| p1 | add `'health'` to the web slug list | RED 1 (parity) |
| p2 | remove `ReadingType.LOVE` from the API list | RED 1 (parity — mutate API file, run WEB spec) |
| p3 | comment out `// ReadingType.LOVE,` in the API list | RED 1 (parity — the audit's comment-strip hardening) |
| m12 | delete the page `onError` `refunded` branch | live-only by design (no RTL harness) — covered by the browser run below |

**Line audit — 3 parallel slices (API / web / tests+docs), all CLEAN: 0 critical · 0 high · 0 medium · 15 low, all applied.** Material lows: the paywall `collect()` helper asserted inside an rxjs `complete` callback (would have failed by timeout, not by matcher — both API and tests auditors found it independently); E2's "long-abandoned row is what regenerate replaces" was false (regenerate requires `isDegraded`; long-abandoned rows go via the web recovery predicate); the `default:` comment stated the no-refund MECHANISM but not the DECISION (finding I); "filter forwards `code` + `message` only" compressed the real list; "Three controls now" intro vs a four-row table; the parity extractor counted commented-out API entries as live (hardened + p3 added); a web docblock named a non-existent `dispatch`; the paywall "leaves refundedAt untouched" test guarded `isDegraded` while its own docblock now rests on `refundedAt: null`. One pre-existing observation recorded, not fixed: the API's "content present" is truthy `aiInterpretation`, the web's is `sectionCount === 0` — a `{sections: {}}` row would be served empty by step 2 and never reach 2b (theoretical; real failure rows are `null`).

**Live — this worktree's build on API 4001 / web 3001 (3000/4000/5001 = another session, untouched), signed in as Roger (933 credits, 65 ledger rows, 0 HEALTH rows at start). Four tagged fixtures under Roger's primary profile; all deleted afterwards and the balance restored to 933 (verified).**

| check | result |
|---|---|
| `/reading/health?id=<paid-empty 1>` from history | ONE `/stream` call → SSE `event: error` `{message, code: READING_TYPE_NOT_STREAMABLE, refunded: true, refundedAmount: 2}`; chart tab shows the 💎 banner with the SERVER message as body 「此類型分析已停止提供，無法生成。您的 2 個額度 已自動退回」 — no 「請稍候片刻後再試一次」, no duplicated 已退回; 命理解讀 tab shows the pre-existing 暫無解讀資料 card; no 問 AI 命理師 button; API log `[Stream] REFUSED` → `[Refund] 2 credits returned … not-streamable:HEALTH`; DB `refunded_at` set, `failed_reason: not-streamable:HEALTH`, `credits_used` still 2, ledger `+2 refund: not-streamable:HEALTH`, balance 933 → 935 |
| reload the same `?id=` | `GET` reading only — **no `/stream`**; chart renders plain (predicate sees `refundedAt`) |
| 歷史分析記錄 | that row shows **已退款**; the other two HEALTH fixtures still −2 額度 |
| in-page `fetch` of `/readings/<paid-empty 2>/stream` | HTTP 200 `text/event-stream`, payload exactly `{message, code, refunded, refundedAmount}` — no `statusCode`; balance → 937 |
| second `fetch` of the same stream | `{message: 此分析已退款…, code: READING_REFUNDED}` (1b fires, `code` forwarded, no `refunded` key) |
| `POST …/<paid-empty 2, now refunded>/regenerate` | 400 `code: READING_TYPE_NOT_STREAMABLE`, message 「此類型分析不支援重新生成。」 — the TYPE code, no 已退回, balance unchanged (type-before-`refundedAt` confirmed live) |
| `POST …/<content fixture>/regenerate` | 400 same code + plain message; V1 content intact, not refunded, balance unchanged |
| flip the content fixture to paid-empty by SQL, POST again | 400, message ends 「，點數已退回。」, body has NO `refunded` key (filter-shaped: statusCode/code/message/error/path/timestamp), ledger +2, balance → 939, log `[Regenerate] REFUSED` → `[Refund] 2 credits returned` |
| `/reading/lifetime?id=<paid-empty LIFETIME control>` | predicate fires → `/stream` held open → past 2b, `streamLifetimeV2` dispatched → **`status=success` 15/15 sections, 189 s, `refunded=false`**; row has content, not degraded, not refunded; no banner; balance unchanged |
| `/pricing` | 「全部 5 種解讀類型」, no 先天健康 anywhere |
| error paths | `UNREACHABLE` and `[Refund] FAILED` logged **0** times |

Servers stopped via SIGTERM (M6 drain: "Drain complete in 3512ms"); `next dev`'s auto-generated `apps/web/AGENTS.md` + `CLAUDE.md` removed. Working tree: 15 modified + 3 untracked, **nothing committed** (owner's call — § 8.5).

## 11. Review log

**Round 1 — REVISE, 13 findings, all applied in v2.**

| # | sev | finding | v2 change |
|---|---|---|---|
| 1 | low | § 1.4 comment: an object-built exception's response has NO `statusCode`/`error`; only a string-built one does | comment reworded (§ 1.4); pick-by-name kept |
| 2 | low | "the only refusal … outside the `try`" — steps 3/3b are also outside and correctly refund nothing | "only PERMANENT refusal on a charged row" (§ 1.2, § 1.7) |
| 3 | low | adding a 4th controls row leaves CLAUDE.md's "rows 2 and 3" sentence stale | that sentence rewritten too (§ 7) |
| 4 | low | parity test is the opposite orientation from the precedent, with no stated reason | reason stated: `readings-api.ts` imports `@repo/shared`/`./api`; the DTO needs a generated Prisma client (§ 3) |
| 5 | low | "header credits +N" is false — `setUserCredits` is page-local; `CreditBadge` owns its own fetch | reworded to the page's 剩 N counter; badge limitation recorded (§ 1.5, § 8, § 9) |
| 6 | low | after the refusal `AIReadingDisplay` mounts with zero sections — unverified render | `setAiData(null)` in the refunded branch + live check "no AI area" (§ 1.5, § 8) |
| 7 | med | m4 mapped to a test that cannot go red (step 2 returns before the helper runs) | m4 re-mapped to the regenerate content-bearing test (§ 1.6) |
| 8 | med | web SSE spec would throw: jsdom has no `TextDecoder`; the `Response` mock shape | `@jest-environment node` + `ok`/`getReader` mock specified (§ 1.6) |
| 9 | med | paywall `makeService` has no credits injection and no `readingType` in its fixture | optional 3rd `credits` param + `readingType: 'HEALTH'` in the override (§ 1.6) |
| 10 | med | m7 uncatchable — the 2b response has nothing to leak | string-built `ConflictException` fixture, `toEqual({message})` (§ 1.6) |
| 11 | med | regenerate fixtures lack `aiInterpretation`/`creditsUsed`; `mockCredits` is `{}` and local; helper's `=== 0` falls through on `undefined` | fixtures explicit, `mockCredits` hoisted with a `jest.fn`, predicate `!(creditsUsed > 0)` + a fail-closed test (§ 1.1, § 1.6) |
| 12 | med | the reused banner body says "retry", wrong for a withdrawn product and contradicting the server message | `refundedInfo.body?` carries `err.message`; default body unchanged for the AI-failure paths (§ 1.5) |
| 13 | med | § 1.3/§ 8 assumed `refunded`/`refundedAmount` reach the client on the regenerate route; the filter strips them | dropped from that exception; message is the receipt; § 8 asserts `code` + message (§ 1.3, § 8) |

**Round 2 — REVISE, 5 findings (1 medium, 4 low/nit), all applied in v3.**

| # | sev | finding | v3 change |
|---|---|---|---|
| 1 | nit | paywall spec lacks a `ConflictException` import for the m7 fixture | import added to the harness note (§ 1.6) |
| 2 | nit | the banner would say the refund twice (message clause + the banner's own amount line) | `onError` trims the trailing 「，點數已退回。」 for the banner BODY only; wire message untouched (§ 1.5) |
| 3 | low | § 3 claimed the API jest config has no `@repo/shared` mapper — false (`apps/api/jest.config.js:12`) | sentence deleted; placement rationale kept on the import-time-code argument (§ 3) |
| 4 | low | `setAiData(null)` rationale and the § 8 "no AI area" check described the full-page layout; HEALTH/ZWDS are TABBED, `AIReadingDisplay` is tab-gated, both `null` and `[]` render 暫無解讀資料; no banner is lost (`beforeDisclaimer` renders only past the section-less early return) | comment rewritten to the real effects (initial state restored, chat button hidden); layout facts recorded; § 8 check reworded to chart-tab banner / reading-tab card / no chat button (§ 1.5, § 8) |
| 5 | med | § 8 expected `READING_REFUNDED` from regenerate on a refunded HEALTH row — wrong: type check precedes `refundedAt`, and nothing pinned that direction, inviting a "fix" that reverses § 3.7's order | § 8 bullet corrected with the reason; new unit test pins type-before-`refundedAt` for a refunded non-streamable row (§ 1.6, § 8) |

**Round 3 — APPROVE.** Three optional wording nits, all folded in: § 3 imports list gained `@repo/shared` (`:8`); the "bottom banner instance" claim now says "past the section-less early return, in both layouts" rather than "full-page only"; the chat-button remark no longer attributes its absence to `aiData` (it is null-typed for HEALTH/ZWDS; `!aiData` is the generic guard). Reviewer's closing line: "The plan is ready to implement as written."

