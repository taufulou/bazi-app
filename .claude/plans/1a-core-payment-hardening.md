# 1A-core — payment hardening before the first real store purchase

Design for Phase 1 track **1A-core** of `.claude/plans/app-store-ios-submission-plan.md`
(§4 Phase 1). Written 2026-11-21. Status: **APPROVED after 3 review rounds (round-3 lows folded in below);
implementation in progress.**

Backend only (`apps/api`). Merges to `main` first, which deploys to production
(2 API replicas, `prisma migrate deploy` at boot).

**Non-goals:** who counts as "entitled" does not change (`status === 'ACTIVE'`
stays the rule); no scheduler; no annual-membership logic; `PRODUCT_CHANGE`
behaviour unchanged (1A-core-b, from real payloads); no mobile/web changes.

Baseline before any change (2026-11-21, this worktree): api jest **148 suites,
2783 passed, 5 skipped**.

---

## Item 1 — Map the 7 v1 Apple products

**Problem.** `apple_product_id` is NULL everywhere, so every real purchase
resolves to nothing.

**Change.**
- Data-only migration `map_apple_product_ids_v1`. Each statement sets the id by
  slug only where the row's value is NULL **and** no other row already holds that
  id — `apple_product_id` is `@unique` (`schema.prisma:338`, `:426`), and a
  violation would fail `prisma migrate deploy`, block this and every later
  deploy until `migrate resolve`:
  ```sql
  UPDATE plans SET apple_product_id = 'com.tianming.app.basic.monthly'
   WHERE slug = 'basic' AND apple_product_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM plans WHERE apple_product_id = 'com.tianming.app.basic.monthly');
  ```
  Same shape for `pro`/`master` (`.monthly`) and `credit_packages`
  `starter-5`/`value-12`/`popular-30`/`mega-60` → `com.tianming.app.credits.5/12/30/60`.
  Precedent for data UPDATEs in a migration: `20260420233110_grant_master_monthly_credits`.
- `prisma/seed.ts`: the ids go in the upserts' **`create` branch only**
  (`seed.ts:44`, `:225`), so a re-seed never overwrites an operator's value.
- Deploy note: verify all 7 with `SELECT slug, apple_product_id FROM plans` /
  `credit_packages`. There is **no admin UI for this column**
  (`admin/dto/update-plan.dto.ts`, `credit-package.dto.ts`), so a mismatch is
  fixed with reviewed raw SQL.

---

## Item 2 — The "active" flag must not refuse an already-paid event (F27)

**Problem.** What is on sale is decided by the RevenueCat offering. But
`resolvePlan` (`revenuecat.service.ts:468-476`), `resolveCreditPackage`
(`:478-486`) and `EntitlementsService.grantMonthlyCredits`
(`entitlements.service.ts:166-172`, which also serves Stripe and silently skips
on a miss) all filter `isActive: true`.

**Change.**
- Drop `isActive` from all three where-clauses. Keep `findFirst` (no mock churn).
- Side effect, desirable: a refund of a deactivated pack no longer falls through
  to the subscription branch and gets lost.
- When the resolved row is inactive and the event is a sale (`INITIAL_PURCHASE`,
  `NON_RENEWING_PURCHASE`, `PRODUCT_CHANGE`), Sentry warning
  `revenuecat.inactive_product_purchased` (tags `productId`, `eventType`), then
  proceed.

**Tests** assert the **call arguments** — `expect(prisma.plan.findFirst)
.toHaveBeenCalledWith({ where: expect.not.objectContaining({ isActive:
expect.anything() }) })` — because the mocks return the row regardless of the
filter, so a behavioural test alone cannot detect `isActive` being re-added.

---

## Item 3 — Lost events must be loud and retried (F14)

**Problem.** Every handler logs and returns on an unmapped product or unknown
user; the controller answers 200 and sets the 48h idempotency key
(`revenuecat-webhook.controller.ts:66-75`).

**Change.**

1. **Store check first.** Move the `isIapStore` skip **above** `resolveUserId`
   in all four handlers — today it runs after (`:159`/`:166`, `:242`/`:251`,
   `:302`/`:306`, `:372`/`:376`). It needs no user, and otherwise a STRIPE or
   PROMOTIONAL event for an unknown id would 500 and retry.
