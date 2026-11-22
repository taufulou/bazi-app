# 1C — Mobile app: App Store readiness

Design for Phase 1 track **1C** of `.claude/plans/app-store-ios-submission-plan.md`
(§4 Phase 1; findings F1, F2, F6, F7, F8, F10, F11, F19, F20, F21, F22, F23, F26;
open defaults O2, O4, O5). Written 2026-11-21. Status: **APPROVED after 3 review rounds; 1C-a IMPLEMENTED 2026-11-22, not
committed.** See "Implementation record" at the end.

Touches `apps/mobile`, one test in `apps/api` (scrubber parity + disclosure pin),
and `.github/workflows/ci.yml` (a mobile job). Builds on 1B (`14223de`): the legal
pages live at `tianmingapp.com/{privacy,terms,support}`; `POST/DELETE
/api/users/me/ai-consent` and the consent fields on `GET /api/users/me` exist;
`GET /api/payments/subscription` returns `stripeSubscription`.

**Split.** 1C-a is code finished and verified here. 1C-b needs the owner (art,
credentials, dashboard settings, a real device) and is listed at the end.

---

## Facts this design relies on (verified in the installed packages / live)

- `@clerk/clerk-expo` 2.19.31 has `useSignInWithApple()` (`dist/hooks/useSignInWithApple.ios.js`),
  but it discards Apple's name (given only on the FIRST authorisation) and returns
  `createdSessionId: null` for four different reasons. **We write the flow
  ourselves** (item 1) using the same primitives it uses.
