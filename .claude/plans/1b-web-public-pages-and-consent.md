# 1B — public legal/support pages, corrected legal text, AI-consent storage, web fixes

Design for Phase 1 track **1B** of `.claude/plans/app-store-ios-submission-plan.md`
(§4 Phase 1; findings F2, F3, F20, F23, F24; F6's server half). Written 2026-11-21.
Status: **APPROVED after 4 review rounds; IMPLEMENTED 2026-11-21, not committed.** See
"Implementation record" at the end for deviations, the audit fix and verification.

Touches `apps/api` and `apps/web`. No mobile code (1C). Merging to `main`
deploys both services — independently, so web and API may briefly run
mismatched versions (handled in item 5).

---

## Item 1 — `/privacy`, `/terms`, `/support` on `tianmingapp.com` (F3)

**Problem.** App Store Connect needs Privacy Policy and Support URLs that open
without signing in. The text lives only on the API's Railway host
(`legal.controller.ts`). On the website, every unlisted path is
`auth.protect()`ed (`apps/web/middleware.ts:16-42`, `:87-89`), and
`SignedOutRedirect` (mounted in `app/layout.tsx:87`) redirects signed-out
visitors client-side except on `/sign-in*` and `/sign-up*`.

**Change.**
- **Single source stays in the API.** `legal.controller.ts` gains `GET /support`
  (with `@Public()` — the decorator is per-method, `:52`, `:106`; without it the
  global Clerk guard 401s and the website would serve its fallback forever). The
  API keeps serving all three on its own host (the Play listing points at
  `/privacy` there). Web cannot import `apps/api`, and `@repo/shared` is
  off-limits to the NestJS runtime, so serving the API's HTML is the way to
  keep one copy.
- **Links inside the HTML that point at website-only routes** (sign-in for
  forgotten passwords, `/dashboard/subscription`) are **absolute**, built from
  the canonical web origin — the first entry of `WEB_ORIGINS`
  (`webOriginsFromEnv()`, `payments/safe-redirect-url.ts:114`). Relative links
  would 404 on the API host. `/privacy` and `/terms` links stay relative (both
  hosts serve them). Each page carries `<link rel="canonical">` to the
  `tianmingapp.com` copy.
- **Web route handlers** `app/privacy/route.ts`, `app/terms/route.ts`,
  `app/support/route.ts`, sharing `app/lib/legal-proxy.ts`:
  - fetch `${NEXT_PUBLIC_API_URL}/privacy|terms|support` server-side — the same
    variable the existing server proxies use (`app/api/bazi-calculate/route.ts:45`)
    and that `Dockerfile.web:79-88` already requires. No new env var (a new one
    would also need `turbo.json`, or lint fails).
  - `AbortSignal.timeout(5000)` and `next: { revalidate: 3600 }` on the fetch.
    Next 16.3.1 caches only 200 responses and serves the stale copy while
    revalidating, so a short API outage does not take the policy down once the
    cache is warm.
  - **No top-level `export const revalidate` / `dynamic` in these files**, with
    a comment saying why: either would make `next build` prerender the route,
    i.e. call the API at build time and fail or bake the fallback into the image.
  - upstream non-200, timeout or network error → a small static fallback page,
    status 503, saying the page is temporarily unavailable and giving the
    contact email.
  - The response is `text/html; charset=utf-8`. Route handlers render no React
    tree, so **neither the layout nor `SignedOutRedirect` runs**.
- **Middleware**: export the public pattern array (`PUBLIC_ROUTE_PATTERNS`) and
  add `'/privacy'`, `'/terms'`, `'/support'` (exact paths).
- `sitemap.ts`: add the three URLs.

**Tests.**
- Web, `@jest-environment node`: `legal-proxy` returns the upstream body with
  the HTML content type; returns the 503 fallback with the contact email on
  non-200, on a thrown fetch and on timeout.
- Web: build `createRouteMatcher(PUBLIC_ROUTE_PATTERNS)` in jest and assert
  `/privacy`, `/terms`, `/support` match while `/`, `/privacyx`, `/privacy/x`
  and `/dashboard` do not (behaviour, not a source grep).
- API: a NEW `legal.controller.spec.ts` asserting, via `Reflector`, that all
  three handlers carry the `IS_PUBLIC` metadata (calling the methods directly
  cannot catch a missing `@Public()`), plus the content checks in item 2.
- Playwright (repo-root `e2e/signed-out-lockdown.spec.ts`, not in CI — run
  locally): add the three paths to its `PUBLIC` array, which already checks
  the final pathname. For the client layer, also assert the response body
  contains **no `<script` and no `/_next/static`** — proof that no client-side
  redirect can run, which a URL check after `load` cannot give (Clerk hydrates
  after `load`).

---

## Item 2 — Correct the legal text (F24, and what the AI really receives)

Text in `legal.controller.ts`; constants (`EFFECTIVE_DATE`, `CONTACT_EMAIL`,
`AI_DATA_DISCLOSURE_ZH`, `AI_CONSENT_VERSION`, `AI_CONSENT_ACCEPTED_VERSIONS`,
`AI_CONSENT_DISCLOSURE_SHA256`) in a new `legal/legal-constants.ts`, so
`UsersService` never imports a controller module.
`EFFECTIVE_DATE` → the merge date.

**What actually goes to Anthropic** (verified against the prompt templates,
`apps/api/src/ai/prompts.ts:503-504, 572-573, 638-639, 696-697, 755-756, 1006,
1045, 1083`): **birth date, birth time and gender**, plus the Bazi chart and
analysis computed from them; for 合盤, **the other person's** birth date, time
and gender; and the **text typed into AI chat**. **Not sent:** names, email,
birth city. All three sentences — 「出生日期、出生時間、性別，及據此計算之八字
命盤與分析資料」, the 合盤 sentence and the chat sentence — live in ONE exported
constant, `AI_DATA_DISCLOSURE_ZH`, which the privacy page interpolates. The old
wording 「必要的命盤衍生資料」 understated it. 1C's consent sheet cannot import
the constant; 1C must state that its bundled text equals
`AI_DATA_DISCLOSURE_ZH` for the version it sends.

**Privacy policy**
- `APP_NAME` 「天命 BaziApp」 → 「天命」.
- §1 帳戶資料: email, Google, **Sign in with Apple** (including Apple's private
  relay address).
- §1 購買資料: in the apps, Apple App Store / Google Play; on the website,
  **Stripe**, which receives the name and email for billing
  (`stripe.service.ts:102`). We never see or store card details.
- §1 使用與裝置資料: **scoped to the website** (PostHog, Sentry) and to crash
  diagnostics in the apps (Sentry). Mobile PostHog is off in v1 (plan O5); the
  policy must not contradict the App Privacy label.
- §2 AI, **per channel**: in the iOS/Android apps we ask for consent before the
  first AI feature, and declining leaves the non-AI chart working; on the
  website, using an AI feature sends the data listed above. How to **withdraw**:
  in the app (1C) or by email; withdrawing stops future AI processing.
- §3 processors: add Stripe; AI = **Anthropic only** (decided, Q1). RevenueCat,
  Clerk, Railway, PostHog (website), Sentry stay.
- §3 a sentence on **cross-border processing**: these providers process data
  outside Malaysia/Taiwan, including the United States.
- §4 deletion: in-app 「我的 → 刪除帳號」 **or by email** (the website has no
  deletion page); store subscriptions must be cancelled in the store; financial
  records retained.

**Terms** — `APP_NAME`; §3: app purchases via Apple/Google and their terms,
website purchases via Stripe; auto-renew wording covers both (website
subscriptions are cancelled on the website's subscription page). Refund
sentence unchanged.

**Support page** — contact email; FAQs: cancel (iPhone: Settings → your name →
Subscriptions — not "Apple ID", renamed Apple Account in iOS 18; Android: Play
Store → Payments & subscriptions; website: the subscription page, absolute
link); restore purchases (app → 商店 → 恢復購買); reset password (sign-in page
→ 忘記密碼, absolute link); delete account (app → 我的 → 刪除帳號, or email);
withdraw AI consent; the entertainment disclaimer; links to Privacy and Terms.

**Keeping "Anthropic only" true.** At the provider setup in `ai.service.ts`
(`:352-387`), if `OPENAI_API_KEY` or `GEMINI_API_KEY` is set, log an
**error** at boot: the privacy policy names Anthropic as the only AI provider
and must be updated first. A comment alone would not be seen.

**Tests** (in the new `legal.controller.spec.ts`): each page is 200 HTML;
privacy contains Stripe, Sign in with Apple, the exact data-list sentence, the
合盤 sentence, the per-channel consent and withdrawal sentences, the
cross-border sentence and Anthropic, and contains none of `OpenAI`, `GPT`,
`Gemini` (not "Google" — Google sign-in and Google Play are legitimately named); support contains the contact email, links to `/privacy` and
`/terms`, and absolute links to the canonical web origin; no page contains
「BaziApp」 or 「Apple ID」. A unit test that the boot-time provider check logs
an error when `OPENAI_API_KEY` is set.

---

## Item 3 — Store the user's AI-consent decision (F6, server half)

- `User.aiConsentAt DateTime?`, `User.aiConsentVersion String?` — additive,
  nullable migration.
- `POST /api/users/me/ai-consent` body `{ version: string }`:
  - goes through `ensureUser` (`users.service.ts:700`), not `findByClerkId`, so
    consent given before any other API call does not 404;
  - **Versioning (round-2 H1).** `AI_CONSENT_VERSION` is its OWN constant
    (`'ai-2026-11-21'`), **not** the policy date: `EFFECTIVE_DATE` changes with
    any typo fix, Terms edit or new FAQ, and tying consent to it would make every
    installed app's bundled version stale after routine edits. It is bumped
    **only** when the AI disclosure materially changes (data list, provider,
    purpose).
  - **Pin (round-3 L3):** `AI_CONSENT_DISCLOSURE_SHA256: Record<version, sha256>`.
    Tests: `sha256(AI_DATA_DISCLOSURE_ZH) === AI_CONSENT_DISCLOSURE_SHA256[AI_CONSENT_VERSION]`;
    every accepted version has a map entry; the rendered privacy HTML contains
    `AI_DATA_DISCLOSURE_ZH`. A map rather than one hash: editing the text then
    forces a NEW key — a new version — instead of pasting a new hash over the
    old one.
  - The server accepts any version in `AI_CONSENT_ACCEPTED_VERSIONS` (initially
    `['ai-2026-11-21']`) and stores the one the client displayed. Unknown
    string → **409** `CONSENT_VERSION_UNKNOWN` with `currentVersion` in the
    body. A version is removed from the allowlist only on purpose, when the old
    disclosure has become false (e.g. a provider was added) — the one case where
    stranding old builds is correct;
  - sets both columns; re-posting refreshes them; `@Throttle` 10/min.
- `DELETE /api/users/me/ai-consent` → nulls both (withdrawal). Same throttle.
- `GET /api/users/me` already returns every User column (`findByClerkId`
  uses `include` without `select`, `:34-53`), so it gains `aiConsentAt` and
  `aiConsentVersion` with no change; add `aiConsentCurrentVersion` so the app
  can tell when to ask again, **and `aiConsentAcceptedVersions`** (round-3 M1).
  **Rules handed to 1C — set membership only, no version ordering:**
  - a 404 from `/users/me` → not consented;
  - **consented** iff the stored version is in the accepted list;
  - not consented and the build's bundled version IS accepted → show the
    bundled sheet, POST the bundled version;
  - not consented and the bundled version is NOT accepted → "update the app to
    keep using AI features";
  - optional re-ask: bundled version = current and stored version ≠ current;
  - a 409 `CONSENT_VERSION_UNKNOWN` can then only come from a race (a version
    retired between GET and POST) → treat as "update the app".
- **Never** add these fields to `UpdateUserDto` — `updateProfile` spreads the
  DTO straight into `prisma.user.update` (`:376-379`).
- **No server-side enforcement in v1** (unchanged decision): 5.1.2(i) applies to
  the App Store app, whose client gate App Review exercises; the website has no
  consent screen; enforcing would break every web user.
- Deletion: both doors' anonymise blocks (`users.service.ts:131-144`,
  `clerk-webhook.controller.ts:262-272`) also null the two columns. (The
  earlier "auditable" claim is dropped: the record is not kept after deletion.)

**Tests:** an accepted version → stored via `ensureUser`; an older but still
accepted version → stored as sent; unknown version → 409 with the current
version; the pin tests above; `GET /users/me` returns `aiConsentCurrentVersion`
and `aiConsentAcceptedVersions`; withdrawal nulls both; `GET /users/me` exposes the three
fields; both deletion doors null them; `UpdateUserDto` rejects the fields
(whitelist).

---

## Item 4 — `baziapp.com` on the website's share cards (F2, web half)

- `ShareableFortuneCard.tsx:205`, `ShareableMonthlyFortuneCard.tsx:203`,
  `ShareableYearlyFortuneCard.tsx:200` print `siteHost()` — a new helper in
  `app/lib/site-url.ts` returning the host of `SITE_URL`.
- `fortuneShareUrl()` (`share-fortune.ts:150-153`) uses
  `window.location.origin`, which is already `tianmingapp.com` in production —
  left unchanged.
- Guard: a test that no file under `apps/web/app` contains the wrong domain,
  with the needle built at runtime so the test does not match itself. The
  mobile copies (`apps/mobile/src/app/store.tsx:40-41` and four share cards)
  are 1C's; 1C adds the same guard for `apps/mobile/src` and its links depend
  on this PR being deployed.

---

## Item 5 — The website must handle App Store / Google Play memberships (F20)

**Problems** (all CONFIRMED): the platform label compares `"APPLE"`/`"GOOGLE"`
(`dashboard/subscription/page.tsx:258-260`) against `APPLE_IAP`/`GOOGLE_PLAY`;
Stripe-only actions show for any paid tier; `/pricing`'s 升級/降級方案 call
`upgradeSubscription`, which filters `platform:'STRIPE'` and 404s for a store
member; `/pricing` defaults the tier to FREE when the status fetch fails
(`pricing/page.tsx:145-147`), offering 立即訂閱 to a paying member; and
`createSubscriptionCheckout` (`stripe.service.ts:89-160`) has no
already-subscribed guard, so that path bills a second, parallel subscription.

**API**
- `getSubscriptionStatus` adds `stripeSubscription`: the newest STRIPE row that
  is ACTIVE, PAST_DUE (a member who needs the portal to fix their card — Stripe's
  `unpaid` also maps here), or **CANCELLED with `currentPeriodEnd > now`** (a
  CANCELLED row past its end is stale: a lost `subscription.deleted` or an
  out-of-order `updated(canceled)` can leave one, and offering 重新啟用 on it would
  fail at Stripe). Fields: `status`, `cancelledAt`, `currentPeriodEnd`.
  `activeSubscription` is unchanged.
- `createSubscriptionCheckout` (only caller: `pricing/page.tsx:227`) refuses with
  **409** and a zh-TW `message` when the user has:
  - an ACTIVE subscription on any platform → `ALREADY_SUBSCRIBED`: 「您已有進行中的
    會員方案。若方案來自 App Store／Google Play，請先在手機取消，待目前週期結束後再於網站訂閱。」
    (a store member is blocked until RevenueCat's EXPIRATION arrives — the
    intended outcome, it prevents paying twice); the message ends with
    「如有疑問請來信 {CONTACT_EMAIL}」 — the escape hatch for a store row left
    ACTIVE because EXPIRATION never arrived (no time-based override: the
    billing-grace window keeps rows ACTIVE past period end by design,
    `revenuecat.service.ts:26-28`);
  - a STRIPE row that is PAST_DUE → `PAYMENT_PAST_DUE`: 「上一筆扣款未成功，請至
    『管理帳務資料』更新付款方式。如有疑問請來信 {CONTACT_EMAIL}」 (otherwise a recovered dunning would leave two
    live Stripe subscriptions, both billed — `stripe.service.ts:951-958`);
  - a STRIPE row CANCELLED with `currentPeriodEnd > now` →
    `CANCELLATION_PENDING`: 「您的方案已排定取消，可直接重新啟用。」
  Paid members never reach checkout: `/pricing` sends them to
  `upgradeSubscription` (`:426-427`), which this does not touch. Credit-pack
  checkout is untouched.

**Web** — one derived value, used by both pages:
`stripeSub = status.stripeSubscription ?? (activeSub?.platform === 'STRIPE' ? activeSub : null)`
(the fallback covers a new web running against an old API during a deploy).
- **Subscription page:**
  - labels: `APPLE_IAP` 「App Store」, `GOOGLE_PLAY` 「Google Play」, `STRIPE`
    「信用卡 (Stripe)」.
  - Stripe actions are driven by `stripeSub`, not by `isPaid`:
    管理帳務資料 (portal) when `stripeSub` exists (any of the three statuses);
    取消訂閱 when `stripeSub.status === 'ACTIVE'` and no `cancelledAt`;
    重新啟用訂閱 **only when `stripeSub.status === 'CANCELLED'`** — a portal
    cancel leaves the row ACTIVE with `cancelledAt` set
    (`stripe.service.ts:808-820`) and `reactivateSubscription` only finds
    CANCELLED rows (`:365-372`), so showing it there would 404. The
    「將於到期日取消」 badge may use `cancelledAt`.
  - the cancel-confirm dialog uses `stripeSub.currentPeriodEnd`, not
    `activeSub`'s.
  - **store-governed** = `isPaid && !stripeSub`: show 「此方案透過 App Store／
    Google Play 訂閱，請在手機的訂閱設定中管理或取消。」 and hide 變更方案.
  - 升級方案 shows only when there is no `stripeSub` and the user is not
    store-governed (a PAST_DUE Stripe member reads as FREE and must be sent to
    the portal, not to a second checkout).
- **Pricing page:** same `stripeSub` derivation; for store-governed users hide
  升級/降級方案 and show the same note; when the status fetch fails, show an
  error state instead of treating the user as FREE.

**Tests.** API: `stripeSubscription` present alongside a newer Apple row, null
when none, includes PAST_DUE, includes CANCELLED only while its period is still
running; checkout → `ALREADY_SUBSCRIBED` with an ACTIVE Apple row,
`PAYMENT_PAST_DUE` with a PAST_DUE Stripe row, `CANCELLATION_PENDING` with a
running CANCELLED Stripe row, allowed with an expired CANCELLED row or none;
each 409 carries a zh-TW message. Web RTL: store member → store label + note, no Stripe buttons;
Stripe member → buttons; mixed → Stripe buttons; portal-cancelled (ACTIVE +
`cancelledAt`) → badge, no reactivate; CANCELLED → reactivate; PAST_DUE with
tier FREE → portal; old-API response (no `stripeSubscription`, Stripe
`activeSubscription`) → buttons still shown; pricing fetch failure → error
state. The existing fixtures in `test/subscription-management.spec.tsx:54-71`
gain `stripeSubscription`; those tests change as a consequence.

---

## Item 6 — Website copy (F23, web half)

- `app/sign-in/[[...sign-in]]/page.tsx:34` 「預見你的一生」 → 「八字命理・AI 解讀」.
- `app/layout.tsx:45, 54, 64` metadata still advertises 紫微斗數 (deleted) — in
  search results and link previews for the site the app now links to. Remove.
- Public sign-in and sign-up pages get a small footer: Privacy · Terms ·
  Support (relative links — same host).
- Confirm in a signed-out browser that Clerk's `<SignIn />` shows a
  forgot-password link on the password step.

---

## Decided (owner, 2026-11-21)

**Q1 — AI providers: Anthropic only.** Neither `OPENAI_API_KEY` nor
`GEMINI_API_KEY` is set on the Railway API service. Kept true by the boot-time
error in item 2.

## Migrations

1. `add_ai_consent_to_users` — two nullable columns.

## Deploy notes

- Merging deploys API and web independently; item 5's fallback covers the gap.
- **Before merging:** confirm the first `WEB_ORIGINS` entry on the Railway API
  service is `https://tianmingapp.com`. It is the canonical origin for every
  absolute link and canonical tag in the legal pages; if the Railway web domain
  is first, the links point where the production Clerk key does not work. The
  legal spec asserts the links use `parse.canonical`.
- After deploy, open `https://tianmingapp.com/privacy`, `/terms`, `/support`
  signed out; these go into App Store Connect (plan step 6.6).
- No new env vars, no cache bumps.

## Verification

- api and web jest from their own directories; tsc both; root
  `turbo run lint --force` 5/5, 0 cached.
- Mutation pass: each middleware entry; the proxy fallback; `@Public()` on
  `/support`; the consent version check and `ensureUser`; withdrawal; each
  Stripe button's condition; the checkout 409; the deploy-skew fallback; the
  pricing error state; the wrong-domain guard; the deletion nulling; the
  provider boot check.
- Browser: the three pages signed out (local `next dev` in a fresh profile).
- Separate line-audit agent before the PR.

---

## Review log

**Round 1 — 1 high, 5 medium, 1 low-medium, 10 low.** All accepted except L7
(left as is, by the reviewer's own recommendation).

| # | Disposition |
|---|---|
| L1 | No `API_INTERNAL_URL`; `NEXT_PUBLIC_API_URL` like the existing proxies |
| L2 | No top-level route config; comment explains |
| L3 | Patterns exported; behavioural matcher test |
| L4 | node test environment; repo-root e2e path; fixture changes stated |
| L5 | Deploy-skew fallback for `stripeSubscription` |
| L6 | `ensureUser`; never in `UpdateUserDto`; server-side `AI_CONSENT_VERSION` with 409; "auditable" dropped |
| L7 | `fortuneShareUrl` left unchanged |
| L8 | Web guard here; 1C adds the mobile guard; dependency noted |
| L9 | Stripe receives name/email; cross-border sentence; PostHog scoped; "Apple ID" avoided; boot-time error instead of a comment |
| L10 | 紫微斗數 metadata removed; legal footer on sign-in/sign-up |
| LM1 | `stripeSubscription` includes PAST_DUE; portal shown for it |
| M1 | Reactivate only for CANCELLED; badge from `cancelledAt`; dialog uses the Stripe row |
| M2 | `/pricing` gated; fetch failure → error state; checkout 409 when any active subscription exists |
| M3 | Per-channel consent wording; withdrawal endpoint and policy sentence |
| M4 | Website-only links absolute from `WEB_ORIGINS`; canonical link |
| M5 | Playwright asserts no scripts in the body; `Reflector` test for `@Public()`; new spec file |
| H1 | Policy lists birth date, time, gender, the chart, the 合盤 partner's data and chat text; names/email/city not sent |

**Round 2 — 1 high, 1 medium, 1 low-medium, 4 low.** All accepted.

| # | Disposition |
|---|---|
| L1 | Test needles are `OpenAI`/`GPT`/`Gemini`, not "Google" |
| L2 | Constants in `legal/legal-constants.ts` |
| L3 | zh-TW 409 messages; the store-member path explained |
| L4 | Deploy note on `WEB_ORIGINS[0]`; spec asserts `parse.canonical` |
| LM1 | CANCELLED Stripe rows count only while their period is running |
| M1 | Checkout refuses ACTIVE (any platform), PAST_DUE Stripe and running CANCELLED Stripe, with distinct codes; 升級方案 hidden when a Stripe row or store membership exists |
| H1 | Consent version is its own constant, bumped only on material AI-disclosure change, pinned by a test; server accepts an allowlist; 1C rules for older builds |

**Round 3 — 1 medium, 4 low.** All accepted.

| # | Disposition |
|---|---|
| L1 | Footer uses plain anchors (route handlers, not pages) — done, with a test |
| L2 | Stale comment fixed; provider check tested behaviourally; sign-in copy test strips comments and checks absence — done |
| L3 | `AI_DATA_DISCLOSURE_ZH` single constant, pinned by a version→hash map; 1C's bundled text must match |
| L4 | `CONTACT_EMAIL` appended to the ALREADY_SUBSCRIBED and PAYMENT_PAST_DUE messages |
| M1 | `GET /users/me` exposes `aiConsentAcceptedVersions`; 1C rules use set membership, no ordering |

---

## Implementation record (2026-11-21)

**Deviations from the design, each deliberate:**

- `stripeSubscriptionOf` (`apps/web/app/lib/api.ts`) tests `!== undefined`, not
  `??` as written above. A post-1B API sends `stripeSubscription: null` on
  purpose while its `activeSubscription` can still be a STALE cancelled Stripe
  row (that query has no period check); `??` would resurrect it into a
  重新啟用 that 404s. The fallback runs only when the key is absent (pre-1B API).
- Pricing page: a PAST_DUE Stripe member (tier FREE) gets 管理訂閱 links instead
  of 立即訂閱; plan CTAs are disabled until the status is known, not only on error.
- Subscription page: PAST_DUE members also see 「上一筆扣款未成功…」.
- The auth footer composes the `cell` type role (the typography ratchet refuses
  a bare `font-size`).

**Audit fix (second line-audit agent, confidence 70).** A member who cancelled
on the website and then subscribed in the app had a CANCELLED-but-running Stripe
row next to an ACTIVE Apple row, and the page offered 重新啟用訂閱 — Stripe would
renew alongside Apple, the double billing the checkout guard blocks.
`reactivateSubscription` now refuses with 409 `ALREADY_SUBSCRIBED` when any
non-Stripe row is ACTIVE (checked before Stripe is touched), and the page hides
the button and shows the store note whenever a store membership is live.

**Verification.** API jest 2899 passed (5 skipped); web jest 470 passed (44/44
suites); api + web tsc clean; root `turbo run lint --force` 5/5, 0 cached.
39/39 mutations caught (middleware entries + widening, proxy fallback, route
config, `@Public` on `/support`, consent version check / `ensureUser` /
withdrawal / both deletion paths, checkout 409 conditions, Stripe-row query,
provider boot check, deploy-skew fallback both ways, every subscription-page
button condition, pricing error state + CTA block + store gate + past-due,
wrong-domain guard, sign-up footer, reactivation guard). Migration applied on a
throwaway database (`migrate deploy` + `status` clean). Production `next build`:
`/privacy`, `/terms`, `/support` are `ƒ (Dynamic)` — not prerendered.
Signed-out `curl` of the three pages: 200, `text/html`, no `<script`; built-in
browser renders them and stays on the URL. The sign-in page could not be viewed
signed-out (that browser holds the owner's dev session); its footer and tagline
were checked in the server-rendered HTML.

**Not done here, owner/next:** the forgot-password link on Clerk's password step
(design item 6) needs a signed-out browser — check in a private window. Two
audit notes below threshold: the share cards still print the wordmark
`BaziApp` beside the corrected domain; and no test yet stores an older accepted
consent version (only one exists).
