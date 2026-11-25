# iOS App Store — setup-to-submission plan

Written 2026-11-13. Status: **v5 — reviewed over 4 rounds (see §9), not started.**
Open owner decisions are in §1b.
Covers everything from an empty App Store Connect account to the moment before
pressing "Submit for Review". Pressing that button is out of scope.

Evidence labels used throughout:

- **[code]** — read in the tree on `main` @ `e2a8cd9`, or in installed packages.
- **[live]** — read from the production Clerk environment endpoint on 2026-11-13.
- **[belief N%]** — knowledge of Apple / Clerk / RevenueCat / Expo / Stripe
  behaviour that was not verified. Check against the live dashboard or current
  docs when the step is reached.

---

## 1. Decisions

### 1a. Made by the owner, 2026-11-13

| # | Decision | Choice |
|---|---|---|
| D1 | Platforms | iOS only. Android stays paused at AND4. |
| D2 | Finish line | TestFlight build verified on the owner's iPhone, a small external beta, and a fully prepared listing. Stop before "Submit for Review". |
| D3 | Backend for test builds | Production (Railway API, production Clerk). Sandbox purchases grant real credits to test accounts in the prod DB — accepted. |
| D4 | Sign in with Apple | Build it. Google sign-in stays on iPhone. |
| D5 | IAP catalog | 3 memberships × monthly + annual, plus 4 credit packs (10 products). |
| D6 | iOS pricing | Same as web, nearest Apple price tier. |
| D7 | Apple account state | Individual enrolment. Nothing set up yet. |
| D8 | Dashboards | Claude drives Chrome, owner approves each create/save. Owner does logins, 2FA, agreements, banking, tax. |
| D9 | Territories | Worldwide, excluding the 27 EU countries and mainland China. |
| D10 | Listing languages | 繁體中文 (primary) + 簡體中文. |
| D11 | Store assets | Icon, splash and screenshots all still to be produced. |
| D12 | External beta | Owner + 1–2 people. |
| D13 | Store name | 天命：八字命理 (home-screen name stays 天命). |
| D14 | Support | New `/support` page; contact = the email already in the published privacy policy. |
| D15 | Annual memberships | Build monthly credit grants for annual plans and monthly/annual product mapping. |
| D16 | Annual in the first submission? (decided after review, was O1) | **No.** The first submission ships 3 monthly memberships + 4 credit packs — 7 of D5's 10 products. Annual is a must-fix that follows it: launch todo #28, design constraints in §6. |

### 1b. Still open — the plan proceeds on the default until the owner says otherwise

| # | Question | Default used in this plan | Why it is the owner's call |
|---|---|---|---|
| O2 | Revoke the Apple sign-in token when an account is deleted? | Documented skip for v1. | Apple's guideline asks for it. With Clerk's native flow nobody holds a token to revoke **[belief 70%]**; it would need a re-authorisation at delete time plus a backend exchange. A reviewer cannot observe it. |
| O3 | Credits on an upgrade | Keep what each provider does today. Apple: an upgrade starts a new paid period at once **[belief 95%]**, so the new tier's full month is granted then (基礎→大師: tier changes immediately, +50). Stripe: nothing until the next invoice. | A pricing policy. Aligning the two needs new proration logic. |
| O4 | Restore purchases onto a different account | RevenueCat "keep with original user": the second account gets nothing and is told why. | The alternative lets one subscription feed credits to many accounts. |
| O5 | Mobile analytics (PostHog) in v1 | Off: leave the key unset. | Removes one scrubber and one privacy-label line; costs usage data for v1. |
| O6 | API hostname baked into the app | Add `api.tianmingapp.com` before the first build. | Otherwise every shipped binary depends on a `*.up.railway.app` name. |
| O7 | 簡體 listing (D10) | Kept. | Doubles listing text, screenshots and product names while mainland China is excluded. |
| O8 | Annual plans on the **website** | Hide them, and refuse month↔year switches in `/payments/upgrade`, before Stripe goes live (§8). | The web sells annual today with the F5 defect. Only test-mode customers are affected so far. |

---

## 2. What the code check found