2. A typed `RevenueCatEventNotProcessableError` thrown from the service. The
   controller already 500s and skips the idempotency key on any throw; it only
   gains a log line naming the type.
3. Throw sites: unmapped plan (`:173-177`), plan with no tier mapping
   (`:178-182`), unmapped pack (`:256-260`), and the never-seen user case below.
4. `resolveUserId` outcomes, in this order:
   1. **Resolved** → user id. (A same-Clerk-id re-signup resolves to the live row.)
   2. **Known-deleted** — a candidate has a `deleted_<id>_` row → log line,
      return null, handler returns, **200**.
   3. **Only `$RCAnonymousID:` candidates** → **log line only**, 200. Not a
      Sentry event: after a RevenueCat subscriber is deleted while an Apple
      subscription still bills, renewals may arrive under an anonymous id
      **[belief ~55%]** — routine after deletions, not an incident. Verified with
      one sandbox deletion during plan step 3.2; revisit if it turns out to be
      something else.
   4. **Never seen** → throw (500). Sentry level by environment:
      `PRODUCTION` → error `revenuecat.unknown_app_user`; `SANDBOX` or absent →
      warning. The likeliest real cause is a build signed into a different Clerk
      instance than the one the webhook serves (e.g. a build with the `appl_` key
      and dev Clerk); dev builds normally use the RevenueCat Test Store (`test_`
      keys), which fires no webhooks, so this should be rare. The runbook entry
      says so.
5. The deleted-user lookup is extracted from `common/signup-bonus.ts:147-161`
   into `findDeletedUserForClerkId(prisma, clerkUserId)`, which **propagates**
   errors. `resolveSignupCredits` keeps its try/catch, fail-open default and
   "withheld" warning unchanged. In `resolveUserId` a DB error → 500.
6. **TRANSFER** (`:402-435`): resolve the recipient with the same candidate
   logic as `resolveUserId` over **every** entry of `transferred_to` (today it
   reads `[0]` only, `:403-404`, and `[0]` can be an alias or anonymous id).
   Resolved → move as today. Known-deleted or anonymous-only → log, 200.
   Never seen → throw (500). The sender side stays as today.
   Known gap, recorded: a transfer **from** a deleted account moves a row that
   item 6 already marked EXPIRED, so the new owner has no tier until the next
   RENEWAL re-activates it.
7. Sentry payloads: RevenueCat event id, type, product id, store, environment.
   Never `app_user_id`.

**Retries are bounded** — RevenueCat retries a non-2xx a handful of times over a
few hours and then stops **[belief ~75%]**. A late fix (e.g. a mapping corrected
after the last retry) still needs manual recovery. New runbook section in
`docs/ops/incident-runbook.md`: find the event id in Sentry, fix the cause,
replay from the RevenueCat dashboard (or reconcile from
`GET /v1/subscribers/{app_user_id}`), confirm the resulting row and ledger entry.

**Tests:** store=STRIPE + unknown user → no throw, no lookup (call-order); each
throw site throws; known-deleted asserts the `startsWith: 'deleted_<id>_'`
clause and returns without writes; anonymous-only → no throw, no Sentry;
never-seen PRODUCTION → error level, SANDBOX → warning level; DB error in the
lookup → throws; TRANSFER to a never-seen id → throws; controller leaves the
idempotency key unset on the 500.

---

## Item 4 — Record whether money is real (F13)

- Enum `PaymentEnvironment { PRODUCTION SANDBOX }`; nullable `environment` on
  `subscriptions` and `transactions`. Additive, no default, no backfill.
