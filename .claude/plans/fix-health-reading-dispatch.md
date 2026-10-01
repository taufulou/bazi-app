# Todo #3 — HEALTH readings deliver LIFETIME content — Implementation Plan

**Status:** IMPLEMENTED 2026-09-28, LINE-AUDITED + LIVE-TESTED 2026-09-29, committed as PR #73 (`0fd56e0`); Option A; panel dropped for the ZWDS-style submit refusal. **Amended 2026-10-01 by `pr73-review-fixes-plan.md`** — the 2b refusal now REFUNDS a charged-empty row and the web recovery predicate no longer gates on type (§ 3.3 / § 3.5 / § 3.7 notes below). Step 0 + § 6 remediation WAIVED 2026-09-29 — no production customers yet (§ 11 Q2). Verification record in § 12. — staff-engineer review rounds 1 (15 findings) · 2 (4) · 3 (APPROVE, 2 optional lows folded in).
**Branch:** `claude/launch-security-phase1-review-05ef66` (worktree), based on `main` @ `65f5dd0`.
**Source item:** `.claude/plans/launch-security-phase1-session-handoff.md` § THE TODO LIST, item 3.
**Review log:** § 12 at the bottom.

---

## 0. The defect, stated precisely

`BaziService._setupStream` (`apps/api/src/bazi/bazi.service.ts:1142-1157`) picks the
V2 streamer with a `switch` (`:1144`) whose explicit cases are `CAREER` / `ANNUAL` /
`LOVE` and whose `default:` (`:1154`) is `streamLifetimeV2`. Any other `readingType`
that reaches that switch is narrated as 八字終身運 over its own row — and then
**persisted onto that row** by `_executeStreamV2Common` (`ai.service.ts:1647`), so
the wrong product is not just streamed once, it is stored as the reading.

Two types can reach the switch today:

| type | how it gets there | status |
|---|---|---|
| `ZWDS_*` | a paid row with no interpretation, via the web recovery branch | **closed** in `3336922` by a `startsWith('ZWDS')` guard (`:1091-1119`, the `if` at `:1111`) |
| `HEALTH` | same route | **open** — the ZWDS commit explicitly left it out as "a sellable product needing a decision" |

The "decision" is the reason this is its own item: fix the dispatcher AND decide
what HEALTH is.

### 0.1 Evidence (verified against the tree at `65f5dd0`; line numbers re-checked in review round 1)

- `createReading` (`bazi.service.ts:342-348`) defines `isV2Reading` as exactly
  `LIFETIME | CAREER | ANNUAL | LOVE`. `isStreamingRequest` requires `isV2Reading`,
  so a `HEALTH` create — **even with `stream: true`** — takes the inline branch
  (`:405`) and runs V1 `generateInterpretation` (`ai.service.ts:398`): one call,
  4 sections (`constitution, organ_analysis, health_risks, wellness_advice`,
  `prompts.ts:787`), ~10s (measured 2026-08-31, CLAUDE.md § "STREAMING and INLINE").
  **The create path is correct for HEALTH.** The bug is only in the stream path.
- The web client sends `stream: true` only for the four V2 slugs
  (`apps/web/app/reading/[type]/page.tsx:673`), and mobile cannot create HEALTH at
  all (`apps/mobile/src/lib/readings-api.ts:23-31` has no `health` key).
- V1 has no degraded state — its provider loop (`ai.service.ts:427-497`) returns a
  full interpretation or throws. `isDegraded: true` has ONE writer,
  `_executeStreamV2Common` (`ai.service.ts:1654`), so a HEALTH row can never be
  degraded and `regenerateReading` (`bazi.service.ts:681`, WHERE `isDegraded: true`
  at `:698`) can never route a HEALTH row into `_setupStream`.
- Since `cc02da5`, an inline AI failure **throws** (`bazi.service.ts:499-540`,
  code `AI_CALL_FAILED` at `:523`) BEFORE the `$transaction` — no row, no charge.
  The writers of `bazi_readings` are exactly: create (`:600`), regenerate
  (`:694/:741`), V2 persist (`ai.service.ts:1647`) + failure null-out (`:1708`),
  refund (`credits.service.ts:83`). **No path can create a NEW paid-empty HEALTH
  row.** The only rows that can reach the bug are paid-empty HEALTH rows created
  BEFORE `cc02da5` (2026-09-02).
- The one route that sends such a row to the stream: `loadSavedReading`
  (`page.tsx:588`) → `needsInterpretationRecovery` (`readings-api.ts:549`, predicate
  = `sectionCount === 0 && creditsUsed > 0 && !refundedAt`, **not type-aware**) →
  `recoverPaidReading(…, {owned:true})` → `streamBaziReading` → `GET
  /api/bazi/readings/:id/stream` (`bazi.controller.ts:87`, an **`@Sse`** route) →
  `_setupStream` → `default:` → LIFETIME. Plus any direct authenticated `GET` on
  that route. The form-side `recoverPaidReading` callers (`page.tsx:1242/1300/
  1353/1409`) are per-slug for the four V2 types; HEALTH has no session-restore
  flow. Mobile's only saved-reading stream sits behind `regenerateBaziReading`
  (`[type].tsx:365-371`), which HEALTH cannot reach.
- The production evidence row `ab232801…` (`readingType: HEALTH`, `creditsUsed:
  2`, `failedReason: ai-failed-LIFETIME-call1=0/8-call2=0/7`) proves the stream
  path ran on a HEALTH row. Its `failedReason` is exactly the `reason` string
  `refundReadingCredit` writes, so **that row was refunded**. Its origin is
  **unknown**: `load-test/k6/s2-mix.js:75` has only ever posted
  `LIFETIME/CAREER/LOVE` (`git log -S HEALTH -- load-test/` is empty), so it was
  more plausibly hand-driven during the 2026-08-30 mock verification, possibly
  from the owner's own account. Step 0 therefore must not exclude the owner's
  account (it does not).

### 0.2 What HEALTH is today (revealed product intent)

| surface | HEALTH present? | where |
|---|---|---|
| Homepage card grid | **NO** — filtered out since 2026-03-06 (`7a15e37`, theme redesign) | `apps/web/app/page.tsx:33` `t.slug !== "health"` |
| Admin banner link targets | **NO** — `LIVE_READING_SLUGS` excludes it; comment: "hidden ZWDS + `health` are excluded so a banner can't link to a page the user can't reach" (2026-06-16) | `apps/web/app/admin/banners/link-options.ts:6-23` |
| Mobile (create, history) | **NO** | `readings-api.ts:23`, `history.tsx:17` (HEALTH rows filtered out) |
| Chat | **NO** — "placeholder for future phases" | `chat.service.ts:69` |
| `READING_TYPE_META.health` | present, `creditCost: 2`, **no `image`** (every live type has one) | `packages/shared/src/constants.ts:194` |
| `BAZI_CREATABLE_READING_TYPES` | **YES** — API accepts it | `create-reading.dto.ts:21-27` |
| `Service` seed row | active, 2 credits, sortOrder 5 | `apps/api/prisma/seed.ts:16` |
| Web route `/reading/health` | **YES** — in `VALID_TYPES`, form works, inline V1 result renders | `page.tsx:87` |
| Sitemap | **YES** — since 2026-02-10, predates the hide | `apps/web/app/sitemap.ts:11` |
| **Public pricing page** | **YES** — `COMPARISON_ROWS` promises 「先天健康分析」 to PRO + MASTER tiers | `apps/web/app/pricing/page.tsx:80` |
| Cross-sell grid at the bottom of every reading | **YES** — `BAZI_CROSS_SELL` includes it; the only in-app link to the page (broad grep) | `AIReadingDisplay.tsx:1651`, rendered via `crossSellFiltered` at `:1773`; asserted by `apps/web/test/ai-reading-display.spec.tsx:272-293` |
| History (歷史分析記錄) | rows link to `/reading/health?id=` | `dashboard/readings/page.tsx:16,223` |
| `/api/og`, `robots.ts`, `reading/[type]/layout.tsx` | not applicable — OG only has `compatibility`; robots enumerates nothing; no layout/`generateStaticParams` | verified in review |