| # | Finding | Evidence | Consequence if missed |
|---|---|---|---|
| F1 | No Sign in with Apple, but Google sign-in is offered | **[code]** `GoogleSignInButton.tsx:45-48` | Rejection (4.8) |
| F2 | `baziapp.com` — not our domain — in the mobile store links, 4 mobile share cards and 3 web share cards | **[code]** `store.tsx:40-41`; `apps/web/app/components/fortune/Shareable*FortuneCard.tsx` | Reviewer taps Terms and lands on a stranger's site |
| F3 | No public privacy / terms / support page on `tianmingapp.com`, and two layers block one | **[code]** middleware protects every unlisted route; `SignedOutRedirect.tsx:45-70` (mounted in `layout.tsx:87`) redirects signed-out visitors client-side | A middleware-only fix passes a no-JS test and still bounces in a browser |
| F4 | One store product per plan | **[code]** `schema.prisma:341`; only readers are `revenuecat.service.ts:468-486` | Annual Apple products map to nothing |
| F5 | Annual members get one month of credits per year, on Stripe too | **[code]** one grant per paid invoice (`stripe.service.ts:1030-1048`); web sells annual (`pricing/page.tsx:185`); no scheduler, `@nestjs/schedule` not installed | Annual buyer pays for 12 months, receives 1 |
| F6 | No explicit consent before birth data goes to a third-party AI | **[code]** nothing asks. Requirement is 5.1.2(i) **[belief 85%]** | Rejection |
| F7 | Mobile Sentry and PostHog have no PII scrubber | **[code]** `_layout.tsx:29-31`; launch todo #25 | Arms the moment a DSN is set |
| F8 | No OTA update channel | **[code]** `expo-updates` not installed | First binary cannot be patched without a review cycle |
| F9 | Icon has transparency | **[code]** Expo flattens it to white at build (`withIosIcons.js:198-203`), so upload is not rejected | Ships with white where it was transparent. Being redone anyway (D11); the new one must be opaque |
| F10 | `app.json` release settings missing | **[code]** no `usesAppleSignIn`, no export-compliance flag, no `NSPhotoLibraryAddUsageDescription`, `developmentRegion = en`. A privacy manifest is already generated | Export prompt on every build; possible crash on "Save Image"; App Store lists the language as English **[belief 80%]** |
| F11 | Auth screens dead-end; no forgot-password path | **[code]** `sign-in.tsx:41-44`, `sign-up.tsx:65-68`, `GoogleSignInButton.tsx:81-85`. **[live]** no second factor; breached passwords are refused at sign-in | A user with a breached password is locked out of the app |
| F12 | Release env vars exist only as dev values | **[code]** main checkout `.env`: `pk_test`, `test_` keys | Release build talks to localhost with dev Clerk |
| F13 | Sandbox and test-mode purchases are indistinguishable from real ones | **[code]** RevenueCat `environment` declared (`revenuecat.service.ts:44`), never stored; nothing reads Stripe's `livemode`; every Stripe row in production today is test-mode | The books cannot separate them afterwards |
| F14 | A purchase event for an unmapped product or unknown user is acknowledged and lost | **[code]** `revenuecat.service.ts:173-177`, `:446-458` log and return; controller sets the 48h idempotency key and answers 200 (`revenuecat-webhook.controller.ts:66-75`) | A mapping mistake vanishes silently, resend included |
| F15 | A Stripe scheduled cancellation is briefly recorded as terminated | **[code]** `cancelSubscription` writes `CANCELLED` (`stripe.service.ts:317-322`); the following webhook rewrites it to `ACTIVE` + `cancelledAt` (`:806-818`). `CANCELLED` also means Stripe's terminated state (`:1544`) | Transient today. Matters to any future rule that reads `CANCELLED` — belongs to the annual design (§6), not to v1 |
| F16 | Deleted accounts keep `ACTIVE` subscription rows, through **two** doors | **[code]** `deleteAccount` never ends them (`users.service.ts:67-173`); the Clerk `user.deleted` webhook anonymises on its own path and does not either (`clerk-webhook.controller.ts:218-264`). **[live]** Clerk allows self-deletion | Harmless today; with any scheduled grant, anonymised users would be credited monthly |
| F17 | A refunded membership keeps its tier | **[code]** `cancel_reason` is read only for consumables (`:346`) | Refund, keep the benefits until expiry arrives, if it does |
| F18 | `PRODUCT_CHANGE` is treated as a new activation | **[code]** `revenuecat.service.ts:113-118`, resolving `product_id`, which on this event may be the old product **[belief 70%]** | Wrong tier or wrong credits on upgrade. Cannot be settled without a real payload |
| F19 | RevenueCat identity is never cleared | **[code]** `logOutPurchases` (`purchases.ts:67`) is never called | A background-completed purchase can go to the next user |
| F20 | The website cannot show an Apple-bought membership correctly | **[code]** `dashboard/subscription/page.tsx:258-260` compares `"APPLE"`, enum is `APPLE_IAP`; Stripe buttons show for any paid tier and 404 for Apple subs | Broken buttons; a web member can buy again on iPhone unwarned |
| F21 | iOS screens say "Google Play" | **[code]** `store.tsx:236-238`, `me.tsx:92` | Rejection risk (2.3.10) **[belief 70%]** |
| F22 | Store empty state says "coming soon" | **[code]** `store.tsx:173-186` | Placeholder text is a standard rejection (2.1) **[belief 75%]** |
| F23 | In-app copy over-claims; one line is false | **[code]** `index.tsx:44` 「預見你的一生」; `HeroBanner.tsx:51-52` 「精準解命」, 「結合八字與紫微斗數」; `CompatibilityRevealCTA.tsx:37` 「婚變危機預測」; home banner shows admin-uploaded images | Accuracy claims and a deleted feature in front of a reviewer |
| F24 | The published legal text is wrong for the website | **[code]** `legal.controller.ts:69`, `:84`, `:126-127` omit Stripe; `:17` names the app 「天命 BaziApp」 | Moving it to the site as-is publishes false statements |
| F25 | Tier names disagree | **[code]** 基本 / 基礎會員 / 基礎版 across `CreditBadge.tsx`, `store.tsx`, `seed.ts` | Product names are hard to change once reviewed |
| F26 | Restore failures are invisible | **[code]** `restorePurchases` swallows every error (`purchases.ts:120-128`); the screen says 「找不到可恢復的購買」 | Under O4, the "belongs to another account" case reads as "nothing to restore" |
| F27 | The database "active" flag does not control what is on sale | **[code]** both webhook resolvers filter `isActive: true` (`revenuecat.service.ts:472`, `:482`), but the store lists whatever the RevenueCat offering returns (`store.tsx:161-162`) | Once F14 is fixed, a plan deactivated in the admin panel makes its renewals — and any new purchase Apple has already charged — answer 500 for ever |

Already in place, do not rebuild **[code]**: in-app account deletion, restore
purchases, auto-renew disclosure, manage-subscription link, entertainment
disclaimer, RevenueCat webhook + entitlements + consumable clawback with
idempotency, Clerk tokens in secure storage, E2E bypass compiled out, lock
helper with ownership tokens.

Settled from installed packages **[code]**: `@clerk/clerk-expo@2.19.31` exports
a native `useSignInWithApple()` (needs `expo-apple-authentication ~57.0.0`).
`expo-updates` for SDK 57 is `~57.0.6`. `react-native-purchases@10.4.3` exposes
`showManageSubscriptions`, `subscriptionPeriod`, `pricePerMonthString`.

Production Clerk today **[live]**: email + password required, no second
factors, breached-password check on sign-in, bot protection on, native API on,
self-deletion allowed. Apple shows "enabled" with no credentials, so that flag
proves nothing.

---

## 3. Risks that setup does not remove

**R1 — Guideline 4.3(b).** Apple names fortune-telling apps as a category it
rejects unless "unique and high quality". The most likely rejection reason, and
a judgment call. Mitigations: F23 copy pass, review notes, non-template
screenshots. Budget one rejection and an appeal. Beta App Review rarely applies
this rule **[belief 65%]**, so Phase 5 is not a preview of it.

**R2 — Agreements, banking and tax are the critical path.** Sandbox purchases
need the Paid Apps agreement Active. That wait is Apple's.

