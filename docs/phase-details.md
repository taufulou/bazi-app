# Phase Implementation Details

> Extracted from CLAUDE.md. Read this when working on specific features or debugging existing phase implementations.

## Phase 5 Details (Monetization -- 5 Revenue Streams)

### New DB Models (migration `20260215092104_add_monetization_models`)
- `CreditPackage` -- slug, nameZhTw/ZhCn, creditAmount, priceUsd, isActive, sortOrder
- `AdRewardLog` -- userId, rewardType (CREDIT/SECTION_UNLOCK/DAILY_HOROSCOPE), creditsGranted
- `SectionUnlock` -- userId, readingId, sectionKey, unlockMethod (CREDIT/AD_REWARD/SUBSCRIPTION), unique constraint
- `MonthlyCreditsLog` -- userId, creditAmount, periodStart/End, unique constraint on [userId, periodStart]
- Updated: Plan.monthlyCredits (Basic:5, Pro:15, Master:-1), Service.sectionUnlockCreditCost

### Backend (15 payment endpoints + 3 ads endpoints)
- `GET /api/payments/credit-packages` (@Public) -- active credit packages
- `POST /api/payments/checkout/credits` -- Stripe credit package checkout
- `POST /api/payments/checkout/subscription` -- Stripe subscription checkout
- `POST /api/payments/portal` -- Stripe customer portal
- `POST /api/payments/cancel` / `POST /api/payments/reactivate` -- subscription management
- `POST /api/payments/upgrade` -- upgrade or downgrade subscription plan
- `GET /api/payments/monthly-credits` -- monthly credit grant status
- `POST /api/readings/:id/unlock-section` / `GET /api/readings/:id/unlocked-sections` -- section unlock
- `GET /api/ads/config` / `GET /api/ads/status` / `POST /api/ads/claim` -- rewarded video ads (5/day limit)
- `apps/api/src/ads/` -- ads module, controller, service
- `apps/api/src/payments/section-unlock.service.ts` -- per-section unlock with credit/$transaction

### Frontend
- `store/page.tsx` + `store.module.css` -- credit package purchase with Stripe
- `admin/credit-packages/page.tsx` -- admin CRUD for credit packages
- `admin/monetization/page.tsx` -- revenue analytics dashboard
- `InsufficientCreditsModal.tsx` -- paywall with buy credits / watch ad / subscribe CTAs

### Seed Data
4 credit packages (starter-5/$4.99, value-12/$9.99, popular-30/$19.99, mega-60/$34.99)

### Not Yet Implemented (deferred to mobile phase)
- Apple IAP + Google Play billing
- Real AdMob SDK integration (currently mock ad button on web)
- AdMob Server-Side Verification (V2)

---

## Phase 10 Details (Wire Frontend to NestJS API)
- **`readings-api.ts`**: API client with `createBaziReading()`, `createZwdsReading()`, `getReading()`, `getReadingHistory()`, `transformAIResponse()`, slug→enum mapping, 40+ section title zh-TW labels
- **`reading/[type]/page.tsx`**: Signed-in users → NestJS API (credit deduction, AI interpretation, DB save); unsigned users → direct engine (chart-only, mock AI paywall); `loadSavedReading(id)` for deep-links; `refreshUserProfile()` on tab visibility
- **`dashboard/readings/page.tsx`**: Reading history with type, credits used, date, birth profile; enum→slug reverse mapping
- **`dashboard/subscription/page.tsx`**: Current plan display, cancel/reactivate with inline confirmation dialogs, billing period display (月繳/年繳), Stripe Customer Portal link
- **`pricing/page.tsx`**: Tier-aware CTA buttons. Unified `handlePlanChange()` for both upgrade and downgrade via `POST /api/payments/upgrade`. Monthly/annual toggle; success/cancel toast notifications
- **`store/page.tsx`**: Credit package cards from API, best-value badge, `createCreditCheckout()` → Stripe; balance display

---

## Frontend UI Summary (apps/web/)
- **Landing Page** (`/`): Hero with CTA, 6 Bazi + 6 ZWDS feature cards. Server component with `auth()`.
- **BirthDataForm**: Name dropdown for saved profiles, gender toggle, date/time pickers, city datalist, timezone select. Phase 8B extras (month picker, date picker, Q&A textarea). Save checkbox with relationship tag.
- **BaziChart**: Full Four Pillars table with element coloring, hidden stems, ten gods, na yin, shen sha, life stages, Five Elements energy circles, Day Master analysis panel, Luck Periods timeline, Kong Wang display.
- **ZwdsChart**: 12-palace grid with iztro data, stars, brightness, mutagens, changsheng12. Purple-themed.
- **AIReadingDisplay**: Section-by-section with themed backgrounds. Subscribers see full; free users see preview + blurred paywall. Streaming cursor, loading skeletons, entertainment disclaimer, cross-sell grid.
- **Reading Page** (`/reading/[type]`): Two-step flow (input → result) with step indicator and tab bar. 16 reading types.
- **Dashboard** (`/dashboard`): Two sections (Bazi + ZWDS cards), subscription CTA banner, profile management link.
- **Profile Management** (`/dashboard/profiles`): Full CRUD with ProfileCard. Inline delete confirmation.
- **Styling**: CSS Modules (no Tailwind). Dark theme.
- **Tests**: 71 tests (BirthDataForm: 16, BaziChart: 30, AIReadingDisplay: 25).

---

## ZWDS Engine (iztro) Details
- **Library**: iztro v2.5.7 (Node.js, installed at monorepo root)
- **Backend**: `apps/api/src/zwds/` -- NestJS module with full CRUD, credit system, AI integration
- **Frontend Direct**: `apps/web/app/api/zwds-calculate/route.ts` -- Next.js API route (no auth/credits)
- **Chart Data**: Standardized `ZwdsChartData` with 12 palaces, major/minor/adjective stars, brightness, mutagens, horoscope (decadal/yearly/monthly/daily)
- **Time Index**: HH:MM → iztro time index (0=early zi, 1=chou, ... 12=late zi)
- **Solar Date Format**: Non-zero-padded `YYYY-M-D` (e.g., `1987-9-6`)
- **Tests**: 209 ZWDS-specific tests + 80 Phase 8B tests = 289 ZWDS tests