- RevenueCat: `'PRODUCTION'`/`'SANDBOX'` mapped, anything else NULL. Written on
  the subscription create and update in `handleActiveSubscription` and on both
  transaction creates (purchase, refund — and item 5's new refund row).
- Stripe: `livemode ? PRODUCTION : SANDBOX` on the six create sites
  (`stripe.service.ts:847`, upsert `create` at `:1187`, `:971`, `:1240`, `:1303`,
  `:1368`). These are the only creates in `apps/api` (admin/ads/refunds write
  neither table).
- Backfilling existing Stripe rows is an operator step before Stripe goes live
  (plan §8), not this migration.
- Known gap, recorded not fixed: IAP **subscription** purchases write no
  `Transaction` row, so revenue reports reading `transactions` miss them.

---

## Item 5 — A refunded membership ends, and its credits come back (F17)

**Shared expiry path.** Extract `expireSubscription(userId, platform, txKey)`
from `handleExpiration`; both handlers call it.

**Refund branch** — in `handleCancellation`'s subscription branch, only when
`cancel_reason === 'CUSTOMER_SUPPORT'` (RevenueCat's refund reason
**[belief 80%]**):

- `expiration_at_ms` present and `<= now + 60s` → refund path:
  1. **One database transaction** (P2002 caught **outside** the interactive
     `$transaction` — a unique violation aborts a Postgres transaction, so the
     pack branch's catch-inside shape must not be copied) containing (a) a `REFUND` Transaction keyed
     `rc-refund:<transaction_id ?? event.id>` (same key shape as the pack
     branch, `:315`) and (b) the clawback. `clawbackCredits`
     (`entitlements.service.ts:327-355`) gains the optional `tx` parameter that
     `grantCredits` already has (`:298-316`). A P2002 on (a) means the clawback
     already happened → skip to step 2.
     - **What is clawed back:** the `MonthlyCreditsLog` row for
       `(userId, periodStart = event.purchased_at_ms)` — the same value the
       granting RENEWAL (`:224-230`) or INITIAL_PURCHASE (via the row's
       `currentPeriodStart`, set from `purchased_at_ms` at `:185`) used. Fall
       back to the row's `currentPeriodStart` only if `purchased_at_ms` is
       absent. No log row → nothing to claw back (another subscription was
       governing). Floored at 0, ledgered, reason
       `iap-sub-refund:<tier>:<key>`.
     - **Transaction amount:** RevenueCat's `price` field (USD) when it is a
       finite number — added to the `RevenueCatEvent` interface — as its
       absolute value; otherwise `0` with `(amount not provided)` in the
       description. Never an invented figure.
  2. **`expireSubscription`, unconditionally** — including after a P2002. It is
     idempotent, and skipping it on a retry is how a refund would be recorded
     but never revoke access.
  3. Sentry warning `revenuecat.subscription_refunded` with the amounts.
- `expiration_at_ms` absent **or** in the future → today's behaviour (set
  `cancelledAt`, stay ACTIVE) plus Sentry warning `revenuecat.refund_needs_review`.
  Fail-safe: if the real payload differs from the assumption, nothing is
  revoked and a human is told.
- Every other cancel reason keeps today's behaviour exactly (the billing grace,
  `:23-27`, `:132-138`, depends on it).

**Older events must not overwrite newer state.** In `handleActiveSubscription`,
a **state-based** guard (not wall-clock — in sandbox a period lasts minutes, so
any retried or delayed activation would already be "expired" and would be
silently dropped, losing the purchase):
- Applies only when a row already exists and the event carries
  `expiration_at_ms`. No row, or a null expiry → no guard.
- Ignore (log + Sentry warning `revenuecat.stale_activation_ignored`, return
  200, no write, no grant) when:
  - `event.expiration_at_ms < existing.currentPeriodEnd`, or
  - `existing.status === 'EXPIRED'` and `event.expiration_at_ms <=
    existing.currentPeriodEnd` (a retried RENEWAL for a refunded or expired
    period). A genuine resubscription on the same `original_transaction_id`
    carries a strictly later expiry and passes.
- **Refund-before-purchase:** only when the activation event carries a
  `transaction_id`: if a `rc-refund:<event.transaction_id>` Transaction exists,
  refuse to activate (same log + Sentry). A refund that arrived before its
  purchase must not lose to the purchase's retry. Assumes RevenueCat's refund
  CANCELLATION carries the refunded transaction's `transaction_id`
  **[belief ~65%]** — confirm on the payloads captured at plan step 3.3.
- **An older RENEWAL on an ACTIVE row** (condition 1) skips only the row write:
  that period was paid and its `MonthlyCreditsLog` key is distinct, so it still
  calls `grantMonthlyCreditsForSubscription` with the event's period (the
  governing gate still applies) — unless a refund exists for it.

Known gap, recorded: `REFUND_REVERSED` and `SUBSCRIPTION_EXTENDED` stay
log-only (`default:`), so a reversed Apple refund leaves the row EXPIRED until
the next renewal.