**R3 — Product IDs are permanent.** Created once, never reusable.

**R4 — The purchase-to-credits hop has never run.** The RevenueCat Test Store
fires no webhooks. F14 is fixed first so that what testing finds is loud.

**R5 — Merging to `main` deploys**, to 2 replicas that each run
`prisma migrate deploy` at boot while the old replica still serves. Every
migration here is additive only.

**R6 — OTA can ship dev config to every user.** `eas update` inlines
`EXPO_PUBLIC_*` from the local environment unless told otherwise
**[belief 85%]**, and the main checkout's `.env` holds localhost and `pk_test`.
See the OTA rule in Phase 3.

---

## 4. Work plan

Legend — **[O]** owner only · **[C]** Claude, code · **[D]** Claude drives the
dashboard, owner approves each save · **[V]** verification with evidence.

### Phase 0 — Day one: owner prerequisites and reservations

| # | Step | Who |
|---|---|---|
| 0.1 | ✅ Accepted 2026-11-21 (row shows Pending User Info) — **Paid Applications** agreement | O |
| 0.2 | Bank account ✅ added 2026-11-21. Tax form ⏳ — waits on the address fix if it pre-fills the wrong address. Legal address ⏳ change requested via Membership details 2026-11-21 (Apple verifies, up to ~2 weeks). Then wait for **Active** | O |
| 0.3 | ✅ Applied 2026-11-21 — App Store Small Business Program (approval pending) | O |
| 0.4 | ✅ Done 2026-11-21. The App ID `com.tianming.app` ("XC com tianming app", created by Xcode during the personal-team device builds) already existed under team `5W93NMYV2B` — the paid individual membership kept the same Team ID, so no new ID was needed. **Sign in with Apple** enabled (primary App ID) and verified; In-App Purchase was already on. Old provisioning profiles are invalidated — EAS regenerates them | D |
| 0.5 | ✅ Done 2026-11-21. App Store Connect record created: name 天命：八字命理, primary language Chinese (Traditional), bundle ID `com.tianming.app`, SKU `tianming-ios` (permanent), Full Access. Status "iOS 1.0 Prepare for Submission" | D |
| 0.6 | App Store Connect API key (EAS) and In-App Purchase key (RevenueCat). Owner downloads the `.p8` files; they go to EAS / RevenueCat only | O + D |
| 0.7 | ✅ Done 2026-11-21. Production Clerk: iOS app registered (Native applications: `5W93NMYV2B` / `com.tianming.app`); `tianming://sso-callback` allowlisted (Clerk also auto-added `com.tianming.app://callback`); Apple connection set to custom credentials — Services ID `com.tianming.app.signin` (Apple side: domain `clerk.tianmingapp.com`, return URL `https://clerk.tianmingapp.com/v1/oauth_callback`), Team ID `5W93NMYV2B`, Key ID `4GDLC4KUW6`, private key pasted by the owner (owner holds the `.p8`); status "Used for sign-in". Private-relay email source `bounces+113126207@clkmail.tianmingapp.com` registered with Apple, SPF green. Facebook and LINE disabled. Verified: Apple's authorize page accepts the Services ID + return URL. **Not yet verified:** a full sign-in round trip (proves the key) — web on a signed-out browser, native in step 3.2 | D |
| 0.8 | ✅ Created 2026-11-21 — two sandbox testers (Malaysia, Taiwan storefronts) | O |
| 0.9 | ✅ Checked 2026-11-22 via the public `GET /api/payments/plans` and `/credit-packages`: prices and credits match §5 exactly (5/15/50 credits at $4.99/$9.99/$19.99; packs 5/12/30/60 at $4.99/$9.99/$19.99/$34.99) | C, V |
| 0.10 | ✅ Tier names fixed 2026-11-21 (owner, option A): **基礎會員 / 專業會員 / 大師會員** everywhere — app, website, App Store product names (F25). **Rolled out 2026-11-22**: web shared constant `app/lib/tier-names.ts` (badge, account panel, pricing, subscription page), mobile `TIER_LABELS` (badge, 我的, store), `seed.ts`, and migration `20261122000100_rename_plan_tiers_to_member` for the production rows (these also name the Stripe checkout product). Guarded by `apps/api/test/tier-names-parity.spec.ts` (5/5 mutations caught). Free tier keeps 免費 / 免費方案 | C, O |
| 0.11 | Re-create the EAS robot token if `EXPO_TOKEN` is gone | O |
| 0.12 | O6: add `api.tianmingapp.com` to the Railway API; re-run the `TRUST_PROXY_HOPS` forged-header check; move the RevenueCat webhook URL | O, C verifies |

### Phase 1 — Code (three PRs; each: design → plan review → build → line audit)

Mobile cannot run from a worktree; 1C is built on a branch in the main checkout.

#### 1A-core — backend changes required for any store purchase

> ✅ **Implemented 2026-11-21, not yet merged** — design + 3 review rounds + line audit in `.claude/plans/1a-core-payment-hardening.md`. API jest 2852 passing (+69), lint 5/5, 41/41 guard mutations caught. Stripe-side deletion hardening split out to launch todo #29. `PRODUCT_CHANGE` (1A-core-b) still waits on real payloads from step 3.3.

Backend only. Merges first. Each behaviour change is mutation-tested. "Who is
entitled" stays exactly as it is today (`status === 'ACTIVE'`); no time-based
rule is introduced here, because nothing in v1 would re-evaluate one.

1. **Product mapping for 7 products** (3 monthly memberships, 4 packs) in the
   existing `appleProductId` columns: a reviewed data migration **and** the
   same IDs in `seed.ts`, so a fresh database matches.
2. **F27:** webhook resolution ignores `isActive` for every event type. By the
   time an event arrives Apple has already charged; what is on sale is
   controlled by the RevenueCat offering, not this flag. A purchase of an
   inactive product raises a Sentry warning — the signal to remove it from the
   offering. The flag is filtered in a **second** place: `grantMonthlyCredits`
   looks the plan up again with `isActive: true` and silently skips the grant
   when it finds nothing (`entitlements.service.ts:166-172`). Drop the filter
   there too, or the renewal resolves, answers 200 and grants nothing. That
   function also serves Stripe renewals, which have this gap today. Test: a
   renewal for an inactive plan still grants.
