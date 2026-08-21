# Data inventory & retention (PDPA)

Companion to the published policy at `GET /privacy` (`apps/api/src/legal/legal.controller.ts`), which is also the privacy URL on the Play Store listing. The policy is the promise; **this document is what makes it checkable**.

Last reviewed: 2026-08-14 (Phase 1C).

---

## ⚠️ The policy promised something the code did not do

§4 of the published policy says:

> 您可隨時於 App 內「我的 → 刪除帳號」**永久刪除**您的帳戶與個人資料。

Until C1 (this phase) that was **false**. `deleteAccount` anonymized the `User` row — name, avatar, Clerk link, credits — and deleted nothing else. Every table is declared `onDelete: Cascade` from `User`, but because no row was ever deleted, no cascade ever fired. A user who asked to be deleted kept, indefinitely: every birth profile (date, time, city, coordinates, gender), every reading, every comparison, every chat message they typed, and every fortune snapshot.

The published claim is now accurate. Anyone changing `deleteAccount` is changing a statement in a live privacy policy, not just a method.

---

## What we hold

**Sensitivity ratings** are for this product specifically. Birth date + time + city + gender is the sensitive core: it is the input to everything, users regard it as private, and it is not replaceable if leaked.

| Table | Personal data | Sensitivity | On account deletion | Why |
|---|---|---|---|---|
| `User` | display name, avatar, Clerk id, device fingerprint | Medium | **Anonymized, row retained** | Financial rows FK to it with `Cascade`; deleting the row would take the accounting record with it |
| `BirthProfile` | name, birth date, birth time, city, timezone, lat/long, gender | **HIGH** | **Deleted** | The sensitive core |
| `BaziReading` | full interpretation about a named person | **HIGH** | **Deleted** | Derived from and describes the person |
| `BaziComparison` | two people's charts + relationship reading | **HIGH** | **Deleted** | Also concerns a *second* person, who never consented directly |
| `ChatSession` / `ChatMessage` | free text the user typed | **HIGH** | **Deleted** (cascade from session) | Most obviously personal content we hold; users ask about health, marriage, money |
| `DailyFortuneSnapshot` | narrative + `chartHash` | **HIGH** | **Deleted, before profiles** | FK is `SetNull`, so profile-first would *orphan* rather than remove — see below |
| `ReadingCache` | full interpretation JSON | **HIGH** | **Partially deleted** — see below | Content-addressed, so it survives every cascade |
| `Transaction` | amount, currency, provider payment id | Low | **Retained** | Tax / chargeback / accounting |
| `Subscription` | tier, status, period, provider ids | Low | **Retained** | Entitlement history; disputes |
| `CreditLedger` | signed credit movements + reason | Low | **Retained** | The only table that reconciles against a balance |
| `MonthlyCreditsLog` | period + amount granted | Low | **Retained** | Double-grant investigations |
| `AdRewardLog`, `SectionUnlock` | ids, timestamps | Low | **Retained** | Abuse/entitlement audit |
| `AIUsageLog` | tokens, cost, model | Low | Retained (`userId` is `SetNull`) | Spend monitoring |
| `AdminAuditLog` | admin actor + action | Low | Retained | Audit integrity — must survive the subject |

### The ordering trap

`DailyFortuneSnapshot.birthProfileId` is `SetNull`, **not** `Cascade`. Delete the profiles first and the snapshots survive with `birthProfileId = null` — narrative text plus a `chartHash`, with nothing left to attribute them to and no way to find them by user again. They must be deleted **while the link still exists**. `erasePersonalData` does snapshots first, and a test asserts the order rather than the outcome.

### Why `ReadingCache` needs explicit handling

It is keyed by a hash of the birth data with no `userId` column, so no cascade can reach it, and it holds the complete interpretation. Deletion purges it — bounded precisely by the user's own `BaziReading` rows, because the cache key folds in `readingType` and `targetYear` and cannot be enumerated blind. The hash comes from `AIService.generateBirthDataHash`, injected rather than re-implemented: a copy that drifts by one character silently stops matching, and deletion would report success while the cached readings stayed put.

---

## Retention