**Tests** use `Date.now()`-relative expiries (the fixture default `2026-03-01`
is in the past) and assert call arguments where a mock would otherwise return
the row regardless of the query:
- refund + past expiry → REFUND tx and clawback in one `$transaction`; the
  `monthlyCreditsLog.findUnique` call is asserted with
  `{ userId_periodStart: { userId, periodStart: new Date(purchased_at_ms) } }`;
  row EXPIRED; tier recomputed;
- duplicate refund (P2002) → no second clawback **but expiry still runs**;
- clawback throws → nothing committed, the error propagates (500, retried);
- refund + future expiry, refund + no expiry → ACTIVE + Sentry;
- `BILLING_ERROR` + **past** expiry → ACTIVE (the reason check is what keeps it);
- retried RENEWAL whose expiry equals the EXPIRED row's period end → no write,
  no grant; RENEWAL with a later expiry on an EXPIRED row → re-activates;
- ACTIVE row + older expiry → no row write, but the grant is still attempted
  with the event's period; ACTIVE row + **equal** expiry (UNCANCELLATION) →
  processed (catches a `<` → `<=` mutation);
- the refund-before-purchase lookup is asserted with
  `{ where: { stripePaymentId: 'rc-refund:<tx>' } }`; an activation with no
  `transaction_id` does not look it up;
- the P2002 test uses a `$transaction` mock that invokes the callback and
  propagates its rejection;
- activation with no existing row and a past expiry → **processed** (sandbox
  retry case);
- activation when an `rc-refund:` transaction exists → refused.

---

## Item 6 — Account deletion ends subscriptions, through both doors (F16)