3. **F14:** the service throws instead of returning, so the controller answers
   500 and (as it already does on a 500, `revenuecat-webhook.controller.ts:66-75`)
   leaves the idempotency key unset. Throw sites: unmapped plan (`:173-177`),
   plan with no tier mapping (`:178-182`), unmapped pack (`:256-260`), and
   `resolveUserId` (`:159`, `:242`, `:302`, `:372`). The non-IAP-store skips
   stay ahead of them. Unknown user: a `deleted_<id>_` row exists → 200 and a
   log line; never seen → 500 + Sentry event. The deleted-user lookup is
   extracted from `common/signup-bonus.ts:147-161` into a helper that
   propagates database errors (the existing function fails open; here an error
   must become a 500).
4. **F13:** additive `environment` column on `Subscription` and `Transaction`,
   written from RevenueCat's `environment` and Stripe's `livemode`.
5. **F17:** a RevenueCat membership refund ends the membership through the
   **existing** expiry path (`handleExpiration`, `:371-394`), not a second one.
   Trigger: `CANCELLATION` with `cancel_reason === 'CUSTOMER_SUPPORT'` only —
   an ordinary turn-off or a billing failure must leave the row `ACTIVE`, or
   the deliberate grace period (`:23-27`, `:132-138`) is lost. Expire only if
   the event's expiry time is not in the future (Apple can refund an old
   renewal while the current period is paid **[belief 60%]**); otherwise raise
   an alert and leave the row. Mutation test: a billing-failure cancellation
   stays `ACTIVE`. The real refund payload has never been observed; row 24 is
   a replay.
6. **F16:** one "end subscriptions for a deleted user" function, called from
   both `deleteAccount` and the Clerk `user.deleted` webhook. Order inside it
   is load-bearing: (a) it runs after the active-store-subscription guard
   (`users.service.ts:82-92`); (b) it cancels at Stripe (`:109-125`) and
   deletes the RevenueCat subscriber (`:288-305`) **first**. The Stripe cancel
   covers every row that has a Stripe subscription ID and is not already
   `EXPIRED` — wider than today's `ACTIVE`-only filter (`:110`), because a
   `PAST_DUE` or scheduled-cancel subscription skipped here would be
   resurrected by Stripe later; the call is best-effort, so an
   already-cancelled one is harmless; (c) only then marks the rows ended — a status
   update, never a delete, because `Subscription` is a retained record. Ending
   rows without cancelling at Stripe is not durable: the next Stripe event
   rewrites the row to `ACTIVE` (`stripe.service.ts:806-818`) and a paid
   invoice credits the anonymised user (`:1044`). A reviewed one-off data fix
   handles accounts already deleted, including any still billing at Stripe.

Deferred to **1A-core-b**, a small backend-only follow-up at step 3.3: F18
(`PRODUCT_CHANGE`). Its behaviour is decided from the real upgrade payloads
captured there, not guessed now. Row 21 is run, or re-run, after it is
deployed; the local build stays valid because nothing in the binary changes.

#### 1B — Web + API: public pages and consent storage

> ✅ **Implemented 2026-11-21, not yet committed** — design + 4 review rounds + two line audits in `.claude/plans/1b-web-public-pages-and-consent.md`. API jest 2899, web jest 470, lint 5/5, 39/39 mutations caught. Before merging: confirm the first `WEB_ORIGINS` entry on the Railway API is `https://tianmingapp.com`.

- `/privacy`, `/terms`, `/support` on `tianmingapp.com` as **route handlers
  returning plain HTML**. They are added to the middleware allowlist (route
  handlers still pass through the middleware), and because they render no app
  layout, `SignedOutRedirect` never mounts (F3). Assert each layer separately:
  a no-JS request, and a signed-out browser test that waits for hydration and
  checks the URL did not change.
- The API keeps serving `/privacy` and `/terms` (the Play listing points
  there). One shared source for the text; mechanism chosen in design, since
  web cannot import from api.
- Text fixes (F24): add Stripe, correct the payment statements, use the store
  name, add Sign in with Apple and the AI consent, and list every AI provider
  that can receive data. The Claude → GPT-4o → Gemini fallback is gated on
  keys being present (`ai.service.ts:351-387`): check which keys production
  has, and list those providers or confirm they are off.
- `/support`: contact email; how to cancel, restore, reset a password, and
  delete an account.
- `User.aiConsentAt` + policy version, and an endpoint to record it.
- `baziapp.com` removed from the 3 web share cards (F2).
- F20, web half: the subscription page compares the right enum and hides
  Stripe-only buttons for store subscriptions. The status endpoint returns
  only the newest subscription (`payments.service.ts:81-87`); it must also
  return the Stripe one, so a user holding both keeps their Stripe cancel
  button.
- The web sign-in page carries 「預見你的一生」
  (`sign-in/[[...sign-in]]/page.tsx:34`); remove it with the app's copy pass,
  since the app now links there. Confirm by opening `/sign-in` logged out that
  Clerk's component shows a forgot-password link on the password step
  **[belief 90%]**.

#### 1C — Mobile

> ✅ **1C-a implemented 2026-11-22, committed `00b9196` (branch `claude/app-store-submission-plan-b3dbe7`, pushed, not merged)**. Simulator-verified; config plugin `with-pod-deployment-target` added for Xcode 27.2 — design + 3 review rounds + line audit in `.claude/plans/1c-mobile-app-store-readiness.md`. 1C-b (icon/splash, Sentry symbolication, RevenueCat "keep with original App User ID", banner content review, real-device Apple/email sign-up/reset) is owner-dependent and listed there.