So HEALTH is: hidden from the homepage for six months, excluded from every surface
built since (mobile, chat, admin banners), yet still purchasable through the
cross-sell grid, the sitemap, a typed URL — and **promised on the public pricing
page** — as a **V1 single-call** reading in a product whose stated rule is
"compute interpretive insights deterministically, then let AI narrate; never rely
on AI to know Bazi rules" (CLAUDE.md § AI Interpretation Layer). The 先天健康
content it sells is also already a section of the LIFETIME reading (`health` in
`V2_SECTION_ORDER`, with `anchors_health` from `lifetime_enhanced.py`), of ANNUAL
(`annual_health`), and a dimension of all three fortune scopes.

---

## 1. Options and recommendation

| | what | ships the dispatcher fix? | product outcome | cost |
|---|---|---|---|---|
| **A — withdraw from sale, keep rendering** | remove HEALTH from the create allowlist + the four web sales surfaces (sitemap, cross-sell, pricing row, the form); existing rows still render via `?id=` | yes | consistent with 6 months of revealed intent; 先天健康 still delivered inside LIFETIME | ~1 session incl. review + mutation tests |
| **B — keep selling via V1 inline** | only the dispatcher fix | yes | HEALTH stays a hidden-but-URL-reachable V1 SKU; the homepage/cross-sell/sitemap/pricing inconsistency must still be resolved one way or the other | ~½ session, plus a product decision this plan cannot make |
| **C — build `streamHealthV2`** | engine `health_enhanced.py` pre-analysis (五行→五臟, 忌神 organ risk, 大運 health timing, 調候), V2 prompt pair with anti-hallucination clauses + medical disclaimer, `_executeStreamHealthV2`/`streamHealthV2`/`generateHealthV2Interpretation`, `PRE_ANALYSIS_VERSIONS.HEALTH`, shared section-key arrays, web + mobile rendering + expected totals + paywall bullets, chat scope, Bazi-master + A2-style narrative grading | yes (as part of it) | a real 5th product | 2–3 sessions; a feature, not a fix |

**Recommendation: Part 1 (dispatcher) unconditionally, then Option A — gated on
Step 0.** Reasons, in order of weight:

1. The owner already withdrew HEALTH from every surface they touched after March
   (homepage, mobile, chat, admin banners). Option A makes the code agree with that.
2. A V1 reading with no deterministic pre-analysis is below the platform's own bar,
   and it is medical-adjacent content. Keeping it half-alive is the worst of the
   three states — and the pricing page currently sells that half-alive product as a
   paid-tier benefit.
3. Option A deletes nothing that C would need: the V1 prompt, the `Service` row,
   `READING_TYPE_META.health`, the enum, the display metadata all stay. If HEALTH is
   ever wanted as a product, C starts from the same place it would today.
4. Under A the strongest invariant becomes assertable: **the set of types this
   endpoint can create EQUALS the set it can stream**, and `_setupStream` refuses
   everything else. The absence of that property is what caused this bug.

⚠️ This is a **product decision** and it is the owner's. The plan is written for A;
§ 8 says exactly what changes if the owner picks B, and C is out of scope here.

---

## 2. Step 0 — MEASURE before deciding (owner-run, ~15 min)

The todo says "check production for real paid HEALTH rows first". Nothing on this
machine can reach the production database (no `DATABASE_URL`, no Railway CLI —
verified), so this is an owner step: Railway → Postgres service → Data/Query, or
`psql` with the production URL. Column names are from `schema.prisma` `@map`s and
were verified in review. ⚠️ `users` has **no `email` column**; load-test accounts
are identifiable only by `name = 'LoadTest NNN'` (`load-test/seed-users.mjs:88`),
and anonymised deletions by `clerk_user_id LIKE 'deleted_user_%'`.

```sql
-- Q1. Every HEALTH reading owned by a REAL account (excludes anonymised deletions
--     and load-test accounts), newest first.
SELECT r.id, r.created_at, r.credits_used, r.refunded_at, r.is_degraded,
       r.failed_reason,
       (r.ai_interpretation IS NULL)                              AS paid_empty,
       (r.ai_interpretation -> 'sections') ? 'chart_identity'     AS lifetime_shaped,
       (r.ai_interpretation -> 'sections') ? 'constitution'       AS health_shaped,
       u.name                                                     AS owner_name
FROM bazi_readings r
JOIN users u ON u.id = r.user_id
WHERE r.reading_type = 'HEALTH'
  AND u.clerk_user_id NOT LIKE 'deleted_user_%'
  AND COALESCE(u.name, '') NOT LIKE 'LoadTest %'
ORDER BY r.created_at DESC;

-- Q2. Totals by state, all owners.
SELECT count(*)                                                                    AS total,
       count(*) FILTER (WHERE ai_interpretation IS NOT NULL)                       AS with_content,
       count(*) FILTER (WHERE (ai_interpretation->'sections') ? 'chart_identity')  AS lifetime_shaped,
       count(*) FILTER (WHERE ai_interpretation IS NULL AND credits_used > 0
                          AND refunded_at IS NULL)                                 AS paid_empty,
       count(*) FILTER (WHERE refunded_at IS NOT NULL)                             AS refunded
FROM bazi_readings WHERE reading_type = 'HEALTH';
```

Decision table:

| Step 0 result | consequence |
|---|---|
| Q1 returns 0 rows | A, nothing to remediate. |
| rows with `health_shaped = true` only | A; those rows keep rendering via `?id=` (Part 2 keeps that path). |
| any `lifetime_shaped = true` | a customer received the wrong product → **refund those rows** (§ 6) before/with deploy. |
| any `paid_empty = true` | pre-`cc02da5` rows that would trigger the bug on next open → **refund** (§ 6). After Part 1 they can no longer be recovered and render silently (§ 3.5), so leaving them unrefunded means a charged row with no content, forever. |
| any `is_degraded = true` | a pre-fix HEALTH row whose LIFETIME narration was PARTIAL (`_executeStreamV2Common` writes `isDegraded` to whatever row it is handed). It is `with_content` but neither `health_shaped` nor necessarily `lifetime_shaped`; `regenerateReading` now refuses it (§ 3.7) so it stays as it is → **refund** (§ 6). |
| owner wants HEALTH to stay purchasable | B (§ 8), and open C as a feature item. |

---

## 3. Part 1 — the dispatcher (unconditional; ships under A, B or C)

### 3.1 One source of truth for "streamable"

**File:** `apps/api/src/bazi/dto/create-reading.dto.ts` — next to
`BAZI_CREATABLE_READING_TYPES`, so the two lists are read together and
`apps/api/test/reading-type-surface.spec.ts` (which already imports from here)
can assert their relationship. `bazi.service.ts:19` already imports from this
module.

```ts
/**
 * The reading types `_setupStream` has a streamer for. Every type here has an
 * explicit `case` in the dispatcher; anything else is REFUSED, never defaulted.
 *
 * ⚠️ `createReading`'s `isV2Reading` reads THIS list. The two used to be
 * separate literals, and `_setupStream` had no list at all — just a `default:`
 * that fell through to LIFETIME. That is how a HEALTH row was narrated as
 * 八字終身運 (todo #3) and how a ZWDS row nearly was (`3336922`).
 */
export const STREAMABLE_READING_TYPES = [
  ReadingType.LIFETIME,
  ReadingType.CAREER,
  ReadingType.ANNUAL,
  ReadingType.LOVE,
] as const;
```