**Scope cut (review round 2).** Stripe is still in test mode. The Stripe-side
hardening — widening the cancel filter, propagating cancel failures, listing a
customer's subscriptions at Stripe, deleted-owner guards in the Stripe webhook
handlers, the one-off script — moves to a follow-up, **launch todo #29**, which
must land **before Stripe goes live** (it is added to that todo as a blocker of
#4). This PR changes deletion only in ways that are no worse than today on the
Stripe side and correct on the store side.

**Problem.** Neither door ends `Subscription` rows, and the Clerk
`user.deleted` webhook (`clerk-webhook.controller.ts:218-264`; reachable via
Clerk self-deletion and the Dashboard) skips the Stripe cancel and the
RevenueCat subscriber delete that the in-app door does.

**Change.** One method, `UsersService.endSubscriptionsForDeletedUser(userId,
clerkUserId)`, called from both doors. It is today's in-app steps 3–4 moved
**unchanged in behaviour**, plus one new step:
1. Cancel at Stripe the rows that are `ACTIVE` with a `stripeSubscriptionId` —
   best-effort per row, logged on failure, exactly as `users.service.ts:108-125`
   does now (no widening, no propagation — those are #29).
2. Delete the RevenueCat subscriber — best-effort as today
   (`users.service.ts:288-305`), now with `AbortSignal.timeout(10_000)`.
3. **New:** `updateMany({ where: { userId, status: { not: 'EXPIRED' } }, data:
   { status: 'EXPIRED', cancelledAt: now } })`. A status update, never a delete.

The method never throws except from step 3 (a database error).

**Placement.**
- `deleteAccount`: guard (`:82-92`) → `erasePersonalData` →
  `endSubscriptionsForDeletedUser` → Clerk delete → anonymise. Same order as
  today with steps 3–4 replaced by the call.
- Clerk webhook: `erasePersonalData` → `endSubscriptionsForDeletedUser` →
  anonymise. No guard. Because steps 1–2 never throw, a Stripe or RevenueCat
  problem can no longer stop the anonymise (the round-2 regression is gone by
  construction). A step-3 database error → 500 → Clerk retries; everything
  before it is idempotent.

**Why this is safe to ship before #29:** marking a Stripe row EXPIRED when the
cancel failed does not make anything worse than today. Today the row stays
ACTIVE and Stripe keeps billing; with this change Stripe's next
`customer.subscription.updated` rewrites the row to ACTIVE
(`stripe.service.ts:806-818`) — i.e. back to today's state. Closing that is
exactly #29. For store subscriptions, the row ends and every later RevenueCat
event resolves as known-deleted (item 3) → 200, no write.

**Tests:** both doors call the shared method; Stripe cancel still ACTIVE-only
and best-effort (a Stripe error does not throw and does not stop the mark or
the anonymise); RevenueCat delete uses a timeout signal; rows marked EXPIRED
after the provider calls (call order); in-app guard still blocks; webhook door:
a Stripe failure still ends with the user anonymised; a step-3 failure
propagates.

---

## Follow-up — launch todo #29 (Stripe-side deletion hardening, before Stripe goes live)

Carried from review rounds 1–2, not built here:
- Widen the deletion cancel to every non-EXPIRED Stripe row and to subscriptions
  listed at Stripe for the customer (catches a checkout paid just before
  deletion and processed after).
- Detect "already canceled" by retrieving the subscription (skip `canceled` /
  `incomplete_expired`) or by error code; `resource_missing` = success. No
  message-text matching.
- Propagate real cancel failures — but only after making the Clerk webhook
  re-entrant (anonymise personal fields before the Stripe step, rename
  `clerkUserId` last), so a persistent Stripe failure can never leave a name in
  place.
- Deleted-owner guard in `handleSubscriptionUpdated` (both branches),
  `handleInvoicePaid`, `handleInvoiceFailed`, `handleCheckoutCompleted` and
  `handleOneTimePayment`; re-cancel and alert only when the Stripe status is
  live (`active`, `trialing`, `past_due`, `unpaid`, `incomplete`).
- One-off script for already-deleted accounts (`--execute --target`, no
  RevenueCat call).
- 10s Stripe client timeout.

---

## Existing tests that change (so the count is honest)

- `revenuecat-service.spec.ts:211` (unmapped plan "skips") → expects a throw.
- `:219` (unknown user "skips") → expects a throw.
- `:225` (anonymous id) → still no throw; assertion on no Sentry added.
- The RevenueCat test mock (`:14-25`) gains `user.findFirst` and
  `monthlyCreditsLog.findUnique`.
- `users-delete-account.spec.ts`: Stripe-cancel expectations unchanged; gains
  the mark-ended assertion.
- `clerk-webhook-lifecycle.spec.ts`: the deletion test gains the Stripe cancel,
  RevenueCat delete and mark-ended calls (the webhook's `UsersService` mock
  gains `endSubscriptionsForDeletedUser`).
- `entitlements-service.spec.ts` / `monthly-credits.spec.ts`: unchanged
  (`findFirst` kept).

## Migrations (additive)

1. `add_payment_environment` — enum + two nullable columns.
2. `map_apple_product_ids_v1` — seven guarded UPDATEs.

## Deploy notes

- Merging deploys; migrations run at boot.
- Verify the 7 product ids; fix mismatches with reviewed SQL (no admin UI).
- Sentry alert rules: `revenuecat.unmapped_product`,
  `revenuecat.unknown_app_user` (error); the warnings can stay dashboard-only. Alerting is a no-op without `SENTRY_DSN`.
- No cache-version bumps, no env vars.

## Verification

- api jest from `apps/api` (`npx --no-install jest`), full suite. Expected: the
  existing tests listed above edited, new tests added, everything else
  unchanged.
- `tsc` clean; root `./node_modules/.bin/turbo run lint --force`, 5/5, 0 cached.
- Mutation pass, each must turn a test red: the four throw sites; store check
  above user lookup; known-deleted 200; anonymous no-Sentry; the three
  `isActive` removals (via call args); refund reason check; refund expiry check;
  refund clawback key and atomicity; expiry-on-duplicate; stale-activation
  guard (both conditions); refund-before-purchase guard; provider-calls-before-
  mark order; webhook anonymise despite a Stripe failure; TRANSFER candidate
  iteration and throw.
- Separate line-audit agent before the PR.

---

## Review log

**Round 1 — 22 issues (1 high, 10 medium, 11 low).** All accepted.

| # | Disposition |
|---|---|
| 1 | Seed ids in `create` only |
| 2 | Deploy note: no admin UI, raw SQL |
| 3 | "Existing tests that change" section; `findFirst` kept |
| 4 | Absent expiry → review path, not revoke |
| 5 | `Date.now()`-relative fixtures; BILLING_ERROR uses a past expiry |
| 6 | Script: `--execute --target`, DI-free shared function, no RevenueCat call, unset key = failure |
| 7 | Noted; unresolved path only |
| 8 | `PRODUCT_CHANGE` included in the inactive-sale warning |
| 9 | Recorded as known cosmetic |
| 10 | TRANSFER to never-seen id → 500 |
| 11 | `REFUND_REVERSED` / `SUBSCRIPTION_EXTENDED` recorded as a known gap |
| 12 | IAP-subscription revenue missing from `transactions` recorded |
| 13 | Store check moved above user lookup in all four handlers |
| 14 | Call-argument assertions for `isActive` and the deleted-prefix clause |
| 15 | Anonymous-only → log line, no Sentry; verify at step 3.2 |
| 16 | Unknown-user Sentry level by environment; runbook triage |
| 17 | Recovery path in the incident runbook |
| 18 | Already-canceled = success; 10s timeouts on Stripe and the RevenueCat fetch |
| 19 | `NOT EXISTS` guard on every mapping UPDATE |
| 20 | Stale-activation guard in `handleActiveSubscription` |
| 21 | Refund claws back the refunded period's monthly grant, idempotently |
| 22 | Stripe cancel failures propagate; deleted-owner guard in `handleSubscriptionUpdated` and `handleInvoicePaid` |

**Round 2 — 12 issues (1 medium-high, 4 medium, 7 low).** All accepted; the
Stripe-side items moved to launch todo #29 per the reviewer's split suggestion.

| # | Disposition |
|---|---|
| 1 | Clawback test asserts the `findUnique` key |
| 2 | Moved to #29 (no widening in this PR) |
| 3 | Refund amount = RevenueCat `price` if present, else 0 + note |
| 4 | Moved to #29 (`handleInvoiceFailed` in the deleted-owner guard) |
| 5 | Refund-before-purchase guard |
| 6 | TRANSFER iterates all candidates; known gap recorded |
| 7 | Split accepted: Stripe hardening → #29 |
| 8 | Transaction + clawback atomic; expiry unconditional; tests for both |
| 9 | Clawback key = event `purchased_at_ms`, fallback row period start |
| 10 | State-based stale guard replaces the wall-clock one |
| 11 | Moved to #29 with the full handler list and the live-status condition |
| 12 | Gone by construction: deletion steps 1–2 never throw; propagation deferred to #29 behind a re-entrant webhook |

**Round 3 — 4 issues (all low).** All accepted. Reviewer: ready once folded in.

| # | Disposition |
|---|---|
| 1 | Tests added for stale-guard condition 1 (older and equal expiry on an ACTIVE row) and the refund-lookup key |
| 2 | P2002 caught outside the interactive transaction; mock invokes the callback |
| 3 | Older RENEWAL on an ACTIVE row skips the write but still grants its period |
| 4 | Refund-before-purchase guard only with a `transaction_id`; assumption recorded for step 3.3 |

**Line audit (post-implementation) — no Critical/High; 2 Medium, 7 Low.**

| # | Disposition |
|---|---|
| M1 | Fixed both ways: EXPIRATION records its expiry as the period end when later than stored; and an activation whose own period is already over never flips a row to ACTIVE — an existing ACTIVE row stays ACTIVE, anything else is recorded EXPIRED with no tier and no grant (`reason=period_already_over`). Supersedes the design's "no row + past expiry → processed". |
| M2 | Fixed: a refund of a period older than the row's current period claws that period back but does not expire; `refund_needs_review` with `reason=older_period`. |
| L1 | Fixed: refund tests use a distinct transaction client and assert nothing is written outside it. |
| L2 | Fixed: known-deleted is decided on the primary id only. |
| L3 | Fixed: subscription-refund key falls back to original transaction + purchase time. |
| L4 | Recorded for 1A-core-b: the stale guard applies to PRODUCT_CHANGE; a Google time-proration upgrade (earlier expiry) would be ignored. Apple upgrades extend, so v1 is unaffected. |
| L5 | Design-accepted, #29 (Stripe client timeout). |
| L6 | Design-accepted: an older RENEWAL on an EXPIRED row is ignored before the grant, so a paid period whose first delivery failed can miss its credits. |
| L7 | Doc nits fixed (deletion comment; runbook "prefer resend, never both"). |