| Data | Retention |
|---|---|
| Birth profiles, readings, comparisons, chat, snapshots | Until the user deletes the item or the account |
| `ReadingCache` | ⚠️ **Indefinite.** `expiresAt` is a read-time filter only — see below |
| Financial + entitlement records | Retained after deletion, attached to an anonymized user row |
| Sentry events | Sentry project retention; **scrubbed of personal data before send** (see below) |
| PostHog events | PostHog project retention |
| Application logs | Railway platform retention |

---

## Telemetry: what must never leave the trust boundary

**The four pillars / 干支 are personal data.** They look like opaque symbols, so the instinct while debugging is 「it's just 甲子」. Year + month + day pillars pin a birth date to roughly one candidate per 60-year cycle — within a plausible lifespan, usually exactly one — and the hour pillar narrows to a two-hour window. Add the city and gender already in the same payload and it identifies a person. A single low-entropy field (`dayMasterStem`, 1-of-10) is fine; **the set is not**.

Correlate with a request id or `chartHash` and look the chart up inside the trust boundary.

**Sentry (NestJS)** — `sendDefaultPii: false` plus a `beforeSend` scrubber (`apps/api/src/common/sentry-scrub.ts`) that drops the request body wholesale, redacts auth headers and cookies, keeps only `user.id`, and removes whole 干支/chart subtrees rather than individual keys. Two layers because whether a given SDK version attaches request bodies by default has changed across majors — reading `node_modules` once is not a control that survives an upgrade. Pinned by `test/sentry-scrub.spec.ts`, which asserts a realistic event carries none of a list of known secrets.

---

## ⚠️ Corrections from the C1/C2 line audit

An earlier version of this document asserted controls that do not exist. Recorded rather than quietly edited, because a register that overstates is worse than no register.

**`ReadingCache` is NOT TTL'd.** `expiresAt` is set on write and then used *only* as a read-time filter. `grep -rn "@Cron"` over `apps/api/src` returns **zero matches** — nothing prunes it, so expired rows accumulate permanently. The same discovery invalidates a second claim elsewhere: CLAUDE.md references a `chat-cleanup.cron` that does not exist, so `ChatSession.hardDeleteAt`'s 12-month PDPA hard-delete is also unenforced. Both need a real job before either can be described as a retention control.

**The account-deletion cache purge is incomplete**, in two specific ways:

- **COMPATIBILITY readings are missed entirely.** They cache under `generateComparisonHash` — a *different* function with a different input shape, which also folds in the current year — while the purge enumerates only `BaziReading` and calls `generateBirthDataHash`. So every 合盤 cache row survives, and those hold **both parties'** charts.
- **ZWDS rows with a month, day, or question are missed.** `zwds.service.ts` keys with all nine hash arguments; the purge passes six. Reproduced: `ZWDS_QA` writes `b1a2ed54…` and the purge computes `1a3d8132…`. That row caches the answer to the user's own free-text question.

Plain Bazi readings *are* purged correctly — the arguments match the write path exactly.

**Redis holds birth-derived copies for up to 24h** after deletion and had no row in this register at all: `reading_cache:*`, `fortune:daily|monthly|yearly:{chartHash}:*`, and the merged `chat-context:*`. Time-bounded, so lower severity than the above, but 「永久刪除」 is stated without qualification.

## Open items

- **Engine Sentry does not exist yet.** `packages/bazi-engine` has no `sentry_sdk` at all, so C2's engine half is currently vacuous. When B3-a(0) adds it, `send_default_pii=False`, `max_request_body_size="never"` **and `include_local_variables=False`** are all mandatory — sentry-python attaches stack-frame locals by default, and in this codebase the locals at an engine exception are the birth data and the pillars.
- **PostHog `autocapture` is left at its default (on).** `apps/web/app/providers.tsx` sets only `capture_pageview`/`capture_pageleave`. PostHog does not capture text-input *values* in autocapture, so the birth form should be safe — but that is a documented vendor behaviour, not something this repo enforces, and `$current_url` does carry `profileId` UUIDs. Verify against a real PostHog event before launch, then either confirm here or set `autocapture: false`. Deliberately not changed on a guess: it is a product-analytics decision.
- **`BaziComparison` holds a second person's birth data**, supplied by the account holder. That person cannot exercise a deletion right they don't know they have. Acceptable for a couples-compatibility feature, worth stating in the policy.
- **No automated retention job.** Nothing prunes old readings or chat for *active* accounts; data lives until the user removes it. Fine at current scale, revisit before the volume makes it a liability.