### 3.2 `createReading` — read the list

`bazi.service.ts:342-345`: replace the four-way `||` with
`(STREAMABLE_READING_TYPES as readonly ReadingType[]).includes(dto.readingType)`.
Behaviour identical today.

Add a comment at the inline `else` (`:405`): after Option A the **DTO** rejects
every non-streamable type, a cache hit is served by the branch above, and a
streamable type without `stream` is refused with STREAM_REQUIRED — so the branch
is **unreachable over HTTP**. It stays reachable at the SERVICE layer and must
stay: `apps/api/test/reading-create-preflight.spec.ts:183`
(the load-bearing "last V1 reading of the day" quota regression) and
`apps/api/test/ai-failure-refund.spec.ts:211/263/337/374/439` call
`service.createReading` directly with `ReadingType.HEALTH` as the V1 stand-in,
bypassing the DTO. Do NOT add a service-level allowlist check — it would break
those tests for no gain, and `generateInterpretation` is also the live V2
total-failure fallback (`ai.service.ts:542`).

### 3.3 `_setupStream` — allowlist guard, placed after step 2 and BEFORE step 3

> **Superseded in part by `pr73-review-fixes-plan.md` § 1 (2026-10-01):** the
> snippet below says "the backstop does not refund — the user keeps whatever the
> row holds". Every row that reaches 2b is charged-and-EMPTY (1b/1c/step 2 turn
> everything else away), so that sentence described a row that cannot exist. 2b
> now calls `refundUnservableRow` before the throw and the exception carries
> `refunded` / `refundedAmount`; the placement argument below is unchanged.

Replace the `startsWith('ZWDS')` block (`:1091-1119`) with an allowlist check, and
**move it up to sit immediately after step 2** (`if (reading.aiInterpretation) {
… return; }`, `:1008-1015`) and before step 3 (the per-user slot, `:1017`). That
is outside the `try`, so a refusal takes no slot and no lock and has nothing to
release. Nothing side-effecting sits between step 2 and the current guard
position (the `enrichedData`/`targetYear` build is pure reads), so moving it
loses nothing.

```ts
// 2b. NO STREAMER → REFUSE. Allowlist, not a denylist: the switch at step 5
// used to end in `default: streamLifetimeV2`, so any type without a case was
// silently narrated as 八字終身運 and PERSISTED onto its own row. HEALTH (V1,
// inline-only) and ZWDS (deleted) both reached it. Placed AFTER step 2 on
// purpose: a paid row that already HAS content is served by
// emitStaticSections above and never gets here. Placed BEFORE step 3 so a
// refusal takes no slot, no lock, no quota. Not a self-refusal (nothing we
// control failed; the row simply cannot be regenerated), so the backstop does
// not refund — the user keeps whatever the row holds.
if (!(STREAMABLE_READING_TYPES as readonly ReadingType[]).includes(reading.readingType)) {
  this.logger.warn(`[Stream] REFUSED reading=${readingId} user=${user.id} type=${reading.readingType} — no streamer for this type`);
  throw new BadRequestException({
    code: 'READING_TYPE_NOT_STREAMABLE',
    message: reading.readingType.startsWith('ZWDS')
      ? '紫微斗數功能已停用，此報告無法重新生成。'
      : '此類型分析不支援串流生成，無法重新生成。',
  });
}
```

Same `code` as the ZWDS guard so the four existing spec assertions stay valid;
the ZWDS message is preserved. ⚠️ On this route the `code` is asserted at UNIT
level only: `streamReading` (`:885-893`) catches the rejected promise and emits
`event: error` with `{message}` — the client never sees the code (see § 3.4, § 7).

### 3.4 `_setupStream` — the switch throws on `default:`

`:1144-1157`: add `case 'LIFETIME':` explicitly and make `default:` throw a plain
`Error` (`Unreachable: no streamer for ${reading.readingType}`) after a
`logger.error`. It sits inside the `try`, so the existing catch releases the
slot and lock via `releaseStreamSlot()`; it is not a self-refusal, so no refund
(this is still true of `default:` after the PR #73 review fixes — finding I,
dismissed at 35; the REFUND lives at step 2b, § 3.3, not here).
Two facts to write into the `default:` comment:

- **What the client sees:** the route is `@Sse` (`bazi.controller.ts:87`);
  `streamReading` catches the throw and emits `event: error`
  `{"message":"Unreachable: …"}` over an HTTP **200** — there is no 500 and no
  400 anywhere on this route. The log line is the operator's signal.
- **Quota is already spent:** the switch sits below `assertUnderCap` +
  `quota.consume` (`:1139-1140`), so reaching `default:` has consumed a daily
  quota unit. Acceptable only because 3.3 makes it unreachable; that is the
  point of keeping it — if 3.3 is ever loosened, this fails loudly instead of
  narrating the wrong product.

### 3.5 Web — make the recovery predicate type-aware

> **Superseded by `pr73-review-fixes-plan.md` § 1.5 (2026-10-01):** the type gate
> shown below was REMOVED. 2b now refunds the charged-empty row, so the web's job
> is to REACH the refusal; `needsInterpretationRecovery` is back to its three
> conditions and no longer reads `readingType`. The `page.tsx:673` slug-flag
> change stands and is parity-tested (`test/streamable-slugs-parity.spec.ts`).

**File:** `apps/web/app/lib/readings-api.ts:549`.

```ts
/** Mirrors the API's STREAMABLE_READING_TYPES (enum values, not slugs). */
export const STREAMABLE_READING_TYPES = ['LIFETIME', 'CAREER', 'ANNUAL', 'LOVE'] as const;
export const STREAMABLE_READING_SLUGS = ['lifetime', 'career', 'annual', 'love'] as const;

export function needsInterpretationRecovery(
  reading: { readingType?: string; creditsUsed: number; refundedAt?: string | null },
  sectionCount: number,
): boolean {
  if (!reading.readingType || !STREAMABLE_READING_TYPES.includes(reading.readingType as never)) {
    return false; // fail CLOSED: a row we cannot stream must not be sent to the stream
  }
  return sectionCount === 0 && reading.creditsUsed > 0 && !reading.refundedAt;
}
```

- `readingType` is always present: `getReading` (`bazi.service.ts:776-780`)
  returns the whole row with no `select`, and `NestJSReadingResponse.readingType`
  is required (`readings-api.ts:478`). Fail-closed on a missing value is therefore
  a defensive branch, not a live one.
- `page.tsx:588`: the `!isZwds &&` conjunct becomes redundant (ZWDS enums are not
  streamable) — drop it and rewrite the comment block above it to name the
  predicate as the guard.
- `page.tsx:673`: replace the hardcoded four-slug `||` with
  `(STREAMABLE_READING_SLUGS as readonly string[]).includes(readingType)`, so the
  stream flag and the recovery predicate can no longer disagree. ⚠️ The cast is
  required: `readingType` there is the 16-literal `ReadingTypeSlug` union
  (`page.tsx:58`), and `.includes` on a 4-literal readonly tuple rejects it
  (TS2345) without it.