- `expo-crypto` is installed; `expo-apple-authentication` and `expo-updates` are
  not (both native → dev-client rebuild on both platforms, gotcha #1).
- `react-native-purchases` 10.4.3: `Purchases.showManageSubscriptions()` (iOS 13+);
  error codes `"7"` RECEIPT_ALREADY_IN_USE and `"13"` RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER.
- `GET /api/users/me` returns the whole `User` row + `aiConsentCurrentVersion` +
  `aiConsentAcceptedVersions`, and **404s when no row exists yet**
  (`users.service.ts:51-53`) — e.g. a brand-new user before Clerk's webhook lands.
- Live Clerk instance: `enforce_hibp_on_sign_in: true` (breached passwords are
  refused at sign-in), `captcha_enabled: true` on sign-up.
- **iOS presents a RN `Modal` from the nearest view controller, and UIKit will not
  present from one that is already presenting** (`RCTModalHostViewComponentView.mm:154-155`).
  So a consent sheet must never open while another Modal is up. This shapes item 2.
- **CI does not run mobile tests today** (`.github/workflows/ci.yml`). Item 10 adds them.
- Mobile jest and tsc run from the worktree (81 tests, tsc clean today); Metro and
  the simulator do not (gotcha #7).

---

## Item 1 — Sign in with Apple (F1)

Guideline 4.8: an app offering Google sign-in must offer Sign in with Apple.

- New `src/components/AppleSignInButton.tsx`, rendered on iOS only, immediately
  (no layout jump waiting for `isAvailableAsync`; that check runs on press and a
  `false` shows 「此裝置不支援 Apple 登入」). Apple's own `AppleAuthenticationButton`
  (HIG): style BLACK, type SIGN_IN / SIGN_UP, `radius.md` corners, height 50.
  Placed **above** the Google button on sign-in and sign-up.
- Flow written directly (≈40 lines, `src/lib/apple-sign-in.ts`, pure enough to
  unit-test with mocked Clerk resources):
  1. `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce })`
     with `nonce = Crypto.randomUUID()`.
     `ERR_REQUEST_CANCELED` → return `{ kind: 'cancelled' }` (no alert).
  2. No `identityToken` → `{ kind: 'error' }`.
  3. `signIn.create({ strategy: 'oauth_token_apple', token })`.
     `status === 'complete'` → `{ kind: 'session', id: signIn.createdSessionId }`.
  4. `signIn.firstFactorVerification.status === 'transferable'` (new user) →
     `signUp.create({ transfer: true, firstName, lastName })` with the name from
     the Apple credential, so it is stored the one time Apple gives it.
     `complete` → session; `missing_requirements` → `{ kind: 'incomplete' }`.
  5. Any other status → `{ kind: 'incomplete', status }`.
  Results map to: session → `setActive` → home; cancelled → nothing; incomplete →
  「無法完成 Apple 登入，請改用電子郵件登入，或聯絡客服。」; error → 「Apple 登入失敗」
  + Clerk's message. The function reads statuses from the objects returned by
  THIS call, never from state left by an earlier attempt.
- 我的 display: `src/lib/account-display.ts` — name `firstName || 會員`; an email
  ending `@privaterelay.appleid.com` shows 「已隱藏的 Apple 電子郵件」.
- `app.json`: `ios.usesAppleSignIn: true`, plugin `expo-apple-authentication`.
- **O2** (revoke the Apple token on deletion): documented skip for v1 — the app
  never holds a refresh token to revoke.

## Item 2 — AI consent (F6)

Guideline 5.1.2(i): ask before personal data goes to a third-party AI.

### Two layers

**Layer 1 — enforcement, in `src/lib` (no UI).** `src/lib/ai-consent-state.ts`
holds a module-level status (`'unknown' | 'granted' | 'missing' | 'outdated'`)
plus `assertAiConsent()`, which throws `AiConsentRequiredError` unless `granted`.
Every AI-calling or AI-charging function calls it first:
`streamDailyFortune`, `streamMonthlyFortune`, `streamYearlyFortune`,
`fetchDailyFortune` (unless `engineOnly`), `fetchMonthlyFortune`,
`createBaziReading`, `regenerateBaziReading`, `streamBaziReading`,
`generateCompatibilityAI`, `streamCompatibilityReading`, `createChatSession`,
`streamChatMessage`, `extendSession`. No ordering mistake in a screen can then
reach the AI or a charge — the request is never sent.

**Refusal contract** (so a refusal never becomes a stuck screen):
- Promise-returning functions reject with `AiConsentRequiredError`.
- Callback-style stream functions (`stream*Fortune`, `streamBaziReading`,
  `streamCompatibilityReading`, `streamChatMessage`) never throw: they call
  `onError` then `onClose` on a microtask and return a no-op teardown — the same
  path a network failure takes, which every caller already handles.
- The error's `message` is user-facing Chinese (「請先同意 AI 解讀資料說明」),
  because several callers display `err.message`.
- `ai-consent-state.ts` has **no React Native or Expo imports**, so the API test
  suite can `require` it (see "Pinning the disclosure").
- Tests: per guarded function, no request is sent, no unhandled rejection, and the
  calling hook leaves its loading state (`useFortuneNarrativeStream`'s `streaming`
  returns to false; `useChatStream` drops its optimistic message).

**Layer 2 — the sheet, at the user's tap.** `src/lib/ai-consent.tsx`:
`AiConsentProvider` (inside `ClerkLoaded`) owns the status, keeps layer 1's
module status in sync, and renders the sheet. `useAiConsent()` returns
`{ status, requireAiConsent, withdraw, refresh }`.

`requireAiConsent(): Promise<boolean>` is called **only from a tap handler with no
Modal on screen**, before that tap opens anything.

**Resolution timing (iOS).** UIKit also refuses to present while a dismissal is
still animating. So `requireAiConsent` resolves — and any follow-up `Alert`
(outdated, save failed) is raised — from the consent Modal's **`onDismiss`**
(iOS), not from the button handler. On Android (`onDismiss` is iOS-only) it
resolves after the Modal's `visible` turns false. A jest test asserts the promise
is still pending after 同意 until `onDismiss` fires.

**Status write order.** On a successful POST the provider writes layer 1's module
status to `granted` **synchronously, before resolving**; withdraw and user change
write it before updating React state. A test calls a layer-1 function on the line
after `await requireAiConsent()` and expects it to go through.

| Surface | Before consent | Gate placed (tap, before any Modal) |
|---|---|---|
| 排盤, profiles, home score cards | unchanged (engine only) | none |
| 日運 tab | engine-only fetch: score, dimensions, folk content; narrative area shows a 「開啟 AI 解讀」 card | the card |
| 月運 / 年運 tabs | no stream; a card explains AI is needed (no engine-only path exists) | the card |
| Paid readings | chart preview works | `onUnlock` → `requireAiConsent()` → only then `setShowUnlock(true)`; same before regenerate |
| 合盤 | creation is engine-only (`skipAI: true`) | top of `handleReveal`, before its first state write (`compat.tsx:191-199`); both entry points (`:487`, `:506`) go through it |
| AI chat | — | every press that opens the chat sheet (the FAB and each `InlineAskCard` press on readings, compat and fortune), before the sheet's `visible` flips |

Inside code that runs while a Modal is up (`startReading` under
`UnlockConfirmModal`, `useChatSession` under `ChatSheet`), there is **no sheet** —
only layer 1, plus a non-presenting check that shows an inline message if status
is somehow not `granted`.

### Status rules

- Loaded from `GET /api/users/me` when a user is signed in. Each load carries the
  `userId` it was started for and is dropped if the signed-in user has changed
  since (no cross-user write).
- **404 → `missing`** (no row yet; `POST` uses `ensureUser`, so consenting works).
- `AI_CONSENT_VERSION` not in `aiConsentAcceptedVersions` → `'outdated'`: the sheet
  is never shown; the gate alerts 「請更新 App 後再使用 AI 解讀。」 at once.
- Granted iff the server's `aiConsentVersion` ∈ `aiConsentAcceptedVersions` (set
  membership, as 1B specifies).
- Refreshed when the app returns to the foreground (`AppState` → `active`), so a
  withdrawal on another device takes effect without relaunch. The previous status
  is **kept** while the refresh runs; only a real transition is written (e.g.
  granted → missing, which turns the fortune tabs' streams off). A refresh never
  passes through `unknown`, so switching apps never cancels and reopens a stream.
- Reset to `unknown` when `userId` changes or becomes null.
- `unknown` on a tap: retry the load once; still unknown → 「暫時無法確認您的設定，
  請稍後再試。」 and `false` (fail closed).
- `unknown` on the auto-starting fortune tabs: show the existing loading state —
  neither start the stream nor fall back to engine-only until status resolves.
- A load that fails (offline, 5xx) sets a distinct `error` status. The fortune
  tabs then show their error state with 重試, which re-runs the consent load —
  so `unknown` always has an exit. Taps treat `error` like `unknown` (retry once,
  then the 暫時無法確認 message).

### The sheet

Title 「AI 解讀資料說明」; body `AI_DATA_DISCLOSURE_ZH` (rendered through `zh()`
like all app text, so Simplified readers see the converted text — the consent is
to the same content; the hash pins the Traditional source); a 「隱私權政策」 link
(in-app browser); buttons 「同意並繼續」 / 「暫不使用」. Concurrent callers share
one pending promise. 同意 → `POST { version: AI_CONSENT_VERSION }`: 2xx → granted;
409 `CONSENT_VERSION_UNKNOWN` → outdated + update alert; other → 「無法儲存您的同意，
請稍後再試。」. All three resolve `false` except success.

我的 gains a row 「AI 解讀資料使用」 (已同意 / 未同意). Granted → confirm → `DELETE`
→ missing. Missing → opens the sheet.

### Pinning the disclosure

`AI_CONSENT_VERSION` and `AI_DATA_DISCLOSURE_ZH` in `ai-consent-state.ts` are a
byte copy of `apps/api/src/legal/legal-constants.ts`. The pin lives in
**`apps/api/test/ai-disclosure-mobile-parity.spec.ts`** (runs in CI today): it
`require`s the mobile module through ts-jest (as `sentry-scrub-parity.spec.ts`
does with web — possible because the module has no RN imports) and asserts the
version matches and sha256(mobile text) equals `AI_CONSENT_DISCLOSURE_SHA256[version]`.

### UX ratchet

`src/lib/__tests__/ai-consent-guard.test.ts`: every file outside `src/lib` that
imports a layer-1 function or `useFortuneNarrativeStream`, or renders `ChatSheet`
or `UnlockConfirmModal`, must reference `requireAiConsent`. A ratchet for the
tap-side UX only — layer 1 is the enforcement.

**Not enforced server-side.** The web asks no consent and must keep working, so
the API does not refuse AI calls without a consent row. Recorded limit.

## Item 3 — URLs (F2)

- `src/lib/links.ts`: `SITE_URL = 'https://tianmingapp.com'`, `PRIVACY_URL`,
  `TERMS_URL`, `SUPPORT_EMAIL` (`TAPPER.FUN@gmail.com`, parity-tested against the
  API constant in the same API spec as the disclosure).
- Replace the wrong domain in `store.tsx` and the four mobile share cards.
- Wrong-domain guard `src/lib/__tests__/site-domain.test.ts` (needle assembled at
  runtime).
- 我的 gains 「隱私權政策」 and 「服務條款」 (in-app browser) and 「聯絡客服」
  (`mailto:`). The support **page** is not opened in-app: it links to the website's
  subscription page, which sells memberships (guideline 3.1.1 anti-steering).
  The support URL still goes into App Store Connect, which is where Apple asks for it.
  **Recorded residual risk:** the privacy and terms pages carry a nav bar that
  links to `/support`, so the support page is reachable two taps deep from the
  app. Accepted for v1: that page links to account management and sign-in, not to
  a checkout directly — the website's subscription page it links to does offer
  「購買點數」 and 「升級方案」, so a checkout is about four taps plus a sign-in away.
  Low risk, and it is the same page Apple's reviewers open from the listing.
  If review objects, the fix is an `?app=1` render without the nav.
- Sign-up: 「註冊即表示您同意《服務條款》及《隱私權政策》」 with both linked.

## Item 4 — Auth dead ends (F11)

Native password reset — no website hand-off (the website sells memberships; a
browser sign-in from the app is also a 4.0 concern).

- New screen `src/app/reset-password.tsx` (modal, from 「忘記密碼？」 under the
  password field on sign-in):
  1. email → `signIn.create({ strategy: 'reset_password_email_code', identifier })`;
  2. code + new password → `signIn.attemptFirstFactor({ strategy:
     'reset_password_email_code', code, password })`;
  Errors: `strategy_for_user_invalid` (an Apple/Google-only account has no
  password) → 「此帳號使用 Apple／Google 登入，請直接使用該方式登入。」.
  A `reset-password` `Stack.Screen` with `presentation: 'modal'` is added to
  `_layout.tsx`.
  3. `needs_new_password` → `signIn.resetPassword({ password })` (the attempt's
     `password` field is optional in Clerk's types, so either path can occur).
     `complete` → `setActive` → home. Any other status (e.g. `needs_second_factor`)
     → 「無法完成重設，請聯絡客服」 with the support email.
  Errors show Clerk's message (e.g. a breached new password is refused by Clerk).
- Clerk `form_password_pwned` on sign-in → 「此密碼曾出現在外洩資料中，為了安全
  請重設密碼。」 with a 「重設密碼」 button to the new screen, email prefilled.
- The two 「改用網頁版」 dead-end alerts (sign-in non-complete, sign-up
  non-complete) are reworded to point at 客服 (support email) instead of the
  website.
- `GoogleSignInButton`'s stale "phone required" comment corrected; its "改用網頁版"
  fallback alert reworded the same way.

## Item 5 — Copy pass (F21, F22, F23)

| Where | Now | Change |
|---|---|---|
| `store.tsx` compliance line | 「…App Store／Google Play 帳戶設定…」 | platform-specific: iOS 「Apple ID 帳戶設定」, Android 「Google Play 帳戶設定」 |
| `me.tsx` deletion alert | 「App Store／Google Play」 | platform-specific store name |
| `store.tsx` unsupported / empty / error | 「商店即將推出」 / 「敬請期待」 | all three: 「目前無法載入商店項目」 + 「請檢查網路連線後重試。」 + 重試 |
| `index.tsx` tagline | 「預見你的一生」 | 「八字命理・AI 解讀」 |
| `index.tsx` feature | 「流年運勢預測」 | 「流年運勢分析」 |
| `HeroBanner.tsx` fallback | 「AI 命理，精準解命」 / 「結合八字與紫微斗數…」 | 「AI 八字命理」 / 「以八字命理結合 AI，提供命理分析參考」 |
| `CompatibilityRevealCTA.tsx` | 「婚變危機預測」 | 「婚姻挑戰分析」 |
| `readings-api.ts` section titles | 「男方/女方婚變情況預測」 | 「男方/女方婚姻挑戰分析」 |
| `BirthDataForm.tsx` subtitle | 「…以獲得最精確的分析」 | 「…以獲得更完整的分析」 |
| `ElementExplanation.tsx` fallback | 「此項目的詳細解讀即將推出」 | 「此項目暫無詳細解讀」 |
| `ComingSoon.tsx` | unused component with a 「即將推出」 default | deleted |

Copy guard test: the removed phrases (精準, 紫微斗數, 預見你的一生, 即將推出,
敬請期待, 婚變危機預測) must not appear in non-test source. Matching runs over the
TypeScript AST's string literals and JSX text (the `typescript` package is
available), so comments are excluded without a regex that would cut `'https://…'`
literals in half.

## Item 6 — Purchases hygiene (F19, F26, F20)

- **Identity follows the Clerk session.** `PurchasesIdentityBridge` (inside
  `ClerkLoaded`) lazy-imports `lib/purchases` when a `userId` appears or changes
  and calls `configurePurchases(userId)`, so a background-completed or Ask-to-Buy
  transaction is attributed to the signed-in user even if the store was never
  opened. No-op when the platform key is absent. The import is lazy so the native
  module stays off the boot path until sign-in.
- **Sign-out clears it.** `src/lib/session.ts::signOutAndClear(signOut)`:
  lazy-imports `lib/purchases`, awaits `logOutPurchases()` raced against a 3 s
  timeout (sign-out never waits on the network), clears consent state, then
  `signOut()`. `logOutPurchases` loses its `configuredForUser === null` early
  return in favour of asking the SDK (`Purchases.isConfigured()`) so it also clears
  an identity configured by the bridge. `configurePurchases` likewise asks
  `isConfigured()`: `Purchases.configure` runs once per process, every later
  sign-in uses `Purchases.logIn(userId)` (a second `configure` replaces the shared
  instance and drops its listeners). Test: sign-out → sign-in in one process
  configures once and logs in once. Used by 我的 sign-out, account deletion and
  `AuthBridge`'s 401 handler. A source test asserts no other `signOut()` call exists.
- **Restore tells the truth.** `restorePurchases()` returns
  `{ kind: 'restored', hasPurchases } | { kind: 'other_account' } | { kind: 'error' }`
  (codes 7 / 13 → other_account). Messages: 「已恢復您的購買記錄。」;
  「此帳號沒有可恢復的購買。如果您是以其他帳號購買，請登入該帳號。」;
  「此購買屬於另一個帳號，請登入原本購買的帳號以恢復。」; 「恢復失敗，請稍後再試。」.
  The other_account branch only fires once RevenueCat's transfer behaviour is
  "Keep with original App User ID" — owner step in 1C-b (O4).
- **Warn before a second membership.** On store load also fetch
  `GET /api/payments/subscription` (a 404 — no user row yet — means no
  membership). Tapping a **subscription** package when `stripeSubscription` is
  present (fallback for an API without the field:
  `activeSubscription.platform === 'STRIPE'`) shows, with 取消 / 仍要訂閱:
  - status ACTIVE or PAST_DUE: 「您已在網站訂閱會員方案，再次於此訂閱將重複扣款。
    確定要繼續嗎？」
  - status CANCELLED (period still running): 「您的網站方案將於 {date} 到期，在此之前
    再次訂閱會有一段期間重複付費。確定要繼續嗎？」
  Credit packs never warn.

## Item 7 — Sentry scrubber (F7, launch todo #25)

- `src/lib/sentry-scrub.ts`: a copy of the web scrubber with identical key lists,
  plus `scrubBreadcrumb()` (data through the key scrub, message through
  `redactFreeText`).
- `src/lib/sentry-options.ts::sentryInitOptions(dsn)` →
  `{ dsn, tracesSampleRate: 0.1, sendDefaultPii: false, attachScreenshot: false,
  attachViewHierarchy: false, beforeSend, beforeSendTransaction, beforeBreadcrumb }`
  (no replay integration). `_layout.tsx` uses it. Unit test asserts every field.
- **Recorded limit:** native iOS/Android crash reports are assembled by the native
  SDK from the scope synced from JS; `beforeSend` does not see them. Breadcrumbs
  are scrubbed on the way in (`beforeBreadcrumb`). So: a guard test fails if any
  file calls `Sentry.setUser`, `setExtra`, `setExtras`, `setContext` or `setTag`
  (nothing does today — keeps it that way).
- `apps/api/test/sentry-scrub-parity.spec.ts` extends its union to three copies.
- PostHog stays off (O5).

## Item 8 — Store screen

- Membership rows: store title, period (「每月」 for `P1M`, else from the ISO
  period), `priceString`「／月」, 「每月 N 點」 from a product-ID map
  (`com.tianming.app.{basic,pro,master}.monthly` → 5 / 15 / 50 = the plans'
  `monthlyCredits`). Unmapped → no credits line. iOS IDs only (Android is not in
  this submission); noted beside the map.
- 管理訂閱: `showManageSubscriptions()` on iOS, URL fallback; Play URL on Android.
  Same call in the account-deletion interstitial — the bridge (item 6) has already
  configured RevenueCat, and the call still falls back to the URL on any failure.

## Item 9 — `app.json` and OTA (F10, F8)

- `ios.usesAppleSignIn: true`; `ios.config.usesNonExemptEncryption: false`;
  plugins `expo-apple-authentication`, `expo-updates`.
- `ios.infoPlist.NSPhotoLibraryAddUsageDescription`
  「需要存取相簿以儲存您的命盤分享圖片。」.
- Language: Expo `locales` (`zh-Hant`, `zh-Hans` JSON files with
  `CFBundleDisplayName` 天命 and the photo-library string), which generates the
  `.lproj` folders the App Store reads; plus `CFBundleDevelopmentRegion: 'zh-Hant'`.
- OTA: `runtimeVersion: { policy: 'fingerprint' }`, `updates.url
  https://u.expo.dev/b7c274f0-ce98-42ca-93c9-cb5af4faff3a`; `eas.json` production
  `channel: 'production'`, preview `channel: 'preview'`.
- Verify: `expo config --type public`, then `expo prebuild --platform ios
  --no-install` into a scratch copy; read `Info.plist`, the `.lproj` folders
  (including whether an `en.lproj` / `Base` remains and what the project's
  `developmentRegion` is) and `PrivacyInfo.xcprivacy`. If English is still the
  development region, set it with a small config plugin rather than accept an
  English language listing.

## Item 10 — CI

New `Mobile Tests` job: `npm ci`, then `cd apps/mobile && npx jest` and
`npx tsc --noEmit`. Without it every mobile guard here (and the existing
typography guards) only runs when someone remembers. Mobile jest and tsc have
never run on a case-sensitive filesystem, so the first CI run on the PR is part
of the gate.

**Existing suites.** Layer 1 defaults to `unknown`, so suites that call the
guarded functions start getting refusals: `fortune-api.test.ts`,
`readings-api.test.ts`, `chat.test.tsx`, `compat.test.tsx`, `fortune-ui.test.tsx`,
`store.test.tsx` (and any other the first run reveals). Each gets
`__setAiConsentStatusForTest('granted')` in its own `beforeEach` — not a global
jest setup, which would mask the layer-1 tests.

## Installing the two native dependencies

1. Snapshot the main checkout: `ls node_modules | wc -l`, md5 of `package-lock.json`,
   and `git status --porcelain` (must be clean).
2. In the main checkout: `npx expo install expo-apple-authentication expo-updates`
   (Expo picks the SDK-57 versions). This edits main's `apps/mobile/package.json`
   and `package-lock.json` and installs into main's `node_modules`.
3. Copy **only the `apps/mobile/package.json` change** into the branch (main's
   lockfile may predate this branch's); `git checkout --` both files in main (the
   installed packages stay in `node_modules`, so the worktree resolves them).
4. In the worktree: `npm install --package-lock-only --ignore-scripts` and confirm
   the lockfile diff is only the two packages and their dependencies.
5. Re-snapshot main: tracked tree clean again; node_modules count grew only by the
   new packages.

---

## Amendments from round 3 (binding for implementation)

- **A1 — a sheet that never shows must not wedge the gate.** Watch `onShow`; if it
  has not fired ~1 s after `visible=true`, set `visible=false` and resolve `false`.
  Resolve on `onDismiss` **or** a ~1 s fallback after `visible=false`, whichever
  first. Resolve any pending promise `false` on `userId` change or provider
  unmount. Test: no `onShow` → settles `false`, and the next call opens a new sheet.
- **A2 — one refusal path for streams.** All five stream functions go through
  `openSseStream` (`lib/stream.ts`); it gains `requiresAiConsent: true`, which
  routes a refusal through its normal transport-error path and returns its normal
  teardown. One implementation, one test.
- **A3 — refusal code.** `AiConsentRequiredError` extends `ApiError` with code
  `AI_CONSENT_REQUIRED`; `startReading` and compat's stream `onError` get a branch
  for it (no 「解鎖失敗」 / 「若已扣點將自動退回」 for a consent refusal).
- **A4 — chat test expectation:** a refusal marks the user message failed
  (`markUserFailed`) and clears `streaming`; it does not drop the message.
- **A5 — `useAiConsent()` outside a provider** returns a fail-closed default
  (`status: 'unknown'`, `requireAiConsent` → `false`) so existing component tests
  render; suites that exercise the gate wrap a provider or mock the hook.
- **A6 — copy guard** covers template-literal parts (`NoSubstitutionTemplateLiteral`,
  template head/middle/tail) as well as string literals and JSX text.
- **A7 — `configurePurchases`** keeps a module-level in-flight promise so the bridge
  and the store screen cannot both call `configure`.
- **A8 — the sheet** is a transparent full-screen Modal (no `pageSheet`, so no
  swipe-to-dismiss path); hardware back on Android = 「暫不使用」.

## Tests

Behavioural (jest, native modules mocked):
- Apple flow: cancelled → no alert; complete sign-in → session; transferable →
  sign-up with the credential's name; missing_requirements → incomplete; other
  status → incomplete; no token → error; button absent on Android.
- Reset password: email step → create; code step → attemptFirstFactor; complete →
  setActive; Clerk error shown; pwned sign-in error → reset button.
- Consent provider: granted skips the sheet; missing opens it; 同意 posts the
  bundled version; resolution waits for `onDismiss`; a layer-1 call right after
  resolution succeeds; 404 → missing; outdated → no sheet + update alert; 409 →
  outdated; network failure → false; load failure → `error` with retry; two
  callers → one sheet; withdraw → DELETE; stale load for a previous user dropped;
  foreground refresh re-reads without passing through `unknown`.
- Layer 1: each guarded function throws without consent and sends no request
  (fetch never called); `fetchDailyFortune({ engineOnly: true })` passes.
- Each tap-gated surface: declining does not open the unlock modal / chat sheet /
  reveal, and does not call the charging function; accepting does.
- 日運 before consent uses engine-only and shows the card; `unknown` starts nothing.
- Restore: four outcomes. Web-member warning: stripeSubscription present → warns;
  absent → none; packs never. Store credits line from the map; none when unmapped.
- `signOutAndClear` order and timeout; bridge configures on sign-in.
- Account display for relay emails. `sentryInitOptions` fields.

Static guards: consent UX ratchet, wrong-domain, removed copy, single sign-out
path, no Sentry scope setters; in apps/api: disclosure + support-email pin,
three-way scrubber parity.

## Verification gate

mobile jest + tsc, api jest, web jest green; `turbo run lint --force` 5/5, 0
cached; typography guards green; every new guard seen to fail under mutation;
separate line-audit agent.

Device (main checkout, files copied in, iOS dev client rebuilt, simulator; revert
after): Apple button renders and opens Apple's sheet; consent sheet appears and
the flow continues for **reading unlock, chat FAB, an InlineAskCard, compat
reveal, 日運 card, 月運**; 我的 rows; reset-password screen reaches the code step;
store rows + restore message.

## 1C-b — owner-dependent

- **Icon + splash (F9, D11):** 2–3 opaque 1024×1024 candidates; owner picks
  before the first TestFlight build.
- **Crash symbolication:** Sentry org/project/auth token as EAS secrets for the
  production profile only, plus a hidden admin-only trigger to prove a
  symbolicated crash arrives.
- **RevenueCat:** set transfer behaviour to "Keep with original App User ID" (O4).
- **Home banner content:** owner reviews admin-uploaded banners for claims.
- **On a real iPhone against production Clerk:** Apple sign-in, native email
  sign-up (captcha is enabled on the live instance), password reset.

## Review log

**Round 1 — 1 critical, 3 high, 8 medium, 8 low. Verdict REVISE. All accepted.**

| # | Disposition |
|---|---|
| C1 | iOS won't stack Modals: the sheet opens only from taps before any Modal; code under a Modal relies on layer 1 + an inline message. Device checks cover every entry point |
| H1 | Mobile CI job added (item 10); disclosure pin moved into apps/api tests |
| H2 | Install procedure written (main checkout, snapshot, carry package.json + lockfile, revert) |
| H3 | Enforcement moved to `src/lib` (layer 1); the sweep is now a UX ratchet; list includes `fetchDailyFortune`/`fetchMonthlyFortune`/`extendSession`; `streamChatMessage` location corrected |
| M1 | Native reset-password screen; no website hand-off; dead-end alerts point at 客服 |
| M2 | 404 → missing; outdated build → update alert before any sheet |
| M3 | userId-tagged loads, foreground refresh, `unknown` starts nothing on fortune tabs |
| M4 | Compat gate at the very top of `handleReveal` |
| M5 | Bridge configures RevenueCat on sign-in; `logOutPurchases` asks the SDK; 3 s timeout |
| M6 | Native-crash limit recorded; screenshot/view-hierarchy off; guard against Sentry scope setters |
| M7 | Apple flow written directly; name captured on first authorisation; status read from this call only |
| M8 | RevenueCat transfer setting added to 1C-b |
| Low | ComingSoon deleted; Apple button renders immediately; Android IDs noted; Expo `locales` for `.lproj`; warning uses `stripeSubscription`; native email sign-up on device in 1C-b; `zh()` display noted. Shared `/users/me` fetch not taken — one extra call at sign-in, kept separate for a simpler provider |

**Round 2 — 2 high, 5 medium, 8 low. Verdict REVISE. All accepted except one low,
recorded as a residual risk.**

| # | Disposition |
|---|---|
| H1 | `requireAiConsent` and follow-up alerts resolve from the sheet's `onDismiss` (iOS), with a jest assertion |
| H2 | Layer-1 status written synchronously before resolving; test calls a guarded function right after |
| M1 | Refusal contract: promises reject, stream functions route through `onError`/`onClose`, user-facing message; tests for no unhandled rejection and loading state cleared |
| M2 | Foreground refresh keeps the previous status; only real transitions are written |
| M3 | `error` status with 重試 on the fortune tabs |
| M4 | `configurePurchases` asks `isConfigured()`: configure once, `logIn` after |
| M5 | Existing suites listed; per-suite test setter, no global default |
| Low | Disclosure pin `require`s the module (no RN imports); only package.json copied from main; CANCELLED web plan gets its own wording; 404 tolerated; `strategy_for_user_invalid` mapped; reset `Stack.Screen` added; copy guard uses the TS AST; prebuild check covers `en.lproj`/`developmentRegion`; first Linux CI run is part of the gate. **Not taken:** an `?app=1` legal render — the support page reachable via the legal nav is recorded as a residual risk with that as the fix if review objects |

**Round 3 — 1 medium, 9 low. Verdict APPROVE** with M1 required and the lows to
fold in. All taken as amendments A1–A8; the residual-risk reason was corrected
(the linked subscription page does offer purchase buttons). Cosmetic note on
item 4's paragraph order left as is.

---

## Implementation record (2026-11-22)

**Deviations from the design, each deliberate:**

- **Lazy `require`, not `await import()`,** for `lib/purchases` (`lib/lazy-purchases.ts`).
  Metro supports both, but jest-expo does not transform dynamic `import()`, and every
  caller swallows errors — so the sign-out RevenueCat logout was silently skipped
  under test. The session test caught it.
- **`lib/api-error.ts`** holds `ApiError` so `ai-consent-state.ts` stays free of RN
  imports (the API test suite `require`s it); `api.ts` re-exports it.
- **Privacy manifest added** (`ios.privacyManifests`: UserDefaults CA92.1,
  FileTimestamp C617.1, SystemBootTime 35F9.1, DiskSpace E174.1). The parent plan's
  F10 said one was already generated; a prebuild showed none at app level.
- **`plugins/with-ios-development-region.js`** sets the Xcode project's
  `developmentRegion` to zh-Hant and `knownRegions` to Base + zh-Hant + zh-Hans
  (the prebuild still had `en`). Verified by prebuild; `ios/` deleted after.
- **`lib/enter-app.ts`** (line-audit fix, below).
- The Build CI job does NOT depend on the new Mobile Tests job, so a mobile test
  failure cannot block a backend deploy.
- Fixed a pre-existing broken assertion (compat CTA label, stale since `111ef07`)
  that no one saw because mobile tests never ran in CI.

**Line-audit fix (confidence 75).** A nested auth flow (登入 → 忘記密碼 → reset, or
登入 → 註冊) left the auth modals on the stack, so expo-router presented the app
shell as another modal and iOS refused the root-mounted consent sheet — every AI
feature silently did nothing until restart. All seven post-auth entries now go
through `enterApp()` (dismiss the auth modals, then replace), guarded by an AST test;
the show-watchdog now alerts instead of resolving silently.

**Verification.** Mobile jest 293 passing (35 suites), mobile tsc clean, API parity
specs 89 passing, root `turbo run lint --force` 5/5 0 cached (the config plugin
needed Node globals declared in `eslint.config.mjs`). Mutation: 66/66 caught
(63 in the batch run incl. two re-run by hand, plus 3 for the line-audit fix). Expo
config resolved and a prebuild inspected (Info.plist keys, entitlement, `.lproj`,
development region, privacy manifest).

**Simulator check (2026-11-22, iPhone 17 Pro / iOS 26.5, main checkout, local API
against `bazi_1c_sim`, reverted afterwards).** Passed: new welcome copy; Apple button
above Google on sign-in and sign-up, legal line + links; 忘記密碼 → 重設密碼 email
step; 日運 engine-only score + consent card before consent; chat button → sheet →
暫不使用 keeps chat closed; 解鎖 → sheet → 同意 → the unlock confirmation opens right
after the sheet closes (the iOS presentation hand-off), consent saved, no credits
charged on 取消; 日運 card → 同意 starts the AI stream at once; 我的 rows (consent
status, withdraw confirm → 未同意 and 日運 back to the card, privacy, terms, support);
store rows, 恢復購買 "nothing to restore" message.
Not covered on device: Apple's sheet (the main checkout's native project predates
1C, so no Sign in with Apple entitlement and an English development region — needs
a fresh prebuild), the reset code step (would send a real email), 合盤 reveal and
月運 card (jest-covered).
An apparent "taps stop working" was traced to taps sent mid-animation (tab switch,
modal close, scroll momentum); with normal pacing every tap landed first time,
reproduced three times. Not a 1C defect.
⚠️ Found while building: **Xcode 27.2 refuses Pods targets below iOS 15**
(RevenueCat, Sentry, RNSVG, view-shot, AsyncStorage, ReachabilitySwift) with
`IPHONEOS_DEPLOYMENT_TARGET … supported range is 15.0 to 27.2`. Patched in the
generated Podfile for the test only, then made durable: config plugin
`plugins/with-pod-deployment-target.js` appends a floor after
`react_native_post_install(...)` that raises only targets SETTING a value below
15.1 (inherited 16.4 targets are untouched), is idempotent, and fails prebuild
loudly if the template loses its anchor. 7 unit tests, 5/5 mutations caught, and a
real `expo prebuild` emitted the block — the same snippet that built under Xcode
27.2 in the simulator run.