| Item | Detail |
|---|---|
| Sign in with Apple (F1) | `useSignInWithApple()` + `expo-apple-authentication`. Handles `createdSessionId: null` with the same fallback as Google. The hook sends no name, so give 我的 a sensible display for a relay-email user. O2 for token revocation |
| AI consent (F6) | One-time sheet naming the provider(s), what is sent, link to the policy, explicit 同意. Before agreement: 排盤 works; 日運 uses the existing engine-only path; 月運 / 年運, chat, paid readings and 合盤 reveal show the consent prompt instead of calling AI (`fortune-api.ts:235-283` — month and year have no engine-only path) |
| URLs (F2) | One constants module → `tianmingapp.com`. Privacy / Terms / Support rows in 我的; a notice with links on sign-up |
| Auth dead ends (F11) | A 「忘記密碼？」 link that opens the website's sign-in page, which already has a reset flow. Clear messages for the other dead ends. No native reset flow in v1 |
| Copy pass (F21, F22, F23) | Platform-specific store wording; every non-ready store state reads "could not load — retry" with a retry button; remove accuracy and prediction claims and the ZWDS line |
| Purchases hygiene (F19, F26, F20) | Call `logOutPurchases` on sign-out and account deletion. Restore surfaces "this purchase belongs to another account" instead of swallowing it; if RevenueCat returns an empty result rather than an error **[belief 65% it errors]**, the fallback line is "no purchases on this account — if you bought under another account, sign in to it". Warn a user who already has a web membership before they buy another (`GET /users/me` already returns the platform) |
| Scrubber (F7) | Launch todo #25: scrubber for mobile Sentry, parity test extended, `sendDefaultPii: false`. Lands before any DSN. PostHog stays off (O5) |
| Crash symbolication | Sentry org/project/token as EAS secrets for the production profile. A hidden trigger (long-press the version label, admin accounts only) to prove delivery |
| OTA (F8) | `expo-updates`, `runtimeVersion: { policy: "fingerprint" }`, `production` channel |
| `app.json` (F10) | `usesAppleSignIn`, `usesNonExemptEncryption: false`, the Apple auth plugin, `NSPhotoLibraryAddUsageDescription`, `CFBundleLocalizations` zh-Hant + zh-Hans with a Chinese development region. Verify the generated privacy manifest |
| Store screen | Each membership row: name, period, price per period, credits per month, from the store product. Manage-subscription uses `showManageSubscriptions()` — on the store screen **and** in the account-deletion interstitial (`me.tsx:72-78`), which has its own link to a page that does not list sandbox subscriptions. RevenueCat is configured only when the store screen opens (`store.tsx:81`), so the interstitial must configure it first (lazy import, keeping the purchases module out of the 我的 tab as today), then call, and fall back to the current URL if either step fails |
| Icon + splash (F9, D11) | 2–3 opaque candidates from existing brand art, 1024×1024. Owner picks. Final before the first TestFlight build |
| Rebuild | New native modules → rebuild the dev client on both platforms |

Gate for Phase 1: api + web + mobile jest green, `turbo run lint --force` 5/5,
typography guards green, every new guard seen to fail under mutation.

### Phase 2 — Products and RevenueCat

| # | Step | Who |
|---|---|---|
| 2.1 | Subscription group + the **7** v1 products from §5, 繁體 and 簡體 names and descriptions, a review screenshot each. The 3 annual products are **not** created yet: the system manage-subscriptions sheet may offer every product in the group **[belief 60%]**, and an unmapped one would fail | D |
| 2.2 | Pricing and availability per D9; drop any territory flagged as needing extra documents | D |
| 2.3 | RevenueCat: add the App Store app, upload the IAP key, import products, put all 7 in the default offering | D |
| 2.4 | RevenueCat restore behaviour per O4 | D |
| 2.5 | App Store Server Notifications V2 → RevenueCat, production and sandbox | D |

### Phase 3 — Builds

**OTA rule (R6).** Updates are published only with the EAS production
environment selected, from a clean clone with no local `ios/` or `android/`
folder (they may change the fingerprint **[belief 50%]** — row 17 is the
check), only after the same bundle inspection as 3.6, and each with its own
source-map upload. Never from the main checkout's working `.env`.

| # | Step | Who |
|---|---|---|
| 3.1 | EAS production environment: API + assets host, `pk_live`, `appl_` key, Sentry DSN (after the scrubber). `EXPO_PUBLIC_E2E_BYPASS` unset | C |
| 3.2 | **Local Release-configuration build on the owner's iPhone, against production.** Conditions, all required: (a) paid team active — the existing native project is pinned to the personal team (`project.pbxproj:442`, `:476`); (b) `expo prebuild --clean` first, because `expo run:ios` does not regenerate an existing `ios/` folder and the new entitlement and plist keys would be missing; (c) production values in `.env.production.local`, covering **every** key, since env files merge and anything left only in `.env` leaks in; (d) Metro's transform cache cleared before building (a Release build starts no Metro server; the bundle is made inside the Xcode build); (e) the 3.6 bundle inspection run on this build too — this is the real check. Signed for development with the sandbox tester, so memberships renew every few minutes | C builds, O taps |
| 3.3 | Capture the raw webhook payloads from 3.2 (purchase, renewal, upgrade, downgrade, cancel, expiry). Do 1A-core-b from them. Fix what 3.2 found. Lock everything inside the binary: icon, splash, display name, localisations, native modules | C |
| 3.4 | `eas build -p ios --profile production` → `eas submit` to TestFlight | C |
| 3.5 | Owner installs from TestFlight as an internal tester | O |
| 3.6 | Inspect the built bundle: API host, `pk_live`, `appl_`, no `localhost`, no `baziapp.com`, no bypass | V |

The local build buys as the sandbox tester and TestFlight buys as the owner's
real Apple ID **[belief 75%]**. Use a separate app account for each build, or
one account ends up holding two Apple subscriptions.

### Phase 4 — Verification

The owner taps and screenshots; Claude reads production logs, the RevenueCat
event stream and the database, and records each row pass/fail with evidence.
Build column: **L** = local Release build (3.2), **T** = TestFlight, **S** =
simulator, **replay** = a synthetic RevenueCat webhook sent with the
production webhook secret, which the owner supplies at run time and which is
never stored in the repo or a transcript.

**Accounts and entry**