- ⚠️ **Accepted consequence — SUPERSEDED by `pr73-review-fixes-plan.md` § 1
  (2026-10-01):** the type gate was REMOVED from the predicate; 2b now refunds
  the row and the web shows the refund banner. Kept for history: a paid-empty,
  unrefunded HEALTH row opened from
  history used to render the chart with **no AI area and no message** —
  `loadSavedReading` sets `aiData = transformAIResponse(null)` and
  `AIReadingDisplay` is gated on `aiData || isAiLoading` (`page.tsx:2036, 2098`).
  That is the exact row class this item exists for, ending in silence. It is
  acceptable ONLY because (a) no new such row can be created (§ 0.1) and (b) Step
  0 finds and refunds the existing ones (§ 6), after which history shows 已退款.
  If Step 0 finds rows that cannot be refunded for any reason, add a one-line
  notice in the predicate-refused-on-type branch before shipping.

### 3.7 `regenerateReading` — the second door (line audit, 2026-09-29)

`regenerateReading` (`bazi.service.ts:681`) is "null the content, then the client
re-streams". Its atomic `updateMany` WHERE had no `readingType` conjunct, so a
pre-fix degraded HEALTH row (`_executeStreamV2Common` sets `isDegraded: true` on
whatever row it was handed, and pre-fix HEALTH rows were handed to
`streamLifetimeV2`) would be nulled, then refused at step 2b with no refund, then
told 「狀態正常」 on a second regenerate — paid-empty forever, by a user click.
(**Superseded in part by `pr73-review-fixes-plan.md` § 1** — 2b and the
regenerate type branch now REFUND a charged-empty row; the WHERE conjuncts below
still stand, because a content-bearing degraded row must keep its content.)
The § 0.1 claim "a HEALTH row can never be degraded" is true only post-fix.

Fix: `readingType: { in: [...STREAMABLE_READING_TYPES] }` AND `refundedAt: null`
in the WHERE (the service's own comment assumed "isDegraded ⇒ never refunded";
a manual § 6 refund breaks that, so it is enforced now), and in the `count === 0`
disambiguation `READING_TYPE_NOT_STREAMABLE` / `READING_REFUNDED` are thrown
BEFORE the isDegraded/exhausted answers. Tests in `test/bazi-regenerate.spec.ts`
pin both conjuncts on the WHERE (the content protection) and both refusals.

### 3.8 `createReading.isV2Reading` was unpinned (line audit, 2026-09-29)

Collapsing the rewrite to `=== LIFETIME` left 117 tests green: `STREAM_REQUIRED`
was asserted for LIFETIME only and nothing created CAREER/ANNUAL/LOVE through
`createReading`. `test/reading-create-preflight.spec.ts` now carries the
create-side twin of the dispatch table: `it.each(STREAMABLE_READING_TYPES)` —
with `stream: true` → `streamReady`, without → `STREAM_REQUIRED` and no charge.

### 3.6 Tests (Part 1)

**API — `bazi.service.self-refusal-refund.spec.ts`**, extending its `buildWith`
harness. ⚠️ The harness currently mocks `streamLifetimeV2: jest.fn()` — that
returns `undefined`, so `aiObservable.subscribe(...)` (`:1158`) throws a
`TypeError` that the catch rethrows, and the existing "does not refuse a normal
Bazi row" test passes on that TypeError. Every dispatch test below must mock all
four streamers as `jest.fn().mockReturnValue({ subscribe: jest.fn() })` and assert
the run **RESOLVES**, or it can go green while the run is crashing.

1. **Dispatch table, derived from the constant.** `it.each(STREAMABLE_READING_TYPES)`
   with a `type → mock name` map typed EXHAUSTIVELY —
   `Record<(typeof STREAMABLE_READING_TYPES)[number], 'streamLifetimeV2' |
   'streamCareerV2' | 'streamAnnualV2' | 'streamLoveV2'>` — so a list entry with
   no mapping is a COMPILE error in the spec (a legible red, rather than an
   incidental `service.aiService[undefined]` matcher error): the run resolves,
   the mapped mock is called exactly once, the other three are not called.
   Deriving from the constant means a type added to the list without a `case`
   fails here instead of at runtime. This is the test that proves the list is
   READ by `_setupStream` (see the note on the equality test below).
2. **HEALTH refused before anything is spent.** HEALTH row, no content →
   rejects with `READING_TYPE_NOT_STREAMABLE`; no streamer called;
   `refundReadingCredit` not called; `redis.incrementRateLimit` NOT called (no
   slot); `quota.consume` NOT called ("a refusal we issue must not spend the
   user's daily allowance" — CLAUDE.md).
3. **Placement above S2.** HEALTH row, no content, `assertUnderCap` mocked to
   reject with `AI_SPEND_CAP_CODE` → the rejection is `READING_TYPE_NOT_STREAMABLE`
   (not the cap code); `assertUnderCap` NOT called; `quota.consume` NOT called;
   `refundReadingCredit` NOT called. (Mutation: move the guard below
   `assertUnderCap` → the cap code wins and this goes red. An earlier draft of
   this test used a row WITH content, which step 2 returns before either check
   reaches — it could not fail for that mutation.)
4. **Placement below step 2.** HEALTH row WITH content → `emitStaticSections`
   called, run resolves, no throw. (Mutation: move the guard above step 2 → red.)
5. The existing four ZWDS tests stay green unchanged (same code, same message).
6. **The `default: throw` guard, reached by simulating a loosened 3.3.** ⚠️ With
   the allowlist in place NO test in 1-5 can reach `default:` — a HEALTH row is
   refused at 2b before the switch, so "restore `default: streamLifetimeV2`"
   leaves every test above green and the guard § 3.4 keeps "so it fails loudly
   if 3.3 is ever loosened" would be decoration (CLAUDE.md § Mutation-test every
   guard). So loosen 3.3 on purpose, in a SEPARATE spec file
   (`bazi.service.stream-dispatch-default.spec.ts` — `jest.mock` is file-scoped):
   ```ts
   jest.mock('./dto/create-reading.dto', () => {
     const actual = jest.requireActual('./dto/create-reading.dto');
     const { ReadingType } = jest.requireActual('@prisma/client'); // no out-of-scope refs in a mock factory
     return { ...actual, STREAMABLE_READING_TYPES: [...actual.STREAMABLE_READING_TYPES, ReadingType.HEALTH] };
   });
   ```
   `bazi.service.ts` imports the constant from that module (§ 3.1), so the
   service sees HEALTH as streamable and the switch has no `case` for it. Drive a
   paid-empty HEALTH row with all four streamers mocked `{ subscribe }` and
   assert: rejects `/Unreachable: no streamer for HEALTH/`; `streamLifetimeV2`
   NOT called; `redis.releaseLock` called (the catch's `releaseStreamSlot()` ran
   — slot and lock released); `refundReadingCredit` NOT called (a plain `Error`
   is not a self-refusal); `logger.error` called; and `quota.consume` WAS called
   — this turns the § 3.4 "reaching `default:` has already spent a quota unit"
   comment into a test, so a future reorder of the switch relative to the quota
   check (either direction) is visible. Mutation "restore
   `default: streamLifetimeV2`" → the mock is called and the run resolves → red.
   The new file needs its own harness (`jest.mock` is file-scoped): copy
   `buildWith` and put a one-line comment in EACH file pointing at the other, so
   the two copies are known to be twins when one changes.

**API — `apps/api/test/reading-type-surface.spec.ts`**: add
`expect(new Set(STREAMABLE_READING_TYPES)).toEqual(new Set(BAZI_CREATABLE_READING_TYPES))`
— **under Option A**. ⚠️ On its own this compares two literals imported from one
module and proves nothing about dispatch; it is a RELATIONSHIP lock that is
meaningful only alongside test 1 above, which proves the list drives the switch.
Under B it becomes `STREAMABLE ⊂ CREATABLE` plus `CREATABLE \ STREAMABLE ==
INLINE_ONLY_READING_TYPES` (§ 8).

**Web — `apps/web/test/reading-recovery-predicate.spec.ts`**: add `readingType:
'LIFETIME'` to the shared `paidEmpty` fixture **and to every inline object literal
in the file** — "treats a missing refundedAt as not-refunded" builds
`{ creditsUsed: 3 }` inline and would go red under fail-closed for the wrong
reason. New cases: HEALTH paid-empty → `false`; `ZWDS_LIFETIME` paid-empty →
`false`; each of the four V2 enums paid-empty → `true`; missing `readingType` →
`false` (fail closed, reason in the test name).

---

## 4. Part 2 — Option A: withdraw HEALTH from sale, keep rendering

Mirror of the ZWDS pattern (`ad106fc` + `3336922`): close every entry point that
CREATES or SELLS, keep every path that RENDERS an existing row.

### 4.1 API

- `create-reading.dto.ts`: remove `ReadingType.HEALTH` from
  `BAZI_CREATABLE_READING_TYPES`; extend the docblock: "HEALTH withdrawn
  2026-09-26 — V1-only, hidden from the homepage since `7a15e37`, no V2 streamer
  (todo #3)". `reading-type-surface.spec.ts` self-adjusts (HEALTH moves into the
  "neither ZWDS nor creatable → rejected" set); add one named test `rejects
  HEALTH — withdrawn, see plan` so the intent is greppable.
- **Deliberately kept** (they use HEALTH as the V1 stand-in at the service layer,
  below the DTO): `reading-create-preflight.spec.ts`, `ai-failure-refund.spec.ts`,
  `ai-service.spec.ts:187`. See § 3.2.
- **No change** to: the `ReadingType` enum, `prompts.ts` `HEALTH` V1 entry,
  `PRE_ANALYSIS_VERSIONS`, `admin.service.ts` cost tiers, `users.service.ts`
  history (HEALTH rows must keep listing), `getReading` (must keep serving).
- Operator, optional, belt-and-braces: `PATCH /api/admin/services/:id`
  `{ isActive: false }` on the `health` row in production. The DTO is the durable
  gate (the seed re-activates rows and is never run on prod); this makes the
  admin UI agree.

### 4.2 Web

- `apps/web/app/sitemap.ts:11`: remove `'health'`.
- `apps/web/app/pricing/page.tsx:80`: remove the `["先天健康分析", …]` row from
  `COMPARISON_ROWS` — the public pricing page must not promise a withdrawn product.
- `apps/web/app/components/AIReadingDisplay.tsx:1651`: remove the `health` entry
  from `BAZI_CROSS_SELL` (the last in-app link to the page). Update
  `apps/web/test/ai-reading-display.spec.tsx:272-293`, which asserts the grid
  contains `先天健康分析` and an `/reading/health` href — flip it to assert the
  grid does NOT contain them, so the withdrawal is pinned rather than merely
  unblocked.
- `apps/web/app/reading/[type]/page.tsx` — **no dedicated panel (owner decision
  2026-09-28: fix only what touches the main product).** Once the four sales
  surfaces above are closed, nothing links to `/reading/health`, so a typed URL
  gets the pattern the file already uses for ZWDS: the form renders and SUBMIT
  refuses. `const WITHDRAWN_TYPES: ReadonlySet<string> = new Set(['health'])`
  next to `isZwdsType` (`:105`), `const isWithdrawn = WITHDRAWN_TYPES.has(readingType)`
  in `ValidReadingPage`, and in `callNestJSReading` + `callDirectEngine` an
  `if (isWithdrawn) throw new Error('先天健康分析已停止提供，請選擇其他分析。')`
  beside the existing `isZwds` refusals — in the submit handlers only, never in
  render, so the hook order of `ValidReadingPage` is untouched (its docblock
  `:126-139` records the crash an early return there causes). The API's DTO
  rejection is the real gate; this is the friendly message in front of it.
  - **With `?id=`**: unchanged — `loadSavedReading` renders the stored V1
    sections (`constitution`/`wellness_advice` have icons at
    `AIReadingDisplay.tsx:102-103`; the other two use the generic renderer).
  - (v3 had a `WithdrawnTypePage` decided in the OUTER `ReadingPage`, reviewed
    hook-safe in rounds 2-3. Dropped as scope, not as design; § 12 keeps the
    reasoning if it is ever wanted.)
- **Keep**: `VALID_TYPES` entry (so `InvalidTypePage` is not shown and `?id=`
  works), `READING_TYPE_META.health`, dashboard `ENUM_TO_SLUG.HEALTH`,
  `PastReadingsSection`, `generateMockReading.health` (dev-only mock data).