| # | Case | Build |
|---|---|---|
| 1 | Email sign-up (first native contact with production Clerk; bot protection is on), sign-out, sign-in | T |
| 2 | Google sign-in, new and existing | T |
| 3 | Sign in with Apple: new, existing, Hide My Email; a Clerk email sent to the relay address arrives | T |
| 4 | Forgot-password link reaches the web reset; demo account signs in on a **different** device or simulator (Clerk's token is in the Keychain and survives deleting the app) | T + S |
| 5 | Consent: no `AI-CALL` log line before agreeing, on any surface; shown once; survives reinstall | T |
| 6 | Sign out as A, sign in as B, buy: credited to B | L |
| 7 | Terms / Privacy / Support links open, in app and logged out in a browser | T |

**Core features against production**

| # | Case | Build |
|---|---|---|
| 8 | Birth profile create/edit incl. 時辰未知; first profile is primary | T |
| 9 | 排盤 and element explanations | T |
| 10 | 日運 / 月運 / 年運 streaming and pickers | T |
| 11 | One paid reading per type; `?id=` reopen; cached re-open not charged | T |
| 12 | Chat on a reading and on fortune | T |
| 13 | 合盤 create and reveal | T |
| 14 | Share image incl. "Save Image" | T |
| 15 | 簡體 toggle; largest Dynamic Type; device language English; background mid-stream; first launch offline | T |
| 16 | Smallest supported iPhone and iPad compatibility mode (review is often on an iPad) | S |
| 17 | An OTA update published under the OTA rule reaches the TestFlight build | T |

**Purchases — expected results**

| # | Case | Expected | Build |
|---|---|---|---|
| 18 | Each credit pack | Balance +N; one ledger row; one transaction marked sandbox; redelivery changes nothing | L, one on T |
| 19 | Each monthly membership | Subscription row marked sandbox; tier set; that tier's monthly credits once | L, one on T |
| 20 | Renewal | Each renewal grants exactly one month, once. Several in an hour is correct in sandbox | L |
| 21 | Upgrade 基礎→大師; downgrade 大師→基礎 | Upgrade: tier 大師 at once, +50 once (O3). Downgrade: tier unchanged until the next renewal, then 基礎 and +5 | L |
| 22 | Cancel → expiry | Tier continues to the paid-through time with no new grant, then drops to free | L |
| 23 | Pack refund | Clawback | replay |
| 24 | Membership refund; and a billing-failure cancellation | Refund: row `EXPIRED`, tier recomputed. Billing failure: row stays `ACTIVE` | replay |
| 25 | Restore after reinstall, same account | Entitlement returns, no new credits | L |
| 26 | Restore on a second account, same Apple ID | Nothing granted; "belongs to another account" message, or the fallback line (O4, F26) | L |
| 27 | Web member opens the iPhone store | Warned before buying | L |
| 28 | iPhone membership seen on the web | Correct tier, no Stripe buttons | T + web |
| 29 | Offering fails to load | Retry state, no placeholder copy | L |
| 30 | Unmapped product (a spare ID) | 500 and a Sentry event; the same payload succeeds once mapped | replay |
| 31 | Never-seen user ID / deleted user ID | 500 + Sentry event / 200 + log line | replay |

Covered by jest rather than on device, because it cannot be produced on
demand: the webhook arriving later than the store's 30-second poll.

TestFlight memberships renew about once a day and ignore the sandbox tester
**[belief 75%]**, which is why the timing rows run on the local build.

**Account deletion**

| # | Case | Build |
|---|---|---|
| 32 | Delete with an active store subscription: interstitial, deletes, subscription rows ended | L |
| 33 | Delete a plain account: personal data gone, purchase records kept as documented | T |
| 34 | Delete an Apple-sign-in account, then sign up again with the same Apple ID | T |
| 35 | Delete a throwaway user in the Clerk dashboard (the real webhook path; Clerk webhooks are signature-verified and cannot be replayed without the signing secret): subscription rows ended, RevenueCat subscriber removed, and a test-mode Stripe subscription cancelled at Stripe | Clerk dashboard |

**Observability**

| # | Case | Build |
|---|---|---|
| 36 | Hidden trigger reaches Sentry, symbolicated, with no chart data | T |
| 37 | `GET /api/admin/ops`: spend as expected, no unexplained `AI-CALL` errors | — |

Exit: every row passes or has a written, owner-accepted exception. JS-only
fixes may go out by OTA during testing. Before step 6.11 one **final build** is
cut from a commit with every fix embedded, and rows 1–3, 7, 11, 18, 19 and 36
are re-run on it.

### Phase 5 — External beta (D12)

| # | Step | Who |
|---|---|---|
| 5.1 | TestFlight test information: what to test, contact, demo account | D |
| 5.2 | External group, 1–2 testers, submit for Beta App Review | D, owner approves |
| 5.3 | Testers run rows 1, 8–13 and one sandbox purchase | O |
| 5.4 | Triage; fix what blocks | C |

Adding the same people as internal testers needs no beta review and gives the
same coverage. D2/D12 stand unless the owner changes them.

### Phase 6 — Listing and review package

| # | Item | Who |
|---|---|---|
| 6.1 | Screenshots: 6.9" iPhone, 繁體 and 簡體, 6–8 each, from the final UI. Confirm required sizes on the upload page | C, owner approves |
| 6.2 | Name, subtitle, promo text, description, keywords in both languages. No accuracy or prediction claims; includes the entertainment disclaimer. 🟡 **Draft 1 written 2026-11-22: `app-store-listing.md`** (also covers 6.3 and 6.6) — awaiting owner approval | C drafts, owner approves |
| 6.3 | Category: Lifestyle primary, Entertainment secondary | D |
| 6.4 | Age rating questionnaire, including the AI-chat questions | D, owner confirms |
| 6.5 | App Privacy labels from `docs/security/data-inventory-and-retention.md`. Birth date/time/place is "Other User Content", not Apple's "Sensitive Info" list **[belief 75%]** — decide deliberately. No tracking, no ATT | D, owner confirms |
| 6.6 | Privacy, Support and Terms URLs on `tianmingapp.com` | D |
| 6.7 | Attach the 7 in-app purchases to the version. Annual is not part of this submission (D16) | D |
| 6.8 | Audit the live home-screen banners for web-only promotions or claims | C, owner |
| 6.9 | Demo account: strong unique password, a birth profile, credits added through the ledgered admin path, no membership, consent state stated in the notes. A script re-creates it, because a reviewer testing deletion will delete it | C |
| 6.10 | Review notes: sign-in, where the store is, AI provider and consent, why an account is required (readings and credits are saved per account), and the 4.3(b) case | C drafts, owner approves |
| 6.11 | Select the final build, set **manual release** | D |

### Phase 7 — Pre-submission gate, then stop

- [ ] Full Phase 4 matrix green on builds of the final commit's lineage; the
      listed subset re-run on the final build itself
- [ ] External beta done, no open blocker
- [ ] Paid Apps agreement, banking, tax: Active
- [ ] Products "Ready to Submit" and attached
- [ ] Privacy / Terms / Support open in a logged-out browser
- [ ] Demo account signs in on a different device; re-creation script tested
- [ ] Production: `ops.mjs` NOT ARMED, spend cap sized for launch (todo #7), Sentry alert rules exist for all three spend events
- [ ] `CLAUDE.md` App Store section rewritten to the new state

Then stop. **Submitting is the owner's call and is not part of this plan.**

---

## 5. Product catalog

Subscription group: 天命會員. Levels, highest first: 大師 → 專業 → 基礎 (names
pending 0.10). Values are from `seed.ts`; confirm against production in 0.9
before any ID is created.

| Product ID | Type | Grants | US price | Created |
|---|---|---|---|---|
| `com.tianming.app.master.monthly` | Auto-renew, 1 month | 大師, 50 credits/month | $19.99 | Phase 2 |
| `com.tianming.app.pro.monthly` | Auto-renew, 1 month | 專業, 15 credits/month | $9.99 | Phase 2 |
| `com.tianming.app.basic.monthly` | Auto-renew, 1 month | 基礎, 5 credits/month | $4.99 | Phase 2 |
| `com.tianming.app.credits.5` | Consumable | 5 credits | $4.99 | Phase 2 |
| `com.tianming.app.credits.12` | Consumable | 12 credits | $9.99 | Phase 2 |
| `com.tianming.app.credits.30` | Consumable | 30 credits | $19.99 | Phase 2 |
| `com.tianming.app.credits.60` | Consumable | 60 credits | $34.99 | Phase 2 |
| `com.tianming.app.master.annual` | Auto-renew, 1 year | 大師, 50 credits/month | $159.99 | only after §6 |
| `com.tianming.app.pro.annual` | Auto-renew, 1 year | 專業, 15 credits/month | $79.99 | only after §6 |
| `com.tianming.app.basic.annual` | Auto-renew, 1 year | 基礎, 5 credits/month | $39.99 | only after §6 |

---

## 6. Annual memberships — after the first submission (D16, launch todo #28)

Not part of the first submission, but a must-fix: the owner needs the annual
plan, and the website already sells one that delivers a twelfth of its
credits. Its design document is written after step 3.3, when real payloads
exist, and goes through its own plan-review loop. Adding annual
later needs no new binary: the store screen is offering-driven, and new
products in an existing group can be submitted without a new app version once
the first are approved **[belief 80%]**.

**Why the obvious design is wrong.** Granting from the stored subscription
row, keyed on the existing `@@unique([userId, periodStart])`, mints credits
whenever that row moves: a transfer to another user
(`revenuecat.service.ts:402-435`), a governing-subscription switch, any event
that rewrites `currentPeriodStart` (`:185`, `:193-203`;
`stripe.service.ts:797-816`), a month↔year switch through `/payments/upgrade`
(which bypasses the deny list in `handleInvoicePaid`), and a back-fill on
deploy day.

**Constraints the design must satisfy:**

1. **One grant function for every path.** The paid event calls it with month
   index 0; the sweep calls it for later months. Two code paths would grant
   month 0 twice.
2. Keyed on the subscription: `(subscriptionId, paidPeriodStart, monthIndex)`.
   Each month's row stores its **own** window start, so it cannot collide with
   month 0 on the old user-level key.
3. The existing duplicate handler treats any unique violation as "already
   granted" (`entitlements.service.ts:207-214`). With two unique keys it must
   check which constraint fired.
4. `paidPeriodStart` lives in new columns written only by paid-event handlers
   (`INITIAL_PURCHASE`, `RENEWAL`, Stripe `subscription_create` /
   `subscription_cycle`). RevenueCat routes four event types through one
   handler (`:113-118`), so it must branch on type.
5. Month↔year switches are refused in `/payments/upgrade` until designed: that
   invoice is a `subscription_update`, which constraint 4 does not treat as a
   paid event, so the new annual period would get no anchor.
6. Current month only; no back-fill; an explicit "not before" date at rollout.
   A count guard: grants per paid period never exceed elapsed months.
7. Entitlement for the sweep is defined here, including the paid-through rule
   and the two meanings of `CANCELLED` (F15), the billing-issue grace period
   that deliberately leaves rows `ACTIVE` past expiry
   (`revenuecat.service.ts:23-27`), and the fact that a tier change moves chat
   quota and refunds chat extensions (`chat-payment.service.ts:340-358`). A
   scheduled cancellation does not stop grants; refund and expiry do. Before
   any time-based rule ships, count production rows that are `ACTIVE` with a
   past period end.
8. A governing switch may produce one extra month. State that as accepted, or
   add a per-user floor.
9. Trigger: an hourly sweep (`@nestjs/schedule`, new dependency) under
   `redis.acquireLock` with a registered prefix, plus webhook events. Not on
   `GET /users/me`.
10. A sweep heartbeat in `GET /api/admin/ops` with an alert when it stops, and
    a ledgered make-good path. A dead sweep is paid-but-undelivered.
11. Product mapping: an additive table `(planId, store, billingCycle,
    productId unique)`, back-filled from the columns in the same migration.
    New code reads only the table; the columns are dropped a release later.
12. `nextResetDate` reports the next monthly grant, not the period end.
13. Mutation tests for transfer, governing switch, interval switch, anchor
    shift, deleted user and refund.
14. `CLAUDE.md` § B3-b says the API has no scheduled callers; update it.

---

## 7. Order and dependencies

```
Day 1 ─ Phase 0 (agreements; App ID, app record, Clerk Apple, sandbox tester)
      ├ 1A-core ──────────────┐
      ├ 1B ───────────────────┤
      └ 1C (needs 0.4, 0.7) ──┤
                              ▼
        Phase 2 (7 products, RevenueCat) ── needs 0.1/0.2 Active
                              ▼
        3.2 local Release build ─ 3.3 payloads → 1A-core-b, fixes, lock binary
                              ▼                         │
        3.4 TestFlight build                            └─► §6 annual design
                              ▼                               (not in this
        Phase 4 ─► Phase 5 ∥ Phase 6 ─► final build            submission;
                              ▼                                 todo #28)
                         Phase 7 ─ STOP
```

---

## 8. Before public release (outside this plan; recorded so it is not lost)

- **Stripe is in test mode on the live site** (launch todo #4). Until it is
  live or web purchasing is off, anyone can buy credits on the web with a test
  card. A condition for pressing manual release.
- **Before Stripe goes live:** hide annual plans on the web and refuse
  month↔year switches (O8), unless §6 has shipped; back-fill the `environment`
  column so existing test-mode rows are marked.
- **Sandbox purchases in production (F13).** App Review uses sandbox on every
  future update, so this cannot simply be switched off. The long-term rule is
  an allowlist or cap on sandbox grants, using the `environment` column.
  Spend is bounded meanwhile by the 20-readings-per-day quota and the daily cap.
- Stripe refund and dispute events are not handled.
- EU availability. Android resumes at AND4.

---

## 9. Review log

**Round 1 — 35 issues, not approved.** 33 accepted, 2 partly.

| Issue | Disposition |
|---|---|
| 1, 2, 7 | F9, F10 corrected; export-compliance step removed; localisations added |
| 3 | Clerk "enabled" check replaced by real sign-ins |
| 4 | F11 rewritten; strong demo password |
| 5, 6 | Steps 0.9, 0.10 |
| 8 | Symbolication + hidden trigger; row 36 |
| 9 | F19; row 6 |
| 10 | Step 0.4 |
| 11 | 6.5 reworded |
| 12 | Partly: noted in R1 and Phase 5; D2/D12 unchanged (owner's decision) |
| 13, 14, 15 | F21–F23, copy pass, 6.8 |
| 16, 17 | F24, F2 widened, 1B |
| 18 | F20; rows 27–28 |
| 19 | Per-surface consent behaviour; row 5 |
| 20 | 1C; revocation raised as O2 |
| 21 | R6, OTA rule, row 17, final-build rule |
| 22, 23 | Phase 4 rebuilt with builds, expected values and missing rows |
| 24 | F13, `environment` column, §8 |
| 25 | F14; rows 30–31 |
| 26 | F18, O3 |
| 27 | 6.9 |
| 28 | Phase 0 pulled forward; 3.2 local build; binary locked at 3.3; R5 |
| 29 | §8 release condition |
| 30 | Partly: justified in review notes; no guest mode built |
| 31 | §6 constraint 9 |
| 32 | Annual made a separate track; O1, O5, O7 raised |
| 33 | F3, 1B route handlers, two-layer assertion |
| 34 | F16, F17 in 1A-core; the rest moved to §6 (see round 2 #19) |
| 35 | §6 |

**Round 2 — 19 issues, not approved.** 19 accepted.

| Issue | Disposition |
|---|---|
| 1 | Phase 7 wording; step reference fixed |
| 2 | 1B reasoning corrected |
| 3 | Rows 22, 30 reworded; slow-webhook case moved to jest |
| 4 | Mobile items moved to 1C, web item to 1B; 1A-core is backend only |
| 5 | Seed carries the IDs; F27; §6 constraint 11 |
| 6 | OTA rule: source maps, clean clone |
| 7 | Gate replaced by the 6.7 deadline; "quiet in production" dropped |
| 8 | `environment` written for Stripe too; back-fill in §8 |
| 9 | Unknown user split: known-deleted 200, never-seen 500 |
| 10 | O3 restated per provider with numbers; F18 deferred to 1A-core-b after real payloads |
| 11 | F26; 1C; row 26 |
| 12 | Step 0.7 private relay; row 3 |
| 13 | Annual products not created in Phase 2 |
| 14 | 3.2 conditions (a)–(e); row 4 uses a different device; separate accounts per build |
| 15 | O8, §8 |
| 16 | Annual off the critical path (O1 default "expect 1.1"); native forgot-password cut for a link to the web reset |
| 17 | §6 constraints 1–5, 8, 10 |
| 18 | F16 widened to both doors; one-off data fix; row 35; §8 for the Stripe/RevenueCat half |
| 19 | `isEntitled` removed from 1A-core; entitlement unchanged in v1; F15 corrected; time-based rules moved to §6 constraint 7 |

**Round 3 — 9 issues (6 low, 3 medium), none high.** 9 accepted. The reviewer
said the plan is ready once these are folded in.

| Issue | Disposition |
|---|---|
| 1 | Step 3.2(d) reworded |
| 2 | Row 35 uses the Clerk dashboard; "replay" defined with the secret-handling rule |
| 3 | Deletion interstitial link also uses `showManageSubscriptions()` |
| 4 | 1B: status endpoint also returns the Stripe subscription |
| 5 | 1B copy fix on the web sign-in page; Facebook/LINE moved from §8 to step 0.7 |
| 6 | Fallback line for row 26 |
| 7 | 1A-core item 2: resolution ignores `isActive` for every event; F27 restated |
| 8 | 1A-core item 5: single cancel reason, expiry-time check, reuse of the expiry path, mutation test; row 24 widened |
| 9 | 1A-core item 6: cancel at providers first, then end rows, after the guard; §8 item removed; row 35 widened |

**Round 4 — confirmation. 3 issues (2 low, 1 medium).** 3 accepted. The
reviewer confirmed all round-3 fixes and said the plan is ready once these
three are fixed in place, without a further pass. They were applied after that
statement and have not themselves been re-read by the reviewer.

| Issue | Disposition |
|---|---|
| 1 | 1C: interstitial configures RevenueCat first, with a URL fallback |
| 2 | 1A-core item 6(b): Stripe cancel covers every non-expired row with a Stripe ID |
| 3 | 1A-core item 2: `isActive` filter also dropped in `grantMonthlyCredits`, with a test |