- `e2e/reading-page.spec.ts:179` (file is `test.skip`ped by #9): its
  `headerTitle` expectation stays TRUE (the form still renders); add a one-line
  comment that the type is withdrawn and submit refuses. Do not un-skip it.
- Alternative considered: a middleware redirect `/reading/health` (no `id`) →
  `/reading/lifetime`. Rejected: it touches `middleware.ts`, which the E2E
  cookie-bypass family depends on, for a page nothing links to. The submit
  refusal is self-contained.

### 4.3 Mobile, chat, engine

Nothing. Mobile never mapped `health`; chat never enabled it; the engine has no
HEALTH-specific pipeline.

---

## 5. Docs and bookkeeping (same commit)

- **CLAUDE.md**
  - the ZWDS banner line "Reading types are now **6 Bazi + 2 special**" and the
    "Reading Types — 18 total" line → 4 sellable Bazi + COMPATIBILITY + FORTUNE;
    HEALTH withdrawn (kept for rendering), ZWDS deleted.
  - § "STREAMING and INLINE are not interchangeable" (`:3973-3974`): "HEALTH is the
    only real-user inline caller" → no real-user inline caller remains; the inline
    branch is reached over HTTP only by a cache hit (and by tests at the service
    layer).
  - § Security hardening → "Other invariants": the "`POST /api/bazi/readings`
    accepts only Bazi types" bullet → list the four, and add the new invariant
    "creatable == streamable, and `_setupStream` refuses anything else".
- **Handoff** `.claude/plans/launch-security-phase1-session-handoff.md` item 3:
  close in place with the decision, Step 0 result, commit hash.
- **This plan**: set status to SHIPPED with the same hash.

---

## 6. Remediation — only if Step 0 finds rows

For every REAL-account HEALTH row with `lifetime_shaped = true` or `paid_empty =
true`: refund via the existing semantics of `CreditsService.refundReadingCredit`
(`credits.service.ts:71`: sets `refunded_at` + `failed_reason`, increments
`users.credits`, writes a `+amount` `credit_ledger` row, leaves `credits_used`
intact — the double-refund guard). Do it as a one-off script on the pattern of
`load-test/purge-usage-log.mjs` (dry-run default, `--execute --target <host>`),
calling the service rather than hand-written SQL so the ledger invariant
`sum(credit_ledger.amount) == users.credits` holds. Rows with correct
`health_shaped` content are left alone — the customer got what they paid for.

Write the script only if Step 0 returns a non-zero count; do not build it
speculatively.

---

## 7. Verification (in order; every guard mutation-tested before commit)

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd apps/api && npx --no-install jest src/bazi/bazi.service.self-refusal-refund.spec.ts src/bazi/bazi.service.stream-dispatch-default.spec.ts test/reading-type-surface.spec.ts test/reading-create-preflight.spec.ts test/ai-failure-refund.spec.ts
cd apps/api && npx --no-install jest            # full api suite; watch the COUNT (baseline: re-measure first)
cd apps/api && npx --no-install tsc --noEmit
cd apps/web && npx --no-install jest test/reading-recovery-predicate.spec.ts test/ai-reading-display.spec.tsx
cd apps/web && npx --no-install jest            # full web suite
cd apps/web && npx --no-install tsc --noEmit    # compare against the pre-existing baseline, not zero
./node_modules/.bin/turbo run lint --force      # from the ROOT; confirm "0 cached"
```

**Mutation matrix** — each one must turn a named test red, and each must COMPILE
(`Tests: 0 total` is a non-result):

| mutation | expected red test |
|---|---|
| delete the allowlist guard (3.3) | § 3.6 test 2 (HEALTH refused); test 1 stays green — that is why test 2 exists |
| restore `default: streamLifetimeV2` | **test 6** (`stream-dispatch-default.spec`: mock called, run resolves) — tests 1-5 stay GREEN for this mutation, by construction |
| move the guard ABOVE step 2 | test 4 (HEALTH row with content is served) |
| move the guard BELOW `assertUnderCap` | test 3 (cap code wins, `assertUnderCap` called) |
| move the guard BELOW step 3 (slot) | test 2 (`incrementRateLimit` called) |
| make `CAREER` fall to `default` | test 1, CAREER row |
| add a type to `STREAMABLE_READING_TYPES` without a `case` | test 1 (derived table) |
| put HEALTH back in `BAZI_CREATABLE_READING_TYPES` (A) | surface spec equality + `rejects HEALTH` |
| put HEALTH into `STREAMABLE_READING_TYPES` | surface spec equality; test 1 (no mock for it) |
| drop the type check from `needsInterpretationRecovery` | web HEALTH → false case |
| make missing `readingType` return `true` | web fail-closed case |
| restore the `health` entry in `BAZI_CROSS_SELL` | `ai-reading-display.spec` negative assertion (scoped to the grid) |
| drop `readingType` from the regenerate `updateMany` WHERE | `bazi-regenerate.spec` "refuses a degraded HEALTH row" (WHERE assertion) |
| move the regenerate type check below `!reading.isDegraded` | same test (wrong code) |
| collapse `isV2Reading` to `=== LIFETIME` | preflight `it.each` CAREER/ANNUAL/LOVE rows |

**Live check (local stack, dev DB).** ⚠️ The stream route is `@Sse`: every
refusal arrives as **HTTP 200 + `event: error`**, never as a 400/500.

- `POST /api/bazi/readings` with `readingType: HEALTH` → **400** (DTO validation).
- A LIFETIME create + stream still completes end to end.
- `curl -N -H "Authorization: Bearer <token>" http://localhost:4000/api/bazi/readings/<existing paid-empty HEALTH id>/stream`
  → `event: error` / `data: {"message":"此類型分析不支援串流生成，無法重新生成。"}`,
  and the API log shows `[Stream] REFUSED … type=HEALTH`. (If the dev DB has no
  paid-empty HEALTH row, insert one by hand for the check and delete it after.)
- `/reading/health?id=<HEALTH row with content>` still renders its sections.
- `/reading/health` without id → the form renders; submitting it shows
  「先天健康分析已停止提供…」 and no request is charged.

---

## 8. If the owner chooses B (keep selling HEALTH via V1)

Ship Part 1 only, with these deltas: no 4.x changes; `reading-type-surface.spec`
asserts `STREAMABLE ⊂ CREATABLE` and `CREATABLE \ STREAMABLE ==
INLINE_ONLY_READING_TYPES` via a named constant `[HEALTH]`; the stream-route
refusal message for HEALTH stays as written (it is not a "停用" message). The
homepage-hidden / cross-sell-visible / sitemap-listed / pricing-page-promised
inconsistency then still needs a decision (show it everywhere, or nowhere) and
Option C becomes a product item on the handoff list.

---

## 9. Deploy

- No migration. No env var. No cache-version bump (nothing changes the content of
  any cached interpretation; HEALTH cache entries are keyed by type and are simply
  never requested again).
- Merging to `main` deploys (Railway, Wait-for-CI on). Under A, the API starts
  rejecting HEALTH creates at the moment the API deploys; the web bundle deploys
  separately — if the web deploys first nothing breaks (it stops offering the
  page), if the API deploys first a stale web tab that submits the health form gets
  a 400 and the page's error handler shows it. Acceptable for a page nothing links to.
- Optional operator step: deactivate the `health` `Service` row (§ 4.1).

---

## 10. Out of scope (recorded so they are not re-derived)

- **Option C** as scoped in § 1 — a feature with its own plan, Bazi-master doctrine
  cycle, and narrative grading gate. Nothing in A blocks it.
- The V1 `else` branch in `createReading` and the `prompts.ts` V1 map (incl. ten
  `ZWDS_*` entries) — dead for HTTP creation after A, but `generateInterpretation`
  is live as the V2 total-failure fallback and the service-layer specs use the
  branch. Deleting prompt text is a separate tidy.
- `apps/web/app/reading/[type]/page.tsx` `ACTIVE_V2_TOTAL` dev warning for
  non-V2 slugs, and its mobile twin `apps/mobile/src/lib/readings-api.ts:659-671`
  `expectedSectionTotal` (`default: return 1`) — cosmetic progress denominators,
  unreachable for HEALTH after A.
- `redis.acquireLock` ownership token — todo #23, adjacent code, not this item.
- `ai.service.ts` `buildCacheKey` / `getCachedInterpretation` still use a
  pre-existing `isV2 = LIFETIME || CAREER` literal (`:8088`, `:8116`), so ANNUAL
  and LOVE get an un-suffixed cache key and no stale-V1 rejection. Practically
  inert (any V1 ANNUAL/LOVE entry aged out on the 30-day TTL months ago) and
  untouched here; if "ONE list" is ever made a repo-wide invariant, this is the
  literal still outside it.
- `handleFormSubmit`'s catch swallowed `callDirectEngine` rejections (a
  pre-existing defect the ZWDS refusal shared): fixed in passing with a
  `setError`, the shape `handleFreeChart` already used. No RTL test drives that
  handler; verified by code and by the live 查看免費命盤 path (which has its own
  catch).

---

## 11. Open questions for the owner (answer before implementation starts)

1. ~~**A or B?**~~ **Answered 2026-09-28: A.**
2. ~~**Step 0**~~ **Answered 2026-09-29: WAIVED — not applicable.** The site has
   no production customers yet, so there is no real-account HEALTH row to
   refund; the only known affected row (`ab232801…`) was a load-test/hand-driven
   row, already refunded, and its account deleted. After this change a leftover
   HEALTH row can only render its stored content by `?id=` or render empty —
   it cannot be streamed as LIFETIME, regenerated, or charged — so any test-
   account leftovers are harmless. **If real customers exist before this
   deploys, run Q1/Q2 (§ 2) first and refund per § 6.**
3. ~~Panel or redirect?~~ **Answered 2026-09-28: neither** — the form renders and
   submit refuses (ZWDS pattern), § 4.2.

---

## 12. Review log

> **2026-10-01 — amended by `.claude/plans/pr73-review-fixes-plan.md`** (the
> `/code-review` of PR #73: 9 findings, none ≥ 80; eight of nine fixed — six at
> 75, two at 50; I at 35 dismissed). Its § 10 is the verification record and § 11
> carries that plan's own three-round review log. The material change: step 2b
> refused a charged-empty row without refunding it — see § 3.3 / § 3.5 / § 3.7
> notes above.

**Round 1 (2026-09-26) — VERDICT: REVISE, 15 issues (8 low · 5 medium · 2 high · 0 critical). All 15 applied in v2:**

| # | sev | what changed |
|---|---|---|
| 1 | low | line numbers corrected throughout § 0.1 / § 3 (step 2 `:1008-1015`, step 3 `:1017`, ZWDS guard `:1091-1119`/`:1111`, switch `:1144-1157`, V1 loop `ai.service.ts:427-497`, inline throw `bazi.service.ts:499-540`) |
| 2 | low | § 0.1: origin of row `ab232801…` stated as unknown; k6 never posted HEALTH; row was refunded |
| 3 | low | § 10: mobile `expectedSectionTotal` twin recorded |
| 4 | low | § 3.4: `default: throw` fires after `quota.consume` — documented in the comment, not re-ordered |
| 5 | low | § 3.3: dropped the "client handling" rationale; the `code` is unit-level only on an `@Sse` route |
| 6 | low | § 3.6 web spec: every inline literal gets `readingType`, not just the fixture |
| 7 | low | § 3.5: silent render of a paid-empty HEALTH row stated explicitly and tied to Step 0 refunds |
| 8 | low | § 3.2 / § 4.1: inline V1 branch is reachable at the service layer by named specs; those specs are kept; no service-level allowlist |
| 9 | medium | § 3.6 test 1: mocks return `{subscribe}`, run must RESOLVE, table derived from the constant |
| 10 | medium | § 3.6 test 3 replaced with one that can fail for the named mutation; test 2 also pins `quota.consume` |
| 11 | medium | § 3.4 / § 7: `@Sse` route → HTTP 200 + `event: error`; live check rewritten with `curl -N` |
| 12 | medium | § 0.2 / § 4.2: pricing page row (`pricing/page.tsx:80`) added; `ai-reading-display.spec.tsx:272-293` flipped to a negative assertion |
| 13 | medium | § 3.6: equality test labelled a relationship lock, meaningful only with test 1 |
| 14 | high | § 2: `users.email` does not exist — Q1 now filters on `u.name NOT LIKE 'LoadTest %'` |
| 15 | high | § 4.2: panel decided in the OUTER `ReadingPage` via `useSearchParams`; early return inside `ValidReadingPage` forbidden, with the docblock cited; live check adds the lifetime→health navigation |

**Verified correct in round 1 (do not re-derive):** `isV2Reading` is exactly the four
and HEALTH+`stream:true` goes inline; `isDegraded: true` has one writer; the five
`bazi_readings` writers; the single web route into the bug; `readingType` always
present on `getReading`; nothing side-effecting between step 2 and step 3; the
catch refunds only on `isSelfRefusal`; sibling shapes (`_assertRomanceV2`,
`buildPrompt` throws on unknown type, chat env whitelist, `emitStaticSections`
type-agnostic) — no other `default:`-to-a-product fallthrough exists; every
surface in § 0.2; `/api/og`, `robots.ts`, no layout under `reading/[type]/`;
deploy needs no migration/env/cache bump; `/reading(.*)` middleware-public; all
Step 0 `@map`s and JSONB operators (apart from the `email` column).

**Round 2 (2026-09-26) — VERDICT: REVISE, 4 issues (2 low · 2 medium · 0 high). All 15 round-1 items confirmed resolved. All 4 applied in v3:**

| # | sev | what changed |
|---|---|---|
| 1 | low | § 3.5: `page.tsx:673` replacement needs `as readonly string[]` (TS2345 against the 16-literal `ReadingTypeSlug` union) |
| 2 | low | § 3.6 test 1: the type→mock map is typed `Record<(typeof STREAMABLE_READING_TYPES)[number], …>` so a list entry without a mapping is a compile error |
| 3 | medium | § 4.2: `useSearchParams()` must sit directly after `useParams()` (`:141`), above the `InvalidTypePage` return — otherwise `/reading/bogus → /reading/health` is "more hooks than the previous render"; § 7 navigation check extended to both directions |
| 4 | medium | § 3.6 test 6 (new spec file): `jest.mock` the DTO module to add HEALTH to `STREAMABLE_READING_TYPES`, so a paid-empty HEALTH row actually reaches `default:`; asserts the `Unreachable` throw, slot+lock released, no refund, `logger.error`. § 7 matrix row for "restore `default: streamLifetimeV2`" corrected to name it — tests 1-5 cannot fail for that mutation |

**Verified correct in round 2 (do not re-derive):** guard outside the `try` leaks
nothing (`releaseStreamSlot` is defined only after the lock at `:1067`) and cannot
trigger the refund even if moved inside (not a self-refusal code); `default:
throw` inside the `try` → catch releases slot+lock → rethrow → `streamReading`
`.catch` → SSE `event: error`; `_setupStream` awaits nothing after `subscribe`
(`:1158-1173`, `try` closes `:1174`) so `{ subscribe: jest.fn() }` is the complete
mock; tests 2/3/4 are falsifiable for their § 7 mutations; `loading.tsx` is the
segment's Suspense boundary and returning a different element type from
`ReadingPage` unmounts `ValidReadingPage`; `.invalidType/.invalidIcon/.invalidTitle/
.invalidText/.dashboardLink` exist in `page.module.css:281-316` for the panel;
every `?id=` navigation shape keeps working; Q1/Q2 execute against the real
`@map`s and `COALESCE(u.name,'')` is required because `name` is nullable;
`ai-service.spec.ts:187` only calls `buildPrompt`; only `ai-reading-display.spec.tsx:263-293`
needs the negative flip (`:252-260` asserts the heading only); a stale tab does
see the 400 (`apiFetch` throws → `handleNestJSError`).

**Verification record — 2026-09-28 (implementation, worktree `claude/launch-security-phase1-review-05ef66`, uncommitted):**

| check | result |
|---|---|
| api `tsc --noEmit` | clean (after regenerating the worktree's STALE Prisma client — `outputTokensEstimated` from PR #71 was missing, so every suite importing `ai.service` failed to compile; environment, not code) |
| web `tsc --noEmit` | 0 errors |
| api targeted (self-refusal-refund · stream-dispatch-default · reading-type-surface · reading-create-preflight · ai-failure-refund) | 5 suites, 48/48 |
| web targeted (reading-recovery-predicate · ai-reading-display) | 2 suites, 31/31 |
| api full (`--config` pinned to `apps/api/jest.config.js`) | 138 passed / 1 skipped suites · **2438** passed / 5 skipped tests (2427 before the line-audit fixes; +11) |
| web full | 39 suites · 421 passed |
| `turbo run lint --force` from root | 5/5, **0 cached** |
| mutation matrix | **16/16 red** — see below (12 original + 4 from the line audit) |

⚠️ A first full-API run was a NON-RESULT: parallel Bash calls share one shell cwd,
a `cd` was clobbered mid-run, jest resolved the repo-ROOT config (babel, no
ts-jest) and reported "Test suite failed to run" for 20 suites across api/web/e2e.
Re-run alone with `--config <absolute path>`. The same clobber made the docs
script fail on a relative `CLAUDE.md` path. Pin paths absolutely when running
anything in parallel.

| mutation | named test | result |
|---|---|---|
| M1 delete the allowlist guard (whole block; the `if (false)` form did not compile — non-result, redone) | test 2 + ZWDS refusal + message + test 3 | 4 red |
| M2 restore `default: streamLifetimeV2` | stream-dispatch-default spec (every test's `rejects` sees a resolve) | 6 red; self-refusal spec 21/21 green by construction |
| M3 guard ABOVE step 2 | "still SERVES a paid HEALTH/ZWDS row with content" | 2 red |
| M4 guard BELOW `assertUnderCap`/`quota.consume` | test 2 (slot taken) + test 3 (cap code wins) | 2 red |
| M5 guard BELOW step 3 (slot+lock) | test 2 (`incrementRateLimit` called) | 1 red |
| M6 `CAREER` falls to `default` | test 1, CAREER row | 1 red |
| M7 HEALTH added to `STREAMABLE_READING_TYPES` (no case) | surface equality | 1 red |
| M7b same, vs the dispatch spec | exhaustively typed map → **TS2741 compile error**, suite fails to run | red (legible) |
| M8 HEALTH back in `BAZI_CREATABLE_READING_TYPES` | `rejects HEALTH` + surface equality | 2 red |
| W1 drop the type check from `needsInterpretationRecovery` | HEALTH / ZWDS / missing-type cases | 3 red |
| W2 missing `readingType` → `true` | fail-closed case | 1 red |
| W3 restore `health` in `BAZI_CROSS_SELL` | negative assertions (scoped to the grid) | 2 red |
| R1 drop `readingType` from the regenerate `updateMany` WHERE | `bazi-regenerate.spec`: WHERE assertion + the pre-existing full-WHERE assertion | 2 red |
| R2 move the regenerate type check below `!reading.isDegraded` | "answers with the TYPE refusal even for a NON-degraded HEALTH row" — added AFTER the first R2 run stayed GREEN (the degraded fixture still reached the moved check) | 1 red |
| C1 collapse `isV2Reading` to `=== LIFETIME` | preflight `it.each` CAREER/ANNUAL/LOVE, both directions | 6 red |

Source files verified byte-identical before and after every mutation.

**Line audit — 2026-09-29 (3 parallel staff-engineer agents: backend · frontend · cross-layer conformance).** 0 critical · 0 high · 3 medium · 11 low. All accepted and applied (same day):

| # | sev | finding → fix |
|---|---|---|
| B5/C5 | medium | `regenerateReading` had no `readingType` conjunct: a pre-fix DEGRADED HEALTH row would be nulled, refused at the stream, then told 「狀態正常」 — paid-empty by a user click. → § 3.7: `readingType IN` + `refundedAt: null` on the WHERE, type/refunded refusals ahead of the degraded answers, 3 tests, R1/R2 mutations. Step 0 decision table gained an `is_degraded` row. |
| B6 | medium | `isV2Reading` rewrite unpinned — collapsing it to `=== LIFETIME` left 117 tests green. → § 3.8: create-side `it.each` in the preflight spec, C1 mutation (6 red). |
| F5 | medium | `handleFormSubmit`'s catch swallowed `callDirectEngine` rejections (pre-existing; the ZWDS refusal shared it). → `setError(...)`, the shape `handleFreeChart` uses. |
| F4 | low | withdrawn check sat after Phase 1's chart computation. → Phase 1 gated on `!isZwds && !isWithdrawn`; the Phase-2 throw stays (hoisting it would hit the swallowing catch). |
| B1/B2 | low | stale "ends in `default: streamLifetimeV2`" comment; two harness copies described as "reuse". → wording; ONE hoisted `buildWith` shared by both describes. |
| B3/C3 | low | "reachable over HTTP only by a cache hit" was self-contradicting. → "unreachable over HTTP" in the service, CLAUDE.md and § 3.2. |
| B4 | low (60) | pre-existing `isV2 = LIFETIME \|\| CAREER` literal in `ai.service.ts` cache key. → recorded in § 10, untouched. |
| F1/C2 | low | `needsInterpretationRecovery`'s docblock was orphaned onto the new constants. → constants moved above it; fourth condition documented. |
| F2 | low | "surfaces as an error toast" — it would be a silent spinner stop. → wording (both sites). |
| F3 | low | page-wide `queryByText('先天健康分析')` would false-red on a lifetime `health` section. → scoped with `within(crossSellGrid)`. |
| C1 | low | plan status line self-contradicted; § 11 Q1/Q3 already answered. → fixed. |
| C4 | low | ZWDS test 4 was rewritten (`rejects.not` → `resolves` + call count), not "unchanged" as § 3.6 said. → recorded here. |

**Live test — 2026-09-29, this worktree's build on alternate ports** (API 4001 + web 3001, engine reused on 5001; ports 3000/4000/5001 belong to ANOTHER session's worktree and were left alone). Signed in as Roger in the built-in browser. Two tagged HEALTH fixtures inserted into the dev DB (one with V1 content, one paid-empty), deleted afterwards.

| check | result |
|---|---|
| `POST /api/bazi/readings` HEALTH, with and without `stream:true` | **400** `readingType must be one of the following values: LIFETIME, ANNUAL, CAREER, LOVE`; credits unchanged |
| `GET …/livetest-health-paidempty…/stream` | HTTP 200 `text/event-stream` → `event: error` `{"message":"此類型分析不支援串流生成，無法重新生成。"}`; API log `[Stream] REFUSED … type=HEALTH`; `UNREACHABLE` never logged; no refund; row untouched |
| `GET …/livetest-health-content…/stream` | served statically: 4× `section_complete` + `summary` + `done` |
| `/reading/health?id=<content fixture>` | chart tab renders Roger's chart; 命理解讀 tab renders all 5 fixture texts. Cosmetic, pre-existing: `health_risks` / `organ_analysis` have no Chinese title in the title map and render their raw keys |
| `/reading/health?id=<paid-empty fixture>` (recovery predicate) | `GET` the reading only — **no `/stream` request** in the network log; no error |
| `/reading/health` form → pick Roger → 完整解讀 | free chart shown, then banner 「分析失敗：先天健康分析已停止提供，請選擇其他分析。」; no `POST /api/bazi/readings`; credits unchanged (a −3 seen mid-run was a `reading-create:LIFETIME` from the OTHER session's stack on the shared dev DB — ledger + my API log + my tab's network all confirm it was not this test) |
| `/reading/health` form → 查看免費命盤 | 「先天健康分析已停止提供，請選擇其他分析。」 with **no** `/api/bazi-calculate` request |
| `/pricing` | no 先天健康分析 row; control row 愛情姻緣分析 present |
| `/reading/lifetime?id=…` cross-sell grid | heading 更多運程分析 present; no 先天健康分析 |
| `/sitemap.xml` | five reading URLs, no `/reading/health` |
| `POST …/livetest-health-content…/regenerate` after flipping the row to `is_degraded=true` (rebuilt API) | **400** `READING_TYPE_NOT_STREAMABLE` 「此類型分析不支援重新生成。」; row still degraded, `regenerationCount` 0, 4 sections intact; API log `[Regenerate] REFUSED … type=HEALTH` |
| dashboard `/` | five cards, no 先天健康分析 (already so before this change) |

Not exercised live: a full LIFETIME generation (real Anthropic spend, ~3 min) — the four V2 types are pinned by the derived dispatch table and the create-side table instead.

**Round 3 (2026-09-26) — VERDICT: APPROVE. 0 critical/high/medium. 2 optional lows, both folded into v3:**
(1) test 6 also asserts `quota.consume` was called, pinning the § 3.4 quota-spent
fact; (2) the two test harnesses cross-reference each other in a comment.
Reviewer re-verified under the installed toolchain: the `jest.mock` factory
resolves to the same module id as `bazi.service.ts:19` (spec sits in `src/bazi/`,
`apps/api/jest.config.js` remaps only `@repo/shared`, ts-jest hoists `jest.mock`
— precedent `apps/api/test/readiness.service.spec.ts:20`); `as const` is erased at
runtime so the spread works; ts-jest diagnostics are ON so the exhaustive map
type makes a missing mapping a failed suite; `it.each` over the readonly tuple
compiles; every navigation direction in § 4.2 is hook-safe; `?id=` empty string
is falsy for both checks.
